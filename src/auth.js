'use strict';

const crypto = require('crypto');
const db = require('./db');
const settings = require('./settings');
const users = require('./users');
const roles = require('./roles');

const COOKIE_NAME = 'jdy_sid';

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) {
      try { out[k] = decodeURIComponent(v); } catch (_) { out[k] = v; }
    }
  });
  return out;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && (req.socket.remoteAddress || req.connection.remoteAddress)) || '';
}

/* ============ 登录日志 ============ */

async function logLogin(username, userId, success, message, req) {
  try {
    await db.query(
      `INSERT INTO jdywh_login_logs (username, user_id, success, message, ip, user_agent)
       VALUES (?,?,?,?,?,?)`,
      [
        username || null,
        userId || null,
        success ? 1 : 0,
        message ? String(message).slice(0, 240) : null,
        clientIp(req) || null,
        String((req && req.headers['user-agent']) || '').slice(0, 240) || null,
      ]
    );
  } catch (err) {
    console.error('[login-log]', err.message);
  }
}

/** 最近一段时间内的失败次数 */
async function recentFailures(username, minutes) {
  const row = await db.queryOne(
    `SELECT COUNT(*) AS c FROM jdywh_login_logs
      WHERE username = ? AND success = 0 AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [username, minutes || 15]
  );
  return row ? Number(row.c) : 0;
}

/* ============ 登录 / 登出 ============ */

async function login(loginName, password, req) {
  const name = String(loginName || '').trim();
  const maxAttempts = await settings.getInt('login_max_attempts', 10);

  if (maxAttempts > 0) {
    const fails = await recentFailures(name, 15);
    if (fails >= maxAttempts) {
      await logLogin(name, null, false, '尝试次数过多', req);
      return { ok: false, message: `登录失败次数过多，请 15 分钟后再试` };
    }
  }

  const user = await users.findByLogin(name);
  if (!user) {
    await logLogin(name, null, false, '账号不存在', req);
    return { ok: false, message: '账号或密码错误' };
  }

  if (Number(user.status) !== 1) {
    await logLogin(name, user.id, false, '账号已被禁用', req);
    return { ok: false, message: '该账号已被禁用，请联系管理员' };
  }

  const match = await users.verifyPassword(user, password);
  if (!match) {
    await logLogin(name, user.id, false, '密码错误', req);
    return { ok: false, message: '账号或密码错误' };
  }

  const ttlDays = await settings.getInt('session_ttl_days', 7);
  const token = newToken();
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * (ttlDays > 0 ? ttlDays : 7));

  await db.query(
    'INSERT INTO jdywh_sessions (token, user_id, ip, user_agent, expires_at) VALUES (?,?,?,?,?)',
    [token, user.id, clientIp(req) || null, String((req && req.headers['user-agent']) || '').slice(0, 240) || null, expires]
  );
  await users.touchLogin(user.id, clientIp(req));
  await logLogin(name, user.id, true, '登录成功', req);

  return { ok: true, token, expires, user: await users.publicUser(user) };
}

async function resolveSession(token) {
  if (!token) return null;
  const row = await db.queryOne(
    `SELECT s.token, s.expires_at, s.user_id, u.*
       FROM jdywh_sessions s JOIN jdywh_users u ON u.id = s.user_id
      WHERE s.token = ? LIMIT 1`,
    [token]
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.query('DELETE FROM jdywh_sessions WHERE token = ?', [token]);
    return null;
  }
  if (Number(row.status) !== 1) {
    await db.query('DELETE FROM jdywh_sessions WHERE token = ?', [token]);
    return null;
  }
  return { token: row.token, user: await users.publicUser(row), raw: row };
}

async function logout(token) {
  if (!token) return;
  await db.query('DELETE FROM jdywh_sessions WHERE token = ?', [token]);
}

async function cleanupExpired() {
  await db.query('DELETE FROM jdywh_sessions WHERE expires_at < NOW()');
  await users.cleanupResets();
}

/* ============ 注册 ============ */

async function register(input, req) {
  const allowed = await settings.getBool('allow_registration');
  if (!allowed) return { ok: false, message: '系统未开放自助注册' };

  const username = String(input.username || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');

  if (!users.validUsername(username)) {
    return { ok: false, message: '账号需为 3-32 位字母、数字、下划线、点或短横线' };
  }
  if (!users.validEmail(email)) return { ok: false, message: '请输入正确的邮箱地址' };

  const minLen = await users.minPasswordLength();
  if (password.length < minLen) return { ok: false, message: `密码长度至少 ${minLen} 位` };
  if (input.confirmPassword !== undefined && password !== String(input.confirmPassword)) {
    return { ok: false, message: '两次输入的密码不一致' };
  }

  if (!(await settings.mailReady())) {
    return { ok: false, message: '系统尚未配置邮件服务，暂时无法自助注册，请联系管理员开通账号' };
  }

  try {
    const user = await users.createUser(
      { username, email, password, displayName: input.displayName || username, role: 'viewer' },
      { emailVerified: false }
    );
    const { token } = await users.createResetToken(user.id, 'verify_email');
    await logLogin(username, user.id, true, '注册成功', req);
    return { ok: true, userId: user.id, verifyToken: token, email };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

/** 发送邮箱验证邮件 */
async function sendVerifyMail(userId, email, displayName, baseUrl) {
  const { token } = await users.createResetToken(userId, 'verify_email');
  const link = `${baseUrl}/verify-email?token=${token}`;
  const mailer = require('./mailer');
  await mailer.sendVerifyEmail(email, displayName, link);
  return link;
}

async function verifyEmail(token) {
  const row = await users.consumeResetToken(token, 'verify_email');
  if (!row) return { ok: false, message: '验证链接无效或已过期' };
  await users.markEmailVerified(row.user_id);
  return { ok: true, userId: row.user_id };
}

/* ============ 找回密码 ============ */

/**
 * 发起找回密码：无论邮箱是否存在都返回成功（防止枚举邮箱）
 */
async function requestPasswordReset(email, baseUrl) {
  const target = String(email || '').trim().toLowerCase();
  if (!users.validEmail(target)) {
    return { ok: false, message: '请输入正确的邮箱地址' };
  }
  if (!(await settings.mailReady())) {
    return { ok: false, message: '系统尚未配置邮件服务，无法发送重置邮件，请联系管理员重置密码' };
  }

  const user = await users.findByEmail(target);
  if (!user) {
    // 不暴露账号是否存在
    return { ok: true, sent: false, message: '如果该邮箱已注册，我们已发送重置邮件，请查收' };
  }
  if (Number(user.status) !== 1) {
    return { ok: true, sent: false, message: '如果该邮箱已注册，我们已发送重置邮件，请查收' };
  }

  const { token, expires } = await users.createResetToken(user.id, 'reset_password');
  const link = `${baseUrl}/reset-password?token=${token}`;
  const ttl = Math.round((expires.getTime() - Date.now()) / 60000);

  try {
    const mailer = require('./mailer');
    await mailer.sendResetPassword(user.email, user.display_name, link, ttl);
  } catch (err) {
    console.error('[reset-mail]', err.message);
    return { ok: false, message: '邮件发送失败：' + err.message };
  }

  return { ok: true, sent: true, message: '重置邮件已发送，请查收（30 分钟内有效）' };
}

async function resetPassword(token, newPassword, confirmPassword) {
  if (newPassword !== confirmPassword) {
    return { ok: false, message: '两次输入的密码不一致' };
  }
  const minLen = await users.minPasswordLength();
  if (String(newPassword || '').length < minLen) {
    return { ok: false, message: `密码长度至少 ${minLen} 位` };
  }

  // 先校验令牌有效性（不消费），设置成功后再消费
  const row = await db.queryOne(
    `SELECT * FROM jdywh_resets
      WHERE token = ? AND purpose = 'reset_password' AND used = 0 AND expires_at > NOW() LIMIT 1`,
    [String(token || '').trim()]
  );
  if (!row) return { ok: false, message: '重置链接无效或已过期，请重新申请' };

  const user = await users.findById(row.user_id);
  if (!user) return { ok: false, message: '账号不存在' };

  try {
    await users.setPassword(user.id, newPassword);
  } catch (err) {
    return { ok: false, message: err.message };
  }
  await users.consumeResetToken(token, 'reset_password');
  return { ok: true, username: user.username };
}

/** 校验重置令牌是否可用（渲染重置页面用） */
async function checkResetToken(token) {
  const row = await db.queryOne(
    `SELECT r.*, u.username, u.display_name FROM jdywh_resets r
       JOIN jdywh_users u ON u.id = r.user_id
      WHERE r.token = ? AND r.purpose = 'reset_password' AND r.used = 0 AND r.expires_at > NOW()
      LIMIT 1`,
    [String(token || '').trim()]
  );
  return row || null;
}

/* ============ 修改密码 ============ */

async function changePassword(userId, oldPassword, newPassword) {
  const r = await users.changeOwnPassword(userId, oldPassword, newPassword);
  return r;
}

/* ============ 中间件 ============ */

async function middleware(req, res, next) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[COOKIE_NAME];
    const session = await resolveSession(token);

    req.session = session;
    req.user = session ? session.user : null;
    req.rawUser = session ? session.raw : null;

    res.locals.currentUser = req.user;
    res.locals.can = (perm) => users.can(req.user, perm);
    res.locals.isAdmin = users.isAdmin(req.user);
    res.locals.settings = await settings.all();
    res.locals.ROLES = await users.loadRoles();

    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  const wantsJson = req.xhr || (req.headers.accept || '').includes('application/json');
  if (wantsJson) return res.status(401).json({ ok: false, message: '未登录或登录已过期' });
  const back = encodeURIComponent(req.originalUrl || '/');
  return res.redirect('/login?redirect=' + back);
}

function requireAuthApi(req, res, next) {
  if (req.user) return next();
  return res.status(401).json({ ok: false, message: '未登录或登录已过期' });
}

/** 权限中间件（API） */
function requirePerm(permission) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ ok: false, message: '未登录或登录已过期' });
    if (users.can(req.user, permission)) return next();
    const name = roles.PERMISSION_NAMES[permission] || permission;
    return res.status(403).json({ ok: false, message: `没有操作权限（需要「${name}」）` });
  };
}

/** 页面级权限 */
function requirePermPage(permission) {
  return function (req, res, next) {
    if (!req.user) return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl || '/'));
    if (users.can(req.user, permission)) return next();
    const name = roles.PERMISSION_NAMES[permission] || permission;
    return res.status(403).render('error', {
      title: '403',
      message: `没有访问权限（需要「${name}」）`,
      active: '',
    });
  };
}

/** 兼容旧调用：等价于 requirePerm('settings:write') */
function requireAdminApi(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, message: '未登录或登录已过期' });
  if (users.can(req.user, 'settings:write')) return next();
  return res.status(403).json({ ok: false, message: '没有操作权限（需要「修改系统设置」）' });
}

/** 兼容旧调用：等价于 requirePermPage('settings:write') */
function requireAdminPage(req, res, next) {
  if (!req.user) return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl || '/'));
  if (users.can(req.user, 'settings:write')) return next();
  return res.status(403).render('error', { title: '403', message: '没有访问权限（需要「修改系统设置」）', active: '' });
}

function setSessionCookie(res, token, expires) {
  res.append('Set-Cookie', [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expires.toUTCString()}`,
  ].join('; '));
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

module.exports = {
  COOKIE_NAME,
  login,
  logout,
  register,
  resolveSession,
  changePassword,
  requestPasswordReset,
  resetPassword,
  checkResetToken,
  sendVerifyMail,
  verifyEmail,
  cleanupExpired,
  logLogin,
  recentFailures,
  middleware,
  requireAuth,
  requireAuthApi,
  requirePerm,
  requirePermPage,
  requireAdminApi,
  requireAdminPage,
  setSessionCookie,
  clearSessionCookie,
  clientIp,
};