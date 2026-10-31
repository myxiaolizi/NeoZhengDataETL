'use strict';
/**
 * V7 数据对账 / 回填 —— 公共库
 * ============================================================================
 * 职责：把「业务表格 xlsx」与「jdywh_parsed_16 / jdywh_parsed_102」读成统一形状，
 *       提供字段映射、归一化比较、当前节点/负责人推导。**本文件不含任何写库语句。**
 *
 * 契约：_work/V7R-CONTRACT.md §3.2 字段映射 / **§3.3 旧推导 / §3.5 C1~C4 修正（以 §3.5 为准）** / §七 已知坑
 *
 * 已落地并符合 §3.5 的部分：
 *   C1  xlsx 读**位置式** `_work/v7data/xlsx_pos.json`（{header:[...], rows:[[...]]}），
 *       不再用按表头名建 object 的旧 xlsx.json（那版把重名列后者覆盖前者，丢了第 1 个「优惠券」）。
 *       默认优先读 xlsx_pos.json，缺失时回退到直接解析原始 .xlsx（同样按列序号）。
 *   C2  col25「优惠券」 → widget_1791510696561_p ；col29「优惠券」→ w_1792547295323
 *       col38「流程状态①」→ widget_1791533061604（节点名）
 *       col56「流程状态②」→ **sys_flow_state_2**（0=进行中 / 1=流转完成）
 *   C3  当前节点/当前负责人 用 §3.5 C3 新规则（见 deriveCurrentTaskLo3）：
 *       ① sys_flow_state_2==1 → 两列置空
 *       ② 取 cutoff（业务表快照时刻）之前的事件，选「最后一条 created>0 且其后无 completed/canceled」
 *       ③ '开始' → '销售签约'
 *       ④ 无挂起待办 → 回退 parsed_16.flow_current_node / flow_current_owner
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const XLSX_PATH = path.join(ROOT, '数据文件', '新增智能体签约_20261030233545.xlsx');
const DATA_DIR = path.join(ROOT, '_work', 'v7data');
/** §3.5 C1：位置式导出（首选数据源） */
const XLSX_POS_PATH = path.join(DATA_DIR, 'xlsx_pos.json');
const P16_TABLE = 'jdywh_parsed_16';
const P102_TABLE = 'jdywh_parsed_102';

/** §3.5 C3：业务表快照时刻 = 导出于 2026-10-30 23:30 北京 = 15:30 UTC */
const FLOW_CUTOFF_MS = Date.UTC(2026, 9, 30, 15, 30, 0);
/** §3.5 C3 步骤③：业务表用词映射 */
const FLOW_NODE_ALIAS = { 开始: '销售签约' };

/* ============================ 归一化 ============================ */

const pad2 = (n) => String(n).padStart(2, '0');

/** Excel 序列号 -> 'YYYY-MM-DD HH:mm:ss'（epoch 1899-12-30，与 openpyxl 同算法；
 *  已与 Lead 的 openpyxl 导出逐格交叉验证，55 个非重名列 0 差异） */
function excelSerialToStr(serial) {
  const ms = Math.round((Number(serial) - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return (
    d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
    ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds())
  );
}

/** 任意值 -> 可比较字符串（null/undefined/'' 统一为空串） */
function normText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  let s = String(v);
  s = s.replace(/\r\n?/g, '\n');
  s = s.replace(/[\u00a0\u3000]/g, ' ');
  return s.trim();
}

/** 数字归一化：'' / null -> null；'120.0' -> 120 */
function normNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null;
}

/** 时间归一化到 'YYYY-MM-DD HH:mm:ss'。
 *  坑：xlsx 是 datetime，DB 是 str（_p 列已 +8），raw 列是 UTC ISO；统一按字面墙钟取，
 *      不做时区换算（契约 §七：_p 已转 +8，直接用 _p）。 */
function normTime(v) {
  const s = normText(v);
  if (!s) return '';
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return s;
  return (
    m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3]) +
    ' ' + pad2(m[4] || '0') + ':' + pad2(m[5] || '0') + ':' + pad2(m[6] || '0')
  );
}

/** 数组列（基础资料/已开通策略/优惠券）：两边都是逗号分隔字符串，逐段 trim 后比较 */
function normArray(v) {
  const s = normText(v);
  if (!s) return '';
  return s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '')
    .join(',');
}

/** 流程实例状态：业务表格是中文（进行中/流转完成），parsed_16.sys_flow_state_2 是 0/1 */
function normFlowState(v) {
  const s = normText(v);
  if (s === '') return '';
  if (s === '0' || s === '进行中') return '进行中';
  if (s === '1' || s === '流转完成') return '流转完成';
  return s;
}

function normalize(v, kind) {
  switch (kind) {
    case 'num': return normNum(v);
    case 'time': return normTime(v);
    case 'array': return normArray(v);
    case 'flowstate': return normFlowState(v);
    default: return normText(v);
  }
}

/** 单元格比较。返回 { equal, kind }，kind 用于差异分类：
 *  value / missing-in-db / extra-in-db / truncated */
function compareCell(xlsxRaw, dbRaw, fieldKind) {
  const a = normalize(xlsxRaw, fieldKind);
  const b = normalize(dbRaw, fieldKind);
  if (a === b) return { equal: true, kind: null };
  // DB 侧 `_p` 在推送时被截断到 500 字符（src/routes/push.js:242），单独归类
  if (fieldKind !== 'num' && typeof a === 'string' && typeof b === 'string' && a.length > b.length) {
    if (b !== '' && a.slice(0, b.length) === b) return { equal: false, kind: 'truncated' };
  }
  if (a === '') return { equal: false, kind: 'extra-in-db' };
  if (b === '') return { equal: false, kind: 'missing-in-db' };
  return { equal: false, kind: 'value' };
}

/* ============================ 读 xlsx ============================ */

let SSF = null;
function isDateFormat(fmt) {
  if (!fmt) return false;
  if (SSF && typeof SSF.is_date === 'function') {
    try { return SSF.is_date(fmt); } catch (_) { /* ignore */ }
  }
  // 兜底：常见日期/时间格式串（不含千分位数字格式）
  return /(^|[^\\])[ymdhs]/i.test(String(fmt));
}

