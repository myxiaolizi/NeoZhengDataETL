# 二、后端 src/ 目录结构

> 本文档覆盖 `src/` 下**全部 45 个文件**（1 个入口 + 5 个路由 + 39 个业务模块），
> 每个文件一行说明：职责、关键导出、被谁调用、涉及的 `jdywh_` 数据表。
> 所有描述均来自实际源码的头部注释与 `module.exports`，未做推测。
>
> 上游总纲见 [项目介绍与根目录结构](01-overview-and-root.md)。

---

## 2.1 后端总览

### 应用形态

| 项 | 说明 |
|---|---|
| 运行时 | Node.js ≥ 18，CommonJS（全部文件首行 `'use strict'`） |
| 框架 | Express 4，单例 `app`，`require.main === module` 时才真正 `start()` |
| 模板 | EJS 3（`views/`），V4.0 起仅作降级路径与表单 POST 入口 |
| 前端 | React SPA（`frontend/dist`），由 `routes/spa.js` 托管 |
| 元数据库 | MySQL 8，连接池由 `src/db.js` 惰性创建 |
| 导出 | `module.exports = { app, start }`（`server.js` 末尾） |

`server.js` 只做四件事：装配中间件 → 挂载路由 → 定义 404/500 → 启动流程（探库、建表、起服务、写 PID 文件）。

### 中间件与路由挂载顺序（`src/server.js` 实际代码顺序）

严格按代码行序，**顺序本身承载语义**（多处注释写明「必须放在前面」）：

| 序号 | 位置 | 内容 | 为什么在这个位置 |
|---|---|---|---|
| 1 | L15–L18 | `disable('x-powered-by')`、`trust proxy`、`view engine=ejs`、`views` | 基础设置 |
| 2 | L21–L41 | `app.locals.esc` / `app.locals.fmtTime` | 模板全局助手（HTML 转义、时间格式化） |
| 3 | L44 | `app.use('/public', express.static(...))` | 静态资源，`maxAge: 1h` |
| 4 | L48 | `app.use('/jdy', express.raw({ type:'*/*' }))` | **推送入口需要原始字符串做签名校验**，故先用 `raw` 独占 `/jdy` |
| 5 | L49–L50 | `express.json` / `express.urlencoded` | 其余路由的 JSON / 表单解析，`limit = config.maxBodySize`（默认 20mb） |
| 6 | L53 | `auth.middleware` | 解析 `jdy_sid` Cookie → `req.user`，并注入模板全局变量 |
| 7 | L56 | `GET /healthz` | 健康检查，内部 `db.ping()`，失败返回 500 + `status:db_error` |
| 8 | L66 | `app.use('/jdy', routes/push)` | 简道云数据推送 / 流程推送接收 |
| 9 | L67 | `app.use('/api', routes/api)` | 183 个 REST 端点的主入口 |
| 10 | L68 | `app.use('/f', routes/public-forms)` | 公开表单（无需登录，靠 `public_token`） |
| 11 | L82 | `app.use('/', routes/pages)` | 保留的表单 POST 与 `/s/:token`、`/f/:token` 落地页 |
| 12 | L85 | `spa.mountSpa(app)` | SPA 静态托管 + BrowserRouter 回退（只处理前面未命中的 GET/HEAD） |
| 13 | L88 | 404 兜底 | `/api/*` 与 `/jdy/*` 返回 JSON，其余 `text/plain` |
| 14 | L99 | 错误处理 | `/api/*` 返回 JSON 500；其他渲染 `error` 模板 |

**关键设计**：`/jdy` 的 `express.raw` 在 `express.json` **之前**挂载，否则推送报文体已被 JSON 解析，
签名无法按原始字节校验。

### 路由前缀一览

| 前缀 | 模块 | 鉴权 | 说明 |
|---|---|---|---|
| `/jdy` | `routes/push.js` | 令牌 + 可选签名 | 简道云推送接收入口，`POST /jdy/push/:token` |
| `/api` | `routes/api.js` | 公开段 + `auth.requireAuthApi` | 主 REST API，183 个端点 |
| `/f` | `routes/public-forms.js` | 无（令牌 + IP 限流） | 公开表单结构与提交 |
| `/` | `routes/pages.js` | 混合 | 登录/注册/找回密码表单 POST、`/logout`、`/verify-email`、`/s/:token` |
| `/public` | 静态 | 无 | CSS/JS/图片等静态资源 |
| `/healthz` | `server.js` | 无 | 健康检查 |
| 其余 GET | `routes/spa.js` | 前端自行处理 | 回退到 `index.html` |

### 启动流程（`start()`，L156–L252）

1. 打印横幅与环境、数据库连接信息；
2. `db.ping()` 确认库可用；
3. `bootstrap.bootstrap()` —— 幂等建表（`DDL` 数组）、建默认角色/管理员/设置；
4. 读取 `settings.all()`，打印站点名、邮件是否就绪、自助注册开关；
5. `auth.cleanupExpired()` 清理过期会话，并注册**每小时**的 `setInterval(...).unref()`；
6. 邮箱推送初始化：`mailPush.ensureMetaTables()` → `mailAccounts.ensureTable()` →
   `mailAccounts.migrateFromSettings()` → `mailInbox.start()`（按设置启动定时轮询）；
7. `app.listen(config.port, config.host)`，**在 listen 成功的回调里**才写 PID 文件；
8. 监听 `server.on('error')`：`EADDRINUSE` 打印可操作指引后 `exit(0)`（避免上层守护误判崩溃），
   `EACCES` 提示权限后 `exit(1)`；
9. `SIGTERM` / `SIGINT` 优雅关闭：`server.close` → 删 PID → `db.close()`，8 秒兜底强制退出。

**PID 文件**：`process.env.JDY_PID_FILE || '/www/server/nodejs/vhost/pids/jdy-push.pid'`。
由进程自己在 listen 成功后写入（`process.pid` 一定是真实监听者），本地无该目录时只提示一次，
不刷日志；删除时先比对内容是否为自己，避免误删新实例的 pid。

---

## 2.2 入口文件

| 文件 | 大小 | 说明 |
|---|---|---|
| [server.js](../../src/server.js) | 10.0 KB / 261 行 | Express 应用装配与进程生命周期唯一入口。按固定顺序装配静态资源、`/jdy` 的 `express.raw`（签名需要原始串）、`express.json`/`urlencoded`、`auth.middleware`、`/healthz`，再依次挂载 `/jdy`、`/api`、`/f`、`/`、SPA，最后是 404 与错误处理。`start()` 依次探库、`bootstrap.bootstrap()` 建表、打印设置摘要、每小时清理过期会话、初始化邮箱推送（`ensureMetaTables` / `migrateFromSettings` / `mailInbox.start`）后 `listen`，并在 listen 成功回调里写 PID 文件；`EADDRINUSE` 以 0 退出、`EACCES` 以 1 退出；`SIGTERM`/`SIGINT` 走 `server.close → removePidFile → db.close`，8 秒兜底强退。导出 `{ app, start }`。 |

---

## 2.3 路由层 `src/routes/`

路由层是本项目唯一的 HTTP 边界：**只做参数校验、鉴权与格式化，业务逻辑一律下沉到 `src/` 模块**。

