'use strict';

const db = require('./db');
const settings = require('./settings');
const reports = require('./reports');
const datasources = require('./datasources');
const dsMod = require('./datasource');
const schema = require('./schema');
const projects = require('./projects');

/**
 * V8 · AI 问数「数据范围（scope）」解析与 SQL 表白名单校验
 *
 * 设计目标（见 _work/v8/CONTRACT.md 第 2 节）：
 *   1. 把四类来源（数据集 / 数据项目 / 邮箱推送项目 / 处理流程产出表）统一解析成
 *      同一种内部对象，附带真实列清单与行数；
 *   2. 坏源（表不存在 / SQL 报错 / 绑定的项目已删除 / 跨数据源）**不抛错**，
 *      返回 `invalid:true` + `reason`，让前端置灰、让模型看不到坏表；
 *   3. 喂给模型的**不是**物理表名，而是逻辑表名（t1 / t2 / ds_42），
 *      执行时用 `WITH <别名> AS (SELECT * FROM <物理表>)` 注入。
 *      原因：物理表名可能是中文/含连字符/含反引号，直接进提示词会让模型写错；
 *      实测 MiMo 拿到 `` t1 `` + 中文列清单能 3/3 输出干净的 SQL。
 *   4. 生成 SQL 后做「只读 + 表白名单」双重校验，防止模型越权访问 jdywh_users 等表。
 */

/** 明确禁止访问的系统库 */
const SYSTEM_SCHEMAS = ['information_schema', 'mysql', 'performance_schema', 'sys'];

/**
 * 兜底禁止的数据表前缀：本项目所有业务表都以 jdywh_ 开头，
 * 任何出现在模型 SQL 里的 `jdywh_*` 标识符都必须属于 scope 内的物理表。
 * （用于堵住「FROM a JOIN b ON .., c」这类逗号列表躲过 FROM/JOIN 解析的漏洞）
 */
const PROTECTED_PREFIXES = ['jdywh_'];

const KIND_LABEL = {
  dataset: '数据集',
  project: '数据项目',
  mail: '邮箱推送',
  flow: '流程产出',
};

/* ══════════════════════════════════════════════════════════════════
 *  一、SQL 词法扫描（供表白名单校验使用）
 * ══════════════════════════════════════════════════════════════════ */

/** 会触发「下一个词是表名」的关键字 */
const TABLE_TRIGGERS = new Set(['from', 'join']);

/** 出现在表名位置时表示「这不是表名」的关键字 */
const NOT_A_TABLE = new Set([
  'select', 'values', 'lateral', 'unnest', 'dual', 'json_table', 'table', 'into',
  'where', 'group', 'order', 'having', 'limit', 'union', 'on', 'using', 'set',
  'straight_join', 'natural', 'inner', 'left', 'right', 'full', 'cross', 'outer',
  'as', 'window', 'qualify', 'offset', 'fetch', 'returning', 'procedure',
]);

/**
 * 把 SQL 拆成 token。
 *
 * token.type：
 *   word   普通词（关键字 / 裸标识符，含中文）
 *   ident  被引号包起来的标识符（`t` / "t" / [t]）
 *   punct  单字符标点
 *   string 字符串字面量（表名位置不会出现，直接丢弃）
 * 注释直接丢弃。
 */
function tokenize(sql) {
  const s = String(sql || '');
  const out = [];
  let i = 0;
  const isWordChar = (c) => /[0-9A-Za-z_$\u0080-\uFFFF]/.test(c);

  while (i < s.length) {
    const c = s[i];

    // -- 行注释
    if (c === '-' && s[i + 1] === '-') {
      while (i < s.length && s[i] !== '\n') i += 1;
      continue;
    }
    // # 行注释
    if (c === '#') {
      while (i < s.length && s[i] !== '\n') i += 1;
      continue;
    }
    // /* 块注释 */
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end < 0 ? s.length : end + 2;
      continue;
    }
    // 单引号字符串
    if (c === "'") {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === "'") {
          if (s[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j += 1;
      }
      i = j + 1;
      out.push({ type: 'string', value: '' });
      continue;
    }
    // 反引号（MySQL 标识符）
    if (c === '`') {
      let j = i + 1;
      let v = '';
      while (j < s.length) {
        if (s[j] === '`') {
          if (s[j + 1] === '`') { v += '`'; j += 2; continue; }
          break;
        }
        v += s[j];
        j += 1;
      }
      i = j + 1;
      out.push({ type: 'ident', value: v, quoted: '`' });
      continue;
    }
    // 双引号：MySQL 默认是字符串，ANSI_QUOTES 下是标识符。
    // 表名位置不可能是字符串，因此这里按「标识符」处理，宁可多拦不可漏拦。
    if (c === '"') {
      let j = i + 1;
      let v = '';
      while (j < s.length) {
        if (s[j] === '\\') { v += s[j + 1] || ''; j += 2; continue; }
        if (s[j] === '"') {
          if (s[j + 1] === '"') { v += '"'; j += 2; continue; }
          break;
        }
        v += s[j];
        j += 1;
      }
      i = j + 1;
      out.push({ type: 'ident', value: v, quoted: '"' });
      continue;
    }
    // [方括号]（MSSQL 标识符）
    if (c === '[') {
      const end = s.indexOf(']', i + 1);
      const v = end < 0 ? s.slice(i + 1) : s.slice(i + 1, end);
      i = end < 0 ? s.length : end + 1;
      out.push({ type: 'ident', value: v.replace(/]]/g, ']'), quoted: '[' });
      continue;
    }
    // 空白
    if (/\s/.test(c)) { i += 1; continue; }

    // 普通词
    if (isWordChar(c)) {
      let j = i;
      while (j < s.length && isWordChar(s[j])) j += 1;
      out.push({ type: 'word', value: s.slice(i, j) });
      i = j;
      continue;
    }

    out.push({ type: 'punct', value: c });
    i += 1;
  }
  return out;
}

