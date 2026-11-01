/** 第 2 排：流程状态分布（9 节点流程图）— V10.0
 *
 * ── 本轮 6 项改动（契约 §四 R2） ──
 *  R2-1 无数据字段不渲染：占比为 `-` / 无岗位数据 / 耗时无数值 → 整行不出现，不留占位符
 *  R2-2 节点卡整体「蓝底白字」：linear-gradient(--brand → --brand2) + 白字；
 *       0 客户节点用**浅一档蓝** color-mix(brand 62%, panel)，不是灰色
 *  R2-3 卡片**下方** 2 行：第 1 行「正常 X 家　超期 X 家」，第 2 行岗位数据
 *  R2-4 图标 15px → 18px，客户数 22px → 26px
 *  R2-5 占比跟在「X 家」后面：`42 家 · 28.6%`
 *  R2-6 箭头 18×22 → 26×32，颜色用浅品牌色（有存在感但不抢节点卡）
 *
 * ── 保留的已验收功能（V7 / V8.1 / V9.2） ──
 *   · 图标只在名称前 1 处（.fm-nameico 恰好 9 个）
 *   · 耗时、南北区仍在**卡内**
 *   · 销售签约（起点）与流程结束（终点）不显示「正常/超期」行
 *   · 0 客户节点不可点击（无 onClick / role=null / tabIndex=-1 / cursor:default）
 *   · 平均耗时格式 <1天→X.X时，≥1天→X.X天
 *   · 弹窗、明细表格、超期口径说明（含 7 个工作日阈值）完全保留
 *   · 最小字号 11px（--fs-2xs），无 8~10.5px
 *
 * 数据全部由 Board.tsx 通过 props 下发；本组件不改数据结构、不改 props。
 */
