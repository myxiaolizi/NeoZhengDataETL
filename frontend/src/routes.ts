/** 路由与菜单配置：单一数据源，驱动侧边栏、面包屑与权限 */
import type { ReactNode } from 'react';

export interface RouteConf {
  path: string;
  name: string;
  icon?: string;
  permission?: string;
  hideInMenu?: boolean;
  mobile?: boolean;      // 是否支持移动端
  group?: string;        // 菜单分组
  component?: string;    // 懒加载模块名（相对 pages/）
}

/**
 * 菜单分组定义（顺序即展示顺序）
 *
 * V9 重构（用户明确要求的六个分组）：
 *   首页概览 / 数据接入 / 数据管理 / 数据分析 / 数据治理 / 系统管理
 *
 * 相对 V8 的删减：
 *   - 去掉 `process`（原「数据处理」组）：其唯一项「处理流程」改名为「数据处理」，
 *     并移入「数据管理」组（用户要求「处理流程改名为数据处理放到数据管理菜单中」）。
 *   - 去掉 `other`（原「其他」组）：项目介绍 / 使用说明 → 系统管理；
 *     个人中心 → 不进菜单（但路由保留，顶栏头像下拉里已有入口）。
 *   - 「分析与可视化」组名 → 改为「数据分析」。
 *
 * ⚠️ 分组 key 只用于菜单归组，**不参与权限判断**，所以改名/删组不影响任何接口。
 */
export const MENU_GROUPS = [
  { key: 'overview', title: '' },
  { key: 'data', title: '数据接入' },
  { key: 'manage', title: '数据管理' },
  { key: 'analysis', title: '数据分析' },
  { key: 'governance', title: '数据治理' },
  { key: 'system', title: '系统管理' },
];

/**
 * 全量路由表
 * mobile: true 表示需要移动端支持（表单中心、分析与可视化等查看类）
 *
 * `hideInMenu: true` 的项**路由仍然可用**（可直接访问 / 从其他页面进入），
 * 只是不出现在左侧菜单里。
 */
