/**
 * V16 · AI 报表（受限 DSL 配置驱动）前端 API 封装
 *
 * 契约 §4.4：/api/ai-reports 系列接口。
 * 安全红线：DSL 只作为**数据**查看/编辑，前端绝不 eval / new Function 执行，
 * 只把 dsl 当作 JSON 文本展示与编辑，保存交给后端 schema 校验。
 *
 * AI 调整（ai-draft）另做 30 秒超时兜底：本地无模型凭据时后端会挂起，
 * 超时后抛中文错误，由页面提示「AI 服务不可用，请用手动调整」，绝不阻塞页面。
 */
import { api, qs } from '@/api/client';

/** AI 报表条目（GET /api/ai-reports 返回，见 src/ai-reports.js publicAiReport） */
export interface AiReportItem {
  id: number;
  name: string;
  code?: string;
  title?: string;
  description?: string;
  category?: string;
  reportType: string; // 'ai'
  icon?: string;
  tags?: string;
  group?: string;
  source: 'builtin' | 'user' | string;
  boardKey?: string | null;
  dsl?: string;
  status: number;
  viewCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** 新建 / 修改 payload（未出现的字段后端保留现值） */
export interface AiReportPayload {
  name?: string;
  title?: string;
  description?: string;
  icon?: string;
  tags?: string;
  group?: string;
  status?: number;
  dsl?: string;
  category?: string;
}

/** ai-draft 返回：dsl 为规范化的 JSON 文本，parsed 为解析对象，raw 为模型原始输出 */
export interface AiDraftResult {
  dsl: string;
  parsed?: Record<string, unknown>;
  raw: string;
}

/** 白名单描述（编辑器提示用，只读） */
export interface AiReportSchema {
  spec: string;
  blockTypes: string[];
  chartTypes: string[];
  themes: string[];
  routes: string[];
  sources: Record<string, string[]>;
  maxBlocks: number;
  forbidden: string[];
}

export function listAiReports(params?: { source?: string; group?: string; search?: string }): Promise<AiReportItem[]> {
  return api.get<AiReportItem[]>('/ai-reports' + qs(params || {}));
}

export function getAiReport(id: number | string): Promise<AiReportItem> {
  return api.get<AiReportItem>(`/ai-reports/${id}`);
}

export function createAiReport(payload: AiReportPayload): Promise<AiReportItem> {
  return api.post<AiReportItem>('/ai-reports', payload);
}

export function updateAiReport(id: number | string, payload: AiReportPayload): Promise<AiReportItem> {
  return api.put<AiReportItem>(`/ai-reports/${id}`, payload);
}

export function deleteAiReport(id: number | string): Promise<void> {
  return api.delete<void>(`/ai-reports/${id}`);
}

export function copyAiReport(id: number | string): Promise<AiReportItem> {
  return api.post<AiReportItem>(`/ai-reports/${id}/copy`);
}

/** DSL 校验预览（不落库） */
export function validateAiReportDsl(dsl: string | Record<string, unknown>): Promise<{ valid: boolean; dsl: string }> {
  return api.post<{ valid: boolean; dsl: string }>('/ai-reports/validate', { dsl });
}

export function getAiReportSchema(): Promise<AiReportSchema> {
  return api.get<AiReportSchema>('/ai-reports/schema');
}

/** 超时兜底错误标记：`code === 'AI_DRAFT_TIMEOUT'` */
export const AI_DRAFT_TIMEOUT = 'AI_DRAFT_TIMEOUT';

/**
 * 生成 AI 报表 DSL 草稿。
 *
 * 契约 §4.4：POST /api/ai-reports/ai-draft { prompt } → { dsl, parsed, raw }
 * 本地无模型凭据时后端会长时间挂起，这里做 timeoutMs（默认 30s）硬超时，
 * 超时抛 `Error('AI 服务超时')` 且 `code = AI_DRAFT_TIMEOUT`，由页面提示改用手动调整。
 */
export async function generateAiReportDraft(prompt: string, timeoutMs = 30000): Promise<AiDraftResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs));
  try {
    return await api.post<AiDraftResult>('/ai-reports/ai-draft', { prompt }, { signal: ctrl.signal, silent: true });
  } catch (e) {
    if (ctrl.signal.aborted) {
      const err = new Error('AI 服务超时') as Error & { code?: string };
      err.code = AI_DRAFT_TIMEOUT;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
