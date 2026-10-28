'use strict';

const mysql = require('mysql2/promise');
const config = require('./config');
const settings = require('./settings');

/**
 * 多数据源连接管理
 *
 * - 默认数据源（id=0）来自 .env，即应用自身的元数据库
 * - 其他数据源存放在 jdywh_datasources 表，支持 MySQL / SQL Server
 * - 连接池按数据源缓存，配置变更后自动失效重建
 */

const DRIVERS = {
  mysql: { key: 'mysql', name: 'MySQL / MariaDB', defaultPort: 3306, dialect: 'mysql', group: '关系型' },
  mssql: { key: 'mssql', name: 'SQL Server', defaultPort: 1433, dialect: 'mssql', group: '关系型' },
  postgres: { key: 'postgres', name: 'PostgreSQL', defaultPort: 5432, dialect: 'postgres', group: '关系型' },
  oracle: { key: 'oracle', name: 'Oracle', defaultPort: 1521, dialect: 'oracle', group: '关系型' },
  sqlite: { key: 'sqlite', name: 'SQLite', defaultPort: 0, dialect: 'sqlite', group: '文件型' },
  mongodb: { key: 'mongodb', name: 'MongoDB', defaultPort: 27017, dialect: 'mongodb', group: 'NoSQL' },
  redis: { key: 'redis', name: 'Redis', defaultPort: 6379, dialect: 'redis', group: 'NoSQL' },
  clickhouse: { key: 'clickhouse', name: 'ClickHouse', defaultPort: 8123, dialect: 'clickhouse', group: '分析型' },
  dm: { key: 'dm', name: '达梦 DM', defaultPort: 5236, dialect: 'dm', group: '国产数据库' },
  kingbase: { key: 'kingbase', name: '人大金仓 KingBase', defaultPort: 54321, dialect: 'kingbase', group: '国产数据库' },
  gbase: { key: 'gbase', name: 'GBase 8a', defaultPort: 5258, dialect: 'gbase', group: '国产数据库' },
  oceanbase: { key: 'oceanbase', name: 'OceanBase', defaultPort: 2881, dialect: 'mysql', group: '国产数据库' },
  tidb: { key: 'tidb', name: 'TiDB', defaultPort: 4000, dialect: 'mysql', group: '国产数据库' },
};

/** 数据源类型 → 方言标识（用于 SQL 生成） */
const DIALECTS = {
  mysql: 'mysql',
  mssql: 'mssql',
  postgres: 'postgres',
  oracle: 'oracle',
  sqlite: 'sqlite',
  mongodb: 'mongodb',
  redis: 'redis',
  clickhouse: 'clickhouse',
  dm: 'oracle',
  kingbase: 'postgres',
  gbase: 'mysql',
};

/** 各类型的连接参数说明（用于界面提示） */
const DRIVER_HINTS = {
  mysql: { user: '数据库账号', password: '数据库密码', database: '数据库名', extra: '支持 charset / ssl 等参数' },
  mssql: { user: '登录账号', password: '登录密码', database: '数据库名', extra: '默认关闭加密，如需开启请在高级参数中配置 encrypt' },
  postgres: { user: '数据库账号', password: '数据库密码', database: '数据库名', extra: '默认端口 5432' },
  oracle: { user: '用户名', password: '密码', database: '服务名（SID）', extra: '需安装 oracledb 驱动' },
  sqlite: { user: '（留空）', password: '（留空）', database: '数据库文件绝对路径', extra: '文件型数据库，无需账号密码' },
  mongodb: { user: '用户名', password: '密码', database: '数据库名', extra: '需安装 mongodb 驱动' },
  redis: { user: '（可选）', password: '密码', database: '库编号（0-15）', extra: '仅支持键值读取' },
  clickhouse: { user: '默认 default', password: '密码', database: '数据库名', extra: 'HTTP 端口默认 8123' },
  dm: { user: '用户名', password: '密码', database: '服务名', extra: '达梦数据库，需安装 dmdb 驱动' },
  kingbase: { user: '用户名', password: '密码', database: '数据库名', extra: '兼容 PostgreSQL 协议' },
  gbase: { user: '用户名', password: '密码', database: '数据库名', extra: '兼容 MySQL 协议' },
  oceanbase: { user: '用户名', password: '密码', database: '数据库名', extra: '兼容 MySQL 协议' },
  tidb: { user: '用户名', password: '密码', database: '数据库名', extra: '兼容 MySQL 协议' },
};

