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

/**
 * parent_id 归一：库里 **NULL 与 0 混用**（现存 4 个分组里 2 个是 NULL，
 * 见 jdywh_project_groups：12/15 为 NULL，13/14 指向 12）。
 *
 * 对外一律输出 **数字 0**（表示根分组），原因：
 *   - 前端判断写的是 `parentId === 0`（严格相等），若输出 null 会判失败，
 *     子分组就被当成顶层分组渲染，树形层级与「上级分组」下拉全部错乱；
 *   - JSON 里 null / 0 混用没有任何业务价值，只有坑。
 *
 * 注意：**只做输出归一，不改库里的值**（契约 §6.2 第 3/4 条：不做破坏性迁移）。
 * 写入侧仍然把根分组写成 NULL（与既有数据保持一致，且 nameExists/同级排序
 * 都用 IFNULL(parent_id,0) 比较，两种写法等价）。
 *
 * @param {*} v 数据库原始 parent_id（可能是 null / undefined / 0 / '0' / 数字）
 * @returns {number} 0 表示根分组
 */
function normalizeParentId(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 行 -> 对外结构 */
function publicGroup(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    name: r.name,
    // 显式归一：NULL → 0，绝不把 null 漏给前端
    parentId: normalizeParentId(r.parent_id),
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
 *
 * parentId 已由 list()（经 publicGroup）归一成 0/正整数，
 * 这里再做一次防御性 Number()，避免调用方直接传库原始行（parent_id=null）时层级错乱。
 *
 * @param {Array} flat 可选，传入已查好的扁平列表避免重复查询
 */
function buildTree(flat) {
  const list_ = flat || [];
  const map = {};
  list_.forEach((g) => {
    map[g.id] = Object.assign({}, g, {
      parentId: normalizeParentId(g.parentId !== undefined ? g.parentId : g.parent_id),
      children: [],
      totalProjectCount: 0,
    });
  });

  const roots = [];
  list_.forEach((g) => {
    const node = map[g.id];
    const pid = node.parentId;
    if (pid && map[pid]) map[pid].children.push(node);
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
    const p = normalizeParentId(g.parentId);
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
    cur = normalizeParentId(byId[cur].parentId);
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
    const p = normalizeParentId(g.parentId);
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
 * 语义（契约 §6.2，V6.1 要求 3 的后端加固；前端入口问题由 projects-detail 负责）
 * ---------------------------------------------------------------------------
 * 1) **有子分组时一律拒绝**（400 + 中文原因「该分组下还有子分组，请先删除或移动子分组」）。
 *    没有 force 级联：子分组一并删除会让用户在一次点击里丢掉整棵子树，
 *    且 `jdywh_projects.group_id` 会被 IFNULL 逻辑绕到未分组，不可恢复。
 *    想删父分组 → 先把子分组移走或删掉（updateGroup/deleteGroup 都支持）。
 *
 * 2) **分组下的项目绝不删除**，只改归属：
 *    - 不传 `moveTo`      → 项目「上移」到父分组（`cur.parentId`）；
 *      父分组不存在（根分组）→ 变为未分组（group_id = NULL）；
 *    - 传 `moveTo = N`    → 项目迁到分组 N（N 必须存在，否则报错）；
 *    - 传 `moveTo = 0`    → 项目迁到未分组（显式表达「不要上移」）。
 *    项目承载数据表与推送令牌，误删不可恢复，因此这里只迁不删。
 *
 * 3) `force` 参数：**当前实现刻意不支持**。保留此说明是为了让调用方知道
 *    「传 force 不会生效」，而不是以为可以强删。批量改归属请用 assignProjects。
 *
 * 4) 返回值（前端 GroupManageModal 已按此渲染提示）：
 *    - `deleted: true`
 *    - `movedProjects` 本次迁走的项目数（0 表示该分组下没有项目）
 *    - `movedTo`       项目实际迁往的分组 id（0 = 未分组）
 *    - `movedToName`   项目实际迁往的分组名（0 时为「未分组」，用于 toast 文案）
 *    - `movedChildren: 0`（恒为 0：有子分组时上面已拒绝，字段保留以兼容旧前端）
 *
 * @param {number} id 分组 id
 * @param {{moveTo?:number, force?:boolean}} [options]
 *        moveTo = 目标分组 id（0/空 = 未分组）；不传时默认「上移到父分组」。
 *        force  = 未实现，传了也不级联（见上）。
 * @returns {{deleted:boolean, movedProjects:number, movedTo:number, movedToName:string, movedChildren:number}}
 */
async function deleteGroup(id, options) {
  const opts = options || {};
  const cur = await getGroup(id);
  if (!cur) throw new Error('分组不存在');

  // 1) 子分组：拒绝（不级联，见函数注释第 1 条）
  //    用 IFNULL 兜住 parent_id 为 NULL 的历史数据（NULL 不等于任何值）
  const hasChildren = await db.queryOne(
    'SELECT COUNT(*) AS c FROM jdywh_project_groups WHERE IFNULL(parent_id,0) = ?',
    [id]
  );
  if (Number((hasChildren && hasChildren.c) || 0) > 0) {
    throw new Error('该分组下还有子分组，请先删除或移动子分组');
  }

  // 2) 项目去向：显式 moveTo 优先，否则上移到父分组（父分组可能为 0=根）
  const moveTo = opts.moveTo !== undefined
    ? (Number(opts.moveTo) || 0)
    : normalizeParentId(cur.parentId);
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
    movedChildren: 0,
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
  normalizeParentId,
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
