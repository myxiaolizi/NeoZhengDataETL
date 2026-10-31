'use strict';
/**
 * V9 统一验收脚本
 *
 * 用法：
 *   node scripts/v9-acceptance.js                 等同 --all
 *   node scripts/v9-acceptance.js --ai            AI 问数（真实 Mimo 调用，慢：2~5 分钟）
 *   node scripts/v9-acceptance.js --flow          节点时间同步 + 流程宽表
 *   node scripts/v9-acceptance.js --ui            菜单与标签样式（纯静态源码断言，无需浏览器/DB）
 *   node scripts/v9-acceptance.js --regress       历史回归
 *   node scripts/v9-acceptance.js --build         前端类型检查 + 构建
 *   node scripts/v9-acceptance.js --ui --flow     组合
 *
 * 退出码：0 = 全 PASS（SKIP 不算失败）；1 = 有 FAIL
 *
 * 铁律：
 *   - 本脚本**只读**：不写任何业务数据，不修改任何其他文件；
 *   - 子脚本不存在 → 记 SKIP，不记 FAIL（V9 期间允许有脚本尚未建好）；
 *   - 断言不放宽：某项 V9 改造没做到位就如实 FAIL；
 *   - 脚本内不出现任何 API Key 明文（凭据一律走 src/config.js 的 .env 读取）。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

/* .env 显式按 ROOT 加载：即使从别的 cwd 调用本脚本也能连上库 */
try { require('dotenv').config({ path: path.join(ROOT, '.env') }); } catch (_) { /* dotenv 缺失时退回 src/config 的默认加载 */ }

const argv = process.argv.slice(2);
const only = (k) => argv.includes('--' + k);
const GROUPS = ['ai', 'flow', 'ui', 'regress', 'build'];
const anyOnly = GROUPS.some(only);
const want = (k) => !anyOnly || only(k);

/* ══════════════════════════ 断言收集 ══════════════════════════ */

const results = [];

/**
 * 记录一条断言。
 * @param {string} group 分组名
 * @param {string} name  断言名
 * @param {boolean|'SKIP'} ok true=PASS / false=FAIL / 'SKIP'=跳过（不计失败）
 * @param {*} detail 证据（会截断后打印）
 */
function rec(group, name, ok, detail) {
  const state = ok === 'SKIP' ? 'SKIP' : (ok ? 'PASS' : 'FAIL');
  const d = detail === undefined || detail === null ? '' : String(detail);
  results.push({ group, name, state, detail: d.slice(0, 600) });
  console.log(`${state}  [${group}] ${name}${d ? '  | ' + d.slice(0, 300) : ''}`);
  return state === 'PASS';
}

function section(title) {
  console.log('\n══════════ ' + title + ' ══════════');
}

/** 把多行输出缩进后打印，作为证据留痕 */
function dump(label, text, maxLines) {
  const lines = String(text || '').replace(/\s+$/, '').split('\n');
  const keep = maxLines ? lines.slice(-maxLines) : lines;
  console.log(`    ── ${label} ──`);
  keep.forEach((l) => console.log('    ' + l));
}

/* ══════════════════════════ 子进程 ══════════════════════════ */

/**
 * 跑一个 node 子脚本。
 * @returns {{code:number, out:string, missing:boolean, rel:string}}
 *   missing=true 表示脚本文件不存在（调用方应记 SKIP）
 */
function runScript(rel, extraArgs) {
  const p = path.resolve(ROOT, rel);
  if (!fs.existsSync(p)) return { code: -1, out: '脚本不存在: ' + rel, missing: true, rel };
  try {
    const out = execFileSync(process.execPath, [p].concat(extraArgs || []), {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 600000,          // 600s：AI 真实调用 + 全表推导都够
      maxBuffer: 32 * 1024 * 1024,
      env: Object.assign({}, process.env, { FORCE_COLOR: '0' }),
    });
    return { code: 0, out: String(out || ''), missing: false, rel };
  } catch (e) {
    const out = String((e && (e.stdout || '')) || '') + String((e && (e.stderr || '')) || '');
    return { code: e && e.status === undefined ? -2 : (e && e.status), out: out || String(e && e.message), missing: false, rel };
  }
}

/** 跑任意命令（用于 npx / npm，Windows 下需要 shell 解析 .cmd） */
function runCmd(cmd, args, cwd) {
  try {
    const out = execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      timeout: 600000,
      maxBuffer: 32 * 1024 * 1024,
      shell: true,
      env: Object.assign({}, process.env, { FORCE_COLOR: '0' }),
    });
    return { code: 0, out: String(out || '') };
  } catch (e) {
    const out = String((e && (e.stdout || '')) || '') + String((e && (e.stderr || '')) || '');
    return { code: e && e.status === undefined ? -1 : (e && e.status), out: out || String(e && e.message) };
  }
}

/**
 * 统一「跑子脚本并断言退出码 0」；脚本缺失记 SKIP。
 * @returns {{code:number,out:string,missing:boolean}}
 */
