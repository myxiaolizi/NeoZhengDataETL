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
.vb1-grid{display:grid;gap:14px;grid-template-columns:repeat(6,minmax(0,1fr));grid-auto-rows:1fr}
@media(max-width:1520px){.vb1-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:860px){.vb1-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:520px){.vb1-grid{grid-template-columns:1fr}}

.vb1-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;min-width:0}
.vb1-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}
.vb1-h{flex-shrink:0;padding:12px 15px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:8px;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb1-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb1-dot{width:6px;height:6px;border-radius:2px;background:var(--brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 16%,transparent);flex-shrink:0}
.vb1-hint{font-size:11px;color:var(--text3);font-weight:550;white-space:nowrap;flex-shrink:0}
.vb1-b{padding:14px 15px;flex:1;display:flex;flex-direction:column;justify-content:center;min-height:128px;min-width:0}

/* 圆环 + 图例 */
.vb1-donut-wrap{display:flex;align-items:center;justify-content:center;gap:13px;min-width:0}
.vb1-donut{position:relative;width:102px;height:102px;flex-shrink:0}
.vb1-donut svg{transform:rotate(-90deg);display:block;width:100%;height:100%}
.vb1-donut-c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none}
.vb1-donut-c b{font-size:22px;font-weight:750;letter-spacing:-.6px;line-height:1;font-variant-numeric:tabular-nums;color:var(--text)}
.vb1-donut-c span{font-size:9.5px;color:var(--text3);margin-top:3px;font-weight:600}
.vb1-legend{display:flex;flex-direction:column;gap:9px;min-width:0}
.vb1-lg{display:flex;align-items:center;gap:7px;min-width:0}
.vb1-lg .sw{width:10px;height:10px;border-radius:3px;flex-shrink:0}
.vb1-lg .sw.s{background:var(--brand)}
.vb1-lg .sw.n{background:var(--green)}
.vb1-lg-t{font-size:10.5px;color:var(--text3);font-weight:600;white-space:nowrap}
.vb1-lg-v{font-size:14px;font-weight:750;font-variant-numeric:tabular-nums;line-height:1.15;color:var(--text)}
.vb1-lg-v em{font-style:normal;font-size:9.5px;font-weight:600;color:var(--text3);margin-left:2px}

/* 大数字 + 拆分 */
.vb1-bignum{text-align:center;padding:1px 0}
.vb1-bignum b{font-size:34px;font-weight:750;letter-spacing:-1.4px;line-height:1;font-variant-numeric:tabular-nums;display:block;color:var(--cyan)}
.vb1-bignum span{font-size:10.5px;color:var(--text3);font-weight:600;margin-top:5px;display:block;letter-spacing:.2px}
.vb1-split{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:11px}
.vb1-sp{border-radius:var(--radius-sm);padding:7px 5px;text-align:center;background:var(--panel2);border:1px solid var(--line);transition:all .18s ease;min-width:0}
.vb1-sp.south{border-color:color-mix(in srgb,var(--brand) 24%,transparent);background:linear-gradient(180deg,color-mix(in srgb,var(--brand) 8%,transparent),color-mix(in srgb,var(--brand) 4%,transparent))}
.vb1-sp.north{border-color:color-mix(in srgb,var(--green) 24%,transparent);background:linear-gradient(180deg,color-mix(in srgb,var(--green) 8%,transparent),color-mix(in srgb,var(--green) 4%,transparent))}
.vb1-sp-l{font-size:10px;font-weight:650;display:flex;align-items:center;justify-content:center;gap:4px;margin-bottom:2px;white-space:nowrap}
.vb1-sp.south .vb1-sp-l{color:var(--brand)}
.vb1-sp.north .vb1-sp-l{color:var(--green)}
.vb1-sp-l .d{width:5px;height:5px;border-radius:50%;background:currentColor;flex-shrink:0}
.vb1-sp-v{font-size:16px;font-weight:750;font-variant-numeric:tabular-nums;line-height:1.15;color:var(--text)}
.vb1-sp-v em{font-style:normal;font-size:9.5px;font-weight:600;color:var(--text3);margin-left:1px}

/* 半圆进度 */
.vb1-semi-wrap{display:flex;flex-direction:column;align-items:center;margin-bottom:8px}
.vb1-semi{position:relative;width:146px;height:76px;flex-shrink:0}
.vb1-semi svg{display:block;width:100%;height:100%;overflow:visible}
.vb1-semi-c{position:absolute;left:0;right:0;bottom:-1px;text-align:center;pointer-events:none}
.vb1-semi-c b{font-size:20px;font-weight:750;letter-spacing:-.6px;line-height:1;font-variant-numeric:tabular-nums;display:block;color:var(--text)}
.vb1-semi-c b em{font-style:normal;font-size:10.5px;font-weight:650;color:var(--text3);margin-left:1px}
.vb1-semi-c span{font-size:9px;color:var(--text3);font-weight:600;margin-top:1px;display:block}
.vb1-prog{display:flex;flex-direction:column;gap:7px}
.vb1-pg-top{display:flex;align-items:baseline;justify-content:space-between;gap:6px;margin-bottom:4px}
.vb1-pg-l{font-size:10.5px;font-weight:600;color:var(--text2);display:flex;align-items:center;gap:5px;white-space:nowrap}
.vb1-pg-l .d{width:6px;height:6px;border-radius:50%;background:var(--brand);flex-shrink:0}
.vb1-pg-l.g2 .d{background:var(--green)}
.vb1-pg-v{font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--text)}
.vb1-pg-track{height:8px;border-radius:4px;background:var(--line2);overflow:hidden;box-shadow:inset 0 1px 2px rgba(20,52,102,.05)}
.vb1-pg-fill{height:100%;border-radius:4px;min-width:3px;background:linear-gradient(90deg,var(--brand),var(--brand3));transition:width .7s cubic-bezier(.4,0,.2,1);box-shadow:0 1px 3px color-mix(in srgb,var(--brand) 30%,transparent)}
.vb1-pg-fill.g2{background:linear-gradient(90deg,var(--green),var(--green2,var(--green)));box-shadow:0 1px 3px color-mix(in srgb,var(--green) 30%,transparent)}

