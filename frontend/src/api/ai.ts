/**
 * AI 问数 API 封装
 *
 * 契约来源：src/ai.js + src/routes/api.js（已实机核对）
 *   POST /api/ai/ask    普通 JSON 响应（非流式）：{ ok, sessionKey, question, sql, datasetId,
 *                      datasetName, answer, rows, columns, rowCount, duration, model }
 *   GET  /api/ai/chats  历史问数记录（DB 原始行，snake_case）
 *   GET  /api/ai/providers  供应商预设（无需登录）
 *
 * 注意：后端 ask 内部会「生成 SQL → 执行 → 自然语言解读」，单次耗时 3~20s，
 * 前端必须展示 loading 态，不能按流式逐字渲染。
 */
import { api, qs, ApiError } from '@/api/client';
import type { DatasetColumn, RowData } from '@/api/reports';

export interface AiAskPayload {
  question: string;
  /** V8：数据范围（数据集 / 数据项目 / 邮件推送 / 流程产出），必填非空 */
  scope?: AiScopeRef[];
  /** 向后兼容：等价于 scope=[{kind:'dataset', id}]，V8 起前端优先用 scope */
  datasetId?: number;
  sessionKey?: string;
  /** 便捷上下文：最近 4 轮对话（后端仅取 role/content） */
  history?: { role: 'user' | 'assistant' | 'system'; content: string }[];
}

export interface AiAskResult {
  ok: boolean;
  sessionKey: string;
  question: string;
  /** 后端生成并由只读校验通过的 SQL */
  sql: string;
  datasetId: number;
  datasetName: string;
  /** V8：本次实际用到的数据来源 */
  sources?: AiSourceRef[];
  /** 自然语言解读 */
  answer: string;
  rows: RowData[];
  columns: DatasetColumn[];
  rowCount: number;
  duration: number;
  model: string;
}

/** 历史问数记录（后端返回数据库原始行，字段为 snake_case） */
export interface AiChatRecord {
  id: number;
  user_id?: number;
  session_key?: string;
  question: string;
  answer?: string | null;
  sql_text?: string | null;
  dataset_id?: number | null;
  result_rows?: number;
  success?: number | boolean;
  message?: string | null;
  duration_ms?: number | null;
  created_at?: string;
}

/**
 * 向 AI 提问
 * silent: true —— 错误由调用方在对话流内展示，避免与气泡重复提示
 */
export async function askAi(payload: AiAskPayload): Promise<AiAskResult> {
  return api.post<AiAskResult>('/ai/ask', payload, { silent: true });
}

/** 历史问数记录（可按会话过滤） */
export function listAiChats(sessionKey?: string, limit = 50): Promise<AiChatRecord[]> {
  return api.get<AiChatRecord[]>('/ai/chats' + qs({ sessionKey, limit }), { silent: true });
}

export interface AiProvider {
  key: string;
  name: string;
  baseUrl: string;
  models: { key: string; name: string; default?: boolean }[];
  keyUrl?: string | null;
  note?: string;
  custom?: boolean;
  noKey?: boolean;
}

/** AI 供应商预设（用于空态说明，无需登录） */
export function listAiProviders(): Promise<AiProvider[]> {
  return api.get<AiProvider[]>('/ai/providers', { silent: true });
}

/* ══════════════ 错误分类 ══════════════
 * 后端 /ai/ask 的失败原因差异很大，前端不能一律当「网络错误」：
 *   - 未启用 / 未配置密钥  → 属于「配置没做」，应引导去系统设置（需要 settings:write）
 *   - 暂无可用数据集      → 属于「数据没准备」，应引导去数据集页面（需要 dataset:write）
 *   - 网络 / 超时 / SQL 异常 → 属于「这次没跑通」，应允许原地重试
 * 分类只影响提示与行动按钮，不改变任何后端行为。
 */

export type AiErrorKind =
  | 'disabled'
  | 'nokey'
  | 'noscope'
  | 'nodataset'
  | 'network'
  | 'auth'
  | 'other';

