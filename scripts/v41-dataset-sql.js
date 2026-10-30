'use strict';

/**
 * V4.1 数据集 SQL 修复单元测试
 *
 * 运行：node scripts/v41-dataset-sql.js
 *
 * 覆盖：
 *   A. normalizeSql 标识符自动加引号（普通/连字符/保留字/中文/已引号幂等/
 *      字符串内含 FROM/注释/子查询/别名/带 schema/MSSQL/UPDATE/INTO/函数调用）
 *   B. assertReadOnly 只读校验（字符串含 update 不误杀、WITH、窗口函数、
 *      多语句拦截、写操作拦截）
 *   C. paginate 分页（已有 LIMIT 不重复追加、MSSQL OFFSET/FETCH、FOR UPDATE 位置）
 *   D. describeDbError 中文错误（ER_PARSE_ERROR 1064 翻译 + 保留原始 SQL/错误码）
 *
 * 纯 Node、无外部依赖、不连数据库，退出码 0 = 全通过。
 */

const ds = require('../src/datasource');
const reports = require('../src/reports');

const MYSQL = { id: 0, type: 'mysql' };
const MSSQL = { id: 1, type: 'mssql' };
const PG = { id: 2, type: 'postgres' };

let pass = 0;
let fail = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    failures.push({ name, actual: a, expected: e });
    console.log(`  FAIL  ${name}`);
    console.log(`        期望: ${e}`);
    console.log(`        实际: ${a}`);
  }
}

function checkTrue(name, actual) {
  if (actual) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    failures.push({ name, actual: String(actual), expected: 'true' });
    console.log(`  FAIL  ${name}（期望为真，实际 ${JSON.stringify(actual)}）`);
  }
}

function checkThrows(name, fn, expectedFragment) {
  try {
    fn();
    fail += 1;
    failures.push({ name, actual: 'no throw', expected: 'throw' });
    console.log(`  FAIL  ${name}（未抛出异常）`);
  } catch (err) {
    const msg = String(err && err.message);
    if (expectedFragment && msg.indexOf(expectedFragment) < 0) {
      fail += 1;
      failures.push({ name, actual: msg, expected: `包含「${expectedFragment}」` });
      console.log(`  FAIL  ${name}（错误信息不含「${expectedFragment}」：${msg}）`);
    } else {
      pass += 1;
      console.log(`  PASS  ${name}（${msg.slice(0, 60)}）`);
    }
  }
}

/* ══════════════ A. normalizeSql ══════════════ */
console.log('\n[A] normalizeSql 标识符自动加引号');

// A1 普通表名：原样不动
check('A1 普通表名不加引号',
  ds.normalizeSql(MYSQL, 'select * from users'),
  'select * from users');

// A2 连字符表名（用户投诉的真实场景）
check('A2 连字符表名加反引号',
  ds.normalizeSql(MYSQL, 'select * from zkcrm-ry'),
  'select * from `zkcrm-ry`');

// A3 保留字当表名
check('A3 保留字 order 加引号',
  ds.normalizeSql(MYSQL, 'select * from order'),
  'select * from `order`');

check('A3b 保留字 group 加引号',
  ds.normalizeSql(MYSQL, 'select * from group where id = 1'),
  'select * from `group` where id = 1');

// A4 中文表名
check('A4 中文表名加引号',
  ds.normalizeSql(MYSQL, 'select * from 员工表'),
  'select * from `员工表`');

// A5 已加反引号：幂等
const backticked = 'select * from `zkcrm-ry`';
check('A5 已加反引号保持不变（幂等）',
  ds.normalizeSql(MYSQL, backticked), backticked);
checkTrue('A5b 对已修复 SQL 再跑一遍结果完全一致',
  ds.normalizeSql(MYSQL, ds.normalizeSql(MYSQL, 'select * from zkcrm-ry')) === ds.normalizeSql(MYSQL, 'select * from zkcrm-ry'));

// A6 已加方括号（MSSQL 写法，MySQL 下也不应二次包装）
check('A6 已加方括号保持不变',
  ds.normalizeSql(MYSQL, 'select * from [dbo].[tbl]'),
  'select * from [dbo].[tbl]');

// A7 字符串字面量内含 FROM：不能碰字符串内部
check('A7 字符串字面量内含 FROM 不被改写',
  ds.normalizeSql(MYSQL, "select * from t where note = 'from zkcrm-ry'"),
  "select * from t where note = 'from zkcrm-ry'");

// A8 -- 行注释内含 FROM
check('A8 -- 注释内的 FROM 不被改写',
  ds.normalizeSql(MYSQL, '-- from zkcrm-ry\nselect * from t'),
  '-- from zkcrm-ry\nselect * from t');

// A9 /* */ 块注释
check('A9 /* */ 注释内的 FROM 不被改写',
  ds.normalizeSql(MYSQL, '/* from zkcrm-ry */ select * from zkcrm-ry'),
  '/* from zkcrm-ry */ select * from `zkcrm-ry`');

