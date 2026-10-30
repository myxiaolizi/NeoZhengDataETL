/**
 * 折线图（line）：趋势折线（面积淡填充，按数据原序，不重排分类）
 */
import React, { useMemo } from 'react';
import EChart from '@/pages/dashboard/EChart';
import { EmptyBox, buildCategoryChart, resolveFields } from './shared';
import type { WidgetProps } from './shared';

export default function LineWidget({ widget, rows, columns, isMobile, dark }: WidgetProps) {
  const built = useMemo(() => {
    const f = resolveFields(widget, rows, columns);
    return { f, ...buildCategoryChart(widget, f, rows, 'line', dark) };
  }, [widget, rows, columns, dark]);

  const height = widget.height && widget.height > 120 ? Math.max(150, widget.height - 58) : isMobile ? 200 : 232;
  if (!built.f.metric) return <EmptyBox text="没有可用的数值列" height={height} />;
  if (built.isEmpty) return <EmptyBox text="暂无数据" height={height} />;
  return <EChart option={built.option} height={height} />;
}
