/** 第 4-5 排：签约数据同环比 — V6.0 视觉升级
 *
 * 仅当 data.compare !== null 时渲染（后端只在 本周/上周/本月/上月 返回 compare）。
 * 设计语言对齐参考站 pc4.html：
 *   .card / .card-h(方点 + hint) / thead th(var(--panel2)) / 斑马纹 / hover var(--brandSoft)
 *   环比：正 var(--green) / 负 var(--danger)，0 为 text3
 */
import React, { useMemo, useState } from 'react';
import { Empty, Pagination } from 'antd';
import { BoardData, CompareRow } from '@/api/crm-board';
import EChart from '../EChart';
import { fmtDelta, fmtNum, useThemeMode } from './theme';

interface Props {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

/* ══════════════ 局部样式（vb5- 前缀） ══════════════ */
const CSS = `
.vb5-grid{display:grid;gap:14px;align-items:stretch;min-width:0}
@media(max-width:1100px){.vb5-grid{grid-template-columns:1fr!important}}

.vb5-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;height:100%;min-width:0}
.vb5-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}
.vb5-h{padding:13px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb5-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
.vb5-dot{width:6px;height:6px;border-radius:2px;background:var(--brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 16%,transparent);flex-shrink:0}
.vb5-hint{font-size:11px;color:var(--text3);font-weight:550;white-space:nowrap;flex-shrink:0;font-variant-numeric:tabular-nums}
.vb5-b{padding:14px 16px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}
.vb5-empty{padding:22px 0}

/* 表格 */
.vb5-scroll{width:100%;overflow-x:auto;min-width:0}
.vb5-tbl{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px;white-space:nowrap}
.vb5-tbl thead th{
  background:var(--panel2);color:var(--text3);font-weight:650;font-size:11.5px;
  padding:8px 10px;text-align:left;border-bottom:1px solid var(--line);
  position:sticky;top:0;z-index:2;letter-spacing:.2px;
}
.vb5-tbl thead th.r{text-align:right}
.vb5-tbl tbody td{padding:8px 10px;border-bottom:1px solid var(--line2);color:var(--text);font-variant-numeric:tabular-nums}
.vb5-tbl tbody td.r{text-align:right}
.vb5-tbl tbody tr:nth-child(even) td{background:color-mix(in srgb,var(--panel2) 55%,transparent)}
.vb5-tbl tbody tr:hover td{background:var(--brandSoft)}
.vb5-tbl tbody tr:last-child td{border-bottom:0}
.vb5-tbl td.nm{color:var(--text);font-weight:600;max-width:190px;overflow:hidden;text-overflow:ellipsis}
.vb5-tbl td.strong{font-weight:750}
.vb5-tbl td.weak{color:var(--text2)}
.vb5-pager{display:flex;justify-content:flex-end;margin-top:10px}
`;

/* ── 运行时解析 CSS 变量（echarts canvas 不认 var()） ── */
function readVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const el = document.querySelector('.board-root') || document.documentElement;
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

function useTokens() {
  const mode = useThemeMode();
  return useMemo(() => {
    void mode; // 主题切换时重新取值
    return {
      axis: readVar('--text3', '#93a7c2'),
      split: readVar('--line', '#dde8f6'),
      legend: readVar('--text2', '#5a7191'),
      panel: readVar('--panel', '#ffffff'),
      line: readVar('--line', '#dde8f6'),
      text: readVar('--text', '#16253d'),
      brand: readVar('--brand', '#2563eb'),
      brand3: readVar('--brand3', '#60a5fa'),
      green: readVar('--green', '#10b981'),
      cyan: readVar('--cyan', '#06b6d4'),
      warn: readVar('--warn', '#f59e0b'),
      purple: readVar('--purple', '#8b5cf6'),
      danger: readVar('--danger', '#ef4444'),
    };
  }, [mode]);
}

type Tokens = ReturnType<typeof useTokens>;

/** 契约要求的新图表配色（顺序固定） */
const SERIES = ['#3b82f6', '#10b981', '#06b6d4', '#f59e0b', '#8b5cf6', '#ef4444'];

/** 环比单元格：正绿负红，null 显示 - */
function DeltaCell({ v }: { v: number | null }) {
  if (v === null || v === undefined) {
    return <span style={{ color: 'var(--text3)' }}>-</span>;
  }
  const up = v > 0;
  const flat = v === 0;
  const color = flat ? 'var(--text3)' : up ? 'var(--green)' : 'var(--danger)';
  return (
    <span style={{ color, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {flat ? '' : up ? '↑' : '↓'} {fmtDelta(v, 1)}
    </span>
  );
}

/** 对比小柱图（本期 vs 上期） */
function CompareBars({ rows, tok }: { rows: CompareRow[]; tok: Tokens }) {
  const option = useMemo(() => ({
    color: [SERIES[0], tok.axis],
    grid: { left: 6, right: 8, top: 30, bottom: 2, containLabel: true },
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'shadow' as const, shadowStyle: { color: `color-mix(in srgb, ${tok.brand} 10%, transparent)` } },
      backgroundColor: tok.panel,
      borderColor: tok.line,
      borderWidth: 1,
      textStyle: { color: tok.text, fontSize: 12 },
      extraCssText: 'box-shadow:0 6px 18px rgba(20,52,102,.16);border-radius:11px;padding:8px 10px;',
    },
    legend: {
      top: 0, right: 0, itemWidth: 10, itemHeight: 8, itemGap: 12,
      textStyle: { color: tok.legend, fontSize: 10.5 },
    },
    xAxis: {
      type: 'category' as const,
      data: rows.map((r) => r.name),
      axisLine: { lineStyle: { color: tok.line } },
      axisTick: { show: false },
      axisLabel: { color: tok.axis, fontSize: 10.5, hideOverlap: true },
    },
    yAxis: {
      type: 'value' as const,
      minInterval: 1,
      splitLine: { lineStyle: { color: tok.split, type: 'dashed' as const } },
      axisLabel: { color: tok.axis, fontSize: 10.5 },
    },
    series: [
      {
        name: '本期', type: 'bar' as const, barMaxWidth: 16,
        itemStyle: { borderRadius: [4, 4, 0, 0] },
        data: rows.map((r) => r.current),
      },
      {
        name: '上期', type: 'bar' as const, barMaxWidth: 16,
        itemStyle: { borderRadius: [4, 4, 0, 0], opacity: 0.55 },
        data: rows.map((r) => r.previous),
      },
    ],
  }), [rows, tok]);

  if (!rows.length) return null;
  return <EChart option={option} height={150} />;
}

/** 通用对比卡 */
function CompareCard({
  title, subtitle, rows, firstTitle, tok, chart,
}: {
  title: string;
  subtitle?: string;
  rows: CompareRow[];
  firstTitle: string;
  tok: Tokens;
  chart?: boolean;
}) {
  const PAGE = 10;
  const [page, setPage] = useState(1);
  const needPager = rows.length > PAGE;
  const cur = Math.min(page, Math.max(1, Math.ceil(rows.length / PAGE)));
  const view = needPager ? rows.slice((cur - 1) * PAGE, cur * PAGE) : rows;

  return (
    <div className="vb5-card">
      <div className="vb5-h">
        <h3>
          <span className="vb5-dot" />
          {title}
        </h3>
        {subtitle && <span className="vb5-hint">{subtitle}</span>}
      </div>
      <div className="vb5-b">
        {rows.length === 0 ? (
          <div className="vb5-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本期无数据" /></div>
        ) : (
          <>
            {chart && <CompareBars rows={rows} tok={tok} />}
            <div className="vb5-scroll" style={{ marginTop: chart ? 10 : 0 }}>
              <table className="vb5-tbl">
                <thead>
                  <tr>
                    <th>{firstTitle}</th>
                    <th className="r">本期</th>
                    <th className="r">上期</th>
                    <th className="r">环比</th>
                    <th className="r">累计</th>
                  </tr>
                </thead>
                <tbody>
                  {view.map((r) => (
                    <tr key={r.name}>
                      <td className="nm" title={r.name}>{r.name}</td>
                      <td className="r strong">{fmtNum(r.current)}</td>
                      <td className="r weak">{fmtNum(r.previous)}</td>
                      <td className="r"><DeltaCell v={r.ratio} /></td>
                      <td className="r">{fmtNum(r.cumulative)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {needPager && (
              <div className="vb5-pager">
                <Pagination
                  size="small"
                  current={cur}
                  pageSize={PAGE}
                  total={rows.length}
                  showSizeChanger={false}
                  showTotal={(t) => `共 ${t} 项`}
                  onChange={(p) => setPage(p)}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function ComparePanel({ data, loading, isMobile }: Props) {
  const tok = useTokens();
  const cmp = data.compare;

  // 契约要求：compare === null 时什么都不渲染
  if (!cmp) return null;

  const sub = `${cmp.label.current} vs ${cmp.label.previous}`;

  return (
    <>
      <style>{CSS}</style>
      <div className="vb5-grid" style={{ gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))' }}>
        <CompareCard
          title="签约客户环比情况" subtitle={sub}
          rows={cmp.clients} firstTitle="分类" tok={tok} chart
        />
        <CompareCard
          title="签约门店数环比情况" subtitle={sub}
          rows={cmp.stores} firstTitle="分类" tok={tok} chart
        />
        <CompareCard
          title="按连锁类型环比情况" subtitle={sub}
          rows={cmp.byChainType} firstTitle="连锁类型" tok={tok}
        />
        <CompareCard
          title="按销售环比情况" subtitle={sub}
          rows={cmp.bySales} firstTitle="销售" tok={tok}
        />
        <div style={{ gridColumn: isMobile ? 'auto' : '1 / -1' }}>
          <CompareCard
            title="按销售 × 连锁类型环比情况" subtitle={sub}
            rows={cmp.bySalesType} firstTitle="销售 · 连锁类型" tok={tok}
          />
        </div>
      </div>
    </>
  );
}
