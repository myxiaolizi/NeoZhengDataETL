/** 第 8 排：按策略模型 × 策略类型分南北区 — V6.0 视觉升级
 *
 * 数据与口径不变：data.row8.items（每项 { model, type, south/north/total: Row7Data }）
 * 呈现：分组表格
 *  - 「策略模块」列按同 model 合并单元格（原生 rowSpan，分页内计算，不跨页错位）
 *  - 指标列内上下两行显示「南 X」「北 Y」，南区 var(--brand)、北区 var(--cyan)
 * 视觉对齐 pc4.html：表头 var(--panel2)、斑马纹、hover var(--brandSoft)。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Empty, Pagination } from 'antd';
import type { BoardData, ModelTypeItem, Row7Data } from '@/api/crm-board';
import { fmtMoney, fmtNum, fmtPct } from './theme';

export interface RunBreakdownProps {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

interface Row {
  key: string;
  model: string;
  type: string;
  south: Row7Data;
  north: Row7Data;
  total: Row7Data;
}

type Fmt = 'num' | 'pct' | 'money';

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmt(v: number, kind: Fmt): string {
  if (kind === 'pct') return fmtPct(v);
  if (kind === 'money') return fmtMoney(v);
  return fmtNum(v);
}

/** 取「该区域自身」的数值：优先 region 字段，为 0/缺失时回退 total
 *
 * 后端 buildRow8 用 aggregateRow7 过滤出该区域的行再聚合：
 * 南区对象里 reachRate.south 有值、.north 恒为 0（反之亦然），
 * 因此 south 行取 .south、north 行取 .north，并用 total 兜底容错。
 */
function own(p: { south?: number; north?: number; total?: number } | null | undefined, region: 'south' | 'north'): number {
  const o = num(p?.[region]);
  if (o !== 0) return o;
  return num(p?.total);
}

/** 空 Row7Data 兜底（后端字段缺失时不崩） */
function safeR7(v?: Partial<Row7Data> | null): Row7Data {
  return {
    openedStrategy: {
      chains: v?.openedStrategy?.chains ?? { south: 0, north: 0, total: 0 },
      strategies: v?.openedStrategy?.strategies ?? { south: 0, north: 0, total: 0 },
    },
    runningStrategy: {
      chains: v?.runningStrategy?.chains ?? { south: 0, north: 0, total: 0 },
      strategies: v?.runningStrategy?.strategies ?? { south: 0, north: 0, total: 0 },
    },
    reachRate: v?.reachRate ?? { south: 0, north: 0, total: 0 },
    couponRate: v?.couponRate ?? { south: 0, north: 0, total: 0 },
    conversion: {
      south: num(v?.conversion?.south),
      north: num(v?.conversion?.north),
      total: num(v?.conversion?.total),
      perCapita: v?.conversion?.perCapita ?? { south: 0, north: 0, total: 0 },
    },
    people: {
      reached: v?.people?.reached ?? { south: 0, north: 0, total: 0 },
      couponIssued: v?.people?.couponIssued ?? { south: 0, north: 0, total: 0 },
    },
  };
}

/* ══════════════ 局部样式（vb10- 前缀） ══════════════ */
const CSS = `
.vb10-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;min-width:0}
.vb10-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}
.vb10-h{padding:13px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb10-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
.vb10-dot{width:6px;height:6px;border-radius:2px;background:var(--purple);box-shadow:0 0 0 3px color-mix(in srgb,var(--purple) 16%,transparent);flex-shrink:0}
.vb10-hint{font-size:11px;color:var(--text3);font-weight:550;white-space:nowrap;flex-shrink:0;display:flex;align-items:center;gap:6px}
.vb10-hint .s{color:var(--brand);font-weight:700}
.vb10-hint .n{color:var(--cyan);font-weight:700}
.vb10-b{padding:14px 16px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}

.vb10-scroll{width:100%;overflow-x:auto;border-radius:10px;min-width:0}
.vb10-tbl{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px;white-space:nowrap}
.vb10-tbl thead th{
  background:var(--panel2);color:var(--text3);font-weight:650;font-size:11px;
  padding:9px 10px;text-align:right;border-bottom:1px solid var(--line);letter-spacing:.2px;
}
.vb10-tbl thead th.l{text-align:left}
.vb10-tbl tbody td{
  padding:8px 10px;border-bottom:1px solid var(--line2);text-align:right;
  font-variant-numeric:tabular-nums;vertical-align:middle;
}
.vb10-tbl tbody td.l{text-align:left}
.vb10-tbl tbody tr:nth-child(even) td{background:color-mix(in srgb,var(--panel2) 55%,transparent)}
.vb10-tbl tbody tr:hover td{background:var(--brandSoft)}
.vb10-tbl tbody tr:last-child td{border-bottom:0}
.vb10-tbl td.model{
  font-size:12.5px;font-weight:700;color:var(--text);
  border-right:1px solid var(--line);background:var(--panel2)!important;
  vertical-align:middle;
}
.vb10-tbl tr:nth-child(even) td.model{background:color-mix(in srgb,var(--panel2) 82%,var(--panel))!important}
.vb10-tbl td.type{font-size:12px;color:var(--text2)}
.vb10-dual{display:flex;flex-direction:column;gap:2px;line-height:1.3}
.vb10-dual .s{color:var(--brand);font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
.vb10-dual .n{color:var(--cyan);font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
.vb10-dual .tag{font-size:9.5px;opacity:.8;margin-right:3px;font-weight:600}
.vb10-pager{display:flex;justify-content:flex-end;margin-top:10px}
.vb10-empty{padding:34px 0}
`;

