/**
 * 圆环图（donut）：echarts 圆环 + 中心总数 + 右侧图例
 * 视觉对齐 pc4.html 的 .donut / .donut-c / .legend。
 */
import React, { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import EChart from '@/pages/dashboard/EChart';
import { C, EmptyBox, SERIES_COLORS, chartNum, chartStr, compactNum, groupByDim, resolveFields, subTextColor } from './shared';
import type { WidgetProps } from './shared';

const DONUT_SIZE = 132;

export default function DonutWidget({ widget, rows, columns, isMobile, dark }: WidgetProps) {
  const f = resolveFields(widget, rows, columns);
  const limit = chartNum(widget, 'limit', 6);
  const grouped = useMemo(
    () => (f.metric && f.dimension ? groupByDim(rows, f.dimension, [f.metric], widget.agg, { limit, order: 'desc' }) : null),
    [rows, f.metric, f.dimension, widget.agg, limit]
  );

  if (!f.metric) return <EmptyBox text="没有可用的数值列" height={isMobile ? 96 : 150} />;

  const cats = grouped?.cats || [];
  const vals = grouped?.series[0] || [];
  const total = vals.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const unit = chartStr(widget, 'countLabel', '');
  const centerLabel = chartStr(widget, 'centerLabel', '总数');
  const size = isMobile ? 112 : DONUT_SIZE;

  const option: EChartsOption = {
    color: SERIES_COLORS,
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    series: [
      {
        type: 'pie',
        radius: ['64%', '88%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        emphasis: { scale: true, scaleSize: 4, itemStyle: { shadowBlur: 12, shadowColor: 'rgba(37,99,235,.28)' } },
        itemStyle: { borderColor: dark ? '#101d33' : C.panel, borderWidth: 2 },
        data: cats.map((name, i) => ({ name, value: vals[i] ?? 0 })),
      },
    ],
  };

  if (!cats.length) return <EmptyBox text="没有可分组的数据" height={isMobile ? 96 : 150} />;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: isMobile ? 12 : 18,
        flexWrap: 'wrap',
        minWidth: 0,
      }}
    >
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <EChart option={option} height={size} style={{ width: size }} />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <b
            style={{
              fontSize: isMobile ? 21 : 24,
              fontWeight: 750,
              letterSpacing: '-.6px',
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--text, #16253d)',
            }}
          >
            {compactNum(total)}
          </b>
          <span style={{ fontSize: 10.5, color: 'var(--text3, #93a7c2)', marginTop: 3, fontWeight: 600 }}>{centerLabel}</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 11, minWidth: 0, flex: '1 1 120px' }}>
        {cats.map((name, i) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                flexShrink: 0,
                background: SERIES_COLORS[i % SERIES_COLORS.length],
              }}
            />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11.5,
                  color: 'var(--text2, #5a7191)',
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {name}
              </div>
              <div style={{ fontSize: 16, fontWeight: 750, fontVariantNumeric: 'tabular-nums', lineHeight: 1.15, color: 'var(--text, #16253d)' }}>
                {compactNum(vals[i] ?? 0)}
                {unit ? (
                  <em style={{ fontStyle: 'normal', fontSize: 11, fontWeight: 600, color: subTextColor(dark), marginLeft: 3 }}>{unit}</em>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
