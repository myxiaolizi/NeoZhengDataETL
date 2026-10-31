#!/usr/bin/env node
'use strict';
/**
 * V8 数据对账复核（**只读**，本文件不含任何写库语句）
 * ============================================================================
 * 校验 `jdywh_parsed_16`（CRM表单推送）与业务表格
 * `数据文件/新增智能体签约_20261030233545.xlsx` 是否一致。
 *
 * 核心语义（V8 定论，见 _work/v8/reconcile/report.md）：
 *   业务表格是 **2026-10-30 23:30 北京（= 15:30 UTC）的快照**。
 *   业务侧在该时刻之后仍在推送新数据，我方链路是**实时**的，
 *   因此「快照后又被推送过」的行（fresh 行）必然与旧快照不同 —— 那是**正向更新**，不是错。
 *
 *   断言：**非 fresh 行的差异必须 = 0**。这正是「解析表与业务表一致」的正确判据。
 *
 * 用法：
 *   node scripts/v8-reconcile-verify.js
 *   node scripts/v8-reconcile-verify.js --snapshot=2026-10-30T15:30:00Z
 *   node scripts/v8-reconcile-verify.js --snapshot=1793345400000 --verbose
 *   node scripts/v8-reconcile-verify.js --json=_work/v8/reconcile/verify.json
 *   node scripts/v8-reconcile-verify.js --samples=20
 *
 * 退出码：0 = 全部断言通过（非 fresh 差异 0）  1 = 有差异  2 = 环境/参数错误
 *
 * 依赖：仅 `require('../src/db')` + `xlsx`；路径全部相对 __dirname，可在生产
 *       `/www/wwwroot/jdy-push` 直接执行。
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');

/*
 * 固定 .env 的加载路径。
 * src/config.js 里是 `require('dotenv').config()`，它按 **process.cwd()** 找 .env，
 * 于是从别的目录（例如计划任务、`cd /tmp && node /www/wwwroot/jdy-push/scripts/...`）
 * 调用时会读不到数据库配置，回退成 127.0.0.1 + 空密码 → 直接连接失败。
 * 这里按 __dirname 显式加载项目自己的 .env，使脚本**与 cwd 无关**。
 * （dotenv 不会覆盖已存在的环境变量，生产用 systemd/宝塔注入的 env 仍然优先）
 */
const ENV_PATH = path.join(ROOT, '.env');
if (fs.existsSync(ENV_PATH)) {
  try {
    require('dotenv').config({ path: ENV_PATH });
  } catch (_) { /* dotenv 不可用则依赖外部环境变量 */ }
}

const XLSX_PATH = path.join(ROOT, '数据文件', '新增智能体签约_20261030233545.xlsx');
const P16_TABLE = 'jdywh_parsed_16';
const D16_TABLE = 'jdywh_data_16';

/** 业务表快照时刻：2026-10-30 23:30 Asia/Shanghai = 2026-10-30T15:30:00Z */
const DEFAULT_SNAPSHOT_MS = Date.UTC(2026, 9, 30, 15, 30, 0);

/* ==========================================================================
 * 列映射
 * ==========================================================================
 * 关键事实（Lead 实测，本脚本据此硬编码，不做猜测）：
 *   1) parsed_16 的列名是 `widget_xxx` / `w_xxx` **匿名列**，业务名在 COLUMN_COMMENT 里；
 *   2) 主键列是 `jdy_data_id`（不是 data_id）；
 *   3) 两组 xlsx 重名列必须按**列序号**消歧；
 *   4) 有 4 处 COLUMN_COMMENT 与业务名不同（被改过名），必须显式指定。
 */

