/** 第 1 排：签约卡片区（6 张卡片）— V6.0 视觉升级
 *
 * 设计语言对齐参考站 pc4.html（契约 §2.2）：
 *   .card / .card-h(方点标题) / .card-b
 *   卡1 圆环  .donut + .donut-c + .legend
 *   卡2 大数字 .bignum + .split(.sp south/north)
 *   卡3 半圆  .semi + .prog(.pg-track/.pg-fill)
 *   卡4 类型  .tl-row(.tl-top/.tl-bar/.tl-reg)
 *   卡5 进行中 .ing-row
 *   卡6 流程状态 .ps-pair
 *
 * 颜色一律走 var(--token)，禁止自创色值；深浅色自动跟随。
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

/* ══════════════ 局部样式（仅本组件，vb1- 前缀避免与全局冲突） ══════════════ */
const CSS = `
/* V7.1 需求 C：1080P（1920）下 6 张卡 **1 排显示**；手机端 2 排 × 每排 3 个。 */
.vb1-grid{display:grid;gap:12px;grid-template-columns:repeat(6,minmax(0,1fr));grid-auto-rows:1fr;align-items:stretch}
@media(max-width:1366px){.vb1-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
/* 手机端：2 排 × 3 列（需求明确要求每排 3 个） */
@media(max-width:768px){.vb1-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}}
@media(max-width:400px){.vb1-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}}

.vb1-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;min-width:0}
.vb1-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}
.vb1-h{flex-shrink:0;padding:10px 12px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:6px;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb1-h h3{font-size:12.5px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:6px;margin:0;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb1-dot{width:6px;height:6px;border-radius:2px;background:var(--brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 16%,transparent);flex-shrink:0}
.vb1-hint{font-size:10.5px;color:var(--text3);font-weight:550;white-space:nowrap;flex-shrink:0}
.vb1-b{padding:10px 11px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;gap:8px;min-height:0;min-width:0}
/* V7.1 C3：内容撑满，避免 space-between 在高卡片里拉开大片空白 */
.vb1-b > *{flex:0 0 auto}
.vb1-b > .vb1-donut-wrap,.vb1-b > .vb1-bignum{flex:1 1 auto;display:flex;align-items:center}
.vb1-b > .vb1-split,.vb1-b > .vb1-prog,.vb1-b > .vb1-tlist,.vb1-b > .vb1-ing,.vb1-b > .vb1-fs{flex:1 1 auto}
.vb1-donut-wrap{justify-content:space-evenly}
.vb1-tlist,.vb1-ing,.vb1-fs{justify-content:space-evenly}

/* 圆环 + 图例 */
.vb1-donut-wrap{display:flex;align-items:center;justify-content:center;gap:9px;min-width:0}
.vb1-donut{position:relative;width:78px;height:78px;flex-shrink:0}
.vb1-donut svg{transform:rotate(-90deg);display:block;width:100%;height:100%}
.vb1-donut-c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none}
.vb1-donut-c b{font-size:19px;font-weight:750;letter-spacing:-.6px;line-height:1;font-variant-numeric:tabular-nums;color:var(--text)}
.vb1-donut-c span{font-size:9.5px;color:var(--text3);margin-top:3px;font-weight:600}
.vb1-legend{display:flex;flex-direction:column;gap:6px;min-width:0}
.vb1-lg{display:flex;align-items:center;gap:7px;min-width:0}
.vb1-lg .sw{width:10px;height:10px;border-radius:3px;flex-shrink:0}
.vb1-lg .sw.s{background:var(--brand)}
.vb1-lg .sw.n{background:var(--green)}
.vb1-lg-t{font-size:10.5px;color:var(--text3);font-weight:600;white-space:nowrap}
.vb1-lg-v{font-size:13px;font-weight:750;font-variant-numeric:tabular-nums;line-height:1.15;color:var(--text)}
.vb1-lg-v em{font-style:normal;font-size:9.5px;font-weight:600;color:var(--text3);margin-left:2px}

/* 大数字 + 拆分 */
.vb1-bignum{text-align:center;padding:1px 0}
.vb1-bignum b{font-size:28px;font-weight:750;letter-spacing:-1.4px;line-height:1;font-variant-numeric:tabular-nums;display:block;color:var(--cyan)}
.vb1-bignum span{font-size:10px;color:var(--text3);font-weight:600;margin-top:3px;display:block;letter-spacing:.2px}
.vb1-split{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:7px}
.vb1-sp{border-radius:var(--radius-sm);padding:5px 4px;text-align:center;background:var(--panel2);border:1px solid var(--line);transition:all .18s ease;min-width:0}
.vb1-sp.south{border-color:color-mix(in srgb,var(--brand) 24%,transparent);background:linear-gradient(180deg,color-mix(in srgb,var(--brand) 8%,transparent),color-mix(in srgb,var(--brand) 4%,transparent))}
.vb1-sp.north{border-color:color-mix(in srgb,var(--green) 24%,transparent);background:linear-gradient(180deg,color-mix(in srgb,var(--green) 8%,transparent),color-mix(in srgb,var(--green) 4%,transparent))}
.vb1-sp-l{font-size:10px;font-weight:650;display:flex;align-items:center;justify-content:center;gap:4px;margin-bottom:2px;white-space:nowrap}
.vb1-sp.south .vb1-sp-l{color:var(--brand)}
.vb1-sp.north .vb1-sp-l{color:var(--green)}
.vb1-sp-l .d{width:5px;height:5px;border-radius:50%;background:currentColor;flex-shrink:0}
.vb1-sp-v{font-size:14px;font-weight:750;font-variant-numeric:tabular-nums;line-height:1.15;color:var(--text)}
.vb1-sp-v em{font-style:normal;font-size:9.5px;font-weight:600;color:var(--text3);margin-left:1px}

/* 半圆进度 */
.vb1-semi-wrap{display:flex;flex-direction:column;align-items:center;margin-bottom:5px}
.vb1-semi{position:relative;width:124px;height:65px;flex-shrink:0}
.vb1-semi svg{display:block;width:100%;height:100%;overflow:visible}
.vb1-semi-c{position:absolute;left:0;right:0;bottom:-1px;text-align:center;pointer-events:none}
.vb1-semi-c b{font-size:17px;font-weight:750;letter-spacing:-.6px;line-height:1;font-variant-numeric:tabular-nums;display:block;color:var(--text)}
.vb1-semi-c b em{font-style:normal;font-size:10.5px;font-weight:650;color:var(--text3);margin-left:1px}
.vb1-semi-c span{font-size:9px;color:var(--text3);font-weight:600;margin-top:1px;display:block}
.vb1-prog{display:flex;flex-direction:column;gap:5px}
/* V7：任务卡内的连锁数/目标数三列 */
.vb1-task-nums{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin:4px 0 6px}
.vb1-task-nums .vb1-tn{display:flex;flex-direction:column;align-items:center;gap:0;padding:4px 3px;border-radius:8px;background:var(--panel2);border:1px solid var(--line)}
.vb1-task-nums .vb1-tn .k{font-size:10px;color:var(--text3);font-weight:600;white-space:nowrap}
.vb1-task-nums .vb1-tn b{font-size:13px;font-weight:750;font-variant-numeric:tabular-nums;color:var(--text);line-height:1.1}
.vb1-task-nums .vb1-tn.muted b{color:var(--text3)}
.vb1-pg-top{display:flex;align-items:baseline;justify-content:space-between;gap:6px;margin-bottom:4px}
.vb1-pg-l{font-size:10.5px;font-weight:600;color:var(--text2);display:flex;align-items:center;gap:5px;white-space:nowrap}
.vb1-pg-l .d{width:6px;height:6px;border-radius:50%;background:var(--brand);flex-shrink:0}
.vb1-pg-l.g2 .d{background:var(--green)}
.vb1-pg-v{font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--text)}
.vb1-pg-v em{font-style:normal;font-size:10px;font-weight:600;color:var(--text3);margin-left:4px}
.vb1-pg-track{height:6px;border-radius:4px;background:var(--line2);overflow:hidden;box-shadow:inset 0 1px 2px rgba(20,52,102,.05)}
.vb1-pg-fill{height:100%;border-radius:4px;min-width:3px;background:linear-gradient(90deg,var(--brand),var(--brand3));transition:width .7s cubic-bezier(.4,0,.2,1);box-shadow:0 1px 3px color-mix(in srgb,var(--brand) 30%,transparent)}
.vb1-pg-fill.g2{background:linear-gradient(90deg,var(--green),var(--green2,var(--green)));box-shadow:0 1px 3px color-mix(in srgb,var(--green) 30%,transparent)}

/* 类型行 .tl-row */
.vb1-tlist{display:flex;flex-direction:column;gap:5px}
.vb1-tl{padding:4px 7px;border-radius:10px;background:var(--panel2);border:1px solid var(--line);transition:all .15s;min-width:0}
.vb1-tl:hover{border-color:var(--brand3);background:var(--brandSoft)}
.vb1-tl-top{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:5px}
.vb1-tl-name{font-size:11.5px;font-weight:650;display:flex;align-items:center;gap:6px;color:var(--text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vb1-tl-name .d{width:8px;height:8px;border-radius:3px;flex-shrink:0}
.vb1-tl-nums{font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--text2);white-space:nowrap;flex-shrink:0}
.vb1-tl-nums em{font-style:normal;font-size:9.5px;font-weight:600;color:var(--text3);margin-left:2px}
.vb1-tl-bar{height:6px;border-radius:4px;background:var(--line2);overflow:hidden;margin-bottom:5px}
.vb1-tl-bar i{display:block;height:100%;border-radius:4px;transition:width .5s cubic-bezier(.4,0,.2,1)}
.vb1-tl-reg{display:flex;gap:10px;font-size:10px;font-weight:600;color:var(--text3);white-space:nowrap}
.vb1-tl-reg b{font-weight:700;font-variant-numeric:tabular-nums}
.vb1-tl-reg .s{color:var(--brand)}
.vb1-tl-reg .n{color:var(--green)}

/* 进行中 .ing-row —— V7：四列（岗位/合计/南区/北区） */
.vb1-ing{display:flex;flex-direction:column;gap:4px}
.vb1-ing-head{display:grid;grid-template-columns:1fr 46px 38px 38px;gap:5px;padding:0 8px 1px;font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.3px}
.vb1-ing-head .h-num{text-align:right}
.vb1-ing-head .south{color:var(--brand)}
.vb1-ing-head .north{color:var(--green)}
.vb1-ing-row{display:grid;grid-template-columns:1fr 46px 38px 38px;align-items:center;gap:5px;padding:5px 8px;border-radius:var(--radius-sm);background:var(--panel2);border:1px solid var(--line);transition:all .18s cubic-bezier(.4,0,.2,1);min-width:0}
.vb1-ing-row.cursor{cursor:pointer}
.vb1-ing-row.cursor:hover{border-color:var(--brand3);background:var(--brandSoft);transform:translateX(2px)}
.vb1-ing-d{display:none}
.vb1-ing-t{font-size:11.5px;font-weight:650;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;position:relative;padding-left:12px}
.vb1-ing-t::before{content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);width:7px;height:7px;border-radius:50%;background:var(--brand)}
.vb1-ing-row:nth-child(2) .vb1-ing-t::before{background:var(--cyan)}
.vb1-ing-row:nth-child(3) .vb1-ing-t::before{background:var(--brand)}
.vb1-ing-row:nth-child(4) .vb1-ing-t::before{background:var(--purple)}
.vb1-ing-row:nth-child(5) .vb1-ing-t::before{background:var(--warn)}
.vb1-ing-row:nth-child(6) .vb1-ing-t::before{background:var(--green)}
.vb1-ing-v{font-size:14px;font-weight:750;font-variant-numeric:tabular-nums;text-align:right;color:var(--text)}
.vb1-ing-v em{font-style:normal;font-size:9px;font-weight:600;color:var(--text3);margin-left:1px}
.vb1-ing-s{font-size:11.5px;font-weight:650;font-variant-numeric:tabular-nums;text-align:right}
.vb1-ing-s.south{color:var(--brand)}
.vb1-ing-s.north{color:var(--green)}
.vb1-ing-foot{display:flex;align-items:center;gap:5px;font-size:10.5px;color:var(--text3);padding:3px 9px 0;flex-wrap:wrap}
.vb1-ing-foot b{font-size:11.5px;font-variant-numeric:tabular-nums}
.vb1-ing-foot .sep{opacity:.5}
.vb1-ing-foot .ok-tag{font-size:9.5px;padding:0 5px;border-radius:5px;background:color-mix(in srgb,var(--green) 16%,transparent);color:var(--green);font-weight:700}

/* 流程结束 —— V7：4 组指标 × 汇总/南区/北区 */.vb1-fs{display:flex;flex-direction:column;gap:3px}
.vb1-fs-head{display:grid;grid-template-columns:1fr 46px 38px 38px;gap:5px;padding:0 8px 1px;font-size:10px;font-weight:700;color:var(--text3)}
.vb1-fs-head span:not(:first-child){text-align:right}
.vb1-fs-head .south{color:var(--brand)}
.vb1-fs-head .north{color:var(--green)}
.vb1-fs-row{display:grid;grid-template-columns:1fr 46px 38px 38px;align-items:center;gap:5px;padding:4px 8px;border-radius:8px;background:var(--panel2);border:1px solid var(--line)}
.vb1-fs-row .k{font-size:11.5px;font-weight:600;color:var(--text2);white-space:nowrap}
.vb1-fs-row b{font-size:15px;font-weight:750;text-align:right;font-variant-numeric:tabular-nums;color:var(--text)}
.vb1-fs-row b.ok{color:var(--green)}
.vb1-fs-row b.no{color:var(--danger)}
.vb1-fs-row span.south,.vb1-fs-row span.north{font-size:11.5px;font-weight:650;text-align:right;font-variant-numeric:tabular-nums}
.vb1-fs-row span.south{color:var(--brand)}
.vb1-fs-row span.north{color:var(--green)}

/* 流程状态 */
.vb1-ps-pair{display:grid;grid-template-columns:1fr 1fr;gap:6px;text-align:center}
.vb1-ps-cell b{font-size:25px;font-weight:750;letter-spacing:-.9px;line-height:1.05;font-variant-numeric:tabular-nums;display:block;color:var(--text)}
.vb1-ps-cell span{font-size:10px;color:var(--text3);font-weight:600;margin-top:2px;display:block}
.vb1-split.tight{margin-top:9px;gap:7px}
.vb1-split.tight .vb1-sp{padding:5px 4px}
.vb1-split.tight .vb1-sp-v{font-size:14px}
.vb1-ps-open{display:flex;justify-content:center;gap:9px;font-size:10px;color:var(--text3);margin-top:7px;white-space:nowrap}
.vb1-ps-open b{font-weight:750;font-variant-numeric:tabular-nums}
.vb1-ps-open .ok{color:var(--green)}
.vb1-ps-open .no{color:var(--danger)}
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

/** 卡片外壳：标题栏带 6px 方点 */
function Shell({
  title, dot, hint, children, className,
}: {
  title: string;
  dot?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`vb1-card${className ? ' ' + className : ''}`}>
      <div className="vb1-h">
        <h3>
          <span className="vb1-dot" style={dot ? { background: dot, boxShadow: `0 0 0 3px color-mix(in srgb, ${dot} 16%, transparent)` } : undefined} />
          {title}
        </h3>
        {hint != null && <span className="vb1-hint">{hint}</span>}
      </div>
      <div className="vb1-b">{children}</div>
    </div>
  );
}

/** 圆环（SVG，参照 pc4 .donut） */
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
          <circle cx="66" cy="66" r={R} fill="none" stroke="var(--line2)" strokeWidth="15" />
          <circle
            cx="66" cy="66" r={R} fill="none" stroke="var(--brand)" strokeWidth="15"
            strokeLinecap="round"
            strokeDasharray={`${sLen} ${C - sLen}`}
            strokeDashoffset="0"
          />
          <circle
            cx="66" cy="66" r={R} fill="none" stroke="var(--green)" strokeWidth="15"
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
      <div className="vb1-legend">
        <div className="vb1-lg">
          <span className="sw s" />
          <div>
            <div className="vb1-lg-t">南区</div>
            <div className="vb1-lg-v">{fmtNum(south)}<em>家</em></div>
          </div>
        </div>
        <div className="vb1-lg">
          <span className="sw n" />
          <div>
            <div className="vb1-lg-t">北区</div>
            <div className="vb1-lg-v">{fmtNum(north)}<em>家</em></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 半圆进度（SVG 弧长 = PI*74 = 232.48，参照 pc4 .semi） */
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
        <path d="M 18 88 A 74 74 0 0 1 166 88" fill="none" stroke="var(--line2)" strokeWidth="13" strokeLinecap="round" />
        <path
          d="M 18 88 A 74 74 0 0 1 166 88" fill="none" stroke="url(#vb1-semi-grad)"
          strokeWidth="13" strokeLinecap="round"
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

  /** 卡4 最大客户数（进度条归一化） */
  const maxSignClients = useMemo(
    () => r1.signTypes.reduce((m, t) => Math.max(m, t.clients), 0) || 1,
    [r1.signTypes],
  );

  const hasInProgress = r1.inProgress.total > 0;

  /**
   * V7 进行中岗位（互斥口径，后端已保证五项合计 === total）
   *  - 岗位名去掉「处理中」三字
   *  - 每项都带 汇总 / 南区 / 北区
   */
  const ingRows = [
    { key: 'strategy', label: '策略', color: 'var(--cyan)', blk: r1.inProgress.strategy },
    { key: 'implement', label: '实施', color: 'var(--brand)', blk: r1.inProgress.implement },
    { key: 'service', label: '客服', color: 'var(--purple)', blk: r1.inProgress.service },
    { key: 'solution', label: '解决方案', color: 'var(--warn)', blk: r1.inProgress.solution },
    { key: 'sales', label: '销售', color: 'var(--green)', blk: r1.inProgress.sales },
  ];
  /** V7 五项合计（用于自检展示） */
  const ingSum = ingRows.reduce((s, x) => s + (x.blk?.total || 0), 0);

  return (
    <>
      <style>{CSS}</style>

      <div className="vb1-grid">
        {/* 卡1 签约客户总数（圆环） */}
        <Shell title="签约客户总数" hint="总客户数">
          <Donut
            south={r1.totalClientsByRegion.south}
            north={r1.totalClientsByRegion.north}
            total={r1.totalClients}
            label="家客户"
          />
        </Shell>

        {/* 卡2 门店总数（大数字 + 南北拆分） */}
        <Shell title="门店总数" dot="var(--cyan)" hint="家门店">
          <div className="vb1-bignum">
            <b>{fmtNum(r1.totalStores)}</b>
            <span>全部门店数</span>
          </div>
          <div className="vb1-split">
            <div className="vb1-sp south">
              <div className="vb1-sp-l"><span className="d" />南区门店</div>
              <div className="vb1-sp-v">{fmtNum(r1.storesByRegion.south)}<em>家</em></div>
            </div>
            <div className="vb1-sp north">
              <div className="vb1-sp-l"><span className="d" />北区门店</div>
              <div className="vb1-sp-v">{fmtNum(r1.storesByRegion.north)}<em>家</em></div>
            </div>
          </div>
        </Shell>

        {/* 卡3 任务完成进度（V7：半圆 + 连锁数/目标数 + 双进度条） */}
        <Shell title="任务完成进度" dot="var(--warn)" hint={`${fmtNum(r1.progress.achieved)} / ${fmtNum(r1.progress.target)}`}>
          <div className="vb1-semi-wrap">
            <Semi rate={r1.progress.rate} />
          </div>
          {/* V7：连锁数 + 目标数 */}
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
                  {fmtNum(r1.progress.south.achieved)}/{fmtNum(r1.progress.south.target)}
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
                  {fmtNum(r1.progress.north.achieved)}/{fmtNum(r1.progress.north.target)}
                  <em>{r1.progress.north.rate.toFixed(1)}%</em>
                </span>
              </div>
              <div className="vb1-pg-track">
                <div className="vb1-pg-fill g2" style={{ width: `${Math.min(100, r1.progress.north.rate)}%` }} />
              </div>
            </div>
          </div>
        </Shell>

        {/* 卡4 签约类型（.tl-row） */}
        <Shell title="签约类型" dot="var(--purple)" hint={r1.signTypes.length ? `${r1.signTypes.length} 类` : undefined}>
          {r1.signTypes.length === 0 ? (
            <div className="vb1-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /></div>
          ) : (
            <div className="vb1-tlist">
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
                    <div className="vb1-tl">
                      <div className="vb1-tl-top">
                        <span className="vb1-tl-name">
                          <span className="d" style={{ background: color }} />
                          {t.name}
                        </span>
                        <span className="vb1-tl-nums">
                          {t.clients} 户<em>· {fmtNum(t.stores)} 店</em>
                        </span>
                      </div>
                      <div className="vb1-tl-bar">
                        <i style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: color }} />
                      </div>
                      <div className="vb1-tl-reg">
                        <span className="s">南区 <b>{t.south}</b></span>
                        <span className="n">北区 <b>{t.north}</b></span>
                      </div>
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          )}
        </Shell>

        {/* 卡5 进行中（V7：占位更大 + 5 岗位含汇总/南/北） */}
        <Shell title="进行中" dot="var(--pink)" hint={`${r1.inProgress.total} 家`}>
          {!hasInProgress ? (
            <div className="vb1-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无进行中" /></div>
          ) : (
            <div className="vb1-ing">
              {/* 表头 */}
              <div className="vb1-ing-head">
                <span className="h-role">岗位</span>
                <span className="h-num">合计</span>
                <span className="h-num south">南区</span>
                <span className="h-num north">北区</span>
              </div>
              {ingRows.map((it) => {
                const clickable = (it.blk?.groups || []).length > 0;
                const total = it.blk?.total || 0;
                const south = it.blk?.south || 0;
                const north = it.blk?.north || 0;
                return (
                  <div
                    key={it.key}
                    className={`vb1-ing-row${clickable ? ' cursor' : ''}`}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : -1}
                    onClick={() => { if (clickable) setModal({ title: it.label, groups: it.blk.groups }); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && clickable) setModal({ title: it.label, groups: it.blk.groups }); }}
                  >
                    <span className="vb1-ing-d" style={{ background: it.color }} />
                    <span className="vb1-ing-t">{it.label}</span>
                    <span className="vb1-ing-v" style={{ color: total ? it.color : 'var(--text3)' }}>
                      {total}<em>家</em>
                    </span>
                    <span className="vb1-ing-s south">{south}</span>
                    <span className="vb1-ing-s north">{north}</span>
                  </div>
                );
              })}
              {/* 自检行：五项合计 = 进行中总数 */}
              <div className="vb1-ing-foot">
                五项合计 <b style={{ color: ingSum === r1.inProgress.total ? 'var(--green)' : 'var(--danger)' }}>{ingSum}</b>
                <span className="sep">·</span>
                进行中总数 <b>{r1.inProgress.total}</b>
                {ingSum === r1.inProgress.total && <span className="ok-tag">一致</span>}
              </div>
            </div>
          )}
        </Shell>

        {/* 卡6 流程结束（V7：4 组指标 × 汇总/南/北） */}
        <Shell title="流程结束" dot="var(--green)" hint="已完成">
          <div className="vb1-fs">
            <div className="vb1-fs-head">
              <span>指标</span>
              <span>汇总</span>
              <span className="south">南区</span>
              <span className="north">北区</span>
            </div>
            <div className="vb1-fs-row">
              <span className="k">客户数</span>
              <b>{fmtNum(r1.flowStatus.completedClients)}</b>
              <span className="south">{fmtNum(r1.flowStatus.south)}</span>
              <span className="north">{fmtNum(r1.flowStatus.north)}</span>
            </div>
            <div className="vb1-fs-row">
              <span className="k">门店数</span>
              <b>{fmtNum(r1.flowStatus.completedStores)}</b>
              <span className="south">{fmtNum(r1.flowStatus.storesSouth ?? 0)}</span>
              <span className="north">{fmtNum(r1.flowStatus.storesNorth ?? 0)}</span>
            </div>
            <div className="vb1-fs-row">
              <span className="k">开通策略</span>
              <b className="ok">{fmtNum(r1.flowStatus.strategyOpened)}</b>
              <span className="south">{fmtNum(r1.flowStatus.openedSouth ?? 0)}</span>
              <span className="north">{fmtNum(r1.flowStatus.openedNorth ?? 0)}</span>
            </div>
            <div className="vb1-fs-row">
              <span className="k">未开策略</span>
              <b className="no">{fmtNum(r1.flowStatus.strategyNotOpened)}</b>
              <span className="south">{fmtNum(r1.flowStatus.notOpenedSouth ?? 0)}</span>
              <span className="north">{fmtNum(r1.flowStatus.notOpenedNorth ?? 0)}</span>
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
