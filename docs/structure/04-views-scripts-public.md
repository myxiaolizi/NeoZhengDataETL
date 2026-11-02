# 四、模板、静态资源与脚本（views / public / scripts / 部署脚本）

> 本文档逐文件说明项目中的 **EJS 旧模板（views/）**、**静态资源（public/）**、
> **测试与运维脚本（scripts/）** 以及根目录的 **deploy.sh / watchdog.sh**。
> 共 **91 个文件**：views/ 40 个 `.ejs`、public/ 5 个、scripts/ 44 个、根目录 2 个 Shell 脚本。
> 所有描述均来自对源码的实际阅读（文件头注释、主逻辑与关键断言），未做推测性补充。

---

## 概述

### 为什么 V4.0 前端迁移后 views/ 仍然保留

V4.0 把页面渲染整体迁给了 React SPA（`frontend/dist`），但 Express 的两套渲染路径并存，
`src/server.js` 明确记录了这个决策：

```js
app.use('/f', require('./routes/public-forms'));
app.use('/', require('./routes/pages'));   // 旧 EJS 页面路由
require('./routes/spa').mountSpa(app);     // SPA 静态托管 + 前端路由回退（挂载在 pages 之后）
```

`src/routes/pages.js` 开头也写明：页面渲染交给 React，本路由只保留「服务端表单处理」职责。
`views/` 因此仍保留三类不可替代的用途：

1. **服务端表单 POST 的落地页**——`POST /login`、`/register`、`/forgot-password`、`/reset-password`
   在提交失败或需要回显提示时直接用 `res.render(...)` 输出 HTML（见 `pages.js` L166、L185、
   L199、L218、L247、L282），前端 `fetch` 后解析这段 HTML，而非走 JSON 接口。
   邮箱验证 `GET /verify-email` 必须在服务端校验 token，也不在 SPA 里。
2. **邮件与第三方渠道的裸链接落地页**——邮件里发出的分享链接 `GET /s/:token`
   渲染 `share-view` / `share-access`；公开表单入口 `GET /f/:token` 渲染 `form-public`。
   这两个前缀在 SPA 路由中间件之前就被 `pages.js` 命中，因此**实际用户看到的就是 EJS**。
3. **构建产物缺失时的降级路径**——`src/routes/spa.js` 的 `resolveDistDir()` 依次尝试
   `JDY_SPA_DIR`、`frontend/dist`、`public/spa`，全部找不到时打印
   `[spa] 未找到前端构建产物...` 并返回 503 提示页；此时可用环境变量
   `JDY_LEGACY_PAGES=1` 临时回退到旧 EJS 渲染（应急手段）。

> 因此 `views/*.ejs` 中除 `login`、`register`、`forgot-password`、`reset-password`、
> `form-public`、`share-view`、`share-access`、`layout`、`error`、`intro` 等在默认模式下
> 仍真实渲染之外，其余后台页模板在 V4.0 之后属于**降级备份**（`JDY_LEGACY_PAGES=1` 时才生效）。

### 模板写法约定

- 绝大多数后台模板采用「先拼 body 字符串、再 include layout」的两段式：
  `<% var body = '' %><% body += \`...\` %><%- include('layout', {...}) %>`。
- 拼串上下文里不能直接用 EJS 的 `<%= %>`，因此模板内常传入辅助函数 `esc()`、`fmtTime()`、
  `can()`（权限点判空）、`currentUser`、`settings`、`isAdmin`。
- 静态资源统一带版本号：`/public/css/app.css?v=<%= settings.asset_version || '20261028c' %>`，
  发版靠这个参数破缓存。

### scripts/ 测试体系的演进

`scripts/` 不是一次性脚本堆，而是**逐版本沉淀的验收资产**，按版本号可直接还原项目演进史：

| 阶段 | 脚本 | 当时在验证什么 |
|---|---|---|
| 早期通用 | `e2e-test.js`、`page-check.js`、`regression-test.js`、`audit.js` | 登录→建项目→模拟推送的端到端链路、页面内联 JS 合法性、全站回归、功能完整性审计 |
| v2 | `v2-test.js` | 卡片列表、权限系统、登录页、系统设置、字段设置、50px 行高、字段解析（7 项需求） |
| v3 / v3.1 / v3.2 / v3.3 | `v3-test.js`、`v31-test.js`、`v32-test.js`、`v33-test.js` | 独立数据表与多数据源、卡片式设置、解析前后双表、浅蓝主题、报表分享；v3.1~v3.3 是逐条缺陷的修复验收 |
| V4.1 | `v41-dataset-sql.js`、`v41-dataset-sql-db.js`、`v41-ai-backend.js` | 数据集 SQL 修复（标识符引号 / 只读校验 / 分页）、真实库回归、AI 问数后端全链路（打桩 fetch） |
| V6.1 | `v61-data-filter.js`、`v61-parsed-filters-db.js` | 数据明细筛选共享模块单测（5 个 op、注入防护）+ 真库真接口只读回归 |
| V7 | `v7-*`（13 个） | 16+102 合成 59 列宽表：流程节点（join/pick_current_task/computed）、装配生成、对账、回填、只读核验 |
| V8 | `v8-*`（7 个） | 统一验收、AI 问数前后端、宽表只读核验、数据对账复核、流程导入、生产部署脚本 |
| V9 | `v9-*`（4 个） | 统一验收、AI 值域修复、节点提交时间自动同步与历史修正 |

演进中的三条不变原则（多个脚本头注释反复强调）：

1. **默认 dry-run**：写库脚本一律要求显式 `--apply`（`v7-flow-import.js`、`v7-backfill.js`、
   `v8-flow-import.js`、`v9-sync-node-times.js`）。
2. **生产库只读**：对账/核验类脚本刻意不提供 `--apply`（`v7-reconcile.js`、
   `v7-flow-verify-readonly.js`、`v8-flow-verify.js`、`v8-reconcile-verify.js`）。
3. **写完必复核**：回填与同步脚本在结束时打印备份路径、前后指纹与命中率对比。

---

## 4.1 EJS 模板（views/，40 个）

> 默认访问：`GET /login`、`/register`、`/forgot-password`、`/reset-password`、`/f/:token`、
> `/s/:token`、`/intro` 在默认模式下由 EJS 真实渲染；其余页面为 `JDY_LEGACY_PAGES=1` 降级备份。
> 所有 `.ejs` 的渲染入口均集中在 `src/routes/pages.js`（`res.render(...)` 共 40 余处）。

