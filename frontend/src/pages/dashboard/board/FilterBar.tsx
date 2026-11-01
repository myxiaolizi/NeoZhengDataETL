/** 看板筛选区 — V10
 *
 * 6 个筛选控件（从左到右）：日期 / 区域 / 连锁类型 / 销售 / 全部筛选条件 / 重置
 *
 * V10 改动：
 *   T1 修复图标裁切 —— 原 ICON.region / ICON.sales 把 <circle> 写在 <svg> 外面，
 *      导致 circle 被渲染成按钮的裸子元素（实测 0×0 尺寸，肉眼看起来「图标缺一半」）。
 *      改为全内联在同一个 <svg> 内。
 *   T2 日历改用官方 DatePicker.RangePicker（presets 快捷项 + 深色字面色值覆盖）
 *   T4 「全部筛选条件」由右侧 Drawer 改为居中 Modal
 *   T5 区域/连锁类型/销售弹窗改 2 列网格 + 大号选项按钮（≥40px / 13px）
 *   T6 未选显示维度名、选中显示结果；去掉按钮外框
 *
 * 纯展示组件：状态由 Board.tsx 持有，这里只 onChange 回传补丁。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Checkbox, DatePicker, Empty, Input, Modal, Space, Tooltip,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import type {
  BoardCounts, BoardFilters, BoardOptions, DatePreset,
} from '@/api/crm-board';
import { useThemeMode } from './theme';

const { RangePicker } = DatePicker;

/* ══════════════ 弹层令牌重声明（T5 关键修复） ══════════════
 *
 * antd 的 Modal/Dropdown 会 portal 到 <body>，**取不到 .board-root 上的 CSS 变量**。
 * 实测（v10-vars.cjs）：弹窗内 --brand/--line/--text/--fs-sm/--radius-sm 全部为空字符串，
 * 导致选项按钮回落到 antd 默认值：font-size 14px（应 13px）、
 * border-radius 0（应 10px）、border 取到 antd 文字色 rgb(11,31,59)（应 --line #e3e9f2）。
 *
 * 解决：用 useBoardTokens() 从 .board-root 读到真实值（含 --brand 用户主题色），
 * 在弹窗内容根节点上以**内联字面值**重新声明这些变量，子元素即可正常继承。
 * 这是契约 §六-9 允许的「重新声明令牌」做法。
 */
interface BoardTokens {
  '--panel': string;
  '--panel2': string;
  '--line': string;
  '--line2': string;
  '--text': string;
  '--text2': string;
  '--text3': string;
  '--brand': string;
  '--brand3': string;
  '--brandSoft': string;
  '--danger': string;
  '--radius-sm': string;
  '--fs-2xs': string;
  '--fs-xs': string;
  '--fs-sm': string;
}

const TOKENS_LIGHT: BoardTokens = {
  '--panel': '#ffffff',
  '--panel2': '#f8fafd',
  '--line': '#e3e9f2',
  '--line2': '#edf1f8',
  '--text': '#0f172a',
  '--text2': '#475569',
  '--text3': '#8494ab',
  '--brand': '#2563eb',
  '--brand3': '#60a5fa',
  '--brandSoft': '#eff5ff',
  '--danger': '#dc2626',
  '--radius-sm': '10px',
  '--fs-2xs': '11px',
  '--fs-xs': '12px',
  '--fs-sm': '13px',
};

const TOKENS_DARK: BoardTokens = {
  '--panel': '#141e33',
  '--panel2': '#1a2740',
  '--line': '#243356',
  '--line2': '#1d2a47',
  '--text': '#e8eef8',
  '--text2': '#9db0cc',
  '--text3': '#6d81a3',
  '--brand': '#2563eb',
  '--brand3': '#93c5fd',
  '--brandSoft': '#16294a',
  '--danger': '#f87171',
  '--radius-sm': '10px',
  '--fs-2xs': '11px',
  '--fs-xs': '12px',
  '--fs-sm': '13px',
};

/**
 * 读取看板令牌用于弹层重声明。
 * 优先取 .board-root 上的真实值（这样用户自定义的 --brand 主题色也能带进弹层），
 * 取不到时回落到本节的字面值。
 */