const pools = new Map(); // key -> { pool, signature }

function driverOf(type) {
  return DRIVERS[type] || DRIVERS.mysql;
}

function dialectOf(type) {
  const d = DRIVERS[type];
  return (d && d.dialect) || DIALECTS[type] || 'mysql';
}

/** 驱动分组（用于界面分类展示） */
function driverGroups() {
  const groups = {};
  Object.keys(DRIVERS).forEach((k) => {
    const d = DRIVERS[k];
    const g = d.group || '其他';
    if (!groups[g]) groups[g] = [];
    groups[g].push({ key: d.key, name: d.name, defaultPort: d.defaultPort, hint: DRIVER_HINTS[k] || null });
  });
  return groups;
}

/** 该类型是否已安装驱动 */
function driverAvailable(type) {
  const t = type || 'mysql';
  try {
    if (t === 'mssql') { require.resolve('mssql'); return true; }
    if (t === 'postgres' || t === 'kingbase') { require.resolve('pg'); return true; }
    if (t === 'oracle' || t === 'dm') { require.resolve('oracledb'); return true; }
    if (t === 'sqlite') { require.resolve('better-sqlite3'); return true; }
    if (t === 'mongodb') { require.resolve('mongodb'); return true; }
    if (t === 'redis') { require.resolve('redis'); return true; }
    if (t === 'clickhouse') { require.resolve('@clickhouse/client'); return true; }
    // mysql 兼容系列（mysql / gbase / oceanbase / tidb）
    require.resolve('mysql2');
    return true;
  } catch (_) {
    return false;
  }
}

/** 默认数据源（应用元数据库） */
function defaultDataSource() {
  return {
    id: 0,
    name: '本机数据库（应用元数据）',
    type: 'mysql',
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    options: null,
    is_default: 1,
    status: 1,
  };
}

/** 连接签名：配置变化时用于判断是否需要重建连接池 */
function signatureOf(ds) {
  return [ds.type, ds.host, ds.port, ds.user, ds.password, ds.database].join('|');
}

/** 构建连接配置 */
function buildConfig(ds) {
  const type = ds.type || 'mysql';
  const opts = typeof ds.options === 'string' && ds.options ? safeJson(ds.options) : (ds.options || {});

  if (type === 'mssql') {
    return {
      server: ds.host,
      port: Number(ds.port) || 1433,
      user: ds.user,
      password: ds.password,
      database: ds.database,
      options: Object.assign(
        {
          encrypt: false,
          trustServerCertificate: true,
          enableArithAbort: true,
          requestTimeout: 30000,
          connectTimeout: 15000,
        },
        opts
      ),
      pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    };
  }

  if (type === 'postgres' || type === 'kingbase') {
    return Object.assign({
      host: ds.host,
      port: Number(ds.port) || 5432,
      user: ds.user,
      password: ds.password,
      database: ds.database,
      max: 5,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
    }, opts);
  }

  if (type === 'clickhouse') {
    return Object.assign({
      url: `http://${ds.host}:${Number(ds.port) || 8123}`,
      username: ds.user || 'default',
      password: ds.password,
      database: ds.database,
      request_timeout: 30000,
    }, opts);
  }

  if (type === 'mongodb') {
    const auth = ds.user ? `${encodeURIComponent(ds.user)}:${encodeURIComponent(ds.password || '')}@` : '';
    return Object.assign({
      url: `mongodb://${auth}${ds.host}:${Number(ds.port) || 27017}/${ds.database}`,
      database: ds.database,
    }, opts);
  }

  if (type === 'redis') {
    return Object.assign({
      url: `redis://${ds.user ? encodeURIComponent(ds.user) + ':' : ''}${encodeURIComponent(ds.password || '')}@${ds.host}:${Number(ds.port) || 6379}`,
      database: Number(ds.database) || 0,
    }, opts);
  }

  if (type === 'sqlite') {
    return Object.assign({ file: ds.database }, opts);
  }

  if (type === 'oracle' || type === 'dm') {
    return Object.assign({
      user: ds.user,
      password: ds.password,
      connectString: `${ds.host}:${Number(ds.port) || 1521}/${ds.database}`,
      poolMax: 5,
    }, opts);
  }

  // MySQL 及兼容系列（mysql / gbase / oceanbase / tidb）
  return Object.assign(
    {
      host: ds.host,
      port: Number(ds.port) || 3306,
      user: ds.user,
      password: ds.password,
      database: ds.database,
      connectionLimit: 5,
      waitForConnections: true,
      queueLimit: 0,
      charset: 'utf8mb4',
      timezone: 'local',
      supportBigNumbers: true,
      bigNumberStrings: false,
      dateStrings: false,
      multipleStatements: false,
      connectTimeout: 15000,
    },
    opts
  );
}

