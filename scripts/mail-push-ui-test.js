/**
 * 邮箱推送板块改造 —— UI / API 自动化测试
 *
 * 覆盖范围（按 _work/API-CONTRACT.md 逐项断言）：
 *   1. 页面可达性：/mail-push（5 标签）、账户新增/编辑页、项目详情页（4 标签）
 *      以及对每个页面内联 <script> 做 new Function() 语法校验
 *      —— 这是关键回归防护：历史上曾因 EJS 模板转义导致整页 JS 中断
 *   2. 新增 API：overview / settings / columns / rows（搜索排序）/ export / logs 筛选 /
 *      PUT 项目改名 / 非法参数容错
 *   3. 安全与权限：匿名拒绝、账户不泄露密码、CSV 公式注入防护
 *   4. 数据一致性：overview 与 accounts/projects/rows 的数量对账
 *
 * 用法：
 *   BASE=http://127.0.0.1:8781 node scripts/mail-push-ui-test.js
 *
 * 设计原则：
 *   - 幂等：可重复运行；会改数据的用例（settings、项目改名）在 finally 中恢复原值
 *   - 只读生产数据：绝不删除现有项目（项目 1 / 19 等），也不清空其数据
 *   - 汇总输出「通过 N 项，失败 M 项」，失败时打印详情并 exit 1
 */
'use strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8781';
const USERNAME = process.env.MP_USER || 'admin';
const PASSWORD = process.env.MP_PASS || '6655';

/* ---------------- 断言辅助（沿用 mail-push-test.js / regression-test.js 风格） ---------------- */

let cookie = '';
let pass = 0;
let fail = 0;
const failures = [];

function ok(name, extra) {
  pass += 1;
  console.log(`  OK   ${name}${extra ? '  ' + extra : ''}`);
}
function bad(name, msg) {
  fail += 1;
  failures.push(`${name}: ${msg}`);
  console.log(`  FAIL ${name}  ${msg}`);
}
function check(name, cond, extra) {
  if (cond) ok(name, extra); else bad(name, extra || '断言失败');
}
/** 记录但不判定（用于「仅记录不强制」的观察项） */
function note(name, extra) {
  console.log(`  NOTE ${name}${extra ? '  ' + extra : ''}`);
}

function capture(r) {
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean);
  sc.forEach((c) => { if (c && c.startsWith('jdy_sid=')) cookie = c.split(';')[0]; });
}

/** 统一请求：自动带 Cookie，默认不自动跟随重定向（便于断言 302） */
async function req(path, opts) {
  const o = Object.assign({}, opts || {});
  o.headers = Object.assign({}, o.headers || {}, cookie ? { Cookie: cookie } : {});
  o.redirect = o.redirect || 'manual';
  const r = await fetch(BASE + path, o);
  capture(r);
  return r;
}

/** 取 JSON：返回 {status, json, text}，解析失败时 json=null */
async function getJson(path, opts) {
  const r = await req(path, opts);
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t), text: t }; }
  catch (_) { return { status: r.status, json: null, text: t }; }
}

