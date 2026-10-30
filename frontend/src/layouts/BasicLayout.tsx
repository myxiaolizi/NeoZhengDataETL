/** 主布局：Ant Design Pro 风格侧边栏 + 顶部栏，响应式 */
import React, { useEffect, useMemo, useState } from 'react';
import { Layout, Menu, Avatar, Dropdown, Grid, Drawer, Button, Space, Tooltip, Breadcrumb } from 'antd';
import {
  DashboardOutlined, ProjectOutlined, FormOutlined, SwapOutlined, MailOutlined,
  NodeIndexOutlined, DatabaseOutlined, TableOutlined, BarChartOutlined, ShareAltOutlined,
  RobotOutlined, SafetyOutlined, FileSearchOutlined, TeamOutlined, KeyOutlined,
  SettingOutlined, InfoCircleOutlined, QuestionCircleOutlined, UserOutlined,
  LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, FundOutlined, MenuOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppStore } from '@/stores/app';
import { ROUTES, MENU_GROUPS } from '@/routes';

const { Header, Sider, Content } = Layout;
const { useBreakpoint } = Grid;

const ICONS: Record<string, React.ReactNode> = {
  DashboardOutlined: <DashboardOutlined />,
  FundOutlined: <FundOutlined />,
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

export default function BasicLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, can, logout } = useAppStore();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  /** 构建菜单项：按分组 + 权限过滤 */
  const menuItems = useMemo(() => {
    return MENU_GROUPS.map((g) => {
      const children = ROUTES.filter((r) => r.group === g.key && !r.hideInMenu && (!r.permission || can(r.permission)));
      if (!children.length) return null;
      return {
        key: g.key,
        type: 'group' as const,
        label: g.title || undefined,
        children: children.map((r) => ({
          key: r.path,
          icon: r.icon ? ICONS[r.icon] : undefined,
          label: r.name,
        })),
      };
    }).filter(Boolean) as any[];
  }, [user, can]);

  /** 当前选中项：最长前缀匹配，兼容 /projects/123 */
  const selectedKey = useMemo(() => {
    const path = location.pathname;
    const visible = ROUTES.filter((r) => !r.hideInMenu && (!r.permission || can(r.permission)));
    const hit = visible
      .filter((r) => path === r.path || path.startsWith(r.path + '/'))
      .sort((a, b) => b.path.length - a.path.length)[0];
    return hit ? [hit.path] : [];
  }, [location.pathname, user, can]);

  const currentRoute = useMemo(
    () => ROUTES.find((r) => selectedKey.includes(r.path)),
    [selectedKey]
  );

  useEffect(() => {
    if (isMobile) setCollapsed(false);
  }, [isMobile]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const menu = (
    <Menu
      mode="inline"
      selectedKeys={selectedKey}
      items={menuItems}
      onClick={({ key }) => navigate(key)}
      style={{ border: 'none', fontSize: 13.5 }}
    />
  );

  const userMenu = {
    items: [
      { key: 'profile', icon: <UserOutlined />, label: '个人中心' },
      { type: 'divider' as const },
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
    ],
    onClick: async ({ key }: any) => {
      if (key === 'profile') navigate('/profile');
      if (key === 'logout') {
        await logout();
        navigate('/login');
      }
    },
  };

  const brand = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 56 }}>
      <div
        style={{
          width: 32, height: 32, borderRadius: 9, flex: '0 0 32px',
          background: 'linear-gradient(135deg, #2D6FE4, #3687FF)',
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 16,
        }}
      >
        N
      </div>
      {!collapsed && !isMobile && (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#003378', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Neo Zheng DataETL
          </div>
          <div style={{ fontSize: 10.5, color: '#B5B5B6', lineHeight: 1.2 }}>V4.0</div>
        </div>
      )}
    </div>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* 桌面端侧边栏 */}
      {!isMobile && (
        <Sider
          width={232}
          collapsedWidth={64}
          collapsed={collapsed}
          theme="light"
          style={{ borderRight: '1px solid #DCDDDD', position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}
        >
          {brand}
          <div style={{ padding: '8px 0 24px' }}>{menu}</div>
        </Sider>
      )}

      {/* 移动端抽屉 */}
      {isMobile && (
        <Drawer
          placement="left"
          width={248}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          styles={{ body: { padding: 0 } }}
          closable={false}
        >
          {brand}
          <div style={{ padding: '8px 0 24px' }}>{menu}</div>
        </Drawer>
      )}

      <Layout>
        <Header
          style={{
            background: '#FFFFFF',
            borderBottom: '1px solid #DCDDDD',
            padding: isMobile ? '0 12px' : '0 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            zIndex: 20,
          }}
        >
          <Space size={8}>
            {isMobile ? (
              <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} />
            ) : (
              <Button
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed(!collapsed)}
              />
            )}
            <Breadcrumb
              items={[
                ...(currentRoute?.group && currentRoute.group !== 'overview'
                  ? [{ title: MENU_GROUPS.find((g) => g.key === currentRoute.group)?.title }]
                  : []),
                { title: currentRoute?.name || '数据概览' },
              ]}
            />
          </Space>

          <Dropdown menu={userMenu} placement="bottomRight" trigger={['click']}>
            <Space style={{ cursor: 'pointer' }} size={8}>
              <Avatar
                size={30}
                style={{ background: user?.avatarColor || '#2D6FE4', fontSize: 13 }}
                src={user?.avatar || undefined}
              >
                {(user?.displayName || user?.username || '?').slice(0, 1)}
              </Avatar>
              {!isMobile && (
                <span style={{ fontSize: 13, color: '#003378' }}>
                  {user?.displayName || user?.username}
                </span>
              )}
            </Space>
          </Dropdown>
        </Header>

        <Content style={{ padding: isMobile ? 12 : 20, background: '#FFFFFF' }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
