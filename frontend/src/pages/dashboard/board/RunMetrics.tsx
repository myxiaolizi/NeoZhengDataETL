/** 客户运行情况（6 组指标）— V10 视觉重构
 *
 * V10 变更（纯视觉，不改数据口径与交互）：
 *  R6-1 金额 ≥ 10000 → 「万元」并保留 1 位小数（本地 fmtMoneyWan，不改 theme.ts）
 *       例：¥1,045,541 → 104.6万；¥12,340 → 1.2万；¥9,800 → ¥9,800（原样）
 *  R6-2 南北区数据条**铺满整行**：轨道 width:100%，南/北段按 s/(s+n) 与 n/(s+n) 的百分比宽度分配。
 *       （历史：早期版本按原始比值分配空间，比率类指标两段之和 <1 时轨道留白，
 *        实测只填 41.3% / 2.9% / 0.7%；改用百分比宽度后恒为 100%。）
 *  R6-3 指标名移到数字**右侧下方**：数字 22px/750 在左上，指标名 11px var(--text2) 基线对齐在其右下方。
 *  V9.2 保留：统一面板 + gap:1px 分隔线、6 格等高、顶部 3px 语义色条、悬停浅色底。
 *
 * 数据：data.row7（含 cost 指标组；口径见 V7 契约 §2.4）
 */
import React, { useMemo } from 'react';
import { Empty, Tooltip } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import type { BoardData, Row7Data, SplitValue } from '@/api/crm-board';
import { REGION_COLORS } from '@/api/crm-board';
import { fmtNum, fmtPct } from './theme';

export interface RunMetricsProps {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

type Fmt = 'num' | 'pct' | 'money';

/** 一行指标：合计 + 南北（无未知） */
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
  /** 名称后 ! 图标的 Tooltip 文案 */
  tip: string;
  /** V9.2：该指标的语义强调色（只用令牌） */
  accent: string;
  lines: Line[];
}

/* ── 语义色（契约 §三，统一从 REGION_COLORS 取，不本地新造色值）
 *    图形（进度条/圆点）用 REGION_COLORS 保持品牌识别；
 *    12px 文字在深浅两套背景下都必须可读，故文字色改用主题令牌。 ── */
const SOUTH = REGION_COLORS['南区'] || 'var(--brand)';
const NORTH = REGION_COLORS['北区'] || 'var(--green)';

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pair(p?: Partial<SplitValue> | null): { total: number; south: number; north: number } {
  return { total: num(p?.total), south: num(p?.south), north: num(p?.north) };
}

/** R6-1：金额格式化 —— ≥ 10000 用「万元」保留 1 位小数，否则原样 ¥ 千分位
 *  ¥1,045,541 → 104.6万 | ¥12,340 → 1.2万 | ¥9,800 → ¥9,800 | ¥10,000 → 1.0万
 *  （theme.ts 不在本组件写作用域内，故在此本地实现，语义与其 fmtMoney 一致） */
export function fmtMoneyWan(v: number | null | undefined): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '¥0';
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return `¥${fmtNum(n, 0)}`;
}

function format(v: number, fmt: Fmt): string {
  if (fmt === 'pct') return fmtPct(v);
  if (fmt === 'money') return fmtMoneyWan(v);
  return fmtNum(v);
}

/** 营销ROI = 成本合计 ÷ 转化销售额
 *  后端 `cost.roi` 只有 2 位小数（小比值会被舍成 0），故前端按精确值重算，
 *  后端值仅在无法重算时兜底。*/
function buildRoi(r7: Row7Data | undefined): { total: number; south: number; north: number } {
  const c = r7?.cost;
  const conv = pair(r7?.conversion);
  const cost = pair(c?.totalCost);
  const pick = (key: 'total' | 'south' | 'north') => {
    const cv = conv[key];
    if (cv > 0) return cost[key] / cv;
    const fallback = num(c?.roi?.[key]);
    return fallback;
  };
  return { total: pick('total'), south: pick('south'), north: pick('north') };
}

