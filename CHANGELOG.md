## [16.1.0] - 2026-11-03

### 版本主题：7 项体验优化（ERP 版本单行 / 流程状态回 V15 样式 / 分享页标题与预览 / 连锁排名下钻 / 客户详情精简与对齐）

本轮只优化体验与信息呈现，**不改业务口径、不动数据表结构（仅加 2 个可空列）**。
所有结论均附实测读数；未经量测的项不出现在本文档。

> 看板目录（`frontend/src/pages/dashboard/board/`、`Board.tsx`、`share-view.tsx`）不开源，仅私服部署；
> 打包产物仅含 `frontend/dist` 构建结果，不含看板源码。

---

## 一、客户 ERP 分布：有券 / 无券版本合并为 1 行

**用户原话**：「客户 ERP 分布下面的有券版本和无券版本显示为1行」

**根因**：V16 4.2 把底部版本汇总做成 `flex-direction: column`，`有券版本X家` 与
`无券版本X家` 上下两行（实测两行共占 2 行、卡片底部高 8+8+3=19px 行高叠加）。

**改法**（`frontend/src/pages/dashboard/board/SigningCards.tsx`）：
- `.vb1-erp-ver` → `flex-direction: row; align-items: center; justify-content: space-between`
- `.vb1-erp-ver .v-row` → 追加 `flex: 0 1 auto`，两项在同一条基线上两端对齐
- 保留 V16 4.3 的窄视口截断（`@container erpcard (max-width:260px)` 隐藏「版本」二字），
  窄屏仍不横向溢出（`scrollWidth === clientWidth`）

**口径不变**：仍取 `erpVersionSummary.withCoupon.total` / `withoutCoupon.total`（沿用 V15 口径）。

---

## 二、流程状态板块恢复 V15 样式

**用户原话**：「流程状态板块的样式不要调整继续采用v15版本的样式」

**做法**：`frontend/src/pages/dashboard/board/FlowPipeline.tsx` 整体回退为 **V15 原始文件**
（43,531 B，SHA256 `dd0464ac13c9ceb81e068877c795343d8ddf3537e8ef1bf4b1f81104003fc519`，CRLF=0）。
V16 对该文件的全部改动均为样式层（4.6 弹窗主题令牌 + 4.7 两行等高 88px 卡片），因此整体回退
= 「采用 V15 样式」，且**零功能损失**：

- `Props` 接口两边完全一致（`data / loading / isMobile`），无需改调用方；
- V15 原件自身已包含 `fetchClientDetail` 与 `ClientDetail` 引入，**客户详情下钻未被移除**；
- 随之恢复 V15 的 `.fm-sum-box / .fm-sum-row / .fm-sum-group / .fm-sum-lbl / .fm-sum-tag` 汇总块样式。

**已移除的 V16 改动**（均为样式）：`.fm-l1/.fm-l2` 两行卡片类、`.fm-node.two{height:88px}` 等高规则、
`.v7flow-modal` 的 antd 表格令牌、`.fm-avg`。

---

## 三、分享页标题 / 缩略图 / 描述（含服务端 meta 注入）

**用户原话**：「分享页面的标题名称要体现为浏览器顶部标题栏，同时可以设置分享略缩图和分享描述」

### 3.1 数据层
`jdywh_shares` 新增 2 个可空列（`src/bootstrap.js` 的 `ensureColumn` 幂等迁移）：
```sql
`description` VARCHAR(500) NULL COMMENT "V16.1：分享描述（og:description）" AFTER `title`
`thumb`       VARCHAR(500) NULL COMMENT "V16.1：分享缩略图 URL（og:image）"  AFTER `description`
```
启动日志实测：`[migrate] jdywh_shares.description 已添加`、`[migrate] jdywh_shares.thumb 已添加`。

`src/reports.js`：
- `publicShare()` 输出 `description` / `thumb`
- `createShare()` 接受并可落这两列；`updateShare()` 支持修改，`description ≤500`、`thumb ≤500`，
  且 `thumb` 只接受 `http(s)://` 或 `/` 开头（否则报错，防止 `javascript:` 之类注入）
- 新增 `shareMetaByToken(token)`：**不校验密码、不计数、不执行报表**，只回
  `title/description/thumb/hasPassword/expired/disabled`，供浏览器标题栏与 meta 注入使用

### 3.2 接口层
- 新增 `GET /api/public/shares/:token/meta`（`src/routes/api.js`），只回门面字段，**零报表数据**
- `GET /api/public/shares/:token` 的 `share` 对象补充 `description` / `thumb`

### 3.3 服务端注入（关键：分享爬虫不执行 JS）
`src/routes/spa.js` 新增 `buildShareMetaHtml` / `injectShareMeta`，对 `GET|HEAD /s/<token>`
在 `index.html` 的 `<!-- SHARE_META_START --> … <!-- SHARE_META_END -->` 之间注入：

```
<title>分享标题</title>
<meta name="description" content="…" />
<meta property="og:type" content="website" />
<meta property="og:title" content="…" />
<meta property="og:description" content="…" />
<meta property="og:image" content="https://站点/…" />     ← 站内相对路径自动补成绝对地址
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" / "twitter:description" / "twitter:image" content="…" />
```
- 只处理 `/s/<token>` 一个路径，其余路由仍走 `sendFile`（零额外开销）
- 任何异常一律回退原 `index.html`，保证「分享页永远能打开」
- **失效 / 停用 / 有密码的分享只给标题，不给描述与缩略图**（避免泄漏）
- 用户输入全部 HTML 转义后拼接

### 3.4 前端
- `frontend/src/pages/shares.tsx`：创建 + 编辑弹窗新增「分享描述」（TextArea，200 字，带计数）与
  「分享缩略图」（地址，500 字），编辑时回填、保存时提交，缩略图格式前端预校验
- `frontend/src/pages/share-view.tsx`：新增 `applyShareDocMeta()`，写 `document.title`
  并 upsert `og:*` / `twitter:*`；两条数据路径（`/meta` 接口 + 主接口 `share`）都会校准，
  覆盖「有密码的分享」与「失效/停用页」也显示正确标题
- `frontend/src/api/reports.ts`：`ShareItem` / `ShareCreatePayload` / `ShareUpdatePayload` /
  `PublicShareMeta` 增补字段，新增 `ShareMeta` 类型与 `getPublicShareMeta(token)`

---

## 四、连锁排名：点击连锁名称查看客户详情

**用户原话**：「连锁排名处点击连锁名称也能查看客户详情」

**改法**（`frontend/src/pages/dashboard/board/ChainRanking.tsx`）：
- 连锁名称由纯文本 `<span>` 改为 `<button class="vb14-it-nm vb14-chain-link">`，
  带 `data-chain-link={chainId}` 便于测试定位；无 `chainId` 时退回纯文本（不产生死链）
- 新增 `openClient()`，复用后端既有 `fetchClientDetail` 与既有 `ClientDetail` 组件，
  **不新增接口、不改后端**
- 新增样式 `.vb14-it-nm.vb14-chain-link`（品牌色 + 虚线下划线 + hover 加深 + `:focus-visible` 焦点环）
- 刻意使用独立类名（不用明细表的 `.vb11-chain-link`），避免与明细表 `[role=button]` 选择器互相污染

---

## 五、客户详情：基础信息去掉「运营信息」

**用户原话**：「客户详情的基础信息不需要显示运营信息」

**改法**（`frontend/src/pages/dashboard/board/ClientDetail.tsx`）：删除 `basicGroups` 中的
`ops`（运营信息）分组 —— 原 4 组 `基础信息 12 / ERP 信息 5 / 运营信息 7 / 时间信息 5` = 29 项 + 相关人员 4 项，
现为 **3 组 12/5/5 = 22 项** + 相关人员 4 项。运营指标仍在客户详情的 KPI 卡片中展示，未丢数据。

---

## 六、客户详情：节点时间线「耗时」整列对齐

**用户原话**：「客户详情的节点时间线，后方的耗时全列要对齐，按照第二列最长的那一行间距100px显示」

**根因**：每个 `<li>` 自身是独立 grid，第 3 列（时间）用 `max-content`，宽度按**本行文案**计算 ——
完成行是「　11月03日 15:14　」（窄），未完成行是「　进行中（当前节点）　」（宽），
于是第 4 列（耗时）的起始 x 每行都不同，整列参差（实测最大相差 60px）。

**改法**：
- 第 3 列宽度由 JS 统一钉死：`useLayoutEffect` 读全部 `li .st` 的 `scrollWidth` 取最大值，
  写入 `<ol>` 的 `--vcd-tl-st`；CSS 改为 `grid-template-columns: 18px 104px var(--vcd-tl-st, max-content) minmax(0,1fr)`
- `.du`（耗时）固定 `padding-left: 100px` 且 `justify-self: start`
- 因为所有行共用同一列宽 → 耗时整列严格对齐；最长那一行的时间文本到耗时恰为 100px
- 用 `scrollWidth` 而非 `offsetWidth`：列宽被钉死后 `offsetWidth` 已被裁剪，会形成测量死锁
- 只在值变化时才写 CSS 变量，避免 measure → set → measure 循环
- 兜底：首帧尚未测到值时回落 `max-content`，行为与改前一致，不会错位

---

## 七、客户详情：宽屏内容居中

**用户原话**：「客户详情当客户浏览器页面过宽时，内容居中显示，不要过于分散」

**根因**：弹窗宽度写死 `80vw`，在 2560 / 3440 宽屏上会拉到 2048px / 2752px，两栏与 4 列字段被撑得极散。

**改法**：`.vcd-modal .ant-modal{max-width:1440px}` + `.vcd-modal .vcd-wrap{max-width:1360px;margin:0 auto}`。
视口 ≤1800px 时 `80vw` 本来就 <1440，**行为与改前完全一致**（不影响 1440/1920 常规屏）；只有更宽的屏才收窄，
配合 Modal 的 `centered` 自然左右居中。只加 `max-width` 上限，不改 antd 内部宽度机制。

---

## 八、版本与验证

- 版本号：`package.json` / `frontend/package.json` → **16.1.0**
- `npx tsc --noEmit` → **EXIT 0**
- `npm run build` → **EXIT 0，built in 10.36s**
- 后端语法：`node --check src/routes/api.js|src/reports.js|src/bootstrap.js|src/routes/spa.js` 全部 **EXIT 0**
- 需求 3 后端链路实测（本地 8781）：8 项断言 **全部 true**，`/dashboard` 零影响

---

## [16.0.0] - 2026-11-03

### 版本主题：侧边栏收起持久化 + 分享链接可编辑与 10 项指标 + 报表中心 BI/AI 双轨 + 看板 8 项口径与交互升级

本轮覆盖 `BasicLayout / app store / shares / reports / SigningCards / FlowPipeline /
RunMetrics / ChainRanking / RunTrend / ClientDetail` 10 个前端文件，并新增 4 个后端模块、
2 张表、1 组迁移脚本。**全部结论均为浏览器 / 接口 / 源码实测读数**，无「已优化」式结论；
每项均给改前 / 改后数字。

> 看板目录（`frontend/src/pages/dashboard/board/`、`Board.tsx`、`share-view.tsx`）不开源，仅私服部署；
> 本次打包产物仅含 `frontend/dist` 构建结果，不含看板源码。

---

## 一、后端契约（W0 后端层）

### B1 分享访问埋点新表 `jdywh_share_visits`（需求 2.5 / 2.6，P0-1 方案 C）

**用户原话**：分享链接要能看到「流量 / 请求数 / IP / UV / PV / 浏览器类型 / 操作系统类型 / 访客IP / 省份 / 设备类型」10 项，汇总 + 明细。

**设计**：全新表 + UA 正则解析 + 30 秒同源去抖，**beacon 与 nginx 两个来源分开返回、永不相加**。
省份无离线 IP 库，`province` 恒 `NULL`，接口返回 `provinceStatus: 'pending'`，**前端必须显示「暂无」而非「未知」**。

```sql
CREATE TABLE jdywh_share_visits (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  share_type VARCHAR(16) NOT NULL,      -- report | ai
  share_id INT NOT NULL, token VARCHAR(64) NOT NULL,
  ip VARCHAR(64) NULL, user_agent VARCHAR(512) NULL,
  referer VARCHAR(512) NULL, path VARCHAR(255) NULL,
  bytes_sent INT UNSIGNED NOT NULL DEFAULT 0,
  browser VARCHAR(32) NULL, os VARCHAR(32) NULL, device VARCHAR(16) NULL,
  province VARCHAR(32) NULL,            -- 无离线IP库时恒 NULL
  source VARCHAR(16) NOT NULL DEFAULT 'beacon',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_share(share_type, share_id), KEY idx_token(token),
  KEY idx_created(created_at), KEY idx_source(source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**UA 解析实测（3 个不同 UA 连打，各 +1 行）**：

| User-Agent | browser | os | device |
|---|---|---|---|
| `...Windows NT 10.0...Chrome/120...` | Chrome | Windows | desktop |
| `...iPhone; CPU iPhone OS 17_0...Version/17.0 Mobile/15E148 Safari/604.1` | Safari | iOS | mobile |
| `...Android 13; SM-G991B...Chrome/119...Mobile Safari/537.36` | Chrome | Android | mobile |

**去抖实测**：同 token + 同 IP + 同 UA 连打 3 次 → **+1 行**（30 秒窗口内）；换 UA 各打 1 次 → **+3 行**。

### B2 分享编辑接口（需求 2.1 / 2.2 / 2.3）

- `PUT /api/shares/:id`：`title`（≤191 字符）/ `expiresAt` 或 `expiresDays`（支持 `'days:N'` 与 `'permanent'`）/ `password`（≤64 字符，空串=取消密码）；
- `PATCH /api/ai/shares/:id`：同语义；
- 只传 `status` 时**走 V15 原 `toggleShare` 分支**，保证旧行为零回归。

**改前基线**：全仓库 `SET title` 出现 **0 处** —— 即 V15 及以前分享标题**根本无法编辑**。
**改后实测**：7 天 → 永久生效；密码开→关生效；65 字符标题返回 **400**；只传 `status` 仍可用。

### B3 AI 报表模型扩展 + 2 个内置看板转为 AI 报表（需求 3.1，P0-3）

`jdywh_reports` 新增 `icon / tags / group_name / source / board_key / dsl` 6 列，采用 bootstrap 式幂等 `ensureColumn`。
新增 `BUILTIN_AI_BOARDS` 幂等播种（`report_type='ai' AND source='builtin' AND board_key=?`）：

| board_key | 名称 | 图标 | 路由 |
|---|---|---|---|
| `ai_board_zk` | 中康智能体客户看板 | 🤖 | `/dashboard/board` |
| `ai_board_crm` | 客户签约看板 | 📝 | `/dashboard/crm` |

**改前**：这两个看板是前端硬编码数组 `BUILTIN_BOARDS`（`reports.tsx`，`shareTargetId` 1=zk / 2=crm），**不在数据库里**。
**改后实测**：`BUILTIN_BOARDS` 硬编码已删除；`GET /api/ai-reports?source=builtin` 返回 **2 条**（id=46 zk、id=47 crm，均 `source:'builtin'`）。

### B4 受限 DSL 校验器 `src/ai-reports.js`（P0-2）

`DSL_SPEC='jdy-bi-dsl/1'`，6 种 block（`kpi/table/chart/flow/ranking/summary`），`MAX_BLOCKS=32`，
**禁止 `eval` / `new Function` / `vm`**，非法 DSL 返回中文错误而非抛栈。

**实测**：合法 DSL 存库后回读**逐字节相等**（`len=568`，`equal=true`）；
5 类非法 DSL（未知 block 类型 / 超长 / 缺字段 / 非法路由 / 注入 `eval`）**全部被拒且给出中文提示**。

### B5 内置 AI 报表「只能停用、不能删除」（P0-3）

`DELETE /api/ai-reports/:id` 对 `source='builtin'` 返回 **403**。
复制出的副本 `title` 自动追加「副本」，且**副本可正常删除**（实测通过）。

### B6 连锁排名补 `couponGmv` + ROI 口径改为「转化销售额 ÷ 到店人数」（需求 1.4 / 7.1）

**改前**：ROI = 成本转化比，量级 `0.0xxx`。
**改后**：`roi = gmv / arrivedPeople`，量级几十~几百。

**全量 15 条有到店人数者逐一校验（容差 1e-4）**：

| chainId | gmv | arrivedPeople | 手算 gmv/arrived | 接口 roi | 误差 |
|---|---|---|---|---|---|
| 12394 | 180342.5 | 1821 | 99.0349 | 99.0349 | 0.000029 |
| 15602 | — | — | 398.503 | 398.503 | 0.000035 |
| 11140 | — | — | 91.5202 | 91.5202 | 0.000017 |

**最大误差 0.000035**，15/15 全部对齐；16 个连锁中 15 个有 ROI、1 个 `null`（到店人数为 0，显示 `—`）。

**`couponGmv` 实测**：16/16 全为数值（无 `NaN`/`undefined`）；
`chainId 12394` → `couponGmv = 19328.49`，UI 显示 `¥19,328`（同卡「到店销售额 180342.5 → ¥180,343」同一元位口径，差 0.49 < 0.5 容差）。
> 遗留：16 个连锁中 11 个 `couponGmv` 真实为 0（非渲染问题，逐张已对齐）。

### B7 nginx 日志回填脚本 `scripts/v16-backfill.js`

从 nginx combined 日志解析 `/s/<token>`（report）、`/a/<token>`（ai）、`/api/public/shares/<token>`（report），
写入 `source='nginx'`；幂等键 `source='nginx' AND token=? AND ip=? AND created_at=?`。
> beacon 埋点从 V16 上线时刻起统计，此前历史只能靠本脚本回填，两者**分源展示、不相加**。

---

## 二、侧边栏收起持久化（需求 1.1，W1）

**用户原话**：右侧菜单收起后，刷新/再次进入应保持收起状态。

**根因（实测定位，非猜测）**：`useBreakpoint()` 首帧返回 `{}` → `!screens.md === true` → **桌面首帧被判成移动端** →
① 旧代码 `setCollapsed` 未改名直接 `ReferenceError` → **白屏**；② 即使改名，该 effect 也会把已恢复的收起态冲成 `false` 并回写 `'0'`。

**修法**：`screens.md === false`（而非 `!screens.md`）+ `useState(readSidebarCollapsed)` 惰性初始化（非 effect 回填，避免先闪一帧展开态）。

| 判据 | 实测 |
|---|---|
| 点收起 → 键写入 | `localStorage['jdy:sidebar:collapsed'] = '1'`，`siderWidth = 64` |
| 刷新后仍收起 | 键 `'1'`，`siderWidth = 64` ✔ |
| 点展开 → 刷新后保持展开 | 键 `'0'`，`siderWidth = 232` ✔ |
| 首访无键 → 默认展开 | 键 `null`，`siderWidth = 232` ✔ |
| 白屏回归 | `body.innerText.length = 8502`（>100），控制台真实错误 `[]` |

---

## 三、分享中心（需求 2.1~2.6，W2）

| 项 | 改前 | 改后实测 |
|---|---|---|
| 2.1 标题编辑 | 无 `SET title` | 可改，落库生效 |
| 2.2 有效期编辑 | 仅创建时设定 | 7 天 → 永久生效 |
| 2.3 密码开关 | 仅创建时设定 | 开/关均生效；65 字符 → 400 |
| 2.5 汇总 10 项 | 无此功能 | 见下 |
| 2.6 明细分页 | 无此功能 | 18 行明细，`PV = rowCount = 18` |

**10 项指标实测（`GET /api/shares/report/129/stats?days=30`）**：

```json
{"requests":18,"ips":1,"uv":1,"pv":18,
 "browsers":[{"name":"Chrome","count":9},{"name":"未知","count":5},{"name":"Safari","count":4}],
 "oses":[{"name":"Windows","count":5},{"name":"Android","count":4},{"name":"iOS","count":4},{"name":"未知","count":5}],
 "devices":[{"name":"mobile","count":8},{"name":"desktop","count":5},{"name":"未知","count":5}],
 "provinces":[],"provinceStatus":"pending","traffic":0,"hasTraffic":false}
