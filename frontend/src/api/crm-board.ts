/** V5.0 中康智能体客户看板 · API 类型与请求封装
 *
 * 对应后端（src/crmboard.js / src/routes/api.js）：
 *   GET /api/crm/board          看板全量数据（含筛选）
 *   GET /api/crm/board/detail   明细服务端分页
 *
 * 口径定义见 _work/V5-CONTRACT.md，任何字段语义以该文件为准。
 */
import { api, qs } from '@/api/client';

/* ══════════════ 基础枚举 ══════════════ */

export type Region = '南区' | '北区';

export type ChainType = '全国百强' | '区县百强' | '50+' | '50-';

/** 签约类型（精简为 2 类） */
export type SignType = 'SIC合作签约' | '新连锁签约';

/** 流程节点（固定 9 个，顺序即流程图顺序） */
export type FlowNode =
  | '销售签约'
  | '策略开通'
  | '实施对接'
  | '对接审核'
  | '客服处理'
  | '客户培训'
  | '连锁使用'
  | '策略审核'
  | '流程结束';

/** 固定节点顺序（流程图、占比、下拉都用它） */
export const FLOW_NODES: FlowNode[] = [
  '销售签约', '策略开通', '实施对接', '对接审核', '客服处理',
  '客户培训', '连锁使用', '策略审核', '流程结束',
];

/** 固定连锁类型顺序（第 3 排从上至下） */
export const CHAIN_TYPES: ChainType[] = ['全国百强', '区县百强', '50+', '50-'];

/** 有效数据的连锁类型（50- 为无效） */
export const VALID_CHAIN_TYPES: ChainType[] = ['全国百强', '区县百强', '50+'];

/* ══════════════ 筛选 ══════════════ */

export type DatePreset =
  | 'all' | 'today' | 'yesterday' | 'thisWeek' | 'lastWeek'
  | 'thisMonth' | 'lastMonth' | 'custom';

/** 需要显示同环比的 preset（本周/上周/本月/上月） */
export const COMPARE_PRESETS: DatePreset[] = ['thisWeek', 'lastWeek', 'thisMonth', 'lastMonth'];

export interface BoardFilters {
  datePreset: DatePreset;
  dateFrom: string;          // YYYY-MM-DD，空=不限
  dateTo: string;
  regions: string[];         // 空=全部
  chainTypes: string[];
  sales: string[];
  flowStatus: string[];
  service: string[];
  solution: string[];
  trainer: string[];
  version: string[];
  connectResult: string[];
  trainResult: string[];
  openedStrategy: string[];
  validOnly: boolean;
}

export function emptyFilters(): BoardFilters {
  return {
    datePreset: 'all',
    dateFrom: '',
    dateTo: '',
    regions: [],
    chainTypes: [],
    sales: [],
    flowStatus: [],
    service: [],
    solution: [],
    trainer: [],
    version: [],
    connectResult: [],
    trainResult: [],
    openedStrategy: [],
    validOnly: false,
  };
}

/** 已生效的筛选条件个数（用于「重置」旁的角标） */
export function countActiveFilters(f: BoardFilters): number {
  let n = 0;
  if (f.datePreset !== 'all') n += 1;
  const keys: (keyof BoardFilters)[] = [
    'regions', 'chainTypes', 'sales', 'flowStatus', 'service', 'solution',
    'trainer', 'version', 'connectResult', 'trainResult', 'openedStrategy',
  ];
  keys.forEach((k) => {
    const v = f[k];
    if (Array.isArray(v) && v.length) n += 1;
  });
  if (f.validOnly) n += 1;
  return n;
}

/* ══════════════ 下拉可选项 & 计数 ══════════════ */

export interface BoardOptions {
  regions: string[];
  chainTypes: string[];
  sales: string[];
  flowStatus: string[];
  service: string[];
  solution: string[];
  trainer: string[];
  version: string[];
  connectResult: string[];
  trainResult: string[];
  openedStrategy: string[];
}

