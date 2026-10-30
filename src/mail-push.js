'use strict';

const crypto = require('crypto');
const db = require('./db');
const { sanitizeIdent, makeColumnName, quoteIdent } = require('./ident');
const dataFilter = require('./data-filter');

/**
 * 邮箱附件推送 —— 附件表格自动建项目、建表、入库
 *
 * 业务规则（由需求方给定）：
 *   附件名形如：药店智能体触达转化_整体_2026-10-28_11-14-36-157_987.xlsx
 *     ├─ 项目名     = 下划线分段后「去掉第 2 段与末尾时间戳段」拼回
 *     │                 → 药店智能体触达转化
 *     ├─ 数据表第 1 列 wjmc = 剩余各段拼回（文件名去掉扩展名）
 *     │                 → 整体_2026-10-28_11-14-36-157_987
 *     ├─ 数据表第 2 列 id   = 自增主键
 *     └─ 数据表第 3 列起   = 表格实际数据列；最后追加「导入日期」
 *
 * 同一项目再次收到附件 → 追加合并（按 wjmc 幂等，重复导入不产生重复行）；
 * 不同项目名 → 自动新建项目与数据表。
 */

/** 附件扩展名白名单 */
const EXCEL_EXT = new Set(['.xlsx', '.xls', '.xlsm']);

/**
 * 文件签名校验
 *
 * xlsx / xlsm 本质是 ZIP 包，xls 是 OLE2 复合文档。
 * SheetJS 的解析器非常宽松 —— 纯文本、随机二进制都会被当成「单单元格表格」解析成功，
 * 从而创建出垃圾项目与空数据表。因此入库前必须先校验真实文件签名。
 *
 * @param {Buffer} buf 文件内容
 * @param {string} ext 扩展名（含点，小写）
 * @returns {{ok:boolean, reason?:string}}
 */
function checkExcelSignature(buf, ext) {
  if (!buf || !Buffer.isBuffer(buf) || buf.length < 8) {
    return { ok: false, reason: '文件内容为空或过短' };
  }
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  // ZIP 空档案（仅 EOCD）也视为无效
  const isZipEmpty = buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x05 && buf[3] === 0x06;
  const isOle = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;

  if (ext === '.xls') {
    if (!isOle) return { ok: false, reason: '不是有效的 .xls 文件（缺少 OLE2 签名）' };
    return { ok: true };
  }
  // .xlsx / .xlsm
  if (isZipEmpty) return { ok: false, reason: 'Excel 文件为空档案' };
  if (!isZip) return { ok: false, reason: '不是有效的 Excel 文件（缺少 ZIP 签名）' };
  return { ok: true };
}

/** 表名前缀（复用应用白名单前缀，保证与既有安全约束一致） */
function tablePrefix() {
  return process.env.TABLE_PREFIX || 'jdywh_';
}

/** 元数据表名 */
const META = {
  projects: () => `${tablePrefix()}mail_projects`,
  logs: () => `${tablePrefix()}mail_logs`,
};

/** 生成物理数据表名：jdywh_mail_{项目ID} */
function makeDataTable(projectId) {
  return `${tablePrefix()}mail_${Number(projectId)}`;
}

/** 校验表名归属，防误伤同库其他表 */
function assertOwnTable(name) {
  const prefix = tablePrefix();
  const s = String(name || '');
  if (!s.startsWith(prefix)) {
    throw new Error(`拒绝操作非本应用表：${s}（必须以 ${prefix} 开头）`);
  }
  if (!/^[A-Za-z0-9_]+$/.test(s)) {
    throw new Error(`非法表名：${s}`);
  }
}

/* ------------------------------------------------------------------ *
 * 文件名解析
 * ------------------------------------------------------------------ */

/**
 * 解析附件文件名，推导「项目名」与「wjmc」。
 *
 * 规则：按下划线分段 → 去掉第 2 段（索引 1）与末尾时间戳段 → 拼回得项目名；
 *       剩余段（去掉扩展名）整体拼回得 wjmc。
 *
 * @param {string} filename 原始附件名
 * @returns {{projectName:string, wjmc:string, ext:string, ok:boolean, reason?:string}}
 */
