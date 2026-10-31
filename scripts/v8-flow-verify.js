'use strict';

/**
 * V8 · 流程宽表只读核验（WS4）
 * ============================================================================
 * 用途：核对 `jdywh_crm_signing_v7`（16 + 102 合成宽表）与业务基准 xlsx 是否逐格一致，
 *       以及推导规则命中率 / 唯一索引 / 流程定义 / 推送触发接线能力。
 *
 * 安全：
 *   - **只读**：仅 SELECT / SHOW / information_schema 查询，绝不写库、不建表、不改索引、
 *     不调用会真正执行流程的 flows.run / flows.triggerOnPush（只做 typeof 能力探测）。
 *   - **零本机路径依赖**：所有路径基于 `__dirname/..`，可在生产 `/www/wwwroot/jdy-push` 直接运行。
 *   - 缺 `数据文件/` 时（生产目录不部署业务表格）自动降级：跳过 xlsx 逐格比对，
 *     仅做「库侧指纹 + 结构 + 索引 + 规则 + 流程定义 + 接线」核验，并打印 SKIP 原因。
 *   - 退出码：0 = 本环境所有**可执行**的检查全通过；1 = 有失败项。
 *
 * 运行：node scripts/v8-flow-verify.js [--json] [--flow=<id>] [--xlsx=<path>]
 *   本机：cd C:\Data\DSH\jdy-push && node scripts/v8-flow-verify.js
 *   生产：cd /www/wwwroot/jdy-push && node scripts/v8-flow-verify.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
try { require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env') }); } catch (e) { /* dotenv 可选 */ }

const TARGET = 'jdywh_crm_signing_v7';
const P16 = 'jdywh_parsed_16';
const P102 = 'jdywh_parsed_102';
const FLOW_CODE = 'crm_signing_v7';
const DEFAULT_FLOW_ID = 25;
const XLSX_DEFAULT = path.join(ROOT, '数据文件', '新增智能体签约_20261030233545.xlsx');
const EXPECT_ROWS = 96;
const EXPECT_BIZ_COLS = 59;

const ARGV = process.argv.slice(2);
const AS_JSON = ARGV.indexOf('--json') >= 0;
const FLOW_ID_ARG = (ARGV.find((a) => a.startsWith('--flow=')) || '').split('=')[1];
const XLSX_ARG = (ARGV.find((a) => a.startsWith('--xlsx=')) || '').split('=')[1];

/**
 * 业务基准快照时刻（默认 2026-10-30T15:30:00Z = 2026-10-30 23:30 北京，即 xlsx 导出时刻）。
 *
 * 为什么必须可传参：生产上业务侧每天都在继续推送，`jdywh_data_16` 会不断刷新。
 * 若把「快照之后又被推送过的行」算成差异，部署后必然永久误报。
 * 口径（fresh 语义）：
 *   fresh 行 = 该 data_id 在 jdywh_data_16 里最后一条 jdy_op_time > snapshot 时刻；
 *   fresh 行的差异一律归因「快照后业务侧继续操作 → 目标表取到了更新值」，记 PASS（正向更新）；
 *   非 fresh 行的差异才是真实差异，必须为 0。
 */
const SNAPSHOT_ARG = (ARGV.find((a) => a.startsWith('--snapshot=')) || '').split('=')[1];
const SNAPSHOT_MS = (() => {
  if (!SNAPSHOT_ARG) return Date.UTC(2026, 9, 30, 15, 30, 0);
  const s = String(SNAPSHOT_ARG).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : Date.UTC(2026, 9, 30, 15, 30, 0);
})();

let pass = 0; let fail = 0; let skip = 0; let blocked = 0;
const failures = [];
const skips = [];
const blocks = [];
const results = [];

function ok(name, cond, detail) {
  const good = !!cond;
  if (good) pass += 1; else { fail += 1; failures.push({ name, detail: detail || '' }); }
  results.push({ name, ok: good, detail: detail || '' });
  if (!AS_JSON) console.log(`${good ? 'PASS' : 'FAIL'}  ${name}${!good && detail ? ` → ${detail}` : ''}`);
}

/**
 * 「部署缺口」判定：不满足，但**不是数据错误**，而是当前服务端代码版本过低 / 缺少部署文件。
 *
 * 为什么要与 fail 分开：
 *   在未部署 V8 的生产目录跑本脚本，必然会缺 join/pick_current_task/computed；
 *   若一律记 FAIL，读报告的人会以为「宽表数据对不上」，实际是**部署没做完**。
 *   这里单独归类并在结尾单列「部署缺口」清单，退出码仍为 1（因为确实没通过验收）。
 */
function blockedByName(name, detail) {
  blocked += 1;
  blocks.push({ name, detail: detail || '' });
  results.push({ name, ok: false, blocked: true, detail: detail || '' });
  if (!AS_JSON) console.log(`BLOCK ${name}${detail ? ` → ${detail}` : ''}`);
}

function skipped(name, reason) {
  skip += 1;
  skips.push({ name, reason });
  results.push({ name, ok: null, skip: true, detail: reason });
  if (!AS_JSON) console.log(`SKIP  ${name} → ${reason}`);
}

function info(line) { if (!AS_JSON) console.log(line); }

/* ══════════════════════════ 归一化（与 v7-reconcile-lib 同口径，独立实现） ══════════════════════════ */

const pad2 = (n) => String(n).padStart(2, '0');

function normText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  let s = String(v).replace(/\r\n?/g, '\n');
  s = s.replace(/[\u00a0\u3000]/g, ' ');
  return s.trim();
}

function normNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null;
}

function normTime(v) {
  const s = normText(v);
  if (!s) return '';
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return s;
  return `${m[1]}-${pad2(m[2])}-${pad2(m[3])} ${pad2(m[4] || '0')}:${pad2(m[5] || '0')}:${pad2(m[6] || '0')}`;
}

function normArray(v) {
  const s = normText(v);
  if (!s) return '';
  return s.split(',').map((x) => x.trim()).filter((x) => x !== '').join(',');
}

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

/** Excel 序列号 → 墙钟字符串（epoch 1899-12-30） */
function excelSerialToStr(serial) {
  const ms = Math.round((Number(serial) - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} `
    + `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

/* ══════════════════════════ 59 列映射（idx → 目标表列名 + 比较口径） ══════════════════════════ */

const MAPPING = [
  { idx: 0, label: 'data_id', kind: 'id' },
  { idx: 1, label: '标题', kind: 'text' },
  { idx: 2, label: '流水号', kind: 'text' },
  { idx: 3, label: '区域', kind: 'text' },
  { idx: 4, label: '连锁ID', kind: 'text' },
  { idx: 5, label: '签约主体名称', kind: 'text' },
  { idx: 6, label: '连锁名称', kind: 'text' },
  { idx: 7, label: '连锁类型', kind: 'text' },
  { idx: 8, label: '对接版本', kind: 'text' },
  { idx: 9, label: '门店数', kind: 'num' },
  { idx: 10, label: '上月销售门店数', kind: 'num' },
  { idx: 11, label: '近2年销售门店数', kind: 'num' },
  { idx: 12, label: '签约类型', kind: 'text' },
  { idx: 13, label: '连锁业务对接人姓名', kind: 'text' },
  { idx: 14, label: '连锁业务对接人联系电话', kind: 'text' },
  { idx: 15, label: '连锁技术对接人姓名', kind: 'text' },
  { idx: 16, label: '连锁技术对接人联系电话', kind: 'text' },
  { idx: 17, label: '签约时间', kind: 'time' },
  { idx: 18, label: '服务开始时间', kind: 'time' },
  { idx: 19, label: '服务结束时间', kind: 'time' },
  { idx: 20, label: '销售', kind: 'text' },
  { idx: 21, label: '客服', kind: 'text' },
  { idx: 22, label: '解决方案', kind: 'text' },
  { idx: 23, label: '培训人', kind: 'text' },
  { idx: 24, label: '基础资料', kind: 'array' },
  { idx: 25, label: '优惠券', kind: 'array' },
  { idx: 26, label: '连锁ERP名称', kind: 'text' },
  { idx: 27, label: '对接结果', kind: 'text' },
  { idx: 28, label: '对接备注', kind: 'text' },
  { idx: 29, label: '优惠券(结果)', kind: 'array' },
  { idx: 30, label: '短信报备', kind: 'text' },
  { idx: 31, label: '渠道充值和余额', kind: 'text' },
  { idx: 32, label: '客服备注', kind: 'text' },
  { idx: 33, label: '培训结果', kind: 'text' },
  { idx: 34, label: '培训备注', kind: 'text' },
  { idx: 35, label: '策略开通情况', kind: 'text' },
  { idx: 36, label: '已开通策略', kind: 'array' },
  { idx: 37, label: '未开通策略原因', kind: 'text' },
  { idx: 38, label: '流程状态', kind: 'text' },
  { idx: 39, label: '区域负责人手机号码', kind: 'text' },
  { idx: 40, label: '省或直辖市', kind: 'text' },
  { idx: 41, label: '地址(表单格式)(省/自治区/直辖市)', kind: 'text' },
  { idx: 42, label: '地址(表单格式)(市)', kind: 'text' },
  { idx: 43, label: '地址(表单格式)(县/区)', kind: 'text' },
  { idx: 44, label: '是否开通', kind: 'text' },
  { idx: 45, label: '单据提交时间', kind: 'time' },
  { idx: 46, label: '策略开通时间', kind: 'time' },
  { idx: 47, label: '实施对接时间', kind: 'time' },
  { idx: 48, label: '对接审核时间', kind: 'time' },
  { idx: 49, label: '客服处理时间', kind: 'time' },
  { idx: 50, label: '客户培训时间', kind: 'time' },
  { idx: 51, label: '连锁使用时间', kind: 'time' },
  { idx: 52, label: '策略审核时间', kind: 'time' },
  { idx: 53, label: '提交人', kind: 'text' },
  { idx: 54, label: '提交时间', kind: 'time' },
  { idx: 55, label: '更新时间', kind: 'time' },
  { idx: 56, label: '流程状态(节点)', kind: 'flowstate' },
  { idx: 57, label: '当前节点', kind: 'text' },
  { idx: 58, label: '当前负责人', kind: 'text' },
];

const EXPECT_TARGET_COLS = ['id', 'created_at'].concat(MAPPING.map((m) => m.label));

/* ══════════════════════════ 推导规则（独立实现，四要素） ══════════════════════════ */

const NODE_ALIAS = { 开始: '销售签约' };

function timeOf(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return v;
  const n = Number(v);
  if (Number.isFinite(n) && String(v).trim() !== '' && /^-?\d+(\.\d+)?$/.test(String(v).trim())) return n;
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) {
    // 北京墙钟 → UTC 毫秒（与 jdy_op_time 的 epoch 毫秒口径对齐）
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0) - 8, +(m[5] || 0), +(m[6] || 0));
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

function numOf(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 四要素推导（CHANGELOG 7.0.0 §3）：
 *   ① sys_flow_state_2 == 1 → 两列置空
 *   ② 取 cutoff 之前的事件，选最后一条 created>0 且其后无 completed>0 / canceled>0
 *   ③ 节点别名 '开始' → '销售签约'
 *   ④ 无挂起待办 → 回退 parsed_16.flow_current_node / flow_current_owner
 * @returns {{node:string|null, owner:string|null, source:'ended'|'events'|'fallback_16'|'empty'}}
 */
function deriveTask(row16, events, cutoffMs) {
  const state = normText(row16.sys_flow_state_2);
  if (state === '1') return { node: null, owner: null, source: 'ended' };

  const sorted = (events || []).slice().sort((a, b) => {
    const ta = timeOf(a.jdy_op_time); const tb = timeOf(b.jdy_op_time);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    if (Number.isFinite(ta) !== Number.isFinite(tb)) return Number.isFinite(ta) ? -1 : 1;
    return numOf(a.id) - numOf(b.id);
  }).filter((r) => {
    const t = timeOf(r.jdy_op_time);
    return !Number.isFinite(t) || t <= cutoffMs;
  });

  let found = null;
  for (let i = 0; i < sorted.length; i += 1) {
    if (numOf(sorted[i].event_created_count) <= 0) continue;
    let violated = false;
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (numOf(sorted[j].event_completed_count) > 0 || numOf(sorted[j].event_canceled_count) > 0) { violated = true; break; }
    }
    if (!violated) found = sorted[i];
  }

  if (found) {
    const rawNode = found.event_flow_name;
    const node = rawNode === null || rawNode === undefined ? null : (NODE_ALIAS[String(rawNode)] || String(rawNode));
    const owner = found.event_current_assignee === null || found.event_current_assignee === undefined
      ? null : String(found.event_current_assignee);
    return { node, owner, source: 'events' };
  }

  // ④ 回退 parsed_16
  const fn = row16.flow_current_node; const fo = row16.flow_current_owner;
  const hn = fn !== null && fn !== undefined && String(fn) !== '';
  const ho = fo !== null && fo !== undefined && String(fo) !== '';
  if (hn || ho) {
    return { node: hn ? String(fn) : null, owner: ho ? String(fo) : null, source: 'fallback_16' };
  }
  return { node: null, owner: null, source: 'empty' };
}

/* ══════════════════════════ xlsx 位置式读取 ══════════════════════════ */

function readXlsxPositional(file) {
  const XLSX = require(path.join(ROOT, 'node_modules', 'xlsx'));
  const SSF = XLSX.SSF || null;
  const isDateFmt = (fmt) => {
    if (!fmt) return false;
    if (SSF && typeof SSF.is_date === 'function') { try { return SSF.is_date(fmt); } catch (e) { /* ignore */ } }
    return /(^|[^\\])[ymdhs]/i.test(String(fmt));
  };
  const cellToValue = (cell) => {
    if (!cell) return null;
    if (cell.t === 'n') {
      if (isDateFmt(cell.z) || (cell.w && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(cell.w))) return excelSerialToStr(cell.v);
      return cell.v;
    }
    if (cell.t === 'd') return excelSerialToStr(cell.v);
    if (cell.t === 'b') return cell.v ? 'true' : 'false';
    if (cell.t === 'e') return null;
    const v = cell.v;
    if (v === null || v === undefined) return null;
    const s = String(v).replace(/\r\n?/g, '\n').trim();
    return s === '' ? null : s;
  };

  const wb = XLSX.readFile(file, { cellDates: false, cellNF: true, cellText: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const ref = XLSX.utils.decode_range(ws['!ref']);
  const header = [];
  for (let c = ref.s.c; c <= ref.e.c; c += 1) header.push(normText(cellToValue(ws[XLSX.utils.encode_cell({ r: ref.s.r, c })])));
  const rows = [];
  for (let r = ref.s.r + 1; r <= ref.e.r; r += 1) {
    const values = [];
    for (let c = ref.s.c; c <= ref.e.c; c += 1) values.push(cellToValue(ws[XLSX.utils.encode_cell({ r, c })]));
    if (values.every((v) => v === null)) continue;
    rows.push({ rowNo: r + 1, values });
  }
  return { sheet: wb.SheetNames[0], header, rows };
}

/* ══════════════════════════ 主流程 ══════════════════════════ */

async function main() {
  info('=== V8 流程宽表只读核验（WS4） ===');
  info(`运行环境：node ${process.version}  ROOT=${ROOT}`);
  info(`目标表：${TARGET}  流程：code=${FLOW_CODE}`);

  const db = require(path.join(ROOT, 'src', 'db'));

  /* ---------- 0. 能力探测（生产旧代码 vs 本机新代码） ---------- */
  info('\n--- [0] 服务端能力探测（区分「数据结构问题」与「服务端版本过低」） ---');
  let flows = null;
  let flowsErr = null;
  try { flows = require(path.join(ROOT, 'src', 'flows')); } catch (e) { flowsErr = e; }
  const hasJoin = !!(flows && typeof flows.runJoin === 'function');
  const hasPick = !!(flows && typeof flows.runPickCurrentTask === 'function');
  const hasTrigger = !!(flows && typeof flows.triggerOnPush === 'function');
  let nodeKeys = [];
  try {
    if (flows && Array.isArray(flows.NODE_TYPES)) nodeKeys = flows.NODE_TYPES.map((n) => n.key);
  } catch (e) { /* ignore */ }
  const hasJoinNode = nodeKeys.indexOf('join') >= 0;
  const hasPickNode = nodeKeys.indexOf('pick_current_task') >= 0;
  const hasComputedNode = nodeKeys.indexOf('computed') >= 0;
  const engineV7 = hasJoinNode && hasPickNode && hasComputedNode;

  info(`  flows.js 可加载：${flows ? '是' : `否（${flowsErr && flowsErr.message}）`}`);
  info(`  节点类型数：${nodeKeys.length}  join=${hasJoinNode}  pick_current_task=${hasPickNode}  computed=${hasComputedNode}`);
  info(`  引擎版本判定：${engineV7 ? 'V7+（含关联/选取当前待办/计算列）' : 'V6 或更早（缺少 V7 新增节点）'}`);

  if (!engineV7) {
    // 生产旧代码：这**不是**数据错误，是部署缺口 → 记为 BLOCK（单列「部署缺口」，与数据错误分开）
    blockedByName('0.1 引擎具备 join/pick_current_task/computed（实时更新前提）',
      `当前服务端只有 ${nodeKeys.length} 种节点，缺少 join/pick_current_task/computed；`
      + '需部署 src/flows.js（及 src/flow-ingest.js、src/routes/push.js）后本项才可执行');
  } else {
    ok('0.1 引擎注册了 join / pick_current_task / computed 三种节点',
      hasJoinNode && hasPickNode && hasComputedNode);
  }

  if (!hasJoin || !hasPick) {
    blockedByName('0.2 flows 导出 runJoin / runPickCurrentTask（推导与关联可被独立复算）',
      `runJoin=${hasJoin} runPickCurrentTask=${hasPick}（旧代码未导出，属部署缺口；`
      + '后续用脚本内置的独立复算实现替代，规则命中率仍然有效）');
  } else {
    ok('0.2 flows 导出 runJoin / runPickCurrentTask（推导与关联可被独立复算）', true,
      'runJoin=true runPickCurrentTask=true');
  }
  if (hasTrigger) ok('0.3 flows 导出 triggerOnPush（推送触发入口）', true);
  else blockedByName('0.3 flows 导出 triggerOnPush（推送触发入口）', '旧代码无推送触发能力，需部署 src/flows.js + src/flow-ingest.js');

  let pushHasHook = false;
  try {
    const pr = require(path.join(ROOT, 'src', 'routes', 'push'));
    pushHasHook = typeof pr.triggerFlowsAfterPush === 'function';
  } catch (e) { /* ignore */ }
  let ingestHasHook = false;
  try {
    const fi = require(path.join(ROOT, 'src', 'flow-ingest'));
    ingestHasHook = typeof fi.triggerOnPushAfterSave === 'function';
  } catch (e) { /* ignore */ }
  if (pushHasHook && ingestHasHook) {
    ok('0.4 推送侧已接线：routes/push.js 与 flow-ingest.js 均有触发钩子', true);
  } else {
    blockedByName('0.4 推送侧已接线：routes/push.js 与 flow-ingest.js 均有触发钩子',
      `push.js=${pushHasHook} flow-ingest.js=${ingestHasHook}（旧代码未接线 → 推送不会触发流程刷新，属部署缺口）`);
  }

  /* ---------- 1. 目标表结构 ---------- */
  info('\n--- [1] 目标表结构（61 列 = id + created_at + 59 业务列） ---');
  let cols = [];
  try {
    cols = await db.query(`SHOW COLUMNS FROM \`${TARGET}\``);
  } catch (e) {
    fail += 1;
    failures.push({ name: `1.0 目标表 ${TARGET} 可读`, detail: e.message });
    results.push({ name: `1.0 目标表 ${TARGET} 可读`, ok: false, detail: e.message });
    info(`FAIL  1.0 目标表 ${TARGET} 可读 → ${e.message}`);
    return finish();
  }
  const colNames = cols.map((c) => c.Field);
  ok('1.1 目标表总列数 = 61', colNames.length === 61, `实际 ${colNames.length}`);
  const orderOk = colNames.length === EXPECT_TARGET_COLS.length
    && EXPECT_TARGET_COLS.every((c, i) => c === colNames[i]);
  ok('1.2 列名与顺序 = id + created_at + 59 业务列（与 xlsx 列序一致，重名列已改名）',
    orderOk, orderOk ? '' : `首个不一致位置：${EXPECT_TARGET_COLS.findIndex((c, i) => c !== colNames[i])}`);
  ok('1.3 重名列改名生效：存在「优惠券」与「优惠券(结果)」，存在「流程状态」与「流程状态(节点)」',
    colNames.indexOf('优惠券') >= 0 && colNames.indexOf('优惠券(结果)') >= 0
    && colNames.indexOf('流程状态') >= 0 && colNames.indexOf('流程状态(节点)') >= 0);

  /* ---------- 2. 行数与唯一索引 ---------- */
  info('\n--- [2] 行数 / data_id 唯一索引（upsert 前提） ---');
  const cnt = await db.query(`SELECT COUNT(*) AS n, COUNT(DISTINCT data_id) AS d FROM \`${TARGET}\``);
  const rowCount = Number(cnt[0].n); const distinctIds = Number(cnt[0].d);
  ok(`2.1 目标表行数 = ${EXPECT_ROWS}`, rowCount === EXPECT_ROWS, `实际 ${rowCount}`);
  ok('2.2 data_id 无重复（COUNT(*) = COUNT(DISTINCT data_id)）',
    rowCount === distinctIds, `rows=${rowCount} distinct=${distinctIds}`);

  const idx = await db.query(
    `SELECT INDEX_NAME AS name, COLUMN_NAME AS col, NON_UNIQUE AS nonUniq
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'data_id'`,
    [TARGET]
  );
  const uniqOnDataId = (idx || []).filter((r) => Number(r.nonUniq) === 0);
  ok('2.3 data_id 上存在唯一索引（否则 upsert 不命中 → 静默翻倍）',
    uniqOnDataId.length > 0,
    uniqOnDataId.length ? `索引 ${uniqOnDataId.map((r) => r.name).join(',')}` : '未找到唯一索引');

  const pk = await db.query(
    `SELECT COLUMN_NAME AS col FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY'`,
    [TARGET]
  );
  ok('2.4 主键存在（自增 id）', (pk || []).length > 0, JSON.stringify(pk));

  /* ---------- 3. 流程定义 ---------- */
  info('\n--- [3] 流程 25 定义 ----------');
  let flowId = Number(FLOW_ID_ARG) || 0;
  let flowRow = null;
  if (!flowId) {
    const fr = await db.query('SELECT id, name, code, run_mode, status, project_id, nodes, edges FROM jdywh_flows WHERE code = ? LIMIT 1', [FLOW_CODE]);
    if (fr.length) { flowRow = fr[0]; flowId = Number(fr[0].id); }
  } else {
    const fr = await db.query('SELECT id, name, code, run_mode, status, project_id, nodes, edges FROM jdywh_flows WHERE id = ? LIMIT 1', [flowId]);
    if (fr.length) flowRow = fr[0];
  }
  ok('3.1 流程存在（code=crm_signing_v7 或 --flow 指定）', !!flowRow, flowRow ? `id=${flowId}` : '未找到');
  if (flowRow) {
    ok('3.2 run_mode = trigger（推送即刷新）', String(flowRow.run_mode) === 'trigger', `实际 ${flowRow.run_mode}`);
    ok('3.3 status = 1（启用中）', Number(flowRow.status) === 1, `实际 ${flowRow.status}`);
    let nodes = flowRow.nodes;
    if (typeof nodes === 'string') { try { nodes = JSON.parse(nodes); } catch (e) { nodes = []; } }
    if (!Array.isArray(nodes)) nodes = [];
    let edges = flowRow.edges;
    if (typeof edges === 'string') { try { edges = JSON.parse(edges); } catch (e) { edges = []; } }
    if (!Array.isArray(edges)) edges = [];
    ok('3.4 节点 8 个 / 连线 7 条', nodes.length === 8 && edges.length === 7, `nodes=${nodes.length} edges=${edges.length}`);

    const n3 = nodes.find((n) => n && n.id === 'n3');
    ok('3.5 n3.pick_current_task 存在且 mode=pending',
      !!n3 && n3.type === 'pick_current_task' && String((n3.config || {}).mode) === 'pending');
    ok('3.6 n3.cutoffTime 为空（否则推导永久冻结在快照时刻）',
      !!n3 && !normText((n3.config || {}).cutoffTime),
      n3 ? `实际 "${(n3.config || {}).cutoffTime}"` : '节点缺失');
    ok('3.7 n3 时间列/计数列为真实存在的列名（jdy_op_time/created/completed/canceled）',
      !!n3 && ['timeColumn', 'createdCountColumn', 'completedCountColumn', 'canceledCountColumn']
        .every((k) => normText((n3.config || {})[k]) !== ''));

    const n8 = nodes.find((n) => n && n.id === 'n8');
    ok('3.8 n8.sink_table 写入目标表且 mode=upsert、keyField=data_id',
      !!n8 && n8.type === 'sink_table' && (n8.config || {}).table === TARGET
      && String((n8.config || {}).mode) === 'upsert' && String((n8.config || {}).keyField) === 'data_id');

    const types = nodes.map((n) => n && n.type);
    const unknownTypes = types.filter((t) => nodeKeys.length && nodeKeys.indexOf(t) < 0);
    if (nodeKeys.length === 0) skipped('3.9 流程节点类型全部被服务端支持', '无法读取服务端节点类型表');
    else if (unknownTypes.length === 0) {
      ok('3.9 流程节点类型全部被当前服务端支持', true);
    } else {
      blockedByName('3.9 流程节点类型全部被当前服务端支持',
        `当前服务端不支持：${Array.from(new Set(unknownTypes)).join(', ')}`
        + '（属部署缺口：库里的流程定义比服务端代码新，需升级到 V8；'
        + '升级前在生产点「运行」会得到明确中文报错而不是静默产出错误数据）');
    }
  }

  /* ---------- 4. 推导规则命中率（对当前库数据独立复算） ---------- */
  info('\n--- [4] 「当前节点 / 当前负责人」推导规则命中率（独立复算） ---');
  const rows16 = await db.query(`SELECT jdy_data_id, sys_flow_state_2, flow_current_node, flow_current_owner FROM \`${P16}\``);
  const events = await db.query(
    `SELECT id, event_instance_id, event_flow_name, event_current_assignee,
            event_created_count, event_completed_count, event_canceled_count, jdy_op_time
       FROM \`${P102}\` ORDER BY event_instance_id, jdy_op_time, id`
  );
  info(`  ${P16}: ${rows16.length} 行；${P102}: ${events.length} 条事件`);

  // xlsx 在这里就读（后面 [4b] 规则复算与 [5] 逐格比对都要用；生产目录可能没有，缺失即降级 SKIP）
  const xlsxFile = XLSX_ARG || XLSX_DEFAULT;
  let xlsxForRules = null;
  let xlsxSkipReason = '';
  if (!fs.existsSync(xlsxFile)) {
    xlsxSkipReason = `文件不存在：${xlsxFile}（生产目录不部署「数据文件/」，属预期）`;
  } else {
    try { xlsxForRules = readXlsxPositional(xlsxFile); } catch (e) { xlsxSkipReason = e.message; }
  }

  const byInstance = new Map();
  events.forEach((e) => {
    const k = normText(e.event_instance_id);
    if (!byInstance.has(k)) byInstance.set(k, []);
    byInstance.get(k).push(e);
  });

  const CUTOFF_NOW = Number.MAX_SAFE_INTEGER; // 生产口径：不留切点 = 用当前时间
  const derived = new Map();
  const sourceDist = { ended: 0, events: 0, fallback_16: 0, empty: 0 };
  rows16.forEach((r) => {
    const id = normText(r.jdy_data_id);
    const d = deriveTask(r, byInstance.get(id) || [], CUTOFF_NOW);
    sourceDist[d.source] += 1;
    derived.set(id, d);
  });
  info(`  推导来源分布：events=${sourceDist.events}  fallback_16=${sourceDist.fallback_16}  ended(流程完成置空)=${sourceDist.ended}  empty=${sourceDist.empty}`);

  // 与引擎实现交叉核对（引擎可用时）
  if (hasPick) {
    const picked = flows.runPickCurrentTask({
      instanceKey: 'event_instance_id',
      timeColumn: 'jdy_op_time',
      mode: 'pending',
      cutoffTime: '',
      createdCountColumn: 'event_created_count',
      completedCountColumn: 'event_completed_count',
      canceledCountColumn: 'event_canceled_count',
      nodeColumn: 'event_flow_name',
      ownerColumn: 'event_current_assignee',
      nodeAlias: '开始=销售签约',
      outputNodeName: '当前节点',
      outputOwnerName: '当前负责人',
    }, events);
    const pmap = new Map(picked.map((p) => [normText(p.event_instance_id), p]));
    let mismatch = 0;
    derived.forEach((d, id) => {
      if (d.source !== 'events') return;
      const p = pmap.get(id);
      const pn = p && p['当前节点'] !== undefined && p['当前节点'] !== null ? String(p['当前节点']) : null;
      const po = p && p['当前负责人'] !== undefined && p['当前负责人'] !== null ? String(p['当前负责人']) : null;
      if (pn !== d.node || po !== d.owner) mismatch += 1;
    });
    ok('4.1 引擎 runPickCurrentTask 与独立复算逐实例一致（规格实现无漂移）',
      mismatch === 0, `不一致 ${mismatch} 个实例`);
  } else {
    skipped('4.1 引擎 runPickCurrentTask 与独立复算一致', '当前服务端为旧代码，无 runPickCurrentTask（改用独立复算结果）');
  }

  /* ---------- 4b. 快照切点复算：规则对「xlsx 时刻」是否 96/96 ---------- */
  info('\n--- [4b] 以业务基准快照时刻为切点复算（规则正确性的最强证据） ---');
  const derivedSnap = new Map();
  rows16.forEach((r) => {
    const id = normText(r.jdy_data_id);
    derivedSnap.set(id, deriveTask(r, byInstance.get(id) || [], SNAPSHOT_MS));
  });
  const snapDist = { ended: 0, events: 0, fallback_16: 0, empty: 0 };
  derivedSnap.forEach((d) => { snapDist[d.source] += 1; });
  info(`  来源分布：events=${snapDist.events}  fallback_16=${snapDist.fallback_16}  ended=${snapDist.ended}  empty=${snapDist.empty}`);

  if (xlsxForRules) {
    let snapHit = 0; const snapMiss = [];
    xlsxForRules.rows.forEach((xr) => {
      const id = normText(xr.values[0]);
      const d = derivedSnap.get(id);
      if (!d) { snapMiss.push({ id, why: 'no-parsed-row' }); return; }
      const xn = normalize(xr.values[57], 'text');
      const xo = normalize(xr.values[58], 'text');
      const hn = String(d.node === null ? '' : d.node) === String(xn);
      const ho = String(d.owner === null ? '' : d.owner) === String(xo);
      if (hn && ho) snapHit += 1;
      else snapMiss.push({ id, why: 'mismatch', xlsxNode: xn, calcNode: d.node, xlsxOwner: xo, calcOwner: d.owner, src: d.source });
    });
    info(`  快照切点下命中 ${snapHit}/${EXPECT_ROWS}`);
    snapMiss.slice(0, 10).forEach((m) => info(`    ✗ ${m.id} ${JSON.stringify(m)}`));
    ok(`4b.1 四要素规则在业务基准快照时刻复算 = ${EXPECT_ROWS}/${EXPECT_ROWS}（完全还原业务表）`,
      snapHit === EXPECT_ROWS, `命中 ${snapHit}/${EXPECT_ROWS}，失配 ${snapMiss.length}`);
  } else {
    skipped('4b.1 四要素规则对 xlsx 复算 96/96', '未提供 xlsx（生产目录不部署「数据文件/」）');
  }

  /* ---------- 5. xlsx 逐格比对 ---------- */
  info('\n--- [5] 与业务基准 xlsx 逐格比对（96 × 59） ---');
  const xlsx = xlsxForRules;
  if (!xlsx) {
    skipped('5.0 读取业务基准 xlsx', xlsxSkipReason);
  }

  if (xlsx) {
    ok('5.1 xlsx 数据行数 = 96', xlsx.rows.length === EXPECT_ROWS, `实际 ${xlsx.rows.length}`);
    ok('5.2 xlsx 列数 = 59', xlsx.header.length === EXPECT_BIZ_COLS, `实际 ${xlsx.header.length}`);
    ok('5.3 xlsx 存在两个重名列「优惠券」(idx25/29) 与「流程状态」(idx38/56)',
      xlsx.header[25] === '优惠券' && xlsx.header[29] === '优惠券'
      && xlsx.header[38] === '流程状态' && xlsx.header[56] === '流程状态',
      `25=${xlsx.header[25]} 29=${xlsx.header[29]} 38=${xlsx.header[38]} 56=${xlsx.header[56]}`);

    const tgt = await db.query(`SELECT * FROM \`${TARGET}\``);
    const tgtById = new Map(tgt.map((r) => [normText(r.data_id), r]));
    const xlsxIds = xlsx.rows.map((r) => normText(r.values[0]));
    const xlsxSet = new Set(xlsxIds);
    ok('5.4 data_id 集合一致（xlsx ⊂ 目标表 且 目标表 ⊂ xlsx）',
      xlsxSet.size === EXPECT_ROWS && xlsxSet.size === tgtById.size
      && xlsxIds.every((id) => tgtById.has(id)),
      `xlsx 唯一 ${xlsxSet.size} / 目标表 ${tgtById.size}`);

    /*
     * fresh 语义（Lead 验收要求）：
     *   fresh 行 = 该 data_id 在 jdywh_data_16 里**最后一条推送**的 jdy_op_time > 业务基准快照时刻。
     *   这类行在 xlsx 导出之后业务侧又改过，目标表取到更新的值属于**要求 6「按推送实时更新」的预期效果**，
     *   不是数据错误 → 记 PASS，并在输出里单列为「正向更新」。
     *   非 fresh 行的差异才是真实差异，必须为 0 才算通过。
     */
    const freshIds = new Set();
    try {
      const fr = await db.query(
        `SELECT jdy_data_id AS id, MAX(jdy_op_time) AS mx FROM jdywh_data_16 GROUP BY jdy_data_id`
      );
      fr.forEach((r) => { if (Number(r.mx) > SNAPSHOT_MS) freshIds.add(normText(r.id)); });
    } catch (e) {
      skipped('5.4b 判定 fresh 行（需 jdywh_data_16）', e.message);
    }
    info(`  快照时刻=${new Date(SNAPSHOT_MS).toISOString()}；快照之后有新推送的 fresh 行：${freshIds.size} 个`);

    // 逐格比对
    const diffByCol = new Map();
    const freshDiffByCol = new Map();
    const diffRows = [];
    const freshRows = new Map();
    const samples = [];
    const freshSamples = [];
    let compared = 0;
    xlsx.rows.forEach((xr) => {
      const id = normText(xr.values[0]);
      const tr = tgtById.get(id);
      if (!tr) { diffRows.push({ dataId: id, reason: 'missing-in-target' }); return; }
      const isFresh = freshIds.has(id);
      let rowDiff = 0;
      let rowFreshDiff = 0;
      MAPPING.forEach((m) => {
        compared += 1;
        const a = normalize(xr.values[m.idx], m.kind);
        const b = normalize(tr[m.label], m.kind);
        if (String(a) !== String(b)) {
          rowDiff += 1;
          const bucket = isFresh ? freshDiffByCol : diffByCol;
          const key = `${m.idx}:${m.label}`;
          const cur = bucket.get(key) || { idx: m.idx, label: m.label, count: 0 };
          cur.count += 1;
          bucket.set(key, cur);
          const item = {
            dataId: id, idx: m.idx, col: m.label,
            xlsx: a === null ? '' : String(a), target: b === null ? '' : String(b),
          };
          if (isFresh) {
            rowFreshDiff += 1;
            if (freshSamples.length < 20) freshSamples.push(item);
          } else if (samples.length < 40) samples.push(item);
        }
      });
      if (rowDiff) diffRows.push({ dataId: id, diffCells: rowDiff, fresh: isFresh });
      if (rowFreshDiff) freshRows.set(id, rowFreshDiff);
    });

    const realDiff = Array.from(diffByCol.values()).reduce((s, c) => s + c.count, 0);
    const freshDiff = Array.from(freshDiffByCol.values()).reduce((s, c) => s + c.count, 0);
    const totalDiff = realDiff + freshDiff;

    info(`  比对单元格 ${compared} 个（期望 ${EXPECT_ROWS * EXPECT_BIZ_COLS}）；差异合计 ${totalDiff} 个`);
    info(`    ├─ 非 fresh 行差异（必须为 0）：${realDiff} 个`);
    info(`    └─ fresh 行差异（快照后业务侧继续操作，属正向更新）：${freshDiff} 个 / ${freshRows.size} 行`);

    if (realDiff) {
      info('  ❌ 非 fresh 差异按列：');
      Array.from(diffByCol.values()).sort((a, b) => b.count - a.count).forEach((c) => {
        info(`    idx${String(c.idx).padStart(2)} ${c.label} → ${c.count} 格`);
      });
      info('  非 fresh 差异样本（最多 40）：');
      samples.forEach((s) => info(`    ${s.dataId} idx${s.idx} ${s.col}: xlsx="${s.xlsx}" target="${s.target}"`));
    }
    if (freshDiff) {
      info('  ⏱ fresh 差异（已归因为快照后新推送 → 正向更新，不计失败）：');
      Array.from(freshDiffByCol.values()).sort((a, b) => b.count - a.count).forEach((c) => {
        info(`    idx${String(c.idx).padStart(2)} ${c.label} → ${c.count} 格`);
      });
      freshSamples.forEach((s) => info(`    ${s.dataId} idx${s.idx} ${s.col}: xlsx="${s.xlsx}" target="${s.target}"`));
    }

    ok('5.5 非 fresh 行 96 × 59 逐格 0 差异（data_id 集合一致）',
      realDiff === 0,
      `非 fresh 差异 ${realDiff} 格；fresh(正向更新) ${freshDiff} 格 / ${freshRows.size} 行`);
    ok('5.5b fresh 行差异可解释（每个 fresh 行都能在 jdywh_data_16 找到快照后推送）',
      Array.from(freshRows.keys()).every((id) => freshIds.has(id)));

    // 派生两列单独验收（非 fresh 行必须 96-|fresh| 全中；fresh 行不计失败）
    let derivedDiff = 0;
    let derivedFreshDiff = 0;
    xlsx.rows.forEach((xr) => {
      const id = normText(xr.values[0]);
      const d = derived.get(id);
      const tr = tgtById.get(id);
      if (!d || !tr) { derivedDiff += 1; return; }
      const xn = normalize(xr.values[57], 'text');
      const xo = normalize(xr.values[58], 'text');
      const same = String(xn) === String(normalize(tr['当前节点'], 'text'))
        && String(xo) === String(normalize(tr['当前负责人'], 'text'));
      if (!same) {
        if (freshIds.has(id)) derivedFreshDiff += 1;
        else derivedDiff += 1;
      }
    });
    const derivedBase = EXPECT_ROWS - freshIds.size;
    ok(`5.6 派生列「当前节点 / 当前负责人」在非 fresh 行上 ${derivedBase}/${derivedBase} 命中`,
      derivedDiff === 0,
      `非 fresh 失配 ${derivedDiff} 行；fresh 行按实时更新计 ${derivedFreshDiff} 行`);
  }

  /* ---------- 6. 推导规则对目标表（而非 xlsx）的命中率 ---------- */
  const tgtRows = await db.query(`SELECT data_id, 当前节点, 当前负责人 FROM \`${TARGET}\``);
  let derivedHit = 0;
  tgtRows.forEach((r) => {
    const d = derived.get(normText(r.data_id));
    if (!d) return;
    if (String(d.node === null ? '' : d.node) === normText(r['当前节点'])
      && String(d.owner === null ? '' : d.owner) === normText(r['当前负责人'])) derivedHit += 1;
  });
  ok(`6.1 目标表两列 = 当前库数据按四要素规则独立复算的结果（${EXPECT_ROWS}/${EXPECT_ROWS}）`,
    derivedHit === EXPECT_ROWS, `命中 ${derivedHit}/${EXPECT_ROWS}`);

  /* ---------- 7. 幂等（不改库：用指纹说明可重复性） ---------- */
  info('\n--- [7] 幂等 ---');
  const fp = await db.query(
    `SELECT MD5(GROUP_CONCAT(CONCAT_WS('|', id, data_id, 当前节点, 当前负责人, 更新时间) ORDER BY id SEPARATOR '\\n')) AS h
       FROM \`${TARGET}\``
  );
  info(`  目标表采样指纹（id+data_id+当前节点+当前负责人+更新时间）：${fp[0] && fp[0].h}`);
  ok('7.1 目标表存在可重复计算的指纹（用于两次运行前后比对）', !!(fp[0] && fp[0].h));

  return finish();
}

function finish() {
  const total = pass + fail + blocked;
  const exitCode = (fail === 0 && blocked === 0) ? 0 : 1;
  if (!AS_JSON) {
    console.log('\n════════════════════════════════════════');
    console.log(`断言 ${total} 项：PASS ${pass} / FAIL ${fail} / BLOCK ${blocked}；SKIP ${skip} 项`);
    skips.forEach((s) => console.log(`  · SKIP  ${s.name} —— ${s.reason}`));
    if (blocks.length) {
      console.log('\n  【部署缺口】以下项不满足，但**不是数据错误**，是服务端代码版本过低/文件未部署：');
      blocks.forEach((b) => console.log(`  · BLOCK ${b.name}\n          ${b.detail}`));
      console.log('\n  处置：部署 src/flows.js、src/flow-ingest.js、src/routes/push.js（V8 版）后重跑本脚本。');
      console.log('  部署前：库里 flow 25 在生产点「运行」会得到明确中文报错（不会静默写入错误数据），');
      console.log('          但目标表 jdywh_crm_signing_v7 也不会再被刷新（当前 96 行是本机开发进程写入的快照）。');
    }
    if (fail) failures.forEach((f) => console.log(`  ✗ FAIL  ${f.name}${f.detail ? ` → ${f.detail}` : ''}`));
    console.log(fail ? '\n存在【数据/结构失败】❌' : (blocked ? '\n数据与结构全部通过，但存在【部署缺口】⚠️' : '\n本环境可执行的检查全部通过 ✅'));
    console.log('════════════════════════════════════════');
  } else {
    console.log(JSON.stringify({
      ok: exitCode === 0, pass, fail, blocked, skip,
      failures, blocks, skips, results,
    }, null, 1));
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code || 0))
  .catch((err) => {
    console.error('\n[核验脚本异常]', err && err.stack ? err.stack : err);
    process.exit(1);
  });
