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
import { api, qs, ApiError } from '@/api/client';
import type { EChartsOption } from 'echarts';
import { CHART_COLORS, CHART_TEXT, CHART_SUB_TEXT, chartAxisStyle } from '@/components/Chart';
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
  const labelColor = dark ? '#FFFFFF' : CHART_TEXT;
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
              itemStyle: { borderWidth: 1, borderColor: dark ? '#003378' : '#FFFFFF' },
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
            labelLine: { lineStyle: { color: dark ? 'rgba(255,255,255,.3)' : '#DCDDDD' } },
            itemStyle: { borderColor: dark ? '#003378' : '#FFFFFF', borderWidth: 2 },
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
        xAxis: { type: 'value', name: xf, nameTextStyle: { color: subColor }, ...axis, splitLine: { show: true, lineStyle: { color: dark ? 'rgba(255,255,255,.12)' : '#DCDDDD', type: 'dashed' } } },
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
          splitLine: { lineStyle: { color: dark ? 'rgba(255,255,255,.16)' : '#DCDDDD' } },
          splitArea: { areaStyle: { color: ['transparent'] } },
          axisLine: { lineStyle: { color: dark ? 'rgba(255,255,255,.16)' : '#DCDDDD' } },
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
            axisLine: { lineStyle: { width: 14, color: [[1, dark ? 'rgba(255,255,255,.12)' : '#DCDDDD']] } },
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
