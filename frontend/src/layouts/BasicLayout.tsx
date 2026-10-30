/**
 * 主布局（V6.1）
 *
 * 本轮改动对应要求：
 *  1. 顶部「浏览器式标签栏」与「用户名」合并为一行 —— Header 左=标签带（横向滚动 +
 *     左右滚动按钮），右=头像+用户名下拉；**移除面包屑**，不显示当前菜单名称与路径。
 *  2. 菜单收起按钮从 Header 移到侧栏**底部**：品牌区（固定）→ 菜单区（可滚动）→ 底部工具区（固定）。
 *     移动端仍是左侧抽屉导航（抽屉内同样蓝底白字）。
 *  3. 侧栏品牌区显示「系统设置 → 平台名称」+ **站点副标题**（site_subtitle，
 *     为空时回退版本号 APP_VERSION），标题/副标题均 ellipsis；
 *     名称与副标题都来自 stores/app 的站点信息（fetchSite 后即时生效，无需重登）。
 *  4. 侧栏蓝底白字：Sider 深蓝竖直渐变（SIDER.bgFrom → SIDER.bgTo），Menu 用 dark 主题，
 *     菜单文字/选中/hover/分组标题全部由 @/theme 的 SIDER.* 决定（令牌在 main.tsx 配好），
 *     选中项左侧 3px 白色竖条由 global.css 的 .v41-sider 规则补。
 *  5. 页面底色 NEUTRAL.pageBg，Content 内边距桌面 16 / 移动 10。
 *  6. **无刷新按钮**（要求 6）：Header 与侧栏都不提供任何刷新/重载入口。
 *  7. fetchSite 成功后同步 document.title = 站点名称（index.html 里的 title 只是占位）。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Layout, Menu, Avatar, Dropdown, Grid, Drawer, Button } from 'antd';
import {
  LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, MenuOutlined, UserOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { APP_VERSION, useAppStore } from '@/stores/app';
import { useTabsStore } from '@/stores/tabs';
import TabsBar from './TabsBar';
import { MENU_ICONS } from './icons';
import { ROUTES, MENU_GROUPS } from '@/routes';
import { NEUTRAL, PALETTE, SHADOW, SIDER } from '@/theme';

const { Header, Sider, Content } = Layout;
const { useBreakpoint } = Grid;

/** 顶部栏高度，与 main.tsx 的 Layout.headerHeight 保持一致 */
const HEADER_HEIGHT = 52;
/** 侧栏展开宽度 */
const SIDER_WIDTH = 232;
/** 侧栏收起宽度 */
const SIDER_COLLAPSED_WIDTH = 64;

/** 侧栏竖直渐变：蓝底白字的底色 */
const SIDER_GRADIENT = `linear-gradient(180deg, ${SIDER.bgFrom} 0%, ${SIDER.bgTo} 100%)`;

