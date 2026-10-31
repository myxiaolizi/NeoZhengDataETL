'use strict';

const crypto = require('crypto');
const db = require('./db');
const settings = require('./settings');
const aiScope = require('./ai-scope');

/**
 * V8 · AI 问数「分享」
 *
 * 目的：把一组数据范围 + 一个问数入口做成链接，发给他人在网页上直接用（无需登录）。
 * 契约见 _work/v8/CONTRACT.md 第 3 节。
 *
 * 安全要点：
 *   1. 令牌 18 字节随机（36 位十六进制），不可枚举；
 *   2. 访问密码 sha256 存 `password`，明文留档到 `password_plain`（与既有 jdywh_shares 一致，
 *      便于管理员在「分享管理」里查看并告知对方）；
 *   3. 公开接口**只返回**分享标题 / 数据范围名称与行数，**绝不**返回 scope 明细里的物理表名或 SQL；
 *   4. 公开问数结果**不含 sql**，行数上限 min(ai_max_rows, 200)；
 *   5. 限流用进程内 Map（单 token 20/min、单 IP 30/min、密码错误 5 次/10min），超限 429。
 */

/** 公开问数默认行数上限（契约要求） */
const PUBLIC_MAX_ROWS = 200;

/** 单 token 每分钟次数 */
const DEFAULT_TOKEN_PER_MIN = 20;
/** 单 IP 每分钟次数 */
const DEFAULT_IP_PER_MIN = 30;
/** 密码错误：窗口 10 分钟，最多 5 次 */
const PWD_WINDOW_MS = 10 * 60 * 1000;
const PWD_MAX_FAILS = 5;

