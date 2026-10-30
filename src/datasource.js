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

/* ══════════════════════════════════════════════════════════════════
 *  SQL 标识符自动加引号（V4.1）
 *
 *  背景：用户建 SQL 数据集时写了 `select * from zkcrm-ry`，
 *  表名含连字符却未加引号，MySQL 把 `zkcrm-ry` 解析成 `zkcrm - ry`，
 *  分页追加 LIMIT 后报 ER_PARSE_ERROR：
 *    You have an error in your SQL syntax; ... near '-ry LIMIT 20 OFFSET 0' at line 1
 *
 *  做法：词法级扫描，只在「表名位置」（FROM / JOIN / UPDATE / INTO 之后）
 *  对裸标识符按方言补引号，其余字节原样输出：
 *    - 跳过单/双引号字符串、反引号/方括号/双引号已引用标识符
 *    - 跳过 -- 行注释、/* *\/ 块注释
 *    - 跳过括号内的表达式（子查询里的 FROM 会被同一套规则独立处理）
 *    - 跳过函数调用（标识符后紧跟 `(`）与纯数字（SUBSTRING(x FROM 1 FOR 2)）
 *    - 幂等：已加引号的标识符不会被二次引用，结果与原 SQL 完全一致
 * ══════════════════════════════════════════════════════════════════ */

