/** 概览 / 客户签约看板 API 封装
 *
 * 对应后端（src/routes/api.js）：
 *   GET /api/dashboard      系统概览（stats + trend + recentLogs + projects）
 *   GET /api/overview       基础概览（stats + recentLogs，无趋势）
 *   GET /api/crm/dashboard  CRM 客户签约看板
 */
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { api, qs } from '@/api/client';

/* ══════════════ 系统概览 ══════════════ */

export interface DashboardStats {
  projects: number;
  activeProjects: number;
  users: number;
  activeUsers: number;
  fields: number;
  dataTotal: number;
  logTotal: number;
  datasources: number;
  reports: number;
  datasets: number;
  integrations: number;
  shares: number;
  aiChats: number;
}

export interface TrendPoint {
  /** 后端可能返回 ISO 日期、'YYYY-MM-DD' 或 'Fri Oct 23' 这类字符串 */
  date: string;
  count: number;
}

export interface RecentLogItem {
  projectId: number;
  projectName: string;
  id: number;
  op: string;
  op_label: string;
  data_id: string;
  form_name: string;
  result: string;
  created_at: string;
}

export interface DashboardProjectBrief {
  id: number;
  name: string;
  code?: string | null;
  dataCount: number;
  lastPushAt?: string | null;
}

export interface DashboardData {
  stats: DashboardStats;
  trend: TrendPoint[];
  recentLogs: RecentLogItem[];
  projects: DashboardProjectBrief[];
}

/** 系统概览（数据中台首页） */
export function fetchDashboard(): Promise<DashboardData> {
  return api.get<DashboardData>('/dashboard');
}

export interface OverviewData {
  stats: Omit<DashboardStats, 'datasources' | 'reports' | 'datasets' | 'integrations' | 'shares' | 'aiChats'>;
  recentLogs: RecentLogItem[];
}

/** 基础概览（无趋势时兜底用） */
export function fetchOverview(): Promise<OverviewData> {
  return api.get<OverviewData>('/overview');
}

/* ══════════════ 趋势数据归一化 ══════════════ */

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** 星期缩写，用于跳过（'Fri Oct 23' 的首个词是星期，不是月份） */
const WEEKDAY_RE = /^(mon|tue|wed|thu|fri|sat|sun)/i;

/**
 * 把后端趋势点解析成日期。
 *
 * 后端 `GET /api/dashboard` 用 `String(DATE(received_at)).slice(0,10)` 做聚合键，
 * 实际返回的是 `Fri Oct 23` 这种 `Date.prototype.toString()` 风格的短日期
 * （首词是星期，无年份），因此需要单独兜底解析；
 * 而 `GET /api/projects` 的 trend 又是标准 ISO 时间。两种都要吃得下。
 */