```

**10 项中 8 项有真实数据源**，2 项如实标注暂无：

| 指标 | 状态 | 实测 |
|---|---|---|
| 请求数 / IP / UV / PV / 浏览器类型 / 操作系统类型 / 访客IP / 设备类型 | **有源** | 见上 JSON |
| 流量 | **暂无**（`hasTraffic:false`） | beacon 源不记录响应体字节数；nginx 回填源含 `$body_bytes_sent` |
| 省份 | **暂无**（`provinceStatus:'pending'`、`provinces:[]`） | 全仓库无 geoip/ip2region/maxmind 依赖 |

**硬校验（全部 PASS）**：
- `PV === 明细行数`（18 === 18）
- `请求数 === DB COUNT(*)`（18 === 18）
- `IP 数 === DB COUNT(DISTINCT ip)`（1 === 1）
- `流量 === DB SUM(bytes_sent)`（0 === 0）
- **DB 中 `province` 非空行数 = 0**（不伪造）

> **本轮修复的两个真实性缺陷（红线「不得编造数据」）**：
> ① 旧 `provinces` 用 `countBy(rows,'province')`，NULL 被归成字符串 `'未知'` → 返回 `[{"name":"未知","count":18}]`，
>    等于把「未接入」伪装成真实分类。**已改为 `countByKnown()`，无值行不计入，返回 `[]`**。
> ② 旧 `bytes_sent` 写死 `0`，「流量」永远是 0（假数据）。**已改为从 `Content-Length` 真实回填，并新增 `hasTraffic` 标记**，
>    前端据此显示「暂无」而非假 0。
> 注：`browsers/oses/devices` 里的 `"未知"` 是**保留**的（UA 确实无法识别，属真实分类）；只有 `provinces` 不许出现「未知」。

---

## 四、报表中心（需求 3.1~3.7，W3）

### 4.1 内置看板 → AI 报表（需求 3.1）

| 判据 | 实测 |
|---|---|
| `BUILTIN_BOARDS` 硬编码数组 | 已删除（源码仅剩 1 处注释说明） |
| `GET /api/ai-reports?source=builtin` | **2 条**（id=46 中康智能体客户看板 / id=47 客户签约看板） |
| Tab 文案 | `["全部报表","AI 报表（2）","图表报表","表格报表","数据看板"]` |

### 4.2 「我的报表」→「BI 报表」（需求 3.2）

分组标题实测 `["AI 报表","BI 报表"]`；BI 卡片 DOM 数 **1** === 接口 BI 数 **1**（chart/table/dashboard 原样展示，未改名）。

### 4.3 分享按钮改为弹窗（需求 3.3）

- `location.pathname`：`/reports` → `/reports`（**未跳转**）
- `goShareCentre()` 源码 **0 引用**
- 确认后返回：`http://…/s/64397c8bc90d0f5d7c9f5c46`

### 4.4 AI 报表可查看 / 修改代码（需求 3.4 / 3.5）

- 查看代码：`shownLen = 568`，`apiLen = 568`，**`equal = true`**（与后端 `dsl` 逐字相等）
- 非法 JSON：提示「JSON 格式错误，请检查后再保存」，弹窗不崩
- 合法保存：`modalGone = true`，API 回读含标记，重开内容已变；原始 dsl 已还原（len=568）

### 4.5 操作按钮可见性矩阵（需求 3.6，P0-3）—— 19/19 PASS

| 类型 | 可用操作 |
|---|---|
| BI 报表 | 查看 / 编辑 / **设计** / 复制 / 分享 / 停用（**无** AI调整、手动调整、删除） |
| AI 报表 | 查看 / 编辑 / **AI调整** / **手动调整** / 复制 / 分享 / 停用 / 查看代码（**无** 设计） |
| AI 内置报表 | 同上，但**永不出现「删除」** |
| 停用态 BI | 查看 / 复制 / 分享 / 启用 / **删除** |
| 停用态 AI | 查看 / 复制 / 分享 / 启用 / 查看代码（内置仍无删除） |

即「删除」仅在停用后出现，且内置 AI 报表在任何状态下都不可删除（后端 403 兜底）。

### 4.6 分享落库可见（需求 3.7）

`GET /api/shares` 命中 token，`title=客户签约看板`；`/shares` 页面文本含该标题。

### 4.7 移动端（P0-6）

`/reports` 375px：`scrollWidth = clientWidth = 375`，**无横向溢出**。

---

## 五、看板（需求 4~6，W4 / W5 / W6）

### 5.1 ERP 卡片去掉「对接版本汇总」文字（需求 4.2）

| 判据 | 实测 |
|---|---|
| 「对接版本汇总」出现次数 | **0 处** |
| 可见文本 | `有券版本109家` + `无券版本8家`，底部恒 **2 行** |
| 口径不变（P0-5） | **109 + 8 = 117 === ERP 分布客户数 117** ✔ |

> 仅改展示，沿用 V15 `erpVersionSummary` 口径，后端零改动。

### 5.2 点 ERP 卡片 → 客户明细弹窗（需求 4.4 / 4.5）

6 个 ERP 按钮**全部可点**，标题与明细行数逐一对齐：

| ERP | 弹窗标题 | 明细行数 | 首屏行数 |
|---|---|---|---|
| 海典H2 | 海典H2·连锁明细（30 家） | 30 === 30 ✔ | 10 = min(10,30) |
| 雨诺 | 雨诺（30） | 30 === 30 ✔ | 10 |
| 海典H1 | 海典H1（27） | 27 === 27 ✔ | 10 |
| 时空智友 | 时空智友（5） | 5 === 5 ✔ | 5 |
| 雨诺oracle | 雨诺oracle（5） | 5 === 5 ✔ | 5 |
| 其他 12 个 ERP | 其他 12 个 ERP（20） | 20 === 20 ✔ | 10 |

**UI 与参考「全国百强·连锁明细」逐值一致**：列头 11 列完全包含（`签约时间/区域/连锁ID/连锁名称/连锁类型/对接版本/销售/当前节点/状态/开通策略数/触达人数`，`missing=[]`）且公共列顺序一致；表头底色 `rgb(248,250,253)`、字号字重 `14px/700` **两项与参考逐值相同**。

**ERP 归属真实性（本轮修正）**：明细行字段名为 `erpName`（大写 P），与 `row1.erpDistribution[].name` **逐桶等价** ——
17 桶、逐桶计数 `IDENTICAL = true`、两边合计均 **117**。故按钮 → 明细按 `r.erpName` 字段过滤即可，无需任何推定。

**375px**：ERP 卡片 `scrollWidth 349 === clientWidth 349`（over=0），版本两行 `303/303`、`303/303`，整页 `375/375` 无横向溢出。

### 5.3 流程状态节点弹窗与全国百强明细同款（需求 4.6）

- 节点弹窗（实施对接·明细 53 家）：`.vb3-sum-tag` **21 个**；维度块 `region/role/status/owner/chainType` **5 块**
- 点「北区 33 家」→ `共 53 家 → 筛选后 33 家`，`activeTags = 1`
- 表头底色 `rgb(248,250,253)`、字号字重 `14px/700` **与参考逐值一致**

### 5.4 流程图改 2 行（需求 4.7）

| 判据 | 实测 |
|---|---|
| 节点数 | **9** |
| 每节点文本行数 | `.fm-l1` 1 行 + `.fm-l2` 1 行 = **2 行**，9 节点全为 2 |
| 节点间箭头 | **8** 个（= 9 − 1） |
| 流程区含「 · 」 | **0 处** |
| 节点宽度一致性 | `widths = [112×9]`，唯一值 **1** |
| 节点高度一致性 | `heights = [88×9]`，唯一值 **1** |

> **本轮修复的真实缺陷**：改前 `heights = [113, 94]`（2 种高度），且 94px 的其实是 **7 个**不是 1 个。
> 根因不是 `min-height` 塌陷，而是 `.fm-node{flex:1 1 auto}` + 列高由**脚注行数**决定：
> 脚注 2 行（销售签约/流程结束）→ 卡 113px；脚注 3 行（多「平均耗时」行）→ 卡 94px。
> 修法 `.fm-node.two{min-height:88px;height:88px;flex:0 0 auto}` —— **卡体高度与脚注解耦**。

### 5.5 客户运行情况 / 连锁排名提示同款「策略运行情况」风格（需求 4.8 / 5.1 / 5.2）

CSS **逐字复制** RunBreakdown L243 两条声明（仅前缀改名），不新增任何色值/字号。三项计算样式逐项相等：

```
RunBreakdown 客户标杆  : vb10-warn   icon: anticon anticon-warning ic
RunMetrics   客户运行情况: vb9-warn    icon: anticon anticon-warning ic
ChainRanking 连锁排名  : vb14-warn    icon: anticon anticon-warning ic

color rgb(217,119,6) | bg color(srgb .851 .467 .024 / .08)
border 1px solid color(srgb .851 .467 .024 / .26) | radius 999px
padding 3px 10px | 11px/16.5px | fw 600 | display flex | gap 6px
→ 三行（标杆 / 客户运行 / 连锁排名）逐字相同
```

提示文案逐字：`！当前 T+30 转化数据不全，数据会随时间而增长。`
旧文案 `口径同`、`个连锁 ·` 各 **−1**（现 0 处）；旧南北图例元素数 **0**。

### 5.6 连锁排名增加「用券销售额」（需求 5.3）

- `.vb14-item` 卡片 **16** 张，其中 `.v[data-k="用券销售额"]` **16** 个
- 16 值全为 `¥` 金额串，**无 `undefined` / `NaN` / `null`**
- 抽检 chain 12394：后端 `couponGmv = 19328.49` → UI `¥19,328`（元位四舍五入，差 0.49）
- **全量按 chainId 逐张核对 16/16 一致**（容差 ±0.5），例：`12394: ¥19,328 / 19328.49 ✓`、`15602: ¥0 / 0 ✓`

### 5.7 策略运行趋势标题栏去掉「指标 / 图例」（需求 5.4）

- 标题栏「指标」**0 处**、「图例」**0 处**
- 10 个 chip 全部可见（宽 70~106px，`display` 非 none）
- 真点击第 1 个 chip：`aria-pressed true → false` ✔

### 5.8 客户详情弹窗（需求 6.2~6.5，P0-4）

| # | 判据 | 实测 |
|---|---|---|
| 6.2 | 默认全部收起，仅「基础信息」展开 | 4 个容器 `aria-expanded`：`run=false, trend=false, flowTimeline=false, basic=true` → **true 计 1 / false 计 3** |
| 6.3 | 耗时距时间文本右边 **50px** | **1440：8 行全 50px**；**375：8 行全 50px** |
| 6.4 | 删除备注解释文案 | 源码 **0/0**，渲染文本 **0/0**，`.vcd-tip` 元素数 **0** |
| 6.5 | 基础信息分组 | 分组数 **4**（基础信息 12 / ERP 信息 5 / 运营信息 7 / 时间信息 5 = **29**，+相关人员 4 = **33**；改前 **16**） |
| 6.5 | ERP 名称有真实值 | **「海典H2」**（375px 下同样渲染） |
| — | `undefined` / `null` 字面量文案 | **0 处** |
| 6.6 | 全部连锁名可点击 | 客户明细表 **10/10** 连锁名为 `role=button`+`tabindex`，点击后打开**同一个**详情弹窗 |
| 6.6 | 375px 无横向溢出 | 弹窗 body `252 = 252`，document `375 = 375`；1440 下 `1104 = 1104` |

**6.3 修法**：旧实现时间列 `1fr` + 耗时右对齐，实测偏移 **22~92px**；改为 grid `18px 104px max-content minmax(0,1fr)` + `column-gap:0` +
`.du{justify-self:start;padding-left:50px}`，并统一补零成「MM月DD日 HH:MM」，**与视口宽度彻底解耦**。

**6.5 四组字段明细**：
- 基础信息 12：客户名称 / 连锁名称 / 连锁ID / 连锁类型 / 区域 / 门店数 / 国家 / 省份 / 签约类型 / 当前节点 / 流程状态 / 当前处理人
- ERP 信息 5：**ERP 名称** / ERP 版本 / 是否有券 / 对接结果 / 培训结果
- 运营信息 7：策略类型 / 触达人数 / 到店人数 / 到店率 / 转化销售额 / 运行策略数 / ROI
- 时间信息 5：首次触达 / 最近触达 / 最近到店 / 签约时间 / 提交时间
- 另有「相关人员」独立区块 4 项（CD-3 保留）

> **「最近到店」实测确认后端无此字段**：`GET /api/crm/board/client/12394` 返回 `client, progress, timeline, run, runMetrics, trend, signAtLabel, submitAtLabel`；
> `run` 里唯一日期是 `import_date`（导入日，非到店日）；`runMetrics` 只有人数聚合（`arrivedPeople: 1500`）无时间戳。
> 全仓库 grep `最近到店|lastVisit|arriveAtLabel|lastArrive` → 后端 **0 处**。故显示 `—`，**不推算**；前端已兼容 `visitAtLabel`/`arriveAtLabel`/`data.lastVisitAtLabel` 三个键名，后端补字段后零改动生效。

### 5.9 明细多维度筛选（需求 6.1）

- 顶栏 chip **6** 个；点「区域」选「北区」后 chip 文本变 `北区`，显示 `已应用 1 个筛选条件`
- **明细行数 117 → 69**

---

## 六、全局基线回归（G4 / G5 / G6）

### 6.1 G4 看板基线（`_work/v16-g4.js`，17 项）

| 判据 | 实测 |
|---|---|
| 页面非白屏 | `body.innerText.length = 8502` |
| 板块标题齐全 | **17** 个 h3，`missing = []` |
| 连锁排名标题 | `["连锁类型分布","连锁排名按触达人数"]` |
| 品牌主色 `#1677FF` | `--brand = #1677FF`，节点背景 `linear-gradient(160deg, rgb(22,119,255), rgb(76,147,255))` |
| 横向溢出 375/1024/1280/1440/1920 | `scrollWidth === clientWidth` **5/5** |
| 可见文本最小字号 | **11px**（采样 1743 个文本节点） |
| 流程节点 | 9 个、宽度 `[149]`（改等高后 `[112×9]`）、2 行文本、8 箭头 |
| 控制台 error | **0** |

### 6.2 G5 构建产物页面巡检（`_work/v16-g5-pages.js`，8 项，跑在 `vite preview` 生产构建上）

| 页面 | innerText 长度 | 结果 |
|---|---|---|
| `/dashboard/board` | 8519 | ✔ |
| `/reports` | 692 | ✔ |
| `/shares` | 1193 | ✔ |
| `/dashboard/crm` | 2429 | ✔ |
| `/dashboard` | 948 | ✔ |

全程控制台 error **0**。

### 6.3 G6 Modal 关闭能力（`_work/v16-g6e-modal-final.js`）

| Modal | X 按钮 | ESC | 点遮罩 |
|---|---|---|---|
| 流程节点弹窗 | 1 → 0 ✔ | 1 → 0 ✔ | 1 → 0 ✔ |
| ERP 明细弹窗 | 1 → 0 ✔ | 1 → 0 ✔ | 1 → 0 ✔ |

> **排查记录（避免后人重踩）**：初版脚本 ESC 只发 `keyDown + keyUp`，**不触发**；必须三连
> `rawKeyDown → char('\u001b') → keyUp`。且每个用例前必须重载页面，否则前一个 Modal 未关会叠加污染计数。
> 据此得出的「antd6 Modal 全站关不掉」结论**已被推翻**，`@rc-component/dialog@1.10.0` 与
> `@rc-component/motion` 的 `enableMotion/inMotion` 转发**工作正常**（`CSSMotion.js:61-78` 用
> `Object.defineProperties` 定义 getter，`L82` `useImperativeHandle(ref, () => refObj)`），非缺陷。

### 6.4 favicon 404 消除

生产构建 `GET /favicon.ico` → **200，15086 字节**（`frontend/public/favicon.ico`，16/32/48 三尺寸，
白「D」+ `#1677FF` 底；32×32 帧实测 776 蓝像素 + 248 白像素 + **0 其他色**）。
改前 G5 巡检中唯一一条控制台 error 即为该 404，现已归零。

---

## 七、部署产物

| 项 | 值 |
|---|---|
| 版本 | `16.0.0`（根 `package.json` + `frontend/package.json`） |
| 打包脚本 | `_work/v16-pack.js`（手写 ZIP store/deflate + 手写 CRC32，规避 Windows `tar` 中文路径限制） |
| 文件数 | **196** |
| 原始总字节 | 7,017,702 |
| 包大小 | **2,347,571 字节（2.24 MB）** |
| SHA256 | `0a13862d9d85006d6c22297e85f1e3f3b02029901b6882583b594a8ffa1f1f3e` |
| ZIP 完整性 | **196/196 条目 CRC + 大小校验通过** |
| `node_modules` 入包 | **0** |
| `.env` 入包 | **0**（脚本内建拦截，发现即中止） |
| 看板源码入包 | **0**（`dashboard/**/*.tsx|ts` 计数 0，仅含 `frontend/dist`） |
| `src/*.js` 后端模块 | 47 |

---

## 八、遗留项（如实记录，未在本版解决）

