'use strict';
/**
 * V5.0 中康智能体客户看板 · 数据聚合模块
 *
 * 数据源（Lead 实测确认，见 _work/V5-CONTRACT.md §三）：
 *   jdywh_parsed_16     CRM表单推送    96 行   —— 每个签约客户一行（主表）
 *   jdywh_parsed_102    CRM流程推送    357 行  —— 流程事件（流程推进）
 *   jdywh_mail_30       运行汇总       最新一天 —— 按连锁
 *   jdywh_mail_31       运行明细       最新一天 —— 按连锁 × 策略
 *   zkcrm-ry            人员对应表     30 行   —— 区域/省份/销售/客服/解决方案/产品经理/实施
 *
 * 口径全部集中在 _work/V5-CONTRACT.md §3.2，改口径先改文档。
 */

const db = require('./db');

/* ══════════════════════════════════════════════════════════════════
 * 一、常量与字段映射
 * ══════════════════════════════════════════════════════════════════ */

/** jdywh_parsed_16 关键列 */
const C = {
  chainId: 'widget_1791449342205',
  chainName: 'widget_1791449342206',
  chainType: 'widget_1792048325267',
  region: 'widget_1791449342211',
  stores: 'widget_1792048325259',
  signSubject: 'widget_1791449342209',
  sales: 'widget_1791449342208_p',
  service: 'widget_1791509478932_p',
  solution: 'w_1792139730147_p',
  trainer: 'widget_1791509478935_p',
  signTime: 'widget_1791510326270_p',
  nodeField: 'widget_1791533061604',
  currentNode: 'flow_current_node',
  currentOwner: 'flow_current_owner',
  flowState: 'sys_flow_state_2',
  openedStrategy: 'widget_1791964258708_p',
  strategyOpenStatus: 'w_1793089366506',
  version: 'w_1792577110570',
  connectResult: 'widget_1792029306426',
  trainResult: 'w_1792552277283',
  province: 'w_1792139730191',
  sicStores: 'w_1793101382910',
  /** 签约类型原始字段：'SIC合作连锁签约' / 空 */
  signTypeRaw: 'w_1793343168111',
  // 8 个节点时间列
  tSubmit: 'w_1793094135522_p',
  tStrategyOpen: 'w_1793094135524_p',
  tImplement: 'w_1793094135538_p',
  tImplAudit: 'w_1793094135578_p',
  tService: 'w_1793094135592_p',
  tTrain: 'w_1793094135593_p',
  tChainUse: 'w_1793094135594_p',
  tStrategyAudit: 'w_1793094135608_p',
};

/** 9 个流程节点（顺序即流程图顺序） */
const FLOW_NODES = [
  '销售签约', '策略开通', '实施对接', '对接审核', '客服处理',
  '客户培训', '连锁使用', '策略审核', '流程结束',
];

/** 节点 → 该节点的「进入时间」列（用于当前节点时长） */
const NODE_TIME_COL = {
  销售签约: C.tSubmit,
  策略开通: C.tStrategyOpen,
  实施对接: C.tImplement,
  对接审核: C.tImplAudit,
  客服处理: C.tService,
  客户培训: C.tTrain,
  连锁使用: C.tChainUse,
  策略审核: C.tStrategyAudit,
  流程结束: null,
};

/**
 * V7.1 超期口径：按「工作日」计算。
 *
 * 定义：**上一节点结束时间** 到 **现在** 之间经过的**工作日**数，超过该节点阈值即超期。
 * 工作日 = 排除周六日（不含法定节假日调整，业务上可接受）。
 *
 * 实测数据事实（96 条客户）：
 *   w_1793094135522_p 销售签约完成 95 条
 *   w_1793094135524_p 策略开通完成 95 条
 *   w_1793094135538_p 实施对接完成 53 条
 *   w_1793094135578_p 对接审核完成 10 条
 *   w_1793094135592_p 客服处理完成 24 条
 *   w_1793094135593_p 客户培训完成 19 条
 *   w_1793094135594_p 连锁使用完成  4 条
 *   w_1793094135608_p 策略审核完成  5 条
 */
const NODE_OVERDUE_RULE = {
  销售签约: { days: null, prevCol: null },                      // 起点，不算超期
  策略开通: { days: 2, prevCol: 'tSubmit' },                    // 上一节点=销售签约完成
  实施对接: { days: 5, prevCol: 'tStrategyOpen' },              // 上一节点=策略开通完成
  对接审核: { days: 2, prevCol: 'tImplement' },                 // 上一节点=实施对接完成
  客服处理: { days: 10, prevCol: 'tImplAudit' },                // 上一节点=对接审核完成
  客户培训: { days: 3, prevCol: 'tService' },                   // 上一节点=客服处理完成
  连锁使用: { days: 5, prevCol: 'tTrain' },                     // 上一节点=客户培训完成
  策略审核: { days: 2, prevCol: 'tChainUse' },                  // 上一节点=连锁使用完成
  流程结束: { days: null, prevCol: 'tStrategyAudit' },          // 终点，不算超期
};

/**
 * V8.1：各节点的「完成时间」列（parsed_16）。
 *
 * 用于「流程处理」按日统计每日各节点完成了多少客户。
 * 这组列在 V7.1 已用于「工作日超期」计算（见 NODE_OVERDUE_RULE），语义确认为「该节点的完成时间」。
 *
 * 实测日期分布（96 条客户）：
 *   销售签约: 10-22:61 10-23:3 10-26:13 10-27:5 10-28:10 10-29:3 10-31:1
 *   策略开通: 10-22:60 10-23:4 10-26:13 10-27:5 10-28:10 10-29:3 10-31:1
 *   实施对接: 10-22:34 10-23:3 10-26:1  10-27:7 10-28:7  10-29:1 10-31:1
 *   对接审核: 10-22:8  10-23:1 10-27:1
 *   客服处理: 10-22:21 10-23:1 10-26:1 10-27:1
 *   客户培训: 10-22:17 10-23:1 10-27:1
 *   连锁使用: 10-22:4
 *   策略审核: 10-22:4  10-27:1
 *   流程结束: 无独立时间列（用当前节点为空判定，不参与按日统计）
 */
/** V10：客户 ERP 名称列（jdywh_parsed_16） */
const ERP_COL = 'w_1793089366573';

const NODE_DONE_COL = [
  { node: '销售签约', col: 'w_1793094135522_p' },
  { node: '策略开通', col: 'w_1793094135524_p' },
  { node: '实施对接', col: 'w_1793094135538_p' },
  { node: '对接审核', col: 'w_1793094135578_p' },
  { node: '客服处理', col: 'w_1793094135592_p' },
  { node: '客户培训', col: 'w_1793094135593_p' },
  { node: '连锁使用', col: 'w_1793094135594_p' },
  { node: '策略审核', col: 'w_1793094135608_p' },
  { node: '流程结束', col: null },
];

/**
 * 计算两个日期之间的工作日天数（排除周六日）。
 * 结束时间晚于开始时间；只数 (start, end] 区间内的工作日。
 *
 * @param {Date} start 起始（上一节点结束）
 * @param {Date} end 结束（通常为 now）
 * @returns {number} 工作日数（>=0）
 */
function workdaysBetween(start, end) {
  if (!start || !end) return 0;
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (e <= s) return 0;
  let count = 0;
  const cur = new Date(s);
  let guard = 0;
  while (cur < e && guard < 3650) {
    cur.setDate(cur.getDate() + 1);
    const wd = cur.getDay();
    if (wd !== 0 && wd !== 6) count += 1;
    guard += 1;
  }
  return count;
}
const NODE_ALIAS = {
  开始: '销售签约',
  销售签约: '销售签约',
  策略开通: '策略开通',
  开通: '策略开通',
  策略审核: '策略审核',
  实施对接: '实施对接',
  系统对接: '实施对接',
  系统测试: '实施对接',
  落地执行: '实施对接',
  渠道费充值: '实施对接',
  解决方案确认: '实施对接',
  对接审核: '对接审核',
  客服处理: '客服处理',
  客户培训: '客户培训',
  使用培训: '客户培训',
  连锁使用: '连锁使用',
  流程结束: '流程结束',
  流程完成: '流程结束',
  客户结论: '流程结束',
  '': '流程结束',
};

/** 不参与占比计算的节点 */
const RATIO_EXCLUDED = ['销售签约', '流程结束'];

/** 有效数据的连锁类型（50- 为无效） */
const VALID_CHAIN_TYPES = ['全国百强', '区县百强', '50+'];

/** 连锁类型固定展示顺序 */
const CHAIN_TYPE_ORDER = ['全国百强', '区县百强', '50+', '50-'];

/** 超期阈值（天） */
const OVERDUE_DAYS = 7;

/** 默认任务目标 */
const DEFAULT_TARGET = 500;

/** mail_30 / mail_31 列映射 */
const M = {
  chainId: 'c_83e39dbb17',
  chainName: 'c_448242f358',
  model: 'c_1076e6bbbb',        // 策略模块（仅 mail_31）
  type: 'c_0511a2713b',         // 策略类型（仅 mail_31）
  touchAt: 'c_41f1cc4881',      // 策略开通&触达时间（仅 mail_31）
  cycle: 'c_6b5acd302f',        // 触达转化周期（仅 mail_31）
  openedStrategies: 'c_70bbab893f',
  runningStrategies: 'c_c75741ce78',
  sent: 'c_8428aa48e0',         // 发送人数
  arrived: 'c_a6bfcce0cb',      // 到店人数
  revisitRate: 'c_9a055525e4',  // 回店率
  gmv: 'c_0b4adaa5d2',          // 转化销售额
  couponIssuedPeople: 'c_6ce1a4580f', // 发券人数
  couponIssued: 'c_ba19841b19',       // 发券张数
  couponUsedPeople: 'c_f38e0dcb75',   // 用券人数
  couponUsed: 'c_c6568a9b1e',         // 用券张数
  couponUseRate: 'c_a5815395ba',      // 用券率（按人）
  couponGmv: 'c_0964f9ffab',          // 用券销售额
  couponCost: 'c_81f128a3b7',         // V7 用券成本
  channelCost: 'c_783814dcb3',        // V7 渠道成本（短信+外呼）
  statDate: 'c_793d0ececa',           // 统计时间（仅 mail_30）
};

/* ══════════════════════════════════════════════════════════════════
 * 二、工具函数
 * ══════════════════════════════════════════════════════════════════ */

/** 安全数字 */
function n(v) {
  if (v === null || v === undefined || v === '') return 0;
  const x = Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(x) ? x : 0;
}

/** 安全字符串（去空白） */
function s(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/**
 * V14：判断某个时间列是否「真的有值」。
 * 排除 NULL / 空串 / MySQL 零值日期 '0000-00-00 00:00:00'。
 */
function hasTime(v) {
  const t = s(v);
  return !!t && !t.startsWith('0000-00-00');
}

/** 安全除，分母 0 返回 0 */
function div(a, b) {
  const x = n(a);
  const y = n(b);
  if (!y) return 0;
  return x / y;
}

/** 保留小数 */
function round(v, d = 2) {
  const p = 10 ** d;
  return Math.round((Number(v) || 0) * p) / p;
}

/** 人名归一化：去掉括号/邮箱/空格，莎→沙 等价（人员表是「戴丽莎」，CRM 是「戴丽沙」） */
function normName(v) {
  let x = s(v).replace(/\([^)]*\)/g, '').replace(/<[^>]*>/g, '').trim();
  x = x.replace(/\s+/g, '');
  return x;
}

/** 人名比较键：把「莎」统一成「沙」，规避两表用字不一致 */
function nameKey(v) {
  return normName(v).replace(/莎/g, '沙');
}

/**
 * 解析时间值为 Date。
 * 支持：Date / 数字时间戳 / 'YYYY-MM-DD HH:mm:ss' / 'YYYY-MM-DD' / ISO。
 */
function toDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  const str = String(v).trim();
  if (!str) return null;
  if (/^\d{10,13}$/.test(str)) {
    const num = Number(str);
    const d = new Date(str.length === 10 ? num * 1000 : num);
    return isNaN(d.getTime()) ? null : d;
  }
  // 'YYYY-MM-DD HH:mm:ss' → 'YYYY-MM-DDTHH:mm:ss'（无时区后缀 = 本地时间，符合数据实际含义）
  const d = new Date(str.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

/** 'YYYY-MM-DD' */
function ymd(v) {
  const d = toDate(v);
  if (!d) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 'MM/DD' */
function md(v) {
  const d = toDate(v);
  if (!d) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

/** 'MM月DD日' */
function mdCn(v) {
  const d = toDate(v);
  if (!d) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)}月${p(d.getDate())}日`;
}

/** 天数差（今天 - 过去），保留 1 位小数 */
function daysSince(v, now) {
  const d = toDate(v);
  if (!d) return 0;
  const diff = (now.getTime() - d.getTime()) / 86400000;
  return round(Math.max(0, diff), 1);
}

/** 生成 [start, end] 的日期序列 'YYYY-MM-DD' */
function dateRange(start, end) {
  const out = [];
  const a = toDate(start);
  const b = toDate(end);
  if (!a || !b) return out;
  const cur = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const last = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  let guard = 0;
  while (cur.getTime() <= last.getTime() && guard < 400) {
    out.push(ymd(cur));
    cur.setDate(cur.getDate() + 1);
    guard += 1;
  }
  return out;
}

/** 该日期是否为工作日（周一~周五） */
function isWorkday(d) {
  const w = d.getDay();
  return w !== 0 && w !== 6;
}

/** 解析逗号分隔的多选参数 */
function parseList(v) {
  if (!v) return [];
  return String(v)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 按固定顺序排序连锁类型，未知类型追加在末尾 */
function sortChainTypes(names) {
  const known = CHAIN_TYPE_ORDER.filter((t) => names.includes(t));
  const extra = names.filter((t) => !CHAIN_TYPE_ORDER.includes(t)).sort();
  return [...known, ...extra];
}

/* ══════════════════════════════════════════════════════════════════
 * 三、日期区间计算（预设 → [from, to]）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 根据 datePreset 计算起止日期。
 * @returns {{from:string,to:string,label:string}}
 */
function resolveDateRange(preset, dateFrom, dateTo, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const p = (x) => String(x).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const addDays = (d, k) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + k);
    return x;
  };
  /** 本周一 */
  const monday = (d) => addDays(d, -(((d.getDay() + 6) % 7)));
  /** 本月 1 号 */
  const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
  /** 本月最后一天 */
  const monthEnd = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

  switch (preset) {
    case 'today':
      return { from: fmt(today), to: fmt(today), label: '今日' };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: fmt(y), to: fmt(y), label: '昨日' };
    }
    case 'thisWeek': {
      const mon = monday(today);
      const sun = addDays(mon, 6);
      return { from: fmt(mon), to: fmt(sun), label: '本周' };
    }
    case 'lastWeek': {
      const mon = addDays(monday(today), -7);
      const sun = addDays(mon, 6);
      return { from: fmt(mon), to: fmt(sun), label: '上周' };
    }
    case 'thisMonth': {
      const from = monthStart(today);
      const to = monthEnd(today);
      return { from: fmt(from), to: fmt(to), label: '本月' };
    }
    case 'lastMonth': {
      const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return { from: fmt(monthStart(prev)), to: fmt(monthEnd(prev)), label: '上月' };
    }
    case 'custom': {
      const f = dateFrom || '';
      const t = dateTo || dateFrom || '';
      if (!f) return { from: '', to: '', label: '全部' };
      return {
        from: f,
        to: t,
        label: f === t ? `${md(f)}` : `${md(f)}-${md(t)}`,
      };
    }
    case 'all':
    default:
      return { from: '', to: '', label: '全部' };
  }
}

/**
 * 计算上期（紧邻的等长区间）。
 * 本周 → 上周；本月 → 上月；自定义 → 往前推同样天数。
 */
function previousRange(preset, from, to, now) {
  const p = (x) => String(x).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const addDays = (d, k) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + k);
    return x;
  };

  if (preset === 'thisWeek') {
    const r = resolveDateRange('lastWeek', '', '', now);
    return { from: r.from, to: r.to };
  }
  if (preset === 'lastWeek') {
    const mon = addDays(resolveToDate(resolveDateRange('lastWeek', '', '', now).from, now), -7);
    return { from: fmt(mon), to: fmt(addDays(mon, 6)) };
  }
  if (preset === 'thisMonth') {
    const r = resolveDateRange('lastMonth', '', '', now);
    return { from: r.from, to: r.to };
  }
  if (preset === 'lastMonth') {
    const d = resolveToDate(resolveDateRange('lastMonth', '', '', now).from, now);
    const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    return { from: fmt(prev), to: fmt(new Date(prev.getFullYear(), prev.getMonth() + 1, 0)) };
  }
  // custom / 其它：往前推等长天数
  const a = resolveToDate(from, now);
  const b = resolveToDate(to || from, now);
  if (!a || !b) return { from: '', to: '' };
  const span = Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
  return { from: fmt(addDays(a, -span)), to: fmt(addDays(a, -1)) };
}

/** 把 'YYYY-MM-DD' 解析成本地 0 点 Date */
function resolveToDate(v, now) {
  if (!v) return null;
  const d = toDate(v);
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/* ══════════════════════════════════════════════════════════════════
 * 四、数据加载
 * ══════════════════════════════════════════════════════════════════ */

/** 表是否存在 */
async function tableExists(name) {
  try {
    const rows = await db.query(
      'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1',
      [name],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** 加载 CRM 客户主表（parsed_16） */
async function loadClients() {
  if (!(await tableExists('jdywh_parsed_16'))) return [];
  const all = Array.from(new Set([
    'jdy_data_id',
    ...Object.values(C),
    'flow_current_node',
    'flow_current_owner',
    'updated_at',
    /* V10：ERP 分布需要「连锁ERP名称」列 */
    ERP_COL,
  ])).filter(Boolean);
  const sql = `SELECT ${all.map((c) => `\`${c}\``).join(', ')} FROM jdywh_parsed_16 ORDER BY id ASC`;
  return db.query(sql);
}

/** 加载人员对应表 */
async function loadStaff() {
  if (!(await tableExists('zkcrm-ry'))) {
    return { region: {}, province: {}, sales: new Set(), service: new Set(), solution: new Set(), implement: new Set(), pm: new Set() };
  }
  const rows = await db.query('SELECT * FROM `zkcrm-ry`');
  const sales = new Set();
  const service = new Set();
  const solution = new Set();
  const implement = new Set();
  const pm = new Set();
  const region = {};
  const province = {};
  rows.forEach((r) => {
    const rg = s(r['区域']);
    const pv = s(r['省份']);
    if (rg && pv) region[pv] = rg;
    if (pv) province[pv] = rg;
    const sa = normName(r['销售']); if (sa) sales.add(nameKey(sa));
    const kf = normName(r['客服']); if (kf) service.add(nameKey(kf));
    const so = normName(r['解决方案']); if (so) solution.add(nameKey(so));
    const im = normName(r['实施']); if (im) implement.add(nameKey(im));
    const p = normName(r['产品经理']); if (p) pm.add(nameKey(p));
  });
  return { region, province, sales, service, solution, implement, pm };
}

/** 加载最新一天运行汇总（mail_30） */
async function loadRunSummary() {
  if (!(await tableExists('jdywh_mail_30'))) return { rows: [], importDate: null };
  const mx = await db.query('SELECT MAX(import_date) AS d FROM jdywh_mail_30');
  const d = mx[0] ? mx[0].d : null;
  if (!d) return { rows: [], importDate: null };
  const rows = await db.query('SELECT * FROM jdywh_mail_30 WHERE import_date = ?', [d]);
  return { rows, importDate: d };
}

/** 加载最新一天运行明细（mail_31） */
async function loadRunDetail() {
  if (!(await tableExists('jdywh_mail_31'))) return { rows: [], importDate: null };
  const mx = await db.query('SELECT MAX(import_date) AS d FROM jdywh_mail_31');
  const d = mx[0] ? mx[0].d : null;
  if (!d) return { rows: [], importDate: null };
  const rows = await db.query('SELECT * FROM jdywh_mail_31 WHERE import_date = ?', [d]);
  return { rows, importDate: d };
}

/** 加载流程事件（parsed_102），只取必要列 */
async function loadFlowEvents() {
  if (!(await tableExists('jdywh_parsed_102'))) return [];
  const rows = await db.query(
    `SELECT event_instance_id, event_flow_name, header_created_at, header_created_at_p,
            event_created_count, event_completed_count, event_current_assignee, event_finish_action
     FROM jdywh_parsed_102
     ORDER BY header_created_at ASC`,
  );
  return rows;
}

/** 最新数据同步时间 */
async function resolveSyncedAt(clients, run30, run31) {
  let best = null;
  const bump = (v) => {
    const d = toDate(v);
    if (d && (!best || d > best)) best = d;
  };
  clients.forEach((r) => bump(r.updated_at));
  if (run30.importDate) bump(run30.importDate);
  if (run31.importDate) bump(run31.importDate);
  return best ? best.toISOString() : new Date().toISOString();
}

/* ══════════════════════════════════════════════════════════════════
 * 五、行级标准化
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 判断签约类型（SIC合作签约 / 新连锁签约）。
 *
 * 真值来源：`w_1793343168111`，实测取值只有两种 —— 'SIC合作连锁签约'(7 条) / 空(89 条)。
 * 该字段是简道云表单的「签约类型」单选，是唯一权威来源。
 * 兜底：若该字段为空但连锁名称/签约主体含 'SIC' 字样，也判为 SIC 合作签约。
 */
function resolveSignType(raw) {
  const rawType = s(raw[C.signTypeRaw]);
  if (rawType) {
    if (/SIC/i.test(rawType)) return 'SIC合作签约';
    if (/新连锁|新签/.test(rawType)) return '新连锁签约';
    return '新连锁签约';
  }
  const name = s(raw[C.chainName]);
  const subject = s(raw[C.signSubject]);
  if (/SIC/i.test(name) || /SIC/i.test(subject)) return 'SIC合作签约';
  return '新连锁签约';
}

/** 把原始节点名映射到 9 节点 */
function mapNode(rawName) {
  const key = s(rawName);
  if (Object.prototype.hasOwnProperty.call(NODE_ALIAS, key)) return NODE_ALIAS[key];
  return '实施对接'; // 未知节点兜底（实测 13 种旧值已全部覆盖，此分支理论不触发）
}

/** 找到某节点的「进入时间」：该节点时间列有值则用，否则回退到前一个有值的节点时间列 */
function enterNodeTime(raw, node) {
  const order = ['销售签约', '策略开通', '实施对接', '对接审核', '客服处理', '客户培训', '连锁使用', '策略审核'];
  const idx = order.indexOf(node);
  if (idx >= 0) {
    for (let i = idx; i >= 0; i -= 1) {
      const col = NODE_TIME_COL[order[i]];
      if (col && raw[col]) {
        const d = toDate(raw[col]);
        if (d) return d;
      }
    }
  }
  // 兜底：单据提交时间
  return toDate(raw[C.tSubmit]);
}

/** 判断负责人岗位（可能多岗） */
function ownerRoles(owner, staff) {
  const k = nameKey(owner);
  if (!k) return [];
  const out = [];
  if (staff.implement.has(k)) out.push('实施');
  if (staff.service.has(k)) out.push('客服');
  if (staff.solution.has(k)) out.push('解决方案');
  if (staff.sales.has(k)) out.push('销售');
  if (staff.pm.has(k)) out.push('产品经理');
  return out;
}

/** 把一行原始 CRM 数据标准化 */
function normalizeClient(raw, staff, runMap, now) {
  const chainId = s(raw[C.chainId]);
  const currentNodeRaw = s(raw[C.currentNode]);
  const nodeFieldRaw = s(raw[C.nodeField]);

  /**
   * ══════ V14 B1：流程结束判定（数据错误修复）══════
   *
   * 用户报障：连锁 10147 / 15374 / 15654 实际已「流程结束」，看板仍显示「策略审核」。
   *
   * 根因（实测 `_work/v14-flow-diag2.js` + `_work/v14-rule-verify.js`）：
   *   `flow_current_node` 是**流程引擎的「当前停留节点」**，节点完成后**不会清空**，
   *   只有走到终点（流程归档）才被置空 —— 因此已完成的连锁仍停在「策略审核」上。
   *   实测这 3 家：flow_current_node='策略审核'、nodeField='流程结束'、flow_state=1、
   *   且「策略审核完成时间」(w_1793094135608_p) 已有值（2026-11-02 16:04/16:05）。
   *   而旧代码只用 `!currentNodeRaw` 判定完成 → 这 6 家被误判为「仍在策略审核」。
   *
   * 全量口径（113 行实测）：
   *   flow_current_node 为空 4 条；策略审核时间非空 11 条；flow_state=1 共 10 条；
   *   nodeField ∈ {流程结束,流程完成} 共 10 条。
   *
   * 新规则（对 113 行实测 10/10 完全一致，0 不一致）：
   *   当前节点为空  →  流程结束
   *   当前节点=策略审核 且 策略审核完成时间有值  →  流程结束
   *
   * 反例保护：连锁 15497 当前节点='连锁使用'、flow_state=0、nodeField='连锁使用'，
   *   虽然策略审核时间有值，但按规则仍为未完成 —— 正确，不得误判。
   */
  const strategyAuditDone = hasTime(raw[C.tStrategyAudit]);
  const nodeEmpty = !currentNodeRaw;
  /** 策略审核完成 = 流程终点（策略审核是 9 节点里最后一个有业务的节点） */
  const auditFinished = !nodeEmpty && mapNode(currentNodeRaw || nodeFieldRaw) === '策略审核'
    && strategyAuditDone;
  const isCompleted = nodeEmpty || auditFinished;

  const node = isCompleted ? '流程结束' : mapNode(currentNodeRaw || nodeFieldRaw);

  const owner = s(raw[C.currentOwner]);
  const roles = ownerRoles(owner, staff);

  /**
   * 进入时间：
   *   - 普通已完成（当前节点为空）：沿用「连锁使用完成时间」兜底提交时间
   *   - V14 新增：策略审核完成 → 用「策略审核完成时间」作为流程结束时间
   *   - 未完成：进入当前节点的时间
   */
  const enterAt = nodeEmpty
    ? (toDate(raw[C.tChainUse]) || toDate(raw[C.tSubmit]))
    : (auditFinished
      ? (toDate(raw[C.tStrategyAudit]) || toDate(raw[C.tChainUse]) || toDate(raw[C.tSubmit]))
      : enterNodeTime(raw, node));
  const submitAt = toDate(raw[C.tSubmit]) || toDate(raw[C.signTime]);
  /**
   * V14：流程已结束的客户「当前节点时长」应显式为 null（不参与超期/平均耗时），
   * 而不是拿「进入上一节点至今」的天数继续算 —— 那是旧口径的残留。
   */
  const nodeDays = isCompleted ? null : daysSince(enterAt, now);
  const totalDays = daysSince(submitAt, now);

  /**
   * V7.1 超期：按工作日口径。
   * 取「上一节点完成时间」，算到现在的**工作日**数，超过该节点阈值即超期。
   */
  const overdueRule = NODE_OVERDUE_RULE[node] || { days: null, prevCol: null };
  const prevDoneAt = !isCompleted && overdueRule.prevCol ? toDate(raw[C[overdueRule.prevCol]]) : null;
  const workdays = prevDoneAt ? workdaysBetween(prevDoneAt, now) : 0;
  const isOverdue = overdueRule.days !== null && prevDoneAt !== null && workdays > overdueRule.days;
  const overdueDays = isOverdue ? workdays - overdueRule.days : 0;

  const run = runMap.get(chainId) || null;

  const signAt = toDate(raw[C.signTime]) || submitAt;

  return {
    /** V7：关联流程事件用（parsed_102.event_instance_id === parsed_16.jdy_data_id） */
    dataId: s(raw.jdy_data_id),
    chainId,
    chainName: s(raw[C.chainName]) || s(raw[C.signSubject]) || `连锁 ${chainId}`,
    chainType: s(raw[C.chainType]) || '未分类',
    region: s(raw[C.region]) || '未知',
    stores: n(raw[C.stores]),
    province: s(raw[C.province]),
    signType: resolveSignType(raw),
    sales: normName(raw[C.sales]),
    service: normName(raw[C.service]),
    solution: normName(raw[C.solution]),
    trainer: normName(raw[C.trainer]),
    version: s(raw[C.version]),
    connectResult: s(raw[C.connectResult]),
    trainResult: s(raw[C.trainResult]),
    openedStrategyText: s(raw[C.openedStrategy]),
    strategyOpenStatus: s(raw[C.strategyOpenStatus]),
    node,
    nodeRaw: currentNodeRaw || nodeFieldRaw,
    isCompleted,
    owner,
    ownerRoles: roles,
    enterAt,
    enterAtYmd: enterAt ? ymd(enterAt) : '',
    nodeDays,
    /* V7.1：工作日超期口径 */
    status: isOverdue ? '超期' : '正常',
    isOverdue,
    workdays,
    overdueDays,
    overdueThreshold: overdueRule.days,
    overdueRule: overdueRule.days !== null ? `超过 ${overdueRule.days} 个工作日` : '',
    /** 上一节点完成时间（超期计算的基准） */
    prevDoneAt,
    prevDoneAtYmd: prevDoneAt ? ymd(prevDoneAt) : '',
    submitAt,
    signAt,
    totalDays,
    // 运行数据（来自 mail_30）
    run,
    runRaw: raw,
    // 派生
    isActive: !isCompleted,
  };
}

/** 明细行（弹窗用，字段名对齐契约 DetailRow） */
function toDetailRow(c) {
  const rawVer = c.version || '';
  const versionShort = /^有券/.test(rawVer)
    ? '有券版本'
    : (/^无券/.test(rawVer) ? '无券版本' : (rawVer || '-'));
  const signAt = c.signAt || c.submitAt;
  return {
    chainId: c.chainId,
    region: c.region,
    chainName: c.chainName,
    chainType: c.chainType,
    stores: c.stores,
    /**
     * V14 B1：流程已结束的客户，「当前节点」显示「流程结束」而不是空串。
     *
     * 旧实现是 `c.isCompleted ? '' : c.node` —— 明细表「当前节点」列对已完成客户渲染空白；
     * 用户要求「客户的流程状态以当前节点为准」，故直接给出终态标签。
     * c.node 在 normalizeClient 里已算成 '流程结束'。
     */
    node: c.node,
    /** 显式标记是否已结束（前端可据此判断真实节点是否为空） */
    isCompleted: !!c.isCompleted,
    owner: c.owner,
    /** V15 4.5：补充岗位、省份、签约时间、对接版本，供明细弹窗多维度汇总与列渲染 */
    ownerRole: c.ownerRoles && c.ownerRoles.length ? c.ownerRoles[0] : '未分配',
    ownerRoles: c.ownerRoles && c.ownerRoles.length ? c.ownerRoles : ['未分配'],
    province: c.province || '未填写',
    version: rawVer || '-',
    versionShort,
    signDate: signAt ? mdCn(signAt) : '-',
    enterNodeAt: c.enterAt ? c.enterAt.toISOString() : '',
    enterNodeDate: c.enterAt ? md(c.enterAt) : '',
    nodeDays: c.nodeDays,
    submitAt: c.submitAt ? c.submitAt.toISOString() : '',
    submitDate: c.submitAt ? md(c.submitAt) : '',
    totalDays: c.totalDays,
    status: c.status,
    sales: c.sales,
    service: c.service,
    solution: c.solution,
    trainer: c.trainer,
  };
}

/** 明细表完整行（第 10 排） */
function toFullRow(c, seq) {
  const run = c.run || {};
  const opened = n(run[M.openedStrategies]);
  const running = n(run[M.runningStrategies]);
  const reached = n(run[M.sent]);
  const arrived = n(run[M.arrived]);
  const couponIssued = n(run[M.couponIssuedPeople]);
  const couponUsed = n(run[M.couponUsedPeople]);
  const base = toDetailRow(c);
  return {
    ...base,
    seq,
    signType: c.signType,
    province: c.province,
    signDate: c.signAt ? mdCn(c.signAt) : (c.submitAt ? mdCn(c.submitAt) : ''),
    submitLabel: c.submitAt ? mdCn(c.submitAt) : '',
    submitDays: c.totalDays,
    openedStrategies: opened,
    runningStrategies: running,
    reachedPeople: reached,
    reachRate: round(div(arrived, reached), 4),
    couponRate: round(div(couponUsed, couponIssued), 4),
    ownerRole: c.ownerRoles[0] || '',

    /* ── V7 新增列 ── */
    /** 当前处理人（CurrentOwner，流程推送的当前负责人） */
    currentOwner: c.owner || '',
    /**
     * V14：流程已结束的客户「当前节点时长」为 null（不参与超期），
     * 前端渲染为「—」，不再拿旧口径的天数充数。
     */
    currentNodeHours: c.nodeDays == null ? null : round(c.nodeDays * 24, 1),
    /** 上节点时间（进入当前节点的时间即为「上个节点完成时间」） */
    lastNodeAt: c.enterAt ? c.enterAt.toISOString() : '',
    /** 格式化后的当前节点时长：<24h 用 X.X时，否则 X.X天；已完成显示「—」 */
    currentNodeDuration: c.nodeDays == null
      ? '—'
      : (c.nodeDays < 1
        ? `${round(c.nodeDays * 24, 1)}时`
        : `${round(c.nodeDays, 1)}天`),
  };
}

/* ══════════════════════════════════════════════════════════════════
 * 六、筛选
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 按查询参数筛选客户列表。
 * @param {Array} clients 标准化后的客户
 * @param {Object} f 已解析的筛选条件
 */
function applyFilters(clients, f) {
  return clients.filter((c) => {
    // 日期（按签约时间；签约时间缺失时用提交时间）
    if (f.from || f.to) {
      const d = c.signAt || c.submitAt;
      if (!d) return false;
      const key = ymd(d);
      if (f.from && key < f.from) return false;
      if (f.to && key > f.to) return false;
    }
    if (f.regions.length && !f.regions.includes(c.region)) return false;
    if (f.chainTypes.length && !f.chainTypes.includes(c.chainType)) return false;
    if (f.sales.length && !f.sales.includes(c.sales)) return false;
    if (f.flowStatus.length) {
      const label = c.isCompleted ? '流程完成' : c.node;
      if (!f.flowStatus.includes(label) && !f.flowStatus.includes(c.node)) return false;
    }
    if (f.service.length && !f.service.includes(c.service)) return false;
    if (f.solution.length && !f.solution.includes(c.solution)) return false;
    if (f.trainer.length && !f.trainer.includes(c.trainer)) return false;
    if (f.version.length && !f.version.includes(c.version)) return false;
    if (f.connectResult.length && !f.connectResult.includes(c.connectResult)) return false;
    if (f.trainResult.length && !f.trainResult.includes(c.trainResult)) return false;
    if (f.openedStrategy.length) {
      const list = c.openedStrategyText ? c.openedStrategyText.split(',').map((x) => x.trim()) : [];
      const hit = f.openedStrategy.some((x) => list.includes(x));
      if (!hit) return false;
    }
    if (f.validOnly && !VALID_CHAIN_TYPES.includes(c.chainType)) return false;
    return true;
  });
}

/* ══════════════════════════════════════════════════════════════════
 * 七、聚合：选项与计数
 * ══════════════════════════════════════════════════════════════════ */

function uniqSorted(list) {
  return Array.from(new Set(list.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function countBy(clients, pick) {
  const out = {};
  clients.forEach((c) => {
    const k = pick(c);
    const keys = Array.isArray(k) ? k : [k];
    keys.forEach((x) => {
      if (!x) return;
      out[x] = (out[x] || 0) + 1;
    });
  });
  return out;
}

/** 构建下拉选项 + 计数 */
function buildOptionsAndCounts(clients) {
  const flowStatusLabels = FLOW_NODES.slice();
  const options = {
    regions: uniqSorted(clients.map((c) => c.region)),
    chainTypes: sortChainTypes(Array.from(new Set(clients.map((c) => c.chainType).filter(Boolean)))),
    sales: uniqSorted(clients.map((c) => c.sales)),
    flowStatus: flowStatusLabels,
    service: uniqSorted(clients.map((c) => c.service)),
    solution: uniqSorted(clients.map((c) => c.solution)),
    trainer: uniqSorted(clients.map((c) => c.trainer)),
    version: uniqSorted(clients.map((c) => c.version)),
    connectResult: uniqSorted(clients.map((c) => c.connectResult)),
    trainResult: uniqSorted(clients.map((c) => c.trainResult)),
    openedStrategy: uniqSorted(
      clients.flatMap((c) => (c.openedStrategyText ? c.openedStrategyText.split(',').map((x) => x.trim()) : [])),
    ),
  };
  const counts = {
    region: countBy(clients, (c) => c.region),
    chainType: countBy(clients, (c) => c.chainType),
    sales: countBy(clients, (c) => c.sales),
    flowStatus: countBy(clients, (c) => (c.isCompleted ? '流程完成' : c.node)),
    service: countBy(clients, (c) => c.service),
    solution: countBy(clients, (c) => c.solution),
    trainer: countBy(clients, (c) => c.trainer),
    version: countBy(clients, (c) => c.version),
    connectResult: countBy(clients, (c) => c.connectResult),
    trainResult: countBy(clients, (c) => c.trainResult),
    openedStrategy: countBy(clients, (c) =>
      c.openedStrategyText ? c.openedStrategyText.split(',').map((x) => x.trim()) : []),
  };
  return { options, counts };
}

/* ══════════════════════════════════════════════════════════════════
 * 八、第 1 排：签约卡片区
 * ══════════════════════════════════════════════════════════════════ */

function regionSplit(clients, pick) {
  let south = 0;
  let north = 0;
  clients.forEach((c) => {
    const v = pick(c);
    if (c.region === '南区') south += v;
    else if (c.region === '北区') north += v;
  });
  return { south: round(south, 2), north: round(north, 2) };
}

function buildRow1(clients, staff, target) {
  const totalClients = clients.length;
  const totalStores = clients.reduce((sum, c) => sum + c.stores, 0);

  const totalClientsByRegion = regionSplit(clients, () => 1);
  const storesByRegion = regionSplit(clients, (c) => c.stores);

  /* ── 任务完成进度（V7 口径）──
   * 只有 全国百强 / 区县百强 / 50+ 计入任务，50- 不计入。
   * 目标：南区 220、北区 280（合计 500）。
   */
  const SOUTH_TARGET = 220;
  const NORTH_TARGET = 280;
  const taskClients = clients.filter((c) => VALID_CHAIN_TYPES.includes(c.chainType));
  const taskByRegion = regionSplit(taskClients, () => 1);
  const totalTarget = SOUTH_TARGET + NORTH_TARGET;

  const progress = {
    achieved: taskClients.length,
    target: totalTarget,
    rate: round(div(taskClients.length, totalTarget) * 100, 1),
    /** 任务口径的连锁数（同 achieved，语义更明确） */
    chains: taskClients.length,
    /** 不计入任务的连锁数（50- 及未分类） */
    excluded: totalClients - taskClients.length,
    south: {
      achieved: taskByRegion.south,
      target: SOUTH_TARGET,
      rate: round(div(taskByRegion.south, SOUTH_TARGET) * 100, 1),
    },
    north: {
      achieved: taskByRegion.north,
      target: NORTH_TARGET,
      rate: round(div(taskByRegion.north, NORTH_TARGET) * 100, 1),
    },
  };

  // 签约类型
  const signTypeNames = Array.from(new Set(clients.map((c) => c.signType)));
  const signTypes = signTypeNames.map((name) => {
    const list = clients.filter((c) => c.signType === name);
    const byChainTypeMap = new Map();
    list.forEach((c) => {
      const cur = byChainTypeMap.get(c.chainType) || { name: c.chainType, clients: 0, stores: 0 };
      cur.clients += 1;
      cur.stores += c.stores;
      byChainTypeMap.set(c.chainType, cur);
    });
    return {
      name,
      clients: list.length,
      stores: list.reduce((sum, c) => sum + c.stores, 0),
      south: list.filter((c) => c.region === '南区').length,
      north: list.filter((c) => c.region === '北区').length,
      byChainType: Array.from(byChainTypeMap.values()),
    };
  }).sort((a, b) => b.clients - a.clients);

  /* ── 进行中（V7：五类互斥，合计 == 进行中总数）──
   *
   * 根因（实测）：V6 的策略维度按「当前节点」统计、岗位维度按「负责人所属岗位」统计，
   * 两者维度重叠 —— 策略审核节点的 1 家（连锁 15820，负责人郑磊）同时被计入「解决方案」，
   * 导致 1+15+21+9+44 = 90 ≠ 89。
   *
   * 修复规则（优先级从高到低，一家只归一类）：
   *   1. 当前节点 ∈ {策略开通, 策略审核} → 策略
   *   2. 否则按负责人岗位：实施 > 客服 > 解决方案 > 销售（一人多岗取最高优先级）
   *   3. 岗位都不命中 → 销售（兜底）
   */
  const active = clients.filter((c) => !c.isCompleted);

  const ROLE_PRIORITY = ['实施', '客服', '解决方案', '销售'];
  const bucketOf = (c) => {
    if (c.node === '策略开通' || c.node === '策略审核') return '策略';
    for (const role of ROLE_PRIORITY) {
      if (c.ownerRoles.includes(role)) return role;
    }
    return '销售';
  };

  const bucketMap = { 策略: [], 实施: [], 客服: [], 解决方案: [], 销售: [] };
  active.forEach((c) => {
    const b = bucketOf(c);
    if (bucketMap[b]) bucketMap[b].push(c);
    else bucketMap['销售'].push(c);
  });

  const makeBucket = (list, groupKeyFn) => ({
    total: list.length,
    south: list.filter((c) => c.region === '南区').length,
    north: list.filter((c) => c.region === '北区').length,
    groups: groupBy(list, groupKeyFn, toDetailRow),
  });

  const inProgress = {
    total: active.length,
    /** 五类合计（应恒等于 total，前端可据此自检） */
    sumOfBuckets:
      bucketMap['策略'].length + bucketMap['实施'].length + bucketMap['客服'].length +
      bucketMap['解决方案'].length + bucketMap['销售'].length,
    strategy: makeBucket(bucketMap['策略'], (c) => c.node),
    implement: makeBucket(bucketMap['实施'], (c) => c.owner || '未分配'),
    service: makeBucket(bucketMap['客服'], (c) => c.owner || '未分配'),
    solution: makeBucket(bucketMap['解决方案'], (c) => c.owner || '未分配'),
    sales: makeBucket(bucketMap['销售'], (c) => c.owner || '未分配'),
  };

  /* ── 流程结束（V7：客户数/门店数/开通策略/未开策略，各含汇总+南北）──
   * 完成判定：flow_current_node 为空。
   * 开通策略按客户数计：strategyOpenStatus='已开通' 或「已开通策略」列表非空且非「均未开通」。
   */
  const completed = clients.filter((c) => c.isCompleted);
  const openedList = completed.filter((c) => isStrategyOpened(c));
  const notOpenedList = completed.filter((c) => !isStrategyOpened(c));

  const flowStatus = {
    completedClients: completed.length,
    completedStores: completed.reduce((sum, c) => sum + c.stores, 0),
    south: completed.filter((c) => c.region === '南区').length,
    north: completed.filter((c) => c.region === '北区').length,
    storesSouth: completed.filter((c) => c.region === '南区').reduce((s, c) => s + c.stores, 0),
    storesNorth: completed.filter((c) => c.region === '北区').reduce((s, c) => s + c.stores, 0),

    strategyOpened: openedList.length,
    strategyNotOpened: notOpenedList.length,
    openedSouth: openedList.filter((c) => c.region === '南区').length,
    openedNorth: openedList.filter((c) => c.region === '北区').length,
    notOpenedSouth: notOpenedList.filter((c) => c.region === '南区').length,
    notOpenedNorth: notOpenedList.filter((c) => c.region === '北区').length,
  };

  return {
    totalClients,
    totalClientsByRegion,
    totalStores,
    storesByRegion,
    progress,
    signTypes,
    inProgress,
    flowStatus,
    /**
     * V10：客户 ERP 分布
     * 数据源 parsed_16 的「连锁ERP名称」列（实测 97 家 / 15 个 ERP / 无空值）。
     * 按客户数降序；前端展示 TOP5 + 「其他 N 个」聚合。
     */
    erpDistribution: (() => {
      const map = new Map();
      clients.forEach((cl) => {
        const raw = cl.runRaw || {};
        const erp = String(raw[ERP_COL] || '').trim();
        const key = erp || '未填写';
        map.set(key, (map.get(key) || 0) + 1);
      });
      return [...map.entries()]
        .map(([name, cnt]) => ({ name, clients: cnt }))
        .sort((a, b) => b.clients - a.clients || a.name.localeCompare(b.name));
    })(),
    /**
     * V15 3.1：对接版本汇总（有券版本 vs 无券版本）
     * 数据源 parsed_16 的 w_1792577110570 列，实测 113 家客户（有券版本 105 家，无券版本 8 家）。
     */
    erpVersionSummary: (() => {
      const withCoupon = { south: 0, north: 0, total: 0 };
      const withoutCoupon = { south: 0, north: 0, total: 0 };
      let unknown = 0;
      clients.forEach((cl) => {
        const ver = String(cl.version || '').trim();
        if (/^有券|有券版本/.test(ver)) {
          withCoupon.total += 1;
          if (cl.region === '南区') withCoupon.south += 1;
          else if (cl.region === '北区') withCoupon.north += 1;
        } else if (/^无券|无券版本/.test(ver)) {
          withoutCoupon.total += 1;
          if (cl.region === '南区') withoutCoupon.south += 1;
          else if (cl.region === '北区') withoutCoupon.north += 1;
        } else {
          unknown += 1;
        }
      });
      return {
        withCoupon,
        withoutCoupon,
        unknown,
        total: clients.length,
      };
    })(),
  };
}

/** 是否已开通策略（多口径兜底） */
function isStrategyOpened(c) {
  const txt = s(c.strategyOpenStatus);
  if (txt === '已开通') return true;
  if (txt === '未开通') return false;
  const list = c.openedStrategyText
    ? c.openedStrategyText.split(',').map((x) => x.trim()).filter(Boolean)
    : [];
  if (!list.length) return false;
  if (list.length === 1 && list[0] === '均未开通') return false;
  return true;
}

/** 分组 → [{name, count, rows}]，按 count 降序 */
function groupBy(list, keyFn, rowFn) {
  const map = new Map();
  list.forEach((item) => {
    const k = keyFn(item) || '未分配';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  });
  return Array.from(map.entries())
    .map(([name, arr]) => ({ name, count: arr.length, rows: arr.map(rowFn) }))
    .sort((a, b) => b.count - a.count);
}

/* ══════════════════════════════════════════════════════════════════
 * 九、第 2 排：流程状态分布（9 节点）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 第 2 排：流程状态分布（9 节点）
 *
 * V7 新增：
 *   - normal / overdue：该节点下 正常 / 超期 家数（超期 = 当前节点时长 > 7 天）
 *   - avgHours：平均耗时（小时，浮点），前端据此按 <1天 显示 X.X时 / X.X天
 *   - hasTime：该节点是否有「耗时」概念（销售签约、流程结束 为 false）
 */
/**
 * V12：计算「每个节点已完成客户的平均耗时」。
 *
 * 口径：本节点完成时间 − 上一节点完成时间
 *   - 只统计两个时间都存在且时间差 >= 0 的样本
 *   - 第一个节点（销售签约）没有上一节点，返回 null（该节点 hasTime 也为 false）
 *   - 与「当前是否停留该节点」无关 → clients=0 的节点也能算出耗时
 *
 * @param {Array} clients normalizeClient 之后的客户数组（含 runRaw 原始行）
 * @returns {Map<string, {doneCount:number, validCount:number, avgDoneDays:number|null, avgDoneHours:number|null}>}
 */
function buildNodeDoneDurationMap(clients) {
  const map = new Map();

  /* 只取有完成时间列的节点（流程结束无完成时间列，不参与） */
  const pairs = NODE_DONE_COL.filter((x) => x.col);

  pairs.forEach((cur, i) => {
    const prev = i > 0 ? pairs[i - 1] : null;
    let doneCount = 0;
    let validCount = 0;
    let sumDays = 0;

    clients.forEach((c) => {
      const raw = c.runRaw || {};
      const curAt = toDate(raw[cur.col]);
      if (!curAt) return;
      doneCount += 1;

      /* 首个节点没有上一节点 → 无法计算区间耗时 */
      if (!prev) return;

      const prevAt = toDate(raw[prev.col]);
      if (!prevAt) return;

      const days = (curAt.getTime() - prevAt.getTime()) / 86400000;
      /* 负数说明数据录入顺序异常，跳过，避免污染平均 */
      if (days < 0) return;

      validCount += 1;
      sumDays += days;
    });

    const avg = validCount > 0 ? sumDays / validCount : null;

    map.set(cur.node, {
      doneCount,
      validCount,
      avgDoneDays: avg === null ? null : round(avg, 1),
      avgDoneHours: avg === null ? null : round(avg * 24, 1),
    });
  });

  return map;
}

function buildRow2(clients) {
  const total = clients.length;
  const excluded = clients.filter((c) => RATIO_EXCLUDED.includes(c.node)).length;
  const denominator = Math.max(0, total - excluded);
  /** 没有耗时概念的节点：起点与终点 */
  const NO_TIME_NODES = ['销售签约', '流程结束'];

  /**
   * V12：新的「平均耗时」口径
   *
   * 需求：「平均耗时指的是当前节点已完成的客户，在这个节点的平均耗时；
   *        计算时间是当前节点时间 − 上一节点的时间」
   *
   * 旧实现（错误）：只看「当前停留该节点」的客户，算 now − enterAt，
   *                即「还在这个节点的客户已经等了多久」，与需求定义相反；
   *                且 clients=0 的节点（策略开通/策略审核）算不出耗时。
   *
   * 新实现：遍历所有客户的节点完成时间列（NODE_DONE_COL），
   *        对每个节点取「本节点完成时间 − 上一节点完成时间」的有效样本求平均。
   *        → 已完成过该节点的客户才计入，与「当前是否停留」无关。
   *
   * 实测（108 客户）：策略审核 clients=0 但有 5 家已完成、3 对有效样本，平均 1.68 天。
   */
  const doneDurMap = buildNodeDoneDurationMap(clients);

  const nodes = FLOW_NODES.map((name) => {
    const list = clients.filter((c) => c.node === name);
    const stores = list.reduce((sum, c) => sum + c.stores, 0);
    const avgDays = list.length
      ? round(list.reduce((sum, c) => sum + (c.nodeDays || 0), 0) / list.length, 1)
      : 0;
    const avgHours = list.length
      ? round((list.reduce((sum, c) => sum + (c.nodeDays || 0), 0) / list.length) * 24, 1)
      : 0;

    /* V12：已完成客户的平均耗时（新口径） */
    const dur = doneDurMap.get(name) || { doneCount: 0, validCount: 0, avgDoneDays: null, avgDoneHours: null };

    /* V7.1：正常/超期改用「工作日」口径（c.isOverdue 已在 normalizeClient 算好） */
    const overdue = list.filter((c) => c.isOverdue).length;
    const normal = list.length - overdue;
    /** 该节点超期客户的平均超出工作日（用于展示「平均超期 X 个工作日」） */
    const overdueList = list.filter((c) => c.isOverdue);
    const avgOverdueDays = overdueList.length
      ? round(overdueList.reduce((s2, c) => s2 + c.overdueDays, 0) / overdueList.length, 1)
      : 0;

    /* V7.1：该节点南/北区连锁数 */
    const south = list.filter((c) => c.region === '南区').length;
    const north = list.filter((c) => c.region === '北区').length;

    // 按岗位汇总
    const roleMap = new Map();
    list.forEach((c) => {
      const roles = c.ownerRoles.length ? c.ownerRoles : ['未分配'];
      roles.forEach((r) => roleMap.set(r, (roleMap.get(r) || 0) + 1));
    });
    const byRole = Array.from(roleMap.entries())
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => b.count - a.count);

    const rule = NODE_OVERDUE_RULE[name] || { days: null };

    return {
      key: name,
      name,
      clients: list.length,
      ratio: RATIO_EXCLUDED.includes(name) ? 0 : round(div(list.length, denominator), 4),
      stores,
      avgDays,
      avgHours,
      /* V12：已完成客户的平均耗时（前端耗时长改用这两个字段） */
      avgDoneDays: dur.avgDoneDays,
      avgDoneHours: dur.avgDoneHours,
      doneCount: dur.doneCount,
      doneValidCount: dur.validCount,
      hasTime: !NO_TIME_NODES.includes(name),
      /* V7.1 超期（工作日口径） */
      normal,
      overdue,
      avgOverdueDays,
      overdueThreshold: rule.days,
      overdueRule: rule.days !== null ? `超过 ${rule.days} 个工作日` : '',
      /* V7.1 南北区连锁数 */
      south,
      north,
      byRole,
      rows: list.map(toDetailRow),
    };
  });

  return {
    nodes,
    /** V7.1：超期口径说明（前端弹窗底部展示） */
    overdueNote: [
      '超期口径：上一节点结束后在本节点的工作日超过阈值即视为超期。',
      '策略开通 2 个工作日 · 实施对接 5 个工作日 · 对接审核 2 个工作日 · ',
      '客服处理 10 个工作日 · 客户培训 3 个工作日 · 连锁使用 5 个工作日 · 策略审核 2 个工作日',
    ].join(''),
  };
}

/* ══════════════════════════════════════════════════════════════════
 * 十、第 3 排：类型汇总 + 排行榜
 * ══════════════════════════════════════════════════════════════════ */

function buildRow3(clients) {
  // 连锁类型分布
  const typeNames = sortChainTypes(Array.from(new Set(clients.map((c) => c.chainType).filter(Boolean))));
  const typeDistribution = typeNames.map((name) => {
    const list = clients.filter((c) => c.chainType === name);
    return {
      name,
      clients: list.length,
      stores: list.reduce((sum, c) => sum + c.stores, 0),
      south: list.filter((c) => c.region === '南区').length,
      north: list.filter((c) => c.region === '北区').length,
    };
  });

  // 排行榜：50- 不参与客户数排名（口径 §四 第 3 排）
  const validForRank = clients.filter((c) => VALID_CHAIN_TYPES.includes(c.chainType));

  const salesClientRank = rankBy(validForRank, (c) => c.sales, () => 1, 'clients');
  const salesStoreRank = rankBy(clients, (c) => c.sales, (c) => c.stores, 'stores');
  // V7：省份榜带出该省客户数最多的销售名
  const provinceRank = rankBy(clients, (c) => c.province || '未填写', () => 1, 'clients');

  return { typeDistribution, salesClientRank, salesStoreRank, provinceRank };
}

/**
 * 通用排行：按 key 聚合，统计 clients / stores，并按连锁类型打标签。
 * @param {Array} list 客户
 * @param {Function} keyFn 分组键
 * @param {Function} valueFn 计数权重（1=客户数，c.stores=门店数）
 * @param {'clients'|'stores'} sortField 排序字段
 */
function rankBy(list, keyFn, valueFn, sortField) {
  const map = new Map();
  list.forEach((c) => {
    const k = keyFn(c) || '未分配';
    if (!map.has(k)) map.set(k, { name: k, clients: 0, stores: 0, typeMap: new Map(), salesMap: new Map() });
    const item = map.get(k);
    item.clients += 1;
    item.stores += c.stores;
    const t = c.chainType || '未分类';
    const tag = item.typeMap.get(t) || { name: t, count: 0 };
    tag.count += valueFn(c) ? 1 : 1; // 标签统计「连锁家数」
    item.typeMap.set(t, tag);
    // 记录该分组下各销售的客户数（用于省份榜显示销售名）
    if (c.sales) item.salesMap.set(c.sales, (item.salesMap.get(c.sales) || 0) + 1);
  });

  return Array.from(map.values())
    .map((item) => {
      // 取客户数最多的销售作为该组的「代表销售」
      let topSales = '';
      let topCount = -1;
      item.salesMap.forEach((cnt, sales) => {
        if (cnt > topCount) { topCount = cnt; topSales = sales; }
      });
      return {
        rank: 0,
        name: item.name,
        clients: item.clients,
        stores: round(item.stores, 2),
        /** V7：该组代表销售（省份榜用；销售榜自身则为空串） */
        salesName: topSales,
        salesCount: topCount > 0 ? topCount : 0,
        tags: sortChainTypes(Array.from(item.typeMap.keys())).map((t) => item.typeMap.get(t)),
      };
    })
    .sort((a, b) => {
      const av = sortField === 'stores' ? a.stores : a.clients;
      const bv = sortField === 'stores' ? b.stores : b.clients;
      if (bv !== av) return bv - av;
      return a.name.localeCompare(b.name, 'zh-CN');
    })
    .map((item, i) => ({ ...item, rank: i + 1 }));
}

/* ══════════════════════════════════════════════════════════════════
 * 十一、第 4-5 排：同环比
 * ══════════════════════════════════════════════════════════════════ */

const COMPARE_PRESETS = ['thisWeek', 'lastWeek', 'thisMonth', 'lastMonth'];

/**
 * 构建同环比数据。
 * @param {Array} allClients 全量标准化客户（未筛选日期）
 * @param {Object} f 筛选条件（已含日期）
 * @param {Object} range {from,to}
 * @param {Object} prevRange {from,to}
 */
function buildCompare(allClients, f, range, prevRange, now) {
  if (!COMPARE_PRESETS.includes(f.datePreset)) return null;
  if (!range.from || !range.to) return null;

  // 本期 / 上期：只按日期切分，其它筛选条件照样生效
  const baseFilters = { ...f, from: '', to: '' };
  const inRange = (list, from, to) =>
    list.filter((c) => {
      const d = c.signAt || c.submitAt;
      if (!d) return false;
      const key = ymd(d);
      return (!from || key >= from) && (!to || key <= to);
    });

  const eligible = applyFilters(allClients, baseFilters);
  const currentList = inRange(eligible, range.from, range.to);
  const previousList = prevRange.from ? inRange(eligible, prevRange.from, prevRange.to) : [];

  // 累计：从最早日期到本期结束
  const cumulativeList = eligible.filter((c) => {
    const d = c.signAt || c.submitAt;
    if (!d) return false;
    return ymd(d) <= range.to;
  });

  const makeRow = (name, cur, prev, cum) => ({
    name,
    current: round(cur, 2),
    previous: round(prev, 2),
    ratio: prev ? round(((cur - prev) / prev) * 100, 1) : null,
    cumulative: round(cum, 2),
  });

  // 1) 客户数：全部 / 有效 / 无效
  const bucket = (list, kind) => {
    if (kind === 'all') return list;
    if (kind === 'valid') return list.filter((c) => VALID_CHAIN_TYPES.includes(c.chainType));
    return list.filter((c) => !VALID_CHAIN_TYPES.includes(c.chainType));
  };
  const sumClients = (list) => list.length;
  const sumStores = (list) => list.reduce((sum, c) => sum + c.stores, 0);

  const clients = [
    makeRow('全部', sumClients(bucket(currentList, 'all')), sumClients(bucket(previousList, 'all')), sumClients(bucket(cumulativeList, 'all'))),
    makeRow('有效', sumClients(bucket(currentList, 'valid')), sumClients(bucket(previousList, 'valid')), sumClients(bucket(cumulativeList, 'valid'))),
    makeRow('无效', sumClients(bucket(currentList, 'invalid')), sumClients(bucket(previousList, 'invalid')), sumClients(bucket(cumulativeList, 'invalid'))),
  ];

  const stores = [
    makeRow('全部', sumStores(bucket(currentList, 'all')), sumStores(bucket(previousList, 'all')), sumStores(bucket(cumulativeList, 'all'))),
    makeRow('有效', sumStores(bucket(currentList, 'valid')), sumStores(bucket(previousList, 'valid')), sumStores(bucket(cumulativeList, 'valid'))),
    makeRow('无效', sumStores(bucket(currentList, 'invalid')), sumStores(bucket(previousList, 'invalid')), sumStores(bucket(cumulativeList, 'invalid'))),
  ];

  // 2) 按连锁类型（客户数）
  const typeNames = sortChainTypes(Array.from(new Set(eligible.map((c) => c.chainType).filter(Boolean))));
  const byChainType = typeNames.map((t) => {
    const pick = (list) => list.filter((c) => c.chainType === t).length;
    return makeRow(t, pick(currentList), pick(previousList), pick(cumulativeList));
  });

  // 3) 按销售（客户数）
  const salesNames = uniqSorted(eligible.map((c) => c.sales));
  const bySales = salesNames.map((name) => {
    const pick = (list) => list.filter((c) => c.sales === name).length;
    return makeRow(name, pick(currentList), pick(previousList), pick(cumulativeList));
  }).sort((a, b) => b.current - a.current);

  // 4) 按销售 × 连锁类型
  const bySalesType = [];
  salesNames.forEach((name) => {
    typeNames.forEach((t) => {
      const pick = (list) => list.filter((c) => c.sales === name && c.chainType === t).length;
      const cur = pick(currentList);
      const prev = pick(previousList);
      const cum = pick(cumulativeList);
      if (cur === 0 && prev === 0 && cum === 0) return; // 跳过全 0 组合
      bySalesType.push(makeRow(`${name} · ${t}`, cur, prev, cum));
    });
  });
  bySalesType.sort((a, b) => b.current - a.current);

  return {
    label: {
      current: `本期 ${md(range.from)}-${md(range.to)}`,
      previous: prevRange.from ? `上期 ${md(prevRange.from)}-${md(prevRange.to)}` : '上期 -',
    },
    clients,
    stores,
    byChainType,
    bySales,
    bySalesType,
  };
}

/* ══════════════════════════════════════════════════════════════════
 * 十二、第 6 排：签约趋势 + 流程推进
 * ══════════════════════════════════════════════════════════════════ */

function buildRow6(clients, flowEvents, now) {
  // ── 签约趋势：最近 30 天 ──
  const days = [];
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push(ymd(d));
  }
  const dayIdx = new Map(days.map((d, i) => [d, i]));

  const south = new Array(days.length).fill(0);
  const north = new Array(days.length).fill(0);
  const stores = new Array(days.length).fill(0);

  const typeNames = sortChainTypes(Array.from(new Set(clients.map((c) => c.chainType).filter(Boolean))));
  const byChainType = {};
  typeNames.forEach((t) => {
    byChainType[t] = {
      south: new Array(days.length).fill(0),
      north: new Array(days.length).fill(0),
    };
  });

  clients.forEach((c) => {
    const d = c.signAt || c.submitAt;
    if (!d) return;
    const i = dayIdx.get(ymd(d));
    if (i === undefined) return;
    if (c.region === '南区') south[i] += 1;
    else if (c.region === '北区') north[i] += 1;
    stores[i] += c.stores;
    const bucket = byChainType[c.chainType];
    if (bucket) {
      if (c.region === '南区') bucket.south[i] += 1;
      else if (c.region === '北区') bucket.north[i] += 1;
    }
  });

  const signTrend = {
    days: days.map((d) => md(d)),
    daysCn: days.map((d) => mdCn(d)),
    south,
    north,
    stores,
    byChainType,
  };

  /**
   * ── 流程处理：V8.1 数据源修正 ──
   *
   * V7.1 之前用 `jdywh_parsed_102`（流程事件表）统计「每日完成数」，实测发现数据与用户看到的严重不符：
   *   用户反馈 策略开通 10-22=60 家，而 102 表在 22 日**根本没有数据**。
   *
   * 实测比对三个数据源（10-22 至 10-29）：
   *   日期    用户反馈   parsed_16 完成时间列   parsed_102 事件表
   *   10-22     60            60 ✓                无
   *   10-23      4             4 ✓                1
   *   10-26     12            13                  13
   *   10-27      5             5 ✓                5
   *   10-28     11            10                  13
   *   10-29      3             3 ✓                3
   *
   * 结论：**正确数据源是 `parsed_16` 的各节点完成时间列**（与用户值 4/6 完全一致）。
   * 102 表的 `header_created_at` 还是毫秒时间戳 double，`DATE()` 对它返回 NULL，本身也不可靠。
   *
   * 因此 V8.1 改为按 parsed_16 的 `w_1793094135xxx_p` 完成时间列逐日聚合。
   */
  const buildWindow = (n2) => {
    const arr = [];
    for (let i = n2 - 1; i >= 0; i -= 1) {
      arr.push(ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
    }
    return arr;
  };
  const workdays = buildWindow(7);     // 卡片正文：近 7 日
  const days30 = buildWindow(30);      // 「更多」弹窗：近 30 日

  const nodeList = FLOW_NODES.slice();
  const mkMatrix = (len) => nodeList.map(() => new Array(len).fill(0));

  const matrix = mkMatrix(workdays.length);
  const matrixSouth = mkMatrix(workdays.length);
  const matrixNorth = mkMatrix(workdays.length);
  const matrix30 = mkMatrix(days30.length);
  const matrix30South = mkMatrix(days30.length);
  const matrix30North = mkMatrix(days30.length);

  const wdIdx = new Map(workdays.map((d, i) => [d, i]));
  const idx30 = new Map(days30.map((d, i) => [d, i]));
  const nodeIdx = new Map(nodeList.map((nm, i) => [nm, i]));

  /**
   * 用 parsed_16 的节点完成时间列聚合。
   * 注意：clients 里的字段是 enterAt/nodeDays 等派生值，这里直接读 runRaw 的原始列。
   * （normalizeClient 保留了 runRaw: raw）
   */
  clients.forEach((c) => {
    const raw = c.runRaw || {};
    if (!raw) return;
    const reg = c.region;

    NODE_DONE_COL.forEach(({ node, col }) => {
      if (!col) return;
      const at = toDate(raw[col]);
      if (!at) return;
      const key = ymd(at);
      const j = nodeIdx.get(node);
      if (j === undefined) return;

      // 7 日窗口
      const i = wdIdx.get(key);
      if (i !== undefined) {
        matrix[j][i] += 1;
        if (reg === '南区') matrixSouth[j][i] += 1;
        else if (reg === '北区') matrixNorth[j][i] += 1;
      }
      // 30 日窗口
      const k = idx30.get(key);
      if (k !== undefined) {
        matrix30[j][k] += 1;
        if (reg === '南区') matrix30South[j][k] += 1;
        else if (reg === '北区') matrix30North[j][k] += 1;
      }
    });
  });

  const flowProgress = {
    /* 卡片正文：近 7 日 */
    days: workdays.map((d) => md(d)),
    daysCn: workdays.map((d) => mdCn(d)),
    nodes: nodeList,
    matrix,
    byRegion: {
      全部: { matrix },
      南区: { matrix: matrixSouth },
      北区: { matrix: matrixNorth },
    },
    matrixSouth,
    matrixNorth,
    /* V7.1：「更多」弹窗：近 30 日 */
    days30: days30.map((d) => md(d)),
    daysCn30: days30.map((d) => mdCn(d)),
    matrix30,
    byRegion30: {
      全部: { matrix: matrix30 },
      南区: { matrix: matrix30South },
      北区: { matrix: matrix30North },
    },
    matrix30South,
    matrix30North,
    /** V8.1：数据源标记，便于前端/排查时确认 */
    source: 'parsed_16.node_done_time',
  };

  // ── 有开通策略的客户数（按南北区）──
  const opened = clients.filter((c) => isStrategyOpened(c));
  const strategyClients = {
    total: opened.length,
    south: opened.filter((c) => c.region === '南区').length,
    north: opened.filter((c) => c.region === '北区').length,
  };

  return { signTrend, flowProgress, strategyClients };
}

/* ══════════════════════════════════════════════════════════════════
 * 十三、第 7/8/9 排：客户运行情况
 * ══════════════════════════════════════════════════════════════════ */

/** 空指标模板 */
function emptyRow7() {
  return {
    openedStrategy: {
      chains: { south: 0, north: 0, total: 0 },
      strategies: { south: 0, north: 0, total: 0 },
    },
    runningStrategy: {
      chains: { south: 0, north: 0, total: 0 },
      strategies: { south: 0, north: 0, total: 0 },
    },
    reachRate: { south: 0, north: 0, total: 0 },
    couponRate: { south: 0, north: 0, total: 0 },
    conversion: { south: 0, north: 0, total: 0, perCapita: { south: 0, north: 0, total: 0 } },
    people: {
      reached: { south: 0, north: 0, total: 0 },
      couponIssued: { south: 0, north: 0, total: 0 },
    },
  };
}

/**
 * 解析第 8 排（策略模型/类型）的日期区间。
 *
 * 优先级：
 *   1. query.row8DatePreset / row8DateFrom / row8DateTo（第 8 排自己的日期按钮）
 *   2. 顶部全局日期筛选（datePreset/dateFrom/dateTo）——契约要求「顶部设置后同步到此」
 *   3. 都没有 → 默认「近 30 日」
 *
 * @returns {{from:string,to:string}} YYYY-MM-DD
 */
function resolveRow8Range(query, globalRange, now) {
  const q = query || {};
  const preset = String(q.row8DatePreset || '');
  if (preset) {
    if (preset === 'last30' || preset === 'all') {
      // 近 30 日
      const p = (x) => String(x).padStart(2, '0');
      const to = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
      const fromD = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
      const from = `${fromD.getFullYear()}-${p(fromD.getMonth() + 1)}-${p(fromD.getDate())}`;
      return preset === 'all' ? { from: '', to: '' } : { from, to };
    }
    const r = resolveDateRange(preset, q.row8DateFrom, q.row8DateTo, now);
    return { from: r.from, to: r.to };
  }

  // 顶部全局日期筛选已生效 → 同步
  if (globalRange && (globalRange.from || globalRange.to)) {
    return { from: globalRange.from || '', to: globalRange.to || '' };
  }

  // 默认近 30 日
  const p = (x) => String(x).padStart(2, '0');
  const to = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const fromD = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  const from = `${fromD.getFullYear()}-${p(fromD.getMonth() + 1)}-${p(fromD.getDate())}`;
  return { from, to };
}

/**
 * 把一组 mail_30/31 行聚合成 Row7Data。
 *
 * V7 修复「南 + 北 ≠ 合计」：
 *   V6 里 `total` 累计了全部连锁，而 `south`/`north` 只累计能归属到区域的连锁，
 *   未签约（chainRegion 里没有）的连锁被算进 total 却没进任何区域，导致加不起来。
 *   V7 增加 `unknown` 桶，保证 **south + north + unknown === total**。
 *
 * @param {Array} rows 运行数据行（mail_30 或 mail_31 的子集）
 * @param {Map} chainRegion 连锁ID → 区域
 */
function aggregateRow7(rows, chainRegion) {
  const out = emptyRow7();
  const mkAcc = () => ({
    openedChains: 0, openedStrats: 0, runChains: 0, runStrats: 0,
    sent: 0, arrived: 0, gmv: 0, couponIssuedPpl: 0, couponUsedPpl: 0, couponIssued: 0,
    channelCost: 0, couponCost: 0, couponGmv: 0,
  });
  const acc = { s: mkAcc(), n: mkAcc(), u: mkAcc(), t: mkAcc() };

  // 按连锁去重统计「连锁数」
  const seen = { s: new Set(), n: new Set(), u: new Set(), t: new Set() };
  const seenRun = { s: new Set(), n: new Set(), u: new Set(), t: new Set() };

  rows.forEach((r) => {
    const chainId = s(r[M.chainId]);
    const region = chainRegion.get(chainId) || '';
    /**
     * V7.1：需求「未知的数据不纳入计算，直接在数据源排除」。
     * 匹配不到区域（南区/北区）的连锁行**直接跳过**，不计入任何桶。
     * 实测 mail_31 最新日 18 个连锁中有 3 个（15442/15676/15813）匹配不到，会被排除。
     */
    if (region !== '南区' && region !== '北区') return;

    const keys = ['t'];
    if (region === '南区') keys.push('s');
    else keys.push('n');

    const opened = n(r[M.openedStrategies]);
    const running = n(r[M.runningStrategies]);
    const sent = n(r[M.sent]);
    const arrived = n(r[M.arrived]);
    const gmv = n(r[M.gmv]);
    const couponIssuedPpl = n(r[M.couponIssuedPeople]);
    const couponUsedPpl = n(r[M.couponUsedPeople]);
    const couponIssued = n(r[M.couponIssued]);
    const channelCost = n(r[M.channelCost]);
    const couponCost = n(r[M.couponCost]);
    const couponGmv = n(r[M.couponGmv]);

    keys.forEach((k) => {
      const a = acc[k];
      a.openedStrats += opened;
      a.runStrats += running;
      a.sent += sent;
      a.arrived += arrived;
      a.gmv += gmv;
      a.couponIssuedPpl += couponIssuedPpl;
      a.couponUsedPpl += couponUsedPpl;
      a.couponIssued += couponIssued;
      a.channelCost += channelCost;
      a.couponCost += couponCost;
      a.couponGmv += couponGmv;
      if (opened > 0 && chainId) seen[k].add(chainId);
      if (running > 0 && chainId) seenRun[k].add(chainId);
    });
  });

  const pack = (k) => {
    const a = acc[k];
    return {
      openedChains: seen[k].size,
      runChains: seenRun[k].size,
      openedStrats: round(a.openedStrats, 2),
      runStrats: round(a.runStrats, 2),
      reachRate: round(div(a.arrived, a.sent), 4),
      couponRate: round(div(a.couponUsedPpl, a.couponIssuedPpl), 4),
      gmv: round(a.gmv, 2),
      perCapita: round(div(a.gmv, a.arrived), 2),
      sent: round(a.sent, 2),
      arrived: round(a.arrived, 2),
      couponIssuedPpl: round(a.couponIssuedPpl, 2),
      channelCost: round(a.channelCost, 2),
      couponCost: round(a.couponCost, 2),
      totalCost: round(a.channelCost + a.couponCost, 2),
      couponGmv: round(a.couponGmv, 2),
    };
  };

  const t = pack('t');
  const so = pack('s');
  const no = pack('n');
  const un = pack('u');

  /** 组装成契约结构：south / north / unknown / total */
  const withSplit = (pick) => ({
    south: pick(so),
    north: pick(no),
    unknown: pick(un),
    total: pick(t),
  });

  out.openedStrategy = {
    chains: withSplit((x) => x.openedChains),
    strategies: withSplit((x) => x.openedStrats),
  };
  out.runningStrategy = {
    chains: withSplit((x) => x.runChains),
    strategies: withSplit((x) => x.runStrats),
  };
  out.reachRate = withSplit((x) => x.reachRate);
  out.couponRate = withSplit((x) => x.couponRate);
  out.conversion = {
    ...withSplit((x) => x.gmv),
    perCapita: withSplit((x) => x.perCapita),
  };
  out.people = {
    reached: withSplit((x) => x.sent),
    arrived: withSplit((x) => x.arrived),
    couponIssued: withSplit((x) => x.couponIssuedPpl),
  };
  /* V7 新增成本类指标 */
  out.cost = {
    channelCost: withSplit((x) => x.channelCost),
    couponCost: withSplit((x) => x.couponCost),
    totalCost: withSplit((x) => x.totalCost),
    couponGmv: withSplit((x) => x.couponGmv),
    /** 营销ROI = 成本合计 ÷ 转化销售额 */
    roi: {
      south: round(div(so.totalCost, so.gmv), 2),
      north: round(div(no.totalCost, no.gmv), 2),
      unknown: round(div(un.totalCost, un.gmv), 2),
      total: round(div(t.totalCost, t.gmv), 2),
    },
  };
  return out;
}

/** 第 7 排 */
function buildRow7(run30, chainRegion) {
  return aggregateRow7(run30.rows || [], chainRegion);
}

/**
 * 第 8 排：按策略模块 × 策略类型，分南北区 + 汇总。
 *
 * V7 新增：
 *   - `cost` 指标组（渠道成本 / 用券成本 / 成本合计 / 营销ROI）
 *   - `modules`：按模块聚合的树形结构（前端画「模块 → 类型」链接图用）
 *   - 日期筛选：`range` 参数按「策略开通&触达时间」过滤（默认近 30 日）
 *
 * @param {Object} run31 { rows, importDate }
 * @param {Map} chainRegion 连锁ID → 区域
 * @param {Object} [range] { from, to } 过滤条件（按 touchAt，格式 YYYYMMDD 比较）
 */
function buildRow8(run31, chainRegion, range, allClients) {
  let rows = run31.rows || [];

  /* ── V7 日期筛选：按「策略开通&触达时间」过滤 ── */
  if (range && (range.from || range.to)) {
    const fromKey = range.from ? range.from.replace(/-/g, '') : '';
    const toKey = range.to ? range.to.replace(/-/g, '') : '';
    rows = rows.filter((r) => {
      const k = s(r[M.touchAt]).replace(/[^\d]/g, '');
      if (k.length !== 8) return false;
      if (fromKey && k < fromKey) return false;
      if (toKey && k > toKey) return false;
      return true;
    });
  }

  /* 连锁ID → 客户档案（名称/类型/区域/签约时间/对接版本） */
  const infoMap = new Map();
  (allClients || []).forEach((c) => {
    if (c.chainId) infoMap.set(c.chainId, c);
  });

  const groups = new Map();
  rows.forEach((r) => {
    const model = s(r[M.model]) || '未分类';
    const type = s(r[M.type]) || '未分类';
    const key = `${model}||${type}`;
    if (!groups.has(key)) groups.set(key, { model, type, rows: [] });
    groups.get(key).rows.push(r);
  });

  /** 把一组行打包成 { south, north, total } 三份（每份都含全部指标） */
  const buildTriple = (list) => {
    const mk = (sub) => {
      const agg = aggregateRow7(sub, chainRegion);
      const g = (obj) => ({ south: obj.south, north: obj.north, unknown: obj.unknown, total: obj.total });
      return {
        openedStrategy: {
          chains: g(agg.openedStrategy.chains),
          strategies: g(agg.openedStrategy.strategies),
        },
        runningStrategy: {
          chains: g(agg.runningStrategy.chains),
          strategies: g(agg.runningStrategy.strategies),
        },
        reachRate: g(agg.reachRate),
        couponRate: g(agg.couponRate),
        conversion: { ...g(agg.conversion), perCapita: agg.conversion.perCapita },
        people: {
          reached: agg.people.reached,
          arrived: agg.people.arrived,
          couponIssued: agg.people.couponIssued,
        },
        /** V7 成本指标组 */
        cost: agg.cost,
      };
    };
    const southRows = list.filter((r) => (chainRegion.get(s(r[M.chainId])) || '') === '南区');
    const northRows = list.filter((r) => (chainRegion.get(s(r[M.chainId])) || '') === '北区');
    return {
      south: mk(southRows),
      north: mk(northRows),
      total: mk(list),
    };
  };

  /**
   * V15 11.1：构建某策略类型下「有运行当前策略的连锁明细」（16 列）
   */
  const buildTypeChains = (list) => {
    const byChain = new Map();
    list.forEach((r) => {
      const cid = s(r[M.chainId]);
      if (!cid) return;
      const reg = chainRegion.get(cid) || '';
      if (reg !== '南区' && reg !== '北区') return;
      if (!byChain.has(cid)) byChain.set(cid, []);
      byChain.get(cid).push(r);
    });
    const out = [];
    byChain.forEach((cRows, cid) => {
      const info = infoMap.get(cid) || null;
      const sum = (k) => cRows.reduce((a, r) => a + n(r[k]), 0);
      const max = (k) => cRows.reduce((a, r) => Math.max(a, n(r[k])), 0);
      const running = max(M.runningStrategies);
      const sent = sum(M.sent);
      if (running <= 0 && sent <= 0) return;
      const arrived = sum(M.arrived);
      const gmv = sum(M.gmv);
      const cIssuedPpl = sum(M.couponIssuedPeople);
      const cUsedPpl = sum(M.couponUsedPeople);
      const cIssued = sum(M.couponIssued);
      const cUsed = sum(M.couponUsed);
      const channelCost = sum(M.channelCost);
      const couponCost = sum(M.couponCost);
      const signAt = info ? (info.signAt || info.submitAt) : null;
      const rawVer = info ? (info.version || '') : '';
      const versionShort = /^有券/.test(rawVer)
        ? '有券版本'
        : (/^无券/.test(rawVer) ? '无券版本' : (rawVer || '-'));
      out.push({
        signDate: signAt ? mdCn(signAt) : '-',
        region: (info && info.region) || chainRegion.get(cid) || '未知',
        chainId: cid,
        chainName: (info && info.chainName) || `连锁 ${cid}`,
        chainType: (info && info.chainType) || '未分类',
        version: rawVer || '-',
        versionShort,
        reachedPeople: round(sent, 2),
        arrivedPeople: round(arrived, 2),
        reachRate: round(div(arrived, sent), 4),
        gmv: round(gmv, 2),
        couponIssued: round(cIssued, 2),
        couponUsed: round(cUsed, 2),
        couponRate: round(div(cUsedPpl, cIssuedPpl), 4),
        couponCost: round(couponCost, 2),
        channelCost: round(channelCost, 2),
        roi: round(div(channelCost + couponCost, gmv), 4),
      });
    });
    return out.sort((a, b) => b.reachedPeople - a.reachedPeople || a.chainName.localeCompare(b.chainName, 'zh-CN'));
  };

  const items = Array.from(groups.values()).map((g) => ({
    model: g.model,
    type: g.type,
    ...buildTriple(g.rows),
    chains: buildTypeChains(g.rows),
  }));

  items.sort((a, b) => {
    if (a.model !== b.model) return a.model.localeCompare(b.model, 'zh-CN');
    return a.type.localeCompare(b.type, 'zh-CN');
  });

  /* ── V7：按模块聚合的树形结构（模块 → 类型）── */
  const modelMap = new Map();
  items.forEach((it) => {
    if (!modelMap.has(it.model)) modelMap.set(it.model, { model: it.model, types: [] });
    modelMap.get(it.model).types.push(it);
  });
  const modules = Array.from(modelMap.values()).map((m) => ({
    model: m.model,
    types: m.types,
    /** 该模块下所有类型的合计（便于前端做模块级折叠） */
    ...buildTriple(rows.filter((r) => (s(r[M.model]) || '未分类') === m.model)),
  }));
  modules.sort((a, b) => a.model.localeCompare(b.model, 'zh-CN'));

  return {
    items,
    modules,
    /** 实际参与聚合的日期区间（前端显示用） */
    range: range && (range.from || range.to)
      ? { from: range.from || '', to: range.to || '' }
      : null,
    rowCount: rows.length,
  };
}

/**
 * V14 B4：连锁排名（按触达人数降序）。
 *
 * 数据源：`jdywh_mail_31`（按日明细），按连锁聚合 —— 与下方「策略运行情况」口径一致，
 * 并沿用同一个日期区间（策略开通&触达时间），保证上下两块板数字可互相印证。
 *
 * 口径要点（与 aggregateRow7 保持一致，避免同一屏出现两套数）：
 *   - 触达人数 / 到店人数 / 金额 / 券数 / 成本 → 求和
 *   - 运行策略数 → 按「当日最大」而非求和（同一策略可能每天运行，求和会重复计数）
 *   - 到店率 = 到店 ÷ 触达；优惠券核销率 = 用券人数 ÷ 发券人数
 *   - ROI = (渠道成本 + 优惠券成本) ÷ 转化销售额
 *
 * 区域/连锁类型/连锁名来自 parsed_16（allClients），mail_31 只有连锁ID。
 * 按「当前节点为空」等业务条件以外，这里不做节点过滤 —— 排名看的是运行效果。
 *
 * @param {Object} run31 { rows, importDate }
 * @param {Array} allClients 全量标准化客户（取 chainName/chainType/region）
 * @param {Object} [range] { from, to } 按 touchAt 过滤（YYYY-MM-DD）
 */
function buildChainRanking(run31, allClients, range) {
  let rows = run31.rows || [];

  /* ── 与 buildRow8 同一日期口径：按「策略开通&触达时间」过滤 ── */
  if (range && (range.from || range.to)) {
    const fromKey = range.from ? range.from.replace(/-/g, '') : '';
    const toKey = range.to ? range.to.replace(/-/g, '') : '';
    rows = rows.filter((r) => {
      const k = s(r[M.touchAt]).replace(/[^\d]/g, '');
      if (k.length !== 8) return false;
      if (fromKey && k < fromKey) return false;
      if (toKey && k > toKey) return false;
      return true;
    });
  }

  /* 连锁ID → 客户档案（名称/类型/区域） */
  const infoMap = new Map();
  (allClients || []).forEach((c) => {
    if (c.chainId) infoMap.set(c.chainId, c);
  });

  /* 按连锁分组 */
  const byChain = new Map();
  rows.forEach((r) => {
    const id = s(r[M.chainId]);
    if (!id) return;
    if (!byChain.has(id)) byChain.set(id, []);
    byChain.get(id).push(r);
  });

  const items = [];
  byChain.forEach((list, id) => {
    const info = infoMap.get(id) || null;
    const sum = (k) => list.reduce((a, r) => a + n(r[k]), 0);
    const max = (k) => list.reduce((a, r) => Math.max(a, n(r[k])), 0);

    const sent = sum(M.sent);
    const arrived = sum(M.arrived);
    const gmv = sum(M.gmv);
    const cIssuedPpl = sum(M.couponIssuedPeople);
    const cUsedPpl = sum(M.couponUsedPeople);
    const cIssued = sum(M.couponIssued);
    const cUsed = sum(M.couponUsed);
    const channelCost = sum(M.channelCost);
    const couponCost = sum(M.couponCost);

    /** 运行策略数：按日 MAX（不可求和，同 buildRow9 口径） */
    const runningStrategies = max(M.runningStrategies);

    /** 运行策略：策略类型去重（中文本地化排序） */
    const runningStrategyTypes = Array.from(new Set(
      list.map((r) => s(r[M.type])).filter(Boolean),
    )).sort((a, b) => a.localeCompare(b, 'zh-CN'));

    const region = (info && info.region) || '未知';

    items.push({
      chainId: id,
      chainName: (info && info.chainName) || `连锁 ${id}`,
      chainType: (info && info.chainType) || '未分类',
      region,
      runningStrategyTypes,
      runningStrategies,
      reachedPeople: round(sent, 2),
      arrivedPeople: round(arrived, 2),
      reachRate: round(div(arrived, sent), 4),
      gmv: round(gmv, 2),
      couponIssued: round(cIssued, 2),
      couponUsed: round(cUsed, 2),
      /** 核销率按「人」口径（与 row8 一致），不是按张数 */
      couponRate: round(div(cUsedPpl, cIssuedPpl), 4),
      couponCost: round(couponCost, 2),
      channelCost: round(channelCost, 2),
      roi: round(div(channelCost + couponCost, gmv), 4),
    });
  });

  /**
   * 排序：触达人数降序。
   * 并列时用连锁名中文排序兜底，保证每次请求顺序稳定（否则同值行会随机漂移）。
   * 只保留真正有触达数据的连锁。
   */
  const ranked = items
    .filter((x) => x.reachedPeople > 0)
    .sort((a, b) => {
      if (b.reachedPeople !== a.reachedPeople) return b.reachedPeople - a.reachedPeople;
      return a.chainName.localeCompare(b.chainName, 'zh-CN');
    });

  return { items: ranked, total: ranked.length };
}

/**
 * 第 9 排：近 30 日运行趋势（策略开通&触达时间维度）。
 *
 * V7 修复：V6 用 `jdywh_mail_30` 按 `DATE(import_date)` 分组，但 mail_30 是「整体汇总快照」，
 * 只有 2 个导入日（10-29 / 10-30），导致 30 天趋势里 28 天为 0，图表几乎空白。
 *
 * 正确做法：用 `jdywh_mail_31`（按日明细），以「策略开通&触达时间」（`c_41f1cc4881`，格式 `20261027`）
 * 作为日期轴分组，才能得到真实的每日趋势。
 *
 * 口径注意（契约 §F1）：
 *   - `运行策略数` 不可简单求和（同一策略可能每天都在运行）→ 取每日 `MAX` 代表当日运行策略条数
 *   - `开通策略数` 当日此连锁开通的策略条数 → 求和
 *   - 到店率 / 核销率 = 到店÷发送、用券÷发券
 */
async function buildRow9(now) {
  const days = [];
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push(ymd(d));
  }
  const idx = new Map(days.map((d, i) => [d, i]));
  const keyOf = (d) => ymd(d).replace(/-/g, ''); // '20261027'

  const reached = new Array(days.length).fill(0);
  const runningChains = new Array(days.length).fill(0);
  const openedStrategies = new Array(days.length).fill(0);
  const runningStrategies = new Array(days.length).fill(0);
  const reachRate = new Array(days.length).fill(0);
  const couponRate = new Array(days.length).fill(0);
  const channelCost = new Array(days.length).fill(0);
  const couponCost = new Array(days.length).fill(0);
  const totalCost = new Array(days.length).fill(0);
  const roi = new Array(days.length).fill(0);
  const gmvArr = new Array(days.length).fill(0);

  if (await tableExists('jdywh_mail_31')) {
    const maxd = await db.queryOne('SELECT MAX(import_date) AS d FROM jdywh_mail_31');
    if (maxd && maxd.d) {
      const rows = await db.query(
        `SELECT ${M.touchAt} AS touch_at,
                SUM(CAST(${M.openedStrategies} AS DECIMAL(18,2))) AS opened,
                MAX(CAST(${M.runningStrategies} AS DECIMAL(18,2))) AS running,
                SUM(CAST(${M.sent} AS DECIMAL(18,2))) AS sent,
                SUM(CAST(${M.arrived} AS DECIMAL(18,2))) AS arrived,
                SUM(CAST(${M.couponIssuedPeople} AS DECIMAL(18,2))) AS cIssued,
                SUM(CAST(${M.couponUsedPeople} AS DECIMAL(18,2))) AS cUsed,
                SUM(CAST(${M.gmv} AS DECIMAL(18,2))) AS gmv,
                SUM(CAST(${M.channelCost} AS DECIMAL(18,2))) AS channel_cost,
                SUM(CAST(${M.couponCost} AS DECIMAL(18,2))) AS coupon_cost,
                COUNT(DISTINCT CASE WHEN CAST(${M.runningStrategies} AS DECIMAL(18,2)) > 0 THEN ${M.chainId} END) AS run_chains
         FROM jdywh_mail_31
         WHERE import_date = ?
         GROUP BY ${M.touchAt}
         ORDER BY touch_at ASC`,
        [maxd.d],
      );
      rows.forEach((row) => {
        const raw = s(row.touch_at).replace(/[^\d]/g, '');
        if (raw.length !== 8) return;
        const key = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
        const i = idx.get(key);
        if (i === undefined) return;
        const cost = n(row.channel_cost) + n(row.coupon_cost);
        const gmv = n(row.gmv);
        reached[i] = round(n(row.sent), 2);
        runningChains[i] = n(row.run_chains);
        openedStrategies[i] = round(n(row.opened), 2);
        runningStrategies[i] = round(n(row.running), 2);
        reachRate[i] = round(div(row.arrived, row.sent), 4);
        couponRate[i] = round(div(row.cUsed, row.cIssued), 4);
        channelCost[i] = round(n(row.channel_cost), 2);
        couponCost[i] = round(n(row.coupon_cost), 2);
        totalCost[i] = round(cost, 2);
        gmvArr[i] = round(gmv, 2);
        roi[i] = round(div(cost, gmv), 4);
      });
    }
  }

  return {
    days: days.map((d) => md(d)),
    daysCn: days.map((d) => mdCn(d)),
    reached,
    runningChains,
    openedStrategies,
    runningStrategies,
    reachRate,
    couponRate,
    channelCost,
    couponCost,
    totalCost,
    gmv: gmvArr,
    roi,
  };
}

/* ══════════════════════════════════════════════════════════════════
 * 十四、第 10 排：明细表列配置
 * ══════════════════════════════════════════════════════════════════ */

/**
 * V14 B5：明细表列配置。
 *
 * 默认显示列改为用户指定的 15 列（顺序即下表），并把列宽整体收紧，
 * 目标是 1440px 下同屏可见 ≥14 列（旧配置 chainName 240 + 列宽普遍偏大，一屏只看到 8~9 列）。
 *
 * 「当前节点处理时长」→「当前节点时长」：key 保持 currentNodeDuration（前端依赖），只改 title。
 * 运行类指标（开通/运行策略数、触达人数、到店率）口径 = jdywh_mail_30 快照（见 toFullRow）。
 */
const DETAIL_COLUMNS = [
  { key: 'seq', title: '流水号', width: 52, default: true, align: 'center' },
  { key: 'region', title: '区域', width: 54, default: true, align: 'center' },
  { key: 'chainId', title: '连锁ID', width: 72, default: true, align: 'center' },
  { key: 'chainName', title: '连锁名称', width: 124, default: true },
  { key: 'chainType', title: '连锁类型', width: 74, default: true, align: 'center' },
  { key: 'signType', title: '签约类型', width: 82, default: true, align: 'center' },
  { key: 'sales', title: '销售', width: 62, default: true, align: 'center' },
  { key: 'solution', title: '解决方案', width: 68, default: true, align: 'center' },
  { key: 'node', title: '当前节点', width: 76, default: true, align: 'center' },
  { key: 'status', title: '状态', width: 54, default: true, align: 'center' },
  { key: 'currentNodeDuration', title: '当前节点时长', width: 86, default: true, align: 'right' },
  { key: 'openedStrategies', title: '开通策略数', width: 78, default: true, align: 'right', format: 'num' },
  { key: 'runningStrategies', title: '运行策略数', width: 78, default: true, align: 'right', format: 'num' },
  { key: 'reachedPeople', title: '触达人数', width: 78, default: true, align: 'right', format: 'num' },
  { key: 'reachRate', title: '到店率', width: 64, default: true, align: 'right', format: 'percent' },
  { key: 'stores', title: '门店数', width: 66, default: true, align: 'right', format: 'num' },
  // ── 以下为可选列（默认隐藏） ──
  { key: 'service', title: '客服', width: 66, default: false, align: 'center' },
  { key: 'trainer', title: '培训人', width: 66, default: false, align: 'center' },
  { key: 'currentOwner', title: '当前处理人', width: 80, default: false, align: 'center' },
  { key: 'submitLabel', title: '提交时间', width: 88, default: false, align: 'center' },
  { key: 'submitDays', title: '提交时长（天）', width: 96, default: false, align: 'right', format: 'num' },
  { key: 'couponRate', title: '优惠券核销率', width: 96, default: false, align: 'right', format: 'percent' },
  { key: 'province', title: '省份', width: 80, default: false, align: 'center' },
  { key: 'owner', title: '处理人', width: 74, default: false, align: 'center' },
  { key: 'ownerRole', title: '负责人岗位', width: 86, default: false, align: 'center' },
  { key: 'nodeDays', title: '当前节点时长（天）', width: 108, default: false, align: 'right', format: 'num' },
  { key: 'totalDays', title: '连锁总时长（天）', width: 104, default: false, align: 'right', format: 'num' },
  { key: 'signDate', title: '签约日期', width: 88, default: false, align: 'center' },
];

/* ══════════════════════════════════════════════════════════════════
 * 十五、主入口
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 解析查询参数为筛选条件。
 */
function parseQuery(query) {
  const q = query || {};
  const now = new Date();
  const datePreset = String(q.datePreset || 'all');
  const range = resolveDateRange(datePreset, q.dateFrom, q.dateTo, now);

  return {
    now,
    datePreset,
    range,
    filters: {
      datePreset,
      from: range.from,
      to: range.to,
      regions: parseList(q.regions),
      chainTypes: parseList(q.chainTypes),
      sales: parseList(q.sales),
      flowStatus: parseList(q.flowStatus),
      service: parseList(q.service),
      solution: parseList(q.solution),
      trainer: parseList(q.trainer),
      version: parseList(q.version),
      connectResult: parseList(q.connectResult),
      trainResult: parseList(q.trainResult),
      openedStrategy: parseList(q.openedStrategy),
      validOnly: String(q.validOnly || '0') === '1',
    },
    target: Number(q.target) > 0 ? Number(q.target) : DEFAULT_TARGET,
  };
}

/**
 * 构建看板全量数据。
 * @param {Object} query 请求 query
 */
async function buildBoard(query) {
  const { now, datePreset, range, filters, target } = parseQuery(query);

  // 并行加载全部数据源
  const [rawClients, staff, run30, run31, flowEvents] = await Promise.all([
    loadClients(),
    loadStaff(),
    loadRunSummary(),
    loadRunDetail(),
    loadFlowEvents(),
  ]);

  // 运行数据按连锁ID 建索引（mail_30 是最新快照，缺失时回退 mail_31 按连锁聚合）
  const runMap = new Map();
  (run30.rows || []).forEach((r) => {
    const id = s(r[M.chainId]);
    if (id) runMap.set(id, r);
  });
  // V15：补充 mail_31 聚合兜底，避免在 mail_31 有数据但 mail_30 缺失的客户显示 0
  const byChain31 = new Map();
  (run31.rows || []).forEach((r) => {
    const id = s(r[M.chainId]);
    if (!id) return;
    if (!byChain31.has(id)) byChain31.set(id, []);
    byChain31.get(id).push(r);
  });
  byChain31.forEach((list, id) => {
    if (runMap.has(id)) return;
    const sum = (k) => list.reduce((acc, r) => acc + n(r[k]), 0);
    const max = (k) => list.reduce((acc, r) => Math.max(acc, n(r[k])), 0);
    const out = {};
    [M.sent, M.arrived, M.gmv, M.couponIssuedPeople, M.couponUsedPeople,
      M.couponIssued, M.couponUsed, M.couponGmv, M.couponCost, M.channelCost,
    ].forEach((k) => { out[k] = sum(k); });
    out[M.runningStrategies] = max(M.runningStrategies);
    out[M.openedStrategies] = max(M.openedStrategies);
    runMap.set(id, out);
  });

  // 标准化全部客户
  const allClients = rawClients.map((r) => normalizeClient(r, staff, runMap, now));
  // 分配固定客户流水号（1 .. N，按入库顺序）
  const seqMap = new Map();
  allClients.forEach((c, idx) => {
    seqMap.set(c.chainId || `${idx}`, idx + 1);
  });

  // 连锁ID → 区域（运行数据分南北区用）
  const chainRegion = new Map();
  allClients.forEach((c) => {
    if (c.chainId) chainRegion.set(c.chainId, c.region);
  });

  // 应用筛选
  const clients = applyFilters(allClients, filters);

  // 构建各排
  const row1 = buildRow1(clients, staff, target);
  const row2 = buildRow2(clients);
  const row3 = buildRow3(clients);

  const prevRange = previousRange(datePreset, range.from, range.to, now);
  const compare = buildCompare(allClients, filters, range, prevRange, now);

  const row6 = buildRow6(clients, flowEvents, now);
  const row7 = buildRow7(run30, chainRegion);
  /**
   * V7：第 8 排支持独立日期区间（按「策略开通&触达时间」）。
   * 优先用 query 里的 row8DatePreset/From/To；未指定时默认「近 30 日」。
   * 顶部全局日期筛选同步到此处（契约 §F4）。
   */
  const row8Range = resolveRow8Range(query, range, now);
  const row8 = buildRow8(run31, chainRegion, row8Range, allClients);
  /** V14 B4：连锁排名（按触达人数降序），与 row8 共用日期区间口径 */
  const chainRanking = buildChainRanking(run31, allClients, row8Range);
  const row9 = await buildRow9(now);

  // V15 13.5：明细表流水号按整表降序显示（首行最大，末行最小）
  const detailRows = clients
    .map((c, i) => toFullRow(c, seqMap.get(c.chainId) || (i + 1)))
    .sort((a, b) => b.seq - a.seq);

  // V15 13.4：读取服务端保存的客户明细列设置（对分享页生效）
  let savedColumns = null;
  try {
    const settings = require('./settings');
    const rawSaved = await settings.get('crmboard_detail_columns', '');
    if (rawSaved) {
      const parsed = JSON.parse(rawSaved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        savedColumns = parsed.map((x) => String(x));
      }
    }
  } catch (_) { /* ignore */ }

  /**
   * V14 B2：筛选选项与计数一律基于**全量**客户（allClients），不是筛选后的 clients。
   *
   * 根因（用户报障「选南区后北区选项消失」）：
   *   原实现用的是 `clients`（已筛选）→ 选了南区，"北区"自然不在集合里，
   *   下拉选项当场消失，用户无法再切回北区/多选。
   * 修复：顶部筛选框 = 全部数据，选项集合与计数恒为全量口径。
   * 各排数据仍按筛选后的 `clients` 计算（下方 row1..row9 / detailRows 不变）。
   */
  const { options, counts } = buildOptionsAndCounts(allClients);

  return {
    meta: {
      syncedAt: await resolveSyncedAt(rawClients, run30, run31),
      generatedAt: new Date().toISOString(),
      dateLabel: range.label,
      target,
      isCompareMode: compare !== null,
      filters: {
        datePreset,
        dateFrom: range.from,
        dateTo: range.to,
        regions: filters.regions,
        chainTypes: filters.chainTypes,
        sales: filters.sales,
        flowStatus: filters.flowStatus,
        service: filters.service,
        solution: filters.solution,
        trainer: filters.trainer,
        version: filters.version,
        connectResult: filters.connectResult,
        trainResult: filters.trainResult,
        openedStrategy: filters.openedStrategy,
        validOnly: filters.validOnly,
      },
      options,
      counts,
    },
    row1,
    row2,
    row3,
    compare,
    row6,
    row7,
    row8,
    row9,
    /** V14 B4：连锁排名（策略运行情况板块上方的从左至右卡片） */
    chainRanking,
    detail: {
      columns: DETAIL_COLUMNS,
      rows: detailRows,
      savedColumns,
    },
  };
}

/**
 * 明细服务端分页（供「更多」弹窗与需要分页的场景使用）。
 */
async function buildDetailPage(query, page, pageSize) {
  const board = await buildBoard(query);
  const rows = board.detail.rows;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(200, Math.max(1, Number(pageSize) || 20));
  const start = (p - 1) * ps;
  return {
    total: rows.length,
    page: p,
    pageSize: ps,
    rows: rows.slice(start, start + ps),
  };
}

/**
 * V7.1：单个客户的完整详情（供明细表「点击客户名称」查看）。
 *
 * @param {string|number} chainId 连锁ID
 * @returns {Promise<Object|null>} 找不到返回 null
 */
/**
 * V10 CD：客户策略运行趋势（近 30 日）
 *
 * 关键：必须查 jdywh_mail_31 的**全部历史日期**。
 * 不能用 loadRunDetail()，那个函数只返回 MAX(import_date) 一天 → 趋势只会有一个点。
 *
 * 实测当前 mail_31 有 4 天：2026-10-29 / 10-30 / 10-31 / 11-01，
 * 因此轴以「数据里真实存在的日期」为准（最多 30 个），而不是自然 30 天，
 * 前端拿到 dayCount 后据此渲染即可。
 */
async function buildClientTrend(chainId, now) {
  const id = s(chainId);
  if (!id) return null;
  if (!(await tableExists('jdywh_mail_31'))) return null;

  let rows;
  try {
    rows = await db.query('SELECT * FROM jdywh_mail_31');
  } catch (_) {
    return null;
  }
  if (!rows || !rows.length) return null;

  /** 只保留该客户的行，并按日期归档 */
  const byDay = new Map();
  rows.forEach((r) => {
    if (s(r[M.chainId]) !== id) return;
    const raw = r.import_date;
    const key = raw instanceof Date ? ymd(raw) : String(raw || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(r);
  });
  if (!byDay.size) return null;

  /** 以真实数据日期为轴，取最近 30 个（升序） */
  const allDays = [...byDay.keys()].sort();
  const days = allDays.slice(-30);
  const len = days.length;

  const mk = () => new Array(len).fill(0);
  const acc = {
    reached: mk(), arrived: mk(),
    couponIssued: mk(), couponIssuedPpl: mk(), couponUsed: mk(), couponUsedPpl: mk(),
    channelCost: mk(), couponCost: mk(), gmv: mk(),
  };
  days.forEach((d, i) => {
    byDay.get(d).forEach((r) => {
      acc.reached[i] += n(r[M.sent]);
      acc.arrived[i] += n(r[M.arrived]);
      acc.couponIssuedPpl[i] += n(r[M.couponIssuedPeople]);
      acc.couponUsedPpl[i] += n(r[M.couponUsedPeople]);
      acc.couponIssued[i] += n(r[M.couponIssued]);
      acc.couponUsed[i] += n(r[M.couponUsed]);
      acc.channelCost[i] += n(r[M.channelCost]);
      acc.couponCost[i] += n(r[M.couponCost]);
      acc.gmv[i] += n(r[M.gmv]);
    });
  });

  const r4 = (v) => Math.round((Number.isFinite(v) ? v : 0) * 10000) / 10000;

  return {
    days: days.map((d) => md(d)),
    daysRaw: days,
    daysCn: days.map((d) => mdCn(d)),
    dayCount: len,
    series: {
      reached: acc.reached.map(r4),
      /* 触达人次：汇总表无人次列，用「触达人数 + 到店人数」作为可见口径 */
      reachedTimes: acc.reached.map((v, i) => r4(v + acc.arrived[i])),
      reachRate: acc.reached.map((v, i) => r4(div(acc.arrived[i], v))),
      couponIssued: acc.couponIssued.map(r4),
      couponUsed: acc.couponUsed.map(r4),
      couponRate: acc.couponIssuedPpl.map((v, i) => r4(div(acc.couponUsedPpl[i], v))),
      channelCost: acc.channelCost.map(r4),
      couponCost: acc.couponCost.map(r4),
      totalCost: acc.channelCost.map((v, i) => r4(v + acc.couponCost[i])),
      roi: acc.gmv.map((v, i) => r4(div(acc.channelCost[i] + acc.couponCost[i], v))),
    },
  };
}

async function buildClientDetail(chainId) {
  const id = s(chainId);
  if (!id) return null;

  const now = new Date();
  /**
   * V8.1：客户详情补充运行数据。
   *
   * 实测：`jdywh_mail_30`（by整体汇总）最新日只有 19 个连锁，与 parsed_16 的 97 个客户
   * 交集仅 15 个 —— 绝大多数客户在 mail_30 里没有行，导致详情「运行数据」全空。
   * 而 `jdywh_mail_31`（by明细）覆盖同一批连锁，且 row7 也用它，口径一致。
   *
   * 因此这里同时加载 mail_30 与 mail_31：优先 mail_30（快照汇总），
   * 缺失时回退到「把该连锁在 mail_31 的多行按类型聚合」。
   */
  const [staff, run30, run31, allClients] = await Promise.all([
    loadStaff(),
    loadRunSummary(),
    loadRunDetail(),
    loadClients(),
  ]);

  // 运行数据按连锁ID 建索引（与 buildBoard 保持一致）
  const runMap = new Map();
  (run30.rows || []).forEach((r) => {
    const cid = s(r[M.chainId]);
    if (cid) runMap.set(cid, r);
  });

  /* mail_31 按连锁聚合（当 mail_30 无该连锁时作为兜底） */
  const run31Agg = (() => {
    const list = (run31.rows || []).filter((r) => s(r[M.chainId]) === id);
    if (!list.length) return null;
    const sum = (k) => list.reduce((acc, r) => acc + n(r[k]), 0);
    const max = (k) => list.reduce((acc, r) => Math.max(acc, n(r[k])), 0);
    const out = {};
    // 累加型指标
    [M.sent, M.arrived, M.gmv, M.couponIssuedPeople, M.couponUsedPeople,
      M.couponIssued, M.couponUsed, M.couponGmv, M.couponCost, M.channelCost,
    ].forEach((k) => { out[k] = sum(k); });
    // 策略数按「当日最大」而非求和（同一策略可能每天都运行）
    out[M.runningStrategies] = max(M.runningStrategies);
    out[M.openedStrategies] = max(M.openedStrategies);
    return out;
  })();

  const clients = (allClients || []).map((raw) => normalizeClient(raw, staff, runMap, now));
  const c = clients.find((x) => x.chainId === id);
  if (!c) return null;
  /** 供下方 runMetrics 使用：mail_30 优先，缺失回退 mail_31 聚合值 */
  const runSource = c.run || run31Agg;
  const runSourceKind = c.run ? 'mail_30' : (run31Agg ? 'mail_31' : null);

  /** 9 个节点的完成时间与该节点停留时长 */
  const NODE_COLS = [
    { name: '销售签约', col: C.tSubmit },
    { name: '策略开通', col: C.tStrategyOpen },
    { name: '实施对接', col: C.tImplement },
    { name: '对接审核', col: C.tImplAudit },
    { name: '客服处理', col: C.tService },
    { name: '客户培训', col: C.tTrain },
    { name: '连锁使用', col: C.tChainUse },
    { name: '策略审核', col: C.tStrategyAudit },
  ];
  const raw = c.runRaw || {};
  const doneAt = NODE_COLS.map((x) => ({ name: x.name, at: toDate(raw[x.col]) }));

  const timeline = doneAt.map((x, i) => {
    const prev = i > 0 ? doneAt[i - 1].at : null;
    const isCurrent = !c.isCompleted && c.node === x.name;
    const isNodeDone = !!x.at;
    let durationLabel = '';
    if (x.at && prev) {
      const hrs = (x.at.getTime() - prev.getTime()) / 3600000;
      durationLabel = hrs < 24 ? `${round(hrs, 1)}时` : `${round(hrs / 24, 1)}天`;
    } else if (x.at && i === 0) {
      durationLabel = '起点';
    }
    return {
      name: x.name,
      doneAt: x.at ? x.at.toISOString() : '',
      doneAtLabel: x.at ? `${mdCn(x.at)} ${String(x.at.getHours()).padStart(2, '0')}:${String(x.at.getMinutes()).padStart(2, '0')}` : '',
      done: isNodeDone,
      isCurrent,
      /** 相对上一节点的耗时 */
      durationLabel,
    };
  });
  // 当前节点（未完成时）补一条「进行中」：替换该节点原本的「未开始」
  if (!c.isCompleted && c.node) {
    const idx = FLOW_NODES.indexOf(c.node);
    const curDur = c.nodeDays < 1 ? `${round(c.nodeDays * 24, 1)}时` : `${round(c.nodeDays, 1)}天`;
    const curNode = {
      name: c.node,
      doneAt: '',
      doneAtLabel: '',
      done: false,
      isCurrent: true,
      durationLabel: curDur,
    };
    const exist = timeline.findIndex((x) => x.name === c.node);
    if (exist >= 0) timeline[exist] = curNode;
    else if (idx >= 0) timeline.splice(idx, 0, curNode);
  }

  return {
    client: {
      chainId: c.chainId,
      chainName: c.chainName,
      chainType: c.chainType,
      region: c.region,
      province: c.province,
      stores: c.stores,
      signType: c.signType,
      sales: c.sales,
      service: c.service,
      solution: c.solution,
      trainer: c.trainer,
      version: c.version,
      connectResult: c.connectResult,
      trainResult: c.trainResult,
    },
    progress: {
      node: c.node,
      nodeRaw: c.nodeRaw,
      isCompleted: c.isCompleted,
      owner: c.owner,
      ownerRoles: c.ownerRoles,
      enterAtLabel: c.enterAt ? mdCn(c.enterAt) : '',
      /** V14：流程已结束 → 当前节点时长无意义，返回 null（前端显示「—」） */
      nodeDays: c.nodeDays == null ? null : round(c.nodeDays, 1),
      currentNodeDuration: c.nodeDays == null
        ? '—'
        : (c.nodeDays < 1 ? `${round(c.nodeDays * 24, 1)}时` : `${round(c.nodeDays, 1)}天`),
      totalDays: round(c.totalDays, 1),
      status: c.status,
      isOverdue: c.isOverdue,
      /** 超期时：已超出阈值多少个工作日 */
      overdueDays: c.overdueDays,
      overdueThreshold: c.overdueThreshold,
      overdueRule: c.overdueRule,
      workdays: c.workdays,
      prevDoneAtLabel: c.prevDoneAt ? mdCn(c.prevDoneAt) : '',
    },
    timeline,
    run: c.run || null,
    /**
     * V8.1：把 run（mail_30 原始行）解析成结构化指标，前端直接渲染，
     * 不再需要自己认 c_xxxx 列名。run 为 null 时返回 null。
     *
     * V13 A6 根因修复：
     *   原实现第 1 行是 `const r = c.run;`，只读 mail_30 快照。
     *   实测 mail_30 最新日仅 19 个连锁，与 parsed_16 的 112 个客户交集只有 15 个，
     *   其余 97 个客户的 runMetrics 恒为 null → 客户详情「策略与运行」永远显示
     *   「暂无运行数据」。而上面 L2341 已经算好了 runSource（mail_30 优先、
     *   缺失回退 mail_31 按连锁聚合），却从未被使用（死代码）。
     *   现在真正接上 runSource，并回传 source 让前端标注数据来源。
     */
    runMetrics: (() => {
      const r = runSource;
      if (!r) return null;
      const g = (k) => n(r[k]);
      const opened = g(M.openedStrategies);
      const running = g(M.runningStrategies);
      const sent = g(M.sent);
      const arrived = g(M.arrived);
      const gmv = g(M.gmv);
      const cIssuedPpl = g(M.couponIssuedPeople);
      const cUsedPpl = g(M.couponUsedPeople);
      const cIssued = g(M.couponIssued);
      const cUsed = g(M.couponUsed);
      const channelCost = g(M.channelCost);
      const couponCost = g(M.couponCost);
      const totalCost = channelCost + couponCost;
      /** V13 A6：开通了哪些「策略类型」（来源 mail_31 的 M.type 列，按连锁去重排序） */
      const clientRun31 = (run31.rows || []).filter((x) => s(x[M.chainId]) === id);
      const openedStrategyTypes = Array.from(new Set(
        clientRun31
          .map((x) => s(x[M.type]))
          .filter(Boolean),
      )).sort((a, b) => a.localeCompare(b, 'zh-CN'));

      /**
       * V15 14.6：按策略类型分组聚合该客户的运行明细（11 列）
       * 表头：策略类型, 触达人数, 到店人数, 到店率, 转化销售额, 发放优惠券, 核销优惠券, 优惠券核销率, 优惠券成本, 渠道成本, ROI
       */
      const byType = new Map();
      clientRun31.forEach((row) => {
        const tp = s(row[M.type]) || '未分类';
        if (!byType.has(tp)) byType.set(tp, []);
        byType.get(tp).push(row);
      });
      const strategyTypes = Array.from(byType.entries()).map(([tp, list]) => {
        const sum = (k) => list.reduce((acc, row) => acc + n(row[k]), 0);
        const tSent = sum(M.sent);
        const tArr = sum(M.arrived);
        const tGmv = sum(M.gmv);
        const tIssPpl = sum(M.couponIssuedPeople);
        const tUsePpl = sum(M.couponUsedPeople);
        const tIss = sum(M.couponIssued);
        const tUse = sum(M.couponUsed);
        const tChCost = sum(M.channelCost);
        const tCpCost = sum(M.couponCost);
        const tTotCost = tChCost + tCpCost;
        return {
          type: tp,
          reachedPeople: round(tSent, 2),
          arrivedPeople: round(tArr, 2),
          reachRate: round(div(tArr, tSent), 4),
          gmv: round(tGmv, 2),
          couponIssued: round(tIss, 2),
          couponUsed: round(tUse, 2),
          couponRate: round(div(tUsePpl, tIssPpl), 4),
          couponCost: round(tCpCost, 2),
          channelCost: round(tChCost, 2),
          roi: round(div(tTotCost, tGmv), 4),
        };
      }).sort((a, b) => b.reachedPeople - a.reachedPeople || a.type.localeCompare(b.type, 'zh-CN'));

      return {
        /** 数据来源：mail_30（当日快照）或 mail_31（按连锁聚合兜底），null 表示无运行数据 */
        source: runSourceKind,
        openedStrategyTypes,
        strategyTypes,
        openedStrategies: round(opened, 2),
        runningStrategies: round(running, 2),
        reachedPeople: round(sent, 2),
        arrivedPeople: round(arrived, 2),
        reachRate: round(div(arrived, sent), 4),
        couponIssuedPeople: round(cIssuedPpl, 2),
        couponUsedPeople: round(cUsedPpl, 2),
        couponIssued: round(cIssued, 2),
        couponUsed: round(cUsed, 2),
        couponRate: round(div(cUsedPpl, cIssuedPpl), 4),
        gmv: round(gmv, 2),
        perCapita: round(div(gmv, arrived), 2),
        channelCost: round(channelCost, 2),
        couponCost: round(couponCost, 2),
        totalCost: round(totalCost, 2),
        roi: round(div(totalCost, gmv), 4),
      };
    })(),
    /** V10 CD：近 30 日策略运行趋势（无数据则 null，前端降级展示） */
    trend: await buildClientTrend(id, now),
    signAtLabel: c.signAt ? mdCn(c.signAt) : '',
    submitAtLabel: c.submitAt ? mdCn(c.submitAt) : '',
  };
}

module.exports = {
  buildBoard,
  buildDetailPage,
  buildClientDetail,
  buildClientTrend,
  // 导出内部件便于单测
  _internal: {
    resolveDateRange,
    previousRange,
    mapNode,
    resolveSignType,
    isStrategyOpened,
    normalizeClient,
    applyFilters,
    toDate,
    ymd,
    md,
    mdCn,
    nameKey,
    round,
    div,
    FLOW_NODES,
    NODE_ALIAS,
    VALID_CHAIN_TYPES,
    CHAIN_TYPE_ORDER,
    DETAIL_COLUMNS,
    C,
    M,
  },
};