/** 每个筛选按钮后面显示的「当前客户数」 */
export interface BoardCounts {
  region: Record<string, number>;      // 南区/北区
  chainType: Record<string, number>;
  sales: Record<string, number>;
  flowStatus: Record<string, number>;
  service: Record<string, number>;
  solution: Record<string, number>;
  trainer: Record<string, number>;
  version: Record<string, number>;
  connectResult: Record<string, number>;
  trainResult: Record<string, number>;
  openedStrategy: Record<string, number>;
}

/* ══════════════ 明细行 ══════════════ */

/** 明细行（第 1/2 排弹窗用） */
export interface DetailRow {
  chainId: string;
  region: string;
  chainName: string;
  chainType: string;
  stores: number;
  node: string;              // 当前节点（流程完成时为空串）
  owner: string;             // 处理人
  enterNodeAt: string;       // ISO，进入当前节点时间
  enterNodeDate: string;     // 'MM/DD'
  nodeDays: number;          // 当前节点时长（天）
  submitAt: string;          // ISO
  submitDate: string;        // 'MM/DD'
  totalDays: number;         // 连锁总时长（天）
  status: '正常' | '超期';
  sales: string;
  service: string;
  solution: string;
  trainer: string;
}

/** 明细表完整行（第 10 排） */
export interface DetailFullRow extends DetailRow {
  seq: number;
  signType: string;
  province: string;
  signDate: string;          // 'MM月DD日'
  submitLabel: string;       // 'MM月DD日'
  submitDays: number;        // 提交时长（天）
  openedStrategies: number;  // 开通策略数
  runningStrategies: number; // 运行策略数
  reachedPeople: number;     // 触达人数
  reachRate: number;         // 到店率 0~1
  couponRate: number;        // 优惠券核销率 0~1
  ownerRole: string;         // 当前负责人岗位
  /* ── V7 新增列 ── */
  currentOwner: string;      // 当前处理人
  currentNodeHours: number;  // 当前节点处理时长（小时）
  currentNodeDuration: string; // 当前节点处理时长（<24h 显示 X.X时，否则 X.X天）
  lastNodeAt: string;        // 上节点时间（= 进入当前节点时间）
}

/* ══════════════ 第 1 排：签约卡片 ══════════════ */

export interface RegionSplit {
  south: number;
  north: number;
}

/** V7：带未知桶的三段拆分（保证 south + north + unknown === total） */
export interface SplitValue {
  south: number;
  north: number;
  unknown?: number;
  total: number;
}

export interface ProgressBlock {
  achieved: number;
  target: number;
  rate: number;              // 0~100
  /** V7：任务口径连锁数（= achieved） */
  chains?: number;
  /** V7：不计入任务的连锁数（50- 等） */
  excluded?: number;
  south: { achieved: number; target: number; rate: number };
  north: { achieved: number; target: number; rate: number };
}

export interface SignTypeItem {
  name: string;              // SIC合作签约 / 新连锁签约
  clients: number;
  stores: number;
  south: number;
  north: number;
  /** 按连锁类型拆分 */
  byChainType: { name: string; clients: number; stores: number }[];
}

/** 进行中：按岗位/节点分组的连锁数 + 明细 */
export interface InProgressGroup {
  name: string;
  count: number;
  rows: DetailRow[];
}

/** V7：进行中岗位桶（五类互斥，合计 = total） */
export interface InProgressBucket {
  total: number;
  south: number;
  north: number;
  groups: InProgressGroup[];
}

export interface InProgressBlock {
  total: number;
  /** V7：五类合计（应恒等于 total，用于自检） */
  sumOfBuckets?: number;
  strategy: InProgressBucket;
  implement: InProgressBucket;
  service: InProgressBucket;
  solution: InProgressBucket;
  sales: InProgressBucket;
}

/** V7：流程结束（4 组指标 × 汇总/南/北） */
export interface FlowStatusBlock {
  completedClients: number;   // 客户数
  completedStores: number;    // 门店数
  south: number;
  north: number;
  storesSouth?: number;
  storesNorth?: number;
  strategyOpened: number;     // 开通策略（客户数）
  strategyNotOpened: number;  // 未开策略（客户数）
  openedSouth?: number;
  openedNorth?: number;
  notOpenedSouth?: number;
  notOpenedNorth?: number;
}

