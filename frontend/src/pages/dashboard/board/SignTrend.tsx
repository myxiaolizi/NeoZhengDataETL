/** 第 6 排左：签约趋势（最近 30 天）— V6.0 视觉升级
 *
 * 呈现（行为与口径不变）：
 *  - 堆叠柱形图：签约客户数，南区 var(--brand) / 北区 var(--green)
 *  - 折线：签约门店数（右轴，var(--cyan)）
 *  - 图例下方快捷多选「连锁类型」：只累加选中类型的 south/north
 *
 * 视觉对齐 pc4.html：卡片 16px 圆角 + 方点标题；echarts 用契约新配色
 * ['#3b82f6','#10b981','#06b6d4','#f59e0b','#8b5cf6','#ef4444']，
 * tooltip 背景 var(--panel) / 边框 var(--line) / 圆角 11px，坐标轴 var(--line)/var(--text3)。
 * 注意：echarts 画在 canvas 上，不认 CSS 变量，因此运行时从 .board-root 解析实际色值。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Empty } from 'antd';
import type { EChartsOption } from 'echarts';
import type { BoardData, SignTrendData } from '@/api/crm-board';
import EChart from '../EChart';
import { useThemeMode } from './theme';

/** 契约 §2.1 新配色序列 */
const SERIES = ['#3b82f6', '#10b981', '#06b6d4', '#f59e0b', '#8b5cf6', '#ef4444'];
const C_SOUTH = SERIES[0]; // 南区
const C_NORTH = SERIES[1]; // 北区
const C_STORE = SERIES[2]; // 门店数折线

type Bucket = { south: number[]; north: number[] };

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
      panel2: readVar('--panel2', '#f7faff'),
      text: readVar('--text', '#16253d'),
      text3: readVar('--text3', '#93a7c2'),
      brand: readVar('--brand', '#2563eb'),
      brandSoft: readVar('--brandSoft', '#e9f2ff'),
    };
  }, [mode]);
}

/* ══════════════ 局部样式（vb6- 前缀） ══════════════ */
const CSS = `
.vb6-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;height:100%;min-width:0}
.vb6-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}
.vb6-h{padding:13px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb6-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb6-dot{width:6px;height:6px;border-radius:2px;background:var(--brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 16%,transparent);flex-shrink:0}
.vb6-hint{font-size:11px;color:var(--text3);font-weight:550;white-space:nowrap}
.vb6-b{padding:14px 16px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}

/* 类型多选 chip（参照 pc4 .chip） */
.vb6-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:9px}
.vb6-chips .lb{font-size:11.5px;color:var(--text3);font-weight:600;margin-right:2px;white-space:nowrap}
.vb6-chip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:8px;cursor:pointer;user-select:none;border:1px solid var(--line);background:var(--panel2);color:var(--text2);font-size:11.5px;font-weight:550;transition:all .15s;white-space:nowrap}
.vb6-chip:hover{border-color:var(--brand3);color:var(--brand)}
.vb6-chip .sw{width:7px;height:7px;border-radius:2px;flex-shrink:0;transition:all .15s}
.vb6-chip.on{background:linear-gradient(135deg,var(--brand),var(--brand2));border-color:transparent;color:#fff;box-shadow:0 3px 9px color-mix(in srgb,var(--brand) 28%,transparent)}
.vb6-chip.on .sw{background:#fff!important}
.vb6-all{height:24px;padding:0 9px;border-radius:8px;border:1px dashed var(--line);background:transparent;color:var(--brand);font-size:11.5px;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap}
.vb6-all:hover{background:var(--brandSoft);border-color:var(--brand3)}
.vb6-empty{padding:40px 0;display:flex;align-items:center;justify-content:center}
`;