| 文件 | 大小 | 说明 |
|---|---|---|
| [api.js](../../src/routes/api.js) | 142.4 KB / 3617 行 | 主 REST API，**183 个端点**。前 265 行为**公开段**（`/api/public/*` 站点信息、看板公开分享、AI 分享公开元信息与公开问数），注释明确「必须在 `requireAuthApi` 之前」；L268 `router.use(auth.requireAuthApi)` 之后全部需要登录。分区依次为：当前用户 → 概览 → 项目分组 → 项目 → 字段设置 → 接收日志 → 数据明细 → 模拟推送 → 用户管理（管理员）→ 系统设置（管理员）→ 工具 → 角色与权限 → 数据源管理 → 数据集 → 报表 → 分享 → 数据集成 → AI 问数（含 V10 术语/SQL 示例/分享）→ 数据治理 → 审计日志 → 系统概览 → 组织架构 → 表单引擎 → 数据处理流程 → 个人资料 → CRM 客户签约看板 → 全量看板 → 客户详情 → agg 短信营销分片 → 邮箱推送。另外导出 `PUBLIC_SETTING_KEYS` 供其它模块复用公开设置白名单。`crmboard`、`crmdash`、`aggdata`、`log-describe` 均在此处按需 `require`（懒加载）。 |
| [pages.js](../../src/routes/pages.js) | 22.5 KB / 682 行 | SPA 接管后的**服务端表单处理器**。默认模式（`JDY_LEGACY_PAGES !== '1'`）下用一个前置中间件把所有 GET/HEAD 交给 SPA（`next('router')`），仅白名单 `SERVER_GET_PATHS = ['/logout','/verify-email']` 继续由本文件处理；POST 一律放行给下面的路由。保留端点：`POST /login`、`POST /register`、`POST /forgot-password`、`POST /reset-password`，`GET /logout`、`GET /verify-email`，以及邮件里的分享链接 `GET /s/:token` 与公开表单落地页 `GET /f/:token`、公开介绍页 `GET /intro`。设置 `JDY_LEGACY_PAGES=1` 可临时回退到旧 EJS 全量渲染（应急用）。 |
| [push.js](../../src/routes/push.js) | 20.6 KB / 470 行 | 简道云推送接收入口，单端点 `POST /jdy/push/:token?nonce=&timestamp=`。流程：解析 `clientIp`（优先 `x-forwarded-for` 首段）→ 按 token 找项目（`projects.getProjectByToken`）→ 校验 nonce/timestamp 与签名（`jdy.verifySignature`）→ `schema.ensureProjectTables(project.id)` 确保原始/解析/日志表存在 → 本地 `schema_normalize(body)` 归一取值 → 用 `flow.parse(body)` 判定是否流程推送：**流程推送**走 `flowIngest.handle(project, flowPush, rawBody)`（一条一行 + 五待办展开子表），**数据推送**（`data_create`/`data_update`/`data_recover`）走 `fields.getFieldDefMap` → 缺失字段 `fields.autoRegisterFields` 自动登记 → 合入派生字段定义后 `schema.syncFieldColumns` 建原始列与 `<column>_p` 解析列 → 以实际表列为准组装值 → `schema.upsertRecord` 落库。结束统一 `schema.writeLog(project.id, …)` 写 `jdywh_log_N`，并由 `log-describe` 生成自然语言变更描述（流程推送额外拼上运行态同步结果）。失败分支按 `config.pushFailVisible` 决定返回非 2xx（403/400/500）还是统一 200，使简道云侧能看到失败。`SYSTEM_VALUE_KEYS` 定义从推送报文中取系统字段的键名。 |
| [public-forms.js](../../src/routes/public-forms.js) | 2.5 KB / 87 行 | 公开表单接口（无需登录），仅凭表单 `public_token` 访问且表单须开启「公开填写」。两个端点：`GET /:token/schema` 返回表单结构（不存在 404、停用 403、未公开 403），`POST /:token/submit` 走 `forms.submit(token, body, { byToken:true, submitter:'匿名用户', ip, userAgent })`，校验失败按 `err.validation` 返回 400 + 字段级错误。内置**进程内限流**：同一 IP 每分钟最多 20 次（`RATE` Map + `RATE_WINDOW=60000` + `RATE_MAX=20`），超限 429，并有 `setInterval(...).unref()` 定期清理过期记录。 |
| [spa.js](../../src/routes/spa.js) | 3.8 KB / 116 行 | SPA 静态托管与前端路由回退，导出 `{ mountSpa, resolveDistDir }`。`resolveDistDir()` 依次尝试 `JDY_SPA_DIR` → `frontend/dist` → `public/spa`，取第一个存在 `index.html` 的目录；`mountSpa(app)` 先拦截后端专属前缀 `BACKEND_PREFIXES = ['/api','/jdy','/healthz','/public','/.well-known']`，只处理 GET/HEAD，再 `express.static(distDir)` 托管资源，未命中且不像静态资源（`looksLikeAsset` 判扩展名）时 `sendFile(index.html)` 回退；**不吞掉带扩展名的资源 404**，避免浏览器把 HTML 当 JS/CSS 拿到导致 MIME 错误。 |

---

## 2.4 基础设施与工具模块