/** 跳过一段成对括号，返回右括号之后的下标 */
function skipParens(toks, i) {
  let depth = 0;
  let j = i;
  while (j < toks.length) {
    const t = toks[j];
    if (t.type === 'punct' && t.value === '(') depth += 1;
    else if (t.type === 'punct' && t.value === ')') {
      depth -= 1;
      if (depth <= 0) return j + 1;
    }
    j += 1;
  }
  return j;
}

/**
 * 从 FROM/JOIN 之后解析一个表引用。
 * @returns {{ref: ({schema:string|null, table:string}|null), next:number}}
 */
function parseTableRef(toks, i) {
  let j = i;

  // FROM (SELECT ...) x  → 子查询，本身不是表，但要继续看后面的逗号列表
  if (toks[j] && toks[j].type === 'punct' && toks[j].value === '(') {
    j = skipParens(toks, j);
    // 可选别名
    if (toks[j] && toks[j].type === 'word' && toks[j].value.toLowerCase() === 'as') j += 1;
    if (toks[j] && (toks[j].type === 'ident'
      || (toks[j].type === 'word' && !NOT_A_TABLE.has(toks[j].value.toLowerCase())))) {
      j += 1;
    }
    return { ref: null, next: j };
  }

  // 函数调用（JSON_TABLE(...) / UNNEST(...)）不是表
  if (toks[j] && (toks[j].type === 'ident' || toks[j].type === 'word')
    && toks[j + 1] && toks[j + 1].type === 'punct' && toks[j + 1].value === '(') {
    return { ref: null, next: skipParens(toks, j + 1) };
  }

  const parts = [];
  while (j < toks.length) {
    const t = toks[j];
    if (t.type === 'ident') {
      parts.push(t.value);
      j += 1;
    } else if (t.type === 'word' && !NOT_A_TABLE.has(t.value.toLowerCase())) {
      parts.push(t.value);
      j += 1;
    } else {
      break;
    }
    // db.table 形式
    if (toks[j] && toks[j].type === 'punct' && toks[j].value === '.') { j += 1; continue; }
    break;
  }

  /*
   * V8 修复（历史 bug 回归）：表名含连字符且未加引号。
   *
   * 数据集 #42 的源 SQL 是 `select * from zkcrm-ry`，模型也常常原样输出这串。
   * 词法上它会被拆成 word(zkcrm) punct(-) word(ry)，若只取第一段就会误判成表 `zkcrm`，
   * 从而被白名单拦下（V4.1 专门修过这个坑，V8 重构时又踩了一次）。
   *
   * 在 FROM/JOIN 之后的位置，`表名 - 词` 不可能是合法的算术表达式（别名不能以 - 开头），
   * 因此这里把 `-词` 反复拼回表名，还原出真实的物理表名 `zkcrm-ry`。
   */
  if (parts.length) {
    while (toks[j] && toks[j].type === 'punct' && toks[j].value === '-'
      && toks[j + 1] && (toks[j + 1].type === 'word' || toks[j + 1].type === 'ident')) {
      const nxt = toks[j + 1];
      if (nxt.type === 'word' && NOT_A_TABLE.has(nxt.value.toLowerCase())) break;
      parts[parts.length - 1] = `${parts[parts.length - 1]}-${nxt.value}`;
      j += 2;
    }
  }

  if (!parts.length) return { ref: null, next: j + 1 };
  return {
    ref: {
      schema: parts.length > 1 ? parts[0] : null,
      table: parts[parts.length - 1],
    },
    next: j,
  };
}

/**
 * 抽取 SQL 中所有 `FROM/JOIN` 后的表引用（含逗号分隔的表列表）。
 * @returns {Array<{schema:string|null, table:string}>}
 */
