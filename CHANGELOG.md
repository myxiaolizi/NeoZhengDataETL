# 更新日志（CHANGELOG）

本文件记录 Neo Zheng DataETL 的版本迭代历史。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [8.0.0] - 2026-10-31

本版是**AI 问数可用性 + 数据可分享 + 生产链路补齐**升级：定位并修复「AI 问数完全不可用」的 4 个根因，
把问数从「单个数据集」升级为**多数据范围**（数据集 / 数据项目 / 邮箱推送 / 流程产出表），
新增**分享为网页**（含手机 + 电脑都能用的公开问数页 `/a/:token`），
重新独立核对两个 CRM 项目与业务表并**证明快照口径 100% 一致**，
并把 **V7 从未部署到生产的后端**一并补齐。
本版同时包含 [7.1.0] 的看板与报表中心 30+ 项优化（详见该章节）。

### 1. AI 问数为何完全不可用（根因，全部实测）

用户给的配置是 MiMo（小米）开放平台。实测出 **4 个根因**，其中 3 个是代码/配置缺陷、1 个是能力缺失：

| # | 根因 | 证据 |
|---|---|---|
| 1 | **接口地址被无条件双拼** | 旧 `ai.js` 是 `baseUrl + '/chat/completions'`。用户按控制台填**完整地址** `https://api.xiaomimimo.com/v1/chat/completions` → 实际请求 `.../v1/chat/completions/chat/completions` → **HTTP 400**（实测返回 `{"error":{"code":"400","message":"Invalid request","param":"404 NOT_FOUND"}}`） |
| 2 | **供应商预设指向错误的平台** | 旧 `PROVIDERS.mimo` 是 `https://api.mimo.ai/v1` + 模型 `mimo-7b-rl`，而真实是**小米 MiMo 开放平台** `https://api.xiaomimimo.com`，模型 `mimo-v2.6-pro` / `mimo-v2.6-flash`。选预设必然调不通 |
| 3 | **库里的 key 是失效的** | `jdywh_settings` 里 `ai_enabled=1`、`ai_base_url`、`ai_model`、`ai_provider` 都在，但 `ai_api_key` 是旧 key → 401 `{"error":{"message":"Invalid API Key","code":"401","type":"invalid_key"}}` |
| 4 | **只支持单个数据集** | `ai.ask()` 只有 `datasetId`，且 `buildSchemaContext` 会把库里的坏数据集一并塞给模型（id 41 表名 `zkcrm-ry`、42 SQL `select * from zkcrm-ry`、46/47 指向已不存在的项目 988/989）→ 生成的 SQL 必然执行失败 |

**根因 1 的修法（`normalizeBaseUrl` / `buildEndpoint`）**：把用户可能填的任意形态归一化到「协议根」，再按 `ai_api_style` 拼端点。
实测 9 种形态全部正确，且**任何情况都不会出现重复的 `/chat/completions`**：

| 用户填的 | 实际请求 |
|---|---|
| `https://api.xiaomimimo.com` | `.../v1/chat/completions` |
| `https://api.xiaomimimo.com/` | `.../v1/chat/completions` |
| `https://api.xiaomimimo.com/v1` | `.../v1/chat/completions` |
| `https://api.xiaomimimo.com/v1/chat/completions` | `.../v1/chat/completions` |
| `https://api.xiaomimimo.com/chat/completions` | `.../v1/chat/completions` |
| `https://api.xiaomimimo.com/v1/responses` | `.../v1/chat/completions`（chat 风格） |
| `https://dashscope.aliyuncs.com/compatible-mode/v1` | `.../compatible-mode/v1/chat/completions` |

**MiMo 协议实测（本项目内两路独立验证，结论一致）**：
- `mimo-v2.6-pro` 2233ms / `mimo-v2.6-flash` 904ms 均 200；
- **`choices[0].message.content` 才是答案，`reasoning_content` 是思维链**（英文推理，**占用 `max_tokens` 预算**：`max_tokens=16` 时推理吃光 15 个 token 导致 `content=""`）→ 一律丢弃；`max_tokens` 下限 256、SQL 生成用 2048；
- SQL 生成能力**优秀**：给逻辑表名 + 中文列清单后 3/3 严格只输出一条 SELECT（无 ``` 围栏、无分号、**自动给中文列名加反引号**）；
- 长上下文 OK（120 字段 → `prompt_tokens=1153`；8247 字符 → 4160）；
- `max_tokens` 16/2000/9000/20000/128000 全部 200；
- 流式 SSE 可用（先出 `reasoning_content` 再出 `content`）；`tools` 函数调用可用；`/v1/responses` 与 `/anthropic/v1/messages` 均 200 兼容；
- **`GET /v1/models` 返回 405** → 「测试连接」绝不依赖它，一律走一次最小 chat 调用。

**错误信息中文化**（实测错误结构逐条映射）：
`401 invalid_key` → 「API Key 无效或已过期」；`400 Unsupported model` → 「模型名不受支持」；
`400 Invalid request / param:404` → 「接口地址不正确」；`ENOTFOUND` → 「无法连接 AI 接口：无法解析域名」；超时 → 「请求超时」。

### 2. AI 问数：从「单数据集」到「多数据范围」

新增 `src/ai-scope.js`，把 4 类来源解析成统一对象 `{kind,id,name,table,alias,columns,rowCount,invalid,reason}`：

| kind | 来源 | 物理表 |
|---|---|---|
| `dataset` | 数据集（`jdywh_datasets`） | `project` → 项目解析表；`table` → `source_table`；`sql` → 内联为逻辑表 |
| `project` | 数据项目（`jdywh_projects`） | `parsed_table`（或 `data_table`） |
| `mail` | 邮箱推送项目（`jdywh_mail_projects`） | `data_table`，如 `jdywh_mail_31`（1062 行） |
| `flow` | 处理流程产出表 | 从 `jdywh_flows` 的 `sink_table` 节点解析，如 `jdywh_crm_signing_v7` |

**关键设计一：逻辑别名 + CTE 注入**。不把中文物理表名直接塞进提示词，而是告诉模型「逻辑表 `t1` = 这些列」，执行时拼 `WITH t1 AS (...)`。实测模型 3/3 会正确沿用 `t1`。

**关键设计二：中文业务名投影（解决「Unknown column '区域'」）**。
`parsed_16` 的物理列名是 `widget_1791449342211` 这类匿名名，中文业务名（如「区域」）只存在于列注释里。
即使把「区域」写进提示词，中文模型仍会**直接把「区域」当列名**写进 SQL → MySQL 报 `Unknown column '区域'`（生产实测命中）。
V8 在 CTE 里把物理列**再投影一份中文别名**（仅在中文名与已有列不重名时），于是 `区域` 与 `widget_1791449342211` **两种写法都能跑**。
实测 4/4 中文列名 SQL 直执行通过；真实问数 3/3 通过。

**关键设计三：按需包裹**。只有模型引用了逻辑别名、或来源存在「匿名列 + 中文业务名」时才包 CTE；
模型直接写白名单物理表（如 sql 数据集自身的 `zkcrm-ry`）时**原样执行**，保持 V4.1 历史契约（返回模型原 SQL）。

**SQL 安全（三层）**：
1. `reports.assertReadOnly()` —— 只允许单条 SELECT/WITH，拒绝 INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/GRANT/多语句；
2. `ai-scope.assertScopeOnly()` —— **表白名单**：FROM/JOIN 引用的表必须 ∈（scope 物理表 ∪ sql 数据集自身源表 `physicalRefs` ∪ 逻辑别名 ∪ 模型自声明 CTE 名）；`information_schema`/`mysql`/`performance_schema`/`sys` 一律拒绝；`jdywh_` 前缀必须精确命中；
3. 强制分页上限 `min(ai_max_rows, 500)`。

**白名单对抗测试 16/16 全对**（放行 3 / 拦截 13），含 **UNION 藏表、子查询藏表、注释绕过、大小写绕过、多语句** 全部拦截。

**顺带修掉一个历史回归**：sql 型数据集的源表名含连字符（`zkcrm-ry`）时，词法解析会拆成表 `zkcrm` + 别名 `ry` → 被白名单误杀。
现在 `parseTableRef()` 在 FROM/JOIN 位置把 `-词` 回拼成完整表名，并把 sql 数据集**已补反引号的 `normalizeSql` 结果**里的表引用加入 `physicalRefs`。
`v41-ai-backend.js` 由 PASS 4/FAIL 5 → **PASS 10/FAIL 0**。

**坏源不静默降级**：`scope-options` 把坏数据集标 `invalid:true` + `reason`，界面置灰；`ask` 遇到全坏源直接给中文错误。
跨数据源（`datasource_id≠0`）明确报「V8 暂不支持跨数据源 AI 问数」，**不静默降级**。

**顺手修的两个真 bug**（自查发现）：
1. **`resp.text()` 超时逃逸**：`AbortSignal.timeout` 同时作用于「等响应头」与「读响应体」，原代码只包了 `fetch()`，读 body 超时会漏出英文 `The operation was aborted due to timeout`。已把两者一起包进 `try` → 一律中文；
2. **SQL 生成超时重试**：107 列提示词下首字延迟偶尔 >60s，对**仅超时类**错误自动重试一次、超时放宽到 2×（上限 180s）。

### 3. AI 问数：分享为网页（他人用手机 / 电脑打开即可问）

新增 `src/ai-shares.js` + 表 `jdywh_ai_shares`（幂等建表）：
`token / title / scope_json / password(sha256) / password_plain / expires_at / allow_export / status / view_count / ask_count / last_ask_at / created_by`，`PRIMARY KEY(id)` + `UNIQUE KEY uk_token(token)`。

**登录态接口**（`requirePerm('ai:use')`）：`GET /api/ai/scope-options`、`POST/GET /api/ai/shares`、`PATCH/DELETE /api/ai/shares/:id`。
**公开接口**（无登录，**必须放在 `requireAuthApi` 之前**，已实测挂载位置正确）：`GET /api/public/ai-shares/:token?pwd=`、`POST /api/public/ai-shares/:token/ask`。

**隐私设计（三层）**：
1. **meta 不暴露物理表名**：`sources[]` 只有 `{kind,name,rowCount,columnCount}`，无 `table`；
2. **公开问数不回传 SQL**：`sql` 字段刻意省略（防表结构泄露）；
3. **有密码分享在验证通过前 `sources` 为空**，不泄露「分享里有什么数据」；`passwordError` 用 200 状态码返回（前端原地显示密码框，不会被当成登录失效）。

**限流与审计**：单 token 20 次/分、单 IP 30 次/分、密码错 5 次/10 分钟 → 429；公开问数写 `jdywh_ai_chats`（`user_id=NULL`，`message` 前缀 `share:<id>`）。

**修掉一个生产才暴露的链接拼接 bug**：宝塔 Node 反代默认 `proxy_set_header Host $host:$server_port`，且只设 `X-Scheme`（不设 `X-Forwarded-Proto`），
导致旧 `requestHost()` 拼出 `http://域名:443/a/xxx`（协议错 + 端口多余），复制到微信/短信会走 301、个别客户端直接失败。
现在按 `X-Forwarded-Proto` → `X-Scheme` → Host 端口是否为 443 → `req.protocol` 取协议，并去掉默认端口（https 的 `:443` / http 的 `:80`）。
生产实测链接已变为 `https://jdy.zhengl.vip/a/<token>`。

