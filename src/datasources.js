'use strict';

const db = require('./db');
const ds = require('./datasource');

/**
 * 数据源仓储：管理 jdywh_datasources 表
 * id=0 为默认数据源（应用元数据库，来自 .env），不落库
 */

function publicRow(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    name: r.name,
    type: r.type,
    host: r.host,
    port: Number(r.port),
    user: r.user,
    database: r.database,
    options: r.options ? safeJson(r.options) : null,
    remark: r.remark || '',
    isDefault: Number(r.is_default) === 1,
    status: Number(r.status),
    lastTestAt: r.last_test_at,
    lastTestOk: r.last_test_ok === null || r.last_test_ok === undefined ? null : Number(r.last_test_ok) === 1,
    lastTestMsg: r.last_test_msg || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

/** 列表（含默认数据源） */
async function list() {
  const rows = await db.query('SELECT * FROM jdywh_datasources ORDER BY is_default DESC, id ASC');
  const out = [publicRow(Object.assign({}, ds.defaultDataSource(), {
    is_default: 1, status: 1, remark: '来自 .env 配置，不可删除',
  }))];
  rows.forEach((r) => out.push(publicRow(r)));
  return out;
}

/** 按 ID 获取（含默认） */
async function getById(id) {
  const n = Number(id);
  if (!n || n === 0) return ds.defaultDataSource();
  const row = await db.queryOne('SELECT * FROM jdywh_datasources WHERE id = ? LIMIT 1', [n]);
  if (!row) return null;
  // 返回内部结构（含密码），供连接使用
  return {
    id: Number(row.id),
    name: row.name,
    type: row.type,
    host: row.host,
    port: Number(row.port),
    user: row.user,
    password: row.password,
    database: row.database,
    options: row.options,
    is_default: Number(row.is_default),
    status: Number(row.status),
  };
}

/** 对外展示用（脱敏） */
async function getPublic(id) {
  const n = Number(id);
  if (!n || n === 0) {
    return publicRow(Object.assign({}, ds.defaultDataSource(), {
      is_default: 1, status: 1, remark: '来自 .env 配置，不可删除',
    }));
  }
  const row = await db.queryOne('SELECT * FROM jdywh_datasources WHERE id = ? LIMIT 1', [n]);
  return publicRow(row);
}

/** 创建 */
async function create(input) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('数据源名称不能为空');
  const dstypes = require('./dstypes');
  const typeInfo = dstypes.get(input.type);
  const type = typeInfo ? input.type : (ds.DRIVERS[input.type] ? input.type : 'mysql');

  // SQL 类数据源必须提供主机与库名；API 类可从 options 中取接入点
  const isSql = typeInfo ? typeInfo.conn === 'sql' : true;
  const opts = input.options && typeof input.options === 'object' ? input.options : {};

  let host = String(input.host || '').trim();
  if (!host && isSql) throw new Error('主机地址不能为空');
  if (!host) {
    // API 类：从 options 里找接入点
    host = String(opts.baseUrl || opts.endpoint || opts.instanceUrl || opts.host || opts.ashost || '').trim();
  }

  let database = String(input.database || '').trim();
  if (!database && isSql) throw new Error('数据库名不能为空');
  if (!database) {
    database = String(opts.database || opts.project || opts.bucket || opts.index ||
      opts.appId || opts.corpId || opts.appKey || opts.mchId || opts.namespace || '').trim();
  }

  const port = Number(input.port) || (typeInfo ? typeInfo.defaultPort : ds.driverOf(type).defaultPort) || 0;

  const result = await db.query(
    `INSERT INTO jdywh_datasources
       (name, type, host, port, user, password, database_name, options, remark, is_default, status)
     VALUES (?,?,?,?,?,?,?,?,?,0,?)`,
    [
      name, type, host, port,
      String(input.user || '').trim(),
      String(input.password || ''),
      database,
      input.options ? JSON.stringify(input.options) : null,
      String(input.remark || '').trim() || null,
      input.status === 0 ? 0 : 1,
    ]
  );
  return getPublic(result.insertId);
}

/** 更新 */
async function update(id, input) {
  const n = Number(id);
  if (!n) throw new Error('默认数据源请在 .env 中修改');
  const row = await db.queryOne('SELECT * FROM jdywh_datasources WHERE id = ? LIMIT 1', [n]);
  if (!row) throw new Error('数据源不存在');

  const fields = [];
  const params = [];
  const set = (c, v) => { fields.push(`${c} = ?`); params.push(v); };

  if (input.name !== undefined) set('name', String(input.name).trim());
  if (input.type !== undefined) {
    const dstypes = require('./dstypes');
    if (dstypes.get(input.type) || ds.DRIVERS[input.type]) set('type', input.type);
  }
  if (input.host !== undefined) set('host', String(input.host).trim());
  if (input.port !== undefined) {
    const dstypes = require('./dstypes');
    const ti = dstypes.get(input.type || row.type);
    set('port', Number(input.port) || (ti ? ti.defaultPort : ds.driverOf(input.type || row.type).defaultPort) || 0);
  }
  if (input.user !== undefined) set('user', String(input.user).trim());
  if (input.password !== undefined && input.password !== '') set('password', String(input.password));
  if (input.database !== undefined) set('database_name', String(input.database).trim());
  if (input.options !== undefined) set('options', input.options ? JSON.stringify(input.options) : null);
  if (input.remark !== undefined) set('remark', String(input.remark).trim() || null);
  if (input.status !== undefined) set('status', Number(input.status) ? 1 : 0);

  if (!fields.length) return getPublic(n);
  params.push(n);
  await db.query(`UPDATE jdywh_datasources SET ${fields.join(', ')} WHERE id = ?`, params);

  // 配置变更 → 重建连接池
  await ds.invalidate(n);
  return getPublic(n);
}

/** 删除（检查是否被项目引用） */
async function remove(id) {
  const n = Number(id);
  if (!n) throw new Error('默认数据源不可删除');
  const used = await db.queryOne(
    'SELECT COUNT(*) AS c FROM jdywh_projects WHERE datasource_id = ?',
    [n]
  );
  if (used && Number(used.c) > 0) {
    throw new Error(`该数据源已被 ${used.c} 个项目使用，请先切换这些项目的数据源`);
  }
  await db.query('DELETE FROM jdywh_datasources WHERE id = ?', [n]);
  await ds.invalidate(n);
  return true;
}

/** 测试连通性并记录结果 */
async function test(id) {
  const source = await getById(id);
  if (!source) throw new Error('数据源不存在');
  const r = await ds.testConnection(source);
  if (Number(id) > 0) {
    await db.query(
      `UPDATE jdywh_datasources
          SET last_test_at = NOW(), last_test_ok = ?, last_test_msg = ?
        WHERE id = ?`,
      [r.ok ? 1 : 0, (r.ok ? `连接成功 (${r.elapsed}ms) ${r.version || ''}` : r.message).slice(0, 480), id]
    );
  }
  return r;
}

/** 列出数据源中的表 */
async function tables(id, keyword) {
  const source = await getById(id);
  if (!source) throw new Error('数据源不存在');
  return ds.listTables(source, keyword);
}

/** 列出表字段 */
async function columns(id, table) {
  const source = await getById(id);
  if (!source) throw new Error('数据源不存在');
  return ds.listColumns(source, table);
}

module.exports = { list, getById, getPublic, create, update, remove, test, tables, columns, publicRow };
