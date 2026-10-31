/** 策略运行情况 — V8.1
 *
 * V8.1 变更（契约 §四 H —— 前 3 个模块卡美化）：
 *  H1 左侧「策略模块」卡重构（改造前：散排的文字列表，填充率 58.5% / 直观上留白多）：
 *     - 顶部：品牌紫渐变标题区（模块名白字加粗 + 类型数胶囊），形成视觉锚点
 *     - 主体：2 列 × 3 行「大数字 + 小标签」指标网格（开通/运行/触达/转化/成本/ROI）
 *     - `.vb10-rail-mx{flex:1;align-content:space-evenly}` → 随右侧类型卡高度自动撑满，无大片空白
 *     - 与右侧类型卡的 panel2 底 + line 描边风格统一，紫色竖线保留作模块标识
 *
 * 沿用 V7.1 已验收项：
 *  H2 黄色提示「当前 T+30 转化数据不全，数据会随时间而增长。」
 *  H3 转置矩阵（行=合计/南区/北区 × 列=10 指标），右侧无空白
 *  H4 渠道成本=0 但触达>0 → Tooltip 说明，不补数据
 *  H5 合计数字大于南北区
 *
 * 数据：data.row8（items / modules / range / rowCount）
 */
import React, { useMemo } from 'react';
import { Empty, Tooltip } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import type { BoardData, Row7Data, SplitValue } from '@/api/crm-board';
import { REGION_COLORS } from '@/api/crm-board';
import { fmtMoney, fmtNum, fmtPct } from './theme';

