'use strict';
/**
 * 生产环境后端契约复验（直连 https://jdy.zhengl.vip）
 * 只读；不打印任何凭据。
 */
const fs = require('fs');
const BASE = 'https://jdy.zhengl.vip';

function env() {
  const m = {};
  for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const i = l.indexOf('=');
    if (i > 0 && !l.trim().startsWith('#')) m[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  return m;
}
const E = env();
const out = [];
const ok = (n, pass, d) => { out.push({ n, pass, d }); console.log((pass ? '  PASS  ' : '  FAIL  ') + n + '  → ' + JSON.stringify(d)); };

(async () => {
  const body = new URLSearchParams({ username: E.DEFAULT_ADMIN_USER, password: E.DEFAULT_ADMIN_PASSWORD, redirect: '/' });
  const lr = await fetch(BASE + '/login', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(), redirect: 'manual',
  });
  ok('生产登录 302', lr.status === 302, lr.status);
  const cookies = (lr.headers.getSetCookie ? lr.headers.getSetCookie() : [lr.headers.get('set-cookie')])
    .filter(Boolean).map((c) => c.split(';')[0]).join('; ');

  const br = await fetch(BASE + '/api/crm/board', { headers: { Cookie: cookies } });
  const bj = await br.json();
  const B = bj.data || bj;
  ok('生产 /api/crm/board HTTP 200', br.status === 200, br.status);

  // B1
  const vs = B.row1 && B.row1.erpVersionSummary;
  ok('B1 erpVersionSummary 形状正确',
    !!vs && vs.withCoupon.total === 105 && vs.withoutCoupon.total === 8 && vs.total === 113,
    vs);
  ok('B1 105+8 === 113 === totalClients',
    !!vs && vs.withCoupon.total + vs.withoutCoupon.total === vs.total && vs.total === B.row1.totalClients,
    { sum: vs && vs.withCoupon.total + vs.withoutCoupon.total, tc: B.row1.totalClients });

  // B2
  const det = B.detail || {};
  const c0 = det.columns && det.columns[0];
  const rows = det.rows || [];
  const seqOk = rows.length > 1 && rows.every((r, i) => i === 0 || rows[i - 1].seq > r.seq);
  ok('B2 detail.columns[0].title === 流水号', !!c0 && c0.title === '流水号', c0 && c0.title);
  ok('B2 detail.rows === 113', rows.length === 113, rows.length);
  ok('B2 流水号严格降序（首/末）', seqOk, { first: rows[0] && rows[0].seq, last: rows[rows.length - 1] && rows[rows.length - 1].seq });
  ok('B2 savedColumns 默认 null 或数组',
    det.savedColumns === null || Array.isArray(det.savedColumns), det.savedColumns);

  // B3
  const r8 = B.row8 || {};
  const it0 = (r8.items || [])[0];
  const NEED16 = ['signDate', 'region', 'chainId', 'chainName', 'chainType', 'version', 'reachedPeople',
    'arrivedPeople', 'reachRate', 'gmv', 'couponIssued', 'couponUsed', 'couponRate', 'couponCost', 'channelCost', 'roi'];
  const ch0 = it0 && (it0.chains || [])[0];
  ok('B3 row8.items[0].chains 存在且 16 字段齐全',
    !!ch0 && NEED16.every((k) => k in ch0), ch0 ? Object.keys(ch0).length : null);
  ok('B3 row8.modules === 3', r8.modules === 3, r8.modules);

  // B4 公开接口
  const TOKEN = '29839de9df3deb3d1d367fdf';
  const pr = await fetch(BASE + '/api/public/board/client/12394?token=' + TOKEN);
  const pj = await pr.json().catch(() => ({}));
  const PR = pj.data || pj;
  const st = PR.runMetrics && PR.runMetrics.strategyTypes;
  ok('B4 公开客户详情 200 且 strategyTypes 有数据',
    pr.status === 200 && Array.isArray(st) && st.length > 0, { http: pr.status, n: Array.isArray(st) ? st.length : null });
  ok('B4 strategyTypes 11 字段齐全',
    Array.isArray(st) && st[0] && ['type', 'reachedPeople', 'arrivedPeople', 'reachRate', 'gmv', 'couponIssued',
      'couponUsed', 'couponRate', 'couponCost', 'channelCost', 'roi'].every((k) => k in st[0]),
    Array.isArray(st) && st[0] ? Object.keys(st[0]).length : null);

  // 生产前端资源
  const idx = await fetch(BASE + '/dashboard/board', { headers: { Cookie: cookies } });
  const html = await idx.text();
  const m = html.match(/index-[A-Za-z0-9_-]*\.js/);
  ok('生产前端已换新构建（asset hash 存在）', !!m, m && m[0]);
  if (m) {
    const as = await fetch(BASE + '/assets/' + m[0]);
    ok('生产 asset 可下载 200', as.status === 200, as.status);
  }

  const bad = out.filter((x) => !x.pass);
  console.log('');
  console.log('生产契约复验: ' + (out.length - bad.length) + '/' + out.length + ' PASS');
  if (bad.length) console.log('FAILED: ' + JSON.stringify(bad));
  fs.writeFileSync('_work/v15-prod-verify.json', JSON.stringify({ at: new Date().toISOString(), out }, null, 1));
})().catch((e) => { console.error('ERR', e.stack); process.exit(1); });