/** JSON 请求（PUT/POST 用） */
async function sendJson(method, path, body) {
  return getJson(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}

/**
 * 校验 HTML 里所有内联 <script> 的语法合法性。
 * 用 new Function() 解析（不执行），能捕获模板转义导致的语法错误。
 * 排除 layout 注入的 window.__USER__ / window.__THEME__ 数据块（含服务端序列化内容，非业务脚本）。
 * @returns {{total:number, ok:number, errors:string[]}}
 */
function checkInlineScripts(html) {
  const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .filter((b) => b[1].trim())
    .filter((b) => !b[1].includes('window.__USER__') && !b[1].includes('window.__THEME__'));
  const errors = [];
  let good = 0;
  blocks.forEach((b, i) => {
    try { new Function(b[1]); good += 1; }
    catch (e) { errors.push(`块${i + 1}: ${e.message}`); }
  });
  return { total: blocks.length, ok: good, errors };
}

/** 提取页面文本（用于判断标签标识是否存在） */
function hasAny(html, needles) {
  return needles.some((n) => html.includes(n));
}

/* ---------------- 主流程 ---------------- */

(async () => {
  console.log('======== 邮箱推送改造 UI/API 测试 ========');
  console.log('目标: ' + BASE);
  console.log('');

  /* ============ 0. 登录 ============ */
  console.log('── 0. 登录 ──');
  const loginBody = new URLSearchParams({ username: USERNAME, password: PASSWORD }).toString();
  const lr = await req('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: loginBody,
  });
  check('管理员登录', lr.status === 302 || lr.status === 200, 'status=' + lr.status);
  check('取得会话 Cookie', !!cookie, cookie ? 'ok' : '无 cookie');
  if (!cookie) {
    console.log('');
    console.log('登录失败，后续用例无法执行。');
    console.log(`通过 ${pass} 项，失败 ${fail} 项`);
    process.exit(1);
  }

  /* ============ 1. 页面可达性 + 内联脚本语法 ============ */
  console.log('');
  console.log('── 1. 页面可达性 ──');

  // 1.1 主页面：5 个标签
  const mainPage = await req('/mail-push');
  const mainHtml = await mainPage.text();
  check('GET /mail-push 200', mainPage.status === 200, 'status=' + mainPage.status);
  const mainTabs = ['overview', 'projects', 'logs', 'accounts', 'settings'];
  const missingMainTabs = mainTabs.filter((k) => !mainHtml.includes(k));
  check('主页面含 5 个标签标识', missingMainTabs.length === 0,
    missingMainTabs.length ? '缺失=' + missingMainTabs.join(',') : mainTabs.join('/'));
  check('主页面使用 .tabs 容器', mainHtml.includes('class="tabs"'));
  check('主页面含标签面板', mainHtml.includes('tab-panel'));
  check('主页面 hash 保持逻辑', mainHtml.includes('location.hash') || mainHtml.includes('hashchange'));

  // 1.2 账户新增页：表单字段
  const newAcct = await req('/mail-push/accounts/new');
  const newAcctHtml = await newAcct.text();
  check('GET /mail-push/accounts/new 200', newAcct.status === 200, 'status=' + newAcct.status);
  // 表单控件在本项目中用 id="acct-*"，同时兼容契约里的 name 形式
  const fieldGroups = [
    { label: 'email', need: ['acct-email', 'name="email"'] },
    { label: 'imap_host', need: ['acct-host', 'name="imap_host"'] },
    { label: 'imap_port', need: ['acct-port', 'name="imap_port"'] },
    { label: 'password', need: ['acct-password', 'name="password"'] },
  ];
  for (const f of fieldGroups) {
    check(`新增页含 ${f.label} 字段`, hasAny(newAcctHtml, f.need), f.need[0]);
  }
  check('新增页为独立页面（非弹窗）', newAcctHtml.includes('/mail-push#accounts'));

  // 1.3 账户编辑页
  const editAcct = await req('/mail-push/accounts/1/edit');
  const editAcctHtml = await editAcct.text();
  check('GET /mail-push/accounts/1/edit 200', editAcct.status === 200, 'status=' + editAcct.status);
  const missingEditFields = fieldGroups
    .filter((f) => !hasAny(editAcctHtml, f.need))
    .map((f) => f.label);
  check('编辑页含完整表单字段', missingEditFields.length === 0,
    missingEditFields.length ? '缺失=' + missingEditFields.join(',') : '4 个字段齐备');

  // 1.4 项目详情页：4 个标签
  const projPage = await req('/mail-push/projects/1');
  const projHtml = await projPage.text();
  check('GET /mail-push/projects/1 200', projPage.status === 200, 'status=' + projPage.status);
  const projTabs = ['home', 'records', 'fields', 'logs'];
  const missingProjTabs = projTabs.filter((k) => !projHtml.includes(k));
  check('项目页含 4 个标签标识', missingProjTabs.length === 0,
    missingProjTabs.length ? '缺失=' + missingProjTabs.join(',') : projTabs.join('/'));
  check('项目页含操作按钮', projHtml.includes('export') || projHtml.includes('导出'),
    '导出');
  check('项目页含数据表格容器', projHtml.includes('table') || projHtml.includes('rows'));

  // 1.5 不存在的项目页面应优雅处理
  const nfProjPage = await req('/mail-push/projects/999999');
  check('不存在项目页面不 500', nfProjPage.status !== 500, 'status=' + nfProjPage.status);

  /* ---- 内联脚本语法校验（关键回归防护） ---- */
  console.log('');
  console.log('── 1b. 内联脚本语法（new Function 校验）──');
  const scriptTargets = [
    { name: '/mail-push', html: mainHtml },
    { name: '/mail-push/accounts/new', html: newAcctHtml },
    { name: '/mail-push/accounts/1/edit', html: editAcctHtml },
    { name: '/mail-push/projects/1', html: projHtml },
  ];
  for (const t of scriptTargets) {
    const r = checkInlineScripts(t.html);
    check(`${t.name} 内联脚本语法（${r.ok}/${r.total}）`,
      r.errors.length === 0 && r.total > 0,
      r.errors.length ? r.errors.join('; ') : (r.total ? '' : '未找到内联脚本'));
  }

  /* ============ 2. 新增 API ============ */
  console.log('');
  console.log('── 2. 新增 API ──');

  // 2.1 统计概览
  const ovRes = await getJson('/api/mail-push/overview');
  const ov = ovRes.json && ovRes.json.data;
  check('GET /overview ok=true', !!(ovRes.json && ovRes.json.ok), 'status=' + ovRes.status);
  check('overview 含 accounts/projects/logs',
    !!(ov && ov.accounts && ov.projects && ov.logs),
    'keys=' + Object.keys(ov || {}).join(','));
  check('overview 含 recentImports 数组', Array.isArray(ov && ov.recentImports),
    'len=' + ((ov && ov.recentImports && ov.recentImports.length) || 0));
  check('overview 含 trend 数组', Array.isArray(ov && ov.trend),
    'len=' + ((ov && ov.trend && ov.trend.length) || 0));
  check('overview.accounts 含 total/enabled',
    !!(ov && ov.accounts && typeof ov.accounts.total === 'number'
      && typeof ov.accounts.enabled === 'number'));
  check('overview.projects 含 total/rows',
    !!(ov && ov.projects && typeof ov.projects.total === 'number'
      && typeof ov.projects.rows === 'number'));
  check('overview.logs 含 total/success/skipped/failed/today',
    !!(ov && ov.logs && ['total', 'success', 'skipped', 'failed', 'today']
      .every((k) => typeof ov.logs[k] === 'number')),
    ov && ov.logs ? JSON.stringify(ov.logs) : '');

  // 2.2 设置读取
  const setRes = await getJson('/api/mail-push/settings');
  const set0 = setRes.json && setRes.json.data;
  check('GET /settings ok=true', !!(setRes.json && setRes.json.ok), 'status=' + setRes.status);
  check('settings 含 enabled/interval',
    !!(set0 && 'enabled' in set0 && 'interval' in set0),
    set0 ? JSON.stringify(set0) : '');
  check('settings.enabled 为布尔', typeof (set0 && set0.enabled) === 'boolean',
    '实际=' + typeof (set0 && set0.enabled));
  check('settings.interval 为数字', typeof (set0 && set0.interval) === 'number',
    '实际=' + (set0 && set0.interval));

  // 2.3 设置保存 → 回读一致 → 恢复原值
  console.log('');
  console.log('── 2b. 设置保存与恢复（幂等）──');
  if (set0) {
    const original = {
      enabled: !!set0.enabled,
      interval: set0.interval,
      initial_days: set0.initial_days,
      max_per_run: set0.max_per_run,
    };
    // 选一个与原值不同的合法值，确保「保存确实生效」
    const newInterval = original.interval === 9 ? 11 : 9;
    let restored = false;
    try {
      const putRes = await sendJson('PUT', '/api/mail-push/settings', { interval: newInterval });
      check('PUT /settings ok=true', !!(putRes.json && putRes.json.ok),
        'status=' + putRes.status + ' ' + ((putRes.json && putRes.json.message) || ''));

      const afterRes = await getJson('/api/mail-push/settings');
      const after = afterRes.json && afterRes.json.data;
      check('PUT 后 interval 回读一致', !!(after && Number(after.interval) === newInterval),
        `期望=${newInterval} 实际=${after && after.interval}`);
      check('PUT 后其他字段未被误改',
        !!(after && !!after.enabled === original.enabled
          && Number(after.initial_days) === Number(original.initial_days)
          && Number(after.max_per_run) === Number(original.max_per_run)),
        after ? JSON.stringify(after) : '');

      // 非法值应被拒绝（400），且不写入
      const badSet = await sendJson('PUT', '/api/mail-push/settings', { interval: 0 });
      check('PUT /settings 非法 interval 被拒绝',
        badSet.status === 400 || (badSet.json && badSet.json.ok === false),
        'status=' + badSet.status);
    } finally {
      // 无论断言是否失败，都必须恢复原值
      const rb = await sendJson('PUT', '/api/mail-push/settings', original);
      restored = !!(rb.json && rb.json.ok);
      const finalRes = await getJson('/api/mail-push/settings');
      const fin = finalRes.json && finalRes.json.data;
      check('设置已恢复原值（幂等）',
        restored && !!fin
          && !!fin.enabled === original.enabled
          && Number(fin.interval) === Number(original.interval)
          && Number(fin.initial_days) === Number(original.initial_days)
          && Number(fin.max_per_run) === Number(original.max_per_run),
        fin ? JSON.stringify(fin) : '');
    }
  } else {
    bad('设置保存与恢复', '未取得原始设置，跳过');
  }

  // 2.4 列结构
  console.log('');
  console.log('── 2c. 项目列结构与行数据 ──');
  const colRes = await getJson('/api/mail-push/projects/1/columns');
  const cols = (colRes.json && colRes.json.data && colRes.json.data.columns) || null;
  check('GET /projects/1/columns ok=true', !!(colRes.json && colRes.json.ok), 'status=' + colRes.status);
  check('columns 为数组', Array.isArray(cols), 'len=' + (Array.isArray(cols) ? cols.length : 'N/A'));
  check('列项含 name/comment/type',
    Array.isArray(cols) && cols.length > 0
      && cols.every((c) => 'name' in c && 'comment' in c && 'type' in c),
    Array.isArray(cols) && cols[0] ? JSON.stringify(cols[0]) : '');

  // 2.5 行数据分页
  const rowsRes = await getJson('/api/mail-push/projects/1/rows?page=1&size=5&keyword=');
  const rowsData = rowsRes.json && rowsRes.json.data;
  check('GET /rows ok=true', !!(rowsRes.json && rowsRes.json.ok), 'status=' + rowsRes.status);
  check('rows 返回含 rows/total',
    !!(rowsData && Array.isArray(rowsData.rows) && typeof rowsData.total === 'number'),
    rowsData ? `total=${rowsData.total} 行数=${rowsData.rows && rowsData.rows.length}` : '');
  check('rows 返回含 columns', Array.isArray(rowsData && rowsData.columns),
    'len=' + ((rowsData && rowsData.columns && rowsData.columns.length) || 0));
  check('rows 分页 size 生效', !!(rowsData && rowsData.rows && rowsData.rows.length <= 5),
    'size=' + (rowsData && rowsData.size));

  // 2.6 排序（不报错且顺序符合预期）
  const sortCol = Array.isArray(cols) && cols.length ? cols.find((c) => c.name === 'id') || cols[0] : null;
  if (sortCol) {
    const ascRes = await getJson(
      `/api/mail-push/projects/1/rows?page=1&size=5&sort=${encodeURIComponent(sortCol.name)}&order=asc`
    );
    const ascData = ascRes.json && ascRes.json.data;
    check('GET /rows 排序（asc）不报错', !!(ascRes.json && ascRes.json.ok), 'status=' + ascRes.status);
    const ascRows = (ascData && ascData.rows) || [];
    check('排序 asc 首行 ≤ 末行',
      ascRows.length < 2 || String(ascRows[0][sortCol.name]) <= String(ascRows[ascRows.length - 1][sortCol.name]),
      `col=${sortCol.name} first=${ascRows[0] && ascRows[0][sortCol.name]} last=${ascRows[ascRows.length - 1] && ascRows[ascRows.length - 1][sortCol.name]}`);

    const descRes = await getJson(
      `/api/mail-push/projects/1/rows?page=1&size=5&sort=${encodeURIComponent(sortCol.name)}&order=desc`
    );
    check('GET /rows 排序（desc）不报错', !!(descRes.json && descRes.json.ok), 'status=' + descRes.status);
  } else {
    bad('排序测试', '无可用列');
  }

  // 2.7 关键词搜索生效
  // 取第一行第一个文本列的值做搜索词，验证「搜到的结果确实包含该词」
  const firstRow = (rowsData && rowsData.rows && rowsData.rows[0]) || null;
  let kw = '';
  if (firstRow && Array.isArray(cols)) {
    for (const c of cols) {
      if (/char|text/i.test(String(c.type || ''))) {
        const v = firstRow[c.name];
        if (v && String(v).trim().length >= 2 && String(v).length < 40) { kw = String(v).trim(); break; }
      }
    }
  }
  if (kw) {
    const kwRes = await getJson('/api/mail-push/projects/1/rows?page=1&size=5&keyword=' + encodeURIComponent(kw));
    const kwData = kwRes.json && kwRes.json.data;
    check('GET /rows 关键词搜索不报错', !!(kwRes.json && kwRes.json.ok), 'status=' + kwRes.status);
    check('关键词搜索结果总数 ≤ 全量', !!(kwData && typeof kwData.total === 'number'
      && kwData.total <= Number(rowsData.total)),
      `keyword=${kw} total=${kwData && kwData.total} 全量=${rowsData.total}`);
    const allHit = ((kwData && kwData.rows) || []).every((r) =>
      Object.values(r).some((v) => v != null && String(v).includes(kw)));
    check('关键词命中行确实包含该词', allHit, 'keyword=' + kw);

    // 无匹配关键词应返回 0 条而非报错
    const noneRes = await getJson('/api/mail-push/projects/1/rows?page=1&size=5&keyword=__no_such_keyword_zzz__');
    check('无匹配关键词返回空集', !!(noneRes.json && noneRes.json.ok
      && noneRes.json.data && noneRes.json.data.total === 0),
      'total=' + (noneRes.json && noneRes.json.data && noneRes.json.data.total));
  } else {
    note('关键词搜索', '未找到合适文本值，跳过');
  }

  // 2.8 非法参数容错
  console.log('');
  console.log('── 2d. 非法参数容错 ──');
  const badPageRes = await getJson('/api/mail-push/projects/1/rows?page=abc&size=-1');
  check('rows?page=abc&size=-1 不 500', badPageRes.status !== 500, 'status=' + badPageRes.status);
  check('rows 非法分页返回合法结构',
    !!(badPageRes.json && badPageRes.json.ok && badPageRes.json.data
      && badPageRes.json.data.page >= 1 && badPageRes.json.data.size >= 1),
    badPageRes.json && badPageRes.json.data
      ? `page=${badPageRes.json.data.page} size=${badPageRes.json.data.size}` : '');

  const evilSort = 'id;DROP TABLE x--';
  const evilRes = await getJson('/api/mail-push/projects/1/rows?page=1&size=3&sort=' + encodeURIComponent(evilSort));
  check('rows?sort=恶意字段 不 500', evilRes.status !== 500, 'status=' + evilRes.status);
  check('恶意 sort 被白名单拒绝或忽略',
    !!(evilRes.json && evilRes.json.ok) || evilRes.status === 400,
    'status=' + evilRes.status + ' ok=' + (evilRes.json && evilRes.json.ok));
  // 恶意 sort 之后表必须仍可读（证明未被注入破坏）
  const afterEvil = await getJson('/api/mail-push/projects/1/rows?page=1&size=1');
  check('恶意 sort 后数据表仍可读', !!(afterEvil.json && afterEvil.json.ok));

  const badOrderRes = await getJson('/api/mail-push/projects/1/rows?page=1&size=3&order=xxx');
  check('rows?order=非法值 不 500', badOrderRes.status !== 500, 'status=' + badOrderRes.status);

  // 2.9 CSV 导出
  console.log('');
  console.log('── 2e. CSV 导出 ──');
  const expRes = await req('/api/mail-push/projects/1/export');
  const expCt = expRes.headers.get('content-type') || '';
  const expBuf = Buffer.from(await expRes.arrayBuffer());
  check('GET /projects/1/export 200', expRes.status === 200, 'status=' + expRes.status);
  check('export Content-Type 含 csv', expCt.toLowerCase().includes('csv'), 'ct=' + expCt);
  const hasBom = expBuf.length >= 3 && expBuf[0] === 0xEF && expBuf[1] === 0xBB && expBuf[2] === 0xBF;
  const expText = expBuf.toString('utf8');
  check('export 以 UTF-8 BOM 开头', hasBom, hasBom ? 'EF BB BF' : '首字节=' + expBuf.subarray(0, 3).toString('hex'));
  // 表头应为中文列注释
  const headerLine = expText.replace(/^\uFEFF/, '').split(/\r?\n/)[0] || '';
  check('export 含表头行', headerLine.trim().length > 0, '表头=' + headerLine.slice(0, 60));
  check('export 表头使用中文列注释', /[\u4e00-\u9fa5]/.test(headerLine), '表头=' + headerLine.slice(0, 60));
  check('export 含数据行', expText.split(/\r?\n/).filter((l) => l.trim()).length > 1,
    '行数=' + expText.split(/\r?\n/).filter((l) => l.trim()).length);
  check('export 有下载文件名头',
    !!expRes.headers.get('content-disposition'), expRes.headers.get('content-disposition') || '');
  // 不存在的项目导出应 404 而非 500
  const expNf = await req('/api/mail-push/projects/999999/export');
  check('export 不存在项目不 500', expNf.status !== 500, 'status=' + expNf.status);

  // 2.10 日志筛选
  console.log('');
  console.log('── 2f. 日志筛选 ──');
  const logAll = await getJson('/api/mail-push/logs?limit=50');
  const logAllList = (logAll.json && logAll.json.data) || [];
  check('GET /logs ok=true', !!(logAll.json && logAll.json.ok), 'status=' + logAll.status);
  check('日志为数组', Array.isArray(logAllList), 'len=' + logAllList.length);

  const logSuccess = await getJson('/api/mail-push/logs?result=success&limit=10');
  const logSuccessList = (logSuccess.json && logSuccess.json.data) || [];
  check('GET /logs?result=success ok=true', !!(logSuccess.json && logSuccess.json.ok));
  check('result=success 筛选生效',
    logSuccessList.every((l) => l.result === 'success'),
    '条数=' + logSuccessList.length);

  const logFailed = await getJson('/api/mail-push/logs?result=failed&limit=10');
  const logFailedList = (logFailed.json && logFailed.json.data) || [];
  check('GET /logs?result=failed ok=true', !!(logFailed.json && logFailed.json.ok));
  check('result=failed 筛选生效',
    logFailedList.every((l) => l.result === 'failed'),
    '条数=' + logFailedList.length);
  check('success + failed 条数不超过总数',
    logSuccessList.length + logFailedList.length <= logAllList.length,
    `${logSuccessList.length}+${logFailedList.length} <= ${logAllList.length}`);

  const logKw = await getJson('/api/mail-push/logs?keyword=__no_such_zzz__&limit=10');
  check('GET /logs?keyword=xxx 不报错', !!(logKw.json && logKw.json.ok), 'status=' + logKw.status);
  check('无匹配关键词返回空数组',
    Array.isArray(logKw.json && logKw.json.data) && logKw.json.data.length === 0,
    'len=' + ((logKw.json && logKw.json.data && logKw.json.data.length) || 0));

  if (logAllList.length) {
    const kwReal = String(logAllList[0].filename || '').slice(0, 4);
    if (kwReal) {
      const logKw2 = await getJson('/api/mail-push/logs?keyword=' + encodeURIComponent(kwReal) + '&limit=10');
      const list2 = (logKw2.json && logKw2.json.data) || [];
      check('keyword 真实词可命中', !!(logKw2.json && logKw2.json.ok) && list2.length >= 1,
        `keyword=${kwReal} 命中=${list2.length}`);
    }
    // 项目筛选
    const pidFilter = logAllList[0].project_id;
    if (pidFilter != null) {
      const logPid = await getJson('/api/mail-push/logs?projectId=' + pidFilter + '&limit=20');
      const list3 = (logPid.json && logPid.json.data) || [];
      check('projectId 筛选生效',
        !!(logPid.json && logPid.json.ok) && list3.every((l) => Number(l.project_id) === Number(pidFilter)),
        `projectId=${pidFilter} 条数=${list3.length}`);
    }
    // 单条日志详情
    const oneLog = await getJson('/api/mail-push/logs/' + logAllList[0].id);
    check('GET /logs/:id ok=true', !!(oneLog.json && oneLog.json.ok),
      'status=' + oneLog.status);
    check('日志详情 id 一致',
      !!(oneLog.json && oneLog.json.data && Number(oneLog.json.data.id) === Number(logAllList[0].id)));
    check('日志详情含完整 message 字段',
      !!(oneLog.json && oneLog.json.data && 'message' in oneLog.json.data));
    const nfLog = await getJson('/api/mail-push/logs/999999');
    check('不存在日志不 500', nfLog.status !== 500, 'status=' + nfLog.status);
  }

  // 2.11 项目改名（改回原名，幂等）
  console.log('');
  console.log('── 2g. 项目改名（测完改回）──');
  const projListRes = await getJson('/api/mail-push/projects');
  const projList = (projListRes.json && projListRes.json.data) || [];
  const target = projList.find((p) => Number(p.id) === 1);
  if (target) {
    const originalName = target.name;
    const tempName = '临时改名测试';
    let renamed = false;
    try {
      const putProj = await sendJson('PUT', '/api/mail-push/projects/1', { name: tempName });
      check('PUT /projects/1 改名 ok=true', !!(putProj.json && putProj.json.ok),
        'status=' + putProj.status + ' ' + ((putProj.json && putProj.json.message) || ''));
      renamed = !!(putProj.json && putProj.json.ok);

      const afterPut = await getJson('/api/mail-push/projects');
      const nowName = ((afterPut.json && afterPut.json.data) || []).find((p) => Number(p.id) === 1);
      check('改名后列表名称已更新',
        !!(nowName && nowName.name === tempName),
        `期望=${tempName} 实际=${nowName && nowName.name}`);

      // 重名应被拒绝
      const other = projList.find((p) => Number(p.id) !== 1);
      if (other) {
        const dupRes = await sendJson('PUT', '/api/mail-push/projects/1', { name: other.name });
        check('改成已存在的项目名被拒绝',
          dupRes.status === 400 || (dupRes.json && dupRes.json.ok === false),
          'status=' + dupRes.status);
      }
    } finally {
      // 必须改回原名
      if (renamed) {
        const back = await sendJson('PUT', '/api/mail-push/projects/1', { name: originalName });
        const afterBack = await getJson('/api/mail-push/projects');
        const backName = ((afterBack.json && afterBack.json.data) || []).find((p) => Number(p.id) === 1);
        check('项目名已改回原值（幂等）',
          !!(back.json && back.json.ok) && !!backName && backName.name === originalName,
          `期望=${originalName} 实际=${backName && backName.name}`);
      }
    }
  } else {
    bad('项目改名测试', '未找到项目 1');
  }

  /* ============ 3. 安全与权限 ============ */
  console.log('');
  console.log('── 3. 安全与权限 ──');
  const savedCookie = cookie;
  cookie = '';

  // 3.1 匿名访问 API 应被拒绝
  for (const p of ['/api/mail-push/overview', '/api/mail-push/settings', '/api/mail-push/projects/1/columns',
    '/api/mail-push/projects/1/export', '/api/mail-push/logs']) {
    const r = await getJson(p);
    check('匿名拒绝 ' + p,
      r.status === 401 || r.status === 302 || (r.json && r.json.ok === false),
      'status=' + r.status);
  }
  // 3.2 匿名访问页面应重定向
  for (const p of ['/mail-push', '/mail-push/accounts/new', '/mail-push/projects/1']) {
    const r = await req(p);
    check('匿名重定向 ' + p, r.status === 302 || r.status === 401, 'status=' + r.status);
  }
  // 3.3 匿名不能改设置
  const anonPut = await sendJson('PUT', '/api/mail-push/settings', { interval: 99 });
  check('匿名不能保存设置',
    anonPut.status === 401 || anonPut.status === 302 || (anonPut.json && anonPut.json.ok === false),
    'status=' + anonPut.status);

  cookie = savedCookie;

  // 3.4 账户接口不泄露密码
  console.log('');
  console.log('── 3b. 敏感信息保护 ──');
  const accRes = await getJson('/api/mail-push/accounts');
  const accList = (accRes.json && accRes.json.data) || [];
  const accText = accRes.text || '';
  check('账户列表不含 password 字段',
    Array.isArray(accList) && accList.every((a) => a.password === undefined),
    'len=' + accList.length);
  check('账户列表不含 password 键名', !/"password"\s*:/.test(accText));
  check('账户含 hasPassword 标记',
    accList.length === 0 || accList.every((a) => typeof a.hasPassword === 'boolean'));
  // 已知真实密码样本不得出现：从环境变量读取，未配置则跳过该项（避免把明文写进仓库）
  const knownSecrets = [process.env.MAIL_IMAP_PASS, process.env.DB_PASSWORD].filter(Boolean);
  if (knownSecrets.length) {
    check('账户接口不含已知密码明文',
      knownSecrets.every((s) => !accText.includes(s)),
      '已检查 ' + knownSecrets.length + ' 个样本');
  } else {
    console.log('  SKIP 账户接口不含已知密码明文（未设置 MAIL_IMAP_PASS / DB_PASSWORD 环境变量）');
  }

  if (accList.length) {
    const oneAcc = await getJson('/api/mail-push/accounts/' + accList[0].id);
    const oneText = oneAcc.text || '';
    check('账户详情不含 password 字段',
      !!(oneAcc.json && oneAcc.json.data && oneAcc.json.data.password === undefined));
    check('账户详情不含密码明文',
      knownSecrets.every((s) => !oneText.includes(s)));
  }

  // 3.5 CSV 公式注入防护（记录型检查）
  const injectionCells = expText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .flatMap((l) => l.split(','))
    .filter((cell) => /^"?[=+\-@]/.test(cell.trim()));
  // 若数据本身以 = 开头，正确实现会在前面加单引号（变成 "'=..."），因此这里统计「未处理」的裸公式
  const rawFormula = injectionCells.filter((c) => !/^"'/.test(c.trim()));
  if (rawFormula.length === 0) {
    ok('CSV 无可疑公式注入单元格', '检查了全部导出单元格');
  } else {
    note('CSV 公式注入观察', `发现 ${rawFormula.length} 个以 = + - @ 开头的单元格，样本=` +
      rawFormula.slice(0, 3).join(' | '));
  }

  /* ============ 4. 数据一致性 ============ */
  console.log('');
  console.log('── 4. 数据一致性 ──');
  const ov2Res = await getJson('/api/mail-push/overview');
  const ov2 = ov2Res.json && ov2Res.json.data;
  const pjListRes = await getJson('/api/mail-push/projects');
  const pjList = (pjListRes.json && pjListRes.json.data) || [];
  const acListRes = await getJson('/api/mail-push/accounts');
  const acList = (acListRes.json && acListRes.json.data) || [];

  check('overview.projects.total == projects 列表长度',
    !!(ov2 && ov2.projects && ov2.projects.total === pjList.length),
    `overview=${ov2 && ov2.projects && ov2.projects.total} 列表=${pjList.length}`);
  check('overview.accounts.total == accounts 列表长度',
    !!(ov2 && ov2.accounts && ov2.accounts.total === acList.length),
    `overview=${ov2 && ov2.accounts && ov2.accounts.total} 列表=${acList.length}`);
  check('overview.accounts.enabled == 启用账户数',
    !!(ov2 && ov2.accounts
      && ov2.accounts.enabled === acList.filter((a) => Number(a.enabled) === 1).length),
    `overview=${ov2 && ov2.accounts && ov2.accounts.enabled} 实际=` +
    acList.filter((a) => Number(a.enabled) === 1).length);

  // 每个项目的 row_count 与 rows 接口 total 对账（只读，不修改任何数据）
  console.log('');
  console.log('── 4b. row_count 与 rows.total 对账 ──');
  for (const p of pjList) {
    const r = await getJson(`/api/mail-push/projects/${p.id}/rows?page=1&size=1`);
    const total = r.json && r.json.data && r.json.data.total;
    check(`项目 ${p.id} row_count(${p.row_count}) == rows.total(${total})`,
      typeof total === 'number' && Number(p.row_count) === Number(total),
      `row_count=${p.row_count} total=${total}`);
  }
  // overview.projects.rows 应等于各项目 row_count 之和
  const sumRows = pjList.reduce((s, p) => s + Number(p.row_count || 0), 0);
  check('overview.projects.rows == 各项目 row_count 之和',
    !!(ov2 && ov2.projects && Number(ov2.projects.rows) === sumRows),
    `overview=${ov2 && ov2.projects && ov2.projects.rows} 求和=${sumRows}`);

  // 4c. 确认生产项目仍在（严禁被删除）
  check('生产项目 1 仍存在', pjList.some((p) => Number(p.id) === 1));
  check('生产项目 19 仍存在', pjList.some((p) => Number(p.id) === 19));

  /* ============ 汇总 ============ */
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
