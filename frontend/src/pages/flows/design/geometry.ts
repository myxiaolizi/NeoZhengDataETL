/** 流程设计器：几何计算（端口、贝塞尔连线、命中判断） */
import type { FlowNode } from '@/api/flows';
import { CANVAS_H, CANVAS_W, NODE_H, NODE_MIN, NODE_W, clamp } from './constants';
import type { Point, Rect } from './types';

/** 输出端口（右侧圆点） */
export function outPort(node: FlowNode): Point {
  return { x: node.x + NODE_W, y: node.y + NODE_H / 2 };
}

/** 输入端口（左侧圆点） */
export function inPort(node: FlowNode): Point {
  return { x: node.x, y: node.y + NODE_H / 2 };
}

/** 三次贝塞尔控制点：横向进出，保证平滑 */
export function edgeCurve(a: Point, b: Point): { c1: Point; c2: Point } {
  const dist = Math.abs(b.x - a.x);
  const base = Math.max(56, Math.min(190, dist * 0.55));
  return {
    c1: { x: a.x + base, y: a.y },
    c2: { x: b.x - base, y: b.y },
  };
}

/** 贝塞尔路径字符串 */
export function edgePath(a: Point, b: Point): string {
  const { c1, c2 } = edgeCurve(a, b);
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
}

/** 三次贝塞尔求点 */
export function bezierPoint(a: Point, b: Point, t: number): Point {
  const { c1, c2 } = edgeCurve(a, b);
  const mt = 1 - t;
  const w0 = mt * mt * mt;
  const w1 = 3 * mt * mt * t;
  const w2 = 3 * mt * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * a.x + w1 * c1.x + w2 * c2.x + w3 * b.x,
    y: w0 * a.y + w1 * c1.y + w2 * c2.y + w3 * b.y,
  };
}

/** 连线中点（用于删除按钮定位） */
export function edgeMid(a: Point, b: Point): Point {
  return bezierPoint(a, b, 0.5);
}

/** 把节点坐标限制在固定画布内，且保证 > 0（后端会把 0 归一到 40） */
export function clampNodePos(x: number, y: number): Point {
  return {
    x: clamp(Math.round(x), NODE_MIN, CANVAS_W - NODE_W - NODE_MIN),
    y: clamp(Math.round(y), NODE_MIN, CANVAS_H - NODE_H - NODE_MIN),
  };
}

/** 两个矩形是否相交（节点矩形 vs 框选矩形） */
export function nodeInRect(node: FlowNode, rect: Rect): boolean {
  const rx1 = Math.min(rect.x1, rect.x2);
  const rx2 = Math.max(rect.x1, rect.x2);
  const ry1 = Math.min(rect.y1, rect.y2);
  const ry2 = Math.max(rect.y1, rect.y2);
  return !(
    node.x + NODE_W < rx1 ||
    node.x > rx2 ||
    node.y + NODE_H < ry1 ||
    node.y > ry2
  );
}

/** 框选矩形 → 规范化的 x/y/width/height（用于 SVG rect） */
export function normalizeRect(rect: Rect) {
  const x = Math.min(rect.x1, rect.x2);
  const y = Math.min(rect.y1, rect.y2);
  return { x, y, width: Math.abs(rect.x2 - rect.x1), height: Math.abs(rect.y2 - rect.y1) };
}

/** 判断 adding from → to 是否会造成环（DFS 查找 to 是否能到达 from） */
export function wouldCreateCycle(
  edges: { from: string; to: string }[],
  from: string,
  to: string
): boolean {
  if (from === to) return true;
  const adj: Record<string, string[]> = {};
  edges.forEach((e) => {
    (adj[e.from] = adj[e.from] || []).push(e.to);
  });
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === from) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    (adj[cur] || []).forEach((n) => stack.push(n));
  }
  return false;
}