export default function BasicLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    user, can, logout,
    siteName, siteSubtitle, siteLogoText,
    fetchSite,
  } = useAppStore();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { openTab, bindUser, reset: resetTabs } = useTabsStore();

  /** 侧栏品牌区是否显示文字（移动端抽屉里始终显示） */
  const showBrandText = !(collapsed && !isMobile);

  /** 站点名称兜底：store 里已兜底，这里再做一层防御，避免接口异常时品牌区空白 */
  const brandName = (siteName || '').trim() || 'Neo Zheng DataETL';
  const brandLogoText = (siteLogoText || '').trim().slice(0, 1) || 'N';
  /** 品牌区副标题：优先站点副标题（设置项 site_subtitle），为空才回退版本号 */
  const brandSubtitle = (siteSubtitle || '').trim() || APP_VERSION;

  /** 站点信息：挂载时取一次（公开接口，无需登录），成功后同步浏览器标题 */
  useEffect(() => {
    fetchSite();
  }, [fetchSite]);

  /**
   * 构建菜单项：按分组 + 权限过滤。
   *
   * 收起态（宽 64）不渲染分组标题 —— 否则只显示一条条空白的 group 分隔，
   * 直接把可见路由平铺，antd 会自动为每个图标项显示 title 提示。
   */
  const menuItems = useMemo(() => {
    const visibleOf = (groupKey: string) =>
      ROUTES.filter(
        (r) => r.group === groupKey && !r.hideInMenu && (!r.permission || can(r.permission))
      ).map((r) => ({
        key: r.path,
        icon: r.icon ? MENU_ICONS[r.icon] : undefined,
        label: r.name,
      }));

    if (collapsed && !isMobile) {
      return MENU_GROUPS.flatMap((g) => visibleOf(g.key));
    }

    return MENU_GROUPS.map((g) => {
      const children = visibleOf(g.key);
      if (!children.length) return null;
      return {
        key: g.key,
        type: 'group' as const,
        label: g.title || undefined,
        children,
      };
    }).filter(Boolean) as any[];
  }, [user, can, collapsed, isMobile]);

  /**
   * 当前选中项：最长前缀匹配，兼容 /projects/123
   *
   * 用**全量 ROUTES**（含 hideInMenu）匹配，保证 /dashboard/crm 这类不在菜单里的
   * 页面也能让菜单高亮到语义最近的父级。
   */
  const selectedKey = useMemo(() => {
    const path = location.pathname;
    const accessible = ROUTES.filter((r) => !r.permission || can(r.permission));
    const hit = accessible
      .filter((r) => path === r.path || path.startsWith(r.path + '/'))
      .sort((a, b) => b.path.length - a.path.length)[0];
    return hit ? [hit.path] : [];
  }, [location.pathname, user, can]);

  /**
   * 标签持久化按用户绑定：登录态就绪后载入该用户自己的 tabs/activeKey。
   *
   * 为什么不在 store 初始化时直接读 localStorage：被 401 踢出 / 换账号登录时，
   * 那份数据属于上一个账号，直接读会让新账号继承别人的标签列表。
   * user 变化（含登出置空）时重新绑定：登出 → 解绑并回到初始态。
   */
  useEffect(() => {
    bindUser(user?.username || null);
  }, [user?.username, bindUser]);

  /** 路由变化时同步标签页 */
  useEffect(() => {
    openTab(location.pathname);
  }, [location.pathname, openTab]);

  /** 退出登录时清空标签（并清掉 localStorage 持久化） */
  const handleLogout = async () => {
    resetTabs();
    await logout();
    navigate('/login');
  };

  useEffect(() => {
    if (isMobile) setCollapsed(false);
  }, [isMobile]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const menuNode = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={selectedKey}
      items={menuItems}
      onClick={({ key }) => navigate(key)}
      className="v41-sider-menu"
      // dark 令牌已把背景设为 transparent，这里再显式兜底，保证渐变底色透出来
      style={{ border: 'none', background: 'transparent', fontSize: 13.5 }}
    />
  );

  const userMenu = {
    items: [
      { key: 'profile', icon: <UserOutlined />, label: '个人中心' },
      { type: 'divider' as const },
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
    ],
    onClick: async ({ key }: { key: string }) => {
      if (key === 'profile') navigate('/profile');
      if (key === 'logout') {
        await handleLogout();
      }
    },
  };

  /** 品牌区：蓝底上的 logo 方块 + 站点名称 + 副标题（收起态只剩方块） */
  const brand = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexShrink: 0,
        minHeight: HEADER_HEIGHT,
        padding: showBrandText ? '10px 16px' : '10px 0',
        justifyContent: showBrandText ? 'flex-start' : 'center',
        borderBottom: `1px solid ${SIDER.divider}`,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 9,
          flex: '0 0 32px',
          background: SIDER.itemSelectedBg,
          color: NEUTRAL.textInverse,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: 16,
          boxShadow: '0 2px 8px rgba(0,0,0,.18)',
          userSelect: 'none',
        }}
      >
        {brandLogoText}
      </div>
      {showBrandText && (
        // minWidth:0 是 ellipsis 生效的前提（flex 子项默认 min-width:auto 不会收缩）
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            title={brandName}
            style={{
              fontSize: 13.5,
              fontWeight: 700,
              color: NEUTRAL.textInverse,
              lineHeight: 1.3,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {brandName}
          </div>
          <div
            title={brandSubtitle}
            style={{
              fontSize: 10.5,
              color: SIDER.groupTitleColor,
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {brandSubtitle}
          </div>
        </div>
      )}
    </div>
  );

  /** 侧栏底部工具区：菜单收起/展开按钮（固定，不随菜单滚动） */
  const siderFooter = (
    <div
      style={{
        flexShrink: 0,
        borderTop: `1px solid ${SIDER.divider}`,
        padding: collapsed ? '8px 0' : '8px 10px',
        display: 'flex',
        justifyContent: collapsed ? 'center' : 'flex-start',
      }}
    >
      <Button
        type="text"
        className="v41-sider-collapse"
        icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? '展开菜单' : '收起菜单'}
        style={{
          color: SIDER.itemColor,
          height: 34,
          width: collapsed ? 40 : '100%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: 8,
          borderRadius: 8,
          paddingInline: collapsed ? 0 : 10,
        }}
      >
        {!collapsed && '收起菜单'}
      </Button>
    </div>
  );

  return (
    <Layout style={{ minHeight: '100vh', background: NEUTRAL.pageBg }}>
      {/* 桌面端侧边栏：品牌区（固定）→ 菜单区（滚动）→ 底部工具区（固定） */}
      {!isMobile && (
        <Sider
          theme="dark"
          width={SIDER_WIDTH}
          collapsedWidth={SIDER_COLLAPSED_WIDTH}
          collapsed={collapsed}
          className="v41-sider"
          style={{
            background: SIDER_GRADIENT,
            position: 'sticky',
            top: 0,
            height: '100vh',
            overflow: 'hidden',
            borderRight: `1px solid ${SIDER.divider}`,
            boxShadow: SHADOW.card,
          }}
        >
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {brand}
            <div
              className="v41-sider-scroll"
              style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '8px 0' }}
            >
              {menuNode}
            </div>
            {siderFooter}
          </div>
        </Sider>
      )}

      {/* 移动端抽屉导航：同样蓝底白字 */}
      {isMobile && (
        <Drawer
          placement="left"
          width={252}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          closable={false}
          styles={{
            body: { padding: 0, background: SIDER_GRADIENT, display: 'flex', flexDirection: 'column' },
            content: { background: SIDER_GRADIENT },
            header: { display: 'none' },
          }}
        >
          {brand}
          <div
            className="v41-sider-scroll"
            style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '8px 0' }}
          >
            {menuNode}
          </div>
        </Drawer>
      )}

      <Layout style={{ background: NEUTRAL.pageBg }}>
        {/* 顶部单栏：左=浏览器式标签带，右=用户名。无面包屑、无刷新按钮。 */}
        <Header
          className="v41-header"
          style={{
            height: HEADER_HEIGHT,
            lineHeight: 'normal',
            background: NEUTRAL.surface,
            borderBottom: `1px solid ${NEUTRAL.border}`,
            padding: isMobile ? '0 8px' : '0 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            position: 'sticky',
            top: 0,
            zIndex: 20,
            // 注意：这里**不能**加 overflow:hidden —— 激活标签用 margin-bottom:-1px
            // 压住这条 1px 下边框来形成「标签与内容区连体」，被裁剪就看不到效果了。
            // 横向溢出由 TabsBar 自身的 scroll 容器负责，不会撑破 Header。
          }}
        >
          {isMobile && (
            <Button
              type="text"
              aria-label="打开导航菜单"
              icon={<MenuOutlined />}
              onClick={() => setDrawerOpen(true)}
              style={{ flexShrink: 0 }}
            />
          )}

          {/*
            标签带占据左侧全部可用宽度；溢出时自身横向滚动，不会撑破 Header。

            `height: calc(100% + 1px)` + `align-self: flex-start` 是「浏览器式标签
            与内容区连体」的关键：Header 是 border-box（height 52 含 1px 下边框），
            其 content box 只有 51px 高；若包裹层只用 height:100%，激活标签
            `margin-bottom:-1px` 想压住的那 1px 边框行会被顶到容器外而被裁掉，
            连体效果失效。多出 1px 让包裹层覆盖到边框行，激活标签的白底即可
            盖住灰边框、与下方内容区连成一片（已用等价 DOM 实测验证）。
          */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'flex-end',
              height: 'calc(100% + 1px)',
              alignSelf: 'flex-start',
            }}
          >
            <TabsBar />
          </div>

          <Dropdown menu={userMenu} placement="bottomRight" trigger={['click']}>
            <div
              className="v41-header-user"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexShrink: 0,
                height: 38,
                padding: '0 6px',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              <Avatar
                size={30}
                style={{
                  background: user?.avatarColor || PALETTE.primary,
                  fontSize: 13,
                  flexShrink: 0,
                }}
                src={user?.avatar || undefined}
              >
                {(user?.displayName || user?.username || '?').slice(0, 1)}
              </Avatar>
              {!isMobile && (
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: NEUTRAL.text,
                    maxWidth: 140,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {user?.displayName || user?.username}
                </span>
              )}
            </div>
          </Dropdown>
        </Header>

        <Content
          style={{
            padding: isMobile ? 10 : 16,
            background: NEUTRAL.pageBg,
            minHeight: 0,
          }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
