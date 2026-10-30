/**
 * 报表查看（V4.1 统一规范：Page 顶部标题区 + stats 数据卡片 + @/theme 配色令牌）
 * - 图表主体 + 报表信息 + 数据明细表；移动端单列，图表与表格自适应
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
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import Page from '@/components/Page';
import type { StatCardItem } from '@/components/StatCards';
import Chart from '@/components/Chart';
import DashboardRenderer from '@/components/DashboardRenderer';
import { NEUTRAL, PALETTE } from '@/theme';
import { useAppStore } from '@/stores/app';
import { copyText, fmtAgo, fmtNum, fmtTime } from '@/utils';
import {
  buildChartOption,
  createShare,
  getDataset,
  getReport,
  isDashboardConfig,
  normalizeDashboardConfig,
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

  /* V6.0：看板式配置（多卡片组合）—— 有就用 DashboardRenderer 整页渲染 */
  const dashConfig = useMemo(
    () => (isDashboardConfig(config) ? normalizeDashboardConfig(config) : null),
    [config],
  );

  const tableColumns = useMemo(() => {
    if (!rows.length) return [];
    return pickTableColumns(rows, columns, isMobile ? 6 : 14).map((c) => ({
      title: c,
      dataIndex: c,
      key: c,
      ellipsis: true,
      width: 140,
      render: (v: unknown) => {
        if (v === null || v === undefined) return <span style={{ color: NEUTRAL.textQuaternary }}>-</span>;
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

  const statItems = useMemo<StatCardItem[]>(() => [
    { key: 'rows', label: '数据行数', value: fmtNum(rowCount), suffix: '行', color: PALETTE.primary },
    { key: 'cols', label: '字段数', value: fmtNum(columns.length), suffix: '个', color: PALETTE.cyan },
    { key: 'views', label: '浏览次数', value: fmtNum(report?.viewCount || 0), suffix: '次', color: PALETTE.green },
    {
      key: 'updated',
      label: '数据刷新',
      value: updatedAt ? fmtTime(updatedAt, 'HH:mm:ss') : '-',
      color: PALETTE.violet,
      hint: report?.updatedAt ? `报表更新于 ${fmtAgo(report.updatedAt)}` : undefined,
    },
  ], [rowCount, columns.length, report?.viewCount, report?.updatedAt, updatedAt]);

  if (loading && !report) {
    return (
      <Page title="报表查看">
        <Card style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12 }}>
          <Skeleton active paragraph={{ rows: 10 }} />
        </Card>
      </Page>
    );
  }

  if (!report) {
    return (
      <Page
        title="报表查看"
        actions={
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reports')}>
            返回报表中心
          </Button>
        }
      >
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
      </Page>
    );
  }

  return (
    <div ref={wrapRef} style={{ background: NEUTRAL.pageBg, minHeight: '100%' }}>
      <Page
        title={report.name}
        actions={
          <>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reports')}>
              返回
            </Button>
            {canWrite && (
              <Button icon={<EditOutlined />} onClick={() => navigate(`/reports/${report.id}/design`)}>
                设计
              </Button>
            )}
            {canShare && (
              <Button icon={<ShareAltOutlined />} onClick={handleShare}>
                分享
              </Button>
            )}
            <Button icon={<DownloadOutlined />} onClick={handleExport}>
              导出 CSV
            </Button>
          </>
        }
        extra={
          <Space wrap size={8}>
            <Tag bordered={false} color={PALETTE.primary} style={{ color: NEUTRAL.textInverse }}>
              {report.reportType === 'table' ? '表格报表' : report.reportType === 'dashboard' ? '看板' : '图表报表'}
            </Tag>
            {Number(report.status) !== 1 && <Tag color={PALETTE.red}>已停用</Tag>}
            <Tooltip title="每 60 秒自动刷新">
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 32,
                  padding: '0 10px',
                  borderRadius: 8,
                  background: NEUTRAL.surface,
                  border: `1px solid ${NEUTRAL.border}`,
                  fontSize: 12.5,
                  color: NEUTRAL.textSecondary,
                }}
              >
                <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
                自动
              </span>
            </Tooltip>
            <Tooltip title="刷新数据">
              <Button icon={<ReloadOutlined />} onClick={() => load()} loading={loading}>
                {isMobile ? '' : '刷新'}
              </Button>
            </Tooltip>
            {!isMobile && (
              <Tooltip title="全屏查看">
                <Button icon={<FullscreenOutlined />} onClick={toggleFullscreen} />
              </Tooltip>
            )}
          </Space>
        }
        stats={statItems}
      >
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

        {/* V6.0 看板式渲染：多卡片组合，不走旧单图表逻辑 */}
        {dashConfig ? (
          <div style={{ marginTop: 4 }}>
            {(dashConfig.title || dashConfig.subtitle || dashConfig.widgets.length > 0) && (
              <div style={{ margin: '4px 0 12px' }}>
                {dashConfig.title && (
                  <div style={{ fontSize: isMobile ? 17 : 20, fontWeight: 700, color: NEUTRAL.text }}>
                    {dashConfig.title}
                  </div>
                )}
                {dashConfig.subtitle && (
                  <div style={{ fontSize: 12, color: NEUTRAL.textSecondary, marginTop: 3 }}>
                    {dashConfig.subtitle}
                  </div>
                )}
              </div>
            )}
            <DashboardRenderer
              config={dashConfig}
              rows={rows}
              columns={columns}
              isMobile={isMobile}
              readonly
            />
          </div>
        ) : (
        <Row gutter={[16, 16]}>
          {/* 图表 */}
          <Col xs={24} xl={16}>
            <Card
              title={
                <span style={{ fontSize: 14, fontWeight: 600, color: NEUTRAL.text }}>
                  {config.title || report.name}
                </span>
              }
              extra={
                <Badge
                  status="processing"
                  text={<span style={{ fontSize: 12, color: NEUTRAL.textSecondary }}>{fmtNum(rowCount)} 行数据</span>}
                />
              }
              styles={{ body: { padding: isMobile ? 8 : 14 } }}
              style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12, height: '100%' }}
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
                    title={<span style={{ color: NEUTRAL.textSecondary }}>{built.metric?.label}</span>}
                    value={built.metric?.value}
                    formatter={(v) => fmtNum(Number(v))}
                    valueStyle={{ color: PALETTE.primary, fontWeight: 700, fontSize: isMobile ? 34 : 48 }}
                  />
                  <div style={{ marginTop: 8, fontSize: 12, color: NEUTRAL.textTertiary }}>
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
              title={<span style={{ fontSize: 14, fontWeight: 600, color: NEUTRAL.text }}>报表信息</span>}
              styles={{ body: { padding: 14 } }}
              style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12, height: '100%' }}
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
                    borderBottom: `1px dashed ${NEUTRAL.borderSubtle}`,
                    fontSize: 12.5,
                  }}
                >
                  <span style={{ color: NEUTRAL.textSecondary, flexShrink: 0 }}>{row.k}</span>
                  <span style={{ color: NEUTRAL.text, textAlign: 'right', wordBreak: 'break-all' }}>{row.v}</span>
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
                title={<span style={{ fontSize: 14, fontWeight: 600, color: NEUTRAL.text }}>数据明细</span>}
                extra={<span style={{ fontSize: 12, color: NEUTRAL.textSecondary }}>共 {fmtNum(rowCount)} 行</span>}
                styles={{ body: { padding: 8 } }}
                style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12 }}
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
        )}
      </Page>
    </div>
  );
}