function expectScript(group, label, rel, extraArgs) {
  const r = runScript(rel, extraArgs);
  if (r.missing) {
    rec(group, label, 'SKIP', '子脚本不存在（V9 期间允许）：' + rel);
    return r;
  }
  rec(group, label, r.code === 0, 'code=' + r.code + (r.code === 0 ? '' : ' | ' + tail(r.out, 4)));
  return r;
}

function tail(text, n) {
  return String(text || '').replace(/\s+$/, '').split('\n').slice(-(n || 4)).join(' / ').slice(0, 300);
}

/** TCP 探测本地端口是否在监听（用于判断 HTTP 类验收能否跑） */
function probePort(port, host, timeoutMs) {
  const net = require('net');
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (v) => { if (!done) { done = true; try { s.destroy(); } catch (_) {} resolve(v); } };
    s.setTimeout(timeoutMs || 1500);
    s.once('connect', () => finish(true));
    s.once('timeout', () => finish(false));
    s.once('error', () => finish(false));
    s.connect(port, host || '127.0.0.1');
  });
}

/** 给慢调用套一个硬超时，避免整体验收被单个卡死拖住 */
function withTimeout(promise, ms, label) {
  let timer = null;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`超时 ${ms}ms：${label}`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => { if (timer) clearTimeout(timer); });
}

/* ══════════════════════════ 源码断言工具 ══════════════════════════ */

/**
 * 去掉注释（字符串感知），用于「不得包含 X」类断言。
 *
 * 为什么必须去注释：V9 的改造说明本身就写在注释里，例如
 *   PageTabs.tsx 注释「用户管理却用了 `type="card"`」
 *   users.tsx    注释「旧实现是 <Tabs type="card">」
 *   settings.tsx 注释「删除了原来的 navCard」
 * 这些是**历史说明**，不是代码。若直接 includes 就会把「已经改对」的文件判成 FAIL。
 * 因此：正向断言（必须包含）跑原文，负向断言（不得包含）跑去注释后的代码。
 * 字符串字面量与模板串原样保留，所以真实的 type="card" 属性一定还在。
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let state = 'code';   // code | line | block | sq | dq | tpl
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : '';
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && c2 === '*') { state = 'block'; i += 2; continue; }
      if (c === "'") { state = 'sq'; out += c; i += 1; continue; }
      if (c === '"') { state = 'dq'; out += c; i += 1; continue; }
      if (c === '`') { state = 'tpl'; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; }
      i += 1; continue;
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') { state = 'code'; i += 2; continue; }
      if (c === '\n') out += c;      // 保留行号对齐
      i += 1; continue;
    }
    // 字符串 / 模板串
    if (c === '\\') { out += c + c2; i += 2; continue; }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'code';
    out += c; i += 1;
  }
  return out;
}

/** 读源码；返回 { raw, code, exists } */
function loadSource(rel) {
  const p = path.resolve(ROOT, rel);
  if (!fs.existsSync(p)) return { exists: false, raw: '', code: '', path: p, rel };
  const raw = fs.readFileSync(p, 'utf8');
  return { exists: true, raw, code: stripComments(raw), path: p, rel };
}

/** 正向断言：原文里必须命中 */
function mustContain(group, src, label, needle) {
  const re = needle instanceof RegExp ? needle : null;
  const hit = re ? re.test(src.raw) : src.raw.includes(String(needle));
  const shown = re
    ? ((src.raw.match(new RegExp(needle.source, needle.flags.includes('g') ? needle.flags : needle.flags + 'g')) || [])[0] || '(未命中)')
    : String(needle);
  rec(group, label, hit, hit ? '命中 ' + String(shown).slice(0, 120) : '未找到 ' + String(shown).slice(0, 120));
  return hit;
}

/** 负向断言：去注释后的代码里不得命中（注释里出现不算，会在 detail 里说明） */
function mustNotContain(group, src, label, needle) {
  const re = needle instanceof RegExp ? needle : null;
  const inCode = re ? re.test(src.code) : src.code.includes(String(needle));
  const inRaw = re ? re.test(src.raw) : src.raw.includes(String(needle));
  const shown = re ? String(needle.source) : String(needle);
  rec(group, label, !inCode,
    inCode
      ? '代码中仍存在 ' + shown.slice(0, 100)
      : (inRaw ? `代码中已无 ${shown.slice(0, 60)}（仅注释里有历史说明，符合预期）` : `代码与注释均无 ${shown.slice(0, 60)}`));
  return !inCode;
}

/** 从 routes.ts 里取出某条路由的对象字面量文本（路由项是扁平单行对象，无嵌套花括号） */
function routeBlock(routesRaw, routePath) {
  const esc = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('\\{[^{}]*?path:\\s*[\'"]' + esc + '[\'"][^{}]*?\\}', 's');
  const m = routesRaw.match(re);
  return m ? m[0] : null;
}

function routeField(block, field) {
  if (!block) return undefined;
  const m = block.match(new RegExp(field + ':\\s*(true|false|\'[^\']*\'|"[^"]*")'));
  if (!m) return undefined;
  const v = m[1];
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v.slice(1, -1);
}

/* ══════════════════════════ --ui：菜单与标签样式 ══════════════════════════ */