export interface AiFailure {
  kind: AiErrorKind;
  /** 一句话结论（气泡/提示卡标题） */
  title: string;
  /** 可展示给用户的明细（后端原文） */
  detail: string;
  /** 是否属于「配置未完成」，可跳系统设置 */
  config: boolean;
  /** 是否属于「缺数据集」，可跳数据集页 */
  dataset: boolean;
  /** 无权限的旁路说明，用于文案兜底 */
  hint: string;
}

/** 把 askAi 抛出的异常归类成用户可理解的失败类型 */
export function classifyAiError(e: unknown): AiFailure {
  const detail =
    (e instanceof Error ? e.message : '') || (typeof e === 'string' ? e : '') || 'AI 问数失败';
  const status = e instanceof ApiError ? e.status : undefined;
  const text = String(detail);

  /** 配置类：关闭了开关 / 没填接口地址或密钥 */
  if (/未启用|未开启|请先在系统设置中开启/.test(text)) {
    return {
      kind: 'disabled',
      title: 'AI 问数尚未启用',
      detail: text,
      config: true,
      dataset: false,
      hint: '需要管理员在「系统设置 → AI 问数」中开启，并填写模型接口地址与密钥。',
    };
  }
  if (/未配置/.test(text) && /(密钥|接口|key|地址)/i.test(text)) {
    return {
      kind: 'nokey',
      title: 'AI 接口还没配置好',
      detail: text,
      config: true,
      dataset: false,
      hint: '需要管理员在「系统设置 → AI 问数」中补齐接口地址 / 密钥后重试。',
    };
  }
  /**
   * 范围类：请求里没有任何数据范围（V8 起后端强制要求 scope 非空）
   * 这不是「数据没准备」，而是「用户没选」，所以给的是选择引导而不是去建数据集。
   */
  if (/请先选择.*数据范围|请选择.*数据范围|data scope is required/i.test(text)) {
    return {
      kind: 'noscope',
      title: '还没有选择数据范围',
      detail: text,
      config: false,
      dataset: false,
      hint: 'AI 问数必须知道「问哪份数据」：请在上方「数据范围」中选择数据集 / 数据项目 / 邮件推送 / 流程产出，再提问。',
    };
  }
  /** 数据类：没有任何可用数据集 */
  if (/暂无可用数据集|数据集不存在|请先在.*数据集/.test(text)) {
    return {
      kind: 'nodataset',
      title: '还没有可用的数据集',
      detail: text,
      config: false,
      dataset: true,
      hint: 'AI 问数依赖数据集的字段上下文，请先在「报表中心 → 数据集」创建数据集。',
    };
  }
  if (status === 401 || /登录已失效/.test(text)) {
    return {
      kind: 'auth',
      title: '登录状态已失效',
      detail: text,
      config: false,
      dataset: false,
      hint: '请重新登录后再试。',
    };
  }
  if (status === 0 || /网络请求失败|Failed to fetch|timeout|超时/i.test(text)) {
    return {
      kind: 'network',
      title: '网络请求失败',
      detail: text,
      config: false,
      dataset: false,
      hint: '请检查网络或稍后重试；AI 问数单次查询通常需要 3~20 秒。',
    };
  }
  return {
    kind: 'other',
    title: '本次问数没有完成',
    detail: text,
    config: false,
    dataset: false,
    hint: '可以换个问法，或稍后重试。',
  };
}

/* ══════════════════════════════════════════════════════════════════
 * V8：AI 数据范围（scope）
 *
 * 契约来源：CONTRACT.md §2、§3（GET /api/ai/scope-options）
 *   { datasets: [], projects: [], mails: [], flows: [] }
 *   每项 { kind, id, name, table, columns:[{name,type}], rowCount, invalid?, reason? }
 *
 * 说明：后端结构可能随实现微调（字段名 snake_case / rowCount 缺省等），
 * 因此这里统一走 normalizeScopeOptions() 归一化，页面不直接吃原始 JSON。
 * ══════════════════════════════════════════════════════════════════ */

