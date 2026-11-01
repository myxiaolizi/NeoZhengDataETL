/** 第 4 排左：签约趋势（最近 30 天）— V9.2 视觉优化
 *
 * 本轮只做视觉，不动数据与交互：
 *  - 卡头拆为「标题 + 区域分段控件」/ 工具栏「连锁类型 chip + 图例 chip」两层，消除拥挤
 *  - 区域改为标准分段控件（一眼可辨是筛选，不再与图例混淆）
 *  - 图例改为精致 chip，按「柱形 / 折线」分组，未选中降低透明度
 *  - 网格线用 --line2 减淡；坐标轴文字 11px --text3
 *  - 柱形圆角 + 渐变；折线 smooth + 更大 symbol + 渐变面积
 *  - tooltip 统一为深色卡片式（明暗模式一致，不再出现白框）
 *  - 图表撑满卡片剩余高度，不留大空白
 *
 * 功能保持：区域筛选、连锁类型多选、图例点击显隐（仅 1 处图例）、日期 MM月DD日。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Empty } from 'antd';
import type { EChartsOption } from 'echarts';
import { CHAIN_TYPE_COLORS, CHAIN_TYPE_SHORT, REGION_COLORS } from '@/api/crm-board';
import type { BoardData, SignTrendData } from '@/api/crm-board';
import EChart from '../EChart';
import { useThemeMode } from './theme';

/** 门店数折线色 */
const C_STORE = '#06b6d4';

type Bucket = { south: number[]; north: number[] };
type RegionKey = 'all' | 'south' | 'north';

/** 本地扩展（不代表 api 已声明该字段，缺失即走兜底） */
type TrendLoose = SignTrendData & { daysCn?: string[] };