**前端**：`/ai` 页新增数据范围多选（按 4 类分组、显示行数/列数、坏源置灰、超 `maxSources` 拦截）、
「分享」弹窗（标题/密码/有效期/允许导出 → 链接 + 复制 + 打开预览）、「分享管理」抽屉（复制/停用-启用/删除二次确认）；
新增公开路由 **`/a/:token`** 独立布局（**不套 BasicLayout**，手机优先：气泡对话 + 吸底输入 + `env(safe-area-inset-bottom)` 安全区 + 结果表横向滚动）；
`/a/` 前缀**完全不探测登录态**（未登录访客不会打到 401）。

**修掉公开页「0 个数据来源」bug**：根因是裸 `fetch` 未解包后端 `{ok, data:{...}}` 外层（只有 `api.*` 会自动取 `data`），
导致 `json.sources` 为 `undefined` → 页面判成「无可问数来源」。已在 `publicAiRaw()` 显式解包。

### 4. 两个 CRM 项目的数据核对（独立重做）

**基准**：`数据文件/新增智能体签约_20261030233545.xlsx`，Sheet「新增智能体签约」，**96 数据行 × 59 列**。
⚠️ 两个**重名列**必须按列序号读：`优惠券`（idx 25/29）、`流程状态`（idx 38/56）；`data_id` 在 idx 0。

**4 个「假差异」陷阱（踩了会白改一遍）**：

| # | 陷阱 | 真相 |
|---|---|---|
| 1 | 以为 `parsed_16` 列名是中文 | **错**。列名是 `widget_xxx`/`w_xxx` 匿名列，**业务名在 `COLUMN_COMMENT` 里**，必须按注释映射 |
| 2 | 以为主键是 `data_id` | **错**。`parsed_16` 主键列是 **`jdy_data_id`** |
| 3 | `流程状态`(idx56) 直接比文本 | **错**。DB 是 `sys_flow_state_2` 存 `0/1`，业务是 `进行中`/`流转完成` → 必须映射（1→流转完成） |
| 4 | 时间列直接比字符串 | **错**。业务是分钟精度，DB 是 `datetime` → 统一到分钟 |

另有 3 处「注释被改过名」的列需特殊映射：`渠道充值和余额` → 注释 **`渠道信息(解析)`**；第 2 个 `优惠券` → **`优惠券(结果)`**；第 1 个 `流程状态`(idx38) → **`流程状态(节点)`**。

**`签约类型` 的真相 —— 不是缺字段，是没认出来**：
`raw_json` 里**没有**「签约类型」字样（0 行），但它对应 `data._widget_1793343168111`；映射到 `parsed_16` 是 **`w_1793343168111`**（列注释仍是占位符，`field_defs.field_name` 也是占位符 → 所以按业务名找不到）。
**实测 96/96 完全一致**（xlsx 与 DB 都是 `SIC合作连锁签约 93 + 新连锁签约 3`）。

**结论：快照口径下 100% 一致**

```
映射列 57（含 data_id，缺失 0）；比对单元格 5472
差异 6 格 / 3 行；按列：实施对接时间 3、更新时间 3
非 fresh 行差异 = 0        ← 核心断言
快照口径一致率 = 100.0000%
```

这 6 格**全部落在「快照时刻之后仍收到真实推送」的 3 行**上（`...c0ca / ...cb / ...cc`）：
`jdy_op_time` = `2026-10-31 13:01:15 / 13:01:53 / 13:05:23`（北京），与 `parsed_16.updated_at` 逐秒吻合。
→ **改成表格的旧值等于用旧快照覆盖实时数据、让线上数据倒退**，因此本轮 **DB 写入 0 次**，也**不创建 apply 脚本**。
→ 这也**正面证明简道云推送链路是通的、实时的**。

**关于 V7 的两处数字（本版纠正了内部一次误判）**：
V7 的「流程状态 43 差异」在 **idx38**（varchar 节点名 vs 业务节点名，真差异，V7 回填已修）；
V7 的「签约类型 87 差异 / 只有 9 行有值」是 **回填前**（20:41）的快照，`backfill-plan`（20:56）随后写了 82 格，**9 + 82 + 5 = 96 完全自洽**。
→ **V7 的计数没有错**。V7 真正遗留的是「根因定性」与「生产链路未同步」。

**根因（最终版）**：`parsed_16` = 「该行最后一次收到 webhook 那一刻」的快照。业务侧不逐条发 webhook 的批量操作会造成时点差；**但只要业务侧发推送，我们就是实时正确的**。

**V7 真正遗留的三条（本版处理）**：
1. `src/flow-state.js` 缺 `开始 → 销售签约` 别名 → 首节点实例再推送会把「开始」写进业务列（**本版已修**）；
2. `flow-state.aggregate()` 终态不置空 → 终态实例再推送会写错两列（**本版未修**，列为后续）；
3. **V7 后端从未部署到生产**（**本版随部署补齐**）。

**已知未修（如实列出，不做「已解决」冒充）**：
- `aggregate()` **终态置空缺失**：3 个终态实例（`...c0e0` / `...d215f` / `...d2163`）在 `parsed_102` 里分别有 **7 / 7 / 5** 条事件（按 `event_instance_id` 关联），`aggregate()` 会返回 `策略审核/郑磊`（正确应为空）。当前这 3 行值是对的（来自 V7 回填），但**再次推送就会写错** → 风险「潜在但非纯理论」，属行为变更需单独评审；
- legacy `aggregate()` 排序键仍是 `header_created_at`，**36 个实例存在 1ms 级 `jdy_op_time` 回退**，建议后续统一为 `(jdy_op_time, id)`。

### 5. 流程宽表（16 + 102 合成）

`jdywh_crm_signing_v7`：**96 行 × 61 列**（`id` + `created_at` + 59 业务列），列顺序与业务表完全一致；重名列改名 `优惠券(结果)` / `流程状态(节点)`；`uk_flow_data_id(data_id)` 唯一索引（upsert 前提）。

```
比对单元格 5664；差异 6 格 / 3 行
非 fresh 行 96 × 59 逐格 0 差异      ← 核心断言
```

**「当前节点 / 当前负责人」四要素推导规则在当前库数据上仍 96/96 命中**（来源分布 `events=66 / fallback_16=26 / ended=4 / empty=0`）。

**实时性最强证据**（同一行、同一条规则、两个切点）：
```
6adafffb466e4b153257337c
  cutoffTime=2026-10-30T15:30:00Z（业务表快照） → 连锁使用 / 郑飞   ← 精确命中业务表
  cutoffTime=''              （生产实时口径） → 客户培训 / 郑磊   ← 精确命中最新推送
```

**推送实时触发实测 14/14 PASS**（走 `flow-ingest.triggerOnPushAfterSave(102)` 与 `push.js.triggerFlowsAfterPush(16)` 两条真实生产调用）：
钩子同步返回 0ms（不阻塞简道云）→ 目标表 **1059ms** 后生效；冷却 3s 内重复触发被合并；运行中重入被拒；删除探针后 1714ms 自动还原、无残留。
**不做增量 upsert 的理由**：瓶颈在读不在写；增量需维护脏行快照，一旦漂移就**静默漏更新**，比慢更危险；全量 upsert 天然自愈。

### 6. 处理流程引擎改造（3 处，全部向后兼容）

| 改动 | 说明 |
|---|---|
| **能力自检前置门** | 新增 `unknownNodeTypes()` / `assertFlowSupported()`（已导出）。`run()` 在**任何节点执行前**自检 → 返回 `{ok:false, message:"该流程使用了当前服务端不支持的节点类型：…请先升级服务端到 V8 再运行该流程。"}`，中文可读、无堆栈；`triggerOnPush()` 遇不支持节点跳过并 `skipped:[{reason:'unsupported_nodes'}]`；`runClean()` 的 `default: break` → **throw**；`normalizeNodes()` 不再把未知类型悄悄改成 `filter`（旧行为保存一次就损坏流程定义） |
| **批量 upsert** | 逐行 upsert 96 行 = 96 次远程往返，实测同一次推送触发耗时 **38362ms**。改为多行 `VALUES ... ON DUPLICATE KEY UPDATE`：`sink_table` 1097ms → **98–159ms**，单次全量 1935/1569ms → **1047/1130/1305ms**。语义等价（同列集、同 `keyField=data_id`、两次运行全表指纹一致） |
| **`NODE_ALIAS` 补 `开始 → 销售签约`** | 业务流程表首个节点叫「销售签约」，流程事件流里是「开始」。V7 的 C3 推导规则已做该别名，但**推送实时链路**（`flow-state.js`）漏了 → 首节点实例再推送会把「开始」写进 `parsed_16.flow_current_node`，值域漂移并顺着宽表流进看板 |

**回归全绿**：`v7-flow-join.js` 132/132、`v7-flow-assembly-dryrun.js` 11/11、`v7-flow-push-wire.js` 9/9、`v7-flow-check-assembly.js` 通过。

### 7. 生产部署现状（审计结论 + 本次补齐）

| 项 | 状态 |
|---|---|
| **6.1 的修改** | ✅ **已部署且已生效**（`settings.js` 含 `DEFAULT_CACHE_TTL_MS`；`/api/settings/public` 返回 `Cache-Control: no-cache, no-store, must-revalidate`） |
| **7.0/7.1 的后端** | ❌ 部署前**未部署**：生产 `src/flows.js` 48488B（本机 96297B，`grep pick_current_task` = 0）、`schema.js` 无 `columnNameSet`、`routes/push.js` 无 `parsedCellOf`、`flow-ingest.js` 无 `FLOW_ON_PUSH` |
| **版本错配** | 部署前生产代码 = 6.1，但库里已有 V7 的 flow 25（`run_mode=trigger`）→ **在生产点运行必然报节点类型错误**；且生产无触发逻辑 → 宽表**永不自动刷新**；字段清空 bug **仍在线** |

**本次随部署一并补齐**：`src/**`（含 V7/V7.1 未部署文件 + V8 新增 `ai-scope.js`/`ai-shares.js`）、`scripts/v7-*` 与 `scripts/v8-*`、`frontend/dist`（重新构建）、`package.json`、`CHANGELOG.md`、`README.md`；保留生产 `.env` 与 `node_modules`。

### 8. 验证（全部实测，可复跑）

| 项目 | 结果 |
|---|---|
| **AI 后端自测** `scripts/v8-ai-backend.js` | **PASS 103 / FAIL 0** |
| **AI 统一验收** `scripts/v8-acceptance.js --ai` | **33 / 33** |
| **数据对账复核** `scripts/v8-reconcile-verify.js` | **PASS 6 / FAIL 0，EXIT=0**（映射 57 列 / 5472 格 / 非 fresh 0 差异 / 快照口径 100%） |
| **流程宽表复核** `scripts/v8-flow-verify.js` | **PASS 31 / FAIL 0 / BLOCK 0，EXIT=0**（生产环境 PASS 23 / SKIP 2，缺 xlsx 属预期；本次已随生产部署 xlsx，达 PASS 31） |
| **流程 + 历史回归** `scripts/v8-acceptance.js --flow --regress` | **9 / 9** |
| **V4.1 AI 后端回归** | **PASS 10 / FAIL 0**（修复前 4/5） |
| **V4.1 数据集 SQL / V6.1 数据明细 / V7 三项** | 全通过 |
| **SQL 白名单对抗测试** | **16 / 16** |
| **中文列名直执行** | **4 / 4**（修复前 0/4，报 `Unknown column '区域'`） |
| **分享链路 HTTP 端到端** | **35 / 35** |
| **前端 AI UI 断言** `scripts/v8-ai-ui-check.js` | **59 / 59** |
| **TypeScript** | `npx tsc --noEmit` → **0 错误** |
| **前端构建** | `npm run build` → 成功（92 assets） |
| **生产浏览器验收（桌面 + 3 手机视口）** | **27 / 27 PASS**（含公开页提问返回 96 条、无横向溢出、无 console error） |

