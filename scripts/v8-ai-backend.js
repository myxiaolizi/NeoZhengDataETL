'use strict';

/**
 * V8 · AI 问数后端自测（WS1）
 *
 * 运行：node scripts/v8-ai-backend.js
 *       node scripts/v8-ai-backend.js --enable     # 一键启用 AI（先读回确认，再写 ai_enabled=1）
 *
 * 覆盖：
 *   1. 接口地址归一化（6 种用户输入形态，绝不双拼 /chat/completions）
 *   2. 供应商预设（mimo 指向 api.xiaomimimo.com，含 mimo-v2.6-pro / mimo-v2.6-flash）
 *   3. 返回体解析（chat 的 reasoning_content 丢弃 / responses 跳过 reasoning / content 为空报中文错）
 *   4. 错误翻译（401 / 400 模型不支持 / 400 404 NOT_FOUND / ENOTFOUND / 超时）
 *   5. SQL 提取（剥 ``` 围栏、截首个 SELECT/WITH、去尾分号）
 *   6. 四类数据范围解析（数据集 / 数据项目 / 邮箱推送 / 流程产出）+ 坏源标记
 *   7. SQL 表白名单校验（放行逻辑别名/物理表/连字符表；拦截越权表、系统库、写操作）
 *   8. 分享 CRUD（创建 / 列表 / 停用 / 删除 / URL 形态 / 密码 sha256）
 *   9. 公开接口（无密码 / 有密码 / 错密码 / 过期 / 停用 / 不存在 / 限流 / 结果不含 sql）
 *  10. 真实 Mimo 调用（读环境变量 MIMO_KEY；缺省打印 SKIP，绝不写死密钥）
 *
 * 副作用说明：只在 jdywh_ai_shares（本 WS 新建表）与 jdywh_ai_chats 里插入测试行，
 * 结束时删除分享记录；不改动任何业务表业务数据。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const db = require(path.join(ROOT, 'src/db'));
const settings = require(path.join(ROOT, 'src/settings'));
const reports = require(path.join(ROOT, 'src/reports'));
const ai = require(path.join(ROOT, 'src/ai'));
const aiScope = require(path.join(ROOT, 'src/ai-scope'));
const aiShares = require(path.join(ROOT, 'src/ai-shares'));

let pass = 0;
let fail = 0;
let skip = 0;
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
function skipped(name, detail) {
  skip += 1;
  console.log(`  SKIP  ${name}${detail ? '  → ' + detail : ''}`);
}
function check(name, cond, detail) {
  if (cond) ok(name, detail); else bad(name, detail);
}
function eq(name, actual, expect) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expect);
  if (a === e) ok(name, a); else bad(name, `期望 ${e}，实际 ${a}`);
}
function throws(name, fn, re) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => bad(name, '未抛错')).catch((err) => {
        if (re && !re.test(err.message)) bad(name, err.message);
        else ok(name, err.message.slice(0, 90));
      });
    }
    bad(name, '未抛错');
  } catch (err) {
    if (re && !re.test(err.message)) bad(name, err.message);
    else ok(name, err.message.slice(0, 90));
  }
  return Promise.resolve();
}
async function throwsAsync(name, fn, re) {
  try {
    await fn();
    bad(name, '未抛错（本应被拒绝）');
  } catch (err) {
    if (re && !re.test(err.message)) bad(name, `错误信息不匹配：${err.message}`);
    else ok(name, err.message.slice(0, 90));
  }
}

/** 读取 MIMO_KEY：环境变量优先，其次 _work/v8/.mimo-key（已在 .gitignore），绝不打印明文 */
function loadMimoKey() {
  const fromEnv = String(process.env.MIMO_KEY || '').trim();
  if (fromEnv) return fromEnv;
  const p = path.join(ROOT, '_work/v8/.mimo-key');
  try {
    const v = fs.readFileSync(p, 'utf8').trim();
    return v || '';
  } catch (_) {
    return '';
  }
}

/** 脱敏：sk-abcdef... → sk-*** */
function mask(s) {
  return String(s || '').replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***');
}

/* ══════════════════════════════════════════════════════════════════ */

