/** 客户详情弹窗 — V10（从 DetailTable 拆出，便于维护）
 *
 * V10 变更：
 *  CD-1 由右侧 Drawer 改为**居中 Modal**：width 80vw、centered、最大高度 85vh，内容区可滚动
 *  CD-2 分区顺序：策略与运行 → 策略运行趋势(新) → 流程进度 → 节点时间线 → 基础信息
 *  CD-3 基础信息里「与人相关」字段（销售/客服/解决方案/培训人）**单独一个区块**，不与其他字段混排
 *
 * 弹层令牌：antd Modal portal 到 <body>，取不到 .board-root 的 CSS 变量，
 * 因此在内容根节点用**字面值重新声明**一套令牌（契约 §六-9 允许做法）。
 * 明暗两套由 useThemeMode() 选择；同时尝试读取 .board-root 上的 --brand（用户主题色）。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Empty, Modal, Spin, Tooltip } from 'antd';
import type { EChartsOption } from 'echarts';
import {
  BarChartOutlined, HistoryOutlined, PartitionOutlined, ShopOutlined,
  TeamOutlined, LineChartOutlined,
} from '@ant-design/icons';
import EChart from '../EChart';
import { CHAIN_TYPE_COLORS, REGION_COLORS } from '@/api/crm-board';
import { fmtNum, fmtPct, useThemeMode } from './theme';

/* ══════════════ 数据类型（对齐后端 GET /api/crm/board/client/:id） ══════════════ */

export interface ClientTimelineNode {
  name: string;
  doneAt: string;
  doneAtLabel: string;
  done: boolean;
  isCurrent: boolean;
  durationLabel: string;
}

/** V10 新增：近 30 日趋势（后端尚未返回时整块缺失，前端降级显示提示） */
export interface ClientTrendSeries {
  reached?: number[];
  reachedTimes?: number[];
  reachRate?: number[];
  couponIssued?: number[];
  couponUsed?: number[];
  couponRate?: number[];
  channelCost?: number[];
  couponCost?: number[];
  totalCost?: number[];
  roi?: number[];
}

export interface ClientTrend {
  days?: string[];
  daysCn?: string[];
  series?: ClientTrendSeries;
}

export interface ClientDetailData {
  client: Record<string, string | number>;
  progress: Record<string, string | number | boolean>;
  timeline: ClientTimelineNode[];
  run: Record<string, unknown> | null;
  signAtLabel: string;
  submitAtLabel: string;
  /** 后端补齐后自动启用；当前为 undefined */
  trend?: ClientTrend | null;
}

export interface ClientDetailProps {
  open: boolean;
  loading: boolean;
  error: string;
  chainName: string;
  data: ClientDetailData | null;
  isMobile: boolean;
  onClose: () => void;
}

/* ══════════════ 弹层令牌（字面值重声明） ══════════════ */

interface PopTokens {
  '--panel': string;
  '--panel2': string;
  '--line': string;
  '--line2': string;
  '--text': string;
  '--text2': string;
  '--text3': string;
  '--brand': string;
  '--brand3': string;
  '--brandSoft': string;
  '--green': string;
  '--warn': string;
  '--danger': string;
  '--purple': string;
  '--cyan': string;
  '--radius-sm': string;
  '--fs-2xs': string;
  '--fs-xs': string;
  '--fs-sm': string;
  '--fs-md': string;
  '--fs-xl': string;
}

/** 对应 Board.tsx themeVars() 的亮色令牌（一值一对，未新造色） */
const TOKENS_LIGHT: PopTokens = {
  '--panel': '#ffffff',
  '--panel2': '#f8fafd',
  '--line': '#e3e9f2',
  '--line2': '#edf1f8',
  '--text': '#0f172a',
  '--text2': '#475569',
  '--text3': '#8494ab',
  '--brand': '#2563eb',
  '--brand3': '#60a5fa',
  '--brandSoft': '#eff5ff',
  '--green': '#059669',
  '--warn': '#d97706',
  '--danger': '#dc2626',
  '--purple': '#7c3aed',
  '--cyan': '#0891b2',
  '--radius-sm': '10px',
  '--fs-2xs': '11px',
  '--fs-xs': '12px',
  '--fs-sm': '13px',
  '--fs-md': '14px',
  '--fs-xl': '22px',
};

