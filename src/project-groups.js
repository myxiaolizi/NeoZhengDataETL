'use strict';

const db = require('./db');

/**
 * 项目分组管理
 *
 * 设计要点
 * --------
 * 1) **多级树形**：通过 parent_id 自引用支持无限层级（与「组织架构」一致的心智模型）。
 * 2) **与既有 category 的关系**：`jdywh_projects.category` 是历史遗留的自由文本分类，
 *    本模块的 group_id 是正式的分组外键。两者并存：
 *      - group_id 用于树形分组管理与筛选（新能力）
 *      - category 保留为自由标签，界面上作为「分类」辅助信息展示
 *    分组删除时不会动 category，避免破坏历史数据。
 * 3) **删除策略**：删除分组时其下项目默认「上移到父分组」（安全），
 *    也可显式指定 `moveTo` 指定目标分组（0 表示移到未分组）。
 *    绝级联删除项目——项目承载数据表与推送令牌，误删不可恢复。
 * 4) **防环**：移动分组时校验目标不能是自身或自身的后代，避免形成环。
 */

const MAX_DEPTH = 5;

/** 行 -> 对外结构 */
function publicGroup(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    name: r.name,
    parentId: Number(r.parent_id || 0),
    code: r.code || '',
    icon: r.icon || '',
    color: r.color || '',
    sortOrder: Number(r.sort_order || 0),
    remark: r.remark || '',
    projectCount: Number(r.project_count || 0),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 分组列表（扁平，含每个分组的直接项目数） */
async function list() {
  const rows = await db.query(
    `SELECT g.*,
            (SELECT COUNT(*) FROM jdywh_projects p WHERE p.group_id = g.id) AS project_count
       FROM jdywh_project_groups g
      ORDER BY g.sort_order ASC, g.id ASC`
  );
  return rows.map(publicGroup);
}

/**
 * 构建分组树，并附带每个节点的「递归项目数」（含子分组）
 * @param {Array} flat 可选，传入已查好的扁平列表避免重复查询
 */
function buildTree(flat) {
  const list_ = flat || [];
  const map = {};
  list_.forEach((g) => { map[g.id] = Object.assign({}, g, { children: [], totalProjectCount: 0 }); });

  const roots = [];
  list_.forEach((g) => {
    const node = map[g.id];
    if (g.parentId && map[g.parentId]) map[g.parentId].children.push(node);
    else roots.push(node);
  });

  // 递归汇总项目数（自身 + 所有后代）
  const sum = (node) => {
    let n = node.projectCount || 0;
    for (const c of node.children) n += sum(c);
    node.totalProjectCount = n;
    return n;
  };
  roots.forEach(sum);
  return roots;
}

async function tree() {
  const flat = await list();
  return buildTree(flat);
}

async function getGroup(id) {
  const row = await db.queryOne(
    `SELECT g.*,
            (SELECT COUNT(*) FROM jdywh_projects p WHERE p.group_id = g.id) AS project_count
       FROM jdywh_project_groups g WHERE g.id = ? LIMIT 1`,
    [id]
  );
  return publicGroup(row);
}

/** 取某分组的所有后代 id（含自身），用于防环与递归统计 */
async function descendantIds(id, flat) {
  const all = flat || await list();
  const childrenOf = {};
  all.forEach((g) => {
    const p = g.parentId || 0;
    if (!childrenOf[p]) childrenOf[p] = [];
    childrenOf[p].push(g.id);
  });
  const out = new Set([Number(id)]);
  const stack = [Number(id)];
  while (stack.length) {
    const cur = stack.pop();
    for (const c of (childrenOf[cur] || [])) {
      if (!out.has(c)) { out.add(c); stack.push(c); }
    }
  }
  return Array.from(out);
}

/**
 * 计算某分组**自身**的层级深度（根分组 = 1，无父传 0 返回 0）
 *
 * 注意语义：本函数返回的是传入节点自身的深度，不是"新子分组的深度"。
 * 因此"给 parentId 新建子分组"时的深度应为 depthOf(parentId) + 1。
 * （历史上这里返回值被误当作新分组深度，调用处又 +1，导致第 5 级被误拒。）
 */
async function depthOf(id, flat) {
  if (!id) return 0;
  const all = flat || await list();
  const byId = {};
  all.forEach((g) => { byId[g.id] = g; });
  let d = 0;
  let cur = Number(id);
  const guard = new Set();
  while (cur && byId[cur] && !guard.has(cur)) {
    guard.add(cur);
    d += 1;
    cur = byId[cur].parentId || 0;
  }
  return d;
}

/**
 * 计算某分组自身的子树高度（叶子 = 1）
 * 用于「移动分组」时判断移动后整棵子树是否会超限。
 */
async function subtreeHeight(id, flat) {
  const all = flat || await list();
  const childrenOf = {};
  all.forEach((g) => {
    const p = g.parentId || 0;
    if (!childrenOf[p]) childrenOf[p] = [];
    childrenOf[p].push(g.id);
  });
  const walk = (nid, guard) => {
    if (guard.has(nid)) return 0;   // 防御环
    guard.add(nid);
    const kids = childrenOf[nid] || [];
    if (!kids.length) return 1;
    let mx = 0;
    for (const c of kids) mx = Math.max(mx, walk(c, guard));
    return mx + 1;
  };
  return walk(Number(id), new Set());
}

/** 名称在同级内唯一校验 */async function nameExists(name, parentId, excludeId) {
  const row = await db.queryOne(
    `SELECT id FROM jdywh_project_groups
      WHERE name = ? AND IFNULL(parent_id,0) = ? ${excludeId ? 'AND id <> ?' : ''} LIMIT 1`,
    excludeId ? [name, parentId || 0, excludeId] : [name, parentId || 0]
  );
  return Boolean(row);
}

async function createGroup(input) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('分组名称不能为空');
  if (name.length > 64) throw new Error('分组名称不能超过 64 个字符');

  const parentId = Number(input.parentId) || 0;
  const flat = await list();

  if (parentId) {
    if (!flat.some((g) => g.id === parentId)) throw new Error('上级分组不存在');
    // depthOf(parentId) = 父分组自身深度；新建子分组的深度 = 父深度 + 1
    const parentDepth = await depthOf(parentId, flat);
    if (parentDepth + 1 > MAX_DEPTH) {
      throw new Error(`分组层级最多 ${MAX_DEPTH} 级（当前上级已在第 ${parentDepth} 级）`);
    }
  }
  if (await nameExists(name, parentId, null)) {
    throw new Error('同一级下已存在同名分组');
  }

  // 排序号：默认排到同级末尾
  let sortOrder = Number(input.sortOrder);
  if (!Number.isFinite(sortOrder)) {
    const max = await db.queryOne(
      'SELECT MAX(sort_order) AS m FROM jdywh_project_groups WHERE IFNULL(parent_id,0) = ?',
      [parentId]
    );
    sortOrder = Number((max && max.m) || 0) + 10;
  }

  const r = await db.query(
    `INSERT INTO jdywh_project_groups (name, parent_id, code, icon, color, sort_order, remark)
     VALUES (?,?,?,?,?,?,?)`,
    [
      name,
      parentId || null,
      String(input.code || '').trim() || null,
      String(input.icon || '').trim() || null,
      String(input.color || '').trim() || null,
      sortOrder,
      String(input.remark || '').trim() || null,
    ]
  );
  return getGroup(r.insertId);
}

