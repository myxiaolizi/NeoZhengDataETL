/**
 * 统一数据明细表（V6.1）
 *
 * 用户要求（逐条对应）：
 *  7. 「数据明细要支持设置显示/隐藏列和列排序的功能，**入口在表格标题最后方**」
 *  8. 「数据明细的搜索组件**在标题栏**，设置列按钮的前方；**不需要单独 1 列**」
 *  9. 「数据明细要支持**筛选**功能」
 * 10. 「邮箱推送和数据项目的数据明细，**格式和功能要一致**」
 *
 * 因此本组件是全站「数据明细」的唯一实现，被
 *   - pages/projects/Detail.tsx  的「数据明细」页签
 *   - pages/mail-push/Project.tsx 的「数据明细」页签
 * 共用，两侧只通过 props 传不同的取数回调，保证格式与功能完全一致。
 *
 * ── 标题栏布局（单行，不占额外行/列）───────────────────────────
 *  ┌──────────────────────────────────────────────────────────────────┐
 *  │ 数据明细  共 681 行        [导出] [搜索框] [筛选] [列设置]        │
 *  └──────────────────────────────────────────────────────────────────┘
 *     ↑ 标题+计数              ↑extra  ↑搜索在列设置前方  ↑入口最后方
 *
 * ── 列设置弹层 ─────────────────────────────────────────────────
 *  · 勾选 = 显示/隐藏（至少保留 1 列）
 *  · ↑ ↓  = 调整列顺序
 *  · 重置 = 恢复默认
 *  · 选择结果按 `storageKey` 持久化到 localStorage，下次进页面自动恢复
 *
 * ── 筛选 ───────────────────────────────────────────────────────
 *  「筛选」按钮上的徽标为已生效条件数；展开后每列可选操作符
 *  （包含 / 等于 / 不等于 / 为空 / 不为空），逐条 AND 生效。
 *  由父组件把 filters 传到后端，与搜索、排序、分页一起走服务端。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Badge, Button, Empty, Grid, Input, Popover, Select, Space, Table, Tooltip, Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  ArrowDownOutlined, ArrowUpOutlined, CheckOutlined, FilterOutlined,
  HolderOutlined, ReloadOutlined, SearchOutlined, SettingOutlined,
} from '@ant-design/icons';
import { NEUTRAL, PALETTE } from '@/theme';

const { Text } = Typography;
const { useBreakpoint } = Grid;

/* ══════════ 类型 ══════════ */

/** 列定义（两个业务模块的列结构略有差异，这里做最小公约数） */
export interface DataColumn {
  /** 物理列名，用于排序 / 筛选 / dataIndex */
  name: string;
  /** 显示名（中文名优先，缺省用物理名） */
  label?: string;
  /** 备注，作为 title 提示 */
  comment?: string;
  /** 列类型（用于筛选操作符推断） */
  type?: string;
  /**
   * 是否可排序，默认 true。
   * 合成列（如后端拼出来的 display_id）必须设 false —— 服务端排序白名单
   * 只认真实物理列，传合成列会被丢弃，表现为「点了排序没反应」。
   */
  sortable?: boolean;
  /**
   * 是否可作为筛选目标，默认 true。
   * 同样地，合成列必须设 false，否则筛选条件会被服务端白名单静默丢弃。
   */
  filterable?: boolean;
}

/** 筛选操作符 */
export type FilterOp = 'contains' | 'eq' | 'ne' | 'empty' | 'notempty';

export interface FilterItem {
  column: string;
  op: FilterOp;
  value?: string;
}

const OP_LABEL: Record<FilterOp, string> = {
  contains: '包含',
  eq: '等于',
  ne: '不等于',
  empty: '为空',
  notempty: '不为空',
};

/** 无需值的操作符 */
const VALUELESS_OPS: FilterOp[] = ['empty', 'notempty'];

export interface SortState {
  column: string;
  order: 'asc' | 'desc';
}

export interface DataTableProps<T> {
  /** 表格左上角标题，默认「数据明细」 */
  title?: React.ReactNode;
  /** 总行数（服务端返回） */
  total?: number;
  rows: T[];
  columns: DataColumn[];
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  rowKey: (row: T, index?: number) => string;

  /* ---- 搜索（标题栏内，列设置前方） ---- */
  searchPlaceholder?: string;
  keywordInput: string;
  onKeywordInputChange: (v: string) => void;
  onSearch: () => void;
  onResetSearch?: () => void;