### 4.1.1 认证与公开入口（保留路径，默认生效）

| 文件 | 大小 | 说明 |
|---|---|---|
| `views/layout.ejs` | 6.7 KB | 全站后台公共骨架：侧边栏导航 + 顶部用户区，接收 `body/title/active/currentUser/can/isAdmin/settings`；对未登录渲染（如错误页）做了空值兜底（`_user`/`_can`/`_isAdmin` 三元兜底，L12-L19）；末尾引入 `app.js` 与 `charts.js`（带 `asset_version`）。 |
| `views/login.ejs` | 11.8 KB | 登录页，自带内联样式（`lg-shell` 双栏、orb 光斑背景、`float1/float2` 动画）。表单 `POST /login`，由 `pages.js` 直接 `res.render('login', { error, info, allowRegistration, mailReady })` 回显失败原因。 |
| `views/register.ejs` | 4.2 KB | 注册页，`POST /register`。文案明确「注册后默认为只读用户角色」，并说明注册后需邮箱验证用于找回密码。 |
| `views/forgot-password.ejs` | 3.3 KB | 找回密码页，输入注册邮箱后发送重置链接；页面注明「链接 30 分钟内有效，且只能使用一次」。 |
| `views/reset-password.ejs` | 3.3 KB | 重置密码页，接收 reset token；说明重置成功后链接立即失效、其他设备登录态退出。 |
| `views/form-public.ejs` | 21.3 KB | **公开表单填写页**（`GET /f/:token`，无需登录）。带大段内联 CSS（`form-page`/`form-card`/`success-box`/`error-box`、考试表单的 `exam-bar`），支持 fill/flow/exam 三类表单渲染与字段级错误提示。 |
| `views/share-view.ejs` | 5.2 KB | **分享链接查看页**（`GET /s/:token`，无需登录）。头部显示报表名与 `浏览 N 次 / 有效期至`，主体用 `charts.js` 渲染图表 + 数据明细表。 |
| `views/share-access.ejs` | 2.2 KB | **分享访问密码页**（`/s/:token` 命中密码保护时渲染）。含 `error` 分支（链接失效/已停用）与「需要访问密码」表单两种状态；注释中说明这是「数据报表分享」。 |
| `views/error.ejs` | 0.6 KB | 通用错误页，最小实现：`${title}` + `${message}` + 返回首页按钮，通过 `include('layout')` 渲染；`pages.js` 在账户不存在等场景 `render('error', ...)` 使用。 |
| `views/intro.ejs` | 18.3 KB | 产品介绍/落地页（`GET /intro`），含 Hero 区、行业案例、能力矩阵。v3.3 验收脚本断言此页必须包含 `Neo Zheng DataETL` 与「连锁药店」案例且不提及「简道云」。 |

### 4.1.2 数据接入与项目（降级备份）

| 文件 | 大小 | 说明 |
|---|---|---|
| `views/dashboard.ejs` | 6.2 KB | 数据概览首页：KPI 网格 `#kpiGrid` + 近 7 天接收趋势图 + 数据资产分布图，调用 `/dashboard` 相关接口，受 `can('project:write')` 控制新建按钮。 |
| `views/projects.ejs` | 36.3 KB | 数据项目列表，采用「左侧分组树 + 右侧项目卡片」布局（内联 `.pj-layout`/`.grp-panel` 样式）；v3.1 验收断言卡片带 `data-open` 属性、整卡可点击。 |
| `views/project-detail.ejs` | 74.6 KB | **全项目最大模板**（1712 行）。项目详情多标签页：项目首页 / 原始数据 / 解析后数据 / 接收日志 / 字段结构 / 子表数据 / 字段设置；头部展示 Secret 是否配置、字段解析开关，支持「模拟推送」与导出 CSV。 |
| `views/project-fields.ejs` | 15.6 KB | 字段设置页：从简道云「字段对照表及 JSON 样例」粘贴导入，自动写列注释、建立字段 ID 映射、按类型推荐解析方式；提供「同步表结构」。 |
| `views/datasources.ejs` | 19.7 KB | 数据源管理，页面宣称支持 81 种数据源类型；含类型选择弹窗（`tp-layout`/`tp-cats` 分类树）。说明「本机数据库」为平台元数据库，来自 `.env`，不可删除。 |
| `views/integrations.ejs` | 21.3 KB | 数据集成入口，两种接收方式并列卡片：**接收第三方推送**（生成接收地址，填到简道云/Webhook）与**接口采集**（填写接口信息）。 |
| `views/integration-detail.ejs` | 7.3 KB | 单个集成任务详情：方向徽标（`pull` 接口采集 / `push` 接口推送）、执行次数/成功率/最近执行统计、任务配置与执行日志列表。 |

### 4.1.3 表单中心

| 文件 | 大小 | 说明 |
|---|---|---|
| `views/forms.ejs` | 8.8 KB | 表单中心列表：表单总数/已启用/提交总量/今日提交四项统计 + 卡片网格 `#formGrid` + 新建弹窗；空态提示「通过拖拽设计表单，把收集到的数据写入项目数据表」。 |
| `views/form-design.ejs` | 29.8 KB | **表单设计器**（738 行）：左侧控件库 `#palette` + 中间画布，拖拽添加控件、点击字段编辑属性；顶部可切换 fill/flow/exam 三种表单类型，含预览、分享设置、保存。 |
| `views/form-data.ejs` | 4.7 KB | 表单提交数据明细：动态表头 `#dataHead` + 分页、关键词搜索、CSV 导出（`/api/forms/:id/export`）、跳转设计器。 |

### 4.1.4 数据处理流程

| 文件 | 大小 | 说明 |
|---|---|---|
| `views/flows.ejs` | 8.8 KB | 数据处理流程列表：流程总数/已启用/累计执行/成功次数统计 + 表格（节点数、执行/成功比），支持搜索与新建。 |
| `views/flow-design.ejs` | 18.6 KB | **流程编排画布**（480 行）：拖拽节点到画布、拖动调整位置、点击配置参数；工具栏含节点类型下拉、自动排列、清空画布，头部有「试运行 / 正式执行 / 保存流程」。 |
| `views/flow-logs.ejs` | 4.9 KB | 单个流程运行日志：头部显示执行次数与成功次数，表头为 ID/触发/结果/输入行/输出行/耗时/消息/时间，受 `can('flow:write')` 控制「立即执行」。 |