export type AiScopeKind = 'dataset' | 'project' | 'mail' | 'flow';

/** 范围来源顺序 = 弹窗分组顺序（数据集 / 数据项目 / 邮件推送 / 流程产出） */
export const SCOPE_KINDS: AiScopeKind[] = ['dataset', 'project', 'mail', 'flow'];

/** 分组中文名（页面与公开页共用，避免各写一份） */
export const SCOPE_KIND_LABEL: Record<AiScopeKind, string> = {
  dataset: '数据集',
  project: '数据项目',
  mail: '邮件推送',
  flow: '流程产出',
};

export interface AiScopeColumn {
  name: string;
  type?: string;
}

/** 一个可问数的数据来源（归一化后的统一结构） */
export interface AiScopeOption {
  kind: AiScopeKind;
  id: number;
  name: string;
  table?: string;
  columns: AiScopeColumn[];
  rowCount: number;
  /** 坏源：不可选，需展示 reason */
  invalid?: boolean;
  reason?: string;
  tableType?: string;
}

export interface AiScopeOptions {
  datasets: AiScopeOption[];
  projects: AiScopeOption[];
  mails: AiScopeOption[];
  flows: AiScopeOption[];
  /** 单次问数最多可选来源数（服务端下发，默认 8） */
  maxSources: number;
  /** AI 问数总开关（服务端下发） */
  enabled: boolean;
}

/** 提交给后端的范围引用 */
export interface AiScopeRef {
  kind: AiScopeKind;
  id: number;
  tableType?: string;
}

/** 响应里回显的数据来源（/ai/ask 的 sources） */
export interface AiSourceRef {
  kind: AiScopeKind | string;
  id?: number;
  name: string;
  table?: string;
  rowCount?: number;
}

/** 范围唯一键：用 kind:id，避免不同来源 id 撞号 */
export function scopeKey(kind: AiScopeKind | string, id: number | string): string {
  return `${kind}:${id}`;
}

/** 范围引用 → 唯一键 */
export function scopeRefKey(r: AiScopeRef): string {
  return scopeKey(r.kind, r.id);
}

export function isScopeKind(v: unknown): v is AiScopeKind {
  return typeof v === 'string' && (SCOPE_KINDS as string[]).includes(v);
}

function toNum(v: unknown, dft = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : dft;
}

function normColumn(raw: unknown): AiScopeColumn | null {
  const o = (raw || {}) as Record<string, unknown>;
  const name = o.name ?? o.field ?? o.title;
  if (name === undefined || name === null || name === '') return null;
  const type = o.type ?? o.dataType ?? o.data_type;
  return { name: String(name), type: type === undefined || type === null ? undefined : String(type) };
}

/** 单个来源归一化：容忍 snake_case / 缺字段 / columns|fields 两种写法 */
export function normalizeScopeOption(raw: unknown, kind: AiScopeKind): AiScopeOption {
  const o = (raw || {}) as Record<string, unknown>;
  const colsRaw = (Array.isArray(o.columns) ? o.columns : Array.isArray(o.fields) ? o.fields : []) as unknown[];
  const columns = colsRaw.map(normColumn).filter((c): c is AiScopeColumn => !!c);
  const invalid = o.invalid === true || o.valid === false;
  return {
    kind: isScopeKind(o.kind) ? (o.kind as AiScopeKind) : kind,
    id: toNum(o.id),
    name: String(o.name ?? o.title ?? (o.id !== undefined ? `#${String(o.id)}` : '未命名来源')),
    table: o.table ? String(o.table) : undefined,
    columns,
    rowCount: toNum(o.rowCount ?? o.row_count ?? o.rows),
    ...(invalid ? { invalid: true } : {}),
    reason: o.reason ? String(o.reason) : undefined,
    tableType: o.tableType ? String(o.tableType) : undefined,
  };
}

