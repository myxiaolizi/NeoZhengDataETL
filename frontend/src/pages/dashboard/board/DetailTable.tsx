/** 第 10 排：客户明细表 — V6.0 视觉升级
 *
 * 功能不变：列设置（至少保留 3 列）/ 每页 10·20·50 / 翻页 / CSV 导出。
 * 视觉对齐 pc4.html：
 *   - 卡片 16px 圆角 + 方点标题
 *   - 表头 var(--panel2)、斑马纹、hover var(--brandSoft)
 *   - 超期行左侧 3px var(--danger) 竖条
 *   - 分页器对齐设计系统（圆角 8px、选中渐变 brand）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Checkbox, Divider, Drawer, Empty, Space, Spin, Table, Tooltip, Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SettingOutlined } from '@ant-design/icons';
import { BoardData, DetailColumnConf, DetailFullRow } from '@/api/crm-board';
import { fmtNum, fmtPct } from './theme';

const { Text } = Typography;

/* ══════════════ V7.1：客户详情（需求 J） ══════════════ */

interface ClientTimelineNode {
  name: string;
  doneAt: string;
  doneAtLabel: string;
  done: boolean;
  isCurrent: boolean;
  durationLabel: string;
}

interface ClientDetailData {
  client: Record<string, string | number>;
  progress: Record<string, string | number | boolean>;
  timeline: ClientTimelineNode[];
  run: Record<string, unknown> | null;
  signAtLabel: string;
  submitAtLabel: string;
}

