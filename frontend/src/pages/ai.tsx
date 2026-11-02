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
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ClearOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  ExportOutlined,
  HistoryOutlined,
  MessageOutlined,
  ReloadOutlined,
  RobotOutlined,
  SendOutlined,
  SettingOutlined,
  ShareAltOutlined,
  TableOutlined,
  ThunderboltOutlined,
  UserOutlined,
  WarningOutlined,
  FileAddOutlined,
  BookOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { Bubble, Sender, Welcome, Prompts } from '@ant-design/x';
import type { PromptsItemType } from '@ant-design/x';
import { useNavigate } from 'react-router-dom';
import Page from '@/components/Page';
import PageTabs, { PageTabTag, pageTabLabel } from '@/components/PageTabs';
import type { StatCardItem } from '@/components/StatCards';
import { useAppStore } from '@/stores/app';
import { PALETTE, NEUTRAL } from '@/theme';
import { fmtNum, fmtTime } from '@/utils';
import { askAi, listAiChats, classifyAiError, getAiScopeOptions, normalizeScopeOptions,
  scopeGroup, scopeKey, scopeRefKey, SCOPE_KINDS, SCOPE_KIND_LABEL, countUsableOptions,
  type AiChatRecord, type AiFailure, type AiScopeOption, type AiScopeOptions,
  type AiScopeRef, type AiSourceRef } from '@/api/ai';