function testUI() {
  section('UI · 菜单分组 / 标签样式 / 版本号（纯静态源码断言）');

  /* ---------- 1. routes.ts ---------- */
  const rt = loadSource('frontend/src/routes.ts');
  if (!rt.exists) {
    rec('UI', 'frontend/src/routes.ts 存在', false, '文件缺失');
  } else {
    rec('UI', 'frontend/src/routes.ts 存在', true, rt.rel);

    // MENU_GROUPS 块
    const gStart = rt.raw.indexOf('export const MENU_GROUPS');
    const gBody = gStart >= 0 ? rt.raw.slice(gStart, rt.raw.indexOf('];', gStart) + 2) : '';
    const groupItems = [];
    const gRe = /\{\s*key:\s*'([^']*)'\s*,\s*title:\s*'([^']*)'\s*\}/g;
    let gm = null;
    while ((gm = gRe.exec(gBody)) !== null) groupItems.push({ key: gm[1], title: gm[2] });

    rec('UI', 'MENU_GROUPS 恰好 6 组', groupItems.length === 6,
      `实际 ${groupItems.length} 组：${groupItems.map((g) => g.key).join(',')}`);

    const wantTitles = ['', '数据接入', '数据管理', '数据分析', '数据治理', '系统管理'];
    const gotTitles = groupItems.map((g) => g.title);
    rec('UI', 'MENU_GROUPS title 依次为 ' + JSON.stringify(wantTitles),
      JSON.stringify(gotTitles) === JSON.stringify(wantTitles),
      '实际 ' + JSON.stringify(gotTitles));

    // 不存在 process / other 分组
    for (const dead of ['process', 'other']) {
      const keyUsed = groupItems.some((g) => g.key === dead);
      const routeUsed = new RegExp('group:\\s*[\'"]' + dead + '[\'"]').test(rt.code);
      rec('UI', `不存在 \`${dead}\` 分组（MENU_GROUPS 与任何路由都未使用）`,
        !keyUsed && !routeUsed,
        keyUsed ? `MENU_GROUPS 里仍有 key='${dead}'` : (routeUsed ? `仍有路由 group:'${dead}'` : `已彻底移除（注释里的历史说明不算）`));
    }

    // 逐条路由断言
    const routeCases = [
      ['/roles', { name: '角色权限', hideInMenu: true }],
      ['/profile', { name: '个人中心', hideInMenu: true }],
      ['/flows', { name: '数据处理', group: 'manage' }],
      ['/dashboard', { name: '首页概览' }],
      ['/projects', { name: '项目管理' }],
      ['/forms', { name: '表单管理' }],
      ['/intro', { group: 'system' }],
      ['/help', { group: 'system' }],
      ['/datasets', { group: 'manage' }],
      ['/datasources', { group: 'manage' }],
      ['/reports', { group: 'analysis' }],
      ['/shares', { group: 'analysis' }],
      ['/ai', { group: 'analysis' }],
    ];
    for (const [rp, expect] of routeCases) {
      const block = routeBlock(rt.code, rp);
      if (!block) {
        rec('UI', `路由 ${rp} 存在`, false, '未在 ROUTES 中找到该 path 的对象字面量');
        continue;
      }
      for (const [field, want] of Object.entries(expect)) {
        const got = routeField(block, field);
        rec('UI', `${rp} 的 ${field} = ${JSON.stringify(want)}`,
          got === want, `实际 ${got === undefined ? '(未声明)' : JSON.stringify(got)}`);
      }
    }
  }

  /* ---------- 2. PageTabs.tsx ---------- */
  const pt = loadSource('frontend/src/components/PageTabs.tsx');
  rec('UI', 'frontend/src/components/PageTabs.tsx 存在', pt.exists ? true : false, pt.exists ? pt.rel : '文件缺失');
  if (pt.exists) {
    rec('UI', 'PageTabs.tsx 默认导出 PageTabs',
      /export\s+default\s+(function\s+)?PageTabs\b/.test(pt.code)
      || (/export\s+default\s+PageTabs\b/.test(pt.code)),
      (pt.raw.match(/export\s+default[^\n]*/) || ['(未找到)'])[0].slice(0, 100));
    rec('UI', 'PageTabs.tsx 具名导出 PageTabTag',
      /export\s+(function|const)\s+PageTabTag\b/.test(pt.code) || /export\s*\{[^}]*\bPageTabTag\b/.test(pt.code),
      (pt.raw.match(/export\s+(?:function|const)\s+PageTabTag[^\n]*/) || ['(未找到)'])[0].slice(0, 80));
    rec('UI', 'PageTabs.tsx 具名导出 pageTabLabel',
      /export\s+(function|const)\s+pageTabLabel\b/.test(pt.code) || /export\s*\{[^}]*\bpageTabLabel\b/.test(pt.code),
      (pt.raw.match(/export\s+(?:function|const)\s+pageTabLabel[^\n]*/) || ['(未找到)'])[0].slice(0, 80));
    mustNotContain('UI', pt, 'PageTabs.tsx 不含 type="card"（必须是 line 型）', 'type="card"');
  }

  /* ---------- 3. users.tsx ---------- */
  const us = loadSource('frontend/src/pages/users.tsx');
  rec('UI', 'frontend/src/pages/users.tsx 存在', us.exists ? true : false, us.exists ? us.rel : '文件缺失');
  if (us.exists) {
    mustContain('UI', us, 'users.tsx import 了 @/components/PageTabs', /import\s+PageTabs[\s\S]{0,120}?from\s+'@\/components\/PageTabs'/);
    mustContain('UI', us, 'users.tsx 使用 <PageTabs', '<PageTabs');
    mustNotContain('UI', us, 'users.tsx 不含 type="card"', 'type="card"');
  }

  /* ---------- 4. settings.tsx ---------- */
  const st = loadSource('frontend/src/pages/settings.tsx');
  rec('UI', 'frontend/src/pages/settings.tsx 存在', st.exists ? true : false, st.exists ? st.rel : '文件缺失');
  if (st.exists) {
    mustContain('UI', st, 'settings.tsx import 了 @/components/PageTabs', /import\s+PageTabs[\s\S]{0,120}?from\s+'@\/components\/PageTabs'/);
    mustContain('UI', st, 'settings.tsx 使用 <PageTabs', '<PageTabs');
    mustContain('UI', st, 'settings.tsx 含 subTabs={<PageTabs', 'subTabs={<PageTabs');
    mustNotContain('UI', st, 'settings.tsx 不含 navCard（旧左侧导航已删）', 'navCard');
    mustContain('UI', st, 'settings.tsx 含 __FE_VERSION__（前端构建版本）', '__FE_VERSION__');
    mustContain('UI', st, 'settings.tsx 含 __BE_VERSION__（后端服务版本）', '__BE_VERSION__');
    rec('UI', 'settings.tsx 含「关于」标签', /['"]关于['"]/.test(st.code),
      (st.raw.match(/[^\n]*['"]关于['"][^\n]*/) || ['(未找到)'])[0].trim().slice(0, 120));
  }

  /* ---------- 5. intro.tsx ---------- */
  const it = loadSource('frontend/src/pages/intro.tsx');
  rec('UI', 'frontend/src/pages/intro.tsx 存在', it.exists ? true : false, it.exists ? it.rel : '文件缺失');
  if (it.exists) {
    mustContain('UI', it, 'intro.tsx 含源码仓库地址 github.com/myxiaolizi/NeoZhengDataETL',
      'github.com/myxiaolizi/NeoZhengDataETL');
    rec('UI', 'intro.tsx 含 CHANGELOG_SUMMARY 或「更新记录」',
      it.raw.includes('CHANGELOG_SUMMARY') || it.raw.includes('更新记录'),
      `CHANGELOG_SUMMARY=${it.raw.includes('CHANGELOG_SUMMARY')} 更新记录=${it.raw.includes('更新记录')}`);
    mustNotContain('UI', it, 'intro.tsx 不渲染 site.footer（判据 /\\{site\\.footer\\s*\\?/ 不出现）',
      /\{\s*site\.footer\s*\?/);
  }

  /* ---------- 6. app.ts 版本号 ---------- */
  const ap = loadSource('frontend/src/stores/app.ts');
  rec('UI', 'frontend/src/stores/app.ts 存在', ap.exists ? true : false, ap.exists ? ap.rel : '文件缺失');
  if (ap.exists) {
    const m = ap.code.match(/export\s+const\s+APP_VERSION\s*=\s*'([^']*)'/);
    rec('UI', "app.ts APP_VERSION = 'V9.0'", !!m && m[1] === 'V9.0',
      m ? `实际 '${m[1]}'` : '未找到 APP_VERSION 导出');
  }

  /* ---------- 7. package.json 版本 + 无 BOM ---------- */
  for (const rel of ['package.json', 'frontend/package.json']) {
    const p = path.resolve(ROOT, rel);
    if (!fs.existsSync(p)) { rec('UI', `${rel} 存在`, false, '文件缺失'); continue; }
    const buf = fs.readFileSync(p);
    let ver = '(解析失败)';
    try { ver = String(JSON.parse(buf.toString('utf8')).version); } catch (e) { ver = '(JSON 解析失败: ' + e.message.slice(0, 60) + ')'; }
    rec('UI', `${rel} version = 9.0.0`, ver === '9.0.0', '实际 ' + ver);
    const bom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
    rec('UI', `${rel} 首字节不是 BOM`, !bom,
      'first3=' + Array.from(buf.slice(0, 3)).map((b) => b.toString(16).padStart(2, '0')).join(' '));
  }

  /* ---------- 8. vite.config.ts define ---------- */
  const vc = loadSource('frontend/vite.config.ts');
  rec('UI', 'frontend/vite.config.ts 存在', vc.exists ? true : false, vc.exists ? vc.rel : '文件缺失');
  if (vc.exists) {
    const dStart = vc.code.indexOf('define:');
    const dBody = dStart >= 0 ? vc.code.slice(dStart, dStart + 600) : '';
    rec('UI', 'vite.config.ts 的 define 注入 __FE_VERSION__',
      dBody.includes('__FE_VERSION__'), dBody.split('\n').find((l) => l.includes('__FE_VERSION__')) || '(define 块内未找到)');
    rec('UI', 'vite.config.ts 的 define 注入 __BE_VERSION__',
      dBody.includes('__BE_VERSION__'), dBody.split('\n').find((l) => l.includes('__BE_VERSION__')) || '(define 块内未找到)');
  }

  /* ---------- 9. server.js 启动横幅 ---------- */
  const sv = loadSource('src/server.js');
  rec('UI', 'src/server.js 存在', sv.exists ? true : false, sv.exists ? sv.rel : '文件缺失');
  if (sv.exists) {
    const m = sv.raw.match(/[^\n]*v9\.0[^\n]*/i);
    rec('UI', 'src/server.js 启动横幅含 v9.0', !!m, m ? m[0].trim().slice(0, 120) : '未找到 v9.0 字样');
  }
}

/* ══════════════════════════ --flow：节点时间同步 ══════════════════════════ */

const TIME_FIELDS = [
  '单据提交时间', '策略开通时间', '实施对接时间', '对接审核时间',
  '客服处理时间', '客户培训时间', '连锁使用时间', '策略审核时间',
];
const WIDE = 'jdywh_crm_signing_v7';
const P16 = 'jdywh_parsed_16';
const NODE215_DATA_ID = '6ae60b13774450e960817dd2';
const NODE215_SN = '215';
const NODE215_EXPECT = '2026-10-31 23:51:01';

async function testFlow() {
  section('FLOW · 节点时间同步（进入下一节点自动同步上一节点提交时间）');

  let db = null;
  try {
    db = require('../src/db');
    await withTimeout(db.ping(), 15000, '数据库连接');
  } catch (e) {
    rec('FLOW', '数据库可连接（后续 DB 断言依赖）', false, e.message.slice(0, 200));
    await runFlowScripts();
    return;
  }
  rec('FLOW', '数据库可连接', true, 'db.ping() OK');

  try {
    /* ---------- 1. 按 COLUMN_COMMENT 动态解析 parsed_16 的 8 个时间列 ---------- */
    const cols = await db.query(
      `SELECT column_name, column_comment FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ?`, [P16]
    );
    const byComment = new Map();
    for (const r of cols) {
      const c = String(r.COLUMN_COMMENT || '').trim();
      if (c && !byComment.has(c)) byComment.set(c, r.COLUMN_NAME);
    }
    const colOf = {};
    const unresolved = [];
    for (const f of TIME_FIELDS) {
      const col = byComment.get(`${f}(解析)`) || byComment.get(f);
      if (col) colOf[f] = col; else unresolved.push(f);
    }
    rec('FLOW', `按 COLUMN_COMMENT='X(解析)' 动态解析出 8 个时间列（不硬编码列名）`,
      Object.keys(colOf).length === 8,
      Object.keys(colOf).length === 8
        ? TIME_FIELDS.map((f) => `${f}→${colOf[f]}`).join(', ')
        : '未解析到：' + unresolved.join(','));

    /* ---------- 2. 宽表 215 的「实施对接时间」 ---------- */
    const w215 = await db.queryOne(
      `SELECT * FROM \`${WIDE}\` WHERE \`流水号\` = ? LIMIT 1`, [NODE215_SN]
    );
    rec('FLOW', `宽表 ${WIDE} 存在流水号 215 的行`, !!w215, w215 ? '已找到' : '未找到');
    if (w215) {
      const got = String(w215['实施对接时间'] === null || w215['实施对接时间'] === undefined ? '' : w215['实施对接时间']);
      rec('FLOW', `215 宽表「实施对接时间」= ${NODE215_EXPECT}（用户投诉：已进入对接审核却没有实施对接时间）`,
        got.startsWith(NODE215_EXPECT), `实际 ${JSON.stringify(got)}`);
      // 顺带把 8 列现值打印出来做证据
      console.log('    ── 215 宽表 8 个时间列现值 ──');
      TIME_FIELDS.forEach((f) => {
        const has = f in w215;
        console.log(`      ${f.padEnd(8, '　')} = ${JSON.stringify(has ? w215[f] : null)}${has ? '' : '   (宽表无此列)'}`);
      });
    }

    /* ---------- 3. parsed_16 同一 data_id 的 8 个时间列 ---------- */
    if (Object.keys(colOf).length === 8) {
      const p215 = await db.queryOne(
        `SELECT jdy_data_id, ${TIME_FIELDS.map((f) => `\`${colOf[f]}\` AS \`${f}\``).join(', ')}
           FROM \`${P16}\` WHERE jdy_data_id = ? LIMIT 1`, [NODE215_DATA_ID]
      );
      rec('FLOW', `parsed_16 存在 data_id=${NODE215_DATA_ID} 的行`, !!p215, p215 ? '已找到' : '未找到');
      if (p215) {
        console.log('    ── parsed_16 同一 data_id 的 8 个时间列 ──');
        TIME_FIELDS.forEach((f) => {
          const v = p215[f];
          console.log(`      ${f.padEnd(8, '　')} (${colOf[f]}) = ${JSON.stringify(v === undefined ? null : v)}`);
        });
        const pImpl = String(p215['实施对接时间'] === null || p215['实施对接时间'] === undefined ? '' : p215['实施对接时间']);
        rec('FLOW', 'parsed_16 与宽表的「实施对接时间」一致（同步链路打通）',
          !!w215 && pImpl.startsWith(String(w215['实施对接时间'] || '').slice(0, 19)) && pImpl !== '',
          `parsed_16=${JSON.stringify(pImpl)} 宽表=${JSON.stringify(w215 && w215['实施对接时间'])}`);
      }

      /* ---------- 4. 非空率不倒退：宽表 ≥ parsed_16 ---------- */
      const wideTotal = Number((await db.queryOne(`SELECT COUNT(*) AS n FROM \`${WIDE}\``)).n);
      const p16Total = Number((await db.queryOne(`SELECT COUNT(*) AS n FROM \`${P16}\``)).n);
      rec('FLOW', '两表行数可读（用于算非空率）', wideTotal > 0 && p16Total > 0,
        `宽表 ${wideTotal} 行 / parsed_16 ${p16Total} 行`);

      const wideSel = TIME_FIELDS.map((f) => `SUM(CASE WHEN \`${f}\` IS NOT NULL AND \`${f}\` <> '' THEN 1 ELSE 0 END) AS \`${f}\``).join(', ');
      const p16Sel = TIME_FIELDS.map((f) => `SUM(CASE WHEN \`${colOf[f]}\` IS NOT NULL AND \`${colOf[f]}\` <> '' THEN 1 ELSE 0 END) AS \`${f}\``).join(', ');
      const wCounts = await db.queryOne(`SELECT ${wideSel} FROM \`${WIDE}\``);
      const pCounts = await db.queryOne(`SELECT ${p16Sel} FROM \`${P16}\``);

      const regress = [];
      console.log('    ── 8 个时间列非空数对比（宽表 vs parsed_16）──');
      for (const f of TIME_FIELDS) {
        const w = Number(wCounts[f] || 0);
        const p = Number(pCounts[f] || 0);
        const wRate = wideTotal ? w / wideTotal : 0;
        const pRate = p16Total ? p / p16Total : 0;
        const okOne = wRate >= pRate;
        if (!okOne) regress.push(`${f} 宽表 ${w}/${wideTotal}(${(wRate * 100).toFixed(1)}%) < parsed_16 ${p}/${p16Total}(${(pRate * 100).toFixed(1)}%)`);
        console.log(`      ${f.padEnd(8, '　')} 宽表=${String(w).padStart(3)}/${wideTotal} (${(wRate * 100).toFixed(1).padStart(5)}%)   parsed_16=${String(p).padStart(3)}/${p16Total} (${(pRate * 100).toFixed(1).padStart(5)}%)   ${okOne ? 'OK' : 'REGRESS'}`);
        rec('FLOW', `「${f}」宽表非空率 ≥ parsed_16（不倒退）`, okOne,
          `宽表 ${w}/${wideTotal}=${(wRate * 100).toFixed(1)}% vs parsed_16 ${p}/${p16Total}=${(pRate * 100).toFixed(1)}%`);
      }
      rec('FLOW', '宽表 8 个时间列非空率整体 ≥ parsed_16 对应值（不倒退）',
        regress.length === 0, regress.length ? regress.join('; ') : '8/8 列均不倒退');
    }
  } catch (e) {
    rec('FLOW', 'DB 断言执行过程无异常', false, (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)).slice(0, 300));
  } finally {
    try { await db.close(); } catch (_) { /* ignore */ }
  }

  await runFlowScripts();
}

/** --flow 依赖的子脚本（缺失记 SKIP） */
async function runFlowScripts() {
  section('FLOW · 子脚本复核');
  const items = [
    ['V9 节点时间自测 v9-node-times.js（100 断言）', 'scripts/v9-node-times.js'],
    ['V8 流程宽表复核 v8-flow-verify.js（31 断言）', 'scripts/v8-flow-verify.js'],
    ['V8 数据对账复核 v8-reconcile-verify.js', 'scripts/v8-reconcile-verify.js'],
    ['V7 流程引擎 v7-flow-join.js（132 断言）', 'scripts/v7-flow-join.js'],
    ['V7 装配 dry-run v7-flow-assembly-dryrun.js（11 断言）', 'scripts/v7-flow-assembly-dryrun.js'],
    ['V7 推送接线 v7-flow-push-wire.js（9 断言）', 'scripts/v7-flow-push-wire.js'],
  ];
  for (const [label, rel] of items) {
    const r = expectScript('FLOW', label + ' 退出码 0', rel);
    if (!r.missing && r.code === 0) dump(rel + ' 输出尾部', r.out, 6);
  }
}

/* ══════════════════════════ --ai：AI 问数 ══════════════════════════ */

const AI_CASES = [
  { q: '查询当前有多少客户已经完成了流程', want: 4 },
  { q: '有多少客户完成了流程', want: 4 },
  { q: '统计流程状态为流转完成的数量', want: 4 },
  { q: '当前有多少客户', want: 97 },
];

async function testAI() {
  section('AI · 问数（真实 Mimo 调用，单次 3~60s，请耐心等待）');

  let ai = null;
  try {
    ai = require('../src/ai');
    rec('AI', "require('../src/ai') 成功且导出 ask()", typeof ai.ask === 'function', typeof ai.ask);
  } catch (e) {
    rec('AI', "require('../src/ai') 成功且导出 ask()", false, e.message.slice(0, 200));
  }

  /* ---------- 1. 四例真实问数 ---------- */
  if (ai) {
    for (const c of AI_CASES) {
      const t0 = Date.now();
      try {
        const r = await withTimeout(
          ai.ask(c.q, { scope: [{ kind: 'project', id: 16 }], userId: 1, maxRowsCap: 500 }),
          240000, `ai.ask(${c.q})`
        );
        const ms = Date.now() - t0;
        const rows = Array.isArray(r.rows) ? r.rows : [];
        rec('AI', `问数「${c.q}」返回数据行`, r.ok === true && Number(r.rowCount) > 0,
          `rowCount=${r.rowCount} rows=${rows.length} model=${r.model} ${ms}ms`);

        // 列名由模型生成、不固定：只要结果里**存在某个数值等于期望值**即算对
        const nums = [];
        for (const row of rows) {
          for (const v of Object.values(row || {})) {
            const n = Number(v);
            if (v !== null && v !== '' && Number.isFinite(n)) nums.push(n);
          }
        }
        rec('AI', `问数「${c.q}」结果含期望值 ${c.want}`, nums.includes(c.want),
          `首行=${JSON.stringify(rows[0] || {}).slice(0, 180)} 数值集合=${JSON.stringify([...new Set(nums)].slice(0, 12))}`);
        console.log(`        SQL: ${String(r.sql || '').replace(/\s+/g, ' ').slice(0, 220)}`);
      } catch (e) {
        rec('AI', `问数「${c.q}」返回数据行`, false, `${Date.now() - t0}ms 后异常：${String(e.message).split('\n')[0].slice(0, 200)}`);
        rec('AI', `问数「${c.q}」结果含期望值 ${c.want}`, false, '上一步取数失败，无结果可比对');
      }
    }
  }

  /* ---------- 2. V9 AI 值域自测 ---------- */
  section('AI · 子脚本复核');
  const vd = expectScript('AI', 'V9 AI 值域自测 v9-ai-valuedomain.js（51 断言）退出码 0', 'scripts/v9-ai-valuedomain.js');
  if (!vd.missing) dump('v9-ai-valuedomain.js 输出尾部', vd.out, 8);

  /* ---------- 3. V8 AI 后端自测：退出码 0 且 PASS 10x / FAIL 0 ---------- */
  const be = runScript('scripts/v8-ai-backend.js');
  if (be.missing) {
    rec('AI', 'V8 AI 后端自测 v8-ai-backend.js 存在', 'SKIP', '子脚本不存在：scripts/v8-ai-backend.js');
  } else {
    rec('AI', 'v8-ai-backend.js 退出码 0', be.code === 0, 'code=' + be.code + (be.code === 0 ? '' : ' | ' + tail(be.out, 4)));
    // 取「汇总行」而不是首行 banner（banner 也含「V8 AI 后端自测」字样）
    const sumLine = (be.out.match(/V8 AI 后端自测[：:]\s*PASS[^\n]*/) || be.out.match(/V8 AI 后端自测[^\n]*/) || [''])[0];
    const m = be.out.match(/PASS\s+(10\d)\s*[，,]\s*FAIL\s+0\b/);
    rec('AI', 'v8-ai-backend.js 输出含 PASS 10x / FAIL 0（103 断言全通过）',
      !!m, sumLine || tail(be.out, 3));
    dump('v8-ai-backend.js 输出尾部', be.out, 6);
  }

  /* ---------- 4. V4.1 AI 回归 ---------- */
  expectScript('AI', 'V4.1 AI 回归 v41-ai-backend.js（10 断言）退出码 0', 'scripts/v41-ai-backend.js');

  /* ---------- 5. V8 统一验收 --ai（依赖 8781 端口的 HTTP） ---------- */
  const port = Number(process.env.PORT) || 8781;
  const up = await probePort(port, '127.0.0.1', 2000);
  if (!up) {
    rec('AI', `v8-acceptance.js --ai 退出码 0`, 'SKIP',
      `本地服务 127.0.0.1:${port} 未启动，该脚本的分享链路走 HTTP 会直接报错；请先 node src/server.js 再重跑本项`);
  } else {
    const r = expectScript('AI', 'V8 统一验收 v8-acceptance.js --ai 退出码 0', 'scripts/v8-acceptance.js', ['--ai']);
    if (!r.missing) dump('v8-acceptance.js --ai 输出尾部', r.out, 10);
  }
}

/* ══════════════════════════ --regress：历史回归 ══════════════════════════ */

function testRegress() {
  section('REGRESS · 历史版本回归');
  const items = [
    ['V6.1 数据明细筛选 v61-data-filter.js', 'scripts/v61-data-filter.js'],
    ['V4.1 数据集 SQL v41-dataset-sql.js', 'scripts/v41-dataset-sql.js'],
    ['V4.1 数据集 SQL（DB）v41-dataset-sql-db.js', 'scripts/v41-dataset-sql-db.js'],
    ['V8 AI 后端自测 v8-ai-backend.js', 'scripts/v8-ai-backend.js'],
    ['V4.1 AI 回归 v41-ai-backend.js', 'scripts/v41-ai-backend.js'],
  ];
  for (const [label, rel] of items) {
    const r = expectScript('REGRESS', label + ' 退出码 0', rel);
    if (!r.missing && r.code === 0) dump(rel + ' 输出尾部', r.out, 4);
  }
}

/* ══════════════════════════ --build：前端类型检查与构建 ══════════════════════════ */

function testBuild() {
  section('BUILD · 前端类型检查与构建');
  const fe = path.resolve(ROOT, 'frontend');
  if (!fs.existsSync(fe)) {
    rec('BUILD', 'frontend 目录存在', false, '目录缺失：' + fe);
    return;
  }
  rec('BUILD', 'frontend 目录存在', true, fe);

  const tsc = runCmd('npx', ['tsc', '--noEmit'], fe);
  if (tsc.code === 0) {
    rec('BUILD', 'cd frontend && npx tsc --noEmit 退出码 0', true, '0 类型错误');
  } else {
    // 失败时优先给出「文件(行,列): error TSxxxx」定位行，比截断的堆栈尾巴更有用
    const errLines = String(tsc.out).split('\n').filter((l) => /error TS\d+/.test(l)).map((l) => l.trim());
    rec('BUILD', 'cd frontend && npx tsc --noEmit 退出码 0', false,
      `code=${tsc.code} 类型错误 ${errLines.length} 处`
      + (errLines.length ? '：' + errLines.slice(0, 6).map((l) => l.slice(0, 160)).join(' ;; ') : ' | ' + tsc.out.slice(-500)));
    if (errLines.length) dump('tsc 错误定位', errLines.join('\n'), 20);
  }

  const b = runCmd('npm', ['run', 'build'], fe);
  rec('BUILD', 'cd frontend && npm run build 退出码 0', b.code === 0,
    b.code === 0 ? ((b.out.match(/built in [\d.]+s/) || ['构建成功'])[0]) : 'code=' + b.code + ' | ' + b.out.slice(-700));

  const distIndex = path.resolve(fe, 'dist', 'index.html');
  rec('BUILD', 'frontend/dist/index.html 已产出', fs.existsSync(distIndex), distIndex);
}

/* ══════════════════════════ main ══════════════════════════ */

(async () => {
  const t0 = Date.now();
  console.log('══════════════════════════════════════════════════════════════');
  console.log(' V9 统一验收 · Neo Zheng DataETL');
  console.log(' 开始时间：' + new Date().toISOString() + '   Node ' + process.version);
  console.log(' 验收范围：' + (anyOnly ? GROUPS.filter(only).map((g) => '--' + g).join(' ') : '--all（全部）'));
  console.log('══════════════════════════════════════════════════════════════');

  try {
    if (want('ui')) testUI();
    if (want('flow')) await testFlow();
    if (want('ai')) await testAI();
    if (want('regress')) testRegress();
    if (want('build')) testBuild();
  } catch (e) {
    rec('MAIN', '验收流程本身无异常', false, (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)).slice(0, 400));
  }

  const pass = results.filter((r) => r.state === 'PASS').length;
  const fail = results.filter((r) => r.state === 'FAIL').length;
  const skip = results.filter((r) => r.state === 'SKIP').length;

  console.log('\n══════════════ 汇总 ══════════════');
  if (fail) {
    console.log('失败项（' + fail + '）：');
    results.filter((r) => r.state === 'FAIL')
      .forEach((r) => console.log('  ✗ [' + r.group + '] ' + r.name + ' | ' + r.detail));
  }
  if (skip) {
    console.log('跳过项（' + skip + '，不计失败）：');
    results.filter((r) => r.state === 'SKIP')
      .forEach((r) => console.log('  - [' + r.group + '] ' + r.name + ' | ' + r.detail));
  }
  console.log(`合计 ${results.length} 项：PASS ${pass} / FAIL ${fail}（另 SKIP ${skip}）；耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const outDir = path.resolve(ROOT, '_work', 'v9', 'reports');
  let reportPath = '';
  try {
    fs.mkdirSync(outDir, { recursive: true });
    reportPath = path.join(outDir, 'acceptance-' + Date.now() + '.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      at: new Date().toISOString(),
      node: process.version,
      scope: anyOnly ? GROUPS.filter(only) : ['all'],
      total: results.length, pass, fail, skip,
      elapsedMs: Date.now() - t0,
      results,
    }, null, 1), 'utf8');
    console.log('报告已写入：' + path.relative(ROOT, reportPath));
  } catch (e) {
    console.log('[WARN] 报告写入失败：' + e.message);
  }

  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('V9 验收脚本异常', e && e.stack ? e.stack : e);
  process.exit(1);
});
