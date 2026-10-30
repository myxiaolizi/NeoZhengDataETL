/** 第 9 排：客户运行情况趋势（近 30 日，按「策略开通&触达时间」分组）— V7.0
 *
 * V7 变更（契约 §八 F5）：
 *  1. 筛选按钮与图例合并：只保留一处 chip 组（既是图例也是筛选，颜色即线色）
 *  2. 轴坐标自适应：左轴/右轴均不再固定从 0 开始，用 scale:true + dataMin/dataMax 兜底
 *  3. 数据修复：后端 row9 已改为按 jdywh_mail_31 的 c_41f1cc4881（策略开通&触达时间）分组，
 *     本组件不再依赖 mail_30 快照日；同时新增「有值天数」提示，便于验收确认不再大面积空白。
 *
 * 数据：data.row9（days / reached / runningChains / openedStrategies / runningStrategies / reachRate / couponRate）
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Empty, Tooltip } from 'antd';
import type { EChartsOption } from 'echarts';
import type { BoardData } from '@/api/crm-board';
import EChart from '../EChart';
import { useThemeMode } from './theme';

export interface RunTrendProps {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

type MetricKey = 'reached' | 'runningChains' | 'openedStrategies' | 'runningStrategies' | 'reachRate' | 'couponRate';

interface MetricDef {
  key: MetricKey;
  name: string;
  axis: 0 | 1;
  color: string;
  kind: 'num' | 'pct';
  tip: string;
}

/** 契约 §二 令牌色，按顺序分配 6 条线 */
const SERIES = ['#3b82f6', '#10b981', '#06b6d4', '#f59e0b', '#8b5cf6', '#ef4444'];

const METRICS: MetricDef[] = [
  { key: 'reached', name: '触达人数', axis: 0, color: SERIES[0], kind: 'num', tip: '当日按策略开通&触达时间统计的触达会员数' },
  { key: 'runningChains', name: '运行连锁数', axis: 0, color: SERIES[1], kind: 'num', tip: '当日有运行策略的连锁数（去重）' },
  { key: 'openedStrategies', name: '开通策略数', axis: 0, color: SERIES[2], kind: 'num', tip: '当日开通的策略条数' },
  { key: 'runningStrategies', name: '运行策略数', axis: 0, color: SERIES[3], kind: 'num', tip: '当日运行的策略条数（同策略每天可能重复运行，不可跨日累加）' },
  { key: 'reachRate', name: '到店率', axis: 1, color: SERIES[4], kind: 'pct', tip: '到店人数 ÷ 发送人数（右轴，百分比）' },
  { key: 'couponRate', name: '优惠券核销率', axis: 1, color: SERIES[5], kind: 'pct', tip: '用券人数 ÷ 发券人数（右轴，百分比）' },
];

const ALL_KEYS: MetricKey[] = METRICS.map((m) => m.key);

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fitArr(v: unknown, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  if (!Array.isArray(v)) return out;
  for (let i = 0; i < n; i += 1) out[i] = num(v[i]);
  return out;
}

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
    void mode;
    return {
      axis: readVar('--text3', '#93a7c2'),
      axis2: readVar('--text2', '#5a7191'),
      split: readVar('--line', '#dde8f6'),
      line: readVar('--line', '#dde8f6'),
      panel: readVar('--panel', '#ffffff'),
      text: readVar('--text', '#16253d'),
      brand: readVar('--brand', '#2563eb'),
    };
  }, [mode]);
}