function useBoardTokens(): React.CSSProperties {
  const mode = useThemeMode();
  const [brand, setBrand] = useState<string>('');

  useEffect(() => {
    const el = document.querySelector('.board-root');
    if (!el) return;
    const v = getComputedStyle(el).getPropertyValue('--brand').trim();
    if (v) setBrand(v);
  }, [mode]);

  const base = mode === 'dark' ? TOKENS_DARK : TOKENS_LIGHT;
  return (brand ? { ...base, '--brand': brand } : base) as unknown as React.CSSProperties;
}

/* ══════════════ 日历弹层样式（T2） ══════════════
 *
 * 弹层被 antd portal 到 <body>，取不到 .board-root 上的 CSS 变量
 * （实测 .ant-modal-container / body 上 --brand/--line/--text 全部为空），
 * 所以这里必须用**字面色值**，并按 V10 §三 令牌一对一声明：
 *
 *   亮色：--panel #ffffff · --line #e3e9f2 · --text #0f172a
 *         --text2 #475569 · --text3 #8494ab · --brand #2563eb
 *   深色：--panel #141e33 · --line #243356 · --text #e8eef8
 *         --text2 #9db0cc · --text3 #6d81a3 · --brand #2563eb
 *
 * 圆角用 --radius 的 14px 视觉值取 12px（弹层比卡片略紧），阴影用 --shadow2 等价字面量。
 */
const CAL_CSS = `
/* ── 面板容器 ── */
.board-cal .ant-picker-panel-container{
  border-radius:12px!important;
  border:1px solid #e3e9f2!important;
  box-shadow:0 4px 16px rgba(15,23,42,.09)!important;
  overflow:hidden!important;
}
.board-cal .ant-picker-panel{border-radius:0!important}
.board-cal .ant-picker-header{
  border-bottom:1px solid #e3e9f2!important;
  color:#0f172a!important;
  padding:8px 10px!important;
}
.board-cal .ant-picker-header button{color:#475569!important}
.board-cal .ant-picker-header-view{font-weight:600!important;color:#0f172a!important}
.board-cal .ant-picker-content th{color:#8494ab!important;font-weight:600!important}
.board-cal .ant-picker-cell{padding:2px 0!important}
.board-cal .ant-picker-cell .ant-picker-cell-inner{
  border-radius:8px!important;
  min-width:26px!important;
  height:26px!important;
  line-height:26px!important;
  font-size:12px!important;
  transition:background .14s ease,color .14s ease!important;
}
.board-cal .ant-picker-cell-in-view{color:#0f172a!important}
/* 非本月日期：用 :not() 降低权重，避免覆盖上面的 in-view 配色
   （两者同为「属性+3类」特异性，若用通配 .ant-picker-cell 且写在后面会把 in-view 覆盖掉） */
.board-cal .ant-picker-cell:not(.ant-picker-cell-in-view){color:#8494ab!important}
.board-cal .ant-picker-cell:hover .ant-picker-cell-inner{background:#eff5ff!important}
.board-cal .ant-picker-cell-today .ant-picker-cell-inner{
  border:1px solid #60a5fa!important;
  color:#2563eb!important;
  font-weight:600!important;
}
.board-cal .ant-picker-cell-in-view.ant-picker-cell-selected .ant-picker-cell-inner,
.board-cal .ant-picker-cell-in-view.ant-picker-cell-range-start .ant-picker-cell-inner,
.board-cal .ant-picker-cell-in-view.ant-picker-cell-range-end .ant-picker-cell-inner{
  background:#2563eb!important;color:#fff!important;font-weight:600!important;
}
.board-cal .ant-picker-cell-in-view.ant-picker-cell-in-range::before{background:#eff5ff!important}
.board-cal .ant-picker-presets{border-right:1px solid #e3e9f2!important;padding:8px 4px!important}
.board-cal .ant-picker-presets ul{list-style:none!important;margin:0!important;padding:0!important}
/* 注意：antd 6 的 presets 项渲染为 <li>，不是 <button> */
.board-cal .ant-picker-presets li{
  border-radius:8px!important;color:#475569!important;font-size:12px!important;
  padding:6px 10px!important;margin:2px 4px!important;cursor:pointer!important;
  transition:background .14s ease,color .14s ease!important;
}
.board-cal .ant-picker-presets li:hover{background:#eff5ff!important;color:#2563eb!important}
.board-cal .ant-picker-footer{border-top:1px solid #e3e9f2!important}
.board-cal .ant-picker-today-btn{color:#2563eb!important}

/* ── 深色（字面色值，见上方令牌映射） ── */
html[data-theme='dark'] .board-cal .ant-picker-panel-container{
  background:#141e33!important;
  border-color:#243356!important;
  box-shadow:0 4px 16px rgba(0,0,0,.42)!important;
}
html[data-theme='dark'] .board-cal .ant-picker-header{
  border-bottom-color:#243356!important;color:#e8eef8!important;
}
html[data-theme='dark'] .board-cal .ant-picker-header button{color:#9db0cc!important}
html[data-theme='dark'] .board-cal .ant-picker-header-view{color:#e8eef8!important}
html[data-theme='dark'] .board-cal .ant-picker-content th{color:#6d81a3!important}
html[data-theme='dark'] .board-cal .ant-picker-cell-in-view{color:#e8eef8!important}
html[data-theme='dark'] .board-cal .ant-picker-cell:not(.ant-picker-cell-in-view){color:#6d81a3!important}
html[data-theme='dark'] .board-cal .ant-picker-cell-inner{color:inherit!important}
html[data-theme='dark'] .board-cal .ant-picker-cell:hover .ant-picker-cell-inner{background:#1a2740!important}
html[data-theme='dark'] .board-cal .ant-picker-cell-today .ant-picker-cell-inner{
  border-color:#60a5fa!important;color:#93c5fd!important;
}
html[data-theme='dark'] .board-cal .ant-picker-cell-in-view.ant-picker-cell-selected .ant-picker-cell-inner,
html[data-theme='dark'] .board-cal .ant-picker-cell-in-view.ant-picker-cell-range-start .ant-picker-cell-inner,
html[data-theme='dark'] .board-cal .ant-picker-cell-in-view.ant-picker-cell-range-end .ant-picker-cell-inner{
  background:#2563eb!important;color:#fff!important;
}
html[data-theme='dark'] .board-cal .ant-picker-cell-in-view.ant-picker-cell-in-range::before{background:#16294a!important}
html[data-theme='dark'] .board-cal .ant-picker-presets{border-right-color:#243356!important}
html[data-theme='dark'] .board-cal .ant-picker-presets li{color:#9db0cc!important}
html[data-theme='dark'] .board-cal .ant-picker-presets li:hover{background:#1a2740!important;color:#93c5fd!important}
html[data-theme='dark'] .board-cal .ant-picker-footer{border-top-color:#243356!important;background:#141e33!important}
html[data-theme='dark'] .board-cal .ant-picker-today-btn{color:#93c5fd!important}
html[data-theme='dark'] .board-cal .ant-picker-panel,
html[data-theme='dark'] .board-cal .ant-picker-body{background:transparent!important}
html[data-theme='dark'] .board-cal .ant-picker-input > input{color:#e8eef8!important}
html[data-theme='dark'] .board-cal .ant-picker-range-separator{color:#6d81a3!important}
`;

