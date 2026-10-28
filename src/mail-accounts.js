'use strict';

const db = require('./db');

/**
 * 邮箱账户管理（多账户）
 *
 * 每个账户独立维护：IMAP 连接参数、密码、启用状态、拉取进度（last_uid）、
 * 最近一次检查结果。一个账户故障不影响其他账户。
 *
 * 密码处理：
 *   - 存储：明文存库（与既有 SMTP/AI 密钥同一策略，便于运维自助修改）
 *   - 输出：API 层统一掩码，绝不回传真实密码
 */

const TABLE = () => `${process.env.TABLE_PREFIX || 'jdywh_'}mail_accounts`;

/** 默认 IMAP 参数（阿里云企业邮箱） */
const DEFAULTS = {
  imap_host: 'imap.qiye.aliyun.com',
  imap_port: 993,
  imap_secure: 1,
  mailbox: 'INBOX',
  initial_days: 7,
  max_per_run: 50,
};

/** 常见邮箱服务商预设（供界面快速选择） */
const PRESETS = [
  { key: 'aliyun', label: '阿里云企业邮箱', host: 'imap.qiye.aliyun.com', port: 993, secure: 1 },
  { key: 'aliyunhk', label: '阿里云企业邮箱（香港）', host: 'imaphk.qiye.aliyun.com', port: 993, secure: 1 },
  { key: 'qq', label: 'QQ 邮箱', host: 'imap.qq.com', port: 993, secure: 1 },
  { key: 'exmail', label: '腾讯企业邮箱', host: 'imap.exmail.qq.com', port: 993, secure: 1 },
  { key: '163', label: '网易 163', host: 'imap.163.com', port: 993, secure: 1 },
  { key: '126', label: '网易 126', host: 'imap.126.com', port: 993, secure: 1 },
  { key: 'gmail', label: 'Gmail', host: 'imap.gmail.com', port: 993, secure: 1 },
  { key: 'outlook', label: 'Outlook / Office365', host: 'outlook.office365.com', port: 993, secure: 1 },
  { key: 'custom', label: '自定义', host: '', port: 993, secure: 1 },
];

async function ensureTable() {
  await db.query(
    `CREATE TABLE IF NOT EXISTS \`${TABLE()}\` (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL COMMENT '账户名称',
      email VARCHAR(191) NOT NULL COMMENT '邮箱地址',
      imap_host VARCHAR(191) NOT NULL DEFAULT 'imap.qiye.aliyun.com' COMMENT 'IMAP 服务器',
      imap_port INT NOT NULL DEFAULT 993 COMMENT 'IMAP 端口',
      imap_secure TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'SSL',
      password VARCHAR(255) NOT NULL DEFAULT '' COMMENT '密码/授权码',
      mailbox VARCHAR(100) NOT NULL DEFAULT 'INBOX' COMMENT '收件文件夹',
      enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '启用自动拉取',
      auto_import TINYINT(1) NOT NULL DEFAULT 1 COMMENT '自动导入Excel附件',
      initial_days INT NOT NULL DEFAULT 7 COMMENT '首次回溯天数',
      max_per_run INT NOT NULL DEFAULT 50 COMMENT '单次最多邮件数',
      last_uid BIGINT NOT NULL DEFAULT 0 COMMENT '已处理最大UID',
      last_check_at DATETIME DEFAULT NULL COMMENT '最近检查时间',
      last_status VARCHAR(20) DEFAULT NULL COMMENT 'ok/fail',
      last_error VARCHAR(500) DEFAULT NULL COMMENT '最近错误',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_email (email),
      KEY idx_enabled (enabled)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='邮箱推送-账户'`
  );
}

/** 对外输出时去掉密码 */
function sanitize(row) {
  if (!row) return null;
  const out = Object.assign({}, row);
  out.hasPassword = !!out.password;
  delete out.password;
  return out;
}

async function list() {
  const rows = await db.query(`SELECT * FROM \`${TABLE()}\` ORDER BY id ASC`);
  return rows.map(sanitize);
}

