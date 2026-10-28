'use strict';

const crypto = require('crypto');
const db = require('./db');
const projects = require('./projects');
const schema = require('./schema');
const fields = require('./fields');

/**
 * 数据集成
 *
 *   pull —— 通过接口采集数据：定时/手动调用第三方接口，把返回数据写入项目数据表
 *   push —— 通过接口推送数据：把项目数据推送到指定服务器（支持 webhook 触发与定时）
 */

function safeJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (_) { return null; }
}

function publicRow(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    name: r.name,
    code: r.code,
    direction: r.direction,
    projectId: r.project_id ? Number(r.project_id) : null,
    protocol: r.protocol,
    method: r.method,
    url: r.url || '',
    headers: safeJson(r.headers) || {},
    params: safeJson(r.params) || {},
    body: r.body || '',
    authType: r.auth_type,
    authConfig: safeJson(r.auth_config) || {},
    dataPath: r.data_path || '',
    fieldMap: safeJson(r.field_map) || {},
    schedule: r.schedule || '',
    triggerType: r.trigger_type,
    lastRunAt: r.last_run_at,
    lastRunOk: r.last_run_ok === null || r.last_run_ok === undefined ? null : Number(r.last_run_ok) === 1,
    lastRunMsg: r.last_run_msg || '',
    runCount: Number(r.run_count || 0),
    successCount: Number(r.success_count || 0),
    status: Number(r.status),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function uniqueCode(base) {
  let code = String(base || 'task').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'task';
  if (/^[0-9]/.test(code)) code = 't_' + code;
  code = code.slice(0, 48);
  let candidate = code;
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const row = await db.queryOne('SELECT id FROM jdywh_integrations WHERE code = ? LIMIT 1', [candidate]);
    if (!row) return candidate;
    i += 1;
    candidate = `${code}_${i}`;
    if (i > 500) return `${code}_${crypto.randomBytes(3).toString('hex')}`;
  }
}