function parseAttachmentName(filename) {
  const raw = String(filename || '').trim();
  if (!raw) return { projectName: '', wjmc: '', ext: '', ok: false, reason: '文件名为空' };

  const dot = raw.lastIndexOf('.');
  const ext = dot > 0 ? raw.slice(dot).toLowerCase() : '';
  const base = dot > 0 ? raw.slice(0, dot) : raw;

  if (!EXCEL_EXT.has(ext)) {
    return { projectName: '', wjmc: '', ext, ok: false, reason: `不支持的扩展名 ${ext || '(无)'}` };
  }

  const segs = base.split('_').filter((s) => s !== '');
  if (segs.length < 2) {
    return { projectName: '', wjmc: base, ext, ok: false, reason: '文件名分段不足，无法推导项目名' };
  }

  // 项目名：去掉第 2 段（索引 1）
  const forProject = segs.filter((_, i) => i !== 1);
  let projectName = forProject.join('_');

  // 再去掉末尾的时间戳段（如 2026-10-28_11-14-36-157_987 中的 987 与时间片段）
  projectName = stripTrailingTimestamp(projectName);

  if (!projectName) {
    return { projectName: '', wjmc: base, ext, ok: false, reason: '推导出的项目名为空' };
  }

  // wjmc：文件名去掉「项目名_」前缀后的剩余部分
  //   药店智能体触达转化_整体_2026-10-28_11-14-36-157_987
  //   → 整体_2026-10-28_11-14-36-157_987
  let wjmc = base;
  if (wjmc.startsWith(projectName + '_')) {
    wjmc = wjmc.slice(projectName.length + 1);
  }
  if (!wjmc) wjmc = base;

  return { projectName, wjmc, ext, ok: true };
}

/**
 * 去掉末尾的时间戳片段。
 * 形如 xxx_2026-10-28_11-14-36-157_987 → xxx
 * 从尾部逐段剥离：纯数字（≥1 位）与日期/时间形态的段。
 */
function stripTrailingTimestamp(s) {
  const segs = String(s).split('_');
  const isDate = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x);
  const isTime = (x) => /^\d{2}-\d{2}(-\d{2})?(-\d+)?$/.test(x) || /^\d{6,}$/.test(x);
  const isNum = (x) => /^\d+$/.test(x);

  let end = segs.length;
  while (end > 1) {
    const cur = segs[end - 1];
    if (isNum(cur) || isTime(cur) || isDate(cur)) {
      end -= 1;
    } else {
      break;
    }
  }
  // 至少要保留 1 段，否则说明整串都是时间戳
  const kept = segs.slice(0, Math.max(1, end));
  return kept.join('_');
}

/* ------------------------------------------------------------------ *
 * 元数据表初始化
 * ------------------------------------------------------------------ */

async function ensureMetaTables() {
  const P = tablePrefix();
  await db.query(
    `CREATE TABLE IF NOT EXISTS \`${P}mail_projects\` (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(191) NOT NULL COMMENT '项目名称',
      code VARCHAR(64) NOT NULL COMMENT '项目标识',
      data_table VARCHAR(64) NOT NULL COMMENT '数据表物理名',
      source_mail VARCHAR(191) DEFAULT NULL COMMENT '来源邮箱',
      row_count BIGINT NOT NULL DEFAULT 0 COMMENT '累计行数',
      last_file VARCHAR(255) DEFAULT NULL COMMENT '最近处理的附件名',
      last_import_at DATETIME DEFAULT NULL COMMENT '最近导入时间',
      status TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_name (name),
      UNIQUE KEY uk_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='邮箱附件推送-项目'`
  );

  await db.query(
    `CREATE TABLE IF NOT EXISTS \`${P}mail_logs\` (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      project_id INT UNSIGNED DEFAULT NULL,
      project_name VARCHAR(191) DEFAULT NULL,
      uid VARCHAR(64) DEFAULT NULL COMMENT 'IMAP UID',
      message_id VARCHAR(255) DEFAULT NULL,
      subject VARCHAR(500) DEFAULT NULL,
      from_addr VARCHAR(255) DEFAULT NULL,
      filename VARCHAR(255) DEFAULT NULL,
      wjmc VARCHAR(255) DEFAULT NULL,
      rows_total INT NOT NULL DEFAULT 0,
      rows_inserted INT NOT NULL DEFAULT 0,
      rows_updated INT NOT NULL DEFAULT 0,
      columns_total INT NOT NULL DEFAULT 0,
      result VARCHAR(32) NOT NULL DEFAULT 'success',
      message TEXT DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_project (project_id),
      KEY idx_created (created_at),
      UNIQUE KEY uk_uid_file (uid, filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='邮箱附件推送-导入日志'`
  );
}