interface Props {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

/** 兜底列配置（后端没给 columns 时用） */
const FALLBACK_COLUMNS: DetailColumnConf[] = [
  { key: 'seq', title: '序号', width: 64, default: true, align: 'center' },
  { key: 'region', title: '区域', width: 80, default: true, align: 'center' },
  { key: 'chainId', title: '连锁ID', width: 100, default: true },
  { key: 'chainName', title: '连锁名称', width: 240, default: true },
  { key: 'chainType', title: '连锁类型', width: 100, default: true, align: 'center' },
  { key: 'signType', title: '签约类型', width: 120, default: true, align: 'center' },
  { key: 'stores', title: '门店数', width: 90, default: true, align: 'right', format: 'num' },
  { key: 'sales', title: '销售', width: 90, default: true },
  { key: 'service', title: '客服', width: 90, default: true },
  { key: 'solution', title: '解决方案', width: 100, default: true },
  { key: 'trainer', title: '培训人', width: 90, default: true },
  { key: 'node', title: '当前节点', width: 110, default: true, align: 'center' },
  { key: 'submitLabel', title: '提交时间', width: 110, default: true, align: 'center' },
  { key: 'submitDays', title: '提交时长（天）', width: 120, default: true, align: 'right', format: 'num' },
  { key: 'openedStrategies', title: '开通策略数', width: 110, default: true, align: 'right', format: 'num' },
  { key: 'runningStrategies', title: '运行策略数', width: 110, default: true, align: 'right', format: 'num' },
  { key: 'reachedPeople', title: '触达人数', width: 100, default: true, align: 'right', format: 'num' },
  { key: 'reachRate', title: '到店率', width: 100, default: true, align: 'right', format: 'percent' },
  { key: 'couponRate', title: '优惠券核销率', width: 120, default: true, align: 'right', format: 'percent' },
];

const MIN_VISIBLE = 3;

/* ══════════════ 局部样式（vb11- 前缀） ══════════════ */
const CSS = `
/* V7.1 需求 J：客户详情 */
.vb11-chain-link:hover{color:var(--brand2)!important;text-decoration:underline}
.vb11-cd section{margin-bottom:18px}
.vb11-cd h4{font-size:12.5px;font-weight:700;color:var(--text);margin:0 0 8px;padding-left:8px;border-left:3px solid var(--brand);line-height:1.2}
.vb11-cd dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 14px;margin:0}
.vb11-cd dl > div{display:flex;gap:8px;font-size:12px;line-height:1.6;min-width:0}
.vb11-cd dt{flex:0 0 68px;color:var(--text3);font-weight:600;white-space:nowrap}
.vb11-cd dd{margin:0;color:var(--text);font-weight:650;min-width:0;overflow-wrap:anywhere}
.vb11-tl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0}
.vb11-tl li{display:grid;grid-template-columns:14px 78px 1fr 62px;align-items:center;gap:8px;font-size:12px;padding:5px 0;position:relative}
.vb11-tl li .dot{width:8px;height:8px;border-radius:50%;background:var(--line);margin:0 auto}
.vb11-tl li.done .dot{background:var(--green)}
.vb11-tl li.cur .dot{background:var(--warn);box-shadow:0 0 0 3px color-mix(in srgb,var(--warn) 22%,transparent)}
.vb11-tl li .nm{font-weight:650;color:var(--text2)}
.vb11-tl li.done .nm{color:var(--text)}
.vb11-tl li.cur .nm{color:var(--warn);font-weight:750}
.vb11-tl li .st{color:var(--text3);font-variant-numeric:tabular-nums}
.vb11-tl li .du{text-align:right;color:var(--text2);font-variant-numeric:tabular-nums;font-weight:650}

.vb11-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease;min-width:0}
.vb11-h{padding:13px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent);flex-wrap:wrap}
.vb11-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb11-dot{width:6px;height:6px;border-radius:2px;background:var(--brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 16%,transparent);flex-shrink:0}
.vb11-hint{font-size:11px;color:var(--text3);font-weight:550;white-space:nowrap;font-variant-numeric:tabular-nums}
.vb11-tools{display:flex;align-items:center;gap:7px;flex-shrink:0}
.vb11-btn{height:30px;padding:0 11px;border-radius:9px;border:1px solid var(--line);background:var(--panel2);color:var(--text2);font-size:12px;font-weight:550;display:inline-flex;align-items:center;gap:6px;cursor:pointer;transition:all .15s;white-space:nowrap;font-family:inherit}
.vb11-btn:hover{border-color:var(--brand3);color:var(--brand)}
.vb11-btn:disabled{opacity:.45;cursor:not-allowed}
.vb11-btn svg{font-size:13px}
/* V7：搜索框（替换原导出按钮位置） */
.vb11-search{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 9px;border-radius:9px;border:1px solid var(--line);background:var(--panel2);color:var(--text3);transition:all .15s;min-width:170px}
.vb11-search:focus-within{border-color:var(--brand3);background:var(--panel);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 12%,transparent)}
.vb11-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--text);font-size:12px;font-family:inherit}
.vb11-search input::placeholder{color:var(--text3)}
.vb11-clear{width:16px;height:16px;border:0;border-radius:50%;background:var(--line);color:var(--text2);font-size:12px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;font-family:inherit}
.vb11-clear:hover{background:var(--danger);color:#fff}
@media(max-width:768px){.vb11-search{min-width:120px}}
.vb11-b{padding:12px 14px 6px;flex:1;min-width:0}

/* 表格：表头 panel2 / 斑马纹 / hover brandSoft / 超期左竖条 */
.board-root .vb11-wrap .ant-table{background:transparent;font-size:12.5px}
.board-root .vb11-wrap .ant-table-thead>tr>th{
  background:var(--panel2)!important;color:var(--text3)!important;
  font-size:11.5px!important;font-weight:650!important;letter-spacing:.2px;
  border-bottom:1px solid var(--line)!important;
  padding:9px 10px!important;white-space:nowrap;
}
.board-root .vb11-wrap .ant-table-thead>tr>th::before{display:none!important}
.board-root .vb11-wrap .ant-table-tbody>tr>td{
  border-bottom:1px solid var(--line2)!important;
  color:var(--text);padding:9px 10px!important;
}
.board-root .vb11-wrap .ant-table-tbody>tr:nth-child(even)>td{
  background:color-mix(in srgb,var(--panel2) 55%,transparent);
}
.board-root .vb11-wrap .ant-table-tbody>tr.ant-table-row:hover>td{
  background:var(--brandSoft)!important;
}
.board-root .vb11-wrap .ant-table-tbody>tr>td.ant-table-cell-fix-left,
.board-root .vb11-wrap .ant-table-thead>tr>th.ant-table-cell-fix-left{
  background:var(--panel)!important;
}
.board-root .vb11-wrap .ant-table-tbody>tr:nth-child(even)>td.ant-table-cell-fix-left{
  background:color-mix(in srgb,var(--panel2) 55%,var(--panel))!important;
}
/* 超期行：左侧 3px danger 竖条 + 淡红底 */
.board-root .vb11-wrap .ant-table-tbody>tr.board-row-overdue>td:first-child{
  box-shadow:inset 3px 0 0 var(--danger)!important;
}
.board-root .vb11-wrap .ant-table-tbody>tr.board-row-overdue>td{
  background:color-mix(in srgb,var(--danger) 7%,transparent)!important;
}
.board-root .vb11-wrap .ant-table-tbody>tr.board-row-overdue:hover>td{
  background:color-mix(in srgb,var(--danger) 12%,transparent)!important;
}
.board-root .vb11-wrap .ant-table-cell-scrollbar{background:var(--panel2)!important;box-shadow:none!important}
.board-root .vb11-wrap .ant-empty-description{color:var(--text3)}

/* 分页器对齐设计系统 */
.board-root .vb11-wrap .ant-pagination{margin:12px 0 6px!important;align-items:center}
.board-root .vb11-wrap .ant-pagination .ant-pagination-item,
.board-root .vb11-wrap .ant-pagination .ant-pagination-prev .ant-pagination-item-link,
.board-root .vb11-wrap .ant-pagination .ant-pagination-next .ant-pagination-item-link{
  border-radius:8px!important;border:1px solid var(--line)!important;
  background:var(--panel2)!important;transition:all .15s;
}
.board-root .vb11-wrap .ant-pagination .ant-pagination-item a,
.board-root .vb11-wrap .ant-pagination .ant-pagination-prev button,
.board-root .vb11-wrap .ant-pagination .ant-pagination-next button{
  color:var(--text2)!important;font-size:12.5px!important;font-weight:550;
}
.board-root .vb11-wrap .ant-pagination .ant-pagination-item:hover,
.board-root .vb11-wrap .ant-pagination .ant-pagination-prev:hover .ant-pagination-item-link,
.board-root .vb11-wrap .ant-pagination .ant-pagination-next:hover .ant-pagination-item-link{
  border-color:var(--brand3)!important;
}
.board-root .vb11-wrap .ant-pagination .ant-pagination-item:hover a{color:var(--brand)!important}
.board-root .vb11-wrap .ant-pagination .ant-pagination-item-active{
  background:linear-gradient(135deg,var(--brand),var(--brand2))!important;
  border-color:transparent!important;
  box-shadow:0 3px 9px color-mix(in srgb,var(--brand) 28%,transparent);
}
.board-root .vb11-wrap .ant-pagination .ant-pagination-item-active a{color:#fff!important;font-weight:700}
.board-root .vb11-wrap .ant-pagination .ant-pagination-total-text,
.board-root .vb11-wrap .ant-pagination .ant-pagination-options{color:var(--text3)!important;font-size:12px}
.board-root .vb11-wrap .ant-pagination .ant-select-selector{
  border-radius:8px!important;border-color:var(--line)!important;background:var(--panel2)!important;
}
.board-root .vb11-wrap .ant-pagination .ant-pagination-options-quick-jumper input{
  border-radius:8px!important;border-color:var(--line)!important;background:var(--panel2)!important;color:var(--text)!important;
}

/* 列设置抽屉内标签 */
.vb11-drawer-tip{font-size:12px;color:var(--text2);margin-bottom:10px}
`;

/** 单元格渲染 */
function renderCell(
  row: DetailFullRow,
  col: DetailColumnConf,
  onClientClick?: (chainId: string, chainName: string) => void,
): React.ReactNode {
  const raw = (row as any)[col.key];

  switch (col.key) {
    case 'seq':
      return <span style={{ color: 'var(--text3)', fontVariantNumeric: 'tabular-nums' }}>{raw}</span>;
    case 'region': {
      const isSouth = raw === '南区';
      const isNorth = raw === '北区';
      const color = isSouth ? 'var(--brand)' : isNorth ? 'var(--cyan)' : 'var(--text3)';
      return (
        <span
          style={{
            display: 'inline-block', padding: '0 7px', borderRadius: 6, fontSize: 11,
            border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
            background: `color-mix(in srgb, ${color} 12%, transparent)`,
            color, lineHeight: '18px', whiteSpace: 'nowrap', fontWeight: 600,
          }}
        >
          {raw || '-'}
        </span>
      );
    }
    case 'chainName': {
      /* V7.1 需求 J：客户名称可点击，打开完整详情 */
      const cid = String((row as unknown as Record<string, unknown>).chainId ?? '');
      return (
        <Tooltip title={onClientClick ? '点击查看该客户完整详情' : raw}>
          <span
            role={onClientClick ? 'button' : undefined}
            tabIndex={onClientClick ? 0 : undefined}
            className={onClientClick ? 'vb11-chain-link' : undefined}
            style={{
              color: onClientClick ? 'var(--brand)' : 'var(--text)',
              fontWeight: 600,
              cursor: onClientClick ? 'pointer' : 'default',
            }}
            onClick={(e) => { e.stopPropagation(); if (onClientClick) onClientClick(cid, String(raw || '')); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && onClientClick) onClientClick(cid, String(raw || '')); }}
          >
            {raw || '-'}
          </span>
        </Tooltip>
      );
    }
    case 'chainType': {
      const isInvalid = raw === '50-';
      const color = isInvalid
        ? 'var(--text3)'
        : raw === '全国百强'
          ? 'var(--brand)'
          : raw === '区县百强'
            ? 'var(--cyan)'
            : 'var(--green)';
      return (
        <span
          style={{
            display: 'inline-block', padding: '0 7px', borderRadius: 6, fontSize: 11,
            border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
            background: `color-mix(in srgb, ${color} 10%, transparent)`,
            color, lineHeight: '18px', whiteSpace: 'nowrap', fontWeight: 600,
            opacity: isInvalid ? 0.7 : 1,
          }}
        >
          {raw || '-'}
        </span>
      );
    }
    case 'signType': {
      const isSic = String(raw).includes('SIC');
      const color = isSic ? 'var(--purple)' : 'var(--brand)';
      return (
        <span
          style={{
            display: 'inline-block', padding: '0 7px', borderRadius: 6, fontSize: 11,
            border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
            background: `color-mix(in srgb, ${color} 10%, transparent)`,
            color, lineHeight: '18px', whiteSpace: 'nowrap', fontWeight: 600,
          }}
        >
          {raw || '-'}
        </span>
      );
    }
    case 'node':
      if (!raw) {
        return <span style={{ color: 'var(--green)', fontWeight: 600 }}>流程完成</span>;
      }
      return <span style={{ color: 'var(--text)' }}>{raw}</span>;
    case 'status': {
      const overdue = raw === '超期';
      return (
        <span style={{ color: overdue ? 'var(--danger)' : 'var(--green)', fontWeight: 700 }}>
          {raw || '-'}
        </span>
      );
    }
    case 'reachRate':
    case 'couponRate':
      return (
        <span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {fmtPct(Number(raw) || 0, 2)}
        </span>
      );
    case 'stores':
    case 'submitDays':
    case 'openedStrategies':
    case 'runningStrategies':
    case 'reachedPeople':
    case 'nodeDays':
    case 'totalDays':
      return (
        <span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {fmtNum(Number(raw) || 0)}
        </span>
      );
    default:
      return raw === undefined || raw === null || raw === '' ? (
        <span style={{ color: 'var(--text3)' }}>-</span>
      ) : (
        <span style={{ color: 'var(--text)' }}>{String(raw)}</span>
      );
  }
}

