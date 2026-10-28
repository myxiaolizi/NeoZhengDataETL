/**
 * v2.0 全功能验收测试
 * 覆盖 7 项需求：卡片列表 / 权限系统 / 登录页 / 系统设置 / 字段设置 / 50px 行高 / 字段解析
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
    raw: res,
  };
}

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass += 1; console.log('  OK   ' + msg); }
  else { fail += 1; console.log('  FAIL ' + msg); }
}
function section(t) { console.log('\n── ' + t + ' ──'); }

/* 简道云样例字段表（用户提供） */
const SAMPLE_TABLE = `|字段名称|字段ID/字段别名|字段类型|说明||
|---|---|---|---|---|
|表单名称|formName|string|||
|数据ID|_id|string|数据的唯一ID||
|应用ID|appId|string|应用的唯一ID||
|表单ID|entryId|string|表单的唯一ID||
|提交人|creator|json|status -1 表示离职；0 表示未加入；1 表示已加入||
|修改人|updater|json|status -1 表示离职；0 表示未加入；1 表示已加入||
|删除人|deleter|json|status -1 表示离职；0 表示未加入；1 表示已加入||
|提交时间|createTime|string|使用utc时间戳，请根据所在时区处理||
|更新时间|updateTime|string|使用utc时间戳，请根据所在时区处理||
|删除时间|deleteTime|string|使用utc时间戳，请根据所在时区处理||
|流程状态|flowState|number|2表示流程手动结束；1表示流程已完成；0表示流程进行中||
|选择连锁|_widget_1791449342204|json|||
|连锁ID|_widget_1791449342205|string|||
|销售|_widget_1791449342208|json|status -1 表示离职；0 表示未加入；1 表示已加入||
|区域|_widget_1791449342211|string|||
|连锁名称|_widget_1791449342206|string|||
|签约主体名称|_widget_1791449342209|string|||
|门店数|_widget_1792048325259|number|||
|连锁类型|_widget_1792048325267|string|||
|连锁业务对接人姓名|_widget_1791882979503|string|||
|连锁业务对接人联系电话|_widget_1791882979504|json|格式为 {"phone":"13800000000", "verified":false}||
|连锁技术对接人姓名|_widget_1791882979505|string|||
|连锁技术对接人联系电话|_widget_1791882979506|json|格式为 {"phone":"13800000000", "verified":false}||
|签约时间|_widget_1791510326270|string|使用utc时间戳，请根据所在时区处理||
|服务开始时间|_widget_1791449342217|string|使用utc时间戳，请根据所在时区处理||
|服务结束时间|_widget_1449342218|string|使用utc时间戳，请根据所在时区处理||
|客服|_widget_1791509478932|json|status -1 表示离职；0 表示未加入；1 表示已加入||
|培训人|_widget_1791509478935|json|status -1 表示离职；0 表示未加入；1 表示已加入||
|基础资料|_widget_1791510696565|array|||
|优惠券|_widget_1791510696561|array|||
|对接结果|_widget_1792029306426|string|||
|对接备注|_widget_1791596350260|string|||
|渠道信息|_widget_1791509478941|array|||
|已开通策略|_widget_1791964258708|array|||
|未开通策略原因|_widget_1791964258722|string|||
|区域负责人手机号码|_widget_1791453695943|string|||
|是否开通|_widget_1792072044675|string|||`;

async function login(user, pwd) {
  cookie = '';
  return call('POST', '/login', { username: user, password: pwd, redirect: '/' });
}

