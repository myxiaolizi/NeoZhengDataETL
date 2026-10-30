/** 应用入口 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import { NEUTRAL, PALETTE, SHADOW, SIDER } from './theme';
import './styles/global.css';

dayjs.locale('zh-cn');

/**
 * V4.1 品牌主题
 *
 * 本轮配色整治的核心（用户反馈原话）：
 *  「调整界面配色方案，使其颜色区分更加明显，当前白色和灰色显得灰蒙蒙一片；
 *    文字可以适量采用深色字体；左侧菜单栏采用蓝底白字。」
 *
 * 落地方式：
 *  1. 页面底色 → 浅蓝灰 NEUTRAL.pageBg（#EEF3FB），卡片纯白，形成底/卡分离；
 *  2. 边框 → 可见的 #CFDEF0（原来 rgba 低透明度蓝，几乎看不见）；
 *  3. 文字 → 主文字 #0B1F3B 深墨蓝，四个层级差值 ≥ 18%；
 *  4. 侧栏 → 深蓝渐变底 + 白字（layout 里注入渐变，这里给 antd 兜底纯色）；
 *  5. 表头 / 卡片头 → #EAF1FB 淡蓝底，与纯白内容区明确区分。
 *
 * 所有颜色均来自 @/theme，页面组件禁止再写死色值。
 */
