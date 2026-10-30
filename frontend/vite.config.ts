import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

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
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
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
