/** 第 7 排：客户运行情况（5 组指标，每组含 合计 / 南区 / 北区）— V6.0 视觉升级
 *
 * 数据与口径不变：data.row7
 *  1) openedStrategy  2) runningStrategy  3) reachRate / couponRate
 *  4) conversion      5) people
 * 视觉对齐 pc4.html：每组一张小卡（内部 panel2 底 + line 描边），
 * 表头行 合计 / 南区 / 北区；南区 var(--brand)、北区 var(--cyan)；数字 tabular-nums。
 */
import React, { useMemo } from 'react';
import { Empty } from 'antd';
import type { BoardData, MetricPair, Row7Data } from '@/api/crm-board';
import { fmtMoney, fmtNum, fmtPct } from './theme';

export interface RunMetricsProps {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

type Fmt = 'num' | 'pct' | 'money';

interface Line {
  label: string;
  total: number;
  south: number;
  north: number;
  fmt: Fmt;
}

interface Group {
  key: string;
  title: string;
  hint?: string;
  lines: Line[];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pair(p?: Partial<MetricPair> | null): MetricPair {
  return { total: num(p?.total), south: num(p?.south), north: num(p?.north) };
}

function format(v: number, fmt: Fmt): string {
  if (fmt === 'pct') return fmtPct(v);
  if (fmt === 'money') return fmtMoney(v);
  return fmtNum(v);
}

/* ══════════════ 局部样式（vb9- 前缀） ══════════════ */
const CSS = `
.vb9-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;height:100%;min-width:0}
.vb9-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}
.vb9-h{padding:13px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb9-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb9-dot{width:6px;height:6px;border-radius:2px;background:var(--cyan);box-shadow:0 0 0 3px color-mix(in srgb,var(--cyan) 16%,transparent);flex-shrink:0}
.vb9-hint{font-size:11px;color:var(--text3);font-weight:550;white-space:nowrap}
.vb9-b{padding:14px 16px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}

.vb9-grid{display:grid;gap:12px;grid-template-columns:repeat(5,minmax(0,1fr))}
@media(max-width:1400px){.vb9-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:900px){.vb9-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:560px){.vb9-grid{grid-template-columns:1fr}}

.vb9-grp{background:var(--panel2);border:1px solid var(--line);border-radius:var(--radius-sm);padding:11px 12px;min-width:0;display:flex;flex-direction:column;transition:all .18s}
.vb9-grp:hover{border-color:var(--brand3);background:var(--brandSoft)}
.vb9-grp .gt{font-size:12.5px;font-weight:680;color:var(--text);line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb9-grp .gh{font-size:10px;color:var(--text3);font-weight:550;margin-top:1px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.vb9-rows{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr) minmax(0,.82fr) minmax(0,.82fr);column-gap:6px;margin-top:9px}
.vb9-th{font-size:10.5px;color:var(--text3);font-weight:600;padding:2px 0;text-align:right;white-space:nowrap}
.vb9-th.l{text-align:left}
.vb9-th.s{color:var(--brand)}
.vb9-th.n{color:var(--cyan)}
.vb9-lb{font-size:11.5px;color:var(--text2);padding:3px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb9-v{font-size:12.5px;font-weight:700;color:var(--text);padding:3px 0;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.vb9-v.t{font-size:13px;font-weight:750}
.vb9-v.s{color:var(--brand)}
.vb9-v.n{color:var(--cyan)}
.vb9-divider{grid-column:1/-1;height:1px;background:var(--line2);margin:2px 0}
.vb9-empty{padding:34px 0}
`;

export default function RunMetrics({ data, loading, isMobile }: RunMetricsProps) {
  const r7 = data?.row7 as Row7Data | undefined;

  const groups = useMemo<Group[]>(() => {
    if (!r7) return [];
    const openedChains = pair(r7.openedStrategy?.chains);
    const openedStrats = pair(r7.openedStrategy?.strategies);
    const runChains = pair(r7.runningStrategy?.chains);
    const runStrats = pair(r7.runningStrategy?.strategies);
    const reach = pair(r7.reachRate);
    const coupon = pair(r7.couponRate);
    const conv = pair(r7.conversion);
    const perCapita = pair(r7.conversion?.perCapita);
    const reached = pair(r7.people?.reached);
    const couponIssued = pair(r7.people?.couponIssued);

    const mk = (label: string, p: MetricPair, fmt: Fmt): Line => ({
      label, total: p.total, south: p.south, north: p.north, fmt,
    });

    return [
      {
        key: 'opened',
        title: '有开通策略',
        hint: '开通策略数 > 0 的连锁',
        lines: [mk('连锁数', openedChains, 'num'), mk('策略数', openedStrats, 'num')],
      },
      {
        key: 'running',
        title: '有运行策略',
        hint: '运行策略数 > 0 的连锁',
        lines: [mk('连锁数', runChains, 'num'), mk('策略数', runStrats, 'num')],
      },
      {
        key: 'rate',
        title: '到店率 / 核销率',
        hint: '到店÷发送 · 用券÷发券',
        lines: [mk('触达到店率', reach, 'pct'), mk('优惠券核销率', coupon, 'pct')],
      },
      {
        key: 'conversion',
        title: '转化销售',
        hint: '销售额 ÷ 到店人数',
        lines: [mk('转化销售额', conv, 'money'), mk('人均转化销售', perCapita, 'money')],
      },
      {
        key: 'people',
        title: '触达 / 发券人数',
        hint: '发送人数与发券人数',
        lines: [mk('触达人数', reached, 'num'), mk('优惠券发放人数', couponIssued, 'num')],
      },
    ];
  }, [r7]);

  const hasData = groups.length > 0;

  return (
    <>
      <style>{CSS}</style>
      <div className="vb9-card">
        <div className="vb9-h">
          <h3>
            <span className="vb9-dot" />
            客户运行情况
          </h3>
          <span className="vb9-hint">汇总 · 南区 · 北区</span>
        </div>
        <div className="vb9-b">
          {!hasData ? (
            <div className="vb9-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行数据" /></div>
          ) : (
            <div className="vb9-grid">
              {groups.map((g) => (
                <div key={g.key} className="vb9-grp">
                  <div className="gt" title={g.title}>{g.title}</div>
                  {g.hint && <div className="gh" title={g.hint}>{g.hint}</div>}

                  <div className="vb9-rows">
                    <div className="vb9-th l">指标</div>
                    <div className="vb9-th">合计</div>
                    <div className="vb9-th s">南区</div>
                    <div className="vb9-th n">北区</div>
                    <div className="vb9-divider" />

                    {g.lines.map((ln) => (
                      <React.Fragment key={ln.label}>
                        <div className="vb9-lb" title={ln.label}>{ln.label}</div>
                        <div className="vb9-v t">{format(ln.total, ln.fmt)}</div>
                        <div className="vb9-v s">{format(ln.south, ln.fmt)}</div>
                        <div className="vb9-v n">{format(ln.north, ln.fmt)}</div>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
