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

/**
 * 列对象补全类型元信息。
 *
 * V9 起多带 `dataType`（裸类型名，如 double / varchar / text）与 `maxLen`（声明长度）：
 * 值域采样要靠它们判断「这个列值不值得采样」（见下文第二节·补）。
 * 这两项是纯附加字段，历史调用方只读 name/type/label，不受影响。
 */
function decorateColumns(cols, labels) {
  return (cols || []).map((c) => {
    const rawType = String(c.type || c.dataType || '');
    const dataType = rawType.toLowerCase().replace(/\(.*$/, '').trim()
      || String(c.dataType || '').toLowerCase().trim();
    let maxLen = Number(c.maxLen || 0) || 0;
    if (!maxLen) {
      const m = rawType.match(/\((\d+)\)/);
      if (m) maxLen = Number(m[1]);
    }
    return {
      name: c.name,
      type: c.type || c.dataType || '',
      dataType,
      maxLen,
      label: labels[c.name] || c.comment || '',
    };
  });
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

/**
 * 解析单条 scope 项 → 统一对象（失败时带 invalid:true + reason）
 *
 * @param {{kind:string,id:number,tableType?:string}} item
 * @param {{sampleValues?:boolean}} [options]
 *        sampleValues 默认 **true**：解析成功后顺带做低基数列值域采样
 *        （问数必须先有值域，否则模型会按中文语义瞎猜数值编码列）。
 *        批量枚举场景（scope-options 列表、分享 meta）显式传 false 以省开销。
 */
async function resolveOne(item, options) {
  const opts = options || {};
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
  const merged = Object.assign(base, r, {
    kind,
    id: Number(r.id || id),
    label: KIND_LABEL[kind],
    invalid: false,
  });

  // V9：低基数列值域采样（自带超时与异常兜底，失败只是没有 values）
  if (opts.sampleValues !== false) {
    await sampleValueDomains(merged);
  }
  return merged;
}

/* ══════════════════════════════════════════════════════════════════
 *  二·补、低基数列值域采样（V9）
 *
 *  真实故障（V8 遗留）：`buildSchemaText` 只喂「列名(注释)」，**不给取值域**。
 *  `jdywh_parsed_16.sys_flow_state_2` 是 DOUBLE 存 0/1、注释却叫「流程状态」，
 *  模型只能按中文语义猜：
 *      WHERE sys_flow_state_2 = '2'              → 0 行（实际 0→93、1→4）
 *      WHERE flow_current_node = '流转完成'       → 0 行（该列存节点名）
 *      WHERE widget_1791533061604 = '流转完成'    → 0 行（该列也存节点名）
 *  同一张表还有「流程状态(节点)」「当前节点」两个注释相近、含义完全不同的列，
 *  模型无从区分该用哪个。
 *
 *  方案：对**低基数列**做一次轻量采样，把「取值 → 行数」写进
 *  `source.columns[i].values = [{v:'0',c:93},{v:'1',c:4}]`，
 *  提示词里显式写成「取值：0=进行中(93行)、1=流转完成(4行)」，模型就不必猜。
 *
 *  性能红线（每次问数都会跑 resolveScope）：
 *    · 只采样「distinct ≤ 24」的低基数列，整表行数 > 50 万直接跳过；
 *    · 每个来源最多 2 轮 SQL（非文本族一轮、文本族一轮），每轮「distinct 统计 + 取值分组」
 *      各 1 条语句 —— 单表只扫 2 次，不做 N 次往返；
 *    · 最多 40 个候选列，优先「状态/类型/结果/是否/节点/区域/级别/版本」；
 *    · 单条语句 1.2s、整体 2.5s 预算，超时或报错一律放弃采样。
 *    · **采样失败绝不抛出**：该列没有 values 而已，问数照常进行。
 * ══════════════════════════════════════════════════════════════════ */

/** 可采样列的数据类型白名单（值域只对这些类型有意义） */
const SAMPLE_TYPES = new Set([
  'int', 'bigint', 'smallint', 'tinyint', 'mediumint',
  'double', 'float', 'decimal', 'numeric',
  'varchar', 'char', 'enum', 'set',
  'text', 'tinytext',
]);

/** 文本族（TEXT/TINYTEXT）：取值可能很长，单独一轮，且只在小表上尝试 */
const SAMPLE_TEXT_TYPES = new Set(['text', 'tinytext']);

/** 声明长度上限：VARCHAR(255) 这类业务列要保留；TEXT/LONGTEXT 的 65535 不在其列 */
const SAMPLE_MAX_DECLARED_LEN = 255;
/** 单个取值渲染后的长度上限（有更长的取值即视为长文本列，整列不展开取值） */
const SAMPLE_MAX_VALUE_LEN = 64;
/** 只对低基数列采样 */
const SAMPLE_MAX_DISTINCT = 24;
/** 一轮最多采样列数 */
const SAMPLE_MAX_COLUMNS = 40;
/** 文本族最多采样列数 */
const SAMPLE_MAX_TEXT_COLUMNS = 12;
/** 行数超过此值不再做文本族采样 */
const SAMPLE_TEXT_MAX_ROWS = 50000;
/** 表行数超过此值整体不采样 */
const SAMPLE_MAX_ROWS = 500000;
/** 每列最多保留的取值个数 */
const SAMPLE_TOP_VALUES = 8;
/** 单条采样语句超时预算（ms） */
const SAMPLE_QUERY_TIMEOUT_MS = Math.max(300, Number(process.env.AI_SAMPLE_TIMEOUT_MS) || 1200);
/** 单次采样整体预算（ms）：超预算就放弃余下阶段 */
const SAMPLE_TOTAL_BUDGET_MS = Math.max(500, Number(process.env.AI_SAMPLE_BUDGET_MS) || 2500);
/** 值域优先关键词：业务上最常用来筛选/分组的列 */
const SAMPLE_PRIORITY_RE = /状态|类型|结果|是否|节点|区域|级别|版本/;
/** 采样时跳过的系统/超长列（浪费预算且无业务含义） */
const SAMPLE_SKIP_NAMES = new Set([
  'id', 'raw_json', 'jdy_data_id', 'jdy_op', 'jdy_op_time', 'jdy_form_name',
  'sys_app_id_2', 'sys_entry_id_2',
  'received_at', 'updated_at', 'created_at',
]);

/**
 * 取值里出现这些字符就不展开该列的取值域：
 *   \r\n\t  换行/制表符会破坏「一列一行」的提示词结构；
 *   、      是我们拼接多个取值的分隔符；
 *   =       是「取值=含义」的分隔符；
 *   ()      是行数的括号。
 * 出现这些字符说明该列是自由文本，本来也不适合当枚举用。
 */
const SAMPLE_VALUE_UNSAFE_RE = /[\r\n\t、=()]/;

/**
 * 已知枚举列的「取值 → 中文含义」字典（按**列名**匹配，与项目/表无关）。
 *
 * 简道云流程状态码是平台固定语义：0 进行中 / 1 已完成（流转完成）/ 2 已结束 / 3 已撤销。
 * 只在列名命中时补充含义，绝不按值瞎猜别的列。
 */
const KNOWN_ENUM_DICTS = [
  {
    match: (c) => /^sys_flow_state(_\d+)?$/i.test(String((c && c.name) || '')),
    meanings: { 0: '进行中', 1: '流转完成', 2: '已结束', 3: '已撤销' },
    note: '〔该列是流程状态码：1=流转完成（即「已完成/办结」），0=进行中（未完成）；'
      + '问「完成了流程 / 走完流程 / 已办结」请用 `该列 = 1`〕',
  },
];

/** 给 Promise 加超时兜底：超时后放弃等待（原查询仍在后台跑完，不影响主流程） */
function withTimeout(promise, ms, label) {
  let timer = null;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}超时（>${ms}ms）`)), ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, guard]).finally(() => { if (timer) clearTimeout(timer); });
}

/** 生成 MySQL 字符串字面量（只用于回显我们自己的列名，不拼接用户输入） */
function sqlTextLiteral(v) {
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/** 该列是否文本族 */
function isTextFamily(c) {
  return SAMPLE_TEXT_TYPES.has(String((c && c.dataType) || '').toLowerCase());
}

/**
 * 挑选值得采样的候选列（按优先级排序后截断）。
 * @param {Array} columns 已 decorate 的列
 * @param {number} rowCount 表行数
 * @returns {{core:Array, text:Array}}
 */
function pickSampleCandidates(columns, rowCount) {
  const rows = Number(rowCount || 0);
  const picked = [];
  (columns || []).forEach((c) => {
    const name = String((c && c.name) || '');
    if (!name || SAMPLE_SKIP_NAMES.has(name)) return;
    const dt = String((c.dataType || c.type) || '').toLowerCase().replace(/\(.*$/, '').trim();
    if (!SAMPLE_TYPES.has(dt)) return;
    const maxLen = Number(c.maxLen || 0);
    if (SAMPLE_TEXT_TYPES.has(dt)) {
      // 文本族：只在小表上尝试；取值是否过长由 SAMPLE_MAX_VALUE_LEN 兜住
      if (rows > SAMPLE_TEXT_MAX_ROWS) return;
    } else if (maxLen && maxLen > SAMPLE_MAX_DECLARED_LEN) {
      return;
    }
    picked.push(c);
  });

  const hit = (c) => SAMPLE_PRIORITY_RE.test(`${c.name || ''} ${c.label || ''}`);
  const ordered = picked.filter(hit).concat(picked.filter((c) => !hit(c)));
  return {
    core: ordered.filter((c) => !isTextFamily(c)).slice(0, SAMPLE_MAX_COLUMNS),
    text: ordered.filter(isTextFamily).slice(0, SAMPLE_MAX_TEXT_COLUMNS),
  };
}

/**
 * 对一组候选列采样取值域：一轮 distinct 统计 + 一轮分组取值，共 2 条 SQL。
 *
 * @param {string} table 物理表名
 * @param {Array} candidates 候选列
 * @param {object} stat 采样统计（累加）
 * @param {number} deadline 整体截止时间戳（ms）
 */
async function fillValueDomains(table, candidates, stat, deadline) {
  const list = (candidates || []).filter((c) => c && c.name);
  if (!list.length) return;
  const quoted = quoteName(table);
  const remain = () => deadline - Date.now();
  if (remain() < 150) {
    if (!stat.reason) stat.reason = '采样预算不足，已跳过部分列';
    return;
  }

  // 1) 一条语句拿到全部候选列的 distinct 数（单次扫描，避免逐列往返）
  let distinctRow = null;
  try {
    const exprs = list.map((c, i) => `COUNT(DISTINCT ${quoteName(c.name)}) AS d${i}`);
    distinctRow = await withTimeout(
      db.queryOne(`SELECT ${exprs.join(', ')} FROM ${quoted}`),
      Math.min(SAMPLE_QUERY_TIMEOUT_MS, remain()),
      '值域 distinct 统计'
    );
  } catch (err) {
    stat.errors.push(err.message);
    return;
  }

  const low = list.filter((c, i) => {
    const n = Number((distinctRow && distinctRow[`d${i}`]) || 0);
    return n > 0 && n <= SAMPLE_MAX_DISTINCT;
  });
  if (!low.length) return;

  // 2) 一条 UNION ALL 取回各低基数列的 top 取值（每个分支独立 GROUP BY + ORDER BY + LIMIT）
  let valueRows = [];
  try {
    const branches = low.map((c) => {
      const q = quoteName(c.name);
      return `(SELECT ${sqlTextLiteral(c.name)} AS vcol, ${q} AS vval, COUNT(*) AS vcnt
                 FROM ${quoted} GROUP BY ${q} ORDER BY vcnt DESC, vval ASC LIMIT ${SAMPLE_TOP_VALUES})`;
    });
    valueRows = await withTimeout(
      db.query(branches.join('\nUNION ALL\n')),
      Math.min(SAMPLE_QUERY_TIMEOUT_MS, remain()),
      '值域取值采样'
    );
  } catch (err) {
    stat.errors.push(err.message);
    return;
  }

  const buckets = new Map();
  (valueRows || []).forEach((r) => {
    const key = String(r.vcol);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  });

  low.forEach((c) => {
    const got = buckets.get(String(c.name)) || [];
    if (!got.length) return;
    const raws = got.map((r) => (r.vval === null || r.vval === undefined ? null : String(r.vval)));
    // 全空列（如「是否开通」97 行都是空）没有信息量，不展开
    if (raws.every((v) => v === null || v === '')) return;
    // 长文本 / 自由文本列：取值超长或含会破坏提示词结构的字符 → 整列不展开
    if (raws.some((v) => v !== null && v.length > SAMPLE_MAX_VALUE_LEN)) return;
    if (raws.some((v) => v !== null && SAMPLE_VALUE_UNSAFE_RE.test(v))) return;
    /*
     * NULL 与空串在提示词里都渲染成「(空)」，必须合并成一条，
     * 否则会出现「(空)(48行)、(空)(40行)」这种模型无法理解的重复取值。
     */
    const acc = new Map();
    raws.forEach((v, i) => {
      const key = v === null || v === '' ? '(空)' : v;
      acc.set(key, (acc.get(key) || 0) + Number(got[i].vcnt || 0));
    });
    const values = [...acc.entries()].map(([v, c2]) => ({ v, c: c2 }));
    c.values = values;           // eslint-disable-line no-param-reassign
    stat.columns += 1;
    stat.values += values.length;
  });
}

/**
 * 给一个已解析来源采样低基数列值域（结果写回 source.columns[i].values）。
 *
 * **绝不抛出**：任何异常/超时都只让该来源「没有值域」，不影响问数。
 *
 * @param {object} source resolveOne 解析出的来源对象
 * @returns {Promise<{table:string,columns:number,values:number,ms:number,reason:string,errors:string[]}>}
 */
async function sampleValueDomains(source) {
  const started = Date.now();
  const stat = { table: '', columns: 0, values: 0, ms: 0, reason: '', errors: [] };
  try {
    if (!source || source.invalid || !source.table) return stat;
    stat.table = String(source.table);
    const columns = Array.isArray(source.columns) ? source.columns : [];
    const rowCount = Number(source.rowCount || 0);
    if (!columns.length || rowCount <= 0) return stat;
    if (rowCount > SAMPLE_MAX_ROWS) {
      stat.reason = `表行数 ${rowCount} 超过 ${SAMPLE_MAX_ROWS}，跳过值域采样`;
      return stat;
    }
    const { core, text } = pickSampleCandidates(columns, rowCount);
    const deadline = started + SAMPLE_TOTAL_BUDGET_MS;
    await fillValueDomains(source.table, core, stat, deadline);
    await fillValueDomains(source.table, text, stat, deadline);
  } catch (err) {
    stat.reason = String((err && err.message) || err);
  } finally {
    stat.ms = Date.now() - started;
    if (source && typeof source === 'object') source.valueDomain = stat;
  }
  return stat;
}

/** 取某列某取值的业务含义（无字典命中返回空串，绝不臆造） */
function enumMeaningOf(column, value) {
  const key = value === null || value === undefined ? '' : String(value);
  if (!key) return '';
  for (const d of KNOWN_ENUM_DICTS) {
    if (!d.match(column)) continue;
    return d.meanings[key] || '';
  }
  return '';
}

/** 该列是否「数值编码列」：数值类型 + 中文注释 + 取值全是数字 */
function isNumericCodedColumn(column) {
  const dt = String((column && (column.dataType || column.type)) || '').toLowerCase().replace(/\(.*$/, '').trim();
  if (!['int', 'bigint', 'smallint', 'tinyint', 'mediumint',
    'double', 'float', 'decimal', 'numeric'].includes(dt)) return false;
  if (!/[\u4e00-\u9fa5]/.test(String(column.label || ''))) return false;
  const values = Array.isArray(column.values) ? column.values : [];
  if (!values.length) return false;
  return values.every((it) => it.v === null || /^-?\d+(\.\d+)?$/.test(String(it.v)));
}

/** 「取值：0=进行中(93行)、1=流转完成(4行)」 */
function formatValueDomain(column) {
  const values = Array.isArray(column.values) ? column.values : [];
  if (!values.length) return '';
  const parts = values.map((it) => {
    const raw = it.v === null || it.v === '' ? '(空)' : String(it.v);
    const meaning = enumMeaningOf(column, it.v);
    const cnt = it.c ? `(${it.c}行)` : '';
    return meaning ? `${raw}=${meaning}${cnt}` : `${raw}${cnt}`;
  });
  return `取值：${parts.join('、')}`;
}

/** 单列描述：列名 + 类型 + 注释 + 取值域 + 数值编码提示 + 已知枚举说明 */
function describeColumn(column) {
  const label = column.label ? `（${column.label}）` : '';
  let line = `\`${column.name}\` ${column.type || ''}${label}`.trim();
  const domain = formatValueDomain(column);
  if (domain) line += ` ${domain}`;
  if (isNumericCodedColumn(column)) {
    line += ' 〔数值编码列：只能与数值比较（如 = 1），不能用中文文本比较〕';
  }
  for (const d of KNOWN_ENUM_DICTS) {
    if (d.note && d.match(column)) line += ` ${d.note}`;
  }
  return line;
}

/**
 * 找出「注释近似但含义不同」的列组，用于提示词里的并列展示。
 *
 * 判定：把注释里的括号段拆出来，**去掉括号后相同**即同族
 * （`流程状态` / `流程状态(节点)`、`优惠券` / `优惠券(结果)`）。
 * 然后只保留**真正会造成误用**的族，条件全部满足：
 *   1. 成员至少有 2 个「显示注释不同」（纯同名重复不算）；
 *   2. 不带 `(解析)` 后缀（解析列是同一字段的加工副本，规则 4 已够，列出来只是噪音）；
 *   3. 每个成员都采样到了值域，且成员之间「类型不同 或 取值集合不同」
 *      —— 值域一样的同义列不构成歧义；
 *   4. 总组数 ≤ 6、每组 ≤ 4 列，避免撑爆提示词。
 *
 * @param {Array} columns
 * @returns {Array<Array>} 列组
 */
function similarLabelGroups(columns) {
  const cap = (arr, n) => arr.slice(0, n);
  /** 注释 → {base, tag}：base 是去掉全部括号段的部分，tag 是括号段拼接 */
  const split = (label) => {
    const s = String(label || '');
    const tags = [];
    const base = s.replace(/[（(]([^（）()]*)[)）]/g, (_, inner) => {
      tags.push(String(inner).trim());
      return '';
    }).trim();
    return { base, tag: tags.join('/') };
  };

  const fams = new Map();
  (columns || []).forEach((c) => {
    const label = String((c && c.label) || '').trim();
    if (!label) return;
    if (/(解析)$/.test(label)) return;                 // 解析列不进歧义组
    const { base, tag } = split(label);
    if (!base || base.length < 2) return;
    if (!fams.has(base)) fams.set(base, []);
    fams.get(base).push({ col: c, label, tag });
  });

  const signature = (c) => JSON.stringify([
    String(c.dataType || c.type || '').toLowerCase(),
    (Array.isArray(c.values) ? c.values : []).map((it) => `${it.v}:${it.c}`).sort(),
  ]);

  const groups = [];
  fams.forEach((members) => {
    if (members.length < 2) return;
    // 「显示注释不同」才算同族内的歧义
    if (new Set(members.map((m) => m.label)).size < 2) return;
    const cols = members.map((m) => m.col);
    // 必须全部采到值域，否则无从证明它们含义不同（宁可不出提示）
    if (cols.some((c) => !Array.isArray(c.values) || !c.values.length)) return;
    if (new Set(cols.map(signature)).size < 2) return;   // 类型与取值都一样 → 同义列
    groups.push(cap(cols, 4));
  });

  // 组大的优先（成员越多歧义越强），再按首列在表里的顺序稳定排序
  const order = new Map((columns || []).map((c, i) => [String(c.name), i]));
  groups.sort((a, b) => (b.length - a.length) || (order.get(String(a[0].name)) - order.get(String(b[0].name))));
  return cap(groups, 6);
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
      const r = await resolveOne({ kind: 'dataset', id: d.id }, { sampleValues: false });
      out.datasets.push(toOption(r, d.name));
    }
  } catch (err) {
    out.datasetsError = err.message;
  }

  // 数据项目
  try {
    const rows = await db.query('SELECT id, name FROM jdywh_projects ORDER BY id');
    for (const p of rows) {
      const r = await resolveOne({ kind: 'project', id: p.id }, { sampleValues: false });
      out.projects.push(toOption(r, p.name));
    }
  } catch (err) {
    out.projectsError = err.message;
  }

  // 邮箱推送项目
  try {
    const rows = await db.query('SELECT id, name FROM jdywh_mail_projects ORDER BY id');
    for (const m of rows) {
      const r = await resolveOne({ kind: 'mail', id: m.id }, { sampleValues: false });
      out.mails.push(toOption(r, m.name));
    }
  } catch (err) {
    out.mailsError = err.message;
  }

  // 流程产出表
  try {
    const rows = await db.query('SELECT id, name FROM jdywh_flows ORDER BY id');
    for (const f of rows) {
      const r = await resolveOne({ kind: 'flow', id: f.id }, { sampleValues: false });
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
 * @param {{maxSources?:number, sampleValues?:boolean}} [options]
 *        sampleValues 默认 true（问数要先有值域）；显式 false 可跳过采样。
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
    const r = await resolveOne(item, { sampleValues: opts.sampleValues !== false });
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

/**
 * 生成给模型的 schema 文本（只用逻辑表名，绝不出现中文物理表名）。
 *
 * V9 变化（这是本次「已完成流程的客户数查成 0」的根因修复）：
 *   1. 每列独占一行，并在**有值域**时追加「取值：0=进行中(93行)、1=流转完成(4行)」；
 *   2. 数值类型 + 中文注释的列标注「数值编码列」，明确禁止用中文文本比较；
 *   3. 注释相近的列（`流程状态` / `流程状态(节点)`）在「近似列提醒」里**并列展示且各自带值域**。
 */
function buildSchemaText(sources) {
  const blocks = [];
  (sources || []).forEach((s, idx) => {
    const columns = s.columns || [];
    const lines = columns.map((c) => `- ${describeColumn(c)}`);
    const block = [
      `【${idx + 1}】${s.name}（${s.label || ''}，共 ${Number(s.rowCount || 0)} 行）`,
      `逻辑表名：${s.alias}`,
      `字段（共 ${columns.length} 个）：`,
      lines.length ? lines.join('\n') : '（无字段）',
    ];

    // 同名/近似列提醒：并列展示 + 各自带值域，让模型能区分该用哪一列
    const groups = similarLabelGroups(columns);
    if (groups.length) {
      block.push('');
      block.push('近似列提醒（以下列注释相近但含义不同，必须按列名与取值选择正确的一列，不得混用）：');
      groups.forEach((g) => {
        block.push(`· ${g.map((c) => describeColumn(c)).join('  ‖  ')}`);
      });
    }

    blocks.push(block.join('\n'));
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
  // 值域采样（V9；自测脚本直接复用）
  sampleValueDomains,
  pickSampleCandidates,
  formatValueDomain,
  describeColumn,
  similarLabelGroups,
  isNumericCodedColumn,
  enumMeaningOf,
  KNOWN_ENUM_DICTS,
  SAMPLE_TYPES,
  SAMPLE_MAX_DISTINCT,
  SAMPLE_MAX_COLUMNS,
  SAMPLE_MAX_VALUE_LEN,
  SAMPLE_TOP_VALUES,
  SAMPLE_MAX_ROWS,
  // 校验
  assertScopeOnly,
};
