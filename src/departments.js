'use strict';

const db = require('./db');

/**
 * 组织架构（部门）
 *
 * 支持多级部门树，用户可归属到部门。
 */

function publicDept(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    name: r.name,
    parentId: Number(r.parent_id || 0),
    code: r.code || '',
    leader: r.leader || '',
    sortOrder: Number(r.sort_order || 0),
    remark: r.remark || '',
    userCount: Number(r.user_count || 0),
    createdAt: r.created_at,
  };
}

/** 部门列表（扁平） */
async function list() {
  const rows = await db.query(
    `SELECT d.*,
            (SELECT COUNT(*) FROM jdywh_users u WHERE u.department_id = d.id) AS user_count
       FROM jdywh_departments d
      ORDER BY d.sort_order ASC, d.id ASC`
  );
  return rows.map(publicDept);
}

/** 构建部门树 */
async function tree() {
  const flat = await list();
  const map = {};
  flat.forEach((d) => { map[d.id] = Object.assign({}, d, { children: [] }); });

  const roots = [];
  flat.forEach((d) => {
    const node = map[d.id];
    if (d.parentId && map[d.parentId]) map[d.parentId].children.push(node);
    else roots.push(node);
  });
  return roots;
}

async function getById(id) {
  const row = await db.queryOne('SELECT * FROM jdywh_departments WHERE id = ? LIMIT 1', [id]);
  return publicDept(row);
}

/** 检查是否会形成环 */
async function wouldCycle(id, parentId) {
  let cur = Number(parentId);
  const guard = new Set();
  while (cur && !guard.has(cur)) {
    if (cur === Number(id)) return true;
    guard.add(cur);
    const row = await db.queryOne('SELECT parent_id FROM jdywh_departments WHERE id = ? LIMIT 1', [cur]);
    if (!row) break;
    cur = Number(row.parent_id || 0);
  }
  return false;
}

async function create(input) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('请填写部门名称');

  const parentId = Number(input.parentId) || 0;
  if (parentId) {
    const parent = await getById(parentId);
    if (!parent) throw new Error('上级部门不存在');
  }

  const result = await db.query(
    `INSERT INTO jdywh_departments (name, parent_id, code, leader, sort_order, remark)
     VALUES (?,?,?,?,?,?)`,
    [
      name, parentId,
      String(input.code || '').trim() || null,
      String(input.leader || '').trim() || null,
      Number(input.sortOrder) || 0,
      String(input.remark || '').trim() || null,
    ]
  );
  return getById(result.insertId);
}

async function update(id, input) {
  const dept = await getById(id);
  if (!dept) throw new Error('部门不存在');

  const fields = [];
  const params = [];
  const set = (col, val) => { fields.push(`${col} = ?`); params.push(val); };

  if (input.name !== undefined) {
    const n = String(input.name).trim();
    if (!n) throw new Error('部门名称不能为空');
    set('name', n);
  }
  if (input.parentId !== undefined) {
    const pid = Number(input.parentId) || 0;
    if (pid === Number(id)) throw new Error('上级部门不能是自己');
    if (pid && await wouldCycle(id, pid)) throw new Error('不能把部门移动到自己的下级部门');
    set('parent_id', pid);
  }
  if (input.code !== undefined) set('code', String(input.code || '').trim() || null);
  if (input.leader !== undefined) set('leader', String(input.leader || '').trim() || null);
  if (input.sortOrder !== undefined) set('sort_order', Number(input.sortOrder) || 0);
  if (input.remark !== undefined) set('remark', String(input.remark || '').trim() || null);

  if (!fields.length) return dept;
  params.push(id);
  await db.query(`UPDATE jdywh_departments SET ${fields.join(', ')} WHERE id = ?`, params);
  return getById(id);
}

/** 删除部门（含子部门检查） */
async function remove(id) {
  const dept = await getById(id);
  if (!dept) throw new Error('部门不存在');

  const child = await db.queryOne('SELECT COUNT(*) AS c FROM jdywh_departments WHERE parent_id = ?', [id]);
  if (child && Number(child.c) > 0) throw new Error('该部门下还有子部门，请先删除或移动子部门');

  const users = await db.queryOne('SELECT COUNT(*) AS c FROM jdywh_users WHERE department_id = ?', [id]);
  if (users && Number(users.c) > 0) {
    throw new Error(`该部门下还有 ${users.c} 个用户，请先调整用户所属部门`);
  }

  await db.query('DELETE FROM jdywh_departments WHERE id = ?', [id]);
  return true;
}

/** 部门下的用户 */
async function usersOf(id, includeChildren) {
  let ids = [Number(id)];
  if (includeChildren) {
    const all = await list();
    const collect = (pid) => {
      all.filter((d) => d.parentId === pid).forEach((d) => { ids.push(d.id); collect(d.id); });
    };
    collect(Number(id));
  }
  const placeholders = ids.map(() => '?').join(',');
  return db.query(
    `SELECT id, username, display_name, email, role, status, department_id, position
       FROM jdywh_users WHERE department_id IN (${placeholders}) ORDER BY id ASC`,
    ids
  );
}

/** 统计 */
async function stats() {
  const row = await db.queryOne(
    `SELECT (SELECT COUNT(*) FROM jdywh_departments) AS depts,
            (SELECT COUNT(*) FROM jdywh_users WHERE department_id IS NOT NULL AND department_id > 0) AS assigned,
            (SELECT COUNT(*) FROM jdywh_users) AS total`
  );
  return {
    depts: Number((row && row.depts) || 0),
    assigned: Number((row && row.assigned) || 0),
    total: Number((row && row.total) || 0),
  };
}

/** 初始化默认部门（首次使用） */
async function ensureDefaults() {
  const row = await db.queryOne('SELECT COUNT(*) AS c FROM jdywh_departments');
  if (row && Number(row.c) > 0) return false;

  const root = await create({ name: '总公司', sortOrder: 1 });
  await create({ name: '技术部', parentId: root.id, sortOrder: 1 });
  await create({ name: '数据部', parentId: root.id, sortOrder: 2 });
  await create({ name: '业务部', parentId: root.id, sortOrder: 3 });
  return true;
}

module.exports = {
  list, tree, getById, create, update, remove,
  usersOf, stats, ensureDefaults, publicDept,
};