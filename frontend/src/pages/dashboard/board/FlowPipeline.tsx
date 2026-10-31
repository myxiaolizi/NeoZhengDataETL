/** 第 2 排：流程状态分布（9 节点流程图）— V9.2 视觉重构
 *
 * ── 本轮为什么改「蓝底白字」方案 ──
 * 改造前实测：9 张卡里有 **18 个蓝色块**（9 个名称蓝底 + 9 个数字蓝底），
 * 且所有文字几乎都是 12px，层次全靠「有没有蓝底」硬撑 → 9 个一模一样的蓝色按钮，
 * 用户原话「视觉噪音很大、重点全无」。
 *
 * 新方案：**一卡一重点**（白底 + 顶部 3px 色条 + 大号深色数字）
 *   · 去掉 9 个名称蓝底 → 名称改为「品牌色图标 + 深色标题」，白底，不再抢视觉
 *   · 保留 1 个视觉重点 = **大号客户数**（22px/750，靠「字号」建立层次而非「色块」）
 *   · 顶部 3px 色条承担「状态识别」：有客户=品牌色 / 0客户=极淡 --line / 流程结束=绿
 *   · 客户数最多的节点（当前主力节点）额外获得 brandSoft 底 + 品牌色数字 → 真正的「主」
 *
 * ── 4 级层次（严格照契约） ──
 *   L1 节点名称   13px / 700 / var(--text)
 *   L2 客户数     22px / 750 / var(--text)
 *   L3 南北区     12px / 600 / var(--brand) · var(--green)
 *   L4 正常超期·耗时·岗位  11px / 600 / var(--text3)
 *
 * ── 保留的已验收功能（V7/V8.1，全部未动） ──
 *   · 图标只在名称前 1 处（D2）
 *   · 耗时 / 南北区 / 正常超期 / 岗位数 全部在卡内（C6 / D5 / C5 / C9 / D6）
 *   · 销售签约（起点）与流程结束（终点）不显示「正常/超期」行（D6）
 *   · 0 客户节点不可点击：无 onClick、无 role、tabIndex=-1、cursor:default、无 hover（C8）
 *   · 平均耗时格式 <1天→X.X时，≥1天→X.X天（C6）
 *   · 弹窗、明细表格、超期口径说明（含工作日阈值）完全保留
 *
 * 数据全部由 Board.tsx 通过 props 下发，组件内不发请求。数据结构与 props 未改动。
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
  /** V7.1：工作日超期阈值与南北区连锁数 */
  overdueThreshold?: number | null; overdueRule?: string; avgOverdueDays?: number;
  south?: number; north?: number;
};

/** 占比分母排除的节点（与后端 RATIO_EXCLUDED 一致）：这两个节点不参与占比 */
const RATIO_EXCLUDED = ['销售签约', '流程结束'];

/** 没有「耗时」概念的节点：起点与终点，门店数单独一行 */
const NO_DURATION = ['销售签约', '流程结束'];

/* ══════════════ 9 节点内联 SVG 图标（stroke=currentColor） ══════════════ */

