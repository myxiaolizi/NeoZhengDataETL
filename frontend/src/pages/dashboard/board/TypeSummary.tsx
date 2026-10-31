/** 第 3 排左：连锁类型分布 — V9.2 视觉改版
 *
 * 定位：本排的「总览」，视觉权重高于右侧三张排行卡。
 *   · 卡头：实心渐变条（brand 深浅）承载标题，比白底卡头更重
 *   · 每类型一块统一形状的「色块徽标」（圆角方块，尺寸固定 30×30）
 *   · 数值与占比固定两列对齐（grid 1fr auto），数字 17px/750、占比右对齐
 *   · 底部一条堆叠占比条，一眼看出四类构成
 *
 * 布局约束（不能破坏）：
 *   ≥1280px 外层 `.board-row3` = `minmax(0,.85fr) minmax(0,2.15fr)`；768~1279px 等宽 2 列；
 *   两断点都 stretch → 类型卡与排行区**底边严格对齐**；
 *   卡片 height:100% + 正文 flex:1 + 列表 space-evenly + 行 flex:1 0 auto → 纵向铺满无空白。
 *
 * 字号统一走令牌阶梯：最小 11px（--fs-2xs），不用 8~10.5px。
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

/* ══════════════ 语义色（来自 API 常量） ══════════════ */

function typeColor(name: string): string {
  return CHAIN_TYPE_COLORS[name] || 'var(--text3)';
}

function regionColor(name: string): string {
  return REGION_COLORS[name] || 'var(--brand)';
}

const SOUTH = regionColor('南区');
const NORTH = regionColor('北区');

/** 类型浅底：同色 10%（50+ 黄浅用 12%），右上角一段同色 30% 的渐变，形成统一「卡面」观感 */
function rowTint(name: string): { bg: string; border: string; nameColor: string } {
  const c = typeColor(name);
  const pct = name === '50+' ? 12 : 10;
  return {
    bg: `linear-gradient(135deg, color-mix(in srgb, ${c} ${pct}%, var(--panel)) 0%, color-mix(in srgb, ${c} ${pct + 6}%, var(--panel)) 100%)`,
    border: `color-mix(in srgb, ${c} 26%, var(--line))`,
    /* 名称保留色相但压向正文色，明暗两主题都够对比 */
    nameColor: `color-mix(in srgb, ${c} 30%, var(--text))`,
  };
}

/* ══════════════ 局部样式（vb3- 前缀） ══════════════ */
const CSS = `
/* ── 外层第 3 排列宽（Board.tsx 是内联 style，用 !important 覆写） ── */
@media(min-width:1280px){
  .board-row3{grid-template-columns:minmax(0,.85fr) minmax(0,2.15fr)!important;align-items:stretch!important}
}
@media(min-width:768px) and (max-width:1279.98px){
  .board-row3{grid-template-columns:repeat(2,minmax(0,1fr))!important;align-items:stretch!important}
}

/* 卡片：与排行卡同圆角同阴影，但卡头更重 → 视觉分层 */
.vb3-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease;height:100%;min-width:0}
.vb3-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2)}

/* 卡头：实心渐变（brand → brand2），白字，与右侧白底卡头形成层次 */
.vb3-h{padding:13px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;flex-shrink:0;background:linear-gradient(135deg,var(--brand) 0%,var(--brand2) 100%);color:#fff}
.vb3-h h3{font-size:var(--fs-sm);font-weight:700;color:#fff;display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb3-hdot{width:6px;height:6px;border-radius:2px;background:rgba(255,255,255,.92);flex-shrink:0}
.vb3-hint{font-size:var(--fs-2xs);font-weight:600;color:rgba(255,255,255,.9);white-space:nowrap}

.vb3-b{padding:14px;display:flex;flex-direction:column;gap:10px;min-width:0;flex:1}
.vb3-list{display:flex;flex-direction:column;gap:8px;min-width:0;flex:1;justify-content:space-evenly}

/* 类型行：统一形状卡面；名称+数值走 grid 两列（名称左、数值右对齐），保证纵向对齐 */
.vb3-row{padding:10px 12px;border-radius:var(--radius-sm);border:1px solid transparent;min-width:0;flex:1 0 auto;display:flex;flex-direction:column;justify-content:center;gap:8px;transition:transform .16s ease,box-shadow .16s ease}
.vb3-row:hover{transform:translateY(-1px);box-shadow:var(--shadow2)}

.vb3-top{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px 10px;min-width:0}
.vb3-name{display:inline-flex;align-items:center;gap:8px;min-width:0;font-size:var(--fs-sm);font-weight:700;line-height:1.2}
/* 统一色块徽标：固定 26×26 圆角方块，四类完全一致 */
.vb3-chip{width:26px;height:26px;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:var(--fs-2xs);font-weight:750;color:#fff;letter-spacing:0}
.vb3-name .txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.vb3-name .inv{flex-shrink:0;font-style:normal;font-size:var(--fs-2xs);font-weight:600;color:var(--text2);background:color-mix(in srgb,var(--text) 6%,transparent);border-radius:5px;padding:1px 5px;line-height:1.4}

/* 数值区块：主数值 17px，门店/占比 11px 作次信息，右对齐 */
.vb3-num{display:flex;flex-direction:column;align-items:flex-end;gap:1px;flex-shrink:0}
.vb3-num b{font-size:var(--fs-lg);font-weight:750;color:var(--text);font-variant-numeric:tabular-nums;line-height:1.1;letter-spacing:-.3px}
.vb3-num b small{font-size:var(--fs-2xs);font-weight:600;color:var(--text2);margin-left:2px;letter-spacing:0}
.vb3-num span{font-size:var(--fs-2xs);font-weight:600;color:var(--text3);font-variant-numeric:tabular-nums;white-space:nowrap}

/* 占比条：南 | 北 两段，带圆角，粗细统一 */
.vb3-bar{display:flex;height:6px;border-radius:4px;background:color-mix(in srgb,var(--text) 8%,transparent);overflow:hidden}
.vb3-bar i{display:block;height:100%;transition:width .5s cubic-bezier(.4,0,.2,1)}

/* 南/北/占比 一行，11px */
.vb3-reg{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;font-size:var(--fs-2xs);font-weight:600;color:var(--text2);min-width:0;line-height:1.4}
.vb3-reg span{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.vb3-reg b{font-weight:750;color:var(--text);font-variant-numeric:tabular-nums}
.vb3-reg .k{width:6px;height:6px;border-radius:2px;flex-shrink:0}
.vb3-reg .pct{margin-left:auto;color:var(--text3)}

/* 底部构成总条（总览感） */
.vb3-total{flex-shrink:0;padding-top:2px}
.vb3-total .cap{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:var(--fs-2xs);font-weight:600;color:var(--text3);margin-bottom:5px}
.vb3-total .cap b{color:var(--text);font-weight:750;font-variant-numeric:tabular-nums}
.vb3-total .bar{display:flex;height:8px;border-radius:5px;overflow:hidden;background:color-mix(in srgb,var(--text) 8%,transparent)}
.vb3-total .bar i{display:block;height:100%;transition:width .5s cubic-bezier(.4,0,.2,1)}
.vb3-empty{padding:24px 0}

/* 类型很多时收紧，避免错乱 */
.vb3-list.dense{gap:6px}
.vb3-list.dense .vb3-row{padding:8px 10px;gap:6px}
.vb3-list.dense .vb3-chip{width:22px;height:22px;border-radius:7px}
`;

