# 一、项目介绍与根目录结构

> 本文档是《项目介绍与目录结构》文档集的总纲，覆盖项目定位、技术栈、运行方式、
> 根目录全部文件清单，以及整个仓库的顶层目录树。
> 各子系统的逐文件说明见同目录下 `02-backend-src.md`、`03-frontend.md`、`04-views-scripts-public.md`。

---

## 1.1 项目是什么

**Neo Zheng DataETL（中文名：数据中台 / 简道云数据推送接收平台）v12.0.0**

一个**企业多系统数据整合平台**。它把 ERP、WMS、SCRM、OA、POS、O2O、B2C 等多个业务系统的数据
汇聚到一处统一管理，让商品、库存、价格、组织架构与权限在中台集中治理，从而保证所有下游业务系统的
**数据一致、口径一致**。

平台的核心数据链路：

```
外部数据源                数据中台                         数据应用
─────────                ────────                        ────────
简道云推送  ──┐                                      ┌── 报表 / 图表
第三方接口  ──┼──→  数据接入 → 数据治理 → 数据服务  ──┼── 可视化看板
手工导入    ──┘         │           │            │    ├── 分享链接
表单采集            原始数据表   解析数据表    数据集  ├── AI 问数
                     (jdywh_data_N) (jdywh_parsed_N)  └── 邮件推送
```

### 一句话定位

> 接收简道云「数据推送 / 流程推送」与第三方 HTTP 接口的数据，落入动态生成的 MySQL 表中；
> 通过可配置的字段解析规则把原始 JSON 值加工成业务可读的中文值；再用拖拽式流程引擎、
> 数据集、报表设计与 AI 问数，把数据变成可看、可查、可分享的成果。

### 平台解决的三个真问题

| 问题 | 平台解法 |
|---|---|
| 多系统数据口径不一致 | 统一接入 + 统一解析规则 + 中文列注释，保证「同一个数在不同系统里是同一个数」 |
| 业务人员不会写 SQL 也看不到数据 | 拖拽流程引擎 + 报表设计器 + AI 问数（自然语言→SQL→自然语言解读） |
| 推送失败无人知晓 | 失败返回非 2xx（403/400/404/500），简道云侧可见；每条接收日志带自然语言变更描述 |

---

## 1.2 版本与技术栈

| 项 | 值 |
|---|---|
| 当前版本 | **12.0.0**（`package.json` version） |
| 线上地址 | https://jdy.zhengl.vip |
| 后端 | Node.js ≥ 18 / Express 4 / MySQL 8（元数据库） |
| 前端 | React 18 + TypeScript 5.7 + Vite 6 + Ant Design 6（SPA） |
| 模板层 | EJS 3（V4.0 迁移 SPA 后的降级路径与表单 POST 入口） |
| 状态管理 | Zustand 5 |
| 图表 | ECharts 6（SPA）+ 自研纯 SVG 图表库（旧模板） |
| 邮件 | Nodemailer 6（发送） + ImapFlow / mailparser（接收） |
| 主色 | `#1668E3` 品牌蓝；页面底 `#EEF3FB`；文字 `#0B1F3B` |

### 数据库依赖分层（`package.json`）

| 类别 | 驱动 |
|---|---|
| **核心依赖** | `mysql2`（元数据库 + MySQL 数据源）、`express`、`ejs`、`better-sqlite3`、`mssql`、`pg`、`mongodb`、`redis`、`@clickhouse/client`、`bcryptjs`、`cookie-parser`、`dotenv`、`xlsx` |
| **集成/推送** | `basic-ftp`（FTP）、`imapflow` + `mailparser`（收件）、`nodemailer`（发件）、`kafkajs`、`mqtt`、`neo4j-driver` |
| **可选依赖**（装不上不影响主流程） | `oracledb`、`snowflake-sdk`、`@duckdb/node-api`、`@zilliz/milvus2-sdk-node`、`node-adodb`、`pulsar-client` |

