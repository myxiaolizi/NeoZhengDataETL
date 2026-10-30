/**
 * 流程图（flowMap）：横向节点链（节点 → 箭头 → 节点）
 * 视觉对齐 pc4.html 的 .flowmap / .fm-node / .fm-ico / .fm-arrow。
 */
import React, { useMemo } from 'react';
import { SERIES_COLORS, chartNum, chartStr, compactNum, groupByDim, pctOf, resolveFields } from './shared';
import type { WidgetProps } from './shared';

/** 节点之间的连接箭头（渐变线 + 三角） */
function Arrow({ color }: { color: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        width: 34,
        position: 'relative',
        alignSelf: 'stretch',
        minHeight: 70,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 3,
          right: 12,
          top: '50%',
          height: 3,
          borderRadius: 2,
          transform: 'translateY(-50%)',
          background: `linear-gradient(90deg, var(--line, #dde8f6), ${color})`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 4,
          top: '50%',
          width: 0,
          height: 0,
          transform: 'translateY(-50%)',
          borderLeft: `11px solid ${color}`,
          borderTop: '9.5px solid transparent',
          borderBottom: '9.5px solid transparent',
        }}
      />
    </div>
  );
}

export default function FlowMapWidget({ widget, rows, columns, isMobile }: WidgetProps) {
  const f = resolveFields(widget, rows, columns);
  const limit = chartNum(widget, 'limit', 8);
  const unit = chartStr(widget, 'unit', '');
  const showPct = widget.chart?.showPct !== false;

  const grouped = useMemo(
    () =>
      f.metric && f.dimension
        ? groupByDim(rows, f.dimension, [f.metric], widget.agg, { limit, order: 'none' })
        : null,
    [rows, f.metric, f.dimension, widget.agg, limit]
  );

  if (!grouped || !grouped.cats.length) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text3, #93a7c2)', padding: '18px 0', textAlign: 'center' }}>
        {f.metric ? '没有可分组的维度列，无法生成流程链' : '没有可用的数值列'}
      </div>
    );
  }

  const vals = grouped.series[0] || [];
  const total = vals.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

  return (
    <div style={{ overflowX: 'auto', overflowY: 'hidden', width: '100%', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, minWidth: isMobile ? 'max-content' : undefined }}>
        {grouped.cats.map((cat, i) => {
          const v = vals[i] ?? 0;
          const color = SERIES_COLORS[i % SERIES_COLORS.length];
          return (
            <React.Fragment key={cat}>
              {i > 0 ? <Arrow color={color} /> : null}
              <div
                style={{
                  flex: 1,
                  minWidth: 96,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 7,
                  padding: '14px 6px',
                  borderRadius: 11,
                  border: '1px solid transparent',
                  transition: 'all .2s cubic-bezier(.4,0,.2,1)',
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 13,
                    display: 'grid',
                    placeItems: 'center',
                    color: '#fff',
                    flexShrink: 0,
                    background: `linear-gradient(135deg, ${color}, ${color}cc)`,
                    boxShadow: '0 3px 10px rgba(20,52,102,.18), inset 0 1px 0 rgba(255,255,255,.25)',
                    fontSize: 15,
                    fontWeight: 800,
                  }}
                >
                  {cat.slice(0, 1)}
                </div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 750,
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: 1,
                    letterSpacing: '-.4px',
                    color: 'var(--text, #16253d)',
                  }}
                >
                  {compactNum(v)}
                  {unit ? (
                    <em style={{ fontStyle: 'normal', fontSize: 10.5, fontWeight: 600, color: 'var(--text3, #93a7c2)', marginLeft: 2 }}>{unit}</em>
                  ) : null}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text2, #5a7191)',
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '100%',
                  }}
                >
                  {cat}
                </div>
                {showPct ? (
                  <div style={{ fontSize: 10.5, color: 'var(--text3, #93a7c2)', fontVariantNumeric: 'tabular-nums' }}>
                    {pctOf(v, total, 1)}
                  </div>
                ) : null}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
