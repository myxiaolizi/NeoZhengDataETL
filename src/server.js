'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');
const bootstrap = require('./bootstrap');
const auth = require('./auth');
const settings = require('./settings');
const users = require('./users');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', true);
app.set('view engine', 'ejs');
app.set('views', config.paths.views);

/* ---- 模板全局助手 ---- */
app.locals.esc = function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

app.locals.fmtTime = function fmtTime(v) {
  if (v === null || v === undefined || v === '') return '-';
  let d;
  if (typeof v === 'number') d = new Date(v);
  else if (/^\d+$/.test(String(v))) d = new Date(Number(v));
  else d = new Date(String(v).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/* ---- 静态资源 ---- */
app.use('/public', express.static(config.paths.public, { maxAge: '1h' }));

/* ---- 请求体解析 ---- */
// 推送入口需要原始字符串用于签名校验
app.use('/jdy', express.raw({ type: '*/*', limit: config.maxBodySize }));
app.use(express.json({ limit: config.maxBodySize }));
app.use(express.urlencoded({ extended: true, limit: config.maxBodySize }));

/* ---- 登录态与全局模板变量 ---- */
app.use(auth.middleware);

/* ---- 健康检查 ---- */
app.get('/healthz', async (req, res) => {
  try {
    await db.ping();
    res.json({ ok: true, status: 'up', time: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, status: 'db_error', message: err.message });
  }
});

/* ---- 路由 ---- */
app.use('/jdy', require('./routes/push'));
app.use('/api', require('./routes/api'));
app.use('/f', require('./routes/public-forms'));

/*
 * V4.0：前端已迁移为 React SPA。
 *
 * 旧的 EJS 页面路由（routes/pages.js）仍保留挂载，原因：
 *   1) 它承载 /login /register /forgot-password /reset-password 的表单 POST 处理
 *      （提交后 302 或渲染 HTML，前端 fetch 后解析结果）
 *   2) 邮件里的 /s/:token 分享链接、/f/:token 公开表单入口仍走它
 *   3) 作为前端构建产物缺失时的降级路径
 *
 * 但 **GET 页面渲染** 会被下面的 SPA 中间件接管（它在 pages 之后挂载，
 * 只处理未被前面路由命中的 GET 请求），因此用户实际看到的始终是 SPA。
 */
app.use('/', require('./routes/pages'));

/* ---- SPA 静态托管与前端路由回退 ---- */
require('./routes/spa').mountSpa(app);

/* ---- 404 ---- */
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, message: '接口不存在' });
  }
  if (req.path.startsWith('/jdy/')) {
    return res.status(404).json({ ok: false, message: '推送接口不存在' });
  }
  res.status(404).type('text/plain').send('Not Found');
});

/* ---- 错误处理 ---- */
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ ok: false, message: err.message || '服务器内部错误' });
  }
  res.status(500).render('error', {
    title: '500',
    message: err.message || '服务器内部错误',
    active: '',
    currentUser: req.user,
    can: () => false,
    isAdmin: false,
    settings: res.locals.settings || settings.DEFAULTS,
  });
});

// ---------------------------------------------------------------------------
// 进程 PID 文件
//
// 宝塔面板通过 pid 文件判断项目是否在运行。原方案由启动脚本用 `echo $!` 写入，
// 在端口已被占用时会记录一个立刻退出的 PID；而 `ss -lntp` 在面板子进程里
// 又常常拿不到监听者的 PID（跨 mount namespace），导致状态长期错乱。
//
// 进程自己知道 process.pid，且此处只在 listen 成功的回调里写，所以写入的
// 一定是「真实在监听」的 PID。启动脚本与 watchdog 只做兜底校正。
//
// 本地开发（Windows / macOS）没有面板路径，写不进去属正常情况，
// 只提示一次且不刷错误日志；可用 JDY_PID_FILE 覆盖。
// ---------------------------------------------------------------------------
const PID_FILE = process.env.JDY_PID_FILE
  || '/www/server/nodejs/vhost/pids/jdy-push.pid';

let pidFileWarned = false;

function writePidFile() {
  try {
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid) + '\n', 'utf8');
  } catch (e) {
    // 本地环境无面板目录，属预期情况：只提示一次，避免每分钟刷日志
    if (!pidFileWarned) {
      pidFileWarned = true;
      console.warn(`[pid] 跳过 PID 文件（${e.code || e.message}）：${PID_FILE}`);
      console.warn('      如需启用，请设置环境变量 JDY_PID_FILE 指向可写路径。');
    }
  }
}

