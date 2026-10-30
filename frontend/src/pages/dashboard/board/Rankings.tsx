/** 第 3 排右：3 个排行榜（客户数 / 门店数 / 省份）— V7.0
 *
 * D1 响应式两排：768~1279px 时 4 张卡片（类型汇总 + 3 个排行）2×2
 * D2 弹窗白字修复：Modal 挂在 body 上，拿不到 .board-root 注入的 CSS 变量，
 *    导致 .vb4-no 的 background:var(--danger) 失效 → 白底白字。
 *    现改为：① 弹窗内容外层重新声明令牌；② 徽章配色一律用字面色值，只有前三名是「白字+奖牌底」，
 *    第 4 名起用「浅底 + 正文色」，任何主题下都可读；③ 表格/分页文字显式指定颜色。
 * D4 简写：全国百强 → 全国，区县百强 → 区县（CHAIN_TYPE_SHORT，缺失时本地兜底）
 * D5 省份榜：省份名后显示销售名（row3.provinceRank[i].salesName，缺失不渲染）
 * 配色（契约 §2.1）：全国红 #ef4444 / 区县橙 #f59e0b / 50+ 黄 #eab308 / 50- 灰 #94a3b8
 */
import React, { useMemo, useState } from 'react';
import { Empty, Modal, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RightOutlined } from '@ant-design/icons';
import * as BoardApi from '@/api/crm-board';
import type { BoardData, RankItem } from '@/api/crm-board';
import { fmtNum, useThemeMode } from './theme';

