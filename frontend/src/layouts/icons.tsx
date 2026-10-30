/**
 * 菜单 / 标签页图标表
 *
 * `routes.ts` 里只存图标**名字符串**（避免路由表 import React 组件），
 * 由本文件把名字映射成 antd 图标节点。侧栏菜单与顶部浏览器式标签共用这一份，
 * 保证同一个页面在菜单和标签上的图标一致。
 */
import React from 'react';
import {
  DashboardOutlined, ProjectOutlined, FormOutlined, SwapOutlined, MailOutlined,
  NodeIndexOutlined, DatabaseOutlined, TableOutlined, BarChartOutlined, ShareAltOutlined,
  RobotOutlined, SafetyOutlined, FileSearchOutlined, TeamOutlined, KeyOutlined,
  SettingOutlined, InfoCircleOutlined, QuestionCircleOutlined, UserOutlined,
  FundOutlined, FundProjectionScreenOutlined,
} from '@ant-design/icons';

export const MENU_ICONS: Record<string, React.ReactNode> = {
  DashboardOutlined: <DashboardOutlined />,
  FundOutlined: <FundOutlined />,
  FundProjectionScreenOutlined: <FundProjectionScreenOutlined />,
  ProjectOutlined: <ProjectOutlined />,
  FormOutlined: <FormOutlined />,
  SwapOutlined: <SwapOutlined />,
  MailOutlined: <MailOutlined />,
  NodeIndexOutlined: <NodeIndexOutlined />,
  DatabaseOutlined: <DatabaseOutlined />,
  TableOutlined: <TableOutlined />,
  BarChartOutlined: <BarChartOutlined />,
  ShareAltOutlined: <ShareAltOutlined />,
  RobotOutlined: <RobotOutlined />,
  SafetyOutlined: <SafetyOutlined />,
  FileSearchOutlined: <FileSearchOutlined />,
  TeamOutlined: <TeamOutlined />,
  KeyOutlined: <KeyOutlined />,
  SettingOutlined: <SettingOutlined />,
  InfoCircleOutlined: <InfoCircleOutlined />,
  QuestionCircleOutlined: <QuestionCircleOutlined />,
  UserOutlined: <UserOutlined />,
};

/** 按 routes.ts 的图标名取图标节点；未知名称返回 null（不渲染图标） */
export function routeIcon(iconName?: string): React.ReactNode {
  if (!iconName) return null;
  return MENU_ICONS[iconName] || null;
}