export interface Row1Data {
  totalClients: number;
  totalClientsByRegion: RegionSplit;
  totalStores: number;
  storesByRegion: RegionSplit;
  progress: ProgressBlock;
  signTypes: SignTypeItem[];
  inProgress: InProgressBlock;
  flowStatus: FlowStatusBlock;
}

/* ══════════════ 第 2 排：流程状态分布 ══════════════ */

export interface FlowNodeItem {
  key: FlowNode | string;
  name: string;
  clients: number;
  ratio: number;             // 0~1（分母已排除 销售签约/流程结束）
  stores: number;
  avgDays: number;           // 平均处理时长（天）
  /** V7：平均耗时（小时），前端按 <1天 显示 X.X时 */
  avgHours?: number;
  /** V7：该节点是否有「耗时」概念（销售签约 / 流程结束 为 false） */
  hasTime?: boolean;
  /** V7：正常家数（当前节点时长 ≤ 7 天） */
  normal?: number;
  /** V7：超期家数（当前节点时长 > 7 天） */
  overdue?: number;
  byRole: { role: string; count: number }[];
  rows: DetailRow[];
}

export interface Row2Data {
  nodes: FlowNodeItem[];
}

/* ══════════════ 第 3 排：类型汇总 + 排行榜 ══════════════ */

export interface TypeDistItem {
  name: string;
  clients: number;
  stores: number;
  south: number;
  north: number;
}

export interface RankTag {
  name: string;              // 连锁类型
  count: number;
}

export interface RankItem {
  rank: number;
  name: string;              // 销售名 / 省份名
  clients: number;
  stores: number;
  /** V7：省份榜的代表销售名 */
  salesName?: string;
  salesCount?: number;
  tags: RankTag[];           // 名称下方的类型标签
}

export interface Row3Data {
  typeDistribution: TypeDistItem[];
  salesClientRank: RankItem[];
  salesStoreRank: RankItem[];
  provinceRank: RankItem[];
}

/* ══════════════ 第 4-5 排：同环比 ══════════════ */

export interface CompareRow {
  name: string;              // 全部/有效/无效 或 连锁类型 或 销售名
  current: number;           // 本期
  previous: number;          // 上期
  ratio: number | null;      // 环比 %，上期为 0 时 null
  cumulative: number;        // 累计
}

export interface CompareData {
  label: { current: string; previous: string };  // 如 本期(10/20-10/26) / 上期(...)
  clients: CompareRow[];      // 签约客户环比：全部/有效/无效
  stores: CompareRow[];       // 签约门店环比：全部/有效/无效
  byChainType: CompareRow[];  // 按连锁类型
  bySales: CompareRow[];      // 按销售
  bySalesType: CompareRow[];  // 按销售×连锁类型（name 形如 "郑飞 · 50+"）
}

/* ══════════════ 第 6 排：签约趋势 + 流程推进 ══════════════ */

export interface SignTrendData {
  days: string[];            // 'MM-DD'，最近 30 天
  south: number[];           // 客户数（南区）
  north: number[];           // 客户数（北区）
  stores: number[];          // 门店数（不分南北）
  /** 按连锁类型拆分的客户数，用于图例快捷多选 */
  byChainType: Record<string, { south: number[]; north: number[] }>;
}

export interface FlowProgressData {
  days: string[];            // 最近 5 个工作日 'MM-DD'
  /** V7: 'MM月DD日' */
  daysCn?: string[];
  nodes: string[];           // 节点名
  /** matrix[nodeIndex][dayIndex] = 完成数 */
  matrix: number[][];
  /** V7：按区域拆分（区域筛选按钮用） */
  byRegion?: Record<string, { matrix: number[][] }>;
  /** V7：区域扁平字段 */
  matrixSouth?: number[][];
  matrixNorth?: number[][];
}

export interface Row6Data {
  signTrend: SignTrendData;
  flowProgress: FlowProgressData;
  strategyClients: { total: number; south: number; north: number };
}

/* ══════════════ 第 7 排：客户运行情况 ══════════════ */

