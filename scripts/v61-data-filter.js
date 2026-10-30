'use strict';

/**
 * V6.1 数据明细筛选共享模块 —— 单元测试
 *
 * 运行：node scripts/v61-data-filter.js
 *
 * 被测对象：src/data-filter.js
 * 覆盖（契约 §6.1 全部条款 + 注入风险）：
 *   A. 5 个 op（contains / eq / ne / empty / notempty）各 ≥2 例，SQL 与绑定参数逐一核对
 *   B. 列名白名单：不在真实物理列里的条件必须被丢弃，且**绝不进 SQL**
 *   C. 值安全：单引号 / 百分号 / 反斜杠 / 反引号 / `--` / `' OR 1=1 --` 一律走占位符，
 *      生成的 SQL 里不出现任何值字面量
 *   D. 边界：JSON 非法 / 空数组 / 非数组 / 元素非对象 / 缺 column / 非法 op /
 *      empty 带 value / 缺 value / 超 20 条截断
 *   E. keyword + filters 共存（appendFilters 只 push，天然 AND）
 *   F. quoteIdent 包裹、自定义 quoteIdent、Set/Array/{name}[] 三种白名单形态
 *   G. whereSql 拼装、空筛选不产生 WHERE、filterMeta
 *
 * 纯 Node、无外部依赖、不连数据库，退出码 0 = 全通过。
 */

const path = require('path');

const df = require(path.join(__dirname, '..', 'src', 'data-filter.js'));
const { quoteIdent } = require(path.join(__dirname, '..', 'src', 'ident.js'));

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

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);
}

/* 测试用「真实物理列」白名单（模拟 information_schema 查到的列） */
const LIVE_COLS = new Set(['id', 'wjmc', 'c_1', 'c_2', 'amount', 'import_date']);
/* 也测另外两种白名单形态 */
const LIVE_COLS_ARRAY = ['id', 'wjmc', 'c_1', 'c_2', 'amount', 'import_date'];
const LIVE_COLS_ROWS = LIVE_COLS_ARRAY.map((n) => ({ name: n }));

function f(obj) {
  return JSON.stringify(obj);
}

/* ══════════════════════════════════════════════════════════════════
 * A. 五个操作符（每个 ≥2 例）
 * ══════════════════════════════════════════════════════════════════ */
section('A. 操作符 SQL 生成');

{
  // contains ×2
  const r1 = df.buildFilterSql(f([{ column: 'c_1', op: 'contains', value: 'abc' }]), LIVE_COLS, quoteIdent);
  eq('A1 contains → SQL', r1.clauses, ['`c_1` LIKE ?']);
  eq('A1 contains → 参数为 %abc%', r1.params, ['%abc%']);

  const r2 = df.buildFilterSql(f([{ column: 'c_2', op: 'contains', value: 'x' }]), LIVE_COLS, quoteIdent);
  eq('A2 contains 第二例 → 列名与参数', [r2.clauses, r2.params], [['`c_2` LIKE ?'], ['%x%']]);

  // eq ×2
  const r3 = df.buildFilterSql(f([{ column: 'wjmc', op: 'eq', value: '整体_1' }]), LIVE_COLS, quoteIdent);
  eq('A3 eq → SQL = ?', r3.clauses, ['`wjmc` = ?']);
  eq('A3 eq → 参数原样', r3.params, ['整体_1']);

  const r4 = df.buildFilterSql(f([{ column: 'amount', op: 'eq', value: 15820 }]), LIVE_COLS, quoteIdent);
  eq('A4 eq 数字值 → 参数保持数字类型', r4.params, [15820]);

  // ne ×2
  const r5 = df.buildFilterSql(f([{ column: 'c_1', op: 'ne', value: 'zzz' }]), LIVE_COLS, quoteIdent);
  eq('A5 ne → SQL 含 NULL 兜底', r5.clauses, ['(`c_1` <> ? OR `c_1` IS NULL)']);
  eq('A5 ne → 一个参数', r5.params, ['zzz']);

  const r6 = df.buildFilterSql(f([{ column: 'c_2', op: 'ne', value: '0' }]), LIVE_COLS, quoteIdent);
  ok('A6 ne 第二例 → 字符串 "0" 不被吞成 0', r6.params[0] === '0', String(r6.params[0]));

  // empty ×2
  const r7 = df.buildFilterSql(f([{ column: 'c_1', op: 'empty' }]), LIVE_COLS, quoteIdent);
  eq('A7 empty → SQL', r7.clauses, ["(`c_1` IS NULL OR `c_1` = '')"]);
  eq('A7 empty → 无参数', r7.params, []);

  const r8 = df.buildFilterSql(f([{ column: 'c_2', op: 'empty', value: '随便填' }]), LIVE_COLS, quoteIdent);
  eq('A8 empty 忽略 value → 仍无参数', r8.params, []);

  // notempty ×2
  const r9 = df.buildFilterSql(f([{ column: 'c_1', op: 'notempty' }]), LIVE_COLS, quoteIdent);
  eq('A9 notempty → SQL', r9.clauses, ["(`c_1` IS NOT NULL AND `c_1` <> '')"]);
  eq('A9 notempty → 无参数', r9.params, []);

  const r10 = df.buildFilterSql(f([{ column: 'amount', op: 'notempty' }]), LIVE_COLS, quoteIdent);
  eq('A10 notempty 第二例 → 列名正确', r10.clauses, ["(`amount` IS NOT NULL AND `amount` <> '')"]);
}