/* ══════════════════════════════════════════════════════════════════
 *  一、建表（幂等）
 * ══════════════════════════════════════════════════════════════════ */

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS jdywh_ai_shares (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  token VARCHAR(48) NOT NULL COMMENT '分享令牌',
  title VARCHAR(191) NOT NULL DEFAULT '' COMMENT '分享标题',
  scope_json LONGTEXT NOT NULL COMMENT '数据范围(JSON)',
  password VARCHAR(64) DEFAULT NULL COMMENT '访问密码 sha256',
  password_plain VARCHAR(64) DEFAULT NULL COMMENT '访问密码明文(管理员可见)',
  expires_at DATETIME DEFAULT NULL COMMENT '过期时间',
  allow_export TINYINT NOT NULL DEFAULT 0 COMMENT '允许导出',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  view_count INT NOT NULL DEFAULT 0 COMMENT '访问次数',
  ask_count INT NOT NULL DEFAULT 0 COMMENT '问数次数',
  last_ask_at DATETIME DEFAULT NULL COMMENT '最后问数时间',
  created_by BIGINT DEFAULT NULL COMMENT '创建人',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_token (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

let ensured = null;

/** 幂等建表（进程内只跑一次；失败允许下次重试） */
async function ensureTable() {
  if (ensured) return ensured;
  ensured = (async () => {
    await db.raw(CREATE_TABLE_SQL, []);
    return true;
  })();
  try {
    return await ensured;
  } catch (err) {
    ensured = null;
    throw err;
  }
}

/* ══════════════════════════════════════════════════════════════════
 *  二、内存限流
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 简易滑动窗口计数器。
 * key → { hits: number[], fails: number[] }
 * 用时间戳数组而不是固定窗口，避免「窗口边界瞬间打穿 2 倍」。
 */
const buckets = new Map();

function pruneList(list, windowMs, now) {
  return list.filter((t) => now - t < windowMs);
}

/** 记一次命中并返回窗口内次数 */
function bump(key, windowMs, now) {
  const b = buckets.get(key) || { hits: [], fails: [] };
  b.hits = pruneList(b.hits, windowMs, now);
  b.hits.push(now);
  buckets.set(key, b);
  return b.hits.length;
}

/** 只读查询窗口内命中次数（不增加） */
function peek(key, windowMs, now) {
  const b = buckets.get(key);
  if (!b) return 0;
  b.hits = pruneList(b.hits, windowMs, now);
  return b.hits.length;
}

function bumpFails(key, now) {
  const b = buckets.get(key) || { hits: [], fails: [] };
  b.fails = b.fails.filter((t) => now - t < PWD_WINDOW_MS);
  b.fails.push(now);
  buckets.set(key, b);
  return b.fails.length;
}

function failCount(key, now) {
  const b = buckets.get(key);
  if (!b) return 0;
  b.fails = b.fails.filter((t) => now - t < PWD_WINDOW_MS);
  return b.fails.length;
}

/** 定期清理过期桶，避免内存无界增长 */
let lastSweep = 0;
function sweep(now) {
  if (now - lastSweep < 60000) return;
  lastSweep = now;
  const keepHits = 5 * 60 * 1000;
  for (const [k, b] of buckets) {
    b.hits = pruneList(b.hits, keepHits, now);
    b.fails = b.fails.filter((t) => now - t < PWD_WINDOW_MS);
    if (!b.hits.length && !b.fails.length) buckets.delete(k);
  }
}

/**
 * 校验并累加限流。
 *
 * @param {{tokenKey:string, ipKey:string, tokenPerMin?:number, ipPerMin?:number, now?:number}} input
 * @returns {{ok:boolean, code?:string, message?:string}}
 */
function checkRate(input) {
  const now = input.now || Date.now();
  sweep(now);
  const tokenLimit = Math.max(1, Number(input.tokenPerMin) || DEFAULT_TOKEN_PER_MIN);
  const ipLimit = Math.max(1, Number(input.ipPerMin) || DEFAULT_IP_PER_MIN);

  if (input.ipKey) {
    const n = bump(`ip:${input.ipKey}`, 60000, now);
    if (n > ipLimit) {
      return { ok: false, code: 'RATE_IP', message: `访问过于频繁（单个 IP 每分钟最多 ${ipLimit} 次），请稍后再试` };
    }
  }
  if (input.tokenKey) {
    const n = bump(`tk:${input.tokenKey}`, 60000, now);
    if (n > tokenLimit) {
      return { ok: false, code: 'RATE_TOKEN', message: `该分享访问过于频繁（每分钟最多 ${tokenLimit} 次），请稍后再试` };
    }
  }
  return { ok: true };
}

/** 密码失败次数检查（不累加） */
function checkPasswordRate(tokenKey, now) {
  const n = failCount(`pwd:${tokenKey}`, now || Date.now());
  if (n >= PWD_MAX_FAILS) {
    return { ok: false, code: 'RATE_PASSWORD', message: `密码错误次数过多（10 分钟内 ${PWD_MAX_FAILS} 次），请稍后再试` };
  }
  return { ok: true };
}

/** 记一次密码错误 */
function markPasswordFail(tokenKey, now) {
  return bumpFails(`pwd:${tokenKey}`, now || Date.now());
}

/** 密码正确则清空失败计数 */
function clearPasswordFail(tokenKey) {
  const b = buckets.get(`pwd:${tokenKey}`);
  if (b) b.fails = [];
}

/**
 * 仅供测试/运维：清空某个令牌或 IP 的全部计数。
 * 传裸 token / IP 即可（内部会一并清掉 tk: / ip: / pwd: 三个命名空间）。
 */
function resetRate(key) {
  const k = String(key || '');
  if (!k) return;
  buckets.delete(k);
  buckets.delete(`tk:${k}`);
  buckets.delete(`ip:${k}`);
  buckets.delete(`pwd:${k}`);
}

/* ══════════════════════════════════════════════════════════════════
 *  三、序列化
 * ══════════════════════════════════════════════════════════════════ */

function sha256(s) {
  return crypto.createHash('sha256').update(String(s || '')).digest('hex');
}

function safeParse(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v === null || v === undefined ? fallback : v;
  } catch (_) {
    return fallback;
  }
}

/**
 * scope 归一化：只保留 {kind,id,tableType} 三元组，忽略客户端传入的一切冗余字段，
 * 避免把前端对象（含物理表名/列清单）原样存库并在公开接口泄漏。
 */
function normalizeScope(scope) {
  const list = Array.isArray(scope) ? scope : [];
  return list
    .map((s) => {
      const item = {
        kind: String((s && s.kind) || '').trim().toLowerCase(),
        id: Number(s && s.id),
      };
      if (s && (s.tableType === 'data' || s.tableType === 'raw')) item.tableType = s.tableType;
      return item;
    })
    .filter((s) => ['dataset', 'project', 'mail', 'flow'].includes(s.kind) && Number.isFinite(s.id) && s.id > 0);
}

/** 分享对外结构（管理端：含明文密码，仅登录用户可见） */
function publicShare(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    token: row.token,
    title: row.title || '',
    scope: safeParse(row.scope_json, []),
    hasPassword: !!row.password,
    password: row.password_plain || null,
    expiresAt: row.expires_at || null,
    allowExport: Number(row.allow_export) === 1,
    status: Number(row.status),
    viewCount: Number(row.view_count || 0),
    askCount: Number(row.ask_count || 0),
    lastAskAt: row.last_ask_at || null,
    createdBy: row.created_by === null || row.created_by === undefined ? null : Number(row.created_by),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

/** 拼分享链接：优先使用请求 Host，其次 settings.default_base_url */
function buildShareUrl(token, reqHost, baseUrl) {
  const t = String(token || '');
  let origin = '';
  if (reqHost) {
    const host = String(reqHost).trim().replace(/\/+$/, '');
    origin = /^https?:\/\//i.test(host) ? host : `https://${host}`;
  }
  if (!origin && baseUrl) origin = String(baseUrl).trim().replace(/\/+$/, '');
  return `${origin}/a/${t}`;
}

/** 管理端结构 + url */
function withUrl(share, reqHost, baseUrl) {
  if (!share) return null;
  return Object.assign({}, share, { url: buildShareUrl(share.token, reqHost, baseUrl) });
}

/* ══════════════════════════════════════════════════════════════════
 *  四、登录态 CRUD
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 创建分享。
 *
 * @param {{title?:string, scope?:Array, password?:string, expiresDays?:number, allowExport?:boolean}} input
 * @param {number} userId
 * @param {{reqHost?:string, baseUrl?:string}} [ctx]
 */
async function createShare(input, userId, ctx) {
  const body = input || {};
  const scope = normalizeScope(body.scope);
  if (!scope.length) {
    throw new Error('请先选择要分享的数据范围（数据集 / 数据项目 / 邮件推送 / 流程产出）');
  }

  // 创建时先解析一遍：全部坏源直接拒绝，避免发出一个打不开的链接
  const resolved = await aiScope.resolveScope(scope);
  if (!resolved.sources.length) throw new Error('所选数据范围都不可用，无法创建分享');

  // 只存可用项的归一化 scope（坏源不落库，后续解析也只会取到可用项）
  const usable = scope.filter((s) => resolved.sources.some((r) => r.kind === s.kind && Number(r.id) === Number(s.id)));
  const maxSources = await settings.getInt('ai_scope_max_sources', 8);
  if (usable.length > maxSources) throw new Error(`一次最多分享 ${maxSources} 个数据范围`);

  const token = crypto.randomBytes(18).toString('hex');
  const plain = body.password ? String(body.password).slice(0, 64) : null;
  const password = plain ? sha256(plain) : null;

  let expiresAt = null;
  const days = Number(body.expiresDays);
  if (Number.isFinite(days) && days > 0) {
    expiresAt = new Date(Date.now() + Math.min(days, 3650) * 86400000);
  } else if (body.expiresAt) {
    const d = new Date(body.expiresAt);
    if (!Number.isNaN(d.getTime())) expiresAt = d;
  }

  const defaultTitle = usable.length === 1
    ? `${resolved.sources[0].name}·AI 问数`
    : `AI 问数（${resolved.sources.length} 个数据范围）`;
  const title = String(body.title || defaultTitle).trim().slice(0, 191) || 'AI 问数';

  await ensureTable();
  const result = await db.query(
    `INSERT INTO jdywh_ai_shares
       (token, title, scope_json, password, password_plain, expires_at, allow_export, status, created_by)
     VALUES (?,?,?,?,?,?,?,1,?)`,
    [
      token, title, JSON.stringify(usable),
      password, plain, expiresAt,
      body.allowExport ? 1 : 0,
      userId || null,
    ]
  );
  const row = await db.queryOne('SELECT * FROM jdywh_ai_shares WHERE id = ? LIMIT 1', [result.insertId]);
  const baseUrl = (ctx && ctx.baseUrl) || await settings.get('default_base_url', '');
  return withUrl(publicShare(row), ctx && ctx.reqHost, baseUrl);
}

/**
 * 分享列表。
 * @param {{reqHost?:string, page?:number, pageSize?:number}} [ctx]
 */
async function listShares(ctx) {
  await ensureTable();
  const c = ctx || {};
  const page = Math.max(1, parseInt(c.page || '1', 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(c.pageSize || '50', 10) || 50));
  const offset = (page - 1) * pageSize;
  const baseUrl = await settings.get('default_base_url', '');
  const totalRow = await db.queryOne('SELECT COUNT(*) AS c FROM jdywh_ai_shares');
  const rows = await db.query(
    `SELECT * FROM jdywh_ai_shares ORDER BY id DESC LIMIT ${pageSize} OFFSET ${offset}`
  );
  return {
    list: rows.map((r) => withUrl(publicShare(r), c.reqHost, baseUrl)),
    total: Number((totalRow && totalRow.c) || 0),
    page,
    pageSize,
    enabled: await settings.getBool('ai_public_ask_enabled'),
  };
}

/** 详情（含 scope 解析后的可用情况，供管理端展示） */
async function getShare(id) {
  await ensureTable();
  const row = await db.queryOne('SELECT * FROM jdywh_ai_shares WHERE id = ? LIMIT 1', [Number(id)]);
  if (!row) return null;
  const share = publicShare(row);
  let sources = [];
  let invalid = [];
  try {
    const r = await aiScope.resolveScope(share.scope);
    sources = r.sources.map((s) => ({
      kind: s.kind, id: s.id, name: s.name, rowCount: Number(s.rowCount || 0),
    }));
    invalid = r.invalid;
  } catch (err) {
    invalid = [{ reason: err.message }];
  }
  return Object.assign(share, { sources, invalidSources: invalid });
}

/** 启停 */
async function toggleShare(id, status) {
  await ensureTable();
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) throw new Error('分享 ID 不合法');
  await db.query('UPDATE jdywh_ai_shares SET status = ? WHERE id = ?', [Number(status) ? 1 : 0, n]);
  const row = await db.queryOne('SELECT * FROM jdywh_ai_shares WHERE id = ? LIMIT 1', [n]);
  if (!row) throw new Error('分享不存在');
  return publicShare(row);
}

/** 删除 */
async function deleteShare(id) {
  await ensureTable();
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) throw new Error('分享 ID 不合法');
  const row = await db.queryOne('SELECT id FROM jdywh_ai_shares WHERE id = ? LIMIT 1', [n]);
  if (!row) throw new Error('分享不存在');
  await db.query('DELETE FROM jdywh_ai_shares WHERE id = ?', [n]);
  return true;
}

