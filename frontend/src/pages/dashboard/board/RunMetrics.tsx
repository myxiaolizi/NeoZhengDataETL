/** 第 7 排：客户运行情况（5 组指标，每组都含 合计 / 南区 / 北区）
 *
 * 数据：data.row7
 *  1) openedStrategy  有开通策略连锁数 + 策略数   (ChainStrategyMetric)
 *  2) runningStrategy 有运行策略连锁数 + 策略数   (ChainStrategyMetric)
 *  3) reachRate / couponRate  触达到店率 + 优惠券核销率  (RateMetric, 0~1 → fmtPct)
 *  4) conversion  转化销售额 (AmountMetric) + 人均转化销售 (perCapita)
 *  5) people  触达人数 + 优惠券发放人数 (PeopleMetric)
 *
 * 口径见 _work/V5-CONTRACT.md §3.2 第 11~13 条。
 */
import React, { useMemo } from 'react';
import { Card, Empty } from 'antd';
import type { BoardData, MetricPair, Row7Data } from '@/api/crm-board';
import { fmtMoney, fmtNum, fmtPct } from './theme';

const C_SOUTH = '#45B4FF';
const C_NORTH = '#FFC000';

/** 契约 §7.2：CSS 变量优先；变量未注入时回退 antd v6 主题变量，保证明暗都可读 */
const T_MAIN = 'var(--text-main, var(--ant-color-text, #003378))';
const T_SUB = 'var(--text-sub, var(--ant-color-text-secondary, rgba(0,51,120,.66)))';
const BORDER = 'var(--border, var(--ant-color-border, rgba(54,135,255,.28)))';
const BG_CARD = 'var(--bg-card, var(--ant-color-bg-container, #FFFFFF))';
const BG_SUB = 'var(--bg-card-2, var(--ant-color-fill-quaternary, rgba(54,135,255,.035)))';

export interface RunMetricsProps {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

type Fmt = 'num' | 'pct' | 'money';

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
  hint?: string;
  lines: Line[];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pair(p?: Partial<MetricPair> | null): MetricPair {
  return { total: num(p?.total), south: num(p?.south), north: num(p?.north) };
}

function format(v: number, fmt: Fmt): string {
  if (fmt === 'pct') return fmtPct(v);
  if (fmt === 'money') return fmtMoney(v);
  return fmtNum(v);
}

export default function RunMetrics({ data, loading, isMobile }: RunMetricsProps) {
  const r7 = data?.row7 as Row7Data | undefined;

  const groups = useMemo<Group[]>(() => {
    if (!r7) return [];
    const openedChains = pair(r7.openedStrategy?.chains);
    const openedStrats = pair(r7.openedStrategy?.strategies);
    const runChains = pair(r7.runningStrategy?.chains);
    const runStrats = pair(r7.runningStrategy?.strategies);
    const reach = pair(r7.reachRate);
    const coupon = pair(r7.couponRate);
    const conv = pair(r7.conversion);
    const perCapita = pair(r7.conversion?.perCapita);
    const reached = pair(r7.people?.reached);
    const couponIssued = pair(r7.people?.couponIssued);

    const mk = (label: string, p: MetricPair, fmt: Fmt): Line => ({
      label, total: p.total, south: p.south, north: p.north, fmt,
    });

    return [
      {
        key: 'opened',
        title: '有开通策略',
        hint: '开通策略数 > 0 的连锁',
        lines: [
          mk('连锁数', openedChains, 'num'),
          mk('策略数', openedStrats, 'num'),
        ],
      },
      {
        key: 'running',
        title: '有运行策略',
        hint: '运行策略数 > 0 的连锁',
        lines: [
          mk('连锁数', runChains, 'num'),
          mk('策略数', runStrats, 'num'),
        ],
      },
      {
        key: 'rate',
        title: '到店率 / 核销率',
        hint: '到店÷发送 · 用券÷发券',
        lines: [
          mk('触达到店率', reach, 'pct'),
          mk('优惠券核销率', coupon, 'pct'),
        ],
      },
      {
        key: 'conversion',
        title: '转化销售',
        hint: '销售额 ÷ 到店人数',
        lines: [
          mk('转化销售额', conv, 'money'),
          mk('人均转化销售', perCapita, 'money'),
        ],
      },
      {
        key: 'people',
        title: '触达 / 发券人数',
        hint: '发送人数与发券人数',
        lines: [
          mk('触达人数', reached, 'num'),
          mk('优惠券发放人数', couponIssued, 'num'),
        ],
      },
    ];
  }, [r7]);

  const headCell: React.CSSProperties = {
    fontSize: isMobile ? 11 : 11.5,
    color: T_SUB,
    fontWeight: 500,
    padding: '2px 0',
    textAlign: 'right',
    whiteSpace: 'nowrap',
  };
  const labelCell: React.CSSProperties = {
    fontSize: isMobile ? 12 : 12.5,
    color: T_SUB,
    padding: '3px 0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
  const valCell = (color: string, strong = false): React.CSSProperties => ({
    fontSize: strong ? (isMobile ? 14 : 15) : (isMobile ? 12.5 : 13),
    fontWeight: strong ? 700 : 600,
    color,
    padding: '3px 0',
    textAlign: 'right',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  });

  const hasData = groups.length > 0;

  return (
    <Card
      variant="outlined"
      loading={loading && !r7}
      style={{ background: BG_CARD, border: `1px solid ${BORDER}`, borderRadius: 12, height: '100%' }}
      styles={{ body: { padding: isMobile ? 12 : 16 } }}
      title={<span style={{ fontSize: 14, fontWeight: 600, color: T_MAIN }}>客户运行情况</span>}
      extra={<span style={{ fontSize: 12, color: T_SUB }}>汇总 · 南区 · 北区</span>}
    >
      {!hasData ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行数据" style={{ padding: '48px 0' }} />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(196px, 1fr))',
            gap: isMobile ? 8 : 12,
          }}
        >
          {groups.map((g) => (
            <div
              key={g.key}
              style={{
                background: BG_SUB,
                border: `1px solid ${BORDER}`,
                borderRadius: 10,
                padding: isMobile ? 10 : 12,
                minWidth: 0,
              }}
            >
              <div style={{ fontSize: isMobile ? 12.5 : 13, fontWeight: 600, color: T_MAIN, lineHeight: 1.4 }}>
                {g.title}
              </div>
              {g.hint && (
                <div style={{ fontSize: 10.5, color: T_SUB, marginTop: 1, lineHeight: 1.4 }}>{g.hint}</div>
              )}

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr) minmax(0, .8fr) minmax(0, .8fr)',
                  columnGap: 6,
                  marginTop: 8,
                }}
              >
                <div style={{ ...headCell, textAlign: 'left' }}>指标</div>
                <div style={headCell}>合计</div>
                <div style={{ ...headCell, color: C_SOUTH }}>南区</div>
                <div style={{ ...headCell, color: C_NORTH }}>北区</div>

                {g.lines.map((ln) => (
                  <React.Fragment key={ln.label}>
                    <div style={labelCell} title={ln.label}>{ln.label}</div>
                    <div style={valCell(T_MAIN, true)}>{format(ln.total, ln.fmt)}</div>
                    <div style={valCell(C_SOUTH)}>{format(ln.south, ln.fmt)}</div>
                    <div style={valCell(C_NORTH)}>{format(ln.north, ln.fmt)}</div>
                  </React.Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