async function list(direction, keyword) {
  const where = [];
  const params = [];
  if (direction) { where.push('i.direction = ?'); params.push(direction); }
  if (keyword) {
    where.push('(i.name LIKE ? OR i.code LIKE ? OR i.url LIKE ?)');
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.query(
    `SELECT i.*, p.name AS project_name FROM jdywh_integrations i
       LEFT JOIN jdywh_projects p ON p.id = i.project_id
       ${whereSql} ORDER BY i.id DESC`,
    params
  );
  return rows.map((r) => Object.assign(publicRow(r), { projectName: r.project_name || '' }));
}

async function get(id) {
  const row = await db.queryOne('SELECT * FROM jdywh_integrations WHERE id = ? LIMIT 1', [id]);
  return publicRow(row);
}

/** 内部使用：含完整配置 */
async function getInternal(id) {
  return db.queryOne('SELECT * FROM jdywh_integrations WHERE id = ? LIMIT 1', [id]);
}

async function create(input, userId) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('任务名称不能为空');
  const direction = input.direction === 'push' ? 'push' : 'pull';
  const code = await uniqueCode(input.code || name);

  const result = await db.query(
    `INSERT INTO jdywh_integrations
       (name, code, direction, project_id, protocol, method, url, headers, params, body,
        auth_type, auth_config, data_path, field_map, schedule, trigger_type, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      name, code, direction,
      input.projectId ? Number(input.projectId) : null,
      input.protocol === 'https' ? 'https' : 'http',
      String(input.method || (direction === 'push' ? 'POST' : 'GET')).toUpperCase(),
      String(input.url || '').trim() || null,
      input.headers ? JSON.stringify(input.headers) : null,
      input.params ? JSON.stringify(input.params) : null,
      input.body || null,
      input.authType || 'none',
      input.authConfig ? JSON.stringify(input.authConfig) : null,
      input.dataPath || null,
      input.fieldMap ? JSON.stringify(input.fieldMap) : null,
      input.schedule || null,
      input.triggerType || 'manual',
      input.status === 0 ? 0 : 1,
      userId || null,
    ]
  );
  return get(result.insertId);
}

async function update(id, input) {
  const row = await getInternal(id);
  if (!row) throw new Error('任务不存在');

  const fs = [];
  const params = [];
  const set = (c, v) => { fs.push(`${c} = ?`); params.push(v); };

  if (input.name !== undefined) set('name', String(input.name).trim());
  if (input.direction !== undefined) set('direction', input.direction === 'push' ? 'push' : 'pull');
  if (input.projectId !== undefined) set('project_id', input.projectId ? Number(input.projectId) : null);
  if (input.protocol !== undefined) set('protocol', input.protocol === 'https' ? 'https' : 'http');
  if (input.method !== undefined) set('method', String(input.method).toUpperCase());
  if (input.url !== undefined) set('url', String(input.url).trim() || null);
  if (input.headers !== undefined) set('headers', input.headers ? JSON.stringify(input.headers) : null);
  if (input.params !== undefined) set('params', input.params ? JSON.stringify(input.params) : null);
  if (input.body !== undefined) set('body', input.body || null);
  if (input.authType !== undefined) set('auth_type', input.authType || 'none');
  if (input.authConfig !== undefined) set('auth_config', input.authConfig ? JSON.stringify(input.authConfig) : null);
  if (input.dataPath !== undefined) set('data_path', input.dataPath || null);
  if (input.fieldMap !== undefined) set('field_map', input.fieldMap ? JSON.stringify(input.fieldMap) : null);
  if (input.schedule !== undefined) set('schedule', input.schedule || null);
  if (input.triggerType !== undefined) set('trigger_type', input.triggerType || 'manual');
  if (input.status !== undefined) set('status', Number(input.status) ? 1 : 0);

  if (!fs.length) return get(id);
  params.push(id);
  await db.query(`UPDATE jdywh_integrations SET ${fs.join(', ')} WHERE id = ?`, params);
  return get(id);
}

async function remove(id) {
  await db.query('DELETE FROM jdywh_integration_logs WHERE integration_id = ?', [id]);
  await db.query('DELETE FROM jdywh_integrations WHERE id = ?', [id]);
  return true;
}

/** 构建请求头（含鉴权） */
function buildHeaders(row) {
  const headers = Object.assign({}, safeJson(row.headers) || {});
  const auth = safeJson(row.auth_config) || {};
  const type = row.auth_type || 'none';

  if (type === 'bearer' && auth.token) {
    headers['Authorization'] = 'Bearer ' + auth.token;
  } else if (type === 'basic' && (auth.username || auth.password)) {
    const raw = `${auth.username || ''}:${auth.password || ''}`;
    headers['Authorization'] = 'Basic ' + Buffer.from(raw, 'utf8').toString('base64');
  } else if (type === 'apikey' && auth.key) {
    headers[auth.header || 'X-API-Key'] = auth.value || auth.key;
  }
  return headers;
}

/** 按路径取值（支持 a.b.c 与 a[0].b） */
function getByPath(obj, path) {
  if (!path) return obj;
  const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** 把任意值转为可入库标量 */
function toScalar(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  return JSON.stringify(v);
}

/* ══════════ 采集（pull） ══════════ */

/**
 * 执行采集任务：调用接口 → 解析响应 → 写入项目数据表
 */
async function runPull(row, triggerSource) {
  const started = Date.now();
  const log = {
    integrationId: row.id,
    direction: 'pull',
    triggerSource: triggerSource || 'manual',
    success: false,
    rowsAffected: 0,
    httpStatus: null,
    message: '',
    requestSnapshot: null,
    responseSnapshot: null,
    durationMs: 0,
  };

  try {
    if (!row.url) throw new Error('未配置接口地址');
    if (!row.project_id) throw new Error('未关联项目，无法确定写入目标');

    const project = await projects.getProject(row.project_id);
    if (!project) throw new Error('关联项目不存在');

    // 构建 URL
    const params = safeJson(row.params) || {};
    const qs = Object.keys(params).length
      ? '?' + Object.keys(params).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&')
      : '';
    const url = row.url + qs;

    const method = String(row.method || 'GET').toUpperCase();
    const headers = buildHeaders(row);
    if (!headers['Content-Type'] && method !== 'GET') headers['Content-Type'] = 'application/json';

    let body;
    if (method !== 'GET' && method !== 'HEAD' && row.body) {
      body = String(row.body);
    }

    log.requestSnapshot = JSON.stringify({ method, url, headers: maskHeaders(headers), body: body || null }).slice(0, 4000);

    const resp = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(30000) });
    const text = await resp.text();
    log.httpStatus = resp.status;
    log.responseSnapshot = text.slice(0, 4000);

    if (!resp.ok) throw new Error(`接口返回 HTTP ${resp.status}`);

    let json;
    try { json = JSON.parse(text); } catch (_) { throw new Error('接口返回内容不是合法 JSON'); }

    // 提取数据数组
    const dataNode = getByPath(json, row.data_path);
    let items = dataNode;
    if (!Array.isArray(items)) {
      if (items && typeof items === 'object') items = [items];
      else throw new Error(`未在响应中找到数据数组（路径: ${row.data_path || '根节点'}）`);
    }
    if (!items.length) {
      log.success = true;
      log.message = '接口返回空数据';
      log.durationMs = Date.now() - started;
      await writeLog(log);
      return log;
    }

    // 字段映射
    const fieldMap = safeJson(row.field_map) || {};
    const hasMap = Object.keys(fieldMap).length > 0;

    // 确保表结构存在
    await schema.ensureProjectTables(project.id);

    let defMap = await fields.getFieldDefMap(project.id);
    const existingCols = await schema.columnNames(schema.makeTableName(project.id));

    // 收集所有字段键
    const allKeys = new Set();
    items.forEach((it) => {
      if (it && typeof it === 'object') Object.keys(it).forEach((k) => allKeys.add(k));
    });

    const targetKeys = hasMap ? Object.keys(fieldMap) : Array.from(allKeys);
    const missing = targetKeys.filter((k) => !defMap[k]);
    if (missing.length) {
      await fields.autoRegisterFields(project.id, missing, defMap, existingCols);
      defMap = await fields.getFieldDefMap(project.id);
    }

    // 建列
    const sample = {};
    items.slice(0, 5).forEach((it) => {
      targetKeys.forEach((k) => {
        const src = hasMap ? fieldMap[k] : k;
        const v = getByPath(it, src);
        if (sample[k] === undefined && v !== undefined) sample[k] = v;
      });
    });
    const defs = targetKeys.map((k) => defMap[k]).filter(Boolean);
    await schema.syncFieldColumns(project.id, defs, sample);

    // 写入
    let written = 0;
    for (const item of items) {
      const columns = {};
      const parsed = {};
      const dataId = item && (item._id || item.id || item.dataId)
        ? String(item._id || item.id || item.dataId)
        : `pull_${row.id}_${Date.now()}_${written}`;

      for (const key of targetKeys) {
        const def = defMap[key];
        if (!def || Number(def.enabled) === 0) continue;
        const src = hasMap ? fieldMap[key] : key;
        const raw = getByPath(item, src);
        if (raw === undefined) continue;
        columns[def.column_name] = raw;
        if (def.parse_mode && def.parse_mode !== 'none' && def.parse_mode !== fields.EXPAND_MODE) {
          const v = fields.parseValue(raw, def.parse_mode, def.parse_path);
          if (v !== null && v !== undefined && v !== '') {
            parsed[fields.parsedColumnOf(def.column_name)] = String(v).slice(0, 500);
          }
        }
      }

      if (!Object.keys(columns).length) continue;

      await schema.upsertRecord(project.id, {
        dataId,
        op: 'api_pull',
        formName: row.name,
        opTime: Date.now(),
        rawJson: JSON.stringify(item).slice(0, 2000000),
        columns,
        parsed,
      });
      written += 1;
    }

    await projects.touchProject(project.id);

    log.success = true;
    log.rowsAffected = written;
    log.message = `采集成功，写入 ${written} 条数据`;
  } catch (err) {
    log.success = false;
    log.message = err.message;
  }

  log.durationMs = Date.now() - started;
  await writeLog(log);
  await touchRun(row.id, log.success, log.message);
  return log;
}

/* ══════════ 推送（push） ══════════ */

/**
 * 执行推送任务：读取项目数据 → 推送到目标接口
 */
async function runPush(row, triggerSource, options) {
  const opts = options || {};
  const started = Date.now();
  const log = {
    integrationId: row.id,
    direction: 'push',
    triggerSource: triggerSource || 'manual',
    success: false,
    rowsAffected: 0,
    httpStatus: null,
    message: '',
    requestSnapshot: null,
    responseSnapshot: null,
    durationMs: 0,
  };

  try {
    if (!row.url) throw new Error('未配置目标接口地址');
    if (!row.project_id) throw new Error('未关联项目，无法确定数据来源');

    const project = await projects.getProject(row.project_id);
    if (!project) throw new Error('关联项目不存在');

    // 读取待推送数据
    const table = opts.useParsed === false
      ? schema.makeTableName(project.id)
      : schema.makeParsedTableName(project.id);
    const limit = Math.min(Number(opts.limit) || 100, 1000);

    let rows = [];
    if (await schema.tableExists(table)) {
      if (opts.dataId) {
        rows = await db.raw(`SELECT * FROM \`${table}\` WHERE jdy_data_id = ? LIMIT 1`, [opts.dataId]);
      } else {
        rows = await db.raw(`SELECT * FROM \`${table}\` ORDER BY id DESC LIMIT ${limit}`);
      }
    }

    if (!rows.length) {
      log.success = true;
      log.message = '没有需要推送的数据';
      log.durationMs = Date.now() - started;
      await writeLog(log);
      await touchRun(row.id, true, log.message);
      return log;
    }

    // 字段映射（可选）
    const fieldMap = safeJson(row.field_map) || {};
    const hasMap = Object.keys(fieldMap).length > 0;

    const payloadRows = rows.map((r) => {
      if (!hasMap) return r;
      const out = {};
      Object.keys(fieldMap).forEach((k) => { out[k] = r[fieldMap[k]]; });
      return out;
    });

    const method = String(row.method || 'POST').toUpperCase();
    const headers = buildHeaders(row);
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';

    // body 模板：支持 {{rows}} 占位
    let body;
    if (row.body && String(row.body).includes('{{rows}}')) {
      body = String(row.body).replace('{{rows}}', JSON.stringify(payloadRows));
    } else if (method === 'GET' || method === 'HEAD') {
      body = undefined;
    } else {
      body = JSON.stringify(opts.single && payloadRows.length === 1 ? payloadRows[0] : payloadRows);
    }

    log.requestSnapshot = JSON.stringify({
      method, url: row.url, headers: maskHeaders(headers),
      body: body ? body.slice(0, 2000) : null,
    }).slice(0, 4000);

    const resp = await fetch(row.url, { method, headers, body, signal: AbortSignal.timeout(30000) });
    const text = await resp.text();
    log.httpStatus = resp.status;
    log.responseSnapshot = text.slice(0, 4000);

    if (!resp.ok) throw new Error(`目标接口返回 HTTP ${resp.status}`);

    log.success = true;
    log.rowsAffected = payloadRows.length;
    log.message = `推送成功，共 ${payloadRows.length} 条`;
  } catch (err) {
    log.success = false;
    log.message = err.message;
  }

  log.durationMs = Date.now() - started;
  await writeLog(log);
  await touchRun(row.id, log.success, log.message);
  return log;
}

