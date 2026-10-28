/**
 * 页面健康检查：验证所有页面 HTTP 可达 + 内联脚本为合法 JS
 *
 * 背景：曾出现「项目详情页数据明细一直显示加载中」的故障，
 *       根因是 EJS 模板字面量内的正则被二次转义，生成非法 JS 导致整段脚本中止。
 *       本脚本用于回归防护 —— 任何页面出现 JS 语法错误都会立即失败。
 *
 * 用法：BASE=https://jdy.zhengl.vip node scripts/page-check.js
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8781';

let cookie = '';
function capture(r) {
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean);
  sc.forEach((c) => { if (c && c.startsWith('jdy_sid=')) cookie = c.split(';')[0]; });
}

async function get(path) {
  const r = await fetch(BASE + path, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });
  capture(r);
  return { status: r.status, text: await r.text() };
}

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass += 1; console.log('  OK   ' + msg); }
  else { fail += 1; console.log('  FAIL ' + msg); }
}

/** 校验页面内所有非空 <script> 块是否为合法 JS */
function checkScripts(html, label) {
  const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].filter((b) => b[1].trim());
  const errs = [];
  blocks.forEach((b, i) => {
    try {
      // eslint-disable-next-line no-new-func
      new Function(b[1]);
    } catch (e) {
      errs.push(`块${i + 1}: ${e.message}`);
      // 定位首个错误行
      const lines = b[1].split('\n');
      for (let j = 1; j <= lines.length; j += 1) {
        try {
          // eslint-disable-next-line no-new-func
          new Function(lines.slice(0, j).join('\n'));
        } catch (err) {
          if (!/Unexpected end of input|Unexpected token '}'|missing \) after/.test(err.message)) {
            errs.push(`  行${j}: ${lines[j - 1].trim().slice(0, 120)}`);
            break;
          }
        }
      }
    }
  });
  ok(errs.length === 0, `${label} 脚本语法（${blocks.length} 个块）${errs.length ? ' -> ' + errs.join(' | ') : ''}`);
  return blocks.length;
}

(async () => {
  console.log('======== 页面健康检查 ========');
  console.log('目标: ' + BASE + '\n');

  /* ---- 未登录页面 ---- */
  console.log('── 未登录页面 ──');
  for (const p of ['/login', '/forgot-password']) {
    const r = await get(p);
    ok(r.status === 200, `${p} HTTP ${r.status}`);
    checkScripts(r.text, p);
  }
  const r404 = await get('/nonexistent-page');
  ok(r404.status === 404 && r404.text.includes('页面不存在'), '404 错误页正常渲染');

  /* ---- 登录 ---- */
  console.log('\n── 登录 ──');
  const lg = await fetch(BASE + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=admin&password=6655&redirect=/',
    redirect: 'manual',
  });
  capture(lg);
  ok(lg.status === 302 && cookie.startsWith('jdy_sid='), 'admin/6655 登录成功');

  /* ---- 登录后页面 ---- */
  console.log('\n── 登录后页面 ──');
  const pages = ['/', '/users', '/settings', '/profile', '/help'];
  for (const p of pages) {
    const r = await get(p);
    ok(r.status === 200, `${p} HTTP ${r.status}`);
    checkScripts(r.text, p);
  }

  /* ---- 项目相关页面（需真实项目） ---- */
  console.log('\n── 项目页面 ──');
  const listRes = await fetch(BASE + '/api/projects', { headers: { Cookie: cookie } });
  const list = await listRes.json();
  const projects = (list.data || []);

  if (!projects.length) {
    console.log('  (无项目，跳过项目页面检查)');
  } else {
    for (const p of projects.slice(0, 3)) {
      const detail = await get('/projects/' + p.id);
      ok(detail.status === 200, `/projects/${p.id} HTTP ${detail.status}`);
      checkScripts(detail.text, `/projects/${p.id}`);

      // 关键：详情页必须包含数据明细表格容器
      ok(detail.text.includes('recordBody'), `/projects/${p.id} 含数据明细容器`);
      ok(detail.text.includes('table-fixed'), `/projects/${p.id} 明细表使用固定行高样式`);

      const fields = await get('/projects/' + p.id + '/fields');
      ok(fields.status === 200, `/projects/${p.id}/fields HTTP ${fields.status}`);
      checkScripts(fields.text, `/projects/${p.id}/fields`);
    }
  }

  /* ---- 接口冒烟 ---- */
  console.log('\n── 接口冒烟 ──');
  if (projects.length) {
    const pid = projects[0].id;
    const rec = await fetch(`${BASE}/api/projects/${pid}/records?page=1&pageSize=5`, { headers: { Cookie: cookie } });
    const recJson = await rec.json();
    ok(rec.status === 200 && recJson.ok, `数据明细接口返回正常（共 ${recJson.data ? recJson.data.total : '?'} 条）`);

    const logs = await fetch(`${BASE}/api/projects/${pid}/logs?page=1&pageSize=5`, { headers: { Cookie: cookie } });
    const logJson = await logs.json();
    ok(logs.status === 200 && logJson.ok, `接收日志接口返回正常（共 ${logJson.data ? logJson.data.total : '?'} 条）`);

    const det = await fetch(`${BASE}/api/projects/${pid}`, { headers: { Cookie: cookie } });
    const detJson = await det.json();
    ok(det.status === 200 && detJson.ok, `项目详情接口返回正常（${detJson.data ? detJson.data.columns.length : '?'} 列）`);
  }

  console.log('\n======== 结果 ========');
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('检查异常:', e);
  process.exit(1);
});
