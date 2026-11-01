/** 第 3 排左：连锁类型分布 — V10 重做
 *
 * 布局（契约 §四 R3）：
 *   卡头：只显示标题（**不再显示**「97 家 · 12,161 门店」）
 *   上半：**左侧环形饼图 + 右侧图例**
 *   下半：**2×2 四个类型小卡**
 *   底部：**已取消**「类型构成」堆叠条
 *
 * 不能回退的验收项：与右侧 3 张排行卡**等高**、底边对齐、内容铺满无空白。
 *   → 靠外层 `.board-row3` align-items:stretch + 卡片 height:100% + 上下两段 flex 分配实现。
 * 字号：全部走令牌阶梯，最小 11px。
 */
import React, { useMemo } from 'react';
import { Empty } from 'antd';
import { CHAIN_TYPE_COLORS, CHAIN_TYPE_SHORT, REGION_COLORS } from '@/api/crm-board';
import type { BoardData } from '@/api/crm-board';
import EChart from '../EChart';
import type { EChartsOption } from 'echarts';
import { fmtNum, useThemeMode } from './theme';

interface Props {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

/* ══════════════ 语义色 ══════════════ */

function typeColor(name: string): string {
  return CHAIN_TYPE_COLORS[name] || 'var(--text3)';
}

function shortType(name: string): string {
  return CHAIN_TYPE_SHORT[name] || name;
}

const SOUTH = REGION_COLORS['南区'] || '#2563eb';
const NORTH = REGION_COLORS['北区'] || '#059669';

/* ══════════════ 局部样式（vb3- 前缀） ══════════════ */
const CSS = `
/* ── 外层第 3 排列宽（Board.tsx 是内联 style，用 !important 覆写）
   两个断点都 stretch → 类型卡与排行区底边严格对齐 ── */
@media(min-width:1280px){
  .board-row3{grid-template-columns:minmax(0,.85fr) minmax(0,2.15fr)!important;align-items:stretch!important}
}
@media(min-width:768px) and (max-width:1279.98px){
  .board-row3{grid-template-columns:repeat(2,minmax(0,1fr))!important;align-items:stretch!important}
}

.vb3-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease;height:100%;min-width:0}
.vb3-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2)}

/* 卡头：实心渐变承载标题，视觉权重高于右侧白底卡头 */
.vb3-h{padding:13px 16px;display:flex;align-items:center;gap:8px;flex-shrink:0;background:linear-gradient(135deg,var(--brand) 0%,var(--brand2) 100%);color:#fff}
.vb3-h h3{font-size:var(--fs-sm);font-weight:700;color:#fff;display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb3-hdot{width:6px;height:6px;border-radius:2px;background:rgba(255,255,255,.92);flex-shrink:0}

/* 正文：上（饼+图例）/ 下（2×2）两段均分，整体铺满 */
.vb3-b{padding:12px 14px;display:flex;flex-direction:column;gap:12px;min-width:0;flex:1}

/* ── 上半：左饼图 + 右图例 ── */
.vb3-top{display:flex;align-items:center;gap:10px;flex:1.05;min-height:0;min-width:0}
.vb3-pie{flex:0 0 46%;min-width:0;height:100%;display:flex;align-items:center;justify-content:center}
.vb3-legend{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-evenly;gap:6px;height:100%}
.vb3-li{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:4px 8px;min-width:0}
.vb3-li .nm{display:inline-flex;align-items:center;gap:6px;min-width:0;font-size:var(--fs-xs);font-weight:650;color:var(--text);line-height:1.25}
.vb3-li .nm .d{width:8px;height:8px;border-radius:3px;flex-shrink:0}
.vb3-li .nm .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.vb3-li .v{font-size:var(--fs-xs);font-weight:750;color:var(--text);font-variant-numeric:tabular-nums;white-space:nowrap}
.vb3-li .v small{font-size:var(--fs-2xs);font-weight:600;color:var(--text3);margin-left:2px}
.vb3-li .pct{grid-column:1 / -1;font-size:var(--fs-2xs);font-weight:600;color:var(--text3);font-variant-numeric:tabular-nums}

/* ── 下半：2×2 类型小卡 ── */
.vb3-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr));gap:8px;flex:1;min-height:0;min-width:0}
.vb3-cell{border-radius:var(--radius-sm);border:1px solid transparent;padding:9px 10px;min-width:0;display:flex;flex-direction:column;justify-content:space-between;gap:4px;transition:transform .16s ease,box-shadow .16s ease}
.vb3-cell:hover{transform:translateY(-1px);box-shadow:var(--shadow2)}
.vb3-cell .hd{display:flex;align-items:center;gap:6px;min-width:0}
.vb3-cell .hd .d{width:8px;height:8px;border-radius:3px;flex-shrink:0}
.vb3-cell .hd .t{font-size:var(--fs-2xs);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.vb3-cell .hd .inv{flex-shrink:0;font-style:normal;font-size:var(--fs-2xs);font-weight:600;color:var(--text3);background:color-mix(in srgb,var(--text) 7%,transparent);border-radius:4px;padding:0 4px;line-height:1.5}
.vb3-cell .big{display:flex;align-items:baseline;gap:3px;min-width:0;line-height:1.05}
.vb3-cell .big b{font-size:var(--fs-lg);font-weight:750;color:var(--text);font-variant-numeric:tabular-nums;letter-spacing:-.3px}
.vb3-cell .big span{font-size:var(--fs-2xs);font-weight:600;color:var(--text2)}
.vb3-cell .sub{font-size:var(--fs-2xs);font-weight:600;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb3-cell .rg{display:flex;align-items:center;gap:8px;font-size:var(--fs-2xs);font-weight:600;color:var(--text2);min-width:0;flex-wrap:wrap}
.vb3-cell .rg span{display:inline-flex;align-items:center;gap:3px;white-space:nowrap}
.vb3-cell .rg i{width:6px;height:6px;border-radius:2px;flex-shrink:0}
.vb3-cell .rg b{color:var(--text);font-weight:750;font-variant-numeric:tabular-nums}
.vb3-empty{padding:24px 0}

/* 类型多于 4 种时自动换行不溢出 */
.vb3-grid.many{grid-template-rows:none;grid-auto-rows:minmax(0,1fr)}
`;

export default function TypeSummary({ data, loading, isMobile }: Props) {
  const mode = useThemeMode();
  const isDark = mode === 'dark';

  const items = useMemo(() => {
    const list = data?.row3?.typeDistribution;
    return Array.isArray(list) ? list : [];
  }, [data]);

  const totalClients = useMemo(
    () => items.reduce((s, x) => s + (Number(x?.clients) || 0), 0),
    [items],
  );

  /* 饼图 option —— 颜色直接用类型语义色；分隔环用 panel 色 */
  const pieOption = useMemo<EChartsOption>(() => ({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: isDark ? '#141e33' : '#ffffff',
      borderColor: isDark ? '#243356' : '#e3e9f2',
      borderWidth: 1,
      textStyle: { color: isDark ? '#e8eef8' : '#0f172a', fontSize: 12 },
      formatter: (p: unknown) => {
        const q = p as { name?: string; value?: number; percent?: number };
        return `${q.name ?? ''}<br/><b>${fmtNum(Number(q.value) || 0)}</b> 家 · ${(Number(q.percent) || 0).toFixed(1)}%`;
      },
    },
    series: [
      {
        type: 'pie',
        radius: ['48%', '78%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        itemStyle: {
          borderColor: isDark ? '#141e33' : '#ffffff',
          borderWidth: 2,
          borderRadius: 4,
        },
        emphasis: {
          scale: true,
          scaleSize: 4,
          itemStyle: { shadowBlur: 10, shadowColor: 'rgba(15,23,42,.22)' },
        },
        data: items.map((t) => ({
          name: String(t?.name ?? ''),
          value: Number(t?.clients) || 0,
          itemStyle: { color: typeColor(String(t?.name ?? '')) },
        })),
      },
    ],
  }), [items, isDark]);

