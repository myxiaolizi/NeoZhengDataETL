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

/* ══════════════ 名次配色：V10 要求 TOP3「鲜艳」，第 2 名不得用灰 ══════════════ */

/**
 * V10 契约 §四-R3 明确要求：
 *   第1名 红色系 / 第2名 橙色系 / 第3名 黄色系（都要鲜艳），**第 2 名禁止灰色**
 *   第 4 名起中性（--line2 底 + --text2 字）
 * TOP3 用固定渐变值（契约允许并建议），并配同色系深字保证对比度 ≥6（白字压在亮黄上只有 1.7）。
 */
interface Medal {
  /** 徽章渐变底 */
  bg: string;
  /** 徽章文字色（同色系深色） */
  fg: string;
  /** 占比条颜色 */
  bar: string;
  /** 阴影 */
  shadow: string;
}

/** V10：默认（客户数榜 / 门店数榜）—— 红 → 橙 → 黄 */
const MEDALS_WARM: Record<number, Medal> = {
  1: { bg: 'linear-gradient(135deg,#ef4444,#dc2626)', fg: '#ffffff', bar: 'linear-gradient(90deg,#f87171,#dc2626)', shadow: '0 1px 3px rgba(220,38,38,.40)' },
  2: { bg: 'linear-gradient(135deg,#fb923c,#f97316)', fg: '#ffffff', bar: 'linear-gradient(90deg,#fdba74,#ea580c)', shadow: '0 1px 3px rgba(249,115,22,.40)' },
  3: { bg: 'linear-gradient(135deg,#fbbf24,#f59e0b)', fg: '#452a03', bar: 'linear-gradient(90deg,#fcd34d,#d97706)', shadow: '0 1px 3px rgba(217,119,6,.40)' },
};

/** V10：省份榜「颜色适当调整」—— 紫 → 蓝 → 青（同样鲜艳，色系与另两卡区分） */
const MEDALS_COOL: Record<number, Medal> = {
  1: { bg: 'linear-gradient(135deg,#7c3aed,#6d28d9)', fg: '#ffffff', bar: 'linear-gradient(90deg,#a78bfa,#6d28d9)', shadow: '0 1px 3px rgba(109,40,217,.40)' },
  2: { bg: 'linear-gradient(135deg,#2563eb,#1d4ed8)', fg: '#ffffff', bar: 'linear-gradient(90deg,#60a5fa,#1d4ed8)', shadow: '0 1px 3px rgba(29,78,216,.40)' },
  3: { bg: 'linear-gradient(135deg,#0891b2,#0e7490)', fg: '#ffffff', bar: 'linear-gradient(90deg,#22d3ee,#0e7490)', shadow: '0 1px 3px rgba(14,116,144,.40)' },
};

const MEDAL_SET = { warm: MEDALS_WARM, cool: MEDALS_COOL };

/** 名次徽章样式（TOP3 鲜艳 / 4+ 中性） */
function badgeStyle(no: number, set: 'warm' | 'cool' = 'warm'): React.CSSProperties {
  const m = MEDAL_SET[set][no];
  if (m) return { background: m.bg, color: m.fg, boxShadow: m.shadow };
  return { background: 'var(--line2)', color: 'var(--text2)', boxShadow: 'none' };
}

/** 占比条填充（TOP3 用对应鲜艳色；4+ 用传入的中性强调色） */
function barFill(no: number, neutral: string, set: 'warm' | 'cool' = 'warm'): string {
  const m = MEDAL_SET[set][no];
  return m ? m.bar : neutral;
}

/** 三张卡的强调色：客户数榜用 brand 蓝；门店数榜同客户数榜；省份榜改用 purple 系做区分 */
const ACCENT = {
  clients: 'var(--brand)',
  stores: 'var(--brand)',
  province: 'var(--purple)',
};

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

/* ── 排行条目（三张卡完全一致的结构）：徽章 + 名称/占比条/标签 + 数值 ── */
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
              {sn && <span style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 600 }}>· {sn}</span>}
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

/** 卡头（色点 + 标题 13/700 + 可选说明 11 + 更多；sub 为空则不渲染说明） */
function CardHead({
  title, sub, onMore, moreDisabled, dotColor,
}: { title: string; sub?: string; onMore: () => void; moreDisabled?: boolean; dotColor: string }) {
  return (
    <div className="vb4-h">
      <h3>
        <span className="vb4-dot" style={{ background: dotColor }} />
        {title}
      </h3>
      {sub ? <span className="vb4-sub">{sub}</span> : null}
      <button type="button" className="vb4-more" onClick={onMore} disabled={moreDisabled}>
        更多 <RightOutlined />
      </button>
    </div>
  );
}

/* ══════════════ 共用：排行条目（三卡结构完全一致） ══════════════ */

/**
 * V10 契约 §四-R3：三张排行卡「显示方式完全一致」——
 * 名次徽章 + 名称 + 数值 + 占比条（外加副信息与类型标签）。
 * 差异只在：数值口径（客户/门店）、强调色（neutral）与卡头文案。
 */