### 4.1.5 报表与 BI

| 文件 | 大小 | 说明 |
|---|---|---|
| `views/reports.ejs` | 13.4 KB | 报表中心：按类型（图表报表/数据表格/看板大屏/分享中）分 tab 统计 + 卡片网格；空态引导「先创建数据集，再基于数据集设计图表报表或看板」。 |
| `views/report-design.ejs` | 10.0 KB | 报表设计器（261 行）：左侧图表类型网格 `#typeGrid` + 基础配置（标题、数据集），右侧预览区；含刷新数据、预览、保存。 |
| `views/report-view.ejs` | 4.3 KB | 报表查看页：`charts.js` 渲染图表（高度取 `report.config.height` 或 420px）+ 明细表；带浏览计数、CSV 导出、分享、跳转设计器。 |
| `views/datasets.ejs` | 13.3 KB | 数据集管理：定义报表数据来源，支持 SQL 查询 / 数据表 / 项目数据表三种来源类型；表格展示来源类型、数据源、状态。 |
| `views/shares.ejs` | 4.3 KB | 分享管理：链接格式明确为 `{平台地址}/s/{分享令牌}`，可设访问密码与有效期，表头含密码、有效期、浏览数、状态与启停/删除操作。 |
| `views/crm-dashboard.ejs` | 14.1 KB | 客户签约看板（424 行，独立视觉体系 `.dash2`）：顶部筛选（区域/类型/销售/状态）+ 同步时间显示，引入 `dash.js` 渲染 KPI、环形图、排行榜等；入口 `/projects/16`「原始数据」与 `/reports`。 |

### 4.1.6 AI 问数与治理

| 文件 | 大小 | 说明 |
|---|---|---|
| `views/ai.ejs` | 7.3 KB | AI 问数对话页（200 行）：左侧消息流 + 建议问题，右侧结果/图表区；`aiEnabled` 为假时展示「请前往系统设置 → AI 问数配置接口地址与密钥」的警告条并禁用输入。 |
| `views/governance.ejs` | 7.2 KB | 数据治理总览：数据项目数/数据总条数/字段定义/启用解析/注释覆盖率五项统计 + 「解析前/解析后」双表资产清单。 |
| `views/audit.ejs` | 4.7 KB | 审计日志：按用户/操作/详情/IP 搜索，操作类型下拉 + 日期区间筛选，支持「按策略清理」，展示日志总数/今日操作/涉及用户。 |

### 4.1.7 邮箱推送（独立业务板块）

| 文件 | 大小 | 说明 |
|---|---|---|
| `views/mail-push.ejs` | 35.8 KB | **邮箱推送主页面**（797 行，五个标签）：概览 / 数据项目 / 导入日志 / 邮箱账户 / 设置；头部「全部拉取」与「+ 添加邮箱」；概览含自动推送开关状态等统计。 |
| `views/mail-push-account.ejs` | 13.6 KB | 邮箱账户新增/编辑页（独立路由 `/mail-push/accounts/new` 与 `/:id/edit`）：服务商预设自动填充 IMAP 服务器/端口/加密方式，配置 IMAP 收件账户以自动拉取附件入库。 |
| `views/mail-push-project.ejs` | 26.3 KB | 邮箱推送的数据项目详情（708 行，四个标签）：项目首页 / 数据明细 / 字段结构 / 导入日志；头部含刷新、编辑名称、导出 CSV、清空数据、删除项目（危险操作）。 |

### 4.1.8 系统管理与个人

| 文件 | 大小 | 说明 |
|---|---|---|
| `views/users.ejs` | 36.8 KB | 用户管理（889 行）：账号、角色权限、组织架构与权限说明多个 tab；用户统计含用户总数/启用账号/超级管理员/邮件服务状态，支持按账号、邮箱、姓名、角色、状态筛选。 |
| `views/roles.ejs` | 9.5 KB | 角色权限：角色表（名称/标识/说明/用户数/类型）+ 权限点勾选弹窗，页面标注「权限变更即时生效」。 |
| `views/settings.ejs` | 15.8 KB | 系统设置配置中心：卡片式分组切换（`#settingsCards` + `#panelBody`），按分组保存；脚本内以 `<%= can('settings:write') %>` 注入 `CAN_WRITE` 控制可写性。 |
| `views/profile.ejs` | 10.7 KB | 个人中心：头像、角色徽标、账号/邮箱/邮箱验证状态/部门/职位/最后登录 IP/注册时间，支持更换头像、改密码、管理登录设备。 |
| `views/help.ejs` | 28.2 KB | 使用说明（497 行）：`SECTIONS` 大数组定义全部功能的使用指南，按 tab 分组渲染，含数据流转 ASCII 图与平台定位说明；带站内搜索框。 |

---

## 4.2 静态资源（public/，5 个）

> 由 `src/server.js` 的 `express.static` 挂载在 `/public` 前缀（该前缀被 SPA 中间件列入
> `BACKEND_PREFIXES`，永远不会被前端路由接管）。引用点：`layout.ejs` 引入 `app.js` + `charts.js`，
> `share-view.ejs` 引入 `charts.js`，`crm-dashboard.ejs` 引入 `dash.js`；各认证页直接引 `app.css`。

| 文件 | 大小 | 说明 |
|---|---|---|
| `public/css/app.css` | 192.2 KB | 全站唯一样式表（1730 行，无构建步骤）。`:root` 定义完整设计令牌（`--primary #3687FF`、`--success #A2D73C`、`--warning #FFC000`、`--danger #E86161`、圆角/阴影/过渡），并覆盖布局、表格、弹窗、表单设计器、看板、AI 问答、介绍页、响应式断点等全部组件。登录页个性化样式则内联在各自 `.ejs` 中。 |
| `public/js/app.js` | 5.6 KB | 旧模板通用前端工具库（167 行）：`api()` 统一 fetch 封装（对象 body 自动 JSON 序列化、401 自动跳 `/login?redirect=...`）、`esc()` HTML 转义、`toast()` 提示等。供所有 `layout.ejs` 系模板使用。 |
| `public/js/charts.js` | 17.8 KB | **纯 SVG 轻量图表库，零外部依赖**（423 行）。文件头声明支持柱状/折线/面积/饼/环形/散点/雷达/漏斗/仪表盘/指标卡/表格共 11~12 类图表；配色优先读 `global.__THEME__.palette`，否则用内置 8 色；内置 `fmtNum`（万/亿缩写）与 `niceMax`（Y 轴刻度取整）。 |
| `public/js/dash.js` | 18.9 KB | **看板渲染库 v2**（452 行），对齐 `zk2.zhengl.vip/pc.html` 的视觉与交互。组件：KPI 大数字卡 / KPI 分区卡 / 环形图+图例 / 半环进度 / 进度条组 / 排行榜 / 流程分布 / 趋势柱状 / 进行中列表 / 明细表。内置 `THEME` 品牌色与 `fmt/fmtInt` 格式化。仅 `crm-dashboard.ejs` 引用。 |
| `public/js/dashboard.js` | 15.1 KB | **看板渲染库 v1**（366 行），早于 `dash.js` 的版本，风格参考同一看板原型。提供 KPI 卡、环形图、半环进度、进度条、排行榜、趋势图、流程分布、明细表，并额外带 `fmtMoney`（¥ 带万/亿）。**当前无任何模板引用它**，属 `dash.js` 的前身/历史遗留。 |