export interface MetricPair {
  south: number;
  north: number;
  total: number;
}

/** 有开通/运行策略连锁数 */
export interface ChainStrategyMetric {
  chains: MetricPair;        // 连锁数
  strategies: MetricPair;    // 策略数
}

/** 率类指标 */
export interface RateMetric {
  south: number;             // 0~1
  north: number;
  total: number;
}

/** 金额类指标 */
export interface AmountMetric {
  south: number;
  north: number;
  total: number;
  /** 人均转化销售 */
  perCapita: MetricPair;
}

/** 人数类指标 */
export interface PeopleMetric {
  reached: MetricPair;       // 触达人数
  couponIssued: MetricPair;  // 优惠券发放人数
}

/** V7：带未知桶的三段拆分（保证 south + north + unknown === total） */
export interface SplitValue {
  south: number;
  north: number;
  unknown?: number;
  total: number;
}

/** V7：成本指标组 */
export interface CostMetrics {
  channelCost: SplitValue;   // 渠道成本
  couponCost: SplitValue;    // 用券成本
  totalCost: SplitValue;     // 成本合计 = 渠道 + 用券
  couponGmv: SplitValue;     // 用券销售额
  roi: SplitValue;           // 营销ROI = 成本合计 ÷ 转化销售额
}

export interface Row7Data {
  openedStrategy: ChainStrategyMetric;
  runningStrategy: ChainStrategyMetric;
  reachRate: RateMetric;          // 触达到店率
  couponRate: RateMetric;         // 优惠券核销率
  conversion: AmountMetric;       // 转化销售额 + 人均转化销售
  people: PeopleMetric;           // 触达人数 + 优惠券发放人数
  /** V7：成本与 ROI（第 8 排新增指标） */
  cost?: CostMetrics;
}

/* ══════════════ 第 8 排：按策略模型×类型 ══════════════ */

export interface ModelTypeItem {
  model: string;             // 策略模块
  type: string;              // 策略类型
  south: Row7Data;
  north: Row7Data;
  total: Row7Data;
}

/** V7：按模块聚合的树（模块 → 类型） */
export interface ModelGroup {
  model: string;
  types: ModelTypeItem[];
  south: Row7Data;
  north: Row7Data;
  total: Row7Data;
}

export interface Row8Data {
  items: ModelTypeItem[];
  /** V7：树形结构（前端画「模块 → 类型」链接图用） */
  modules?: ModelGroup[];
  /** V7：实际生效的日期区间 */
  range?: { from: string; to: string } | null;
  rowCount?: number;
}

/* ══════════════ 第 9 排：近 30 日趋势 ══════════════ */

export interface RunTrendData {
  days: string[];            // 'MM-DD'
  daysCn?: string[];         // V7: 'MM月DD日'
  reached: number[];         // 触达人数
  runningChains: number[];   // 运行连锁数
  openedStrategies: number[];// 开通策略数
  runningStrategies: number[];// 运行策略数
  reachRate: number[];       // 到店率 0~1
  couponRate: number[];      // 优惠券核销率 0~1
  /** V7 新增：成本与 ROI 趋势 */
  channelCost?: number[];
  couponCost?: number[];
  totalCost?: number[];
  roi?: number[];
}

/* ══════════════ 第 10 排：明细表 ══════════════ */

export interface DetailColumnConf {
  key: keyof DetailFullRow | string;
  title: string;
  width?: number;
  /** 是否默认显示 */
  default?: boolean;
  /** 对齐 */
  align?: 'left' | 'center' | 'right';
  /** 数字格式：percent 显示为百分比 */
  format?: 'percent' | 'num' | 'text';
}

/* ══════════════ 顶层 ══════════════ */

export interface BoardMeta {
  syncedAt: string;          // 最新数据同步时间 ISO
  generatedAt: string;
  dateLabel: string;         // 日期按钮文案：全部/今日/昨日/本周/上周/本月/上月/起止日期
  target: number;
  /** 是否进入同环比模式 */
  isCompareMode: boolean;
  filters: BoardFilters;
  options: BoardOptions;
  counts: BoardCounts;
}

