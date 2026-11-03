'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
/**
 * SPA 静态托管（V4.0）
 *
 * 职责：
 *  1. 托管前端构建产物（frontend/dist）
 *  2. 未命中的前端路由回退到 index.html（BrowserRouter 需要）
 *
 * 约束：
 *  - 只处理 GET / HEAD
 *  - 排除后端专属前缀（/api /jdy /public /healthz 等）
 *  - 不吞掉带扩展名的静态资源 404（否则浏览器拿到 HTML 会报 MIME 错误）
 */

/** 后端专属前缀：这些请求绝不能落到 SPA */
const BACKEND_PREFIXES = [
  '/api',
  '/jdy',
  '/healthz',
  '/public',
  '/.well-known',
];

/** 前端构建产物目录（可用环境变量覆盖） */
function resolveDistDir() {
  const candidates = [
    process.env.JDY_SPA_DIR,
    path.resolve(__dirname, '../../frontend/dist'),
    path.resolve(__dirname, '../../public/spa'),
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
    } catch (_) { /* 忽略 */ }
  }
  return null;
}

function isBackendPath(urlPath) {
  return BACKEND_PREFIXES.some((p) => urlPath === p || urlPath.startsWith(p + '/'));
}

/** 判断是否像静态资源请求（带扩展名） */
function looksLikeAsset(urlPath) {
  return /\.[a-z0-9]{1,8}$/i.test(urlPath);
}

/* ══════════════════════════════════════════════════════════════════
 * V16.1 需求 3：分享页服务端 <meta> 注入
 *
 * 为什么必须服务端做：微信/钉钉/企微/飞书 的链接预览爬虫**不执行 JS**，
 * 只读服务端返回的 HTML。若只在前端 `document.title = ...`，
 * 浏览器标签栏是对的，但转发出去仍然是站点默认标题、没有缩略图和描述。
 *
 * 只处理 GET/HEAD 的 `/s/<token>`；任何异常一律回退到原始 index.html，
 * 保证「分享页永远能打开」这条底线不被预览功能拖垮。
 * ══════════════════════════════════════════════════════════════════ */

const SHARE_META_START = '<!-- SHARE_META_START -->';
const SHARE_META_END = '<!-- SHARE_META_END -->';

/** HTML 属性/文本转义：标题、描述来自用户输入，必须转义后再拼进 HTML */
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 取站点对外基址，用于把站内相对缩略图补成绝对 URL（og:image 必须是绝对地址）。
 *
 * 实测本机 nginx（宝塔 node 反代模板）只发这几个头：
 *   Host: $host:$server_port      → 「jdy.zhengl.vip:443」，**带端口**
 *   X-Scheme: $scheme             → 「https」，注意**不是**标准的 X-Forwarded-Proto
 *   X-Real-IP / X-Forwarded-For
 * 且 node 进程本身跑在 http 上（nginx→node 是明文），未开 trust proxy 时 req.secure 恒 false。
 * 所以若只读 X-Forwarded-Proto + req.secure，会得出「http://jdy.zhengl.vip:443」这种错地址
 * （V16.1 首轮线上验收就是这么暴露的：og:image 协议错了，且端口多余）。
 *
 * 取值顺序：环境变量 → X-Forwarded-Proto → X-Scheme → req.secure → 默认 https。
 * 端口：80/443 一律去掉（对外 URL 不该带默认端口），其它端口保留。
 */
function siteOrigin(req) {
  const envBase = process.env.JDY_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL;
  if (envBase) return String(envBase).replace(/\/+$/, '');

  const first = (v) => String(v || '').split(',')[0].trim().toLowerCase();
  const proto =
    first(req.headers['x-forwarded-proto']) ||
    first(req.headers['x-scheme']) ||
    (req.secure ? 'https' : 'https'); /* 站点对外强制 HTTPS，默认按 https 处理 */

  let host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim();
  /* 去掉默认端口：x-forwarded-host/Host 可能形如 example.com:443 */
  host = host.replace(/:(80|443)$/, '');
  return host ? `${proto}://${host}` : '';
}

/**
 * 生成注入到 <head> 的 meta 片段。
 * @returns {Promise<string>} 已经是可插入的 HTML；出错返回空串（调用方回退原页面）
 */
