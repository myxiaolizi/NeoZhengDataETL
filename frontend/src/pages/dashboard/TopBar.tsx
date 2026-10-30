/** V6.0 顶栏：LOGO + 标题 + 同步时间 + 筛选区 + 操作区，全部合并在 1 行（sticky 吸顶）
 *
 * 结构（参考 zk2.zhengl.vip/pc4.html）：
 *   [LOGO] 标题            [日期][区域][类型][销售][全部条件][重置]   ……spacer……   [有效][刷新][☀][主题][📱]
 *           ● 同步时间
 */
import React from 'react';
import { Grid } from 'antd';
import type {
  BoardCounts, BoardFilters, BoardOptions,
} from '@/api/crm-board';
import FilterBar from './board/FilterBar';
import ActionBar from './board/ActionBar';

const { useBreakpoint } = Grid;

const LOGO = 'https://wenjian.zhengl.vip/zkkj/logof.png';
const TITLE = '中康智能体客户看板';

interface Props {
  title?: string;
  syncedLabel: string;
  refreshing: boolean;

  filters: BoardFilters;
  onChange: (patch: Partial<BoardFilters>) => void;
  onReset: () => void;
  options: BoardOptions;
  counts: BoardCounts;

  validOnly: boolean;
  onToggleValid: () => void;
  onRefresh: () => void;
  dark: boolean;
  onToggleDark: () => void;
  primary: string;
  onPrimaryChange: (c: string) => void;
}

export default function TopBar({
  title = TITLE,
  syncedLabel,
  refreshing,
  filters,
  onChange,
  onReset,
  options,
  counts,
  validOnly,
  onToggleValid,
  onRefresh,
  dark,
  onToggleDark,
  primary,
  onPrimaryChange,
}: Props) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  return (
    <header
      className="board-topbar"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 60,
        // 毛玻璃：参考站用 color-mix + backdrop-filter
        background: 'color-mix(in srgb, var(--panel) 88%, transparent)',
        backdropFilter: 'saturate(200%) blur(18px)',
        WebkitBackdropFilter: 'saturate(200%) blur(18px)',
        borderBottom: '1px solid var(--line)',
        boxShadow: '0 1px 0 rgba(255,255,255,.55) inset, 0 1px 3px rgba(20,52,102,.03)',
        // 顶栏贴边：Board 根节点已有 20px（移动端 12px）内边距，
        // 这里用等量负 margin 抵消。宽度必须显式补偿，否则会撑出横向滚动条。
        margin: isMobile ? '-12px -12px 0' : '-20px -20px 0',
        width: isMobile ? 'calc(100% + 24px)' : 'calc(100% + 40px)',
        boxSizing: 'border-box',
        padding: isMobile ? '8px 12px' : '11px 20px',
        // 内部筛选按钮多时横向滚动，绝不撑破页面
        overflowX: 'clip',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: isMobile ? 8 : 14,
          minWidth: 0,
        }}
      >
        {/* ── 左：LOGO + 标题 + 同步时间 ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: isMobile ? 32 : 38,
              height: isMobile ? 32 : 38,
              borderRadius: 10,
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              overflow: 'hidden',
              background: 'var(--panel)',
              boxShadow: '0 2px 8px rgba(20,52,102,.10)',
              border: '1px solid var(--line)',
            }}
          >
            <img
              src={LOGO}
              alt="LOGO"
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                fontSize: isMobile ? 14 : 16,
                fontWeight: 700,
                letterSpacing: 0.2,
                color: 'var(--text)',
                margin: 0,
                lineHeight: 1.25,
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </h1>
            {!isMobile && (
              <p
                style={{
                  fontSize: 10.5,
                  color: 'var(--text3)',
                  letterSpacing: 0.2,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  margin: '1px 0 0',
                  whiteSpace: 'nowrap',
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: 'var(--green)',
                    flexShrink: 0,
                    boxShadow: '0 0 0 2px color-mix(in srgb, var(--green) 22%, transparent)',
                    animation: refreshing ? 'boardPulse 1.2s ease-in-out infinite' : 'none',
                  }}
                />
                {syncedLabel}
              </p>
            )}
          </div>
        </div>

        {/* 竖分隔线 */}
        {!isMobile && (
          <span
            style={{
              width: 1,
              height: 24,
              background: 'var(--line)',
              flexShrink: 0,
              marginLeft: 2,
            }}
          />
        )}

        {/* ── 中：筛选区 ── */}
        <div style={{ minWidth: 0, flex: isMobile ? 1 : '0 1 auto', overflow: 'hidden' }}>
          <FilterBar
            filters={filters}
            onChange={onChange}
            onReset={onReset}
            options={options}
            counts={counts}
            isMobile={isMobile}
          />
        </div>

        {/* 弹性撑开 */}
        <div style={{ flex: 1, minWidth: 8 }} />

        {/* ── 右：操作区 ── */}
        <div style={{ flexShrink: 0 }}>
          <ActionBar
            validOnly={validOnly}
            onToggleValid={onToggleValid}
            onRefresh={onRefresh}
            dark={dark}
            onToggleDark={onToggleDark}
            primary={primary}
            onPrimaryChange={onPrimaryChange}
            isMobile={isMobile}
          />
        </div>
      </div>

      {/* 刷新时底部进度条 */}
      {refreshing && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: -1,
            height: 2,
            overflow: 'hidden',
            borderRadius: 1,
          }}
        >
          <div
            style={{
              height: '100%',
              width: '35%',
              background: 'linear-gradient(90deg, transparent, var(--brand), transparent)',
              animation: 'boardSlide 1.1s ease-in-out infinite',
            }}
          />
        </div>
      )}
    </header>
  );
}
