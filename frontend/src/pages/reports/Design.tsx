/**
 * 报表设计器（V4.1 统一规范：Page 顶部标题区 + @/theme 配色令牌）
 * 流程：选择数据集 → 选择图表类型 → 配置字段 → 预览 → 保存
 * 左：配置面板（桌面） / 上：配置面板（移动端）；右：实时预览 + 数据预览
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  App as AntApp,
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Empty,
  Grid,
  Input,
  InputNumber,
  Row,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import {
  AreaChartOutlined,
  ArrowLeftOutlined,
  BarChartOutlined,
  CheckOutlined,
  DashboardOutlined,
  DotChartOutlined,
  EyeOutlined,
  FunnelPlotOutlined,
  LineChartOutlined,
  NumberOutlined,
  PieChartOutlined,
  RadarChartOutlined,
  ReloadOutlined,
  SaveOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import Page from '@/components/Page';
import Chart from '@/components/Chart';
import { NEUTRAL, PALETTE } from '@/theme';
import { useAppStore } from '@/stores/app';
import { fmtNum } from '@/utils';
import {
  buildChartOption,
  getReport,
  listDatasets,
  pickTableColumns,
  previewDataset,
  updateReport,
  type DatasetColumn,
  type DatasetItem,
  type ReportConfig,
  type ReportItem,
  type RowData,
} from '@/api/reports';

const { useBreakpoint } = Grid;

/** 设计器支持的图表类型（含图标，key 与后端 config.chartType 对齐） */
const CHART_TYPE_OPTIONS = [
  { key: 'bar', name: '柱状图', icon: <BarChartOutlined /> },
  { key: 'line', name: '折线图', icon: <LineChartOutlined /> },
  { key: 'area', name: '面积图', icon: <AreaChartOutlined /> },
  { key: 'pie', name: '饼图', icon: <PieChartOutlined /> },
  { key: 'doughnut', name: '环形图', icon: <PieChartOutlined /> },
  { key: 'scatter', name: '散点图', icon: <DotChartOutlined /> },
  { key: 'radar', name: '雷达图', icon: <RadarChartOutlined /> },
  { key: 'funnel', name: '漏斗图', icon: <FunnelPlotOutlined /> },
  { key: 'gauge', name: '仪表盘', icon: <DashboardOutlined /> },
  { key: 'number', name: '指标卡', icon: <NumberOutlined /> },
  { key: 'table', name: '数据表格', icon: <TableOutlined /> },
];

