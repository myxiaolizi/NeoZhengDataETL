'use strict';

/**
 * V4.1 真实库回归：验证 `select * from zkcrm-ry` 经修复后可执行
 *
 * 运行：node scripts/v41-dataset-sql-db.js
 *
 * 全程只读（仅 SELECT / SHOW / DESCRIBE），不写库、不改结构。
 * 走的是与线上完全相同的链路：reports.testSql → assertReadOnly →
 * normalizeSql → paginate → datasource.query。
 */

const ds = require('../src/datasource');
const reports = require('../src/reports');
const datasources = require('../src/datasources');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, detail) {
  pass += 1;
  console.log(`  PASS  ${name}${detail ? '  → ' + detail : ''}`);
}
function bad(name, detail) {
  fail += 1;
  failures.push(name + ': ' + detail);
  console.log(`  FAIL  ${name}  → ${detail}`);
}

(async () => {
  console.log('[1] 连接默认数据源（.env 配置）');
  const source = await datasources.getById(0);
  if (!source) {
    bad('默认数据源存在', 'datasources.getById(0) 返回空');
    return finish();
  }
  ok('默认数据源存在', `${source.type} @ ${source.host}/${source.database}`);

  console.log('\n[2] 确认表 zkcrm-ry 真实存在（只读 information_schema）');
  const exists = await ds.tableExists(source, 'zkcrm-ry');
  exists ? ok('表 zkcrm-ry 存在') : bad('表 zkcrm-ry 存在', 'information_schema 查不到');

  const tables = await ds.listTables(source, 'zkcrm');
  const hit = tables.find((t) => t.name === 'zkcrm-ry');
  hit ? ok('listTables 能列出 zkcrm-ry') : bad('listTables 能列出 zkcrm-ry', JSON.stringify(tables.map((t) => t.name)));

  console.log('\n[3] 复现原始故障：未加引号的裸 SQL（预期失败，用于证明根因）');
  const badSql = 'select * from zkcrm-ry LIMIT 20 OFFSET 0';
  try {
    await ds.query(source, badSql, []);
    bad('原始裸 SQL 应当报错', '却执行成功了，说明假设不成立');
  } catch (err) {
    const isParse = err.code === 'ER_PARSE_ERROR' && err.errno === 1064;
    isParse ? ok('裸 SQL 复现 ER_PARSE_ERROR / 1064', String(err.sqlMessage).slice(0, 80))
      : bad('裸 SQL 报错类型', `${err.code} ${err.errno} ${err.sqlMessage}`);
  }

  console.log('\n[4] 修复链路：normalizeSql + paginate 生成可执行 SQL');
  const fixedSql = ds.paginate(source, ds.normalizeSql(source, 'select * from zkcrm-ry'), 20, 0);
  fixedSql === 'select * from `zkcrm-ry` LIMIT 20 OFFSET 0'
    ? ok('生成 SQL 正确', fixedSql)
    : bad('生成 SQL 正确', fixedSql);

  const rows = await ds.query(source, fixedSql, []);
  rows.length > 0
    ? ok('修复后 SQL 可执行并返回行数', `${rows.length} 行 / ${Object.keys(rows[0]).length} 列`)
    : bad('修复后 SQL 可执行并返回行数', '返回 0 行');

  console.log('\n[5] 端到端：reports.testSql（数据集设计器 test-sql 走的就是它）');
  const r = await reports.testSql({ datasourceId: 0, sql: 'select * from zkcrm-ry', limit: 20 });
  r.rowCount === rows.length
    ? ok('testSql 返回行数一致', `${r.rowCount} 行，耗时 ${r.elapsed}ms`)
    : bad('testSql 返回行数一致', `${r.rowCount} vs ${rows.length}`);
  r.autoQuoted === true
    ? ok('testSql 标记已自动加引号', r.normalizedSql)
    : bad('testSql 标记已自动加引号', String(r.autoQuoted));
  r.columns.length > 0
    ? ok('testSql 返回列元数据', r.columns.map((c) => c.name).join(', '))
    : bad('testSql 返回列元数据', '列为空');

  console.log('\n[6] 端到端：数据集 42（zkcrm-ry，source_type=sql）预览');
  const dataset = await reports.getDataset(42);
  if (!dataset) {
    bad('数据集 42 存在', 'getDataset(42) 返回空');
  } else {
    ok('数据集 42 存在', `${dataset.name} / ${dataset.sourceType} / ${dataset.sourceSql}`);
    try {
      const preview = await reports.previewDataset(42, 20);
      preview.rowCount > 0
        ? ok('previewDataset(42) 成功', `${preview.rowCount} 行，SQL: ${preview.sql}`)
        : bad('previewDataset(42) 成功', '返回 0 行');
      preview.originalSql === 'select * from zkcrm-ry'
        ? ok('preview 保留原始 SQL', preview.originalSql)
        : bad('preview 保留原始 SQL', String(preview.originalSql));
    } catch (err) {
      bad('previewDataset(42) 成功', err.message);
    }
  }

  console.log('\n[7] 幂等：把已修复 SQL 存回再跑一遍（不写库，只跑内存链路）');
  const twice = ds.normalizeSql(source, ds.normalizeSql(source, 'select * from zkcrm-ry'));
  twice === ds.normalizeSql(source, 'select * from zkcrm-ry')
    ? ok('normalizeSql 幂等', twice)
    : bad('normalizeSql 幂等', twice);
  const rows2 = await ds.query(source, ds.paginate(source, twice, 20, 0), []);
  rows2.length === rows.length
    ? ok('二次修复后结果一致', `${rows2.length} 行`)
    : bad('二次修复后结果一致', `${rows2.length} vs ${rows.length}`);

  console.log('\n[8] 错误信息中文可读（表名写错时）');
  try {
    await reports.testSql({ datasourceId: 0, sql: 'select * from zkcrm-ry-not-exist', limit: 1 });
    bad('不存在的表应当报错', '却执行成功');
  } catch (err) {
    const isCn = /数据表不存在|SQL 语法错误/.test(err.message);
    const hasCode = !!err.code;
    isCn && hasCode
      ? ok('错误信息中文且带错误码', `${err.code} / ${err.message.split('\n')[0].slice(0, 90)}`)
      : bad('错误信息中文且带错误码', err.message);
  }

  await ds.invalidateAll();
  finish();
})().catch((err) => {
  console.error('\nFATAL', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});

function finish() {
  console.log('\n' + '─'.repeat(60));
  console.log(`真实库回归：PASS ${pass}，FAIL ${fail}`);
  if (fail) {
    console.log('失败明细：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('结果：ALL PASS');
  process.exit(0);
}
