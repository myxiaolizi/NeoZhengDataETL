/** 第 4 排右：流程处理 — V7.1
 *
 * F2 卡片名称显示在标题栏
 * F3 筛选按钮紧跟名称、同一行；右侧「更多 ›」
 *    → 标题栏一行：`[● 流程处理] [全部][南区][北区] …… [最近 7 天] [更多 ›]`
 * F4 显示具体数字：柱段内直接标注数字（够宽时）+ 每日柱下节点数字 + 右侧当日合计放大
 * F5 数据窗口：正文**最近 7 日**，「更多」弹窗**最近 30 日**
 *
 * 区域筛选：后端 `byRegion` 使用**中文键**（全部 / 南区 / 北区），
 * 这里优先按中文键取，并兼容英文键与 matrixSouth/matrixNorth 扁平字段。
 *
 * 弹窗注意：antd Modal 通过 portal 挂到 body，取不到 `.board-root` 上的 CSS 变量，
 * 因此在弹窗内容外层用**字面色值**重新声明同一批变量（明/暗各一套），避免深色下文字不可见。
 */
import React, { useMemo, useState } from 'react';
import { Empty, Modal } from 'antd';
import type { BoardData, FlowProgressData } from '@/api/crm-board';
import { fmtNum } from './theme';
import { useThemeMode } from './theme';

