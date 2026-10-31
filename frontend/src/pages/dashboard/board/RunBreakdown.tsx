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

/* ── 语义色（契约 §三，统一从 REGION_COLORS 取，不本地新造色值）
 *    图形用 REGION_COLORS；12px 文字在深色下对比度不足，故单独用 token 覆盖（见 CSS 末尾） ── */
const SOUTH = REGION_COLORS['南区'] || 'var(--brand)';
const NORTH = REGION_COLORS['北区'] || 'var(--green)';

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
.vb10-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease;min-width:0}
.vb10-h{padding:12px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0;flex-wrap:wrap}
.vb10-h h3{font-size:var(--fs-sm);font-weight:var(--fw-bold);color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
.vb10-dot{width:6px;height:6px;border-radius:2px;background:var(--purple);box-shadow:0 0 0 3px color-mix(in srgb,var(--purple) 16%,transparent);flex-shrink:0}
.vb10-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0;min-width:0}
.vb10-range{font-size:var(--fs-2xs);color:var(--text3);font-weight:var(--fw-medium);white-space:nowrap}
.vb10-hint{font-size:var(--fs-2xs);color:var(--text3);font-weight:var(--fw-medium);white-space:nowrap;display:flex;align-items:center;gap:5px}
.vb10-hint .s{color:var(--south,var(--brand));font-weight:var(--fw-bold)}
.vb10-hint .n{color:var(--north,var(--green));font-weight:var(--fw-bold)}

.vb10-b{padding:12px 16px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0;align-items:stretch;gap:11px}

/* 黄色提示：去掉重边框，只留淡底色（不抢视线） */
.vb10-notice{display:flex;align-items:center;gap:7px;font-size:var(--fs-2xs);font-weight:var(--fw-medium);color:var(--warn);line-height:1.5;background:color-mix(in srgb,var(--warn) 7%,transparent);border-radius:var(--radius-sm);padding:6px 10px}
.vb10-notice .ic{flex-shrink:0;font-size:var(--fs-xs)}

/* ── 树形三层：模块（高） → 类型（中） → 指标矩阵（低） ── */
.vb10-tree{display:flex;flex-direction:column;gap:12px}
.vb10-mod{display:flex;align-items:flex-start;gap:0;min-width:0}

/* 层1 模块卡：白底 + 紫色左竖条 + 深色标题；渐变降到几乎不可见。
 * 高度改为「内容驱动」—— 4 个类型的模块曾被拉到 782px 出现大片空白 */
.vb10-rail{flex:0 0 200px;width:200px;align-self:flex-start;background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--purple);border-radius:var(--radius-sm);display:flex;flex-direction:column;min-width:0;overflow:hidden;transition:border-color .18s,box-shadow .18s}
.vb10-rail:hover{border-color:color-mix(in srgb,var(--purple) 42%,var(--line));border-left-color:var(--purple);box-shadow:0 2px 10px color-mix(in srgb,var(--purple) 10%,transparent)}
.vb10-rail-hd{padding:10px 12px 9px;border-bottom:1px solid var(--line2);background:linear-gradient(180deg,color-mix(in srgb,var(--purple) 6%,transparent),transparent);display:flex;flex-direction:column;gap:5px;flex-shrink:0}
.vb10-rail-t{font-size:var(--fs-sm);font-weight:var(--fw-heavy);color:var(--text);line-height:1.3;letter-spacing:.2px;word-break:break-all}
.vb10-rail-pill{display:inline-flex;align-items:center;gap:4px;align-self:flex-start;font-size:var(--fs-2xs);font-weight:var(--fw-medium);color:var(--purple);background:color-mix(in srgb,var(--purple) 10%,transparent);border-radius:999px;padding:0 8px;line-height:1.7;white-space:nowrap}
.vb10-rail-pill b{font-size:var(--fs-2xs);font-weight:var(--fw-heavy)}

