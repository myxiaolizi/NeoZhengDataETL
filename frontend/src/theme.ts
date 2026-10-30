/**
 * V4.1 设计令牌（Design Tokens）—— 全站唯一配色来源
 *
 * 设计目标（对应用户反馈）：
 *  1. 「白色和灰色显得灰蒙蒙一片」→ 页面底色改为浅蓝灰 #EEF3FB，卡片纯白，
 *     边框改为可见的 #CFDEF0，形成明确的「底 / 卡 / 线」三级分离。
 *  2. 「文字可以适量采用深色字体」→ 主文字 #0B1F3B，层级差值拉到 20% 以上。
 *  3. 「左侧菜单栏采用蓝底白字」→ 侧栏深蓝渐变底 + 白色菜单文字。
 *
 * 约束：
 *  - 本文件只导出常量，禁止引入 React / antd，避免循环依赖。
 *  - 页面组件不要再写死颜色，统一 import { PALETTE, STAT_COLORS, ... } from '@/theme'。
 */

/* ══════════ 品牌色板 ══════════ */
export const PALETTE = {
  /** 主色（按钮、链接、选中态） */
  primary: '#1668E3',
  /** 主色深（hover / 强调文字） */
  primaryDeep: '#0E4AA5',
  /** 主色浅（鼠标悬停、选中背景） */
  primaryLight: '#3B82F6',
  /** 主色超浅（大面积淡底） */
  primarySoft: '#DBEAFE',
  /** 主文字：深墨蓝，保证白底上足够黑 */
  ink: '#0B1F3B',
  /** 语义色 */
  orange: '#EC673C',
  red: '#D92D20',
  yellow: '#E09B00',
  green: '#15A34A',
  cyan: '#0EA5E9',
  violet: '#7C3AED',
  teal: '#0D9488',
  gray: '#94A3B8',
} as const;

/* ══════════ 中性色（底 / 线 / 字） ══════════ */
export const NEUTRAL = {
  /** 页面底色：浅蓝灰，与纯白卡片形成对比 */
  pageBg: '#EEF3FB',
  /** 卡片 / 面板底色 */
  surface: '#FFFFFF',
  /** 次级面板底色（表头、卡片头、筛选区） */
  surfaceAlt: '#F5F8FD',
  /** 三级面板底色（行 hover、代码块） */
  surfaceSunken: '#EAF1FB',
  /** 常规边框：卡片、输入框、表格（必须肉眼可见） */
  border: '#CFDEF0',
  /** 强边框：聚焦、可点击卡片 hover */
  borderStrong: '#9DBBE4',
  /** 弱边框：表格行内分隔、内部分隔线 */
  borderSubtle: '#E1EAF6',
  /** 主文字 */
  text: '#0B1F3B',
  /** 次要文字 */
  textSecondary: '#33507A',
  /** 辅助文字（说明、时间） */
  textTertiary: '#5D789F',
  /** 占位 / 禁用 */
  textQuaternary: '#8FA5C2',
  /** 反白文字（深底上） */
  textInverse: '#FFFFFF',
} as const;

/* ══════════ 侧边栏（蓝底白字） ══════════ */
export const SIDER = {
  /** 侧栏顶部起始色 */
  bgFrom: '#0C3F96',
  /** 侧栏底部结束色 */
  bgTo: '#0A3477',
  /** 兜底纯色（渐变的中间值，用于 antd siderBg） */
  bg: '#0B3A87',
  /** 菜单项文字 */
  itemColor: 'rgba(255,255,255,.90)',
  /** 菜单项 hover 底色 */
  itemHoverBg: 'rgba(255,255,255,.12)',
  /** 菜单项选中底色 */
  itemSelectedBg: '#2E7BF0',
  /** 菜单项选中文字 */
  itemSelectedColor: '#FFFFFF',
  /** 分组标题文字 */
  groupTitleColor: 'rgba(255,255,255,.52)',
  /** 品牌区/底部工具区 分隔线 */
  divider: 'rgba(255,255,255,.16)',
} as const;

/* ══════════ 数据卡片强调色（按顺序循环取用） ══════════ */
export const STAT_COLORS = [
  PALETTE.primary,
  PALETTE.cyan,
  PALETTE.green,
  PALETTE.yellow,
  PALETTE.orange,
  PALETTE.violet,
  PALETTE.red,
  PALETTE.teal,
] as const;

/** 取第 i 个统计卡片的强调色（自动循环） */
export function statColor(index: number): string {
  return STAT_COLORS[index % STAT_COLORS.length];
}

/* ══════════ 通用阴影 ══════════ */
export const SHADOW = {
  card: '0 1px 2px rgba(11,31,59,.05), 0 2px 8px rgba(22,104,227,.07)',
  raised: '0 4px 14px rgba(11,31,59,.10), 0 2px 6px rgba(22,104,227,.10)',
  floating: '0 8px 28px rgba(11,31,59,.16)',
} as const;