export default function SignTrend({ data, loading, isMobile }: SignTrendProps) {
  const tok = useTokens();

  const trend = data?.row6?.signTrend as SignTrendData | undefined;
  const days = Array.isArray(trend?.days) ? (trend?.days ?? []) : [];
  const n = days.length;
  const byChainType = (trend?.byChainType || {}) as Record<string, Bucket>;
  const typeNames = useMemo(() => Object.keys(byChainType), [byChainType]);
  const typeKey = typeNames.join('|');

  /** 默认全选；数据刷新（连锁类型集合变化）时重置 */
  const [picked, setPicked] = useState<string[]>(typeNames);
  useEffect(() => {
    setPicked(typeKey ? typeKey.split('|') : []);
  }, [typeKey]);

  const allSelected = typeNames.length > 0 && picked.length === typeNames.length;

  /** 堆叠柱数据：全量 or 选中类型求和 */
  const bars = useMemo(() => {
    if (!n) return { south: [] as number[], north: [] as number[], mode: 'none' as 'none' | 'all' | 'picked' | 'empty' };
    if (!typeNames.length) {
      return { south: fitArr(trend?.south, n), north: fitArr(trend?.north, n), mode: 'all' as const };
    }
    if (!picked.length) return { south: [], north: [], mode: 'empty' as const };
    return { ...sumPicked(byChainType, picked, n), mode: 'picked' as const };
  }, [n, typeNames, picked, byChainType, trend]);

  const stores = useMemo(() => fitArr(trend?.stores, n), [trend, n]);

  const option = useMemo<EChartsOption>(() => ({
    color: [C_SOUTH, C_NORTH, C_STORE],
    grid: { left: 4, right: 4, top: isMobile ? 60 : 56, bottom: 2, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: `color-mix(in srgb, ${tok.brand} 9%, transparent)` } },
      backgroundColor: tok.panel,
      borderColor: tok.line,
      borderWidth: 1,
      textStyle: { color: tok.text, fontSize: 12 },
      extraCssText: 'box-shadow:0 6px 18px rgba(20,52,102,.16);border-radius:11px;padding:8px 10px;',
    },
    legend: {
      top: 0,
      left: 0,
      itemWidth: 10,
      itemHeight: 8,
      itemGap: 14,
      icon: 'roundRect',
      textStyle: { color: tok.axis2, fontSize: 11 },
      data: ['南区', '北区', '门店数'],
    },
    xAxis: {
      type: 'category',
      data: days,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: tok.line } },
      axisLabel: { color: tok.axis, fontSize: 10, interval: isMobile ? 5 : 2 },
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
    series: [
      {
        name: '南区',
        type: 'bar',
        stack: 'clients',
        barMaxWidth: 12,
        emphasis: { focus: 'series' },
        itemStyle: { color: C_SOUTH, borderRadius: [0, 0, 0, 0] },
        data: bars.south,
      },
      {
        name: '北区',
        type: 'bar',
        stack: 'clients',
        barMaxWidth: 12,
        emphasis: { focus: 'series' },
        itemStyle: { color: C_NORTH, borderRadius: [3, 3, 0, 0] },
        data: bars.north,
      },
      {
        name: '门店数',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        showSymbol: !isMobile,
        itemStyle: { color: C_STORE },
        lineStyle: { width: 2, color: C_STORE },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(6,182,212,.18)' },
              { offset: 1, color: 'rgba(6,182,212,0)' },
            ],
          },
        },
        data: stores,
      },
    ],
  }), [tok, days, bars, stores, isMobile]);

  const height = isMobile ? 220 : 300;

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

  return (
    <>
      <style>{CSS}</style>
      <div className="vb6-card">
        <div className="vb6-h">
          <h3>
            <span className="vb6-dot" />
            签约趋势
          </h3>
          <span className="vb6-hint">最近 30 天</span>
        </div>
        <div className="vb6-b">
          {typeNames.length > 0 && (
            <div className="vb6-chips">
              <span className="lb">连锁类型</span>
              {typeNames.map((t) => {
                const on = picked.includes(t);
                return (
                  <span
                    key={t}
                    className={`vb6-chip${on ? ' on' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setPicked((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t]))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setPicked((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t]));
                    }}
                  >
                    <span className="sw" style={{ background: on ? '#fff' : 'var(--brand)' }} />
                    {t}
                  </span>
                );
              })}
              {!allSelected && typeNames.length > 0 && (
                <button type="button" className="vb6-all" onClick={() => setPicked(typeNames)}>全选</button>
              )}
            </div>
          )}
          {body}
        </div>
      </div>
    </>
  );
}
