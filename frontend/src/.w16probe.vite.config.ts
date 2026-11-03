import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

/**
 * 构建期注入版本号（V9）
 *
 * 用户在「系统设置」里要求显示当前版本号。有两种做法：
 *   1. 后端加 `GET /api/version` —— 但 `src/routes/api.js` 当前被并行会话占用，
 *      为避免冲突，本轮不新增后端路由；
 *   2. **构建时把版本号写成字面量**（本方案）—— 零请求、零后端依赖，
 *      而且顺带能暴露「前后端版本不一致」这种部署事故。
 *
 * 注意：`__dirname` 在 ESM 里不可用，但 vite 以 CJS 方式加载本配置时可用，
 * 项目里 alias 已经用了 `path.resolve(__dirname, '.')`，这里沿用同一写法。
 */
function readVersion(p: string): string {
  try {
    return String(JSON.parse(fs.readFileSync(p, 'utf8')).version || '');
  } catch {
    return '';
  }
}
const FE_VERSION = readVersion(path.resolve(__dirname, '..', 'package.json'));
const BE_VERSION = readVersion(path.resolve(__dirname, '..', 'package.json'));

const BACKEND = 'http://127.0.0.1:8781';

/** 纯后端接口前缀：GET/POST 全部透传 */
const API_PREFIXES = [
  '/api',
  '/public',
  '/jdy',
  '/healthz',
];

/**
 * 认证路径：**只有 POST 需要透传**。
 *
 * 后端这四个路径是表单提交端点（返回 HTML 或 302），
 * 前端登录/注册/找回密码页通过 fetch POST 提交后解析结果。
 *
 * 但它们的 GET 必须回给 SPA —— 否则在 dev 环境下访问
 * http://localhost:5173/register 会拿到后端 EJS 页面，
 * React 版认证页根本打不开。
 */
const AUTH_PATHS = [
  '/login',
  '/logout',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
];

/** 公开访问入口：既是 SPA 页面路由，又是后端接口前缀，需按路径/方法分流 */
const PUBLIC_ENTRY_PREFIXES = ['/s/', '/f/'];

function withBypassForGet() {
  return {
    target: BACKEND,
    changeOrigin: true,
    secure: false,
    bypass(req: any) {
      const method = String(req.method || 'GET').toUpperCase();
      // GET / HEAD 交回前端路由（Vite 会返回 index.html）
      if (method === 'GET' || method === 'HEAD') return '/index.html';
      return null; // POST 等继续透传
    },
  };
}

/**
 * /f/:token 与 /s/:token 的双重身份分流：
 *   页面  GET  /f/<token>           → SPA
 *   接口  GET  /f/<token>/schema    → 后端
 *         POST /f/<token>/submit    → 后端
 *   页面  GET  /s/<token>           → SPA
 *   接口  GET  /api/public/shares/:token → 已由 /api 前缀处理
 */
function withPublicEntryBypass() {
  return {
    target: BACKEND,
    changeOrigin: true,
    secure: false,
    bypass(req: any) {
      const method = String(req.method || 'GET').toUpperCase();
      const urlPath = String(req.url || '').split('?')[0];
      // 仅「/f/<token>」或「/s/<token>」这种纯页面 GET 交回 SPA
      if ((method === 'GET' || method === 'HEAD') && /^\/(f|s)\/[^/]+\/?$/.test(urlPath)) {
        return '/index.html';
      }
      return null; // /schema、/submit 及 POST 继续透传后端
    },
  };
}

const proxy: Record<string, any> = {};

for (const prefix of API_PREFIXES) {
  proxy[prefix] = { target: BACKEND, changeOrigin: true, secure: false };
}
for (const p of AUTH_PATHS) {
  proxy[p] = withBypassForGet();
}
for (const prefix of PUBLIC_ENTRY_PREFIXES) {
  proxy[prefix] = withPublicEntryBypass();
}

export default defineConfig({
  plugins: [react()],
  /**
   * V9：构建期注入版本号（供「系统设置 → 关于」与项目介绍页使用）。
   * 详见文件顶部 `readVersion` 的注释。
   */
  define: {
    __FE_VERSION__: JSON.stringify(FE_VERSION),
    __BE_VERSION__: JSON.stringify(BE_VERSION),
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  server: {
    port: 5174,
    host: '127.0.0.1',
    strictPort: true,
    proxy,
    watch: {
      // Windows 上编辑器/构建脚本会生成被短暂锁定的临时文件与新配置文件，
      // 被 watcher 捕获后触发 EBUSY 会让整个 dev server 崩溃，这里统一忽略。
      ignored: [
        '**/.*.tmpdir/**',
        '**/*.tmpdir/**',
        '**/*.tmp',
        '**/.*.swp',
        '**/.DS_Store',
        '**/dist/**',
        '**/vite.*.config.*',
      ],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          antd: ['antd', '@ant-design/icons'],
          pro: ['@ant-design/pro-components'],
          charts: ['echarts'],
        },
      },
    },
  },
});