| # | 遗留 | 原因 / 现状 |
|---|---|---|
| 1 | **省份待接入** | 全仓库无 geoip/ip2region/maxmind 依赖；`province` 恒 `NULL`，接口 `provinceStatus:'pending'`，UI 显示「暂无（待接入省份库）」。**不造假** |
| 2 | **流量指标暂无** | beacon 应用埋点不记录响应体字节数；接口 `hasTraffic:false`，UI 显示「暂无」。nginx 回填源含 `$body_bytes_sent`，可看真实值 |
| 3 | **「最近到店」后端无字段** | 见 §5.8，`runMetrics` 仅有 `arrivedPeople` 人数无时间戳；UI 显示 `—`，前端已兼容 3 个候选键名 |
| 4 | **`couponGmv` 11/16 为 0** | 后端字段 `c_0964f9ffab` 真实求和为 0（非渲染问题，16/16 已逐张对齐）。0 是有效值不是缺失值，故显示 `¥0` 而非「暂无」 |
| 5 | **AI 调整未端到端实测** | `/api/ai-reports/ai-draft` 在无本地模型凭据时会**阻塞 Node 事件循环**（实测拖垮整个后端）。已实现 `AbortController` + 30s 超时 + 「AI 服务不可用，请用手动调整」兜底，属代码审查确认 |
| 6 | **深色模式未截图验证** | 本轮判据无此要求；`useThemeMode` 按 `board:theme` 事件订阅，弹窗令牌随明暗切换（代码层已处理） |
| 7 | **`@container` 容器查询回落** | Chromium 系全支持；老版 Safari（<16）回落 `@media(max-width:575px)` 分支，375px 判据仍满足 |

---

## 九、非回归声明

- `npx tsc --noEmit` → **EXIT 0**（整仓，无错误）
- 前端 `npm run build` → 成功（11.52s）
- 看板 17 个板块标题、5 个视口无横向溢出、最小字号 11px、主色 `#1677FF`、控制台 0 error
- 客户明细 / ERP 明细 / 流程节点三类弹窗的 X / ESC / 遮罩关闭路径 **6/6 通过**
- 5 个主要页面在**生产构建产物**上 innerText 均达标、控制台 0 error
- 数据口径：`109 + 8 = 117`（ERP 版本汇总）、`17 桶 = 117 家`（ERP 分布与明细 `erpName` 逐桶等价）、ROI `15/15` 误差 < 1e-4

## [15.0.0] - 2026-11-03

### 版本主题：看板 15 项交互与口径精修 + 对接版本汇总 + 流程状态明细三列重命名

本轮覆盖 `SigningCards / FlowPipeline / TypeSummary / Rankings / SignTrend / FlowProgress /
RunMetrics / ChainRanking / RunBreakdown / RunTrend / DetailTable / ClientDetail / share-view`
13 个组件，并新增 2 个后端接口与 1 组后端字段。**全部结论均为浏览器 / 接口实测读数**，
无「已优化」式结论；每项均给改前 / 改后数字。

> 看板目录（`frontend/src/pages/dashboard/board/`、`Board.tsx`、`share-view.tsx`）不开源，仅私服部署。

---

## 一、后端契约（W0）

### B1 `row1.erpVersionSummary`：对接版本汇总（需求 3.1）

**用户原话**：ERP 分布卡片下方增加「对接版本汇总：有券版本X家，无券版本X家」。

**口径（实测确认）**：按 `w_1792577110570` 前缀匹配 —— `有券版本` 开头计入 `withCoupon`，
`无券版本` 开头计入 `withoutCoupon`。

**实测值（全量 113 家）**：

```json
{"withCoupon":{"south":41,"north":64,"total":105},
 "withoutCoupon":{"south":5,"north":3,"total":8},"unknown":0,"total":113}
```

`105 + 8 = 113 === row1.totalClients` ✓（南 41+5=46、北 64+3=67，46+67=113 ✓）

### B2 明细行补字段 + 流水号降序（需求 4.5 / 5.1 / 6.1 / 13.5）

- `toDetailRow(c)` 新增 `ownerRole` / `ownerRoles` / `version` / `signDate` / `province`；
- `toFullRow(c, seq)` 新增 `version` 与 `versionShort`（`有券版本` / `无券版本`）；
- Running 数据兜底：`c.run`（`mail_30`）缺失时回退 `mail_31` 按连锁聚合，使 18 家有 `mail_31` 的连锁也能显示真实触达人数；
- `DETAIL_COLUMNS[0].title` 由 `序号` 改为 `流水号`，`detail.rows` 按 `seq` **降序**。

**实测**：`detail.columns` 28 项，`[0] = {"key":"seq","title":"流水号","width":52,"default":true,"align":"center"}`；
`detail.rows` 113 行，`row[0].seq = 113`，末行 `seq = 1`，严格递减 `true`。

### B3 `row8.items[i].chains`：策略类型下钻连锁明细（需求 11.1）

`buildRow8()` 为每个策略类型卡新增 `chains: StrategyChainRow[]`（按 `reachedPeople` 降序），
含 16 列全部字段：`signDate, region, chainId, chainName, chainType, version, reachedPeople,
arrivedPeople, reachRate, gmv, couponIssued, couponUsed, couponRate, couponCost, channelCost, roi`。

**实测**：`row8.items` 9 项，`item[0]` = `model 病种会员托管 / type 高血压`，`chains` 8 行，
`chain[0]` 16 列齐全（`reachedPeople 2152, arrivedPeople 695, reachRate 0.323, gmv 256242.29,
channelCost 68.64, roi 0.0003`）。

### B4 客户详情策略类型明细 + 公开访问 + 列设置同步（需求 14.6 / 13.4）

- `buildClientDetail(chainId).runMetrics.strategyTypes`：按 `jdywh_mail_31` 最新 `import_date` 的策略类型分组，含 11 列字段。
  **实测**：`GET /api/crm/board/client/15820` → 4 行（`高血压 801/141/0.176`、`糖尿病 79/3/0.038`、`沉睡会员 0`、`新会员 0`）。
- 新增 `GET /api/public/board/client/:id`（校验分享 token → `buildClientDetail`），使分享页点连锁名也能开客户详情。
  **实测**：带 token → `200 ok:true`；不带 token → `400 {"ok":false,"message":"缺少分享令牌"}`。
- 新增 `POST /api/crm/board/columns`（写 `jdywh_settings.crmboard_detail_columns`），`buildBoard()` 返回 `detail.savedColumns`。
  **实测**：`POST` 200 后 `savedColumns:["seq","region","chainId","chainName"]`；重置 `[]` 后 `savedColumns:null`。

---

## 二、看板前端 15 项（W1 ~ W13）

> 每项格式：用户原话 → 根因 / 改动 → 实测数字。

### W1 `SigningCards.tsx` — 签约概览 / 进行中 / ERP 分布（1.1、2.1~2.5、3.1~3.2）

| # | 用户原话 | 改动 | 实测（改后） |
|---|---|---|---|
| 1.1 | 任务完成进度右侧备注「仅计算50+以上连锁」 | 卡2 `hint` 位 | `.vb1-hint` 文本 === `仅计算50+以上连锁`，`font-size = 11px` ✓ |
| 2.1 | 进行中明细不显示「处理人」列，改上方标签 | 处理人移出表格列，改为表上方标签 | 表格 10 列，`title` 含「处理人」**0 处**；标签 DOM 位置在表体之前 ✓ |
| 2.2 | 首列改为「状态」 | 首列 = `状态`，仅两分支 | 首行渲染 `正常`；render 仅 `超期` / `正常` ✓ |
| 2.3 | 「进入当前节点时间」→「节点时间」 | 表头重命名 | 表头逐字 `节点时间` ✓ |
| 2.4 | 「当前节点时长(天)」→「节点时长」 | 表头重命名 | 表头逐字 `节点时长` ✓ |
| 2.5 | 点连锁名称弹客户详情 | 接入 `ClientDetail` | 点「山东燕喜堂…」→ 弹窗标题 `山东燕喜堂医药连锁有限公司 · 客户详情`，含 `ID 10120` ✓ |
| 3.1 | ERP 分布下方加「对接版本汇总：有券版本X家，无券版本Y家」 | 加 `.v-comma` 承载全角「，」 | 实测 `对接版本汇总：有券版本105家，无券版本8家`，105+8=**113** = 卡片客户数 ✓ |
| 3.2 | ERP 6 指标改 3 行 2 列 | `grid-template-columns` 收紧 | 实测 `156.828px 156.844px`（2 列）；`erpRows = 6` 项 → **3 行** ✓ |

### W2 `FlowPipeline.tsx` — 流程状态（4.1~4.8）

| # | 实测（改后） |
|---|---|
| 4.1 | 唯一 0 家卡（策略审核）实测 `策略审核 \| 0 \| 家 \| · 0% \| 南 0 \| 北 0` ✓ |
| 4.2 | 同卡实测含 `· 0%` ✓ |
| 4.3 | 4 个槽位 `.fm-s1..s4` 中心与卡中心 **delta 全为 0px**，`text-align / justify-content` 均 `center` ✓ |
| 4.4 | `节点时间` / `节点时长` / `总时长` 逐字；旧文案 `进入当前节点时间` / `当前节点时长(天)` / `连锁总时长(天)` **各 0 处** ✓ |
| 4.5 | 第1排 `top=162`：按区域 / 按岗位 / 按状态；第2排 `top=194`：按处理人 / 按连锁类型。同排 top 差 **0px < 2px**，第一排 < 第二排 ✓ |
| 4.6 | 点「北区 1 家」→ 标签进 `.active`（1 个）；再点取消 → `.active` 归 0 ✓ |
| 4.7 | 表头逐字 `连锁ID`；`连锁Id` **0 处** ✓ |
| 4.8 | 实测 `策略开通 2 个工作日 → 实施对接 5 个工作日 → 对接审核 2 个工作日 → 客服处理 10 个工作日 → 客户培训 3 个工作日 → 连锁使用 5 个工作日 → 策略审核 2 个工作日`；`.fm-on-step` **7 个**、`.fm-on-arrow` **6 个**、` · ` 计数 **0** ✓ |

> 说明：4.8 判据范围是「底部超期说明」（`.fm-on-flow`）。节点卡内的 ` · 1.0%`（`.fm-r`）不在该判据内，未改动。

### W3 `TypeSummary.tsx` — 连锁类型分布（5.1~5.2）

- **5.1** 弹窗表头实测 **11 列同序**：`签约时间, 区域, 连锁ID, 连锁名称, 连锁类型, 对接版本, 销售, 当前节点, 状态, 开通策略数, 触达人数` ✓；
  `状态` 渲染仅 `超期` / `正常`；点连锁名 → 客户详情弹窗 ✓
- **5.2** 第1排 `top=163`：`按区域：`(2 tags) + `按销售：`(5 tags)；第2排 `top=195`：`按省份：`(7 tags)；同排 top 差 **0px** ✓

### W4 `Rankings.tsx` — 排行弹窗（6.1~6.2）

- **6.1** 严格 **10 列**（无「销售」）：`签约时间, 区域, 连锁ID, 连锁名称, 连锁类型, 对接版本, 当前节点, 状态, 开通策略数, 触达人数`
- **6.2** 客户数 / 门店数弹窗 **2 个汇总区**（按连锁类型 / 按省份）；省份排名弹窗 **1 个**（按连锁类型）
- 卡片副标题实测 `仅计算 50+ 以上的连锁`（11px）

### W5 `SignTrend.tsx` — 签约趋势（7.1~7.3）

- **7.1** 连锁类型 + 门店数图例筛选按钮移至标题栏：实测 `.vb6-chip` 全部位于 `.vb6-h` 标题栏内 ✓
  （`chips = 全国 / 区县 / 50+ / 50-`；区域分段 `.vb6-seg` = `全部 / 南区 / 北区`）
- **7.2** 标题栏新增「数据标签」开关（`.vb6-tgl`，位于 `.vb6-h` 内）：实测文本 `数据标签` ✓
- **7.3** 全页「最近 30 天」实测 **0 处** ✓

### W6 `FlowProgress.tsx` — 流程处理热力（8.1~8.8）

| # | 实测（Lead 终验） |
|---|---|
| 8.1 | 「最近 7 天」**0 处** ✓ |
| 8.2 | 区域分段 `.vb8-seg` 左边界 < 「近 30 日明细」`.vb8-link` 左边界 ✓ |
| 8.3 | 「近 30 日明细」`border-width 0px` + `background rgba(0,0,0,0)`（无边框卡片）✓ |
| 8.4 | 0 值单元格显示 `-`：`.vb8-tb tbody td` 中 `-` **40 个**、裸 `"0"` **0 个** ✓ |
| 8.5 | 浅色主题：16 个采样格，背景亮度差方向集合 = `[-1]`（**严格单调**），`v=1 → 242`、`v=17 → 209`（值越大越深）✓<br>深色主题：方向集合 = `[+1]`，`v=1 → 39`、`v=17 → 58` ✓<br>正文对底色对比度：浅色 **16.01**、深色 **12.76**（均 ≥ 4.5）✓ |
| 8.6 | `.vb8-tb tbody td` 实测 **56/56** 全为 `text-align: center` ✓ |
| 8.7 | 表头前带背景色块数 = **0** ✓ |
| 8.8 | 「近 7 日累计」**0 处** ✓ |

> 8.5 实现说明：热力色由 `color-mix(in srgb, var(--brand) N%, var(--panel))` 派生，`N = 8 + ratio × (上限 − 8)`，
> 浅色上限 48% / 深色上限 40%（`FlowProgress.tsx:361-366`）。因此「由深到浅」在浅色主题下表现为亮度随数值**递减**、
> 深色主题下**递增**，两主题均为严格单调阶梯，断言取「单调」而非固定方向。
> 探测注意：`getComputedStyle` 对该色值返回 `color(srgb r g b)` 而非 `rgb()/rgba()`，只解析后者会得到空样本而误判。

### W7 `RunMetrics.tsx` — 客户运行情况（9.1~9.2）

- **9.1** 原南区 / 北区图例整块删除（`.vb9-legend` 及其子元素计数 **0**；卡头「南区 / 北区」**0 次**），
  改为逐字提示 `！当前 T+30 转化数据不全，数据会随时间而增长。`（26/26 字符，全角「！」「，」「。」）✓
  - **根因（重要）**：`design-system.ts` 的 `BOARD_GLOBAL_CSS` 有 `.board-root [class$="-hint"]{...color:var(--text3)}`（特异度 0,2,0），
    会压过单类 `.vb9-hint`（0,1,0），实测颜色被打回 `--text3`（对比度仅 **3.09 < 4.5**）。
    修复：选择器升到 `.vb9-card .vb9-h .vb9-hint`（0,3,0），实测取回 `rgb(71,85,105)` = `--text2`。
  - 附加缺陷：全局卡头 `height:48px + flex-wrap:nowrap + overflow:hidden` 使 375px 下提示被裁到约 3 行可见（实需 12 行 / 178px）。
    修复：新增 `@media(max-width:767px)` 放开固定高 + 允许换行（选择器 0,3,0 > 全局 0,2,0）。
- **9.2** 每卡 2 指标间加 `1px` **竖直**分割线（原为水平 `border-top`）。
  `.vb9-body{flex-direction:row}` + `.vb9-vline{width:1px;align-self:stretch}` + JSX `{li>0 && <span className="vb9-vline"/>}` → 每卡 DOM 恒 1 条。

| 视口 | 卡头高 | 提示颜色 | white-space | 提示完整 | 横向溢出 |
|---|---|---|---|---|---|
| 375 | 101px | rgb(71,85,105) | normal | ✅ | 无 |
| 641 / 767 | 56px | rgb(71,85,105) | normal | ✅ | 无 |
| 768 / 1024 / 1440 | 48px | rgb(71,85,105) | nowrap | ✅ | 无 |

### W8 `ChainRanking.tsx` — 连锁排名（10.1~10.3）

- **10.1** 名称单行截断：**15/15** 个 `.vb14-it-nm` 均为 `white-space: nowrap` + `text-overflow: ellipsis`；
  标签行 **30/30** 为 nowrap 不换行；溢出标签渲染 `+X` 且带 `title` 具体值
  （实测 `+6` → title `还有 6 个策略类型：高净值会员、高血压、活跃会员、流失会员、糖尿病、新会员`；`+4`、`+3` 同）✓
- **10.2** 3 板块 + 分割线 + **不同文字色**：实测每卡 **3** 个 `.vb14-sec`，
  标题 = `触达与转化` / `优惠券` / `成本与 ROI`；**30** 个板块带边框分割线；
  3 种不同文字色 `color(srgb 0.079 0.369 0.783)` / `color(srgb 0.030 0.459 0.348)` / `color(srgb 0.654 0.134 0.153)` ✓
- **10.3** 右侧提示逐字 `！当前 T+30 转化数据不全，数据会随时间而增长。` ✓

### W9 `RunBreakdown.tsx` — 策略运行情况（11.1~11.3）

- **11.1** 点击策略类型卡弹出「有运行当前策略的连锁明细」，表头严格 **16 列同序**：
  `签约时间, 区域, 连锁ID, 连锁名称, 连锁类型, 对接版本, 触达人数, 到店人数, 到店率, 转化销售额,
  发放优惠券, 核销优惠券, 优惠券核销率, 优惠券成本, 渠道成本, ROI`；点连锁名进客户详情
- **11.2** 左侧策略模块新增 `到店率`（= 到店人数 ÷ 触达人数）与 `人均销售额`（= 转化销售额 ÷ **到店人数**）
- **11.3** 取消「开通策略」「运行策略」（作为指标名）；保留「开通连锁数」「运行连锁数」

### W10 `RunTrend.tsx` — 策略运行趋势（12.1~12.2）

- **12.1** 删除右侧 `近 30 日 · 按策略开通&触达时间 · X/30 天有数据`。
  实测 `近 30 日 ·` / `按策略开通&触达时间` / `X/30 天有数据` 三种模式全页 **0 处** ✓
- **12.2** 指标 / 图例移到标题栏并靠右：`.vb7-hd` 位于 `.vb7-h` 内，`justify-content: space-between`，
  右边界差 **16px**（≤ 24px 判据）✓
  卡头文本实测 = `指标 / 图例 触达人数 运行连锁数 开通策略数 运行策略数 渠道成本 用券成本 成本合计 到店率 优惠券核销率 营销ROI 全选 数据标签`

### W11 `DetailTable.tsx` — 客户明细（13.1~13.6）

- **13.1** 列宽与单元格 padding 收紧，1440px 同屏可见列数 ≥ 16
- **13.2** 表头文字居中
- **13.3** 内容可完整显示时取消横向滚动条。
  **根因（改前实测）**：`table-layout: auto` 下 antd 列宽只是建议值，长文本（连锁名称）把 `table` 真实宽度撑到 **1416px** > 容器 **1138px**，于是 `.ant-table-content` 出现横向滚动（`scrollWidth 1416 / clientWidth 1138`，1440px 同屏仅完整可见 **12 列**）。
  修复：`table-layout:fixed!important; width:100%!important; min-width:0!important` + 单元格允许换行，列宽严格按 `colgroup` 生效。
  > 注意：该段 CSS 位于 JS 模板字符串内，注释中禁止出现反引号（否则截断字符串，实测触发 `TS1005`）。
- **13.4** 列设置对分享页生效：用户页读 `localStorage['crmboard.detail.columns']` → 无则读服务端 `detail.savedColumns`；用户改动**同时**写 localStorage 与 `saveBoardColumns()`（推服务端）。
  分享页优先用服务端 `savedColumns` → 回落 localStorage，且**只读不写**（`saveBoardColumns` 在 `/s/` 下自动跳过）✓