function parseTrendDate(p: TrendPoint): { d: Dayjs; count: number } | null {
  const raw = String(p?.date ?? '').trim();
  if (!raw) return null;
  const count = Number(p.count) || 0;

  // 1) ISO / YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = dayjs(raw);
    if (d.isValid()) return { d: d.startOf('day'), count };
  }

  // 2) 'Fri Oct 23' / 'Oct 23' / 'Oct 23 2026'（可能无年份）
  const tokens = raw.split(/[\s,]+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i].toLowerCase();
    if (WEEKDAY_RE.test(t)) continue;
    const mon = MONTH_INDEX[t.slice(0, 3)];
    if (mon === undefined) continue;
    const dayTok = tokens[i + 1];
    const day = Number(String(dayTok || '').replace(/\D/g, ''));
    if (!Number.isFinite(day) || day < 1 || day > 31) continue;
    // 年份：紧跟的 4 位数字；缺省则取最近一次出现的该日期
    const yearTok = tokens.slice(i + 2).find((x) => /^\d{4}$/.test(x));
    if (yearTok) {
      const d = dayjs(`${yearTok}-${String(mon + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
      if (d.isValid()) return { d: d.startOf('day'), count };
    }
    const today = dayjs().startOf('day');
    let cand = today.month(mon).date(day).startOf('day');
    if (cand.isAfter(today, 'day')) cand = cand.subtract(1, 'year');
    return { d: cand, count };
  }

  // 3) 其它可被 dayjs 识别的写法
  const fallback = dayjs(raw);
  return fallback.isValid() ? { d: fallback.startOf('day'), count } : null;
}

/**
 * 归一化趋势：合并同日数据、补齐空档、按时间升序，并输出 `MM-DD` 标签。
 * @param raw 后端返回的原始趋势点
 * @param days 无有效数据时展示的天数（默认 7）
 */
export function normalizeTrend(raw: TrendPoint[] | null | undefined, days = 7): TrendPoint[] {
  const span = Math.max(1, days);
  const parsed = (raw || [])
    .map(parseTrendDate)
    .filter((x): x is { d: Dayjs; count: number } => x !== null);

  const today = dayjs().startOf('day');
  const defaultStart = today.subtract(span - 1, 'day');

  if (!parsed.length) {
    return Array.from({ length: span }, (_, i) => ({
      date: defaultStart.add(i, 'day').format('MM-DD'),
      count: 0,
    }));
  }

  const byDay = new Map<string, number>();
  parsed.forEach((it) => {
    const key = it.d.format('YYYY-MM-DD');
    byDay.set(key, (byDay.get(key) || 0) + it.count);
  });

  // 起点：不早于「今天 - (span-1) 天」，但若数据本身更早则沿用数据起点
  let start = parsed.reduce((min, it) => (it.d.isBefore(min) ? it.d : min), today);
  if (start.isBefore(defaultStart)) start = defaultStart;

  const out: TrendPoint[] = [];
  let cur = start;
  let guard = 0;
  while ((cur.isBefore(today) || cur.isSame(today, 'day')) && guard < 62) {
    const key = cur.format('YYYY-MM-DD');
    out.push({ date: cur.format('MM-DD'), count: byDay.get(key) || 0 });
    cur = cur.add(1, 'day');
    guard += 1;
  }
  if (!out.length) {
    out.push({ date: today.format('MM-DD'), count: byDay.get(today.format('YYYY-MM-DD')) || 0 });
  }
  return out;
}

/* ══════════════ CRM 客户签约看板 ══════════════ */

export interface CrmKpi {
  total: number;
  totalStores: number;
  target: number;
  completion: number;
  inProgress: number;
  done: number;
  regions: number;
  salesCount: number;
}

export interface CrmNamedCount {
  name: string;
  count: number;
  stores: number;
}

export interface CrmStateCount {
  name: string;
  value: number;
}

export interface CrmTrend {
  label: string;
  count: number;
  stores: number;
}

/** 明细行：后端按业务含义输出中文键，值统一为标量 */
export type CrmDetailRow = Record<string, string | number>;

export interface CrmOptions {
  regions: string[];
  types: string[];
  sales: string[];
  states: string[];
}

export interface CrmDashboardData {
  project: { id: number; name: string; code?: string | null };
  updatedAt: string;
  kpi: CrmKpi;
  byRegion: CrmNamedCount[];
  byType: CrmNamedCount[];
  byFlowState: CrmStateCount[];
  salesRank: CrmNamedCount[];
  trend: CrmTrend[];
  detail: CrmDetailRow[];
  options: CrmOptions;
}

/** CRM 客户签约看板（projectId 缺省时后端取 16） */
export function fetchCrmDashboard(projectId?: number | null): Promise<CrmDashboardData> {
  return api.get<CrmDashboardData>('/crm/dashboard' + qs({ projectId: projectId || '' }));
}

/* ══════════════ 图表配色（V4.1：直接复用 @/components/Chart 的统一色板） ══════════════ */

import { CHART_COLORS as SHARED_CHART_COLORS } from '@/components/Chart';

export const CHART_COLORS = SHARED_CHART_COLORS;