async function updateGroup(id, input) {
  const cur = await getGroup(id);
  if (!cur) throw new Error('分组不存在');

  const flat = await list();
  const fields = [];
  const params = [];
  const set = (col, val) => { fields.push(`${col} = ?`); params.push(val); };

  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new Error('分组名称不能为空');
    if (name.length > 64) throw new Error('分组名称不能超过 64 个字符');
    const parentForCheck = input.parentId !== undefined ? (Number(input.parentId) || 0) : cur.parentId;
    if (await nameExists(name, parentForCheck, Number(id))) {
      throw new Error('同一级下已存在同名分组');
    }
    set('name', name);
  }

  // 移动分组：必须防环
  if (input.parentId !== undefined) {
    const newParent = Number(input.parentId) || 0;
    if (newParent === Number(id)) throw new Error('不能把分组移动到自身下面');
    if (newParent) {
      if (!flat.some((g) => g.id === newParent)) throw new Error('目标分组不存在');
      const desc = await descendantIds(id, flat);
      if (desc.includes(newParent)) throw new Error('不能把分组移动到它自己的子分组下面');
      // 移动后：新父深度 + 本节点自身子树高度，都不得超过 MAX_DEPTH
      const parentDepth = await depthOf(newParent, flat);
      const selfHeight = await subtreeHeight(id, flat);
      if (parentDepth + selfHeight > MAX_DEPTH) {
        throw new Error(`移动后层级将超过 ${MAX_DEPTH} 级（该分组自身子树高 ${selfHeight} 级）`);
      }
    }
    set('parent_id', newParent || null);
  }

  if (input.code !== undefined) set('code', String(input.code || '').trim() || null);
  if (input.icon !== undefined) set('icon', String(input.icon || '').trim() || null);
  if (input.color !== undefined) set('color', String(input.color || '').trim() || null);
  if (input.sortOrder !== undefined) {
    const n = Number(input.sortOrder);
    if (Number.isFinite(n)) set('sort_order', n);
  }
  if (input.remark !== undefined) set('remark', String(input.remark || '').trim() || null);

  if (!fields.length) return getGroup(id);
  params.push(id);
  await db.query(`UPDATE jdywh_project_groups SET ${fields.join(', ')} WHERE id = ?`, params);
  return getGroup(id);
}

