'use strict';

const crypto = require('crypto');
const db = require('./db');
const ds = require('./datasource');
const datasources = require('./datasources');
const schema = require('./schema');
const projects = require('./projects');

/**
 * 数据集与报表（BI）
 *
 * 数据集来源：
 *   sql     —— 在指定数据源上执行 SQL
 *   table   —— 直接读取某张表
 *   project —— 读取推送项目的数据表（原始表或解析表）
 */

/* ══════════ 数据集 ══════════ */

function safeJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (_) { return null; }
}

function publicDataset(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    name: r.name,
    code: r.code,
    description: r.description || '',
    datasourceId: Number(r.datasource_id || 0),
    sourceType: r.source_type,
    sourceSql: r.source_sql || '',
    sourceTable: r.source_table || '',
    projectId: r.project_id ? Number(r.project_id) : null,
    fields: safeJson(r.fields) || [],
    cacheTtl: Number(r.cache_ttl || 0),
    status: Number(r.status),
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function uniqueCode(table, base, column) {
  let code = String(base || 'ds').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'ds';
  if (/^[0-9]/.test(code)) code = 'd_' + code;
  code = code.slice(0, 48);
  let candidate = code;
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const row = await db.queryOne(`SELECT id FROM ${table} WHERE ${column} = ? LIMIT 1`, [candidate]);
    if (!row) return candidate;
    i += 1;
    candidate = `${code}_${i}`;
    if (i > 500) return `${code}_${crypto.randomBytes(3).toString('hex')}`;
  }
}

async function listDatasets(keyword) {
  const kw = String(keyword || '').trim();
  let sql = `SELECT d.*, ds.name AS datasource_name, p.name AS project_name
               FROM jdywh_datasets d
               LEFT JOIN jdywh_datasources ds ON ds.id = d.datasource_id
               LEFT JOIN jdywh_projects p ON p.id = d.project_id`;
  const params = [];
  if (kw) {
    sql += ' WHERE d.name LIKE ? OR d.code LIKE ? OR d.description LIKE ?';
    params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
  }
  sql += ' ORDER BY d.id DESC';
  const rows = await db.query(sql, params);
  return rows.map((r) => Object.assign(publicDataset(r), {
    datasourceName: r.datasource_name || (Number(r.datasource_id) === 0 ? '本机数据库' : ''),
    projectName: r.project_name || '',
  }));
}

async function getDataset(id) {
  const row = await db.queryOne('SELECT * FROM jdywh_datasets WHERE id = ? LIMIT 1', [id]);
  return publicDataset(row);
}

