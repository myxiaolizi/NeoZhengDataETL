/** 第 3 排右：3 个排行榜（客户数 / 门店数 / 省份）— V6.0 视觉升级
 *
 * 设计语言对齐参考站 pc4.html：
 *   .rank / .rank-row / .rank-no(名次徽章) / .rank-main / .rank-name / .rank-tags(.tt) / .rank-val
 *   前三名：第1 var(--danger) / 第2 var(--warn) / 第3 #eab308 + 同色 38% 阴影
 *   右上「更多」→ 弹窗看全部排行（行为不变）
 */
import React, { useMemo, useState } from 'react';
import { Empty, Modal, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RightOutlined } from '@ant-design/icons';
import { BoardData, RankItem } from '@/api/crm-board';
import { fmtNum } from './theme';

/** 连锁类型 → 设计令牌（契约 §2.1，禁止自创色值） */
function typeColor(name: string): string {
  const map: Record<string, string> = {
    全国百强: 'var(--brand)',
    区县百强: 'var(--cyan)',
    '50+': 'var(--green)',
    '50-': 'var(--text3)',
  };
  return map[name] || 'var(--text3)';
}

interface Props {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

/* ══════════════ 局部样式（vb4- 前缀） ══════════════ */
const CSS = `
.vb4-grid{display:grid;gap:14px;align-items:stretch;height:100%;min-width:0}
@media(max-width:1100px){.vb4-grid{grid-template-columns:1fr!important}}

.vb4-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;height:100%;min-width:0}
.vb4-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}
.vb4-h{padding:13px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb4-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb4-dot{width:6px;height:6px;border-radius:2px;background:var(--warn);box-shadow:0 0 0 3px color-mix(in srgb,var(--warn) 16%,transparent);flex-shrink:0}
.vb4-more{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:600;color:var(--brand);background:transparent;border:0;cursor:pointer;padding:2px 4px;border-radius:6px;transition:all .15s;white-space:nowrap}
.vb4-more:hover{background:var(--brandSoft)}
.vb4-more svg{font-size:9px}
.vb4-b{padding:12px 14px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}

/* 排行行 */
.vb4-rank{display:flex;flex-direction:column;gap:7px}
.vb4-row{display:grid;grid-template-columns:22px minmax(0,1fr) auto;align-items:center;gap:10px;padding:9px 11px;background:var(--panel2);border:1px solid var(--line);border-radius:var(--radius-sm);transition:all .18s cubic-bezier(.4,0,.2,1);min-width:0}
.vb4-row:hover{border-color:var(--brand3);background:var(--brandSoft);transform:translateX(2px)}
.vb4-no{width:22px;height:22px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1;background:var(--line2);color:var(--text3);letter-spacing:0}
.vb4-no.r1{background:var(--danger);color:#fff;box-shadow:0 2px 7px color-mix(in srgb,var(--danger) 38%,transparent)}
.vb4-no.r2{background:var(--warn);color:#fff;box-shadow:0 2px 7px color-mix(in srgb,var(--warn) 38%,transparent)}
.vb4-no.r3{background:#eab308;color:#fff;box-shadow:0 2px 7px rgba(234,179,8,.38)}
.vb4-no.r45{background:var(--brand);color:#fff;box-shadow:0 2px 7px color-mix(in srgb,var(--brand) 32%,transparent)}
.vb4-main{min-width:0;display:flex;flex-direction:column;gap:5px}
.vb4-name{font-size:12.5px;font-weight:680;color:var(--text);display:flex;align-items:baseline;gap:7px;line-height:1.2;min-width:0}
.vb4-name .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.vb4-name .sub{font-size:10px;color:var(--text3);font-weight:550;font-variant-numeric:tabular-nums;flex-shrink:0}
.vb4-track{height:3px;border-radius:2px;background:var(--line2);overflow:hidden}
.vb4-track i{display:block;height:100%;border-radius:2px;transition:width .5s cubic-bezier(.4,0,.2,1)}
.vb4-val{flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-width:52px;text-align:center}
.vb4-val b{font-size:16px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.5px;color:var(--text);display:block;width:100%;text-align:center}
.vb4-val span{font-size:9px;color:var(--text3);font-weight:600;letter-spacing:.3px;display:block;width:100%;text-align:center}

/* 类型标签 .tt：浅底 + 同色文字 + 左侧色条，数量加粗 */
.vb4-tags{display:flex;gap:5px;flex-wrap:nowrap;overflow:hidden}
.vb4-tags .tt{display:inline-flex;align-items:stretch;overflow:hidden;height:18px;border-radius:6px;white-space:nowrap;background:var(--panel);border:1px solid var(--line);font-size:10px;line-height:1}
.vb4-tags .tt .n{display:flex;align-items:center;padding:0 6px;font-weight:500;color:var(--text2);letter-spacing:.1px}
.vb4-tags .tt .v{display:flex;align-items:center;justify-content:center;min-width:20px;padding:0 5px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.2px;color:#fff}
.vb4-empty{padding:18px 0}
`;

/** 名次徽章类名（1/2/3/4-5/其它） */
function rankCls(no: number): string {
  if (no === 1) return 'r1';
  if (no === 2) return 'r2';
  if (no === 3) return 'r3';
  if (no <= 5) return 'r45';
  return '';
}

/** 名次对应的进度条色 */
function rankBar(no: number): string {
  if (no === 1) return 'var(--danger)';
  if (no === 2) return 'var(--warn)';
  if (no === 3) return '#eab308';
  return 'var(--brand)';
}

/** 类型标签（.tt） */
function TypeTags({ tags }: { tags: RankItem['tags'] }) {
  if (!tags || !tags.length) return null;
  return (
    <div className="vb4-tags">
      {tags.map((t) => {
        const c = typeColor(t.name);
        return (
          <span className="tt" key={t.name} style={{ borderColor: `color-mix(in srgb, ${c} 30%, transparent)` }}>
            <span className="n">{t.name}</span>
            <span className="v" style={{ background: c }}>{t.count}</span>
          </span>
        );
      })}
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
        <span className={`vb4-no ${rankCls(v)}`} style={{ display: 'inline-flex' }}>{v}</span>
      ),
    },
    {
      title: '名称', dataIndex: 'name', key: 'name',
      render: (v: string, r) => (
        <div>
          <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 600 }}>{v}</div>
          <TypeTags tags={r.tags} />
        </div>
      ),
    },
    {
      title: '客户数', dataIndex: 'clients', key: 'clients', width: 90, align: 'right',
      render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>{fmtNum(v)}</span>,
    },
    {
      title: '门店数', dataIndex: 'stores', key: 'stores', width: 90, align: 'right',
      render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>{fmtNum(v)}</span>,
    },
  ];

  return (
    <>
      <div className="vb4-card">
        <div className="vb4-h">
          <h3>
            <span className="vb4-dot" />
            {title}
          </h3>
          <button type="button" className="vb4-more" onClick={() => setOpen(true)}>
            更多 <RightOutlined />
          </button>
        </div>
        <div className="vb4-b">
          {top.length === 0 ? (
            <div className="vb4-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /></div>
          ) : (
            <div className="vb4-rank">
              {top.map((r) => {
                const v = value(r);
                const pct = Math.max(2, Math.min(100, (v / max) * 100));
                return (
                  <div className="vb4-row" key={r.name}>
                    <div className={`vb4-no ${rankCls(r.rank)}`}>{r.rank}</div>
                    <div className="vb4-main">
                      <div className="vb4-name">
                        <span className="nm" title={r.name}>{r.name}</span>
                        <span className="sub">{fmtNum(r.stores)} 门店</span>
                      </div>
                      <div className="vb4-track">
                        <i style={{ width: `${pct}%`, background: rankBar(r.rank) }} />
                      </div>
                      <TypeTags tags={r.tags} />
                    </div>
                    <div className="vb4-val">
                      <b>{fmtNum(v)}</b>
                      <span>{unit}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

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

type Metric = 'clients' | 'stores';

export default function Rankings({ data, loading, isMobile }: Props) {
  const r3 = data.row3;

  /** 移动端单列，桌面三列 */
  const cols = isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))';

  return (
    <>
      <style>{CSS}</style>
      <div className="vb4-grid" style={{ gridTemplateColumns: cols }}>
        <RankCard title="客户数排行榜" items={r3.salesClientRank} metric="clients" isMobile={isMobile} unit="客户" />
        <RankCard title="门店数排行榜" items={r3.salesStoreRank} metric="stores" isMobile={isMobile} unit="门店" />
        <RankCard title="省份排行榜" items={r3.provinceRank} metric="clients" isMobile={isMobile} unit="客户" />
      </div>
    </>
  );
}
