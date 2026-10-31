/** 第 10 排：客户明细表 — V6.0 视觉升级
 *
 * 功能不变：列设置（至少保留 3 列）/ 每页 10·20·50 / 翻页 / CSV 导出。
 * 视觉对齐 pc4.html：
 *   - 卡片 16px 圆角 + 方点标题
 *   - 表头 var(--panel2)、斑马纹、hover var(--brandSoft)
 *   - 超期行左侧 3px var(--danger) 竖条
 *   - 分页器对齐设计系统（圆角 8px、选中渐变 brand）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Checkbox, Divider, Drawer, Empty, Space, Spin, Table, Tooltip, Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  BarChartOutlined, HistoryOutlined, PartitionOutlined, SettingOutlined, ShopOutlined,
} from '@ant-design/icons';
import {
  BoardData, CHAIN_TYPE_COLORS, DetailColumnConf, DetailFullRow, REGION_COLORS,
} from '@/api/crm-board';
import { fmtMoney, fmtNum, fmtPct, useThemeMode } from './theme';

const { Text } = Typography;

/* ══════════════ V7.1：客户详情（需求 J） ══════════════ */

interface ClientTimelineNode {
  name: string;
  doneAt: string;
  doneAtLabel: string;
  done: boolean;
  isCurrent: boolean;
  durationLabel: string;
}

interface ClientDetailData {
  client: Record<string, string | number>;
  progress: Record<string, string | number | boolean>;
  timeline: ClientTimelineNode[];
  run: Record<string, unknown> | null;
  signAtLabel: string;
  submitAtLabel: string;
}

/**
 * V7.2：Drawer（portal 到 body）用的设计令牌。
 * 明暗两套改为字面色值，避免依赖 .board-root 上的 CSS 变量（portal 取不到）。
 * V8.1：新增深色字面值一套，由 useThemeMode() 选择，保证深色下抽屉也走深色。
 */
const CLIENT_DRAWER_VARS: React.CSSProperties = {
  '--panel': '#ffffff',
  '--panel2': '#f7faff',
  '--line': '#dde8f6',
  '--line2': '#eaf2fb',
  '--text': '#16253d',
  '--text2': '#5a7191',
  '--text3': '#93a7c2',
  '--brand': '#2563eb',
  '--brand3': '#60a5fa',
  '--brandSoft': '#e9f2ff',
  '--green': '#10b981',
  '--greenSoft': '#e6f8f1',
  '--warn': '#f59e0b',
  '--danger': '#ef4444',
  '--purple': '#8b5cf6',
} as React.CSSProperties;

/** V8.1：深色字面令牌（对照 Board.tsx 的 darkVars） */
const CLIENT_DRAWER_VARS_DARK: React.CSSProperties = {
  '--panel': '#101d33',
  '--panel2': '#14233c',
  '--line': '#1e3252',
  '--line2': '#182a45',
  '--text': '#e2e8f0',
  '--text2': '#94a8c4',
  '--text3': '#8ba3c2',
  '--brand': '#60a5fa',
  '--brand3': '#93c5fd',
  '--brandSoft': '#16294a',
  '--green': '#34d399',
  '--greenSoft': '#0f2e26',
  '--warn': '#fbbf24',
  '--danger': '#f87171',
  '--purple': '#a78bfa',
} as React.CSSProperties;

/* ── V8.1 需求 I：run（jdywh_mail_30 行）字段映射 ── */
const RUN_KEYS = {
  opened: 'c_70bbab893f',       // 开通策略数
  running: 'c_c75741ce78',      // 运行策略数
  sent: 'c_8428aa48e0',         // 发送人数（触达人数）
  arrived: 'c_a6bfcce0cb',      // 到店人数
  reachRate: 'c_9a055525e4',    // 到店率（回店率）
  turnover: 'c_0b4adaa5d2',     // 转化销售额
  couponIssued: 'c_6ce1a4580f', // 发券人数
  couponUsed: 'c_f38e0dcb75',   // 用券人数
  couponRate: 'c_a5815395ba',   // 用券率
  couponSales: 'c_0964f9ffab',  // 用券销售额
  couponCost: 'c_81f128a3b7',   // 用券成本
  channelCost: 'c_783814dcb3',  // 渠道成本
  roi: 'c_02f259d69b',          // 营销ROI
} as const;

