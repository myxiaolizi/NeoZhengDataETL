/**
 * 项目介绍 / 宣传页（/intro）
 *
 * 结构：Hero → 快速链接（GitHub / 更新记录）→ 为什么需要数据中台 → 核心能力
 *       → 行业案例 → 技术架构 → CTA → 更新记录（内置精简版）→ 页脚
 * 颜色严格限定在 V4 调色板 13 色内（仅用不同透明度做层次）。
 * <768px 全部单列。
 *
 * V9 改版（本文件）：
 *  1. 新增源码仓库 GitHub 入口（Hero 下方快速链接 + 页脚），必须是可点击 <a>；
 *  2. 新增「更新记录」板块，内置 CHANGELOG.md 的 V9.0 / V8.0 / V7.1 / V7.0 精简版，
 *     底部链到 GitHub 上的完整 CHANGELOG.md；
 *  3. 页脚**不再渲染** site.footer（用户要求取消「XX公司版权所有」），改中性文案；
 *     版本号统一取 APP_VERSION 常量，不硬编码。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Grid, Row, Space, Tag } from 'antd';
import {
  ApartmentOutlined,
  ArrowDownOutlined,
  ArrowRightOutlined,
  AuditOutlined,
  BankOutlined,
  BarChartOutlined,
  CheckCircleFilled,
  CloseCircleOutlined,
  CloudDownloadOutlined,
  CoffeeOutlined,
  FormOutlined,
  GithubOutlined,
  HomeOutlined,
  MedicineBoxOutlined,
  NodeIndexOutlined,
  ExperimentOutlined,
  ReadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  SwapOutlined,
  ToolOutlined,
  TruckOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import IntroHero from '@/components/IntroHero';
import { api } from '@/api/client';
import { APP_VERSION } from '@/stores/app';
import { PALETTE, NEUTRAL } from '@/theme';

const { useBreakpoint } = Grid;

/* ---------------- 调色板（唯一来源：@/theme 令牌） ---------------- */
const C = {
  primary: PALETTE.primaryLight,
  cyan: PALETTE.cyan,
  deep: NEUTRAL.text,
  brand: PALETTE.primary,
  orange: PALETTE.orange,
  red: PALETTE.red,
  yellow: PALETTE.yellow,
  green: PALETTE.green,
  sky: PALETTE.cyan,
  gray: NEUTRAL.textTertiary,
  light: NEUTRAL.borderSubtle,
  white: NEUTRAL.surface,
  black: NEUTRAL.text,
} as const;

/** 把调色板 hex 转成带透明度的 rgba（不引入新色相） */
function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ---------------- 站点信息（公开接口 GET /api/settings/public，无需登录） ---------------- */
interface SiteInfo {
  name: string;
  subtitle: string;
  description: string;
  /**
   * 站点页脚文案（设置项 site_footer，生产库当前值是「XX公司版权所有」）。
   * V9 起**本页刻意不渲染它**（用户要求取消版权署名），仍照常读取以免影响
   * 与其它页面共用同一份公开设置契约；其它页面是否渲染不在本页职责内。
   */
  footer: string;
  logoText: string;
}

const SITE_FALLBACK: SiteInfo = {
  name: 'Neo Zheng DataETL',
  subtitle: 'Enterprise Data Integration Platform',
  description: '企业多系统数据整合 · 统一主数据管理 · 数据治理 · 报表 BI · 可视化大屏 · AI 问数',
  footer: '',
  logoText: 'N',
};

function useSiteInfo(): SiteInfo {
  const [site, setSite] = useState<SiteInfo>(SITE_FALLBACK);
  useEffect(() => {
    let alive = true;
    api
      .get<Record<string, string>>('/settings/public', { silent: true })
      .then((v) => {
        if (!alive || !v) return;
        setSite({
          name: v.site_name || SITE_FALLBACK.name,
          subtitle: v.site_subtitle || SITE_FALLBACK.subtitle,
          description: v.site_description || SITE_FALLBACK.description,
          footer: v.site_footer || '',
          logoText: v.site_logo_text || SITE_FALLBACK.logoText,
        });
      })
      .catch(() => {
        /* 接口不可用时静默使用内置默认值，保证宣传页始终可渲染 */
      });
    return () => {
      alive = false;
    };
  }, []);
  return site;
}

/* ---------------- 源码仓库 / 更新记录（数据源：仓库根目录 CHANGELOG.md） ---------------- */

/** 源码仓库首页 */
const GITHUB_REPO = 'https://github.com/myxiaolizi/NeoZhengDataETL';
/** 完整更新记录（GitHub 上的 CHANGELOG.md） */
const GITHUB_CHANGELOG = 'https://github.com/myxiaolizi/NeoZhengDataETL/blob/main/CHANGELOG.md';

interface ChangelogEntry {
  /** 版本号（与 CHANGELOG.md 的章节标题一致，带 V 前缀） */
  version: string;
  /** 发布日期（与 CHANGELOG.md 章节标题后的日期一致） */
  date: string;
  /** 版本强调色（取调色板令牌，不引入新色相） */
  color: string;
  /** 3–6 条要点（CHANGELOG.md 对应章节的精简，不编造） */
  points: string[];
}