async function createDataset(input, userId) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('数据集名称不能为空');
  const sourceType = ['sql', 'table', 'project'].includes(input.sourceType) ? input.sourceType : 'sql';

  if (sourceType === 'sql' && !String(input.sourceSql || '').trim()) {
    throw new Error('SQL 数据集必须填写查询语句');
  }
  if (sourceType === 'table' && !String(input.sourceTable || '').trim()) {
    throw new Error('表数据集必须选择数据表');
  }
  if (sourceType === 'project' && !input.projectId) {
    throw new Error('项目数据集必须选择项目');
  }

  const code = await uniqueCode('jdywh_datasets', input.code || name, 'code');
  // 保存前预校验：SQL 写错（语法/表/字段不存在）直接给结构化中文错误
  await precheckDatasetSql({
    sourceType,
    sourceSql: input.sourceSql,
    datasourceId: input.datasourceId,
  });
  const result = await db.query(
    `INSERT INTO jdywh_datasets
       (name, code, description, datasource_id, source_type, source_sql, source_table,
        project_id, fields, cache_ttl, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      name, code,
      String(input.description || '').trim() || null,
      Number(input.datasourceId) || 0,
      sourceType,
      input.sourceSql || null,
      input.sourceTable || null,
      input.projectId ? Number(input.projectId) : null,
      input.fields ? JSON.stringify(input.fields) : null,
      Number(input.cacheTtl) || 0,
      input.status === 0 ? 0 : 1,
      userId || null,
    ]
  );
  return getDataset(result.insertId);
}

async function updateDataset(id, input) {
  const row = await db.queryOne('SELECT * FROM jdywh_datasets WHERE id = ? LIMIT 1', [id]);
  if (!row) throw new Error('数据集不存在');

  const fields = [];
  const params = [];
  const set = (c, v) => { fields.push(`${c} = ?`); params.push(v); };

  if (input.name !== undefined) set('name', String(input.name).trim());
  if (input.description !== undefined) set('description', String(input.description || '').trim() || null);
  if (input.datasourceId !== undefined) set('datasource_id', Number(input.datasourceId) || 0);
  if (input.sourceType !== undefined && ['sql', 'table', 'project'].includes(input.sourceType)) {
    set('source_type', input.sourceType);
  }
  if (input.sourceSql !== undefined) set('source_sql', input.sourceSql || null);
  if (input.sourceTable !== undefined) set('source_table', input.sourceTable || null);
  if (input.projectId !== undefined) set('project_id', input.projectId ? Number(input.projectId) : null);
  if (input.fields !== undefined) set('fields', input.fields ? JSON.stringify(input.fields) : null);
  if (input.cacheTtl !== undefined) set('cache_ttl', Number(input.cacheTtl) || 0);
  if (input.status !== undefined) set('status', Number(input.status) ? 1 : 0);

  if (!fields.length) return getDataset(id);

  // 改了 SQL / 来源类型时同样先预校验（SQL 写错就别写库）
  const nextType = input.sourceType !== undefined ? input.sourceType : row.source_type;
  const nextSql = input.sourceSql !== undefined ? input.sourceSql : row.source_sql;
  const nextDsId = input.datasourceId !== undefined ? input.datasourceId : row.datasource_id;
  if (nextType === 'sql' && (input.sourceSql !== undefined || input.sourceType !== undefined)) {
    await precheckDatasetSql({ sourceType: nextType, sourceSql: nextSql, datasourceId: nextDsId });
  }

  params.push(id);
  await db.query(`UPDATE jdywh_datasets SET ${fields.join(', ')} WHERE id = ?`, params);
  return getDataset(id);
}

async function deleteDataset(id) {
  const used = await db.queryOne('SELECT COUNT(*) AS c FROM jdywh_reports WHERE dataset_id = ?', [id]);
  if (used && Number(used.c) > 0) {
    throw new Error(`该数据集被 ${used.c} 个报表使用，请先删除或改绑这些报表`);
  }
  await db.query('DELETE FROM jdywh_datasets WHERE id = ?', [id]);
  return true;
}

/** 构建数据集查询（返回 {ds, sql, params}） */
async function buildQuery(dataset, limit) {
  const source = await datasources.getById(dataset.datasourceId);
  if (!source) throw new Error('数据源不存在或已删除');

  const maxRows = Math.min(Number(limit) || 1000, 10000);

  if (dataset.sourceType === 'project') {
    const project = await projects.getProject(dataset.projectId);
    if (!project) {
      throw new Error(`数据集「${dataset.name}」关联的项目已不存在（项目ID: ${dataset.projectId}），请重新选择项目或删除该数据集`);
    }
    const table = dataset.sourceTable === 'parsed'
      ? (project.parsed_table || schema.makeParsedTableName(project.id))
      : (project.data_table || schema.makeTableName(project.id));
    return {
      ds: source,
      sql: `SELECT * FROM ${ds.quoteIdent(source, table)}`,
      params: [],
      limit: maxRows,
    };
  }

  if (dataset.sourceType === 'table') {
    if (!dataset.sourceTable) {
      throw new Error(`数据集「${dataset.name}」未指定数据表`);
    }
    return {
      ds: source,
      sql: `SELECT * FROM ${ds.quoteIdent(source, dataset.sourceTable)}`,
      params: [],
      limit: maxRows,
    };
  }

  // SQL 数据集：仅允许只读查询
  const originalSql = ds.trimSqlTail(dataset.sourceSql);
  const safeSql = assertReadOnly(originalSql);
  // 词法级补引号：修复 `select * from zkcrm-ry` 这类含连字符/中文/保留字的表名
  const sql = ds.normalizeSql(source, safeSql);
  return { ds: source, sql, params: [], limit: maxRows, originalSql, normalizedSql: sql };
}

/**
 * SQL 安全校验：只允许单条 SELECT / WITH 查询
 *
 * 返回去掉尾部空语句分号的 SQL，调用方据此继续做标识符补引号与分页。
 *
 * 判定在「剥掉注释与字符串字面量」的骨架上进行，
 * 否则 `WHERE remark = 'please update it'` 这类合法查询会被误杀；
 * 同时支持 `WITH ...`、`WITH RECURSIVE ...` 与 `(SELECT ...) UNION (...)` 写法。
 */
function assertReadOnly(sql) {
  const raw = String(sql == null ? '' : sql).trim();
  if (!raw) throw new Error('SQL 不能为空');

  const body = stripLiteralsAndComments(raw);
  const withoutTrailing = stripLiteralsAndComments(ds.trimSqlTail(raw));
  if (withoutTrailing.includes(';')) {
    throw new Error('只允许执行单条查询语句（不允许分号分隔的多条语句）');
  }
  if (!/^[\s(]*(select|with)\b/i.test(body)) {
    throw new Error('只允许 SELECT / WITH 查询语句');
  }

  const forbidden = /\b(insert|update|delete|drop|truncate|alter|create|replace|grant|revoke|rename|call|exec|execute|load_file|outfile|dumpfile|lock|unlock|handler|prepare|deallocate|do)\b/i;
  const hit = body.match(forbidden);
  if (hit) {
    throw new Error(`查询语句包含不允许的关键字「${String(hit[1]).toUpperCase()}」（仅支持只读查询）`);
  }
  if (/\binto\s+(outfile|dumpfile)\b/i.test(body)) {
    throw new Error('查询语句包含不允许的导出子句（仅支持只读查询）');
  }
  return ds.trimSqlTail(raw);
}

/**
 * 剥掉注释与字符串字面量，只留 SQL 结构骨架（关键字、括号、运算符）。
 * 用于关键字安全检查，避免字符串内容误触发。
 */
function stripLiteralsAndComments(sql) {
  const s = String(sql || '');
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '-' && s[i + 1] === '-') {
      while (i < s.length && s[i] !== '\n') i += 1;
      out += ' ';
      continue;
    }
    if (ch === '#' ) {
      while (i < s.length && s[i] !== '\n') i += 1;
      out += ' ';
      continue;
    }
    if (ch === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end < 0 ? s.length : end + 2;
      out += ' ';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === ch) {
          if (s[j + 1] === ch) { j += 2; continue; }
          break;
        }
        j += 1;
      }
      out += ch === '`' ? ' ident ' : " 'str' ";
      i = j + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * 执行临时 SQL（数据集设计器 test-sql 与 AI 问数共用同一条链路）
 *
 * 统一顺序：去尾分号 → 只读校验 → 标识符补引号 → 分页 → 执行；
 * 执行失败抛出带 code / errno / sqlMessage / sql / originalSql / hint 的中文结构化错误。
 */
async function testSql(input) {
  const body = input || {};
  const source = await datasources.getById(body.datasourceId || 0);
  if (!source) throw new Error('数据源不存在或已删除');

  const originalSql = ds.trimSqlTail(body.sql);
  const safeSql = assertReadOnly(originalSql);
  const normalizedSql = ds.normalizeSql(source, safeSql);
  const limit = Math.min(Number(body.limit) || 50, 1000);
  const sql = ds.paginate(source, normalizedSql, limit, 0);

  const started = Date.now();
  let rows;
  try {
    rows = await ds.query(source, sql, []);
  } catch (err) {
    throw ds.describeDbError(source, err, sql, originalSql, normalizedSql);
  }

  return {
    rows,
    columns: rows.length ? Object.keys(rows[0]).map((k) => ({ name: k, type: typeof rows[0][k] })) : [],
    rowCount: rows.length,
    elapsed: Date.now() - started,
    sql,
    originalSql,
    normalizedSql,
    autoQuoted: originalSql.trim() !== normalizedSql.trim(),
  };
}

/** 保存数据集时做的 SQL 预校验：语法/表/字段错误直接拦住，连接类错误放行 */
async function validateDatasetSql(input) {
  if (input.sourceType !== 'sql') return null;
  const sqlText = ds.trimSqlTail(input.sourceSql);
  if (!sqlText) return null;
  return testSql({ datasourceId: input.datasourceId || 0, sql: sqlText, limit: 1 });
}

/** 这些错误说明 SQL 本身有问题，保存时就该拦住；其余（网络/超时）放行 */
const BLOCKING_DB_CODES = [
  'ER_PARSE_ERROR', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR',
  'ER_TABLEACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_NO_DB_ERROR',
];

/**
 * 保存前的预校验包装：只有「SQL 本身有问题」才阻断保存。
 * 数据源暂时连不上时不阻断，避免用户存不了数据集。
 */
async function precheckDatasetSql(input) {
  try {
    return await validateDatasetSql(input);
  } catch (err) {
    if (err && err.isDbError && BLOCKING_DB_CODES.indexOf(err.code) < 0) return null;
    throw err;
  }
}

/** 执行数据集查询 */
async function runDataset(id, options) {
  const opts = options || {};
  const dataset = await getDataset(id);
  if (!dataset) throw new Error('数据集不存在');
  if (!dataset.status) throw new Error('数据集已停用');

  const q = await buildQuery(dataset, opts.limit);
  const sql = ds.paginate(q.ds, q.sql, q.limit, 0);

  const started = Date.now();
  let rows;
  try {
    rows = await ds.query(q.ds, sql, q.params);
  } catch (err) {
    throw ds.describeDbError(q.ds, err, sql, q.originalSql || q.sql, q.normalizedSql || q.sql);
  }
  const elapsed = Date.now() - started;

  const columns = rows.length ? Object.keys(rows[0]).map((k) => ({
    name: k,
    type: typeof rows[0][k],
  })) : [];

  return {
    rows,
    columns,
    rowCount: rows.length,
    elapsed,
    sql,
    originalSql: q.originalSql || q.sql,
    datasourceName: dataset.datasourceId === 0 ? '本机数据库' : String(dataset.datasourceId),
  };
}

/** 预览数据集（限制行数） */
async function previewDataset(id, limit) {
  return runDataset(id, { limit: limit || 50 });
}

/** 推断字段元数据（用于报表配置） */
async function inferFields(id) {
  const r = await runDataset(id, { limit: 1 });
  return r.columns;
}

/* ══════════ 报表 ══════════ */

const CHART_TYPES = [
  { key: 'table', name: '数据表格', group: '基础' },
  { key: 'bar', name: '柱状图', group: '基础' },
  { key: 'line', name: '折线图', group: '基础' },
  { key: 'area', name: '面积图', group: '基础' },
  { key: 'pie', name: '饼图', group: '基础' },
  { key: 'doughnut', name: '环形图', group: '基础' },
  { key: 'scatter', name: '散点图', group: '基础' },
  { key: 'radar', name: '雷达图', group: '基础' },
  { key: 'funnel', name: '漏斗图', group: '基础' },
  { key: 'gauge', name: '仪表盘', group: '基础' },
  { key: 'number', name: '指标卡', group: '基础' },
  { key: 'map', name: '地图', group: '基础' },
  /* ── 看板专用组件 ── */
  { key: 'kpi', name: 'KPI 大数字卡', group: '看板' },
  { key: 'kpiSplit', name: 'KPI 分区卡', group: '看板' },
  { key: 'donutLegend', name: '环形图+图例', group: '看板' },
  { key: 'semi', name: '半环进度', group: '看板' },
  { key: 'progress', name: '进度条组', group: '看板' },
  { key: 'rank', name: '排行榜', group: '看板' },
  { key: 'flowmap', name: '流程分布', group: '看板' },
  { key: 'trendBar', name: '趋势柱状', group: '看板' },
  { key: 'ingList', name: '进行中列表', group: '看板' },
  { key: 'detailTable', name: '明细表（含筛选）', group: '看板' },
];

/** 看板布局：栅格行定义 */
const DASHBOARD_ROWS = [
  { key: 'r1', name: '第一行（KPI 卡组）', cols: 5 },
  { key: 'r2', name: '第二行（2:1 分栏）', cols: 2 },
  { key: 'r3', name: '第三行（三栏）', cols: 3 },
  { key: 'r4', name: '第四行（整行）', cols: 1 },
];

/** 看板主题色板（对齐参考看板） */
const DASHBOARD_THEME = {
  brand: '#2D6FE4',
  brand2: '#3687FF',
  brand3: '#45B4FF',
  green: '#A2D73C',
  green2: '#73DBFF',
  cyan: '#003378',
  warn: '#FFC000',
  danger: '#E86161',
  purple: '#EC673C',
  pink: '#B5B5B6',
};

function publicReport(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    name: r.name,
    code: r.code,
    description: r.description || '',
    category: r.category || '',
    reportType: r.report_type,
    datasetId: r.dataset_id ? Number(r.dataset_id) : null,
    config: safeJson(r.config) || {},
    layout: safeJson(r.layout) || null,
    icon: r.icon || '',
    tags: r.tags || '',
    group: r.group_name || r.category || '',
    source: r.source || 'user',
    boardKey: r.board_key || null,
    dsl: r.dsl || '',
    status: Number(r.status),
    createdBy: r.created_by,
    viewCount: Number(r.view_count || 0),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function listReports(keyword) {
  const kw = String(keyword || '').trim();
  let sql = `SELECT r.*, d.name AS dataset_name,
               (SELECT COUNT(*) FROM jdywh_shares s WHERE s.target_type='report' AND s.target_id=r.id AND s.status=1) AS share_count
               FROM jdywh_reports r
               LEFT JOIN jdywh_datasets d ON d.id = r.dataset_id`;
  const params = [];
  if (kw) {
    sql += ' WHERE r.name LIKE ? OR r.code LIKE ? OR r.category LIKE ? OR r.tags LIKE ? OR r.group_name LIKE ?';
    params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`);
  }
  sql += ' ORDER BY r.id DESC';
  const rows = await db.query(sql, params);
  return rows.map((r) => Object.assign(publicReport(r), {
    datasetName: r.dataset_name || '',
    shareCount: Number(r.share_count || 0),
  }));
}

async function getReport(id) {
  const row = await db.queryOne('SELECT * FROM jdywh_reports WHERE id = ? LIMIT 1', [id]);
  return publicReport(row);
}

async function createReport(input, userId) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('报表名称不能为空');
  const code = await uniqueCode('jdywh_reports', input.code || name, 'code');
  const groupVal = input.group !== undefined ? String(input.group || '').trim() : String(input.category || '').trim();
  const result = await db.query(
    `INSERT INTO jdywh_reports
       (name, code, description, category, report_type, dataset_id, config, layout, icon, tags, group_name, source, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'user',?,?)`,
    [
      name, code,
      String(input.description || '').trim() || null,
      String(input.category || groupVal || '').trim() || null,
      ['chart', 'table', 'dashboard', 'ai'].includes(input.reportType) ? input.reportType : 'chart',
      input.datasetId ? Number(input.datasetId) : null,
      input.config ? JSON.stringify(input.config) : null,
      input.layout ? JSON.stringify(input.layout) : null,
      String(input.icon || '').trim() || null,
      String(input.tags || '').trim() || null,
      groupVal || null,
      input.status === 0 ? 0 : 1,
      userId || null,
    ]
  );
  return getReport(result.insertId);
}

async function updateReport(id, input) {
  const row = await db.queryOne('SELECT * FROM jdywh_reports WHERE id = ? LIMIT 1', [id]);
  if (!row) throw new Error('报表不存在');

  const fields = [];
  const params = [];
  const set = (c, v) => { fields.push(`${c} = ?`); params.push(v); };

  if (input.name !== undefined) set('name', String(input.name).trim());
  if (input.description !== undefined) set('description', String(input.description || '').trim() || null);
  if (input.category !== undefined) set('category', String(input.category || '').trim() || null);
  if (input.group !== undefined) set('group_name', String(input.group || '').trim() || null);
  if (input.icon !== undefined) set('icon', String(input.icon || '').trim() || null);
  if (input.tags !== undefined) set('tags', String(input.tags || '').trim() || null);
  if (input.reportType !== undefined) set('report_type', input.reportType);
  if (input.datasetId !== undefined) set('dataset_id', input.datasetId ? Number(input.datasetId) : null);
  if (input.config !== undefined) set('config', input.config ? JSON.stringify(input.config) : null);
  if (input.layout !== undefined) set('layout', input.layout ? JSON.stringify(input.layout) : null);
  if (input.status !== undefined) set('status', Number(input.status) ? 1 : 0);

  if (!fields.length) return getReport(id);
  params.push(id);
  await db.query(`UPDATE jdywh_reports SET ${fields.join(', ')} WHERE id = ?`, params);
  return getReport(id);
}

async function deleteReport(id) {
  const row = await db.queryOne('SELECT id, report_type, source FROM jdywh_reports WHERE id = ? LIMIT 1', [id]);
  if (row && row.report_type === 'ai' && row.source === 'builtin') {
    throw new Error('内置看板来源的 AI 报表不允许删除，只能停用');
  }
  await db.query("DELETE FROM jdywh_shares WHERE target_type = 'report' AND target_id = ?", [id]);
  await db.query('DELETE FROM jdywh_reports WHERE id = ?', [id]);
  return true;
}

/** 执行报表（返回图表数据） */
async function runReport(id, options) {
  const report = await getReport(id);
  if (!report) throw new Error('报表不存在');
  if (!report.status) throw new Error('报表已停用');

  if (!report.datasetId) {
    return { report, rows: [], columns: [], rowCount: 0, elapsed: 0 };
  }

  const data = await runDataset(report.datasetId, { limit: (options && options.limit) || 2000 });
  await db.query('UPDATE jdywh_reports SET view_count = view_count + 1 WHERE id = ?', [id]);
  return Object.assign({ report }, data);
}

/* ══════════ 分享 ══════════ */

function publicShare(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    token: r.token,
    targetType: r.target_type,
    targetId: Number(r.target_id),
    title: r.title || '',
    hasPassword: !!r.password,
    // 明文密码（仅管理员可见）：v3 起密码以可逆方式存储，便于管理员查看与告知
    password: r.password_plain || null,
    expiresAt: r.expires_at,
    allowExport: Number(r.allow_export) === 1,
    viewCount: Number(r.view_count || 0),
    status: Number(r.status),
    createdAt: r.created_at,
  };
}

async function listShares(reportId) {
  const rows = await db.query(
    `SELECT s.*, r.name AS report_name FROM jdywh_shares s
       LEFT JOIN jdywh_reports r ON r.id = s.target_id AND s.target_type = 'report'
      ${reportId ? 'WHERE s.target_id = ? AND s.target_type = ?' : ''}
      ORDER BY s.id DESC`,
    reportId ? [reportId, 'report'] : []
  );
  return rows.map((r) => Object.assign(publicShare(r), { reportName: r.report_name || '' }));
}

async function createShare(input, userId) {
  const targetType = input.targetType || 'report';
  const targetId = Number(input.targetId);
  if (!targetId) throw new Error('请选择要分享的报表');

  /**
   * V7：支持分享「系统内置看板」（target_type = 'board'）。
   * 内置看板不在 jdywh_reports 里，因此不查报表、标题直接用传入值。
   */
  const isBoard = targetType === 'board';
  const report = isBoard ? null : await getReport(targetId);
  if (!isBoard && !report) throw new Error('报表不存在');

  const token = crypto.randomBytes(12).toString('hex');
  const plain = input.password ? String(input.password) : null;
  const password = plain ? crypto.createHash('sha256').update(plain).digest('hex') : null;
  let expiresAt = null;
  if (input.expiresDays) {
    expiresAt = new Date(Date.now() + Number(input.expiresDays) * 86400000);
  }

  const title = isBoard
    ? String(input.title || '客户看板').slice(0, 191)
    : String(input.title || report.name).slice(0, 191);

  const result = await db.query(
    `INSERT INTO jdywh_shares
       (token, target_type, target_id, title, password, password_plain, expires_at, allow_export, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,1,?)`,
    [
      token, targetType, targetId,
      title,
      password, plain, expiresAt,
      input.allowExport ? 1 : 0,
      userId || null,
    ]
  );
  const row = await db.queryOne('SELECT * FROM jdywh_shares WHERE id = ?', [result.insertId]);
  return publicShare(row);
}

async function deleteShare(id) {
  await db.query('DELETE FROM jdywh_shares WHERE id = ?', [id]);
  return true;
}

async function toggleShare(id, status) {
  await db.query('UPDATE jdywh_shares SET status = ? WHERE id = ?', [Number(status) ? 1 : 0, id]);
  const row = await db.queryOne('SELECT * FROM jdywh_shares WHERE id = ?', [id]);
  return publicShare(row);
}

/**
 * V16 2.1~2.4：分享链接编辑（契约 §3.1）
 *
 * 需求原文 L7-10：「分享的连接项目可以设置页面标题和修改以下内容：
 *   支持修改分享标题 / 支持修改有效期 / 支持修改访问密码，开关访问密码」
 *
 * V15 现状（实测）：`PUT /shares/:id` 只接受 `status` 一个字段，全仓库 `grep "SET title"` 0 命中，
 * 即编辑能力是**从 0 到 1**，不是给旧接口补参数。
 *
 * 语义约定（与读取侧 `password IS NULL = 无密码`、`expires_at IS NULL = 永久` 完全一致）：
 *   - `title`     : 非空字符串 → 写入；空串 → 写入空串（公开页回退为看板/报表名）
 *   - `expiresAt` : `null`/'永久' → NULL；ISO 时间 → 该时间；`days:N` → 当前 + N 天
 *   - `password`  : `null`/空串/`false` → 清空密码（关闭访问密码）；非空 → 设为该密码
 *   - `passwordOn`: `true` 且当前无密码 → 需同时给 password，否则报错
 *   - `status`    : 1/0，行为与 V15 完全一致（**只传 status 时向后兼容**）
 *
 * @param {number|string} id
 * @param {Object} body
 */
async function updateShare(id, body) {
  const n = Number(id);
  if (!n) throw new Error('分享 ID 无效');
  const cur = await db.queryOne('SELECT * FROM jdywh_shares WHERE id = ? LIMIT 1', [n]);
  if (!cur) throw new Error('分享链接不存在');

  const b = body || {};
  const sets = [];
  const params = [];

  /* status —— 与 V15 toggleShare 完全相同的落库语义 */
  if (b.status !== undefined) {
    sets.push('status = ?');
    params.push(Number(b.status) ? 1 : 0);
  }

  /* title —— 需求 2.0 / 2.1「页面标题」「分享标题」 */
  if (b.title !== undefined) {
    const t = String(b.title === null ? '' : b.title);
    if (t.length > 191) throw new Error('分享标题不能超过 191 个字符');
    sets.push('title = ?');
    params.push(t);
  }

  /* expiresAt —— 需求 2.2「支持修改有效期」 */
  if (b.expiresAt !== undefined || b.expiresDays !== undefined) {
    let exp = null;
    if (b.expiresAt === null || b.expiresAt === '' || b.expiresAt === 'never' || b.expiresAt === '永久') {
      exp = null;
    } else if (typeof b.expiresAt === 'string' && /^days:\d+$/.test(b.expiresAt)) {
      exp = new Date(Date.now() + Number(b.expiresAt.slice(5)) * 86400000);
    } else if (b.expiresDays !== undefined && b.expiresDays !== null && b.expiresDays !== '') {
      const d = Number(b.expiresDays);
      if (!Number.isFinite(d) || d < 0) throw new Error('有效期天数无效');
      exp = d === 0 ? null : new Date(Date.now() + d * 86400000);
    } else if (b.expiresAt !== undefined) {
      const d = new Date(String(b.expiresAt).replace(' ', 'T'));
      if (Number.isNaN(d.getTime())) throw new Error('有效期时间格式无效');
      exp = d;
    }
    if (exp && Number.isNaN(exp.getTime())) throw new Error('有效期时间格式无效');
    sets.push('expires_at = ?');
    params.push(exp);
  }

  /* password —— 需求 2.3「修改访问密码」 + 2.4「开关访问密码」 */
  if (b.password !== undefined || b.passwordOn !== undefined) {
    const raw = b.password;
    const isOff = raw === null || raw === undefined || raw === '' || raw === false;
    if (isOff) {
      /* 关闭访问密码：password IS NULL 即读取侧认定的「无密码」语义 */
      if (b.passwordOn === true) throw new Error('开启访问密码时必须填写密码');
      sets.push('password = ?'); params.push(null);
      sets.push('password_plain = ?'); params.push(null);
    } else {
      const plain = String(raw);
      if (plain.length > 64) throw new Error('访问密码不能超过 64 个字符');
      const hash = crypto.createHash('sha256').update(plain).digest('hex');
      sets.push('password = ?'); params.push(hash);
      sets.push('password_plain = ?'); params.push(plain.slice(0, 128));
    }
  }

  if (!sets.length) throw new Error('没有需要修改的字段');

  params.push(n);
  await db.query(`UPDATE jdywh_shares SET ${sets.join(', ')} WHERE id = ?`, params);
  const row = await db.queryOne('SELECT * FROM jdywh_shares WHERE id = ?', [n]);
  return publicShare(row);
}

/** 通过 token 访问分享
 *
 * @param {string} token
 * @param {string} [password]
 * @param {Object} [ctx] V16：{ req, path } —— 用于访问埋点（可选，旧调用方不传也能正常工作）
 */
async function accessShare(token, password, ctx) {
  const row = await db.queryOne('SELECT * FROM jdywh_shares WHERE token = ? LIMIT 1', [token]);
  if (!row) return { ok: false, code: 'not_found', message: '分享链接不存在' };
  if (Number(row.status) !== 1) return { ok: false, code: 'disabled', message: '该分享已被停用' };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, code: 'expired', message: '该分享链接已过期' };
  }
  if (row.password) {
    const hash = crypto.createHash('sha256').update(String(password || '')).digest('hex');
    if (hash !== row.password) return { ok: false, code: 'password', message: '访问密码不正确' };
  }

  await db.query('UPDATE jdywh_shares SET view_count = view_count + 1 WHERE id = ?', [row.id]);

  /**
   * V16 2.5：分享访问埋点（契约 §2.2）
   *
   * **只在密码/停用/过期全部校验通过后才记录**，与 view_count +1 同一位置；
   * 内部 setImmediate 异步写库，失败只 warn，**绝不阻塞公开页响应**。
   * 30 秒同源去抖在 share-visits 内部实现。
   */
  try {
    require('./share-visits').record(
      (ctx && ctx.req) || null,
      'report', row.id, row.token,
      (ctx && ctx.path) || null,
    );
  } catch (e) { /* 埋点失败绝不影响主流程 */ }

  /**
   * V7：内置看板分享。
   * target_type='board' 时 target_id 只是一个占位（1 = 中康客户看板），
   * 直接返回看板标识，由前端 /s/:token 页面渲染看板。
   */
  if (row.target_type === 'board') {
    return {
      ok: true,
      targetType: 'board',
      targetName: row.title || '客户看板',
      share: publicShare(row),
      boardKey: Number(row.target_id) === 1 ? 'zk' : 'crm',
      report: null,
      rows: [],
      columns: [],
      rowCount: 0,
    };
  }

  const report = await getReport(row.target_id);
  if (!report) return { ok: false, code: 'not_found', message: '报表已被删除' };

  const data = await runReport(row.target_id, { limit: 2000 });
  return {
    ok: true,
    targetType: 'report',
    targetName: report.name,
    share: publicShare(row),
    report: data.report,
    rows: data.rows,
    columns: data.columns,
    rowCount: data.rowCount,
  };
}

module.exports = {
  CHART_TYPES,
  DASHBOARD_ROWS,
  DASHBOARD_THEME,
  listDatasets,
  getDataset,
  createDataset,
  updateDataset,
  deleteDataset,
  runDataset,
  previewDataset,
  inferFields,
  buildQuery,
  assertReadOnly,
  testSql,
  validateDatasetSql,
  precheckDatasetSql,
  stripLiteralsAndComments,
  listReports,
  getReport,
  createReport,
  updateReport,
  deleteReport,
  runReport,
  listShares,
  createShare,
  deleteShare,
  toggleShare,
  updateShare,
  accessShare,
  publicReport,
  publicDataset,
  publicShare,
};