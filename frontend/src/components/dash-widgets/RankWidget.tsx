/**
 * 排行榜（rank）：前 N 名 + 前三奖牌色 + 名称下方类型标签 + 右侧主数值
 * 视觉对齐 pc4.html 的 .rank / .rank-row / .rank-no / .rank-tags / .rank-val。
 * 奖牌色按契约 §2.2：第 1 名 var(--danger)、第 2 名 #f59e0b、第 3 名 #eab308。
 */
import React, { useMemo } from 'react';
import { C, EmptyBox, MEDAL_COLORS, chartNum, chartStr, compactNum, rankEntries, resolveFields } from './shared';
import type { WidgetProps } from './shared';

/** 标签配色（t1..t4） */
const TAG_STYLES = [
  { bg: C.danger, border: 'color-mix(in srgb, #ef4444 26%, transparent)' },
  { bg: C.warn, border: 'color-mix(in srgb, #f59e0b 26%, transparent)' },
  { bg: C.brand, border: 'color-mix(in srgb, #2563eb 26%, transparent)' },
  { bg: C.slate, border: 'color-mix(in srgb, #94a3b8 30%, transparent)' },
];

function RankNo({ index }: { index: number }) {
  const n = index + 1;
  let bg = 'var(--line2, #eaf2fb)';
  let color = 'var(--text3, #93a7c2)';
  let shadow = 'none';
  if (n <= 3) {
    bg = MEDAL_COLORS[n - 1];
    color = '#fff';
    shadow = `0 2px 7px color-mix(in srgb, ${MEDAL_COLORS[n - 1]} 38%, transparent)`;
  } else if (n <= 5) {
    bg = 'var(--brand, #2563eb)';
    color = '#fff';
    shadow = '0 2px 7px color-mix(in srgb, var(--brand) 32%, transparent)';
  }
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: 9,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 800,
        fontVariantNumeric: 'tabular-nums',
        background: bg,
        color,
        boxShadow: shadow,
        lineHeight: 1,
      }}
    >
      {n}
    </div>
  );
}

export default function RankWidget({ widget, rows, columns, isMobile }: WidgetProps) {
  const f = resolveFields(widget, rows, columns);
  const topN = chartNum(widget, 'topN', 5);
  const unit = chartStr(widget, 'unit', '');
  const valueLabel = chartStr(widget, 'valueLabel', f.metric || '数值');
  const tagFieldRaw = chartStr(widget, 'tagField', '');
  const tagField = tagFieldRaw && f.names.includes(tagFieldRaw) ? tagFieldRaw : undefined;

  const entries = useMemo(
    () => (f.dimension ? rankEntries(rows, f.dimension, f.metric, widget.agg, topN, tagField) : []),
    [rows, f.dimension, f.metric, widget.agg, topN, tagField]
  );

  if (!f.dimension) return <EmptyBox text="没有可用的维度列" height={isMobile ? 90 : 140} />;
  if (!entries.length) return <EmptyBox text="暂无排行数据" height={isMobile ? 90 : 140} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
      {entries.map((e, i) => (
        <div
          key={e.name}
          style={{
            display: 'grid',
            gridTemplateColumns: '26px minmax(0,1fr) auto',
            alignItems: 'center',
            gap: isMobile ? 8 : 12,
            padding: '10px 12px',
            background: 'var(--panel2, #f7faff)',
            border: '1px solid var(--line, #dde8f6)',
            borderRadius: 11,
            minWidth: 0,
          }}
        >
          <RankNo index={i} />
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 680,
                color: 'var(--text, #16253d)',
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                flexWrap: 'wrap',
                lineHeight: 1.2,
                minWidth: 0,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{e.name}</span>
            </div>
            {e.tags.length ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', overflow: 'hidden' }}>
                {e.tags.map((t, ti) => {
                  const s = TAG_STYLES[ti % TAG_STYLES.length];
                  return (
                    <span
                      key={t.name}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'stretch',
                        overflow: 'hidden',
                        height: 20,
                        borderRadius: 6,
                        whiteSpace: 'nowrap',
                        background: 'var(--panel, #fff)',
                        border: `1px solid ${s.border}`,
                        fontSize: 10.5,
                        lineHeight: 1,
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', padding: '0 7px', fontWeight: 500, color: 'var(--text2, #5a7191)' }}>
                        {t.name}
                      </span>
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          minWidth: 22,
                          padding: '0 6px',
                          fontWeight: 800,
                          fontVariantNumeric: 'tabular-nums',
                          background: s.bg,
                          color: '#fff',
                        }}
                      >
                        {t.count}
                      </span>
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div style={{ flexShrink: 0, minWidth: 62, textAlign: 'center' }}>
            <b
              style={{
                fontSize: 18,
                fontWeight: 800,
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '-.6px',
                color: 'var(--text, #16253d)',
                display: 'block',
              }}
            >
              {compactNum(e.value)}
            </b>
            <span style={{ fontSize: 9.5, color: 'var(--text3, #93a7c2)', fontWeight: 600, letterSpacing: '.3px', display: 'block', marginTop: 2 }}>
              {unit || valueLabel}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
