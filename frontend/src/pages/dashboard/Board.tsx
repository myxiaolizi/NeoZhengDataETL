/** V5.0 中康智能体客户看板 · 页面容器
 *
 * 职责：
 *   1. 维护筛选状态，调用 GET /api/crm/board 拉取全量数据
 *   2. 明暗主题 + 主题色（localStorage 持久化）
 *   3. 标题栏（LOGO / 名称 / 同步时间）+ 筛选区 + 操作区
 *   4. 按顺序渲染第 1~10 排
 *
 * 各排组件都在 ./board/ 下，纯展示，只吃 props。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Empty, Grid, Result, Skeleton } from 'antd';
import dayjs from 'dayjs';
import {
  BoardData, BoardFilters, emptyFilters, fetchBoard,
} from '@/api/crm-board';
import TopBar from './TopBar';
import SigningCards from './board/SigningCards';
import FlowPipeline from './board/FlowPipeline';
import TypeSummary from './board/TypeSummary';
import Rankings from './board/Rankings';
import ComparePanel from './board/ComparePanel';
import SignTrend from './board/SignTrend';
import FlowProgress from './board/FlowProgress';
import RunMetrics from './board/RunMetrics';
import RunBreakdown from './board/RunBreakdown';
import RunTrend from './board/RunTrend';
import DetailTable from './board/DetailTable';

const { useBreakpoint } = Grid;

const LS_DARK = 'crmboard.dark';
const LS_PRIMARY = 'crmboard.primary';

/** 主题色候选（V6：对齐参考站品牌色系） */
const PRIMARY_OPTIONS = ['#2563eb', '#3b82f6', '#0ea5e9', '#10b981', '#8b5cf6', '#f59e0b'];

/**
 * V6.0 设计令牌（从 https://zk2.zhengl.vip/pc4.html 实测提取）
 *
 * 两套变量同时注入：
 *   1. 新变量（--bg / --panel / --line / --text / --brand …）—— 参考站命名，V6 组件用
 *   2. 旧变量别名（--bg-page / --bg-card / --text-main …）—— V5 组件仍在用，映射到新值
 *
 * 这样新旧组件可以共存，不会因为令牌改名而出现「透明背景」这类问题。
 */
function themeVars(dark: boolean, primary: string): React.CSSProperties {
  const light = {
    /* ── 新令牌 ── */
    '--bg': '#f2f6fc',
    '--bg2': '#e8f0fb',
    '--panel': '#ffffff',
    '--panel2': '#f7faff',
    '--line': '#dde8f6',
    '--line2': '#eaf2fb',
    '--text': '#16253d',
    '--text2': '#5a7191',
    '--text3': '#93a7c2',
    '--brand': primary,
    '--brand2': '#3b82f6',
    '--brand3': '#60a5fa',
    '--brandSoft': '#e9f2ff',
    '--green': '#10b981',
    '--green2': '#34d399',
    '--greenSoft': '#e6f8f1',
    '--warn': '#f59e0b',
    '--danger': '#ef4444',
    '--purple': '#8b5cf6',
    '--cyan': '#06b6d4',
    '--pink': '#ec4899',
    '--orange-d': '#f59e0b',
    '--shadow': '0 1px 2px rgba(20,52,102,.04), 0 4px 14px rgba(20,52,102,.055)',
    '--shadow2': '0 2px 8px rgba(20,52,102,.07), 0 18px 44px rgba(20,52,102,.11)',
    '--radius': '16px',
    '--radius-sm': '11px',
    '--primary': primary,
    /* ── 旧变量别名（V5 组件兼容） ── */
    '--bg-page': '#f2f6fc',
    '--bg-card': '#ffffff',
    '--bg-card-2': '#f7faff',
    '--bg-hover': 'rgba(37,99,235,.07)',
    '--text-main': '#16253d',
    '--text-sub': '#5a7191',
    '--text-mute': '#93a7c2',
    '--border': '#dde8f6',
    '--border-strong': '#60a5fa',
  };
  const darkVars = {
    /* ── 新令牌 ── */
    '--bg': '#0a1220',
    '--bg2': '#0e1a2e',
    '--panel': '#101d33',
    '--panel2': '#14233c',
    '--line': '#1e3252',
    '--line2': '#182a45',
    '--text': '#e2e8f0',
    '--text2': '#94a8c4',
    '--text3': '#6b82a3',
    '--brand': primary,
    '--brand2': '#60a5fa',
    '--brand3': '#93c5fd',
    '--brandSoft': '#16294a',
    '--green': '#34d399',
    '--green2': '#10b981',
    '--greenSoft': '#0f2e26',
    '--warn': '#fbbf24',
    '--danger': '#f87171',
    '--purple': '#a78bfa',
    '--cyan': '#22d3ee',
    '--pink': '#f472b6',
    '--orange-d': '#fbbf24',
    '--shadow': '0 1px 2px rgba(0,0,0,.35), 0 4px 14px rgba(0,0,0,.30)',
    '--shadow2': '0 2px 8px rgba(0,0,0,.40), 0 18px 44px rgba(0,0,0,.45)',
    '--radius': '16px',
    '--radius-sm': '11px',
    '--primary': primary,
    /* ── 旧变量别名 ── */
    '--bg-page': '#0a1220',
    '--bg-card': '#101d33',
    '--bg-card-2': '#14233c',
    '--bg-hover': 'rgba(96,165,250,.12)',
    '--text-main': '#e2e8f0',
    '--text-sub': '#94a8c4',
    '--text-mute': '#6b82a3',
    '--border': '#1e3252',
    '--border-strong': '#93c5fd',
  };
  return (dark ? darkVars : light) as React.CSSProperties;
}

