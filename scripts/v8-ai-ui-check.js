'use strict';
/**
 * V8 AI 问数前端 · 自检脚本（WS2 交付物）
 *
 * 定位：**源码级 + 构建产物级断言**，不依赖浏览器，任何机器上 `node scripts/v8-ai-ui-check.js`
 * 都能跑（退出码 0 = 全通过，1 = 有失败）。
 *
 * 覆盖（30 条断言）：
 *   A. 路由与公开访问        —— /a/:token 隐藏路由、App.tsx 公开路由、/a/ 前缀跳过 fetchUser
 *   B. 公开接口安全性        —— 必须裸 fetch，禁止经 api.*（否则未登录会被 401 踢回登录）
 *   C. 公开接口响应解包      —— 后端 { ok, data:{} } 必须解包（这是「0 个数据来源」bug 的根因）
 *   D. 范围选择与禁用逻辑    —— 未选范围禁用发送/分享、坏源置灰、maxSources 取服务端值
 *   E. 分享能力              —— 创建/列表/启停/删除封装、分享弹窗字段、复制链接
 *   F. 公开页移动端要求      —— safe-area、字号 ≥14px、点击区 ≥40px、max-width 900、气泡左右
 *   G. 错误提示文案          —— 密码不正确 / 已过期 / 已被停用 / 不存在 / 访问过于频繁
 *   H. 构建产物              —— dist 存在、ai-share chunk 存在、无 BOM 的 package.json
 *
 * 用法：cd C:\Data\DSH\jdy-push && node scripts/v8-ai-ui-check.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FE = path.join(ROOT, 'frontend');
const SRC = path.join(FE, 'src');

/**
 * 去掉注释内容（行注释 // 、块注释 /* *\/ 、JSX {/* *\/}），
 * 只保留真实代码 —— 否则「文档里写了 BasicLayout / localStorage」这类
 * 说明性文字会造成断言假阳性/假阴性。
 */
function stripComments(text) {
  if (!text) return '';
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
}

/** 从文本中某声明的**实际定义处**开始截取（跳过注释里提前出现的同名文字） */
function fromDecl(text, decl, needle, window = 400) {
  if (!text) return false;
  const i = text.indexOf(decl);
  if (i < 0) return false;
  return text.slice(i, i + window).includes(needle);
}

/* ══════════ 断言框架 ══════════ */

let pass = 0;
let fail = 0;
const failures = [];
let group = '';

