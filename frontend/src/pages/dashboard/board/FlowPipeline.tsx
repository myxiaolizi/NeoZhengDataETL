/** 第 2 排：流程状态分布（9 节点流程图）— V7.0
 *
 * V7 改造点（对应 _work/V7-CONTRACT.md §五 C1-C9）：
 *   C2 每节点内联 SVG 图标（stroke=currentColor），彻底去掉 1-8 序号
 *   C3 连接块改为 46px 高渐变粗箭头（clip-path 大三角连接块），视觉冲击更强
 *   C4 图标 + 客户数 + 占比同框，蓝底白字渐变
 *   C5 显示「正常 X 家 / 超期 X 家」（node.normal / node.overdue，缺失时按明细 status 兜底）
 *   C6 平均耗时：<1 天显示 X.X时，≥1 天显示 X.X天，文案「平均耗时：X.X天/每客户」
 *   C7 销售签约 / 流程结束 无耗时概念，门店数单独一行强调显示
 *   C8 0 客户节点不可点：无 onClick、cursor:default、无 hover 上浮、tabIndex=-1
 *   C9 卡片下方直接显示该节点各岗位客户数（node.byRole），无需点开弹窗
 *
 * 数据全部由 Board.tsx 通过 props 下发，组件内不发请求。
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

/* ══════════════ C2：9 节点内联 SVG 图标 ══════════════ */

/** 统一 SVG 外壳：18px、描边式、跟随 currentColor */
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