function extractTableRefs(sql) {
  const toks = tokenize(sql);
  const refs = [];
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i];
    if (t.type !== 'word' || !TABLE_TRIGGERS.has(t.value.toLowerCase())) continue;

    let j = i + 1;
    // 逗号分隔的表列表：FROM a, b, c
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const r = parseTableRef(toks, j);
      if (r.ref) refs.push(r.ref);
      j = r.next;
      if (toks[j] && toks[j].type === 'punct' && toks[j].value === ',') { j += 1; continue; }
      break;
    }
  }
  return refs;
}

/** 抽取 SQL 里自己声明的 CTE 名：WITH a AS (...), b AS (...) */
function extractCteNames(sql) {
  const toks = tokenize(sql);
  const names = [];
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i];
    if (t.type !== 'word' || t.value.toLowerCase() !== 'with') continue;
    let j = i + 1;
    if (toks[j] && toks[j].type === 'word' && toks[j].value.toLowerCase() === 'recursive') j += 1;
    // eslint-disable-next-line no-constant-condition
    while (j < toks.length) {
      const nameTok = toks[j];
      if (!(nameTok.type === 'ident' || nameTok.type === 'word')) break;
      const name = nameTok.value;
      j += 1;
      // 可选列清单 name (c1, c2)
      if (toks[j] && toks[j].type === 'punct' && toks[j].value === '(') j = skipParens(toks, j);
      if (!(toks[j] && toks[j].type === 'word' && toks[j].value.toLowerCase() === 'as')) break;
      j += 1;
      if (!(toks[j] && toks[j].type === 'punct' && toks[j].value === '(')) break;
      names.push(name);
      j = skipParens(toks, j);
      if (toks[j] && toks[j].type === 'punct' && toks[j].value === ',') { j += 1; continue; }
      break;
    }
  }
  return names;
}

/** 抽取所有标识符（裸词 + 引号标识符），用于系统库 / 受保护前缀兜底检查 */
function extractIdentifiers(sql) {
  return tokenize(sql)
    .filter((t) => t.type === 'word' || t.type === 'ident')
    .map((t) => t.value);
}

/* ══════════════════════════════════════════════════════════════════
 *  二、四类来源解析
 * ══════════════════════════════════════════════════════════════════ */

/** 读取某张物理表的列（不存在则返回 null） */
async function tableColumns(table) {
  const name = String(table || '').trim();
  if (!name) return null;
  if (!(await schema.tableExists(name))) return null;
  return schema.columnInfo(name);
}

/** 读取某张物理表的行数（失败返回 0） */
async function tableRowCount(table) {
  const name = String(table || '').trim();
  if (!name) return 0;
  try {
    const r = await db.queryOne(`SELECT COUNT(*) AS c FROM ${quoteName(name)}`);
    return Number((r && r.c) || 0);
  } catch (_) {
    return 0;
  }
}

/** 项目字段定义：列名 → 中文名（让模型看得懂 widget_xxx） */
async function columnLabelMap(projectId) {
  if (!projectId) return {};
  try {
    const rows = await db.query(
      'SELECT column_name, field_name FROM jdywh_field_defs WHERE project_id = ? AND enabled = 1',
      [projectId]
    );
    const map = {};
    rows.forEach((r) => { if (r.column_name) map[r.column_name] = r.field_name; });
    return map;
  } catch (_) {
    return {};
  }
}

function decorateColumns(cols, labels) {
  return (cols || []).map((c) => ({
    name: c.name,
    type: c.type || c.dataType || '',
    label: labels[c.name] || c.comment || '',
  }));
}

/**
 * 解析「数据集」来源。
 *
 * - datasource_id 必须是 0（本机库）；跨数据源 V8 明确不支持
 * - source_type=project → 项目解析表 / 原始表
 * - source_type=table   → source_table（必须真实存在）
 * - source_type=sql     → 用 WITH 内联为逻辑表（先试运行校验 + 推断列）
 */
