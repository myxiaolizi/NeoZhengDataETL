/** 策略运行趋势（原「客户运行趋势（近 30 日）」）— V7.1
 *
 * V7.1 变更（契约 §四 I）：
 *  I1 名称改为「策略运行趋势」，并在本组件自己的卡片标题栏渲染
 *  I2 支持开关数据标签（echarts series.label + labelLayout 防重叠）
 *  I3 混合图：人数/策略数/成本类 → 柱形（bar）；比率类（到店率/核销率/营销ROI）→ 折线（line）
 *  I4 指标按钮带**色块**，选中/未选中都能看出颜色，可直接当图例读
 *
 * 数据：data.row9（后端按 jdywh_mail_31 的 c_41f1cc4881 策略开通&触达时间分组，口径 §2.4）
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

type MetricKey =
  | 'reached' | 'runningChains' | 'openedStrategies' | 'runningStrategies'
  | 'channelCost' | 'couponCost' | 'totalCost'
  | 'reachRate' | 'couponRate' | 'roi';

interface MetricDef {
  key: MetricKey;
  name: string;
  /** 0 = 左轴（数量/金额），1 = 右轴（比率） */
  axis: 0 | 1;
  /** I3：数量/金额 → bar；比率 → line */
  type: 'bar' | 'line';
  color: string;
  kind: 'num' | 'pct' | 'ratio' | 'money';
  tip: string;
}

/** 契约 §三 令牌色，按顺序分配 */
const SERIES = ['#3b82f6', '#10b981', '#06b6d4', '#f59e0b', '#8b5cf6', '#ef4444', '#2563eb', '#0891b2', '#d97706', '#7c3aed'];

const METRICS: MetricDef[] = [
  { key: 'reached', name: '触达人数', axis: 0, type: 'bar', color: SERIES[0], kind: 'num', tip: '当日按策略开通&触达时间统计的触达会员数' },
  { key: 'runningChains', name: '运行连锁数', axis: 0, type: 'bar', color: SERIES[1], kind: 'num', tip: '当日有运行策略的连锁数（去重）' },
  { key: 'openedStrategies', name: '开通策略数', axis: 0, type: 'bar', color: SERIES[2], kind: 'num', tip: '当日开通的策略条数' },
  { key: 'runningStrategies', name: '运行策略数', axis: 0, type: 'bar', color: SERIES[3], kind: 'num', tip: '当日运行的策略条数（同策略每天可能重复运行，不可跨日累加）' },
  { key: 'channelCost', name: '渠道成本', axis: 0, type: 'bar', color: SERIES[6], kind: 'money', tip: '当日渠道成本（c_783814dcb3）' },
  { key: 'couponCost', name: '用券成本', axis: 0, type: 'bar', color: SERIES[7], kind: 'money', tip: '当日用券成本（c_81f128a3b7）' },
  { key: 'totalCost', name: '成本合计', axis: 0, type: 'bar', color: SERIES[8], kind: 'money', tip: '当日成本合计 = 渠道成本 + 用券成本' },
  { key: 'reachRate', name: '到店率', axis: 1, type: 'line', color: SERIES[4], kind: 'pct', tip: '到店人数 ÷ 发送人数（右轴，百分比）' },
  { key: 'couponRate', name: '优惠券核销率', axis: 1, type: 'line', color: SERIES[5], kind: 'pct', tip: '用券人数 ÷ 发券人数（右轴，百分比）' },
  { key: 'roi', name: '营销ROI', axis: 1, type: 'line', color: SERIES[9], kind: 'ratio', tip: '成本合计 ÷ 转化销售额（右轴）' },
];