| 文件 | 大小 | 说明 |
|---|---|---|
| [config.js](../../src/config.js) | 2.5 KB / 76 行 | 全站配置的**唯一来源**，`require('dotenv').config()` 后从环境变量读取并给默认值。导出单个对象：`env/isProd`、`port`(8781)、`host`、`db`(连接参数)、`tablePrefix`（默认 `jdywh_`，作为「只允许操作此前缀表」的白名单）、`sessionSecret`、`defaultAdmin`、`maxBodySize`(20mb)、`requireSignature`、`pushFailVisible`、`sessionTtl`(7 天)、`paths`(root/views/public)。`pushFailVisible` 的注释解释了取舍：默认 1 让失败可见但可能触发简道云重试；设 0 恢复「一律 200」旧行为。 |
| [db.js](../../src/db.js) | 1.4 KB / 69 行 | MySQL 连接池封装，`mysql2/promise`，池惰性创建（`waitForConnections`、`queueLimit:0`、`enableKeepAlive`）。导出 `{ getPool, query, queryOne, raw, withTransaction, ping, close }`：`query` 走 `execute`（预编译 + 占位符，全项目默认路径），`raw` 走 `query`（用于 DDL / 动态表名，注释要求调用方自行保证标识符安全），`withTransaction` 提供 begin/commit/rollback + `conn.release()`。**所有业务模块的数据库访问最终都汇到这里。** |
| [ident.js](../../src/ident.js) | 3.1 KB / 90 行 | SQL 标识符安全工具。`RESERVED` 收集 MySQL 保留字（冲突时追加下划线）；`sanitizeIdent` 只保留 `[A-Za-z0-9_]`、折叠下划线、首字符非数字、转小写；`makeColumnName` 生成不冲突列名；`makeTableName`/`makeLogTableName` 按项目 ID 生成表名；`quoteIdent` 用反引号包裹并转义内部反引号（`` ` `` → ` `` `）。被 `fields`/`schema`/`projects`/`flows`/`mail-push`/`api` 等广泛复用。 |
| [bootstrap.js](../../src/bootstrap.js) | 30.4 KB / 696 行 | 启动期建表与种子数据。`DDL` 是 22 条 `CREATE TABLE IF NOT EXISTS`（全部幂等），覆盖系统表：`jdywh_users`、`jdywh_sessions`、`jdywh_resets`、`jdywh_settings`、`jdywh_login_logs`、`jdywh_projects`、`jdywh_project_groups`、`jdywh_field_defs`、`jdywh_datasources`、`jdywh_roles`、`jdywh_datasets`、`jdywh_reports`、`jdywh_shares`、`jdywh_integrations`、`jdywh_integration_logs`、`jdywh_ai_chats`、`jdywh_audit_logs`、`jdywh_departments`、`jdywh_forms`、`jdywh_form_records`、`jdywh_flows`、`jdywh_flow_logs`。导出 `{ DDL, bootstrap, migrate, ensureDefaultAdmin, ensureDefaultSettings, ensureDefaultRoles }`；`bootstrap()` = 执行 DDL + `migrate()` 老库增列 + 三个 ensure 函数，返回 `{ created, username }`。由 `server.js` 在 listen 之前调用。 |
| [settings.js](../../src/settings.js) | 20.6 KB / 438 行 | 系统设置（键值对 + 内存缓存），表 `jdywh_settings`。`DEFAULTS` 给出全部默认值（站点/安全/邮件/推送四组），`GROUPS` 是界面渲染用的分组元数据（字段 key/label/type/hint），`SECRET_KEYS = ['smtp_pass','ai_api_key','mail_imap_pass']` 标识需掩码输出的敏感项。导出 `{ DEFAULTS, GROUPS, SECRET_KEYS, DEFAULT_CACHE_TTL_MS, load, all, get, getBool, getInt, set, setMany, isConfigured, mailReady, cacheTtlMs, clearCache }`。`mailReady()` 判定「开关打开且 host/user/pass 齐全」。几乎每个模块都依赖它读配置。 |
| [auth.js](../../src/auth.js) | 13.2 KB / 396 行 | 登录态与会话。Cookie 名 `jdy_sid`，令牌 32 字节随机 hex，会话存 `jdywh_sessions`，登录日志写 `jdywh_login_logs`，重置令牌写 `jdywh_resets`。导出 `{ COOKIE_NAME, login, logout, register, resolveSession, changePassword, requestPasswordReset, resetPassword, checkResetToken, sendVerifyMail, verifyEmail, cleanupExpired, logLogin, recentFailures, middleware, requireAuth, requireAuthApi, requirePerm, requirePermPage, requireAdminApi, requireAdminPage, setSessionCookie, clearSessionCookie, clientIp }`。`middleware` 挂在 `server.js` 全局，负责解析 Cookie→`req.user` 并注入模板变量；`requireAuthApi`/`requirePerm` 系列是 `routes/api.js` 与 `routes/pages.js` 的鉴权闸门。 |
| [users.js](../../src/users.js) | 11.3 KB / 367 行 | 用户仓储与权限判定，主表 `jdywh_users`，关联 `jdywh_roles`/`jdywh_sessions`/`jdywh_resets`/`jdywh_departments`/`jdywh_projects`。带角色字典缓存（`loadRoles` / `clearRoleCache`），`can(user, permission)` 依据 `user.permissions` + `roles.canSync` 判定，`isAdmin` 判管理员。导出 `{ loadRoles, clearRoleCache, roleExists, can, isAdmin, publicUser, findById, findByLogin, findByEmail, findByUsername, list, stats, validEmail, validUsername, minPasswordLength, createUser, updateUser, deleteUser, verifyPassword, setPassword, changeOwnPassword, createResetToken, consumeResetToken, cleanupResets, markEmailVerified, touchLogin }`。密码用 `bcryptjs` 哈希。 |
| [roles.js](../../src/roles.js) | 10.5 KB / 318 行 | 角色与权限体系，表 `jdywh_roles` + `jdywh_users`。权限点按「模块:操作」命名，`PERMISSION_GROUPS` 是界面权限矩阵的结构（project/data/log/report… 各含 `key/name/desc`），`ALL_PERMISSIONS`/`PERMISSION_NAMES` 为扁平索引，`BUILTIN_ROLES` 是内置 admin/editor/viewer（可改权限不可删）。导出 `{ PERMISSION_GROUPS, ALL_PERMISSIONS, PERMISSION_NAMES, BUILTIN_ROLES, list, getByKey, permissionMap, clearPermCache, roleCan, can, canSync, create, update, remove, publicRole, parsePerms }`。`canSync` 是同步版权限判定，供 `users.can` 在不 await 的场景调用。 |
| [schema.js](../../src/schema.js) | 34.4 KB / 940 行 | **动态表结构管理的核心**，也是全项目表名规则的来源。`makeTableName(projectId)` → `jdywh_data_N`（原始表）、`makeParsedTableName` → `jdywh_parsed_N`（解析表）、`makeLogTableName` → `jdywh_log_N`（接收日志）、`makeSubTableName(projectId, fieldKey)` → `jdywh_sub_N_<key>`（展开子表）。安全约束：`assertOwnTable` 强制表名以 `config.tablePrefix` 开头且仅 `[A-Za-z0-9_]`，`isOwnTable` 做无抛错判定，所有 DDL/DROP 前必须过它。能力：列 COMMENT 写中文「简道云字段名称」、解析列（`<column>_p` 兼容旧命名）、列类型推断与升级、子表写入、`upsertRecord`/`upsertInto` 幂等落库、`writeLog`、`previousPayloadOf`（取上一次 payload 供日志比对）。导出约 33 项，含 `META_COLUMNS, safeRaw, ensureTableFor, ensureProjectTables, syncFieldColumns, buildColumnContext, writeSubTable, deleteSubTableRows, getDataColumns, getSubTables` 等。 |
| [fields.js](../../src/fields.js) | 44.1 KB / 1234 行 | 字段定义与解析引擎（需求 5 / 需求 7），表 `jdywh_field_defs`。`SYSTEM_FIELDS` 把简道云 12 个系统字段映射到列名（`jdy_form_name`、`jdy_data_id`、`sys_creator`、`sys_flow_state` 等），`INTERNAL_COLUMNS` 是 `id/jdy_op/jdy_op_time/raw_json/received_at/updated_at` 等内部保留列。`PARSE_MODES`/`PARSE_MODE_MAP`/`PARSE_MODE_ALIASES` 定义解析方式，`parseFieldTable` 解析粘贴的 Markdown「字段对照表及 JSON 样例」，`parseValue` 把 JSON 结构字段（如成员 `{"_id","name"}`）加工成可读值，`shouldExpand` 判定数组字段是否展开子表。导出含 `canonicalMode, columnForField, parsedColumnOf, isParsedColumn, reconcileFieldDefs, purgeInvalidFieldDefs, normalizeParseModes, listFieldDefs, getFieldDefMap, saveFieldDefs, updateFieldDef, bulkSetParseMode, autoRegisterFields, gradeExam` 等。 |
| [audit.js](../../src/audit.js) | 5.4 KB / 163 行 | 操作审计，写 `jdywh_audit_logs`，查询时关联 `jdywh_login_logs`。`ACTION_NAMES` 是动作码 → 中文名的字典（`login`/`logout`/`user.create`/`project.update`/`field.import` 等）。导出 `{ log, list, stats, cleanup, actionName, ACTION_NAMES }`；`log()` 被各写操作端点调用，`list()`/`stats()` 供审计页面。 |
| [departments.js](../../src/departments.js) | 5.9 KB / 189 行 | 组织架构（多级部门树），表 `jdywh_departments` + `jdywh_users`（统计部门人数）。`publicDept` 做行→API 结构映射（`parentId`、`userCount` 等）。导出 `{ list, tree, getById, create, update, remove, usersOf, stats, ensureDefaults, publicDept }`。 |

---

## 2.5 数据接入与推送入库

| 文件 | 大小 | 说明 |
|---|---|---|
| [jdy.js](../../src/jdy.js) | 4.1 KB / 137 行 | 简道云数据推送协议工具（参考 hc.jiandaoyun.com/open/11507）。`OP_LABELS` 把事件码翻成中文（`data_create` 数据提交、`data_update` 数据修改、`form_update` 表单结构变更、`flow_task_change` 流程待办变更…），`OP_GROUPS` 归大类。导出 `{ OP_LABELS, OP_GROUPS, opLabel, opGroup, calcSignature, verifySignature, extractDataId, extractFormName, extractEntryId, extractOpTime }`。`calcSignature`/`verifySignature` 是 `routes/push.js` 的签名校验基础（因此该路由必须先挂 `express.raw`）。 |
| [flow.js](../../src/flow.js) | 10.8 KB / 271 行 | 简道云**流程推送**报文解析（schema 2.0）。文件头注释记录了根因：流程推送报文形如 `{ schema:'2.0', header:{event_type,...}, event:{...} }`，**没有 `op`/`data`**，旧代码只认 `body.op` 于是当成未知事件、只写日志不落数据——这正是「简道云显示成功但这边没数据」的原因。设计：字段键统一用下划线展平（`header_event_type`），一条推送 = 一行记录，`instance_id + created_at` 作数据 ID 保证幂等，五个待办列表按「展开子表」写入。`FLOW_EVENT_LABELS` 事件中文名，`TASK_LISTS` 定义待办列表键映射。导出 `{ FLOW_EVENT_LABELS, FLOW_FIELDS, TASK_LISTS, TASK_STATUS_TEXT, FINISH_ACTION_TEXT, isFlowPayload, parse, fieldSpecs, taskText, assigneeName, normalizeTaskRow, TASK_FIELD_NAMES }`。 |
| [flow-ingest.js](../../src/flow-ingest.js) | 21.5 KB / 496 行 | 流程推送入库。一条推送落一行主表、五个待办列表展开子表；字段定义缺失时按 `flow.fieldSpecs()` 自动注册（写 `jdywh_field_defs`），保证首次推送即可落库。除原始事件外，还把「流程运行态」（当前节点/当前负责人 + 8 个节点完成时间）同步到表单推送项目的解析表，使业务系统读一张表就能拿全字段。导出 `{ handle, ensureFlowFieldDefs, syncRunStateToFormProject, eventsOfInstance, triggerOnPushAfterSave, nodeTimeSyncEnabled, nodeTimeFreshMs, NODE_TIME_FRESH_DEFAULT_MS, resolveTimeColumns, fillMissingNodeTimes, clearTimeColumnCache }`；`handle` 由 `routes/push.js` 在识别为流程推送时调用。 |
| [flow-state.js](../../src/flow-state.js) | 17.9 KB / 417 行 | 流程状态聚合器，把流程事件流折算成业务系统要的【当前节点】【当前负责人】+ 8 个节点完成时间。文件头写明了与业务方确认的口径：只有 `finish_action ∈ {forward, batch_forward, auto_approve}` 才算完成（`transfer` 转交不算、`back`/`close`/`activate` 不算）；同节点多次完成取**首次**；发生回退后当前节点及之后一律留空；`NODE_ALIAS` 归一历史节点名（开通→策略开通等）。注释还记录了 `NODE_ORDER` 首节点写「开始」而 `NODE_ALIAS` 归一成「销售签约」导致 `indexOf` 恒为 -1 的历史 bug。导出 `{ NODE_ORDER, CANONICAL_NODE_ORDER, COMPLETE_ACTIONS, NON_COMPLETE_ACTIONS, TRANSFER_ACTIONS, NODE_ALIAS, TIME_FIELD_OF_NODE, DERIVE_DEFAULTS, normalizeNode, nodeIndex, timeFieldOfNode, isMainNode, toMs, aggregate, deriveNodeTimes, toLocalString }`。 |
| [log-describe.js](../../src/log-describe.js) | 9.1 KB / 238 行 | 接收日志的「自然语言变更描述」（需求 2026-10-27：不打开 JSON 也能看懂改了什么）。原则是**只做有据可查的描述**：字段确实变了才提，优先与上一次成功推送的同一条数据比较（回放历史日志），首次收到该数据则逐列说明新增了哪些字段，流程推送单独一套说法（节点/负责人/待办变化）。`brief()` 把值压缩成短文本（UTC ISO 时间自动 +8 小时转北京时间、数组显示 `[N 项]`、对象优先取 `name`/`phone`）。导出 `{ describeFormChange, describeFlowChange, describeDataPush, joinDescriptions, brief, DATA_OP_LABEL }`，被 `routes/push.js` 与 `routes/api.js`（L1036 懒加载）调用。 |
| [projects.js](../../src/projects.js) | 12.5 KB / 373 行 | 推送项目仓储，主表 `jdywh_projects`，关联 `jdywh_field_defs`/`jdywh_project_groups`/`jdywh_datasources`/`jdywh_users`。项目是数据落库的枢纽：每个项目有 `code`（由 `sanitizeIdent` 归一 + `uniqueCode` 去重）、推送令牌（`crypto.randomBytes(16).toString('hex')`）、绑定的 `datasource_id`、分组 `group_id`。`parseFieldMap` 解析字段映射，`touchProject` 更新最后推送时间。导出 `{ resolveIdField, createProject, getProject, getProjectByToken, listProjects, updateProject, regenerateToken, deleteProject, touchProject, parseFieldMap, projectStats, globalStats, newPushToken }`。 |
| [datasources.js](../../src/datasources.js) | 7.2 KB / 210 行 | 数据源**仓储**（只管元数据 CRUD），表 `jdywh_datasources` + `jdywh_projects`（查引用）。**id=0 是默认数据源**（应用自身元数据库，来自 .env，不落库）。`publicRow` 做行→API 映射并**不回传密码**。导出 `{ list, getById, getPublic, create, update, remove, test, tables, columns, publicRow }`；`test`/`tables`/`columns` 委托给 `datasource.js` 的驱动层执行。 |
| [datasource.js](../../src/datasource.js) | 34.5 KB / 1010 行 | 多数据源**驱动层**：连接池管理与跨库 SQL 方言适配。`DRIVERS` 声明 13 种驱动（mysql/mssql/postgres/oracle/sqlite/mongodb/redis/clickhouse/dm/kingbase/gbase/oceanbase/tidb），`DIALECTS` 把国产库映射到兼容方言（dm→oracle、kingbase→postgres、gbase/oceanbase/tidb→mysql）。连接池按数据源缓存、配置变更后 `invalidate` 自动失效重建；默认源（id=0）来自 `config`/`settings`。导出 `{ DRIVERS, DIALECTS, DRIVER_HINTS, driverOf, dialectOf, driverGroups, driverAvailable, buildConfig, defaultDataSource, signatureOf, getPool, invalidate, invalidateAll, query, raw, queryOne, testConnection, listTables, listColumns, tableExists, quoteIdent, quoteIdentText, normalizeSql, describeDbError, trimSqlTail, hasRowLimit, paginate, toMssqlParams, toPgParams, toOracleParams, poolStats }`。被 `datasources`/`reports`/`flows`/`ai`/`ai-scope`/`api` 调用。 |
| [dstypes.js](../../src/dstypes.js) | 33.1 KB / 780 行 | 数据源**类型目录**（静态数据，不碰数据库）：「15 大类、上百种具体类型」的元数据清单，供「新建数据源」界面选择。`CATEGORIES` 是 15 个大类（rdb/数仓/国产库/轻量库/文档缓存/图谱向量/时序/消息队列/注册配置/办公软件/业务系统/腾讯系/阿里系/云服务/其他，含 icon 与 desc），`TYPES` 每项声明 `conn`（sql/api）、`driver`、`auth`（none/bearer/basic/apikey/oauth2/appkey）与所需参数。导出 `{ CATEGORIES, TYPES, TYPE_MAP, DRIVER_PKG, grouped, get, stats, isAvailable, driverStatus, hasModule }`；`hasModule` 检查驱动 npm 包是否已安装，`isAvailable` 据此判可用性。 |

---

## 2.6 数据治理与流程引擎

| 文件 | 大小 | 说明 |
|---|---|---|
| [flows.js](../../src/flows.js) | 103.0 KB / 2469 行 | **数据处理流程引擎**（全项目最大文件之一）：拖拽编排节点，把输入数据加工后输出到目标表，表 `jdywh_flows`/`jdywh_flow_logs`，输入读 `jdywh_projects` 与 `jdywh_form_records`。`NODE_TYPES` 按 source（如 `source_project` 项目数据表、`source_sql` SQL 查询）/ transform / sink 三类定义节点，每个节点有 `fields` 参数 schema。能力：`topoSort` 拓扑排序、`run` 执行、`runSource`/`runClean`/`runSink` 分阶段执行、`collectInput` 取数、事件收敛类节点（`runJoin` 关联、`runPickCurrentTask` 取当前待办、`runComputed` 计算列）、`on_push` 推送触发（`triggerOnPush`/`selectOnPushFlows`/`beginFlowRun`/`endFlowRun` 闸门控制）、V9 尾随补跑的 deferred rerun 机制（合并期间的新推送不再丢弃）。导出 50 余项，含 `assertFlowSupported`/`unknownNodeTypes`（节点类型缺失时给中文可读错误）、`ensureUpsertKey`、`evalExpression`、`publicFlow`。 |
| [forms.js](../../src/forms.js) | 21.1 KB / 618 行 | 表单引擎：拖拽设计表单、收集数据并写入指定项目的数据表，支持公开填写与内部填写，表 `jdywh_forms`/`jdywh_form_records`，写入目标为项目数据表。`FIELD_TYPES` 定义 20+ 字段类型（text/textarea/number/amount/percent/select/radio/checkbox/date/datetime/time/daterange/member/department/image/file/address/location/rating…），另有 `FORM_TYPES`/`WIDTHS`/`OPTION_LAYOUTS`/`FLOW_STATUS` 布局与状态常量。导出 `{ FIELD_TYPES, FIELD_TYPE_MAP, FORM_TYPES, FORM_TYPE_MAP, WIDTHS, WIDTH_MAP, OPTION_LAYOUTS, FLOW_STATUS, list, getById, getByToken, create, update, remove, regenerateToken, submit, listRecords, stats, normalizeFields, validateAndCast, publicForm, gradeExam }`；`submit` 由 `routes/public-forms.js`（公开）与 `routes/api.js`（内部）共同调用。 |
| [data-filter.js](../../src/data-filter.js) | 11.8 KB / 348 行 | 数据明细多条件筛选的**唯一实现**（V6.1 要求 9）。存在理由写在头部：需求要求「邮箱推送和数据项目的数据明细，格式和功能要一致」，格式由前端共用组件保证，**功能必须由后端共用同一段 SQL 生成逻辑**保证，否则两处各写一套必然漂移。唯一入口 `appendFilters()` 被三处端点共用：`GET /api/projects/:id/parsed`、`GET /api/mail-push/projects/:id/rows`（经 `mail-push.queryRows`）、`GET /api/projects/:id/records`。`op` 语义固定：`contains`→LIKE、`eq`→`=`、`ne`→`(<> OR IS NULL)`、`empty`→`(IS NULL OR ='')`、`notempty`→相反。安全强制：列名必须命中调用方传入的**真实物理列白名单**（否则整条条件丢弃）、列名一律 `quoteIdent`、**所有值走占位符绑定**、最多 `MAX_FILTERS`(20) 条、脏 JSON 静默忽略不报 400。导出 `{ MAX_FILTERS, OPS, VALUELESS_OPS, ERRORS, parseFilters, buildFilterWhere, buildFilterSql, appendFilters, filterMeta, toColumnSet, normalizeRaw }`。 |
| [integrations.js](../../src/integrations.js) | 19.5 KB / 574 行 | 数据集成（双向），表 `jdywh_integrations`/`jdywh_integration_logs`，关联 `jdywh_projects`。`pull` = 定时/手动调第三方接口采集数据写入项目数据表；`push` = 把项目数据推送到指定服务器（支持 webhook 触发与定时）。`publicRow` 做行→API 映射，`maskHeaders` 对请求头做掩码避免泄露凭据，`buildHeaders` 组装鉴权头，`getByPath` 按路径从响应里取数据数组。导出 `{ list, get, getInternal, create, update, remove, run, runPull, runPush, listLogs, stats, buildHeaders, getByPath, maskHeaders, publicRow }`。 |

---

## 2.7 报表 / 数据集 / BI

| 文件 | 大小 | 说明 |
|---|---|---|
| [reports.js](../../src/reports.js) | 25.7 KB / 735 行 | 数据集与报表（BI），表 `jdywh_datasets`/`jdywh_reports`/`jdywh_shares`，取数可走 `jdywh_datasources` 与 `jdywh_projects`。数据集三种来源：`sql`（在指定数据源上执行 SQL）、`table`（直接读某张表）、`project`（读推送项目的原始表或解析表）。`CHART_TYPES`/`DASHBOARD_ROWS`/`DASHBOARD_THEME` 是大屏与图表常量。安全侧：`assertReadOnly`/`testSql`/`validateDatasetSql`/`precheckDatasetSql`/`stripLiteralsAndComments` 组成「只读 SQL 校验链」——先剥离字面量与注释再做关键字判定，防止用字符串注释绕过。导出 `{ CHART_TYPES, DASHBOARD_ROWS, DASHBOARD_THEME, listDatasets, getDataset, createDataset, updateDataset, deleteDataset, runDataset, previewDataset, inferFields, buildQuery, assertReadOnly, testSql, validateDatasetSql, precheckDatasetSql, stripLiteralsAndComments, listReports, getReport, createReport, updateReport, deleteReport, runReport, listShares, createShare, deleteShare, toggleShare, accessShare, publicReport, publicDataset, publicShare }`。 |
| [aggdata.js](../../src/aggdata.js) | 5.1 KB / 192 行 | agg 数据加载器（**不碰数据库**）：读取 `data/agg-split`（可用 `AGG_DIR` 覆盖）下按月份拆分的列式分片，提供索引与摘要（看板首屏无需加载全量）、按月加载、聚合统计（按月/按分类汇总、Top N）。数据格式 `{ cols:[...], rows:[[...]] }`；内存缓存 `CACHE_MAX = 6` 个月，避免把大分片全量驻留。导出 `{ DEFAULT_DIR, NUMERIC_FIELDS, dataDir, index, summary, loadMonth, loadMonths, loadAll, toObjects, byMonth, byCategory, topN, kpis, clearCache }`，由 `routes/api.js`（L3129 起）懒加载用于短信营销分片端点。 |

---

## 2.8 CRM 客户看板（V5.0 / V7.1）

| 文件 | 大小 | 说明 |
|---|---|---|
| [crmboard.js](../../src/crmboard.js) | 95.6 KB / 2509 行 | V5.0 中康智能体客户看板的数据聚合模块（全项目最大文件）。数据源在文件头逐个列明：`jdywh_parsed_16`（CRM 表单推送，每个签约客户一行）、`jdywh_parsed_102`（CRM 流程推送，流程事件）、`jdywh_mail_30`（运行汇总，最新一天）、`jdywh_mail_31`（运行明细，最新一天）、`zkcrm-ry`（人员对应表，区域/省份/销售/客服/解决方案/产品经理/实施）。`C` 常量集中定义 `jdywh_parsed_16` 的关键列（简道云 widget ID → 业务含义），口径集中在 `_work/V5-CONTRACT.md §3.2`，注释要求「改口径先改文档」。导出 `{ buildBoard, buildDetailPage, buildClientDetail, buildClientTrend, _internal: {...} }`；`_internal` 暴露 `resolveDateRange`/`previousRange`/`mapNode`/`resolveSignType`/`isStrategyOpened`/`normalizeClient`/`applyFilters`/`FLOW_NODES`/`NODE_ALIAS`/`CHAIN_TYPE_ORDER`/`DETAIL_COLUMNS` 等内部件供单测直接调用。由 `routes/api.js` 三处懒加载（看板、客户明细分页、单客户详情）。 |
| [crmdash.js](../../src/crmdash.js) | 6.9 KB / 216 行 | CRM 客户签约看板的**旧版/精简数据层**：从项目 #16（CRM）的解析数据表聚合看板指标，参考 `zk2.zhengl.vip/pc.html` 的结构。`CRM_FIELDS` 是简道云 widget ID → 业务含义的字段映射（连锁名称/签约主体/连锁类型/门店数/区域/销售/客服/培训人/签约时间/服务开始/服务结束/业务对接人/业务电话/技术对接人/技术电话/对接结果/对接备注/提交流程/流程状态/提交人），`FLOW_STATES` 是流程状态码 → 中文。导出 `{ build, CRM_FIELDS, FLOW_STATES, loadRows }`；`build(projectId)` 由 `routes/api.js`（L3066）懒加载，与 `crmboard` 并存（`crmboard` 是 V5 起的正式实现）。 |

---

## 2.9 AI 问数（V8 / V10）

AI 问数整条链路：`routes/api.js` → `ai.js`（大模型调用与 prompt 组装）→ `ai-scope.js`（数据范围解析与 SQL 表白名单校验）→ `datasource.js`（执行）。术语、SQL 示例作为可配置知识注入 prompt；分享功能复用同一套解析与校验。

| 文件 | 大小 | 说明 |
|---|---|---|
| [ai.js](../../src/ai.js) | 39.7 KB / 935 行 | AI 问数主模块（V8）：把自然语言问题转成 SQL、在**用户选定的数据范围**上执行并返回结果，会话写 `jdywh_ai_chats`。头部注释记录了 V8 修的四个关键问题：① URL 归一化（旧代码无条件 `baseUrl + '/chat/completions'`，用户填完整地址会双拼成 `.../chat/completions/chat/completions` 实测 HTTP 400）；② MiMo 预设纠错（真实地址 `https://api.xiaomimimo.com`，模型 `mimo-v2.6-pro` 默认 / `mimo-v2.6-flash`）；③ 多数据范围 `ask(question, { scope })` 交由 `ai-scope` 解析成物理表 + 列 + 行数，以「逻辑表名 + CTE 注入」喂模型，执行前做只读 + 表白名单双校验；④ `reasoning_content` **只当思维链，绝不当答案或 SQL**，模型只给推理时返回明确中文提示。`PROVIDERS` 是供应商预设（`apiStyle` 仅默认值，最终以设置项 `ai_api_style` 为准；注释说明 Anthropic 原生协议本轮不实现）。导出 `{ ask, generateSql, generateSqlWithScope, explainResult, extractSql, callLLM, testConnection, listChats, buildSchemaContext, buildSqlSystemPrompt, resolveConfig, normalizeBaseUrl, buildEndpoint, parseChatResponse, parseResponsesResponse, httpError, networkError, isTimeoutError, PROVIDERS, providerOf, publicProviders, scope: aiScope }`。 |
| [ai-scope.js](../../src/ai-scope.js) | 55.4 KB / 1400 行 | V8「数据范围（scope）」解析与 SQL 表白名单校验，涉及表面最广：`jdywh_projects`/`jdywh_field_defs`/`jdywh_flows`/`jdywh_mail_projects`/`jdywh_parsed_16`/`jdywh_mail_1`/`jdywh_mail_19`/`jdywh_users`（后两者用于识别敏感表）。设计目标写在头部：① 把四类来源（数据集 / 数据项目 / 邮箱推送项目 / 流程产出表）统一解析成同一种内部对象，附带真实列清单与行数（`KIND_LABEL` 给出中文名：数据集/数据项目/邮箱推送/流程产出）；② **坏源不抛错**，返回 `{ invalid:true, reason }` 让前端置灰、让模型看不到坏表；③ 喂给模型的是**逻辑表名**（t1/t2/ds_42）而非物理表名，执行时用 `WITH <别名> AS (SELECT * FROM <物理表>)` 注入——因为物理表名可能是中文/含连字符，直接进提示词会让模型写错；④ 生成 SQL 后做「只读 + 表白名单」双重校验。安全常量：`SYSTEM_SCHEMAS`（禁 information_schema/mysql/performance_schema/sys）、`PROTECTED_PREFIXES = ['jdywh_']`（**任何出现在模型 SQL 里的 `jdywh_*` 都必须属于 scope 内物理表**，专门堵「FROM a JOIN b ON .., c」逗号列表绕过 FROM/JOIN 解析的漏洞）。另有 V9 值域采样（`sampleValueDomains`/`describeColumn`/`enumMeaningOf`/`KNOWN_ENUM_DICTS`）让模型看到真实取值分布。导出含词法工具 `tokenize`/`extractTableRefs`/`extractCteNames`/`extractIdentifiers`、解析 `resolveOne`/`resolveScope`/`listScopeOptions`、组装 `buildSchemaText`/`buildCteList`/`wrapSql`、校验 `assertScopeOnly`。 |
| [ai-shares.js](../../src/ai-shares.js) | 23.4 KB / 656 行 | V8 AI 问数「分享」：把一组数据范围 + 一个问数入口做成链接发给他人**免登录**使用，表 `jdywh_ai_shares`（幂等建表 `CREATE_TABLE_SQL`，密码策略与既有 `jdywh_shares` 一致）。安全要点写在头部：令牌 18 字节随机（36 位 hex）不可枚举；访问密码 sha256 存 `password`、明文留档 `password_plain`（便于管理员在分享管理里查看告知对方）；**公开接口只返回标题与范围名称/行数，绝不返回 scope 明细里的物理表名或 SQL**；公开问数结果不含 sql，行数上限 `min(ai_max_rows, 200)`；限流用进程内 Map（单 token `20/min`、单 IP `30/min`、密码错误 `5 次/10min`），超限 429。导出 `{ PUBLIC_MAX_ROWS, DEFAULT_TOKEN_PER_MIN, DEFAULT_IP_PER_MIN, PWD_MAX_FAILS, PWD_WINDOW_MS, CREATE_TABLE_SQL, ensureTable, checkRate, checkPasswordRate, markPasswordFail, clearPasswordFail, failCount, resetRate, buckets, normalizeScope, publicShare, buildShareUrl, sha256, createShare, listShares, getShare, toggleShare, deleteShare, findByToken, publicMeta, authorizeAsk, publicAsk }`。 |
| [ai-terms.js](../../src/ai-terms.js) | 4.4 KB / 124 行 | V10 A1 业务术语配置，表 `jdywh_ai_terms`。术语把用户业务口语映射到数据库字段/取值并注入 SQL 生成的 system prompt（例：term=南区，definition=region 字段为「南区」的连锁，aliases=南边,南方）。长度上限 `MAX_TERM=191` / `MAX_DEF=1000` / `MAX_ALIAS=500`。导出 `{ list, get, create, update, remove, promptBlock, toPublic }`；`promptBlock` 生成注入 prompt 的文本块，`toPublic` 做行→API 映射。 |
| [ai-sql-examples.js](../../src/ai-sql-examples.js) | 6.5 KB / 186 行 | V10 A2 SQL 示例库，表 `jdywh_ai_sql_examples`。存「自然语言问题 → 参考 SQL」配对，生成 SQL 时按相似度挑 top N 注入 prompt，让模型模仿既有正确写法（表名、字段、口径），显著提升首次生成准确率；`bumpUse` 累计使用次数。导出 `{ list, get, create, update, remove, pickForPrompt, bumpUse, similarity, toPublic }`。 |