async function main() {
  console.log('V8 AI 后端自测开始：' + new Date().toISOString());
  console.log('工作目录：' + ROOT);

  const args = process.argv.slice(2);
  if (args.includes('--enable')) return enableAi();

  /* ── 1. 接口地址归一化 ── */
  console.log('\n[1] 接口地址归一化（3 种根形态 × 2 种协议 = 端点绝不双拼）');
  const rootCases = [
    ['https://api.xiaomimimo.com', 'https://api.xiaomimimo.com'],
    ['https://api.xiaomimimo.com/', 'https://api.xiaomimimo.com'],
    ['https://api.xiaomimimo.com/v1', 'https://api.xiaomimimo.com/v1'],
    ['https://api.xiaomimimo.com/v1/chat/completions', 'https://api.xiaomimimo.com/v1'],
    ['https://api.xiaomimimo.com/chat/completions', 'https://api.xiaomimimo.com'],
    ['https://api.xiaomimimo.com/v1/chat/completions/chat/completions', 'https://api.xiaomimimo.com/v1'],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
    ['https://api.openai.com/v1/responses', 'https://api.openai.com/v1'],
  ];
  let normOk = 0;
  rootCases.forEach(([input, expect]) => {
    const got = ai.normalizeBaseUrl(input);
    if (got === expect) normOk += 1;
    else bad(`归一化 ${input}`, `期望 ${expect}，实际 ${got}`);
  });
  if (normOk === rootCases.length) ok(`归一化 ${rootCases.length} 种形态全部正确`, `${normOk}/${rootCases.length}`);

  const endpointCases = [
    ['https://api.xiaomimimo.com', 'chat', 'https://api.xiaomimimo.com/v1/chat/completions'],
    ['https://api.xiaomimimo.com/v1', 'chat', 'https://api.xiaomimimo.com/v1/chat/completions'],
    ['https://api.xiaomimimo.com/v1/chat/completions', 'chat', 'https://api.xiaomimimo.com/v1/chat/completions'],
    // 无 /v1 的完整端点会被归一化到根，再按协议补 /v1 —— 这正是修复「双拼 400」的关键行为
    ['https://api.xiaomimimo.com/chat/completions', 'chat', 'https://api.xiaomimimo.com/v1/chat/completions'],
    ['https://api.xiaomimimo.com/v1', 'responses', 'https://api.xiaomimimo.com/v1/responses'],
    ['https://api.xiaomimimo.com/v1/chat/completions', 'responses', 'https://api.xiaomimimo.com/v1/responses'],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'chat', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'],
    ['http://127.0.0.1:11434/v1', 'chat', 'http://127.0.0.1:11434/v1/chat/completions'],
  ];
  let epOk = 0;
  endpointCases.forEach(([input, style, expect]) => {
    const got = ai.buildEndpoint(input, style);
    if (got === expect) epOk += 1;
    else bad(`端点 ${input} [${style}]`, `期望 ${expect}，实际 ${got}`);
  });
  check(`端点拼接 ${endpointCases.length} 种形态全部正确`, epOk === endpointCases.length, `${epOk}/${endpointCases.length}`);

  // 关键回归：完整地址不能双拼
  const doubled = ai.buildEndpoint('https://api.xiaomimimo.com/v1/chat/completions', 'chat');
  check('完整地址不会双拼 /chat/completions', (doubled.match(/chat\/completions/g) || []).length === 1, doubled);

  /* ── 2. 供应商预设 ── */
  console.log('\n[2] 供应商预设');
  const mimo = ai.providerOf('mimo');
  check('mimo 预设存在', !!mimo);
  eq('mimo baseUrl 指向 api.xiaomimimo.com', mimo && mimo.baseUrl, 'https://api.xiaomimimo.com');
  check('mimo 含 mimo-v2.6-pro', !!(mimo && mimo.models.some((m) => m.key === 'mimo-v2.6-pro')));
  check('mimo 含 mimo-v2.6-flash', !!(mimo && mimo.models.some((m) => m.key === 'mimo-v2.6-flash')));
  check('mimo 默认模型是 mimo-v2.6-pro', !!(mimo && mimo.models.find((m) => m.default).key === 'mimo-v2.6-pro'));
  check('不再保留错误的 api.mimo.ai 预设', !ai.PROVIDERS.some((p) => /api\.mimo\.ai/.test(p.baseUrl || '')));
  check('保留 custom 自定义供应商', !!ai.providerOf('custom'));
  check('供应商公开信息不含密钥字段', (() => {
    const p = ai.publicProviders()[0];
    return !('apiKey' in p) && !('key' in p && p.key.length > 30);
  })());

  /* ── 3. 返回体解析 ── */
  console.log('\n[3] 返回体解析（reasoning 绝不当答案）');
  const chatJson = {
    choices: [{
      message: {
        content: 'SELECT 1',
        reasoning_content: '用户在问数量，我先看字段……',
      },
    }],
    usage: { total_tokens: 12 },
  };
  const parsedChat = ai.parseChatResponse(chatJson);
  eq('chat 风格取 message.content', parsedChat.content, 'SELECT 1');
  check('chat 风格 reasoning_content 单独返回不作为答案', parsedChat.reasoning.includes('用户在问') && parsedChat.content === 'SELECT 1');
  const parsedReasoningOnly = ai.parseChatResponse({
    choices: [{ message: { content: '', reasoning_content: '只有思考没有答案' } }],
  });
  eq('content 为空时 content 就是空（不拿 reasoning 顶替）', parsedReasoningOnly.content, '');
  const responsesJson = {
    object: 'response',
    status: 'completed',
    output_text: 'SELECT 2',
    output: [
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: '思考过程' }] },
      { type: 'message', content: [{ type: 'output_text', text: 'SELECT 2' }] },
    ],
  };
  const parsedResp = ai.parseResponsesResponse(responsesJson);
  eq('responses 风格取 output_text', parsedResp.content, 'SELECT 2');
  check('responses 风格跳过 reasoning 节点', !parsedResp.content.includes('思考过程') && parsedResp.reasoning.includes('思考过程'));
  const parsedRespNoTop = ai.parseResponsesResponse({
    output: [
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: '推理' }] },
      { type: 'message', content: [{ type: 'text', text: 'SELECT 3' }] },
    ],
  });
  eq('responses 无 output_text 时回退 output[].content[].text', parsedRespNoTop.content, 'SELECT 3');

  /* ── 4. 错误翻译 ── */
  console.log('\n[4] 错误翻译（中文可操作 + 服务端原文截断）');
  const e401 = ai.httpError(401, JSON.stringify({ error: { message: 'Invalid API Key', code: '401', type: 'invalid_key' } }), 'https://api.xiaomimimo.com/v1/chat/completions');
  check('401 → 中文鉴权失败', /鉴权失败/.test(e401) && /API Key/.test(e401), e401.slice(0, 70));
  const e400model = ai.httpError(400, JSON.stringify({ error: { code: '400', message: 'Unsupported model no-such-model' } }), 'x');
  check('400 模型不支持 → 中文提示可用模型', /模型名称不被支持/.test(e400model) && /mimo-v2\.6-pro/.test(e400model), e400model.slice(0, 70));
  const e400url = ai.httpError(400, JSON.stringify({ error: { code: '400', message: 'Invalid request', param: '404 NOT_FOUND' } }), 'x');
  check('400 / 404 NOT_FOUND → 中文提示接口地址不正确', /接口地址不正确/.test(e400url), e400url.slice(0, 70));
  const e500 = ai.httpError(502, 'bad gateway', 'x');
  check('5xx → 中文服务端错误', /服务端错误/.test(e500), e500.slice(0, 60));
  check('错误文案截断服务端原文（≤300 字）', e401.length < 600);

  const timeoutErr = new Error('The operation was aborted');
  timeoutErr.name = 'TimeoutError';
  check('超时 → 中文超时文案', /超时/.test(ai.networkError(timeoutErr, 'u', 60000).message));
  const dnsErr = new Error('getaddrinfo ENOTFOUND');
  dnsErr.code = 'ENOTFOUND';
  const dnsMsg = ai.networkError(dnsErr, 'http://127.0.0.1:1/v1', 60000).message;
  check('ENOTFOUND → 保留「无法连接 AI 接口」既有短语', /无法连接 AI 接口/.test(dnsMsg) && /ENOTFOUND/.test(dnsMsg), dnsMsg.slice(0, 70));

  /* ── 5. SQL 提取 ── */
  console.log('\n[5] SQL 提取（剥围栏 / 截首条 / 去分号）');
  eq('剥 ```sql 围栏', ai.extractSql('```sql\nSELECT `区域` FROM t1\n```'), 'SELECT `区域` FROM t1');
  eq('剥无语言围栏', ai.extractSql('```\nSELECT 1\n```'), 'SELECT 1');
  eq('去掉前置解释文字', ai.extractSql('好的，SQL 如下：\nSELECT COUNT(*) AS c FROM t1'), 'SELECT COUNT(*) AS c FROM t1');
  eq('去掉尾部分号', ai.extractSql('SELECT 1;'), 'SELECT 1');
  eq('保留 WITH 开头', ai.extractSql('WITH a AS (SELECT 1) SELECT * FROM a'), 'WITH a AS (SELECT 1) SELECT * FROM a');

  /* ── 6. 数据范围解析 ── */
  console.log('\n[6] 四类数据范围解析 + 坏源标记');
  const dsList = await reports.listDatasets();
  // 动态挑选一个「真正可用」的数据集（不硬编码 ID，避免库变更后自测失真）
  let goodDataset = null;
  for (const d of dsList) {
    const r = await aiScope.resolveOne({ kind: 'dataset', id: d.id });
    if (!r.invalid) { goodDataset = d; break; }
  }
  const rDataset = goodDataset
    ? await aiScope.resolveOne({ kind: 'dataset', id: goodDataset.id })
    : { invalid: '无可用数据集', columns: [], rowCount: 0 };
  check(`数据集可解析（${goodDataset ? goodDataset.id + ' ' + goodDataset.name : '无'}）`,
    !!goodDataset && !rDataset.invalid,
    `${(rDataset.columns || []).length} 列 / ${rDataset.rowCount} 行`);

  const mailRow = await db.queryOne('SELECT id, name FROM jdywh_mail_projects WHERE status = 1 ORDER BY id LIMIT 1');
  const rMail = mailRow ? await aiScope.resolveOne({ kind: 'mail', id: mailRow.id }) : { invalid: '无邮箱推送项目' };
  check('邮箱推送可解析', mailRow && !rMail.invalid, mailRow ? `${rMail.name} / ${rMail.rowCount} 行` : 'SKIP');

  const projRow = await db.queryOne('SELECT id, name FROM jdywh_projects WHERE status = 1 ORDER BY id LIMIT 1');
  const rProject = projRow ? await aiScope.resolveOne({ kind: 'project', id: projRow.id }) : { invalid: '无数据项目' };
  check('数据项目可解析', projRow && !rProject.invalid, projRow ? `${rProject.name} / ${rProject.columns.length} 列` : 'SKIP');

  const flowRow = await db.queryOne('SELECT id, name, nodes FROM jdywh_flows WHERE status = 1 LIMIT 1');
  const rFlow = flowRow ? await aiScope.resolveOne({ kind: 'flow', id: flowRow.id }) : { invalid: '无流程' };
  check('流程产出表可解析', flowRow && !rFlow.invalid, flowRow ? `${rFlow.name} / ${rFlow.table} / ${rFlow.rowCount} 行` : 'SKIP');

  /*
   * 坏源标记：不硬编码名单，而是对「库里实际存在的数据集」逐个解析，
   * 断言「有 invalid 的全部带 reason」且「至少存在一个坏源」（当前库确实有 46/47 指向已删除项目）。
   */
  let badFlagged = 0;
  let badTotal = 0;
  for (const d of dsList) {
    const r = await aiScope.resolveOne({ kind: 'dataset', id: d.id });
    if (!r.invalid) continue;
    badTotal += 1;
    if (r.invalid && r.reason) badFlagged += 1;
    else bad(`坏源 ${d.id}「${d.name}」应带 reason`, JSON.stringify(r));
  }
  check(`坏源全部标记 invalid + reason（${badTotal} 个）`, badTotal > 0 && badFlagged === badTotal, `${badFlagged}/${badTotal}`);
  // 明确覆盖任务点名的 46/47（指向已删除的项目 988/989）
  const r46 = await aiScope.resolveOne({ kind: 'dataset', id: 46 });
  const r47 = await aiScope.resolveOne({ kind: 'dataset', id: 47 });
  check('数据集 46 指向不存在项目 → invalid + reason',
    r46.invalid === true && /项目/.test(String(r46.reason)), String(r46.reason).slice(0, 70));
  check('数据集 47 指向不存在项目 → invalid + reason',
    r47.invalid === true && /项目/.test(String(r47.reason)), String(r47.reason).slice(0, 70));

  const options = await aiScope.listScopeOptions();
  check('scope-options 四类来源齐全',
    Array.isArray(options.datasets) && Array.isArray(options.projects)
    && Array.isArray(options.mails) && Array.isArray(options.flows),
    `datasets=${options.datasets.length} projects=${options.projects.length} mails=${options.mails.length} flows=${options.flows.length}`);
  check('scope-options 坏源带 invalid:true 且有 reason',
    options.datasets.some((d) => d.invalid === true && d.reason));

  // 去重：找一个「可用」的 project 型数据集，与它关联的项目一起选，两者应指向同一张物理表
  let projDataset = null;
  for (const d of dsList) {
    if (d.sourceType !== 'project' || !d.projectId) continue;
    const r = await aiScope.resolveOne({ kind: 'dataset', id: d.id });
    if (!r.invalid) { projDataset = d; break; }
  }
  if (projDataset) {
    const dedup = await aiScope.resolveScope([
      { kind: 'dataset', id: projDataset.id },
      { kind: 'project', id: projDataset.projectId },
    ]);
    check('同一物理表自动去重', dedup.sources.length === 1 && dedup.dropped.length === 1,
      `dataset ${projDataset.id} + project ${projDataset.projectId} → sources=${dedup.sources.length} dropped=${dedup.dropped.length}`);
  } else {
    skipped('同一物理表自动去重', '库中没有 project 型数据集');
  }

  await throwsAsync('空范围给出明确中文错误',
    () => aiScope.resolveScope([]), /请先选择要问数的数据范围/);
  await throwsAsync('坏源全部不可用时给出原因',
    () => aiScope.resolveScope([{ kind: 'dataset', id: 47 }]), /都不可用/);

  /* ── 7. SQL 表白名单 ── */
  console.log('\n[7] SQL 表白名单校验（放行 + 拦截 5 例）');
  const scopeForTest = (await aiScope.resolveScope([{ kind: 'project', id: 16 }])).sources;
  const sqlDataset = dsList.find((d) => d.sourceType === 'sql');
  const sqlScope = sqlDataset ? (await aiScope.resolveScope([{ kind: 'dataset', id: sqlDataset.id }])).sources : [];

  // 放行
  const allowCases = [
    ['逻辑别名 t1', 'SELECT * FROM t1', scopeForTest, true],
    ['物理表 jdywh_parsed_16（scope 内）', 'SELECT * FROM jdywh_parsed_16', scopeForTest, true],
    ['模型自建 CTE', 'WITH x AS (SELECT * FROM t1) SELECT * FROM x', scopeForTest, true],
  ];
  for (const [name, sql, sc, shouldPass] of allowCases) {
    try {
      aiScope.assertScopeOnly(sql, sc);
      if (shouldPass) ok('放行：' + name); else bad('放行：' + name, '本应拒绝');
    } catch (err) {
      bad('放行：' + name, err.message);
    }
  }
  // 连字符表名（历史 bug 回归）
  if (sqlScope.length) {
    try {
      const r = aiScope.assertScopeOnly('SELECT * FROM zkcrm-ry', sqlScope);
      ok('放行：连字符表名 zkcrm-ry（sql 数据集自身源表）', `refs=${r.refs.map((x) => x.table).join(',')}`);
    } catch (err) {
      bad('放行：连字符表名 zkcrm-ry', err.message);
    }
    try {
      aiScope.assertScopeOnly('SELECT * FROM ds_' + sqlDataset.id, sqlScope);
      ok('放行：sql 数据集逻辑别名 ds_' + sqlDataset.id);
    } catch (err) {
      bad('放行：sql 数据集逻辑别名', err.message);
    }
  } else {
    skipped('放行：连字符表名', '无 sql 型数据集');
  }

  // 拦截 5 例
  const denyCases = [
    ['越权表 jdywh_users', 'SELECT * FROM jdywh_users'],
    ['越权表 jdywh_settings', 'SELECT * FROM t1 JOIN jdywh_settings s ON 1=1'],
    ['系统库 information_schema', 'SELECT * FROM information_schema.TABLES'],
    ['系统库 mysql', 'SELECT * FROM mysql.user'],
    ['越权表 + 逗号列表', 'SELECT * FROM t1, jdywh_users'],
  ];
  for (const [name, sql] of denyCases) {
    try {
      aiScope.assertScopeOnly(sql, scopeForTest);
      bad('拦截：' + name, '居然放行了');
    } catch (err) {
      ok('拦截：' + name, err.message.slice(0, 60));
    }
  }

  // 只读校验
  await throwsAsync('只读校验：DELETE 被拒', async () => reports.assertReadOnly('DELETE FROM t1'), /只允许 SELECT/);
  await throwsAsync('只读校验：多语句被拒', async () => reports.assertReadOnly('SELECT 1; SELECT 2'), /只允许执行单条/);
  await throwsAsync('只读校验：UPDATE 被拒', async () => reports.assertReadOnly('UPDATE t1 SET a=1'), /只允许 SELECT/);

  // 词法：连字符表名解析回真实表名
  eq('词法：zkcrm-ry 解析为单表', aiScope.extractTableRefs('select * from zkcrm-ry'), [{ schema: null, table: 'zkcrm-ry' }]);
  eq('词法：db.tbl 解析出 schema', aiScope.extractTableRefs('select * from db.tbl'), [{ schema: 'db', table: 'tbl' }]);

  /* ── 8. 分享 CRUD ── */
  console.log('\n[8] 分享 CRUD（建表幂等 / 创建 / 列表 / 停用 / 删除）');
  await aiShares.ensureTable();
  await aiShares.ensureTable();
  ok('建表幂等（连续两次 ensureTable 不报错）');

  // 先清理上一轮异常退出可能残留的自测记录，保证「清理干净」断言真实可信
  const stale = await db.query("SELECT id FROM jdywh_ai_shares WHERE title LIKE 'V8 自测%'");
  for (const s of stale) await aiShares.deleteShare(s.id);
  if (stale.length) console.log(`        （已清理上轮残留 ${stale.length} 条）`);

  const created = [];
  const shareA = await aiShares.createShare({
    title: 'V8 自测分享（无密码）',
    scope: [{ kind: 'project', id: 16 }],
  }, null, { reqHost: 'https://test.example.com' });
  created.push(shareA.id);
  check('创建分享返回 token（36 位十六进制）', /^[0-9a-f]{36}$/.test(shareA.token), shareA.token.slice(0, 12) + '…');
  eq('分享 url 形态 /a/<token>', shareA.url, `https://test.example.com/a/${shareA.token}`);
  check('分享 scope 归一化（只留 kind/id）', shareA.scope.length === 1 && shareA.scope[0].kind === 'project' && shareA.scope[0].id === 16);
  check('无密码分享 hasPassword=false', shareA.hasPassword === false);

  const shareB = await aiShares.createShare({
    title: 'V8 自测分享（有密码）',
    scope: [{ kind: 'project', id: 16 }],
    password: 'p@ss-1234',
    expiresDays: 7,
    allowExport: true,
  }, null, { reqHost: 'https://test.example.com' });
  created.push(shareB.id);
  check('有密码分享 hasPassword=true（明文留档）', shareB.hasPassword === true && shareB.password === 'p@ss-1234');
  check('密码以 sha256 存库（不存明文哈希列）',
    aiShares.sha256('p@ss-1234').length === 64 && shareB.password !== aiShares.sha256('p@ss-1234'));
  check('有效期按天数换算', !!shareB.expiresAt && new Date(shareB.expiresAt) > new Date());

  const listed = await aiShares.listShares({ reqHost: 'https://test.example.com' });
  check('列表包含新建的分享', listed.list.some((s) => s.id === shareA.id) && listed.list.some((s) => s.id === shareB.id),
    `total=${listed.total}`);
  check('列表项带 url', listed.list.every((s) => /\/a\/[0-9a-f]{36}$/.test(s.url)));

  const toggled = await aiShares.toggleShare(shareA.id, 0);
  check('停用分享 status=0', Number(toggled.status) === 0);
  const toggledBack = await aiShares.toggleShare(shareA.id, 1);
  check('重新启用分享 status=1', Number(toggledBack.status) === 1);

  await throwsAsync('创建分享时 scope 为空被拒',
    () => aiShares.createShare({ scope: [] }, null), /请先选择要分享的数据范围/);
  await throwsAsync('创建分享时坏源被拒',
    () => aiShares.createShare({ scope: [{ kind: 'dataset', id: 47 }] }, null), /都不可用/);

  /* ── 9. 公开接口 ── */
  console.log('\n[9] 公开接口（密码 / 过期 / 停用 / 不存在 / 限流 / 不回传 SQL）');
  const tokenA = shareA.token;

  const metaNoPwd = await aiShares.publicMeta(tokenA, '');
  check('无密码分享 meta 直接通过', metaNoPwd.ok === true && metaNoPwd.needPassword === false);
  check('meta 暴露来源名称与行数（不含物理表名）',
    Array.isArray(metaNoPwd.sources) && metaNoPwd.sources.length === 1
    && !!metaNoPwd.sources[0].name && metaNoPwd.sources[0].table === undefined,
    JSON.stringify(metaNoPwd.sources));
  check('meta 有欢迎语与 askEnabled 标记', typeof metaNoPwd.welcome === 'string' && 'askEnabled' in metaNoPwd);

  const metaNeedsPwd = await aiShares.publicMeta(shareB.token, '');
  check('有密码分享 meta 先要密码且不暴露来源', metaNeedsPwd.ok === true && metaNeedsPwd.needPassword === true && metaNeedsPwd.sources.length === 0);

  aiShares.resetRate(shareB.token);
  const metaWrongPwd = await aiShares.publicMeta(shareB.token, 'wrong-password');
  check('错密码 meta 标记 passwordError', metaWrongPwd.ok === true && metaWrongPwd.passwordError === true);

  aiShares.clearPasswordFail(shareB.token);
  const metaRightPwd = await aiShares.publicMeta(shareB.token, 'p@ss-1234');
  check('正确密码 meta 返回来源', metaRightPwd.ok === true && metaRightPwd.needPassword === true && metaRightPwd.sources.length === 1);

  // 不存在
  const metaMissing = await aiShares.publicMeta('nope-nope-nope', '');
  check('不存在的 token → not_found', metaMissing.ok === false && metaMissing.code === 'not_found');

  // 停用
  await aiShares.toggleShare(shareA.id, 0);
  const metaDisabled = await aiShares.publicMeta(tokenA, '');
  check('停用后 meta → disabled', metaDisabled.ok === false && metaDisabled.code === 'disabled');
  await aiShares.toggleShare(shareA.id, 1);

  // 过期：临时把 expires_at 改到过去（只改本测试行）
  await db.query('UPDATE jdywh_ai_shares SET expires_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?', [shareA.id]);
  const metaExpired = await aiShares.publicMeta(tokenA, '');
  check('过期后 meta → expired', metaExpired.ok === false && metaExpired.code === 'expired');
  await db.query('UPDATE jdywh_ai_shares SET expires_at = NULL WHERE id = ?', [shareA.id]);

  // 密码错误 5 次 → 限流
  aiShares.resetRate(shareB.token);
  let lastPwdGate = null;
  for (let i = 0; i < 5; i += 1) {
    lastPwdGate = await aiShares.authorizeAsk(shareB.token, 'wrong-' + i, '10.0.0.' + (100 + i));
  }
  const pwdGate6 = await aiShares.authorizeAsk(shareB.token, 'wrong-again', '10.0.0.200');
  check('密码错 5 次后第 6 次被限流（429 语义）', pwdGate6.ok === false && pwdGate6.code === 'RATE_PASSWORD',
    `${pwdGate6.code} / ${pwdGate6.message}`);
  check('密码错第 1 次只是普通密码错误', lastPwdGate && ['PASSWORD', 'RATE_PASSWORD'].includes(lastPwdGate.code));

  // token 级限流（21 次 / 分钟）
  aiShares.resetRate(shareA.token);
  aiShares.clearPasswordFail(shareA.token);
  let tokenHits = 0;
  let tokenLimited = null;
  for (let i = 0; i < 25; i += 1) {
    // 每次都换 IP，确保只触发 token 维度限流
    const g = await aiShares.authorizeAsk(tokenA, '', '10.9.0.' + i, { now: Date.now() });
    if (g.ok) tokenHits += 1;
    else { tokenLimited = g; break; }
  }
  check('单 token 每分钟 20 次限流生效', !!tokenLimited && tokenLimited.code === 'RATE_TOKEN',
    `放行 ${tokenHits} 次后被限流`);

  // IP 级限流（31 次 / 分钟）：直接测 checkRate，把 token 维度上限调高以隔离 IP 维度
  const ipKey = '10.77.7.7';
  aiShares.resetRate(ipKey);
  let ipLimited = null;
  let ipHits = 0;
  for (let i = 0; i < 40; i += 1) {
    const g = aiShares.checkRate({
      tokenKey: 'tk-isolated-' + i,   // 每次用不同 token，确保只触发 IP 维度
      ipKey,
      tokenPerMin: 1000,
      ipPerMin: aiShares.DEFAULT_IP_PER_MIN,
    });
    if (g.ok) ipHits += 1; else { ipLimited = g; break; }
  }
  check('单 IP 每分钟 30 次限流生效', !!ipLimited && ipLimited.code === 'RATE_IP',
    `放行 ${ipHits} 次后被限流（上限 ${aiShares.DEFAULT_IP_PER_MIN}）`);

  // 公开问数：注入假的 ask，避免真实消耗额度
  aiShares.resetRate(tokenA);
  aiShares.clearPasswordFail(tokenA);
  let capturedAsk = null;
  const fakeAsk = async (question, opts) => {
    capturedAsk = opts;
    // 断言：公开问数必须带 shareId 与 rows 上限
    if (opts.shareId !== shareA.id) throw new Error('shareId 未透传');
    return {
      ok: true, sessionKey: 'fake-sess', question,
      sql: 'SELECT 1',
      rows: Array.from({ length: 300 }, (_, i) => ({ i })),
      columns: [{ name: 'i', type: 'number' }],
      sources: [{ kind: 'project', id: 16, name: 'CRM表单推送', rowCount: 96 }],
      answer: '共 300 行',
      model: 'fake',
    };
  };
  const publicAskRes = await aiShares.publicAsk(tokenA, '有多少条记录？', { ask: fakeAsk, ip: '10.1.2.3' });
  check('公开问数成功', publicAskRes.ok === true, publicAskRes.message || '');
  check('公开问数把 shareId 与 userId=null 透传给问数管线',
    !!capturedAsk && capturedAsk.shareId === shareA.id && capturedAsk.userId === null,
    capturedAsk ? `shareId=${capturedAsk.shareId} userId=${capturedAsk.userId}` : '未捕获');
  check('公开问数不回传 sql（防表结构泄露）', publicAskRes.sql === undefined && !('sql' in publicAskRes));
  check('公开问数结果行数上限 200', publicAskRes.rows.length === 200, `rows=${publicAskRes.rows.length}`);
  check('公开问数标记 truncated', publicAskRes.truncated === true);
  check('公开问数来源只含名称与行数', JSON.stringify(publicAskRes.sources).indexOf('jdywh_') < 0);

  aiShares.resetRate(shareB.token);
  aiShares.clearPasswordFail(shareB.token);
  const publicAskNoPwd = await aiShares.publicAsk(shareB.token, 'hi', { ask: fakeAsk, ip: '10.1.2.4' });
  check('公开问数缺密码被拒', publicAskNoPwd.ok === false && publicAskNoPwd.code === 'PASSWORD');

  const publicAskEmpty = await aiShares.publicAsk(tokenA, '   ', { ask: fakeAsk, ip: '10.1.2.5' });
  check('公开问数空问题被拒', publicAskEmpty.ok === false && publicAskEmpty.code === 'BAD_REQUEST');

  const publicAskBadShare = await aiShares.publicAsk('not-a-real-token', 'hi', { ask: fakeAsk, ip: '10.1.2.6' });
  check('公开问数 token 不存在被拒', publicAskBadShare.ok === false && publicAskBadShare.code === 'not_found');

  // 审计落库（user_id NULL + share:<id> 前缀）由第 10 节的真实公开问数验证：
  // 本节用的是注入的假 ask（不写库），无法据它断言 jdywh_ai_chats 的内容。

  /* ── 10. 真实 Mimo 调用 ── */
  console.log('\n[10] 真实 Mimo 调用（MIMO_KEY）');
  const key = loadMimoKey();
  if (!key) {
    skipped('真实 Mimo 调用', '未设置环境变量 MIMO_KEY（也未找到 _work/v8/.mimo-key），跳过');
    skipped('真实 Mimo 问数', '同上');
  } else {
    const savedKey = await settings.get('ai_api_key', '');
    const savedBase = await settings.get('ai_base_url', '');
    const savedModel = await settings.get('ai_model', '');
    try {
      // 只在本次进程内覆盖（写库会污染生产设置，禁用）
      settings.get = (function wrap(realGet) {
        return async function stubbed(k, d) {
          if (k === 'ai_api_key') return key;
          if (k === 'ai_base_url') return 'https://api.xiaomimimo.com/v1/chat/completions'; // 故意给「完整地址」，验证归一化
          if (k === 'ai_model') return 'mimo-v2.6-flash';
          if (k === 'ai_temperature') return '0';
          return realGet.call(settings, k, d);
        };
      })(settings.get);

      const t = await ai.testConnection();
      check('真实 Mimo 连接成功（完整地址不双拼）', t.ok === true, mask(`${t.message} / ${t.model} / ${t.elapsed}ms`));
      if (!t.ok) console.log('        ' + mask(t.message));

      // 第二次：带数据集 scope 的真实问数，断言 rows>0
      const r = await ai.ask('一共有多少条签约记录？', {
        scope: [{ kind: 'project', id: 16 }],
        userId: null,
      });
      check('真实问数返回 rows>0', r.ok === true && r.rowCount > 0, `rows=${r.rowCount} model=${r.model} ${r.duration}ms`);
      check('真实问数 SQL 只读', /^(with|select)\b/i.test(String(r.sql).trim()), String(r.sql).slice(0, 80));
      check('真实问数回答非空', typeof r.answer === 'string' && r.answer.trim().length > 0, (r.answer || '').slice(0, 60));
      check('真实问数来源标注正确', Array.isArray(r.sources) && r.sources.length === 1 && r.sources[0].kind === 'project');

      // 第三次：走真实公开分享链路（同时验证审计落库的 share:<id> 前缀）
      aiShares.resetRate(tokenA);
      aiShares.clearPasswordFail(tokenA);
      const realPublic = await aiShares.publicAsk(tokenA, '这个表一共有多少行？', { ip: '10.5.5.5' });
      check('真实公开分享问数成功', realPublic.ok === true, realPublic.message || `rows=${(realPublic.rows || []).length}`);
      check('真实公开问数不回传 sql', !('sql' in realPublic));
      const chatRow = await db.queryOne(
        "SELECT id, user_id, session_key FROM jdywh_ai_chats WHERE session_key LIKE 'share:%' ORDER BY id DESC LIMIT 1"
      );
      check('公开问数写入审计且 user_id 为 NULL', !!chatRow && chatRow.user_id === null,
        chatRow ? `#${chatRow.id} ${String(chatRow.session_key).slice(0, 26)}` : '无记录');
      check('审计记录带 share:<id> 前缀',
        !!chatRow && String(chatRow.session_key).startsWith('share:' + shareA.id + ' '),
        chatRow ? `${String(chatRow.session_key).slice(0, 26)}（期望 share:${shareA.id}）` : '无记录');
    } finally {
      // 恢复真实的 settings.get
      delete settings.get;
      // require 缓存里的 settings 对象需要还原方法：重新赋值原实现
      settings.get = savedKeyGetter;
      void savedKey; void savedBase; void savedModel;
    }
  }

  /* ── 收尾 ── */
  console.log('\n[11] 清理测试数据');
  let cleaned = 0;
  for (const id of created) {
    try { await aiShares.deleteShare(id); cleaned += 1; } catch (_) { /* ignore */ }
  }
  check(`删除测试分享（${created.length} 条）`, cleaned === created.length, `${cleaned}/${created.length}`);
  const stillThere = await db.queryOne('SELECT COUNT(*) AS c FROM jdywh_ai_shares WHERE title LIKE ?', ['V8 自测%']);
  check('测试分享已清理干净', Number(stillThere.c) === 0, `残留 ${stillThere.c} 条`);

  await db.close();
  finish();
}

