'use strict';

/**
 * V8 · 流程装配导入（flow 25「CRM签约对账表（16+102 合成）」）
 * ============================================================================
 * 干什么：把 `scripts/v7-flow-assembly.json` 里的装配定义幂等地写入 `jdywh_flows`
 *        （同 code 已存在则 UPDATE，不存在则 INSERT），供生产/本机重装与升级使用。
 *
 * 与 `scripts/v7-flow-import.js` 的关系（为什么不直接用它）：
 *   - v7 版**不改** `scripts/v7-*` 是本轮任务的硬约束，因此这里做独立实现；
 *   - 本版额外做 4 件事，都是生产上线前必须的：
 *     ① **清空 n3.cutoffTime**（该值是业务表快照时刻，留着会让「当前节点/负责人」永久冻结）；
 *     ② 导入前用 `flows.assertFlowSupported()` 校验节点类型都被当前服务端认识，
 *        不认识就**拒绝导入**并给出中文提示（避免把 V8 流程塞进 V6 服务端）；
 *     ③ 导入前校验装配引用的源列在 parsed_16/parsed_102 里真实存在（等价于 check-assembly）；
 *     ④ 导入后打印结构与「是否 trigger」核对，并可选 `--run` 立即跑一次。
 *
 * 安全：
 *   - 默认 **dry-run**，只读；`--apply` 才写库；
 *   - 写库前把**现有流程行完整备份**到 `_work/v8/flow/backup-flow-<ts>.json`（可精确回滚）；
 *   - 只动 `code='crm_signing_v7'` 这一个流程，不碰其它流程；
 *   - 不 DDL、不删表、不动目标表数据（`--run` 才会写目标表，且是 upsert）。
 *
 * 运行：
 *   node scripts/v8-flow-import.js                    # dry-run（默认）
 *   node scripts/v8-flow-import.js --apply            # 写入/更新流程定义
 *   node scripts/v8-flow-import.js --apply --run      # 写入后立即跑一次（会 upsert 目标表）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
try { require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env') }); } catch (e) { /* ignore */ }

const APPLY = process.argv.indexOf('--apply') >= 0;
const DO_RUN = process.argv.indexOf('--run') >= 0;
const ASSEMBLY = path.join(__dirname, 'v7-flow-assembly.json');
const BACKUP_DIR = path.join(ROOT, '_work', 'v8', 'flow');

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function columnsOf(db, table) {
  const rows = await db.query(`SHOW COLUMNS FROM \`${table}\``);
  return rows.map((r) => r.Field);
}

