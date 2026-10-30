/** 客户签约看板（CRM）
 *
 * 报表中心的内置看板（不进左侧菜单，入口在「报表中心 → 系统内置看板」）。
 * 数据来源：GET /api/crm/dashboard?projectId=（后端从项目解析数据表聚合）
 * 移动端（<768px）：KPI 两列、图表单列、明细改卡片列表
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Col, Empty, Grid, Input, Progress, Result, Row, Select, Space, Table, Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ArrowLeftOutlined, ReloadOutlined, SearchOutlined, ShopOutlined, TeamOutlined, TrophyOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import Page from '@/components/Page';
import { CHART_COLORS, fetchCrmDashboard } from '@/api/dashboard';
import type { CrmDashboardData, CrmDetailRow } from '@/api/dashboard';
import { fetchProjects } from '@/api/projects';
import type { ProjectRow } from '@/api/projects';
import { fmtNum, fmtTime } from '@/utils';
import EChart from './EChart';

const { useBreakpoint } = Grid;
const { Text } = Typography;

/** 明细列（后端聚合后固定输出这些中文键） */
const DETAIL_FIELDS = [
  '连锁名称', '连锁类型', '区域', '销售', '客服', '培训人', '门店数', '流程状态',
  '签约时间', '服务开始', '服务结束', '业务对接人', '业务电话', '技术对接人',
  '技术电话', '对接结果', '提交人', '提交时间',
] as const;

const FILTER_KEYS = ['区域', '连锁类型', '销售', '流程状态'] as const;
type FilterKey = typeof FILTER_KEYS[number];

