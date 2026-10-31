/** 客户运行情况（6 组指标）— V8.1
 *
 * V8.1 变更（契约 §四 G —— 视觉均衡）：
 *  G1 解决「有些卡数据多、有些卡数据少」：
 *     重排指标组合，让 **6 张卡每张恰好 2 行指标**（改造前是 2/2/1/1/2/2，两张卡填充率仅 42.7%）：
 *       1) 有开通策略   = 连锁数 + 策略数
 *       2) 有运行策略   = 连锁数 + 策略数
 *       3) 到店 / 核销  = 触达到店率 + 优惠券核销率   ← 合并原两张单行卡
 *       4) 转化销售     = 转化销售额 + 人均转化销售
 *       5) 触达 / 发券  = 触达人数 + 优惠券发放人数
 *       6) 成本 / ROI   = 成本合计 + 营销ROI          ← 新增，取 row7.cost
 *  G2 卡内容器 `.vb9-item{flex:1}` 均分高度，配合 6 卡等高 → 填充率 100%，留白均匀
 *  G3 沿用 V7.1 字号规则：合计 22px/750，南区北区 12.5px/600
 *
 * 数据：data.row7（含 cost 指标组；口径见 V7 契约 §2.4）
 */
import React, { useMemo } from 'react';
import { Empty, Tooltip } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import type { BoardData, Row7Data, SplitValue } from '@/api/crm-board';
import { REGION_COLORS } from '@/api/crm-board';
import { fmtMoney, fmtNum, fmtPct } from './theme';

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
  lines: Line[];
}

/* ── 语义色（契约 §三）：南区 #2563eb / 北区 #10b981 ── */
const SOUTH = REGION_COLORS['南区'] || '#2563eb';
const NORTH = REGION_COLORS['北区'] || '#10b981';

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pair(p?: Partial<SplitValue> | null): { total: number; south: number; north: number } {
  return { total: num(p?.total), south: num(p?.south), north: num(p?.north) };
}