/** 四个分组统一归一化（缺组补空数组，坏 JSON 不炸页面） */
export function normalizeScopeOptions(raw: unknown): AiScopeOptions {
  const src = (raw || {}) as Record<string, unknown>;
  const pick = (kind: AiScopeKind, key: string): AiScopeOption[] => {
    const list = src[key];
    if (!Array.isArray(list)) return [];
    return list.map((it) => normalizeScopeOption(it, kind));
  };
  /** 服务端下发 maxSources（默认 8）；enabled 缺省视为 true */
  const maxRaw = toNum(src.maxSources ?? src.max_sources, 8);
  const enabled = src.enabled === false || toNum(src.enabled) === 0 ? false : true;
  return {
    datasets: pick('dataset', 'datasets'),
    projects: pick('project', 'projects'),
    mails: pick('mail', 'mails'),
    flows: pick('flow', 'flows'),
    maxSources: maxRaw > 0 ? maxRaw : 8,
    enabled,
  };
}

/** 取某一分组的候选列表 */
export function scopeGroup(options: AiScopeOptions | null | undefined, kind: AiScopeKind): AiScopeOption[] {
  if (!options) return [];
  switch (kind) {
    case 'dataset':
      return options.datasets;
    case 'project':
      return options.projects;
    case 'mail':
      return options.mails;
    case 'flow':
      return options.flows;
    default:
      return [];
  }
}

/** 可选来源总数（不含坏源） */
export function countUsableOptions(options: AiScopeOptions | null | undefined): number {
  return SCOPE_KINDS.reduce((sum, k) => sum + scopeGroup(options, k).filter((o) => !o.invalid).length, 0);
}

/** 可选数据范围（需登录，ai:use） */
export async function getAiScopeOptions(): Promise<AiScopeOptions> {
  const raw = await api.get<AiScopeOptions>('/ai/scope-options', { silent: true });
  return normalizeScopeOptions(raw);
}

/* ══════════════════════════════════════════════════════════════════
 * V8：AI 分享（需登录，ai:use / ai:share）
 *   GET    /api/ai/shares
 *   POST   /api/ai/shares          { title, scope, password?, expiresDays?, allowExport? }
 *   PATCH  /api/ai/shares/:id      { status }
 *   DELETE /api/ai/shares/:id
 * 公开（无需登录，必须用裸 fetch，绝不能用 api.*，否则 401 会把访客踢回登录页）
 *   GET  /api/public/ai-shares/:token?pwd=
 *   POST /api/public/ai-shares/:token/ask
 * ══════════════════════════════════════════════════════════════════ */

export interface AiShareItem {
  id: number;
  token: string;
  title: string;
  /** 完整分享链接（后端给；没给则前端按 origin + /a/token 兜底） */
  url: string;
  /** 1 启用 / 0 停用 */
  status: number;
  allowExport: boolean;
  expiresAt?: string | null;
  viewCount: number;
  askCount: number;
  lastAskAt?: string | null;
  createdAt?: string;
  hasPassword: boolean;
  /** 分享包含的范围（列表接口不一定回传，缺省为空数组） */
  scope: AiScopeRef[];
}

export interface AiShareCreatePayload {
  title: string;
  scope: AiScopeRef[];
  /** 访问密码，可空 */
  password?: string;
  /** 有效期天数，0 = 永久 */
  expiresDays?: number;
  allowExport?: boolean;
}

/** 公开分享地址（后端没给 url 时的兜底，与服务端 §3.2 的 `url` 规则一致） */
export function aiShareUrl(token: string): string {
  const t = String(token || '').trim();
  if (!t) return '';
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
  return `${origin}/a/${encodeURIComponent(t)}`;
}

