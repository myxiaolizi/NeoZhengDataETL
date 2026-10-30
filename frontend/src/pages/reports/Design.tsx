/**
 * 报表设计器 V6.0 · 看板式三栏设计器
 *
 * 布局：
 *   顶部工具条：报表名 + [保存][预览][导出JSON][导入JSON] + 模板下拉
 *   左栏（240）：组件库，按「基础 / 图表 / 表格」分组，点击追加到画布
 *   中栏（flex）：画布，12 栅格，卡片可选中 / 调序 / 删除
 *   右栏（320）：属性面板（选中卡片 → 卡片属性；未选中 → 全局设置）
 *
 * 兼容：reportType 不是 dashboard 且 config 没有 mode:'dashboard' 时，可切回旧版单图表模式。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  App as AntApp, Alert, Button, Col, Empty, Grid, Input, InputNumber, Modal, Row, Select,
  Skeleton, Space, Tooltip,
} from 'antd';
import {
  ArrowDownOutlined, ArrowLeftOutlined, ArrowUpOutlined, BgColorsOutlined,
  CheckOutlined, DeleteOutlined, DownloadOutlined, EyeOutlined, LayoutOutlined,
  PlusOutlined, SaveOutlined, SettingOutlined, UploadOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import Page from '@/components/Page';
import DashboardRenderer from '@/components/DashboardRenderer';
import { useAppStore } from '@/stores/app';
import {
  DASHBOARD_GRID, DASHBOARD_TEMPLATES, WIDGET_META, WIDGET_TYPES,
  getReport, listDatasets, normalizeDashboardConfig, previewDataset, runReport,
  updateReport,
  type DashboardConfig, type DashboardWidget, type DatasetColumn, type DatasetItem,
  type ReportItem, type RowData, type WidgetType,
} from '@/api/reports';

const { useBreakpoint } = Grid;

/** 组件库分组 */
const WIDGET_GROUPS: { key: string; title: string; types: WidgetType[] }[] = [
  { key: 'basic', title: '基础', types: ['kpi', 'donut', 'semiGauge', 'progress', 'flowMap', 'rank'] },
  { key: 'chart', title: '图表', types: ['bar', 'stackBar', 'line', 'combo', 'pie', 'heatmap'] },
  { key: 'table', title: '表格与文本', types: ['table', 'text'] },
];

/** 生成 widget id */
let seq = 0;
function nextId(): string {
  seq += 1;
  return `w_${Date.now().toString(36)}_${seq}`;
}

/** 新卡片默认配置 */
function makeWidget(type: WidgetType): DashboardWidget {
  const meta = WIDGET_META.find((m) => m.type === type);
  return {
    id: nextId(),
    type,
    title: meta?.name || '新卡片',
    span: (meta?.defaultSpan || 4) as DashboardWidget['span'],
    height: type === 'table' ? 360 : type === 'text' ? 140 : 260,
    agg: 'sum',
  };
}

/** 空配置 */
function emptyConfig(datasetId?: number | null): DashboardConfig {
  return { version: 2, mode: 'dashboard', title: '新建看板', widgets: [], datasetId: datasetId ?? null };
}

/* ══════════════ 左栏：组件库 ══════════════ */