export interface FlowProgressProps {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

type RegionKey = 'all' | 'south' | 'north';

/** 本地扩展：不代表 api 已声明这些字段，缺失时走兜底 */
type FpLoose = FlowProgressData & {
  daysCn?: string[];
  byRegion?: Record<string, { matrix?: number[][] }>;
  matrixSouth?: number[][];
  matrixNorth?: number[][];
  /** V7.1 30 日窗口（弹窗用） */
  days30?: string[];
  daysCn30?: string[];
  matrix30?: number[][];
  byRegion30?: Record<string, { matrix?: number[][] }>;
};

/** 正文显示天数 / 弹窗显示天数 */
const BODY_DAYS = 7;
const MODAL_DAYS = 30;

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

/** 9 个流程节点配色（契约 §三 令牌色） */
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

/** 节点短名（柱下数字用，避免换行） */
const NODE_SHORT: Record<string, string> = {
  销售签约: '销售',
  策略开通: '开通',
  实施对接: '实施',
  对接审核: '对接',
  客服处理: '客服',
  客户培训: '培训',
  连锁使用: '使用',
  策略审核: '审核',
  流程结束: '结束',
};
function nodeShort(name: string, i: number): string {
  return NODE_SHORT[name] || name.slice(0, 2) || String(i + 1);
}

/** 区域 → byRegion 里可能的键（后端用中文键，兼容英文/扁平字段） */
const REGION_KEYS: Record<RegionKey, string[]> = {
  all: ['全部', 'all', 'ALL', '总计'],
  south: ['南区', 'south', 'SOUTH'],
  north: ['北区', 'north', 'NORTH'],
};

function pickBag(
  bag: Record<string, { matrix?: number[][] }> | undefined,
  region: RegionKey,
): number[][] | null {
  if (!bag) return null;
  for (const k of REGION_KEYS[region]) {
    const m = bag[k]?.matrix;
    if (Array.isArray(m)) return m;
  }
  return null;
}

/** 一个数据窗口（正文 7 日 / 弹窗 30 日） */
interface Win {
  days: string[];
  daysCn: string[] | undefined;
  matrix: number[][] | null;
  byRegion: Record<string, { matrix?: number[][] }> | undefined;
}

/** 取窗口：弹窗优先 matrix30，缺失回退 matrix */
function pickWindow(fp: FpLoose | undefined, want30: boolean): Win {
  if (!fp) return { days: [], daysCn: undefined, matrix: null, byRegion: undefined };

  const mainDays = Array.isArray(fp.days) ? fp.days : [];
  const mainCn = Array.isArray(fp.daysCn) ? fp.daysCn : undefined;
  const mainMatrix = Array.isArray(fp.matrix) ? fp.matrix : null;

  if (!want30) {
    return { days: mainDays, daysCn: mainCn, matrix: mainMatrix, byRegion: fp.byRegion };
  }

  const m30 = Array.isArray(fp.matrix30) ? fp.matrix30 : null;
  if (m30) {
    return {
      days: Array.isArray(fp.days30) ? fp.days30 : mainDays,
      daysCn: Array.isArray(fp.daysCn30) ? fp.daysCn30 : mainCn,
      matrix: m30,
      byRegion: fp.byRegion30 ?? fp.byRegion,
    };
  }
  return { days: mainDays, daysCn: mainCn, matrix: mainMatrix, byRegion: fp.byRegion };
}

/** 取区域矩阵；null = 后端未提供（不伪造） */
function regionMatrix(fp: FpLoose | undefined, win: Win, region: RegionKey): number[][] | null {
  if (!win.matrix) return null;
  if (region === 'all') return win.matrix;

  const fromBag = pickBag(win.byRegion, region);
  if (fromBag) return fromBag;

  // 兜底：主窗口的扁平字段
  const flat = region === 'south' ? fp?.matrixSouth : fp?.matrixNorth;
  if (Array.isArray(flat)) return flat;
  return null;
}

/** 取最后 maxCols 列（保证正文 7 日 / 弹窗 30 日） */
function sliceCols(matrix: number[][] | null, dayCount: number, maxCols: number) {
  const start = Math.max(0, dayCount - maxCols);
  if (!matrix) return { matrix: null as number[][] | null, start, count: Math.max(0, dayCount - start) };
  const sliced = matrix.map((row) => {
    const src = Array.isArray(row) ? row : [];
    const out: number[] = [];
    for (let i = start; i < dayCount; i += 1) out.push(num(src[i]));
    return out;
  });
  return { matrix: sliced, start, count: Math.max(0, dayCount - start) };
}

/** 弹窗内的字面色值（Modal portal 到 body，拿不到 .board-root 变量） */
const MODAL_VARS: Record<'light' | 'dark', React.CSSProperties> = {
  light: {
    '--panel': '#ffffff',
    '--panel2': '#f7faff',
    '--line': '#dde8f6',
    '--line2': '#eaf2fb',
    '--text': '#16253d',
    '--text2': '#5a7191',
    '--text3': '#93a7c2',
    '--brand': '#2563eb',
    '--brandSoft': '#e9f2ff',
  } as React.CSSProperties,
  dark: {
    '--panel': '#101d33',
    '--panel2': '#14233c',
    '--line': '#1e3252',
    '--line2': '#182a45',
    '--text': '#e2e8f0',
    '--text2': '#94a8c4',
    '--text3': '#6b82a3',
    '--brand': '#3b82f6',
    '--brandSoft': '#16294a',
  } as React.CSSProperties,
};

/* ══════════════ 局部样式（vb8- 前缀） ══════════════ */
const CSS = `
.vb8-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;height:100%;min-width:0}
.vb8-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}

/* F2/F3：标题栏一行 = 名称 + 筛选 + 更多 */
.vb8-h{padding:10px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;gap:8px;flex-shrink:0;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent);flex-wrap:wrap}
.vb8-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap;flex-shrink:0;line-height:1}
.vb8-dot{width:6px;height:6px;border-radius:2px;background:var(--green);box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 16%,transparent);flex-shrink:0}
.vb8-hfilter{display:flex;align-items:center;gap:4px;flex-shrink:0;margin-left:2px}
.vb8-hint{font-size:10.5px;color:var(--text3);font-weight:550;white-space:nowrap;margin-left:auto}
.vb8-more{display:inline-flex;align-items:center;gap:3px;height:22px;padding:0 9px;border-radius:6px;border:1px dashed var(--line);background:var(--panel);color:var(--brand);font-size:10.5px;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap;font-family:inherit;line-height:1;flex-shrink:0}
.vb8-more:hover{background:var(--brandSoft);border-color:var(--brand3)}

/* 区域筛选按钮 */
.vb8-seg{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:6px;cursor:pointer;user-select:none;border:1px solid var(--line);background:var(--panel2);color:var(--text2);font-size:11px;font-weight:600;transition:all .15s;white-space:nowrap;font-family:inherit;line-height:1}
.vb8-seg:hover{border-color:var(--brand3);color:var(--brand)}
.vb8-seg.on{color:#fff;border-color:transparent;box-shadow:0 3px 9px color-mix(in srgb,var(--brand) 26%,transparent)}
.vb8-seg .sw{width:6px;height:6px;border-radius:2px;margin-right:4px;flex-shrink:0}
.vb8-seg.on .sw{background:#fff!important}

.vb8-b{padding:11px 16px 13px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}

/* 节点图例 */
.vb8-legend{display:flex;align-items:center;gap:3px 8px;flex-wrap:wrap;margin-bottom:9px;min-width:0}
.vb8-lg{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;color:var(--text3);white-space:nowrap;line-height:1}
.vb8-lg .sw{width:8px;height:8px;border-radius:2px;flex-shrink:0}

/* F4：每日一行 —— 日期 | 堆叠柱(带数字) | 当日合计；其下为各节点数字 */
.vb8-days{display:flex;flex-direction:column;gap:6px;min-width:0}
.vb8-day{display:flex;flex-direction:column;gap:3px;min-width:0}
.vb8-day-main{display:grid;grid-template-columns:58px minmax(0,1fr) 42px;align-items:center;gap:8px;min-width:0}
.vb8-day-lb{font-size:10.5px;font-weight:650;color:var(--text2);white-space:nowrap;font-variant-numeric:tabular-nums;line-height:1}
.vb8-bar{display:flex;height:22px;border-radius:6px;overflow:hidden;background:var(--panel2);box-shadow:inset 0 0 0 1px var(--line2);min-width:0}
.vb8-bar i{display:flex;align-items:center;justify-content:center;height:100%;transition:width .5s cubic-bezier(.4,0,.2,1);min-width:2px;overflow:hidden;font-style:normal}
.vb8-bar i b{font-size:9.5px;font-weight:800;color:#fff;line-height:1;text-shadow:0 1px 2px rgba(0,0,0,.28);font-variant-numeric:tabular-nums;white-space:nowrap}
.vb8-day-v{font-size:17px;font-weight:800;color:var(--text);text-align:right;font-variant-numeric:tabular-nums;line-height:1;letter-spacing:-.4px}
.vb8-day.empty .vb8-day-v{color:var(--text3);font-weight:600;font-size:14px}
.vb8-day-chips{display:flex;flex-wrap:wrap;gap:4px;padding-left:66px;min-width:0}
.vb8-nchip{display:inline-flex;align-items:center;gap:3px;font-size:9.5px;color:var(--text2);white-space:nowrap;line-height:1;font-variant-numeric:tabular-nums}
.vb8-nchip .d{width:6px;height:6px;border-radius:2px;flex-shrink:0}
.vb8-nchip b{font-weight:800;color:var(--text);font-size:10.5px}

.vb8-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:9px;padding-top:9px;border-top:1px dashed var(--line);flex-wrap:wrap}
.vb8-foot .k{font-size:10.5px;color:var(--text3);font-weight:600;white-space:nowrap}
.vb8-foot .k b{font-size:15px;color:var(--text);font-weight:750;font-variant-numeric:tabular-nums;margin:0 2px}
.vb8-note{margin-top:8px;padding:6px 10px;border-radius:8px;background:color-mix(in srgb,var(--warn) 10%,transparent);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent);color:var(--text2);font-size:11px;line-height:1.5}
.vb8-empty{padding:34px 0}

/* 弹窗表格（变量由外层字面色值包裹提供） */
.vb8-pop{color:var(--text)}
.vb8-tbl-wrap{width:100%;overflow:auto;max-height:60vh;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
.vb8-tbl{width:100%;border-collapse:separate;border-spacing:0;font-size:11.5px;white-space:nowrap;font-variant-numeric:tabular-nums}
.vb8-tbl thead th{position:sticky;top:0;z-index:3;background:var(--panel2);color:var(--text2);font-size:10.5px;font-weight:700;padding:7px 8px;text-align:right;border-bottom:1px solid var(--line);letter-spacing:.2px}
.vb8-tbl thead th.first{text-align:left;left:0;z-index:4}
.vb8-tbl thead th.tot{color:var(--brand)}
.vb8-tbl tbody th{position:sticky;left:0;z-index:2;background:var(--panel);text-align:left;font-size:11.5px;font-weight:600;color:var(--text);padding:7px 9px;border-bottom:1px solid var(--line2);border-right:1px solid var(--line2);white-space:nowrap}
.vb8-tbl tbody th .d{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;vertical-align:middle}
.vb8-tbl tbody td{text-align:right;padding:7px 8px;border-bottom:1px solid var(--line2);color:var(--text);font-weight:600}
.vb8-tbl tbody tr:nth-child(even) td{background:color-mix(in srgb,var(--panel2) 55%,transparent)}
.vb8-tbl tbody tr:nth-child(even) th{background:color-mix(in srgb,var(--panel2) 55%,var(--panel))}
.vb8-tbl tbody tr:hover td{background:var(--brandSoft)}
.vb8-tbl tbody tr:hover th{background:var(--brandSoft)}
.vb8-tbl tbody td.zero{color:var(--text2);font-weight:500;opacity:.72}
.vb8-tbl tbody td.tot{color:var(--brand);font-weight:750}
.vb8-tbl tbody tr.sum th{color:var(--text2);font-size:11px;font-weight:700}
.vb8-tbl tbody tr.sum td{color:var(--brand);font-weight:750}
.vb8-tbl tbody tr.sum td.zero{color:var(--text3)}
.vb8-popnote{font-size:11px;color:var(--text2);margin-top:9px;line-height:1.6}
`;

export default function FlowProgress({ data, loading, isMobile }: FlowProgressProps) {
  const fp = data?.row6?.flowProgress as FpLoose | undefined;
  const mode = useThemeMode();
  const [region, setRegion] = useState<RegionKey>('all');
  const [moreOpen, setMoreOpen] = useState(false);

  const nodes = Array.isArray(fp?.nodes) ? (fp?.nodes ?? []) : [];

  /* ── 正文窗口：最近 7 日 ── */
  const bodyWin = useMemo(() => pickWindow(fp, false), [fp]);
  const bodyMatrixRaw = useMemo(() => regionMatrix(fp, bodyWin, region), [fp, bodyWin, region]);
  const bodyRegionMissing = region !== 'all' && bodyMatrixRaw === null;

  const bodyView = useMemo(() => {
    const dayCount = bodyWin.days.length;
    const sl = sliceCols(bodyMatrixRaw, dayCount, BODY_DAYS);
    return {
      days: bodyWin.days.slice(sl.start).map((d, i) => dayCn(d, sl.start + i, bodyWin.daysCn)),
      matrix: sl.matrix,
      count: sl.count,
      start: sl.start,
    };
  }, [bodyWin, bodyMatrixRaw]);

  /* ── 弹窗窗口：最近 30 日 ── */
  const modalWin = useMemo(() => pickWindow(fp, true), [fp]);
  const modalMatrixRaw = useMemo(() => regionMatrix(fp, modalWin, region), [fp, modalWin, region]);
  const modalRegionMissing = region !== 'all' && modalMatrixRaw === null;

  const modalView = useMemo(() => {
    const dayCount = modalWin.days.length;
    const sl = sliceCols(modalMatrixRaw, dayCount, MODAL_DAYS);
    return {
      days: modalWin.days.slice(sl.start).map((d, i) => dayCn(d, sl.start + i, modalWin.daysCn)),
      matrix: sl.matrix,
      count: sl.count,
    };
  }, [modalWin, modalMatrixRaw]);

  /** 把矩阵 + 日期算成行列合计 */
  const buildTotals = (matrix: number[][] | null, dayCount: number) => {
    const rows: number[][] = nodes.map((_, ri) => {
      const line = Array.isArray(matrix?.[ri]) ? (matrix as number[][])[ri] : [];
      return new Array<number>(dayCount).fill(0).map((__, ci) => num(line[ci]));
    });
    const rowT = rows.map((r) => r.reduce((a, b) => a + b, 0));
    const colT = new Array<number>(dayCount).fill(0).map((__, ci) => rows.reduce((a, r) => a + num(r[ci]), 0));
    return { grid: rows, rowTotals: rowT, colTotals: colT, grand: colT.reduce((a, b) => a + b, 0) };
  };

  const bodyT = useMemo(
    () => buildTotals(bodyView.matrix, bodyView.days.length),
    [bodyView, nodes],
  );
  const modalT = useMemo(
    () => buildTotals(modalView.matrix, modalView.days.length),
    [modalView, nodes],
  );

  const hasData = bodyView.days.length > 0 && nodes.length > 0;
  const maxDay = bodyT.colTotals.reduce((m, v) => Math.max(m, v), 0);
  const realAvg = bodyT.colTotals.length ? bodyT.grand / bodyT.colTotals.length : 0;

  const regionOpts: { key: RegionKey; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'south', label: '南区' },
    { key: 'north', label: '北区' },
  ];
  const regionColor = (k: RegionKey) => (k === 'south' ? '#2563eb' : k === 'north' ? '#10b981' : 'var(--brand)');
  const regionGrad = (k: RegionKey) => (
    k === 'south'
      ? 'linear-gradient(135deg,#2563eb,#3b82f6)'
      : k === 'north'
        ? 'linear-gradient(135deg,#10b981,#34d399)'
        : 'linear-gradient(135deg,var(--brand),var(--brand2))'
  );

