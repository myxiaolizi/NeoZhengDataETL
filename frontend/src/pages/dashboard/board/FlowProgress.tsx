/** 第 6 排右：流程推进（最近 5 个工作日）— V6.0 视觉升级
 *
 * 呈现（口径不变）：
 *  - 热力矩阵：行 = 9 个流程节点，列 = 最近 5 个工作日
 *    单元格背景 color-mix(in srgb, var(--brand) N%, transparent)，0 值 var(--panel2)
 *    表头 sticky 吸顶
 *  - 底部 3 个指标：有开通策略客户数（合计 / 南区 var(--brand) / 北区 var(--cyan)）
 */
import React, { useMemo } from 'react';
import { Empty } from 'antd';
import type { BoardData } from '@/api/crm-board';
import { fmtNum } from './theme';

export interface FlowProgressProps {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 热力强度：0~100（用于 color-mix 百分比） */
function heatPct(v: number, max: number): number {
  if (!v || v <= 0) return 0;
  const ratio = max > 0 ? v / max : 0;
  return Math.round(8 + Math.min(1, ratio) * 82); // 8% ~ 90%
}

/* ══════════════ 局部样式（vb8- 前缀） ══════════════ */
const CSS = `
.vb8-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;height:100%;min-width:0}
.vb8-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}
.vb8-h{padding:13px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb8-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb8-dot{width:6px;height:6px;border-radius:2px;background:var(--green);box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 16%,transparent);flex-shrink:0}
.vb8-hint{font-size:11px;color:var(--text3);font-weight:550;white-space:nowrap}
.vb8-b{padding:14px 16px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}

.vb8-scroll{width:100%;overflow:auto;max-height:296px;border-radius:10px;background:var(--panel);min-width:0}
.vb8-tbl{width:100%;border-collapse:separate;border-spacing:3px;font-variant-numeric:tabular-nums}
.vb8-tbl thead th{
  position:sticky;top:0;z-index:3;
  padding:5px 6px;font-size:11px;font-weight:650;color:var(--text3);
  background:var(--panel2);text-align:center;white-space:nowrap;
  border-radius:6px;
}
.vb8-tbl thead th.first{text-align:left;padding-left:8px}
.vb8-tbl thead th.tot{color:var(--brand)}
.vb8-tbl tbody th{
  padding:5px 8px;font-size:11.5px;font-weight:600;color:var(--text);text-align:left;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:86px;
  background:var(--panel2);border-radius:6px;position:sticky;left:0;z-index:2;
}
.vb8-cell{
  padding:6px 4px;text-align:center;font-size:11.5px;font-weight:700;
  border-radius:6px;transition:background .2s ease;min-width:34px;
}
.vb8-cell.zero{background:var(--panel2);color:var(--text3);font-weight:500}
.vb8-cell.tot{background:transparent;color:var(--brand);font-weight:750}
.vb8-tbl tbody tr.sum th,.vb8-tbl tbody tr.sum td{font-weight:750}
.vb8-tbl tbody tr.sum th{color:var(--text2);font-size:11px}
.vb8-tbl tbody tr.sum td.tot{color:var(--brand)}

.vb8-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)}
.vb8-stat{min-width:0;text-align:center;padding:6px 4px;border-radius:var(--radius-sm);background:var(--panel2);border:1px solid var(--line);transition:all .15s}
.vb8-stat:hover{border-color:var(--line2)}
.vb8-stat .t{font-size:10.5px;color:var(--text3);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;justify-content:center;gap:4px}
.vb8-stat .t .d{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.vb8-stat .v{font-size:17px;font-weight:750;font-variant-numeric:tabular-nums;line-height:1.2;margin-top:2px}
.vb8-empty{padding:36px 0}
`;

export default function FlowProgress({ data, loading, isMobile }: FlowProgressProps) {
  const fp = data?.row6?.flowProgress;
  const days = Array.isArray(fp?.days) ? (fp?.days ?? []) : [];
  const nodes = Array.isArray(fp?.nodes) ? (fp?.nodes ?? []) : [];
  const matrix = Array.isArray(fp?.matrix) ? (fp?.matrix ?? []) : [];
  const sc = data?.row6?.strategyClients;

  const { grid, max, rowTotals, colTotals } = useMemo(() => {
    const rows: number[][] = nodes.map((_, ri) => {
      const src = Array.isArray(matrix[ri]) ? (matrix[ri] as unknown[]) : [];
      return days.map((__, ci) => num(src[ci]));
    });
    let mx = 0;
    const rowT = rows.map((r) => r.reduce((a, b) => a + b, 0));
    const colT = days.map((__, ci) => rows.reduce((a, r) => a + num(r[ci]), 0));
    rows.forEach((r) => r.forEach((v) => { if (v > mx) mx = v; }));
    return { grid: rows, max: mx, rowTotals: rowT, colTotals: colT };
  }, [days, nodes, matrix]);

  // 只要有节点/日期就画矩阵（全 0 时就是一片浅灰，比 Empty 更如实）
  const hasData = days.length > 0 && nodes.length > 0;

  const stats = [
    { title: '有开通策略', value: sc?.total ?? 0, color: 'var(--text)', dot: 'var(--purple)' },
    { title: '南区', value: sc?.south ?? 0, color: 'var(--brand)', dot: 'var(--brand)' },
    { title: '北区', value: sc?.north ?? 0, color: 'var(--cyan)', dot: 'var(--cyan)' },
  ];

  return (
    <>
      <style>{CSS}</style>
      <div className="vb8-card">
        <div className="vb8-h">
          <h3>
            <span className="vb8-dot" />
            流程推进
          </h3>
          <span className="vb8-hint">最近 5 个工作日</span>
        </div>
        <div className="vb8-b">
          {!hasData ? (
            <div className="vb8-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无流程推进数据" /></div>
          ) : (
            <div className="vb8-scroll">
              <table className="vb8-tbl">
                <thead>
                  <tr>
                    <th className="first">节点</th>
                    {days.map((d) => <th key={d}>{d}</th>)}
                    <th className="tot">合计</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((node, ri) => (
                    <tr key={node}>
                      <th title={node}>{node}</th>
                      {days.map((d, ci) => {
                        const v = num(grid[ri]?.[ci]);
                        const pct = heatPct(v, max);
                        const deep = pct >= 52;
                        return (
                          <td
                            key={`${node}-${d}`}
                            className={`vb8-cell${v <= 0 ? ' zero' : ''}`}
                            style={v > 0
                              ? {
                                background: `color-mix(in srgb, var(--brand) ${pct}%, transparent)`,
                                color: deep ? '#fff' : 'var(--text)',
                              }
                              : undefined}
                            title={`${node} · ${d}：${v}`}
                          >
                            {v || 0}
                          </td>
                        );
                      })}
                      <td className="vb8-cell tot">{fmtNum(rowTotals[ri] || 0)}</td>
                    </tr>
                  ))}
                  <tr className="sum">
                    <th>当日合计</th>
                    {colTotals.map((v, ci) => (
                      <td key={`sum-${ci}`} className="vb8-cell tot">{fmtNum(v || 0)}</td>
                    ))}
                    <td className="vb8-cell tot">{fmtNum(colTotals.reduce((a, b) => a + b, 0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="vb8-stats">
            {stats.map((s) => (
              <div key={s.title} className="vb8-stat">
                <div className="t">
                  <span className="d" style={{ background: s.dot }} />
                  {s.title}
                </div>
                <div className="v" style={{ color: s.color }}>{fmtNum(num(s.value))}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