export default function CrmDashboardPage() {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const navigate = useNavigate();

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [data, setData] = useState<CrmDashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [keyword, setKeyword] = useState('');
  const [filters, setFilters] = useState<Record<FilterKey, string>>({
    区域: '', 连锁类型: '', 销售: '', 流程状态: '',
  });
  const [page, setPage] = useState(1);
  const pageSize = isMobile ? 8 : 15;

  /* ── 项目下拉：默认选中 CRM 项目（code=crm 或名称含 CRM） ── */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await fetchProjects();
        if (!alive) return;
        setProjects(list);
        const preferred =
          list.find((p) => String(p.code || '').toLowerCase() === 'crm') ||
          list.find((p) => /crm/i.test(p.name)) ||
          list.find((p) => p.id === 16);
        setProjectId((cur) => cur ?? (preferred ? preferred.id : (list[0]?.id ?? 16)));
      } catch {
        if (alive) setProjectId((cur) => cur ?? 16);
      }
    })();
    return () => { alive = false; };
  }, []);

  const load = useCallback(async (pid: number) => {
    setLoading(true);
    setError('');
    try {
      const d = await fetchCrmDashboard(pid);
      setData(d);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : '看板数据加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, load]);

  const kpi = data?.kpi;
  const detail = data?.detail || [];

  /* ── 明细筛选（后端一次返回全量聚合明细，前端过滤 + 分页） ── */
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return detail.filter((row) => {
      if (kw) {
        const hit = DETAIL_FIELDS.some((k) => String(row[k] ?? '').toLowerCase().includes(kw));
        if (!hit) return false;
      }
      return FILTER_KEYS.every((k) => !filters[k] || String(row[k] ?? '') === filters[k]);
    });
  }, [detail, keyword, filters]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  useEffect(() => { setPage(1); }, [keyword, filters]);

  /* ── 图表 option ── */
  const trendOption = useMemo(() => ({
    color: ['#3687FF', '#FFC000'],
    grid: { left: 8, right: 12, top: 30, bottom: 6, containLabel: true },
    tooltip: { trigger: 'axis' as const, backgroundColor: '#FFFFFF', borderColor: 'rgba(54,135,255,.28)', textStyle: { color: '#003378', fontSize: 12 } },
    legend: { top: 0, right: 0, textStyle: { color: '#B5B5B6', fontSize: 11 }, itemWidth: 10, itemHeight: 8 },
    xAxis: {
      type: 'category' as const,
      data: (data?.trend || []).map((t) => t.label),
      axisLine: { lineStyle: { color: '#DCDDDD' } },
      axisTick: { show: false },
      axisLabel: { color: '#B5B5B6', fontSize: 11 },
    },
    yAxis: {
      type: 'value' as const,
      minInterval: 1,
      splitLine: { lineStyle: { color: '#DCDDDD', type: 'dashed' as const } },
      axisLabel: { color: '#B5B5B6', fontSize: 11 },
    },
    series: [
      { name: '签约数', type: 'bar' as const, barWidth: 16, itemStyle: { borderRadius: [4, 4, 0, 0] }, data: (data?.trend || []).map((t) => t.count) },
      { name: '门店数', type: 'line' as const, smooth: true, symbolSize: 6, data: (data?.trend || []).map((t) => t.stores) },
    ],
  }), [data?.trend]);

  const regionOption = useMemo(() => ({
    color: CHART_COLORS as unknown as string[],
    grid: { left: 8, right: 12, top: 16, bottom: 6, containLabel: true },
    tooltip: { trigger: 'axis' as const, backgroundColor: '#FFFFFF', borderColor: 'rgba(54,135,255,.28)', textStyle: { color: '#003378', fontSize: 12 } },
    xAxis: {
      type: 'category' as const,
      data: (data?.byRegion || []).map((r) => r.name),
      axisLine: { lineStyle: { color: '#DCDDDD' } },
      axisTick: { show: false },
      axisLabel: { color: '#B5B5B6', fontSize: 11 },
    },
    yAxis: {
      type: 'value' as const,
      minInterval: 1,
      splitLine: { lineStyle: { color: '#DCDDDD', type: 'dashed' as const } },
      axisLabel: { color: '#B5B5B6', fontSize: 11 },
    },
    series: [{
      name: '签约数', type: 'bar' as const, barWidth: 20,
      itemStyle: { borderRadius: [4, 4, 0, 0] },
      data: (data?.byRegion || []).map((r) => r.count),
      label: { show: true, position: 'top' as const, color: '#003378', fontSize: 11 },
    }],
  }), [data?.byRegion]);

  const stateOption = useMemo(() => ({
    color: CHART_COLORS as unknown as string[],
    tooltip: { trigger: 'item' as const, backgroundColor: '#FFFFFF', borderColor: 'rgba(54,135,255,.28)', textStyle: { color: '#003378', fontSize: 12 } },
    legend: { bottom: 0, textStyle: { color: '#B5B5B6', fontSize: 11 }, itemWidth: 10, itemHeight: 8 },
    series: [{
      type: 'pie' as const,
      radius: ['48%', '70%'],
      center: ['50%', '44%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: '#FFFFFF', borderWidth: 2 },
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 14, fontWeight: 600, color: '#003378' } },
      data: (data?.byFlowState || []).map((s) => ({ name: s.name, value: s.value })),
    }],
  }), [data?.byFlowState]);

  const typeOption = useMemo(() => ({
    color: CHART_COLORS as unknown as string[],
    grid: { left: 8, right: 12, top: 16, bottom: 6, containLabel: true },
    tooltip: { trigger: 'axis' as const, backgroundColor: '#FFFFFF', borderColor: 'rgba(54,135,255,.28)', textStyle: { color: '#003378', fontSize: 12 } },
    xAxis: {
      type: 'category' as const,
      data: (data?.byType || []).map((t) => t.name),
      axisLine: { lineStyle: { color: '#DCDDDD' } },
      axisTick: { show: false },
      axisLabel: { color: '#B5B5B6', fontSize: 11 },
    },
    yAxis: {
      type: 'value' as const,
      minInterval: 1,
      splitLine: { lineStyle: { color: '#DCDDDD', type: 'dashed' as const } },
      axisLabel: { color: '#B5B5B6', fontSize: 11 },
    },
    series: [{
      name: '签约数', type: 'bar' as const, barWidth: 20,
      itemStyle: { borderRadius: [4, 4, 0, 0], color: '#45B4FF' },
      data: (data?.byType || []).map((t) => t.count),
      label: { show: true, position: 'top' as const, color: '#003378', fontSize: 11 },
    }],
  }), [data?.byType]);

  const rankOption = useMemo(() => {
    const list = (data?.salesRank || []).slice(0, 10).slice().reverse();
    return {
      color: ['#2D6FE4'],
      grid: { left: 8, right: 30, top: 10, bottom: 6, containLabel: true },
      tooltip: { trigger: 'axis' as const, backgroundColor: '#FFFFFF', borderColor: 'rgba(54,135,255,.28)', textStyle: { color: '#003378', fontSize: 12 } },
      xAxis: {
        type: 'value' as const,
        minInterval: 1,
        splitLine: { lineStyle: { color: '#DCDDDD', type: 'dashed' as const } },
        axisLabel: { color: '#B5B5B6', fontSize: 11 },
      },
      yAxis: {
        type: 'category' as const,
        data: list.map((s) => s.name),
        axisLine: { lineStyle: { color: '#DCDDDD' } },
        axisTick: { show: false },
        axisLabel: { color: '#003378', fontSize: 11 },
      },
      series: [{
        type: 'bar' as const,
        barWidth: 14,
        itemStyle: { borderRadius: [0, 4, 4, 0] },
        data: list.map((s) => s.count),
        label: { show: true, position: 'right' as const, color: '#003378', fontSize: 11 },
      }],
    };
  }, [data?.salesRank]);

  /* ── 明细表格列 ── */
  const columns = useMemo<ColumnsType<CrmDetailRow>>(() => {
    const cols: ColumnsType<CrmDetailRow> = DETAIL_FIELDS.map((k) => ({
      title: k,
      dataIndex: k,
      key: k,
      width: k === '连锁名称' ? 200 : k === '签约时间' || k === '服务开始' || k === '服务结束' || k === '提交时间' ? 118 : 100,
      ellipsis: true,
      render: (v: unknown) => {
        if (k === '门店数') return <span style={{ fontWeight: 600, color: '#2D6FE4' }}>{fmtNum(Number(v) || 0)}</span>;
        if (k === '流程状态') {
          const s = String(v || '');
          const color = s === '已完成' ? '#A2D73C' : s === '进行中' ? '#FFC000' : '#B5B5B6';
          return <Tag color={color}>{s || '未知'}</Tag>;
        }
        if (k === '签约时间' || k === '服务开始' || k === '服务结束' || k === '提交时间') {
          return <span>{v ? fmtTime(String(v), 'YYYY-MM-DD') : '-'}</span>;
        }
        return <span>{String(v ?? '') || '-'}</span>;
      },
    }));
    return cols;
  }, []);

  const kpiCards = [
    { key: 'total', title: '签约总数', value: kpi?.total ?? 0, unit: '家', color: CHART_COLORS[2], icon: <TrophyOutlined /> },
    { key: 'stores', title: '门店总数', value: kpi?.totalStores ?? 0, unit: '家', color: CHART_COLORS[0], icon: <ShopOutlined /> },
    { key: 'progress', title: '进行中', value: kpi?.inProgress ?? 0, unit: '家', color: CHART_COLORS[1], icon: <ReloadOutlined /> },
    { key: 'done', title: '已完成', value: kpi?.done ?? 0, unit: '家', color: CHART_COLORS[3], icon: <TeamOutlined /> },
  ];

  const selectable = (key: FilterKey) => {
    if (!data) return [] as { label: string; value: string }[];
    if (key === '区域') return data.options.regions.map((v) => ({ label: v, value: v }));
    if (key === '连锁类型') return data.options.types.map((v) => ({ label: v, value: v }));
    if (key === '销售') return data.options.sales.map((v) => ({ label: v, value: v }));
    return data.options.states.map((v) => ({ label: v, value: v }));
  };

  if (error && !loading) {
    return (
      <Page
        title="客户签约看板"
        subTitle="报表中心 · 系统内置看板"
        extra={
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reports')}>
            返回报表中心
          </Button>
        }
      >
        <Result
          status="warning"
          title="看板数据加载失败"
          subTitle={error}
          extra={[
            <Button key="retry" type="primary" icon={<ReloadOutlined />} onClick={() => projectId && void load(projectId)}>
              重新加载
            </Button>,
            <Button key="back" onClick={() => setProjectId(16)}>使用默认项目</Button>,
          ]}
        />
      </Page>
    );
  }

  return (
    <Page
      title="客户签约看板"
      subTitle={`报表中心 · 数据项目：${data?.project?.name || '-'} · 更新于 ${data?.updatedAt ? fmtTime(data.updatedAt) : '-'}`}
      extra={
        <Space size={8} wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reports')}>
            返回报表中心
          </Button>
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: isMobile ? 180 : 240 }}
            size={isMobile ? 'large' : 'middle'}
            value={projectId ?? undefined}
            loading={!projects.length}
            onChange={(v: number) => setProjectId(v)}
            options={projects.map((p) => ({ label: `${p.name}${p.code ? ` (${p.code})` : ''}`, value: p.id }))}
            placeholder="选择数据项目"
          />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => projectId && void load(projectId)}>
            刷新
          </Button>
        </Space>
      }
    >
      {/* ── KPI ── */}
      <Row gutter={[12, 12]}>
        {kpiCards.map((k) => (
          <Col key={k.key} xs={12} md={6}>
            <Card
              variant="outlined"
              style={{ borderColor: 'rgba(54,135,255,.28)', borderRadius: 12, height: '100%' }}
              styles={{ body: { padding: isMobile ? 12 : 16 } }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: isMobile ? 34 : 40, height: isMobile ? 34 : 40, borderRadius: 10,
                    flex: `0 0 ${isMobile ? 34 : 40}px`, background: `${k.color}1A`, color: k.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: isMobile ? 16 : 18,
                  }}
                >
                  {k.icon}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'rgba(0,51,120,.55)' }}>{k.title}</div>
                  <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 700, color: k.color, lineHeight: 1.25 }}>
                    {fmtNum(k.value)}
                    <span style={{ fontSize: 11, fontWeight: 400, color: '#B5B5B6', marginLeft: 3 }}>{k.unit}</span>
                  </div>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* ── 目标进度 + 状态 + 区域 ── */}
      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} lg={7}>
          <Card
            variant="outlined"
            style={{ borderColor: 'rgba(54,135,255,.28)', borderRadius: 12, height: '100%' }}
            styles={{ body: { padding: isMobile ? 14 : 16 } }}
            title={<span style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>年度目标进度</span>}
          >
            <div style={{ textAlign: 'center' }}>
              <Progress
                type="dashboard"
                percent={Math.min(kpi?.completion ?? 0, 100)}
                strokeColor="#3687FF"
                railColor="#DCDDDD"
                size={isMobile ? 148 : 172}
                format={(p) => (
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#003378' }}>{p}%</div>
                    <div style={{ fontSize: 11.5, color: '#B5B5B6' }}>目标完成率</div>
                  </div>
                )}
              />
              <div style={{ marginTop: 8, fontSize: 12.5, color: 'rgba(0,51,120,.65)' }}>
                已签约 <Text strong style={{ color: '#2D6FE4' }}>{fmtNum(kpi?.total ?? 0)}</Text> / 目标{' '}
                <Text strong style={{ color: '#EC673C' }}>{fmtNum(kpi?.target ?? 0)}</Text> 家
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: '#B5B5B6' }}>
                覆盖 {fmtNum(kpi?.regions ?? 0)} 个区域 · {fmtNum(kpi?.salesCount ?? 0)} 位销售
              </div>
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Card
            variant="outlined"
            style={{ borderColor: 'rgba(54,135,255,.28)', borderRadius: 12, height: '100%' }}
            styles={{ body: { padding: isMobile ? 12 : 16 } }}
            title={<span style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>流程状态分布</span>}
          >
            {data?.byFlowState?.length ? (
              <EChart option={stateOption} height={isMobile ? 220 : 250} />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" style={{ padding: '40px 0' }} />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card
            variant="outlined"
            style={{ borderColor: 'rgba(54,135,255,.28)', borderRadius: 12, height: '100%' }}
            styles={{ body: { padding: isMobile ? 12 : 16 } }}
            title={<span style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>区域签约分布</span>}
          >
            {data?.byRegion?.length ? (
              <EChart option={regionOption} height={isMobile ? 220 : 250} />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" style={{ padding: '40px 0' }} />
            )}
          </Card>
        </Col>
      </Row>

      {/* ── 趋势 + 排行 + 类型 ── */}
      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} lg={10}>
          <Card
            variant="outlined"
            style={{ borderColor: 'rgba(54,135,255,.28)', borderRadius: 12, height: '100%' }}
            styles={{ body: { padding: isMobile ? 12 : 16 } }}
            title={<span style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>签约趋势（按月）</span>}
          >
            {data?.trend?.length ? (
              <EChart option={trendOption} height={isMobile ? 210 : 240} />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" style={{ padding: '40px 0' }} />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={7}>
          <Card
            variant="outlined"
            style={{ borderColor: 'rgba(54,135,255,.28)', borderRadius: 12, height: '100%' }}
            styles={{ body: { padding: isMobile ? 12 : 16 } }}
            title={<span style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>销售排行 Top10</span>}
          >
            {data?.salesRank?.length ? (
              <EChart option={rankOption} height={isMobile ? 210 : 240} />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" style={{ padding: '40px 0' }} />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={7}>
          <Card
            variant="outlined"
            style={{ borderColor: 'rgba(54,135,255,.28)', borderRadius: 12, height: '100%' }}
            styles={{ body: { padding: isMobile ? 12 : 16 } }}
            title={<span style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>连锁类型分布</span>}
          >
            {data?.byType?.length ? (
              <EChart option={typeOption} height={isMobile ? 210 : 240} />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" style={{ padding: '40px 0' }} />
            )}
          </Card>
        </Col>
      </Row>

      {/* ── 明细 ── */}
      <Card
        variant="outlined"
        style={{ borderColor: 'rgba(54,135,255,.28)', borderRadius: 12, marginTop: 12 }}
        styles={{ body: { padding: isMobile ? 12 : 16 } }}
        title={<span style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>签约明细</span>}
        extra={<Text type="secondary" style={{ fontSize: 12 }}>共 {fmtNum(filtered.length)} 条</Text>}
      >
        <Space size={8} wrap style={{ marginBottom: 12 }}>
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: '#B5B5B6' }} />}
            placeholder="搜索连锁名称 / 销售 / 电话"
            style={{ width: isMobile ? '100%' : 260 }}
            size={isMobile ? 'large' : 'middle'}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          {FILTER_KEYS.map((k) => (
            <Select
              key={k}
              allowClear
              placeholder={k}
              style={{ width: isMobile ? 'calc(50% - 4px)' : 130 }}
              size={isMobile ? 'large' : 'middle'}
              value={filters[k] || undefined}
              options={selectable(k)}
              onChange={(v?: string) => setFilters((f) => ({ ...f, [k]: v || '' }))}
            />
          ))}
          {(keyword || FILTER_KEYS.some((k) => filters[k])) && (
            <Button
              size={isMobile ? 'large' : 'middle'}
              onClick={() => { setKeyword(''); setFilters({ 区域: '', 连锁类型: '', 销售: '', 流程状态: '' }); }}
            >
              重置
            </Button>
          )}
        </Space>

        {isMobile ? (
          <div>
            {paged.length ? paged.map((row, i) => (
              <Card
                key={`${String(row['连锁名称'])}-${i}`}
                size="small"
                variant="outlined"
                style={{ borderColor: 'rgba(54,135,255,.28)', borderRadius: 10, marginBottom: 8 }}
                styles={{ body: { padding: 12 } }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#003378', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {String(row['连锁名称'] || '未命名')}
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(0,51,120,.6)', marginTop: 2 }}>
                      {String(row['区域'] || '-')} · {String(row['连锁类型'] || '-')} · 门店 {fmtNum(Number(row['门店数']) || 0)}
                    </div>
                  </div>
                  <Tag color={String(row['流程状态']) === '已完成' ? '#A2D73C' : String(row['流程状态']) === '进行中' ? '#FFC000' : '#B5B5B6'}>
                    {String(row['流程状态'] || '未知')}
                  </Tag>
                </div>
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px', fontSize: 12 }}>
                  <span><Text type="secondary">销售</Text> {String(row['销售'] || '-')}</span>
                  <span><Text type="secondary">客服</Text> {String(row['客服'] || '-')}</span>
                  <span><Text type="secondary">签约</Text> {row['签约时间'] ? fmtTime(String(row['签约时间']), 'YYYY-MM-DD') : '-'}</span>
                  <span><Text type="secondary">对接</Text> {String(row['对接结果'] || '-')}</span>
                </div>
              </Card>
            )) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合条件的签约记录" />
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                第 {page} / {Math.max(Math.ceil(filtered.length / pageSize), 1)} 页
              </Text>
              <Space>
                <Button size="middle" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</Button>
                <Button size="middle" disabled={page >= Math.ceil(filtered.length / pageSize)} onClick={() => setPage((p) => p + 1)}>下一页</Button>
              </Space>
            </div>
          </div>
        ) : (
          <Table<CrmDetailRow>
            rowKey={(_, i) => String(i)}
            size="small"
            loading={loading}
            columns={columns}
            dataSource={paged}
            scroll={{ x: 'max-content' }}
            pagination={{
              current: page,
              pageSize,
              total: filtered.length,
              showSizeChanger: false,
              showTotal: (t) => `共 ${t} 条`,
              onChange: (p) => setPage(p),
            }}
          />
        )}
      </Card>
    </Page>
  );
}