/* ══════════════ 局部样式（统一 .v7flow 作用域，避免污染全局） ══════════════ */
const CSS = `
.v7flow{min-width:0}
.v7flow .fm-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:14px 14px 11px;min-width:0;overflow:hidden}
.v7flow .fm-map{display:flex;align-items:stretch;overflow-x:auto;overflow-y:visible;padding:2px 0 6px;scrollbar-width:thin}
.v7flow .fm-map::-webkit-scrollbar{height:6px}
.v7flow .fm-map::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}

.v7flow .fm-node{flex:1 1 0;min-width:112px;display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 5px 9px;border-radius:var(--radius-sm);border:1px solid transparent;background:transparent;text-align:center;transition:transform .18s cubic-bezier(.4,0,.2,1),background .18s ease,border-color .18s ease,box-shadow .18s ease}
.v7flow .fm-node[role="button"]{cursor:pointer}
.v7flow .fm-node[role="button"]:hover{background:var(--panel2);border-color:var(--brand3);transform:translateY(-3px);box-shadow:0 10px 22px color-mix(in srgb,var(--brand) 16%,transparent)}
.v7flow .fm-node[role="button"]:focus-visible{outline:2px solid var(--brand3);outline-offset:2px}
.v7flow .fm-node.off{cursor:default}
.v7flow .fm-node.off:hover{background:transparent;border-color:transparent;transform:none;box-shadow:none}

.v7flow .fm-name{font-size:11.5px;font-weight:700;color:var(--text2);letter-spacing:.2px;white-space:nowrap;line-height:1.2;display:flex;align-items:center;justify-content:center;gap:5px}
/* V7.1 D2：名称前的图标 */
.v7flow .fm-nameico{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;color:var(--brand)}
.v7flow .fm-nameico svg{width:15px;height:15px}
/* V7.1 D5：卡片内南/北区连锁数 */
.v7flow .fm-region{display:flex;align-items:center;justify-content:center;gap:8px;font-size:10px;color:var(--text3);line-height:1.3;font-variant-numeric:tabular-nums;white-space:nowrap}
.v7flow .fm-rg{display:inline-flex;align-items:center;gap:3px}
.v7flow .fm-rg i{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.v7flow .fm-rg.s i{background:var(--brand)}
.v7flow .fm-rg.n i{background:var(--green)}
.v7flow .fm-rg.s b{color:var(--brand);font-weight:750}
.v7flow .fm-rg.n b{color:var(--green);font-weight:750}
/* V7.1 D7：超期口径说明（弹窗明细表格下方） */
.fm-overdue-note{margin-top:14px;padding:10px 12px;border-radius:10px;background:var(--panel2);border:1px solid var(--line);line-height:1.7}
.fm-overdue-note .fm-on-title{font-size:12px;font-weight:700;color:var(--text2);margin-bottom:3px}
.fm-overdue-note .fm-on-rules{font-size:11.5px;color:var(--text3)}
.fm-overdue-note b{color:var(--brand);font-weight:750;font-variant-numeric:tabular-nums}

/* C4 图标+客户数+占比同框：蓝底白字（固定高度，9 卡等高不换行） */
.v7flow .fm-sum{width:100%;height:50px;display:flex;align-items:center;justify-content:center;gap:5px;padding:0 4px;border-radius:10px;color:#fff;box-shadow:0 4px 12px color-mix(in srgb,var(--brand) 24%,transparent);overflow:hidden}
.v7flow .fm-ico{display:grid;place-items:center;flex:0 0 auto;opacity:.96}
.v7flow .fm-icoline{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-width:0}
.v7flow .fm-c{font-size:17px;font-weight:800;line-height:1.05;font-variant-numeric:tabular-nums;letter-spacing:-.4px;white-space:nowrap}
.v7flow .fm-c em{font-style:normal;font-size:10px;font-weight:600;opacity:.86;margin-left:1px}
.v7flow .fm-r{font-size:9.5px;font-weight:700;line-height:1.2;opacity:.92;font-variant-numeric:tabular-nums;white-space:nowrap}

/* C5 正常 / 超期 */
.v7flow .fm-od{display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;font-size:10px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.v7flow .fm-ok{color:var(--green,#10b981)}
.v7flow .fm-bad{color:var(--danger,#ef4444)}

/* C6 平均耗时 */
.v7flow .fm-time{font-size:10px;color:var(--text3);font-variant-numeric:tabular-nums;white-space:nowrap;line-height:1.3}
.v7flow .fm-time b{color:var(--brand);font-weight:750}

/* C7 门店数（销售签约/流程结束单独一行强调） */
.v7flow .fm-store{font-size:10px;color:var(--text3);font-variant-numeric:tabular-nums;white-space:nowrap;line-height:1.3}
.v7flow .fm-store b{color:var(--text2);font-weight:750}
.v7flow .fm-store.strong{display:inline-flex;align-items:center;gap:4px;margin-top:1px;padding:2px 8px;border-radius:999px;background:var(--panel2);border:1px solid var(--line);color:var(--text2);font-weight:650}
.v7flow .fm-store.strong b{color:var(--brand);font-weight:800}

/* C9 岗位客户数 */
.v7flow .fm-roles{width:100%;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:1px 3px;margin-top:1px;padding-top:6px;border-top:1px dashed var(--line2);font-size:9.5px;color:var(--text3);line-height:1.5;font-variant-numeric:tabular-nums}
.v7flow .fm-role{white-space:nowrap}
.v7flow .fm-role b{color:var(--text2);font-weight:800}
.v7flow .fm-sep{color:var(--text3);opacity:.55}

/* C3 更大气：46px 高渐变粗连接块 + 大三角（宽 30，桌面 9 卡一屏放得下） */
.v7flow .fm-arrow{flex:0 0 30px;width:30px;display:grid;place-items:center;align-self:center;padding:0 1px}
.v7flow .fm-arrow i{display:block;width:100%;height:46px;background:linear-gradient(135deg,var(--brand) 0%,var(--brand3) 100%);clip-path:polygon(0 0,50% 0,100% 50%,50% 100%,0 100%,40% 50%);opacity:.94;filter:drop-shadow(0 2px 5px color-mix(in srgb,var(--brand) 32%,transparent))}

.v7flow .fm-note{margin-top:8px;padding-top:8px;border-top:1px solid var(--line2);font-size:10.5px;color:var(--text3);line-height:1.6}

@media (max-width:575px){
  .v7flow .fm-card{padding:12px 10px 9px}
  .v7flow .fm-node{min-width:106px;padding:9px 5px 8px}
  .v7flow .fm-arrow{flex-basis:24px;width:24px}
  .v7flow .fm-arrow i{height:38px}
  .v7flow .fm-sum{height:46px}
  .v7flow .fm-c{font-size:15px}
  .v7flow .fm-r{font-size:9px}
}
`;

/* ══════════════ 工具函数 ══════════════ */

/** 汇总卡底色：0 客户=灰，流程结束=绿，其余=品牌蓝渐变 */
function sumGradient(nd: FlowNodeExt): string {
  if ((nd.clients ?? 0) <= 0) return 'linear-gradient(135deg,var(--gray,#94a3b8),var(--text3,#93a7c2))';
  if (nd.name === '流程结束') return 'linear-gradient(135deg,var(--green,#10b981),var(--green2,#34d399))';
  return 'linear-gradient(135deg,var(--brand),var(--brand2))';
}

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

/* ══════════════ 明细弹窗列（列不变，仅给区域/类型上语义色） ══════════════ */

/** V7 契约 §2.1 语义色（本轮口径） */
const V7_REGION: Record<string, string> = { 南区: '#2563eb', 北区: '#10b981' };
const V7_CHAIN_TYPE: Record<string, string> = {
  全国百强: '#ef4444', 区县百强: '#f59e0b', '50+': '#eab308', '50-': '#94a3b8',
};
/** §2.1 允许的色值集合，用于判断共享常量是否已迁移到本轮口径 */
const V7_ALLOWED = new Set<string>([
  ...Object.values(V7_REGION), ...Object.values(V7_CHAIN_TYPE),
]);