import React, { useMemo, useState } from 'react';
import { Empty, Modal, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { BoardData, DetailRow, FlowNodeItem } from '@/api/crm-board';
import { CHAIN_TYPE_COLORS, REGION_COLORS } from '@/api/crm-board';
import { fmtNum, fmtPct } from './theme';

interface Props {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

/** 后端可能已补 normal/overdue（Lead 负责），缺失时用明细行状态兜底 */
type FlowNodeExt = FlowNodeItem & {
  normal?: number; overdue?: number;
  overdueThreshold?: number | null; overdueRule?: string; avgOverdueDays?: number;
  south?: number; north?: number;
};

/** 占比分母排除的节点（与后端 RATIO_EXCLUDED 一致）：这两个节点不参与占比 */
const RATIO_EXCLUDED = ['销售签约', '流程结束'];

/** 没有「耗时」概念的节点：起点与终点 */
const NO_DURATION = ['销售签约', '流程结束'];

/* ══════════════ 9 节点内联 SVG 图标（stroke=currentColor） ══════════════ */

function ico(children: React.ReactNode, size = 18): React.ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const NODE_ICON: Record<string, React.ReactNode> = {
  /* 销售签约 → 签名笔 */
  销售签约: ico(
    <>
      <path d="M18.4 12.6l-7.2 7.2-3.6.9.9-3.6 7.2-7.2" />
      <path d="M20.6 8.5l-3.1-3.1 1.5-1.5 3.1 3.1z" />
      <path d="M4 21h4" />
    </>,
  ),
  /* 策略开通 → 钥匙 */
  策略开通: ico(
    <>
      <circle cx="7.6" cy="15.4" r="4.4" />
      <path d="M10.7 12.3L20.5 2.5" />
      <path d="M16.6 6.4l3 3" />
      <path d="M13.6 9.4l3 3" />
    </>,
  ),
  /* 实施对接 → 齿轮 */
  实施对接: ico(
    <>
      <circle cx="12" cy="12" r="3.3" />
      <path d="M12 2.6v3.1M12 18.3v3.1M2.6 12h3.1M18.3 12h3.1" />
      <path d="M5.35 5.35l2.2 2.2M16.45 16.45l2.2 2.2M18.65 5.35l-2.2 2.2M7.55 16.45l-2.2 2.2" />
    </>,
  ),
  /* 对接审核 → 放大镜 + 勾 */
  对接审核: ico(
    <>
      <circle cx="10.4" cy="10.4" r="6.6" />
      <path d="M15.4 15.4L21 21" />
      <path d="M7.6 10.5l1.9 1.9 3.5-3.7" />
    </>,
  ),
  /* 客服处理 → 耳机 */
  客服处理: ico(
    <>
      <path d="M4 13.4v-1.2a8 8 0 0116 0v1.2" />
      <rect x="2.4" y="13.2" width="4" height="6.2" rx="1.7" />
      <rect x="17.6" y="13.2" width="4" height="6.2" rx="1.7" />
      <path d="M19.6 19.4v.5a2.5 2.5 0 01-2.5 2.5H13" />
    </>,
  ),
  /* 客户培训 → 学士帽 */
  客户培训: ico(
    <>
      <path d="M2.4 9.4L12 4.8l9.6 4.6L12 14z" />
      <path d="M6.6 11.5v4.4c0 1.5 2.4 2.7 5.4 2.7s5.4-1.2 5.4-2.7v-4.4" />
      <path d="M21.6 9.8v5" />
    </>,
  ),
  /* 连锁使用 → 店铺 */
  连锁使用: ico(
    <>
      <path d="M4.2 10.2V20h15.6v-9.8" />
      <path d="M2.6 10.2l2.1-6h14.6l2.1 6" />
      <path d="M9.2 20v-5.4h5.6V20" />
    </>,
  ),
  /* 策略审核 → 盾牌 + 勾 */
  策略审核: ico(
    <>
      <path d="M12 2.8l8.2 3v5.6c0 4.7-3.3 8.6-8.2 9.8-4.9-1.2-8.2-5.1-8.2-9.8V5.8z" />
      <path d="M8.7 12.1l2.3 2.3 4.3-4.5" />
    </>,
  ),
  /* 流程结束 → 旗帜 */
  流程结束: ico(
    <>
      <path d="M5 21.4V3.6" />
      <path d="M5 4.4h12.8l-2.7 4.1 2.7 4.1H5" />
    </>,
  ),
};

/** 未知节点名兜底图标（圆形节点） */
const ICON_FALLBACK: React.ReactNode = ico(
  <>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8.5v4.2" />
    <path d="M12 16.1h.01" />
  </>,
);

/* ══════════════ 局部样式（统一 .v7flow 作用域） ══════════════
 * 颜色全部取自 Board.tsx 的 V10 令牌，用 color-mix 派生深浅，不新增十六进制。
 * 深色模式由令牌自动切换（--brand / --brand2 / --text 等）。
 */
const CSS = `
.v7flow{min-width:0}
.v7flow .fm-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:0;min-width:0;overflow:hidden;display:flex;flex-direction:column}

/* ── 卡片头部 ── */
.v7flow .fm-hd{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line2);flex-shrink:0}
.v7flow .fm-hd h3{font-size:var(--fs-sm);font-weight:var(--fw-bold);color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.v7flow .fm-hd-dot{width:6px;height:6px;border-radius:2px;background:var(--brand);flex-shrink:0}
.v7flow .fm-hd-hint{font-size:var(--fs-xs);color:var(--text3);font-weight:var(--fw-normal);white-space:nowrap}

/* ── 横排容器：9 节点等分，不换行 ── */
.v7flow .fm-map{padding:14px 16px 16px;display:flex;align-items:flex-start;overflow-x:auto;overflow-y:visible;gap:0;scrollbar-width:thin}
.v7flow .fm-map::-webkit-scrollbar{height:6px}
.v7flow .fm-map::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}

/* ── 节点列：上方蓝底白字卡 + 下方 2 行说明 ── */
.v7flow .fm-node-wrap{flex:1 1 0;min-width:112px;display:flex;flex-direction:column;align-items:stretch;gap:7px}

/* R2-2 节点卡整体蓝底白字
 * 浅色：--brand → --brand2 渐变（跟随用户主题色）。
 * 深色：实测 dark 下 --brand=#60a5fa、--brand2=#93c5fd、--south=#93c5fd 都被提亮成浅蓝，
 *       白字对比度不足 → 改用深一档的品牌蓝字面值 #2563eb → #3b82f6（与契约 §三 同色系，
 *       非新造色），保证白字在深色下依然清晰。 */
.v7flow .fm-node{position:relative;width:100%;display:flex;flex-direction:column;align-items:center;gap:5px;
  padding:13px 8px 12px;border-radius:var(--radius-sm);
  background:linear-gradient(135deg,var(--brand),var(--brand2));
  color:#fff;border:1px solid transparent;text-align:center;overflow:hidden;
  transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease}
.board-root[data-theme='dark'] .v7flow .fm-node{
  background:linear-gradient(135deg,#2563eb,#3b82f6)}
/* 深色兜底：卡内外次要文字统一提亮，保证像素反差 ≥2.5 */
.board-root[data-theme='dark'] .v7flow .fm-od,
.board-root[data-theme='dark'] .v7flow .fm-time,
.board-root[data-theme='dark'] .v7flow .fm-roles{color:#b6c6dd !important}
.board-root[data-theme='dark'] .v7flow .fm-od b,
.board-root[data-theme='dark'] .v7flow .fm-store strong{color:#e8eef8 !important}
.board-root[data-theme='dark'] .v7flow .fm-r{color:rgba(255,255,255,.96) !important}
.board-root[data-theme='dark'] .v7flow .fm-rg b{color:#ffffff !important}
/* 卡内高光：让纯蓝底有点体积感，不是死板色块 */
.v7flow .fm-node::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,0) 46%)}

/* 0 客户：浅一档蓝（不是灰色），整体退一档但仍清晰可读 */
.v7flow .fm-node.empty{background:color-mix(in srgb,var(--brand) 62%,var(--panel))}
.v7flow .fm-node.empty::after{background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,0) 46%)}
.board-root[data-theme='dark'] .v7flow .fm-node.empty{
  background:linear-gradient(135deg,#1d4ed8,#2563eb)}
/* 流程结束：绿色语义收尾 */
.v7flow .fm-node.done{background:linear-gradient(135deg,var(--green),color-mix(in srgb,var(--green) 58%,var(--brand2)))}
/* 当前主力节点（客户数最多）：外描边加重，建立主次 */
.v7flow .fm-node.focus{border-color:color-mix(in srgb,var(--brand) 45%,var(--panel));
  box-shadow:0 0 0 2px color-mix(in srgb,var(--brand) 22%,transparent),0 6px 16px color-mix(in srgb,var(--brand) 26%,transparent)}

/* 可点击节点 hover：轻微上浮，不改底色（避免白字对比度抖动） */
.v7flow .fm-node[role="button"]{cursor:pointer}
.v7flow .fm-node[role="button"]:hover{transform:translateY(-2px);box-shadow:0 8px 18px color-mix(in srgb,var(--brand) 30%,transparent)}
.v7flow .fm-node[role="button"]:focus-visible{outline:2px solid var(--brand3);outline-offset:2px}
.v7flow .fm-node.off{cursor:default}

/* R2-4 节点名称（白字，图标同色，图标只此 1 处） */
.v7flow .fm-name{position:relative;z-index:1;font-size:var(--fs-sm);font-weight:var(--fw-bold);color:#fff;letter-spacing:.2px;
  white-space:nowrap;line-height:1.25;display:flex;align-items:center;justify-content:center;gap:5px;max-width:100%}
.v7flow .fm-nameico{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;color:#fff}
/* 图标 18px（--fs-xs 12px + 6px），比 V9.2 的 15px 放大 */
.v7flow .fm-nameico svg{width:calc(var(--fs-xs) + 6px);height:calc(var(--fs-xs) + 6px)}

/* R2-4 / R2-5 客户数 26px + 占比跟在后面：42 家 · 28.6% */
.v7flow .fm-kpi{position:relative;z-index:1;display:flex;align-items:baseline;justify-content:center;
  flex-wrap:nowrap;gap:3px;line-height:1.05;min-width:0;max-width:100%}
.v7flow .fm-c{font-size:calc(var(--fs-xl) + 4px);font-weight:var(--fw-heavy);color:#fff;
  font-variant-numeric:tabular-nums;letter-spacing:-.6px;white-space:nowrap;display:inline-flex;align-items:baseline;gap:2px}
.v7flow .fm-c em{font-style:normal;font-size:var(--fs-2xs);font-weight:var(--fw-medium);color:rgba(255,255,255,.86);letter-spacing:0}
.v7flow .fm-r{font-size:var(--fs-2xs);font-weight:var(--fw-medium);color:rgba(255,255,255,.96);
  font-variant-numeric:tabular-nums;white-space:nowrap;line-height:1.2}

/* 卡内：南北区（白字 + 南白点 / 北浅绿点，蓝底上可辨） */
.v7flow .fm-region{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;gap:9px;
  font-size:var(--fs-xs);font-weight:var(--fw-medium);color:rgba(255,255,255,.82);line-height:1.3;
  font-variant-numeric:tabular-nums;white-space:nowrap}
.v7flow .fm-rg{display:inline-flex;align-items:center;gap:4px}
.v7flow .fm-rg i{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.v7flow .fm-rg.s i{background:rgba(255,255,255,.95)}
.v7flow .fm-rg.n i{background:color-mix(in srgb,var(--green) 40%,#fff 60%)}
.v7flow .fm-rg b{color:#fff;font-weight:var(--fw-bold)}

/* 卡内：平均耗时 */
.v7flow .fm-time{position:relative;z-index:1;font-size:var(--fs-2xs);font-weight:var(--fw-medium);
  color:rgba(255,255,255,.82);font-variant-numeric:tabular-nums;white-space:nowrap;line-height:1.3}
.v7flow .fm-time b{color:#fff;font-weight:var(--fw-bold)}

/* 卡内：门店数（V7 C7 保留；起点/终点数字加重） */
.v7flow .fm-store{position:relative;z-index:1;font-size:var(--fs-2xs);font-weight:var(--fw-medium);
  color:rgba(255,255,255,.82);font-variant-numeric:tabular-nums;white-space:nowrap;line-height:1.3}
.v7flow .fm-store b{color:#fff;font-weight:var(--fw-bold)}
.v7flow .fm-store.strong{padding:1px 7px;border-radius:999px;
  background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.24);color:rgba(255,255,255,.92)}
.v7flow .fm-store.strong b{font-weight:var(--fw-heavy)}

/* ── R2-3 卡下方 2 行：正常/超期 + 岗位 ── */
.v7flow .fm-foot{display:flex;flex-direction:column;align-items:center;gap:3px;padding:0 2px;min-height:0}
.v7flow .fm-od{display:flex;align-items:center;justify-content:center;gap:7px;
  font-size:var(--fs-2xs);font-weight:var(--fw-medium);color:var(--text2);
  font-variant-numeric:tabular-nums;white-space:nowrap;line-height:1.35}
.v7flow .fm-od b{font-weight:var(--fw-bold);color:var(--text)}
.v7flow .fm-od b.bad{color:var(--danger)}
.v7flow .fm-od i{font-style:normal;color:var(--line)}
.v7flow .fm-roles{width:100%;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:1px 5px;
  font-size:var(--fs-2xs);font-weight:var(--fw-medium);color:var(--text2);line-height:1.4;
  font-variant-numeric:tabular-nums}
.v7flow .fm-role{white-space:nowrap}
.v7flow .fm-role b{color:var(--text2);font-weight:var(--fw-bold)}
.v7flow .fm-sep{color:var(--line);opacity:1}

/* ── R2-6 箭头放大到 26×32，浅品牌色（醒目但不抢卡） ── */
.v7flow .fm-arrow{flex:0 0 26px;width:26px;display:grid;place-items:center;align-self:center;padding:0}
.v7flow .fm-arrow i{display:block;width:100%;height:32px;
  background:color-mix(in srgb,var(--brand) 58%,var(--panel));
  clip-path:polygon(0 0,46% 0,100% 50%,46% 100%,0 100%,24% 50%)}
.board-root[data-theme='dark'] .v7flow .fm-arrow i{
  background:color-mix(in srgb,var(--brand) 30%,var(--bg2))}

/* 弹窗内：超期口径说明（portal 到 body，用字面 rgba 保证深色可读） */
.fm-overdue-note{margin-top:14px;padding:11px 13px;border-radius:var(--radius-sm);background:var(--panel2);border:1px solid var(--line);line-height:1.7}
.fm-overdue-note .fm-on-title{font-size:var(--fs-xs);font-weight:var(--fw-bold);color:var(--text2);margin-bottom:3px}
.fm-overdue-note .fm-on-rules{font-size:var(--fs-xs);color:var(--text3)}
.fm-overdue-note b{color:var(--brand);font-weight:var(--fw-bold);font-variant-numeric:tabular-nums}

@media (max-width:575px){
  .v7flow .fm-map{padding:12px 10px 14px}
  .v7flow .fm-node-wrap{min-width:100px}
  .v7flow .fm-node{padding:11px 6px 10px}
  .v7flow .fm-c{font-size:var(--fs-xl)}
  .v7flow .fm-arrow{flex-basis:20px;width:20px}
  .v7flow .fm-arrow i{height:26px}
  .v7flow .fm-region{gap:6px}
}
`;

/* ══════════════ 工具函数 ══════════════ */

/** C6 平均耗时格式化：<1 天 → X.X时；≥1 天 → X.X天（avgDays 单位=天） */
function fmtAvgDays(days: number | null | undefined): string {
  const d = Number(days ?? 0);
  if (!Number.isFinite(d) || d <= 0) return '0.0天';
  if (d < 1) return `${(d * 24).toFixed(1)}时`;
  return `${d.toFixed(1)}天`;
}

/** C5 正常/超期：优先用后端字段，缺失则按明细行 status 兜底 */
function normalOverdue(nd: FlowNodeExt): { normal: number; overdue: number } {
  const rows = Array.isArray(nd.rows) ? nd.rows : [];
  const overdue = Number.isFinite(Number(nd.overdue))
    ? Number(nd.overdue)
    : rows.filter((r) => r?.status === '超期').length;
  const normal = Number.isFinite(Number(nd.normal))
    ? Number(nd.normal)
    : Math.max(0, (nd.clients ?? 0) - overdue);
  return { normal, overdue };
}

/**
 * R2-1 占比文本：**拿不到值就返回 null**（调用方据此不渲染），绝不返回 `-` 占位。
 * 口径：排除节点（销售签约/流程结束）、0 客户、ratio 非有限数 → null
 */
function ratioOf(nd: FlowNodeExt, clients: number): string | null {
  if (clients <= 0) return null;
  if (RATIO_EXCLUDED.includes(nd.name)) return null;
  const r = Number(nd.ratio);
  if (!Number.isFinite(r)) return null;
  return fmtPct(r, 1);
}

/* ══════════════ 明细弹窗列（口径不变，仅给区域/类型上语义色） ══════════════ */

const V7_REGION: Record<string, string> = { 南区: '#2563eb', 北区: '#10b981' };
const V7_CHAIN_TYPE: Record<string, string> = {
  全国百强: '#ef4444', 区县百强: '#f59e0b', '50+': '#eab308', '50-': '#94a3b8',
};
const V7_ALLOWED = new Set<string>([
  ...Object.values(V7_REGION), ...Object.values(V7_CHAIN_TYPE),
]);

function pickSharedColor(shared: Record<string, string>, v7: Record<string, string>, key: string): string {
  const s = shared?.[key];
  if (s && V7_ALLOWED.has(s)) return s;
  return v7[key] ?? s ?? 'var(--text2)';
}

function regionColor(v: string): string {
  return pickSharedColor(REGION_COLORS, V7_REGION, v);
}

function chainTypeColor(v: string): string {
  return pickSharedColor(CHAIN_TYPE_COLORS, V7_CHAIN_TYPE, v);
}

const COLUMNS: ColumnsType<DetailRow> = [
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 72,
    fixed: 'left',
    align: 'center',
    render: (v: string) =>
      v === '超期'
        ? <Tag color="error" style={{ marginInlineEnd: 0 }}>超期</Tag>
        : <Tag color="success" style={{ marginInlineEnd: 0 }}>正常</Tag>,
  },
  {
    title: '区域',
    dataIndex: 'region',
    key: 'region',
    width: 76,
    render: (v: string) => (
      <span style={{ color: regionColor(v), fontWeight: 650 }}>{v || '-'}</span>
    ),
  },
  { title: '连锁Id', dataIndex: 'chainId', key: 'chainId', width: 92 },
  { title: '连锁名称', dataIndex: 'chainName', key: 'chainName', width: 210, ellipsis: true },
  {
    title: '连锁类型',
    dataIndex: 'chainType',
    key: 'chainType',
    width: 100,
    render: (v: string) => (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          color: chainTypeColor(v),
          fontWeight: 650,
          whiteSpace: 'nowrap',
        }}
      >
        <i
          style={{
            width: 6,
            height: 6,
            borderRadius: 2,
            background: chainTypeColor(v),
            flex: '0 0 6px',
          }}
        />
        {v || '-'}
      </span>
    ),
  },
  { title: '门店数', dataIndex: 'stores', key: 'stores', width: 78, align: 'right' },
  { title: '处理人', dataIndex: 'owner', key: 'owner', width: 88 },
  { title: '进入当前节点时间', dataIndex: 'enterNodeDate', key: 'enterNodeDate', width: 128, align: 'center' },
  { title: '当前节点时长(天)', dataIndex: 'nodeDays', key: 'nodeDays', width: 128, align: 'right' },
  { title: '提交时间', dataIndex: 'submitDate', key: 'submitDate', width: 96, align: 'center' },
  { title: '连锁总时长(天)', dataIndex: 'totalDays', key: 'totalDays', width: 118, align: 'right' },
];