.vb10-rail-mx{display:grid;grid-template-columns:1fr 1fr;gap:12px 10px;padding:12px;align-content:start;min-height:0}
.vb10-rail-cell{display:flex;flex-direction:column;gap:1px;min-width:0;padding:3px 0}
.vb10-rail-cell .k{font-size:var(--fs-2xs);color:var(--text2);font-weight:var(--fw-normal);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb10-rail-cell .v{font-size:var(--fs-md);font-weight:var(--fw-bold);color:var(--text);line-height:1.2;letter-spacing:-.2px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb10-rail-cell.hi .v{color:var(--purple)}

/* 连线：细、淡；高度跟随模块卡内容区 */
.vb10-link{flex:0 0 22px;width:22px;position:relative;display:flex;align-items:center;justify-content:center;align-self:stretch;min-height:120px}
/* 类型区与模块卡顶对齐，避免模块卡被拉长 */
.vb10-types{align-content:start}
.vb10-link::before{content:'';position:absolute;left:50%;top:16px;bottom:16px;width:1px;transform:translateX(-50%);background:color-mix(in srgb,var(--purple) 26%,transparent)}
.vb10-link i{position:relative;width:0;height:0;border-left:6px solid color-mix(in srgb,var(--purple) 45%,transparent);border-top:5px solid transparent;border-bottom:5px solid transparent;display:block}

/* 层2 类型卡：淡色底，更轻的框 */
.vb10-types{flex:1;min-width:0;display:grid;gap:9px;grid-template-columns:repeat(auto-fit,minmax(460px,1fr));align-items:start}
.vb10-type{background:var(--panel2);border:1px solid var(--line2);border-radius:var(--radius-sm);padding:9px 11px 10px;min-width:0;transition:border-color .16s,background .16s}
.vb10-type:hover{border-color:var(--line);background:color-mix(in srgb,var(--brand) 3%,var(--panel2))}
.vb10-type-t{font-size:var(--fs-xs);font-weight:var(--fw-bold);color:var(--text);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px;margin-bottom:5px}
.vb10-type-t .arrow{font-size:var(--fs-2xs);color:var(--purple);opacity:.55;flex-shrink:0}

/* 层3 指标矩阵：行=合计/南区/北区，列=10 指标；去边框靠对齐 */
.vb10-mx{display:grid;grid-template-columns:44px repeat(10,minmax(0,1fr));column-gap:3px;row-gap:0;align-items:center}
.vb10-mx .mh{font-size:var(--fs-2xs);color:var(--text2);font-weight:var(--fw-normal);text-align:right;padding:0 2px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:help;border-bottom:1px solid var(--line)}
.vb10-mx .mh.r{text-align:left;padding-left:0}
.vb10-mx .rh{font-size:var(--fs-2xs);font-weight:var(--fw-medium);padding:4px 3px 4px 0;white-space:nowrap;color:var(--text2)}
.vb10-mx .rh.s{color:var(--south,var(--brand));font-weight:var(--fw-bold)}
.vb10-mx .rh.n{color:color-mix(in srgb,var(--north,var(--green)) 80%,var(--text));font-weight:var(--fw-bold)}
.vb10-mx .rh.t{color:var(--text);font-weight:var(--fw-bold)}
.vb10-mx .mc{font-size:12px;font-weight:600;text-align:right;padding:3px 4px;white-space:nowrap;font-variant-numeric:tabular-nums;border-top:1px solid var(--line2);overflow:visible;min-width:62px}
/* 12px 区域文字：--north 绿在浅底对比度仅 3.6，与 --text 混合加深到 ≥4.5（只用令牌） */
.vb10-mx .mc.s{color:var(--south,var(--brand))}
.vb10-mx .mc.n{color:color-mix(in srgb,var(--north,var(--green)) 80%,var(--text))}
/* 合计行：字号最大 + 字重最重 + 颜色最深，与南北区形成明确主次 */
.vb10-mx .mc.t{font-size:var(--fs-md);font-weight:var(--fw-heavy);color:var(--text);letter-spacing:-.2px;padding-top:2px;padding-bottom:5px}
.vb10-mx .rh.t{padding-top:2px;padding-bottom:5px}
/* 只在合计行下保留一条极淡分组线，其余靠对齐 */
.vb10-mx .mc.t,.vb10-mx .rh.t{border-bottom:1px solid var(--line2)}
.vb10-zero{color:var(--text3)!important;border-bottom:1px dashed color-mix(in srgb,var(--warn) 50%,transparent);cursor:help}
.vb10-empty{padding:34px 0}

@media(max-width:1100px){
  .vb10-types{grid-template-columns:1fr}
  .vb10-mx{grid-template-columns:52px repeat(10,minmax(64px,1fr));overflow-x:auto;overflow-y:hidden;padding-bottom:2px}
}
@media(max-width:760px){
  .vb10-h{align-items:flex-start}
  .vb10-hd{width:100%;flex-wrap:wrap;row-gap:5px}
  .vb10-hint,.vb10-range{white-space:normal;line-height:1.5}
  .vb10-b{padding:11px 12px}
  .vb10-mod{flex-direction:column;align-items:stretch}
  .vb10-rail{flex:0 0 auto;width:100%;align-self:stretch}
  .vb10-rail-mx{grid-template-columns:repeat(3,1fr);gap:10px}
  .vb10-link{flex:0 0 18px;width:100%;height:18px;align-self:auto}
  .vb10-link::before{left:15px;top:0;bottom:0;width:1px;height:auto;transform:none}
  .vb10-link i{border-left:0;border-top:6px solid color-mix(in srgb,var(--purple) 45%,transparent);border-left:5px solid transparent;border-right:5px solid transparent;position:absolute;top:50%;left:15px;transform:translate(-50%,-50%)}
  .vb10-types{grid-template-columns:1fr}
  .vb10-mx{grid-template-columns:46px repeat(10,minmax(64px,1fr))}
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