/* ══════════════ 筛选 chip 样式 ══════════════ */

/**
 * 筛选 chip：30px 高、8px 圆角。
 * V10 T6：去掉外框 —— 默认透明底 + 透明边，hover / 选中才有视觉反馈。
 * 为保证 chip 仍能被辨识，默认用 --panel2 底（面板白底上仍有细微层次），
 * 并以 hover 的品牌色底作为主要交互反馈。
 */
const BTN_BASE: React.CSSProperties = {
  height: 30,
  padding: '0 10px',
  borderRadius: 8,
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--text2)',
  fontSize: 'var(--fs-xs)',
  fontWeight: 500,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
  transition: 'background .16s ease, color .16s ease, border-color .16s ease, box-shadow .16s ease',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  lineHeight: 1,
  flexShrink: 0,
  // 防止 SVG 被 flex 压扁（T1 的次要加固）
  overflow: 'visible',
};

/** 已激活：品牌色实心 + 白字 + 轻微阴影 */
const BTN_ON: React.CSSProperties = {
  ...BTN_BASE,
  background: 'var(--brand)',
  borderColor: 'var(--brand)',
  color: '#fff',
  fontWeight: 600,
  boxShadow: '0 2px 6px color-mix(in srgb, var(--brand) 26%, transparent)',
};

