/** 第 8 排：按策略模型 × 策略类型分南北区
 *
 * 数据：data.row8.items（ModelTypeItem[]，每项 { model, type, south: Row7Data, north: Row7Data, total: Row7Data }）
 * 呈现：分组表格
 *  - 行 = (策略模块, 策略类型)，「策略模块」列用 onCell rowSpan 合并同模块的行
 *  - 指标列：开通策略数 / 运行策略数 / 触达人数 / 到店率 / 优惠券核销率 / 转化销售额
 *  - 每个指标单元格内上下两行显示「南 X」「北 Y」，颜色区分南北区，一眼可比
 *
 * 口径见 _work/V5-CONTRACT.md §3.2 第 14 条。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { BoardData, ModelTypeItem, Row7Data } from '@/api/crm-board';
import { fmtMoney, fmtNum, fmtPct } from './theme';

const C_SOUTH = '#45B4FF';
const C_NORTH = '#FFC000';

/** 契约 §7.2：CSS 变量优先；变量未注入时回退 antd v6 主题变量，保证明暗都可读 */
const T_MAIN = 'var(--text-main, var(--ant-color-text, #003378))';
const T_SUB = 'var(--text-sub, var(--ant-color-text-secondary, rgba(0,51,120,.66)))';
const BORDER = 'var(--border, var(--ant-color-border, rgba(54,135,255,.28)))';
const BG_CARD = 'var(--bg-card, var(--ant-color-bg-container, #FFFFFF))';

export interface RunBreakdownProps {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

interface Row {
  key: string;
  model: string;
  type: string;
  south: Row7Data;
  north: Row7Data;
  total: Row7Data;
}

type Fmt = 'num' | 'pct' | 'money';

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmt(v: number, kind: Fmt): string {
  if (kind === 'pct') return fmtPct(v);
  if (kind === 'money') return fmtMoney(v);
  return fmtNum(v);
}

/** 取「该区域自身」的数值：优先 region 字段，为 0/缺失时回退 total
 *
 * 后端 buildRow8 用 aggregateRow7 过滤出该区域的行再聚合：
 * 南区对象里 reachRate.south 有值、.north 恒为 0（反之亦然），
 * 因此 south 行取 .south、north 行取 .north，并用 total 兜底容错。
 */
function own(p: { south?: number; north?: number; total?: number } | null | undefined, region: 'south' | 'north'): number {
  const o = num(p?.[region]);
  if (o !== 0) return o;
  return num(p?.total);
}

/** 空 Row7Data 兜底（后端字段缺失时不崩） */
function safeR7(v?: Partial<Row7Data> | null): Row7Data {
  return {
    openedStrategy: {
      chains: v?.openedStrategy?.chains ?? { south: 0, north: 0, total: 0 },
      strategies: v?.openedStrategy?.strategies ?? { south: 0, north: 0, total: 0 },
    },
    runningStrategy: {
      chains: v?.runningStrategy?.chains ?? { south: 0, north: 0, total: 0 },
      strategies: v?.runningStrategy?.strategies ?? { south: 0, north: 0, total: 0 },
    },
    reachRate: v?.reachRate ?? { south: 0, north: 0, total: 0 },
    couponRate: v?.couponRate ?? { south: 0, north: 0, total: 0 },
    conversion: {
      south: num(v?.conversion?.south),
      north: num(v?.conversion?.north),
      total: num(v?.conversion?.total),
      perCapita: v?.conversion?.perCapita ?? { south: 0, north: 0, total: 0 },
    },
    people: {
      reached: v?.people?.reached ?? { south: 0, north: 0, total: 0 },
      couponIssued: v?.people?.couponIssued ?? { south: 0, north: 0, total: 0 },
    },
  };
}

/** 南北双值单元格 */
function DualCell({ south, north, kind }: { south: number; north: number; kind: Fmt }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.35 }}>
      <span style={{ color: C_SOUTH, fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ fontSize: 10, opacity: 0.85, marginRight: 2 }}>南</span>
        {fmt(south, kind)}
      </span>
      <span style={{ color: C_NORTH, fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ fontSize: 10, opacity: 0.85, marginRight: 2 }}>北</span>
        {fmt(north, kind)}
      </span>
    </div>
  );
}

