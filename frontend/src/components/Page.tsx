/**
 * 标准页面容器（V6.1 统一规范）
 *
 * 布局（左：返回 + 名称；右：搜索 + 新建 + 次要操作）
 * ┌──────────────────────────────────────────────────────────────┐
 * │ [←] 本页名称          ………spacer………   [搜索区] [新建] [次要]   │
 * ├──────────────────────────────────────────────────────────────┤
 * │ [卡片1] [卡片2] [卡片3] …（1 排 3-8 个）                       │
 * ├──────────────────────────────────────────────────────────────┤
 * │ 子标签页（可选）                                              │
 * ├──────────────────────────────────────────────────────────────┤
 * │ 本页内容与数据                                                │
 * └──────────────────────────────────────────────────────────────┘
 *
 * V13 B2（本轮）：**数据卡片移到子标签页上方**。
 *   原顺序 head → subTabs → stats 已改为 head → stats → subTabs。
 *   用户原话：「每个标签页都显示的数据卡片，放在标签页上方；
 *             影响范围包括但不限于：邮件推送、报表中心、用户管理、系统设置」
 *   因为 Page 是这些页面的公共骨架，改这一处即全局生效。
 *
 * V6.1 相对 V4.1 的变化（逐条对应用户反馈）：
 *  1. **新增 `back`**：返回按钮渲染在**页面名称最左侧**（V4.1 里有的页面把返回
 *     放在 actions 里，视觉上落在中间，用户明确要求「最左侧页面名称前方」）。
 *  2. **搜索区与新建按钮改为靠右对齐**：V4.1 是「名称 → 搜索 → 新建」紧贴名称，
 *     用户要求「靠右对齐，而不是挨着页面名称的后方」。现在名称之后是弹性空隙，
 *     搜索 / 新建 / 次要操作整体右对齐。
 *  3. **不再提供刷新入口**：用户要求「所有的页面都不需要刷新按钮」。
 *     数据刷新统一由各页签切换 / 操作后的自动重载承担，
 *     `extra` 只放视图切换等非刷新用途。
 *
 * 规范要点：
 *  - 标题行只显示名称，不显示任何介绍/说明文案。
 *  - 数据卡片 1 排 3-8 个；**有子标签页时数据卡片在子标签页上方**（V13 B2）。
 *  - 查看类交互：内容少用 Modal，内容多用新页面；禁止右侧抽屉。
 */
import React from 'react';
import { Button, Grid, Space, Tooltip } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import StatCards, { type StatCardItem } from './StatCards';
import { NEUTRAL } from '@/theme';

const { useBreakpoint } = Grid;

export interface PageProps {
  /** 本页名称。只写名称，不要写介绍语。 */
  title: React.ReactNode;
  /**
   * 返回按钮 —— 渲染在标题**最左侧**。
   * `string` 视为目标路由（自动生成「返回」按钮），也可以直接传节点自定义。
   */
  back?: string | React.ReactNode;
  /** 返回按钮提示文案，默认「返回」 */
  backText?: string;
  /** 搜索区：搜索框 + 筛选器，渲染在标题行**右侧**。 */
  search?: React.ReactNode;
  /** 主操作按钮（新建等），紧跟搜索区右对齐。 */
  actions?: React.ReactNode;
  /** 数据卡片：1 排 3-8 个。传数组自动渲染，也可传自定义节点。 */
  stats?: StatCardItem[] | React.ReactNode;
  /** 子标签页。传入后它位于「数据卡片」**下方**（V13 B2：卡片上移）。 */
  subTabs?: React.ReactNode;
  /** 标题行最右端的次要操作（视图切换等）。**不要放刷新按钮**。 */
  extra?: React.ReactNode;
  children?: React.ReactNode;
  /** @deprecated 页面不再展示介绍文案；保留字段仅为兼容旧调用，传了也不渲染。 */
  subTitle?: React.ReactNode;
  /** @deprecated 同上。 */
  hideSubOnMobile?: boolean;
}

export default function Page({
  title,
  back,
  backText = '返回',
  search,
  actions,
  stats,
  subTabs,
  extra,
  children,
}: PageProps) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const navigate = useNavigate();

  const statsNode = Array.isArray(stats) ? <StatCards items={stats as StatCardItem[]} /> : stats;

  /** 返回按钮：字符串 → 自动生成图标按钮 */
  const backNode = back === undefined || back === null
    ? null
    : typeof back === 'string'
      ? (
        <Tooltip title={backText}>
          <Button
            className="v61-page-back"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate(back)}
            aria-label={backText}
            style={{ flexShrink: 0 }}
          />
        </Tooltip>
      )
      : back;

  /* 标题行：左 = 返回 + 名称；右 = 搜索 + 新建 + 次要操作 */
  const head = (
    <div
      className="v61-page-head"
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
      {/* 左侧：返回 + 名称 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexShrink: 0 }}>
        {backNode}
        <div
          className="v61-page-title"
          style={{
            fontSize: isMobile ? 17 : 19,
            fontWeight: 700,
            color: NEUTRAL.text,
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            letterSpacing: '.2px',
          }}
          title={typeof title === 'string' ? title : undefined}
        >
          {title}
        </div>
      </div>

      {/* 弹性空隙：把右侧操作整体推到最右 */}
      <div style={{ flex: 1, minWidth: 0 }} />

      {/* 右侧：搜索 → 新建 → 次要操作 */}
      {(search || actions || extra) && (
        <div
          className="v61-page-tools"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: isMobile ? 'flex-start' : 'flex-end',
            gap: 8,
            flexWrap: 'wrap',
            minWidth: 0,
            flexShrink: 0,
          }}
        >
          {search ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
              {search}
            </div>
          ) : null}
          {actions ? <Space size={8} wrap>{actions}</Space> : null}
          {extra ? <Space size={8}>{extra}</Space> : null}
        </div>
      )}
    </div>
  );

  return (
    <div>
      {head}
      {/*
        * V13 B2：数据卡片上移到子标签页**上方**。
        *
        * 根因：V6.1 起这里写死为 head → subTabs → stats → children，
        *       数据卡片一直在标签栏下方。用户要求「每个标签页都显示的数据卡片，
        *       放在标签页上方」，因此调整骨架顺序即可，无需改任何业务页面。
        *
        * 间距：stats 下 12（原 14，因为下面不再是 children 而是标签栏）；
        *       subTabs 外框 0、由 PageTabs 自身的 bottomGap(12) 负责与内容区拉开，
        *       避免原 4 + 12 叠加导致间距过大。
        */}
      {statsNode ? <div style={{ marginBottom: 12 }}>{statsNode}</div> : null}
      {subTabs ? <div style={{ marginBottom: 0, maxWidth: '100%', overflow: 'hidden' }}>{subTabs}</div> : null}
      <div>{children}</div>
    </div>
  );
}