/**
 * 删除分组
 *
 * @param {number} id 分组 id
 * @param {{moveTo?:number}} options moveTo=目标分组 id（0/空=移到未分组）；
 *        不传时默认「上移到父分组」，父分组不存在则移到未分组。
 * @returns {{deleted:boolean, movedProjects:number, movedTo:number, movedChildren:number}}
 */
async function deleteGroup(id, options) {
  const opts = options || {};
  const cur = await getGroup(id);
  if (!cur) throw new Error('分组不存在');

  const hasChildren = await db.queryOne(
    'SELECT COUNT(*) AS c FROM jdywh_project_groups WHERE parent_id = ?',
    [id]
  );
  if (Number((hasChildren && hasChildren.c) || 0) > 0) {
    throw new Error('该分组下还有子分组，请先删除或移动子分组');
  }

  // 项目去向：显式 moveTo 优先，否则上移到父分组
  const moveTo = opts.moveTo !== undefined ? (Number(opts.moveTo) || 0) : (cur.parentId || 0);
  if (moveTo) {
    const t = await getGroup(moveTo);
    if (!t) throw new Error('项目迁移的目标分组不存在');
    if (moveTo === Number(id)) throw new Error('不能把项目迁移到正在删除的分组');
  }

  const moved = await db.query(
    'UPDATE jdywh_projects SET group_id = ? WHERE group_id = ?',
    [moveTo || null, id]
  );

  await db.query('DELETE FROM jdywh_project_groups WHERE id = ?', [id]);

  return {
    deleted: true,
    movedProjects: Number(moved.affectedRows || 0),
    movedTo: moveTo || 0,
    movedToName: moveTo ? (await getGroup(moveTo) || {}).name || '' : '未分组',
  };
}

/** 批量把项目移动到某分组 */
async function assignProjects(projectIds, groupId) {
  const ids = (Array.isArray(projectIds) ? projectIds : [])
    .map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
  if (!ids.length) throw new Error('请选择要移动的项目');

  const gid = Number(groupId) || 0;
  if (gid) {
    const g = await getGroup(gid);
    if (!g) throw new Error('目标分组不存在');
  }

  const placeholders = ids.map(() => '?').join(',');
  const r = await db.query(
    `UPDATE jdywh_projects SET group_id = ? WHERE id IN (${placeholders})`,
    [gid || null, ...ids]
  );
  return { moved: Number(r.affectedRows || 0), groupId: gid };
}

/** 同级内按给定顺序重排（拖拽排序） */
async function reorder(orderedIds) {
  const ids = (Array.isArray(orderedIds) ? orderedIds : [])
    .map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
  if (!ids.length) throw new Error('排序列表不能为空');

  let i = 0;
  for (const id of ids) {
    i += 1;
    await db.query('UPDATE jdywh_project_groups SET sort_order = ? WHERE id = ?', [i * 10, id]);
  }
  return { updated: ids.length };
}

/** 分组统计：每个分组（含未分组）的项目数与数据量概览 */
async function stats() {
  const rows = await db.query(
    `SELECT IFNULL(p.group_id, 0) AS gid, COUNT(*) AS project_count
       FROM jdywh_projects p GROUP BY IFNULL(p.group_id, 0)`
  );
  const byGroup = {};
  let total = 0;
  let ungrouped = 0;
  for (const r of rows) {
    byGroup[Number(r.gid)] = Number(r.project_count);
    total += Number(r.project_count);
    if (Number(r.gid) === 0) ungrouped = Number(r.project_count);
  }
  const g = await db.queryOne('SELECT COUNT(*) AS c FROM jdywh_project_groups');
  return {
    groups: Number((g && g.c) || 0),
    projects: total,
    ungrouped,
    byGroup,
  };
}

module.exports = {
  MAX_DEPTH,
  list,
  tree,
  buildTree,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  assignProjects,
  reorder,
  descendantIds,
  stats,
};
