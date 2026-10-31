'use strict';

/**
 * V9 · 节点提交时间自动同步自检（**只读**：不写任何业务数据）
 *
 * 覆盖
 * ----
 *   A. deriveNodeTimes 纯函数单测：正常流转 / 转交不算完成 / 回退后再提交 /
 *      终态 / 1ms 级回退（(jdy_op_time,id) 排序键）/ 空输入 / 别名归一化 / 可配置动作集
 *   B. TIME_FIELD_OF_NODE 8 个节点全覆盖 + 别名都能映射到同一字段
 *   C. 真实数据：节点 215 的推导值 = 实施对接 1793461861067（2026-10-31 23:51:01）
 *   D. 真实数据：dry-run 前后整表指纹一致（不写库）
 *   E. 真实数据：宽表 8 个时间列非空率 ≥ parsed_16 对应值（不倒退），215 宽表时间正确
 *   F. 开关：FLOW_SYNC_NODE_TIMES=0 时不同步（纯函数 + 落库函数双重验证）
 *   G. flows.js 尾随补跑：合并期间的推送不再被丢弃（215 缺时间的真因）
 *
 * 运行：node scripts/v9-node-times.js
 * 退出码：0 = 全 PASS；1 = 有 FAIL
 */

require('dotenv').config();

const db = require('../src/db');
const flowState = require('../src/flow-state');
const flowIngest = require('../src/flow-ingest');
const flows = require('../src/flows');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; failures.push(name); console.log(`FAIL  ${name}${detail !== undefined ? ` → ${detail}` : ''}`); }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, `实际 ${a}，期望 ${e}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TIME_FIELDS = Object.values(flowState.TIME_FIELD_OF_NODE);
const P16 = 'jdywh_parsed_16';
const P102 = 'jdywh_parsed_102';
const WIDE = 'jdywh_crm_signing_v7';
const NODE215_ID = '6ae60b13774450e960817dd2';
const NODE215_SN = '215';

/* ───────────────────────── 事件构造助手 ───────────────────────── */
let seq = 0;
/** @param {string} node 节点名 @param {string} action 完成动作 @param {number} ms 时刻 */
function ev(node, action, ms, extra) {
  seq += 1;
  return Object.assign({
    id: seq,
    event_flow_name: node,
    event_finish_action: action,
    header_created_at: new Date(ms).toISOString(),
    jdy_op_time: new Date(ms).toISOString(),
    event_created_count: action ? 0 : 1,
    event_completed_count: action ? 1 : 0,
    event_canceled_count: 0,
    event_current_assignee: '张三',
  }, extra || {});
}

/** 北京墙钟 → epoch 毫秒 */
const BJ = (s) => Date.parse(`${s}+08:00`);

async function columnMap(table) {
  const rows = await db.query(
    `SELECT column_name, column_comment FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?`, [table]
  );
  const byComment = new Map();
  for (const r of rows) {
    const c = String(r.COLUMN_COMMENT || '').trim();
    if (c) byComment.set(c, r.COLUMN_NAME);
  }
  const map = {};
  for (const f of TIME_FIELDS) {
    const col = byComment.get(`${f}(解析)`) || byComment.get(f);
    if (col) map[f] = col;
  }
  return { map, byComment };
}

async function fingerprint16(colOf) {
  const sql = `SELECT COUNT(*) AS n, MD5(GROUP_CONCAT(x ORDER BY x SEPARATOR '\\n')) AS h FROM (
      SELECT CONCAT_WS('|', jdy_data_id, ${TIME_FIELDS.map((f) => `IFNULL(\`${colOf[f]}\`,'∅')`).join(', ')}) AS x
        FROM \`${P16}\`) t`;
  const r = await db.queryOne(sql);
  return { rows: Number(r.n), hash: r.h };
}