function safeJson(s) {
  try { return JSON.parse(s); } catch (_) { return {}; }
}

/** 获取（或创建）数据源连接池 */
async function getPool(ds) {
  const source = ds || defaultDataSource();
  const key = String(source.id || 0);
  const sig = signatureOf(source);
  const cached = pools.get(key);
  if (cached && cached.signature === sig) return cached.pool;

  // 配置变化：关闭旧连接池
  if (cached) {
    try { await cached.pool.close(); } catch (_) { /* ignore */ }
    pools.delete(key);
  }

  const type = source.type || 'mysql';
  let pool;

  if (type === 'mssql') {
    const mssql = require('mssql');
    pool = await new mssql.ConnectionPool(buildConfig(source)).connect();
  } else if (type === 'postgres' || type === 'kingbase') {
    const { Pool } = require('pg');
    pool = new Pool(buildConfig(source));
  } else if (type === 'clickhouse') {
    const { createClient } = require('@clickhouse/client');
    pool = createClient(buildConfig(source));
  } else if (type === 'mongodb') {
    const { MongoClient } = require('mongodb');
    const cfg = buildConfig(source);
    const client = new MongoClient(cfg.url, { serverSelectionTimeoutMS: 15000 });
    await client.connect();
    pool = client;
  } else if (type === 'redis') {
    const { createClient } = require('redis');
    const cfg = buildConfig(source);
    const client = createClient({ url: cfg.url, database: cfg.database });
    await client.connect();
    pool = client;
  } else if (type === 'sqlite') {
    const Database = require('better-sqlite3');
    pool = new Database(buildConfig(source).file);
  } else if (type === 'oracle' || type === 'dm') {
    const oracledb = require('oracledb');
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
    pool = await oracledb.createPool(buildConfig(source));
  } else {
    // MySQL 及兼容系列
    pool = mysql.createPool(buildConfig(source));
  }

  pools.set(key, { pool, signature: sig, type });
  return pool;
}

/** 失效指定数据源的连接池 */
async function invalidate(id) {
  const key = String(id);
  const cached = pools.get(key);
  if (cached) {
    try { await cached.pool.close(); } catch (_) { /* ignore */ }
    pools.delete(key);
  }
}

async function invalidateAll() {
  for (const key of Array.from(pools.keys())) {
    await invalidate(key);
  }
}

/**
 * 统一查询接口
 * @param {object} ds 数据源
 * @param {string} sql SQL 语句（MySQL 用 ? 占位，MSSQL 用 @p1 @p2 ...）
 * @param {Array} params 参数
 * @returns {Promise<Array>} 行数组
 */