/** 分享记录归一化：兼容 snake_case 与 camelCase */
export function normalizeShareItem(raw: unknown): AiShareItem {
  const o = (raw || {}) as Record<string, unknown>;
  const token = o.token === undefined || o.token === null ? '' : String(o.token);
  const scopeRaw = (Array.isArray(o.scope) ? o.scope : Array.isArray(o.scopeList) ? o.scopeList : []) as unknown[];
  const scope: AiScopeRef[] = [];
  for (const it of scopeRaw) {
    const r = (it || {}) as Record<string, unknown>;
    if (!isScopeKind(r.kind)) continue;
    const id = toNum(r.id, NaN);
    if (!Number.isFinite(id)) continue;
    scope.push({
      kind: r.kind as AiScopeKind,
      id,
      ...(r.tableType ? { tableType: String(r.tableType) } : {}),
    });
  }
  const rawUrl = o.url === undefined || o.url === null ? '' : String(o.url);
  const allowExport = o.allowExport === true || toNum(o.allowExport ?? 0) === 1;
  return {
    id: toNum(o.id),
    token,
    title: String(o.title ?? ''),
    url: rawUrl || aiShareUrl(token),
    status: toNum(o.status, 1) === 0 ? 0 : 1,
    allowExport,
    expiresAt: (o.expiresAt ?? o.expires_at ?? null) as string | null,
    viewCount: toNum(o.viewCount ?? o.view_count),
    askCount: toNum(o.askCount ?? o.ask_count),
    lastAskAt: (o.lastAskAt ?? o.last_ask_at ?? null) as string | null,
    createdAt: (o.createdAt ?? o.created_at ?? undefined) as string | undefined,
    hasPassword: o.hasPassword === true || o.password === true || !!o.password_plain,
    scope,
  };
}

/** 创建分享 */
export async function createAiShare(payload: AiShareCreatePayload): Promise<AiShareItem> {
  const raw = await api.post<unknown>('/ai/shares', {
    title: payload.title,
    scope: payload.scope,
    ...(payload.password ? { password: payload.password } : {}),
    expiresDays: payload.expiresDays ?? 0,
    allowExport: !!payload.allowExport,
  }, { silent: true });
  return normalizeShareItem(raw);
}

/** 分享列表（后端可能返回数组或 { list: [] }） */
export async function listAiShares(): Promise<AiShareItem[]> {
  const raw = await api.get<unknown>('/ai/shares', { silent: true });
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown> | null)?.list)
      ? ((raw as Record<string, unknown>).list as unknown[])
      : [];
  return list.map(normalizeShareItem);
}

/** 启用 / 停用分享 */
export async function setAiShareStatus(id: number, status: number): Promise<AiShareItem | null> {
  const raw = await api.patch<unknown>(`/ai/shares/${id}`, { status: status ? 1 : 0 }, { silent: true });
  if (!raw || typeof raw !== 'object') return null;
  return normalizeShareItem(raw);
}

/** 删除分享 */
export async function removeAiShare(id: number): Promise<void> {
  await api.delete<unknown>(`/ai/shares/${id}`, { silent: true });
}

/* ── 公开分享：裸 fetch（不带 /api 客户端的 401 处理） ── */

export type AiPublicErrorCode =
  | 'not_found'
  | 'expired'
  | 'disabled'
  | 'password'
  | 'rate_limited'
  | 'network'
  | 'other';

export class AiPublicError extends Error {
  status: number;
  code: AiPublicErrorCode;
  needPassword: boolean;
  constructor(msg: string, status: number, code: AiPublicErrorCode, needPassword = false) {
    super(msg);
    this.name = 'AiPublicError';
    this.status = status;
    this.code = code;
    this.needPassword = needPassword;
  }
}

export interface PublicAiShareSource {
  kind: AiScopeKind | string;
  name: string;
  rowCount?: number;
}

