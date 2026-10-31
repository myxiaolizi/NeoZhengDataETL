'use strict';

const db = require('./db');
const config = require('./config');
const { quoteIdent } = require('./ident');
const fields = require('./fields');

/**
 * 动态表结构管理
 *
 * 需求 5：数据列以「简道云字段名称（中文）」作为 COMMENT，
 *         保证数据明细与字段结构页面的可读性。
 * 需求 7：为需要解析的字段额外创建「解析列」（<column>_p），
 *         存放加工后的可读值（如 {"name":"郭晨"} → 郭晨）；
 *         数组字段可展开为独立子表。
 *
 * ⚠️ 安全约束：本应用只允许操作以 config.tablePrefix（默认 jdywh_）开头的表。
 *    所有 DDL / DROP 操作前都会校验表名归属，避免误伤同库中的其他业务表。
 */

/** 表名前缀白名单校验（不通过则抛错） */
function assertOwnTable(table) {
  const name = String(table || '');
  const prefix = config.tablePrefix;
  if (!name.startsWith(prefix)) {
    throw new Error(`安全拦截：拒绝操作非本应用创建的表「${name}」（表名必须以 ${prefix} 开头）`);
  }
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`安全拦截：表名包含非法字符「${name}」`);
  }
  return name;
}

/** 判断是否为本应用创建的表 */
function isOwnTable(table) {
  const name = String(table || '');
  return name.startsWith(config.tablePrefix) && /^[A-Za-z0-9_]+$/.test(name);
}

/** 当前表名前缀 */
function tablePrefix() {
  return config.tablePrefix;
}

/** 安全执行 DDL：先校验涉及的表名归属 */
async function safeRaw(sql, params, tables) {
  (tables || []).forEach(assertOwnTable);
  return db.raw(sql, params);
}