---

## 2.10 邮箱子系统

邮件**发送**（`mailer.js`，SMTP）与**接收**（`mail-inbox.js`，IMAP）是两条独立链路；接收侧再把 Excel 附件导入为数据项目（`mail-push.js`）。
三者的账号配置分别落在 `jdywh_settings`（SMTP）与 `jdywh_mail_accounts`（IMAP 多账户）中。

| 文件 | 大小 | 说明 |
|---|---|---|
| [mailer.js](../../src/mailer.js) | 7.1 KB / 185 行 | 邮件发送：基于系统设置里的 SMTP 配置**动态**创建 nodemailer 传输器（`buildTransportOptions` 从 `settings.all()` 读 host/port/secure/user/pass，587 端口自动 `requireTLS`，超时 15/15/20 秒，`tls.rejectUnauthorized:false`）。缺配置时抛中文错误。导出 `{ send, verify, sendTest, sendResetPassword, sendVerifyEmail, sendAccountCreated, mailLayout }`；`mailLayout` 是统一邮件 HTML 骨架，`escapeHtml` 内部做转义。被 `auth.js`（重置密码 / 验证邮箱）、`users.js`、`routes/api.js` 调用。 |
| [mail-accounts.js](../../src/mail-accounts.js) | 10.2 KB / 285 行 | 邮箱账户管理（多账户），表名动态取 `${TABLE_PREFIX}mail_accounts`。每个账户独立维护 IMAP 参数、密码、启用状态、拉取进度 `last_uid`、最近检查结果；**一个账户故障不影响其他账户**。密码**明文存库**（与既有 SMTP / AI 密钥同一策略，便于运维自助修改），但 API 层统一掩码绝不回传（`sanitize`）。`DEFAULTS` 是阿里云企业邮箱默认参数，`PRESETS` 提供常见服务商预设（aliyun/aliyunhk/qq/exmail/163/126）。导出 `{ DEFAULTS, PRESETS, TABLE, ensureTable, sanitize, list, listEnabled, get, getRaw, create, update, remove, setEnabled, setProgress, setError, migrateFromSettings }`；`migrateFromSettings` 把旧版单账户配置迁到多账户表（`server.js` 启动时调用）。 |
| [mail-inbox.js](../../src/mail-inbox.js) | 17.7 KB / 546 行 | 邮箱收信（IMAP）多账户版，基于 ImapFlow + mailparser。设计要点：每账户独立连接/独立进度（`last_uid`）/独立错误；**只读拉取（BODY.PEEK）不改邮件已读状态**；按「UID + 附件名」幂等，重复轮询不重复导入；支持浏览邮件列表与正文（不落库，实时读取）。运行态 `state` 记录 timer/running/lastRunAt/lastResult/lastError/perAccount。导出 `{ testConnection, listMessages, getMessage, runOnce, start, stop, restart, status }`；`start()` 由 `server.js` 启动时按设置调用，定时轮询把附件交给 `mail-push.processAttachment`。 |
| [mail-push.js](../../src/mail-push.js) | 29.3 KB / 870 行 | 邮箱**附件表格自动建项目/建表/入库**，元数据表 `${prefix}mail_projects` 与 `${prefix}mail_logs`（`META` 常量），数据表 `jdywh_mail_N`。业务规则写在头部（附件名形如 `药店智能体触达转化_整体_2026-10-28_11-14-36-157_987.xlsx`）：项目名 = 下划线分段去掉第 2 段与末尾时间戳段 → `药店智能体触达转化`；数据表第 1 列 `wjmc` = 剩余各段拼回；第 2 列 `id` 自增主键；第 3 列起为表格实际数据列，最后追加「导入日期」。同项目再收到附件按 `wjmc` 幂等追加合并，不同项目名自动新建项目与表。`EXCEL_EXT` 限定 `.xlsx/.xls/.xlsm`，且**入库前必须校验真实文件签名**（`checkExcelSignature`）——因为 SheetJS 解析器极度宽松，纯文本/随机二进制也会被当成「单单元格表格」成功解析，从而建出垃圾项目与空表。查询侧 `queryRows` 复用 `data-filter.appendFilters`，与数据项目明细保持同构。导出 20 余项，含 `processAttachment, ensureProject, createDataTable, syncColumns, queryRows, exportRows, previewRows, overview, assertOwnTable` 等。 |