/** 对应 Board.tsx themeVars() 的深色令牌 */
const TOKENS_DARK: PopTokens = {
  '--panel': '#141e33',
  '--panel2': '#1a2740',
  '--line': '#243356',
  '--line2': '#1d2a47',
  '--text': '#e8eef8',
  '--text2': '#9db0cc',
  '--text3': '#8ba3c2',
  '--brand': '#60a5fa',
  '--brand3': '#93c5fd',
  '--brandSoft': '#16294a',
  '--green': '#34d399',
  '--warn': '#fbbf24',
  '--danger': '#f87171',
  '--purple': '#a78bfa',
  '--cyan': '#22d3ee',
  '--radius-sm': '10px',
  '--fs-2xs': '11px',
  '--fs-xs': '12px',
  '--fs-sm': '13px',
  '--fs-md': '14px',
  '--fs-xl': '22px',
};

/** 读取弹层令牌：明暗切换 + 复用 .board-root 上的用户主题色 --brand */
function usePopTokens(): React.CSSProperties {
  const mode = useThemeMode();
  const [brand, setBrand] = useState('');
  useEffect(() => {
    const el = document.querySelector('.board-root');
    if (!el) return;
    const v = getComputedStyle(el).getPropertyValue('--brand').trim();
    if (v) setBrand(v);
  }, [mode]);
  const base = mode === 'dark' ? TOKENS_DARK : TOKENS_LIGHT;
  return (brand ? { ...base, '--brand': brand } : base) as unknown as React.CSSProperties;
}

/* ══════════════ run 字段映射（jdywh_mail_30） ══════════════ */

const RUN_KEYS = {
  opened: 'c_70bbab893f',
  running: 'c_c75741ce78',
  sent: 'c_8428aa48e0',
  arrived: 'c_a6bfcce0cb',
  reachRate: 'c_9a055525e4',
  turnover: 'c_0b4adaa5d2',
  couponIssued: 'c_6ce1a4580f',
  couponUsed: 'c_f38e0dcb75',
  couponRate: 'c_a5815395ba',
  couponSales: 'c_0964f9ffab',
  couponCost: 'c_81f128a3b7',
  channelCost: 'c_783814dcb3',
  roi: 'c_02f259d69b',
} as const;

function runNum(run: Record<string, unknown> | null, key: string): number {
  if (!run) return 0;
  const n = Number(run[key]);
  return Number.isFinite(n) ? n : 0;
}

/** 金额：≥10000 用「万元」1 位小数（契约 §三 V10 新增要求） */
function fmtMoney(v: number | null | undefined): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '¥0';
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return `¥${fmtNum(n, 0)}`;
}

/** 比率：0~1 按百分比；>1 视为已是百分数 */
function fmtRate(v: number): string {
  if (!Number.isFinite(v)) return '-';
  return v > 1 ? `${fmtNum(v, 2)}%` : fmtPct(v, 2);
}

/** 'YYYYMMDD' → 'YYYY-MM-DD' */
function fmtYmd(v: unknown): string {
  const t = String(v ?? '').replace(/\D/g, '');
  if (t.length !== 8) return '';
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
}