export interface PublicAiShareMeta {
  ok: boolean;
  title: string;
  /**
   * 该分享**设置了**访问密码（服务端语义：不是「尚未验证」）。
   * 是否已解锁看 `locked`（= needPassword 且未拿到 sources）。
   */
  needPassword: boolean;
  /** 仍处于未解锁状态：需要渲染密码输入卡片 */
  locked: boolean;
  /** 密码不正确（服务端 passwordError=true）；解锁失败提示用 */
  passwordError?: string;
  /** 可用数据概览（未解锁时为空数组，不含表名与 SQL） */
  sources: PublicAiShareSource[];
  welcome?: string;
  allowExport: boolean;
  /** 公开问数是否开启（服务端开关 ai_public_ask_enabled） */
  askEnabled: boolean;
  expiresAt?: string | null;
}

export interface PublicAiAskPayload {
  question: string;
  pwd?: string;
  sessionKey?: string;
  history?: { role: 'user' | 'assistant' | 'system'; content: string }[];
}

/** 公开问数结果：**不含 sql**（服务端刻意不给，避免泄露表结构） */
export interface PublicAiAskResult {
  ok: boolean;
  sessionKey: string;
  question: string;
  answer: string;
  rows: RowData[];
  columns: DatasetColumn[];
  rowCount: number;
  /** 服务端是否因行数上限截断（公开接口上限 min(ai_max_rows,200)） */
  truncated: boolean;
  duration: number;
  model: string;
  sources: PublicAiShareSource[];
  allowExport: boolean;
}

const PUBLIC_AI_BASE = '/api/public/ai-shares';

interface PublicRawResult {
  status: number;
  /**
   * 归一化后的业务负载。
   *
   * ⚠️ 后端公开接口与 /api/* 一样包了一层 `{ ok, data: {...} }`，
   * 而**裸 fetch 不会替我们解包**（只有 api.* 的 request() 会）。
   * 之前没解包导致页面拿到 undefined 的 sources → 误判「该分享暂无可问数的数据来源」。
   * 出错时没有 data 字段，json 本身就是 `{ok:false, code, message}`。
   */
  json: Record<string, any> | null;
}

/**
 * 公开接口请求：**裸 fetch**，不带任何鉴权、不触发全局 401 跳转。
 * （参考 api/forms.ts 的 publicFetch 写法）
 *
 * 返回值已解包 `data`：成功时是内层业务对象，失败时是外层 `{ok:false, code, message}`。
 */
async function publicAiRaw(path: string, init?: RequestInit): Promise<PublicRawResult> {
  let res: Response;
  try {
    res = await fetch(PUBLIC_AI_BASE + path, { credentials: 'same-origin', ...init });
  } catch {
    throw new AiPublicError('网络请求失败，请检查网络连接', 0, 'network');
  }
  let raw: Record<string, any> | null = null;
  try {
    raw = (await res.json()) as Record<string, any>;
  } catch {
    raw = null;
  }
  if (!raw) return { status: res.status, json: null };

  const inner =
    raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)
      ? (raw.data as Record<string, any>)
      : null;

  /* 失败响应没有 data：外层 code/message/ok 原样带回，供错误映射使用 */
  if (!inner) return { status: res.status, json: raw };

  /* 成功响应：以内层业务字段为主，外层缺省字段（ok/code/message）兜底 */
  return {
    status: res.status,
    json: {
      ...inner,
      ...(inner.ok === undefined && raw.ok !== undefined ? { ok: raw.ok } : {}),
      ...(inner.code === undefined && raw.code !== undefined ? { code: raw.code } : {}),
      ...(inner.message === undefined && raw.message !== undefined ? { message: raw.message } : {}),
    },
  };
}

function mapPublicErrorCode(status: number, json: Record<string, any> | null): AiPublicErrorCode {
  const code = String(json?.code ?? '').toLowerCase();
  if (code === 'not_found' || code === 'invalid' || code === 'gone') {
    return code === 'gone' ? 'expired' : 'not_found';
  }
  if (code === 'expired' || code === 'expire') return 'expired';
  if (code === 'disabled' || code === 'stopped') return 'disabled';
  if (code === 'password' || code === 'invalid_password' || code === 'wrong_password') return 'password';
  if (code === 'rate_limited' || code === 'too_many_requests') return 'rate_limited';
  if (status === 404) return 'not_found';
  if (status === 410) return 'expired';
  if (status === 403) return 'disabled';
  if (status === 401) return 'password';
  if (status === 429) return 'rate_limited';
  if (status === 0) return 'network';
  return 'other';
}

