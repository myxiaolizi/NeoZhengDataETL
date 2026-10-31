/** 第 4 排右：流程处理（表格）— V8.1
 *
 * F1 直接采用**表格**显示：行 = 日期，列 = 9 个节点 + 合计
 * F2 卡片显示最近 **7 日**；点「更多」显示近 **30 日**
 * F3 弹窗与卡片结构一致：行 = 日期，列 = 节点
 * F4 卡片与弹窗日期均**倒序**（最新日期在最上面）
 * F6 只消费后端 `row6.flowProgress`（数据源修正由 Lead 在 crmboard.js 完成），本组件不自己算口径
 *
 * 数据窗口字段：days/daysCn/matrix（7 日）、days30/daysCn30/matrix30（30 日）
 * 区域筛选：后端 byRegion 用中文键（全部/南区/北区），兼容英文键与 matrixSouth/matrixNorth。
 *
 * ⚠️ Modal 通过 portal 挂到 body，取不到 `.board-root` 的 CSS 变量，
 * 因此弹窗内容外层用**字面色值**重新声明令牌（明/暗两套）。
 */
import React, { useMemo, useState } from 'react';
import { Empty, Modal } from 'antd';
import type { BoardData, FlowProgressData } from '@/api/crm-board';
import { fmtNum, useThemeMode } from './theme';

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
  days30?: string[];
  daysCn30?: string[];
  matrix30?: number[][];
  byRegion30?: Record<string, { matrix?: number[][] }>;
  matrix30South?: number[][];
  matrix30North?: number[][];
};

const BODY_DAYS = 7;
const MODAL_DAYS = 30;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** `10/26` / `10-26` / `2026-10-26` → `10月26日`；已是中文格式原样返回 */
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
  销售签约: '#2563eb',
  策略开通: '#8b5cf6',
  实施对接: '#06b6d4',
  对接审核: '#60a5fa',
  客服处理: '#f59e0b',
  客户培训: '#ec4899',
  连锁使用: '#eab308',
  策略审核: '#94a3b8',
  流程结束: '#10b981',
};
const PALETTE_FALLBACK = ['#2563eb', '#8b5cf6', '#06b6d4', '#60a5fa', '#f59e0b', '#ec4899', '#eab308', '#94a3b8', '#10b981'];
function nodeColor(name: string, i: number): string {
  return NODE_COLORS[name] || PALETTE_FALLBACK[i % PALETTE_FALLBACK.length];
}

/** 节点短名：卡片窄列用；弹窗用全名 */
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
function nodeShort(name: string): string {
  return NODE_SHORT[name] || name.slice(0, 2);
}

/** 区域 → byRegion 可能的键 */
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

interface Win {
  days: string[];
  daysCn: string[] | undefined;
  matrix: number[][] | null;
  byRegion: Record<string, { matrix?: number[][] }> | undefined;
  south: number[][] | null;
  north: number[][] | null;
}

/** 取窗口：弹窗优先 matrix30，缺失回退 matrix */
function pickWindow(fp: FpLoose | undefined, want30: boolean): Win {
  if (!fp) return { days: [], daysCn: undefined, matrix: null, byRegion: undefined, south: null, north: null };

  const mainDays = Array.isArray(fp.days) ? fp.days : [];
  const mainCn = Array.isArray(fp.daysCn) ? fp.daysCn : undefined;
  const mainMatrix = Array.isArray(fp.matrix) ? fp.matrix : null;

  if (!want30) {
    return {
      days: mainDays, daysCn: mainCn, matrix: mainMatrix, byRegion: fp.byRegion,
      south: Array.isArray(fp.matrixSouth) ? fp.matrixSouth : null,
      north: Array.isArray(fp.matrixNorth) ? fp.matrixNorth : null,
    };
  }

  const m30 = Array.isArray(fp.matrix30) ? fp.matrix30 : null;
  if (m30) {
    return {
      days: Array.isArray(fp.days30) ? fp.days30 : mainDays,
      daysCn: Array.isArray(fp.daysCn30) ? fp.daysCn30 : mainCn,
      matrix: m30,
      byRegion: fp.byRegion30 ?? fp.byRegion,
      south: Array.isArray(fp.matrix30South) ? fp.matrix30South : null,
      north: Array.isArray(fp.matrix30North) ? fp.matrix30North : null,
    };
  }
  return {
    days: mainDays, daysCn: mainCn, matrix: mainMatrix, byRegion: fp.byRegion,
    south: Array.isArray(fp.matrixSouth) ? fp.matrixSouth : null,
    north: Array.isArray(fp.matrixNorth) ? fp.matrixNorth : null,
  };
}

