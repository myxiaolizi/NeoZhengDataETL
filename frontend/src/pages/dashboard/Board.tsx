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
    '--bg': '#f4f6fa',
    '--bg2': '#e9eef7',
    '--panel': '#ffffff',
    '--panel2': '#f8fafd',
    '--line': '#e3e9f2',
    '--line2': '#edf1f8',
    '--text': '#0f172a',
    '--text2': '#475569',
    '--text3': '#8494ab',
    '--brand': primary,
    '--brand2': '#3b82f6',
    '--brand3': '#60a5fa',
    '--brandSoft': '#eff5ff',
    '--green': '#059669',
    '--green2': '#10b981',
    '--greenSoft': '#ecfdf5',
    '--warn': '#d97706',
    '--danger': '#dc2626',
    '--purple': '#7c3aed',
    '--cyan': '#0891b2',
    '--pink': '#db2777',
    '--orange-d': '#ea580c',
    /* V9.2：阴影改为单层克制阴影，避免「浮起来」的塑料感 */
    '--shadow': '0 1px 2px rgba(15,23,42,.04)',
    '--shadow2': '0 4px 16px rgba(15,23,42,.09)',
    '--radius': '14px',
    '--radius-sm': '10px',
    '--primary': primary,
    /**
     * V9.2 字号阶梯（1080P 可读性优先）
     * 只有这 7 级，禁止再用 8/8.5/9/9.5/10.5/14.5 等零碎值。
     */
    /* 南/北区专用语义色：保证明暗两套下都可读 */
    '--south': '#2563eb',
    '--north': '#059669',
    '--fs-2xs': '11px',   /* 极小：单位、角标、表格次要列 */
    '--fs-xs': '12px',    /* 小：卡片副标题、表格正文、标签 */
    '--fs-sm': '13px',    /* 常规：卡片标题、主要正文 */
    '--fs-md': '14px',    /* 中：强调正文、指标名 */
    '--fs-lg': '17px',    /* 大：区块数字 */
    '--fs-xl': '22px',    /* 很大：主指标数字 */
    '--fs-2xl': '28px',   /* 巨大：首页核心 KPI */
    /* 字重阶梯 */
    '--fw-normal': '500',
    '--fw-medium': '600',
    '--fw-bold': '700',
    '--fw-heavy': '750',
    /* ── 旧变量别名（V5 组件兼容） ── */
    '--bg-page': '#f4f6fa',
    '--bg-card': '#ffffff',
    '--bg-card-2': '#f8fafd',
    '--bg-hover': 'rgba(37,99,235,.06)',
    '--text-main': '#0f172a',
    '--text-sub': '#475569',
    '--text-mute': '#8494ab',
    '--border': '#e3e9f2',
    '--border-strong': '#60a5fa',
  };
  const darkVars = {
    /* ── 新令牌 ── */
    '--bg': '#0b1120',
    '--bg2': '#0f1729',
    '--panel': '#141e33',
    '--panel2': '#1a2740',
    '--line': '#243356',
    '--line2': '#1d2a47',
    '--text': '#e8eef8',
    '--text2': '#9db0cc',
    '--text3': '#6d81a3',
    /**
     * 深色模式：brand 必须用亮色。
     * 原来直接用 primary(#2563eb)，在深底 #1a2740 上对比度只有 1.4，几乎看不见。
     * #60a5fa 在 #1a2740 上约 6.9，可读。
     */
    '--brand': '#60a5fa',
    '--brand2': '#93c5fd',
    '--brand3': '#bfdbfe',
    '--brandSoft': '#1c3355',
    '--green': '#34d399',
    '--green2': '#10b981',
    '--greenSoft': '#0f2e26',
    '--warn': '#fbbf24',
    '--danger': '#f87171',
    '--purple': '#a78bfa',
    '--cyan': '#22d3ee',
    '--pink': '#f472b6',
    '--orange-d': '#fbbf24',
    '--shadow': '0 1px 2px rgba(0,0,0,.30)',
    '--shadow2': '0 4px 16px rgba(0,0,0,.42)',
    '--radius': '14px',
    '--radius-sm': '10px',
    '--primary': primary,
    /* 南/北区深色可读色 */
    '--south': '#93c5fd',
    '--north': '#5eead4',
    '--fs-2xs': '11px',
    '--fs-xs': '12px',
    '--fs-sm': '13px',
    '--fs-md': '14px',
    '--fs-lg': '17px',
    '--fs-xl': '22px',
    '--fs-2xl': '28px',
    '--fw-normal': '500',
    '--fw-medium': '600',
    '--fw-bold': '700',
    '--fw-heavy': '750',
    /* ── 旧变量别名 ── */
    '--bg-page': '#0b1120',
    '--bg-card': '#141e33',
    '--bg-card-2': '#1a2740',
    '--bg-hover': 'rgba(96,165,250,.12)',
    '--text-main': '#e8eef8',
    '--text-sub': '#9db0cc',
    '--text-mute': '#6d81a3',
    '--border': '#243356',
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
      {/**
       * V9.2 全局视觉基础
       *
       * 解决「页面太丑」的根因：15 张卡片完全同质（同白底/同圆角/同阴影/同卡头），
       * 且纵向节奏靠每处手写 marginTop，参差不齐。
       * 这里定义统一的排布节奏与卡片基线，各 board 组件只需引用令牌即可保持一致。
       */}
      <style>{`
.board-root{text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}
.board-root *{box-sizing:border-box}
/* 纵向节奏：统一 16px，比原来 12/14 混用更规整 */
.board-stack{display:flex;flex-direction:column;gap:16px}
@media(max-width:768px){.board-stack{gap:12px}}

/* 卡片基线：全部 board 组件共用同一套表面定义 */
.board-root .vb1-card,.board-root .vb3-card,.board-root .vb4-card,
.board-root .vb6-card,.board-root .vb7-card,.board-root .vb8-card,
.board-root .vb9-card,.board-root .vb10-card,.board-root .vb11-card,
.board-root .fm-card{
  background:var(--panel);
  border:1px solid var(--line);
  border-radius:var(--radius);
  box-shadow:var(--shadow);
  transition:border-color .18s ease,box-shadow .18s ease;
}
/* hover 只提亮边框，不做位移（15 张卡同时抖动会很吵） */
.board-root .vb1-card:hover,.board-root .vb3-card:hover,.board-root .vb4-card:hover,
.board-root .vb6-card:hover,.board-root .vb7-card:hover,.board-root .vb8-card:hover,
.board-root .vb9-card:hover,.board-root .vb10-card:hover,.board-root .vb11-card:hover{
  border-color:color-mix(in srgb,var(--brand) 26%,var(--line));
  box-shadow:var(--shadow2);
}

/* 卡片头部统一高度与内距，让各排标题基线对齐 */
.board-root .vb1-h,.board-root .vb3-h,.board-root .vb4-h,
.board-root .vb6-h,.board-root .vb7-h,.board-root .vb8-h,
.board-root .vb9-h,.board-root .vb10-h,.board-root .vb11-h{
  /* V9.2：固定高度，让 15 个卡头基线完全对齐（原来 42~55px 参差） */
  height:48px;min-height:48px;
  padding:0 16px;
  border-bottom:1px solid var(--line2);
  background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 55%,transparent),transparent);
  display:flex;align-items:center;gap:8px;flex-wrap:nowrap;min-width:0;overflow:hidden;
}
/* 卡头内的子元素一律单行，不换行撑高 */
.board-root .vb1-h > *,.board-root .vb3-h > *,.board-root .vb4-h > *,
.board-root .vb6-h > *,.board-root .vb7-h > *,.board-root .vb8-h > *,
.board-root .vb9-h > *,.board-root .vb10-h > *,.board-root .vb11-h > *{
  white-space:nowrap;flex-wrap:nowrap;line-height:1.2;
}
.board-root .vb1-h h3,.board-root .vb3-h h3,.board-root .vb4-h h3,
.board-root .vb6-h h3,.board-root .vb7-h h3,.board-root .vb8-h h3,
.board-root .vb9-h h3,.board-root .vb10-h h3,.board-root .vb11-h h3{
  font-size:var(--fs-sm);font-weight:var(--fw-bold);color:var(--text);
  margin:0;letter-spacing:.1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  display:flex;align-items:center;gap:7px;line-height:1.25;
}

/* V9.2 视觉焦点：核心 KPI 卡加品牌色顶边，与其余中性卡拉开层级 */
.board-root .vb1-card-merged{
  position:relative;
  border-color:color-mix(in srgb,var(--brand) 22%,var(--line));
  background:linear-gradient(180deg,color-mix(in srgb,var(--brandSoft) 42%,var(--panel)) 0%,var(--panel) 62%);
}
.board-root .vb1-card-merged::before{
  content:'';position:absolute;left:0;right:0;top:0;height:3px;
  background:linear-gradient(90deg,var(--brand),var(--brand2),var(--brand3));
  border-radius:var(--radius) var(--radius) 0 0;
}
/* 核心 KPI 数字：全页最大，明确是「最重要的数字」 */
.board-root .vb1-card-merged .vb1-mg-num{
  font-size:var(--fs-2xl);font-weight:var(--fw-heavy);
  color:var(--brand);letter-spacing:-1.2px;line-height:1;
}

/* V9.2 深色模式：南/北区文字统一走专用令牌，避免直接用 --brand 在深底上看不清 */
.board-root[data-theme="dark"] .vb10-mx .mc.s,
.board-root[data-theme="dark"] .vb10-mx .rh.s,
.board-root[data-theme="dark"] .vb1-tb-s.south,
.board-root[data-theme="dark"] .vb9-regs .s,
.board-root[data-theme="dark"] .fm-store strong,
.board-root[data-theme="dark"] .vb9-hint .s{color:var(--south)!important}
.board-root[data-theme="dark"] .vb10-mx .mc.n,
.board-root[data-theme="dark"] .vb10-mx .rh.n,
.board-root[data-theme="dark"] .vb1-tb-s.north,
.board-root[data-theme="dark"] .vb9-regs .n,
.board-root[data-theme="dark"] .vb9-hint .n{color:var(--north)!important}
/* 分隔点/装饰性文字在深色下提升可见度 */
.board-root[data-theme="dark"] .fm-sep{color:var(--text3)!important}
/* 类型 chip 在深色下用深底浅字，不用白字压在浅色块上 */
.board-root[data-theme="dark"] .vb3-chip{color:var(--text)!important;background:var(--panel2)!important;border-color:var(--line)!important}

/* 卡头右侧的辅助文字统一为 11px 弱化色 */
.board-root [class$="-range"],.board-root [class$="-hint"]{
  font-size:var(--fs-2xs);color:var(--text3);font-weight:var(--fw-medium);white-space:nowrap;
}

/* 数字统一等宽，保证竖向对齐 */
.board-root b,.board-root .tabular{font-variant-numeric:tabular-nums}

/* 统一滚动条（表格/横向容器） */
.board-root ::-webkit-scrollbar{width:8px;height:8px}
.board-root ::-webkit-scrollbar-track{background:transparent}
.board-root ::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--text3) 30%,transparent);border-radius:4px}
.board-root ::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--text3) 50%,transparent)}
      `}</style>

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
        <div style={{ marginTop: 16, padding: 20, background: 'var(--panel)', borderRadius: 'var(--radius)', border: '1px solid var(--line)' }}>
          <Skeleton active paragraph={{ rows: 8 }} />
        </div>
      ) : error ? (
        <div style={{ marginTop: 16, background: 'var(--panel)', borderRadius: 'var(--radius)', border: '1px solid var(--line)' }}>
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
        /**
         * V9.2 视觉优化：统一纵向节奏
         * 原来每排都手写 marginTop 12/14，节奏不一致且难以维护。
         * 现在改为 .board-stack 统一管理（gap 16px），视觉更规整。
         */
        <div className="board-stack">
          {/* 第 1 排：签约卡片区（卡片自身带标题） */}
          <SigningCards data={data} loading={loading} isMobile={isMobile} />

          {/* 第 2 排：流程状态分布 */}
          <FlowPipeline data={data} loading={loading} isMobile={isMobile} />

          {/* 第 3 排：类型汇总 + 排行榜 */}
          <div
            className="board-row3"
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 0.85fr) minmax(0, 2.15fr)',
              gap: 16,
              /* V7.2：stretch 让类型卡与排行区等高、底边齐平 */
              alignItems: 'stretch',
            }}
          >
            <TypeSummary data={data} loading={loading} isMobile={isMobile} />
            <Rankings data={data} loading={loading} isMobile={isMobile} />
          </div>

          {/* 第 4-5 排：签约数据同环比（仅本周/上周/本月/上月显示） */}
          {data.compare && <ComparePanel data={data} loading={loading} isMobile={isMobile} />}

          {/* 第 6 排：签约趋势 + 流程处理 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.45fr) minmax(0, 1fr)',
              gap: 16,
              /* V9.2：stretch 让趋势图与表格等高，避免底边参差 */
              alignItems: 'stretch',
            }}
          >
            <SignTrend data={data} loading={loading} isMobile={isMobile} />
            <FlowProgress data={data} loading={loading} isMobile={isMobile} />
          </div>

          {/* 第 7 排：客户运行情况 */}
          <RunMetrics data={data} loading={loading} isMobile={isMobile} />

          {/* 第 8 排：策略运行情况 */}
          <RunBreakdown data={data} loading={loading} isMobile={isMobile} />

          {/* 第 9 排：策略运行趋势 */}
          <RunTrend data={data} loading={loading} isMobile={isMobile} />

          {/* 第 10 排：客户明细表 */}
          <DetailTable data={data} loading={loading} isMobile={isMobile} />
        </div>
      ) : (
        <div style={{ marginTop: 16, padding: 40, background: 'var(--panel)', borderRadius: 'var(--radius)', border: '1px solid var(--line)' }}>
          <Empty description="暂无数据" />
        </div>
      )}

      <div style={{ height: 28 }} />
      </div>{/* /内容区 */}
    </div>
  );
}