/** hover 进 / 出（未激活态） */
const chipHoverOn = (el: HTMLElement) => {
  el.style.background = 'var(--brandSoft)';
  el.style.color = 'var(--brand)';
  el.style.borderColor = 'color-mix(in srgb, var(--brand) 20%, transparent)';
};
const chipHoverOff = (el: HTMLElement) => {
  el.style.background = 'transparent';
  el.style.color = 'var(--text2)';
  el.style.borderColor = 'transparent';
};

/** 计数徽标（字号 ≥11px） */
function CountBadge({ n, on }: { n: number; on?: boolean }) {
  return (
    <span
      style={{
        fontSize: 'var(--fs-2xs)',
        fontWeight: 700,
        padding: '0 5px',
        borderRadius: 5,
        lineHeight: '16px',
        minWidth: 16,
        textAlign: 'center',
        background: on ? 'rgba(255,255,255,.24)' : 'color-mix(in srgb, var(--brand) 12%, transparent)',
        color: on ? '#fff' : 'var(--brand)',
      }}
    >
      {n}
    </span>
  );
}

/* ══════════════ 图标（T1：所有图元必须内联在同一个 <svg> 内） ══════════════ */

interface IconProps {
  children: React.ReactNode;
  size?: number;
}

/** 统一 SVG 外壳；width/height 固定 + flexShrink:0，避免任何挤压变形 */
function Icon({ children, size = 15 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, display: 'block', overflow: 'visible' }}
    >
      {children}
    </svg>
  );
}

const ICON = {
  /** 日期 */
  calendar: (
    <Icon>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M7 3v4M17 3v4" />
    </Icon>
  ),
  /** 区域：定位针（圆点必须在 svg 内 —— V10 T1 修复点） */
  region: (
    <Icon>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1116 0z" />
      <circle cx="12" cy="10" r="3" />
    </Icon>
  ),
  /** 连锁类型：店铺 */
  type: (
    <Icon>
      <path d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6" />
    </Icon>
  ),
  /** 销售：人形（头部圆必须在 svg 内 —— V10 T1 修复点） */
  sales: (
    <Icon>
      <circle cx="12" cy="7" r="4" />
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    </Icon>
  ),
  /** 全部筛选条件：漏斗 */
  filter: (
    <Icon>
      <path d="M3 5h18l-7 8v6l-4-2v-4L3 5z" />
    </Icon>
  ),
  /** 重置 */
  reset: (
    <Icon>
      <path d="M3 12a9 9 0 109-9 9 9 0 00-6.36 2.64L3 8" />
      <path d="M3 3v5h5" />
    </Icon>
  ),
};

interface Props {
  filters: BoardFilters;
  onChange: (patch: Partial<BoardFilters>) => void;
  onReset: () => void;
  options: BoardOptions;
  counts: BoardCounts;
  isMobile: boolean;
}

/* ══════════════ 日期区间计算（与后端口径一致） ══════════════ */

function presetRange(preset: DatePreset, today = dayjs()): [string, string] | null {
  const t = today.startOf('day');
  switch (preset) {
    case 'today':
      return [t.format('YYYY-MM-DD'), t.format('YYYY-MM-DD')];
    case 'yesterday': {
      const y = t.subtract(1, 'day');
      return [y.format('YYYY-MM-DD'), y.format('YYYY-MM-DD')];
    }
    case 'thisWeek': {
      const mon = t.subtract((t.day() + 6) % 7, 'day');
      return [mon.format('YYYY-MM-DD'), mon.add(6, 'day').format('YYYY-MM-DD')];
    }
    case 'lastWeek': {
      const mon = t.subtract((t.day() + 6) % 7, 'day').subtract(7, 'day');
      return [mon.format('YYYY-MM-DD'), mon.add(6, 'day').format('YYYY-MM-DD')];
    }
    case 'thisMonth': {
      const first = t.startOf('month');
      return [first.format('YYYY-MM-DD'), first.endOf('month').format('YYYY-MM-DD')];
    }
    case 'lastMonth': {
      const first = t.subtract(1, 'month').startOf('month');
      return [first.format('YYYY-MM-DD'), first.endOf('month').format('YYYY-MM-DD')];
    }
    default:
      return null;
  }
}

const PRESET_LABELS: { key: DatePreset; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: 'thisWeek', label: '本周' },
  { key: 'lastWeek', label: '上周' },
  { key: 'thisMonth', label: '本月' },
  { key: 'lastMonth', label: '上月' },
];