/* ══════════════ 局部样式（vb7- 前缀） ══════════════ */
const CSS = `
.vb7-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;height:100%;min-width:0}
.vb7-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}
.vb7-h{padding:13px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;flex-wrap:wrap;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb7-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb7-dot{width:6px;height:6px;border-radius:2px;background:var(--cyan);box-shadow:0 0 0 3px color-mix(in srgb,var(--cyan) 16%,transparent);flex-shrink:0}
.vb7-hint{font-size:11px;color:var(--text3);font-weight:550;white-space:nowrap}
.vb7-hint b{color:var(--brand);font-weight:700}
.vb7-b{padding:14px 16px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}

/* 图例 = 筛选（F5-1：合并为一处） */
.vb7-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:9px}
.vb7-chips .lb{font-size:11.5px;color:var(--text3);font-weight:600;margin-right:2px;white-space:nowrap}
.vb7-sep{width:1px;height:14px;background:var(--line);display:inline-block;margin:0 2px}
.vb7-chip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:8px;cursor:pointer;user-select:none;border:1px solid var(--line);background:var(--panel2);color:var(--text2);font-size:11.5px;font-weight:550;transition:all .15s;white-space:nowrap;font-family:inherit}
.vb7-chip:hover{border-color:var(--brand3);color:var(--brand)}
.vb7-chip .sw{width:7px;height:7px;border-radius:2px;flex-shrink:0;transition:all .15s}
.vb7-chip.on{background:linear-gradient(135deg,var(--brand),var(--brand2));border-color:transparent;color:#fff;box-shadow:0 3px 9px color-mix(in srgb,var(--brand) 28%,transparent)}
.vb7-chip.on .sw{background:#fff!important}
.vb7-chip.off{opacity:.55}
.vb7-chip.off .sw{background:transparent!important;border:1.5px solid currentColor}
.vb7-chip .ax{font-size:9px;opacity:.7;font-weight:600}
.vb7-all{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:8px;border:1px dashed var(--line);background:transparent;color:var(--text3);font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}
.vb7-all:hover{color:var(--brand);border-color:var(--brand3)}
.vb7-empty{padding:40px 0;display:flex;align-items:center;justify-content:center}
`;

