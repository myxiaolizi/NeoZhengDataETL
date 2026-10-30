/**
 * 指标卡（kpi）：大数字 + 下方可选「南北区拆分」或「多指标行」
 * 严格对齐 pc4.html 的 .bignum / .split / .sp 视觉。
 */
import React from 'react';
import { DOT_COLORS, EmptyBox, chartBool, chartStr, compactNum, dotOf, groupByDim, resolveFields, totalOf } from './shared';
import type { WidgetProps } from './shared';

/** 拆分小卡（南区/北区那种） */
function SplitBox({ label, value, unit, tone }: { label: string; value: number; unit?: string; tone: 'brand' | 'green' }) {
  const color = tone === 'brand' ? 'var(--brand, #2563eb)' : 'var(--green, #10b981)';
  const bg =
    tone === 'brand'
      ? 'linear-gradient(180deg, color-mix(in srgb, var(--brand) 8%, transparent), color-mix(in srgb, var(--brand) 4%, transparent))'
      : 'linear-gradient(180deg, color-mix(in srgb, var(--green) 8%, transparent), color-mix(in srgb, var(--green) 4%, transparent))';
  return (
    <div
      style={{
        borderRadius: 11,
        padding: 12,
        textAlign: 'center',
        background: bg,
        border: `1px solid color-mix(in srgb, ${color} 24%, transparent)`,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 650,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
          marginBottom: 4,
          color,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 750, fontVariantNumeric: 'tabular-nums', lineHeight: 1.15, color: 'var(--text, #16253d)' }}>
        {compactNum(value)}
        {unit ? <em style={{ fontStyle: 'normal', fontSize: 10.5, fontWeight: 600, color: 'var(--text3, #93a7c2)', marginLeft: 2 }}>{unit}</em> : null}
      </div>
    </div>
  );
}

export default function KpiWidget({ widget, rows, columns, isMobile }: WidgetProps) {
  const f = resolveFields(widget, rows, columns);
  if (!f.metric) return <EmptyBox text="没有可用的数值列" height={isMobile ? 96 : 132} />;

  const unit = chartStr(widget, 'unit', '');
  const caption = chartStr(widget, 'caption', '');
  const color = DOT_COLORS[dotOf(widget)] || 'var(--brand, #2563eb)';
  const value = totalOf(rows, f.metric, widget.agg);
  const extraMetrics = f.metrics.filter((m) => m !== f.metric).slice(0, 2);
  const wantSplit = chartBool(widget, 'split', true);

  const split =
    wantSplit && !extraMetrics.length && f.dimension && rows.length
      ? groupByDim(rows, f.dimension, [f.metric], widget.agg, { limit: 2, order: 'desc' })
      : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ textAlign: 'center', padding: '2px 0' }}>
        <b
          style={{
            fontSize: isMobile ? 32 : 42,
            fontWeight: 750,
            letterSpacing: '-1.6px',
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
            display: 'block',
            color,
          }}
        >
          {compactNum(value)}
          {unit ? (
            <em style={{ fontStyle: 'normal', fontSize: isMobile ? 12 : 14, fontWeight: 650, color: 'var(--text3, #93a7c2)', marginLeft: 3 }}>
              {unit}
            </em>
          ) : null}
        </b>
        <span
          style={{
            fontSize: 11.5,
            color: 'var(--text3, #93a7c2)',
            fontWeight: 600,
            marginTop: 6,
            display: 'block',
            letterSpacing: '.2px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {caption || `${f.metric} · 全量合计`}
        </span>
      </div>

      {extraMetrics.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {extraMetrics.map((m, i) => (
            <div
              key={m}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 9,
                background: 'var(--panel2, #f7faff)',
                border: '1px solid var(--line, #dde8f6)',
                fontSize: 12,
                color: 'var(--text2, #5a7191)',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</span>
              <b style={{ fontVariantNumeric: 'tabular-nums', color: i === 0 ? 'var(--brand, #2563eb)' : 'var(--green, #10b981)', fontWeight: 750 }}>
                {compactNum(totalOf(rows, m, widget.agg))}
              </b>
            </div>
          ))}
        </div>
      ) : null}

      {split && split.cats.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: split.cats.length > 1 ? '1fr 1fr' : '1fr', gap: 10, marginTop: 3 }}>
          {split.cats.map((cat, i) => (
            <SplitBox
              key={cat}
              label={cat}
              value={split.series[0]?.[i] ?? 0}
              unit={unit}
              tone={i === 0 ? 'brand' : 'green'}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
