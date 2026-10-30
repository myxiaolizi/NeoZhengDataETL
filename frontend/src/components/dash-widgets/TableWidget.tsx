/**
 * 明细表（table）：分页明细表
 * 列来源：widget.columns（设计器可配）→ 否则自动挑列（pickTableColumns）
 */
import React, { useMemo } from 'react';
import { Table } from 'antd';
import { EmptyBox, chartNum, colNamesOf, nf, toStr } from './shared';
import type { WidgetProps } from './shared';

export default function TableWidget({ widget, rows, columns, isMobile }: WidgetProps) {
  const pageSize = chartNum(widget, 'pageSize', 10);
  const maxHeight = widget.height && widget.height > 140 ? Math.max(140, widget.height - 58) : isMobile ? 260 : 320;

  const colDefs = useMemo(() => {
    const names = colNamesOf(rows, columns);
    const configured = (widget.columns || []).filter((c) => c && c.key && names.includes(c.key));
    if (configured.length) return configured.map((c) => ({ key: c.key, title: c.title || c.key, width: c.width }));
    const picked = names.filter((n) => !/raw_json|_json$/i.test(n)).slice(0, isMobile ? 5 : 10);
    return (picked.length ? picked : names.slice(0, 8)).map((n) => ({ key: n, title: n, width: undefined as number | undefined }));
  }, [rows, columns, widget.columns, isMobile]);

  const antdColumns = useMemo(
    () =>
      colDefs.map((c) => ({
        title: c.title,
        dataIndex: c.key,
        key: c.key,
        width: c.width || 130,
        ellipsis: true,
        align: 'left' as const,
        render: (v: unknown) => {
          if (v === null || v === undefined || v === '') return <span style={{ color: 'var(--text3, #93a7c2)' }}>-</span>;
          if (typeof v === 'number') return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{nf(v, Number.isInteger(v) ? 0 : 2)}</span>;
          if (typeof v === 'object') return <span title={toStr(v)}>{toStr(v).slice(0, 40)}</span>;
          return <span title={String(v)}>{String(v)}</span>;
        },
      })),
    [colDefs]
  );

  if (!rows.length) return <EmptyBox text="暂无明细数据" height={maxHeight} />;
  if (!antdColumns.length) return <EmptyBox text="没有可展示的列" height={maxHeight} />;

  return (
    <Table
      size="small"
      rowKey={(_r, i) => String(i)}
      dataSource={rows}
      columns={antdColumns}
      pagination={{ pageSize, size: 'small', showSizeChanger: false, showTotal: (t) => `共 ${t} 行` }}
      scroll={{ x: 'max-content', y: maxHeight }}
      bordered
      style={{ fontSize: 12 }}
    />
  );
}
