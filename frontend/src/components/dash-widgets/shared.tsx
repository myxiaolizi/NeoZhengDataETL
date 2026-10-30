/**
 * 看板小组件共用底座（V6.0）
 *
 * 提供：
 *  1. 契约 §2.1 设计令牌（浅/深两套，注入到看板容器，色值硬编码仅供 echarts 字面量使用）
 *  2. 数值 / 字段解析 / 聚合工具（widget 找不到指定列时自动回退到数据集真实列）
 *  3. 卡片外壳 CardShell —— 严格按契约 §2.2 的 .card / .card-h / .card-b 样式
 *  4. echarts 通用轴样式与空态组件
 *
 * 纪律：本目录组件不发请求，数据全部 props 下发；缺字段/空数据不崩。
 */
import React from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { EChartsOption } from 'echarts';
import type { DashboardWidget, DatasetColumn, RowData, WidgetAgg } from '@/api/reports';

/** 所有看板小组件的统一 props（只吃 props，不发请求） */
export interface WidgetProps {
  widget: DashboardWidget;
  rows: RowData[];
  columns?: DatasetColumn[];
  isMobile?: boolean;
  dark?: boolean;
}

/* ══════════════ 契约 §2.1 令牌（字面色值，echarts 内使用） ══════════════ */

export const C = {
  brand: '#2563eb',
  brand2: '#3b82f6',
  brand3: '#60a5fa',
  brandSoft: '#e9f2ff',
  green: '#10b981',
  green2: '#34d399',
  greenSoft: '#e6f8f1',
  warn: '#f59e0b',
  danger: '#ef4444',
  purple: '#8b5cf6',
  cyan: '#06b6d4',
  pink: '#ec4899',
  yellow: '#eab308',
  slate: '#94a3b8',
  text: '#16253d',
  text2: '#5a7191',
  text3: '#93a7c2',
  line: '#dde8f6',
  line2: '#eaf2fb',
  panel: '#ffffff',
  panel2: '#f7faff',
} as const;

/** 图表系列色（契约 §2.1 品牌色 + 语义色，不少于 8 色） */
export const SERIES_COLORS: string[] = [
  C.brand,
  C.green,
  C.warn,
  C.purple,
  C.cyan,
  C.pink,
  C.brand3,
  C.danger,
];

/** 服务端字面色值（契约 §2.2 排行榜奖牌色） */
export const MEDAL_COLORS = [C.danger, C.warn, C.yellow];

/** 卡片标题前圆点的可选颜色（chart.dot 用关键字指定） */
export const DOT_COLORS: Record<string, string> = {
  brand: C.brand,
  brand2: C.brand2,
  brand3: C.brand3,
  green: C.green,
  cyan: C.cyan,
  purple: C.purple,
  warn: C.warn,
  danger: C.danger,
  pink: C.pink,
};

/** 各卡片类型的默认圆点色 */
export const DEFAULT_DOT: Record<string, string> = {
  kpi: 'brand',
  donut: 'green',
  semiGauge: 'purple',
  progress: 'purple',
  flowMap: 'purple',
  rank: 'warn',
  bar: 'brand',
  stackBar: 'brand',
  line: 'brand',
  combo: 'cyan',
  pie: 'cyan',
  heatmap: 'warn',
  table: 'brand',
  text: 'brand',
};

/* ══════════════ 浅色 / 深色令牌注入 ══════════════ */

/** 浅色令牌（= 契约 §2.1 :root） */
const LIGHT_VARS: CSSProperties = {
  '--bg': '#f2f6fc',
  '--bg2': '#e8f0fb',
  '--panel': '#ffffff',
  '--panel2': '#f7faff',
  '--line': '#dde8f6',
  '--line2': '#eaf2fb',
  '--text': '#16253d',
  '--text2': '#5a7191',
  '--text3': '#93a7c2',
  '--brand': '#2563eb',
  '--brand2': '#3b82f6',
  '--brand3': '#60a5fa',
  '--brandSoft': '#e9f2ff',
  '--green': '#10b981',
  '--green2': '#34d399',
  '--greenSoft': '#e6f8f1',
  '--warn': '#f59e0b',
  '--danger': '#ef4444',
  '--purple': '#8b5cf6',
  '--cyan': '#06b6d4',
  '--pink': '#ec4899',
  '--shadow': '0 1px 2px rgba(20,52,102,.04),0 4px 14px rgba(20,52,102,.055)',
  '--shadow2': '0 2px 8px rgba(20,52,102,.07),0 18px 44px rgba(20,52,102,.11)',
  '--radius': '16px',
  '--radius-sm': '11px',
  '--font':
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
} as CSSProperties;