---

## 2.11 项目分组与权限相关

| 文件 | 大小 | 说明 |
|---|---|---|
| [project-groups.js](../../src/project-groups.js) | 16.1 KB / 448 行 | 项目分组管理，表 `jdywh_project_groups` + `jdywh_projects`。四条设计要点：① `parent_id` 自引用支持多级树（`MAX_DEPTH=5`）；② 与历史自由文本 `jdywh_projects.category` 并存——`group_id` 是正式外键用于树形管理与筛选，`category` 保留为辅助标签，删分组不动 category 以免破坏历史数据；③ **删除分组默认把其下项目上移到父分组**（也可 `moveTo` 指定目标，0 = 未分组），**绝不级联删项目**（项目承载数据表与推送令牌，误删不可恢复）；④ 移动时校验目标不能是自身或自身后代，防止成环。`normalizeParentId` 处理库里 NULL 与 0 混用的现状（现存 4 个分组中 2 个是 NULL）：**只做输出归一为 0，不改库里的值**，因为前端写的是 `parentId === 0` 严格相等，输出 null 会让子分组被当顶层渲染。导出 `{ MAX_DEPTH, normalizeParentId, list, tree, buildTree, getGroup, createGroup, updateGroup, deleteGroup, assignProjects, reorder, descendantIds, stats }`。 |

