/**
 * 顶部「浏览器式」多标签栏（V6.1）
 *
 * 用户原话：「顶部的多标签栏重构，不要用标签的方式体现已打开的页面，
 * 要用类似浏览器的显示方式呈现」。因此本组件**不再使用 antd Tabs**，
 * 而是用 div + flex 自绘浏览器标签带：
 *
 *  - 形态：圆角矩形 8px 8px 0 0，相邻标签边框贴合（右侧 -1px 重叠成一条线），
 *          激活标签白底 + 底部边框抹平（`margin-bottom:-1px` 压住 Header 下边框，
 *          白色与内容区连成一体），顶部 2px 主色指示条；
 *  - 非激活标签 NEUTRAL.surfaceAlt（`--v41-surface-alt`），hover 提亮到白色；
 *  - 内容：路由图标 + 标题（ellipsis，72~180px）+ 关闭 ×（hover 才明显，固定页无 ×）；
 *  - 溢出：容器横向滚动（隐藏原生滚动条）+ 左右滚动按钮，绝不撑破 Header；
 *  - 交互：右键菜单（关闭当前 / 其它 / 右侧 / 全部）、中键关闭、关闭后跳到相邻标签，
 *          '数据概览' 固定不可关，tabs/activeKey 由 stores/tabs.ts 持久化到 localStorage；
 *  - **不放刷新按钮、不放关闭全部按钮**（要求 6）。
 *
 * 视觉细节全部在 styles/global.css 的 `.v61-browser-tabs` 命名空间里，
 * 本文件只负责结构与行为。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dropdown } from 'antd';
import {
  CloseOutlined, LeftOutlined, MinusOutlined, RightOutlined,
  VerticalRightOutlined, ColumnWidthOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { matchRoute, useTabsStore } from '@/stores/tabs';
import { routeIcon } from './icons';

export default function TabsBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { tabs, activeKey, closeTab, closeOthers, closeAll, closeRight, setActive } = useTabsStore();

  const trackRef = useRef<HTMLDivElement>(null);
  /** 滚动按钮可用态（左/右是否还有被遮住的标签） */
  const [scrollable, setScrollable] = useState({ left: false, right: false });

  /** 当前路由变化时同步激活态（处理浏览器前进后退、外部跳转） */
  const currentPath = location.pathname;
  const effectiveActive = useMemo(() => {
    if (tabs.some((t) => t.key === currentPath)) return currentPath;
    return activeKey;
  }, [tabs, activeKey, currentPath]);

  /** 标签图标：与侧栏菜单同一份路由图标表 */
  const icons = useMemo(
    () => tabs.map((t) => routeIcon(matchRoute(t.key)?.icon)),
    [tabs]
  );

  /** 重新计算左右滚动按钮是否需要显示 */
  const updateScrollable = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setScrollable((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    updateScrollable();
    el.addEventListener('scroll', updateScrollable, { passive: true });
    window.addEventListener('resize', updateScrollable);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateScrollable) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollable);
      window.removeEventListener('resize', updateScrollable);
      ro?.disconnect();
    };
  }, [updateScrollable, tabs.length]);

  /**
   * 激活标签滚入可视区（新增标签 / 切换标签都会触发）。
   * `inline: 'nearest'` 保证只在需要时滚动，不会把标签栏无谓地左右挪动。
   */
  useEffect(() => {
    const el = trackRef.current?.querySelector<HTMLElement>('.v61-tab.is-active');
    if (!el) return;
    el.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [effectiveActive, tabs.length]);

  /** 左右滚动一屏的 60%（至少 160px） */
  const scrollByDirection = (dir: -1 | 1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(160, Math.round(el.clientWidth * 0.6)), behavior: 'smooth' });
  };

  /** 激活标签：先同步 store，再跳路由 */
  const activate = (key: string) => {
    setActive(key);
    if (currentPath !== key) navigate(key);
  };

  /** 关闭标签：store 返回「应当跳转的相邻标签」 */
  const closeTo = (key: string) => {
    const next = closeTab(key);
    if (next && next !== currentPath) navigate(next);
  };

  /** 右键菜单（浏览器式标签的必备能力） */
  const contextMenu = (key: string) => {
    const idx = tabs.findIndex((t) => t.key === key);
    const tab = tabs[idx];
    const hasRight = idx >= 0 && idx < tabs.length - 1;
    return {
      items: [
        {
          key: 'close',
          label: '关闭当前',
          icon: <CloseOutlined />,
          disabled: !tab?.closable,
          onClick: () => closeTo(key),
        },
        {
          key: 'others',
          label: '关闭其它',
          icon: <MinusOutlined />,
          disabled: tabs.filter((t) => t.closable).length <= 1,
          onClick: () => {
            closeOthers(key);
            if (currentPath !== key) navigate(key);
          },
        },
        {
          key: 'right',
          label: '关闭右侧',
          icon: <VerticalRightOutlined />,
          disabled: !hasRight,
          onClick: () => {
            closeRight(key);
            // 若当前页恰好被关掉，store 已把 activeKey 指向 key，这里跟着跳过去
            const next = useTabsStore.getState().activeKey;
            if (next !== currentPath) navigate(next);
          },
        },
        { type: 'divider' as const },
        {
          key: 'all',
          label: '关闭全部',
          icon: <ColumnWidthOutlined />,
          onClick: () => {
            closeAll();
            navigate('/dashboard');
          },
        },
      ],
    };
  };

  return (
    <div className="v61-browser-tabs" role="tablist" aria-label="已打开的页面">
      <button
        type="button"
        className="v61-tabs-scroll-btn"
        data-hidden={scrollable.left ? 'false' : 'true'}
        aria-label="向左滚动标签"
        tabIndex={scrollable.left ? 0 : -1}
        onClick={() => scrollByDirection(-1)}
      >
        <LeftOutlined />
      </button>

      <div className="v61-tabs-scroll" ref={trackRef}>
        {tabs.map((t, i) => {
          const active = t.key === effectiveActive;
          return (
            <Dropdown key={t.key} menu={contextMenu(t.key)} trigger={['contextMenu']}>
              <div
                role="tab"
                aria-selected={active}
                tabIndex={0}
                title={t.title}
                className={`v61-tab${active ? ' is-active' : ''}${t.closable ? '' : ' is-pinned'}`}
                onClick={() => activate(t.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activate(t.key);
                  }
                }}
                onAuxClick={(e) => {
                  // 浏览器习惯：鼠标中键关闭标签
                  if (e.button === 1 && t.closable) {
                    e.preventDefault();
                    closeTo(t.key);
                  }
                }}
              >
                {icons[i] ? <span className="v61-tab-icon">{icons[i]}</span> : null}
                <span className="v61-tab-title">{t.title}</span>
                {t.closable && (
                  <button
                    type="button"
                    className="v61-tab-close"
                    aria-label={`关闭 ${t.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTo(t.key);
                    }}
                  >
                    <CloseOutlined />
                  </button>
                )}
              </div>
            </Dropdown>
          );
        })}
      </div>

      <button
        type="button"
        className="v61-tabs-scroll-btn"
        data-hidden={scrollable.right ? 'false' : 'true'}
        aria-label="向右滚动标签"
        tabIndex={scrollable.right ? 0 : -1}
        onClick={() => scrollByDirection(1)}
      >
        <RightOutlined />
      </button>
    </div>
  );
}
