'use strict';

/**
 * V7 · 「当前节点 / 当前负责人」规则回测（只读本地 JSON，不连数据库）
 *
 * 用**引擎自身的节点函数**（flows.runPickCurrentTask / runJoin / runComputed）
 * 跑真实数据，与业务表（_work/v7data/xlsx_pos.json，59 列 × 96 行，第 57/58 列）
 * 逐行比对，验证契约 §3.5 C3 的规则命中率。
 *
 * 同时对比 mode='simple'（旧规则）以证明新规则确实更好。
 *
 * 运行：cd C:\Data\DSH\jdy-push && node scripts/v7-flow-pick-verify.js
 */

const fs = require('fs');
const path = require('path');
const flows = require('../src/flows');

const W = path.join(__dirname, '..', '_work', 'v7data');
const COL_NODE = 57;
const COL_OWNER = 58;

/** 业务表快照时刻：2026-10-30 23:30 北京 = 15:30 UTC（契约 §3.5 C3） */
const CUTOFF = Date.UTC(2026, 9, 30, 15, 30, 0);

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; failures.push(name); console.log(`FAIL  ${name}${detail ? ` → ${detail}` : ''}`); }
}

function readJson(f) {
  return JSON.parse(fs.readFileSync(path.join(W, f), 'utf8'));
}

/** 跑一遍规则，返回 { hit, total, dist, misses } */
function evaluate(opts) {
  const xlsx = readJson('xlsx_pos.json');
  const p16 = readJson('parsed16.json');
  const p102 = readJson('parsed102.json');

  const truth = new Map();
  xlsx.rows.forEach((r) => {
    truth.set(String(r[0]), {
      node: r[COL_NODE] === null || r[COL_NODE] === undefined ? '' : String(r[COL_NODE]),
      owner: r[COL_OWNER] === null || r[COL_OWNER] === undefined ? '' : String(r[COL_OWNER]),
    });
  });

  // ① pick_current_task（真实节点函数）
  const picked = flows.runPickCurrentTask({
    instanceKey: 'event_instance_id',
    timeColumn: 'jdy_op_time',
    mode: opts.mode,
    cutoffTime: opts.cutoff ? CUTOFF : '',
    selfCancelDisqualifies: !!opts.selfCancelDisq,
    createdCountColumn: 'event_created_count',
    completedCountColumn: 'event_completed_count',
    canceledCountColumn: 'event_canceled_count',
    nodeColumn: 'event_flow_name',
    ownerColumn: 'event_current_assignee',
    nodeAlias: opts.alias ? '开始=销售签约' : '',
    outputNodeName: '当前节点',
    outputOwnerName: '当前负责人',
  }, p102);

  // ② join(left)（真实节点函数）
  const joined = flows.runJoin({
    config: {
      joinType: 'left',
      leftKey: 'jdy_data_id',
      rightKey: 'event_instance_id',
      rightAgg: 'first',
      rightPrefix: 'flow_',
      rightFields: '当前节点,当前负责人',
    },
  }, p16, picked);

  // ③ computed：102 优先 → 回退 16 → 流程结束置空（真实节点函数）
  const assignments = [
    '当前节点=coalesce:flow_当前节点,flow_current_node',
    '当前负责人=coalesce:flow_当前负责人,flow_current_owner',
  ];
  if (opts.rule1) {
    assignments.push('当前节点=blankif:sys_flow_state_2:1');
    assignments.push('当前负责人=blankif:sys_flow_state_2:1');
  }
  const final = flows.runComputed({ assignments: assignments.join('\n') }, joined);

  const byId = new Map(final.map((r) => [String(r.jdy_data_id), r]));
  const dist = { from102: 0, fallback: 0, ended: 0, empty: 0 };
  const misses = [];
  let hit = 0;

  truth.forEach((want, id) => {
    const row = byId.get(id) || {};
    const gotNode = row['当前节点'] === null || row['当前节点'] === undefined ? '' : String(row['当前节点']);
    const gotOwner = row['当前负责人'] === null || row['当前负责人'] === undefined ? '' : String(row['当前负责人']);

    const fromFlow = row.flow_当前节点;
    if (fromFlow !== null && fromFlow !== undefined && String(fromFlow) !== '') dist.from102 += 1;
    else if (gotNode === '') dist.ended += 1;
    else dist.fallback += 1;
    if (gotNode === '' && gotOwner === '') dist.empty += 1;

    if (gotNode === want.node && gotOwner === want.owner) hit += 1;
    else if (misses.length < 5) {
      misses.push(`${id}  实际 ${gotNode || '空'}/${gotOwner || '空'}  期望 ${want.node || '空'}/${want.owner || '空'}`);
    }
  });

  return { hit, total: truth.size, dist, misses };
}

console.log('=== V7 「当前节点/当前负责人」规则回测（引擎节点函数 vs 业务表） ===\n');
console.log(`业务表快照：2026-10-30 23:30 北京（${CUTOFF} / ${new Date(CUTOFF).toISOString()}）\n`);

/* ---- 1. 契约 C3 正解 ---- */
const c3 = evaluate({ mode: 'pending', cutoff: true, rule1: true, alias: true });
console.log(`[1] C3 规则（pending + 切点 + 结束置空 + 别名）：${c3.hit}/${c3.total}`);
console.log(`    来源分布：来自102=${c3.dist.from102}  回退16=${c3.dist.fallback}  结束置空=${c3.dist.ended}`);
c3.misses.forEach((m) => console.log(`    ✗ ${m}`));
ok('1.1 C3 规则命中业务表 96/96', c3.hit === 96, `实际 ${c3.hit}`);
ok('1.2 当前节点/负责人全部非空或按规则置空（无遗漏行）', c3.dist.empty === 4, `空值行 ${c3.dist.empty}（应为 4 条流程结束）`);

