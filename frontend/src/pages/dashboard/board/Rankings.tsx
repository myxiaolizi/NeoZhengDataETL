/** 第 3 排右：3 个排行榜 — V7.1
 *
 * E3 三张卡风格各异（同一文件内三套独立样式）：
 *   · 客户数排行榜 → 横向条形风（徽章 + 名称 + 进度条 + 数值）
 *   · 门店数排行榜 → 数据卡风（徽章 + 大数字主导 + 名称 + 迷你环形刻度）
 *   · 省份排行榜   → 热力网格/俯瞰地图风（21 个省份色块，按客户数深浅着色，点击下钻明细）
 * E4 前三名卡片背景：1 浅粉 #fde8ef/边框 #f9a8c8 · 2 浅橙 #fdeee0/#f5c08a · 3 浅黄 #fdf6dd/#e8d48a
 *    第 4 名起 var(--panel2)。暗色模式用同色 16% 混入 panel2，避免浅底浅字。
 * E5 卡片 height:auto + 网格 align-items:start，正文 min-height 兜底，下方不留空白
 * E6 省份不用 echarts map（echarts 6 默认无中国 GeoJSON，会报 Map china not exists），
 *    改用「热力网格 + 点击下钻」，不依赖任何地图数据，零加载风险。
 *
 * 说明：Modal 通过 portal 挂到 body，取不到 .board-root 注入的 CSS 变量（V7 踩过的坑），
 *      故弹窗内容外层重新声明整套令牌（PORTAL_LIGHT / PORTAL_DARK）。
 */
import React, { useMemo, useState, useEffect } from 'react';
import { Empty, Modal, Table } from 'antd';
import ProvinceMapModal from './ProvinceMapModal';
import type { ColumnsType } from 'antd/es/table';
import { RightOutlined } from '@ant-design/icons';
import { CHAIN_TYPE_COLORS, CHAIN_TYPE_SHORT } from '@/api/crm-board';
import type { BoardData, DetailFullRow, RankItem } from '@/api/crm-board';
import { fmtNum, useThemeMode } from './theme';