/* ══════════════ 局部样式（vcd- 前缀） ══════════════ */
const CSS = `
/* 内容容器：最大高度由 Modal body 控制，这里只管内距与分区间距 */
.vcd-wrap{display:flex;flex-direction:column;gap:12px;color:var(--text)}
.vcd-pad{padding:14px 16px 18px}
@media(max-width:560px){.vcd-pad{padding:12px 12px 16px}}

/* 顶部概览 */
.vcd-hero{display:flex;align-items:flex-start;gap:12px;padding:13px 15px;border-radius:var(--radius-sm);border:1px solid var(--line);background:linear-gradient(135deg,var(--brandSoft),transparent 72%)}
.vcd-hero .hm{flex:1;min-width:0;display:flex;flex-direction:column;gap:7px}
.vcd-hero h3{margin:0;font-size:var(--fs-md);font-weight:750;color:var(--text);line-height:1.3;letter-spacing:.2px;overflow-wrap:anywhere}
.vcd-chips{display:flex;flex-wrap:wrap;gap:6px}
.vcd-chip{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:6px;font-size:var(--fs-2xs);font-weight:650;line-height:1;white-space:nowrap;border:1px solid currentColor;background:color-mix(in srgb,currentColor 12%,transparent)}
.vcd-chip.mute{color:var(--text2);border-color:var(--line);background:var(--panel2)}
/* 正常 / 超期 徽章 */
.vcd-badge{flex-shrink:0;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-width:100px;padding:8px 12px;border-radius:var(--radius-sm);color:#fff;text-align:center;background:linear-gradient(135deg,var(--danger),var(--warn))}
.vcd-badge b{font-size:var(--fs-sm);font-weight:800;letter-spacing:.3px;line-height:1.2}
.vcd-badge span{font-size:var(--fs-2xs);font-weight:600;opacity:.95;line-height:1.2}
.vcd-badge.ok{background:linear-gradient(135deg,var(--green),color-mix(in srgb,var(--green) 62%,#ffffff))}

/* 超期提示条 */
.vcd-warn{display:flex;align-items:flex-start;gap:8px;padding:9px 11px;border-radius:var(--radius-sm);font-size:var(--fs-xs);line-height:1.55;color:var(--danger);background:color-mix(in srgb,var(--danger) 9%,transparent);border:1px solid color-mix(in srgb,var(--danger) 30%,transparent)}
.vcd-warn b{font-weight:800}
.vcd-warn .ic{flex-shrink:0;font-weight:800;line-height:1.3}

/* 分区卡片 */
.vcd-sec{border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--panel2);overflow:hidden}
.vcd-sec-h{display:flex;align-items:center;gap:7px;padding:9px 12px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,color-mix(in srgb,var(--panel) 78%,transparent),transparent)}
.vcd-sec-h .ic{width:20px;height:20px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--brandSoft);color:var(--brand);font-size:var(--fs-xs);line-height:1}
.vcd-sec-h .t{font-size:var(--fs-sm);font-weight:750;color:var(--text);letter-spacing:.2px}
.vcd-sec-h .n{margin-left:auto;font-size:var(--fs-2xs);font-weight:600;color:var(--text2);font-variant-numeric:tabular-nums}
.vcd-sec-b{padding:11px 12px}

/* 字段网格：桌面 3 列 / 窄屏 2 列 */
.vcd-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px 14px;margin:0}
.vcd-f{display:flex;flex-direction:column;gap:2px;min-width:0}
.vcd-f dt{font-size:var(--fs-2xs);font-weight:600;color:var(--text2);letter-spacing:.2px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vcd-f dd{margin:0;font-size:var(--fs-sm);font-weight:680;color:var(--text);line-height:1.45;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.vcd-f dd.dim{color:var(--text2);font-weight:500}
.vcd-f dd.hi{color:var(--brand);font-weight:750}
.vcd-f dd.ok{color:var(--green);font-weight:750}
.vcd-f dd.bad{color:var(--danger);font-weight:750}
@media(max-width:900px){.vcd-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:560px){.vcd-hero{flex-direction:column}.vcd-badge{width:100%}}

/* CD-3：人员区块 —— 与「基础信息」其它字段明确分开 */
.vcd-people{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}
@media(max-width:900px){.vcd-people{grid-template-columns:repeat(2,minmax(0,1fr))}}
.vcd-people .vcd-f dd{display:inline-flex;align-items:center;gap:5px}
.vcd-person-badge{width:22px;height:22px;border-radius:50%;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;font-size:var(--fs-2xs);font-weight:750;color:var(--brand);background:var(--brandSoft);border:1px solid color-mix(in srgb,var(--brand) 24%,transparent)}

/* 节点时间线 */
.vcd-tl{list-style:none;margin:0;padding:0}
.vcd-tl li{position:relative;display:grid;grid-template-columns:18px 96px minmax(0,1fr) 78px;align-items:center;gap:10px;min-height:32px;font-size:var(--fs-xs);padding:4px 0}
.vcd-tl li::before{content:'';position:absolute;left:8px;top:0;height:100%;width:2px;background:var(--line);z-index:0}
.vcd-tl li:first-child::before{top:50%;height:50%}
.vcd-tl li:last-child::before{height:50%}
.vcd-tl li.done::before{background:var(--green)}
.vcd-tl li.cur::before{background:linear-gradient(180deg,var(--green),var(--warn))}
.vcd-tl li .dot{grid-column:1;justify-self:center;position:relative;z-index:1;width:10px;height:10px;border-radius:50%;background:var(--panel2);border:2px solid var(--line);flex-shrink:0}
.vcd-tl li.done .dot{background:var(--green);border-color:var(--green)}
.vcd-tl li.cur .dot{background:var(--warn);border-color:var(--warn);box-shadow:0 0 0 3px color-mix(in srgb,var(--warn) 26%,transparent)}
.vcd-tl li .nm{font-weight:680;color:var(--text2);white-space:nowrap}
.vcd-tl li.done .nm{color:var(--text)}
.vcd-tl li.cur .nm{color:var(--warn);font-weight:750}
.vcd-tl li .st{color:var(--text2);font-variant-numeric:tabular-nums;font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vcd-tl li .du{text-align:right;color:var(--text2);font-variant-numeric:tabular-nums;font-weight:700;font-size:var(--fs-xs);white-space:nowrap}
.vcd-tl li.cur .du{color:var(--warn)}
.vcd-tip{margin-top:9px;padding-top:8px;border-top:1px dashed var(--line);font-size:var(--fs-2xs);color:var(--text2);line-height:1.6}

/* 趋势区 */
.vcd-trend-note{font-size:var(--fs-2xs);color:var(--text2);line-height:1.6;margin-top:6px}
.vcd-trend-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:26px 10px;border:1px dashed var(--line);border-radius:var(--radius-sm);background:var(--panel);color:var(--text2);font-size:var(--fs-xs);line-height:1.6;text-align:center}
.vcd-trend-empty .big{font-size:var(--fs-sm);font-weight:700;color:var(--text)}
.vcd-trend-tgl{display:inline-flex;flex-wrap:wrap;gap:5px;margin-bottom:8px}
.vcd-trend-chip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border-radius:8px;cursor:pointer;user-select:none;border:1px solid var(--line);background:var(--panel);color:var(--text2);font-size:var(--fs-2xs);font-weight:550;transition:all .15s;white-space:nowrap;font-family:inherit}
.vcd-trend-chip .sw{width:8px;height:8px;border-radius:2px;flex-shrink:0}
.vcd-trend-chip .sw.line{width:12px;height:3px;border-radius:2px}
.vcd-trend-chip.on{border-color:currentColor;background:color-mix(in srgb,currentColor 10%,transparent);color:var(--text);font-weight:650}
`;