/* ---- 2. 旧规则对比 ---- */
const simple = evaluate({ mode: 'simple', cutoff: true, rule1: true, alias: true });
console.log(`\n[2] 旧规则（simple）：${simple.hit}/${simple.total}`);
simple.misses.forEach((m) => console.log(`    ✗ ${m}`));
ok('2.1 旧规则命中率低于新规则（证明改写有效）', simple.hit < c3.hit, `simple=${simple.hit} vs pending=${c3.hit}`);

/* ---- 3. 各因素的必要性（去掉任一因素都会掉命中） ---- */
const noCutoff = evaluate({ mode: 'pending', cutoff: false, rule1: true, alias: true });
console.log(`\n[3] 去掉切点：${noCutoff.hit}/${noCutoff.total}`);
noCutoff.misses.forEach((m) => console.log(`    ✗ ${m}`));
ok('3.1 切点必要（去掉后命中下降）', noCutoff.hit < c3.hit, `无切点=${noCutoff.hit}`);

const noRule1 = evaluate({ mode: 'pending', cutoff: true, rule1: false, alias: true });
console.log(`\n[4] 去掉「流程结束置空」：${noRule1.hit}/${noRule1.total}`);
noRule1.misses.forEach((m) => console.log(`    ✗ ${m}`));
ok('4.1 结束置空必要（4 条已结束流程必须为空）', noRule1.hit < c3.hit, `无rule1=${noRule1.hit}`);

const noAlias = evaluate({ mode: 'pending', cutoff: true, rule1: true, alias: false });
console.log(`\n[5] 去掉节点别名：${noAlias.hit}/${noAlias.total}`);
noAlias.misses.forEach((m) => console.log(`    ✗ ${m}`));
ok('5.1 节点别名必要（开始→销售签约）', noAlias.hit < c3.hit, `无别名=${noAlias.hit}`);

/* ---- 4. Lead 举例的实例细查 ---- */
console.log('\n[6] 6adafffb 实例（Lead 举例：切点前后结论不同）');
{
  const p102 = readJson('parsed102.json');
  const p16 = readJson('parsed16.json');
  const xlsx = readJson('xlsx_pos.json');
  const id = [...new Set(p102.map((e) => String(e.event_instance_id)))]
    .find((k) => k.startsWith('6adafffb'));
  const truth = xlsx.rows.find((r) => String(r[0]) === id);
  const base = p16.find((r) => String(r.jdy_data_id) === id) || {};
  const cfg = {
    instanceKey: 'event_instance_id', timeColumn: 'jdy_op_time',
    nodeColumn: 'event_flow_name', ownerColumn: 'event_current_assignee',
    outputNodeName: '当前节点', outputOwnerName: '当前负责人',
  };
  const withCut = flows.runPickCurrentTask(Object.assign({}, cfg, {
    mode: 'pending', cutoffTime: CUTOFF,
  }), p102.filter((e) => String(e.event_instance_id) === id))[0];
  const noCut = flows.runPickCurrentTask(Object.assign({}, cfg, {
    mode: 'pending', cutoffTime: 9999999999999,
  }), p102.filter((e) => String(e.event_instance_id) === id))[0];

  console.log(`    业务表期望：${truth[COL_NODE]}/${truth[COL_OWNER]}`);
  console.log(`    有切点：${withCut['当前节点']}/${withCut['当前负责人']}`);
  console.log(`    无切点：${noCut['当前节点']}/${noCut['当前负责人']}`);
  ok('6.1 有切点时与业务表一致', withCut['当前节点'] === truth[COL_NODE] && withCut['当前负责人'] === truth[COL_OWNER]);
  ok('6.2 无切点时会取到快照之后的事件（证明切点必需）',
    noCut['当前节点'] !== truth[COL_NODE] || noCut['当前负责人'] !== truth[COL_OWNER]);
}

/* ---- 5. 同一行「创建即取消」两种口径在真实数据上的差异 ---- */
console.log('\n[7] 「创建即取消」自身是否失效——两种口径都跑一遍');
const strict = evaluate({ mode: 'pending', cutoff: true, rule1: true, alias: true, selfCancelDisq: false });
const cons = evaluate({ mode: 'pending', cutoff: true, rule1: true, alias: true, selfCancelDisq: true });
console.log(`    不含自身取消（C3 原文「其后」）：${strict.hit}/${strict.total}  来自102=${strict.dist.from102}`);
console.log(`    含自身取消（更保守）          ：${cons.hit}/${cons.total}  来自102=${cons.dist.from102}`);
ok('7.1 两种口径在本快照上都能 96/96（差异仅在边界实例）',
  strict.hit === 96 && cons.hit === 96, `strict=${strict.hit} cons=${cons.hit}`);
ok('7.2 默认口径 = C3 原文（不含自身取消）', strict.dist.from102 >= cons.dist.from102);

console.log('\n════════════════════════════════════════');
console.log(`总计 ${pass + fail} 项断言：PASS ${pass} / FAIL ${fail}`);
if (fail) {
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
}
console.log('全部通过 ✅');
console.log('════════════════════════════════════════');