/** 按方言把单个标识符包成带引号的形式（内部引用符会被转义） */
function quoteIdentText(dialect, name) {
  if (dialect === 'mssql') return '[' + String(name).replace(/]/g, ']]') + ']';
  if (dialect === 'postgres' || dialect === 'oracle' || dialect === 'sqlite') {
    return '"' + String(name).replace(/"/g, '""') + '"';
  }
  return '`' + String(name).replace(/`/g, '``') + '`'; // mysql / tidb / oceanbase / gbase / clickhouse
}

/** 会触发「下一个词是表名」的关键字 */
const IDENT_TRIGGERS = new Set(['from', 'join', 'update', 'into']);

/** 这些关键字出现时，说明 FROM 列表已结束（后面的逗号不再表示表） */
const LIST_TERMINATORS = new Set([
  'where', 'group', 'order', 'having', 'limit', 'union', 'set', 'on', 'using',
  'values', 'select', 'window', 'qualify', 'offset', 'fetch', 'returning',
  'for', 'lock', 'procedure',
]);

/**
 * 常见 MySQL 保留字：出现在表名位置时必然是「用保留字当了表名」，
 * 必须加引号才能执行。
 *
 * 刻意排除 DUAL / LATERAL 这类在表名位置合法的非保留关键字，
 * 函数名（后面紧跟 `(`）由扫描器统一跳过。
 */
const RESERVED_WORDS = new Set([
  'add', 'all', 'alter', 'analyze', 'and', 'as', 'asc', 'before', 'between', 'bigint',
  'binary', 'blob', 'both', 'by', 'call', 'cascade', 'case', 'change', 'char',
  'character', 'check', 'collate', 'column', 'condition', 'constraint', 'continue',
  'convert', 'create', 'cross', 'cursor', 'database', 'databases', 'dec', 'decimal',
  'declare', 'default', 'delayed', 'delete', 'desc', 'describe', 'deterministic',
  'distinct', 'distinctrow', 'div', 'double', 'drop', 'each', 'else', 'elseif',
  'enclosed', 'escaped', 'exists', 'exit', 'explain', 'false', 'float',
  'force', 'foreign', 'from', 'fulltext', 'generated', 'get', 'grant', 'group',
  'grouping', 'groups', 'having', 'high_priority', 'if', 'ignore', 'in', 'index',
  'infile', 'inner', 'inout', 'insensitive', 'insert', 'int', 'integer', 'interval',
  'into', 'is', 'iterate', 'join', 'key', 'keys', 'kill', 'lag', 'last', 'lead',
  'leading', 'leave', 'left', 'like', 'limit', 'linear', 'lines', 'load',
  'localtime', 'long', 'loop', 'match', 'maxvalue', 'mod', 'natural', 'not',
  'no_write_to_binlog', 'nth_value', 'ntile', 'null', 'numeric', 'of', 'optimize',
  'option', 'optionally', 'or', 'order', 'out', 'outer', 'outfile', 'over',
  'partition', 'percent_rank', 'precision', 'primary', 'procedure', 'purge',
  'range', 'rank', 'read', 'reads', 'real', 'recursive', 'references', 'regexp',
  'release', 'rename', 'repeat', 'replace', 'require', 'resignal', 'restrict',
  'return', 'revoke', 'right', 'rlike', 'row', 'rows', 'row_number', 'schema',
  'schemas', 'select', 'sensitive', 'separator', 'set', 'share', 'show', 'signal',
  'smallint', 'spatial', 'specific', 'sql', 'sqlexception', 'sqlstate', 'sqlwarning',
  'ssl', 'starting', 'stored', 'straight_join', 'system', 'table', 'terminated',
  'then', 'tinyint', 'to', 'trailing', 'trigger', 'true', 'undo', 'union', 'unique',
  'using', 'utc_date', 'utc_time', 'utc_timestamp', 'values', 'varbinary', 'varchar',
  'varcharacter', 'varying', 'virtual', 'when', 'where', 'while', 'window', 'with',
  'write', 'xor', 'year_month', 'zerofill',
]);

/** 裸标识符允许的字符集（不含这些字符就必须加引号） */
const SAFE_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/** 该标识符是否必须加引号 */
function needsQuote(word) {
  const w = String(word || '');
  if (!w) return false;
  if (w.startsWith('@')) return false;        // MSSQL 表变量 @t / MySQL 用户变量
  if (/^\d+$/.test(w)) return false;          // SUBSTRING(x FROM 1 FOR 2) 之类的数字
  if (!SAFE_IDENT_RE.test(w)) return true;    // 含 - . 空格 中文 等
  return RESERVED_WORDS.has(w.toLowerCase()); // 保留字当表名
}

/** 跳过整段引号区域（字符串字面量 / 已引用标识符），返回结束位置 */
function skipQuoted(sql, i) {
  const ch = sql[i];
  if (ch === "'" || ch === '"') {
    let j = i + 1;
    while (j < sql.length) {
      const c = sql[j];
      if (c === '\\') { j += 2; continue; }
      if (c === ch) {
        if (sql[j + 1] === ch) { j += 2; continue; } // '' 转义
        return j + 1;
      }
      j += 1;
    }
    return sql.length;
  }
  if (ch === '`') {
    let j = i + 1;
    while (j < sql.length) {
      if (sql[j] === '`') {
        if (sql[j + 1] === '`') { j += 2; continue; }
        return j + 1;
      }
      j += 1;
    }
    return sql.length;
  }
  if (ch === '[') {
    let j = i + 1;
    while (j < sql.length) {
      if (sql[j] === ']') {
        if (sql[j + 1] === ']') { j += 2; continue; }
        return j + 1;
      }
      j += 1;
    }
    return sql.length;
  }
  return i;
}

/** 跳过注释；不是注释返回 i */
function skipComment(sql, i) {
  if (sql[i] === '-' && sql[i + 1] === '-') {
    let j = i + 2;
    while (j < sql.length && sql[j] !== '\n') j += 1;
    return j;
  }
  if (sql[i] === '/' && sql[i + 1] === '*') {
    const end = sql.indexOf('*/', i + 2);
    return end < 0 ? sql.length : end + 2;
  }
  return i;
}

/** 标识符 run 的终止字符 */
function isRunStop(ch) {
  if (ch === undefined) return true;
  if (/\s/.test(ch)) return true;
  return ',;()\'"`[].'.includes(ch);
}

/**
 * 词法级为表名位置的裸标识符补引号。
 *
 * @param {object|string} ds 数据源（取 ds.type 决定方言），也可直接传方言名
 * @param {string} sql 原始 SQL
 * @returns {string} 补好引号的 SQL（幂等）
 */
function normalizeSql(ds, sql) {
  const source = typeof ds === 'string' ? { type: ds } : (ds || {});
  const dialect = dialectOf(source.type || 'mysql');
  const text = String(sql == null ? '' : sql);
  if (!text.trim()) return text;

  const out = [];
  let i = 0;
  let pending = false;      // 下一个词是表名
  let fromList = false;     // 处于 FROM/UPDATE/INTO 的表清单里
  let triggerDepth = 0;     // 触发关键字所在括号深度
  let depth = 0;

  while (i < text.length) {
    const ch = text[i];

    // 注释：原样保留
    const afterComment = skipComment(text, i);
    if (afterComment !== i) {
      out.push(text.slice(i, afterComment));
      i = afterComment;
      continue;
    }

    // 空白：原样保留，pending 不变
    if (/\s/.test(ch)) {
      out.push(ch);
      i += 1;
      continue;
    }

    // 引号区域：原样保留（字符串字面量 / 已引用标识符）
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const end = skipQuoted(text, i);
      out.push(text.slice(i, end));
      i = end;
      pending = false; // 已引用的表名，后面是别名，不是表名
      continue;
    }

    if (ch === '(') {
      depth += 1;
      pending = false; // FROM (  → 子查询/表达式，不是表名
      fromList = false;
      out.push(ch);
      i += 1;
      continue;
    }

    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      pending = false;
      fromList = false;
      out.push(ch);
      i += 1;
      continue;
    }

    if (ch === ',') {
      // 只在表清单同一层级的逗号后面继续当表名
      if (fromList && depth === triggerDepth) pending = true;
      out.push(ch);
      i += 1;
      continue;
    }

    // 表名位置：读取裸标识符 run（可带 . 分段），按需加引号
    if (pending) {
      let emitted = false;
      while (i < text.length) {
        const start = i;
        let end = i;
        while (end < text.length && !isRunStop(text[end])) end += 1;
        const word = text.slice(start, end);
        if (!word) break;
        out.push(needsQuote(word) ? quoteIdentText(dialect, word) : word);
        emitted = true;
        i = end;
        if (text[i] === '.') { out.push('.'); i += 1; continue; } // db.tbl 继续
        break;
      }
      pending = false;
      if (!emitted) {
        // 形如 FROM 'x' / FROM . 的异常写法：原样前进一个字符
        out.push(text[i]);
        i += 1;
      }
      continue;
    }

    // 普通词
    if (/[A-Za-z0-9_$#@\u4e00-\u9fa5]/.test(ch)) {
      let end = i;
      while (end < text.length && !isRunStop(text[end])) end += 1;
      const word = text.slice(i, end);
      const lower = word.toLowerCase();
      let next = end;
      while (next < text.length && /\s/.test(text[next])) next += 1;
      const isCall = text[next] === '(';

      if (IDENT_TRIGGERS.has(lower) && !isCall) {
        out.push(word);
        pending = true;
        fromList = true;
        triggerDepth = depth;
      } else if (LIST_TERMINATORS.has(lower) && !isCall) {
        out.push(word);
        pending = false;
        fromList = false;
      } else {
        out.push(word);
        pending = false;
      }
      i = end;
      continue;
    }

    // 其它字符（运算符等）
    out.push(ch);
    i += 1;
  }

  return out.join('');
}