export interface BoardData {
  meta: BoardMeta;
  row1: Row1Data;
  row2: Row2Data;
  row3: Row3Data;
  compare: CompareData | null;
  row6: Row6Data;
  row7: Row7Data;
  row8: Row8Data;
  row9: RunTrendData;
  detail: { columns: DetailColumnConf[]; rows: DetailFullRow[] };
}

/* ══════════════ 请求 ══════════════ */

/** 把 BoardFilters 转成 query 对象（数组用逗号连接） */
export function filtersToQuery(f: BoardFilters): Record<string, string> {
  const join = (a: string[]) => (a && a.length ? a.join(',') : '');
  return {
    datePreset: f.datePreset,
    dateFrom: f.dateFrom || '',
    dateTo: f.dateTo || '',
    regions: join(f.regions),
    chainTypes: join(f.chainTypes),
    sales: join(f.sales),
    flowStatus: join(f.flowStatus),
    service: join(f.service),
    solution: join(f.solution),
    trainer: join(f.trainer),
    version: join(f.version),
    connectResult: join(f.connectResult),
    trainResult: join(f.trainResult),
    openedStrategy: join(f.openedStrategy),
    validOnly: f.validOnly ? '1' : '0',
  };
}

/** 拉取看板全量数据 */
export function fetchBoard(filters: BoardFilters, opts?: { silent?: boolean }): Promise<BoardData> {
  return api.get<BoardData>('/crm/board' + qs(filtersToQuery(filters)), { silent: opts?.silent });
}

export interface DetailPage {
  total: number;
  page: number;
  pageSize: number;
  rows: DetailFullRow[];
}

/** 明细服务端分页（「更多」弹窗用） */
export function fetchBoardDetail(
  filters: BoardFilters,
  page = 1,
  pageSize = 20,
): Promise<DetailPage> {
  return api.get<DetailPage>(
    '/crm/board/detail' + qs({ ...filtersToQuery(filters), page, pageSize }),
  );
}

/* ══════════════ 图表配色（V7 语义色，契约 §2.1） ══════════════ */

export const PALETTE = {
  brand: '#2563eb',
  brand2: '#3b82f6',
  brand3: '#60a5fa',
  green: '#10b981',
  warn: '#f59e0b',
  danger: '#ef4444',
  cyan: '#06b6d4',
  purple: '#8b5cf6',
  yellow: '#eab308',
  gray: '#94a3b8',
  /* 兼容 V5/V6 命名 */
  primary: '#2563eb',
  primaryDeep: '#1d4ed8',
  primaryLight: '#3b82f6',
  primarySoft: '#93c5fd',
  ink: '#16253d',
  orange: '#f59e0b',
  red: '#ef4444',
  grayLight: '#dde8f6',
  white: '#FFFFFF',
  black: '#000000',
} as const;

/** 图表序列色（按序取） */
export const CHART_SERIES = [
  '#2563eb', '#10b981', '#f59e0b', '#8b5cf6',
  '#06b6d4', '#ef4444', '#3b82f6', '#94a3b8',
] as const;

/**
 * 区域固定配色（契约 §2.1）
 *   南区 = 蓝 #2563eb，北区 = 绿 #10b981
 */
export const REGION_COLORS: Record<string, string> = {
  南区: '#2563eb',
  北区: '#10b981',
};

/**
 * 连锁类型固定配色（契约 §2.1）
 *   全国百强 = 红，区县百强 = 橙，50+ = 黄，50- = 灰
 */
export const CHAIN_TYPE_COLORS: Record<string, string> = {
  全国百强: '#ef4444',
  区县百强: '#f59e0b',
  '50+': '#eab308',
  '50-': '#94a3b8',
};

/** 连锁类型简写（排行榜等窄空间使用） */
export const CHAIN_TYPE_SHORT: Record<string, string> = {
  全国百强: '全国',
  区县百强: '区县',
  '50+': '50+',
  '50-': '50-',
};

/** 区域顺序（图表/图例统一顺序：先南后北） */
export const REGION_ORDER = ['南区', '北区'] as const;