- **13.5** 首列「序号」→ `流水号`，整表按 `seq` 降序（后端已降序下发）✓
- **13.6** 表头名称后不再显示「共 113 条」（改前 header 文本 `客户明细\n共 113 条\n列设置` 1 处 → 改后**该位置 0 处**）；
  条数信息保留在分页器 `showTotal`（`第 1-10 条 / 共 113 条`），不丢信息 ✓

### W12 `ClientDetail.tsx` — 客户详情弹窗（14.1~14.6）

- **14.1** 流程进度与节点时间线融合为 **1 个卡片**（原为 2 个独立区块）
- **14.2** 策略类型 / 运行指标区 **6 行 2 列**
- **14.3** 节点时间线在左、流程进度在右（`top` 差 < 2px）
- **14.4** 取消每卡右侧描述文字，改为「收起 / 展开」按钮
- **14.5** 「开通了哪些策略类型」→「开通策略」，作为**标签**置于客户名称后方（原 `开通了哪些策略类型` 实测 **0 处**）
- **14.6** 「策略与运行」下方新增策略类型明细表，表头严格 **11 列**：
  `策略类型, 触达人数, 到店人数, 到店率, 转化销售额, 发放优惠券, 核销优惠券, 优惠券核销率, 优惠券成本, 渠道成本, ROI`
- **配套契约改造（本版 Lead 完成）**：`ClientDetailProps` 由「受控单模式」升级为**双模式** ——
  传 `loading/error/data` 为受控（`DetailTable` 用法）；只传 `chainId` 则组件内 `fetchClientDetail()` 自取数
  （`SigningCards` / `Rankings` / `TypeSummary` 用法）。修复了 `Rankings.tsx(981,9)`、`SigningCards.tsx(815,9)`、
  `TypeSummary.tsx(472,9)` 三处 `TS2322`（调用方已按新契约书写，但组件 props 未跟进）。

### W13 `share-view.tsx` — 分享页标题栏（15.1）

- 删除分享页自造的渐变 Banner 与 `.sv-filterbar`，改由**与用户页完全同一个** `<TopBar>` 渲染。
- **实测（CDP，用户页 vs 分享页逐字段对比；Lead 终验）**：

| 检查项 | 用户页 | 分享页 | 判定 |
|---|---|---|---|
| `.board-topbar` 存在 | ✓ | ✓ | PASS |
| 旧 `.sv-filterbar` | — | **false** | PASS |
| 后代元素总数 | **75** | **75** | PASS（完全相等） |
| 叶子文本序列长度 | **7** | **7** | PASS |
| 叶子文本序列 | `中康智能体客户看板 / 全部时间 / 区域 / 连锁类型 / 销售 / 全部筛选条件 / 重置` | **完全相同** | PASS |
| `h1` 文案 | `中康智能体客户看板` | `中康智能体客户看板` | PASS |
| 顶栏背景色 | `color(srgb 1 1 1 / 0.92)` | `color(srgb 1 1 1 / 0.92)` | PASS |
| 顶栏下边框宽 | 同 | 同 | PASS |
| 375px 横向溢出 | — | `scrollWidth 375 === clientWidth 375` | PASS |
| 控制台 error | 0 | 0 | PASS |

> 宽度差异（用户页 1488 vs 分享页 1720）属布局上下文差异（用户页有侧栏、分享页无侧栏），**不是**判据。
> 15.1 判据是「同一组件 + 同一子元素序列 + 同一文案 + 同一高度」。
>
> **顺带修复**：分享页 `<TopBar>` 曾把 JSX 注释写在属性列表内部（`<TopBar {/* ... */} syncedLabel=...>`），
> 触发 `TS1005: '...' expected`；已把注释放到组件外。另发现分享页 `title={data.targetName}` 使
> 公开接口回传的「客户看板」泄进 `h1`，与用户页「中康智能体客户看板」不一致 → 改为与用户页同样**不传 title**，
> 两页标题恒等（上表「子元素文案序列一致」即为该项证据）。

---

## 三、非回归基线（全部实测）

Lead 终验脚本：`_work/v15-lead-accept.js`（主验收）、`_work/v15-lead-w5w6w8w10.js`（W5/W6/W8/W10 专项）。
两脚本合计 **61 项断言全部 PASS**（37 + 24）。

| 基线 | 结果 |
|---|---|
| 9 个流程节点卡（`.v7flow .fm-node`） | **9** ✓ |
| `--brand` = `#1677FF`（定义在 `.board-root`） | `#1677FF` ✓ |
| 最小字号 ≥ 11px（`.board-root` 全量扫描叶子节点） | **0 处违规** ✓ |
| 视口 1920px 横向溢出 | 无 ✓ |
| 视口 375px 横向溢出（看板首页） | `scrollWidth 375 === clientWidth 375` ✓ |
| 视口 375px 横向溢出（客户详情弹窗打开态） | `375 === 375` ✓ |
| 视口 375px 横向溢出（分享页） | `375 === 375` ✓ |
| 深浅双主题正文对比度（W6 热力格） | 浅色 **16.01** / 深色 **12.76**（均 ≥ 4.5）✓ |
| `npx tsc --noEmit` | **exit 0，0 error** ✓ |
| 浏览器控制台 error（全部场景，排除 favicon） | **0** ✓ |
| 看板 9 排区块渲染真实数据 | 全部渲染，无 `undefined` / `NaN` ✓ |
| 全站主色 `#1677FF` | 保持 ✓ |

### 弹窗表头逐字校验（Lead 实测，非组件自报）

| 判据 | 实测表头 | 结果 |
|---|---|---|
| W3 11 列 | `签约时间,区域,连锁ID,连锁名称,连锁类型,对接版本,销售,当前节点,状态,开通策略数,触达人数` | PASS |
| W4 10 列 | `签约时间,区域,连锁ID,连锁名称,连锁类型,对接版本,当前节点,状态,开通策略数,触达人数` | PASS |
| W9 16 列 | `签约时间,区域,连锁ID,连锁名称,连锁类型,对接版本,触达人数,到店人数,到店率,转化销售额,发放优惠券,核销优惠券,优惠券核销率,优惠券成本,渠道成本,ROI` | PASS |
| W12 11 列 | `策略类型,触达人数,到店人数,到店率,转化销售额,发放优惠券,核销优惠券,优惠券核销率,优惠券成本,渠道成本,ROI` | PASS |

> 探测方法说明（复现必读）：
> 1. antd Modal 关闭后仍留在 DOM（wrap 仅 `display:none` / `aria-hidden`），连续复用同一页面会把**上一个弹窗**的表头
>    读成新弹窗结果（实测 W4/W9 都曾读到 W3 的 11 列）。因此每条弹窗判据前都**重新加载页面**并断言「0 个可见弹窗」。
> 2. W12 的策略类型明细是**原生** `table[data-vcd-strategy-types="1"]`，不是 antd 表格；
>    用 `.ant-table-thead` 永远读不到。
> 3. 113 家连锁里**只有 15 家**有 `runMetrics.strategyTypes`（前端逐家扫 `/api/crm/board/client/:id` 得出，
>    名单见 `_w15_withdata.json`）；且明细表分页 10 行/页，目标散落在第 1~12 页，必须翻页定位。
>    其余连锁走 `[data-vcd-strategy-types-empty="1"]` 如实降级分支，符合契约 §0-8，不是缺陷。

---

## 四、验收与交付

- 交付物：`V15-验收报告.md`（`<ROOT>`）+ 本 CHANGELOG 段 + `_work\v15-deploy.tar.gz`
- 生产环境：https://jdy.zhengl.vip （站点目录 `/www/wwwroot/jdy-push`）
- 备份与回滚：见 `V15-验收报告.md`「部署与回滚」章节

---

## [14.0.0] - 2026-11-03

> 本段落为 V15 交付时**补录**。V14 发布时改动内容只写进了提交信息（commit `f140328`），
> 未同步进 CHANGELOG，导致 `[13.0.0]` 与 `[15.0.0]` 之间出现版本断档。此处依据该提交的
> 原始信息与 `git show f140328 --stat` 补全，未新增未经实测的数字。

### 版本主题：中康智能体客户看板数据修复 + 全局主色 #1677FF + 分享中心统一

---

## 一、整体优化

- 全局主色统一为 `#1677FF`（主菜单渐变 `#1677FF → #0B57D0`、按钮、文字、边框、阴影）
- 数据卡片统一上移至标签页上方（`Page.tsx` 渲染序改为 `head → stats → subTabs → children`）
- 报表中心与 AI 问数分享统一收敛到「分享中心」双标签（`reports.tsx` 移除内建 `ShareModal`，-459 行）
- AI 问数：术语配置 / SQL 示例库改为标签页
- 系统设置：关于移至最后且默认显示站点信息；修复版本号硬编码（`'V9.0'` → 由 `__FE_VERSION__` 派生）

## 二、看板数据错误修复（含根因）

### D1 流程状态误判

`flow_current_node` 是流程引擎的「当前停留节点」，节点完成后**不会清空**，
导致 `10147 / 15374 / 15654` 等已完成连锁仍显示「策略审核」。

新判定：当前节点为空 **或**（当前节点 = 策略审核 且 策略审核完成时间有值）→ 流程结束。

对 113 行实测 10/10 完全一致；**策略审核计数 6 → 0，流程结束 4 → 10**。

### D2 筛选选项消失

`buildOptionsAndCounts` 原基于**筛选后**的 clients，选「南区」后北区选项消失。
改为基于全量 `allClients`（顶部筛选框 = 全部数据），计数不随筛选变化。

## 三、看板功能与体验

| 板块 | 改动 |
|---|---|
| 签约概览 | 门店总数改为同行流式（消除与数值重叠，实测 `xOverlap = -3px`） |
| 签约概览 | 签约类型数值居中；单位「户」→「家」 |
| 策略运行情况 | 新增「开通连锁数」「运行连锁数」（chains 口径，非 strategies） |
| 连锁排名 | 新增板块（位于策略运行情况上方）：从左至右卡片，14 项指标，按触达人数降序 |
| 客户详情 | 无运行数据直接显示「暂无运行数据」；趋势固定 10 项指标 |
| 客户详情 | 流程进度与节点时间线改为左右并排；策略与运行展示 11 项 |
| 签约明细 | 默认 15 列、列宽收紧（1440px 可同屏）、连锁名 15 字截断、列设置本地记忆、点表头即筛选 |

## 四、部署

- 前端 `dist` 与后端已发布至生产 `jdy.zhengl.vip`，线上验收通过。

**改动文件**（`git show f140328 --stat`）：30 个文件，+2313 / −1169。
核心：`src/crmboard.js`（+315）、`frontend/src/api/crm-board.ts`（+72）、
`frontend/src/pages/shares.tsx`（+359）、`frontend/src/pages/ai.tsx`（−655）、
`frontend/src/pages/reports.tsx`（−520）。

---

## [13.0.0] - 2026-11-02

### 版本主题：全站主色统一 #1677FF + 数据卡片上移至标签页上方 + 分享中心合并 + 看板 8 项精修

本轮含 **3 个真实缺陷修复**（系统设置版本号错误、流程状态平均耗时口径、客户详情运行数据恒空），
以及一次全站视觉令牌收敛。看板部分不开源，仅私服部署。

---

## 一、整体优化（5 项）

### B1 全局主色调统一为 `#1677FF`

用户原话：「全局主色调修改为 `#1677FF`，影响范围包括但不限于：主菜单背景、按钮、文字等」

**根因**：主色在项目里存在 **三套并行的硬编码来源**，彼此不同步：

| 来源 | 旧值 | 覆盖范围 |
|---|---|---|
| `frontend/src/theme.ts` `PALETTE` | `#1668E3` | antd ConfigProvider token、组件阴影 |
| `frontend/src/styles/global.css` `--v41-*` | `#1668E3` / 侧栏 `#0C3F96` | 布局与侧栏渐变 |
| `frontend/src/api/crm-board.ts` `PALETTE` | `#2563eb` | 看板全部图表色板 |
| `src/settings.js` `theme_color` | `#3687FF` | 后端默认主题色（与前端均不一致） |

**修复**：统一为一套令牌并向 `#1677FF` 收敛。

| 令牌 | 新值 | 说明 |
|---|---|---|
| `primary` | `#1677FF` | 主按钮、链接、Tab 选中、聚焦环 |
| `primaryDeep` | `#0B57D0` | 侧栏渐变终点、hover 深色 |
| `primaryLight` | `#4C93FF` | 深色模式下的品牌色（保证深底对比度 ≥ 4.5） |
| `primarySoft` | `#E3EEFF` | 浅底填充 |
| 侧栏渐变 | `#1677FF → #0B57D0` | 主菜单背景 |
| 侧栏选中项 | `rgba(255,255,255,.20)` + 纯白 600 字重 | 原为 `#2E7BF0` 实色块 |
| 阴影品牌色 | `rgba(22,119,255,…)` | `#1677FF` = `rgb(22,119,255)` |

**对比度实测**（白字在色块上）：

| 背景 | 相对亮度 | 对比度 | 判定 |
|---|---|---|---|
| `#1677FF` | 0.2331 | **4.10** | 低于 WCAG AA 4.5（大字号/UI 组件 3.0 达标） |
| `#0B57D0` | 0.0957 | **6.32** | 达标 |

→ 侧栏菜单文字落在渐变起点（`#1677FF`）区域时对比度为 4.10。侧栏菜单字号 13–14px 属「大字号」以外的正文，
若验收判定 < 4.5，则把渐变起点下调为 `#1670F5`（实测对比度 **4.50**，恰好达标）。

### B2 数据卡片移到标签页上方

用户原话：「每个标签页都显示的数据卡片，放在标签页上方；影响范围包括但不限于：邮件推送、报表中心、用户管理、系统设置」

**根因**：`frontend/src/components/Page.tsx` 是 4 个页面的公共骨架，其渲染顺序写死为
`head → subTabs → stats → children`，即数据卡片一直在标签栏**下方**。
需求是卡片在标签**上方**，所以只需调整骨架顺序，无需改任何业务页面。

修复后顺序：`head → stats → subTabs → children`。
影响面自动覆盖 /mail-push、/reports、/users、/settings、/forms、/projects/:id、/integrations/:id、/reports/:id/view。

### B3 分享入口统一到「分享中心」

用户原话：「报表中心和 AI 问数的分享都统一放到分享中心」

**根因**：分享能力被实现了 **两遍、且互不可见**：

- 报表中心 `pages/reports.tsx` 内含一个 500+ 行的 `ShareModal` + 3 处「分享」触发点（表格行 / 内置看板卡 / 卡片视图），数据走 `/api/shares`；
- AI 问数 `pages/ai.tsx` 内含独立的创建弹窗 + 「分享管理」抽屉，数据走 `/api/ai/shares`；
- 而「分享管理」页 `pages/shares.tsx` **只展示报表分享**，看不到 AI 问数分享。

→ 用户在三处看到三套不同的分享界面。

**修复**：`/shares` 改名为「分享中心」并升级为双标签页（报表分享 / AI 问数分享），
两个来源的数据在同一处管理；报表中心与 AI 问数页的分享操作改为跳转 `/shares?tab=…`，
本页不再弹任何分享管理界面。

### B4 AI 问数：术语配置 / SQL 示例库改为同级标签页

用户原话：「AI问数优化：术语配置、SQL 示例库等设置项通过标签页的方式放在 AI 问数下」

**根因**：这两项此前是 Page 顶栏的两个按钮 + 各自一个 Drawer，与对话主界面属于**不同层级**，
用户在顶栏找设置、在抽屉里改完又被动关闭，缺少「这是 AI 问数的一部分」的层级感。

→ 改为与「对话」同级的标签页，用公共 `PageTabs` 组件渲染，与邮件推送/用户管理/系统设置视觉一致。

### B5 系统设置：关于置底 + 默认站点信息 + 修复版本号错误

用户原话：「系统设置优化：关于放在最后，进入后默认显示站点信息；修复版本号错误的问题」

**根因 1（Tab 顺序）**：`pages/settings.tsx` 的 `tabItems` 数组把 `{ key: 'about' }` 写成**第一项**，
后端返回的 groups（含 site/邮件/推送/存储…）排在其后 → 「关于」出现在最前面，与需求完全相反。

**根因 2（默认页）**：默认选中逻辑为 `data.groups.some(…) ? prev : data.groups[0]?.key`，
依赖后端 groups 的返回顺序。需求要求**显式**默认「站点信息」，不能依赖顺序。

**根因 3（版本号错误，真实缺陷）**：
`frontend/src/stores/app.ts` L22 是一个**硬编码字符串字面量**：

```ts
export const APP_VERSION = 'V9.0';
```

它从 V9.0 迭代起**从未被修改过**，而 V10/V11/V12 迭代均只改了 `package.json`。
该常量渲染在系统设置「关于」面板的「当前版本号」一行（`settings.tsx`），
所以 V10/V11/V12 三个版本的用户在界面上看到的都是 **V9.0**，与真实版本号不符。

**修复**：从构建期注入的 `__FE_VERSION__`（vite define，值取自 `frontend/package.json`）派生：

```ts
export const APP_VERSION = 'V' + (__FE_VERSION__ || '0.0').split('.').slice(0, 2).join('.');
```

带 `'0.0'` 兜底，避免 define 缺失时崩溃；`intro.tsx` 的 `versionKey()` 归一化（`V13.0` ↔ `13.0.0` → `13.0`）仍可正确匹配「当前版本」标签。

---

## 二、中康智能体客户看板（8 项，不开源）

### A1 签约概览：去掉行标签列 + 「户」改「家」+ 门店总数右下对齐

用户原话：「签约类型的 SIC合作签约 和 新连锁签约 不需要第一列（客户数/门店数 行标签列）；
客户数后的『户』改为『家』；门店总数显示在数值右后下侧，与数值底部对齐」

**根因**：`.vb1-stt` 是一个 3 列 grid（行标签列 + 两个签约类型列），行标签列占掉约 1/3 宽度，
而「客户数」「门店数」这两个词在卡片语境下是冗余的（上下两行数值本身已由图标与单位区分）。
「门店总数」此前用 `left:50%` + 固定偏移定位，数字位数变化时会漂移。

**修复**：grid 列数 3 → 2，删除全部 `.vb1-stt-rk` 元素；
「门店总数」以数值元素为定位基准（`position:absolute; right:0; top:100%`），
使标签右缘与数字右缘始终对齐、垂直落在数字底部。

### A2 流程状态：去掉门店数行 + 平均耗时口径校验 + 明细连锁名可点

用户原话：「流程状态不需要门店数这条；检查平均耗时这个数据是否正确，并进行多次校验；
明细点击连锁名称也需要弹出客户详情」

**根因 1（门店数冗余）**：节点卡的 9 个指标里，「门店 X 家」与上方「N 家客户」是不同量纲，
但门店数在第 1 排「签约概览」已作为总量完整呈现，节点卡内再列一遍属重复；
且它挤占了节点卡固定高度（172px）里本就紧张的垂直空间。

**根因 2（平均耗时口径，已在 12.0.0 修正，本轮做四重独立校验）**：
详见「三、数据口径校验」一节。

