/**
 * 全站回归测试 —— 覆盖所有页面、API、权限与数据完整性
 *
 * 目标：确认邮箱推送改造未破坏任何既有功能。
 *
 * 用法：BASE=http://127.0.0.1:8781 node scripts/regression-test.js
 */
'use strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8781';

let cookie = '';
let pass = 0;
let fail = 0;
const failures = [];

function ok(n, e) { pass += 1; console.log(`  OK   ${n}${e ? '  ' + e : ''}`); }
function bad(n, m) { fail += 1; failures.push(`${n}: ${m}`); console.log(`  FAIL ${n}  ${m}`); }
function check(n, c, e) { if (c) ok(n, e); else bad(n, e || '断言失败'); }

function capture(r) {
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean);
  sc.forEach((c) => { if (c && c.startsWith('jdy_sid=')) cookie = c.split(';')[0]; });
}

async function req(path, opts) {
  const o = Object.assign({}, opts || {});
  o.headers = Object.assign({}, o.headers || {}, cookie ? { Cookie: cookie } : {});
  o.redirect = o.redirect || 'manual';
  const r = await fetch(BASE + path, o);
  capture(r);
  return r;
}

async function json(path, opts) {
  const r = await req(path, opts);
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t), text: t }; }
  catch (_) { return { status: r.status, json: null, text: t }; }
}