function cellToValue(cell) {
  if (!cell) return null;
  if (cell.t === 'n') {
    // 日期/时间格式的数字 -> 墙钟字符串；纯数字（门店数等）保持 number
    if (isDateFormat(cell.z) || (cell.w && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(cell.w))) {
      return excelSerialToStr(cell.v);
    }
    return cell.v;
  }
  if (cell.t === 'd') return excelSerialToStr(cell.v);
  if (cell.t === 'b') return cell.v ? 'true' : 'false';
  if (cell.t === 'e') return null;
  const v = cell.v;
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\r\n?/g, '\n').trim();
  return s === '' ? null : s;
}

/** 直接解析原始 .xlsx（按列序号，保留重名列） */
function readXlsxFile(filePath) {
  const XLSX = require('xlsx');
  SSF = XLSX.SSF || null;
  const p = filePath || XLSX_PATH;
  if (!fs.existsSync(p)) throw new Error('xlsx 不存在: ' + p);
  const wb = XLSX.readFile(p, { cellDates: false, cellNF: true, cellText: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const ref = XLSX.utils.decode_range(ws['!ref']);
  const header = [];
  for (let c = ref.s.c; c <= ref.e.c; c++) {
    header.push(normText(cellToValue(ws[XLSX.utils.encode_cell({ r: ref.s.r, c })])));
  }
  const rows = [];
  for (let r = ref.s.r + 1; r <= ref.e.r; r++) {
    const values = [];
    for (let c = ref.s.c; c <= ref.e.c; c++) values.push(cellToValue(ws[XLSX.utils.encode_cell({ r, c })]));
    if (values.every((v) => v === null)) continue;
    rows.push({ rowNo: r + 1, values, dataId: normText(values[0]) });
  }
  return { source: 'xlsx-file', path: p, sheet: wb.SheetNames[0], header, rows };
}

/** 读位置式导出 xlsx_pos.json（§3.5 C1 首选） → 与 readXlsxFile 同形状 */
function readXlsxPos(filePath) {
  const p = filePath || XLSX_POS_PATH;
  if (!fs.existsSync(p)) throw new Error('xlsx_pos.json 不存在: ' + p);
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(raw.header) || !Array.isArray(raw.rows)) {
    throw new Error('xlsx_pos.json 必须是 {header:[...], rows:[[...]]} 位置式格式（不能是按表头名建 object）');
  }
  const header = raw.header.map((h) => normText(h));
  const rows = raw.rows.map((values, i) => ({
    rowNo: i + 2,
    values: (values || []).map((v) => (v === '' ? null : v)),
    dataId: normText((values || [])[0]),
  }));
  return { source: 'xlsx_pos.json', path: p, sheet: null, header, rows };
}

/**
 * 读业务表格。默认 **优先 xlsx_pos.json（位置式，§3.5 C1）**，不存在时回退直接解析 .xlsx。
 * 两者都按列序号返回，重名列不会被合并。
 * @param opts { file?: string, prefer?: 'pos'|'file' }
 */
function readXlsx(opts) {
  const o = opts || {};
  if (o.file) {
    return /\.json$/i.test(o.file) ? readXlsxPos(o.file) : readXlsxFile(o.file);
  }
  if (o.prefer === 'file') return readXlsxFile();
  if (fs.existsSync(XLSX_POS_PATH)) return readXlsxPos();
  return readXlsxFile();
}

/* ============================ 字段映射 ============================ */
/**
 * 59 列逐一定义。idx = xlsx 列序号（0 起）。
 *   db      : parsed_16 中存放**显示值**的列名（有 `_p` 用 `_p`，见契约 §3.2 / §七）
 *   kind    : text | num | time | array | id
 *   source  : p16（直接来自表单推送）| derived（由 parsed_102 推导）| missing（DB 无对应列）
 */
const MAPPING = [
  { idx: 0, label: 'data_id', db: 'jdy_data_id', kind: 'id', source: 'p16' },
  { idx: 1, label: '标题', db: 'w_1791449342206_title_p', kind: 'text', source: 'p16' },
  { idx: 2, label: '流水号', db: 'w_1792564761950', kind: 'text', source: 'p16' },
  { idx: 3, label: '区域', db: 'widget_1791449342211', kind: 'text', source: 'p16' },
  { idx: 4, label: '连锁ID', db: 'widget_1791449342205', kind: 'text', source: 'p16' },
  { idx: 5, label: '签约主体名称', db: 'widget_1791449342209', kind: 'text', source: 'p16' },
  { idx: 6, label: '连锁名称', db: 'widget_1791449342206', kind: 'text', source: 'p16' },
  { idx: 7, label: '连锁类型', db: 'widget_1792048325267', kind: 'text', source: 'p16' },
  { idx: 8, label: '对接版本', db: 'w_1792577110570', kind: 'text', source: 'p16' },
  { idx: 9, label: '门店数', db: 'widget_1792048325259', kind: 'num', source: 'p16' },
  { idx: 10, label: '上月销售门店数', db: 'w_1793101382911', kind: 'num', source: 'p16' },
  { idx: 11, label: '近2年销售门店数', db: 'w_1793101382912', kind: 'num', source: 'p16' },
  { idx: 12, label: '签约类型', db: 'w_1793343168111', kind: 'text', source: 'p16' },
  { idx: 13, label: '连锁业务对接人姓名', db: 'widget_1791882979503', kind: 'text', source: 'p16' },
  { idx: 14, label: '连锁业务对接人联系电话', db: 'widget_1791882979504_p', kind: 'text', source: 'p16' },
  { idx: 15, label: '连锁技术对接人姓名', db: 'widget_1791882979505', kind: 'text', source: 'p16' },
  { idx: 16, label: '连锁技术对接人联系电话', db: 'widget_1791882979506_p', kind: 'text', source: 'p16' },
  { idx: 17, label: '签约时间', db: 'widget_1791510326270_p', kind: 'time', source: 'p16' },
  { idx: 18, label: '服务开始时间', db: 'widget_1791449342217_p', kind: 'time', source: 'p16' },
  { idx: 19, label: '服务结束时间', db: 'widget_1791449342218_p', kind: 'time', source: 'p16' },
  { idx: 20, label: '销售', db: 'widget_1791449342208_p', kind: 'text', source: 'p16' },
  { idx: 21, label: '客服', db: 'widget_1791509478932_p', kind: 'text', source: 'p16' },
  { idx: 22, label: '解决方案', db: 'w_1792139730147_p', kind: 'text', source: 'p16' },
  { idx: 23, label: '培训人', db: 'widget_1791509478935_p', kind: 'text', source: 'p16' },
  { idx: 24, label: '基础资料', db: 'widget_1791510696565_p', kind: 'array', source: 'p16' },
  { idx: 25, label: '优惠券', db: 'widget_1791510696561_p', kind: 'array', source: 'p16',
    note: 'xlsx 第 1 个「优惠券」列（col25）' },
  { idx: 26, label: '连锁ERP名称', db: 'w_1793089366573', kind: 'text', source: 'p16' },
  { idx: 27, label: '对接结果', db: 'widget_1792029306426', kind: 'text', source: 'p16' },
  { idx: 28, label: '对接备注', db: 'widget_1791596350260', kind: 'text', source: 'p16' },
  { idx: 29, label: '优惠券(结果)', db: 'w_1792547295323', kind: 'array', source: 'p16',
    note: 'xlsx 第 2 个「优惠券」列（col29），目标表列名须改为 优惠券(结果)' },
  { idx: 30, label: '短信报备', db: 'w_1792547295325', kind: 'text', source: 'p16' },
  { idx: 31, label: '渠道充值和余额', db: 'widget_1791509478941_p', kind: 'text', source: 'p16' },
  { idx: 32, label: '客服备注', db: 'w_1792547295328', kind: 'text', source: 'p16' },
  { idx: 33, label: '培训结果', db: 'w_1792552277283', kind: 'text', source: 'p16' },
  { idx: 34, label: '培训备注', db: 'w_1792552277285', kind: 'text', source: 'p16' },
  { idx: 35, label: '策略开通情况', db: 'w_1793089366506', kind: 'text', source: 'p16' },
  { idx: 36, label: '已开通策略', db: 'widget_1791964258708_p', kind: 'array', source: 'p16' },
  { idx: 37, label: '未开通策略原因', db: 'widget_1791964258722', kind: 'text', source: 'p16' },
  { idx: 38, label: '流程状态', db: 'widget_1791533061604', kind: 'text', source: 'p16',
    note: 'xlsx 第 1 个「流程状态」列（col38）= 简道云「流程状态」字段（随流程推进自动变节点名，终态 流程完成/流程结束）；'
      + '实测与「当前节点」一致 92/96，与 parsed_16.widget_1791533061604 一致 53/96 → 差异属「漏推导致的过期值」' },
  { idx: 39, label: '区域负责人手机号码', db: 'widget_1791453695943', kind: 'text', source: 'p16' },
  { idx: 40, label: '省或直辖市', db: 'w_1792139730191', kind: 'text', source: 'p16' },
  { idx: 41, label: '地址(表单格式)(省/自治区/直辖市)', db: 'w_1792131264427_province_p', kind: 'text', source: 'p16' },
  { idx: 42, label: '地址(表单格式)(市)', db: 'w_1792131264427_city_p', kind: 'text', source: 'p16' },
  { idx: 43, label: '地址(表单格式)(县/区)', db: 'w_1792131264427_district_p', kind: 'text', source: 'p16' },
  { idx: 44, label: '是否开通', db: 'widget_1792072044675', kind: 'text', source: 'p16' },
  { idx: 45, label: '单据提交时间', db: 'w_1793094135522_p', kind: 'time', source: 'p16' },
  { idx: 46, label: '策略开通时间', db: 'w_1793094135524_p', kind: 'time', source: 'p16' },
  { idx: 47, label: '实施对接时间', db: 'w_1793094135538_p', kind: 'time', source: 'p16' },
  { idx: 48, label: '对接审核时间', db: 'w_1793094135578_p', kind: 'time', source: 'p16' },
  { idx: 49, label: '客服处理时间', db: 'w_1793094135592_p', kind: 'time', source: 'p16' },
  { idx: 50, label: '客户培训时间', db: 'w_1793094135593_p', kind: 'time', source: 'p16' },
  { idx: 51, label: '连锁使用时间', db: 'w_1793094135594_p', kind: 'time', source: 'p16' },
  { idx: 52, label: '策略审核时间', db: 'w_1793094135608_p', kind: 'time', source: 'p16' },
  { idx: 53, label: '提交人', db: 'sys_creator_2_p', kind: 'text', source: 'p16' },
  { idx: 54, label: '提交时间', db: 'sys_create_time_2_p', kind: 'time', source: 'p16' },
  { idx: 55, label: '更新时间', db: 'sys_update_time_2_p', kind: 'time', source: 'p16' },
  { idx: 56, label: '流程状态(节点)', db: 'sys_flow_state_2', kind: 'flowstate', source: 'p16',
    note: 'xlsx 第 2 个「流程状态」列（col56）= 流程实例状态（进行中/流转完成）↔ parsed_16.sys_flow_state_2（0/1），'
      + '实测 96/96 完全对应。契约 §3.2 把它写成「同第 1 个 widget_1791533061604」是错的' },
  { idx: 57, label: '当前节点', db: 'flow_current_node', kind: 'text', source: 'derived',
    note: '由 parsed_102 推导（§3.3）；无事件行回退 flow_current_node' },
  { idx: 58, label: '当前负责人', db: 'flow_current_owner', kind: 'text', source: 'derived',
    note: '由 parsed_102 推导（§3.3）；无事件行回退 flow_current_owner' },
];

const MAPPING_BY_IDX = new Map(MAPPING.map((m) => [m.idx, m]));

/* ============================ 读 DB ============================ */

function maskTarget() {
  try {
    const cfg = require('../src/config');
    const h = cfg.db.host;
    const masked = /^\d+\.\d+\.\d+\.\d+$/.test(h) ? h.replace(/\.\d+$/, '.***') : h;
    return { host: masked, database: cfg.db.database };
  } catch (e) {
    return { host: '(unknown)', database: '(unknown)' };
  }
}

async function loadFromDb() {
  const db = require('../src/db');
  const rows16 = await db.query(
    `SELECT * FROM ${P16_TABLE} ORDER BY jdy_data_id ASC`
  );
  const rows102 = await db.query(
    `SELECT event_instance_id, event_flow_name, event_current_assignee,
            event_created_count, event_completed_count, event_canceled_count,
            event_finish_action, jdy_op_time, jdy_data_id, id
       FROM ${P102_TABLE}
      ORDER BY event_instance_id ASC, jdy_op_time ASC, id ASC`
  );
  const cols = await db.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [P16_TABLE]
  );
  return { mode: 'db', target: maskTarget(), rows16, rows102, dbColumns: cols };
}