/* ------------------------------------------------------------------ *
 * 项目
 * ------------------------------------------------------------------ */

async function uniqueCode(base) {
  let code = sanitizeIdent(base, 'mail');
  if (!code) code = 'mail';
  let candidate = code;
  let i = 1;
  for (;;) {
    const row = await db.queryOne(
      `SELECT id FROM \`${META.projects()}\` WHERE code = ? LIMIT 1`, [candidate]
    );
    if (!row) return candidate;
    i += 1;
    candidate = `${code}_${i}`;
    if (i > 500) return `${code}_${crypto.randomBytes(3).toString('hex')}`;
  }
}

async function findProjectByName(name) {
  return db.queryOne(`SELECT * FROM \`${META.projects()}\` WHERE name = ? LIMIT 1`, [name]);
}

async function getProject(id) {
  return db.queryOne(`SELECT * FROM \`${META.projects()}\` WHERE id = ? LIMIT 1`, [id]);
}

async function listProjects() {
  return db.query(`SELECT * FROM \`${META.projects()}\` ORDER BY id DESC`);
}

/**
 * 取得或创建项目。
 * @returns {Promise<{project:object, created:boolean}>}
 */
async function ensureProject(name, sourceMail) {
  const exist = await findProjectByName(name);
  if (exist) return { project: exist, created: false };

  const code = await uniqueCode(name);
  const r = await db.query(
    `INSERT INTO \`${META.projects()}\` (name, code, data_table, source_mail)
     VALUES (?,?,?,?)`,
    [name, code, 'pending', sourceMail || null]
  );
  const id = r.insertId;
  const table = makeDataTable(id);
  await db.query(`UPDATE \`${META.projects()}\` SET data_table = ? WHERE id = ?`, [table, id]);
  return { project: await getProject(id), created: true };
}

/* ------------------------------------------------------------------ *
 * 数据表结构
 * ------------------------------------------------------------------ */

/** 读取表的列信息 */
async function columns(table) {
  return db.query(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, COLUMN_COMMENT AS comment,
            ORDINAL_POSITION AS pos, EXTRA AS extra, COLUMN_KEY AS ckey
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [table]
  );
}

async function tableExists(table) {
  const row = await db.queryOne(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]
  );
  return Number((row && row.c) || 0) > 0;
}

/**
 * 建表：id（第 1 列，自增主键） + wjmc（第 2 列） + 数据列... + import_date
 *
 * 需求约定：
 *   第 1 列 = 自增 ID 主键
 *   第 2 列 = wjmc（文件名，值如「整体_2026-10-28_11-14-36-157_987」）
 *   第 3 列起 = 表格实际数据列
 *   最后 1 列 = 导入日期
 *
 * 注意：同一个文件的多行数据共享同一个 wjmc，因此 wjmc 只能建普通索引，
 *       不能做唯一键，否则同批数据会互相覆盖。
 */
