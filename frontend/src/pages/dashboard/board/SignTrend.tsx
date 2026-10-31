/** 第 4 排左：签约趋势（最近 30 天）— V7.1
 *
 * F1（本轮）：**筛选按钮与标题栏同一行，位于标题右侧**。
 *   标题栏内从左到右：`[● 签约趋势] 区域[全部|南区|北区] | 连锁类型[红橙黄灰]  ……  [图例]`
 *   保留 V7 能力：南北筛选在「连锁类型」**前面**，图例在「连锁类型」**后面（最右）**。
 *
 * 其它不变：E2 区域筛选、E1 图例可点击、E8 日期 `MM月DD日`。
 *
 * 配色：南 #2563eb、北 #10b981、类型红橙黄灰 —— 全部从 `@/api/crm-board` 导入（契约 §三）。
 * echarts 画在 canvas 不认 CSS 变量，坐标轴/tooltip 颜色运行时从 .board-root 解析。
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

/** E8：`10/26` / `10-26` / `2026-10-26` → `10月26日`；已是中文格式则原样返回 */
export function dayCn(raw: unknown, idx?: number, daysCn?: unknown): string {
  if (Array.isArray(daysCn) && typeof idx === 'number' && typeof daysCn[idx] === 'string' && daysCn[idx]) {
    return String(daysCn[idx]);
  }
  const s = String(raw ?? '');
  const m = s.match(/(\d{1,2})\s*[/\-月]\s*(\d{1,2})/);
  if (m) return `${Number(m[1])}月${Number(m[2])}日`;
  return s;
}

/** 把选中的连锁类型的 south/north 按日求和（导出以便单测多选聚合） */
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

/* ── 运行时解析 CSS 变量 ── */
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
      axis: readVar('--text3', '#93a7c2'),
      axis2: readVar('--text2', '#5a7191'),
      split: readVar('--line', '#dde8f6'),
      line: readVar('--line', '#dde8f6'),
      panel: readVar('--panel', '#ffffff'),
      text: readVar('--text', '#16253d'),
      brand: readVar('--brand', '#2563eb'),
    };
  }, [mode]);
}