export default function DetailTable({ data, loading, isMobile }: Props) {
  const columns: DetailColumnConf[] = useMemo(() => {
    const list = data?.detail?.columns;
    return Array.isArray(list) && list.length ? list : FALLBACK_COLUMNS;
  }, [data?.detail?.columns]);

  const rows: DetailFullRow[] = useMemo(
    () => (Array.isArray(data?.detail?.rows) ? data.detail.rows : []),
    [data?.detail?.rows],
  );

  /** 默认可见列 */
  const defaultVisible = useMemo(
    () => columns.filter((c) => c.default !== false).map((c) => String(c.key)),
    [columns],
  );

  const [visible, setVisible] = useState<string[]>(defaultVisible);
  const [drawerOpen, setDrawerOpen] = useState(false);

  /* V7.1 需求 J：客户详情抽屉 */
  const [clientOpen, setClientOpen] = useState(false);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientErr, setClientErr] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientData, setClientData] = useState<ClientDetailData | null>(null);

  const openClient = useCallback(async (chainId: string, chainName: string) => {
    if (!chainId) return;
    setClientOpen(true);
    setClientName(chainName);
    setClientLoading(true);
    setClientErr('');
    setClientData(null);
    try {
      const res = await fetch(`/api/crm/board/client/${encodeURIComponent(chainId)}`, {
        credentials: 'same-origin',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.message || `加载失败（HTTP ${res.status}）`);
      setClientData(json.data as ClientDetailData);
    } catch (e) {
      setClientErr(e instanceof Error ? e.message : '客户详情加载失败');
    } finally {
      setClientLoading(false);
    }
  }, []);
  /** V7：搜索框（连锁ID 或 连锁名称） */
  const [search, setSearch] = useState('');

  // 列配置变化（如筛选后列集合变化）时重置
  useEffect(() => { setVisible(defaultVisible); }, [defaultVisible.join('|')]);

  /** V7：搜索过滤（连锁ID / 连锁名称，包含匹配、忽略大小写） */
  const searched = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter((r) => {
      const id = String((r as unknown as Record<string, unknown>).chainId ?? '').toLowerCase();
      const name = String((r as unknown as Record<string, unknown>).chainName ?? '').toLowerCase();
      return id.includes(kw) || name.includes(kw);
    });
  }, [rows, search]);

  /** 该列所有去重取值（用于列筛选下拉） */
  const distinctOf = useMemo(() => {
    const cache = new Map<string, { text: string; value: string }[]>();
    return (key: string) => {
      if (cache.has(key)) return cache.get(key)!;
      const set = new Set<string>();
      searched.forEach((r) => {
        const v = (r as unknown as Record<string, unknown>)[key];
        if (v === null || v === undefined || v === '') return;
        set.add(String(v));
      });
      const list = Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'))
        .slice(0, 200)
        .map((v) => ({ text: v, value: v }));
      cache.set(key, list);
      return list;
    };
  }, [searched]);

  /** 生成 antd Table columns（V7：每列都带 filters + sorter） */
  const tableColumns: ColumnsType<DetailFullRow> = useMemo(() => {
    const picked = columns.filter((c) => visible.includes(String(c.key)));
    const NUMERIC = new Set([
      'seq', 'stores', 'submitDays', 'openedStrategies', 'runningStrategies',
      'reachedPeople', 'reachRate', 'couponRate', 'nodeDays', 'totalDays',
      'currentNodeHours',
    ]);
    return picked.map((c) => {
      const key = String(c.key);
      const isSeq = key === 'seq';
      const isName = key === 'chainName';
      const isNum = NUMERIC.has(key);
      // 「当前节点处理时长」是字符串（如 "8.7天"），排序用小时数
      const sortKey = key === 'currentNodeDuration' ? 'currentNodeHours' : key;
      return {
        title: c.title,
        dataIndex: key,
        key,
        width: c.width,
        align: c.align,
        fixed: isSeq ? ('left' as const) : undefined,
        ellipsis: isName,
        /* V7：列筛选（多选该列所有值） */
        filters: distinctOf(key),
        filterSearch: distinctOf(key).length > 10,
        onFilter: (value: boolean | React.Key, row: DetailFullRow) => {
          const v = (row as unknown as Record<string, unknown>)[key];
          // 空值归到「(空)」便于筛选
          const cell = v === null || v === undefined || v === '' ? '(空)' : String(v);
          return cell === String(value);
        },
        /* V7：列排序 */
        sorter: (a: DetailFullRow, b: DetailFullRow) => {
          const av = (a as unknown as Record<string, unknown>)[sortKey];
          const bv = (b as unknown as Record<string, unknown>)[sortKey];
          if (isNum) return (Number(av) || 0) - (Number(bv) || 0);
          return String(av ?? '').localeCompare(String(bv ?? ''), 'zh-CN');
        },
        sortDirections: ['descend', 'ascend'] as const,
        showSorterTooltip: { title: `点击按「${c.title}」排序` },
        render: (_: unknown, row: DetailFullRow) => renderCell(row, c, openClient),
      };
    });
  }, [columns, visible, distinctOf, openClient]);

  const toggleColumn = (key: string, on: boolean) => {
    setVisible((cur) => {
      if (on) return Array.from(new Set([...cur, key]));
      if (cur.length <= MIN_VISIBLE) return cur;
      return cur.filter((k) => k !== key);
    });
  };

  const resetColumns = () => setVisible(defaultVisible);

  const canUncheck = visible.length > MIN_VISIBLE;

  return (
    <>
      <style>{CSS}</style>

      <div className="vb11-card">
        <div className="vb11-h">
          <h3>
            <span className="vb11-dot" />
            客户明细
            <span className="vb11-hint">
              共 {fmtNum(searched.length)} 条
              {search ? `（已从 ${fmtNum(rows.length)} 条中筛选）` : ''}
            </span>
          </h3>
          <div className="vb11-tools">
            {/* V7：搜索框替换原导出按钮 */}
            <div className="vb11-search">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isMobile ? '搜索连锁' : '搜索连锁ID或名称'}
                aria-label="搜索连锁ID或名称"
              />
              {search && (
                <button type="button" className="vb11-clear" onClick={() => setSearch('')} aria-label="清空搜索">
                  ×
                </button>
              )}
            </div>
            <button type="button" className="vb11-btn" onClick={() => setDrawerOpen(true)}>
              <SettingOutlined />
              {isMobile ? null : '列设置'}
            </button>
          </div>
        </div>
        <div className="vb11-b vb11-wrap">
          {rows.length === 0 ? (
            <div style={{ padding: '28px 0' }}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选条件下无明细" />
            </div>
          ) : (
            <Table<DetailFullRow>
              size="middle"
              loading={loading}
              rowKey={(r) => `${r.chainId}-${r.seq}`}
              columns={tableColumns}
              dataSource={searched}
              bordered={false}
              scroll={{ x: 'max-content' }}
              rowClassName={(r) => (r.status === '超期' ? 'board-row-overdue' : '')}
              pagination={{
                defaultPageSize: 10,
                pageSizeOptions: ['10', '20', '50'],
                showSizeChanger: true,
                showQuickJumper: true,
                position: ['bottomRight'],
                showTotal: (t, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${t} 条`,
                size: 'small',
              }}
            />
          )}
        </div>
      </div>

      {/* 列设置 */}
      <Drawer
        title="列设置"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={isMobile ? '100%' : 340}
        extra={
          <Space>
            <Button size="small" onClick={() => setVisible(columns.map((c) => String(c.key)))}>全选</Button>
            <Button size="small" type="primary" onClick={resetColumns}>重置默认</Button>
          </Space>
        }
      >
        <div className="vb11-drawer-tip">
          已显示 {visible.length} / {columns.length} 列（至少保留 {MIN_VISIBLE} 列）
        </div>
        <Checkbox.Group
          value={visible}
          style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}
        >
          {columns.map((c) => {
            const key = String(c.key);
            const on = visible.includes(key);
            return (
              <Checkbox
                key={key}
                value={key}
                checked={on}
                disabled={on && !canUncheck}
                onChange={(e) => toggleColumn(key, e.target.checked)}
                style={{ marginLeft: 0 }}
              >
                <span style={{ color: 'var(--text)' }}>
                  {c.title}
                  {c.default !== false && (
                    <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 6 }}>默认</span>
                  )}
                </span>
              </Checkbox>
            );
          })}
        </Checkbox.Group>
        <Divider style={{ margin: '14px 0' }} />
        <Text style={{ fontSize: 12, color: 'var(--text3)' }}>
          提示：列顺序与后端列配置一致；「默认」标记的列会随筛选重置为可见。
        </Text>
      </Drawer>
    
      {/* V7.1 需求 J：客户详情抽屉 */}
      <Drawer
        title={clientName ? `${clientName} · 客户详情` : '客户详情'}
        placement="right"
        width={isMobile ? '100%' : 720}
        open={clientOpen}
        onClose={() => setClientOpen(false)}
        styles={{ body: { padding: 16 } }}
      >
        {clientLoading ? (
          <div style={{ padding: 60, textAlign: 'center' }}><Spin /></div>
        ) : clientErr ? (
          <Alert type="error" showIcon message="客户详情加载失败" description={clientErr} />
        ) : !clientData ? (
          <Empty description="暂无详情" />
        ) : (
          <div className="vb11-cd">
            {/* 基本信息 */}
            <section>
              <h4>基本信息</h4>
              <dl>
                <div><dt>连锁ID</dt><dd>{String(clientData.client.chainId ?? '-')}</dd></div>
                <div><dt>连锁名称</dt><dd>{String(clientData.client.chainName ?? '-')}</dd></div>
                <div><dt>连锁类型</dt><dd>{String(clientData.client.chainType ?? '-')}</dd></div>
                <div><dt>区域 / 省份</dt><dd>{String(clientData.client.region ?? '-')} / {String(clientData.client.province ?? '-')}</dd></div>
                <div><dt>门店数</dt><dd>{fmtNum(Number(clientData.client.stores) || 0)}</dd></div>
                <div><dt>签约类型</dt><dd>{String(clientData.client.signType ?? '-')}</dd></div>
                <div><dt>销售</dt><dd>{String(clientData.client.sales ?? '-')}</dd></div>
                <div><dt>客服</dt><dd>{String(clientData.client.service ?? '-')}</dd></div>
                <div><dt>解决方案</dt><dd>{String(clientData.client.solution ?? '-')}</dd></div>
                <div><dt>培训人</dt><dd>{String(clientData.client.trainer ?? '-')}</dd></div>
              </dl>
            </section>

            {/* 流程进度 */}
            <section>
              <h4>流程进度</h4>
              <dl>
                <div><dt>当前节点</dt><dd>{String(clientData.progress.node ?? '-')}</dd></div>
                <div><dt>当前处理人</dt><dd>{String(clientData.progress.owner ?? '-')}</dd></div>
                <div><dt>节点时长</dt><dd>{String(clientData.progress.currentNodeDuration ?? '-')}</dd></div>
                <div><dt>状态</dt>
                  <dd style={{ color: clientData.progress.isOverdue ? 'var(--danger)' : 'var(--green)', fontWeight: 700 }}>
                    {clientData.progress.isOverdue
                      ? `已超期 ${String(clientData.progress.overdueDays ?? 0)} 个工作日（阈值 ${String(clientData.progress.overdueThreshold ?? '-')}）`
                      : '正常'}
                  </dd>
                </div>
                <div><dt>上节点完成</dt><dd>{String(clientData.progress.prevDoneAtLabel || '-')}</dd></div>
                <div><dt>提交 / 签约</dt><dd>{clientData.submitAtLabel || '-'} / {clientData.signAtLabel || '-'}</dd></div>
              </dl>
            </section>

            {/* 节点时间线 */}
            <section>
              <h4>节点时间线</h4>
              <ol className="vb11-tl">
                {(clientData.timeline || []).map((t, i2) => (
                  <li key={`${t.name}-${i2}`} className={t.isCurrent ? 'cur' : t.done ? 'done' : 'todo'}>
                    <span className="dot" />
                    <span className="nm">{t.name}</span>
                    <span className="st">
                      {t.done ? t.doneAtLabel : t.isCurrent ? '进行中' : '未开始'}
                    </span>
                    <span className="du">{t.durationLabel || ''}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </Drawer>
    </>
  );
}
