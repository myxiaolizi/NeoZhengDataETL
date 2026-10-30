/** 第 8 排：策略模型 / 类型 · 分区域运行情况 — V7.0
 *
 * V7 变更（契约 §八 F4）：
 *  1. 布局改「树形/链接图」：左侧策略模块卡（含模块汇总）—连线/箭头→ 右侧各策略类型卡（含各自数据）
 *  2. 每个指标除 南区/北区 外新增「合计」列
 *  3. 标题栏后增加日期按钮：默认「近 30 日」，支持 本周/上周/本月/上月；
 *     顶部全局日期筛选变化时自动同步。筛选列为「策略开通&触达时间」c_41f1cc4881。
 *     数据按区间优先取 row8.byRange / row8.ranges / data.row8ByRange（后端提供）；
 *     缺区间数据时回退最新快照并在 UI 显式标注，绝不伪造。
 *  4. 新增 4 个成本指标：渠道成本 c_783814dcb3、用券成本 c_81f128a3b7、
 *     成本合计 = 渠道成本 + 用券成本、营销ROI = 成本合计 ÷ 转化销售额。
 *
 * 数据：data.row8.items[].{south,north,total}（Row7Data；口径见契约 §八 F1）
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Empty } from 'antd';
import type { BoardData, MetricPair, ModelTypeItem, Row7Data } from '@/api/crm-board';
import { REGION_COLORS } from '@/api/crm-board';
import { fmtMoney, fmtNum, fmtPct } from './theme';

export interface RunBreakdownProps {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

/* ── V7 语义色（契约 §2.1）：南区蓝 #2563eb、北区绿 #10b981 ── */
const V7_SOUTH = '#2563eb';
const V7_NORTH = '#10b981';
const SOUTH = REGION_COLORS?.['南区'] && REGION_COLORS['南区'] !== '#45B4FF' ? REGION_COLORS['南区'] : V7_SOUTH;
const NORTH = REGION_COLORS?.['北区'] && REGION_COLORS['北区'] !== '#FFC000' ? REGION_COLORS['北区'] : V7_NORTH;

type Fmt = 'num' | 'pct' | 'money' | 'ratio';

interface MetricDef {
  key: string;
  title: string;
  tip: string;
  fmt: Fmt;
}

/** 10 个指标（含 4 个成本指标） */
const METRICS: MetricDef[] = [
  { key: 'opened', title: '开通策略数', tip: '策略开通&触达时间当日，此连锁开通该类策略的条数', fmt: 'num' },
  { key: 'running', title: '运行策略数', tip: '当日此连锁该类策略有多少条触达会员（不可按日累加）', fmt: 'num' },
  { key: 'reached', title: '触达人数', tip: '策略触达（发送）的会员人数', fmt: 'num' },
  { key: 'reachRate', title: '到店率', tip: '到店人数 ÷ 发送人数', fmt: 'pct' },
  { key: 'couponRate', title: '优惠券核销率', tip: '用券人数 ÷ 发券人数', fmt: 'pct' },
  { key: 'conversion', title: '转化销售额', tip: '触达会员产生的销售额（T+30 口径）', fmt: 'money' },
  { key: 'channelCost', title: '渠道成本', tip: '渠道成本（c_783814dcb3）', fmt: 'money' },
  { key: 'couponCost', title: '用券成本', tip: '用券成本（c_81f128a3b7）', fmt: 'money' },
  { key: 'totalCost', title: '成本合计', tip: '成本合计 = 渠道成本 + 用券成本', fmt: 'money' },
  { key: 'roi', title: '营销ROI', tip: '营销ROI = 成本合计 ÷ 转化销售额（数值越低越省钱）', fmt: 'ratio' },
];

/* ── 日期区间（F4-3） ── */
interface PresetDef {
  key: string;
  label: string;
}
const PRESETS: PresetDef[] = [
  { key: 'last30', label: '近 30 日' },
  { key: 'thisWeek', label: '本周' },
  { key: 'lastWeek', label: '上周' },
  { key: 'thisMonth', label: '本月' },
  { key: 'lastMonth', label: '上月' },
];
/** 与顶部全局日期筛选（meta.filters.datePreset）同步的取值 */
const SYNC_KEYS = new Set(['thisWeek', 'lastWeek', 'thisMonth', 'lastMonth']);

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 区域对象里取「自身」值：区域对象的 total 即该区域聚合值，用 south/north 兜底容错 */
function val(p: { south?: number; north?: number; total?: number } | null | undefined): number {
  if (!p) return 0;
  const t = num(p.total);
  if (t !== 0) return t;
  return num(p.south) || num(p.north);
}

