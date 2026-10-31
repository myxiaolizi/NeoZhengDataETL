/** 数据处理流程 API 封装：流程 CRUD / 节点 / 试运行 / 日志 */
import { api, qs } from '@/api/client';
import type { FlowItem as BaseFlowItem, PaginatedResult } from '@/types';

/* ══════════════ 类型 ══════════════ */

/** 节点类型 key（对齐后端 src/flows.js NODE_TYPES） */
export type FlowNodeTypeKey =
  | 'source_project'
  | 'source_sql'
  | 'source_form'
  | 'source_manual'
  | 'filter'
  | 'select_fields'
  | 'rename'
  | 'dedupe'
  | 'fill_null'
  | 'replace'
  | 'trim'
  | 'type_convert'
  | 'split_field'
  | 'merge_field'
  | 'extract_json'
  | 'extract_regex'
  | 'compute'
  | 'aggregate'
  | 'sort'
  | 'limit'
  | 'join'
  | 'pick_current_task'
  | 'computed'
  | 'sink_table'
  | 'sink_project'
  | 'sink_api'
  | 'sink_dataset'
  | (string & {});

/** 节点配置字段类型（对齐后端 nodes[].fields[].type） */
export type FlowNodeFieldType =
  | 'project'
  | 'datasource'
  | 'form'
  | 'select'
  | 'number'
  | 'sql'
  | 'json'
  | 'kv'
  | 'text'
  | 'switch'
  | 'field'
  | (string & {});

/** 流程节点 */
export interface FlowNode {
  id: string;
  type: FlowNodeTypeKey;
  label: string;
  x: number;
  y: number;
  config: Record<string, unknown>;
}

/** 节点连线 */
export interface FlowEdge {
  from: string;
  to: string;
}

/** 节点配置字段定义（后端 nodes[].fields） */
export interface FlowNodeFieldDef {
  key: string;
  label: string;
  /** project / datasource / form / select / number / sql / json / kv / text / switch / field */
  type: FlowNodeFieldType;
  required?: boolean;
  default?: unknown;
  hint?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

/** 节点类型定义 */
export interface FlowNodeTypeDef {
  key: FlowNodeTypeKey;
  name: string;
  category: 'source' | 'clean' | 'sink' | string;
  icon: string;
  desc: string;
  fields: FlowNodeFieldDef[];
}

/** 节点分类 */
export interface FlowCategoryDef {
  key: string;
  name: string;
  desc: string;
}

/** 节点类型元数据 */
export interface FlowNodeMeta {
  nodes: FlowNodeTypeDef[];
  categories: FlowCategoryDef[];
}

/** 流程（列表项） */
export interface FlowListItem extends BaseFlowItem {
  projectId?: number | null;
  projectName?: string | null;
  sourceType?: string;
  targetTable?: string | null;
  runMode?: string;
  triggerMode?: 'on_push' | 'manual' | string;
  cronExpr?: string | null;
  successCount?: number;
  lastRunOk?: boolean | null;
  lastRunMsg?: string | null;
  updatedAt?: string;
}

/** 流程详情 */
export interface FlowDetail extends FlowListItem {
  nodes: FlowNode[];
  edges: FlowEdge[];
  sourceConfig: Record<string, unknown>;
}

/** 流程列表 + 统计 */
export interface FlowListResult {
  list: FlowListItem[];
  stats: { flows: number; active: number; runs: number; oks: number };
}

/** 单节点运行日志 */
export interface FlowNodeLog {
  nodeId: string;
  type?: string;
  name: string;
  ok?: boolean;
  error?: string;
  inputRows?: number;
  outputRows?: number;
  rows?: number;
  ms?: number;
  result?: unknown;
  skipped?: boolean;
}

/** 流程运行日志 */
export interface FlowLog {
  id: number;
  flow_id: number;
  trigger_source: string;
  success: number;
  input_rows: number;
  output_rows: number;
  duration_ms: number | null;
  node_logs: string | null;
  message: string | null;
  created_at: string;
  nodeLogs: FlowNodeLog[];
}

/** 运行结果 */
export interface FlowRunResult {
  ok: boolean;
  message: string;
  inputRows: number;
  outputRows: number;
  duration: number;
  nodeLogs: FlowNodeLog[];
}

/** 试运行结果 */
export interface FlowPreviewResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  columns: { name: string }[];
  logs: { nodeId: string; name: string; type: string; skipped?: boolean; rows?: number; inputRows?: number; outputRows?: number; ms?: number }[];
}

/** 流程可用字段 */
export interface FlowField {
  name: string;
  sample: unknown;
}

/* ══════════════ API ══════════════ */

