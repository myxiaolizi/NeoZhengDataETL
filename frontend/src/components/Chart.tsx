/**
 * 通用 ECharts 封装（供全站复用）
 *
 * 特性：
 *  - props: { option, height, loading }（另有 empty / dark / onReady / onEvents 等可选能力）
 *  - ResizeObserver 监听容器尺寸，自动 resize（含侧边栏折叠、窗口缩放、移动端旋转）
 *  - 统一 8 色板（V4.1 起直接派生自 @/theme 的 PALETTE，不再单独维护一份色值）
 *  - 暗色大屏模式：仅调整文字/坐标轴颜色，不引入调色板外的颜色
 *
 * 用法：
 *   <Chart option={option} height={360} loading={loading} />
 */
import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption, EChartsType } from 'echarts';
import { Empty } from 'antd';
import { NEUTRAL, PALETTE } from '@/theme';

/**
 * 图表 8 色板 —— 直接引用 V4.1 设计令牌。
 *
 * V4.1 之前这里是一份独立的旧色值副本，与页面主题各自演进，
 * 导致「图表比页面更旧」的视觉不一致。
 * 现在统一从 PALETTE 派生：改 @/theme 即全站图表同步换色。
 */
export const CHART_COLORS = [
  PALETTE.primary,
  PALETTE.yellow,
  PALETTE.cyan,
  PALETTE.green,
  PALETTE.orange,
  PALETTE.violet,
  PALETTE.primaryDeep,
  PALETTE.gray,
] as const;

/** 浅色主题文字 / 网格色（取自 V4.1 中性色令牌，保证与页面文字同色） */
export const CHART_TEXT = NEUTRAL.text;
export const CHART_SUB_TEXT = NEUTRAL.textTertiary;
export const CHART_SPLIT = NEUTRAL.borderSubtle;
export const CHART_AXIS = NEUTRAL.border;

/** 暗色大屏主题文字色 */
export const CHART_DARK_TEXT = '#FFFFFF';
export const CHART_DARK_SUB_TEXT = 'rgba(255,255,255,.65)';
export const CHART_DARK_SPLIT = 'rgba(255,255,255,.14)';

export interface ChartProps {
  /** ECharts option；传 null / undefined 时不渲染图形（可配合 empty 使用） */
  option?: EChartsOption | null;
  /** 高度：数字按 px，字符串原样使用（如 '60vh'） */
  height?: number | string;
  /** 加载态（遮罩 + loading 动画） */
  loading?: boolean;
  /** 空数据态：展示 Empty，不初始化图表内容 */
  empty?: boolean;
  emptyText?: React.ReactNode;
  /** 暗色大屏模式：自动调整默认文字/坐标轴颜色 */
  dark?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** 实例就绪回调（用于需要主动 dispatchAction / getDataURL 的场景） */
  onReady?: (inst: EChartsType) => void;
  /** 事件绑定，如 { click: (params) => {} } */
  onEvents?: Record<string, (params: unknown) => void>;
}

/** 给调用方 option 补上统一主题默认值（调用方显式设置优先） */
export function withChartTheme(option: EChartsOption, dark = false): EChartsOption {
  const text = dark ? CHART_DARK_TEXT : CHART_TEXT;
  const sub = dark ? CHART_DARK_SUB_TEXT : CHART_SUB_TEXT;
  const split = dark ? CHART_DARK_SPLIT : CHART_SPLIT;

  return {
    color: [...CHART_COLORS],
    textStyle: { color: text, fontFamily: 'inherit' },
    ...option,
    // 以下默认值仅在调用方未设置时补全
    legend: option.legend === undefined
      ? { textStyle: { color: sub }, itemWidth: 10, itemHeight: 10, top: 0 }
      : option.legend,
    tooltip: option.tooltip === undefined
      ? {
          trigger: 'axis',
          backgroundColor: dark ? PALETTE.ink : NEUTRAL.surface,
          borderColor: dark ? 'rgba(255,255,255,.2)' : CHART_SPLIT,
          textStyle: { color: dark ? '#FFFFFF' : CHART_TEXT, fontSize: 12 },
          axisPointer: { type: 'shadow', lineStyle: { color: CHART_AXIS } },
        }
      : option.tooltip,
  } as EChartsOption;
}