export interface SignTrendProps {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

/** 数值兜底 */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 数组兜底：长度固定为 n，缺失补 0 */
function fitArr(v: unknown, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  if (!Array.isArray(v)) return out;
  for (let i = 0; i < n; i += 1) out[i] = num(v[i]);
  return out;
}

/** `10/26` / `10-26` / `2026-10-26` → `10月26日`；已是中文格式则原样返回 */
export function dayCn(raw: unknown, idx?: number, daysCn?: unknown): string {
  if (Array.isArray(daysCn) && typeof idx === 'number' && typeof daysCn[idx] === 'string' && daysCn[idx]) {
    return String(daysCn[idx]);
  }
  const s = String(raw ?? '');
  const m = s.match(/(\d{1,2})\s*[/\-月]\s*(\d{1,2})/);
  if (m) return `${Number(m[1])}月${Number(m[2])}日`;
  return s;
}

/** 把选中的连锁类型的 south/north 按日求和 */
export function sumPicked(
  byChainType: Record<string, Bucket>,
  picked: string[],
  n: number,
): { south: number[]; north: number[] } {
  const south = new Array<number>(n).fill(0);
  const north = new Array<number>(n).fill(0);
  picked.forEach((t) => {
    const b = byChainType?.[t];
    if (!b) return;
    const bs = fitArr(b.south, n);
    const bn = fitArr(b.north, n);
    for (let i = 0; i < n; i += 1) {
      south[i] += bs[i];
      north[i] += bn[i];
    }
  });
  return { south, north };
}

/* ── 运行时解析 CSS 变量（echarts canvas 不认 var()） ── */
function readVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const el = document.querySelector('.board-root') || document.documentElement;
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

function useTokens() {
  const mode = useThemeMode();
  return useMemo(() => {
    void mode;
    return {
      axis: readVar('--text3', '#8494ab'),
      axis2: readVar('--text2', '#475569'),
      split: readVar('--line2', '#edf1f8'),
      line: readVar('--line', '#e3e9f2'),
      panel: readVar('--panel', '#ffffff'),
      text: readVar('--text', '#0f172a'),
      brand: readVar('--brand', '#2563eb'),
    };
  }, [mode]);
}

/** tooltip 统一深色卡片式（明暗模式一致，避免默认白框） */
const TOOLTIP_DARK = {
  backgroundColor: 'rgba(15,23,42,.96)',
  borderColor: 'transparent',
  borderWidth: 0,
  textStyle: { color: '#f1f5f9', fontSize: 12 },
  extraCssText: 'box-shadow:0 8px 24px rgba(15,23,42,.28);border-radius:10px;padding:9px 12px;',
} as const;

/* ══════════════ 局部样式（vb6- 前缀） ══════════════ */
const CSS = `
.vb6-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease;height:100%;min-width:0}

/* ── 卡头：标题 + 区域分段控件 ── */
.vb6-h{padding:12px 16px 10px;border-bottom:1px solid var(--line2);display:flex;align-items:center;gap:10px;flex-shrink:0;flex-wrap:nowrap;min-width:0}
.vb6-title{display:flex;align-items:center;gap:8px;min-width:0;flex-shrink:0}
.vb6-dot{width:6px;height:6px;border-radius:2px;background:var(--brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 15%,transparent);flex-shrink:0}
.vb6-title h3{font-size:var(--fs-sm,13px);font-weight:700;color:var(--text);margin:0;letter-spacing:.2px;white-space:nowrap;line-height:1}
.vb6-hint{font-size:var(--fs-2xs,11px);color:var(--text3);font-weight:500;white-space:nowrap}

/* 区域分段控件：单轨道 + 滑块感，明确区别于图例 */
.vb6-seg{display:inline-flex;align-items:center;padding:2px;gap:2px;border-radius:8px;background:color-mix(in srgb,var(--panel2) 85%,var(--line2));border:1px solid var(--line2);margin-left:auto;flex-shrink:0}
.vb6-seg button{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 11px;border:0;border-radius:6px;background:transparent;color:var(--text2);font-size:var(--fs-2xs,11px);font-weight:600;cursor:pointer;transition:background .16s ease,color .16s ease,box-shadow .16s ease;white-space:nowrap;font-family:inherit;line-height:1}
.vb6-seg button:hover{color:var(--text)}
.vb6-seg button.on{background:var(--panel);color:var(--text);box-shadow:0 1px 2px rgba(15,23,42,.10);font-weight:700}
.vb6-seg button .sw{width:6px;height:6px;border-radius:2px;flex-shrink:0}

/* ── 工具栏：连锁类型 + 图例 ── */
.vb6-bar{display:flex;align-items:center;gap:10px;padding:9px 16px;border-bottom:1px solid var(--line2);flex-wrap:wrap;min-width:0;flex-shrink:0}
.vb6-bar .lb{font-size:var(--fs-2xs,11px);color:var(--text3);font-weight:600;white-space:nowrap;flex-shrink:0}

/* 连锁类型 chip */
.vb6-chip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:7px;cursor:pointer;user-select:none;border:1px solid var(--line);background:var(--panel);color:var(--text2);font-size:var(--fs-2xs,11px);font-weight:600;transition:all .16s ease;white-space:nowrap;font-family:inherit;line-height:1}
.vb6-chip:hover{border-color:var(--brand3);color:var(--text)}
.vb6-chip .sw{width:8px;height:8px;border-radius:2.5px;flex-shrink:0}
.vb6-chip.on{background:color-mix(in srgb,var(--brand) 7%,var(--panel));border-color:color-mix(in srgb,var(--brand) 32%,var(--line));color:var(--text);font-weight:700}
.vb6-chip:not(.on){opacity:.5}
.vb6-all{height:24px;padding:0 9px;border-radius:7px;border:1px dashed var(--line);background:transparent;color:var(--brand);font-size:var(--fs-2xs,11px);font-weight:600;cursor:pointer;transition:all .16s ease;white-space:nowrap;font-family:inherit;line-height:1}
.vb6-all:hover{background:var(--brandSoft);border-color:var(--brand3)}

/* ── 图例 chip（全卡唯一图例） ── */
.vb6-legend{display:flex;align-items:center;gap:10px;margin-left:auto;flex-shrink:0;flex-wrap:wrap}
.vb6-legend .lgcap{font-size:var(--fs-2xs,11px);color:var(--text3);font-weight:600;white-space:nowrap;margin-right:1px}
.vb6-lg{display:inline-flex;align-items:center;gap:5px;cursor:pointer;user-select:none;font-size:var(--fs-2xs,11px);font-weight:600;color:var(--text2);white-space:nowrap;transition:opacity .16s ease,color .16s ease;line-height:1}
.vb6-lg:hover{color:var(--text)}
/* R8：形状即语义 —— 柱=正方形 10×10/r2，线=窄长方形 14×4/r2（不再用「柱」「线」文字） */
.vb6-lg .sw.sq{width:10px;height:10px;border-radius:2px}
.vb6-lg .sw.ln{width:14px;height:4px;border-radius:2px}
.vb6-lg.off{opacity:.34}
.vb6-lg.off .sw{filter:grayscale(1)}

/* ── 图表区：撑满卡片剩余高度 ── */
.vb6-b{padding:6px 12px 10px;flex:1;display:flex;flex-direction:column;justify-content:stretch;min-width:0;min-height:0}
.vb6-chart{flex:1;min-height:240px;min-width:0}
.vb6-empty{padding:40px 0;display:flex;align-items:center;justify-content:center}
`;

export default function SignTrend({ data, loading, isMobile }: SignTrendProps) {
  const tok = useTokens();

  const trend = data?.row6?.signTrend as TrendLoose | undefined;
  const rawDays = Array.isArray(trend?.days) ? (trend?.days ?? []) : [];
  const n = rawDays.length;
  const dayLabels = useMemo(
    () => rawDays.map((d, i) => dayCn(d, i, trend?.daysCn)),
    [rawDays, trend?.daysCn],
  );

  const byChainType = (trend?.byChainType || {}) as Record<string, Bucket>;
  const typeNames = useMemo(() => Object.keys(byChainType), [byChainType]);
  const typeKey = typeNames.join('|');

  /** 连锁类型多选：默认全选；类型集合变化时重置 */
  const [picked, setPicked] = useState<string[]>(typeNames);
  useEffect(() => {
    setPicked(typeKey ? typeKey.split('|') : []);
  }, [typeKey]);

  /** 区域筛选（默认全部） */
  const [region, setRegion] = useState<RegionKey>('all');
  /** 图例点击显隐（仅界面上临时隐藏，不影响数据） */
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => { setHidden([]); }, [region]);