function WidgetPalette({ onAdd }: { onAdd: (t: WidgetType) => void }) {
  return (
    <div style={{ padding: '10px 10px 20px', overflowY: 'auto', height: '100%' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: .4, marginBottom: 8 }}>
        组件库
      </div>
      {WIDGET_GROUPS.map((g) => (
        <div key={g.key} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11.5, fontWeight: 650, color: 'var(--text2)', margin: '0 0 6px 2px' }}>
            {g.title}
          </div>
          {g.types.map((t) => {
            const m = WIDGET_META.find((x) => x.type === t);
            if (!m) return null;
            return (
              <button
                key={t}
                type="button"
                onClick={() => onAdd(t)}
                title={m.desc}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 9px', marginBottom: 4, borderRadius: 9,
                  border: '1px solid var(--line)', background: 'var(--panel2)',
                  color: 'var(--text)', cursor: 'pointer', textAlign: 'left',
                  fontSize: 12, transition: 'all .14s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--brand3)';
                  e.currentTarget.style.background = 'var(--brandSoft)';
                  e.currentTarget.style.transform = 'translateX(2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--line)';
                  e.currentTarget.style.background = 'var(--panel2)';
                  e.currentTarget.style.transform = 'none';
                }}
              >
                <span style={{ color: 'var(--brand)', display: 'inline-flex', flexShrink: 0, fontSize: 14 }}>
                  {m.icon}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 550 }}>{m.name}</span>
                <PlusOutlined style={{ fontSize: 10, color: 'var(--text3)' }} />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ══════════════ 右栏：属性面板 ══════════════ */

const SPAN_OPTIONS = [
  { value: 3, label: '3 格（1/4）' },
  { value: 4, label: '4 格（1/3）' },
  { value: 6, label: '6 格（1/2）' },
  { value: 8, label: '8 格（2/3）' },
  { value: 12, label: '12 格（整行）' },
];

function Inspector({
  config, selected, columns, onChangeGlobal, onChangeWidget, onDelete,
}: {
  config: DashboardConfig;
  selected: DashboardWidget | null;
  columns: DatasetColumn[];
  onChangeGlobal: (patch: Partial<DashboardConfig>) => void;
  onChangeWidget: (patch: Partial<DashboardWidget>) => void;
  onDelete: () => void;
}) {
  const colOptions = columns.map((c) => ({ value: c.name, label: c.name }));

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text2)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );

  return (
    <div style={{ padding: 12, overflowY: 'auto', height: '100%' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: .4, marginBottom: 10 }}>
        {selected ? '卡片属性' : '全局设置'}
      </div>

      {selected ? (
        <>
          <Field label="卡片标题">
            <Input
              value={selected.title}
              onChange={(e) => onChangeWidget({ title: e.target.value })}
              placeholder="卡片标题"
            />
          </Field>

          <Field label="卡片类型">
            <div
              style={{
                fontSize: 12, padding: '5px 10px', borderRadius: 8,
                background: 'var(--brandSoft)', color: 'var(--brand)', fontWeight: 600,
              }}
            >
              {WIDGET_META.find((m) => m.type === selected.type)?.name || selected.type}
            </div>
          </Field>

          <Field label="宽度（12 栅格）">
            <Select
              value={selected.span}
              onChange={(v) => onChangeWidget({ span: v as DashboardWidget['span'] })}
              options={SPAN_OPTIONS}
              style={{ width: '100%' }}
            />
          </Field>

          <Field label="高度（px）">
            <InputNumber
              value={selected.height}
              min={80}
              max={900}
              step={20}
              onChange={(v) => onChangeWidget({ height: Number(v) || 260 })}
              style={{ width: '100%' }}
            />
          </Field>

          {/* 非 text 卡片才需要数据字段 */}
          {selected.type !== 'text' && (
            <>
              <Field label="主指标">
                <Select
                  allowClear
                  showSearch
                  value={selected.metric || undefined}
                  onChange={(v) => onChangeWidget({ metric: v })}
                  options={colOptions}
                  placeholder="选择数值列"
                  style={{ width: '100%' }}
                />
              </Field>

              <Field label="多指标（可选）">
                <Select
                  mode="multiple"
                  allowClear
                  showSearch
                  value={selected.metrics || []}
                  onChange={(v) => onChangeWidget({ metrics: v })}
                  options={colOptions}
                  placeholder="可多选"
                  style={{ width: '100%' }}
                />
              </Field>

              <Field label="分组维度">
                <Select
                  allowClear
                  showSearch
                  value={selected.dimension || undefined}
                  onChange={(v) => onChangeWidget({ dimension: v })}
                  options={colOptions}
                  placeholder="如区域 / 连锁类型"
                  style={{ width: '100%' }}
                />
              </Field>

              <Field label="聚合方式">
                <Select
                  value={selected.agg || 'sum'}
                  onChange={(v) => onChangeWidget({ agg: v })}
                  options={[
                    { value: 'sum', label: '求和 SUM' },
                    { value: 'count', label: '计数 COUNT' },
                    { value: 'avg', label: '平均 AVG' },
                    { value: 'max', label: '最大 MAX' },
                    { value: 'min', label: '最小 MIN' },
                  ]}
                  style={{ width: '100%' }}
                />
              </Field>
            </>
          )}

          {selected.type === 'text' && (
            <Field label="文本内容">
              <Input.TextArea
                rows={5}
                value={String((selected.chart as any)?.text || '')}
                onChange={(e) => onChangeWidget({ chart: { ...(selected.chart || {}), text: e.target.value } })}
                placeholder="支持纯文本说明"
              />
            </Field>
          )}

          <Button
            danger
            block
            icon={<DeleteOutlined />}
            onClick={onDelete}
            style={{ marginTop: 6 }}
          >
            删除此卡片
          </Button>
        </>
      ) : (
        <>
          <Field label="看板标题">
            <Input
              value={config.title || ''}
              onChange={(e) => onChangeGlobal({ title: e.target.value })}
              placeholder="看板标题"
            />
          </Field>
          <Field label="副标题">
            <Input
              value={config.subtitle || ''}
              onChange={(e) => onChangeGlobal({ subtitle: e.target.value })}
              placeholder="副标题（可选）"
            />
          </Field>
          <div
            style={{
              fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.7,
              padding: '10px 11px', borderRadius: 9,
              background: 'var(--panel2)', border: '1px solid var(--line)',
            }}
          >
            <div style={{ fontWeight: 600, color: 'var(--text2)', marginBottom: 4 }}>提示</div>
            点击画布中的卡片可编辑该卡片属性；
            <br />
            用卡片右上角的 ↑ ↓ 调整顺序，✕ 删除。
          </div>
        </>
      )}
    </div>
  );
}

/* ══════════════ 主组件 ══════════════ */

export default function ReportDesign() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { message, modal } = AntApp.useApp();
  const { can } = useAppStore();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const canWrite = can('report:write');

  const [report, setReport] = useState<ReportItem | null>(null);
  const [config, setConfig] = useState<DashboardConfig>(() => emptyConfig());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [rows, setRows] = useState<RowData[]>([]);
  const [columns, setColumns] = useState<DatasetColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState('');

  const selected = useMemo(
    () => config.widgets.find((w) => w.id === selectedId) || null,
    [config.widgets, selectedId],
  );

  /* ── 载入报表 ── */
  const loadReport = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr('');
    try {
      const r = await getReport(Number(id));
      setReport(r);
      const c = normalizeDashboardConfig(r.config);
      setConfig(c);
      setDirty(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '报表加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void loadReport(); }, [loadReport]);
  useEffect(() => { listDatasets().then(setDatasets).catch(() => setDatasets([])); }, []);

  /* ── 载入数据（预览用）：优先 report 的数据集 ── */
  const datasetId = config.datasetId || report?.datasetId || null;
  const loadData = useCallback(async () => {
    if (!datasetId) { setRows([]); setColumns([]); return; }
    try {
      const p = await previewDataset(datasetId, 200);
      setRows(p.rows || []);
      setColumns(p.columns || []);
    } catch {
      setRows([]); setColumns([]);
    }
  }, [datasetId]);
  useEffect(() => { void loadData(); }, [loadData]);

  /* ── 配置变更 ── */
  const patchConfig = useCallback((patch: Partial<DashboardConfig>) => {
    setConfig((c) => ({ ...c, ...patch }));
    setDirty(true);
  }, []);

  const addWidget = useCallback((type: WidgetType) => {
    const w = makeWidget(type);
    setConfig((c) => ({ ...c, widgets: [...c.widgets, w] }));
    setSelectedId(w.id);
    setDirty(true);
  }, []);

  const patchWidget = useCallback((patch: Partial<DashboardWidget>) => {
    if (!selectedId) return;
    setConfig((c) => ({
      ...c,
      widgets: c.widgets.map((w) => (w.id === selectedId ? { ...w, ...patch } : w)),
    }));
    setDirty(true);
  }, [selectedId]);

  const deleteWidget = useCallback((wid?: string) => {
    const target = wid || selectedId;
    if (!target) return;
    setConfig((c) => ({ ...c, widgets: c.widgets.filter((w) => w.id !== target) }));
    setSelectedId((cur) => (cur === target ? null : cur));
    setDirty(true);
  }, [selectedId]);

  const moveWidget = useCallback((wid: string, dir: -1 | 1) => {
    setConfig((c) => {
      const i = c.widgets.findIndex((w) => w.id === wid);
      if (i < 0) return c;
      const j = i + dir;
      if (j < 0 || j >= c.widgets.length) return c;
      const next = [...c.widgets];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...c, widgets: next };
    });
    setDirty(true);
  }, []);

  /* ── 保存 ── */
  const save = useCallback(async () => {
    if (!id) return;
    setSaving(true);
    try {
      await updateReport(Number(id), {
        name: report?.name,
        reportType: 'dashboard',
        config: config as unknown as Record<string, unknown>,
      });
      setDirty(false);
      message.success('看板已保存');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [id, report?.name, config, message]);

  /* ── 导出 / 导入 JSON ── */
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.title || 'dashboard'}-config.json`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('已导出配置 JSON');
  };

  const importJson = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          setConfig(normalizeDashboardConfig(parsed));
          setSelectedId(null);
          setDirty(true);
          message.success('配置已导入');
        } catch {
          message.error('JSON 解析失败');
        }
      };
      reader.readAsText(f);
    };
    input.click();
  };

  /* ── 应用模板 ── */
  const applyTemplate = (key: string) => {
    const tpl = DASHBOARD_TEMPLATES.find((t) => t.key === key);
    if (!tpl) return;
    const doApply = () => {
      setConfig(normalizeDashboardConfig({ ...tpl.config, datasetId: datasetId ?? tpl.config.datasetId }));
      setSelectedId(null);
      setDirty(true);
      message.success(`已应用模板「${tpl.name}」`);
    };
    if (config.widgets.length > 0) {
      modal.confirm({
        title: '应用模板会覆盖当前画布',
        content: `确定用「${tpl.name}」替换现有的 ${config.widgets.length} 个卡片吗？`,
        okText: '替换',
        cancelText: '取消',
        onOk: doApply,
      });
    } else doApply();
  };

  /* ── 未保存离开提醒 ── */
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  if (loading) {
    return (
      <Page back="/reports" backText="返回报表中心" title="看板设计器">
        <div style={{ padding: 24, background: 'var(--panel)', borderRadius: 16, border: '1px solid var(--line)' }}>
          <Skeleton active paragraph={{ rows: 10 }} />
        </div>
      </Page>
    );
  }

  if (err) {
    return (
      <Page back="/reports" backText="返回报表中心" title="看板设计器">
        <Alert type="error" showIcon message="加载失败" description={err} />
      </Page>
    );
  }

  return (
    <div style={{ margin: -16 }}>
      {/* ══════ 顶部工具条 ══════ */}
      <div
        style={{
          position: 'sticky', top: 0, zIndex: 30,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '10px 16px',
          background: 'color-mix(in srgb, var(--panel) 90%, transparent)',
          backdropFilter: 'saturate(180%) blur(14px)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reports')}>返回</Button>

        <Input
          value={config.title || ''}
          onChange={(e) => patchConfig({ title: e.target.value })}
          placeholder="看板名称"
          style={{ width: isMobile ? 130 : 220, fontWeight: 600 }}
        />

        <Select
          placeholder="应用模板"
          style={{ width: 170 }}
          value={null as unknown as undefined}
          onChange={applyTemplate}
          options={DASHBOARD_TEMPLATES.map((t) => ({ value: t.key, label: `${t.name}` }))}
        />

        <div style={{ flex: 1 }} />

        {dirty && (
          <span style={{ fontSize: 11.5, color: 'var(--warn)', whiteSpace: 'nowrap' }}>● 未保存</span>
        )}
        <span style={{ fontSize: 11.5, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
          {config.widgets.length} 个卡片
        </span>

        <Tooltip title="导出配置 JSON">
          <Button icon={<DownloadOutlined />} onClick={exportJson} />
        </Tooltip>
        <Tooltip title="导入配置 JSON">
          <Button icon={<UploadOutlined />} onClick={importJson} />
        </Tooltip>
        <Button icon={<EyeOutlined />} onClick={() => navigate(`/reports/${id}/view`)}>预览</Button>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={save}
          loading={saving}
          disabled={!canWrite}
        >
          保存
        </Button>
      </div>

      {/* ══════ 三栏 ══════ */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '240px minmax(0,1fr) 320px',
          gap: 0,
          minHeight: 'calc(100vh - 180px)',
        }}
      >
        {/* 左栏 */}
        {!isMobile && (
          <div style={{ borderRight: '1px solid var(--line)', background: 'var(--panel)', minHeight: 0 }}>
            <WidgetPalette onAdd={addWidget} />
          </div>
        )}

        {/* 中栏：画布 */}
        <div style={{ background: 'var(--bg)', padding: 14, overflowX: 'auto', minWidth: 0 }}>
          {/* 12 栅格刻度 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${DASHBOARD_GRID}, 1fr)`,
              gap: 14,
              marginBottom: 8,
            }}
          >
            {Array.from({ length: DASHBOARD_GRID }).map((_, i) => (
              <div
                key={i}
                style={{
                  fontSize: 9, textAlign: 'center', color: 'var(--text3)',
                  borderTop: '1px dashed var(--line)', paddingTop: 2,
                }}
              >
                {i + 1}
              </div>
            ))}
          </div>

          {config.widgets.length === 0 ? (
            <div
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 14, padding: '60px 20px', borderRadius: 16,
                border: '2px dashed var(--line)', background: 'var(--panel2)',
              }}
            >
              <LayoutOutlined style={{ fontSize: 40, color: 'var(--text3)' }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text2)' }}>
                从左侧点击组件开始设计
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', maxWidth: 380 }}>
                也可以直接套用模板快速搭出「中康客户看板」这类布局
              </div>
              <Space wrap style={{ justifyContent: 'center' }}>
                {DASHBOARD_TEMPLATES.map((t) => (
                  <Button key={t.key} size="small" onClick={() => applyTemplate(t.key)}>
                    {t.name}
                  </Button>
                ))}
              </Space>
            </div>
          ) : (
            /* 画布：包一层选中态包装 */
            <div
              style={{
                position: 'relative',
                padding: 0,
              }}
            >
              <CanvasGrid
                config={config}
                rows={rows}
                columns={columns}
                isMobile={isMobile}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onMove={moveWidget}
                onDelete={deleteWidget}
              />
            </div>
          )}
        </div>

        {/* 右栏 */}
        {!isMobile && (
          <div style={{ borderLeft: '1px solid var(--line)', background: 'var(--panel)', minHeight: 0 }}>
            <Inspector
              config={config}
              selected={selected}
              columns={columns}
              onChangeGlobal={patchConfig}
              onChangeWidget={patchWidget}
              onDelete={() => deleteWidget()}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════ 画布栅格（带选中态与卡片操作） ══════════════ */

function CanvasGrid({
  config, rows, columns, isMobile, selectedId, onSelect, onMove, onDelete,
}: {
  config: DashboardConfig;
  rows: RowData[];
  columns: DatasetColumn[];
  isMobile: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Row gutter={[14, 14]}>
      {config.widgets.map((w, idx) => {
        const on = w.id === selectedId;
        return (
          <Col key={w.id} xs={24} sm={w.span >= 12 ? 24 : 12} md={(w.span * 2) as number} lg={w.span}>
            <div
              onClick={(e) => { e.stopPropagation(); onSelect(w.id); }}
              style={{
                position: 'relative',
                borderRadius: 16,
                outline: on ? '2px solid var(--brand)' : '1px solid transparent',
                outlineOffset: 2,
                transition: 'outline-color .15s',
                cursor: 'pointer',
              }}
            >
              {/* 卡片操作条（hover 或选中时显示） */}
              <div
                className="canvas-actions"
                style={{
                  position: 'absolute', top: -9, right: 8, zIndex: 5,
                  display: 'flex', gap: 4,
                  opacity: on ? 1 : undefined,
                }}
              >
                <ActionBtn title="上移" disabled={idx === 0} onClick={(e) => { e.stopPropagation(); onMove(w.id, -1); }}>
                  <ArrowUpOutlined />
                </ActionBtn>
                <ActionBtn title="下移" disabled={idx === config.widgets.length - 1} onClick={(e) => { e.stopPropagation(); onMove(w.id, 1); }}>
                  <ArrowDownOutlined />
                </ActionBtn>
                <ActionBtn title="删除" danger onClick={(e) => { e.stopPropagation(); onDelete(w.id); }}>
                  <DeleteOutlined />
                </ActionBtn>
              </div>

              <DashboardRenderer
                config={{ ...config, widgets: [w] }}
                rows={rows}
                columns={columns}
                isMobile={isMobile}
                readonly
              />
            </div>
          </Col>
        );
      })}
      {/* hover 显示操作条的样式 */}
      <style>{`
        .canvas-actions { opacity: 0; transition: opacity .15s; }
        div:hover > .canvas-actions { opacity: 1 !important; }
      `}</style>
    </Row>
  );
}

function ActionBtn({
  children, title, onClick, disabled, danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Tooltip title={title}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        style={{
          width: 22, height: 22, borderRadius: 6, padding: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid var(--line)',
          background: 'var(--panel)',
          color: danger ? 'var(--danger)' : 'var(--text2)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.4 : 1,
          fontSize: 11,
          boxShadow: '0 1px 3px rgba(20,52,102,.12)',
        }}
      >
        {children}
      </button>
    </Tooltip>
  );
}
