/** 第 3 排左：连锁类型分布 — V7.1
 *
 * E1 卡片变窄：外层 `.board-row3`（Board.tsx）在此处用 CSS 覆写为
 *     ≥1280px → `minmax(200px,.8fr) / minmax(0,2.2fr)`（类型卡更窄，突出数据）
 *     768~1279px → 等宽 2 列（保留 V7 已验证的 4 卡 2×2）
 *     卡片内部改为紧凑三行：名称+数值 / 迷你南·北堆叠条 / 南·北·占比 小字
 * E2 每个类型行背景用其标签色浅色（10%，50+ 为 12%），边框同色 30%
 * E5 卡片 height:auto + 容器 align-items:start，下方不产生空白
 *
 * 配色：直接使用 `@/api/crm-board` 的 CHAIN_TYPE_COLORS / REGION_COLORS（V7.1 已更新为语义色）
 */
import React, { useMemo } from 'react';
import { Empty } from 'antd';
import { CHAIN_TYPE_COLORS, REGION_COLORS } from '@/api/crm-board';
import type { BoardData } from '@/api/crm-board';
import { fmtNum } from './theme';

interface Props {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

/* ══════════════ 语义色（契约 §三，来自 API 常量） ══════════════ */

/** 连锁类型色；未知类型回退灰 */
function typeColor(name: string): string {
  return CHAIN_TYPE_COLORS[name] || '#94a3b8';
}

/** 区域色；未知回退 brand */
function regionColor(name: string): string {
  return REGION_COLORS[name] || '#2563eb';
}

const SOUTH = regionColor('南区');
const NORTH = regionColor('北区');

/** E2：类型浅色背景（50+ 黄色偏浅，用 12%；其余 10%） */
function rowTint(name: string): { bg: string; border: string; nameColor: string; hoverBg: string } {
  const c = typeColor(name);
  const pct = name === '50+' ? 12 : 10;
  return {
    bg: `color-mix(in srgb, ${c} ${pct}%, transparent)`,
    border: `color-mix(in srgb, ${c} 30%, transparent)`,
    /* 名称：同色 26% + 正文色 74% —— 既保留类型色相，又保证明暗两种主题下对比度足够（不用纯色压浅底） */
    nameColor: `color-mix(in srgb, ${c} 26%, var(--text))`,
    hoverBg: `color-mix(in srgb, ${c} ${pct + 7}%, transparent)`,
  };
}

/* ══════════════ 局部样式（vb3- 前缀） ══════════════ */
const CSS = `
/* ── E1：外层第 3 排列宽（Board.tsx 是内联 style，故用 !important 覆写） ── */
@media(min-width:1280px){
  .board-row3{grid-template-columns:minmax(200px,.8fr) minmax(0,2.2fr)!important;align-items:start!important}
}
@media(min-width:768px) and (max-width:1279.98px){
  .board-row3{grid-template-columns:repeat(2,minmax(0,1fr))!important;align-items:start!important}
}

/* E5：卡片自适应高度，不拉伸留白 */
.vb3-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;height:auto;min-width:0}
.vb3-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}
.vb3-h{padding:12px 14px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:6px 8px;flex-wrap:wrap;flex-shrink:0;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb3-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb3-dot{width:6px;height:6px;border-radius:2px;background:var(--purple);box-shadow:0 0 0 3px color-mix(in srgb,var(--purple) 16%,transparent);flex-shrink:0}
.vb3-hint{font-size:11px;color:var(--text2);font-weight:600;white-space:nowrap}
.vb3-b{padding:12px;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}
.vb3-list{display:flex;flex-direction:column;gap:8px;min-width:0}

/* 紧凑行：名称+数值 / 迷你条 / 南北占比（三段都允许收缩，绝不截断） */
.vb3-row{padding:9px 11px;border-radius:var(--radius-sm);transition:background .15s ease,border-color .15s ease;min-width:0;border:1px solid transparent}
.vb3-top{display:flex;align-items:baseline;justify-content:space-between;gap:4px 8px;flex-wrap:wrap;min-width:0}
.vb3-name{font-size:12.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;min-width:0;overflow-wrap:anywhere;line-height:1.25}
.vb3-name .d{width:7px;height:7px;border-radius:2px;flex-shrink:0}
.vb3-name .inv{font-style:normal;font-size:9px;font-weight:700;color:#fff;background:#94a3b8;border-radius:4px;padding:0 4px;line-height:13px;flex-shrink:0}
.vb3-nums{font-size:11px;font-weight:650;font-variant-numeric:tabular-nums;color:var(--text2);white-space:nowrap;flex-shrink:0;margin-left:auto}
.vb3-nums b{font-size:14px;color:var(--text);font-weight:800;margin-right:1px}
.vb3-nums em{font-style:normal;font-size:9.5px;font-weight:600;color:var(--text2);margin-left:2px}

/* 迷你堆叠条：南 | 北 两段 */
.vb3-bar{display:flex;height:5px;border-radius:3px;background:color-mix(in srgb,var(--text) 10%,transparent);overflow:hidden;margin:7px 0 5px}
.vb3-bar i{display:block;height:100%;transition:width .5s cubic-bezier(.4,0,.2,1)}

/* 南/北/占比 小字一行 */
.vb3-reg{display:flex;flex-wrap:wrap;gap:2px 10px;font-size:10.5px;font-weight:600;min-width:0;line-height:1.45}
.vb3-reg span{display:inline-flex;align-items:center;gap:3px;white-space:nowrap}
.vb3-reg span b{font-weight:800;font-variant-numeric:tabular-nums;color:var(--text)}
.vb3-reg .k{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.vb3-empty{padding:22px 0}

/* 类型很多时进一步紧凑（未来新增类型不错乱） */
.vb3-list.dense{gap:6px}
.vb3-list.dense .vb3-row{padding:7px 9px}
.vb3-list.dense .vb3-bar{margin:5px 0 4px}
.vb3-list.ultra .vb3-reg{font-size:10px;gap:1px 8px}
`;

export default function TypeSummary({ data, loading, isMobile }: Props) {
  const items = useMemo(() => {
    const list = data?.row3?.typeDistribution;
    return Array.isArray(list) ? list : [];
  }, [data]);

  const totalClients = useMemo(
    () => items.reduce((s, x) => s + (Number(x?.clients) || 0), 0),
    [items],
  );
  const maxClients = useMemo(
    () => items.reduce((m, x) => Math.max(m, Number(x?.clients) || 0), 0) || 1,
    [items],
  );

  const listCls = [
    'vb3-list',
    items.length >= 5 ? 'dense' : '',
    items.length >= 7 ? 'ultra' : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      <style>{CSS}</style>
      <div className="vb3-card">
        <div className="vb3-h">
          <h3>
            <span className="vb3-dot" />
            连锁类型分布
          </h3>
          <span className="vb3-hint">{fmtNum(totalClients)} 家</span>
        </div>
        <div className="vb3-b">
          {items.length === 0 ? (
            <div className="vb3-empty">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
            </div>
          ) : (
            <div className={listCls}>
              {items.map((t) => {
                const name = String(t?.name ?? '');
                const clients = Number(t?.clients) || 0;
                const stores = Number(t?.stores) || 0;
                const south = Number(t?.south) || 0;
                const north = Number(t?.north) || 0;
                const color = typeColor(name);
                const tint = rowTint(name);
                const isInvalid = name === '50-';
                /* 段宽按 南:北 真实比例 */
                const share = south + north > 0 ? (south / (south + north)) * 100 : 50;
                const pct = totalClients > 0 ? ((clients / totalClients) * 100).toFixed(1) : '0.0';
                return (
                  <div
                    key={name || String(t)}
                    className="vb3-row"
                    style={{ background: tint.bg, borderColor: tint.border }}
                    title={`${name}：${clients} 家 / ${stores} 门店（南区 ${south} · 北区 ${north}）`}
                  >
                    <div className="vb3-top">
                      <span className="vb3-name" style={{ color: tint.nameColor }}>
                        <span className="d" style={{ background: color }} />
                        {name}
                        {isInvalid && <span className="inv">无效</span>}
                      </span>
                      <span className="vb3-nums">
                        <b>{fmtNum(clients)}</b>家
                        <em>· {fmtNum(stores)} 门店</em>
                      </span>
                    </div>
                    <div className="vb3-bar">
                      <i style={{ width: `${share}%`, background: SOUTH }} />
                      <i style={{ width: `${100 - share}%`, background: NORTH }} />
                    </div>
                    <div className="vb3-reg">
                      <span style={{ color: SOUTH }}>
                        <i className="k" style={{ background: SOUTH }} />
                        南 <b>{fmtNum(south)}</b>
                      </span>
                      <span style={{ color: NORTH }}>
                        <i className="k" style={{ background: NORTH }} />
                        北 <b>{fmtNum(north)}</b>
                      </span>
                      <span style={{ color: 'var(--text2)' }}>
                        占比 <b style={{ color: tint.nameColor }}>{pct}%</b>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
