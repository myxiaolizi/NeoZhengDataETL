/**
 * 全系统功能审计
 *
 * 检查所有页面、接口、权限、数据表、驱动、配置项的完整性，
 * 找出缺失或异常的部分。
 */
'use strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8781';

let cookie = '';
function capture(r) {
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean);
  sc.forEach((c) => { if (c && c.startsWith('jdy_sid=')) cookie = c.split(';')[0]; });
}

async function call(method, path, body) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
  const res = await fetch(BASE + path, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  capture(res);
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
}

const issues = [];
const ok = (cond, msg) => { if (!cond) issues.push(msg); return cond; };

(async () => {
  console.log('════════ 全系统功能审计 ════════\n');
  await call('POST', '/login', { username: 'admin', password: '6655', redirect: '/' });

  /* ── 1. 页面完整性 ── */
  console.log('── 1. 页面完整性 ──');
  const pages = [
    ['/', '数据概览'], ['/dashboard', '数据概览'], ['/intro', '项目介绍'],
    ['/projects', '数据项目'], ['/projects/16', '项目详情'], ['/projects/16/fields', '字段设置'],
    ['/forms', '表单中心'], ['/flows', '处理流程'], ['/integrations', '数据集成'],
    ['/datasources', '数据源'], ['/datasets', '数据集'], ['/reports', '报表中心'],
    ['/shares', '分享管理'], ['/ai', 'AI 问数'], ['/governance', '治理总览'],
    ['/audit', '审计日志'], ['/users', '用户管理'], ['/settings', '系统设置'],
    ['/profile', '个人中心'], ['/help', '使用说明'], ['/dashboard/crm', 'CRM 看板'],
    ['/login', '登录'], ['/register', '注册'], ['/forgot-password', '找回密码'],
  ];

  for (const [path, name] of pages) {
    const r = await call('GET', path);
    const okStatus = r.status === 200 || r.status === 302;
    console.log(`  ${okStatus ? 'OK  ' : 'FAIL'} ${path.padEnd(24)} ${name} -> ${r.status}`);
    ok(okStatus, `页面 ${path} 返回 ${r.status}`);
    // 检查页面 JS 语法
    if (r.status === 200 && typeof r.data === 'string') {
      const blocks = [...r.data.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].filter((b) => b[1].trim());
      blocks.forEach((b, i) => {
        try { new Function(b[1]); } catch (e) {
          issues.push(`页面 ${path} 脚本块${i + 1} 语法错误: ${e.message}`);
          console.log(`       └─ 脚本块${i + 1} 语法错误: ${e.message}`);
        }
      });
    }
  }

  /* ── 2. API 完整性 ── */
  console.log('\n── 2. API 完整性 ──');
  const apis = [
    ['/api/me', 'GET'], ['/api/dashboard', 'GET'], ['/api/projects', 'GET'],
    ['/api/projects/16', 'GET'], ['/api/projects/16/records', 'GET'], ['/api/projects/16/parsed', 'GET'],
    ['/api/projects/16/logs', 'GET'], ['/api/projects/16/fields', 'GET'],
    ['/api/forms', 'GET'], ['/api/form-field-types', 'GET'], ['/api/flows', 'GET'],
    ['/api/flow-node-types', 'GET'], ['/api/integrations', 'GET'],
    ['/api/datasources', 'GET'], ['/api/datasource-types', 'GET'],
    ['/api/datasets', 'GET'], ['/api/reports', 'GET'], ['/api/chart-types', 'GET'],
    ['/api/shares', 'GET'], ['/api/ai/providers', 'GET'], ['/api/ai/chats', 'GET'],
    ['/api/governance/overview', 'GET'], ['/api/audit-logs', 'GET'],
    ['/api/users', 'GET'], ['/api/roles', 'GET'], ['/api/permissions', 'GET'],
    ['/api/departments', 'GET'], ['/api/settings', 'GET'], ['/api/system/tables', 'GET'],
    ['/api/login-logs', 'GET'], ['/api/crm/dashboard?projectId=16', 'GET'],
  ];

  for (const [path, method] of apis) {
    const r = await call(method, path);
    const okStatus = r.status === 200 && r.data && r.data.ok;
    console.log(`  ${okStatus ? 'OK  ' : 'FAIL'} ${path} -> ${r.status}${r.data && r.data.message ? ' (' + r.data.message + ')' : ''}`);
    ok(okStatus, `接口 ${path} 返回 ${r.status}`);
  }

  /* ── 3. 权限点覆盖 ── */
  console.log('\n── 3. 权限点覆盖 ──');
  const permRes = await call('GET', '/api/permissions');
  if (permRes.data && permRes.data.ok) {
    const all = permRes.data.data.all;
    const groups = permRes.data.data.groups;
    console.log(`  权限点: ${all.length} 个，分组: ${groups.length} 组`);
    groups.forEach((g) => console.log(`    ${g.name}: ${g.items.length} 个`));

    // 检查每个权限点是否在路由中被使用
    const fs = require('fs');
    const path = require('path');
    const srcDir = path.join(__dirname, '..', 'src');
    let srcText = '';
    const walk = (dir) => {
      fs.readdirSync(dir).forEach((f) => {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (f.endsWith('.js')) srcText += fs.readFileSync(p, 'utf8');
      });
    };
    walk(srcDir);

    const unused = all.filter((p) => !srcText.includes(`'${p}'`));
    if (unused.length) {
      console.log(`  ⚠ 未被使用的权限点: ${unused.join(', ')}`);
      issues.push(`权限点未被使用: ${unused.join(', ')}`);
    } else {
      console.log('  OK   所有权限点均已被使用');
    }
  }

  /* ── 4. 数据源驱动 ── */
  console.log('\n── 4. 数据源驱动 ──');
  const dtRes = await call('GET', '/api/datasource-types');
  if (dtRes.data && dtRes.data.ok) {
    const s = dtRes.data.data.stats;
    console.log(`  类型: ${s.types} 种，可用: ${s.available} 种，不可用: ${s.unavailable} 种`);
    console.log(`  覆盖率: ${Math.round((s.available / s.types) * 100)}%`);
    ok(s.available / s.types >= 0.9, `数据源可用率 ${Math.round((s.available / s.types) * 100)}% 低于 90%`);
  }

  /* ── 5. 数据表完整性 ── */
  console.log('\n── 5. 数据表完整性 ──');
  const tablesRes = await call('GET', '/api/system/tables');
  if (tablesRes.data && tablesRes.data.ok) {
    const tables = tablesRes.data.data;
    console.log(`  数据表: ${tables.length} 张`);
    const required = [
      'jdywh_users', 'jdywh_roles', 'jdywh_sessions', 'jdywh_resets', 'jdywh_settings',
      'jdywh_login_logs', 'jdywh_audit_logs', 'jdywh_datasources', 'jdywh_projects',
      'jdywh_field_defs', 'jdywh_datasets', 'jdywh_reports', 'jdywh_shares',
      'jdywh_integrations', 'jdywh_integration_logs', 'jdywh_ai_chats',
      'jdywh_departments', 'jdywh_forms', 'jdywh_form_records', 'jdywh_flows', 'jdywh_flow_logs',
    ];
    const names = tables.map((t) => t.name);
    const missing = required.filter((t) => !names.includes(t));
    if (missing.length) {
      console.log(`  ⚠ 缺失表: ${missing.join(', ')}`);
      issues.push(`缺失数据表: ${missing.join(', ')}`);
    } else {
      console.log('  OK   所有必需表均存在');
    }
  }

  /* ── 6. 设置项完整性 ── */
  console.log('\n── 6. 设置项完整性 ──');
  const setRes = await call('GET', '/api/settings');
  if (setRes.data && setRes.data.ok) {
    const vals = setRes.data.data.values;
    const groups = setRes.data.data.groups;
    console.log(`  设置项: ${Object.keys(vals).length} 个，分组: ${groups.length} 组`);
    groups.forEach((g) => console.log(`    ${g.title}: ${g.fields.length} 项`));

    // 检查分组字段是否都在 DEFAULTS 中
    const allFields = groups.reduce((a, g) => a.concat(g.fields.map((f) => f.key)), []);
    const missing = allFields.filter((k) => vals[k] === undefined);
    if (missing.length) {
      console.log(`  ⚠ 分组中引用了不存在的设置项: ${missing.join(', ')}`);
      issues.push(`设置项缺失: ${missing.join(', ')}`);
    } else {
      console.log('  OK   分组字段与设置项一致');
    }
  }

  /* ── 7. 角色权限 ── */
  console.log('\n── 7. 角色权限 ──');
  const roleRes = await call('GET', '/api/roles');
  if (roleRes.data && roleRes.data.ok) {
    roleRes.data.data.list.forEach((r) => {
      console.log(`  ${r.name} (${r.key}): ${r.permissions.includes('*') ? '全部权限' : r.permissions.length + ' 个权限'}，${r.userCount || 0} 个用户`);
    });
    ok(roleRes.data.data.list.length >= 3, '内置角色少于 3 个');
  }

  /* ── 8. 表单功能 ── */
  console.log('\n── 8. 表单功能 ──');
  const ftRes = await call('GET', '/api/form-field-types');
  if (ftRes.data && ftRes.data.ok) {
    const d = ftRes.data.data;
    console.log(`  控件: ${d.types.length} 种`);
    console.log(`  表单类型: ${d.formTypes.map((t) => t.name).join(', ')}`);
    console.log(`  宽度: ${d.widths.map((w) => w.key).join(', ')}`);
    console.log(`  选项布局: ${d.optionLayouts.map((o) => o.name).join(', ')}`);
  }

  /* ── 9. 流程节点 ── */
  console.log('\n── 9. 流程节点 ──');
  const fnRes = await call('GET', '/api/flow-node-types');
  if (fnRes.data && fnRes.data.ok) {
    const d = fnRes.data.data;
    console.log(`  节点: ${d.nodes.length} 种`);
    d.categories.forEach((c) => {
      const n = d.nodes.filter((x) => x.category === c.key).length;
      console.log(`    ${c.name}: ${n} 种`);
    });
  }

  /* ── 10. 图表类型 ── */
  console.log('\n── 10. 图表类型 ──');
  const ctRes = await call('GET', '/api/chart-types');
  if (ctRes.data && ctRes.data.ok) {
    const groups = {};
    ctRes.data.data.forEach((t) => {
      const g = t.group || '其他';
      if (!groups[g]) groups[g] = [];
      groups[g].push(t.name);
    });
    Object.keys(groups).forEach((g) => console.log(`  ${g}: ${groups[g].length} 种`));
  }

  /* ── 汇总 ── */
  console.log('\n════════ 审计结果 ════════');
  if (issues.length === 0) {
    console.log('✅ 未发现问题');
  } else {
    console.log(`⚠ 发现 ${issues.length} 个问题：`);
    issues.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  }

  process.exit(issues.length ? 1 : 0);
})().catch((e) => { console.error('审计异常:', e); process.exit(1); });