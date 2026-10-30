/** 表单引擎 API 封装：表单 CRUD / 字段设计 / 提交数据 / 公开填单 */
import { api, qs } from '@/api/client';
import type { FormItem as BaseFormItem, PaginatedResult } from '@/types';

/* ══════════════ 类型 ══════════════ */

/** 字段宽度（12 栅格） */
export type FieldWidth = '1/5' | '1/4' | '1/3' | '1/2' | '1';
/** 选项展示方式 */
export type OptionLayout = 'horizontal' | 'vertical' | 'dropdown';

/** 表单字段定义（对齐 forms.js normalizeFields） */
export interface FormField {
  key: string;
  type: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: string[];
  optionLayout?: OptionLayout;
  minSelect?: number | null;
  maxSelect?: number | null;
  min?: number | null;
  max?: number | null;
  precision?: number | null;
  formula?: string;
  hint?: string;
  /** 服务端保存值可能是 'full' / 'half' 等历史值 */
  width?: string;
  score?: number;
  answer?: string;
  columns?: unknown[];
  linkage?: { source: string; mode: string; map: Record<string, string> } | null;
}

/** 表单设置（settings JSON） */
export interface FormSettings {
  successMessage?: string;
  shareTitle?: string;
  shareIcon?: string;
  shareDesc?: string;
  /** 流程表单：审批节点 */
  flowNodes?: { name?: string; approver?: string }[];
  examDuration?: number;
  examPassScore?: number;
  examShowAnswer?: boolean;
  [key: string]: unknown;
}

/** 表单（列表项） */
export interface FormItem extends BaseFormItem {
  projectName?: string | null;
  formType?: string;
  formTypeName?: string;
  publicToken?: string | null;
  allowPublic?: boolean;
  shareTitle?: string;
  shareIcon?: string;
  shareDesc?: string;
  updatedAt?: string;
  createdBy?: number | null;
}

/** 表单详情 */
export interface FormDetail extends FormItem {
  fields: FormField[];
  settings: FormSettings;
}

/** 字段类型元数据 */
export interface FormFieldTypeDef {
  key: string;
  name: string;
  icon: string;
  group: string;
}

/** 一种表单类型 */
export interface FormTypeDef {
  key: string;
  name: string;
  icon: string;
  desc: string;
}

/** 宽度定义 */
export interface WidthDef {
  key: FieldWidth;
  name: string;
  span: number;
}

/** 字段类型元数据全集 */
export interface FormMeta {
  types: FormFieldTypeDef[];
  formTypes: FormTypeDef[];
  widths: WidthDef[];
  optionLayouts: { key: OptionLayout; name: string }[];
  flowStatus: Record<string, string>;
}

/** 表单列表 + 统计 */
export interface FormListResult {
  list: FormItem[];
  stats: { forms: number; active: number; records: number; today: number };
}

/** 表单提交记录 */
export interface FormRecord {
  id: number;
  form_id: number;
  data_json: string;
  submitter?: string | null;
  submitter_id?: number | null;
  ip?: string | null;
  user_agent?: string | null;
  status: string;
  message?: string | null;
  created_at: string;
  data: Record<string, unknown>;
}

/** 考试判分结果 */
export interface ExamResult {
  totalScore: number;
  earned: number;
  percent: number;
  passScore: number;
  passed: boolean;
  correctCount: number;
  questionCount: number;
  details: {
    key: string;
    label: string;
    type: string;
    score: number;
    earned: number;
    correct: boolean;
    expected?: string;
    actual: string;
  }[];
}

/** 流程表单提交后的审批信息 */
export interface FormFlowInfo {
  status: string;
  currentStep: number;
  totalSteps: number;
  nodes: { step: number; name: string; approver: string; status: string }[];
}

/** 公开提交结果 */
export interface PublicSubmitResult {
  recordId: number;
  formId: number;
  formType: string;
  data: Record<string, unknown>;
  writeInfo?: { error?: string } | null;
  examResult?: ExamResult | null;
  flowInfo?: FormFlowInfo | null;
  message: string;
}

/** 公开填单结构 */
export interface PublicFormSchema {
  id: number;
  name: string;
  description: string;
  fields: FormField[];
  settings: FormSettings;
}

/* ══════════════ 公开接口（/f 前缀，不带 /api） ══════════════ */

interface PublicError extends Error {
  errors?: string[];
}

async function publicFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new Error('网络请求失败，请检查网络连接');
  }
  let json: { ok?: boolean; data?: T; message?: string; errors?: string[] } | null = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok || !json || json.ok === false) {
    const err = new Error(json?.message || `请求失败（HTTP ${res.status}）`) as PublicError;
    if (json?.errors) err.errors = json.errors;
    throw err;
  }
  return (json.data !== undefined ? json.data : (json as unknown)) as T;
}

/* ══════════════ 管理端 API ══════════════ */

export const formsApi = {
  /** 字段类型等元数据 */
  meta: () => api.get<FormMeta>('/form-field-types'),

  /** 表单列表（含统计） */
  list: (keyword?: string) => api.get<FormListResult>('/forms' + qs({ keyword })),

  /** 表单详情 */
  detail: (id: number | string) => api.get<FormDetail>(`/forms/${id}`),

  /** 新建表单 */
  create: (body: Partial<FormDetail>) => api.post<FormDetail>('/forms', body),

  /** 更新表单 */
  update: (id: number | string, body: Partial<FormDetail>) =>
    api.put<FormDetail>(`/forms/${id}`, body),

  /** 删除表单 */
  remove: (id: number | string) => api.delete<null>(`/forms/${id}`),

  /** 重置公开令牌 */
  regenerateToken: (id: number | string) =>
    api.post<FormDetail>(`/forms/${id}/regenerate-token`),

  /** 提交记录（分页） */
  records: (
    id: number | string,
    params: { page?: number; pageSize?: number; keyword?: string } = {}
  ) => api.get<PaginatedResult<FormRecord>>(`/forms/${id}/records` + qs(params)),

  /** 导出 CSV（后端返回 text/csv，需自行下载） */
  async exportCsv(id: number | string, filename: string): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`/api/forms/${id}/export`, { credentials: 'same-origin' });
    } catch {
      throw new Error('网络请求失败，无法导出');
    }
    if (!res.ok) throw new Error(`导出失败（HTTP ${res.status}）`);
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /** 公开填单结构（无需登录） */
  publicSchema: (token: string) => publicFetch<PublicFormSchema>(`/f/${token}/schema`),

  /** 公开提交（无需登录） */
  publicSubmit: (token: string, data: Record<string, unknown>) =>
    publicFetch<PublicSubmitResult>(`/f/${token}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
};

/** 公开表单填写链接 */
export function publicFormUrl(token?: string | null): string {
  if (!token) return '';
  return `${window.location.origin}/f/${token}`;
}

/** 字段是否属于「布局类」（不参与数据提交） */
export function isLayoutField(type: string): boolean {
  return type === 'divider' || type === 'section';
}

/** 字段是否属于「选项类」（需要维护选项列表） */
export function isOptionField(type: string): boolean {
  return type === 'select' || type === 'radio' || type === 'checkbox';
}

/** 字段是否属于「数值类」 */
export function isNumberField(type: string): boolean {
  return type === 'number' || type === 'amount' || type === 'percent' || type === 'slider';
}

export default formsApi;