/** 成本四件套：优先读后端字段，缺则用能拿到的部分推算，全部缺失为 0 */
interface CostExt {
  channelCost?: number;
  couponCost?: number;
  totalCost?: number;
  roi?: number;
}
type LooseR7 = Partial<Row7Data> & CostExt & {
  conversion?: Partial<Row7Data['conversion']> & CostExt;
};

interface Costs {
  channelCost: number;
  couponCost: number;
  totalCost: number;
  /** null = 转化销售额为 0，无法计算 */
  roi: number | null;
}

function costs(r: LooseR7 | undefined, conversion: number): Costs {
  const channelCost = num(r?.conversion?.channelCost ?? r?.channelCost);
  const couponCost = num(r?.conversion?.couponCost ?? r?.couponCost);
  const rawTotal = r?.conversion?.totalCost ?? r?.totalCost;
  const totalCost = rawTotal === undefined || rawTotal === null
    ? channelCost + couponCost
    : num(rawTotal);
  const rawRoi = r?.conversion?.roi ?? r?.roi;
  let roi: number | null;
  if (rawRoi !== undefined && rawRoi !== null && Number.isFinite(Number(rawRoi))) {
    roi = num(rawRoi);
  } else {
    roi = conversion > 0 ? totalCost / conversion : null;
  }
  return { channelCost, couponCost, totalCost, roi };
}

/** 从任一区域对象取指标值 */
function metricValue(metric: string, r: LooseR7 | undefined): number {
  switch (metric) {
    case 'opened': return val(r?.openedStrategy?.strategies);
    case 'running': return val(r?.runningStrategy?.strategies);
    case 'reached': return val(r?.people?.reached);
    case 'reachRate': return val(r?.reachRate);
    case 'couponRate': return val(r?.couponRate);
    case 'conversion': return val(r?.conversion);
    default: return 0;
  }
}

function fmtValue(metric: string, r: LooseR7 | undefined): string {
  const def = METRICS.find((m) => m.key === metric);
  if (!def) return '-';
  if (metric === 'channelCost' || metric === 'couponCost' || metric === 'totalCost' || metric === 'roi') {
    const c = costs(r, val(r?.conversion));
    if (metric === 'channelCost') return fmtMoney(c.channelCost);
    if (metric === 'couponCost') return fmtMoney(c.couponCost);
    if (metric === 'totalCost') return fmtMoney(c.totalCost);
    return c.roi === null ? '—' : fmtNum(c.roi, 3);
  }
  const v = metricValue(metric, r);
  if (def.fmt === 'pct') return fmtPct(v);
  if (def.fmt === 'money') return fmtMoney(v);
  return fmtNum(v);
}

interface TypeNode {
  key: string;
  type: string;
  total: LooseR7;
  south: LooseR7;
  north: LooseR7;
}

interface ModuleNode {
  model: string;
  types: TypeNode[];
  /** 模块汇总（各类型合计相加） */
  agg: {
    types: number;
    opened: number;
    running: number;
    reached: number;
    conversion: number;
    totalCost: number;
    roi: number | null;
  };
}

/** 区间数据容器：后端可能给数组、{items} 或 {items,label} */
type ItemsHolder = ModelTypeItem[] | { items?: ModelTypeItem[]; label?: string } | undefined | null;

function pickItems(holder: ItemsHolder): ModelTypeItem[] | null {
  if (!holder) return null;
  if (Array.isArray(holder)) return holder.length ? holder : null;
  const arr = (holder as { items?: ModelTypeItem[] }).items;
  return Array.isArray(arr) ? arr : null;
}

function pickLabel(holder: ItemsHolder): string {
  if (!holder || Array.isArray(holder)) return '';
  return String((holder as { label?: string }).label || '');
}

