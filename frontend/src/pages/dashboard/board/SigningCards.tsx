/** 第 1 排：签约概览（5 张卡片）— V10 布局重排
 *
 * V10 改动（对应 _work/V10-CONTRACT.md §四 R1）：
 *   1. 签约概览 改 1+2 布局（第一行「客户数 + 南北区」／第二行「门店 2 列 + 签约类型」）
 *   2. 任务完成进度：「连锁数/目标数/未计入」移到半圆右侧；南北进度条 10px
 *   3. 进行中：「XX 家进行中 + 南北」移到卡头右侧
 *   4. 流程结束：汇总与南/北数字**同字号**
 *   5. 新增「客户 ERP 分布」卡（读 row1.erpDistribution，缺失时优雅空态）
 *   6. 栅格宽度 25 / 20 / 17.5 / 17.5 / 20（= 100%），1920px 下 5 卡 1 排等高
 *
 * 纪律：最小字号 11px；颜色只用令牌；南北区固定 --south / --north；
 *       卡头基线沿用 Board.tsx 的 .board-root .vb1-h（优先级更高，不对抗）。
 */
import React, { useMemo, useState } from 'react';
import { Empty, Modal, Table, Tabs, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { BoardData, DetailRow } from '@/api/crm-board';
import { fmtNum } from './theme';

interface Props {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

/** ERP 分布项（后端 Lead 后续补充 row1.erpDistribution；当前可能不存在） */
interface ErpItem {
  name: string;
  clients: number;
}

/* ══════════════ 局部样式（vb1- 前缀避免污染全局） ══════════════ */
const CSS = `
/* ── 栅格：1920 下 5 卡 1 排；宽度按需求 25/20/17.5/17.5/20 ── */
.vb1-grid{display:grid;gap:16px;grid-template-columns:25fr 20fr 17.5fr 17.5fr 20fr;align-items:stretch}
@media(max-width:1600px){.vb1-grid{grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:1fr}}
@media(max-width:1100px){.vb1-grid{grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:1fr}}
/* 单列（手机）：不再强制等高，避免内容少的卡被拉高出现空白 */
@media(max-width:768px){.vb1-grid{grid-template-columns:1fr;grid-auto-rows:auto}}

/* ── 卡片外壳 ── */
.vb1-card{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;min-width:0;transition:border-color .18s ease,box-shadow .18s ease}
.vb1-card:hover{border-color:var(--line);box-shadow:var(--shadow2)}
/* 主卡（.vb1-card-merged）的顶边 / 渐变底由 Board.tsx 全局基线统一提供，此处不重复定义。 */

/* ── 卡头：结构与内距由 .board-root .vb1-h 基线统一（48px / 0 16px / 渐变底），
      这里只补装饰件，并把右侧副值推到最右。 ── */
.vb1-h h3{font-size:var(--fs-sm);font-weight:700;color:var(--text);display:flex;align-items:center;gap:7px;margin:0;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.vb1-dot{width:8px;height:8px;border-radius:3px;background:var(--brand);flex-shrink:0}
/* margin-left:auto 把副值推到卡头最右（全局基线没有设 justify-content） */
.vb1-hint{font-size:var(--fs-2xs);color:var(--text3);font-weight:600;white-space:nowrap;flex-shrink:0;margin-left:auto;display:flex;align-items:center;gap:5px}

/* ── 卡身 ── */
.vb1-b{padding:12px 14px;flex:1;display:flex;flex-direction:column;gap:10px;min-height:0;min-width:0}

/* ── 通用 KPI 数字 ── */
.vb1-num{font-size:var(--fs-2xl);font-weight:750;line-height:1;letter-spacing:-1px;font-variant-numeric:tabular-nums;color:var(--text)}
.vb1-num em{font-style:normal;font-size:var(--fs-2xs);font-weight:600;color:var(--text3);margin-left:3px;letter-spacing:0}
.vb1-num.sm{font-size:var(--fs-xl)}
.vb1-lbl{font-size:var(--fs-2xs);font-weight:600;color:var(--text3);letter-spacing:.2px;white-space:nowrap}

/* ══ 卡1 签约概览：1 + 2 布局 ══ */
/* 第一行：左「97 家客户」，右「南 41 / 北 56」 */
.vb1-cv-row1{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding-bottom:10px;border-bottom:1px solid var(--line2);min-width:0}
.vb1-cv-row1 .vb1-num{min-width:0;white-space:nowrap}
.vb1-regs{display:flex;align-items:center;gap:12px;font-size:var(--fs-xs);font-weight:600;color:var(--text3);white-space:nowrap;font-variant-numeric:tabular-nums;flex-shrink:0}
.vb1-regs span{display:inline-flex;align-items:center;gap:4px}
.vb1-regs i{width:6px;height:6px;border-radius:2px;flex-shrink:0}
.vb1-regs b{font-size:var(--fs-md);font-weight:700;margin-left:1px}
.vb1-regs .s i{background:var(--south)}
.vb1-regs .s b{color:var(--south)}
.vb1-regs .n i{background:var(--north)}
.vb1-regs .n b{color:var(--north)}
/* 第二行：门店数 | 签约类型 两列 */
.vb1-cv-row2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:12px;flex:1;min-width:0}
.vb1-cv-col{display:flex;flex-direction:column;gap:6px;justify-content:center;min-width:0}
.vb1-cv-col:first-child{padding-right:12px;border-right:1px solid var(--line2)}
/* 门店：南/北比例条 */
.vb1-sbar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--line2);gap:2px}
.vb1-sbar i{display:block;height:100%}
.vb1-sbar .s{background:var(--south)}
.vb1-sbar .n{background:var(--north)}
/* 签约类型：名称允许换行，不裁切 */
.vb1-types{display:flex;flex-direction:column;gap:8px;min-width:0}
.vb1-type{display:flex;flex-direction:column;gap:3px;min-width:0}
.vb1-type-nm{font-size:var(--fs-2xs);font-weight:600;color:var(--text2);line-height:1.35;display:flex;align-items:center;gap:5px;white-space:normal;word-break:break-word}
.vb1-type-nm .d{width:6px;height:6px;border-radius:2px;flex-shrink:0}
.vb1-type-v{font-size:var(--fs-md);font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;line-height:1.2;white-space:nowrap}
.vb1-type-v em{font-style:normal;font-size:var(--fs-2xs);font-weight:600;color:var(--text3);margin-left:2px}
.vb1-type-v .st{color:var(--text3);font-size:var(--fs-2xs);font-weight:600;margin-left:6px}
.vb1-type-bar{height:5px;border-radius:3px;background:var(--line2);overflow:hidden}
.vb1-type-bar i{display:block;height:100%;border-radius:3px;transition:width .5s cubic-bezier(.4,0,.2,1)}

/* ══ 卡2 任务完成进度：半圆 + 右侧三指标 ══ */
/* flex:1 让「半圆 + 三指标」这块吃掉卡身剩余高度，消除底部空白 */
.vb1-task-main{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:1;min-height:0;min-width:0}
.vb1-semi{position:relative;width:140px;height:74px;flex-shrink:0}
.vb1-semi svg{display:block;width:100%;height:100%;overflow:visible}
.vb1-semi-c{position:absolute;left:0;right:0;bottom:0;text-align:center;pointer-events:none}
.vb1-semi-c b{font-size:var(--fs-xl);font-weight:750;letter-spacing:-.8px;line-height:1;font-variant-numeric:tabular-nums;display:block;color:var(--text)}
.vb1-semi-c b em{font-style:normal;font-size:var(--fs-2xs);font-weight:600;color:var(--text3);margin-left:1px;letter-spacing:0}
.vb1-semi-c span{font-size:var(--fs-2xs);color:var(--text3);font-weight:600;margin-top:2px;display:block}
/* 半圆右侧：连锁数 / 目标数 / 未计入（纵向撑满，行间均匀分布） */
.vb1-tn-col{display:flex;flex-direction:column;justify-content:center;gap:6px;flex:1;min-width:0;height:100%}
.vb1-tn-row{display:flex;align-items:baseline;justify-content:space-between;gap:6px;padding:4px 8px;border-radius:var(--radius-sm);background:var(--panel2);min-width:0}
.vb1-tn-row .k{font-size:var(--fs-2xs);color:var(--text3);font-weight:600;white-space:nowrap}
.vb1-tn-row b{font-size:var(--fs-md);font-weight:700;font-variant-numeric:tabular-nums;color:var(--text);line-height:1.15;white-space:nowrap}
/* 深色下「未计入」对比度不足 → 标签与数值都提亮到 text2 */
.vb1-tn-row.muted,.vb1-tn-row.muted .k,.vb1-tn-row.muted b{color:var(--text2)}
/* 南北区进度条：轨道高度 10px（需求指定） */
.vb1-prog{display:flex;flex-direction:column;justify-content:center;gap:9px;flex:1;min-height:0}
.vb1-pg-top{display:flex;align-items:baseline;justify-content:space-between;gap:6px;margin-bottom:5px}
.vb1-pg-l{font-size:var(--fs-xs);font-weight:600;color:var(--text2);display:flex;align-items:center;gap:5px;white-space:nowrap}
.vb1-pg-l .d{width:6px;height:6px;border-radius:2px;background:var(--south);flex-shrink:0}
.vb1-pg-l.g2 .d{background:var(--north)}
.vb1-pg-v{font-size:var(--fs-xs);font-weight:600;color:var(--text3);font-variant-numeric:tabular-nums;white-space:nowrap}
.vb1-pg-v b{font-size:var(--fs-md);font-weight:700;color:var(--text);margin-right:1px}
.vb1-pg-v .sep{color:var(--text3);margin:0 1px}
.vb1-pg-v em{font-style:normal;font-size:var(--fs-2xs);font-weight:700;color:var(--south);margin-left:5px;padding-left:6px;border-left:1px solid var(--line)}
.vb1-pg-v em.g2{color:var(--north)}
.vb1-pg-track{height:10px;border-radius:5px;background:var(--line2);overflow:hidden}
.vb1-pg-fill{height:100%;border-radius:5px;min-width:3px;background:var(--south);transition:width .7s cubic-bezier(.4,0,.2,1)}
.vb1-pg-fill.g2{background:var(--north)}

/* ══ 卡头内的「XX 家进行中 + 南北」（卡3） ══ */
.vb1-hing{display:flex;align-items:center;gap:6px;font-size:var(--fs-2xs);font-weight:600;color:var(--text3);white-space:nowrap}
.vb1-hing b{font-size:var(--fs-md);font-weight:750;font-variant-numeric:tabular-nums;color:var(--text)}
.vb1-hing .regs{display:inline-flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums}
.vb1-hing .regs span{display:inline-flex;align-items:center;gap:3px}
.vb1-hing .regs i{width:5px;height:5px;border-radius:2px;flex-shrink:0}
.vb1-hing .regs b{font-size:var(--fs-xs);font-weight:700;margin-left:1px}
.vb1-hing .s i{background:var(--south)}
.vb1-hing .s b{color:var(--south)}
.vb1-hing .n i{background:var(--north)}
.vb1-hing .n b{color:var(--north)}

/* ══ 通用表格行（卡3 进行中 / 卡4 流程结束 / 卡5 ERP） ══ */
.vb1-tb{display:flex;flex-direction:column;flex:1;min-width:0}
.vb1-tb-head,.vb1-tb-row{display:grid;align-items:center;gap:8px;min-width:0}
.vb1-tb-head{padding:0 8px 5px;font-size:var(--fs-2xs);font-weight:700;color:var(--text3);letter-spacing:.2px;border-bottom:1px solid var(--line)}
.vb1-tb-head span:not(:first-child){text-align:right}
.vb1-tb-head .south{color:var(--south)}
.vb1-tb-head .north{color:var(--north)}
.vb1-tb-row{padding:7px 8px;transition:background .15s ease;min-width:0}
/* 行分隔只用「斑马纹」一种手法，不再叠加描边 */
.vb1-tb-row:nth-child(even){background:var(--panel2)}
.vb1-tb-row.cursor{cursor:pointer}
.vb1-tb-row.cursor:hover{background:var(--brandSoft)}
.vb1-tb-k{display:flex;align-items:center;gap:6px;font-size:var(--fs-xs);font-weight:600;color:var(--text2);white-space:nowrap;min-width:0}
.vb1-tb-k i{width:6px;height:6px;border-radius:2px;flex-shrink:0}
.vb1-tb-n{font-size:var(--fs-md);font-weight:700;font-variant-numeric:tabular-nums;text-align:right;color:var(--text)}
.vb1-tb-n.zero{color:var(--text3);font-weight:600}
.vb1-tb-s{font-size:var(--fs-xs);font-weight:600;font-variant-numeric:tabular-nums;text-align:right}
.vb1-tb-s.south{color:var(--south)}
.vb1-tb-s.north{color:var(--north)}
.vb1-tb-s.zero{color:var(--text3)}
.vb1-ing .vb1-tb-head,.vb1-ing .vb1-tb-row{grid-template-columns:minmax(0,1fr) 44px 38px 38px}
.vb1-ing{display:flex;flex-direction:column;flex:1;min-width:0}

/* ══ 卡4 流程结束：汇总与南/北**同字号**（都是 fs-md 14px） ══ */
.vb1-fs .vb1-tb-head,.vb1-fs .vb1-tb-row{grid-template-columns:minmax(0,1fr) 48px 42px 42px}
.vb1-fs .vb1-tb-n,.vb1-fs .vb1-tb-s{font-size:var(--fs-md);font-weight:700;letter-spacing:0}
.vb1-fs .vb1-tb-n.ok{color:var(--green)}
.vb1-fs .vb1-tb-n.no{color:var(--danger)}
.vb1-fs .vb1-tb-row{padding:6px 8px}
.vb1-fs{display:flex;flex-direction:column;flex:1;min-width:0}

/* ══ 卡5 客户 ERP 分布 ══ */
/* space-between 让行均匀撑满卡身，避免底部留白 */
.vb1-erp{display:flex;flex-direction:column;justify-content:space-between;gap:6px;flex:1;min-height:0;min-width:0}
.vb1-erp-row{display:flex;flex-direction:column;gap:3px;min-width:0}
.vb1-erp-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}
.vb1-erp-nm{font-size:var(--fs-xs);font-weight:600;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;min-width:0}
.vb1-erp-v{font-size:var(--fs-md);font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;white-space:nowrap;flex-shrink:0}
.vb1-erp-v em{font-style:normal;font-size:var(--fs-2xs);font-weight:600;color:var(--text3);margin-left:2px}
.vb1-erp-v .pct{font-size:var(--fs-2xs);font-weight:700;color:var(--text3);margin-left:5px}
.vb1-erp-bar{height:6px;border-radius:3px;background:var(--line2);overflow:hidden}
.vb1-erp-bar i{display:block;height:100%;border-radius:3px;background:var(--brand);transition:width .5s cubic-bezier(.4,0,.2,1)}
/* 「其他 N 个」聚合行：弱化处理，与真实 ERP 行区分 */
.vb1-erp-row.agg .vb1-erp-nm,.vb1-erp-row.agg .vb1-erp-v{color:var(--text3);font-weight:600}
.vb1-erp-row.agg .vb1-erp-bar i{background:var(--text3)}

.vb1-empty{display:flex;flex:1;align-items:center;justify-content:center;padding:10px 0;min-height:0}
.vb1-empty-txt{font-size:var(--fs-xs);color:var(--text3);font-weight:600;text-align:center;line-height:1.6}
`;

/** 明细表列（进行中 / 通用） */
const DETAIL_COLUMNS: ColumnsType<DetailRow> = [
  { title: '连锁Id', dataIndex: 'chainId', key: 'chainId', width: 92, fixed: 'left' },
  { title: '区域', dataIndex: 'region', key: 'region', width: 70 },
  { title: '连锁名称', dataIndex: 'chainName', key: 'chainName', width: 210, ellipsis: true },
  { title: '连锁类型', dataIndex: 'chainType', key: 'chainType', width: 92 },
  { title: '当前节点', dataIndex: 'node', key: 'node', width: 96 },
  { title: '处理人', dataIndex: 'owner', key: 'owner', width: 88 },
  { title: '进入当前节点时间', dataIndex: 'enterNodeDate', key: 'enterNodeDate', width: 128, align: 'center' },
  { title: '当前节点时长(天)', dataIndex: 'nodeDays', key: 'nodeDays', width: 128, align: 'right' },
  { title: '提交时间', dataIndex: 'submitDate', key: 'submitDate', width: 96, align: 'center' },
  { title: '连锁总时长(天)', dataIndex: 'totalDays', key: 'totalDays', width: 118, align: 'right' },
];

/** 明细表渲染（超期行标红） */
function DetailTableBlock({ rows }: { rows: DetailRow[]; isMobile: boolean }) {
  return (
    <Table<DetailRow>
      size="small"
      rowKey={(r) => `${r.chainId}-${r.node}-${r.enterNodeAt}`}
      columns={DETAIL_COLUMNS}
      dataSource={rows}
      scroll={{ x: 'max-content' }}
      pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `共 ${t} 条`, size: 'small' }}
      rowClassName={(r) => (r.status === '超期' ? 'board-row-overdue' : '')}
      style={{ marginTop: 4 }}
    />
  );
}

