/**
 * 统一页面标签栏（V9）
 *
 * 背景（用户明确要求）：
 *   「解决用户管理标签样式与邮件推送的标签样式不一样的问题，采用邮件推送的标签样式」
 *   「系统设置菜单页也采用标签样式，与邮件推送一致」
 *
 * 历史问题：
 *   - 邮件推送（mail-push.tsx）用的是**默认 line 型** Tabs（无 `type="card"`）；
 *   - 用户管理（users.tsx）却用了 `type="card"` + 自定义 `tabBarStyle`；
 *   - 系统设置（settings.tsx）更特殊，是「左侧分组导航卡 + 右侧表单」的两栏布局；
 *   三处视觉各不一样。
 *
 * 解决办法：抽出本组件作为**唯一实现**，三个页面全部用它。
 * 只要大家用同一个组件，样式就不可能再漂移 —— 这一条比「把参数抄一致」更可靠。
 *
 * 视觉规范（= 原邮件推送的观感，作为基准）：
 *  - 默认 line 型（底部指示条），不是 card 型（块状按钮）；
 *  - 标签文字 13.5px / 500，选中态品牌色 + 600；图标与文字间距 6px；
 *  - 标签栏底部统一 12px 间距，紧贴其下就是数据卡片；
 *  - 计数徽标统一用 <Tag>，规格见 `PageTabTag`；
 *  - 移动端允许横向滚动（antd 自带 more 折叠），不换行、不挤压。
 */
import React from 'react';
import { Tabs, Tag, Grid } from 'antd';
import { PALETTE, NEUTRAL } from '@/theme';

const { useBreakpoint } = Grid;

export interface PageTabItem {
  key: string;
  label: React.ReactNode;
  children?: React.ReactNode;
  disabled?: boolean;
}

export interface PageTabsProps {
  activeKey: string;
  onChange: (key: string) => void;
  items: PageTabItem[];
  /** 覆盖默认的标签栏下方间距（默认 12） */
  bottomGap?: number;
  /** 额外样式 */
  style?: React.CSSProperties;
}

/**
 * 标签栏内的“计数/状态”徽标。
 *
 * 统一规格：小号、圆角 6、半透明浅底 + 同色文字（不用 antd 默认实心 Tag，
 * 实心 Tag 在 line 型 Tabs 里视觉过重，会把标签文字压住）。
 */
export function PageTabTag({
  children,
  color = PALETTE.primary,
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <Tag
      style={{
        marginInlineStart: 6,
        marginInlineEnd: 0,
        fontSize: 11,
        lineHeight: '16px',
        padding: '0 6px',
        borderRadius: 6,
        border: 'none',
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color,
        fontWeight: 600,
      }}
    >
      {children}
    </Tag>
  );
}

/**
 * 标签项标题：图标 + 文字 +（可选）徽标。
 * 三个页面共用，保证「图标—文字—徽标」的间距完全一致。
 */
export function pageTabLabel(
  icon: React.ReactNode,
  text: React.ReactNode,
  badge?: React.ReactNode,
): React.ReactNode {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {icon ? <span style={{ fontSize: 13, opacity: 0.85 }}>{icon}</span> : null}
      <span>{text}</span>
      {badge}
    </span>
  );
}

export default function PageTabs({ activeKey, onChange, items, bottomGap = 12, style }: PageTabsProps) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  return (
    <Tabs
      /* 不传 type：默认 line 型（与邮件推送原样式一致，也是本组件的基准） */
      className="v9-page-tabs"
      activeKey={activeKey}
      onChange={onChange}
      items={items}
      size={isMobile ? 'small' : 'middle'}
      tabBarStyle={{
        marginBottom: bottomGap,
        borderBottom: `1px solid ${NEUTRAL.borderSubtle}`,
        ...style,
      }}
    />
  );
}
