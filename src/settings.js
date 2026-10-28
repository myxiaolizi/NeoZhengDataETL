'use strict';

const db = require('./db');

/**
 * 系统设置（键值对，带内存缓存）
 *
 * 分组：
 *   site     站点信息
 *   security 安全策略
 *   smtp     邮件服务
 *   push     推送默认值
 */

const DEFAULTS = {
  // ---------- 站点 ----------
  site_name: 'Neo Zheng DataETL',
  site_short: 'Neo Zheng DataETL',
  site_subtitle: 'Enterprise Data Integration Platform',
  site_logo_text: 'N',
  site_description: '企业多系统数据整合 · 统一主数据管理 · 数据治理 · 报表 BI · 可视化大屏 · AI 问数',
  site_footer: '',
  theme_color: '#3687FF',
  theme_style: 'light',

  // ---------- 安全 ----------
  allow_registration: '0',
  session_ttl_days: '7',
  min_password_length: '6',
  login_max_attempts: '10',
  require_email_verify: '0',
  force_https: '0',
  ip_whitelist: '',

  // ---------- 邮件 ----------
  smtp_enabled: '0',
  smtp_host: '',
  smtp_port: '465',
  smtp_secure: '1',
  smtp_user: '',
  smtp_pass: '',
  smtp_from_name: '数据中台',
  smtp_from_email: '',

  // ---------- 推送接收 ----------
  default_base_url: '',
  require_signature: '0',
  records_page_size: '20',
  auto_parse_enabled: '1',
  max_body_size: '20mb',
  keep_raw_json: '1',

  // ---------- 数据存储 ----------
  default_datasource_id: '0',
  table_prefix: 'jdywh_',
  auto_create_table: '1',
  auto_create_parsed_table: '1',
  parsed_table_suffix: 'parsed',
  row_size_guard: '1',
  data_retention_days: '0',

  // ---------- 报表与 BI ----------
  report_theme: 'light',
  report_default_rows: '1000',
  report_cache_ttl: '0',
  chart_palette: '#45B4FF,#FFC000,#3687FF,#A2D73C,#EC673C,#73DBFF,#003378,#B5B5B6',
  allow_public_share: '1',
  share_default_expires: '0',

  // ---------- 数据集成 ----------
  integration_timeout: '30',
  integration_batch_size: '100',
  integration_retry: '2',
  webhook_token: '',

  // ---------- AI 问数 ----------
  ai_enabled: '0',
  ai_provider: 'deepseek',
  ai_base_url: 'https://api.deepseek.com/v1',
  ai_api_key: '',
  ai_model: 'deepseek-chat',
  ai_temperature: '0.1',
  ai_max_rows: '500',
  ai_welcome: '你好，我是数据助手。你可以问我：本月新增了多少条数据？各区域的销售金额排名如何？',

  // ---------- 审计 ----------
  audit_enabled: '1',
  audit_retention_days: '90',
  login_log_retention_days: '90',

  // ---------- 邮箱推送（附件表格自动入库）----------
  mail_push_enabled: '0',
  mail_imap_host: 'imap.qiye.aliyun.com',
  mail_imap_port: '993',
  mail_imap_secure: '1',
  mail_imap_user: '',
  mail_imap_pass: '',
  mail_imap_mailbox: 'INBOX',
  mail_push_interval: '5',
  mail_push_initial_days: '7',
  mail_push_max_per_run: '50',
  mail_push_last_uid: '0',
};