interface Props {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

const BRAND = '#2563eb';

/* ══════════════ 语义色 ══════════════ */

function typeColor(name: string): string {
  return CHAIN_TYPE_COLORS[name] || '#94a3b8';
}

function shortType(name: string): string {
  return CHAIN_TYPE_SHORT[name] || name;
}

/* ══════════════ 名次徽章：TOP3 金银铜，4+ 中性灰（只用令牌，无彩虹色） ══════════════ */

/**
 * V9.2：徽章配色收敛到「金 / 银 / 铜 + 中性灰」四档，全部由令牌混出：
 *   1 金  var(--warn)
 *   2 银  color-mix(--text3 78%, --text)
 *   3 铜  color-mix(--warn 52%, --text3)
 *   4+   var(--line2) 底 + --text2 字（永不用白字压在浅底上）
 */
function badgeStyle(no: number): React.CSSProperties {
  /**
   * V9.2：TOP3 徽章原来用白字压在金色/银色底上，实测对比度仅 1.67，几乎看不清。
   * 改为「金属渐变底 + 同色系深字」，对比度 6~8，同时更有质感。
   */
  if (no === 1) {
    return {
      background: 'linear-gradient(135deg,#fbbf24,#f59e0b)',
      color: '#452a03',
      boxShadow: '0 1px 3px rgba(245,158,11,.42)',
    };
  }
  if (no === 2) {
    return {
      background: 'linear-gradient(135deg,#cbd5e1,#94a3b8)',
      color: '#1e293b',
      boxShadow: '0 1px 3px rgba(148,163,184,.42)',
    };
  }
  if (no === 3) {
    return {
      background: 'linear-gradient(135deg,#fdba74,#f97316)',
      color: '#431407',
      boxShadow: '0 1px 3px rgba(249,115,22,.38)',
    };
  }
  return { background: 'var(--line2)', color: 'var(--text2)', boxShadow: 'none' };
}

/** 占比条颜色：与徽章同阶（TOP3 用金银铜，4+ 用 brand），低饱和避免抢眼 */
function accentOf(no: number): string {
  if (no === 1) return 'var(--warn)';
  if (no === 2) return 'color-mix(in srgb, var(--text3) 80%, var(--text))';
  if (no === 3) return 'color-mix(in srgb, var(--warn) 52%, var(--text3))';
  return 'var(--brand)';
}

/* ══════════════ 弹窗令牌重声明（portal → body，取不到 .board-root 变量） ══════════════ */

const PORTAL_LIGHT: React.CSSProperties = {
  '--panel': '#ffffff',
  '--panel2': '#f7faff',
  '--line': '#dde8f6',
  '--line2': '#eaf2fb',
  '--text': '#16253d',
  '--text2': '#5a7191',
  '--text3': '#93a7c2',
  '--brand': BRAND,
  '--brandSoft': '#e9f2ff',
  '--danger': '#ef4444',
  '--warn': '#f59e0b',
  '--green': '#10b981',
} as React.CSSProperties;

const PORTAL_DARK: React.CSSProperties = {
  '--panel': '#101d33',
  '--panel2': '#14233c',
  '--line': '#1e3252',
  '--line2': '#182a45',
  '--text': '#e2e8f0',
  '--text2': '#94a8c4',
  '--text3': '#6b82a3',
  '--brand': BRAND,
  '--brandSoft': '#16294a',
  '--danger': '#f87171',
  '--warn': '#fbbf24',
  '--green': '#34d399',
} as React.CSSProperties;

/* ══════════════ 省份简称 ══════════════ */

const PROVINCE_SHORT: Record<string, string> = {
  新疆维吾尔自治区: '新疆',
  宁夏回族自治区: '宁夏',
  广西壮族自治区: '广西',
  内蒙古自治区: '内蒙古',
  西藏自治区: '西藏',
  香港特别行政区: '香港',
  澳门特别行政区: '澳门',
};

function shortProvince(name: string): string {
  const n = String(name || '');
  if (PROVINCE_SHORT[n]) return PROVINCE_SHORT[n];
  return n.replace(/(省|市|自治区)$/u, '');
}

/* ══════════════ 局部样式（vb4- 前缀） — V9.2 视觉改版 ══════════════ */
const CSS = `
/* 三张卡等高铺满：网格 stretch + 卡片 height:100% + 正文 flex:1 */
.vb4-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:stretch;min-width:0;height:100%}
/* 768~1279px：3 张卡直接成为外层第 3 排 2×2 网格的子项（列宽由 TypeSummary 侧定义） */
@media(min-width:768px) and (max-width:1279.98px){.vb4-grid{display:contents!important}}
/* ≤767px：外层是 1 列，3 张卡也各占 1 列，否则会挤成 ~108px 宽 */
@media(max-width:767.98px){.vb4-grid{grid-template-columns:1fr!important}}

.vb4-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease;height:100%;min-width:0}
.vb4-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2)}

/* 卡头统一结构：色点 + 标题 13/700 + 右侧「共 N 位」11 + 更多 */
.vb4-h{padding:13px 14px;border-bottom:1px solid var(--line2);display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex-shrink:0}
.vb4-h h3{font-size:var(--fs-sm);font-weight:700;color:var(--text);display:flex;align-items:center;gap:7px;margin:0;letter-spacing:.2px;white-space:nowrap;min-width:0}
.vb4-dot{width:6px;height:6px;border-radius:2px;flex-shrink:0}
.vb4-sub{font-size:var(--fs-2xs);color:var(--text3);font-weight:600;white-space:nowrap}
.vb4-more{margin-left:auto;display:inline-flex;align-items:center;gap:3px;font-size:var(--fs-2xs);font-weight:600;color:var(--brand);background:transparent;border:0;cursor:pointer;padding:3px 6px;border-radius:6px;transition:background .15s;white-space:nowrap}
.vb4-more:hover{background:var(--brandSoft)}
.vb4-more svg{font-size:var(--fs-2xs)}

/* 正文：条目均分剩余高度（space-between），保证铺满且条目间有呼吸感 */
.vb4-b{padding:12px 14px;display:flex;flex-direction:column;justify-content:space-between;gap:0;min-width:0;flex:1}
.vb4-empty{padding:16px 0}

/* 名次徽章：统一 22×22 圆形，TOP3 金银铜（--warn / 中性灰阶），4+ 中性浅底 */
.vb4-no{width:22px;height:22px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:var(--fs-2xs);font-weight:750;font-variant-numeric:tabular-nums;line-height:1;letter-spacing:0}

/* 类型标签：11px，中性底色 + 色点，避免与名次徽章抢色 */
.vb4-tags{display:flex;gap:4px;flex-wrap:wrap;min-width:0}
.vb4-tags .tt{display:inline-flex;align-items:center;gap:4px;padding:0 6px;height:19px;border-radius:6px;border:1px solid var(--line2);background:color-mix(in srgb,var(--text) 3%,transparent);font-size:var(--fs-2xs);line-height:1;white-space:nowrap;max-width:100%}
.vb4-tags .tt .d{width:6px;height:6px;border-radius:2px;flex-shrink:0}
.vb4-tags .tt .n{color:var(--text2);font-weight:600;overflow:hidden;text-overflow:ellipsis}
.vb4-tags .tt .v{color:var(--text);font-weight:750;font-variant-numeric:tabular-nums;flex-shrink:0}

/* ── 排行条目共用骨架：徽章 | 主区（名称+副信息+占比条+标签） | 数值列 ──
   条目之间用极淡分隔线（不用交替底色，二者只选其一） */
.vb4-row{display:grid;grid-template-columns:22px minmax(0,1fr) auto;align-items:center;gap:10px;padding:8px;min-width:0;transition:background .16s ease;border-radius:8px}
.vb4-row+.vb4-row{box-shadow:inset 0 1px 0 var(--line2)}
.vb4-row:hover{background:var(--brandSoft)}
.vb4-main{min-width:0;display:flex;flex-direction:column;gap:5px}

/* 名称行：名称 13/700 + 副信息 11/--text3 */
.vb4-nm{display:flex;align-items:baseline;gap:6px;min-width:0;line-height:1.25}
.vb4-nm .nm{font-size:var(--fs-sm);font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.vb4-nm .sn{font-size:var(--fs-2xs);font-weight:600;color:var(--text3);flex-shrink:0;white-space:nowrap}

/* 数值列：17/750 右对齐 + 单位 11 */
.vb4-val{display:flex;flex-direction:column;align-items:flex-end;gap:1px;flex-shrink:0;min-width:50px}
.vb4-val b{font-size:var(--fs-lg);font-weight:750;color:var(--text);font-variant-numeric:tabular-nums;line-height:1.05;letter-spacing:-.4px}
.vb4-val span{font-size:var(--fs-2xs);font-weight:600;color:var(--text3);letter-spacing:.3px}

/* 占比条：相对榜首的横向长度，视觉化排序 */
.vb4-track{height:6px;border-radius:4px;background:color-mix(in srgb,var(--text) 8%,transparent);overflow:hidden}
.vb4-track i{display:block;height:100%;border-radius:4px;transition:width .55s cubic-bezier(.4,0,.2,1)}

/* ── A. 客户数排行榜（横向条形风） ── */
.vb4a-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:var(--fs-2xs);font-weight:600;color:var(--text3);padding-top:8px;border-top:1px solid var(--line2);flex-shrink:0}
.vb4a-foot b{color:var(--text);font-weight:750;font-variant-numeric:tabular-nums}

/* ── B. 门店数排行榜（数据卡风：大数字主导） ── */
.vb4b-row{grid-template-columns:22px minmax(0,1fr);gap:10px}
.vb4b-num{display:flex;align-items:baseline;gap:5px;min-width:0;line-height:1.1}
.vb4b-num b{font-size:var(--fs-xl);font-weight:750;font-variant-numeric:tabular-nums;letter-spacing:-.8px;color:var(--text);line-height:1.1}
.vb4b-num span{font-size:var(--fs-2xs);font-weight:600;color:var(--text3)}
.vb4b-side{display:flex;align-items:center;gap:6px;flex-shrink:0}

/* ── C. 省份排行榜：5 格等宽等高 + 门店占比条（两段合起来铺满正文） ──
   repeat(5,1fr) 保证 5 格等宽；统一 auto-rows 保证等高。
   ≤767px（卡片只有 ~351px 宽）时改为 2 行布局，避免每格被压到 48px 导致文字溢出 */
.vb4c-wrap{flex:1;display:flex;flex-direction:column;justify-content:space-between;gap:12px;min-width:0}
.vb4c-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));grid-auto-rows:104px;gap:8px;min-width:0;flex:0 0 auto}
@media(max-width:767.98px){
  .vb4c-grid{grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:88px}
}
.vb4c-cell{position:relative;border:1px solid var(--line);border-radius:var(--radius-sm);cursor:pointer;text-align:center;transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease;font-family:inherit;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:10px 4px;line-height:1.15;min-width:0}
.vb4c-cell:hover{transform:translateY(-2px);box-shadow:var(--shadow2);border-color:var(--brand2)}
.vb4c-cell:active{transform:translateY(0)}
.vb4c-cell .rk{position:absolute;top:6px;left:7px;font-size:var(--fs-2xs);font-weight:750;opacity:.5;line-height:1}
.vb4c-cell .pn{font-size:var(--fs-xs);font-weight:650;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.vb4c-cell .cv{font-size:var(--fs-xl);font-weight:750;font-variant-numeric:tabular-nums;letter-spacing:-.6px;line-height:1.05}
/* 副信息用 --text2（--text3 在深色的深底块上对比度只有 1.87，不可读） */
.vb4c-cell .st{font-size:var(--fs-2xs);font-weight:600;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}

/* 门店占比条：同一批省份的第二个维度，把卡片下半部分填满（不与上方重复取数） */
.vb4c-bars{display:flex;flex-direction:column;justify-content:space-evenly;gap:6px;flex:1;min-width:0}
.vb4c-bar{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;min-width:0}
.vb4c-bar .n{font-size:var(--fs-2xs);font-weight:600;color:var(--text2);white-space:nowrap}
.vb4c-bar .t{height:6px;border-radius:4px;background:color-mix(in srgb,var(--text) 8%,transparent);overflow:hidden}
.vb4c-bar .t i{display:block;height:100%;border-radius:4px;background:var(--green);transition:width .55s cubic-bezier(.4,0,.2,1)}
.vb4c-bar .v{font-size:var(--fs-2xs);font-weight:750;color:var(--text);font-variant-numeric:tabular-nums;white-space:nowrap}
.vb4c-foot{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:var(--fs-2xs);font-weight:600;color:var(--text3);flex-shrink:0}
.vb4c-ramp{display:inline-flex;align-items:center;gap:2px}
.vb4c-ramp i{width:16px;height:8px;border-radius:2px;display:block}
.vb4c-foot .tip{margin-left:auto;white-space:nowrap;color:var(--text3)}

/* 下钻弹窗内 */
.vb4d-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.vb4d-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border-radius:8px;background:var(--panel2);border:1px solid var(--line);font-size:var(--fs-xs);font-weight:600;color:var(--text)}
.vb4d-chip b{font-weight:750;font-variant-numeric:tabular-nums}
.vb4d-chip .bar{width:34px;height:4px;border-radius:2px;background:color-mix(in srgb,var(--text) 10%,transparent);overflow:hidden}
.vb4d-chip .bar i{display:block;height:100%;background:var(--brand);border-radius:2px}
.vb4d-sum{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:var(--fs-xs);font-weight:600;color:var(--text2);margin-bottom:10px}
.vb4d-sum b{color:var(--text);font-weight:750;font-variant-numeric:tabular-nums}
.vb4d-sec{font-size:var(--fs-xs);font-weight:700;color:var(--text2);margin:4px 0 8px;letter-spacing:.2px}

/* 弹窗内表格/分页：颜色显式声明（portal 拿不到外层变量） */
.v7d-modal{color:var(--text);font-size:var(--fs-xs)}
.v7d-modal .ant-table{background:transparent;color:var(--text)}
.v7d-modal .ant-table-thead>tr>th{background:var(--panel2)!important;color:var(--text)!important;border-bottom:1px solid var(--line)!important;font-weight:700}
.v7d-modal .ant-table-thead>tr>th::before{background-color:var(--line)!important}
.v7d-modal .ant-table-tbody>tr>td{background:transparent!important;color:var(--text)!important;border-bottom:1px solid var(--line2)!important}
.v7d-modal .ant-table-tbody>tr:hover>td{background:var(--brandSoft)!important}
.v7d-modal .ant-table-placeholder>tr>td,.v7d-modal .ant-table-placeholder>td{background:transparent!important;color:var(--text2)!important}
.v7d-modal .ant-empty-description{color:var(--text2)}
.v7d-modal .ant-pagination{color:var(--text2)}
.v7d-modal .ant-pagination-item,.v7d-modal .ant-pagination-prev .ant-pagination-item-link,.v7d-modal .ant-pagination-next .ant-pagination-item-link{background:var(--panel2);border-color:var(--line)}
.v7d-modal .ant-pagination-item a,.v7d-modal .ant-pagination-prev button,.v7d-modal .ant-pagination-next button,.v7d-modal .ant-pagination-total-text,.v7d-modal .ant-pagination-options{color:var(--text2)!important}
.v7d-modal .ant-pagination-item-active{background:color-mix(in srgb,var(--brand) 18%,transparent);border-color:var(--brand)}
.v7d-modal .ant-pagination-item-active a{color:var(--brand)!important}
`;

/* ══════════════ 共用小件 ══════════════ */

function TypeTags({ tags }: { tags?: RankItem['tags'] }) {
  const list = Array.isArray(tags) ? tags : [];
  if (!list.length) return null;
  return (
    <div className="vb4-tags">
      {list.map((t) => {
        const name = String(t?.name ?? '');
        const c = typeColor(name);
        return (
          <span
            key={name}
            className="tt"
            style={{
              borderColor: `color-mix(in srgb, ${c} 34%, transparent)`,
              background: `color-mix(in srgb, ${c} 10%, transparent)`,
            }}
            title={`${name} ${t?.count ?? 0} 家`}
          >
            <i className="d" style={{ background: c }} />
            <span className="n">{shortType(name)}</span>
            <span className="v">{fmtNum(Number(t?.count) || 0)}</span>
          </span>
        );
      })}
    </div>
  );
}

type Metric = 'clients' | 'stores';

const valueOf = (r: RankItem, m: Metric) => Number(m === 'stores' ? r?.stores : r?.clients) || 0;

/** 「更多」→ 全部排行表格（三张卡共用） */
function AllRankModal({
  title, open, onClose, items, metric, unit, dark, isMobile, showSales,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  items: RankItem[];
  metric: Metric;
  unit: string;
  dark: boolean;
  isMobile: boolean;
  showSales?: boolean;
}) {
  const columns: ColumnsType<RankItem> = [
    {
      title: '排名', dataIndex: 'rank', key: 'rank', width: 62, align: 'center',
      render: (_: unknown, r, i) => {
        const no = Number(r?.rank) || i + 1;
        return <span className="vb4-no" style={{ display: 'inline-flex', ...badgeStyle(no) }}>{no}</span>;
      },
    },
    {
      title: '名称', dataIndex: 'name', key: 'name',
      render: (v: string, r) => {
        const sn = showSales ? String(r?.salesName ?? '').trim() : '';
        return (
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 600, display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
              <span>{String(v ?? '') || '-'}</span>
              {sn && <span style={{ fontSize: 10.5, color: 'var(--text2)', fontWeight: 600 }}>· {sn}</span>}
            </div>
            <TypeTags tags={r?.tags} />
          </div>
        );
      },
    },
    {
      title: '客户数', dataIndex: 'clients', key: 'clients', width: 84, align: 'right',
      render: (v: number) => (
        <span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>{fmtNum(Number(v) || 0)}</span>
      ),
    },
    {
      title: '门店数', dataIndex: 'stores', key: 'stores', width: 84, align: 'right',
      render: (v: number) => (
        <span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>{fmtNum(Number(v) || 0)}</span>
      ),
    },
  ];

  return (
    <Modal
      title={<span style={{ color: dark ? '#e2e8f0' : '#16253d' }}>{`${title} · 全部排行（${items.length}）`}</span>}
      open={open}
      onCancel={onClose}
      footer={null}
      width={isMobile ? '94vw' : 680}
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
    >
      <div className="v7d-modal" style={dark ? PORTAL_DARK : PORTAL_LIGHT}>
        <Table<RankItem>
          size="small"
          rowKey={(r, i) => `${r?.rank ?? i}-${r?.name ?? i}`}
          columns={columns}
          dataSource={items}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /> }}
          pagination={{ pageSize: 20, size: 'small', showSizeChanger: false, showTotal: (t) => `共 ${t} 项` }}
          scroll={{ x: 'max-content' }}
        />
      </div>
    </Modal>
  );
}

