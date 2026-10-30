/**
 * 数据卡片组（V4.1 统一规范）
 *
 * 规则：
 *  - 单排展示，桌面端 3~8 个；超过 8 个只取前 8 个（超出请拆分页面）。
 *  - 每卡：左侧色条 + 标签 + 大号数值 + 可选提示/趋势。
 *  - 移动端自动降到 2 列，避免横向溢出。
 */
import React from 'react';
import { Grid } from 'antd';
import { NEUTRAL, SHADOW, statColor } from '@/theme';

export interface StatCardItem {
  key?: string;
  /** 卡片标签，如「数据项目」 */
  label: React.ReactNode;
  /** 主数值 */
  value: React.ReactNode;
  /** 数值后缀，如「个」「%」 */
  suffix?: React.ReactNode;
  /** 底部提示文字 */
  hint?: React.ReactNode;
  /** 自定义强调色，缺省按顺序取主题色 */
  color?: string;
  /** 点击跳转/筛选回调 */
  onClick?: () => void;
}

const { useBreakpoint } = Grid;

/** 一排放几个：3~8，超出按 8 封顶 */
function columnsOf(count: number): number {
  return Math.min(Math.max(count, 3), 8);
}

export default function StatCards({ items }: { items: StatCardItem[] }) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const list = (items || []).slice(0, 8);
  if (!list.length) return null;

  const cols = isMobile ? Math.min(list.length, 2) : columnsOf(list.length);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: isMobile ? 8 : 12,
      }}
    >
      {list.map((it, i) => {
        const color = it.color || statColor(i);
        return (
          <div
            key={it.key || String(i)}
            onClick={it.onClick}
            role={it.onClick ? 'button' : undefined}
            tabIndex={it.onClick ? 0 : undefined}
            style={{
              position: 'relative',
              background: NEUTRAL.surface,
              border: `1px solid ${NEUTRAL.border}`,
              borderLeft: `3px solid ${color}`,
              borderRadius: 12,
              padding: isMobile ? '10px 12px' : '12px 14px',
              boxShadow: SHADOW.card,
              cursor: it.onClick ? 'pointer' : 'default',
              transition: 'box-shadow .18s ease, border-color .18s ease, transform .18s ease',
              minWidth: 0,
            }}
            onMouseEnter={(e) => {
              if (!it.onClick) return;
              e.currentTarget.style.boxShadow = SHADOW.raised;
              e.currentTarget.style.borderColor = NEUTRAL.borderStrong;
            }}
            onMouseLeave={(e) => {
              if (!it.onClick) return;
              e.currentTarget.style.boxShadow = SHADOW.card;
              e.currentTarget.style.borderColor = NEUTRAL.border;
            }}
          >
            <div
              style={{
                fontSize: 12.5,
                color: NEUTRAL.textTertiary,
                fontWeight: 500,
                lineHeight: 1.3,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={typeof it.label === 'string' ? it.label : undefined}
            >
              {it.label}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: isMobile ? 19 : 24,
                fontWeight: 700,
                color,
                lineHeight: 1.15,
                letterSpacing: '-.3px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {it.value}
              {it.suffix ? (
                <span style={{ fontSize: 12.5, fontWeight: 500, color: NEUTRAL.textTertiary, marginLeft: 4 }}>
                  {it.suffix}
                </span>
              ) : null}
            </div>
            {it.hint ? (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 11.5,
                  color: NEUTRAL.textQuaternary,
                  lineHeight: 1.35,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={typeof it.hint === 'string' ? it.hint : undefined}
              >
                {it.hint}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