/* ══════════════════════════════════════════════════════════════════
 * B. 列白名单
 * ══════════════════════════════════════════════════════════════════ */
section('B. 列名白名单校验');

{
  const r = df.buildFilterSql(
    f([{ column: 'not_a_real_column', op: 'contains', value: 'x' }]), LIVE_COLS, quoteIdent
  );
  eq('B1 非白名单列 → 无 SQL 片段', r.clauses, []);
  eq('B1 非白名单列 → 无参数', r.params, []);
  eq('B1 非白名单列 → applied=0', r.applied, 0);
  ok('B1 非白名单列 → dropped=1', r.dropped === 1, String(r.dropped));
  eq('B1 非白名单列 → whereSql 为空串', r.whereSql, '');

  // 注入式列名
  const inj = 'c_1` , (SELECT 1) --';
  const r2 = df.buildFilterSql(f([{ column: inj, op: 'eq', value: 'x' }]), LIVE_COLS, quoteIdent);
  eq('B2 注入式列名 → 被白名单丢弃', r2.clauses, []);
  ok('B2 注入式列名 → 生成的 SQL 里不含注入片段',
    !r2.clauses.join(' ').includes('SELECT 1') && !r2.whereSql.includes('SELECT 1'),
    r2.clauses.join(' '));

  // 混合：1 合法 + 2 非法
  const r3 = df.buildFilterSql(f([
    { column: 'id', op: 'eq', value: '1' },
    { column: 'ghost', op: 'eq', value: '1' },
    { column: 'sys_table', op: 'empty' },
  ]), LIVE_COLS, quoteIdent);
  eq('B3 混合条件 → 只保留合法的那条', r3.clauses, ['`id` = ?']);
  eq('B3 混合条件 → 恰好丢弃 2 条', r3.dropped, 2);

  // 白名单形态：Array<string> / Array<{name}>
  const r4 = df.buildFilterSql(f([{ column: 'c_1', op: 'eq', value: 'v' }]), LIVE_COLS_ARRAY, quoteIdent);
  eq('B4 白名单为 string[] → 正常通过', r4.clauses.length, 1);

  const r5 = df.buildFilterSql(f([{ column: 'c_1', op: 'eq', value: 'v' }]), LIVE_COLS_ROWS, quoteIdent);
  eq('B5 白名单为 {name}[]（information_schema）→ 正常通过', r5.clauses.length, 1);

  // 大小写敏感：MySQL 列名大小写不匹配时不应通过（白名单精确匹配）
  const r6 = df.buildFilterSql(f([{ column: 'C_1', op: 'eq', value: 'v' }]), LIVE_COLS, quoteIdent);
  eq('B6 列名大小写不符 → 丢弃（白名单精确匹配）', r6.clauses, []);
}

/* ══════════════════════════════════════════════════════════════════
 * C. 值安全（占位符绑定，无注入）
 * ══════════════════════════════════════════════════════════════════ */
section('C. 值安全 / 注入防护');

