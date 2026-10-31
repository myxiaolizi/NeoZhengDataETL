#!/usr/bin/env node
'use strict';
/**
 * V7 数据对账（**只读**，本文件不含任何写库语句）
 * ============================================================================
 * 把业务表格（数据文件/新增智能体签约_20261030233545.xlsx，96×59）
 * 与 parsed_16（CRM表单推送 96 行）+ parsed_102（CRM流程推送 369 事件）逐格比对。
 *
 * 用法：
 *   node scripts/v7-reconcile.js                    # 直连 DB（默认）
 *   node scripts/v7-reconcile.js --source=json      # 离线，读 _work/v7data/*.json
 *   node scripts/v7-reconcile.js --samples=5        # 每列差异样例条数（默认 3）
 *   node scripts/v7-reconcile.js --out=_work/v7data # 报告输出目录
 *   node scripts/v7-reconcile.js --flow-mode=c3      # 当前节点/负责人期望值口径（默认）
 *   node scripts/v7-reconcile.js --xlsx=FILE         # 指定业务表格（.json 位置式 / .xlsx）
 *   node scripts/v7-reconcile.js --quiet             # 只写文件，少打印
 *
 * 产物：_work/v7data/reconcile-report.json / reconcile-report.txt
 * 幂等：报告内 idempotency.fingerprint 只覆盖实质比对结果；连跑两次必须一致。
 */

const fs = require('fs');
const path = require('path');
const lib = require('./v7-reconcile-lib');

const FLOW_MODES = ['c3', 'legacy', 'xlsx'];

function parseArgs(argv) {
  const out = {
    source: 'db', samples: 3, out: lib.DATA_DIR, quiet: false,
    flowMode: 'c3', flowGate: 'none', xlsxFile: null,
  };
  for (const a of argv.slice(2)) {
    if (a === '--source=json') out.source = 'json';
    else if (a === '--source=db') out.source = 'db';
    else if (a.startsWith('--samples=')) out.samples = Math.max(0, parseInt(a.slice(10), 10) || 0);
    else if (a.startsWith('--out=')) out.out = path.isAbsolute(a.slice(6)) ? a.slice(6) : path.join(lib.ROOT, a.slice(6));
    else if (a.startsWith('--xlsx=')) {
      const v = a.slice(7);
      out.xlsxFile = path.isAbsolute(v) ? v : path.join(lib.ROOT, v);
    } else if (a.startsWith('--flow-mode=')) out.flowMode = a.slice(12);
    else if (a.startsWith('--flow-gate=')) out.flowGate = a.slice(12);
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error('未知参数: ' + a); printHelp(); process.exit(2); }
  }
  if (!FLOW_MODES.includes(out.flowMode)) {
    console.error('--flow-mode 只能是 ' + FLOW_MODES.join(' | '));
    process.exit(2);
  }
  if (!['none', 'xlsx-wins'].includes(out.flowGate)) {
    console.error('--flow-gate 只能是 none | xlsx-wins');
    process.exit(2);
  }
  return out;
}