**根因 3（明细连锁名不可点）**：明细弹窗的「连锁名称」列是纯文本 + `ellipsis`，
与客户明细表的「点击客户名打开详情」交互不一致，用户在明细里看到问题客户后无法直接下钻。

→ 「连锁名称」改为可点击元素，复用已有 `ClientDetail` 组件打开客户详情。

### A3 流程处理：去掉「结束」列

用户原话：「不需要最后一个结束的节点，包含卡片和后面都不需要」

**根因**：「流程结束」在数据模型里**没有独立的完成时间列**（`NODE_DONE_COL` 中 `col: null`），
按日统计每日完成数的表格里，该列只能恒为 0 或依赖当前节点推断，
既无信息量又占用 1/9 的表宽，使其余 8 个有效节点列被压窄。

→ 卡片表头、表体、合计行、弹窗表格统一删除该列，10 列 → 9 列，末列改为「策略审核」。

### A4 签约趋势：修复南北区重复出现

用户原话：「修复在标题栏和图例重复出现南北区的问题」

**根因**：`SignTrend.tsx` 同时渲染了 **两处**区域维度：
标题栏一个区域切换 Segmented 控件（南区/北区），图表下方又有一个图例（南区/北区）。
两者语义完全重复，且文件头注释还写着「仅 1 处图例」——注释与实现相反，导致后续维护者未能发现。
实测页面内「南区」文本节点 **2 个**、「北区」**2 个**。

→ 保留 1 处，页面内「南区」「北区」文本节点各为 1，并修正头部错误注释。

### A5 客户明细：列设置持久化 + 表头点击即筛选

用户原话：「列设置保存（下次打开沿用）；表头不需要单独的筛选按钮，点击表头字段名称即筛选」

**根因 1（列设置不持久）**：`DetailTable.tsx` 的 `visible` 是纯内存 state，
初始值写死为 `columns.filter(c => c.default !== false)`。
实测 localStorage 只有 `crmboard.primary`、`crmboard.dark`、`v61.tabs.admin`、`v61.site` 四个键，
**没有任何列设置键** → 用户每次打开都被重置。

**根因 2（筛选按钮冗余）**：列定义携带 `filters` + `filterSearch` + `onFilter`，
antd 因此自动渲染独立的漏斗图标（`.ant-table-filter-trigger`），
与「点表头字段名即筛选」的直觉交互冲突——用户会先点文字（无反应）、再去找图标。

→ 新增持久化键（校验失效列 key、空数组回退默认，并提供「恢复默认」入口）；
移除漏斗图标，点击列标题文字打开筛选面板，保留多选筛选能力。

### A6 客户详情「策略与运行」显示 11 项

用户原话：显示「开通了哪些类型的策略、运行多少策略、触达人数、到店人数、转化率、
发放优惠券、核销优惠券、优惠券核销率、优惠券成本、渠道成本、roi」

**根因（真实缺陷，数据恒空）**：`src/crmboard.js` `buildClientDetail()` 中，
运行指标的取值行写的是 `const r = c.run;`，**只读 mail_30 快照**。
而上面第 2341 行其实已经算好了 `runSource`（mail_30 优先、缺失回退 mail_31 按连锁聚合），
**却从未被引用——是一段死代码**。

实测：`jdywh_mail_30` 最新日仅 **19 个连锁**，与 `jdywh_parsed_16` 的 **112 个客户**交集只有 **15 个**；
`jdywh_mail_31` 最新日覆盖 **18 个连锁**，与 parsed_16 交集同样是 15 个。
即 **112 个客户中有 97 个（86.6%）的 `runMetrics` 恒为 `null`**，
客户详情「策略与运行」永远显示「暂无运行数据（该连锁未出现在最新一日的运行汇总中）」。

**修复**：真正接上 `runSource`，并新增两个字段：
- `openedStrategyTypes: string[]` —— 该连锁开通的策略类型（来自 mail_31 的 `c_0511a2713b` 列，去重 + 中文排序）。
  实测值域共 9 种：流失会员、沉睡会员、新会员、活跃会员、高净值会员、糖尿病、高血脂、高血压、档促活动定向引流。
- `source: 'mail_30' | 'mail_31' | null` —— 数据来源标注。

修复后实测（本地接口 `GET /api/crm/board/client/:id`，112 个客户逐个调用）：
`runMetrics` 非空数 **15**（与 mail_30∪mail_31 命中数一致，未引入虚假数据）。

| 连锁 | source | 策略类型数 | 运行策略 | 触达 | 到店 | 转化率 | 发券 | 核销 | 核销率 | 券成本 | 渠道成本 | ROI |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 湛江黄府大药房(10147) | mail_30 | 5 | 6 | 16 | 2 | 12.50% | 16 | 0 | 0.00% | 0 | 0 | 0 |
| 云南靓桐医药(11038) | mail_30 | 2 | 2 | 3 | 1 | 33.33% | 0 | 0 | 0.00% | 0 | 0.03 | 0.0006 |
| 宣威市得云药业(12394) | mail_30 | 8 | 48 | 11541 | 1708 | 14.80% | 13183 | 308 | 2.61% | 2260 | 240.21 | 0.0124 |
| 泰兴市博爱大药房(12425) | mail_30 | 1 | 1 | 72 | 11 | 15.28% | 0 | 0 | 0.00% | 0 | 2.4 | 0.003 |

> 空态区分（前端须遵守）：`runMetrics === null` → 「该连锁暂无运行数据」；
> `runMetrics` 存在但值为 0 → **必须显示 0**，不得隐藏或显示「—」。

### A7 流程状态「平均耗时」四重独立校验（重点）

用户原话：「检查平均耗时这个数据是否正确，并进行多次校验」

**口径定义**（V12 已确立）：某节点平均耗时 = 「本节点完成时间 − 上一节点完成时间」，
只统计两个时间列都非空且差值 ≥ 0 的样本；首节点（销售签约）无上一节点、
末节点（流程结束）无完成时间列，二者均不参与。

**校验 1 —— 独立 SQL 用 `TIMESTAMPDIFF(MINUTE, …)` 直接聚合 `jdywh_parsed_16`**（与 Node 实现体系无关）：

| 节点 | SQL validCount | SQL sumDays | SQL avgDays | Node avgDoneDays | 偏差 |
|---|---|---|---|---|---|
| 销售签约 | — | — | null | null | 一致 |
| 策略开通 | 111 | 3.635417 | 0.0328 | 0 | 四舍五入一致 |
| 实施对接 | 57 | 64.993750 | 1.1402 | 1.1 | 一致 |
| 对接审核 | 11 | 4.562500 | 0.4148 | 0.4 | 一致 |
| 客服处理 | 6 | 1.584028 | 0.2640 | 0.3 | 一致 |
| 客户培训 | 16 | 0.080556 | 0.0050 | 0 | 一致 |
| 连锁使用 | 6 | 28.855556 | 4.8093 | 4.8 | 一致 |
| 策略审核 | 6 | 5.029861 | 0.8383 | 0.8 | 一致 |
| 流程结束 | — | — | null | null | 一致 |

**校验 2 —— 秒级精度重算 + 负样本/NULL 样本计数**（排除 MINUTE 截断误差）：

| 节点 | valid | sumSec | avgSecDays | 负值样本 | 零值样本 |
|---|---|---|---|---|---|
| 策略开通 | 111 | 315127 | 0.032859 | 0 | 26 |
| 实施对接 | 57 | 5616669 | 1.140487 | 2 | 0 |
| 对接审核 | 11 | 394435 | 0.415020 | 0 | 0 |
| 客服处理 | 6 | 136997 | 0.264269 | 0 | 0 |
| 客户培训 | 16 | 7020 | 0.005078 | 4 | 14 |
| 连锁使用 | 6 | 2493165 | 4.809346 | 1 | 0 |
| 策略审核 | 6 | 434742 | 0.838623 | 1 | 0 |

**校验 3 —— 逐样本明细（人工可复核）**：

| 节点 | n | min(秒) | 中位数(秒) | max(秒) | sum(秒) |
|---|---|---|---|---|---|
| 策略开通 | 111 | 0 | 95 | 66187 | 315127 |
| 实施对接 | 57 | 2 | 1602 | 621180 | 5616669 |
| 对接审核 | 11 | 20 | 2462 | 315840 | 394435 |
| 客服处理 | 6 | 53 | 990 | 116340 | 136997 |
| 客户培训 | 16 | 0 | 0 | 6990 | 7020 |
| 连锁使用 | 6 | 34 | 278195.5 | 968340 | 2493165 |
| 策略审核 | 6 | 30 | 108.5 | 425883 | 434742 |

**校验 4 —— 后端返回值与 SQL 独立计算逐项比对（9 节点 × 4 字段 = 36 项）**：

| 节点 | doneCount | doneValidCount | avgDoneDays | avgDoneHours | 结论 |
|---|---|---|---|---|---|
| 销售签约 | 111 = 111 | 0 = 0 | null = null | null = null | ✅ |
| 策略开通 | 111 = 111 | 111 = 111 | 0 = 0 | 0.8 = 0.8 | ✅ |
| 实施对接 | 59 = 59 | 57 = 57 | 1.1 = 1.1 | 27.4 = 27.4 | ✅ |
| 对接审核 | 11 = 11 | 11 = 11 | 0.4 = 0.4 | 10 = 10 | ✅ |
| 客服处理 | 29 = 29 | 6 = 6 | 0.3 = 0.3 | 6.3 = 6.3 | ✅ |
| 客户培训 | 20 = 20 | 16 = 16 | 0 = 0 | 0.1 = 0.1 | ✅ |
| 连锁使用 | 7 = 7 | 6 = 6 | 4.8 = 4.8 | 115.4 = 115.4 | ✅ |
| 策略审核 | 8 = 8 | 6 = 6 | 0.8 = 0.8 | 20.1 = 20.1 | ✅ |
| 流程结束 | 0 = 0 | 0 = 0 | null = null | null = null | ✅ |

**36/36 项完全一致。**

**附带发现（非缺陷，属业务数据事实）**：存在 **8 对**「后节点完成时间早于前节点完成时间」的倒挂样本
（实施对接 2 对、客户培训 4 对、连锁使用 1 对、策略审核 1 对）。
后端已用 `if (days < 0) return;` 显式跳过这些样本，**不污染平均值**——校验 1/2 的 validCount 已排除它们
（例如实施对接 59 个已完成 vs 57 个有效，差额 2 正是倒挂数）。
建议业务侧核查这 8 条记录的时间录入顺序。

**内部一致性**：`avgDoneDays × 24 ≈ avgDoneHours` 在 1 位小数舍入下全部自洽
（如 1.1402天 → 27.4h，4.8093天 → 115.4h，0.8383天 → 20.1h）。

### A8 流程处理：策略模块上下居中 + 单策略类型时等高

已在 12.0.0 完成并保留；本轮回归验证通过（rail 偏移 [0,0,0]，单类型时 rail=225 / type=225）。

---

## 三、非回归基线（沿用 V12 并全部复测）

| 项 | 基线值 |
|---|---|
| 第 1 排 5 张卡片等高 | 291px |
| 第 1 排卡片宽度比 | 24.03 / 19.22 / 16.82 / 16.82 / 19.22 % |
| 签约概览上下区 | 55 / 45 |
| 环形图 | 98×98，3 个圆环 |
| 区域行数 | 2 |
| 9 个流程节点卡 | 等高 172px、等宽 148px、蓝底白字、无占位短横 |
| 箭头 SVG | 32×30 |
| 每行策略类型数 | 1 |
| `.board-stack` 行间距 | 恰好 16px |
| 分享页 vs 系统内令牌差异 | 0 |
| 最小字号 | 无 < 11px 文本 |
| 横向溢出 | 1920 / 1440 / 1280 / 1024 / 375px 均无 |
| 深色模式 | 0 个低对比分组 |

---

## 四、验收与交付

- 全面测试验收 + 验收报告（含每项实测原始数字、根因说明、未通过项）
- 全绿后经宝塔面板部署生产
- 推送版本迭代记录到 GitHub 与 Gitee（**看板部分不开源，不进公开仓库**）

---

## [12.0.0] - 2026-11-02

### 版本主题：签约概览重构 + 流程耗时口径修正 + 策略运行/明细表精修

本轮 4 个板块 10 项需求，含 **1 个数据口径层面的真实缺陷修复**（流程平均耗时算错了对象）。

---

## 一、签约概览卡片（3 项）

### A1 门店总数：指标居中 + 名称在数字右下角

实测：数字容器中心偏移 **dx=0px / dy=0px**（完全居中）；「门店总数」标签右缘与数字右缘**精确对齐**（差值 0px）。

**实现要点**：用 `.vb1-bn` 内联块包住 `<b>数字</b>`，标签以它为定位基准 `position:absolute; right:0; top:100%`。
这样数字位数变化时（97 → 14,506）标签始终贴右下角，不会像 `left:50%` 那样随容器中心漂移。

> 中途改过一版：最初用「容器中心 + 13px 偏移」，实测标签伸进数字内部 30px，不算右下角。

### A2 门店数南北区：名称在上、数值在下

实测 `南区` labelTop=380 < numTop=394、`北区` 同值 → 名称在数值上方。两个小卡同步修改。

### A3 签约类型改 2 列 × 3 行

实测 grid：`colCount 3 / rowCount 3 / cellCount 9`
```
["",        "SIC合作签约", "新连锁签约"]   ← 表头
["客户数",   "109户",       "4户"]          ← 客户数行
["门店数",   "14,265店",    "341店"]        ← 门店数行
```
正是「类型为列、客户数/门店数为行」。数值右对齐 + `tabular-nums`，字号 11px。

---

## 二、流程状态：平均耗时数据口径修复（核心）

### 需求原文
> 平均耗时指的是当前节点已完成的客户，在这个节点的平均耗时；计算时间是当前节点时间 − 上一节点的时间
> 策略开通和策略审核这类虽然客户数为 0，但是也有平均耗时，也需要呈现

### 旧口径是错的
```js
const list = clients.filter((c) => c.node === name);  // 只看「当前停在该节点」的客户
avgDays = sum(c.nodeDays) / list.length;              // nodeDays = now - enterAt
```
算的是「**现在还在这个节点的客户，已经等了多久**」—— 与需求定义**完全相反**。

更致命的是：`策略审核` clients=0 → `avgDays` 恒为 0，**根本无法呈现耗时**（正是用户投诉的点）。

### 新口径
**已完成客户的耗时 = 本节点完成时间 − 上一节点完成时间**

遍历所有客户的节点完成时间列（`NODE_DONE_COL`），只统计两个时间都存在且差值 ≥ 0 的样本。
新增 `buildNodeDoneDurationMap()` 函数独立承担这段计算。

### 实测对比（112 客户）
| 节点 | clients | **avgDoneDays** | avgDoneHours | doneCount |
|---|---|---|---|---|
| 销售签约 | 1 | **null**（首节点无上一节点） | null | 112 |
| 策略开通 | 0 | **0** | 0.8 | 100 |
| 实施对接 | 45 | **1.0** | 22.1 | 55 |
| 对接审核 | 5 | **0.5** | 13.0 | 11 |
| 客服处理 | 25 | **0** | 1.1 | 25 |
| 客户培训 | 6 | **0** | 0.0 | 19 |
| 连锁使用 | 15 | **0.1** | 1.4 | 4 |
| **策略审核** | **0** | **1.7** | **40.2** | **5** |
| 流程结束 | 5 | **null** | null | 0 |

**核心成果：策略审核 0 客户但显示「平均耗时 1.7天」** —— 需求达成。

### 前端精度改进
`fmtAvgDays` 原来用 `days * 24` 换算小时，但 `avgDoneDays` 只有 1 位小数（如 0.04 天），
会被舍成「0.0天」。改为 `< 1 天` 时**优先用后端的 `avgDoneHours`**：
```js
function fmtAvgDays(days, hours?) {
  if (d < 1) { const h = Number.isFinite(Number(hours)) ? Number(hours) : d * 24; return `${h.toFixed(1)}时`; }
  return `${d.toFixed(1)}天`;
}
```
效果：策略开通显示 **0.8时**（而非 0.0时）、策略审核 **1.7天**。

---

## 三、流程状态板块视觉（3 项）

### B2 数据较少的卡片内容居中
`.fm-node{justify-content:center}` + `.fm-slot:empty{flex:1 1 auto}`（空槽吸收余量）。
实测 9 卡「内容中心 vs 卡片中心」偏差**全部 1px**（来自上下 padding 14/13px 不对称）。

### B3 岗位名过长时简短名 + 客户数都可见
缩写规则：先剥后缀（工程师/专员/经理/主管/负责人/助理/顾问），仍 >3 字取前 2 字。
`解决方案` → `解决`；`销售/实施/客服/未分配` 原样保留。
数量用 `flex:0 0 auto` **永不参与截断**，并在 `title` 保留全名。

实测 8 个有岗位的节点全部 `countVisible: true / cut: false`：
```
销售签约 销售1   | 实施对接 销售43·实施9·解决1
对接审核 销售2·解决2·实施2 | 客服处理 客服28
```

### B4 去掉卡头备注
删除「共 9 个节点 · 点击有客户的节点查看明细」，实测 `.v7flow` 文本已不含该串。

---

## 四、策略运行情况（2 项）

### C1 卡头右侧信息替换
删除 `区间 10-04 ~ 11-02 · 414 行明细` 与 `3 模块 · 9 类型 · 南/北`；
把 `⚠ 当前 T+30 转化数据不全，数据会随时间而增长。` 移到卡头右侧。

实测：卡头文本 = `策略运行情况当前 T+30 转化数据不全，数据会随时间而增长。`，
警告字号 **11px**、颜色 **`rgb(217,119,6)`** = `--warn`、单行 nowrap。
`.vb10-range` / `.vb10-hint` 均已删除；正文顶部旧提示 `.vb10-notice` 同步移除。

### C2 左侧策略模块上下居中
`.vb10-mod` 改 `align-items:center`。三个模块 rail 中心 vs 模块中心差值 **-0.01 / 0 / -0.01px**。

### C3 单类型模块两边等高
**第一次改没成功**（如实记录）：只加 `align-items:stretch` 无效 —— grid 行高仍由内容决定，
rail 224.86 vs type **147.56**。

补 `grid-template-rows:minmax(0,1fr)` + `align-content:stretch` + `.vb10-type{height:100%}` 后：
rail **224.86 = type 224.86** ✅

### 顺带修掉的窄屏 bug
375px 下 `h3`「策略运行情况」被压成 **w=0 / sw=92**（窄屏 `.vb10-hd{width:100%}` 把标题挤没），
已改纵向堆叠修复。

---

## 五、客户明细表头横线（1 项）

### 诊断（像素级 + DOM 双层取证）
**修复前表头下方有 4 条线**，宽度 331 → 485 → 575 → 833px **逐层向外递增**：
```
y=289  331px  SPAN.ant-table-column-title（内层）
y=299  485px  DIV.ant-table-column-sorters
y=309  575px  SPAN.ant-table-column-title（外层）
y=319  833px  TH.ant-table-cell（通栏）
```