async function resolveDataset(id) {
  const dataset = await reports.getDataset(Number(id));
  if (!dataset) return { invalid: `数据集不存在（ID: ${id}）` };
  if (Number(dataset.status) !== 1) return { invalid: `数据集「${dataset.name}」已停用` };
  if (Number(dataset.datasourceId || 0) !== 0) {
    return { invalid: `数据集「${dataset.name}」使用外部数据源（ID: ${dataset.datasourceId}），V8 暂不支持跨数据源 AI 问数` };
  }

  if (dataset.sourceType === 'project') {
    const project = await projects.getProject(dataset.projectId);
    if (!project) {
      return { invalid: `数据集「${dataset.name}」关联的数据项目已不存在（项目ID: ${dataset.projectId}）` };
    }
    const table = dataset.sourceTable === 'parsed'
      ? (project.parsed_table || schema.makeParsedTableName(project.id))
      : (project.data_table || schema.makeTableName(project.id));
    const cols = await tableColumns(table);
    if (!cols) return { invalid: `数据集「${dataset.name}」指向的数据表 ${table} 不存在` };
    const labels = await columnLabelMap(project.id);
    return {
      kind: 'dataset', id: dataset.id, name: dataset.name,
      table, datasourceId: 0,
      columns: decorateColumns(cols, labels),
      rowCount: await tableRowCount(table),
      sourceType: 'project',
    };
  }

  if (dataset.sourceType === 'table') {
    const table = String(dataset.sourceTable || '').trim();
    if (!table) return { invalid: `数据集「${dataset.name}」未指定数据表` };
    const cols = await tableColumns(table);
    if (!cols) return { invalid: `数据集「${dataset.name}」指向的数据表 ${table} 不存在` };
    return {
      kind: 'dataset', id: dataset.id, name: dataset.name,
      table, datasourceId: 0,
      columns: decorateColumns(cols, {}),
      rowCount: await tableRowCount(table),
      sourceType: 'table',
    };
  }

  // SQL 数据集：只读校验 → 补引号 → 试运行 1 行拿列 → 计数
  const source = await datasources.getById(0);
  let normalized;
  try {
    const safe = reports.assertReadOnly(dataset.sourceSql);
    normalized = dsMod.normalizeSql(source, safe);
  } catch (err) {
    return { invalid: `数据集「${dataset.name}」的 SQL 不合法：${err.message}` };
  }
  let columns = [];
  try {
    const sql = dsMod.paginate(source, normalized, 1, 0);
    const rows = await dsMod.query(source, sql, []);
    columns = rows.length
      ? Object.keys(rows[0]).map((n) => ({ name: n, type: typeof rows[0][n] }))
      : [];
  } catch (err) {
    const described = dsMod.describeDbError(source, err, normalized, normalized, normalized);
    return { invalid: `数据集「${dataset.name}」的 SQL 执行失败：${described.message.split('\n')[0]}` };
  }
  let rowCount = 0;
  try {
    const cRow = await db.queryOne(`SELECT COUNT(*) AS c FROM (${normalized}) AS _v8_cnt`);
    rowCount = Number((cRow && cRow.c) || 0);
  } catch (_) { rowCount = 0; }

  return {
    kind: 'dataset', id: dataset.id, name: dataset.name,
    table: null,
    datasourceId: 0,
    columns: decorateColumns(columns, {}),
    rowCount,
    sourceType: 'sql',
    sqlAlias: `ds_${dataset.id}`,
    /*
     * sqlBody 用**已补反引号的**版本（normalizeSql）：
     *   select * from zkcrm-ry  →  select * from `zkcrm-ry`
     * 这样 wrapSql 拼出来的 CTE 本身合法；同时 physicalRefs 里能拿到真实的连字符表名。
     */
    sqlBody: normalized,
    /*
     * physicalRefs：该 SQL 数据集自己引用的物理表（白名单里要放行它们）。
     * 场景：模型看到数据集 42 的列后，直接写 `select * from zkcrm-ry`（数据集自身的源表），
     * 这是完全合理的查询，不能因为「表名不在 scope.table 里」就拒绝。
     */
    physicalRefs: extractTableRefs(normalized)
      .map((r) => r.table)
      .filter((t) => t && !SYSTEM_SCHEMAS.includes(String(t).toLowerCase())),
  };
}

/** 解析「数据项目」来源 */
async function resolveProject(id, tableType) {
  const project = await projects.getProject(Number(id));
  if (!project) return { invalid: `数据项目不存在（ID: ${id}）` };
  if (Number(project.status) !== 1) return { invalid: `数据项目「${project.name}」已停用` };
  if (Number(project.datasource_id || 0) !== 0) {
    return { invalid: `数据项目「${project.name}」使用外部数据源，V8 暂不支持跨数据源 AI 问数` };
  }
  const want = String(tableType || '').toLowerCase();
  const table = (want === 'data' || want === 'raw')
    ? (project.data_table || schema.makeTableName(project.id))
    : (project.parsed_table || schema.makeParsedTableName(project.id));
  const cols = await tableColumns(table);
  if (!cols) return { invalid: `数据项目「${project.name}」的数据表 ${table} 不存在` };
  const labels = await columnLabelMap(project.id);
  return {
    kind: 'project', id: project.id, name: project.name,
    table, datasourceId: 0,
    columns: decorateColumns(cols, labels),
    rowCount: await tableRowCount(table),
  };
}

