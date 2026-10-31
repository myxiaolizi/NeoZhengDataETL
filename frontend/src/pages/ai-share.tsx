/**
 * 公开 AI 问数页（路由 `/a/:token`，**无需登录**，手机优先 + 电脑可用）
 *
 * 需求硬要求（CONTRACT §3.4）：
 *   「手机和电脑打开网址就能问数」—— 独立布局（不套 BasicLayout）、单列居中（max-width 900）、
 *   顶部标题 + 可用数据概览、有密码先输入、气泡对话、结果表格（移动端横向滚动/卡片降级）、
 *   输入框吸底并适配 safe-area、点击区 ≥40px、移动端字号 ≥14px。
 *
 * 数据来源（全部走**裸 fetch**，绝不能用 api.*，否则未登录访客会被 401 踢回登录页）：
 *   GET  /api/public/ai-shares/:token?pwd=      → 元信息（needPassword / sources / allowExport）
 *   POST /api/public/ai-shares/:token/ask       → { question, pwd?, sessionKey?, history? }
 *
 * 服务端实测语义（Lead 2026-10-31 端到端验证）：
 *   - `needPassword` = 「该分享设有密码」，不是「尚未验证」；
 *     未验证时 `sources:[]` → 用 needPassword && sources.length===0 判定「未解锁」
 *   - 密码错：passwordError=true + message；停用 code=disabled；过期 code=expired；不存在 HTTP 404
 *   - 公开 ask **不返回 sql**（设计如此），页面绝不展示 SQL
 *   - 限流：单 token 20/分、单 IP 30/分 → 429 给出「访问过于频繁」提示
 *
 * 密码记忆：sessionStorage（key = `ai-share-pwd:<token>`），刷新免重输；**不用 localStorage**（长期驻留不合适）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Input, Result, Spin, Table, Tag, Typography } from 'antd';
import {
  ClockCircleOutlined,
  DatabaseOutlined,
  LockOutlined,
  ReloadOutlined,
  RobotOutlined,
  SendOutlined,
  TableOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  publicAiShareMeta,
  publicAiShareAsk,
  publicShareErrorInfo,
  newAiSessionKey,
  AiPublicError,
  SCOPE_KIND_LABEL,
  isScopeKind,
  type PublicAiShareMeta,
  type PublicAiShareSource,
  type AiScopeKind,
} from '@/api/ai';
import type { DatasetColumn, RowData } from '@/api/reports';
import { NEUTRAL, PALETTE, SIDER } from '@/theme';
import { fmtNum } from '@/utils';

const { Text } = Typography;

/** 密码记忆 key（sessionStorage：仅当前标签页会话有效） */
const pwdStorageKey = (token: string) => `ai-share-pwd:${token}`;

function readPwd(token: string): string {
  try {
    if (typeof sessionStorage === 'undefined') return '';
    return sessionStorage.getItem(pwdStorageKey(token)) || '';
  } catch {
    return '';
  }
}

function writePwd(token: string, pwd: string) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (pwd) sessionStorage.setItem(pwdStorageKey(token), pwd);
    else sessionStorage.removeItem(pwdStorageKey(token));
  } catch {
    /* 隐私模式下 sessionStorage 可能不可写，忽略即可 */
  }
}

/* ══════════════ 类型 ══════════════ */

interface ShareMeta extends PublicAiShareMeta {
  /** 已验证可对话 */
  ready: boolean;
}

interface AskMeta {
  rows: RowData[];
  columns: DatasetColumn[];
  rowCount: number;
  duration: number;
  model?: string;
  sources: PublicAiShareSource[];
  truncated: boolean;
}

interface ChatMsg {
  key: string;
  role: 'user' | 'ai';
  content: string;
  loading?: boolean;
  failed?: boolean;
  meta?: AskMeta;
}

