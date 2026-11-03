'use strict';

const bcrypt = require('bcryptjs');
const db = require('./db');
const config = require('./config');
const settings = require('./settings');
const schema = require('./schema');

/** 系统表建表语句（全部使用 IF NOT EXISTS，可重复执行） */
const DDL = [
  `CREATE TABLE IF NOT EXISTS jdywh_users (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    username VARCHAR(64) NOT NULL,
    email VARCHAR(190) NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(64) NULL,
    role VARCHAR(16) NOT NULL DEFAULT 'editor',
    status TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1启用 0禁用',
    email_verified TINYINT(1) NOT NULL DEFAULT 0,
    last_login_at DATETIME NULL,
    last_login_ip VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_username (username),
    UNIQUE KEY uk_email (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='平台用户'`,

  `CREATE TABLE IF NOT EXISTS jdywh_sessions (
    token CHAR(64) NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    ip VARCHAR(64) NULL,
    user_agent VARCHAR(255) NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (token),
    KEY idx_user_id (user_id),
    KEY idx_expires_at (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='登录会话'`,

  `CREATE TABLE IF NOT EXISTS jdywh_resets (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    token CHAR(64) NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    purpose VARCHAR(32) NOT NULL DEFAULT 'reset_password',
    used TINYINT(1) NOT NULL DEFAULT 0,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_token (token),
    KEY idx_user_id (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='令牌（找回密码/邮箱验证）'`,

  `CREATE TABLE IF NOT EXISTS jdywh_settings (
    skey VARCHAR(64) NOT NULL,
    svalue TEXT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (skey)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='系统设置'`,

  `CREATE TABLE IF NOT EXISTS jdywh_login_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username VARCHAR(64) NULL,
    user_id INT UNSIGNED NULL,
    success TINYINT(1) NOT NULL DEFAULT 0,
    message VARCHAR(255) NULL,
    ip VARCHAR(64) NULL,
    user_agent VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_username (username),
    KEY idx_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='登录日志'`,

  `CREATE TABLE IF NOT EXISTS jdywh_projects (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(128) NOT NULL,
    code VARCHAR(64) NOT NULL,
    description VARCHAR(500) NULL,
    jdy_base_url VARCHAR(255) NULL COMMENT '简道云服务器地址(推送接收地址前缀)',
    jdy_secret VARCHAR(255) NULL COMMENT '简道云生成的 Secret',
    push_token VARCHAR(64) NOT NULL COMMENT '推送地址中的随机令牌',
    data_table VARCHAR(64) NOT NULL,
    log_table VARCHAR(64) NOT NULL,
    field_map LONGTEXT NULL COMMENT '字段名 -> 列名 映射(JSON)',
    parse_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用字段解析',
    status TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
    remark VARCHAR(500) NULL,
    total_count BIGINT NOT NULL DEFAULT 0,
    last_push_at DATETIME NULL,
    created_by INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_code (code),
    UNIQUE KEY uk_push_token (push_token)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='接收项目'`,

  `CREATE TABLE IF NOT EXISTS jdywh_project_groups (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(64) NOT NULL COMMENT '分组名称（同级唯一）',
    parent_id INT UNSIGNED NULL COMMENT '上级分组ID，NULL=根分组',
    code VARCHAR(64) NULL COMMENT '分组编码（可选，便于对接）',
    icon VARCHAR(16) NULL COMMENT '图标（emoji 或字符）',
    color VARCHAR(16) NULL COMMENT '标识色',
    sort_order INT NOT NULL DEFAULT 0 COMMENT '同级排序号',
    remark VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_parent (parent_id),
    KEY idx_sort (sort_order)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='项目分组'`,

  `CREATE TABLE IF NOT EXISTS jdywh_field_defs (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id INT UNSIGNED NOT NULL,
    field_name VARCHAR(191) NOT NULL COMMENT '简道云字段名称（中文）',
    field_key VARCHAR(191) NOT NULL COMMENT '字段ID或字段别名（推送JSON中的键）',
    field_type VARCHAR(32) NULL COMMENT '简道云字段类型',
    remark VARCHAR(500) NULL COMMENT '简道云字段说明',
    column_name VARCHAR(64) NOT NULL COMMENT '数据库列名',
    parse_mode VARCHAR(32) NOT NULL DEFAULT 'none' COMMENT '解析方式',
    parse_path VARCHAR(191) NULL COMMENT '自定义解析路径',
    source_key VARCHAR(191) NULL COMMENT '派生字段的源字段键（为空表示本身即源字段）',
    sub_table VARCHAR(64) NULL COMMENT '展开子表名（数组展开时）',
    is_system TINYINT(1) NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_project_field (project_id, field_key),
    KEY idx_project (project_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='项目字段定义'`,

  /* ══════════ 多数据源 ══════════ */
  `CREATE TABLE IF NOT EXISTS jdywh_datasources (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(128) NOT NULL,
    type VARCHAR(32) NOT NULL DEFAULT 'mysql' COMMENT 'mysql / mssql',
    host VARCHAR(191) NOT NULL,
    port INT NOT NULL DEFAULT 3306,
    user VARCHAR(128) NULL,
    password VARCHAR(255) NULL,
    database_name VARCHAR(128) NOT NULL,
    options TEXT NULL COMMENT '额外连接参数(JSON)',
    remark VARCHAR(500) NULL,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    status TINYINT(1) NOT NULL DEFAULT 1,
    last_test_at DATETIME NULL,
    last_test_ok TINYINT(1) NULL,
    last_test_msg VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='数据源连接'`,

  /* ══════════ 角色与权限 ══════════ */
  `CREATE TABLE IF NOT EXISTS jdywh_roles (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    role_key VARCHAR(64) NOT NULL,
    name VARCHAR(64) NOT NULL,
    description VARCHAR(500) NULL,
    permissions LONGTEXT NULL COMMENT '权限点数组(JSON)',
    is_system TINYINT(1) NOT NULL DEFAULT 0 COMMENT '系统内置角色不可删除',
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_role_key (role_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='角色定义'`,

  /* ══════════ 数据集（报表数据来源） ══════════ */
  `CREATE TABLE IF NOT EXISTS jdywh_datasets (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(128) NOT NULL,
    code VARCHAR(64) NOT NULL,
    description VARCHAR(500) NULL,
    datasource_id INT UNSIGNED NOT NULL DEFAULT 0,
    source_type VARCHAR(32) NOT NULL DEFAULT 'sql' COMMENT 'sql / table / project',
    source_sql LONGTEXT NULL,
    source_table VARCHAR(191) NULL,
    project_id INT UNSIGNED NULL COMMENT 'source_type=project 时关联项目',
    fields LONGTEXT NULL COMMENT '字段元数据(JSON)',
    cache_ttl INT NOT NULL DEFAULT 0 COMMENT '缓存秒数，0=不缓存',
    status TINYINT(1) NOT NULL DEFAULT 1,
    created_by INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_code (code),
    KEY idx_project (project_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='数据集'`,

  /* ══════════ 报表 ══════════ */
  `CREATE TABLE IF NOT EXISTS jdywh_reports (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(128) NOT NULL,
    code VARCHAR(64) NOT NULL,
    description VARCHAR(500) NULL,
    category VARCHAR(64) NULL COMMENT '报表分类',
    report_type VARCHAR(32) NOT NULL DEFAULT 'chart' COMMENT 'chart/table/dashboard',
    dataset_id INT UNSIGNED NULL,
    config LONGTEXT NULL COMMENT '图表配置(JSON)',
    layout LONGTEXT NULL COMMENT '仪表盘布局(JSON)',
    status TINYINT(1) NOT NULL DEFAULT 1,
    created_by INT UNSIGNED NULL,
    view_count BIGINT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_code (code),
    KEY idx_dataset (dataset_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='报表'`,

  /* ══════════ V16 分享访问明细（契约 §2.1，P0-1 方案 C） ══════════
   * 原先分享只有 jdywh_shares.view_count 一个计数，10 项指标里 7 项无原始数据。
   * 本表记录每次公开分享访问的 ip / UA / referer / path，UA 派生出浏览器、操作系统、设备类型。
   * province 列：全仓库无离线 IP 库，恒为 NULL（接口返回 provinceStatus='pending'，不得伪造）。
   * source 列：'beacon' = 应用埋点；'nginx' = 用生产 nginx 日志回填的历史，
   *           **两者在统计接口中必须分开返回，不得相加成一个数字**（契约 §2.5）。
   */
  `CREATE TABLE IF NOT EXISTS jdywh_share_visits (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    share_type VARCHAR(16) NOT NULL COMMENT 'report=报表/看板分享, ai=AI问数分享',
    share_id INT UNSIGNED NOT NULL,
    token VARCHAR(64) NOT NULL,
    ip VARCHAR(64) NULL COMMENT '访客IP（trust proxy 后的真实IP）',
    user_agent VARCHAR(512) NULL,
    referer VARCHAR(512) NULL,
    path VARCHAR(255) NULL,
    bytes_sent INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '响应体字节数（流量）',
    browser VARCHAR(32) NULL COMMENT 'UA解析：浏览器类型',
    os VARCHAR(32) NULL COMMENT 'UA解析：操作系统类型',
    device VARCHAR(16) NULL COMMENT 'UA解析：设备类型',
    province VARCHAR(32) NULL COMMENT '省份（离线IP库），无库时恒 NULL',
    source VARCHAR(16) NOT NULL DEFAULT 'beacon' COMMENT 'beacon=应用埋点 nginx=日志回填',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_share (share_type, share_id, created_at),
    KEY idx_token (token, created_at),
    KEY idx_created (created_at),
    KEY idx_source (source)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='分享访问明细（V16）'`,

  /* ══════════ 分享 ══════════ */
  `CREATE TABLE IF NOT EXISTS jdywh_shares (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    token VARCHAR(64) NOT NULL,
    target_type VARCHAR(32) NOT NULL COMMENT 'report/dashboard',
    target_id INT UNSIGNED NOT NULL,
    title VARCHAR(191) NULL,
    description VARCHAR(500) NULL COMMENT 'V16.1：分享描述（og:description / 页面摘要）',
    thumb VARCHAR(500) NULL COMMENT 'V16.1：分享缩略图 URL（og:image）',
    password VARCHAR(128) NULL COMMENT '访问密码(可选)',
    expires_at DATETIME NULL COMMENT '过期时间，NULL=永久',
    allow_export TINYINT(1) NOT NULL DEFAULT 0,
    view_count BIGINT NOT NULL DEFAULT 0,
    status TINYINT(1) NOT NULL DEFAULT 1,
    created_by INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_token (token),
    KEY idx_target (target_type, target_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='报表分享'`,

  /* ══════════ 数据集成（采集/推送） ══════════ */
  `CREATE TABLE IF NOT EXISTS jdywh_integrations (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(128) NOT NULL,
    code VARCHAR(64) NOT NULL,
    direction VARCHAR(16) NOT NULL DEFAULT 'pull' COMMENT 'pull=接口采集 push=接口推送',
    project_id INT UNSIGNED NULL COMMENT '关联项目（写入/读取数据表）',
    protocol VARCHAR(16) NOT NULL DEFAULT 'http' COMMENT 'http/https',
    method VARCHAR(8) NOT NULL DEFAULT 'GET',
    url VARCHAR(1000) NULL,
    headers LONGTEXT NULL COMMENT '请求头(JSON)',
    params LONGTEXT NULL COMMENT '查询参数(JSON)',
    body LONGTEXT NULL COMMENT '请求体模板',
    auth_type VARCHAR(32) NOT NULL DEFAULT 'none' COMMENT 'none/bearer/basic/apikey',
    auth_config LONGTEXT NULL,
    data_path VARCHAR(191) NULL COMMENT '响应数据路径，如 data.list',
    field_map LONGTEXT NULL COMMENT '字段映射(JSON)',
    schedule VARCHAR(64) NULL COMMENT 'cron 表达式或间隔秒数',
    trigger_type VARCHAR(16) NOT NULL DEFAULT 'manual' COMMENT 'manual/cron/webhook',
    last_run_at DATETIME NULL,
    last_run_ok TINYINT(1) NULL,
    last_run_msg VARCHAR(500) NULL,
    run_count BIGINT NOT NULL DEFAULT 0,
    success_count BIGINT NOT NULL DEFAULT 0,
    status TINYINT(1) NOT NULL DEFAULT 1,
    created_by INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_code (code),
    KEY idx_direction (direction)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='数据集成任务'`,

  /* ══════════ 集成运行日志 ══════════ */
  `CREATE TABLE IF NOT EXISTS jdywh_integration_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    integration_id INT UNSIGNED NOT NULL,
    direction VARCHAR(16) NULL,
    trigger_source VARCHAR(32) NULL COMMENT 'manual/cron/webhook',
    success TINYINT(1) NOT NULL DEFAULT 0,
    rows_affected INT NOT NULL DEFAULT 0,
    http_status INT NULL,
    message TEXT NULL,
    request_snapshot LONGTEXT NULL,
    response_snapshot LONGTEXT NULL,
    duration_ms INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_integration (integration_id),
    KEY idx_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='数据集成运行日志'`,

  /* ══════════ AI 问数会话 ══════════ */
  `CREATE TABLE IF NOT EXISTS jdywh_ai_chats (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NULL,
    session_key VARCHAR(64) NOT NULL,
    question TEXT NULL,
    answer LONGTEXT NULL,
    sql_text LONGTEXT NULL,
    dataset_id INT UNSIGNED NULL,
    result_rows INT NOT NULL DEFAULT 0,
    success TINYINT(1) NOT NULL DEFAULT 0,
    message VARCHAR(500) NULL,
    duration_ms INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_session (session_key),
    KEY idx_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='AI 问数记录'`,

  /* ══════════ 操作审计 ══════════ */
  `CREATE TABLE IF NOT EXISTS jdywh_audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NULL,
    username VARCHAR(64) NULL,
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(32) NULL,
    target_id VARCHAR(64) NULL,
    detail TEXT NULL,
    ip VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_user (user_id),
    KEY idx_action (action),
    KEY idx_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='操作审计日志'`,

  /* ══════════ 组织架构 ══════════ */
  `CREATE TABLE IF NOT EXISTS jdywh_departments (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(128) NOT NULL,
    parent_id INT UNSIGNED NOT NULL DEFAULT 0,
    code VARCHAR(64) NULL,
    leader VARCHAR(64) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    remark VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_parent (parent_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='组织架构部门'`,

  /* ══════════ 表单引擎 ══════════ */
  `CREATE TABLE IF NOT EXISTS jdywh_forms (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(128) NOT NULL,
    code VARCHAR(64) NOT NULL,
    description VARCHAR(500) NULL,
    project_id INT UNSIGNED NULL COMMENT '数据写入的项目',
    form_type VARCHAR(16) NOT NULL DEFAULT 'fill' COMMENT 'fill/flow/exam',
    fields LONGTEXT NULL COMMENT '表单字段定义 JSON',
    settings LONGTEXT NULL COMMENT '表单设置 JSON（提交提示、去重规则等）',
    submit_count INT NOT NULL DEFAULT 0,
    public_token VARCHAR(64) NULL COMMENT '公开填写令牌',
    allow_public TINYINT(1) NOT NULL DEFAULT 0,
    status TINYINT(1) NOT NULL DEFAULT 1,
    created_by INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_code (code),
    UNIQUE KEY uk_token (public_token),
    KEY idx_project (project_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='表单定义'`,

  `CREATE TABLE IF NOT EXISTS jdywh_form_records (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    form_id INT UNSIGNED NOT NULL,
    data_json LONGTEXT NULL COMMENT '提交的原始数据',
    submitter VARCHAR(64) NULL,
    submitter_id INT UNSIGNED NULL,
    ip VARCHAR(64) NULL,
    user_agent VARCHAR(255) NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ok',
    message VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_form (form_id),
    KEY idx_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='表单提交记录'`,

  /* ══════════ 数据处理流程 ══════════ */
  `CREATE TABLE IF NOT EXISTS jdywh_flows (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(128) NOT NULL,
    code VARCHAR(64) NOT NULL,
    description VARCHAR(500) NULL,
    project_id INT UNSIGNED NULL COMMENT '数据来源项目',
    source_type VARCHAR(32) NOT NULL DEFAULT 'project' COMMENT 'project/dataset/table/form',
    source_config LONGTEXT NULL COMMENT '来源配置 JSON',
    nodes LONGTEXT NULL COMMENT '流程节点 JSON',
    edges LONGTEXT NULL COMMENT '节点连线 JSON',
    target_table VARCHAR(128) NULL COMMENT '输出目标表',
    run_mode VARCHAR(16) NOT NULL DEFAULT 'manual' COMMENT 'manual/cron/trigger',
    cron_expr VARCHAR(64) NULL,
    status TINYINT(1) NOT NULL DEFAULT 1,
    run_count INT NOT NULL DEFAULT 0,
    success_count INT NOT NULL DEFAULT 0,
    last_run_at DATETIME NULL,
    last_run_ok TINYINT(1) NULL,
    last_run_msg VARCHAR(500) NULL,
    created_by INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_code (code),
    KEY idx_project (project_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='数据处理流程'`,

  `CREATE TABLE IF NOT EXISTS jdywh_flow_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    flow_id INT UNSIGNED NOT NULL,
    trigger_source VARCHAR(16) NOT NULL DEFAULT 'manual',
    success TINYINT(1) NOT NULL DEFAULT 0,
    input_rows INT NOT NULL DEFAULT 0,
    output_rows INT NOT NULL DEFAULT 0,
    duration_ms INT NULL,
    node_logs LONGTEXT NULL COMMENT '各节点执行日志 JSON',
    message VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_flow (flow_id),
    KEY idx_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='流程运行日志'`,
];