{
  const nasty = [
    "O'Brien",
    '100%',
    'a\\b',
    "'; DROP TABLE jdywh_projects; --",
    "' OR 1=1 --",
    '`backtick`',
    '中文含\'单引号%与\\反斜杠',
  ];

  for (const v of nasty) {
    const r = df.buildFilterSql(f([{ column: 'c_1', op: 'eq', value: v }]), LIVE_COLS, quoteIdent);
    const sqlText = r.clauses.join(' ');
    ok(`C 值 ${JSON.stringify(v)} → SQL 只有占位符`,
      sqlText === '`c_1` = ?', sqlText);
    ok(`C 值 ${JSON.stringify(v)} → 值原样进参数数组`,
      r.params.length === 1 && r.params[0] === v, JSON.stringify(r.params));
    ok(`C 值 ${JSON.stringify(v)} → SQL 文本不含该值`,
      !sqlText.includes('DROP') && !sqlText.includes('OR 1=1') && !sqlText.includes("O'Brien"),
      sqlText);
  }

  // contains 的 % 也原样保留（不做转义，由 LIKE 语义决定）
  const rc = df.buildFilterSql(f([{ column: 'c_1', op: 'contains', value: '50%' }]), LIVE_COLS, quoteIdent);
  eq('C8 contains 值含 % → 包一层通配', rc.params, ['%50%%']);

  // ne 的值同样绑定
  const rn = df.buildFilterSql(f([{ column: 'c_1', op: 'ne', value: "x' OR '1'='1" }]), LIVE_COLS, quoteIdent);
  eq('C9 ne 值含引号 → SQL 无值字面量', rn.clauses, ['(`c_1` <> ? OR `c_1` IS NULL)']);
  eq('C9 ne 值含引号 → 参数原样', rn.params, ["x' OR '1'='1"]);
}

/* ══════════════════════════════════════════════════════════════════
 * D. 边界与非法输入
 * ══════════════════════════════════════════════════════════════════ */
section('D. 边界 / 非法输入');

{
  // JSON 非法 → 忽略，不抛错
  const r1 = df.buildFilterSql('{not json', LIVE_COLS, quoteIdent);
  eq('D1 JSON 非法 → 不抛错、无 SQL', [r1.clauses, r1.params], [[], []]);
  eq('D1 JSON 非法 → error=invalid_json', r1.error, 'invalid_json');

  // 非数组
  const r2 = df.buildFilterSql(f({ column: 'c_1', op: 'eq', value: 'v' }), LIVE_COLS, quoteIdent);
  eq('D2 非数组（对象）→ 忽略', r2.clauses, []);
  eq('D2 非数组 → error=non_array', r2.error, 'non_array');

  const r3 = df.buildFilterSql('"string"', LIVE_COLS, quoteIdent);
  eq('D3 非数组（字符串字面量）→ 忽略', r3.error, 'non_array');

  // 空数组 / 空串 / undefined / null
  eq('D4 空数组 → 无 WHERE', df.buildFilterSql('[]', LIVE_COLS, quoteIdent).whereSql, '');
  eq('D5 空串 → 无 WHERE', df.buildFilterSql('', LIVE_COLS, quoteIdent).whereSql, '');
  eq('D6 undefined → 无 WHERE', df.buildFilterSql(undefined, LIVE_COLS, quoteIdent).whereSql, '');
  eq('D7 null → 无 WHERE', df.buildFilterSql(null, LIVE_COLS, quoteIdent).whereSql, '');

  // 元素非对象 / 缺 column / 非法 op
  const r8 = df.buildFilterSql(f([
    null, 42, 'str', [], {},
    { column: '', op: 'eq', value: 'v' },
    { column: '   ', op: 'eq', value: 'v' },
    { column: 'c_1', op: 'like', value: 'v' },
    { column: 'c_1', op: '', value: 'v' },
    { column: 'c_1', op: 'eq', value: 'v' },
  ]), LIVE_COLS, quoteIdent);
  eq('D8 9 条非法 + 1 条合法 → 只留 1 条', r8.clauses, ['`c_1` = ?']);
  eq('D8 → dropped=9', r8.dropped, 9);

  // eq/ne/contains 缺 value → 丢弃
  const r9 = df.buildFilterSql(f([
    { column: 'c_1', op: 'eq' },
    { column: 'c_1', op: 'ne', value: null },
    { column: 'c_1', op: 'contains', value: {} },
    { column: 'c_1', op: 'contains', value: [] },
  ]), LIVE_COLS, quoteIdent);
  eq('D9 缺值/对象值/数组值 → 全部丢弃', r9.clauses, []);
  eq('D9 → dropped=4', r9.dropped, 4);

  // 空值字符串对 eq 是合法的（用户就是想筛空串）
  const r10 = df.buildFilterSql(f([{ column: 'c_1', op: 'eq', value: '' }]), LIVE_COLS, quoteIdent);
  eq('D10 eq 空串 → 合法（一个参数为空串）', [r10.clauses, r10.params], [['`c_1` = ?'], ['']]);

  // 超过 20 条截断
  const many = [];
  for (let i = 0; i < 25; i += 1) many.push({ column: 'c_1', op: 'contains', value: 'v' + i });
  const r11 = df.buildFilterSql(f(many), LIVE_COLS, quoteIdent);
  eq('D11 25 条 → 只保留 MAX_FILTERS 条', r11.clauses.length, df.MAX_FILTERS);
  eq('D11 → 20 条', r11.clauses.length, 20);
  eq('D11 → truncated=5', r11.truncated, 5);
  eq('D11 → 参数也是 20 个', r11.params.length, 20);
  eq('D11 → 前 20 条的最后一个值是 v19', r11.params[19], '%v19%');

  // 恰好 20 条不截断
  const exact = [];
  for (let i = 0; i < 20; i += 1) exact.push({ column: 'c_1', op: 'eq', value: i });
  const r12 = df.buildFilterSql(f(exact), LIVE_COLS, quoteIdent);
  eq('D12 恰好 20 条 → 全保留', r12.clauses.length, 20);
  eq('D12 → truncated=0', r12.truncated, 0);

  // op 大小写容错
  const r13 = df.buildFilterSql(f([{ column: 'c_1', op: 'CONTAINS', value: 'v' }]), LIVE_COLS, quoteIdent);
  eq('D13 op 大写 CONTAINS → 归一后通过', r13.clauses, ['`c_1` LIKE ?']);

  // column 前后空白
  const r14 = df.buildFilterSql(f([{ column: '  c_1  ', op: 'eq', value: 'v' }]), LIVE_COLS, quoteIdent);
  eq('D14 column 前后空白 → trim 后通过', r14.clauses, ['`c_1` = ?']);

  // 数组形态的 raw（?filters=a&filters=b，express 会转数组）
  const r15 = df.parseFilters(['{bad', f([{ column: 'c_1', op: 'eq', value: 'v' }])]);
  eq('D15 raw 为 string[] → 取最后一个', r15.filters.length, 1);

  // MAX_FILTERS 常量
  eq('D16 MAX_FILTERS === 20', df.MAX_FILTERS, 20);
  eq('D17 OPS 覆盖 5 个操作符', df.OPS.slice().sort(), ['contains', 'empty', 'eq', 'ne', 'notempty']);
}