import { listDatasets, pickTableColumns, type DatasetColumn, type RowData } from '@/api/reports';

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
  /** 本次实际用到的数据来源（V8 scope 回显） */
  sources?: AiSourceRef[];
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

  /* ── 数据范围（V8 scope）──
   * 后端 /api/ai/ask 强制要求 scope 非空数组；旧版页面只传可选 datasetId，
   * 一旦用户没手动选数据集，请求体里根本没有范围字段 → 400「请先选择要问数的数据范围」。
   * 现在改为：加载 scope-options → 自动选中一个「有效」来源 → 显式以数组传给后端。
   */
  const [scopeOptions, setScopeOptions] = useState<AiScopeOptions | null>(null);
  const [scope, setScope] = useState<AiScopeRef[]>([]);
  const [scopeLoading, setScopeLoading] = useState(true);
  const scopeSelectRef = useRef<any>(null);

  /* ── V10 A7：把问数结果添加到报表中心 ── */
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveTarget, setSaveTarget] = useState<{ sql: string; answer: string; rowCount: number } | null>(null);
  const [saveName, setSaveName] = useState('');
  const [saveDesc, setSaveDesc] = useState('');
  const [saveType, setSaveType] = useState<'chart' | 'table'>('table');
  const [saveBusy, setSaveBusy] = useState(false);

  /* ── V10 A1/A2：术语管理 + SQL 示例库 ── */
  /**
   * V13 B4：这两个面板已改为 Page 的同级标签页（不再用 Drawer 开关）。
   * termPanelOpen/exPanelOpen 保留仅为兼容历史状态引用，实际不再驱动 UI。
   */
  const [aiTab, setAiTab] = useState('chat');
  const [termList, setTermList] = useState<Array<Record<string, unknown>>>([]);
  const [termBusy, setTermBusy] = useState(false);
  const [termForm, setTermForm] = useState({ term: '', definition: '', aliases: '', category: '' });

  const [exList, setExList] = useState<Array<Record<string, unknown>>>([]);
  const [exBusy, setExBusy] = useState(false);
  const [exForm, setExForm] = useState({ question: '', sql: '', description: '', tags: '' });

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionKey, setSessionKey] = useState<string>(() => {
    /**
     * V10：支持通过 ?session=xxx 恢复指定会话。
     * 之前初始化永远新建，导致刷新页面后主聊天区永远是空的，
     * 历史问数结果（SQL / 图表 / 添加到报表中心按钮）全部看不到。
     */
    try {
      const sp = new URLSearchParams(window.location.search);
      const key = sp.get('session');
      if (key && key.trim()) return key.trim();
    } catch { /* ignore */ }
    return newSessionKey();
  });
  const [history, setHistory] = useState<AiChatRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [lastFailure, setLastFailure] = useState<AiFailure | null>(null);
  const abortedRef = useRef(false);
  /** 最近一次失败的问题文本，供「重试」原地重发 */
  const lastFailedRef = useRef('');

  /* ── V13 B3：分享的创建与管理已全部迁到「分享中心」（/shares?tab=ai）──
   * 本页只保留一个跳转按钮，因此下面这些 state 全部删除：
   *   shareOpen/shareTitle/sharePwd/shareDays/shareExport/shareSaving/shareCreated
   *   manageOpen/shareList/shareListLoading
   * 后端接口（/api/ai/shares）保持不变，由分享中心消费。
   */


  /**
   * 默认数据范围：只在**有效**来源里挑，绝不默认选中 invalid 的（如 id=47 的测试数据集，
   * 它关联的项目已不存在，选它问数必失败）。
   * 优先数据集（带字段中文标签，语义最清楚），同类里取行数最多的；没有有效数据集才退到其它类型。
   */
  const pickDefaultScope = useCallback((opts: AiScopeOptions | null): AiScopeRef[] => {
    if (!opts) return [];
    const validOf = (list: AiScopeOption[]) => list.filter((o) => !o.invalid);
    const byRows = (list: AiScopeOption[]) =>
      list.length ? list.reduce((a, b) => (b.rowCount > a.rowCount ? b : a)) : null;

    const bestDataset = byRows(validOf(scopeGroup(opts, 'dataset')));
    if (bestDataset) return [{ kind: bestDataset.kind, id: bestDataset.id }];

    const others: AiScopeOption[] = [];
    (['project', 'mail', 'flow'] as const).forEach((k) => validOf(scopeGroup(opts, k)).forEach((o) => others.push(o)));
    const bestOther = byRows(others);
    return bestOther ? [{ kind: bestOther.kind, id: bestOther.id }] : [];
  }, []);

  const loadScope = useCallback(async () => {
    setScopeLoading(true);
    try {
      const opts = await getAiScopeOptions();
      setScopeOptions(opts);
      setScope((prev) => (prev.length ? prev : pickDefaultScope(opts)));
    } catch {
      /* scope-options 不可用（权限/接口异常）时退回数据集列表，仍然传数组 scope */
      try {
        const list = await listDatasets();
        const opts = normalizeScopeOptions({
          enabled: true,
          datasets: (list || []).map((d) => ({ kind: 'dataset', id: d.id, name: d.name })),
        });
        setScopeOptions(opts);
        setScope((prev) => (prev.length ? prev : pickDefaultScope(opts)));
      } catch {
        setScopeOptions(null);
      }
    } finally {
      setScopeLoading(false);
    }
  }, [pickDefaultScope]);

  /** scope 唯一键 → 选项，用于 Select 与文案 */
  const scopeOptionMap = useMemo(() => {
    const m = new Map<string, AiScopeOption>();
    SCOPE_KINDS.forEach((k) => scopeGroup(scopeOptions, k).forEach((o) => m.set(scopeKey(o.kind, o.id), o)));
    return m;
  }, [scopeOptions]);

  /** 当前已选范围的显示名 */
  const scopeNames = useMemo(
    () => scope.map((r) => scopeOptionMap.get(scopeRefKey(r))?.name || `${r.kind}#${r.id}`),
    [scope, scopeOptionMap],
  );

  const scopeLabel = scopeNames.length
    ? (scopeNames.length === 1 ? scopeNames[0] : `${scopeNames[0]} +${scopeNames.length - 1}`)
    : '请选择数据范围';

  const scopeSelectOptions = useMemo(() => {
    return SCOPE_KINDS.map((kind) => {
      const group = scopeGroup(scopeOptions, kind);
      if (!group.length) return null;
      return {
        label: SCOPE_KIND_LABEL[kind],
        title: SCOPE_KIND_LABEL[kind],
        options: group.map((o) => ({
          value: scopeKey(o.kind, o.id),
          label: `${o.name}${o.rowCount ? ` · ${fmtNum(o.rowCount)} 行` : ''}${o.invalid ? '（不可用）' : ''}`,
          disabled: !!o.invalid,
          title: o.reason || undefined,
        })),
      };
    }).filter(Boolean) as { label: string; title: string; options: { value: string; label: string; disabled: boolean; title?: string }[] }[];
  }, [scopeOptions]);

  /** 勾选变化：过滤掉 invalid（置灰的不可选），并守 maxSources */
  const onScopeChange = useCallback((vals: string[]) => {
    const max = scopeOptions?.maxSources ?? 8;
    const next: AiScopeRef[] = [];
    for (const v of vals) {
      const o = scopeOptionMap.get(v);
      if (!o || o.invalid) continue;
      next.push({ kind: o.kind, id: o.id, ...(o.tableType ? { tableType: o.tableType } : {}) });
    }
    if (next.length > max) {
      message.warning(`最多同时选择 ${max} 个数据来源`);
      return;
    }
    setScope(next);
  }, [scopeOptionMap, scopeOptions, message]);

  /** 一键使用默认范围（未选范围时的引导按钮） */
  const useDefaultScope = useCallback(() => {
    const d = pickDefaultScope(scopeOptions);
    if (d.length) {
      setScope(d);
      setLastFailure(null);
      message.success('已选择默认数据范围，可以直接提问');
    } else {
      scopeSelectRef.current?.focus?.();
      message.warning('没有可用数据范围，请先在「数据集」或「数据项目」中创建');
    }
  }, [pickDefaultScope, scopeOptions, message]);

  /* ══════════ V8 分享：创建 ══════════ */

  /** 默认分享标题：「AI 问数 · <范围摘要>」 */
  const defaultShareTitle = useCallback((): string => {
    const names = scopeNames.filter(Boolean);
    if (!names.length) return 'AI 问数';
    const summary = names.length <= 2 ? names.join('、') : `${names.slice(0, 2).join('、')} 等 ${names.length} 个`;
    return `AI 问数 · ${summary}`;
  }, [scopeNames]);

  /**
   * V13 B3：分享统一到「分享中心」。本页不再创建分享、也不管理分享列表，
   * 只提供一个跳转入口（把「分享」按钮语义从「弹窗创建」改为「去分享中心」）。
   *
   * 为什么不再本页创建：用户原话「报表中心和 AI 问数的分享都统一放到分享中心」，
   * 两个来源（/api/shares 与 /api/ai/shares）此前各有一套独立界面，
   * 用户在报表中心看到的分享列表和 AI 问数看到的是两份，彼此不可见。
   */
  const goShareCentre = useCallback(() => {
    navigate('/shares?tab=ai');
  }, [navigate]);


  /* ── V10 A1：术语管理 ── */
  const loadTerms = useCallback(async () => {
    setTermBusy(true);
    try {
      const r = await fetch('/api/ai/terms', { credentials: 'same-origin' }).then((x) => x.json());
      setTermList(r.ok ? (r.data || []) : []);
    } catch { setTermList([]); } finally { setTermBusy(false); }
  }, []);

  const createTerm = useCallback(async () => {
    if (!termForm.term.trim() || !termForm.definition.trim()) { message.warning('术语名与定义必填'); return; }
    setTermBusy(true);
    try {
      const r = await fetch('/api/ai/terms', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(termForm),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.message || '创建失败');
      message.success('术语已添加');
      setTermForm({ term: '', definition: '', aliases: '', category: '' });
      await loadTerms();
    } catch (e) { message.error(e instanceof Error ? e.message : '创建失败'); } finally { setTermBusy(false); }
  }, [termForm, loadTerms]);

  const removeTerm = useCallback(async (id: number) => {
    setTermBusy(true);
    try {
      await fetch('/api/ai/terms/' + id, { method: 'DELETE', credentials: 'same-origin' });
      await loadTerms();
    } finally { setTermBusy(false); }
  }, [loadTerms]);

  /* ── V10 A2：SQL 示例库 ── */
  const loadExamples = useCallback(async () => {
    setExBusy(true);
    try {
      const r = await fetch('/api/ai/sql-examples', { credentials: 'same-origin' }).then((x) => x.json());
      setExList(r.ok ? (r.data || []) : []);
    } catch { setExList([]); } finally { setExBusy(false); }
  }, []);

  const createExample = useCallback(async () => {
    if (!exForm.question.trim() || !exForm.sql.trim()) { message.warning('示例问题与 SQL 必填'); return; }
    setExBusy(true);
    try {
      const r = await fetch('/api/ai/sql-examples', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exForm),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.message || '创建失败');
      message.success('SQL 示例已添加');
      setExForm({ question: '', sql: '', description: '', tags: '' });
      await loadExamples();
    } catch (e) { message.error(e instanceof Error ? e.message : '创建失败'); } finally { setExBusy(false); }
  }, [exForm, loadExamples]);

  const removeExample = useCallback(async (id: number) => {
    setExBusy(true);
    try {
      await fetch('/api/ai/sql-examples/' + id, { method: 'DELETE', credentials: 'same-origin' });
      await loadExamples();
    } finally { setExBusy(false); }
  }, [loadExamples]);

  /**
   * V10 A7：把当前问数结果存成一个报表。
   * 后端 POST /api/reports 接受 { name, description, reportType, config }，
   * config 里带 sql + 结论 + 列信息，报表中心可直接复现。
   */
  const submitToReport = useCallback(async () => {
    if (!saveTarget) return;
    const nm = saveName.trim();
    if (!nm) { message.warning('请填写报表名称'); return; }
    setSaveBusy(true);
    try {
      const r = await fetch('/api/reports', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nm,
          description: saveDesc.trim() || undefined,
          reportType: saveType,
          config: {
            source: 'ai',
            sql: saveTarget.sql,
            answer: saveTarget.answer,
            rowCount: saveTarget.rowCount,
            chartType: saveType === 'chart' ? 'bar' : 'table',
          },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.message || `保存失败（HTTP ${r.status}）`);
      message.success('已添加到报表中心');
      setSaveOpen(false);
      setSaveName('');
      setSaveDesc('');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaveBusy(false);
    }
  }, [saveTarget, saveName, saveDesc, saveType]);

  /** 复制文本到剪贴板（navigator.clipboard 不可用时退回 textarea + execCommand） */
  const copyText = useCallback(
    async (text: string) => {
      const s = String(text || '');
      if (!s) return;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(s);
          message.success('链接已复制');
          return;
        }
      } catch {
        /* 落到下面的兜底 */
      }
      try {
        const ta = document.createElement('textarea');
        ta.value = s;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        message.success('链接已复制');
      } catch {
        message.warning('当前浏览器不支持自动复制，请手动选中链接复制');
      }
    },
    [message]
  );

  /* V13 B3：原「V8 分享：管理」的 loadShares / openManage / toggleShare / deleteShare
     已随分享管理界面一并删除（分享统一到分享中心 /shares?tab=ai）。 */

  /**
   * V10：按 sessionKey 拉取某个会话的全部问答，渲染到主聊天区。
   * 后端 GET /api/ai/chats?sessionKey=xxx
   */
  const loadSessionByKey = useCallback(async (key: string) => {
    if (!key) return;
    try {
      const recs = await listAiChats(key, 100);
      const list = Array.isArray(recs) ? recs : [];
      if (!list.length) return;
      setSessionKey(key);
      // 数据库按 id DESC 返回，渲染要按时间正序
      const ordered = [...list].reverse();
      const msgs: ChatMessage[] = [];
      ordered.forEach((rec) => {
        if (rec.question) msgs.push({ key: uid(), role: 'user', content: String(rec.question) });
        msgs.push({
          key: uid(),
          role: 'ai',
          content: String(rec.answer || ''),
          meta: {
            sql: rec.sql_text || undefined,
            rowCount: rec.result_rows !== undefined && rec.result_rows !== null ? Number(rec.result_rows) : undefined,
            duration: rec.duration_ms !== undefined && rec.duration_ms !== null ? Number(rec.duration_ms) : undefined,
                      },
        });
      });
      setMessages(msgs);
    } catch { /* 静默失败：保持当前状态 */ }
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
    loadScope();
    loadHistory();
  }, [canUse, loadScope, loadHistory]);

  /**
   * V10：首次进入自动恢复会话。
   *  - 有 ?session= → 加载该会话
   *  - 否则 → 加载历史里最近的一条（让刷新后仍能看到上次问数结果）
   * 只执行一次（用 ref 防重复）。
   */
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!canUse || restoredRef.current) return;
    if (!history || !history.length) return;
    restoredRef.current = true;
    (async () => {
      let key = '';
      try {
        const sp = new URLSearchParams(window.location.search);
        key = (sp.get('session') || '').trim();
      } catch { /* ignore */ }
      if (!key) {
        const first = history[0];
        key = String(first && first.session_key ? first.session_key : '');
      }
      if (key) await loadSessionByKey(key);
    })();
  }, [canUse, history, loadSessionByKey]);

  /** 刷新：清空错误并重新拉取数据范围与历史 */
  const refresh = useCallback(async () => {
    setLastFailure(null);
    await Promise.all([loadScope(), loadHistory()]);
  }, [loadScope, loadHistory]);

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

  /** 已选范围时用其名称生成更贴合的示例问题 */
  const prompts = useMemo<PromptsItemType[]>(() => {
    const name = scopeNames[0];
    if (!name) return DEFAULT_PROMPTS;
    return [
      { key: 'p1', label: `${name} 一共有多少条数据？`, description: '统计行数' },
      { key: 'p2', label: '按地区分组统计数量，取前 10', description: '分组聚合 TOP10' },
      { key: 'p3', label: '最近一个月的数量趋势', description: '时间趋势' },
      { key: 'p4', label: '数据里有哪些明显的异常值？', description: '异常检查' },
    ];
  }, [scopeNames]);

  const historyToPass = useCallback((list: ChatMessage[]) => {
    return list
      .filter((m) => !m.loading && !m.failed && m.content)
      .slice(-6)
      .map((m) => ({ role: (m.role === 'ai' ? 'assistant' : 'user') as 'assistant' | 'user', content: m.content }));
  }, []);

  /**
   * 「未选数据范围」的统一引导。
   * 发送按钮在未选范围时是禁用的（点不动），所以按钮外面套了一层 span 接住点击，
   * 让用户点下去能看到明确原因 + 一键使用默认范围，而不是「点了没反应」。
   */
  const warnNoScope = useCallback(() => {
    setLastFailure({
      kind: 'noscope',
      title: '还没有选择数据范围',
      detail: '',
      config: false,
      dataset: false,
      hint: '请先在上方「数据范围」中选择数据集 / 数据项目 / 邮件推送 / 流程产出，再点击发送。',
    });
    message.warning('请先选择数据范围，再提问');
    scopeSelectRef.current?.focus?.();
  }, [message]);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || sending) return;
    if (!canUse) {
      message.warning('当前账号没有 AI 问数权限');
      return;
    }
    /* 总开关关闭时先拦住，避免白跑一次 3~20s 的请求 */
    if (scopeOptions && scopeOptions.enabled === false) {
      setLastFailure(classifyAiError(new Error('系统未启用 AI 问数，请先在系统设置中开启')));
      message.warning('系统未启用 AI 问数，请联系管理员在系统设置中开启');
      return;
    }
    /* 没选数据范围：给明确引导，不要静默失败 */
    if (!scope.length) {
      warnNoScope();
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
        /* 必须传数组：后端只认 scope 非空数组（或旧的 datasetId 单值兜底） */
        scope: scope.map((s) => ({
          kind: s.kind,
          id: s.id,
          ...(s.tableType ? { tableType: s.tableType } : {}),
        })),
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
                  datasetName: r.datasetName || (r.sources || []).map((s) => s.name).join(' + '),
                  sources: r.sources || [],
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
      {
        key: 'datasets',
        label: '可选数据来源',
        value: countUsableOptions(scopeOptions),
        suffix: '个',
        color: PALETTE.cyan,
      },
      { key: 'today', label: '今日提问', value: history.filter((h) => isToday(h.created_at)).length, suffix: '次', color: PALETTE.green },
      {
        key: 'avg',
        label: '平均耗时',
        value: avgMs >= 1000 ? (avgMs / 1000).toFixed(1) : avgMs,
        suffix: avgMs >= 1000 ? 's' : 'ms',
        color: PALETTE.orange,
      },
    ];
  }, [history, scopeOptions]);

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
              {/* 数据范围：优先按后端回显的 sources 逐个列出（多来源时可看全） */}
              {(meta.sources && meta.sources.length
                ? meta.sources.map((s, i) => s.name || `来源 ${i + 1}`)
                : (meta.datasetName ? [meta.datasetName] : [])
              ).map((nm) => (
                <Tag
                  key={`src-${nm}`}
                  bordered={false}
                  style={{ background: PALETTE.primarySoft, color: PALETTE.primaryDeep }}
                >
                  <DatabaseOutlined /> {nm}
                </Tag>
              ))}
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

            {/* V10 A7：把本次问数结果添加到报表中心 */}
            {meta.sql && (
              <div>
                <Button
                  size="small"
                  icon={<FileAddOutlined />}
                  onClick={() => {
                    setSaveTarget({ sql: String(meta.sql), answer: String(m.content || ''), rowCount: Number(meta.rowCount) || 0 });
                    setSaveName(`问数报表 ${new Date().toLocaleDateString('zh-CN')}`);
                    setSaveDesc(String(m.content || '').slice(0, 120));
                    setSaveType('table');
                    setSaveOpen(true);
                  }}
                >
                  添加到报表中心
                </Button>
              </div>
            )}

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
                  /**
         * V10 A5：修掉「表格自动拉宽列宽」的 bug。
         * 原来 x: 'max-content' 会让表格按最宽单元格无限撑开，长文本列把整表拉爆。
         * 改为按列数估算的固定宽度，超出部分在容器内横向滚动。
         */
        scroll={{ x: Math.max(640, Math.min((tableColumns.length || 6) * 140, 1600)), y: 300 }}
        tableLayout="fixed"
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
                  {/* 浅底 + 同色字：原先白字叠 antd tinted 底（浅绿/浅红），对比度约 1.1:1，几乎看不见 */}
                  <Tag
                    bordered={false}
                    style={{
                      background: ok ? `${PALETTE.green}26` : `${PALETTE.red}26`,
                      color: ok ? PALETTE.green : PALETTE.red,
                      marginInlineEnd: 0,
                    }}
                  >
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

  /**
   * V13 B4：术语配置 / SQL 示例库改为**同级标签页**（用户原话：「AI问数优化：
   * 术语配置、SQL 示例库等设置项通过标签页的方式放在 AI 问数下」）。
   *
   * 根因：这两项此前是 Page 顶栏两个按钮 + 各自一个 Drawer，与「对话」主界面
   * 属于**不同层级**（一个是页面、一个是浮层）—— 用户看不出「它们是 AI 问数的一部分」，
   * 而且改完必须手动关闭抽屉才能回到对话，缺少任务连续性。
   *
   * 现在改为与「对话」并列的 Tab：内容片段原样搬过来（功能、接口、校验全不变），
   * 只是从 Drawer body 变成 Tab children；原来打开 Drawer 时的 loadTerms/loadExamples
   * 改由切 Tab 时触发（见下方 onTabChange）。
   */
  const termPanel = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: NEUTRAL.textSecondary }}>
        术语会注入 AI 的提示词，让模型正确理解业务说法（如「南区」「高净值会员」）。
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
        <Input placeholder="术语名（如：南区）" value={termForm.term} onChange={(e) => setTermForm({ ...termForm, term: e.target.value })} />
        <Input placeholder="分类（可选，如：区域）" value={termForm.category} onChange={(e) => setTermForm({ ...termForm, category: e.target.value })} />
      </div>
      <Input placeholder="别名（逗号分隔，如：南边,南方）" value={termForm.aliases} onChange={(e) => setTermForm({ ...termForm, aliases: e.target.value })} />
      <Input.TextArea placeholder="定义（如：区域字段为「南区」的连锁）" rows={2} value={termForm.definition} onChange={(e) => setTermForm({ ...termForm, definition: e.target.value })} />
      <Button type="primary" loading={termBusy} onClick={createTerm}>添加术语</Button>
      <div style={{ borderTop: `1px solid ${NEUTRAL.border}`, paddingTop: 12 }}>
        <div style={{ fontSize: 12, color: NEUTRAL.textSecondary, marginBottom: 8 }}>
          已有术语（{termList.length} 条）
        </div>
        {termList.length === 0 ? (
          <div style={{ fontSize: 12, color: NEUTRAL.textTertiary, padding: '12px 0' }}>暂无术语</div>
        ) : termList.map((t) => (
          <div key={String(t.id)} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 0', borderBottom: `1px solid ${NEUTRAL.border}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: NEUTRAL.text }}>
                {String(t.term || '')}
                {t.category ? <span style={{ fontSize: 11, color: NEUTRAL.textTertiary, marginLeft: 6 }}>[{String(t.category)}]</span> : null}
              </div>
              <div style={{ fontSize: 12, color: NEUTRAL.textSecondary, marginTop: 2 }}>{String(t.definition || '')}</div>
              {t.aliases ? <div style={{ fontSize: 11, color: NEUTRAL.textTertiary, marginTop: 2 }}>别名：{String(t.aliases)}</div> : null}
            </div>
            <Button size="small" danger type="text" onClick={() => removeTerm(Number(t.id))}>删除</Button>
          </div>
        ))}
      </div>
    </div>
  );

  const exPanel = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: NEUTRAL.textSecondary }}>
        示例会按问题相似度挑选最相关的几条注入提示词，让模型模仿正确写法。
      </div>
      <Input placeholder="示例问题（如：本月新增了多少客户？）" value={exForm.question} onChange={(e) => setExForm({ ...exForm, question: e.target.value })} />
      <Input.TextArea placeholder="参考 SQL" rows={4} value={exForm.sql} onChange={(e) => setExForm({ ...exForm, sql: e.target.value })}
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }} />
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
        <Input placeholder="说明（可选）" value={exForm.description} onChange={(e) => setExForm({ ...exForm, description: e.target.value })} />
        <Input placeholder="标签（逗号分隔）" value={exForm.tags} onChange={(e) => setExForm({ ...exForm, tags: e.target.value })} />
      </div>
      <Button type="primary" loading={exBusy} onClick={createExample}>添加示例</Button>
      <div style={{ borderTop: `1px solid ${NEUTRAL.border}`, paddingTop: 12 }}>
        <div style={{ fontSize: 12, color: NEUTRAL.textSecondary, marginBottom: 8 }}>
          已有示例（{exList.length} 条）
        </div>
        {exList.length === 0 ? (
          <div style={{ fontSize: 12, color: NEUTRAL.textTertiary, padding: '12px 0' }}>暂无示例</div>
        ) : exList.map((e) => (
          <div key={String(e.id)} style={{ padding: '10px 0', borderBottom: `1px solid ${NEUTRAL.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: NEUTRAL.text }}>{String(e.question || '')}</div>
              <span style={{ fontSize: 11, color: NEUTRAL.textTertiary }}>命中 {String(e.useCount || 0)} 次</span>
              <Button size="small" danger type="text" onClick={() => removeExample(Number(e.id))}>删除</Button>
            </div>
            <pre style={{ margin: '6px 0 0', padding: 8, borderRadius: 6, background: NEUTRAL.surfaceSunken, fontSize: 11.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 120, overflow: 'auto' }}>
              {String(e.sql || '')}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );

  /** V13 B4：进入术语 / 示例标签页时按需加载（替代原来「打开 Drawer 时加载」） */
  const onAiTabChange = (k: string) => {
    setAiTab(k);
    if (k === 'terms') void loadTerms();
    if (k === 'examples') void loadExamples();
  };

  const aiTabItems = [
    { key: 'chat', label: pageTabLabel(<MessageOutlined />, '对话') },
    { key: 'terms', label: pageTabLabel(<BookOutlined />, '术语配置', termList.length ? <PageTabTag color={PALETTE.primary}>{termList.length}</PageTabTag> : undefined) },
    { key: 'examples', label: pageTabLabel(<CodeOutlined />, 'SQL 示例库', exList.length ? <PageTabTag color={PALETTE.primary}>{exList.length}</PageTabTag> : undefined) },
  ];

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
        {lastFailure.kind === 'noscope' ? (
          <Button type="primary" size="small" icon={<DatabaseOutlined />} onClick={useDefaultScope}>
            使用默认数据范围
          </Button>
        ) : null}
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
    <>
      {/* V10 A7：保存问数结果到报表中心 */}
      <Modal
        title="添加到报表中心"
        open={saveOpen}
        onCancel={() => setSaveOpen(false)}
        onOk={submitToReport}
        okText="保存"
        cancelText="取消"
        confirmLoading={saveBusy}
        width={520}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: NEUTRAL.textSecondary, marginBottom: 4 }}>报表名称</div>
            <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="请输入报表名称" />
          </div>
          <div>
            <div style={{ fontSize: 12, color: NEUTRAL.textSecondary, marginBottom: 4 }}>说明（可选）</div>
            <Input.TextArea value={saveDesc} onChange={(e) => setSaveDesc(e.target.value)} rows={3} placeholder="这条报表的用途或口径说明" />
          </div>
          <div>
            <div style={{ fontSize: 12, color: NEUTRAL.textSecondary, marginBottom: 4 }}>展示方式</div>
            <Space>
              <Button type={saveType === 'table' ? 'primary' : 'default'} onClick={() => setSaveType('table')}>表格</Button>
              <Button type={saveType === 'chart' ? 'primary' : 'default'} onClick={() => setSaveType('chart')}>图表</Button>
            </Space>
          </div>
          {saveTarget && (
            <div style={{ fontSize: 11, color: NEUTRAL.textTertiary }}>
              含 {saveTarget.rowCount} 行数据 · SQL 将一并保存
            </div>
          )}
        </div>
      </Modal>
      {/* V13 B4：术语配置 / SQL 示例库 已改为同级标签页（见下方 Page 的 subTabs），
          原来两个 Drawer 已删除，避免同一功能存在两套入口。内容见上方 termPanel / exPanel。 */}

      <Page
      title="AI 问数"

      search={
        <Select
          ref={scopeSelectRef}
          mode="multiple"
          allowClear
          loading={scopeLoading}
          value={scope.map((s) => scopeRefKey(s))}
          onChange={onScopeChange}
          placeholder={scopeLoading ? '正在加载数据范围…' : '选择要问数的数据范围'}
          style={{ width: isMobile ? '100%' : 320 }}
          size={isMobile ? 'large' : 'middle'}
          showSearch
          optionFilterProp="label"
          maxTagCount={isMobile ? 1 : 2}
          suffixIcon={<DatabaseOutlined />}
          status={scope.length ? undefined : 'warning'}
          title={scopeNames.join('、') || '请选择数据范围'}
          options={scopeSelectOptions as never}
          notFoundContent={scopeLoading ? <Spin size="small" /> : '没有可用的数据范围'}
        />
      }
      extra={
        <Space size={8} wrap>
          {/*
            V13 B3 + B4：顶栏按钮收敛。
            · 「术语配置」「SQL 示例库」→ 已改为同级标签页（见 subTabs），按钮删除。
            · 「分享管理」→ 分享统一到「分享中心」，本页不再提供列表管理入口。
            · 「分享」保留为创建入口，但点击后**跳到分享中心**，不在本页弹创建 Modal
              （用户原话：「报表中心和 AI 问数的分享都统一放到分享中心」）。
          */}
          <Tooltip title="AI 问数的分享统一在「分享中心 → AI 问数分享」中创建与管理">
            <Button
              type="primary"
              icon={<ShareAltOutlined />}
              onClick={goShareCentre}
            >
              分享
            </Button>
          </Tooltip>
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
      subTabs={<PageTabs activeKey={aiTab} onChange={onAiTabChange} items={aiTabItems} />}
    >
      {aiTab === 'terms' ? termPanel : aiTab === 'examples' ? exPanel : (
      <>
      {errorCard}

      {/* 数据范围状态条：始终告诉用户「这份问答问的是哪份数据」 */}
      {!scopeLoading && (
        <div
          style={{
            marginBottom: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            fontSize: 12,
            color: NEUTRAL.textSecondary,
          }}
        >
          <DatabaseOutlined />
          <span>数据范围：</span>
          {scope.length ? (
            <Space size={4} wrap>
              {scope.map((s) => (
                <Tag key={scopeRefKey(s)} bordered={false} style={{ background: PALETTE.primarySoft, color: PALETTE.primaryDeep, marginInlineEnd: 0 }}>
                  {scopeOptionMap.get(scopeRefKey(s))?.name || `${s.kind}#${s.id}`}
                  {scopeOptionMap.get(scopeRefKey(s))?.rowCount
                    ? ` · ${fmtNum(scopeOptionMap.get(scopeRefKey(s))!.rowCount)} 行`
                    : ''}
                </Tag>
              ))}
            </Space>
          ) : (
            <span style={{ color: PALETTE.orange }}>未选择（提问前请先选择，否则无法问数）</span>
          )}
          {!scope.length && countUsableOptions(scopeOptions) > 0 && (
            <Button size="small" type="primary" onClick={useDefaultScope}>
              使用默认范围
            </Button>
          )}
        </div>
      )}

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
                {!scopeLoading && countUsableOptions(scopeOptions) === 0 && (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginTop: 14 }}
                    message="还没有可用的数据范围"
                    description="AI 问数需要一个有效的数据来源（数据集 / 数据项目 / 邮件推送 / 流程产出）来提供字段上下文，请先在「数据集」或「数据项目」页面准备数据。"
                  />
                )}
                {!scopeLoading && countUsableOptions(scopeOptions) > 0 && !scope.length && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginTop: 14 }}
                    message="还没有选择数据范围"
                    description="请在上方「数据范围」中选择要问的数据来源，或点击右侧按钮直接使用默认范围。"
                    action={
                      <Button size="small" type="primary" icon={<DatabaseOutlined />} onClick={useDefaultScope}>
                        使用默认范围
                      </Button>
                    }
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
                <span>数据范围：{scopeLabel}</span>
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
                <Tooltip title={scopeNames.length > 1 ? scopeNames.join('、') : scopeLabel}>
                  <Tag
                    bordered={false}
                    style={{
                      background: scope.length ? PALETTE.primarySoft : `${PALETTE.yellow}26`,
                      color: scope.length ? PALETTE.primaryDeep : PALETTE.orange,
                      marginInlineEnd: 0,
                    }}
                  >
                    <DatabaseOutlined /> {scope.length ? scopeLabel : '未选范围'}
                  </Tag>
                </Tooltip>
              }
              suffix={(_, info) => {
                const { SendButton, LoadingButton } = info.components;
                if (sending) return <LoadingButton type="default" />;
                const noScope = !scope.length;
                const btn = (
                  <SendButton
                    type="primary"
                    icon={<SendOutlined />}
                    disabled={!input.trim() || noScope}
                  />
                );
                return (
                  <Tooltip title={noScope ? '请先选择数据范围' : '发送（Enter）'}>
                    {noScope ? (
                      /* 禁用按钮不触发点击：套一层 span 接住，点下去有明确引导（不是「无反应」） */
                      <span
                        onClick={warnNoScope}
                        style={{ display: 'inline-flex', cursor: 'not-allowed' }}
                      >
                        {btn}
                      </span>
                    ) : btn}
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


      {/* V13 B3：分享创建弹窗与分享管理抽屉已删除 ——
          AI 问数的分享统一到「分享中心 → AI 问数分享」管理（/shares?tab=ai）。
          本页不再出现任何分享列表管理界面。 */}

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
      </>
      )}
    </Page>
    </>
  );
}