### 9. 部署与回滚

```bash
# 部署（root）
bash scripts/v8-deploy.sh /tmp/jdy-push-v8-src
# 脚本会：备份到 .backup-v8-<ts>/ → rsync（排除 .env/node_modules/.git/数据文件/_work）
#        → 逐文件 node --check → 失败自动回滚 → 权限修正 → dist 自检 → 打印回滚命令

# 重启后验证
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8781/healthz   # 期望 200
node scripts/v8-reconcile-verify.js                                      # 期望 EXIT=0
node scripts/v8-flow-verify.js                                           # 期望 EXIT=0
node scripts/v7-flow-run.js                                              # 追平部署期间的推送
```

**回滚**：`rsync -a --delete .backup-v8-<ts>/src/ /www/wwwroot/jdy-push/src/ && cp -a .backup-v8-<ts>/frontend /www/wwwroot/jdy-push/`，再重启。
**AI 一键关停**：`UPDATE jdywh_settings SET svalue='0' WHERE skey='ai_enabled'`。

### 10. 安全性说明（如实披露）

- `ai_api_key` 目前以**明文**存放在 `jdywh_settings`（与既有 `smtp_pass`、`mail_imap_pass` 一致）。本版**未改变**这个存储方式；建议后续单独评估加密或改用环境变量。
- 密钥**从未**写入任何源码、脚本、日志、CHANGELOG 或 Git；测试统一从 `MIMO_KEY` 环境变量读取；公开接口与错误信息全程 `sk-***` 脱敏。
- `数据文件/`、`_work/` 已在 `.gitignore` 中，业务数据与调试产物不入库。生产上的 `数据文件/` 权限 `600` + 属主 `www`，且已实测**无法经 HTTP 访问**（返回 404）。

---

## [7.1.0] - 2026-10-31

本版针对看板与报表中心的 30+ 项需求做优化：**板块标题收进卡片**、**1080P 单排布局**、
**超期改工作日口径**、**三个排行榜差异化 + 匹配图例**、**策略模块改名并转置**、
**客户明细点击看详情**、**分享迁入报表中心**、**修复 AI 问数不可用**。

### 1. 布局与标题
- 所有板块名称从「板块间隔」移入**卡片自身标题栏**：
  类型汇总与排行、签约趋势与流程处理、客户运行情况、策略运行情况、策略运行趋势、客户明细。
- 删除 `Board.tsx` 中全部 `<SectionTitle>`（含其组件定义），消除「段标题 + 卡片标题」重复。

### 2. 签约概览（第 1 排）
- **1080P（1920）下 6 张卡 1 排显示**（断点从 1520 下调到 1366），不再拆两排。
- **手机端 2 排 × 每排 3 个**（`≤768px` 用 `repeat(3,1fr)`）。
- **消除卡片空白**：根因是 `justify-content:space-between` 在等高卡片里把内容拉开
  （门店卡空隙曾达 158px）。改为 `flex-start` + 内容 `flex:1` 撑满。
  **填充率从 32%~47% 提升到 80%~92%**（实测最低 80%，平均 89%）。

### 3. 流程状态（第 2 排）
- 节点名称、图标、平均耗时、门店数、**当前节点南/北区连锁数**全部收进卡片内。
- 图标显示在**名称前方**（与名称同一行）。
- **为 0 的节点不再置灰**（去掉 `opacity:.62`，保留不可点击行为）。
- **超期改为「工作日」口径**（原按自然日 >7 天）：
  取上一节点完成时间，算到现在的**工作日数**（排除周六日），超过该节点阈值即超期。
  阈值：策略开通 2 · 实施对接 5 · 对接审核 2 · 客服处理 10 · 客户培训 3 · 连锁使用 5 · 策略审核 2。
  销售签约（起点）与流程结束（终点）不参与超期判定。
- **超期口径说明移到弹窗明细表格下方**展示。

### 4. 类型汇总与排行（第 3 排）
- 连锁类型卡变窄（1440 下 385px → **308px**，1920 下 436px），便于横向对比。
- 每个类型行使用**对应标签色的浅色背景**（红/橙/黄/灰各 10%，黄色 12%）+ 同色边框。
- **三个排行榜风格各不相同**：
  · 客户数 = 横向条形图风格  · 门店数 = 大数字 + 迷你环形刻度  · 省份 = 热力色块网格
- **前三名卡片背景**：第 1 名浅粉红 `#fde8ef`、第 2 名浅橙 `#fdeee0`、第 3 名浅黄 `#fdf6dd`。
- 卡片 `height:auto` + `align-items:start`，**底部无空白**（内容底到卡底仅 12~13px = padding）。
- 省份排行榜点击显示**下钻视图**（热力网格 + 该省销售分布 + 连锁明细），
  未用 echarts `map` —— echarts 6 默认不含中国 GeoJSON，`type:"map"` 会抛 `Map china not exists`。

### 5. 签约趋势与流程处理（第 4 排）
- 签约趋势**筛选按钮与标题栏同一行**（放在标题栏右侧），图例仍在连锁类型后方。
- 流程处理**名称、区域筛选、「更多」按钮同一行**（右侧显示「最近 7 天」）。
- 流程处理**显示具体数字**：柱段内标数字 + 柱下节点 chip + 右侧放大合计值。
- 正文显示**最近 7 日**（原 5 个工作日），「更多」弹窗显示**最近 30 日**（原 5 日）。
  改自然日连续窗口，避免周末空洞。
  顺带修复 V7 遗留 bug：后端 `byRegion` 用中文键、前端按 `south/north` 查找，
  导致区域筛选一直为空 —— 现南区数据正常（64 + 138 = 202 自洽）。

### 6. 客户运行情况（第 5 排）
- **1080P 下 6 张卡 1 排**（断点下调到 1366）。
- **未知数据从数据源排除**：匹配不到区域的连锁（实测 3 个：15442/15676/15813）直接跳过，
  `south + north === total` 严格成立，前端删除「未知」列与说明。
- 南北区通过**连锁 ID** 匹配（`mail_31` 连锁ID ↔ `parsed_16` 区域）。
- 删除卡片下方备注/footnote。
- **合计数文字明显大于南北区**：合计 22px/750 vs 南北 12.5px/600。

### 7. 策略运行情况（第 6 排，原名「策略模型 / 类型 · 分区域运行情况」）
- **改名为「策略运行情况」**，标题渲染在卡片标题栏。
- 黄色提示文案改为：**「当前 T+30 转化数据不全，数据会随时间而增长。」**
- **数据卡片转置**：行为「合计 / 南区 / 北区」，列为指标，**右侧空白 0px**，填充率 97%~99%。
- 合计数文字大于南北区（13px/750 vs 11px/600）。
- **成本数据校验（实测结论）**：
  · 有优惠券核销 → 有用券成本：**0 条违规**（64 条全部符合）
  · 有触达 → 有渠道成本：**150 条不符合**（150 行触达>0 但渠道成本=0，累计 1370 人）
  这 150 行同时都有运行策略，说明该策略类型渠道成本本就为 0（免费渠道或未计入），**不是数据错误**。
  前端**照实展示、不编造数据**，并为该情况加 Tooltip 说明。

### 8. 策略运行趋势（第 7 排，原名「客户运行趋势（近 30 日）」）
- **改名为「策略运行趋势」**。
- 新增「**数据标签**」开关（默认开），实际重绘生效（canvas 像素 7073 → 6070 → 7073）。
- **柱线混合**：人数/策略数/成本类用柱形，到店率/核销率/R0I 用折线。
- 指标按钮带**色块标注**，可直接当图例（10 个 chip、10 种颜色，选中实心 / 未选中空心）。

### 9. 客户明细（第 8 排）
- **点击客户名称打开完整详情抽屉**：基本信息、流程进度（含超期天数与阈值）、
  9 节点时间线（完成时间 + 各节点停留时长）、策略与运行数据。
- 新增后端端点 `GET /api/crm/board/client/:id`。

### 10. 顶部筛选与主题
- 修复筛选按钮显示异常：统一高度 32px、同一基线（实测 1920/1440/1280 三档 `top` 与 `height` 均一致）。
- 修复日历选择器错位与样式（弹层在视口内、圆角与设计系统一致、暗色适配）。
- **移除主题切换按钮**（深色/浅色），**只保留颜色调整**（主题色调色板）。

### 11. 分享迁入报表中心
- **分享按钮从看板右上角移除**，改到**报表中心**的报表卡片与内置看板卡片上。
- 点分享弹出设置窗：分享标题、访问密码（含随机生成）、有效期（7/30 天/永久）、
  生成后展示链接 + 「复制链接+密码」+ 已有分享列表（停用/删除）。
- 内置看板分享走 `targetType:"board"`（`targetId` 1 = 中康看板、2 = 客户签约看板）。
- **分享页新增密码输入框**：此前只支持 `?pwd=` 直达，访客拿到链接后无任何输入入口，
  只显示「密码不正确」。现在会正常弹出密码输入界面，输对即进入。

### 12. 修复「分析无法使用」
后端正常（实测 `POST /api/ai/ask` 返回「当前共有 96 个客户」），问题在前端：
页面仍用旧实现、**完全没传 `scope`**，且默认选中的是 `invalid:true` 的失效数据集（id=47/46）。
已改为：从 `getAiScopeOptions()` 加载 → `scope` 以**数组**传递 → 默认只选有效源（优先 CRM 客户签约数据 96 行）
→ 失效项置灰不可选 → 未选范围时三重引导且**不发请求**。
顺带修复历史面板状态标签「白字叠浅底」对比度 1.0:1 的问题。

### 验收
- `npx tsc --noEmit` **0 错误**；`npm run build` 通过。
- 浏览器主验收 **46/46 通过**；补充验收 **9/9 通过**；发布前全页面回归 **16/17 通过**
  （唯一「失败」为测试脚本 `eval` 用法不当，接口实测 200 正常）。
- 覆盖：1920/1440/1280/1200/768/375 六档宽度、深色模式、分享匿名访问、客户详情抽屉、
  数据标签开关、日历弹层位置、无 JS 异常。

> 注：本次**仅发布看板与报表中心相关改动**，主版本号保持 7.x（→ 7.1.0）。
> 工作区中另一并行迭代的功能（AI 问数 V8、flows 引擎）未纳入本次发布范围。

---
## [7.0.0] - 2026-10-31

本版是**数据对账与流程引擎能力**升级：核对两个 CRM 数据项目与业务表格，
反改历史数据使其完全一致，并**改造处理流程引擎**（新增关联/选取当前待办/计算列三类节点 +
推送实时触发），加工出一张与业务表完全一致的宽表。

### 1. 业务表格基准

数据基准：`数据文件/新增智能体签约_20261030233545.xlsx`（截止 2026-10-30 23:30）
- Sheet「新增智能体签约」，**96 行 × 59 列**
- ⚠️ 有两个**重名列**：`优惠券`（索引 25/29）、`流程状态`（索引 38/56）
- ⚠️ 该文件与 `数据文件/` 目录**不入 Git**（用户明确要求；已在 `.gitignore` 中）

### 2. 核对两个项目（要求 1/3/4）