function RankRowView({
  no, name, sub, value, unit, ratio, neutral, tags, onClick, medalSet = 'warm',
}: {
  no: number;
  name: string;
  sub?: string;
  value: number;
  unit: string;
  /** 0~100，相对榜首 */
  ratio: number;
  neutral: string;
  tags?: RankItem['tags'];
  onClick?: () => void;
  /** TOP3 色系：warm=红橙黄（客户/门店榜）· cool=紫蓝青（省份榜） */
  medalSet?: 'warm' | 'cool';
}) {
  return (
    <div
      className="vb4-row"
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      style={onClick ? { cursor: 'pointer' } : undefined}
      title={onClick ? `${name}：点击查看明细` : undefined}
    >
      <div className="vb4-no" style={badgeStyle(no, medalSet)}>{no}</div>
      <div className="vb4-main">
        <div className="vb4-nm">
          <span className="nm" title={name}>{name || '-'}</span>
          {sub ? <span className="sn">{sub}</span> : null}
        </div>
        <div className="vb4-track">
          <i style={{ width: `${Math.max(4, Math.min(100, ratio))}%`, background: barFill(no, neutral, medalSet) }} />
        </div>
        <TypeTags tags={tags} />
      </div>
      <div className="vb4-val">
        <b>{fmtNum(value)}</b>
        <span>{unit}</span>
      </div>
    </div>
  );
}

/* ══════════════ A. 客户数排行榜 ══════════════ */

function ClientsRankCard({ items, isMobile }: { items: RankItem[]; isMobile: boolean }) {
  const dark = useThemeMode() === 'dark';
  const [open, setOpen] = useState(false);
  const top = items.slice(0, 5);
  const max = useMemo(() => items.reduce((m, x) => Math.max(m, valueOf(x, 'clients')), 0) || 1, [items]);

  return (
    <>
      <div className="vb4-card">
        <CardHead
          title="客户数排行榜"
          /* V10：口径说明替代原来的「共 12 位」 */
          sub="仅计算 50+ 以上的连锁"
          dotColor="var(--brand)"
          onMore={() => setOpen(true)}
        />
        <div className="vb4-b">
          {top.length === 0 ? (
            <div className="vb4-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /></div>
          ) : top.map((r, i) => {
            const no = Number(r?.rank) || i + 1;
            const v = valueOf(r, 'clients');
            const stores = Number(r?.stores) || 0;
            return (
              <RankRowView
                key={`c-${no}-${r?.name ?? i}`}
                no={no}
                name={String(r?.name ?? '')}
                sub={`${fmtNum(stores)} 门店`}
                value={v}
                unit="客户"
                ratio={(v / max) * 100}
                neutral={ACCENT.clients}
                tags={r?.tags}
              />
            );
          })}
        </div>
      </div>
      <AllRankModal
        title="客户数排行榜" open={open} onClose={() => setOpen(false)}
        items={items} metric="clients" unit="客户" dark={dark} isMobile={isMobile}
      />
    </>
  );
}

/* ══════════════ B. 门店数排行榜（与客户数榜结构完全一致） ══════════════ */

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
          /* V10：卡头不再显示「共 12 位」→ 传空串，CardHead 内部不渲染 */
          sub=""
          dotColor="var(--brand)"
          onMore={() => setOpen(true)}
        />
        <div className="vb4-b">
          {top.length === 0 ? (
            <div className="vb4-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /></div>
          ) : top.map((r, i) => {
            const no = Number(r?.rank) || i + 1;
            const v = valueOf(r, 'stores');
            const clients = Number(r?.clients) || 0;
            return (
              <RankRowView
                key={`s-${no}-${r?.name ?? i}`}
                no={no}
                name={String(r?.name ?? '')}
                sub={`${fmtNum(clients)} 客户`}
                value={v}
                unit="门店"
                ratio={(v / max) * 100}
                neutral={ACCENT.stores}
                tags={r?.tags}
              />
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
              borderRadius: 6, fontSize: 11, fontWeight: 650,
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
                <span style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 600 }}>{fmtNum(g.stores)} 店</span>
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

  /* V10：按**客户数**排名（后端 provinceRank 已按 clients 降序，rank 字段即该口径） */
  const sorted = useMemo(
    () => items.slice().sort((a, b) => valueOf(b, 'clients') - valueOf(a, 'clients')),
    [items],
  );
  const top = sorted.slice(0, 5);
  const max = useMemo(() => sorted.reduce((m, x) => Math.max(m, valueOf(x, 'clients')), 0) || 1, [sorted]);

  return (
    <>
      <div className="vb4-card">
        <CardHead
          title="省份排行榜"
          /* V10：文案改为「已覆盖 N 个省市」 */
          sub={`已覆盖 ${items.length} 个省市`}
          dotColor="var(--purple)"
          onMore={() => setListOpen(true)}
        />
        <div className="vb4-b">
          {top.length === 0 ? (
            <div className="vb4-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /></div>
          ) : top.map((r, i) => {
            const no = Number(r?.rank) || i + 1;
            const v = valueOf(r, 'clients');
            const stores = Number(r?.stores) || 0;
            const sales = String(r?.salesName ?? '').trim();
            return (
              <RankRowView
                key={`p-${no}-${r?.name ?? i}`}
                no={no}
                name={shortProvince(String(r?.name ?? ''))}
                sub={sales ? `${sales} · ${fmtNum(stores)} 门店` : `${fmtNum(stores)} 门店`}
                value={v}
                unit="客户"
                ratio={(v / max) * 100}
                /* V10：省份榜换 purple/blue/cyan 色系，与客户数/门店数榜（红橙黄）区分 */
                neutral={ACCENT.province}
                medalSet="cool"
                tags={r?.tags}
                onClick={() => setDrill(r)}
              />
            );
          })}
        </div>
      </div>

      {/* 「更多」→ 中国地图（保留） */}
      <ProvinceMapModal
        items={sorted}
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