/**
 * 取色策略：共享常量（@/api/crm-board）若已是 §2.1 新色则优先用共享值，
 * 否则回落到本文件内的 §2.1 字面值。
 * 这样 Lead 更新 crm-board.ts 后本组件自动跟随，无需再改。
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

  return (
    <>
      <style>{CSS}</style>

      <div className="v7flow">
        <div className="fm-card">
          {nodes.length === 0 ? (
            <div style={{ padding: '14px 0' }}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
            </div>
          ) : (
            <>
              <div className="fm-map">
                {nodes.map((nd, i) => {
                  const clickable = (nd.clients ?? 0) > 0;
                  const noDuration = NO_DURATION.includes(nd.name);
                  const { normal, overdue } = normalOverdue(nd);
                  const roles = Array.isArray(nd.byRole) ? nd.byRole : [];
                  /* V7.1 D5：该节点南/北区连锁数（后端已提供） */
                  const south = Number.isFinite(Number(nd.south)) ? Number(nd.south) : 0;
                  const north = Number.isFinite(Number(nd.north)) ? Number(nd.north) : 0;
                  const ratioText = RATIO_EXCLUDED.includes(nd.name)
                    ? '—'
                    : fmtPct(nd.ratio, 1);
                  return (
                    <React.Fragment key={String(nd.key ?? nd.name ?? i)}>
                      <div
                        className={`fm-node${clickable ? '' : ' off'}`}
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
                            ? `${nd.name} · 点击查看 ${fmtNum(nd.clients)} 家客户明细`
                            : `${nd.name} · 当前无客户，不可点击`
                        }
                      >
                        {/* V7.1 D2：图标显示在卡片名称前方（同一行） */}
                        <div className="fm-name">
                          <span className="fm-nameico">{NODE_ICON[nd.name] ?? ICON_FALLBACK}</span>
                          {nd.name}
                        </div>

                        {/* C4：图标 + 客户数 + 占比 同框，蓝底白字 */}
                        <div className="fm-sum" style={{ background: sumGradient(nd) }}>
                          <span className="fm-ico">{NODE_ICON[nd.name] ?? ICON_FALLBACK}</span>
                          <span className="fm-icoline">
                            <span className="fm-c">
                              {fmtNum(nd.clients)}
                              <em>家</em>
                            </span>
                            <span className="fm-r">占比 {ratioText}</span>
                          </span>
                        </div>

                        {/* V7.1 D6：正常 / 超期（工作日口径） */}
                        <div className="fm-od">
                          <span className="fm-ok">正常 {fmtNum(normal)} 家</span>
                          <span className="fm-bad">超期 {fmtNum(overdue)} 家</span>
                        </div>

                        {/* C6：耗时（C7：销售签约/流程结束不显示） */}
                        {!noDuration && (
                          <div className="fm-time">
                            平均耗时：
                            <b>{(nd.clients ?? 0) > 0 ? fmtAvgDays(nd.avgDays) : '—'}</b>
                            /每客户
                          </div>
                        )}

                        {/* V7.1 D5：当前节点南/北区连锁数（显示在卡片中） */}
                        <div className="fm-region">
                          <span className="fm-rg s">
                            <i />南 <b>{fmtNum(south)}</b>
                          </span>
                          <span className="fm-rg n">
                            <i />北 <b>{fmtNum(north)}</b>
                          </span>
                        </div>

                        {/* C7：门店数；销售签约/流程结束单独一行强调 */}
                        <div className={`fm-store${noDuration ? ' strong' : ''}`}>
                          门店 <b>{fmtNum(nd.stores)}</b> 家
                        </div>

                        {/* C9：岗位客户数直接在卡下显示，无需点开 */}
                        <div className="fm-roles">
                          {roles.length === 0 ? (
                            <span className="fm-role">无岗位数据</span>
                          ) : (
                            roles.map((r, idx) => (
                              <React.Fragment key={`${nd.name}-${r.role}-${idx}`}>
                                {idx > 0 && <span className="fm-sep">·</span>}
                                <span className="fm-role">
                                  {r.role} <b>{fmtNum(r.count)}</b>
                                </span>
                              </React.Fragment>
                            ))
                          )}
                        </div>
                      </div>

                      {/* C3：粗壮渐变连接箭头 */}
                      {i < nodes.length - 1 && (
                        <div className="fm-arrow" aria-hidden="true">
                          <i />
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>

              <div className="fm-note">
                占比分母已排除「销售签约」「流程结束」· 超期口径：当前节点时长 &gt; 7 天 ·
                耗时不足 1 天按小时呈现 · 0 客户节点不可点击
              </div>
            </>
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
                borderRadius: 11,
                background: 'var(--panel2)',
                border: '1px solid var(--line)',
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>
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

            {/* V7.1 D7：超期口径说明（放在明细表格下方） */}
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
