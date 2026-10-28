'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const settings = require('./settings');
const roles = require('./roles');

/* ============ 角色与权限（由 jdywh_roles 表驱动，可在界面编辑） ============ */

/** 角色字典缓存 */
let roleDict = null;

async function loadRoles(force) {
  if (roleDict && !force) return roleDict;
  const list = await roles.list();
  const map = {};
  list.forEach((r) => { map[r.key] = r; });
  roleDict = map;
  return map;
}

function clearRoleCache() {
  roleDict = null;
  roles.clearPermCache();
}

/** 角色是否存在 */
async function roleExists(key) {
  const map = await loadRoles();
  return !!map[key];
}

function can(user, permission) {
  if (!user) return false;
  const perms = user.permissions;
  if (Array.isArray(perms)) return roles.canSync(perms, permission);
  return false;
}

function isAdmin(user) {
  if (!user) return false;
  const perms = user.permissions;
  return Array.isArray(perms) && perms.includes('*');
}

/* ============ 用户查询 ============ */

async function publicUser(row) {
  if (!row) return null;
  const map = await loadRoles();
  const role = map[row.role];
  const perms = role ? role.permissions : [];
  return {
    id: row.id,
    username: row.username,
    email: row.email || '',
    displayName: row.display_name || row.username,
    role: row.role,
    roleName: role ? role.name : row.role,
    permissions: perms,
    status: Number(row.status),
    emailVerified: Number(row.email_verified) === 1,
    avatar: row.avatar || null,
    avatarColor: row.avatar_color || null,
    phone: row.phone || '',
    department: row.department || '',
    position: row.position || '',
    lastLoginAt: row.last_login_at,
    lastLoginIp: row.last_login_ip,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findById(id) {
  return db.queryOne('SELECT * FROM jdywh_users WHERE id = ? LIMIT 1', [id]);
}

/** 按用户名或邮箱查找（登录用） */
async function findByLogin(login) {
  const v = String(login || '').trim();
  if (!v) return null;
  return db.queryOne(
    'SELECT * FROM jdywh_users WHERE username = ? OR email = ? LIMIT 1',
    [v, v]
  );
}

async function findByEmail(email) {
  const v = String(email || '').trim();
  if (!v) return null;
  return db.queryOne('SELECT * FROM jdywh_users WHERE email = ? LIMIT 1', [v]);
}

async function findByUsername(username) {
  return db.queryOne('SELECT * FROM jdywh_users WHERE username = ? LIMIT 1', [String(username || '').trim()]);
}

async function list(keyword) {
  const kw = String(keyword || '').trim();
  let sql = `SELECT u.*,
               (SELECT COUNT(*) FROM jdywh_projects p WHERE p.created_by = u.id) AS project_count,
               d.name AS department_name
               FROM jdywh_users u
               LEFT JOIN jdywh_departments d ON d.id = u.department_id`;
  const params = [];
  if (kw) {
    sql += ' WHERE u.username LIKE ? OR u.email LIKE ? OR u.display_name LIKE ?';
    params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
  }
  sql += ' ORDER BY u.id ASC';
  const rows = await db.query(sql, params);
  const out = [];
  for (const r of rows) {
    out.push(Object.assign(await publicUser(r), {
      projectCount: Number(r.project_count || 0),
      department: r.department_name || '',
      departmentId: r.department_id ? Number(r.department_id) : null,
    }));
  }
  return out;
}

async function stats() {
  const row = await db.queryOne(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admins
       FROM jdywh_users`
  );
  return {
    total: Number(row.total || 0),
    active: Number(row.active || 0),
    admins: Number(row.admins || 0),
  };
}

/* ============ 校验 ============ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;

function validEmail(email) {
  return EMAIL_RE.test(String(email || '').trim());
}

function validUsername(username) {
  return USERNAME_RE.test(String(username || '').trim());
}

async function minPasswordLength() {
  const n = await settings.getInt('min_password_length', 6);
  return n > 0 ? n : 6;
}

/* ============ 增删改 ============ */

async function createUser(input, options) {
  const opts = options || {};
  const username = String(input.username || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  const roleMap = await loadRoles();
  const role = roleMap[input.role] ? input.role : 'editor';
  const displayName = String(input.displayName || '').trim() || username;

  if (!validUsername(username)) throw new Error('账号需为 3-32 位字母、数字、下划线、点或短横线');
  if (email && !validEmail(email)) throw new Error('邮箱格式不正确');
  const minLen = await minPasswordLength();
  if (password.length < minLen) throw new Error(`密码长度至少 ${minLen} 位`);

  if (await findByUsername(username)) throw new Error('该账号已存在');
  if (email && (await findByEmail(email))) throw new Error('该邮箱已被使用');

  const hash = bcrypt.hashSync(password, 10);
  const status = input.status === 0 || input.status === '0' ? 0 : 1;
  const emailVerified = opts.emailVerified ? 1 : (email ? 0 : 0);

  const result = await db.query(
    `INSERT INTO jdywh_users
       (username, email, password_hash, display_name, role, status, email_verified,
        department_id, position, phone)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      username, email || null, hash, displayName, role, status, emailVerified,
      Number(input.departmentId) || null,
      String(input.position || '').trim() || null,
      String(input.phone || '').trim() || null,
    ]
  );
  return findById(result.insertId);
}

async function updateUser(id, input) {
  const user = await findById(id);
  if (!user) throw new Error('用户不存在');

  const fields = [];
  const params = [];
  const set = (col, val) => { fields.push(`${col} = ?`); params.push(val); };

  if (input.email !== undefined) {
    const email = String(input.email || '').trim().toLowerCase();
    if (email && !validEmail(email)) throw new Error('邮箱格式不正确');
    if (email) {
      const exist = await findByEmail(email);
      if (exist && Number(exist.id) !== Number(id)) throw new Error('该邮箱已被使用');
    }
    set('email', email || null);
    if (email !== (user.email || '')) set('email_verified', 0);
  }

  if (input.displayName !== undefined) {
    set('display_name', String(input.displayName || '').trim() || user.username);
  }

  if (input.role !== undefined) {
    const roleMap = await loadRoles();
    if (!roleMap[input.role]) throw new Error('角色不正确');
    // 不允许把最后一个管理员降级
    if (user.role === 'admin' && input.role !== 'admin') {
      const s = await stats();
      if (s.admins <= 1) throw new Error('系统至少需要保留一个超级管理员');
    }
    set('role', input.role);
  }

  if (input.status !== undefined) {
    const status = Number(input.status) ? 1 : 0;
    if (user.role === 'admin' && status === 0) {
      const s = await stats();
      if (s.admins <= 1) throw new Error('系统至少需要保留一个启用的超级管理员');
    }
    set('status', status);
  }

  if (input.password) {
    const minLen = await minPasswordLength();
    if (String(input.password).length < minLen) throw new Error(`密码长度至少 ${minLen} 位`);
    set('password_hash', bcrypt.hashSync(String(input.password), 10));
  }

  if (input.departmentId !== undefined) set('department_id', Number(input.departmentId) || null);
  if (input.position !== undefined) set('position', String(input.position || '').trim() || null);
  if (input.phone !== undefined) set('phone', String(input.phone || '').trim() || null);

  if (!fields.length) return user;
  params.push(id);
  await db.query(`UPDATE jdywh_users SET ${fields.join(', ')} WHERE id = ?`, params);
  return findById(id);
}

async function deleteUser(id, operatorId) {
  const user = await findById(id);
  if (!user) throw new Error('用户不存在');
  if (Number(id) === Number(operatorId)) throw new Error('不能删除自己的账号');
  if (user.role === 'admin') {
    const s = await stats();
    if (s.admins <= 1) throw new Error('系统至少需要保留一个超级管理员');
  }
  await db.query('DELETE FROM jdywh_sessions WHERE user_id = ?', [id]);
  await db.query('DELETE FROM jdywh_users WHERE id = ?', [id]);
  return true;
}

/* ============ 密码 ============ */

async function verifyPassword(user, password) {
  if (!user) return false;
  return bcrypt.compareSync(String(password || ''), user.password_hash);
}

async function setPassword(id, newPassword) {
  const minLen = await minPasswordLength();
  if (String(newPassword || '').length < minLen) throw new Error(`密码长度至少 ${minLen} 位`);
  const hash = bcrypt.hashSync(String(newPassword), 10);
  await db.query('UPDATE jdywh_users SET password_hash = ? WHERE id = ?', [hash, id]);
  // 修改密码后强制其他会话失效
  await db.query('DELETE FROM jdywh_sessions WHERE user_id = ?', [id]);
  return true;
}

async function changeOwnPassword(id, oldPassword, newPassword) {
  const user = await findById(id);
  if (!user) return { ok: false, message: '用户不存在' };
  if (!bcrypt.compareSync(String(oldPassword || ''), user.password_hash)) {
    return { ok: false, message: '原密码错误' };
  }
  if (String(oldPassword) === String(newPassword)) {
    return { ok: false, message: '新密码不能与原密码相同' };
  }
  try {
    await setPassword(id, newPassword);
  } catch (err) {
    return { ok: false, message: err.message };
  }
  return { ok: true };
}

/* ============ 找回密码令牌 ============ */

async function createResetToken(userId, purpose) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 1000 * 60 * 30); // 30 分钟
  await db.query(
    `INSERT INTO jdywh_resets (token, user_id, purpose, expires_at)
     VALUES (?,?,?,?)`,
    [token, userId, purpose || 'reset_password', expires]
  );
  return { token, expires };
}