async function query(ds, sql, params) {
  const source = ds || defaultDataSource();
  const type = source.type || 'mysql';
  const pool = await getPool(source);
  const args = params || [];

  if (type === 'mssql') {
    const req = pool.request();
    args.forEach((v, i) => req.input('p' + (i + 1), v === undefined ? null : v));
    const result = await req.query(toMssqlParams(sql));
    return result.recordset || [];
  }

  if (type === 'postgres' || type === 'kingbase') {
    const result = await pool.query(toPgParams(sql), args);
    return result.rows || [];
  }

  if (type === 'clickhouse') {
    const result = await pool.query({ query: sql, format: 'JSONEachRow' });
    const text = await result.text();
    return text.trim() ? text.trim().split('\n').map((l) => JSON.parse(l)) : [];
  }

  if (type === 'mongodb') {
    // MongoDB 不支持 SQL：仅支持通过 options.collection 指定集合
    const cfg = buildConfig(source);
    const coll = (safeJson(source.options) || {}).collection;
    if (!coll) throw new Error('MongoDB 数据源需在高级参数中指定 collection');
    return pool.db(cfg.database).collection(coll).find({}).limit(1000).toArray();
  }

  if (type === 'redis') {
    throw new Error('Redis 为键值数据库，不支持 SQL 查询，请使用「数据表」方式读取');
  }

  if (type === 'sqlite') {
    return pool.prepare(sql).all(...args);
  }

  if (type === 'oracle' || type === 'dm') {
    const conn = await pool.getConnection();
    try {
      const result = await conn.execute(toOracleParams(sql), args, {
        outFormat: require('oracledb').OUT_FORMAT_OBJECT,
      });
      return result.rows || [];
    } finally {
      await conn.close();
    }
  }

  const [rows] = await pool.execute(sql, args);
  return rows;
}

/** 执行非预编译 SQL（DDL / 动态标识符） */
async function raw(ds, sql, params) {
  const source = ds || defaultDataSource();
  const type = source.type || 'mysql';
  const pool = await getPool(source);
  const args = params || [];

  if (type === 'mssql') {
    const req = pool.request();
    args.forEach((v, i) => req.input('p' + (i + 1), v === undefined ? null : v));
    const result = await req.query(toMssqlParams(sql));
    return result.recordset || [];
  }

  if (type === 'postgres' || type === 'kingbase') {
    const result = await pool.query(toPgParams(sql), args);
    return result.rows || [];
  }

  if (type === 'clickhouse') {
    const result = await pool.query({ query: sql, format: 'JSONEachRow' });
    const text = await result.text();
    return text.trim() ? text.trim().split('\n').map((l) => JSON.parse(l)) : [];
  }

  if (type === 'sqlite') {
    return pool.prepare(sql).all(...args);
  }

  if (type === 'oracle' || type === 'dm') {
    const conn = await pool.getConnection();
    try {
      const result = await conn.execute(toOracleParams(sql), args, {
        outFormat: require('oracledb').OUT_FORMAT_OBJECT,
      });
      return result.rows || [];
    } finally {
      await conn.close();
    }
  }

  if (type === 'mongodb' || type === 'redis') {
    return query(source, sql, args);
  }

  const [rows] = await pool.query(sql, args);
  return rows;
}

/** 把 ? 占位符转换为 MSSQL 的 @pN */
function toMssqlParams(sql) {
  let i = 0;
  return String(sql).replace(/\?/g, () => '@p' + (++i));
}

/** 把 ? 占位符转换为 PostgreSQL 的 $N */
function toPgParams(sql) {
  let i = 0;
  return String(sql).replace(/\?/g, () => '$' + (++i));
}

/** 把 ? 占位符转换为 Oracle 的 :pN */
function toOracleParams(sql) {
  let i = 0;
  return String(sql).replace(/\?/g, () => ':p' + (++i));
}

/** 查询单行 */
async function queryOne(ds, sql, params) {
  const rows = await query(ds, sql, params);
  return rows.length ? rows[0] : null;
}