async function listEnabled() {
  const rows = await db.query(
    `SELECT * FROM \`${TABLE()}\` WHERE enabled = 1 ORDER BY id ASC`
  );
  return rows;
}

/** 内部使用：返回含密码的原始记录 */
async function getRaw(id) {
  return db.queryOne(`SELECT * FROM \`${TABLE()}\` WHERE id = ? LIMIT 1`, [Number(id)]);
}

async function get(id) {
  return sanitize(await getRaw(id));
}

function normalize(input, isCreate) {
  const out = {};
  const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

  if (input.name !== undefined) out.name = str(input.name);
  if (input.email !== undefined) out.email = str(input.email).toLowerCase();
  if (input.imap_host !== undefined) out.imap_host = str(input.imap_host) || DEFAULTS.imap_host;
  if (input.imap_port !== undefined) {
    const p = parseInt(input.imap_port, 10);
    out.imap_port = Number.isFinite(p) && p > 0 && p < 65536 ? p : DEFAULTS.imap_port;
  }
  if (input.imap_secure !== undefined) out.imap_secure = Number(input.imap_secure) ? 1 : 0;
  if (input.mailbox !== undefined) out.mailbox = str(input.mailbox) || DEFAULTS.mailbox;
  if (input.enabled !== undefined) out.enabled = Number(input.enabled) ? 1 : 0;
  if (input.auto_import !== undefined) out.auto_import = Number(input.auto_import) ? 1 : 0;
  if (input.initial_days !== undefined) {
    const d = parseInt(input.initial_days, 10);
    out.initial_days = Number.isFinite(d) && d > 0 && d <= 365 ? d : DEFAULTS.initial_days;
  }
  if (input.max_per_run !== undefined) {
    const m = parseInt(input.max_per_run, 10);
    out.max_per_run = Number.isFinite(m) && m > 0 && m <= 500 ? m : DEFAULTS.max_per_run;
  }
  // 密码：留空表示不修改（更新时）
  if (input.password !== undefined && String(input.password) !== '') {
    out.password = String(input.password);
  }
  return out;
}

async function create(input) {
  await ensureTable();
  const v = normalize(input, true);

  if (!v.email) throw new Error('邮箱地址不能为空');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) throw new Error('邮箱地址格式不正确');
  if (!v.password) throw new Error('邮箱密码不能为空');

  const exist = await db.queryOne(
    `SELECT id FROM \`${TABLE()}\` WHERE email = ? LIMIT 1`, [v.email]
  );
  if (exist) throw new Error(`邮箱 ${v.email} 已存在`);

  const cols = ['name', 'email', 'imap_host', 'imap_port', 'imap_secure', 'password',
    'mailbox', 'enabled', 'auto_import', 'initial_days', 'max_per_run'];
  const vals = [
    v.name || v.email,
    v.email,
    v.imap_host || DEFAULTS.imap_host,
    v.imap_port === undefined ? DEFAULTS.imap_port : v.imap_port,
    v.imap_secure === undefined ? DEFAULTS.imap_secure : v.imap_secure,
    v.password,
    v.mailbox || DEFAULTS.mailbox,
    v.enabled === undefined ? 1 : v.enabled,
    v.auto_import === undefined ? 1 : v.auto_import,
    v.initial_days === undefined ? DEFAULTS.initial_days : v.initial_days,
    v.max_per_run === undefined ? DEFAULTS.max_per_run : v.max_per_run,
  ];

  const r = await db.query(
    `INSERT INTO \`${TABLE()}\` (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    vals
  );
  return get(r.insertId);
}

async function update(id, input) {
  await ensureTable();
  const row = await getRaw(id);
  if (!row) throw new Error('邮箱账户不存在');

  const v = normalize(input, false);
  const fields = [];
  const params = [];

  Object.keys(v).forEach((k) => {
    fields.push(`${k} = ?`);
    params.push(v[k]);
  });

  // 邮箱地址变更需查重
  if (v.email && v.email !== row.email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) throw new Error('邮箱地址格式不正确');
    const dup = await db.queryOne(
      `SELECT id FROM \`${TABLE()}\` WHERE email = ? AND id <> ? LIMIT 1`, [v.email, id]
    );
    if (dup) throw new Error(`邮箱 ${v.email} 已被其他账户使用`);
  }

  // 连接参数变更时重置拉取进度，避免跳过新账户的邮件
  const connChanged = (v.imap_host && v.imap_host !== row.imap_host)
    || (v.imap_port && Number(v.imap_port) !== Number(row.imap_port))
    || (v.mailbox && v.mailbox !== row.mailbox)
    || (v.email && v.email !== row.email);
  if (connChanged) {
    fields.push('last_uid = ?');
    params.push(0);
  }

  if (!fields.length) return get(id);

  params.push(Number(id));
  await db.query(`UPDATE \`${TABLE()}\` SET ${fields.join(', ')} WHERE id = ?`, params);
  return get(id);
}