/** 取区域矩阵；null = 后端未提供 */
function regionMatrix(win: Win, region: RegionKey): number[][] | null {
  if (!win.matrix) return null;
  if (region === 'all') return win.matrix;
  const fromBag = pickBag(win.byRegion, region);
  if (fromBag) return fromBag;
  const flat = region === 'south' ? win.south : win.north;
  return Array.isArray(flat) ? flat : null;
}

/** 只保留最后 maxCols 天 */
function tailCols(matrix: number[][] | null, dayCount: number, maxCols: number): number[][] | null {
  if (!matrix) return null;
  const start = Math.max(0, dayCount - maxCols);
  return matrix.map((row) => {
    const src = Array.isArray(row) ? row : [];
    const out: number[] = [];
    for (let i = start; i < dayCount; i += 1) out.push(num(src[i]));
    return out;
  });
}

/** 弹窗字面色值（Modal 在 body 上） */
const MODAL_VARS: Record<'light' | 'dark', React.CSSProperties> = {
  light: {
    '--panel': '#ffffff', '--panel2': '#f7faff', '--line': '#dde8f6', '--line2': '#eaf2fb',
    '--text': '#16253d', '--text2': '#5a7191', '--text3': '#93a7c2',
    '--brand': '#2563eb', '--brandSoft': '#e9f2ff',
  } as React.CSSProperties,
  dark: {
    '--panel': '#101d33', '--panel2': '#14233c', '--line': '#1e3252', '--line2': '#182a45',
    '--text': '#e2e8f0', '--text2': '#94a8c4', '--text3': '#6b82a3',
    '--brand': '#3b82f6', '--brandSoft': '#16294a',
  } as React.CSSProperties,
};