export default function RunTrend({ data, loading, isMobile }: RunTrendProps) {
  const tok = useTokens();
  const r9 = data?.row9;
  const days = Array.isArray(r9?.days) ? (r9?.days ?? []) : [];
  const n = days.length;

  const [picked, setPicked] = useState<MetricKey[]>(ALL_KEYS);
  // 数据从空变为有值时恢复全选，避免首屏空数据把选择清空后一直空图
  useEffect(() => {
    if (n > 0) setPicked(ALL_KEYS);
  }, [n]);

  const seriesData = useMemo(() => {
    const map = {} as Record<MetricKey, number[]>;
    METRICS.forEach((m) => {
      map[m.key] = fitArr((r9 as unknown as Record<string, unknown> | undefined)?.[m.key], n);
    });
    return map;
  }, [r9, n]);

  /** 有值天数：任一系列非 0 的天数（用于验收「不再 28 天全 0」） */
  const activeDays = useMemo(() => {
    let c = 0;
    for (let i = 0; i < n; i += 1) {
      if (METRICS.some((m) => num(seriesData[m.key]?.[i]) !== 0)) c += 1;
    }
    return c;
  }, [seriesData, n]);

  const hasAnyValue = activeDays > 0;

  const option = useMemo<EChartsOption>(() => {
    const visible = METRICS.filter((m) => picked.includes(m.key));
    return {
      color: visible.map((m) => m.color),
      grid: { left: 4, right: 4, top: isMobile ? 62 : 58, bottom: 2, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: tok.axis, width: 1, type: 'dashed' } },
        backgroundColor: tok.panel,
        borderColor: tok.line,
        borderWidth: 1,
        textStyle: { color: tok.text, fontSize: 12 },
        extraCssText: 'box-shadow:0 6px 18px rgba(20,52,102,.16);border-radius:11px;padding:8px 10px;',
      },
      // F5-1：图例与筛选合并 → 图表内不再重复渲染图例（由上方 chip 组承担图例职责）
      legend: { show: false },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: days,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: tok.line } },
        axisLabel: { color: tok.axis, fontSize: 10, interval: isMobile ? 5 : 2 },
      },
      yAxis: [
        {
          // F5-2：数量轴自适应，不强制从 0 起
          type: 'value',
          name: isMobile ? '' : '数量',
          scale: true,
          min: (v: { min: number; max: number }) => {
            const lo = Number(v.min);
            const hi = Number(v.max);
            if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
            if (lo === hi) return Math.max(0, Math.floor(lo * 0.9));
            return Math.max(0, Math.floor(lo - (hi - lo) * 0.12));
          },
          nameTextStyle: { color: tok.axis, fontSize: 10, padding: [0, 0, 0, 4] },
          axisLabel: { color: tok.axis, fontSize: 10 },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: tok.split, type: 'dashed' } },
        },
        {
          // F5-2：比率轴同样自适应（不再固定 0~1）
          type: 'value',
          name: isMobile ? '' : '比率',
          scale: true,
          min: (v: { min: number; max: number }) => {
            const lo = Number(v.min);
            const hi = Number(v.max);
            if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
            const pad = (hi - lo) * 0.12 || 0.02;
            return Math.max(0, lo - pad);
          },
          nameTextStyle: { color: tok.axis, fontSize: 10, padding: [0, 4, 0, 0] },
          axisLabel: {
            color: tok.axis,
            fontSize: 10,
            formatter: (v: number) => `${(Number(v) * 100).toFixed(1)}%`,
          },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
        },
      ],
      series: visible.map((m) => ({
        name: m.name,
        type: 'line' as const,
        yAxisIndex: m.axis,
        smooth: true,
        symbol: 'circle' as const,
        symbolSize: 5,
        showSymbol: !isMobile || m.axis === 1,
        lineStyle: { width: 2, color: m.color },
        itemStyle: { color: m.color },
        emphasis: { focus: 'series' as const },
        data: seriesData[m.key],
        tooltip: {
          valueFormatter: (v: unknown) =>
            (m.kind === 'pct' ? `${(num(v) * 100).toFixed(2)}%` : `${num(v).toLocaleString('zh-CN')}`),
        },
      })),
    };
  }, [tok, days, picked, seriesData, isMobile]);

  const height = isMobile ? 260 : 340;

  let body: React.ReactNode;
  if (!n || !hasAnyValue) {
    body = (
      <div className="vb7-empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行趋势数据" />
      </div>
    );
  } else if (!picked.length) {
    body = (
      <div className="vb7-empty" style={{ height }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span style={{ color: 'var(--text2)', fontSize: 12 }}>请至少选择一项指标</span>}
        />
      </div>
    );
  } else {
    body = <EChart option={option} height={height} />;
  }

  const toggle = (k: MetricKey) => {
    setPicked((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  };
  const allOn = picked.length === ALL_KEYS.length;

  return (
    <>
      <style>{CSS}</style>
      <div className="vb7-card">
        <div className="vb7-h">
          <h3>
            <span className="vb7-dot" />
            客户运行情况趋势
          </h3>
          <span className="vb7-hint">
            近 30 日 · 按策略开通&amp;触达时间 · <b>{activeDays}</b>/{n} 天有数据
          </span>
        </div>
        <div className="vb7-b">
          {/* F5-1：筛选按钮与图例合并为同一组 chip */}
          <div className="vb7-chips">
            <span className="lb">指标 / 图例</span>
            {METRICS.map((m) => {
              const on = picked.includes(m.key);
              return (
                <Tooltip key={m.key} title={m.tip} placement="top" overlayStyle={{ maxWidth: 260 }}>
                  <button
                    type="button"
                    className={`vb7-chip${on ? ' on' : ' off'}`}
                    aria-pressed={on}
                    onClick={() => toggle(m.key)}
                  >
                    <span className="sw" style={{ background: on ? '#fff' : m.color }} />
                    {m.name}
                    {m.axis === 1 && <span className="ax">右轴</span>}
                  </button>
                </Tooltip>
              );
            })}
            <span className="vb7-sep" />
            <button
              type="button"
              className="vb7-all"
              onClick={() => setPicked(allOn ? [] : ALL_KEYS)}
            >
              {allOn ? '全部取消' : '全选'}
            </button>
          </div>
          {body}
        </div>
      </div>
    </>
  );
}