---

## 4.3 测试与运维脚本（scripts/，44 个）+ 根目录部署脚本（2 个）

### 4.3.1 通用测试与审计

| 文件 | 大小 | 说明 |
|---|---|---|
| `scripts/e2e-test.js` | 10.1 KB | 最早的本地端到端联调脚本：登录 → 建项目 → 模拟推送 → 校验数据与日志。`BASE` 环境变量指定目标（默认 `http://127.0.0.1:8781`），断言用裸 `fetch` + `jdy_sid` Cookie 传递，失败置 `process.exitCode = 1`。`deploy.sh` 在同步代码时显式排除本文件。 |
| `scripts/page-check.js` | 5.5 KB | 页面健康检查：所有页面 HTTP 可达 + **内联 `<script>` 必须为合法 JS**。文件头记录了典型故障——「项目详情页数据明细一直显示加载中」，根因是 EJS 模板字面量内正则二次转义生成非法 JS，导致整段脚本中止；因此本脚本 `checkScripts()` 会把每个非空 script 块交给 `new Function()` 校验。 |
| `scripts/regression-test.js` | 9.9 KB | 全站回归测试，目标为「确认邮箱推送改造未破坏任何既有功能」，覆盖所有页面、API、权限与数据完整性。 |
| `scripts/audit.js` | 10.1 KB | 全系统功能审计：检查所有页面、接口、权限、数据表、驱动、配置项的完整性，把问题收集进 `issues[]` 后统一输出。 |
| `scripts/optimize-agg.js` | 4.2 KB | 数据文件二次优化工具：把 `split-agg.js` 拆出的「对象数组」分片转成**列式结构** `{ cols, rows }`（字段名只出现一次、数值保持数字类型），体积可再降约 40% 且前端解析更快。`--dir` 指定目录（默认 `./agg-split`）。 |
| `scripts/split-agg.js` | 10.1 KB | 超大 JSON 拆分工具：原始 `agg_classified.json` 约 605 MB、`agg_raw.json` 约 478 MB，浏览器与 Node 均无法一次加载，故按月流式拆分，产出 `index.json` / 月度分片 / `_summary.json`（看板首屏用）。参数 `--dir`、`--out`、`--chunk`（默认 20000 条/片）。 |

### 4.3.2 邮箱推送专项测试

| 文件 | 大小 | 说明 |
|---|---|---|
| `scripts/mail-push-unit.js` | 13.0 KB | 邮箱推送**数据层单元测试**：在 Node 内直接调 `src/mail-push` 模块，用 `xlsx` 在内存造表，覆盖文件名解析、建表结构、入库、同文件幂等、跨文件合并、不同项目分流、表结构演进、异常输入、清理逻辑。会建「测试_」前缀临时项目并在结束清理。 |
| `scripts/mail-push-test.js` | 11.2 KB | 邮箱推送**功能专项测试**：文件名解析规则、页面渲染 + 内联脚本语法、全部 HTTP API、建表/入库/幂等/合并/分流、异常输入健壮性、权限与敏感信息保护。用法 `BASE=... node scripts/mail-push-test.js`。 |
| `scripts/mail-accounts-test.js` | 9.0 KB | 邮箱账户管理单元测试：账户 CRUD、邮箱格式校验、重复检测、**密码掩码**、启停、进度重置、旧配置迁移、邮件列表/正文读取；自建「测试账户」并自动清理。 |
| `scripts/mail-push-ui-test.js` | 31.5 KB | 邮箱推送板块改造的 **UI/API 自动化测试**（652 行），按 `_work/API-CONTRACT.md` 逐项断言：页面可达性（5 标签页 + 4 标签项目页）并对每页内联 script 做 `new Function()` 语法校验（注释说明这是关键回归防护，历史上因 EJS 转义导致整页 JS 中断）；新增 overview/settings/columns/rows/export/logs API；匿名拒绝、账户不泄露密码、CSV 公式注入防护；overview 与 accounts/projects/rows 数量对账。设计上幂等（改数据的用例在 `finally` 恢复）且绝不删除现有项目。 |

### 4.3.3 版本验收测试（v2 → v6.1）