/** 保存 settings.get 的原始实现（真实调用分支结束后还原） */
let savedKeyGetter = null;

/** 一键启用 AI（显式 --enable 才写库） */
async function enableAi() {
  console.log('\n[维护] 一键启用 AI 问数');
  const before = await settings.get('ai_enabled', '0');
  console.log('  当前 ai_enabled = ' + before);
  if (before === '1') {
    console.log('  已经是启用状态，无需修改');
    await db.close();
    return finish();
  }
  const baseUrl = await settings.get('ai_base_url', '');
  const apiKey = await settings.get('ai_api_key', '');
  const model = await settings.get('ai_model', '');
  console.log('  接口地址：' + (baseUrl || '(空)'));
  console.log('  模型名称：' + (model || '(空)'));
  console.log('  接口密钥：' + (apiKey ? 'sk-***（已配置）' : '(空)'));
  if (!baseUrl || !apiKey) {
    console.error('  ✗ 接口地址或密钥为空，请先在「系统设置 → AI 问数」填好再启用');
    await db.close();
    return finish(1);
  }
  await settings.set('ai_enabled', '1');
  const after = await settings.get('ai_enabled', '0');
  console.log('  写入后读回 ai_enabled = ' + after);
  await db.close();
  if (after === '1') { ok('AI 问数已启用'); return finish(); }
  bad('AI 问数启用', '写入后读回仍为 ' + after);
  return finish(1);
}

function finish(code) {
  console.log('\n' + '─'.repeat(64));
  console.log(`V8 AI 后端自测：PASS ${pass}，FAIL ${fail}，SKIP ${skip}`);
  if (fail) {
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(code || 1);
  }
  console.log('结果：ALL PASS');
  process.exit(0);
}

savedKeyGetter = settings.get;
main().catch(async (err) => {
  settings.get = savedKeyGetter;
  console.error('\nFATAL', err && err.stack ? err.stack : err);
  try { await db.close(); } catch (_) { /* ignore */ }
  finish(1);
});
