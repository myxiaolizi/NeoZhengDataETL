/** 第 3 排左：连锁类型分布 — V7.0
 *
 * D3：修复内容溢出/截断 ——
 *   · 名称/数字/南·北·占比三段全部 flex-wrap，窄卡片自动折行，不再 ellipsis 截断
 *   · 类型数量增多时自动紧凑：≥5 种 dense、≥7 种 ultra（字号/内距/条高递减），
 *     卡片高度由内容撑开（不写死 height），容器 min-height 交给 flex，不会错乱
 * 配色（契约 §2.1）：
 *   连锁类型 全国百强 #ef4444 / 区县百强 #f59e0b / 50+ #eab308 / 50- #94a3b8
 *   南区 #2563eb / 北区 #10b981
 *   优先取 @/api/crm-board 的 CHAIN_TYPE_COLORS / REGION_COLORS；若该常量仍是 V6 旧值
 *   （#3687FF / #45B4FF / #FFC000 …）则用本地 V7 兜底，Lead 更新常量后自动以 API 为准。
 */
import React, { useMemo } from 'react';
import { Empty } from 'antd';
import * as BoardApi from '@/api/crm-board';
import type { BoardData } from '@/api/crm-board';
import { fmtNum } from './theme';

interface Props {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

/* ══════════════ 语义色（契约 §2.1） ══════════════ */

/** V7 连锁类型语义色（crm-board 未更新时的兜底） */
const TYPE_COLOR_FALLBACK: Record<string, string> = {
  全国百强: '#ef4444',
  区县百强: '#f59e0b',
  '50+': '#eab308',
  '50-': '#94a3b8',
};
/** V6 旧色值：出现在 API 常量里说明还没升级，按兜底色处理 */
const LEGACY_TYPE_COLORS = new Set(['#3687ff', '#45b4ff', '#a2d73c', '#b5b5b6']);

function typeColor(name: string): string {
  const api = (BoardApi.CHAIN_TYPE_COLORS || {})[name];
  if (api && !LEGACY_TYPE_COLORS.has(String(api).toLowerCase())) return api;
  return TYPE_COLOR_FALLBACK[name] || '#94a3b8';
}

/** V7 南北区语义色（南区蓝 / 北区绿）；同样兼容 V6 旧常量 */
const REGION_COLOR_FALLBACK = { 南区: '#2563eb', 北区: '#10b981' };
const LEGACY_REGION_COLORS = new Set(['#45b4ff', '#ffc000']);

function regionColor(name: '南区' | '北区'): string {
  const api = (BoardApi.REGION_COLORS || {})[name];
  if (api && !LEGACY_REGION_COLORS.has(String(api).toLowerCase())) return api;
  return REGION_COLOR_FALLBACK[name];
}

/* ══════════════ 局部样式（vb3- 前缀） ══════════════ */
const CSS = `
.vb3-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;height:100%;min-width:0}
.vb3-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}
.vb3-h{padding:13px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:6px 8px;flex-wrap:wrap;flex-shrink:0;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb3-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb3-dot{width:6px;height:6px;border-radius:2px;background:var(--purple);box-shadow:0 0 0 3px color-mix(in srgb,var(--purple) 16%,transparent);flex-shrink:0}
.vb3-hint{font-size:11px;color:var(--text3);font-weight:550;white-space:nowrap}
.vb3-b{padding:14px 16px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0;min-height:0}
.vb3-list{display:flex;flex-direction:column;gap:9px;min-width:0}
.vb3-row{padding:10px 12px;border-radius:var(--radius-sm);background:var(--panel2);border:1px solid var(--line);transition:all .15s;min-width:0}
.vb3-row:hover{border-color:var(--brand3);background:var(--brandSoft)}
.vb3-row.off{opacity:.62}
/* 顶部：名称 与 数字 允许折行，禁止 ellipsis 截断 */
.vb3-top{display:flex;align-items:center;justify-content:space-between;gap:5px 10px;flex-wrap:wrap;margin-bottom:6px;min-width:0}
.vb3-name{font-size:12.5px;font-weight:650;display:inline-flex;align-items:center;gap:6px;color:var(--text);min-width:0;overflow-wrap:anywhere;line-height:1.25}
.vb3-name .d{width:8px;height:8px;border-radius:3px;flex-shrink:0}
.vb3-name .badge{font-style:normal;font-size:9.5px;font-weight:650;color:var(--text2);border:1px solid var(--line);border-radius:5px;padding:0 4px;line-height:14px;flex-shrink:0}
.vb3-nums{font-size:11.5px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--text2);white-space:nowrap;flex-shrink:0;margin-left:auto}
.vb3-nums b{font-size:14px;color:var(--text);font-weight:750;margin-right:1px}
.vb3-nums em{font-style:normal;font-size:10px;font-weight:600;color:var(--text2);margin-left:3px}
/* 南/北两段堆叠条 */
.vb3-bar{display:flex;height:6px;border-radius:4px;background:var(--line2);overflow:hidden;margin-bottom:6px}
.vb3-bar i{display:block;height:100%;transition:width .5s cubic-bezier(.4,0,.2,1)}
/* 南北区 + 占比：允许折行，窄卡片不出横向溢出 */
.vb3-reg{display:flex;flex-wrap:wrap;gap:3px 12px;font-size:11px;font-weight:600;min-width:0;line-height:1.5}
.vb3-reg span{display:inline-flex;align-items:center;gap:4px;color:var(--text2);white-space:nowrap;font-size:11px}
.vb3-reg span b{font-weight:750;font-variant-numeric:tabular-nums;color:var(--text)}
.vb3-empty{padding:22px 0}
/* D3：类型多时紧凑，避免卡片过长/错乱 */
.vb3-list.dense{gap:7px}
.vb3-list.dense .vb3-row{padding:8px 10px}
.vb3-list.dense .vb3-name{font-size:12px}
.vb3-list.dense .vb3-nums b{font-size:13px}
.vb3-list.dense .vb3-bar{height:5px;margin-bottom:5px}
.vb3-list.ultra{gap:6px}
.vb3-list.ultra .vb3-row{padding:7px 9px}
.vb3-list.ultra .vb3-top{margin-bottom:5px}
.vb3-list.ultra .vb3-reg{font-size:10.5px;gap:2px 10px}
.vb3-list.ultra .vb3-reg span{font-size:10.5px}
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

  /* 类型数量越多越紧凑（D3：未来新增第 5/6 种类型也能正常显示） */
  const listCls = [
    'vb3-list',
    items.length >= 5 ? 'dense' : '',
    items.length >= 7 ? 'ultra' : '',
  ].filter(Boolean).join(' ');

  const SOUTH = regionColor('南区');
  const NORTH = regionColor('北区');

  return (
    <>
      <style>{CSS}</style>
      <div className="vb3-card">
        <div className="vb3-h">
          <h3>
            <span className="vb3-dot" />
            连锁类型分布
          </h3>
          <span className="vb3-hint">共 {fmtNum(totalClients)} 家</span>
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
                const isInvalid = name === '50-';
                /* 条宽按最大值归一（视觉对比），段宽按 南:北 比例分配（真实构成） */
                const w = Math.max(2, Math.min(100, (clients / maxClients) * 100));
                const share = south + north > 0 ? (south / (south + north)) * 100 : 50;
                const pct = totalClients > 0 ? ((clients / totalClients) * 100).toFixed(1) : '0.0';
                return (
                  <div key={name || String(t)} className={`vb3-row${isInvalid ? ' off' : ''}`}>
                    <div className="vb3-top">
                      <span className="vb3-name" title={`${name} · ${clients} 家`}>
                        <span className="d" style={{ background: color }} />
                        {name}
                        {isInvalid && <span className="badge">无效</span>}
                      </span>
                      <span className="vb3-nums">
                        <b>{fmtNum(clients)}</b> 户
                        <em>· {fmtNum(stores)} 门店</em>
                      </span>
                    </div>
                    <div
                      className="vb3-bar"
                      style={{ width: `${w}%`, minWidth: 24 }}
                      title={`${name}：南区 ${south} 家 / 北区 ${north} 家`}
                    >
                      <i style={{ width: `${share}%`, background: SOUTH }} />
                      <i style={{ width: `${100 - share}%`, background: NORTH }} />
                    </div>
                    <div className="vb3-reg">
                      <span style={{ color: SOUTH }}>
                        <i
                          className="d"
                          style={{ width: 6, height: 6, borderRadius: 2, background: SOUTH, display: 'inline-block' }}
                        />
                        南区 <b>{fmtNum(south)}</b> 家
                      </span>
                      <span style={{ color: NORTH }}>
                        <i
                          className="d"
                          style={{ width: 6, height: 6, borderRadius: 2, background: NORTH, display: 'inline-block' }}
                        />
                        北区 <b>{fmtNum(north)}</b> 家
                      </span>
                      <span>
                        占比 <b>{pct}%</b>
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
