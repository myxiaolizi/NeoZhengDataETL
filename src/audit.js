'use strict';

const db = require('./db');
const settings = require('./settings');

/**
 * 操作审计
 *
 * 记录用户的关键操作，便于追溯与合规。
 */

/** 需要审计的动作中文名 */
const ACTION_NAMES = {
  'login': '登录',
  'logout': '退出登录',
  'user.create': '新建用户',
  'user.update': '修改用户',
  'user.delete': '删除用户',
  'user.reset_password': '重置密码',
  'role.create': '新建角色',
  'role.update': '修改角色权限',
  'role.delete': '删除角色',
  'project.create': '新建项目',
  'project.update': '修改项目',
  'project.delete': '删除项目',
  'project.regenerate_token': '重置推送令牌',
  'project_group.create': '新建项目分组',
  'project_group.update': '修改项目分组',
  'project_group.delete': '删除项目分组',
  'project_group.assign': '移动项目到分组',
  'project_group.reorder': '调整分组排序',
  'field.import': '导入字段表',
  'field.update': '修改字段',
  'field.sync': '同步表结构',
  'data.delete': '删除数据',
  'data.export': '导出数据',
  'log.clear': '清空日志',
  'datasource.create': '新建数据源',
  'datasource.update': '修改数据源',
  'datasource.delete': '删除数据源',
  'datasource.test': '测试数据源',
  'dataset.create': '新建数据集',
  'dataset.update': '修改数据集',
  'dataset.delete': '删除数据集',
  'report.create': '新建报表',
  'report.update': '修改报表',
  'report.delete': '删除报表',
  'share.create': '创建分享',
  'share.delete': '删除分享',
  'integration.create': '新建集成任务',
  'integration.update': '修改集成任务',
  'integration.delete': '删除集成任务',
  'integration.run': '执行集成任务',
  'settings.update': '修改系统设置',
  'ai.ask': 'AI 问数',
};

function actionName(action) {
  return ACTION_NAMES[action] || action;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && (req.socket.remoteAddress || req.connection.remoteAddress)) || '';
}

/**
 * 记录一条审计日志
 * @param {object} req Express 请求（用于取用户与 IP）
 * @param {string} action 动作标识
 * @param {object} options { targetType, targetId, detail }
 */
async function log(req, action, options) {
  try {
    const enabled = await settings.getBool('audit_enabled');
    if (!enabled) return;

    const opts = options || {};
    const user = req && req.user;
    await db.query(
      `INSERT INTO jdywh_audit_logs
         (user_id, username, action, target_type, target_id, detail, ip)
       VALUES (?,?,?,?,?,?,?)`,
      [
        user ? user.id : null,
        user ? user.username : null,
        action,
        opts.targetType || null,
        opts.targetId === undefined || opts.targetId === null ? null : String(opts.targetId).slice(0, 64),
        opts.detail ? String(typeof opts.detail === 'string' ? opts.detail : JSON.stringify(opts.detail)).slice(0, 4000) : null,
        req ? clientIp(req) : null,
      ]
    );
  } catch (err) {
    console.error('[audit] 写入失败:', err.message);
  }
}

/** 查询审计日志 */
async function list(options) {
  const opts = options || {};
  const page = Math.max(1, parseInt(opts.page || '1', 10));
  const pageSize = Math.min(200, Math.max(5, parseInt(opts.pageSize || '30', 10)));
  const offset = (page - 1) * pageSize;

  const where = [];
  const params = [];
  if (opts.action) { where.push('action = ?'); params.push(opts.action); }
  if (opts.username) { where.push('username LIKE ?'); params.push(`%${opts.username}%`); }
  if (opts.keyword) {
    where.push('(username LIKE ? OR action LIKE ? OR detail LIKE ? OR ip LIKE ?)');
    const kw = `%${opts.keyword}%`;
    params.push(kw, kw, kw, kw);
  }
  if (opts.startDate) { where.push('created_at >= ?'); params.push(opts.startDate); }
  if (opts.endDate) { where.push('created_at <= ?'); params.push(opts.endDate + ' 23:59:59'); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await db.queryOne(`SELECT COUNT(*) AS c FROM jdywh_audit_logs ${whereSql}`, params);
  const rows = await db.query(
    `SELECT * FROM jdywh_audit_logs ${whereSql} ORDER BY id DESC LIMIT ${pageSize} OFFSET ${offset}`,
    params
  );

  return {
    list: rows.map((r) => Object.assign({}, r, { actionName: actionName(r.action) })),
    total: Number((totalRow && totalRow.c) || 0),
    page,
    pageSize,
  };
}

/** 统计 */
async function stats() {
  const row = await db.queryOne(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN created_at > DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS today,
            COUNT(DISTINCT username) AS users
       FROM jdywh_audit_logs`
  );
  return {
    total: Number((row && row.total) || 0),
    today: Number((row && row.today) || 0),
    users: Number((row && row.users) || 0),
  };
}

/** 清理过期审计日志 */
async function cleanup() {
  const days = await settings.getInt('audit_retention_days', 90);
  if (days > 0) {
    await db.query('DELETE FROM jdywh_audit_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [days]);
  }
  const loginDays = await settings.getInt('login_log_retention_days', 90);
  if (loginDays > 0) {
    await db.query('DELETE FROM jdywh_login_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [loginDays]);
  }
  return true;
}

module.exports = { log, list, stats, cleanup, actionName, ACTION_NAMES };