/** 深色令牌（= 契约 §2.3） */
const DARK_VARS: CSSProperties = {
  '--bg': '#0a1220',
  '--bg2': '#0e1a2e',
  '--panel': '#101d33',
  '--panel2': '#14233c',
  '--line': '#1e3252',
  '--line2': '#182a45',
  '--text': '#e2e8f0',
  '--text2': '#94a8c4',
  '--text3': '#6b82a3',
  '--brand': '#3b82f6',
  '--brand2': '#60a5fa',
  '--brand3': '#93c5fd',
  '--brandSoft': '#16294a',
  '--green': '#34d399',
  '--greenSoft': '#0f2e26',
  '--warn': '#f59e0b',
  '--danger': '#ef4444',
  '--purple': '#8b5cf6',
  '--cyan': '#06b6d4',
  '--pink': '#ec4899',
  '--shadow': '0 1px 2px rgba(0,0,0,.35),0 4px 14px rgba(0,0,0,.30)',
  '--shadow2': '0 2px 8px rgba(0,0,0,.40),0 18px 44px rgba(0,0,0,.45)',
  '--radius': '16px',
  '--radius-sm': '11px',
  '--font':
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
} as CSSProperties;

/** 看板容器样式：注入令牌 + 字体栈，所有 var(--x) 在这里得到值 */
export function dashThemeStyle(dark?: boolean): CSSProperties {
  return { ...(dark ? DARK_VARS : LIGHT_VARS), fontFamily: 'var(--font)', minWidth: 0 };
}

/* ══════════════ 数值与文本工具 ══════════════ */

export function toNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const t = v.replace(/,/g, '').trim();
    if (!t) return 0;
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function toStr(v: unknown): string {
  if (v === null || v === undefined || v === '') return '（空）';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v).slice(0, 60);
    } catch {
      return '';
    }
  }
  return String(v);
}