/** 解析当前预设对应的 items：区间数据优先，缺失回退最新快照 */
function resolveRange(
  data: BoardData,
  preset: string,
): { items: ModelTypeItem[]; fromRange: boolean; label: string } {
  const root = data as unknown as {
    row8ByRange?: Record<string, ItemsHolder>;
    row8?: {
      items?: ModelTypeItem[];
      label?: string;
      byRange?: Record<string, ItemsHolder>;
      ranges?: Record<string, ItemsHolder>;
    };
  };
  const holders: ItemsHolder[] = [
    root?.row8ByRange?.[preset],
    root?.row8?.byRange?.[preset],
    root?.row8?.ranges?.[preset],
  ];
  for (const h of holders) {
    const items = pickItems(h);
    if (items) return { items, fromRange: true, label: pickLabel(h) };
  }
  const fallback = Array.isArray(root?.row8?.items) ? (root.row8?.items ?? []) : [];
  return { items: fallback, fromRange: false, label: String(root?.row8?.label || '') };
}

/* ══════════════ 局部样式（vb10- 前缀） ══════════════ */
const CSS = `
.vb10-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;min-width:0}
.vb10-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}
.vb10-h{padding:13px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0;flex-wrap:wrap;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb10-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
.vb10-dot{width:6px;height:6px;border-radius:2px;background:var(--purple);box-shadow:0 0 0 3px color-mix(in srgb,var(--purple) 16%,transparent);flex-shrink:0}
.vb10-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0}
.vb10-hint{font-size:11px;color:var(--text3);font-weight:550;white-space:nowrap;display:flex;align-items:center;gap:6px}
.vb10-hint .s{color:var(--vb10-south);font-weight:700}
.vb10-hint .n{color:var(--vb10-north);font-weight:700}

/* 日期按钮（F4-3） */
.vb10-pills{display:inline-flex;align-items:center;gap:4px;background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:3px}
.vb10-pill{border:0;background:transparent;color:var(--text2);font-size:11px;font-weight:600;line-height:1;padding:5px 9px;border-radius:7px;cursor:pointer;white-space:nowrap;transition:all .15s;font-family:inherit}
.vb10-pill:hover{color:var(--brand);background:color-mix(in srgb,var(--brand) 8%,transparent)}
.vb10-pill.on{background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;box-shadow:0 2px 7px color-mix(in srgb,var(--brand) 30%,transparent)}
.vb10-src{font-size:10.5px;color:var(--text3);white-space:nowrap}
.vb10-src.warn{color:var(--warn);font-weight:600}

.vb10-b{padding:14px 16px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}

/* 树形布局：模块 → 连线 → 类型 */
.vb10-tree{display:flex;flex-direction:column;gap:14px}
.vb10-mod{display:flex;align-items:stretch;gap:0;min-width:0}
.vb10-rail{flex:0 0 186px;width:186px;background:var(--panel2);border:1px solid var(--line);border-radius:var(--radius-sm);padding:11px 12px;display:flex;flex-direction:column;gap:8px;min-width:0;position:relative}
.vb10-rail::after{content:'';position:absolute;right:-1px;top:10px;bottom:10px;width:3px;border-radius:3px;background:linear-gradient(180deg,var(--purple),color-mix(in srgb,var(--purple) 10%,transparent))}
.vb10-rail-t{font-size:13px;font-weight:750;color:var(--text);line-height:1.3;word-break:break-all}
.vb10-rail-sub{font-size:10.5px;color:var(--text3);font-weight:600}
.vb10-rail-kv{display:grid;grid-template-columns:1fr auto;gap:3px 6px;font-size:11px;color:var(--text2)}
.vb10-rail-kv b{font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;text-align:right}

/* 连线列 */
.vb10-link{flex:0 0 30px;width:30px;position:relative;display:flex;align-items:center;justify-content:center}
.vb10-link::before{content:'';position:absolute;left:50%;top:16px;bottom:16px;width:2px;transform:translateX(-50%);border-radius:2px;background:linear-gradient(180deg,var(--purple),color-mix(in srgb,var(--purple) 20%,transparent));opacity:.45}
.vb10-link i{position:relative;width:0;height:0;border-left:9px solid color-mix(in srgb,var(--purple) 72%,transparent);border-top:6px solid transparent;border-bottom:6px solid transparent;display:block}

.vb10-types{flex:1;min-width:0;display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(286px,1fr));align-content:start}
.vb10-type{background:var(--panel2);border:1px solid var(--line);border-radius:var(--radius-sm);padding:10px 11px;min-width:0;transition:all .18s}
.vb10-type:hover{border-color:var(--brand3);background:var(--brandSoft)}
.vb10-type-t{font-size:12px;font-weight:720;color:var(--text);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px}
.vb10-type-t .arrow{font-size:10px;color:var(--purple);opacity:.75;flex-shrink:0}
.vb10-mrows{display:grid;grid-template-columns:minmax(0,1.25fr) repeat(3,minmax(0,.9fr));column-gap:6px;margin-top:7px}
.vb10-th{font-size:10px;color:var(--text3);font-weight:650;padding:2px 0;text-align:right;white-space:nowrap;cursor:help}
.vb10-th.l{text-align:left}
.vb10-th.s{color:var(--vb10-south)}
.vb10-th.n{color:var(--vb10-north)}
.vb10-lb{font-size:11px;color:var(--text2);padding:2.5px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:help}
.vb10-v{font-size:11.5px;font-weight:700;color:var(--text);padding:2.5px 0;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.vb10-v.s{color:var(--vb10-south)}
.vb10-v.n{color:var(--vb10-north)}
.vb10-divider{grid-column:1/-1;height:1px;background:var(--line2);margin:1px 0}
.vb10-empty{padding:34px 0}

@media(max-width:760px){
  .vb10-h{align-items:flex-start;padding:12px 13px}
  .vb10-hd{width:100%;flex-wrap:wrap;row-gap:6px}
  .vb10-pills{flex-wrap:wrap;row-gap:3px}
  .vb10-pill{padding:5px 8px}
  .vb10-hint{white-space:normal;line-height:1.5}
  .vb10-src{white-space:normal;line-height:1.55}
  .vb10-b{padding:12px 13px}
  .vb10-mod{flex-direction:column}
  .vb10-rail{flex:0 0 auto;width:100%}
  .vb10-rail::after{right:10px;left:10px;top:auto;bottom:-1px;width:auto;height:3px}
  .vb10-link{flex:0 0 22px;width:100%;height:22px}
  .vb10-link::before{left:16px;top:0;bottom:0;width:2px;height:auto;transform:none}
  .vb10-link i{border-left:0;border-top:9px solid color-mix(in srgb,var(--purple) 72%,transparent);border-left:6px solid transparent;border-right:6px solid transparent;position:absolute;top:50%;left:16px;transform:translate(-50%,-50%)}
  .vb10-types{grid-template-columns:1fr}
}
/* 兜底：任何宽度下都不让标题栏/说明文字撑破卡片 */
.vb10-hd,.vb10-pills,.vb10-hint,.vb10-src{min-width:0}
`;

