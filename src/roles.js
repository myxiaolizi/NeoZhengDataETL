'use strict';

const db = require('./db');

/**
 * 角色与权限体系
 *
 * 权限点按「模块:操作」命名，角色权限可在界面编辑。
 * 内置三个角色（admin/editor/viewer）不可删除，但权限可调整。
 */

/** 全部权限点定义（用于界面渲染权限矩阵） */
const PERMISSION_GROUPS = [
  {
    key: 'project',
    name: '项目管理',
    items: [
      { key: 'project:read', name: '查看项目', desc: '查看项目列表与详情' },
      { key: 'project:write', name: '管理项目', desc: '新建/编辑/删除项目，配置推送地址与 Secret' },
      { key: 'field:write', name: '字段设置', desc: '导入字段表、配置解析方式、同步表结构' },
    ],
  },
  {
    key: 'data',
    name: '数据管理',
    items: [
      { key: 'data:read', name: '查看数据', desc: '查看数据明细与子表数据' },
      { key: 'data:delete', name: '删除数据', desc: '删除单条数据记录' },
      { key: 'data:export', name: '导出数据', desc: '导出 CSV 数据文件' },
    ],
  },
  {
    key: 'log',
    name: '日志管理',
    items: [
      { key: 'log:read', name: '查看日志', desc: '查看推送接收日志' },
      { key: 'log:clear', name: '清空日志', desc: '清空项目接收日志' },
    ],
  },
  {
    key: 'report',
    name: '报表与 BI',
    items: [
      { key: 'dataset:read', name: '查看数据集', desc: '查看数据集列表与预览' },
      { key: 'dataset:write', name: '管理数据集', desc: '新建/编辑/删除数据集' },
      { key: 'report:read', name: '查看报表', desc: '查看报表与大屏' },
      { key: 'report:write', name: '管理报表', desc: '新建/编辑/删除报表与大屏' },
      { key: 'share:write', name: '分享管理', desc: '创建与撤销分享链接' },
    ],
  },
  {
    key: 'integration',
    name: '数据集成',
    items: [
      { key: 'integration:read', name: '查看集成', desc: '查看集成任务与运行日志' },
      { key: 'integration:write', name: '管理集成', desc: '新建/编辑/删除集成任务，手动执行' },
    ],
  },
  {
    key: 'form',
    name: '表单采集',
    items: [
      { key: 'form:read', name: '查看表单', desc: '查看表单定义与提交数据' },
      { key: 'form:write', name: '管理表单', desc: '设计表单、发布填写链接、导出数据' },
    ],
  },
  {
    key: 'flow',
    name: '数据处理',
    items: [
      { key: 'flow:read', name: '查看流程', desc: '查看数据处理流程与运行日志' },
      { key: 'flow:write', name: '管理流程', desc: '新建/编辑/执行数据处理流程' },
    ],
  },
  {
    key: 'ai',
    name: 'AI 问数',
    items: [
      { key: 'ai:use', name: '使用 AI 问数', desc: '通过自然语言查询数据' },
      { key: 'ai:config', name: '配置 AI', desc: '配置大模型接口与提示词' },
    ],
  },
  {
    key: 'system',
    name: '系统管理',
    items: [
      { key: 'user:read', name: '查看用户', desc: '查看用户列表' },
      { key: 'user:write', name: '管理用户', desc: '新建/编辑/删除用户，重置密码' },
      { key: 'role:write', name: '管理角色', desc: '新建/编辑角色与权限' },
      { key: 'datasource:read', name: '查看数据源', desc: '查看数据源列表' },
      { key: 'datasource:write', name: '管理数据源', desc: '新建/编辑/删除数据源，测试连接' },
      { key: 'settings:read', name: '查看系统设置', desc: '查看系统配置' },
      { key: 'settings:write', name: '修改系统设置', desc: '修改站点、安全、邮件、推送等配置' },
      { key: 'audit:read', name: '查看审计日志', desc: '查看操作审计与登录日志' },
    ],
  },
];

/** 扁平化权限点列表 */
const ALL_PERMISSIONS = PERMISSION_GROUPS.reduce((acc, g) => acc.concat(g.items.map((i) => i.key)), []);

const PERMISSION_NAMES = PERMISSION_GROUPS.reduce((acc, g) => {
  g.items.forEach((i) => { acc[i.key] = i.name; });
  return acc;
}, {});

/** 内置角色 */
const BUILTIN_ROLES = [
  {
    role_key: 'admin',
    name: '超级管理员',
    description: '拥有全部权限，可管理用户、角色、数据源与系统设置',
    permissions: ['*'],
    sort_order: 0,
  },
  {
    role_key: 'editor',
    name: '数据管理员',
    description: '管理项目、字段、数据、报表、表单与流程，不可管理用户与系统设置',
    permissions: [
      'project:read', 'project:write', 'field:write',
      'data:read', 'data:delete', 'data:export',
      'log:read', 'log:clear',
      'dataset:read', 'dataset:write', 'report:read', 'report:write', 'share:write',
      'integration:read', 'integration:write',
      'form:read', 'form:write',
      'flow:read', 'flow:write',
      'ai:use',
      'datasource:read',
    ],
    sort_order: 1,
  },
  {
    role_key: 'viewer',
    name: '只读用户',
    description: '仅可查看项目、数据、报表与日志',
    permissions: [
      'project:read', 'data:read', 'log:read',
      'dataset:read', 'report:read',
      'integration:read',
      'form:read', 'flow:read',
      'ai:use',
    ],
    sort_order: 2,
  },
];

/* ══════════ 角色仓储 ══════════ */