| 文件 | 大小 | 说明 |
|---|---|---|
| `scripts/v2-test.js` | 23.1 KB | v2.0 全功能验收（446 行），覆盖 7 项需求：卡片列表 / 权限系统 / 登录页 / 系统设置 / 字段设置 / 50px 行高 / 字段解析。内含一段简道云样例字段表常量 `SAMPLE_TABLE`，用于验证字段表导入解析。 |
| `scripts/v3-test.js` | 21.5 KB | v3.0 全功能验收（479 行），覆盖 10 项需求：独立数据表与项目内表名、卡片式设置、多数据源（MySQL/MSSQL）+ 项目绑定数据源、商业化设置项、角色权限可编辑、解析前后双表、浅蓝主题、数据中台定位、接口采集/推送、报表加工与分享。 |
| `scripts/v31-test.js` | 11.5 KB | v3.1 修复验收：项目卡片整卡可点击（断言 `data-open` 与 `card.dataset.open`）、报表可编辑（`data-edit` / `openEdit` / 弹窗隐藏 ID 字段）、分享密码明文显示等逐条缺陷回归。 |
| `scripts/v32-test.js` | 6.1 KB | v3.2 验收：登录页（断言 `lg-shell` 新布局、含「数据集成」定位文案、**不得出现默认密码 6655**）+ 项目详情 7 个标签页逐一存在性断言。 |
| `scripts/v33-test.js` | 5.1 KB | v3.3 验收：站点重命名为 `Neo Zheng DataETL`（Logo 文字为 `N`）+ 项目介绍页 `/intro`（含行业案例、连锁药店、不提及简道云）。 |
| `scripts/v41-dataset-sql.js` | 12.8 KB | V4.1 数据集 SQL 修复**单元测试**（297 行，纯 Node、不连库）：A. `normalizeSql` 标识符自动加引号（连字符/保留字/中文/已引号幂等/子查询/别名/带 schema/MSSQL/函数调用）；B. `assertReadOnly`（字符串含 update 不误杀、WITH、窗口函数、多语句拦截）；C. `paginate`（已有 LIMIT 不重复追加、MSSQL OFFSET/FETCH、`FOR UPDATE` 位置）；D. `describeDbError` 中文错误（1064 翻译）。 |
| `scripts/v41-dataset-sql-db.js` | 5.8 KB | V4.1 **真实库回归**：验证 `select * from zkcrm-ry` 这类带连字符表名修复后可执行。全程只读（仅 SELECT/SHOW/DESCRIBE），走与线上完全相同的链路 `reports.testSql → assertReadOnly → normalizeSql → paginate → datasource.query`。 |
| `scripts/v41-ai-backend.js` | 6.4 KB | V4.1 AI 问数后端**离线**回归：打桩 `settings.get` 让 `ai.js` 拿到假接口地址，再全局替换 `fetch` 让「大模型」返回固定 SQL，从而跑通 `schema 上下文 → 生成 SQL → assertReadOnly → normalizeSql → paginate → 执行 → 解读` 全链路；不写库、无副作用。 |
| `scripts/v61-data-filter.js` | 19.9 KB | V6.1 数据明细筛选共享模块（`src/data-filter.js`）单元测试（403 行）：A. 5 个 op（contains/eq/ne/empty/notempty）逐一核对 SQL 与绑定参数；B. 列名白名单——不在物理列里的条件必须被丢弃**且绝不进 SQL**；C. 注入值（`'`/`%`/`\`/反引号/`--`/`' OR 1=1 --`）一律走占位符；D. 边界（非法 JSON、超 20 条截断）；E. keyword + filters 共存；F. 三种白名单形态；G. `whereSql` 拼装与 `filterMeta`。 |
| `scripts/v61-parsed-filters-db.js` | 38.2 KB | V6.1 筛选**真库真接口只读回归**（697 行）：先包装 `src/db.js` 的 query/queryOne/raw，非 SELECT/SHOW/DESCRIBE 直接抛错；再把真实 `src/routes/api.js` 挂到随机端口的临时 express（注入 `permissions:['*']`），以规避 8781 上旧进程与 bootstrap DDL 写库；对 `GET /api/projects/16/parsed` 与 `GET /api/mail-push/projects/31/rows` 做同构断言；附带核对 `/api/settings/public` 6 个站点字段与 `/api/project-groups` 的 parentId 归一。 |

### 4.3.4 V7 · 16+102 合成宽表（13 个）

> V7 的业务目标：把 CRM 表单推送（project 16）与 CRM 流程推送（project 102，369 条事件）
> 合成 **59 列宽表** `jdywh_crm_signing_v7`，并与业务基准 xlsx（`数据文件/新增智能体签约_20261030233545.xlsx`，96×59）逐格对齐。
> 契约文档为 `_work/V7R-CONTRACT.md`。