/** 卡头（统一结构：色点 + 标题 13/700 + 右侧「共 N 位」11 + 更多） */
function CardHead({
  title, sub, onMore, moreDisabled, dotColor,
}: { title: string; sub: string; onMore: () => void; moreDisabled?: boolean; dotColor: string }) {
  return (
    <div className="vb4-h">
      <h3>
        <span className="vb4-dot" style={{ background: dotColor }} />
        {title}
      </h3>
      <span className="vb4-sub">{sub}</span>
      <button type="button" className="vb4-more" onClick={onMore} disabled={moreDisabled}>
        更多 <RightOutlined />
      </button>
    </div>
  );
}

/* ══════════════ A. 客户数排行榜（横向条形风） ══════════════ */

function ClientsRankCard({ items, isMobile }: { items: RankItem[]; isMobile: boolean }) {
  const dark = useThemeMode() === 'dark';
  const [open, setOpen] = useState(false);
  const top = items.slice(0, 5);
  const max = useMemo(() => items.reduce((m, x) => Math.max(m, valueOf(x, 'clients')), 0) || 1, [items]);
  const total = useMemo(() => items.reduce((s, x) => s + valueOf(x, 'clients'), 0), [items]);

  return (
    <>
      <div className="vb4-card">
        <CardHead
          title="客户数排行榜"
          sub={`共 ${items.length} 位`}
          dotColor="var(--brand)"
          onMore={() => setOpen(true)}
        />
        <div className="vb4-b">
          {top.length === 0 ? (
            <div className="vb4-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /></div>
          ) : top.map((r, i) => {
            const no = Number(r?.rank) || i + 1;
            const v = valueOf(r, 'clients');
            const w = Math.max(4, Math.min(100, (v / max) * 100));
            const stores = Number(r?.stores) || 0;
            return (
              <div className="vb4-row" key={`c-${no}-${r?.name ?? i}`}>
                <div className="vb4-no" style={badgeStyle(no)}>{no}</div>
                <div className="vb4-main">
                  <div className="vb4-nm">
                    <span className="nm" title={String(r?.name ?? '')}>{String(r?.name ?? '') || '-'}</span>
                    <span className="sn">{fmtNum(stores)} 门店</span>
                  </div>
                  <div className="vb4-track">
                    <i style={{ width: `${w}%`, background: accentOf(no) }} />
                  </div>
                  <TypeTags tags={r?.tags} />
                </div>
                <div className="vb4-val">
                  <b>{fmtNum(v)}</b>
                  <span>客户</span>
                </div>
              </div>
            );
          })}
          {top.length > 0 && (
            <div className="vb4a-foot">
              <span>TOP 5 合计</span>
              <span><b>{fmtNum(top.reduce((s, x) => s + valueOf(x, 'clients'), 0))}</b> / {fmtNum(total)} 家</span>
            </div>
          )}
        </div>
      </div>
      <AllRankModal
        title="客户数排行榜" open={open} onClose={() => setOpen(false)}
        items={items} metric="clients" unit="客户" dark={dark} isMobile={isMobile}
      />
    </>
  );
}