---

## 2.12 后端模块依赖关系

### 分层与依赖方向

依赖是**单向的、无环的**：路由层依赖模块层，模块层依赖基础设施层，基础设施层只依赖外部库。

```
                     ┌─────────────────────────────────────────┐
   HTTP  ──────────▶ │  routes/  api · push · pages ·          │
                     │           public-forms · spa            │
                     └───────────────┬─────────────────────────┘
                                     │ 只做参数校验 / 鉴权 / 格式化
                                     ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  业务模块层（src/ 根级 39 个）                                       │
   │  接入:  jdy flow flow-ingest flow-state log-describe projects      │
   │  治理:  schema fields flows forms data-filter integrations         │
   │  数据源: datasources datasource dstypes ident                       │
   │  BI:    reports aggdata crmboard crmdash                            │
   │  AI:    ai ai-scope ai-shares ai-terms ai-sql-examples              │
   │  账号:  auth users roles departments                                │
   │  邮件:  mailer mail-accounts mail-inbox mail-push                   │
   │  系统:  settings audit project-groups                               │
   └───────────────────────────────┬─────────────────────────────────────┘
                                   ▼
                     ┌───────────────────────────┐
                     │ 基础设施: db · config ·   │
                     │           bootstrap       │
                     └─────────────┬─────────────┘
                                   ▼
                          MySQL 8（jdywh_* 表）
```