  const allSelected = typeNames.length > 0 && picked.length === typeNames.length;

  /** 柱数据：全量 or 选中类型求和 */
  const bars = useMemo(() => {
    if (!n) return { south: [] as number[], north: [] as number[], mode: 'none' as 'none' | 'all' | 'picked' | 'empty' };
    if (!typeNames.length) {
      return { south: fitArr(trend?.south, n), north: fitArr(trend?.north, n), mode: 'all' as const };
    }
    if (!picked.length) return { south: [], north: [], mode: 'empty' as const };
    return { ...sumPicked(byChainType, picked, n), mode: 'picked' as const };
  }, [n, typeNames, picked, byChainType, trend]);

  const stores = useMemo(() => fitArr(trend?.stores, n), [trend, n]);

  /** 当前区域下参与渲染的序列定义 */
  const seriesDefs = useMemo(() => {
    const defs: { name: string; color: string; kind: 'bar' | 'line'; data: number[] }[] = [];
    if (region !== 'north') defs.push({ name: '南区', color: REGION_COLORS['南区'], kind: 'bar', data: bars.south });
    if (region !== 'south') defs.push({ name: '北区', color: REGION_COLORS['北区'], kind: 'bar', data: bars.north });
    defs.push({ name: '门店数', color: C_STORE, kind: 'line', data: stores });
    return defs;
  }, [region, bars, stores]);

  const visibleDefs = seriesDefs.filter((d) => !hidden.includes(d.name));
  const axisInterval = isMobile ? 9 : 5;

