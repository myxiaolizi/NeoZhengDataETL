'use strict';

/**
 * V9 · 节点提交时间历史数据修正（**默认 dry-run，--apply 才写库**）
 *
 * 背景（用户 2026-10-31 投诉）
 * ---------------------------
 *   「当前测试节点215已进入对接审核但是没有实施对接时间」
 *   「实际因为当前节点提交，进入下一节点时就要自动同步当前节点的提交时间」
 *
 * 口径
 * ----
 *   用 `src/flow-state.js::deriveNodeTimes()` 从流程事件流（jdywh_parsed_102）推导
 *   8 个节点的提交时间，然后：
 *     · 推导值非空 且 parsed_16 单元格为空   → **补写**
 *     · 推导值为空                          → 不写
 *     · parsed_16 已有非空值                → **不写**（简道云时间自动化推来的值更权威，
 *                                              历史上覆盖导致过命中率暴跌与清空事故）
 *   补完 parsed_16 后**重跑 flow 25**，把宽表 jdywh_crm_signing_v7 跟上。
 *
 * 用法
 * ----
 *   node scripts/v9-sync-node-times.js               # dry-run（打印摘要，不写库、不跑流程）
 *   node scripts/v9-sync-node-times.js --apply       # 备份 → 写库 → 重跑 flow 25 → 复核
 *   node scripts/v9-sync-node-times.js --apply --force-backfill   # 连历史行也补（会让解析表偏离业务表快照，先看 dry-run）
 *   node scripts/v9-sync-node-times.js --apply --no-flow-run   # 只补 parsed_16，不重跑流程
 *   node scripts/v9-sync-node-times.js --limit=5     # 只处理前 N 行（联调用）
 *
 * ⚠️ 新鲜度闸门（与 src/flow-ingest.js 同一口径）
 * ------------------------------------------------------------------
 * 8 个时间列的业务权威来源是简道云「时间自动化」字段原值。V8 对账与 V9 复测都证明：
 * 把**历史行**的空位用事件推导值补上，会让解析表与业务表快照永久发散
 * （v8-flow-verify 的「非 fresh 行逐格 0 差异」会立刻出现 8 格差异）。
 * 因此默认只补「最近 FLOW_SYNC_NODE_TIMES_WINDOW_MS（默认 10 分钟）内仍有推送」的实时行；
 * 历史行必须显式 `--force-backfill`。
 *
 * 安全
 * ----
 *   · 写库前把**受影响行的全部列原值**备份到 `_work/v9/backup-<ts>.json`（含宽表时间列快照）；
 *   · UPDATE 语句内再判一次「当前为空」才写（二次保护，绝不覆盖非空值）；
 *   · 结束时打印备份路径 + 前后指纹 + 8 列非空率对比 + 215 的修复前后对比。
 *
 * 退出码：0 = 正常完成（含 dry-run）；1 = 出现异常或复核未通过。
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config();

const db = require('../src/db');
const flowState = require('../src/flow-state');
const flows = require('../src/flows');
const schema = require('../src/schema');

const TIME_FIELDS = Object.values(flowState.TIME_FIELD_OF_NODE);
const P16 = 'jdywh_parsed_16';
const P102 = 'jdywh_parsed_102';
const WIDE = 'jdywh_crm_signing_v7';
const WIDE_FLOW_ID = 25;
const SERIAL_SN = '215';
const REPORT_DIR = path.join(process.cwd(), '_work', 'v9');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const NO_FLOW_RUN = argv.includes('--no-flow-run');
const FORCE_BACKFILL = argv.includes('--force-backfill');
const limitArg = argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Math.max(0, Number(limitArg.split('=')[1]) || 0) : 0;

/** 与 src/flow-ingest.js 同一口径的新鲜度窗口 */
const FRESH_MS = (() => {
  const v = Number(process.env.FLOW_SYNC_NODE_TIMES_WINDOW_MS);
  return Number.isFinite(v) && v >= 0 ? v : 10 * 60 * 1000;
})();

