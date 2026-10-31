'use strict';
/**
 * V8 统一验收脚本（Lead）
 *
 * 用法：
 *   node scripts/v8-acceptance.js               全量
 *   node scripts/v8-acceptance.js --ai          只跑 AI 部分
 *   node scripts/v8-acceptance.js --data        只跑数据对账
 *   node scripts/v8-acceptance.js --flow        只跑流程宽表
 *   node scripts/v8-acceptance.js --regress     只跑历史回归
 *   node scripts/v8-acceptance.js --snapshot=2026-10-30T15:30:00Z
 *
 * 退出码：0 = 全部 PASS；1 = 有 FAIL
 *
 * 依赖：真实数据库（本地 .env）、MIMO_KEY 或 _work/v8/.mimo-key
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const only = (k) => argv.includes('--' + k);
const anyOnly = ['ai', 'data', 'flow', 'regress', 'build'].some(only);
const want = (k) => !anyOnly || only(k);

const results = [];
function rec(group, name, ok, detail) {
  results.push({ group, name, ok, detail: detail === undefined ? '' : String(detail).slice(0, 400) });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`${tag}  [${group}] ${name}${detail ? '  | ' + String(detail).slice(0, 240) : ''}`);
}
function section(title) {
  console.log('\n══════════ ' + title + ' ══════════');
}

/** 跑子脚本，返回 { code, out } */
function runScript(rel, extraArgs) {
  const p = path.resolve(ROOT, rel);
  if (!fs.existsSync(p)) return { code: -1, out: '脚本不存在: ' + rel, missing: true };
  try {
    const out = execFileSync(process.execPath, [p].concat(extraArgs || []), {
      cwd: ROOT, encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024,
      env: Object.assign({}, process.env, { FORCE_COLOR: '0' }),
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status === undefined ? -2 : e.status, out: String((e.stdout || '') + (e.stderr || '')) };
  }
}

/* ══════════════ 1. AI 问数 ══════════════ */
async function testAI() {
  section('1. AI 问数（真实 Mimo 调用）');
  const ai = require('../src/ai');
  const scopeMod = require('../src/ai-scope');
  const reports = require('../src/reports');

  // 1.1 URL 归一化
  const cases = [
    ['https://api.xiaomimimo.com', 'https://api.xiaomimimo.com/v1/chat/completions'],
    ['https://api.xiaomimimo.com/', 'https://api.xiaomimimo.com/v1/chat/completions'],
    ['https://api.xiaomimimo.com/v1', 'https://api.xiaomimimo.com/v1/chat/completions'],
    ['https://api.xiaomimimo.com/v1/', 'https://api.xiaomimimo.com/v1/chat/completions'],
    ['https://api.xiaomimimo.com/v1/chat/completions', 'https://api.xiaomimimo.com/v1/chat/completions'],
    ['https://api.xiaomimimo.com/chat/completions', 'https://api.xiaomimimo.com/v1/chat/completions'],
    ['https://api.xiaomimimo.com/v1/responses', 'https://api.xiaomimimo.com/v1/chat/completions'],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'],
    ['https://api.deepseek.com/v1', 'https://api.deepseek.com/v1/chat/completions'],
  ];
  let urlOk = 0;
  for (const [input, expect] of cases) {
    let got = '';
    try { got = ai.buildEndpoint(input, 'chat'); } catch (e) { got = 'ERR:' + e.message; }
    if (got === expect) urlOk += 1;
    else rec('AI', `URL 归一化 ${input}`, false, `期望 ${expect} 实际 ${got}`);
  }
  rec('AI', `baseUrl 归一化 9 种形态全部正确`, urlOk === cases.length, `${urlOk}/${cases.length}`);

  // 1.2 双拼绝不能出现
  let dbl = false;
  for (const [input] of cases) {
    try { if (/chat\/completions\/chat\/completions/.test(ai.buildEndpoint(input, 'chat'))) dbl = true; } catch (_) {}
  }
  rec('AI', '绝不产生 /chat/completions 双拼（旧版根因）', !dbl);

  // 1.3 mimo 供应商预设
  const mimo = ai.publicProviders().find((p) => p.key === 'mimo');
  rec('AI', 'mimo 预设存在', !!mimo);
  rec('AI', 'mimo baseUrl 指向 api.xiaomimimo.com', !!mimo && /api\.xiaomimimo\.com/.test(mimo.baseUrl || ''), mimo && mimo.baseUrl);
  rec('AI', 'mimo 含 mimo-v2.6-pro', !!mimo && mimo.models.some((m) => m.key === 'mimo-v2.6-pro'));
  rec('AI', 'mimo 含 mimo-v2.6-flash', !!mimo && mimo.models.some((m) => m.key === 'mimo-v2.6-flash'));
  rec('AI', '不再保留错误的 api.mimo.ai 预设', !ai.publicProviders().some((p) => /api\.mimo\.ai/.test(p.baseUrl || '')));

  // 1.4 真实调用
  let tc = null;
  try { tc = await ai.testConnection(); } catch (e) { tc = { ok: false, message: e.message }; }
  rec('AI', 'testConnection 真实调用 Mimo 成功', !!(tc && tc.ok), tc && (tc.message + ' / ' + tc.model + ' / ' + tc.elapsed + 'ms'));

  // 1.5 单范围问数
  try {
    const r = await ai.ask('一共有多少条签约记录？', { scope: [{ kind: 'project', id: 16 }], userId: 1 });
    rec('AI', '单数据项目问数成功', r.ok === true, `rows=${r.rowCount} model=${r.model} ${r.duration}ms`);
    rec('AI', '回答非空', String(r.answer || '').length > 5, String(r.answer || '').slice(0, 100));
    rec('AI', 'SQL 只读（SELECT/WITH 开头）', /^\s*(select|with)\b/i.test(String(r.sql || '')), String(r.sql || '').slice(0, 120));
    rec('AI', '来源标注正确', Array.isArray(r.sources) && r.sources.some((s) => s.kind === 'project' && s.id === 16), JSON.stringify(r.sources));
  } catch (e) { rec('AI', '单数据项目问数成功', false, e.message); }

  // 1.6 多范围（项目 + 邮件）
  try {
    const r = await ai.ask('分别统计这两张表各有多少行', {
      scope: [{ kind: 'project', id: 16 }, { kind: 'mail', id: 19 }], userId: 1,
    });
    rec('AI', '多数据范围问数成功（项目+邮件）', r.ok === true && r.sources.length === 2, `sources=${r.sources.map((s) => s.name).join('+')} rows=${r.rowCount}`);
  } catch (e) { rec('AI', '多数据范围问数成功（项目+邮件）', false, e.message); }

  // 1.7 四类来源都能问
  for (const [label, sc] of [
    ['数据集', [{ kind: 'dataset', id: 22 }]],
    ['邮件推送', [{ kind: 'mail', id: 19 }]],
    ['流程产出表', [{ kind: 'flow', id: 25 }]],
  ]) {
    try {
      const r = await ai.ask('这个表一共有多少行？', { scope: sc, userId: 1 });
      rec('AI', `${label}来源问数成功`, r.ok === true && r.rowCount > 0, `rows=${r.rowCount} ${r.duration}ms`);
    } catch (e) { rec('AI', `${label}来源问数成功`, false, e.message); }
  }

  // 1.8 失败路径
  try { await ai.ask('有多少条', { scope: [] }); rec('AI', '空范围应报错', false, '未报错'); }
  catch (e) { rec('AI', '空范围给出明确中文错误', /数据范围/.test(e.message), e.message.slice(0, 120)); }
  try { await ai.ask('有多少条', { scope: [{ kind: 'dataset', id: 47 }] }); rec('AI', '坏源应报错', false, '未报错'); }
  catch (e) { rec('AI', '坏源给出明确中文错误', /不可用|不存在/.test(e.message), e.message.slice(0, 140)); }

  // 1.9 SQL 白名单
  const src = await scopeMod.resolveScope([{ kind: 'project', id: 16 }]);
  const wl = [
    ['SELECT COUNT(*) FROM `jdywh_parsed_16`', true],
    ['SELECT COUNT(*) FROM t1', true],
    ['SELECT * FROM `jdywh_users`', false],
    ['SELECT * FROM t1 UNION SELECT 1 FROM jdywh_roles', false],
    ['SELECT table_name FROM information_schema.tables', false],
    ['SELECT * FROM mysql.user', false],
    ['SELECT * FROM `zkcrm_user`', false],
    ['DELETE FROM t1', false],
    ['DROP TABLE t1', false],
    ['SELECT 1 FROM t1; DROP TABLE jdywh_users', false],
  ];
  let wlOk = 0;
  for (const [sql, shouldPass] of wl) {
    let got = false;
    try { scopeMod.assertScopeOnly(reports.assertReadOnly(sql), src.sources); got = true; } catch (_) { got = false; }
    if (got === shouldPass) wlOk += 1;
    else rec('AI', `白名单用例 ${sql.slice(0, 40)}`, false, `期望 ${shouldPass} 实际 ${got}`);
  }
  rec('AI', `SQL 表白名单 ${wl.length} 个用例全部正确`, wlOk === wl.length, `${wlOk}/${wl.length}`);

  // 1.10 分享链路（走 HTTP）
  await testSharesHttp();
}

/* ══════════════ 2. AI 分享（HTTP） ══════════════ */
async function testSharesHttp() {
  const http = require('http');
  const port = Number(process.env.PORT) || 8781;
  const auth = require('../src/auth');

  const req = (method, p, body, cookie) => new Promise((resolve, reject) => {
    let data = null;
    const headers = {};
    if (body !== null && body !== undefined) {
      data = JSON.stringify(body); headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (cookie) headers.Cookie = cookie;
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (rs) => {
      let b = ''; rs.on('data', (d) => { b += d; });
      rs.on('end', () => resolve({ status: rs.statusCode, body: b }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
  const J = (r) => { try { return JSON.parse(r.body); } catch (_) { return null; } };

  // 探测服务是否在跑
  try { await req('GET', '/healthz'); } catch (e) {
    rec('分享', `本地服务 ${port} 未启动，跳过分享 HTTP 验收`, false, '请先启动 node src/server.js');
    return;
  }

  const lr = await auth.login('admin', '6655', { headers: {}, ip: '127.0.0.1' });
  if (!lr.ok) { rec('分享', '管理员登录失败，跳过', false, lr.message); return; }
  const cookie = 'jdy_sid=' + lr.token;

  const o = J(await req('GET', '/api/ai/scope-options', null, cookie));
  const dd = o && o.data;
  rec('分享', 'scope-options 四类来源齐全',
    !!dd && ['datasets', 'projects', 'mails', 'flows'].every((k) => Array.isArray(dd[k])),
    dd && Object.keys(dd).join(','));
  rec('分享', '坏源带 invalid + reason', !!dd && dd.datasets.filter((x) => x.invalid).every((x) => !!x.reason));

  const cs = J(await req('POST', '/api/ai/shares', {
    title: 'V8 验收分享', scope: [{ kind: 'project', id: 16 }, { kind: 'mail', id: 19 }], expiresDays: 0, allowExport: true,
  }, cookie));
  const share = cs && cs.data;
  rec('分享', '创建分享返回 token + url', !!(share && share.token && share.url), share && share.url);

  const meta = J(await req('GET', '/api/public/ai-shares/' + share.token));
  rec('分享', '公开 meta 无需登录可访问', !!meta && meta.ok === true, meta && meta.data && meta.data.title);
  rec('分享', '公开 meta 暴露来源名称（不含物理表名）',
    !!meta && meta.data.sources.length >= 2 && !JSON.stringify(meta).includes('jdywh_parsed_16'),
    meta && JSON.stringify(meta.data.sources));

  const ask = J(await req('POST', '/api/public/ai-shares/' + share.token + '/ask', { question: '一共有多少条签约记录？' }));
  rec('分享', '公开问数成功且返回数据', !!ask && ask.data && ask.data.rowCount > 0, ask && `rows=${ask.data && ask.data.rowCount}`);
  rec('分享', '公开问数不回传 SQL（防表结构泄露）', !!ask && ask.data && ask.data.sql === undefined);

  const cs2 = J(await req('POST', '/api/ai/shares', {
    title: 'V8 验收分享（密码）', scope: [{ kind: 'mail', id: 19 }], password: 'p@ss1234', expiresDays: 1,
  }, cookie));
  const s2 = cs2 && cs2.data;
  const m2 = J(await req('GET', '/api/public/ai-shares/' + s2.token));
  rec('分享', '有密码分享未验证时不暴露来源', !!m2 && m2.data.needPassword === true && m2.data.sources.length === 0);
  const m2w = J(await req('GET', '/api/public/ai-shares/' + s2.token + '?pwd=bad'));
  rec('分享', '错误密码被识别', !!m2w && m2w.data.passwordError === true);
  const m2ok = J(await req('GET', '/api/public/ai-shares/' + s2.token + '?pwd=p@ss1234'));
  rec('分享', '正确密码解锁来源', !!m2ok && m2ok.data.passwordError === false && m2ok.data.sources.length > 0);
  const askBad = await req('POST', '/api/public/ai-shares/' + s2.token + '/ask', { question: '多少行', pwd: 'bad' });
  rec('分享', '公开问数密码错 → 403', askBad.status === 403, askBad.status);

  await req('PATCH', '/api/ai/shares/' + share.id, { status: 0 }, cookie);
  const m3 = J(await req('GET', '/api/public/ai-shares/' + share.token));
  rec('分享', '停用后公开访问被拒', !!(m3 && m3.ok === false), m3 && m3.code);
  await req('DELETE', '/api/ai/shares/' + share.id, null, cookie);
  await req('DELETE', '/api/ai/shares/' + s2.id, null, cookie);
  const m4 = await req('GET', '/api/public/ai-shares/' + share.token);
  rec('分享', '删除后公开访问 404', m4.status === 404, m4.status);

  const na = await req('GET', '/api/ai/scope-options');
  rec('分享', '未登录访问管理接口 → 401', na.status === 401, na.status);
}

/* ══════════════ 3. 数据对账 ══════════════ */
function testReconcile() {
  section('2. CRM 两项目数据对账');
  const snap = (argv.find((a) => a.startsWith('--snapshot=')) || '--snapshot=2026-10-30T15:30:00Z').split('=')[1];
  const r = runScript('scripts/v8-reconcile-verify.js', ['--snapshot=' + snap]);
  if (r.missing) { rec('数据', 'v8-reconcile-verify.js 存在', false, '文件缺失'); return; }
  rec('数据', 'v8-reconcile-verify.js 退出码 0', r.code === 0, 'code=' + r.code);
  const m = r.out.match(/非\s*fresh[^\n]*?0[^\n]*/i);
  rec('数据', '非 fresh 行差异 = 0', !!m, m && m[0].slice(0, 160));
  const tail = r.out.trim().split('\n').slice(-12).join('\n');
  console.log('    ── verify 输出尾部 ──\n' + tail.split('\n').map((l) => '    ' + l).join('\n'));
}

/* ══════════════ 4. 流程宽表 ══════════════ */
function testFlow() {
  section('3. 流程宽表 + 实时触发');
  const snap = (argv.find((a) => a.startsWith('--snapshot=')) || '--snapshot=2026-10-30T15:30:00Z').split('=')[1];
  const r = runScript('scripts/v8-flow-verify.js', ['--snapshot=' + snap]);
  if (r.missing) { rec('流程', 'v8-flow-verify.js 存在', false, '文件缺失'); return; }
  rec('流程', 'v8-flow-verify.js 退出码 0', r.code === 0, 'code=' + r.code);
  const m = r.out.match(/非\s*fresh[^\n]*?0\s*差异[^\n]*/i) || r.out.match(/非 fresh 行 96 × 59 逐格 0 差异[^\n]*/);
  rec('流程', '非 fresh 行 96×59 逐格 0 差异', !!m, m && m[0].slice(0, 160));
  const asserts = r.out.match(/断言\s*(\d+)\s*项[：:]\s*PASS\s*(\d+)/);
  rec('流程', '流程断言全通过', !!asserts && asserts[1] === asserts[2], asserts && asserts[0]);
  const tail = r.out.trim().split('\n').slice(-10).join('\n');
  console.log('    ── verify 输出尾部 ──\n' + tail.split('\n').map((l) => '    ' + l).join('\n'));
}

/* ══════════════ 5. 历史回归 ══════════════ */
function testRegress() {
  section('4. 历史版本回归');
  const items = [
    ['V7 流程引擎（132 断言）', 'scripts/v7-flow-join.js', /PASS\s*132|132\s*项[^\n]*PASS\s*132/],
    ['V7 装配 dry-run（11 条）', 'scripts/v7-flow-assembly-dryrun.js', /11\s*项[^\n]*PASS\s*11|PASS\s*11/],
    ['V7 推送接线（9 条）', 'scripts/v7-flow-push-wire.js', /9\s*条[^\n]*PASS\s*9|PASS\s*9/],
    ['V4.1 AI 后端', 'scripts/v41-ai-backend.js', /PASS|通过|OK/i],
    ['V4.1 数据集 SQL', 'scripts/v41-dataset-sql.js', /PASS|通过|OK/i],
    ['V6.1 数据明细筛选', 'scripts/v61-data-filter.js', /PASS|通过|OK/i],
  ];
  for (const [label, rel, re] of items) {
    const r = runScript(rel);
    if (r.missing) { rec('回归', label, false, '脚本缺失 ' + rel); continue; }
    const ok = r.code === 0 && re.test(r.out);
    rec('回归', label, ok, 'code=' + r.code + (ok ? '' : ' | ' + r.out.trim().split('\n').slice(-4).join(' / ').slice(0, 200)));
  }
}

/* ══════════════ 6. 构建 ══════════════ */
function testBuild() {
  section('5. 前端类型检查与构建');
  const fe = path.resolve(ROOT, 'frontend');
  const run = (cmd, args) => {
    try {
      const out = execFileSync(cmd, args, { cwd: fe, encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024, shell: true });
      return { code: 0, out };
    } catch (e) { return { code: e.status === undefined ? -1 : e.status, out: String((e.stdout || '') + (e.stderr || '')) }; }
  };
  const tsc = run('npx', ['tsc', '--noEmit']);
  rec('构建', 'tsc --noEmit 0 错误', tsc.code === 0, tsc.code === 0 ? '' : tsc.out.slice(-600));
  const b = run('npm', ['run', 'build']);
  rec('构建', 'npm run build 成功', b.code === 0, b.code === 0 ? (b.out.match(/built in [\d.]+s/) || [''])[0] : b.out.slice(-600));
  const distIndex = path.resolve(fe, 'dist', 'index.html');
  rec('构建', 'frontend/dist/index.html 存在', fs.existsSync(distIndex));
}

/* ══════════════ main ══════════════ */
(async () => {
  const t0 = Date.now();
  console.log('V8 统一验收开始：' + new Date().toISOString());

  if (want('ai')) { section('0. 环境'); await testAI(); }
  if (want('data')) testReconcile();
  if (want('flow')) testFlow();
  if (want('regress')) testRegress();
  if (want('build')) testBuild();

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log('\n══════════════ 汇总 ══════════════');
  if (fail) {
    console.log('失败项：');
    results.filter((r) => !r.ok).forEach((r) => console.log('  ✗ [' + r.group + '] ' + r.name + ' | ' + r.detail));
  }
  console.log(`合计 ${results.length} 项：PASS ${pass} / FAIL ${fail}；耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const outDir = path.resolve(ROOT, '_work', 'v8', 'reports');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'acceptance-' + Date.now() + '.json'), JSON.stringify({ at: new Date().toISOString(), pass, fail, results }, null, 1), 'utf8');
  } catch (_) { /* ignore */ }

  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('验收脚本异常', e); process.exit(1); });