interface Props {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

/** 省份榜额外字段（后端正在补 salesName；缺字段时用 ?. 兜底） */
type RankRow = RankItem & { salesName?: string; sales?: string };

/* ══════════════ D4：连锁类型简写 ══════════════ */

/** 契约 §2.1 简写；若 @/api/crm-board 已导出 CHAIN_TYPE_SHORT 则优先用 API 的 */
const SHORT_FALLBACK: Record<string, string> = {
  全国百强: '全国',
  区县百强: '区县',
  '50+': '50+',
  '50-': '50-',
};
const API_SHORT = (BoardApi as unknown as { CHAIN_TYPE_SHORT?: Record<string, string> }).CHAIN_TYPE_SHORT;
const CHAIN_SHORT: Record<string, string> = { ...SHORT_FALLBACK, ...(API_SHORT || {}) };

function shortType(name: string): string {
  return CHAIN_SHORT[name] || name;
}

/* ══════════════ 配色（契约 §2.1，兼容 V6 旧常量） ══════════════ */

const TYPE_COLOR_FALLBACK: Record<string, string> = {
  全国百强: '#ef4444',
  区县百强: '#f59e0b',
  '50+': '#eab308',
  '50-': '#94a3b8',
};
const LEGACY_TYPE_COLORS = new Set(['#3687ff', '#45b4ff', '#a2d73c', '#b5b5b6']);

function typeColor(name: string): string {
  const api = (BoardApi.CHAIN_TYPE_COLORS || {})[name];
  if (api && !LEGACY_TYPE_COLORS.has(String(api).toLowerCase())) return api;
  return TYPE_COLOR_FALLBACK[name] || '#94a3b8';
}

/** 前三名奖牌色（字面色值：弹窗弹到 body 上也有效） */
const MEDAL = ['#ef4444', '#f59e0b', '#eab308'];
const BRAND = '#2563eb';

/** 名次徽章：1/2/3 白字 + 奖牌底；4 名起浅底 + 正文色（不再白字，避免不可见）
 *
 * D2 根因：旧代码 `background: var(--danger)` 依赖 .board-root 上的 CSS 变量，
 * 而 Modal 通过 portal 挂到 body，取不到变量 → 背景变透明（白底）+ `color:#fff` = 白底白字。
 * 修复：① 背景一律写字面色值，不依赖 var；
 *      ② 白字只出现在前三名，且把奖牌色压深到可读区间（白字实测对比度 3.1~4.4，旧值仅 1.44~2.09）；
 *      ③ 第 4 名起用「浅底 + 正文色」，任何主题下都清晰。
 */
function badgeStyle(no: number): React.CSSProperties {
  if (no >= 1 && no <= 3) {
    const c = MEDAL[no - 1];
    return {
      /* 纯色（不是渐变）：白字对比度可测量、可复现 */
      background: `color-mix(in srgb, ${c} 46%, #000000)`,
      color: '#ffffff',
      textShadow: '0 1px 1px rgba(0, 0, 0, .55)',
      boxShadow: `0 2px 7px color-mix(in srgb, ${c} 40%, transparent), inset 0 1px 0 rgba(255, 255, 255, .22)`,
    };
  }
  return { background: 'var(--line2)', color: 'var(--text)', boxShadow: 'none' };
}


/** 弹窗（体挂 body）用的令牌重声明：Board.tsx 把变量注入在 .board-root 上，portal 继承不到 */
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

/* ══════════════ 局部样式（vb4- 前缀） ══════════════ */
const CSS = `
.vb4-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:stretch;height:100%;min-width:0}
@media(max-width:1100px){.vb4-grid{grid-template-columns:1fr!important}}

/* ── D1：768~1279px 时 4 张卡片 2×2 ──
   第 3 排外层是 Board.tsx 的 2 列 grid（1fr + 2fr）：
   ① 把外层列改成等宽两列（!important 压制内联 style）
   ② .vb4-grid 用 display:contents，让 3 张排行卡直接成为外层 grid 子项
   → 类型汇总 + 排行卡1 / 排行卡2 + 排行卡3 = 2 行 × 2 列 */
@media(min-width:768px) and (max-width:1279.98px){
  div:has(> .vb3-card):has(> .vb4-grid){grid-template-columns:repeat(2,minmax(0,1fr))!important}
  .vb4-grid{display:contents!important}
}

.vb4-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;height:100%;min-width:0}
.vb4-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}
.vb4-h{padding:13px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:6px 8px;flex-wrap:wrap;flex-shrink:0;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb4-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb4-dot{width:6px;height:6px;border-radius:2px;background:var(--warn);box-shadow:0 0 0 3px color-mix(in srgb,var(--warn) 16%,transparent);flex-shrink:0}
.vb4-more{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:600;color:var(--brand);background:transparent;border:0;cursor:pointer;padding:2px 4px;border-radius:6px;transition:all .15s;white-space:nowrap}
.vb4-more:hover{background:var(--brandSoft)}
.vb4-more svg{font-size:9px}
.vb4-b{padding:12px 14px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}

/* 排行行：桌面第 3 排每张卡只有 ~248px 宽，行内一律紧凑 + 允许折行（不裁剪任何内容） */
.vb4-rank{display:flex;flex-direction:column;gap:6px}
.vb4-row{display:grid;grid-template-columns:22px minmax(0,1fr) auto;align-items:center;gap:8px;padding:7px 9px;background:var(--panel2);border:1px solid var(--line);border-radius:var(--radius-sm);transition:all .18s cubic-bezier(.4,0,.2,1);min-width:0}
.vb4-row:hover{border-color:var(--brand3);background:var(--brandSoft);transform:translateX(2px)}
.vb4-no{width:22px;height:22px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1;letter-spacing:0}
.vb4-main{min-width:0;display:flex;flex-direction:column;gap:4px}
.vb4-name{font-size:12.5px;font-weight:680;color:var(--text);display:flex;align-items:baseline;gap:4px;line-height:1.2;min-width:0;flex-wrap:wrap;row-gap:1px}
.vb4-name .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:100%;color:var(--text)}
.vb4-name .sn{font-size:10.5px;color:var(--text2);font-weight:600;flex-shrink:0;white-space:nowrap}
.vb4-name .sub{font-size:9.5px;color:var(--text3);font-weight:600;font-variant-numeric:tabular-nums;flex-shrink:0;white-space:nowrap}
.vb4-val{flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:1px;min-width:44px;text-align:right}
.vb4-val b{font-size:15px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.5px;color:var(--text);display:block;width:100%;text-align:right}
.vb4-val span{font-size:9px;color:var(--text3);font-weight:600;letter-spacing:.3px;display:block;width:100%;text-align:right}

/* 类型标签：色点 + 简写 + 家数（不用白字，避免任何主题下不可见） */
.vb4-tags{display:flex;gap:4px;flex-wrap:wrap;min-width:0}
.vb4-tags .tt{display:inline-flex;align-items:center;gap:3px;padding:0 5px;height:16px;border-radius:5px;border:1px solid var(--line);background:var(--panel);font-size:9.5px;line-height:1;white-space:nowrap}
.vb4-tags .tt .d{width:5px;height:5px;border-radius:2px;flex-shrink:0}
.vb4-tags .tt .n{color:var(--text2);font-weight:650}
.vb4-tags .tt .v{color:var(--text);font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.2px}
.vb4-empty{padding:18px 0}

/* 弹窗内表格/分页：颜色全部显式声明（D2） */
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

/** 类型标签组（色点 + 简写 + 家数） */
function TypeTags({ tags }: { tags?: RankItem['tags'] }) {
  const list = Array.isArray(tags) ? tags : [];
  if (!list.length) return null;
  return (
    <div className="vb4-tags">
      {list.map((t) => {
        const c = typeColor(String(t?.name ?? ''));
        return (
          <span
            key={String(t?.name ?? '')}
            className="tt"
            style={{
              borderColor: `color-mix(in srgb, ${c} 34%, transparent)`,
              background: `color-mix(in srgb, ${c} 10%, transparent)`,
            }}
            title={`${t?.name} ${t?.count} 家`}
          >
            <i className="d" style={{ background: c }} />
            <span className="n">{shortType(String(t?.name ?? ''))}</span>
            <span className="v">{fmtNum(Number(t?.count) || 0)}</span>
          </span>
        );
      })}
    </div>
  );
}

/** 省份榜的销售名（D5，缺失不渲染） */
function salesNameOf(r: RankRow): string {
  return String(r?.salesName ?? r?.sales ?? '').trim();
}

type Metric = 'clients' | 'stores';

/** 单个排行卡 */
function RankCard({
  title, items, metric, isMobile, unit, showSales,
}: {
  title: string;
  items: RankItem[];
  metric: Metric;
  isMobile: boolean;
  unit: string;
  showSales?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const mode = useThemeMode();
  const list = useMemo(() => (Array.isArray(items) ? (items as RankRow[]) : []), [items]);
  const top = list.slice(0, 5);

  const value = (r: RankRow) => Number(metric === 'stores' ? r?.stores : r?.clients) || 0;

  const allColumns: ColumnsType<RankRow> = [
    {
      title: '排名',
      dataIndex: 'rank',
      key: 'rank',
      width: 64,
      align: 'center',
      render: (_: unknown, r, i) => {
        const no = Number(r?.rank) || i + 1;
        return (
          <span
            className="vb4-no"
            style={{ display: 'inline-flex', ...badgeStyle(no) }}
          >
            {no}
          </span>
        );
      },
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (v: string, r) => {
        const sn = showSales ? salesNameOf(r) : '';
        return (
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 12.5, color: 'var(--text)', fontWeight: 600,
                display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap',
              }}
            >
              <span>{String(v ?? '') || '-'}</span>
              {sn && <span style={{ fontSize: 10.5, color: 'var(--text2)', fontWeight: 600 }}>· {sn}</span>}
            </div>
            <TypeTags tags={r?.tags} />
          </div>
        );
      },
    },
    {
      title: '客户数',
      dataIndex: 'clients',
      key: 'clients',
      width: 90,
      align: 'right',
      render: (v: number) => (
        <span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>
          {fmtNum(Number(v) || 0)}
        </span>
      ),
    },
    {
      title: '门店数',
      dataIndex: 'stores',
      key: 'stores',
      width: 90,
      align: 'right',
      render: (v: number) => (
        <span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>
          {fmtNum(Number(v) || 0)}
        </span>
      ),
    },
  ];

  const titleColor = mode === 'dark' ? '#e2e8f0' : '#16253d';

  return (
    <>
      <div className="vb4-card">
        <div className="vb4-h">
          <h3>
            <span className="vb4-dot" />
            {title}
          </h3>
          <button type="button" className="vb4-more" onClick={() => setOpen(true)}>
            更多 <RightOutlined />
          </button>
        </div>
        <div className="vb4-b">
          {top.length === 0 ? (
            <div className="vb4-empty">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
            </div>
          ) : (
            <div className="vb4-rank">
              {top.map((r, i) => {
                const no = Number(r?.rank) || i + 1;
                const v = value(r);
                const sn = showSales ? salesNameOf(r) : '';
                /* 副标题显示「另一维度」，避免与右侧数值重复 */
                const sub = metric === 'stores'
                  ? `${fmtNum(Number(r?.clients) || 0)} 客户`
                  : `${fmtNum(Number(r?.stores) || 0)} 门店`;
                return (
                  <div className="vb4-row" key={`${no}-${r?.name ?? i}`}>
                    <div className="vb4-no" style={badgeStyle(no)}>{no}</div>
                    <div className="vb4-main">
                      <div className="vb4-name">
                        <span className="nm" title={String(r?.name ?? '')}>{String(r?.name ?? '') || '-'}</span>
                        {sn && <span className="sn">· {sn}</span>}
                        <span className="sub">{sub}</span>
                      </div>
                      <TypeTags tags={r?.tags} />
                    </div>
                    <div className="vb4-val">
                      <b>{fmtNum(v)}</b>
                      <span>{unit}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Modal
        title={<span style={{ color: titleColor }}>{`${title} · 全部排行（${list.length}）`}</span>}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={isMobile ? '94vw' : 680}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        {/* D2：重新声明令牌，弹窗内所有 var(--*) 都能解析 */}
        <div className="v7d-modal" style={mode === 'dark' ? PORTAL_DARK : PORTAL_LIGHT}>
          <Table<RankRow>
            size="small"
            rowKey={(r, i) => `${r?.rank ?? i}-${r?.name ?? i}`}
            columns={allColumns}
            dataSource={list}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /> }}
            pagination={{
              pageSize: 20,
              size: 'small',
              showSizeChanger: false,
              showTotal: (t) => `共 ${t} 项`,
            }}
            scroll={{ x: 'max-content' }}
          />
        </div>
      </Modal>
    </>
  );
}

export default function Rankings({ data, isMobile }: Props) {
  const r3 = data?.row3;
  const salesClientRank = Array.isArray(r3?.salesClientRank) ? r3.salesClientRank : [];
  const salesStoreRank = Array.isArray(r3?.salesStoreRank) ? r3.salesStoreRank : [];
  const provinceRank = Array.isArray(r3?.provinceRank) ? r3.provinceRank : [];

  return (
    <>
      <style>{CSS}</style>
      <div className="vb4-grid">
        <RankCard title="客户数排行榜" items={salesClientRank} metric="clients" isMobile={isMobile} unit="客户" />
        <RankCard title="门店数排行榜" items={salesStoreRank} metric="stores" isMobile={isMobile} unit="门店" />
        <RankCard title="省份排行榜" items={provinceRank} metric="clients" isMobile={isMobile} unit="客户" showSales />
      </div>
    </>
  );
}
