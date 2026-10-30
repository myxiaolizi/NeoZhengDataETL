/** 第 4-5 排：签约数据同环比
 *
 * 仅当 data.compare !== null 时渲染（后端只在 本周/上周/本月/上月 返回 compare）。
 * 5 张卡片：
 *   签约客户环比 / 签约门店数环比 / 按连锁类型 / 按销售 / 按销售×连锁类型
 */
import React, { useMemo } from 'react';
import { Card, Empty, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { BoardData, CompareRow } from '@/api/crm-board';
import EChart from '../EChart';
import { fmtDelta, fmtNum, tooltipStyle, useChartPalette } from './theme';

interface Props {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

/** 环比单元格：正绿负红，null 显示 - */
function DeltaCell({ v }: { v: number | null }) {
  if (v === null || v === undefined) {
    return <span style={{ color: 'var(--text-mute)' }}>-</span>;
  }
  const up = v > 0;
  const flat = v === 0;
  const color = flat ? 'var(--text-mute)' : up ? '#A2D73C' : '#E86161';
  return (
    <span style={{ color, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {flat ? '' : up ? '↑' : '↓'} {fmtDelta(v, 1)}
    </span>
  );
}

const COLUMNS = (firstTitle: string): ColumnsType<CompareRow> => [
  {
    title: firstTitle,
    dataIndex: 'name',
    key: 'name',
    width: 150,
    ellipsis: true,
    render: (v: string) => <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{v}</span>,
  },
  {
    title: '本期',
    dataIndex: 'current',
    key: 'current',
    width: 88,
    align: 'right',
    render: (v: number) => <b style={{ color: 'var(--text-main)' }}>{fmtNum(v)}</b>,
  },
  {
    title: '上期',
    dataIndex: 'previous',
    key: 'previous',
    width: 88,
    align: 'right',
    render: (v: number) => <span style={{ color: 'var(--text-sub)' }}>{fmtNum(v)}</span>,
  },
  {
    title: '环比',
    dataIndex: 'ratio',
    key: 'ratio',
    width: 100,
    align: 'right',
    render: (v: number | null) => <DeltaCell v={v} />,
  },
  {
    title: '累计',
    dataIndex: 'cumulative',
    key: 'cumulative',
    width: 92,
    align: 'right',
    render: (v: number) => <span style={{ color: 'var(--text-main)' }}>{fmtNum(v)}</span>,
  },
];

/** 对比小柱图（本期 vs 上期） */
function CompareBars({ rows, palette }: { rows: CompareRow[]; palette: any }) {
  const option = useMemo(() => ({
    color: ['#3687FF', '#B5B5B6'],
    grid: { left: 6, right: 8, top: 26, bottom: 2, containLabel: true },
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const }, ...tooltipStyle(palette) },
    legend: {
      top: 0, right: 0, itemWidth: 9, itemHeight: 7,
      textStyle: { color: palette.legend, fontSize: 10.5 },
    },
    xAxis: {
      type: 'category' as const,
      data: rows.map((r) => r.name),
      axisLine: { lineStyle: { color: palette.axisLine } },
      axisTick: { show: false },
      axisLabel: { color: palette.axis, fontSize: 10.5 },
    },
    yAxis: {
      type: 'value' as const,
      minInterval: 1,
      splitLine: { lineStyle: { color: palette.split, type: 'dashed' as const } },
      axisLabel: { color: palette.axis, fontSize: 10.5 },
    },
    series: [
      {
        name: '本期', type: 'bar' as const, barWidth: 14,
        itemStyle: { borderRadius: [3, 3, 0, 0] },
        data: rows.map((r) => r.current),
      },
      {
        name: '上期', type: 'bar' as const, barWidth: 14,
        itemStyle: { borderRadius: [3, 3, 0, 0] },
        data: rows.map((r) => r.previous),
      },
    ],
  }), [rows, palette]);

  if (!rows.length) return null;
  return <EChart option={option} height={150} />;
}

/** 通用对比卡 */
function CompareCard({
  title, subtitle, rows, firstTitle, palette, isMobile, chart, scrollY,
}: {
  title: string;
  subtitle?: string;
  rows: CompareRow[];
  firstTitle: string;
  palette: any;
  isMobile: boolean;
  chart?: boolean;
  scrollY?: number;
}) {
  return (
    <Card
      size="small"
      title={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
          {subtitle && (
            <span style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--text-mute)' }}>{subtitle}</span>
          )}
        </div>
      }
      style={{
        height: '100%',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        boxShadow: 'var(--shadow)',
      }}
      styles={{
        header: { background: 'transparent', borderBottom: '1px solid var(--border)', minHeight: 44 },
        body: { padding: 10 },
      }}
    >
      {rows.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本期无数据" />
      ) : (
        <>
          {chart && <CompareBars rows={rows} palette={palette} />}
          <Table<CompareRow>
            size="small"
            rowKey={(r) => r.name}
            columns={COLUMNS(firstTitle)}
            dataSource={rows}
            pagination={
              rows.length > 10
                ? { pageSize: 10, size: 'small', showSizeChanger: false, showTotal: (t) => `共 ${t} 项` }
                : false
            }
            scroll={{ x: 'max-content', ...(scrollY ? { y: scrollY } : {}) }}
            style={{ marginTop: chart ? 6 : 0 }}
          />
        </>
      )}
    </Card>
  );
}

export default function ComparePanel({ data, loading, isMobile }: Props) {
  const palette = useChartPalette();
  const cmp = data.compare;

  // 契约要求：compare === null 时什么都不渲染
  if (!cmp) return null;

  const sub = `${cmp.label.current} vs ${cmp.label.previous}`;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))',
        gap: 12,
        alignItems: 'stretch',
      }}
    >
      <CompareCard
        title="签约客户环比情况"
        subtitle={sub}
        rows={cmp.clients}
        firstTitle="分类"
        palette={palette}
        isMobile={isMobile}
        chart
      />
      <CompareCard
        title="签约门店数环比情况"
        subtitle={sub}
        rows={cmp.stores}
        firstTitle="分类"
        palette={palette}
        isMobile={isMobile}
        chart
      />
      <CompareCard
        title="按连锁类型环比情况"
        subtitle={sub}
        rows={cmp.byChainType}
        firstTitle="连锁类型"
        palette={palette}
        isMobile={isMobile}
      />
      <CompareCard
        title="按销售环比情况"
        subtitle={sub}
        rows={cmp.bySales}
        firstTitle="销售"
        palette={palette}
        isMobile={isMobile}
      />
      <div style={{ gridColumn: isMobile ? 'auto' : '1 / -1' }}>
        <CompareCard
          title="按销售 × 连锁类型环比情况"
          subtitle={sub}
          rows={cmp.bySalesType}
          firstTitle="销售 · 连锁类型"
          palette={palette}
          isMobile={isMobile}
        />
      </div>
    </div>
  );
}
