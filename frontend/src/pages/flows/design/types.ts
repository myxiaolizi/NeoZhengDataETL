/** 流程设计器：共享类型 */
import type { FlowNode } from '@/api/flows';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 单节点最近一次运行 / 试运行的统计（仅前端会话内保存） */
export interface NodeRunStat {
  inputRows?: number;
  outputRows?: number;
  ms?: number;
  ok?: boolean;
  skipped?: boolean;
  error?: string;
}

/** 画布命令式能力 */
export interface CanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  fitToView: () => void;
  /** 视口中心位置（自动避开已有节点），用于新增节点落点 */
  getInsertPosition: () => Point;
  /** 滚动到指定节点 */
  centerOnNode: (nodeId: string) => void;
  /** 保持缩放，把全部节点滚动到视口中心 */
  centerContent: () => void;
}

/** 下拉选项包 */
export interface OptionBundle {
  project: { label: string; value: number | string }[];
  datasource: { label: string; value: number | string }[];
  form: { label: string; value: number | string }[];
}

/** 上下文菜单/内联结构 */
export interface EdgeRef {
  from: string;
  to: string;
}

export type NodePositions = { id: string; x: number; y: number }[];

export type NodeMap = Record<string, FlowNode>;