/** 可编辑的分组定义（用于生成设置页表单） */
const GROUPS = [
  {
    key: 'site',
    title: '站点信息',
    desc: '平台名称、标识、主题色与展示文案',
    icon: '◈',
    fields: [
      { key: 'site_name', label: '平台名称', type: 'text', placeholder: 'Neo Zheng DataETL' },
      { key: 'site_short', label: '平台简称', type: 'text', placeholder: 'Neo Zheng DataETL' },
      { key: 'site_subtitle', label: '副标题', type: 'text', placeholder: 'Enterprise Data Integration Platform' },
      { key: 'site_logo_text', label: 'Logo 文字', type: 'text', placeholder: 'N', hint: '侧边栏与登录页的方形图标文字，建议 1 个字符' },
      { key: 'site_description', label: '平台描述', type: 'textarea', placeholder: '数据集成 · 数据治理 · 报表开发 · BI · 可视化大屏 · AI 问数' },
      { key: 'site_footer', label: '页脚版权', type: 'text', placeholder: '© 2026 某某公司' },
      { key: 'theme_color', label: '主题色', type: 'color', hint: '默认主色 #3687FF，影响按钮、链接与高亮色' },
    ],
  },
  {
    key: 'security',
    title: '安全策略',
    desc: '登录、注册、密码与访问控制',
    icon: '⛨',
    fields: [
      { key: 'allow_registration', label: '允许自助注册', type: 'switch', hint: '开启后登录页会显示「注册」入口' },
      { key: 'require_email_verify', label: '注册需邮箱验证', type: 'switch', hint: '需先配置邮件服务' },
      { key: 'session_ttl_days', label: '登录有效期（天）', type: 'number', min: 1, max: 365 },
      { key: 'min_password_length', label: '密码最小长度', type: 'number', min: 4, max: 32 },
      { key: 'login_max_attempts', label: '连续登录失败锁定阈值', type: 'number', min: 0, max: 100, hint: '0 表示不限制，默认 15 分钟内 10 次' },
      { key: 'force_https', label: '强制 HTTPS', type: 'switch', hint: '开启后 HTTP 请求会被重定向到 HTTPS' },
      { key: 'ip_whitelist', label: '管理后台 IP 白名单', type: 'text', placeholder: '留空不限制，多个用逗号分隔', hint: '仅允许这些 IP 访问管理后台' },
    ],
  },
  {
    key: 'smtp',
    title: '邮件服务',
    desc: '用于找回密码、注册验证与系统通知',
    icon: '✉',
    fields: [
      { key: 'smtp_enabled', label: '启用邮件服务', type: 'switch' },
      { key: 'smtp_host', label: 'SMTP 服务器', type: 'text', placeholder: 'smtp.qq.com' },
      { key: 'smtp_port', label: 'SMTP 端口', type: 'number', min: 1, max: 65535, placeholder: '465' },
      { key: 'smtp_secure', label: '使用 SSL/TLS', type: 'switch', hint: '465 端口请开启；587 端口通常关闭并使用 STARTTLS' },
      { key: 'smtp_user', label: '邮箱账号', type: 'text', placeholder: 'noreply@example.com' },
      { key: 'smtp_pass', label: '邮箱密码/授权码', type: 'password', hint: 'QQ/163 邮箱请填写客户端授权码，不是登录密码' },
      { key: 'smtp_from_name', label: '发件人名称', type: 'text', placeholder: '数据中台' },
      { key: 'smtp_from_email', label: '发件人邮箱', type: 'text', placeholder: '留空则使用邮箱账号' },
    ],
  },
  {
    key: 'storage',
    title: '数据存储',
    desc: '数据源绑定、建表策略与数据保留',
    icon: '⛁',
    fields: [
      { key: 'default_datasource_id', label: '默认数据源', type: 'datasource', hint: '新建项目时默认使用的数据源' },
      { key: 'auto_create_table', label: '自动建表', type: 'switch', hint: '新建项目时自动创建数据表' },
      { key: 'auto_create_parsed_table', label: '自动创建解析表', type: 'switch', hint: '每个项目同时创建「解析前」与「解析后」两张表' },
      { key: 'parsed_table_suffix', label: '解析表后缀', type: 'text', placeholder: 'parsed', hint: '解析表命名：jdywh_{后缀}_{项目ID}' },
      { key: 'row_size_guard', label: '行大小保护', type: 'switch', hint: '字段较多时自动降级为 TEXT，避免 MySQL 单行 65535 字节上限' },
      { key: 'data_retention_days', label: '数据保留天数', type: 'number', min: 0, max: 3650, hint: '0 表示永久保留' },
    ],
  },
  {
    key: 'push',
    title: '推送接收',
    desc: '简道云等数据源推送的接收行为',
    icon: '⇄',
    fields: [
      { key: 'default_base_url', label: '默认推送地址前缀', type: 'text', placeholder: 'https://jdy.example.com', hint: '新建项目时自动填入，可留空由用户填写' },
      { key: 'require_signature', label: '强制校验签名', type: 'switch', hint: '开启后签名不符的推送将被拒绝写入（仅记录日志）' },
      { key: 'auto_parse_enabled', label: '启用字段自动解析', type: 'switch', hint: '关闭后所有字段按原始值存储' },
      { key: 'records_page_size', label: '明细分页条数', type: 'number', min: 5, max: 200 },
      { key: 'max_body_size', label: '请求体大小上限', type: 'text', placeholder: '20mb' },
      { key: 'keep_raw_json', label: '保留原始报文', type: 'switch', hint: '关闭可节省存储空间，但无法追溯原始数据' },
    ],
  },
  {
    key: 'report',
    title: '报表与 BI',
    desc: '报表主题、图表配色与分享策略',
    icon: '◫',
    fields: [
      { key: 'report_theme', label: '报表主题', type: 'select', options: [
        { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' },
      ] },
      { key: 'report_default_rows', label: '报表默认取数行数', type: 'number', min: 100, max: 10000 },
      { key: 'report_cache_ttl', label: '报表缓存（秒）', type: 'number', min: 0, max: 86400, hint: '0 表示不缓存' },
      { key: 'chart_palette', label: '图表配色', type: 'text', placeholder: '#3687FF,#45B4FF,...', hint: '逗号分隔的十六进制颜色' },
      { key: 'allow_public_share', label: '允许公开分享', type: 'switch', hint: '关闭后无法创建分享链接' },
      { key: 'share_default_expires', label: '分享默认有效期（天）', type: 'number', min: 0, max: 3650, hint: '0 表示永久有效' },
    ],
  },
  {
    key: 'integration',
    title: '数据集成',
    desc: '接口采集与推送的默认参数',
    icon: '⇋',
    fields: [
      { key: 'integration_timeout', label: '接口超时（秒）', type: 'number', min: 5, max: 300 },
      { key: 'integration_batch_size', label: '批量处理条数', type: 'number', min: 1, max: 10000 },
      { key: 'integration_retry', label: '失败重试次数', type: 'number', min: 0, max: 10 },
      { key: 'webhook_token', label: 'Webhook 触发令牌', type: 'text', placeholder: '留空则自动生成', hint: '外部系统可通过该令牌触发集成任务' },
    ],
  },
  {
    key: 'ai',
    title: 'AI 问数',
    desc: '大模型接口配置（兼容 OpenAI 协议）',
    icon: '✦',
    fields: [
      { key: 'ai_enabled', label: '启用 AI 问数', type: 'switch' },
      { key: 'ai_provider', label: '模型供应商', type: 'aiprovider', hint: '选择供应商后自动填充接口地址与模型，只需填入 API Key' },
      { key: 'ai_api_key', label: '接口密钥', type: 'password', hint: '在供应商控制台创建 API Key 后粘贴到此处' },
      { key: 'ai_model', label: '模型名称', type: 'aimodel', hint: '选择供应商后自动列出可用模型' },
      { key: 'ai_base_url', label: '接口地址', type: 'text', placeholder: 'https://api.deepseek.com/v1', hint: '选择供应商后自动填充，自建服务可手动修改' },
      { key: 'ai_temperature', label: '温度参数', type: 'text', placeholder: '0.1', hint: '0-1，越低越稳定，问数建议 0.1' },
      { key: 'ai_max_rows', label: '最大返回行数', type: 'number', min: 10, max: 5000 },
      { key: 'ai_welcome', label: '欢迎语', type: 'textarea', placeholder: '你好，我是数据助手...' },
    ],
  },
  {
    key: 'mailpush',
    title: '邮箱推送',
    desc: '接收邮件附件表格，自动建项目与数据表',
    icon: '✉',
    fields: [
      { key: 'mail_push_enabled', label: '启用邮箱推送', type: 'switch', hint: '开启后按下方周期自动拉取带 Excel 附件的邮件' },
      { key: 'mail_imap_host', label: 'IMAP 服务器', type: 'text', placeholder: 'imap.qiye.aliyun.com', hint: '阿里云企业邮箱：imap.qiye.aliyun.com（SSL 993）' },
      { key: 'mail_imap_port', label: 'IMAP 端口', type: 'number', min: 1, max: 65535, hint: 'SSL 加密用 993，非加密用 143' },
      { key: 'mail_imap_secure', label: '使用 SSL/TLS', type: 'switch', hint: '993 端口请开启' },
      { key: 'mail_imap_user', label: '邮箱账号', type: 'text', placeholder: 'zkcrm@zhengl.vip' },
      { key: 'mail_imap_pass', label: '邮箱密码/授权码', type: 'password', hint: '阿里云企业邮箱请填写客户端专用密码' },
      { key: 'mail_imap_mailbox', label: '收件文件夹', type: 'text', placeholder: 'INBOX', hint: '默认 INBOX，可填写其他文件夹名' },
      { key: 'mail_push_interval', label: '轮询周期（分钟）', type: 'number', min: 1, max: 1440, hint: '默认 5 分钟拉取一次' },
      { key: 'mail_push_initial_days', label: '首次回溯天数', type: 'number', min: 1, max: 365, hint: '首次启用时回溯多少天内的历史邮件' },
      { key: 'mail_push_max_per_run', label: '单次最多处理邮件数', type: 'number', min: 1, max: 500 },
    ],
  },
  {
    key: 'audit',
    title: '审计与日志',
    desc: '操作审计与日志保留策略',
    icon: '☰',
    fields: [
      { key: 'audit_enabled', label: '启用操作审计', type: 'switch', hint: '记录用户的关键操作' },
      { key: 'audit_retention_days', label: '审计日志保留（天）', type: 'number', min: 1, max: 3650 },
      { key: 'login_log_retention_days', label: '登录日志保留（天）', type: 'number', min: 1, max: 3650 },
    ],
  },
];

const SECRET_KEYS = ['smtp_pass', 'ai_api_key', 'mail_imap_pass'];

let cache = null;

async function load(force) {
  if (cache && !force) return cache;
  const rows = await db.query('SELECT skey, svalue FROM jdywh_settings');
  const map = Object.assign({}, DEFAULTS);
  rows.forEach((r) => { map[r.skey] = r.svalue; });
  cache = map;
  return cache;
}

async function all() {
  return Object.assign({}, await load());
}

async function get(key, fallback) {
  const map = await load();
  const v = map[key];
  if (v === undefined || v === null || v === '') {
    return fallback !== undefined ? fallback : DEFAULTS[key];
  }
  return v;
}

async function getBool(key) {
  const v = await get(key);
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

async function getInt(key, fallback) {
  const v = await get(key);
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : (fallback !== undefined ? fallback : parseInt(DEFAULTS[key], 10));
}

async function set(key, value) {
  const v = value === undefined || value === null ? '' : String(value);
  await db.query(
    `INSERT INTO jdywh_settings (skey, svalue) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE svalue = VALUES(svalue), updated_at = CURRENT_TIMESTAMP`,
    [key, v]
  );
  if (cache) cache[key] = v;
}

async function setMany(obj) {
  for (const k of Object.keys(obj)) {
    await set(k, obj[k]);
  }
  await load(true);
}

/** 判断某个设置项是否已配置 */
async function isConfigured(key) {
  const v = await get(key);
  return !!v;
}

/** 是否允许邮件功能（开关打开且必要参数齐全） */
async function mailReady() {
  const map = await load();
  const enabled = ['1', 'true', 'yes', 'on'].includes(String(map.smtp_enabled).toLowerCase());
  return !!(enabled && map.smtp_host && map.smtp_user && map.smtp_pass);
}

module.exports = {
  DEFAULTS,
  GROUPS,
  SECRET_KEYS,
  load,
  all,
  get,
  getBool,
  getInt,
  set,
  setMany,
  isConfigured,
  mailReady,
  clearCache() { cache = null; },
};