/* ══════════════ 局部样式（vb6- 前缀） ══════════════ */
const CSS = `
.vb6-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;height:100%;min-width:0}
.vb6-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}

/* F1：标题栏一行内 —— 左标题、右筛选+图例。不折行，窄屏时控件区自身横向滚动 */
.vb6-h{padding:9px 14px;border-bottom:1px solid var(--line2);display:flex;align-items:center;gap:8px;flex-shrink:0;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent);flex-wrap:nowrap;min-width:0}
.vb6-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:6px;margin:0;letter-spacing:.2px;white-space:nowrap;flex-shrink:0;line-height:1}
.vb6-dot{width:6px;height:6px;border-radius:2px;background:var(--brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 16%,transparent);flex-shrink:0}
.vb6-hint{font-size:10px;color:var(--text3);font-weight:550;white-space:nowrap}

/* 标题栏右侧控件容器（占满剩余宽度，靠右排布，单行） */
.vb6-hctl{display:flex;align-items:center;gap:5px;flex:1;min-width:0;justify-content:flex-end;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none}
.vb6-hctl::-webkit-scrollbar{height:0;display:none}
.vb6-hctl .grp{display:flex;align-items:center;gap:3px;min-width:0;flex-shrink:0}
.vb6-hctl .lb{font-size:10px;color:var(--text3);font-weight:650;white-space:nowrap}
.vb6-vsep{width:1px;height:13px;background:var(--line);flex-shrink:0;margin:0 1px}

/* 区域筛选（在连锁类型前面） */
.vb6-seg{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:6px;cursor:pointer;user-select:none;border:1px solid var(--line);background:var(--panel2);color:var(--text2);font-size:11px;font-weight:600;transition:all .15s;white-space:nowrap;font-family:inherit;line-height:1}
.vb6-seg:hover{border-color:var(--brand3);color:var(--brand)}
.vb6-seg.on{color:#fff;border-color:transparent;box-shadow:0 3px 9px color-mix(in srgb,var(--brand) 26%,transparent)}
.vb6-seg .sw{width:6px;height:6px;border-radius:2px;margin-right:4px;flex-shrink:0}
.vb6-seg.on .sw{background:#fff!important}

/* 连锁类型 chip */
.vb6-chip{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 7px;border-radius:6px;cursor:pointer;user-select:none;border:1px solid var(--line);background:var(--panel2);color:var(--text2);font-size:10.5px;font-weight:550;transition:all .15s;white-space:nowrap;font-family:inherit;line-height:1}
.vb6-chip:hover{border-color:var(--brand3);color:var(--brand)}
.vb6-chip .sw{width:7px;height:7px;border-radius:2px;flex-shrink:0}
.vb6-chip.on{background:color-mix(in srgb,var(--brand) 9%,var(--panel));border-color:var(--brand3);color:var(--text);font-weight:650}
.vb6-chip:not(.on){opacity:.6}
.vb6-all{height:22px;padding:0 7px;border-radius:6px;border:1px dashed var(--line);background:transparent;color:var(--brand);font-size:10.5px;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap;font-family:inherit;line-height:1}
.vb6-all:hover{background:var(--brandSoft);border-color:var(--brand3)}

/* 图例（在连锁类型后方/最右，可点击切换） */
.vb6-legend{display:flex;align-items:center;gap:8px;margin-left:auto;padding-left:4px;flex-shrink:0;flex-wrap:nowrap}
.vb6-lg{display:inline-flex;align-items:center;gap:4px;cursor:pointer;user-select:none;font-size:10.5px;font-weight:600;color:var(--text2);white-space:nowrap;transition:opacity .15s;line-height:1}
.vb6-lg:hover{color:var(--text)}
.vb6-lg .sw{width:9px;height:9px;border-radius:3px;flex-shrink:0;transition:all .15s}
.vb6-lg .sw.line{width:12px;height:3px;border-radius:2px}
.vb6-lg.off{opacity:.35;text-decoration:line-through}

.vb6-b{padding:12px 16px 14px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}
.vb6-empty{padding:40px 0;display:flex;align-items:center;justify-content:center}
`;

