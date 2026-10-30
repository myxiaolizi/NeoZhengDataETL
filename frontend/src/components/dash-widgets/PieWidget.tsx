/**
 * 饼图（pie）：占比饼图（chart.donut=true 时变环形）
 */
import React, { useMemo } from 'react';
import EChart from '@/pages/dashboard/EChart';
import { EmptyBox, buildPieChart, resolveFields } from './shared';
import type { WidgetProps } from './shared';

export default function PieWidget({ widget, rows, columns, isMobile, dark }: WidgetProps) {
  const built = useMemo(() => {
    const f = resolveFields(widget, rows, columns);
    return { f, ...buildPieChart(widget, f, rows, dark) };
  }, [widget, rows, columns, dark]);

  const height = widget.height && widget.height > 120 ? Math.max(150, widget.height - 58) : isMobile ? 210 : 250;
  if (!built.f.metric) return <EmptyBox text="没有可用的数值列" height={height} />;
  if (built.isEmpty) return <EmptyBox text="暂无数据" height={height} />;
  return <EChart option={built.option} height={height} />;
}
