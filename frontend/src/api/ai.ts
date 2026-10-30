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

export type AiErrorKind = 'disabled' | 'nokey' | 'nodataset' | 'network' | 'auth' | 'other';

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
