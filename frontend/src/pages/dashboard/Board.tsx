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
import { Alert, Empty, Grid, Result, Skeleton, Space, Spin } from 'antd';
import dayjs from 'dayjs';
import {
  BoardData, BoardFilters, emptyFilters, fetchBoard,
} from '@/api/crm-board';
import FilterBar from './board/FilterBar';
import ActionBar from './board/ActionBar';
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

const LOGO = 'https://wenjian.zhengl.vip/zkkj/logof.png';
const TITLE = '中康智能体客户看板';

const LS_DARK = 'crmboard.dark';
const LS_PRIMARY = 'crmboard.primary';

/** 主题色候选（只用契约 13 色里的深色系，保证白字/深字都能读） */
const PRIMARY_OPTIONS = ['#3687FF', '#45B4FF', '#2D6FE4', '#003378', '#EC673C', '#A2D73C'];

/** 主题变量对象：直接作为内联 CSS 自定义属性挂在看板根节点上
 *
 * 说明：内联 style 支持 `--x: value` 自定义属性，子节点全部继承。
 * 比注入 <style> 更安全 —— 不会污染其它页面的 :root。
 */
function themeVars(dark: boolean, primary: string): React.CSSProperties {
  const base = dark
    ? {
      '--bg-page': '#071426',
      '--bg-card': '#0E2038',
      '--bg-card-2': '#12263F',
      '--bg-hover': 'rgba(115,219,255,.10)',
      '--text-main': '#DCDDDD',
      '--text-sub': 'rgba(220,221,221,.66)',
      '--text-mute': 'rgba(220,221,221,.42)',
      '--border': 'rgba(115,219,255,.22)',
      '--border-strong': 'rgba(115,219,255,.38)',
      '--shadow': '0 1px 2px rgba(0,0,0,.32), 0 2px 10px rgba(0,0,0,.24)',
    }
    : {
      '--bg-page': '#F5F8FF',
      '--bg-card': '#FFFFFF',
      '--bg-card-2': 'rgba(54,135,255,.035)',
      '--bg-hover': 'rgba(115,219,255,.16)',
      '--text-main': '#003378',
      '--text-sub': 'rgba(0,51,120,.66)',
      '--text-mute': 'rgba(0,51,120,.42)',
      '--border': 'rgba(54,135,255,.28)',
      '--border-strong': 'rgba(54,135,255,.45)',
      '--shadow': '0 1px 2px rgba(0,51,120,.06), 0 2px 8px rgba(54,135,255,.08)',
    };
  return { ...base, '--primary': primary } as React.CSSProperties;
}

/** 排区标题 */
function SectionTitle({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        margin: '20px 0 10px', gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ width: 3, height: 14, borderRadius: 2, background: 'var(--primary)', flexShrink: 0 }} />
        <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
          {children}
        </span>
      </div>
      {extra}
    </div>
  );
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
        // 覆盖 Layout 的白底，让暗色模式真正生效
        ...themeVars(dark, primary),
        margin: isMobile ? -12 : -20,
        padding: isMobile ? 12 : 20,
        background: 'var(--bg-page)',
        minHeight: 'calc(100vh - 120px)',
        color: 'var(--text-main)',
        transition: 'background .2s ease',
        // 兜底：任何子元素都不允许把整页撑出横向滚动条
        // （宽表格自身在 .ant-table-content 内部横向滚动，不受影响）
        maxWidth: '100%',
        overflowX: 'hidden',
      }}
    >

      {/* ══════════ 标题栏 ══════════ */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: isMobile ? '12px 14px' : '14px 20px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: 'var(--shadow)',
          flexWrap: 'wrap',
        }}
      >
        <img
          src={LOGO}
          alt="LOGO"
          style={{ width: isMobile ? 34 : 42, height: isMobile ? 34 : 42, objectFit: 'contain', flexShrink: 0 }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: isMobile ? 17 : 22, fontWeight: 800, letterSpacing: 0.4,
              color: 'var(--text-main)', lineHeight: 1.25,
            }}
          >
            {TITLE}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 3 }}>
            {syncedLabel}
          </div>
        </div>
        {refreshing && (
          <span style={{ fontSize: 12, color: 'var(--text-sub)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Spin size="small" /> 正在获取最新数据…
          </span>
        )}
      </div>

      {/* ══════════ 筛选区 ══════════ */}
      <div
        style={{
          marginTop: 12,
          padding: isMobile ? '10px 12px' : '12px 16px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: 'var(--shadow)',
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'stretch' : 'center',
          gap: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <FilterBar
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
            isMobile={isMobile}
          />
        </div>
        <div style={{ flexShrink: 0 }}>
          <ActionBar
            validOnly={filters.validOnly}
            onToggleValid={onToggleValid}
            onRefresh={onRefresh}
            dark={dark}
            onToggleDark={() => setDark((d) => !d)}
            primary={primary}
            onPrimaryChange={setPrimary}
            isMobile={isMobile}
          />
        </div>
      </div>

      {activeCount > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-mute)' }}>
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
          {/* 第 1 排：签约卡片区 */}
          <SectionTitle>签约概览</SectionTitle>
          <SigningCards data={data} loading={loading} isMobile={isMobile} />

          {/* 第 2 排：流程状态分布 */}
          <SectionTitle>流程状态分布</SectionTitle>
          <FlowPipeline data={data} loading={loading} isMobile={isMobile} />

          {/* 第 3 排：类型汇总 + 排行榜 */}
          <SectionTitle>类型汇总与排行</SectionTitle>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) minmax(0, 2fr)',
              gap: 12,
              alignItems: 'stretch',
            }}
          >
            <TypeSummary data={data} loading={loading} isMobile={isMobile} />
            <Rankings data={data} loading={loading} isMobile={isMobile} />
          </div>

          {/* 第 4-5 排：签约数据同环比（仅本周/上周/本月/上月显示） */}
          {data.compare && (
            <>
              <SectionTitle>签约数据同环比</SectionTitle>
              <ComparePanel data={data} loading={loading} isMobile={isMobile} />
            </>
          )}

          {/* 第 6 排：签约趋势 + 流程推进 */}
          <SectionTitle>签约趋势与流程推进</SectionTitle>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.45fr) minmax(0, 1fr)',
              gap: 12,
              alignItems: 'stretch',
            }}
          >
            <SignTrend data={data} loading={loading} isMobile={isMobile} />
            <FlowProgress data={data} loading={loading} isMobile={isMobile} />
          </div>

          {/* 第 7 排：客户运行情况 */}
          <SectionTitle>客户运行情况</SectionTitle>
          <RunMetrics data={data} loading={loading} isMobile={isMobile} />

          {/* 第 8 排：按策略模型 × 策略类型 */}
          <SectionTitle>策略模型 / 类型 · 分区域运行情况</SectionTitle>
          <RunBreakdown data={data} loading={loading} isMobile={isMobile} />

          {/* 第 9 排：近 30 日趋势 */}
          <SectionTitle>客户运行趋势（近 30 日）</SectionTitle>
          <RunTrend data={data} loading={loading} isMobile={isMobile} />

          {/* 第 10 排：客户明细表 */}
          <SectionTitle>客户明细</SectionTitle>
          <DetailTable data={data} loading={loading} isMobile={isMobile} />
        </>
      ) : (
        <div style={{ marginTop: 16, padding: 40, background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)' }}>
          <Empty description="暂无数据" />
        </div>
      )}

      <div style={{ height: 24 }} />
    </div>
  );
}
