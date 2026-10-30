'use strict';

const express = require('express');
const auth = require('../auth');
const users = require('../users');
const settings = require('../settings');
const projects = require('../projects');
const projectGroups = require('../project-groups');

const router = express.Router();

/**
 * V4.0 SPA 接管：页面渲染交给 React 前端，本路由只保留「服务端表单处理」职责。
 *
 * 保留：
 *   POST /login /register /forgot-password /reset-password  —— 表单提交（前端 fetch 后解析结果）
 *   GET  /logout                                           —— 退出必须清 Cookie，不能在纯前端做
 *   GET  /verify-email                                     —— 邮件链接直接落地，需要服务端校验 token
 *
 * 其余 GET 页面请求一律 next('router')，交给后面的 SPA 中间件渲染 index.html。
 * 可用环境变量 JDY_LEGACY_PAGES=1 临时回退到旧 EJS 渲染（应急用）。
 */
const LEGACY_PAGES = String(process.env.JDY_LEGACY_PAGES || '') === '1';

/** 由 pages.js 自己处理的 GET 路径（白名单） */
const SERVER_GET_PATHS = new Set(['/logout', '/verify-email']);

if (!LEGACY_PAGES) {
  router.use((req, res, next) => {
    // 非 GET/HEAD 一律放行（表单 POST 由下面的路由处理）
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    // 白名单内的 GET 继续走本文件
    if (SERVER_GET_PATHS.has(req.path)) return next();
    // 其余全部交给 SPA
    return next('router');
  });
}

function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

/* ══════════════ 项目介绍（公开） ══════════════ */

router.get('/intro', (req, res) => {
  res.render('intro', {
    title: '项目介绍',
    active: '',
    currentUser: req.user || null,
    can: () => false,
    isAdmin: false,
  });
});

/* ══════════════ 登录 ══════════════ */

router.get('/login', async (req, res) => {
  if (req.user) return res.redirect('/');
  const s = await settings.all();
  res.render('login', {
    title: '登录',
    redirect: req.query.redirect || '/',
    error: null,
    info: null,
    allowRegistration: ['1', 'true', 'yes', 'on'].includes(String(s.allow_registration).toLowerCase()),
    mailReady: await settings.mailReady(),
  });
});

router.post('/login', async (req, res) => {
  const { username, password, redirect } = req.body || {};
  const s = await settings.all();
  try {
    const r = await auth.login(username, password, req);
    if (!r.ok) {
      return res.status(401).render('login', {
        title: '登录',
        redirect: redirect || '/',
        error: r.message,
        info: null,
        allowRegistration: ['1', 'true', 'yes', 'on'].includes(String(s.allow_registration).toLowerCase()),
        mailReady: await settings.mailReady(),
      });
    }
    auth.setSessionCookie(res, r.token, r.expires);
    return res.redirect(redirect && redirect.startsWith('/') ? redirect : '/');
  } catch (err) {
    console.error('[login] 失败:', err);
    return res.status(500).render('login', {
      title: '登录',
      redirect: redirect || '/',
      error: '登录失败：' + err.message,
      info: null,
      allowRegistration: false,
      mailReady: false,
    });
  }
});

router.get('/logout', async (req, res) => {
  if (req.session) await auth.logout(req.session.token);
  auth.clearSessionCookie(res);
  res.redirect('/login');
});

/* ══════════════ 注册 ══════════════ */

router.get('/register', async (req, res) => {
  if (req.user) return res.redirect('/');
  const s = await settings.all();
  const allow = ['1', 'true', 'yes', 'on'].includes(String(s.allow_registration).toLowerCase());
  if (!allow) {
    return res.status(403).render('error', {
      title: '未开放注册',
      message: '系统未开启自助注册，请联系管理员开通账号',
      active: '',
    });
  }
  res.render('register', {
    title: '注册账号',
    error: null,
    info: null,
    form: { username: '', email: '', displayName: '' },
    mailReady: await settings.mailReady(),
  });
});