function printHelp() {
  console.log([
    'node scripts/v7-reconcile.js [--source=db|json] [--samples=N] [--out=DIR] [--flow-mode=...] [--xlsx=FILE] [--quiet]',
    '  只读对账：业务表格(96×59) vs jdywh_parsed_16 + jdywh_parsed_102',
    '  业务表格默认读 _work/v7data/xlsx_pos.json（位置式，契约 §3.5 C1）；缺失时回退原始 .xlsx',
    '  默认直连 DB；--source=json 读 _work/v7data/parsed16.json / parsed102.json',
    '  --flow-mode=c3（默认，契约 §3.5 C3）| legacy（§3.3 旧规则）| xlsx（以业务表格为准）',
    '  --flow-gate=xlsx-wins  当 102 推导值与业务表格不一致时以业务表格为准（回填「不劣化」语义）',
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
const clip = (s, n) => {
  const t = s === null || s === undefined ? '' : String(s).replace(/\n/g, '\\n');
  return t.length > n ? t.slice(0, n) + '…' : t;
};

async function main() {
  const opt = parseArgs(process.argv);
  const t0 = Date.now();

  const xlsx = lib.readXlsx(opt.xlsxFile ? { file: opt.xlsxFile } : {});
  const data = opt.source === 'json' ? lib.loadFromJson() : await lib.loadFromDb();

  // 校验：映射里用到的 DB 列是否都存在
  const dbCols = new Set((data.dbColumns || []).map((c) => c.COLUMN_NAME));
  const missingCols = lib.MAPPING
    .filter((m) => m.source === 'p16' && m.db)
    .map((m) => m.db)
    .filter((c) => !dbCols.has(c));

  const result = lib.reconcile({
    xlsx,
    rows16: data.rows16,
    rows102: data.rows102,
    samples: opt.samples,
    flowMode: opt.flowMode,
    flowGate: opt.flowGate,
  });

  // 列宽最大文本（辅助判断 _p 500 字符截断影响）
  const maxLen = {};
  for (const m of lib.MAPPING) {
    let mx = 0;
    for (const r of xlsx.rows) {
      const s = lib.normText(r.values[m.idx]);
      if (s.length > mx) mx = s.length;
    }
    maxLen[m.label] = mx;
  }

  // 交叉验证：xlsx_pos.json 是否忠实于原始 .xlsx（含重名列）——这是「能不能信业务表格导出」的硬证据
  let xlsxIntegrity = null;
  if (xlsx.source === 'xlsx_pos.json' && fs.existsSync(lib.XLSX_PATH)) {
    try {
      xlsxIntegrity = lib.verifyXlsxPositional({ maxSamples: 50 });
    } catch (e) {
      xlsxIntegrity = { ok: false, error: e.message };
    }
  }

  const report = {
    version: 'v7-reconcile-2.0',
    contract: '_work/V7R-CONTRACT.md §3.5（C1/C2/C3，以 §3.5 为准）',
    generatedAt: new Date().toISOString(),
    source: {
      mode: data.mode,
      target: data.target,
      xlsx: path.relative(lib.ROOT, xlsx.path),
      xlsxSource: xlsx.source,
      sheet: xlsx.sheet,
      parsed16: lib.P16_TABLE,
      parsed102: lib.P102_TABLE,
      flowMode: opt.flowMode,
      flowGate: opt.flowGate,
      flowCutoffIso: result.derivation.cutoffIso,
      dbColumnsFound: (data.dbColumns || []).length,
      missingMappedColumns: missingCols,
    },
    xlsxIntegrity,
    summary: result.summary,
    derivation: result.derivation,
    corrections: result.corrections,
    columns: result.columns.map((c) => ({
      idx: c.idx,
      label: c.label,
      xlsxHeader: c.xlsxHeader,
      dbColumn: c.dbColumn,
      kind: c.kind,
      source: c.source,
      note: c.note,
      nonNullXlsx: c.nonNullXlsx,
      nonNullDb: c.nonNullDb,
      maxLenXlsx: maxLen[c.label],
      diffCount: c.diffCount,
      diffKinds: c.diffKinds,
      flowModeDiffs: c.flowModeDiffs,
      dbStaleCount: c.dbStaleCount,
      status: c.source === 'missing' ? 'skipped' : c.diffCount === 0 ? 'identical' : 'diff',
      samples: c.samples,
    })),
    rows: result.rowDiffs,
    flowRows: result.flowRows,
  };
  report.idempotency = {
    fingerprint: lib.fingerprint(result),
    covered: 'summary + 逐列差异 + 逐行差异 + C3 推导命中/失手行列表（不含时间戳/路径）',
  };

  const outDir = lib.ensureDir(opt.out);
  const jsonPath = path.join(outDir, 'reconcile-report.json');
  const txtPath = path.join(outDir, 'reconcile-report.txt');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 1), 'utf8');

  /* ------------------------------- txt 报告 ------------------------------- */
  const L = [];
  const S = report.summary;
  L.push('='.repeat(96));
  L.push('V7 数据对账报告（只读）  ' + report.version);
  L.push('='.repeat(96));
  L.push('生成时间        : ' + report.generatedAt);
  L.push('契约            : ' + report.contract);
  L.push('数据源          : ' + report.source.mode + '  ' + report.source.target.host + ' / ' + report.source.target.database);
  L.push('业务表格        : ' + report.source.xlsx + '  sheet=' + report.source.sheet);
  L.push('对账目标        : ' + lib.P16_TABLE + '（表单推送）+ ' + lib.P102_TABLE + '（流程事件）');
  L.push('当前节点/负责人口径 : --flow-mode=' + report.source.flowMode);
  L.push('');
  L.push('【总览】');
  L.push('  业务表格行数        : ' + S.xlsxRows + ' 行 × ' + S.xlsxCols + ' 列');
  L.push('  parsed_16 行数      : ' + S.dbRows + ' 行');
  L.push('  按 data_id 匹配     : ' + S.matchedRows + '/' + S.xlsxRows
    + (S.missingInDb.length ? '  xlsx 有而 DB 无: ' + S.missingInDb.length : '')
    + (S.extraInDb.length ? '  DB 有而 xlsx 无: ' + S.extraInDb.length : ''));
  L.push('  映射列 / 参与比对列 : ' + S.mappedColumns + ' / ' + S.comparedColumns
    + (S.skippedColumns.length ? '（跳过 ' + S.skippedColumns.length + ' 列：无对应 DB 列）' : ''));
  L.push('  完全一致列          : ' + S.identicalColumns + '/' + S.comparedColumns);
  L.push('  仍有差异列          : ' + S.diffColumns + '/' + S.comparedColumns);
  L.push('  差异单元格          : ' + S.diffCells + ' / ' + S.totalCells
    + '   总体一致率 ' + S.consistencyRate + '%');
  L.push('  有差异的行          : ' + S.rowsWithDiff + '/' + S.matchedRows
    + '   完全一致的行 ' + S.rowsFullyIdentical + '/' + S.matchedRows);
  L.push('  幂等指纹            : ' + report.idempotency.fingerprint);
  if (missingCols.length) {
    L.push('  ⚠ 映射列在 DB 中不存在: ' + missingCols.join(', '));
  }
  L.push('');
  if (xlsxIntegrity) {
    L.push('【业务表格完整性交叉验证】（xlsx_pos.json ← 原始 .xlsx，含两组重名列）');
    if (xlsxIntegrity.error) {
      L.push('  ⚠ 交叉验证失败: ' + xlsxIntegrity.error);
    } else {
      L.push('  表头一致/行数一致/列数一致: ' + xlsxIntegrity.headerSame + ' / '
        + xlsxIntegrity.rowCountSame + ' / ' + xlsxIntegrity.colCountSame);
      L.push('  逐格比对                : ' + xlsxIntegrity.comparedCells + ' 格，差异 '
        + xlsxIntegrity.mismatchCount + ' 格 '
        + (xlsxIntegrity.ok ? '✅ 完全一致' : '⚠ 有差异'));
      L.push('  重名列(位置式已保留)    : '
        + xlsxIntegrity.duplicateColumns.map((d) => d.header + '@[' + d.indexes.join(',') + ']').join('  '));
      if (xlsxIntegrity.mismatchCount) {
        for (const m of xlsxIntegrity.mismatches.slice(0, 10)) {
          L.push('      · 行' + m.row + ' 列[' + m.idx + ']' + m.header
            + '  pos=' + JSON.stringify(m.pos) + '  file=' + JSON.stringify(m.file));
        }
      }
    }
    L.push('  说明：旧 `xlsx.json`（按表头名建 object）会丢掉重名列的前者，'
      + '位置式导出可保证 59 列全部保真');
    L.push('');
  }
  const skipped = S.skippedColumns || [];
  if (skipped.length) {
    L.push('【跳过列（无对应 DB 列）】');
    for (const s of skipped) L.push('  [' + rpad(s.idx, 3) + '] ' + pad(s.label, 26) + ' ' + s.reason);
    L.push('');
  }

  L.push('【逐列对账】  差异数/96   （✓=完全一致  ✗=有差异  - = 跳过）');
  L.push('  idx  ' + pad('业务表格列', 34) + pad('parsed_16 列', 36) + '类型   状态  差异  差异分类');
  L.push('  ' + '-'.repeat(94));
  for (const c of report.columns) {
    const mark = c.status === 'identical' ? '✓' : c.status === 'diff' ? '✗' : '-';
    const kinds = Object.entries(c.diffKinds || {}).map(([k, v]) => k + ':' + v).join(' ');
    L.push('  ' + rpad(c.idx, 3) + '  ' + pad(c.label, 34) + pad(c.dbColumn || '(无)', 36)
      + pad(c.kind, 6) + pad(mark, 6) + rpad(c.diffCount, 5) + ' ' + kinds);
  }
  L.push('');

  const diffCols = report.columns.filter((c) => c.diffCount > 0).sort((a, b) => b.diffCount - a.diffCount);
  if (diffCols.length) {
    L.push('【差异列详解（按差异数降序）】');
    for (const c of diffCols) {
      L.push('  ' + '─'.repeat(92));
      L.push('  [' + c.idx + '] ' + c.label + '  →  ' + c.dbColumn + '   (' + c.kind + ', ' + c.source + ')');
      L.push('      差异 ' + c.diffCount + '/96  分类 ' + JSON.stringify(c.diffKinds)
        + '  非空(xlsx/db) ' + c.nonNullXlsx + '/' + c.nonNullDb + '  最长(xlsx) ' + c.maxLenXlsx);
      if (c.note) L.push('      备注: ' + c.note);
      for (const s of c.samples) {
        L.push('      · ' + s.dataId + ' (行' + s.rowNo + ') ' + s.diffKind
          + (s.viaEvents === null ? '' : s.viaEvents ? ' [102推导]' : ' [p16回退]'));
        L.push('          xlsx = ' + clip(s.xlsx, 96));
        L.push('          db   = ' + clip(s.db, 96));
      }
    }
    L.push('');
  }

  const d = result.derivation;
  L.push('【当前节点 / 当前负责人 —— 契约 §3.5 C3 规则】');
  L.push('  规则              : ①sys_flow_state_2==1→置空 ②取 cutoff 前事件选「最后一条 created>0 且其后无 completed/canceled」'
    + ' ③开始→销售签约 ④无挂起待办→回退 parsed_16.flow_*');
  L.push('  快照切点 cutoff   : ' + d.cutoffIso + '（= 2026-10-30 23:30 北京）');
  L.push('  流程事件总数      : ' + d.totalEvents + '；涉及实例 ' + d.totalInstances
    + '；cutoff 之后被排除的事件数 ' + d.eventsAfterCutoff
    + '；cutoff 后实例数 ' + d.instancesAfterCutoff);
  L.push('  单实例最多事件    : ' + d.maxEvents);
  L.push('  各行来源分布      : 流程结束置空 ' + d.sourceRows.finished
    + ' | 来自 102 ' + d.sourceRows.from102
    + ' | 回退 parsed_16 ' + d.sourceRows.fallback);
  L.push('  节点名别名命中    : ' + d.aliasApplied + ' 条（开始 → 销售签约）');
  L.push('  命中率（节点+负责人 双匹配，共 96 行）:');
  L.push('      C3 新规则（当前口径）   : ' + d.hits.c3.rows + '/96   失手 ' + d.hits.c3.missRows + ' 行');
  L.push('      §3.3 旧规则+结束态      : ' + d.hits.legacy.rows + '/96   失手 ' + d.hits.legacy.missRows + ' 行');
  L.push('      DB 现值(未回填)         : ' + d.hits.dbCurrent.rows + '/96   不一致 ' + d.hits.dbCurrent.missRows + ' 行');
  const c57 = report.columns.find((c) => c.idx === 57);
  const c58 = report.columns.find((c) => c.idx === 58);
  if (c57 && c58) {
    L.push('  当前节点  差异        : ' + c57.diffCount + '/96 ' + JSON.stringify(c57.diffKinds)
      + '   各口径 ' + JSON.stringify(c57.flowModeDiffs)
      + '   DB存量差异 ' + c57.dbStaleCount);
    L.push('  当前负责人 差异       : ' + c58.diffCount + '/96 ' + JSON.stringify(c58.diffKinds)
      + '   各口径 ' + JSON.stringify(c58.flowModeDiffs)
      + '   DB存量差异 ' + c58.dbStaleCount);
  }
  L.push('  flow 两列 DB 存量差异合计: ' + S.flowDbStale + ' 格（= 回填要修的格数，与口径无关）');
  if (d.c3Mismatches.length) {
    L.push('  ⚠ C3 规则仍失手 ' + d.c3Mismatches.length + ' 行:');
    for (const m of d.c3Mismatches) {
      L.push('      · ' + m.dataId + ' 来源=' + m.c3Source + ' 事件数=' + m.eventCount + ' state=' + m.sysFlowState);
      L.push('          xlsx = ' + JSON.stringify(m.xlsxNode) + ' / ' + JSON.stringify(m.xlsxOwner));
      L.push('          C3   = ' + JSON.stringify(m.c3Node) + ' / ' + JSON.stringify(m.c3Owner));
    }
  } else {
    L.push('  ✅ C3 规则 96/96 命中业务表（0 失手）');
  }
  if (d.legacyMismatches.length) {
    L.push('  对比：§3.3 旧规则失手 ' + d.legacyMismatches.length + ' 行（说明新规则的必要性）:');
    for (const g of d.legacyMismatches.slice(0, 10)) {
      L.push('      · ' + g.dataId);
      L.push('          xlsx    = ' + JSON.stringify(g.xlsxNode) + ' / ' + JSON.stringify(g.xlsxOwner));
      L.push('          旧规则  = ' + JSON.stringify(g.legacyNode) + ' / ' + JSON.stringify(g.legacyOwner));
      L.push('          p16现值 = ' + JSON.stringify(g.p16Node) + ' / ' + JSON.stringify(g.p16Owner));
    }
  }
  L.push('');

  L.push('【契约修正（实测发现，已上报 Lead）】');
  for (const c of result.corrections) {
    L.push('  ' + c.id + (c.resolved ? ' [已在本脚本处理]' : ' [待确认]'));
    L.push('      发现: ' + c.finding);
    L.push('      影响: ' + c.impact);
    if (c.action) L.push('      处理: ' + c.action);
  }
  L.push('');
  L.push('【结论】');
  L.push('  1) ' + S.identicalColumns + '/' + S.comparedColumns + ' 列与业务表格完全一致，'
    + S.diffColumns + ' 列存在差异，共 ' + S.diffCells + ' 个单元格（一致率 ' + S.consistencyRate + '%）。');
  if (diffCols.length) {
    L.push('  2) 差异最集中的列: ' + diffCols.slice(0, 6).map((c) => c.label + '(' + c.diffCount + ')').join(', '));
  }
  L.push('  3) 根因见 _work/v7data/root-cause.md；回填方案见 scripts/v7-backfill.js（默认 dry-run）。');
  L.push('');
  L.push('耗时 ' + (Date.now() - t0) + ' ms');
  fs.writeFileSync(txtPath, L.join('\n') + '\n', 'utf8');

  /* ------------------------------- console ------------------------------- */
  if (!opt.quiet) {
    console.log(L.join('\n'));
  }
  console.log('');
  console.log('[report] ' + path.relative(lib.ROOT, jsonPath));
  console.log('[report] ' + path.relative(lib.ROOT, txtPath));
  console.log('[summary] 一致列 ' + S.identicalColumns + '/' + S.comparedColumns
    + ' | 差异单元格 ' + S.diffCells + '/' + S.totalCells
    + ' | 一致率 ' + S.consistencyRate + '%'
    + ' | 指纹 ' + report.idempotency.fingerprint.slice(0, 16));
  return 0;
}

main().then((code) => process.exit(code || 0)).catch(async (err) => {
  console.error('[v7-reconcile] 失败:', err && err.message);
  if (err && err.stack) console.error(err.stack);
  try {
    const db = require('../src/db');
    if (db && db.getPool()) await db.getPool().end();
  } catch (_) { /* ignore */ }
  process.exit(1);
});