export interface RunBreakdownProps {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

/* ── 语义色（契约 §三） ── */
const SOUTH = REGION_COLORS['南区'] || '#2563eb';
const NORTH = REGION_COLORS['北区'] || '#10b981';

type Fmt = 'num' | 'pct' | 'money' | 'ratio';

interface MetricDef {
  key: string;
  title: string;
  short: string;
  tip: string;
  fmt: Fmt;
}

/** 10 个指标（含 4 个成本指标） */
const METRICS: MetricDef[] = [
  { key: 'opened', title: '开通策略数', short: '开通策略', tip: '策略开通&触达时间当日，此连锁开通该类策略的条数', fmt: 'num' },
  { key: 'running', title: '运行策略数', short: '运行策略', tip: '当日此连锁该类策略有多少条触达会员（不可按日累加）', fmt: 'num' },
  { key: 'reached', title: '触达人数', short: '触达人数', tip: '策略触达（发送）的会员人数', fmt: 'num' },
  { key: 'reachRate', title: '到店率', short: '到店率', tip: '到店人数 ÷ 发送人数', fmt: 'pct' },
  { key: 'couponRate', title: '优惠券核销率', short: '核销率', tip: '用券人数 ÷ 发券人数', fmt: 'pct' },
  { key: 'conversion', title: '转化销售额', short: '转化销售额', tip: '触达会员产生的销售额（T+30 口径）', fmt: 'money' },
  { key: 'channelCost', title: '渠道成本', short: '渠道成本', tip: '渠道成本（c_783814dcb3）', fmt: 'money' },
  { key: 'couponCost', title: '用券成本', short: '用券成本', tip: '用券成本（c_81f128a3b7）', fmt: 'money' },
  { key: 'totalCost', title: '成本合计', short: '成本合计', tip: '成本合计 = 渠道成本 + 用券成本', fmt: 'money' },
  { key: 'roi', title: '营销ROI', short: '营销ROI', tip: '营销ROI = 成本合计 ÷ 转化销售额（越低越省钱）', fmt: 'ratio' },
];

/** H2 黄色提示文案 */
const RANGE_NOTICE = '当前 T+30 转化数据不全，数据会随时间而增长。';

/** H4 Tooltip：渠道成本为 0 但有触达 */
const ZERO_COST_TIP = '该策略类型的渠道成本为 0（免费渠道或未计入），触达数据真实有效。';

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 取 SplitValue 中「该对象自身」的值：优先 total，退化到 south/north */
function val(p?: Partial<SplitValue> | null): number {
  if (!p) return 0;
  const t = num(p.total);
  if (t !== 0) return t;
  return num(p.south) || num(p.north);
}

type Region7 = Partial<Row7Data> | undefined;

interface CostGroup {
  channelCost: number;
  couponCost: number;
  totalCost: number;
  roi: number | null;
}

function costOf(r: Region7): CostGroup {
  const c = r?.cost;
  const channelCost = val(c?.channelCost);
  const couponCost = val(c?.couponCost);
  const totalCostRaw = c?.totalCost ? val(c.totalCost) : NaN;
  const totalCost = Number.isFinite(totalCostRaw) && totalCostRaw !== 0
    ? totalCostRaw
    : channelCost + couponCost;
  const conv = val(r?.conversion);
  const roiRaw = c?.roi ? val(c.roi) : NaN;
  const roi = Number.isFinite(roiRaw) && roiRaw !== 0
    ? roiRaw
    : (conv > 0 ? totalCost / conv : null);
  return { channelCost, couponCost, totalCost, roi };
}

function metricOf(key: string, r: Region7): number {
  switch (key) {
    case 'opened': return val(r?.openedStrategy?.strategies);
    case 'running': return val(r?.runningStrategy?.strategies);
    case 'reached': return val(r?.people?.reached);
    case 'reachRate': return val(r?.reachRate);
    case 'couponRate': return val(r?.couponRate);
    case 'conversion': return val(r?.conversion);
    case 'channelCost': return costOf(r).channelCost;
    case 'couponCost': return costOf(r).couponCost;
    case 'totalCost': return costOf(r).totalCost;
    case 'roi': {
      const v = costOf(r).roi;
      return v === null ? NaN : v;
    }
    default: return 0;
  }
}

function fmtOf(key: string, v: number): string {
  if (!Number.isFinite(v)) return '—';
  const def = METRICS.find((m) => m.key === key);
  if (!def) return fmtNum(v);
  if (def.fmt === 'pct') return fmtPct(v);
  if (def.fmt === 'money') return fmtMoney(v);
  if (def.fmt === 'ratio') return fmtNum(v, 3);
  return fmtNum(v);
}

/* ══════════════ 局部样式（vb10- 前缀） ══════════════ */
const CSS = `
.vb10-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease;min-width:0}
.vb10-h{padding:12px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0;flex-wrap:wrap;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb10-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
.vb10-dot{width:6px;height:6px;border-radius:2px;background:var(--purple);box-shadow:0 0 0 3px color-mix(in srgb,var(--purple) 16%,transparent);flex-shrink:0}
.vb10-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0;min-width:0}
.vb10-range{font-size:11px;color:var(--text3);font-weight:600;white-space:nowrap}
.vb10-hint{font-size:11px;color:var(--text3);font-weight:550;white-space:nowrap;display:flex;align-items:center;gap:6px}
.vb10-hint .s{color:var(--vb10-south);font-weight:700}
.vb10-hint .n{color:var(--vb10-north);font-weight:700}

.vb10-b{padding:12px 16px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0;align-items:stretch;gap:10px}

/* 黄色提示 */
.vb10-notice{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:var(--warn);line-height:1.5;background:color-mix(in srgb,var(--warn) 9%,transparent);border:1px solid color-mix(in srgb,var(--warn) 26%,transparent);border-radius:9px;padding:6px 10px}
.vb10-notice .ic{flex-shrink:0;font-size:12px}

/* 树形：模块 → 连线 → 类型 */
.vb10-tree{display:flex;flex-direction:column;gap:12px}
.vb10-mod{display:flex;align-items:stretch;gap:0;min-width:0}

/* ── H1 模块卡重构：渐变标题区 + 大数字指标网格，自动撑满高度 ── */
.vb10-rail{flex:0 0 196px;width:196px;background:var(--panel2);border:1px solid var(--line);border-radius:var(--radius-sm);display:flex;flex-direction:column;min-width:0;overflow:hidden;align-self:stretch;transition:border-color .18s,box-shadow .18s}
.vb10-rail:hover{border-color:var(--purple);box-shadow:0 4px 14px color-mix(in srgb,var(--purple) 16%,transparent)}
.vb10-rail-hd{padding:9px 11px 10px;background:linear-gradient(135deg,color-mix(in srgb,var(--purple) 88%,#1a1030),color-mix(in srgb,var(--purple) 55%,var(--brand)));display:flex;flex-direction:column;gap:5px;flex-shrink:0;position:relative}
.vb10-rail-hd::after{content:'';position:absolute;right:0;top:0;bottom:0;width:3px;background:rgba(255,255,255,.28)}
.vb10-rail-t{font-size:13px;font-weight:750;color:#fff;line-height:1.3;letter-spacing:.2px;word-break:break-all;text-shadow:0 1px 2px rgba(0,0,0,.18)}
.vb10-rail-pill{display:inline-flex;align-items:center;gap:4px;align-self:flex-start;font-size:10px;font-weight:700;color:#fff;background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.3);border-radius:999px;padding:1px 8px;line-height:1.55;white-space:nowrap}
.vb10-rail-pill b{font-size:11px;font-weight:800}

.vb10-rail-mx{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:0 8px;padding:8px 11px;align-content:space-evenly;min-height:0}
.vb10-rail-cell{display:flex;flex-direction:column;gap:0;min-width:0;padding:2px 0}
.vb10-rail-cell .k{font-size:9.5px;color:var(--text3);font-weight:650;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb10-rail-cell .v{font-size:14.5px;font-weight:750;color:var(--text);line-height:1.2;letter-spacing:-.2px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb10-rail-cell.hi .v{color:var(--purple)}

/* 连线列 */
.vb10-link{flex:0 0 26px;width:26px;position:relative;display:flex;align-items:center;justify-content:center;align-self:stretch}
.vb10-link::before{content:'';position:absolute;left:50%;top:14px;bottom:14px;width:2px;transform:translateX(-50%);border-radius:2px;background:linear-gradient(180deg,var(--purple),color-mix(in srgb,var(--purple) 20%,transparent));opacity:.45}
.vb10-link i{position:relative;width:0;height:0;border-left:9px solid color-mix(in srgb,var(--purple) 72%,transparent);border-top:6px solid transparent;border-bottom:6px solid transparent;display:block}

/* 类型卡自适应拉伸，避免右侧空白 */
.vb10-types{flex:1;min-width:0;display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(470px,1fr));align-items:start}
.vb10-type{background:var(--panel2);border:1px solid var(--line);border-radius:var(--radius-sm);padding:9px 10px;min-width:0;transition:border-color .18s,background .18s}
.vb10-type:hover{border-color:var(--brand3);background:var(--brandSoft)}
.vb10-type-t{font-size:12px;font-weight:720;color:var(--text);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px;margin-bottom:6px}
.vb10-type-t .arrow{font-size:10px;color:var(--purple);opacity:.75;flex-shrink:0}

/* 转置矩阵：行 = 合计/南区/北区，列 = 指标 */
.vb10-mx{display:grid;grid-template-columns:54px repeat(10,minmax(0,1fr));column-gap:2px;row-gap:0;align-items:center}
.vb10-mx .mh{font-size:9.5px;color:var(--text3);font-weight:650;text-align:right;padding:2px 2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:help}
.vb10-mx .mh.r{text-align:left;padding-left:0}
.vb10-mx .rh{font-size:10.5px;font-weight:700;padding:3px 4px 3px 0;white-space:nowrap;border-top:1px solid var(--line2)}
.vb10-mx .rh.s{color:var(--vb10-south)}
.vb10-mx .rh.n{color:var(--vb10-north)}
.vb10-mx .rh.t{color:var(--text);border-top:0}
.vb10-mx .mc{font-size:11px;font-weight:600;text-align:right;padding:3px 2px;white-space:nowrap;font-variant-numeric:tabular-nums;border-top:1px solid var(--line2);overflow:hidden;text-overflow:ellipsis}
.vb10-mx .mc.s{color:var(--vb10-south)}
.vb10-mx .mc.n{color:var(--vb10-north)}
/* 合计行更大更明显 */
.vb10-mx .mc.t{font-size:13px;font-weight:750;color:var(--text);border-top:0}
.vb10-mx .rh.t{padding-top:2px;padding-bottom:4px}
.vb10-zero{color:var(--text3);border-bottom:1px dashed color-mix(in srgb,var(--warn) 55%,transparent);cursor:help}
.vb10-empty{padding:34px 0}

@media(max-width:1100px){
  .vb10-types{grid-template-columns:1fr}
  .vb10-mx{grid-template-columns:52px repeat(10,minmax(66px,1fr));overflow-x:auto;overflow-y:hidden;padding-bottom:2px}
}
@media(max-width:760px){
  .vb10-h{align-items:flex-start}
  .vb10-hd{width:100%;flex-wrap:wrap;row-gap:5px}
  .vb10-hint,.vb10-range{white-space:normal;line-height:1.5}
  .vb10-b{padding:11px 12px}
  .vb10-mod{flex-direction:column;align-items:stretch}
  .vb10-rail{flex:0 0 auto;width:100%}
  .vb10-rail-hd::after{right:10px;left:10px;top:auto;bottom:0;width:auto;height:3px}
  .vb10-rail-mx{grid-template-columns:repeat(3,1fr);gap:2px 8px}
  .vb10-link{flex:0 0 20px;width:100%;height:20px;align-self:auto}
  .vb10-link::before{left:15px;top:0;bottom:0;width:2px;height:auto;transform:none}
  .vb10-link i{border-left:0;border-top:9px solid color-mix(in srgb,var(--purple) 72%,transparent);border-left:6px solid transparent;border-right:6px solid transparent;position:absolute;top:50%;left:15px;transform:translate(-50%,-50%)}
  .vb10-types{grid-template-columns:1fr}
  .vb10-mx{grid-template-columns:46px repeat(10,minmax(66px,1fr))}
}
`;

interface TypeNode {
  key: string;
  model: string;
  type: string;
  total: Region7;
  south: Region7;
  north: Region7;
}

interface ModuleAgg {
  types: number;
  opened: number;
  running: number;
  reached: number;
  conversion: number;
  totalCost: number;
  roi: number | null;
}

interface ModuleNode {
  model: string;
  types: TypeNode[];
  agg: ModuleAgg;
}

export default function RunBreakdown({ data, loading, isMobile }: RunBreakdownProps) {
  const row8 = data?.row8;
  const items = Array.isArray(row8?.items) ? (row8?.items ?? []) : [];
  const realRange = row8?.range;
  const rowCount = num(row8?.rowCount);

  const modules = useMemo<ModuleNode[]>(() => {
    const map = new Map<string, ModuleNode>();
    items.forEach((it, i) => {
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
      const total = (it?.total ?? {}) as Region7;
      m.types.push({
        key: `${model}|${typeName}|${i}`,
        model,
        type: typeName,
        total,
        south: (it?.south ?? {}) as Region7,
        north: (it?.north ?? {}) as Region7,
      });
      const conv = metricOf('conversion', total);
      const c = costOf(total);
      m.agg.types += 1;
      m.agg.opened += metricOf('opened', total);
      m.agg.running += metricOf('running', total);
      m.agg.reached += metricOf('reached', total);
      m.agg.conversion += conv;
      m.agg.totalCost += c.totalCost;
    });
    const list = Array.from(map.values());
    list.forEach((m) => {
      m.agg.roi = m.agg.conversion > 0 ? m.agg.totalCost / m.agg.conversion : null;
    });
    return list;
  }, [items]);

  const typeCount = modules.reduce((a, m) => a + m.types.length, 0);

  const rangeText = realRange && (realRange.from || realRange.to)
    ? `${(realRange.from || '').slice(5) || '?'} ~ ${(realRange.to || '').slice(5) || '?'}`
    : '';

  /** 转置矩阵（行=合计/南区/北区，列=10 指标） */
  const renderMatrix = (t: TypeNode) => {
    const rows: { cls: string; label: string; data: Region7 }[] = [
      { cls: 't', label: '合计', data: t.total },
      { cls: 's', label: '南区', data: t.south },
      { cls: 'n', label: '北区', data: t.north },
    ];
    return (
      <div className="vb10-mx" style={{ ['--vb10-south' as string]: SOUTH, ['--vb10-north' as string]: NORTH } as React.CSSProperties}>
        <div className="mh r">区域</div>
        {METRICS.map((md) => (
          <div className="mh" key={md.key} title={md.tip}>{md.short}</div>
        ))}
        {rows.map((row) => {
          const reached = metricOf('reached', row.data);
          const channelCost = metricOf('channelCost', row.data);
          const zeroCostWarn = channelCost === 0 && reached > 0;
          return (
            <React.Fragment key={row.cls}>
              <div className={`rh ${row.cls}`}>{row.label}</div>
              {METRICS.map((md) => {
                const v = metricOf(md.key, row.data);
                const isZeroCost = md.key === 'channelCost' && zeroCostWarn;
                const text = fmtOf(md.key, v);
                const cellCls = `mc ${row.cls}${isZeroCost ? ' vb10-zero' : ''}`;
                if (isZeroCost) {
                  return (
                    <Tooltip key={md.key} title={ZERO_COST_TIP} placement="top" overlayStyle={{ maxWidth: 260 }}>
                      <div className={cellCls}>{text}</div>
                    </Tooltip>
                  );
                }
                return (
                  <div className={cellCls} key={md.key} title={`${md.title}：${text}`}>{text}</div>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  /** H1 模块卡（重构）：渐变标题 + 大数字指标网格，随高度自动撑满 */
  const renderRail = (m: ModuleNode) => {
    const cells: { k: string; v: string; hi?: boolean; title: string }[] = [
      { k: '开通策略', v: fmtNum(m.agg.opened), title: `${m.agg.opened} 条` },
      { k: '运行策略', v: fmtNum(m.agg.running), title: `${m.agg.running} 条` },
      { k: '触达人数', v: fmtNum(m.agg.reached), title: `${m.agg.reached} 人` },
      { k: '转化销售额', v: fmtMoney(m.agg.conversion), title: `¥${fmtNum(m.agg.conversion, 2)}` },
      { k: '成本合计', v: fmtMoney(m.agg.totalCost), title: `¥${fmtNum(m.agg.totalCost, 2)}` },
      {
        k: '营销ROI',
        v: m.agg.roi === null ? '—' : fmtPct(m.agg.roi, 2),
        hi: true,
        title: m.agg.roi === null ? '无转化销售额，无法计算' : `${fmtPct(m.agg.roi, 4)}（成本合计 ÷ 转化销售额）`,
      },
    ];
    return (
      <div className="vb10-rail">
        <div className="vb10-rail-hd">
          <div className="vb10-rail-t" title={m.model}>{m.model}</div>
          <span className="vb10-rail-pill"><b>{fmtNum(m.agg.types)}</b> 个策略类型</span>
        </div>
        <div className="vb10-rail-mx">
          {cells.map((c) => (
            <div className={`vb10-rail-cell${c.hi ? ' hi' : ''}`} key={c.k}>
              <span className="k">{c.k}</span>
              <span className="v" title={c.title}>{c.v}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

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
            策略运行情况
          </h3>
          <div className="vb10-hd">
            {rangeText && (
              <span className="vb10-range">
                区间 {rangeText}
                {rowCount > 0 ? ` · ${fmtNum(rowCount)} 行明细` : ''}
              </span>
            )}
            <span className="vb10-hint">
              {fmtNum(modules.length)} 模块 · {fmtNum(typeCount)} 类型 ·
              <span className="s">南</span>/<span className="n">北</span>
            </span>
          </div>
        </div>

        <div className="vb10-b">
          <div className="vb10-notice">
            <WarningOutlined className="ic" />
            <span>{RANGE_NOTICE}</span>
          </div>

          {!typeCount ? (
            <div className="vb10-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无策略运行数据" /></div>
          ) : (
            <div className="vb10-tree">
              {modules.map((m) => (
                <div className="vb10-mod" key={m.model}>
                  {renderRail(m)}
                  <div className="vb10-link" aria-hidden="true"><i /></div>
                  <div className="vb10-types">
                    {m.types.map((t) => (
                      <div className="vb10-type" key={t.key}>
                        <div className="vb10-type-t" title={t.type}>
                          <span className="arrow">▸</span>
                          {t.type}
                        </div>
                        {renderMatrix(t)}
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