/** 解析「邮箱推送项目」来源 */
async function resolveMail(id) {
  const row = await db.queryOne('SELECT * FROM jdywh_mail_projects WHERE id = ? LIMIT 1', [Number(id)]);
  if (!row) return { invalid: `邮箱推送项目不存在（ID: ${id}）` };
  if (Number(row.status) !== 1) return { invalid: `邮箱推送项目「${row.name}」已停用` };
  const table = String(row.data_table || '').trim();
  if (!table) return { invalid: `邮箱推送项目「${row.name}」尚未导入数据表` };
  const cols = await tableColumns(table);
  if (!cols) return { invalid: `邮箱推送项目「${row.name}」的数据表 ${table} 不存在（可能尚未导入）` };
  return {
    kind: 'mail', id: Number(row.id), name: row.name,
    table, datasourceId: 0,
    columns: decorateColumns(cols, {}),
    rowCount: await tableRowCount(table),
  };
}

/** 从流程定义里找 sink_table 节点（产出表） */
function flowSinkTable(flow) {
  let nodes = [];
  try {
    nodes = typeof flow.nodes === 'string' ? JSON.parse(flow.nodes) : (flow.nodes || []);
  } catch (_) {
    return null;
  }
  if (!Array.isArray(nodes)) return null;
  const sink = nodes.find((n) => n && n.type === 'sink_table' && n.config && n.config.table);
  return sink ? String(sink.config.table) : (flow.target_table || null);
}

/** 解析「处理流程产出表」来源 */
async function resolveFlow(id) {
  const flow = await db.queryOne('SELECT * FROM jdywh_flows WHERE id = ? LIMIT 1', [Number(id)]);
  if (!flow) return { invalid: `处理流程不存在（ID: ${id}）` };
  if (Number(flow.status) !== 1) return { invalid: `处理流程「${flow.name}」已停用` };
  const table = flowSinkTable(flow);
  if (!table) return { invalid: `处理流程「${flow.name}」没有产出表（未配置写入数据表节点）` };
  const cols = await tableColumns(table);
  if (!cols) return { invalid: `处理流程「${flow.name}」的产出表 ${table} 不存在（流程尚未运行过）` };
  return {
    kind: 'flow', id: Number(flow.id), name: flow.name,
    table, datasourceId: 0,
    columns: decorateColumns(cols, {}),
    rowCount: await tableRowCount(table),
  };
}

/** 解析单条 scope 项 → 统一对象（失败时带 invalid:true + reason） */
async function resolveOne(item) {
  const kind = String((item && item.kind) || '').trim().toLowerCase();
  const id = Number(item && item.id);
  const base = { kind, id, name: '', table: null, datasourceId: 0, columns: [], rowCount: 0 };
  if (!KIND_LABEL[kind]) {
    return Object.assign(base, { invalid: true, reason: `不支持的数据范围类型「${item && item.kind}」` });
  }
  if (!Number.isFinite(id) || id <= 0) {
    return Object.assign(base, { invalid: true, reason: `${KIND_LABEL[kind]} ID 不合法` });
  }

  let r;
  try {
    if (kind === 'dataset') r = await resolveDataset(id);
    else if (kind === 'project') r = await resolveProject(id, item.tableType);
    else if (kind === 'mail') r = await resolveMail(id);
    else r = await resolveFlow(id);
  } catch (err) {
    return Object.assign(base, { invalid: true, reason: `解析${KIND_LABEL[kind]}失败：${err.message}` });
  }

  if (!r || r.invalid) {
    return Object.assign(base, { invalid: true, reason: (r && r.invalid) || '解析失败' });
  }
  return Object.assign(base, r, {
    kind,
    id: Number(r.id || id),
    label: KIND_LABEL[kind],
    invalid: false,
  });
}

/* ══════════════════════════════════════════════════════════════════
 *  三、候选列表（scope-options）
 * ══════════════════════════════════════════════════════════════════ */

/** 供前端「数据范围」选择器使用的候选树（坏源标 invalid + reason） */
async function listScopeOptions() {
  const out = { datasets: [], projects: [], mails: [], flows: [] };

  // 数据集
  try {
    const list = await reports.listDatasets();
    for (const d of list) {
      const r = await resolveOne({ kind: 'dataset', id: d.id });
      out.datasets.push(toOption(r, d.name));
    }
  } catch (err) {
    out.datasetsError = err.message;
  }

  // 数据项目
  try {
    const rows = await db.query('SELECT id, name FROM jdywh_projects ORDER BY id');
    for (const p of rows) {
      const r = await resolveOne({ kind: 'project', id: p.id });
      out.projects.push(toOption(r, p.name));
    }
  } catch (err) {
    out.projectsError = err.message;
  }

  // 邮箱推送项目
  try {
    const rows = await db.query('SELECT id, name FROM jdywh_mail_projects ORDER BY id');
    for (const m of rows) {
      const r = await resolveOne({ kind: 'mail', id: m.id });
      out.mails.push(toOption(r, m.name));
    }
  } catch (err) {
    out.mailsError = err.message;
  }

  // 流程产出表
  try {
    const rows = await db.query('SELECT id, name FROM jdywh_flows ORDER BY id');
    for (const f of rows) {
      const r = await resolveOne({ kind: 'flow', id: f.id });
      out.flows.push(toOption(r, f.name));
    }
  } catch (err) {
    out.flowsError = err.message;
  }

  return out;
}