  const gridCls = ['vb3-grid', items.length > 4 ? 'many' : ''].filter(Boolean).join(' ');

  return (
    <>
      <style>{CSS}</style>
      <div className="vb3-card">
        <div className="vb3-h">
          <h3>
            <span className="vb3-hdot" />
            连锁类型分布
          </h3>
        </div>
        <div className="vb3-b">
          {items.length === 0 ? (
            <div className="vb3-empty">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
            </div>
          ) : (
            <>
              {/* 上半：左饼图 + 右图例 */}
              <div className="vb3-top">
                <div className="vb3-pie">
                  {/* height 传数字作兜底，style 里的 100% 覆盖它 → 饼图跟随上方区块高度自适应 */}
                  <EChart option={pieOption} height={168} style={{ height: '100%' }} />
                </div>
                <div className="vb3-legend">
                  {items.map((t) => {
                    const name = String(t?.name ?? '');
                    const clients = Number(t?.clients) || 0;
                    const pct = totalClients > 0 ? (clients / totalClients) * 100 : 0;
                    return (
                      <div className="vb3-li" key={`lg-${name}`} title={`${name}：${clients} 家（${pct.toFixed(1)}%）`}>
                        <span className="nm">
                          <i className="d" style={{ background: typeColor(name) }} />
                          <span className="t">{name}</span>
                        </span>
                        <span className="v">{fmtNum(clients)}<small>家</small></span>
                        <span className="pct">占比 {pct.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 下半：2×2 类型小卡 */}
              <div className={gridCls}>
                {items.map((t) => {
                  const name = String(t?.name ?? '');
                  const clients = Number(t?.clients) || 0;
                  const stores = Number(t?.stores) || 0;
                  const south = Number(t?.south) || 0;
                  const north = Number(t?.north) || 0;
                  const c = typeColor(name);
                  const isInvalid = name === '50-';
                  return (
                    <div
                      key={`cell-${name}`}
                      className="vb3-cell"
                      style={{
                        background: `color-mix(in srgb, ${c} 9%, var(--panel))`,
                        borderColor: `color-mix(in srgb, ${c} 26%, var(--line))`,
                      }}
                      title={`${name}：${clients} 家 / ${stores} 门店（南区 ${south} · 北区 ${north}）`}
                    >
                      <div className="hd">
                        <i className="d" style={{ background: c }} />
                        <span className="t" style={{ color: `color-mix(in srgb, ${c} 32%, var(--text))` }}>
                          {shortType(name)}
                        </span>
                        {isInvalid && <span className="inv">不计入</span>}
                      </div>
                      <div className="big">
                        <b>{fmtNum(clients)}</b>
                        <span>家</span>
                      </div>
                      <div className="sub">{fmtNum(stores)} 门店</div>
                      <div className="rg">
                        <span><i style={{ background: SOUTH }} />南 <b>{fmtNum(south)}</b></span>
                        <span><i style={{ background: NORTH }} />北 <b>{fmtNum(north)}</b></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