export default function Board() {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [filters, setFilters] = useState<BoardFilters>(emptyFilters);
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [dark, setDark] = useState<boolean>(() => {
    try { return localStorage.getItem(LS_DARK) === '1'; } catch { return false; }
  });
  const [primary, setPrimary] = useState<string>(() => {
    try { return localStorage.getItem(LS_PRIMARY) || PRIMARY_OPTIONS[0]; } catch { return PRIMARY_OPTIONS[0]; }
  });

  // 首屏只请求一次；筛选变化后重新请求
  const reqSeq = useRef(0);

  const load = useCallback(async (f: BoardFilters, opts?: { silent?: boolean }) => {
    const seq = ++reqSeq.current;
    if (opts?.silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const d = await fetchBoard(f, { silent: opts?.silent });
      if (seq !== reqSeq.current) return; // 丢弃过期响应
      setData(d);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setError(e instanceof Error ? e.message : '看板数据加载失败');
    } finally {
      if (seq === reqSeq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => { void load(filters); }, [filters, load]);

  /* ── 主题：写 html data-theme + CSS 变量，并通知 echarts 组件 ── */
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    try {
      localStorage.setItem(LS_DARK, dark ? '1' : '0');
      localStorage.setItem(LS_PRIMARY, primary);
    } catch { /* 隐私模式忽略 */ }
    window.dispatchEvent(new Event('board:theme'));
  }, [dark, primary]);

  /* 离开看板时清掉 html 上的 data-theme，避免影响平台其它页面的弹层配色 */
  useEffect(() => () => {
    delete document.documentElement.dataset.theme;
    window.dispatchEvent(new Event('board:theme'));
  }, []);

  /* ── 筛选操作 ── */
  const onChange = useCallback((patch: Partial<BoardFilters>) => {
    setFilters((cur) => ({ ...cur, ...patch }));
  }, []);
  const onReset = useCallback(() => setFilters(emptyFilters()), []);

  const onToggleValid = useCallback(() => {
    setFilters((cur) => ({ ...cur, validOnly: !cur.validOnly }));
  }, []);

  /** 刷新：重新拉数据，不动页面、不清筛选 */
  const onRefresh = useCallback(() => { void load(filters, { silent: true }); }, [filters, load]);

  /* ── 同步时间显示：-同步时间：MM/DD HH:mm ── */
  const syncedLabel = useMemo(() => {
    const iso = data?.meta?.syncedAt;
    if (!iso) return '-同步时间：--/-- --:--';
    const d = dayjs(iso);
    return d.isValid() ? `-同步时间：${d.format('MM/DD HH:mm')}` : '-同步时间：--/-- --:--';
  }, [data?.meta?.syncedAt]);

  const activeCount = useMemo(() => {
    let k = 0;
    if (filters.datePreset !== 'all') k += 1;
    const arrKeys: (keyof BoardFilters)[] = [
      'regions', 'chainTypes', 'sales', 'flowStatus', 'service', 'solution',
      'trainer', 'version', 'connectResult', 'trainResult', 'openedStrategy',
    ];
    arrKeys.forEach((key) => {
      const v = filters[key];
      if (Array.isArray(v) && v.length) k += 1;
    });
    if (filters.validOnly) k += 1;
    return k;
  }, [filters]);

  return (
    <div
      className="board-root"
      data-theme={dark ? 'dark' : 'light'}
      style={{
        // 覆盖 Layout 的白底，让明暗主题真正生效
        ...themeVars(dark, primary),
        // 抵消 Layout 的 padding，让底色铺满（用负 margin 撑满可视区）
        // 移动端 Content padding 是 10，桌面是 16
        margin: isMobile ? -10 : -16,
        padding: isMobile ? 12 : 20,
        background: 'var(--bg)',
        minHeight: 'calc(100vh - 120px)',
        color: 'var(--text)',
        transition: 'background .2s ease',
        // 注意：这里**不能**设 overflow（含 overflowX:hidden）。
        // 一旦设置，board-root 就变成滚动容器，内部 position:sticky 的顶栏会失效。
        // 横向溢出由下面的内容区裁剪（见 .board-content）。
      }}
    >
      {/* ══════════ 顶栏：标题 + 筛选 + 操作，合并为 1 行（sticky 吸顶）══════════ */}
      <TopBar
        syncedLabel={syncedLabel}
        refreshing={refreshing}
        filters={filters}
        onChange={onChange}
        onReset={onReset}
        options={data?.meta.options || {
          regions: [], chainTypes: [], sales: [], flowStatus: [], service: [],
          solution: [], trainer: [], version: [], connectResult: [],
          trainResult: [], openedStrategy: [],
        }}
        counts={data?.meta.counts || {
          region: {}, chainType: {}, sales: {}, flowStatus: {}, service: {},
          solution: {}, trainer: {}, version: {}, connectResult: {},
          trainResult: {}, openedStrategy: {},
        }}
        validOnly={filters.validOnly}
        onToggleValid={onToggleValid}
        onRefresh={onRefresh}
        dark={dark}
        onToggleDark={() => setDark((d) => !d)}
        primary={primary}
        onPrimaryChange={setPrimary}
      />

      {/* 内容区：统一左右留白，与顶栏解耦 */}
      <div
        className="board-content"
        style={{
          paddingTop: isMobile ? 12 : 16,
          // 横向溢出在这里裁剪（宽表格自身在 .ant-table-content 内部横滚）
          maxWidth: '100%',
          overflowX: 'hidden',
        }}
      >

      {activeCount > 0 && (
        <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--text3)' }}>
          已应用 {activeCount} 个筛选条件
          {data && ` · 当前 ${data.row1.totalClients} 家客户 / ${data.row1.totalStores} 家门店`}
        </div>
      )}

      {/* ══════════ 内容 ══════════ */}
      {loading && !data ? (
        <div style={{ marginTop: 16, padding: 20, background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)' }}>
          <Skeleton active paragraph={{ rows: 8 }} />
        </div>
      ) : error ? (
        <div style={{ marginTop: 16, background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)' }}>
          <Result
            status="warning"
            title="看板数据加载失败"
            subTitle={error}
            extra={
              <Alert
                type="info"
                showIcon
                message="可能原因：未登录 / 权限不足 / 后端未重启 / 数据库连接异常"
                description="请先确认服务已重启并包含 /api/crm/board 端点，然后点击「刷新」。"
              />
            }
          />
        </div>
      ) : data ? (
        <>
          {/* 第 1 排：签约卡片区（卡片自身带标题） */}
          <SigningCards data={data} loading={loading} isMobile={isMobile} />

          {/* 第 2 排：流程状态分布（卡片自身带标题） */}
          <div style={{ marginTop: isMobile ? 12 : 14 }}>
            <FlowPipeline data={data} loading={loading} isMobile={isMobile} />
          </div>

          {/* 第 3 排：类型汇总 + 排行榜（各卡片自带标题） */}
          <div
            className="board-row3"
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 0.85fr) minmax(0, 2.15fr)',
              gap: 12,
              alignItems: 'start',
              marginTop: isMobile ? 12 : 14,
            }}
          >
            <TypeSummary data={data} loading={loading} isMobile={isMobile} />
            <Rankings data={data} loading={loading} isMobile={isMobile} />
          </div>

          {/* 第 4-5 排：签约数据同环比（仅本周/上周/本月/上月显示） */}
          {data.compare && (
            <div style={{ marginTop: isMobile ? 12 : 14 }}>
              <ComparePanel data={data} loading={loading} isMobile={isMobile} />
            </div>
          )}

          {/* 第 6 排：签约趋势 + 流程处理（各卡片自带标题） */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.45fr) minmax(0, 1fr)',
              gap: 12,
              alignItems: 'start',
              marginTop: isMobile ? 12 : 14,
            }}
          >
            <SignTrend data={data} loading={loading} isMobile={isMobile} />
            <FlowProgress data={data} loading={loading} isMobile={isMobile} />
          </div>

          {/* 第 7 排：客户运行情况（卡片自带标题「客户运行情况」） */}
          <div style={{ marginTop: isMobile ? 12 : 14 }}>
            <RunMetrics data={data} loading={loading} isMobile={isMobile} />
          </div>

          {/* 第 8 排：策略运行情况（名称由卡片标题承载） */}
          <div style={{ marginTop: isMobile ? 12 : 14 }}>
            <RunBreakdown data={data} loading={loading} isMobile={isMobile} />
          </div>

          {/* 第 9 排：策略运行趋势（名称由卡片标题承载） */}
          <div style={{ marginTop: isMobile ? 12 : 14 }}>
            <RunTrend data={data} loading={loading} isMobile={isMobile} />
          </div>

          {/* 第 10 排：客户明细表（卡片自带标题「客户明细」） */}
          <div style={{ marginTop: isMobile ? 12 : 14 }}>
            <DetailTable data={data} loading={loading} isMobile={isMobile} />
          </div>
        </>
      ) : (
        <div style={{ marginTop: 16, padding: 40, background: 'var(--panel)', borderRadius: 16, border: '1px solid var(--line)' }}>
          <Empty description="暂无数据" />
        </div>
      )}

      <div style={{ height: 24 }} />
      </div>{/* /内容区 */}
    </div>
  );
}
