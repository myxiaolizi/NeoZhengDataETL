/**
 * 半圆进度（semiGauge）：echarts 半圆 gauge（startAngle 180 / endAngle 0）+ 下方可选进度条
 * 视觉对齐 pc4.html 的 .semi / .semi-c / .semi-sub / .prog。
 */
import React, { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import EChart from '@/pages/dashboard/EChart';
import { C, EmptyBox, chartNum, chartStr, compactNum, groupByDim, resolveFields, totalOf } from './shared';
import type { WidgetProps } from './shared';

function niceMax(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const n = v / base;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * base;
}

/** 单条进度（pg-top + pg-track + pg-fill） */
function Bar({ label, value, max, unit, green }: { label: string; value: number; max: number; unit?: string; green?: boolean }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const color = green ? 'var(--green, #10b981)' : 'var(--brand, #2563eb)';
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2, #5a7191)', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text, #16253d)', flexShrink: 0 }}>
          {compactNum(value)}
          {unit ? <em style={{ fontStyle: 'normal', color: 'var(--text3, #93a7c2)', fontWeight: 500, fontSize: 11, marginLeft: 4 }}>{unit}</em> : null}
        </span>
      </div>
      <div
        style={{
          height: 9,
          borderRadius: 6,
          background: 'var(--line2, #eaf2fb)',
          overflow: 'hidden',
          boxShadow: 'inset 0 1px 2px rgba(20,52,102,.05)',
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: '100%',
            borderRadius: 6,
            minWidth: percent > 0 ? 3 : 0,
            background: green
              ? 'linear-gradient(90deg, var(--green, #10b981), var(--green2, #34d399))'
              : 'linear-gradient(90deg, var(--brand, #2563eb), var(--brand3, #60a5fa))',
            transition: 'width .7s cubic-bezier(.4,0,.2,1)',
          }}
        />
      </div>
    </div>
  );
}

export default function SemiGaugeWidget({ widget, rows, columns, isMobile, dark }: WidgetProps) {
  const f = resolveFields(widget, rows, columns);
  const unit = chartStr(widget, 'unit', '');
  const label = chartStr(widget, 'centerLabel', '总体完成');
  const hint = chartStr(widget, 'hint', '');
  const value = f.metric ? totalOf(rows, f.metric, widget.agg) : 0;
  const target = chartNum(widget, 'target', 0);
  const max = target > 0 ? target : niceMax(value);
  const showBars = f.dimension && rows.length > 0;

  const bars = useMemo(
    () => (showBars ? groupByDim(rows, f.dimension, [f.metric], widget.agg, { limit: 2, order: 'desc' }) : null),
    [showBars, rows, f.dimension, f.metric, widget.agg]
  );

  if (!f.metric) return <EmptyBox text="没有可用的数值列" height={isMobile ? 96 : 150} />;

  const chartW = isMobile ? 160 : 184;
  const chartH = isMobile ? 84 : 96;
  const gaugeColor = {
    type: 'linear' as const,
    x: 0,
    y: 0,
    x2: 1,
    y2: 0,
    colorStops: [
      { offset: 0, color: C.brand },
      { offset: 1, color: C.brand3 },
    ],
  };

  const option: EChartsOption = {
    series: [
      {
        type: 'gauge',
        min: 0,
        max,
        startAngle: 180,
        endAngle: 0,
        center: ['50%', '86%'],
        radius: '118%',
        progress: { show: true, width: 13, roundCap: true, itemStyle: { color: gaugeColor } },
        axisLine: { roundCap: true, lineStyle: { width: 13, color: [[1, dark ? 'rgba(255,255,255,.10)' : C.line2]] } },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        anchor: { show: false },
        detail: { show: false },
        title: { show: false },
        data: [{ value }],
      },
    ],
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: showBars ? 14 : 2 }}>
        <div style={{ position: 'relative', width: chartW, height: chartH, flexShrink: 0 }}>
          <EChart option={option} height={chartH} style={{ width: chartW }} />
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            <b
              style={{
                fontSize: isMobile ? 23 : 27,
                fontWeight: 750,
                letterSpacing: '-.8px',
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
                display: 'block',
                color: 'var(--text, #16253d)',
              }}
            >
              {compactNum(value)}
              {unit ? (
                <em style={{ fontStyle: 'normal', fontSize: 13, fontWeight: 650, color: 'var(--text3, #93a7c2)', marginLeft: 1 }}>{unit}</em>
              ) : null}
            </b>
            <span style={{ fontSize: 10, color: 'var(--text3, #93a7c2)', fontWeight: 600, marginTop: 2, display: 'block' }}>{label}</span>
          </div>
        </div>
        {hint ? (
          <div style={{ fontSize: 11, color: 'var(--text3, #93a7c2)', fontWeight: 600, marginTop: 9, fontVariantNumeric: 'tabular-nums' }}>
            {hint}
          </div>
        ) : null}
      </div>

      {showBars && bars && bars.cats.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          {bars.cats.map((cat, i) => (
            <Bar key={cat} label={cat} value={bars.series[0]?.[i] ?? 0} max={max} unit={unit} green={i === 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