/** 统一候选条目结构（不回物理表名，避免前端把表名当契约依赖） */
function toOption(r, fallbackName) {
  const item = {
    kind: r.kind,
    id: r.id,
    name: r.name || fallbackName || '',
    rowCount: Number(r.rowCount || 0),
    columnCount: (r.columns || []).length,
    columns: (r.columns || []).slice(0, 200),
    invalid: !!r.invalid,
  };
  if (r.invalid) item.reason = r.reason || '数据源不可用';
  if (r.table) item.table = r.table;
  return item;
}

/* ══════════════════════════════════════════════════════════════════
 *  四、scope → 有效来源（含逻辑别名 / 去重 / 上限）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 解析并去重 scope。
 *
 * @param {Array<{kind:string,id:number,tableType?:string}>} scope
 * @param {{maxSources?:number}} [options]
 * @returns {Promise<{sources:Array, invalid:Array, dropped:Array}>}
 */
async function resolveScope(scope, options) {
  const opts = options || {};
  const list = Array.isArray(scope) ? scope : [];
  if (!list.length) {
    throw new Error('请先选择要问数的数据范围（数据集 / 数据项目 / 邮件推送 / 流程产出）');
  }

  const maxSources = Number.isFinite(Number(opts.maxSources))
    ? Number(opts.maxSources)
    : await settings.getInt('ai_scope_max_sources', 8);
  if (list.length > maxSources) {
    throw new Error(`一次最多选择 ${maxSources} 个数据范围，当前选了 ${list.length} 个`);
  }

  const sources = [];
  const invalid = [];
  const dropped = [];
  const seenTables = new Set();

  for (const item of list) {
    const r = await resolveOne(item);
    if (r.invalid) {
      invalid.push({ kind: r.kind, id: r.id, name: r.name, reason: r.reason });
      continue;
    }
    // 同一个物理表被多个来源指向（如数据集 22 与项目 16 的解析表）→ 只保留第一个
    if (r.table) {
      if (seenTables.has(r.table)) {
        dropped.push({ kind: r.kind, id: r.id, name: r.name, reason: `与已选范围指向同一张表（${r.table}），已自动合并` });
        continue;
      }
      seenTables.add(r.table);
    }
    sources.push(r);
  }

  if (!sources.length) {
    const why = invalid.map((i) => `${i.label || KIND_LABEL[i.kind] || i.kind}「${i.name || i.id}」：${i.reason}`);
    throw new Error('所选数据范围都不可用：' + (why.join('；') || '未知原因'));
  }

  // 分配逻辑表名：SQL 数据集用 ds_<id>，其它用 t1 / t2 / t3…
  let n = 0;
  sources.forEach((s) => {
    if (s.sqlAlias) {
      s.alias = s.sqlAlias;
    } else {
      n += 1;
      s.alias = `t${n}`;
    }
    s.label = KIND_LABEL[s.kind] || s.kind;
  });

  return { sources, invalid, dropped };
}

/* ══════════════════════════════════════════════════════════════════
 *  五、给模型的 schema 描述 + CTE 注入
 * ══════════════════════════════════════════════════════════════════ */

/** 生成给模型的 schema 文本（只用逻辑表名，绝不出现中文物理表名） */
function buildSchemaText(sources) {
  const blocks = [];
  (sources || []).forEach((s, idx) => {
    const cols = (s.columns || []).map((c) => {
      const label = c.label ? `（${c.label}）` : '';
      return `\`${c.name}\` ${c.type || ''}${label}`.trim();
    });
    blocks.push([
      `【${idx + 1}】${s.name}（${s.label || ''}，共 ${Number(s.rowCount || 0)} 行）`,
      `逻辑表名：${s.alias}`,
      `字段（共 ${(s.columns || []).length} 个）：`,
      cols.length ? cols.join('，') : '（无字段）',
    ].join('\n'));
  });
  return blocks.join('\n\n');
}

/**
 * 引用物理表名（MySQL 反引号）。
 * 本模块只处理本机库（datasource_id = 0，MySQL），跨数据源在解析阶段已被拒绝；
 * 因此固定用 MySQL 方言，避免引入异步的 datasources.getById()。
 */
function quoteName(table) {
  return dsMod.quoteIdentText('mysql', table);
}

