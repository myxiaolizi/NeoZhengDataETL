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
import React, { useMemo, useState } from 'react';
import { Empty, Modal, Table } from 'antd';
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
/** 名次奖牌（前三名徽章底） */
const MEDAL = ['#ef4444', '#f59e0b', '#eab308'];

/* ══════════════ 语义色 ══════════════ */

function typeColor(name: string): string {
  return CHAIN_TYPE_COLORS[name] || '#94a3b8';
}

function shortType(name: string): string {
  return CHAIN_TYPE_SHORT[name] || name;
}

/* ══════════════ E4：前三名卡片皮肤 ══════════════ */

interface RowSkin {
  background: string;
  borderColor: string;
  /** 条形/环形/强调色 */
  accent: string;
}

const PODIUM = [
  { bg: '#fde8ef', border: '#f9a8c8', accent: '#d94f8a' },
  { bg: '#fdeee0', border: '#f5c08a', accent: '#c9761b' },
  { bg: '#fdf6dd', border: '#e8d48a', accent: '#a8860f' },
];

function rowSkin(no: number, dark: boolean): RowSkin {
  if (no >= 1 && no <= 3) {
    const p = PODIUM[no - 1];
    if (!dark) return { background: p.bg, borderColor: p.border, accent: p.accent };
    /* 暗色：把浅色按低比例混入深色面板，保持色相但文字仍用 --text（浅色）可读 */
    return {
      background: `color-mix(in srgb, ${p.border} 16%, var(--panel2))`,
      borderColor: `color-mix(in srgb, ${p.border} 42%, var(--line))`,
      accent: p.border,
    };
  }
  return { background: 'var(--panel2)', borderColor: 'var(--line)', accent: BRAND };
}