/* ── 分区卡片 ── */
function CSection({
  icon, title, note, children,
}: {
  icon: React.ReactNode;
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="vcd-sec">
      <div className="vcd-sec-h">
        <span className="ic">{icon}</span>
        <span className="t">{title}</span>
        {note ? <span className="n">{note}</span> : null}
      </div>
      <div className="vcd-sec-b">{children}</div>
    </section>
  );
}

type Tone = 'dim' | 'hi' | 'ok' | 'bad' | undefined;

function CField({ label, value, tone }: { label: string; value: React.ReactNode; tone?: Tone }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className="vcd-f">
      <dt>{label}</dt>
      <dd className={empty ? 'dim' : tone}>{empty ? '-' : value}</dd>
    </div>
  );
}

/* ══════════════ 趋势指标定义（对齐 RunTrend.tsx 视觉） ══════════════ */

type TrendKey =
  | 'reached' | 'reachedTimes' | 'reachRate'
  | 'couponIssued' | 'couponUsed' | 'couponRate'
  | 'channelCost' | 'couponCost' | 'totalCost' | 'roi';

interface TrendMetric {
  key: TrendKey;
  name: string;
  /** 0 = 左轴（数量/金额），1 = 右轴（比率） */
  axis: 0 | 1;
  type: 'bar' | 'line';
  color: string;
  kind: 'num' | 'pct' | 'money';
}

/** 契约 §三令牌色（与 RunTrend 同一序列） */
const TREND_METRICS: TrendMetric[] = [
  { key: 'reached', name: '触达人数', axis: 0, type: 'bar', color: '#3b82f6', kind: 'num' },
  { key: 'reachedTimes', name: '触达人次', axis: 0, type: 'bar', color: '#10b981', kind: 'num' },
  { key: 'couponIssued', name: '发放优惠券', axis: 0, type: 'bar', color: '#06b6d4', kind: 'num' },
  { key: 'couponUsed', name: '核销优惠券', axis: 0, type: 'bar', color: '#f59e0b', kind: 'num' },
  { key: 'channelCost', name: '渠道成本', axis: 0, type: 'bar', color: '#2563eb', kind: 'money' },
  { key: 'couponCost', name: '优惠券成本', axis: 0, type: 'bar', color: '#0891b2', kind: 'money' },
  { key: 'totalCost', name: '成本合计', axis: 0, type: 'bar', color: '#d97706', kind: 'money' },
  { key: 'reachRate', name: '到店率', axis: 1, type: 'line', color: '#8b5cf6', kind: 'pct' },
  { key: 'couponRate', name: '核销率', axis: 1, type: 'line', color: '#ef4444', kind: 'pct' },
  { key: 'roi', name: 'ROI', axis: 1, type: 'line', color: '#7c3aed', kind: 'pct' },
];