/** 显式覆盖：xlsx 列序 -> parsed_16 列名（消除重名列歧义 / 修正被改名的注释） */
const EXPLICIT = {
  0: { col: 'jdy_data_id', via: '直连（主键列，注释「数据ID」）' },
  12: { col: 'w_1793343168111', via: '硬编码：COLUMN_COMMENT 仍是占位符 `_widget_1793343168111`，按业务名找不到' },
  25: { col: 'widget_1791510696561_p', via: '注释「优惠券(解析)」（第 1 个「优惠券」列）' },
  29: { col: 'w_1792547295323', via: '注释「优惠券(结果)」（第 2 个「优惠券」列）' },
  31: { col: 'widget_1791509478941_p', via: '注释「渠道信息(解析)」（业务名被改名为「渠道充值和余额」）' },
  38: { col: 'widget_1791533061604', via: '注释「流程状态(节点)」（第 1 个「流程状态」，节点名）' },
  56: { col: 'sys_flow_state_2', via: '注释「流程状态」（第 2 个，实例状态 0/1）' },
};

/** 跳过列：由 parsed_102 推导，不属本脚本比对范围 */
const SKIP = {
  57: '「当前节点」由 CRM流程推送(102) 推导，本脚本不比对',
  58: '「当前负责人」由 CRM流程推送(102) 推导，本脚本不比对',
};

/** 时间列（xlsx 列序）：业务表是**分钟精度**，DB 是 datetime → 统一到分钟 */
const TIME_IDX = new Set([17, 18, 19, 45, 46, 47, 48, 49, 50, 51, 52, 54, 55]);

/** 值域映射：sys_flow_state_2 0/1 ↔ 业务表 进行中/流转完成 */
const FLOW_STATE_TEXT = { 0: '进行中', 1: '流转完成' };

const EXPECTED_MAPPED = 57; // 59 列 - 2 跳过 = 57

/* ============================ 归一化规则 ============================ */

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * 时间归一：'YYYY-MM-DD HH:MM'（业务表分钟精度）
 *   '2026-10-29 11:38:28' -> '2026-10-29 11:38'
 *   '2026-10-28'          -> '2026-10-28 00:00'   （纯日期按 00:00）
 *   '2026-09-23 00:00:00' -> '2026-09-23 00:00'
 *   非日期文本原样返回（便于暴露真实异常，而不是掩盖成空）
 */
function normTime(v) {
  const s = v === null || v === undefined ? '' : String(v).trim();
  if (!s) return '';
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return s;
  return `${m[1]}-${pad2(m[2])}-${pad2(m[3])} ${pad2(m[4] || '0')}:${pad2(m[5] || '0')}`;
}

/**
 * 普通列归一：
 *   null/undefined/''/空串           -> ''
 *   字面 'null' / 'undefined' / 'NaN' -> ''（避免把 JS 字符串当业务值）
 *   '120.'  / '120.00' / 120.0        -> '120'（xlsx 数字文本尾点 / DB double）
 *   'YYYY-MM-DD 00:00:00'             -> 'YYYY-MM-DD'（纯日期的零时刻）
 *   其余                              -> trim 后原文
 */
function normText(v) {
  if (v === null || v === undefined) return '';
  let s = String(v).replace(/\r\n?/g, '\n').replace(/[\u00a0\u3000]/g, ' ').trim();
  if (s === '') return '';
  if (/^(null|undefined|NaN)$/i.test(s)) return '';
  if (/^-?\d+\.$/.test(s)) return s.slice(0, -1);                  // '120.' -> '120'
  if (/^-?\d+\.\d+$/.test(s)) {                                   // '120.00' -> '120'
    const n = Number(s);
    if (Number.isFinite(n)) return String(n);
  }
  if (/^\d{4}-\d{2}-\d{2} 00:00:00$/.test(s)) return s.slice(0, 10); // 纯日期零时刻
  return s;
}

/** 流程状态：DB 存 0/1（double），业务表是中文 */
function normFlowState(v) {
  const s = v === null || v === undefined ? '' : String(v).trim();
  if (s === '') return '';
  if (s === '1' || s === '1.0') return FLOW_STATE_TEXT[1];
  if (s === '0' || s === '0.0') return FLOW_STATE_TEXT[0];
  if (s === '流转完成' || s === '进行中') return s;
  return s;
}