| 文件 | 大小 | 说明 |
|---|---|---|
| `scripts/v7-flow-assembly.json` | 6.8 KB | **流程装配定义（交付物，不是脚本）**：name「CRM签约对账表（16+102 合成）」、code `crm_signing_v7`、`runMode: "trigger"`（推送后自动刷新）、`targetTable: jdywh_crm_signing_v7`，含 n1~n7 节点与连线的坐标、配置。被 `.build.js` 生成、被 `check-assembly` / `flow-import` / `dryrun` 消费。 |
| `scripts/v7-flow-assembly.build.js` | 9.2 KB | 装配**生成器**（只读：只写本地 JSON，不碰数据库）。产出上述 `v7-flow-assembly.json`。注释记录三个关键设计：102 是事件表（1 实例最多 19 条事件）须先 `pick_current_task` 收敛成 1 行否则行数爆炸；27 个实例无 102 事件需 `coalesce` 回退到 16 的 `flow_current_*`；xlsx 两组重名列必须改名（第 2 个「优惠券」→「优惠券(结果)」，第 2 个「流程状态」→「流程状态(节点)」）。 |
| `scripts/v7-flow-check-assembly.js` | 5.2 KB | 装配**前置校验**（仅 `SHOW COLUMNS` / SELECT）：校验装配引用的每个源列在 `jdywh_parsed_16` / `jdywh_parsed_102` 中真实存在——缺列会让 `select_fields` 静默跳过，导致目标表少一列。 |
| `scripts/v7-flow-join.js` | 43.8 KB | V7 新增节点**单元测试**（712 行，纯 Node 不连库）：join left/inner、右侧 1:N 收敛（每 key 只留 1 行）、`pickCurrent`（最后一条是「取消」事件时必须选上一条有效创建事件）、空右表、列前缀冲突、`pick_current_task` 分组与回退、`computed` 常量/copy/`onlyIfEmpty`、`on_push` 触发与防重入闸门、`NODE_TYPES` 与 `runClean` dispatch 接通。 |
| `scripts/v7-flow-assembly-dryrun.js` | 10.3 KB | 目标流程**全链路试跑（只读，跳过 sink）**：用真实引擎函数 `flows.topoSort / runSource / runClean / collectInput` 跑装配，数据只读取，**不调用 runSink** 故不会创建/写入目标表。验证 8 节点拓扑无循环、102 的 369 条事件被收敛成 69 行、join 后仍 96 行不膨胀、最终正好 59 列且顺序符合契约 §2.1。 |
| `scripts/v7-flow-verify-readonly.js` | 7.0 KB | 流程引擎**只读核验**：核对解析表事件相关列齐全，用 `flows.runPickCurrentTask` 从事件流算每实例当前节点/负责人，用 `join(left)` 合成宽表并核对行数不膨胀，统计需回退 16 的条数。刻意**不提供 `--apply`**——本机 `.env` 连的是生产库，脚本永远只读。 |
| `scripts/v7-flow-push-wire.js` | 6.7 KB | 推送触发**接线自检**（只读）：因不能对生产库打真实推送，改为同进程同代码路径验证——`require` 真实 `src/routes/push.js` 并调用其导出的 `triggerFlowsAfterPush(projectId)`，只观察是否同步抛错/多久返回，并用 `flows.triggerOnPush` 测首次与缓存命中耗时。 |
| `scripts/v7-flow-pick-verify.js` | 9.4 KB | 「当前节点 / 当前负责人」**规则回测**（只读本地 JSON）：用引擎自身的 `runPickCurrentTask / runJoin / runComputed` 跑真实数据，与业务表 `_work/v7data/xlsx_pos.json`（59 列 × 96 行，第 57/58 列）逐行比对，验证契约 §3.5 C3 规则命中率，并与 `mode='simple'` 旧规则对比证明新规则更优。 |
| `scripts/v7-reconcile-lib.js` | 42.2 KB | V7 对账/回填**公共库**（960 行，不含任何写库语句）。职责：把业务 xlsx 与 `parsed_16`/`parsed_102` 读成统一形状，提供字段映射、归一化比较、当前节点/负责人推导。注释记录了 C1~C3 修正：xlsx 改为**位置式**读取 `xlsx_pos.json`（避免重名列后者覆盖前者）、col25/col29 两个「优惠券」分别对应两个 widget、col56「流程状态②」对应 `sys_flow_state_2`（0=进行中/1=流转完成）、当前节点用 §3.5 C3 新规则。 |
| `scripts/v7-reconcile.js` | 17.2 KB | V7 **数据对账（只读）**，本文件不含写库语句。把业务表格（96×59）与 `parsed_16`（96 行）+ `parsed_102`（369 事件）逐格比对。参数：`--source=json|db`、`--samples=N`、`--out=`、`--flow-mode=c3|legacy|xlsx`、`--xlsx=FILE`、`--quiet`。产物 `_work/v7data/reconcile-report.json/.txt`，含 `idempotency.fingerprint` 保证连跑两次一致。 |
| `scripts/v7-backfill.js` | 25.9 KB | V7 **数据回填**：把业务表格的值写回 `jdywh_parsed_16`。**默认 dry-run**（只输出「将更新 X 行 Y 列 Z 单元格」），只有显式 `--apply` 才执行 UPDATE。支持 `--limit=N` 分批、`--only=<列>`、`--flow-mode`、`--verify`、`--simulate-apply`（内存套用证明幂等）、`--source=json`（离线预览不可 apply）。口径：只写有差异的单元格、跳过 col56 与主键、所有 SQL 参数绑定、逐行事务、写前把受影响行完整备份到 `_work/v7data/backup-<ts>.json`。 |
| `scripts/v7-flow-import.js` | 3.7 KB | V7 装配**导入流程定义**到 `jdywh_flows`：默认 dry-run，`--apply` 写库；同 `code` 已存在则 UPDATE（幂等不重复）。内含一处**生产修正**：导入前清空 `n3.config.cutoffTime`，因为装配 JSON 里烘焙的是对账用的快照时刻，直接上线会永久冻结「当前节点/负责人」。 |
| `scripts/v7-flow-run.js` | 1.6 KB | V7 **执行装配流程**（39 行最小脚本）：按 `code='crm_signing_v7'` 查 flow id（可用 `--flow=<id>` 覆盖），调用 `flows.run(flowId, 'manual')` 物化目标表，打印 `inputRows/outputRows/duration` 与逐节点 `in/out/ms` 日志，退出码随 `res.ok`。 |

### 4.3.5 V8 · 统一验收、AI 问数前后端与部署（7 个）

| 文件 | 大小 | 说明 |
|---|---|---|
| `scripts/v8-acceptance.js` | 17.8 KB | **V8 统一验收脚本**（335 行）：支持 `--ai` / `--data` / `--flow` / `--regress` 分组只跑，`--snapshot=` 指定快照时刻；通过 `execFileSync` 调用子脚本并汇总 `PASS/FAIL`，退出码 0=全通过。依赖真实数据库与 `MIMO_KEY`（或 `_work/v8/.mimo-key`）。 |
| `scripts/v8-ai-backend.js` | 34.8 KB | V8 AI 问数后端自测（WS1，681 行），10 组覆盖：接口地址归一化（6 种输入形态绝不双拼 `/chat/completions`）、供应商预设（mimo → `api.xiaomimimo.com`，含 `mimo-v2.6-pro/flash`）、返回体解析（丢弃 `reasoning_content`、content 为空报中文错）、错误翻译（401/400/ENOTFOUND/超时）、SQL 提取（剥围栏、截首个 SELECT/WITH）、四类数据范围解析、SQL 表白名单校验、分享 CRUD、公开接口（密码/过期/停用/限流/结果不含 sql）、真实 Mimo 调用（`--enable` 可一键启用 AI）。 |
| `scripts/v8-ai-ui-check.js` | 16.2 KB | V8 AI 问数前端自检（WS2，415 行）：**源码级 + 构建产物级断言**，不依赖浏览器，30 条断言覆盖 `/a/:token` 隐藏路由与 `/a/` 前缀跳过 `fetchUser`、公开接口必须裸 fetch、`{ok, data:{}}` 必须解包（「0 个数据来源」bug 的根因）、范围选择禁用逻辑、分享能力、移动端 safe-area/字号/点击区要求、错误文案、dist 与 ai-share chunk 存在性。含 `stripComments()` 去除注释以避免文档文字造成断言假阳性。 |
| `scripts/v8-flow-import.js` | 11.0 KB | V8 流程装配**导入（flow 25）**：与 `v7-flow-import.js` 独立实现（V7 期间不得改 v7 脚本）。额外做 4 件事：① 清空 `n3.cutoffTime`；② 导入前用 `flows.assertFlowSupported()` 校验节点类型都被当前服务端认识，不认识则拒绝导入；③ 校验源列真实存在；④ 导入后打印结构与 trigger 核对，可选 `--run` 立即跑一次。默认 dry-run，写库前把现有流程行完整备份到 `_work/v8/flow/backup-flow-<ts>.json`。 |
| `scripts/v8-flow-verify.js` | 43.9 KB | V8 流程宽表**只读核验**（WS4，889 行）：核对 `jdywh_crm_signing_v7` 与业务 xlsx 逐格一致、推导规则命中率、唯一索引、流程定义、推送触发接线。仅 SELECT/SHOW/information_schema，绝不调 `flows.run`；**零本机路径依赖**（路径基于 `__dirname/..`）可在生产直接用；缺 `数据文件/` 时自动降级跳过 xlsx 比对并打印 SKIP。支持 `--json` / `--flow=<id>` / `--xlsx=<path>`。其中记录了 V9 修订：行数断言不再写死 96，改为「目标表行数 = xlsx 行数 + 快照后新增行数」（起因是业务侧新增流水号 215 的单据触发 3 条红灯）。 |
| `scripts/v8-reconcile-verify.js` | 28.4 KB | V8 **数据对账复核**（只读，612 行）：核心语义为业务表格是 2026-10-30 23:30 北京（15:30 UTC）的**快照**，我方链路是实时的，快照后被推送过的「fresh 行」必然与旧快照不同（正向更新），因此断言为**非 fresh 行差异必须 = 0**。参数 `--snapshot=`（ISO 或毫秒）、`--json=`、`--samples=`、`--verbose`；退出码 0=通过 / 1=有差异 / 2=环境错误。显式按 `__dirname` 加载 `.env`，使脚本**与 cwd 无关**（该文件记录了 `src/config.js` 按 cwd 找 `.env` 导致计划任务连库失败的坑）。 |
| `scripts/v8-deploy.sh` | 5.2 KB | **V8 生产部署脚本**（在云服务器 root 执行）：`bash /tmp/v8-deploy.sh <已上传的新版本源码目录>`。设计原则写在头注释：① 先整目录备份到 `.backup-v8-<ts>`，失败可一键回滚（脚本会打印回滚命令）；② **绝不覆盖 `.env` 与 `node_modules`**；③ 同步后做语法自检，失败立即回滚退出；④ 重启由宝塔面板负责，本脚本只做文件级替换 + 自检 + 备份。硬编码 `APP_DIR=/www/wwwroot/jdy-push`、`NODE_BIN=/www/server/nodejs/v24.14.1/bin/node`。 |