/** 执行任务（按方向分发） */
async function run(id, triggerSource, options) {
  const row = await getInternal(id);
  if (!row) throw new Error('任务不存在');
  if (!Number(row.status)) throw new Error('任务已停用');

  if (row.direction === 'push') return runPush(row, triggerSource, options);
  return runPull(row, triggerSource);
}

/* ══════════ 日志与统计 ══════════ */

async function writeLog(log) {
  try {
    await db.query(
      `INSERT INTO jdywh_integration_logs
         (integration_id, direction, trigger_source, success, rows_affected, http_status,
          message, request_snapshot, response_snapshot, duration_ms)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        log.integrationId, log.direction, log.triggerSource,
        log.success ? 1 : 0, log.rowsAffected || 0, log.httpStatus,
        (log.message || '').slice(0, 2000), log.requestSnapshot, log.responseSnapshot,
        log.durationMs,
      ]
    );
  } catch (err) {
    console.error('[integration] 写日志失败:', err.message);
  }
}

async function touchRun(id, ok, message) {
  await db.query(
    `UPDATE jdywh_integrations
        SET last_run_at = NOW(), last_run_ok = ?, last_run_msg = ?,
            run_count = run_count + 1,
            success_count = success_count + ?
      WHERE id = ?`,
    [ok ? 1 : 0, String(message || '').slice(0, 480), ok ? 1 : 0, id]
  );
}

async function listLogs(integrationId, page, pageSize) {
  const p = Math.max(1, parseInt(page || '1', 10));
  const ps = Math.min(200, Math.max(5, parseInt(pageSize || '20', 10)));
  const offset = (p - 1) * ps;
  const where = integrationId ? 'WHERE integration_id = ?' : '';
  const params = integrationId ? [integrationId] : [];

  const totalRow = await db.queryOne(`SELECT COUNT(*) AS c FROM jdywh_integration_logs ${where}`, params);
  const rows = await db.query(
    `SELECT * FROM jdywh_integration_logs ${where} ORDER BY id DESC LIMIT ${ps} OFFSET ${offset}`,
    params
  );
  return { list: rows, total: Number((totalRow && totalRow.c) || 0), page: p, pageSize: ps };
}

/** 隐藏敏感请求头 */
function maskHeaders(headers) {
  const out = {};
  Object.keys(headers || {}).forEach((k) => {
    if (/authorization|api-?key|token|secret|password/i.test(k)) out[k] = '***';
    else out[k] = headers[k];
  });
  return out;
}

/** 统计 */
async function stats() {
  const row = await db.queryOne(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN direction='pull' THEN 1 ELSE 0 END) AS pull_count,
            SUM(CASE WHEN direction='push' THEN 1 ELSE 0 END) AS push_count,
            SUM(CASE WHEN status=1 THEN 1 ELSE 0 END) AS active
       FROM jdywh_integrations`
  );
  const logs = await db.queryOne(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) AS ok,
            SUM(rows_affected) AS rows_total
       FROM jdywh_integration_logs`
  );
  return {
    total: Number((row && row.total) || 0),
    pullCount: Number((row && row.pull_count) || 0),
    pushCount: Number((row && row.push_count) || 0),
    active: Number((row && row.active) || 0),
    runTotal: Number((logs && logs.total) || 0),
    runOk: Number((logs && logs.ok) || 0),
    rowsTotal: Number((logs && logs.rows_total) || 0),
  };
}

module.exports = {
  list,
  get,
  getInternal,
  create,
  update,
  remove,
  run,
  runPull,
  runPush,
  listLogs,
  stats,
  buildHeaders,
  getByPath,
  maskHeaders,
  publicRow,
};