/* ══════════════════════════════════════════════════════════════════
 *  五、公开访问
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 按 token 取分享并做基础校验（存在 / 停用 / 过期，**不含密码**）。
 *
 * @param {string} token
 * @returns {Promise<{ok:boolean, code?:string, message?:string, share?:object}>}
 */
async function findByToken(token) {
  const t = String(token || '').trim();
  if (!t) return { ok: false, code: 'not_found', message: '缺少分享令牌' };
  await ensureTable();
  const row = await db.queryOne('SELECT * FROM jdywh_ai_shares WHERE token = ? LIMIT 1', [t]);
  if (!row) return { ok: false, code: 'not_found', message: '分享链接不存在或已被删除' };
  if (Number(row.status) !== 1) return { ok: false, code: 'disabled', message: '该分享已被停用，请联系分享者' };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, code: 'expired', message: '该分享链接已过期，请联系分享者重新生成' };
  }
  return { ok: true, share: publicShare(row), raw: row };
}

/**
 * 公开元信息（GET /api/public/ai-shares/:token）。
 *
 * 返回内容刻意**不含**物理表名、列清单、SQL —— 只给「名字 + 行数」，
 * 避免未授权访问者从接口反推库结构。
 *
 * @param {string} token
 * @param {string} [pwd]
 * @param {{now?:number}} [opts]
 */