export default function ReportDesign() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { can } = useAppStore();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const canWrite = can('report:write');

  const [report, setReport] = useState<ReportItem | null>(null);
  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [rows, setRows] = useState<RowData[]>([]);
  const [columns, setColumns] = useState<DatasetColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  /* 表单态 */
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [datasetId, setDatasetId] = useState<number | undefined>(undefined);
  const [chartType, setChartType] = useState('bar');
  const [chartTitle, setChartTitle] = useState('');
  const [categoryField, setCategoryField] = useState<string | undefined>(undefined);
  const [valueFields, setValueFields] = useState<string[]>([]);
  const [gaugeMax, setGaugeMax] = useState<number | undefined>(undefined);
  const [chartHeight, setChartHeight] = useState<number>(360);

  /**
   * 拉取数据集结构与样本数据
   *
   * autoFill=true 时在「未配置数值字段」的情况下自动挑一列数值字段；
   * 载入已有报表时应传 false —— 否则会把无意义的列（如自增 id）当成指标，
   * 让预览出现「id 之和」这种失真数字。用户主动切换数据集时再 autoFill。
   */
  const loadColumns = useCallback(async (dsId: number, alive = true, autoFill = false) => {
    setPreviewing(true);
    setErr('');
    try {
      const data = await previewDataset(dsId, 200);
      if (!alive) return;
      const cols = data.columns || [];
      setRows(data.rows || []);
      setColumns(cols);
      const numCols = cols
        .filter((c) =>
          (data.rows || [])
            .slice(0, 20)
            .some((r) => typeof r[c.name] === 'number' || /^-?\d+(\.\d+)?$/.test(String(r[c.name] ?? '')))
        )
        .map((c) => c.name);
      setCategoryField((prev) => (prev && cols.some((c) => c.name === prev) ? prev : cols[0]?.name));
      setValueFields((prev) => {
        const keep = (prev || []).filter((f) => cols.some((c) => c.name === f));
        if (keep.length) return keep;
        if (!autoFill) return [];
        return (numCols.length ? numCols : cols.map((c) => c.name)).slice(0, 2);
      });
    } catch (e) {
      if (alive) {
        setRows([]);
        setColumns([]);
        setErr(e instanceof Error ? e.message : '数据集取数失败');
      }
    } finally {
      if (alive) setPreviewing(false);
    }
  }, []);

  /** 载入报表 + 数据集列表 */
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [rep, ds] = await Promise.all([
          getReport(String(id)),
          listDatasets().catch(() => [] as DatasetItem[]),
        ]);
        if (!alive) return;
        setReport(rep);
        setDatasets(ds);
        setName(rep.name);
        setCategory(rep.category || '');
        setDescription(rep.description || '');
        const cfg = (rep.config || {}) as ReportConfig;
        setChartType(cfg.chartType || 'bar');
        setChartTitle(cfg.title || '');
        setCategoryField(cfg.categoryField || cfg.xField || undefined);
        const vf = (cfg.valueFields && cfg.valueFields.length
          ? cfg.valueFields
          : cfg.valueField
            ? [cfg.valueField]
            : []) as string[];
        setValueFields(vf.slice(0, 3));
        setGaugeMax(cfg.gaugeMax);
        setChartHeight(Number(cfg.height) || 360);
        setDatasetId(rep.datasetId || undefined);
      } catch {
        if (alive) setErr('报表不存在或无权访问');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* 数据集变化时拉取字段：首次载入不自动填字段，用户切换数据集时才自动填 */
  const firstLoadRef = useRef(true);
  useEffect(() => {
    if (!datasetId) return;
    const autoFill = !firstLoadRef.current;
    firstLoadRef.current = false;
    loadColumns(datasetId, true, autoFill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId]);

  /** 当前配置（保存与预览共用） */
  const currentConfig: ReportConfig = useMemo(
    () => ({
      chartType,
      title: chartTitle || name,
      height: chartHeight,
      categoryField,
      valueFields,
      valueField: valueFields[0],
      xField: valueFields[0],
      yField: valueFields[1],
      gaugeMax,
    }),
    [chartType, chartTitle, name, chartHeight, categoryField, valueFields, gaugeMax]
  );

  const built = useMemo(() => buildChartOption(rows, currentConfig, { limit: 60 }), [rows, currentConfig]);

  const numericColumns = useMemo(
    () =>
      columns
        .filter((c) =>
          rows
            .slice(0, 20)
            .some((r) => typeof r[c.name] === 'number' || /^-?\d+(\.\d+)?$/.test(String(r[c.name] ?? '')))
        )
        .map((c) => c.name),
    [columns, rows]
  );

  const valueOptions = (numericColumns.length ? numericColumns : columns.map((c) => c.name)).map((c) => ({
    label: c,
    value: c,
  }));

  const save = async (thenView: boolean) => {
    if (!name.trim()) {
      message.warning('请填写报表名称');
      return;
    }
    if (!datasetId) {
      message.warning('请先选择数据集');
      return;
    }
    setSaving(true);
    try {
      await updateReport(String(id), {
        name: name.trim(),
        description: description.trim(),
        category: category.trim(),
        datasetId,
        reportType: chartType === 'table' ? 'table' : 'chart',
        config: currentConfig,
      });
      message.success('报表已保存');
      if (thenView) navigate(`/reports/${id}/view`);
      else setReport((prev) => (prev ? { ...prev, name: name.trim() } : prev));
    } catch {
      /* client 已提示 */
    } finally {
      setSaving(false);
    }
  };

  /* 表格预览列 */
  const tableCols = useMemo(
    () =>
      pickTableColumns(rows, columns, 8).map((c) => ({
        title: c,
        dataIndex: c,
        key: c,
        ellipsis: true,
        width: 130,
        render: (v: unknown) => {
          if (v === null || v === undefined) return '-';
          const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
          return <span title={s}>{s.slice(0, 60)}</span>;
        },
      })),
    [rows, columns]
  );

  if (loading) {
    return (
      <Page title="报表设计">
        <Card style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12 }}>
          <Skeleton active paragraph={{ rows: 8 }} />
        </Card>
      </Page>
    );
  }

  if (!report) {
    return (
      <Page
        title="报表设计"
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
          description={err || '报表不存在，或当前账号没有查看权限'}
          action={
            <Button size="small" onClick={() => navigate('/reports')}>
              返回列表
            </Button>
          }
        />
      </Page>
    );
  }

  const dsMeta = datasets.find((d) => d.id === datasetId);
  const readOnly = !canWrite;

  const configPanel = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ① 基础信息 */}
      <Card
        size="small"
        title={<span style={{ fontSize: 13.5, color: NEUTRAL.text }}>① 基础信息</span>}
        styles={{ body: { paddingTop: 10 } }}
        style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 10 }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="报表名称"
            maxLength={60}
            size={isMobile ? 'large' : 'middle'}
            addonBefore="名称"
          />
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="分类（可选）"
            maxLength={40}
            size={isMobile ? 'large' : 'middle'}
            addonBefore="分类"
          />
          <Input.TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="描述报表口径（可选）"
            autoSize={{ minRows: 1, maxRows: 3 }}
            maxLength={200}
          />
        </div>
      </Card>

      {/* ② 数据集 */}
      <Card
        size="small"
        title={<span style={{ fontSize: 13.5, color: NEUTRAL.text }}>② 数据集</span>}
        extra={
          <Button
            type="link"
            size="small"
            icon={<ReloadOutlined />}
            loading={previewing}
            onClick={() => datasetId && loadColumns(datasetId)}
          >
            刷新
          </Button>
        }
        styles={{ body: { paddingTop: 10 } }}
        style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 10 }}
      >
        <Select
          value={datasetId}
          onChange={(v) => setDatasetId(v)}
          placeholder="选择数据集"
          style={{ width: '100%' }}
          size={isMobile ? 'large' : 'middle'}
          showSearch
          optionFilterProp="label"
          options={datasets.map((d) => ({ value: d.id, label: `${d.name}（${d.datasourceName || '本机数据库'}）` }))}
        />
        <div style={{ marginTop: 8, fontSize: 12, color: NEUTRAL.textSecondary, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {dsMeta?.sourceType && (
            <span>
              来源：
              {dsMeta.sourceType === 'sql' ? 'SQL 查询' : dsMeta.sourceType === 'table' ? '数据表' : '推送项目'}
            </span>
          )}
          {columns.length > 0 && <span>字段 {columns.length} 个</span>}
          {rows.length > 0 && <span>样本 {fmtNum(rows.length)} 行</span>}
        </div>
      </Card>

      {/* ③ 图表类型 */}
      <Card
        size="small"
        title={<span style={{ fontSize: 13.5, color: NEUTRAL.text }}>③ 图表类型</span>}
        styles={{ body: { paddingTop: 10 } }}
        style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 10 }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(4, 1fr)',
            gap: 8,
          }}
        >
          {CHART_TYPE_OPTIONS.map((t) => {
            const active = chartType === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setChartType(t.key)}
                style={{
                  cursor: 'pointer',
                  border: `1px solid ${active ? PALETTE.primary : NEUTRAL.border}`,
                  background: active ? NEUTRAL.surfaceSunken : NEUTRAL.surface,
                  color: active ? PALETTE.primary : NEUTRAL.textSecondary,
                  borderRadius: 8,
                  padding: '10px 4px',
                  minHeight: 54,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  fontSize: 12,
                  fontWeight: active ? 600 : 400,
                }}
              >
                <span style={{ fontSize: 16 }}>{t.icon}</span>
                {t.name}
              </button>
            );
          })}
        </div>
      </Card>

      {/* ④ 字段与样式 */}
      <Card
        size="small"
        title={<span style={{ fontSize: 13.5, color: NEUTRAL.text }}>④ 字段与样式</span>}
        styles={{ body: { paddingTop: 10 } }}
        style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 10 }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, color: NEUTRAL.textSecondary, marginBottom: 4 }}>
              {chartType === 'scatter' ? 'X 轴字段（数值）' : '分类字段 / X 轴'}
            </div>
            <Select
              value={categoryField}
              onChange={setCategoryField}
              style={{ width: '100%' }}
              size={isMobile ? 'large' : 'middle'}
              allowClear
              showSearch
              placeholder="选择分类字段"
              options={columns.map((c) => ({ value: c.name, label: c.name }))}
            />
          </div>

          <div>
            <div style={{ fontSize: 12, color: NEUTRAL.textSecondary, marginBottom: 4 }}>
              {chartType === 'scatter' ? 'Y 轴字段（数值，按顺序取前 2 个）' : '数值字段（可多选，最多 3 个）'}
            </div>
            {valueOptions.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该数据集没有可用字段" />
            ) : (
              <Checkbox.Group
                value={valueFields}
                onChange={(vals) => setValueFields((vals as string[]).slice(0, 3))}
                options={valueOptions}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  maxHeight: 168,
                  overflow: 'auto',
                  paddingRight: 4,
                }}
              />
            )}
            {['pie', 'doughnut', 'funnel', 'gauge', 'number'].includes(chartType) && valueFields.length > 1 && (
              <div style={{ fontSize: 11.5, color: PALETTE.orange, marginTop: 4 }}>该图表类型仅使用第一个数值字段</div>
            )}
          </div>

          <Divider style={{ margin: '2px 0' }} />

          <div>
            <div style={{ fontSize: 12, color: NEUTRAL.textSecondary, marginBottom: 4 }}>图表标题（留空则用报表名称）</div>
            <Input value={chartTitle} onChange={(e) => setChartTitle(e.target.value)} placeholder={name} maxLength={60} />
          </div>

          <Space size={10} style={{ width: '100%' }} wrap>
            <div>
              <div style={{ fontSize: 12, color: NEUTRAL.textSecondary, marginBottom: 4 }}>图表高度</div>
              <InputNumber
                min={200}
                max={800}
                step={20}
                value={chartHeight}
                onChange={(v) => setChartHeight(Number(v) || 360)}
                addonAfter="px"
                style={{ width: 120 }}
              />
            </div>
            {chartType === 'gauge' && (
              <div>
                <div style={{ fontSize: 12, color: NEUTRAL.textSecondary, marginBottom: 4 }}>仪表盘最大值</div>
                <InputNumber
                  min={0}
                  value={gaugeMax}
                  onChange={(v) => setGaugeMax(v === null ? undefined : Number(v))}
                  placeholder="自动"
                  style={{ width: 110 }}
                />
              </div>
            )}
          </Space>
        </div>
      </Card>

      {/* 操作 */}
      <Space wrap size={8}>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          disabled={readOnly}
          onClick={() => save(false)}
          size={isMobile ? 'large' : 'middle'}
        >
          保存
        </Button>
        <Button
          icon={<EyeOutlined />}
          loading={saving}
          disabled={readOnly}
          onClick={() => save(true)}
          size={isMobile ? 'large' : 'middle'}
        >
          保存并查看
        </Button>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reports')} size={isMobile ? 'large' : 'middle'}>
          返回
        </Button>
      </Space>
    </div>
  );

  const previewPanel = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card
        title={
          <Space size={8}>
            <span style={{ fontSize: 13.5, color: NEUTRAL.text }}>实时预览</span>
            <Tag bordered={false} color={PALETTE.primary} style={{ color: NEUTRAL.textInverse }}>
              {CHART_TYPE_OPTIONS.find((t) => t.key === chartType)?.name || chartType}
            </Tag>
          </Space>
        }
        extra={
          <Tooltip title="预览使用数据集前 200 行样本数据">
            <span style={{ fontSize: 12, color: NEUTRAL.textTertiary }}>{rows.length} 行样本</span>
          </Tooltip>
        }
        styles={{ body: { padding: 12 } }}
        style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 10 }}
      >
        {!datasetId ? (
          <Empty description="请先选择数据集" style={{ padding: '40px 0' }} />
        ) : built.kind === 'table' ? (
          <Table
            size="small"
            rowKey={(_, i) => String(i)}
            dataSource={rows.slice(0, 50)}
            columns={tableCols}
            pagination={false}
            scroll={{ x: 'max-content', y: 360 }}
            bordered
          />
        ) : built.kind === 'number' ? (
          <div style={{ padding: '32px 0', textAlign: 'center' }}>
            <Statistic
              title={built.metric?.label}
              value={built.metric?.value}
              formatter={(v) => fmtNum(Number(v))}
              valueStyle={{ color: PALETTE.primary, fontSize: isMobile ? 30 : 40, fontWeight: 700 }}
            />
            <div style={{ fontSize: 12, color: NEUTRAL.textTertiary, marginTop: 6 }}>
              基于 {built.metric?.total || 0} 行样本聚合
            </div>
          </div>
        ) : (
          <Chart
            option={built.option}
            height={chartHeight}
            loading={previewing}
            empty={built.isEmpty || !(built.option?.series as unknown[] | undefined)?.length}
            emptyText="样本数据无法生成该图表"
          />
        )}
      </Card>

      <Card
        title={<span style={{ fontSize: 13.5, color: NEUTRAL.text }}>数据预览</span>}
        extra={<span style={{ fontSize: 12, color: NEUTRAL.textTertiary }}>共 {fmtNum(rows.length)} 行</span>}
        styles={{ body: { padding: 8 } }}
        style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 10 }}
      >
        {rows.length ? (
          <Table
            size="small"
            rowKey={(_, i) => String(i)}
            dataSource={rows.slice(0, 20)}
            columns={tableCols}
            pagination={false}
            scroll={{ x: 'max-content' }}
            bordered
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
        )}
      </Card>
    </div>
  );

  return (
    <Page
      title={`报表设计 · ${report.name}`}
      actions={
        <>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            disabled={readOnly}
            onClick={() => save(false)}
          >
            保存
          </Button>
          <Button
            icon={<EyeOutlined />}
            loading={saving}
            disabled={readOnly}
            onClick={() => save(true)}
          >
            保存并查看
          </Button>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reports')}>
            返回
          </Button>
        </>
      }
      extra={
        <Space wrap size={8}>
          <Tag
            bordered={false}
            color={report.reportType === 'table' ? PALETTE.cyan : PALETTE.primary}
            style={{ color: NEUTRAL.textInverse }}
          >
            {report.reportType === 'table' ? '表格报表' : report.reportType === 'dashboard' ? '看板' : '图表报表'}
          </Tag>
          {readOnly && <Tag color={PALETTE.gray}>只读</Tag>}
        </Space>
      }
    >
      {!datasetId && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="请先选择一个数据集，报表的数据与字段都来自数据集。"
          action={
            <Button size="small" type="link" onClick={() => navigate('/datasets')}>
              去管理数据集
            </Button>
          }
        />
      )}
      {err && datasetId && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="数据集取数失败" description={err} />
      )}
      {readOnly && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="当前账号没有报表编辑权限，仅可预览。" />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={9} xl={8}>
          {configPanel}
        </Col>
        <Col xs={24} lg={15} xl={16}>
          {previewPanel}
        </Col>
      </Row>

      {/* 移动端底部操作条 */}
      {isMobile && !readOnly && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            marginTop: 12,
            padding: '10px 0',
            background: NEUTRAL.surface,
            display: 'flex',
            gap: 8,
          }}
        >
          <Button type="primary" block icon={<CheckOutlined />} loading={saving} onClick={() => save(false)} style={{ height: 46 }}>
            保存报表
          </Button>
          <Button block icon={<EyeOutlined />} loading={saving} onClick={() => save(true)} style={{ height: 46 }}>
            保存并查看
          </Button>
        </div>
      )}
    </Page>
  );
}