async function consumeResetToken(token, purpose) {
  const row = await db.queryOne(
    `SELECT * FROM jdywh_resets
      WHERE token = ? AND purpose = ? AND used = 0 AND expires_at > NOW() LIMIT 1`,
    [String(token || '').trim(), purpose || 'reset_password']
  );
  if (!row) return null;
  await db.query('UPDATE jdywh_resets SET used = 1 WHERE id = ?', [row.id]);
  return row;
}

async function cleanupResets() {
  await db.query('DELETE FROM jdywh_resets WHERE expires_at < NOW() OR used = 1');
}

async function markEmailVerified(userId) {
  await db.query('UPDATE jdywh_users SET email_verified = 1 WHERE id = ?', [userId]);
}

async function touchLogin(userId, ip) {
  await db.query(
    'UPDATE jdywh_users SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?',
    [ip || null, userId]
  );
}

module.exports = {
  loadRoles,
  clearRoleCache,
  roleExists,
  can,
  isAdmin,
  publicUser,
  findById,
  findByLogin,
  findByEmail,
  findByUsername,
  list,
  stats,
  validEmail,
  validUsername,
  minPasswordLength,
  createUser,
  updateUser,
  deleteUser,
  verifyPassword,
  setPassword,
  changeOwnPassword,
  createResetToken,
  consumeResetToken,
  cleanupResets,
  markEmailVerified,
  touchLogin,
};
