'use strict';

/**
 * V7 流程引擎 · 只读核验脚本（join + pick_current_task 规则在真实库上的表现）
 *
 * 安全约束：**只执行 SELECT / SHOW**，不写库、不建表、不改结构。
 * 本机 .env 连的是生产库，因此本脚本刻意不提供 --apply 开关——它永远只读。
 *
 * 运行：cd C:\Data\DSH\jdy-push && node scripts/v7-flow-verify-readonly.js
 *
 * 核验内容：
 *   1. 解析表里事件相关列是否齐全（102 是流程事件表）
 *   2. 用 pick_current_task 的真实规则（flows.runPickCurrentTask）从事件流算出每实例的
 *      当前节点/当前负责人
 *   3. 用 join(left) 把 16 的表单行与「收敛后的 102 状态」合成宽表，核对行数不膨胀
 *   4. 统计「102 有事件 / 无事件需回退 16.flow_current_*」的条数（契约 §3.3 口径）
 */

const db = require('../src/db');
const flows = require('../src/flows');

const PROJ_FORM = 16;   // CRM表单推送
const PROJ_FLOW = 102;  // CRM流程推送

const T_FORM = `jdywh_parsed_${PROJ_FORM}`;
const T_FLOW = `jdywh_parsed_${PROJ_FLOW}`;

const EVENT_COLS = [
  'event_instance_id',
  'event_flow_name',
  'event_current_assignee',
  'event_created_count',
  'event_canceled_count',
  'jdy_op_time',
];

function pad(s, n) { return String(s === null || s === undefined ? '' : s).padEnd(n, ' '); }

async function columnsOf(table) {
  const rows = await db.query(`SHOW COLUMNS FROM \`${table}\``);
  return rows.map((r) => r.Field);
}