const stamp = () => {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().replace('T', '-').replace(/[:.]/g, '').slice(0, 17);
};

/** 动态解析 8 个时间列（按 COLUMN_COMMENT = 'X(解析)'） */
async function resolveTimeColumns(table) {
  const rows = await db.query(
    `SELECT column_name, column_comment
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?`,
    [table]
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

const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

/** 8 个时间列的非空计数 */
async function fillCounts(table, colOf) {
  const sql = `SELECT ${TIME_FIELDS.filter((f) => colOf[f])
    .map((f) => `SUM(CASE WHEN \`${colOf[f]}\` IS NOT NULL AND \`${colOf[f]}\` <> '' THEN 1 ELSE 0 END) AS \`${f}\``)
    .join(', ')} FROM \`${table}\``;
  return db.queryOne(sql);
}

/** 全表 8 个时间列指纹（用于证明 dry-run 没写库） */
async function fingerprint(colOf) {
  const exprs = TIME_FIELDS.filter((f) => colOf[f])
    .map((f) => `CONCAT_WS('=', \`${f}\`_x, IFNULL(\`${colOf[f]}\`,'∅'))`);
  // 直接用 md5(group_concat(...)) 对整表做指纹
  const sql = `SELECT COUNT(*) AS n,
                      MD5(GROUP_CONCAT(x ORDER BY x SEPARATOR '\\n')) AS h FROM (
                 SELECT CONCAT_WS('|', jdy_data_id,
                        ${TIME_FIELDS.filter((f) => colOf[f]).map((f) => `IFNULL(\`${colOf[f]}\`,'∅')`).join(',\n                        ')}) AS x
                   FROM \`${P16}\`) t`;
  const r = await db.queryOne(sql);
  return { rows: Number(r.n), hash: r.h };
}