/** 名次徽章：1/2/3 白字 + 压深奖牌底；4 名起浅底 + 正文色（永不用白字压在浅底上） */
function badgeStyle(no: number): React.CSSProperties {
  if (no >= 1 && no <= 3) {
    const c = MEDAL[no - 1];
    return {
      background: `color-mix(in srgb, ${c} 46%, #000000)`,
      color: '#ffffff',
      textShadow: '0 1px 1px rgba(0, 0, 0, .55)',
      boxShadow: `0 2px 7px color-mix(in srgb, ${c} 40%, transparent), inset 0 1px 0 rgba(255, 255, 255, .22)`,
    };
  }
  return { background: 'var(--line2)', color: 'var(--text)', boxShadow: 'none' };
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

/* ══════════════ 局部样式（vb4- 前缀） ══════════════ */
const CSS = `
/* E5：三张卡各自按内容撑开，底部不留空白 */
.vb4-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:start;min-width:0}
/* 768~1279px：让 3 张卡直接成为外层第 3 排 2×2 网格的子项（列宽由 TypeSummary 侧定义） */
@media(min-width:768px) and (max-width:1279.98px){.vb4-grid{display:contents!important}}
/* ≤767px：外层是 1 列（Board.tsx 内联），3 张卡也各占 1 列，否则会挤成 ~108px 宽 */
@media(max-width:767.98px){.vb4-grid{grid-template-columns:1fr!important}}

.vb4-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;height:auto;min-width:0}
.vb4-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}
.vb4-h{padding:12px 14px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:6px 8px;flex-wrap:wrap;flex-shrink:0;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb4-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb4-sub{font-size:10.5px;color:var(--text2);font-weight:600;white-space:nowrap}
.vb4-more{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:600;color:var(--brand);background:transparent;border:0;cursor:pointer;padding:2px 4px;border-radius:6px;transition:background .15s;white-space:nowrap}
.vb4-more:hover{background:var(--brandSoft)}
.vb4-more svg{font-size:9px}
.vb4-b{padding:11px 12px;display:flex;flex-direction:column;justify-content:flex-start;gap:7px;min-width:0;min-height:150px}
.vb4-empty{padding:14px 0}

/* 名次徽章（三卡共用） */
.vb4-no{width:22px;height:22px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1;letter-spacing:0}

/* 类型标签（三卡共用；色点 + 简写 + 家数。标签文字用 var(--text) 保证明暗都可读） */
.vb4-tags{display:flex;gap:4px;flex-wrap:wrap;min-width:0}
.vb4-tags .tt{display:inline-flex;align-items:center;gap:3px;padding:0 5px;height:16px;border-radius:5px;border:1px solid var(--line);background:var(--panel);font-size:9.5px;line-height:1;white-space:nowrap}
.vb4-tags .tt .d{width:5px;height:5px;border-radius:2px;flex-shrink:0}
.vb4-tags .tt .n{color:var(--text);font-weight:650}
.vb4-tags .tt .v{color:var(--text);font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.2px}

/* ══════ A. 客户数排行榜：横向条形风 ══════ */
.vb4a-row{display:grid;grid-template-columns:22px minmax(0,1fr);align-items:center;gap:8px;padding:7px 9px;border:1px solid var(--line);border-radius:var(--radius-sm);transition:transform .16s ease,box-shadow .16s ease;min-width:0}
.vb4a-row:hover{transform:translateX(2px);box-shadow:var(--shadow)}
.vb4a-main{min-width:0;display:flex;flex-direction:column;gap:4px}
.vb4a-top{display:flex;align-items:baseline;gap:5px;min-width:0}
.vb4a-top .nm{font-size:12.5px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.vb4a-top .sn{font-size:10px;font-weight:600;color:var(--text2);flex-shrink:0}
.vb4a-top .v{margin-left:auto;font-size:14px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--text);flex-shrink:0;letter-spacing:-.3px}
.vb4a-top .u{font-size:9px;font-weight:650;color:var(--text2);flex-shrink:0}
.vb4a-bar{height:6px;border-radius:3px;background:color-mix(in srgb,var(--text) 9%,transparent);overflow:hidden}
.vb4a-bar i{display:block;height:100%;border-radius:3px;transition:width .5s cubic-bezier(.4,0,.2,1)}

/* ══════ B. 门店数排行榜：数据卡风（大数字 + 环形刻度） ══════ */
.vb4b-row{display:grid;grid-template-columns:22px minmax(0,1fr) 34px;align-items:center;gap:8px;padding:6px 9px;border:1px solid var(--line);border-radius:var(--radius-sm);transition:transform .16s ease,box-shadow .16s ease;min-width:0}
.vb4b-row:hover{transform:translateX(2px);box-shadow:var(--shadow)}
.vb4b-main{min-width:0;display:flex;flex-direction:column;gap:1px}
/* align-items:center + 显式 line-height：避免 baseline 对齐在窄卡里产生 2px 的行盒溢出 */
.vb4b-num{display:flex;align-items:center;gap:3px;min-width:0;line-height:1.3;min-height:25px}
.vb4b-num b{font-size:19px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.8px;color:var(--text);line-height:1.3;display:inline-block}
.vb4b-num span{font-size:9px;font-weight:700;color:var(--text2);letter-spacing:.3px}
.vb4b-name{display:flex;align-items:baseline;gap:4px;min-width:0;line-height:1.2}
.vb4b-name .nm{font-size:11.5px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.vb4b-name .sn{font-size:9.5px;font-weight:600;color:var(--text2);flex-shrink:0}
.vb4b-ring{width:34px;height:34px;border-radius:50%;flex-shrink:0;position:relative;display:flex;align-items:center;justify-content:center}
.vb4b-ring>i{position:absolute;inset:4px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-style:normal;font-size:8.5px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--text2);letter-spacing:-.3px}
.vb4b-tags{margin-top:1px}

/* ══════ C. 省份排行榜：热力网格（俯瞰地图风） ══════ */
.vb4c-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(56px,1fr));gap:5px;min-width:0}
.vb4c-cell{position:relative;border:1px solid var(--line);border-radius:9px;padding:5px 4px 4px;cursor:pointer;text-align:center;line-height:1.15;transition:transform .14s ease,box-shadow .14s ease,filter .14s ease;font-family:inherit;overflow:hidden}
.vb4c-cell:hover{transform:translateY(-2px) scale(1.03);box-shadow:var(--shadow2);filter:brightness(1.06);z-index:1}
.vb4c-cell:active{transform:translateY(0) scale(.99)}
.vb4c-cell .pn{display:block;font-size:10px;font-weight:700;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb4c-cell .cv{display:block;font-size:13px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.4px;margin-top:1px}
.vb4c-cell .st{display:block;font-size:8px;font-weight:650;opacity:.72;margin-top:1px}
.vb4c-foot{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:9.5px;font-weight:650;color:var(--text2);padding-top:2px}
.vb4c-ramp{display:inline-flex;align-items:center;gap:2px}
.vb4c-ramp i{width:14px;height:8px;border-radius:2px;display:block}
.vb4c-foot .tip{color:var(--text3);font-weight:600;margin-left:auto;white-space:nowrap}

/* 下钻弹窗内的销售分布 chip */
.vb4d-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.vb4d-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:8px;background:var(--panel2);border:1px solid var(--line);font-size:11px;font-weight:650;color:var(--text)}
.vb4d-chip b{font-weight:800;font-variant-numeric:tabular-nums}
.vb4d-chip .bar{width:34px;height:4px;border-radius:2px;background:color-mix(in srgb,var(--text) 10%,transparent);overflow:hidden}
.vb4d-chip .bar i{display:block;height:100%;background:${BRAND};border-radius:2px}
.vb4d-sum{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:11.5px;font-weight:650;color:var(--text2);margin-bottom:10px}
.vb4d-sum b{color:var(--text);font-weight:800;font-variant-numeric:tabular-nums}
.vb4d-sec{font-size:11px;font-weight:750;color:var(--text2);margin:2px 0 6px;letter-spacing:.2px}

/* 弹窗内表格/分页：颜色全部显式声明（portal 拿不到外层变量） */
.v7d-modal{color:var(--text);font-size:12.5px}
.v7d-modal .ant-table{background:transparent;color:var(--text)}
.v7d-modal .ant-table-thead>tr>th{background:var(--panel2)!important;color:var(--text)!important;border-bottom:1px solid var(--line)!important;font-weight:680}
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

/** 卡头（标题 + 计数 + 更多） */
function CardHead({
  title, sub, onMore, moreDisabled,
}: { title: string; sub: string; onMore: () => void; moreDisabled?: boolean }) {
  return (
    <div className="vb4-h">
      <h3>
        <span
          className="vb4-dot"
          style={{
            width: 6, height: 6, borderRadius: 2, background: 'var(--warn)',
            boxShadow: '0 0 0 3px color-mix(in srgb, var(--warn) 16%, transparent)', flexShrink: 0,
          }}
        />
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

  return (
    <>
      <div className="vb4-card">
        <CardHead title="客户数排行榜" sub={`TOP 5 / 共 ${items.length} 位销售`} onMore={() => setOpen(true)} />
        <div className="vb4-b">
          {top.length === 0 ? (
            <div className="vb4-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /></div>
          ) : top.map((r, i) => {
            const no = Number(r?.rank) || i + 1;
            const v = valueOf(r, 'clients');
            const skin = rowSkin(no, dark);
            const w = Math.max(6, Math.min(100, (v / max) * 100));
            return (
              <div
                className="vb4a-row"
                key={`c-${no}-${r?.name ?? i}`}
                style={{ background: skin.background, borderColor: skin.borderColor }}
              >
                <div className="vb4-no" style={badgeStyle(no)}>{no}</div>
                <div className="vb4a-main">
                  <div className="vb4a-top">
                    <span className="nm" title={String(r?.name ?? '')}>{String(r?.name ?? '') || '-'}</span>
                    <span className="v">{fmtNum(v)}</span>
                    <span className="u">客户</span>
                  </div>
                  <div className="vb4a-bar">
                    <i style={{ width: `${w}%`, background: skin.accent }} />
                  </div>
                  <TypeTags tags={r?.tags} />
                </div>
              </div>
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

/* ══════════════ B. 门店数排行榜（数据卡风：大数字 + 环形刻度） ══════════════ */

function StoresRankCard({ items, isMobile }: { items: RankItem[]; isMobile: boolean }) {
  const dark = useThemeMode() === 'dark';
  const [open, setOpen] = useState(false);
  const top = items.slice(0, 5);
  const max = useMemo(() => items.reduce((m, x) => Math.max(m, valueOf(x, 'stores')), 0) || 1, [items]);

  return (
    <>
      <div className="vb4-card">
        <CardHead title="门店数排行榜" sub={`TOP 5 / 共 ${items.length} 位销售`} onMore={() => setOpen(true)} />
        <div className="vb4-b">
          {top.length === 0 ? (
            <div className="vb4-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /></div>
          ) : top.map((r, i) => {
            const no = Number(r?.rank) || i + 1;
            const v = valueOf(r, 'stores');
            const skin = rowSkin(no, dark);
            const pct = Math.max(4, Math.min(100, Math.round((v / max) * 100)));
            return (
              <div
                className="vb4b-row"
                key={`s-${no}-${r?.name ?? i}`}
                style={{ background: skin.background, borderColor: skin.borderColor }}
              >
                <div className="vb4-no" style={badgeStyle(no)}>{no}</div>
                <div className="vb4b-main">
                  <div className="vb4b-num">
                    <b>{fmtNum(v)}</b>
                    <span>门店</span>
                  </div>
                  <div className="vb4b-name">
                    <span className="nm" title={String(r?.name ?? '')}>{String(r?.name ?? '') || '-'}</span>
                  </div>
                  <div className="vb4b-tags"><TypeTags tags={r?.tags} /></div>
                </div>
                {/* 迷你环形刻度：外环 = 与榜首的比值 */}
                <div
                  className="vb4b-ring"
                  style={{ background: `conic-gradient(${skin.accent} ${pct * 3.6}deg, color-mix(in srgb, var(--text) 12%, transparent) 0deg)` }}
                  title={`占榜首 ${pct}%`}
                >
                  <i style={{ background: skin.background }}>{pct}%</i>
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

  return (
    <>
      <div className="vb4-card">
        <CardHead
          title="省份排行榜"
          sub={`${items.length} 个省 / ${fmtNum(total)} 家`}
          onMore={() => setListOpen(true)}
        />
        <div className="vb4-b">
          {items.length === 0 ? (
            <div className="vb4-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /></div>
          ) : (
            <>
              <div className="vb4c-grid">
                {items.map((r, i) => {
                  const no = Number(r?.rank) || i + 1;
                  const v = valueOf(r, 'clients');
                  /* 热力：10%~50% 混入省份色（brand）——上限压到 50%，保证底色始终足够浅/深，
                     正文一律用 var(--text)，明暗两种主题下对比度都达标（不用白字压在中间蓝上） */
                  const heat = Math.round(10 + 40 * (v / max));
                  return (
                    <button
                      type="button"
                      key={`p-${no}-${r?.name ?? i}`}
                      className="vb4c-cell"
                      onClick={() => setDrill(r)}
                      title={`${r?.name ?? ''}：${v} 家客户 / ${fmtNum(Number(r?.stores) || 0)} 门店${r?.salesName ? ` · 主销售 ${r.salesName}` : ''}（点击查看明细）`}
                      style={{
                        background: `color-mix(in srgb, ${BRAND} ${heat}%, var(--panel))`,
                        borderColor: `color-mix(in srgb, ${BRAND} ${Math.min(64, heat + 16)}%, var(--line))`,
                        color: 'var(--text)',
                      }}
                    >
                      <span className="pn">{shortProvince(String(r?.name ?? ''))}</span>
                      <span className="cv">{fmtNum(v)}</span>
                      <span className="st">{r?.salesName ? String(r.salesName) : '—'}</span>
                    </button>
                  );
                })}
              </div>
              <div className="vb4c-foot">
                <span>少</span>
                <span className="vb4c-ramp">
                  {[10, 20, 30, 40, 50].map((h) => (
                    <i
                      key={h}
                      style={{
                        background: `color-mix(in srgb, ${BRAND} ${h}%, var(--panel))`,
                        border: '1px solid color-mix(in srgb, var(--text) 8%, transparent)',
                      }}
                    />
                  ))}
                </span>
                <span>多</span>
                <span className="tip">点击省份看销售/连锁明细</span>
              </div>
            </>
          )}
        </div>
      </div>

      <AllRankModal
        title="省份排行榜" open={listOpen} onClose={() => setListOpen(false)}
        items={items} metric="clients" unit="客户" dark={dark} isMobile={isMobile} showSales
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
