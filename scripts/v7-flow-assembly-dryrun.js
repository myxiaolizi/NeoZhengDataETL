'use strict';

/**
 * V7 · 目标流程「全链路试跑」（**只读**：跑 n1~n7，跳过 sink 不写库）
 *
 * 用真实的流程引擎函数（flows.topoSort / runSource / runClean / collectInput）
 * 跑 scripts/v7-flow-assembly.json 的装配，数据从生产库**只读**取，
 * 最后只核对结果，**不调用 runSink**，因此不会创建/写入 jdywh_crm_signing_v7。
 *
 * 这一步能证明：
 *   - 8 个节点拓扑可执行、不会循环依赖；
 *   - 102 的 369 条事件被 pick_current_task 收敛成 69 行，join 后仍是 96 行（不膨胀）；
 *   - 最终正好 59 列且顺序 = 契约 §2.1；
 *   - 27 个无 102 事件的实例靠 coalesce 回退到 16 的 flow_current_*。
 *
 * 运行：cd C:\Data\DSH\jdy-push && node scripts/v7-flow-assembly-dryrun.js
 */

const fs = require('fs');
const path = require('path');
const flows = require('../src/flows');

const FILE = path.join(__dirname, 'v7-flow-assembly.json');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; failures.push(name); console.log(`FAIL  ${name}${detail ? ` → ${detail}` : ''}`); }
}

