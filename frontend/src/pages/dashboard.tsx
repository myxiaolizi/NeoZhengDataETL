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
  FieldStringOutlined, ProjectOutlined, ReloadOutlined, ShareAltOutlined, TableOutlined,
  TeamOutlined, ThunderboltOutlined, RobotOutlined, FileTextOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Page from '@/components/Page';
import { useAppStore } from '@/stores/app';
import { fetchDashboard, normalizeTrend } from '@/api/dashboard';
import type { DashboardData, RecentLogItem } from '@/api/dashboard';
import { fmtAgo, fmtNum, fmtTime } from '@/utils';
import EChart from './dashboard/EChart';

const { useBreakpoint } = Grid;
const { Text } = Typography;

/** 契约规定的 KPI 六色：brand / green / cyan / orange / purple / pink */
const KPI_COLORS: [string, string, string, string, string, string] = [
  '#2D6FE4', '#A2D73C', '#45B4FF', '#FFC000', '#EC673C', '#E86161',
];

interface KpiItem {
  key: string;
  title: string;
  value: number;
  color: string;
  icon: ReactNode;
  hint?: string;
}

/** 结果标签配色（仅用调色板） */
function resultTag(result: string) {
  if (result === 'success') return <Tag color="#A2D73C">成功</Tag>;
  return <Tag color="#E86161">{result === 'failed' ? '失败' : result || '异常'}</Tag>;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const user = useAppStore((s) => s.user);

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

  const kpis = useMemo<KpiItem[]>(() => {
    const s = stats;
    return [
      {
        key: 'projects', title: '数据项目', value: s?.projects ?? 0, color: KPI_COLORS[0],
        icon: <ProjectOutlined />, hint: `活跃 ${s?.activeProjects ?? 0}`,
      },
      {
        key: 'data', title: '数据总量', value: s?.dataTotal ?? 0, color: KPI_COLORS[1],
        icon: <DatabaseOutlined />, hint: '累计接收记录',
      },
      {
        key: 'logs', title: '接收日志', value: s?.logTotal ?? 0, color: KPI_COLORS[2],
        icon: <ThunderboltOutlined />, hint: '全部推送次数',
      },
      {
        key: 'fields', title: '字段总数', value: s?.fields ?? 0, color: KPI_COLORS[3],
        icon: <FieldStringOutlined />, hint: '已配置字段定义',
      },
      {
        key: 'datasets', title: '数据集', value: s?.datasets ?? 0, color: KPI_COLORS[4],
        icon: <TableOutlined />, hint: `报表 ${s?.reports ?? 0} 张`,
      },
      {
        key: 'users', title: '平台用户', value: s?.users ?? 0, color: KPI_COLORS[5],
        icon: <TeamOutlined />, hint: `活跃 ${s?.activeUsers ?? 0}`,
      },
    ];
  }, [stats]);

  /** 趋势数据：后端返回的日期格式不统一，统一归一化后再画图 */
  const trend = useMemo(() => normalizeTrend(data?.trend, 7), [data?.trend]);
  const trendTotal = useMemo(() => trend.reduce((n, p) => n + p.count, 0), [trend]);

  const trendOption = useMemo(() => ({
    color: ['#3687FF'],
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: '#FFFFFF',
      borderColor: '#DCDDDD',
      textStyle: { color: '#003378', fontSize: 12 },
    },
    xAxis: {
      type: 'category' as const,
      data: trend.map((p) => p.date),
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#DCDDDD' } },
      axisTick: { show: false },
      axisLabel: { color: '#B5B5B6', fontSize: isMobile ? 10 : 11 },
    },
    yAxis: {
      type: 'value' as const,
      minInterval: 1,
      splitLine: { lineStyle: { color: '#DCDDDD', type: 'dashed' as const } },
      axisLabel: { color: '#B5B5B6', fontSize: 11 },
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
              { offset: 0, color: 'rgba(54,135,255,.26)' },
              { offset: 1, color: 'rgba(54,135,255,.02)' },
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
      <Page title="数据概览" subTitle="平台运行状态与最近动态">
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
      subTitle={`${user?.displayName || user?.username || '你好'}，欢迎回来 · 平台运行状态与最近动态`}
      extra={
        <Space size={8}>
          <Button icon={<DashboardOutlined />} onClick={() => navigate('/dashboard/crm')}>
            客户签约看板
          </Button>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
            刷新
          </Button>
        </Space>
      }
    >
      {/* ── KPI 卡片：移动端单列 ── */}
      <Row gutter={[12, 12]}>
        {kpis.map((k) => (
          <Col key={k.key} xs={24} sm={12} md={8} xxl={4}>
            <Card
              variant="outlined"
              style={{ borderColor: '#DCDDDD', borderRadius: 12, height: '100%' }}
              styles={{ body: { padding: isMobile ? 14 : 16 } }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 44, height: 44, borderRadius: 12, flex: '0 0 44px',
                    background: `${k.color}1A`, color: k.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                  }}
                >
                  {k.icon}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: 'rgba(0,51,120,.55)', whiteSpace: 'nowrap' }}>
                    {k.title}
                  </div>
                  {loading && !data ? (
                    <Skeleton.Input active size="small" style={{ width: 80, height: 26, marginTop: 4 }} />
                  ) : (
                    <div style={{ fontSize: isMobile ? 22 : 24, fontWeight: 700, color: k.color, lineHeight: 1.3 }}>
                      {fmtNum(k.value)}
                    </div>
                  )}
                  {k.hint && (
                    <div style={{ fontSize: 11.5, color: '#B5B5B6', marginTop: 1 }}>{k.hint}</div>
                  )}
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        {/* ── 趋势图 ── */}
        <Col xs={24} lg={15}>
          <Card
            variant="outlined"
            style={{ borderColor: '#DCDDDD', borderRadius: 12, height: '100%' }}
            styles={{ body: { padding: isMobile ? 12 : 16 } }}
            title={<span style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>近 7 天数据接收趋势</span>}
            extra={
              <Space size={6}>
                <Text type="secondary" style={{ fontSize: 12 }}>合计</Text>
                <Text strong style={{ color: '#2D6FE4', fontSize: 14 }}>{fmtNum(trendTotal)}</Text>
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
            style={{ borderColor: '#DCDDDD', borderRadius: 12, height: '100%' }}
            styles={{ body: { padding: isMobile ? 12 : 16 } }}
            title={<span style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>资源速览</span>}
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
                      border: '1px solid #DCDDDD', borderRadius: 10, padding: '10px 12px',
                      cursor: 'pointer', minHeight: 44, display: 'flex',
                      alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    }}
                  >
                    <Space size={6} style={{ color: 'rgba(0,51,120,.72)', fontSize: 12.5, minWidth: 0 }}>
                      <span style={{ color: '#45B4FF' }}>{r.icon}</span>
                      <span style={{ whiteSpace: 'nowrap' }}>{r.name}</span>
                    </Space>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#2D6FE4' }}>{fmtNum(r.value)}</span>
                  </div>
                </Col>
              ))}
            </Row>
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #DCDDDD' }}>
              <Space size={6} wrap>
                <Tag color="#45B4FF">共有 {fmtNum(stats?.projects ?? 0)} 个项目</Tag>
                <Tag color="#A2D73C">活跃 {fmtNum(stats?.activeProjects ?? 0)} 个</Tag>
                <Tag color="#B5B5B6">未分组 {fmtNum(Math.max((stats?.projects ?? 0) - (stats?.activeProjects ?? 0), 0))} 个</Tag>
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
            style={{ borderColor: '#DCDDDD', borderRadius: 12, height: '100%' }}
            styles={{ body: { padding: isMobile ? 12 : 16 } }}
            title={<span style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>最近推送日志</span>}
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
                      borderTop: i === 0 ? 'none' : '1px solid #DCDDDD',
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
                        <Text strong style={{ color: '#003378', fontSize: 13 }}>
                          {item.op_label || item.op}
                        </Text>
                        {resultTag(item.result)}
                        <Text type="secondary" style={{ fontSize: 11.5 }}>{fmtAgo(item.created_at)}</Text>
                      </div>
                      <div
                        style={{
                          fontSize: 12, color: 'rgba(0,51,120,.6)', marginTop: 2,
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
            style={{ borderColor: '#DCDDDD', borderRadius: 12, height: '100%' }}
            styles={{ body: { padding: isMobile ? 12 : 16 } }}
            title={<span style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>项目快照</span>}
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
                      borderTop: i === 0 ? 'none' : '1px solid #DCDDDD',
                      cursor: 'pointer', minHeight: 44,
                    }}
                  >
                    <div
                      style={{
                        width: 34, height: 34, borderRadius: 9, flex: '0 0 34px',
                        background: 'rgba(54,135,255,.12)', color: '#2D6FE4',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <FileTextOutlined />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, color: '#003378', fontWeight: 500 }}>{p.name}</div>
                      <Tooltip title={p.lastPushAt ? `最后推送：${fmtTime(p.lastPushAt)}` : '暂无推送'}>
                        <div style={{ fontSize: 11.5, color: '#B5B5B6' }}>
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

      <div style={{ marginTop: 10, fontSize: 11.5, color: '#B5B5B6' }}>
        <CloudDownloadOutlined /> 概览数据为实时查询，下拉或点击「刷新」可获取最新状态
      </div>
    </Page>
  );
}