/** 默认显示：核心 4 个数量指标 + 2 个比率指标（成本类默认收起，点 chip 打开） */
const DEFAULT_KEYS: MetricKey[] = [
  'reached', 'runningChains', 'openedStrategies', 'runningStrategies', 'reachRate', 'couponRate',
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
.vb7-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease;height:100%;min-width:0}
.vb7-h{padding:12px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;flex-wrap:wrap;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb7-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb7-dot{width:6px;height:6px;border-radius:2px;background:var(--cyan);box-shadow:0 0 0 3px color-mix(in srgb,var(--cyan) 16%,transparent);flex-shrink:0}
.vb7-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.vb7-hint{font-size:11px;color:var(--text3);font-weight:550;white-space:nowrap}
.vb7-hint b{color:var(--brand);font-weight:700}
.vb7-b{padding:12px 16px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}

/* I2 标签开关 */
.vb7-tgl{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--text2);font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}
.vb7-tgl:hover{border-color:var(--brand3);color:var(--brand)}
.vb7-tgl.on{background:color-mix(in srgb,var(--brand) 12%,transparent);border-color:var(--brand);color:var(--brand)}
.vb7-tgl .dot{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.5}
.vb7-tgl.on .dot{opacity:1}

/* I4 图例式 chip：色块常显，选中/未选中都可辨色 */
.vb7-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:9px}
.vb7-chips .lb{font-size:11.5px;color:var(--text3);font-weight:600;margin-right:2px;white-space:nowrap}
.vb7-chip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border-radius:8px;cursor:pointer;user-select:none;border:1px solid var(--line);background:var(--panel2);color:var(--text2);font-size:11.5px;font-weight:550;transition:all .15s;white-space:nowrap;font-family:inherit}
.vb7-chip:hover{border-color:var(--c);color:var(--c)}
.vb7-chip .sw{width:8px;height:8px;border-radius:2px;flex-shrink:0;background:var(--c);transition:box-shadow .15s}
.vb7-chip.on{border-color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent);color:var(--text);font-weight:650}
.vb7-chip.on .sw{box-shadow:0 0 0 2px color-mix(in srgb,var(--c) 30%,transparent)}
.vb7-chip.off{opacity:.6}
.vb7-chip.off .sw{background:transparent;border:1.5px solid var(--c)}
.vb7-chip .ax{font-size:9px;opacity:.65;font-weight:600}
.vb7-chip .tp{font-size:9px;opacity:.55;font-weight:700}
.vb7-sep{width:1px;height:14px;background:var(--line);display:inline-block;margin:0 2px}
.vb7-all{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:8px;border:1px dashed var(--line);background:transparent;color:var(--text3);font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}
.vb7-all:hover{color:var(--brand);border-color:var(--brand3)}
.vb7-empty{padding:40px 0;display:flex;align-items:center;justify-content:center}