/** 数值读取：字符串数字/null 都安全转 number */
function runNum(run: Record<string, unknown> | null, key: string): number {
  if (!run) return 0;
  const v = run[key];
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 比率智能格式化：0~1 当小数比率，>1 当已是百分数 */
function fmtRateSmart(v: number): string {
  if (!Number.isFinite(v)) return '-';
  if (v > 1) return `${fmtNum(v, 2)}%`;
  return fmtPct(v, 2);
}

interface Props {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

/** 兜底列配置（后端没给 columns 时用） */
const FALLBACK_COLUMNS: DetailColumnConf[] = [
  { key: 'seq', title: '序号', width: 84, default: true, align: 'center' },
  { key: 'region', title: '区域', width: 80, default: true, align: 'center' },
  { key: 'chainId', title: '连锁ID', width: 100, default: true },
  { key: 'chainName', title: '连锁名称', width: 240, default: true },
  { key: 'chainType', title: '连锁类型', width: 100, default: true, align: 'center' },
  { key: 'signType', title: '签约类型', width: 120, default: true, align: 'center' },
  { key: 'stores', title: '门店数', width: 90, default: true, align: 'right', format: 'num' },
  { key: 'sales', title: '销售', width: 90, default: true },
  { key: 'service', title: '客服', width: 90, default: true },
  { key: 'solution', title: '解决方案', width: 100, default: true },
  { key: 'trainer', title: '培训人', width: 90, default: true },
  { key: 'node', title: '当前节点', width: 110, default: true, align: 'center' },
  { key: 'submitLabel', title: '提交时间', width: 110, default: true, align: 'center' },
  { key: 'submitDays', title: '提交时长（天）', width: 120, default: true, align: 'right', format: 'num' },
  { key: 'openedStrategies', title: '开通策略数', width: 110, default: true, align: 'right', format: 'num' },
  { key: 'runningStrategies', title: '运行策略数', width: 110, default: true, align: 'right', format: 'num' },
  { key: 'reachedPeople', title: '触达人数', width: 100, default: true, align: 'right', format: 'num' },
  { key: 'reachRate', title: '到店率', width: 100, default: true, align: 'right', format: 'percent' },
  { key: 'couponRate', title: '优惠券核销率', width: 120, default: true, align: 'right', format: 'percent' },
];

const MIN_VISIBLE = 3;

/* ══════════════ 局部样式（vb11- 前缀） ══════════════ */
const CSS = `
/* ══════════ V7.1 / V8.1 客户详情抽屉（portal 到 body，靠 wrapper 令牌生效） ══════════ */
.vb11-chain-link{color:var(--brand);font-weight:650;cursor:pointer;border:0;background:transparent;padding:0;font-family:inherit;font-size:inherit;text-align:left;border-bottom:1px dashed color-mix(in srgb,var(--brand) 45%,transparent);transition:all .15s}
.vb11-chain-link:hover{color:var(--brand3)!important;border-bottom-color:var(--brand3)}

/* 抽屉整体 */
.vb11-cd{padding:14px 16px 20px;display:flex;flex-direction:column;gap:12px;color:var(--text)}
/* 顶部客户概览 */
.vb11-cd-hero{display:flex;align-items:flex-start;gap:12px;padding:13px 14px;border-radius:12px;border:1px solid var(--line);background:linear-gradient(135deg,var(--brandSoft),transparent 70%)}
.vb11-cd-hero .hm{flex:1;min-width:0;display:flex;flex-direction:column;gap:7px}
.vb11-cd-hero h3{margin:0;font-size:16px;font-weight:750;color:var(--text);line-height:1.3;letter-spacing:.2px;overflow-wrap:anywhere}
.vb11-cd-chips{display:flex;flex-wrap:wrap;gap:6px}
.vb11-cd-chip{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:6px;font-size:11px;font-weight:650;line-height:1;white-space:nowrap;border:1px solid currentColor;background:color-mix(in srgb,currentColor 12%,transparent)}
.vb11-cd-chip.mute{color:var(--text2);border-color:var(--line);background:var(--panel2)}
/* 超期 / 正常 徽章 */
.vb11-cd-badge{flex-shrink:0;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-width:96px;padding:8px 12px;border-radius:10px;color:#fff;text-align:center;box-shadow:0 4px 14px color-mix(in srgb,var(--danger) 30%,transparent);background:linear-gradient(135deg,#ef4444,#f97316)}
.vb11-cd-badge.ok{background:linear-gradient(135deg,#10b981,#34d399);box-shadow:0 4px 14px rgba(16,185,129,.28)}
.vb11-cd-badge b{font-size:13px;font-weight:800;letter-spacing:.3px;line-height:1.2}
.vb11-cd-badge span{font-size:10px;font-weight:600;opacity:.92;line-height:1.2}
/* 超期提示条 */
.vb11-cd-warn{display:flex;align-items:flex-start;gap:8px;margin-top:2px;padding:9px 11px;border-radius:9px;font-size:11.5px;line-height:1.55;color:var(--danger);background:color-mix(in srgb,var(--danger) 9%,transparent);border:1px solid color-mix(in srgb,var(--danger) 30%,transparent)}
.vb11-cd-warn b{font-weight:800}
.vb11-cd-warn .ic{flex-shrink:0;font-weight:800;line-height:1.3}

/* 分区卡片 */
.vb11-cd-sec{border:1px solid var(--line);border-radius:12px;background:var(--panel2);overflow:hidden}
.vb11-cd-sec-h{display:flex;align-items:center;gap:7px;padding:9px 12px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,color-mix(in srgb,var(--panel) 75%,transparent),transparent)}
.vb11-cd-sec-h .ic{width:20px;height:20px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--brandSoft);color:var(--brand);font-size:12px;line-height:1}
.vb11-cd-sec-h .t{font-size:12.5px;font-weight:750;color:var(--text);letter-spacing:.2px}
.vb11-cd-sec-h .n{margin-left:auto;font-size:10.5px;font-weight:650;color:var(--text3);font-variant-numeric:tabular-nums}
.vb11-cd-sec-b{padding:11px 12px}
/* 3 列字段网格 */
.vb11-cd-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px 14px}
.vb11-cd-f{display:flex;flex-direction:column;gap:2px;min-width:0}
.vb11-cd-f dt{font-size:10.5px;font-weight:600;color:var(--text2);letter-spacing:.2px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb11-cd-f dd{margin:0;font-size:12.5px;font-weight:680;color:var(--text);line-height:1.45;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.vb11-cd-f dd.dim{color:var(--text2);font-weight:600;opacity:.8}
.vb11-cd-f dd.hi{color:var(--brand);font-weight:750}
.vb11-cd-f dd.ok{color:var(--green)}
.vb11-cd-f dd.bad{color:var(--danger);font-weight:750}
@media(max-width:900px){.vb11-cd-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:520px){.vb11-cd-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.vb11-cd-hero{flex-direction:column}.vb11-cd-badge{width:100%}}

/* 节点时间线：连接线 + 三态 */
.vb11-tl{list-style:none;margin:0;padding:0}
.vb11-tl li{position:relative;display:grid;grid-template-columns:18px 86px minmax(0,1fr) 72px;align-items:center;gap:10px;min-height:32px;font-size:12px;padding:4px 0}
.vb11-tl li::before{content:'';position:absolute;left:8px;top:0;height:100%;width:2px;background:var(--line);z-index:0}
.vb11-tl li:first-child::before{top:50%;height:50%}
.vb11-tl li:last-child::before{height:50%}
.vb11-tl li.done::before{background:var(--green)}
.vb11-tl li.cur::before{background:linear-gradient(180deg,var(--green),var(--warn))}
.vb11-tl li .dot{grid-column:1;justify-self:center;position:relative;z-index:1;width:10px;height:10px;border-radius:50%;background:var(--panel2);border:2px solid var(--line);flex-shrink:0}
.vb11-tl li.done .dot{background:var(--green);border-color:var(--green)}
.vb11-tl li.cur .dot{background:var(--warn);border-color:var(--warn);box-shadow:0 0 0 3px color-mix(in srgb,var(--warn) 26%,transparent)}
.vb11-tl li.todo .dot{background:var(--panel2);border-color:var(--line)}
.vb11-tl li .nm{font-weight:680;color:var(--text2);white-space:nowrap}
.vb11-tl li.done .nm{color:var(--text)}
.vb11-tl li.cur .nm{color:var(--warn);font-weight:750}
.vb11-tl li.todo .nm{color:var(--text2);opacity:.85}
.vb11-tl li .st{color:var(--text2);font-variant-numeric:tabular-nums;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vb11-tl li.done .st{color:var(--text2)}
.vb11-tl li .du{text-align:right;color:var(--text2);font-variant-numeric:tabular-nums;font-weight:700;font-size:11.5px;white-space:nowrap}
.vb11-tl li.cur .du{color:var(--warn)}
.vb11-tl-tip{margin-top:9px;padding-top:8px;border-top:1px dashed var(--line);font-size:10.5px;color:var(--text2);line-height:1.6}

.vb11-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease;min-width:0}
.vb11-h{padding:13px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent);flex-wrap:wrap}
.vb11-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb11-dot{width:6px;height:6px;border-radius:2px;background:var(--brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 16%,transparent);flex-shrink:0}
.vb11-hint{font-size:11px;color:var(--text3);font-weight:550;white-space:nowrap;font-variant-numeric:tabular-nums}
.vb11-tools{display:flex;align-items:center;gap:7px;flex-shrink:0}
.vb11-btn{height:30px;padding:0 11px;border-radius:9px;border:1px solid var(--line);background:var(--panel2);color:var(--text2);font-size:12px;font-weight:550;display:inline-flex;align-items:center;gap:6px;cursor:pointer;transition:all .15s;white-space:nowrap;font-family:inherit}
.vb11-btn:hover{border-color:var(--brand3);color:var(--brand)}
.vb11-btn:disabled{opacity:.45;cursor:not-allowed}
.vb11-btn svg{font-size:13px}
/* V7：搜索框（替换原导出按钮位置） */
.vb11-search{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 9px;border-radius:9px;border:1px solid var(--line);background:var(--panel2);color:var(--text3);transition:all .15s;min-width:170px}
.vb11-search:focus-within{border-color:var(--brand3);background:var(--panel);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 12%,transparent)}
.vb11-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--text);font-size:12px;font-family:inherit}
.vb11-search input::placeholder{color:var(--text3)}
.vb11-clear{width:16px;height:16px;border:0;border-radius:50%;background:var(--line);color:var(--text2);font-size:12px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;font-family:inherit}
.vb11-clear:hover{background:var(--danger);color:#fff}
@media(max-width:768px){.vb11-search{min-width:120px}}
.vb11-b{padding:12px 14px 6px;flex:1;min-width:0}

/* 表格：表头 panel2 / 斑马纹 / hover brandSoft / 超期左竖条 */
/* V7.2：表格容器与行背景强制跟随主题（深色下 antd 默认白底会导致浅色文字不可见） */
.board-root .vb11-wrap .ant-table{background:transparent!important;font-size:12.5px}
.board-root .vb11-wrap .ant-table-container,
.board-root .vb11-wrap .ant-table-content,
.board-root .vb11-wrap .ant-table-body,
.board-root .vb11-wrap .ant-table-tbody,
.board-root .vb11-wrap .ant-table-tbody>tr,
.board-root .vb11-wrap .ant-table-row,
.board-root .vb11-wrap .ant-table-placeholder{
  background:transparent!important;
}
.board-root .vb11-wrap .ant-table-tbody>tr>td,
.board-root .vb11-wrap .ant-table-tbody>tr.ant-table-row>td{
  background:var(--panel)!important;
}
/* V7.2：表头背景/文字强制跟随主题（深色下 antd 默认白底会与浅色文字冲突，对比度仅 1.23） */
.board-root .vb11-wrap .ant-table-thead>tr>th,
.board-root .vb11-wrap .ant-table-thead>tr>td,
.board-root .vb11-wrap .ant-table-thead th.ant-table-cell,
.board-root .vb11-wrap .ant-table-thead .ant-table-column-title,
.board-root .vb11-wrap .ant-table-thead .ant-table-column-sorters{
  background:var(--panel2)!important;color:var(--text3)!important;
  font-size:11.5px!important;font-weight:650!important;letter-spacing:.2px;
  border-bottom:1px solid var(--line)!important;
  padding:9px 10px!important;white-space:nowrap;
}
/* 表头内的筛选/排序图标也跟随主题色 */
.board-root .vb11-wrap .ant-table-thead .ant-table-filter-trigger,
.board-root .vb11-wrap .ant-table-thead .ant-table-column-sorter,
.board-root .vb11-wrap .ant-table-thead .ant-table-column-sorter-inner,
.board-root .vb11-wrap .ant-table-thead .anticon{
  color:var(--text3)!important;
  background:transparent!important;
}
.board-root .vb11-wrap .ant-table-thead .ant-table-filter-trigger.active,
.board-root .vb11-wrap .ant-table-thead .ant-table-column-sorter-up.active,
.board-root .vb11-wrap .ant-table-thead .ant-table-column-sorter-down.active{
  color:var(--brand)!important;
}
/* 表头单元格的 sticky 背景（固定列） */
.board-root .vb11-wrap .ant-table-thead>tr>th.ant-table-cell-fix-left,
.board-root .vb11-wrap .ant-table-thead>tr>th.ant-table-cell-fix-right{
  background:var(--panel2)!important;
}
.board-root .vb11-wrap .ant-table-thead>tr>th::before{display:none!important}
.board-root .vb11-wrap .ant-table-tbody>tr>td{
  border-bottom:1px solid var(--line2)!important;
  color:var(--text);padding:9px 10px!important;
}
.board-root .vb11-wrap .ant-table-tbody>tr:nth-child(even)>td{background:color-mix(in srgb,var(--panel2) 55%,var(--panel))!important;
  background:color-mix(in srgb,var(--panel2) 55%,transparent);
}
.board-root .vb11-wrap .ant-table-tbody>tr.ant-table-row:hover>td{
  background:var(--brandSoft)!important;
}
.board-root .vb11-wrap .ant-table-tbody>tr>td.ant-table-cell-fix-left,
.board-root .vb11-wrap .ant-table-thead>tr>th.ant-table-cell-fix-left{
  background:var(--panel)!important;
}
.board-root .vb11-wrap .ant-table-tbody>tr:nth-child(even)>td.ant-table-cell-fix-left{
  background:color-mix(in srgb,var(--panel2) 55%,var(--panel))!important;
}
/* 超期行：左侧 3px danger 竖条 + 淡红底 */
.board-root .vb11-wrap .ant-table-tbody>tr.board-row-overdue>td:first-child{
  box-shadow:inset 3px 0 0 var(--danger)!important;
}
.board-root .vb11-wrap .ant-table-tbody>tr.board-row-overdue>td{
  background:color-mix(in srgb,var(--danger) 7%,transparent)!important;
}
.board-root .vb11-wrap .ant-table-tbody>tr.board-row-overdue:hover>td{
  background:color-mix(in srgb,var(--danger) 12%,transparent)!important;
}
.board-root .vb11-wrap .ant-table-cell-scrollbar{background:var(--panel2)!important;box-shadow:none!important}
.board-root .vb11-wrap .ant-empty-description{color:var(--text3)}

/* 分页器对齐设计系统 */
.board-root .vb11-wrap .ant-pagination{margin:12px 0 6px!important;align-items:center}
.board-root .vb11-wrap .ant-pagination .ant-pagination-item,
.board-root .vb11-wrap .ant-pagination .ant-pagination-prev .ant-pagination-item-link,
.board-root .vb11-wrap .ant-pagination .ant-pagination-next .ant-pagination-item-link{
  border-radius:8px!important;border:1px solid var(--line)!important;
  background:var(--panel2)!important;transition:all .15s;
}
.board-root .vb11-wrap .ant-pagination .ant-pagination-item a,
.board-root .vb11-wrap .ant-pagination .ant-pagination-prev button,
.board-root .vb11-wrap .ant-pagination .ant-pagination-next button{
  color:var(--text2)!important;font-size:12.5px!important;font-weight:550;
}
.board-root .vb11-wrap .ant-pagination .ant-pagination-item:hover,
.board-root .vb11-wrap .ant-pagination .ant-pagination-prev:hover .ant-pagination-item-link,
.board-root .vb11-wrap .ant-pagination .ant-pagination-next:hover .ant-pagination-item-link{
  border-color:var(--brand3)!important;
}
.board-root .vb11-wrap .ant-pagination .ant-pagination-item:hover a{color:var(--brand)!important}
.board-root .vb11-wrap .ant-pagination .ant-pagination-item-active{
  background:linear-gradient(135deg,var(--brand),var(--brand2))!important;
  border-color:transparent!important;
  box-shadow:0 3px 9px color-mix(in srgb,var(--brand) 28%,transparent);
}
.board-root .vb11-wrap .ant-pagination .ant-pagination-item-active a{color:#fff!important;font-weight:700}
.board-root .vb11-wrap .ant-pagination .ant-pagination-total-text,
.board-root .vb11-wrap .ant-pagination .ant-pagination-options{color:var(--text3)!important;font-size:12px}
.board-root .vb11-wrap .ant-pagination .ant-select-selector{
  border-radius:8px!important;border-color:var(--line)!important;background:var(--panel2)!important;
}
.board-root .vb11-wrap .ant-pagination .ant-pagination-options-quick-jumper input{
  border-radius:8px!important;border-color:var(--line)!important;background:var(--panel2)!important;color:var(--text)!important;
}

/* 列设置抽屉内标签 */
.vb11-drawer-tip{font-size:12px;color:var(--text2);margin-bottom:10px}
`;

/** 单元格渲染 */
function renderCell(
  row: DetailFullRow,
  col: DetailColumnConf,
  onClientClick?: (chainId: string, chainName: string) => void,
): React.ReactNode {
  const raw = (row as any)[col.key];

  switch (col.key) {
    case 'seq':
      return <span style={{ color: 'var(--text3)', fontVariantNumeric: 'tabular-nums' }}>{raw}</span>;
    case 'region': {
      const isSouth = raw === '南区';
      const isNorth = raw === '北区';
      const color = isSouth ? 'var(--brand)' : isNorth ? 'var(--cyan)' : 'var(--text3)';
      return (
        <span
          style={{
            display: 'inline-block', padding: '0 7px', borderRadius: 6, fontSize: 11,
            border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
            background: `color-mix(in srgb, ${color} 12%, transparent)`,
            color, lineHeight: '18px', whiteSpace: 'nowrap', fontWeight: 600,
          }}
        >
          {raw || '-'}
        </span>
      );
    }
    case 'chainName': {
      /* V7.1 需求 J：客户名称可点击，打开完整详情 */
      const cid = String((row as unknown as Record<string, unknown>).chainId ?? '');
      return (
        <Tooltip title={onClientClick ? '点击查看该客户完整详情' : raw}>
          <span
            role={onClientClick ? 'button' : undefined}
            tabIndex={onClientClick ? 0 : undefined}
            className={onClientClick ? 'vb11-chain-link' : undefined}
            style={{
              color: onClientClick ? 'var(--brand)' : 'var(--text)',
              fontWeight: 600,
              cursor: onClientClick ? 'pointer' : 'default',
            }}
            onClick={(e) => { e.stopPropagation(); if (onClientClick) onClientClick(cid, String(raw || '')); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && onClientClick) onClientClick(cid, String(raw || '')); }}
          >
            {raw || '-'}
          </span>
        </Tooltip>
      );
    }
    case 'chainType': {
      const isInvalid = raw === '50-';
      const color = isInvalid
        ? 'var(--text3)'
        : raw === '全国百强'
          ? 'var(--brand)'
          : raw === '区县百强'
            ? 'var(--cyan)'
            : 'var(--green)';
      return (
        <span
          style={{
            display: 'inline-block', padding: '0 7px', borderRadius: 6, fontSize: 11,
            border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
            background: `color-mix(in srgb, ${color} 10%, transparent)`,
            color, lineHeight: '18px', whiteSpace: 'nowrap', fontWeight: 600,
            opacity: isInvalid ? 0.7 : 1,
          }}
        >
          {raw || '-'}
        </span>
      );
    }
    case 'signType': {
      const isSic = String(raw).includes('SIC');
      const color = isSic ? 'var(--purple)' : 'var(--brand)';
      return (
        <span
          style={{
            display: 'inline-block', padding: '0 7px', borderRadius: 6, fontSize: 11,
            border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
            background: `color-mix(in srgb, ${color} 10%, transparent)`,
            color, lineHeight: '18px', whiteSpace: 'nowrap', fontWeight: 600,
          }}
        >
          {raw || '-'}
        </span>
      );
    }
    case 'node':
      if (!raw) {
        return <span style={{ color: 'var(--green)', fontWeight: 600 }}>流程完成</span>;
      }
      return <span style={{ color: 'var(--text)' }}>{raw}</span>;
    case 'status': {
      const overdue = raw === '超期';
      return (
        <span style={{ color: overdue ? 'var(--danger)' : 'var(--green)', fontWeight: 700 }}>
          {raw || '-'}
        </span>
      );
    }
    case 'reachRate':
    case 'couponRate':
      return (
        <span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {fmtPct(Number(raw) || 0, 2)}
        </span>
      );
    case 'stores':
    case 'submitDays':
    case 'openedStrategies':
    case 'runningStrategies':
    case 'reachedPeople':
    case 'nodeDays':
    case 'totalDays':
      return (
        <span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {fmtNum(Number(raw) || 0)}
        </span>
      );
    default:
      return raw === undefined || raw === null || raw === '' ? (
        <span style={{ color: 'var(--text3)' }}>-</span>
      ) : (
        <span style={{ color: 'var(--text)' }}>{String(raw)}</span>
      );
  }
}

/**
 * V8.1 需求 I：抽屉内的分区卡片。
 * 图标 + 标题 + 右侧备注 + 内容区，统一视觉。
 */
function CSection({
  icon, title, note, children,
}: {
  icon: React.ReactNode;
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="vb11-cd-sec">
      <div className="vb11-cd-sec-h">
        <span className="ic">{icon}</span>
        <span className="t">{title}</span>
        {note ? <span className="n">{note}</span> : null}
      </div>
      <div className="vb11-cd-sec-b">{children}</div>
    </section>
  );
}

type Tone = 'dim' | 'hi' | 'ok' | 'bad' | undefined;

/** 字段（标签在上、值在下，便于 3 列网格对齐且不拉长） */
function CField({ label, value, tone }: { label: string; value: React.ReactNode; tone?: Tone }) {
  const empty = value === null || value === undefined || value === '' || value === '-';
  return (
    <div className="vb11-cd-f">
      <dt>{label}</dt>
      <dd className={empty ? 'dim' : tone}>{empty ? '-' : value}</dd>
    </div>
  );
}

/** 时间戳 'YYYYMMDD' → 'YYYY-MM-DD' */
function fmtYmd(v: unknown): string {
  const t = String(v ?? '').replace(/\D/g, '');
  if (t.length !== 8) return '';
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
}

export default function DetailTable({ data, loading, isMobile }: Props) {
  /** V8.1：抽屉是 portal 到 body，按当前主题选字面令牌 */
  const themeMode = useThemeMode();
  const drawerVars = themeMode === 'dark' ? CLIENT_DRAWER_VARS_DARK : CLIENT_DRAWER_VARS;

  const columns: DetailColumnConf[] = useMemo(() => {
    const list = data?.detail?.columns;
    return Array.isArray(list) && list.length ? list : FALLBACK_COLUMNS;
  }, [data?.detail?.columns]);

  const rows: DetailFullRow[] = useMemo(
    () => (Array.isArray(data?.detail?.rows) ? data.detail.rows : []),
    [data?.detail?.rows],
  );

  /** 默认可见列 */
  const defaultVisible = useMemo(
    () => columns.filter((c) => c.default !== false).map((c) => String(c.key)),
    [columns],
  );

  const [visible, setVisible] = useState<string[]>(defaultVisible);
  const [drawerOpen, setDrawerOpen] = useState(false);

  /* V7.1 需求 J：客户详情抽屉 */
  const [clientOpen, setClientOpen] = useState(false);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientErr, setClientErr] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientData, setClientData] = useState<ClientDetailData | null>(null);

  const openClient = useCallback(async (chainId: string, chainName: string) => {
    if (!chainId) return;
    setClientOpen(true);
    setClientName(chainName);
    setClientLoading(true);
    setClientErr('');
    setClientData(null);
    try {
      const res = await fetch(`/api/crm/board/client/${encodeURIComponent(chainId)}`, {
        credentials: 'same-origin',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.message || `加载失败（HTTP ${res.status}）`);
      setClientData(json.data as ClientDetailData);
    } catch (e) {
      setClientErr(e instanceof Error ? e.message : '客户详情加载失败');
    } finally {
      setClientLoading(false);
    }
  }, []);
  /** V7：搜索框（连锁ID 或 连锁名称） */
  const [search, setSearch] = useState('');

  // 列配置变化（如筛选后列集合变化）时重置
  useEffect(() => { setVisible(defaultVisible); }, [defaultVisible.join('|')]);

  /** V7：搜索过滤（连锁ID / 连锁名称，包含匹配、忽略大小写） */
  const searched = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter((r) => {
      const id = String((r as unknown as Record<string, unknown>).chainId ?? '').toLowerCase();
      const name = String((r as unknown as Record<string, unknown>).chainName ?? '').toLowerCase();
      return id.includes(kw) || name.includes(kw);
    });
  }, [rows, search]);

  /** 该列所有去重取值（用于列筛选下拉） */
  const distinctOf = useMemo(() => {
    const cache = new Map<string, { text: string; value: string }[]>();
    return (key: string) => {
      if (cache.has(key)) return cache.get(key)!;
      const set = new Set<string>();
      searched.forEach((r) => {
        const v = (r as unknown as Record<string, unknown>)[key];
        if (v === null || v === undefined || v === '') return;
        set.add(String(v));
      });
      const list = Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'))
        .slice(0, 200)
        .map((v) => ({ text: v, value: v }));
      cache.set(key, list);
      return list;
    };
  }, [searched]);

  /** 生成 antd Table columns（V7：每列都带 filters + sorter） */
  const tableColumns: ColumnsType<DetailFullRow> = useMemo(() => {
    const picked = columns.filter((c) => visible.includes(String(c.key)));
    const NUMERIC = new Set([
      'seq', 'stores', 'submitDays', 'openedStrategies', 'runningStrategies',
      'reachedPeople', 'reachRate', 'couponRate', 'nodeDays', 'totalDays',
      'currentNodeHours',
    ]);
    return picked.map((c) => {
      const key = String(c.key);
      const isSeq = key === 'seq';
      const isName = key === 'chainName';
      const isNum = NUMERIC.has(key);
      // 「当前节点处理时长」是字符串（如 "8.7天"），排序用小时数
      const sortKey = key === 'currentNodeDuration' ? 'currentNodeHours' : key;
      return {
        title: c.title,
        dataIndex: key,
        key,
        width: c.width,
        align: c.align,
        fixed: isSeq ? ('left' as const) : undefined,
        ellipsis: isName,
        /* V7：列筛选（多选该列所有值）；V7.2：序号列不参与筛选（无业务意义且会挤压表头宽度） */
        filters: isSeq ? undefined : distinctOf(key),
        filterSearch: isSeq ? false : distinctOf(key).length > 10,
        onFilter: isSeq ? undefined : ((value: boolean | React.Key, row: DetailFullRow) => {
          const v = (row as unknown as Record<string, unknown>)[key];
          // 空值归到「(空)」便于筛选
          const cell = v === null || v === undefined || v === '' ? '(空)' : String(v);
          return cell === String(value);
        }),
        /* V7：列排序 */
        /* V7.2：序号列不参与排序（排序图标会挤压表头宽度导致溢出） */
        sorter: isSeq ? undefined : ((a: DetailFullRow, b: DetailFullRow) => {
          const av = (a as unknown as Record<string, unknown>)[sortKey];
          const bv = (b as unknown as Record<string, unknown>)[sortKey];
          if (isNum) return (Number(av) || 0) - (Number(bv) || 0);
          return String(av ?? '').localeCompare(String(bv ?? ''), 'zh-CN');
        }),
        /* V8.1：排序方向与箭头一致 —— 点上方箭头 = 升序，点下方箭头 = 降序 */
        sortDirections: isSeq ? undefined : (['ascend', 'descend'] as const),
        showSorterTooltip: isSeq ? false : { title: `点击按「${c.title}」排序` },
        render: (_: unknown, row: DetailFullRow) => renderCell(row, c, openClient),
      };
    });
  }, [columns, visible, distinctOf, openClient]);

  const toggleColumn = (key: string, on: boolean) => {
    setVisible((cur) => {
      if (on) return Array.from(new Set([...cur, key]));
      if (cur.length <= MIN_VISIBLE) return cur;
      return cur.filter((k) => k !== key);
    });
  };

  const resetColumns = () => setVisible(defaultVisible);

  const canUncheck = visible.length > MIN_VISIBLE;

  return (
    <>
      <style>{CSS}</style>

      <div className="vb11-card">
        <div className="vb11-h">
          <h3>
            <span className="vb11-dot" />
            客户明细
            <span className="vb11-hint">
              共 {fmtNum(searched.length)} 条
              {search ? `（已从 ${fmtNum(rows.length)} 条中筛选）` : ''}
            </span>
          </h3>
          <div className="vb11-tools">
            {/* V7：搜索框替换原导出按钮 */}
            <div className="vb11-search">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isMobile ? '搜索连锁' : '搜索连锁ID或名称'}
                aria-label="搜索连锁ID或名称"
              />
              {search && (
                <button type="button" className="vb11-clear" onClick={() => setSearch('')} aria-label="清空搜索">
                  ×
                </button>
              )}
            </div>
            <button type="button" className="vb11-btn" onClick={() => setDrawerOpen(true)}>
              <SettingOutlined />
              {isMobile ? null : '列设置'}
            </button>
          </div>
        </div>
        <div className="vb11-b vb11-wrap">
          {rows.length === 0 ? (
            <div style={{ padding: '28px 0' }}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选条件下无明细" />
            </div>
          ) : (
            <Table<DetailFullRow>
              size="middle"
              loading={loading}
              rowKey={(r) => `${r.chainId}-${r.seq}`}
              columns={tableColumns}
              dataSource={searched}
              bordered={false}
              scroll={{ x: 'max-content' }}
              rowClassName={(r) => (r.status === '超期' ? 'board-row-overdue' : '')}
              pagination={{
                defaultPageSize: 10,
                pageSizeOptions: ['10', '20', '50'],
                showSizeChanger: true,
                showQuickJumper: true,
                position: ['bottomRight'],
                showTotal: (t, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${t} 条`,
                size: 'small',
              }}
            />
          )}
        </div>
      </div>

      {/* 列设置 */}
      <Drawer
        title="列设置"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={isMobile ? '100%' : 340}
        extra={
          <Space>
            <Button size="small" onClick={() => setVisible(columns.map((c) => String(c.key)))}>全选</Button>
            <Button size="small" type="primary" onClick={resetColumns}>重置默认</Button>
          </Space>
        }
      >
        <div className="vb11-drawer-tip">
          已显示 {visible.length} / {columns.length} 列（至少保留 {MIN_VISIBLE} 列）
        </div>
        <Checkbox.Group
          value={visible}
          style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}
        >
          {columns.map((c) => {
            const key = String(c.key);
            const on = visible.includes(key);
            return (
              <Checkbox
                key={key}
                value={key}
                checked={on}
                disabled={on && !canUncheck}
                onChange={(e) => toggleColumn(key, e.target.checked)}
                style={{ marginLeft: 0 }}
              >
                <span style={{ color: 'var(--text)' }}>
                  {c.title}
                  {c.default !== false && (
                    <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 6 }}>默认</span>
                  )}
                </span>
              </Checkbox>
            );
          })}
        </Checkbox.Group>
        <Divider style={{ margin: '14px 0' }} />
        <Text style={{ fontSize: 12, color: 'var(--text3)' }}>
          提示：列顺序与后端列配置一致；「默认」标记的列会随筛选重置为可见。
        </Text>
      </Drawer>
    
      {/* V7.1 需求 J：客户详情抽屉 */}
      <Drawer
        title={clientName ? `${clientName} · 客户详情` : '客户详情'}
        placement="right"
        width={isMobile ? '100%' : 820}
        open={clientOpen}
        onClose={() => setClientOpen(false)}
        styles={{
          /**
           * V7.2 / V8.1：Drawer 通过 portal 挂到 body，取不到 `.board-root` 上的设计令牌。
           * 在 wrapper 上重新声明整套字面令牌（明/暗两套由 useThemeMode 选择），
           * header / section / body 全部用 var(--xxx) 取值，保证深色下对比度正常。
           */
          wrapper: { ...drawerVars, background: 'var(--panel)' },
          section: { background: 'var(--panel)' },
          header: {
            background: 'var(--panel)',
            borderBottom: '1px solid var(--line)',
            color: 'var(--text)',
            padding: '13px 16px',
          },
          title: { color: 'var(--text)', fontWeight: 700, fontSize: 14 },
          body: { padding: 0, background: 'var(--panel)', color: 'var(--text)' },
          close: { color: 'var(--text2)' },
        }}
      >
        {clientLoading ? (
          <div style={{ padding: 60, textAlign: 'center' }}><Spin /></div>
        ) : clientErr ? (
          <div style={{ padding: 16 }}>
            <Alert type="error" showIcon message="客户详情加载失败" description={clientErr} />
          </div>
        ) : !clientData ? (
          <div style={{ padding: 40 }}><Empty description="暂无详情" /></div>
        ) : (() => {
          const cl = clientData.client || {};
          const pg = clientData.progress || {};
          const run = clientData.run;
          const tl = Array.isArray(clientData.timeline) ? clientData.timeline : [];

          /* run 派生指标 */
          const sent = runNum(run, RUN_KEYS.sent);
          const arrived = runNum(run, RUN_KEYS.arrived);
          const issued = runNum(run, RUN_KEYS.couponIssued);
          const used = runNum(run, RUN_KEYS.couponUsed);
          const turnover = runNum(run, RUN_KEYS.turnover);
          const channelCost = runNum(run, RUN_KEYS.channelCost);
          const couponCost = runNum(run, RUN_KEYS.couponCost);
          const totalCost = channelCost + couponCost;
          /* 到店率优先按 到店/触达 计算（契约 §3.2-11），无触达时回退表内列 */
          const reachRate = sent > 0 ? arrived / sent : runNum(run, RUN_KEYS.reachRate);
          /* 优惠券核销率 = 用券/发券，回退表内列 */
          const couponRate = issued > 0 ? used / issued : runNum(run, RUN_KEYS.couponRate);
          const roiRaw = runNum(run, RUN_KEYS.roi);
          const roi = roiRaw > 0 ? roiRaw : (totalCost > 0 && turnover > 0 ? totalCost / turnover : 0);

          const isOverdue = !!pg.isOverdue;
          const ownerRoles = Array.isArray(pg.ownerRoles) ? (pg.ownerRoles as string[]) : [];
          const regionColor = REGION_COLORS[String(cl.region ?? '')] || 'var(--text2)';
          const chainTypeColor = CHAIN_TYPE_COLORS[String(cl.chainType ?? '')] || 'var(--text2)';
          const doneCount = tl.filter((t) => t.done).length;
          /* 实际展示字段数（run 为 null 时「策略与运行」只显示提示，不占字段） */
          const fieldCount = 16 + 11 + (run ? 15 : 0);

          return (
            <div className="vb11-cd">
              {/* ── 顶部概览 + 超期徽章 ── */}
              <div className="vb11-cd-hero">
                <div className="hm">
                  <h3>{String(cl.chainName || clientName || '-')}</h3>
                  <div className="vb11-cd-chips">
                    <span className="vb11-cd-chip" style={{ color: regionColor }}>
                      {String(cl.region || '未知')}
                    </span>
                    <span className="vb11-cd-chip" style={{ color: chainTypeColor }}>
                      {String(cl.chainType || '未分类')}
                    </span>
                    <span className="vb11-cd-chip mute">ID {String(cl.chainId || '-')}</span>
                    <span className="vb11-cd-chip mute">{String(cl.signType || '-')}</span>
                    <span className="vb11-cd-chip mute">{fmtNum(Number(cl.stores) || 0)} 家门店</span>
                  </div>
                </div>
                {isOverdue ? (
                  <div className="vb11-cd-badge">
                    <b>超期 {fmtNum(Number(pg.overdueDays) || 0)} 个工作日</b>
                    <span>阈值 {fmtNum(Number(pg.overdueThreshold) || 0)} 个工作日</span>
                  </div>
                ) : (
                  <div className="vb11-cd-badge ok">
                    <b>正常</b>
                    <span>未超阈值</span>
                  </div>
                )}
              </div>

              {/* ── 1. 基本信息 ── */}
              <CSection icon={<ShopOutlined />} title="基本信息" note={`${fieldCount} 项字段 · 4 个分区`}>
                <dl className="vb11-cd-grid">
                  <CField label="连锁ID" value={String(cl.chainId || '-')} tone="hi" />
                  <CField label="连锁名称" value={String(cl.chainName || '-')} />
                  <CField label="连锁类型" value={String(cl.chainType || '-')} />
                  <CField label="区域" value={String(cl.region || '-')} />
                  <CField label="省份" value={String(cl.province || '-')} />
                  <CField label="门店数" value={fmtNum(Number(cl.stores) || 0)} />
                  <CField label="签约类型" value={String(cl.signType || '-')} />
                  <CField label="销售" value={String(cl.sales || '-')} />
                  <CField label="客服" value={String(cl.service || '-')} />
                  <CField label="解决方案" value={String(cl.solution || '-')} />
                  <CField label="培训人" value={String(cl.trainer || '-')} />
                  <CField label="对接版本" value={String(cl.version || '-')} />
                  <CField label="对接结果" value={String(cl.connectResult || '-')} />
                  <CField label="培训结果" value={String(cl.trainResult || '-')} />
                  <CField label="签约时间" value={clientData.signAtLabel || '-'} />
                  <CField label="提交时间" value={clientData.submitAtLabel || '-'} />
                </dl>
              </CSection>

              {/* ── 2. 流程进度 ── */}
              <CSection
                icon={<PartitionOutlined />}
                title="流程进度"
                note={`${doneCount} / ${tl.length} 节点已完成`}
              >
                <dl className="vb11-cd-grid">
                  <CField label="当前节点" value={pg.isCompleted ? '流程结束' : String(pg.node || '流程结束')} tone="hi" />
                  <CField label="当前处理人" value={String(pg.owner || '-')} />
                  <CField label="负责人岗位" value={ownerRoles.length ? ownerRoles.join(' / ') : '-'} />
                  <CField
                    label="流程状态"
                    value={pg.isCompleted ? '已完成' : '进行中'}
                    tone={pg.isCompleted ? 'ok' : 'hi'}
                  />
                  <CField label="进入当前节点" value={String(pg.enterAtLabel || '-')} />
                  <CField label="当前节点处理时长" value={String(pg.currentNodeDuration || '-')} tone={isOverdue ? 'bad' : undefined} />
                  <CField label="当前节点时长（天）" value={fmtNum(Number(pg.nodeDays) || 0, 1)} />
                  <CField label="连锁总时长（天）" value={fmtNum(Number(pg.totalDays) || 0, 1)} />
                  <CField label="已过工作日" value={`${fmtNum(Number(pg.workdays) || 0)} 天`} tone={isOverdue ? 'bad' : undefined} />
                  <CField label="上节点完成时间" value={String(pg.prevDoneAtLabel || '-')} />
                  <CField label="节点阈值" value={String(pg.overdueRule || '-')} />
                </dl>
                {isOverdue && (
                  <div className="vb11-cd-warn">
                    <span className="ic">!</span>
                    <span>
                      已<b>超期 {fmtNum(Number(pg.overdueDays) || 0)} 个工作日</b>（阈值{' '}
                      {fmtNum(Number(pg.overdueThreshold) || 0)} 个工作日，已过{' '}
                      {fmtNum(Number(pg.workdays) || 0)} 个工作日）。
                      {' '}上一节点完成于 {String(pg.prevDoneAtLabel || '-')}。
                    </span>
                  </div>
                )}
              </CSection>

              {/* ── 3. 策略与运行 ── */}
              <CSection
                icon={<BarChartOutlined />}
                title="策略与运行"
                note={run ? `统计日期 ${fmtYmd((run as Record<string, unknown>).c_793d0ececa) || '-'}` : '无快照'}
              >
                {!run ? (
                  <div style={{ fontSize: 12, color: 'var(--text3)', padding: '6px 0 2px', lineHeight: 1.7 }}>
                    暂无运行数据（该连锁未出现在最新一日的运行汇总中）。
                  </div>
                ) : (
                  <dl className="vb11-cd-grid">
                    <CField label="开通策略数" value={fmtNum(runNum(run, RUN_KEYS.opened))} tone="hi" />
                    <CField label="运行策略数" value={fmtNum(runNum(run, RUN_KEYS.running))} tone="hi" />
                    <CField label="触达人数" value={fmtNum(sent)} />
                    <CField label="到店人数" value={fmtNum(arrived)} />
                    <CField label="到店率" value={fmtRateSmart(reachRate)} />
                    <CField label="优惠券核销率" value={fmtRateSmart(couponRate)} />
                    <CField label="发券人数" value={fmtNum(issued)} />
                    <CField label="用券人数" value={fmtNum(used)} />
                    <CField label="转化销售额" value={fmtMoney(turnover)} />
                    <CField label="用券销售额" value={fmtMoney(runNum(run, RUN_KEYS.couponSales))} />
                    <CField label="渠道成本" value={fmtMoney(channelCost)} />
                    <CField label="用券成本" value={fmtMoney(couponCost)} />
                    <CField label="成本合计" value={fmtMoney(totalCost)} />
                    <CField
                      label="营销ROI（成本÷销售额）"
                      value={roi > 0 ? fmtNum(roi, 2) : '-'}
                      tone={roi > 0 ? 'hi' : 'dim'}
                    />
                    <CField label="数据快照" value={String((run as Record<string, unknown>).wjmc || '-')} />
                  </dl>
                )}
              </CSection>

              {/* ── 4. 节点时间线 ── */}
              <CSection icon={<HistoryOutlined />} title="节点时间线" note={`${tl.length} 个节点`}>
                <ol className="vb11-tl">
                  {tl.map((t, i2) => (
                    <li key={`${t.name}-${i2}`} className={t.isCurrent ? 'cur' : t.done ? 'done' : 'todo'}>
                      <span className="dot" />
                      <span className="nm">{t.name}</span>
                      <span className="st">
                        {t.done ? t.doneAtLabel : t.isCurrent ? '进行中（当前节点）' : '未开始'}
                      </span>
                      <span className="du">{t.durationLabel || ''}</span>
                    </li>
                  ))}
                </ol>
                <div className="vb11-tl-tip">
                  节点耗时为「该节点完成时间 − 上一节点完成时间」；「进行中」耗时 = 当前时间 − 上一节点完成时间。
                </div>
              </CSection>
            </div>
          );
        })()}
      </Drawer>
    </>
  );
}