async function main() {
  console.log('=== V8 流程装配导入（16 + 102 → jdywh_crm_signing_v7） ===');
  console.log(`模式：${APPLY ? 'APPLY（会写库）' : 'dry-run（只读）'}${DO_RUN ? ' + 立即运行一次' : ''}\n`);

  if (!fs.existsSync(ASSEMBLY)) throw new Error(`找不到装配文件：${ASSEMBLY}`);
  const spec = JSON.parse(fs.readFileSync(ASSEMBLY, 'utf8'));

  /* ---------- 1. 生产口径修正：清空 cutoffTime ---------- */
  const n3 = (spec.nodes || []).find((n) => n.id === 'n3');
  if (n3 && n3.config && n3.config.cutoffTime) {
    console.log(`[fix] n3(${n3.type}).cutoffTime "${n3.config.cutoffTime}" → 清空`
      + '（该值是业务表快照时刻，留着会让推导永久冻结在 2026-10-30 23:30）');
    n3.config.cutoffTime = '';
  }
  const cutoffOk = !(n3 && n3.config && n3.config.cutoffTime);
  console.log(`  cutoffTime 已清空：${cutoffOk ? '是 ✅' : '否 ❌'}`);
  if (!cutoffOk) throw new Error('cutoffTime 清理失败，拒绝继续（会导致推导冻结）');

  console.log(`\n[spec] name=${spec.name}`);
  console.log(`       code=${spec.code}  runMode=${spec.runMode}  target=${spec.targetTable}`);
  console.log(`       nodes=${(spec.nodes || []).length}  edges=${(spec.edges || []).length}`);

  const db = require(path.join(ROOT, 'src', 'db'));
  const flows = require(path.join(ROOT, 'src', 'flows'));

  /* ---------- 2. 能力自检：节点类型必须都被当前服务端支持 ---------- */
  console.log('\n[1] 节点类型能力自检');
  const cap = flows.assertFlowSupported({ nodes: spec.nodes });
  if (!cap.ok) {
    console.error(`  ❌ ${cap.message}`);
    console.error('  拒绝导入：当前服务端不认识这些节点，导入了也跑不起来。请先部署新版 src/flows.js。');
    process.exit(1);
  }
  const known = new Set(flows.NODE_TYPES.map((n) => n.key));
  const used = [...new Set((spec.nodes || []).map((n) => n.type))];
  used.forEach((t) => console.log(`  OK   ${t}`));
  console.log(`  ${used.length} 种节点全部受支持（服务端共 ${known.size} 种）✅`);

  /* ---------- 3. 源列存在性（等价 check-assembly 的核心项） ---------- */
  console.log('\n[2] 装配引用列存在性');
  const c16 = new Set(await columnsOf(db, 'jdywh_parsed_16'));
  const c102 = new Set(await columnsOf(db, 'jdywh_parsed_102'));
  let missing = 0;

  const pct = (spec.nodes || []).find((n) => n.type === 'pick_current_task');
  const pcfg = pct.config || {};
  [['instanceKey', pcfg.instanceKey], ['timeColumn', pcfg.timeColumn],
    ['createdCountColumn', pcfg.createdCountColumn], ['completedCountColumn', pcfg.completedCountColumn],
    ['canceledCountColumn', pcfg.canceledCountColumn],
    ['nodeColumn', pcfg.nodeColumn], ['ownerColumn', pcfg.ownerColumn],
  ].forEach(([k, v]) => {
    const hasTile = c102.has(v);
    if (!hasTile) { missing += 1; console.log(`  MISS ${k}=${v}（parsed_102 无此列）`); }
  });
  console.log(`  pick_current_task 引用的 7 个 102 列：${missing ? `${missing} 个缺失` : '全部存在 ✅'}`);

  const sfn = (spec.nodes || []).find((n) => n.type === 'select_fields');
  const keep = String(sfn.config.fields || '').split(',').map((s) => s.trim()).filter(Boolean);
  const generated = new Set();
  (spec.nodes || []).filter((n) => n.type === 'computed').forEach((cp) => {
    String(cp.config.assignments || '').split('\n').forEach((line) => {
      const i = line.indexOf('=');
      if (i > 0) generated.add(line.slice(0, i).trim());
    });
  });
  const missKeep = keep.filter((c) => !generated.has(c) && !c16.has(c));
  if (missKeep.length) { missing += missKeep.length; console.log(`  MISS select_fields: ${missKeep.join(', ')}`); }
  console.log(`  select_fields 保留 ${keep.length} 列；${missKeep.length ? `${missKeep.length} 个在 parsed_16 缺失` : '全部可得 ✅'}`);

  const jn = (spec.nodes || []).find((n) => n.type === 'join');
  if (!c16.has(jn.config.leftKey)) { missing += 1; console.log(`  MISS join.leftKey=${jn.config.leftKey}`); }
  if (!c102.has(jn.config.rightKey)) { missing += 1; console.log(`  MISS join.rightKey=${jn.config.rightKey}`); }
  console.log(`  join 关联键：${c16.has(jn.config.leftKey) ? 'OK' : 'MISS'} ${jn.config.leftKey} → `
    + `${c102.has(jn.config.rightKey) ? 'OK' : 'MISS'} ${jn.config.rightKey}`);

  if (missing) {
    console.error(`\n❌ 共 ${missing} 处引用缺失，拒绝导入。`);
    process.exit(1);
  }
  console.log('  ✅ 装配引用全部有效');

  /* ---------- 4. 现状对比 ---------- */
  const nodesJson = JSON.stringify(spec.nodes || []);
  const edgesJson = JSON.stringify(spec.edges || []);
  const existing = await db.query(
    'SELECT id, name, code, run_mode, status, project_id, nodes, edges, updated_at FROM jdywh_flows WHERE code = ?',
    [spec.code]
  );
  console.log(`\n[3] 库中同 code 流程：${existing.length ? `id=${existing[0].id}（run_mode=${existing[0].run_mode}, status=${existing[0].status}）` : '不存在（将新建）'}`);
  if (existing.length) {
    const cur = existing[0];
    const sameNodes = String(cur.nodes || '') === nodesJson;
    const sameEdges = String(cur.edges || '') === edgesJson;
    console.log(`    nodes 与规格一致：${sameNodes ? '是' : '否（将被更新）'}；edges 一致：${sameEdges ? '是' : '否'}`);
    console.log(`    run_mode：${cur.run_mode} → ${spec.runMode}`);
  }

  if (!APPLY) {
    console.log(`\n[dry-run] 将 ${existing.length ? `UPDATE id=${existing[0].id}` : 'INSERT'} 流程定义。`);
    console.log('  重跑并加 --apply 才会写库。');
    return 0;
  }

  /* ---------- 5. 写入前备份 ---------- */
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(BACKUP_DIR, `backup-flow-${ts()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    takenAt: new Date().toISOString(),
    reason: 'v8-flow-import --apply 前备份（含 nodes/edges 全文，可精确回滚）',
    rows: existing,
  }, null, 1));
  console.log(`\n[4] 已备份现有流程行 → ${path.relative(ROOT, backupPath)}`);

  /* ---------- 6. 写入 ---------- */
  if (existing.length) {
    await db.query(
      'UPDATE jdywh_flows SET name=?, nodes=?, edges=?, run_mode=?, project_id=?, status=1, updated_at=NOW() WHERE id=?',
      [spec.name, nodesJson, edgesJson, spec.runMode, spec.projectId || null, existing[0].id]
    );
    flows.invalidateTriggerFlowCache();
    console.log(`[5] UPDATED flow id=${existing[0].id}（已失效 trigger 缓存）`);
  } else {
    const r = await db.query(
      `INSERT INTO jdywh_flows (name, code, nodes, edges, run_mode, project_id, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,1,NOW(),NOW())`,
      [spec.name, spec.code, nodesJson, edgesJson, spec.runMode, spec.projectId || null]
    );
    flows.invalidateTriggerFlowCache();
    console.log(`[5] INSERTED flow id=${r.insertId}`);
  }

  /* ---------- 7. 回读校验 ---------- */
  const after = await db.query(
    'SELECT id, name, code, run_mode, status, project_id, nodes, edges FROM jdywh_flows WHERE code = ?',
    [spec.code]
  );
  const f = after[0];
  const chk = flows.assertFlowSupported(f);
  const an3 = JSON.parse(f.nodes).find((n) => n.id === 'n3');
  console.log('\n[6] 回读校验');
  console.log(`    id=${f.id}  run_mode=${f.run_mode}  status=${f.status}  project_id=${f.project_id}`);
  console.log(`    nodes=${JSON.parse(f.nodes).length}  edges=${JSON.parse(f.edges).length}`);
  console.log(`    n3.cutoffTime="${(an3.config || {}).cutoffTime}"（必须为空）`);
  console.log(`    能力自检：${chk.ok ? '通过 ✅' : '失败 ❌ ' + chk.message}`);

  const verifyOk = f.run_mode === spec.runMode
    && Number(f.status) === 1
    && JSON.parse(f.nodes).length === spec.nodes.length
    && JSON.parse(f.edges).length === spec.edges.length
    && !(an3.config || {}).cutoffTime
    && chk.ok;
  console.log(`    导入结果：${verifyOk ? '✅ 全部符合预期' : '❌ 有偏差'}`);

  /* ---------- 8. 可选：立即运行 ---------- */
  if (DO_RUN) {
    console.log('\n[7] 立即运行一次（会 upsert 目标表）');
    const t0 = Date.now();
    const res = await flows.run(f.id, 'manual');
    console.log(`    ok=${res.ok}  ${Date.now() - t0}ms  message=${res.message}`);
    const cnt = await db.query(`SELECT COUNT(*) AS n FROM \`${spec.targetTable}\``);
    console.log(`    ${spec.targetTable} 行数：${cnt[0].n}`);
    if (!res.ok) process.exit(1);
  }

  return verifyOk ? 0 : 1;
}

main()
  .then((code) => process.exit(code || 0))
  .catch((err) => {
    console.error('\n[导入失败]', err && err.message ? err.message : err);
    process.exit(1);
  });