/** 列是否存在 */
async function columnExists(table, column) {
  const rows = await db.query(
    `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

/** 索引是否存在 */
async function indexExists(table, index) {
  const rows = await db.query(
    `SELECT INDEX_NAME AS name FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index]
  );
  return rows.length > 0;
}

async function ensureColumn(table, column, definition) {
  // 迁移只允许作用于本应用的表
  schema.assertOwnTable(table);
  if (await columnExists(table, column)) return false;
  await schema.safeRaw(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`, [], [table]);
  console.log(`[migrate] ${table}.${column} 已添加`);
  return true;
}

/**
 * V16 4.2：内置看板 → AI 报表种子数据（幂等）
 *
 * 幂等键：`report_type='ai' AND source='builtin' AND board_key=?`
 * 已存在则**跳过，不覆盖**（用户可能已经改过名字/配置）。
 *
 * DSL 为「受限 DSL」（契约 §4.3）：只声明白名单区块 + 白名单数据源，
 * **不含任何可执行代码**；前端按 type 渲染既有看板组件。
 * route 指向内置看板页面，保证「查看」仍然打开真实的看板。
 */
const BUILTIN_AI_BOARDS = [
  {
    boardKey: 'zk',
    code: 'ai_board_zk',
    name: '中康智能体客户看板',
    icon: '🤖',
    tags: '中康,智能体,客户看板',
    group: '中康智能体',
    description: '中康智能体客户看板（V16 由系统内置看板转为 AI 报表，DSL 配置驱动）',
    route: '/dashboard/board',
    blocks: [
      { type: 'summary', source: 'board.sign', title: '签约概览' },
      { type: 'kpi', source: 'board.erp', title: '客户 ERP 分布' },
      { type: 'flow', source: 'board.flow', title: '流程状态' },
      { type: 'ranking', source: 'board.chain', title: '连锁排名' },
      { type: 'table', source: 'board.run', title: '策略运行情况' },
    ],
  },
  {
    boardKey: 'crm',
    code: 'ai_board_crm',
    name: '客户签约看板',
    icon: '📝',
    tags: '客户签约,看板',
    group: '中康智能体',
    description: '客户签约看板（V16 由系统内置看板转为 AI 报表，DSL 配置驱动）',
    route: '/dashboard/crm',
    blocks: [
      { type: 'kpi', source: 'board.sign', title: '签约 KPI' },
      { type: 'chart', source: 'board.sign', title: '签约趋势', options: { chartType: 'line' } },
      { type: 'table', source: 'board.run', title: '签约明细' },
    ],
  },
];

async function seedBuiltinAiReports() {
  for (const b of BUILTIN_AI_BOARDS) {
    const exists = await db.queryOne(
      "SELECT id FROM jdywh_reports WHERE report_type = 'ai' AND source = 'builtin' AND board_key = ? LIMIT 1",
      [b.boardKey],
    );
    if (exists) continue;

    /* code 唯一索引：若已被占用（历史遗留）则加后缀，保证幂等且不报错 */
    let code = b.code;
    const codeDup = await db.queryOne('SELECT id FROM jdywh_reports WHERE code = ? LIMIT 1', [code]);
    if (codeDup) code = `${b.code}_v16`;

    const dsl = JSON.stringify({
      spec: 'jdy-bi-dsl/1',
      title: b.name,
      theme: 'light',
      route: b.route,
      blocks: b.blocks,
    }, null, 2);

    await db.query(
      `INSERT INTO jdywh_reports
         (name, code, description, category, report_type, icon, tags, group_name, source, board_key, dsl, status)
       VALUES (?,?,?,?, 'ai', ?,?,?, 'builtin', ?, ?, 1)`,
      [b.name, code, b.description, 'AI', b.icon, b.tags, b.group, b.boardKey, dsl],
    );
    console.log(`[migrate] 内置看板已转为 AI 报表：${b.name}（board_key=${b.boardKey}）`);
  }
}

/**
 * 迁移：把 1.x 的库结构升级到 2.0，保留原有数据
 */
async function migrate() {
  const U = 'jdywh_users';
  await ensureColumn(U, 'email', '`email` VARCHAR(190) NULL AFTER `username`');
  await ensureColumn(U, 'role', "`role` VARCHAR(16) NOT NULL DEFAULT 'editor' AFTER `display_name`");
  await ensureColumn(U, 'status', '`status` TINYINT(1) NOT NULL DEFAULT 1 AFTER `role`');
  await ensureColumn(U, 'email_verified', '`email_verified` TINYINT(1) NOT NULL DEFAULT 0 AFTER `status`');
  await ensureColumn(U, 'last_login_ip', '`last_login_ip` VARCHAR(64) NULL AFTER `last_login_at`');
  // v3.1：个人资料与组织架构
  await ensureColumn(U, 'avatar', '`avatar` MEDIUMTEXT NULL COMMENT "头像（dataURL 或图片地址）"');
  await ensureColumn(U, 'avatar_color', '`avatar_color` VARCHAR(16) NULL COMMENT "头像底色"');
  await ensureColumn(U, 'phone', '`phone` VARCHAR(32) NULL COMMENT "手机号"');
  await ensureColumn(U, 'department_id', '`department_id` INT NULL COMMENT "所属部门ID"');
  await ensureColumn(U, 'position', '`position` VARCHAR(64) NULL COMMENT "职位"');

  // 老库的 role 可能为空，统一补默认值
  await db.raw(
    "UPDATE jdywh_users SET role = 'editor' WHERE role IS NULL OR role = '' OR role NOT IN ('admin','editor','viewer')"
  );
  await db.raw('UPDATE jdywh_users SET status = 1 WHERE status IS NULL');

  // 唯一邮箱索引（若不存在且无重复）
  if (!(await indexExists(U, 'uk_email'))) {
    const dup = await db.queryOne(
      `SELECT email FROM jdywh_users WHERE email IS NOT NULL AND email <> ''
        GROUP BY email HAVING COUNT(*) > 1 LIMIT 1`
    );
    if (!dup) {
      await db.raw('ALTER TABLE jdywh_users ADD UNIQUE KEY uk_email (email)');
      console.log('[migrate] jdywh_users.uk_email 已添加');
    } else {
      console.warn('[migrate] 存在重复邮箱，跳过 uk_email 唯一索引');
    }
  }

  // 会话表补充字段
  const S = 'jdywh_sessions';
  await ensureColumn(S, 'ip', '`ip` VARCHAR(64) NULL');
  await ensureColumn(S, 'user_agent', '`user_agent` VARCHAR(255) NULL');

  // 项目表补充字段
  const P = 'jdywh_projects';
  await ensureColumn(P, 'parse_enabled', '`parse_enabled` TINYINT(1) NOT NULL DEFAULT 1');
  await ensureColumn(P, 'created_by', '`created_by` INT UNSIGNED NULL');
  // v3.0：数据源绑定 + 解析表分离
  await ensureColumn(P, 'datasource_id', '`datasource_id` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT "存储数据源，0=默认库"');
  await ensureColumn(P, 'parsed_table', '`parsed_table` VARCHAR(64) NULL COMMENT "解析后数据表名"');
  await ensureColumn(P, 'raw_table', '`raw_table` VARCHAR(64) NULL COMMENT "解析前原始数据表名"');
  await ensureColumn(P, 'category', '`category` VARCHAR(64) NULL COMMENT "项目分类"');
  await ensureColumn(P, 'tags', '`tags` VARCHAR(255) NULL COMMENT "标签，逗号分隔"');
  // v3.5：数据 ID 来源字段（可指定流水号等业务字段替代简道云 _id 作为数据标识）
  await ensureColumn(P, 'id_field_key', '`id_field_key` VARCHAR(191) NULL COMMENT "数据ID 来源字段"');
  // v3.6：项目分组（多级树形，0/NULL = 未分组）
  await ensureColumn(P, 'group_id',
    '`group_id` INT UNSIGNED NULL COMMENT "所属分组ID，NULL=未分组" AFTER `tags`');
  if (!(await indexExists(P, 'idx_group'))) {
    await schema.safeRaw('ALTER TABLE `jdywh_projects` ADD KEY idx_group (group_id)', [], [P]);
    console.log('[migrate] jdywh_projects.idx_group 已添加');
  }

  // 字段定义表：派生字段源字段键（同一源字段按路径拆出多列，如地址→省/市/区）
  await ensureColumn('jdywh_field_defs', 'source_key',
    '`source_key` VARCHAR(191) NULL COMMENT "派生字段的源字段键" AFTER `parse_path`');

  /* ══════════════════════════════════════════════════════════════
   * V16：报表模型扩展 + 内置看板转 AI 报表（契约 §4.1 / §4.2）
   * ──────────────────────────────────────────────────────────────
   * 需求「中康智能体客户看板和客户签约看板由系统内置看板修改为AI报表」：
   * 旧实现是 frontend/src/pages/reports.tsx 里的 BUILTIN_BOARDS 前端硬编码数组，
   * 数据库里根本没有记录。V16 改为数据库种子（report_type='ai' + source='builtin'）。
   * ══════════════════════════════════════════════════════════════ */
  const R = 'jdywh_reports';
  await ensureColumn(R, 'icon', '`icon` VARCHAR(64) NULL COMMENT "图标（emoji 或图标名）"');
  await ensureColumn(R, 'tags', '`tags` VARCHAR(255) NULL COMMENT "标签，逗号分隔"');
  /* group 是 MySQL 保留字，列名用 group_name，对外 API 字段名仍为 group */
  await ensureColumn(R, 'group_name', '`group_name` VARCHAR(64) NULL COMMENT "分组" AFTER `tags`');
  await ensureColumn(R, 'source', "`source` VARCHAR(16) NOT NULL DEFAULT 'user' COMMENT \"builtin=系统内置 user=用户自建\"");
  await ensureColumn(R, 'board_key', '`board_key` VARCHAR(32) NULL COMMENT "内置看板标识 zk/crm"');
  await ensureColumn(R, 'dsl', '`dsl` MEDIUMTEXT NULL COMMENT "AI 报表受限 DSL 配置(JSON)"');
  await seedBuiltinAiReports();

  /*
   * v3.6 数据迁移：把历史自由文本分类 category 提升为正式分组
   * ----------------------------------------------------------
   * 旧版本用 jdywh_projects.category（VARCHAR 自由文本）表达分类，
   * 无法树形管理与筛选。这里把出现过的 category 值自动建为根分组，
   * 并把对应项目挂上去，保证升级后用户的历史分类不丢失。
   * category 字段本身保留，不删除，避免影响其它读取路径。
   */
  await migrateCategoryToGroups();
}

/**
 * 把历史 category 文本迁移为项目分组
 * 幂等：已存在的同名根分组直接复用，不重复创建。
 */
async function migrateCategoryToGroups() {
  const rows = await db.query(
    `SELECT DISTINCT category FROM jdywh_projects
      WHERE category IS NOT NULL AND TRIM(category) <> ''`
  );
  if (!rows.length) return;

  let created = 0;
  let linked = 0;
  for (const r of rows) {
    const name = String(r.category).trim().slice(0, 64);
    if (!name) continue;

    let g = await db.queryOne(
      'SELECT id FROM jdywh_project_groups WHERE name = ? AND IFNULL(parent_id,0) = 0 LIMIT 1',
      [name]
    );
    if (!g) {
      const ins = await db.query(
        'INSERT INTO jdywh_project_groups (name, parent_id, sort_order) VALUES (?, NULL, ?)',
        [name, created * 10]
      );
      g = { id: ins.insertId };
      created += 1;
    }
    const up = await db.query(
      'UPDATE jdywh_projects SET group_id = ? WHERE category = ? AND group_id IS NULL',
      [g.id, r.category]
    );
    linked += Number(up.affectedRows || 0);
  }
  if (created || linked) {
    console.log(`[migrate] 历史分类已迁移为分组：新建 ${created} 个分组，归位 ${linked} 个项目`);
  }
}

/**
 * 确保内置角色存在（可编辑权限，但不可删除）
 */
async function ensureDefaultRoles() {
  const roles = require('./roles');
  const rows = await db.query('SELECT role_key FROM jdywh_roles');
  const existing = new Set(rows.map((r) => r.role_key));
  let added = 0;
  for (const r of roles.BUILTIN_ROLES) {
    if (existing.has(r.role_key)) continue;
    await db.query(
      `INSERT INTO jdywh_roles (role_key, name, description, permissions, is_system, sort_order)
       VALUES (?,?,?,?,1,?)`,
      [r.role_key, r.name, r.description, JSON.stringify(r.permissions), r.sort_order]
    );
    added += 1;
  }
  if (added) console.log(`[init] 已写入 ${added} 个内置角色`);
}

/** 确保默认管理员存在 */
async function ensureDefaultAdmin() {
  const row = await db.queryOne('SELECT COUNT(*) AS c FROM jdywh_users');
  if (row && Number(row.c) > 0) return { created: false };

  const hash = bcrypt.hashSync(config.defaultAdmin.password, 10);
  await db.query(
    `INSERT INTO jdywh_users (username, email, password_hash, display_name, role, status, email_verified)
     VALUES (?, NULL, ?, '超级管理员', 'admin', 1, 0)`,
    [config.defaultAdmin.username, hash]
  );
  console.log(`[init] 默认管理员已创建: ${config.defaultAdmin.username}`);
  return { created: true, username: config.defaultAdmin.username };
}

/** 写入默认设置（仅补齐缺失项，不覆盖已有值） */
async function ensureDefaultSettings() {
  const rows = await db.query('SELECT skey FROM jdywh_settings');
  const existing = new Set(rows.map((r) => r.skey));
  let added = 0;
  for (const k of Object.keys(settings.DEFAULTS)) {
    if (existing.has(k)) continue;
    await db.query('INSERT INTO jdywh_settings (skey, svalue) VALUES (?, ?)', [k, settings.DEFAULTS[k]]);
    added += 1;
  }
  if (added) console.log(`[init] 已写入 ${added} 项默认系统设置`);

  // v3 迁移：把旧版深色主题与旧站点名升级为数据中台定位
  await migrateSettingsV3();

  // v3 迁移：为旧项目补齐解析表名
  await migrateProjectTables();

  // v3.1 迁移：分享密码明文列（便于管理员查看）
  await ensureColumn('jdywh_shares', 'password_plain',
    '`password_plain` VARCHAR(128) NULL COMMENT "访问密码明文（便于管理员查看）" AFTER `password`');

  // V16.1 迁移：分享描述 + 分享缩略图（浏览器标题栏 / 链接预览 og:title·og:description·og:image）
  await ensureColumn('jdywh_shares', 'description',
    '`description` VARCHAR(500) NULL COMMENT "V16.1：分享描述（og:description）" AFTER `title`');
  await ensureColumn('jdywh_shares', 'thumb',
    '`thumb` VARCHAR(500) NULL COMMENT "V16.1：分享缩略图 URL（og:image）" AFTER `description`');

  // v3.2 迁移：表单类型
  await ensureColumn('jdywh_forms', 'form_type',
    "`form_type` VARCHAR(16) NOT NULL DEFAULT 'fill' COMMENT 'fill/flow/exam' AFTER `project_id`");

  settings.clearCache();
}

/**
 * v3.0 迁移：为 v2 创建的项目补齐 parsed_table / raw_table
 */
async function migrateProjectTables() {
  const rows = await db.query(
    'SELECT id, data_table, parsed_table, raw_table FROM jdywh_projects WHERE parsed_table IS NULL OR parsed_table = ""'
  );
  if (!rows.length) return;

  for (const p of rows) {
    const dataTable = p.data_table || `jdywh_data_${p.id}`;
    const parsedTable = `jdywh_parsed_${p.id}`;
    await db.query(
      'UPDATE jdywh_projects SET data_table = ?, parsed_table = ?, raw_table = ? WHERE id = ?',
      [dataTable, parsedTable, dataTable, p.id]
    );
  }
  console.log(`[migrate] 已为 ${rows.length} 个旧项目补齐解析表名`);
}

/**
 * v3.0 设置迁移
 * 仅当用户未自定义过（仍是旧版默认值）时才升级，避免覆盖用户配置
 */
async function migrateSettingsV3() {
  const legacy = {
    theme_color: ['#4f46e5', '#1f6feb', '#38bdf8'],
    site_name: ['简道云数据推送接收平台', '数据中台'],
    site_short: ['推送接收平台', '数据中台'],
    site_subtitle: ['Jiandaoyun Webhook Receiver', 'Data Middle Platform'],
    site_logo_text: ['简', '数'],
    site_description: [
      '接收简道云数据推送 · 自动建表 · 字段解析 · 日志与数据明细',
      '数据集成 · 数据治理 · 报表开发 · 商业智能 BI · 可视化大屏 · AI 问数',
    ],
    smtp_from_name: ['简道云推送接收平台', '数据中台'],
  };

  let changed = 0;
  for (const key of Object.keys(legacy)) {
    const row = await db.queryOne('SELECT svalue FROM jdywh_settings WHERE skey = ? LIMIT 1', [key]);
    if (!row) continue;
    if (!legacy[key].includes(row.svalue)) continue; // 用户已自定义，跳过
    const next = settings.DEFAULTS[key];
    if (next === undefined || next === row.svalue) continue;
    await db.query('UPDATE jdywh_settings SET svalue = ? WHERE skey = ?', [next, key]);
    changed += 1;
  }
  if (changed) console.log(`[migrate] 已升级 ${changed} 项设置为 v3 默认值（数据中台主题）`);
}

async function bootstrap() {
  for (const sql of DDL) {
    await db.raw(sql);
  }
  await migrate();
  await ensureDefaultRoles();
  const admin = await ensureDefaultAdmin();
  await ensureDefaultSettings();
  return admin;
}

module.exports = { DDL, bootstrap, migrate, ensureDefaultAdmin, ensureDefaultSettings, ensureDefaultRoles, BUILTIN_AI_BOARDS, seedBuiltinAiReports };