// A10 子查询：内层 FROM 也要处理
check('A10 子查询内表名加引号',
  ds.normalizeSql(MYSQL, 'select * from (select * from zkcrm-ry) x'),
  'select * from (select * from `zkcrm-ry`) x');

// A11 别名：表名后的别名不被加引号
check('A11 别名 tbl a 只引表名',
  ds.normalizeSql(MYSQL, 'select a.id from zkcrm-ry a'),
  'select a.id from `zkcrm-ry` a');

// A12 带 schema 的 db.tbl：逐段判断
check('A12 db.tbl 形式逐段处理',
  ds.normalizeSql(MYSQL, 'select * from my-db.zkcrm-ry'),
  'select * from `my-db`.`zkcrm-ry`');
check('A12b 正常 db.tbl 保持原样',
  ds.normalizeSql(MYSQL, 'select * from jdywh_datasets'),
  'select * from jdywh_datasets');

// A13 MSSQL 方言：方括号
check('A13 MSSQL 方言用方括号',
  ds.normalizeSql(MSSQL, 'select * from zkcrm-ry'),
  'select * from [zkcrm-ry]');

// A14 JOIN 后的表名
check('A14 JOIN 后表名加引号',
  ds.normalizeSql(MYSQL, 'select * from t a join zkcrm-ry b on a.id = b.id'),
  'select * from t a join `zkcrm-ry` b on a.id = b.id');

// A15 函数调用 FROM 不能当表名（SUBSTRING(x FROM 1 FOR 2)）
check('A15 函数内 FROM 数字不被当表名',
  ds.normalizeSql(MYSQL, 'select substring(name from 1 for 2) from t'),
  'select substring(name from 1 for 2) from t');

// A16 UPDATE / INTO 后的表名
check('A16 UPDATE 后表名加引号',
  ds.normalizeSql(MYSQL, 'update zkcrm-ry set a = 1'),
  'update `zkcrm-ry` set a = 1');
check('A16b INSERT INTO 后表名加引号',
  ds.normalizeSql(MYSQL, 'insert into zkcrm-ry (a) values (1)'),
  'insert into `zkcrm-ry` (a) values (1)');

// A17 WITH 子句
check('A17 WITH 子查询内表名加引号',
  ds.normalizeSql(MYSQL, 'with c as (select * from zkcrm-ry) select * from c'),
  'with c as (select * from `zkcrm-ry`) select * from c');

// A18 多表 FROM 逗号清单
check('A18 FROM 逗号清单逐个处理',
  ds.normalizeSql(MYSQL, 'select * from zkcrm-ry a, 员工表 b where a.id = b.id'),
  'select * from `zkcrm-ry` a, `员工表` b where a.id = b.id');

// A19 空 / null 安全
check('A19 空 SQL 返回空串', ds.normalizeSql(MYSQL, ''), '');
check('A19b null SQL 返回空串', ds.normalizeSql(MYSQL, null), '');

// A20 PostgreSQL 方言用双引号
check('A20 PostgreSQL 方言用双引号',
  ds.normalizeSql(PG, 'select * from zkcrm-ry'),
  'select * from "zkcrm-ry"');

// A21 DUAL 是合法表名，不加引号
check('A21 DUAL 不加引号', ds.normalizeSql(MYSQL, 'select 1 from DUAL'), 'select 1 from DUAL');

/* ══════════════ B. assertReadOnly ══════════════ */
console.log('\n[B] assertReadOnly 只读校验');

checkTrue('B1 普通 SELECT 通过', reports.assertReadOnly('select * from t') === 'select * from t');
checkTrue('B2 尾部空分号被去掉', reports.assertReadOnly('select * from t;') === 'select * from t');
checkTrue('B3 WITH 查询通过',
  reports.assertReadOnly('with c as (select 1) select * from c') === 'with c as (select 1) select * from c');
checkTrue('B4 字符串里含 update 不误杀',
  reports.assertReadOnly("select * from t where remark = 'please update me'").indexOf('update') > 0);
checkTrue('B5 字符串里含 delete 不误杀',
  reports.assertReadOnly("select * from t where s = 'delete later'").length > 0);
checkTrue('B6 窗口函数 ROW_NUMBER 通过',
  reports.assertReadOnly('select row_number() over (partition by a order by b) rn from t').indexOf('row_number') > 0);
checkTrue('B7 注释里的 update 不误杀',
  reports.assertReadOnly('-- update me\nselect * from t').indexOf('select') > 0);
checkThrows('B8 多语句被拒绝', () => reports.assertReadOnly('select 1; drop table t'), '不允许分号');
checkThrows('B9 DELETE 被拒绝', () => reports.assertReadOnly('delete from t'), '只允许 SELECT');
checkThrows('B10 UPDATE 被拒绝', () => reports.assertReadOnly('update t set a = 1'), '只允许 SELECT');
checkThrows('B11 子查询里藏 DELETE 被拒绝',
  () => reports.assertReadOnly('select * from (delete from t) x'), '不允许的关键字');
checkThrows('B12 INTO OUTFILE 被拒绝',
  () => reports.assertReadOnly("select * from t into outfile '/tmp/x'"), '不允许');