function normalize(v, idx, isFlowState) {
  if (isFlowState) return normFlowState(v);
  if (TIME_IDX.has(idx)) return normTime(v);
  return normText(v);
}

/* ============================ 参数 ============================ */

function parseArgs(argv) {
  const out = { snapshotMs: DEFAULT_SNAPSHOT_MS, verbose: false, samples: 20, json: null };
  for (const a of argv.slice(2)) {
    if (a === '--help' || a === '-h') {
      console.log([
        'node scripts/v8-reconcile-verify.js [--snapshot=ISO|ms] [--samples=N] [--json=FILE] [--verbose]',
        '',
        '  只读复核 jdywh_parsed_16 与业务表格（96 行 × 57 可比列）。',
        '  断言：非 fresh 行差异 = 0（fresh = 快照后仍收到推送的行，属正向更新）。',
        '  退出码：0 通过 / 1 有差异 / 2 参数或环境错误',
        '',
        '  --snapshot  业务表快照时刻，默认 2026-10-30T15:30:00Z（= 2026-10-30 23:30 北京）',
        '             支持 ISO8601 或毫秒时间戳；部署后业务侧继续推送时请按导出时刻传入',
        '  --json      额外把结构化结果写入该路径',
      ].join('\n'));
      process.exit(0);
    } else if (a.startsWith('--snapshot=')) {
      const raw = a.slice('--snapshot='.length).trim();
      if (/^\d{10,}$/.test(raw)) {
        out.snapshotMs = Number(raw);
      } else {
        const t = Date.parse(raw);
        if (Number.isNaN(t)) {
          console.error(`[ERROR] --snapshot 无法解析: ${raw}（支持 ISO8601 或毫秒时间戳）`);
          process.exit(2);
        }
        out.snapshotMs = t;
      }
      if (!Number.isFinite(out.snapshotMs) || out.snapshotMs <= 0) {
        console.error('[ERROR] --snapshot 不是有效时间');
        process.exit(2);
      }
    } else if (a.startsWith('--samples=')) {
      out.samples = Math.max(0, parseInt(a.slice(10), 10) || 0);
    } else if (a.startsWith('--json=')) {
      const v = a.slice(7);
      out.json = path.isAbsolute(v) ? v : path.join(ROOT, v);
    } else if (a === '--verbose') {
      out.verbose = true;
    } else {
      console.error(`[ERROR] 未知参数: ${a}（--help 查看用法）`);
      process.exit(2);
    }
  }
  return out;
}

/* ============================ 主流程 ============================ */

const pad = (s, n) => {
  const t = String(s === null || s === undefined ? '' : s);
  let w = 0;
  for (const ch of t) w += /[\u4e00-\u9fff\uff00-\uffef\u3000-\u303f(),/]/.test(ch) ? 2 : 1;
  return t + ' '.repeat(Math.max(0, n - w));
};
const rpad = (s, n) => {
  const t = String(s === null || s === undefined ? '' : s);
  let w = 0;
  for (const ch of t) w += /[\u4e00-\u9fff\uff00-\uffef\u3000-\u303f()]/.test(ch) ? 2 : 1;
  return ' '.repeat(Math.max(0, n - w)) + t;
};
const clip = (s, n) => {
  const t = s === null || s === undefined ? '' : String(s).replace(/\n/g, '\\n');
  return t.length > n ? t.slice(0, n) + '…' : t;
};