> **重要架构事实**：实际支持的数据源类型比 README 描述的「MySQL / MariaDB / SQL Server」多得多。
> `src/dstypes.js` 中定义了 15 种类型，`src/datasource.js` 已实现 mysql / mssql / postgres /
> clickhouse / mongodb / redis / sqlite / oracle 的连接分支，其余为声明式登记。
> 应用只有**一个**元数据库连接池（`src/db.js`，固定 MySQL），业务数据可落在任意数据源上。

---

## 1.3 核心能力一览

### 数据接入
- **简道云推送接收**：完整签名校验 `sha1("{nonce}:{payload}:{secret}:{timestamp}")`
- **接口采集（Pull）**：定时/手动调第三方 HTTP 接口，按路径提取数据
- **接口推送（Push）**：把项目数据推送到目标服务器，支持 `{{rows}}` 模板与字段映射
- **表单采集**：拖拽设计表单（24 种控件），生成公开填写链接 `/f/:token`
- **邮件推送**：定时轮询邮箱（IMAP），把邮件附件/正文按项目规则落库
- 鉴权支持：无 / Bearer Token / Basic / API Key

### 数据治理
- **解析前后双表**：`jdywh_data_N`（原始值）+ `jdywh_parsed_N`（解析值）
- **12 种字段解析方式**：成员/部门名称、账号、手机号、关联 ID、地址拼接、时间格式化、数组处理、自定义路径等
- **派生字段**：同一源字段可按路径拆出多列（地址 → 省/市/区）
- **子表展开**、**中文列注释**（写入 MySQL `COMMENT`）、**历史回填**、**行大小保护**（超限自动降级 TEXT）

### 数据处理（流程引擎）
- 拖拽画布编排；数据源节点（项目表 / SQL / 表单 / 手动输入）
- 清洗节点 16 种（条件过滤、字段选择、重命名、去重、空值填充、查找替换、去空白、类型转换、字段拆分、字段合并、JSON 提取、正则提取、公式计算、分组聚合、排序、限制行数）
- 输出节点 4 种（写入数据表 / 写入项目表 / 推送接口 / 生成数据集）
- 公式引擎（ROUND/ABS/CEIL/FLOOR/MAX/MIN/POW/SQRT/IF/CONCAT/LEN/UPPER/LOWER）
- 试运行预览；`run_mode='trigger'` 推送落库后自动重跑

### 分析与可视化
- **数据集**三种来源：SQL 查询（只读校验）/ 数据表 / 项目数据表
- **报表设计器**：12 种图表（表格、柱状、折线、面积、饼、环形、散点、雷达、漏斗、仪表盘、指标卡、地图）
- **CRM 客户看板** `/dashboard/board`：5 表实时聚合、多排区、明暗双主题
- **外链分享** `/s/:token`：访问密码、有效期、启停、浏览统计
- **AI 问数**：自然语言 → SQL → 执行 → 解读；兼容 OpenAI Chat Completions 协议（DeepSeek / 通义 / 智谱 / Ollama）；支持分享为网页 `/a/:token`

### 系统管理
- 用户管理、角色权限（25 个权限点 / 7 组，角色与权限均可自定义）
- 系统设置（9 个分组 / 56 项，卡片式）
- 审计日志（35+ 类关键操作）、登录日志
- 项目分组（最多 5 级嵌套、批量移动、防环校验、安全删除策略）

---

## 1.4 运行方式

```bash
# 后端（根目录）
npm install
cp .env.example .env      # 填写 DB_HOST / DB_USER / DB_PASSWORD / DB_NAME
npm start                 # = node src/server.js，默认监听 0.0.0.0:8781

# 前端（frontend/ 目录）
cd frontend
npm install
npm run build             # 产出 frontend/dist，由 src/routes/spa.js 托管
npm run dev               # 开发模式 Vite
npm run typecheck         # tsc --noEmit
```