async function publicMeta(token, pwd, opts) {
  const now = (opts && opts.now) || Date.now();
  const found = await findByToken(token);
  if (!found.ok) return found;

  const row = found.raw;
  const share = found.share;
  const needPassword = !!row.password;

  // 密码错误次数限流（先查后验，避免暴力猜解）
  const gate = checkPasswordRate(row.token, now);
  if (!gate.ok) return gate;

  let passwordError = false;
  if (needPassword) {
    const given = pwd === undefined || pwd === null ? '' : String(pwd);
    if (!given) {
      // 未提供密码：正常「请先输入密码」流程，不算失败
      return {
        ok: true,
        title: share.title || 'AI 问数',
        needPassword: true,
        passwordError: false,
        allowExport: share.allowExport,
        welcome: await settings.get('ai_welcome', ''),
        sources: [],
        askEnabled: await settings.getBool('ai_public_ask_enabled'),
      };
    }
    if (sha256(given) !== row.password) {
      markPasswordFail(row.token, now);
      passwordError = true;
      return {
        ok: true,
        title: share.title || 'AI 问数',
        needPassword: true,
        passwordError,
        message: '访问密码不正确',
        allowExport: share.allowExport,
        welcome: await settings.get('ai_welcome', ''),
        sources: [],
        askEnabled: await settings.getBool('ai_public_ask_enabled'),
      };
    }
    clearPasswordFail(row.token);
  }

  // 访问计数（元信息通过密码后 +1，与 jdywh_shares 的行为一致）
  await db.query('UPDATE jdywh_ai_shares SET view_count = view_count + 1 WHERE id = ?', [row.id]);

  // 解析数据范围（只暴露名字与行数）
  let sources = [];
  let invalid = [];
  try {
    const r = await aiScope.resolveScope(share.scope);
    sources = r.sources.map((s) => ({
      kind: s.kind,
      name: s.name,
      rowCount: Number(s.rowCount || 0),
      columnCount: (s.columns || []).length,
    }));
    invalid = r.invalid.map((i) => ({ name: i.name || '', reason: i.reason }));
  } catch (err) {
    invalid = [{ name: '', reason: err.message }];
  }

  return {
    ok: true,
    title: share.title || 'AI 问数',
    needPassword,
    passwordError: false,
    allowExport: share.allowExport,
    welcome: await settings.get('ai_welcome', ''),
    sources,
    askEnabled: await settings.getBool('ai_public_ask_enabled'),
    invalidSources: invalid,
    expiresAt: share.expiresAt,
  };
}