function section(name) {
  group = name;
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 56 - name.length))}`);
}

function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    fail++;
    failures.push(`[${group}] ${name}${detail ? `  → ${detail}` : ''}`);
    console.log(`  ❌ ${name}${detail ? `  → ${detail}` : ''}`);
  }
  return cond;
}

/** 读文本（统一去 BOM，避免编码问题干扰匹配） */
function read(rel, base = SRC) {
  const p = path.join(base, rel);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
}

/** 断言文件存在 */
function exists(rel, base = SRC) {
  return fs.existsSync(path.join(base, rel));
}

/** 从 i 处开始截取一段窗口（用于「A 后面 N 字符内必须出现 B」这类邻近断言） */
function near(text, anchor, needle, window = 600) {
  if (!text) return false;
  const i = text.indexOf(anchor);
  if (i < 0) return false;
  return text.slice(i, i + window).includes(needle);
}

/** 统计出现次数 */
function count(text, needle) {
  if (!text) return 0;
  return text.split(needle).length - 1;
}

function main() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log(' V8 AI 问数前端 · 自检（源码断言 + 构建产物断言）');
  console.log(` 工作区：${ROOT}`);
  console.log('════════════════════════════════════════════════════════════════');

  const aiApi = read('api/ai.ts');
  const aiPage = read('pages/ai.tsx');
  const aiShare = read('pages/ai-share.tsx');
  const appTsx = read('App.tsx');
  const routesTs = read('routes.ts');

  /* ═══════════ A. 文件存在性 ═══════════ */
  section('A. 交付文件');
  ok('frontend/src/api/ai.ts 存在', !!aiApi);
  ok('frontend/src/pages/ai.tsx 存在', !!aiPage);
  ok('frontend/src/pages/ai-share.tsx 存在（公开页）', !!aiShare);
  ok('frontend/src/App.tsx 存在', !!appTsx);
  ok('frontend/src/routes.ts 存在', !!routesTs);

  /* ═══════════ B. 路由与公开访问 ═══════════ */
  section('B. 路由与公开访问（/a/:token 不触发登录探测）');

  ok(
    'routes.ts 为 /a/:token 登记隐藏路由（hideInMenu）',
    near(routesTs, "path: '/a/:token'", 'hideInMenu: true', 220),
    '缺 hideInMenu 会出现在左侧菜单'
  );
  ok(
    'routes.ts 标记 /a/:token 支持移动端（mobile: true）',
    near(routesTs, "path: '/a/:token'", 'mobile: true', 220)
  );
  ok(
    'routes.ts 定义 PUBLIC_PREFIXES 含 /a/',
    fromDecl(routesTs, 'export const PUBLIC_PREFIXES', "'/a/'", 200),
    'App.tsx 依赖它短路 fetchUser'
  );
  ok(
    'App.tsx 用 PUBLIC_PREFIXES 跳过登录态探测',
    !!appTsx && appTsx.includes('PUBLIC_PREFIXES.some')
  );
  ok(
    'App.tsx 公开路由区注册 /a/:token（不套 BasicLayout/RequireAuth）',
    near(appTsx, '<Route path="/a/:token"', 'AiShare', 160) ||
      (!!appTsx && /Route path="\/a\/:token" element=\{<AiShare\s*\/>\}/.test(appTsx))
  );
  ok(
    'App.tsx 懒加载 ai-share 页面',
    !!appTsx && appTsx.includes("import('@/pages/ai-share')")
  );
  ok(
    'App.tsx 的 /a/:token 路由位于业务路由（path="*" + RequireAuth）之前',
    (() => {
      if (!appTsx) return false;
      const pub = appTsx.indexOf('<Route path="/a/:token"');
      const guard = appTsx.indexOf('<RequireAuth>');
      return pub > 0 && guard > 0 && pub < guard;
    })(),
    '顺序反了会被登录守卫拦住'
  );
  ok(
    'ai-share.tsx 不引入 BasicLayout（独立布局，不套后台外壳）',
    !!aiShare && !stripComments(aiShare).includes('BasicLayout')
  );

  /* ═══════════ C. 公开接口必须裸 fetch + 解包 data ═══════════ */
  section('C. 公开接口安全性与响应解包');

  ok(
    'api/ai.ts 公开接口用裸 fetch（fetch(PUBLIC_AI_BASE ...)）',
    !!aiApi && /fetch\(\s*PUBLIC_AI_BASE\s*\+/.test(aiApi)
  );
  ok(
    'api/ai.ts 公开接口不经过 api.* 客户端（无 api.get/post 到 public 前缀）',
    !!aiApi && !/api\.(get|post|patch|delete)<[^>]*>\(\s*[`'"]\/public/.test(aiApi)
  );
  ok(
    '公开请求显式解包 { ok, data }（修复「0 个数据来源」的根因）',
    !!aiApi && aiApi.includes('raw.data') && /const inner\s*=/.test(aiApi),
    '裸 fetch 不会像 api.* 那样自动取 data'
  );
  ok(
    '公开 meta 用 needPassword && sources.length===0 判未解锁',
    !!aiApi && /const locked\s*=\s*needPassword\s*&&\s*sources\.length\s*===\s*0/.test(aiApi)
  );
  ok(
    '公开页把密码存 sessionStorage 而非 localStorage',
    (() => {
      const code = stripComments(aiShare);
      /* 真实读写调用，而不是注释里提到的名字 */
      const usesSession = /sessionStorage\.(get|set|remove)Item/.test(code);
      const usesLocal = /localStorage\.(get|set|remove)Item/.test(code);
      return usesSession && !usesLocal;
    })(),
    '需求建议 sessionStorage，避免长期驻留'
  );
  ok(
    '公开页导入了 publicAiShareMeta / publicAiShareAsk',
    !!aiShare && aiShare.includes('publicAiShareMeta') && aiShare.includes('publicAiShareAsk')
  );

  /* ═══════════ D. 范围选择与禁用逻辑 ═══════════ */
  section('D. /ai 页数据范围选择与禁用逻辑');

  ok(
    'ai.tsx 调用 getAiScopeOptions 拉取四类来源',
    !!aiPage && aiPage.includes('getAiScopeOptions')
  );
  ok(
    'ai.tsx 按 数据集/数据项目/邮件推送/流程产出 四类分组',
    !!aiPage && aiPage.includes('SCOPE_KINDS') && aiPage.includes('SCOPE_KIND_LABEL')
  );
  ok(
    'ai.tsx 发送按钮在未选范围时禁用（disabled={... || !scope.length}）',
    !!aiPage && /disabled=\{[^}]*!\s*scope\.length[^}]*\}/.test(aiPage),
    '需求：未选范围禁止发送'
  );
  ok(
    'ai.tsx 分享按钮在未选范围时禁用',
    !!aiPage && /icon=\{<ShareAltOutlined\s*\/>\}[\s\S]{0,240}disabled=\{!\s*scope\.length\}/.test(aiPage)
  );
  ok(
    'ai.tsx 未选范围时给明确提示「请先选择数据范围」',
    !!aiPage && /请先选择数据范围/.test(aiPage)
  );
  ok(
    'ai.tsx 坏源（invalid）不可选：onScopeChange 跳过 o.invalid',
    !!aiPage && /if\s*\(!\s*o\s*\|\|\s*o\.invalid\)\s*continue/.test(aiPage)
  );
  ok(
    'ai.tsx 默认范围只挑有效源（不默认选中 invalid）',
    !!aiPage && /filter\(\(o\)\s*=>\s*!\s*o\.invalid\)/.test(aiPage)
  );
  ok(
    'ai.tsx 选超上限时提示（maxSources 取服务端值，不硬编码）',
    !!aiPage && aiPage.includes('maxSources') && /最多同时选择/.test(aiPage)
  );
  ok(
    'ai.tsx 已选范围以可关闭 Tag 展示（对话区上方）',
    !!aiPage && aiPage.includes('数据范围：') && aiPage.includes('<Tag')
  );
  ok(
    'ai.tsx 问数请求显式传 scope 数组',
    !!aiPage && /scope:\s*scope\.map/.test(aiPage)
  );

  /* ═══════════ E. 分享能力 ═══════════ */
  section('E. 分享（创建 / 管理）');

  ok(
    'api/ai.ts 封装 createAiShare / listAiShares / setAiShareStatus / removeAiShare',
    !!aiApi &&
      ['createAiShare', 'listAiShares', 'setAiShareStatus', 'removeAiShare'].every((n) =>
        aiApi.includes(`function ${n}`)
      )
  );
  ok(
    'listAiShares 兼容后端 { list, total } 结构（不是裸数组）',
    !!aiApi && aiApi.includes("?.list") && aiApi.includes("(raw as Record<string, unknown>).list")
  );
  ok(
    'aiShareUrl 以 /a/<token> 生成兜底链接',
    !!aiApi && /\/a\/\$\{encodeURIComponent\(t\)\}/.test(aiApi)
  );
  ok(
    'ai.tsx 分享弹窗含 标题/密码/有效期/允许导出 四项',
    !!aiPage &&
      aiPage.includes('分享标题') &&
      aiPage.includes('访问密码') &&
      aiPage.includes('有效期') &&
      aiPage.includes('允许导出')
  );
  ok(
    'ai.tsx 有效期 0 = 永久有效（文案与提交一致）',
    !!aiPage && /0\s*=\s*永久有效/.test(aiPage)
  );
  ok(
    'ai.tsx 创建成功后展示完整链接 + 复制 + 打开预览',
    !!aiPage && aiPage.includes('copyText') && aiPage.includes('打开预览') && aiPage.includes('复制链接')
  );
  ok(
    'ai.tsx 分享管理抽屉含 停用/启用 与 删除（二次确认 Popconfirm）',
    !!aiPage && aiPage.includes('Popconfirm') && /停用/.test(aiPage) && /删除/.test(aiPage)
  );
  ok(
    'ai.tsx 分享管理展示 访问次数 / 问数次数 / 创建时间',
    !!aiPage && aiPage.includes('viewCount') && aiPage.includes('askCount') && aiPage.includes('createdAt')
  );
  ok(
    '未新增二维码 npm 依赖（package.json 无 qrcode）',
    (() => {
      const pkg = read('../package.json', FE);
      if (!pkg) return false;
      return !/"qrcode/i.test(pkg);
    })(),
    '需求允许退化为「链接 + 复制」'
  );

  /* ═══════════ F. 公开页移动端硬要求 ═══════════ */
  section('F. /a/:token 移动端与响应式');

  ok(
    '公开页适配安全区 env(safe-area-inset-bottom)（输入框吸底）',
    !!aiShare && aiShare.includes('env(safe-area-inset-bottom)')
  );
  ok(
    '公开页对话区 max-width 900 居中',
    !!aiShare && /maxWidth:\s*900/.test(aiShare)
  );
  ok(
    '公开页移动端字号 ≥14px（气泡/输入 15px，提示 12.5px 仅辅助）',
    !!aiShare && /fontSize:\s*15/.test(aiShare) && /fontSize:\s*14/.test(aiShare)
  );
  ok(
    '公开页点击区 ≥40px（发送按钮 height 44 / minHeight 42）',
    !!aiShare && (/height:\s*44/.test(aiShare) || /minHeight:\s*44/.test(aiShare)) && /minHeight:\s*4[0-9]/.test(aiShare)
  );
  ok(
    '公开页气泡：用户右（row-reverse）/ 助手左',
    !!aiShare && /flexDirection:\s*mine\s*\?\s*'row-reverse'\s*:\s*'row'/.test(aiShare)
  );
  ok(
    '公开页结果表格移动端横向滚动（scroll x max-content）',
    !!aiShare && /scroll=\{\{\s*x:\s*'max-content'/.test(aiShare)
  );
  ok(
    '公开页极窄屏卡片式降级（window.innerWidth < 420）',
    !!aiShare && /innerWidth\s*<\s*420/.test(aiShare)
  );
  ok(
    '公开页回车发送（onPressEnter / Enter）',
    !!aiShare && /onPressEnter/.test(aiShare) && /Enter 发送/.test(aiShare)
  );
  ok(
    '公开页绝不展示 SQL（服务端公开接口也不返回）',
    !!aiShare && !/meta\.sql|r\.sql|\.sql\b/.test(aiShare)
  );

  /* ═══════════ G. 错误提示文案 ═══════════ */
  section('G. 错误提示（明确区分四类失败）');

  ok(
    '文案含「密码不正确」',
    !!aiApi && aiApi.includes('密码不正确')
  );
  ok(
    '文案含「链接已过期」',
    !!aiApi && aiApi.includes('链接已过期')
  );
  ok(
    '文案含「分享已停用」',
    !!aiApi && aiApi.includes('分享已停用')
  );
  ok(
    '文案含「链接不存在」',
    !!aiApi && aiApi.includes('链接不存在')
  );
  ok(
    '文案含「访问过于频繁」（429 限流）',
    !!aiApi && aiApi.includes('访问过于频繁')
  );
  ok(
    '公开页对密码错误停留在密码卡片并保留输入',
    !!aiShare && /code === 'password'/.test(aiShare) && aiShare.includes('pwdError')
  );

  /* ═══════════ H. 构建产物 ═══════════ */
  section('H. 构建产物与工程约束');

  const dist = path.join(FE, 'dist');
  const distExists = fs.existsSync(dist);
  ok('frontend/dist 存在（已构建）', distExists);

  if (distExists) {
    const assets = fs.existsSync(path.join(dist, 'assets')) ? fs.readdirSync(path.join(dist, 'assets')) : [];
    const js = assets.filter((f) => f.endsWith('.js'));
    ok('dist/assets 有 JS 产物', js.length > 0, `${js.length} 个 js`);
    ok(
      'dist 内含 ai-share 独立 chunk（公开页已打包）',
      js.some((f) => /^ai-share-/.test(f)),
      js.filter((f) => /^ai-share-/.test(f)).join(',') || '未找到'
    );
    ok(
      'dist 内含 ai 页面 chunk',
      js.some((f) => /^ai-/.test(f) && !/^ai-share-/.test(f)),
      js.filter((f) => /^ai-/.test(f)).join(',')
    );
    const indexHtml = path.join(dist, 'index.html');
    ok('dist/index.html 存在且非空', fs.existsSync(indexHtml) && fs.statSync(indexHtml).size > 100);
  }

  /* package.json 无 BOM（BOM 会让 vite build 报 PostCSS 错） */
  const pkgPath = path.join(FE, 'package.json');
  let noBom = false;
  if (fs.existsSync(pkgPath)) {
    const buf = fs.readFileSync(pkgPath);
    noBom = !(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF);
  }
  ok('frontend/package.json 无 UTF-8 BOM', noBom, '有 BOM 会导致 vite build 失败');

  /* ═══════════ 汇总 ═══════════ */
  const total = pass + fail;
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log(` 结果：${pass}/${total} 通过，${fail} 失败`);
  if (fail) {
    console.log('\n 失败项：');
    failures.forEach((f) => console.log(`   - ${f}`));
    console.log('\n❌ V8 AI 问数前端自检未通过');
    console.log('════════════════════════════════════════════════════════════════');
    process.exit(1);
  }
  console.log('\n✅ V8 AI 问数前端自检全部通过');
  console.log('════════════════════════════════════════════════════════════════');
  process.exit(0);
}

main();