  /* ---- 排序（服务端） ---- */
  sort: SortState | null;
  onSortChange: (s: SortState | null) => void;

  /* ---- 筛选（服务端） ---- */
  filters: FilterItem[];
  onFiltersChange: (f: FilterItem[]) => void;

  /* ---- 分页 ---- */
  page: number;
  pageSize: number;
  onPageChange: (page: number, pageSize: number) => void;
  pageSizeOptions?: number[];

  /** 标题栏最右侧、列设置之后的额外按钮（如导出 CSV） */
  extra?: React.ReactNode;
  /** 列设置持久化 key，不同表必须不同 */
  storageKey: string;
  /** 空状态文案 */
  emptyText?: React.ReactNode;
  /** 单元格自定义渲染 */
  renderCell?: (row: T, col: DataColumn) => React.ReactNode;
  /** 横向滚动宽度，默认 max-content */
  scrollX?: number | string;
}

/* ══════════ 列设置持久化 ══════════ */

interface ColPref {
  order: string[];
  hidden: string[];
}

function loadPref(key: string): ColPref | null {
  try {
    const raw = localStorage.getItem('v61.colpref.' + key);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!Array.isArray(p.order) || !Array.isArray(p.hidden)) return null;
    return { order: p.order, hidden: p.hidden };
  } catch {
    return null;
  }
}

function savePref(key: string, pref: ColPref) {
  try {
    localStorage.setItem('v61.colpref.' + key, JSON.stringify(pref));
  } catch {
    /* 隐私模式 / 配额满：忽略，不影响功能 */
  }
}

/** 按偏好排序：已知列按 order，未知（新增）列追加到末尾 */
function applyOrder(all: DataColumn[], order: string[]): DataColumn[] {
  const byName = new Map(all.map((c) => [c.name, c]));
  const out: DataColumn[] = [];
  order.forEach((n) => {
    const c = byName.get(n);
    if (c) { out.push(c); byName.delete(n); }
  });
  byName.forEach((c) => out.push(c));
  return out;
}

/* ══════════ 组件 ══════════ */

