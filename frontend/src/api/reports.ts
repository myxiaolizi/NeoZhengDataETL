/**
 * 报表 / 数据集 / 分享 API 封装
 *
 * 契约来源：src/reports.js + src/routes/api.js（已实机核对，159 端点）
 *   GET    /api/reports                 列表（无分页，返回全量，可按 keyword 过滤）
 *   GET    /api/reports/:id             详情
 *   POST   /api/reports                 创建
 *   PUT    /api/reports/:id             更新
 *   DELETE /api/reports/:id             删除
 *   POST   /api/reports/:id/run         执行取数（注意：是 POST，不是 /data）
 *   GET    /api/reports/:id/export      CSV 导出
 *   GET    /api/datasets                数据集列表
 *   GET    /api/datasets/:id            数据集详情
 *   POST   /api/datasets/:id/preview    预览数据集（body {limit}）
 *   GET    /api/chart-types             图表类型元数据
 *   GET    /api/shares?reportId=        分享列表
 *   POST   /api/shares                  创建分享
 *   PUT    /api/shares/:id              启停（body {status}）
 *   DELETE /api/shares/:id              删除
 *   公开分享：后端暂无 JSON 接口，只有服务端渲染页 GET /s/:token（内嵌 ROWS/COLUMNS/REPORT）
 */
