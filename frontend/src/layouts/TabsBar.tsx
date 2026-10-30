/**
 * 多标签页导航条（V4.1）
 *
 * V4.0 里它是 Header 下方**独立的一行**（还带 sticky top:56），
 * 加上面包屑，顶部实际占了「面包屑栏 + 标签栏」两行。
 *
 * V4.1 要求顶部只有一行：标签页在左、用户名在右。因此本组件不再自带
 * 背景 / 边框 / sticky / 内边距，只输出一条可横向滚动的标签带，
 * 由 BasicLayout 的 Header 负责容器样式（见 layouts/BasicLayout.tsx）。
 *
 * 溢出行为：antd Tabs 自带「更多」下拉（more），标签过多时自动收进下拉，
 * 不会被挤压或横向撑破布局。
 */
import React, { useMemo } from 'react';
import { Tabs, Dropdown, Grid, Button, Space, Tooltip } from 'antd';
import {
  CloseOutlined, ReloadOutlined, ColumnWidthOutlined,
  MinusOutlined, VerticalRightOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTabsStore } from '@/stores/tabs';

const { useBreakpoint } = Grid;

export default function TabsBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const { tabs, activeKey, closeTab, closeOthers, closeAll, closeRight, setActive } = useTabsStore();

  // 当前路由变化时同步激活态（处理浏览器前进后退）
  const currentPath = location.pathname;
  const effectiveActive = useMemo(() => {
    if (tabs.some((t) => t.key === currentPath)) return currentPath;
    return activeKey;
  }, [tabs, activeKey, currentPath]);

  /** 右键菜单 */
  const contextMenu = (key: string) => {
    const idx = tabs.findIndex((t) => t.key === key);
    const hasRight = idx >= 0 && idx < tabs.length - 1;
    return {
      items: [
        {
          key: 'close',
          label: '关闭当前',
          icon: <CloseOutlined />,
          disabled: !tabs[idx]?.closable,
          onClick: () => {
            const next = closeTab(key);
            if (next) navigate(next);
          },
        },
        {
          key: 'others',
          label: '关闭其它',
          icon: <MinusOutlined />,
          disabled: tabs.filter((t) => t.closable).length <= 1,
          onClick: () => { closeOthers(key); navigate(key); },
        },
        {
          key: 'right',
          label: '关闭右侧',
          icon: <VerticalRightOutlined />,
          disabled: !hasRight,
          onClick: () => closeRight(key),
        },
        { type: 'divider' as const },
        {
          key: 'all',
          label: '关闭全部',
          icon: <ColumnWidthOutlined />,
          onClick: () => { closeAll(); navigate('/dashboard'); },
        },
      ],
    };
  };

  const items = tabs.map((t) => {
    const label = (
      <Dropdown menu={contextMenu(t.key)} trigger={['contextMenu']}>
        <span className="v41-tab-label">
          {t.title}
          {t.closable && (
            <CloseOutlined
              className="v41-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                const next = closeTab(t.key);
                if (next) navigate(next);
              }}
            />
          )}
        </span>
      </Dropdown>
    );
    /*
     * closable: false —— 关闭按钮由上面的自定义 CloseOutlined 提供（它同时负责
     * 更新 tabs store 并跳转），关掉 antd 自带的 × 避免一个标签出现两个关闭按钮。
     */
    return { key: t.key, label, closable: false };
  });

  return (
    <div className="v41-tabs">
      <Tabs
        type="editable-card"
        hideAdd
        size="small"
        activeKey={effectiveActive}
        items={items}
        onChange={(key) => { setActive(key); navigate(key); }}
        onEdit={(key, action) => {
          if (action === 'remove' && typeof key === 'string') {
            const next = closeTab(key);
            if (next) navigate(next);
          }
        }}
        style={{ flex: 1, minWidth: 0, marginBottom: 0 }}
        tabBarStyle={{ marginBottom: 0, borderBottom: 'none' }}
        more={{ icon: <ColumnWidthOutlined /> }}
      />

      {!isMobile && (
        <Space size={2} className="v41-tabs-actions">
          <Tooltip title="刷新当前页">
            <Button
              type="text"
              size="small"
              aria-label="刷新当前页"
              icon={<ReloadOutlined />}
              onClick={() => window.location.reload()}
            />
          </Tooltip>
          <Tooltip title="关闭全部标签">
            <Button
              type="text"
              size="small"
              aria-label="关闭全部标签"
              icon={<ColumnWidthOutlined />}
              onClick={() => { closeAll(); navigate('/dashboard'); }}
            />
          </Tooltip>
        </Space>
      )}
    </div>
  );
}