async function remove(id) {
  const row = await getRaw(id);
  if (!row) throw new Error('邮箱账户不存在');
  await db.query(`DELETE FROM \`${TABLE()}\` WHERE id = ?`, [Number(id)]);
  return true;
}

async function setEnabled(id, enabled) {
  await db.query(
    `UPDATE \`${TABLE()}\` SET enabled = ? WHERE id = ?`,
    [Number(enabled) ? 1 : 0, Number(id)]
  );
  return get(id);
}

async function setProgress(id, lastUid) {
  await db.query(
    `UPDATE \`${TABLE()}\` SET last_uid = ?, last_check_at = NOW(), last_status = 'ok', last_error = NULL WHERE id = ?`,
    [Number(lastUid) || 0, Number(id)]
  );
}

async function setError(id, message) {
  await db.query(
    `UPDATE \`${TABLE()}\` SET last_check_at = NOW(), last_status = 'fail', last_error = ? WHERE id = ?`,
    [String(message || '').slice(0, 500), Number(id)]
  );
}

/**
 * 把旧的单账户配置（settings 表）迁移为一个账户记录。
 * 仅在账户表为空且旧配置完整时执行，幂等。
 */
async function migrateFromSettings(settings) {
  await ensureTable();
  const cnt = await db.queryOne(`SELECT COUNT(*) AS c FROM \`${TABLE()}\``);
  if (Number((cnt && cnt.c) || 0) > 0) return { migrated: false, reason: '已有账户' };

  const email = await settings.get('mail_imap_user', '');
  const pass = await settings.get('mail_imap_pass', '');
  if (!email || !pass) return { migrated: false, reason: '旧配置不完整' };

  const created = await create({
    name: email,
    email,
    imap_host: await settings.get('mail_imap_host', DEFAULTS.imap_host),
    imap_port: await settings.get('mail_imap_port', DEFAULTS.imap_port),
    imap_secure: await settings.get('mail_imap_secure', DEFAULTS.imap_secure),
    password: pass,
    mailbox: await settings.get('mail_imap_mailbox', DEFAULTS.mailbox),
    enabled: 1,
    auto_import: 1,
    initial_days: await settings.get('mail_push_initial_days', DEFAULTS.initial_days),
    max_per_run: await settings.get('mail_push_max_per_run', DEFAULTS.max_per_run),
  });

  // 继承旧的拉取进度
  const lastUid = Number(await settings.get('mail_push_last_uid', '0')) || 0;
  if (lastUid > 0) await setProgress(created.id, lastUid);

  return { migrated: true, account: created };
}

module.exports = {
  DEFAULTS,
  PRESETS,
  TABLE,
  ensureTable,
  sanitize,
  list,
  listEnabled,
  get,
  getRaw,
  create,
  update,
  remove,
  setEnabled,
  setProgress,
  setError,
  migrateFromSettings,
};