/* ══════════════════════════════════════════════════════════════════
 * E. keyword + filters 共存（AND）
 * ══════════════════════════════════════════════════════════════════ */
section('E. keyword + filters 共存（AND）');

{
  // 模拟 /api/projects/:id/parsed 的接入方式
  const where = [];
  const params = [];
  const kw = '%abc%';
  where.push(`(\`jdy_data_id\` LIKE ? OR \`jdy_form_name\` LIKE ? OR \`raw_json\` LIKE ?)`);
  params.push(kw, kw, kw);

  const meta = df.appendFilters(
    { where, params },
    f([{ column: 'c_1', op: 'contains', value: 'xyz' }]),
    LIVE_COLS,
    quoteIdent
  );

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  ok('E1 keyword 与 filters 同时存在 → WHERE 里有 AND', whereSql.includes(' AND '), whereSql);
  ok('E1 → keyword 条件在前', whereSql.startsWith('WHERE (`jdy_data_id` LIKE ?'), whereSql);
  ok('E1 → filter 条件在后', whereSql.includes('`c_1` LIKE ?'), whereSql);
  eq('E1 → 参数共 4 个（3 keyword + 1 filter）', params.length, 4);
  eq('E1 → 最后一个参数是 filter 值', params[3], '%xyz%');
  eq('E1 → meta.applied=1', meta.applied, 1);
  eq('E1 → meta.dropped=0', meta.dropped, 0);
  eq('E1 → meta.clauses 长度 1', meta.clauses.length, 1);

  // 只有 keyword（filters 空）→ where 不变
  const where2 = ['`x` = ?'];
  const params2 = ['v'];
  const meta2 = df.appendFilters({ where: where2, params: params2 }, '', LIVE_COLS, quoteIdent);
  eq('E2 无 filters → where 不被改动', where2, ['`x` = ?']);
  eq('E2 无 filters → 参数不被改动', params2, ['v']);
  eq('E2 无 filters → applied=0', meta2.applied, 0);

  // 只有 filters（无 keyword）→ WHERE 仍能生成
  const where3 = [];
  const params3 = [];
  df.appendFilters({ where: where3, params: params3 }, f([{ column: 'c_2', op: 'empty' }]), LIVE_COLS, quoteIdent);
  eq('E3 只有 filters → WHERE 正常生成',
    where3.length ? `WHERE ${where3.join(' AND ')}` : '',
    "WHERE (`c_2` IS NULL OR `c_2` = '')");

  // 多条件 AND 顺序保持入参顺序
  const where4 = [];
  const params4 = [];
  df.appendFilters({ where: where4, params: params4 }, f([
    { column: 'c_1', op: 'contains', value: 'a' },
    { column: 'c_2', op: 'eq', value: 'b' },
    { column: 'amount', op: 'notempty' },
  ]), LIVE_COLS, quoteIdent);
  eq('E4 3 个条件 → 3 个 AND 片段', where4.length, 3);
  eq('E4 → 顺序与入参一致', where4[0], '`c_1` LIKE ?');
  eq('E4 → 顺序与入参一致（第 2 条）', where4[1], '`c_2` = ?');
  eq('E4 → 顺序与入参一致（第 3 条）', where4[2], "(`amount` IS NOT NULL AND `amount` <> '')");
  eq('E4 → 参数只有 2 个（notempty 无值）', params4, ['%a%', 'b']);

  // 非法 state 防御
  let threw = false;
  try { df.appendFilters({}, '', LIVE_COLS, quoteIdent); } catch (_) { threw = true; }
  ok('E5 state 不合法 → 明确抛错（不静默）', threw);
}