/** 日期按钮文案 */
function dateButtonLabel(f: BoardFilters): string {
  if (f.datePreset === 'all') return '全部时间';
  const preset = PRESET_LABELS.find((p) => p.key === f.datePreset);
  if (preset) return preset.label;
  if (f.datePreset === 'custom' && f.dateFrom) {
    const a = dayjs(f.dateFrom);
    const b = dayjs(f.dateTo || f.dateFrom);
    if (!a.isValid()) return '全部时间';
    if (!b.isValid() || a.isSame(b, 'day')) return a.format('MM/DD');
    return `${a.format('MM/DD')}-${b.format('MM/DD')}`;
  }
  return '全部时间';
}

/**
 * 维度按钮文案（T6）：
 *   未选 → 维度名本身（区域 / 连锁类型 / 销售）
 *   选中 1 个 → 该值名（南区 / 全国百强 / 张三）
 *   选中多个 → 「已选 N 项」
 */
function dimensionLabel(values: string[], dimensionName: string): string {
  if (!values.length) return dimensionName;
  if (values.length === 1) return values[0];
  return `已选 ${values.length} 项`;
}

/* ══════════════ 多选弹窗（T5：2 列网格 + 大号选项） ══════════════ */

interface MultiSelectProps {
  dimension: string;
  icon: React.ReactNode;
  values: string[];
  options: string[];
  counts?: Record<string, number>;
  onApply: (next: string[]) => void;
  searchable?: boolean;
  isMobile: boolean;
}

