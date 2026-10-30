/**
 * 热力矩阵（heatmap）：CSS grid 密度矩阵（行=维度1 / 列=维度2 或指标）
 * 颜色深浅 = 数值强度（品牌色 alpha 梯度），避免额外引入 echarts heatmap 的 visualMap 复杂度。
 */
import React, { useMemo } from 'react';
import { EmptyBox, chartNum, chartStr, compactNum, matrixOf, resolveFields } from './shared';
import type { WidgetProps } from './shared';

/** 品牌色 rgb（= #2563eb），用于 alpha 梯度 */
const BRAND_RGB = '37,99,235';

export default function HeatmapWidget({ widget, rows, columns, isMobile }: WidgetProps) {
  const f = resolveFields(widget, rows, columns);
  const limit = chartNum(widget, 'limit', 8);
  const unit = chartStr(widget, 'unit', '');

  const matrix = useMemo(() => {
    if (!f.dimension || !f.numerics.length) return null;
    const dim2 = f.dimensions[1];
    return matrixOf(rows, f.dimension, dim2, f.metrics.length ? f.metrics : [f.metric], widget.agg, limit);
  }, [rows, f.dimension, f.dimensions, f.metrics, f.metric, f.numerics, widget.agg, limit]);

  if (!matrix || !matrix.rows.length || !matrix.cols.length) {
    return <EmptyBox text={f.dimension ? '没有足够维度生成矩阵' : '缺少维度列'} height={isMobile ? 90 : 140} />;
  }

  const flat = matrix.values.flat();
  const max = Math.max(...flat, 1);
  const min = Math.min(...flat, 0);
  const span = max - min || 1;

  return (
    <div style={{ overflowX: 'auto', width: '100%', minWidth: 0 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `minmax(52px, auto) repeat(${matrix.cols.length}, minmax(46px, 1fr))`,
          gap: 4,
          minWidth: 'max-content',
        }}
      >
        <div />
        {matrix.cols.map((c) => (
          <div
            key={`h_${c}`}
            style={{
              fontSize: 10.5,
              fontWeight: 650,
              color: 'var(--text3, #93a7c2)',
              textAlign: 'center',
              padding: '2px 4px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 96,
            }}
            title={c}
          >
            {c}
          </div>
        ))}
        {matrix.rows.map((r, ri) => (
          <React.Fragment key={`r_${r}`}>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: 'var(--text2, #5a7191)',
                display: 'flex',
                alignItems: 'center',
                paddingRight: 4,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 110,
              }}
              title={r}
            >
              {r}
            </div>
            {matrix.cols.map((c, ci) => {
              const v = matrix.values[ri]?.[ci] ?? 0;
              const alpha = 0.06 + ((v - min) / span) * 0.78;
              const light = alpha < 0.34;
              return (
                <div
                  key={`c_${r}_${c}`}
                  title={`${r} · ${c}：${compactNum(v)}${unit}`}
                  style={{
                    borderRadius: 6,
                    padding: '7px 4px',
                    textAlign: 'center',
                    fontSize: 11,
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    background: `rgba(${BRAND_RGB},${alpha.toFixed(3)})`,
                    color: light ? 'var(--text, #16253d)' : '#fff',
                    border: '1px solid var(--line, #dde8f6)',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {compactNum(v)}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 10.5, color: 'var(--text3, #93a7c2)' }}>
        <span>{compactNum(min)}</span>
        <div
          style={{
            flex: 1,
            height: 6,
            borderRadius: 4,
            background: `linear-gradient(90deg, rgba(${BRAND_RGB},0.06), rgba(${BRAND_RGB},0.84))`,
            minWidth: 40,
            maxWidth: 160,
          }}
        />
        <span>{compactNum(max)}</span>
      </div>
    </div>
  );
}
