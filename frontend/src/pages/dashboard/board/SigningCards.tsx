/** 第 1 排：签约概览（4 张卡片）— V9.2 视觉重构
 *
 * 本轮只做视觉优化，数据结构 / props / 交互逻辑完全不变。
 *
 * 设计原则（针对「4 卡同质化、没有主次」）：
 *   1. 建立三层 KPI 字号阶梯（令牌 --fs-2xl / --fs-xl / --fs-lg / --fs-md）：
 *        主 KPI  28px  合并卡的客户数、门店数
 *        次 KPI  22px  进度卡完成率、流程结束卡的「汇总」列
 *        三级    17px  进行中卡总数
 *        行内数字 14px  表格行内数值
 *        单位/标签 11px  「家」「店」等
 *   2. 卡片分级：合并卡是主卡（品牌色细顶边 + 极淡品牌底），其余 3 卡为常规卡。
 *   3. 卡头统一（8px 圆角小方点 + 13px/700 标题 + 12px 副值），去掉发光与渐变。
 *   4. 阴影只用令牌单层 --shadow；不用 translateY 悬浮与多层光晕。
 *   5. 表格行统一改为「1px 细线分隔 + 交替极淡底色」，不再「描边 + 底色」双装饰。
 *   6. 签约类型名称不再 ellipsis 裁切，允许换行。
 *
 * 颜色一律走 var(--token)，深色模式自动跟随。
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

/* ══════════════ 局部样式（vb1- 前缀避免污染全局） ══════════════ */
const CSS = `
/* ── 栅格：1920 下 4 卡 1 排，主卡（合并卡）更宽以体现层级 ── */
.vb1-grid{display:grid;gap:12px;grid-template-columns:1.5fr 1fr 1fr 1fr;grid-auto-rows:1fr;align-items:stretch}
@media(max-width:1600px){.vb1-grid{grid-template-columns:1fr 1fr}}
/* 单列（手机）：不再强制等高，避免内容少的卡被拉高出现空白 */
@media(max-width:900px){.vb1-grid{grid-template-columns:1fr;grid-auto-rows:auto}}

/* ── 卡片外壳 ── */
.vb1-card{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;min-width:0;transition:border-color .18s ease,box-shadow .18s ease}
.vb1-card:hover{border-color:var(--line);box-shadow:var(--shadow2)}
/* 主卡（.vb1-card-merged）的顶边 / 渐变底由 Board.tsx 全局基线统一提供，这里不再重复定义，
   避免两份规则打架；本文件只补「3 区块内部」的排版。 */

/* ── 卡头：结构与内距由 Board.tsx 的 .board-root .vb1-h 基线统一（48px / 0 16px / 渐变底），
      这里只补装饰件。4 卡卡头结构保持一致。 ── */
.vb1-h h3{font-size:var(--fs-sm);font-weight:700;color:var(--text);display:flex;align-items:center;gap:7px;margin:0;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.vb1-dot{width:8px;height:8px;border-radius:3px;background:var(--brand);flex-shrink:0}
.vb1-hint{font-size:var(--fs-xs);color:var(--text3);font-weight:600;white-space:nowrap;flex-shrink:0}
.vb1-hint b{font-size:var(--fs-lg);font-weight:750;color:var(--text);font-variant-numeric:tabular-nums;margin-right:2px}
.vb1-hint em{font-style:normal;font-weight:600;color:var(--text3);margin-left:2px}

/* ── 卡身 ── */
.vb1-b{padding:12px 14px;flex:1;display:flex;flex-direction:column;gap:10px;min-height:0;min-width:0}

/* ── 通用 KPI 数字（主 28 / 次 22 / 三级 17） ── */
.vb1-mg-num{font-size:var(--fs-2xl);font-weight:750;line-height:1;letter-spacing:-1px;font-variant-numeric:tabular-nums;color:var(--brand)}
.vb1-mg-num em{font-style:normal;font-size:var(--fs-2xs);font-weight:600;color:var(--text3);margin-left:3px;letter-spacing:0}
.vb1-lbl{font-size:var(--fs-xs);font-weight:600;color:var(--text3);letter-spacing:.2px}

/* ── 合并卡：3 区块并排 ── */
.vb1-mg{display:grid;grid-template-columns:1fr 1fr 1.12fr;gap:12px;flex:1;align-items:stretch;min-width:0}
.vb1-mg-sec{display:flex;flex-direction:column;gap:7px;min-width:0;padding-right:12px;border-right:1px solid var(--line)}
.vb1-mg-sec:last-child{border-right:0;padding-right:0}

/* 区块1：圆环（中心即 28px 主 KPI） */
.vb1-donut-wrap{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
.vb1-donut{position:relative;width:84px;height:84px;flex-shrink:0}
.vb1-donut svg{transform:rotate(-90deg);display:block;width:100%;height:100%}
.vb1-donut-c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;pointer-events:none}
.vb1-donut-c b{font-size:var(--fs-2xl);font-weight:750;line-height:1;letter-spacing:-1px;font-variant-numeric:tabular-nums;color:var(--text)}
.vb1-donut-c span{font-size:var(--fs-2xs);color:var(--text3);font-weight:600}
.vb1-dlegend{display:flex;flex-direction:column;gap:7px;min-width:0}
.vb1-lg{display:flex;align-items:center;gap:6px;font-size:var(--fs-xs);color:var(--text3);font-weight:600;white-space:nowrap}
.vb1-lg .sw{width:6px;height:6px;border-radius:2px;flex-shrink:0}
.vb1-lg.s .sw{background:var(--south)}
.vb1-lg.n .sw{background:var(--north)}
.vb1-lg b{font-size:var(--fs-md);font-weight:700;font-variant-numeric:tabular-nums;margin-left:2px;color:var(--south)}
.vb1-lg.n b{color:var(--north)}

/* 区块2：门店数（28px 主 KPI + 南/北比例条） */
.vb1-stack{display:flex;flex-direction:column;gap:7px;justify-content:center;flex:1;min-width:0}
.vb1-sbar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--line2);gap:2px}
.vb1-sbar i{display:block;height:100%}
.vb1-sbar .s{background:var(--south)}
.vb1-sbar .n{background:var(--north)}
.vb1-rlg{display:flex;align-items:center;gap:12px;font-size:var(--fs-xs);color:var(--text3);font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
.vb1-rlg span{display:inline-flex;align-items:center;gap:4px}
.vb1-rlg i{width:6px;height:6px;border-radius:2px;flex-shrink:0}
.vb1-rlg b{font-size:var(--fs-md);font-weight:700;margin-left:2px}
.vb1-rlg .s i{background:var(--south)}
.vb1-rlg .s b{color:var(--south)}
.vb1-rlg .n i{background:var(--north)}
.vb1-rlg .n b{color:var(--north)}

/* 区块3：签约类型（名称不裁切，数值 14px） */
.vb1-types{display:flex;flex-direction:column;gap:9px;justify-content:center;flex:1;min-width:0}
.vb1-type{display:flex;flex-direction:column;gap:4px;min-width:0}
.vb1-type-nm{font-size:var(--fs-xs);font-weight:600;color:var(--text2);line-height:1.35;display:flex;align-items:center;gap:6px}
.vb1-type-nm .d{width:6px;height:6px;border-radius:2px;flex-shrink:0}
.vb1-type-v{font-size:var(--fs-md);font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;line-height:1.2;white-space:nowrap}
.vb1-type-v em{font-style:normal;font-size:var(--fs-2xs);font-weight:600;color:var(--text3);margin-left:2px}
.vb1-type-v .st{color:var(--text3);font-size:var(--fs-xs);font-weight:600;margin-left:6px}
.vb1-type-bar{height:5px;border-radius:3px;background:var(--line2);overflow:hidden}
.vb1-type-bar i{display:block;height:100%;border-radius:3px;transition:width .5s cubic-bezier(.4,0,.2,1)}
@media(max-width:1500px){.vb1-mg{grid-template-columns:1fr 1fr;gap:10px}
  .vb1-mg-sec{padding-right:0;border-right:0}
  .vb1-mg-sec:not(:first-child){padding-top:8px;border-top:1px solid var(--line)}}
@media(max-width:1200px){.vb1-mg{grid-template-columns:1fr;gap:8px}
  .vb1-mg-sec{padding-top:8px;border-top:1px solid var(--line)}
  .vb1-mg-sec:first-child{padding-top:0;border-top:0}}

/* ── 任务完成进度：半圆（中心 22px 次 KPI） ── */
.vb1-semi-wrap{display:flex;justify-content:center;align-items:flex-end;padding-top:2px}
.vb1-semi{position:relative;width:150px;height:79px;flex-shrink:0}
.vb1-semi svg{display:block;width:100%;height:100%;overflow:visible}
.vb1-semi-c{position:absolute;left:0;right:0;bottom:0;text-align:center;pointer-events:none}
.vb1-semi-c b{font-size:var(--fs-xl);font-weight:750;letter-spacing:-.8px;line-height:1;font-variant-numeric:tabular-nums;display:block;color:var(--text)}
.vb1-semi-c b em{font-style:normal;font-size:var(--fs-2xs);font-weight:600;color:var(--text3);margin-left:1px;letter-spacing:0}
.vb1-semi-c span{font-size:var(--fs-2xs);color:var(--text3);font-weight:600;margin-top:2px;display:block}
.vb1-task-nums{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.vb1-tn{display:flex;flex-direction:column;align-items:center;gap:2px;padding:5px 4px;border-radius:var(--radius-sm);background:var(--panel2)}
.vb1-tn .k{font-size:var(--fs-2xs);color:var(--text3);font-weight:600;white-space:nowrap}
.vb1-tn b{font-size:var(--fs-md);font-weight:700;font-variant-numeric:tabular-nums;color:var(--text);line-height:1.15}
/* V9.2：深色模式下「不计入任务」整块像素反差仅 2.49，标签与数值都提亮到 text2 */.vb1-tn.muted,.vb1-tn.muted .k,.vb1-tn.muted b{color:var(--text2)}
.vb1-prog{display:flex;flex-direction:column;gap:8px}
.vb1-pg-top{display:flex;align-items:baseline;justify-content:space-between;gap:6px;margin-bottom:5px}
.vb1-pg-l{font-size:var(--fs-xs);font-weight:600;color:var(--text2);display:flex;align-items:center;gap:5px;white-space:nowrap}
.vb1-pg-l .d{width:6px;height:6px;border-radius:2px;background:var(--south);flex-shrink:0}
.vb1-pg-l.g2 .d{background:var(--north)}
.vb1-pg-v{font-size:var(--fs-xs);font-weight:600;color:var(--text3);font-variant-numeric:tabular-nums;white-space:nowrap}
.vb1-pg-v b{font-size:var(--fs-md);font-weight:700;color:var(--text);margin-right:1px}
.vb1-pg-v .sep{color:var(--text3);margin:0 1px}
.vb1-pg-v em{font-style:normal;font-size:var(--fs-2xs);font-weight:700;color:var(--south);margin-left:5px;padding-left:6px;border-left:1px solid var(--line)}
.vb1-pg-v em.g2{color:var(--north)}
.vb1-pg-track{height:6px;border-radius:3px;background:var(--line2);overflow:hidden}
.vb1-pg-fill{height:100%;border-radius:3px;min-width:3px;background:var(--south);transition:width .7s cubic-bezier(.4,0,.2,1)}
.vb1-pg-fill.g2{background:var(--north)}

/* ── 进行中：17px 总数 + 细线分隔表格 ── */
.vb1-ing-hero{display:flex;align-items:baseline;gap:7px}
.vb1-ing-hero .v{font-size:var(--fs-lg);font-weight:750;line-height:1;font-variant-numeric:tabular-nums;color:var(--text)}
.vb1-ing-hero .u{font-size:var(--fs-2xs);font-weight:600;color:var(--text3)}
.vb1-ing-hero .rg{margin-left:auto;font-size:var(--fs-xs);font-weight:600;color:var(--text3);white-space:nowrap;font-variant-numeric:tabular-nums}
.vb1-ing-hero .rg i{display:inline-block;width:6px;height:6px;border-radius:2px;margin-right:4px;vertical-align:middle}
.vb1-ing-hero .rg b{font-weight:700;font-size:var(--fs-md);margin-left:2px}
.vb1-ing-hero .rg .s b{color:var(--south)}
.vb1-ing-hero .rg .n b{color:var(--north)}
.vb1-ing-hero .rg .s i{background:var(--south)}
.vb1-ing-hero .rg .n i{background:var(--north);margin-left:10px}

.vb1-tb{display:flex;flex-direction:column;flex:1;min-width:0}
.vb1-tb-head,.vb1-tb-row{display:grid;align-items:center;gap:8px;min-width:0}
.vb1-tb-head{padding:0 8px 5px;font-size:var(--fs-2xs);font-weight:700;color:var(--text3);letter-spacing:.2px;border-bottom:1px solid var(--line)}
.vb1-tb-head span:not(:first-child){text-align:right}
.vb1-tb-head .south{color:var(--south)}
.vb1-tb-head .north{color:var(--north)}
.vb1-tb-row{padding:7px 8px;transition:background .15s ease;min-width:0}
/* 行分隔只用「斑马纹」一种手法：极淡交替底色，不再叠加描边 */
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
.vb1-ing .vb1-tb-head,.vb1-ing .vb1-tb-row{grid-template-columns:1fr 50px 44px 44px}
.vb1-ing{display:flex;flex-direction:column;flex:1;min-width:0}

/* ── 流程结束：4 组指标 × 汇总(22px)/南区/北区 ── */
.vb1-fs .vb1-tb-head,.vb1-fs .vb1-tb-row{grid-template-columns:1fr 58px 48px 48px}
.vb1-fs .vb1-tb-n{font-size:var(--fs-xl);font-weight:750;letter-spacing:-.6px}
.vb1-fs .vb1-tb-n.ok{color:var(--green)}
.vb1-fs .vb1-tb-n.no{color:var(--danger)}
.vb1-fs .vb1-tb-row{padding:6px 8px}
.vb1-fs{display:flex;flex-direction:column;flex:1;min-width:0}

.vb1-empty{padding:10px 0}
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

/** 卡片外壳：8px 圆角小方点 + 13px 标题 + 12px 副值 */
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

/** 圆环：中心是 28px 主 KPI（客户总数），右侧是南/北图例 */
function Donut({ south, north, total, label }: { south: number; north: number; total: number; label: string }) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const t = total > 0 ? total : 1;
  const sLen = Math.max(0, (south / t) * C);
  const nLen = Math.max(0, (north / t) * C);
  return (
    <div className="vb1-donut-wrap">
      <div className="vb1-donut">
        <svg viewBox="0 0 132 132" aria-hidden="true">
          <circle cx="66" cy="66" r={R} fill="none" stroke="var(--line2)" strokeWidth="13" />
          <circle
            cx="66" cy="66" r={R} fill="none" stroke="var(--south)" strokeWidth="13"
            strokeLinecap="round"
            strokeDasharray={`${sLen} ${C - sLen}`}
            strokeDashoffset="0"
          />
          <circle
            cx="66" cy="66" r={R} fill="none" stroke="var(--north)" strokeWidth="13"
            strokeLinecap="round"
            strokeDasharray={`${nLen} ${C - nLen}`}
            strokeDashoffset={-sLen}
          />
        </svg>
        <div className="vb1-donut-c">
          <b>{fmtNum(total)}</b>
          <span>{label}</span>
        </div>
      </div>
      <div className="vb1-dlegend">
        <div className="vb1-lg s"><span className="sw" />南区<b>{fmtNum(south)}</b></div>
        <div className="vb1-lg n"><span className="sw" />北区<b>{fmtNum(north)}</b></div>
      </div>
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

  const hasInProgress = r1.inProgress.total > 0;

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

  /** 客户 / 门店 的南区分占比（用于比例条） */
  const cliTotal = r1.totalClients || 0;
  const cliSouthPct = cliTotal > 0 ? (r1.totalClientsByRegion.south / cliTotal) * 100 : 0;
  const stTotal = r1.totalStores || 0;
  const stSouthPct = stTotal > 0 ? (r1.storesByRegion.south / stTotal) * 100 : 0;

  return (
    <>
      <style>{CSS}</style>

      <div className="vb1-grid">
        {/* ══ 主卡：签约概览（客户总数 + 门店总数 + 签约类型 三合一） ══ */}
        <Shell title="签约概览" hint="客户 / 门店 / 类型" hero>
          <div className="vb1-mg">
            {/* 区块1：签约客户（圆环中心 = 28px 主 KPI） */}
            <div className="vb1-mg-sec">
              <div className="vb1-lbl">签约客户</div>
              <Donut
                south={r1.totalClientsByRegion.south}
                north={r1.totalClientsByRegion.north}
                total={r1.totalClients}
                label="家客户"
              />
            </div>

            {/* 区块2：门店总数（28px 主 KPI + 南/北比例条） */}
            <div className="vb1-mg-sec">
              <div className="vb1-lbl">门店总数</div>
              <div className="vb1-stack">
                <div className="vb1-mg-num">{fmtNum(r1.totalStores)}<em>家</em></div>
                <div className="vb1-sbar">
                  <i className="s" style={{ width: `${stSouthPct}%` }} />
                  <i className="n" style={{ width: `${100 - stSouthPct}%` }} />
                </div>
                <div className="vb1-rlg">
                  <span className="s"><i />南<b>{fmtNum(r1.storesByRegion.south)}</b></span>
                  <span className="n"><i />北<b>{fmtNum(r1.storesByRegion.north)}</b></span>
                </div>
              </div>
            </div>

            {/* 区块3：签约类型（名称允许换行，不裁切） */}
            <div className="vb1-mg-sec">
              <div className="vb1-lbl">签约类型</div>
              {r1.signTypes.length === 0 ? (
                <div className="vb1-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无" /></div>
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

        {/* ══ 任务完成进度（半圆中心 = 22px 次 KPI） ══ */}
        <Shell
          title="任务完成进度"
          dot="var(--warn)"
          hint={<><b>{fmtNum(r1.progress.achieved)}</b>/{fmtNum(r1.progress.target)}</>}
        >
          <div className="vb1-semi-wrap">
            <Semi rate={r1.progress.rate} />
          </div>
          <div className="vb1-task-nums">
            <div className="vb1-tn">
              <span className="k">连锁数</span>
              <b>{fmtNum(r1.progress.chains ?? r1.progress.achieved)}</b>
            </div>
            <div className="vb1-tn">
              <span className="k">目标数</span>
              <b>{fmtNum(r1.progress.target)}</b>
            </div>
            {(r1.progress.excluded ?? 0) > 0 && (
              <div className="vb1-tn muted" title="连锁类型为 50-，不计入任务">
                <span className="k">未计入</span>
                <b>{fmtNum(r1.progress.excluded)}</b>
              </div>
            )}
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

        {/* ══ 进行中（17px 总数 + 5 岗位细线表格） ══ */}
        <Shell title="进行中" dot="var(--pink)" hint="5 个岗位">
          {!hasInProgress ? (
            <div className="vb1-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无进行中" /></div>
          ) : (
            <>
              <div className="vb1-ing-hero">
                <span className="v">{fmtNum(r1.inProgress.total)}</span>
                <span className="u">家进行中</span>
                <span className="rg">
                  <span className="s"><i />南<b>{fmtNum(ingSouth)}</b></span>
                  <span className="n"><i />北<b>{fmtNum(ingNorth)}</b></span>
                </span>
              </div>
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
            </>
          )}
        </Shell>

        {/* ══ 流程结束（汇总列 22px 次 KPI） ══ */}
        <Shell title="流程结束" dot="var(--green)" hint="已完成">
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