/* ══════════════ 组件 ══════════════ */

export default function FlowPipeline({ data, loading, isMobile }: Props) {
  const [active, setActive] = useState<FlowNodeExt | null>(null);

  const nodes = useMemo<FlowNodeExt[]>(() => {
    const list = data?.row2?.nodes;
    return Array.isArray(list) ? (list as FlowNodeExt[]) : [];
  }, [data?.row2?.nodes]);

  /** 当前主力节点 = 客户数最多者（建立主次，随筛选自动变化） */
  const maxClients = useMemo(
    () => nodes.reduce((m, nd) => Math.max(m, Number(nd?.clients ?? 0)), 0),
    [nodes],
  );

  return (
    <>
      <style>{CSS}</style>

      <div className="v7flow">
        <div className="fm-card">
          <div className="fm-hd">
            <h3><span className="fm-hd-dot" />流程状态</h3>
            <span className="fm-hd-hint">共 {nodes.length} 个节点 · 点击有客户的节点查看明细</span>
          </div>
          {nodes.length === 0 ? (
            <div style={{ padding: '14px 0' }}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
            </div>
          ) : (
            <div className="fm-map">
              {nodes.map((nd, i) => {
                const clients = Number(nd.clients ?? 0);
                const clickable = clients > 0;
                const noDuration = NO_DURATION.includes(nd.name);
                const isEmpty = clients <= 0;
                const isDone = nd.name === '流程结束';
                const isFocus = !isEmpty && clients === maxClients;

                const { normal, overdue } = normalOverdue(nd);
                const roles = (Array.isArray(nd.byRole) ? nd.byRole : [])
                  .filter((r) => r && r.role && Number.isFinite(Number(r.count)));
                const south = Number.isFinite(Number(nd.south)) ? Number(nd.south) : 0;
                const north = Number.isFinite(Number(nd.north)) ? Number(nd.north) : 0;

                /* R2-1：无值即不渲染 */
                const ratioText = ratioOf(nd, clients);
                const showRegion = clients > 0;                       // 0 客户时南北全 0，属无数据
                const showTime = !noDuration && clients > 0;          // 无客户时耗时是「—」
                /* 起点/终点不显示正常超期；0 客户时「正常 0 家 / 超期 0 家」同样无意义 → 不渲染 */
                const showOd = !noDuration && clients > 0;
                const showRoles = roles.length > 0;                   // 无岗位数据 → 整行不出现

                const cls = [
                  'fm-node',
                  isEmpty ? 'empty' : '',
                  isDone ? 'done' : '',
                  isFocus ? 'focus' : '',
                ].filter(Boolean).join(' ');

                const hasFoot = showOd || showRoles;

                return (
                  <React.Fragment key={String(nd.key ?? nd.name ?? i)}>
                    <div className="fm-node-wrap">
                      <div
                        className={cls}
                        role={clickable ? 'button' : undefined}
                        tabIndex={clickable ? 0 : -1}
                        aria-disabled={clickable ? undefined : true}
                        onClick={clickable ? () => setActive(nd) : undefined}
                        onKeyDown={
                          clickable
                            ? (e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setActive(nd);
                                }
                              }
                            : undefined
                        }
                        title={
                          clickable
                            ? `${nd.name} · 点击查看 ${fmtNum(clients)} 家客户明细`
                            : `${nd.name} · 当前无客户，不可点击`
                        }
                      >
                        {/* 名称：图标（仅此 1 处）+ 白字标题 */}
                        <div className="fm-name">
                          <span className="fm-nameico">{NODE_ICON[nd.name] ?? ICON_FALLBACK}</span>
                          {nd.name}
                        </div>

                        {/* 客户数 26px + 占比紧跟其后：42 家 · 28.6% */}
                        <div className="fm-kpi">
                          <span className="fm-c">{fmtNum(clients)}<em>家</em></span>
                          {ratioText !== null && <span className="fm-r">· {ratioText}</span>}
                        </div>

                        {/* 卡内：南北区 */}
                        {showRegion && (
                          <div className="fm-region">
                            <span className="fm-rg s"><i />南 <b>{fmtNum(south)}</b></span>
                            <span className="fm-rg n"><i />北 <b>{fmtNum(north)}</b></span>
                          </div>
                        )}

                        {/* 卡内：平均耗时 */}
                        {showTime && (
                          <div className="fm-time">
                            平均耗时 <b>{fmtAvgDays(nd.avgDays)}</b>/每客户
                          </div>
                        )}

                        {/* 卡内：门店数（V7 C7 保留；起点/终点加重显示） */}
                        <div className={`fm-store${noDuration ? ' strong' : ''}`}>
                          门店 <b>{fmtNum(nd.stores)}</b> 家
                        </div>
                      </div>

                      {/* R2-3 卡下方 2 行：正常/超期 → 岗位 */}
                      {hasFoot && (
                        <div className="fm-foot">
                          {showOd && (
                            <div className="fm-od">
                              <span>正常 <b>{fmtNum(normal)}</b> 家</span>
                              <i>|</i>
                              <span>超期 <b className={overdue > 0 ? 'bad' : ''}>{fmtNum(overdue)}</b> 家</span>
                            </div>
                          )}
                          {showRoles && (
                            <div className="fm-roles">
                              {roles.map((r, idx) => (
                                <React.Fragment key={`${nd.name}-${r.role}-${idx}`}>
                                  {idx > 0 && <span className="fm-sep">·</span>}
                                  <span className="fm-role">{r.role} <b>{fmtNum(r.count)}</b></span>
                                </React.Fragment>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* R2-6 大气箭头 */}
                    {i < nodes.length - 1 && (
                      <div className="fm-arrow" aria-hidden="true"><i /></div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Modal
        title={
          active
            ? `${active.name} · 明细（${fmtNum(active.clients)} 家）`
            : ''
        }
        open={!!active}
        onCancel={() => setActive(null)}
        footer={null}
        width={isMobile ? '96vw' : 1180}
        styles={{ body: { maxHeight: '74vh', overflowY: 'auto' } }}
      >
        {active ? (
          <>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'var(--panel2)',
                border: '1px solid var(--line)',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                按岗位汇总：
              </span>
              {Array.isArray(active.byRole) && active.byRole.length > 0 ? (
                active.byRole.map((r) => (
                  <span
                    key={r.role}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      height: 24,
                      padding: '0 10px',
                      borderRadius: 7,
                      fontSize: 12,
                      background: 'var(--panel)',
                      border: '1px solid var(--line)',
                      color: 'var(--text2)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.role}{' '}
                    <b style={{ color: 'var(--brand)', fontWeight: 750 }}>{fmtNum(r.count)}</b> 家
                  </span>
                ))
              ) : (
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>无岗位数据</span>
              )}
            </div>

            <Table<DetailRow>
              size="small"
              rowKey={(r) => `${r.chainId}-${r.enterNodeAt}`}
              loading={loading}
              columns={COLUMNS}
              dataSource={Array.isArray(active.rows) ? active.rows : []}
              scroll={{ x: 'max-content' }}
              pagination={{
                pageSize: 10,
                size: 'small',
                showSizeChanger: false,
                showTotal: (t) => `共 ${t} 条`,
              }}
              rowClassName={(r) => (r.status === '超期' ? 'board-row-overdue' : '')}
            />

            <div className="fm-overdue-note">
              <div className="fm-on-title">
                超期口径：上一节点结束后在本节点的工作日超过阈值即视为超期。
              </div>
              <div className="fm-on-rules">
                策略开通 <b>2</b> 个工作日 · 实施对接 <b>5</b> 个工作日 · 对接审核 <b>2</b> 个工作日 ·
                客服处理 <b>10</b> 个工作日 · 客户培训 <b>3</b> 个工作日 · 连锁使用 <b>5</b> 个工作日 ·
                策略审核 <b>2</b> 个工作日
              </div>
            </div>
          </>
        ) : (
          <Empty description="暂无明细" />
        )}
      </Modal>
    </>
  );
}