async function createDataTable(table, headers) {
  assertOwnTable(table);
  const used = new Set(['wjmc', 'id', 'import_date']);

  const cols = [];
  for (const h of headers) {
    const name = makeColumnName(h, used, 'c');
    cols.push({ name, label: String(h == null ? '' : h).trim() || name });
  }

  const defs = [];
  defs.push("`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '自增ID'");
  defs.push("`wjmc` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '文件名'");
  for (const c of cols) {
    defs.push(`${quoteIdent(c.name)} TEXT COMMENT '${escapeSql(c.label)}'`);
  }
  defs.push("`import_date` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '导入日期'");

  const sql =
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (\n  ${defs.join(',\n  ')},\n` +
    '  PRIMARY KEY (`id`),\n  KEY `idx_wjmc` (`wjmc`)\n' +
    ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='邮箱附件推送数据表'";

  await db.query(sql);
  return cols;
}

/** 为已存在的表补齐缺失列（表结构随新附件列变化而演进） */
async function syncColumns(table, headers) {
  assertOwnTable(table);
  const existing = await columns(table);
  const used = new Set(existing.map((c) => c.name));
  const byComment = new Map();
  for (const c of existing) {
    if (c.comment) byComment.set(c.comment, c.name);
  }

  const result = [];
  for (const h of headers) {
    const label = String(h == null ? '' : h).trim();
    // 已有同名列（按注释匹配，即原始表头）→ 复用
    if (label && byComment.has(label)) {
      result.push({ name: byComment.get(label), label });
      continue;
    }
    const name = makeColumnName(label, used, 'c');
    await db.query(
      `ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${quoteIdent(name)} TEXT COMMENT '${escapeSql(label)}'`
    );
    result.push({ name, label });
  }
  return result;
}

/** SQL 字符串转义（用于注释等无法参数化的位置） */
function escapeSql(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/* ------------------------------------------------------------------ *
 * 数据入库
 * ------------------------------------------------------------------ */

/** 把单元格值规范成可入库的字符串（保留数字与日期语义） */
function cellValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ` +
           `${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  if (typeof v === 'number') {
    // 整数不带小数点，避免 15820.0 这类噪声
    return Number.isInteger(v) ? String(v) : String(v);
  }
  if (typeof v === 'boolean') return v ? '1' : '0';
  const s = String(v);
  return s === '' ? null : s;
}

/**
 * 导入一批行：同一 wjmc 先删后插，保证幂等且不丢行。
 *
 * 为什么不是 upsert：
 *   同一个文件里的多行共享同一个 wjmc，若以 wjmc 做唯一键做 upsert，
 *   这些行会互相覆盖，最终只剩最后一行。因此改为「按 wjmc 整体替换」：
 *   重复导入同一文件时结果一致，且全部行都保留。
 *
 * @returns {Promise<{inserted:number, replaced:number, total:number}>}
 */
async function upsertRows(table, cols, wjmc, rows, importDate) {
  assertOwnTable(table);
  if (!rows.length) return { inserted: 0, replaced: 0, total: 0 };

  // 先删除该文件名的历史数据（重复导入 → 结果一致）
  const oldRow = await db.queryOne(
    `SELECT COUNT(*) AS c FROM ${quoteIdent(table)} WHERE wjmc = ?`, [wjmc]
  );
  const replaced = Number((oldRow && oldRow.c) || 0);
  if (replaced > 0) {
    await db.query(`DELETE FROM ${quoteIdent(table)} WHERE wjmc = ?`, [wjmc]);
  }

  const colNames = cols.map((c) => c.name);
  const allCols = ['wjmc', ...colNames, 'import_date'];

  const CHUNK = 200;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const placeholders = [];
    const params = [];
    for (const r of slice) {
      placeholders.push('(' + allCols.map(() => '?').join(',') + ')');
      params.push(wjmc);
      for (const c of colNames) params.push(cellValue(r[c]));
      params.push(importDate);
    }

    const sql =
      `INSERT INTO ${quoteIdent(table)} (${allCols.map(quoteIdent).join(',')})\n` +
      `VALUES ${placeholders.join(',\n')}`;

    const res = await db.query(sql, params);
    inserted += Number(res.affectedRows || slice.length);
  }

  const stat = await db.queryOne(
    `SELECT COUNT(*) AS total FROM ${quoteIdent(table)} WHERE wjmc = ?`, [wjmc]
  );
  return { inserted, replaced, total: Number((stat && stat.total) || 0) };
}

/* ------------------------------------------------------------------ *
 * 主流程：处理一个附件
 * ------------------------------------------------------------------ */

/**
 * 处理单个附件：解析文件名 → 建/取项目 → 建/补表 → 入库 → 写日志
 *
 * @param {object} input
 * @param {string} input.filename 附件名
 * @param {Buffer} input.buffer   附件二进制
 * @param {object} [input.meta]   {uid, messageId, subject, from}
 * @returns {Promise<object>} 处理结果
 */
async function processAttachment(input) {
  const XLSX = require('xlsx');
  const filename = String(input.filename || '');
  const meta = input.meta || {};

  const parsed = parseAttachmentName(filename);
  if (!parsed.ok) {
    return { ok: false, result: 'skipped', message: parsed.reason, filename };
  }

  // 文件签名校验：拦截被 SheetJS 宽松解析的伪 Excel（纯文本/随机二进制等）
  const sig = checkExcelSignature(input.buffer, parsed.ext);
  if (!sig.ok) {
    return { ok: false, result: 'failed', message: `无效的 Excel 文件：${sig.reason}`, filename };
  }

  // 解析工作簿
  let wb;
  try {
    wb = XLSX.read(input.buffer, { type: 'buffer', cellDates: true });
  } catch (e) {
    return { ok: false, result: 'failed', message: `Excel 解析失败：${e.message}`, filename };
  }

  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { ok: false, result: 'failed', message: '工作簿中没有工作表', filename };
  }
  const sheet = wb.Sheets[sheetName];

  // 转成二维数组（表头 + 数据）
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  if (!aoa.length) {
    return { ok: false, result: 'failed', message: '工作表为空', filename };
  }

  const headers = (aoa[0] || []).map((h) => (h === null || h === undefined ? '' : String(h).trim()));
  // 去掉尾部全空列
  while (headers.length && headers[headers.length - 1] === '') headers.pop();
  if (!headers.length) {
    return { ok: false, result: 'failed', message: '未识别到表头', filename };
  }

  // 内容合理性校验：真实业务表至少应有 2 列（或表头+数据合计≥2 个有效单元格），
  // 避免单单元格的「伪表格」被当成有效附件建表。
  const nonEmptyHeaders = headers.filter((h) => h !== '').length;
  if (nonEmptyHeaders < 2 && aoa.length < 2) {
    return {
      ok: false,
      result: 'failed',
      message: `文件内容不像有效表格（仅 ${nonEmptyHeaders} 个表头、${Math.max(0, aoa.length - 1)} 行数据）`,
      filename,
    };
  }

  const dataRows = aoa.slice(1).filter((r) => {
    if (!r) return false;
    return r.some((v) => v !== null && v !== undefined && String(v).trim() !== '');
  });

  // 项目与表
  const { project, created } = await ensureProject(parsed.projectName, meta.from);
  const table = project.data_table && project.data_table !== 'pending'
    ? project.data_table
    : makeDataTable(project.id);

  let cols;
  const exists = await tableExists(table);
  if (!exists) {
    cols = await createDataTable(table, headers);
  } else {
    cols = await syncColumns(table, headers);
  }

  // 行对象化
  const rows = dataRows.map((r) => {
    const o = {};
    for (let i = 0; i < cols.length; i += 1) o[cols[i].name] = r[i];
    return o;
  });

  const importDate = new Date();
  const stat = await upsertRows(table, cols, parsed.wjmc, rows, importDate);

  // 更新项目统计
  const cnt = await db.queryOne(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`);
  await db.query(
    `UPDATE \`${META.projects()}\`
        SET row_count = ?, last_file = ?, last_import_at = NOW()
      WHERE id = ?`,
    [Number((cnt && cnt.c) || 0), filename, project.id]
  );

  return {
    ok: true,
    result: 'success',
    filename,
    projectName: parsed.projectName,
    projectId: project.id,
    projectCreated: created,
    tableCreated: !exists,
    table,
    wjmc: parsed.wjmc,
    columnsTotal: cols.length,
    rowsTotal: rows.length,
    inserted: stat.inserted,
    replaced: stat.replaced,
    updated: 0,
    rowCount: Number((cnt && cnt.c) || 0),
    message: `${created ? '新建项目' : '追加到项目'}「${parsed.projectName}」：` +
             `${rows.length} 行 / ${cols.length} 列` +
             (stat.replaced > 0 ? `（已替换同批次旧数据 ${stat.replaced} 行）` : ''),
  };
}