/** 千分位数字（保留 0~2 位小数） */
export function nf(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return '0';
  const fixed = digits > 0 ? Number(v.toFixed(digits)) : Math.round(v);
  return fixed.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

/** 大数字紧凑显示：>=1e8 亿 / >=1e4 万 */
export function compactNum(v: number): string {
  const n = Number.isFinite(v) ? v : 0;
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${(n / 1e8).toFixed(abs >= 1e9 ? 0 : 2)}亿`;
  if (abs >= 1e4) return `${(n / 1e4).toFixed(abs >= 1e5 ? 1 : 2)}万`;
  return nf(n, Number.isInteger(n) ? 0 : 1);
}

/** 百分比（0~100 的数值） */
export function pctOf(part: number, total: number, digits = 1): string {
  if (!Number.isFinite(total) || total <= 0) return '0%';
  return `${((part / total) * 100).toFixed(digits)}%`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/* ══════════════ 字段解析（找不到配置列时自动回退） ══════════════ */

function isNumericValue(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string' && v.trim() !== '') return Number.isFinite(Number(v.replace(/,/g, '')));
  return false;
}

/** 列名集合：优先 columns，其次首行 key */
export function colNamesOf(rows: RowData[], columns?: DatasetColumn[]): string[] {
  if (columns && columns.length) return columns.map((c) => c.name);
  return Object.keys(rows[0] || {});
}

/** 数值列（抽样前 20 行判定） */
export function numericColsOf(rows: RowData[], names: string[]): string[] {
  return names.filter((n) => {
    let hit = 0;
    for (const r of rows.slice(0, 20)) {
      const v = r[n];
      if (v === null || v === undefined || v === '') continue;
      if (!isNumericValue(v)) return false;
      hit += 1;
    }
    return hit > 0;
  });
}

/** 在一组候选列名里挑一个真实存在的数值列（支持「客户数」→「签约客户数」这类模糊命中） */
function pickMetric(cands: string[], nums: string[]): string {
  for (const c of cands) if (c && nums.includes(c)) return c;
  for (const c of cands) {
    if (!c) continue;
    const key = c.replace(/(数量|数|量|金额|额|值)$/u, '');
    if (!key) continue;
    const hit = nums.find((n) => n.includes(key));
    if (hit) return hit;
  }
  return nums[0] || '';
}

/** 挑一个真实存在的分类列 */
function pickDim(cands: string[], names: string[], nums: string[]): string {
  const nonNum = names.filter((n) => !nums.includes(n));
  for (const c of cands) if (c && nonNum.includes(c)) return c;
  for (const c of cands) if (c && names.includes(c)) return c;
  for (const c of cands) {
    if (!c) continue;
    const key = c.replace(/(类型|状态|区域|日期|名称|销售)$/u, '');
    if (!key) continue;
    const hit = nonNum.find((n) => n.includes(key));
    if (hit) return hit;
  }
  return nonNum[0] || names[0] || '';
}

export interface ResolvedFields {
  /** 数据集全部列名 */
  names: string[];
  /** 数值列名 */
  numerics: string[];
  /** 主指标列（一定是数值列，若无数值列则为空串） */
  metric: string;
  /** 多指标列（都是数值列） */
  metrics: string[];
  /** 主维度列（分类列） */
  dimension: string;
  /** 多维度列 */
  dimensions: string[];
}

/**
 * 解析 widget 的指标/维度列
 * - widget 里写的列名在数据集中不存在时自动回退（模板换数据集也能出图）
 * - 没有数值列时 metric 为空串，组件据此显示空态
 */
export function resolveFields(widget: DashboardWidget, rows: RowData[], columns?: DatasetColumn[]): ResolvedFields {
  const names = colNamesOf(rows, columns);
  const numerics = numericColsOf(rows, names);
  const metricCands = [widget.metric, ...(widget.metrics || [])].filter(Boolean) as string[];
  const metric = pickMetric(metricCands, numerics);
  const metrics: string[] = [];
  (widget.metrics || []).forEach((m) => {
    const hit = metricCands.includes(m) ? pickMetric([m], numerics) : '';
    if (hit && !metrics.includes(hit)) metrics.push(hit);
  });
  if (metric && !metrics.length) metrics.push(metric);
  if (!metrics.length && metric) metrics.push(metric);
  const dimension = pickDim([widget.dimension, ...(widget.dimensions || [])].filter(Boolean) as string[], names, numerics);
  const dimensions = [dimension, ...(widget.dimensions || [])]
    .filter(Boolean)
    .filter((d, i, arr) => arr.indexOf(d) === i && names.includes(d) && !numerics.includes(d)) as string[];
  return { names, numerics, metric, metrics, dimension, dimensions };
}

/* ══════════════ 聚合 ══════════════ */

export function aggValue(values: number[], agg?: WidgetAgg): number {
  if (!values.length) return 0;
  switch (agg) {
    case 'count':
      return values.length;
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'max':
      return Math.max(...values);
    case 'min':
      return Math.min(...values);
    default:
      return values.reduce((a, b) => a + b, 0);
  }
}

/** 单列整体聚合（KPI / gauge 用） */
export function totalOf(rows: RowData[], field: string, agg?: WidgetAgg): number {
  if (!field) return 0;
  const vals = rows.map((r) => toNum(r[field]));
  return aggValue(vals, agg);
}

export interface Grouped {
  /** 分类名（按顺序） */
  cats: string[];
  /** series[metricIndex][catIndex] */
  series: number[][];
  /** 每个分类的单行条数（count 聚合时用它显示记录数） */
  counts: number[];
}

/**
 * 按维度分组聚合
 * @param order asc/desc/none 按第一指标排序
 */
export function groupByDim(
  rows: RowData[],
  dim: string,
  metrics: string[],
  agg?: WidgetAgg,
  opts: { limit?: number; order?: 'asc' | 'desc' | 'none' } = {}
): Grouped {
  const { limit = 50, order = 'desc' } = opts;
  const map = new Map<string, number[][]>();
  const counts = new Map<string, number>();
  const seen: string[] = [];
  rows.forEach((r) => {
    const key = toStr(dim ? r[dim] : '合计');
    if (!map.has(key)) {
      map.set(key, metrics.map(() => []));
      counts.set(key, 0);
      seen.push(key);
    }
    const bucket = map.get(key)!;
    metrics.forEach((m, i) => bucket[i].push(toNum(r[m])));
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  let keys = seen;
  if (order !== 'none') {
    const sum = (k: string) => (map.get(k)![0] || []).reduce((a, b) => a + b, 0);
    keys = seen.slice().sort((a, b) => (order === 'desc' ? sum(b) - sum(a) : sum(a) - sum(b)));
  }
  const picked = keys.slice(0, Math.max(1, limit));
  return {
    cats: picked,
    series: metrics.map((_, mi) => picked.map((k) => Number(aggValue(map.get(k)![mi] || [], agg).toFixed(4)))),
    counts: picked.map((k) => counts.get(k) || 0),
  };
}

/** 排行榜条目 */
export interface RankEntry {
  name: string;
  value: number;
  /** 名称下方标签（类型 + 数量） */
  tags: { name: string; count: number }[];
}

/**
 * 排行榜数据：按 dim 分组求 metric 聚合值，降序取前 N
 * @param tagField 可选标签列（如「连锁类型」），统计每个名称下各标签的记录数
 */
export function rankEntries(
  rows: RowData[],
  dim: string,
  metric: string,
  agg: WidgetAgg | undefined,
  topN: number,
  tagField?: string
): RankEntry[] {
  const buckets = new Map<string, number[]>();
  const tags = new Map<string, Map<string, number>>();
  rows.forEach((r) => {
    const key = toStr(dim ? r[dim] : '合计');
    if (!buckets.has(key)) {
      buckets.set(key, []);
      tags.set(key, new Map());
    }
    if (metric) buckets.get(key)!.push(toNum(r[metric]));
    if (tagField) {
      const t = toStr(r[tagField]);
      if (t && t !== '（空）') {
        const tm = tags.get(key)!;
        tm.set(t, (tm.get(t) || 0) + 1);
      }
    }
  });
  return Array.from(buckets.entries())
    .map(([name, vals]) => ({
      name,
      value: metric ? aggValue(vals, agg) : vals.length,
      tags: Array.from((tags.get(name) || new Map<string, number>()).entries())
        .map(([n, count]) => ({ name: n, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, Math.max(1, topN));
}

/** 二维矩阵（热力图用）：行=dim1，列=dim2（缺省用 metrics） */
export function matrixOf(
  rows: RowData[],
  dim1: string,
  dim2: string | undefined,
  metrics: string[],
  agg?: WidgetAgg,
  limit = 8
): { rows: string[]; cols: string[]; values: number[][] } {
  const useMetrics = !dim2;
  const colKeys = useMetrics ? metrics : [];
  const rowMap = new Map<string, Map<string, number[]>>();
  const colSeen: string[] = [];
  rows.forEach((r) => {
    const rk = toStr(dim1 ? r[dim1] : '合计');
    if (!rowMap.has(rk)) rowMap.set(rk, new Map());
    const rowBuckets = rowMap.get(rk)!;
    const targets = useMetrics ? metrics : [dim2 as string];
    targets.forEach((t, ti) => {
      const ck = useMetrics ? t : toStr(r[t]);
      if (!rowBuckets.has(ck)) {
        rowBuckets.set(ck, []);
        if (!colSeen.includes(ck)) colSeen.push(ck);
      }
      const metric = useMetrics ? metrics[ti] : metrics[0];
      rowBuckets.get(ck)!.push(metric ? toNum(r[metric]) : 1);
    });
  });
  const rowKeys = Array.from(rowMap.keys()).slice(0, limit);
  const cols = (useMetrics ? colKeys : colSeen.slice(0, limit)).filter(Boolean);
  const values = rowKeys.map((rk) =>
    cols.map((ck) => {
      const bucket = rowMap.get(rk)?.get(ck);
      return bucket && bucket.length ? Number(aggValue(bucket, agg).toFixed(4)) : 0;
    })
  );
  return { rows: rowKeys, cols, values };
}

/* ══════════════ 卡片外壳（契约 §2.2） ══════════════ */

export interface CardShellProps {
  title: ReactNode;
  /** 标题前圆点色（关键字或色值） */
  dot?: string;
  /** 右上角小字提示 */
  hint?: ReactNode;
  /** 右上角操作区（设计器用：调序/删除） */
  actions?: ReactNode;
  /** 点击卡片（设计器选中） */
  onClick?: () => void;
  /** 是否为当前选中卡片 */
  active?: boolean;
  bodyStyle?: CSSProperties;
  children?: ReactNode;
}

/** 看板卡片：16px 圆角 + var(--shadow) + 标题前 6px 方点 + hover 上浮 1px */
export function CardShell({ title, dot, hint, actions, onClick, active, bodyStyle, children }: CardShellProps) {
  const dotColor = (dot && (DOT_COLORS[dot] || dot)) || 'var(--brand)';
  return (
    <div
      onClick={onClick}
      className={onClick ? 'dash-card dash-card-clickable' : 'dash-card'}
      style={{
        background: 'var(--panel, #fff)',
        border: `1px solid ${active ? 'var(--brand)' : 'var(--line, #dde8f6)'}`,
        borderRadius: 16,
        boxShadow: active
          ? '0 0 0 3px color-mix(in srgb, var(--brand) 22%, transparent), var(--shadow2)'
          : 'var(--shadow)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minWidth: 0,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color .2s, box-shadow .2s, transform .2s',
        position: 'relative',
      }}
    >
      <div
        style={{
          padding: '13px 16px',
          borderBottom: '1px solid var(--line2, #eaf2fb)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexShrink: 0,
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--panel2, #f7faff) 60%, transparent), transparent)',
        }}
      >
        <h3
          style={{
            fontSize: 13,
            fontWeight: 680,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            letterSpacing: '.2px',
            color: 'var(--text, #16253d)',
            margin: 0,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 2,
              background: dotColor,
              flexShrink: 0,
              boxShadow: `0 0 0 3px color-mix(in srgb, ${dotColor} 16%, transparent)`,
            }}
          />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {hint ? (
            <span style={{ fontSize: 11, color: 'var(--text3, #93a7c2)', fontWeight: 550, letterSpacing: '.2px' }}>
              {hint}
            </span>
          ) : null}
          {actions}
        </div>
      </div>
      <div
        style={{
          padding: '15px 16px',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          minWidth: 0,
          ...bodyStyle,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ══════════════ 空态 ══════════════ */

export function EmptyBox({ text = '暂无数据', height = 120 }: { text?: string; height?: number }) {
  return (
    <div
      style={{
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        color: 'var(--text3, #93a7c2)',
        border: '1px dashed var(--line, #dde8f6)',
        borderRadius: 11,
        background: 'var(--panel2, #f7faff)',
      }}
    >
      {text}
    </div>
  );
}

/* ══════════════ echarts 通用样式 ══════════════ */

export function chartPalette(dark?: boolean): string[] {
  return SERIES_COLORS.slice();
}

export interface AxisStyle {
  axisLine: { lineStyle: { color: string } };
  axisTick: { show: boolean };
  axisLabel: { color: string; fontSize: number };
  splitLine: { lineStyle: { color: string; type: 'dashed' | 'solid' } };
}

/** 统一的坐标轴样式（浅/深自适应） */
export function axisStyle(dark?: boolean): AxisStyle {
  const line = dark ? 'rgba(255,255,255,.14)' : C.line;
  const label = dark ? '#94a8c4' : C.text2;
  return {
    axisLine: { lineStyle: { color: line } },
    axisTick: { show: false },
    axisLabel: { color: label, fontSize: 11 },
    splitLine: { lineStyle: { color: line, type: 'dashed' } },
  };
}

export function textColor(dark?: boolean): string {
  return dark ? '#e2e8f0' : C.text;
}

export function subTextColor(dark?: boolean): string {
  return dark ? '#94a8c4' : C.text3;
}

export function splitLineColor(dark?: boolean): string {
  return dark ? 'rgba(255,255,255,.10)' : C.line2;
}

/** 卡片圆点色：widget.chart.dot 优先，否则按类型默认 */
export function dotOf(widget: DashboardWidget): string {
  const raw = widget.chart && typeof widget.chart.dot === 'string' ? widget.chart.dot : '';
  return raw || DEFAULT_DOT[widget.type] || 'brand';
}

/** widget.chart 里的数字配置读取（缺省/非法时用 fallback） */
export function chartNum(widget: DashboardWidget, key: string, fallback: number): number {
  const v = widget.chart ? Number(widget.chart[key]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** widget.chart 里的布尔配置读取 */
export function chartBool(widget: DashboardWidget, key: string, fallback = false): boolean {
  const v = widget.chart ? widget.chart[key] : undefined;
  return typeof v === 'boolean' ? v : fallback;
}

/** widget.chart 里的文本配置读取 */
export function chartStr(widget: DashboardWidget, key: string, fallback = ''): string {
  const v = widget.chart ? widget.chart[key] : undefined;
  return typeof v === 'string' && v ? v : fallback;
}

/** 看板卡片 hover 效果（内联无法表达 :hover，用 style 标签一次性注入） */
export const DASH_HOVER_CSS = `
.dash-card-clickable:hover{border-color:var(--brand3,#60a5fa)!important;box-shadow:var(--shadow2)!important;transform:translateY(-1px)}
.dash-card-clickable:active{transform:translateY(0)}
`;

/* ══════════════ 分类轴图表 option 构建（bar / stackBar / line / combo 共用） ══════════════ */

export type CategoryKind = 'bar' | 'stackBar' | 'line' | 'combo';

export interface CategoryChartResult {
  option: EChartsOption;
  isEmpty: boolean;
  cats: string[];
}

/**
 * 构建分类轴图表 option
 * - bar：分类柱；stackBar：多指标堆叠；line：平滑折线（面积淡填充）；combo：柱 + 线双 y 轴
 * - 横向（chart.horizontal=true）时互换 x/y 轴
 */
export function buildCategoryChart(
  widget: DashboardWidget,
  f: ResolvedFields,
  rows: RowData[],
  kind: CategoryKind,
  dark?: boolean
): CategoryChartResult {
  const horizontal = chartBool(widget, 'horizontal', false);
  const metrics = f.metrics.slice(0, kind === 'combo' ? 2 : 3);
  if (!f.metric || !metrics.length) {
    return { option: {}, isEmpty: true, cats: [] };
  }
  let seriesMetrics = metrics;
  if (kind === 'combo') {
    const second = metrics[1] || f.numerics.find((n) => n !== metrics[0]);
    seriesMetrics = second ? [metrics[0], second] : [metrics[0]];
  }
  const limit = chartNum(widget, 'limit', 14);
  const order: 'asc' | 'desc' | 'none' = kind === 'line' ? 'none' : 'desc';
  const grouped = groupByDim(rows, f.dimension, seriesMetrics, widget.agg, { limit, order });
  if (!grouped.cats.length) return { option: {}, isEmpty: true, cats: [] };

  const axis = axisStyle(dark);
  const labelColor = subTextColor(dark);
  const legendShow = seriesMetrics.length > 1 && chartBool(widget, 'legend', true);

  const catAxis = {
    type: 'category' as const,
    data: grouped.cats,
    boundaryGap: kind === 'line' ? false : true,
    ...axis,
    splitLine: { show: false, lineStyle: { color: splitLineColor(dark) } },
    axisLabel: {
      color: labelColor,
      fontSize: 11,
      rotate: grouped.cats.length > 10 ? 30 : 0,
      hideOverlap: true,
      interval: 0 as const,
    },
  };
  const valAxis = { type: 'value' as const, ...axis, axisLine: { show: false, lineStyle: { color: axis.axisLine.lineStyle.color } } };

  const commonSeries = {
    emphasis: { focus: 'series' as const },
    animationDuration: 520,
  };

  const series = seriesMetrics.map((m, i) => {
    const color = SERIES_COLORS[i % SERIES_COLORS.length];
    const data = grouped.series[i] || [];
    if (kind === 'line') {
      return {
        ...commonSeries,
        name: m,
        type: 'line' as const,
        smooth: true,
        symbol: 'circle' as const,
        symbolSize: 6,
        showSymbol: grouped.cats.length <= 30,
        lineStyle: { width: 2.4 },
        itemStyle: { color },
        areaStyle: { opacity: 0.14, color },
        data,
      };
    }
    if (kind === 'combo' && i > 0) {
      return {
        ...commonSeries,
        name: m,
        type: 'line' as const,
        yAxisIndex: 1,
        smooth: true,
        symbol: 'circle' as const,
        symbolSize: 6,
        lineStyle: { width: 2.4 },
        itemStyle: { color },
        data,
      };
    }
    return {
      ...commonSeries,
      name: m,
      type: 'bar' as const,
      stack: kind === 'stackBar' ? 'total' : undefined,
      barMaxWidth: kind === 'stackBar' ? 30 : 26,
      itemStyle: {
        color,
        borderRadius: kind === 'stackBar' && i < seriesMetrics.length - 1 ? 0 : ([4, 4, 0, 0] as [number, number, number, number]),
      },
      data,
    };
  });

  const option: EChartsOption = {
    color: SERIES_COLORS,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: kind === 'line' ? 'line' : 'shadow' },
    },
    legend: legendShow
      ? {
          top: 0,
          right: 4,
          icon: 'roundRect',
          itemWidth: 9,
          itemHeight: 9,
          textStyle: { color: labelColor, fontSize: 11 },
        }
      : undefined,
    grid: {
      left: 6,
      right: kind === 'combo' ? 6 : 14,
      top: legendShow ? 32 : 14,
      bottom: 4,
      containLabel: true,
    },
    xAxis: horizontal ? valAxis : catAxis,
    yAxis:
      kind === 'combo'
        ? [
            { ...(horizontal ? catAxis : valAxis) },
            { ...(horizontal ? catAxis : valAxis), splitLine: { show: false, lineStyle: { color: splitLineColor(dark) } } },
          ]
        : horizontal
          ? catAxis
          : valAxis,
    series: series as EChartsOption['series'],
  };
  return { option, isEmpty: dataIsEmpty(grouped.series), cats: grouped.cats };
}

function dataIsEmpty(series: number[][]): boolean {
  return !series.some((s) => s.some((v) => Number.isFinite(v) && v !== 0));
}

/** 构建标准饼图 option（PieWidget 用） */
export function buildPieChart(widget: DashboardWidget, f: ResolvedFields, rows: RowData[], dark?: boolean): { option: EChartsOption; isEmpty: boolean } {
  if (!f.metric) return { option: {}, isEmpty: true };
  const limit = chartNum(widget, 'limit', 8);
  const grouped = groupByDim(rows, f.dimension, [f.metric], widget.agg, { limit, order: 'desc' });
  if (!grouped.cats.length) return { option: {}, isEmpty: true };
  const labelColor = subTextColor(dark);
  const donut = chartBool(widget, 'donut', false);
  const option: EChartsOption = {
    color: SERIES_COLORS,
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: {
      bottom: 0,
      icon: 'roundRect',
      itemWidth: 9,
      itemHeight: 9,
      textStyle: { color: labelColor, fontSize: 11 },
    },
    series: [
      {
        type: 'pie',
        radius: donut ? ['42%', '66%'] : ['0%', '64%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        label: { color: labelColor, fontSize: 11, formatter: '{b}\n{d}%' },
        labelLine: { lineStyle: { color: dark ? 'rgba(255,255,255,.25)' : C.line } },
        itemStyle: { borderColor: dark ? '#101d33' : C.panel, borderWidth: 2 },
        data: grouped.cats.map((name, i) => ({ name, value: grouped.series[0]?.[i] ?? 0 })),
      },
    ],
  };
  return { option, isEmpty: dataIsEmpty(grouped.series) };
}

