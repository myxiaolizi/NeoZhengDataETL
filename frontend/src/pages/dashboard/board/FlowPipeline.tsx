/** 第 2 排：流程状态分布（9 节点流程图）
 *
 * 从左至右：销售签约 → 策略开通 → 实施对接 → 对接审核 → 客服处理
 *          → 客户培训 → 连锁使用 → 策略审核 → 流程结束
 * 每节点显示：连锁数 / 占比 / 门店数 / 平均处理时长
 * 点击节点 → 按岗位汇总 + 明细弹窗
 */
import React, { useMemo, useState } from 'react';
import { Card, Empty, Modal, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RightOutlined } from '@ant-design/icons';
import { BoardData, DetailRow, FlowNodeItem } from '@/api/crm-board';
import { fmtNum, fmtPct } from './theme';

interface Props {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
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

/** 节点配色：流程结束=绿，其它=主色，0 数据=灰 */
function nodeColor(node: FlowNodeItem): { border: string; bg: string; accent: string } {
  if (node.name === '流程结束') {
    return { border: 'rgba(162,215,60,.55)', bg: 'rgba(162,215,60,.10)', accent: '#A2D73C' };
  }
  if (node.clients === 0) {
    return { border: 'var(--border)', bg: 'var(--bg-card-2)', accent: '#B5B5B6' };
  }
  return { border: 'rgba(54,135,255,.55)', bg: 'rgba(54,135,255,.08)', accent: '#3687FF' };
}

export default function FlowPipeline({ data, loading, isMobile }: Props) {
  const [active, setActive] = useState<FlowNodeItem | null>(null);
  const nodes = data.row2.nodes;

  const maxClients = useMemo(
    () => nodes.reduce((m, x) => Math.max(m, x.clients), 0) || 1,
    [nodes],
  );

  return (
    <>
      <Card
        size="small"
        title={<span style={{ fontSize: 13, fontWeight: 700 }}>流程状态分布</span>}
        extra={
          <span style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>
            占比分母已排除「销售签约」「流程结束」
          </span>
        }
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: 'var(--shadow)',
        }}
        styles={{
          header: { background: 'transparent', borderBottom: '1px solid var(--border)', minHeight: 38 },
          body: { padding: isMobile ? 10 : 14 },
        }}
      >
        {nodes.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'stretch',
              gap: 4,
              overflowX: 'auto',
              paddingBottom: 6,
            }}
          >
            {nodes.map((nd, i) => {
              const c = nodeColor(nd);
              const ratio = Math.max(0, Math.min(1, nd.clients / maxClients));
              return (
                <React.Fragment key={nd.key}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setActive(nd)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setActive(nd); }}
                    title={`${nd.name} · 点击查看岗位汇总与明细`}
                    style={{
                      minWidth: isMobile ? 128 : 0,
                      flex: isMobile ? '0 0 128px' : '1 1 0',
                      border: `1px solid ${c.border}`,
                      background: c.bg,
                      borderRadius: 10,
                      padding: '9px 10px',
                      cursor: 'pointer',
                      transition: 'transform .15s ease, box-shadow .15s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 4px 14px rgba(54,135,255,.18)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'none';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12, fontWeight: 700, color: 'var(--text-main)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}
                    >
                      {nd.name}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontSize: 20, fontWeight: 800, color: c.accent, lineHeight: 1.1 }}>
                        {fmtNum(nd.clients)}
                      </span>
                      <span style={{ fontSize: 10.5, color: 'var(--text-mute)' }}>家</span>
                    </div>
                    {/* 迷你占比条 */}
                    <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${ratio * 100}%`, height: '100%',
                          background: c.accent, borderRadius: 2,
                          transition: 'width .3s ease',
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-sub)', whiteSpace: 'nowrap' }}>
                      占比 {fmtPct(nd.ratio, 1)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-mute)', whiteSpace: 'nowrap' }}>
                      门店 {fmtNum(nd.stores)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-mute)', whiteSpace: 'nowrap' }}>
                      均时 {nd.avgDays} 天
                    </div>
                  </div>
                  {i < nodes.length - 1 && (
                    <div
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, color: 'var(--text-mute)', fontSize: 12,
                      }}
                    >
                      <RightOutlined />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </Card>

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
            {/* 按岗位汇总 */}
            <div
              style={{
                display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12,
                padding: '10px 12px', borderRadius: 10,
                background: 'var(--bg-card-2)', border: '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-main)', marginRight: 4 }}>
                按岗位汇总：
              </span>
              {active.byRole.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--text-mute)' }}>无岗位数据</span>
              ) : (
                active.byRole.map((r) => (
                  <Tag
                    key={r.role}
                    style={{
                      marginInlineEnd: 0, fontSize: 12, padding: '2px 10px', borderRadius: 8,
                      borderColor: 'var(--border)', background: 'var(--bg-card)', color: 'var(--text-main)',
                    }}
                  >
                    {r.role} <b style={{ color: 'var(--primary)' }}>{r.count}</b> 家
                  </Tag>
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
