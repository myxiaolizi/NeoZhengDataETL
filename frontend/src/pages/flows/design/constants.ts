/** 流程设计器：视觉常量、画布尺寸与通用工具 */

import { NEUTRAL, PALETTE } from '@/theme';

/**
 * 设计器调色板（V6.1：直接派生自 @/theme 令牌）
 *
 * 全部指向设计令牌，改 @/theme 即同步生效。
 */
export const C = {
  primary: PALETTE.primary,
  blue: PALETTE.primaryDeep,
  deep: PALETTE.ink,
  cyan: PALETTE.cyan,
  light: PALETTE.primaryLight,
  green: PALETTE.green,
  orange: PALETTE.orange,
  red: PALETTE.red,
  yellow: PALETTE.yellow,
  gray: PALETTE.gray,
  violet: PALETTE.violet,
  line: NEUTRAL.border,
  text: NEUTRAL.text,
  bg: NEUTRAL.surface,
};

/** 节点分类配色（数据源 / 清洗 / 输出） */
export const CATEGORY_COLOR: Record<string, string> = {
  source: C.primary,
  clean: C.green,
  sink: C.orange,
};

/** 分类兜底色 */
export const CATEGORY_FALLBACK = PALETTE.gray;

/**
 * 画布固定尺寸：**常量，绝不随节点数量或位置变化**。
 * 节点拖动只改变节点坐标，不改变画布 viewBox / SVG 宽高。
 */
export const CANVAS_W = 2000;
export const CANVAS_H = 1200;

/** 画布在滚动容器中的留白（px） */
export const CANVAS_PAD = 28;

/** 节点卡片尺寸 */
export const NODE_W = 220;
export const NODE_H = 92;

/** 端口半径 */
export const PORT_R = 7;

/** 缩放区间与步长 */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 1.5;
export const ZOOM_STEP = 0.1;

/** 网格点间距 */
export const GRID_SIZE = 20;

/** 节点最小坐标（必须 > 0：后端会把 x=0 归一到 40，避免保存后位移） */
export const NODE_MIN = 4;

export function categoryColor(category?: string): string {
  return (category && CATEGORY_COLOR[category]) || CATEGORY_FALLBACK;
}

/** 十六进制颜色 → rgba */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return hex;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 判断字符是否宽字符（中文/日文/韩文/全角符号） */
function isWide(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60)
  );
}

/** 按可用宽度截断文本（用于 SVG 内单行文本） */
export function ellipsize(text: string, maxWidth: number, fontSize: number): string {
  const src = String(text ?? '');
  if (!src) return '';
  let width = 0;
  let out = '';
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const w = isWide(ch) ? fontSize * 1.02 : fontSize * 0.58;
    if (width + w > maxWidth) {
      return `${out.slice(0, Math.max(1, out.length - 1))}…`;
    }
    width += w;
    out += ch;
  }
  return out;
}

/** 数字千分位 */
export function fmtNum(v: number | undefined | null): string {
  if (v === undefined || v === null || Number.isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('en-US');
}
