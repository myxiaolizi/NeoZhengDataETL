/**
 * 进度条组（progress）：横向进度条列表（分类 + 数值 + 进度条）
 * 视觉对齐 pc4.html 的 .typelist / .tl-row / .tl-bar。
 */
import React, { useMemo } from 'react';
import { EmptyBox, chartNum, chartStr, compactNum, groupByDim, pctOf, resolveFields, SERIES_COLORS } from './shared';
import type { WidgetProps } from './shared';

export default function ProgressWidget({ widget, rows, columns, isMobile }: WidgetProps) {
  const f = resolveFields(widget, rows, columns);
  const limit = chartNum(widget, 'limit', 5);
  const unit = chartStr(widget, 'unit', '');
  const target = chartNum(widget, 'target', 0);

  const grouped = useMemo(
    () => (f.metric && f.dimension ? groupByDim(rows, f.dimension, [f.metric], widget.agg, { limit, order: 'desc' }) : null),
    [rows, f.metric, f.dimension, widget.agg, limit]
  );

  if (!f.metric || !grouped || !grouped.cats.length) {
    return <EmptyBox text={f.metric ? '没有可分组的维度列' : '没有可用的数值列'} height={isMobile ? 90 : 130} />;
  }

  const vals = grouped.series[0] || [];
  const max = target > 0 ? target : Math.max(...vals, 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0 }}>
      {grouped.cats.map((cat, i) => {
        const v = vals[i] ?? 0;
        const percent = max > 0 ? Math.min(100, Math.max(0, (v / max) * 100)) : 0;
        const color = SERIES_COLORS[i % SERIES_COLORS.length];
        return (
          <div
            key={cat}
            style={{
              padding: '11px 13px',
              borderRadius: 11,
              background: 'var(--panel2, #f7faff)',
              border: '1px solid var(--line, #dde8f6)',
              minWidth: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
              <span style={{ fontSize: 12.5, fontWeight: 650, display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text, #16253d)', minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: 3, flexShrink: 0, background: color }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat}</span>
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text2, #5a7191)', flexShrink: 0 }}>
                {compactNum(v)}
                {unit ? <em style={{ fontStyle: 'normal', fontSize: 10.5, fontWeight: 600, color: 'var(--text3, #93a7c2)', marginLeft: 3 }}>{unit}</em> : null}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 4, background: 'var(--line2, #eaf2fb)', overflow: 'hidden', marginBottom: 7 }}>
              <div
                style={{
                  width: `${percent}%`,
                  height: '100%',
                  borderRadius: 4,
                  minWidth: percent > 0 ? 3 : 0,
                  background: color,
                  transition: 'width .5s cubic-bezier(.4,0,.2,1)',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 14, fontSize: 11, fontWeight: 600, color: 'var(--text3, #93a7c2)' }}>
              <span>{pctOf(v, max, 1)}</span>
              <span>{grouped.counts[i] ?? 0} 条记录</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