/** 卡片外壳：标题 + 右侧副值（卡头基线由 Board.tsx 统一） */
function Shell({
  title, dot, hint, children, hero,
}: {
  title: string;
  dot?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  /** 主卡（合并卡）：顶边与渐变底由 Board.tsx 的 .vb1-card-merged 基线提供 */
  hero?: boolean;
}) {
  return (
    <div className={`vb1-card${hero ? ' vb1-card-merged' : ''}`}>
      <div className="vb1-h">
        <h3>
          <span className="vb1-dot" style={dot ? { background: dot } : undefined} />
          {title}
        </h3>
        {hint != null && <span className="vb1-hint">{hint}</span>}
      </div>
      <div className="vb1-b">{children}</div>
    </div>
  );
}

/** 半圆进度（弧长 = PI*74），中心是 22px 次 KPI */
function Semi({ rate }: { rate: number }) {
  const ARC = Math.PI * 74;
  const r = Math.min(100, Math.max(0, rate));
  const len = (r / 100) * ARC;
  return (
    <div className="vb1-semi">
      <svg viewBox="0 0 184 96" aria-hidden="true">
        <defs>
          <linearGradient id="vb1-semi-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--brand)" />
            <stop offset="100%" stopColor="var(--brand3)" />
          </linearGradient>
        </defs>
        <path d="M 18 88 A 74 74 0 0 1 166 88" fill="none" stroke="var(--line2)" strokeWidth="12" strokeLinecap="round" />
        <path
          d="M 18 88 A 74 74 0 0 1 166 88" fill="none" stroke="url(#vb1-semi-grad)"
          strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${len} ${ARC}`}
          strokeDashoffset="0"
          style={{ transition: 'stroke-dasharray .7s cubic-bezier(.4,0,.2,1)' }}
        />
      </svg>
      <div className="vb1-semi-c">
        <b>{r.toFixed(1)}<em>%</em></b>
        <span>总体完成</span>
      </div>
    </div>
  );
}

export default function SigningCards({ data, loading, isMobile }: Props) {
  const [modal, setModal] = useState<{ title: string; groups: { name: string; count: number; rows: DetailRow[] }[] } | null>(null);

  const r1 = data.row1;

  /** 签约类型进度条归一化基准 */
  const maxSignClients = useMemo(
    () => r1.signTypes.reduce((m, t) => Math.max(m, t.clients), 0) || 1,
    [r1.signTypes],
  );

  /**
   * 客户 ERP 分布：后端（Lead）后续补 row1.erpDistribution，当前可能不存在。
   * 用可选链 + Array.isArray 兜底，缺失/空数组时渲染优雅空态，绝不崩。
   * 卡高固定（1920 下 277px），ERP 可能有十几个 → 取前 N 项，其余聚合成「其他 N 个」，
   * 完整清单放 Tooltip。
   */
  const ERP_TOP_N = 5;
  const erpList: ErpItem[] = useMemo(() => {
    const raw = (r1 as unknown as { erpDistribution?: unknown }).erpDistribution;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => ({ name: String(x.name ?? ''), clients: Number(x.clients ?? 0) || 0 }))
      .filter((x) => x.name !== '')
      .sort((a, b) => b.clients - a.clients);
  }, [r1]);
  const erpTotal = erpList.reduce((s, x) => s + x.clients, 0);
  const maxErpClients = erpList.reduce((m, x) => Math.max(m, x.clients), 0) || 1;
  /** 实际渲染行：前 N 项 + 可选「其他 N 个」聚合行 */
  const erpRows = useMemo(() => {
    if (erpList.length <= ERP_TOP_N + 1) {
      return erpList.map((e) => ({ ...e, agg: false, count: erpList.length }));
    }
    const top = erpList.slice(0, ERP_TOP_N).map((e) => ({ ...e, agg: false, count: erpList.length }));
    const rest = erpList.slice(ERP_TOP_N);
    const restSum = rest.reduce((s, x) => s + x.clients, 0);
    return [...top, { name: `其他 ${rest.length} 个 ERP`, clients: restSum, agg: true, count: erpList.length }];
  }, [erpList]);

  const hasInProgress = (r1.inProgress.total ?? 0) > 0;

  /** 进行中 5 岗位（互斥口径，每项带 汇总/南区/北区） */
  const ingRows = [
    { key: 'strategy', label: '策略', color: 'var(--cyan)', blk: r1.inProgress.strategy },
    { key: 'implement', label: '实施', color: 'var(--brand)', blk: r1.inProgress.implement },
    { key: 'service', label: '客服', color: 'var(--purple)', blk: r1.inProgress.service },
    { key: 'solution', label: '解决方案', color: 'var(--warn)', blk: r1.inProgress.solution },
    { key: 'sales', label: '销售', color: 'var(--green)', blk: r1.inProgress.sales },
  ];
  const ingSouth = ingRows.reduce((s, x) => s + (x.blk?.south || 0), 0);
  const ingNorth = ingRows.reduce((s, x) => s + (x.blk?.north || 0), 0);

  /** 门店南区分占比（用于比例条） */
  const stTotal = r1.totalStores || 0;
  const stSouthPct = stTotal > 0 ? (r1.storesByRegion.south / stTotal) * 100 : 0;

  return (
    <>
      <style>{CSS}</style>

      <div className="vb1-grid">
        {/* ══ 卡1 签约概览（1 + 2 布局） ══ */}
        <Shell title="签约概览" hero>
          {/* 第一行：左 客户总数，右 南/北区 */}
          <div className="vb1-cv-row1">
            <div className="vb1-num">{fmtNum(r1.totalClients)}<em>家客户</em></div>
            <div className="vb1-regs">
              <span className="s"><i />南<b>{fmtNum(r1.totalClientsByRegion.south)}</b></span>
              <span className="n"><i />北<b>{fmtNum(r1.totalClientsByRegion.north)}</b></span>
            </div>
          </div>

          {/* 第二行：门店数 | 签约类型 */}
          <div className="vb1-cv-row2">
            <div className="vb1-cv-col">
              <div className="vb1-lbl">门店总数</div>
              <div className="vb1-num sm">{fmtNum(r1.totalStores)}</div>
              <div className="vb1-sbar">
                <i className="s" style={{ width: `${stSouthPct}%` }} />
                <i className="n" style={{ width: `${100 - stSouthPct}%` }} />
              </div>
              <div className="vb1-regs">
                <span className="s"><i />南<b>{fmtNum(r1.storesByRegion.south)}</b></span>
                <span className="n"><i />北<b>{fmtNum(r1.storesByRegion.north)}</b></span>
              </div>
            </div>

            <div className="vb1-cv-col">
              <div className="vb1-lbl">签约类型</div>
              {r1.signTypes.length === 0 ? (
                <div className="vb1-empty"><div className="vb1-empty-txt">暂无签约类型</div></div>
              ) : (
                <div className="vb1-types">
                  {r1.signTypes.map((t, i) => {
                    const pct = (t.clients / maxSignClients) * 100;
                    const color = i === 0 ? 'var(--brand)' : 'var(--cyan)';
                    return (
                      <Tooltip
                        key={t.name}
                        title={
                          <div>
                            {t.byChainType.map((b) => (
                              <div key={b.name}>{b.name}：{b.clients} 户 / {b.stores} 店</div>
                            ))}
                          </div>
                        }
                      >
                        <div className="vb1-type">
                          <div className="vb1-type-nm">
                            <span className="d" style={{ background: color }} />
                            {t.name}
                          </div>
                          <div className="vb1-type-v">
                            {t.clients}<em>户</em>
                            <span className="st">{fmtNum(t.stores)} 店</span>
                          </div>
                          <div className="vb1-type-bar">
                            <i style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: color }} />
                          </div>
                        </div>
                      </Tooltip>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </Shell>

        {/* ══ 卡2 任务完成进度（半圆左 + 三指标右 + 南北进度条） ══ */}
        <Shell title="任务完成进度" dot="var(--warn)">
          <div className="vb1-task-main">
            <Semi rate={r1.progress.rate} />
            {/* 「连锁数 / 目标数 / 未计入」在半圆右侧 */}
            <div className="vb1-tn-col">
              <div className="vb1-tn-row">
                <span className="k">连锁数</span>
                <b>{fmtNum(r1.progress.chains ?? r1.progress.achieved)}</b>
              </div>
              <div className="vb1-tn-row">
                <span className="k">目标数</span>
                <b>{fmtNum(r1.progress.target)}</b>
              </div>
              <div className="vb1-tn-row muted" title="连锁类型为 50-，不计入任务">
                <span className="k">未计入</span>
                <b>{fmtNum(r1.progress.excluded ?? 0)}</b>
              </div>
            </div>
          </div>
          <div className="vb1-prog">
            <div>
              <div className="vb1-pg-top">
                <span className="vb1-pg-l"><span className="d" />南区</span>
                <span className="vb1-pg-v">
                  <b>{fmtNum(r1.progress.south.achieved)}</b>
                  <span className="sep">/</span>
                  {fmtNum(r1.progress.south.target)}
                  <em>{r1.progress.south.rate.toFixed(1)}%</em>
                </span>
              </div>
              <div className="vb1-pg-track">
                <div className="vb1-pg-fill" style={{ width: `${Math.min(100, r1.progress.south.rate)}%` }} />
              </div>
            </div>
            <div>
              <div className="vb1-pg-top">
                <span className="vb1-pg-l g2"><span className="d" />北区</span>
                <span className="vb1-pg-v">
                  <b>{fmtNum(r1.progress.north.achieved)}</b>
                  <span className="sep">/</span>
                  {fmtNum(r1.progress.north.target)}
                  <em className="g2">{r1.progress.north.rate.toFixed(1)}%</em>
                </span>
              </div>
              <div className="vb1-pg-track">
                <div className="vb1-pg-fill g2" style={{ width: `${Math.min(100, r1.progress.north.rate)}%` }} />
              </div>
            </div>
          </div>
        </Shell>

        {/* ══ 卡3 进行中（卡头右侧放「XX 家进行中 + 南北」） ══ */}
        <Shell
          title="进行中"
          dot="var(--pink)"
          hint={
            <span className="vb1-hing">
              <b>{fmtNum(r1.inProgress.total ?? 0)}</b>家进行中
              <span className="regs">
                <span className="s"><i />南<b>{fmtNum(ingSouth)}</b></span>
                <span className="n"><i />北<b>{fmtNum(ingNorth)}</b></span>
              </span>
            </span>
          }
        >
          {!hasInProgress ? (
            <div className="vb1-empty"><div className="vb1-empty-txt">无进行中</div></div>
          ) : (
            <div className="vb1-tb vb1-ing">
              <div className="vb1-tb-head">
                <span>岗位</span>
                <span>合计</span>
                <span className="south">南区</span>
                <span className="north">北区</span>
              </div>
              {ingRows.map((it) => {
                const clickable = (it.blk?.groups || []).length > 0;
                const total = it.blk?.total || 0;
                const south = it.blk?.south || 0;
                const north = it.blk?.north || 0;
                return (
                  <div
                    key={it.key}
                    className={`vb1-tb-row${clickable ? ' cursor' : ''}`}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : -1}
                    onClick={() => { if (clickable) setModal({ title: it.label, groups: it.blk.groups }); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && clickable) setModal({ title: it.label, groups: it.blk.groups }); }}
                  >
                    <span className="vb1-tb-k">
                      <i style={{ background: it.color }} />
                      {it.label}
                    </span>
                    <span className={`vb1-tb-n${total ? '' : ' zero'}`}>{total}</span>
                    <span className={`vb1-tb-s south${south ? '' : ' zero'}`}>{south}</span>
                    <span className={`vb1-tb-s north${north ? '' : ' zero'}`}>{north}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Shell>

        {/* ══ 卡4 流程结束（汇总与南/北同字号） ══ */}
        <Shell title="流程结束" dot="var(--green)">
          <div className="vb1-tb vb1-fs">
            <div className="vb1-tb-head">
              <span>指标</span>
              <span>汇总</span>
              <span className="south">南区</span>
              <span className="north">北区</span>
            </div>
            <div className="vb1-tb-row">
              <span className="vb1-tb-k">客户数</span>
              <span className="vb1-tb-n">{fmtNum(r1.flowStatus.completedClients)}</span>
              <span className="vb1-tb-s south">{fmtNum(r1.flowStatus.south)}</span>
              <span className="vb1-tb-s north">{fmtNum(r1.flowStatus.north)}</span>
            </div>
            <div className="vb1-tb-row">
              <span className="vb1-tb-k">门店数</span>
              <span className="vb1-tb-n">{fmtNum(r1.flowStatus.completedStores)}</span>
              <span className="vb1-tb-s south">{fmtNum(r1.flowStatus.storesSouth ?? 0)}</span>
              <span className="vb1-tb-s north">{fmtNum(r1.flowStatus.storesNorth ?? 0)}</span>
            </div>
            <div className="vb1-tb-row">
              <span className="vb1-tb-k">开通策略</span>
              <span className="vb1-tb-n ok">{fmtNum(r1.flowStatus.strategyOpened)}</span>
              <span className="vb1-tb-s south">{fmtNum(r1.flowStatus.openedSouth ?? 0)}</span>
              <span className="vb1-tb-s north">{fmtNum(r1.flowStatus.openedNorth ?? 0)}</span>
            </div>
            <div className="vb1-tb-row">
              <span className="vb1-tb-k">未开策略</span>
              <span className="vb1-tb-n no">{fmtNum(r1.flowStatus.strategyNotOpened)}</span>
              <span className="vb1-tb-s south">{fmtNum(r1.flowStatus.notOpenedSouth ?? 0)}</span>
              <span className="vb1-tb-s north">{fmtNum(r1.flowStatus.notOpenedNorth ?? 0)}</span>
            </div>
          </div>
        </Shell>

        {/* ══ 卡5 客户 ERP 分布（新增） ══ */}
        <Shell title="客户 ERP 分布" dot="var(--cyan)">
          {erpRows.length === 0 ? (
            <div className="vb1-empty">
              <div className="vb1-empty-txt">暂无 ERP 数据</div>
            </div>
          ) : (
            <div className="vb1-erp">
              {erpRows.map((e, i) => {
                const pct = erpTotal > 0 ? (e.clients / erpTotal) * 100 : 0;
                const barPct = Math.max(2, Math.min(100, (e.clients / maxErpClients) * 100));
                return (
                  <div className={`vb1-erp-row${e.agg ? ' agg' : ''}`} key={`${e.name}-${i}`}>
                    <div className="vb1-erp-top">
                      <span className="vb1-erp-nm" title={e.name}>{e.name}</span>
                      <span className="vb1-erp-v">
                        {fmtNum(e.clients)}<em>家</em>
                        <span className="pct">{pct.toFixed(1)}%</span>
                      </span>
                    </div>
                    <div className="vb1-erp-bar"><i style={{ width: `${barPct}%` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </Shell>
      </div>

      {/* 进行中明细弹窗 */}
      <Modal
        title={`${modal?.title || ''} · 明细（${(modal?.groups || []).reduce((s, g) => s + g.count, 0)} 家）`}
        open={!!modal}
        onCancel={() => setModal(null)}
        footer={null}
        width={isMobile ? '96vw' : 1120}
        styles={{ body: { maxHeight: '72vh', overflowY: 'auto' } }}
      >
        {modal && modal.groups.length > 0 ? (
          modal.groups.length === 1 ? (
            <DetailTableBlock rows={modal.groups[0].rows} isMobile={isMobile} />
          ) : (
            <Tabs
              size="small"
              items={modal.groups.map((g) => ({
                key: g.name,
                label: `${g.name} (${g.count})`,
                children: <DetailTableBlock rows={g.rows} isMobile={isMobile} />,
              }))}
            />
          )
        ) : (
          <Empty description="暂无明细" />
        )}
      </Modal>
    </>
  );
}