**依赖最集中的三个模块**：

| 模块 | 被依赖原因 |
|---|---|
| `db.js` | 唯一的连接池与查询出口，几乎所有模块 top-level `require` 它 |
| `config.js` | 配置与 `tablePrefix` 白名单的唯一来源（`schema.assertOwnTable` 依赖它） |
| `settings.js` | 运行期可变的配置（SMTP、AI 密钥、推送默认值）都从这里读 |

### 五条核心调用链

**1. 简道云推送落库（最核心链路）**

```
POST /jdy/push/:token
  └─ routes/push.js
       ├─ projects.getProjectByToken()         令牌 → 项目
       ├─ jdy.verifySignature()                nonce/timestamp + HMAC 校验
       ├─ flow.parse(body)                     判定是否流程推送（schema 2.0）
       │    ├─ 是 → flow-ingest.handle()       主表一行 + 五待办列表展开子表
       │    │        ├─ fields.getFieldDefMap() / columnForField()  自动注册字段定义
       │    │        ├─ flow-fieldDefs → jdywh_field_defs
       │    │        ├─ flow-state.aggregate()  当前节点/负责人 + 节点完成时间
       │    │        └─ flow-ingest.syncRunStateToFormProject()  同步到表单项目解析表
       │    └─ 否 → schema.upsertRecord()      原始表/解析表幂等 upsert
       │             ├─ fields.parseValue()    JSON 字段加工成可读值
       │             └─ schema.writeSubTable() 数组字段展开子表
       ├─ schema.writeLog()                    写 jdywh_log_N
       └─ log-describe.describeDataPush()      生成自然语言变更描述
```

