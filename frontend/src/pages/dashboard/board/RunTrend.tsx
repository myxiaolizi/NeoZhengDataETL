/** 第 9 排：客户运行情况趋势（近 30 日）— V6.0 视觉升级
 *
 * 数据与口径不变：data.row9（days / reached / ... / couponRate），双 y 轴折线。
 * 视觉对齐 pc4.html：卡片 16px 圆角 + 方点标题；6 条线用契约新配色
 * ['#3b82f6','#10b981','#06b6d4','#f59e0b','#8b5cf6','#ef4444']；
 * tooltip 背景 var(--panel)、边框 var(--line)、圆角 11px；坐标轴 var(--line)、标签 var(--text3)。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Checkbox, Empty } from 'antd';
import type { EChartsOption } from 'echarts';
import type { BoardData } from '@/api/crm-board';
import EChart from '../EChart';
import { useThemeMode } from './theme';

export interface RunTrendProps {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

type MetricKey = 'reached' | 'runningChains' | 'openedStrategies' | 'runningStrategies' | 'reachRate' | 'couponRate';

interface MetricDef {
  key: MetricKey;
  name: string;
  axis: 0 | 1;
  color: string;
  kind: 'num' | 'pct';
}

/** 契约 §2.1 新配色，按顺序分配 6 条线 */
const SERIES = ['#3b82f6', '#10b981', '#06b6d4', '#f59e0b', '#8b5cf6', '#ef4444'];

const METRICS: MetricDef[] = [
  { key: 'reached', name: '触达人数', axis: 0, color: SERIES[0], kind: 'num' },
  { key: 'runningChains', name: '运行连锁数', axis: 0, color: SERIES[1], kind: 'num' },
  { key: 'openedStrategies', name: '开通策略数', axis: 0, color: SERIES[2], kind: 'num' },
  { key: 'runningStrategies', name: '运行策略数', axis: 0, color: SERIES[3], kind: 'num' },
  { key: 'reachRate', name: '到店率', axis: 1, color: SERIES[4], kind: 'pct' },
  { key: 'couponRate', name: '优惠券核销率', axis: 1, color: SERIES[5], kind: 'pct' },
];