export default function SignTrend({ data, loading, isMobile }: SignTrendProps) {
  const tok = useTokens();

  const trend = data?.row6?.signTrend as TrendLoose | undefined;
  const rawDays = Array.isArray(trend?.days) ? (trend?.days ?? []) : [];
  const n = rawDays.length;
  /** E8：统一 MM月DD日 */
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
  /** 图例点击可临时隐藏某条序列 */
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
    return {
      color: visibleDefs.map((d) => d.color),
      grid: { left: 4, right: 6, top: 12, bottom: 2, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: `color-mix(in srgb, ${tok.brand} 9%, transparent)` } },
        backgroundColor: tok.panel,
        borderColor: tok.line,
        borderWidth: 1,
        textStyle: { color: tok.text, fontSize: 12 },
        extraCssText: 'box-shadow:0 6px 18px rgba(20,52,102,.16);border-radius:11px;padding:8px 10px;',
      },
      legend: { show: false },
      xAxis: {
        type: 'category',
        data: dayLabels,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: tok.line } },
        axisLabel: { color: tok.axis, fontSize: 10, interval: axisInterval, hideOverlap: true },
      },
      yAxis: [
        {
          type: 'value',
          name: isMobile ? '' : '客户数',
          minInterval: 1,
          nameTextStyle: { color: tok.axis, fontSize: 10, padding: [0, 0, 0, 4] },
          axisLabel: { color: tok.axis, fontSize: 10 },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: tok.split, type: 'dashed' } },
        },
        {
          type: 'value',
          name: isMobile ? '' : '门店数',
          minInterval: 1,
          nameTextStyle: { color: tok.axis, fontSize: 10, padding: [0, 4, 0, 0] },
          axisLabel: { color: tok.axis, fontSize: 10 },
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
            // 仅一根柱时不堆叠，否则按区域堆叠
            stack: barsVisible.length > 1 ? 'clients' : undefined,
            barMaxWidth: barsVisible.length > 1 ? 13 : 20,
            emphasis: { focus: 'series' as const },
            itemStyle: { color: d.color, borderRadius: [3, 3, 0, 0] },
            data: d.data,
          }
          : {
            name: d.name,
            type: 'line' as const,
            yAxisIndex: 1,
            smooth: true,
            symbol: 'circle' as const,
            symbolSize: 5,
            showSymbol: !isMobile,
            itemStyle: { color: d.color },
            lineStyle: { width: 2, color: d.color },
            areaStyle: {
              color: {
                type: 'linear' as const,
                x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: 'rgba(6,182,212,.18)' },
                  { offset: 1, color: 'rgba(6,182,212,0)' },
                ],
              },
            },
            data: d.data,
          }
      )),
    };
  }, [tok, dayLabels, visibleDefs, axisInterval, isMobile]);

  const height = isMobile ? 230 : 300;

  let body: React.ReactNode;
  if (!n) {
    body = (
      <div className="vb6-empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无签约趋势数据" />
      </div>
    );
  } else if (bars.mode === 'empty') {
    body = (
      <div className="vb6-empty" style={{ height }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span style={{ color: 'var(--text2)', fontSize: 12 }}>请至少选择一种连锁类型</span>}
        />
      </div>
    );
  } else {
    body = <EChart option={option} height={height} />;
  }

  /** 图例点击 → 切换显隐（至少保留一条） */
  const toggleLegend = (name: string) => {
    setHidden((cur) => {
      if (cur.includes(name)) return cur.filter((x) => x !== name);
      if (seriesDefs.length - cur.length <= 1) return cur; // 不允许全部隐藏
      return [...cur, name];
    });
  };

  const regionOpts: { key: RegionKey; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'south', label: '南区' },
    { key: 'north', label: '北区' },
  ];
  const regionGrad = (k: RegionKey) => (
    k === 'south'
      ? `linear-gradient(135deg,${REGION_COLORS['南区']},#3b82f6)`
      : k === 'north'
        ? `linear-gradient(135deg,${REGION_COLORS['北区']},#34d399)`
        : 'linear-gradient(135deg,var(--brand),var(--brand2))'
  );

  return (
    <>
      <style>{CSS}</style>
      <div className="vb6-card">
        {/* F1：标题栏一行 —— 左标题，右「区域 → 连锁类型 → 图例」 */}
        <div className="vb6-h">
          <h3>
            <span className="vb6-dot" />
            签约趋势
            <span className="vb6-hint">最近 30 天</span>
          </h3>

          <div className="vb6-hctl">
            <div className="grp">
              <span className="lb">区域</span>
              {regionOpts.map((o) => {
                const on = region === o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    className={`vb6-seg${on ? ' on' : ''}`}
                    style={on ? { background: regionGrad(o.key) } : undefined}
                    aria-pressed={on}
                    onClick={() => setRegion(o.key)}
                  >
                    {o.key !== 'all' && (
                      <span className="sw" style={{ background: on ? '#fff' : REGION_COLORS[o.label] }} />
                    )}
                    {o.label}
                  </button>
                );
              })}
            </div>

            {typeNames.length > 0 && (
              <>
                <span className="vb6-vsep" />
                <div className="grp">
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
                </div>
              </>
            )}

            {/* 图例在连锁类型后方（最右） */}
            <div className="vb6-legend">
              {seriesDefs.map((d) => {
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
                    <span
                      className={`sw${d.kind === 'line' ? ' line' : ''}`}
                      style={{ background: d.color }}
                    />
                    {d.name}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        <div className="vb6-b">{body}</div>
      </div>
    </>
  );
}