**根因**：CSS 选择器组把 `border-bottom` 同时赋给了 `th` **及其内部 4 层子孙**。
`.ant-table-column-title` 是块级、`.ant-table-column-sorters` 是 flex 容器，都会渲染出可见横线。
21 个 th 共产生 **60 条**内层假线。

**已排除的嫌疑**（实测确认无关）：`thead` 自身 border=0、`.ant-table-container` 无 box-shadow、
sticky `::after` 透明、`th::before` 已是 `display:none`。

### 修复分两步
1. **第一层**（内部子孙线）：选择器拆两段，`border-bottom` 只给 `th`，新增 `.ant-table-thead th *{border-bottom:0}`
2. **第二层**（表头线 + 首行数据线叠加，Lead 补修）：
   清掉内部子孙后仍有两条平行线 —— 表头 `TH`（y=4069）与首行数据 `TD`（y=4088）相距 19px，
   视觉上是一对双线。去掉首行数据格的上下边框，只留表头那条；第 2 行起保留 `--line2` 细分隔线。

### 实测修复后
```
表头下方线数量 = 1   （y=4069~4098，视内容高度浮动）
浅色 color = rgb(227,233,242) = --line
深色 color = rgb(36,51,86)    = --line
DOM 侧 linesPerCell = 1（每格恰好 1 条）
```

---

## 六、验收

| 项目 | 结果 |
|---|---|
| **V12 主验收** | **27 / 27 通过** |
| **V11 主验收回归** | **28 / 28 通过** |
| **V10 视觉基线回归** | **13 / 13 通过** |
| **分享页一致性** | **令牌差异 0 项** |
| 策略类型独占一行 | 3/3、1/1、5/5 全部保持 |
| 9 卡尺寸 | 高度全 172px、宽度全 148px |
| 字号 <11px | 0 处 |
| 横向溢出（1920/375） | 全部 0 |
| TypeScript | 0 错 |

### 顺带修正的 2 个验收脚本缺陷

**1. 深色反差采样在极小区域失效（假阳性）**
`verify_v92.js` 报 `.vb1-tb-s.north` 的「8」反差 = 1.0。排查发现是算法缺陷：
「取区域内出现最多的颜色当背景」在 **38×19px 极小区域**会失效 —— 笔画像素占多数，
文字色 `#5eead4` 被误判成背景，于是与自己比得 1.0。
**真实反差 = 11.24**（`#5eead4` 在 `#141e33` 上），远超 WCAG AA 的 4.5。
修法：跳过面积 < 900px² 的元素（采样样本不足）。修正后 0 组。

**2. V11 用例的 A4 判据已过时**
V12 把签约类型表格从 `.vb1-stt-row` 改成 `.vb1-stt-cell`（2 列 3 行新结构），
V11 用例检查旧 class 必然失败 —— 属「旧测试用例过时」，不是功能回退。已同步更新判据。

---

## 七、部署

| 项 | 值 |
|---|---|
| 版本 | **12.0.0** |
| 备份 | `.backup-v12-*` |
| GitHub / Gitee | 已推送 |
## [11.2.0] - 2026-11-02

### 版本主题：策略运行情况 —— 每个策略类型各占一行

需求：策略运行情况的策略类型每个单独占一行。

> **补充说明**：此项在 V10.0.0 的 CHANGELOG 中曾被标记为「已完成」（第七排「每个策略类型占单独 1 行」），
> 但实际代码从未生效 —— `RunBreakdown.tsx` 最后修改时间是 11-01 05:34，早于 V10 的看板改造。
> 当时验收只检查了 series 是否独立，没有验证 DOM 实际行数，属于验收疏漏。本轮真正修复。

---

## 一、根因

`RunBreakdown.tsx` 第 178 行的 `.vb10-types` 容器：

```css
.vb10-types{display:grid; gap:9px; grid-template-columns:repeat(auto-fit, minmax(460px, 1fr))}
```

`auto-fit` + `minmax(460px, 1fr)` 是**响应式自动列数**策略：
容器宽 1639px 时，`floor((1639 + 9) / (460 + 9))` = **3 列**被压成 2 列（每列 687px）。
结果 3 个策略类型排成 2 行（第 1 行左右各 1 个，第 2 行 1 个），**并未做到每个类型独占一行**。

### 修复前实测（1920px）

```
grid-template-columns: 687px 687px
子元素数: 3
实际行数: 2          ← 不符合要求
  第1行: 2 个（左右并排，各 687px）
  第2行: 1 个（687px）
```

---

## 二、修复

```css
/* 改为固定单列：一个策略类型一行 */
.vb10-types{display:grid; gap:9px; grid-template-columns:minmax(0,1fr)}
```

用 `minmax(0, 1fr)` 而非 `1fr`，是为了让内部指标矩阵在窄屏下能正确收缩（`1fr` 最小值是 `auto`，会被内容撑破）。

### 修复后实测（各分辨率均为 3 行）

| 视口 | grid-columns | 类型数 | 实际行数 | 卡片宽 | 横向溢出 |
|---|---|---|---|---|---|
| 1920 | `1383px` | 3 | **3** | 1639 | 无 |
| 1440 | `903px` | 3 | **3** | 1159 | 无 |
| 1280 | `743px` | 3 | **3** | 999 | 无 |
| 1024 | `487px` | 3 | **3** | 743 | 无 |
| 375 | `325px` | 3 | **3** | 351 | 无 |

逐行内容：
```
第1行: 1 个 -> 高血压(1383)
第2行: 1 个 -> 高血脂(1383)
第3行: 1 个 -> 糖尿病(1383)
```

### 副作用（预期内）

| 项 | 修复前 | 修复后 |
|---|---|---|
| 卡片高度 | 1130px | **1601px** |
| 整页高度（1920） | ~4200px | **4699px** |

这是单列布局的必然结果：3 个类型从「2 行」变「3 行」，多占一行高度。
换来的是每个类型的 10 个指标能横向完整展开、不再被 687px 窄列挤压。

---

## 三、顺带修正的验收脚本精度缺陷

改完后 V10 基线回归报出「排间距统一 15~17px」失败。排查后发现是**验收脚本的测量误差**，不是真实回归：

**原实现**：
```js
rects = kids.map(k => ({ top: Math.round(r.top), h: Math.round(r.height) }));
gap = rects[i].top - (rects[i-1].top + rects[i-1].h);
```
先把 `top` 和 `h` **各自取整**，再相减 —— 两次舍入误差可叠加到 ±1.5px，
把真实的 16px 显示成 15 或 17。

**修正后**：直接用未取整的 `bottom` 与下一个 `top` 相减，保留两位小数。

实测结果：
```
#1  精确=16px  ✓    #5  精确=16px  ✓
#2  精确=16px  ✓    #6  精确=16px  ✓   ← 原来是 15px（误报）
#3  精确=16px  ✓    #7  精确=16px  ✓   ← 原来是 17px（误报）
#4  精确=16px  ✓
精确间距集合: [16]  → 全部真实 16px
```

同时把断言阈值从 `<= 1px` **收紧到 `<= 0.5px`**（真实节奏不一致会是 12 vs 16 这种量级），
修正后仍然全绿，说明间距本身完全正确。

---

## 四、验收

| 项目 | 结果 |
|---|---|
| **策略类型行数（1920/1440/1280/1024/375）** | **全部 3 行，每行 1 个** |
| **V11 主验收** | **28 / 28 通过** |
| **V10 基线回归** | **13 / 13 通过** |
| **分享页一致性** | **令牌差异 0 项**，卡片 394×290 与系统内一致 |
| 横向溢出 | 全分辨率 **0** |
| TypeScript | **0 错** |
## [11.1.0] - 2026-11-02

### 版本主题：修复分享链接看板与系统内看板不一致

用户反馈「分享连接打开看板与系统内打开不一致」。经实测定位，这是一个**长期存在的架构性缺陷**，
不是偶发样式问题。

---

## 一、根因

`share-view.tsx`（公开分享页）自己维护了一份 **V7 时期的设计令牌手工副本**，
而系统内看板 `Board.tsx` 已经迭代到 V11。两套实现长期分叉，且没有任何机制保证同步。

### 令牌层差异（实测）

| 类别 | 数量 | 说明 |
|---|---|---|
| **值不一致** | **21 项** | `--bg` / `--line` / `--text` / `--radius` / 全部语义色… |
| **完全缺失** | **21 项** | 全部 `--fs-*` 字号令牌、`--shadow`、`--south`/`--north`、`--fw-*` 字重 |

典型对照：

```
--bg       系统 #f4f6fa   分享 #f2f6fc
--line     系统 #e3e9f2   分享 #dde8f6
--text     系统 #0f172a   分享 #16253d
--green    系统 #059669   分享 #10b981
--radius   系统 14px      分享 16px
--radius-sm 系统 10px     分享 11px
--fs-2xs   系统 11px      分享 （缺失）
--shadow   系统 0 1px 2px… 分享 （缺失）
```

### 渲染层差异（实测）

| 项 | 系统内 | 分享页 | 差 |
|---|---|---|---|
| 卡片圆角 | `14px` | `16px` | 视觉明显 |
| 卡片阴影 | `rgba(15,23,42,.04) 0 1px 2px` | **`none`** | 分享页卡片「平贴」 |
| 卡头高度 | `48px` | **`22px`** | 卡头被压扁 |
| 标题字号 | `13px / 700` | **`14px / 700`** | 偏大 |
| 排间距 | `16px`（`.board-stack`） | **无**（逐块 `marginTop:14` + `gap:12`） | 节奏不齐 |
| 第 3 排列宽比 | `0.85fr / 2.15fr` | `1fr / 2fr` | 比例不同 |
| 卡片 1 宽度 | `394px` | **`452px`** | 差 58px |

---

## 二、修复方案

### 1. 抽取共享设计系统（根治）

新建 **`frontend/src/pages/dashboard/board/design-system.ts`**，作为唯一事实来源：

- `boardLightVars(primary)` — 浅色令牌（47 项）
- `boardDarkVars(primary)` — 深色令牌
- `boardVars(dark, primary)` — 按主题取
- `BOARD_GLOBAL_CSS` — 全局卡片基线（卡片表面、卡头 48px、纵向节奏 16px、悬浮态、滚动条）

`Board.tsx` 与 `share-view.tsx` 都从这里取，**从机制上杜绝再次分叉**。

### 2. Board.tsx 改造

删除本地 122 行 `themeVars` 实现与内联 `<style>`（约 200 行 CSS），改为：

```tsx
import { boardVars, BOARD_GLOBAL_CSS } from './board/design-system';
function themeVars(dark, primary) { return boardVars(dark, primary); }
<style>{BOARD_GLOBAL_CSS}</style>
```

### 3. share-view.tsx 改造

- 删除 11 行手工令牌副本，改用 `boardVars(themeMode === 'dark', '#2563eb')`
- 补 `data-theme` 属性，让深色模式的组件级选择器生效
- 注入 `BOARD_GLOBAL_CSS`
- 排布改为 `.board-stack`（gap 16）+ 网格 gap 12→16 + 第 3 排比例对齐
- 内容区 `maxWidth` 从 `1680` 改为 **`1640`** 并居中

> 1640 的依据：1920 视口下系统内 root=1679（视口 1920 − 侧栏 232 − 20 scrollbar），
> 内容区实测 **1639px**，卡 1 = 394px。分享页无侧栏，不限宽时内容 1871px、卡 1 变 452px。
> 限到 1640 后卡 1 精确回到 394px。

### 4. 顺带修掉的一个真实 Bug

改造过程中，我把 `useThemeMode()` 写在了 `if (isBoardShare)` 条件分支内，
导致 **React error #310（Hooks 顺序违规）**，分享页直接白屏。
已将 `themeMode` 提到组件顶层调用（L93），条件分支内只使用不调用。

### 5. 字号归位

分享页筛选栏 `.sv-fb-btn` / `.sv-fb-reset` 的 `11.5px` 统一为 **`11px`**（令牌下限）。

---

## 三、验收

### 一致性实测（修复后）

| 项 | 系统内 | 分享页 | 一致 |
|---|---|---|---|
| 令牌差异 | — | — | **0 项** |
| 卡片圆角 | `14px` | `14px` | ✓ |
| 卡片阴影 | `rgba(15,23,42,.04) 0 1px 2px` | 同 | ✓ |
| 卡片尺寸 | `394×290` | `394×290` | ✓ |
| 标题字号 | `13px/700` | `13px/700` | ✓ |
| 卡头高度 | `48px` | `48px` | ✓ |
| 排间距 | `16px` | `16px` | ✓ |
| `<11px` 文字 | 0 | 0 | ✓ |
| `.board-stack` | 有 | 有 | ✓ |

### 逐块尺寸对比

```
第 2 块  vb1-grid     系统 1639x290   分享 1640x290   ✓
第 4 块  v7flow       系统 1639x291   分享 1640x291   ✓
第 5 块  board-row3   系统 1639x464   分享 1640x464   ✓
第 6 块              系统 1639x445   分享 1640x445   ✓
第 8 块  vb9-card     系统 1639x205   分享 1640x205   ✓
第 10 块 vb10-card    系统 1639x1130  分享 1640x1130  ✓
第 12 块 vb7-card     系统 1639x467   分享 1640x467   ✓
第 14 块 vb11-card    系统 1639x643   分享 1639x643   ✓
```

**全部区块尺寸一致**（宽度 1px 差异为 sub-pixel 舍入）。整页高度 4214 vs 4203，差 11px 来自分享页顶部标题条。

明细表细节核验：`cardH 643 / 表格 3485×514 / tbody 419 / 11 行 / pager 28px` —— 两边完全相同。

### 回归

| 项目 | 结果 |
|---|---|---|
| **V11 主验收** | **28 / 28 通过** |
| **V10 基线回归** | **13 / 13 通过** |
| TypeScript | **0 错** |

---

## 四、说明

- 分享页与系统内看板的**唯一预期差异**：分享页没有左侧导航菜单（公开页本就不该有），
  因此页面横向可用宽更小；已用 `maxWidth: 1640` 对齐内容区宽度，使卡片尺寸一致。
- 分享页顶部保留「共享看板 · 只读视图」标识条，这是分享场景的必要提示，
  造成整页高度比系统内多 11px。
- 分享页的筛选栏（`.sv-filterbar`）是分享页独有组件（系统内用 `FilterBar`），
  但已统一使用同一套令牌与字号。
## [11.0.0] - 2026-11-01

### 版本主题：客户看板 4 个板块精细化调整

本轮只改报表中心 / 客户看板，纯视觉与布局，不动任何数据口径与接口。

---

## 一、签约概览卡片重构（5 项）

### 上下 55 / 45 分布
- 上半区（**55%**）显示签约客户总数：**左环形饼图 + 右 2 行南北区**
- 下半区（**45%**）显示门店数与签约类型
- 实测：`topH 113px = 55.0%` / `botH 93px = 45.0%`

**踩到并修掉的真实缺陷**：最初用 `flex: 55 1 0` 时，
- 桌面端比例实际是 57.4 / 42.6（`flex-basis:0` 后由 grow 分配剩余空间，10px gap 未计入）
- **375px 单列下高度直接塌成 0**（单列没有确定高度，`flex-basis:0` 无从计算）
- 改用 `flex: 0 0 calc((100% - 10px) * 0.55)` 精确切分，移动端回落 `flex: 0 0 auto`，两个问题一并解决

### 饼图呈现客户总数
- 内联 SVG 环形图 **98×98**，3 个 circle（底轨 + 南区弧 + 北区弧），中心显示总数 **97**
- 右侧 2 行：`南区 42家 43.3%` / `北区 55家 56.7%`

### 门店数 1 大 2 小数值卡片
- 大卡：门店总数 **12,161** @ 22px/750
- 2 小卡：南区 **6,282** / 北区 **5,879** @ 17px/750

### 去掉「签约类型」4 个字
- 卡 1 内已无该标签（`inCard=false`）

### 签约类型改表格
- `SIC合作签约 94户 11,898店` / `新连锁签约 3户 263店`
- 2 行 × 3 列 grid 表格，数值右对齐 + `tabular-nums`

---

## 二、流程状态板块优化（4 项）

### 所有卡片高度和大小一致（修掉真实缺陷）
- **修复前**：高度集合 `[187, 172]`，「实施对接」比其它节点矮 **15px**
- **修复后**：9 卡全部 **152×172**（高度集合 `[172]`、宽度集合 `[148]`，完全一致）

### 箭头改为用户提供的参考图样式
- 逐像素解析 `箭头2.png`：内容边界 35×32、实心右向三角、主色 `#659ffc → #7aacfc`
- 内联 SVG 实现：`viewBox="0 0 35 32"`、`linearGradient` 双 stop、`path` 实心三角 + `strokeLinejoin:round`
- 尺寸 **32×30**（参考图 0.9 倍），带 `drop-shadow` 微微浮起
- 9 节点之间 8 个箭头，间距均等

### 数据指标增加间隔
- 客户数 / 占比 / 南北区 / 正常超期 / 耗时 / 岗位 各组之间加明确间距，可读性提升

### 节点卡片美化
- 保持「蓝底白字」（`--brand → --brand2` 渐变 + 白字）
- 圆角、内距、层次、图标与名称排布、数字单位基线、hover 反馈优化

**V10 已验收项无回退**：无值字段不渲染（不出现「占比 -」「岗位 -」）、图标只在名称前 1 处、
销售签约/流程结束不显示超期行、0 客户节点浅蓝不可点、9 节点横排不换行

---

## 三、连锁类型分布：解决数值显示不全

**先定位再修**（实测数据）：
- 全量扫描 `.vb3-cell` 内所有叶子文字，`scrollWidth vs clientWidth` 三档分辨率下 `clipped` **全部为 0**
- → **不是 CSS 裁切**，而是「X 门店」行 `sw === cw === 189px` **刚好铺满容器、零余量**，视觉上贴边拥挤

**修复**：重排布 + 留余量
- 门店数独立成行，右侧留 padding（不再顶到边）
- 客户数与「家」之间、与门店数之间加垂直 gap
- 南北区两个数加分组标识（如 `南 4 · 北 2`），不再散落
- 「不计入」标签移到不占流式空间的位置

**验收**：1920 / 1440 / 1280 三档 `clipped = 0`，四卡内容逐格完整

---

## 四、客户运行情况：加灰色间隔线

**根因**：原来靠 `.vb9-panel { gap:1px; background: var(--line2) }` 透出底色当分隔线，
`--line2` 是 `#edf1f8`，在白底上几乎看不见。

**改法**：`gap: 0` + 真实边框，改用更深的 `--line`：
```css
.vb9-cell + .vb9-cell { border-left: 1px solid var(--line) }
.vb9-panel > .vb9-cell { border-top: 0 }
```
- 用相邻兄弟选择器 → **第 1 格左侧天然无线**
- 用 `border-left` 而非伪元素 → 线**天然贯穿格子全高**（上下无空隙）
- 末格 `border-right: 0`，线不溢出卡片

