/**
 * AI 问数（@ant-design/x）
 *
 * 后端契约（src/ai.js + /api/ai/ask）：
 *   POST /api/ai/ask  → 普通 JSON（非流式），一次请求内部执行
 *                       「生成 SQL → 只读校验 → 执行 → 自然语言解读」，
 *                       耗时通常 3~20s，因此用 loading 气泡而不是流式逐字渲染。
 *   GET  /api/ai/chats → 历史问数记录
 *
 * 交互：
 *   - 选择数据集（可选，不选由后端启发式匹配）→ 提问 → 气泡展示解读 + 折叠 SQL + 结果表
 *   - 空态用 Welcome + Prompts 提供示例问题
 *   - 「最近问数」桌面端常驻右侧折叠面板，移动端弹 Modal 回看历史问答
 *   - 错误态用友好提示卡片 + 「前往系统设置」「重试」等行动指引，不做整页替换
 *   - 移动端：单列、发送框吸底、表格横向滚动
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Collapse,
  Empty,
  Grid,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ClearOutlined,
  DatabaseOutlined,
  HistoryOutlined,
  ReloadOutlined,
  RobotOutlined,
  SendOutlined,
  SettingOutlined,
  TableOutlined,
  ThunderboltOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Bubble, Sender, Welcome, Prompts } from '@ant-design/x';
import type { PromptsItemType } from '@ant-design/x';
import { useNavigate } from 'react-router-dom';
import Page from '@/components/Page';
import type { StatCardItem } from '@/components/StatCards';
import { useAppStore } from '@/stores/app';
import { PALETTE, NEUTRAL } from '@/theme';
import { fmtNum, fmtTime } from '@/utils';
import { askAi, listAiChats, classifyAiError, type AiChatRecord, type AiFailure } from '@/api/ai';
import { listDatasets, pickTableColumns, type DatasetColumn, type DatasetItem, type RowData } from '@/api/reports';

const { useBreakpoint } = Grid;
const { Text, Paragraph } = Typography;

interface ChatMeta {
  sql?: string;
  rows?: RowData[];
  columns?: DatasetColumn[];
  rowCount?: number;
  duration?: number;
  model?: string;
  datasetName?: string;
}

interface ChatMessage {
  key: string;
  role: 'user' | 'ai';
  content: string;
  loading?: boolean;
  failed?: boolean;
  meta?: ChatMeta;
}

/** 示例问题（无数据集时用通用问法） */
const DEFAULT_PROMPTS: PromptsItemType[] = [
  { key: 'p1', label: '数据总共有多少行？', description: '统计当前数据集的数据量' },
  { key: 'p2', label: '按分类统计数量前 10 名', description: '分组聚合 + 排序取 TOP10' },
  { key: 'p3', label: '最近 30 天的数据趋势', description: '按时间维度查看变化' },
  { key: 'p4', label: '有哪些字段是空的？', description: '检查数据完整度' },
];

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function newSessionKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
}