function loadFromJson() {
  const p16 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'parsed16.json'), 'utf8'));
  const p102 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'parsed102.json'), 'utf8'));
  return {
    mode: 'json',
    target: { host: '(offline json)', database: '(offline json)' },
    rows16: p16,
    rows102: p102,
    dbColumns: Object.keys(p16[0] || {}).map((c) => ({ COLUMN_NAME: c, COLUMN_TYPE: '?' })),
  };
}

/* ============ 当前节点 / 当前负责人 推导（§3.5 C3 新规则 + §3.3 旧规则） ============ */

function sortEvents(list) {
  return list.slice().sort((a, b) => {
    const ta = Number(a.jdy_op_time) || 0;
    const tb = Number(b.jdy_op_time) || 0;
    if (ta !== tb) return ta - tb;
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  });
}

function groupByInstance(events, cutoffMs) {
  const groups = new Map();
  for (const e of events) {
    if (cutoffMs !== undefined && cutoffMs !== null && cutoffMs !== Infinity) {
      const t = Number(e.jdy_op_time) || 0;
      if (t >= cutoffMs) continue; // 只取业务表快照时刻之前的事件
    }
    const k = normText(e.event_instance_id);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  // ⚠ 必须把排序结果写回：sortEvents 返回新数组，之前 `sortEvents(list)` 丢弃了它，
  //    导致分组内顺序依赖调用方（SQL 的 ORDER BY / JSON 的行序），离线 json 未排序时推导会错。
  for (const [k, list] of groups) groups.set(k, sortEvents(list));
  return groups;
}

/**
 * **契约 §3.5 C3 新规则**（当前节点/当前负责人的最终口径，实测 96/96 命中业务表）
 *
 * 逐实例（`event_instance_id` == parsed_16.`jdy_data_id`）：
 *   ② 取 cutoff 之前的事件，选「仍在挂起」的待办 = 最后一条 `created_count>0`
 *      且**其后没有任何** `completed_count>0` 或 `canceled_count>0` 的事件
 *   ③ 节点名映射：'开始' -> '销售签约'（业务表用词）
 *   （① sys_flow_state_2==1 → 置空、④ 无挂起待办 → 回退 parsed_16.flow_* 由调用方执行）
 *
 * @returns {{ byInstance: Map, stats: object }}
 *   byInstance: id -> { node, owner, eventCount, opTime, flowNameRaw, suspended }
 *   只包含「有挂起待办」的实例；没有挂起待办的实例不出现在 map 里（调用方回退）。
 */
function deriveCurrentTaskC3(events, opts) {
  const o = opts || {};
  const cutoffMs = o.cutoffMs === undefined ? FLOW_CUTOFF_MS : o.cutoffMs;
  const allGroups = groupByInstance(events, undefined);
  const cutGroups = groupByInstance(events, cutoffMs);

  const out = new Map();
  const stats = {
    rule: 'c3',
    cutoffMs,
    cutoffIso: cutoffMs === Infinity ? null : new Date(cutoffMs).toISOString(),
    totalEvents: events.length,
    totalInstances: allGroups.size,
    instancesAfterCutoff: cutGroups.size,
    droppedByCutoff: allGroups.size - cutGroups.size,
    eventsAfterCutoff: events.filter((e) => (Number(e.jdy_op_time) || 0) >= cutoffMs).length,
    suspended: 0,
    noSuspended: 0,
    noAssignee: 0,
    maxEvents: 0,
    aliasApplied: 0,
  };

  for (const [k, list] of cutGroups) {
    if (list.length > stats.maxEvents) stats.maxEvents = list.length;
    let picked = null;
    for (let i = list.length - 1; i >= 0; i--) {
      if ((Number(list[i].event_created_count) || 0) <= 0) continue;
      let blocked = false;
      for (let j = i + 1; j < list.length; j++) {
        if ((Number(list[j].event_completed_count) || 0) > 0
          || (Number(list[j].event_canceled_count) || 0) > 0) { blocked = true; break; }
      }
      if (!blocked) { picked = list[i]; break; }
    }
    if (!picked) { stats.noSuspended += 1; continue; }
    stats.suspended += 1;

    const rawName = normText(picked.event_flow_name);
    let node = rawName;
    if (Object.prototype.hasOwnProperty.call(FLOW_NODE_ALIAS, rawName)) {
      node = FLOW_NODE_ALIAS[rawName];
      stats.aliasApplied += 1;
    }
    const owner = normText(picked.event_current_assignee);
    if (!owner) stats.noAssignee += 1;
    out.set(k, {
      node,
      owner,
      flowNameRaw: rawName,
      eventCount: list.length,
      opTime: Number(picked.jdy_op_time) || 0,
      suspended: true,
    });
  }
  return { byInstance: out, stats };
}

/**
 * **契约 §3.3 旧规则**（保留仅用于对比/回归；已被 §3.5 C3 取代）
 * 「最后一条 created>0 且 canceled==0」；finishAware 再加「其后出现完成且未再创建 → 结束」。
 * 不应用 cutoff，也不做 '开始'→'销售签约' 映射。
 */
function deriveCurrentTaskLegacy(events, opts) {
  const finishAware = !!(opts && opts.finishAware);
  const groups = groupByInstance(events, undefined);
  const out = new Map();
  const stats = {
    rule: finishAware ? 'legacy+finish' : 'legacy',
    totalEvents: events.length,
    totalInstances: groups.size,
    primary: 0, fallbackLast: 0, noAssignee: 0, maxEvents: 0, finished: 0,
  };
  for (const [k, list] of groups) {
    if (list.length > stats.maxEvents) stats.maxEvents = list.length;
    let picked = null;
    for (const e of list) {
      const created = Number(e.event_created_count) || 0;
      const canceled = Number(e.event_canceled_count) || 0;
      if (created > 0 && canceled === 0) picked = e;
    }
    let mode = 'primary';
    if (!picked) {
      picked = list[list.length - 1];
      mode = 'fallback-last';
      stats.fallbackLast += 1;
    } else {
      stats.primary += 1;
    }
    const pickedAt = Number(picked.jdy_op_time) || 0;
    const pickedId = Number(picked.id) || 0;

    let finished = false;
    if (finishAware) {
      const after = list.filter((e) => {
        const t = Number(e.jdy_op_time) || 0;
        return t > pickedAt || (t === pickedAt && (Number(e.id) || 0) > pickedId);
      });
      const laterCreated = after.some((e) => (Number(e.event_created_count) || 0) > 0);
      const completion = after.some((e) => {
        const c = Number(e.event_created_count) || 0;
        const d = Number(e.event_completed_count) || 0;
        const x = Number(e.event_canceled_count) || 0;
        return c === 0 && d > 0 && x === 0;
      });
      finished = completion && !laterCreated;
      if (finished) stats.finished += 1;
    }

    const node = finished ? '' : normText(picked.event_flow_name);
    const owner = finished ? '' : normText(picked.event_current_assignee);
    if (!owner) stats.noAssignee += 1;
    out.set(k, {
      node,
      owner,
      mode: finished ? 'finished' : mode,
      finished,
      eventCount: list.length,
      opTime: pickedAt,
    });
  }
  return { byInstance: out, stats };
}

/**
 * 统一入口：按 §3.5 C3 规则 + 行级 sys_flow_state_2 得到每行的「当前节点/当前负责人」目标值。
 * 步骤：① state==1 → 置空；②③ C3 推导；④ 无挂起待办 → 回退 parsed_16.flow_*
 * @returns {{ byId: Map<string,{node,owner,source,finished,eventCount}>, stats: object }}
 */
function resolveFlowColumns(rows102, rows16, opts) {
  const o = opts || {};
  const c3 = deriveCurrentTaskC3(rows102, { cutoffMs: o.cutoffMs });
  const p16 = buildIndex(rows16);
  const byId = new Map();
  const stats = {
    rule: 'c3',
    finished: 0, from102: 0, fallback: 0, noEvent: 0,
    aliasApplied: c3.stats.aliasApplied,
    cutoffMs: c3.stats.cutoffMs,
    cutoffIso: c3.stats.cutoffIso,
    totalEvents: c3.stats.totalEvents,
    totalInstances: c3.stats.totalInstances,
    instancesAfterCutoff: c3.stats.instancesAfterCutoff,
    eventsAfterCutoff: c3.stats.eventsAfterCutoff,
    noSuspended: c3.stats.noSuspended,
    maxEvents: c3.stats.maxEvents,
  };
  for (const [did, row] of p16) {
    const state = normText(row.sys_flow_state_2);
    if (state === '1') {
      byId.set(did, { node: '', owner: '', source: 'finished', finished: true, eventCount: null });
      stats.finished += 1;
      continue;
    }
    const d = c3.byInstance.get(did);
    if (d) {
      byId.set(did, { node: d.node, owner: d.owner, source: '102', finished: false, eventCount: d.eventCount });
      stats.from102 += 1;
    } else {
      byId.set(did, {
        node: normText(row.flow_current_node),
        owner: normText(row.flow_current_owner),
        source: 'fallback',
        finished: false,
        eventCount: 0,
      });
      stats.fallback += 1;
      if (!c3.byInstance.has(did)) stats.noEvent += 1;
    }
  }
  return { byId, stats, c3 };
}

/**
 * 旧口径（仅供对比）：返回按「§3.3 旧规则 + 结束态」算出的 flow 值。
 */
function resolveFlowColumnsLegacy(rows102, rows16, opts) {
  const o = opts || {};
  const leg = deriveCurrentTaskLegacy(rows102, { finishAware: o.finishAware !== false });
  const p16 = buildIndex(rows16);
  const byId = new Map();
  for (const [did, row] of p16) {
    const d = leg.byInstance.get(did);
    byId.set(did, d
      ? { node: d.node, owner: d.owner, source: '102', finished: d.finished, eventCount: d.eventCount }
      : { node: normText(row.flow_current_node), owner: normText(row.flow_current_owner), source: 'fallback', finished: false, eventCount: 0 });
  }
  return { byId, stats: leg.stats };
}

/* ============================ 对账核心 ============================ */

function buildIndex(rows16) {
  const m = new Map();
  for (const r of rows16) m.set(normText(r.jdy_data_id), r);
  return m;
}

/**
 * 逐行逐列比对，产出结构化结果。
 * @param flowMode 当前节点/当前负责人 的期望值来源：
 *   'c3'      契约 §3.5 C3 新规则（**默认**，实测 96/96 命中业务表）
 *   'legacy'  契约 §3.3 旧规则 + 结束态（仅用于对比/回归）
 *   'xlsx'    一律以业务表格为准（用于看「业务表格 vs 任意规则」的残余）
 * @param flowGate 额外口径：'none'(默认) | 'xlsx-wins'
 *   'xlsx-wins' 时，若 102 推导值与业务表格不一致则以业务表格为准（对应 R5 的回填「不劣化」语义）
 * @returns {{ columns, rows, summary, derivation, corrections, flowRows }}
 */
function reconcile(opts) {
  const {
    xlsx, rows16, rows102, samples = 3,
    flowMode = 'c3', flowGate = 'none', cutoffMs = FLOW_CUTOFF_MS,
  } = opts;
  const FLOW_MODES = ['c3', 'legacy', 'xlsx'];
  if (!FLOW_MODES.includes(flowMode)) throw new Error('flowMode 非法: ' + flowMode);
  const c3 = resolveFlowColumns(rows102, rows16, { cutoffMs });
  const legacy = resolveFlowColumnsLegacy(rows102, rows16, { finishAware: true });
  const p16 = buildIndex(rows16);

  const xlsxIds = xlsx.rows.map((r) => r.dataId);
  const dbIds = new Set(rows16.map((r) => normText(r.jdy_data_id)));
  const missingInDb = xlsxIds.filter((id) => !dbIds.has(id));
  const xlsxIdSet = new Set(xlsxIds);
  const extraInDb = [...dbIds].filter((id) => !xlsxIdSet.has(id));

  const columns = MAPPING.map((m) => ({
    idx: m.idx,
    label: m.label,
    dbColumn: m.db,
    kind: m.kind,
    source: m.source,
    note: m.note || null,
    xlsxHeader: xlsx.header[m.idx],
    diffCount: 0,
    diffKinds: {},
    samples: [],
    nonNullXlsx: 0,
    nonNullDb: 0,
    /** 仅 flow 列：各口径下的差异数 + 「DB 现值 vs 业务表格」的存量差异 */
    flowModeDiffs: m.source === 'derived' ? {} : null,
    dbStaleCount: m.source === 'derived' ? 0 : null,
  }));
  const colByIdx = new Map(columns.map((c) => [c.idx, c]));

  /** 某行某列在给定 flowMode 下的「目标表应得值」 */
  function effectiveFlow(m, did, dbRow, xv, mode) {
    if (mode === 'xlsx') return xv;
    const src = mode === 'legacy' ? legacy.byId : c3.byId;
    const d = src.get(did);
    const v = d ? (m.idx === 57 ? d.node : d.owner)
      : (m.idx === 57 ? dbRow.flow_current_node : dbRow.flow_current_owner);
    if (mode === 'c3' && flowGate === 'xlsx-wins' && !compareCell(xv, v, m.kind).equal) return xv;
    return v;
  }

  const rowDiffs = []; // { dataId, rowNo, cells: [...] }
  const flowRows = []; // 当前节点/负责人 三档取值明细（供报告/回填参考）

  for (const xr of xlsx.rows) {
    const did = xr.dataId;
    const dbRow = p16.get(did);
    if (!dbRow) {
      rowDiffs.push({ dataId: did, rowNo: xr.rowNo, missing: true, cells: [] });
      continue;
    }
    const evC3 = c3.byId.get(did) || null;
    const evLegacy = legacy.byId.get(did) || null;
    const cells = [];
    for (const m of MAPPING) {
      const col = colByIdx.get(m.idx);
      const xv = xr.values[m.idx];
      if (normalize(xv, m.kind) !== (m.kind === 'num' ? null : '')) col.nonNullXlsx += 1;

      let dbVal;
      let effective;
      if (m.source === 'missing') {
        continue; // DB 无对应列，不参与逐格比对（在报告里单列说明）
      } else if (m.source === 'derived') {
        dbVal = m.idx === 57 ? dbRow.flow_current_node : dbRow.flow_current_owner;
        effective = effectiveFlow(m, did, dbRow, xv, flowMode);
        // 三种口径各自的差异数（用于让 Lead 选择口径）
        for (const mode2 of FLOW_MODES) {
          const v = effectiveFlow(m, did, dbRow, xv, mode2);
          if (!compareCell(xv, v, m.kind).equal) col.flowModeDiffs[mode2] = (col.flowModeDiffs[mode2] || 0) + 1;
        }
        // DB 现值 vs 业务表格（存量差异 = 回填要修的量，与口径无关）
        if (!compareCell(xv, dbVal, m.kind).equal) col.dbStaleCount += 1;
        if (m.idx === 57) {
          flowRows.push({
            dataId: did,
            rowNo: xr.rowNo,
            xlsxNode: normText(xv),
            xlsxOwner: normText(xr.values[58]),
            p16Node: normText(dbRow.flow_current_node),
            p16Owner: normText(dbRow.flow_current_owner),
            c3Node: evC3 ? evC3.node : null,
            c3Owner: evC3 ? evC3.owner : null,
            c3Source: evC3 ? evC3.source : null,
            c3EventCount: evC3 ? evC3.eventCount : null,
            legacyNode: evLegacy ? evLegacy.node : null,
            legacyOwner: evLegacy ? evLegacy.owner : null,
            sysFlowState: normText(dbRow.sys_flow_state_2),
            xlsxUpdateTime: normText(xr.values[55]),
          });
        }
      } else {
        dbVal = dbRow[m.db];
        effective = dbVal;
      }
      if (normalize(effective, m.kind) !== (m.kind === 'num' ? null : '')) col.nonNullDb += 1;

      const cmp = compareCell(xv, effective, m.kind);
      if (!cmp.equal) {
        col.diffCount += 1;
        col.diffKinds[cmp.kind] = (col.diffKinds[cmp.kind] || 0) + 1;
        cells.push({
          idx: m.idx,
          label: m.label,
          dbColumn: m.db,
          xlsx: xv === undefined ? null : xv,
          db: effective === undefined ? null : effective,
          rawDb: dbVal === undefined ? null : dbVal,
          diffKind: cmp.kind,
          viaEvents: m.source === 'derived' ? !!(evC3 && evC3.source === '102') : undefined,
        });
      }
    }
    if (cells.length) rowDiffs.push({ dataId: did, rowNo: xr.rowNo, cells });
  }

  // 每列差异样例（取前 N 条）
  for (const rd of rowDiffs) {
    for (const c of rd.cells) {
      const col = colByIdx.get(c.idx);
      if (col.samples.length < samples) {
        col.samples.push({
          dataId: rd.dataId, rowNo: rd.rowNo, xlsx: c.xlsx, db: c.db, diffKind: c.diffKind,
          viaEvents: c.viaEvents === undefined ? null : c.viaEvents,
        });
      }
    }
  }

  const compared = columns.filter((c) => c.source !== 'missing');
  const totalCells = compared.length * xlsx.rows.length;
  const diffCells = compared.reduce((s, c) => s + c.diffCount, 0);
  const identicalColumns = compared.filter((c) => c.diffCount === 0);
  const summary = {
    xlsxRows: xlsx.rows.length,
    xlsxCols: xlsx.header.length,
    dbRows: rows16.length,
    matchedRows: xlsx.rows.length - missingInDb.length,
    missingInDb,
    extraInDb,
    mappedColumns: MAPPING.length,
    comparedColumns: compared.length,
    skippedColumns: columns.filter((c) => c.source === 'missing').map((c) => ({ idx: c.idx, label: c.label, reason: c.note })),
    identicalColumns: identicalColumns.length,
    diffColumns: compared.length - identicalColumns.length,
    totalCells,
    diffCells,
    consistencyRate: totalCells ? Number(((1 - diffCells / totalCells) * 100).toFixed(4)) : 0,
    rowsWithDiff: rowDiffs.filter((r) => !r.missing).length,
    rowsFullyIdentical: xlsx.rows.length - missingInDb.length - rowDiffs.filter((r) => !r.missing).length,
    flowMode,
    flowGate,
    flowModeResidual: {
      c3: columns.filter((c) => c.flowModeDiffs).reduce((s, c) => s + (c.flowModeDiffs.c3 || 0), 0),
      legacy: columns.filter((c) => c.flowModeDiffs).reduce((s, c) => s + (c.flowModeDiffs.legacy || 0), 0),
      xlsx: columns.filter((c) => c.flowModeDiffs).reduce((s, c) => s + (c.flowModeDiffs.xlsx || 0), 0),
    },
    /** flow 两列的「DB 现值 vs 业务表格」存量差异（与口径无关，= 回填要修的格数） */
    flowDbStale: columns.filter((c) => c.source === 'derived').reduce((s, c) => s + (c.dbStaleCount || 0), 0),
  };

  // 逐行 flow 三口径明细 → 分类汇总
  const c3Mismatch = flowRows.filter((r) => r.c3Node !== r.xlsxNode || r.c3Owner !== r.xlsxOwner);
  const legacyMismatch = flowRows.filter((r) => r.legacyNode !== r.xlsxNode || r.legacyOwner !== r.xlsxOwner);
  const dbMismatch = flowRows.filter((r) => r.p16Node !== r.xlsxNode || r.p16Owner !== r.xlsxOwner);
  const bySource = { finished: [], '102': [], fallback: [] };
  for (const r of flowRows) (bySource[r.c3Source] || bySource.fallback).push(r);

  const derivation = {
    ...c3.stats,
    /** 三口径命中统计（节点+负责人 双 0 差异即为命中） */
    hits: {
      c3: { rows: xlsx.rows.length - c3Mismatch.length, total: xlsx.rows.length, missRows: c3Mismatch.length },
      legacy: { rows: xlsx.rows.length - legacyMismatch.length, total: xlsx.rows.length, missRows: legacyMismatch.length },
      dbCurrent: { rows: xlsx.rows.length - dbMismatch.length, total: xlsx.rows.length, missRows: dbMismatch.length },
    },
    sourceRows: { finished: bySource.finished.length, from102: bySource['102'].length, fallback: bySource.fallback.length },
    cutoffMs: c3.stats.cutoffMs,
    cutoffIso: c3.stats.cutoffIso,
    legacyStats: legacy.stats,
    c3Mismatches: c3Mismatch.map((r) => ({
      dataId: r.dataId, xlsxNode: r.xlsxNode, c3Node: r.c3Node, xlsxOwner: r.xlsxOwner, c3Owner: r.c3Owner,
      c3Source: r.c3Source, eventCount: r.c3EventCount, sysFlowState: r.sysFlowState,
    })),
    legacyMismatches: legacyMismatch.map((r) => ({
      dataId: r.dataId, xlsxNode: r.xlsxNode, legacyNode: r.legacyNode,
      xlsxOwner: r.xlsxOwner, legacyOwner: r.legacyOwner, p16Node: r.p16Node, p16Owner: r.p16Owner,
    })),
    dbStale: dbMismatch.map((r) => ({
      dataId: r.dataId, xlsxNode: r.xlsxNode, p16Node: r.p16Node,
      xlsxOwner: r.xlsxOwner, p16Owner: r.p16Owner, c3Source: r.c3Source,
    })),
    noEventRows: c3.stats.totalInstances === undefined ? null : xlsx.rows.length - c3.stats.instancesAfterCutoff,
  };

  const corrections = [
    {
      id: 'C1',
      finding: '旧 `_work/v7data/xlsx.json`（按表头名建 object）把两组重名列的后者覆盖了前者，第 1 个「优惠券」列丢失（61 个非空值全丢）',
      impact: '只读旧 xlsx.json 无法对账「优惠券」第 1 列',
      resolved: true,
      action: '已按契约 §3.5 C1 切到**位置式** `_work/v7data/xlsx_pos.json`（{header:[...], rows:[[...]]}），'
        + '按列序号取值；若该文件缺失则回退直接解析原始 .xlsx（同样按列序号）',
    },
    {
      id: 'C2',
      finding: '契约 §3.2 对两组重名列的映射与实测不符：'
        + '(a) col38「流程状态①」是简道云「流程状态」字段（随流程推进变成节点名，终态 流程完成/流程结束），'
        + '映射到 widget_1791533061604 正确，但 43/96 差异属「漏推导致的过期值」，与 更新时间 同源；'
        + '(b) col56「流程状态②」是流程实例状态（进行中/流转完成），正确对应列是 parsed_16.sys_flow_state_2（0/1），'
        + '实测 96/96 完全对应。',
      impact: '契约原文「流程状态(第2个) → widget_1791533061604（同第 1 个）」会写错数据；判为「无对应列」则 59 列永远少一列',
      resolved: true,
      action: '契约 §3.5 C2 已确认并修正；本库 col56 → sys_flow_state_2（0/1 ↔ 进行中/流转完成 双向归一化），col38 → widget_1791533061604',
    },
    {
      id: 'C3',
      finding: '契约 §3.3 旧规则（最后一条 created>0 且 canceled==0）丢了「创建/取消的是谁」的语义，'
        + '69 个有事件实例上失手 5 行；且不处理「流程已结束」与「业务表快照时刻之后的事件」。',
      impact: '按旧规则回填 flow_* 会写错终态行与「创建+取消」行',
      resolved: true,
      action: '已按契约 §3.5 C3 实现（本库 deriveCurrentTaskC3 / resolveFlowColumns）：'
        + '① sys_flow_state_2==1 → 置空；② 取 cutoff 前事件，选「最后一条 created>0 且其后无 completed/canceled」；'
        + '③ 开始 → 销售签约；④ 无挂起待办 → 回退 parsed_16.flow_*。实测 96/96 命中业务表（旧规则 miss 5 行）',
    },
  ];

  return { columns, rowDiffs, summary, derivation, corrections, flowRows, c3, legacy };
}

/* ============================ 摘要 / 幂等 ============================ */

function hashOf(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj), 'utf8').digest('hex');
}