/* ══════════════ 局部样式（vb8- 前缀）— V9.2 视觉优化 ══════════════ */
const CSS = `
.vb8-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease;height:100%;min-width:0}

/* ── 卡头：标题 + 区域分段控件 + 更多 ── */
.vb8-h{padding:12px 16px 10px;border-bottom:1px solid var(--line2);display:flex;align-items:center;gap:10px;flex-shrink:0;flex-wrap:wrap;min-width:0}
.vb8-title{display:flex;align-items:center;gap:8px;min-width:0;flex-shrink:0}
.vb8-dot{width:6px;height:6px;border-radius:2px;background:var(--green);box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 15%,transparent);flex-shrink:0}
.vb8-title h3{font-size:var(--fs-sm,13px);font-weight:700;color:var(--text);margin:0;letter-spacing:.2px;white-space:nowrap;line-height:1}
.vb8-hint{font-size:var(--fs-2xs,11px);color:var(--text3);font-weight:500;white-space:nowrap}

/* 区域分段控件（与签约趋势同款，统一观感） */
.vb8-seg{display:inline-flex;align-items:center;padding:2px;gap:2px;border-radius:8px;background:color-mix(in srgb,var(--panel2) 85%,var(--line2));border:1px solid var(--line2);flex-shrink:0}
.vb8-seg button{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 11px;border:0;border-radius:6px;background:transparent;color:var(--text2);font-size:var(--fs-2xs,11px);font-weight:600;cursor:pointer;transition:background .16s ease,color .16s ease,box-shadow .16s ease;white-space:nowrap;font-family:inherit;line-height:1}
.vb8-seg button:hover{color:var(--text)}
.vb8-seg button.on{background:var(--panel);color:var(--text);box-shadow:0 1px 2px rgba(15,23,42,.10);font-weight:700}
.vb8-seg button .sw{width:6px;height:6px;border-radius:2px;flex-shrink:0}

.vb8-more{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 11px;border-radius:7px;border:1px solid var(--line);background:var(--panel);color:var(--text2);font-size:var(--fs-2xs,11px);font-weight:600;cursor:pointer;transition:all .16s ease;white-space:nowrap;font-family:inherit;line-height:1;flex-shrink:0;margin-left:auto}
.vb8-more:hover{background:var(--brandSoft);border-color:var(--brand3);color:var(--brand)}

.vb8-b{padding:0;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}

/* ── 表格 ── */
.vb8-scroll{width:100%;overflow-x:auto;overflow-y:hidden;min-width:0;flex:1;display:flex;flex-direction:column}
.vb8-tb{
  width:100%;height:100%;border-collapse:separate;border-spacing:0;
  font-size:var(--fs-xs,12px);
  font-variant-numeric:tabular-nums;   /* 数字等宽，保证竖直对齐 */
  table-layout:fixed;                   /* 列宽稳定：日期定宽 + 节点等分 */
  /* 窄屏保底宽度：日期 104 + 9×52 + 合计 76 ≈ 648，避免节点列被压成 19px */
  min-width:648px;
}

/* 表头：12px/700 --text2，panel2 底 + 1px --line 下边 */
.vb8-tb thead th{
  position:sticky;top:0;z-index:3;
  padding:9px 8px;text-align:right;white-space:nowrap;
  font-size:var(--fs-xs,12px);font-weight:700;color:var(--text2);letter-spacing:.2px;
  background:var(--panel2);border-bottom:1px solid var(--line);
}
.vb8-tb thead th.first{width:104px;text-align:left;padding-left:16px;position:sticky;left:0;z-index:4}
.vb8-tb thead th.tot{width:76px;color:var(--brand);padding-right:16px}
.vb8-tb thead th .cd{display:inline-block;width:7px;height:7px;border-radius:2px;margin-right:5px;vertical-align:middle}

/* 日期列 */
.vb8-tb tbody th{
  position:sticky;left:0;z-index:2;
  width:104px;padding:10px 8px 10px 16px;text-align:left;white-space:nowrap;
  font-size:var(--fs-xs,12px);font-weight:600;color:var(--text2);
  background:var(--panel);border-bottom:0;
  font-variant-numeric:tabular-nums;
}
/* 节点列：右对齐等宽数字 */
.vb8-tb tbody td{
  padding:10px 8px;text-align:right;white-space:nowrap;
  font-size:var(--fs-xs,12px);font-weight:600;color:var(--text);
  border-bottom:0;
  font-variant-numeric:tabular-nums;
  letter-spacing:.2px;
}

/* 斑马纹：仅极淡交替底色，不加行描边 */
.vb8-tb tbody tr:nth-child(even) td{background:color-mix(in srgb,var(--panel2) 40%,transparent)}
.vb8-tb tbody tr:nth-child(even) th{background:color-mix(in srgb,var(--panel2) 40%,var(--panel))}

/* hover 整行高亮 */
.vb8-tb tbody tr:hover td{background:color-mix(in srgb,var(--brand) 6%,transparent)}
.vb8-tb tbody tr:hover th{background:color-mix(in srgb,var(--brand) 6%,var(--panel))}

/* 0 值：视觉退后但仍可读 */
.vb8-tb tbody td.zero{color:var(--text3);font-weight:500;opacity:.55}

/* 最新日行：左侧 3px 品牌色条 + 极淡品牌底 */
.vb8-tb tbody tr.newest th{
  box-shadow:inset 3px 0 0 var(--brand);
  color:var(--text);font-weight:700;
  background:color-mix(in srgb,var(--brand) 4%,var(--panel));
}
.vb8-tb tbody tr.newest td{background:color-mix(in srgb,var(--brand) 4%,transparent)}
.vb8-tb tbody tr.newest:hover td{background:color-mix(in srgb,var(--brand) 9%,transparent)}
.vb8-tb tbody tr.newest:hover th{background:color-mix(in srgb,var(--brand) 9%,var(--panel))}

/* 当日合计列 */
.vb8-tb tbody td.rowtot{
  color:var(--brand);font-weight:700;padding-right:16px;width:76px;
  background:color-mix(in srgb,var(--brand) 3%,transparent);
}
.vb8-tb tbody tr:nth-child(even) td.rowtot{background:color-mix(in srgb,var(--brand) 6%,transparent)}
.vb8-tb tbody tr:hover td.rowtot{background:color-mix(in srgb,var(--brand) 11%,transparent)}

/* 合计行：13px/750 --text，顶部 1.5px --line，panel2 底 */
.vb8-tb tfoot th,.vb8-tb tfoot td{
  padding:11px 8px;text-align:right;white-space:nowrap;
  font-size:var(--fs-sm,13px);font-weight:750;color:var(--text);
  background:var(--panel2);
  border-top:1.5px solid var(--line);
  position:sticky;bottom:0;z-index:2;
  font-variant-numeric:tabular-nums;
}
.vb8-tb tfoot th{
  text-align:left;padding-left:16px;width:104px;
  color:var(--text2);font-weight:700;
  position:sticky;left:0;bottom:0;z-index:3;
}
.vb8-tb tfoot td.zero{color:var(--text3);font-weight:600;opacity:.7}
.vb8-tb tfoot td.tot{padding-right:16px;width:76px;font-size:var(--fs-lg,17px);font-weight:750;color:var(--brand)}

/* 底部统计 */
.vb8-foot{display:flex;align-items:center;gap:18px;padding:11px 16px;border-top:1px solid var(--line2);flex-wrap:wrap;flex-shrink:0;background:color-mix(in srgb,var(--panel2) 45%,transparent)}
.vb8-foot .k{font-size:var(--fs-2xs,11px);color:var(--text3);font-weight:500;white-space:nowrap;display:inline-flex;align-items:baseline;gap:5px}
.vb8-foot .k b{font-size:var(--fs-lg,17px);color:var(--text);font-weight:750;font-variant-numeric:tabular-nums;line-height:1}
.vb8-empty{padding:34px 0}

/* 弹窗表格（变量由外层字面色值提供） */
.vb8-pop{color:var(--text)}
.vb8-pop .vb8-scroll{max-height:60vh;overflow:auto;flex:none}
.vb8-pop .vb8-tb{font-size:var(--fs-2xs,11px)}
.vb8-pop .vb8-tb thead th{padding:8px 7px;font-size:var(--fs-2xs,11px)}
.vb8-pop .vb8-tb tbody th,.vb8-pop .vb8-tb tbody td{padding:7px;font-size:var(--fs-2xs,11px)}
.vb8-pop .vb8-tb thead th.first,.vb8-pop .vb8-tb tbody th{width:92px;padding-left:12px}
.vb8-pop .vb8-tb thead th.tot,.vb8-pop .vb8-tb tbody td.rowtot{width:64px;padding-right:12px}
.vb8-popnote{font-size:var(--fs-2xs,11px);color:var(--text3);margin-top:10px;line-height:1.7}
`;

