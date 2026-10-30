'use strict';
/**
 * V4.1 AI 问数后端回归（离线，不调用真实大模型）
 *
 * 运行：node scripts/v41-ai-backend.js
 *
 * 做法：打桩 settings.get 让 ai.js 拿到假接口地址，再全局替换 fetch，
 * 让"大模型"返回固定的 SQL，从而完整跑通 ask() 的
 *   schema 上下文 → 生成 SQL → assertReadOnly → normalizeSql → paginate → 执行 → 解读
 * 全链路。不写库（saveChat 失败只打日志），不产生副作用。
 */

const path = require('path');
const settings = require('../src/settings');
const ai = require('../src/ai');
const ds = require('../src/datasource');

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

const realGet = settings.get.bind(settings);
settings.get = async function stubbed(key, def) {
  if (key === 'ai_base_url') return 'http://127.0.0.1:1/v1';
  if (key === 'ai_api_key') return 'test-key';
  if (key === 'ai_model') return 'deepseek-chat';
  return realGet(key, def);
};

/** 让"大模型"按需返回指定 SQL 或指定自然语言总结 */
let nextSql = 'select * from zkcrm-ry';
const realFetch = global.fetch;
global.fetch = async function fakeFetch(url, opts) {
  const body = JSON.parse(opts.body || '{}');
  const sys = (body.messages || []).find((m) => m.role === 'system') || {};
  const isExplain = String(sys.content || '').indexOf('数据分析助手') >= 0
    && String(sys.content || '').indexOf('MySQL') < 0;
  const content = isExplain
    ? '共查询到若干行人员对应数据。'
    : nextSql;
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      choices: [{ message: { content } }],
      usage: { total_tokens: 42 },
    }),
  };
};

(async () => {
  console.log('[1] 环境准备：确认有可用数据集与数据源');
  const dsList = require('../src/reports');
  const all = await dsList.listDatasets();
  all.length > 0 ? ok('存在数据集', `${all.length} 个`) : bad('存在数据集', '0 个');
  const zkcrm = all.find((d) => d.name === 'zkcrm-ry');
  zkcrm ? ok('数据集 zkcrm-ry 存在', 'id=' + zkcrm.id) : bad('数据集 zkcrm-ry 存在', '未找到');

  console.log('\n[2] 关键回归：模型生成「未加引号的连字符表名」SQL');
  nextSql = 'select * from zkcrm-ry';
  try {
    const r = await ai.ask('列出人员对应关系', { userId: null, datasetId: zkcrm ? zkcrm.id : undefined });
    r.ok && r.rowCount > 0
      ? ok('AI 问数执行成功（旧代码此处必报 1064）', `${r.rowCount} 行，SQL: ${r.sql}`)
      : bad('AI 问数执行成功', JSON.stringify({ ok: r.ok, rowCount: r.rowCount }));
    r.sql === 'select * from zkcrm-ry'
      ? ok('返回的 SQL 保留用户/模型原文（未强改）', r.sql)
      : bad('返回的 SQL 保留原文', r.sql);
  } catch (err) {
    bad('AI 问数执行成功', err.message);
  }

  console.log('\n[3] 回归：模型生成 WITH 查询（旧 paginate 会误判/报错）');
  nextSql = 'with c as (select * from zkcrm-ry) select * from c';
  try {
    const r = await ai.ask('用 CTE 查人员', { userId: null, datasetId: zkcrm ? zkcrm.id : undefined });
    r.ok && r.rowCount > 0
      ? ok('WITH 查询可执行', `${r.rowCount} 行`)
      : bad('WITH 查询可执行', JSON.stringify({ ok: r.ok, rowCount: r.rowCount }));
  } catch (err) {
    bad('WITH 查询可执行', err.message);
  }

  console.log('\n[4] 回归：assertReadOnly 不再误杀含 update/delete 字样的字符串');
  nextSql = "select * from zkcrm-ry where 区域 = 'please update delete me'";
  try {
    const r = await ai.ask('查北区', { userId: null, datasetId: zkcrm ? zkcrm.id : undefined });
    r.ok ? ok('字符串含写操作关键字不被误杀', `${r.rowCount} 行`)
      : bad('字符串含写操作关键字不被误杀', JSON.stringify(r));
  } catch (err) {
    bad('字符串含写操作关键字不被误杀', err.message);
  }

  console.log('\n[5] 安全：模型生成写操作必须被拦住');
  nextSql = 'delete from zkcrm-ry';
  try {
    await ai.ask('删掉数据', { userId: null, datasetId: zkcrm ? zkcrm.id : undefined });
    bad('写操作被拒绝', '居然执行成功');
  } catch (err) {
    /只允许 SELECT|不允许的关键字/.test(err.message)
      ? ok('写操作被拒绝', err.message.slice(0, 50))
      : bad('写操作被拒绝', err.message);
  }

  console.log('\n[6] 错误信息中文可读：模型生成不存在的表');
  nextSql = 'select * from zkcrm-ry_not_exist';
  try {
    await ai.ask('查不存在的表', { userId: null, datasetId: zkcrm ? zkcrm.id : undefined });
    bad('表不存在报错可读', '居然执行成功');
  } catch (err) {
    /数据表不存在|SQL 语法错误/.test(err.message) && err.code
      ? ok('中文错误 + 错误码', `${err.code} / ${err.message.split('\n')[0].slice(0, 70)}`)
      : bad('中文错误 + 错误码', err.message);
  }

  console.log('\n[7] 大模型接口超时/网络异常的兜底文案');
  global.fetch = async () => {
    const e = new Error('The operation was aborted due to timeout');
    e.name = 'TimeoutError';
    throw e;
  };
  try {
    await ai.callLLM([{ role: 'user', content: 'hi' }]);
    bad('超时被翻译成中文', '未抛错');
  } catch (err) {
    /超时/.test(err.message) ? ok('超时被翻译成中文', err.message) : bad('超时被翻译成中文', err.message);
  }

  global.fetch = async () => {
    const e = new Error('getaddrinfo ENOTFOUND');
    e.code = 'ENOTFOUND';
    throw e;
  };
  try {
    await ai.callLLM([{ role: 'user', content: 'hi' }]);
    bad('网络错误被翻译成中文', '未抛错');
  } catch (err) {
    /无法连接 AI 接口/.test(err.message) ? ok('网络错误被翻译成中文', err.message.slice(0, 60))
      : bad('网络错误被翻译成中文', err.message);
  }

  global.fetch = realFetch;
  await ds.invalidateAll();
  finish();
})().catch((err) => {
  global.fetch = realFetch;
  console.error('\nFATAL', err && err.stack ? err.stack : err);
  finish(1);
});

function finish(code) {
  console.log('\n' + '─'.repeat(60));
  console.log(`AI 后端回归：PASS ${pass}，FAIL ${fail}`);
  if (fail) {
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(code || 1);
  }
  console.log('结果：ALL PASS');
  process.exit(0);
}