@media(max-width:760px){
  .vb7-h{align-items:flex-start}
  .vb7-hd{width:100%}
  .vb7-hint{white-space:normal;line-height:1.5}
  .vb7-b{padding:11px 12px}
}
`;

export default function RunTrend({ data, loading, isMobile }: RunTrendProps) {
  const tok = useTokens();
  const r9 = data?.row9;
  const days = Array.isArray(r9?.days) ? (r9?.days ?? []) : [];
  const n = days.length;

  const [picked, setPicked] = useState<MetricKey[]>(DEFAULT_KEYS);
  const [showLabels, setShowLabels] = useState(true);

  // 数据从空变为有值时恢复默认选择
  useEffect(() => {
    if (n > 0) setPicked(DEFAULT_KEYS);
  }, [n]);

  const seriesData = useMemo(() => {
    const map = {} as Record<MetricKey, number[]>;
    METRICS.forEach((m) => {
      map[m.key] = fitArr((r9 as unknown as Record<string, unknown> | undefined)?.[m.key], n);
    });
    return map;
  }, [r9, n]);

  /** 有值天数（验收：不再是 28 天全 0） */
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
    const hasBar = visible.some((m) => m.type === 'bar');

    const labelFmt = (m: MetricDef) => (p: { value?: unknown }) => {
      const v = num(p.value);
      if (v === 0) return '';
      if (m.kind === 'pct') return `${(v * 100).toFixed(1)}%`;
      if (m.kind === 'ratio') return v.toFixed(3);
      return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
    };

    return {
      color: visible.map((m) => m.color),
      grid: { left: 4, right: 4, top: isMobile ? 56 : 50, bottom: 2, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: hasBar ? 'shadow' : 'line', lineStyle: { color: tok.axis, width: 1, type: 'dashed' } },
        backgroundColor: tok.panel,
        borderColor: tok.line,
        borderWidth: 1,
        textStyle: { color: tok.text, fontSize: 12 },
        extraCssText: 'box-shadow:0 6px 18px rgba(20,52,102,.16);border-radius:11px;padding:8px 10px;',
      },
      // 图例由上方 chip 承担（I4），图表内不重复渲染
      legend: { show: false },
      xAxis: {
        type: 'category',
        // 柱形需要 boundaryGap 留白；纯折线时贴边更美观
        boundaryGap: hasBar,
        data: days,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: tok.line } },
        axisLabel: { color: tok.axis, fontSize: 10, interval: isMobile ? 5 : 2 },
      },
      yAxis: [
        {
          type: 'value',
          name: isMobile ? '' : '数量 / 金额',
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
      series: visible.map((m) => {
        const base = {
          name: m.name,
          yAxisIndex: m.axis,
          itemStyle: { color: m.color },
          emphasis: { focus: 'series' as const },
          data: seriesData[m.key],
          // I2 数据标签 + labelLayout 防重叠
          label: {
            show: showLabels,
            position: m.type === 'bar' ? ('top' as const) : ('top' as const),
            fontSize: 9,
            color: tok.text,
            formatter: labelFmt(m),
          },
          labelLayout: { hideOverlap: true, moveOverlap: 'shiftY' as const },
          tooltip: {
            valueFormatter: (v: unknown) => {
              const x = num(v);
              if (m.kind === 'pct') return `${(x * 100).toFixed(2)}%`;
              if (m.kind === 'ratio') return x.toFixed(3);
              if (m.kind === 'money') return `¥${x.toLocaleString('zh-CN')}`;
              return x.toLocaleString('zh-CN');
            },
          },
        };
        if (m.type === 'bar') {
          return { ...base, type: 'bar' as const, barMaxWidth: 14, itemStyle: { color: m.color, borderRadius: [3, 3, 0, 0] } };
        }
        return {
          ...base,
          type: 'line' as const,
          smooth: true,
          symbol: 'circle' as const,
          symbolSize: 5,
          showSymbol: !isMobile || m.axis === 1,
          lineStyle: { width: 2, color: m.color },
        };
      }),
    };
  }, [tok, days, picked, seriesData, isMobile, showLabels]);

  const height = isMobile ? 280 : 360;

  let body: React.ReactNode;
  if (!n || !hasAnyValue) {
    body = (
      <div className="vb7-empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无策略运行趋势数据" />
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
            策略运行趋势
          </h3>
          <div className="vb7-hd">
            <span className="vb7-hint">
              近 30 日 · 按策略开通&amp;触达时间 · <b>{activeDays}</b>/{n} 天有数据
            </span>
            {/* I2 数据标签开关 */}
            <button
              type="button"
              className={`vb7-tgl${showLabels ? ' on' : ''}`}
              aria-pressed={showLabels}
              onClick={() => setShowLabels((v) => !v)}
              title="切换数据标签"
            >
              <span className="dot" />
              数据标签
            </button>
          </div>
        </div>
        <div className="vb7-b">
          {/* I4 图例式 chip（色块 = 系列色） */}
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
                    style={{ ['--c' as string]: m.color } as React.CSSProperties}
                    onClick={() => toggle(m.key)}
                  >
                    <span className="sw" />
                    {m.name}
                    {m.axis === 1 && <span className="ax">右轴</span>}
                    <span className="tp">{m.type === 'bar' ? '柱' : '线'}</span>
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