首次启动自动完成：建表、迁移、写入 3 个内置角色、56 项默认设置、初始化管理员
（用户名/密码取自 `.env` 的 `DEFAULT_ADMIN_USER` / `DEFAULT_ADMIN_PASSWORD`）。

> **前端必须构建**：`src/server.js` 通过 `src/routes/spa.js` 托管 `frontend/dist`。
> 若 dist 缺失，SPA 中间件不接管 GET 请求，回落到 `views/` 的 EJS 模板渲染（降级路径）。

### 自测脚本

```bash
BASE=http://127.0.0.1:8781 node scripts/v3-test.js      # v3 全功能验收（126 项）
BASE=http://127.0.0.1:8781 node scripts/v2-test.js      # v2 功能回归（87 项）
BASE=http://127.0.0.1:8781 node scripts/e2e-test.js     # v1 基础功能（17 项）
BASE=http://127.0.0.1:8781 node scripts/page-check.js   # 页面健康检查（37 项）
```

---

## 1.5 根目录文件清单（全部 30 个文件）

### 1.5.1 配置与元数据

| 文件 | 大小 | 说明 |
|---|---|---|
| `package.json` | 1.1 KB | 项目清单：name `neo-zheng-dataetl`、version 12.0.0、`main` 指向 `src/server.js`、`start`/`dev` 均执行 `node src/server.js`；声明全部数据源与集成驱动依赖 |
| `package-lock.json` | 226 KB | npm 依赖锁定文件，保证部署环境依赖版本完全一致 |
| `.env.example` | 1.0 KB | 环境变量模板：端口、数据库连接、`TABLE_PREFIX=jdywh_` 表名前缀白名单、`SESSION_SECRET`、默认管理员、`MAX_BODY_SIZE`、`REQUIRE_SIGNATURE`。**含占位密码，真实值在 `.env`（已被 .gitignore 忽略）** |
| `.env` | 905 B | 本机实际环境变量（数据库账号密码等敏感值），**不入库**，部署时由 `deploy.sh` 生成或手工填写 |
| `.gitignore` | 931 B | 忽略规则：`node_modules/`、`.env`、`*.log`、`logs/`、本地备份与临时文件（`_work/`、`_color-backup*/`、`_sanitize-backup/`、`_mail_attach/`、`data/`、`数据文件/`、各种 `_*.txt`）、打包产物 `*.zip`、调试截图（`browser-screenshots/`、`shots/`）、Ant Design 参考仓库（`ant-design/`）；并**选择性忽略不开源的看板源码**（`frontend/src/pages/dashboard/board/` 等） |
| `-w` | 23 B | 误建的空文件（内容为 `Found. Redirecting to /`），`.gitignore` 末尾 `/-w` 明确排除，无实际用途 |

### 1.5.2 入口文档

| 文件 | 大小 | 说明 |
|---|---|---|
| `README.md` | 22 KB | **项目主文档**（386 行）：定位、功能特性矩阵、快速开始、使用流程、关键设计（签名/自动建表/双表分离/行大小保护/去重/权限隔离/表名白名单/SQL 只读）、流程推送与表单推送分工、节点时间口径修订、已知问题与修复记录、推送性能基准、目录结构 |
| `CHANGELOG.md` | 135 KB | **完整版本变更史**，从 1.0.0 到 12.0.0 共 25 个版本条目，每个版本含需求、实现要点、实测数据与验证结论 |
| `部署文档.md` | 116 KB | 完整部署与运维文档（1136 行）：宝塔面板部署、Nginx 反代、数据库配置、升级步骤、故障排查 |

> ⚠️ **`部署文档.md` 存在编码损坏**：文件正文的中文已乱码（UTF-8 字节被按错误编码解释）。
> 这是一份**历史遗留的损坏文件**，同目录 `_fixdoc.txt`、`_skeleton.txt` 记录了当时的修复尝试
> （探测失败字节位置、统计可读行数 354/1136、输出可读片段用于重写）。
> 文件仍为有效 UTF-8，但内容不可直接阅读；实际部署指引以 `部署文档.md` 之外的
> `deploy.sh`、`watchdog.sh` 与 `README.md` 为准。