/**
 * 版本号归一化：`V9.0` / `9.0.0` / `v9` → `9.0` / `9.0` / `9`。
 *
 * 只用于判断「哪一条更新记录是当前版本」，从而让「当前版本」标签跟随
 * `APP_VERSION` 常量自动走（Lead 把常量改成 V9.0 后无需再动本文件）。
 */
function versionKey(v: string): string {
  const m = String(v || '')
    .replace(/^[vV]/, '')
    .match(/\d+(?:\.\d+)?/);
  return m ? m[0] : '';
}

/**
 * 内置精简版更新记录。
 *
 * 为什么不在前端 fetch('/CHANGELOG.md') 解析：
 * CHANGELOG.md 在仓库根目录，**不在前端静态产物目录**（frontend/public 里没有它），
 * 生产环境无从请求；为它加后端路由又超出前端改动范围。因此内置常量，
 * 内容逐条对照仓库 CHANGELOG.md 的 [9.0.0] / [8.0.0] / [7.1.0] / [7.0.0] 章节，
 * 只做压缩、不做改写；底部固定给「完整更新记录见 GitHub」的链接。
 */
const CHANGELOG_SUMMARY: ChangelogEntry[] = [
  {
    version: 'V9.0',
    date: '2026-11-01',
    color: PALETTE.primary,
    points: [
      '菜单重构：顶级入口重新归并，常用功能更靠前',
      '系统设置与用户管理统一为标签页样式，切换不再跳页',
      'AI 问数补全列值域（如流程状态 0 = 进行中 / 1 = 流转完成），修复「已完成流程的客户数」被查成 0',
      '流程节点时间自动同步：进入下一节点即回写上一节点提交时间，宽表时间列不再缺失',
      '项目介绍页改版：新增更新记录与源码仓库入口，页脚取消版权署名',
    ],
  },
  {
    version: 'V8.0',
    date: '2026-10-31',
    color: PALETTE.cyan,
    points: [
      '修复 AI 问数完全不可用的 4 个根因：接口地址被双拼、MiMo 预设指向错误平台、Key 失效、仅支持单个数据集',
      'AI 问数从「单个数据集」升级为多数据范围：数据集 / 数据项目 / 邮箱推送 / 流程产出表',
      '新增分享为网页：公开问数页 /a/:token，手机与电脑都能用，支持密码、有效期与导出开关',
      '两个 CRM 项目重新独立核对，快照口径 96 行 × 59 列 100% 一致（0 差异）',
      '流程宽表 jdywh_crm_signing_v7 上线，推送实时触发自动刷新（全量 upsert 幂等自愈）',
      'V7 后端首次部署到生产，6.1 之后未上线的变更一并补齐',
    ],
  },
  {
    version: 'V7.1',
    date: '2026-10-31',
    color: PALETTE.green,
    points: [
      '看板与报表中心 30+ 项优化，板块标题收进卡片自身标题栏，去掉重复的段标题',
      '1080P 下 6 张签约概览卡单排显示，手机端 2 排 × 每排 3 个，卡片填充率提升到 80%~92%',
      '超期改「工作日」口径（排除周六日），每个节点独立阈值；为 0 的节点不再置灰',
      '类型汇总与排行三个排行榜差异化：横向条形 / 大数字 + 环形刻度 / 热力色块网格',
      '流程处理显示具体数字；策略模块改名并转置；客户明细可点击看详情',
    ],
  },
  {
    version: 'V7.0',
    date: '2026-10-31',
    color: PALETTE.orange,
    points: [
      '核对两个 CRM 数据项目与业务表格（96 行 × 59 列），反改历史数据 295 个单元格后逐格 0 差异',
      '实测出【当前节点】【当前负责人】四要素推导规则，96/96 还原业务表',
      '处理流程引擎新增 3 类节点（关联 join / 选取当前待办 / 计算列），节点类型 24 → 27 种',
      '推送实时触发 run_mode=trigger，加工出与业务表完全一致的宽表 jdywh_crm_signing_v7',
      '修复「字段被清空时解析列永不置空」的真实缺陷，并顺带修掉建表补列与计算列覆盖两个 bug',
    ],
  },
];

/* ---------------- 内容数据 ---------------- */

interface Pain {
  title: string;
  desc: string;
}

const PAINS: Pain[] = [
  {
    title: '数据孤岛',
    desc: 'ERP、WMS、SCRM、OA、POS、O2O 各自为政，数据无法互通，跨系统查询要人工导出 Excel 拼接。',
  },
  {
    title: '口径不一致',
    desc: '同一个「销售额」在不同系统有 3 种算法，月度经营会开了 2 小时，1 小时在争论数字谁对。',
  },
  {
    title: '主数据混乱',
    desc: '商品编码、门店编码、组织架构、权限体系各系统独立维护，改一次要改七八个地方。',
  },
  {
    title: '报表重复开发',
    desc: '每个业务部门提一次需求就开发一次报表，同样的指标做了十几遍，维护成本极高。',
  },
];

interface Capability {
  icon: React.ReactNode;
  title: string;
  desc: string;
  points: string[];
  color: string;
}

