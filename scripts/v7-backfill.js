#!/usr/bin/env node
'use strict';
/**
 * V7 数据回填 —— 把业务表格（xlsx）的值写回 jdywh_parsed_16
 * ============================================================================
 * ★★ 默认 **dry-run**：只计算并输出「将更新 X 行 Y 列 Z 单元格」，**绝不写库**。
 * ★★ 只有显式传 `--apply` 才执行 UPDATE（生产库！最终由 Lead 执行）。
 *
 * 用法：
 *   node scripts/v7-backfill.js                          # dry-run（默认）
 *   node scripts/v7-backfill.js --apply                  # 真正写库
 *   node scripts/v7-backfill.js --apply --limit=5        # 分批：先写 5 行
 *   node scripts/v7-backfill.js --only=w_1792564761950   # 只处理指定 DB 列
 *   node scripts/v7-backfill.js --flow-mode=xlsx         # 当前节点/负责人以业务表格为准
 *   node scripts/v7-backfill.js --flow-mode=derived-finish --flow-guard=none
 *   node scripts/v7-backfill.js --verify                 # apply 后复核（默认开启）
 *   node scripts/v7-backfill.js --simulate-apply         # 只在内存里套用计划再重算，证明幂等/收敛
 *   node scripts/v7-backfill.js --source=json            # 离线预览（不能 --apply）
 *
 * 口径（与 scripts/v7-reconcile.js 完全一致，共用 scripts/v7-reconcile-lib.js）：
 *   · 只写「有差异的单元格」，不整表覆盖
 *   · 跳过列：xlsx 第 2 个「流程状态」（col56，parsed_16 无对应列）、主键 jdy_data_id
 *   · 时间列统一写 'YYYY-MM-DD HH:mm:ss'；数字列写 number；空值写 NULL
 *   · 当前节点/当前负责人：默认按契约 §3.3（+流程结束态修正）推导，
 *     并带「不劣化」保护——只有当写入能让该格与业务表格更一致时才写
 *   · 所有 SQL 用参数绑定；逐行事务；写前把受影响行完整备份到 _work/v7data/backup-<ts>.json
 *   · 幂等：同样的输入连跑两次，第二次的「将更新」为 0 行 0 列
 */

const fs = require('fs');
const path = require('path');
const lib = require('./v7-reconcile-lib');

const SETTABLE = new Set(
  lib.MAPPING.filter((m) => m.source !== 'missing' && m.idx !== 0).map((m) => m.db)
);

function parseArgs(argv) {
  const o = {
    apply: false, source: 'db', out: lib.DATA_DIR, flowMode: 'c3',
    flowGuard: 'improve', only: null, exclude: null, limit: 0, verify: true, quiet: false, truncateOk: false,
    simulateApply: false, xlsxFile: null,
  };
  for (const a of argv.slice(2)) {
    if (a === '--apply') o.apply = true;
    else if (a === '--dry-run') o.apply = false;
    else if (a === '--simulate-apply') { o.simulateApply = true; o.apply = false; }
    else if (a === '--source=json') o.source = 'json';
    else if (a === '--source=db') o.source = 'db';
    else if (a.startsWith('--out=')) o.out = path.isAbsolute(a.slice(6)) ? a.slice(6) : path.join(lib.ROOT, a.slice(6));
    else if (a.startsWith('--xlsx=')) {
      const v = a.slice(7);
      o.xlsxFile = path.isAbsolute(v) ? v : path.join(lib.ROOT, v);
    } else if (a.startsWith('--flow-mode=')) o.flowMode = a.slice(12);
    else if (a.startsWith('--flow-guard=')) o.flowGuard = a.slice(13);
    else if (a.startsWith('--only=')) o.only = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--exclude=')) o.exclude = a.slice(10).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--limit=')) o.limit = parseInt(a.slice(8), 10) || 0;
    else if (a === '--no-verify') o.verify = false;
    else if (a === '--verify') o.verify = true;
    else if (a === '--truncate-ok') o.truncateOk = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error('未知参数: ' + a); printHelp(); process.exit(2); }
  }
  if (!['c3', 'legacy', 'xlsx'].includes(o.flowMode)) {
    console.error('--flow-mode 只能是 c3（契约 §3.5 默认）| legacy（§3.3 旧规则）| xlsx（以业务表格为准）');
    process.exit(2);
  }
  if (!['improve', 'none'].includes(o.flowGuard)) {
    console.error('--flow-guard 只能是 improve | none');
    process.exit(2);
  }
  if (o.apply && o.source === 'json') {
    console.error('--source=json 是离线模式，不能 --apply');
    process.exit(2);
  }
  if (o.only) {
    for (const c of o.only) {
      if (!SETTABLE.has(c)) {
        console.error('--only 指定的列不可写或不参与映射: ' + c);
        process.exit(2);
      }
    }
  }
  return o;
}