import { createElement, type ReactNode } from 'react';
import {
  AppstoreOutlined,
  AreaChartOutlined,
  BarChartOutlined,
  DashboardOutlined,
  FontSizeOutlined,
  FundOutlined,
  LineChartOutlined,
  NumberOutlined,
  PieChartOutlined,
  ShareAltOutlined,
  SlidersOutlined,
  TableOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import { api, qs, ApiError } from '@/api/client';
import type { EChartsOption } from 'echarts';
import { CHART_COLORS, CHART_TEXT, CHART_SUB_TEXT, chartAxisStyle } from '@/components/Chart';
import { NEUTRAL, SIDER } from '@/theme';
import { fmtNum } from '@/utils';

/* ══════════════ 类型 ══════════════ */

export type RowData = Record<string, unknown>;

export interface DatasetColumn {
  name: string;
  type?: string;
}

export interface ReportConfig {
  chartType?: string;
  title?: string;
  height?: number;
  categoryField?: string;
  valueFields?: string[];
  valueField?: string;
  xField?: string;
  yField?: string;
  gaugeMax?: number;
  columns?: string[];
  layout?: unknown;
  [key: string]: unknown;
}

export interface ReportItem {
  id: number;
  name: string;
  code?: string;
  description?: string;
  category?: string;
  reportType: string; // chart | table | dashboard
  datasetId?: number | null;
  datasetName?: string;
  config?: ReportConfig;
  layout?: unknown;
  status: number;
  viewCount?: number;
  shareCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface DatasetItem {
  id: number;
  name: string;
  code?: string;
  description?: string;
  datasourceId?: number;
  datasourceName?: string;
  sourceType?: string; // sql | table | project
  sourceSql?: string;
  sourceTable?: string;
  projectId?: number | null;
  projectName?: string;
  fields?: DatasetColumn[];
  cacheTtl?: number;
  status: number;
  createdAt?: string;
}

export interface ReportRunResult {
  report: ReportItem;
  rows: RowData[];
  columns: DatasetColumn[];
  rowCount: number;
  elapsed?: number;
}

export interface DatasetPreviewResult {
  rows: RowData[];
  columns: DatasetColumn[];
  rowCount: number;
  elapsed?: number;
}

export interface ShareItem {
  id: number;
  token: string;
  targetType: string;
  targetId: number;
  title?: string;
  hasPassword?: boolean;
  /** 后端仅向管理员返回明文密码，页面不得展示，仅用于访问校验 */
  password?: string | null;
  expiresAt?: string | null;
  allowExport?: boolean;
  viewCount?: number;
  status: number;
  createdAt?: string;
  reportName?: string;
  /** POST /shares 返回值附带 */
  url?: string;
}

export interface ShareCreatePayload {
  targetType?: string;
  targetId: number;
  title?: string;
  expiresDays?: number;
  password?: string;
  allowExport?: boolean;
}

export interface ChartTypeMeta {
  key: string;
  name: string;
  group?: string;
}

export interface ReportCreatePayload {
  name: string;
  description?: string;
  category?: string;
  reportType?: string;
  datasetId?: number | null;
  config?: ReportConfig;
  status?: number;
}

/* ══════════════ 报表 ══════════════ */

export function listReports(keyword?: string): Promise<ReportItem[]> {
  return api.get<ReportItem[]>('/reports' + qs({ keyword }));
}

export function getReport(id: number | string): Promise<ReportItem> {
  return api.get<ReportItem>(`/reports/${id}`);
}

export function createReport(payload: ReportCreatePayload): Promise<ReportItem> {
  return api.post<ReportItem>('/reports', payload);
}

export function updateReport(id: number | string, payload: Partial<ReportCreatePayload>): Promise<ReportItem> {
  return api.put<ReportItem>(`/reports/${id}`, payload);
}

export function deleteReport(id: number | string): Promise<void> {
  return api.delete<void>(`/reports/${id}`);
}

/** 执行报表取数（后端为 POST） */
export function runReport(id: number | string, limit = 2000): Promise<ReportRunResult> {
  return api.post<ReportRunResult>(`/reports/${id}/run`, { limit });
}

/** 报表 CSV 导出地址（浏览器直接下载，带登录 Cookie） */
export function reportExportUrl(id: number | string): string {
  return `/api/reports/${id}/export`;
}

/* ══════════════ 数据集 ══════════════ */

export function listDatasets(keyword?: string): Promise<DatasetItem[]> {
  return api.get<DatasetItem[]>('/datasets' + qs({ keyword }));
}

export function getDataset(id: number | string): Promise<DatasetItem> {
  return api.get<DatasetItem>(`/datasets/${id}`);
}

export function previewDataset(id: number | string, limit = 50): Promise<DatasetPreviewResult> {
  return api.post<DatasetPreviewResult>(`/datasets/${id}/preview`, { limit });
}

export function listChartTypes(): Promise<ChartTypeMeta[]> {
  return api.get<ChartTypeMeta[]>('/chart-types');
}

/** 基础图表类型（与后端 CHART_TYPES 的基础分组一致，作为接口失败时的兜底） */
export const BASE_CHART_TYPES: ChartTypeMeta[] = [
  { key: 'bar', name: '柱状图' },
  { key: 'line', name: '折线图' },
  { key: 'area', name: '面积图' },
  { key: 'pie', name: '饼图' },
  { key: 'doughnut', name: '环形图' },
  { key: 'scatter', name: '散点图' },
  { key: 'radar', name: '雷达图' },
  { key: 'funnel', name: '漏斗图' },
  { key: 'gauge', name: '仪表盘' },
  { key: 'number', name: '指标卡' },
  { key: 'table', name: '数据表格' },
];

/** 报表查看支持渲染的图表类型（基础分组 + 看板中的 KPI） */
export const RENDERABLE_CHART_TYPES = new Set([
  ...BASE_CHART_TYPES.map((t) => t.key),
  'kpi',
  'kpiSplit',
  'donutLegend',
  'semi',
  'progress',
  'rank',
  'flowmap',
  'trendBar',
  'ingList',
  'detailTable',
]);

/* ══════════════ 分享 ══════════════ */

export function listShares(reportId?: number | string): Promise<ShareItem[]> {
  return api.get<ShareItem[]>('/shares' + qs({ reportId }));
}

export function createShare(payload: ShareCreatePayload): Promise<ShareItem> {
  return api.post<ShareItem>('/shares', payload);
}

export function toggleShare(id: number | string, status: number): Promise<ShareItem> {
  return api.put<ShareItem>(`/shares/${id}`, { status });
}

export function deleteShare(id: number | string): Promise<void> {
  return api.delete<void>(`/shares/${id}`);
}

/** 分享访问地址：优先使用后端返回的 url，否则按当前站点拼装 */
export function shareUrlOf(share: ShareItem): string {
  if (share.url) return share.url;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/s/${share.token}`;
}

/* ══════════════ 公开分享（无登录态） ══════════════ */

export interface PublicShareMeta {
  id: number;
  token: string;
  targetType: string;
  targetId: number;
  expiresAt?: string | null;
  viewCount?: number;
  createdAt?: string;
  /** 后端补充该字段后即可在页面提示密码保护 */
  hasPassword?: boolean;
}

/** GET /api/public/shares/:token 的 data 结构 */
export interface PublicSharePayload {
  share: PublicShareMeta;
  targetType: string;
  targetName: string;
  payload: {
    report?: ReportItem;
    rows?: RowData[];
    columns?: DatasetColumn[];
  } | null;
}

export interface PublicShareResult {
  ok: boolean;
  /** password 表示需要访问密码 */
  code?: 'password' | 'not_found' | 'expired' | 'disabled' | 'unknown';
  message?: string;
  title?: string;
  /** V7：分享目标类型（report = 报表，board = 内置看板） */
  targetType?: string;
  /** V7：分享目标名称（看板分享时用于页头标题） */
  targetName?: string;
  /** V7：看板标识（board 分享时返回） */
  boardKey?: string;
  report?: ReportItem;
  rows?: RowData[];
  columns?: DatasetColumn[];
  rowCount?: number;
  share?: PublicShareMeta;
  /** 报表取数失败时的原因（结构仍返回） */
  runError?: string;
}

/**
 * 读取公开分享内容（无需登录）
 *
 * 使用后端只读接口 GET /api/public/shares/:token：
 *   - 不存在 / 已停用 → 404
 *   - 已过期 → 410
 *   - 成功 → { share, targetType, targetName, payload: { report, rows, columns } }
 * 后端会自动累加访问次数。
 */
export async function fetchPublicShare(token: string, password?: string): Promise<PublicShareResult> {
  const t = String(token || '').trim();
  if (!t) return { ok: false, code: 'not_found', message: '分享链接无效' };

  try {
    const data = await api.get<PublicSharePayload>(
      `/public/shares/${encodeURIComponent(t)}` + qs({ pwd: password }),
      { silent: true }
    );

    if (!data || !data.share) {
      return { ok: false, code: 'not_found', message: '分享内容为空' };
    }

    /**
     * V7：看板类型分享（targetType='board'）。
     * 后端 publicShare 不带 payload，前端会用 /api/public/board 单独取看板数据，
     * 因此这里直接放行，交给 share-view 走看板渲染分支。
     */
    if (data.targetType === 'board') {
      return {
        ok: true,
        targetType: 'board',
        targetName: data.targetName || '客户看板',
        title: data.targetName || '客户看板',
        rowCount: 0,
        rows: [],
        columns: [],
        share: data.share,
      };
    }

    if (data.targetType !== 'report' || !data.payload || !data.payload.report) {
      return {
        ok: false,
        code: 'unknown',
        message: `该分享对象类型（${data.targetType}）暂不支持在查看页展示`,
      };
    }

    const rows = data.payload.rows || [];
    const columns = data.payload.columns || [];
    return {
      ok: true,
      title: data.targetName || data.payload.report.name,
      report: data.payload.report,
      rows,
      columns,
      rowCount: rows.length,
      share: data.share,
    };
  } catch (e) {
    const err = e as ApiError;
    const status = err?.status;
    if (status === 410) return { ok: false, code: 'expired', message: '该分享链接已过期' };
    if (status === 404) return { ok: false, code: 'not_found', message: err?.message || '分享不存在或已取消' };
    if (status === 403 || err?.code === 'PASSWORD_REQUIRED') {
      return { ok: false, code: 'password', message: err?.message || '该分享已设置访问密码' };
    }
    return { ok: false, code: 'unknown', message: err?.message || '分享内容加载失败' };
  }
}

/* ══════════════ 图表 option 构建 ══════════════ */

export interface BuiltChart {
  /** 归一化后的图表类型 */
  kind: string;
  /** table / number 类型无 option */
  option: EChartsOption | null;
  /** 指标卡展示数据 */
  metric?: { label: string; value: number; total?: number };
  /** 实际渲染的系列名 */
  valueFields?: string[];
  categoryField?: string;
  isEmpty?: boolean;
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const t = v.replace(/,/g, '').trim();
    if (!t) return 0;
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v).slice(0, 80);
    } catch {
      return '';
    }
  }
  return String(v);
}

function isNumericColumn(rows: RowData[], name: string): boolean {
  let hit = 0;
  for (const r of rows.slice(0, 30)) {
    const v = r[name];
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'number') {
      hit += 1;
      continue;
    }
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(/,/g, '')))) {
      hit += 1;
      continue;
    }
    return false;
  }
  return hit > 0;
}

function pickFields(rows: RowData[], config: ReportConfig, columns?: DatasetColumn[]) {
  const colNames = columns && columns.length ? columns.map((c) => c.name) : Object.keys(rows[0] || {});
  const numeric = colNames.filter((c) => isNumericColumn(rows, c));
  const category =
    config.categoryField ||
    config.xField ||
    colNames.find((c) => !numeric.includes(c)) ||
    colNames[0] ||
    '';
  let values = config.valueFields && config.valueFields.length
    ? config.valueFields.slice()
    : config.valueField
      ? [config.valueField]
      : numeric.slice(0, 3);
  values = values.filter((v) => colNames.includes(v));
  if (!values.length) values = numeric.slice(0, 1);
  return { colNames, numeric, category, values };
}

interface Aggregated {
  cats: string[];
  series: number[][];
}

function aggregate(rows: RowData[], category: string, values: string[], limit = 40, order: 'desc' | 'none' = 'desc'): Aggregated {
  const map = new Map<string, number[]>();
  const seen: string[] = [];
  rows.forEach((r) => {
    const key = toStr(r[category]) || '（空）';
    if (!map.has(key)) {
      map.set(key, values.map(() => 0));
      seen.push(key);
    }
    const arr = map.get(key)!;
    values.forEach((v, i) => {
      arr[i] += toNum(r[v]);
    });
  });
  let keys = seen;
  if (order === 'desc') {
    keys = seen.slice().sort((a, b) => {
      const sa = map.get(a)!.reduce((x, y) => x + y, 0);
      const sb = map.get(b)!.reduce((x, y) => x + y, 0);
      return sb - sa;
    });
  }
  const picked = keys.slice(0, limit);
  return {
    cats: picked,
    series: values.map((_, vi) => picked.map((k) => Number(map.get(k)![vi].toFixed(4)))),
  };
}

function niceMax(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const n = v / base;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * base;
}

/**
 * 根据数据行 + 报表配置构建 ECharts option
 * - 数值列自动识别、分类列自动补全；同类别自动求和聚合
 * - 饼/环/漏斗/雷达限制类目数量；散点按数值列取 XY
 * - number/kpi 返回指标值；table/detailTable 返回 null（由页面渲染表格）
 */
export function buildChartOption(
  rows: RowData[],
  config: ReportConfig = {},
  opts: { dark?: boolean; limit?: number; tall?: boolean } = {}
): BuiltChart {
  const dark = !!opts.dark;
  const rawType = String(config.chartType || 'bar');
  const kind = RENDERABLE_CHART_TYPES.has(rawType) ? rawType : 'bar';
  const labelColor = dark ? NEUTRAL.textInverse : CHART_TEXT;
  const subColor = dark ? 'rgba(255,255,255,.65)' : CHART_SUB_TEXT;
  const axis = chartAxisStyle(dark);

  if (!rows.length) return { kind, option: null, isEmpty: true };

  const { colNames, numeric, category, values } = pickFields(rows, config);
  if (!colNames.length) return { kind, option: null, isEmpty: true };

  const valueFields = values.length ? values : numeric.slice(0, 1);
  const limit = Math.max(6, Math.min(opts.limit || 40, 200));
  const legend = valueFields.length > 1 ? { top: 0, textStyle: { color: subColor, fontSize: 11 } } : undefined;
  const grid = {
    left: 8,
    right: 16,
    top: valueFields.length > 1 ? 40 : 18,
    bottom: 6,
    containLabel: true,
  };

  const base: EChartsOption = {
    color: [...CHART_COLORS],
    grid,
    legend,
  };

  const nameOf = (f: string) => config.title ? `${config.title}` : f;

  /* 指标卡 */
  if (kind === 'number' || kind === 'kpi' || kind === 'kpiSplit') {
    // 未显式配置数值字段时（如看板类报表 config 仅有 chartType），展示数据行数更有意义
    const explicit = (config.valueFields && config.valueFields.length) || config.valueField;
    const vf = explicit ? valueFields[0] : '';
    const value = !explicit
      ? rows.length
      : rows.length === 1
        ? toNum(rows[0][vf])
        : rows.reduce((s, r) => s + toNum(r[vf]), 0);
    return {
      kind: 'number',
      option: null,
      metric: {
        label: config.title || (explicit ? vf || '指标' : '数据行数'),
        value,
        total: rows.length,
      },
      valueFields: explicit ? [vf] : [],
      categoryField: category,
    };
  }

  /* 表格类 */
  if (kind === 'table' || kind === 'detailTable') {
    return { kind: 'table', option: null, valueFields, categoryField: category };
  }

  /* 饼图 / 环形图 / 漏斗图：仅取第一个数值列 */
  if (kind === 'pie' || kind === 'doughnut' || kind === 'funnel') {
    const vf = valueFields[0];
    const agg = aggregate(rows, category, [vf], kind === 'funnel' ? 10 : 12, 'desc');
    const data = agg.cats.map((c, i) => ({ name: c, value: agg.series[0][i] }));
    if (kind === 'funnel') {
      return {
        kind,
        option: {
          ...base,
          legend: undefined,
          tooltip: { trigger: 'item' },
          series: [
            {
              type: 'funnel',
              left: '8%',
              right: '8%',
              top: 24,
              bottom: 16,
              minSize: '8%',
              sort: 'descending',
              gap: 2,
              label: { color: labelColor, fontSize: 11 },
              itemStyle: { borderWidth: 1, borderColor: dark ? SIDER.bgTo : NEUTRAL.surface },
              data,
            },
          ],
        },
        valueFields: [vf],
        categoryField: category,
      };
    }
    return {
      kind,
      option: {
        ...base,
        grid: undefined,
        legend: { bottom: 0, textStyle: { color: subColor, fontSize: 11 }, itemWidth: 9, itemHeight: 9 },
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        series: [
          {
            type: 'pie',
            radius: kind === 'doughnut' ? ['42%', '68%'] : ['0%', '66%'],
            center: ['50%', '46%'],
            avoidLabelOverlap: true,
            label: { color: subColor, fontSize: 11 },
            labelLine: { lineStyle: { color: dark ? 'rgba(255,255,255,.3)' : NEUTRAL.border } },
            itemStyle: { borderColor: dark ? SIDER.bgTo : NEUTRAL.surface, borderWidth: 2 },
            data,
          },
        ],
      },
      valueFields: [vf],
      categoryField: category,
    };
  }

  /* 散点图：两个数值列 */
  if (kind === 'scatter') {
    const xf = config.xField && colNames.includes(config.xField) ? config.xField : numeric[0] || colNames[0];
    const yf =
      config.yField && colNames.includes(config.yField)
        ? config.yField
        : numeric.find((n) => n !== xf) || numeric[0] || colNames[1] || colNames[0];
    const data = rows.slice(0, 800).map((r) => [toNum(r[xf]), toNum(r[yf])]);
    return {
      kind,
      option: {
        ...base,
        legend: undefined,
        tooltip: {
          trigger: 'item',
          formatter: (p: unknown) => {
            const arr = (p as { value?: number[] }).value || [];
            return `${xf}: ${arr[0]}<br/>${yf}: ${arr[1]}`;
          },
        },
        xAxis: { type: 'value', name: xf, nameTextStyle: { color: subColor }, ...axis, splitLine: { show: true, lineStyle: { color: dark ? 'rgba(255,255,255,.12)' : NEUTRAL.borderSubtle, type: 'dashed' } } },
        yAxis: { type: 'value', name: yf, nameTextStyle: { color: subColor }, ...axis },
        series: [{ type: 'scatter', symbolSize: 9, itemStyle: { opacity: 0.8 }, data }],
      },
      valueFields: [xf, yf],
      categoryField: category,
    };
  }

  /* 雷达图 */
  if (kind === 'radar') {
    const agg = aggregate(rows, category, valueFields.slice(0, 3), 8, 'desc');
    const maxes = agg.cats.map((_, i) => Math.max(...agg.series.map((s) => s[i] || 0), 1));
    return {
      kind,
      option: {
        ...base,
        grid: undefined,
        legend: { bottom: 0, textStyle: { color: subColor, fontSize: 11 } },
        tooltip: { trigger: 'item' },
        radar: {
          center: ['50%', '46%'],
          radius: '62%',
          indicator: agg.cats.map((c, i) => ({ name: c, max: niceMax(maxes[i] * 1.2) })),
          axisName: { color: subColor, fontSize: 10 },
          splitLine: { lineStyle: { color: dark ? 'rgba(255,255,255,.16)' : NEUTRAL.border } },
          splitArea: { areaStyle: { color: ['transparent'] } },
          axisLine: { lineStyle: { color: dark ? 'rgba(255,255,255,.16)' : NEUTRAL.border } },
        },
        series: [
          {
            type: 'radar',
            symbolSize: 4,
            areaStyle: { opacity: 0.16 },
            data: valueFields.slice(0, 3).map((f, vi) => ({ name: f, value: agg.series[vi] })),
          },
        ],
      },
      valueFields: valueFields.slice(0, 3),
      categoryField: category,
    };
  }

  /* 仪表盘：单指标 */
  if (kind === 'gauge' || kind === 'semi') {
    const vf = valueFields[0];
    const value = rows.length === 1 ? toNum(rows[0][vf]) : rows.reduce((s, r) => s + toNum(r[vf]), 0);
    const max = Number(config.gaugeMax) > 0 ? Number(config.gaugeMax) : niceMax(value);
    return {
      kind: 'gauge',
      option: {
        ...base,
        grid: undefined,
        legend: undefined,
        tooltip: { trigger: 'item' },
        series: [
          {
            type: 'gauge',
            min: 0,
            max,
            radius: kind === 'semi' ? '88%' : '78%',
            startAngle: kind === 'semi' ? 200 : 220,
            endAngle: kind === 'semi' ? -20 : -40,
            progress: { show: true, width: 14, itemStyle: { color: CHART_COLORS[0] } },
            axisLine: { lineStyle: { width: 14, color: [[1, dark ? 'rgba(255,255,255,.12)' : NEUTRAL.borderSubtle]] } },
            axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: { show: false },
            pointer: { width: 4, itemStyle: { color: CHART_COLORS[2] } },
            anchor: { show: true, size: 8, itemStyle: { color: CHART_COLORS[2] } },
            title: { color: subColor, fontSize: 12, offsetCenter: [0, '78%'] },
            detail: {
              valueAnimation: true,
              fontSize: opts.tall ? 34 : 26,
              fontWeight: 700,
              color: labelColor,
              offsetCenter: [0, '40%'],
              formatter: (v: number) => fmtNum(v),
            },
            data: [{ value, name: config.title || vf || '指标' }],
          },
        ],
      },
      valueFields: [vf],
      categoryField: category,
    };
  }

  /* 柱 / 折线 / 面积 / 看板趋势 */
  const isLine = kind === 'line' || kind === 'area' || kind === 'trendBar';
  const agg = aggregate(rows, category, valueFields, limit, isLine ? 'none' : 'desc');
  const asLine = isLine && kind !== 'trendBar';

  const series = valueFields.map((f, i) => ({
    name: nameOf(f),
    type: (asLine ? 'line' : 'bar') as 'line' | 'bar',
    smooth: asLine,
    symbol: asLine ? 'circle' : undefined,
    symbolSize: asLine ? 6 : undefined,
    showSymbol: asLine ? agg.cats.length <= 30 : undefined,
    barMaxWidth: asLine ? undefined : 26,
    itemStyle: asLine
      ? { lineStyle: { width: 2.4 }, color: CHART_COLORS[i % CHART_COLORS.length] }
      : { borderRadius: [4, 4, 0, 0], color: CHART_COLORS[i % CHART_COLORS.length] },
    areaStyle: kind === 'area' ? { opacity: 0.18 } : undefined,
    emphasis: { focus: 'series' as const },
    data: agg.series[i] || [],
  }));

  return {
    kind,
    option: {
      ...base,
      tooltip: { trigger: 'axis', axisPointer: { type: asLine ? 'line' : 'shadow' } },
      xAxis: {
        type: 'category',
        data: agg.cats,
        boundaryGap: !asLine,
        ...axis,
        splitLine: { show: false },
        axisLabel: { color: subColor, fontSize: 11, rotate: agg.cats.length > 12 ? 30 : 0, hideOverlap: true },
      },
      yAxis: { type: 'value', ...axis },
      series,
    },
    valueFields,
    categoryField: category,
  };
}

/* ══════════════════════════════════════════════════════════════
 * V6.0 看板式报表（DashboardConfig）
 *
 * 契约来源：_work/V6-CONTRACT.md §4.2（数据模型写死，前后端共用）
 * 存储位置：报表现有 config 字段（JSON），不新增数据库列
 *   { version: 2, mode: 'dashboard', title, subtitle, datasetId,
 *     filters: [], widgets: [], theme: { mode } }
 * 本段为纯追加，未改动上方任何既有导出。
 * ══════════════════════════════════════════════════════════════ */

/** 看板卡片类型（14 种，见契约 §4.2） */
export type WidgetType =
  | 'kpi' // 大数字卡片（可带拆分）
  | 'donut' // 圆环图（中心总数 + 图例）
  | 'semiGauge' // 半圆进度
  | 'progress' // 横向进度条组
  | 'flowMap' // 横向流程节点链
  | 'rank' // 排行榜（前 N + 奖牌 + 标签）
  | 'bar' // 柱状图
  | 'stackBar' // 堆叠柱
  | 'line' // 折线
  | 'combo' // 柱 + 线双轴
  | 'pie' // 饼图
  | 'heatmap' // 热力矩阵
  | 'table' // 明细表
  | 'text'; // 富文本/说明

/** 12 栅格体系下的卡片宽度 */
export type WidgetSpan = 3 | 4 | 6 | 8 | 12;

/** 聚合方式 */
export type WidgetAgg = 'sum' | 'count' | 'avg' | 'max' | 'min';

/** 看板全局筛选器定义 */
export interface DashboardFilterDef {
  /** date / region / chainType / sales ... */
  key: string;
  /** 显示名 */
  label: string;
  type: 'date' | 'select' | 'multiSelect' | 'search';
  /** 对应数据集列 */
  field?: string;
  /** select 的候选项（空则运行时从数据取） */
  options?: string[];
  width?: number;
}

/** 明细表列配置 */
export interface DashboardWidgetColumn {
  key: string;
  title: string;
  width?: number;
  format?: string;
}

/** 看板卡片（widget） */
export interface DashboardWidget {
  /** 唯一，如 'w_1' */
  id: string;
  type: WidgetType;
  title: string;
  /** 栅格占位（12 栅格体系） */
  span: WidgetSpan;
  height?: number;
  /** 数据源：不填则用 config.datasetId */
  datasetId?: number | null;
  /** 指标/维度配置（按 type 取用） */
  metric?: string;
  metrics?: string[];
  dimension?: string;
  dimensions?: string[];
  /** 聚合方式 */
  agg?: WidgetAgg;
  /** 图表专属配置 */
  chart?: Record<string, unknown>;
  /** 列配置（table 用） */
  columns?: DashboardWidgetColumn[];
  /** 是否可点击下钻 */
  drillable?: boolean;
}

/** 看板配置（存进报表 config 字段） */
export interface DashboardConfig {
  version: 2;
  /** 标志是看板式 */
  mode: 'dashboard';
  title?: string;
  subtitle?: string;
  /** 默认数据集，widget 可覆盖 */
  datasetId?: number | null;
  /** 全局筛选器定义 */
  filters?: DashboardFilterDef[];
  /** 卡片列表，顺序 = 渲染顺序 */
  widgets: DashboardWidget[];
  /** 主题 */
  theme?: { mode?: 'light' | 'dark'; accent?: string };
}

/** 设计器栅格总数 */
export const DASHBOARD_GRID = 12;

/** 全部卡片类型（顺序 = 设计器组件库顺序） */
export const WIDGET_TYPES: WidgetType[] = [
  'kpi',
  'donut',
  'semiGauge',
  'progress',
  'flowMap',
  'rank',
  'bar',
  'stackBar',
  'line',
  'combo',
  'pie',
  'heatmap',
  'table',
  'text',
];

/** 卡片类型元数据（设计器左栏组件库用） */
export const WIDGET_META: {
  type: WidgetType;
  name: string;
  icon: ReactNode;
  desc: string;
  defaultSpan: WidgetSpan;
}[] = [
  { type: 'kpi', name: '指标卡', icon: createElement(NumberOutlined), desc: '大数字 + 可选拆分', defaultSpan: 3 },
  { type: 'donut', name: '圆环图', icon: createElement(PieChartOutlined), desc: '中心总数 + 右侧图例', defaultSpan: 3 },
  { type: 'semiGauge', name: '半圆进度', icon: createElement(DashboardOutlined), desc: '进度环 + 下方进度条', defaultSpan: 3 },
  { type: 'progress', name: '进度条组', icon: createElement(SlidersOutlined), desc: '横向进度条列表', defaultSpan: 4 },
  { type: 'flowMap', name: '流程图', icon: createElement(ShareAltOutlined), desc: '横向节点链', defaultSpan: 12 },
  { type: 'rank', name: '排行榜', icon: createElement(TrophyOutlined), desc: '前 N 名 + 奖牌 + 标签', defaultSpan: 4 },
  { type: 'bar', name: '柱状图', icon: createElement(BarChartOutlined), desc: '分类对比柱状图', defaultSpan: 6 },
  { type: 'stackBar', name: '堆叠柱', icon: createElement(AreaChartOutlined), desc: '多指标堆叠对比', defaultSpan: 6 },
  { type: 'line', name: '折线图', icon: createElement(LineChartOutlined), desc: '趋势折线', defaultSpan: 6 },
  { type: 'combo', name: '组合图', icon: createElement(FundOutlined), desc: '柱 + 线双 y 轴', defaultSpan: 6 },
  { type: 'pie', name: '饼图', icon: createElement(PieChartOutlined), desc: '占比饼图', defaultSpan: 4 },
  { type: 'heatmap', name: '热力矩阵', icon: createElement(AppstoreOutlined), desc: '二维密度矩阵', defaultSpan: 6 },
  { type: 'table', name: '明细表', icon: createElement(TableOutlined), desc: '分页明细表', defaultSpan: 12 },
  { type: 'text', name: '富文本', icon: createElement(FontSizeOutlined), desc: '说明文字/备注', defaultSpan: 12 },
];

/** 判断一个 config 是否为看板式配置（空对象/老配置/缺字段均安全返回 false） */
export function isDashboardConfig(c: unknown): c is DashboardConfig {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  const o = c as Record<string, unknown>;
  if (o.mode !== 'dashboard') return false;
  return Array.isArray(o.widgets);
}

/**
 * 归一化看板配置：补齐 version/mode/widgets，过滤非法 widget，纠正 span
 * - config 为空时返回一份最小可用配置（空画布不崩）
 * - 未知 type 的 widget 直接丢弃
 */
export function normalizeDashboardConfig(
  raw: unknown,
  fallbackDatasetId?: number | null
): DashboardConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<DashboardConfig> & Record<string, unknown>;
  const list = Array.isArray(src.widgets) ? src.widgets : [];
  const widgets: DashboardWidget[] = [];
  list.forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    const w = item as Partial<DashboardWidget>;
    const type = (WIDGET_TYPES.includes(w.type as WidgetType) ? w.type : '') as WidgetType;
    if (!type) return;
    const span = [3, 4, 6, 8, 12].includes(Number(w.span)) ? (Number(w.span) as WidgetSpan) : 6;
    widgets.push({
      id: String(w.id || `w_${i + 1}`),
      type,
      title: String(w.title ?? '') || (WIDGET_META.find((m) => m.type === type)?.name || type),
      span,
      height: Number(w.height) > 0 ? Number(w.height) : undefined,
      datasetId: w.datasetId === undefined ? undefined : w.datasetId === null ? null : Number(w.datasetId),
      metric: w.metric ? String(w.metric) : undefined,
      metrics: Array.isArray(w.metrics) ? w.metrics.map(String) : undefined,
      dimension: w.dimension ? String(w.dimension) : undefined,
      dimensions: Array.isArray(w.dimensions) ? w.dimensions.map(String) : undefined,
      agg: (['sum', 'count', 'avg', 'max', 'min'] as string[]).includes(String(w.agg))
        ? (w.agg as WidgetAgg)
        : 'sum',
      chart: w.chart && typeof w.chart === 'object' ? (w.chart as Record<string, unknown>) : undefined,
      columns: Array.isArray(w.columns) ? (w.columns as DashboardWidgetColumn[]) : undefined,
      drillable: !!w.drillable,
    });
  });
  const dsId =
    src.datasetId === null ? null : Number.isFinite(Number(src.datasetId)) ? Number(src.datasetId) : fallbackDatasetId ?? null;
  return {
    version: 2,
    mode: 'dashboard',
    title: src.title ? String(src.title) : undefined,
    subtitle: src.subtitle ? String(src.subtitle) : undefined,
    datasetId: dsId,
    filters: Array.isArray(src.filters) ? (src.filters as DashboardFilterDef[]) : undefined,
    widgets,
    theme: src.theme && typeof src.theme === 'object' ? src.theme : { mode: 'light' },
  };
}

/** 造一张卡片（模板与设计器共用） */
function mkWidget(
  id: string,
  type: WidgetType,
  title: string,
  span: WidgetSpan,
  extra: Partial<DashboardWidget> = {}
): DashboardWidget {
  const meta = WIDGET_META.find((m) => m.type === type);
  return { id, type, title, span: span || (meta?.defaultSpan ?? 6), agg: 'sum', ...extra };
}

/**
 * 预设模板（设计器一键应用）
 * - zk-client：中康智能体客户看板（kpi×2 + donut + semiGauge + flowMap + rank + stackBar + table）
 * - sales-ops：销售经营看板（kpi×3 + bar + line + rank + table）
 * - blank：空白
 *
 * 指标/维度列名只是「期望列名」，渲染器找不到时会自动回退到数据集真实列，
 * 因此换任何数据集都不会出现空图表。
 */
export const DASHBOARD_TEMPLATES: {
  key: string;
  name: string;
  desc: string;
  config: DashboardConfig;
}[] = [
  {
    key: 'zk-client',
    name: '中康客户看板',
    desc: '圆环 + 大数字 + 半圆进度 + 流程链 + 排行 + 趋势 + 明细',
    config: {
      version: 2,
      mode: 'dashboard',
      title: '中康智能体客户看板',
      subtitle: '签约 / 门店 / 任务进度一张图看清',
      datasetId: null,
      theme: { mode: 'light' },
      widgets: [
        mkWidget('w_1', 'donut', '签约客户', 3, {
          dimension: '区域',
          metric: '客户数',
          chart: { centerLabel: '总客户数', countLabel: '家' },
        }),
        mkWidget('w_2', 'kpi', '门店总数', 3, {
          dimension: '区域',
          metric: '门店数',
          chart: { split: true, unit: '家', dot: 'cyan' },
        }),
        mkWidget('w_3', 'semiGauge', '任务完成进度', 3, {
          dimension: '区域',
          metric: '任务数',
          chart: { target: 500, hint: '目标 500 家', bars: true },
        }),
        mkWidget('w_4', 'kpi', '流程完成', 3, {
          dimension: '区域',
          metric: '已完成',
          chart: { split: true, unit: '家', dot: 'green' },
        }),
        mkWidget('w_5', 'flowMap', '流程状态分布', 12, {
          dimension: '流程状态',
          metric: '客户数',
        }),
        mkWidget('w_6', 'rank', '销售排行榜', 4, {
          dimension: '销售',
          metric: '客户数',
          chart: { topN: 5, tagField: '连锁类型', unit: '家' },
        }),
        mkWidget('w_7', 'stackBar', '签约趋势', 8, {
          dimension: '日期',
          metrics: ['签约客户数', '签约门店数'],
          chart: { legend: true },
        }),
        mkWidget('w_8', 'table', '签约明细', 12, {
          chart: { pageSize: 10 },
        }),
      ],
    },
  },
  {
    key: 'sales-ops',
    name: '销售经营看板',
    desc: '销售额 / 订单 / 客单价 + 区域柱 + 趋势折线 + 排行 + 明细',
    config: {
      version: 2,
      mode: 'dashboard',
      title: '销售经营看板',
      subtitle: '业绩、订单、客单价与区域分布',
      datasetId: null,
      theme: { mode: 'light' },
      widgets: [
        mkWidget('w_1', 'kpi', '销售额', 4, { metric: '销售额', chart: { unit: '元', dot: 'brand' } }),
        mkWidget('w_2', 'kpi', '订单数', 4, { metric: '订单数', chart: { unit: '单', dot: 'cyan' } }),
        mkWidget('w_3', 'kpi', '客单价', 4, { metric: '客单价', agg: 'avg', chart: { unit: '元', dot: 'purple' } }),
        mkWidget('w_4', 'bar', '各区域销售额', 6, { dimension: '区域', metric: '销售额' }),
        mkWidget('w_5', 'rank', '销售排行榜', 6, {
          dimension: '销售',
          metric: '销售额',
          chart: { topN: 5, unit: '元' },
        }),
        mkWidget('w_6', 'line', '销售趋势', 12, { dimension: '日期', metric: '销售额' }),
        mkWidget('w_7', 'table', '销售明细', 12),
      ],
    },
  },
  {
    key: 'blank',
    name: '空白',
    desc: '从零开始，从左侧组件库添加卡片',
    config: {
      version: 2,
      mode: 'dashboard',
      title: '新建看板',
      subtitle: '',
      datasetId: null,
      theme: { mode: 'light' },
      widgets: [],
    },
  },
];

/** 表格展示列（排除超长文本字段，避免表格被撑爆） */
export function pickTableColumns(rows: RowData[], columns?: DatasetColumn[], max = 12): string[] {
  const names = columns && columns.length ? columns.map((c) => c.name) : Object.keys(rows[0] || {});
  const out: string[] = [];
  for (const n of names) {
    if (/raw_json|_json$/i.test(n)) continue;
    const sample = rows.slice(0, 5).map((r) => toStr(r[n]));
    const maxLen = Math.max(0, ...sample.map((s) => s.length));
    if (maxLen > 120) continue;
    out.push(n);
    if (out.length >= max) break;
  }
  return out.length ? out : names.slice(0, max);
}