  const option = useMemo<EChartsOption>(() => {
    const barsVisible = visibleDefs.filter((d) => d.kind === 'bar');
    const hasBoth = barsVisible.length > 1;
    return {
      color: visibleDefs.map((d) => d.color),
      grid: { left: 2, right: 2, top: 14, bottom: 2, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(15,23,42,.055)' } },
        ...TOOLTIP_DARK,
      },
      legend: { show: false },
      xAxis: {
        type: 'category',
        data: dayLabels,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: tok.line } },
        axisLabel: { color: tok.axis, fontSize: 11, interval: axisInterval, hideOverlap: true, margin: 10 },
      },
      yAxis: [
        {
          type: 'value',
          name: isMobile ? '' : '客户数',
          minInterval: 1,
          nameTextStyle: { color: tok.axis, fontSize: 11, padding: [0, 0, 4, 2], align: 'left' },
          axisLabel: { color: tok.axis, fontSize: 11, margin: 8 },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: tok.split } },   // 减淡：--line2 实线
        },
        {
          type: 'value',
          name: isMobile ? '' : '门店数',
          minInterval: 1,
          nameTextStyle: { color: tok.axis, fontSize: 11, padding: [0, 2, 4, 0], align: 'right' },
          axisLabel: { color: tok.axis, fontSize: 11, margin: 8 },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
        },
      ],
      series: visibleDefs.map((d) => (
        d.kind === 'bar'
          ? {
            name: d.name,
            type: 'bar' as const,
            stack: hasBoth ? 'clients' : undefined,
            barMaxWidth: hasBoth ? 16 : 22,
            barGap: '30%',
            emphasis: { focus: 'series' as const, itemStyle: { shadowBlur: 8, shadowColor: `${d.color}55` } },
            itemStyle: {
              // 圆角柱：顶端圆角，堆叠时底部不圆
              borderRadius: hasBoth ? [0, 0, 0, 0] : [6, 6, 0, 0],
              color: {
                type: 'linear' as const,
                x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: d.color },
                  { offset: 1, color: `${d.color}b3` },
                ],
              },
            },
            data: d.data,
          }
          : {
            name: d.name,
            type: 'line' as const,
            yAxisIndex: 1,
            smooth: true,
            symbol: 'circle' as const,
            symbolSize: 7,
            showSymbol: !isMobile,
            symbolBorderColor: tok.panel,
            symbolBorderWidth: 2,
            itemStyle: { color: d.color },
            lineStyle: { width: 2.4, color: d.color, shadowBlur: 6, shadowColor: `${d.color}44`, shadowOffsetY: 2 },
            areaStyle: {
              color: {
                type: 'linear' as const,
                x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: 'rgba(6,182,212,.16)' },
                  { offset: 1, color: 'rgba(6,182,212,0)' },
                ],
              },
            },
            data: d.data,
          }
      )),
    };
  }, [tok, dayLabels, visibleDefs, axisInterval, isMobile]);

  let body: React.ReactNode;
  if (!n) {
    body = (
      <div className="vb6-empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无签约趋势数据" />
      </div>
    );
  } else if (bars.mode === 'empty') {
    body = (
      <div className="vb6-empty">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span style={{ color: 'var(--text2)', fontSize: 12 }}>请至少选择一种连锁类型</span>}
        />
      </div>
    );
  } else {
    body = (
      <div className="vb6-chart">
        {/* height 传像素值：EChart 的 height 是 number，用 CSS 100% 会失去自适应 */}
        <EChart option={option} height={isMobile ? 230 : 300} style={{ height: '100%' }} />
      </div>
    );
  }

  /** 图例点击 → 切换显隐（至少保留一条） */
  const toggleLegend = (name: string) => {
    setHidden((cur) => {
      if (cur.includes(name)) return cur.filter((x) => x !== name);
      if (seriesDefs.length - cur.length <= 1) return cur;
      return [...cur, name];
    });
  };

  const regionOpts: { key: RegionKey; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'south', label: '南区' },
    { key: 'north', label: '北区' },
  ];

  const barDefs = seriesDefs.filter((d) => d.kind === 'bar');
  const lineDefs = seriesDefs.filter((d) => d.kind === 'line');

  return (
    <>
      <style>{CSS}</style>
      <div className="vb6-card">
        {/* 卡头：标题 + 区域分段控件 */}
        <div className="vb6-h">
          <div className="vb6-title">
            <span className="vb6-dot" />
            <h3>签约趋势</h3>
            <span className="vb6-hint">最近 30 天</span>
          </div>
          <div className="vb6-seg" role="group" aria-label="区域筛选">
            {regionOpts.map((o) => {
              const on = region === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  className={on ? 'on' : undefined}
                  aria-pressed={on}
                  onClick={() => setRegion(o.key)}
                >
                  {o.key !== 'all' && (
                    <span className="sw" style={{ background: REGION_COLORS[o.key === 'south' ? '南区' : '北区'] }} />
                  )}
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 工具栏：连锁类型 + 唯一图例（按柱形/折线分组） */}
        <div className="vb6-bar">
          {typeNames.length > 0 && (
            <>
              <span className="lb">连锁类型</span>
              {typeNames.map((t) => {
                const on = picked.includes(t);
                const c = CHAIN_TYPE_COLORS[t] || 'var(--text3)';
                return (
                  <button
                    key={t}
                    type="button"
                    className={`vb6-chip${on ? ' on' : ''}`}
                    aria-pressed={on}
                    title={t}
                    onClick={() => setPicked((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t]))}
                  >
                    <span className="sw" style={{ background: c }} />
                    {CHAIN_TYPE_SHORT[t] || t}
                  </button>
                );
              })}
              {!allSelected && (
                <button type="button" className="vb6-all" onClick={() => setPicked(typeNames)}>全选</button>
              )}
            </>
          )}

          <div className="vb6-legend" data-legend="sign-trend">
            <span className="lgcap">图例</span>
            {/* R8：柱形=正方形色块，折线=窄长方形；去掉「柱」「线」文字分组标题 */}
            {barDefs.map((d) => {
              const off = hidden.includes(d.name);
              return (
                <span
                  key={d.name}
                  className={`vb6-lg${off ? ' off' : ''}`}
                  role="button"
                  tabIndex={0}
                  title={`点击${off ? '显示' : '隐藏'}「${d.name}」`}
                  onClick={() => toggleLegend(d.name)}
                  onKeyDown={(e) => { if (e.key === 'Enter') toggleLegend(d.name); }}
                >
                  <span className="sw sq" style={{ background: d.color }} />
                  {d.name}
                </span>
              );
            })}
            {lineDefs.map((d) => {
              const off = hidden.includes(d.name);
              return (
                <span
                  key={d.name}
                  className={`vb6-lg${off ? ' off' : ''}`}
                  role="button"
                  tabIndex={0}
                  title={`点击${off ? '显示' : '隐藏'}「${d.name}」`}
                  onClick={() => toggleLegend(d.name)}
                  onKeyDown={(e) => { if (e.key === 'Enter') toggleLegend(d.name); }}
                >
                  <span className="sw ln" style={{ background: d.color }} />
                  {d.name}
                </span>
              );
            })}
          </div>
        </div>

        <div className="vb6-b">{body}</div>
      </div>
    </>
  );
}