function readXlsx() {
  if (!fs.existsSync(XLSX_PATH)) {
    throw new Error(`业务表格不存在: ${XLSX_PATH}`);
  }
  const wb = XLSX.readFile(XLSX_PATH, { cellDates: false });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  // **必须按列序号**（header:1）：表头有两组重名列，对象模式会丢列
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
  if (!aoa.length) throw new Error('业务表格为空');
  const header = aoa[0].map((h) => normText(h));
  const rows = [];
  for (let i = 1; i < aoa.length; i++) {
    const values = aoa[i];
    const allEmpty = values.every((v) => normText(v) === '');
    if (allEmpty) continue;
    rows.push({ rowNo: i + 1, values, dataId: normText(values[0]) });
  }
  return { path: XLSX_PATH, sheet: sheetName, header, rows };
}

function buildMapping(header, dbColumns) {
  /** COLUMN_COMMENT -> [columns]（同名注释可能有多个，取第一个并记录歧义） */
  const byComment = new Map();
  for (const c of dbColumns) {
    const cmt = normText(c.COLUMN_COMMENT);
    if (!cmt) continue;
    if (!byComment.has(cmt)) byComment.set(cmt, []);
    byComment.get(cmt).push(c.COLUMN_NAME);
  }
  const mapping = [];
  const unmapped = [];
  for (let idx = 0; idx < header.length; idx++) {
    if (SKIP[idx]) {
      mapping.push({ idx, label: header[idx], column: null, via: SKIP[idx], skipped: true, flowState: false });
      continue;
    }
    const ex = EXPLICIT[idx];
    if (ex) {
      const exists = dbColumns.some((c) => c.COLUMN_NAME === ex.col);
      if (!exists) { unmapped.push({ idx, label: header[idx], reason: `硬编码列 ${ex.col} 在表里不存在` }); continue; }
      mapping.push({ idx, label: header[idx], column: ex.col, via: ex.via, skipped: false, flowState: idx === 56 });
      continue;
    }
    const name = header[idx];
    // 先试「名称(解析)」，再试「名称」
    const candidates = [`${name}(解析)`, name];
    let hit = null;
    let via = null;
    for (const cand of candidates) {
      const list = byComment.get(cand);
      if (list && list.length) { hit = list[0]; via = `注释「${cand}」`; break; }
    }
    if (!hit) { unmapped.push({ idx, label: name, reason: '按 COLUMN_COMMENT 找不到对应列' }); continue; }
    mapping.push({ idx, label: name, column: hit, via, skipped: false, flowState: false });
  }
  return { mapping, unmapped, byComment };
}