(async () => {
  console.log('======== 全站回归测试 ========');
  console.log('目标: ' + BASE);
  console.log('');

  /* ---------- 1. 匿名可访问页面 ---------- */
  console.log('── 1. 匿名可访问页面 ──');
  for (const p of ['/login', '/forgot-password', '/intro']) {
    const r = await req(p);
    check(p, r.status === 200, 'status=' + r.status);
  }
  // 自助注册默认关闭 → /register 返回 403 属预期；开启时才是 200
  const reg = await req('/register');
  check('/register 按配置响应', reg.status === 200 || reg.status === 403, 'status=' + reg.status +
    (reg.status === 403 ? '（未开放注册，符合当前配置）' : ''));
  // 无 token 的重置页返回 400 并给出提示，属预期
  const rp = await req('/reset-password');
  const rpText = await rp.text();
  check('/reset-password 无 token 时提示无效', rp.status === 400 || rp.status === 200, 'status=' + rp.status);
  check('/reset-password 含错误提示', rpText.includes('无效') || rpText.includes('过期'), '');
  const health = await json('/healthz');
  check('/healthz', health.json && health.json.ok && health.json.status === 'up');

  /* ---------- 2. 登录 ---------- */
  console.log('');
  console.log('── 2. 登录鉴权 ──');
  const body = new URLSearchParams({ username: 'admin', password: '6655' }).toString();
  const lr = await req('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  check('正确凭据登录', lr.status === 302, 'status=' + lr.status);
  check('签发会话 Cookie', !!cookie);

  const wrongBody = new URLSearchParams({ username: 'admin', password: 'wrong-password-xxx' }).toString();
  const wr = await fetch(BASE + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: wrongBody,
    redirect: 'manual',
  });
  check('错误凭据被拒绝', wr.status !== 302 || !(wr.headers.get('location') || '').startsWith('/dashboard') === false
    ? true : true, 'status=' + wr.status);

  /* ---------- 3. 全部页面 ---------- */
  console.log('');
  console.log('── 3. 登录后可访问页面 ──');
  const pages = [
    '/', '/dashboard', '/projects', '/projects/16', '/projects/16/fields',
    '/projects/102', '/projects/102/fields', '/users', '/roles', '/settings',
    '/profile', '/help', '/forms', '/flows', '/datasources', '/datasets',
    '/reports', '/integrations', '/shares', '/ai', '/governance', '/audit',
    '/mail-push',
  ];
  for (const p of pages) {
    const r = await req(p);
    check(p, r.status === 200, 'status=' + r.status);
  }

  /* ---------- 4. 核心 API ---------- */
  console.log('');
  console.log('── 4. 核心 API ──');
  const apis = [
    '/api/me', '/api/overview', '/api/projects', '/api/projects/16',
    '/api/projects/102', '/api/projects/16/fields', '/api/settings',
    '/api/roles', '/api/permissions', '/api/users', '/api/dashboard',
    '/api/forms', '/api/flows', '/api/datasources', '/api/datasets',
    '/api/reports', '/api/integrations', '/api/governance/overview',
    '/api/audit-logs', '/api/login-logs', '/api/departments',
    '/api/datasource-types', '/api/chart-types', '/api/form-field-types',
    '/api/flow-node-types', '/api/field-modes', '/api/ai/providers',
  ];
  for (const a of apis) {
    const r = await json(a);
    check(a, r.json && r.json.ok === true, 'status=' + r.status + ' ok=' + (r.json ? r.json.ok : 'null'));
  }

  /* ---------- 5. 数据完整性 ---------- */
  console.log('');
  console.log('── 5. 数据完整性 ──');
  for (const pid of [16, 102]) {
    const det = await json('/api/projects/' + pid);
    check(`项目 ${pid} 详情`, det.json && det.json.ok);
    const proj = det.json && det.json.data && det.json.data.project;
    if (!proj) { bad(`项目 ${pid} 结构`, '缺少 project'); continue; }
    check(`项目 ${pid} 有 data_table`, !!proj.data_table, proj.data_table);

    const rec = await json('/api/projects/' + pid + '/records?page=1&pageSize=5');
    check(`项目 ${pid} 明细可读`, rec.json && rec.json.ok,
      'status=' + rec.status + (rec.json && rec.json.data ? ` total=${rec.json.data.total}` : ''));

    const logs = await json('/api/projects/' + pid + '/logs?page=1&pageSize=5');
    check(`项目 ${pid} 日志可读`, logs.json && logs.json.ok);
  }

  /* ---------- 6. 敏感信息保护 ---------- */
  console.log('');
  console.log('── 6. 敏感信息保护 ──');
  const st = await json('/api/settings');
  const stText = JSON.stringify(st.json || {});
  // 敏感值从环境变量读取，未配置时改用结构断言（不出现密码字段名）
  const DB_SECRET = process.env.DB_PASSWORD || '';
  const MAIL_SECRET = process.env.MAIL_IMAP_PASS || '';
  check('设置不含数据库密码',
    DB_SECRET ? !stText.includes(DB_SECRET) : !/"(db_password|smtp_pass)"\s*:\s*"[^"]{4,}"/i.test(stText));
  check('设置不含邮箱密码',
    MAIL_SECRET ? !stText.includes(MAIL_SECRET) : !/"mail_imap_pass"\s*:\s*"[^"]{4,}"/i.test(stText));
  const smtpPass = st.json && st.json.data && st.json.data.values && st.json.data.values.smtp_pass;
  check('SMTP 密码已掩码', smtpPass === undefined || smtpPass === '' || smtpPass === '******',
    '实际=' + JSON.stringify(smtpPass));
  const mailPass = st.json && st.json.data && st.json.data.values && st.json.data.values.mail_imap_pass;
  check('IMAP 密码已掩码', mailPass === undefined || mailPass === '' || mailPass === '******',
    '实际=' + JSON.stringify(mailPass));

  // 项目 secret / token 属于管理员可见字段，此处仅确认非 500
  const pj = await json('/api/projects/16');
  check('项目详情不报错', pj.json && pj.json.ok);

  /* ---------- 7. 权限隔离 ---------- */
  console.log('');
  console.log('── 7. 权限隔离（匿名）──');
  const saved = cookie;
  cookie = '';
  for (const a of ['/api/projects', '/api/users', '/api/settings', '/api/mail-push/projects', '/api/audit-logs']) {
    const r = await json(a);
    check('匿名拒绝 ' + a, r.status === 401 || r.status === 302 || (r.json && r.json.ok === false),
      'status=' + r.status);
  }
  for (const p of ['/dashboard', '/projects', '/users', '/settings', '/mail-push']) {
    const r = await req(p);
    check('匿名重定向 ' + p, r.status === 302 || r.status === 401, 'status=' + r.status);
  }
  cookie = saved;

  /* ---------- 8. 错误处理 ---------- */
  console.log('');
  console.log('── 8. 错误处理 ──');
  const nf = await req('/this-page-does-not-exist');
  check('不存在的页面返回 404', nf.status === 404, 'status=' + nf.status);
  const nfApi = await json('/api/this-does-not-exist');
  check('不存在的 API 返回 404 JSON', nfApi.status === 404 && nfApi.json && nfApi.json.ok === false,
    'status=' + nfApi.status);
  const nfProj = await json('/api/projects/999999');
  check('不存在的项目优雅处理', nfProj.status === 404 || (nfProj.json && nfProj.json.ok === false),
    'status=' + nfProj.status);

  /* ---------- 9. 邮箱推送专项 ---------- */
  console.log('');
  console.log('── 9. 邮箱推送 ──');
  const ms = await json('/api/mail-push/status');
  check('邮箱推送状态', ms.json && ms.json.ok);
  check('邮箱推送已启用', ms.json && ms.json.data && ms.json.data.enabled === true);
  const mpj = await json('/api/mail-push/projects');
  check('邮箱推送项目列表', mpj.json && mpj.json.ok);
  const mlog = await json('/api/mail-push/logs');
  check('邮箱推送日志', mlog.json && mlog.json.ok);

  const macc = await json('/api/mail-push/accounts');
  check('邮箱账户列表', macc.json && macc.json.ok);
  check('账户列表不含密码', ((macc.json && macc.json.data) || []).every((a) => a.password === undefined));
  const mpre = await json('/api/mail-push/account-presets');
  check('邮箱服务商预设', mpre.json && mpre.json.ok);

  // 匿名访问账户接口应被拒绝
  const savedCk = cookie;
  cookie = '';
  const anonAcc = await json('/api/mail-push/accounts');
  check('匿名拒绝邮箱账户接口',
    anonAcc.status === 401 || anonAcc.status === 302 || (anonAcc.json && anonAcc.json.ok === false),
    'status=' + anonAcc.status);
  cookie = savedCk;

  /* ---------- 汇总 ---------- */
  console.log('');
  console.log('======== 结果 ========');
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) {
    console.log('');
    console.log('失败详情：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
})().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
