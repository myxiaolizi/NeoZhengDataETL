/** 第 6 排左：签约趋势（最近 30 天）
 *
 * 呈现：
 *  - 堆叠柱形图：签约客户数，南区 #45B4FF / 北区 #FFC000
 *  - 折线：签约门店数（不分南北，走右侧第二个 y 轴，#3687FF）
 *  - 图例下方快捷多选「连锁类型」：只累加选中类型的 south/north，仍保持南北区两色
 *
 * 数据：data.row6.signTrend（days / south / north / stores / byChainType）
 * 口径见 _work/V5-CONTRACT.md §四 第 6 排。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Space, Tag } from 'antd';
import type { EChartsOption } from 'echarts';
import type { BoardData, SignTrendData } from '@/api/crm-board';
import { CHAIN_TYPE_COLORS } from '@/api/crm-board';
import EChart from '../EChart';
import { tooltipStyle, useChartPalette } from './theme';

/** 契约 §7.1：南北区固定配色 */
const C_SOUTH = '#45B4FF';
const C_NORTH = '#FFC000';
const C_STORE = '#3687FF';

/** 契约 §7.2：CSS 变量优先；变量未注入时回退 antd v6 主题变量，保证明暗都可读 */
const T_MAIN = 'var(--text-main, var(--ant-color-text, #003378))';
const T_SUB = 'var(--text-sub, var(--ant-color-text-secondary, rgba(0,51,120,.66)))';
const BORDER = 'var(--border, var(--ant-color-border, rgba(54,135,255,.28)))';

type Bucket = { south: number[]; north: number[] };

