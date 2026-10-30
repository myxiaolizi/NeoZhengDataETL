/** 第 2 排：流程状态分布（9 节点流程图）— V6.0 视觉升级
 *
 * 设计语言对齐参考站 pc4.html：
 *   .flowmap / .fm-node / .fm-arrow（::before 连接线 + ::after 三角箭头）/ .fm-n / .fm-t / .fm-s
 *   有数据 → brand 描边 + 浅底；0 数据 → opacity .55
 *   点击节点 → 岗位汇总 + 明细弹窗（行为不变）
 */
import React, { useMemo, useState } from 'react';
import { Empty, Modal, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { BoardData, DetailRow, FlowNodeItem } from '@/api/crm-board';
import { fmtNum, fmtPct } from './theme';

interface Props {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

/* ══════════════ 局部样式（vb2- 前缀） ══════════════ */
const CSS = `
.vb2-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;min-width:0}
.vb2-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}
.vb2-h{padding:13px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb2-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb2-dot{width:6px;height:6px;border-radius:2px;background:var(--brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 16%,transparent);flex-shrink:0}
.vb2-hint{font-size:11px;color:var(--text3);font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb2-b{padding:14px 16px 12px;flex:1;display:flex;flex-direction:column;justify-content:center;min-width:0}

/* 流程链 */
.vb2-flowmap{display:flex;align-items:stretch;gap:0;padding:4px 0;overflow-x:auto;overflow-y:visible}
.vb2-node{flex:1;position:relative;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:5px;padding:11px 4px 10px;border-radius:var(--radius-sm);transition:all .2s cubic-bezier(.4,0,.2,1);min-width:70px;border:1px solid transparent;background:transparent;text-align:center}
.vb2-node:hover{background:var(--panel2);border-color:var(--line);transform:translateY(-2px)}
.vb2-node.on{background:var(--brandSoft);border-color:var(--brand)}
.vb2-node.dim{opacity:.55}
.vb2-ico{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;color:#fff;flex-shrink:0;position:relative;z-index:2;box-shadow:0 3px 10px rgba(20,52,102,.18),0 1px 0 rgba(255,255,255,.25) inset;transition:transform .2s cubic-bezier(.34,1.4,.64,1);font-size:15px;font-weight:800;line-height:1}
.vb2-node:hover .vb2-ico{transform:scale(1.06)}
.vb2-n{font-size:19px;font-weight:750;font-variant-numeric:tabular-nums;line-height:1;letter-spacing:-.4px;color:var(--text)}
.vb2-n em{font-style:normal;font-size:10px;font-weight:600;color:var(--text3);margin-left:2px}
.vb2-t{font-size:11.5px;font-weight:600;color:var(--text2);text-align:center;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.vb2-s{font-size:10px;color:var(--text3);font-variant-numeric:tabular-nums;white-space:nowrap}
.vb2-bar{width:100%;height:4px;border-radius:2px;background:var(--line2);overflow:hidden;margin-top:1px}
.vb2-bar i{display:block;height:100%;border-radius:2px;transition:width .5s cubic-bezier(.4,0,.2,1)}
.vb2-arrow{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;position:relative;align-self:stretch}
.vb2-arrow::before{content:'';position:absolute;left:1px;right:8px;top:50%;height:3px;border-radius:2px;transform:translateY(-50%);background:linear-gradient(90deg,var(--line),var(--brand3))}
.vb2-arrow::after{content:'';position:absolute;right:1px;top:50%;width:0;height:0;transform:translateY(-50%);border-left:8px solid var(--brand3);border-top:6.5px solid transparent;border-bottom:6.5px solid transparent;filter:drop-shadow(0 1px 2px color-mix(in srgb,var(--brand) 30%,transparent))}
.vb2-empty{padding:14px 0}

/* 弹窗内岗位汇总 */
.vb2-roles{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;padding:10px 12px;border-radius:var(--radius-sm);background:var(--panel2);border:1px solid var(--line)}
.vb2-roles-t{font-size:12.5px;font-weight:700;color:var(--text);margin-right:4px;display:flex;align-items:center;gap:7px}
.vb2-roles-t .d{width:6px;height:6px;border-radius:2px;background:var(--brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 16%,transparent)}
.vb2-rtag{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 10px;border-radius:7px;font-size:12px;background:var(--panel);border:1px solid var(--line);color:var(--text2);white-space:nowrap}
.vb2-rtag b{color:var(--brand);font-weight:750;font-variant-numeric:tabular-nums}
`;

/** 节点配色：流程结束=绿，其它=主色，0 数据=灰 */
function nodeAccent(node: FlowNodeItem): string {
  if (node.name === '流程结束') return 'var(--green)';
  if (node.clients === 0) return 'var(--text3)';
  return 'var(--brand)';
}

/** 节点内图标用首字代替（参考站用 SVG，这里用字形更轻量且不引入新资源） */
function nodeGlyph(name: string, i: number): string {
  if (name === '流程结束') return '✓';
  if (name === '销售签约') return '签';
  return String(i + 1);
}

/** 明细列（第 2 排弹窗专用：状态列在最前） */
const COLUMNS: ColumnsType<DetailRow> = [
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 72,
    fixed: 'left',
    align: 'center',
    render: (v: string) =>
      v === '超期'
        ? <Tag color="error" style={{ marginInlineEnd: 0 }}>超期</Tag>
        : <Tag color="success" style={{ marginInlineEnd: 0 }}>正常</Tag>,
  },
  { title: '区域', dataIndex: 'region', key: 'region', width: 68 },
  { title: '连锁Id', dataIndex: 'chainId', key: 'chainId', width: 92 },
  { title: '连锁名称', dataIndex: 'chainName', key: 'chainName', width: 210, ellipsis: true },
  { title: '连锁类型', dataIndex: 'chainType', key: 'chainType', width: 92 },
  { title: '门店数', dataIndex: 'stores', key: 'stores', width: 78, align: 'right' },
  { title: '处理人', dataIndex: 'owner', key: 'owner', width: 88 },
  { title: '进入当前节点时间', dataIndex: 'enterNodeDate', key: 'enterNodeDate', width: 128, align: 'center' },
  { title: '当前节点时长(天)', dataIndex: 'nodeDays', key: 'nodeDays', width: 128, align: 'right' },
  { title: '提交时间', dataIndex: 'submitDate', key: 'submitDate', width: 96, align: 'center' },
  { title: '连锁总时长(天)', dataIndex: 'totalDays', key: 'totalDays', width: 118, align: 'right' },
];

export default function FlowPipeline({ data, loading, isMobile }: Props) {
  const [active, setActive] = useState<FlowNodeItem | null>(null);
  const nodes = data.row2.nodes;

  const maxClients = useMemo(
    () => nodes.reduce((m, x) => Math.max(m, x.clients), 0) || 1,
    [nodes],
  );

  return (
    <>
      <style>{CSS}</style>

      <div className="vb2-card">
        <div className="vb2-h">
          <h3>
            <span className="vb2-dot" />
            流程状态分布
          </h3>
          <span className="vb2-hint">占比分母已排除「销售签约」「流程结束」</span>
        </div>
        <div className="vb2-b">
          {nodes.length === 0 ? (
            <div className="vb2-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /></div>
          ) : (
            <div className="vb2-flowmap">
              {nodes.map((nd, i) => {
                const accent = nodeAccent(nd);
                const isDim = nd.clients === 0;
                const ratio = Math.max(0, Math.min(1, nd.clients / maxClients));
                return (
                  <React.Fragment key={nd.key}>
                    <div
                      className={`vb2-node${isDim ? ' dim' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setActive(nd)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setActive(nd); }}
                      title={`${nd.name} · 点击查看岗位汇总与明细`}
                    >
                      <div
                        className="vb2-ico"
                        style={{
                          background: nd.name === '流程结束'
                            ? 'linear-gradient(135deg,var(--green),var(--green2,var(--green)))'
                            : isDim
                              ? 'linear-gradient(135deg,var(--text3),color-mix(in srgb,var(--text3) 70%,transparent))'
                              : 'linear-gradient(135deg,var(--brand),var(--brand2))',
                        }}
                      >
                        {nodeGlyph(nd.name, i)}
                      </div>
                      <div className="vb2-n" style={{ color: isDim ? 'var(--text3)' : 'var(--text)' }}>
                        {fmtNum(nd.clients)}<em>家</em>
                      </div>
                      <div className="vb2-t">{nd.name}</div>
                      <div className="vb2-bar">
                        <i style={{ width: `${ratio * 100}%`, background: accent }} />
                      </div>
                      <div className="vb2-s">占比 {fmtPct(nd.ratio, 1)}</div>
                      <div className="vb2-s">{fmtNum(nd.stores)} 门店 · {nd.avgDays} 天</div>
                    </div>
                    {i < nodes.length - 1 && <div className="vb2-arrow" aria-hidden="true" />}
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Modal
        title={`${active?.name || ''} · 明细（${active?.clients ?? 0} 家）`}
        open={!!active}
        onCancel={() => setActive(null)}
        footer={null}
        width={isMobile ? '96vw' : 1180}
        styles={{ body: { maxHeight: '74vh', overflowY: 'auto' } }}
      >
        {active ? (
          <>
            <div className="vb2-roles">
              <span className="vb2-roles-t"><span className="d" />按岗位汇总：</span>
              {active.byRole.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>无岗位数据</span>
              ) : (
                active.byRole.map((r) => (
                  <span className="vb2-rtag" key={r.role}>
                    {r.role} <b>{r.count}</b> 家
                  </span>
                ))
              )}
            </div>

            <Table<DetailRow>
              size="small"
              rowKey={(r) => `${r.chainId}-${r.enterNodeAt}`}
              columns={COLUMNS}
              dataSource={active.rows}
              scroll={{ x: 'max-content' }}
              pagination={{
                pageSize: 10,
                size: 'small',
                showSizeChanger: false,
                showTotal: (t) => `共 ${t} 条`,
              }}
              rowClassName={(r) => (r.status === '超期' ? 'board-row-overdue' : '')}
            />
          </>
        ) : (
          <Empty description="暂无明细" />
        )}
      </Modal>
    </>
  );
}
