/** 第 3 排左：连锁类型分布
 *
 * 按 全国百强 → 区县百强 → 50+ → 50- 从上至下，
 * 每行显示：连锁数 / 门店数 / 南区连锁数 / 北区连锁数
 */
import React, { useMemo } from 'react';
import { Card, Empty, Progress } from 'antd';
import { BoardData, CHAIN_TYPE_COLORS, REGION_COLORS } from '@/api/crm-board';
import { fmtNum } from './theme';

interface Props {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

export default function TypeSummary({ data, loading, isMobile }: Props) {
  const items = data.row3.typeDistribution;
  const totalClients = useMemo(() => items.reduce((s, x) => s + x.clients, 0), [items]);

  return (
    <Card
      size="small"
      title={<span style={{ fontSize: 13, fontWeight: 700 }}>连锁类型分布</span>}
      extra={<span style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>共 {fmtNum(totalClients)} 家</span>}
      style={{
        height: '100%',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        boxShadow: 'var(--shadow)',
      }}
      styles={{
        header: { background: 'transparent', borderBottom: '1px solid var(--border)', minHeight: 38 },
        body: { padding: 12 },
      }}
    >
      {items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((t) => {
            const color = CHAIN_TYPE_COLORS[t.name] || '#B5B5B6';
            const isInvalid = t.name === '50-';
            const pct = totalClients ? (t.clients / totalClients) * 100 : 0;
            return (
              <div
                key={t.name}
                style={{
                  padding: '8px 10px',
                  borderRadius: 9,
                  border: '1px solid var(--border)',
                  background: isInvalid ? 'var(--bg-card-2)' : 'transparent',
                  opacity: isInvalid ? 0.72 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                      {t.name}
                    </span>
                    {isInvalid && (
                      <span style={{ fontSize: 10, color: 'var(--text-mute)' }}>（无效）</span>
                    )}
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-sub)', whiteSpace: 'nowrap' }}>
                    <b style={{ fontSize: 15, color: 'var(--text-main)' }}>{fmtNum(t.clients)}</b> 户
                  </span>
                </div>

                <div style={{ marginTop: 6 }}>
                  <Progress
                    percent={Number(pct.toFixed(1))}
                    size="small"
                    showInfo={false}
                    strokeColor={color}
                    trailColor="var(--border)"
                    style={{ margin: 0 }}
                  />
                </div>

                <div
                  style={{
                    display: 'flex', justifyContent: 'space-between', gap: 8,
                    marginTop: 4, fontSize: 11.5, color: 'var(--text-mute)',
                  }}
                >
                  <span>门店 {fmtNum(t.stores)}</span>
                  <span style={{ display: 'flex', gap: 10 }}>
                    <span style={{ color: REGION_COLORS['南区'] }}>南 {t.south}</span>
                    <span style={{ color: REGION_COLORS['北区'] }}>北 {t.north}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