### 4.3.6 V9 · 统一验收、AI 值域与节点时间（4 个）

| 文件 | 大小 | 说明 |
|---|---|---|
| `scripts/v9-acceptance.js` | 36.1 KB | **V9 统一验收脚本**（745 行）：分组 `--ai`（真实 Mimo 调用，2~5 分钟）/ `--flow`（节点时间同步 + 宽表）/ `--ui`（纯静态源码断言，无需浏览器/DB）/ `--regress` / `--build`（前端类型检查 + 构建），可组合。三条铁律写在头注释：只读、子脚本缺失记 SKIP 不记 FAIL、断言不放宽；脚本内不出现任何 API Key 明文。`rec()` 支持三态 `PASS/FAIL/SKIP`。 |
| `scripts/v9-ai-valuedomain.js` | 17.2 KB | V9 AI 问数**值域（value domain）**自测（319 行），修复 V8 遗留真实故障：`buildSchemaText` 只喂「列名(注释)」不喂真实取值域，而 `sys_flow_state_2` 是 DOUBLE 存 0/1、注释却叫「流程状态」，模型按中文语义猜出 `WHERE sys_flow_state_2='2'` 得到 0 行（真值 4）。验证 6 项：低基数列采样确实拿到值域（project 16 / mail 19 / flow 25 三类）、`sys_flow_state_2` 值域含 0 与 1、提示词出现「取值：」「0=进行中」「数值编码列」、采样兜底不抛错、性能红线（`resolveScope` ≤ 3000ms、候选列 ≤ 40、取值 ≤ 8）、4 例真实问数结果 4/4/4/97。`--offline` 可跳过真实调用。 |
| `scripts/v9-node-times.js` | 31.9 KB | V9 **节点提交时间自动同步自检（只读，583 行）**，7 组覆盖：A. `deriveNodeTimes` 纯函数单测（正常流转、转交不算完成、回退后再提交、终态、1ms 级回退用 `(jdy_op_time,id)` 排序键、别名归一化）；B. `TIME_FIELD_OF_NODE` 8 个节点全覆盖；C. 真实数据节点 215 推导值 = 实施对接 `1793461861067`（2026-10-31 23:51:01）；D. dry-run 前后整表指纹一致；E. 宽表 8 个时间列非空率 ≥ `parsed_16` 对应值（不倒退）；F. `FLOW_SYNC_NODE_TIMES=0` 时不同步；G. `flows.js` 尾随补跑使合并期间推送不再被丢弃（215 缺时间的真因）。 |
| `scripts/v9-sync-node-times.js` | 17.3 KB | V9 **节点提交时间历史数据修正**（默认 dry-run，`--apply` 才写库，398 行）。背景是用户 2026-10-31 投诉「节点 215 已进入对接审核但没有实施对接时间」。口径：用 `flow-state.js::deriveNodeTimes()` 从事件流推导 8 个节点时间，**仅补 parsed_16 中为空且推导值非空的单元格**（已有非空值不覆盖——简道云时间自动化推来的值更权威，历史上覆盖曾导致命中率暴跌与清空事故），补完重跑 flow 25 跟上宽表。参数 `--apply`、`--force-backfill`（连历史行也补，会让解析表偏离快照）、`--no-flow-run`、`--limit=N`。含新鲜度闸门（默认只补 `FLOW_SYNC_NODE_TIMES_WINDOW_MS` 默认 10 分钟内仍有推送的实时行）、写前备份到 `_work/v9/backup-<ts>.json`、UPDATE 内二次判空。 |

### 4.3.7 根目录部署与运维脚本（2 个）

| 文件 | 大小 | 说明 |
|---|---|---|
| `deploy.sh` | 3.7 KB | **一键部署脚本**（宝塔面板 + Node.js，OpenCloudOS/CentOS/Ubuntu）。`sudo bash deploy.sh`，必须 root。六步：① 检查 Node（优先 `/www/server/nodejs/v24.14.1/bin/node`，缺失回退 PATH）；② `rsync -a --delete` 同步代码到 `/www/wwwroot/jdy-push`（排除 `node_modules`/`.env`/`logs`/`.git`/`scripts/e2e-test.js`，无 rsync 时用 tar 管道）；③ 不存在时生成 `.env`（用 `/dev/urandom` 生成 `SESSION_SECRET`，DB 指向 127.0.0.1，`chmod 600`）；④ `npm install --omit=dev` 走 npmmirror；⑤ `chown -R www:www` 并建 `logs/`；⑥ firewalld 放行 8781。末尾打印宝塔 Node 项目的创建参数与默认登录提示。 |
| `watchdog.sh` | 2.2 KB | **进程守护脚本**，用于宝塔 Node 项目 nohup 启动无自动重启的场景。建议由宝塔计划任务每分钟执行 `bash /www/wwwroot/jdy-push/watchdog.sh`。四步：① `curl -sf -m 5 http://127.0.0.1:8781/healthz` 健康检查通过即 `exit 0`；② 读 `/www/server/nodejs/vhost/pids/jdy-push.pid` 残留 PID，`kill -TERM` 后 3 秒 `kill -9`，并 `pkill -f "$APP_DIR/src/server.js"`；③ 优先调用宝塔启动脚本 `START_SH`，否则 `nohup node src/server.js` 并写 PID——两者都**统一降权到 `www`**（因为计划任务以 root 执行，直接拉起会让应用以 root 运行）；④ 再等 5 秒复验健康检查，成功/失败都写 `/www/wwwlogs/nodejs/jdy-push-watchdog.log`。 |