function MultiSelect({
  dimension, icon, values, options, counts, onApply, searchable, isMobile,
}: MultiSelectProps) {
  const tokens = useBoardTokens();
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState('');
  const [draft, setDraft] = useState<string[]>(values);
  /**
   * draft 的实时镜像。
   * 「确定」按钮和选项按钮在同一渲染周期，若直接读 draft 闭包变量，
   * 会在「勾选后立刻点确定」时读到旧值（自动化测试必现）。
   */
  const draftRef = useRef<string[]>(values);

  const openPanel = () => {
    draftRef.current = values;
    setDraft(values);
    setKw('');
    setOpen(true);
  };

  const applyDraft = () => {
    onApply(draftRef.current);
    setOpen(false);
  };

  const clearDraft = () => {
    draftRef.current = [];
    setDraft([]);
  };

  const shown = useMemo(() => {
    const k = kw.trim().toLowerCase();
    return k ? options.filter((o) => o.toLowerCase().includes(k)) : options;
  }, [options, kw]);

  const active = values.length > 0;

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        style={active ? BTN_ON : BTN_BASE}
        onMouseEnter={(e) => { if (!active) chipHoverOn(e.currentTarget); }}
        onMouseLeave={(e) => { if (!active) chipHoverOff(e.currentTarget); }}
      >
        {icon}
        <span>{dimensionLabel(values, dimension)}</span>
        {values.length > 1 && <CountBadge n={values.length} on />}
      </button>

      <Modal
        title={<Space size={8}>{icon}<span>{dimension}</span></Space>}
        open={open}
        onCancel={() => setOpen(false)}
        footer={
          <Space>
            <Button onClick={clearDraft}>清空</Button>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" onClick={applyDraft}>确定</Button>
          </Space>
        }
        width={isMobile ? '92vw' : 560}
        styles={{ body: { maxHeight: '62vh', overflowY: 'auto', paddingTop: 4 } }}
      >
        {/* 弹层内重新声明令牌（见 useBoardTokens 注释） */}
        <div style={tokens}>
          {searchable && options.length > 8 && (
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder={`搜索${dimension}`}
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              style={{ marginBottom: 14 }}
            />
          )}
          {shown.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无可选项" />
          ) : (
            /* T5：2 列网格 */
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 10,
              }}
            >
              {shown.map((o) => {
                const on = draft.includes(o);
                const cnt = counts?.[o];
                return (
                  <button
                    key={o}
                    type="button"
                    className="v10-opt"
                    data-selected={on ? '1' : '0'}
                    onClick={() => {
                      const next = on
                        ? draftRef.current.filter((x) => x !== o)
                        : [...draftRef.current, o];
                      draftRef.current = next;
                      setDraft(next);
                    }}
                    style={{
                      // T5：大号选项按钮 —— 高度 ≥40px、字号 13px
                      minHeight: 40,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${on ? 'var(--brand)' : 'var(--line)'}`,
                      background: on ? 'var(--brandSoft)' : 'var(--panel)',
                      color: on ? 'var(--brand)' : 'var(--text)',
                      fontSize: 'var(--fs-sm)',
                      fontWeight: on ? 600 : 500,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      cursor: 'pointer',
                      transition: 'background .14s, border-color .14s, color .14s',
                      textAlign: 'left',
                      width: '100%',
                      minWidth: 0,
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={(e) => {
                      if (on) return;
                      e.currentTarget.style.background = 'var(--panel2)';
                      e.currentTarget.style.borderColor = 'var(--brand3)';
                    }}
                    onMouseLeave={(e) => {
                      if (on) return;
                      e.currentTarget.style.background = 'var(--panel)';
                      e.currentTarget.style.borderColor = 'var(--line)';
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      {cnt !== undefined && (
                        <span
                          style={{
                            fontSize: 'var(--fs-2xs)',
                            color: on ? 'var(--brand)' : 'var(--text3)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {cnt}
                        </span>
                      )}
                      <span
                        aria-hidden
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 5,
                          border: `1px solid ${on ? 'var(--brand)' : 'var(--line)'}`,
                          background: on ? 'var(--brand)' : 'transparent',
                          display: 'grid',
                          placeItems: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {on && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

/** 弹窗宽度判断：实际宽度由 isMobile prop 决定，此函数仅作兜底，勿直接调用 */

/* ══════════════ 日期筛选（T2：官方 RangePicker + presets） ══════════════ */

function DateFilter({ filters, onChange, isMobile }: {
  filters: BoardFilters;
  onChange: (patch: Partial<BoardFilters>) => void;
  isMobile: boolean;
}) {
  const label = dateButtonLabel(filters);
  const active = filters.datePreset !== 'all';

  /** 当前值（受控） */
  const value: [Dayjs, Dayjs] | null = useMemo(() => {
    if (!filters.dateFrom) return null;
    const a = dayjs(filters.dateFrom);
    const b = dayjs(filters.dateTo || filters.dateFrom);
    if (!a.isValid() || !b.isValid()) return null;
    return [a, b];
  }, [filters.dateFrom, filters.dateTo]);

  /** presets 快捷项（官方 API：悬停预览、点击即选中） */
  const presets = useMemo(
    () =>
      PRESET_LABELS.map((p) => {
        const r = presetRange(p.key);
        return {
          label: p.label,
          value: r ? [dayjs(r[0]), dayjs(r[1])] as [Dayjs, Dayjs] : [dayjs(), dayjs()] as [Dayjs, Dayjs],
        };
      }),
    [],
  );

  const handleChange = (vals: [Dayjs | null, Dayjs | null] | null) => {
    if (!vals || !vals[0] || !vals[1]) {
      onChange({ datePreset: 'all', dateFrom: '', dateTo: '' });
      return;
    }
    onChange({
      datePreset: 'custom',
      dateFrom: vals[0].format('YYYY-MM-DD'),
      dateTo: vals[1].format('YYYY-MM-DD'),
    });
  };

  return (
    <>
      {/* T2：日历弹层样式（portal 到 body，必须字面色值） */}
      <style>{CAL_CSS}</style>

      <button
        type="button"
        style={active ? BTN_ON : BTN_BASE}
        onMouseEnter={(e) => { if (!active) chipHoverOn(e.currentTarget); }}
        onMouseLeave={(e) => { if (!active) chipHoverOff(e.currentTarget); }}
        // 由内部隐藏的 RangePicker 承担点击（视觉上是同一个 chip）
        onClick={() => {
          const input = document.getElementById('board-date-anchor') as HTMLInputElement | null;
          input?.focus();
          input?.click();
        }}
        aria-label="选择日期范围"
      >
        {ICON.calendar}
        <span>{label}</span>
      </button>

      {/* 真实控件：视觉隐藏但仍可交互，弹层由 antd 官方 DatePicker 提供 */}
      <div
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
        }}
        aria-hidden="true"
      >
        <RangePicker
          id="board-date-anchor"
          /**
           * T2 关键：className 只会落在触发器 .ant-picker 上，
           * 而弹层是平级 portal 到 body（不是触发器的后代），
           * 所以必须用 classNames.popup 把 class 精准挂到弹层根节点。
           */
          classNames={{ popup: { root: 'board-cal' } }}
          value={value}
          presets={presets}
          onChange={handleChange as never}
          format="YYYY-MM-DD"
          allowClear
          placement={isMobile ? 'bottomRight' : 'bottomLeft'}
          style={{ width: 1, height: 1, opacity: 0, pointerEvents: 'auto' }}
        />
      </div>

      {/* 选中的自定义区间回显（避免用户看不到当前值） */}
      {active && filters.datePreset === 'custom' && filters.dateFrom && (
        <span
          style={{
            fontSize: 'var(--fs-2xs)',
            color: 'var(--text3)',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {filters.dateFrom} ~ {filters.dateTo || filters.dateFrom}
        </span>
      )}
    </>
  );
}

/* ══════════════ 全部筛选条件（T4：居中 Modal，不是 Drawer） ══════════════ */

interface AllFilterProps {
  filters: BoardFilters;
  onChange: (patch: Partial<BoardFilters>) => void;
  options: BoardOptions;
  counts: BoardCounts;
  isMobile: boolean;
}

const ALL_GROUPS: {
  key: keyof BoardFilters;
  title: string;
  optKey: keyof BoardOptions;
  countKey: keyof BoardCounts;
}[] = [
  { key: 'flowStatus', title: '流程状态', optKey: 'flowStatus', countKey: 'flowStatus' },
  { key: 'service', title: '客服', optKey: 'service', countKey: 'service' },
  { key: 'solution', title: '解决方案', optKey: 'solution', countKey: 'solution' },
  { key: 'trainer', title: '培训人', optKey: 'trainer', countKey: 'trainer' },
  { key: 'version', title: '对接版本', optKey: 'version', countKey: 'version' },
  { key: 'connectResult', title: '对接结果', optKey: 'connectResult', countKey: 'connectResult' },
  { key: 'trainResult', title: '培训结果', optKey: 'trainResult', countKey: 'trainResult' },
  { key: 'openedStrategy', title: '已开通策略', optKey: 'openedStrategy', countKey: 'openedStrategy' },
];

function AllFilters({ filters, onChange, options, counts, isMobile }: AllFilterProps) {
  const tokens = useBoardTokens();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<BoardFilters>(filters);
  const draftRef = useRef<BoardFilters>(filters);

  const openPanel = () => {
    draftRef.current = filters;
    setDraft(filters);
    setOpen(true);
  };

  const setGroup = (key: keyof BoardFilters, val: string[]) => {
    const next = { ...draftRef.current, [key]: val } as BoardFilters;
    draftRef.current = next;
    setDraft(next);
  };

  const apply = () => {
    const patch: Partial<BoardFilters> = {};
    ALL_GROUPS.forEach((g) => {
      // 只复制数组型筛选字段；用局部变量承接避免 any
      const v = draftRef.current[g.key];
      if (Array.isArray(v)) {
        Object.assign(patch, { [g.key]: v.slice() });
      }
    });
    onChange(patch);
    setOpen(false);
  };

  const clearAll = () => {
    const patch: Partial<BoardFilters> = {};
    ALL_GROUPS.forEach((g) => {
      Object.assign(patch, { [g.key]: [] as string[] });
    });
    const next = { ...draftRef.current, ...patch } as BoardFilters;
    draftRef.current = next;
    setDraft(next);
    onChange(patch);
  };

  const activeCount = ALL_GROUPS.reduce((sum, g) => {
    const v = filters[g.key];
    return sum + (Array.isArray(v) && v.length ? 1 : 0);
  }, 0);

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        style={activeCount ? BTN_ON : BTN_BASE}
        onMouseEnter={(e) => { if (!activeCount) chipHoverOn(e.currentTarget); }}
        onMouseLeave={(e) => { if (!activeCount) chipHoverOff(e.currentTarget); }}
      >
        {ICON.filter}
        <span>全部筛选条件</span>
        {activeCount > 0 && <CountBadge n={activeCount} on />}
      </button>

      <Modal
        title="全部筛选条件"
        open={open}
        onCancel={() => setOpen(false)}
        width={isMobile ? '94vw' : 760}
        footer={
          <Space>
            <Button onClick={clearAll}>清空</Button>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" onClick={apply}>确定</Button>
          </Space>
        }
        styles={{ body: { maxHeight: '68vh', overflowY: 'auto' } }}
      >
        {/* 弹层内重新声明令牌（见 useBoardTokens 注释） */}
        <div
          style={{
            ...tokens,
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))',
            gap: 18,
          }}
        >
          {ALL_GROUPS.map((g) => {
            const opts = (options[g.optKey] as string[]) || [];
            const cnt = (counts[g.countKey] as Record<string, number>) || {};
            const val = (draft[g.key] as string[]) || [];
            return (
              <div key={String(g.key)}>
                <div
                  style={{
                    fontSize: 'var(--fs-sm)',
                    fontWeight: 600,
                    color: 'var(--text)',
                    marginBottom: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {g.title}
                  {val.length > 0 && (
                    <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--brand)', fontWeight: 600 }}>
                      已选 {val.length}
                    </span>
                  )}
                </div>
                {!opts.length ? (
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>暂无可选项</div>
                ) : (
                  <Checkbox.Group
                    value={val}
                    onChange={(v) => setGroup(g.key, v as string[])}
                    style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
                  >
                    {opts.map((o) => (
                      <Checkbox key={o} value={o} style={{ marginInlineStart: 0 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)' }}>
                          <span>{o}</span>
                          {cnt[o] !== undefined && (
                            <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text3)' }}>{cnt[o]}</span>
                          )}
                        </span>
                      </Checkbox>
                    ))}
                  </Checkbox.Group>
                )}
              </div>
            );
          })}
        </div>
      </Modal>
    </>
  );
}

/* ══════════════ 主组件 ══════════════ */

export default function FilterBar({
  filters, onChange, onReset, options, counts, isMobile,
}: Props) {
  const anyActive =
    filters.regions.length > 0
    || filters.chainTypes.length > 0
    || filters.sales.length > 0
    || filters.datePreset !== 'all'
    || ALL_GROUPS.some((g) => {
      const v = filters[g.key];
      return Array.isArray(v) && v.length > 0;
    });

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'nowrap',
        gap: 4,
        alignItems: 'center',
        // 不换行 → 所有 chip 永远同一基线、同一高度；窄屏内滚，绝不撑破顶栏
        overflowX: 'auto',
        overflowY: 'hidden',
        minWidth: 0,
        scrollbarWidth: 'none',
        position: 'relative',
      }}
      className="board-filterbar"
    >
      <DateFilter filters={filters} onChange={onChange} isMobile={isMobile} />

      <MultiSelect
        dimension="区域"
        icon={ICON.region}
        values={filters.regions}
        options={options.regions}
        counts={counts.region}
        onApply={(v) => onChange({ regions: v })}
        isMobile={isMobile}
      />
      <MultiSelect
        dimension="连锁类型"
        icon={ICON.type}
        values={filters.chainTypes}
        options={options.chainTypes}
        counts={counts.chainType}
        onApply={(v) => onChange({ chainTypes: v })}
        isMobile={isMobile}
      />
      <MultiSelect
        dimension="销售"
        icon={ICON.sales}
        values={filters.sales}
        options={options.sales}
        counts={counts.sales}
        onApply={(v) => onChange({ sales: v })}
        searchable
        isMobile={isMobile}
      />

      <AllFilters
        filters={filters}
        onChange={onChange}
        options={options}
        counts={counts}
        isMobile={isMobile}
      />

      <Tooltip title="清空所有筛选条件">
        <button
          type="button"
          onClick={onReset}
          disabled={!anyActive}
          style={{
            ...BTN_BASE,
            color: anyActive ? 'var(--text3)' : 'var(--text3)',
            opacity: anyActive ? 1 : 0.5,
            cursor: anyActive ? 'pointer' : 'not-allowed',
          }}
          onMouseEnter={(e) => {
            if (!anyActive) return;
            e.currentTarget.style.background = 'color-mix(in srgb, var(--danger) 7%, transparent)';
            e.currentTarget.style.color = 'var(--danger)';
            e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--danger) 24%, transparent)';
          }}
          onMouseLeave={(e) => {
            if (!anyActive) return;
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text3)';
            e.currentTarget.style.borderColor = 'transparent';
          }}
        >
          {ICON.reset}
          <span>重置</span>
        </button>
      </Tooltip>
    </div>
  );
}