/** 公开分享各种失败的中文文案（需求要求「明确提示」） */
export const PUBLIC_AI_ERROR_TEXT: Record<AiPublicErrorCode, { title: string; hint: string }> = {
  not_found: { title: '链接不存在', hint: '该分享链接不存在或已被删除，请向分享者确认链接是否完整。' },
  expired: { title: '链接已过期', hint: '分享链接已超过有效期，请联系分享者重新生成一条分享。' },
  disabled: { title: '分享已停用', hint: '分享者已停用该链接，暂不可访问；如需继续使用请联系分享者重新启用。' },
  password: { title: '密码不正确', hint: '请输入正确的访问密码后重试。' },
  rate_limited: { title: '访问过于频繁', hint: '请稍等约一分钟后再试。' },
  network: { title: '网络请求失败', hint: '请检查网络连接后重试。' },
  other: { title: '无法打开该分享', hint: '请稍后重试；若持续失败请联系分享者。' },
};

/** 把公开接口异常翻译成「标题 + 明细 + 建议」（页面直接渲染） */
export function publicShareErrorInfo(e: unknown): {
  code: AiPublicErrorCode;
  title: string;
  detail: string;
  hint: string;
} {
  const code: AiPublicErrorCode = e instanceof AiPublicError ? e.code : 'other';
  const base = PUBLIC_AI_ERROR_TEXT[code] || PUBLIC_AI_ERROR_TEXT.other;
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const detail = raw && raw !== base.title ? raw : '';
  return { code, title: base.title, detail, hint: base.hint };
}

function normPublicSources(raw: unknown): PublicAiShareSource[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((it) => {
      const o = (it || {}) as Record<string, unknown>;
      const name = o.name ?? o.title;
      if (name === undefined || name === null) return null;
      const rowCount = o.rowCount ?? o.row_count;
      return {
        kind: isScopeKind(o.kind) ? (o.kind as AiScopeKind) : String(o.kind ?? 'dataset'),
        name: String(name),
        ...(rowCount === undefined || rowCount === null ? {} : { rowCount: toNum(rowCount) }),
      };
    })
    .filter((x): x is PublicAiShareSource => !!x);
}

/**
 * 公开分享元信息（无需登录）。
 *
 * 实测语义（Lead 2026-10-31 端到端验证，按此实现，不按契约猜）：
 *   { ok:true, title, needPassword, passwordError:false, allowExport, welcome,
 *     sources:[{kind,name,rowCount,columnCount}], askEnabled, invalidSources:[], expiresAt }
 *   - `needPassword` = 「该分享设有密码」，**不是**「尚未验证」
 *   - 未验证时 `sources` 为空数组 → 用 `needPassword && sources.length === 0` 判「未解锁」
 *   - 密码错：`passwordError=true` + `message="访问密码不正确"`
 *   - 停用：`{ok:false, code:'disabled', message}`；过期：`code:'expired'`；不存在：HTTP 404
 * 失败一律抛 AiPublicError（code 区分），页面用 publicShareErrorInfo() 翻译成中文。
 */