| 项目 | id | 解析表 | 行数 | 角色 |
|---|---|---|---|---|
| CRM表单推送 | 16 | `jdywh_parsed_16` | 96 | 提供 57 个字段 |
| CRM流程推送 | 102 | `jdywh_parsed_102` | 369（流程事件） | 提供【当前节点】【当前负责人】 |

**关键发现（Lead 独立复核）**：解析表存了两套列——原始列（JSON 原文）与 **`_p` 后缀的显示值列**。
取显示值必须用 `_p` 列，否则拿到的是 `{"_id":...,"name":"周俊"}` 这样的 JSON。

**两处契约错误校正**：
- 第 2 个 `流程状态`（索引 56）= **`sys_flow_state_2`**（0=进行中/1=流转完成），实测 96/96 命中；
  第 1 个 `流程状态`（索引 38）= `widget_1791533061604`（节点名）。
- 按表头名解析 xlsx 会**丢失第 1 个「优惠券」整列**（61 个非空值），必须**按列序号**读取。

### 3. 【当前节点】【当前负责人】推导规则（要求 3）

原实现（「最后一条 created>0 且 canceled==0」）在 69 个有事件的实例上只命中 63 条。
**实测出正确规则，96/96 完全还原业务表**：

```
1. 若 parsed_16.sys_flow_state_2 == 1        -> 两列置空（流程已结束）
2. 否则取【业务表快照时刻(2026-10-30 23:30 北京)之前】的事件，
   选「仍在挂起」的待办 = 最后一条 created_count>0，
   且其后【没有任何 completed_count>0 或 canceled_count>0 的事件】
3. 节点名别名：'开始' -> '销售签约'（业务表用词）
4. 没有挂起待办 -> 回退 parsed_16.flow_current_node / flow_current_owner
```

来源分布：**来自 102 = 66 行 / 回退 parsed_16 = 26 行 / 流程结束置空 = 4 行 = 96**。
四个要素都是必需的（去掉任一项都会失手 1 行，已逐一对照验证）。

### 4. 根因分析（要求 5）

**总根因**：`parsed_16` 只等于「该行最后一次收到 webhook 那一刻」的快照。
业务侧在 10-30 15:00 之后做了三类**不逐条发 webhook** 的批量操作，
于是两边各自停在不同时间点。**不是解析写错，是输入不全 + 快照过期。**

| 列 | 差异 | 具体机制 |
|---|---|---|
| 更新时间 | 88 | CRM 的 `updateTime` 字段；业务侧批量编辑未逐条推送 |
| 签约类型 | 87 | **新字段**（10-30 才加），只有 9 行有值且全部与表格一致，其余只能信表格 |
| 流水号 | 56 | 业务侧整列**重新编号**成 001–096，差值恒为 -118 |
| 流程状态① | 43 | 该字段由简道云**流程引擎**改写，节点流转只发 `task_update`（→102）、**不发 `data_update`**（→16） |
| 连锁ERP名称 | 3 | 同批量编辑 |
| 策略开通时间/连锁使用时间/优惠券 | 各 1 | 业务侧清空，我方保留旧值 |

**顺带修掉一个真实 bug**：`src/routes/push.js` 里有 3 处
`if (v !== null && v !== undefined && v !== '') { parsed[pcol] = ... }`，
导致**字段被清空时解析列永不置空**（保留旧值）。改为 `parsedCellOf(raw, v)`：
`raw === undefined` 不写（字段没来），`raw` 存在但解析为空则写 `''` 置空。

### 5. 反改历史数据（要求 2/4）

`scripts/v7-backfill.js`（默认 dry-run，`--apply` 才写，写前自动备份受影响行）：

```
[APPLY] 84 行 / 10 列 / 295 个单元格；失败 0 行
[apply 后复核] 残留差异 0 行 / 0 个单元格
```

- 幂等：`--simulate-apply` 内存套用后残留 0，第二遍 apply 必为 0（已证）
- 备份：`_work/v7data/backup-<ts>.json`（含影响行全部列原值，可精确回滚）
- 对账结果：**59 列全部可比（0 跳过列），一致率 100%**
  （含重名列，5664 格全量比对；位置式 `xlsx_pos.json` 与原始 xlsx 逐格 0 差异）

### 6. 处理流程引擎改造（要求 6/7）

**新增 3 类节点**（`src/flows.js` NODE_TYPES，24 → 27 种）：

| 节点 | 字符 | 作用 |
|---|---|---|
| `join`（关联） | ⋈ | 按 key 关联两路数据；`left`/`inner`；右侧可 `first`/`last`/`pickCurrent` 聚合；列前缀防冲突 |
| `pick_current_task`（选取当前待办） | ◉ | 按 C3 规则从事件流挑出「当前节点/当前负责人」 |
| `computed`（计算列） | ƒ | 常量 / `copy:` / **`coalesce:`** / **`blankif:`** / **`map:`** 动词 |

> 现有引擎只有「多上游拼接（concat）」，**没有按 key 关联**，无法把 16 + 102 合成宽表——这是本轮必须补的能力。

**推送实时触发**：复用 `run_mode='trigger'`（该列注释本就有此取值，**零 DDL**）。
挂载在 `flow-ingest.js`（102 流程推送）与 `push.js`（16 表单推送，经 Lead 批准）。
`setImmediate` 异步 + 运行中锁 + 3 秒冷却（简道云一次操作常连发多条推送，不合并会跑几十遍）
+ 5 秒配置缓存（无 trigger 流程时缓存命中 **0ms**）+ `FLOW_ON_PUSH=0` 一键关停。

**目标表**：`jdywh_crm_signing_v7` — 8 节点 7 连线：
```
n1 source_project(16) ────────────────┐
n2 source_project(102) ─ n3 pick_current_task ─ n4 join ─ n5 computed
                                   ─ n6 select_fields(59列) ─ n7 rename ─ n8 sink_table(upsert)
```
- 实测运行：96 行 → **96 行 × 59 列**，列顺序与业务表完全一致，`data_id` 唯一
- 两个重名列改名为 `优惠券(结果)` / `流程状态(节点)`，避免建表/关联冲突
- **上线前必须清空 `n3.cutoffTime`**：装配 JSON 里的 `2026-10-30 23:30:00` 是为对账**钉死的快照时刻**，
  留着会让推导永远停在那个时间点。`scripts/v7-flow-import.js` 导入时**自动清空**该字段。
- `upsert` 前自动校验业务主键唯一索引（`ensureUpsertKey`）——
  没有唯一索引时 `ON DUPLICATE KEY UPDATE` 永不命中，目标表会**静默翻倍**，故失败直接报错

**实时性验证**（真实数据，探针事件用完即删）：插入一条合成流程事件 → 重跑流程 →
目标表相应行的两列**立即变为新事件的值** → 删除探针再跑 → **还原**。

### 7. 顺带修复的 2 个真实缺陷

1. **`src/schema.js` 的 `ensureTableFor` 把数组当 Set 用**
   （`columnNames()` 返回数组，代码里调 `.size` / `.has` / `.add`）：
   新建表路径碰不到，一旦「目标表已存在 + 需补列」就抛 `existing.has is not a function`。
   新增 `columnNameSet()` 返回真正的 Set。这直接卡住了目标表的首次写入。
2. **`computed` 节点同名目标列互相覆盖**：原用 `parseKv`（对象），
   「先 coalesce 回退、再 blankif 置空」这类两段加工做不了（实测 96 行全空）。
   改为有序 `parseAssignments`，保留重复目标列。

### 8. 验证

| 项目 | 结果 |
|---|---|
| TypeScript 类型检查 | `npx tsc --noEmit` → **0 错误** |
| 生产构建 | `npm run build` → 通过 |
| **V7 端到端验收**（对账 + 推导 + 目标表 + 流程） | **13 / 13 通过** |
| 浏览器验收（新节点可用 + 装配流程渲染 + 流程列表） | **11 / 11 通过** |
| 流程引擎单测（`scripts/v7-flow-join.js`） | **132 断言 / 全通过** |
| C3 规则回测（`scripts/v7-flow-pick-verify.js`） | **10 / 10**（含四个要素必要性对照） |
| 装配 dry-run（`scripts/v7-flow-assembly-dryrun.js`） | **11 / 11** |
| 推送接线（`scripts/v7-flow-push-wire.js`） | **9 / 9** |
| 实时更新验证（探针事件，用完即删） | **7 / 7** |
| 回归：V4.1 数据集 SQL / 真实库 / AI 后端 | 59 + 15 + 10 全通过 |
| 回归：V6.1 数据明细筛选 | 108 断言全通过 |
| 对账一致率 | **59/59 列、5664 格全量 0 差异** |

**目标表与业务表格的唯一差异（1 行）已证明是「更新」而非错误**：
业务表格导出于 23:30，该行在 **23:47** 又有流程流转（3 条新事件），
目标表取到了更新的值——这正是要求 6「按推送实时更新」的预期效果。

---

## [6.1.0] - 2026-10-31

本版针对 V6.0 上线后的 11 项用户反馈做整改：**站点信息设置不生效的根因修复**、
**页面标题区规范统一（返回最左 / 搜索新建靠右 / 去刷新按钮）**、
**数据明细统一为组件化表格（列显隐、列排序、筛选）**、**顶部标签栏改为浏览器式**。

### 1. 修复站点信息设置后不生效（核心投诉）

**根因（实测定位，不是猜的）**：`src/settings.js` 的设置缓存**永不主动过期**。

```js
// 修复前
let cache = null;
async function load(force) { if (cache && !force) return cache; /* ... */ }
```

`set()` 只在**写入进程的内存**里原地更新，`setMany()` 会 `load(true)` —— 所以在同一个进程里是对的，
但缓存**没有 TTL、也没有跨进程失效机制**，一旦载入就永不回库。后果：

| 场景 | 表现 |
|---|---|
| 写入进程 ≠ 渲染进程 | 渲染进程永远读旧快照，只有重启才恢复 |
| 运维脚本/直接改库 | 所有进程都感知不到 |

**实测证据**：库中 `site_name` 于 10-30 22:34 改为「DataETL」，而 8781 进程（18:01 启动）
的 `/api/settings/public` 仍返回 18:01 的旧快照「简道云推送接收平台」，**偏差 4.5 小时**。

**修复**

- `src/settings.js`：缓存加 **TTL 自动过期**（默认 5s，可用 `SETTINGS_CACHE_TTL_MS` 覆盖，0 = 每次回库）；
  `set()` 就地更新并重置计时；`setMany()` 末尾仍强制回库；
  新增 **inflight 去重**，TTL 到期的瞬间不会被并发请求打穿。
- `GET /api/settings/public`：`Cache-Control: public, max-age=60` → **`no-cache, no-store, must-revalidate`**。
  原来浏览器会把旧站名缓存 60 秒，也是「改了不生效」的独立原因。
- 前端 `stores/app.ts`：站点信息扩到**全部 6 个字段**（名称/简称/副标题/Logo 文字/描述/页脚），
  统一 `fetchSite()`（含并发去重）+ `refreshSite()` 别名，成功后统一写 `document.title`。
- **四个公开页**（登录 / 注册 / 忘记密码 / 重置密码）原先各自硬编码
  `Neo Zheng DataETL` + `企业数据集成平台 · V4.0` 的 `BRAND` 常量，改为统一 `useSiteBrand()` 读 store。
- 侧栏品牌区副标题由「版本号」改为 `siteSubtitle || APP_VERSION`，长站名省略号（不撑破 232px 侧栏）。
- `settings.tsx` 保存成功后 `await refreshSite()`，侧栏 / 浏览器标题 / 登录页立即同步。

### 2. 页面标题区规范统一