export default function RunBreakdown({ data, loading, isMobile }: RunBreakdownProps) {
  /** 当前区间：默认近 30 日 */
  const [preset, setPreset] = useState<string>('last30');

  /** 顶部全局日期筛选变化时同步到此（F4-3）
   *  - 全局选 本周/上周/本月/上月 → 同步到同名按钮
   *  - 全局选 全部/今日/昨日/自定义 → 回到本板块默认「近 30 日」
   */
  const globalPreset = String(data?.meta?.filters?.datePreset || 'all');
  useEffect(() => {
    setPreset(SYNC_KEYS.has(globalPreset) ? globalPreset : 'last30');
  }, [globalPreset]);

  const resolved = useMemo(() => resolveRange(data, preset), [data, preset]);
  const items = resolved.items;

  const modules = useMemo<ModuleNode[]>(() => {
    const map = new Map<string, ModuleNode>();
    items.forEach((it: ModelTypeItem, i) => {
      const model = String(it?.model ?? '') || '未分类';
      const typeName = String(it?.type ?? '') || '未分类';
      let m = map.get(model);
      if (!m) {
        m = {
          model,
          types: [],
          agg: { types: 0, opened: 0, running: 0, reached: 0, conversion: 0, totalCost: 0, roi: null },
        };
        map.set(model, m);
      }
      const total = (it?.total ?? {}) as LooseR7;
      m.types.push({
        key: `${model}|${typeName}|${i}`,
        type: typeName,
        total,
        south: (it?.south ?? {}) as LooseR7,
        north: (it?.north ?? {}) as LooseR7,
      });
      const conv = val(total?.conversion);
      m.agg.types += 1;
      m.agg.opened += metricValue('opened', total);
      m.agg.running += metricValue('running', total);
      m.agg.reached += metricValue('reached', total);
      m.agg.conversion += conv;
      m.agg.totalCost += costs(total, conv).totalCost;
    });
    const list = Array.from(map.values());
    list.forEach((m) => {
      m.agg.roi = m.agg.conversion > 0 ? m.agg.totalCost / m.agg.conversion : null;
    });
    return list;
  }, [items]);

  const typeCount = modules.reduce((a, m) => a + m.types.length, 0);
  const activeLabel = (PRESETS.find((p) => p.key === preset) || PRESETS[0]).label;

  return (
    <>
      <style>{CSS}</style>
      <div
        className="vb10-card"
        style={{
          ['--vb10-south' as string]: SOUTH,
          ['--vb10-north' as string]: NORTH,
        } as React.CSSProperties}
      >
        <div className="vb10-h">
          <h3>
            <span className="vb10-dot" />
            策略模型 / 类型 · 分区域运行情况
          </h3>
          <div className="vb10-hd">
            {/* 日期按钮（F4-3），筛选列：策略开通&触达时间 */}
            <div className="vb10-pills" role="group" aria-label="日期区间">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`vb10-pill${preset === p.key ? ' on' : ''}`}
                  aria-pressed={preset === p.key}
                  onClick={() => setPreset(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <span className="vb10-hint">
              {fmtNum(modules.length)} 个模块 · {fmtNum(typeCount)} 个类型 ·
              <span className="s">南</span>/<span className="n">北</span>
            </span>
          </div>
        </div>

        <div className="vb10-b">
          <div className="vb10-src" style={{ marginBottom: 8 }}>
            区间：{activeLabel} · 筛选列「策略开通&amp;触达时间」
            {resolved.fromRange
              ? resolved.label ? ` · ${resolved.label}` : ''
              : <span className="vb10-src warn">　（该区间数据待后端返回，当前展示最新快照）</span>}
          </div>

          {!typeCount ? (
            <div className="vb10-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无策略模型数据" /></div>
          ) : (
            <div className="vb10-tree">
              {modules.map((m) => (
                <div className="vb10-mod" key={m.model}>
                  {/* 左：模块节点（含汇总） */}
                  <div className="vb10-rail">
                    <div className="vb10-rail-t" title={m.model}>{m.model}</div>
                    <div className="vb10-rail-sub">{fmtNum(m.agg.types)} 个策略类型 · 模块汇总</div>
                    <div className="vb10-rail-kv">
                      <span>开通策略</span><b>{fmtNum(m.agg.opened)}</b>
                      <span>运行策略</span><b>{fmtNum(m.agg.running)}</b>
                      <span>触达人数</span><b>{fmtNum(m.agg.reached)}</b>
                      <span>转化销售额</span><b>{fmtMoney(m.agg.conversion)}</b>
                      <span>成本合计</span><b>{fmtMoney(m.agg.totalCost)}</b>
                      <span>营销ROI</span><b>{m.agg.roi === null ? '—' : fmtNum(m.agg.roi, 3)}</b>
                    </div>
                  </div>

                  {/* 中：连线 + 箭头 */}
                  <div className="vb10-link" aria-hidden="true"><i /></div>

                  {/* 右：各策略类型节点 */}
                  <div className="vb10-types">
                    {m.types.map((t) => (
                      <div className="vb10-type" key={t.key}>
                        <div className="vb10-type-t" title={t.type}>
                          <span className="arrow">▸</span>
                          {t.type}
                        </div>
                        <div className="vb10-mrows">
                          <div className="vb10-th l">指标</div>
                          <div className="vb10-th">合计</div>
                          <div className="vb10-th s">南区</div>
                          <div className="vb10-th n">北区</div>
                          <div className="vb10-divider" />
                          {METRICS.map((md) => (
                            <React.Fragment key={md.key}>
                              <div className="vb10-lb" title={md.tip}>{md.title}</div>
                              <div className="vb10-v" title={md.tip}>{fmtValue(md.key, t.total)}</div>
                              <div className="vb10-v s">{fmtValue(md.key, t.south)}</div>
                              <div className="vb10-v n">{fmtValue(md.key, t.north)}</div>
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
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