/* ══════════════ 局部样式（vb9- 前缀） ══════════════ */
const CSS = `
.vb9-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease;height:100%;min-width:0}
.vb9-h{padding:12px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0;flex-wrap:wrap}
.vb9-h h3{font-size:var(--fs-sm);font-weight:var(--fw-bold);color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb9-dot{width:6px;height:6px;border-radius:2px;background:var(--cyan);box-shadow:0 0 0 3px color-mix(in srgb,var(--cyan) 16%,transparent);flex-shrink:0}
/* 图例：两个带点的小标签 */
.vb9-legend{display:flex;align-items:center;gap:12px;flex-shrink:0}
.vb9-legend span{display:inline-flex;align-items:center;gap:5px;font-size:var(--fs-2xs);font-weight:var(--fw-medium);color:var(--text2);white-space:nowrap}
.vb9-legend i{width:7px;height:7px;border-radius:2px;flex-shrink:0}
.vb9-legend .s i{background:var(--vb9-south)}
.vb9-legend .n i{background:var(--vb9-north)}

.vb9-b{padding:0;flex:1;display:flex;flex-direction:column;min-width:0}

/* V1：统一面板 —— gap:1px + line2 底 = 内部分隔线，6 格等高 */
.vb9-panel{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:1px;background:var(--line2);flex:1;min-width:0}

/* V2：单元格 —— 顶部 3px 语义色条 + 3% 同色底
   V10：底部内距收到 5px，让内容撑到 95%+ 填充率（原 12px 只剩 92.9%） */
.vb9-cell{position:relative;display:flex;flex-direction:column;gap:7px;padding:13px 13px 5px;background:var(--panel);min-width:0;transition:background .16s ease}
.vb9-cell::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--ac);opacity:.9}
.vb9-cell:hover{background:color-mix(in srgb,var(--ac) 6%,var(--panel))}

/* 标题行 */
.vb9-gt{display:flex;align-items:center;gap:5px;min-width:0;flex-shrink:0}
.vb9-gt .t{font-size:var(--fs-xs);font-weight:var(--fw-bold);color:var(--text2);line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb9-q{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;flex-shrink:0;cursor:help;color:var(--text3);font-size:var(--fs-2xs);line-height:1;transition:color .15s}
.vb9-q:hover{color:var(--ac)}

/* 指标主体：两行均分剩余高度 → 填充率拉满 */
.vb9-body{flex:1;display:flex;flex-direction:column;min-height:0}
.vb9-item{flex:1;display:flex;flex-direction:column;justify-content:center;gap:5px;min-width:0}
.vb9-item + .vb9-item{border-top:1px solid var(--line2)}

/* R6-3：数字左上（22px/750） + 指标名在其右侧下方（11px --text2，基线对齐） */
.vb9-top{display:flex;align-items:baseline;gap:7px;min-width:0}
.vb9-num{font-size:var(--fs-xl);font-weight:var(--fw-heavy);color:var(--text);line-height:1.08;letter-spacing:-.4px;white-space:nowrap;font-variant-numeric:tabular-nums;flex-shrink:0}
/* 指标名 11px：--text3 在深色底(#141e33)上对比度仅 4.21，改用 --text2（≥7.5） */
.vb9-lbl{font-size:var(--fs-2xs);font-weight:var(--fw-normal);color:var(--text2);line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;padding-bottom:2px}

/* 南北区数值行 */
.vb9-regs{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}
.vb9-regs .rg{display:inline-flex;align-items:baseline;gap:3px;white-space:nowrap;flex-shrink:0;font-variant-numeric:tabular-nums;line-height:1.25}
.vb9-regs .rg i{font-style:normal;font-size:var(--fs-2xs);font-weight:var(--fw-normal);color:var(--text2)}
.vb9-regs .rg b{font-size:var(--fs-xs);font-weight:var(--fw-bold)}
/* 12px 区域文字：用 Board.tsx 的 --south / --north（明暗自适应）；图形仍用 REGION_COLORS 保品牌识别。
 *   --north 绿在浅底上对比度仅 3.77，与 --text 混合加深到 ≥4.5（只用令牌，不新造色值） */
.vb9-regs .s b{color:var(--south,var(--brand))}
.vb9-regs .n b{color:color-mix(in srgb,var(--north,var(--green)) 80%,var(--text))}

/* R6-2：轨道铺满整行；南/北段用百分比宽度，二者之和恒为 100%
 *  ⚠️ 不要改回按原始比值分配空间的做法：比率类指标的南北值都 <1（如 0.144 / 0.269），
 *     按比值分空间时两段之和 <1，轨道会留下大段空白（实测只填 41.3% / 2.9% / 0.7%）。 */
.vb9-track{display:flex;width:100%;height:7px;border-radius:99px;background:var(--line2);overflow:hidden;flex-shrink:0}
.vb9-track.empty{background:var(--line)}
.vb9-track .seg{display:block;height:100%;flex:0 0 auto;min-width:0}
.vb9-track .seg.s{background:var(--vb9-south)}
.vb9-track .seg.n{background:var(--vb9-north)}
.vb9-empty{padding:34px 0}

/* 断点：6 → 3 → 2 → 1，分隔线由 gap 自动生成，无需改边框 */
@media(max-width:1440px){.vb9-panel{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:1024px){.vb9-panel{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:640px){.vb9-panel{grid-template-columns:1fr}.vb9-cell{padding:12px 12px 6px}}
`;