---

## 脚本分类索引

> 按「用途」归类，便于按需查找与执行。带 ★ 的是该用途下的主力入口。

### A. 验收测试（版本级全量验收）

| 用途 | 脚本 |
|---|---|
| ★ V9 统一验收入口 | `v9-acceptance.js` |
| ★ V8 统一验收入口 | `v8-acceptance.js` |
| v2.0 全功能验收 | `v2-test.js` |
| v3.0 全功能验收 | `v3-test.js` |
| v3.1 / v3.2 / v3.3 修复验收 | `v31-test.js`、`v32-test.js`、`v33-test.js` |

### B. 对账核验（只读，生产库安全）

| 用途 | 脚本 |
|---|---|
| ★ V7 数据对账（xlsx vs parsed_16/102 逐格） | `v7-reconcile.js` + 公共库 `v7-reconcile-lib.js` |
| ★ V8 对账复核（非 fresh 行差异必须为 0） | `v8-reconcile-verify.js` |
| ★ V8 流程宽表只读核验 | `v8-flow-verify.js` |
| V7 流程引擎只读核验 | `v7-flow-verify-readonly.js` |
| V7 装配前置列校验 | `v7-flow-check-assembly.js` |
| V7 当前节点/负责人规则回测 | `v7-flow-pick-verify.js` |
| 页面健康检查（含内联 JS 语法） | `page-check.js` |
| 全站回归 | `regression-test.js` |
| 全系统功能审计 | `audit.js` |

### C. 流程导入与编排

| 用途 | 脚本 |
|---|---|
| ★ V8 装配导入（flow 25，含节点能力/列校验/备份） | `v8-flow-import.js` |
| V7 装配导入（含清空 cutoffTime 修正） | `v7-flow-import.js` |
| 装配定义生成（写本地 JSON） | `v7-flow-assembly.build.js` → 产出 `v7-flow-assembly.json` |
| 装配全链路试跑（跳过 sink，不写库） | `v7-flow-assembly-dryrun.js` |
| 装配执行物化目标表 | `v7-flow-run.js` |
| 流程节点单元测试（join/computed/on_push） | `v7-flow-join.js` |
| 推送触发接线自检 | `v7-flow-push-wire.js` |

### D. 数据迁移与回填（默认 dry-run）

| 用途 | 脚本 |
|---|---|
| ★ V7 业务表格值回填 parsed_16（`--apply` 才写） | `v7-backfill.js` |
| ★ V9 节点提交时间历史修正（`--apply` 才写） | `v9-sync-node-times.js` |
| 超大 JSON 按月拆分（605MB/478MB → 分片） | `split-agg.js` |
| 分片转列式结构压缩 | `optimize-agg.js` |

### E. 浏览器 / 前端 UI 检查

| 用途 | 脚本 |
|---|---|
| ★ 邮箱推送 UI/API 自动化（页面 + 内联脚本语法 + 权限 + 对账） | `mail-push-ui-test.js` |
| ★ V8 AI 前端源码级与构建产物级断言（无需浏览器） | `v8-ai-ui-check.js` |
| 页面可达 + 内联 script 合法性 | `page-check.js` |

### F. 功能专项与接口测试

| 用途 | 脚本 |
|---|---|
| 端到端联调（登录→建项目→模拟推送→校验） | `e2e-test.js` |
| 邮箱推送功能专项（API/入库/幂等/权限） | `mail-push-test.js` |
| 邮箱推送数据层单元测试 | `mail-push-unit.js` |
| 邮箱账户管理单元测试（含密码掩码） | `mail-accounts-test.js` |
| V4.1 数据集 SQL 单元测试 / 真库回归 / AI 后端离线回归 | `v41-dataset-sql.js`、`v41-dataset-sql-db.js`、`v41-ai-backend.js` |
| V6.1 筛选单元测试 / 真库真接口只读回归 | `v61-data-filter.js`、`v61-parsed-filters-db.js` |
| V8 AI 后端自测（10 组：地址/预设/解析/错误/SQL/范围/白名单/分享/公开接口/真实调用） | `v8-ai-backend.js` |
| V9 AI 值域自测 | `v9-ai-valuedomain.js` |
| V9 节点时间同步自检 | `v9-node-times.js` |

### G. 部署发布与运维

| 用途 | 脚本 |
|---|---|
| ★ 一键部署（首次/整机） | `deploy.sh`（根目录） |
| ★ V8 生产增量部署（备份 + 自检 + 可回滚） | `scripts/v8-deploy.sh` |
| ★ 进程守护（健康检查失败自动拉起，降权 www） | `watchdog.sh`（根目录） |

---

## 附：核对清单

| 区块 | 文件数 | 说明 |
|---|---|---|
| `views/` | 40 | 全部 `.ejs`，无子目录 |
| `public/` | 5 | `css/app.css` + `js/app.js` / `charts.js` / `dash.js` / `dashboard.js` |
| `scripts/` | 44 | 42 个 `.js` + 1 个 `.json`（`v7-flow-assembly.json`）+ 1 个 `.sh`（`v8-deploy.sh`） |
| 根目录 | 2 | `deploy.sh`、`watchdog.sh` |
| **合计** | **91** | 40 + 5 + 44 + 2 = 91 |

> 说明：`scripts/` 的 44 个文件构成为 **42 个 `.js`** + **1 个 `.json`** + **1 个 `.sh`**，
> 与任务要求的 44 个 `scripts/` 文件总数一致，逐文件均已在上表覆盖。
