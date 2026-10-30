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
    res.sendFile(indexHtmlPath, (err) => {
      if (err) next(err);
    });
  });

  console.log(` SPA 目录  : ${distDir}`);
}

module.exports = { mountSpa, resolveDistDir };
