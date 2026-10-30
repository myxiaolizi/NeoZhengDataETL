/** 数据集 API 封装（对齐 src/reports.js 的 dataset 部分 + V4.1 结构化 SQL 错误与自动引号提示） */
import { api, qs, type ApiResponse } from '@/api/client';

export type DatasetSourceType = 'sql' | 'table' | 'project';

export interface DatasetFieldMeta {
  name: string;
  label?: string;
  type?: string;
  [key: string]: unknown;
}

export type Dataset = {
  id: number;
  name: string;
  code: string;
  description?: string;
  datasourceId: number;
  sourceType: DatasetSourceType;
  sourceSql?: string;
  sourceTable?: string;
  projectId?: number | null;
  fields?: DatasetFieldMeta[];
  cacheTtl?: number;
  status: number;
  createdBy?: number | null;
  createdAt?: string;
  updatedAt?: string;
  /** 列表接口附加 */
  datasourceName?: string;
  projectName?: string;
  /** V4.1 后端自动加引号标记/提示 */
  autoQuoted?: boolean;
  autoQuoteNotice?: string;
  rewrittenSql?: string;
  originalSql?: string;
  [key: string]: unknown;
};

export interface DatasetPayload {
  name: string;
  code?: string;
  description?: string;
  datasourceId?: number;
  sourceType?: DatasetSourceType;
  sourceSql?: string;
  sourceTable?: string;
  projectId?: number | null;
  cacheTtl?: number;
  status?: number;
  fields?: DatasetFieldMeta[];
}

export interface PreviewColumn {
  name: string;
  type: string;
}

/** 结构化 SQL 错误详情（兼容后端返回顶层或 error/detail 嵌套字段） */
export interface StructuredSqlError {
  message: string;
  code?: string;
  sqlMessage?: string;
  originalSql?: string;
  sql?: string;
  rewrittenSql?: string;
  suggestion?: string;
}

export class DatasetSqlError extends Error {
  detail: StructuredSqlError;
  constructor(detail: StructuredSqlError) {
    super(detail.message || 'SQL 执行失败');
    this.name = 'DatasetSqlError';
    this.detail = detail;
  }
}

/** 预览/试跑结果（buildQuery + runDataset 返回） */
export interface DatasetPreview {
  rows: Record<string, unknown>[];
  columns: PreviewColumn[];
  rowCount: number;
  elapsed: number;
  sql: string;
  datasourceName: string;
  autoQuoted?: boolean;
  autoQuoteNotice?: string;
  originalSql?: string;
  rewrittenSql?: string;
}

export interface SqlTestResult {
  rows: Record<string, unknown>[];
  columns: PreviewColumn[];
  rowCount: number;
  elapsed: number;
  sql?: string;
  originalSql?: string;
  rewrittenSql?: string;
  autoQuoted?: boolean;
  autoQuoteNotice?: string;
}

export interface DatasetSaveResult {
  dataset: Dataset;
  message?: string;
  autoQuoted?: boolean;
  autoQuoteNotice?: string;
  originalSql?: string;
  rewrittenSql?: string;
}

export interface ProjectOption {
  id: number;
  name: string;
  code?: string;
}

