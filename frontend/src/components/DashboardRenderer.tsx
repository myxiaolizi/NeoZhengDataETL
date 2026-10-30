/**
 * 看板渲染器（V6.0）
 *
 * 输入 DashboardConfig + 数据行，按 config.widgets 顺序用 12 栅格渲染 14 种卡片。
 * 纪律：
 *  - 不自己发请求（数据一律 props 下发）
 *  - 空 config / 缺字段 / 未知类型都不崩（卡片级 ErrorBoundary 兜底）
 *  - 卡片外壳统一走 dash-widgets/shared 的 CardShell（契约 §2.2）
 *  - 供 /reports/:id/view 与设计器「预览/画布」共用
 */
import React, { useMemo } from 'react';
import { Col, Row } from 'antd';
import type { DashboardConfig, DashboardWidget, DatasetColumn, RowData, WidgetType } from '@/api/reports';
import { WIDGET_META } from '@/api/reports';
import { CardShell, DASH_HOVER_CSS, dashThemeStyle } from './dash-widgets/shared';
import type { WidgetProps } from './dash-widgets/shared';
import KpiWidget from './dash-widgets/KpiWidget';
import DonutWidget from './dash-widgets/DonutWidget';
import SemiGaugeWidget from './dash-widgets/SemiGaugeWidget';
import ProgressWidget from './dash-widgets/ProgressWidget';
import FlowMapWidget from './dash-widgets/FlowMapWidget';
import RankWidget from './dash-widgets/RankWidget';
import BarWidget from './dash-widgets/BarWidget';
import StackBarWidget from './dash-widgets/StackBarWidget';
import LineWidget from './dash-widgets/LineWidget';
import ComboWidget from './dash-widgets/ComboWidget';
import PieWidget from './dash-widgets/PieWidget';
import HeatmapWidget from './dash-widgets/HeatmapWidget';
import TableWidget from './dash-widgets/TableWidget';
import TextWidget from './dash-widgets/TextWidget';

/** 每张卡片独立数据源时的数据（key = String(datasetId)） */
export interface DashboardDatasetData {
  rows: RowData[];
  columns?: DatasetColumn[];
}

export interface DashboardRendererProps {
  config: DashboardConfig;
  rows: RowData[];
  columns?: DatasetColumn[];
  isMobile?: boolean;
  /** 设计器用：点击卡片触发选中 */
  onWidgetClick?: (id: string) => void;
  selectedId?: string;
  /** 预览/只读模式隐藏交互 */
  readonly?: boolean;
  /** 卡片级数据源覆盖：widget.datasetId 命中时优先用这里的数据 */
  datasetRows?: Record<string, DashboardDatasetData>;
  /** 设计器用：卡片头部右侧操作区（调序 / 删除） */
  headerActions?: (w: DashboardWidget) => React.ReactNode;
  /** 空画布占位（设计器传引导，预览页用默认文案） */
  emptyHint?: React.ReactNode;
}

/** 卡片级错误兜底：单张卡片出错不影响整页 */
class WidgetBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div
          style={{
            padding: '22px 12px',
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--text3, #93a7c2)',
            border: '1px dashed var(--line, #dde8f6)',
            borderRadius: 11,
            background: 'var(--panel2, #f7faff)',
          }}
        >
          该卡片渲染失败（配置或数据类型不匹配）
        </div>
      );
    }
    return this.props.children;
  }
}

/** 按类型分发到 14 个小组件 */
function renderWidgetBody(type: WidgetType, props: WidgetProps): React.ReactNode {
  switch (type) {
    case 'kpi':
      return <KpiWidget {...props} />;
    case 'donut':
      return <DonutWidget {...props} />;
    case 'semiGauge':
      return <SemiGaugeWidget {...props} />;
    case 'progress':
      return <ProgressWidget {...props} />;
    case 'flowMap':
      return <FlowMapWidget {...props} />;
    case 'rank':
      return <RankWidget {...props} />;
    case 'bar':
      return <BarWidget {...props} />;
    case 'stackBar':
      return <StackBarWidget {...props} />;
    case 'line':
      return <LineWidget {...props} />;
    case 'combo':
      return <ComboWidget {...props} />;
    case 'pie':
      return <PieWidget {...props} />;
    case 'heatmap':
      return <HeatmapWidget {...props} />;
    case 'table':
      return <TableWidget {...props} />;
    case 'text':
      return <TextWidget {...props} />;
    default:
      return (
        <div style={{ padding: '18px 0', textAlign: 'center', fontSize: 12, color: 'var(--text3, #93a7c2)' }}>
          未知卡片类型
        </div>
      );
  }
}

export default function DashboardRenderer({
  config,
  rows,
  columns,
  isMobile,
  onWidgetClick,
  selectedId,
  readonly,
  datasetRows,
  headerActions,
  emptyHint,
}: DashboardRendererProps) {
  const dark = config?.theme?.mode === 'dark';
  const widgets = useMemo<DashboardWidget[]>(
    () => (config && Array.isArray(config.widgets) ? config.widgets.filter((w) => w && typeof w === 'object') : []),
    [config]
  );
  const safeRows = Array.isArray(rows) ? rows : [];
  const interactive = !readonly && typeof onWidgetClick === 'function';

  const metaOf = (w: DashboardWidget) => WIDGET_META.find((m) => m.type === w.type);

  if (!widgets.length) {
    return (
      <div style={dashThemeStyle(dark)}>
        <style>{DASH_HOVER_CSS}</style>
        {emptyHint || (
          <div
            style={{
              padding: '44px 16px',
              textAlign: 'center',
              fontSize: 13,
              color: 'var(--text3, #93a7c2)',
              border: '1px dashed var(--line, #dde8f6)',
              borderRadius: 16,
              background: 'var(--panel, #fff)',
            }}
          >
            这个看板还没有卡片
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={dashThemeStyle(dark)}>
      <style>{DASH_HOVER_CSS}</style>
      <Row gutter={[14, 14]}>
        {widgets.map((w) => {
          const meta = metaOf(w);
          const dataKey = w.datasetId === null || w.datasetId === undefined ? '' : String(w.datasetId);
          const override = dataKey && datasetRows ? datasetRows[dataKey] : undefined;
          const wRows = override ? override.rows || [] : safeRows;
          const wCols = override?.columns && override.columns.length ? override.columns : columns;
          const bodyMinHeight = w.height && w.height > 60 ? Math.max(60, w.height - 46) : undefined;
          const hint = interactive
            ? `${meta?.name || w.type} · ${w.span ?? 6}/${12}`
            : undefined;

          return (
            <Col key={w.id || Math.random().toString(36)} span={isMobile ? 24 : w.span || 6} style={{ minWidth: 0 }}>
              <WidgetBoundary>
                <CardShell
                  title={w.title || meta?.name || '未命名卡片'}
                  dot={typeof w.chart?.dot === 'string' ? w.chart.dot : undefined}
                  hint={hint}
                  actions={headerActions ? headerActions(w) : undefined}
                  active={interactive && selectedId === w.id}
                  onClick={interactive ? () => onWidgetClick?.(w.id) : undefined}
                  bodyStyle={
                    bodyMinHeight
                      ? { minHeight: bodyMinHeight, padding: isMobile ? '12px 12px' : '15px 16px' }
                      : { padding: isMobile ? '12px 12px' : '15px 16px' }
                  }
                >
                  {renderWidgetBody(w.type, {
                    widget: w,
                    rows: wRows,
                    columns: wCols,
                    isMobile,
                    dark,
                  })}
                </CardShell>
              </WidgetBoundary>
            </Col>
          );
        })}
      </Row>
    </div>
  );
}
