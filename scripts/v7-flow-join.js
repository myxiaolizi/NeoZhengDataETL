'use strict';

/**
 * V7 处理流程新增节点单测：join / pick_current_task / computed + 推送触发
 *
 * 纯 Node，不连数据库（src/db.js 的连接池是懒加载的，require 不会建连）。
 * 运行：cd C:\Data\DSH\jdy-push && node scripts/v7-flow-join.js
 *
 * 覆盖：
 *   1. join left / inner 基础正确性
 *   2. 右侧 1:N 收敛（每 key 只留 1 行，不放大行数）
 *   3. pickCurrent：最后一条是「取消」事件时必须选到上一条有效创建事件
 *   4. 空右表（left 保留左行、右列补空）
 *   5. 列前缀与同名冲突处理
 *   6. pick_current_task 分组 / 输出列名 / 无有效事件回退
 *   7. computed 常量列 / copy 列 / onlyIfEmpty
 *   8. on_push 触发选择 + 防重入闸门 + 异步不阻塞
 *   9. NODE_TYPES 定义与 runClean dispatch 接通
 */

const flows = require('../src/flows');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`FAIL  ${name}${detail ? ` → ${detail}` : ''}`);
  }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, `实际=${a} 期望=${e}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function node(type, config) {
  return { id: `n_${type}`, type, config: config || {} };
}

/* ══════════════════════════════════════════════════════════
 *  测试数据
 *  左：表单推送（1 行 1 单据，data_id 为关联键）
 *  右：流程事件（事件表，1 实例多条；时间用毫秒，与 jdy_op_time 一致）
 * ══════════════════════════════════════════════════════════ */

const LEFT = [
  { data_id: 'A001', 标题: '甲连锁', 区域: '华东' },
  { data_id: 'A002', 标题: '乙连锁', 区域: '华南' },
  { data_id: 'A003', 标题: '丙连锁', 区域: '华北' },
];

const RIGHT = [
  // A001：创建待办 → 完成前序节点 → 进入对接审核（当前有效）
  { event_instance_id: 'A001', jdy_op_time: 1000, event_flow_name: '策略开通', event_current_assignee: '张三', event_created_count: 1, event_canceled_count: 0 },
  { event_instance_id: 'A001', jdy_op_time: 2000, event_flow_name: '实施对接', event_current_assignee: '李四', event_created_count: 1, event_canceled_count: 0 },
  { event_instance_id: 'A001', jdy_op_time: 3000, event_flow_name: '对接审核', event_current_assignee: '王五', event_created_count: 1, event_canceled_count: 0 },
  // A002：最后一条是「取消」事件（2000），上一条有效创建事件是 1000 的「客服处理」
  { event_instance_id: 'A002', jdy_op_time: 1000, event_flow_name: '客服处理', event_current_assignee: '赵六', event_created_count: 1, event_canceled_count: 0 },
  { event_instance_id: 'A002', jdy_op_time: 1500, event_flow_name: '客户培训', event_current_assignee: '钱七', event_created_count: 1, event_canceled_count: 0 },
  { event_instance_id: 'A002', jdy_op_time: 2000, event_flow_name: '客户培训', event_current_assignee: '钱七', event_created_count: 0, event_canceled_count: 1 },
  // A004：左表没有这个键 → 关联时不应影响行数
  { event_instance_id: 'A004', jdy_op_time: 1200, event_flow_name: '策略审核', event_current_assignee: '孙八', event_created_count: 1, event_canceled_count: 0 },
];

/* ══════════════════════════════════════════════════════════
 *  1. join —— left 基础
 * ══════════════════════════════════════════════════════════ */
console.log('\n── 1. join left 基础 ──');
{
  const jn = node('join', {
    joinType: 'left', leftKey: 'data_id', rightKey: 'event_instance_id',
    rightAgg: 'last', timeColumn: 'jdy_op_time',
    rightFields: 'event_flow_name,event_current_assignee',
  });
  const out = flows.runClean(jn, [], { inputs: { left: LEFT, right: RIGHT } });
  eq('1.1 左关联行数 = 左表行数', out.length, 3);
  eq('1.2 匹配行取到右侧字段（last 取时间最大）', [out[0].event_flow_name, out[0].event_current_assignee], ['对接审核', '王五']);
  ok('1.3 无匹配的左行保留且右列为 null',
    out[2].data_id === 'A003' && out[2].event_flow_name === null && out[2].event_current_assignee === null,
    JSON.stringify(out[2]));
  ok('1.4 左表原有列保留', out[0].标题 === '甲连锁' && out[0].区域 === '华东');
  ok('1.5 右表多余的键（A004）不会增加行数', out.length === 3 && !out.some((r) => r.data_id === 'A004'));
}

/* ══════════════════════════════════════════════════════════
 *  2. join —— inner
 * ══════════════════════════════════════════════════════════ */
console.log('\n── 2. join inner ──');
{
  const jn = node('join', {
    joinType: 'inner', leftKey: 'data_id', rightKey: 'event_instance_id',
    rightAgg: 'last', timeColumn: 'jdy_op_time',
  });
  const out = flows.runClean(jn, [], { inputs: { left: LEFT, right: RIGHT } });
  eq('2.1 内关联只留能匹配的行', out.length, 2);
  eq('2.2 内关联结果不含未匹配键', out.map((r) => r.data_id), ['A001', 'A002']);
}

/* ══════════════════════════════════════════════════════════
 *  3. 右侧 1:N 收敛
 * ══════════════════════════════════════════════════════════ */
console.log('\n── 3. 右侧 1:N 收敛 ──');
{
  const first = flows.runClean(node('join', {
    joinType: 'left', leftKey: 'data_id', rightKey: 'event_instance_id',
    rightAgg: 'first', timeColumn: 'jdy_op_time', rightFields: 'event_flow_name',
  }), [], { inputs: { left: LEFT, right: RIGHT } });
  eq('3.1 first：取时间最小的一条', first[0].event_flow_name, '策略开通');

  const last = flows.runClean(node('join', {
    joinType: 'left', leftKey: 'data_id', rightKey: 'event_instance_id',
    rightAgg: 'last', timeColumn: 'jdy_op_time', rightFields: 'event_flow_name',
  }), [], { inputs: { left: LEFT, right: RIGHT } });
  eq('3.2 last：取时间最大的一条', last[0].event_flow_name, '对接审核');

  ok('3.3 1:N 收敛后行数不被放大（A001 有 3 条事件仍只出 1 行）', last.length === 3 && last[0].data_id === 'A001');
}

/* ══════════════════════════════════════════════════════════
 *  4. pickCurrent —— 契约 §3.5 C3「挂起待办」规则
 *
 *  〖核心〗新规则 = 最后一条 created>0 且**其后**没有任何 completed>0 / canceled>0。
 *  旧规则（mode='simple'）= 最后一条 created>0 且**同一行**未取消（保留可选）。
 * ══════════════════════════════════════════════════════════ */
console.log('\n── 4. pickCurrent 挂起待办规则（C3）──');
{
  const baseJoin = {
    joinType: 'left', leftKey: 'data_id', rightKey: 'event_instance_id',
    rightAgg: 'pickCurrent', timeColumn: 'jdy_op_time',
    rightFields: 'event_flow_name,event_current_assignee',
  };
  const pick = (right, extra) => flows.runClean(
    node('join', Object.assign({}, baseJoin, extra || {})),
    [], { inputs: { left: LEFT, right } }
  );

  // 4.1 正常链：最后一条创建之后没有完成/取消 → 选它
  const out = pick(RIGHT);
  eq('4.1 正常实例取最后一条挂起待办', [out[0].event_flow_name, out[0].event_current_assignee], ['对接审核', '王五']);

  // 4.2 【核心新用例】创建后被取消 → 不应再选它，且无其他挂起 → null
  //     A002: 1000 客服处理(创建) → 1500 客户培训(创建) → 2000 客户培训(取消)
  ok('4.2 创建后被取消（其后有 cancel）→ 不再选它，无挂起则右列为空',
    out[1].event_flow_name === null && out[1].event_current_assignee === null,
    JSON.stringify(out[1]));

  // 4.3 mode='simple' 保留旧行为：只看同一行没取消 → 仍会误选 1500 的客户培训
  const simple = pick(RIGHT, { mode: 'simple' });
  eq('4.3 mode=simple 保留旧规则（会误选已被取消的待办）',
    [simple[1].event_flow_name, simple[1].event_current_assignee], ['客户培训', '钱七']);

  // 4.4 创建 → 完成 → 再创建：应选最后那条「还没被完成/取消」的
  const chain = [
    { event_instance_id: 'A001', jdy_op_time: 100, event_flow_name: '策略开通', event_current_assignee: '甲', event_created_count: 1, event_completed_count: 0, event_canceled_count: 0 },
    { event_instance_id: 'A001', jdy_op_time: 200, event_flow_name: '策略开通', event_current_assignee: '甲', event_created_count: 0, event_completed_count: 1, event_canceled_count: 0 },
    { event_instance_id: 'A001', jdy_op_time: 300, event_flow_name: '实施对接', event_current_assignee: '乙', event_created_count: 1, event_completed_count: 0, event_canceled_count: 0 },
  ];
  eq('4.4 创建→完成→再创建：选最后一条仍未完成的',
    pick(chain)[0].event_flow_name, '实施对接');

  // 4.5 创建 → 完成（无后续创建）：没有挂起待办 → null
  const done = [
    { event_instance_id: 'A001', jdy_op_time: 100, event_flow_name: '策略开通', event_current_assignee: '甲', event_created_count: 1, event_completed_count: 0, event_canceled_count: 0 },
    { event_instance_id: 'A001', jdy_op_time: 200, event_flow_name: '策略开通', event_current_assignee: '甲', event_created_count: 0, event_completed_count: 1, event_canceled_count: 0 },
  ];
  ok('4.5 创建后已完成 → 没有挂起待办（右列为空，交由上层回退）',
    pick(done)[0].event_flow_name === null, JSON.stringify(pick(done)[0]));

  // 4.6 只有取消事件 → 无挂起
  const onlyCancel = [{ event_instance_id: 'A003', jdy_op_time: 500, event_flow_name: '策略开通', event_current_assignee: '周九', event_created_count: 0, event_completed_count: 0, event_canceled_count: 1 }];
  ok('4.6 只有取消事件时视为无挂起待办（右列为空）',
    pick(onlyCancel, { joinType: 'left' })[2].event_flow_name === null,
    JSON.stringify(pick(onlyCancel)[2]));

  // 4.7 切点：快照之后的事件不参与判定
  //     若不切，1500 的「客户培训(创建)」会被 2000 的取消否掉 → null；
  //     切在 1200 之后，则 1500/2000 都不参与 → 选 1000 的「客服处理」
  const cutCfg = { cutoffTime: 1200 };
  eq('4.7 cutoffTime 生效：快照之后的事件不参与',
    pick(RIGHT, cutCfg)[1].event_flow_name, '客服处理');
  ok('4.7b 不切点时该实例无挂起（对照）', pick(RIGHT)[1].event_flow_name === null);

  // 4.8 切点必须真能改变结果：A001 有 3000 的对接审核
  eq('4.8 cutoff=2500 时 A001 取到 2000 的「实施对接」', pick(RIGHT, { cutoffTime: 2500 })[0].event_flow_name, '实施对接');
  eq('4.9 cutoff=500 时 A001 无事件可用 → 右列为空', pick(RIGHT, { cutoffTime: 500 })[0].event_flow_name, null);

  // 4.10 「创建即取消」（同一行 created>0 且 canceled>0）：
  //      默认按 C3 原文只判「其后」→ 该行是最后一条，仍会被选中；
  //      selfCancelDisqualifies=true（更保守口径）→ 跳过它，无其他挂起 → null。
  const selfCancel = [
    { event_instance_id: 'A001', jdy_op_time: 200, event_flow_name: '客户培训', event_current_assignee: '乙', event_created_count: 1, event_completed_count: 0, event_canceled_count: 1 },
  ];
  eq('4.10 同一行「创建即取消」且是最后一条 → 默认仍选中（C3 原文只判其后）',
    pick(selfCancel)[0].event_flow_name, '客户培训');
  eq('4.11 selfCancelDisqualifies=true → 跳过创建即取消，无其他挂起则为空',
    pick(selfCancel, { selfCancelDisqualifies: true })[0].event_flow_name, null);
  // 纯函数层面更直观地对照两种口径
  eq('4.11b 纯函数：默认选中该行',
    flows.pickCurrentEvent(selfCancel, { timeColumn: 'jdy_op_time', cutoffTime: 9999 }).event_flow_name, '客户培训');
  eq('4.11c 纯函数：selfCancelDisqualifies 时返回 null',
    flows.pickCurrentEvent(selfCancel, { timeColumn: 'jdy_op_time', cutoffTime: 9999, selfCancelDisqualifies: true }), null);

  // 4.12 节点别名（左右两路 join 时按 nodeColumn 精确作用于该列）
  const withAlias = pick(
    [{ event_instance_id: 'A001', jdy_op_time: 100, event_flow_name: '开始', event_current_assignee: '卢雪阳', event_created_count: 1, event_completed_count: 0, event_canceled_count: 0 }],
    { nodeColumn: 'event_flow_name', nodeAlias: '开始=销售签约' }
  );
  eq('4.12 nodeAlias 生效：开始 → 销售签约', withAlias[0].event_flow_name, '销售签约');
  eq('4.13 nodeAlias 不影响负责人列', withAlias[0].event_current_assignee, '卢雪阳');
}

/* ══════════════════════════════════════════════════════════
 *  4b. pickCurrentEvent 纯函数直测（不经过 join）
 * ══════════════════════════════════════════════════════════ */
console.log('\n── 4b. pickCurrentEvent / resolveCutoffTime ──');
{
  // 场景：A 创建 → B 创建 → B 完成（B 已完成，A 也被「其后的完成事件」否掉）
  const ev = [
    { t: 100, n: 'A', c: 1, cp: 0, ca: 0 },
    { t: 200, n: 'B', c: 1, cp: 0, ca: 0 },
    { t: 300, n: 'B', c: 0, cp: 1, ca: 0 },
  ];
  const opts = (extra) => Object.assign({
    timeColumn: 't', createdCountColumn: 'c', completedCountColumn: 'cp',
    canceledCountColumn: 'ca', cutoffTime: 9999,
  }, extra || {});

  eq('4b.1 其后的完成事件会否掉更早的挂起待办 → 无挂起（null）',
    flows.pickCurrentEvent(ev, opts()), null);
  eq('4b.2 mode=simple 在新规则下会误选已完成节点 B',
    flows.pickCurrentEvent(ev, opts({ mode: 'simple' })).n, 'B');

  // 场景：A 创建 → A 完成 → B 创建（B 是唯一挂起）
  const ev2 = [
    { t: 100, n: 'A', c: 1, cp: 0, ca: 0 },
    { t: 200, n: 'A', c: 0, cp: 1, ca: 0 },
    { t: 300, n: 'B', c: 1, cp: 0, ca: 0 },
  ];
  eq('4b.3 最后一个创建的待办仍在挂起 → 选中它', flows.pickCurrentEvent(ev2, opts()).n, 'B');

  // 场景：A 创建 → A 取消（其后有 cancel，A 被否掉）
  const ev3 = [
    { t: 100, n: 'A', c: 1, cp: 0, ca: 0 },
    { t: 200, n: 'B', c: 1, cp: 0, ca: 0 },
    { t: 300, n: 'B', c: 0, cp: 0, ca: 1 },
  ];
  eq('4b.4 其后有取消事件 → 无挂起（null）', flows.pickCurrentEvent(ev3, opts()), null);

  // 切点：把 300 的取消切掉，B(200) 就还在挂起
  eq('4b.5 切点把取消事件切掉后 → B 重新成为挂起',
    flows.pickCurrentEvent(ev3, opts({ cutoffTime: 250 })).n, 'B');

  eq('4b.6 空数组 → null', flows.pickCurrentEvent([], opts()), null);
  eq('4b.7 全是完成/取消事件 → null',
    flows.pickCurrentEvent([{ t: 1, c: 0, cp: 1, ca: 0 }], opts()), null);

  // 切点解析：毫秒 / 北京时间的字符串 / 空
  eq('4b.8 resolveCutoffTime 毫秒原样返回', flows.resolveCutoffTime(1793374200000), 1793374200000);
  eq('4b.9 resolveCutoffTime 北京时间字符串 → UTC 毫秒',
    flows.resolveCutoffTime('2026-10-30 23:30:00'), 1793374200000);
  eq('4b.10 resolveCutoffTime 该值正是 15:30 UTC',
    new Date(flows.resolveCutoffTime('2026-10-30 23:30:00')).toISOString(),
    '2026-10-30T15:30:00.000Z');
  ok('4b.11 resolveCutoffTime 留空 → 当前时间',
    Math.abs(flows.resolveCutoffTime('') - Date.now()) < 2000);
  ok('4b.12 resolveCutoffTime 非法值 → 回落当前时间',
    Math.abs(flows.resolveCutoffTime('不是时间') - Date.now()) < 2000);
}

/* ══════════════════════════════════════════════════════════
 *  5. 空右表
 * ══════════════════════════════════════════════════════════ */
console.log('\n── 5. 空右表 ──');
{
  const out = flows.runClean(node('join', {
    joinType: 'left', leftKey: 'data_id', rightKey: 'event_instance_id',
    rightAgg: 'first', rightColumns: 'event_flow_name,event_current_assignee',
  }), [], { inputs: { left: LEFT, right: [] } });
  eq('5.1 空右表：左关联保留全部左行', out.length, 3);
  ok('5.2 空右表：声明的右列存在且为 null',
    out[0].event_flow_name === null && out[0].event_current_assignee === null, JSON.stringify(out[0]));

  const inner = flows.runClean(node('join', {
    joinType: 'inner', leftKey: 'data_id', rightKey: 'event_instance_id',
  }), [], { inputs: { left: LEFT, right: [] } });
  eq('5.3 空右表：内关联结果为 0 行', inner.length, 0);
}

/* ══════════════════════════════════════════════════════════
 *  6. 列前缀与冲突
 * ══════════════════════════════════════════════════════════ */
console.log('\n── 6. 列前缀 / 同名冲突 ──');
{
  const right = [{ event_instance_id: 'A001', 标题: '右表同名标题', event_flow_name: '对接审核' }];
  const out = flows.runClean(node('join', {
    joinType: 'left', leftKey: 'data_id', rightKey: 'event_instance_id',
    leftPrefix: 'L_', rightPrefix: 'R_', rightAgg: 'first', rightFields: '标题,event_flow_name',
  }), [], { inputs: { left: [LEFT[0]], right } });
  ok('6.1 左表列加前缀', out[0].L_data_id === 'A001' && out[0].L_标题 === '甲连锁', JSON.stringify(out[0]));
  ok('6.2 右表列加前缀', out[0].R_标题 === '右表同名标题' && out[0].R_event_flow_name === '对接审核');
  ok('6.3 关联键不重复输出（右表键列被排除）',
    out[0].event_instance_id === undefined && out[0].R_event_instance_id === undefined);

  // 无前缀时右侧同名冲突 → 自动加 right_ 兜底
  const out2 = flows.runClean(node('join', {
    joinType: 'left', leftKey: 'data_id', rightKey: 'event_instance_id',
    rightAgg: 'first', rightFields: '标题',
  }), [], { inputs: { left: [LEFT[0]], right } });
  ok('6.4 无前缀时同名冲突自动改名 right_<列名>',
    out2[0].标题 === '甲连锁' && out2[0].right_标题 === '右表同名标题', JSON.stringify(out2[0]));
}

/* ══════════════════════════════════════════════════════════
 *  7. rightFields 投影 / 缺参数报错
 * ══════════════════════════════════════════════════════════ */
console.log('\n── 7. rightFields 投影 ──');
{
  const out = flows.runClean(node('join', {
    joinType: 'left', leftKey: 'data_id', rightKey: 'event_instance_id',
    rightAgg: 'last', timeColumn: 'jdy_op_time', rightFields: 'event_current_assignee',
  }), [], { inputs: { left: [LEFT[0]], right: RIGHT } });
  ok('7.1 只输出 rightFields 指定的右列',
    out[0].event_current_assignee === '王五' && out[0].event_flow_name === undefined, JSON.stringify(out[0]));

  let err = null;
  try {
    flows.runClean(node('join', { rightKey: 'k' }), [], { inputs: { left: [], right: [] } });
  } catch (e) { err = e; }
  ok('7.2 缺少左关联键时报错', !!err && /左表关联键/.test(err.message), err && err.message);

  // 左右同名列时可只配 leftKey（rightKey 回落为 leftKey）
  const same = flows.runClean(node('join', {
    joinType: 'left', leftKey: 'k', rightAgg: 'first', rightFields: 'v',
  }), [], { inputs: { left: [{ k: '1' }], right: [{ k: '1', v: 'hit' }] } });
  ok('7.2b 未配 rightKey 时回落为 leftKey（同名列关联）', same[0].v === 'hit', JSON.stringify(same));

  let err2 = null;
  try {
    flows.runClean(node('join', { leftKey: 'data_id', rightKey: 'k' }), LEFT, {});
  } catch (e) { err2 = e; }
  ok('7.3 没有 ctx.inputs（左右两路）时报错', !!err2 && /左右两路上游/.test(err2.message), err2 && err2.message);
}

/* ══════════════════════════════════════════════════════════
 *  8. pick_current_task
 * ══════════════════════════════════════════════════════════ */
console.log('\n── 8. pick_current_task ──');
{
  const cfg = {
    instanceKey: 'event_instance_id', timeColumn: 'jdy_op_time',
    createdCountColumn: 'event_created_count', completedCountColumn: 'event_completed_count',
    canceledCountColumn: 'event_canceled_count',
    nodeColumn: 'event_flow_name', ownerColumn: 'event_current_assignee',
    outputNodeName: '当前节点', outputOwnerName: '当前负责人',
  };
  const out = flows.runClean(node('pick_current_task', cfg), RIGHT, {});
  eq('8.1 每个实例只输出 1 行', out.length, 3);
  const a2 = out.find((r) => r.event_instance_id === 'A002');
  eq('8.2 默认挂起规则：创建后被取消的待办不再被选中（该实例无挂起 → null）',
    [a2['当前节点'], a2['当前负责人']], [null, null]);
  const a1 = out.find((r) => r.event_instance_id === 'A001');
  eq('8.3 正常实例取最后一条挂起待办', [a1['当前节点'], a1['当前负责人']], ['对接审核', '王五']);

  // mode='simple' 保留旧行为（对 A002 会误选到已被取消的「客户培训」）
  const outSimple = flows.runClean(node('pick_current_task', Object.assign({}, cfg, { mode: 'simple' })), RIGHT, {});
  const a2s = outSimple.find((r) => r.event_instance_id === 'A002');
  eq('8.3b mode=simple 保留旧规则（会选到已被取消的待办）',
    [a2s['当前节点'], a2s['当前负责人']], ['客户培训', '钱七']);

  const out2 = flows.runClean(node('pick_current_task', Object.assign({}, cfg, {
    outputNodeName: '节点', outputOwnerName: '负责人', extraFields: 'jdy_op_time',
  })), RIGHT, {});
  const a1b = out2.find((r) => r.event_instance_id === 'A001');
  eq('8.4 自定义输出列名 + extraFields',
    [a1b['节点'], a1b['负责人'], a1b.jdy_op_time], ['对接审核', '王五', 3000]);
  eq('8.5 输出不包含未经声明的原始列', a1b.event_flow_name, undefined);

  // 无挂起事件 → 输出 null（该实例仍要出现，供左关联/回退使用）
  const onlyCancel = [{ event_instance_id: 'A009', jdy_op_time: 10, event_flow_name: '策略开通', event_current_assignee: '甲', event_created_count: 0, event_completed_count: 0, event_canceled_count: 1 }];
  const out3 = flows.runClean(node('pick_current_task', cfg), onlyCancel, {});
  ok('8.6 无挂起事件时仍输出该实例、节点/负责人为 null',
    out3.length === 1 && out3[0]['当前节点'] === null && out3[0]['当前负责人'] === null, JSON.stringify(out3));

  let err = null;
  try { flows.runClean(node('pick_current_task', {}), RIGHT, {}); } catch (e) { err = e; }
  ok('8.7 缺少实例分组键时报错', !!err && /实例分组键/.test(err.message), err && err.message);

  // 8.8 cutoffTime：A002 在切点 1200 时只看得到 1000 的客服处理
  const outCut = flows.runClean(node('pick_current_task', Object.assign({}, cfg, { cutoffTime: 1200 })), RIGHT, {});
  const a2c = outCut.find((r) => r.event_instance_id === 'A002');
  eq('8.8 cutoffTime：快照之后的取消事件不参与判定', a2c['当前节点'], '客服处理');

  // 8.9 nodeAlias：开始 → 销售签约
  const aliasRows = [{ event_instance_id: 'X1', jdy_op_time: 100, event_flow_name: '开始', event_current_assignee: '卢雪阳', event_created_count: 1, event_completed_count: 0, event_canceled_count: 0 }];
  const outAlias = flows.runClean(node('pick_current_task', Object.assign({}, cfg, { nodeAlias: '开始=销售签约' })), aliasRows, {});
  eq('8.9 nodeAlias 生效：开始 → 销售签约', outAlias[0]['当前节点'], '销售签约');
  eq('8.10 nodeAlias 不影响负责人', outAlias[0]['当前负责人'], '卢雪阳');
}

/* ══════════════════════════════════════════════════════════
 *  9. computed
 * ══════════════════════════════════════════════════════════ */
console.log('\n── 9. computed ──');
{
  const rows = [{ a: 1, b: 'x' }, { a: 2, b: 'y' }];
  const out = flows.runClean(node('computed', {
    assignments: '签约类型=标准签约\n源=a\n副本=copy:b\n显式=const:含=号的常量',
  }), rows, {});
  eq('9.1 常量列', out[0].签约类型, '标准签约');
  eq('9.2 copy 列', [out[0].副本, out[1].副本], ['x', 'y']);
  eq('9.3 const: 显式常量（值含 = 号）', out[0].显式, '含=号的常量');
  eq('9.4 原始列不受影响', [out[1].a, out[1].b], [2, 'y']);

  const rows2 = [{ 签约类型: '' }, { 签约类型: '已有值' }];
  const out2 = flows.runClean(node('computed', { assignments: '签约类型=默认值', onlyIfEmpty: true }), rows2, {});
  eq('9.5 onlyIfEmpty：空值才填', [out2[0].签约类型, out2[1].签约类型], ['默认值', '已有值']);

  const out3 = flows.runClean(node('computed', { assignments: '签约类型=默认值' }), rows2, {});
  eq('9.6 非 onlyIfEmpty：一律覆盖', [out3[0].签约类型, out3[1].签约类型], ['默认值', '默认值']);

  const out4 = flows.runClean(node('computed', {}), rows, {});
  eq('9.7 未配置列定义时原样返回', out4, rows);

  // coalesce：102 优先、否则回退 16（契约 §3.3 的回退规则）
  const fallback = [
    { flow_当前节点: '对接审核', 当前节点: null, flow_current_node: '旧节点' },
    { flow_当前节点: null, flow_current_node: '回退节点' },
    { flow_当前节点: '', flow_current_node: '' },
  ];
  const out5 = flows.runClean(node('computed', {
    assignments: '当前节点=coalesce:flow_当前节点,flow_current_node',
  }), fallback, {});
  eq('9.8 coalesce：首个非空值优先（102 覆盖 16）', out5[0].当前节点, '对接审核');
  eq('9.9 coalesce：102 为空时回退到备用列', out5[1].当前节点, '回退节点');
  eq('9.10 coalesce：全部为空时输出 null', out5[2].当前节点, null);

  // —— blankif：流程已结束（sys_flow_state_2=1）→ 当前节点/负责人置空（契约 §3.5 C3 规则1）——
  const ended = [
    { sys_flow_state_2: 0, 当前节点: '对接审核', 当前负责人: '曹诗卉' },
    { sys_flow_state_2: 1, 当前节点: '连锁使用', 当前负责人: '郑世伟' },
    { sys_flow_state_2: '1', 当前节点: '实施对接', 当前负责人: '戴丽沙' },
    { sys_flow_state_2: null, 当前节点: '客服处理', 当前负责人: '李慧' },
  ];
  const outBlank = flows.runClean(node('computed', {
    assignments: '当前节点=blankif:sys_flow_state_2:1\n当前负责人=blankif:sys_flow_state_2:1',
  }), ended, {});
  eq('9.11 blankif：流程结束(status=1) → 节点置空', outBlank[1].当前节点, '');
  eq('9.12 blankif：负责人同样置空', outBlank[1].当前负责人, '');
  eq('9.13 blankif：字符串 "1" 也认', outBlank[2].当前节点, '');
  eq('9.14 blankif：未命中状态时保留原值不动', outBlank[0].当前节点, '对接审核');
  eq('9.15 blankif：状态为空时保留原值', outBlank[3].当前节点, '客服处理');
  eq('9.16 blankif 多值：命中任一即置空', flows.runClean(node('computed', {
    assignments: 'v=blankif:s:1|2',
  }), [{ s: 2, v: 'x' }, { s: 3, v: 'y' }], {})[0].v, '');

  // —— parseAssignments：同一目标列可写多条，按顺序叠加 ——
  const multi = flows.parseAssignments(
    '当前节点=coalesce:flow_当前节点,flow_current_node\n当前节点=blankif:sys_flow_state_2:1'
  );
  eq('9.17 parseAssignments 保留重复目标列（对象式 kv 会覆盖）', multi.length, 2);
  eq('9.18 parseAssignments 保持书写顺序', multi.map((x) => x.spec.split(':')[0]), ['coalesce', 'blankif']);
  const chainRows = [
    { flow_当前节点: null, flow_current_node: '回退值', sys_flow_state_2: 0 },
    { flow_当前节点: '102值', flow_current_node: '回退值', sys_flow_state_2: 1 },
  ];
  const chained = flows.runClean(node('computed', {
    assignments: '当前节点=coalesce:flow_当前节点,flow_current_node\n当前节点=blankif:sys_flow_state_2:1',
  }), chainRows, {});
  eq('9.19 两段叠加：先 coalesce 回退，再按状态置空（未结束）', chained[0].当前节点, '回退值');
  eq('9.20 两段叠加：先 coalesce 命中 102，再按状态置空（已结束）', chained[1].当前节点, '');
}

/* ══════════════════════════════════════════════════════════
 *  10. on_push 选择逻辑
 * ══════════════════════════════════════════════════════════ */
console.log('\n── 10. on_push 触发选择 ──');
{
  const list = [
    // 通过 project_id 引用 16
    { id: 1, status: 1, run_mode: 'trigger', project_id: 16, nodes: '[]' },
    // 通过节点 source_project 引用 102
    { id: 2, status: 1, run_mode: 'trigger', project_id: null, nodes: JSON.stringify([{ id: 'a', type: 'source_project', config: { projectId: 102 } }]) },
    // 停用
    { id: 3, status: 0, run_mode: 'trigger', project_id: 16, nodes: '[]' },
    // 手动
    { id: 4, status: 1, run_mode: 'manual', project_id: 16, nodes: '[]' },
    // 定时
    { id: 5, status: 1, run_mode: 'cron', project_id: 102, nodes: '[]' },
    // trigger 但引用别的项目
    { id: 6, status: 1, run_mode: 'trigger', project_id: 992, nodes: '[]' },
    // publicFlow 形态（runMode + nodes 数组）
    { id: 7, status: 1, runMode: 'trigger', projectId: 16, nodes: [] },
    // 节点形态引用 16
    { id: 8, status: 1, run_mode: 'trigger', projectId: null, nodes: [{ id: 'b', type: 'source_project', config: { projectId: 16 } }] },
    // trigger 但源节点是 SQL，不引用项目
    { id: 9, status: 1, run_mode: 'trigger', projectId: null, nodes: [{ id: 'c', type: 'source_sql', config: { datasourceId: 0 } }] },
  ];
  eq('10.1 选择引用 16 的 trigger 流程', flows.selectOnPushFlows(list, 16).map((f) => f.id), [1, 7, 8]);
  eq('10.2 选择引用 102 的 trigger 流程', flows.selectOnPushFlows(list, 102).map((f) => f.id), [2]);
  eq('10.3 无引用时返回空数组', flows.selectOnPushFlows(list, 123456), []);
  eq('10.4 非法 projectId 返回空', flows.selectOnPushFlows(list, 0), []);
  ok('10.5 停用/手动/定时流程一律不触发',
    flows.selectOnPushFlows(list, 16).every((f) => f.id !== 3 && f.id !== 4 && f.id !== 5));
  eq('10.6 normalizeRunMode 兼容 on_push 写法', flows.normalizeRunMode('on_push'), 'trigger');
  eq('10.7 normalizeRunMode 非法值回落 manual', flows.normalizeRunMode('whatever'), 'manual');
}

/* ══════════════════════════════════════════════════════════
 *  11. 防重入闸门
 * ══════════════════════════════════════════════════════════ */
console.log('\n── 11. 防重入闸门 ──');
{
  flows.resetFlowRunGates();
  eq('11.1 首次可进入', flows.beginFlowRun(101, { now: 1000 }).started, true);
  eq('11.2 运行中重复触发被拦', flows.beginFlowRun(101, { now: 1100 }).reason, 'running');
  flows.endFlowRun(101, { now: 2000 });
  eq('11.3 冷却期内被拦', flows.beginFlowRun(101, { now: 3000 }).reason, 'cooldown');
  eq('11.4 冷却结束可再次进入', flows.beginFlowRun(101, { now: 6000 }).started, true);
  flows.endFlowRun(101, { now: 6000 });
  flows.resetFlowRunGates();
  eq('11.5 重置后可再次进入', flows.beginFlowRun(101, { now: 7000 }).started, true);
  flows.resetFlowRunGates();
}

/* ══════════════════════════════════════════════════════════
 *  12. triggerOnPush：异步、不阻塞、去重
 * ══════════════════════════════════════════════════════════ */
console.log('\n── 12. triggerOnPush 异步执行 ──');
(async () => {
  flows.resetFlowRunGates();
  const triggerFlows = [
    { id: 201, status: 1, run_mode: 'trigger', project_id: 16, nodes: '[]' },
    { id: 202, status: 1, run_mode: 'trigger', project_id: null, nodes: JSON.stringify([{ id: 'a', type: 'source_project', config: { projectId: 16 } }]) },
  ];
  const calls = [];
  let firstDone = false;
  const runner = (id, trigger) => {
    calls.push([id, trigger]);
    if (whichRun === 'slow') {
      return sleep(40).then(() => { firstDone = true; });
    }
    return Promise.resolve();
  };
  let whichRun = 'slow';

  const t0 = Date.now();
  const res = await flows.triggerOnPush(16, { flows: triggerFlows, runner, now: 10000 });
  const elapsed = Date.now() - t0;
  eq('12.1 匹配到 2 个流程', res.matched, [201, 202]);
  eq('12.2 触发 2 个流程', res.triggered, [201, 202]);
  ok('12.3 立即返回、不等流程跑完（异步不阻塞推送）', elapsed < 20 && !firstDone, `elapsed=${elapsed}ms done=${firstDone}`);

  const res2 = await flows.triggerOnPush(16, { flows: triggerFlows, runner, now: 10001 });
  eq('12.4 运行中重复推送被跳过', res2.skipped.map((s) => s.reason), ['running', 'running']);
  eq('12.5 重复推送不再触发', res2.triggered, []);

  await sleep(120);
  eq('12.6 异步执行器最终被调用且 trigger=push', calls, [[201, 'push'], [202, 'push']]);

  // 冷却期内再次推送 → 合并跳过
  const res3 = await flows.triggerOnPush(16, { flows: triggerFlows, runner, now: 10100 });
  eq('12.7 冷却期内再次推送被合并', res3.skipped.map((s) => s.reason), ['cooldown', 'cooldown']);

  // FLOW_ON_PUSH=0 应急开关
  process.env.FLOW_ON_PUSH = '0';
  const res4 = await flows.triggerOnPush(16, { flows: triggerFlows, runner, now: 20000 });
  ok('12.8 FLOW_ON_PUSH=0 时一律不触发', res4.disabled === true && res4.triggered.length === 0);
  delete process.env.FLOW_ON_PUSH;

  // 无匹配项目
  const res5 = await flows.triggerOnPush(999, { flows: triggerFlows, runner, now: 30000 });
  eq('12.9 无匹配流程时 triggered 为空', res5.triggered, []);

  flows.resetFlowRunGates();

  /* ══════════════════════════════════════════════════════════
   *  13. NODE_TYPES 定义 + runClean dispatch 接通
   * ══════════════════════════════════════════════════════════ */
  console.log('\n── 13. NODE_TYPES 与 dispatch ──');
  const byKey = {};
  flows.NODE_TYPES.forEach((n) => { byKey[n.key] = n; });
  ok('13.1 NODE_TYPES 含 join', !!byKey.join);
  ok('13.2 join 为清洗类节点且字段完整',
    byKey.join && byKey.join.category === 'clean' && byKey.join.fields.length >= 8,
    byKey.join && `category=${byKey.join.category} fields=${byKey.join.fields.length}`);
  ok('13.3 NODE_TYPES 含 pick_current_task 且为清洗类',
    !!byKey.pick_current_task && byKey.pick_current_task.category === 'clean');
  ok('13.4 pick_current_task 默认输出列名为当前节点/当前负责人',
    byKey.pick_current_task.fields.find((f) => f.key === 'outputNodeName').default === '当前节点' &&
    byKey.pick_current_task.fields.find((f) => f.key === 'outputOwnerName').default === '当前负责人');
  ok('13.5 NODE_TYPES 含 computed 且为清洗类',
    !!byKey.computed && byKey.computed.category === 'clean');
  ok('13.6 三个新节点都通过 NODE_MAP 注册',
    !!flows.NODE_MAP.join && !!flows.NODE_MAP.pick_current_task && !!flows.NODE_MAP.computed);
  ok('13.7 join/pick_current_task/computed 走纯函数 dispatch（runClean 同步返回）',
    Array.isArray(flows.runClean(node('computed', { assignments: 'x=1' }), [{}], {})));

  /* ══════════════════════════════════════════════════════════
   *  14. collectInput：concat 语义未被破坏 + join 左右归集
   * ══════════════════════════════════════════════════════════ */
  console.log('\n── 14. collectInput（concat 语义保持） ──');
  {
    const edges = [
      { from: 'src1', to: 'sink' },
      { from: 'src2', to: 'sink' },
    ];
    const outputs = { src1: [{ a: 1 }], src2: [{ a: 2 }, { a: 3 }] };
    const c1 = flows.collectInput({ id: 'sink', type: 'sink_table', config: {} }, edges, outputs);
    eq('14.1 普通节点多上游仍是拼接（concat）', c1.rows, [{ a: 1 }, { a: 2 }, { a: 3 }]);
    eq('14.2 普通节点不产生 inputs', Object.keys(c1.inputs), []);

    const joinEdges = [{ from: 'L', to: 'J' }, { from: 'R', to: 'J' }];
    const joinOutputs = { L: [{ k: '1' }], R: [{ k: '1' }, { k: '1' }] };
    const c2 = flows.collectInput({ id: 'J', type: 'join', config: {} }, joinEdges, joinOutputs);
    eq('14.3 join 按连线顺序：第一条进 left', c2.inputs.left, [{ k: '1' }]);
    eq('14.4 join 按连线顺序：第二条进 right', c2.inputs.right, [{ k: '1' }, { k: '1' }]);

    const c3 = flows.collectInput(
      { id: 'J', type: 'join', config: { leftSource: 'R', rightSource: 'L' } },
      joinEdges, joinOutputs
    );
    eq('14.5 join 支持 leftSource/rightSource 显式指定', [c3.inputs.left.length, c3.inputs.right.length], [2, 1]);

    const c4 = flows.collectInput({ id: 'J', type: 'join', config: {} }, [{ from: 'L', to: 'J' }], { L: [{ k: 1 }] });
    eq('14.6 join 只连一路时另一路为空数组', [c4.inputs.left.length, c4.inputs.right], [1, []]);
  }

  /* ══════════════════════════════════════════════════════════
   *  15. 时间解析与排序工具
   * ══════════════════════════════════════════════════════════ */
  console.log('\n── 15. 时间解析 / 排序 ──');
  {
    eq('15.1 timeOf 支持毫秒时间戳', flows.timeOf(1700000000000), 1700000000000);
    ok('15.2 timeOf 支持 YYYY-MM-DD HH:mm:ss', Number.isFinite(flows.timeOf('2026-10-30 15:00:33')));
    ok('15.3 timeOf 空值返回 NaN', Number.isNaN(flows.timeOf(null)) && Number.isNaN(flows.timeOf('')));
    const mixed = [{ t: '2026-10-30 15:00:33', v: 'b' }, { t: 1700000000000, v: 'a' }, { t: null, v: 'c' }];
    eq('15.4 sortByTime 混合格式升序（无法解析的前置）', flows.sortByTime(mixed, 't').map((r) => r.v), ['c', 'a', 'b']);
    eq('15.5 numOf 把空/非数字当 0', [flows.numOf(null), flows.numOf(''), flows.numOf('2'), flows.numOf('x')], [0, 0, 2, 0]);
  }

  /* ══════════════════════════════════════════════════════════
   *  16. push.js 解析列置空修复（契约 §3.5 C4）
   * ══════════════════════════════════════════════════════════ */
  console.log('\n── 16. push.js 解析列置空（C4 修复） ──');
  {
    const pushRouter = require('../src/routes/push');
    const cell = pushRouter.parsedCellOf;
    ok('16.1 push.js 导出了 parsedCellOf（推送分支调用的就是它）', typeof cell === 'function');

    // raw 缺失 → 不动（保证「只推部分字段」不会清空其他列）
    eq('16.2 raw === undefined（字段没来）→ 不写', cell(undefined, '任意').write, false);
    // raw 存在但解析为空 → 显式置空
    eq('16.3 raw="", 解析="" → 写空串置空',
      [cell('', '').write, cell('', '').value], [true, '']);
    eq('16.4 raw=[], 解析="" → 写空串置空（数组类被清空）',
      [cell([], '').write, cell([], '').value], [true, '']);
    eq('16.5 raw=null, 解析=null → 写空串置空',
      [cell(null, null).write, cell(null, null).value], [true, '']);
    eq('16.6 raw={}, 解析=null → 写空串置空',
      [cell({}, null).write, cell({}, null).value], [true, '']);
    // 正常值
    eq('16.7 正常值原样写入', [cell('周俊', '周俊').write, cell('周俊', '周俊').value], [true, '周俊']);
    eq('16.8 数字解析值转字符串', cell(123, 123).value, '123');
    // 长度截断（与原行为一致）
    eq('16.9 超过 500 字符截断', cell('x'.repeat(600), 'x'.repeat(600)).value.length, 500);

    // 语义对比：旧写法 vs 新写法
    const oldWay = (v) => (v !== null && v !== undefined && v !== '' ? { write: true, value: String(v) } : { write: false });
    eq('16.10 旧写法对「清空」不写 → 就是本次修复的 bug',
      oldWay('').write, false);
    eq('16.11 新写法对「清空」写空串 → 已修复', cell('', '').value, '');

    // 真实场景串起来：字段在报文里但被清空 → 解析列为 ''
    const overwrite = (rawFound, raw) => {
      const c = cell(rawFound ? raw : undefined, rawFound ? '' : undefined);
      const parsedMap = { p: '旧值' };
      if (c.write) parsedMap.p = c.value;
      return parsedMap.p;
    };
    eq('16.12 场景：字段被清空 → 解析列被置空（不再是旧值）', overwrite(true, ''), '');
    eq('16.13 场景：字段没出现在报文 → 解析列保留旧值', overwrite(false, undefined), '旧值');
  }

  /* ══════════════════════════════════════════════════════════
   *  汇总
   * ══════════════════════════════════════════════════════════ */
  console.log('\n════════════════════════════════════════');
  console.log(`总计 ${pass + fail} 项断言：PASS ${pass} / FAIL ${fail}`);
  if (fail) {
    console.log('失败项：');
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    console.log('════════════════════════════════════════');
    process.exit(1);
  }
  console.log('全部通过 ✅');
  console.log('════════════════════════════════════════');
})().catch((err) => {
  console.error('\n[测试脚本异常]', err && err.stack ? err.stack : err);
  process.exit(1);
});