const CAPABILITIES: Capability[] = [
  {
    icon: <CloudDownloadOutlined />,
    title: '多源数据接入',
    desc: '支持 13 种数据库、40+ 业务系统接口、表单采集、文件导入，覆盖企业全部数据来源。',
    points: ['关系型 / 数仓 / 国产 / 时序 / 图数据库', '钉钉、企业微信、飞书通讯录与多维表格', '海典、雨诺、千方百计、用友、WPS', '微信公众号、小程序、支付、淘宝、支付宝'],
    color: C.primary,
  },
  {
    icon: <NodeIndexOutlined />,
    title: '数据清洗加工',
    desc: '拖拽式流程编排，24 种处理节点，把脏数据加工成标准数据。',
    points: ['条件过滤、去重、空值填充、类型转换', '字段拆分合并、JSON 提取、正则提取', '公式计算、分组聚合、排序截断', '支持试运行预览，不写目标即可验证'],
    color: C.green,
  },
  {
    icon: <SafetyCertificateOutlined />,
    title: '主数据治理',
    desc: '商品、门店、组织架构、权限等主数据在中台集中维护，各系统统一订阅。',
    points: ['原始表 + 解析表双表存储，可追溯', '字段级解析规则，中文列注释', '注释覆盖率与数据质量评估', '全量操作审计，可回溯'],
    color: C.yellow,
  },
  {
    icon: <FormOutlined />,
    title: '表单与流程',
    desc: '零代码搭建数据采集表单，支持审批流程与在线考试。',
    points: ['24 种控件，12 栅格自适应布局', '填写表单 / 流程表单 / 考试表单', '字段联动、公式计算、多选数量限制', '公开链接收集，数据自动入库'],
    color: C.cyan,
  },
  {
    icon: <BarChartOutlined />,
    title: '报表与可视化',
    desc: '基于数据集快速构建报表与大屏，支持外链分享与自动刷新。',
    points: ['12 种图表 + 看板式布局', 'KPI 卡、环形图、进度、排行榜、趋势', '数据集支持 SQL / 数据表 / 项目表', '分享链接可设密码与有效期'],
    color: C.orange,
  },
  {
    icon: <RobotOutlined />,
    title: 'AI 智能问数',
    desc: '用自然语言提问，自动生成 SQL 并解读结果，让业务人员自己查数。',
    points: ['预设 DeepSeek / 千问 / Kimi / GLM / OpenAI', '自动匹配数据集，SQL 只读安全校验', '结果表格 + 自然语言解读', '问数历史留存，可复用'],
    color: C.brand,
  },
  {
    icon: <SwapOutlined />,
    title: '数据集成与接口',
    desc: '既能接收第三方推送，也能主动按条件批量拉取，支持定时触发与失败重试。',
    points: ['接收地址免开发对接 Webhook', '接口采集支持 4 种鉴权方式', '响应数据路径灵活解析（如 data.list）', '执行日志与批次结果可追溯'],
    color: C.red,
  },
  {
    icon: <AuditOutlined />,
    title: '权限与审计',
    desc: '细粒度权限体系与全量操作审计，满足内控与合规要求。',
    points: ['29 个权限点分 9 组，角色可自定义', '权限变更即时生效，前后端双重校验', '35+ 类关键操作全量审计', '登录设备与会话管理，可强制下线'],
    color: C.sky,
  },
];

interface IndustryCase {
  industry: string;
  icon: React.ReactNode;
  color: string;
  /** 图标前景色（浅色底用深色字，保证对比度） */
  fg: string;
  systems: string[];
  pain: string;
  solution: string;
  value: string[];
}