export async function publicAiShareMeta(token: string, pwd?: string): Promise<PublicAiShareMeta> {
  const t = String(token || '').trim();
  if (!t) throw new AiPublicError(PUBLIC_AI_ERROR_TEXT.not_found.title, 0, 'not_found');

  const { status, json } = await publicAiRaw(
    `/${encodeURIComponent(t)}${pwd ? `?pwd=${encodeURIComponent(pwd)}` : ''}`,
    { method: 'GET' }
  );

  const msgRaw = typeof json?.message === 'string' ? json.message : '';

  if (!json) {
    const code = status ? mapPublicErrorCode(status, null) : 'network';
    throw new AiPublicError(PUBLIC_AI_ERROR_TEXT[code].title, status, code);
  }

  /* 服务端明确失败（停用 / 过期 / 限流）—— 可能 HTTP 200 但 ok:false */
  if (status >= 400 || json.ok === false) {
    const code = mapPublicErrorCode(status, json);
    throw new AiPublicError(msgRaw || PUBLIC_AI_ERROR_TEXT[code].title, status, code);
  }

  const sources = normPublicSources(json.sources);
  const needPassword = json.needPassword === true || json.need_password === true;
  const passwordError =
    json.passwordError === true ||
    (typeof json.passwordError === 'string' && !!json.passwordError) ||
    json.password_error === true;
  const allowExport = json.allowExport === true || toNum(json.allowExport) === 1;
  const askEnabled = json.askEnabled === false || toNum(json.askEnabled) === 0 ? false : true;
  const welcome = json.welcome === undefined || json.welcome === null ? undefined : String(json.welcome);
  const expiresAt = (json.expiresAt ?? null) as string | null;
  const title = String(json.title ?? 'AI 问数');

  /* 密码不正确：HTTP 403 / code=PASSWORD，或 passwordError=true */
  if (passwordError) {
    const code = mapPublicErrorCode(status, json);
    throw new AiPublicError(
      msgRaw || PUBLIC_AI_ERROR_TEXT[code === 'other' ? 'password' : code].title,
      status || 403,
      code === 'other' ? 'password' : code
    );
  }

  const locked = needPassword && sources.length === 0;
  return {
    ok: !locked,
    title,
    needPassword,
    locked,
    passwordError: '',
    sources,
    welcome,
    allowExport,
    askEnabled,
    expiresAt,
  };
}

/** 公开问数（无需登录；服务端限流：单 token 20/分、单 IP 30/分） */
export async function publicAiShareAsk(
  token: string,
  payload: PublicAiAskPayload
): Promise<PublicAiAskResult> {
  const t = String(token || '').trim();
  if (!t) throw new AiPublicError(PUBLIC_AI_ERROR_TEXT.not_found.title, 0, 'not_found');

  const { status, json } = await publicAiRaw(`/${encodeURIComponent(t)}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: payload.question,
      ...(payload.pwd ? { pwd: payload.pwd } : {}),
      ...(payload.sessionKey ? { sessionKey: payload.sessionKey } : {}),
      ...(payload.history && payload.history.length ? { history: payload.history.slice(-4) } : {}),
    }),
  });

  if (!json) {
    if (status === 404 || status === 410 || status === 403) {
      const code = mapPublicErrorCode(status, null);
      throw new AiPublicError(PUBLIC_AI_ERROR_TEXT[code].title, status, code);
    }
    throw new AiPublicError('响应解析失败，请稍后重试', status, 'other');
  }

  if (status >= 400 || json.ok === false) {
    const code = mapPublicErrorCode(status, json);
    const msg = typeof json.message === 'string' ? json.message : '';
    throw new AiPublicError(msg || PUBLIC_AI_ERROR_TEXT[code].title, status, code);
  }

  const rows = Array.isArray(json.rows) ? (json.rows as RowData[]) : [];
  const columns = Array.isArray(json.columns) ? (json.columns as DatasetColumn[]) : [];
  return {
    ok: true,
    sessionKey: String(json.sessionKey ?? payload.sessionKey ?? ''),
    question: String(json.question ?? payload.question),
    answer: String(json.answer ?? ''),
    rows,
    columns,
    rowCount: toNum(json.rowCount ?? rows.length),
    truncated: json.truncated === true,
    duration: toNum(json.duration),
    model: String(json.model ?? ''),
    sources: normPublicSources(json.sources),
    allowExport: json.allowExport === true || toNum(json.allowExport) === 1,
  };
}

/** 新会话 key（公开页与后台页共用；不能用 crypto.randomUUID 兜底失败） */
export function newAiSessionKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
}