/* ------------------------------------------------------------------ *
 * 日志
 * ------------------------------------------------------------------ */

async function writeLog(entry) {
  await db.query(
    `INSERT INTO \`${META.logs()}\`
       (project_id, project_name, uid, message_id, subject, from_addr,
        filename, wjmc, rows_total, rows_inserted, rows_updated,
        columns_total, result, message)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       rows_total = VALUES(rows_total), rows_inserted = VALUES(rows_inserted),
       rows_updated = VALUES(rows_updated), columns_total = VALUES(columns_total),
       result = VALUES(result), message = VALUES(message)`,
    [
      entry.projectId || null,
      entry.projectName || null,
      entry.uid || null,
      entry.messageId || null,
      entry.subject || null,
      entry.from || null,
      entry.filename || null,
      entry.wjmc || null,
      entry.rowsTotal || 0,
      entry.inserted || 0,
      entry.updated || 0,
      entry.columnsTotal || 0,
      entry.result || 'success',
      entry.message || null,
    ]
  );
}

async function alreadyImported(uid, filename) {
  if (!uid) return false;
  const row = await db.queryOne(
    `SELECT id FROM \`${META.logs()}\`
      WHERE uid = ? AND filename = ? AND result = 'success' LIMIT 1`,
    [String(uid), filename]
  );
  return !!row;
}