### 1.5.3 部署与运维脚本

| 文件 | 大小 | 说明 |
|---|---|---|
| `deploy.sh` | 3.8 KB | **一键部署脚本**（`sudo bash deploy.sh`）。适用宝塔面板 + Node.js（OpenCloudOS/CentOS/Ubuntu）。流程：检查 Node → rsync/tar 同步代码到 `/www/wwwroot/jdy-push`（排除 node_modules/.env/logs/.git）→ 首次生成 `.env`（随机 `SESSION_SECRET`，chmod 600）→ `npm install --omit=dev`（npmmirror 源）→ 目录授权给 `www` 用户 → firewalld 放行 8781 → 打印面板项目配置指引 |
| `watchdog.sh` | 2.3 KB | **进程守护脚本**（建议宝塔计划任务每分钟执行）。逻辑：`curl /healthz` 健康检查 → 失败则按 PID 文件清理残留进程并 `pkill` → **降权到 `www` 用户**重新拉起（避免 root 运行）→ sleep 5 复检并写日志 `/www/wwwlogs/nodejs/jdy-push-watchdog.log` |

### 1.5.4 验收报告（版本迭代记录）

| 文件 | 大小 | 说明 |
|---|---|---|
| `V10-验收报告.md` | 9.6 KB | V10.0.0 验收报告（2026/11/1），生产环境 https://jdy.zhengl.vip |
| `V11-验收报告.md` | 8.1 KB | V11.0.0 验收报告（2026/11/2） |
| `V11.1-验收报告.md` | 9.1 KB | V11.1.0 验收报告（2026/11/2） |
| `V11.2-验收报告.md` | 5.7 KB | V11.2.0 验收报告（2026/11/2） |
| `V12-验收报告.md` | 13 KB | **最新验收报告**（2026/11/2 12:01:29）：结论「10 项需求全部实现，验收全绿，已部署生产并推送 GitHub / Gitee」，含本地/生产双列对照的验收项表格 |

### 1.5.5 打包产物与图片

| 文件 | 大小 | 说明 |
|---|---|---|
| `jdy-push-部署包.zip` | 421 KB | 部署包压缩产物（被 `.gitignore` 的 `*.zip` 规则忽略，仅本地保留） |
| `_local-backup-20261027-150646.zip` | 92 KB | 2026-10-27 的本地备份快照（被忽略，仅本地保留） |
| `箭头2.png` | 3.4 KB | UI 素材图片，疑似「箭头」图标，用于文档或界面示意；仓库中未见代码引用 |

### 1.5.6 本地临时与诊断文件（均被 `.gitignore` 忽略）

这些是开发/排障过程中产生的临时文件，**不属于项目运行所需**，仅本地保留：

| 文件 | 大小 | 说明 |
|---|---|---|
| `_diag.txt` | 1.2 KB | 编码诊断输出：统计总行数 1136、GBK→UTF8 还原 504 行、可恢复 219 行、含 PUA/替换符 413 行（对应 `部署文档.md` 的乱码修复） |
| `_diag2.txt` | 1.8 KB | PUA（私用区）字符可编码性测试：逐字符验证 `gb18030`/`gbk`/`cp936` 编码与往返结果 |
| `_fixdoc.txt` | 7.5 KB | 损坏文档修复记录：失败字节位置（26）、上下文 hex、容错还原后 3491 个替换符、还原后 1136 行及前 40 行内容 |
| `_skeleton.txt` | 19 KB | 从损坏文档提取的「可读（mostly-ASCII）行」共 354/1136 行，作为重写 `部署文档.md` 的文本依据 |
| `_attach.txt` | 1.7 KB | 附件读取时的 openpyxl 告警捕获输出（PowerShell 重定向记录） |
| `_imap1.txt` | 396 B | IMAP 连通性测试：登录成功、邮箱文件夹列表（Trash/Drafts/INBOX） |
| `_imap2.txt` | 812 B | 邮件结构解析测试：主题「转发：【日报】药店智能体触达转化」、发件人、MIME 结构（multipart/mixed） |
| `_xl.txt` | 1.6 KB | Excel 解析诊断：工作表名「新增智能体签约」、维度 A1:BG83（83 行 × 59 列）、表头首列 `data_id` |
| `_xl2.txt` | 14 KB | 前 2 行完整数据 dump（`data_id`、标题、流水号、区域等字段值） |
| `_zipchk.txt` | 1.3 KB | 部署包内文档校验：zip 内 md 文件列表、README 编码（UTF-8）、行数、PUA/U+FFFD/问号字符计数 |
| `_sanitize.log` | 270 B | 脱敏处理日志：依次处理 `README.md`、`.env.example`、`deploy.sh` 三个文件 |