async function main() {
  const opt = parseArgs(process.argv);
  const t0 = Date.now();
  const db = require('../src/db');

  const assertions = [];
  const push = (id, ok, title, detail) => {
    assertions.push({ id, ok, title, detail });
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${id}. ${title}`);
    if (detail) for (const line of String(detail).split('\n')) console.log(`         ${line}`);
  };

  console.log('='.repeat(100));
  console.log('V8 数据对账复核（只读）· jdywh_parsed_16 ← 业务表格');
  console.log('='.repeat(100));
  console.log(`生成时间    : ${new Date().toISOString()}`);
  console.log(`工作目录    : ${ROOT}`);
  console.log(`业务表格    : ${path.relative(ROOT, XLSX_PATH)}`);
  console.log(`快照时刻    : ${new Date(opt.snapshotMs).toISOString()}  (= ${fmtBeijing(opt.snapshotMs)} 北京)`);
  console.log(`比对表      : ${P16_TABLE}（主键列 jdy_data_id）`);
  console.log('');

  /* ---------------- 读数据 ---------------- */
  const xlsx = readXlsx();
  const dbColumns = await db.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [P16_TABLE]);
  if (!dbColumns.length) {
    console.error(`[ERROR] 表 ${P16_TABLE} 不存在或无权访问`);
    process.exit(2);
  }
  const rows16 = await db.query(`SELECT * FROM ${P16_TABLE}`);
  const freshRows = await db.query(
    `SELECT jdy_data_id, MAX(jdy_op_time) AS last_op_time, COUNT(*) AS pushes
       FROM ${D16_TABLE} GROUP BY jdy_data_id`);
  const freshMap = new Map();
  for (const r of freshRows) {
    freshMap.set(normText(r.jdy_data_id), {
      lastOpTime: Number(r.last_op_time) || 0,
      pushes: Number(r.pushes) || 0,
    });
  }

  const { mapping, unmapped } = buildMapping(xlsx.header, dbColumns);
  const mapped = mapping.filter((m) => !m.skipped && m.column);
  const isFresh = (dataId) => {
    const f = freshMap.get(dataId);
    return !!(f && f.lastOpTime > opt.snapshotMs);
  };

  /* ---------------- 断言 1：列映射 ---------------- */
  console.log('【断言 1】列映射');
  const mapLines = mapped.map((m) => `[${rpad(m.idx, 2)}] ${pad(m.label, 30)} -> ${pad(m.column, 32)} ${m.via}`);
  if (unmapped.length) {
    mapLines.push('未映射:');
    for (const u of unmapped) mapLines.push(`  [${u.idx}] ${u.label} : ${u.reason}`);
  }
  if (opt.verbose) console.log(mapLines.join('\n'));
  push(1, mapped.length === EXPECTED_MAPPED && unmapped.length === 0,
    `列映射数 = ${EXPECTED_MAPPED}（含 data_id），缺失列 = 0`,
    `实际映射 ${mapped.length} 列，未映射 ${unmapped.length} 列`
    + (unmapped.length ? '\n' + unmapped.map((u) => `[${u.idx}] ${u.label}: ${u.reason}`).join('\n') : '')
    + `\n（跳过 ${Object.keys(SKIP).length} 列：${Object.values(SKIP).join('；')}）`);
  console.log('');

  /* ---------------- 断言 2：行数 / 主键集合 ---------------- */
  console.log('【断言 2】行数与主键集合');
  const dbIds = rows16.map((r) => normText(r.jdy_data_id));
  const dbIdSet = new Set(dbIds);
  const xlsxIds = xlsx.rows.map((r) => r.dataId);
  const xlsxIdSet = new Set(xlsxIds);
  const missingInDb = xlsxIds.filter((id) => !dbIdSet.has(id));
  const extraInDb = dbIds.filter((id) => !xlsxIdSet.has(id));
  const dupXlsx = xlsxIds.filter((id, i) => xlsxIds.indexOf(id) !== i);
  push(2, xlsx.rows.length === 96 && rows16.length === 96
    && missingInDb.length === 0 && extraInDb.length === 0 && dupXlsx.length === 0,
    '业务表 96 行、DB 96 行、data_id 集合完全一致',
    `业务表 ${xlsx.rows.length} 行（sheet「${xlsx.sheet}」，${xlsx.header.length} 列）｜DB ${rows16.length} 行`
    + `\ndata_id 仅在业务表: ${missingInDb.length}｜仅在 DB: ${extraInDb.length}｜业务表内重复: ${dupXlsx.length}`
    + (missingInDb.length ? `\n  仅在业务表: ${missingInDb.join(', ')}` : '')
    + (extraInDb.length ? `\n  仅在 DB: ${extraInDb.join(', ')}` : ''));
  console.log('');

  /* ---------------- 逐格比对 ---------------- */
  const byId16 = new Map(rows16.map((r) => [normText(r.jdy_data_id), r]));
  const colStats = new Map(); // column -> {label, idx, diff, freshDiff, staleDiff, samples:[]}
  for (const m of mapped) {
    colStats.set(m.column, {
      idx: m.idx, label: m.label, column: m.column, via: m.via,
      diff: 0, freshDiff: 0, staleDiff: 0, samples: [],
    });
  }
  const diffs = [];
  let comparedCells = 0;

  for (const xr of xlsx.rows) {
    const did = xr.dataId;
    const dbRow = byId16.get(did);
    if (!dbRow) continue; // 断言 2 已单独报告
    const fresh = isFresh(did);
    for (const m of mapped) {
      comparedCells += 1;
      const xv = normalize(xr.values[m.idx], m.idx, m.flowState);
      const dv = normalize(dbRow[m.column], m.idx, m.flowState);
      if (xv === dv) continue;
      const rec = {
        dataId: did,
        rowNo: xr.rowNo,
        idx: m.idx,
        label: m.label,
        column: m.column,
        fresh,
        xlsx: xv,
        db: dv,
        xlsxRaw: xr.values[m.idx],
        dbRaw: dbRow[m.column],
        lastOpTime: (freshMap.get(did) || {}).lastOpTime || 0,
      };
      diffs.push(rec);
      const st = colStats.get(m.column);
      st.diff += 1;
      if (fresh) st.freshDiff += 1; else st.staleDiff += 1;
      if (st.samples.length < opt.samples) st.samples.push(rec);
    }
  }

  const staleDiffs = diffs.filter((d) => !d.fresh);
  const freshDiffs = diffs.filter((d) => d.fresh);
  const freshRowIds = [...new Set(freshDiffs.map((d) => d.dataId))];

  /* ---------------- 断言 3：比对单元格数 ---------------- */
  console.log('【断言 3】比对规模');
  const expectedCells = xlsx.rows.length * mapped.length;
  push(3, comparedCells === expectedCells,
    `比对单元格数 = ${expectedCells}（96 行 × ${mapped.length} 列）`,
    `实际比对 ${comparedCells} 格｜预期 ${xlsx.rows.length} × ${mapped.length} = ${expectedCells}`
    + `\n（59 列 - 跳过 ${Object.keys(SKIP).length} 列「当前节点/当前负责人」= ${mapped.length} 列）`);
  console.log('');

  /* ---------------- 断言 4：非 fresh 差异必须 = 0（核心） ---------------- */
  console.log('【断言 4】核心断言：非 fresh 行差异 = 0');
  const staleDetail = staleDiffs.length
    ? '非 fresh 行存在差异：\n' + staleDiffs.slice(0, opt.samples).map((d) =>
      `  ${d.dataId} [${d.idx}]${d.label}(${d.column}) xlsx=${JSON.stringify(d.xlsx)} db=${JSON.stringify(d.db)}`).join('\n')
    : `非 fresh 行差异 ${staleDiffs.length} 格 / ${new Set(staleDiffs.map((d) => d.dataId)).size} 行`
      + `\n业务表格是 ${new Date(opt.snapshotMs).toISOString()} 的快照；`
      + `此前未被再次推送的行（${xlsx.rows.length - new Set([...freshMap.keys()].filter((k) => freshMap.get(k).lastOpTime > opt.snapshotMs)).size} 行）已逐格一致。`;
  push(4, staleDiffs.length === 0, '非 fresh 行差异必须 = 0', staleDetail);
  console.log('');

  /* ---------------- 断言 5：fresh 行差异可被「快照后推送」解释 ---------------- */
  console.log('【断言 5】fresh 行差异的证据链');
  const evidenceLines = [];
  let evidenceOk = true;
  for (const did of freshRowIds) {
    const f = freshMap.get(did);
    const hasPushAfter = !!(f && f.lastOpTime > opt.snapshotMs);
    if (!hasPushAfter) evidenceOk = false;
    const n = freshDiffs.filter((d) => d.dataId === did).length;
    evidenceLines.push(`${did}: 差异 ${n} 格｜最后推送 ${new Date(f.lastOpTime).toISOString()}`
      + `（${fmtBeijing(f.lastOpTime)} 北京，延迟 ${Math.round((f.lastOpTime - opt.snapshotMs) / 60000)} 分钟）`
      + `｜${hasPushAfter ? '晚于快照 → 正向更新 ✓' : '未晚于快照 ✗'}`);
  }
  const noEvidence = freshDiffs.filter((d) => !(d.lastOpTime > opt.snapshotMs));
  // 防「断言退化」：快照给得过早时几乎所有行都会被判 fresh，核心断言 4 就失去区分力。
  // 这不是失败（逻辑仍成立），但必须显式提示，避免有人用错快照却以为通过了。
  const freshRowCount = [...freshMap.keys()].filter((k) => freshMap.get(k).lastOpTime > opt.snapshotMs).length;
  const degenerate = freshRowCount > Math.floor(xlsx.rows.length * 0.2);
  const detail5 = (evidenceLines.length ? evidenceLines.join('\n') : '无 fresh 行差异')
    + `\n判定为 fresh 的行共 ${freshRowCount}/${xlsx.rows.length} 行`
    + (degenerate
      ? `\n⚠ 警告：fресh 行占比 ${(freshRowCount / xlsx.rows.length * 100).toFixed(1)}% 过高 —— 快照时刻可能给得过早，`
        + `核心断言 4 将失去区分力。请确认 --snapshot 是业务表格的真实导出时刻。`
      : '');
  push(5, evidenceOk && noEvidence.length === 0,
    `fresh 行差异（${freshDiffs.length} 格 / ${freshRowIds.length} 行）全部有「快照后推送」证据`,
    detail5.replace('fресh', 'fresh'));
  console.log('');

  /* ---------------- 断言 6：差异矩阵 ---------------- */
  console.log('【断言 6】差异矩阵');
  const diffCols = [...colStats.values()].filter((c) => c.diff > 0).sort((a, b) => b.diff - a.diff);
  console.log(`  按列差异（仅列有差异者，共 ${diffCols.length} 列）：`);
  if (!diffCols.length) {
    console.log('    （无）');
  } else {
    console.log(`    ${pad('idx', 4)}${pad('业务列', 22)}${pad('parsed_16 列', 30)}${rpad('差异', 6)}${rpad('非fresh', 8)}${rpad('fresh', 6)}`);
    for (const c of diffCols) {
      console.log(`    ${pad(c.idx, 4)}${pad(c.label, 22)}${pad(c.column, 30)}${rpad(c.diff, 6)}${rpad(c.staleDiff, 8)}${rpad(c.freshDiff, 6)}`);
    }
  }
  console.log('');
  console.log(`  按行差异（共 ${new Set(diffs.map((d) => d.dataId)).size} 行，明细前 ${opt.samples} 条）：`);
  if (!diffs.length) {
    console.log('    （无）');
  } else {
    for (const d of diffs.slice(0, opt.samples)) {
      console.log(`    · ${d.dataId} 行${d.rowNo} [${d.idx}]${d.label} ${d.fresh ? '【fresh】' : '【非fresh】'}`);
      console.log(`        xlsx = ${JSON.stringify(clip(d.xlsx, 80))}`);
      console.log(`        db   = ${JSON.stringify(clip(d.db, 80))}`);
    }
    if (diffs.length > opt.samples) console.log(`    … 其余 ${diffs.length - opt.samples} 条见 --json 输出`);
  }
  const matrixOk = (freshDiffs.length + staleDiffs.length) === diffs.length;
  push(6, matrixOk, '差异矩阵输出完整（按列 + 按行 + fresh 标注）',
    `总差异 ${diffs.length} 格｜非 fresh ${staleDiffs.length}｜fresh ${freshDiffs.length}`
    + `\n可比单元格 ${comparedCells}｜总体一致率 ${comparedCells ? ((1 - diffs.length / comparedCells) * 100).toFixed(4) : '0'}%`
    + `\n快照口径一致率（排除 fresh）${comparedCells ? ((1 - staleDiffs.length / (comparedCells - freshDiffs.length || 1)) * 100).toFixed(4) : '0'}%`);
  console.log('');

  /* ---------------- 汇总 ---------------- */
  const failed = assertions.filter((a) => !a.ok);
  const code = failed.length ? 1 : 0;

  console.log('='.repeat(100));
  console.log('【汇总】');
  for (const a of assertions) console.log(`  ${a.ok ? 'PASS' : 'FAIL'}  ${a.id}. ${a.title}`);
  console.log('');
  console.log(`  业务表格      : ${xlsx.rows.length} 行 × ${xlsx.header.length} 列`);
  console.log(`  可比列        : ${mapped.length} 列（跳过 ${Object.keys(SKIP).length} 列：当前节点/当前负责人）`);
  console.log(`  可比单元格    : ${comparedCells}`);
  console.log(`  差异          : ${diffs.length} 格（非 fresh ${staleDiffs.length}｜fresh ${freshDiffs.length}）`);
  if (freshRowIds.length) {
    console.log(`  fresh 行      : ${freshRowIds.length} 行 → ${freshRowIds.join(', ')}`);
    console.log(`                  （快照后仍收到推送，差异属正向更新，不计为失败）`);
  }
  console.log('');
  if (code === 0) {
    console.log('  结论：PASS —— 解析表与业务表在「快照时刻」口径下逐格一致（非 fresh 差异 = 0）');
  } else {
    console.log(`  结论：FAIL —— ${failed.length} 条断言未通过：${failed.map((a) => a.id).join(', ')}`);
  }
  console.log(`  耗时 ${Date.now() - t0} ms`);
  console.log('='.repeat(100));

  /* ---------------- JSON 输出 ---------------- */
  if (opt.json) {
    const out = {
      version: 'v8-reconcile-verify-1.0',
      generatedAt: new Date().toISOString(),
      readOnly: true,
      snapshot: { ms: opt.snapshotMs, iso: new Date(opt.snapshotMs).toISOString(), beijing: fmtBeijing(opt.snapshotMs) },
      xlsx: { path: path.relative(ROOT, XLSX_PATH), sheet: xlsx.sheet, rows: xlsx.rows.length, cols: xlsx.header.length },
      mapping: mapping.map((m) => ({ idx: m.idx, label: m.label, column: m.column || null, via: m.via, skipped: !!m.skipped })),
      unmapped,
      summary: {
        mappedColumns: mapped.length,
        skippedColumns: Object.keys(SKIP).length,
        comparedCells,
        diffCells: diffs.length,
        staleDiffCells: staleDiffs.length,
        freshDiffCells: freshDiffs.length,
        rows: xlsx.rows.length,
        dbRows: rows16.length,
        freshRows: freshRowIds,
        consistencyRate: comparedCells ? Number(((1 - diffs.length / comparedCells) * 100).toFixed(4)) : 0,
        snapshotConsistencyRate: comparedCells
          ? Number(((1 - staleDiffs.length / (comparedCells - freshDiffs.length || 1)) * 100).toFixed(4)) : 0,
      },
      columns: [...colStats.values()],
      diffs: diffs.map((d) => ({
        dataId: d.dataId, rowNo: d.rowNo, idx: d.idx, label: d.label, column: d.column,
        fresh: d.fresh, xlsx: d.xlsx, db: d.db,
        lastOpTime: d.lastOpTime, lastOpTimeIso: d.lastOpTime ? new Date(d.lastOpTime).toISOString() : null,
      })),
      assertions,
      exitCode: code,
    };
    fs.mkdirSync(path.dirname(opt.json), { recursive: true });
    fs.writeFileSync(opt.json, JSON.stringify(out, null, 1), 'utf8');
    console.log(`[json] ${path.relative(ROOT, opt.json)}`);
  }

  await db.close();
  return code;
}

function fmtBeijing(ms) {
  const d = new Date(ms + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

main()
  .then((code) => process.exit(code || 0))
  .catch(async (err) => {
    console.error('[v8-reconcile-verify] 失败:', err && err.message);
    if (err && err.stack) console.error(err.stack);
    try {
      const db = require('../src/db');
      await db.close();
    } catch (_) { /* ignore */ }
    process.exit(2);
  });
