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
import { api, qs } from '@/api/client';
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