export default function DataTable<T>(props: DataTableProps<T>) {
  const {
    title = '数据明细',
    total = 0,
    rows,
    columns,
    loading,
    error,
    onRetry,
    rowKey,
    searchPlaceholder = '搜索数据',
    keywordInput,
    onKeywordInputChange,
    onSearch,
    onResetSearch,
    sort,
    onSortChange,
    filters,
    onFiltersChange,
    page,
    pageSize,
    onPageChange,
    pageSizeOptions = [10, 20, 50, 100],
    extra,
    storageKey,
    emptyText,
    renderCell,
    scrollX = 'max-content',
  } = props;

  const screens = useBreakpoint();
  const isMobile = !screens.md;

  /* ---- 列偏好：顺序 + 隐藏 ---- */
  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  /** 首帧不写回 localStorage，避免把默认值当用户偏好存下来 */
  const prefLoaded = useRef(false);

  // 列集合变化 / storageKey 变化时载入偏好
  useEffect(() => {
    const p = loadPref(storageKey);
    const allNames = columns.map((c) => c.name);
    if (p) {
      setOrder(applyOrder(columns, p.order).map((c) => c.name));
      // 只保留仍然存在的列的隐藏标记
      setHidden(p.hidden.filter((n) => allNames.includes(n)));
    } else {
      setOrder(allNames);
      setHidden([]);
    }
    prefLoaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, columns.map((c) => c.name).join('|')]);

  // 持久化
  useEffect(() => {
    if (!prefLoaded.current) return;
    savePref(storageKey, { order, hidden });
  }, [storageKey, order, hidden]);

  /** 有序 + 可见列 */
  const orderedColumns = useMemo(() => {
    const base = order.length ? applyOrder(columns, order) : columns;
    return base;
  }, [columns, order]);

  const visibleColumns = useMemo(
    () => orderedColumns.filter((c) => !hidden.includes(c.name)),
    [orderedColumns, hidden]
  );

  /* ---- 表头：排序交给服务端 ---- */
  const tableColumns: TableColumnsType<T> = useMemo(
    () => visibleColumns.map((c) => ({
      title: (
        <Tooltip title={c.comment && c.comment !== c.label ? `${c.label || c.name} · ${c.comment}` : undefined}>
          <span style={{ whiteSpace: 'nowrap' }}>{c.label || c.comment || c.name}</span>
        </Tooltip>
      ),
      dataIndex: c.name,
      key: c.name,
      width: 160,
      ellipsis: true,
      sorter: c.sortable !== false,
      sortOrder: sort && sort.column === c.name
        ? (sort.order === 'asc' ? 'ascend' : 'descend')
        : null,
      render: (v: unknown, row: T) => {
        if (renderCell) {
          const custom = renderCell(row, c);
          if (custom !== undefined) return custom;
        }
        if (v === null || v === undefined || v === '') return <Text type="secondary">-</Text>;
        const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return (
          <Tooltip title={text.length > 40 ? text : undefined}>
            <span style={{ fontSize: 12 }}>{text.length > 60 ? text.slice(0, 60) + '…' : text}</span>
          </Tooltip>
        );
      },
    })),
    [visibleColumns, sort, renderCell]
  );

  /** 表头排序变化 → 服务端排序（三态：升/降/取消） */
  const handleTableChange = useCallback(
    (_pg: unknown, _filters: unknown, sorter: any) => {
      const s = Array.isArray(sorter) ? sorter[0] : sorter;
      const field = s && s.field ? String(s.field) : '';
      if (!field || !s.order) {
        if (sort) onSortChange(null);
        return;
      }
      const nextOrder = s.order === 'ascend' ? 'asc' : 'desc';
      if (sort && sort.column === field && sort.order === nextOrder) return;
      onSortChange({ column: field, order: nextOrder });
    },
    [onSortChange, sort]
  );

  /* ---- 列设置：显隐 ---- */
  const toggleColumn = (name: string) => {
    setHidden((prev) => {
      const isHidden = prev.includes(name);
      if (isHidden) return prev.filter((n) => n !== name);
      // 至少保留 1 列
      if (orderedColumns.length - prev.length <= 1) return prev;
      return [...prev, name];
    });
  };

  /* ---- 列设置：顺序 ---- */
  const moveColumn = (name: string, dir: -1 | 1) => {
    setOrder((prev) => {
      const base = prev.length ? prev.slice() : orderedColumns.map((c) => c.name);
      const i = base.indexOf(name);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= base.length) return base;
      [base[i], base[j]] = [base[j], base[i]];
      return base;
    });
  };

  const resetColumns = () => {
    setOrder(columns.map((c) => c.name));
    setHidden([]);
  };

  /* ---- 筛选（草稿态） ----
   *
   * 筛选面板有明确的「应用筛选」按钮，所以编辑过程必须只落在草稿上：
   *  - 每敲一个字就提交给父组件，会导致「每输入一个字符发一次请求」，
   *    而且「应用筛选」按钮变得毫无意义（旧实现就是这个毛病）；
   *  - 现在 add/update/remove 只改 draftFilters，点「应用筛选」才 commit，
   *    点「清空」直接提交空数组。
   */
  const [draftFilters, setDraftFilters] = useState<FilterItem[]>(filters);

  // 外部（父组件）重置 filters 时，草稿同步跟随
  useEffect(() => {
    setDraftFilters(filters);
  }, [filters]);

  const activeFilterCount = filters.filter(
    (f) => VALUELESS_OPS.includes(f.op) || String(f.value || '').trim() !== ''
  ).length;

  /** 可作为筛选目标的列（排除合成列） */
  const filterableColumns = useMemo(
    () => orderedColumns.filter((c) => c.filterable !== false),
    [orderedColumns]
  );

  const addFilter = () => {
    const first = filterableColumns[0];
    if (!first) return;
    setDraftFilters((prev) => [...prev, { column: first.name, op: 'contains', value: '' }]);
  };

  const updateFilter = (idx: number, patch: Partial<FilterItem>) => {
    setDraftFilters((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  const removeFilter = (idx: number) => {
    setDraftFilters((prev) => prev.filter((_, i) => i !== idx));
  };

  /** 草稿提交：把有效条件交给父组件去查服务端 */
  const applyFilters = () => {
    onFiltersChange(draftFilters);
    setFilterOpen(false);
    onSearch();
  };

  /** 清空：立刻提交空条件 */
  const clearFilters = () => {
    setDraftFilters([]);
    onFiltersChange([]);
    onSearch();
  };

  /* ---- 列设置弹层 ---- */
  const settingsPanel = (
    <div style={{ width: isMobile ? 268 : 300 }} data-testid="data-table-column-settings">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text strong style={{ fontSize: 13 }}>显示列 / 列顺序</Text>
        <Button size="small" type="link" onClick={resetColumns}>重置</Button>
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 2 }}>
        {orderedColumns.map((c, i) => {
          const shown = !hidden.includes(c.name);
          const isFirst = i === 0;
          const isLast = i === orderedColumns.length - 1;
          return (
            <div
              key={c.name}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 2px', borderRadius: 6,
                background: shown ? 'transparent' : NEUTRAL.surfaceAlt,
              }}
            >
              <HolderOutlined style={{ color: NEUTRAL.textQuaternary, fontSize: 11 }} />
              <button
                type="button"
                onClick={() => toggleColumn(c.name)}
                aria-label={`切换列 ${c.label || c.name}`}
                aria-pressed={shown}
                style={{
                  flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6,
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  textAlign: 'left', padding: 0,
                }}
              >
                <span
                  style={{
                    width: 15, height: 15, borderRadius: 3, flex: '0 0 15px',
                    border: `1px solid ${shown ? PALETTE.primary : NEUTRAL.borderStrong}`,
                    background: shown ? PALETTE.primary : 'transparent',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {shown ? <CheckOutlined style={{ fontSize: 9, color: '#fff' }} /> : null}
                </span>
                <span
                  style={{
                    fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    color: shown ? NEUTRAL.text : NEUTRAL.textQuaternary,
                  }}
                  title={c.comment || c.label || c.name}
                >
                  {c.label || c.comment || c.name}
                </span>
              </button>
              <Tooltip title="上移">
                <Button
                  size="small"
                  type="text"
                  disabled={isFirst}
                  icon={<ArrowUpOutlined style={{ fontSize: 10 }} />}
                  onClick={() => moveColumn(c.name, -1)}
                  aria-label={`上移 ${c.label || c.name}`}
                />
              </Tooltip>
              <Tooltip title="下移">
                <Button
                  size="small"
                  type="text"
                  disabled={isLast}
                  icon={<ArrowDownOutlined style={{ fontSize: 10 }} />}
                  onClick={() => moveColumn(c.name, 1)}
                  aria-label={`下移 ${c.label || c.name}`}
                />
              </Tooltip>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${NEUTRAL.borderSubtle}` }}>
        <Text type="secondary" style={{ fontSize: 11.5 }}>
          已显示 {visibleColumns.length} / {orderedColumns.length} 列
        </Text>
      </div>
    </div>
  );

  /* ---- 筛选弹层 ---- */
  const filterPanel = (
    <div style={{ width: isMobile ? 300 : 380 }} data-testid="data-table-filter">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text strong style={{ fontSize: 13 }}>筛选条件</Text>
        {filters.length || draftFilters.length ? (
          <Button size="small" type="link" onClick={clearFilters}>清空</Button>
        ) : null}
      </div>

      {draftFilters.length === 0 ? (
        <div style={{ padding: '10px 0', color: NEUTRAL.textTertiary, fontSize: 12.5 }}>
          还没有筛选条件，点下面「添加条件」。
        </div>
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {draftFilters.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Select
                size="small"
                value={f.column}
                onChange={(v) => updateFilter(i, { column: v })}
                options={filterableColumns.map((c) => ({ label: c.label || c.comment || c.name, value: c.name }))}
                style={{ width: isMobile ? 96 : 116 }}
                showSearch
                optionFilterProp="label"
              />
              <Select
                size="small"
                value={f.op}
                onChange={(v: FilterOp) => updateFilter(i, { op: v, value: VALUELESS_OPS.includes(v) ? '' : f.value })}
                options={(Object.keys(OP_LABEL) as FilterOp[]).map((k) => ({ label: OP_LABEL[k], value: k }))}
                style={{ width: 84 }}
              />
              <Input
                size="small"
                value={f.value || ''}
                disabled={VALUELESS_OPS.includes(f.op)}
                placeholder={VALUELESS_OPS.includes(f.op) ? '无需输入' : '筛选值'}
                onChange={(e) => updateFilter(i, { value: e.target.value })}
                onPressEnter={applyFilters}
                style={{ flex: 1, minWidth: 60 }}
              />
              <Button size="small" type="text" danger onClick={() => removeFilter(i)} aria-label="删除条件">
                删
              </Button>
            </div>
          ))}
        </Space>
      )}

      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <Button size="small" onClick={addFilter}>添加条件</Button>
        <Button size="small" type="primary" onClick={applyFilters}>
          应用筛选
        </Button>
      </div>
      <div style={{ marginTop: 6 }}>
        <Text type="secondary" style={{ fontSize: 11.5 }}>多个条件之间为「同时满足」</Text>
      </div>
    </div>
  );

  /* ---- 标题栏：标题+计数 ………… [extra] [搜索] [筛选] [列设置] ---- */
  const tableTitle = (
    <div
      className="v61-dt-titlebar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: isMobile ? 'wrap' : 'nowrap',
        width: '100%',
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600, color: NEUTRAL.text, flexShrink: 0 }}>{title}</span>
      <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>共 {total.toLocaleString('en-US')} 行</Text>

      {/* 把右侧工具推到最右 */}
      <div style={{ flex: 1, minWidth: 0 }} />

      {extra ? <Space size={6} style={{ flexShrink: 0 }}>{extra}</Space> : null}

      {/* 搜索：在列设置按钮前方 */}
      <Input
        allowClear
        size="small"
        className="v61-dt-search"
        prefix={<SearchOutlined style={{ color: NEUTRAL.textQuaternary }} />}
        placeholder={searchPlaceholder}
        value={keywordInput}
        onChange={(e) => onKeywordInputChange(e.target.value)}
        onPressEnter={onSearch}
        onClear={() => { if (onResetSearch) onResetSearch(); else onSearch(); }}
        style={{ width: isMobile ? '100%' : 220, flexShrink: 0 }}
      />

      <Popover
        open={filterOpen}
        onOpenChange={setFilterOpen}
        trigger="click"
        placement="bottomRight"
        content={filterPanel}
        destroyOnHidden={false}
      >
        <Badge count={activeFilterCount} size="small" offset={[-2, 2]}>
          <Tooltip title="筛选">
            <Button
              size="small"
              className="v61-dt-filter"
              icon={<FilterOutlined />}
              onClick={() => setFilterOpen((v) => !v)}
              aria-label="筛选"
            />
          </Tooltip>
        </Badge>
      </Popover>

      {/* 列设置：标题栏最后方 */}
      <Popover
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        trigger="click"
        placement="bottomRight"
        content={settingsPanel}
        destroyOnHidden={false}
      >
        <Tooltip title="显示列 / 列顺序">
          <Button
            size="small"
            className="v61-dt-cols"
            icon={<SettingOutlined />}
            onClick={() => setSettingsOpen((v) => !v)}
            aria-label="显示列与列顺序"
          />
        </Tooltip>
      </Popover>
    </div>
  );

  if (error) {
    return (
      <div>
        {tableTitle}
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 10 }}
          title="数据加载失败"
          description={error}
          action={onRetry ? (
            <Button size="small" onClick={onRetry}>重试</Button>
          ) : null}
        />
      </div>
    );
  }

  return (
    <div>
      {tableTitle}
      <Table<T>
        style={{ marginTop: 10 }}
        rowKey={rowKey}
        size="small"
        loading={loading}
        columns={tableColumns}
        dataSource={rows}
        scroll={{ x: scrollX }}
        onChange={handleTableChange}
        locale={{
          emptyText: emptyText || <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />,
        }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions,
          showTotal: (t) => `共 ${t.toLocaleString('en-US')} 行`,
          onChange: onPageChange,
          style: { marginBottom: 0 },
        }}
      />
    </div>
  );
}

/** 便捷方法：把 FilterItem[] 序列化成后端 query 参数 */
export function filtersToQuery(filters: FilterItem[]): string {
  const valid = filters.filter(
    (f) => VALUELESS_OPS.includes(f.op) || String(f.value || '').trim() !== ''
  );
  if (!valid.length) return '';
  return JSON.stringify(valid.map((f) => ({
    column: f.column,
    op: f.op,
    value: VALUELESS_OPS.includes(f.op) ? '' : String(f.value || '').trim(),
  })));
}

/** 便捷方法：给「刷新/重置」恢复默认视图用 */
export function resetFilterHelpers() {
  return { filters: [] as FilterItem[] };
}
