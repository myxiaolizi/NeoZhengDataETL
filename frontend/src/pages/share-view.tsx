/**
 * 公开分享查看页（路由 /s/:token，无需登录，移动端优先）
 *
 * 数据来源：
 *   - 报表分享：GET /api/public/shares/:token
 *   - 看板分享（V7）：GET /api/public/board?token=…（同样走 share 校验，支持密码）
 *
 * 支持：链接失效提示、图表 + 明细表、看板整页渲染、移动端单列
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Grid, Input, Result, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import { BarChartOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import Chart from '@/components/Chart';
import SigningCards from '@/pages/dashboard/board/SigningCards';
import FlowPipeline from '@/pages/dashboard/board/FlowPipeline';
import TypeSummary from '@/pages/dashboard/board/TypeSummary';
import Rankings from '@/pages/dashboard/board/Rankings';
import ComparePanel from '@/pages/dashboard/board/ComparePanel';
import SignTrend from '@/pages/dashboard/board/SignTrend';
import FlowProgress from '@/pages/dashboard/board/FlowProgress';
import RunMetrics from '@/pages/dashboard/board/RunMetrics';
import RunBreakdown from '@/pages/dashboard/board/RunBreakdown';
import RunTrend from '@/pages/dashboard/board/RunTrend';
import DetailTable from '@/pages/dashboard/board/DetailTable';
import { REGION_COLORS, CHAIN_TYPE_COLORS, type BoardData } from '@/api/crm-board';
import { NEUTRAL, PALETTE, SIDER } from '@/theme';
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
    <div style={{ minHeight: '100vh', background: NEUTRAL.pageBg }}>
      <div
        style={{
          background: `linear-gradient(135deg, ${SIDER.bgTo} 0%, ${PALETTE.primaryDeep} 60%, ${PALETTE.primary} 100%)`,
          color: NEUTRAL.textInverse,
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
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.78)' }}>数据报表 · 公开分享</div>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: isMobile ? 12 : 24 }}>{children}</div>
      <div style={{ textAlign: 'center', padding: '16px 12px 28px', fontSize: 11.5, color: NEUTRAL.textTertiary }}>
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

  /** V7：从 URL 读取访问密码（?pwd=xxx），分享链接可带密码直达 */
  const urlPwd = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('pwd') || '';
  }, []);

  /* V7.1：手动输入密码（原实现只支持 ?pwd= 直达，访客没有任何输入入口） */
  const [pwdInput, setPwdInput] = useState('');
  const [pwdErr, setPwdErr] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  /** 用户提交成功后生效的密码（优先于 URL 参数） */
  const [manualPwd, setManualPwd] = useState('');

  /** 实际用于请求的密码：手输优先，其次 URL 里的 ?pwd */
  const activePwd = manualPwd || urlPwd;

  const load = useCallback(async () => {
    if (!token) {
      setError('分享链接无效');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const r = await fetchPublicShare(token, activePwd || undefined);
      setData(r);
      if (!r.ok) setError(r.message || '分享链接不可用');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [token, activePwd]);

  /** V7.1：提交手输密码 → 重新校验并拉取 */
  const submitPwd = useCallback(async () => {
    const v = pwdInput.trim();
    if (!v) {
      setPwdErr('请输入密码');
      return;
    }
    setPwdLoading(true);
    setPwdErr('');
    try {
      const r = await fetchPublicShare(token || '', v);
      if (r.ok) {
        setManualPwd(v);
        setData(r);
        setError('');
      } else {
        setPwdErr(r.message || '密码不正确，请重试');
      }
    } catch (e) {
      setPwdErr(e instanceof Error ? e.message : '密码校验失败，请重试');
    } finally {
      setPwdLoading(false);
    }
  }, [pwdInput, token]);

  useEffect(() => {
    load();
  }, [load]);

  const rows: RowData[] = useMemo(() => data?.rows || [], [data]);
  const columns: DatasetColumn[] = useMemo(() => data?.columns || [], [data]);
  const report = data?.report;
  const config: ReportConfig = useMemo(() => (report?.config || {}) as ReportConfig, [report]);
  const built = useMemo(() => buildChartOption(rows, config, { limit: 60 }), [rows, config]);

  /* ── V7：看板类型分享 → 渲染完整看板 ── */
  const isBoardShare = (data as { targetType?: string } | null)?.targetType === 'board';
  const [boardData, setBoardData] = useState<BoardData | null>(null);
  const [boardErr, setBoardErr] = useState('');

  useEffect(() => {
    if (!isBoardShare) return undefined;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/public/board?token=${encodeURIComponent(token || '')}${activePwd ? `&pwd=${encodeURIComponent(activePwd)}` : ''}`, {
          credentials: 'same-origin',
        });
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok || j.ok === false) throw new Error(j.message || `加载失败（HTTP ${r.status}）`);
        setBoardData(j.data as BoardData);
      } catch (e) {
        if (alive) setBoardErr(e instanceof Error ? e.message : '看板数据加载失败');
      }
    })();
    return () => { alive = false; };
  }, [isBoardShare, token, activePwd]);

  const tableColumns = useMemo(() => {
    if (!rows.length) return [];
    return pickTableColumns(rows, columns, isMobile ? 6 : 14).map((c) => ({
      title: c,
      dataIndex: c,
      key: c,
      ellipsis: true,
      width: 140,
      render: (v: unknown) => {
        if (v === null || v === undefined) return <span style={{ color: NEUTRAL.textQuaternary }}>-</span>;
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return <span title={s}>{s}</span>;
      },
    }));
  }, [rows, columns, isMobile]);

  /* 错误页（过期 / 停用 / 不存在 / 不支持的类型） */
  if (!loading && (!data?.ok || error)) {
    /* V7.1：需要密码时，给出输入框（而不是只说「密码不正确」） */
    const needPwd = data?.code === 'password' || /密码/.test(error || data?.message || '');
    if (needPwd) {
      return (
        <Shell title="需要访问密码">
          <Card
            style={{
              maxWidth: 420, margin: isMobile ? '32px auto' : '72px auto',
              borderRadius: 16, border: `1px solid ${NEUTRAL.border}`,
            }}
            styles={{ body: { padding: isMobile ? 20 : 28 } }}
          >
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 12 }}>🔒</div>
              <Title level={4} style={{ margin: 0, marginBottom: 6 }}>该分享已设置访问密码</Title>
              <Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }}>
                请输入分享者提供的密码后查看内容
              </Paragraph>
            </div>
            <Input.Password
              value={pwdInput}
              onChange={(e) => setPwdInput(e.target.value)}
              onPressEnter={submitPwd}
              placeholder="请输入访问密码"
              size="large"
              autoFocus
              style={{ marginBottom: 12 }}
            />
            {pwdErr && (
              <div style={{ color: PALETTE.red, fontSize: 13, marginBottom: 10 }}>{pwdErr}</div>
            )}
            <Button
              type="primary"
              size="large"
              block
              loading={pwdLoading}
              onClick={submitPwd}
            >
              查看内容
            </Button>
          </Card>
        </Shell>
      );
    }
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

  /* ── V7：看板分享 —— 整页渲染看板 ── */
  if (isBoardShare) {
    /* 注入 V7 设计令牌（公开页不套 BasicLayout，没有 .board-root 变量） */
    const boardVars = {
      '--bg': '#f2f6fc', '--panel': '#ffffff', '--panel2': '#f7faff',
      '--line': '#dde8f6', '--line2': '#eaf2fb',
      '--text': '#16253d', '--text2': '#5a7191', '--text3': '#93a7c2',
      '--brand': '#2563eb', '--brand2': '#3b82f6', '--brand3': '#60a5fa', '--brandSoft': '#e9f2ff',
      '--green': '#10b981', '--warn': '#f59e0b', '--danger': '#ef4444',
      '--cyan': '#06b6d4', '--purple': '#8b5cf6',
      '--radius': '16px', '--radius-sm': '11px',
      '--bg-page': '#f2f6fc', '--bg-card': '#ffffff', '--bg-card-2': '#f7faff',
      '--text-main': '#16253d', '--text-sub': '#5a7191', '--text-mute': '#93a7c2',
      '--border': '#dde8f6', '--border-strong': '#60a5fa',
    } as React.CSSProperties;

    return (
      <div className="board-root" style={{ ...boardVars, background: 'var(--bg)', minHeight: '100vh', padding: isMobile ? 12 : 20 }}>
        <div style={{ maxWidth: 1680, margin: '0 auto' }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: isMobile ? 17 : 21, fontWeight: 700, color: 'var(--text)' }}>
              {data?.targetName || '中康智能体客户看板'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>
              共享看板 · 只读视图
              {boardData?.meta?.syncedAt ? ` · 数据同步 ${fmtTime(boardData.meta.syncedAt)}` : ''}
            </div>
          </div>

          {boardErr ? (
            <Card style={{ borderRadius: 16 }}>
              <Result
                status="warning"
                title="看板数据加载失败"
                subTitle={boardErr}
                extra={<Button icon={<ReloadOutlined />} onClick={() => window.location.reload()}>重新加载</Button>}
              />
            </Card>
          ) : !boardData ? (
            <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>
          ) : (
            <>
              <div style={{ marginTop: 14 }}>
                <SigningCards data={boardData} loading={false} isMobile={isMobile} />
              </div>
              <div style={{ marginTop: 14 }}>
                <FlowPipeline data={boardData} loading={false} isMobile={isMobile} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1fr) minmax(0,2fr)', gap: 12, marginTop: 14 }}>
                <TypeSummary data={boardData} loading={false} isMobile={isMobile} />
                <Rankings data={boardData} loading={false} isMobile={isMobile} />
              </div>
              {boardData.compare && (
                <div style={{ marginTop: 14 }}>
                  <ComparePanel data={boardData} loading={false} isMobile={isMobile} />
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1.45fr) minmax(0,1fr)', gap: 12, marginTop: 14 }}>
                <SignTrend data={boardData} loading={false} isMobile={isMobile} />
                <FlowProgress data={boardData} loading={false} isMobile={isMobile} />
              </div>
              <div style={{ marginTop: 14 }}>
                <RunMetrics data={boardData} loading={false} isMobile={isMobile} />
              </div>
              <div style={{ marginTop: 14 }}>
                <RunBreakdown data={boardData} loading={false} isMobile={isMobile} />
              </div>
              <div style={{ marginTop: 14 }}>
                <RunTrend data={boardData} loading={false} isMobile={isMobile} />
              </div>
              <div style={{ marginTop: 14 }}>
                <DetailTable data={boardData} loading={false} isMobile={isMobile} />
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const title = data?.title || report?.name || '数据报表';
  const total = data?.rowCount ?? rows.length;

  return (
    <Shell title={title}>
      {/* 概览条 */}
      <Card
        styles={{ body: { padding: isMobile ? 12 : 16 } }}
        style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12, marginBottom: 12 }}
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
            <Title level={5} style={{ margin: 0, color: NEUTRAL.text, fontSize: isMobile ? 16 : 18 }}>
              {config.title || title}
            </Title>
            <div style={{ fontSize: 12, color: NEUTRAL.textSecondary, marginTop: 4 }}>
              共 {fmtNum(total)} 行数据 · {columns.length} 个字段
              {report?.updatedAt ? ` · 更新于 ${fmtTime(report.updatedAt, 'YYYY-MM-DD HH:mm')}` : ''}
            </div>
          </div>
          <Space size={6} wrap>
            <Tag bordered={false} color={PALETTE.primary} style={{ color: NEUTRAL.textInverse }}>
              <EyeOutlined /> 公开分享
            </Tag>
            {config.chartType && (
              <Tag bordered={false} style={{ background: NEUTRAL.surfaceSunken, color: PALETTE.primary }}>
                {config.chartType}
              </Tag>
            )}
          </Space>
        </div>
      </Card>

      {/* 图表 */}
      <Card
        styles={{ body: { padding: isMobile ? 8 : 14 } }}
        style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12, marginBottom: 12 }}
      >
        {built.kind === 'table' ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="表格数据见下方明细" />
        ) : built.kind === 'number' ? (
          <div style={{ padding: isMobile ? '20px 8px' : '36px 8px', textAlign: 'center' }}>
            <Statistic
              title={<span style={{ color: NEUTRAL.textSecondary }}>{built.metric?.label}</span>}
              value={built.metric?.value}
              formatter={(v) => fmtNum(Number(v))}
              valueStyle={{ color: PALETTE.primary, fontWeight: 700, fontSize: isMobile ? 32 : 44 }}
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
        title={<span style={{ fontSize: 14, fontWeight: 600, color: NEUTRAL.text }}>数据明细</span>}
        extra={<span style={{ fontSize: 12, color: NEUTRAL.textSecondary }}>共 {fmtNum(total)} 行</span>}
        styles={{ body: { padding: 8 } }}
        style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12 }}
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

      <Paragraph style={{ marginTop: 14, marginBottom: 0, fontSize: 11.5, color: NEUTRAL.textTertiary, textAlign: 'center' }}>
        <Text type="secondary" style={{ fontSize: 11.5 }}>
          若内容涉及敏感数据，请联系分享者停用该链接
        </Text>
      </Paragraph>
    </Shell>
  );
}
