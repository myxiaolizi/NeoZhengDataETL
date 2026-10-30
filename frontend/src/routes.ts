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

/** 菜单分组定义（顺序即展示顺序） */
export const MENU_GROUPS = [
  { key: 'overview', title: '' },
  { key: 'data', title: '数据接入' },
  { key: 'process', title: '数据处理' },
  { key: 'manage', title: '数据管理' },
  { key: 'analysis', title: '分析与可视化' },
  { key: 'governance', title: '数据治理' },
  { key: 'system', title: '系统管理' },
  { key: 'other', title: '其他' },
];

/**
 * 全量路由表
 * mobile: true 表示需要移动端支持（表单中心、分析与可视化等查看类）
 */
export const ROUTES: RouteConf[] = [
  // ---------- 概览 ----------
  { path: '/dashboard', name: '数据概览', icon: 'DashboardOutlined', group: 'overview', component: 'dashboard', mobile: true },
  // V5.0 中康智能体客户看板（独立看板页，支持移动端 + 二维码进入）
  { path: '/dashboard/board', name: '中康智能体客户看板', icon: 'FundProjectionScreenOutlined', group: 'analysis', component: 'dashboard/Board', mobile: true },
  // 客户签约看板 = 报表中心的内置看板：路由保留（页面可直接访问 / 可从报表中心进入），但不进左侧菜单
  { path: '/dashboard/crm', name: '客户签约看板', icon: 'FundOutlined', group: 'analysis', hideInMenu: true, component: 'dashboard/CrmDashboard', mobile: true },

  // ---------- 数据接入 ----------
  { path: '/projects', name: '数据项目', icon: 'ProjectOutlined', permission: 'project:read', group: 'data', component: 'projects' },
  { path: '/projects/:id', name: '项目详情', permission: 'project:read', hideInMenu: true, group: 'data', component: 'projects/Detail' },
  { path: '/projects/:id/fields', name: '字段配置', permission: 'project:read', hideInMenu: true, group: 'data', component: 'projects/Fields' },
  { path: '/forms', name: '表单中心', icon: 'FormOutlined', permission: 'form:read', group: 'data', component: 'forms', mobile: true },
  { path: '/forms/:id/design', name: '表单设计', permission: 'form:write', hideInMenu: true, group: 'data', component: 'forms/Design' },
  { path: '/forms/:id/data', name: '表单数据', permission: 'form:read', hideInMenu: true, group: 'data', component: 'forms/Data', mobile: true },
  { path: '/integrations', name: '数据集成', icon: 'SwapOutlined', permission: 'integration:read', group: 'data', component: 'integrations' },
  { path: '/integrations/:id', name: '集成详情', permission: 'integration:read', hideInMenu: true, group: 'data', component: 'integrations/Detail' },
  { path: '/mail-push', name: '邮箱推送', icon: 'MailOutlined', permission: 'project:read', group: 'data', component: 'mail-push' },
  /* V4.1：邮件推送「数据项目」改用独立新页面（不再用右侧抽屉） */
  { path: '/mail-push/projects/:id', name: '数据项目详情', permission: 'project:read', hideInMenu: true, group: 'data', component: 'mail-push/Project', mobile: true },

  // ---------- 数据处理 ----------
  { path: '/flows', name: '处理流程', icon: 'NodeIndexOutlined', permission: 'flow:read', group: 'process', component: 'flows' },
  { path: '/flows/:id/design', name: '流程设计', permission: 'flow:write', hideInMenu: true, group: 'process', component: 'flows/Design' },
  { path: '/flows/:id/logs', name: '流程日志', permission: 'flow:read', hideInMenu: true, group: 'process', component: 'flows/Logs' },

  // ---------- 数据管理 ----------
  { path: '/datasources', name: '数据源', icon: 'DatabaseOutlined', permission: 'datasource:read', group: 'manage', component: 'datasources' },
  { path: '/datasets', name: '数据集', icon: 'TableOutlined', permission: 'dataset:read', group: 'manage', component: 'datasets' },

  // ---------- 分析与可视化 ----------
  { path: '/reports', name: '报表中心', icon: 'BarChartOutlined', permission: 'report:read', group: 'analysis', component: 'reports', mobile: true },
  { path: '/reports/:id/design', name: '报表设计', permission: 'report:write', hideInMenu: true, group: 'analysis', component: 'reports/Design' },
  { path: '/reports/:id/view', name: '报表查看', permission: 'report:read', hideInMenu: true, group: 'analysis', component: 'reports/View', mobile: true },
  { path: '/shares', name: '分享管理', icon: 'ShareAltOutlined', permission: 'share:read', group: 'analysis', component: 'shares', mobile: true },
  { path: '/ai', name: 'AI 问数', icon: 'RobotOutlined', permission: 'ai:read', group: 'analysis', component: 'ai', mobile: true },

  // ---------- 数据治理 ----------
  { path: '/governance', name: '治理总览', icon: 'SafetyOutlined', permission: 'governance:read', group: 'governance', component: 'governance' },
  { path: '/audit', name: '审计日志', icon: 'FileSearchOutlined', permission: 'audit:read', group: 'governance', component: 'audit' },

  // ---------- 系统管理 ----------
  { path: '/users', name: '用户管理', icon: 'TeamOutlined', permission: 'user:read', group: 'system', component: 'users' },
  { path: '/roles', name: '角色权限', icon: 'KeyOutlined', permission: 'role:read', group: 'system', component: 'roles' },
  { path: '/settings', name: '系统设置', icon: 'SettingOutlined', permission: 'setting:read', group: 'system', component: 'settings' },

  // ---------- 其他 ----------
  { path: '/intro', name: '项目介绍', icon: 'InfoCircleOutlined', group: 'other', component: 'intro', mobile: true },
  { path: '/help', name: '使用说明', icon: 'QuestionCircleOutlined', group: 'other', component: 'help', mobile: true },
  { path: '/profile', name: '个人中心', icon: 'UserOutlined', group: 'other', component: 'profile', mobile: true },
];

/** 需要移动端适配的路由集合 */
export const MOBILE_ROUTES = new Set(ROUTES.filter((r) => r.mobile).map((r) => r.path));

/** 公开路由（无需登录） */
export const PUBLIC_ROUTES = ['/login', '/register', '/forgot-password', '/reset-password'];