/**
 * 把数据库异常翻译成中文可读错误（保留原始错误码/SQL 便于排查）。
 *
 * @param {object|string} ds 数据源
 * @param {Error} err 原始 DB 异常
 * @param {string} sql 实际执行的 SQL（含分页）
 * @param {string} originalSql 用户提交的原始 SQL
 * @param {string} [normalizedSql] 自动加引号后的 SQL（不含分页）；
 *        传了才能准确判断「是否真的补过引号」，否则退化为与 originalSql 比较。
 *
 * 返回的 Error 上带有 code / errno / sqlMessage / sql / originalSql /
 * normalizedSql / hint / isDbError，路由层可直接结构化返回给前端。
 */
function describeDbError(ds, err, sql, originalSql, normalizedSql) {
  const source = typeof ds === 'string' ? { type: ds } : (ds || {});
  const type = source.type || 'mysql';
  const e = err || {};
  const code = String(e.code || '');
  const errno = e.errno === undefined || e.errno === null ? null : e.errno;
  const sqlMessage = String(e.sqlMessage || e.message || '');
  const shownSql = String(sql || '');
  const origSql = originalSql === undefined ? shownSql : String(originalSql || '');
  const normSql = normalizedSql === undefined || normalizedSql === null
    ? null
    : String(normalizedSql || '');
  // 只有「加引号」真的改变了 SQL 才算自动修复；单纯追加分页不算
  const autoQuoted = normSql !== null
    ? origSql.trim() !== normSql.trim()
    : !!origSql && !!shownSql && origSql.trim() !== shownSql.trim();

  let hint = '';
  let msg = '';

  if (code === 'ER_PARSE_ERROR' || errno === 1064) {
    msg = 'SQL 语法错误';
    hint = '常见原因：表名/字段名包含连字符（-）、空格、中文或以数字开头，或使用了保留字当表名，但没有加引号。'
      + (autoQuoted
        ? '系统已自动为 FROM/JOIN 后的表名补引号后再执行；若仍报错，请检查表名拼写或手动加引号。'
        : '请检查表名/字段名是否需要加引号，或是否拼写正确。');
  } else if (code === 'ER_NO_SUCH_TABLE' || errno === 1146) {
    msg = '数据表不存在';
    hint = '请确认表名拼写正确，且位于所选数据源的当前库中。';
  } else if (code === 'ER_BAD_FIELD_ERROR' || errno === 1054) {
    msg = '字段不存在';
    hint = '请确认字段名拼写正确；字段名含特殊字符或为保留字时同样需要加引号。';
  } else if (code === 'ER_ACCESS_DENIED_ERROR' || errno === 1045) {
    msg = '数据库账号或密码不正确';
    hint = '请在「数据源」中检查账号密码。';
  } else if (code === 'ER_DBACCESS_DENIED_ERROR' || errno === 1044) {
    msg = '当前数据库账号没有该库的访问权限';
    hint = '请为数据源账号授予该库的只读权限。';
  } else if (code === 'ER_TABLEACCESS_DENIED_ERROR' || errno === 1142) {
    msg = '当前数据库账号没有该表的访问权限';
    hint = '请为数据源账号授予该表的 SELECT 权限。';
  } else if (code === 'PROTOCOL_SEQUENCE_TIMEOUT' || code === 'ETIMEDOUT'
    || /timeout|timed out/i.test(sqlMessage)) {
    msg = '查询超时';
    hint = 'SQL 执行时间过长，请缩小查询范围（加 WHERE 条件 / 减少 JOIN）后重试。';
  } else if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
    msg = '无法连接数据源';
    hint = '请检查数据源的地址、端口与网络连通性。';
  } else if (code === 'ER_NO_DB_ERROR' || errno === 1046) {
    msg = '未选择数据库';
    hint = '请在数据源配置中填写数据库名。';
  } else {
    msg = 'SQL 执行失败';
    hint = '请检查 SQL 语句与数据源配置。';
  }

  let message = `${msg}（${code || 'DB_ERROR'}${errno ? ' ' + errno : ''}）：${sqlMessage}`;
  if (autoQuoted) {
    message += '\n系统已对表名自动加引号后再执行；若表名本身有误请修正后重试。';
  }
  message += `\n原始 SQL：${origSql}`;
  if (autoQuoted) message += `\n修复后 SQL：${shownSql}`;

  const out = new Error(message);
  out.code = code || 'DB_ERROR';
  out.errno = errno;
  out.sqlMessage = sqlMessage;
  out.sql = shownSql;
  out.originalSql = origSql;
  out.normalizedSql = autoQuoted ? (normSql !== null ? normSql : shownSql) : null;
  out.autoQuoted = autoQuoted;
  out.hint = hint;
  out.dialect = type;
  out.isDbError = true;
  return out;
}

