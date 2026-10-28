'use strict';

require('dotenv').config();

const path = require('path');

function bool(v, def) {
  if (v === undefined || v === null || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const env = process.env.NODE_ENV || 'development';

const config = {
  env,
  isProd: env === 'production',
  port: parseInt(process.env.PORT || '8781', 10),
  host: process.env.HOST || '0.0.0.0',

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'jdy-push',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'jdy-push',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
    charset: 'utf8mb4',
    timezone: 'local',
    supportBigNumbers: true,
    bigNumberStrings: false,
    dateStrings: false,
    multipleStatements: false,
  },

  /**
   * 表名前缀白名单：应用只允许创建/修改/删除以此前缀开头的表。
   * 用于防止误操作同一数据库中的其他业务表。
   */
  tablePrefix: process.env.TABLE_PREFIX || 'jdywh_',

  sessionSecret: process.env.SESSION_SECRET || 'jdy-push-dev-secret',

  defaultAdmin: {
    username: process.env.DEFAULT_ADMIN_USER || 'admin',
    password: process.env.DEFAULT_ADMIN_PASSWORD || '6655',
  },

  maxBodySize: process.env.MAX_BODY_SIZE || '20mb',
  requireSignature: bool(process.env.REQUIRE_SIGNATURE, false),

  /**
   * 推送失败是否用非 2xx 状态码返回（让简道云侧可见失败）。
   *
   * 背景：简道云「数据推送」只依据 HTTP 状态码判定推送结果。
   *   历史实现所有失败分支都返回 200，导致数据明明被拒绝写入，
   *   简道云后台却始终显示「成功」，业务方完全无从发现。
   *
   * 取舍：
   *   1（默认）= 签名不符 403 / 报文非法 400 / 处理异常 500 → 失败可见，但可能触发简道云重试
   *   0        = 一律返回 200，仅在平台日志里记录失败 → 不会重试，但简道云侧不可见
   *
   * 若简道云侧因重试导致推送被自动关闭，可设为 0 恢复旧行为。
   */
  pushFailVisible: bool(process.env.PUSH_FAIL_VISIBLE, true),

  // 会话有效期（毫秒）
  sessionTtl: 1000 * 60 * 60 * 24 * 7,

  paths: {
    root: path.resolve(__dirname, '..'),
    views: path.resolve(__dirname, '..', 'views'),
    public: path.resolve(__dirname, '..', 'public'),
  },
};

module.exports = config;