const INDUSTRIES: IndustryCase[] = [
  {
    industry: '连锁药店',
    icon: <MedicineBoxOutlined />,
    color: C.green,
    fg: C.deep,
    systems: ['ERP', 'WMS', 'SCRM', 'OA', 'POS', 'O2O 中台', 'B2C 中台'],
    pain: '商品主数据在 ERP 与 POS 各维护一套，门店调价后 POS 未同步导致收银错误；会员积分在 SCRM 与 O2O 不一致，客户投诉。',
    solution: '以 ERP 为商品主数据源，中台统一清洗后回写 WMS、POS、O2O、B2C；会员数据以 SCRM 为准，统一会员 ID 映射；组织架构与权限由 OA 同步到所有系统。',
    value: ['商品编码全系统统一，调价 5 分钟内生效', '会员积分一致，投诉下降 80%', '门店日报自动生成，节省 3 人/天'],
  },
  {
    industry: '连锁餐饮',
    icon: <CoffeeOutlined />,
    color: C.yellow,
    fg: C.deep,
    systems: ['POS', '供应链系统', '会员系统', '外卖平台', '人力系统'],
    pain: '门店 POS 数据与外卖平台数据分离，无法看到单店全渠道营收；食材成本在供应链系统，人工成本在人力系统，单店利润算不出来。',
    solution: '抽取 POS 与外卖平台订单，按门店 + 日期对齐；供应链出库数据与人力排班成本汇总到中台，构建单店全渠道损益模型。',
    value: ['单店全渠道营收实时可见', '单店毛利自动核算，异常门店自动预警', '新品上市效果 3 天出结论'],
  },
  {
    industry: '连锁商超',
    icon: <ShopOutlined />,
    color: C.primary,
    fg: C.white,
    systems: ['ERP', 'WMS', 'POS', '生鲜称重系统', '供应商协同平台'],
    pain: '生鲜损耗率算不准，因为称重系统与 POS 数据口径不同；供应商对账要人工核对 3 套系统。',
    solution: '称重数据与 POS 销售数据在中台按 SKU 对齐，损耗率统一口径；供应商送货单、入库单、结算单三单匹配自动对账。',
    value: ['生鲜损耗率从估算变为精算', '供应商对账周期从 7 天缩短到 1 天', '缺货率下降 25%'],
  },
  {
    industry: '医药流通',
    icon: <ExperimentOutlined />,
    color: C.orange,
    fg: C.white,
    systems: ['ERP', 'GSP 质量管理系统', 'WMS', '温湿度监控', '药监追溯平台'],
    pain: 'GSP 要求全流程可追溯，但温湿度数据在监控系统、批次在 WMS、销售在 ERP，药监检查时要人工整理。',
    solution: '温湿度、批次、出入库、销售数据在中台按批次号串联，形成完整追溯链；自动生成 GSP 检查报表。',
    value: ['药监检查资料一键导出', '冷链异常批次自动锁定', '效期预警提前 90 天'],
  },
  {
    industry: '连锁酒店',
    icon: <HomeOutlined />,
    color: C.cyan,
    fg: C.deep,
    systems: ['PMS 酒店管理系统', 'OTA 渠道', '会员系统', '餐饮 POS', '工程报修系统'],
    pain: 'OTA 订单与 PMS 订单重复计算，RevPAR 算不准；餐饮消费与客房消费分离，无法识别高价值客户。',
    solution: 'OTA 与 PMS 订单按确认号去重，统一入住口径；客房与餐饮消费按客户 ID 合并，构建客户全生命周期价值模型。',
    value: ['RevPAR 口径统一，与 OTA 对账无争议', '高价值客户识别准确率提升 60%', '客房 + 餐饮交叉销售转化率提升 18%'],
  },
  {
    industry: '制造业',
    icon: <ToolOutlined />,
    color: C.red,
    fg: C.white,
    systems: ['ERP', 'MES 生产执行', 'WMS', 'PLM 产品生命周期', 'SCADA 设备采集'],
    pain: '生产工单在 MES、物料在 WMS、成本在 ERP，三者无法关联，导致实际成本与标准成本偏差无法分析。',
    solution: '以工单号为纽带，串联 MES 工序数据、WMS 领料数据、ERP 成本数据；SCADA 设备数据补充实际工时。',
    value: ['单产品成本可精确核算', '成本偏差原因可定位到工序', '设备 OEE 实时监控'],
  },
  {
    industry: '零售电商',
    icon: <ShoppingCartOutlined />,
    color: C.sky,
    fg: C.deep,
    systems: ['电商 ERP', '多平台店铺', 'WMS', '客服系统', '广告投放平台'],
    pain: '天猫、京东、抖音、拼多多各有一套订单与库存，超卖与缺货同时存在；广告 ROI 无法与订单关联。',
    solution: '多平台订单统一接入中台，库存集中扣减后回写各平台；广告点击 ID 与订单关联，计算真实 ROI。',
    value: ['超卖率从 2% 降到 0.1%', '广告 ROI 可精确到单品', '库存周转率提升 30%'],
  },
  {
    industry: '物流仓储',
    icon: <TruckOutlined />,
    color: C.brand,
    fg: C.white,
    systems: ['TMS 运输管理', 'WMS', 'GPS 车辆定位', '客户下单系统', '结算系统'],
    pain: '运输时效承诺与实际达成无法对比，客户投诉无据可查；运费结算要人工核对 GPS 里程。',
    solution: 'GPS 轨迹与 TMS 运单关联，自动计算实际里程与时效；客户下单承诺时效与实际对比，超时自动预警。',
    value: ['时效达成率实时可见', '运费结算自动化，减少 2 人', '客户投诉响应时间缩短 50%'],
  },
  {
    industry: '金融保险',
    icon: <BankOutlined />,
    color: C.deep,
    fg: C.white,
    systems: ['核心业务系统', 'CRM 客户关系', '理赔系统', '风控系统', '呼叫中心'],
    pain: '客户在 CRM、核心系统、理赔系统各有一套档案，客户来电时客服要切换 3 个系统才能看到全貌。',
    solution: '以证件号为主键，合并三系统客户档案；呼叫中心来电时弹出客户 360 视图，含保单、理赔、服务记录。',
    value: ['客服平均处理时长缩短 40%', '客户 360 视图一次看全', '交叉销售成功率提升 22%'],
  },
  {
    industry: '教育培训',
    icon: <ReadOutlined />,
    color: C.gray,
    fg: C.deep,
    systems: ['教务系统', '招生 CRM', '在线学习平台', '财务系统', '家校沟通平台'],
    pain: '招生线索在 CRM、报名在教务、上课在在线平台、缴费在财务，学员流失原因无法分析。',
    solution: '线索 - 报名 - 上课 - 缴费全链路打通，构建学员生命周期漏斗；流失学员自动标记并分析流失节点。',
    value: ['招生转化漏斗可视化', '流失原因可定位到具体环节', '续费率提升 15%'],
  },
  {
    industry: '房地产',
    icon: <ApartmentOutlined />,
    color: C.light,
    fg: C.deep,
    systems: ['销售管理系统', '工程管理系统', '物业系统', '财务系统', 'CRM 客户系统'],
    pain: '房源在销售系统、工程进度在工程系统、交付在物业系统，客户问「我的房子盖到哪了」无法回答。',
    solution: '房源 - 工程节点 - 交付 - 物业全链路关联，客户可通过小程序查询自家房屋工程进度。',
    value: ['工程进度透明，客户投诉下降 35%', '交付节点自动提醒', '物业费收缴率提升 12%'],
  },
];