/** 默认选中：数量 4 个 + 比率 2 个（成本类默认收起，与 RunTrend 一致） */
const TREND_DEFAULT: TrendKey[] = ['reached', 'reachedTimes', 'reachRate', 'couponRate'];

function trendArr(v: unknown, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  if (!Array.isArray(v)) return out;
  for (let i = 0; i < n; i += 1) {
    const x = Number(v[i]);
    out[i] = Number.isFinite(x) ? x : 0;
  }
  return out;
}

export default function ClientDetail({
  open, loading, error, chainName, data, isMobile, onClose,
}: ClientDetailProps) {
  const tokens = usePopTokens();
  /** 趋势区指标开关（趋势数据到位后才用得上） */
  const [trendOn, setTrendOn] = useState<TrendKey[]>(TREND_DEFAULT);

  const cl = data?.client || {};
  const pg = data?.progress || {};
  const run = data?.run ?? null;
  const tl = Array.isArray(data?.timeline) ? data.timeline : [];
  const trend = data?.trend ?? null;

  /* ── 策略与运行 派生值 ── */
  const sent = runNum(run, RUN_KEYS.sent);
  const arrived = runNum(run, RUN_KEYS.arrived);
  const issued = runNum(run, RUN_KEYS.couponIssued);
  const used = runNum(run, RUN_KEYS.couponUsed);
  const turnover = runNum(run, RUN_KEYS.turnover);
  const channelCost = runNum(run, RUN_KEYS.channelCost);
  const couponCost = runNum(run, RUN_KEYS.couponCost);
  const totalCost = channelCost + couponCost;
  const reachRate = sent > 0 ? arrived / sent : runNum(run, RUN_KEYS.reachRate);
  const couponRate = issued > 0 ? used / issued : runNum(run, RUN_KEYS.couponRate);
  const roiRaw = runNum(run, RUN_KEYS.roi);
  const roi = roiRaw > 0 ? roiRaw : (totalCost > 0 && turnover > 0 ? totalCost / turnover : 0);

  const isOverdue = !!pg.isOverdue;
  const ownerRoles = Array.isArray(pg.ownerRoles) ? (pg.ownerRoles as string[]) : [];
  const regionColor = REGION_COLORS[String(cl.region ?? '')] || 'var(--text2)';
  const chainTypeColor = CHAIN_TYPE_COLORS[String(cl.chainType ?? '')] || 'var(--text2)';
  const doneCount = tl.filter((t) => t.done).length;

  /* ── 趋势图 option ── */
  const trendDays = Array.isArray(trend?.days) ? trend!.days! : [];
  const trendDaysCn = Array.isArray(trend?.daysCn) && trend!.daysCn!.length === trendDays.length
    ? trend!.daysCn!
    : trendDays;
  const hasTrend = trendDays.length > 0 && !!trend?.series;

  const trendOption = useMemo<EChartsOption>(() => {
    const n = trendDays.length;
    const visible = TREND_METRICS.filter((m) => trendOn.includes(m.key));
    const hasBar = visible.some((m) => m.type === 'bar');
    const hasLine = visible.some((m) => m.type === 'line');
    const series = visible.map((m) => {
      const vals = trendArr(trend?.series?.[m.key], n);
      if (m.type === 'bar') {
        return {
          name: m.name,
          type: 'bar' as const,
          yAxisIndex: 0,
          barMaxWidth: 12,
          itemStyle: { color: m.color, borderRadius: [3, 3, 0, 0] },
          data: vals,
        };
      }
      return {
        name: m.name,
        type: 'line' as const,
        yAxisIndex: 1,
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2, color: m.color },
        itemStyle: { color: m.color },
        data: vals,
      };
    });
    return {
      color: visible.map((m) => m.color),
      grid: { left: 8, right: 8, top: 34, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis' as const,
        axisPointer: { type: hasBar ? ('shadow' as const) : ('line' as const) },
        backgroundColor: tokens['--panel' as keyof React.CSSProperties] as string,
        borderColor: tokens['--line' as keyof React.CSSProperties] as string,
        textStyle: { color: tokens['--text' as keyof React.CSSProperties] as string, fontSize: 12 },
      },
      legend: {
        top: 0,
        type: 'scroll' as const,
        textStyle: { color: tokens['--text2' as keyof React.CSSProperties] as string, fontSize: 11 },
        itemWidth: 10,
        itemHeight: 8,
      },
      xAxis: {
        type: 'category' as const,
        data: trendDaysCn,
        axisLine: { lineStyle: { color: tokens['--line' as keyof React.CSSProperties] as string } },
        axisTick: { show: false },
        axisLabel: { color: tokens['--text2' as keyof React.CSSProperties] as string, fontSize: 11, interval: isMobile ? 5 : 2 },
      },
      yAxis: [
        {
          type: 'value' as const,
          axisLine: { show: false },
          axisLabel: { color: tokens['--text2' as keyof React.CSSProperties] as string, fontSize: 11 },
          splitLine: { lineStyle: { color: tokens['--line2' as keyof React.CSSProperties] as string, type: 'dashed' as const } },
        },
        {
          type: 'value' as const,
          show: hasLine && hasBar,
          axisLine: { show: false },
          axisLabel: { color: tokens['--text2' as keyof React.CSSProperties] as string, fontSize: 11, formatter: (v: number) => `${fmtNum(v * 100, 0)}%` },
          splitLine: { show: false },
        },
      ],
      series,
    } as EChartsOption;
  }, [trendDays, trendDaysCn, trend, trendOn, tokens, isMobile]);

  const toggleTrend = (k: TrendKey) => {
    setTrendOn((cur) => (cur.includes(k)
      ? (cur.length > 1 ? cur.filter((x) => x !== k) : cur)
      : [...cur, k]));
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={isMobile ? '96vw' : '80vw'}
      title={chainName ? `${chainName} · 客户详情` : '客户详情'}
      destroyOnHidden
      /* CD-1：内容区可滚动，最大高度 85vh */
      styles={{
        root: tokens,
        header: {
          background: 'var(--panel)',
          borderBottom: '1px solid var(--line)',
          color: 'var(--text)',
          padding: '13px 16px',
          marginBottom: 0,
        },
        body: {
          padding: 0,
          background: 'var(--panel)',
          color: 'var(--text)',
          maxHeight: '85vh',
          overflowY: 'auto',
        },
      }}
      className="vcd-modal"
    >
      <style>{CSS}</style>
      {loading ? (
        <div style={{ padding: 60, textAlign: 'center' }}><Spin /></div>
      ) : error ? (
        <div style={{ padding: 16 }}>
          <Alert type="error" showIcon message="客户详情加载失败" description={error} />
        </div>
      ) : !data ? (
        <div style={{ padding: 40 }}><Empty description="暂无详情" /></div>
      ) : (
        <div className="vcd-wrap vcd-pad">
          {/* ── 顶部概览 + 超期徽章 ── */}
          <div className="vcd-hero">
            <div className="hm">
              <h3>{String(cl.chainName || chainName || '-')}</h3>
              <div className="vcd-chips">
                <span className="vcd-chip" style={{ color: regionColor }}>{String(cl.region || '未知')}</span>
                <span className="vcd-chip" style={{ color: chainTypeColor }}>{String(cl.chainType || '未分类')}</span>
                <span className="vcd-chip mute">ID {String(cl.chainId || '-')}</span>
                <span className="vcd-chip mute">{String(cl.signType || '-')}</span>
                <span className="vcd-chip mute">{fmtNum(Number(cl.stores) || 0)} 家门店</span>
              </div>
            </div>
            {isOverdue ? (
              <div className="vcd-badge">
                <b>超期 {fmtNum(Number(pg.overdueDays) || 0)} 个工作日</b>
                <span>阈值 {fmtNum(Number(pg.overdueThreshold) || 0)} 个工作日</span>
              </div>
            ) : (
              <div className="vcd-badge ok"><b>正常</b><span>未超阈值</span></div>
            )}
          </div>

          {/* ══════ 1. 策略与运行 ══════ */}
          <CSection
            icon={<BarChartOutlined />}
            title="策略与运行"
            note={run ? `统计日期 ${fmtYmd((run as Record<string, unknown>).c_793d0ececa) || '-'}` : '无快照'}
          >
            {!run ? (
              <div style={{ fontSize: 12, color: 'var(--text2)', padding: '4px 0', lineHeight: 1.7 }}>
                暂无运行数据（该连锁未出现在最新一日的运行汇总中）。
              </div>
            ) : (
              <dl className="vcd-grid">
                <CField label="开通策略数" value={fmtNum(runNum(run, RUN_KEYS.opened))} tone="hi" />
                <CField label="运行策略数" value={fmtNum(runNum(run, RUN_KEYS.running))} tone="hi" />
                <CField label="触达人数" value={fmtNum(sent)} />
                <CField label="到店人数" value={fmtNum(arrived)} />
                <CField label="到店率" value={fmtRate(reachRate)} />
                <CField label="优惠券核销率" value={fmtRate(couponRate)} />
                <CField label="发券人数" value={fmtNum(issued)} />
                <CField label="用券人数" value={fmtNum(used)} />
                <CField label="转化销售额" value={fmtMoney(turnover)} />
                <CField label="用券销售额" value={fmtMoney(runNum(run, RUN_KEYS.couponSales))} />
                <CField label="渠道成本" value={fmtMoney(channelCost)} />
                <CField label="用券成本" value={fmtMoney(couponCost)} />
                <CField label="成本合计" value={fmtMoney(totalCost)} />
                <CField label="营销ROI（成本÷销售额）" value={roi > 0 ? fmtNum(roi, 2) : '-'} tone={roi > 0 ? 'hi' : 'dim'} />
                <CField label="数据快照" value={String((run as Record<string, unknown>).wjmc || '-')} />
              </dl>
            )}
          </CSection>

          {/* ══════ 2. 策略运行趋势（新增，近 30 日） ══════ */}
          <CSection
            icon={<LineChartOutlined />}
            title="策略运行趋势"
            note={hasTrend ? `近 ${trendDays.length} 日` : '待后端返回'}
          >
            {!hasTrend ? (
              <div className="vcd-trend-empty">
                <span className="big">趋势数据准备中</span>
                <span>后端 `GET /api/crm/board/client/:id` 补齐 `trend` 字段后自动展示近 30 日趋势图。</span>
                <span>将展示：触达人数、触达人次、到店率、发放优惠券、核销优惠券、核销率、渠道成本、优惠券成本、成本合计、ROI</span>
              </div>
            ) : (
              <>
                <div className="vcd-trend-tgl">
                  {TREND_METRICS.map((m) => {
                    const on = trendOn.includes(m.key);
                    return (
                      <button
                        key={m.key}
                        type="button"
                        className={`vcd-trend-chip${on ? ' on' : ''}`}
                        style={on ? { color: m.color } : undefined}
                        onClick={() => toggleTrend(m.key)}
                        aria-pressed={on}
                      >
                        <i
                          className={`sw${m.type === 'line' ? ' line' : ''}`}
                          style={{ background: m.color }}
                        />
                        {m.name}
                      </button>
                    );
                  })}
                </div>
                <EChart option={trendOption} height={isMobile ? 200 : 260} />
                <div className="vcd-trend-note">
                  数据口径同「策略运行情况」：按策略开通&触达时间按日聚合；数量/金额走左轴（柱），比率走右轴（线）。
                </div>
              </>
            )}
          </CSection>

          {/* ══════ 3. 流程进度 ══════ */}
          <CSection icon={<PartitionOutlined />} title="流程进度" note={`${doneCount} / ${tl.length} 节点已完成`}>
            <dl className="vcd-grid">
              <CField label="当前节点" value={pg.isCompleted ? '流程结束' : String(pg.node || '流程结束')} tone="hi" />
              <CField label="当前处理人" value={String(pg.owner || '-')} />
              <CField label="负责人岗位" value={ownerRoles.length ? ownerRoles.join(' / ') : '-'} />
              <CField label="流程状态" value={pg.isCompleted ? '已完成' : '进行中'} tone={pg.isCompleted ? 'ok' : 'hi'} />
              <CField label="进入当前节点" value={String(pg.enterAtLabel || '-')} />
              <CField label="当前节点处理时长" value={String(pg.currentNodeDuration || '-')} tone={isOverdue ? 'bad' : undefined} />
              <CField label="当前节点时长（天）" value={fmtNum(Number(pg.nodeDays) || 0, 1)} />
              <CField label="连锁总时长（天）" value={fmtNum(Number(pg.totalDays) || 0, 1)} />
              <CField label="已过工作日" value={`${fmtNum(Number(pg.workdays) || 0)} 天`} tone={isOverdue ? 'bad' : undefined} />
              <CField label="上节点完成时间" value={String(pg.prevDoneAtLabel || '-')} />
              <CField label="节点阈值" value={String(pg.overdueRule || '-')} />
            </dl>
            {isOverdue && (
              <div className="vcd-warn" style={{ marginTop: 10 }}>
                <span className="ic">!</span>
                <span>
                  已<b>超期 {fmtNum(Number(pg.overdueDays) || 0)} 个工作日</b>（阈值{' '}
                  {fmtNum(Number(pg.overdueThreshold) || 0)} 个工作日，已过{' '}
                  {fmtNum(Number(pg.workdays) || 0)} 个工作日）。上一节点完成于 {String(pg.prevDoneAtLabel || '-')}。
                </span>
              </div>
            )}
          </CSection>

          {/* ══════ 4. 节点时间线 ══════ */}
          <CSection icon={<HistoryOutlined />} title="节点时间线" note={`${tl.length} 个节点`}>
            <ol className="vcd-tl">
              {tl.map((t, i) => (
                <li key={`${t.name}-${i}`} className={t.isCurrent ? 'cur' : t.done ? 'done' : 'todo'}>
                  <span className="dot" />
                  <span className="nm">{t.name}</span>
                  <span className="st">{t.done ? t.doneAtLabel : t.isCurrent ? '进行中（当前节点）' : '未开始'}</span>
                  <span className="du">{t.durationLabel || ''}</span>
                </li>
              ))}
            </ol>
            <div className="vcd-tip">
              节点耗时为「该节点完成时间 − 上一节点完成时间」；「进行中」耗时 = 当前时间 − 上一节点完成时间。
            </div>
          </CSection>

          {/* ══════ 5. 基础信息 ══════ */}
          <CSection icon={<ShopOutlined />} title="基础信息" note="业务字段 + 人员独立分区">
            <dl className="vcd-grid">
              <CField label="连锁ID" value={String(cl.chainId || '-')} tone="hi" />
              <CField label="连锁名称" value={String(cl.chainName || '-')} />
              <CField label="连锁类型" value={String(cl.chainType || '-')} />
              <CField label="区域" value={String(cl.region || '-')} />
              <CField label="省份" value={String(cl.province || '-')} />
              <CField label="门店数" value={fmtNum(Number(cl.stores) || 0)} />
              <CField label="签约类型" value={String(cl.signType || '-')} />
              <CField label="对接版本" value={String(cl.version || '-')} />
              <CField label="对接结果" value={String(cl.connectResult || '-')} />
              <CField label="培训结果" value={String(cl.trainResult || '-')} />
              <CField label="签约时间" value={data.signAtLabel || '-'} />
              <CField label="提交时间" value={data.submitAtLabel || '-'} />
            </dl>

            {/* CD-3：人员字段独立成区（不与上面混排） */}
            <div
              style={{
                marginTop: 12,
                paddingTop: 11,
                borderTop: '1px dashed var(--line)',
              }}
            >
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9,
                  fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text2)', letterSpacing: '.3px',
                }}
              >
                <TeamOutlined style={{ color: 'var(--brand)' }} />
                相关人员
              </div>
              <dl className="vcd-people" data-people-block="1">
                <CField
                  label="销售"
                  value={<><span className="vcd-person-badge">销</span>{String(cl.sales || '-')}</>}
                />
                <CField
                  label="客服"
                  value={<><span className="vcd-person-badge">服</span>{String(cl.service || '-')}</>}
                />
                <CField
                  label="解决方案"
                  value={<><span className="vcd-person-badge">解</span>{String(cl.solution || '-')}</>}
                />
                <CField
                  label="培训人"
                  value={<><span className="vcd-person-badge">培</span>{String(cl.trainer || '-')}</>}
                />
              </dl>
            </div>
          </CSection>
        </div>
      )}
    </Modal>
  );
}
