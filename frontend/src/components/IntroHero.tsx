/**
 * IntroHero —— 项目介绍页 Hero 区组件
 *
 * 视觉要点：
 *  - 品牌渐变背景 linear-gradient(135deg, #003378, #2D6FE4, #3687FF)
 *  - 光晕球 + 网格纹理（仅使用调色板颜色的不同透明度，不引入新色相）
 *  - 大标题 + 渐变高亮副标题 + 双 CTA + 关键指标
 *  - <768px 单列、按钮撑满、指标两列
 */
import React, { useState } from 'react';
import { Button, Grid } from 'antd';

const { useBreakpoint } = Grid;

export interface IntroHeroStat {
  value: React.ReactNode;
  label: string;
}

export interface IntroHeroProps {
  /** 顶部胶囊徽标 */
  badge?: React.ReactNode;
  /** 主标题（白色部分） */
  title: React.ReactNode;
  /** 主标题渐变高亮部分（第二行） */
  highlight?: React.ReactNode;
  /** 副标题 / 描述 */
  description?: React.ReactNode;
  /** 关键指标（建议 3-5 个） */
  stats?: IntroHeroStat[];
  /** 主按钮文案（默认「立即进入平台」） */
  primaryText?: string;
  /** 次按钮文案（默认「查看行业案例」） */
  secondaryText?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
  /** 底部补充说明 */
  footnote?: React.ReactNode;
}

export default function IntroHero({
  badge,
  title,
  highlight,
  description,
  stats = [],
  primaryText = '立即进入平台',
  secondaryText = '查看行业案例',
  onPrimary,
  onSecondary,
  footnote,
}: IntroHeroProps) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [hoverPrimary, setHoverPrimary] = useState(false);
  const [hoverGhost, setHoverGhost] = useState(false);

  return (
    <section
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: isMobile ? 14 : 20,
        background: 'linear-gradient(135deg, #003378 0%, #2D6FE4 50%, #3687FF 100%)',
        color: '#FFFFFF',
        padding: isMobile ? '34px 20px 30px' : '64px 56px 56px',
      }}
    >
      {/* 光晕球 */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          width: 520,
          height: 520,
          top: -200,
          left: -140,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(115,219,255,.55) 0%, rgba(115,219,255,0) 70%)',
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          width: 440,
          height: 440,
          bottom: -200,
          right: -100,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(162,215,60,.30) 0%, rgba(162,215,60,0) 70%)',
          pointerEvents: 'none',
        }}
      />
      {/* 网格纹理 */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.07) 1px, transparent 1px)',
          backgroundSize: '46px 46px',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 70% at 50% 40%, #000000 30%, transparent 78%)',
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 40%, #000000 30%, transparent 78%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1080, margin: '0 auto' }}>
        {badge && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 14px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,.35)',
              background: 'rgba(255,255,255,.14)',
              fontSize: 11.5,
              letterSpacing: '.6px',
              textTransform: 'uppercase',
              marginBottom: isMobile ? 16 : 22,
            }}
          >
            {badge}
          </div>
        )}

        <h1
          style={{
            margin: 0,
            fontSize: isMobile ? 27 : 46,
            lineHeight: 1.18,
            fontWeight: 800,
            letterSpacing: '-.5px',
          }}
        >
          {title}
          {highlight && (
            <>
              <br />
              <span
                style={{
                  background: 'linear-gradient(90deg, #FFFFFF 0%, #73DBFF 100%)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                }}
              >
                {highlight}
              </span>
            </>
          )}
        </h1>

        {description && (
          <p
            style={{
              margin: isMobile ? '14px 0 0' : '20px 0 0',
              maxWidth: 760,
              fontSize: isMobile ? 13.5 : 15.5,
              lineHeight: 1.9,
              color: 'rgba(255,255,255,.88)',
            }}
          >
            {description}
          </p>
        )}

        {(onPrimary || onSecondary) && (
          <div
            style={{
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              gap: 12,
              marginTop: isMobile ? 22 : 32,
            }}
          >
            {onPrimary && (
              <Button
                onClick={onPrimary}
                onMouseEnter={() => setHoverPrimary(true)}
                onMouseLeave={() => setHoverPrimary(false)}
                style={{
                  height: 46,
                  minWidth: isMobile ? undefined : 148,
                  padding: '0 28px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#FFFFFF',
                  color: '#003378',
                  fontSize: 14.5,
                  fontWeight: 700,
                  boxShadow: hoverPrimary
                    ? '0 14px 30px -10px rgba(0,51,120,.60)'
                    : '0 8px 22px -10px rgba(0,51,120,.45)',
                  transform: hoverPrimary ? 'translateY(-1px)' : 'none',
                  transition: 'all .18s ease',
                }}
              >
                {primaryText} →
              </Button>
            )}
            {onSecondary && (
              <Button
                onClick={onSecondary}
                onMouseEnter={() => setHoverGhost(true)}
                onMouseLeave={() => setHoverGhost(false)}
                style={{
                  height: 46,
                  minWidth: isMobile ? undefined : 148,
                  padding: '0 26px',
                  borderRadius: 10,
                  border: '1.5px solid rgba(255,255,255,.60)',
                  background: hoverGhost ? 'rgba(255,255,255,.20)' : 'rgba(255,255,255,.08)',
                  color: '#FFFFFF',
                  fontSize: 14.5,
                  fontWeight: 600,
                  transition: 'all .18s ease',
                }}
              >
                {secondaryText}
              </Button>
            )}
          </div>
        )}

        {stats.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : `repeat(${stats.length}, minmax(0, 1fr))`,
              gap: isMobile ? 10 : 14,
              marginTop: isMobile ? 24 : 44,
            }}
          >
            {stats.map((s, i) => (
              <div
                key={`${s.label}-${i}`}
                style={{
                  padding: isMobile ? '12px 8px' : '16px 12px',
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,.24)',
                  background: 'rgba(255,255,255,.12)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: isMobile ? 21 : 27, fontWeight: 800, lineHeight: 1.25 }}>{s.value}</div>
                <div style={{ fontSize: isMobile ? 11 : 12, opacity: 0.82, marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {footnote && (
          <div style={{ marginTop: 18, fontSize: 12, color: 'rgba(255,255,255,.72)' }}>{footnote}</div>
        )}
      </div>
    </section>
  );
}