function parsePerms(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function publicRole(r) {
  if (!r) return null;
  const perms = parsePerms(r.permissions);
  return {
    id: Number(r.id),
    key: r.role_key,
    name: r.name,
    description: r.description || '',
    permissions: perms,
    permissionNames: perms.includes('*')
      ? ['全部权限']
      : perms.map((p) => PERMISSION_NAMES[p] || p),
    isSystem: Number(r.is_system) === 1,
    sortOrder: Number(r.sort_order || 0),
    userCount: r.user_count === undefined ? undefined : Number(r.user_count),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function list() {
  const rows = await db.query(
    `SELECT r.*, (SELECT COUNT(*) FROM jdywh_users u WHERE u.role = r.role_key) AS user_count
       FROM jdywh_roles r ORDER BY r.sort_order ASC, r.id ASC`
  );
  return rows.map(publicRole);
}

async function getByKey(key) {
  const row = await db.queryOne('SELECT * FROM jdywh_roles WHERE role_key = ? LIMIT 1', [key]);
  return row ? publicRole(row) : null;
}

/** 角色 → 权限数组（带缓存） */
let permCache = null;
let permCacheAt = 0;

async function permissionMap(force) {
  const now = Date.now();
  if (!force && permCache && now - permCacheAt < 10000) return permCache;
  const rows = await db.query('SELECT role_key, permissions FROM jdywh_roles');
  const map = {};
  rows.forEach((r) => { map[r.role_key] = parsePerms(r.permissions); });
  permCache = map;
  permCacheAt = now;
  return map;
}

function clearPermCache() {
  permCache = null;
  permCacheAt = 0;
}

/** 判断角色是否拥有某权限 */
async function roleCan(roleKey, permission) {
  const map = await permissionMap();
  const perms = map[roleKey];
  if (!perms) return false;
  if (perms.includes('*')) return true;
  return perms.includes(permission);
}

/** 判断用户是否拥有某权限 */
async function can(user, permission) {
  if (!user) return false;
  return roleCan(user.role, permission);
}

/** 同步版（用于已在中间件中预加载的场景） */
function canSync(permList, permission) {
  if (!permList) return false;
  if (permList.includes('*')) return true;
  return permList.includes(permission);
}

async function create(input) {
  const key = String(input.key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const name = String(input.name || '').trim();
  if (!key) throw new Error('角色标识不能为空');
  if (!name) throw new Error('角色名称不能为空');
  if (await getByKey(key)) throw new Error('角色标识已存在');

  const perms = Array.isArray(input.permissions) ? input.permissions.filter((p) => ALL_PERMISSIONS.includes(p)) : [];
  const result = await db.query(
    `INSERT INTO jdywh_roles (role_key, name, description, permissions, is_system, sort_order)
     VALUES (?,?,?,?,0,?)`,
    [key, name, String(input.description || '').trim() || null, JSON.stringify(perms), Number(input.sortOrder) || 99]
  );
  clearPermCache();
  const row = await db.queryOne('SELECT * FROM jdywh_roles WHERE id = ?', [result.insertId]);
  return publicRole(row);
}

async function update(id, input) {
  const row = await db.queryOne('SELECT * FROM jdywh_roles WHERE id = ? LIMIT 1', [id]);
  if (!row) throw new Error('角色不存在');

  const fields = [];
  const params = [];
  const set = (c, v) => { fields.push(`${c} = ?`); params.push(v); };

  if (input.name !== undefined) set('name', String(input.name).trim());
  if (input.description !== undefined) set('description', String(input.description || '').trim() || null);
  if (input.sortOrder !== undefined) set('sort_order', Number(input.sortOrder) || 0);

  if (input.permissions !== undefined) {
    // 超级管理员必须保留全部权限，避免把自己锁死
    if (row.role_key === 'admin') {
      const perms = Array.isArray(input.permissions) ? input.permissions : [];
      if (!perms.includes('*')) {
        throw new Error('超级管理员的权限不可缩减（必须包含全部权限）');
      }
    }
    const perms = Array.isArray(input.permissions)
      ? input.permissions.filter((p) => p === '*' || ALL_PERMISSIONS.includes(p))
      : [];
    set('permissions', JSON.stringify(perms));
  }

  if (!fields.length) return publicRole(row);
  params.push(id);
  await db.query(`UPDATE jdywh_roles SET ${fields.join(', ')} WHERE id = ?`, params);
  clearPermCache();
  const updated = await db.queryOne('SELECT * FROM jdywh_roles WHERE id = ?', [id]);
  return publicRole(updated);
}

async function remove(id) {
  const row = await db.queryOne('SELECT * FROM jdywh_roles WHERE id = ? LIMIT 1', [id]);
  if (!row) throw new Error('角色不存在');
  if (Number(row.is_system) === 1) throw new Error('系统内置角色不可删除');

  const used = await db.queryOne('SELECT COUNT(*) AS c FROM jdywh_users WHERE role = ?', [row.role_key]);
  if (used && Number(used.c) > 0) {
    throw new Error(`该角色下还有 ${used.c} 个用户，请先调整这些用户的角色`);
  }
  await db.query('DELETE FROM jdywh_roles WHERE id = ?', [id]);
  clearPermCache();
  return true;
}

module.exports = {
  PERMISSION_GROUPS,
  ALL_PERMISSIONS,
  PERMISSION_NAMES,
  BUILTIN_ROLES,
  list,
  getByKey,
  permissionMap,
  clearPermCache,
  roleCan,
  can,
  canSync,
  create,
  update,
  remove,
  publicRole,
  parsePerms,
};