interface FlowColumn {
  label: string;
  color: string;
  nodes: string[];
}

const FLOW: FlowColumn[] = [
  { label: '数据来源', color: C.sky, nodes: ['ERP', 'WMS', 'SCRM', 'OA', 'POS', 'O2O / B2C'] },
  { label: '数据中台', color: C.primary, nodes: ['数据接入', '清洗加工', '主数据治理', '统一存储'] },
  { label: '数据应用', color: C.green, nodes: ['报表 BI', '可视化大屏', 'AI 问数', '接口回写'] },
];

interface Advantage {
  no: string;
  title: string;
  desc: string;
}

const ADVANTAGES: Advantage[] = [
  { no: '01', title: '多数据源统一抽象', desc: '13 种数据库通过统一驱动层访问，SQL 方言自动转换，业务代码无需感知底层差异。' },
  { no: '02', title: '表名白名单隔离', desc: '所有建表改表删表操作前校验表名前缀，即使误配到共享库也不会影响其他应用的数据。' },
  { no: '03', title: '双表可追溯存储', desc: '原始报文与解析结果分表存储，任何一条数据都能追溯到原始来源，满足审计要求。' },
  { no: '04', title: '行大小智能保护', desc: '字段较多时自动降级为 TEXT 类型，避免数据库单行 65535 字节上限导致的建表失败。' },
  { no: '05', title: '细粒度权限体系', desc: '29 个权限点分 9 组，角色可自定义，权限变更即时生效，前后端双重校验。' },
  { no: '06', title: '大数据量优化', desc: '按月分片 + 列式存储，824,844 条记录从 1083MB 压缩到 374MB，加载速度提升 10 倍。' },
];

