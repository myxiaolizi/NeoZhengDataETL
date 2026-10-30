/** 数据概览：KPI 卡片 + 近 7 天接收趋势 + 最近推送日志 + 资源速览
 *
 * 数据来源：GET /api/dashboard（stats / trend / recentLogs / projects）
 * 移动端（<768px）：KPI 卡片单列、图表降高、日志列表纵向排列
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Col, Empty, Grid, Result, Row, Skeleton, Space, Tag, Tooltip, Typography,
} from 'antd';
import {
  ApiOutlined, BarChartOutlined, CloudDownloadOutlined, DashboardOutlined, DatabaseOutlined,
  ReloadOutlined, ShareAltOutlined, TableOutlined, RobotOutlined, FileTextOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import Page from '@/components/Page';
import type { StatCardItem } from '@/components/StatCards';
import { useAppStore } from '@/stores/app';
import { fetchDashboard, normalizeTrend } from '@/api/dashboard';
import type { DashboardData, RecentLogItem } from '@/api/dashboard';
import { PALETTE, NEUTRAL } from '@/theme';
import { fmtAgo, fmtNum, fmtTime } from '@/utils';
import EChart from './dashboard/EChart';

const { useBreakpoint } = Grid;
const { Text } = Typography;

/** 把主题色十六进制转成带透明度的 rgba（仅派生自令牌，不写死旧色值） */
function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 结果标签配色（仅用主题语义色） */
function resultTag(result: string) {
  if (result === 'success') return <Tag color={PALETTE.green}>成功</Tag>;
  return <Tag color={PALETTE.red}>{result === 'failed' ? '失败' : result || '异常'}</Tag>;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const d = await fetchDashboard();
      setData(d);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = data?.stats;

  const kpis = useMemo<StatCardItem[]>(() => {
    const s = stats;
    return [
      { key: 'projects', label: '数据项目', value: s?.projects ?? 0, suffix: '个', color: PALETTE.primary, hint: `活跃 ${s?.activeProjects ?? 0}` },
      { key: 'data', label: '数据总量', value: fmtNum(s?.dataTotal ?? 0), color: PALETTE.green, hint: '累计接收记录' },
      { key: 'logs', label: '接收日志', value: fmtNum(s?.logTotal ?? 0), color: PALETTE.cyan, hint: '全部推送次数' },
      { key: 'fields', label: '字段总数', value: s?.fields ?? 0, color: PALETTE.yellow, hint: '已配置字段定义' },
      { key: 'datasets', label: '数据集', value: s?.datasets ?? 0, suffix: '个', color: PALETTE.violet, hint: `报表 ${s?.reports ?? 0} 张` },
      { key: 'users', label: '平台用户', value: s?.users ?? 0, suffix: '人', color: PALETTE.orange, hint: `活跃 ${s?.activeUsers ?? 0}` },
    ];
  }, [stats]);

  /** 趋势数据：后端返回的日期格式不统一，统一归一化后再画图 */
  const trend = useMemo(() => normalizeTrend(data?.trend, 7), [data?.trend]);
  const trendTotal = useMemo(() => trend.reduce((n, p) => n + p.count, 0), [trend]);

  const trendOption = useMemo(() => ({
    color: [PALETTE.primary],
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: NEUTRAL.surface,
      borderColor: NEUTRAL.border,
      textStyle: { color: NEUTRAL.text, fontSize: 12 },
    },
    xAxis: {
      type: 'category' as const,
      data: trend.map((p) => p.date),
      boundaryGap: false,
      axisLine: { lineStyle: { color: NEUTRAL.borderSubtle } },
      axisTick: { show: false },
      axisLabel: { color: NEUTRAL.textTertiary, fontSize: isMobile ? 10 : 11 },
    },
    yAxis: {
      type: 'value' as const,
      minInterval: 1,
      splitLine: { lineStyle: { color: NEUTRAL.borderSubtle, type: 'dashed' as const } },
      axisLabel: { color: NEUTRAL.textTertiary, fontSize: 11 },
    },
    series: [
      {
        name: '接收数据',
        type: 'line' as const,
        smooth: true,
        showSymbol: !isMobile,
        symbolSize: 7,
        lineStyle: { width: 2.4 },
        areaStyle: {
          color: {
            type: 'linear' as const,
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: tint(PALETTE.primary, 0.26) },
              { offset: 1, color: tint(PALETTE.primary, 0.02) },
            ],
          },
        },
        data: trend.map((p) => p.count),
      },
    ],
  }), [trend, isMobile]);

  /** 资源速览：跳转到对应模块 */
  const resources = useMemo(() => ([
    { key: 'datasources', name: '数据源', value: stats?.datasources ?? 0, icon: <DatabaseOutlined />, path: '/datasources', perm: 'datasource:read' },
    { key: 'reports', name: '报表', value: stats?.reports ?? 0, icon: <BarChartOutlined />, path: '/reports', perm: 'report:read' },
    { key: 'datasets', name: '数据集', value: stats?.datasets ?? 0, icon: <TableOutlined />, path: '/datasets', perm: 'dataset:read' },
    { key: 'integrations', name: '集成', value: stats?.integrations ?? 0, icon: <ApiOutlined />, path: '/integrations', perm: 'integration:read' },
    { key: 'shares', name: '分享', value: stats?.shares ?? 0, icon: <ShareAltOutlined />, path: '/shares', perm: 'share:read' },
    { key: 'aiChats', name: 'AI 对话', value: stats?.aiChats ?? 0, icon: <RobotOutlined />, path: '/ai', perm: 'ai:read' },
  ]), [stats]);

  const recentLogs = data?.recentLogs || [];

  if (failed) {
    return (
      <Page title="数据概览">
        <Result
          status="warning"
          title="概览数据加载失败"
          subTitle="请确认后端服务可用后重试"
          extra={<Button type="primary" icon={<ReloadOutlined />} onClick={() => void load()}>重新加载</Button>}
        />
      </Page>
    );
  }

  return (
    <Page
      title="数据概览"
      stats={kpis}
      extra={
        <Button icon={<DashboardOutlined />} onClick={() => navigate('/dashboard/crm')}>
          客户签约看板
        </Button>
      }
    >
      <Row gutter={[12, 12]}>
        {/* ── 趋势图 ── */}
        <Col xs={24} lg={15}>
          <Card
            variant="outlined"
            style={{ borderColor: NEUTRAL.border, borderRadius: 12, height: '100%' }}
            styles={{ body: { padding: isMobile ? 12 : 16 } }}
            title={<span style={{ fontSize: 14, fontWeight: 600, color: NEUTRAL.text }}>近 7 天数据接收趋势</span>}
            extra={
              <Space size={6}>
                <Text type="secondary" style={{ fontSize: 12 }}>合计</Text>
                <Text strong style={{ color: PALETTE.primaryDeep, fontSize: 14 }}>{fmtNum(trendTotal)}</Text>
              </Space>
            }
          >
            {loading && !data ? (
              <Skeleton active paragraph={{ rows: 5 }} />
            ) : (
              <EChart option={trendOption} height={isMobile ? 210 : 288} />
            )}
          </Card>
        </Col>

        {/* ── 资源速览 ── */}
        <Col xs={24} lg={9}>
          <Card
            variant="outlined"
            style={{ borderColor: NEUTRAL.border, borderRadius: 12, height: '100%' }}
            styles={{ body: { padding: isMobile ? 12 : 16 } }}
            title={<span style={{ fontSize: 14, fontWeight: 600, color: NEUTRAL.text }}>资源速览</span>}
          >
            <Row gutter={[8, 8]}>
              {resources.map((r) => (
                <Col key={r.key} xs={12}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(r.path)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(r.path); }}
                    style={{
                      border: `1px solid ${NEUTRAL.border}`, borderRadius: 10, padding: '10px 12px',
                      cursor: 'pointer', minHeight: 44, display: 'flex',
                      alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    }}
                  >
                    <Space size={6} style={{ color: NEUTRAL.textSecondary, fontSize: 12.5, minWidth: 0 }}>
                      <span style={{ color: PALETTE.cyan }}>{r.icon}</span>
                      <span style={{ whiteSpace: 'nowrap' }}>{r.name}</span>
                    </Space>
                    <span style={{ fontSize: 15, fontWeight: 700, color: PALETTE.primaryDeep }}>{fmtNum(r.value)}</span>
                  </div>
                </Col>
              ))}
            </Row>
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${NEUTRAL.borderSubtle}` }}>
              <Space size={6} wrap>
                <Tag color={PALETTE.cyan}>共有 {fmtNum(stats?.projects ?? 0)} 个项目</Tag>
                <Tag color={PALETTE.green}>活跃 {fmtNum(stats?.activeProjects ?? 0)} 个</Tag>
                <Tag color={NEUTRAL.textTertiary}>未分组 {fmtNum(Math.max((stats?.projects ?? 0) - (stats?.activeProjects ?? 0), 0))} 个</Tag>
              </Space>
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        {/* ── 最近推送日志 ── */}
        <Col xs={24} lg={15}>
          <Card
            variant="outlined"
            style={{ borderColor: NEUTRAL.border, borderRadius: 12, height: '100%' }}
            styles={{ body: { padding: isMobile ? 12 : 16 } }}
            title={<span style={{ fontSize: 14, fontWeight: 600, color: NEUTRAL.text }}>最近推送日志</span>}
            extra={<Button type="link" size="small" onClick={() => navigate('/projects')}>全部项目</Button>}
          >
            {loading && !data ? (
              <Skeleton active paragraph={{ rows: 5 }} />
            ) : recentLogs.length ? (
              <div>
                {recentLogs.map((item: RecentLogItem, i) => (
                  <div
                    key={`${item.projectId}-${item.id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/projects/${item.projectId}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/projects/${item.projectId}`); }}
                    style={{
                      padding: isMobile ? '9px 0' : '8px 0',
                      borderTop: i === 0 ? 'none' : `1px solid ${NEUTRAL.borderSubtle}`,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: isMobile ? 'flex-start' : 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      minHeight: 44,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Text strong style={{ color: NEUTRAL.text, fontSize: 13 }}>
                          {item.op_label || item.op}
                        </Text>
                        {resultTag(item.result)}
                        <Text type="secondary" style={{ fontSize: 11.5 }}>{fmtAgo(item.created_at)}</Text>
                      </div>
                      <div
                        style={{
                          fontSize: 12, color: NEUTRAL.textSecondary, marginTop: 2,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                      >
                        {item.projectName} · {item.form_name || '未知表单'}
                        {item.data_id ? ` · ${item.data_id.slice(0, 12)}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无推送日志" />
            )}
          </Card>
        </Col>

        {/* ── 项目快照 ── */}
        <Col xs={24} lg={9}>
          <Card
            variant="outlined"
            style={{ borderColor: NEUTRAL.border, borderRadius: 12, height: '100%' }}
            styles={{ body: { padding: isMobile ? 12 : 16 } }}
            title={<span style={{ fontSize: 14, fontWeight: 600, color: NEUTRAL.text }}>项目快照</span>}
            extra={<Button type="link" size="small" onClick={() => navigate('/projects')}>管理</Button>}
          >
            {loading && !data ? (
              <Skeleton active paragraph={{ rows: 4 }} />
            ) : (data?.projects?.length ? (
              <div>
                {data.projects.map((p, i) => (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/projects/${p.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/projects/${p.id}`); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: isMobile ? '9px 0' : '8px 0',
                      borderTop: i === 0 ? 'none' : `1px solid ${NEUTRAL.borderSubtle}`,
                      cursor: 'pointer', minHeight: 44,
                    }}
                  >
                    <div
                      style={{
                        width: 34, height: 34, borderRadius: 9, flex: '0 0 34px',
                        background: PALETTE.primarySoft, color: PALETTE.primaryDeep,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <FileTextOutlined />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, color: NEUTRAL.text, fontWeight: 500 }}>{p.name}</div>
                      <Tooltip title={p.lastPushAt ? `最后推送：${fmtTime(p.lastPushAt)}` : '暂无推送'}>
                        <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary }}>
                          {p.code ? `${p.code} · ` : ''}
                          {p.lastPushAt ? fmtAgo(p.lastPushAt) : '未接收数据'}
                        </div>
                      </Tooltip>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无项目" />
            ))}
          </Card>
        </Col>
      </Row>

      <div style={{ marginTop: 10, fontSize: 11.5, color: NEUTRAL.textTertiary }}>
        <CloudDownloadOutlined /> 概览数据为实时查询，进入本页或切换标签时自动同步最新状态
      </div>
    </Page>
  );
}