const ALL_KEYS: MetricKey[] = METRICS.map((m) => m.key);

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fitArr(v: unknown, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  if (!Array.isArray(v)) return out;
  for (let i = 0; i < n; i += 1) out[i] = num(v[i]);
  return out;
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

/* ══════════════ 局部样式（vb7- 前缀） ══════════════ */
const CSS = `
.vb7-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;height:100%;min-width:0}
.vb7-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}
.vb7-h{padding:13px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb7-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb7-dot{width:6px;height:6px;border-radius:2px;background:var(--cyan);box-shadow:0 0 0 3px color-mix(in srgb,var(--cyan) 16%,transparent);flex-shrink:0}
.vb7-hint{font-size:11px;color:var(--text3);font-weight:550;white-space:nowrap}
.vb7-b{padding:14px 16px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}

/* 指标多选（参照 pc4 .chip） */
.vb7-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:9px}
.vb7-chips .lb{font-size:11.5px;color:var(--text3);font-weight:600;margin-right:2px;white-space:nowrap}
.vb7-sep{width:1px;height:14px;background:var(--line);display:inline-block;margin:0 2px}
.vb7-chip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:8px;cursor:pointer;user-select:none;border:1px solid var(--line);background:var(--panel2);color:var(--text2);font-size:11.5px;font-weight:550;transition:all .15s;white-space:nowrap}
.vb7-chip:hover{border-color:var(--brand3);color:var(--brand)}
.vb7-chip .sw{width:7px;height:7px;border-radius:2px;flex-shrink:0;transition:all .15s}
.vb7-chip.on{background:linear-gradient(135deg,var(--brand),var(--brand2));border-color:transparent;color:#fff;box-shadow:0 3px 9px color-mix(in srgb,var(--brand) 28%,transparent)}
.vb7-chip.on .sw{background:#fff!important}
.vb7-chip .ax{font-size:9px;opacity:.7;font-weight:600}
.vb7-empty{padding:40px 0;display:flex;align-items:center;justify-content:center}
`;

export default function RunTrend({ data, loading, isMobile }: RunTrendProps) {
  const tok = useTokens();
  const r9 = data?.row9;
  const days = Array.isArray(r9?.days) ? (r9?.days ?? []) : [];
  const n = days.length;

  const [picked, setPicked] = useState<MetricKey[]>(ALL_KEYS);
  // 数据从空变为有值时恢复全选，避免首屏空数据把选择清空后一直空图
  useEffect(() => {
    if (n > 0) setPicked(ALL_KEYS);
  }, [n]);

  const seriesData = useMemo(() => {
    const map = {} as Record<MetricKey, number[]>;
    METRICS.forEach((m) => {
      map[m.key] = fitArr((r9 as unknown as Record<string, unknown> | undefined)?.[m.key], n);
    });
    return map;
  }, [r9, n]);

  const hasAnyValue = useMemo(
    () => METRICS.some((m) => (seriesData[m.key] || []).some((v) => v !== 0)),
    [seriesData],
  );

  const option = useMemo<EChartsOption>(() => {
    const visible = METRICS.filter((m) => picked.includes(m.key));
    return {
      color: visible.map((m) => m.color),
      grid: { left: 4, right: 4, top: isMobile ? 64 : 60, bottom: 2, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: tok.axis, width: 1, type: 'dashed' } },
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
        itemGap: isMobile ? 8 : 12,
        icon: 'roundRect',
        textStyle: { color: tok.axis2, fontSize: 11 },
        type: 'scroll',
        data: visible.map((m) => m.name),
        selectedMode: true,
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: days,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: tok.line } },
        axisLabel: { color: tok.axis, fontSize: 10, interval: isMobile ? 5 : 2 },
      },
      yAxis: [
        {
          type: 'value',
          name: isMobile ? '' : '数量',
          minInterval: 1,
          nameTextStyle: { color: tok.axis, fontSize: 10, padding: [0, 0, 0, 4] },
          axisLabel: { color: tok.axis, fontSize: 10 },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: tok.split, type: 'dashed' } },
        },
        {
          type: 'value',
          name: isMobile ? '' : '比率',
          min: 0,
          max: 1,
          nameTextStyle: { color: tok.axis, fontSize: 10, padding: [0, 4, 0, 0] },
          axisLabel: {
            color: tok.axis,
            fontSize: 10,
            formatter: (v: number) => `${Math.round(Number(v) * 100)}%`,
          },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
        },
      ],
      series: visible.map((m) => ({
        name: m.name,
        type: 'line' as const,
        yAxisIndex: m.axis,
        smooth: true,
        symbol: 'circle' as const,
        symbolSize: 5,
        showSymbol: !isMobile || m.axis === 1,
        lineStyle: { width: 2, color: m.color },
        itemStyle: { color: m.color },
        emphasis: { focus: 'series' as const },
        data: seriesData[m.key],
        tooltip: {
          valueFormatter: (v: unknown) =>
            (m.kind === 'pct' ? `${(num(v) * 100).toFixed(2)}%` : `${num(v).toLocaleString('zh-CN')}`),
        },
      })),
    };
  }, [tok, days, picked, seriesData, isMobile]);

  const height = isMobile ? 260 : 340;

  let body: React.ReactNode;
  if (!n || !hasAnyValue) {
    body = (
      <div className="vb7-empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行趋势数据" />
      </div>
    );
  } else if (!picked.length) {
    body = (
      <div className="vb7-empty" style={{ height }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span style={{ color: 'var(--text2)', fontSize: 12 }}>请至少选择一项指标</span>}
        />
      </div>
    );
  } else {
    body = <EChart option={option} height={height} />;
  }

  const toggle = (k: MetricKey) => {
    setPicked((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="vb7-card">
        <div className="vb7-h">
          <h3>
            <span className="vb7-dot" />
            客户运行情况趋势
          </h3>
          <span className="vb7-hint">近 30 日 · 左轴数量 / 右轴比率</span>
        </div>
        <div className="vb7-b">
          <div className="vb7-chips">
            <Checkbox
              indeterminate={picked.length > 0 && picked.length < ALL_KEYS.length}
              checked={picked.length === ALL_KEYS.length}
              onChange={(e) => setPicked(e.target.checked ? ALL_KEYS : [])}
            >
              <span style={{ fontSize: 11.5, color: 'var(--text2)', fontWeight: 600 }}>全选</span>
            </Checkbox>
            <span className="vb7-sep" />
            {METRICS.map((m) => {
              const on = picked.includes(m.key);
              return (
                <span
                  key={m.key}
                  className={`vb7-chip${on ? ' on' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(m.key)}
                  onKeyDown={(e) => { if (e.key === 'Enter') toggle(m.key); }}
                >
                  <span className="sw" style={{ background: on ? '#fff' : m.color }} />
                  {m.name}
                  {m.axis === 1 && <span className="ax">右轴</span>}
                </span>
              );
            })}
          </div>
          {body}
        </div>
      </div>
    </>
  );
}
