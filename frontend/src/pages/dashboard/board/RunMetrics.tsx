/** 第 7 排：客户运行情况（6 组指标，每组含 合计 / 南区 / 北区 / 未知）— V7.0
 *
 * V7 变更（契约 §八 F2 / F3）：
 *  F2 南北相加 ≠ 合计修复：合计按全部连锁去重，南北按分区域去重，未签约连锁落在「未知」。
 *     本组件统一用 合计 = 南区 + 北区 + 未知 自洽展示；unknown 优先取后端 row7.*.chains.unknown，
 *     缺字段时用 total - south - north 兜底（口径上与后端去重结果等价）。
 *     比率类指标不可加总，未知列显示「—」并带说明。
 *  F3 描述文字改感叹号：取消卡片名称下方描述，改为名称后的 ! 图标 + Tooltip 悬停显示。
 *
 * 数据：data.row7（口径见契约 §八 F1：jdywh_mail_30 最新 1 日，汇总区间 20261001 → 统计时间）
 */
import React, { useMemo } from 'react';
import { Empty, Tooltip } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import type { BoardData, MetricPair, Row7Data } from '@/api/crm-board';
import { REGION_COLORS } from '@/api/crm-board';
import { fmtMoney, fmtNum, fmtPct } from './theme';

export interface RunMetricsProps {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

type Fmt = 'num' | 'pct' | 'money';

/** 一行指标：unknown 为 null 表示「不参与加总」（比率类） */
interface Line {
  label: string;
  total: number;
  south: number;
  north: number;
  unknown: number | null;
  fmt: Fmt;
}

interface Group {
  key: string;
  title: string;
  /** 原「名称下方描述」，V7 改为 ! 图标 Tooltip */
  tip: string;
  lines: Line[];
}

/* ── V7 语义色（契约 §2.1）：南区蓝 #2563eb、北区绿 #10b981 ──
 * 优先取 crm-board 的 REGION_COLORS（Lead 统一维护）；若该常量仍是 V5 旧值
 * （南 #45B4FF / 北 #FFC000）则回退到 V7 字面量，避免配色回退。 */
const V7_SOUTH = '#2563eb';
const V7_NORTH = '#10b981';
const V7_UNKNOWN = '#94a3b8';
const SOUTH = REGION_COLORS?.['南区'] && REGION_COLORS['南区'] !== '#45B4FF' ? REGION_COLORS['南区'] : V7_SOUTH;
const NORTH = REGION_COLORS?.['北区'] && REGION_COLORS['北区'] !== '#FFC000' ? REGION_COLORS['北区'] : V7_NORTH;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 后端可能扩展 unknown 字段；类型层不强依赖，缺失即兜底计算 */
type LoosePair = MetricPair & { unknown?: number };

interface FullPair {
  total: number;
  south: number;
  north: number;
  /** null = 不参与加总（比率类） */
  unknown: number | null;
}

/** 归一化三联值，并按需推算「未知」= 合计 − 南 − 北 */
function fullPair(p?: Partial<LoosePair> | null, additive = true): FullPair {
  const total = num(p?.total);
  const south = num(p?.south);
  const north = num(p?.north);
  if (!additive) return { total, south, north, unknown: null };
  const raw = p?.unknown;
  const unknown = raw !== undefined && raw !== null && Number.isFinite(Number(raw))
    ? num(raw)
    : Math.max(0, total - south - north);
  return { total, south, north, unknown };
}

function format(v: number | null, fmt: Fmt): string {
  if (v === null) return '—';
  if (fmt === 'pct') return fmtPct(v);
  if (fmt === 'money') return fmtMoney(v);
  return fmtNum(v);
}

/* ══════════════ 局部样式（vb9- 前缀） ══════════════ */
const CSS = `
.vb9-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;height:100%;min-width:0}
.vb9-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}
.vb9-h{padding:13px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;flex-wrap:wrap;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb9-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb9-dot{width:6px;height:6px;border-radius:2px;background:var(--cyan);box-shadow:0 0 0 3px color-mix(in srgb,var(--cyan) 16%,transparent);flex-shrink:0}
.vb9-hint{font-size:11px;color:var(--text3);font-weight:550;white-space:nowrap;display:flex;align-items:center;gap:10px}
.vb9-hint .s{color:var(--vb9-south);font-weight:700}
.vb9-hint .n{color:var(--vb9-north);font-weight:700}
.vb9-hint .u{color:var(--vb9-unk);font-weight:700}
.vb9-b{padding:14px 16px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}

/* 6 张子卡：宽屏 3 列（3+3），中屏 2 列，手机 1 列 */
.vb9-grid{display:grid;gap:12px;grid-template-columns:repeat(3,minmax(0,1fr))}
@media(max-width:1200px){.vb9-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:560px){.vb9-grid{grid-template-columns:1fr}}

.vb9-grp{background:var(--panel2);border:1px solid var(--line);border-radius:var(--radius-sm);padding:11px 12px;min-width:0;display:flex;flex-direction:column;transition:all .18s}
.vb9-grp:hover{border-color:var(--brand3);background:var(--brandSoft)}
.vb9-gt{display:flex;align-items:center;gap:5px;min-width:0}
.vb9-gt .t{font-size:12.5px;font-weight:680;color:var(--text);line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb9-q{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;flex-shrink:0;cursor:help;color:var(--text3);font-size:12px;line-height:1;transition:color .15s,transform .15s}
.vb9-q:hover{color:var(--brand);transform:scale(1.12)}

.vb9-rows{display:grid;grid-template-columns:minmax(0,1.15fr) repeat(4,minmax(0,.86fr));column-gap:5px;margin-top:9px}
.vb9-th{font-size:10.5px;color:var(--text3);font-weight:600;padding:2px 0;text-align:right;white-space:nowrap}
.vb9-th.l{text-align:left}
.vb9-th.s{color:var(--vb9-south)}
.vb9-th.n{color:var(--vb9-north)}
.vb9-th.u{color:var(--vb9-unk)}
.vb9-lb{font-size:11.5px;color:var(--text2);padding:3px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb9-v{font-size:12.5px;font-weight:700;color:var(--text);padding:3px 0;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.vb9-v.t{font-size:13px;font-weight:750}
.vb9-v.s{color:var(--vb9-south)}
.vb9-v.n{color:var(--vb9-north)}
.vb9-v.u{color:var(--vb9-unk);font-weight:650}
.vb9-divider{grid-column:1/-1;height:1px;background:var(--line2);margin:1px 0}
.vb9-foot{margin-top:11px;padding-top:9px;border-top:1px dashed var(--line);font-size:10.5px;color:var(--text3);line-height:1.5;display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.vb9-foot b{color:var(--text2);font-weight:700}
.vb9-empty{padding:34px 0}
`;

export default function RunMetrics({ data, loading, isMobile }: RunMetricsProps) {
  const r7 = data?.row7 as Row7Data | undefined;

  const groups = useMemo<Group[]>(() => {
    if (!r7) return [];
    const mk = (
      label: string,
      p: Partial<LoosePair> | null | undefined,
      fmt: Fmt,
      additive = true,
    ): Line => {
      const v = fullPair(p, additive);
      return { label, total: v.total, south: v.south, north: v.north, unknown: v.unknown, fmt };
    };

    const openedChains = r7.openedStrategy?.chains;
    const openedStrats = r7.openedStrategy?.strategies;
    const runChains = r7.runningStrategy?.chains;
    const runStrats = r7.runningStrategy?.strategies;
    const conv = r7.conversion as (Row7Data['conversion'] & Partial<LoosePair>) | undefined;

    return [
      {
        key: 'opened',
        title: '有开通策略',
        tip: '开通策略数 > 0 的连锁数，以及这些连锁累计开通的策略条数（mail_30 最新 1 日）',
        lines: [mk('连锁数', openedChains, 'num'), mk('策略数', openedStrats, 'num')],
      },
      {
        key: 'running',
        title: '有运行策略',
        tip: '运行策略数 > 0 的连锁数，以及这些连锁累计运行的策略条数；合计 = 南区 + 北区 + 未知',
        lines: [mk('连锁数', runChains, 'num'), mk('策略数', runStrats, 'num')],
      },
      {
        key: 'reach',
        title: '触达到店率',
        tip: '到店人数 ÷ 发送人数。比率是派生值，南北区分别按各自分子分母计算，不能加总',
        lines: [mk('触达到店率', r7.reachRate, 'pct', false)],
      },
      {
        key: 'coupon',
        title: '优惠券核销率',
        tip: '用券人数 ÷ 发券人数。比率是派生值，南北区分别按各自分子分母计算，不能加总',
        lines: [mk('优惠券核销率', r7.couponRate, 'pct', false)],
      },
      {
        key: 'conversion',
        title: '转化销售',
        tip: '转化销售额 = 到店会员产生的销售额；人均转化销售 = 转化销售额 ÷ 到店人数',
        lines: [mk('转化销售额', conv, 'money'), mk('人均转化销售', conv?.perCapita, 'money', false)],
      },
      {
        key: 'people',
        title: '触达 / 发券人数',
        tip: '触达人数 = 发送会员数；优惠券发放人数 = 已发券会员数',
        lines: [mk('触达人数', r7.people?.reached, 'num'), mk('优惠券发放人数', r7.people?.couponIssued, 'num')],
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
          ['--vb9-unk' as string]: V7_UNKNOWN,
        } as React.CSSProperties}
      >
        <div className="vb9-h">
          <h3>
            <span className="vb9-dot" />
            客户运行情况
          </h3>
          <span className="vb9-hint">
            <span><span className="s">南区</span> + <span className="n">北区</span> + <span className="u">未知</span> = 合计</span>
          </span>
        </div>
        <div className="vb9-b">
          {!hasData ? (
            <div className="vb9-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行数据" /></div>
          ) : (
            <>
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

                    <div className="vb9-rows">
                      <div className="vb9-th l">指标</div>
                      <div className="vb9-th">合计</div>
                      <div className="vb9-th s">南区</div>
                      <div className="vb9-th n">北区</div>
                      <div className="vb9-th u">未知</div>
                      <div className="vb9-divider" />

                      {g.lines.map((ln) => (
                        <React.Fragment key={ln.label}>
                          <div className="vb9-lb" title={ln.label}>{ln.label}</div>
                          <div className="vb9-v t">{format(ln.total, ln.fmt)}</div>
                          <div className="vb9-v s">{format(ln.south, ln.fmt)}</div>
                          <div className="vb9-v n">{format(ln.north, ln.fmt)}</div>
                          <div className="vb9-v u">{format(ln.unknown, ln.fmt)}</div>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="vb9-foot">
                <span>
                  <b>未知</b> = 合计 − 南区 − 北区（该连锁未在签约表中关联区域，无法归入南北区）；
                </span>
                <span>数据源：触达转化 by 整体（最新 1 日快照，汇总区间 20261001 → 统计时间）。</span>
                {isMobile ? null : null}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