router.post('/register', async (req, res) => {
  const s = await settings.all();
  const allow = ['1', 'true', 'yes', 'on'].includes(String(s.allow_registration).toLowerCase());
  const mailReady = await settings.mailReady();

  const renderErr = (msg) => res.status(400).render('register', {
    title: '注册账号',
    error: msg,
    info: null,
    form: {
      username: String((req.body && req.body.username) || ''),
      email: String((req.body && req.body.email) || ''),
      displayName: String((req.body && req.body.displayName) || ''),
    },
    mailReady,
  });

  if (!allow) return renderErr('系统未开启自助注册');

  try {
    const r = await auth.register(req.body || {}, req);
    if (!r.ok) return renderErr(r.message);

    // 发送验证邮件
    let info = '注册成功，请登录';
    if (mailReady) {
      try {
        const user = await users.findById(r.userId);
        await auth.sendVerifyMail(user.id, user.email, user.display_name, baseUrl(req));
        info = `注册成功！验证邮件已发送至 ${user.email}，请查收并完成验证`;
      } catch (err) {
        console.error('[register-mail]', err.message);
        info = '注册成功，但验证邮件发送失败，请联系管理员';
      }
    }

    res.render('login', {
      title: '登录',
      redirect: '/',
      error: null,
      info,
      allowRegistration: allow,
      mailReady,
    });
  } catch (err) {
    return renderErr(err.message);
  }
});

/* ══════════════ 邮箱验证 ══════════════ */

router.get('/verify-email', async (req, res) => {
  const token = req.query.token || '';
  const r = await auth.verifyEmail(token);
  const s = await settings.all();
  res.render('login', {
    title: '邮箱验证',
    redirect: '/',
    error: r.ok ? null : r.message,
    info: r.ok ? '邮箱验证成功，现在可以登录了' : null,
    allowRegistration: ['1', 'true', 'yes', 'on'].includes(String(s.allow_registration).toLowerCase()),
    mailReady: await settings.mailReady(),
  });
});

/* ══════════════ 找回密码 ══════════════ */

router.get('/forgot-password', async (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('forgot-password', {
    title: '找回密码',
    error: null,
    info: null,
    mailReady: await settings.mailReady(),
  });
});

router.post('/forgot-password', async (req, res) => {
  const mailReady = await settings.mailReady();
  const email = String((req.body && req.body.email) || '').trim();

  try {
    const r = await auth.requestPasswordReset(email, baseUrl(req));
    if (!r.ok) {
      return res.status(400).render('forgot-password', {
        title: '找回密码', error: r.message, info: null, mailReady,
      });
    }
    res.render('forgot-password', {
      title: '找回密码',
      error: null,
      info: r.message,
      mailReady,
    });
  } catch (err) {
    res.status(500).render('forgot-password', {
      title: '找回密码',
      error: '发送失败：' + err.message,
      info: null,
      mailReady,
    });
  }
});

router.get('/reset-password', async (req, res) => {
  const token = String(req.query.token || '');
  const row = await auth.checkResetToken(token);
  if (!row) {
    return res.status(400).render('reset-password', {
      title: '重置密码',
      error: '重置链接无效或已过期，请重新申请',
      info: null,
      token: '',
      valid: false,
      username: '',
    });
  }
  res.render('reset-password', {
    title: '重置密码',
    error: null,
    info: null,
    token,
    valid: true,
    username: row.display_name || row.username,
  });
});

router.post('/reset-password', async (req, res) => {
  const { token, newPassword, confirmPassword } = req.body || {};
  const row = await auth.checkResetToken(token);

  if (!row) {
    return res.status(400).render('reset-password', {
      title: '重置密码',
      error: '重置链接无效或已过期，请重新申请',
      info: null, token: '', valid: false, username: '',
    });
  }

  const r = await auth.resetPassword(token, newPassword, confirmPassword);
  if (!r.ok) {
    return res.status(400).render('reset-password', {
      title: '重置密码',
      error: r.message,
      info: null,
      token,
      valid: true,
      username: row.display_name || row.username,
    });
  }

  const s = await settings.all();
  res.render('login', {
    title: '登录',
    redirect: '/',
    error: null,
    info: `账号 ${r.username} 的密码已重置，请使用新密码登录`,
    allowRegistration: ['1', 'true', 'yes', 'on'].includes(String(s.allow_registration).toLowerCase()),
    mailReady: await settings.mailReady(),
  });
});

/* ══════════════ 主页面 ══════════════ */