export const ROUTES: RouteConf[] = [
  // ---------- 首页概览 ----------
  { path: '/dashboard', name: '首页概览', icon: 'DashboardOutlined', group: 'overview', component: 'dashboard', mobile: true },
  // V7.0 中康智能体客户看板：按要求并入「报表中心 → 系统内置看板」，
  // 不再占用左侧独立菜单项（路由保留：可从报表中心卡片进入 / 手机二维码直达）
  { path: '/dashboard/board', name: '中康智能体客户看板', icon: 'FundProjectionScreenOutlined', group: 'analysis', hideInMenu: true, component: 'dashboard/Board', mobile: true },
  // 客户签约看板 = 报表中心的内置看板：路由保留（页面可直接访问 / 可从报表中心进入），但不进左侧菜单
  { path: '/dashboard/crm', name: '客户签约看板', icon: 'FundOutlined', group: 'analysis', hideInMenu: true, component: 'dashboard/CrmDashboard', mobile: true },

  // ---------- 数据接入 ----------
  // V9：原「数据项目」改名「项目管理」
  { path: '/projects', name: '项目管理', icon: 'ProjectOutlined', permission: 'project:read', group: 'data', component: 'projects' },
  { path: '/projects/:id', name: '项目详情', permission: 'project:read', hideInMenu: true, group: 'data', component: 'projects/Detail' },
  { path: '/projects/:id/fields', name: '字段配置', permission: 'project:read', hideInMenu: true, group: 'data', component: 'projects/Fields' },
  // V9：原「表单中心」改名「表单管理」
  { path: '/forms', name: '表单管理', icon: 'FormOutlined', permission: 'form:read', group: 'data', component: 'forms', mobile: true },
  { path: '/forms/:id/design', name: '表单设计', permission: 'form:write', hideInMenu: true, group: 'data', component: 'forms/Design' },
  { path: '/forms/:id/data', name: '表单数据', permission: 'form:read', hideInMenu: true, group: 'data', component: 'forms/Data', mobile: true },
  { path: '/integrations', name: '数据集成', icon: 'SwapOutlined', permission: 'integration:read', group: 'data', component: 'integrations' },
  { path: '/integrations/:id', name: '集成详情', permission: 'integration:read', hideInMenu: true, group: 'data', component: 'integrations/Detail' },
  { path: '/mail-push', name: '邮件推送', icon: 'MailOutlined', permission: 'project:read', group: 'data', component: 'mail-push' },
  /* V4.1：邮件推送「数据项目」改用独立新页面（不再用右侧抽屉） */
  { path: '/mail-push/projects/:id', name: '数据项目详情', permission: 'project:read', hideInMenu: true, group: 'data', component: 'mail-push/Project', mobile: true },

  // ---------- 数据管理 ----------
  // V9：原「处理流程」改名「数据处理」，并从原「数据处理」分组移入「数据管理」分组
  { path: '/flows', name: '数据处理', icon: 'NodeIndexOutlined', permission: 'flow:read', group: 'manage', component: 'flows' },
  { path: '/flows/:id/design', name: '流程设计', permission: 'flow:write', hideInMenu: true, group: 'manage', component: 'flows/Design' },
  { path: '/flows/:id/logs', name: '流程日志', permission: 'flow:read', hideInMenu: true, group: 'manage', component: 'flows/Logs' },
  { path: '/datasources', name: '数据源', icon: 'DatabaseOutlined', permission: 'datasource:read', group: 'manage', component: 'datasources' },
  { path: '/datasets', name: '数据集', icon: 'TableOutlined', permission: 'dataset:read', group: 'manage', component: 'datasets' },

  // ---------- 数据分析 ----------
  { path: '/reports', name: '报表中心', icon: 'BarChartOutlined', permission: 'report:read', group: 'analysis', component: 'reports', mobile: true },
  { path: '/reports/:id/design', name: '报表设计', permission: 'report:write', hideInMenu: true, group: 'analysis', component: 'reports/Design' },
  { path: '/reports/:id/view', name: '报表查看', permission: 'report:read', hideInMenu: true, group: 'analysis', component: 'reports/View', mobile: true },
  { path: '/shares', name: '分享管理', icon: 'ShareAltOutlined', permission: 'share:read', group: 'analysis', component: 'shares', mobile: true },
  { path: '/ai', name: 'AI 问数', icon: 'RobotOutlined', permission: 'ai:read', group: 'analysis', component: 'ai', mobile: true },
  /**
   * V8：AI 问数**公开分享页**（无需登录，独立布局不套 BasicLayout）。
   * hideInMenu：不进左侧菜单；mobile：标记需移动端适配。
   * 实际路由由 App.tsx 挂在 `<Routes>` 顶部的公开路由区（/a/:token）。
   */
  { path: '/a/:token', name: 'AI 问数分享', icon: 'ShareAltOutlined', hideInMenu: true, group: 'analysis', component: 'ai-share', mobile: true },

  // ---------- 数据治理 ----------
  { path: '/governance', name: '治理总览', icon: 'SafetyOutlined', permission: 'governance:read', group: 'governance', component: 'governance' },
  { path: '/audit', name: '审计日志', icon: 'FileSearchOutlined', permission: 'audit:read', group: 'governance', component: 'audit' },

  // ---------- 系统管理 ----------
  { path: '/users', name: '用户管理', icon: 'TeamOutlined', permission: 'user:read', group: 'system', component: 'users' },
  /**
   * V9：**角色权限不再进左侧菜单**（用户明确要求「取消菜单中的角色权限，其在用户管理中已存在」）。
   * 路由保留：用户管理页内的「角色权限」标签页 / 直接访问 /roles 仍可用，
   * 避免破坏既有链接与权限校验链路。
   */
  { path: '/roles', name: '角色权限', icon: 'KeyOutlined', permission: 'role:read', hideInMenu: true, group: 'system', component: 'roles' },
  { path: '/settings', name: '系统设置', icon: 'SettingOutlined', permission: 'setting:read', group: 'system', component: 'settings' },
  { path: '/intro', name: '项目介绍', icon: 'InfoCircleOutlined', group: 'system', component: 'intro', mobile: true },
  { path: '/help', name: '使用说明', icon: 'QuestionCircleOutlined', group: 'system', component: 'help', mobile: true },
  /**
   * V9：**个人中心不进左侧菜单**（用户明确要求）。
   * 路由保留 —— 顶栏用户头像下拉里的「个人中心」仍然跳到这里。
   */
  { path: '/profile', name: '个人中心', icon: 'UserOutlined', hideInMenu: true, group: 'system', component: 'profile', mobile: true },
];

/** 需要移动端适配的路由集合 */
export const MOBILE_ROUTES = new Set(ROUTES.filter((r) => r.mobile).map((r) => r.path));

/**
 * 公开路由（无需登录）
 * App.tsx 用 `startsWith` 匹配，因此登记的是前缀。
 *
 * 注意：`/s/`、`/f/`、`/a/` 这类带 token 的公开页故意**不**放进来——
 * 它们需要「完全不探测登录态」（不能发 /me），由 App.tsx 单独的
 * PUBLIC_PREFIXES 常量判断，避免这里被误解为「可以探测」。
 */
export const PUBLIC_ROUTES = ['/login', '/register', '/forgot-password', '/reset-password'];

/**
 * 完全不探测登录态的路径前缀（未登录访客直接打开，不能发 /api/me）。
 *
 * - `/s/`：报表 / 看板公开分享
 * - `/f/`：表单公开填写
 * - `/a/`：V8 AI 问数公开分享（手机扫码/微信打开的主要入口）
 */
export const PUBLIC_PREFIXES = ['/s/', '/f/', '/a/'];