**新增 `Page.back` 属性**：返回按钮渲染在**页面名称最左侧**（之前有的页面把「返回」塞在
`actions` 里，视觉上落在中间，用户明确反馈「返回按钮在中间」）。

**搜索区与新建按钮改为靠右对齐**：V4.1 是「名称 → 搜索 → 新建」紧贴名称，用户要求
「靠右对齐，而不是挨着页面名称的后方」。现在是 `[←] 名称 ………spacer……… [搜索] [新建] [次要]`。

**移除全站刷新按钮**（用户要求「所有的页面都不需要刷新按钮」）：共清理 **18 个页面** 的
标题区/工具栏刷新按钮。数据刷新改由这些时机自动触发，已覆盖全部场景：
搜索变化、筛选变化、排序变化、分页变化、增删改成功后回调。
保留的「重试」按钮属于错误恢复、「重置」属于恢复列偏好，不是刷新。

已迁移到 `Page.back` 的页面：`reports/View`、`forms/Data`、`forms/Design`、`integrations/Detail`、
`flows/Design`、`flows/Logs`、`projects/Detail`、`mail-push/Project`；
`reports/Design` 的加载/错误态也补了 `Page.back`（正常态自绘吸顶工具栏内返回本来就在最左）。

### 3. 数据明细统一为 `components/DataTable`

新增 **`frontend/src/components/DataTable.tsx`**，作为全站「数据明细」的唯一实现，
被 **数据项目详情** 与 **邮箱推送 · 数据项目** 两处共用，保证格式与功能完全一致。

标题栏布局（单行，不占额外行/列）：

```
数据明细  共 681 行        [导出] [搜索框] [筛选] [列设置]
   ↑标题+计数              ↑extra  ↑搜索在列设置左侧  ↑入口在最右
```

- **列显示/隐藏 + 列排序**：入口在标题栏**最右端**；勾选显隐（至少保留 1 列）、↑↓ 调序、重置；
  按 `storageKey` 持久化到 localStorage，下次进页面自动恢复。
- **搜索进标题栏**：不再单独占一行/一列，位于列设置按钮**左侧**。
- **筛选**：多条件 AND，5 种操作符（包含/等于/不等于/为空/不为空），按钮带生效条件数徽标。
  面板是**草稿态**——编辑不触发请求，点「应用筛选」才提交（避免每敲一个字符发一次请求）。
- 排序、筛选、分页全部走**服务端**，不把整表拉到前端再过滤。

### 4. 后端筛选共享模块 `src/data-filter.js`

两端（`/api/projects/:id/parsed` 与 `/api/mail-push/projects/:id/rows`）**同构**实现，
另把第三处明细接口 `/api/projects/:id/records` 也接入，避免口径漂移。

op → SQL 映射：

| op | SQL | 参数 |
|---|---|---|
| `contains` | `` `c` LIKE ? `` | `%v%` |
| `eq` | `` `c` = ? `` | `v` |
| `ne` | `` (`c` <> ? OR `c` IS NULL) `` | `v` （NULL 也算不等于） |
| `empty` | `` (`c` IS NULL OR `c` = '') `` | — |
| `notempty` | `` (`c` IS NOT NULL AND `c` <> '') `` | — |

安全约束：列名必须命中**真实物理列白名单**否则丢弃；列名走 `quoteIdent`；
值 **100% 占位符绑定**、零字符串拼接；超 20 条截断；非法 JSON 静默忽略（一个脏条件不会让整页报错）。
两端响应新增 `appliedFilters` / `droppedFilters` 便于排错。

### 5. 修复数据项目分组无法管理和删除

**排查结论**：后端 `project-groups.js` 的增删改**完全正常**（Lead 实测：创建/改名/删除均 200，
有子分组时正确拒绝并返回中文提示）。问题是**前端交互设计**——分组编辑/删除按钮只在
「选中某个分组标签之后」才出现在筛选条右侧，用户根本发现不了入口。

改造：新增 `projects/GroupManageModal.tsx` + `groupTree.ts`，
「分组管理」按钮**始终可见**（在 Page.actions 与筛选条右侧各一个入口），点开为层级化面板：
树形列出全部分组（缩进 + 项目数），每行可**编辑 / 删除 / 在此新建子分组**，顶部可新建顶层分组。
删除有子分组时提前禁用并给 Tooltip 说明；删除有项目的分组时 confirm 里说清项目会移到哪。
顺带修复 `deleteGroup` 查子分组用 `parent_id = ?` 对 NULL 行永远不命中的真实 bug。

### 6. 顶部标签栏重构为浏览器式

**不再使用 antd `<Tabs>`**，改为 div + flex 自绘（`layouts/TabsBar.tsx` + `global.css` 的
`.v61-browser-tabs` 命名空间）：

- 上方 8px 圆角、相邻 1px 边框贴合（两条边叠成一条）
- 激活标签白底、下边框 transparent，与内容区**连体**
- 激活标签顶部 **2px 主色指示条**（Chrome 风格）
- 标题 ellipsis（min 72px / max 180px）、关闭 × 仅 hover 明显
- 溢出横向滚动 + 左右滚动按钮，14 个标签实测页面无横向溢出
- 保留：右键菜单（关闭当前/其它/右侧/全部）、中键关闭、关闭后跳相邻、
  「数据概览」固定不可关、**按用户隔离**的 localStorage 持久化
- 移除标签栏右侧的「刷新」「关闭全部」按钮

> 关键排查：Header 是 border-box（52px 含 1px 下边框），content box 只有 51px，
> 原计划用 `margin-bottom:-1px` 压边框会被滚动容器的 overflow 裁掉、连体失效。
> 改用「非激活 34px / 激活 35px + 激活下边框 transparent」，实测激活标签
> `bottom=52` 精确覆盖边框行、不侵入内容区、相邻间隙恒为 1px。

### 7. 整合期修复的 3 个缺陷

1. **筛选面板「应用筛选」形同虚设**：初版把每次输入都当作提交，导致「边打字边请求」，
   `应用筛选` 点了也没额外效果。改为草稿态 + 显式提交。
2. **合成列被当成可筛选列**：数据明细首列 `display_id` 是后端拼出来的**合成列**，
   服务端白名单会把它丢弃，表现为「加了筛选条件完全没生效」。
   `DataColumn` 新增 `sortable` / `filterable`，合成列标记为 `false`，避免用户白操作。
3. **`api/crm-board.ts` 文件末尾多出一个 `};`** 导致整体编译失败（并行编辑残留），已修复。

### 验证

| 项目 | 结果 |
|---|---|
| TypeScript 类型检查 | `npx tsc --noEmit` → **0 错误** |
| 生产构建 | `npm run build` → 通过 |
| 静态合规审计 | 旧色值 0 / 刷新按钮 0 / 业务 Drawer 越界 0 / 旧版本号 0 / 返回按钮错位 0 |
| 浏览器逐页验收（17 页 × 10 项 + 移动端 17 页 + 关键功能） | **163 / 163 通过** |
| 站点信息端到端（改 → 立即生效 → 还原） | **18 / 18 通过** |
| 分组管理 + 双端筛选端到端 | **24 / 24 通过** |
| 筛选模块单元测试（`scripts/v61-data-filter.js`） | **108 断言 / 全通过** |
| 筛选真库只读回归（`scripts/v61-parsed-filters-db.js`） | **157 断言 / 全通过**（含「0 次写 SQL」自证） |
| V4.1 回归（数据集 SQL / 真实库 / AI 后端） | 59 + 15 + 10 全通过 |
| 移动端 390×844 | 17/17 页零横向溢出、零运行时错误 |

**站点信息实测链路**：改 `site_name/site_subtitle/site_logo_text` → `PUT /api/settings`
→ `/api/settings/public` **同一秒**返回新值（旧实现要等重启）→ 侧栏品牌区、`document.title`、
登录页三处同步更新 → 还原后三处同步恢复。

---

## [6.0.0] - 2026-10-30

参考 `https://zk2.zhengl.vip/pc4.html` 的页面设计重构看板视觉与报表设计器，三项改动。

### 1. 视觉升级 · 对齐 pc4 设计语言

从参考站实测提取完整设计令牌，替换 V5 的旧配色：

```css
/* 浅色 */ --bg:#f2f6fc --panel:#ffffff --line:#dde8f6
        --text:#16253d --text2:#5a7191 --text3:#93a7c2
        --brand:#2563eb --brand2:#3b82f6 --brand3:#60a5fa
        --green:#10b981 --warn:#f59e0b --danger:#ef4444
        --cyan:#06b6d4 --purple:#8b5cf6 --radius:16px
/* 深色 */ --bg:#0a1220 --panel:#101d33 --line:#1e3252 --text:#e2e8f0
```

- **卡片**：16px 圆角、`var(--shadow)`、标题前 6px 方点（带 16% 同色光晕）、hover 上浮 1px + `--shadow2`
- **11 个组件全部重做**：
  - 圆环卡改 SVG（中心大数字 + 右侧 10×10 圆角图例）
  - 半圆进度改 SVG 弧（`PI*74`）+ 8px 渐变进度条
  - 流程图 9 节点 + 8 箭头（伪元素渐变线 + 三角），0 数据节点淡化 55%
  - 排行榜 22px 圆形奖牌（第1红/第2橙/第3黄，各带 38% 同色阴影）
  - 热力矩阵 `color-mix` 渐变 + sticky 表头
  - 明细表超期行 3px 红色竖条 + brand 渐变分页器
  - 图表配色换 `['#3b82f6','#10b981','#06b6d4','#f59e0b','#8b5cf6','#ef4444']`
- **等高修复**：第 1 排 6 卡实测由 227/275 不齐 → **全部 275px**（`grid-auto-rows:1fr`）
- 明暗两套完整适配（含 Modal / Drawer / Popover / 日历 / Tooltip）

### 2. 标题栏 + 筛选区合并为 1 行

新增 `frontend/src/pages/dashboard/TopBar.tsx`：

- **单行 sticky 顶栏**（61px 高）：毛玻璃 `backdrop-filter: saturate(200%) blur(18px)` + 底部 1px 分隔
- 左：LOGO + 标题 + 同步时间（绿点脉冲，刷新时呼吸动画）
- 中：6 个筛选按钮，**32px 高 / 9px 圆角 / 12.5px 字号 / 内联 SVG 图标**（替换 antd 图标）
- 右：5 个 32×32 图标按钮
- 刷新时顶栏底部有滑动进度条
- 窄屏筛选条横向滚动不撑破页面

**修复的 2 个真实缺陷**：

1. **sticky 失效**：`board-root` 上设了 `overflowX:hidden` 使其成为滚动容器，`position:sticky` 完全失效。
   改为不在根节点设 overflow，裁剪下移到 `.board-content`。实测滚动 900px 后 `barTop=0`。
2. **375px 横向溢出 21px**：顶栏负 margin 撑宽父容器（379 vs 375）。补 `width: calc(100% + 40px)` + `boxSizing:border-box` + `overflowX:clip`。实测 `docSW=375=vw`。

### 3. 报表设计器重构为「看板式」

原设计器只能配「一个数据集 + 一个图表」。重构为**多卡片组合式看板设计器**。

**数据模型**（存进报表现有 `config`，不新增数据库列）：
```ts
DashboardConfig { version: 2, mode: 'dashboard', title, subtitle, datasetId,
                  filters?, widgets: DashboardWidget[], theme? }
DashboardWidget { id, type, title, span(12栅格), height, datasetId?,
                  metric, metrics, dimension, agg, chart?, columns? }
WidgetType = kpi|donut|semiGauge|progress|flowMap|rank|bar|stackBar|line|combo|pie|heatmap|table|text
```

