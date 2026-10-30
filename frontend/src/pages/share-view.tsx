/**
 * 公开分享查看页（路由 /s/:token，无需登录，移动端优先）
 *
 * 数据来源：GET /api/public/shares/:token（后端只读接口，自动累加访问次数）
 *   不存在 / 已停用 → 404，已过期 → 410
 *   成功 → { share:{...}, targetType, targetName, payload:{ report, rows, columns } }
 *
 * 支持：链接失效提示、图表 + 明细表、移动端单列
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Grid, Result, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import { BarChartOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import Chart from '@/components/Chart';
import { fmtNum, fmtTime } from '@/utils';
import {
  buildChartOption,
  fetchPublicShare,
  pickTableColumns,
  type DatasetColumn,
  type PublicShareResult,
  type ReportConfig,
  type RowData,
} from '@/api/reports';

const { useBreakpoint } = Grid;
const { Title, Paragraph, Text } = Typography;

/** 页面骨架（公开页不套 BasicLayout） */
function Shell({ children, title }: { children: React.ReactNode; title?: string }) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  return (
    <div style={{ minHeight: '100vh', background: '#FFFFFF' }}>
      <div
        style={{
          background: 'linear-gradient(135deg, #003378 0%, #2D6FE4 60%, #3687FF 100%)',
          color: '#FFFFFF',
          padding: isMobile ? '16px 14px' : '20px 28px',
        }}
      >
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              flex: '0 0 34px',
              borderRadius: 10,
              background: 'rgba(255,255,255,.18)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
            }}
          >
            <BarChartOutlined />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 700, lineHeight: 1.3, wordBreak: 'break-word' }}>
              {title || '数据报表分享'}
            </div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.72)' }}>数据报表 · 公开分享</div>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: isMobile ? 12 : 24 }}>{children}</div>
      <div style={{ textAlign: 'center', padding: '16px 12px 28px', fontSize: 11.5, color: '#B5B5B6' }}>
        本页面由数据平台自动生成 · 内容归数据所有者所有
      </div>
    </div>
  );
}

export default function ShareView() {
  const { token } = useParams<{ token: string }>();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [data, setData] = useState<PublicShareResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) {
      setError('分享链接无效');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const r = await fetchPublicShare(token);
      setData(r);
      if (!r.ok) setError(r.message || '分享链接不可用');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const rows: RowData[] = useMemo(() => data?.rows || [], [data]);
  const columns: DatasetColumn[] = useMemo(() => data?.columns || [], [data]);
  const report = data?.report;
  const config: ReportConfig = useMemo(() => (report?.config || {}) as ReportConfig, [report]);
  const built = useMemo(() => buildChartOption(rows, config, { limit: 60 }), [rows, config]);

  const tableColumns = useMemo(() => {
    if (!rows.length) return [];
    return pickTableColumns(rows, columns, isMobile ? 6 : 14).map((c) => ({
      title: c,
      dataIndex: c,
      key: c,
      ellipsis: true,
      width: 140,
      render: (v: unknown) => {
        if (v === null || v === undefined) return <span style={{ color: '#B5B5B6' }}>-</span>;
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return <span title={s}>{s}</span>;
      },
    }));
  }, [rows, columns, isMobile]);

  /* 错误页（过期 / 停用 / 不存在 / 不支持的类型） */
  if (!loading && (!data?.ok || error)) {
    return (
      <Shell title="无法访问">
        <Result
          status="warning"
          title="无法访问该分享"
          subTitle={error || data?.message || '分享链接不存在或已失效'}
          extra={
            <Button icon={<ReloadOutlined />} onClick={load}>
              重新加载
            </Button>
          }
          style={{ paddingTop: isMobile ? 24 : 48 }}
        />
      </Shell>
    );
  }

  if (loading && !data?.ok) {
    return (
      <Shell title="正在加载">
        <div style={{ padding: 80, textAlign: 'center' }}>
          <Spin size="large" />
        </div>
      </Shell>
    );
  }

  const title = data?.title || report?.name || '数据报表';
  const total = data?.rowCount ?? rows.length;

  return (
    <Shell title={title}>
      {/* 概览条 */}
      <Card
        styles={{ body: { padding: isMobile ? 12 : 16 } }}
        style={{ border: '1px solid #DCDDDD', borderRadius: 12, marginBottom: 12 }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            gap: 12,
            justifyContent: 'space-between',
            alignItems: isMobile ? 'stretch' : 'center',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <Title level={5} style={{ margin: 0, color: '#003378', fontSize: isMobile ? 16 : 18 }}>
              {config.title || title}
            </Title>
            <div style={{ fontSize: 12, color: 'rgba(0,51,120,.55)', marginTop: 4 }}>
              共 {fmtNum(total)} 行数据 · {columns.length} 个字段
              {report?.updatedAt ? ` · 更新于 ${fmtTime(report.updatedAt, 'YYYY-MM-DD HH:mm')}` : ''}
            </div>
          </div>
          <Space size={6} wrap>
            <Tag bordered={false} color="#3687FF" style={{ color: '#FFFFFF' }}>
              <EyeOutlined /> 公开分享
            </Tag>
            {config.chartType && (
              <Tag bordered={false} style={{ background: 'rgba(54,135,255,.1)', color: '#2D6FE4' }}>
                {config.chartType}
              </Tag>
            )}
            <Button size="small" icon={<ReloadOutlined />} onClick={load} loading={loading}>
              刷新
            </Button>
          </Space>
        </div>
      </Card>

      {/* 图表 */}
      <Card
        styles={{ body: { padding: isMobile ? 8 : 14 } }}
        style={{ border: '1px solid #DCDDDD', borderRadius: 12, marginBottom: 12 }}
      >
        {built.kind === 'table' ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="表格数据见下方明细" />
        ) : built.kind === 'number' ? (
          <div style={{ padding: isMobile ? '20px 8px' : '36px 8px', textAlign: 'center' }}>
            <Statistic
              title={<span style={{ color: 'rgba(0,51,120,.6)' }}>{built.metric?.label}</span>}
              value={built.metric?.value}
              formatter={(v) => fmtNum(Number(v))}
              valueStyle={{ color: '#2D6FE4', fontWeight: 700, fontSize: isMobile ? 32 : 44 }}
            />
          </div>
        ) : (
          <Chart
            option={built.option}
            height={isMobile ? 260 : Math.max(320, Math.min(Number(config.height) || 400, 520))}
            loading={loading}
            empty={built.isEmpty || !rows.length}
            emptyText="暂无数据"
          />
        )}
      </Card>

      {/* 明细表 */}
      <Card
        title={<span style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>数据明细</span>}
        extra={<span style={{ fontSize: 12, color: 'rgba(0,51,120,.55)' }}>共 {fmtNum(total)} 行</span>}
        styles={{ body: { padding: 8 } }}
        style={{ border: '1px solid #DCDDDD', borderRadius: 12 }}
      >
        {rows.length ? (
          <Table
            size="small"
            rowKey={(_, i) => String(i)}
            dataSource={rows.slice(0, 500)}
            columns={tableColumns}
            pagination={{ pageSize: isMobile ? 10 : 20, size: 'small', showSizeChanger: false }}
            scroll={{ x: 'max-content' }}
            bordered
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无明细数据" />
        )}
      </Card>

      <Paragraph style={{ marginTop: 14, marginBottom: 0, fontSize: 11.5, color: '#B5B5B6', textAlign: 'center' }}>
        <Text type="secondary" style={{ fontSize: 11.5 }}>
          若内容涉及敏感数据，请联系分享者停用该链接
        </Text>
      </Paragraph>
    </Shell>
  );
}
