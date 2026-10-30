/** 轻量 echarts 封装（核心页面组内部使用）
 *
 * 只负责：初始化 / 更新 option / 容器尺寸变化时自适应 / 卸载时销毁。
 * 颜色由调用方通过 option.color 传入（统一使用契约 8 色板）。
 */
import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';

export interface EChartProps {
  option: EChartsOption;
  /** 图表高度（px），移动端由调用方传入更小的值 */
  height?: number;
  /** 附加样式 */
  style?: React.CSSProperties;
}

export default function EChart({ option, height = 300, style }: EChartProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  // 初始化 + 自适应 + 销毁
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;

    const chart = echarts.init(el);
    chartRef.current = chart;

    const resize = () => chart.resize();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(resize);
      observer.observe(el);
    }
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      observer?.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // option 变化时重绘（notMerge 保证系列数量变化时不残留）
  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  // 高度变化时主动 resize（移动端断点切换）
  useEffect(() => {
    chartRef.current?.resize();
  }, [height]);

  return <div ref={boxRef} style={{ width: '100%', height, ...style }} />;
}
