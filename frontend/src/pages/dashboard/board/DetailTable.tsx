/** 第 10 排：客户明细表 — V6.0 视觉升级
 *
 * 功能不变：列设置（至少保留 3 列）/ 每页 10·20·50 / 翻页 / CSV 导出。
 * 视觉对齐 pc4.html：
 *   - 卡片 16px 圆角 + 方点标题
 *   - 表头 var(--panel2)、斑马纹、hover var(--brandSoft)
 *   - 超期行左侧 3px var(--danger) 竖条
 *   - 分页器对齐设计系统（圆角 8px、选中渐变 brand）
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Checkbox, Divider, Drawer, Empty, Space, Table, Tooltip, Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SettingOutlined } from '@ant-design/icons';
import { BoardData, DetailColumnConf, DetailFullRow } from '@/api/crm-board';
import { fmtNum, fmtPct } from './theme';

const { Text } = Typography;

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
function renderCell(row: DetailFullRow, col: DetailColumnConf): React.ReactNode {
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
    case 'chainName':
      return (
        <Tooltip title={raw}>
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>{raw || '-'}</span>
        </Tooltip>
      );
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
        render: (_: unknown, row: DetailFullRow) => renderCell(row, c),
      };
    });
  }, [columns, visible, distinctOf]);

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
    </>
  );
}