/* ══════════════════════════════════════════════════════════════════
 * F. quoteIdent
 * ══════════════════════════════════════════════════════════════════ */
section('F. 标识符包裹');

{
  const r = df.buildFilterSql(f([{ column: 'c_1', op: 'eq', value: 'v' }]), LIVE_COLS, quoteIdent);
  ok('F1 列名被反引号包裹', r.clauses[0].startsWith('`c_1`'), r.clauses[0]);

  // 自定义 quoteIdent（如 MSSQL 用 []）
  const bracket = (n) => '[' + n + ']';
  const r2 = df.buildFilterSql(f([{ column: 'c_1', op: 'eq', value: 'v' }]), LIVE_COLS, bracket);
  eq('F2 自定义 quoteIdent → 用 [] 包裹', r2.clauses, ['[c_1] = ?']);

  // 不传 quoteIdent → 用 src/ident.js 默认实现
  const r3 = df.buildFilterSql(f([{ column: 'c_2', op: 'empty' }]), LIVE_COLS);
  eq('F3 省略 quoteIdent → 默认反引号', r3.clauses, ["(`c_2` IS NULL OR `c_2` = '')"]);

  // toColumnSet 三种形态
  eq('F4 toColumnSet(Set)', df.toColumnSet(new Set(['a'])).has('a'), true);
  eq('F5 toColumnSet(string[])', df.toColumnSet(['a', 'b']).size, 2);
  eq('F6 toColumnSet({name}[])', df.toColumnSet([{ name: 'a' }, { name: 'b' }]).size, 2);
  eq('F7 toColumnSet(object 映射)', df.toColumnSet({ a: 1 }).has('a'), true);
}

/* ══════════════════════════════════════════════════════════════════
 * G. 汇总字段
 * ══════════════════════════════════════════════════════════════════ */
section('G. whereSql / filterMeta');

{
  const r = df.buildFilterSql(f([
    { column: 'c_1', op: 'contains', value: 'a' },
    { column: 'c_2', op: 'empty' },
  ]), LIVE_COLS, quoteIdent);
  ok('G1 whereSql 以 WHERE 开头', r.whereSql.startsWith('WHERE '), r.whereSql);
  ok('G1 whereSql 两个条件用 AND 连接', r.whereSql.split(' AND ').length >= 2, r.whereSql);

  const m = df.filterMeta({ applied: 3, dropped: 1 });
  eq('G2 filterMeta → appliedFilters', m.appliedFilters, 3);
  eq('G2 filterMeta → droppedFilters', m.droppedFilters, 1);

  const m2 = df.filterMeta(null);
  eq('G3 filterMeta(null) → 0/0', [m2.appliedFilters, m2.droppedFilters], [0, 0]);

  // 两端响应字段名一致性：都是 appliedFilters / droppedFilters
  eq('G4 两端元信息字段名一致', Object.keys(df.filterMeta({ applied: 1, dropped: 0 })).sort(),
    ['appliedFilters', 'droppedFilters']);
}

/* ══════════════════════════════════════════════════════════════════
 * 汇总
 * ══════════════════════════════════════════════════════════════════ */
console.log('\n' + '='.repeat(64));
console.log(` 断言结果：PASS ${pass} / FAIL ${fail} / 共 ${pass + fail}`);
if (fail) {
  console.log(' 失败项：');
  failures.forEach((n, i) => console.log(`   ${i + 1}) ${n}`));
}
console.log('='.repeat(64));
process.exit(fail ? 1 : 0);
