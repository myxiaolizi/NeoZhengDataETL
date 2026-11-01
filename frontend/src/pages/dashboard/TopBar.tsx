/** V9.2 顶栏：LOGO + 标题 + 同步时间 + 筛选区 + 操作区
 *
 * 视觉层次（左 → 右）：
 *   ┌─ 品牌区 ────────┐ ┃ ┌─ 筛选浮动条（改数据）───────────────┐  ┌─ 操作区（执行动作）──┐
 *   │ LOGO  标题       │ ┃ │ [日期][区域][类型][销售][全部][重置] │  │ [有效][刷新][色][手机] │
 *   │       ● 同步时间 │ ┃ └────────────────────────────────────┘  └──────────────────────┘
 *   └─────────────────┘
 *
 * 设计要点：
 *   1. 标题 19px + 副标题 12px(--text3)，与筛选条用间距明确分层
 *   2. 筛选区包一层「浮动条」：--panel 底 + --line 细边框 + --radius + 克制阴影
 *   3. 筛选（改数据）与操作（执行动作）用间距 + 竖分隔线区分
 *   4. 所有字号 ≥ 11px，全部走 --fs-* 令牌
 *
 * 仅样式/布局改动，筛选与操作的数据逻辑（props 与回调）完全不变。
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
        background: 'color-mix(in srgb, var(--panel) 92%, transparent)',
        backdropFilter: 'saturate(180%) blur(16px)',
        WebkitBackdropFilter: 'saturate(180%) blur(16px)',
        borderBottom: '1px solid var(--line)',
        boxShadow: '0 1px 2px rgba(15,23,42,.04)',
        // 顶栏贴边：Board 根节点已有 20px（移动端 12px）内边距，这里用等量负 margin 抵消。
        margin: isMobile ? '-12px -12px 0' : '-20px -20px 0',
        width: isMobile ? 'calc(100% + 24px)' : 'calc(100% + 40px)',
        boxSizing: 'border-box',
        padding: isMobile ? '10px 12px' : '12px 20px',
        overflowX: 'clip',
      }}
    >
      <div
        style={{
          display: 'flex',
          // 移动端：品牌区 + 操作区占第一行，筛选条独占第二行整宽
          // （否则筛选条被挤到 0 宽，横向滚动不可用）
          flexWrap: isMobile ? 'wrap' : 'nowrap',
          alignItems: 'center',
          rowGap: 8,
          columnGap: isMobile ? 8 : 16,
          minWidth: 0,
        }}
      >
        {/* ══════════ 左：品牌区（LOGO + 标题 + 同步时间） ══════════ */}
        <div
          style={{
            display: 'flex',
            order: isMobile ? 1 : 0,
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
              borderRadius: 'var(--radius-sm)',
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              overflow: 'hidden',
              background: 'var(--panel)',
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
                fontSize: isMobile ? 'var(--fs-sm)' : '19px',
                fontWeight: 700,
                letterSpacing: '-.2px',
                color: 'var(--text)',
                margin: 0,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </h1>
            {!isMobile && (
              <p
                style={{
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text3)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  margin: '3px 0 0',
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: refreshing ? 'var(--warn)' : 'var(--green)',
                    flexShrink: 0,
                    boxShadow: `0 0 0 3px color-mix(in srgb, ${refreshing ? 'var(--warn)' : 'var(--green)'} 18%, transparent)`,
                    animation: refreshing ? 'boardPulse 1.2s ease-in-out infinite' : 'none',
                    transition: 'background .2s',
                  }}
                />
                {syncedLabel}
              </p>
            )}
          </div>
        </div>

        {/* 品牌区 | 筛选区 之间的分隔线 */}
        {!isMobile && (
          <span
            aria-hidden
            style={{
              width: 1,
              alignSelf: 'stretch',
              minHeight: 30,
              background: 'var(--line)',
              flexShrink: 0,
            }}
          />
        )}

        {/* ══════════ 中：筛选区（无外框） ══════════ */}
        <div
          style={{
            minWidth: 0,
            // 移动端：basis 100% 独占一整行（order 3）；桌面：按内容自适应
            flex: isMobile ? '1 0 100%' : '0 1 auto',
            order: isMobile ? 3 : 0,
            width: isMobile ? '100%' : 'auto',
            // V10 T7：移除浮动条外框（原 --panel 底 + --line 边 + 圆角 + 阴影）
          }}
        >
          <FilterBar
            filters={filters}
            onChange={onChange}
            onReset={onReset}
            options={options}
            counts={counts}
            isMobile={isMobile}
          />
        </div>

        {/* 弹性撑开（移动端不需要，由筛选条换行占位） */}
        {!isMobile && <div style={{ flex: 1, minWidth: 8 }} />}

        {/* ══════════ 右：操作区（执行动作） ══════════ */}
        <div
          style={{
            flexShrink: 0,
            order: isMobile ? 2 : 0,
            marginLeft: isMobile ? 'auto' : 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {/* 筛选 | 操作 分隔线，强化「改数据 / 执行动作」的分界 */}
          {!isMobile && (
            <span
              aria-hidden
              style={{
                width: 1,
                height: 22,
                background: 'var(--line)',
                flexShrink: 0,
              }}
            />
          )}
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