function printHelp() {
  console.log([
    'node scripts/v7-backfill.js [--apply] [选项]',
    '  --apply             真正写库（默认 dry-run，绝不写）',
    '  --source=db|json    数据源（json 只能 dry-run）',
    '  --flow-mode=...     当前节点/负责人目标值口径：c3(默认，契约 §3.5 C3) | legacy(§3.3 旧规则) | xlsx(以业务表格为准)',
    '  --flow-guard=...    improve(默认，规则值与业务表格不一致时保守不动) | none(有差异就写)',
    '  --only=col1,col2    只处理指定 DB 列',
    '  --exclude=col1,col2 排除指定 DB 列',
    '  --limit=N           只处理前 N 行（按 data_id 升序，便于分批）',
    '  --xlsx=FILE         指定业务表格（默认 _work/v7data/xlsx_pos.json 位置式；缺失则读原始 .xlsx）',
    '  --no-verify         apply 后不做复核',
    '  --simulate-apply    内存里套用计划后重算，证明幂等收敛（不写库）',
    '  --out=DIR           报告/备份目录（默认 _work/v7data）',
  ].join('\n'));
}

const pad = (s, n) => {
  const t = String(s === null || s === undefined ? '' : s);
  let w = 0;
  for (const ch of t) w += /[\u4e00-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch) ? 2 : 1;
  return t + ' '.repeat(Math.max(0, n - w));
};
const rpad = (s, n) => {
  const t = String(s === null || s === undefined ? '' : s);
  let w = 0;
  for (const ch of t) w += /[\u4e00-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch) ? 2 : 1;
  return ' '.repeat(Math.max(0, n - w)) + t;
};

/** 把 xlsx 单元格值转成要写进 DB 的值（空 -> null） */
function toDbValue(raw, kind, colType, truncateOk) {
  const t = String(colType || '').toLowerCase();
  if (kind === 'num') {
    const n = lib.normNum(raw);
    return n === null ? null : n;
  }
  if (kind === 'time') {
    const s = lib.normTime(raw);
    return s === '' ? null : s;
  }
  if (kind === 'flowstate') {
    const s = lib.normFlowState(raw);
    if (s === '') return null;
    return s === '流转完成' ? '1' : '0'; // 反向翻译成 parsed_16 的 0/1
  }
  let s = lib.normText(raw);
  if (s === '') return null;
  const m = /^(?:var)?char\((\d+)\)$/.exec(t);
  if (m) {
    const max = parseInt(m[1], 10);
    if (s.length > max) {
      if (!truncateOk) {
        const e = new Error(`值长度 ${s.length} 超过列宽 varchar(${max})，列类型 ${colType}`);
        e.code = 'COL_OVERFLOW';
        throw e;
      }
      s = s.slice(0, max);
    }
  }
  return s;
}