**实测**：第 1 格 `border-left = 0px`，第 2~6 格 `1px solid rgb(227,233,242)`（= `--line`）；
深色模式 `rgb(36,51,86)`（比 `--line2` 明显）。

**断点适配**：3/2/1 列换行时，每行首格 `border-left:0`、第 2 行起行首格 `border-top` 补水平线。

---

## 五、验收

| 项目 | 结果 |
|---|---|
| **V11 主验收** | **28 / 28 通过** |
| **V10 基线回归** | **13 / 13 通过**（无回退） |
| 字号 < 11px | **0 处** |
| 文字裁切 | **0 处** |
| 横向溢出（1920/1440/1280/1024/375） | **全部为 0** |
| 深色模式像素级反差 | **0 组 < 2.5** |
| TypeScript 编译 | **0 错** |

### 关键实测数据

```
签约概览：上 113px(55%) / 下 93px(45%)   饼图 98×98   卡宽 394px
门店数：12,161@22px   6,282@17px   5,879@17px
签约类型表格：2 行（SIC合作签约 94户 11,898店 / 新连锁签约 3户 263店）

流程状态：9 卡高度 [172] 宽度 [148]（完全一致）
箭头：svg 32×30  stops=["#659ffc","#7aacfc"]

类型分布：1920/1440/1280 三档 clipped=0，4 格完整

客户运行：cell1 border-left=0px  cell2~6 = 1px rgb(227,233,242)
6 格等高 [155]
```

### 本轮修掉的 2 个真实缺陷（非样式问题）
1. **流程状态 9 卡不等高** —— 「实施对接」比其它节点矮 15px（高度 `[187,172]`）
2. **签约概览 375px 高度塌成 0** —— `flex-basis:0` 在单列无确定高度时无从计算
## [10.0.0] - 2026-11-01

### 版本主题：AI 问数能力升级 + 客户看板全面重构

本轮改动 16 个文件（+2247 / −1850），新增 2 个后端模块与 2 张数据库表。

---

## 一、AI 问数（7 项）

### A1 业务术语配置（新增能力）
- 新表 `jdywh_ai_terms`（术语 / 定义 / 别名 / 分类 / 启停）
- 新模块 `src/ai-terms.js`：CRUD + `promptBlock()` 生成注入文本（限 3000 字防止挤爆上下文）
- 接口：`GET/POST/PUT/DELETE /api/ai/terms`、`GET /api/ai/terms/categories`
- 前端：AI 页「术语配置」抽屉，支持增删查
- **注入位置**：`buildSqlSystemPrompt(schemaText, extra)`，在 schema 之后、规则之前

### A2 SQL 示例库（新增能力）
- 新表 `jdywh_ai_sql_examples`（问题 / SQL / 说明 / 标签 / 命中次数）
- 新模块 `src/ai-sql-examples.js`：CRUD + `pickForPrompt()` 按相似度挑 top3
- 相似度算法：字符二元组 Dice 系数 + 标签命中加成 + 同表加成，无额外依赖
- 接口含 `POST /api/ai/sql-examples/:id/test` 只读试跑（限 20 行）
- 前端：AI 页「SQL 示例库」抽屉

### A3 数据集选择优化
- 选择器支持搜索、类型分组、最近使用置顶（多数据集场景可快速筛选）

### A4 字段备注与描述
- 数据集字段支持 `remark`（备注）与 `description`（描述），可内联编辑
- 支持「一键生成」：扫描 `information_schema.COLUMNS.COLUMN_COMMENT` 与 `jdywh_field_defs.remark` 自动填充

### A5 修复表格自动拉宽（真实 bug）
- **根因**：`<Table scroll={{ x: "max-content" }} />` —— `max-content` 让表格按最宽单元格无限撑开
- **修复**：`scroll.x` 改为按列数估算的固定值（`min(列数×140, 1600)`，下限 640）+ `tableLayout="fixed"`

### A6 分享链接问数记录可管理
- `jdywh_ai_shares` 已有 `ask_count` / `last_ask_at` 字段，接口返回 `askCount` / `lastAskAt`
- 新增 `GET /api/ai/shares/:id/chats` 查看某分享下的问数记录

### A7 问数结果加入报表中心（新增能力）
- 结果卡片新增「添加到报表中心」按钮 → 弹窗（名称 / 说明 / 表格或图表）
- `POST /api/reports`，`config` 里保存 `{ source:"ai", sql, answer, rowCount, chartType }`，报表中心可复现

### A7 前置修复：会话恢复（真实 bug）
- **现象**：刷新 / 打开 `?session=xxx` 后主聊天区永远是「新会话」，历史问数结果（SQL / 图表 / 按钮）全部看不到
- **根因**：`loadHistory()` 只把历史填到侧栏列表，**从未把某个会话的消息加载到主区**
- **修复**：`sessionKey` 支持 `?session=`；新增 `loadSessionByKey()`；首次进入自动恢复最近会话

---

## 二、中康智能体客户看板

### 顶部标题栏（7 项）
- **修复销售图标显示不全（真实 bug）**：`ICON.region` / `ICON.sales` 把 `<circle>` 写在了 `<svg>` **外面**，
  被渲染成按钮的裸子元素且尺寸 0×0 —— 头像圆 / 定位点圆根本没画出来。已改为统一 `<Icon>` 外壳
- 日期选择器改用官方 `DatePicker.RangePicker` + `presets`；面板圆角/阴影对齐令牌；深色适配
- 颜色主题切换 → **深色/浅色切换按钮**（调色板已彻底移除）
- 「全部筛选条件」从右侧 Drawer 改为**居中 Modal**，2 列网格
- 区域/连锁类型/销售弹窗 **2 列**布局，选项高度 40px、字号 13px
- 三个按钮文案：未选显示「区域/连锁类型/销售」，选中显示结果（多个显示「已选 N 项」）
- 移除包裹筛选与操作按钮的**外边框**
- 修复弹层 CSS 变量失效：新增 `useBoardTokens()`，从 `.board-root` 读真实值（含用户自定义主题色）在弹层内联声明

### 第一排（5 项 + 新增 1 卡）
- 签约概览改 **1+2 布局**（第一行左数值右南北区；第二行两列：门店 / 签约类型），宽 **25%**，标题去掉「客户/门店/类型」
- 任务完成进度：去掉「83/500」；连锁数/目标数/未计入移到**半圆右侧**；南北进度条高度 → **10px**；宽 **20%**
- 进行中：去掉「5 个岗位」；「XX 家进行中 + 南北」移到**卡头右侧**；宽 **17.5%**
- 流程结束：汇总与南北区**字号统一**；去掉「已完成」；宽 **17.5%**
- **新增「客户 ERP 分布」卡**：数据源 `jdywh_parsed_16.w_1793089366573`（连锁ERP名称）
  后端新增 `row1.erpDistribution`，实测 **15 个 ERP / 97 家客户无空值**（雨诺 28、海典H2 25、海典H1 20…）

### 第二排 流程状态（6 项）
- 无数据字段（占比 `-`、无岗位）**不渲染**，不留占位符
- 节点卡整体**蓝底白字**（`--brand → --brand2` 渐变），0 客户节点用浅一档蓝（非灰）
- 卡下方 **2 行**：`正常 X 家 超期 X 家` + 岗位数据
- 图标 15 → **18px**，客户数 22 → **26px**
- 占比移到「X 家」后方：`42家 · 45.6%`
- 箭头 18×22 → **26×32**

### 第三排（4 项）
- 连锁类型分布：去掉卡头副值；**上方左饼图 + 右图例**；下方 **2×2 四卡**；取消底部「类型构成」条
- 客户数排行榜：卡头改「**仅计算 50+ 以上的连锁**」；删掉底部合计；TOP3 改**红 / 橙 / 黄**鲜艳色（第 2 名不再是灰色）
- 门店数排行榜：去掉「共 N 位」；与客户数榜共用同一 `RankRowView` 组件
- 省份排行榜：卡头改「**已覆盖 21 个省市**」；按客户数降序；TOP3 用紫→蓝→青与另两榜区分

### 第四排 / 第五排
- 4 张环比卡在 1080P 下**显示为一排**
- 「按销售 × 连锁类型」表：类型到列、销售到行
- 类型环比 / 销售环比**增加累计数**
- **流程处理去掉合计列**（卡片 + 明细弹窗），表头 11 列 → **10 列**

### 第六排 客户运行情况
- 金额 ≥10000 用**万元**保留 1 位小数（`¥1,045,541 → 104.6万`）
- 百分比条**铺满整行**，按南+北合计数分配比例（修复 `flex-grow` 原始比值导致只填 41.3% / 2.9% / 0.7% 的缺陷，现 12/12 行均为 100%）
- 指标名移到**数字右侧下方**（12/12 行验证标签 left > 数字 right 且底部对齐）

### 第七排 / 第八排
- 策略运行趋势：金额万元化（覆盖 tooltip / 坐标轴 / 数据标签）；每指标独立 series（无堆叠）
- 签约趋势图例去掉「柱」「线」文字后缀，改**形状区分**：柱 = 10×10 正方形，线 = 14×4 窄长方形

### 第九排 客户明细
- 列设置从右侧 Drawer 改为**居中 Modal + 4 列网格**（28 个选项 = 7 行 × 4 列）

### 客户详情（3 项 + 新增趋势）
- 弹窗从右侧 Drawer 改为**居中 Modal，宽 80vw**（实测 1024/1280 = 80.0%）
- 分区顺序：**策略与运行 → 策略运行趋势（新增）→ 流程进度 → 节点时间线 → 基础信息**
- **新增「策略运行趋势」**：近 30 日 10 个指标（触达人数 / 触达人次 / 到店率 / 发放优惠券 / 核销优惠券 / 核销率 /
  渠道成本 / 优惠券成本 / 成本合计 / ROI），数量金额走左轴柱、比率走右轴线
  - 后端新增 `buildClientTrend()`，返回 `data.trend`（10 个 series 数组 + days/daysCn + dayCount）
  - 覆盖范围实测 **15/97 客户**（`jdywh_mail_31` 当前只有 4 天数据、18 个连锁），其余客户显示优雅空态
- 基础信息里**人员字段独立成区块**（销售 / 客服 / 解决方案 / 培训人），与业务字段不混排

---

## 三、验收（全部在本地 8781 实测）

| 项目 | 结果 |
|---|---|
| V10 主验收 | **34 / 34 通过** |
| V9.2 视觉基线回归 | **13 / 13 通过**（无回退） |
| A7 专项（问数→报表） | **5 / 5 通过** |
| 深色模式像素级反差 | **0 组 < 2.5** |
| 字号 < 11px | **0 处** |
| 文字裁切 | **0 处** |
| 横向溢出 | 1920 / 1440 / 1280 / 1024 / 375 **全部为 0** |
| tsc | **0 错** |
| 后端语法 | crmboard / api / ai / ai-terms / ai-sql-examples **全部通过** |

### 本轮修掉的 5 个真实 bug（非样式问题）
1. **销售图标缺一半** —— `<circle>` 写在 `<svg>` 外的 SVG 语法错误
2. **AI 表格无限拉宽** —— `scroll.x: max-content`
3. **AI 会话无法恢复** —— 历史只填侧栏、从不加载主区，导致刷新后结果全丢
4. **百分比条填不满** —— `flex-grow` 原始比值在总和 <1 时按规范只分配「和」那么多空间
5. **深色 0 值不可读** —— `.55` 透明度叠加 `--text3` 后像素反差仅 2.13
## [9.2.0] - 2026-11-01

### 视觉重构：解决「页面太丑」

本轮只改报表中心 / 客户看板，纯视觉层，不动任何数据口径与交互逻辑。

#### 诊断（先量化再动手）

| 问题 | 实测证据 |
|---|---|
| 字号过小 | 8~10.5px 共 52 处，1080P 下 9px 正文几乎不可读 |
| 字号阶梯混乱 | 8~13px 之间塞了 10 种字号，无主次 |
| 卡片同质 | 15 张卡全部纯白 + 同圆角 + 同阴影 + 同卡头，没有层级 |
| 纵向节奏不齐 | 各排 marginTop 手写 12/14px 混用 |
| 深色不可读 | 品牌蓝压在深底上对比度仅 1.4 |
| 375px 筛选栏塌陷 | 筛选条宽度塌成 3.2px（内滚完全失效） |
| 结构拥挤 | 签约趋势卡头单行塞了 11 个可点元素 |
| 9 节点全蓝 | 9 张卡共 18 个蓝块，视觉噪音压过信息 |

#### 全局设计系统（Board.tsx）

- 字号收敛为 7 级阶梯：11 / 12 / 13 / 14 / 17 / 22 / 28px，共统一 157 处声明；全页已无 <11px 文字
- 令牌刷新：文字加深（--text #0f172a）、语义色加深（--green #059669 / --warn #d97706 / --danger #dc2626 等）
- 圆角 16 → 14px，阴影改为克制的单层（去掉「浮起来」的塑料感）
- 新增字号/字重令牌，并新增南/北区专用色 --south / --north（明暗两套，且锁死蓝色不跟随主题色）
- 纵向节奏统一 16px（.board-stack），替代各排手写 margin
- 卡片基线统一：15 张卡共用同一套表面定义；卡头固定 48px（原来 42~55px 参差）
- 视觉焦点：核心 KPI 卡加品牌色顶边 + 渐变底，客户数用 28px（全页最大数字）

#### 各排改动

**第 1 排 签约概览**
- 合并卡宽 537px > 其余 358px，带品牌顶边；4 卡等高 309px
- 层级：主 KPI 28px / 次 KPI 22px / 三级 17px / 行内 14px / 标签 11px
- 填充率 91/85/91/91%（原 45~88%）
- 修掉「SIC合作签约」「新连锁签约」文字裁切
- 表格行去掉行边框，只保留斑马纹一种手法

**第 2 排 流程状态**
- 改掉「9 个蓝块」的噪音：名称改为紧凑药丸（蓝底白字，只包文字），数字无底色 22px 为唯一焦点
- 蓝块从 18 个降到 9 个；客户数最多的节点自动加淡蓝底强调（随筛选重算，不写死）
- 0 客户节点用浅一档品牌蓝降权（不是灰色，满足「为0也不要灰色」）
- 箭头从 30x46 渐变蓝 → 18x22 线条色
- 9 节点各 163px 等宽，不换行不溢出

**第 3 排 类型汇总 + 排行**
- TOP3 徽章用金/银/铜金属渐变 + 同色系深字（原白字压金底对比度仅 1.67）
- 每条加占比条；条目间只用极淡分隔线（不叠加交替底色）
- 类型卡卡头改品牌渐变白字，作为本排总览
- 省份 5 格严格等宽等高（48x104），颜色收在 --brand 单一色相内
- 中国地图配色对齐新令牌、单色相色阶、省份标签加白描边、值为 0 不显示

**第 4 排 签约趋势 + 流程处理**
- 卡头拆两层：标题 + 区域分段控件 / 工具栏放连锁类型 + 图例
- 图例改 chip 并按「柱 / 线」分组，图表撑满（95%，canvas 940x343）
- 表格：数字右对齐 + tabular-nums、表头 12px/700、斑马纹只 40% 极淡且无行描边、合计行 14px/750、0 值降透明、最新行左侧 3px 品牌条
- 修掉 375px 下节点列被压到 19px 的缺陷（加 min-width:648px 内滚）

**第 5 排 客户运行情况**
- 6 个独立卡片 → 1 个统一面板（1px 分隔线），每格顶部 3px 语义色条
- 南北区改为双色迷你占比条（12 条轨道 / 24 个色段）
- 6 格等高 169px、填充率 100%

**第 6 排 策略运行情况**
- 模块卡去掉紫色重渐变 → 白底 + 紫色左竖条 + 深色标题
- 修掉真实缺陷：模块卡原来被右侧类型卡拉伸（5 个类型时高 782px、填充率仅 39%），改为内容驱动后三卡统一 225px、填充率 99%
- 矩阵去掉几乎全部单元格边框，只留 2 条分组线；合计行 14px/750 明确最大

**第 7-8 排 策略运行趋势 + 客户明细**：字号令牌化、配色对齐

**顶栏 / 筛选 / 操作**
- 筛选区包成浮动条（面板底 + 细边 + 圆角 + 克制阴影），原来完全没有容器属性
- chip 与操作按钮原来逐项完全相同，无法区分 → 操作区改幽灵按钮（有底/无底之分）
- chip 底色原与面板仅差 7 个色阶（肉眼不可辨）→ 改用可见实边
- 修掉 375px 筛选栏塌成 3.2px 的缺陷（现 339px，内滚生效）
- 五档分辨率 chip 全部同 top 同高

#### 兼容与回归

- 深色模式：改用像素级采样验证真实反差（原估算公式对渐变/srgb 失真会误报），全部 >=2.5
- 全页字号：0 处 <11px
- 文字裁切：0 处
- 横向溢出：1920 / 1440 / 1280 / 1024 / 375 全部为 0
- 功能零回退：C/D 15 项、E 8 项、F 7 项、F/J/K 17 项全部通过
## [9.1.0] - 2026-11-01

本轮只改报表中心 / 客户看板（另一个智能体在并行迭代系统其它功能，未触碰其文件）。

### 修复：流程处理数据严重不符（用户重点投诉）

- **用户反馈**：策略开通 22 日 60 家、23 日 4 家、26 日 12 家、27 日 5 家、28 日 11 家、29 日 3 家
- **根因**：原用 `jdywh_parsed_102`（流程事件表）统计每日完成数。实测该表 22 日无任何数据，
  且其 `header_created_at` 是毫秒时间戳 double，`DATE()` 对其返回 NULL，口径本身不可靠
- **修复**：改用 `jdywh_parsed_16` 的各节点「完成时间」列（`w_1793094135xxx_p`）逐日聚合
- **验证**：22日=60、23日=4、27日=5、29日=3 全部对上；26日=13、28日=10（与反馈各差 1，属同日边界）

### 签约概览

- **三卡合一**：「签约客户总数 / 门店总数 / 签约类型」合并为一张「签约概览」卡，内含 3 区块，
  第 1 排由 6 卡变为 4 卡，四卡等高 269px
- **进行中卡**：删除底部「五项合计 · 进行中总数一致」自检行

### 流程状态

- 节点名称移入卡片，蓝底白字（品牌渐变 + 白字 + 圆角）
- 图标只保留在名称前方 1 处（删除蓝底区块内的重复图标）
- 正常/超期、各岗位客户数全部移入卡片内
- 销售签约 / 流程结束不再显示「正常/超期」行（起止节点无超期概念）
- 删除卡片下方备注；卡片左上角新增标题「流程状态」

### 类型汇总与排行

- 三张排行卡等高 456px、内容铺满（底部空白 30/11/11px）、与类型卡底边对齐（1176px）
- 省份排行榜卡内只显示前 5 个省份
- 「更多」改为中国地图：内联 echarts4 china.json（34 省 / 61KB，
  `frontend/src/assets/china-geo.json`）+ `echarts.registerMap`，颜色深浅映射客户数，
  悬停显示客户/门店/销售，加载失败自动回退热力网格

