/** 第 9 排：客户运行情况趋势（近 30 日）
 *
 * 数据：data.row9（days / reached / runningChains / openedStrategies / runningStrategies / reachRate / couponRate）
 * 呈现：双 y 轴折线图
 *  - 左轴（数量）：触达人数、运行连锁数、开通策略数、运行策略数
 *  - 右轴（比率 0~1，axisLabel 转百分比）：到店率、优惠券核销率
 *  - 6 条线取契约 CHART_SERIES 前 6 色，smooth / circle / symbolSize 5
 *  - 顶部 Checkbox 控制显示哪些指标，图例亦可点击切换
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Card, Checkbox, Empty, Space } from 'antd';
import type { EChartsOption } from 'echarts';
import type { BoardData } from '@/api/crm-board';
import { CHART_SERIES } from '@/api/crm-board';
import EChart from '../EChart';
import { tooltipStyle, useChartPalette } from './theme';

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
}

/** 契约 §7.1 序列色前 6 位，按顺序分配 */
const METRICS: MetricDef[] = [
  { key: 'reached', name: '触达人数', axis: 0, color: CHART_SERIES[0], kind: 'num' },
  { key: 'runningChains', name: '运行连锁数', axis: 0, color: CHART_SERIES[1], kind: 'num' },
  { key: 'openedStrategies', name: '开通策略数', axis: 0, color: CHART_SERIES[2], kind: 'num' },
  { key: 'runningStrategies', name: '运行策略数', axis: 0, color: CHART_SERIES[3], kind: 'num' },
  { key: 'reachRate', name: '到店率', axis: 1, color: CHART_SERIES[4], kind: 'pct' },
  { key: 'couponRate', name: '优惠券核销率', axis: 1, color: CHART_SERIES[5], kind: 'pct' },
];

const ALL_KEYS: MetricKey[] = METRICS.map((m) => m.key);

/** 契约 §7.2：CSS 变量优先；变量未注入时回退 antd v6 主题变量，保证明暗都可读 */
const T_MAIN = 'var(--text-main, var(--ant-color-text, #003378))';
const T_SUB = 'var(--text-sub, var(--ant-color-text-secondary, rgba(0,51,120,.66)))';
const BORDER = 'var(--border, var(--ant-color-border, rgba(54,135,255,.28)))';
const BG_CARD = 'var(--bg-card, var(--ant-color-bg-container, #FFFFFF))';

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

export default function RunTrend({ data, loading, isMobile }: RunTrendProps) {
  const pal = useChartPalette();
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

  const hasAnyValue = useMemo(
    () => METRICS.some((m) => (seriesData[m.key] || []).some((v) => v !== 0)),
    [seriesData],
  );

  const option = useMemo<EChartsOption>(() => {
    const visible = METRICS.filter((m) => picked.includes(m.key));
    return {
      color: visible.map((m) => m.color),
      grid: { left: 4, right: 4, top: isMobile ? 62 : 58, bottom: 2, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: pal.axisLine } },
        ...tooltipStyle(pal),
      },
      legend: {
        top: 0,
        left: 0,
        itemWidth: 10,
        itemHeight: 8,
        itemGap: isMobile ? 8 : 12,
        textStyle: { color: pal.legend, fontSize: 11 },
        type: 'scroll',
        data: visible.map((m) => m.name),
        selectedMode: true,
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: days,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: pal.axisLine } },
        axisLabel: { color: pal.axis, fontSize: 10, interval: isMobile ? 5 : 2 },
      },
      yAxis: [
        {
          type: 'value',
          name: isMobile ? '' : '数量',
          minInterval: 1,
          nameTextStyle: { color: pal.axis, fontSize: 10, padding: [0, 0, 0, 4] },
          axisLabel: { color: pal.axis, fontSize: 10 },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: pal.split, type: 'dashed' } },
        },
        {
          type: 'value',
          name: isMobile ? '' : '比率',
          min: 0,
          max: 1,
          nameTextStyle: { color: pal.axis, fontSize: 10, padding: [0, 4, 0, 0] },
          axisLabel: {
            color: pal.axis,
            fontSize: 10,
            formatter: (v: number) => `${Math.round(Number(v) * 100)}%`,
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
  }, [pal, days, picked, seriesData, isMobile]);

  const height = isMobile ? 260 : 340;

  let body: React.ReactNode;
  if (!n) {
    body = <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行趋势数据" style={{ padding: '48px 0' }} />;
  } else if (!hasAnyValue) {
    body = <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行趋势数据" style={{ padding: '48px 0' }} />;
  } else if (!picked.length) {
    body = (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span style={{ color: T_SUB, fontSize: 12 }}>请至少选择一项指标</span>}
        />
      </div>
    );
  } else {
    body = <EChart option={option} height={height} />;
  }

  return (
    <Card
      variant="outlined"
      loading={loading && !n}
      style={{ background: BG_CARD, border: `1px solid ${BORDER}`, borderRadius: 12, height: '100%' }}
      styles={{ body: { padding: isMobile ? 12 : 16 } }}
      title={<span style={{ fontSize: 14, fontWeight: 600, color: T_MAIN }}>客户运行情况趋势</span>}
      extra={<span style={{ fontSize: 12, color: T_SUB }}>近 30 日 · 左轴数量 / 右轴比率</span>}
    >
      <Space size={[10, 4]} wrap style={{ marginBottom: 8 }}>
        <Checkbox
          indeterminate={picked.length > 0 && picked.length < ALL_KEYS.length}
          checked={picked.length === ALL_KEYS.length}
          onChange={(e) => setPicked(e.target.checked ? ALL_KEYS : [])}
        >
          <span style={{ fontSize: 12, color: T_SUB }}>全选</span>
        </Checkbox>
        <span style={{ width: 1, height: 12, background: BORDER, display: 'inline-block' }} />
        <Checkbox.Group
          value={picked}
          onChange={(vals) => setPicked(vals as MetricKey[])}
          options={METRICS.map((m) => ({
            value: m.key,
            label: (
              <span style={{ fontSize: 12, color: T_SUB, whiteSpace: 'nowrap' }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: m.color,
                    marginRight: 4,
                    verticalAlign: 'middle',
                  }}
                />
                {m.name}
                {m.axis === 1 ? '（右轴）' : ''}
              </span>
            ),
          }))}
        />
      </Space>
      {body}
    </Card>
  );
}