**2. REST API**

```
/api/*  →  routes/api.js
             ├─ 公开段（前 265 行）：无需登录
             ├─ auth.requireAuthApi（L268 起）→ req.user
             ├─ users.can() / roles.roleCan()  权限点校验
             └─ 各业务模块（projects / schema / fields / reports /
                ai / ai-scope / mail-push / crmboard / aggdata …）
```

**3. 引擎执行**

```
flows.run()      →  flows.runSource() 取数（projects / datasource）
                 →  flows.runClean() / runJoin / runComputed / runPickCurrentTask 加工
                 →  flows.runSink()   写入（schema.ensureTableFor / upsertInto）
                 →  flows.listLogs()  写 jdywh_flow_logs
forms.submit()   →  forms.validateAndCast() → schema.upsertRecord() 写入项目数据表
```

**4. AI 问数**

```
ai.ask(question, { scope })
  ├─ resolveConfig() / normalizeBaseUrl() / buildEndpoint()
  ├─ aiScope.resolveScope(scope)
  │    ├─ 四类来源 → 统一内部对象（含真实列清单 + 行数）
  │    ├─ aiTerms.promptBlock()     业务术语注入
  │    ├─ aiSqlExamples.pickForPrompt()  相似 SQL 示例注入
  │    └─ buildSchemaText() / buildCteList()  逻辑表名 + CTE
  ├─ callLLM()  → generateSql() → extractSql()
  ├─ aiScope.assertScopeOnly()  只读 + 表白名单双校验
  ├─ datasource.query()         在目标数据源执行
  └─ explainResult()            结果自然语言解读（reasoning_content 不作答案）
```

**5. 启动期**

```
server.start()
  ├─ db.ping()
  ├─ bootstrap.bootstrap()  → DDL(22 表) + migrate + ensureDefault{Roles,Admin,Settings}
  ├─ settings.all() / settings.mailReady()
  ├─ auth.cleanupExpired()  + 每小时定时
  ├─ mailPush.ensureMetaTables() / mailAccounts.ensureTable() / migrateFromSettings()
  ├─ mailInbox.start()      按设置启动 IMAP 定时轮询
  └─ app.listen() → 成功回调写 PID 文件
```

### 横切关注点归属

| 关注点 | 唯一归属模块 | 说明 |
|---|---|---|
| 表名前缀白名单 | `schema.js` | `assertOwnTable` / `isOwnTable`，所有 DDL 前必经 |
| SQL 标识符安全 | `ident.js` | `sanitizeIdent` / `quoteIdent`，DDL 与动态查询共用 |
| SQL 值绑定 | `data-filter.js` | `appendFilters` 三处明细端点共用，值全部占位符绑定 |
| 只读 SQL 校验 | `reports.js` + `ai-scope.js` | 数据集侧 `assertReadOnly`；AI 侧 `assertScopeOnly`（含 `jdywh_` 前缀兜底） |
| 敏感值掩码 | `settings.js`（`SECRET_KEYS`）、`datasources.js`（`publicRow`）、`mail-accounts.js`（`sanitize`）、`integrations.js`（`maskHeaders`） | 各域自行掩码，API 层统一不回传凭据 |
| 中文列注释 | `schema.js` + `fields.js` | 需求 5 的可读性保证 |
| 幂等性 | `schema.upsertRecord`、`mail-push.alreadyImported`、`bootstrap.DDL`（IF NOT EXISTS） | 重复推送 / 重复轮询不产生重复数据 |