/** 连通性测试 */
async function testConnection(ds) {
  const started = Date.now();
  try {
    const type = ds.type || 'mysql';
    let row;
    if (type === 'mssql') {
      row = await queryOne(ds, 'SELECT @@VERSION AS v', []);
    } else {
      row = await queryOne(ds, 'SELECT VERSION() AS v', []);
    }
    return {
      ok: true,
      version: row ? String(row.v || '').split('\n')[0].slice(0, 120) : '',
      elapsed: Date.now() - started,
    };
  } catch (err) {
    return { ok: false, message: err.message, elapsed: Date.now() - started };
  }
}

/** 列出库中的表 */
async function listTables(ds, keyword) {
  const type = ds.type || 'mysql';
  if (type === 'mssql') {
    const rows = await query(
      ds,
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE' ${keyword ? 'AND TABLE_NAME LIKE ?' : ''}
        ORDER BY TABLE_NAME`,
      keyword ? [`%${keyword}%`] : []
    );
    return rows.map((r) => ({ name: r.name, comment: '' }));
  }
  const rows = await query(
    ds,
    `SELECT TABLE_NAME AS name, TABLE_COMMENT AS comment FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() ${keyword ? 'AND TABLE_NAME LIKE ?' : ''}
      ORDER BY TABLE_NAME`,
    keyword ? [`%${keyword}%`] : []
  );
  return rows.map((r) => ({ name: r.name, comment: r.comment || '' }));
}

/** 列出表字段 */
async function listColumns(ds, table) {
  const type = ds.type || 'mysql';
  if (type === 'mssql') {
    const rows = await query(
      ds,
      `SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType,
              CHARACTER_MAXIMUM_LENGTH AS maxLen
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [table]
    );
    return rows.map((r) => ({
      name: r.name,
      type: String(r.dataType || '').toUpperCase(),
      comment: '',
    }));
  }
  const rows = await query(
    ds,
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS columnType, DATA_TYPE AS dataType,
            CHARACTER_MAXIMUM_LENGTH AS maxLen, COLUMN_COMMENT AS comment
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [table]
  );
  return rows.map((r) => ({
    name: r.name,
    type: r.columnType || r.dataType,
    comment: r.comment || '',
  }));
}

/** 表是否存在 */
async function tableExists(ds, table) {
  const type = ds.type || 'mysql';
  if (type === 'mssql') {
    const row = await queryOne(
      ds,
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = ?`,
      [table]
    );
    return Number((row && row.c) || 0) > 0;
  }
  const row = await queryOne(
    ds,
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number((row && row.c) || 0) > 0;
}

/** 标识符引用 */
function quoteIdent(ds, name) {
  const type = (ds && ds.type) || 'mysql';
  if (type === 'mssql') {
    return '[' + String(name).replace(/]/g, ']]') + ']';
  }
  return '`' + String(name).replace(/`/g, '``') + '`';
}

/** 分页语法 */
function paginate(ds, sql, limit, offset) {
  const type = (ds && ds.type) || 'mysql';
  if (type === 'mssql') {
    // MSSQL 需要 ORDER BY 才能使用 OFFSET/FETCH
    const hasOrder = /order\s+by/i.test(sql);
    const base = hasOrder ? sql : sql + ' ORDER BY (SELECT NULL)';
    return `${base} OFFSET ${Number(offset) || 0} ROWS FETCH NEXT ${Number(limit) || 20} ROWS ONLY`;
  }
  return `${sql} LIMIT ${Number(limit) || 20} OFFSET ${Number(offset) || 0}`;
}

/** 统计连接池状态 */
function poolStats() {
  const out = [];
  pools.forEach((v, k) => {
    out.push({ key: k, type: v.type, signature: v.signature.replace(/\|[^|]*\|/, '|***|') });
  });
  return out;
}

module.exports = {
  DRIVERS,
  DIALECTS,
  DRIVER_HINTS,
  driverOf,
  dialectOf,
  driverGroups,
  driverAvailable,
  buildConfig,
  defaultDataSource,
  signatureOf,
  getPool,
  invalidate,
  invalidateAll,
  query,
  raw,
  queryOne,
  testConnection,
  listTables,
  listColumns,
  tableExists,
  quoteIdent,
  paginate,
  toMssqlParams,
  toPgParams,
  toOracleParams,
  poolStats,
};
