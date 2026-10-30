/** 第 4 排右：流程处理（最近 5 个工作日）— V7.0
 *
 * 需求：
 *  - E3 标题「流程推进」→「流程处理」
 *  - E4 删除下方「有开通策略的客户数」3 个小卡
 *  - E5 标题栏上方增加区域筛选（全部/南区/北区）
 *  - E6 重新设计：改为「每日横向堆叠柱」，一眼看出**每天完成多少流程** + 节点构成
 *  - E7 新增「更多」按钮 → 弹窗表格（行=节点，列=日期，末列合计）
 *  - E8 日期统一 `MM月DD日`（后端 daysCn 优先，否则由 `10/26` 自行转换）
 *
 * 说明：后端目前只返回 { days, nodes, matrix }（无区域拆分、无 daysCn）。
 * 区域筛选已按多种可能的区域字段实现（byRegion.south/north.matrix、south/north、matrixSouth/matrixNorth），
 * 后端补齐后自动生效；未补齐时如实提示，不伪造数字。
 */
import React, { useMemo, useState } from 'react';
import { Empty, Modal } from 'antd';
import type { BoardData, FlowProgressData } from '@/api/crm-board';
import { fmtNum } from './theme';

export interface FlowProgressProps {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

type RegionKey = 'all' | 'south' | 'north';

/** 本地扩展：不代表 api 已声明这些字段，缺失时走兜底 */
type FpLoose = FlowProgressData & {
  daysCn?: string[];
  byRegion?: { south?: { matrix?: number[][] }; north?: { matrix?: number[][] } };
  south?: number[][] | { matrix?: number[][] };
  north?: number[][] | { matrix?: number[][] };
  matrixSouth?: number[][];
  matrixNorth?: number[][];
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** E8：`10/26` / `10-26` / `2026-10-26` → `10月26日`；已是中文格式原样返回 */
function dayCn(raw: unknown, idx?: number, daysCn?: unknown): string {
  if (Array.isArray(daysCn) && typeof idx === 'number' && typeof daysCn[idx] === 'string' && daysCn[idx]) {
    return String(daysCn[idx]);
  }
  const s = String(raw ?? '');
  const m = s.match(/(\d{1,2})\s*[/\-月]\s*(\d{1,2})/);
  if (m) return `${Number(m[1])}月${Number(m[2])}日`;
  return s;
}

/** 9 个流程节点配色（全部取自契约 §二 令牌色，按流程推进顺序：蓝 → 紫 → 青 → 绿） */
const NODE_COLORS: Record<string, string> = {
  销售签约: '#2563eb', // brand
  策略开通: '#8b5cf6', // purple
  实施对接: '#06b6d4', // cyan
  对接审核: '#60a5fa', // brand3
  客服处理: '#f59e0b', // warn
  客户培训: '#ec4899', // pink
  连锁使用: '#eab308', // yellow
  策略审核: '#94a3b8', // gray
  流程结束: '#10b981', // green
};
const PALETTE_FALLBACK = ['#2563eb', '#8b5cf6', '#06b6d4', '#60a5fa', '#f59e0b', '#ec4899', '#eab308', '#94a3b8', '#10b981'];
function nodeColor(name: string, i: number): string {
  return NODE_COLORS[name] || PALETTE_FALLBACK[i % PALETTE_FALLBACK.length];
}

/** 取指定区域的矩阵；后端未提供该区域数据时返回 null（不伪造） */
function regionMatrix(fp: FpLoose | undefined, region: RegionKey): number[][] | null {
  if (!fp) return null;
  const main = Array.isArray(fp.matrix) ? fp.matrix : [];
  if (region === 'all') return main;

  const bag = fp.byRegion?.[region];
  if (Array.isArray(bag?.matrix)) return bag.matrix;

  const direct = region === 'south' ? fp.south : fp.north;
  if (Array.isArray(direct)) return direct;
  if (Array.isArray((direct as { matrix?: number[][] } | undefined)?.matrix)) {
    return (direct as { matrix: number[][] }).matrix;
  }

  const alt = region === 'south' ? fp.matrixSouth : fp.matrixNorth;
  if (Array.isArray(alt)) return alt;
  return null;
}

/* ══════════════ 局部样式（vb8- 前缀） ══════════════ */
const CSS = `
.vb8-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;height:100%;min-width:0}
.vb8-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}

/* E5：区域筛选条（位于标题栏上方） */
.vb8-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--line2);background:color-mix(in srgb,var(--panel2) 55%,transparent);flex-shrink:0}
.vb8-top .lb{font-size:11px;color:var(--text3);font-weight:650;white-space:nowrap;margin-right:1px}
.vb8-seg{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:7px;cursor:pointer;user-select:none;border:1px solid var(--line);background:var(--panel);color:var(--text2);font-size:11px;font-weight:600;transition:all .15s;white-space:nowrap;font-family:inherit;line-height:1}
.vb8-seg:hover{border-color:var(--brand3);color:var(--brand)}
.vb8-seg.on{color:#fff;border-color:transparent;box-shadow:0 3px 9px color-mix(in srgb,var(--brand) 26%,transparent)}
.vb8-seg .sw{width:6px;height:6px;border-radius:2px;margin-right:4px;flex-shrink:0}
.vb8-seg.on .sw{background:#fff!important}
.vb8-more{margin-left:auto;display:inline-flex;align-items:center;gap:3px;height:22px;padding:0 9px;border-radius:7px;border:1px dashed var(--line);background:var(--panel);color:var(--brand);font-size:11px;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap;font-family:inherit;line-height:1}
.vb8-more:hover{background:var(--brandSoft);border-color:var(--brand3)}

.vb8-h{padding:12px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb8-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb8-dot{width:6px;height:6px;border-radius:2px;background:var(--green);box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 16%,transparent);flex-shrink:0}
.vb8-hint{font-size:11px;color:var(--text3);font-weight:550;white-space:nowrap}
.vb8-b{padding:12px 16px 14px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}

/* 节点图例 */
.vb8-legend{display:flex;align-items:center;gap:4px 9px;flex-wrap:wrap;margin-bottom:10px;min-width:0}
.vb8-lg{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;color:var(--text3);white-space:nowrap;line-height:1}
.vb8-lg .sw{width:8px;height:8px;border-radius:2px;flex-shrink:0}

/* E6：每日横向堆叠柱 */
.vb8-days{display:flex;flex-direction:column;gap:7px;min-width:0}
.vb8-day{display:grid;grid-template-columns:62px minmax(0,1fr) 40px;align-items:center;gap:8px;min-width:0}
.vb8-day-lb{font-size:11px;font-weight:600;color:var(--text2);white-space:nowrap;font-variant-numeric:tabular-nums}
.vb8-bar{display:flex;height:22px;border-radius:6px;overflow:hidden;background:var(--panel2);box-shadow:inset 0 0 0 1px var(--line2);min-width:0}
.vb8-bar i{display:block;height:100%;transition:width .5s cubic-bezier(.4,0,.2,1);min-width:2px}
.vb8-day-v{font-size:14px;font-weight:750;color:var(--text);text-align:right;font-variant-numeric:tabular-nums;line-height:1}
.vb8-day.empty .vb8-day-v{color:var(--text3);font-weight:600}

.vb8-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:11px;padding-top:10px;border-top:1px dashed var(--line);flex-wrap:wrap}
.vb8-foot .k{font-size:11px;color:var(--text3);font-weight:600;white-space:nowrap}
.vb8-foot .k b{font-size:15px;color:var(--text);font-weight:750;font-variant-numeric:tabular-nums;margin:0 2px}
.vb8-foot .k .s{color:var(--brand)}
.vb8-foot .k .n{color:var(--green)}

.vb8-note{margin-top:9px;padding:7px 10px;border-radius:9px;background:color-mix(in srgb,var(--warn) 10%,transparent);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent);color:var(--text2);font-size:11px;line-height:1.5}
.vb8-empty{padding:34px 0}

/* 弹窗表格 */
.vb8-tbl-wrap{width:100%;overflow:auto;max-height:62vh;border:1px solid var(--line);border-radius:10px}
.vb8-tbl{width:100%;border-collapse:separate;border-spacing:0;font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums}
.vb8-tbl thead th{position:sticky;top:0;z-index:3;background:var(--panel2);color:var(--text3);font-size:11px;font-weight:650;padding:8px 10px;text-align:right;border-bottom:1px solid var(--line);letter-spacing:.2px}
.vb8-tbl thead th.first{text-align:left;left:0;z-index:4}
.vb8-tbl thead th.tot{color:var(--brand)}
.vb8-tbl tbody th{position:sticky;left:0;z-index:2;background:var(--panel);text-align:left;font-size:12px;font-weight:600;color:var(--text);padding:8px 10px;border-bottom:1px solid var(--line2);border-right:1px solid var(--line2);white-space:nowrap}
.vb8-tbl tbody th .d{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;vertical-align:middle}
.vb8-tbl tbody td{text-align:right;padding:8px 10px;border-bottom:1px solid var(--line2);color:var(--text);font-weight:600}
.vb8-tbl tbody tr:nth-child(even) td{background:color-mix(in srgb,var(--panel2) 55%,transparent)}
.vb8-tbl tbody tr:nth-child(even) th{background:color-mix(in srgb,var(--panel2) 55%,var(--panel))}
.vb8-tbl tbody tr:hover td{background:var(--brandSoft)}
.vb8-tbl tbody tr:hover th{background:var(--brandSoft)}
.vb8-tbl tbody td.zero{color:var(--text3);font-weight:500}
.vb8-tbl tbody td.tot{color:var(--brand);font-weight:750}
.vb8-tbl tbody tr.sum th{color:var(--text2);font-size:11.5px;font-weight:700}
.vb8-tbl tbody tr.sum td{color:var(--brand);font-weight:750}
.vb8-tbl tbody tr.sum td.zero{color:var(--text3)}
`;

export default function FlowProgress({ data, loading, isMobile }: FlowProgressProps) {
  const fp = data?.row6?.flowProgress as FpLoose | undefined;
  const [region, setRegion] = useState<RegionKey>('all');
  const [moreOpen, setMoreOpen] = useState(false);

  const rawDays = Array.isArray(fp?.days) ? (fp?.days ?? []) : [];
  const nodes = Array.isArray(fp?.nodes) ? (fp?.nodes ?? []) : [];
  /** E8：统一 MM月DD日 */
  const days = useMemo(() => rawDays.map((d, i) => dayCn(d, i, fp?.daysCn)), [rawDays, fp?.daysCn]);

  /** 当前区域生效的矩阵；null = 后端尚未提供该区域数据 */
  const matrix = useMemo(() => regionMatrix(fp, region), [fp, region]);
  const regionMissing = region !== 'all' && matrix === null;

  const { grid, rowTotals, colTotals, grand } = useMemo(() => {
    const src = matrix ?? [];
    const rows: number[][] = nodes.map((_, ri) => {
      const line = Array.isArray(src[ri]) ? (src[ri] as unknown[]) : [];
      return days.map((__, ci) => num(line[ci]));
    });
    const rowT = rows.map((r) => r.reduce((a, b) => a + b, 0));
    const colT = days.map((__, ci) => rows.reduce((a, r) => a + num(r[ci]), 0));
    return {
      grid: rows,
      rowTotals: rowT,
      colTotals: colT,
      grand: colT.reduce((a, b) => a + b, 0),
    };
  }, [matrix, nodes, days]);

  const hasData = days.length > 0 && nodes.length > 0;
  const maxDay = colTotals.reduce((m, v) => Math.max(m, v), 0);
  const avgDay = colTotals.length ? grand / colTotals.length : 0;

  const regionOpts: { key: RegionKey; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'south', label: '南区' },
    { key: 'north', label: '北区' },
  ];
  const regionColor = (k: RegionKey) => (k === 'south' ? '#2563eb' : k === 'north' ? '#10b981' : 'var(--brand)');

  /** 5 日合计的南北拆分（仅在「全部」且有 strategyClients 时展示，作为口径参考） */
  const sc = data?.row6?.strategyClients;

  return (
    <>
      <style>{CSS}</style>
      <div className="vb8-card">
        {/* E5：区域筛选在标题栏上方 */}
        <div className="vb8-top">
          <span className="lb">区域</span>
          {regionOpts.map((o) => {
            const on = region === o.key;
            const bg = o.key === 'south'
              ? 'linear-gradient(135deg,#2563eb,#3b82f6)'
              : o.key === 'north'
                ? 'linear-gradient(135deg,#10b981,#34d399)'
                : 'linear-gradient(135deg,var(--brand),var(--brand2))';
            return (
              <button
                key={o.key}
                type="button"
                className={`vb8-seg${on ? ' on' : ''}`}
                style={on ? { background: bg } : undefined}
                aria-pressed={on}
                onClick={() => setRegion(o.key)}
              >
                {o.key !== 'all' && (
                  <span className="sw" style={{ background: on ? '#fff' : regionColor(o.key) }} />
                )}
                {o.label}
              </button>
            );
          })}
          {/* E7：更多 */}
          <button type="button" className="vb8-more" onClick={() => setMoreOpen(true)}>
            更多 ›
          </button>
        </div>

        <div className="vb8-h">
          <h3>
            <span className="vb8-dot" />
            流程处理
          </h3>
          <span className="vb8-hint">最近 5 个工作日 · 每日完成量</span>
        </div>

        <div className="vb8-b">
          {!hasData ? (
            <div className="vb8-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无流程处理数据" /></div>
          ) : regionMissing ? (
            <div className="vb8-empty" style={{ padding: '20px 0' }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<span style={{ fontSize: 12, color: 'var(--text2)' }}>该区域明细数据待后端提供</span>}
              />
            </div>
          ) : (
            <>
              {/* 节点图例 */}
              <div className="vb8-legend">
                {nodes.map((nd, i) => (
                  <span className="vb8-lg" key={nd} title={nd}>
                    <span className="sw" style={{ background: nodeColor(nd, i) }} />
                    {nd}
                  </span>
                ))}
              </div>

              {/* E6：每天一条横向堆叠柱，柱长=当日完成量，颜色=节点构成 */}
              <div className="vb8-days">
                {days.map((d, ci) => {
                  const total = colTotals[ci] || 0;
                  const segs = nodes
                    .map((nd, ri) => ({ nd, v: num(grid[ri]?.[ci]), i: ri }))
                    .filter((s) => s.v > 0);
                  const empty = total <= 0;
                  return (
                    <div className={`vb8-day${empty ? ' empty' : ''}`} key={`${d}-${ci}`}>
                      <span className="vb8-day-lb">{d}</span>
                      <div
                        className="vb8-bar"
                        title={
                          empty
                            ? `${d}：无流程完成`
                            : `${d} 合计 ${total} 家\n${segs.map((s) => `${s.nd} ${s.v}`).join(' · ')}`
                        }
                      >
                        {segs.map((s) => (
                          <i
                            key={s.nd}
                            style={{
                              /* 绝对刻度：柱长 ∝ 当日完成量，段的长度 ∝ 该节点数量 */
                              width: `${maxDay > 0 ? (s.v / maxDay) * 100 : 0}%`,
                              background: nodeColor(s.nd, s.i),
                            }}
                            title={`${s.nd}：${s.v} 家（占当日 ${((s.v / total) * 100).toFixed(0)}%）`}
                          />
                        ))}
                      </div>
                      <span className="vb8-day-v">{fmtNum(total)}</span>
                    </div>
                  );
                })}
              </div>

              {/* 汇总：5 日累计 / 日均 / 峰值 */}
              <div className="vb8-foot">
                <span className="k">5 日累计 <b>{fmtNum(grand)}</b> 家</span>
                <span className="k">日均 <b>{avgDay ? avgDay.toFixed(1) : '0'}</b> 家</span>
                <span className="k">单日最高 <b>{fmtNum(maxDay)}</b> 家</span>
              </div>

              {regionMissing && (
                <div className="vb8-note">
                  区域明细待后端返回（<code>row6.flowProgress.byRegion</code>）；当前先显示全部口径。
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* E7：「更多」弹窗 —— 行=节点，列=日期，末列合计 */}
      <Modal
        title={`流程处理明细 · ${region === 'all' ? '全部区域' : region === 'south' ? '南区' : '北区'}（最近 5 个工作日）`}
        open={moreOpen}
        onCancel={() => setMoreOpen(false)}
        footer={null}
        width={isMobile ? '96vw' : 760}
        styles={{ body: { paddingTop: 8 } }}
      >
        {!hasData || regionMissing ? (
          <Empty description={regionMissing ? '该区域明细数据待后端提供' : '暂无数据'} />
        ) : (
          <div className="vb8-tbl-wrap">
            <table className="vb8-tbl">
              <thead>
                <tr>
                  <th className="first">流程节点</th>
                  {days.map((d, ci) => <th key={`${d}-${ci}`}>{d}</th>)}
                  <th className="tot">合计</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((nd, ri) => (
                  <tr key={nd}>
                    <th>
                      <span className="d" style={{ background: nodeColor(nd, ri) }} />
                      {nd}
                    </th>
                    {days.map((d, ci) => {
                      const v = num(grid[ri]?.[ci]);
                      return (
                        <td key={`${nd}-${d}-${ci}`} className={v ? '' : 'zero'}>{v || 0}</td>
                      );
                    })}
                    <td className="tot">{fmtNum(rowTotals[ri] || 0)}</td>
                  </tr>
                ))}
                <tr className="sum">
                  <th>当日合计</th>
                  {colTotals.map((v, ci) => (
                    <td key={`sum-${ci}`} className={v ? '' : 'zero'}>{fmtNum(v || 0)}</td>
                  ))}
                  <td>{fmtNum(grand)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10, lineHeight: 1.6 }}>
          口径：单元格 = 该日期完成到该流程节点的客户数；「合计」列为该节点 5 日累计。
          {sc ? ` 全量有开通策略客户数 ${sc.total} 家（南 ${sc.south} / 北 ${sc.north}）。` : ''}
        </div>
      </Modal>
    </>
  );
}
