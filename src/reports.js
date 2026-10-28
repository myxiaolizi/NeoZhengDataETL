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
  const sql = String(dataset.sourceSql || '').trim().replace(/;+\s*$/, '');
  assertReadOnly(sql);
  return { ds: source, sql, params: [], limit: maxRows };
}

/** SQL 安全校验：只允许单条 SELECT / WITH 查询 */
function assertReadOnly(sql) {
  const s = String(sql || '').trim();
  if (!s) throw new Error('SQL 不能为空');
  if (s.includes(';')) throw new Error('只允许执行单条查询语句（不允许分号）');
  if (!/^(select|with)\s/i.test(s)) throw new Error('只允许 SELECT / WITH 查询语句');
  const forbidden = /\b(insert|update|delete|drop|truncate|alter|create|replace|grant|revoke|rename|call|exec|execute|load_file|outfile|dumpfile|into\s+outfile|into\s+dumpfile)\b/i;
  if (forbidden.test(s)) throw new Error('查询语句包含不允许的关键字（仅支持只读查询）');
  return true;
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
  const rows = await ds.query(q.ds, sql, q.params);
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
    sql += ' WHERE r.name LIKE ? OR r.code LIKE ? OR r.category LIKE ?';
    params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
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
  const result = await db.query(
    `INSERT INTO jdywh_reports
       (name, code, description, category, report_type, dataset_id, config, layout, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      name, code,
      String(input.description || '').trim() || null,
      String(input.category || '').trim() || null,
      ['chart', 'table', 'dashboard'].includes(input.reportType) ? input.reportType : 'chart',
      input.datasetId ? Number(input.datasetId) : null,
      input.config ? JSON.stringify(input.config) : null,
      input.layout ? JSON.stringify(input.layout) : null,
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

  const report = await getReport(targetId);
  if (!report) throw new Error('报表不存在');

  const token = crypto.randomBytes(12).toString('hex');
  const plain = input.password ? String(input.password) : null;
  const password = plain ? crypto.createHash('sha256').update(plain).digest('hex') : null;
  let expiresAt = null;
  if (input.expiresDays) {
    expiresAt = new Date(Date.now() + Number(input.expiresDays) * 86400000);
  }

  const result = await db.query(
    `INSERT INTO jdywh_shares
       (token, target_type, target_id, title, password, password_plain, expires_at, allow_export, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,1,?)`,
    [
      token, targetType, targetId,
      String(input.title || report.name).slice(0, 191),
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

/** 通过 token 访问分享 */
async function accessShare(token, password) {
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
  const report = await getReport(row.target_id);
  if (!report) return { ok: false, code: 'not_found', message: '报表已被删除' };

  const data = await runReport(row.target_id, { limit: 2000 });
  return {
    ok: true,
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
  accessShare,
  publicReport,
  publicDataset,
  publicShare,
};