---

## 1.6 顶层目录树

```
jdy-push/
├── src/                    后端源码（45 个文件 / ~1.0 MB）—— Express 应用、路由、业务模块
│   └── routes/             路由：push（简道云推送）/ api（REST）/ pages（EJS+表单 POST）
│                                 / public-forms（公开表单）/ spa（前端托管+回退）
├── frontend/               React 18 + TS + Vite 6 单页应用
│   ├── src/                源码（126 个文件）：api / components / layouts / pages / stores / styles / types / utils / assets
│   ├── dist/               构建产物（由后端托管）
│   └── (配置)              index.html / vite.config.ts / tsconfig.json / package.json
├── views/                  旧 EJS 模板（40 个）—— 降级渲染路径 + 表单 POST 结果页 + 邮件分享入口
├── public/                 旧静态资源（5 个）：css/app.css + js/{app,charts,dash,dashboard}.js
├── scripts/                测试与运维脚本（44 个）：v2→v12 逐版本验收、对账核验、流程导入、
│                           数据迁移回填、浏览器 UI 测试、部署发布
├── docs/                   本文档集所在目录
│   └── structure/          01 总纲 / 02 后端 / 03 前端 / 04 模板与脚本
│
├── ant-design/             Ant Design 全家桶参考源码（7 个子仓库，~88 MB，已 gitignore）
│   ├── ant-design-master/          参考：组件库主仓库
│   ├── ant-design-pro-master/      参考：Pro 脚手架
│   ├── ant-design-mobile-master/   参考：移动端组件库
│   ├── ant-design-landing-master/  参考：落地页模板
│   ├── pro-components-master/      参考：ProComponents
│   ├── ant-motion-master/          参考：动画库
│   └── x-main/                     参考：Ant Design X（AI 交互组件）
│
├── data/                   分析数据集与脚本（965 文件 / 500 MB，已 gitignore）
│   ├── agg-split/{raw,classified}/  按月切分的聚合数据 JSON（~113 个，每个 3-5 MB）
│   ├── agg-original-backup/         切分前的原始聚合数据（2 个 .json.gz）
│   ├── analysis/                    触达转化分析：Python 脚本 + 中间 JSON + 报告 HTML + 趋势图
│   ├── crm/                         CRM 站点数据抓取：Playwright/CDP 脚本（54 个 .mjs）+ Chrome profile + 截图
│   └── report/                      PPT/文档生成流水线：build_*.py 系列 + 图表目录（bisect/dough/combo/preview）
│
├── _work/                  开发过程工作区（59,090 文件 / 4.3 GB，已 gitignore）
│                           ≈200 个按版本/用途命名的子目录（chrome-* 浏览器 profile、
│                           v7d*/v8*/v9*/v10*/v11*/v12* 各版本中间产物与发布包）
│                           + 数百个根级临时脚本、探针、截图（lead_*.js、verify_*.js、*.png）
│                           其中 _work/test/guard-flow-regression.js 是流程时间列防复发单测
│
├── browser-screenshots/    浏览器调试截图（224 个 PNG / 24 MB，已 gitignore）
├── shots/                  看板调试截图（5 个 PNG，已 gitignore）
├── 数据文件/                业务导出 Excel（3 个「新增智能体签约_*.xlsx」，已 gitignore）
├── _mail_attach/           邮件附件测试样本（1 个 xlsx，已 gitignore）
│
├── _color-backup-20261028-185422/   配色改版前的备份（src/views/public 快照 + .env + 说明）
├── _color-backup2-20261028-211604/  第二次配色改版前的备份（src/views/public 快照）
└── _sanitize-backup/       脱敏前的原始文件备份（.env.example / deploy.sh / README.md）
```