/** 生成 CTE 前缀：t1 AS (SELECT * FROM `phys`), ds_42 AS (select ...) */
function buildCteList(sources) {
  return (sources || []).map((s) => {
    if (s.sqlAlias && s.sqlBody) {
      return `${quoteName(s.sqlAlias)} AS (${dsMod.trimSqlTail(s.sqlBody)})`;
    }
    /*
     * 【V8 修正】给 CTE 追加「中文业务名 → 物理列」别名列。
     *
     * 真实故障：`parsed_16` 的物理列名是 `widget_1791449342211` 这类匿名名，
     * 中文业务名（如「区域」）只存在于列注释里。我们虽然把「区域」写进了提示词，
     * 但模型（尤其中文模型）经常**直接把「区域」当列名**写进 SQL：
     *   SELECT `区域`, COUNT(*) FROM t1 GROUP BY `区域`
     * → MySQL 报 `Unknown column '区域'`（真机实测命中，属于「AI 问数不可用」的残留形态）。
     *
     * 与其反复提示模型，不如**让两种写法都能跑**：在 CTE 里把物理列再投影一份中文别名，
     * 于是 `区域` 与 `widget_1791449342211` 都是合法列名。
     * 仅在「中文名与已有物理列不重名」时才投影，避免 ambiguous column。
     */
    const phys = new Set((s.columns || []).map((c) => String(c.name)));
    const used = new Set(phys);
    const extras = [];
    (s.columns || []).forEach((c) => {
      const name = String(c.name);
      const label = c.label ? String(c.label).trim() : '';
      if (!label || label === name) return;
      if (used.has(label)) return; // 已有同名列：跳过，避免 ambiguous
      used.add(label);
      extras.push(`${quoteName(name)} AS ${quoteName(label)}`);
    });
    const inner = extras.length
      ? `SELECT *, ${extras.join(', ')} FROM ${quoteName(s.table)}`
      : `SELECT * FROM ${quoteName(s.table)}`;
    return `${quoteName(s.alias)} AS (${inner})`;
  }).join(',\n  ');
}

/**
 * 是否有「可投影的中文业务名」。
 *
 * 用途：`ai.js` 决定是否强制包裹 CTE。
 * 只要来源里存在「物理匿名列 + 中文业务名」，就必须包裹 ——
 * 否则模型一旦直接写物理表名（白名单允许），中文列名就无从解析。
 *
 * 注意：sql 型数据集（`sqlAlias/sqlBody`）**不计入**，因为它的列名本就是
 * 用户 SQL 的真实结果列名（多为中文），没有匿名列问题，且历史契约要求原样执行。
 */
function hasLabelAliases(sources) {
  return (sources || []).some((s) => {
    if (s.sqlAlias && s.sqlBody) return false;
    const phys = new Set((s.columns || []).map((c) => String(c.name)));
    const used = new Set(phys);
    for (const c of (s.columns || [])) {
      const name = String(c.name);
      const label = c.label ? String(c.label).trim() : '';
      if (!label || label === name) continue;
      if (used.has(label)) continue;
      return true;
    }
    return false;
  });
}

/**
 * 把模型 SQL 包进「逻辑表名 → 物理表」的 CTE 里。
 *
 * 模型 SQL 自己可能也以 WITH 开头（如 WITH x AS (...) SELECT ... FROM x），
 * 这时把我们的 CTE 插到它前面，而不是再包一层 WITH。
 */
