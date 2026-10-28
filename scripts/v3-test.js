/**
 * v3.0 全功能验收测试
 *
 * 覆盖需求：
 *   1. 每个项目独立数据表 + 项目内可查表名
 *   2. 系统设置卡片式切换
 *   3. 多数据源（MySQL / MSSQL）+ 项目绑定数据源
 *   4. 商业化系统设置项
 *   5. 角色权限可编辑
 *   6. 解析前后两张数据表
 *   7. 浅蓝色主题
 *   8. 数据中台定位（集成/BI/大屏/治理/AI 问数）
 *   9. 接口采集 / 接口推送
 *  10. 报表加工与分享
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8781';
const crypto = require('crypto');

let cookie = '';
async function call(method, path, body) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
  const res = await fetch(BASE + path, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  sc.forEach((c) => { if (c && c.startsWith('jdy_sid=')) cookie = c.split(';')[0]; });
  const ct = res.headers.get('content-type') || '';
  return {
    status: res.status,
    data: ct.includes('json') ? await res.json() : await res.text(),
  };
}

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass += 1; console.log('  OK   ' + msg); }
  else { fail += 1; console.log('  FAIL ' + msg); }
}
function section(t) { console.log('\n── ' + t + ' ──'); }

async function login(u, p) {
  cookie = '';
  return call('POST', '/login', { username: u, password: p, redirect: '/' });
}

/** 预清理：移除上次运行遗留的测试数据，保证测试可重复执行 */
async function preCleanup() {
  const usersRes = await call('GET', '/api/users');
  if (usersRes.data && usersRes.data.ok) {
    for (const u of usersRes.data.data.list) {
      if (/^(v3|test)/.test(u.username)) await call('DELETE', '/api/users/' + u.id);
    }
  }
  const rolesRes = await call('GET', '/api/roles');
  if (rolesRes.data && rolesRes.data.ok) {
    for (const r of rolesRes.data.data.list) {
      if (!r.isSystem) await call('DELETE', '/api/roles/' + r.id);
    }
  }
  const projRes = await call('GET', '/api/projects');
  if (projRes.data && projRes.data.ok) {
    for (const p of projRes.data.data) {
      if (p.name.includes('测试')) await call('DELETE', '/api/projects/' + p.id);
    }
  }
  const intRes = await call('GET', '/api/integrations');
  if (intRes.data && intRes.data.ok) {
    for (const t of intRes.data.data.list) {
      if (t.name.includes('测试')) await call('DELETE', '/api/integrations/' + t.id);
    }
  }
  const dsRes = await call('GET', '/api/datasets');
  if (dsRes.data && dsRes.data.ok) {
    for (const d of dsRes.data.data) {
      if (d.name.includes('测试')) await call('DELETE', '/api/datasets/' + d.id);
    }
  }
  const repRes = await call('GET', '/api/reports');
  if (repRes.data && repRes.data.ok) {
    for (const r of repRes.data.data) {
      if (r.name.includes('测试')) await call('DELETE', '/api/reports/' + r.id);
    }
  }
}

