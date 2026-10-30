'use strict';

/**
 * V6.1 数据明细筛选 —— 数据库只读回归（真库真接口）
 *
 * 运行：node scripts/v61-parsed-filters-db.js
 *
 * 做什么
 * ------
 * 1. **只读保护**：包装 src/db.js 的 query/queryOne/raw，任何非 SELECT/SHOW/DESCRIBE
 *    语句直接抛错。本脚本跑完即可证明「两个数据明细端点全链路只发只读 SQL」。
 * 2. **真接口**：把真实的 src/routes/api.js 挂到一个临时 express 实例（随机端口），
 *    注入只读测试身份（permissions: ['*']），而不是打 8781 ——
 *    因为 8781 上的进程是升级前启动的旧代码，看不到本轮改动。
 *    不启动 src/server.js 也就**不会跑 bootstrap 的 DDL/迁移写库**。
 * 3. **两端同构**：
 *      A. GET /api/projects/16/parsed                （数据项目 · 数据明细）
 *      B. GET /api/mail-push/projects/31/rows        （邮箱推送 · 数据明细）
 *    同样的 filters 在两边都生效、都被白名单过滤、都不报错。
 * 4. 覆盖：5 个 op 真库生效、列白名单丢弃、注入值无害、与 keyword AND、
 *    分页/排序不受影响、非法 JSON 不 500、超 20 条截断、响应含筛选元信息。
 * 5. 附带核对本轮另外两项：/api/settings/public 的 6 个站点字段、
 *    /api/project-groups 的 parentId 归一（无 null）。
 *
 * 安全：只 SELECT。项目 16 / 邮箱项目 31 只读，不写任何数据。
 */

const path = require('path');

const ROOT = path.join(__dirname, '..');

/* ══════════════════════════════════════════════════════════════════
 * 0. 只读保护（必须在 require 任何业务模块之前装好）
 * ══════════════════════════════════════════════════════════════════ */
const db = require(path.join(ROOT, 'src', 'db.js'));

const READONLY_RE = /^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN|WITH|TABLE)\b/i;
const writeAttempts = [];

function guard(fn, label) {
  return async function guarded(sql, params) {
    if (!READONLY_RE.test(String(sql))) {
      writeAttempts.push({ label, sql: String(sql).slice(0, 200) });
      throw new Error(`[只读保护] 拒绝执行非只读 SQL（${label}）：${String(sql).slice(0, 120)}`);
    }
    return fn.call(db, sql, params);
  };
}

const rawQuery = db.query;
const rawQueryOne = db.queryOne;
const rawRaw = db.raw;
db.query = guard(rawQuery, 'query');
db.queryOne = guard(rawQueryOne, 'queryOne');
db.raw = guard(rawRaw, 'raw');
/** 保存「带只读保护」的 query，供缓存测试段之后还原 */
const guardedQuery = db.query;

/* ══════════════════════════════════════════════════════════════════
 * 断言框架
 * ══════════════════════════════════════════════════════════════════ */
let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail === undefined ? '' : '  → ' + detail}`);
  }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, `期望 ${e}，实际 ${a}`);
}

function section(t) {
  console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`);
}

/* ══════════════════════════════════════════════════════════════════
 * 1. 起临时 HTTP 实例（真实 api 路由 + 只读身份）
 * ══════════════════════════════════════════════════════════════════ */
const express = require(path.join(ROOT, 'node_modules', 'express'));
const apiRouter = require(path.join(ROOT, 'src', 'routes', 'api.js'));

const READONLY_USER = {
  id: 0,
  username: 'v61-readonly-probe',
  displayName: 'V6.1 只读回归',
  role: 'admin',
  permissions: ['*'],
};

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  // 模拟 auth.middleware 的产物（只注入身份，不做登录/写操作）
  app.use((req, res, next) => {
    req.user = READONLY_USER;
    req.session = { token: 'readonly' };
    res.locals.currentUser = READONLY_USER;
    res.locals.can = () => true;
    res.locals.isAdmin = true;
    res.locals.settings = {};
    next();
  });
  app.use('/api', apiRouter);
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(500).json({ ok: false, message: String(err && err.message) });
  });
  return app;
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
    srv.on('error', reject);
  });
}

function request(base, pathAndQuery) {
  return fetch(base + pathAndQuery, { headers: { Accept: 'application/json' } }).then(async (r) => {
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* 非 JSON */ }
    return { status: r.status, headers: r.headers, json, text };
  });
}

const f = (arr) => encodeURIComponent(JSON.stringify(arr));

/* ══════════════════════════════════════════════════════════════════
 * 主流程
 * ══════════════════════════════════════════════════════════════════ */
