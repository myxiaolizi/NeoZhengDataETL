/** 第 3 排右：3 个排行榜（客户数 / 门店数 / 省份）
 *
 * 每张榜显示前 5，标题栏右上角「更多」→ 弹窗看全部排行。
 * 名称下方用 Tag 标签说明每个连锁类型有多少家。
 */
import React, { useMemo, useState } from 'react';
import { Button, Card, Empty, Modal, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RightOutlined } from '@ant-design/icons';
import { BoardData, CHAIN_TYPE_COLORS, RankItem } from '@/api/crm-board';
import { fmtNum } from './theme';

interface Props {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

/** 前三名奖牌色 */
const MEDAL = ['#FFC000', '#B5B5B6', '#EC673C'];

type Metric = 'clients' | 'stores';

/** 类型标签 */
function TypeTags({ tags }: { tags: RankItem['tags'] }) {
  if (!tags || !tags.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
      {tags.map((t) => (
        <span
          key={t.name}
          style={{
            fontSize: 10, lineHeight: '15px', padding: '0 5px', borderRadius: 7,
            color: CHAIN_TYPE_COLORS[t.name] || '#B5B5B6',
            border: `1px solid ${CHAIN_TYPE_COLORS[t.name] || '#B5B5B6'}`,
            background: 'transparent',
            whiteSpace: 'nowrap',
          }}
        >
          {t.name} {t.count}
        </span>
      ))}
    </div>
  );
}

/** 单个排行卡 */
function RankCard({
  title, items, metric, isMobile, unit,
}: {
  title: string;
  items: RankItem[];
  metric: Metric;
  isMobile: boolean;
  unit: string;
}) {
  const [open, setOpen] = useState(false);
  const top = items.slice(0, 5);
  const max = useMemo(
    () => items.reduce((m, x) => Math.max(m, metric === 'stores' ? x.stores : x.clients), 0) || 1,
    [items, metric],
  );

  const value = (r: RankItem) => (metric === 'stores' ? r.stores : r.clients);

  const allColumns: ColumnsType<RankItem> = [
    {
      title: '排名', dataIndex: 'rank', key: 'rank', width: 64, align: 'center',
      render: (v: number) => (
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: '50%',
            background: v <= 3 ? MEDAL[v - 1] : 'var(--bg-card-2)',
            color: v <= 3 ? '#FFFFFF' : 'var(--text-sub)',
            fontSize: 11.5, fontWeight: 700,
            border: v <= 3 ? 'none' : '1px solid var(--border)',
          }}
        >
          {v}
        </span>
      ),
    },
    {
      title: '名称', dataIndex: 'name', key: 'name',
      render: (v: string, r) => (
        <div>
          <div style={{ fontSize: 12.5, color: 'var(--text-main)', fontWeight: 600 }}>{v}</div>
          <TypeTags tags={r.tags} />
        </div>
      ),
    },
    {
      title: `客户数`, dataIndex: 'clients', key: 'clients', width: 90, align: 'right',
      render: (v: number) => fmtNum(v),
    },
    {
      title: `门店数`, dataIndex: 'stores', key: 'stores', width: 90, align: 'right',
      render: (v: number) => fmtNum(v),
    },
  ];

  return (
    <>
      <Card
        size="small"
        title={<span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>}
        extra={
          <Button
            type="link"
            size="small"
            style={{ padding: 0, fontSize: 11.5, height: 'auto', color: 'var(--primary)' }}
            onClick={() => setOpen(true)}
          >
            更多 <RightOutlined style={{ fontSize: 9 }} />
          </Button>
        }
        style={{
          height: '100%',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: 'var(--shadow)',
        }}
        styles={{
          header: { background: 'transparent', borderBottom: '1px solid var(--border)', minHeight: 38 },
          body: { padding: '10px 12px' },
        }}
      >
        {top.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {top.map((r) => {
              const v = value(r);
              const pct = Math.max(2, Math.min(100, (v / max) * 100));
              return (
                <div key={r.name}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 19, height: 19, borderRadius: '50%', flexShrink: 0,
                        background: r.rank <= 3 ? MEDAL[r.rank - 1] : 'var(--bg-card-2)',
                        color: r.rank <= 3 ? '#FFFFFF' : 'var(--text-sub)',
                        fontSize: 10.5, fontWeight: 700,
                        border: r.rank <= 3 ? 'none' : '1px solid var(--border)',
                      }}
                    >
                      {r.rank}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                        <span
                          style={{
                            fontSize: 12.5, fontWeight: 600, color: 'var(--text-main)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}
                          title={r.name}
                        >
                          {r.name}
                        </span>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-main)', flexShrink: 0 }}>
                          {fmtNum(v)} <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-mute)' }}>{unit}</span>
                        </span>
                      </div>
                      <div style={{ height: 3, borderRadius: 2, background: 'var(--border)', overflow: 'hidden', marginTop: 3 }}>
                        <div
                          style={{
                            width: `${pct}%`, height: '100%', borderRadius: 2,
                            background: r.rank <= 3 ? MEDAL[r.rank - 1] : '#45B4FF',
                          }}
                        />
                      </div>
                      <TypeTags tags={r.tags} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Modal
        title={`${title} · 全部排行（${items.length}）`}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={isMobile ? '94vw' : 680}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        <Table<RankItem>
          size="small"
          rowKey={(r) => `${r.rank}-${r.name}`}
          columns={allColumns}
          dataSource={items}
          pagination={{ pageSize: 20, size: 'small', showSizeChanger: false, showTotal: (t) => `共 ${t} 项` }}
          scroll={{ x: 'max-content' }}
        />
      </Modal>
    </>
  );
}

export default function Rankings({ data, loading, isMobile }: Props) {
  const r3 = data.row3;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))',
        gap: 12,
        alignItems: 'stretch',
        height: '100%',
      }}
    >
      <RankCard title="客户数排行榜" items={r3.salesClientRank} metric="clients" isMobile={isMobile} unit="家" />
      <RankCard title="门店数排行榜" items={r3.salesStoreRank} metric="stores" isMobile={isMobile} unit="店" />
      <RankCard title="省份排行榜" items={r3.provinceRank} metric="clients" isMobile={isMobile} unit="家" />
    </div>
  );
}