/* ══════════════ B. 门店数排行榜（数据卡风：大数字主导） ══════════════ */

function StoresRankCard({ items, isMobile }: { items: RankItem[]; isMobile: boolean }) {
  const dark = useThemeMode() === 'dark';
  const [open, setOpen] = useState(false);
  const top = items.slice(0, 5);
  const max = useMemo(() => items.reduce((m, x) => Math.max(m, valueOf(x, 'stores')), 0) || 1, [items]);

  return (
    <>
      <div className="vb4-card">
        <CardHead
          title="门店数排行榜"
          sub={`共 ${items.length} 位`}
          dotColor="var(--warn)"
          onMore={() => setOpen(true)}
        />
        <div className="vb4-b">
          {top.length === 0 ? (
            <div className="vb4-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /></div>
          ) : top.map((r, i) => {
            const no = Number(r?.rank) || i + 1;
            const v = valueOf(r, 'stores');
            const w = Math.max(4, Math.min(100, (v / max) * 100));
            const clients = Number(r?.clients) || 0;
            return (
              <div className="vb4-row vb4b-row" key={`s-${no}-${r?.name ?? i}`}>
                <div className="vb4-no" style={badgeStyle(no)}>{no}</div>
                <div className="vb4-main">
                  <div className="vb4b-num">
                    <b>{fmtNum(v)}</b>
                    <span>门店</span>
                    <span className="vb4b-side" style={{ marginLeft: 'auto' }}>{fmtNum(clients)} 客户</span>
                  </div>
                  <div className="vb4-nm">
                    <span className="nm" title={String(r?.name ?? '')}>{String(r?.name ?? '') || '-'}</span>
                  </div>
                  <div className="vb4-track">
                    <i style={{ width: `${w}%`, background: accentOf(no) }} />
                  </div>
                  <TypeTags tags={r?.tags} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <AllRankModal
        title="门店数排行榜" open={open} onClose={() => setOpen(false)}
        items={items} metric="stores" unit="门店" dark={dark} isMobile={isMobile}
      />
    </>
  );
}

/* ══════════════ C. 省份排行榜（热力网格 + 点击下钻） ══════════════ */

/** 省份下钻弹窗：销售分布 + 连锁明细（数据来自 props.detail.rows，不发请求） */
function ProvinceDrillModal({
  province, open, onClose, rows, dark, isMobile,
}: {
  province: RankItem | null;
  open: boolean;
  onClose: () => void;
  rows: DetailFullRow[];
  dark: boolean;
  isMobile: boolean;
}) {
  const name = String(province?.name ?? '');

  const chains = useMemo(() => {
    const list = Array.isArray(rows) ? rows : [];
    return name ? list.filter((r) => String(r?.province ?? '') === name) : [];
  }, [rows, name]);

  const clients = chains.length || Number(province?.clients) || 0;
  const stores = chains.length
    ? chains.reduce((s, r) => s + (Number(r?.stores) || 0), 0)
    : Number(province?.stores) || 0;

  /** 按销售聚合 */
  const salesGroups = useMemo(() => {
    const m = new Map<string, { name: string; clients: number; stores: number }>();
    chains.forEach((r) => {
      const k = String(r?.sales ?? '').trim() || '未分配';
      const cur = m.get(k) || { name: k, clients: 0, stores: 0 };
      cur.clients += 1;
      cur.stores += Number(r?.stores) || 0;
      m.set(k, cur);
    });
    return Array.from(m.values()).sort((a, b) => b.clients - a.clients || b.stores - a.stores);
  }, [chains]);

  const maxSales = salesGroups.reduce((m, x) => Math.max(m, x.clients), 0) || 1;

  const columns: ColumnsType<DetailFullRow> = [
    {
      title: '连锁名称', dataIndex: 'chainName', key: 'chainName', width: 210, ellipsis: true,
      render: (v: string) => <span style={{ color: 'var(--text)', fontWeight: 600 }} title={String(v ?? '')}>{String(v ?? '') || '-'}</span>,
    },
    {
      title: '类型', dataIndex: 'chainType', key: 'chainType', width: 78, align: 'center',
      render: (v: string) => {
        const c = typeColor(String(v ?? ''));
        return (
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 6px', height: 18,
              borderRadius: 6, fontSize: 10, fontWeight: 650,
              background: `color-mix(in srgb, ${c} 12%, transparent)`,
              border: `1px solid color-mix(in srgb, ${c} 34%, transparent)`,
              color: 'var(--text)', whiteSpace: 'nowrap',
            }}
          >
            <i style={{ width: 5, height: 5, borderRadius: 2, background: c, display: 'block' }} />
            {shortType(String(v ?? ''))}
          </span>
        );
      },
    },
    {
      title: '门店', dataIndex: 'stores', key: 'stores', width: 70, align: 'right',
      render: (v: number) => <span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>{fmtNum(Number(v) || 0)}</span>,
    },
    {
      title: '销售', dataIndex: 'sales', key: 'sales', width: 76,
      render: (v: string) => <span style={{ color: 'var(--text)', fontWeight: 600 }}>{String(v ?? '') || '-'}</span>,
    },
    {
      title: '当前节点', dataIndex: 'node', key: 'node', width: 92,
      render: (v: string) => <span style={{ color: 'var(--text2)', fontWeight: 600 }}>{String(v ?? '') || '流程结束'}</span>,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 60, align: 'center',
      render: (v: string) => {
        const overdue = String(v ?? '') === '超期';
        return (
          <span style={{ color: overdue ? 'var(--danger)' : 'var(--green)', fontWeight: 700 }}>
            {overdue ? '超期' : '正常'}
          </span>
        );
      },
    },
  ];

  return (
    <Modal
      title={
        <span style={{ color: dark ? '#e2e8f0' : '#16253d' }}>
          {`${name || '省份'} · 地图下钻`}
        </span>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={isMobile ? '96vw' : 860}
      styles={{ body: { maxHeight: '72vh', overflowY: 'auto' } }}
    >
      <div className="v7d-modal" style={dark ? PORTAL_DARK : PORTAL_LIGHT}>
        <div className="vb4d-sum">
          <span>客户 <b>{fmtNum(clients)}</b> 家</span>
          <span>门店 <b>{fmtNum(stores)}</b> 家</span>
          <span>销售 <b>{fmtNum(salesGroups.length || (Number(province?.salesCount) || 0))}</b> 人</span>
          <span>连锁 <b>{fmtNum(chains.length)}</b> 家</span>
        </div>

        <TypeTags tags={province?.tags} />

        <div className="vb4d-sec" style={{ marginTop: 10 }}>销售分布</div>
        {salesGroups.length === 0 ? (
          <div style={{ fontSize: 11.5, color: 'var(--text2)', fontWeight: 600, marginBottom: 8 }}>
            当前筛选下无连锁明细（可参考上方连锁类型分布）
          </div>
        ) : (
          <div className="vb4d-chips">
            {salesGroups.map((g) => (
              <span className="vb4d-chip" key={g.name}>
                {g.name}
                <b>{fmtNum(g.clients)}</b>
                <span className="bar"><i style={{ width: `${Math.max(8, (g.clients / maxSales) * 100)}%` }} /></span>
                <span style={{ fontSize: 10, color: 'var(--text2)', fontWeight: 600 }}>{fmtNum(g.stores)} 店</span>
              </span>
            ))}
          </div>
        )}

        <div className="vb4d-sec">连锁明细</div>
        <Table<DetailFullRow>
          size="small"
          rowKey={(r, i) => `${r?.chainId ?? i}-${i}`}
          columns={columns}
          dataSource={chains}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无明细" /> }}
          pagination={chains.length > 10 ? { pageSize: 10, size: 'small', showSizeChanger: false, showTotal: (t) => `共 ${t} 家` } : false}
          scroll={{ x: 'max-content', y: 260 }}
        />
      </div>
    </Modal>
  );
}

function ProvinceRankCard({
  items, detailRows, isMobile,
}: { items: RankItem[]; detailRows: DetailFullRow[]; isMobile: boolean }) {
  const dark = useThemeMode() === 'dark';
  const [listOpen, setListOpen] = useState(false);
  const [drill, setDrill] = useState<RankItem | null>(null);

  const max = useMemo(() => items.reduce((m, x) => Math.max(m, valueOf(x, 'clients')), 0) || 1, [items]);
  const total = useMemo(() => items.reduce((s, x) => s + valueOf(x, 'clients'), 0), [items]);
  const maxStores = useMemo(() => items.slice(0, 5).reduce((m, x) => Math.max(m, Number(x?.stores) || 0), 0) || 1, [items]);
  const totalStores = useMemo(() => items.slice(0, 5).reduce((s, x) => s + (Number(x?.stores) || 0), 0), [items]);

  return (
    <>
      <div className="vb4-card">
        <CardHead
          title="省份排行榜"
          sub={`共 ${items.length} 个省`}
          dotColor="var(--green)"
          onMore={() => setListOpen(true)}
        />
        <div className="vb4-b">
          {items.length === 0 ? (
            <div className="vb4-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /></div>
          ) : (
            <>
              {/* 5 格严格等宽等高 + 单色相（--brand）深浅 */}
              <div className="vb4c-wrap">
                <div className="vb4c-grid">
                  {items.slice(0, 5).map((r, i) => {
                    const no = Number(r?.rank) || i + 1;
                    const v = valueOf(r, 'clients');
                    const stores = Number(r?.stores) || 0;
                    /* 12%~42% 混入 brand：只在一个色相内做深浅，正文一律 --text，明暗都达标 */
                    const heat = Math.round(12 + 30 * (v / max));
                    return (
                      <button
                        type="button"
                        key={`p-${no}-${r?.name ?? i}`}
                        className="vb4c-cell"
                        onClick={() => setDrill(r)}
                        title={`${r?.name ?? ''}：${v} 家客户 / ${fmtNum(stores)} 门店${r?.salesName ? ` · 主销售 ${r.salesName}` : ''}（点击查看明细）`}
                        style={{
                          background: `color-mix(in srgb, var(--brand) ${heat}%, var(--panel))`,
                          borderColor: `color-mix(in srgb, var(--brand) ${Math.min(55, heat + 14)}%, var(--line))`,
                          color: 'var(--text)',
                        }}
                      >
                        <span className="rk">{no}</span>
                        <span className="pn">{shortProvince(String(r?.name ?? ''))}</span>
                        <span className="cv">{fmtNum(v)}</span>
                        <span className="st">{fmtNum(stores)} 门店</span>
                      </button>
                    );
                  })}
                </div>
                {/* 门店占比：同一批 5 个省的第二维度，把卡片下半部分填满 */}
                <div className="vb4c-bars">
                  {items.slice(0, 5).map((r, i) => {
                    const no = Number(r?.rank) || i + 1;
                    const stores = Number(r?.stores) || 0;
                    const w = maxStores > 0 ? Math.max(3, Math.min(100, (stores / maxStores) * 100)) : 3;
                    return (
                      <div className="vb4c-bar" key={`sb-${no}-${r?.name ?? i}`}>
                        <span className="n">{shortProvince(String(r?.name ?? ''))}</span>
                        <span className="t"><i style={{ width: `${w}%` }} /></span>
                        <span className="v">{fmtNum(stores)}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="vb4c-foot">
                  <span>客户 少</span>
                  <span className="vb4c-ramp">
                    {[12, 22, 32, 42].map((h) => (
                      <i key={h} style={{ background: `color-mix(in srgb, var(--brand) ${h}%, var(--panel))` }} />
                    ))}
                  </span>
                  <span>多</span>
                  <span className="tip">门店 {fmtNum(totalStores)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* V8.1 E3：「更多」→ 中国地图 */}
      <ProvinceMapModal
        items={items}
        open={listOpen}
        onClose={() => setListOpen(false)}
        dark={dark}
        isMobile={isMobile}
      />
      <ProvinceDrillModal
        province={drill}
        open={!!drill}
        onClose={() => setDrill(null)}
        rows={detailRows}
        dark={dark}
        isMobile={isMobile}
      />
    </>
  );
}

/* ══════════════ 默认导出 ══════════════ */

export default function Rankings({ data, isMobile }: Props) {
  const r3 = data?.row3;
  const salesClientRank = Array.isArray(r3?.salesClientRank) ? r3.salesClientRank : [];
  const salesStoreRank = Array.isArray(r3?.salesStoreRank) ? r3.salesStoreRank : [];
  const provinceRank = Array.isArray(r3?.provinceRank) ? r3.provinceRank : [];
  const detailRows = Array.isArray(data?.detail?.rows) ? data.detail.rows : [];

  return (
    <>
      <style>{CSS}</style>
      <div className="vb4-grid">
        <ClientsRankCard items={salesClientRank} isMobile={isMobile} />
        <StoresRankCard items={salesStoreRank} isMobile={isMobile} />
        <ProvinceRankCard items={provinceRank} detailRows={detailRows} isMobile={isMobile} />
      </div>
    </>
  );
}