/** 数据概览（首页） */
router.get('/', auth.requireAuth, (req, res) => {
  res.render('dashboard', { title: '数据概览', active: 'dashboard' });
});

router.get('/dashboard', auth.requireAuth, (req, res) => {
  res.render('dashboard', { title: '数据概览', active: 'dashboard' });
});

/** 数据项目列表（分组视图 + 卡片式） */
router.get('/projects', auth.requirePermPage('project:read'), async (req, res, next) => {
  try {
    const list = await projects.listProjects({});
    const stats = await projects.globalStats();

    // 附带每个项目的数据量与失败日志数
    const enriched = [];
    for (const p of list) {
      const st = await projects.projectStats(p.id);
      enriched.push(Object.assign({}, p, {
        dataCount: st ? st.dataTotal : 0,
        failedLogs: st ? st.logFailed : 0,
        lastReceived: st ? st.lastReceived : null,
      }));
    }

    // 分组树（含每个分组的项目数，供侧边栏渲染）
    let groups = [];
    let groupStats = { groups: 0, projects: 0, ungrouped: 0, byGroup: {} };
    try {
      groups = await projectGroups.tree();
      groupStats = await projectGroups.stats();
    } catch (_) { /* 分组表可能尚未建立，降级为空 */ }

    res.render('projects', {
      title: '数据项目',
      projects: enriched,
      stats,
      groups,
      groupStats,
      active: 'projects',
    });
  } catch (err) { next(err); }
});

/** 项目详情 */
router.get('/projects/:id', auth.requireAuth, async (req, res, next) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) {
      return res.status(404).render('error', { title: '404', message: '项目不存在', active: '' });
    }
    res.render('project-detail', {
      title: project.name,
      project,
      active: 'projects',
    });
  } catch (err) { next(err); }
});

/** 字段设置（需求 5 / 7） */
router.get('/projects/:id/fields', auth.requireAuth, async (req, res, next) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) {
      return res.status(404).render('error', { title: '404', message: '项目不存在', active: '' });
    }
    if (!users.can(req.user, 'field:write')) {
      return res.status(403).render('error', { title: '403', message: '没有字段设置权限', active: '' });
    }
    res.render('project-fields', {
      title: project.name + ' - 字段设置',
      project,
      active: 'projects',
    });
  } catch (err) { next(err); }
});

/** 用户管理（含角色权限、组织架构、权限说明标签） */
router.get('/users', auth.requirePermPage('user:read'), (req, res) => {
  res.render('users', { title: '用户管理', active: 'users' });
});

/** 角色权限（独立页面，保留兼容） */
router.get('/roles', auth.requirePermPage('role:write'), (req, res) => {
  res.render('roles', { title: '角色权限', active: 'users' });
});

/* ══════════════ 表单引擎 ══════════════ */

router.get('/forms', auth.requirePermPage('form:read'), (req, res) => {
  res.render('forms', { title: '表单中心', active: 'forms' });
});

router.get('/forms/:id/design', auth.requirePermPage('form:write'), async (req, res, next) => {
  try {
    const forms = require('../forms');
    const form = await forms.getById(req.params.id);
    if (!form) {
      return res.status(404).render('error', { title: '404', message: '表单不存在', active: '' });
    }
    res.render('form-design', { title: form.name + ' - 表单设计', form, active: 'forms' });
  } catch (err) { next(err); }
});

router.get('/forms/:id/data', auth.requirePermPage('form:read'), async (req, res, next) => {
  try {
    const forms = require('../forms');
    const form = await forms.getById(req.params.id);
    if (!form) {
      return res.status(404).render('error', { title: '404', message: '表单不存在', active: '' });
    }
    res.render('form-data', { title: form.name + ' - 提交数据', form, active: 'forms' });
  } catch (err) { next(err); }
});

/** 公开填写页（无需登录） */
router.get('/f/:token', async (req, res, next) => {
  try {
    const forms = require('../forms');
    const form = await forms.getByToken(req.params.token);
    const s = await settings.all();

    if (!form) {
      return res.status(404).render('form-public', {
        title: '表单不存在', form: null, settings: s, error: '表单不存在或链接已失效',
      });
    }
    if (!form.status) {
      return res.status(403).render('form-public', {
        title: '表单已停用', form: null, settings: s, error: '该表单已停用，暂时无法填写',
      });
    }
    if (!form.allowPublic) {
      return res.status(403).render('form-public', {
        title: '表单未开放', form: null, settings: s, error: '该表单未开放公开填写',
      });
    }

    res.render('form-public', {
      title: form.name, form, settings: s, error: null, success: false,
    });
  } catch (err) { next(err); }
});