/** 幂等指纹：只包含实质比对结果，不含时间戳/路径等每次跑都会变的东西 */
function fingerprint(result) {
  return hashOf({
    rule: 'v7-reconcile/2.0-lib',
    summary: result.summary,
    columns: result.columns.map((c) => ({
      idx: c.idx, label: c.label, db: c.dbColumn, kind: c.kind, source: c.source,
      diffCount: c.diffCount, diffKinds: c.diffKinds,
      flowModeDiffs: c.flowModeDiffs, dbStaleCount: c.dbStaleCount,
    })),
    rows: result.rowDiffs.map((r) => ({
      dataId: r.dataId,
      cells: r.cells.map((c) => [c.idx, c.diffKind]),
    })),
    derivation: {
      hits: result.derivation.hits,
      sourceRows: result.derivation.sourceRows,
      cutoffIso: result.derivation.cutoffIso,
      c3Mismatches: (result.derivation.c3Mismatches || []).map((m) => m.dataId),
      legacyMismatches: (result.derivation.legacyMismatches || []).map((m) => m.dataId),
    },
  });
}

function ensureDir(dir) {
  const d = dir || DATA_DIR;
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

/**
 * 交叉验证：`xlsx_pos.json`（位置式，契约 §3.5 C1）是否与**原始 .xlsx** 逐格一致。
 * 这是「能不能信 xlsx_pos.json」的唯一硬证据，**含两组重名列**（col25/29、col38/56）。
 * @returns {{ ok, source, comparedCells, mismatches:[...], byColumn:[...] }}
 */
function verifyXlsxPositional(opts) {
  const o = opts || {};
  const pos = readXlsxPos(o.posFile);
  const raw = readXlsxFile(o.file);
  const out = {
    source: 'xlsx_pos.json ← 原始 .xlsx',
    posFile: pos.path,
    rawFile: raw.path,
    headerSame: JSON.stringify(pos.header) === JSON.stringify(raw.header),
    rowCountSame: pos.rows.length === raw.rows.length,
    colCountSame: (pos.rows[0] || []).length === (raw.rows[0] || []).length,
    comparedCells: 0,
    mismatches: [],
    byColumn: [],
    duplicateColumns: [],
  };
  // 记录重名列位置（这些列最容易被「按表头名建 object」丢掉）
  const seen = new Map();
  pos.header.forEach((h, i) => {
    if (!seen.has(h)) seen.set(h, []);
    seen.get(h).push(i);
  });
  for (const [h, idxs] of seen) {
    if (idxs.length > 1) out.duplicateColumns.push({ header: h, indexes: idxs });
  }

  const n = Math.min(pos.rows.length, raw.rows.length);
  for (let i = 0; i < n; i++) {
    const a = pos.rows[i].values;
    const b = raw.rows[i].values;
    const cols = Math.max(a.length, b.length);
    for (let c = 0; c < cols; c++) {
      out.comparedCells += 1;
      const va = a[c]; const vb = b[c];
      const na = va === null || va === undefined ? '' : normText(va);
      const nb = vb === null || vb === undefined ? '' : normText(vb);
      if (na !== nb) {
        const col = out.byColumn.find((x) => x.idx === c);
        if (col) col.mismatches += 1;
        else out.byColumn.push({ idx: c, header: pos.header[c], mismatches: 1 });
        if (out.mismatches.length < o.maxSamples || 0) {
          out.mismatches.push({ row: i + 2, idx: c, header: pos.header[c], pos: va, file: vb });
        }
      }
    }
  }
  out.mismatchCount = out.byColumn.reduce((s, x) => s + x.mismatches, 0);
  out.ok = out.mismatchCount === 0 && out.headerSame && out.rowCountSame && out.colCountSame;
  return out;
}

module.exports = {
  ROOT,
  XLSX_PATH,
  XLSX_POS_PATH,
  DATA_DIR,
  P16_TABLE,
  P102_TABLE,
  FLOW_CUTOFF_MS,
  FLOW_NODE_ALIAS,
  MAPPING,
  MAPPING_BY_IDX,
  readXlsx,
  readXlsxFile,
  readXlsxPos,
  excelSerialToStr,
  normText,
  normNum,
  normTime,
  normArray,
  normFlowState,
  normalize,
  compareCell,
  loadFromDb,
  loadFromJson,
  deriveCurrentTaskC3,
  deriveCurrentTaskLegacy,
  resolveFlowColumns,
  resolveFlowColumnsLegacy,
  groupByInstance,
  sortEvents,
  buildIndex,
  reconcile,
  fingerprint,
  hashOf,
  ensureDir,
  verifyXlsxPositional,
  maskTarget,
};
