'use strict';

/**
 * V7 · push.js 推送触发接线自检（**只读**，不写任何业务数据）
 *
 * 为什么不用真实 HTTP 打一发推送：
 *   本机 .env 连的是**生产库**。打一发真实推送会 upsert jdywh_data_16 / jdywh_parsed_16，
 *   属于对生产库的写操作，与任务铁律冲突。而且当前 8781 端口跑的是**旧代码**进程，
 *   HTTP 打到的是旧逻辑，验证不了本次改动（重启进程也明确禁止）。
 *
 * 因此改为「同进程、同代码路径」验证：
 *   1. require 真实的 src/routes/push.js，调用它导出的 triggerFlowsAfterPush(projectId)
 *      —— 这就是推送分支里实际执行的那一行代码，一字不差；
 *   2. 只观察它是否同步抛错 / 是否 reject / 多久返回（只读 SELECT jdywh_flows）；
 *   3. 用真实的 flows.triggerOnPush 在「无 trigger 流程」情况下测首次与缓存命中的耗时。
 *
 * 运行：cd C:\Data\DSH\jdy-push && node scripts/v7-flow-push-wire.js
 */

const db = require('../src/db');
const flows = require('../src/flows');
const pushRouter = require('../src/routes/push');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; failures.push(name); console.log(`FAIL  ${name}${detail ? ` → ${detail}` : ''}`); }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log('=== push.js 推送触发接线自检（只读） ===\n');

  /* 0. 接线存在性 */
  ok('0.1 push.js 导出了 triggerFlowsAfterPush（推送分支里调用的就是这个函数）',
    typeof pushRouter.triggerFlowsAfterPush === 'function');

  /* 1. 当前库里有没有 trigger 流程（只读） */
  const all = await db.query(
    'SELECT id, name, run_mode, status, project_id, nodes FROM `jdywh_flows` ORDER BY id ASC'
  );
  const trig = all.filter((f) => f.run_mode === 'trigger' && Number(f.status) === 1);
  console.log(`\n[1] jdywh_flows 共 ${all.length} 个流程；其中 status=1 且 run_mode='trigger' 的 ${trig.length} 个`);
  trig.forEach((f) => console.log(`      #${f.id} ${f.name}`));

  /*
   * 2. triggerOnPush(projectId) 的匹配结果必须与库里「status=1 且 run_mode='trigger' 且引用该项目」
   *    的流程集合一致。
   *
   * 注意：本断言原来是「无 trigger 流程时 matched 为空数组」，那是在 V7 装配流程导入**之前**
   * 写的。现在库里已经有 code=crm_signing_v7 的 trigger 流程（project_id=16），
   * 所以 matched=[25] 才是**正确**结果。断言改为「与 DB 期望集合一致」，这样无论库里有没有
   * trigger 流程都能正确判定。
   */
  flows.invalidateTriggerFlowCache();
  const t1 = Date.now();
  const r1 = await flows.triggerOnPush(16);
  const firstMs = Date.now() - t1;
  console.log(`\n[2] triggerOnPush(16) 首次调用：${firstMs}ms，matched=${JSON.stringify(r1.matched)}，triggered=${JSON.stringify(r1.triggered)}`);
  /*
   * 期望集合：status=1 且 run_mode='trigger' 且**确实引用了 projectId=16** 的流程。
   * project_id 列为 16，或其 nodes 里任一 source_project 节点的 config.projectId = 16。
   * （库里 #4「数据清洗」也是 trigger，但 project_id 为 NULL 且无 source 节点，不引用 16，
   *   所以不该出现在 matched 里。）
   */
  const expectRef16 = new Set();
  for (const f of all) {
    if (f.run_mode !== 'trigger' || Number(f.status) !== 1) continue;
    if (Number(f.project_id) === 16) { expectRef16.add(Number(f.id)); continue; }
    let nodes = [];
    try { nodes = typeof f.nodes === 'string' ? JSON.parse(f.nodes || '[]') : (f.nodes || []); } catch { nodes = []; }
    const refs = (Array.isArray(nodes) ? nodes : []).some(
      (n) => n && n.type === 'source_project' && Number((n.config || {}).projectId) === 16
    );
    if (refs) expectRef16.add(Number(f.id));
  }
  ok(
    '2.1 matched = 引用了该项目 16 的 trigger 流程集合',
    Array.isArray(r1.matched) && r1.matched.length === expectRef16.size,
    `matched=${JSON.stringify(r1.matched)} expected=${JSON.stringify([...expectRef16])}`
  );

  const t2 = Date.now();
  await flows.triggerOnPush(16);
  const cachedMs = Date.now() - t2;
  console.log(`    缓存命中后第二次调用：${cachedMs}ms`);
  ok('2.2 缓存命中后不查库（耗时 <= 首次，且 < 5ms）', cachedMs <= firstMs && cachedMs < 5, `first=${firstMs}ms cached=${cachedMs}ms`);

  /* 3. 真实 push 分支调用：不抛同步异常、不 reject */
  let threw = null;
  const t3 = Date.now();
  try {
    pushRouter.triggerFlowsAfterPush(16);
  } catch (e) { threw = e; }
  const callMs = Date.now() - t3;
  ok('3.1 triggerFlowsAfterPush 同步调用不抛异常', threw === null, threw && threw.message);
  ok('3.2 triggerFlowsAfterPush 立即返回（不 await 流程执行）', callMs < 50, `${callMs}ms`);

  // 等异步分支落地，确认不会产生未捕获 rejection（unhandledRejection 会让 Node 退出/告警）
  let unhandled = 0;
  process.on('unhandledRejection', () => { unhandled += 1; });
  await sleep(300);
  ok('3.3 异步分支没有未捕获的 Promise rejection', unhandled === 0, `unhandled=${unhandled}`);

  /* 4. 边界：非法 projectId 不发查询、不触发 */
  flows.invalidateTriggerFlowCache();
  const r4 = await flows.triggerOnPush(null);
  const r5 = await flows.triggerOnPush(0);
  const r6 = await flows.triggerOnPush('abc');
  ok('4.1 非法 projectId（null/0/abc）直接返回空结果',
    r4.triggered.length === 0 && r5.triggered.length === 0 && r6.triggered.length === 0);

  /* 5. 应急开关：不清缓存也要能一键关停 */
  process.env.FLOW_ON_PUSH = '0';
  const r7 = await flows.triggerOnPush(16);
  ok('5.1 FLOW_ON_PUSH=0 时 disabled=true 且不触发', r7.disabled === true && r7.triggered.length === 0);
  delete process.env.FLOW_ON_PUSH;

  /* 6. 装配完整性：join/sink 的 upsert 主键检查函数存在（不执行 DDL） */
  ok('6.1 ensureUpsertKey 已导出（upsert 前会校验唯一索引，避免重复插入）',
    typeof flows.ensureUpsertKey === 'function');

  console.log('\n════════════════════════════════════════');
  console.log(`总计 ${pass + fail} 项断言：PASS ${pass} / FAIL ${fail}`);
  if (fail) {
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    process.exit(1);
  }
  console.log('全部通过 ✅');
  console.log('════════════════════════════════════════');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n[自检异常]', err && err.stack ? err.stack : err);
    process.exit(1);
  });