export interface SignTrendProps {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

/** 数值兜底 */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 数组兜底：长度固定为 n，缺失补 0 */
function fitArr(v: unknown, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  if (!Array.isArray(v)) return out;
  for (let i = 0; i < n; i += 1) out[i] = num(v[i]);
  return out;
}

/** 把选中的连锁类型的 south/north 按日求和（导出以便单测多选聚合） */
export function sumPicked(
  byChainType: Record<string, Bucket>,
  picked: string[],
  n: number,
): { south: number[]; north: number[] } {
  const south = new Array<number>(n).fill(0);
  const north = new Array<number>(n).fill(0);
  picked.forEach((t) => {
    const b = byChainType?.[t];
    if (!b) return;
    const bs = fitArr(b.south, n);
    const bn = fitArr(b.north, n);
    for (let i = 0; i < n; i += 1) {
      south[i] += bs[i];
      north[i] += bn[i];
    }
  });
  return { south, north };
}

export default function SignTrend({ data, loading, isMobile }: SignTrendProps) {
  const pal = useChartPalette();

  const trend = data?.row6?.signTrend as SignTrendData | undefined;
  const days = Array.isArray(trend?.days) ? (trend?.days ?? []) : [];
  const n = days.length;
  const byChainType = (trend?.byChainType || {}) as Record<string, Bucket>;
  const typeNames = useMemo(() => Object.keys(byChainType), [byChainType]);
  const typeKey = typeNames.join('|');

  /** 默认全选；数据刷新（连锁类型集合变化）时重置 */
  const [picked, setPicked] = useState<string[]>(typeNames);
  useEffect(() => {
    setPicked(typeKey ? typeKey.split('|') : []);
  }, [typeKey]);

  const allSelected = typeNames.length > 0 && picked.length === typeNames.length;

  /** 堆叠柱数据：全量 or 选中类型求和 */
  const bars = useMemo(() => {
    if (!n) return { south: [] as number[], north: [] as number[], mode: 'none' as 'none' | 'all' | 'picked' | 'empty' };
    // 后端没给 byChainType（或为空）→ 退回全量 south/north
    if (!typeNames.length) {
      return { south: fitArr(trend?.south, n), north: fitArr(trend?.north, n), mode: 'all' as const };
    }
    // 用户把所有类型都取消 → 空图
    if (!picked.length) return { south: [], north: [], mode: 'empty' as const };
    return { ...sumPicked(byChainType, picked, n), mode: 'picked' as const };
  }, [n, typeNames, picked, byChainType, trend]);

  const stores = useMemo(() => fitArr(trend?.stores, n), [trend, n]);

  const option = useMemo<EChartsOption>(() => ({
    color: [C_SOUTH, C_NORTH, C_STORE],
    grid: { left: 4, right: 4, top: isMobile ? 58 : 54, bottom: 2, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      ...tooltipStyle(pal),
    },
    legend: {
      top: 0,
      left: 0,
      itemWidth: 10,
      itemHeight: 8,
      itemGap: 14,
      textStyle: { color: pal.legend, fontSize: 11 },
      data: ['南区', '北区', '门店数'],
    },
    xAxis: {
      type: 'category',
      data: days,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: pal.axisLine } },
      axisLabel: { color: pal.axis, fontSize: 10, interval: isMobile ? 5 : 2 },
    },
    yAxis: [
      {
        type: 'value',
        name: isMobile ? '' : '客户数',
        minInterval: 1,
        nameTextStyle: { color: pal.axis, fontSize: 10, padding: [0, 0, 0, 4] },
        axisLabel: { color: pal.axis, fontSize: 10 },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: pal.split, type: 'dashed' } },
      },
      {
        type: 'value',
        name: isMobile ? '' : '门店数',
        minInterval: 1,
        nameTextStyle: { color: pal.axis, fontSize: 10, padding: [0, 4, 0, 0] },
        axisLabel: { color: pal.axis, fontSize: 10 },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '南区',
        type: 'bar',
        stack: 'clients',
        barMaxWidth: 12,
        emphasis: { focus: 'series' },
        itemStyle: { color: C_SOUTH },
        data: bars.south,
      },
      {
        name: '北区',
        type: 'bar',
        stack: 'clients',
        barMaxWidth: 12,
        emphasis: { focus: 'series' },
        itemStyle: { color: C_NORTH },
        data: bars.north,
      },
      {
        name: '门店数',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        showSymbol: !isMobile,
        itemStyle: { color: C_STORE },
        lineStyle: { width: 2, color: C_STORE },
        data: stores,
      },
    ],
  }), [pal, days, bars, stores, isMobile]);

  const height = isMobile ? 220 : 300;

  let body: React.ReactNode;
  if (!n) {
    body = <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无签约趋势数据" style={{ padding: '48px 0' }} />;
  } else if (bars.mode === 'empty') {
    body = (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span style={{ color: T_SUB, fontSize: 12 }}>请至少选择一种连锁类型</span>}
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
      style={{ background: 'var(--bg-card, var(--ant-color-bg-container, #FFFFFF))', border: `1px solid ${BORDER}`, borderRadius: 12, height: '100%' }}
      styles={{ body: { padding: isMobile ? 12 : 16 } }}
      title={<span style={{ fontSize: 14, fontWeight: 600, color: T_MAIN }}>签约趋势</span>}
      extra={<span style={{ fontSize: 12, color: T_SUB }}>最近 30 天</span>}
    >
      {typeNames.length > 0 && (
        <Space size={[6, 6]} wrap style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: T_SUB }}>连锁类型</span>
          {typeNames.map((t) => {
            const checked = picked.includes(t);
            const accent = CHAIN_TYPE_COLORS[t] || C_STORE;
            return (
              <Tag.CheckableTag
                key={t}
                checked={checked}
                onChange={(ck) => {
                  setPicked((prev) => (ck ? [...prev, t] : prev.filter((x) => x !== t)));
                }}
                style={{
                  fontSize: 12,
                  lineHeight: '20px',
                  padding: '0 8px',
                  border: `1px solid ${checked ? accent : BORDER}`,
                  borderRadius: 4,
                  background: checked ? accent : 'transparent',
                  color: checked ? '#FFFFFF' : T_SUB,
                }}
              >
                {t}
              </Tag.CheckableTag>
            );
          })}
          {!allSelected && typeNames.length > 0 && (
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: 20, fontSize: 12 }}
              onClick={() => setPicked(typeNames)}
            >
              全选
            </Button>
          )}
        </Space>
      )}
      {body}
    </Card>
  );
}