/** 类型徽标里的单字（全国/区县/50+/50- 都用第一个字，形状统一） */
function chipText(name: string): string {
  if (name.startsWith('50')) return name.replace(/[^0-9+-]/g, '').slice(0, 3) || '50';
  return name.slice(0, 1);
}

export default function TypeSummary({ data, loading, isMobile }: Props) {
  const items = useMemo(() => {
    const list = data?.row3?.typeDistribution;
    return Array.isArray(list) ? list : [];
  }, [data]);

  const totalClients = useMemo(
    () => items.reduce((s, x) => s + (Number(x?.clients) || 0), 0),
    [items],
  );
  const totalStores = useMemo(
    () => items.reduce((s, x) => s + (Number(x?.stores) || 0), 0),
    [items],
  );

  const listCls = ['vb3-list', items.length >= 5 ? 'dense' : ''].filter(Boolean).join(' ');

  return (
    <>
      <style>{CSS}</style>
      <div className="vb3-card">
        <div className="vb3-h">
          <h3>
            <span className="vb3-hdot" />
            连锁类型分布
          </h3>
          <span className="vb3-hint">{fmtNum(totalClients)} 家 · {fmtNum(totalStores)} 门店</span>
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
                const share = south + north > 0 ? (south / (south + north)) * 100 : 50;
                const pctNum = totalClients > 0 ? (clients / totalClients) * 100 : 0;
                const pct = pctNum.toFixed(1);
                return (
                  <div
                    key={name || String(t)}
                    className="vb3-row"
                    style={{ background: tint.bg, borderColor: tint.border }}
                    title={`${name}：${clients} 家 / ${stores} 门店（南区 ${south} · 北区 ${north}）`}
                  >
                    <div className="vb3-top">
                      <span className="vb3-name" style={{ color: tint.nameColor }}>
                        <span className="vb3-chip" style={{ background: color, color: '#fff' }}>
                          {chipText(name)}
                        </span>
                        <span className="txt">{name}</span>
                        {isInvalid && <span className="inv">不计入任务</span>}
                      </span>
                      <span className="vb3-num">
                        <b>{fmtNum(clients)}<small>家</small></b>
                        <span>{fmtNum(stores)} 门店</span>
                      </span>
                    </div>
                    <div className="vb3-bar">
                      <i style={{ width: `${share}%`, background: SOUTH }} />
                      <i style={{ width: `${100 - share}%`, background: NORTH }} />
                    </div>
                    <div className="vb3-reg">
                      <span>
                        <i className="k" style={{ background: SOUTH }} />
                        南 <b>{fmtNum(south)}</b>
                      </span>
                      <span>
                        <i className="k" style={{ background: NORTH }} />
                        北 <b>{fmtNum(north)}</b>
                      </span>
                      <span className="pct">占比 <b>{pct}%</b></span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 底部：整体构成一条堆叠条（总览收口） */}
          {items.length > 0 && (
            <div className="vb3-total">
              <div className="cap">
                <span>类型构成</span>
                <span>合计 <b>{fmtNum(totalClients)}</b> 家</span>
              </div>
              <div className="bar">
                {items.map((t) => {
                  const name = String(t?.name ?? '');
                  const clients = Number(t?.clients) || 0;
                  const w = totalClients > 0 ? (clients / totalClients) * 100 : 0;
                  return (
                    <i
                      key={`seg-${name}`}
                      style={{ width: `${w}%`, background: typeColor(name) }}
                      title={`${name} ${fmtNum(clients)} 家（${w.toFixed(1)}%）`}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