export default function RunMetrics({ data, isMobile }: RunMetricsProps) {
  const r7 = data?.row7 as Row7Data | undefined;

  const groups = useMemo<Group[]>(() => {
    if (!r7) return [];
    const mk = (label: string, p: Partial<SplitValue> | null | undefined, fmt: Fmt): Line => {
      const v = pair(p);
      return { label, total: v.total, south: v.south, north: v.north, fmt };
    };

    const opened = r7.openedStrategy;
    const running = r7.runningStrategy;
    const conv = r7.conversion;
    const cost = r7.cost;
    const roi = buildRoi(r7);

    /* 6 张卡 × 每张 2 行，行数完全一致；accent 为语义强调色（仅令牌） */
    return [
      {
        key: 'opened',
        title: '有开通策略',
        tip: '开通策略数 > 0 的连锁数，以及这些连锁累计开通的策略条数（mail_30 最新 1 日）',
        accent: 'var(--brand)',
        lines: [mk('连锁数', opened?.chains, 'num'), mk('策略数', opened?.strategies, 'num')],
      },
      {
        key: 'running',
        title: '有运行策略',
        tip: '运行策略数 > 0 的连锁数，以及这些连锁累计运行的策略条数',
        accent: 'var(--cyan)',
        lines: [mk('连锁数', running?.chains, 'num'), mk('策略数', running?.strategies, 'num')],
      },
      {
        key: 'rate',
        title: '到店 / 核销',
        tip: '触达到店率 = 到店人数 ÷ 发送人数；优惠券核销率 = 用券人数 ÷ 发券人数。比率是派生值，南北区各按自身分子分母计算',
        accent: 'var(--purple)',
        lines: [mk('触达到店率', r7.reachRate, 'pct'), mk('优惠券核销率', r7.couponRate, 'pct')],
      },
      {
        key: 'conversion',
        title: '转化销售',
        tip: '转化销售额 = 到店会员产生的销售额；人均转化销售 = 转化销售额 ÷ 到店人数',
        accent: 'var(--green)',
        lines: [mk('转化销售额', conv, 'money'), mk('人均转化销售', conv?.perCapita, 'money')],
      },
      {
        key: 'people',
        title: '触达 / 发券人数',
        tip: '触达人数 = 发送会员数；优惠券发放人数 = 已发券会员数',
        accent: 'var(--pink)',
        lines: [mk('触达人数', r7.people?.reached, 'num'), mk('优惠券发放人数', r7.people?.couponIssued, 'num')],
      },
      {
        key: 'cost',
        title: '成本 / ROI',
        tip: '成本合计 = 渠道成本 + 用券成本；营销ROI = 成本合计 ÷ 转化销售额（占销售额比重，越低越省钱）',
        accent: 'var(--warn)',
        lines: [
          mk('成本合计', cost?.totalCost, 'money'),
          { label: '营销ROI', total: roi.total, south: roi.south, north: roi.north, fmt: 'pct' },
        ],
      },
    ];
  }, [r7]);

  const hasData = groups.length > 0;

  /** R6-2 + R6-3：南北区数值一行 + 铺满整行的双色占比条 */
  const renderSplit = (ln: Line) => {
    const s = ln.south;
    const n = ln.north;
    const sum = s + n;
    const empty = !(sum > 0);
    /* 百分比宽度：南 + 北 恒等于 100%（空轨时都不渲染） */
    const southPct = empty ? 0 : (Math.max(s, 0) / sum) * 100;
    const northPct = empty ? 0 : (Math.max(n, 0) / sum) * 100;
    return (
      <>
        <div className="vb9-regs">
          <span className="rg s"><i>南</i><b>{format(s, ln.fmt)}</b></span>
          <span className="rg n"><i>北</i><b>{format(n, ln.fmt)}</b></span>
        </div>
        <span className={`vb9-track${empty ? ' empty' : ''}`} aria-hidden="true">
          {!empty && <i className="seg s" style={{ width: `${southPct}%` }} />}
          {!empty && <i className="seg n" style={{ width: `${northPct}%` }} />}
        </span>
      </>
    );
  };

  return (
    <>
      <style>{CSS}</style>
      <div
        className="vb9-card"
        style={{
          ['--vb9-south' as string]: SOUTH,
          ['--vb9-north' as string]: NORTH,
        } as React.CSSProperties}
      >
        <div className="vb9-h">
          <h3>
            <span className="vb9-dot" />
            客户运行情况
          </h3>
          <div className="vb9-legend">
            <span className="s"><i />南区</span>
            <span className="n"><i />北区</span>
          </div>
        </div>
        <div className="vb9-b">
          {!hasData ? (
            <div className="vb9-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行数据" /></div>
          ) : (
            <div className="vb9-panel">
              {groups.map((g) => (
                <div
                  key={g.key}
                  className="vb9-cell"
                  style={{ ['--ac' as string]: g.accent } as React.CSSProperties}
                >
                  <div className="vb9-gt">
                    <span className="t" title={g.title}>{g.title}</span>
                    <Tooltip title={g.tip} placement="top" overlayStyle={{ maxWidth: 280 }}>
                      <span className="vb9-q" aria-label={`${g.title} 说明`}>
                        <ExclamationCircleOutlined />
                      </span>
                    </Tooltip>
                  </div>

                  <div className="vb9-body">
                    {g.lines.map((ln) => (
                      <div className="vb9-item" key={ln.label}>
                        {/* R6-3：数字在左，指标名在其右侧下方 */}
                        <div className="vb9-top">
                          <span className="vb9-num">{format(ln.total, ln.fmt)}</span>
                          <span className="vb9-lbl" title={ln.label}>{ln.label}</span>
                        </div>
                        {renderSplit(ln)}
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
