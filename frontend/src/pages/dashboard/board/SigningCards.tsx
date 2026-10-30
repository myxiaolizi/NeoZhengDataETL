/** 第 1 排：签约卡片区（6 张卡片）
 *
 * 卡1 签约客户总数（圆环图 + 南北区）
 * 卡2 门店总数
 * 卡3 任务完成进度（半圆进度 + 南北区进度条）
 * 卡4 签约类型
 * 卡5 进行中（按岗位分组，点击看明细）
 * 卡6 流程状态
 */
import React, { useMemo, useState } from 'react';
import { Card, Col, Empty, Modal, Progress, Row, Table, Tabs, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { BoardData, DetailRow, REGION_COLORS } from '@/api/crm-board';
import EChart from '../EChart';
import { fmtNum, fmtPct, useChartPalette, tooltipStyle } from './theme';

interface Props {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

/** 统一卡片外壳 */
function BoardCard({
  title, extra, children, height,
}: {
  title: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  height?: number;
}) {
  return (
    <Card
      size="small"
      title={<span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>}
      extra={extra}
      style={{
        height: '100%',
        minHeight: height,
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
      {children}
    </Card>
  );
}

/** 明细表列（进行中 / 通用） */
const DETAIL_COLUMNS: ColumnsType<DetailRow> = [
  { title: '连锁Id', dataIndex: 'chainId', key: 'chainId', width: 92, fixed: 'left' },
  { title: '区域', dataIndex: 'region', key: 'region', width: 70 },
  { title: '连锁名称', dataIndex: 'chainName', key: 'chainName', width: 210, ellipsis: true },
  { title: '连锁类型', dataIndex: 'chainType', key: 'chainType', width: 92 },
  { title: '当前节点', dataIndex: 'node', key: 'node', width: 96 },
  { title: '处理人', dataIndex: 'owner', key: 'owner', width: 88 },
  { title: '进入当前节点时间', dataIndex: 'enterNodeDate', key: 'enterNodeDate', width: 128, align: 'center' },
  { title: '当前节点时长(天)', dataIndex: 'nodeDays', key: 'nodeDays', width: 128, align: 'right' },
  { title: '提交时间', dataIndex: 'submitDate', key: 'submitDate', width: 96, align: 'center' },
  { title: '连锁总时长(天)', dataIndex: 'totalDays', key: 'totalDays', width: 118, align: 'right' },
];

/** 明细表渲染（超期行标红） */
function DetailTableBlock({ rows, isMobile }: { rows: DetailRow[]; isMobile: boolean }) {
  return (
    <Table<DetailRow>
      size="small"
      rowKey={(r) => `${r.chainId}-${r.node}-${r.enterNodeAt}`}
      columns={DETAIL_COLUMNS}
      dataSource={rows}
      scroll={{ x: 'max-content' }}
      pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `共 ${t} 条`, size: 'small' }}
      rowClassName={(r) => (r.status === '超期' ? 'board-row-overdue' : '')}
      style={{ marginTop: 4 }}
    />
  );
}

export default function SigningCards({ data, loading, isMobile }: Props) {
  const palette = useChartPalette();
  const [modal, setModal] = useState<{ title: string; groups: { name: string; count: number; rows: DetailRow[] }[] } | null>(null);

  const r1 = data.row1;

  /* ── 卡1：签约客户总数（圆环） ── */
  const donutOption = useMemo(() => {
    const south = r1.totalClientsByRegion.south;
    const north = r1.totalClientsByRegion.north;
    return {
      color: [REGION_COLORS['南区'], REGION_COLORS['北区']],
      tooltip: { trigger: 'item' as const, ...tooltipStyle(palette) },
      legend: { show: false },
      series: [
        {
          type: 'pie' as const,
          radius: ['62%', '84%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: false,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderColor: palette.isDark ? '#0E2038' : '#FFFFFF', borderWidth: 2 },
          data: [
            { name: '南区', value: south },
            { name: '北区', value: north },
          ],
        },
      ],
    };
  }, [r1.totalClientsByRegion, palette]);

  /* ── 卡3：半圆进度 ── */
  const gaugeOption = useMemo(() => {
    const rate = Math.min(100, Math.max(0, r1.progress.rate));
    const trackColor = palette.isDark ? 'rgba(115,219,255,.16)' : 'rgba(54,135,255,.14)';
    return {
      series: [
        {
          type: 'gauge' as const,
          startAngle: 180,
          endAngle: 0,
          min: 0,
          max: 100,
          center: ['50%', '78%'] as [string, string],
          radius: '116%',
          progress: { show: true, width: 14, itemStyle: { color: '#3687FF' } },
          axisLine: {
            lineStyle: {
              width: 14,
              color: [[1, trackColor]] as [number, string][],
            },
          },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          pointer: { show: false },
          anchor: { show: false },
          title: { show: false },
          detail: { show: false },
          data: [{ value: rate }],
        },
      ],
    };
  }, [r1.progress.rate, palette]);

  const hasInProgress = r1.inProgress.total > 0;

  return (
    <>
      <Row gutter={[12, 12]}>
        {/* 卡1 签约客户总数 */}
        <Col xs={24} sm={12} lg={8} xl={4}>
          <BoardCard title="签约客户总数" height={168}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              <div style={{ position: 'relative', width: isMobile ? 92 : 76, height: isMobile ? 92 : 76, flexShrink: 0 }}>
                <EChart option={donutOption} height={isMobile ? 92 : 76} />
                <div
                  style={{
                    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
                  }}
                >
                  <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.1 }}>
                    {fmtNum(r1.totalClients)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-mute)' }}>家</div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text-sub)', whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: REGION_COLORS['南区'], marginRight: 5 }} />
                  南区 <b style={{ color: 'var(--text-main)' }}>{r1.totalClientsByRegion.south}</b> 家
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-sub)', whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: REGION_COLORS['北区'], marginRight: 5 }} />
                  北区 <b style={{ color: 'var(--text-main)' }}>{r1.totalClientsByRegion.north}</b> 家
                </div>
              </div>
            </div>
          </BoardCard>
        </Col>

        {/* 卡2 门店总数 */}
        <Col xs={24} sm={12} lg={8} xl={4}>
          <BoardCard title="门店总数" height={168}>
            <div style={{ textAlign: 'center', paddingTop: 2 }}>
              <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.15 }}>
                {fmtNum(r1.totalStores)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-mute)', marginBottom: 10 }}>家门店</div>
              <div style={{ display: 'flex', justifyContent: 'space-around', gap: 6 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-sub)' }}>南区门店</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: REGION_COLORS['南区'] }}>
                    {fmtNum(r1.storesByRegion.south)}
                  </div>
                </div>
                <div style={{ width: 1, background: 'var(--border)' }} />
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-sub)' }}>北区门店</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: REGION_COLORS['北区'] }}>
                    {fmtNum(r1.storesByRegion.north)}
                  </div>
                </div>
              </div>
            </div>
          </BoardCard>
        </Col>

        {/* 卡3 任务完成进度 */}
        <Col xs={24} sm={12} lg={8} xl={4}>
          <BoardCard title="任务完成进度" height={168}>
            <div style={{ position: 'relative', height: 84 }}>
              <EChart option={gaugeOption} height={84} />
              <div
                style={{
                  position: 'absolute', left: 0, right: 0, bottom: 6, textAlign: 'center',
                  pointerEvents: 'none',
                }}
              >
                <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.1 }}>
                  {r1.progress.rate.toFixed(1)}%
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-mute)' }}>
                  {r1.progress.achieved} / {r1.progress.target}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 11, color: 'var(--text-sub)', width: 26, flexShrink: 0 }}>南区</span>
                <Progress
                  percent={Math.min(100, r1.progress.south.rate)}
                  size="small"
                  showInfo={false}
                  strokeColor={REGION_COLORS['南区']}
                  trailColor="var(--border)"
                  style={{ flex: 1, margin: 0 }}
                />
                <span style={{ fontSize: 11, color: 'var(--text-main)', width: 38, textAlign: 'right', flexShrink: 0 }}>
                  {r1.progress.south.rate.toFixed(1)}%
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-sub)', width: 26, flexShrink: 0 }}>北区</span>
                <Progress
                  percent={Math.min(100, r1.progress.north.rate)}
                  size="small"
                  showInfo={false}
                  strokeColor={REGION_COLORS['北区']}
                  trailColor="var(--border)"
                  style={{ flex: 1, margin: 0 }}
                />
                <span style={{ fontSize: 11, color: 'var(--text-main)', width: 38, textAlign: 'right', flexShrink: 0 }}>
                  {r1.progress.north.rate.toFixed(1)}%
                </span>
              </div>
            </div>
          </BoardCard>
        </Col>

        {/* 卡4 签约类型 */}
        <Col xs={24} sm={12} lg={8} xl={4}>
          <BoardCard title="签约类型" height={168}>
            {r1.signTypes.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {r1.signTypes.map((t) => (
                  <Tooltip
                    key={t.name}
                    title={
                      <div>
                        {t.byChainType.map((b) => (
                          <div key={b.name}>{b.name}：{b.clients} 户 / {b.stores} 店</div>
                        ))}
                      </div>
                    }
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                        <span
                          style={{
                            fontSize: 12, fontWeight: 600, color: 'var(--text-main)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}
                        >
                          {t.name}
                        </span>
                        <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-main)', flexShrink: 0 }}>
                          {t.clients}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-mute)' }}>
                        {t.stores} 店 · 南 {t.south} / 北 {t.north}
                      </div>
                    </div>
                  </Tooltip>
                ))}
              </div>
            )}
          </BoardCard>
        </Col>

        {/* 卡5 进行中 */}
        <Col xs={24} sm={12} lg={8} xl={4}>
          <BoardCard
            title="进行中"
            extra={<span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-main)' }}>{r1.inProgress.total}</span>}
            height={168}
          >
            {!hasInProgress ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无进行中" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  { key: 'strategy', label: '策略处理中', blk: r1.inProgress.strategy },
                  { key: 'implement', label: '实施处理中', blk: r1.inProgress.implement },
                  { key: 'service', label: '客服处理中', blk: r1.inProgress.service },
                  { key: 'solution', label: '解决方案处理中', blk: r1.inProgress.solution },
                  { key: 'sales', label: '销售处理中', blk: r1.inProgress.sales },
                ].map((it) => (
                  <div
                    key={it.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (!it.blk.groups.length) return;
                      setModal({ title: it.label, groups: it.blk.groups });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && it.blk.groups.length) setModal({ title: it.label, groups: it.blk.groups });
                    }}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '3px 8px', borderRadius: 7,
                      background: 'var(--bg-card-2)',
                      border: '1px solid var(--border)',
                      cursor: it.blk.groups.length ? 'pointer' : 'default',
                      transition: 'background .15s ease',
                    }}
                  >
                    <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>{it.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: it.blk.total ? 'var(--primary)' : 'var(--text-mute)' }}>
                      {it.blk.total}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </BoardCard>
        </Col>

        {/* 卡6 流程状态 */}
        <Col xs={24} sm={12} lg={8} xl={4}>
          <BoardCard title="流程状态" height={168}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 18 }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.2 }}>
                    {fmtNum(r1.flowStatus.completedClients)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-mute)' }}>客户数</div>
                </div>
                <div style={{ width: 1, background: 'var(--border)' }} />
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.2 }}>
                    {fmtNum(r1.flowStatus.completedStores)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-mute)' }}>门店数</div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 8, fontSize: 12 }}>
                <span style={{ color: REGION_COLORS['南区'] }}>南区 {r1.flowStatus.south}</span>
                <span style={{ color: REGION_COLORS['北区'] }}>北区 {r1.flowStatus.north}</span>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-sub)' }}>
                已开通 <b style={{ color: '#A2D73C' }}>{r1.flowStatus.strategyOpened}</b> 家；未开通{' '}
                <b style={{ color: '#E86161' }}>{r1.flowStatus.strategyNotOpened}</b> 家
              </div>
            </div>
          </BoardCard>
        </Col>
      </Row>

      {/* 进行中明细弹窗 */}
      <Modal
        title={`${modal?.title || ''} · 明细（${(modal?.groups || []).reduce((s, g) => s + g.count, 0)} 家）`}
        open={!!modal}
        onCancel={() => setModal(null)}
        footer={null}
        width={isMobile ? '96vw' : 1120}
        styles={{ body: { maxHeight: '72vh', overflowY: 'auto' } }}
      >
        {modal && modal.groups.length > 0 ? (
          modal.groups.length === 1 ? (
            <DetailTableBlock rows={modal.groups[0].rows} isMobile={isMobile} />
          ) : (
            <Tabs
              size="small"
              items={modal.groups.map((g) => ({
                key: g.name,
                label: `${g.name} (${g.count})`,
                children: <DetailTableBlock rows={g.rows} isMobile={isMobile} />,
              }))}
            />
          )
        ) : (
          <Empty description="暂无明细" />
        )}
      </Modal>
    </>
  );
}