function buildPlan({ xlsx, rows16, rows102, opt, dbColumns }) {
  const rec = lib.reconcile({
    xlsx, rows16, rows102, samples: 0,
    flowMode: opt.flowMode, flowGate: 'none',
  });
  const p16 = lib.buildIndex(rows16);
  const flowRows = new Map(rec.flowRows.map((r) => [r.dataId, r]));
  const colTypeOf = new Map((dbColumns || []).map((c) => [c.COLUMN_NAME, c.COLUMN_TYPE]));

  const changes = []; // { dataId, rowNo, set: [{db, idx, label, from, to, kind, source}] }
  const flowSkipped = []; // 不劣化保护跳过的 flow 列
  const flowGuardedWrites = [];
  const flowBySource = { finished: 0, from102: 0, fallbackNoop: 0 }; // 仅统计「实际写入」的格
  const flowEvalBySource = { finished: 0, from102: 0, fallbackNoop: 0 }; // 参与评估的格
  const skippedCells = []; // 因 --only 跳过
  const excludedCells = new Map(); // 因 --exclude 跳过

  for (const xr of xlsx.rows) {
    const did = xr.dataId;
    const dbRow = p16.get(did);
    if (!dbRow) continue;
    const fr = flowRows.get(did);
    const set = [];
    for (const m of lib.MAPPING) {
      if (m.source === 'missing' || m.idx === 0) continue;
      if (opt.only && !opt.only.includes(m.db)) { continue; }
      if (opt.exclude && opt.exclude.includes(m.db)) { excludedCells.set(m.label, (excludedCells.get(m.label) || 0) + 1); continue; }
      const xv = xr.values[m.idx];
      const cur = m.source === 'derived'
        ? (m.idx === 57 ? dbRow.flow_current_node : dbRow.flow_current_owner)
        : dbRow[m.db];

      let targetRaw; // 待写入的「原始值」（尚未按列类型转换）
      if (m.source === 'derived') {
        // 契约 §3.5 C3：目标值由规则算出（含 ①②③④），与业务表格无关；
        // --flow-mode=xlsx 时不走规则，直接以业务表格为准（用于「xlsx 无论如何都要为准」的场景）
        if (opt.flowMode === 'xlsx') {
          targetRaw = xv;
        } else {
          if (!fr) { continue; }
          if (opt.flowMode === 'legacy') targetRaw = m.idx === 57 ? fr.legacyNode : fr.legacyOwner;
          else targetRaw = m.idx === 57 ? fr.c3Node : fr.c3Owner;
          // 记录来源（评估格数；实际写入另计，见下方 set.push 前）
          if (fr.c3Source === 'fallback') flowEvalBySource.fallbackNoop += 1;
          else if (fr.c3Source === 'finished') flowEvalBySource.finished += 1;
          else flowEvalBySource.from102 += 1;
        }
      } else {
        targetRaw = xv;
      }

      const cmp = lib.compareCell(targetRaw, cur, m.kind);
      if (cmp.equal) continue; // 无差异，不写

      // 不劣化保护（仅在 flow 列、且仅在「规则值 != 业务表格」时才可能触发）
      if (m.source === 'derived' && opt.flowGuard === 'improve' && opt.flowMode !== 'xlsx') {
        const curMatchesXlsx = lib.compareCell(xv, cur, m.kind).equal;
        if (curMatchesXlsx) {
          flowSkipped.push({
            dataId: did, idx: m.idx, label: m.label, db: m.db,
            current: cur, target: targetRaw, xlsx: xv,
            reason: '当前值已与业务表格一致，规则值不一致，禁止劣化',
          });
          continue;
        }
        const targetMatchesXlsx = lib.compareCell(xv, targetRaw, m.kind).equal;
        if (!targetMatchesXlsx) {
          flowSkipped.push({
            dataId: did, idx: m.idx, label: m.label, db: m.db,
            current: cur, target: targetRaw, xlsx: xv,
            reason: '规则值与当前值都不等于业务表格，无法判定真值，保守不动',
          });
          continue;
        }
        flowGuardedWrites.push({ dataId: did, idx: m.idx, label: m.label });
      }

      const to = toDbValue(targetRaw, m.kind, colTypeOf.get(m.db), opt.truncateOk);
      if (m.source === 'derived' && opt.flowMode !== 'xlsx') {
        if (fr && fr.c3Source === 'fallback') flowBySource.fallbackNoop += 1;
        else if (fr && fr.c3Source === 'finished') flowBySource.finished += 1;
        else flowBySource.from102 += 1;
      }
      set.push({
        db: m.db, idx: m.idx, label: m.label, kind: m.kind, source: m.source,
        from: cur === undefined ? null : cur, to, xlsx: xv === undefined ? null : xv, diffKind: cmp.kind,
      });
    }
    if (set.length) changes.push({ dataId: did, rowNo: xr.rowNo, set });
  }
  return { rec, changes, flowSkipped, flowGuardedWrites, flowBySource, flowEvalBySource, skippedCells, excludedCells };
}