/* 类型行 .tl-row */
.vb1-tlist{display:flex;flex-direction:column;gap:7px}
.vb1-tl{padding:7px 9px;border-radius:10px;background:var(--panel2);border:1px solid var(--line);transition:all .15s;min-width:0}
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

/* 进行中 .ing-row */
.vb1-ing{display:flex;flex-direction:column;gap:5px}
.vb1-ing-row{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:var(--radius-sm);background:var(--panel2);border:1px solid var(--line);transition:all .18s cubic-bezier(.4,0,.2,1);min-width:0}
.vb1-ing-row.cursor{cursor:pointer}
.vb1-ing-row.cursor:hover{border-color:var(--brand3);background:var(--brandSoft);transform:translateX(2px)}
.vb1-ing-d{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.vb1-ing-t{font-size:11.5px;font-weight:600;flex:1;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.vb1-ing-v{font-size:14px;font-weight:750;font-variant-numeric:tabular-nums;flex-shrink:0;color:var(--text)}
.vb1-ing-v em{font-style:normal;font-size:9.5px;font-weight:600;color:var(--text3);margin-left:1px}

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
  title, dot, hint, children,
}: {
  title: string;
  dot?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="vb1-card">
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

  const ingRows = [
    { key: 'strategy', label: '策略处理中', color: 'var(--cyan)', blk: r1.inProgress.strategy },
    { key: 'implement', label: '实施处理中', color: 'var(--brand)', blk: r1.inProgress.implement },
    { key: 'service', label: '客服处理中', color: 'var(--purple)', blk: r1.inProgress.service },
    { key: 'solution', label: '解决方案处理中', color: 'var(--warn)', blk: r1.inProgress.solution },
    { key: 'sales', label: '销售处理中', color: 'var(--green)', blk: r1.inProgress.sales },
  ];

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

        {/* 卡3 任务完成进度（半圆 + 双进度条） */}
        <Shell title="任务完成进度" dot="var(--warn)" hint={`${fmtNum(r1.progress.achieved)} / ${fmtNum(r1.progress.target)}`}>
          <div className="vb1-semi-wrap">
            <Semi rate={r1.progress.rate} />
          </div>
          <div className="vb1-prog">
            <div>
              <div className="vb1-pg-top">
                <span className="vb1-pg-l"><span className="d" />南区任务</span>
                <span className="vb1-pg-v">{r1.progress.south.rate.toFixed(1)}%</span>
              </div>
              <div className="vb1-pg-track">
                <div className="vb1-pg-fill" style={{ width: `${Math.min(100, r1.progress.south.rate)}%` }} />
              </div>
            </div>
            <div>
              <div className="vb1-pg-top">
                <span className="vb1-pg-l g2"><span className="d" />北区任务</span>
                <span className="vb1-pg-v">{r1.progress.north.rate.toFixed(1)}%</span>
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

        {/* 卡5 进行中（.ing-row） */}
        <Shell title="进行中" dot="var(--pink)" hint={`${r1.inProgress.total} 家`}>
          {!hasInProgress ? (
            <div className="vb1-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无进行中" /></div>
          ) : (
            <div className="vb1-ing">
              {ingRows.map((it) => {
                const clickable = it.blk.groups.length > 0;
                return (
                  <div
                    key={it.key}
                    className={`vb1-ing-row${clickable ? ' cursor' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => { if (clickable) setModal({ title: it.label, groups: it.blk.groups }); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && clickable) setModal({ title: it.label, groups: it.blk.groups }); }}
                  >
                    <span className="vb1-ing-d" style={{ background: it.color }} />
                    <span className="vb1-ing-t">{it.label}</span>
                    <span className="vb1-ing-v" style={{ color: it.blk.total ? it.color : 'var(--text3)' }}>
                      {it.blk.total}<em>家</em>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Shell>

        {/* 卡6 流程状态 */}
        <Shell title="流程状态" dot="var(--green)" hint="已完成">
          <div className="vb1-ps-pair">
            <div className="vb1-ps-cell">
              <b>{fmtNum(r1.flowStatus.completedClients)}</b>
              <span>客户数</span>
            </div>
            <div className="vb1-ps-cell">
              <b>{fmtNum(r1.flowStatus.completedStores)}</b>
              <span>门店数</span>
            </div>
          </div>
          <div className="vb1-split tight">
            <div className="vb1-sp south">
              <div className="vb1-sp-l"><span className="d" />南区</div>
              <div className="vb1-sp-v">{fmtNum(r1.flowStatus.south)}<em>家</em></div>
            </div>
            <div className="vb1-sp north">
              <div className="vb1-sp-l"><span className="d" />北区</div>
              <div className="vb1-sp-v">{fmtNum(r1.flowStatus.north)}<em>家</em></div>
            </div>
          </div>
          <div className="vb1-ps-open">
            <span>已开通 <b className="ok">{fmtNum(r1.flowStatus.strategyOpened)}</b></span>
            <span>未开通 <b className="no">{fmtNum(r1.flowStatus.strategyNotOpened)}</b></span>
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