**新增文件**：
- `components/DashboardRenderer.tsx` —— 按 widget.type 分发渲染，含单卡错误边界（一张卡崩不影响整页）
- `components/dash-widgets/` —— **14 种 widget** 各一个文件 + `shared.tsx`（CardShell / 主题 / hover CSS）

**设计器三栏**（`pages/reports/Design.tsx` 重写）：
- 左栏 240px：组件库按「基础 / 图表 / 表格与文本」分组，15 项
- 中栏：画布，12 栅格刻度参考，卡片可点击选中（品牌色描边）、↑↓ 调序、✕ 删除
- 右栏 320px：选中 → 卡片属性（标题/类型/宽度/高度/主指标/多指标/分组维度/聚合方式）；未选中 → 全局设置
- 顶部工具条：报表名 + 模板下拉 + 导出/导入 JSON + 重新加载 + 预览 + 保存
- 空画布引导 + **3 套模板**（中康客户看板 / 销售经营看板 / 空白）
- 属性改动实时反映到画布；未保存有标记 + 离开拦截
- **兼容**：`config` 无 `mode:'dashboard'` 时旧报表仍走原单图表逻辑

**View 页**：`isDashboardConfig()` 判定后走 `DashboardRenderer`，否则旧逻辑。

### 验证

| 测试 | 结果 |
|---|---|
| 顶栏合并（CDP 浏览器，30 项） | **30 / 30** |
| 报表设计器三栏（23 项） | **23 / 23** |
| 数值数据集端到端（13 项） | **13 / 13** |
| **合计** | **66 / 66** |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | 通过（11.16s） |

关键实测：
- 顶栏单行「中心偏差 0px」、sticky 滚动后 `barTop=0`、1920/1440/1280/375 四档均**无横向溢出**
- 设计器三栏实测 `240px 808px 320px`，点击组件卡片数 0→1→2，删除 2→1，改标题实时生效
- 端到端：建带数值列的 SQL 数据集 → 5 卡片看板 → 预览页 **2 个 canvas 逐像素采样均非空**，KPI 显示「门店总数 1.21万」+ 南北区拆分
- 保存后重载配置不丢（6 个卡片 / 5 个卡片往返验证）

### 文档

- 新增 `_work/V6-CONTRACT.md`：设计令牌、组件规范、合并布局、DashboardConfig 模型、文件归属

---

## [5.0.0] - 2026-10-30

### 新增：中康智能体客户看板（`/dashboard/board`）

独立的客户签约经营看板，10 个排区 + 完整筛选与主题能力。数据源自 5 张表实时聚合：

| 逻辑名 | 物理表 | 行数 |
|---|---|---|
| CRM表单推送 | `jdywh_parsed_16` | 96 |
| CRM流程推送 | `jdywh_parsed_102` | 357 |
| 运行汇总 | `jdywh_mail_30`（取 `MAX(import_date)`） | 19 |
| 运行明细 | `jdywh_mail_31`（取 `MAX(import_date)`） | 353 |
| 人员对应表 | `zkcrm-ry` | 30 |

**后端**

- 新增 `src/crmboard.js`（约 1100 行）：5 表并行加载、行级标准化、13 个聚合器
- 新增 2 个端点：
  - `GET /api/crm/board` — 全量看板数据（支持 15 个筛选参数）
  - `GET /api/crm/board/detail` — 明细服务端分页
- 关键口径（全部经实测校准，写入 `_work/V5-CONTRACT.md` §3.2）：
  - **签约类型**真值来源 = `w_1793343168111`（`SIC合作连锁签约` 8 条 / 空 88 条）；
    原先误用「SIC录入门店数 > 0」判断，该列 96 行全有值、不是类型标记
  - **流程完成** = `flow_current_node` 为空（96 条中 7 条），不用 `sys_flow_state_2`
  - **节点占比**分母排除「销售签约」「流程结束」，实测合计 = 100.0%
  - **超期** = 当前节点时长 > 7 天
  - **人名归一化**：人员表是「戴丽莎」、CRM 是「戴丽沙」，比较时 `莎→沙` 等价
  - **运行数据关联键** = 连锁ID（最新一天 19 条中 15 条能关联，4 条未签约属正常）

**前端**（`frontend/src/pages/dashboard/board/`，13 个组件 + 1 个主题工具）

- 标题栏：LOGO + 名称 + `-同步时间：MM/DD HH:mm`（取 5 表最大更新时间）
- 筛选区 6 按钮：日期（左按钮右日历、**首次点击=开始、再次点击=结束**）、区域、连锁类型、
  销售、全部筛选条件（8 组多选）、重置；按钮名默认「全部」，选中后显示结果名 + 计数徽标
- 操作区 5 按钮：有效数据、刷新（不刷新页面）、明暗切换、主题色（6 色）、手机二维码
- 第 1 排：签约客户总数（圆环）、门店总数、任务完成进度（半圆+南北区进度条）、
  签约类型、进行中（5 岗位分组，点击看明细）、流程状态
- 第 2 排：9 节点流程图（箭头串联、占比/门店/均时），点击弹「按岗位汇总 + 明细」
- 第 3 排：连锁类型分布 + 客户数/门店数/省份 3 个排行榜（前 5 + 「更多」看全部，名称下方类型标签）
- 第 4-5 排：签约同环比 5 张表（客户/门店/连锁类型/销售/销售×类型），
  **仅在 本周/上周/本月/上月 显示**，含本期/上期/环比/累计
- 第 6 排：签约趋势（30 天堆叠柱+门店曲线+连锁类型快捷多选）、流程推进（5 工作日热力矩阵）
- 第 7 排：客户运行情况（开通/运行策略连锁数、到店率、核销率、转化销售额、人均、触达/发券人数，均分南北区）
- 第 8 排：按策略模块×策略类型分南北区
- 第 9 排：近 30 日运行趋势（双 y 轴 6 指标）
- 第 10 排：客户明细表（**默认 19 列且顺序按需求**、26 列可配置显示隐藏、
  每页 10/20/50、右下角分页、CSV 导出）

**主题**

- `--bg-page` / `--bg-card` / `--text-main` / `--border` 等 CSS 变量通过内联样式挂在 `.board-root`
  （不用 `<style>` 注入，避免污染其它页面）
- 明暗两套完整适配：卡片、表格、分页、Modal/Drawer/Popover、日历、Tooltip
- 修正 antd 6 类名变更：Modal 是 `.ant-modal-container`（非 `.ant-modal-content`）、
  Select 触发器是 `.ant-select`（非 `.ant-select-selector`）

**修复的 3 个真实缺陷**

1. **CSS 变量不生效**：主题变量原以裸声明注入 `<style>`，缺少选择器包裹 → 全部失效；
   改为内联 `style` 自定义属性
2. **筛选弹窗丢选择**：`MultiSelect` / `AllFilters` 的「确定」读 `useState` 闭包，
   「勾选后立刻点确定」会拿到旧值 → 改用 `useRef` 实时镜像
3. **移动端整页横向溢出**：看板根节点补 `maxWidth:100% + overflowX:hidden`，
   宽表格仍在 `.ant-table-content` 内部横向滚动

**验证**

- 后端模块自测 + HTTP 端到端：**53/53 通过**（`_work/test_v5_api.js`）
  含口径一致性强校验：类型分布合计 = 9 节点合计 = 签约类型合计 = 96；
  节点占比合计 = 1.0001；有效模式 83 家、50- 归零；未登录 401
- 浏览器验收（纯 CDP 驱动独立 Chrome）：**109/109 通过**（`_work/v5_accept.js`）
  覆盖 22 组、含全部弹窗/筛选/主题/分页交互 + 1440px 与 375px 两种视口；
  无 JS 运行时异常、无控制台 error
- `npx tsc --noEmit` 无错误；`npm run build` 通过（`Board-*.js` ≈ 79.6 kB / gzip 21.2 kB）

**文档**

- 新增 `_work/V5-CONTRACT.md`：数据源实测结论、字段映射、18 条业务口径、API 契约、
  组件 props 契约、写作用域、配色与主题规范

---

## [4.1.0] - 2026-10-30

本版针对 V4.0 上线后的 9 项用户反馈做全面整改：**建了统一设计令牌 + 统一页面容器**，
把「每个页面各写一套颜色和标题区」的历史问题一次性收敛。

### 1. 修复数据集 SQL 语法错误（用户投诉：「near '-ry LIMIT 20 OFFSET 0'」）

**根因**（实测复现，非推测）：`jdywh_datasets` id=42「zkcrm-ry」的 `source_sql` 是
`select * from zkcrm-ry`。表名含连字符且未加反引号，MySQL 把 `zkcrm-ry` 解析成
`zkcrm` **减** `ry` → `ER_PARSE_ERROR / 1064`。
补充发现：**即使不加分页（`select * from zkcrm-ry`）也照样报错**，
`paginate()` 只是把报错位置挪到了 `-ry LIMIT 20 OFFSET 0`，让用户看到的是这句话。
（反证：同表 id=41 是 `table` 型数据集，走 `quoteIdent()`，一直正常 —— 说明只有「手写 SQL」路径缺引号。）

**修复**

- `src/datasource.js` 新增 `normalizeSql(ds, sql)`：**词法级扫描器**，按方言自动为
  `FROM / JOIN / UPDATE / INTO` 后的裸标识符补引号（MySQL 反引号、MSSQL 方括号、PG/Oracle 双引号）。
  跳过字符串字面量、`--` 与 `/* */` 注释、已引用标识符、`FROM (` 子查询、函数调用、
  以及 `SUBSTRING(x FROM 1 FOR 2)` 这类装饰词；支持 `db.tbl` 逐段判断；**幂等**（已加引号再跑不变）。
  另含 `needsQuote()`、`RESERVED_WORDS`（约 200 个 MySQL 保留字，刻意排除 `DUAL`/`LATERAL`）。
- `src/datasource.js` 新增 `describeDbError()`：把 DB 错误翻成中文，保留
  `code` / `errno` / `sqlMessage` / `originalSql` / `normalizedSql` / `hint`（修复建议）。
- `src/datasource.js` 重写 `paginate()`：已有 `LIMIT`/`TOP`/`FETCH` 时不再重复追加（原来会拼出两个 LIMIT）；
  `FOR UPDATE` / `FOR SHARE` 挪到 `LIMIT` 之后（原来会语法错）；MSSQL 缺 `ORDER BY` 时补 `(SELECT NULL)`。
- `src/reports.js` 新增 `testSql()` 作为**唯一执行链路**，`test-sql` / AI 问数 / 数据预览三者共用，
  杜绝「两条链路行为不一致」；`createDataset` / `updateDataset` 接入保存前预校验；
  `assertReadOnly()` 改为在剥离字符串与注释后的骨架上判定，并返回清洗后的 SQL。
- `src/routes/api.js` 新增 `datasetErrorBody()`，把结构化错误（含原始 SQL、错误码、修复建议）
  一并返回前端。
- `src/flows.js` 的 `source_sql` 节点也纳入同一链路（流程里的 SQL 同为用户手写）。

### 2. 邮件推送「数据项目」改为独立新页面（不再用弹窗/抽屉）

- 新增路由 `/mail-push/projects/:id` → `frontend/src/pages/mail-push/Project.tsx`。
- 原抽屉的全部能力平移到新页面：项目信息、数据明细（分页 + 关键字 + 排序 + CSV 导出）、
  导入日志（按项目过滤）、改配置 / 清空 / 删除（均走 Modal 确认）、返回按钮。