checkThrows('B13 空 SQL 被拒绝', () => reports.assertReadOnly(''), 'SQL 不能为空');
checkThrows('B14 裸表名不是查询被拒绝', () => reports.assertReadOnly('t'), '只允许 SELECT');

/* ══════════════ C. paginate ══════════════ */
console.log('\n[C] paginate 分页');

check('C1 MySQL 追加 LIMIT/OFFSET',
  ds.paginate(MYSQL, 'select * from t', 20, 0),
  'select * from t LIMIT 20 OFFSET 0');
check('C2 尾部空分号先去掉再分页',
  ds.paginate(MYSQL, 'select * from t;', 20, 0),
  'select * from t LIMIT 20 OFFSET 0');
check('C3 已有 LIMIT 不再重复追加',
  ds.paginate(MYSQL, 'select * from t LIMIT 5', 20, 0),
  'select * from t LIMIT 5');
check('C4 MSSQL 追加 OFFSET/FETCH',
  ds.paginate(MSSQL, 'select * from t', 20, 0),
  'select * from t ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 20 ROWS ONLY');
check('C5 MSSQL 已有 ORDER BY 不重复添加',
  ds.paginate(MSSQL, 'select * from t order by id', 20, 0),
  'select * from t order by id OFFSET 0 ROWS FETCH NEXT 20 ROWS ONLY');
check('C6 FOR UPDATE 放在 LIMIT 之后',
  ds.paginate(MYSQL, 'select * from t for update', 20, 0),
  'select * from t LIMIT 20 OFFSET 0 for update');

// 关键回归：修复后的完整链路（normalizeSql + paginate）不再出现 '-ry LIMIT'
check('C7 完整链路：连字符表名 + 分页',
  ds.paginate(MYSQL, ds.normalizeSql(MYSQL, 'select * from zkcrm-ry'), 20, 0),
  'select * from `zkcrm-ry` LIMIT 20 OFFSET 0');

/* ══════════════ D. describeDbError ══════════════ */
console.log('\n[D] describeDbError 中文错误');

const realErr = new Error("You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '-ry LIMIT 20 OFFSET 0' at line 1");
realErr.code = 'ER_PARSE_ERROR';
realErr.errno = 1064;
realErr.sqlMessage = realErr.message;

const described = ds.describeDbError(
  MYSQL,
  realErr,
  'select * from `zkcrm-ry` LIMIT 20 OFFSET 0',
  'select * from zkcrm-ry',
  'select * from `zkcrm-ry`'
);

checkTrue('D1 错误信息是中文且含「语法错误」', described.message.indexOf('SQL 语法错误') >= 0);
checkTrue('D2 保留原始 DB 错误码 ER_PARSE_ERROR', described.code === 'ER_PARSE_ERROR');
checkTrue('D3 保留 errno 1064', described.errno === 1064);
checkTrue('D4 保留原始 SQL', described.originalSql === 'select * from zkcrm-ry');
checkTrue('D5 保留修复后 SQL', described.sql === 'select * from `zkcrm-ry` LIMIT 20 OFFSET 0');
checkTrue('D6 有中文修复建议 hint', typeof described.hint === 'string' && described.hint.indexOf('连字符') >= 0);
checkTrue('D7 标记为 DB 错误（供路由结构化返回）', described.isDbError === true);
checkTrue('D8 message 里带原始 SQL 便于排查', described.message.indexOf('原始 SQL：select * from zkcrm-ry') >= 0);
checkTrue('D9 message 里带原始 DB 报错', described.message.indexOf('-ry LIMIT 20 OFFSET 0') >= 0);

const noTableErr = Object.assign(new Error('Table \'jdy-push.foo\' doesn\'t exist'), {
  code: 'ER_NO_SUCH_TABLE', errno: 1146, sqlMessage: "Table 'jdy-push.foo' doesn't exist",
});
const described2 = ds.describeDbError(MYSQL, noTableErr, 'select * from foo', 'select * from foo');
checkTrue('D10 表不存在翻译为中文', described2.message.indexOf('数据表不存在') >= 0);

// 没有真正加引号时（只是追加了分页）不应谎报「已自动加引号」
const described3 = ds.describeDbError(
  MYSQL, noTableErr,
  'select * from foo LIMIT 5 OFFSET 0',
  'select * from foo',
  'select * from foo'
);
checkTrue('D11 未加引号时不谎报自动修复', described3.autoQuoted === false
  && described3.message.indexOf('系统已对表名自动加引号') < 0);
checkTrue('D12 原始 SQL 保留用户提交的原文', described3.originalSql === 'select * from foo');

/* ══════════════ 汇总 ══════════════ */
console.log('\n' + '─'.repeat(60));
console.log(`总计 ${pass + fail} 个断言：PASS ${pass}，FAIL ${fail}`);
if (fail) {
  console.log('\n失败明细：');
  failures.forEach((f) => console.log(`  - ${f.name}\n    期望: ${f.expected}\n    实际: ${f.actual}`));
  console.log('\n结果：FAILED');
  process.exit(1);
}
console.log('结果：ALL PASS');
process.exit(0);