export const THEME = {
  token: {
    colorPrimary: PALETTE.primary,
    colorInfo: PALETTE.primary,
    colorSuccess: PALETTE.green,
    colorWarning: PALETTE.yellow,
    colorError: PALETTE.red,
    colorLink: PALETTE.primary,
    colorTextBase: PALETTE.ink,

    // ---- 底色分层：底 / 容器 / 沉底 ----
    colorBgBase: NEUTRAL.surface,
    colorBgLayout: NEUTRAL.pageBg,
    colorBgContainer: NEUTRAL.surface,
    colorBgElevated: NEUTRAL.surface,
    colorBgSpotlight: PALETTE.ink,

    // ---- 分隔与层次（可见、不刺眼）----
    colorBorder: NEUTRAL.border,
    colorBorderSecondary: NEUTRAL.borderSubtle,
    colorSplit: NEUTRAL.borderSubtle,
    colorFillSecondary: NEUTRAL.surfaceSunken,
    colorFillTertiary: NEUTRAL.surfaceAlt,
    colorFillQuaternary: '#F8FAFE',

    // ---- 文字层级：深色、拉开对比 ----
    colorText: NEUTRAL.text,
    colorTextSecondary: NEUTRAL.textSecondary,
    colorTextTertiary: NEUTRAL.textTertiary,
    colorTextQuaternary: NEUTRAL.textQuaternary,
    colorTextPlaceholder: NEUTRAL.textQuaternary,

    borderRadius: 8,
    /** 卡片 / 弹窗 / 折叠面板统一 12：与页面内硬编码的卡片圆角保持一致 */
    borderRadiusLG: 12,
    fontSize: 14,

    // ---- 阴影：让卡片与浮层有明确的空间关系 ----
    boxShadow: SHADOW.card,
    boxShadowSecondary: SHADOW.raised,
    boxShadowTertiary: '0 1px 2px rgba(11,31,59,.06)',

    // ---- 控件高度：统一 34，页面更紧凑 ----
    controlHeight: 34,
    controlHeightLG: 40,
    controlHeightSM: 28,
  },
  components: {
    Layout: {
      headerBg: NEUTRAL.surface,
      siderBg: SIDER.bg,
      bodyBg: NEUTRAL.pageBg,
      headerHeight: 52,
      headerPadding: '0 16px',
    },
    /** 侧栏用 dark 模式：蓝底白字 */
    Menu: {
      darkItemBg: 'transparent',
      darkSubMenuItemBg: 'transparent',
      darkItemColor: SIDER.itemColor,
      darkItemHoverBg: SIDER.itemHoverBg,
      darkItemHoverColor: '#FFFFFF',
      darkItemSelectedBg: SIDER.itemSelectedBg,
      darkItemSelectedColor: SIDER.itemSelectedColor,
      darkGroupTitleColor: SIDER.groupTitleColor,
      darkPopupBg: SIDER.bgTo,
      itemBorderRadius: 8,
      itemMarginInline: 8,
      itemMarginBlock: 2,
      itemHeight: 38,
      groupTitleFontSize: 11,
      iconSize: 15,
      collapsedIconSize: 17,
      activeBarWidth: 0,
    },
    Card: {
      borderRadiusLG: 12,
      colorBorderSecondary: NEUTRAL.border,
      headerBg: NEUTRAL.surfaceAlt,
      headerFontSize: 14,
      headerHeight: 44,
      paddingLG: 16,
      colorTextHeading: NEUTRAL.text,
    },
    Table: {
      headerBg: NEUTRAL.surfaceSunken,
      headerColor: NEUTRAL.text,
      headerSplitColor: NEUTRAL.border,
      borderColor: NEUTRAL.border,
      rowHoverBg: '#F0F6FF',
      cellPaddingBlock: 11,
      headerBorderRadius: 8,
    },
    Tabs: {
      itemSelectedColor: PALETTE.primary,
      itemHoverColor: PALETTE.primaryLight,
      itemColor: NEUTRAL.textSecondary,
      inkBarColor: PALETTE.primary,
      titleFontSize: 14,
      horizontalItemPadding: '10px 0',
    },
    Input: {
      activeBorderColor: PALETTE.primary,
      hoverBorderColor: NEUTRAL.borderStrong,
      activeShadow: '0 0 0 3px rgba(22,104,227,.14)',
      paddingBlock: 6,
    },
    Select: {
      optionSelectedBg: 'rgba(22,104,227,.12)',
      optionSelectedColor: PALETTE.primaryDeep,
      optionActiveBg: NEUTRAL.surfaceAlt,
    },
    Button: {
      primaryShadow: '0 2px 6px rgba(22,104,227,.22)',
      defaultShadow: 'none',
      fontWeight: 500,
      paddingInline: 14,
    },
    Modal: {
      headerBg: NEUTRAL.surface,
      contentBg: NEUTRAL.surface,
      titleColor: NEUTRAL.text,
      titleFontSize: 16,
    },
    Drawer: {
      colorBgElevated: NEUTRAL.surface,
    },
    Descriptions: {
      labelBg: NEUTRAL.surfaceAlt,
      titleMarginBottom: 12,
      labelColor: NEUTRAL.textSecondary,
      contentColor: NEUTRAL.text,
    },
    Statistic: {
      contentFontSize: 24,
      titleFontSize: 12.5,
    },
    Alert: {
      withDescriptionPadding: '10px 14px',
      defaultPadding: '8px 12px',
    },
    Breadcrumb: {
      itemColor: NEUTRAL.textTertiary,
      lastItemColor: NEUTRAL.text,
      linkColor: NEUTRAL.textSecondary,
    },
    Pagination: {
      itemActiveBg: PALETTE.primary,
      colorPrimary: NEUTRAL.textInverse,
    },
    Tag: {
      defaultBg: NEUTRAL.surfaceAlt,
      defaultColor: NEUTRAL.textSecondary,
    },
    Divider: {
      colorSplit: NEUTRAL.borderSubtle,
    },
    Dropdown: {
      controlItemBgHover: NEUTRAL.surfaceAlt,
    },
    Form: {
      labelColor: NEUTRAL.textSecondary,
      labelFontSize: 13,
      verticalLabelPadding: '0 0 6px',
    },
    Tooltip: {
      colorBgSpotlight: '#12263F',
    },
    Progress: {
      defaultColor: PALETTE.primary,
      remainingColor: NEUTRAL.surfaceSunken,
    },
  },
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={THEME as any}>
      <AntApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