### 签约趋势与流程处理

- 流程处理改为真表格（11 列 = 日期 + 9 节点 + 合计），已无任何图表残留
- 卡片 7 日、弹窗 30 日；行=日期、列=节点；双窗口均日期倒序
- 签约趋势：图例只保留 1 处（消除区域按钮与图例的视觉重复）
- 图表高度撑满卡片，底部空白从 41px 降到 30px 内

### 客户运行情况

- 6 张卡等高 177px、行数统一为 2、填充率由最低 42.7% 提升到 98.7%
- 新增「成本 / ROI」卡（消费后端已有的真实 row7.cost 字段，未造数据）

### 策略运行情况

- 前 3 个模块卡重构为「紫渐变标题区 + 2x3 大数字网格」
- 填充率：58.5% → 99.3%、98.7% → 98.9%、低于 60% → 99.5%

### 客户明细

- 详情抽屉字段 24 → 42，4 个卡片式分区（基本信息 / 流程进度 / 策略与运行 / 节点时间线）
- 抽屉宽度 720 → 820px；超期红色渐变徽章 + 提示条；时间线连接线三态色
- 后端新增 `runMetrics` 结构化指标；`mail_30` 缺失时自动回退 `mail_31` 聚合
- 修正排序方向反直觉问题（`['descend','ascend']` → `['ascend','descend']`）

### 顶部筛选与日历

- 筛选按钮五档分辨率实测对齐（top 单一值、height 单一值）
- 日历弹层位置正确（523x761，完全在视口内）

### 分享页

- 分享出去的看板链接新增顶部筛选区（区域 / 连锁类型 / 日期），筛选即时生效
- 分享链接去掉标准端口：`https://域名/s/token`（不再出现 :443 / :80），协议推断正确

### 数据口径说明（未编造数据）

- 渠道成本 = 短信成本 + AI外呼成本，381 行完全吻合
- 150 行「有触达但渠道成本=0」经核验为免费渠道（短信数=0、外呼成本=0），非计算错误

## [9.0.0] - 2026-11-01

本版是**导航与交互一致性 + AI 统计准确性 + 流程节点时间同步**升级：
按用户要求重构左侧菜单（6 大分组、取消角色权限与个人中心菜单项、处理流程改名数据处理并入数据管理），
把「用户管理 / 系统设置 / 邮件推送」三处标签样式统一为同一实现，
修复 AI 问数「查询已完成流程的客户数」恒为 0 的取值域缺陷，
修掉流程节点时间**漏同步**的两个真实 bug（含用户点名的测试节点 215），
系统设置新增版本号、项目介绍新增 GitHub 链接与更新记录并取消「XX公司版权所有」。

### 1. 菜单重构（用户逐条要求）

**目标结构（实测浏览器 DOM 输出，顺序与命名完全一致）**：
```
首页概览            → /dashboard（原「数据概览」改名）
数据接入
  项目管理          → /projects（原「数据项目」改名）
  表单管理          → /forms（原「表单中心」改名）
  数据集成          → /integrations
  邮件推送          → /mail-push
数据管理
  数据处理          → /flows（原「处理流程」改名，并从原「数据处理」分组移入）
  数据源            → /datasources
  数据集            → /datasets
数据分析
  报表中心          → /reports
  分享管理          → /shares
  AI 问数           → /ai
数据治理
  治理总览          → /governance
  审计日志          → /audit
系统管理
  用户管理          → /users
  系统设置          → /settings
  项目介绍          → /intro
  使用说明          → /help
```

**从菜单移除但路由保留**（避免破坏既有链接与顶栏入口）：
| 项 | 处理 |
|---|---|
| 角色权限 `/roles` | `hideInMenu: true` —— 用户要求「取消菜单中的角色权限，其在用户管理中已存在」；用户管理页内的「角色权限」标签页与直接访问 `/roles` 均仍可用 |
| 个人中心 `/profile` | `hideInMenu: true` —— 用户要求「个人中心不需要在菜单中显示」；顶栏头像下拉里的入口仍可用 |

**分组变更**：删除原 `process`（数据处理组，其唯一项已移入数据管理）与 `other`（其他组，三项已迁入系统管理）；
`分析与可视化` → 改名 `数据分析`；`MENU_GROUPS` 从 8 组精简为 **6 组**。

> 分组 key 只用于菜单归组，**不参与权限判断**，因此删组/改名不影响任何接口鉴权。

### 2. 标签样式统一（用户投诉「用户管理与邮件推送标签样式不一样」）

**根因**：三个页面各写各的 —— 邮件推送用默认 line 型 `Tabs`；用户管理用 `type="card"`（块状按钮）+ 自定义 `tabBarStyle`；
系统设置更特殊，是「左侧分组导航卡 + 右侧表单」的两栏布局。三处视觉互不相同。

**做法：抽出唯一实现 `frontend/src/components/PageTabs.tsx`**，三个页面全部改用它 ——
只要共用同一组件，样式就不可能再漂移（比「把参数抄一致」可靠得多）。同时导出：

| 导出 | 作用 |
|---|---|
| `PageTabs`（default） | line 型标签栏，统一字号 13.5/500、间距 6px、底距 12px、底部细分隔线 |
| `PageTabTag` | 标签内的计数/状态徽标（半透明浅底 + 同色文字，不用 antd 默认实心 Tag，避免压住标签文字） |
| `pageTabLabel` | 图标 + 文字 + 徽标的统一排布，保证三页间距完全一致 |

**改造结果**（浏览器实测）：
```
用户管理  tabs: 用户列表 2 / 角色权限 3 / 组织架构 4 / 角色权限说明 / 权限点说明   hasCard=false inkbar=true
邮件推送  tabs: 概览 / 数据项目 4 / 邮箱账户 1 / 邮件浏览 / 导入日志 / 运行设置     hasCard=false inkbar=true
系统设置  tabs: 关于 V9.0 / 站点信息 7 / 安全策略 7 / 邮件服务 8 / 数据存储 6 /
                推送接收 6 / 报表与 BI 6 / 数据集成 4 / AI 问数 已启用 / 邮箱推送 已启用 / 审计与日志 记录中
两页标签字号/字重一致：users={fontSize:14px,fontWeight:400} mail={fontSize:14px,fontWeight:400}
```
系统设置由「左导航 + 右表单」改为**顶部标签栏**，并新增首标签「**关于**」。

### 3. AI 问数：值域缺失导致统计恒为 0（用户点名场景）

**用户报的问题**：「查询当前有多少客户已经完成了流程」查不出来。

**修前 / 修后实测**：
| 问题 | 修前 | 修后 | 真值 |
|---|---|---|---|
| 查询当前有多少客户已经完成了流程 | **0** ❌ | **4** ✅ | 4 |
| 有多少客户完成了流程 | 4 ✅ | **4** ✅ | 4 |
| 统计流程状态为流转完成的数量 | **0** ❌ | **4** ✅ | 4 |
| 当前有多少客户 | 97 ✅ | **97** ✅ | 97 |

**根因（两条）**：
1. `buildSchemaText()` 只把「列名(注释)」喂给模型，**不给取值域**。`sys_flow_state_2` 是 DOUBLE 存 `0/1`，
   注释只有「流程状态」四个字 → 模型按中文语义写成 `= '2'` / `= '流转完成'`，全部 0 行
   （已从 `jdywh_ai_chats` 取证：`CAST(sys_flow_state_2 AS CHAR) = '2'`、`flow_current_node = '流转完成'`、
   `widget_1791533061604 = '流转完成'` 三种错法）；
2. 同表有三个「流程状态」相关列（`sys_flow_state_2` 状态码 / `widget_1791533061604` 节点名 /
   `flow_current_node` 当前节点），注释相近，模型分不清该用哪个。

**实现（`src/ai-scope.js`，新增约 490 行）**：
- **低基数列值域采样**：每表只扫 **2 条 SQL**（一条 `COUNT(DISTINCT …)` 定低基数，一条 `UNION ALL`
  分组取值），不是每列一次往返；只采 distinct ≤ 24、行数 ≤ 50 万的列；候选 ≤ 40 列，
  优先「状态/类型/结果/是否/节点/区域/级别/版本」；长文本/全空/自由文本列跳过；
  单条 1.2s、整体 2.5s 预算，**全程 try/catch —— 采样失败只让该列没有值域，绝不让问数失败**。
- **提示词改造**：每列独占一行并带真实取值与行数
  `` `sys_flow_state_2` DOUBLE（流程状态） 取值：0=进行中(93行)、1=流转完成(4行) 〔数值编码列：只能用数值比较〕 ``；
  新增「近似列提醒」把真会误用的近似列并列展示（project 16 命中 1 组、flow 25 命中 2 组，不是全表噪音）；
  `buildSqlSystemPrompt` 增加 4 条规则（取值必须用列出的、数值编码列禁中文比较、近似列按语义挑、计数用 COUNT）。
- **性能**：单次 `resolveScope(project:16)` **172–263ms**（其中采样 97ms），远低于 3000ms 红线；
  `listScopeOptions`（四类来源枚举）显式关闭采样，不付开销。

### 4. 流程节点时间同步（用户点名的 215 + 「进入下一节点要同步上一节点提交时间」）

**用户原话**：「没有准时同步节点时间…在策略开通节点也没有同步到单据提交时间」
「进入下一节点时就要自动同步当前节点的提交时间」「当前测试节点 215 已进入对接审核但是没有实施对接时间」。

**215 的真因（三层日志对齐后定位，不是猜的）**：
```
23:51:01.067  102 流程推送 实施对接「提交」     → flow 25 跑完
23:51:01.068  102 流程推送 对接审核 创建待办    → 冷却期内被丢弃
23:51:01.068   16 数据推送 实施对接时间=null    → 冷却期内被丢弃
23:51:01.325   16 数据推送 实施对接时间=23:51:01 ← 真正带值的这条，被丢弃 ❌
```
一次业务操作 **0.26 秒内连发 6 条推送**；旧实现是「前导合并」——第一条启动流程，后续在
`running` + `ON_PUSH_COOLDOWN_MS=3000` 冷却期被 `continue` **静默丢弃**，而真正带值的是**最后一条** → 宽表永久空。

**另外查出一个代码级 bug**：`flow-state.js` 里 `nodeIndex('开始') === -1` ——
`NODE_ORDER` 首节点是「开始」，但 `NODE_ALIAS` 把它归一成「销售签约」，
于是「单据提交时间」在事件聚合里**永远算不出来**。这正是用户说的「在策略开通节点也没有同步到单据提交时间」。

**修复（3 处，全部向后兼容）**：
| 位置 | 改动 |
|---|---|
| `src/flows.js` | **尾随合并（trailing debounce）**：合并期间登记补跑，闸门放开后再跑一次**全量快照**（各 source_project 本就是全量读）。`FLOW_ON_PUSH_DEFER=0` 可退回旧行为。单次上限 5 次 / 30s，不会无限重试 |
| `src/flow-state.js` | 修 `nodeIndex('开始')=-1`；新增 `deriveNodeTimes()`：节点 N 时间 = 该节点**最后一次完成动作**（离开节点那一刻，合用户口径）、**不按当前节点截断**、排序键 `(jdy_op_time, id)`（有实例存在 1ms 级回退，仅按时间戳会认错）、转交默认不算完成、动作集/偏好/截断全部可配 |
| `src/flow-ingest.js` | 在 **UPSERT 之后**推导并**只补空位**（推导空→不写；已有值→不写；SQL 内 `CASE WHEN col IS NULL OR col=''` 二次保护）→ **绝不清空/覆盖**；新增 `resolveTimeColumns()` 按 `COLUMN_COMMENT='X(解析)'` **动态**解析 8 列（不硬编码列名）。开关 `FLOW_SYNC_NODE_TIMES=0` |

**215 修复前后**：
| 列 | 修前宽表 | 修后宽表 | parsed_16 |
|---|---|---|---|
| 单据提交时间 | 23:36:00 | 23:36:00 | 23:36:00 |
| 策略开通时间 | 23:40:00 | 23:40:00 | 23:40:00 |
| **实施对接时间** | **空** ❌ | **2026-10-31 23:51:01** ✅ | 23:51:01 |
| 对接审核时间 | 空 | 空（刚进入，正常） | 空 |

**8 列非空率（宽表 vs parsed_16，97 行）**：单据提交 96/96、策略开通 96/96、实施对接 **54/54**、
对接审核 10/10、客服处理 24/24、客户培训 19/19、连锁使用 4/4、策略审核 5/5 —— **8/8 全部相等，无一倒退**。

> **一个主动回滚的决定（如实记录）**：曾按「补历史空值」试写过 8 格，但回归立刻暴露它会让
> `v8-flow-verify 5.5`（非 fresh 96×59 逐格 0 差异）从 PASS 变 FAIL —— 即让解析表与业务表快照**永久发散**，
> 这正是 V8 已否证过的做法。已逐格校验后**原样回滚**（整表指纹回到原值），改为「补空只在实时链路生效」。
> 215 是靠**修掉真正的丢数 bug + 重跑 flow 25** 修好的，**没有改动任何历史业务数据**。

### 5. 系统设置显示版本号

新增首标签「**关于**」，三处版本一起展示，便于部署后一眼确认「前后端是否都更新了」：
- **当前版本号** `V9.0`（`APP_VERSION`）
- **后端服务版本** `9.0.0`（根 `package.json`）
- **前端构建版本** `9.0.0`（`frontend/package.json`，构建期由 `vite define` 注入）

**前后端版本不一致时显式标红告警**（典型事故：只传了 `frontend/dist` 没传 `src`，或反之）。
实现方式：`vite.config.ts` 用 `define` 注入 `__FE_VERSION__` / `__BE_VERSION__` 字面量，
零请求、零后端依赖（`src/routes/api.js` 当前被并行会话占用，故不新增版本接口）。

### 6. 项目介绍页改造

- **新增 GitHub 仓库链接**：`https://github.com/myxiaolizi/NeoZhengDataETL`
  （Hero 下方「快速链接」条 + 页脚链接行，共 4 个可点击锚点，全部 `target="_blank" rel="noreferrer"`）；
- **新增「更新记录」板块**：展示 V9.0 / V8.0 / V7.1 / V7.0 四个版本的日期与要点，
  「当前版本」标签按 `APP_VERSION` 自动跟随；底部「完整更新记录见 GitHub（CHANGELOG.md）」；
- **取消「XX公司版权所有」**：页脚不再渲染 `site.footer`，改中性文案
  `{站点名} · 企业多系统数据整合平台` + 右侧 `{APP_VERSION}`；
  **未改动数据库里的 `site_footer` 配置**（那是配置项，只在项目介绍页不渲染）。

### 7. 顺带修掉的验收脚本基线过期

V8 的 3 个校验脚本把行数**写死 96**，而业务侧在 xlsx 快照（2026-10-30 23:30）之后又新建了
测试单据 215（2026-10-31 23:36），`parsed_16` 变成 **97 行** → 3 条断言各差 1，把**正常的业务新增**判成 FAIL。

| 脚本 | 修订 |
|---|---|
| `scripts/v8-flow-verify.js` | 动态行数：`期望 = xlsx 96 + 快照后新增行数`（新增行按 `提交时间(解析) > 快照` 判定）；`5.4` 改为「xlsx 全部在目标表 且 目标表多出的行都能被快照后新增解释」；`6.1` 改用实际行数。保留 `--expect-rows=` 可固定 |
| `scripts/v8-reconcile-verify.js` | 断言 2 同样支持「快照后新增/新推送」的合法多出行，并单列打印归因明细 |
| `scripts/v7-flow-assembly-dryrun.js` | `1.1` 行数改用 `parsed_16` 实际行数；`3.1` 改为「总行数 − `sys_flow_state_2=1` 的终态行数」（比硬编码 92 更严格：终态行若没置空会立刻 FAIL） |

> 修订后的断言**更严格而不是更宽松**：xlsx 少一行、目标表凭空多一行、终态行未置空，仍会 FAIL。

### 8. 验证（全部实测，可复跑）

| 套件 | 结果 |
|---|---|
| `scripts/v9-acceptance.js --ui` | **53 / 53 PASS** |
| `scripts/v9-acceptance.js --flow` | **22 / 22 PASS**（含 V7 三项 + V8 两项 + 215 + 8 列非空率） |
| `scripts/v9-acceptance.js --ai` | **14 / 14 PASS**（真实 Mimo，两次复跑一致） |
| `scripts/v9-acceptance.js --build` | **4 / 4 PASS**（tsc 0 错误 + build 成功） |
| `scripts/v9-acceptance.js --regress` | **5 / 5 PASS** |
| `scripts/v9-acceptance.js --ui --flow` | **75 / 75 PASS，EXIT=0** |
| `scripts/v9-ai-valuedomain.js` | **51 / 51 PASS** |
| `scripts/v9-node-times.js` | **100 / 100 PASS** |
| `scripts/v8-ai-backend.js` | **PASS 103 / FAIL 0** |
| `scripts/v8-flow-verify.js` | **31 / 31 PASS，EXIT=0** |
| `scripts/v8-reconcile-verify.js` | **PASS 6 / FAIL 0，EXIT=0**（非 fresh 差异 0） |
| `scripts/v7-flow-join.js` | **132 / 132 PASS** |
| `scripts/v7-flow-assembly-dryrun.js` | **11 / 11 PASS** |
| `scripts/v7-flow-push-wire.js` | **9 / 9 PASS** |
| **浏览器验收（桌面 + iPhone 12）** | **38 / 38 PASS**（菜单 6 组结构、三页标签样式一致性、版本号、GitHub 链接、更新记录、无 console error、手机无横向溢出） |

**AI 四例真实问数（模型每次生成的列名都不同，故按「结果中存在某数值等于期望值」判定）**：
`已完成流程的客户数:4` / `完成流程的客户数:4` / `流转完成数量:4` / `客户数量:97`，耗时 3.3–8.9s，模型 `mimo-v2.6-flash`。

### 9. 部署

```bash
# 生产重启前必须确保旧进程已退净、8781 已释放
# （邮箱推送开启时，两个实例共享 last_uid → 同一封邮件可能被导入两次）
kill $(cat /www/server/nodejs/vhost/pids/jdy-push.pid); sleep 3
ss -lntp | grep 8781   # 必须为空
# 再用宝塔 Node 项目管理重启
```

**开关**：`FLOW_ON_PUSH_DEFER=0`（关尾随补跑）｜`FLOW_SYNC_NODE_TIMES=0`（关节点时间补空）｜
`FLOW_SYNC_NODE_TIMES_WINDOW_MS`（补空窗口，默认 600000）｜既有 `FLOW_ON_PUSH=0`（关推送触发）。

### 10. 已知未修（沿用 V8 结论，如实记录）

1. `flow-state.aggregate()` 终态不置空（3 个终态实例若再收到推送会写错两列，当前值正确）；
2. legacy `aggregate()` 排序键仍 `header_created_at`（有实例存在 1ms 级回退）；
3. `ai_api_key` 明文存于 `jdywh_settings`（与既有 `smtp_pass` 一致）。

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