/** 去掉 SQL 尾部的分号/空白，便于追加分页 */
function trimSqlTail(sql) {
  let s = String(sql || '').trim();
  for (let k = 0; k < 5; k += 1) {
    const next = s.replace(/;+\s*$/, '').trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

/** 判断 SQL 是否已经自带行数限制（避免重复追加 LIMIT） */
function hasRowLimit(sql) {
  const s = String(sql || '');
  // 去掉字符串/注释后再判断，避免把 'limit' 字面量当成子句
  const flat = s
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.|"")*"/g, '""')
    .replace(/`(?:[^`]|``)*`/g, '``')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  return /\blimit\s+\d+(\s*,\s*\d+)?(\s+offset\s+\d+)?\s*$/i.test(flat)
    || /\blimit\s+\?/i.test(flat)
    || /\boffset\s+\d+\s+rows\b/i.test(flat)
    || /\bfetch\s+(first|next)\b/i.test(flat)
    || /\btop\s*\(?\s*\d+/i.test(flat)
    || /\brownum\b/i.test(flat);
}

/** 分页语法 */
function paginate(ds, sql, limit, offset) {
  const type = (ds && ds.type) || 'mysql';
  const base = trimSqlTail(sql);
  const lim = Number(limit) || 20;
  const off = Number(offset) || 0;

  // 已经自带行数限制：不再追加，避免出现两个 LIMIT 导致语法错误
  if (hasRowLimit(base)) return base;

  if (type === 'mssql') {
    // MSSQL 需要 ORDER BY 才能使用 OFFSET/FETCH
    const hasOrder = /\border\s+by\b/i.test(base);
    const withOrder = hasOrder ? base : base + ' ORDER BY (SELECT NULL)';
    return `${withOrder} OFFSET ${off} ROWS FETCH NEXT ${lim} ROWS ONLY`;
  }

  // FOR UPDATE / FOR SHARE / LOCK IN SHARE MODE 必须放在 LIMIT 之后
  const tailMatch = base.match(/\s+(for\s+(update|share)|lock\s+in\s+share\s+mode)\s*$/i);
  if (tailMatch) {
    const head = base.slice(0, tailMatch.index);
    return `${head} LIMIT ${lim} OFFSET ${off}${tailMatch[0]}`;
  }

  return `${base} LIMIT ${lim} OFFSET ${off}`;
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
  quoteIdentText,
  normalizeSql,
  describeDbError,
  trimSqlTail,
  hasRowLimit,
  paginate,
  toMssqlParams,
  toPgParams,
  toOracleParams,
  poolStats,
};