const META_COLUMNS = [
  { name: 'id', type: 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', comment: '自增主键', sys: true },
  { name: 'jdy_data_id', type: 'VARCHAR(191) NULL', comment: '数据ID', sys: true },
  { name: 'jdy_form_name', type: 'VARCHAR(191) NULL', comment: '表单名称', sys: true },
  { name: 'jdy_op', type: 'VARCHAR(32) NULL', comment: '推送事件', sys: true },
  { name: 'jdy_op_time', type: 'BIGINT NULL', comment: '推送时间戳(ms)', sys: true },
  { name: 'raw_json', type: 'LONGTEXT NULL', comment: '原始推送报文', sys: true },
  { name: 'received_at', type: 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP', comment: '接收时间', sys: true },
  { name: 'updated_at', type: 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', comment: '更新时间', sys: true },
];

/* ============ 表名 ============ */

/** 原始数据表（解析前）：存放简道云推送的原始 JSON 值 */
function makeTableName(projectId) {
  return `jdywh_data_${Number(projectId)}`;
}

/** 解析数据表（解析后）：存放加工后的可读值 */
function makeParsedTableName(projectId) {
  return `jdywh_parsed_${Number(projectId)}`;
}

function makeLogTableName(projectId) {
  return `jdywh_log_${Number(projectId)}`;
}

function makeSubTableName(projectId, fieldKey) {
  const safe = String(fieldKey).replace(/^_widget_/, 'w').replace(/[^0-9A-Za-z_]/g, '_').slice(0, 40);
  return `jdywh_sub_${Number(projectId)}_${safe}`;
}

/** 兼容旧命名：早期版本把解析列放在同一张表（<column>_p） */
function legacyParsedColumn(column) {
  return `${column}_p`;
}

/* ============ 存在性判断 ============ */

async function tableExists(table) {
  const rows = await db.query(
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return rows.length > 0;
}

async function columnInfo(table) {
  const rows = await db.query(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS columnType, DATA_TYPE AS dataType,
            CHARACTER_MAXIMUM_LENGTH AS maxLen, COLUMN_COMMENT AS comment
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [table]
  );
  return rows.map((r) => {
    let type = String(r.dataType || '').toUpperCase();
    if (type === 'VARCHAR' && r.maxLen) type = `VARCHAR(${r.maxLen})`;
    return { name: r.name, columnType: r.columnType, dataType: r.dataType, type, comment: r.comment };
  });
}

async function columnNames(table) {
  const cols = await columnInfo(table);
  return cols.map((c) => c.name);
}

/**
 * 列名集合（Set），供「按列名查存在性 / 增量补列」的场景使用。
 *
 * 背景（V7 修复）：ensureTableFor() 原来直接用 columnNames() 的返回值当 Set 用
 * （existing.size / existing.has / existing.add），但 columnNames() 返回的是**数组**：
 *   - 数组没有 .has / .add → 表已存在且需要补列时抛 `existing.has is not a function`
 *   - 数组的 .size 恒为 undefined → 空表判断 `existing.size === 0` 也失效
 * 新建表路径碰不到，所以历史用例没暴露；一旦「目标表已存在 + 字段有变化」就会失败。
 *
 * @param {string} table
 * @returns {Promise<Set<string>>}
 */
async function columnNameSet(table) {
  const cols = await columnInfo(table);
  return new Set(cols.map((c) => c.name));
}

/**
 * 统计各列的非空行数，用于「同一字段存在多套历史列时择优」。
 * 例：widget_1791449342208 有 59 行数据、w_1791449342208 为空 → 选前者。
 *
 * @param {string} table
 * @param {string[]} [only] 只统计这些列（不传则统计全部业务列）
 * @returns {Promise<Object>} { 列名: 非空行数 }
 */
async function columnFillStats(table, only) {
  if (!(await tableExists(table))) return {};
  assertOwnTable(table);

  const all = await columnInfo(table);
  const targets = (only && only.length ? only : all.map((c) => c.name))
    .filter((c) => all.some((x) => x.name === c))
    .filter((c) => !['id', 'raw_json', 'received_at', 'updated_at'].includes(c));
  if (!targets.length) return {};

  const exprs = targets.map((c) => `SUM(CASE WHEN ${quoteIdent(c)} IS NOT NULL THEN 1 ELSE 0 END) AS ${quoteIdent(c)}`);
  const row = await db.queryOne(`SELECT ${exprs.join(', ')} FROM ${quoteIdent(table)}`);
  const out = {};
  targets.forEach((c) => { out[c] = Number((row && row[c]) || 0); });
  return out;
}

/* ============ 类型推断 ============ */

function inferColumnType(sample, declaredType) {
  const t = String(declaredType || '').toLowerCase();
  if (t === 'number') return 'DOUBLE';
  if (t === 'array' || t === 'json') return 'JSON';
  if (sample === null || sample === undefined) {
    if (t === 'string') return 'VARCHAR(255)';
    return 'TEXT';
  }
  if (typeof sample === 'number') return 'DOUBLE';
  if (typeof sample === 'boolean') return 'TINYINT(1)';
  if (typeof sample === 'object') return 'JSON';
  if (typeof sample === 'string') {
    const len = Buffer.byteLength(sample, 'utf8');
    if (len <= 255) return 'VARCHAR(255)';
    if (len <= 1000) return 'VARCHAR(1000)';
    return 'TEXT';
  }
  return 'TEXT';
}

/**
 * 解析列固定用 VARCHAR(500)。
 * 说明：MySQL 单行上限 65535 字节，字段较多时若解析列也用 1000 会超限，
 *       500 足够存放解析后的可读文本（成员名、手机号、地址、时间）。
 */
function parsedColumnType() {
  return 'VARCHAR(500)';
}

function upgradeColumnType(current, next) {
  if (!current) return next;
  const rank = (t) => {
    if (t === 'TINYINT(1)') return 0;
    if (t === 'DOUBLE') return 1;
    if (t.startsWith('VARCHAR(')) return 2;
    if (t === 'TEXT') return 3;
    if (t === 'JSON') return 3;
    return 3;
  };
  if (rank(next) > rank(current)) return next;
  if (current.startsWith('VARCHAR(') && next.startsWith('VARCHAR(')) {
    const a = parseInt(current.slice(8, -1), 10);
    const b = parseInt(next.slice(8, -1), 10);
    if (b > a) return next;
  }
  return current;
}

/**
 * 两个列类型是否等价（用于跳过无意义的 ALTER TABLE MODIFY COLUMN）
 *
 * 背景：每次推送都会为全部字段调用 ensureFieldColumn，原实现无论类型/注释是否变化
 * 都会执行一条 ALTER TABLE ... MODIFY COLUMN。实测单条 DDL 约 18~30ms，
 * crm 项目 67 个字段 × 2 张表 ≈ 134 条 DDL → 单次推送 2~4 秒，
 * 并发批量推送时 MDL 排队放大到 10~37 秒，远超简道云推送 5 秒超时阈值
 * （表现为简道云侧报 "timeout of 5000ms exceeded" 并重试）。
 *
 * 这里做规范化比较：忽略大小写/空格差异，并把 TINYINT(1) 与 TINYINT 视为同一类型。
 */
function sameColumnType(a, b) {
  if (!a || !b) return false;
  const norm = (t) => String(t).toUpperCase().replace(/\s+/g, '').replace(/^TINYINT\(1\)$/, 'TINYINT');
  return norm(a) === norm(b);
}

/** 值长度是否放得下 */
function fits(type, value) {
  if (value === null || value === undefined) return true;
  if (!type.startsWith('VARCHAR(')) return true;
  const max = parseInt(type.slice(8, -1), 10);
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.byteLength(s, 'utf8') <= max;
}

function toScalar(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/* ============ 建表 / 建列 ============ */

/**
 * 按字段定义在指定数据源上创建表（用于数据处理流程的输出）
 * @param {object} ds 数据源（默认本机）
 * @param {string} table 表名（需以 tablePrefix 开头）
 * @param {Array} defs 字段定义 [{column_name, field_name, field_key}]
 * @param {object} sample 样本行（用于推断类型）
 */
async function ensureTableFor(ds, table, defs, sample) {
  assertOwnTable(table);

  const existing = await columnNameSet(table);
  if (existing.size === 0) {
    const metaCols = [
      '`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT "自增主键"',
      '`created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT "写入时间"',
    ];
    const cols = (defs || []).map((d) => {
      const col = d.column_name || d.field_key;
      const comment = String(d.field_name || col).replace(/'/g, "''").slice(0, 200);
      const type = safeTypeFor(inferColumnType(sample ? sample[col] : null, d.field_type), 0);
      return `\`${col}\` ${type.type} NULL COMMENT '${comment}'`;
    });

    await safeRaw(
      `CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (
        ${metaCols.concat(cols).join(',\n        ')},
        PRIMARY KEY (id),
        KEY idx_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='流程输出表'`,
      [],
      [table]
    );
    return { created: true, columns: (defs || []).length };
  }

  // 已存在：补齐缺失列
  const added = [];
  for (const d of (defs || [])) {
    const col = d.column_name || d.field_key;
    if (existing.has(col)) continue;
    const comment = String(d.field_name || col).replace(/'/g, "''").slice(0, 200);
    const type = safeTypeFor(inferColumnType(sample ? sample[col] : null, d.field_type), 0);
    await safeRaw(
      `ALTER TABLE ${quoteIdent(table)} ADD COLUMN \`${col}\` ${type.type} NULL COMMENT '${comment}'`,
      [],
      [table]
    );
    added.push(col);
  }
  return { created: false, added };
}

/**
 * 项目表结构校验缓存：{ projectId: 校验时间戳 }
 *
 * ensureProjectTables 的逻辑是幂等的（建表 + 补唯一键 + 补日志列），
 * 每次推送原本要跑 8~10 条 information_schema 查询。这里按项目缓存 60 秒，
 * 把稳态推送的这部分往返降到 0，同时保留周期性自愈能力。
 */
const ENSURED_TTL_MS = 60 * 1000;
const ensuredProjects = new Map();

/** 让某个项目的表结构校验缓存失效（字段/表结构变更后调用） */
function invalidateProjectCache(projectId) {
  ensuredProjects.delete(String(projectId));
}

async function ensureProjectTables(projectId) {
  const dataTable = makeTableName(projectId);
  const parsedTable = makeParsedTableName(projectId);
  const logTable = makeLogTableName(projectId);

  const cacheKey = String(projectId);
  const ensuredAt = ensuredProjects.get(cacheKey);
  if (ensuredAt && Date.now() - ensuredAt < ENSURED_TTL_MS) {
    return { dataTable, parsedTable, logTable };
  }

  // 原始数据表（解析前）
  if (!(await tableExists(dataTable))) {
    const cols = META_COLUMNS.map((c) => `\`${c.name}\` ${c.type} COMMENT '${c.comment}'`).join(',\n        ');
    await safeRaw(`CREATE TABLE IF NOT EXISTS ${quoteIdent(dataTable)} (
        ${cols},
        PRIMARY KEY (id),
        UNIQUE KEY uk_jdy_data_id (jdy_data_id),
        KEY idx_jdy_op_time (jdy_op_time)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='原始数据表（解析前）'`
    );
  } else {
    await ensureDataIdUniqueKey(dataTable);
  }

  // 解析数据表（解析后）——结构与原始表一致，存放加工后的可读值
  if (!(await tableExists(parsedTable))) {
    const cols = META_COLUMNS.map((c) => `\`${c.name}\` ${c.type} COMMENT '${c.comment}'`).join(',\n        ');
    await safeRaw(`CREATE TABLE IF NOT EXISTS ${quoteIdent(parsedTable)} (
        ${cols},
        PRIMARY KEY (id),
        UNIQUE KEY uk_jdy_data_id (jdy_data_id),
        KEY idx_jdy_op_time (jdy_op_time)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='解析数据表（解析后）'`
    );
  } else {
    await ensureDataIdUniqueKey(parsedTable);
  }

  if (!(await tableExists(logTable))) {
    await safeRaw(`CREATE TABLE IF NOT EXISTS ${quoteIdent(logTable)} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        op VARCHAR(64) NULL,
        op_label VARCHAR(64) NULL,
        deliver_id VARCHAR(128) NULL,
        data_id VARCHAR(191) NULL,
        form_name VARCHAR(191) NULL,
        entry_id VARCHAR(64) NULL,
        op_time BIGINT NULL,
        signature_ok TINYINT(1) NOT NULL DEFAULT 0,
        signature_msg VARCHAR(255) NULL,
        result VARCHAR(32) NOT NULL DEFAULT 'success',
        message TEXT NULL,
        source_ip VARCHAR(64) NULL,
        field_count INT NOT NULL DEFAULT 0,
        payload LONGTEXT NULL,
        change_summary TEXT NULL COMMENT '本次变更的自然语言描述',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_op (op),
        KEY idx_data_id (data_id),
        KEY idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='简道云推送接收日志'`
    );
  }

  // 老库补列：变更描述（历史日志保持 change_summary 为空，页面会即时补算）
  await ensureLogSummaryColumn(logTable);

  ensuredProjects.set(cacheKey, Date.now());

  return { dataTable, parsedTable, logTable };
}

/** 为日志表补 change_summary 列（幂等） */
async function ensureLogSummaryColumn(logTable) {
  if (!(await tableExists(logTable))) return false;
  const cols = await columnNames(logTable);
  if (cols.includes('change_summary')) return false;
  await safeRaw(`ALTER TABLE ${quoteIdent(logTable)}
      ADD COLUMN change_summary TEXT NULL COMMENT '本次变更的自然语言描述' AFTER payload`, [], [logTable]);
  return true;
}

async function ensureDataIdUniqueKey(dataTable) {
  const idx = await db.query(
    `SELECT INDEX_NAME AS name FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'jdy_data_id' AND NON_UNIQUE = 0`,
    [dataTable]
  );
  if (idx.length) return false;

  await safeRaw(
    `DELETE t1 FROM ${quoteIdent(dataTable)} t1
       JOIN ${quoteIdent(dataTable)} t2
         ON t1.jdy_data_id = t2.jdy_data_id AND t1.id < t2.id
      WHERE t1.jdy_data_id IS NOT NULL`,
    [],
    [dataTable]
  );
  const anyIdx = await db.query(
    `SELECT INDEX_NAME AS name FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = 'idx_jdy_data_id'`,
    [dataTable]
  );
  if (anyIdx.length) await safeRaw(`ALTER TABLE ${quoteIdent(dataTable)} DROP INDEX idx_jdy_data_id`, [], [dataTable]);
  await safeRaw(`ALTER TABLE ${quoteIdent(dataTable)} ADD UNIQUE KEY uk_jdy_data_id (jdy_data_id)`, [], [dataTable]);
  console.log(`[migrate] ${dataTable}.uk_jdy_data_id 已添加`);
  return true;
}

/**
 * 估算一个列类型占用的行内字节数（MySQL 单行上限 65535）
 * VARCHAR 按 utf8mb4 最坏情况 4 字节/字符计算
 */
function rowBytesOf(type) {
  const t = String(type || '').toUpperCase();
  if (t.startsWith('VARCHAR(')) {
    return parseInt(t.slice(8, -1), 10) * 4 + 2;
  }
  if (t === 'DOUBLE') return 8;
  if (t === 'TINYINT(1)') return 1;
  if (t === 'BIGINT UNSIGNED' || t === 'BIGINT') return 8;
  if (t === 'DATETIME') return 5;
  // TEXT / JSON / LONGTEXT 只占行内指针
  return 12;
}

/** MySQL 单行字节上限，留 2KB 余量给索引与开销 */
const MAX_ROW_BYTES = 65535 - 2048;

/**
 * 计算当前表已占用的行内字节数
 */
async function estimateRowBytes(dataTable) {
  const cols = await columnInfo(dataTable);
  let total = 0;
  for (const c of cols) {
    total += rowBytesOf(c.type);
  }
  return total;
}

/**
 * 为新增列挑选不会撑爆行的类型：
 * 若加入 desired 会超过上限，则降级为 TEXT（只占行内指针）
 */
function safeTypeFor(desired, usedBytes) {
  const need = rowBytesOf(desired);
  if (usedBytes + need <= MAX_ROW_BYTES) return { type: desired, bytes: need, degraded: false };
  // 降级：TEXT 只占行内指针
  return { type: 'TEXT', bytes: 12, degraded: true };
}

/** 派生字段（由同一源字段按路径拆出）：def.source_key 指向源字段键 */
function sourceKeyOf(def) {
  const s = def && def.source_key;
  return s && String(s).trim() ? String(s).trim() : null;
}

/**
 * 确保一个字段对应的列存在
 * @param {string} table 目标表
 * @param {object} def 字段定义 { column_name, field_name, field_type, parse_mode, parse_path }
 * @param {*} sample 样本值
 * @param {Set} existing 已存在的列名集合（带 .types Map 与 .bytes 计数）
 * @param {{skipParsed?:boolean}} options skipParsed=true 时不创建解析列（用于原始表）
 * @returns {{added:string[], altered:string[], degraded:string[]}}
 */
async function ensureFieldColumn(table, def, sample, existing, options) {
  const opts = options || {};
  const added = [];
  const altered = [];
  const degraded = [];

  const column = def.column_name || def.columnName;
  const comment = String(def.field_name || def.fieldName || column).replace(/'/g, "''").slice(0, 200);
  // MySQL 实际存储的注释（撤销 SQL 转义），用于判断注释是否真的需要更新
  const rawComment = comment.replace(/''/g, "'");
  const desired = inferColumnType(sample, def.field_type || def.fieldType);

  // 系统元数据列（id / jdy_data_id / raw_json 等）由建表语句定义，不参与业务字段同步
  if (META_COLUMNS.some((m) => m.name === column)) {
    return { added, altered, degraded };
  }

  if (!existing.has(column)) {
    const pick = safeTypeFor(desired, existing.bytes || 0);
    await safeRaw(`ALTER TABLE ${quoteIdent(table)}
         ADD COLUMN ${quoteIdent(column)} ${pick.type} NULL COMMENT '${comment}'`,
      [], [table]
    );
    existing.add(column);
    if (existing.types) existing.types.set(column, pick.type);
    existing.bytes = (existing.bytes || 0) + pick.bytes;
    added.push(column);
    if (pick.degraded) degraded.push(column);
  } else {
    const cur = existing.types ? existing.types.get(column) : null;
    const curComment = existing.comments ? String(existing.comments.get(column) || '') : '';
    let finalType = cur || desired;
    let typeChanged = false;

    if (cur) {
      const next = upgradeColumnType(cur, desired);
      if (!sameColumnType(next, cur)) {
        // 扩列同样要检查行大小
        const delta = rowBytesOf(next) - rowBytesOf(cur);
        if ((existing.bytes || 0) + delta <= MAX_ROW_BYTES) {
          finalType = next;
          existing.types.set(column, next);
          existing.bytes = (existing.bytes || 0) + delta;
          altered.push(column);
        } else {
          // 无法扩列则降级为 TEXT
          finalType = 'TEXT';
          existing.types.set(column, 'TEXT');
          existing.bytes = (existing.bytes || 0) + (12 - rowBytesOf(cur));
          altered.push(column);
          degraded.push(column);
        }
        typeChanged = !sameColumnType(finalType, cur);
      }
    }

    const commentChanged = curComment !== rawComment;
    // 关键：类型与注释都没有变化时，绝不再执行 DDL。
    // 原实现在这里无条件 ALTER TABLE ... MODIFY COLUMN，一次推送约 134 条 DDL
    // （67 字段 × 原表/解析表），单条 DDL 约 18~30ms，累计 2~4 秒；
    // 并发批量推送时 MDL 排队会放大到 10~37 秒，直接导致简道云 5 秒超时。
    if (!typeChanged && !commentChanged) {
      return { added, altered, degraded };
    }

    // 仅当类型或中文注释确有变化时才写回
    try {
      await safeRaw(`ALTER TABLE ${quoteIdent(table)}
           MODIFY COLUMN ${quoteIdent(column)} ${finalType} NULL COMMENT '${comment}'`,
        [], [table]
      );
      if (existing.comments) existing.comments.set(column, rawComment);
    } catch (err) {
      console.error(`[schema] 更新列类型/注释失败 ${column}:`, err.message);
    }
  }

  // 解析列（仅解析表需要）
  if (!opts.skipParsed) {
    const mode = def.parse_mode || def.parseMode || 'none';
    if (mode && mode !== 'none' && mode !== 'expand') {
      const pcol = fields.parsedColumnOf(column);
      const pcomment = `${comment}(解析)`.replace(/'/g, "''").slice(0, 200);
      if (!existing.has(pcol)) {
        const ptype = parsedColumnType();
        const pick = safeTypeFor(ptype, existing.bytes || 0);
        await safeRaw(`ALTER TABLE ${quoteIdent(table)}
             ADD COLUMN ${quoteIdent(pcol)} ${pick.type} NULL COMMENT '${pcomment}'`,
          [], [table]
        );
        existing.add(pcol);
        if (existing.types) existing.types.set(pcol, pick.type);
        existing.bytes = (existing.bytes || 0) + pick.bytes;
        added.push(pcol);
        if (pick.degraded) degraded.push(pcol);
      }
    }
  }

  return { added, altered, degraded };
}

/**
 * 按字段定义同步表结构（原始表 + 解析表）
 *
 * 原始表 jdywh_data_N   ：存放推送的原始值（JSON 原样）
 * 解析表 jdywh_parsed_N ：存放加工后的可读值
 *
 * 两表列结构保持一致，便于对照查看「解析前 / 解析后」。
 *
 * @param {number} projectId
 * @param {Array} defs 字段定义列表
 * @param {object} samples 字段key -> 样本值
 */
async function syncFieldColumns(projectId, defs, samples) {
  const dataTable = makeTableName(projectId);
  const parsedTable = makeParsedTableName(projectId);

  // 确保两张表都存在
  await ensureProjectTables(projectId);

  const rawCtx = await buildColumnContext(dataTable);
  const parsedCtx = await buildColumnContext(parsedTable);

  const added = [];
  const altered = [];
  const degraded = [];

  for (const def of defs) {
    if (Number(def.enabled) === 0) continue;
    if (def.parse_mode === fields.EXPAND_MODE) continue; // 展开字段走子表
    const key = def.field_key || def.fieldKey;
    const sample = samples ? samples[key] : undefined;

    try {
      // 原始表：只建业务列（不含 _p 解析列）
      const r1 = await ensureFieldColumn(dataTable, def, sample, rawCtx, { skipParsed: true });
      added.push(...r1.added);
      altered.push(...r1.altered);
      degraded.push(...r1.degraded);

      // 解析表：建同样的列 + 解析列
      const r2 = await ensureFieldColumn(parsedTable, def, sample, parsedCtx, { skipParsed: false });
      r2.added.forEach((c) => { if (!added.includes(c)) added.push(c); });
      r2.altered.forEach((c) => { if (!altered.includes(c)) altered.push(c); });
      r2.degraded.forEach((c) => { if (!degraded.includes(c)) degraded.push(c); });
    } catch (err) {
      console.error(`[schema] 字段 ${key} 建列失败:`, err.message);
    }
  }

  return {
    added,
    altered,
    degraded,
    columns: Array.from(rawCtx),
    parsedColumns: Array.from(parsedCtx),
    bytes: rawCtx.bytes,
  };
}

/** 构建列上下文（列名集合 + 类型表 + 注释表 + 行字节计数） */
async function buildColumnContext(table) {
  const cols = await columnInfo(table);
  const ctx = new Set(cols.map((c) => c.name));
  ctx.types = new Map(cols.map((c) => [c.name, c.type]));
  // 注释表用于判断「注释是否需要更新」，避免每次推送都 MODIFY COLUMN 刷注释
  ctx.comments = new Map(cols.map((c) => [c.name, String(c.comment || '')]));
  ctx.bytes = cols.reduce((sum, c) => sum + rowBytesOf(c.type), 0);
  return ctx;
}

/* ============ 子表（数组展开，需求 7） ============ */

/**
 * 创建/同步展开子表
 * @param {number} projectId
 * @param {object} def 展开字段的定义
 * @param {Array} rows 展开后的行数组（对象数组）
 * @param {string} dataId 主表数据ID
 */
async function writeSubTable(projectId, def, rows, dataId, opTime) {
  const table = def.sub_table || makeSubTableName(projectId, def.field_key);
  const comment = String(def.field_name || def.field_key).replace(/'/g, "''").slice(0, 120);

  if (!(await tableExists(table))) {
    await safeRaw(`CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        jdy_data_id VARCHAR(191) NULL COMMENT '主表数据ID',
        row_index INT NOT NULL DEFAULT 0 COMMENT '行序号',
        sub_key VARCHAR(191) NULL COMMENT '子表字段键',
        sub_name VARCHAR(191) NULL COMMENT '子表字段名称',
        sub_type VARCHAR(32) NULL COMMENT '子表字段类型',
        sub_value LONGTEXT NULL COMMENT '子表字段值',
        sub_text VARCHAR(1000) NULL COMMENT '子表字段解析值',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_jdy_data_id (jdy_data_id),
        KEY idx_row (row_index)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='${comment} 展开子表'`
    );
  }

  // 先清掉该数据原有的行，保证幂等
  if (dataId) {
    await safeRaw(`DELETE FROM ${quoteIdent(table)} WHERE jdy_data_id = ?`, [dataId]);
  }

  if (!Array.isArray(rows) || !rows.length) return { table, rows: 0 };

  let count = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row === null || row === undefined) continue;
    if (typeof row !== 'object' || Array.isArray(row)) {
      await safeRaw(`INSERT INTO ${quoteIdent(table)} (jdy_data_id, row_index, sub_key, sub_name, sub_value, sub_text)
         VALUES (?,?,?,?,?,?)`,
        [dataId || null, i, def.field_key, def.field_name, JSON.stringify(row), String(row)]
      );
      count += 1;
      continue;
    }
    const keys = Object.keys(row);
    if (!keys.length) continue;
    for (const k of keys) {
      const v = row[k];
      await safeRaw(`INSERT INTO ${quoteIdent(table)} (jdy_data_id, row_index, sub_key, sub_name, sub_value, sub_text)
         VALUES (?,?,?,?,?,?)`,
        [
          dataId || null,
          i,
          k,
          (def.sub_field_names && def.sub_field_names[k]) || k,
          toScalar(v),
          fields.parseValue(v, 'name') || fields.parseValue(v, 'array_join'),
        ]
      );
      count += 1;
    }
  }
  return { table, rows: count };
}

/** 删除数据时同步清理子表 */
async function deleteSubTableRows(projectId, defs, dataId) {
  if (!dataId) return;
  for (const def of defs) {
    if (def.parse_mode !== fields.EXPAND_MODE) continue;
    const table = def.sub_table || makeSubTableName(projectId, def.field_key);
    if (!(await tableExists(table))) continue;
    await safeRaw(`DELETE FROM ${quoteIdent(table)} WHERE jdy_data_id = ?`, [dataId]);
  }
}

/* ============ 数据写入 ============ */

/** 通用 upsert 实现 */
async function upsertInto(table, record, extraColumns) {
  const liveCols = new Set((await columnInfo(table)).map((c) => c.name));

  const insertCols = [];
  const placeholders = [];
  const values = [];
  const updates = [];

  const set = (col, val) => {
    if (!liveCols.has(col)) return;
    insertCols.push(quoteIdent(col));
    placeholders.push('?');
    values.push(val);
    updates.push(`${quoteIdent(col)} = VALUES(${quoteIdent(col)})`);
  };

  set('jdy_data_id', record.dataId);
  set('jdy_form_name', record.formName);
  set('jdy_op', record.op);
  set('jdy_op_time', record.opTime);
  set('raw_json', record.rawJson);

  const colObj = extraColumns || {};
  Object.keys(colObj).forEach((c) => {
    if (META_COLUMNS.some((m) => m.name === c)) return;
    set(c, toScalar(colObj[c]));
  });

  updates.push('`updated_at` = CURRENT_TIMESTAMP');

  if (!insertCols.length) return false;

  const sql =
    `INSERT INTO ${quoteIdent(table)} (${insertCols.join(', ')})
     VALUES (${placeholders.join(', ')})
     ON DUPLICATE KEY UPDATE ${updates.join(', ')}`;

  await safeRaw(sql, values, [table]);
  return true;
}

/**
 * 写入一条推送数据（按 jdy_data_id upsert）
 *
 * 同时写入两张表：
 *   jdywh_data_N   —— 原始值（解析前）
 *   jdywh_parsed_N —— 解析值（解析后，含 <column>_p 解析列）
 *
 * @param {number} projectId
 * @param {object} record {
 *   dataId, op, formName, opTime, rawJson,
 *   columns: { 列名: 原始值 },
 *   parsed:  { 列名: 解析值 },
 * }
 */
async function upsertRecord(projectId, record) {
  const dataTable = makeTableName(projectId);
  const parsedTable = makeParsedTableName(projectId);

  // 1) 原始表：写入原始值
  const rawOk = await upsertInto(dataTable, record, record.columns || {});
  if (!rawOk) {
    throw new Error('没有可写入的列（表结构可能未同步）');
  }

  // 2) 解析表：写入原始值 + 解析值（同一行，便于对照）
  if (await tableExists(parsedTable)) {
    const merged = Object.assign({}, record.columns || {}, record.parsed || {});
    try {
      await upsertInto(parsedTable, record, merged);
    } catch (err) {
      console.error('[schema] 解析表写入失败:', err.message);
    }
  } else if (record.columns && Object.keys(record.columns).length) {
    // 解析表不存在时不能静默丢数据：至少保证原始表已写入（上一步已完成）
    console.warn('[schema] 解析表不存在，仅写入原始表:', parsedTable);
  }
}

async function deleteRecord(projectId, dataId) {
  const dataTable = makeTableName(projectId);
  const parsedTable = makeParsedTableName(projectId);
  await safeRaw(`DELETE FROM ${quoteIdent(dataTable)} WHERE jdy_data_id = ?`, [dataId], [dataTable]);
  if (await tableExists(parsedTable)) {
    await safeRaw(`DELETE FROM ${quoteIdent(parsedTable)} WHERE jdy_data_id = ?`, [dataId], [parsedTable]);
  }
}

/* ============ 日志 ============ */

async function writeLog(projectId, log) {
  const logTable = makeLogTableName(projectId);
  await safeRaw(`INSERT INTO ${quoteIdent(logTable)}
      (op, op_label, deliver_id, data_id, form_name, entry_id, op_time,
       signature_ok, signature_msg, result, message, source_ip, field_count, payload, change_summary)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      log.op || null,
      log.opLabel || null,
      log.deliverId || null,
      log.dataId ? String(log.dataId).slice(0, 191) : null,
      log.formName ? String(log.formName).slice(0, 191) : null,
      log.entryId || null,
      log.opTime || null,
      log.signatureOk ? 1 : 0,
      log.signatureMsg || null,
      log.result || 'success',
      log.message || null,
      log.sourceIp || null,
      log.fieldCount || 0,
      log.payload || null,
      log.changeSummary || null,
    ]
  );
}

/**
 * 取上一次成功推送的同一条数据，用于生成「本次改了什么」的描述。
 * 只回看同项目、同 data_id、更早的日志。
 */
async function previousPayloadOf(projectId, dataId, beforeOpTime) {
  if (!dataId) return null;
  const logTable = makeLogTableName(projectId);
  if (!(await tableExists(logTable))) return null;
  const rows = await db.query(
    `SELECT payload FROM \`${logTable}\`
      WHERE data_id = ? AND result = 'success' AND payload IS NOT NULL
        ${beforeOpTime ? 'AND (op_time IS NULL OR op_time <= ?)' : ''}
      ORDER BY id DESC LIMIT 1`,
    beforeOpTime ? [String(dataId).slice(0, 191), beforeOpTime] : [String(dataId).slice(0, 191)]
  );
  if (!rows.length) return null;
  try {
    const j = JSON.parse(rows[0].payload);
    return (j && j.data) || j || null;
  } catch (_) {
    return null;
  }
}

/** 读取数据表列定义（带中文注释） */
async function getDataColumns(projectId) {
  const table = makeTableName(projectId);
  if (!(await tableExists(table))) return [];
  return db.query(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS columnType, DATA_TYPE AS dataType,
            COLUMN_COMMENT AS comment
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [table]
  );
}

async function getSubTables(projectId) {
  const rows = await db.query(
    `SELECT TABLE_NAME AS name, TABLE_COMMENT AS comment
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE ?
      ORDER BY TABLE_NAME`,
    [`jdywh_sub_${Number(projectId)}_%`]
  );
  return rows;
}

module.exports = {
  META_COLUMNS,
  assertOwnTable,
  isOwnTable,
  tablePrefix,
  safeRaw,
  makeTableName,
  makeParsedTableName,
  makeLogTableName,
  makeSubTableName,
  legacyParsedColumn,
  tableExists,
  columnInfo,
  columnNames,
  columnNameSet,
  columnFillStats,
  inferColumnType,
  upgradeColumnType,
  toScalar,
  ensureTableFor,
  ensureProjectTables,
  invalidateProjectCache,
  ensureDataIdUniqueKey,
  ensureFieldColumn,
  syncFieldColumns,
  buildColumnContext,
  writeSubTable,
  deleteSubTableRows,
  upsertRecord,
  upsertInto,
  deleteRecord,
  writeLog,
  previousPayloadOf,
  getDataColumns,
  getSubTables,
};