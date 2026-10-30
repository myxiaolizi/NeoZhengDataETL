/** 第 6 排右：流程推进（最近 5 个工作日）
 *
 * 呈现：
 *  - 热力矩阵（HTML table）：行 = 9 个流程节点，列 = 最近 5 个工作日
 *    单元格背景按值映射到主色梯度 rgba(54,135,255, alpha)，alpha = v/max*0.85 + 0.06
 *    0 值单元格用浅灰 rgba(181,181,182,.12)
 *  - 底部 3 个 Statistic：有开通策略的客户数（合计 / 南区 / 北区）
 *
 * 数据：data.row6.flowProgress（days / nodes / matrix[nodeIdx][dayIdx]）、data.row6.strategyClients
 * 口径见 _work/V5-CONTRACT.md §四 第 6 排。
 */
import React, { useMemo } from 'react';
import { Card, Empty, Statistic } from 'antd';
import type { BoardData } from '@/api/crm-board';

const C_SOUTH = '#45B4FF';
const C_NORTH = '#FFC000';
const C_MAIN = '#3687FF';
const C_GRAY = 'rgba(181,181,182,.12)';

/** 契约 §7.2：CSS 变量优先；变量未注入时回退 antd v6 主题变量，保证明暗都可读 */
const T_MAIN = 'var(--text-main, var(--ant-color-text, #003378))';
const T_SUB = 'var(--text-sub, var(--ant-color-text-secondary, rgba(0,51,120,.66)))';
const BORDER = 'var(--border, var(--ant-color-border, rgba(54,135,255,.28)))';

export interface FlowProgressProps {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 热力色：v=0 → 浅灰；否则主色 alpha 梯度 */
function heatBg(v: number, max: number): string {
  if (!v || v <= 0) return C_GRAY;
  const ratio = max > 0 ? v / max : 0;
  const alpha = Math.min(ratio * 0.85 + 0.06, 0.95);
  return `rgba(54,135,255,${alpha.toFixed(3)})`;
}

/** 单元格文字色：背景够深时用白色 */
function heatFg(v: number, max: number): string {
  if (!v || v <= 0) return T_SUB;
  const ratio = max > 0 ? v / max : 0;
  const alpha = Math.min(ratio * 0.85 + 0.06, 0.95);
  return alpha >= 0.5 ? '#FFFFFF' : T_MAIN;
}

export default function FlowProgress({ data, loading, isMobile }: FlowProgressProps) {
  const fp = data?.row6?.flowProgress;
  const days = Array.isArray(fp?.days) ? (fp?.days ?? []) : [];
  const nodes = Array.isArray(fp?.nodes) ? (fp?.nodes ?? []) : [];
  const matrix = Array.isArray(fp?.matrix) ? (fp?.matrix ?? []) : [];
  const sc = data?.row6?.strategyClients;

  const { grid, max, rowTotals, colTotals } = useMemo(() => {
    const rows: number[][] = nodes.map((_, ri) => {
      const src = Array.isArray(matrix[ri]) ? (matrix[ri] as unknown[]) : [];
      return days.map((__, ci) => num(src[ci]));
    });
    let mx = 0;
    const rowT = rows.map((r) => {
      const s = r.reduce((a, b) => a + b, 0);
      return s;
    });
    const colT = days.map((__, ci) => rows.reduce((a, r) => a + num(r[ci]), 0));
    rows.forEach((r) => r.forEach((v) => { if (v > mx) mx = v; }));
    return { grid: rows, max: mx, rowTotals: rowT, colTotals: colT };
  }, [days, nodes, matrix]);

  // 只要有节点/日期就画矩阵（全 0 时就是一片浅灰，比 Empty 更如实）
  const hasData = days.length > 0 && nodes.length > 0;

  const cellStyle: React.CSSProperties = {
    padding: isMobile ? '5px 2px' : '6px 4px',
    textAlign: 'center',
    fontSize: isMobile ? 11 : 12,
    fontWeight: 600,
    border: `1px solid ${BORDER}`,
    borderRadius: 4,
    transition: 'background .2s',
  };

  const headStyle: React.CSSProperties = {
    padding: isMobile ? '4px 2px' : '4px 6px',
    textAlign: 'center',
    fontSize: isMobile ? 10.5 : 12,
    fontWeight: 500,
    color: T_SUB,
    whiteSpace: 'nowrap',
  };

  const nodeStyle: React.CSSProperties = {
    padding: isMobile ? '5px 4px' : '6px 8px',
    fontSize: isMobile ? 11 : 12.5,
    color: T_MAIN,
    whiteSpace: 'nowrap',
    maxWidth: isMobile ? 62 : 92,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  const stats = [
    { title: '有开通策略客户数', value: sc?.total ?? 0, color: T_MAIN },
    { title: '南区', value: sc?.south ?? 0, color: C_SOUTH },
    { title: '北区', value: sc?.north ?? 0, color: C_NORTH },
  ];

  return (
    <Card
      variant="outlined"
      loading={loading && !nodes.length}
      style={{ background: 'var(--bg-card, var(--ant-color-bg-container, #FFFFFF))', border: `1px solid ${BORDER}`, borderRadius: 12, height: '100%' }}
      styles={{ body: { padding: isMobile ? 12 : 16 } }}
      title={<span style={{ fontSize: 14, fontWeight: 600, color: T_MAIN }}>流程推进</span>}
      extra={<span style={{ fontSize: 12, color: T_SUB }}>最近 5 个工作日</span>}
    >
      {!hasData ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无流程推进数据" style={{ padding: '40px 0' }} />
      ) : (
        <div style={{ width: '100%', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 3, tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th style={{ ...headStyle, textAlign: 'left', paddingLeft: 0 }}>节点</th>
                {days.map((d) => (
                  <th key={d} style={headStyle}>{d}</th>
                ))}
                <th style={{ ...headStyle, color: C_MAIN }}>合计</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node, ri) => (
                <tr key={node}>
                  <td style={nodeStyle} title={node}>{node}</td>
                  {days.map((d, ci) => {
                    const v = num(grid[ri]?.[ci]);
                    return (
                      <td
                        key={`${node}-${d}`}
                        style={{
                          ...cellStyle,
                          background: heatBg(v, max),
                          color: heatFg(v, max),
                        }}
                      >
                        {v || 0}
                      </td>
                    );
                  })}
                  <td style={{ ...cellStyle, background: 'transparent', color: C_MAIN }}>{rowTotals[ri] || 0}</td>
                </tr>
              ))}
              <tr>
                <td style={{ ...nodeStyle, color: T_SUB, fontSize: isMobile ? 10.5 : 12 }}>当日合计</td>
                {colTotals.map((v, ci) => (
                  <td
                    key={`sum-${ci}`}
                    style={{ ...cellStyle, background: 'transparent', color: C_MAIN, borderStyle: 'dashed' }}
                  >
                    {v || 0}
                  </td>
                ))}
                <td style={{ ...cellStyle, background: 'transparent', color: C_MAIN }}>
                  {colTotals.reduce((a, b) => a + b, 0)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(3, 1fr)',
          gap: 8,
          marginTop: 12,
          paddingTop: 12,
          borderTop: `1px solid ${BORDER}`,
        }}
      >
        {stats.map((s) => (
          <div key={s.title} style={{ minWidth: 0, textAlign: 'center' }}>
            <Statistic
              title={<span style={{ fontSize: isMobile ? 11 : 12, color: T_SUB }}>{s.title}</span>}
              value={num(s.value)}
              valueStyle={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, color: s.color, lineHeight: 1.3 }}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}