export default function RunBreakdown({ data, loading, isMobile }: RunBreakdownProps) {
  const items = Array.isArray(data?.row8?.items) ? (data?.row8?.items ?? []) : [];

  const rows = useMemo<Row[]>(() => items.map((it: ModelTypeItem, i) => {
    const model = String(it?.model ?? '') || '未分类';
    const type = String(it?.type ?? '') || '未分类';
    return {
      key: `${model}|${type}|${i}`,
      model,
      type,
      south: safeR7(it?.south),
      north: safeR7(it?.north),
      total: safeR7(it?.total),
    };
  }), [items]);

  /** 分页（自行切片，保证 rowSpan 合并只在当前页内计算，不跨页错位） */
  const pageSize = isMobile ? 5 : 10;
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [rows.length]);

  const pageRows = useMemo(() => {
    const maxPage = Math.max(Math.ceil(rows.length / pageSize), 1);
    const cur = Math.min(page, maxPage);
    return rows.slice((cur - 1) * pageSize, cur * pageSize);
  }, [rows, page, pageSize]);

  /** 当前页内每个 model 的行数与起始下标，用于 rowSpan */
  const spanMap = useMemo(() => {
    const map = new Map<string, { span: number; start: boolean }>();
    const counts = new Map<string, number>();
    pageRows.forEach((r) => counts.set(r.model, (counts.get(r.model) ?? 0) + 1));
    const seen = new Set<string>();
    pageRows.forEach((r) => {
      const first = !seen.has(r.model);
      seen.add(r.model);
      map.set(r.key, { span: first ? (counts.get(r.model) ?? 1) : 0, start: first });
    });
    return map;
  }, [pageRows]);

  const columns = useMemo<ColumnsType<Row>>(() => {
    const metricCol = (
      title: string,
      pick: (r: Row) => { south: number; north: number },
      kind: Fmt,
      width: number,
    ): ColumnsType<Row>[number] => ({
      title,
      key: title,
      width,
      align: 'right',
      render: (_: unknown, r: Row) => {
        const v = pick(r);
        return <DualCell south={num(v.south)} north={num(v.north)} kind={kind} />;
      },
    });

    return [
      {
        title: '策略模块',
        dataIndex: 'model',
        key: 'model',
        width: isMobile ? 88 : 130,
        onCell: (r: Row) => {
          const s = spanMap.get(r.key);
          return { rowSpan: s ? s.span : 1 };
        },
        render: (v: string) => (
          <span style={{ fontSize: 12.5, fontWeight: 600, color: T_MAIN }}>{v}</span>
        ),
      },
      {
        title: '策略类型',
        dataIndex: 'type',
        key: 'type',
        width: isMobile ? 92 : 140,
        render: (v: string) => (
          <span style={{ fontSize: 12, color: T_SUB }}>{v}</span>
        ),
      },
      metricCol('开通策略数', (r) => ({
        south: own(r.south.openedStrategy?.strategies, 'south'),
        north: own(r.north.openedStrategy?.strategies, 'north'),
      }), 'num', 92),
      metricCol('运行策略数', (r) => ({
        south: own(r.south.runningStrategy?.strategies, 'south'),
        north: own(r.north.runningStrategy?.strategies, 'north'),
      }), 'num', 92),
      metricCol('触达人数', (r) => ({
        south: own(r.south.people?.reached, 'south'),
        north: own(r.north.people?.reached, 'north'),
      }), 'num', 92),
      metricCol('到店率', (r) => ({
        south: own(r.south.reachRate, 'south'),
        north: own(r.north.reachRate, 'north'),
      }), 'pct', 88),
      metricCol('优惠券核销率', (r) => ({
        south: own(r.south.couponRate, 'south'),
        north: own(r.north.couponRate, 'north'),
      }), 'pct', 104),
      metricCol('转化销售额', (r) => ({
        south: own(r.south.conversion, 'south'),
        north: own(r.north.conversion, 'north'),
      }), 'money', 112),
    ];
  }, [spanMap, isMobile]);

  const total = rows.length;

  return (
    <Card
      variant="outlined"
      loading={loading && !total}
      style={{ background: BG_CARD, border: `1px solid ${BORDER}`, borderRadius: 12, height: '100%' }}
      styles={{ body: { padding: isMobile ? 12 : 16 } }}
      title={<span style={{ fontSize: 14, fontWeight: 600, color: T_MAIN }}>按策略模型和策略类型分南北区</span>}
      extra={
        <span style={{ fontSize: 12, color: T_SUB }}>
          共 {fmtNum(total)} 组 · <span style={{ color: C_SOUTH }}>南</span> / <span style={{ color: C_NORTH }}>北</span>
        </span>
      }
    >
      {!total ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无策略模型数据" style={{ padding: '48px 0' }} />
      ) : (
        <Table<Row>
          size="small"
          rowKey="key"
          columns={columns}
          dataSource={pageRows}
          bordered
          scroll={{ x: 'max-content', y: 400 }}
          pagination={{
            current: Math.min(page, Math.max(Math.ceil(total / pageSize), 1)),
            pageSize,
            total,
            size: 'small',
            showSizeChanger: false,
            showTotal: (t) => `共 ${t} 组`,
            onChange: (p) => setPage(p),
          }}
        />
      )}
    </Card>
  );
}