type Phase = 'loading' | 'locked' | 'ready' | 'error';

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `m-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** 来源种类中文名（未知种类原样展示，不硬编码猜） */
function kindLabel(kind: string): string {
  return isScopeKind(kind) ? SCOPE_KIND_LABEL[kind as AiScopeKind] : kind;
}

/** 移动端断点（不依赖 antd Grid，公开页无 ConfigProvider 也能用） */
function useIsNarrow(breakpoint = 640): boolean {
  const [narrow, setNarrow] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < breakpoint;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setNarrow(window.innerWidth < breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return narrow;
}

/* ══════════════ 页头 ══════════════ */

function Shell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const narrow = useIsNarrow();
  return (
    <div
      style={{
        /* 整页固定高度 + 内部滚动：输入框才能稳定吸底（含手机键盘弹出） */
        height: '100dvh',
        maxHeight: '100dvh',
        background: NEUTRAL.pageBg,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          background: `linear-gradient(135deg, ${SIDER.bgTo} 0%, ${PALETTE.primaryDeep} 55%, ${PALETTE.primary} 100%)`,
          color: NEUTRAL.textInverse,
          padding: narrow ? '12px 14px' : '16px 24px',
          paddingTop: `calc(${narrow ? '12px' : '16px'} + env(safe-area-inset-top))`,
          flexShrink: 0,
        }}
      >
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              flex: '0 0 36px',
              borderRadius: 10,
              background: 'rgba(255,255,255,.18)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 17,
            }}
          >
            <RobotOutlined />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: narrow ? 16 : 18,
                fontWeight: 700,
                lineHeight: 1.35,
                wordBreak: 'break-word',
              }}
            >
              {title}
            </div>
            {subtitle ? (
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.80)', marginTop: 2 }}>{subtitle}</div>
            ) : null}
          </div>
        </div>
      </header>
      <main
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 900,
          margin: '0 auto',
          padding: narrow ? '10px 10px 0' : '16px 18px 0',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {children}
      </main>
      {footer}
    </div>
  );
}

/* ══════════════ 结果表格（移动端横向滚动；过窄时卡片式降级） ══════════════ */

function ResultTable({
  rows,
  columns,
  narrow,
}: {
  rows: RowData[];
  columns: DatasetColumn[];
  narrow: boolean;
}) {
  const names = useMemo(() => {
    const fromCols = (columns || []).map((c) => c.name).filter(Boolean);
    if (fromCols.length) return fromCols;
    return Object.keys(rows[0] || {});
  }, [columns, rows]);

  if (!rows.length) {
    return (
      <div style={{ padding: '10px 0', fontSize: 14, color: NEUTRAL.textTertiary }}>
        查询成功，但没有符合条件的数据。
      </div>
    );
  }

  const cellText = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  /* 极窄屏（<420px）或列数过多时：卡片式降级，避免每格只有 2 个字 */
  const useCard = names.length > 4 && typeof window !== 'undefined' && window.innerWidth < 420;

  if (useCard) {
    const shown = rows.slice(0, 20);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown.map((r, i) => (
          <div
            key={i}
            style={{
              border: `1px solid ${NEUTRAL.border}`,
              borderRadius: 10,
              background: NEUTRAL.surface,
              padding: '8px 10px',
            }}
          >
            <div style={{ fontSize: 12.5, color: NEUTRAL.textTertiary, marginBottom: 4 }}>第 {i + 1} 行</div>
            {names.map((n) => (
              <div key={n} style={{ display: 'flex', gap: 8, fontSize: 14, lineHeight: 1.7 }}>
                <span style={{ color: NEUTRAL.textTertiary, flex: '0 0 40%', wordBreak: 'break-all' }}>{n}</span>
                <span style={{ color: NEUTRAL.text, flex: 1, wordBreak: 'break-all' }}>{cellText(r[n]) || '-'}</span>
              </div>
            ))}
          </div>
        ))}
        {rows.length > shown.length ? (
          <div style={{ fontSize: 12.5, color: NEUTRAL.textTertiary, textAlign: 'center' }}>
            仅展示前 {shown.length} 行，共 {fmtNum(rows.length)} 行
          </div>
        ) : null}
      </div>
    );
  }

  const tableColumns = names.slice(0, narrow ? 6 : 12).map((n) => ({
    title: n,
    dataIndex: n,
    key: n,
    ellipsis: true,
    width: 130,
    render: (v: unknown) => {
      const s = cellText(v);
      if (!s) return <span style={{ color: NEUTRAL.textQuaternary }}>-</span>;
      return <span title={s}>{s}</span>;
    },
  }));

  return (
    <div style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <Table
        size="small"
        rowKey={(_, i) => String(i)}
        dataSource={rows.slice(0, 50)}
        columns={tableColumns}
        pagination={false}
        scroll={{ x: 'max-content' }}
        bordered
      />
      {rows.length > 50 ? (
        <div style={{ padding: '4px 8px', fontSize: 12, color: NEUTRAL.textTertiary }}>
          仅展示前 50 行，共 {fmtNum(rows.length)} 行
        </div>
      ) : null}
    </div>
  );
}

/* ══════════════ 气泡 ══════════════ */

function BubbleRow({
  msg,
  isMobile,
}: {
  msg: ChatMsg;
  isMobile: boolean;
}) {
  const mine = msg.role === 'user';
  const meta = msg.meta;

  const avatar = (
    <div
      style={{
        width: 32,
        height: 32,
        flex: '0 0 32px',
        borderRadius: 9,
        background: mine ? PALETTE.primary : `linear-gradient(135deg, ${PALETTE.primary}, ${PALETTE.cyan})`,
        color: NEUTRAL.textInverse,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 15,
      }}
    >
      {mine ? <UserOutlined /> : <RobotOutlined />}
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        justifyContent: mine ? 'flex-end' : 'flex-start',
        marginBottom: 12,
        alignItems: 'flex-start',
        flexDirection: mine ? 'row-reverse' : 'row',
      }}
    >
      {avatar}
      <div style={{ maxWidth: isMobile ? '82%' : '76%', minWidth: 0 }}>
        <div
          style={{
            background: mine ? PALETTE.primary : NEUTRAL.surface,
            color: mine ? NEUTRAL.textInverse : NEUTRAL.text,
            border: mine ? 'none' : `1px solid ${NEUTRAL.border}`,
            borderRadius: 12,
            padding: '9px 12px',
            /* 移动端字号 ≥ 14px（需求硬要求） */
            fontSize: 15,
            lineHeight: 1.65,
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
            boxShadow: mine ? 'none' : '0 1px 2px rgba(11,31,59,.05)',
          }}
        >
          {msg.loading ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Spin size="small" />
              <span style={{ color: NEUTRAL.textSecondary }}>正在理解问题、生成查询并执行…</span>
            </span>
          ) : msg.failed ? (
            <span style={{ color: PALETTE.red }}>{msg.content}</span>
          ) : (
            msg.content || '（无文字解读）'
          )}
        </div>

        {meta && !msg.loading ? (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {meta.sources.map((s, i) => (
                <Tag
                  key={`${s.name}-${i}`}
                  bordered={false}
                  style={{ background: PALETTE.primarySoft, color: PALETTE.primaryDeep, marginInlineEnd: 0 }}
                >
                  <DatabaseOutlined /> {s.name}
                  {s.rowCount !== undefined ? ` · ${fmtNum(s.rowCount)} 行` : ''}
                </Tag>
              ))}
              <Tag bordered={false} style={{ background: `${PALETTE.green}26`, color: PALETTE.green, marginInlineEnd: 0 }}>
                <TableOutlined /> {fmtNum(meta.rowCount)} 行
              </Tag>
              <Tag bordered={false} style={{ background: `${PALETTE.yellow}26`, color: PALETTE.orange, marginInlineEnd: 0 }}>
                <ThunderboltOutlined /> {(meta.duration / 1000).toFixed(1)}s
              </Tag>
              {meta.truncated ? (
                <Tag bordered={false} style={{ background: `${PALETTE.orange}26`, color: PALETTE.orange, marginInlineEnd: 0 }}>
                  已截断
                </Tag>
              ) : null}
            </div>
            <ResultTable rows={meta.rows} columns={meta.columns} narrow={isMobile} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ══════════════ 页面 ══════════════ */

export default function AiSharePage() {
  const { token = '' } = useParams<{ token: string }>();
  const [search] = useSearchParams();
  const isMobile = useIsNarrow(768);

  const [phase, setPhase] = useState<Phase>('loading');
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  /** 已解锁的元信息（locked 阶段为空） */
  const [unlocked, setUnlocked] = useState<PublicAiShareMeta | null>(null);
  const [errInfo, setErrInfo] = useState<{ title: string; detail: string; hint: string } | null>(null);

  const [pwd, setPwd] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError, setPwdError] = useState('');

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionKey, setSessionKey] = useState(() => newAiSessionKey());
  /** 顶部数据概览折叠状态（默认收起：手机上不抢对话空间） */
  const [overviewOpen, setOverviewOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  /** URL 里带的密码（?pwd=xxx，分享链接可带密码直达）优先于 sessionStorage */
  const urlPwd = useMemo(() => search.get('pwd') || '', [search]);

  const load = useCallback(
    async (password?: string) => {
      if (!token) {
        setPhase('error');
        setErrInfo(publicShareErrorInfo(new AiPublicError('分享链接无效', 0, 'not_found')));
        return;
      }
      setPhase('loading');
      setErrInfo(null);
      setPwdError('');
      try {
        const m = await publicAiShareMeta(token, password);
        const ready = !m.locked && m.sources.length > 0;
        setMeta({ ...m, ready: ready || (!m.locked && m.needPassword === false) });
        if (m.locked) {
          setUnlocked(null);
          setPhase('locked');
        } else {
          setUnlocked(m);
          setPhase('ready');
          if (password) {
            writePwd(token, password);
            setPwd(password);
          }
        }
      } catch (e) {
        const info = publicShareErrorInfo(e);
        /* 密码错：停在密码卡片并给出明确提示，不进整页错误 */
        if (e instanceof AiPublicError && e.code === 'password') {
          setPwdError(info.detail || info.title || '访问密码不正确');
          setPwd('');
          setPhase('locked');
          setMeta((prev) => prev || {
            ok: false,
            title: 'AI 问数',
            needPassword: true,
            locked: true,
            sources: [],
            allowExport: false,
            askEnabled: true,
            ready: false,
          });
          return;
        }
        setErrInfo({ title: info.title, detail: info.detail, hint: info.hint });
        setPhase('error');
      }
    },
    [token]
  );

  /* 首屏：URL 密码 → sessionStorage 记忆 → 无密码 */
  useEffect(() => {
    const remembered = urlPwd || readPwd(token);
    load(remembered || undefined);
  }, [load, urlPwd, token]);

  /* 页面标题跟随分享标题（公开页没有 BasicLayout 帮忙设标题） */
  useEffect(() => {
    const t = unlocked?.title || meta?.title;
    if (t && typeof document !== 'undefined') document.title = t;
  }, [meta, unlocked]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const submitPwd = async () => {
    const v = pwd.trim();
    if (!v || pwdLoading) return;
    setPwdLoading(true);
    setPwdError('');
    await load(v);
    setPwdLoading(false);
  };

  const historyToPass = (list: ChatMsg[]) =>
    list
      .filter((m) => !m.loading && !m.failed && m.content)
      .slice(-4)
      .map((m) => ({
        role: (m.role === 'ai' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: m.content,
      }));

  const send = async (question?: string) => {
    const q = String(question ?? input).trim();
    if (!q || sending) return;
    if (phase !== 'ready') return;
    const pwdToUse = urlPwd || pwd || readPwd(token);
    setInput('');
    const userMsg: ChatMsg = { key: uid(), role: 'user', content: q };
    const pendingKey = uid();
    const base = [...messages, userMsg];
    setMessages([...base, { key: pendingKey, role: 'ai', content: '', loading: true }]);
    setSending(true);
    try {
      const r = await publicAiShareAsk(token, {
        question: q,
        pwd: pwdToUse || undefined,
        sessionKey,
        history: historyToPass(base),
      });
      if (r.sessionKey) setSessionKey(r.sessionKey);
      setMessages((prev) =>
        prev.map((m) =>
          m.key === pendingKey
            ? {
                ...m,
                loading: false,
                content: r.answer || `查询完成，共返回 ${fmtNum(r.rowCount)} 行数据。`,
                meta: {
                  rows: r.rows,
                  columns: r.columns,
                  rowCount: r.rowCount,
                  duration: r.duration,
                  model: r.model,
                  sources: r.sources,
                  truncated: r.truncated,
                },
              }
            : m
        )
      );
    } catch (e) {
      const info = publicShareErrorInfo(e);
      setMessages((prev) =>
        prev.map((m) =>
          m.key === pendingKey
            ? { ...m, loading: false, failed: true, content: `${info.title}${info.detail ? `：${info.detail}` : ''}` }
            : m
        )
      );
      /* 密码失效 / 分享被停用：回到对应状态，避免用户一直撞错误 */
      if (e instanceof AiPublicError && (e.code === 'password' || e.code === 'disabled' || e.code === 'expired' || e.code === 'not_found')) {
        if (e.code === 'password') {
          writePwd(token, '');
          setPwd('');
          setMeta((prev) => (prev ? { ...prev, locked: true, ready: false } : prev));
          setUnlocked(null);
          setPwdError('访问密码不正确或已变更，请重新输入');
          setPhase('locked');
        } else {
          setErrInfo(info);
          setPhase('error');
        }
      }
    } finally {
      setSending(false);
    }
  };

  const resetChat = () => {
    setMessages([]);
    setSessionKey(newAiSessionKey());
  };

  /* ── 加载中 ── */
  if (phase === 'loading') {
    return (
      <Shell title="正在打开分享…" subtitle="AI 问数 · 公开分享">
        <div style={{ padding: '60px 0', textAlign: 'center' }}>
          <Spin size="large" />
        </div>
      </Shell>
    );
  }

  /* ── 整页错误（停用 / 过期 / 不存在 / 限流） ── */
  if (phase === 'error') {
    return (
      <Shell title="无法打开该分享" subtitle="AI 问数 · 公开分享">
        <div style={{ background: NEUTRAL.surface, border: `1px solid ${NEUTRAL.border}`, borderRadius: 12 }}>
          <Result
            status="warning"
            title={errInfo?.title || '无法打开该分享'}
            subTitle={
              <span style={{ fontSize: 14 }}>
                {[errInfo?.detail, errInfo?.hint].filter(Boolean).join('　')}
              </span>
            }
            extra={
              <Button
                icon={<ReloadOutlined />}
                size={isMobile ? 'large' : 'middle'}
                onClick={() => load(urlPwd || readPwd(token) || undefined)}
              >
                重新加载
              </Button>
            }
            style={{ padding: isMobile ? '24px 14px' : '40px 24px' }}
          />
        </div>
      </Shell>
    );
  }

  /* ── 需要密码 ── */
  if (phase === 'locked') {
    return (
      <Shell title={meta?.title || 'AI 问数'} subtitle="此分享需要访问密码">
        <div
          style={{
            background: NEUTRAL.surface,
            border: `1px solid ${NEUTRAL.border}`,
            borderRadius: 12,
            padding: isMobile ? 18 : 26,
            maxWidth: 460,
            margin: '10px auto 0',
            width: '100%',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <div
              style={{
                width: 52,
                height: 52,
                margin: '0 auto 10px',
                borderRadius: 14,
                background: PALETTE.primarySoft,
                color: PALETTE.primaryDeep,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
              }}
            >
              <LockOutlined />
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: NEUTRAL.text }}>请输入访问密码</div>
            <div style={{ fontSize: 14, color: NEUTRAL.textSecondary, marginTop: 4 }}>
              分享者为此链接设置了访问密码，输入后即可开始问数。
            </div>
          </div>

          <Input.Password
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            onPressEnter={submitPwd}
            placeholder="访问密码"
            size="large"
            autoFocus
            status={pwdError ? 'error' : undefined}
            style={{ fontSize: 16, height: 46 }}
            visibilityToggle
          />
          {pwdError ? (
            <div style={{ color: PALETTE.red, fontSize: 14, marginTop: 8 }}>
              {pwdError.includes('不正确') ? pwdError : `访问密码不正确（${pwdError}）`}
            </div>
          ) : null}
          <Button
            type="primary"
            block
            size="large"
            loading={pwdLoading}
            disabled={!pwd.trim()}
            onClick={submitPwd}
            style={{ marginTop: 14, height: 46, fontSize: 16 }}
          >
            进入问数
          </Button>
        </div>
      </Shell>
    );
  }

  /* ── 就绪：对话 ── */
  const sources = unlocked?.sources || [];
  const totalRows = sources.reduce((s, x) => s + (x.rowCount || 0), 0);

  return (
    <Shell
      title={unlocked?.title || 'AI 问数'}
      subtitle={
        <span>
          {sources.length} 个数据来源 · 共 {fmtNum(totalRows)} 行
          {unlocked?.allowExport ? ' · 允许导出' : ''}
        </span>
      }
      footer={
        /* 输入框吸底 + 安全区适配（需求硬要求）：整页 100dvh 内固定底部，页面 body 不滚动 */
        <div
          style={{
            flexShrink: 0,
            background: NEUTRAL.surface,
            borderTop: `1px solid ${NEUTRAL.border}`,
            paddingTop: 10,
            paddingInline: isMobile ? 10 : 18,
            paddingBottom: `calc(10px + env(safe-area-inset-bottom))`,
            boxShadow: '0 -2px 10px rgba(11,31,59,.06)',
          }}
        >
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            {!unlocked?.askEnabled ? (
              <div style={{ fontSize: 14, color: PALETTE.red, marginBottom: 8 }}>
                分享者已关闭公开问数，暂时无法提问。
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <Input.TextArea
                ref={inputRef as never}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="用一句话提问，例如：一共多少条数据？按地区统计前 10"
                autoSize={{ minRows: 1, maxRows: 4 }}
                disabled={sending || !unlocked?.askEnabled}
                onPressEnter={(e) => {
                  /* 回车发送；Shift+Enter 换行（手机端软键盘不会触发，另有发送按钮） */
                  if (!e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                style={{ fontSize: 15, lineHeight: 1.6, paddingTop: 10, paddingBottom: 10, minHeight: 44 }}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={() => void send()}
                loading={sending}
                disabled={!input.trim() || !unlocked?.askEnabled}
                style={{ height: 44, minWidth: 44, flex: '0 0 auto' }}
                aria-label="发送"
              >
                {isMobile ? null : '发送'}
              </Button>
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: NEUTRAL.textTertiary,
                marginTop: 6,
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <span>Enter 发送 · 仅执行只读查询</span>
              <span>AI 生成内容可能有误，请以数据为准</span>
            </div>
          </div>
        </div>
      }
    >
      {/* 可用数据概览（折叠） */}
      <div
        style={{
          background: NEUTRAL.surface,
          border: `1px solid ${NEUTRAL.border}`,
          borderRadius: 10,
          padding: '8px 12px',
          marginBottom: 10,
          flexShrink: 0,
        }}
      >
        <div
          onClick={() => setOverviewOpen((v) => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            minHeight: 24,
            gap: 8,
          }}
        >
          <span style={{ fontSize: 14, color: NEUTRAL.textSecondary, display: 'flex', alignItems: 'center', gap: 6 }}>
            <DatabaseOutlined style={{ color: PALETTE.primary }} />
            可用数据（{sources.length}）
            <span style={{ color: NEUTRAL.textTertiary, fontSize: 12.5 }}>
              {sources.map((s) => s.name).join('、').slice(0, isMobile ? 16 : 40)}
              {(isMobile ? sources.map((s) => s.name).join('、').length > 16 : sources.map((s) => s.name).join('、').length > 40) ? '…' : ''}
            </span>
          </span>
          <span style={{ fontSize: 12.5, color: PALETTE.primary }}>{overviewOpen ? '收起' : '展开'}</span>
        </div>
        {overviewOpen ? (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sources.map((s, i) => (
              <div
                key={`${s.name}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: 14,
                  padding: '6px 8px',
                  borderRadius: 8,
                  background: NEUTRAL.surfaceAlt,
                }}
              >
                <span style={{ color: NEUTRAL.text, minWidth: 0, wordBreak: 'break-all' }}>{s.name}</span>
                <span style={{ color: NEUTRAL.textTertiary, fontSize: 12.5, flex: '0 0 auto' }}>
                  {kindLabel(String(s.kind))}
                  {s.rowCount !== undefined ? ` · ${fmtNum(s.rowCount)} 行` : ''}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* 对话区 */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 120,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 8,
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              background: NEUTRAL.surface,
              border: `1px solid ${NEUTRAL.border}`,
              borderRadius: 12,
              padding: isMobile ? '18px 14px' : '26px 22px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 54,
                height: 54,
                margin: '0 auto 10px',
                borderRadius: 15,
                background: `linear-gradient(135deg, ${PALETTE.primaryDeep}, ${PALETTE.primaryLight})`,
                color: NEUTRAL.textInverse,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
              }}
            >
              <RobotOutlined />
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: NEUTRAL.text }}>有什么想了解的？</div>
            <div style={{ fontSize: 14, color: NEUTRAL.textSecondary, marginTop: 6, lineHeight: 1.7 }}>
              {unlocked?.welcome || '用日常语言提问，我会自动生成只读查询并解读结果。'}
            </div>
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                '一共有多少条数据？',
                '按地区分组统计数量，取前 10',
                '最近一个月的数据趋势',
                '数据里有空值的字段有哪些？',
              ].map((p) => (
                <div
                  key={p}
                  onClick={() => void send(p)}
                  style={{
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: 14,
                    color: NEUTRAL.text,
                    background: NEUTRAL.surfaceAlt,
                    border: `1px solid ${NEUTRAL.borderSubtle}`,
                    borderRadius: 10,
                    padding: '10px 12px',
                    minHeight: 42,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <span>{p}</span>
                  <ClockCircleOutlined style={{ color: NEUTRAL.textQuaternary, fontSize: 13 }} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <BubbleRow key={m.key} msg={m} isMobile={isMobile} />)
        )}
        {messages.length > 0 ? (
          <div style={{ textAlign: 'center', paddingBottom: 10 }}>
            <Button
              size="small"
              type="link"
              onClick={resetChat}
              disabled={sending}
              style={{ fontSize: 13 }}
            >
              清空对话
            </Button>
          </div>
        ) : null}
      </div>

      {sources.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该分享暂无可问数的数据来源" style={{ margin: '20px 0' }} />
      ) : null}
    </Shell>
  );
}