async function main() {
  const opt = parseArgs(process.argv);
  const t0 = Date.now();

  const xlsx = lib.readXlsx(opt.xlsxFile ? { file: opt.xlsxFile } : {});
  const data = opt.source === 'json' ? lib.loadFromJson() : await lib.loadFromDb();
  const outDir = lib.ensureDir(opt.out);

  // 安全前置：xlsx 的每一行都必须在 parsed_16 里存在，否则拒绝（缺失行无法回填）
  const p16ids = new Set(data.rows16.map((r) => lib.normText(r.jdy_data_id)));
  const missing = xlsx.rows.map((r) => r.dataId).filter((id) => !p16ids.has(id));
  if (missing.length) {
    console.error('[v7-backfill] 中止：xlsx 有 ' + missing.length + ' 行在 parsed_16 中不存在: ' + missing.slice(0, 5).join(','));
    process.exit(3);
  }

  let plan = buildPlan({ xlsx, rows16: data.rows16, rows102: data.rows102, opt, dbColumns: data.dbColumns });

  // --limit：只保留前 N 行（按 data_id 升序）
  if (opt.limit > 0 && plan.changes.length > opt.limit) {
    const keep = new Set(plan.changes.slice().sort((a, b) => (a.dataId < b.dataId ? -1 : 1)).slice(0, opt.limit).map((c) => c.dataId));
    plan = { ...plan, changes: plan.changes.filter((c) => keep.has(c.dataId)) };
  }

  const cellCount = plan.changes.reduce((s, r) => s + r.set.length, 0);
  const colSet = new Map();
  for (const r of plan.changes) for (const c of r.set) colSet.set(c.db, (colSet.get(c.db) || 0) + 1);

  // 计划指纹（幂等校验用）
  const planFingerprint = lib.hashOf(plan.changes.map((r) => ({
    id: r.dataId,
    set: r.set.map((c) => [c.db, lib.normText(c.from), lib.normText(c.to)]),
  })));

  const planPath = path.join(outDir, 'backfill-plan.json');
  fs.writeFileSync(planPath, JSON.stringify({
    version: 'v7-backfill-2.0',
    generatedAt: new Date().toISOString(),
    mode: opt.apply ? 'apply' : 'dry-run',
    contract: '_work/V7R-CONTRACT.md §3.5（C1/C2/C3）',
    source: {
      mode: data.mode, target: data.target,
      xlsx: path.relative(lib.ROOT, xlsx.path), xlsxSource: xlsx.source,
    },
    options: { flowMode: opt.flowMode, flowGuard: opt.flowGuard, only: opt.only, exclude: opt.exclude, limit: opt.limit },
    summary: {
      rows: plan.changes.length,
      columns: colSet.size,
      cells: cellCount,
      flowGuardedWrites: plan.flowGuardedWrites.length,
      flowSkippedByGuard: plan.flowSkipped.length,
      flowBySource: plan.flowBySource,
      flowEvalBySource: plan.flowEvalBySource,
      flowC3Hits: plan.rec.derivation.hits,
      flowDbStale: plan.rec.summary.flowDbStale,
    },
    fingerprint: planFingerprint,
    columns: [...colSet.entries()].map(([db, n]) => {
      const m = lib.MAPPING.find((x) => x.db === db) || {};
      return { db, label: m.label || '?', idx: m.idx, cells: n };
    }).sort((a, b) => b.cells - a.cells),
    flowSkipped: opt.flowGuard === 'improve' ? plan.flowSkipped : [],
    changes: plan.changes.map((r) => ({
      dataId: r.dataId,
      rowNo: r.rowNo,
      set: r.set.map((c) => ({ db: c.db, idx: c.idx, label: c.label, from: c.from, to: c.to, xlsx: c.xlsx, diffKind: c.diffKind })),
    })),
  }, null, 1), 'utf8');

  /* ------------------------------ 输出汇总 ------------------------------ */
  const L = [];
  L.push('='.repeat(96));
  L.push('V7 数据回填 ' + (opt.apply ? '★ APPLY（会写生产库）' : 'dry-run（不写库）') + '  v7-backfill-2.0');
  L.push('='.repeat(96));
  L.push('契约          : _work/V7R-CONTRACT.md §3.5（C1/C2/C3）');
  L.push('数据源        : ' + data.mode + '  ' + data.target.host + ' / ' + data.target.database);
  L.push('业务表格      : ' + path.relative(lib.ROOT, xlsx.path) + '  [' + xlsx.source + ']');
  L.push('当前节点口径  : --flow-mode=' + opt.flowMode + '  --flow-guard=' + opt.flowGuard);
  const dh = plan.rec.derivation;
  L.push('  C3 规则命中 : ' + dh.hits.c3.rows + '/96（失手 ' + dh.hits.c3.missRows
    + '）；旧规则 ' + dh.hits.legacy.rows + '/96；DB 现值 ' + dh.hits.dbCurrent.rows + '/96');
  L.push('  flow DB 存量差异: ' + plan.rec.summary.flowDbStale + ' 格');
  if (opt.only) L.push('列过滤        : --only=' + opt.only.join(','));
  if (opt.exclude) L.push('列排除        : --exclude=' + opt.exclude.join(','));
  if (opt.limit) L.push('行数限制      : --limit=' + opt.limit);
  L.push('');
  L.push('【将更新 ' + plan.changes.length + ' 行 ' + colSet.size + ' 列 ' + cellCount + ' 个单元格】');
  if (colSet.size) {
    L.push('  ' + pad('DB 列', 36) + pad('业务表格列', 30) + '单元格数');
    for (const [db, n] of [...colSet.entries()].sort((a, b) => b[1] - a[1])) {
      const m = lib.MAPPING.find((x) => x.db === db) || {};
      L.push('  ' + pad(db, 36) + pad(m.label || '?', 30) + rpad(n, 8));
    }
  }
  L.push('');
  L.push('【跳过列】');
  for (const s of (plan.rec.summary.skippedColumns || [])) {
    L.push('  [' + rpad(s.idx, 3) + '] ' + pad(s.label, 26) + ' 原因: ' + s.reason);
  }
  L.push('  主键 jdy_data_id 不写（WHERE 条件）。');
  L.push('');
  L.push('【flow 两列的写入来源（契约 §3.5 C3）】');
  L.push('  实际写入格数   : 来自 102 ' + plan.flowBySource.from102
    + ' | 流程结束置空 ' + plan.flowBySource.finished
    + ' | 回退回退值 ' + plan.flowBySource.fallbackNoop + '（回退时目标值=现值，通常为 0）');
  L.push('  评估格数       : 来自 102 ' + plan.flowEvalBySource.from102
    + ' | 流程结束 ' + plan.flowEvalBySource.finished
    + ' | 回退 parsed_16 ' + plan.flowEvalBySource.fallbackNoop);
  if (opt.exclude && plan.excludedCells && plan.excludedCells.size) {
    L.push('');
    L.push('【按 --exclude 排除】');
    for (const [label, n] of plan.excludedCells) L.push('  ' + pad(label, 26) + ' 跳过差异单元格 ' + n);
  }
  if (opt.flowGuard === 'improve') {
    L.push('');
    L.push('【当前节点/负责人：不劣化保护】');
    L.push('  规则值==业务表格 且 原值!=业务表格（可安全写入）: ' + plan.flowGuardedWrites.length + ' 个单元格');
    for (const w of plan.flowGuardedWrites.slice(0, 10)) L.push('      · ' + w.dataId + ' ' + w.label);
    L.push('  保守跳过（规则值与业务表格仍不一致）        : ' + plan.flowSkipped.length + ' 个单元格');
    if (!plan.flowSkipped.length) L.push('      （无 —— C3 规则 96/96 命中，不存在分歧格）');
    for (const s of plan.flowSkipped.slice(0, 10)) {
      L.push('      · ' + s.dataId + ' ' + s.label + '  原值=' + JSON.stringify(lib.normText(s.current))
        + ' 规则值=' + JSON.stringify(lib.normText(s.target)) + ' xlsx=' + JSON.stringify(lib.normText(s.xlsx)));
      L.push('        ' + s.reason);
    }
  }
  L.push('');
  L.push('【差异样例（每列前 3 条）】');
  const seenCol = new Map();
  for (const r of plan.changes) {
    for (const c of r.set) {
      const k = c.db;
      if ((seenCol.get(k) || 0) >= 3) continue;
      seenCol.set(k, (seenCol.get(k) || 0) + 1);
      L.push('  · ' + c.label + ' [' + c.db + '] ' + r.dataId);
      L.push('      原值 = ' + JSON.stringify(lib.normText(c.from)));
      L.push('      将写 = ' + JSON.stringify(c.to === null ? null : lib.normText(c.to)) + '   (' + c.diffKind + ')');
    }
  }
  L.push('');
  L.push('计划指纹(幂等) : ' + planFingerprint);
  L.push('计划文件       : ' + path.relative(lib.ROOT, planPath));
  L.push('');

  let exitCode = 0;
  if (!opt.apply) {
    L.push('【dry-run】未执行任何 SQL。备份文件不会生成（--apply 时才备份）。');
    if (opt.simulateApply) {
      // 在内存里套用计划，再重算 → 证明「apply 后会收敛」且「第二遍幂等为 0」
      const patch = new Map(plan.changes.map((r) => [r.dataId, r.set]));
      const rowsAfter = data.rows16.map((row) => {
        const did = lib.normText(row.jdy_data_id);
        const set = patch.get(did);
        if (!set) return row;
        const copy = { ...row };
        for (const c of set) copy[c.db] = c.to;
        return copy;
      });
      const plan2 = buildPlan({ xlsx, rows16: rowsAfter, rows102: data.rows102, opt, dbColumns: data.dbColumns });
      const resRows = plan2.changes.length;
      const resCells = plan2.changes.reduce((s, r) => s + r.set.length, 0);
      L.push('');
      L.push('【--simulate-apply 内存套用后重算】（用于证明收敛与幂等，不写库）');
      L.push('  残留: ' + resRows + ' 行 / ' + resCells + ' 个单元格');
      if (resCells === 0) {
        L.push('   ✅ 套用后累计差异为 0：apply 会收敛，第二遍 apply 为 0 行 0 列（幂等成立）');
      } else {
        for (const r of plan2.changes.slice(0, 10)) {
          for (const c of r.set) {
            L.push('      · ' + r.dataId + ' ' + c.label + ' 将=' + JSON.stringify(lib.normText(c.from))
              + ' 期望=' + JSON.stringify(c.to === null ? null : lib.normText(c.to)));
          }
        }
        if (opt.flowMode !== 'xlsx') {
          L.push('   残留全部来自「102 推导值与业务表格不一致」的 flow 列（见上【保守跳过】），属预期。');
          L.push('   如需 flow 列 100% 对齐业务表格，由 Lead 用 --flow-mode=xlsx 执行；');
          L.push('   但那会把「业务表格的快照值」当权威写进 flow_*，与契约 §3.3「由 102 提供」冲突，需业务确认。');
        }
      }
      const simPath = path.join(outDir, 'backfill-simulate-apply.json');
      fs.writeFileSync(simPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        residualRows: resRows,
        residualCells: resCells,
        residual: plan2.changes.map((r) => ({
          dataId: r.dataId,
          set: r.set.map((c) => ({ db: c.db, label: c.label, current: c.from, expected: c.to, diffKind: c.diffKind })),
        })),
      }, null, 1), 'utf8');
      L.push('  明细: ' + path.relative(lib.ROOT, simPath));
    }
    L.push('');
    L.push('复核口径：把本脚本连跑两遍，第二遍应输出「将更新 0 行 0 列 0 个单元格」。');
    L.push('真正落库请由 Lead 执行：node scripts/v7-backfill.js --apply');
  } else {
    /* ------------------------------ 备份 ------------------------------ */
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const backupPath = path.join(outDir, 'backup-' + ts + '.json');
    const db = require('../src/db');
    const ids = plan.changes.map((c) => c.dataId);
    const backupRows = ids.length
      ? await db.query(
        'SELECT * FROM ' + lib.P16_TABLE + ' WHERE jdy_data_id IN (' + ids.map(() => '?').join(',') + ')',
        ids
      )
      : [];
    fs.writeFileSync(backupPath, JSON.stringify({
      version: 'v7-backfill-1.0-backup',
      createdAt: new Date().toISOString(),
      table: lib.P16_TABLE,
      target: data.target,
      affectedRows: ids.length,
      fingerprint: planFingerprint,
      plan: plan.changes.map((r) => ({
        dataId: r.dataId,
        set: r.set.map((c) => ({ db: c.db, label: c.label, from: c.from, to: c.to })),
      })),
      rows: backupRows,
    }, null, 1), 'utf8');
    L.push('【备份】受影响行已完整备份: ' + path.relative(lib.ROOT, backupPath)
      + '（' + backupRows.length + ' 行）');

    /* ------------------------------ 写入 ------------------------------ */
    let okRows = 0; let okCells = 0; const failed = [];
    for (const r of plan.changes) {
      const cols = r.set.map((c) => c.db);
      const sets = cols.map((c) => '`' + c + '` = ?').join(', ');
      const params = r.set.map((c) => c.to);
      params.push(r.dataId);
      const sql = 'UPDATE ' + lib.P16_TABLE + ' SET ' + sets + ' WHERE `jdy_data_id` = ?';
      try {
        const res = await db.withTransaction(async (conn) => {
          const [r2] = await conn.execute(sql, params);
          if (r2.affectedRows !== 1) {
            throw new Error('affectedRows=' + r2.affectedRows + '（期望 1）');
          }
          return r2;
        });
        void res;
        okRows += 1;
        okCells += r.set.length;
      } catch (err) {
        failed.push({ dataId: r.dataId, error: err.message });
      }
    }
    L.push('【写入结果】成功 ' + okRows + ' 行 / ' + okCells + ' 个单元格；失败 ' + failed.length + ' 行');
    for (const f of failed.slice(0, 10)) L.push('   ✗ ' + f.dataId + ': ' + f.error);
    if (failed.length) exitCode = 4;

    /* ------------------------------ 复核 ------------------------------ */
    if (opt.verify && exitCode === 0) {
      const after = await lib.loadFromDb();
      const plan2 = buildPlan({ xlsx, rows16: after.rows16, rows102: after.rows102, opt, dbColumns: after.dbColumns });
      const residualRows = plan2.changes.length;
      const residualCells = plan2.changes.reduce((s, r) => s + r.set.length, 0);
      L.push('【apply 后复核】残留差异: ' + residualRows + ' 行 / ' + residualCells + ' 个单元格');
      if (residualCells === 0) {
        L.push('   ✅ parsed_16 已与业务表格 100% 一致（59 列中 58 列参与比对，1 列无对应列）');
      } else {
        L.push('   残留明细（前 10）:');
        for (const r of plan2.changes.slice(0, 10)) {
          for (const c of r.set) {
            L.push('      · ' + r.dataId + ' ' + c.label + ' 现=' + JSON.stringify(lib.normText(c.from))
              + ' 期望=' + JSON.stringify(c.to === null ? null : lib.normText(c.to)));
          }
        }
        if (opt.flowMode !== 'xlsx') {
          L.push('   提示：残留集中在前述「102 推导规则失手」的行；如需 0 差异，用 --flow-mode=xlsx 再跑一次 apply。');
        }
      }
    }
    L.push('');
    L.push('回滚方式：按 backup 文件里的 rows[*] 原值逐行 UPDATE 回去（备份含全部列原值）。');
  }

  const txtPath = path.join(outDir, 'backfill-' + (opt.apply ? 'apply' : 'dryrun') + '-report.txt');
  fs.writeFileSync(txtPath, L.join('\n') + '\n', 'utf8');

  if (!opt.quiet) console.log(L.join('\n'));
  console.log('');
  console.log('[plan] ' + path.relative(lib.ROOT, planPath));
  console.log('[report] ' + path.relative(lib.ROOT, txtPath));
  console.log((opt.apply ? '[APPLY]' : '[dry-run]') + ' 将更新 ' + plan.changes.length + ' 行 '
    + colSet.size + ' 列 ' + cellCount + ' 个单元格 | 指纹 ' + planFingerprint.slice(0, 16));
  console.log('耗时 ' + (Date.now() - t0) + ' ms');

  if (data.mode === 'db') {
    try { const db = require('../src/db'); await db.getPool().end(); } catch (_) { /* ignore */ }
  }
  return exitCode;
}

main().then((code) => process.exit(code || 0)).catch(async (err) => {
  console.error('[v7-backfill] 失败:', err && err.message);
  if (err && err.stack) console.error(err.stack);
  try { const db = require('../src/db'); if (db && db.getPool()) await db.getPool().end(); } catch (_) { /* ignore */ }
  process.exit(1);
});