function ico(children: React.ReactNode, size = 16): React.ReactNode {
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
 * 全部使用 Board.tsx 的 V9.2 令牌，字号取 --fs-* 阶梯，最小 11px。
 */
const CSS = `
.v7flow{min-width:0}
.v7flow .fm-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:0;min-width:0;overflow:hidden;display:flex;flex-direction:column}

/* ── 卡片头部 ── */
.v7flow .fm-hd{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line2);flex-shrink:0}
.v7flow .fm-hd h3{font-size:var(--fs-sm);font-weight:var(--fw-bold);color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.v7flow .fm-hd-dot{width:6px;height:6px;border-radius:2px;background:var(--brand);flex-shrink:0}
.v7flow .fm-hd-hint{font-size:var(--fs-xs);color:var(--text3);font-weight:var(--fw-normal);white-space:nowrap}

/* ── 节点横排容器：9 节点等分，不换行 ── */
.v7flow .fm-map{padding:14px 16px 16px;display:flex;align-items:stretch;overflow-x:auto;overflow-y:visible;gap:0;scrollbar-width:thin}
.v7flow .fm-map::-webkit-scrollbar{height:6px}
.v7flow .fm-map::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}

/* ── 节点卡：白底 / 顶部 3px 状态色条 / 无多余描边 ── */
.v7flow .fm-node{position:relative;flex:1 1 0;min-width:104px;display:flex;flex-direction:column;align-items:center;gap:5px;padding:13px 6px 10px;border-radius:var(--radius-sm);border:1px solid transparent;background:transparent;text-align:center;transition:background .16s ease,border-color .16s ease}
/* 顶部状态色条（用 ::before，不占布局高度） */
.v7flow .fm-node::before{content:'';position:absolute;left:12px;right:12px;top:0;height:3px;border-radius:0 0 3px 3px;background:var(--brand);opacity:.55}
/* 0 客户 → 色条退为极淡；背景 panel2；数字 text3（降权但不灰掉） */
.v7flow .fm-node.empty::before{background:var(--line);opacity:1}
.v7flow .fm-node.empty{background:var(--panel2);border-color:var(--line2)}
/* 流程结束 → 绿色收尾 */
.v7flow .fm-node.done::before{background:var(--green);opacity:.85}
/* 重点节点（客户数最多）→ 色条实心 + 品牌淡底 */
.v7flow .fm-node.focus{border-color:var(--brand3)}
.v7flow .fm-node.focus::before{background:var(--brand);opacity:1}
.v7flow .fm-node.focus{background:var(--brandSoft)}

/* 可点击节点的 hover：只保留轻微反馈，不做上浮阴影（避免噪音） */
.v7flow .fm-node[role="button"]{cursor:pointer}
.v7flow .fm-node[role="button"]:hover{border-color:var(--brand3);background:var(--brandSoft)}
.v7flow .fm-node[role="button"]:focus-visible{outline:2px solid var(--brand3);outline-offset:2px}
.v7flow .fm-node.off{cursor:default}

/* ── L1 节点名称：白底 + 品牌色图标 + 深色标题（去掉了蓝底白字） ── */
.v7flow .fm-name{font-size:var(--fs-xs);font-weight:var(--fw-bold);color:#fff;letter-spacing:.2px;white-space:nowrap;line-height:1.2;display:flex;align-items:center;justify-content:center;gap:4px;background:linear-gradient(135deg,var(--brand),var(--brand2));border-radius:999px;padding:3px 10px 3px 8px;box-shadow:0 1px 3px color-mix(in srgb,var(--brand) 26%,transparent);max-width:100%;overflow:hidden}
.v7flow .fm-nameico{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;color:#fff;opacity:.96}
.v7flow .fm-nameico svg{width:15px;height:15px}
/* 0 客户：名称与图标一起退到 text3 */
/* V9.2：0 客户节点名称也保持蓝底白字（用户要求不要灰色），仅整体降权 */
/* V9.2：0 客户节点名称用浅一档的品牌蓝（不是灰），满足「为0也不要灰色」 */.v7flow .fm-node.empty .fm-name{background:linear-gradient(135deg,color-mix(in srgb,var(--brand) 74%,var(--panel)),color-mix(in srgb,var(--brand2) 74%,var(--panel)))}
.v7flow .fm-node.empty .fm-nameico{color:#fff;opacity:.9}
/* 流程结束：整卡绿色语义 */
.v7flow .fm-node.done .fm-nameico{color:#fff}
/* 重点节点：名称用品牌色 */
.v7flow .fm-node.focus .fm-name{color:#fff;box-shadow:0 2px 8px color-mix(in srgb,var(--brand) 45%,transparent),0 0 0 2px color-mix(in srgb,var(--brand) 18%,transparent)}

/* ── L2 客户数（视觉重点：22px/750，靠字号建立层次） ── */
.v7flow .fm-kpi{display:flex;flex-direction:column;align-items:center;gap:0;line-height:1.1;min-width:0}
.v7flow .fm-c{font-size:var(--fs-xl);font-weight:var(--fw-heavy);color:var(--text);font-variant-numeric:tabular-nums;letter-spacing:-.6px;white-space:nowrap;display:inline-flex;align-items:baseline;gap:2px}
.v7flow .fm-c em{font-style:normal;font-size:var(--fs-2xs);font-weight:var(--fw-medium);color:var(--text3);letter-spacing:0}
.v7flow .fm-node.empty .fm-c{color:var(--text3)}
.v7flow .fm-node.focus .fm-c{color:var(--brand)}
.v7flow .fm-node.done .fm-c{color:var(--green)}
/* 占比：紧跟大数字的小字 */
.v7flow .fm-r{font-size:var(--fs-2xs);font-weight:var(--fw-medium);color:var(--text3);font-variant-numeric:tabular-nums;white-space:nowrap;line-height:1.3;margin-top:1px}

/* ── L3 南北区：12px/600，南蓝北绿 ── */
.v7flow .fm-region{display:flex;align-items:center;justify-content:center;gap:9px;font-size:var(--fs-xs);font-weight:var(--fw-medium);color:var(--text3);line-height:1.3;font-variant-numeric:tabular-nums;white-space:nowrap}
.v7flow .fm-rg{display:inline-flex;align-items:center;gap:4px}
.v7flow .fm-rg i{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.v7flow .fm-rg.s i{background:var(--brand)}
.v7flow .fm-rg.n i{background:var(--green)}
.v7flow .fm-rg.s b{color:var(--brand);font-weight:var(--fw-bold)}
.v7flow .fm-rg.n b{color:var(--green);font-weight:var(--fw-bold)}
.v7flow .fm-node.empty .fm-rg.s b,
.v7flow .fm-node.empty .fm-rg.n b{color:var(--text3)}
.v7flow .fm-node.empty .fm-rg.s i{background:var(--text3)}
.v7flow .fm-node.empty .fm-rg.n i{background:var(--text3)}

/* ── L4 正常/超期 · 耗时 · 岗位：11px/600 text3，仅数字提色 ── */
.v7flow .fm-od{display:flex;align-items:center;justify-content:center;gap:8px;font-size:var(--fs-2xs);font-weight:var(--fw-medium);color:var(--text3);font-variant-numeric:tabular-nums;white-space:nowrap;line-height:1.3}
.v7flow .fm-od b{font-weight:var(--fw-bold);color:var(--text2)}
.v7flow .fm-od b.bad{color:var(--danger)}

.v7flow .fm-time{font-size:var(--fs-2xs);font-weight:var(--fw-medium);color:var(--text3);font-variant-numeric:tabular-nums;white-space:nowrap;line-height:1.3}
.v7flow .fm-time b{color:var(--text2);font-weight:var(--fw-bold)}

/* 门店：普通节点弱化；起点/终点做小胶囊强调 */
.v7flow .fm-store{font-size:var(--fs-2xs);font-weight:var(--fw-medium);color:var(--text3);font-variant-numeric:tabular-nums;white-space:nowrap;line-height:1.3}
.v7flow .fm-store b{color:var(--text2);font-weight:var(--fw-bold)}
.v7flow .fm-store.strong{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;background:var(--panel2);border:1px solid var(--line);color:var(--text2)}
.v7flow .fm-store.strong b{color:var(--brand);font-weight:var(--fw-heavy)}
.v7flow .fm-node.empty .fm-store.strong{background:transparent;border-color:var(--line2)}

/* 岗位：底部虚线分隔 */
.v7flow .fm-roles{width:100%;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:1px 5px;margin-top:auto;padding-top:6px;border-top:1px dashed var(--line2);font-size:var(--fs-2xs);font-weight:var(--fw-medium);color:var(--text3);line-height:1.45;font-variant-numeric:tabular-nums}
.v7flow .fm-role{white-space:nowrap}
.v7flow .fm-role b{color:var(--text2);font-weight:var(--fw-bold)}
.v7flow .fm-sep{color:var(--line);opacity:1}

/* ── 箭头弱化：18px 宽、22px 高、--line 色、无渐变无阴影 ── */
.v7flow .fm-arrow{flex:0 0 18px;width:18px;display:grid;place-items:center;align-self:center;padding:0}
.v7flow .fm-arrow i{display:block;width:100%;height:22px;background:var(--line);clip-path:polygon(0 0,52% 0,100% 50%,52% 100%,0 100%,26% 50%);opacity:1}

/* 弹窗内：超期口径说明 */
.fm-overdue-note{margin-top:14px;padding:11px 13px;border-radius:var(--radius-sm);background:var(--panel2);border:1px solid var(--line);line-height:1.7}
.fm-overdue-note .fm-on-title{font-size:var(--fs-xs);font-weight:var(--fw-bold);color:var(--text2);margin-bottom:3px}
.fm-overdue-note .fm-on-rules{font-size:var(--fs-xs);color:var(--text3)}
.fm-overdue-note b{color:var(--brand);font-weight:var(--fw-bold);font-variant-numeric:tabular-nums}

@media (max-width:575px){
  .v7flow .fm-map{padding:12px 10px 14px}
  .v7flow .fm-node{min-width:92px;padding:11px 4px 9px}
  .v7flow .fm-c{font-size:var(--fs-lg)}
  .v7flow .fm-arrow{flex-basis:14px;width:14px}
  .v7flow .fm-arrow i{height:18px}
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

/* ══════════════ 明细弹窗列（不变，仅给区域/类型上语义色） ══════════════ */

const V7_REGION: Record<string, string> = { 南区: '#2563eb', 北区: '#10b981' };
const V7_CHAIN_TYPE: Record<string, string> = {
  全国百强: '#ef4444', 区县百强: '#f59e0b', '50+': '#eab308', '50-': '#94a3b8',
};
const V7_ALLOWED = new Set<string>([
  ...Object.values(V7_REGION), ...Object.values(V7_CHAIN_TYPE),
]);

/**
 * 取色策略：共享常量（@/api/crm-board）若已是新色则优先用共享值，
 * 否则回落到本文件内的字面值。Lead 更新 crm-board.ts 后本组件自动跟随。
 */
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

  /** 当前主力节点 = 客户数最多者（用于建立「主次」，随筛选自动变化） */
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
                /* 重点节点：有客户且客户数最多（0 客户不会成为重点） */
                const isFocus = !isEmpty && clients === maxClients;
                const { normal, overdue } = normalOverdue(nd);
                const roles = Array.isArray(nd.byRole) ? nd.byRole : [];
                const south = Number.isFinite(Number(nd.south)) ? Number(nd.south) : 0;
                const north = Number.isFinite(Number(nd.north)) ? Number(nd.north) : 0;
                const ratioText = RATIO_EXCLUDED.includes(nd.name) ? '—' : fmtPct(nd.ratio, 1);

                const cls = [
                  'fm-node',
                  isEmpty ? 'empty' : '',
                  isDone ? 'done' : '',
                  isFocus ? 'focus' : '',
                ].filter(Boolean).join(' ');

                return (
                  <React.Fragment key={String(nd.key ?? nd.name ?? i)}>
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
                      {/* L1 名称：图标（仅此 1 处）+ 深色标题 */}
                      <div className="fm-name">
                        <span className="fm-nameico">{NODE_ICON[nd.name] ?? ICON_FALLBACK}</span>
                        {nd.name}
                      </div>

                      {/* L2 客户数：22px/750 大数字 + 占比小字 */}
                      <div className="fm-kpi">
                        <span className="fm-c">{fmtNum(clients)}<em>家</em></span>
                        <span className="fm-r">占比 {ratioText}</span>
                      </div>

                      {/* L3 南北区 */}
                      <div className="fm-region">
                        <span className="fm-rg s"><i />南 <b>{fmtNum(south)}</b></span>
                        <span className="fm-rg n"><i />北 <b>{fmtNum(north)}</b></span>
                      </div>

                      {/* L4 正常 / 超期（销售签约与流程结束不显示） */}
                      {!noDuration && (
                        <div className="fm-od">
                          <span>正常 <b>{fmtNum(normal)}</b></span>
                          <span>超期 <b className={overdue > 0 ? 'bad' : ''}>{fmtNum(overdue)}</b></span>
                        </div>
                      )}

                      {/* L4 平均耗时 */}
                      {!noDuration && (
                        <div className="fm-time">
                          平均耗时 <b>{clients > 0 ? fmtAvgDays(nd.avgDays) : '—'}</b>/每客户
                        </div>
                      )}

                      {/* 门店数；起点/终点用小胶囊强调 */}
                      <div className={`fm-store${noDuration ? ' strong' : ''}`}>
                        门店 <b>{fmtNum(nd.stores)}</b> 家
                      </div>

                      {/* L4 岗位客户数 */}
                      <div className="fm-roles">
                        {roles.length === 0 ? (
                          <span className="fm-role">无岗位数据</span>
                        ) : (
                          roles.map((r, idx) => (
                            <React.Fragment key={`${nd.name}-${r.role}-${idx}`}>
                              {idx > 0 && <span className="fm-sep">·</span>}
                              <span className="fm-role">{r.role} <b>{fmtNum(r.count)}</b></span>
                            </React.Fragment>
                          ))
                        )}
                      </div>
                    </div>

                    {/* 弱化箭头 */}
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
