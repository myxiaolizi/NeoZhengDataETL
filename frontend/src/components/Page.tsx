/**
 * 标准页面容器（V4.1 统一规范）
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ 本页名称        搜索区...                     [新建]  [次要]   │  ← 标题行（不含任何介绍文案）
 * ├─────────────────────────────────────────────────────────────┤
 * │ 子标签页（可选，仅当本页有 Tab 时才出现）                      │  ← subTabs
 * ├─────────────────────────────────────────────────────────────┤
 * │ [卡片1] [卡片2] [卡片3] [卡片4] ...（1 排 3-8 个）             │  ← stats
 * ├─────────────────────────────────────────────────────────────┤
 * │ 本页内容与数据（表格 / 图表 / 看板）                           │  ← children
 * └─────────────────────────────────────────────────────────────┘
 *
 * 规范要点（用户明确要求）：
 *  1. 标签卡下方第一行就是「本页名称」，**不再显示任何页面介绍/说明文字**。
 *  2. 名称右侧紧跟搜索区；若本页有「新建」，新建按钮放在搜索按钮之后。
 *  3. 数据卡片 1 排 3-8 个；若有子标签页，数据卡片位于子标签页**下方**。
 *  4. 数据卡片下方才是本页内容。
 *  5. 查看类交互：内容少用 Modal，内容多用新页面；**禁止右侧抽屉（Drawer）**。
 */
import React from 'react';
import { Grid, Space } from 'antd';
import StatCards, { type StatCardItem } from './StatCards';
import { NEUTRAL } from '@/theme';

const { useBreakpoint } = Grid;

export interface PageProps {
  /** 本页名称（必填）。只写名称，不要写介绍语。 */
  title: React.ReactNode;
  /** 搜索区：搜索框 + 筛选器，渲染在名称右侧。 */
  search?: React.ReactNode;
  /** 主操作按钮（新建等），紧跟在搜索区之后。 */
  actions?: React.ReactNode;
  /** 数据卡片：1 排 3-8 个。传数组自动渲染，也可传自定义节点。 */
  stats?: StatCardItem[] | React.ReactNode;
  /** 子标签页。传入后它位于「标题行」与「数据卡片」之间。 */
  subTabs?: React.ReactNode;
  /** 标题行最右端的次要操作（刷新 / 视图切换等）。 */
  extra?: React.ReactNode;
  children?: React.ReactNode;
  /** @deprecated V4.1 起页面不再展示介绍文案；保留字段仅为兼容旧调用，传了也不渲染。 */
  subTitle?: React.ReactNode;
  /** @deprecated 同上，保留仅为兼容旧调用。 */
  hideSubOnMobile?: boolean;
}

export default function Page({
  title,
  search,
  actions,
  stats,
  subTabs,
  extra,
  children,
}: PageProps) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const statsNode = Array.isArray(stats) ? <StatCards items={stats as StatCardItem[]} /> : stats;

  /* 标题行：名称 → 搜索区 → 主操作 → 弹性空隙 → 次要操作 */
  const head = (
    <div
      style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : 'center',
        gap: isMobile ? 10 : 12,
        marginBottom: 14,
        paddingBottom: 14,
        borderBottom: `1px solid ${NEUTRAL.borderSubtle}`,
      }}
    >
      <div
        style={{
          fontSize: isMobile ? 17 : 19,
          fontWeight: 700,
          color: NEUTRAL.text,
          lineHeight: 1.3,
          whiteSpace: 'nowrap',
          flexShrink: 0,
          letterSpacing: '.2px',
        }}
      >
        {title}
      </div>

      {search ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
          {search}
        </div>
      ) : <div style={{ flex: 1 }} />}

      {actions ? (
        <Space size={8} wrap style={{ flexShrink: 0 }}>
          {actions}
        </Space>
      ) : null}

      <div style={{ flex: 1, minWidth: 0 }} />

      {extra ? (
        <Space size={8} style={{ flexShrink: 0 }}>
          {extra}
        </Space>
      ) : null}
    </div>
  );

  return (
    <div>
      {head}
      {subTabs ? <div style={{ marginBottom: 4, maxWidth: '100%', overflow: 'hidden' }}>{subTabs}</div> : null}
      {statsNode ? <div style={{ marginBottom: 14 }}>{statsNode}</div> : null}
      <div>{children}</div>
    </div>
  );
}