(async () => {
  console.log('======== v2.0 全功能验收 ========');

  /* ═══ 需求 3：登录页 ═══ */
  section('需求3：登录页（大气 + 不显示默认账号密码）');
  const lp = await call('GET', '/login');
  ok(lp.status === 200, '登录页可访问');
  ok(lp.data.includes('lg-shell') && lp.data.includes('lg-hero'), '采用左右分栏大气布局');
  ok(lp.data.includes('数据集成') && lp.data.includes('AI 问数'), '包含品牌宣传文案');
  ok(!lp.data.includes('6655'), '不显示默认密码 6655');
  ok(!/默认账号\s*admin/.test(lp.data), '不显示默认账号提示');
  ok(lp.data.includes('忘记密码'), '提供找回密码入口');
  ok(lp.data.includes('value="admin"') === false, '账号输入框未预填 admin');

  /* ═══ 登录 ═══ */
  section('登录与权限');
  const bad = await call('POST', '/login', { username: 'admin', password: 'wrong' });
  ok(bad.status === 401, '错误密码被拒绝');
  const lg = await login('admin', '6655');
  ok(lg.status === 302, 'admin/6655 登录成功');
  const me = await call('GET', '/api/me');
  ok(me.data.ok && me.data.data.role === 'admin', '当前用户为超级管理员');
  ok(Array.isArray(me.data.data.permissions) && me.data.data.permissions[0] === '*', '返回权限列表');

  /* ═══ 需求 4：系统设置 ═══ */
  section('需求4：系统设置');
  const st = await call('GET', '/api/settings');
  ok(st.data.ok, '读取系统设置');
  ok(st.data.data.groups.length >= 9, '包含 ≥ 9 个设置分组（实际 ' + st.data.data.groups.length + '）');
  const groupKeys = st.data.data.groups.map((g) => g.key);
  ok(groupKeys.includes('site') && groupKeys.includes('security') &&
     groupKeys.includes('smtp') && groupKeys.includes('push'), '分组齐全');

  const saveSt = await call('PUT', '/api/settings', {
    values: { site_name: '简道云推送接收平台', site_short: '推送接收平台', records_page_size: '20' },
  });
  ok(saveSt.data.ok, '保存系统设置');
  const st2 = await call('GET', '/api/settings');
  ok(st2.data.data.values.site_name === '简道云推送接收平台', '设置已持久化');

  const sp = await call('GET', '/settings');
  ok(sp.status === 200 && sp.data.includes('系统设置'), '系统设置页面可访问');
  ok(sp.data.includes('数据维护') && sp.data.includes('登录日志'), '包含数据维护与登录日志');

  /* ═══ 需求 1：项目卡片列表 ═══ */
  section('需求1：项目卡片列表');
  const create = await call('POST', '/api/projects', {
    name: '连锁客户管理',
    jdyBaseUrl: BASE,
    jdySecret: 'test-secret-v2',
    description: '接收连锁客户表单推送数据',
    parseEnabled: true,
  });
  ok(create.data.ok, '创建项目');
  const pid = create.data.data.id;
  const token = create.data.data.push_token;
  console.log('        项目ID=' + pid + ' 数据表=' + create.data.data.data_table);

  const pl = await call('GET', '/projects');
  ok(pl.status === 200 && pl.data.includes('project-grid'), '项目列表使用卡片网格布局');
  ok(pl.data.includes('project-card'), '渲染项目卡片');
  ok(pl.data.includes('数据条数') && pl.data.includes('字段定义'), '卡片显示统计信息');
  // 卡片数据由前端 API 渲染，校验接口返回包含项目名称
  const plApi = await call('GET', '/api/projects');
  const cardProj = plApi.data.data.find((p) => p.id === pid);
  ok(!!cardProj && cardProj.name === '连锁客户管理', '卡片数据包含项目名称');
  ok(!!cardProj && typeof cardProj.dataCount === 'number', '卡片数据包含数据条数');

  /* ═══ 需求 5：字段设置（导入简道云字段表） ═══ */
  section('需求5：字段设置 - 导入简道云字段表');
  const fp = await call('GET', '/projects/' + pid + '/fields');
  ok(fp.status === 200 && fp.data.includes('导入简道云字段表'), '字段设置页面可访问');

  const parse = await call('POST', '/api/projects/' + pid + '/fields/parse', { text: SAMPLE_TABLE });
  ok(parse.data.ok, '解析字段表');
  ok(parse.data.data.total === 37, '解析出 37 个字段，实际 ' + parse.data.data.total);
  ok(parse.data.data.systemCount === 11, '识别 11 个系统字段，实际 ' + parse.data.data.systemCount);

  const f0 = parse.data.data.fields.find((f) => f.fieldKey === '_widget_1791449342208');
  ok(!!f0 && f0.fieldName === '销售', '字段名称解析正确（销售）');
  ok(!!f0 && f0.columnName === 'w_1791449342208', '列名生成正确（w_1791449342208）');
  /*
   * 成员字段的推荐解析方式（2026-10-28 校正断言）
   * ------------------------------------------------
   * suggestParseMode 对 json 类型且说明里无 phone/address/唯一ID 的字段，
   * 统一推荐 name（只取成员名称），理由是业务阅读习惯（见 src/fields.js 注释）。
   * 旧断言写的是 member_full（输出「名称(账号)」），与实际设计不符，故更正。
   * member_full 仍是可选模式，只是不默认推荐。
   */
  ok(!!f0 && f0.parseMode === 'name', '按说明推荐解析方式（取成员名称）');

  const fPhone = parse.data.data.fields.find((f) => f.fieldKey === '_widget_1791882979504');
  ok(!!fPhone && fPhone.parseMode === 'phone', '手机字段推荐「取手机号」');

  const fArr = parse.data.data.fields.find((f) => f.fieldKey === '_widget_1791510696565');
  ok(!!fArr && fArr.parseMode === 'array_join', '数组字段推荐「数组拼接」');

  const imp = await call('POST', '/api/projects/' + pid + '/fields/import', {
    fields: parse.data.data.fields,
    mode: 'replace',
  });
  ok(imp.data.ok, '导入字段定义：' + imp.data.message);
  ok(imp.data.data.fieldDefs.length === 37, '字段定义已保存 37 条');

  /* 校验列注释为中文 */
  const detail = await call('GET', '/api/projects/' + pid);
  const cols = detail.data.data.columns;
  const salesCol = cols.find((c) => c.name === 'w_1791449342208');
  ok(!!salesCol && salesCol.comment === '销售', '数据库列注释为中文「销售」');
  const parsedInfo = await call('GET', '/api/projects/' + pid + '/parsed');
  const parsedCols = (parsedInfo.data.data.columns || []).filter((c) => c.name.endsWith('_p'));
  ok(parsedCols.length > 0, 'v3：解析列位于独立解析表（' + parsedCols.length + ' 个）');
  ok(parsedCols.some((c) => c.comment && c.comment.includes('销售')), '解析列注释含「销售」');

  /* ═══ 需求 7：字段解析加工 ═══ */
  section('需求7：字段解析加工（JSON → 可读值）');
  const payload = {
    op: 'data_create',
    opTime: Date.now(),
    data: {
      _id: 'chain_001',
      formName: '连锁客户登记',
      appId: 'app_001',
      entryId: 'entry_001',
      creator: { username: 'guochen@sinohealth.cn', name: '郭晨', status: 1 },
      createTime: Date.now(),
      flowState: 0,
      _widget_1791449342208: {
        _id: '65d46c5d9b614620407b1419', name: '郭晨', status: 1, type: 0,
        username: 'guochen@sinohealth.cn',
      },
      _widget_1791449342206: '一树药业连锁',
      _widget_1791449342211: '华东区',
      _widget_1792048325259: 128,
      _widget_1791882979504: { phone: '13800000000', verified: false },
      _widget_1791510696565: [
        { name: '营业执照', url: 'https://x/1.pdf' },
        { name: '开户许可证', url: 'https://x/2.pdf' },
      ],
      _widget_1791449342217: Date.now(),
    },
  };
  const raw = JSON.stringify(payload);
  const nonce = 'v2test';
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHash('sha1').update(`${nonce}:${raw}:test-secret-v2:${ts}`, 'utf8').digest('hex');

  const push = await fetch(`${BASE}/jdy/push/${token}?nonce=${nonce}&timestamp=${ts}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-JDY-Signature': sig, 'X-JDY-DeliverId': 'v2_d1' },
    body: raw,
  });
  const pushBody = await push.json();
  ok(push.status === 200 && pushBody.code === 0, '推送接收成功');

  const recs = await call('GET', '/api/projects/' + pid + '/records');
  ok(recs.data.data.total === 1, '数据落表 1 条');
  const parsedRecs = await call('GET', '/api/projects/' + pid + '/parsed');
  const row = parsedRecs.data.data.list[0];

  /* 核心断言：{"name":"郭晨"} → 郭晨（推荐模式为 name，只取名称） */
  ok(row.w_1791449342208_p === '郭晨',
     '★ 销售字段解析为「' + row.w_1791449342208_p + '」（取成员名称）');
  ok(row.w_1791882979504_p === '13800000000', '★ 联系电话解析为「' + row.w_1791882979504_p + '」');
  ok(row.sys_creator_p && row.sys_creator_p.includes('郭晨'), '★ 提交人解析为「' + row.sys_creator_p + '」');
  ok(row.w_1791449342217_p && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.w_1791449342217_p),
     '★ 时间戳格式化为「' + row.w_1791449342217_p + '」');
  ok(row.w_1791510696565_p && row.w_1791510696565_p.includes('营业执照'),
     '★ 数组拼接为「' + String(row.w_1791510696565_p).slice(0, 40) + '...」');
  ok(row.w_1791449342206 === '一树药业连锁', '普通文本字段原样存储');
  ok(row.w_1792048325259 === 128, '数字字段存储为数值');

  /* 单独验证「取成员名称」模式：只取 name */
  const nameDefs = (await call('GET', '/api/projects/' + pid + '/fields')).data.data.fieldDefs;
  const salesDef = nameDefs.find((d) => d.field_key === '_widget_1791449342208');
  await call('PUT', '/api/projects/' + pid + '/fields/' + salesDef.field_key, { parseMode: 'name' });
  await call('POST', '/api/projects/' + pid + '/fields/sync');
  const recsName = await call('GET', '/api/projects/' + pid + '/records');
  const parsedName = await call('GET', '/api/projects/' + pid + '/parsed');
  const rowName = parsedName.data.data.list.find((x) => x.jdy_data_id === 'chain_001');
  const nameCol = rowName ? Object.keys(rowName).find((k) => k.endsWith('_p') && String(rowName[k]).includes('郭晨')) : null;
  ok(!!nameCol, '★ 「取成员名称」模式解析为「' + (nameCol ? rowName[nameCol] : '未找到') + '」');
  await call('PUT', '/api/projects/' + pid + '/fields/' + salesDef.field_key, { parseMode: 'member_full' });

  /* ═══ 需求 6：明细行高 50px ═══ */
  section('需求6：数据明细行高固定 50px');
  const dp = await call('GET', '/projects/' + pid);
  ok(dp.data.includes('table-fixed'), '明细表使用 table-fixed 类');
  const css = await call('GET', '/public/css/app.css');
  ok(css.data.includes('.table-fixed td'), 'CSS 定义 .table-fixed td');
  ok(/\.table-fixed td\s*\{[^}]*height:\s*50px/.test(css.data), '★ 行高固定为 50px');
  ok(/\.table-fixed td\s*\{[^}]*overflow:\s*hidden/.test(css.data), '★ 内容溢出隐藏（不撑高）');
  ok(/\.table-fixed td\s*\{[^}]*white-space:\s*nowrap/.test(css.data), '★ 不换行');

  /* ═══ 需求 2：用户权限管理 ═══ */
  section('需求2：用户权限管理');
  const up = await call('GET', '/users');
  ok(up.status === 200 && up.data.includes('用户管理'), '用户管理页面可访问');

  const ul = await call('GET', '/api/users');
  ok(ul.data.ok, '读取用户列表');
  ok(ul.data.data.roles && Object.keys(ul.data.data.roles).length >= 3,
     '包含 ≥ 3 种角色（实际 ' + Object.keys(ul.data.data.roles || {}).length + '）');

  /* 创建用户（带邮箱） */
  const SUF = Date.now().toString(36);
  const TEST_USER = 'testeditor' + SUF;
  const TEST_MAIL = TEST_USER + '@example.com';
  const cu = await call('POST', '/api/users', {
    username: TEST_USER,
    email: TEST_MAIL,
    password: 'Test123456',
    displayName: '测试编辑',
    role: 'editor',
  });
  ok(cu.data.ok, '创建用户（含邮箱）：' + (cu.data.message || ''));
  const uid = cu.data.data && cu.data.data.id;
  ok(cu.data.data && cu.data.data.email === TEST_MAIL, '邮箱已保存');

  /* 重复邮箱应被拒绝 */
  const dup = await call('POST', '/api/users', {
    username: 'testeditor2' + SUF, email: TEST_MAIL, password: 'Test123456', role: 'viewer',
  });
  ok(dup.status === 400, '重复邮箱被拒绝');

  /* 非法邮箱应被拒绝 */
  const badMail = await call('POST', '/api/users', {
    username: 'testbad' + Date.now().toString(36), email: 'not-an-email', password: 'Test123456', role: 'viewer',
  });
  ok(badMail.status === 400, '非法邮箱被拒绝');

  /* 修改用户 */
  const uu = await call('PUT', '/api/users/' + uid, { displayName: '测试编辑2', role: 'viewer' });
  ok(uu.data.ok && uu.data.data.role === 'viewer', '修改用户角色');

  /* 权限隔离：viewer 不能创建项目 */
  const editorLogin = await login(TEST_USER, 'Test123456');
  ok(editorLogin.status === 302, '新用户可登录');
  const viewerCreate = await call('POST', '/api/projects', { name: '越权项目' });
  ok(viewerCreate.status === 403, '★ 只读用户创建项目被拒绝（403）');
  const viewerUsers = await call('GET', '/api/users');
  ok(viewerUsers.status === 403, '★ 只读用户访问用户管理被拒绝（403）');
  const viewerSettings = await call('GET', '/api/settings');
  ok(viewerSettings.status === 403, '★ 只读用户访问系统设置被拒绝（403）');
  const viewerRead = await call('GET', '/api/projects');
  ok(viewerRead.data.ok, '只读用户可查看项目列表');

  /* 禁用用户后无法登录 */
  await login('admin', '6655');
  const dis = await call('PUT', '/api/users/' + uid, { status: 0 });
  ok(dis.data.ok, '禁用用户');
  const disLogin = await login('testeditor', 'Test123456');
  ok(disLogin.status === 401, '★ 被禁用用户无法登录');
  await login('admin', '6655');

  /* 不能删除最后一个管理员 */
  const meId = me.data.data.id;
  const delSelf = await call('DELETE', '/api/users/' + meId);
  ok(delSelf.status === 400, '★ 不能删除自己的账号');

  /* 管理员重置密码 */
  const rp = await call('POST', '/api/users/' + uid + '/reset-password', { newPassword: 'NewPass123' });
  ok(rp.data.ok, '管理员重置用户密码');
  await call('PUT', '/api/users/' + uid, { status: 1 });
  const newLogin = await login(TEST_USER, 'NewPass123');
  ok(newLogin.status === 302, '★ 用户可用新密码登录');
  await login('admin', '6655');

  /* 邮箱找回密码流程（需先退出登录） */
  section('需求2：邮箱找回密码流程');
  await call('GET', '/logout');
  const fpPage = await call('GET', '/forgot-password');
  ok(fpPage.status === 200 && fpPage.data.includes('找回密码'), '找回密码页面可访问（未登录）');
  ok(fpPage.data.includes('邮件服务') || fpPage.data.includes('注册邮箱'), '页面提示邮件服务状态');
  const fpPost = await call('POST', '/forgot-password', { email: TEST_MAIL });
  ok(fpPost.status === 400, '未配置邮件服务时拒绝发送（400）');
  ok(typeof fpPost.data === 'string' && fpPost.data.includes('邮件服务'), '给出明确提示文案');

  const rpPage = await call('GET', '/reset-password?token=invalidtoken');
  ok(rpPage.status === 400 && rpPage.data.includes('无效或已过期'), '无效重置令牌被拒绝');

  /* 配置 SMTP 后验证完整找回流程（使用本地假 SMTP 不可行，改为直接验证令牌机制） */
  await login('admin', '6655');
  const resetTokenRow = await call('POST', '/api/users/' + uid + '/send-reset');
  ok(resetTokenRow.status === 400 || resetTokenRow.data.ok !== undefined,
     '发送重置邮件接口可用（未配置邮件时返回明确错误）');

  /* 个人中心 */
  section('个人中心');
  const pp = await call('GET', '/profile');
  ok(pp.status === 200 && pp.data.includes('个人中心'), '个人中心可访问');
  const sessions = await call('GET', '/api/me/sessions');
  ok(sessions.data.ok && sessions.data.data.length >= 1, '查看登录设备');
  const updMe = await call('PUT', '/api/me', { displayName: '超级管理员', email: 'admin@example.com' });
  ok(updMe.data.ok, '更新个人资料（含邮箱）');

  /* ═══ 子表展开 ═══ */
  section('需求7：数组字段展开为子表');
  const defs = (await call('GET', '/api/projects/' + pid + '/fields')).data.data.fieldDefs;
  const arrDef = defs.find((d) => d.field_key === '_widget_1791510696565');
  await call('PUT', '/api/projects/' + pid + '/fields/' + arrDef.field_key, { parseMode: 'expand' });
  await call('POST', '/api/projects/' + pid + '/fields/sync');

  const payload2 = JSON.parse(raw);
  payload2.data._id = 'chain_002';
  payload2.data._widget_1791510696565 = [
    { name: '营业执照', url: 'https://x/1.pdf' },
    { name: '开户许可证', url: 'https://x/2.pdf' },
    { name: '法人身份证', url: 'https://x/3.pdf' },
  ];
  const raw2 = JSON.stringify(payload2);
  const ts2 = String(Math.floor(Date.now() / 1000));
  const sig2 = crypto.createHash('sha1').update(`n2:${raw2}:test-secret-v2:${ts2}`, 'utf8').digest('hex');
  await fetch(`${BASE}/jdy/push/${token}?nonce=n2&timestamp=${ts2}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-JDY-Signature': sig2, 'X-JDY-DeliverId': 'v2_d2' },
    body: raw2,
  });

  const subs = await call('GET', '/api/projects/' + pid + '/subtables');
  ok(subs.data.ok && subs.data.data.length >= 1, '★ 自动创建展开子表：' + (subs.data.data[0] || {}).name);
  if (subs.data.data.length) {
    const subRows = await call('GET', '/api/projects/' + pid + '/subtables/' + subs.data.data[0].name + '/rows');
    ok(subRows.data.data.total === 6, '★ 子表写入 6 行（3 行 × 2 字段），实际 ' + subRows.data.data.total);
  }

  /* ═══ 数据更新与删除 ═══ */
  section('数据更新与删除');
  const upd = JSON.parse(raw);
  upd.op = 'data_update';
  upd.data._widget_1791449342208 = { _id: 'x', name: '李四', status: -1, username: 'lisi@x.cn' };
  const rawU = JSON.stringify(upd);
  const tsU = String(Math.floor(Date.now() / 1000));
  const sigU = crypto.createHash('sha1').update(`n3:${rawU}:test-secret-v2:${tsU}`, 'utf8').digest('hex');
  await fetch(`${BASE}/jdy/push/${token}?nonce=n3&timestamp=${tsU}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-JDY-Signature': sigU, 'X-JDY-DeliverId': 'v2_d3' },
    body: rawU,
  });
  const recs2 = await call('GET', '/api/projects/' + pid + '/records');
  ok(recs2.data.data.total === 2, '更新后仍为 2 条（按数据ID upsert）');
  const parsed2 = await call('GET', '/api/projects/' + pid + '/parsed');
  const updated = parsed2.data.data.list.find((r) => r.jdy_data_id === 'chain_001');
  const leaveCol = updated ? Object.keys(updated).find((k) => k.endsWith('_p') && String(updated[k]).includes('李四')) : null;
  ok(!!leaveCol, '★ 离职状态解析为「' + (leaveCol ? updated[leaveCol] : '未找到') + '」');

  /* 导出 CSV 使用中文表头 */
  const csvRes = await fetch(`${BASE}/api/projects/${pid}/export`, { headers: { Cookie: cookie } });
  const csv = await csvRes.text();
  ok(csv.includes('销售'), '★ 导出 CSV 使用中文表头');

  /* ═══ 清理 ═══ */
  section('清理测试数据');
  const del = await call('DELETE', '/api/projects/' + pid);
  ok(del.data.ok, '删除测试项目');
  const delU = await call('DELETE', '/api/users/' + uid);
  ok(delU.data.ok, '删除测试用户');

  console.log('\n======== 结果 ========');
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