async function main() {
  console.log('=== V7 流程引擎 · 只读核验（无任何写操作） ===\n');

  /* 1. 表与列 */
  const formCols = await columnsOf(T_FORM);
  const flowCols = await columnsOf(T_FLOW);
  console.log(`[1] ${T_FORM} 列数 ${formCols.length}；${T_FLOW} 列数 ${flowCols.length}`);
  const missing = EVENT_COLS.filter((c) => !flowCols.includes(c));
  console.log(`    事件列检查：${missing.length ? `缺少 ${missing.join(', ')}` : '全部存在 ✅'}`);

  const hasFallback = formCols.includes('flow_current_node') && formCols.includes('flow_current_owner');
  console.log(`    表单侧回退列 flow_current_node/flow_current_owner：${hasFallback ? '存在' : '不存在'}`);

  /* 2. 取数（只读） */
  const leftRows = await db.query(`SELECT * FROM \`${T_FORM}\` LIMIT 5000`);
  const timeCol = flowCols.includes('jdy_op_time') ? 'jdy_op_time'
    : (flowCols.includes('header_created_at') ? 'header_created_at' : null);
  const rightRows = await db.query(
    `SELECT ${EVENT_COLS.join(', ')}, \`jdy_data_id\` FROM \`${T_FLOW}\` LIMIT 20000`
  );
  console.log(`\n[2] 左表 ${leftRows.length} 行；右表（流程事件）${rightRows.length} 行；排序时间列=${timeCol}`);

  /* 3. pick_current_task：事件表 → 每实例 1 行（契约 §3.5 C3 新规则） */
  const pickCfg = {
    instanceKey: 'event_instance_id',
    timeColumn: timeCol,
    mode: 'pending',                       // 挂起待办：其后无 completed/canceled
    cutoffTime: '',                        // 留空 = 用当前时间（生产口径）
    createdCountColumn: 'event_created_count',
    completedCountColumn: 'event_completed_count',
    canceledCountColumn: 'event_canceled_count',
    nodeColumn: 'event_flow_name',
    ownerColumn: 'event_current_assignee',
    nodeAlias: '开始=销售签约',
    outputNodeName: '当前节点',
    outputOwnerName: '当前负责人',
  };
  const picked = flows.runPickCurrentTask(pickCfg, rightRows);
  console.log(`[3] pick_current_task：${rightRows.length} 条事件 → ${picked.length} 个实例（每实例 1 行）`);
  console.log(`    规则 mode=${pickCfg.mode}  cutoffTime=${pickCfg.cutoffTime || '(当前时间)'}`);

  // 对照：不加切点（=看全部事件）时的差异，说明「切点只影响快照边界」
  const pickedAll = flows.runPickCurrentTask(Object.assign({}, pickCfg, { cutoffTime: 9999999999999 }), rightRows);
  const pickMapNow = new Map(picked.map((r) => [String(r.event_instance_id), r]));
  let diff = 0;
  pickedAll.forEach((r) => {
    const a = pickMapNow.get(String(r.event_instance_id)) || {};
    if (String(a['当前节点'] || '') !== String(r['当前节点'] || '')
      || String(a['当前负责人'] || '') !== String(r['当前负责人'] || '')) diff += 1;
  });
  console.log(`    与「不切点」相比有差异的实例：${diff} 个`);

  const eventCounts = {};
  rightRows.forEach((r) => {
    const k = String(r.event_instance_id || '');
    eventCounts[k] = (eventCounts[k] || 0) + 1;
  });
  const maxEvents = Math.max(0, ...Object.values(eventCounts));
  console.log(`    单实例事件数：最大 ${maxEvents} 条（契约 §3.3 提示最多 19 条）`);

  const noValid = picked.filter((p) => p['当前节点'] === null || p['当前节点'] === undefined).length;
  console.log(`    有事件但算不出「当前节点」的实例：${noValid} 个（可能是只有取消事件）`);

  /* 4. join(left)：表单行 ⟕ 收敛后的 102 状态 */
  const joined = flows.runJoin({
    config: {
      joinType: 'left',
      leftKey: 'jdy_data_id',
      rightKey: 'event_instance_id',
      rightAgg: 'first',
      rightPrefix: 'flow_',
      rightFields: '当前节点,当前负责人',
    },
  }, leftRows, picked);

  console.log(`\n[4] join(left)：左 ${leftRows.length} 行 → 关联结果 ${joined.length} 行`
    + `（${joined.length === leftRows.length ? '行数不膨胀 ✅' : '行数异常 ❌'}）`);

  /* 5. 覆盖情况：102 有值 vs 需回退 16 */
  const withEvent = joined.filter((r) => r.flow_当前节点 !== null && r.flow_当前节点 !== undefined).length;
  console.log(`\n[5] 当前节点来源分布：`);
  console.log(`    来自 102 事件流：${withEvent} 行`);
  console.log(`    无 102 事件（需回退 16.flow_current_node）：${joined.length - withEvent} 行`);

  if (hasFallback) {
    const fallbackRows = joined.filter((r) => (r.flow_当前节点 === null || r.flow_当前节点 === undefined)
      && r.flow_current_node !== null && r.flow_current_node !== undefined
      && String(r.flow_current_node) !== '');
    console.log(`    其中 16 侧 flow_current_node 有值可回退：${fallbackRows.length} 行`);
    const neither = joined.filter((r) => (r.flow_当前节点 === null || r.flow_当前节点 === undefined)
      && (r.flow_current_node === null || r.flow_current_node === undefined || String(r.flow_current_node) === '')).length;
    console.log(`    两侧都没有值（只能留空）：${neither} 行`);
  }

  /* 6. 抽样 5 行展示（不输出任何敏感信息，仅节点名/负责人姓名） */
  console.log('\n[6] 抽样（data_id → 当前节点 / 当前负责人）：');
  joined.slice(0, 5).forEach((r) => {
    console.log(`    ${pad(r.jdy_data_id, 24)} ${pad(r.flow_当前节点, 12)} ${r.flow_当前负责人 || ''}`);
  });

  console.log('\n=== 核验完成（未写入任何数据） ===');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n[核验失败]', err && err.message ? err.message : err);
    process.exit(1);
  });