- 主页面 `mail-push.tsx` 中项目管理的 Drawer 及其 state/JSX 全部移除，改为 `navigate()`；
  邮箱账户编辑从 `DrawerForm` 改 `ModalForm`，邮件详情从 `Drawer` 改 `Modal`。

### 3. 顶部栏合并为 1 栏

- `layouts/BasicLayout.tsx` 重写：Header 左=多标签页、右=头像+用户名下拉，**标签栏不再单独占一行**。
- **删除面包屑**，不再显示当前菜单名称与路径。
- **菜单收起按钮移到左侧菜单底部**：品牌区（固定）→ 菜单区（可滚动）→ 底部工具区（固定）。

### 4. 修复 AI 问数界面

- 错误态从「整页替换」改为**页面内友好提示卡**：分类标题 + 后端原文 + 行动指引
  （配置类→「前往系统设置」、数据集类→「前往数据集」，恒有「重试」）；
  `retry()` 记住失败问题可原地重发，不再只是刷新列表。
- 移动端「最近问数」由右侧 Drawer 改 Modal；补全空态 / 加载态（含 3~20s 耗时说明）/ 超时态 / 未配置模型态文案。
- 后端侧修 8 个真实缺陷：`assertReadOnly` 误杀字符串里的 `update`/`delete`；
  AI 生成的 SQL 不走补引号；执行失败无中文错误；超时/网络错误英文原文直出；
  失败时 `sqlText` 恒为 null 无法定位；`WITH` 开头 SQL 的 paginate 误判等。

### 5. 全站页面规范统一

新增 `components/Page.tsx`（标准页面容器）与 `components/StatCards.tsx`（数据卡片组），
全站结构统一为：

```
本页名称   搜索区...   [新建]      ← title / search / actions
子标签页（仅当本页有 Tab）          ← subTabs
[卡片][卡片][卡片]（1 排 3-8 个）   ← stats
本页内容与数据                     ← children
```

- **删除所有页面介绍文案**（`subTitle` 字段废弃，传了也不渲染）。
- 统计卡片统一 3-8 个、单排等分、左侧 3px 彩色竖条、移动端自动降 2 列。
- **查看/编辑交互整治**：内容少 → `Modal`；内容多 → 新页面（`hideInMenu` 路由）；
  **禁止用右侧抽屉承载业务内容**。清理了 13 个文件里的业务 Drawer，
  仅保留 5 处合理用途（移动端导航、流程/表单设计器的检查器面板、看板内部列设置与高级筛选）。
- 全部列表页补齐：分页、排序、空状态、加载态、错误态。

### 6. 修复系统设置改站点名称后左侧菜单不生效

- `stores/app.ts` 新增 `siteName` / `siteShort` / `siteLogoText` 与 `fetchSite()`
  （站点级状态，与 `user` 解耦，退出登录不清）。
- `api/settings.ts` 新增 `getPublicSettings()`，带 `cache: 'no-store'` ——
  后端该接口原有 `Cache-Control: max-age=60`，不清缓存会导致「改完刷新仍显示旧名」最长 60 秒，
  看起来就像没生效。
- `BasicLayout` 品牌区渲染 `site_name`，版本号显示 `V4.1`（不再写死 V4.0），
  空值回退 `Neo Zheng DataETL`，收起态只显示 logo 方块。

### 7. 配色重做（核心诉求：不要灰蒙蒙一片）

新增 `frontend/src/theme.ts` 作为**唯一配色来源**，页面禁止再写死色值：

| 用途 | V4.0（问题） | V4.1 |
|---|---|---|
| 页面底色 | `#FFFFFF` 纯白 | `#EEF3FB` 浅蓝灰 |
| 卡片 | `#FFFFFF` | `#FFFFFF`（与底色形成分离） |
| 常规边框 | `rgba(54,135,255,.28)` 几乎不可见 | `#CFDEF0` 明确可见 |
| 主文字 | `#003378` | `#0B1F3B` 更深 |
| 表头/卡片头 | 近白 | `#EAF1FB` 淡蓝 |
| 左侧菜单 | 白底深蓝字 | **深蓝渐变 `#0C3F96 → #0A3477` + 白字**，选中 `#2E7BF0` + 左侧 3px 白条 |
| 卡片圆角 | 10/12/14 混用 | 统一 12 |

- 图表色板、流程设计器色板、`api/dashboard.ts` 的旧色值副本全部改为从 `@/theme` 派生，
  消除「图表比页面更旧」的视觉漂移。
- 清除散落在页面里的 `#DCDDDD` / `#B5B5B6` / `#003378` / `rgba(54,135,255…)` 等 V4.0 硬编码（约 60 处）。
- 保留中康客户看板（`Board.tsx` / `board/**` / `CrmDashboard.tsx` / `api/crm-board.ts`）
  的独立 light/dark 双主题色板，不并入平台令牌（它有独立主题切换能力）。

### 8. 修掉的 2 个整合期发现的严重缺陷

1. **邮件项目详情页无限请求循环**：`Project.tsx` 首版把三个 loader 放进同一 effect 依赖，
   而 `loadRows` 依赖 `detail?.columns`，`loadDetail` 每次都产生新数组引用 →
   loader 身份变化 → effect 重跑 → 再调 `loadDetail`……实测 **6 秒发出 145 次请求**。
   改为拆两个 effect，`loadRows` 依赖收敛到 `[can, id, message]`（稳定），
   分页/排序/关键字变化由独立 effect 驱动。修复后同样 6 秒仅 3 个业务请求。
2. **邮件推送概览表格移动端整页横向溢出**（390px 视口 docScrollWidth 673）：
   `recentImports` 表格固定列宽合计约 650px 但未设 `scroll`，把整页撑宽。
   补 `scroll={{ x: 'max-content' }}` 后回到 390；同时给 `Page` 的 `subTabs` 容器加
   `maxWidth:100% + overflow:hidden`，避免子标签页把页面撑宽。

### 验证

| 项目 | 结果 |
|---|---|
| TypeScript 类型检查 | `npx tsc --noEmit` → **0 错误** |
| 生产构建 | `npm run build` → 通过，87 产物 / 3.95 MB |
| 静态合规审计 | 旧色值 0、面包屑 0、业务 Drawer 越界 0、V4.0 硬编码 0 |
| 浏览器逐页验收（17 页 × 10 项 + 移动端 17 页 + 关键功能） | **220 / 220 通过，0 失败** |
| 数据集 SQL 单元测试（`scripts/v41-dataset-sql.js`） | **59 断言 / 59 通过** |
| 数据集真实库回归（`scripts/v41-dataset-sql-db.js`） | **15 / 15 通过** |
| AI 后端回归（`scripts/v41-ai-backend.js`） | **10 / 10 通过** |
| 数据集新建 + 预览端到端（浏览器交互） | **11 / 11 通过**（连字符表名自动加引号、预览为 Modal 非抽屉） |
| 站点名称实时生效（改→侧栏变→还原） | **5 / 5 通过** |
| 接口验收（登录/20 页可达/关键 API） | **48 / 48 通过** |
| 移动端 390×844 | 17/17 页零横向溢出、零运行时错误 |
| 回归对照（v2/v3/v31/v32/v33/regression 五套旧套件） | 通过/失败数与 **V4.0 生产基线完全一致**，确认无新增回归 |

> 说明：五套历史测试脚本仍在断言 V3 时代的 EJS 服务端渲染（如「首页含『数据概览』HTML」），
> 对 SPA 天然不适用；已用生产环境（V4.0）跑同一批脚本取得基线，结果逐项相同。

---

## [4.0.0] - 2026-10-30

### 重大变更 — 前端全面迁移到 Ant Design 技术栈