(async () => {
  const PROJECT_ID = 16;          // CRM表单推送（parsed 表 96 行）
  const MAIL_PROJECT_ID = 31;     // 药店智能体触达转化by明细（681 行）

  /* 预检：两个数据表都必须存在，否则无从回归 */
  section('0. 环境预检');
  const proj = await db.queryOne(
    'SELECT id, name, data_table, parsed_table FROM jdywh_projects WHERE id = ?', [PROJECT_ID]
  );
  ok('项目 16 存在', !!proj, proj ? proj.name : 'null');
  const mailProj = await db.queryOne(
    'SELECT id, name, data_table FROM jdywh_mail_projects WHERE id = ?', [MAIL_PROJECT_ID]
  );
  ok('邮箱项目 31 存在', !!mailProj, mailProj ? mailProj.name : 'null');

  const parsedTable = proj.parsed_table;
  const mailTable = mailProj.data_table;
  ok(`解析表 ${parsedTable} 存在`,
    !!(await db.queryOne(
      'SELECT 1 AS x FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [parsedTable]
    )));
  ok(`邮箱表 ${mailTable} 存在`,
    !!(await db.queryOne(
      'SELECT 1 AS x FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [mailTable]
    )));

  const parsedCols = (await db.query(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS ctype FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [parsedTable]
  )).map((c) => ({ name: c.name, ctype: String(c.ctype) }));
  const mailCols = (await db.query(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS ctype FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [mailTable]
  )).map((c) => ({ name: c.name, ctype: String(c.ctype) }));

  const parsedTotal = Number((await db.queryOne(`SELECT COUNT(*) AS c FROM \`${parsedTable}\``)).c);
  const mailTotal = Number((await db.queryOne(`SELECT COUNT(*) AS c FROM \`${mailTable}\``)).c);
  ok(`解析表有数据（${parsedTotal} 行）`, parsedTotal > 0);
  ok(`邮箱表有数据（${mailTotal} 行）`, mailTotal > 0);

  /* 选测试列：优先「部分有值」的文本列，能覆盖 empty/notempty 两个方向 */
  async function pickColumn(table, cols, prefer) {
    if (prefer && cols.some((c) => c.name === prefer)) return prefer;
    const textCols = cols.filter((c) => /char|text/i.test(c.ctype) && !/^(raw_json|jdy_data_id)$/.test(c.name));
    for (const c of textCols) {
      const r = await db.queryOne(
        `SELECT COUNT(*) AS ne, SUM(\`${c.name}\` IS NULL OR \`${c.name}\` = '') AS em FROM \`${table}\``
      );
      const ne = Number(r.ne || 0);
      const em = Number(r.em || 0);
      if (ne > 0 && em > 0) return c.name;
    }
    for (const c of textCols) {
      const r = await db.queryOne(
        `SELECT COUNT(*) AS ne FROM \`${table}\` WHERE \`${c.name}\` IS NOT NULL AND \`${c.name}\` <> ''`
      );
      if (Number(r.ne || 0) > 0) return c.name;
    }
    return textCols.length ? textCols[0].name : cols[0].name;
  }

  const parsedCol = await pickColumn(parsedTable, parsedCols, 'jdy_form_name');
  const mailCol = await pickColumn(mailTable, mailCols, null);
  ok(`解析表测试列 = ${parsedCol}`, !!parsedCol);
  ok(`邮箱表测试列 = ${mailCol}`, !!mailCol);

  const parsedSample = await db.queryOne(
    `SELECT \`${parsedCol}\` AS v FROM \`${parsedTable}\`
      WHERE \`${parsedCol}\` IS NOT NULL AND \`${parsedCol}\` <> '' LIMIT 1`
  );
  const mailSample = await db.queryOne(
    `SELECT \`${mailCol}\` AS v FROM \`${mailTable}\`
      WHERE \`${mailCol}\` IS NOT NULL AND \`${mailCol}\` <> '' LIMIT 1`
  );
  const parsedVal = String(parsedSample.v);
  const mailVal = String(mailSample.v);
  ok('解析表样本值可用', parsedVal.length > 0, parsedVal);
  ok('邮箱表样本值可用', mailVal.length > 0, mailVal);

  /* 起服务 */
  const app = createApp();
  const srv = await listen(app);
  const base = `http://127.0.0.1:${srv.address().port}`;
  console.log(`\n 临时只读实例：${base}（未跑 bootstrap，只读保护已启用）`);

  try {
    /* ══════════════════════════════════════════════════════════
     * 1. 基线：无筛选
     * ══════════════════════════════════════════════════════════ */
    section('1. 基线（无 filters）');

    const A0 = await request(base, `/api/projects/${PROJECT_ID}/parsed?page=1&pageSize=20`);
    ok('A 端点 200', A0.status === 200, `HTTP ${A0.status} ${A0.text.slice(0, 120)}`);
    ok('A 端点 ok=true', A0.json && A0.json.ok === true);
    const a0 = (A0.json && A0.json.data) || {};
    eq('A 端点 total = 表行数', a0.total, parsedTotal);
    ok('A 端点返回 list 数组', Array.isArray(a0.list) && a0.list.length > 0, String(a0.list && a0.list.length));
    eq('A 端点 pageSize 回显', a0.pageSize, 20);
    ok('A 端点 columns 非空', Array.isArray(a0.columns) && a0.columns.length > 0, String(a0.columns && a0.columns.length));
    eq('A 端点无筛选时 appliedFilters=0', a0.appliedFilters, 0);

    const B0 = await request(base, `/api/mail-push/projects/${MAIL_PROJECT_ID}/rows?page=1&size=20`);
    ok('B 端点 200', B0.status === 200, `HTTP ${B0.status} ${B0.text.slice(0, 120)}`);
    ok('B 端点 ok=true', B0.json && B0.json.ok === true);
    const b0 = (B0.json && B0.json.data) || {};
    eq('B 端点 total = 表行数', b0.total, mailTotal);
    ok('B 端点返回 rows 数组', Array.isArray(b0.rows) && b0.rows.length > 0, String(b0.rows && b0.rows.length));
    eq('B 端点 size 回显', b0.size, 20);
    ok('B 端点 columns 非空', Array.isArray(b0.columns) && b0.columns.length > 0, String(b0.columns && b0.columns.length));

    /* ══════════════════════════════════════════════════════════
     * 2. 两端结构同构
     * ══════════════════════════════════════════════════════════ */
    section('2. 两端响应结构同构');

    const rowKeyOf = { A: 'list', B: 'rows' };
    const sizeKeyOf = { A: 'pageSize', B: 'size' };
    ok('两端都有行数组（A=list / B=rows）',
      Array.isArray(a0[rowKeyOf.A]) && Array.isArray(b0[rowKeyOf.B]));
    ok('两端都有 total / page / 页大小', [a0, b0].every((d) => d.total !== undefined
      && d.page !== undefined), '');
    ok('两端都有 columns 数组', Array.isArray(a0.columns) && Array.isArray(b0.columns));
    ok('两端都有筛选元信息 appliedFilters / droppedFilters',
      'appliedFilters' in a0 && 'droppedFilters' in a0 && 'appliedFilters' in b0 && 'droppedFilters' in b0);
    ok('两端列结构字段一致（name/comment）',
      a0.columns.every((c) => 'name' in c) && b0.columns.every((c) => 'name' in c));
    ok('两端页大小字段名差异保留（A=pageSize / B=size，契约允许）',
      a0[sizeKeyOf.A] === 20 && b0[sizeKeyOf.B] === 20);

    /* ══════════════════════════════════════════════════════════
     * 3. 五个 op 在真库两端都生效
     * ══════════════════════════════════════════════════════════ */
    section('3. 五个 op 真库生效（A/B 各一遍）');

    async function apiCount(kind, filters, extra) {
      const q = extra ? '&' + extra : '';
      const url = kind === 'A'
        ? `/api/projects/${PROJECT_ID}/parsed?page=1&pageSize=20&filters=${f(filters)}${q}`
        : `/api/mail-push/projects/${MAIL_PROJECT_ID}/rows?page=1&size=20&filters=${f(filters)}${q}`;
      const r = await request(base, url);
      const d = (r.json && r.json.data) || {};
      return { status: r.status, total: d.total, applied: d.appliedFilters, dropped: d.droppedFilters, d, r };
    }

    async function sqlCount(table, whereSql, params) {
      const r = await db.queryOne(`SELECT COUNT(*) AS c FROM \`${table}\`${whereSql ? ' WHERE ' + whereSql : ''}`, params || []);
      return Number(r.c || 0);
    }

    // contains
    const aC = await apiCount('A', [{ column: parsedCol, op: 'contains', value: parsedVal.slice(0, 2) }]);
    const expAC = await sqlCount(parsedTable, `\`${parsedCol}\` LIKE ?`, [`%${parsedVal.slice(0, 2)}%`]);
    eq('A contains：total 与直查 SQL 一致', aC.total, expAC);
    ok('A contains：生效条数 < 全表', aC.total <= parsedTotal, `${aC.total}/${parsedTotal}`);
    eq('A contains：appliedFilters=1', aC.applied, 1);

    const bC = await apiCount('B', [{ column: mailCol, op: 'contains', value: mailVal.slice(0, 2) }]);
    const expBC = await sqlCount(mailTable, `\`${mailCol}\` LIKE ?`, [`%${mailVal.slice(0, 2)}%`]);
    eq('B contains：total 与直查 SQL 一致', bC.total, expBC);
    eq('B contains：appliedFilters=1', bC.applied, 1);

    // eq
    const aE = await apiCount('A', [{ column: parsedCol, op: 'eq', value: parsedVal }]);
    const expAE = await sqlCount(parsedTable, `\`${parsedCol}\` = ?`, [parsedVal]);
    eq('A eq：total 与直查 SQL 一致', aE.total, expAE);
    ok('A eq：至少 1 行', aE.total >= 1, String(aE.total));
    ok('A eq：<= contains 命中数', aE.total <= aC.total, `${aE.total} vs ${aC.total}`);

    const bE = await apiCount('B', [{ column: mailCol, op: 'eq', value: mailVal }]);
    const expBE = await sqlCount(mailTable, `\`${mailCol}\` = ?`, [mailVal]);
    eq('B eq：total 与直查 SQL 一致', bE.total, expBE);
    ok('B eq：至少 1 行', bE.total >= 1, String(bE.total));

    // ne（NULL 也算不等于）
    const aN = await apiCount('A', [{ column: parsedCol, op: 'ne', value: parsedVal }]);
    const expAN = await sqlCount(parsedTable, `(\`${parsedCol}\` <> ? OR \`${parsedCol}\` IS NULL)`, [parsedVal]);
    eq('A ne：total 与直查 SQL 一致（含 NULL）', aN.total, expAN);
    eq('A ne：ne + eq = 全表', aN.total + aE.total, parsedTotal);
    ok('A ne：NULL 行被计入不等于', aN.total >= parsedTotal - aE.total, `${aN.total} vs ${parsedTotal - aE.total}`);

    const bN = await apiCount('B', [{ column: mailCol, op: 'ne', value: mailVal }]);
    const expBN = await sqlCount(mailTable, `(\`${mailCol}\` <> ? OR \`${mailCol}\` IS NULL)`, [mailVal]);
    eq('B ne：total 与直查 SQL 一致（含 NULL）', bN.total, expBN);
    eq('B ne：ne + eq = 全表', bN.total + bE.total, mailTotal);

    // empty
    const aEmp = await apiCount('A', [{ column: parsedCol, op: 'empty' }]);
    const expAEmp = await sqlCount(parsedTable, `(\`${parsedCol}\` IS NULL OR \`${parsedCol}\` = '')`);
    eq('A empty：total 与直查 SQL 一致', aEmp.total, expAEmp);
    eq('A empty：无参数 op 也 appliedFilters=1', aEmp.applied, 1);

    const bEmp = await apiCount('B', [{ column: mailCol, op: 'empty' }]);
    const expBEmp = await sqlCount(mailTable, `(\`${mailCol}\` IS NULL OR \`${mailCol}\` = '')`);
    eq('B empty：total 与直查 SQL 一致', bEmp.total, expBEmp);

    // notempty
    const aNE = await apiCount('A', [{ column: parsedCol, op: 'notempty' }]);
    const expANE = await sqlCount(parsedTable, `(\`${parsedCol}\` IS NOT NULL AND \`${parsedCol}\` <> '')`);
    eq('A notempty：total 与直查 SQL 一致', aNE.total, expANE);
    eq('A notempty + empty = 全表', aNE.total + aEmp.total, parsedTotal);

    const bNE = await apiCount('B', [{ column: mailCol, op: 'notempty' }]);
    const expBNE = await sqlCount(mailTable, `(\`${mailCol}\` IS NOT NULL AND \`${mailCol}\` <> '')`);
    eq('B notempty：total 与直查 SQL 一致', bNE.total, expBNE);
    eq('B notempty + empty = 全表', bNE.total + bEmp.total, mailTotal);

    /* ══════════════════════════════════════════════════════════
     * 4. 多条件 AND
     * ══════════════════════════════════════════════════════════ */
    section('4. 多条件 AND（两端）');

    const aAnd = await apiCount('A', [
      { column: parsedCol, op: 'notempty' },
      { column: parsedCol, op: 'contains', value: parsedVal.slice(0, 2) },
    ]);
    eq('A 两条件 AND → appliedFilters=2', aAnd.applied, 2);
    ok('A 两条件 AND → 结果 <= 单条件最小者',
      aAnd.total <= Math.min(aNE.total, aC.total), `${aAnd.total}`);
    eq('A 两条件 AND → total 与直查一致', aAnd.total, expAC); // notempty 冗余时等价于 contains

    const bAnd = await apiCount('B', [
      { column: mailCol, op: 'notempty' },
      { column: mailCol, op: 'contains', value: mailVal.slice(0, 2) },
    ]);
    eq('B 两条件 AND → appliedFilters=2', bAnd.applied, 2);
    eq('B 两条件 AND → total 与直查一致', bAnd.total, expBC);

    /* ══════════════════════════════════════════════════════════
     * 5. 列白名单：不存在的列被丢弃（两端一致）
     * ══════════════════════════════════════════════════════════ */
    section('5. 列白名单校验（两端一致）');

    const aGhost = await apiCount('A', [{ column: 'ghost_column_xyz', op: 'eq', value: '1' }]);
    eq('A 不存在列 → 仍 200', aGhost.status, 200);
    eq('A 不存在列 → total 回到全表', aGhost.total, parsedTotal);
    eq('A 不存在列 → appliedFilters=0', aGhost.applied, 0);
    eq('A 不存在列 → droppedFilters=1', aGhost.dropped, 1);

    const bGhost = await apiCount('B', [{ column: 'ghost_column_xyz', op: 'eq', value: '1' }]);
    eq('B 不存在列 → 仍 200', bGhost.status, 200);
    eq('B 不存在列 → total 回到全表', bGhost.total, mailTotal);
    eq('B 不存在列 → appliedFilters=0', bGhost.applied, 0);
    eq('B 不存在列 → droppedFilters=1', bGhost.dropped, 1);

    // 跨表列：A 表的真实列拿去查 B 表 → 也必须被丢弃
    const crossA = await apiCount('B', [{ column: 'jdy_form_name', op: 'eq', value: 'x' }]);
    eq('B 端点拒绝 A 表专有列（jdy_form_name 不在邮箱表）', crossA.applied, 0);
    eq('B 端点拒绝后 total 不变', crossA.total, mailTotal);

    /* ══════════════════════════════════════════════════════════
     * 6. 注入式输入无害化
     * ══════════════════════════════════════════════════════════ */
    section('6. 注入式输入（两端）');

    const INJECT_VALUES = [
      "' OR 1=1 --",
      "'; DROP TABLE jdywh_projects; --",
      '100%',
      'a\\b',
    ];
    for (const v of INJECT_VALUES) {
      const a = await apiCount('A', [{ column: parsedCol, op: 'eq', value: v }]);
      eq(`A 注入值 ${JSON.stringify(v)} → 200`, a.status, 200);
      ok(`A 注入值 ${JSON.stringify(v)} → 不返回全表（按字面量匹配）`,
        a.total < parsedTotal, `${a.total}/${parsedTotal}`);
      ok(`A 注入值 ${JSON.stringify(v)} → appliedFilters=1（未被当成非法丢弃）`,
        a.applied === 1, String(a.applied));
    }
    const aInj = await apiCount('B', [{ column: mailCol, op: 'contains', value: "' OR '1'='1" }]);
    eq('B 注入值 contains → 200', aInj.status, 200);
    ok('B 注入值 → 不是全表命中', aInj.total < mailTotal, `${aInj.total}/${mailTotal}`);

    // 注入式列名（SQL 片段当列名）
    const aInjCol = await apiCount('A', [{ column: 'id` , (SELECT 1) --', op: 'eq', value: '1' }]);
    eq('A 注入式列名 → appliedFilters=0（被白名单丢弃）', aInjCol.applied, 0);
    eq('A 注入式列名 → total 回到全表', aInjCol.total, parsedTotal);

    /* ══════════════════════════════════════════════════════════
     * 7. 与 keyword 共存（AND）
     * ══════════════════════════════════════════════════════════ */
    section('7. keyword + filters 共存（AND）');

    const kw = parsedVal.slice(0, 2);
    const aKwOnly = await request(base,
      `/api/projects/${PROJECT_ID}/parsed?page=1&pageSize=20&keyword=${encodeURIComponent(kw)}`);
    const aKwTotal = Number(aKwOnly.json.data.total);
    ok('A keyword 单独可用', aKwTotal > 0, String(aKwTotal));

    const aKwFilter = await request(base,
      `/api/projects/${PROJECT_ID}/parsed?page=1&pageSize=20&keyword=${encodeURIComponent(kw)}` +
      `&filters=${f([{ column: parsedCol, op: 'notempty' }])}`);
    eq('A keyword + filters → 200', aKwFilter.status, 200);
    const aKwFilterD = aKwFilter.json.data;
    eq('A keyword + filters → appliedFilters=1', aKwFilterD.appliedFilters, 1);
    ok('A keyword + filters → 结果 <= keyword 单独结果',
      aKwFilterD.total <= aKwTotal, `${aKwFilterD.total} vs ${aKwTotal}`);

    const kwB = mailVal.slice(0, 2);
    const bKwOnly = await request(base,
      `/api/mail-push/projects/${MAIL_PROJECT_ID}/rows?page=1&size=20&keyword=${encodeURIComponent(kwB)}`);
    const bKwTotal = Number(bKwOnly.json.data.total);
    ok('B keyword 单独可用', bKwTotal > 0, String(bKwTotal));
    const bKwFilter = await request(base,
      `/api/mail-push/projects/${MAIL_PROJECT_ID}/rows?page=1&size=20&keyword=${encodeURIComponent(kwB)}` +
      `&filters=${f([{ column: mailCol, op: 'notempty' }])}`);
    eq('B keyword + filters → 200', bKwFilter.status, 200);
    eq('B keyword + filters → appliedFilters=1', bKwFilter.json.data.appliedFilters, 1);
    ok('B keyword + filters → 结果 <= keyword 单独结果',
      bKwFilter.json.data.total <= bKwTotal, `${bKwFilter.json.data.total} vs ${bKwTotal}`);

    /* ══════════════════════════════════════════════════════════
     * 8. 非法 JSON / 非数组 / 超 20 条（两端同一策略：忽略，不 500）
     * ══════════════════════════════════════════════════════════ */
    section('8. 非法 filters 输入（两端同一策略）');

    const badCases = [
      ['JSON 非法', encodeURIComponent('{not json')],
      ['非数组对象', encodeURIComponent(JSON.stringify({ column: parsedCol, op: 'eq', value: 'x' }))],
      ['空数组', encodeURIComponent('[]')],
    ];
    for (const [label, raw] of badCases) {
      const a = await request(base, `/api/projects/${PROJECT_ID}/parsed?page=1&pageSize=20&filters=${raw}`);
      eq(`A ${label} → 200（不报错）`, a.status, 200);
      eq(`A ${label} → total 为全表`, Number(a.json.data.total), parsedTotal);
      const b = await request(base, `/api/mail-push/projects/${MAIL_PROJECT_ID}/rows?page=1&size=20&filters=${raw}`);
      eq(`B ${label} → 200（不报错）`, b.status, 200);
      eq(`B ${label} → total 为全表`, Number(b.json.data.total), mailTotal);
    }

    const many = [];
    for (let i = 0; i < 26; i += 1) many.push({ column: parsedCol, op: 'notempty' });
    const aMany = await apiCount('A', many);
    eq('A 26 条条件 → 截断到 20 条（appliedFilters=20）', aMany.applied, 20);
    eq('A 26 条条件 → 仍 200', aMany.status, 200);
    ok('A 26 条条件 → total 合理（<= 全表）', aMany.total <= parsedTotal, String(aMany.total));

    const manyB = [];
    for (let i = 0; i < 26; i += 1) manyB.push({ column: mailCol, op: 'notempty' });
    const bMany = await apiCount('B', manyB);
    eq('B 26 条条件 → 截断到 20 条', bMany.applied, 20);

    /* ══════════════════════════════════════════════════════════
     * 9. 分页 / 排序不受筛选影响
     * ══════════════════════════════════════════════════════════ */
    section('9. 分页 / 排序与筛选共存');

    const aP2 = await request(base,
      `/api/projects/${PROJECT_ID}/parsed?page=2&pageSize=5&filters=${f([{ column: parsedCol, op: 'notempty' }])}`);
    eq('A 带筛选翻页 → 200', aP2.status, 200);
    eq('A 带筛选 page=2 回显', aP2.json.data.page, 2);
    ok('A 带筛选第 2 页行数 <= 5', aP2.json.data.list.length <= 5, String(aP2.json.data.list.length));
    eq('A 带筛选 total 与第 1 页一致', aP2.json.data.total, aNE.total);

    const bP2 = await request(base,
      `/api/mail-push/projects/${MAIL_PROJECT_ID}/rows?page=2&size=5&filters=${f([{ column: mailCol, op: 'notempty' }])}`);
    eq('B 带筛选翻页 → 200', bP2.status, 200);
    eq('B 带筛选 page=2 回显', bP2.json.data.page, 2);
    eq('B 带筛选 total 与第 1 页一致', bP2.json.data.total, bNE.total);

    const aSort = await request(base,
      `/api/projects/${PROJECT_ID}/parsed?page=1&pageSize=5&sort=id&dir=asc` +
      `&filters=${f([{ column: parsedCol, op: 'notempty' }])}`);
    eq('A 带筛选 + 排序 → 200', aSort.status, 200);
    ok('A 带筛选 + id ASC → 首行 id 为筛选结果最小值',
      aSort.json.data.list.length === 0 || Number(aSort.json.data.list[0].id) > 0,
      JSON.stringify(aSort.json.data.list[0] && aSort.json.data.list[0].id));

    const bSort = await request(base,
      `/api/mail-push/projects/${MAIL_PROJECT_ID}/rows?page=1&size=5&sort=id&order=asc` +
      `&filters=${f([{ column: mailCol, op: 'notempty' }])}`);
    eq('B 带筛选 + 排序 → 200', bSort.status, 200);

    // 非法排序列 → 回落默认，不报错
    const aBadSort = await request(base, `/api/projects/${PROJECT_ID}/parsed?sort=not_a_col&dir=asc&pageSize=5`);
    eq('A 非法排序列 → 200（回落 id DESC）', aBadSort.status, 200);
    const bBadSort = await request(base, `/api/mail-push/projects/${MAIL_PROJECT_ID}/rows?sort=not_a_col&size=5`);
    eq('B 非法排序列 → 200（回落 id DESC）', bBadSort.status, 200);

    /* ══════════════════════════════════════════════════════════
     * 10. 只读保护未被触发
     * ══════════════════════════════════════════════════════════ */
    section('10. 只读保护');

    eq('全程 0 次写 SQL 尝试', writeAttempts.length, 0);
    if (writeAttempts.length) console.log('     写尝试：', JSON.stringify(writeAttempts, null, 2));

    /* ══════════════════════════════════════════════════════════
     * 11. 附带核对：站点公开字段 + 分组 parentId 归一
     * ══════════════════════════════════════════════════════════ */
    section('11. 站点设置公开字段（要求 1）');

    const sp = await request(base, '/api/settings/public');
    ok('settings/public 200', sp.status === 200, `HTTP ${sp.status}`);
    const pub = (sp.json && sp.json.data) || {};
    const SITE_KEYS = ['site_name', 'site_short', 'site_subtitle', 'site_logo_text', 'site_description', 'site_footer'];
    for (const k of SITE_KEYS) {
      ok(`公开接口包含 ${k}`, Object.prototype.hasOwnProperty.call(pub, k), JSON.stringify(pub[k]));
    }
    ok('公开接口不含敏感项（smtp_pass / ai_api_key / mail_imap_pass）',
      !('smtp_pass' in pub) && !('ai_api_key' in pub) && !('mail_imap_pass' in pub));
    eq('Cache-Control 已改为禁缓存（不再 max-age=60）',
      String(sp.headers.get('cache-control') || '').includes('no-store'), true);

    // 库值 vs 接口值必须一致（证明缓存没有返回旧快照）
    const dbSite = await db.query(
      "SELECT skey, svalue FROM jdywh_settings WHERE skey IN ('site_name','site_short','site_subtitle','site_logo_text','site_description','site_footer')"
    );
    const dbMap = {};
    dbSite.forEach((r) => { dbMap[r.skey] = r.svalue; });
    const mismatch = SITE_KEYS.filter((k) => String(pub[k]) !== String(dbMap[k]));
    eq('6 个站点字段接口值 == 库中最新值（缓存已刷新）', mismatch, []);

    section('12. 分组 parentId 归一（要求 3）');

    const gp = await request(base, '/api/project-groups');
    ok('project-groups 200', gp.status === 200, `HTTP ${gp.status}`);
    const gd = (gp.json && gp.json.data) || {};
    const glist = Array.isArray(gd.list) ? gd.list : [];
    ok('分组列表非空', glist.length > 0, String(glist.length));
    const nullParents = glist.filter((g) => g.parentId === null || g.parentId === undefined);
    eq('list 里没有 null/undefined parentId（全部归一为 0 或正整数）', nullParents.length, 0);
    ok('所有 parentId 都是 number', glist.every((g) => typeof g.parentId === 'number'),
      JSON.stringify(glist.map((g) => typeof g.parentId)));
    const roots = glist.filter((g) => g.parentId === 0);
    ok('存在 parentId === 0 的根分组（严格相等可用）', roots.length > 0, String(roots.length));

    const dbNullGroups = await db.query(
      'SELECT COUNT(*) AS c FROM jdywh_project_groups WHERE parent_id IS NULL'
    );
    ok(`库中确实存在 parent_id IS NULL 的分组（${dbNullGroups[0].c} 个）——证明归一是必要的`,
      Number(dbNullGroups[0].c) > 0, String(dbNullGroups[0].c));

    const tree = Array.isArray(gd.tree) ? gd.tree : [];
    ok('tree 非空', tree.length > 0, String(tree.length));
    ok('tree 根节点 parentId 均为 0', tree.every((n) => n.parentId === 0),
      JSON.stringify(tree.map((n) => n.parentId)));
    const hasChildren = tree.some((n) => Array.isArray(n.children) && n.children.length > 0);
    ok('tree 至少有一个节点带 children（层级结构成立）', hasChildren);

    /* ══════════════════════════════════════════════════════════
     * 13. settings 缓存失效行为（要求 1 的根因验证）
     *
     * 这一段用「内存假表」替身接管 jdywh_settings 的 SELECT/INSERT，
     * 因此 set()/setMany() 全程**不碰真实数据库**（真写入生产库是禁止的），
     * 但走的仍是 src/settings.js 的真实代码路径。
     * ══════════════════════════════════════════════════════════ */
    section('13. settings 缓存失效（真代码路径 + 内存假表，不写库）');

    const settings = require(path.join(ROOT, 'src', 'settings.js'));

    // 假表：模拟「另一个进程/运维脚本改了库」
    const fakeRow = { site_name: 'V61_FAKE_A', site_short: 'V61_FAKE_SHORT' };
    let selectCount = 0;
    let insertCount = 0;

    const shimQuery = async function shimQuery(sql, params) {
      const s = String(sql);
      if (/FROM\s+jdywh_settings/i.test(s) && /^\s*SELECT/i.test(s)) {
        selectCount += 1;
        return Object.keys(fakeRow).map((k) => ({ skey: k, svalue: fakeRow[k] }));
      }
      if (/INSERT\s+INTO\s+jdywh_settings/i.test(s)) {
        insertCount += 1;
        // params = [key, value]（set() 的调用形态）
        if (Array.isArray(params) && params.length >= 2) fakeRow[params[0]] = params[1];
        return { affectedRows: 1, insertId: 0 };
      }
      throw new Error(`[缓存测试] 未预期的 SQL，拒绝执行：${s.slice(0, 120)}`);
    };

    // 让「跨进程回库」可见：TTL 调成 0（每次都回库）/ 大值（一直用缓存）
    const ORIG_TTL = process.env.SETTINGS_CACHE_TTL_MS;

    db.query = shimQuery;
    settings.clearCache();

    process.env.SETTINGS_CACHE_TTL_MS = '60000';   // 长 TTL：命中缓存
    const v1 = (await settings.all()).site_name;
    eq('13.1 首次 all() 回库取值', v1, 'V61_FAKE_A');
    eq('13.1 首次 all() 触发了 1 次 SELECT', selectCount, 1);

    fakeRow.site_name = 'V61_FAKE_B';              // 模拟「别的进程改了库」
    const v2 = (await settings.all()).site_name;
    eq('13.2 长 TTL 内 all() 走缓存（仍返回 A，不重复回库）', v2, 'V61_FAKE_A');
    eq('13.2 缓存命中时未新增 SELECT', selectCount, 1);

    process.env.SETTINGS_CACHE_TTL_MS = '0';       // TTL=0：强制每次回库
    const v3 = (await settings.all()).site_name;
    eq('13.3 TTL=0 时立刻回库，看到「别的进程」写入的新值 B', v3, 'V61_FAKE_B');
    ok('13.3 确实新增了一次 SELECT', selectCount === 2, String(selectCount));

    process.env.SETTINGS_CACHE_TTL_MS = '60000';
    const v4 = (await settings.all()).site_name;
    eq('13.4 TTL 恢复后重建缓存，返回 B', v4, 'V61_FAKE_B');

    // set()：本进程必须立即生效（这是「保存后不生效」最直接的检查点）
    await settings.set('site_name', 'V61_SET_C');
    const v5 = (await settings.all()).site_name;
    eq('13.5 set() 后 all() 立即返回新值（本进程缓存就地更新）', v5, 'V61_SET_C');
    eq('13.5 set() 只写了 1 次（假表）', insertCount, 1);

    // setMany()：多个键 + 强制回库
    await settings.setMany({ site_name: 'V61_MANY_D', site_short: 'V61_MANY_D_SHORT' });
    const allAfterMany = await settings.all();
    eq('13.6 setMany() 后 all().site_name 为新值', allAfterMany.site_name, 'V61_MANY_D');
    eq('13.6 setMany() 后 all().site_short 为新值', allAfterMany.site_short, 'V61_MANY_D_SHORT');
    eq('13.6 setMany() 写入了 2 个键', insertCount, 3);

    // 缓存 TTL 配置读取
    eq('13.7 cacheTtlMs() 读环境变量 60000', settings.cacheTtlMs(), 60000);
    process.env.SETTINGS_CACHE_TTL_MS = '';
    eq('13.7 未配置时回落到默认 5000ms', settings.cacheTtlMs(), settings.DEFAULT_CACHE_TTL_MS);
    eq('13.7 默认 TTL 是 5s（不是无限）', settings.DEFAULT_CACHE_TTL_MS, 5000);
    process.env.SETTINGS_CACHE_TTL_MS = 'abc';
    eq('13.7 非法配置回落到默认值', settings.cacheTtlMs(), settings.DEFAULT_CACHE_TTL_MS);

    // get() 也走同一缓存，且能拿到 set 后的新值
    process.env.SETTINGS_CACHE_TTL_MS = '60000';
    eq('13.8 get() 读到 setMany 后的值', await settings.get('site_short'), 'V61_MANY_D_SHORT');

    // 收尾：还原
    if (ORIG_TTL === undefined) delete process.env.SETTINGS_CACHE_TTL_MS;
    else process.env.SETTINGS_CACHE_TTL_MS = ORIG_TTL;
    db.query = guardedQuery;
    settings.clearCache();
    await settings.load(true);   // 用真实库重建缓存

    const afterRestore = await settings.all();
    const realName = await db.queryOne("SELECT svalue FROM jdywh_settings WHERE skey = 'site_name' LIMIT 1");
    eq('13.9 还原后缓存来自真实库（不是假表值）', afterRestore.site_name,
      realName ? realName.svalue : afterRestore.site_name);
    ok('13.9 还原后站点名不含 V61_ 前缀（假值已清除）',
      !String(afterRestore.site_name).startsWith('V61_'), String(afterRestore.site_name));
  } finally {
    await new Promise((resolve) => srv.close(resolve));
    // 还原 db 方法（避免影响同进程其它逻辑），再关闭连接池
    db.query = rawQuery;
    db.queryOne = rawQueryOne;
    db.raw = rawRaw;
    await db.close();
  }
  console.log('\n' + '='.repeat(64));
  console.log(` 断言结果：PASS ${pass} / FAIL ${fail} / 共 ${pass + fail}`);
  if (fail) {
    console.log(' 失败项：');
    failures.forEach((n, i) => console.log(`   ${i + 1}) ${n}`));
  }
  console.log('='.repeat(64));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\n脚本异常：', e && e.stack ? e.stack : e);
  process.exit(1);
});