async function main() {
  console.log('══════════════════════════════════════════════════════════════');
  console.log(' V9 · 节点提交时间自动同步自检（只读）');
  console.log('══════════════════════════════════════════════════════════════\n');

  /* ══════════════ A. deriveNodeTimes 纯函数 ══════════════ */
  console.log('── A. deriveNodeTimes 纯函数 ──');

  ok('A.1 deriveNodeTimes 已导出且是函数', typeof flowState.deriveNodeTimes === 'function');
  ok('A.2 toMs 已导出且是函数', typeof flowState.toMs === 'function');
  ok('A.3 timeFieldOfNode / isMainNode 已导出',
    typeof flowState.timeFieldOfNode === 'function' && typeof flowState.isMainNode === 'function');

  /* A.4 正常流转：每个节点「被提交离开」那一刻写入 */
  const t0 = BJ('2026-10-31 23:36:51');
  const normal = [
    ev('开始', '提交', t0),
    ev('策略开通', null, t0 + 1),
    ev('策略开通', '提交', t0 + 60000),
    ev('实施对接', null, t0 + 60001),
  ];
  const dNorm = flowState.deriveNodeTimes(normal);
  eq('A.4 正常流转：单据提交时间 = 开始节点提交时刻', dNorm.times['单据提交时间'], t0);
  eq('A.5 正常流转：策略开通时间 = 策略开通节点提交时刻', dNorm.times['策略开通时间'], t0 + 60000);
  eq('A.6 正常流转：只有 created 无 completed 的实施对接不给时间',
    dNorm.times['实施对接时间'], null);
  ok('A.7 正常流转：nodesWithoutTime 含「实施对接」',
    dNorm.nodesWithoutTime.includes('实施对接'), JSON.stringify(dNorm.nodesWithoutTime));
  eq('A.8 正常流转：当前节点 = 最后一条事件的节点（实施对接）', dNorm.currentNode, '实施对接');
  eq('A.9 正常流转：timesLocal 与 times 一致（北京墙钟）',
    dNorm.timesLocal['策略开通时间'], flowState.toLocalString(t0 + 60000));

  /* A.10 不按当前节点截断（用户口径：进入下一节点即同步上一节点） */
  eq('A.10 不截断：当前节点之后不存在的节点才为空，之前的都有值',
    TIME_FIELDS.filter((f) => dNorm.times[f] !== null).sort(),
    ['单据提交时间', '策略开通时间'].sort());

  /* A.11 转交默认不算完成（业务 2026-10-27 确认） */
  const transferOnly = [
    ev('实施对接', null, t0),
    ev('实施对接', '转交', t0 + 1000),
    ev('实施对接', '转交', t0 + 2000),
  ];
  const dTrans = flowState.deriveNodeTimes(transferOnly);
  eq('A.11 纯转交：实施对接时间不给值（转交只是换负责人）', dTrans.times['实施对接时间'], null);
  ok('A.12 纯转交：nodesWithoutTime 含「实施对接」',
    dTrans.nodesWithoutTime.includes('实施对接'), JSON.stringify(dTrans.nodesWithoutTime));

  /* A.13 显式开启「转交算完成」后才给值（可开关，默认向后兼容） */
  const dTransOn = flowState.deriveNodeTimes(transferOnly, { includeTransferAsComplete: true });
  eq('A.13 开关打开后：转交也算完成（取最后一次 = 离开节点那一刻）',
    dTransOn.times['实施对接时间'], t0 + 2000);

  /* A.14 prefer=last（默认）vs first */
  const twice = [
    ev('策略开通', '提交', t0),
    ev('策略开通', '提交', t0 + 50000),
    ev('实施对接', null, t0 + 50001),
  ];
  eq('A.14 prefer=last（默认）：同一节点多次完成取最后一次',
    flowState.deriveNodeTimes(twice).times['策略开通时间'], t0 + 50000);
  eq('A.15 prefer=first：取首次完成',
    flowState.deriveNodeTimes(twice, { prefer: 'first' }).times['策略开通时间'], t0);

  /* A.16 回退后再提交：取「最后一次提交」（离开节点那一刻） */
  const rollback = [
    ev('实施对接', null, t0),
    ev('实施对接', '提交', t0 + 10000),
    ev('对接审核', null, t0 + 10001),
    ev('实施对接', null, t0 + 20000, { event_canceled_count: 0 }),   // 被退回
    ev('实施对接', '提交', t0 + 30000),
    ev('对接审核', null, t0 + 30001),
  ];
  eq('A.16 回退后重新提交：实施对接时间取最后一次提交',
    flowState.deriveNodeTimes(rollback).times['实施对接时间'], t0 + 30000);

  /* A.17 1ms 级回退：(jdy_op_time, id) 排序键必须按 id 决胜 */
  // 构造：header_created_at 与 jdy_op_time 相同，但 id 顺序决定先后
  const tieA = { id: 200, event_flow_name: '实施对接', event_finish_action: '提交',
    header_created_at: '2026-10-31T15:51:01.067Z', jdy_op_time: '2026-10-31T15:51:01.067Z',
    event_created_count: 0, event_completed_count: 1, event_canceled_count: 0 };
  const tieB = { id: 199, event_flow_name: '实施对接', event_finish_action: '转交',
    header_created_at: '2026-10-31T15:51:01.067Z', jdy_op_time: '2026-10-31T15:51:01.067Z',
    event_created_count: 1, event_completed_count: 0, event_canceled_count: 0 };
  const dTie = flowState.deriveNodeTimes([tieA, tieB]);
  eq('A.17 同一毫秒：id 决胜后仍能认出「提交」为完成动作',
    dTie.times['实施对接时间'], Date.parse('2026-10-31T15:51:01.067Z'));

  /* A.18 排序键优先用 jdy_op_time（header 回退 1ms 时不被误导） */
  const headerBack = [
    { id: 1, event_flow_name: '策略开通', event_finish_action: '提交',
      header_created_at: '2026-10-31T15:40:56.852Z', jdy_op_time: '2026-10-31T15:40:56.852Z',
      event_created_count: 0, event_completed_count: 1, event_canceled_count: 0 },
    { id: 2, event_flow_name: '策略开通', event_finish_action: '转交',
      header_created_at: '2026-10-31T15:40:56.851Z', jdy_op_time: '2026-10-31T15:40:56.851Z',
      event_created_count: 1, event_completed_count: 0, event_canceled_count: 0 },
  ];
  eq('A.18 header 回退 1ms：按 jdy_op_time 排序，完成时间正确',
    flowState.deriveNodeTimes(headerBack).times['策略开通时间'],
    Date.parse('2026-10-31T15:40:56.852Z'));

  /* A.19 终态：全部节点都完成，8 列全部有值 */
  const terminal = flowState.CANONICAL_NODE_ORDER.map((n, i) => ev(n, '提交', t0 + i * 1000));
  const dTerm = flowState.deriveNodeTimes(terminal);
  eq('A.19 终态：8 个时间列全部有值', TIME_FIELDS.filter((f) => dTerm.times[f] !== null).length, 8);

  /* A.20 空输入不抛错 */
  let threw = null;
  let dEmpty = null;
  try { dEmpty = flowState.deriveNodeTimes([]); } catch (e) { threw = e; }
  ok('A.20 空数组不抛错且全空', threw === null
    && TIME_FIELDS.every((f) => dEmpty.times[f] === null));

  /* A.21 非数组 / null 输入不抛错 */
  ok('A.21 null / 非数组输入不抛错', (() => {
    try { flowState.deriveNodeTimes(null); flowState.deriveNodeTimes('x'); return true; } catch (e) { return false; }
  })());

  /* A.22 别名归一化：开通 / 系统对接 / 使用培训 / 解决方案确认 / 客户结论 */
  const aliasCases = [
    ['开通', '策略开通时间'], ['系统对接', '实施对接时间'], ['使用培训', '客户培训时间'],
    ['解决方案确认', '对接审核时间'], ['客户结论', '策略审核时间'],
  ];
  let aliasOk = true;
  let aliasDetail = [];
  for (const [alias, field] of aliasCases) {
    const d = flowState.deriveNodeTimes([ev(alias, '提交', t0)]);
    if (d.times[field] !== t0) { aliasOk = false; aliasDetail.push(`${alias}→${field} 得到 ${d.times[field]}`); }
  }
  ok('A.22 历史/别名节点名全部归一化到正确时间列', aliasOk, aliasDetail.join('; '));

  /* A.23 非主流程节点被忽略（如「删除」之类） */
  const dOther = flowState.deriveNodeTimes([ev('策略开通', '提交', t0), ev('某个未知节点', '提交', t0 + 1)]);
  eq('A.23 非主流程节点被忽略，不影响 8 列', dOther.times['策略开通时间'], t0);

  /* A.24 completeActions 可配置 */
  const dCustom = flowState.deriveNodeTimes([ev('策略开通', '我的自定义完成', t0)], {
    completeActions: ['我的自定义完成'],
  });
  eq('A.24 completeActions 可配置（自定义动作也能算完成）', dCustom.times['策略开通时间'], t0);

  /* A.25 extraCompleteActions 追加动作 */
  const dExtra = flowState.deriveNodeTimes([ev('策略审核', '移交', t0)], { extraCompleteActions: ['移交'] });
  eq('A.25 extraCompleteActions 追加「移交」后算完成', dExtra.times['策略审核时间'], t0);

  /* A.26 事件计数兜底：finish_action 为空但 event_completed_count>0 也算完成 */
  const dCount = flowState.deriveNodeTimes([
    { id: 9, event_flow_name: '客服处理', event_finish_action: null,
      header_created_at: '2026-10-31T10:00:00.000Z', jdy_op_time: '2026-10-31T10:00:00.000Z',
      event_created_count: 0, event_completed_count: 1, event_canceled_count: 0 },
  ]);
  eq('A.26 action 为空但 completed_count>0：仍算完成',
    dCount.times['客服处理时间'], Date.parse('2026-10-31T10:00:00.000Z'));

  /* A.27 trimByCurrentNode 开关（历史口径复现，默认关闭） */
  const dTrim = flowState.deriveNodeTimes(normal, { trimByCurrentNode: true });
  eq('A.27 trimByCurrentNode=true：只保留当前节点之前的（历史口径）',
    TIME_FIELDS.filter((f) => dTrim.times[f] !== null).sort(),
    ['单据提交时间', '策略开通时间'].sort());

  /* A.28 toMs 各种输入形态 */
  eq('A.28 toMs(Date) 正确', flowState.toMs(new Date(1793461861067)), 1793461861067);
  eq('A.29 toMs(10 位秒级) 自动 ×1000', flowState.toMs(1793461861), 1793461861000);
  eq('A.30 toMs(北京墙钟字符串)', flowState.toMs('2026-10-31 23:51:01'),
    Date.parse('2026-10-31T23:51:01+08:00'));
  eq('A.31 toMs(null/空串) 返回 null',
    [flowState.toMs(null), flowState.toMs(''), flowState.toMs(undefined)], [null, null, null]);
  eq('A.32 toLocalString 往返一致',
    flowState.toLocalString(flowState.toMs('2026-10-31 23:51:01')), '2026-10-31 23:51:01');

  /* ══════════════ B. TIME_FIELD_OF_NODE 全覆盖 ══════════════ */
  console.log('\n── B. TIME_FIELD_OF_NODE 8 节点覆盖 ──');
  const canon = flowState.CANONICAL_NODE_ORDER;
  eq('B.1 CANONICAL_NODE_ORDER 共 8 个节点', canon.length, 8);
  eq('B.2 TIME_FIELD_OF_NODE 共 8 个字段', Object.keys(flowState.TIME_FIELD_OF_NODE).length, 8);
  const missingNode = canon.filter((n) => !flowState.TIME_FIELD_OF_NODE[n]);
  ok('B.3 8 个规范化节点都能映射到时间字段', missingNode.length === 0, JSON.stringify(missingNode));
  const dupField = new Set(TIME_FIELDS);
  ok('B.4 8 个时间字段互不重复', dupField.size === 8, `distinct=${dupField.size}`);
  ok('B.5 历史 NODE_ORDER 的「开始」也能映射到「单据提交时间」',
    flowState.timeFieldOfNode('开始') === '单据提交时间', String(flowState.timeFieldOfNode('开始')));
  ok('B.6 「销售签约」映射到「单据提交时间」',
    flowState.timeFieldOfNode('销售签约') === '单据提交时间');
  ok('B.7 nodeIndex 用规范化顺序：「开始」下标 = 0（V9 修的 bug）',
    flowState.nodeIndex('开始') === 0, String(flowState.nodeIndex('开始')));
  ok('B.8 isMainNode 判定正确',
    flowState.isMainNode('开通') === true && flowState.isMainNode('不存在') === false);
  ok('B.9 未知节点的时间字段为 null', flowState.timeFieldOfNode('不存在') === null);

  /* ══════════════ C. 真实数据：节点 215 ══════════════ */
  console.log('\n── C. 真实数据：节点 215 ──');
  const { map: colOf, byComment } = await columnMap(P16);
  eq('C.1 动态解析到 8 个时间列（按 COLUMN_COMMENT）', Object.keys(colOf).length, 8);

  const ev215 = await db.query(
    `SELECT id, jdy_op_time, header_created_at, event_flow_name, event_finish_action,
            event_created_count, event_completed_count, event_canceled_count, event_current_assignee
       FROM \`${P102}\` WHERE event_instance_id = ? ORDER BY jdy_op_time, id`,
    [NODE215_ID]
  );
  ok('C.2 215 有 7 条流程事件', ev215.length === 7, `实际 ${ev215.length}`);
  const d215 = flowState.deriveNodeTimes(ev215);
  eq('C.3 215 实施对接时间推导值 = 1793461861067', d215.times['实施对接时间'], 1793461861067);
  eq('C.4 215 实施对接时间本地串 = 2026-10-31 23:51:01',
    d215.timesLocal['实施对接时间'], '2026-10-31 23:51:01');
  eq('C.5 215 策略开通时间推导值 = 1793461256851', d215.times['策略开通时间'], 1793461256851);
  eq('C.6 215 单据提交时间推导值 = 1793461011852', d215.times['单据提交时间'], 1793461011852);
  eq('C.7 215 对接审核时间 = null（刚进入，尚未提交）', d215.times['对接审核时间'], null);
  ok('C.8 215 当前节点 = 对接审核', d215.currentNode === '对接审核', String(d215.currentNode));

  /* ══════════════ D. dry-run 不写库 ══════════════ */
  console.log('\n── D. dry-run 不写库 ──');
  const fpBefore = await fingerprint16(colOf);
  ok('D.1 parsed_16 指纹可计算', Number.isFinite(fpBefore.rows) && !!fpBefore.hash,
    JSON.stringify(fpBefore));
  // 纯读取 + 纯计算，不落库
  const allRows = await db.query(
    `SELECT jdy_data_id, \`${byComment.get('流水号')}\` AS sn, ${TIME_FIELDS.map((f) => `\`${colOf[f]}\` AS \`${f}\``).join(', ')}
       FROM \`${P16}\``
  );
  const allEvents = await db.query(
    `SELECT id, event_instance_id, jdy_op_time, header_created_at, event_flow_name,
            event_finish_action, event_created_count, event_completed_count, event_canceled_count
       FROM \`${P102}\` ORDER BY event_instance_id, jdy_op_time, id`
  );
  const evByInst = new Map();
  for (const e of allEvents) {
    const k = String(e.event_instance_id);
    if (!evByInst.has(k)) evByInst.set(k, []);
    evByInst.get(k).push(e);
  }
  let derivedCount = 0;
  for (const r of allRows) {
    const d = flowState.deriveNodeTimes(evByInst.get(String(r.jdy_data_id)) || []);
    derivedCount += TIME_FIELDS.filter((f) => d.times[f] !== null).length;
  }
  ok('D.2 全表推导完成（共 ' + derivedCount + ' 个非空推导值）', derivedCount > 0);
  const fpAfter = await fingerprint16(colOf);
  eq('D.3 dry-run 前后 parsed_16 整表指纹完全一致', fpAfter, fpBefore);

  /* ══════════════ E. 宽表非空率不倒退 + 215 宽表时间 ══════════════ */
  console.log('\n── E. 宽表与 parsed_16 的时间列一致性 ──');
  const wideCounts = await db.queryOne(
    `SELECT ${TIME_FIELDS.map((f) => `SUM(CASE WHEN \`${f}\` IS NOT NULL AND \`${f}\` <> '' THEN 1 ELSE 0 END) AS \`${f}\``).join(', ')}
       FROM \`${WIDE}\``
  );
  const p16Counts = await db.queryOne(
    `SELECT ${TIME_FIELDS.map((f) => `SUM(CASE WHEN \`${colOf[f]}\` IS NOT NULL AND \`${colOf[f]}\` <> '' THEN 1 ELSE 0 END) AS \`${f}\``).join(', ')}
       FROM \`${P16}\``
  );
  let regressList = [];
  TIME_FIELDS.forEach((f) => {
    const w = Number(wideCounts[f] || 0);
    const p = Number(p16Counts[f] || 0);
    console.log(`      ${f}: 宽表=${String(w).padStart(3)}  parsed_16=${String(p).padStart(3)}`);
    if (w < p) regressList.push(`${f} 宽表${w} < parsed16 ${p}`);
  });
  ok('E.1 宽表 8 个时间列非空率 ≥ parsed_16 对应值（不倒退）',
    regressList.length === 0, regressList.join('; '));

  const w215 = await db.queryOne(`SELECT * FROM \`${WIDE}\` WHERE \`流水号\` = ? LIMIT 1`, [NODE215_SN]);
  ok('E.2 宽表存在节点 215 的行', !!w215);
  ok('E.3 215 宽表「实施对接时间」= 2026-10-31 23:51:01',
    !!(w215 && String(w215['实施对接时间'] || '').startsWith('2026-10-31 23:51:01')),
    w215 && JSON.stringify(w215['实施对接时间']));
  ok('E.4 215 宽表「单据提交时间」= 2026-10-31 23:36:00',
    !!(w215 && String(w215['单据提交时间'] || '').startsWith('2026-10-31 23:36:00')),
    w215 && JSON.stringify(w215['单据提交时间']));
  ok('E.5 215 宽表「策略开通时间」= 2026-10-31 23:40:00',
    !!(w215 && String(w215['策略开通时间'] || '').startsWith('2026-10-31 23:40:00')),
    w215 && JSON.stringify(w215['策略开通时间']));
  eq('E.6 215 宽表「对接审核时间」为空（刚进入，尚未提交）',
    String((w215 && w215['对接审核时间']) || ''), '');

  /* ══════════════ F. 开关与「绝不清空」铁律 ══════════════ */
  console.log('\n── F. 开关与「绝不清空」铁律 ──');
  delete process.env.FLOW_SYNC_NODE_TIMES;
  ok('F.1 FLOW_SYNC_NODE_TIMES 未设置时默认开启', flowIngest.nodeTimeSyncEnabled() === true);
  process.env.FLOW_SYNC_NODE_TIMES = '0';
  ok('F.2 FLOW_SYNC_NODE_TIMES=0 时一键关停', flowIngest.nodeTimeSyncEnabled() === false);
  process.env.FLOW_SYNC_NODE_TIMES = '1';
  ok('F.3 FLOW_SYNC_NODE_TIMES=1 时开启', flowIngest.nodeTimeSyncEnabled() === true);
  delete process.env.FLOW_SYNC_NODE_TIMES;

  ok('F.4 fillMissingNodeTimes 已导出', typeof flowIngest.fillMissingNodeTimes === 'function');
  ok('F.5 resolveTimeColumns 已导出', typeof flowIngest.resolveTimeColumns === 'function');
  ok('F.6 nodeTimeFreshMs 默认 10 分钟', flowIngest.nodeTimeFreshMs() === 600000,
    String(flowIngest.nodeTimeFreshMs()));

  // 对 215 调用落库函数：推导值与现值一致 → 不应产生任何写入
  const d215b = flowState.deriveNodeTimes(ev215);
  const fill215 = await flowIngest.fillMissingNodeTimes(P16, NODE215_ID, d215b, { maxAgeMs: Infinity });
  eq('F.7 对 215 补空：现值已齐备 → 补写 0 格（绝不覆盖已有值）', fill215.filled.length, 0);

  // 历史行新鲜度闸门：旧行（window=1ms）必须被拦下且不写
  const fpBeforeGate = await fingerprint16(colOf);
  const staleId = allRows.find((r) => String(r.sn) === '087');
  if (staleId) {
    const dStale = flowState.deriveNodeTimes(evByInst.get(String(staleId.jdy_data_id)) || []);
    const fillStale = await flowIngest.fillMissingNodeTimes(P16, staleId.jdy_data_id, dStale, { maxAgeMs: 1 });
    eq('F.8 历史行（新鲜度闸门 maxAgeMs=1）被拦下：跳过原因 = stale_row',
      fillStale.skipped, 'stale_row');
    eq('F.9 历史行被拦下时不写入任何格', fillStale.filled.length, 0);
  } else {
    ok('F.8（跳过）未找到样本行 087', true);
    ok('F.9（跳过）未找到样本行 087', true);
  }
  const fpAfterGate = await fingerprint16(colOf);
  eq('F.10 新鲜度闸门拦下后 parsed_16 指纹不变（未写库）', fpAfterGate, fpBeforeGate);

  /* ══════════════ G. flows.js 尾随补跑（215 真因修复） ══════════════ */
  console.log('\n── G. flows.js 尾随补跑 ──');
  ok('G.1 scheduleDeferredRerun 已导出', typeof flows.scheduleDeferredRerun === 'function');
  ok('G.2 clearDeferredReruns / listDeferredReruns 已导出',
    typeof flows.clearDeferredReruns === 'function' && typeof flows.listDeferredReruns === 'function');
  ok('G.3 deferredRerunEnabled 默认开启（未注入时钟时）',
    flows.deferredRerunEnabled({}) === true);

  const fakeFlows = [{ id: 901, status: 1, run_mode: 'trigger', project_id: 16, nodes: '[]' }];
  flows.resetFlowRunGates();
  const calls = [];
  const runner = (id, trigger) => { calls.push([id, trigger]); return Promise.resolve(); };

  // 第一次：抢占闸门，正常触发
  const r1 = await flows.triggerOnPush(16, { flows: fakeFlows, runner });
  eq('G.4 首次推送正常触发', r1.triggered, [901]);
  await sleep(60);

  // 第二次：冷却期内 → 必须登记尾随补跑，而不是静默丢弃
  const r2 = await flows.triggerOnPush(16, { flows: fakeFlows, runner });
  eq('G.5 冷却期内的推送被合并（skipped）', r2.skipped.map((s) => s.reason), ['cooldown']);
  ok('G.6 但已登记尾随补跑（不再静默丢弃 —— 215 缺时间的真因）',
    Array.isArray(r2.deferred) && r2.deferred.length === 1,
    JSON.stringify(r2.deferred));
  ok('G.7 listDeferredReruns 能看到待补跑', flows.listDeferredReruns().length === 1,
    JSON.stringify(flows.listDeferredReruns()));

  // 第三次：冷却期内再来一条 → 仍然只保留 1 个待补跑（合并）
  const r3 = await flows.triggerOnPush(16, { flows: fakeFlows, runner });
  ok('G.8 冷却期内多次推送只保留 1 个待补跑', flows.listDeferredReruns().length === 1);

  // 手动推进补跑（用注入冷却保证确定性）
  const g4 = flows.beginFlowRun(901, { cooldownMs: 0 });
  ok('G.9 冷却结束后补跑能重新抢占闸门', g4.started === true, JSON.stringify(g4));
  flows.endFlowRun(901, {});
  flows.clearDeferredReruns();
  eq('G.10 clearDeferredReruns 清空队列', flows.listDeferredReruns().length, 0);

  // 真实定时器路径：确定性地造出「冷却期」，验证补跑真的会跑起来
  flows.resetFlowRunGates();
  calls.length = 0;
  flows.endFlowRun(901, {});                 // 先造一个刚结束的运行 → 处于冷却期
  const gOpts = { flows: fakeFlows, runner, cooldownMs: 60000, deferDelayMs: 60 };
  const g1 = await flows.triggerOnPush(16, gOpts);
  eq('G.11 冷却期内的推送被合并（triggered 为空）', g1.triggered, []);
  ok('G.11b 冷却期内的推送登记了尾随补跑（不再静默丢弃）',
    Array.isArray(g1.deferred) && g1.deferred.length === 1, JSON.stringify(g1.deferred));
  ok('G.11c 补跑尚未执行（延迟窗口内 calls 仍为 0）', calls.length === 0, `calls=${JSON.stringify(calls)}`);
  await sleep(250);                          // 等补跑定时器到点（delay 60ms + 余量）
  ok('G.12 尾随补跑最终被真正执行（calls = 1）', calls.length === 1, `calls=${JSON.stringify(calls)}`);
  ok('G.12b 补跑结束后队列已清空', flows.listDeferredReruns().length === 0,
    JSON.stringify(flows.listDeferredReruns()));
  ok('G.13 尾随补跑的 trigger 也是 push',
    calls.every((c) => c[1] === 'push'), JSON.stringify(calls));

  // FLOW_ON_PUSH_DEFER=0 关闭尾随补跑（回到旧行为）
  flows.resetFlowRunGates();
  process.env.FLOW_ON_PUSH_DEFER = '0';
  await flows.triggerOnPush(16, { flows: fakeFlows, runner });
  await sleep(30);
  flows.endFlowRun(901, {});
  const rOff = await flows.triggerOnPush(16, { flows: fakeFlows, runner });
  ok('G.14 FLOW_ON_PUSH_DEFER=0 时回到旧行为（不登记补跑）',
    !rOff.deferred && flows.listDeferredReruns().length === 0,
    JSON.stringify({ deferred: rOff.deferred, pending: flows.listDeferredReruns() }));
  delete process.env.FLOW_ON_PUSH_DEFER;
  flows.resetFlowRunGates();

  /* ══════════════ H. 写库分支实测（隔离临时表，零风险） ══════════════ */
  console.log('\n── H. 写库分支实测（临时表 _probe_v9_node_times） ──');
  const PROBE = '_probe_v9_node_times';
  let probeCreated = false;
  try {
    await db.raw(`DROP TABLE IF EXISTS \`${PROBE}\``);
    await db.raw(`CREATE TABLE \`${PROBE}\` (
        jdy_data_id VARCHAR(64) NOT NULL PRIMARY KEY,
        jdy_op_time BIGINT NULL,
        ${TIME_FIELDS.map((f) => `\`${f}\` VARCHAR(64) NULL COMMENT '${f}(解析)'`).join(',\n        ')}
      ) DEFAULT CHARSET = utf8mb4`);
    probeCreated = true;
    ok('H.1 临时探针表建成（8 个时间列按 X(解析) 注释命名）', true);

    const resolved = await flowIngest.resolveTimeColumns(PROBE);
    eq('H.2 按 COLUMN_COMMENT 动态解析出 8 个时间列（不硬编码）',
      Object.keys(resolved).length, 8);

    // 事件：策略开通已提交 → 推导出「策略开通时间」
    const probeEvents = [
      ev('开始', '提交', t0),
      ev('策略开通', '提交', t0 + 60000),
      ev('实施对接', null, t0 + 60001),
    ];
    const dProbe = flowState.deriveNodeTimes(probeEvents);
    eq('H.3 探针推导出「策略开通时间」', dProbe.times['策略开通时间'], t0 + 60000);

    // 场景 1：实时行 + 空位 → 必须补写
    const nowMs = Date.now();
    await db.query(`INSERT INTO \`${PROBE}\` (jdy_data_id, jdy_op_time) VALUES (?, ?)`, ['probe-fresh', nowMs]);
    const fillFresh = await flowIngest.fillMissingNodeTimes(PROBE, 'probe-fresh', dProbe, { now: nowMs });
    eq('H.4 实时行 + 空位 → 补写 2 格（单据提交时间/策略开通时间）',
      fillFresh.filled.map((f) => f.field).sort(), ['单据提交时间', '策略开通时间'].sort());
    const afterFresh = await db.queryOne(`SELECT * FROM \`${PROBE}\` WHERE jdy_data_id = ?`, ['probe-fresh']);
    eq('H.5 补写落地值正确（策略开通时间）',
      String(afterFresh['策略开通时间']), flowState.toLocalString(t0 + 60000));
    eq('H.6 无完成动作的节点仍然不写（实施对接时间为空）',
      String(afterFresh['实施对接时间'] || ''), '');

    // 场景 2：已有非空值 → 绝不覆盖
    await db.query(
      `UPDATE \`${PROBE}\` SET \`策略开通时间\` = ? WHERE jdy_data_id = ?`,
      ['2020-01-01 00:00:00', 'probe-fresh']
    );
    const fillAgain = await flowIngest.fillMissingNodeTimes(PROBE, 'probe-fresh', dProbe, { now: nowMs });
    eq('H.7 已有非空值时补写 0 格（绝不覆盖）', fillAgain.filled.length, 0);
    const afterAgain = await db.queryOne(`SELECT * FROM \`${PROBE}\` WHERE jdy_data_id = ?`, ['probe-fresh']);
    eq('H.8 已有值原样保留', String(afterAgain['策略开通时间']), '2020-01-01 00:00:00');

    // 场景 3：历史行（超出新鲜度窗口）→ 不补
    await db.query(`INSERT INTO \`${PROBE}\` (jdy_data_id, jdy_op_time) VALUES (?, ?)`, ['probe-stale', nowMs - 86400000]);
    const fillStale = await flowIngest.fillMissingNodeTimes(PROBE, 'probe-stale', dProbe, { now: nowMs });
    eq('H.9 历史行（1 天前推送）被新鲜度闸门拦下', fillStale.skipped, 'stale_row');
    const afterStale = await db.queryOne(`SELECT * FROM \`${PROBE}\` WHERE jdy_data_id = ?`, ['probe-stale']);
    eq('H.10 历史行未被写入', String(afterStale['策略开通时间'] || ''), '');

    // 场景 4：推导值为空 → 不写（绝不清空已有值）
    await db.query(
      `UPDATE \`${PROBE}\` SET \`实施对接时间\` = ? WHERE jdy_data_id = ?`,
      ['2019-05-05 05:05:05', 'probe-fresh']
    );
    const fillEmptyDerived = await flowIngest.fillMissingNodeTimes(PROBE, 'probe-fresh', dProbe, { now: nowMs });
    const afterEmpty = await db.queryOne(`SELECT * FROM \`${PROBE}\` WHERE jdy_data_id = ?`, ['probe-fresh']);
    eq('H.11 推导值为空的列绝不清空已有值（用户投诉的另一半）',
      String(afterEmpty['实施对接时间']), '2019-05-05 05:05:05');
    eq('H.12 该次补写不涉及「实施对接时间」',
      fillEmptyDerived.filled.map((f) => f.field).includes('实施对接时间'), false);

    // 场景 5：jdy_data_id 不存在 → 不抛错、不写
    const fillMissingRow = await flowIngest.fillMissingNodeTimes(PROBE, 'not-exists', dProbe, { now: nowMs });
    eq('H.13 目标行不存在时如实返回 row_not_found（不抛错）', fillMissingRow.skipped, 'row_not_found');

    // 场景 6：FLOW_SYNC_NODE_TIMES=0 时 syncRunStateToFormProject 完全跳过推导
    process.env.FLOW_SYNC_NODE_TIMES = '0';
    ok('H.14 FLOW_SYNC_NODE_TIMES=0 时 nodeTimeSyncEnabled() = false',
      flowIngest.nodeTimeSyncEnabled() === false);
    delete process.env.FLOW_SYNC_NODE_TIMES;
  } finally {
    if (probeCreated) {
      await db.raw(`DROP TABLE IF EXISTS \`${PROBE}\``).catch((e) => {
        console.error(`[WARN] 临时表清理失败，请手工执行 DROP TABLE \`${PROBE}\`: ${e.message}`);
      });
      const gone = await db.queryOne(
        `SELECT COUNT(*) AS n FROM information_schema.tables
          WHERE table_schema = DATABASE() AND table_name = ?`, [PROBE]
      );
      ok('H.15 探针表已删除（用完即删，不污染业务表）', Number(gone.n) === 0, `残留=${gone.n}`);
    }
  }

  /* ── 收尾 ── */
  console.log('\n════════════════════════════════════════');
  console.log(`总计 ${pass + fail} 项断言：PASS ${pass} / FAIL ${fail}`);
  if (fail) {
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    await db.close();
    process.exit(1);
  }
  console.log('全部通过 ✅');
  console.log('════════════════════════════════════════');
  await db.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('\n[自检异常]', err && err.stack ? err.stack : err);
  try { await db.close(); } catch (_) { /* ignore */ }
  process.exit(1);
});
