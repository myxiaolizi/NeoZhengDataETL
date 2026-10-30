/** 第 10 排：客户明细表
 *
 *  - 表格标题右侧「列设置」可显示/隐藏列（至少保留 3 列）
 *  - 每页默认 10 条，可选 10 / 20 / 50
 *  - 右下角翻页按钮（antd 分页器默认位置）
 *  - 额外提供 CSV 导出
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Checkbox, Divider, Drawer, Empty, Space, Table, Tag, Tooltip, Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, SettingOutlined } from '@ant-design/icons';
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

/** 单元格渲染 */
function renderCell(row: DetailFullRow, col: DetailColumnConf): React.ReactNode {
  const raw = (row as any)[col.key];

  switch (col.key) {
    case 'seq':
      return <span style={{ color: 'var(--text-sub)' }}>{raw}</span>;
    case 'region': {
      const isSouth = raw === '南区';
      const color = isSouth ? '#45B4FF' : raw === '北区' ? '#FFC000' : '#B5B5B6';
      return (
        <span
          style={{
            display: 'inline-block', padding: '0 7px', borderRadius: 7, fontSize: 11.5,
            border: `1px solid ${color}`, color, lineHeight: '18px', whiteSpace: 'nowrap',
          }}
        >
          {raw || '-'}
        </span>
      );
    }
    case 'chainName':
      return (
        <Tooltip title={raw}>
          <span style={{ color: 'var(--text-main)' }}>{raw || '-'}</span>
        </Tooltip>
      );
    case 'chainType': {
      const isInvalid = raw === '50-';
      const color = isInvalid ? '#B5B5B6' : raw === '全国百强' ? '#3687FF' : raw === '区县百强' ? '#45B4FF' : '#A2D73C';
      return (
        <span
          style={{
            display: 'inline-block', padding: '0 7px', borderRadius: 7, fontSize: 11.5,
            border: `1px solid ${color}`, color, lineHeight: '18px', whiteSpace: 'nowrap',
            opacity: isInvalid ? 0.75 : 1,
          }}
        >
          {raw || '-'}
        </span>
      );
    }
    case 'signType': {
      const isSic = String(raw).includes('SIC');
      const color = isSic ? '#EC673C' : '#3687FF';
      return (
        <span
          style={{
            display: 'inline-block', padding: '0 7px', borderRadius: 7, fontSize: 11.5,
            border: `1px solid ${color}`, color, lineHeight: '18px', whiteSpace: 'nowrap',
          }}
        >
          {raw || '-'}
        </span>
      );
    }
    case 'node':
      if (!raw) {
        return <span style={{ color: 'var(--text-mute)' }}>流程完成</span>;
      }
      return <span style={{ color: 'var(--text-main)' }}>{raw}</span>;
    case 'status': {
      const overdue = raw === '超期';
      return (
        <span style={{ color: overdue ? '#E86161' : '#A2D73C', fontWeight: 600 }}>
          {raw || '-'}
        </span>
      );
    }
    case 'reachRate':
    case 'couponRate':
      return <span style={{ color: 'var(--text-main)' }}>{fmtPct(Number(raw) || 0, 2)}</span>;
    case 'stores':
    case 'submitDays':
    case 'openedStrategies':
    case 'runningStrategies':
    case 'reachedPeople':
    case 'nodeDays':
    case 'totalDays':
      return <span style={{ color: 'var(--text-main)' }}>{fmtNum(Number(raw) || 0)}</span>;
    default:
      return raw === undefined || raw === null || raw === '' ? (
        <span style={{ color: 'var(--text-mute)' }}>-</span>
      ) : (
        <span style={{ color: 'var(--text-main)' }}>{String(raw)}</span>
      );
  }
}

/** 转 CSV 单元格 */
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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

  // 列配置变化（如筛选后列集合变化）时重置
  useEffect(() => { setVisible(defaultVisible); }, [defaultVisible.join('|')]);

  /** 生成 antd Table columns */
  const tableColumns: ColumnsType<DetailFullRow> = useMemo(() => {
    const picked = columns.filter((c) => visible.includes(String(c.key)));
    return picked.map((c) => {
      const isSeq = c.key === 'seq';
      const isName = c.key === 'chainName';
      return {
        title: c.title,
        dataIndex: c.key as string,
        key: String(c.key),
        width: c.width,
        align: c.align,
        fixed: isSeq ? ('left' as const) : undefined,
        ellipsis: isName,
        render: (_: any, row: DetailFullRow) => renderCell(row, c),
      };
    });
  }, [columns, visible]);

  const toggleColumn = (key: string, on: boolean) => {
    setVisible((cur) => {
      if (on) return Array.from(new Set([...cur, key]));
      if (cur.length <= MIN_VISIBLE) return cur;
      return cur.filter((k) => k !== key);
    });
  };

  const resetColumns = () => setVisible(defaultVisible);

  /** 导出 CSV（当前可见列 + 全部行） */
  const exportCsv = () => {
    const picked = columns.filter((c) => visible.includes(String(c.key)));
    const header = picked.map((c) => csvCell(c.title)).join(',');
    const body = rows.map((r) => picked.map((c) => csvCell((r as any)[c.key])).join(','));
    const csv = `\uFEFF${[header, ...body].join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const p = (x: number) => String(x).padStart(2, '0');
    a.href = url;
    a.download = `客户明细_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const canUncheck = visible.length > MIN_VISIBLE;

  return (
    <>
      <Card
        size="small"
        title={
          <Space size={8}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>客户明细</span>
            <span style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--text-mute)' }}>
              共 {rows.length} 条
            </span>
          </Space>
        }
        extra={
          <Space size={6}>
            <Tooltip title="导出当前可见列的全部数据为 CSV">
              <Button size="small" icon={<DownloadOutlined />} onClick={exportCsv} disabled={!rows.length}>
                {isMobile ? null : '导出'}
              </Button>
            </Tooltip>
            <Button
              size="small"
              icon={<SettingOutlined />}
              onClick={() => setDrawerOpen(true)}
            >
              {isMobile ? null : '列设置'}
            </Button>
          </Space>
        }
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: 'var(--shadow)',
        }}
        styles={{
          header: { background: 'transparent', borderBottom: '1px solid var(--border)', minHeight: 42 },
          body: { padding: isMobile ? 8 : 12 },
        }}
      >
        {rows.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选条件下无明细" />
        ) : (
          <Table<DetailFullRow>
            size="middle"
            loading={loading}
            rowKey={(r) => `${r.chainId}-${r.seq}`}
            columns={tableColumns}
            dataSource={rows}
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
      </Card>

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
        <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 10 }}>
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
                <span style={{ color: 'var(--text-main)' }}>
                  {c.title}
                  {c.default !== false && (
                    <span style={{ fontSize: 10, color: 'var(--text-mute)', marginLeft: 6 }}>默认</span>
                  )}
                </span>
              </Checkbox>
            );
          })}
        </Checkbox.Group>
        <Divider style={{ margin: '14px 0' }} />
        <Text style={{ fontSize: 12, color: 'var(--text-mute)' }}>
          提示：列顺序与后端列配置一致；「默认」标记的列会随筛选重置为可见。
        </Text>
      </Drawer>
    </>
  );
}