/* ---------------- 区块容器 ---------------- */
function Section({
  id,
  title,
  desc,
  muted,
  children,
}: {
  id?: string;
  title: React.ReactNode;
  desc?: React.ReactNode;
  muted?: boolean;
  children: React.ReactNode;
}) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  return (
    <section
      id={id}
      style={{
        marginTop: isMobile ? 14 : 20,
        padding: isMobile ? '24px 16px' : '40px 32px',
        borderRadius: isMobile ? 14 : 20,
        background: muted ? tint(C.deep, 0.02) : C.white,
        border: `1px solid ${tint(C.deep, 0.07)}`,
        scrollMarginTop: 80,
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: isMobile ? 18 : 30 }}>
        <h2
          style={{
            margin: 0,
            fontSize: isMobile ? 19 : 27,
            fontWeight: 800,
            color: C.deep,
            letterSpacing: '-.3px',
          }}
        >
          {title}
        </h2>
        {desc && (
          <p
            style={{
              margin: '10px auto 0',
              maxWidth: 720,
              fontSize: isMobile ? 12.5 : 14,
              lineHeight: 1.8,
              color: tint(C.deep, 0.6),
            }}
          >
            {desc}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

/* ---------------- 页面 ---------------- */
export default function IntroPage() {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const navigate = useNavigate();
  const site = useSiteInfo();

  const scrollToCases = () => {
    const el = document.getElementById('cases');
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const heroStats = useMemo(
    () => [
      { value: '13', label: '数据库类型' },
      { value: '40+', label: '业务系统接口' },
      { value: '24', label: '数据处理节点' },
      { value: '12', label: '图表类型' },
      { value: '∞', label: '数据量级' },
    ],
    []
  );

  return (
    <div style={{ paddingBottom: 4 }}>
      <IntroHero
        badge={
          <>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: C.green,
                display: 'inline-block',
              }}
            />
            {site.subtitle}
          </>
        }
        title={site.name}
        highlight="一体化企业数据中台"
        description={
          <>
            把企业多个业务系统的数据整合到一起统一管理，让商品、库存、价格、组织架构与权限集中在数据中台治理，
            使所有业务系统的数据一致、口径一致。
            <br />
            数据集成 · 数据治理 · 报表 BI · 可视化大屏 · AI 问数
          </>
        }
        stats={heroStats}
        primaryText="立即进入平台"
        secondaryText="查看行业案例"
        onPrimary={() => navigate('/dashboard')}
        onSecondary={scrollToCases}
        footnote={site.description}
      />

      {/* ---------- 快速链接：源码仓库 + 更新记录（Hero 区下方显眼位置） ---------- */}
      <div
        style={{
          marginTop: isMobile ? 14 : 20,
          padding: isMobile ? '14px 16px' : '16px 24px',
          borderRadius: isMobile ? 14 : 18,
          background: C.white,
          border: `1px solid ${tint(C.deep, 0.08)}`,
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'flex-start' : 'center',
          justifyContent: 'space-between',
          gap: isMobile ? 10 : 16,
        }}
      >
        <Space size={isMobile ? 8 : 14} wrap>
          <a
            href={GITHUB_REPO}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: isMobile ? '6px 12px' : '7px 14px',
              borderRadius: 9,
              background: tint(C.deep, 0.94),
              color: C.white,
              fontSize: 12.5,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            <GithubOutlined style={{ fontSize: 15 }} />
            GitHub 仓库 · NeoZhengDataETL
          </a>
          <a
            href={GITHUB_CHANGELOG}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: isMobile ? '6px 12px' : '7px 14px',
              borderRadius: 9,
              background: tint(C.primary, 0.08),
              border: `1px solid ${tint(C.primary, 0.24)}`,
              color: C.brand,
              fontSize: 12.5,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            <ReadOutlined style={{ fontSize: 14 }} />
            更新记录（Changelog）
          </a>
        </Space>
        <span style={{ fontSize: 11.5, color: tint(C.deep, 0.5) }}>
          当前版本 <strong style={{ color: C.deep, fontWeight: 800 }}>{APP_VERSION}</strong>
        </span>
      </div>

      {/* ---------- 为什么需要数据中台 ---------- */}
      <Section
        title="为什么需要数据中台"
        desc="企业每上一套系统，就多一个数据孤岛。同一个商品在 ERP、WMS、POS 里叫法不同、编码不同、价格不同，最终导致决策失真。"
      >
        <Row gutter={[16, 16]}>
          {PAINS.map((p, i) => (
            <Col xs={24} sm={12} lg={6} key={p.title}>
              <Card
                variant="outlined"
                style={{ height: '100%', borderRadius: 14, borderColor: tint(C.deep, 0.08) }}
                styles={{ body: { padding: isMobile ? 16 : 20 } }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: tint(C.red, 0.12),
                    color: C.red,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 17,
                    marginBottom: 12,
                  }}
                >
                  <CloseCircleOutlined />
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.deep, marginBottom: 6 }}>
                  {String(i + 1).padStart(2, '0')} · {p.title}
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.85, color: tint(C.deep, 0.62) }}>{p.desc}</div>
              </Card>
            </Col>
          ))}
        </Row>
      </Section>

      {/* ---------- 核心能力 ---------- */}
      <Section
        title="八大核心能力"
        muted
        desc="从数据接入到数据应用，覆盖数据全生命周期"
      >
        <Row gutter={[16, 16]}>
          {CAPABILITIES.map((cap) => (
            <Col xs={24} sm={12} xl={6} key={cap.title}>
              <Card
                hoverable
                variant="outlined"
                style={{ height: '100%', borderRadius: 14, borderColor: tint(C.deep, 0.08) }}
                styles={{ body: { padding: isMobile ? 16 : 20 } }}
              >
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    background: tint(cap.color, cap.color === C.green || cap.color === C.yellow ? 0.24 : 0.14),
                    color: cap.color === C.yellow ? C.orange : cap.color === C.light ? C.deep : cap.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 20,
                    marginBottom: 14,
                  }}
                >
                  {cap.icon}
                </div>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: C.deep, marginBottom: 8 }}>{cap.title}</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.8, color: tint(C.deep, 0.62), marginBottom: 12 }}>
                  {cap.desc}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {cap.points.map((pt) => (
                    <div key={pt} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                      <CheckCircleFilled style={{ color: cap.color, fontSize: 12, marginTop: 4, flex: '0 0 12px' }} />
                      <span style={{ fontSize: 12, lineHeight: 1.7, color: tint(C.deep, 0.72) }}>{pt}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      </Section>

      {/* ---------- 行业案例 ---------- */}
      <Section
        id="cases"
        title="11 个行业整合案例"
        desc="不同行业的数据孤岛形态不同，但解法一致：抽取 → 清洗 → 标准化 → 统一服务"
      >
        <Row gutter={[16, 16]}>
          {INDUSTRIES.map((c, i) => (
            <Col xs={24} md={12} xl={8} key={c.industry}>
              <Card
                hoverable
                variant="outlined"
                style={{
                  height: '100%',
                  borderRadius: 14,
                  borderColor: tint(C.deep, 0.08),
                  overflow: 'hidden',
                }}
                styles={{ body: { padding: 0 } }}
              >
                <div style={{ height: 4, background: c.color }} />
                <div style={{ padding: isMobile ? 16 : 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        flex: '0 0 38px',
                        borderRadius: 11,
                        background: c.color,
                        color: c.fg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 18,
                      }}
                    >
                      {c.icon}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: C.deep, lineHeight: 1.3 }}>{c.industry}</div>
                      <div style={{ fontSize: 11.5, color: tint(C.deep, 0.5), marginTop: 2 }}>
                        涉及 {c.systems.length} 个业务系统
                      </div>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: tint(C.deep, 0.16), letterSpacing: '-1px' }}>
                      {String(i + 1).padStart(2, '0')}
                    </div>
                  </div>

                  <Space size={[6, 6]} wrap style={{ marginBottom: 12 }}>
                    {c.systems.map((s) => (
                      <Tag
                        key={s}
                        variant="filled"
                        style={{
                          margin: 0,
                          fontSize: 11,
                          padding: '0 7px',
                          lineHeight: '20px',
                          borderRadius: 6,
                          background: tint(C.primary, 0.08),
                          color: C.brand,
                        }}
                      >
                        {s}
                      </Tag>
                    ))}
                  </Space>

                  <CaseBlock label="痛点" color={C.red} text={c.pain} />
                  <CaseBlock label="整合方案" color={C.primary} text={c.solution} />
                  <CaseBlock label="价值" color={C.green} text={c.value} />
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      </Section>

      {/* ---------- 技术架构 ---------- */}
      <Section
        id="arch"
        title="技术架构与数据流向"
        muted
        desc="把所有系统的数据抽取到中台，经过清洗、标准化、主数据对齐后统一存储，再以数据集的形式对外提供服务。业务系统通过接口实时获取中台的主数据，报表与大屏直接基于中台数据构建。"
      >
        <div
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: 'stretch',
            gap: 0,
            marginBottom: isMobile ? 26 : 36,
          }}
        >
          {FLOW.map((col, ci) => (
            <React.Fragment key={col.label}>
              {ci > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: C.primary,
                    fontSize: 22,
                    padding: isMobile ? '8px 0' : '0 10px',
                    flex: '0 0 auto',
                  }}
                >
                  {isMobile ? <ArrowDownOutlined /> : <ArrowRightOutlined />}
                </div>
              )}
              <div
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  padding: isMobile ? 14 : 18,
                  borderRadius: 14,
                  background: C.white,
                  border: `1px solid ${tint(C.deep, 0.09)}`,
                }}
              >
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    marginBottom: 12,
                    fontSize: 12,
                    fontWeight: 700,
                    color: C.deep,
                  }}
                >
                  <span
                    style={{ width: 8, height: 8, borderRadius: '50%', background: col.color, display: 'inline-block' }}
                  />
                  {col.label}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {col.nodes.map((n) => (
                    <div
                      key={n}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 9,
                        fontSize: 13,
                        fontWeight: 600,
                        color: C.deep,
                        background: tint(col.color, 0.12),
                        border: `1px solid ${tint(col.color, 0.32)}`,
                      }}
                    >
                      {n}
                    </div>
                  ))}
                </div>
              </div>
            </React.Fragment>
          ))}
        </div>

        <Row gutter={[16, 16]}>
          {ADVANTAGES.map((a) => (
            <Col xs={24} sm={12} xl={8} key={a.no}>
              <div
                style={{
                  height: '100%',
                  padding: isMobile ? 14 : 18,
                  borderRadius: 14,
                  background: C.white,
                  border: `1px solid ${tint(C.deep, 0.08)}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: tint(C.primary, 0.55) }}>{a.no}</span>
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: C.deep }}>{a.title}</span>
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.85, color: tint(C.deep, 0.62) }}>{a.desc}</div>
              </div>
            </Col>
          ))}
        </Row>
      </Section>

      {/* ---------- CTA ---------- */}
      <section
        style={{
          marginTop: isMobile ? 14 : 20,
          padding: isMobile ? '32px 20px' : '52px 32px',
          borderRadius: isMobile ? 14 : 20,
          textAlign: 'center',
          background: `linear-gradient(135deg, ${PALETTE.primaryDeep} 0%, ${PALETTE.primary} 50%, ${PALETTE.primaryLight} 100%)`,
          color: C.white,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            width: 380,
            height: 380,
            top: -160,
            right: -100,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${tint(C.cyan, 0.45)} 0%, ${tint(C.cyan, 0)} 70%)`,
            pointerEvents: 'none',
          }}
        />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ fontSize: isMobile ? 20 : 28, fontWeight: 800, marginBottom: 10 }}>
            开始整合你的企业数据
          </div>
          <div style={{ fontSize: isMobile ? 12.5 : 14.5, color: 'rgba(255,255,255,.86)', marginBottom: 24 }}>
            从接入第一个数据源开始，逐步构建统一的数据资产
          </div>
          <Space size={12} wrap style={{ justifyContent: 'center' }}>
            <Button
              onClick={() => navigate('/dashboard')}
              style={{
                height: 44,
                padding: '0 26px',
                borderRadius: 10,
                border: 'none',
                background: C.white,
                color: C.deep,
                fontWeight: 700,
              }}
            >
              进入平台 →
            </Button>
            <Button
              onClick={() => navigate('/help')}
              style={{
                height: 44,
                padding: '0 24px',
                borderRadius: 10,
                border: '1.5px solid rgba(255,255,255,.6)',
                background: 'rgba(255,255,255,.10)',
                color: C.white,
                fontWeight: 600,
              }}
            >
              查看使用说明
            </Button>
          </Space>
        </div>
      </section>

      {/* ---------- 更新记录（内置精简版，完整版见 GitHub CHANGELOG.md） ---------- */}
      <Section
        id="changelog"
        title="更新记录"
        muted
        desc="最近 4 个版本的迭代要点。完整更新记录（含全部历史版本、根因分析与验收证据）在 GitHub 仓库的 CHANGELOG.md 中维护。"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {CHANGELOG_SUMMARY.map((e) => (
            <div
              key={e.version}
              style={{
                padding: isMobile ? '14px 16px' : '18px 22px',
                borderRadius: 14,
                background: C.white,
                border: `1px solid ${tint(C.deep, 0.08)}`,
                borderLeft: `4px solid ${e.color}`,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: isMobile ? 8 : 10,
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '2px 10px',
                    borderRadius: 7,
                    background: tint(e.color, 0.12),
                    color: e.color,
                    fontSize: 13,
                    fontWeight: 800,
                    letterSpacing: '-.2px',
                  }}
                >
                  {e.version}
                </span>
                {versionKey(e.version) === versionKey(APP_VERSION) && (
                  <Tag
                    variant="filled"
                    style={{
                      margin: 0,
                      fontSize: 11,
                      lineHeight: '19px',
                      borderRadius: 6,
                      background: tint(C.green, 0.14),
                      color: C.green,
                      fontWeight: 700,
                    }}
                  >
                    当前版本
                  </Tag>
                )}
                <span style={{ fontSize: 11.5, color: tint(C.deep, 0.5) }}>{e.date}</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {e.points.map((pt) => (
                  <div key={pt} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                    <CheckCircleFilled style={{ color: e.color, fontSize: 12, marginTop: 4, flex: '0 0 12px' }} />
                    <span style={{ fontSize: 12.5, lineHeight: 1.8, color: tint(C.deep, 0.72) }}>{pt}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <a
            href={GITHUB_CHANGELOG}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12.5,
              fontWeight: 700,
              color: C.brand,
              textDecoration: 'none',
              padding: '7px 16px',
              borderRadius: 9,
              background: tint(C.primary, 0.08),
              border: `1px solid ${tint(C.primary, 0.24)}`,
            }}
          >
            完整更新记录见 GitHub（CHANGELOG.md）
            <ArrowRightOutlined style={{ fontSize: 12 }} />
          </a>
        </div>
      </Section>

      {/* ---------- 页脚 ---------- */}
      <footer
        style={{
          marginTop: isMobile ? 14 : 20,
          padding: isMobile ? '22px 18px' : '30px 32px',
          borderRadius: isMobile ? 14 : 20,
          background: C.deep,
          color: C.white,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'flex-start' : 'center',
            justifyContent: 'space-between',
            gap: isMobile ? 14 : 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'rgba(255,255,255,.16)',
                border: '1px solid rgba(255,255,255,.28)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 17,
              }}
            >
              {site.logoText}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{site.name}</div>
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.7)', marginTop: 2 }}>{site.subtitle}</div>
            </div>
          </div>

          <Space size={isMobile ? 12 : 20} wrap>
            <a onClick={() => navigate('/help')} style={{ color: 'rgba(255,255,255,.85)', fontSize: 12.5 }}>
              使用说明
            </a>
            <a onClick={() => navigate('/dashboard')} style={{ color: 'rgba(255,255,255,.85)', fontSize: 12.5 }}>
              数据概览
            </a>
            <a onClick={scrollToCases} style={{ color: 'rgba(255,255,255,.85)', fontSize: 12.5 }}>
              行业案例
            </a>
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                color: 'rgba(255,255,255,.85)',
                fontSize: 12.5,
                textDecoration: 'none',
              }}
            >
              <GithubOutlined style={{ fontSize: 13 }} />
              GitHub 仓库
            </a>
          </Space>
        </div>

        <div
          style={{
            marginTop: 18,
            paddingTop: 16,
            borderTop: '1px solid rgba(255,255,255,.18)',
            fontSize: 11.5,
            color: 'rgba(255,255,255,.62)',
            lineHeight: 1.9,
          }}
        >
          <div>数据集成 · 数据治理 · 报表 BI · 可视化大屏 · AI 问数</div>
          {/*
            V9：不再渲染 site.footer（生产库该值是「XX公司版权所有」，用户要求取消）。
            改为中性文案；只改本页渲染，不去改数据库里的 site_footer 配置。
          */}
          <div
            style={{
              marginTop: 4,
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: isMobile ? 'flex-start' : 'center',
              justifyContent: 'space-between',
              gap: isMobile ? 6 : 12,
            }}
          >
            <span>
              {site.name} · 企业多系统数据整合平台
            </span>
            <span style={{ whiteSpace: 'nowrap' }}>{APP_VERSION}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ---------------- 行业案例小节 ---------------- */
function CaseBlock({
  label,
  color,
  text,
}: {
  label: string;
  color: string;
  text: string | string[];
}) {
  const items = Array.isArray(text) ? text : null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          display: 'inline-block',
          padding: '1px 8px',
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 700,
          marginBottom: 6,
          background: tint(color, 0.14),
          color: color === C.green ? C.deep : color,
        }}
      >
        {label}
      </div>
      {items ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map((it) => (
            <div key={it} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <CheckCircleFilled style={{ color: C.green, fontSize: 11, marginTop: 4, flex: '0 0 11px' }} />
              <span style={{ fontSize: 12, lineHeight: 1.75, color: tint(C.deep, 0.7) }}>{it}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, lineHeight: 1.8, color: tint(C.deep, 0.7) }}>{text}</div>
      )}
    </div>
  );
}