function wrapSql(modelSql, sources) {
  const ctes = buildCteList(sources);
  const sql = dsMod.trimSqlTail(modelSql);
  if (!ctes) return sql;

  const m = sql.match(/^\s*with\s+(recursive\s+)?/i);
  if (m) {
    const rest = sql.slice(m[0].length);
    return `WITH ${m[1] ? 'RECURSIVE ' : ''}${ctes},\n  ${rest}`;
  }

  // 以括号开头的查询（(SELECT ...) UNION (SELECT ...)）无法直接前置 CTE
  if (/^\s*\(/.test(sql)) {
    return `WITH ${ctes}\nSELECT * FROM (${sql}) AS _v8_wrapped`;
  }
  return `WITH ${ctes}\n${sql}`;
}

/* ══════════════════════════════════════════════════════════════════
 *  六、SQL 表白名单校验
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 校验模型 SQL 只访问 scope 内的表。
 *
 * 放行集合 =
 *   scope 内物理表（s.table）
 *   ∪ 各来源的 physicalRefs（sql 型数据集自身源表，如 `zkcrm-ry`）
 *   ∪ 逻辑别名（s.alias / s.sqlAlias）
 *   ∪ 模型自己声明的 CTE 名
 *
 * 两条兜底：
 *   - 任何 `jdywh_` 前缀的标识符必须是**精确**放行集合内的表（堵逗号列表绕过、
 *     也堵「jdywh_mail_1 → jdywh_mail_19」这类前缀猜测）
 *   - 任何系统库名（information_schema / mysql / ...）一律拒绝
 *
 * 连字符宽容：`zkcrm-ry_not_exist` 这类「已放行表名 + '-' + 后缀」的引用视为
 * 「疑似同一张表写错」，放行到数据库层，由 MySQL 报出可读的「表不存在」错误
 * （比白名单报错更利于用户定位；不影响安全 —— 真实存在的其它表仍会被拦住）。
 *
 * @param {string} sql 模型生成的 SQL（未包裹 CTE 的原文）
 * @param {Array} sources resolveScope() 返回的来源数组
 * @returns {{refs:Array, allowed:string[], usesAlias:boolean}} 校验通过时返回解析结果
 */
function assertScopeOnly(sql, sources) {
  const list = sources || [];
  const physical = new Set();   // 精确放行的表名（用于 jdywh_ 前缀兜底）
  const aliases = new Set();
  list.forEach((s) => {
    if (s.table) physical.add(String(s.table));
    (s.physicalRefs || []).forEach((t) => physical.add(String(t)));
    if (s.alias) aliases.add(String(s.alias));
    if (s.sqlAlias) aliases.add(String(s.sqlAlias));
  });

  const cteNames = new Set(extractCteNames(sql).map((n) => String(n)));
  const allowed = new Set([...physical, ...aliases, ...cteNames]);
  // 小写索引：MySQL 在 Windows/部分配置下表名大小写不敏感，宽容匹配更实用
  const allowedLower = new Map();
  allowed.forEach((n) => allowedLower.set(String(n).toLowerCase(), String(n)));

  /** 该表引用是否放行 */
  const isAllowed = (name) => {
    const v = String(name || '');
    if (!v) return false;
    if (allowed.has(v)) return true;
    if (allowedLower.has(v.toLowerCase())) return true;
    const low = v.toLowerCase();
    // 连字符宽容：只对「必须加引号才能用的怪表名」（含连字符）生效。
    // 例：放行表名 zkcrm-ry，模型写了 zkcrm-ry_not_exist（多打个后缀）
    //  → 视为同一张表写错，放行到数据库层由 MySQL 报「表不存在」，比白名单报错更好定位。
    // 受保护前缀（jdywh_*）不适用，必须精确命中，避免猜测到别的业务表。
    if (PROTECTED_PREFIXES.some((p) => low.startsWith(p))) return false;
    for (const a of allowed) {
      const al = String(a).toLowerCase();
      if (!al.includes('-')) continue;
      if (!low.startsWith(al)) continue;
      const sep = low.charAt(al.length);
      if (sep === '-' || sep === '_') return true;
    }
    return false;
  };

  // 1) 系统库兜底（任何位置出现都拒绝）
  const idents = extractIdentifiers(sql);
  for (const name of idents) {
    const low = String(name).toLowerCase();
    if (SYSTEM_SCHEMAS.includes(low)) {
      throw new Error(`SQL 访问了系统库「${name}」，已拒绝执行（AI 问数只允许查询所选数据范围）`);
    }
  }

  // 2) FROM/JOIN 表引用必须在白名单内
  const refs = extractTableRefs(sql);
  for (const r of refs) {
    if (r.schema) {
      const low = String(r.schema).toLowerCase();
      if (SYSTEM_SCHEMAS.includes(low)) {
        throw new Error(`SQL 访问了系统库「${r.schema}」，已拒绝执行`);
      }
    }
    if (!isAllowed(r.table)) {
      throw new Error(
        `SQL 访问了数据范围之外的表「${r.table}」，已拒绝执行。`
        + `当前可用：${[...aliases].join('、') || '（无）'}`
      );
    }
  }

  // 3) 受保护前缀兜底：任何 jdywh_* 标识符必须是范围内的物理表（精确匹配）
  for (const name of idents) {
    const v = String(name);
    const low = v.toLowerCase();
    for (const p of PROTECTED_PREFIXES) {
      if (!low.startsWith(p)) continue;
      if (physical.has(v)) break;
      if (allowedLower.has(low) && !aliases.has(v)) break;   // 大小写差异的同一张表
      throw new Error(`SQL 访问了数据范围之外的表「${v}」，已拒绝执行`);
    }
  }

  const aliasSet = new Set([...aliases].map((a) => String(a)));
  const usesAlias = refs.some((r) => aliasSet.has(String(r.table)));
  return { refs, allowed: [...allowed], usesAlias };
}

module.exports = {
  SYSTEM_SCHEMAS,
  PROTECTED_PREFIXES,
  KIND_LABEL,
  // 词法工具（自测脚本直接复用）
  tokenize,
  extractTableRefs,
  extractCteNames,
  extractIdentifiers,
  // 解析
  resolveOne,
  resolveScope,
  listScopeOptions,
  tableColumns,
  tableRowCount,
  flowSinkTable,
  // 提示词与 SQL 组装
  buildSchemaText,
  buildCteList,
  hasLabelAliases,
  wrapSql,
  quoteName,
  // 校验
  assertScopeOnly,
};