export default function FlowProgress({ data, loading, isMobile }: FlowProgressProps) {
  const fp = data?.row6?.flowProgress as FpLoose | undefined;
  const mode = useThemeMode();
  const [region, setRegion] = useState<RegionKey>('all');
  const [moreOpen, setMoreOpen] = useState(false);

  const nodes = Array.isArray(fp?.nodes) ? (fp?.nodes ?? []) : [];

  const buildView = (win: Win, maxCols: number) => {
    const raw = regionMatrix(win, region);
    const dayCount = win.days.length;
    const matrix = tailCols(raw, dayCount, maxCols);
    const start = Math.max(0, dayCount - maxCols);
    const count = Math.max(0, dayCount - start);
    const labels: string[] = [];
    for (let i = start; i < dayCount; i += 1) labels.push(dayCn(win.days[i], i, win.daysCn));

    // grid：matrix[nodeIdx][k]，k 对应 labels[k]
    const grid: number[][] = nodes.map((_, ri) => {
      const line = Array.isArray(matrix?.[ri]) ? (matrix as number[][])[ri] : [];
      return new Array<number>(count).fill(0).map((__, k) => num(line[k]));
    });
    const colTotals = new Array<number>(count).fill(0).map((__, k) => grid.reduce((a, r) => a + num(r[k]), 0));
    const rowTotals = nodes.map((_, ri) => grid[ri].reduce((a, b) => a + b, 0));
    const grand = colTotals.reduce((a, b) => a + b, 0);

    /** F4：倒序 —— 最新日期在最上面 */
    const order: number[] = [];
    for (let k = count - 1; k >= 0; k -= 1) order.push(k);

    return { labels, grid, colTotals, rowTotals, grand, count, order, missing: region !== 'all' && raw === null };
  };

  const bodyWin = useMemo(() => pickWindow(fp, false), [fp]);
  const modalWin = useMemo(() => pickWindow(fp, true), [fp]);

  const bodyView = useMemo(() => buildView(bodyWin, BODY_DAYS), [bodyWin, nodes, region]);
  const modalView = useMemo(() => buildView(modalWin, MODAL_DAYS), [modalWin, nodes, region]);

  const hasData = bodyView.count > 0 && nodes.length > 0;
  const maxDay = bodyView.colTotals.reduce((m, v) => Math.max(m, v), 0);
  const avgDay = bodyView.count ? bodyView.grand / bodyView.count : 0;

  const regionOpts: { key: RegionKey; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'south', label: '南区' },
    { key: 'north', label: '北区' },
  ];
  const regionColor = (k: RegionKey) => (k === 'south' ? '#2563eb' : k === 'north' ? '#10b981' : 'var(--brand)');
  const regionName = region === 'all' ? '全部区域' : region === 'south' ? '南区' : '北区';

  /** 表格主体（卡片与弹窗共用，仅列头详细程度不同） */
  const renderTable = (
    view: ReturnType<typeof buildView>,
    opts: { full?: boolean },
  ) => (
    <div className="vb8-scroll">
      <table className="vb8-tb">
        <thead>
          <tr>
            <th className="first">日期</th>
            {nodes.map((nd, i) => (
              <th key={nd} title={nd}>
                <span className="cd" style={{ background: nodeColor(nd, i) }} />
                {opts.full ? nd : nodeShort(nd)}
              </th>
            ))}
            <th className="tot">合计</th>
          </tr>
        </thead>
        <tbody>
          {view.order.map((k, idx) => (
            <tr key={`${view.labels[k]}-${k}`} className={idx === 0 ? 'newest' : undefined}>
              <th>{view.labels[k]}</th>
              {nodes.map((nd, ri) => {
                const v = num(view.grid[ri]?.[k]);
                return <td key={`${nd}-${k}`} className={v ? '' : 'zero'}>{v || 0}</td>;
              })}
              <td className="rowtot">{fmtNum(view.colTotals[k] || 0)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>合计</th>
            {nodes.map((nd, ri) => {
              const v = view.rowTotals[ri] || 0;
              return <td key={`ft-${nd}`} className={v ? '' : 'zero'}>{fmtNum(v)}</td>;
            })}
            <td className="tot">{fmtNum(view.grand)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  return (
    <>
      <style>{CSS}</style>
      <div className="vb8-card">
        {/* 卡头：标题 + 区域分段控件 + 更多 */}
        <div className="vb8-h">
          <div className="vb8-title">
            <span className="vb8-dot" />
            <h3>流程处理</h3>
            <span className="vb8-hint">最近 {BODY_DAYS} 天</span>
          </div>

          <div className="vb8-seg" role="group" aria-label="区域筛选">
            {regionOpts.map((o) => {
              const on = region === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  className={on ? 'on' : undefined}
                  aria-pressed={on}
                  onClick={() => setRegion(o.key)}
                >
                  {o.key !== 'all' && (
                    <span className="sw" style={{ background: regionColor(o.key) }} />
                  )}
                  {o.label}
                </button>
              );
            })}
          </div>

          <button type="button" className="vb8-more" onClick={() => setMoreOpen(true)}>
            近 30 日明细 ›
          </button>
        </div>

        <div className="vb8-b">
          {!hasData ? (
            <div className="vb8-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无流程处理数据" /></div>
          ) : bodyView.missing ? (
            <div className="vb8-empty" style={{ padding: '20px 0' }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<span style={{ fontSize: 12, color: 'var(--text2)' }}>该区域明细数据待后端提供</span>}
              />
            </div>
          ) : (
            <>
              {renderTable(bodyView, { full: false })}
              <div className="vb8-foot">
                <span className="k">近 {bodyView.count} 日累计 <b>{fmtNum(bodyView.grand)}</b> 家</span>
                <span className="k">日均 <b>{avgDay ? avgDay.toFixed(1) : '0'}</b> 家</span>
                <span className="k">单日最高 <b>{fmtNum(maxDay)}</b> 家</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* F2/F3/F4：更多 → 近 30 日，行=日期（倒序） 列=节点 */}
      <Modal
        title={`流程处理明细 · ${regionName}（最近 ${modalView.count || MODAL_DAYS} 日）`}
        open={moreOpen}
        onCancel={() => setMoreOpen(false)}
        footer={null}
        width={isMobile ? '96vw' : 1180}
        styles={{ body: { paddingTop: 8 } }}
      >
        <div className="vb8-pop" style={MODAL_VARS[mode === 'dark' ? 'dark' : 'light']}>
          {!modalView.count || modalView.missing ? (
            <Empty description={modalView.missing ? '该区域明细数据待后端提供' : '暂无数据'} />
          ) : (
            <>
              {renderTable(modalView, { full: true })}
              <div className="vb8-popnote">
                口径：单元格 = 该日期完成到该流程节点的客户数（数据源 jdywh_parsed_16 节点完成时间列）；
                末列「合计」= 该日全部节点合计，末行「合计」= 该节点近 {modalView.count} 日累计。
                卡片正文显示最近 {BODY_DAYS} 日，本弹窗显示最近 {modalView.count} 日，日期均倒序。
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