/** 轴默认样式：供各页面拼装 option 时复用，保证视觉统一 */
export function chartAxisStyle(dark = false) {
  const line = dark ? CHART_DARK_SPLIT : CHART_SPLIT;
  const label = dark ? CHART_DARK_SUB_TEXT : CHART_SUB_TEXT;
  return {
    axisLine: { lineStyle: { color: line } },
    axisTick: { show: false },
    axisLabel: { color: label, fontSize: 11 },
    splitLine: { lineStyle: { color: line, type: 'dashed' as const } },
  };
}

const toCssSize = (v: number | string): string => (typeof v === 'number' ? `${v}px` : v);

export default function Chart({
  option,
  height = 320,
  loading = false,
  empty = false,
  emptyText = '暂无数据',
  dark = false,
  className,
  style,
  onReady,
  onEvents,
}: ChartProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const instRef = useRef<EChartsType | null>(null);
  const eventsRef = useRef<Record<string, (params: unknown) => void> | undefined>(onEvents);
  eventsRef.current = onEvents;

  /* 初始化 / 销毁：只跑一次，避免 option 变化反复重建实例 */
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;

    const inst = echarts.init(el, undefined, { renderer: 'canvas' });
    instRef.current = inst;
    onReady?.(inst);

    const ro = new ResizeObserver(() => {
      // 容器隐藏时宽高为 0，resize 会报错，需跳过
      if (el.clientWidth > 0 && el.clientHeight > 0) inst.resize();
    });
    ro.observe(el);

    // 兜底：部分浏览器（如旧版 Safari）ResizeObserver 对 display 变化不敏感
    const onWinResize = () => inst.resize();
    window.addEventListener('resize', onWinResize);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onWinResize);
      inst.dispose();
      instRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* option 更新 */
  useEffect(() => {
    const inst = instRef.current;
    if (!inst) return;
    if (!option) {
      inst.clear();
      return;
    }
    inst.setOption(withChartTheme(option, dark), true);
  }, [option, dark]);

  /* 事件绑定：解绑旧事件后重绑 */
  useEffect(() => {
    const inst = instRef.current;
    if (!inst) return;
    const bound: string[] = [];
    Object.entries(eventsRef.current || {}).forEach(([evt, fn]) => {
      inst.on(evt, fn as (...args: unknown[]) => void);
      bound.push(evt);
    });
    return () => {
      bound.forEach((evt) => inst.off(evt));
    };
  }, [option]);

  /* 加载态 */
  useEffect(() => {
    const inst = instRef.current;
    if (!inst) return;
    if (loading) {
      inst.showLoading('default', {
        text: '加载中',
        color: CHART_COLORS[2],
        textColor: dark ? CHART_DARK_TEXT : CHART_TEXT,
        maskColor: dark ? 'rgba(0,51,120,.35)' : 'rgba(255,255,255,.72)',
        zlevel: 0,
      });
    } else {
      inst.hideLoading();
    }
  }, [loading, dark, option]);

  return (
    <div
      className={className}
      style={{ position: 'relative', width: '100%', height: toCssSize(height), ...style }}
    >
      <div ref={boxRef} style={{ width: '100%', height: '100%' }} />
      {empty && !loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: dark ? 'transparent' : 'rgba(255,255,255,.6)',
          }}
        >
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span style={{ color: dark ? CHART_DARK_SUB_TEXT : NEUTRAL.textQuaternary }}>{emptyText}</span>}
          />
        </div>
      )}
    </div>
  );
}