/* ══════════════ 数据处理流程 ══════════════ */

router.get('/flows', auth.requirePermPage('flow:read'), (req, res) => {
  res.render('flows', { title: '数据处理', active: 'flows' });
});

router.get('/flows/:id/design', auth.requirePermPage('flow:write'), async (req, res, next) => {
  try {
    const flows = require('../flows');
    const flow = await flows.getById(req.params.id);
    if (!flow) {
      return res.status(404).render('error', { title: '404', message: '流程不存在', active: '' });
    }
    res.render('flow-design', { title: flow.name + ' - 流程编排', flow, active: 'flows' });
  } catch (err) { next(err); }
});

router.get('/flows/:id/logs', auth.requirePermPage('flow:read'), async (req, res, next) => {
  try {
    const flows = require('../flows');
    const flow = await flows.getById(req.params.id);
    if (!flow) {
      return res.status(404).render('error', { title: '404', message: '流程不存在', active: '' });
    }
    res.render('flow-logs', { title: flow.name + ' - 运行日志', flow, active: 'flows' });
  } catch (err) { next(err); }
});

/** 数据源管理 */
router.get('/datasources', auth.requirePermPage('datasource:read'), (req, res) => {
  res.render('datasources', { title: '数据源管理', active: 'datasources' });
});

/** 系统设置 */
router.get('/settings', auth.requirePermPage('settings:read'), (req, res) => {
  res.render('settings', { title: '系统设置', active: 'settings' });
});

/** 个人中心 */
router.get('/profile', auth.requireAuth, (req, res) => {
  res.render('profile', { title: '个人中心', active: 'profile' });
});

/** 对接说明 */
router.get('/help', auth.requireAuth, (req, res) => {
  res.render('help', { title: '对接说明', active: 'help' });
});

/* ══════════════ 报表与 BI ══════════════ */

/** 报表中心 */
router.get('/reports', auth.requirePermPage('report:read'), (req, res) => {
  res.render('reports', { title: '报表中心', active: 'reports' });
});

/** 报表设计器 */
router.get('/reports/:id/design', auth.requirePermPage('report:write'), async (req, res, next) => {
  try {
    const reports = require('../reports');
    const report = await reports.getReport(req.params.id);
    if (!report) {
      return res.status(404).render('error', { title: '404', message: '报表不存在', active: '' });
    }
    res.render('report-design', { title: report.name + ' - 报表设计', report, active: 'reports' });
  } catch (err) { next(err); }
});

/** 报表查看 */
router.get('/reports/:id/view', auth.requirePermPage('report:read'), async (req, res, next) => {
  try {
    const reports = require('../reports');
    const report = await reports.getReport(req.params.id);
    if (!report) {
      return res.status(404).render('error', { title: '404', message: '报表不存在', active: '' });
    }
    res.render('report-view', { title: report.name, report, active: 'reports' });
  } catch (err) { next(err); }
});

/** CRM 客户签约看板 */
router.get('/dashboard/crm', auth.requirePermPage('report:read'), (req, res) => {
  res.render('crm-dashboard', {
    title: '客户签约看板',
    active: 'reports',
    projectId: Number(req.query.projectId) || 16,
  });
});

/** 数据集管理 */
router.get('/datasets', auth.requirePermPage('dataset:read'), (req, res) => {
  res.render('datasets', { title: '数据集', active: 'datasets' });
});

/** 分享管理 */
router.get('/shares', auth.requirePermPage('share:write'), (req, res) => {
  res.render('shares', { title: '分享管理', active: 'shares' });
});