async function buildShareMetaHtml(sharePath) {
  const m = /^\/s\/([A-Za-z0-9_-]{1,64})\/?$/.exec(sharePath);
  if (!m) return '';

  const token = m[1];
  let meta = null;
  try {
    meta = await require('../reports').shareMetaByToken(token);
  } catch (err) {
    console.warn('[spa] 分享 meta 查询失败，回退默认标题:', err.message);
    return '';
  }
  if (!meta) return '';

  /* 失效/停用/有密码的分享：**只给标题，绝不泄漏描述与缩略图** */
  const usable = !meta.expired && !meta.disabled;
  let siteName = '';
  try {
    siteName = String((await require('../settings').get('site_name', '')) || '');
  } catch (_) { /* 忽略：没有站点名就用空串 */ }

  const title = meta.title || siteName || '数据分享';
  const desc = usable ? (meta.description || '') : '';
  const thumbRaw = usable ? (meta.thumb || '') : '';
  const thumb = thumbRaw && thumbRaw.startsWith('/') ? thumbRaw : thumbRaw;

  const lines = [
    SHARE_META_START,
    `<title>${escHtml(title)}</title>`,
    `<meta name="description" content="${escHtml(desc || title)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escHtml(title)}" />`,
    `<meta property="og:description" content="${escHtml(desc || title)}" />`,
  ];
  if (thumb) {
    /* og:image 需要绝对地址：站内相对路径用请求 Host 补全（这里用占位符 $ORIGIN$，便于按请求替换） */
    lines.push(`<meta property="og:image" content="${escHtml(thumb.startsWith('/') ? '$ORIGIN$' + thumb : thumb)}" />`);
  }
  lines.push(
    `<meta name="twitter:card" content="${thumb ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${escHtml(title)}" />`,
    `<meta name="twitter:description" content="${escHtml(desc || title)}" />`,
  );
  if (thumb) {
    lines.push(`<meta name="twitter:image" content="${escHtml(thumb.startsWith('/') ? '$ORIGIN$' + thumb : thumb)}" />`);
  }
  lines.push(SHARE_META_END);
  return lines.join('\n    ');
}

/** 把 meta 片段塞进 index.html 的标记之间；标记缺失则原样返回（不破坏页面） */
function injectShareMeta(html, metaHtml, req) {
  if (!metaHtml) return html;
  const s = html.indexOf(SHARE_META_START);
  const e = html.indexOf(SHARE_META_END);
  if (s < 0 || e < 0 || e < s) return html;
  const origin = siteOrigin(req);
  const filled = metaHtml.split('$ORIGIN$').join(origin);
  const replaced = html.slice(0, s) + filled + html.slice(e + SHARE_META_END.length);
  /* 去掉首屏占位 <title>：模板里 index.html 自带一个默认 <title>，重复会让浏览器取第一个 */
  return replaced.replace(/<title>Neo Zheng DataETL<\/title>\s*/,'');
}

function mountSpa(app) {
  const distDir = resolveDistDir();

  if (!distDir) {
    console.warn('[spa] 未找到前端构建产物，页面请求将返回提示页。');
    console.warn('      请先在 frontend/ 执行 npm run build，或设置 JDY_SPA_DIR。');

    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (isBackendPath(req.path)) return next();

      res.status(503).type('html').send(
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
        '<title>前端资源未就绪</title>' +
        '<style>body{font-family:-apple-system,"Segoe UI","PingFang SC",sans-serif;' +
        'display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fff}' +
        '.box{text-align:center;padding:32px;border:1px solid #DCDDDD;border-radius:12px;max-width:520px}' +
        'h1{color:#003378;font-size:20px;margin:0 0 12px}' +
        'p{color:rgba(0,51,120,.65);font-size:14px;line-height:1.7;margin:0}' +
        'code{background:rgba(54,135,255,.10);padding:2px 6px;border-radius:4px;color:#2D6FE4}</style>' +
        '</head><body><div class="box"><h1>前端资源未就绪</h1>' +
        '<p>请先构建前端：<br><code>cd frontend &amp;&amp; npm install &amp;&amp; npm run build</code>' +
        '<br><br>构建后重启服务即可。</p></div></body></html>'
      );
    });
    return;
  }

  // 1. 静态资源（带缓存头）
  app.use(express.static(distDir, {
    index: false,
    maxAge: '7d',
    setHeaders(res, filePath) {
      // index.html 不缓存，确保发版后立即生效
      if (path.basename(filePath) === 'index.html') {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));

  const indexHtmlPath = path.join(distDir, 'index.html');

  // 2. SPA 回退
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (isBackendPath(req.path)) return next();

    // 带扩展名的资源没命中，返回真正的 404（避免 HTML 冒充 JS/CSS）
    if (looksLikeAsset(req.path)) {
      return res.status(404).type('text/plain').send('Not Found');
    }

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    /* V16.1 需求 3：/s/<token> 服务端注入分享标题/描述/缩略图。
     * 只在这一个路径上前置处理，其余路由仍走 sendFile（零额外开销）。
     * 任何异常都回退到 sendFile，绝不让预览功能影响"分享页能打开"。 */
    if (/^\/s\/[A-Za-z0-9_-]{1,64}\/?$/.test(req.path)) {
      (async () => {
        const metaHtml = await buildShareMetaHtml(req.path);
        if (!metaHtml) return res.sendFile(indexHtmlPath);
        const raw = await fs.promises.readFile(indexHtmlPath, 'utf8');
        const html = injectShareMeta(raw, metaHtml, req);
        res.type('html').send(html);
      })().catch((err) => {
        console.warn('[spa] 注入分享 meta 失败，回退原页面:', err.message);
        res.sendFile(indexHtmlPath);
      });
      return;
    }

    res.sendFile(indexHtmlPath, (err) => {
      if (err) next(err);
    });
  });

  console.log(` SPA 目录  : ${distDir}`);
}

module.exports = { mountSpa, resolveDistDir };