function format(v: number, fmt: Fmt): string {
  if (fmt === 'pct') return fmtPct(v);
  if (fmt === 'money') return fmtMoney(v);
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
.vb9-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease;height:100%;min-width:0}
.vb9-h{padding:12px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;flex-wrap:wrap;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb9-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb9-dot{width:6px;height:6px;border-radius:2px;background:var(--cyan);box-shadow:0 0 0 3px color-mix(in srgb,var(--cyan) 16%,transparent);flex-shrink:0}
.vb9-hint{font-size:11px;color:var(--text3);font-weight:550;white-space:nowrap;display:flex;align-items:center;gap:8px}
.vb9-hint .s{color:var(--vb9-south);font-weight:700}
.vb9-hint .n{color:var(--vb9-north);font-weight:700}
.vb9-b{padding:12px 16px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}

/* 1920 → 6 列一行；≤1366 降列 */
.vb9-grid{display:grid;gap:10px;grid-template-columns:repeat(6,minmax(0,1fr));align-items:stretch}
@media(max-width:1366px){.vb9-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:1024px){.vb9-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:640px){.vb9-grid{grid-template-columns:1fr}}

/* G2：6 卡等高 + 卡内两行指标均分高度（fill = 100%） */
.vb9-grp{background:var(--panel2);border:1px solid var(--line);border-radius:var(--radius-sm);padding:10px 11px 11px;min-width:0;height:100%;display:flex;flex-direction:column;gap:7px;transition:border-color .18s,background .18s}
.vb9-grp:hover{border-color:var(--brand3);background:var(--brandSoft)}
.vb9-gt{display:flex;align-items:center;gap:5px;min-width:0;flex-shrink:0}
.vb9-gt .t{font-size:12px;font-weight:680;color:var(--text);line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb9-q{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;flex-shrink:0;cursor:help;color:var(--text3);font-size:12px;line-height:1;transition:color .15s,transform .15s}
.vb9-q:hover{color:var(--brand);transform:scale(1.12)}

/* G2/G3：每行指标 flex:1 撑满剩余高度，内容垂直居中 */
.vb9-body{flex:1;display:flex;flex-direction:column;gap:0;min-height:0}
.vb9-item{flex:1;display:flex;flex-direction:column;justify-content:center;gap:1px;min-width:0;padding:4px 0}
.vb9-item + .vb9-item{border-top:1px dashed var(--line)}
.vb9-lbl{font-size:10.5px;color:var(--text3);font-weight:600;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb9-num{font-size:22px;font-weight:750;color:var(--text);line-height:1.15;letter-spacing:-.3px;white-space:nowrap;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}
.vb9-regs{display:flex;align-items:center;gap:10px;flex-wrap:wrap;line-height:1.3}
.vb9-regs span{font-size:12.5px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
.vb9-regs span i{font-style:normal;font-size:10.5px;font-weight:600;opacity:.8;margin-right:2px}
.vb9-regs .s{color:var(--vb9-south)}
.vb9-regs .n{color:var(--vb9-north)}
.vb9-empty{padding:34px 0}

@media(max-width:1366px){
  /* 降列后卡变宽，数字可略放大保持视觉重量 */
  .vb9-num{font-size:24px}
}
`;

export default function RunMetrics({ data, loading, isMobile }: RunMetricsProps) {
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

    /* G1：6 张卡 × 每张 2 行，行数完全一致 */
    return [
      {
        key: 'opened',
        title: '有开通策略',
        tip: '开通策略数 > 0 的连锁数，以及这些连锁累计开通的策略条数（mail_30 最新 1 日）',
        lines: [mk('连锁数', opened?.chains, 'num'), mk('策略数', opened?.strategies, 'num')],
      },
      {
        key: 'running',
        title: '有运行策略',
        tip: '运行策略数 > 0 的连锁数，以及这些连锁累计运行的策略条数',
        lines: [mk('连锁数', running?.chains, 'num'), mk('策略数', running?.strategies, 'num')],
      },
      {
        key: 'rate',
        title: '到店 / 核销',
        tip: '触达到店率 = 到店人数 ÷ 发送人数；优惠券核销率 = 用券人数 ÷ 发券人数。比率是派生值，南北区各按自身分子分母计算',
        lines: [mk('触达到店率', r7.reachRate, 'pct'), mk('优惠券核销率', r7.couponRate, 'pct')],
      },
      {
        key: 'conversion',
        title: '转化销售',
        tip: '转化销售额 = 到店会员产生的销售额；人均转化销售 = 转化销售额 ÷ 到店人数',
        lines: [mk('转化销售额', conv, 'money'), mk('人均转化销售', conv?.perCapita, 'money')],
      },
      {
        key: 'people',
        title: '触达 / 发券人数',
        tip: '触达人数 = 发送会员数；优惠券发放人数 = 已发券会员数',
        lines: [mk('触达人数', r7.people?.reached, 'num'), mk('优惠券发放人数', r7.people?.couponIssued, 'num')],
      },
      {
        key: 'cost',
        title: '成本 / ROI',
        tip: '成本合计 = 渠道成本 + 用券成本；营销ROI = 成本合计 ÷ 转化销售额（占销售额比重，越低越省钱）',
        lines: [
          mk('成本合计', cost?.totalCost, 'money'),
          { label: '营销ROI', total: roi.total, south: roi.south, north: roi.north, fmt: 'pct' },
        ],
      },
    ];
  }, [r7]);

  const hasData = groups.length > 0;

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
          <span className="vb9-hint">
            <span className="s">南区</span>
            <span className="n">北区</span>
          </span>
        </div>
        <div className="vb9-b">
          {!hasData ? (
            <div className="vb9-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行数据" /></div>
          ) : (
            <div className="vb9-grid">
              {groups.map((g) => (
                <div key={g.key} className="vb9-grp">
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
                        <div className="vb9-lbl" title={ln.label}>{ln.label}</div>
                        <div className="vb9-num">{format(ln.total, ln.fmt)}</div>
                        <div className="vb9-regs">
                          <span className="s"><i>南</i>{format(ln.south, ln.fmt)}</span>
                          <span className="n"><i>北</i>{format(ln.north, ln.fmt)}</span>
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