从 EJS 服务端渲染迁移为 **React 18 + TypeScript + Vite 6** 单页应用，UI 全面采用 [Ant Design 6](https://github.com/ant-design/ant-design)。

#### 技术栈

| 依赖 | 版本 | 用途 |
|---|---|---|
| React | 18.3.1 | UI 框架 |
| TypeScript | 5.9.3 | 类型安全（全项目 `tsc --noEmit` 零错误） |
| Vite | 6.4.5 | 构建工具 |
| Ant Design | 6.6.8 | 组件库 |
| @ant-design/pro-components | 3.1.15-8 | ProTable 等高级组件 |
| @ant-design/x | 2.10.0 | AI 对话界面 |
| antd-mobile | 5.43.0 | 移动端组件 |
| ECharts | 6.1.0 | 图表 |
| Zustand | 5.0.2 | 状态管理 |
| React Router | 6.28.0 | 路由 |

> `@ant-design/pro-components` 必须使用 `3.1.15-8`（beta 分支），正式版 2.x 只支持 antd 5。

#### 新增页面（38 个）

**概览**
- 数据概览：6 色 KPI 卡 + 7 天趋势图 + 最近日志 + 项目快照
- 客户签约看板：多图表（饼图/柱状/双轴趋势/横向柱）+ 18 列明细表

**数据接入**
- 数据项目：分组树 + ProTable + 项目/分组 CRUD + 令牌管理
- 项目详情：4 个 Tab（概览/字段配置/推送日志/数据明细）
- 字段配置：字段表格 + 批量解析方式 + 解析字段导入 + 结构同步
- 表单中心：ProTable + 发布/停用 + 公开链接管理
- 表单设计器：三栏布局（24 种字段 / 12 栅格画布 / 属性面板）+ 预览
- 表单数据：动态列 + 搜索 + 详情抽屉 + CSV 导出
- 数据集成：采集/推送双向任务 + 执行 + 运行日志
- 邮箱推送：5 个页签（概览/账户/邮件浏览/导入日志/运行设置）

**数据处理**
- 处理流程：ProTable + 执行方式（手动/触发/定时 cron）
- 流程设计器：SVG 自绘节点 + 贝塞尔连线 + 拖动定位 + 动态配置 + 试运行
- 流程日志：运行记录 + 可展开节点明细

**数据管理**
- 数据源：81 种类型动态表单 + 连接测试 + 表结构浏览
- 数据集：SQL/数据表/项目数据三来源 + SQL 试跑 + 数据预览

**分析与可视化**
- 报表中心：卡片/表格双视图 + 三重筛选
- 报表设计器：11 种图表类型 + 字段配置 + 实时预览
- 报表查看：大屏风格 + KPI + 图表 + 明细
- 分享管理：创建/复制/启停/删除 + 密码保护
- 公开分享页：独立 Shell，支持密码验证
- AI 问数：@ant-design/x 的 Bubble.List + Sender + Prompt 模板

**数据治理**
- 治理总览：6 张 KPI + 质量概览 + 资产清单 + 表结构对照
- 审计日志：ProTable + 三筛选 + 按策略清理

**系统管理**
- 用户管理：5 个 Tab（用户列表/角色权限/组织架构/角色权限说明/权限点说明）
- 角色权限：角色 CRUD + 权限点分组勾选
- 系统设置：按后端 GROUPS 动态渲染 10 个分组、71 项、10 种字段类型
- 个人中心：头像（上传/调色板）、资料、改密码、登录设备管理

**其他**
- 项目介绍：Hero 渐变 + 4 个痛点 + 8 项能力 + 11 个行业案例 + 架构图 + CTA
- 使用说明：10 个章节 + Anchor 目录 + 关键词搜索
- 登录/注册/忘记密码/重置密码：统一品牌视觉

#### 移动端适配

按业务性质区分，9 个页面适配移动端（<768px 单列、触控目标 ≥44px）：

| 需移动端 | 不需移动端（专业操作） |
|---|---|
| 数据概览、客户看板 | 数据项目、项目详情、字段配置 |
| 表单中心、表单数据、公开表单 | 数据集成、邮箱推送、处理流程 |
| 报表中心、报表查看、分享、AI 问数 | 数据源、数据集 |
| 项目介绍、使用说明、个人中心 | 用户/角色/设置/审计/治理 |

全部 9 个移动端页面实测 `scrollWidth === clientWidth === 375`，零横向溢出。

#### 架构改进

- **SPA 托管**：新增 `src/routes/spa.js`
  - 排除后端前缀（`/api` `/jdy` `/public` `/healthz`）
  - 带扩展名资源 404 返回纯文本，避免 MIME 错误
  - `index.html` 不缓存，发版立即生效
- **渐进式迁移**：`routes/pages.js` 只保留服务端表单 POST 与 `/logout` `/verify-email`，
  其余 GET 交由 SPA；可用 `JDY_LEGACY_PAGES=1` 应急回退
- **权限 Hook**：新增 `usePermission()`，修复「异步加载用户后受权限控制的按钮不显示」

#### 新增公开接口

| 接口 | 说明 |
|---|---|
| `GET /api/settings/public` | 站点公开信息（白名单字段，无需登录） |
| `GET /api/public/shares/:token` | 公开分享数据（复用 accessShare 完整校验链） |

#### 安全修复

- **分享密码校验**：`/api/public/shares/:token` 复用 `reports.accessShare()`，
  避免自行实现查询绕过密码验证，导致设了密码的分享被公开读取
- **报表执行失败降级**：数据集/项目被删除或数据源不可用时返回 200 + `execError`，而非 500 白页

#### 配色体系

唯一允许的 13 色：

```
主色:   #3687FF  #45B4FF  #003378  #2D6FE4
强调色: #EC673C(橙) #E86161(红) #FFC000(黄) #A2D73C(绿)
辅助:   #73DBFF(浅蓝) #B5B5B6(灰) #DCDDDD(浅灰) #FFFFFF #000000
```

- 页面背景纯白，无色块背景
- 图表色板按 CIEDE2000 感知色差优化：相邻最小 ΔE = 55.3（优化前 11.7，提升 371%）

#### 验证结果

| 项目 | 结果 |
|---|---|
| TypeScript 类型检查 | 0 错误 |
| 生产构建 | 通过，83 个产物 / 3.78 MB |
| 全站 24 个路由 | 24/24 返回 SPA，无 EJS 泄漏 |
| 移动端 9 个页面 | 零横向溢出 |
| 生产环境部署 | 已验证 |

---

## [3.6.0] - 2026-10-29

### 新增 — 邮箱推送板块全面重构

#### 标签页架构

邮箱推送页面由「单页多卡片」重构为 **5 个标签页**，通过 URL hash 保持状态，刷新后停留原标签：

| 标签 | 内容 |
|---|---|
| **概览** | 状态卡（启用状态 / 轮询周期 / 账户数）+ 统计卡（账户数 / 项目数 / 总行数 / 今日导入）+ 最近导入列表 + 快捷拉取 |
| **数据项目** | 项目卡片网格（项目名 / 数据表 / 累计行数 / 最近导入 / 最近文件） |
| **导入日志** | 日志表格 + 结果筛选（成功 / 跳过 / 失败）+ 项目筛选 + 关键词搜索 |
| **邮箱账户** | 账户卡片（服务器 / 文件夹 / 自动导入 / 最近检查状态）+ 查看邮件 / 编辑 / 启停 / 删除 |
| **设置** | 自动推送开关、轮询周期、首次回溯天数、单次最多邮件数 |

#### 邮箱编辑改为独立页面

- 新增 `GET /mail-push/accounts/new` — 添加邮箱
- 新增 `GET /mail-push/accounts/:id/edit` — 编辑邮箱
- 移除原弹窗形式，12 个表单字段 + 9 种服务商预设联动 + 连接测试
- 编辑时密码留空表示不修改，避免误清空

#### 数据项目详情独立页面

- 新增 `GET /mail-push/projects/:id` — 点击项目卡片整页跳转（不再是页内展开）
- 4 个标签页：项目首页 / 数据明细 / 字段结构 / 导入日志
- 功能对齐主「数据项目」板块：
  - 关键词搜索（全列模糊匹配）
  - 列头排序（物理列名白名单校验，防 SQL 注入）
  - 分页（20 / 50 / 100 可切换）
  - 导出 CSV（UTF-8 BOM + 中文表头 + 防公式注入）
  - 清空数据（保留表结构）
  - 删除项目（可选连表删除）
  - 编辑项目名称（唯一性校验）

### 新增 — 后端接口（9 个）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/mail-push/overview` | 统计概览（账户 / 项目 / 日志 / 最近导入 / 7 日趋势） |
| GET | `/api/mail-push/settings` | 读取邮箱推送设置 |
| PUT | `/api/mail-push/settings` | 保存设置（含范围校验 + 自动重启轮询） |
| GET | `/api/mail-push/projects/:id/columns` | 项目列结构 |
| GET | `/api/mail-push/projects/:id/export` | 导出 CSV |
| PUT | `/api/mail-push/projects/:id` | 更新项目（名称 / 状态） |
| DELETE | `/api/mail-push/projects/:id` | 删除项目（`dropTable=1` 连表删除） |
| POST | `/api/mail-push/projects/:id/clear` | 清空项目数据 |
| GET | `/api/mail-push/logs/:id` | 单条日志详情 |

### 增强 — 已有接口

- `GET /api/mail-push/projects/:id/rows` — 新增 `keyword` 搜索、`sort` + `order` 排序，返回 `columns`
- `GET /api/mail-push/logs` — 新增 `result` / `projectId` / `keyword` 三条件筛选

### 新增 — 测试

- `scripts/mail-push-ui-test.js`（111 项）— 页面可达性、内联脚本语法、新接口、非法参数容错、安全权限、数据一致性
- 全量自动化测试：**402 项通过，0 失败**

### 安全加固

- 排序字段白名单校验（`sort=id;DROP TABLE x--` 被忽略且表仍可读）
- CSV 导出防公式注入（`=` `+` `-` `@` 开头自动加前置单引号）
- 项目删除 / 清空 / 设置修改均写入审计日志
- 所有页面渲染值经 `esc()` 转义防 XSS

---

## [3.5.0] - 2026-10-28

### 新增 — 邮箱推送（附件表格自动入库）

- **多邮箱账户管理**：支持添加 / 编辑 / 删除 / 启停多个邮箱账户，每账户独立 IMAP 配置、密码、拉取进度与错误状态
- **IMAP 收信**：只读拉取（BODY.PEEK，不改变邮件已读状态），按「UID + 附件名」幂等去重
- **文件名智能解析**：
  - 附件名 `药店智能体触达转化_整体_2026-10-28_11-14-36-157_987.xlsx`
  - 项目名 → `药店智能体触达转化`（去掉第 2 段与末尾时间戳）
  - wjmc → `整体_2026-10-28_11-14-36-157_987`
- **自动建表**：第 1 列自增 ID、第 2 列 wjmc、第 3 列起表格数据、最后 1 列导入日期
- **项目合并**：同名项目自动追加；不同业务名自动新建项目
- **邮件浏览**：在线查看收件列表与正文，识别 Excel 附件
- **定时轮询**：默认每 5 分钟拉取，可配置周期与单次上限
- **服务商预设**：阿里云企业邮箱（含香港）/ QQ / 腾讯企业 / 163 / 126 / Gmail / Outlook / 自定义

### 修复

- **伪 Excel 文件创建垃圾项目**：`xlsx` 库过于宽松，纯文本会被解析为单单元格表格并建表。新增 ZIP / OLE2 文件签名校验 + 内容合理性校验（至少 2 个表头或 1 行数据）
- **认证失败误报成功**：`ImapFlow` 认证失败时不抛异常而是发 `error` 事件，导致 `runOnce()` 返回 `ok=true` 显示「导入 0 个附件」的假成功。新增 `client.authenticated && client.usable` 显式校验，并把对象展开顺序修正为 `{ ...summary, ok: false }`
- **错误提示不明确**：底层 `Command failed` 翻译为可操作中文提示（区分密码错误 / 网络不通 / 文件夹不存在）
- **本地 PID 路径报错**：Windows 环境写入 Linux 面板路径失败时只提示一次，可用 `JDY_PID_FILE` 覆盖

### 测试

- `scripts/mail-push-unit.js`（65 项）— 文件名解析、建表结构、入库、幂等、合并、分流、表结构演进、异常输入、白名单、错误传递
- `scripts/mail-accounts-test.js`（46 项）— 账户 CRUD、格式校验、密码掩码、启停、进度重置、旧配置迁移、邮件读取
- `scripts/mail-push-test.js`（55 项）— 页面渲染、HTTP 接口、权限
- `scripts/regression-test.js`（94 项）— 全站回归

---

## [3.4.0] - 2026-10-23

### 新增 — 简道云流程推送支持（schema 2.0）

- 支持简道云「流程推送」报文（`{schema, header, event}` 结构）
- 修复「简道云显示推送成功、这边没有数据」问题：旧代码只认 `body.op`，流程推送被当作「未知事件」只写日志不落库
- 待办列表（created / completed / canceled）展开为子表
- 派生可读摘要列（当前待办人 / 各类待办数量）

### 新增 — 进程守护

- `server.js` 在 `listen` 成功回调中写入真实 PID，修复面板状态错乱
- `watchdog.sh` 配合宝塔计划任务每分钟健康检查
- 端口占用 / 权限不足时输出可操作提示后退出，避免堆栈刷屏

---

## [3.3.0] - 2026-10-18

### 新增

- 数据源类型目录（15 大类 81 种）
- 项目介绍页
- 表单宽度设计预览
- agg 大数据拆分优化

---

## [3.2.0] - 2026-10-17

### 新增

- 项目详情 7 标签页
- CRM 客户签约看板
- 表单三种类型（填写 / 流程 / 考试）
- 表单 12 栅格自适应
- 选项控件增强

---

## [3.1.0] - 2026-10-16

### 新增

- 表单引擎（24 种控件拖拽设计）
- 数据处理流程（24 种节点拖拽编排）
- 组织架构（多级部门树）
- 头像上传
- 13 种数据库支持
- 9 个 AI 供应商预设
- 双模式数据采集

---

## [3.0.0] - 2026-10-15

### 新增

- 数据治理：原始表 `jdywh_data_N` + 解析表 `jdywh_parsed_N` 双表分离
- 12 种字段解析方式
- 数组字段展开为子表
- 中文列注释（简道云字段名写入列 `COMMENT`）
- 历史数据回填
- 报表 BI：数据集、报表设计器、12 种图表、外链分享
- AI 问数：自然语言 → SQL → 解读
- 多数据源（MySQL / MariaDB / SQL Server）
- 角色权限（25 个权限点 / 7 组，可自定义）

---

## [2.0.0] - 2026-10-15

### 新增

- 原始数据 / 解析数据双表
- 字段解析加工
- 数据导出 CSV
- 报表分享（密码 + 有效期 + 浏览统计）

---

## [1.0.0] - 2026-10-15

### 新增

- 简道云数据推送接收（签名校验 `sha1("{nonce}:{payload}:{secret}:{timestamp}")`）
- 自动建表与字段同步
- 推送日志与数据明细
- 用户登录与会话管理
- 系统设置