async function listLogs(limit) {
  return db.query(
    `SELECT * FROM \`${META.logs()}\` ORDER BY id DESC LIMIT ?`,
    [Math.min(Number(limit) || 100, 500)]
  );
}

/**
 * 日志查询（支持结果/项目/关键词筛选）
 * @param {object} opts {limit, result, projectId, keyword}
 */
async function queryLogs(opts) {
  const o = opts || {};
  const where = [];
  const params = [];

  if (o.result && ['success', 'skipped', 'failed'].includes(String(o.result))) {
    where.push('result = ?');
    params.push(String(o.result));
  }
  if (o.projectId) {
    where.push('project_id = ?');
    params.push(Number(o.projectId));
  }
  if (o.keyword) {
    where.push('(filename LIKE ? OR subject LIKE ? OR message LIKE ? OR project_name LIKE ?)');
    const kw = `%${String(o.keyword)}%`;
    params.push(kw, kw, kw, kw);
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = Math.min(Math.max(Number(o.limit) || 100, 1), 500);
  params.push(limit);

  return db.query(
    `SELECT * FROM \`${META.logs()}\` ${whereSql} ORDER BY id DESC LIMIT ?`,
    params
  );
}

async function getLog(id) {
  return db.queryOne(`SELECT * FROM \`${META.logs()}\` WHERE id = ? LIMIT 1`, [Number(id)]);
}

/**
 * 项目数据分页查询（支持关键词搜索、排序与多条件筛选）
 *
 * 筛选（V6.1 要求 9）与 `GET /api/projects/:id/parsed` 共用 `src/data-filter.js`，
 * 保证两处数据明细的筛选语义、SQL 形态、边界行为完全一致：
 *   - 列白名单 = 本表真实物理列（columns() 查 information_schema）；
 *   - 值全部占位符绑定；
 *   - 与 keyword 之间 AND。
 *
 * @param {object} project 项目记录
 * @param {object} opts {page, size, keyword, sort, order, filters}
 *   filters: JSON 数组字符串，如 '[{"column":"c_1","op":"contains","value":"abc"}]'
 */
async function queryRows(project, opts) {
  assertOwnTable(project.data_table);
  const o = opts || {};
  const page = Math.max(1, Number(o.page) || 1);
  const size = Math.min(Math.max(Number(o.size) || 20, 1), 200);
  const offset = (page - 1) * size;

  const cols = await columns(project.data_table);
  const colNames = cols.map((c) => c.name);

  // 排序：仅允许物理列名白名单
  let orderSql = 'ORDER BY `id` DESC';
  const sort = String(o.sort || '').trim();
  if (sort && colNames.includes(sort)) {
    const dir = String(o.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    orderSql = `ORDER BY ${quoteIdent(sort)} ${dir}`;
  }

  // 关键词：在文本类列中搜索
  const where = [];
  const params = [];
  const kw = String(o.keyword || '').trim();
  if (kw) {
    const textCols = cols.filter((c) => /char|text/i.test(String(c.type || '')));
    const use = textCols.length ? textCols : cols;
    where.push('(' + use.map((c) => `${quoteIdent(c.name)} LIKE ?`).join(' OR ') + ')');
    use.forEach(() => params.push(`%${kw}%`));
  }

  // 多条件筛选（AND）
  const filterMeta = dataFilter.appendFilters(
    { where, params }, o.filters, colNames, quoteIdent
  );

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const totalRow = await db.queryOne(
    `SELECT COUNT(*) AS c FROM ${quoteIdent(project.data_table)} ${whereSql}`,
    params
  );
  const rows = await db.query(
    `SELECT * FROM ${quoteIdent(project.data_table)} ${whereSql} ${orderSql} LIMIT ${size} OFFSET ${offset}`,
    params
  );

  return Object.assign({
    rows,
    total: Number((totalRow && totalRow.c) || 0),
    page,
    size,
    columns: cols,
  }, dataFilter.filterMeta(filterMeta));
}

/** 导出项目全部数据（用于 CSV） */
async function exportRows(project) {
  assertOwnTable(project.data_table);
  const cols = await columns(project.data_table);
  const rows = await db.query(
    `SELECT * FROM ${quoteIdent(project.data_table)} ORDER BY id ASC`
  );
  return { columns: cols, rows };
}

/** 更新项目元信息 */
async function updateProject(id, input) {
  const project = await getProject(id);
  if (!project) throw new Error('项目不存在');

  const fields = [];
  const params = [];

  if (input.name !== undefined) {
    const name = String(input.name || '').trim();
    if (!name) throw new Error('项目名称不能为空');
    const dup = await db.queryOne(
      `SELECT id FROM \`${META.projects()}\` WHERE name = ? AND id <> ? LIMIT 1`,
      [name, Number(id)]
    );
    if (dup) throw new Error(`项目名称「${name}」已存在`);
    fields.push('name = ?');
    params.push(name);
  }
  if (input.status !== undefined) {
    fields.push('status = ?');
    params.push(Number(input.status) ? 1 : 0);
  }

  if (!fields.length) return getProject(id);
  params.push(Number(id));
  await db.query(`UPDATE \`${META.projects()}\` SET ${fields.join(', ')} WHERE id = ?`, params);
  return getProject(id);
}

/** 删除项目（可选连同数据表） */
async function deleteProject(id, dropTable) {
  const project = await getProject(id);
  if (!project) throw new Error('项目不存在');

  if (dropTable && project.data_table && project.data_table !== 'pending') {
    assertOwnTable(project.data_table);
    await db.query(`DROP TABLE IF EXISTS ${quoteIdent(project.data_table)}`);
  }
  await db.query(`DELETE FROM \`${META.logs()}\` WHERE project_id = ?`, [Number(id)]);
  await db.query(`DELETE FROM \`${META.projects()}\` WHERE id = ?`, [Number(id)]);
  return true;
}

/** 清空项目数据（保留表结构） */
async function clearProject(id) {
  const project = await getProject(id);
  if (!project) throw new Error('项目不存在');
  assertOwnTable(project.data_table);

  const before = await db.queryOne(
    `SELECT COUNT(*) AS c FROM ${quoteIdent(project.data_table)}`
  );
  await db.query(`DELETE FROM ${quoteIdent(project.data_table)}`);
  await db.query(`UPDATE \`${META.projects()}\` SET row_count = 0 WHERE id = ?`, [Number(id)]);

  return { deleted: Number((before && before.c) || 0) };
}

/** 统计概览 */
async function overview() {
  const projects = await listProjects();

  let totalRows = 0;
  for (const p of projects) {
    totalRows += Number(p.row_count || 0);
  }

  const logStat = await db.queryOne(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN result = 'success' THEN 1 ELSE 0 END) AS success,
            SUM(CASE WHEN result = 'skipped' THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN result = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) AS today
       FROM \`${META.logs()}\``
  );

  const recentImports = await db.query(
    `SELECT id, project_id, project_name, filename, rows_total, columns_total, result, created_at
       FROM \`${META.logs()}\`
      ORDER BY id DESC LIMIT 10`
  );

  // 近 7 天导入趋势
  const trend = await db.query(
    `SELECT DATE(created_at) AS date, COUNT(*) AS count
       FROM \`${META.logs()}\`
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date ASC`
  );

  return {
    projects: { total: projects.length, rows: totalRows },
    logs: {
      total: Number((logStat && logStat.total) || 0),
      success: Number((logStat && logStat.success) || 0),
      skipped: Number((logStat && logStat.skipped) || 0),
      failed: Number((logStat && logStat.failed) || 0),
      today: Number((logStat && logStat.today) || 0),
    },
    recentImports,
    trend,
  };
}

/** 数据表预览 */
async function previewRows(table, limit) {
  assertOwnTable(table);
  const n = Math.min(Math.max(Number(limit) || 20, 1), 500);
  return db.query(`SELECT * FROM ${quoteIdent(table)} ORDER BY id DESC LIMIT ${n}`);
}

module.exports = {
  EXCEL_EXT,
  META,
  makeDataTable,
  parseAttachmentName,
  stripTrailingTimestamp,
  ensureMetaTables,
  ensureProject,
  getProject,
  listProjects,
  createDataTable,
  syncColumns,
  columns,
  tableExists,
  processAttachment,
  writeLog,
  alreadyImported,
  listLogs,
  queryLogs,
  getLog,
  queryRows,
  exportRows,
  updateProject,
  deleteProject,
  clearProject,
  overview,
  previewRows,
  assertOwnTable,
};