async function loadEventsByInstance() {
  const rows = await db.query(
    `SELECT id, event_instance_id, jdy_op_time, header_created_at, event_flow_name,
            event_finish_action, event_created_count, event_completed_count,
            event_canceled_count, event_current_assignee
       FROM \`${P102}\`
      ORDER BY event_instance_id, jdy_op_time, id`
  );
  const map = new Map();
  for (const r of rows) {
    const k = String(r.event_instance_id);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

async function main() {
  console.log('══════════════════════════════════════════════════════════════');
  console.log(' V9 · 节点提交时间历史同步');
  console.log(` 模式: ${APPLY ? '*** APPLY（会写库）***' : 'dry-run（不写库）'}`);
  console.log(` 时间: ${new Date().toISOString()}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  /* ---- 1. 列解析 ---- */
  const { map: colOf, byComment } = await resolveTimeColumns(P16);
  const missing = TIME_FIELDS.filter((f) => !colOf[f]);
  if (missing.length) {
    console.error(`[FAIL] 解析表缺少时间列: ${missing.join(', ')}`);
    process.exit(1);
  }
  const serialCol = byComment.get('流水号');
  console.log('【1】时间列映射（按 COLUMN_COMMENT 动态解析）');
  TIME_FIELDS.forEach((f) => console.log(`     ${f} → ${colOf[f]}`));
  console.log(`     流水号 → ${serialCol || '(未找到)'}\n`);

  /* ---- 2. 事件 + 逐行推导 ---- */
  const events = await loadEventsByInstance();
  const rows = await db.query(
    `SELECT jdy_data_id, ${serialCol ? `\`${serialCol}\` AS sn,` : "'' AS sn,"}
            jdy_op_time AS op_time, flow_current_node AS cur, sys_flow_state_2 AS st,
            ${TIME_FIELDS.map((f) => `\`${colOf[f]}\` AS \`${f}\``).join(', ')}
       FROM \`${P16}\`
      ORDER BY ${serialCol ? `\`${serialCol}\`` : 'jdy_data_id'}`
  );
  console.log(`【2】parsed_16 ${rows.length} 行；parsed_102 ${events.size} 个实例\n`);

  const changes = [];     // { dataId, sn, field, column, from, to, node }
  const heldBack = [];    // 历史行（新鲜度闸门拦下）
  const noEvents = [];
  const stat = {};
  TIME_FIELDS.forEach((f) => { stat[f] = { fill: 0, keep: 0, none: 0 }; });

  const now = Date.now();
  for (const row of rows) {
    const ev = events.get(String(row.jdy_data_id)) || [];
    if (!ev.length) noEvents.push(String(row.sn || row.jdy_data_id));
    const d = flowState.deriveNodeTimes(ev);
    const lastPush = flowState.toMs(row.op_time);
    const isFreshRow = lastPush !== null && (now - lastPush) <= FRESH_MS;
    for (const f of TIME_FIELDS) {
      const derivedMs = d.times[f];
      const cur = row[f];
      if (derivedMs === null || derivedMs === undefined) { stat[f].none += 1; continue; }
      if (!isBlank(cur)) { stat[f].keep += 1; continue; }
      const item = {
        dataId: String(row.jdy_data_id),
        sn: String(row.sn || ''),
        node: row.cur || '',
        field: f,
        column: colOf[f],
        from: '',
        to: flowState.toLocalString(derivedMs),
        fresh: isFreshRow,
        lastPush,
      };
      if (isFreshRow || FORCE_BACKFILL) {
        stat[f].fill += 1;
        changes.push(item);
      } else {
        heldBack.push(item);
      }
    }
  }

  const byField = {};
  changes.forEach((c) => { byField[c.field] = (byField[c.field] || 0) + 1; });
  console.log('【3】推导结果分类（逐字段 × 逐行）');
  TIME_FIELDS.forEach((f) => {
    console.log(`     ${f}: 待补空=${String(stat[f].fill).padStart(3)}  保留已有=${String(stat[f].keep).padStart(3)}  无推导=${String(stat[f].none).padStart(3)}`);
  });
  console.log(`\n     合计待补 ${changes.length} 格：${JSON.stringify(byField)}`);
  if (heldBack.length) {
    const hb = {};
    heldBack.forEach((c) => { hb[c.field] = (hb[c.field] || 0) + 1; });
    console.log(`     ⏸ 历史行被新鲜度闸门拦下 ${heldBack.length} 格：${JSON.stringify(hb)}`);
    console.log(`        （窗口 ${Math.round(FRESH_MS / 60000)} 分钟；补历史行会让解析表偏离业务表快照，`);
    console.log('          确需回填请显式加 --force-backfill）');
  }
  console.log(`     无流程事件的实例 ${noEvents.length} 个${noEvents.length ? `（${noEvents.slice(0, 12).join(',')}${noEvents.length > 12 ? '…' : ''}）` : ''}\n`);

  console.log('【4】待补明细（前 30 条）');
  changes.slice(0, 30).forEach((c) => {
    console.log(`     ${String(c.sn).padStart(4)} [${c.node || '-'}] ${c.field}: "" → ${c.to}`);
  });
  if (changes.length > 30) console.log(`     …… 其余 ${changes.length - 30} 条略`);

  const c215 = changes.filter((c) => c.sn === SERIAL_SN);
  console.log(`\n【5】节点 ${SERIAL_SN} 的待补格：${c215.length} 条`);
  c215.forEach((c) => console.log(`     ${c.field}: "" → ${c.to}`));

  const beforeFp = await fingerprint(colOf);
  console.log(`\n【6】写前指纹: rows=${beforeFp.rows} hash=${beforeFp.hash}`);

  /* ---- 3. dry-run 出口 ---- */
  if (!APPLY) {
    const afterFp = await fingerprint(colOf);
    console.log(`【7】写后指纹（dry-run 应完全一致）: rows=${afterFp.rows} hash=${afterFp.hash}`);
    console.log(`     ${beforeFp.hash === afterFp.hash ? '✅ 未写库，指纹一致' : '❌ 指纹变化（异常）'}`);
    const cur = await fillCounts(WIDE, TIME_FIELDS.reduce((a, f) => { a[f] = f; return a; }, {}));
    const p16 = await fillCounts(P16, colOf);
    console.log('\n【8】当前非空率对比（宽表 / parsed_16）');
    TIME_FIELDS.forEach((f) => console.log(`     ${f}: 宽表=${String(cur[f]).padStart(3)}  parsed_16=${String(p16[f]).padStart(3)}`));
    console.log('\n提示：加 --apply 执行真实修正（会先备份到 _work/v9/backup-<ts>.json）。');
    await db.close();
    process.exit(beforeFp.hash === afterFp.hash ? 0 : 1);
  }

  /* ---- 4. apply：备份 ---- */
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const backupPath = path.join(REPORT_DIR, `backup-${stamp()}.json`);
  const affectedIds = [...new Set(changes.map((c) => c.dataId))];
  const allCols = Object.keys((await db.queryOne(
    `SELECT * FROM \`${P16}\` WHERE jdy_data_id = ? LIMIT 1`,
    [affectedIds[0]]
  )) || {});

  const backupRows = [];
  for (const id of affectedIds) {
    const r = await db.queryOne(`SELECT * FROM \`${P16}\` WHERE jdy_data_id = ? LIMIT 1`, [id]);
    if (r) backupRows.push(r);
  }

  /*
   * 宽表也会被「重跑 flow 25」整体重写，因此一并快照 8 个时间列原值，
   * 万一日后要核对/回滚，两份原值都在同一个备份文件里。
   */
  const wideBackup = await db.query(
    `SELECT data_id, 流水号, 当前节点, ${TIME_FIELDS.map((f) => `\`${f}\``).join(', ')}
       FROM \`${WIDE}\` ORDER BY 流水号`
  ).catch(() => []);

  fs.writeFileSync(backupPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    table: P16,
    reason: 'V9 节点提交时间补空（只补空位，不覆盖非空值）',
    affectedDataIds: affectedIds,
    columns: allCols,
    rows: backupRows,
    plannedChanges: changes,
    wideTableSnapshot: {
      table: WIDE,
      note: '重跑 flow 25 前的宽表 8 个时间列原值（用于核对/回滚）',
      columns: ['data_id', '流水号', '当前节点', ...TIME_FIELDS],
      rows: wideBackup,
    },
  }, null, 2), 'utf8');
  console.log(`\n【9】已备份 ${backupRows.length} 行 × ${allCols.length} 列（parsed_16）+ 宽表 ${wideBackup.length} 行时间列 → ${backupPath}`);

  /* ---- 5. apply：写库（只补空） ---- */
  let written = 0;
  let filledCells = 0;
  const byData = new Map();
  changes.forEach((c) => {
    if (!byData.has(c.dataId)) byData.set(c.dataId, []);
    byData.get(c.dataId).push(c);
  });

  for (const [dataId, list] of byData) {
    const cols = list.map((c) => c.column);
    const sql = `UPDATE \`${P16}\`
                    SET ${cols.map((c) => `\`${c}\` = CASE WHEN \`${c}\` IS NULL OR \`${c}\` = '' THEN ? ELSE \`${c}\` END`).join(', ')}
                  WHERE jdy_data_id = ?`;
    const params = [...list.map((c) => c.to), dataId];
    try {
      const r = await db.query(sql, params);
      written += 1;
      filledCells += Number(r.affectedRows) || 0;
    } catch (err) {
      console.error(`     [ERROR] ${dataId}: ${err.message}`);
    }
  }
  console.log(`【10】写库完成：更新 ${written} 行（affectedRows 合计 ${filledCells}）`);

  /* ---- 6. 重跑 flow 25，让宽表跟上 ---- */
  if (!NO_FLOW_RUN) {
    console.log(`\n【11】重跑流程 #${WIDE_FLOW_ID}（让宽表 ${WIDE} 跟上 parsed_16）`);
    flows.invalidateTriggerFlowCache();
    flows.resetFlowRunGates();
    const t0 = Date.now();
    try {
      const r = await flows.run(WIDE_FLOW_ID, 'manual');
      console.log(`     ok=${r.ok} message=${r.message} input=${r.inputRows} output=${r.outputRows} ${Date.now() - t0}ms`);
    } catch (err) {
      console.error(`     [ERROR] 流程执行失败: ${err.message}`);
    }
  } else {
    console.log('\n【11】已按 --no-flow-run 跳过流程重跑');
  }

  /* ---- 7. 复核 ---- */
  console.log('\n【12】复核');
  const afterFp = await fingerprint(colOf);
  console.log(`     写后指纹: rows=${afterFp.rows} hash=${afterFp.hash}（写前 ${beforeFp.hash}）`);

  const wideCounts = await fillCounts(WIDE, TIME_FIELDS.reduce((a, f) => { a[f] = f; return a; }, {}));
  const p16Counts = await fillCounts(P16, colOf);
  let regress = false;
  TIME_FIELDS.forEach((f) => {
    const w = Number(wideCounts[f] || 0);
    const p = Number(p16Counts[f] || 0);
    const bad = w < p;
    if (bad) regress = true;
    console.log(`     ${f}: 宽表=${String(w).padStart(3)}  parsed_16=${String(p).padStart(3)}  ${bad ? '❌ 宽表落后' : '✅'}`);
  });

  const w215 = await db.queryOne(`SELECT * FROM \`${WIDE}\` WHERE \`流水号\` = ? LIMIT 1`, [SERIAL_SN]);
  const p215 = await db.queryOne(
    `SELECT ${TIME_FIELDS.map((f) => `\`${colOf[f]}\` AS \`${f}\``).join(', ')} FROM \`${P16}\` WHERE \`${serialCol}\` = ? LIMIT 1`,
    [SERIAL_SN]
  );
  console.log(`\n【13】节点 ${SERIAL_SN} 修复后`);
  TIME_FIELDS.forEach((f) => {
    console.log(`     ${f}: 宽表=${JSON.stringify(w215 ? w215[f] : null)}  parsed_16=${JSON.stringify(p215 ? p215[f] : null)}`);
  });
  const ok215 = !!(w215 && String(w215['实施对接时间'] || '').startsWith('2026-10-31 23:51:01'));
  console.log(`     实施对接时间 == 2026-10-31 23:51:01 → ${ok215 ? '✅' : '❌'}`);

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'apply',
    backupPath,
    affectedRows: affectedIds.length,
    plannedCells: changes.length,
    updatedRows: written,
    affectedRowsTotal: filledCells,
    beforeFingerprint: beforeFp,
    afterFingerprint: afterFp,
    nonNull: TIME_FIELDS.map((f) => ({
      field: f, wide: Number(wideCounts[f] || 0), parsed16: Number(p16Counts[f] || 0),
      ok: Number(wideCounts[f] || 0) >= Number(p16Counts[f] || 0),
    })),
    node215: {
      wide: w215 ? TIME_FIELDS.reduce((a, f) => { a[f] = w215[f]; return a; }, {}) : null,
      parsed16: p215 || null,
      ok: ok215,
    },
  };
  const reportPath = path.join(REPORT_DIR, `sync-report-${stamp()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n【14】报告 → ${reportPath}`);

  await db.close();
  const pass = !regress && ok215;
  console.log(`\n${pass ? '✅ 全部复核通过' : '❌ 复核未通过'}`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('\n[FATAL]', err && err.stack ? err.stack : err);
  process.exit(1);
});
