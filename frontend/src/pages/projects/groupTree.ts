/**
 * 分组树的纯计算工具（V6.1 · 要求 3）
 *
 * 后端 `GET /api/project-groups` 返回的 `list` 是**扁平**数组（按 sort_order, id 排序），
 * 前端有两处需要「层级感」：
 *   1. 列表页的分组快筛条 —— 子分组名前加浅色父分组名 / 缩进（GroupManageModal 之外的入口）
 *   2. 分组管理弹窗 —— 树形缩进 + 每组的直接项目数 / 子分组数
 * 两处共用这里的计算，避免各写一套导致层级判断不一致。
 *
 * ⚠️ 后端 `parent_id` 存在 NULL / 0 混用（契约 §6.2），所有比较一律
 *    `Number(x || 0)` 归一，否则 `parentId === 0` 判断会失效。
 */
import type { ProjectGroupNode } from '@/api/projects';

/** 树的一行（已按 parentId 展平，带层级信息） */
export interface GroupTreeRow {
  node: ProjectGroupNode;
  /** 0 = 顶层 */
  depth: number;
  /** 直接子分组数 */
  childCount: number;
  /** 父分组名（顶层为 null），用于删除确认文案「项目会移到哪」 */
  parentName: string | null;
  /** 祖先名路径（不含自身），用于 Tooltip 展示完整层级 */
  path: string[];
}

/**
 * 把扁平分组列表按 parentId 展平成「带缩进的行」，顺序为深度优先
 * （父分组紧跟其所有后代），这样缩进在视觉上才连续。
 */
export function flattenGroupTree(flat: ProjectGroupNode[]): GroupTreeRow[] {
  const list = flat || [];
  const byParent = new Map<number, ProjectGroupNode[]>();
  list.forEach((g) => {
    const pid = Number(g.parentId || 0);
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(g);
  });
  // 同级内按 sortOrder 再按 id 升序，与后端 list() 的排序保持一致
  byParent.forEach((arr) => arr.sort((a, b) => (Number(a.sortOrder) - Number(b.sortOrder)) || (Number(a.id) - Number(b.id))));

  const byId = new Map<number, ProjectGroupNode>(list.map((g) => [Number(g.id), g]));
  const childCountOf = (id: number) => (byParent.get(Number(id)) || []).length;

  const out: GroupTreeRow[] = [];
  const walk = (pid: number, depth: number, path: string[], guard: Set<number>) => {
    (byParent.get(pid) || []).forEach((g) => {
      const gid = Number(g.id);
      if (guard.has(gid)) return; // 防御脏数据成环
      out.push({
        node: g,
        depth,
        childCount: childCountOf(gid),
        parentName: pid ? (byId.get(pid)?.name || null) : null,
        path,
      });
      walk(gid, depth + 1, [...path, g.name], new Set(guard).add(gid));
    });
  };
  walk(0, 0, [], new Set<number>());

  // 兜底：parentId 指向已不存在的分组（孤儿）时也要能被看到，否则用户永远删不掉它
  list.forEach((g) => {
    if (!out.some((r) => Number(r.node.id) === Number(g.id))) {
      out.push({ node: g, depth: 0, childCount: childCountOf(Number(g.id)), parentName: null, path: [] });
    }
  });
  return out;
}

/** id → 层级信息，供快筛条 O(1) 取用 */
export function groupTreeIndex(flat: ProjectGroupNode[]): Map<number, GroupTreeRow> {
  const m = new Map<number, GroupTreeRow>();
  flattenGroupTree(flat).forEach((r) => m.set(Number(r.node.id), r));
  return m;
}
