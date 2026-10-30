/**
 * 报表查看（大屏风格）
 * - 深色渐变 Hero：报表标题、编码、KPI、工具条（刷新 / 自动刷新 / 导出 / 分享 / 全屏）
 * - 图表主体 + 数据明细表；移动端单列，图表与表格自适应
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Grid,
  Row,
  Skeleton,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  EditOutlined,
  FullscreenOutlined,
  ReloadOutlined,
  ShareAltOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import Chart from '@/components/Chart';
import { useAppStore } from '@/stores/app';
import { copyText, fmtAgo, fmtNum, fmtTime } from '@/utils';
import {
  buildChartOption,
  createShare,
  getDataset,
  getReport,
  pickTableColumns,
  reportExportUrl,
  runReport,
  shareUrlOf,
  type DatasetColumn,
  type ReportConfig,
  type ReportItem,
  type RowData,
} from '@/api/reports';

const { useBreakpoint } = Grid;

export default function ReportView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { can } = useAppStore();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const canWrite = can('report:write');
  const canShare = can(['share:write', 'share:read']);

  const [report, setReport] = useState<ReportItem | null>(null);
  const [rows, setRows] = useState<RowData[]>([]);
  const [columns, setColumns] = useState<DatasetColumn[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [runErr, setRunErr] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setRunErr('');
      try {
        const rep = await getReport(String(id));
        setReport(rep);
        if (!rep.datasetId) {
          setRows([]);
          setColumns([]);
          setRowCount(0);
          setUpdatedAt(new Date().toISOString());
          return;
        }
        // GET /api/reports/:id 不含 datasetName，需要单独取数据集名称
        let datasetName = rep.datasetName;
        if (!datasetName) {
          try {
            const ds = await getDataset(rep.datasetId);
            datasetName = ds?.name;
          } catch {
            /* 数据集不可用时忽略，仍展示报表本身 */
          }
        }
        try {
          const data = await runReport(String(id), 2000);
          setRows(data.rows || []);
          setColumns(data.columns || []);
          setRowCount(data.rowCount || (data.rows || []).length);
          setReport({ ...rep, ...(data.report || {}), datasetName });
        } catch (e) {
          setReport({ ...rep, datasetName });
          setRows([]);
          setColumns([]);
          setRowCount(0);
          setRunErr(e instanceof Error ? e.message : '报表取数失败');
        }
        setUpdatedAt(new Date().toISOString());
      } catch (e) {
        setRunErr(e instanceof Error ? e.message : '报表加载失败');
      } finally {
        setLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    load();
  }, [load]);

  /* 自动刷新（60s） */
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => load(true), 60000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, load]);

  const config: ReportConfig = (report?.config || {}) as ReportConfig;
  const built = useMemo(() => buildChartOption(rows, config, { limit: 60, tall: true }), [rows, config]);
  const chartHeight = isMobile ? 260 : Math.max(320, Math.min(Number(config.height) || 400, 560));

  const tableColumns = useMemo(() => {
    if (!rows.length) return [];
    return pickTableColumns(rows, columns, isMobile ? 6 : 14).map((c) => ({
      title: c,
      dataIndex: c,
      key: c,
      ellipsis: true,
      width: 140,
      render: (v: unknown) => {
        if (v === null || v === undefined) return <span style={{ color: '#B5B5B6' }}>-</span>;
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return <span title={s}>{s}</span>;
      },
    }));
  }, [rows, columns, isMobile]);

  const handleExport = () => {
    if (!report) return;
    window.open(reportExportUrl(report.id), '_blank');
  };

  const handleShare = async () => {
    if (!report) return;
    try {
      const share = await createShare({ targetType: 'report', targetId: report.id, expiresDays: 7, title: report.name });
      const ok = await copyText(shareUrlOf(share));
      message.success(ok ? '分享链接已复制（7 天有效）' : '分享已创建，请到分享管理复制链接');
    } catch {
      /* client 已提示 */
    }
  };

  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    } else {
      el.requestFullscreen?.().catch(() => message.info('当前浏览器不支持全屏'));
    }
  };

  const kpis = [
    { label: '数据行数', value: rowCount, color: '#45B4FF' },
    { label: '字段数', value: columns.length, color: '#FFC000' },
    { label: '浏览次数', value: report?.viewCount || 0, color: '#A2D73C' },
  ];

  if (loading && !report) {
    return (
      <Card style={{ border: '1px solid #DCDDDD', borderRadius: 12 }}>
        <Skeleton active paragraph={{ rows: 10 }} />
      </Card>
    );
  }

  if (!report) {
    return (
      <Alert
        type="error"
        showIcon
        message="报表加载失败"
        description={runErr || '报表不存在，或当前账号没有查看权限'}
        action={
          <Button size="small" onClick={() => navigate('/reports')}>
            返回报表中心
          </Button>
        }
      />
    );
  }

  return (
    <div ref={wrapRef} style={{ margin: isMobile ? -12 : -20, background: '#FFFFFF', minHeight: '100%' }}>
      {/* ── 大屏 Hero ── */}
      <div
        style={{
          background: 'linear-gradient(135deg, #003378 0%, #2D6FE4 58%, #3687FF 100%)',
          color: '#FFFFFF',
          padding: isMobile ? '14px 14px 18px' : '20px 24px 24px',
          borderRadius: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'stretch' : 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <Space size={8} wrap style={{ marginBottom: 6 }}>
              <Button
                size="small"
                type="text"
                icon={<ArrowLeftOutlined />}
                onClick={() => navigate('/reports')}
                style={{ color: 'rgba(255,255,255,.85)' }}
              >
                报表中心
              </Button>
              <Tag bordered={false} style={{ background: 'rgba(255,255,255,.16)', color: '#FFFFFF' }}>
                {report.reportType === 'table' ? '表格报表' : report.reportType === 'dashboard' ? '看板' : '图表报表'}
              </Tag>
              {config.chartType && (
                <Tag bordered={false} style={{ background: 'rgba(255,255,255,.12)', color: '#FFFFFF' }}>
                  {config.chartType}
                </Tag>
              )}
              {Number(report.status) !== 1 && <Tag color="#E86161">已停用</Tag>}
            </Space>
            <div style={{ fontSize: isMobile ? 20 : 26, fontWeight: 700, lineHeight: 1.25, wordBreak: 'break-word' }}>
              {report.name}
            </div>
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.72)', marginTop: 6, maxWidth: 760 }}>
              {report.code ? `${report.code} · ` : ''}
              {report.category ? `${report.category} · ` : ''}
              {report.datasetName ? `数据集：${report.datasetName}` : '未绑定数据集'}
              {report.description ? ` · ${report.description}` : ''}
            </div>
          </div>

          <Space wrap size={8}>
            <Tooltip title="刷新数据">
              <Button
                icon={<ReloadOutlined />}
                onClick={() => load()}
                loading={loading}
                style={{ background: 'rgba(255,255,255,.14)', borderColor: 'rgba(255,255,255,.28)', color: '#FFFFFF' }}
              >
                {isMobile ? '' : '刷新'}
              </Button>
            </Tooltip>
            <Tooltip title="每 60 秒自动刷新">
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 32,
                  padding: '0 10px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,.14)',
                  fontSize: 12.5,
                }}
              >
                <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
                自动
              </span>
            </Tooltip>
            <Button
              icon={<DownloadOutlined />}
              onClick={handleExport}
              style={{ background: 'rgba(255,255,255,.14)', borderColor: 'rgba(255,255,255,.28)', color: '#FFFFFF' }}
            >
              {isMobile ? '' : '导出 CSV'}
            </Button>
            {canShare && (
              <Button
                icon={<ShareAltOutlined />}
                onClick={handleShare}
                style={{ background: 'rgba(255,255,255,.14)', borderColor: 'rgba(255,255,255,.28)', color: '#FFFFFF' }}
              >
                {isMobile ? '' : '分享'}
              </Button>
            )}
            {canWrite && (
              <Button
                icon={<EditOutlined />}
                onClick={() => navigate(`/reports/${report.id}/design`)}
                style={{ background: 'rgba(255,255,255,.14)', borderColor: 'rgba(255,255,255,.28)', color: '#FFFFFF' }}
              >
                {isMobile ? '' : '设计'}
              </Button>
            )}
            {!isMobile && (
              <Button
                icon={<FullscreenOutlined />}
                onClick={toggleFullscreen}
                style={{ background: 'rgba(255,255,255,.14)', borderColor: 'rgba(255,255,255,.28)', color: '#FFFFFF' }}
              />
            )}
          </Space>
        </div>

        {/* KPI */}
        <Row gutter={[10, 10]} style={{ marginTop: isMobile ? 14 : 18 }}>
          {kpis.map((k) => (
            <Col xs={8} key={k.label}>
              <div
                style={{
                  background: 'rgba(255,255,255,.10)',
                  border: '1px solid rgba(255,255,255,.16)',
                  borderRadius: 10,
                  padding: isMobile ? '8px 10px' : '12px 14px',
                }}
              >
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.68)' }}>{k.label}</div>
                <div
                  style={{
                    fontSize: isMobile ? 20 : 28,
                    fontWeight: 700,
                    color: k.color,
                    lineHeight: 1.25,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {fmtNum(k.value)}
                </div>
              </div>
            </Col>
          ))}
        </Row>
        <div style={{ marginTop: 8, fontSize: 11.5, color: 'rgba(255,255,255,.6)' }}>
          <ClockCircleOutlined /> 数据更新于 {updatedAt ? fmtTime(updatedAt, 'HH:mm:ss') : '-'}
          {report.updatedAt ? ` · 报表更新于 ${fmtAgo(report.updatedAt)}` : ''}
        </div>
      </div>

      {/* ── 主体 ── */}
      <div style={{ padding: isMobile ? 12 : 20, background: '#FFFFFF' }}>
        {Number(report.status) !== 1 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="该报表已停用"
            description="停用状态下仍可查看，但对外分享会提示已停用。"
          />
        )}
        {report.reportType === 'dashboard' && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="这是一个看板类型报表"
            description="看板由多个图表组件组合而成，当前查看页展示其主指标与明细数据。"
            action={
              (config as { dashboardUrl?: string }).dashboardUrl ? (
                <Button size="small" onClick={() => navigate(String((config as { dashboardUrl?: string }).dashboardUrl))}>
                  查看完整看板
                </Button>
              ) : undefined
            }
          />
        )}
        {runErr && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            message="报表取数失败"
            description={`${runErr}（可在报表设计中重新选择数据集）`}
            action={
              canWrite ? (
                <Button size="small" onClick={() => navigate(`/reports/${report.id}/design`)}>
                  去修复
                </Button>
              ) : undefined
            }
          />
        )}

        <Row gutter={[16, 16]}>
          {/* 图表 */}
          <Col xs={24} xl={16}>
            <Card
              title={
                <span style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>
                  {config.title || report.name}
                </span>
              }
              extra={
                <Badge
                  status="processing"
                  text={<span style={{ fontSize: 12, color: 'rgba(0,51,120,.55)' }}>{fmtNum(rowCount)} 行数据</span>}
                />
              }
              styles={{ body: { padding: isMobile ? 8 : 14 } }}
              style={{ border: '1px solid #DCDDDD', borderRadius: 12, height: '100%' }}
            >
              {built.kind === 'table' ? (
                <Table
                  size="small"
                  rowKey={(_, i) => String(i)}
                  dataSource={rows.slice(0, 100)}
                  columns={tableColumns}
                  pagination={{ pageSize: 10, size: 'small' }}
                  scroll={{ x: 'max-content', y: 380 }}
                  bordered
                />
              ) : built.kind === 'number' ? (
                <div style={{ padding: isMobile ? '24px 8px' : '42px 8px', textAlign: 'center' }}>
                  <Statistic
                    title={<span style={{ color: 'rgba(0,51,120,.6)' }}>{built.metric?.label}</span>}
                    value={built.metric?.value}
                    formatter={(v) => fmtNum(Number(v))}
                    valueStyle={{ color: '#2D6FE4', fontWeight: 700, fontSize: isMobile ? 34 : 48 }}
                  />
                  <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(0,51,120,.5)' }}>
                    基于 {fmtNum(built.metric?.total || 0)} 行数据聚合
                  </div>
                </div>
              ) : (
                <Chart
                  option={built.option}
                  height={chartHeight}
                  loading={loading}
                  empty={built.isEmpty || !rows.length}
                  emptyText={runErr ? '暂无可用数据' : '该数据集暂无数据'}
                />
              )}
            </Card>
          </Col>

          {/* 数据概览 */}
          <Col xs={24} xl={8}>
            <Card
              title={<span style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>报表信息</span>}
              styles={{ body: { padding: 14 } }}
              style={{ border: '1px solid #DCDDDD', borderRadius: 12, height: '100%' }}
            >
              {[
                { k: '编码', v: report.code || '-' },
                { k: '分类', v: report.category || '-' },
                { k: '图表类型', v: built.kind },
                { k: '数据集', v: report.datasetName || '-' },
                { k: '字段数', v: String(columns.length) },
                { k: '数据行数', v: fmtNum(rowCount) },
                { k: '浏览次数', v: fmtNum(report.viewCount || 0) },
                { k: '创建时间', v: fmtTime(report.createdAt, 'YYYY-MM-DD HH:mm') },
                { k: '更新时间', v: fmtTime(report.updatedAt, 'YYYY-MM-DD HH:mm') },
              ].map((row) => (
                <div
                  key={row.k}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '7px 0',
                    borderBottom: '1px dashed #DCDDDD',
                    fontSize: 12.5,
                  }}
                >
                  <span style={{ color: 'rgba(0,51,120,.55)', flexShrink: 0 }}>{row.k}</span>
                  <span style={{ color: '#003378', textAlign: 'right', wordBreak: 'break-all' }}>{row.v}</span>
                </div>
              ))}
              {canShare && (
                <Button block icon={<ShareAltOutlined />} onClick={handleShare} style={{ marginTop: 14 }}>
                  生成分享链接
                </Button>
              )}
            </Card>
          </Col>

          {/* 明细表 */}
          {built.kind !== 'table' && (
            <Col xs={24}>
              <Card
                title={<span style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>数据明细</span>}
                extra={<span style={{ fontSize: 12, color: 'rgba(0,51,120,.55)' }}>共 {fmtNum(rowCount)} 行</span>}
                styles={{ body: { padding: 8 } }}
                style={{ border: '1px solid #DCDDDD', borderRadius: 12 }}
              >
                {rows.length ? (
                  <Table
                    size="small"
                    rowKey={(_, i) => String(i)}
                    dataSource={rows.slice(0, 200)}
                    columns={tableColumns}
                    pagination={{ pageSize: isMobile ? 10 : 20, size: 'small', showSizeChanger: false }}
                    scroll={{ x: 'max-content' }}
                    bordered
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无明细数据" />
                )}
              </Card>
            </Col>
          )}
        </Row>
      </div>
    </div>
  );
}