  const regionName = region === 'all' ? '全部区域' : region === 'south' ? '南区' : '北区';

  return (
    <>
      <style>{CSS}</style>
      <div className="vb8-card">
        {/* F2 + F3：名称 + 筛选 + 更多 同一行 */}
        <div className="vb8-h">
          <h3>
            <span className="vb8-dot" />
            流程处理
          </h3>

          <div className="vb8-hfilter">
            {regionOpts.map((o) => {
              const on = region === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  className={`vb8-seg${on ? ' on' : ''}`}
                  style={on ? { background: regionGrad(o.key) } : undefined}
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
          </div>

          <span className="vb8-hint">最近 {BODY_DAYS} 天</span>
          <button type="button" className="vb8-more" onClick={() => setMoreOpen(true)}>
            更多 ›
          </button>
        </div>

        <div className="vb8-b">
          {!hasData ? (
            <div className="vb8-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无流程处理数据" /></div>
          ) : bodyRegionMissing ? (
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

              {/* F4：每日一行，柱上带数字 + 柱下节点数字 + 右侧合计放大 */}
              <div className="vb8-days">
                {bodyView.days.map((d, ci) => {
                  const total = bodyT.colTotals[ci] || 0;
                  const segs = nodes
                    .map((nd, ri) => ({ nd, v: num(bodyT.grid[ri]?.[ci]), i: ri }))
                    .filter((s) => s.v > 0);
                  const empty = total <= 0;
                  return (
                    <div className={`vb8-day${empty ? ' empty' : ''}`} key={`${d}-${ci}`}>
                      <div className="vb8-day-main">
                        <span className="vb8-day-lb">{d}</span>
                        <div
                          className="vb8-bar"
                          title={empty ? `${d}：无流程完成` : `${d} 合计 ${total} 家`}
                        >
                          {segs.map((s) => {
                            const w = maxDay > 0 ? (s.v / maxDay) * 100 : 0;
                            // 段够宽（>24px 等效）才在段内写数字，避免挤压
                            const showNum = (w / 100) * 340 >= 24;
                            return (
                              <i
                                key={s.nd}
                                style={{ width: `${w}%`, background: nodeColor(s.nd, s.i) }}
                                title={`${s.nd}：${s.v} 家（占当日 ${((s.v / total) * 100).toFixed(0)}%）`}
                              >
                                {showNum ? <b>{s.v}</b> : null}
                              </i>
                            );
                          })}
                        </div>
                        <span className="vb8-day-v">{fmtNum(total)}</span>
                      </div>
                      {!empty && (
                        <div className="vb8-day-chips">
                          {segs.map((s) => (
                            <span className="vb8-nchip" key={`${s.nd}-c`} title={`${s.nd}：${s.v} 家`}>
                              <span className="d" style={{ background: nodeColor(s.nd, s.i) }} />
                              {nodeShort(s.nd, s.i)}<b>{s.v}</b>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 汇总 */}
              <div className="vb8-foot">
                <span className="k">近 {bodyView.count} 日累计 <b>{fmtNum(bodyT.grand)}</b> 家</span>
                <span className="k">日均 <b>{realAvg ? realAvg.toFixed(1) : '0'}</b> 家</span>
                <span className="k">单日最高 <b>{fmtNum(maxDay)}</b> 家</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* F5：「更多」弹窗 —— 最近 30 日，行=节点，列=日期，末列合计 */}
      <Modal
        title={`流程处理明细 · ${regionName}（最近 ${modalView.count || MODAL_DAYS} 日）`}
        open={moreOpen}
        onCancel={() => setMoreOpen(false)}
        footer={null}
        width={isMobile ? '96vw' : 1180}
        styles={{ body: { paddingTop: 8 } }}
      >
        {/* 字面色值包裹：Modal 挂在 body，取不到 .board-root 的 CSS 变量 */}
        <div className="vb8-pop" style={MODAL_VARS[mode === 'dark' ? 'dark' : 'light']}>
          {!modalView.count || modalRegionMissing ? (
            <Empty description={modalRegionMissing ? '该区域明细数据待后端提供' : '暂无数据'} />
          ) : (
            <>
              <div className="vb8-tbl-wrap">
                <table className="vb8-tbl">
                  <thead>
                    <tr>
                      <th className="first">流程节点</th>
                      {modalView.days.map((d, ci) => <th key={`${d}-${ci}`}>{d}</th>)}
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
                        {modalView.days.map((d, ci) => {
                          const v = num(modalT.grid[ri]?.[ci]);
                          return <td key={`${nd}-${d}-${ci}`} className={v ? '' : 'zero'}>{v || 0}</td>;
                        })}
                        <td className="tot">{fmtNum(modalT.rowTotals[ri] || 0)}</td>
                      </tr>
                    ))}
                    <tr className="sum">
                      <th>当日合计</th>
                      {modalT.colTotals.map((v, ci) => (
                        <td key={`sum-${ci}`} className={v ? '' : 'zero'}>{fmtNum(v || 0)}</td>
                      ))}
                      <td>{fmtNum(modalT.grand)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="vb8-popnote">
                口径：单元格 = 该日期完成到该流程节点的客户数；「合计」列为该节点近 {modalView.count} 日累计。
                卡片正文显示最近 {BODY_DAYS} 日，本弹窗显示最近 {modalView.count} 日。
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