export const flowsApi = {
  /** 节点类型与分类 */
  nodeMeta: () => api.get<FlowNodeMeta>('/flow-node-types'),

  /** 流程列表（含统计） */
  list: (keyword?: string) => api.get<FlowListResult>('/flows' + qs({ keyword })),

  /** 流程详情 */
  detail: (id: number | string) => api.get<FlowDetail>(`/flows/${id}`),

  /** 新建流程 */
  create: (body: Partial<FlowDetail>) => api.post<FlowDetail>('/flows', body),

  /** 更新流程 */
  update: (id: number | string, body: Partial<FlowDetail>) =>
    api.put<FlowDetail>(`/flows/${id}`, body),

  /** 删除流程 */
  remove: (id: number | string) => api.delete<null>(`/flows/${id}`),

  /** 执行流程 */
  run: (id: number | string) =>
    api.post<FlowRunResult>(`/flows/${id}/run`, undefined, { silent: true }),

  /** 试运行（不写入目标） */
  preview: (id: number | string, limit = 50) =>
    api.post<FlowPreviewResult>(`/flows/${id}/preview`, { limit }),

  /** 流程运行日志（分页） */
  logs: (id: number | string, params: { page?: number; pageSize?: number } = {}) =>
    api.get<PaginatedResult<FlowLog>>(`/flows/${id}/logs` + qs(params)),

  /** 全部流程日志（分页） */
  allLogs: (params: { page?: number; pageSize?: number } = {}) =>
    api.get<PaginatedResult<FlowLog>>('/flow-logs' + qs(params)),

  /** 流程可用字段（供节点配置选择） */
  fields: (id: number | string) => api.get<FlowField[]>(`/flows/${id}/fields`),
};

/* ══════════════ 节点配置所需的选项数据 ══════════════ */

export interface OptionItem {
  label: string;
  value: number | string;
}

/** 项目下拉（/projects 直接返回数组） */
export async function fetchProjectOptions(): Promise<OptionItem[]> {
  const rows = await api.get<{ id: number; name: string }[]>('/projects');
  return (rows || []).map((p) => ({ label: p.name, value: p.id }));
}

/** 数据源下拉（/datasources 返回 { list, catalog }） */
export async function fetchDatasourceOptions(): Promise<OptionItem[]> {
  const data = await api.get<{ list: { id: number; name: string }[] }>('/datasources');
  return (data?.list || []).map((d) => ({ label: d.name, value: d.id }));
}

/** 表单下拉（/forms 返回 { list, stats }） */
export async function fetchFormOptions(): Promise<OptionItem[]> {
  const data = await api.get<{ list: { id: number; name: string }[] }>('/forms');
  return (data?.list || []).map((f) => ({ label: f.name, value: f.id }));
}

export interface ProjectColumnsMeta {
  columns: { name: string; comment?: string }[];
  parsedColumns: { name: string; comment?: string }[];
  fieldDefs: {
    field_name: string;
    field_key: string;
    column_name: string;
    parse_mode: string;
    sub_table: string | null;
  }[];
}

/** 获取项目列元数据（供流程设计器推导上游字段下拉） */
export async function fetchProjectColumnsMeta(
  projectId: number | string
): Promise<ProjectColumnsMeta | null> {
  if (!projectId) return null;
  try {
    const data = await api.get<ProjectColumnsMeta>(`/projects/${projectId}`);
    return data || null;
  } catch {
    return null;
  }
}

/** 构建单个项目的可选字段列表（按 table = 'parsed' | 'raw'） */
export function buildProjectFieldOptions(
  meta: ProjectColumnsMeta | null | undefined,
  tableMode: string = 'parsed'
): { label: string; value: string }[] {
  if (!meta) return [];
  const labelByCol = new Map<string, string>();
  (meta.fieldDefs || []).forEach((d) => {
    if (!d.column_name) return;
    labelByCol.set(d.column_name, d.field_name || d.field_key);
    labelByCol.set(`${d.column_name}_p`, `${d.field_name || d.field_key}（解析值）`);
  });

  const cols =
    tableMode === 'raw'
      ? meta.columns || []
      : (meta.parsedColumns && meta.parsedColumns.length ? meta.parsedColumns : meta.columns || []);

  const seen = new Set<string>();
  const out: { label: string; value: string }[] = [];
  const push = (colName: string, comment?: string) => {
    const name = String(colName || '').trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    const title = labelByCol.get(name) || comment || '';
    out.push({
      value: name,
      label: title && title !== name ? `${name}（${title}）` : name,
    });
  };

  cols.forEach((c) => push(c.name, c.comment));

  // 若解析表列尚未返回，按 fieldDefs 兜底补充
  if (!cols.length && (meta.fieldDefs || []).length) {
    meta.fieldDefs.forEach((d) => {
      if (d.sub_table) return;
      push(d.column_name, d.field_name);
      if (tableMode !== 'raw' && d.parse_mode && d.parse_mode !== 'none') {
        push(`${d.column_name}_p`, `${d.field_name}·解析`);
      }
    });
  }
  return out;
}

export default flowsApi;