/** 从后端原始响应或错误消息中提取结构化 SQL 错误信息 */
export function parseStructuredSqlError(raw: Record<string, any> | Error | string, fallbackSql?: string): StructuredSqlError {
  if (raw instanceof DatasetSqlError) {
    return {
      ...raw.detail,
      originalSql: raw.detail.originalSql || raw.detail.sql || fallbackSql,
    };
  }
  const obj: Record<string, any> = typeof raw === 'object' && raw !== null && !(raw instanceof Error)
    ? raw
    : { message: typeof raw === 'string' ? raw : raw?.message || 'SQL 执行失败' };
  const sub = (obj.error && typeof obj.error === 'object' ? obj.error : obj.detail && typeof obj.detail === 'object' ? obj.detail : obj.data && typeof obj.data === 'object' ? obj.data : {}) as Record<string, any>;

  const msg = String(obj.message || sub.message || 'SQL 执行失败');
  let code = String(obj.code || obj.errCode || sub.code || sub.errCode || '').trim() || undefined;
  let sqlMessage = String(obj.sqlMessage || sub.sqlMessage || obj.rawError || sub.rawError || '').trim() || undefined;
  let originalSql = String(
    obj.originalSql || obj.rawSql || sub.originalSql || sub.rawSql || obj.sql || sub.sql || fallbackSql || ''
  ).trim() || undefined;
  let rewrittenSql = String(obj.rewrittenSql || obj.quotedSql || sub.rewrittenSql || sub.quotedSql || '').trim() || undefined;
  let suggestion = String(
    obj.suggestion || obj.hint || obj.advice || obj.fixSuggestion || sub.suggestion || sub.hint || sub.advice || ''
  ).trim() || undefined;

  // 若后端把信息拼在 message 字符串中，补充提取并给出针对性建议
  if (!code) {
    const codeMatch = msg.match(/\b(ER_[A-Z0-9_]+|SQLITE_[A-Z0-9_]+|ORA-\d+|42\w{3})\b/);
    if (codeMatch) code = codeMatch[1];
    else if (/syntax/i.test(msg)) code = 'ER_PARSE_ERROR';
  }
  if (!sqlMessage && /You have an error in your SQL syntax|near\s+'/i.test(msg)) {
    sqlMessage = msg;
  }
  if (!suggestion) {
    if (/near\s+'-[a-zA-Z0-9_]/i.test(msg) || (originalSql && /\b(?:from|join)\s+[a-zA-Z0-9_]+-[a-zA-Z0-9_]+/i.test(originalSql))) {
      suggestion = '检测到表名或字段名包含连字符「-」等特殊字符，MySQL 默认将其解析为减法运算。建议用反引号包裹表名（如 SELECT * FROM `zkcrm-ry`），系统已支持自动为特殊表名加引号。';
    } else if (/syntax/i.test(msg)) {
      suggestion = '请检查 SQL 语法是否正确；若表名或列名包含连字符（-）、点号、空格、中文或保留字，请使用反引号 `表名`（MySQL）或方括号 [表名]（MSSQL）包裹。';
    } else if (/doesn't exist|not exist|Unknown table/i.test(msg)) {
      suggestion = '数据表不存在，请核对所选数据源是否正确，或前往「数据源 → 表结构」确认真实表名。';
    } else if (/Unknown column/i.test(msg)) {
      suggestion = '查询中引用的字段名不存在，请核对表结构字段名称。';
    } else if (/只允许|不允许|只读/i.test(msg)) {
      suggestion = '数据集仅允许单条只读 SELECT / WITH 查询语句，请去掉分号及写操作关键字。';
    } else {
      suggestion = '请检查数据源连接状态、表名引号（如 `table-name`）及 SQL 查询语法。';
    }
  }

  return {
    message: msg,
    code,
    sqlMessage,
    originalSql,
    sql: obj.sql || sub.sql || originalSql,
    rewrittenSql,
    suggestion,
  };
}

/** 提取保存或试跑响应中的「已自动加引号」提示 */
export function extractAutoQuoteNotice(raw: Record<string, any> | null | undefined, inputSql?: string): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const data = (raw.data && typeof raw.data === 'object' ? raw.data : raw) as Record<string, any>;
  const explicit =
    raw.autoQuoteNotice ||
    raw.quoteNotice ||
    raw.warning ||
    data.autoQuoteNotice ||
    data.quoteNotice ||
    data.warning;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();

  if (typeof raw.message === 'string' && /引号|反引号|自动修复|自动转义/.test(raw.message)) {
    return raw.message;
  }

  const savedSql = String(data.rewrittenSql || data.quotedSql || data.sourceSql || data.sql || '').trim();
  const orig = String(data.originalSql || inputSql || '').trim().replace(/;+\s*$/, '');
  if (
    (raw.autoQuoted || data.autoQuoted) ||
    (orig && savedSql && orig !== savedSql && !savedSql.toUpperCase().endsWith('OFFSET 0') && savedSql.includes('`') && !orig.includes('`'))
  ) {
    return `系统检测到表名/标识符含特殊字符，已自动添加反引号：${savedSql}`;
  }
  if (orig && savedSql && orig !== savedSql && savedSql.includes('`') && !orig.includes('`')) {
    const cleanSaved = savedSql.replace(/\s+LIMIT\s+\d+\s+OFFSET\s+\d+\s*$/i, '');
    if (cleanSaved !== orig) {
      return `系统已自动为特殊表名/标识符添加引号：${cleanSaved}`;
    }
  }
  return undefined;
}