export default function RunBreakdown({ data, loading, isMobile }: RunBreakdownProps) {
  const items = Array.isArray(data?.row8?.items) ? (data?.row8?.items ?? []) : [];

  const rows = useMemo<Row[]>(() => items.map((it: ModelTypeItem, i) => {
    const model = String(it?.model ?? '') || '未分类';
    const type = String(it?.type ?? '') || '未分类';
    return {
      key: `${model}|${type}|${i}`,
      model,
      type,
      south: safeR7(it?.south),
      north: safeR7(it?.north),
      total: safeR7(it?.total),
    };
  }), [items]);

  /** 分页（自行切片，保证 rowSpan 合并只在当前页内计算，不跨页错位） */
  const pageSize = isMobile ? 5 : 10;
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [rows.length]);

  const pageRows = useMemo(() => {
    const maxPage = Math.max(Math.ceil(rows.length / pageSize), 1);
    const cur = Math.min(page, maxPage);
    return rows.slice((cur - 1) * pageSize, cur * pageSize);
  }, [rows, page, pageSize]);

  /** 当前页内每个 model 的行数与起始判断，用于 rowSpan */
  const spanMap = useMemo(() => {
    const map = new Map<string, { span: number; start: boolean }>();
    const counts = new Map<string, number>();
    pageRows.forEach((r) => counts.set(r.model, (counts.get(r.model) ?? 0) + 1));
    const seen = new Set<string>();
    pageRows.forEach((r) => {
      const first = !seen.has(r.model);
      seen.add(r.model);
      map.set(r.key, { span: first ? (counts.get(r.model) ?? 1) : 0, start: first });
    });
    return map;
  }, [pageRows]);

  const total = rows.length;
  const curPage = Math.min(page, Math.max(Math.ceil(total / pageSize), 1));

  /** 指标列定义：标题 + 取值器 + 格式 */
  const metricCols: { title: string; pick: (r: Row) => { south: number; north: number }; kind: Fmt }[] = [
    {
      title: '开通策略数',
      pick: (r) => ({
        south: own(r.south.openedStrategy?.strategies, 'south'),
        north: own(r.north.openedStrategy?.strategies, 'north'),
      }),
      kind: 'num',
    },
    {
      title: '运行策略数',
      pick: (r) => ({
        south: own(r.south.runningStrategy?.strategies, 'south'),
        north: own(r.north.runningStrategy?.strategies, 'north'),
      }),
      kind: 'num',
    },
    {
      title: '触达人数',
      pick: (r) => ({
        south: own(r.south.people?.reached, 'south'),
        north: own(r.north.people?.reached, 'north'),
      }),
      kind: 'num',
    },
    {
      title: '到店率',
      pick: (r) => ({
        south: own(r.south.reachRate, 'south'),
        north: own(r.north.reachRate, 'north'),
      }),
      kind: 'pct',
    },
    {
      title: '优惠券核销率',
      pick: (r) => ({
        south: own(r.south.couponRate, 'south'),
        north: own(r.north.couponRate, 'north'),
      }),
      kind: 'pct',
    },
    {
      title: '转化销售额',
      pick: (r) => ({
        south: own(r.south.conversion, 'south'),
        north: own(r.north.conversion, 'north'),
      }),
      kind: 'money',
    },
  ];

  return (
    <>
      <style>{CSS}</style>
      <div className="vb10-card">
        <div className="vb10-h">
          <h3>
            <span className="vb10-dot" />
            按策略模型和策略类型分南北区
          </h3>
          <span className="vb10-hint">
            共 {fmtNum(total)} 组 · <span className="s">南</span>/<span className="n">北</span>
          </span>
        </div>
        <div className="vb10-b">
          {!total ? (
            <div className="vb10-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无策略模型数据" /></div>
          ) : (
            <>
              <div className="vb10-scroll">
                <table className="vb10-tbl">
                  <thead>
                    <tr>
                      <th className="l">策略模块</th>
                      <th className="l">策略类型</th>
                      {metricCols.map((c) => <th key={c.title}>{c.title}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => {
                      const s = spanMap.get(r.key);
                      return (
                        <tr key={r.key}>
                          {s?.start && (
                            <td className="model l" rowSpan={s.span}>{r.model}</td>
                          )}
                          <td className="type l">{r.type}</td>
                          {metricCols.map((c) => {
                            const v = c.pick(r);
                            return (
                              <td key={c.title}>
                                <div className="vb10-dual">
                                  <span className="s"><span className="tag">南</span>{fmt(num(v.south), c.kind)}</span>
                                  <span className="n"><span className="tag">北</span>{fmt(num(v.north), c.kind)}</span>
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="vb10-pager">
                <Pagination
                  size="small"
                  current={curPage}
                  pageSize={pageSize}
                  total={total}
                  showSizeChanger={false}
                  showTotal={(t) => `共 ${t} 组`}
                  onChange={(p) => setPage(p)}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