function removePidFile() {
  try {
    // 只删自己的，避免误删新实例写入的 pid
    const cur = fs.readFileSync(PID_FILE, 'utf8').trim();
    if (cur === String(process.pid)) fs.unlinkSync(PID_FILE);
  } catch (e) { /* 文件不存在或无权限，忽略 */ }
}

async function start() {
  console.log('---------------------------------------------');
  console.log(' 数据中台 v4.1');
  console.log(' React 18 + Ant Design 6 · 数据集成 · 数据治理 · 报表 BI · AI 问数');
  console.log('---------------------------------------------');
  console.log(` 环境      : ${config.env}`);
  console.log(` 数据库    : ${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}`);

  await db.ping();
  console.log(' 数据库连接: OK');

  const admin = await bootstrap.bootstrap();
  if (admin.created) {
    console.log(` 初始化管理员: ${admin.username} / ${config.defaultAdmin.password}`);
  } else {
    console.log(' 管理员账号: 已存在');
  }

  const s = await settings.all();
  console.log(` 站点名称  : ${s.site_name}`);
  console.log(` 邮件服务  : ${(await settings.mailReady()) ? '已配置' : '未配置'}`);
  console.log(` 自助注册  : ${['1', 'true', 'yes', 'on'].includes(String(s.allow_registration).toLowerCase()) ? '已开启' : '已关闭'}`);

  await auth.cleanupExpired();
  setInterval(() => {
    auth.cleanupExpired().catch((e) => console.error('[cleanup]', e.message));
  }, 1000 * 60 * 60).unref();

  // 邮箱推送：初始化元数据表，迁移旧单账户配置，并按设置启动定时轮询
  try {
    const mailPush = require('./mail-push');
    const mailAccounts = require('./mail-accounts');
    const mailInbox = require('./mail-inbox');
    await mailPush.ensureMetaTables();
    await mailAccounts.ensureTable();
    const mig = await mailAccounts.migrateFromSettings(settings);
    if (mig.migrated) {
      console.log(` 邮箱账户  : 已从旧配置迁移「${mig.account.email}」`);
    }
    const r = await mailInbox.start();
    console.log(` 邮箱推送  : ${r.started
      ? `已启动（${r.accounts} 个账户，每 ${r.intervalMinutes} 分钟）`
      : `未启动（${r.reason || '-'}）`}`);
  } catch (e) {
    console.error('[mail-push] 启动失败:', e.message);
  }

  const server = app.listen(config.port, config.host, () => {
    console.log(` 监听地址  : http://${config.host}:${config.port}`);
    console.log(` 进程 PID  : ${process.pid}`);
    console.log('---------------------------------------------');
    writePidFile();
  });

  /**
   * 端口占用 / 权限不足等监听错误：给出可操作的提示后退出。
   *
   * 面板与 watchdog 会重复拉起本服务，若端口已被同一份代码的实例占用，
   * 直接抛未捕获异常只会在日志里留下一大段堆栈，运维无法判断该停谁。
   * 这里输出明确结论，并以 0 退出（对上层守护来说不是“崩溃”）。
   */
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error('');
      console.error('==============================================');
      console.error(` 启动失败：端口 ${config.port} 已被占用`);
      console.error(` 监听地址：${config.host}:${config.port}`);
      console.error(' 处理方式：');
      console.error('   1) 若服务已在运行，请不要重复启动；');
      console.error(`   2) 若需重启，先结束占用该端口的进程：`);
      console.error(`      ss -lntp | grep :${config.port}`);
      console.error(`      kill $(cat /www/server/nodejs/vhost/pids/jdy-push.pid)`);
      console.error('   3) 确认端口释放后再启动，避免面板状态与真实进程不一致。');
      console.error('==============================================');
      console.error('');
      process.exit(0);
    }
    if (err && err.code === 'EACCES') {
      console.error(`启动失败：无权限监听 ${config.host}:${config.port}（请检查端口是否 <1024 或运行用户权限）`);
      process.exit(1);
    }
    console.error('启动失败：', err);
    process.exit(1);
  });

  const shutdown = (signal) => {
    console.log(`\n[${signal}] 正在关闭服务...`);
    server.close(async () => {
      removePidFile();
      await db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  start().catch((err) => {
    console.error('启动失败:', err);
    process.exit(1);
  });
}

module.exports = { app, start };