/** 公开问数前的完整校验（密码 / 停用 / 过期 / 限流）→ 返回可用的 scope */
async function authorizeAsk(token, pwd, ip, opts) {
  const now = (opts && opts.now) || Date.now();

  if (!(await settings.getBool('ai_public_ask_enabled'))) {
    return { ok: false, code: 'DISABLED_GLOBAL', message: '管理员已关闭公开问数，请联系分享者' };
  }

  const found = await findByToken(token);
  if (!found.ok) return found;

  const row = found.raw;

  // 密码错误锁定
  const gate = checkPasswordRate(row.token, now);
  if (!gate.ok) return gate;

  if (row.password) {
    const given = pwd === undefined || pwd === null ? '' : String(pwd);
    if (sha256(given) !== row.password) {
      markPasswordFail(row.token, now);
      const n = failCount(`pwd:${row.token}`, now);
      if (n >= PWD_MAX_FAILS) {
        return { ok: false, code: 'RATE_PASSWORD', message: `密码错误次数过多（10 分钟内 ${PWD_MAX_FAILS} 次），请稍后再试` };
      }
      return { ok: false, code: 'PASSWORD', message: '访问密码不正确' };
    }
    clearPasswordFail(row.token);
  }

  // 频率限制
  const tokenPerMin = await settings.getInt('ai_public_rate_per_min', DEFAULT_TOKEN_PER_MIN);
  const rate = checkRate({
    tokenKey: row.token,
    ipKey: ip ? String(ip) : '',
    tokenPerMin,
    ipPerMin: DEFAULT_IP_PER_MIN,
    now,
  });
  if (!rate.ok) return rate;

  return { ok: true, share: found.share, raw: row };
}