/** 公开分享访问页（无需登录） */
router.get('/s/:token', async (req, res, next) => {
  try {
    const reports = require('../reports');
    const token = req.params.token;
    const password = req.query.pwd || '';
    const result = await reports.accessShare(token, password);

    if (!result.ok) {
      if (result.code === 'password') {
        return res.render('share-access', {
          title: '访问分享', token, needPassword: true, error: password ? result.message : null,
          settings: await settings.all(),
        });
      }
      return res.status(404).render('share-access', {
        title: '分享不可用', token, needPassword: false, error: result.message,
        settings: await settings.all(),
      });
    }

    res.render('share-view', {
      title: result.report.name,
      token,
      share: result.share,
      report: result.report,
      rows: result.rows,
      columns: result.columns,
      rowCount: result.rowCount,
      settings: await settings.all(),
    });
  } catch (err) { next(err); }
});

/* ══════════════ 数据集成 ══════════════ */

/** 集成任务列表 */
router.get('/integrations', auth.requirePermPage('integration:read'), (req, res) => {
  res.render('integrations', { title: '数据集成', active: 'integrations' });
});

/** 集成任务详情/日志 */
router.get('/integrations/:id', auth.requirePermPage('integration:read'), async (req, res, next) => {
  try {
    const integrations = require('../integrations');
    const task = await integrations.get(req.params.id);
    if (!task) {
      return res.status(404).render('error', { title: '404', message: '集成任务不存在', active: '' });
    }
    res.render('integration-detail', { title: task.name, task, active: 'integrations' });
  } catch (err) { next(err); }
});

/* ══════════════ AI 问数 ══════════════ */

router.get('/ai', auth.requirePermPage('ai:use'), async (req, res) => {
  const s = await settings.all();
  res.render('ai', {
    title: 'AI 问数',
    active: 'ai',
    aiEnabled: ['1', 'true', 'yes', 'on'].includes(String(s.ai_enabled).toLowerCase()),
    welcome: s.ai_welcome || '',
  });
});

/* ══════════════ 数据治理 ══════════════ */

router.get('/governance', auth.requirePermPage('project:read'), (req, res) => {
  res.render('governance', { title: '数据治理', active: 'governance' });
});

/** 审计日志 */
router.get('/audit', auth.requirePermPage('audit:read'), (req, res) => {
  res.render('audit', { title: '审计日志', active: 'audit' });
});

/* ══════════════ 邮箱推送 ══════════════ */

router.get('/mail-push', auth.requirePermPage('project:read'), (req, res) => {
  res.render('mail-push', { title: '邮箱推送', active: 'mail-push' });
});

/** 新增邮箱（独立页面） */
router.get('/mail-push/accounts/new', auth.requirePermPage('settings:write'), (req, res) => {
  res.render('mail-push-account', {
    title: '添加邮箱',
    active: 'mail-push',
    accountId: null,
    isEdit: false,
    account: null,
  });
});

/** 编辑邮箱（独立页面） */
router.get('/mail-push/accounts/:id/edit', auth.requirePermPage('settings:write'), async (req, res, next) => {
  try {
    const accounts = require('../mail-accounts');
    await accounts.ensureTable();
    const row = await accounts.get(req.params.id);
    if (!row) {
      return res.status(404).render('error', {
        title: '邮箱账户不存在',
        message: '该邮箱账户可能已被删除',
        active: '',
        currentUser: req.user,
        can: () => false,
        isAdmin: false,
        settings: res.locals.settings || {},
      });
    }
    res.render('mail-push-account', {
      title: '编辑邮箱 · ' + row.email,
      active: 'mail-push',
      accountId: row.id,
      isEdit: true,
      account: row,
    });
  } catch (err) { next(err); }
});

/** 邮箱推送数据项目详情（独立页面） */
router.get('/mail-push/projects/:id', auth.requirePermPage('project:read'), async (req, res, next) => {
  try {
    const mailPush = require('../mail-push');
    await mailPush.ensureMetaTables();
    const project = await mailPush.getProject(req.params.id);
    if (!project) {
      return res.status(404).render('error', {
        title: '项目不存在',
        message: '该项目可能已被删除',
        active: '',
        currentUser: req.user,
        can: () => false,
        isAdmin: false,
        settings: res.locals.settings || {},
      });
    }
    res.render('mail-push-project', {
      title: project.name + ' · 邮箱推送',
      active: 'mail-push',
      project,
    });
  } catch (err) { next(err); }
});

module.exports = router;