/** 数据集列表（不支持服务端分页，返回全量） */
export async function listDatasets(keyword?: string): Promise<Dataset[]> {
  return api.get<Dataset[]>('/datasets' + qs({ keyword }));
}

export async function getDataset(id: number): Promise<Dataset> {
  return api.get<Dataset>(`/datasets/${id}`);
}

export async function createDataset(payload: DatasetPayload): Promise<Dataset> {
  const res = await api.post<ApiResponse<Dataset>>('/datasets', payload, { raw: true, silent: true });
  if (!res || res.ok === false) {
    throw new DatasetSqlError(parseStructuredSqlError(res || { message: '创建数据集失败' }, payload.sourceSql));
  }
  const dataset = (res.data || (res as unknown as Dataset)) as Dataset;
  const notice = extractAutoQuoteNotice(res, payload.sourceSql);
  if (notice && dataset && typeof dataset === 'object') {
    dataset.autoQuoteNotice = notice;
    dataset.autoQuoted = true;
  }
  return dataset;
}

export async function updateDataset(id: number, payload: Partial<DatasetPayload>): Promise<Dataset> {
  const res = await api.put<ApiResponse<Dataset>>(`/datasets/${id}`, payload, { raw: true, silent: true });
  if (!res || res.ok === false) {
    throw new DatasetSqlError(parseStructuredSqlError(res || { message: '更新数据集失败' }, payload.sourceSql));
  }
  const dataset = (res.data || (res as unknown as Dataset)) as Dataset;
  const notice = extractAutoQuoteNotice(res, payload.sourceSql);
  if (notice && dataset && typeof dataset === 'object') {
    dataset.autoQuoteNotice = notice;
    dataset.autoQuoted = true;
  }
  return dataset;
}

export async function deleteDataset(id: number): Promise<void> {
  await api.delete(`/datasets/${id}`);
}

/** 预览数据集数据（后端为 POST，捕获结构化 SQL 错误） */
export async function previewDataset(id: number, limit = 20): Promise<DatasetPreview> {
  const res = await api.post<ApiResponse<DatasetPreview>>(`/datasets/${id}/preview`, { limit }, { raw: true, silent: true });
  if (!res || res.ok === false) {
    throw new DatasetSqlError(parseStructuredSqlError(res || { message: '预览数据集失败' }));
  }
  const data = (res.data || (res as unknown as DatasetPreview)) as DatasetPreview;
  const notice = extractAutoQuoteNotice(res, data?.originalSql);
  if (notice && data && typeof data === 'object') {
    data.autoQuoteNotice = notice;
    data.autoQuoted = true;
  }
  return data;
}

/** 试跑 SQL（数据集设计用，只读校验在服务端，捕获结构化 SQL 错误） */
export async function testDatasetSql(payload: {
  datasourceId: number;
  sql: string;
  limit?: number;
}): Promise<SqlTestResult> {
  const res = await api.post<ApiResponse<SqlTestResult>>('/datasets/test-sql', payload, { raw: true, silent: true });
  if (!res || res.ok === false) {
    throw new DatasetSqlError(parseStructuredSqlError(res || { message: 'SQL 试跑失败' }, payload.sql));
  }
  const data = (res.data || (res as unknown as SqlTestResult)) as SqlTestResult;
  const notice = extractAutoQuoteNotice(res, payload.sql);
  if (notice && data && typeof data === 'object') {
    data.autoQuoteNotice = notice;
    data.autoQuoted = true;
  }
  return data;
}

/**
 * 项目下拉选项。
 * 项目接口由核心页面组负责，这里只做只读拉取，避免跨模块耦合。
 */
export async function listProjectOptions(keyword?: string): Promise<ProjectOption[]> {
  const rows = await api.get<ProjectOption[]>('/projects' + qs({ keyword }));
  return (rows || []).map((p) => ({ id: Number(p.id), name: p.name, code: p.code }));
}