/**
 * 公开问数。
 *
 * @param {string} token
 * @param {string} question
 * @param {{pwd?:string, sessionKey?:string, history?:Array, ip?:string, ask?:Function, now?:number}} options
 */
async function publicAsk(token, question, options) {
  const opts = options || {};
  const started = Date.now();
  const q = String(question || '').trim();
  if (!q) return { ok: false, code: 'BAD_REQUEST', message: '请输入问题' };
  if (q.length > 2000) return { ok: false, code: 'BAD_REQUEST', message: '问题过长（最多 2000 字）' };

  const auth = await authorizeAsk(token, opts.pwd, opts.ip, opts);
  if (!auth.ok) return auth;

  if (!(await settings.getBool('ai_enabled'))) {
    return { ok: false, code: 'AI_DISABLED', message: '系统未启用 AI 问数，请联系管理员' };
  }

  const share = auth.share;
  const maxRowsSetting = await settings.getInt('ai_max_rows', 500);
  const cap = Math.min(maxRowsSetting > 0 ? maxRowsSetting : 500, PUBLIC_MAX_ROWS);

  const askFn = opts.ask || require('./ai').ask;
  const sessionKey = opts.sessionKey || crypto.randomBytes(8).toString('hex');

  let result;
  try {
    result = await askFn(q, {
      scope: share.scope,
      sessionKey,
      userId: null,
      history: opts.history,
      limit: cap,
      maxRowsCap: cap,
      shareId: share.id,
    });
  } catch (err) {
    return { ok: false, code: 'ASK_FAILED', message: err.message || '问数失败，请换个问法重试' };
  }

  // 计数与最后问数时间
  try {
    await db.query(
      'UPDATE jdywh_ai_shares SET ask_count = ask_count + 1, last_ask_at = NOW() WHERE id = ?',
      [share.id]
    );
  } catch (err) {
    console.error('[ai-shares] 更新问数计数失败:', err.message);
  }

  // 公开返回**不含 sql**（避免泄露表结构）
  const rows = Array.isArray(result.rows) ? result.rows.slice(0, cap) : [];
  return {
    ok: true,
    sessionKey: result.sessionKey || sessionKey,
    question: q,
    answer: result.answer || '',
    rows,
    columns: result.columns || (rows.length ? Object.keys(rows[0]).map((k) => ({ name: k, type: typeof rows[0][k] })) : []),
    rowCount: rows.length,
    truncated: Array.isArray(result.rows) && result.rows.length > cap,
    sources: (result.sources || []).map((s) => ({ kind: s.kind, name: s.name, rowCount: s.rowCount })),
    duration: Date.now() - started,
    allowExport: share.allowExport,
  };
}

module.exports = {
  PUBLIC_MAX_ROWS,
  DEFAULT_TOKEN_PER_MIN,
  DEFAULT_IP_PER_MIN,
  PWD_MAX_FAILS,
  PWD_WINDOW_MS,
  CREATE_TABLE_SQL,
  ensureTable,
  // 限流（自测脚本会用）
  checkRate,
  checkPasswordRate,
  markPasswordFail,
  clearPasswordFail,
  failCount,
  resetRate,
  buckets,
  // 序列化
  normalizeScope,
  publicShare,
  buildShareUrl,
  sha256,
  // 管理端
  createShare,
  listShares,
  getShare,
  toggleShare,
  deleteShare,
  // 公开端
  findByToken,
  publicMeta,
  authorizeAsk,
  publicAsk,
};
