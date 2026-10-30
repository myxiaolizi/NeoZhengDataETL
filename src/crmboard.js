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
 * 原始节点名（flow_current_node / widget_1791533061604）→ 9 节点之一。
 * 依据实测 13 种旧值 + 7 种当前节点值。
 */
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
    ...Object.values(C),
    'flow_current_node',
    'flow_current_owner',
    'updated_at',
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
  // 流程完成判定：flow_current_node 为空（口径 §3.2-2）
  const isCompleted = !currentNodeRaw;
  const node = isCompleted ? '流程结束' : mapNode(currentNodeRaw || nodeFieldRaw);

  const owner = s(raw[C.currentOwner]);
  const roles = ownerRoles(owner, staff);

  const enterAt = isCompleted ? toDate(raw[C.tChainUse]) || toDate(raw[C.tSubmit]) : enterNodeTime(raw, node);
  const submitAt = toDate(raw[C.tSubmit]) || toDate(raw[C.signTime]);
  const nodeDays = daysSince(enterAt, now);
  const totalDays = daysSince(submitAt, now);

  const run = runMap.get(chainId) || null;

  const signAt = toDate(raw[C.signTime]) || submitAt;

  return {
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
    status: nodeDays > OVERDUE_DAYS ? '超期' : '正常',
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
  return {
    chainId: c.chainId,
    region: c.region,
    chainName: c.chainName,
    chainType: c.chainType,
    stores: c.stores,
    node: c.isCompleted ? '' : c.node,
    owner: c.owner,
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
  return {
    ...toDetailRow(c),
    seq,
    signType: c.signType,
    province: c.province,
    signDate: c.signAt ? mdCn(c.signAt) : '',
    submitLabel: c.submitAt ? mdCn(c.submitAt) : '',
    submitDays: c.totalDays,
    openedStrategies: opened,
    runningStrategies: running,
    reachedPeople: reached,
    reachRate: round(div(arrived, reached), 4),
    couponRate: round(div(couponUsed, couponIssued), 4),
    ownerRole: c.ownerRoles[0] || '',
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

  // 任务完成进度：客户数 / target，南北区各 target/2
  const halfTarget = Math.max(1, Math.round(target / 2));
  const southClients = clients.filter((c) => c.region === '南区').length;
  const northClients = clients.filter((c) => c.region === '北区').length;
  const progress = {
    achieved: totalClients,
    target,
    rate: round(div(totalClients, target) * 100, 1),
    south: {
      achieved: southClients,
      target: halfTarget,
      rate: round(div(southClients, halfTarget) * 100, 1),
    },
    north: {
      achieved: northClients,
      target: halfTarget,
      rate: round(div(northClients, halfTarget) * 100, 1),
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

  // 进行中：只统计未完成
  const active = clients.filter((c) => !c.isCompleted);

  // 策略处理中：当前节点 ∈ {策略开通, 策略审核}，按节点名汇总
  const strategyList = active.filter((c) => c.node === '策略开通' || c.node === '策略审核');
  const strategyGroups = groupBy(strategyList, (c) => c.node, toDetailRow);

  // 岗位处理中：按负责人岗位
  const roleGroup = (roleName) => {
    const list = active.filter((c) => c.ownerRoles.includes(roleName));
    return { total: list.length, groups: groupBy(list, (c) => c.owner || '未分配', toDetailRow) };
  };

  const inProgress = {
    total: active.length,
    strategy: { total: strategyList.length, groups: strategyGroups },
    implement: roleGroup('实施'),
    service: roleGroup('客服'),
    solution: roleGroup('解决方案'),
    sales: roleGroup('销售'),
  };

  // 流程状态：flow_current_node 为空 = 流程完成
  const completed = clients.filter((c) => c.isCompleted);
  const completedStores = completed.reduce((sum, c) => sum + c.stores, 0);
  const completedRegion = regionSplit(completed, () => 1);
  // 策略开通情况：已开通 / 未开通
  const strategyOpened = completed.filter((c) => isStrategyOpened(c)).length;
  const strategyNotOpened = completed.length - strategyOpened;

  const flowStatus = {
    completedClients: completed.length,
    completedStores,
    south: completedRegion.south,
    north: completedRegion.north,
    strategyOpened,
    strategyNotOpened,
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

function buildRow2(clients) {
  const total = clients.length;
  const excluded = clients.filter((c) => RATIO_EXCLUDED.includes(c.node)).length;
  const denominator = Math.max(0, total - excluded);

  const nodes = FLOW_NODES.map((name) => {
    const list = clients.filter((c) => c.node === name);
    const stores = list.reduce((sum, c) => sum + c.stores, 0);
    const avgDays = list.length
      ? round(list.reduce((sum, c) => sum + c.nodeDays, 0) / list.length, 1)
      : 0;

    // 按岗位汇总
    const roleMap = new Map();
    list.forEach((c) => {
      const roles = c.ownerRoles.length ? c.ownerRoles : ['未分配'];
      roles.forEach((r) => roleMap.set(r, (roleMap.get(r) || 0) + 1));
    });
    const byRole = Array.from(roleMap.entries())
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => b.count - a.count);

    return {
      key: name,
      name,
      clients: list.length,
      ratio: RATIO_EXCLUDED.includes(name) ? 0 : round(div(list.length, denominator), 4),
      stores,
      avgDays,
      byRole,
      rows: list.map(toDetailRow),
    };
  });

  return { nodes };
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
    if (!map.has(k)) map.set(k, { name: k, clients: 0, stores: 0, typeMap: new Map() });
    const item = map.get(k);
    item.clients += 1;
    item.stores += c.stores;
    const t = c.chainType || '未分类';
    const tag = item.typeMap.get(t) || { name: t, count: 0 };
    tag.count += valueFn(c) ? 1 : 1; // 标签统计「连锁家数」
    item.typeMap.set(t, tag);
  });

  return Array.from(map.values())
    .map((item) => ({
      rank: 0,
      name: item.name,
      clients: item.clients,
      stores: round(item.stores, 2),
      tags: sortChainTypes(Array.from(item.typeMap.keys())).map((t) => item.typeMap.get(t)),
    }))
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
    south,
    north,
    stores,
    byChainType,
  };

  // ── 流程推进：最近 5 个工作日 ──
  const workdays = [];
  let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let guard = 0;
  while (workdays.length < 5 && guard < 30) {
    if (isWorkday(cursor)) workdays.unshift(ymd(cursor));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
    guard += 1;
  }

  const nodeList = FLOW_NODES.slice();
  const matrix = nodeList.map(() => new Array(workdays.length).fill(0));
  const wdIdx = new Map(workdays.map((d, i) => [d, i]));
  const nodeIdx = new Map(nodeList.map((nm, i) => [nm, i]));

  flowEvents.forEach((e) => {
    // 只统计「完成」事件：event_completed_count > 0
    const done = n(e.event_completed_count);
    if (done <= 0) return;
    const at = toDate(e.header_created_at_p) || toDate(e.header_created_at);
    if (!at) return;
    const i = wdIdx.get(ymd(at));
    if (i === undefined) return;
    const nodeName = mapNode(e.event_flow_name);
    const j = nodeIdx.get(nodeName);
    if (j === undefined) return;
    matrix[j][i] += done;
  });

  const flowProgress = {
    days: workdays.map((d) => md(d)),
    nodes: nodeList,
    matrix,
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
 * 把一组 mail_30/31 行聚合成 Row7Data。
 * @param {Array} rows 运行数据行（mail_30 或 mail_31 的子集）
 * @param {Map} chainRegion 连锁ID → 区域
 */
function aggregateRow7(rows, chainRegion) {
  const out = emptyRow7();
  const acc = {
    s: { openedChains: 0, openedStrats: 0, runChains: 0, runStrats: 0, sent: 0, arrived: 0, gmv: 0, couponIssuedPpl: 0, couponUsedPpl: 0, couponIssued: 0 },
    n: { openedChains: 0, openedStrats: 0, runChains: 0, runStrats: 0, sent: 0, arrived: 0, gmv: 0, couponIssuedPpl: 0, couponUsedPpl: 0, couponIssued: 0 },
    t: { openedChains: 0, openedStrats: 0, runChains: 0, runStrats: 0, sent: 0, arrived: 0, gmv: 0, couponIssuedPpl: 0, couponUsedPpl: 0, couponIssued: 0 },
  };

  // 按连锁去重统计「连锁数」
  const seen = { s: new Set(), n: new Set(), t: new Set() };
  const seenRun = { s: new Set(), n: new Set(), t: new Set() };

  rows.forEach((r) => {
    const chainId = s(r[M.chainId]);
    const region = chainRegion.get(chainId) || '';
    const keys = ['t'];
    if (region === '南区') keys.push('s');
    if (region === '北区') keys.push('n');

    const opened = n(r[M.openedStrategies]);
    const running = n(r[M.runningStrategies]);
    const sent = n(r[M.sent]);
    const arrived = n(r[M.arrived]);
    const gmv = n(r[M.gmv]);
    const couponIssuedPpl = n(r[M.couponIssuedPeople]);
    const couponUsedPpl = n(r[M.couponUsedPeople]);
    const couponIssued = n(r[M.couponIssued]);

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
      if (opened > 0 && chainId) seen[k].add(chainId);
      if (running > 0 && chainId) seenRun[k].add(chainId);
    });
  });

  const pack = (k) => {
    const a = acc[k];
    return {
      openedStrategy: {
        chains: { south: 0, north: 0, total: seen[k].size },
        strategies: { south: 0, north: 0, total: round(a.openedStrats, 2) },
      },
      runningStrategy: {
        chains: { south: 0, north: 0, total: seenRun[k].size },
        strategies: { south: 0, north: 0, total: round(a.runStrats, 2) },
      },
      reachRate: round(div(a.arrived, a.sent), 4),
      couponRate: round(div(a.couponUsedPpl, a.couponIssuedPpl), 4),
      conversion: {
        total: round(a.gmv, 2),
        perCapita: round(div(a.gmv, a.arrived), 2),
      },
      people: {
        reached: { total: round(a.sent, 2) },
        couponIssued: { total: round(a.couponIssuedPpl, 2) },
      },
      _raw: a,
    };
  };

  const t = pack('t');
  const so = pack('s');
  const no = pack('n');

  // 组装成契约结构（每个指标都带 south/north/total）
  const withSplit = (pick) => ({
    south: pick(so),
    north: pick(no),
    total: pick(t),
  });

  out.openedStrategy = {
    chains: withSplit((x) => x.openedStrategy.chains.total),
    strategies: withSplit((x) => x.openedStrategy.strategies.total),
  };
  out.runningStrategy = {
    chains: withSplit((x) => x.runningStrategy.chains.total),
    strategies: withSplit((x) => x.runningStrategy.strategies.total),
  };
  out.reachRate = withSplit((x) => x.reachRate);
  out.couponRate = withSplit((x) => x.couponRate);
  out.conversion = {
    ...withSplit((x) => x.conversion.total),
    perCapita: withSplit((x) => x.conversion.perCapita),
  };
  out.people = {
    reached: withSplit((x) => x.people.reached.total),
    couponIssued: withSplit((x) => x.people.couponIssued.total),
  };
  return out;
}

/** 第 7 排 */
function buildRow7(run30, chainRegion) {
  return aggregateRow7(run30.rows || [], chainRegion);
}

/** 第 8 排：按策略模块 × 策略类型，分南北区 */
function buildRow8(run31, chainRegion) {
  const rows = run31.rows || [];
  const groups = new Map();
  rows.forEach((r) => {
    const model = s(r[M.model]) || '未分类';
    const type = s(r[M.type]) || '未分类';
    const key = `${model}||${type}`;
    if (!groups.has(key)) groups.set(key, { model, type, rows: [] });
    groups.get(key).rows.push(r);
  });

  const items = Array.from(groups.values()).map((g) => {
    // 南区：只保留南区的连锁；北区同理
    const southRows = g.rows.filter((r) => (chainRegion.get(s(r[M.chainId])) || '') === '南区');
    const northRows = g.rows.filter((r) => (chainRegion.get(s(r[M.chainId])) || '') === '北区');
    const mkRegion = (list) => {
      const agg = aggregateRow7(list, chainRegion);
      // 只保留该区域自己的数值（把 total 换成该区域值）
      const pick = (obj) => ({ south: obj.south, north: obj.north, total: obj.south || obj.north || obj.total });
      return {
        openedStrategy: {
          chains: { south: agg.openedStrategy.chains.south, north: agg.openedStrategy.chains.north, total: agg.openedStrategy.chains.total },
          strategies: { south: agg.openedStrategy.strategies.south, north: agg.openedStrategy.strategies.north, total: agg.openedStrategy.strategies.total },
        },
        runningStrategy: {
          chains: { south: agg.runningStrategy.chains.south, north: agg.runningStrategy.chains.north, total: agg.runningStrategy.chains.total },
          strategies: { south: agg.runningStrategy.strategies.south, north: agg.runningStrategy.strategies.north, total: agg.runningStrategy.strategies.total },
        },
        reachRate: { south: agg.reachRate.south, north: agg.reachRate.north, total: agg.reachRate.total },
        couponRate: { south: agg.couponRate.south, north: agg.couponRate.north, total: agg.couponRate.total },
        conversion: {
          south: agg.conversion.south, north: agg.conversion.north, total: agg.conversion.total,
          perCapita: agg.conversion.perCapita,
        },
        people: {
          reached: agg.people.reached,
          couponIssued: agg.people.couponIssued,
        },
      };
    };
    return {
      model: g.model,
      type: g.type,
      south: mkRegion(southRows),
      north: mkRegion(northRows),
      total: mkRegion(g.rows),
    };
  });

  items.sort((a, b) => {
    if (a.model !== b.model) return a.model.localeCompare(b.model, 'zh-CN');
    return a.type.localeCompare(b.type, 'zh-CN');
  });

  return { items };
}

/**
 * 第 9 排：近 30 日运行趋势。
 *
 * 说明：mail_30/31 只保留最新一天快照（按 wjmc 整体替换），没有历史日粒度。
 * 因此趋势取「历史导入快照」：每个 import_date 视为一个数据点，按日聚合。
 * 若历史快照不足 30 天，用已有快照铺满并补 0（前端会显示为稀疏趋势）。
 */
async function buildRow9(now) {
  const days = [];
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push(ymd(d));
  }
  const idx = new Map(days.map((d, i) => [d, i]));

  const reached = new Array(days.length).fill(0);
  const runningChains = new Array(days.length).fill(0);
  const openedStrategies = new Array(days.length).fill(0);
  const runningStrategies = new Array(days.length).fill(0);
  const reachRate = new Array(days.length).fill(0);
  const couponRate = new Array(days.length).fill(0);

  if (await tableExists('jdywh_mail_30')) {
    // 每个 import_date 取一份快照聚合
    const snaps = await db.query(
      `SELECT DATE(import_date) AS d,
              SUM(CAST(${M.openedStrategies} AS DECIMAL(18,2))) AS opened,
              SUM(CAST(${M.runningStrategies} AS DECIMAL(18,2))) AS running,
              SUM(CAST(${M.sent} AS DECIMAL(18,2))) AS sent,
              SUM(CAST(${M.arrived} AS DECIMAL(18,2))) AS arrived,
              SUM(CAST(${M.couponIssuedPeople} AS DECIMAL(18,2))) AS cIssued,
              SUM(CAST(${M.couponUsedPeople} AS DECIMAL(18,2))) AS cUsed,
              COUNT(DISTINCT CASE WHEN CAST(${M.runningStrategies} AS DECIMAL(18,2)) > 0 THEN ${M.chainId} END) AS runChains
       FROM jdywh_mail_30
       GROUP BY DATE(import_date)
       ORDER BY d ASC`,
    );
    snaps.forEach((row) => {
      const key = ymd(row.d);
      const i = idx.get(key);
      if (i === undefined) return;
      reached[i] = round(n(row.sent), 2);
      runningChains[i] = n(row.runChains);
      openedStrategies[i] = round(n(row.opened), 2);
      runningStrategies[i] = round(n(row.running), 2);
      reachRate[i] = round(div(row.arrived, row.sent), 4);
      couponRate[i] = round(div(row.cUsed, row.cIssued), 4);
    });
  }

  return {
    days: days.map((d) => md(d)),
    reached,
    runningChains,
    openedStrategies,
    runningStrategies,
    reachRate,
    couponRate,
  };
}

/* ══════════════════════════════════════════════════════════════════
 * 十四、第 10 排：明细表列配置
 * ══════════════════════════════════════════════════════════════════ */

const DETAIL_COLUMNS = [
  { key: 'seq', title: '序号', width: 64, default: true, align: 'center' },
  { key: 'region', title: '区域', width: 80, default: true, align: 'center' },
  { key: 'chainId', title: '连锁ID', width: 100, default: true },
  { key: 'chainName', title: '连锁名称', width: 240, default: true },
  { key: 'chainType', title: '连锁类型', width: 100, default: true, align: 'center' },
  { key: 'signType', title: '签约类型', width: 120, default: true, align: 'center' },
  { key: 'stores', title: '门店数', width: 90, default: true, align: 'right', format: 'num' },
  { key: 'sales', title: '销售', width: 90, default: true },
  { key: 'service', title: '客服', width: 90, default: true },
  { key: 'solution', title: '解决方案', width: 100, default: true },
  { key: 'trainer', title: '培训人', width: 90, default: true },
  { key: 'node', title: '当前节点', width: 110, default: true, align: 'center' },
  { key: 'submitLabel', title: '提交时间', width: 110, default: true, align: 'center' },
  { key: 'submitDays', title: '提交时长（天）', width: 120, default: true, align: 'right', format: 'num' },
  { key: 'openedStrategies', title: '开通策略数', width: 110, default: true, align: 'right', format: 'num' },
  { key: 'runningStrategies', title: '运行策略数', width: 110, default: true, align: 'right', format: 'num' },
  { key: 'reachedPeople', title: '触达人数', width: 100, default: true, align: 'right', format: 'num' },
  { key: 'reachRate', title: '到店率', width: 100, default: true, align: 'right', format: 'percent' },
  { key: 'couponRate', title: '优惠券核销率', width: 120, default: true, align: 'right', format: 'percent' },
  // 可选列
  { key: 'province', title: '省份', width: 110, default: false },
  { key: 'owner', title: '处理人', width: 100, default: false },
  { key: 'ownerRole', title: '负责人岗位', width: 110, default: false },
  { key: 'nodeDays', title: '当前节点时长（天）', width: 140, default: false, align: 'right', format: 'num' },
  { key: 'totalDays', title: '连锁总时长（天）', width: 130, default: false, align: 'right', format: 'num' },
  { key: 'status', title: '状态', width: 80, default: false, align: 'center' },
  { key: 'signDate', title: '签约日期', width: 110, default: false, align: 'center' },
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

  // 运行数据按连锁ID 建索引（mail_30 是最新快照）
  const runMap = new Map();
  (run30.rows || []).forEach((r) => {
    const id = s(r[M.chainId]);
    if (id) runMap.set(id, r);
  });

  // 标准化全部客户
  const allClients = rawClients.map((r) => normalizeClient(r, staff, runMap, now));

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
  const row8 = buildRow8(run31, chainRegion);
  const row9 = await buildRow9(now);

  // 明细表
  const detailRows = clients.map((c, i) => toFullRow(c, i + 1));

  const { options, counts } = buildOptionsAndCounts(clients);

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
    detail: {
      columns: DETAIL_COLUMNS,
      rows: detailRows,
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

module.exports = {
  buildBoard,
  buildDetailPage,
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
