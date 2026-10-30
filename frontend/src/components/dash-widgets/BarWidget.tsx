/**
 * 柱状图（bar）：分类对比柱状图（支持横向）
 */
import React, { useMemo } from 'react';
import EChart from '@/pages/dashboard/EChart';
import { EmptyBox, buildCategoryChart, resolveFields } from './shared';
import type { WidgetProps } from './shared';

export default function BarWidget({ widget, rows, columns, isMobile, dark }: WidgetProps) {
  const built = useMemo(() => {
    const f = resolveFields(widget, rows, columns);
    return { f, ...buildCategoryChart(widget, f, rows, 'bar', dark) };
  }, [widget, rows, columns, dark]);

  const height = widget.height && widget.height > 120 ? Math.max(150, widget.height - 58) : isMobile ? 200 : 232;
  if (!built.f.metric) return <EmptyBox text="没有可用的数值列" height={height} />;
  if (built.isEmpty) return <EmptyBox text="暂无数据" height={height} />;
  return <EChart option={built.option} height={height} />;
}