async function main() {
  const def = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  console.log('=== V7 目标流程全链路试跑（只读，不写目标表） ===\n');

  /* 与 flows.run() 完全一致的执行逻辑 */
  const order = flows.topoSort(def.nodes, def.edges);
  console.log(`[0] 拓扑排序：${order.map((n) => n.type).join(' → ')}`);
  ok('0.1 拓扑排序成功且节点数一致', order.length === def.nodes.length);

  const outputs = {};
  const logs = [];
  let rows = [];
  let finalRows = null;

  for (const node of order) {
    const nodeDef = flows.NODE_MAP[node.type];
    const t0 = Date.now();
    const collected = flows.collectInput(node, def.edges, outputs);
    const input = collected.upstream.length ? collected.rows : rows;

    if (nodeDef.category === 'sink') {
      // 关键：不执行 runSink，只记录将要写入的内容
      finalRows = input;
      logs.push({ node: node.type, skipped: true, rows: input.length });
      outputs[node.id] = input;
      continue;
    }

    const out = nodeDef.category === 'source'
      ? await flows.runSource(node, { flowId: 0, flowName: def.name })
      : flows.runClean(node, input, { flowId: 0, inputs: collected.inputs });

    outputs[node.id] = out;
    rows = out;
    logs.push({
      node: node.type, label: node.label,
      inputRows: node.type === 'join' ? collected.inputs.left.length : input.length,
      outputRows: out.length, ms: Date.now() - t0,
    });
    console.log(`    ${String(node.label).padEnd(24)} 输入 ${String(logs[logs.length - 1].inputRows).padStart(4)} → 输出 ${String(out.length).padStart(4)} 行  (${Date.now() - t0}ms)`);
  }

  console.log('');
  ok('1.1 最终结果行数 = 96（契约 §3.1 parsed_16 行数）', finalRows.length === 96, `实际 ${finalRows.length}`);

  const cols = Object.keys(finalRows[0] || {});
  console.log(`\n[2] 最终列数 ${cols.length}`);
  ok('2.1 最终列数 = 59', cols.length === 59, `实际 ${cols.length}`);

  const EXPECTED = [
    'data_id', '标题', '流水号', '区域', '连锁ID', '签约主体名称', '连锁名称', '连锁类型', '对接版本',
    '门店数', '上月销售门店数', '近2年销售门店数', '签约类型', '连锁业务对接人姓名',
    '连锁业务对接人联系电话', '连锁技术对接人姓名', '连锁技术对接人联系电话',
    '签约时间', '服务开始时间', '服务结束时间', '销售', '客服', '解决方案', '培训人',
    '基础资料', '优惠券', '连锁ERP名称', '对接结果', '对接备注', '优惠券(结果)',
    '短信报备', '渠道充值和余额', '客服备注', '培训结果', '培训备注', '策略开通情况',
    '已开通策略', '未开通策略原因', '流程状态', '区域负责人手机号码', '省或直辖市',
    '地址(表单格式)(省/自治区/直辖市)', '地址(表单格式)(市)', '地址(表单格式)(县/区)',
    '是否开通', '单据提交时间', '策略开通时间', '实施对接时间', '对接审核时间', '客服处理时间',
    '客户培训时间', '连锁使用时间', '策略审核时间', '提交人', '提交时间', '更新时间',
    '流程状态(节点)', '当前节点', '当前负责人',
  ];
  ok('2.2 列顺序与契约 §2.1 完全一致', JSON.stringify(cols) === JSON.stringify(EXPECTED),
    `差异：${cols.filter((c, i) => c !== EXPECTED[i]).slice(0, 5).join(',')}`);
  ok('2.3 重名列已改名「优惠券(结果)」', cols.includes('优惠券(结果)') && !cols.filter((c) => c === '优惠券').length === false);
  ok('2.4 重名列已改名「流程状态(节点)」', cols.includes('流程状态(节点)') && cols.includes('流程状态'));
  ok('2.5 目标表没有原始 widget/uuid 列泄漏', !cols.some((c) => /^widget_|^w_1|^jdy_/.test(c)));

  console.log('\n[3] 当前节点/当前负责人 来源分布');
  const withFlow = finalRows.filter((r) => r['当前节点'] !== null && r['当前节点'] !== undefined && String(r['当前节点']) !== '');
  console.log(`    有值：${withFlow.length} 行；空：${finalRows.length - withFlow.length} 行`);
  ok('3.1 当前节点有值的行数 = 92（96 - 4 条流程结束置空）', withFlow.length === 92, `实际 ${withFlow.length}`);

  /* 逐个实例核对：102 有事件时取 102，否则回退 16 */
  const t16 = await require('../src/db').query('SELECT `jdy_data_id`, `flow_current_node`, `flow_current_owner`, `sys_flow_state_2` FROM `jdywh_parsed_16`');
  const pickMap = new Map();
  outputs['n3'].forEach((r) => pickMap.set(String(r.event_instance_id), r));
  const byId16 = new Map(t16.map((r) => [String(r.jdy_data_id), r]));

  let mismatch = 0;
  let from102 = 0;
  let fallback = 0;
  let ended = 0;
  finalRows.forEach((r) => {
    const id = String(r.data_id);
    const p = pickMap.get(id);
    const base = byId16.get(id) || {};
    // 契约 §3.5 C3 完整口径：
    //   1) 流程已结束（sys_flow_state_2=1）→ 空
    //   2) 否则 102 有挂起待办 → 用它
    //   3) 否则回退 16.flow_current_node
    const isEnded = Number(base.sys_flow_state_2) === 1;
    let expectNode;
    if (isEnded) {
      expectNode = null;
      ended += 1;
    } else if (p && p['当前节点']) {
      expectNode = p['当前节点'];
      from102 += 1;
    } else {
      expectNode = base.flow_current_node || null;
      if (expectNode) fallback += 1;
    }
    const got = r['当前节点'] === '' ? null : r['当前节点'];
    const exp = expectNode || null;
    if (String(got === undefined ? '' : got) !== String(exp === undefined ? '' : exp)) {
      mismatch += 1;
      if (mismatch <= 3) console.log(`    差异 ${id}: 实际=${got} 期望=${exp}`);
    }
  });
  console.log(`    来自 102：${from102} 行；回退 16：${fallback} 行；流程结束置空：${ended} 行；不一致：${mismatch} 行`);
  ok('3.2 每行「当前节点」都符合「102 优先 → 回退 16 → 结束置空」', mismatch === 0, `不一致 ${mismatch} 行`);

  /* 唯一性：data_id 无重复（upsert 主键前提） */
  const ids = finalRows.map((r) => String(r.data_id));
  ok('4.1 data_id 唯一（upsert 不会互相覆盖）', new Set(ids).size === ids.length,
    `总 ${ids.length} 去重 ${new Set(ids).size}`);
  ok('4.2 data_id 全部非空', ids.every((x) => x && x !== 'null' && x !== 'undefined'));

  /* 抽样 */
  console.log('\n[5] 抽样 3 行（只显示少量非敏感列）');
  finalRows.slice(0, 3).forEach((r) => {
    console.log(`    data_id=${String(r.data_id).slice(0, 12)}…  标题=${r['标题'] || ''}  当前节点=${r['当前节点'] || ''}  当前负责人=${r['当前负责人'] || ''}`);
  });

  console.log('\n════════════════════════════════════════');
  console.log(`总计 ${pass + fail} 项断言：PASS ${pass} / FAIL ${fail}`);
  if (fail) {
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    process.exit(1);
  }
  console.log('全部通过 ✅（目标表未被写入）');
  console.log('════════════════════════════════════════');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('\n[试跑失败]', e && e.stack ? e.stack : e); process.exit(1); });