### 目录规模统计

| 目录 | 文件数（磁盘） | 大小 | Git 跟踪 | 性质 |
|---|---:|---:|---:|---|
| `frontend/` | 226（含 dist 构建产物） | 6.4 MB | 110（src 104 + 根配置 6） | **源码**（看板源码选择性忽略） |
| `src/` | 45 | 1.0 MB | 45 | **源码** |
| `scripts/` | 44 | 714 KB | 43 | **源码/脚本** |
| `views/` | 40 | 589 KB | 39（`share-view.ejs` 除外） | **源码/模板** |
| `public/` | 5 | 250 KB | 5 | **源码/静态资源** |
| `data/` | 965 | 500 MB | 0 | 分析数据集 |
| `_work/` | 59,090 | 4.3 GB | 0 | 开发工作区 |
| `ant-design/` | 9,870 | 88 MB | 0 | 第三方参考 |
| `browser-screenshots/` | 224 | 24 MB | 0 | 调试截图 |
| `_color-backup*/` | 43 | 983 KB | 0 | 配色备份 |
| `shots/` | 5 | 594 KB | 0 | 调试截图 |
| `数据文件/` | 3 | 114 KB | 0 | 业务数据 |
| `_mail_attach/` | 1 | 6.4 KB | 0 | 测试样本 |
| `_sanitize-backup/` | 3 | 17 KB | 0 | 脱敏备份 |
| **Git 跟踪文件合计** | — | — | **257** | — |

> **磁盘与 Git 的差异说明**：`frontend/src` 磁盘 126 个文件但只跟踪 104 个，差 22 个正是
> `.gitignore` 明确排除的「不开源看板源码」——`frontend/src/pages/dashboard/board/`（20 个）、
> `pages/dashboard/Board.tsx`、`pages/dashboard/TopBar.tsx`、`pages/dashboard/CrmDashboard.tsx`、
> `pages/dashboard/EChart.tsx`、`pages/share-view.tsx`。同理 `views/share-view.ejs` 也被排除。
> 磁盘总数 30 个根文件中有 15 个未入库（`.env`、zip、`_*.txt`、`_sanitize.log`、`-w`），均为本地文件。

---

## 1.7 文档集导航

| 文档 | 覆盖范围 | 文件数 |
|---|---|---:|
| `01-overview-and-root.md`（本文） | 项目介绍、技术栈、能力、根目录清单、顶层目录树 | 30 根文件 |
| `02-backend-src.md` | `src/` 后端全部模块 | 45 |
| `03-frontend.md` | `frontend/` React SPA 全部源码（含根配置 6 个） | 132 |
| `04-views-scripts-public.md` | `views/` + `public/` + `scripts/`（根部署脚本已计入第 1 篇） | 89 |

> 合计 **296 个文件**（去重后；`deploy.sh` / `watchdog.sh` 同时出现在第 1 篇与第 4 篇，
> 只计一次）。其中 **Git 跟踪的 257 个文件 100% 有对应描述**：
> 根 15 + `src/` 45 + `views/` 39 + `scripts/` 43 + `public/` 5 + `frontend/src` 104 + `frontend` 根配置 6 = 257。
