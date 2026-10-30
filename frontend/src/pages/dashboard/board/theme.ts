/** V5.0 看板 · 主题与图表配色工具
 *
 * 明暗模式通过 <html data-theme="dark|light"> 驱动，CSS 变量定义在 Board.tsx 注入的 <style> 里。
 * echarts 的 axisLabel 不支持 CSS 变量，因此这里提供运行时取色的 hook。
 */
import { useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

/** 读取当前主题模式 */
export function getThemeMode(): ThemeMode {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** 订阅主题变化（Board.tsx 切换主题时会派发 board:theme 事件） */
export function useThemeMode(): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode);
  useEffect(() => {
    const on = () => setMode(getThemeMode());
    window.addEventListener('board:theme', on);
    return () => window.removeEventListener('board:theme', on);
  }, []);
  return mode;
}

export interface ChartPalette {
  isDark: boolean;
  /** 坐标轴标签文字色 */
  axis: string;
  /** 坐标轴轴线色 */
  axisLine: string;
  /** 网格分割线色 */
  split: string;
  /** 图表内文字主色 */
  text: string;
  /** tooltip 背景 */
  tooltipBg: string;
  /** tooltip 边框 */
  tooltipBorder: string;
  /** tooltip 文字 */
  tooltipText: string;
  /** 图例文字 */
  legend: string;
}

const LIGHT: ChartPalette = {
  isDark: false,
  axis: 'rgba(0,51,120,.52)',
  axisLine: 'rgba(54,135,255,.28)',
  split: 'rgba(54,135,255,.14)',
  text: '#003378',
  tooltipBg: '#FFFFFF',
  tooltipBorder: 'rgba(54,135,255,.28)',
  tooltipText: '#003378',
  legend: 'rgba(0,51,120,.72)',
};

const DARK: ChartPalette = {
  isDark: true,
  axis: 'rgba(220,221,221,.72)',
  axisLine: 'rgba(115,219,255,.30)',
  split: 'rgba(115,219,255,.16)',
  text: '#DCDDDD',
  tooltipBg: '#0B1B33',
  tooltipBorder: 'rgba(115,219,255,.34)',
  tooltipText: '#DCDDDD',
  legend: 'rgba(220,221,221,.80)',
};

/** 运行时取当前主题的图表配色（随明暗切换自动更新） */
export function useChartPalette(): ChartPalette {
  const mode = useThemeMode();
  return mode === 'dark' ? DARK : LIGHT;
}

/** 非 hook 版本：在 useMemo 里需要按 mode 取值时用 */
export function chartPalette(mode: ThemeMode): ChartPalette {
  return mode === 'dark' ? DARK : LIGHT;
}

/** 通用 tooltip 配置 */
export function tooltipStyle(p: ChartPalette) {
  return {
    backgroundColor: p.tooltipBg,
    borderColor: p.tooltipBorder,
    borderWidth: 1,
    textStyle: { color: p.tooltipText, fontSize: 12 },
    extraCssText: 'box-shadow:0 6px 16px rgba(0,51,120,.12);border-radius:8px;',
  };
}

/** 数字格式化：千分位 */
export function fmtNum(v: number | null | undefined, digits = 0): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 比率格式化：0.1234 → '12.34%' */
export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '-';
  return `${(Number(v) * 100).toFixed(digits)}%`;
}

/** 环比格式化：已是百分数，带正负号 */
export function fmtDelta(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '-';
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

/** 金额格式化：12345.6 → '¥12,345.6' */
export function fmtMoney(v: number | null | undefined, digits = 0): string {
  return `¥${fmtNum(v, digits)}`;
}