/** 是否今天（按浏览器本地时区比较年月日） */
function isToday(s?: string): boolean {
  if (!s) return false;
  const d = new Date(s);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export default function AiPage() {
  const { message } = AntApp.useApp();
  const { can } = useAppStore();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const canUse = can('ai:use');
  /** 是否有权修改系统设置（决定错误态是否给「前往设置」按钮） */
  const canConfig = can('setting:write');

  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [datasetId, setDatasetId] = useState<number | undefined>(undefined);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionKey, setSessionKey] = useState<string>(() => newSessionKey());
  const [history, setHistory] = useState<AiChatRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [lastFailure, setLastFailure] = useState<AiFailure | null>(null);
  const abortedRef = useRef(false);
  /** 最近一次失败的问题文本，供「重试」原地重发 */
  const lastFailedRef = useRef('');

  const loadDatasets = useCallback(async () => {
    try {
      const list = await listDatasets();
      setDatasets(list || []);
    } catch {
      setDatasets([]);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const list = await listAiChats(undefined, 30);
      setHistory(list || []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canUse) return;
    loadDatasets();
    loadHistory();
  }, [canUse, loadDatasets, loadHistory]);

  /** 刷新：清空错误并重新拉取数据集与历史 */
  const refresh = useCallback(async () => {
    setLastFailure(null);
    await Promise.all([loadDatasets(), loadHistory()]);
  }, [loadDatasets, loadHistory]);

  /** 重试：优先重发上次失败的提问，否则刷新数据 */
  const retry = () => {
    const q = lastFailedRef.current.trim();
    if (q) {
      send(q);
    } else {
      setLastFailure(null);
      void refresh();
    }
  };

  /** 有数据集时用其字段生成更贴合的示例问题 */
  const prompts = useMemo<PromptsItemType[]>(() => {
    const ds = datasets.find((d) => d.id === datasetId);
    if (!ds) return DEFAULT_PROMPTS;
    return [
      { key: 'p1', label: `${ds.name} 一共有多少条数据？`, description: '统计行数' },
      { key: 'p2', label: '按地区分组统计数量，取前 10', description: '分组聚合 TOP10' },
      { key: 'p3', label: '最近一个月的数量趋势', description: '时间趋势' },
      { key: 'p4', label: '数据里有哪些明显的异常值？', description: '异常检查' },
    ];
  }, [datasets, datasetId]);

  const historyToPass = useCallback((list: ChatMessage[]) => {
    return list
      .filter((m) => !m.loading && !m.failed && m.content)
      .slice(-6)
      .map((m) => ({ role: (m.role === 'ai' ? 'assistant' : 'user') as 'assistant' | 'user', content: m.content }));
  }, []);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || sending) return;
    if (!canUse) {
      message.warning('当前账号没有 AI 问数权限');
      return;
    }
    setInput('');
    setLastFailure(null);
    abortedRef.current = false;
    lastFailedRef.current = q;

    const userMsg: ChatMessage = { key: uid(), role: 'user', content: q };
    const pendingKey = uid();
    const pendingMsg: ChatMessage = { key: pendingKey, role: 'ai', content: '', loading: true };
    const base = [...messages, userMsg];
    setMessages([...base, pendingMsg]);
    setSending(true);

    try {
      const r = await askAi({
        question: q,
        datasetId,
        sessionKey,
        history: historyToPass(base),
      });
      if (abortedRef.current) {
        setMessages((prev) => prev.filter((m) => m.key !== pendingKey));
        return;
      }
      lastFailedRef.current = '';
      setMessages((prev) =>
        prev.map((m) =>
          m.key === pendingKey
            ? {
                ...m,
                loading: false,
                content: r.answer || `查询完成，共返回 ${r.rowCount} 行数据。`,
                meta: {
                  sql: r.sql,
                  rows: r.rows || [],
                  columns: r.columns || [],
                  rowCount: r.rowCount,
                  duration: r.duration,
                  model: r.model,
                  datasetName: r.datasetName,
                },
              }
            : m
        )
      );
      if (r.sessionKey) setSessionKey(r.sessionKey);
      // 后台刷新历史
      loadHistory();
    } catch (e) {
      if (abortedRef.current) {
        setMessages((prev) => prev.filter((m) => m.key !== pendingKey));
        return;
      }
      const failure = classifyAiError(e);
      setLastFailure(failure);
      setMessages((prev) =>
        prev.map((m) => (m.key === pendingKey ? { ...m, loading: false, failed: true, content: failure.title } : m))
      );
    } finally {
      setSending(false);
    }
  };

  const stop = () => {
    abortedRef.current = true;
    setSending(false);
    message.info('已取消本次请求的展示，服务端可能仍在执行');
  };

  const reset = () => {
    setMessages([]);
    setSessionKey(newSessionKey());
    setLastFailure(null);
    lastFailedRef.current = '';
  };

  /** 从历史记录回放到对话中（不重新请求） */
  const replay = (rec: AiChatRecord) => {
    const ok = rec.success === undefined ? true : !!rec.success;
    const ai: ChatMessage = {
      key: uid(),
      role: 'ai',
      content: ok ? rec.answer || `查询完成，共返回 ${rec.result_rows || 0} 行数据。` : rec.message || '本次问数失败',
      failed: !ok,
      meta: ok
        ? {
            sql: rec.sql_text || undefined,
            rowCount: rec.result_rows,
            duration: rec.duration_ms || undefined,
          }
        : undefined,
    };
    setMessages([{ key: uid(), role: 'user', content: rec.question }, ai]);
    setHistoryOpen(false);
    if (rec.session_key) setSessionKey(rec.session_key);
  };

  /* ── 数据卡片（就地统计，不新增接口） ── */
  const stats = useMemo<StatCardItem[]>(() => {
    const okHist = history.filter((h) => (h.success === undefined ? true : !!h.success) && (h.duration_ms || 0) > 0);
    const avgMs = okHist.length
      ? Math.round(okHist.reduce((s, h) => s + (h.duration_ms || 0), 0) / okHist.length)
      : 0;
    return [
      { key: 'history', label: '历史问答', value: history.length, suffix: '次', color: PALETTE.primary },
      { key: 'datasets', label: '可选数据集', value: datasets.length, suffix: '个', color: PALETTE.cyan },
      { key: 'today', label: '今日提问', value: history.filter((h) => isToday(h.created_at)).length, suffix: '次', color: PALETTE.green },
      {
        key: 'avg',
        label: '平均耗时',
        value: avgMs >= 1000 ? (avgMs / 1000).toFixed(1) : avgMs,
        suffix: avgMs >= 1000 ? 's' : 'ms',
        color: PALETTE.orange,
      },
    ];
  }, [history, datasets]);

  /* ── 气泡列表 ── */
  const bubbleItems = useMemo(() => {
    return messages.map((m) => {
      if (m.role === 'user') {
        return {
          key: m.key,
          role: 'user' as const,
          placement: 'end' as const,
          variant: 'filled' as const,
          content: m.content,
          avatar: (
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                background: PALETTE.primary,
                color: NEUTRAL.textInverse,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
              }}
            >
              <UserOutlined />
            </div>
          ),
          footer: (
            <span style={{ fontSize: 11, color: NEUTRAL.textTertiary }}>{fmtTime(new Date(), 'HH:mm')}</span>
          ),
        };
      }

      const meta = m.meta;
      const tableColumns = meta?.rows?.length
        ? pickTableColumns(meta.rows, meta.columns, isMobile ? 5 : 10).map((c) => ({
            title: c,
            dataIndex: c,
            key: c,
            ellipsis: true,
            width: 130,
            render: (v: unknown) => {
              if (v === null || v === undefined) return <span style={{ color: NEUTRAL.textQuaternary }}>-</span>;
              const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
              return <span title={s}>{s}</span>;
            },
          }))
        : [];

      const footer =
        m.loading || m.failed || !meta ? undefined : (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Space size={6} wrap>
              {meta.datasetName && (
                <Tag bordered={false} style={{ background: PALETTE.primarySoft, color: PALETTE.primaryDeep }}>
                  <DatabaseOutlined /> {meta.datasetName}
                </Tag>
              )}
              {meta.rowCount !== undefined && (
                <Tag bordered={false} style={{ background: `${PALETTE.green}26`, color: PALETTE.green }}>
                  <TableOutlined /> {fmtNum(meta.rowCount)} 行
                </Tag>
              )}
              {meta.duration !== undefined && (
                <Tag bordered={false} style={{ background: `${PALETTE.yellow}26`, color: PALETTE.orange }}>
                  <ThunderboltOutlined /> {(meta.duration / 1000).toFixed(1)}s
                </Tag>
              )}
              {meta.model && (
                <Tag bordered={false} style={{ background: `${PALETTE.cyan}26`, color: PALETTE.cyan }}>
                  {meta.model}
                </Tag>
              )}
            </Space>

            {meta.sql && (
              <Collapse
                size="small"
                ghost
                items={[
                  {
                    key: 'sql',
                    label: <span style={{ fontSize: 12, color: NEUTRAL.textSecondary }}>查看执行的 SQL</span>,
                    children: (
                      <pre
                        style={{
                          margin: 0,
                          padding: 10,
                          borderRadius: 8,
                          background: NEUTRAL.surfaceSunken,
                          border: `1px solid ${NEUTRAL.border}`,
                          fontSize: 11.5,
                          lineHeight: 1.6,
                          color: NEUTRAL.text,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          maxHeight: 220,
                          overflow: 'auto',
                        }}
                      >
                        {meta.sql}
                      </pre>
                    ),
                  },
                ]}
                style={{ background: 'transparent' }}
              />
            )}

            {!!meta.rows?.length && (
              <div style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 8, overflow: 'hidden' }}>
                <Table
                  size="small"
                  rowKey={(_, i) => String(i)}
                  dataSource={(meta.rows || []).slice(0, 30)}
                  columns={tableColumns}
                  pagination={false}
                  scroll={{ x: 'max-content', y: 240 }}
                  bordered
                />
                {(meta.rows.length || 0) > 30 && (
                  <div style={{ padding: '4px 8px', fontSize: 11.5, color: NEUTRAL.textTertiary }}>
                    仅展示前 30 行，共 {fmtNum(meta.rows.length)} 行
                  </div>
                )}
              </div>
            )}
          </div>
        );

      return {
        key: m.key,
        role: 'ai' as const,
        placement: 'start' as const,
        variant: 'outlined' as const,
        loading: m.loading,
        content: m.content,
        avatar: (
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              background: `linear-gradient(135deg, ${PALETTE.primary}, ${PALETTE.cyan})`,
              color: NEUTRAL.textInverse,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
            }}
          >
            <RobotOutlined />
          </div>
        ),
        footer,
      };
    });
  }, [messages, isMobile]);

  const roleConfig = useMemo(
    () => ({
      user: { placement: 'end' as const, variant: 'filled' as const },
      ai: { placement: 'start' as const, variant: 'outlined' as const },
    }),
    []
  );

  if (!canUse) {
    return (
      <Page title="AI 问数">
        <Alert
          type="warning"
          showIcon
          message="当前账号没有 AI 问数权限"
          description="AI 问数需要 ai:use 权限点，请联系管理员在「用户管理 → 角色权限」中开通。"
        />
      </Page>
    );
  }

  const historyPanel = (
    <Card
      title={
        <Space size={6}>
          <HistoryOutlined />
          <span style={{ fontSize: 13.5 }}>最近问数</span>
        </Space>
      }
      styles={{ body: { padding: history.length ? 8 : 16, maxHeight: isMobile ? '60vh' : 560, overflow: 'auto' } }}
      style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12 }}
    >
      {historyLoading ? (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : history.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无历史问数记录" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {history.map((rec) => {
            const ok = rec.success === undefined ? true : !!rec.success;
            return (
              <div
                key={rec.id}
                onClick={() => replay(rec)}
                style={{
                  cursor: 'pointer',
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: `1px solid ${NEUTRAL.borderSubtle}`,
                  background: NEUTRAL.surface,
                  minHeight: 44,
                }}
              >
                <div
                  style={{
                    fontSize: 12.5,
                    color: NEUTRAL.text,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {rec.question}
                </div>
                <div style={{ marginTop: 4, display: 'flex', gap: 8, fontSize: 11, color: NEUTRAL.textTertiary, flexWrap: 'wrap' }}>
                  <Tag bordered={false} color={ok ? PALETTE.green : PALETTE.red} style={{ color: NEUTRAL.textInverse, marginInlineEnd: 0 }}>
                    {ok ? '成功' : '失败'}
                  </Tag>
                  <span>{rec.result_rows ? `${rec.result_rows} 行` : ''}</span>
                  <span>{fmtTime(rec.created_at, 'MM-DD HH:mm')}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );

  /* ── 错误态：友好提示卡片 + 行动指引（不做整页替换） ── */
  const errorCard = lastFailure ? (
    <Card
      style={{ marginBottom: 12, border: `1px solid ${PALETTE.yellow}` }}
      styles={{ body: { padding: 14 } }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <WarningOutlined style={{ color: PALETTE.yellow, fontSize: 18, marginTop: 1 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: NEUTRAL.text }}>{lastFailure.title}</div>
          {lastFailure.detail ? (
            <div style={{ fontSize: 12, color: NEUTRAL.textSecondary, marginTop: 2, wordBreak: 'break-word' }}>
              {lastFailure.detail}
            </div>
          ) : null}
          <div style={{ fontSize: 12, color: NEUTRAL.textTertiary, marginTop: 4 }}>{lastFailure.hint}</div>
        </div>
      </div>
      <Space size={8} wrap style={{ marginTop: 12 }}>
        {lastFailure.config && canConfig ? (
          <Button type="primary" size="small" icon={<SettingOutlined />} onClick={() => navigate('/settings')}>
            前往系统设置
          </Button>
        ) : null}
        {lastFailure.dataset ? (
          <Button size="small" icon={<DatabaseOutlined />} onClick={() => navigate('/datasets')}>
            前往数据集
          </Button>
        ) : null}
        <Button size="small" icon={<ReloadOutlined />} onClick={retry}>
          重试
        </Button>
      </Space>
    </Card>
  ) : null;

  return (
    <Page
      title="AI 问数"
      search={
        <Select
          allowClear
          value={datasetId}
          onChange={setDatasetId}
          placeholder="全部数据集（自动匹配）"
          style={{ width: isMobile ? '100%' : 240 }}
          size={isMobile ? 'large' : 'middle'}
          showSearch
          optionFilterProp="label"
          suffixIcon={<DatabaseOutlined />}
          options={datasets.map((d) => ({ value: d.id, label: d.name }))}
        />
      }
      extra={
        <Space size={8} wrap>
          <Button icon={<ClearOutlined />} onClick={reset} disabled={!messages.length}>
            新会话
          </Button>
          {isMobile && (
            <Button icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>
              历史
            </Button>
          )}
        </Space>
      }
      stats={stats}
    >
      {errorCard}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1fr) 300px',
          gap: 14,
          alignItems: 'start',
        }}
      >
        {/* 对话区 */}
        <Card
          styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
          style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12, overflow: 'hidden' }}
        >
          <div
            style={{
              height: isMobile ? 'calc(100vh - 300px)' : 520,
              minHeight: 320,
              overflow: 'auto',
              padding: isMobile ? 12 : 16,
              background: NEUTRAL.surface,
            }}
          >
            {messages.length === 0 ? (
              <div style={{ padding: isMobile ? '16px 0' : '24px 0' }}>
                <Welcome
                  variant="borderless"
                  icon={
                    <div
                      style={{
                        width: 54,
                        height: 54,
                        borderRadius: 15,
                        background: `linear-gradient(135deg, ${PALETTE.primaryDeep}, ${PALETTE.primaryLight})`,
                        color: NEUTRAL.textInverse,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 25,
                      }}
                    >
                      <RobotOutlined />
                    </div>
                  }
                  title="有什么数据想了解？"
                  description="用日常语言提问，我会自动写 SQL、执行只读查询并解读结果。"
                  style={{ textAlign: 'center', padding: 0 }}
                />
                <div style={{ marginTop: 16 }}>
                  <Prompts
                    title={<span style={{ fontSize: 12.5, color: NEUTRAL.textTertiary }}>试试这些问题：</span>}
                    items={prompts}
                    vertical={isMobile}
                    wrap
                    onItemClick={(info) => send(String(info.data.label || ''))}
                    styles={{ item: { borderRadius: 10 } }}
                  />
                </div>
                {datasets.length === 0 && (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginTop: 14 }}
                    message="尚未创建数据集"
                    description="AI 问数依赖数据集提供字段上下文，请先在「数据集」页面创建数据集后使用。"
                  />
                )}
              </div>
            ) : (
              <Bubble.List
                autoScroll
                items={bubbleItems as never}
                role={roleConfig as never}
                styles={{ bubble: { maxWidth: isMobile ? '92%' : '78%' } }}
              />
            )}
          </div>

          {/* 输入区 */}
          <div style={{ borderTop: `1px solid ${NEUTRAL.borderSubtle}`, padding: isMobile ? 10 : 12, background: NEUTRAL.surface }}>
            {messages.length > 0 && (
              <div style={{ marginBottom: 8, fontSize: 11.5, color: NEUTRAL.textTertiary, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span>会话：{sessionKey.slice(0, 8)}</span>
                <span>数据集：{datasets.find((d) => d.id === datasetId)?.name || '自动匹配'}</span>
              </div>
            )}
            {sending ? (
              <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary, marginBottom: 8 }}>
                正在生成只读 SQL 并执行，单次通常需要 3~20 秒，请稍候…
              </div>
            ) : null}
            <Sender
              value={input}
              onChange={setInput}
              onSubmit={() => send(input)}
              loading={sending}
              onCancel={stop}
              placeholder="例如：按地区统计客户数量，取前 10 名"
              autoSize={{ minRows: 1, maxRows: 4 }}
              prefix={
                <Tag bordered={false} style={{ background: PALETTE.primarySoft, color: PALETTE.primaryDeep, marginInlineEnd: 0 }}>
                  <DatabaseOutlined /> {datasets.find((d) => d.id === datasetId)?.name || '自动'}
                </Tag>
              }
              suffix={(_, info) => {
                const { SendButton, LoadingButton } = info.components;
                return sending ? (
                  <LoadingButton type="default" />
                ) : (
                  <Tooltip title="发送（Enter）">
                    <SendButton type="primary" icon={<SendOutlined />} disabled={!input.trim()} />
                  </Tooltip>
                );
              }}
              style={{ borderRadius: 12 }}
            />
            <div style={{ marginTop: 8, fontSize: 11.5, color: NEUTRAL.textTertiary, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <span>Enter 发送 · 服务端仅执行只读 SQL</span>
              {isMobile && <span>结果较多时表格可左右滑动</span>}
            </div>
          </div>
        </Card>

        {/* 历史（桌面常驻 / 移动端 Modal） */}
        {!isMobile && historyPanel}
      </div>

      {isMobile && (
        <Modal
          title="最近问数"
          open={historyOpen}
          onCancel={() => setHistoryOpen(false)}
          footer={null}
          width="100%"
          style={{ top: 24, maxWidth: 'calc(100vw - 24px)' }}
          destroyOnHidden
        >
          {historyPanel}
        </Modal>
      )}

      <Paragraph style={{ marginTop: 12, marginBottom: 0, fontSize: 11.5, color: NEUTRAL.textTertiary }}>
        <Text type="secondary" style={{ fontSize: 11.5 }}>
          提示：AI 生成的 SQL 会经过后端只读校验（仅允许单条 SELECT / WITH），不会修改任何数据。
        </Text>
      </Paragraph>
    </Page>
  );
}