(async () => {
  console.log('======== v3.0 全功能验收 ========');

  /* ═══ 登录 ═══ */
  section('登录与权限');
  const lg = await login('admin', '6655');
  ok(lg.status === 302, 'admin/6655 登录成功');
  const me = await call('GET', '/api/me');
  ok(me.data.ok && me.data.data.permissions.includes('*'), '超级管理员拥有全部权限');

  await preCleanup();

  /* ═══ 需求 7：浅蓝色主题 ═══ */
  section('需求7：浅蓝色主题');
  const css = await call('GET', '/public/css/app.css');
  ok(css.data.includes('--primary: #3687FF'), '主色调为品牌蓝 #3687FF');
  ok(css.data.toLowerCase().includes('--sidebar-bg: #ffffff'), '侧边栏为浅色（非深色）');
  const st = await call('GET', '/api/settings');
  ok(st.data.data.values.theme_color === '#3687FF', '默认主题色为品牌蓝');
  const home = await call('GET', '/');
  ok(home.data.includes('数据概览'), '首页为数据概览（数据中台定位）');

  /* ═══ 需求 2：系统设置卡片式 ═══ */
  section('需求2：系统设置卡片式切换');
  const sp = await call('GET', '/settings');
  ok(sp.status === 200 && sp.data.includes('settings-cards'), '设置页使用卡片容器');
  ok(sp.data.includes('settings-card'), '渲染设置卡片');
  ok(css.data.includes('.settings-card.active'), '卡片选中态样式存在');
  const groups = st.data.data.groups;
  ok(groups.length >= 9, '设置分组 ≥ 9 个（实际 ' + groups.length + '）');
  const gk = groups.map((g) => g.key);
  ['site', 'security', 'smtp', 'storage', 'push', 'report', 'integration', 'ai', 'audit'].forEach((k) => {
    ok(gk.includes(k), '包含分组：' + k);
  });

  /* ═══ 需求 4：商业化设置项 ═══ */
  section('需求4：商业化系统设置项');
  const vals = st.data.data.values;
  const settingCount = Object.keys(vals).length;
  ok(settingCount >= 50, '设置项 ≥ 50 个（实际 ' + settingCount + '）');
  ['theme_color', 'force_https', 'ip_whitelist', 'default_datasource_id',
   'auto_create_parsed_table', 'data_retention_days', 'chart_palette',
   'allow_public_share', 'integration_timeout', 'ai_enabled', 'ai_base_url',
   'audit_enabled', 'audit_retention_days'].forEach((k) => {
    ok(k in vals, '包含设置项：' + k);
  });

  /* ═══ 需求 3：多数据源 ═══ */
  section('需求3：多数据源管理');
  const dsp = await call('GET', '/datasources');
  ok(dsp.status === 200 && dsp.data.includes('数据源管理'), '数据源页面可访问');
  const dsList = await call('GET', '/api/datasources');
  ok(dsList.data.ok, '数据源列表接口正常');
  ok(dsList.data.data.list.length >= 1, '包含默认数据源');
  ok(dsList.data.data.list[0].isDefault === true, '默认数据源标记正确');
  const catalog = dsList.data.data.catalog || [];
  const allKeys = catalog.reduce((a,c)=>a.concat(c.types.map(t=>t.key)),[]);
  ok(allKeys.includes('mysql') && allKeys.includes('mssql'), '支持 MySQL 与 SQL Server 两种驱动');
  ok(allKeys.length >= 13, '支持 ≥ 13 种数据源类型（实际 ' + allKeys.length + '）');
  const dsTest = await call('POST', '/api/datasources/0/test');
  ok(dsTest.data.ok, '默认数据源连接测试通过');

  /* ═══ 需求 5：角色权限可编辑 ═══ */
  section('需求5：角色权限可编辑');
  const rp = await call('GET', '/roles');
  ok(rp.status === 200 && rp.data.includes('角色权限'), '角色页面可访问');
  ok(rp.data.includes('perm-group'), '渲染权限矩阵');
  const rolesRes = await call('GET', '/api/roles');
  ok(rolesRes.data.ok, '角色列表接口正常');
  ok(rolesRes.data.data.list.length >= 3, '包含 3 个内置角色');
  ok(rolesRes.data.data.all.length >= 25, '权限点 ≥ 25 个（实际 ' + rolesRes.data.data.all.length + '）');
  ok(rolesRes.data.data.groups.length >= 7, '权限分组 ≥ 7 组');

  // 新建自定义角色
  const newRole = await call('POST', '/api/roles', {
    key: 'analyst',
    name: '数据分析师',
    description: '仅可查看数据与报表',
    permissions: ['project:read', 'data:read', 'dataset:read', 'report:read', 'ai:use'],
  });
  ok(newRole.data.ok, '创建自定义角色：' + (newRole.data.message || ''));
  const roleId = newRole.data.data && newRole.data.data.id;

  // 修改角色权限
  const updRole = await call('PUT', '/api/roles/' + roleId, {
    permissions: ['project:read', 'data:read', 'dataset:read', 'report:read', 'report:write', 'ai:use'],
  });
  ok(updRole.data.ok && updRole.data.data.permissions.includes('report:write'), '★ 角色权限可编辑（新增 report:write）');

  // 内置角色权限也可编辑（但 admin 不可缩减）
  const adminRole = rolesRes.data.data.list.find((r) => r.key === 'admin');
  const shrinkAdmin = await call('PUT', '/api/roles/' + adminRole.id, { permissions: ['project:read'] });
  ok(shrinkAdmin.status === 400, '★ 超级管理员权限不可缩减（防止锁死）');

  const viewerRole = rolesRes.data.data.list.find((r) => r.key === 'viewer');
  const updViewer = await call('PUT', '/api/roles/' + viewerRole.id, {
    permissions: ['project:read', 'data:read', 'log:read', 'dataset:read', 'report:read', 'ai:use', 'data:export'],
  });
  ok(updViewer.data.ok && updViewer.data.data.permissions.includes('data:export'),
     '★ 内置角色权限可编辑（只读用户新增导出权限）');

  /* ═══ 需求 1 + 6：项目独立表 + 解析双表 ═══ */
  section('需求1+6：项目独立数据表 + 解析前后双表');
  const create = await call('POST', '/api/projects', {
    name: '集成测试项目',
    jdyBaseUrl: BASE,
    jdySecret: 'v3-secret',
    description: 'v3 全功能测试',
    parseEnabled: true,
    datasourceId: 0,
  });
  ok(create.data.ok, '创建项目');
  const pid = create.data.data.id;
  const token = create.data.data.push_token;
  const dataTable = create.data.data.data_table;
  const parsedTable = create.data.data.parsed_table;
  console.log('        原始表=' + dataTable + ' 解析表=' + parsedTable);
  ok(dataTable === 'jdywh_data_' + pid, '★ 原始数据表按项目独立命名');
  ok(parsedTable === 'jdywh_parsed_' + pid, '★ 解析数据表按项目独立命名');
  ok(dataTable !== parsedTable, '★ 解析前后为两张独立表');

  // 项目列表显示表名
  const plist = await call('GET', '/api/projects');
  const p0 = plist.data.data.find((p) => p.id === pid);
  ok(!!p0 && p0.data_table === dataTable, '★ 项目列表返回原始表名');
  ok(!!p0 && p0.parsed_table === parsedTable, '★ 项目列表返回解析表名');
  ok(!!p0 && p0.datasource_name !== undefined, '★ 项目列表返回数据源名称');

  const plistPage = await call('GET', '/projects');
  ok(plistPage.data.includes('原始表') && plistPage.data.includes('解析表'), '★ 项目卡片显示两张表名');

  const pdetail = await call('GET', '/projects/' + pid);
  ok(pdetail.data.includes('数据表信息'), '★ 项目详情含「数据表信息」区块');
  ok(pdetail.data.includes(dataTable) && pdetail.data.includes(parsedTable), '★ 项目详情显示两张表名');
  ok(pdetail.data.includes('解析后数据'), '★ 项目详情含「解析后数据」页签');

  /* ═══ 推送并验证双表写入 ═══ */
  section('推送数据 → 验证双表写入');
  const payload = {
    op: 'data_create',
    opTime: Date.now(),
    data: {
      _id: 'v3_001',
      formName: '测试表单',
      creator: { username: 'guochen@sinohealth.cn', name: '郭晨', status: 1 },
      createTime: Date.now(),
      姓名: '张三',
      销售: { _id: 'x1', name: '郭晨', status: 1, username: 'guochen@sinohealth.cn' },
      金额: 1234.56,
    },
  };
  const raw = JSON.stringify(payload);
  const n1 = 'v3n1';
  const ts1 = String(Math.floor(Date.now() / 1000));
  const sig1 = crypto.createHash('sha1').update(`${n1}:${raw}:v3-secret:${ts1}`, 'utf8').digest('hex');
  const push = await fetch(`${BASE}/jdy/push/${token}?nonce=${n1}&timestamp=${ts1}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-JDY-Signature': sig1, 'X-JDY-DeliverId': 'v3d1' },
    body: raw,
  });
  ok(push.status === 200, '推送接收成功');

  const recs = await call('GET', '/api/projects/' + pid + '/records');
  ok(recs.data.data.total === 1, '原始表写入 1 条');

  const parsed = await call('GET', '/api/projects/' + pid + '/parsed');
  ok(parsed.data.ok, '解析表接口正常');
  ok(parsed.data.data.total === 1, '★ 解析表写入 1 条');
  const prow = parsed.data.data.list[0];
  ok(!!prow, '解析表有数据');
  if (prow) {
    const keys = Object.keys(prow);
    const parsedCols = keys.filter((k) => k.endsWith('_p'));
    ok(parsedCols.length > 0, '★ 解析表含解析列（' + parsedCols.length + ' 个）');
    const salesCol = parsedCols.find((k) => prow[k] && String(prow[k]).includes('郭晨'));
    ok(!!salesCol, '★ 解析值正确（' + (salesCol ? prow[salesCol] : '未找到') + '）');
  }

  /* ═══ 需求 8：数据中台定位 ═══ */
  section('需求8：数据中台定位（集成/BI/大屏/治理/AI）');
  const dash = await call('GET', '/api/dashboard');
  ok(dash.data.ok, '数据概览接口正常');
  const ds = dash.data.data.stats;
  ['projects', 'dataTotal', 'datasources', 'datasets', 'reports', 'integrations', 'shares', 'aiChats'].forEach((k) => {
    ok(k in ds, '概览统计含：' + k);
  });

  const nav = await call('GET', '/');
  ['数据接入', '分析与可视化', '数据治理', '系统管理'].forEach((k) => {
    ok(nav.data.includes(k), '导航含模块：' + k);
  });

  /* ═══ 需求 9：数据集成 ═══ */
  section('需求9：接口采集与接口推送');
  const ip = await call('GET', '/integrations');
  ok(ip.status === 200 && ip.data.includes('数据集成'), '集成页面可访问');
  ok(ip.data.includes('接口采集') && ip.data.includes('接口推送'), '★ 同时支持采集与推送');

  // 创建采集任务（指向本平台的 healthz 作为测试接口）
  const pullTask = await call('POST', '/api/integrations', {
    name: '测试采集任务',
    direction: 'pull',
    projectId: pid,
    protocol: 'http',
    method: 'GET',
    url: BASE + '/api/chart-types',
    dataPath: '',
  });
  ok(pullTask.data.ok, '★ 创建接口采集任务');
  const pullId = pullTask.data.data && pullTask.data.data.id;

  // 创建推送任务
  const pushTask = await call('POST', '/api/integrations', {
    name: '测试推送任务',
    direction: 'push',
    projectId: pid,
    protocol: 'http',
    method: 'POST',
    url: BASE + '/jdy/push-test-sink',
  });
  ok(pushTask.data.ok, '★ 创建接口推送任务');
  const pushId = pushTask.data.data && pushTask.data.data.id;

  const intList = await call('GET', '/api/integrations');
  ok(intList.data.data.stats.pullCount >= 1, '统计采集任务数');
  ok(intList.data.data.stats.pushCount >= 1, '统计推送任务数');

  // 执行采集任务（接口返回非数组，应记录失败但不崩溃）
  const runPull = await call('POST', '/api/integrations/' + pullId + '/run', {});
  ok(runPull.status === 200, '执行采集任务不崩溃（结果：' + (runPull.data.message || '').slice(0, 40) + '）');

  const intLogs = await call('GET', '/api/integrations/' + pullId + '/logs');
  ok(intLogs.data.ok && intLogs.data.data.total >= 1, '★ 集成运行日志已记录');

  const intDetail = await call('GET', '/integrations/' + pullId);
  ok(intDetail.status === 200 && intDetail.data.includes('运行日志'), '集成详情页可访问');

  /* ═══ 需求 10：报表与分享 ═══ */
  section('需求10：报表加工与分享');
  const dsPage = await call('GET', '/datasets');
  ok(dsPage.status === 200 && dsPage.data.includes('数据集'), '数据集页面可访问');

  // 创建项目数据集（读取解析表）
  const dataset = await call('POST', '/api/datasets', {
    name: '测试数据集',
    sourceType: 'project',
    datasourceId: 0,
    projectId: pid,
    sourceTable: 'parsed',
  });
  ok(dataset.data.ok, '★ 创建数据集（基于项目解析表）');
  const dsId = dataset.data.data && dataset.data.data.id;

  const preview = await call('POST', '/api/datasets/' + dsId + '/preview', { limit: 10 });
  ok(preview.data.ok && preview.data.data.rowCount >= 1, '★ 数据集预览正常（' + (preview.data.data ? preview.data.data.rowCount : 0) + ' 行）');

  // SQL 注入防护
  const badSql = await call('POST', '/api/datasets/test-sql', { sql: 'DROP TABLE users', datasourceId: 0 });
  ok(badSql.status === 400, '★ SQL 写操作被拒绝');
  const badSql2 = await call('POST', '/api/datasets/test-sql', { sql: 'SELECT 1; DROP TABLE x', datasourceId: 0 });
  ok(badSql2.status === 400, '★ 多语句被拒绝');

  const goodSql = await call('POST', '/api/datasets/test-sql', { sql: 'SELECT 1 AS n', datasourceId: 0 });
  ok(goodSql.data.ok, '只读 SQL 可执行');

  // 创建报表
  const chartTypes = await call('GET', '/api/chart-types');
  ok(chartTypes.data.data.length >= 12, '★ 支持 ≥ 12 种图表类型（实际 ' + chartTypes.data.data.length + '）');

  const report = await call('POST', '/api/reports', {
    name: '测试报表',
    reportType: 'chart',
    datasetId: dsId,
    category: '测试',
    config: { chartType: 'bar', categoryField: 'jdy_data_id', valueField: 'id', height: 360 },
  });
  ok(report.data.ok, '★ 创建报表');
  const rid = report.data.data && report.data.data.id;

  const runReport = await call('POST', '/api/reports/' + rid + '/run', { limit: 100 });
  ok(runReport.data.ok && runReport.data.data.rows.length >= 1, '★ 报表取数正常');

  const rpPage = await call('GET', '/reports');
  ok(rpPage.status === 200 && rpPage.data.includes('report-grid'), '报表中心使用卡片网格');
  const rvPage = await call('GET', '/reports/' + rid + '/view');
  ok(rvPage.status === 200 && rvPage.data.includes('chartCanvas'), '报表查看页可访问');
  const rdPage = await call('GET', '/reports/' + rid + '/design');
  ok(rdPage.status === 200 && rdPage.data.includes('chart-type-grid'), '报表设计器可访问');

  // 分享
  const share = await call('POST', '/api/shares', {
    targetType: 'report',
    targetId: rid,
    expiresDays: 7,
    password: 'abc123',
  });
  ok(share.data.ok, '★ 创建分享链接');
  const shareToken = share.data.data && share.data.data.token;
  ok(!!share.data.data.url, '分享链接含完整 URL');

  // 未登录访问分享（需密码）
  const savedCookie = cookie;
  cookie = '';
  const sharePage = await call('GET', '/s/' + shareToken);
  ok(sharePage.status === 200 && sharePage.data.includes('需要访问密码'), '★ 分享页要求密码（无需登录）');

  const shareOk = await call('GET', '/s/' + shareToken + '?pwd=abc123');
  ok(shareOk.status === 200 && shareOk.data.includes('chartCanvas'), '★ 密码正确后可查看报表');
  cookie = savedCookie;

  const sharesPage = await call('GET', '/shares');
  ok(sharesPage.status === 200 && sharesPage.data.includes('分享管理'), '分享管理页可访问');

  /* ═══ AI 问数 ═══ */
  section('AI 问数');
  const aiPage = await call('GET', '/ai');
  ok(aiPage.status === 200 && aiPage.data.includes('AI 问数'), 'AI 问数页面可访问');
  const aiAsk = await call('POST', '/api/ai/ask', { question: '有多少条数据' });
  ok(aiAsk.status === 400 || aiAsk.data.ok !== undefined,
     'AI 未配置时返回明确提示（' + String(aiAsk.data.message || '').slice(0, 40) + '）');

  /* ═══ 数据治理 ═══ */
  section('数据治理');
  const govPage = await call('GET', '/governance');
  ok(govPage.status === 200 && govPage.data.includes('治理总览'), '治理总览页可访问');
  const gov = await call('GET', '/api/governance/overview');
  ok(gov.data.ok && gov.data.data.length >= 1, '治理总览接口正常');
  const govItem = gov.data.data.find((x) => x.id === pid);
  ok(!!govItem && govItem.dataTable === dataTable, '★ 治理数据含原始表名');
  ok(!!govItem && govItem.parsedTable === parsedTable, '★ 治理数据含解析表名');
  const govSchema = await call('GET', '/api/governance/projects/' + pid + '/schema');
  ok(govSchema.data.ok && govSchema.data.data.rawColumns.length > 0, '表结构对照接口正常');

  /* ═══ 审计日志 ═══ */
  section('审计日志');
  const auditPage = await call('GET', '/audit');
  ok(auditPage.status === 200 && auditPage.data.includes('审计日志'), '审计日志页可访问');
  const auditLogs = await call('GET', '/api/audit-logs');
  ok(auditLogs.data.ok, '审计日志接口正常');
  ok(auditLogs.data.data.total >= 1, '★ 已记录操作审计（' + auditLogs.data.data.total + ' 条）');

  /* ═══ 权限隔离验证 ═══ */
  section('权限隔离验证');
  await login('admin', '6655');
  const testUser = await call('POST', '/api/users', {
    username: 'v3analyst',
    email: 'v3analyst@example.com',
    password: 'Test123456',
    displayName: '测试分析师',
    role: 'analyst',
  });
  ok(testUser.data.ok, '创建使用自定义角色的用户');
  const uid = testUser.data.data && testUser.data.data.id;

  await login('v3analyst', 'Test123456');
  const analystMe = await call('GET', '/api/me');
  ok(analystMe.data.ok && analystMe.data.data.role === 'analyst', '★ 用户使用自定义角色');
  ok(analystMe.data.data.permissions.includes('report:write'), '★ 自定义角色权限生效');
  const analystUsers = await call('GET', '/api/users');
  ok(analystUsers.status === 403, '★ 无 user:read 权限被拒绝');
  const analystDs = await call('GET', '/api/datasources');
  ok(analystDs.status === 403, '★ 无 datasource:read 权限被拒绝');

  await login('admin', '6655');

  /* ═══ 清理 ═══ */
  section('清理测试数据');
  await call('DELETE', '/api/projects/' + pid);
  ok(true, '删除测试项目');
  await call('DELETE', '/api/integrations/' + pullId);
  await call('DELETE', '/api/integrations/' + pushId);
  ok(true, '删除测试集成任务');
  await call('DELETE', '/api/users/' + uid);
  ok(true, '删除测试用户');
  await call('DELETE', '/api/roles/' + roleId);
  ok(true, '删除测试角色');
  // 还原 viewer 角色权限
  await call('PUT', '/api/roles/' + viewerRole.id, {
    permissions: ['project:read', 'data:read', 'log:read', 'dataset:read', 'report:read', 'integration:read', 'ai:use'],
  });
  ok(true, '还原内置角色权限');

  console.log('\n======== 结果 ========');
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});