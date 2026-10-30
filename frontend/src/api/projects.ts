/** 数据项目 / 项目分组 / 字段配置 API 封装
 *
 * 对应后端（src/routes/api.js）：
 *   GET    /api/projects                          项目列表（返回数组，分页在前端做）
 *   POST   /api/projects                          新建项目
 *   GET    /api/projects/:id                      项目详情（project/columns/stats/fieldDefs...）
 *   PUT    /api/projects/:id                      更新项目
 *   DELETE /api/projects/:id                      删除项目
 *   POST   /api/projects/:id/regenerate-token     重新生成推送令牌
 *   GET    /api/project-groups                    分组 list + tree + stats
 *   POST   /api/project-groups                    新建分组
 *   PUT    /api/project-groups/:id                更新分组
 *   DELETE /api/project-groups/:id                删除分组
 *   POST   /api/project-groups/assign             批量移动项目到分组
 *   POST   /api/project-groups/reorder            同级排序
 *   GET    /api/field-modes                       解析方式字典
 *   GET    /api/projects/:id/fields               字段定义 + 数据列 + 填充统计
 *   POST   /api/projects/:id/fields/parse         解析粘贴的字段表（预览）
 *   POST   /api/projects/:id/fields/import        导入字段定义
 *   PUT    /api/projects/:id/fields/:fieldKey     更新单个字段
 *   POST   /api/projects/:id/fields/parse-mode    批量设置解析方式
 *   DELETE /api/projects/:id/fields/:fieldKey     删除字段定义
 *   POST   /api/projects/:id/fields/sync          重建列结构 + 回填
 *   GET    /api/projects/:id/logs                 推送日志（分页）
 *   GET    /api/projects/:id/records              数据明细（分页）
 *   GET    /api/projects/:id/parsed               解析后数据（分页）
 *   GET    /api/projects/:id/export               导出 CSV（text/csv，非 JSON）
 */
import { api, qs } from '@/api/client';

/* ══════════════ 项目 ══════════════ */

export interface ProjectTrendPoint {
  date: string;
  count: number;
}

export interface ProjectRow {
  id: number;
  name: string;
  code?: string | null;
  description?: string | null;
  jdy_base_url?: string | null;
  jdy_secret?: string | null;
  push_token?: string | null;
  data_table?: string;
  log_table?: string;
  parsed_table?: string | null;
  raw_table?: string | null;
  status: number;
  remark?: string | null;
  total_count?: number;
  last_push_at?: string | null;
  created_by?: number;
  created_at?: string | null;
  updated_at?: string | null;
  parse_enabled?: number;
  datasource_id?: number | null;
  category?: string | null;
  tags?: string | null;
  group_id?: number | null;
  id_field_key?: string | null;
  creator_name?: string | null;
  creator_display?: string | null;
  datasource_name?: string | null;
  datasource_type?: string | null;
  group_name?: string | null;
  column_count?: number;
  parsed_column_count?: number;
  field_count?: number;
  /** 以下为 /projects 列表接口附带的聚合字段 */
  dataCount?: number;
  failedLogs?: number;
  columnCount?: number;
  fieldCount?: number;
  trend?: ProjectTrendPoint[];
}

export interface ProjectListQuery {
  keyword?: string;
  /** 'all' | 0（未分组）| 分组 id */
  groupId?: number | string;
  includeSubGroups?: boolean;
  onlyOwn?: boolean;
}

export interface ProjectPayload {
  name?: string;
  code?: string;
  description?: string;
  jdyBaseUrl?: string;
  jdySecret?: string;
  remark?: string;
  parseEnabled?: number | boolean;
  category?: string;
  tags?: string;
  groupId?: number | null;
  datasourceId?: number | null;
  status?: number;
  idFieldKey?: string | null;
}

/** 项目列表：后端一次返回全量数组（含数据量/失败日志/趋势） */
export function fetchProjects(query: ProjectListQuery = {}): Promise<ProjectRow[]> {
  return api.get<ProjectRow[]>(
    '/projects' +
      qs({
        keyword: query.keyword,
        groupId: query.groupId,
        includeSubGroups: query.includeSubGroups ? 1 : '',
        onlyOwn: query.onlyOwn ? 1 : '',
      }),
  );
}

export interface ProjectColumnInfo {
  name: string;
  columnType?: string;
  dataType?: string;
  type?: string;
  comment?: string;
}

export interface ProjectStats {
  dataTotal: number;
  dataToday: number;
  lastReceived: string | null;
  logTotal: number;
  logFailed: number;
}

export interface SubTableInfo {
  name: string;
  comment?: string;
}

export interface ProjectDetailData {
  project: ProjectRow;
  columns: ProjectColumnInfo[];
  parsedColumns: ProjectColumnInfo[];
  parsedTable: string;
  stats: ProjectStats;
  columnStats: Record<string, number>;
  fieldDefs: FieldDef[];
  subTables: SubTableInfo[];
  fieldMap: Record<string, string>;
}

/** 项目详情 */
export function fetchProject(id: number | string): Promise<ProjectDetailData> {
  return api.get<ProjectDetailData>(`/projects/${id}`);
}

export function createProject(body: ProjectPayload): Promise<ProjectRow> {
  return api.post<ProjectRow>('/projects', body);
}

export function updateProject(id: number | string, body: ProjectPayload): Promise<ProjectRow> {
  return api.put<ProjectRow>(`/projects/${id}`, body);
}

export function deleteProject(id: number | string): Promise<void> {
  return api.delete<void>(`/projects/${id}`);
}

export function regenerateToken(id: number | string): Promise<ProjectRow> {
  return api.post<ProjectRow>(`/projects/${id}/regenerate-token`);
}

/** 推送地址（简道云自定义推送填写此地址） */
export function pushUrlOf(project: Pick<ProjectRow, 'push_token'>): string {
  const token = project.push_token || '';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/jdy/push/${token}`;
}

/* ══════════════ 项目分组 ══════════════ */

export interface ProjectGroupNode {
  id: number;
  name: string;
  parentId: number | null;
  code?: string | null;
  icon?: string | null;
  color?: string | null;
  sortOrder: number;
  remark?: string | null;
  projectCount?: number;
  totalProjectCount?: number;
  children?: ProjectGroupNode[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ProjectGroupStats {
  groups: number;
  projects: number;
  ungrouped: number;
  byGroup?: Record<string, number>;
}

export interface ProjectGroupData {
  list: ProjectGroupNode[];
  tree: ProjectGroupNode[];
  stats: ProjectGroupStats;
  maxDepth: number;
}

export interface ProjectGroupPayload {
  name?: string;
  parentId?: number | null;
  code?: string;
  icon?: string;
  color?: string;
  sortOrder?: number;
  remark?: string;
}

export function fetchProjectGroups(): Promise<ProjectGroupData> {
  return api.get<ProjectGroupData>('/project-groups');
}

export function createProjectGroup(body: ProjectGroupPayload): Promise<ProjectGroupNode> {
  return api.post<ProjectGroupNode>('/project-groups', body);
}

export function updateProjectGroup(
  id: number,
  body: ProjectGroupPayload,
): Promise<ProjectGroupNode> {
  return api.put<ProjectGroupNode>(`/project-groups/${id}`, body);
}

export interface DeleteGroupResult {
  deleted: boolean;
  movedProjects: number;
  movedTo: number;
  movedChildren: number;
}

export function deleteProjectGroup(id: number, moveTo?: number): Promise<DeleteGroupResult> {
  return api.delete<DeleteGroupResult>(`/project-groups/${id}`, {
    body: moveTo === undefined ? {} : { moveTo },
  });
}

export interface AssignResult {
  groupId: number;
  moved: number;
}

/** 批量移动项目到分组（groupId=0 表示移出分组） */
export function assignProjectsToGroup(projectIds: number[], groupId: number): Promise<AssignResult> {
  return api.post<AssignResult>('/project-groups/assign', { projectIds, groupId });
}

export function reorderGroups(orderedIds: number[]): Promise<{ count: number }> {
  return api.post<{ count: number }>('/project-groups/reorder', { orderedIds });
}

/* ══════════════ 字段定义与解析方式 ══════════════ */

export interface FieldDef {
  id: number;
  project_id: number;
  field_name: string;
  field_key: string;
  field_type: string | null;
  remark: string | null;
  column_name: string;
  parse_mode: string;
  parse_path: string | null;
  source_key: string | null;
  sub_table: string | null;
  is_system: number;
  sort_order: number;
  enabled: number;
  created_at?: string | null;
  updated_at?: string | null;
  /** 该字段对应列的非空行数（/fields 接口附带） */
  rows?: number;
}

export interface ParseModeDef {
  key: string;
  name: string;
  desc: string;
  types: string[];
}

export interface SystemFieldDef {
  name: string;
  type: string;
  column: string;
}

export interface FieldModesData {
  modes: ParseModeDef[];
  system: Record<string, SystemFieldDef>;
}

/** 解析方式字典（无需项目权限） */
export function fetchFieldModes(): Promise<FieldModesData> {
  return api.get<FieldModesData>('/field-modes');
}

export interface ProjectFieldsData {
  fieldDefs: FieldDef[];
  columns: ProjectColumnInfo[];
  stats: Record<string, number>;
}

/** 项目字段定义 */
export function fetchProjectFields(id: number | string): Promise<ProjectFieldsData> {
  return api.get<ProjectFieldsData>(`/projects/${id}/fields`);
}

/** 解析预览用的字段（含列名、是否已存在、已有行数） */
export interface ParsedField {
  fieldName: string;
  fieldKey: string;
  fieldType: string;
  remark?: string;
  isSystem?: boolean;
  parseMode?: string;
  parsePath?: string | null;
  columnName?: string;
  exists?: boolean;
  rows?: number;
  sortOrder?: number;
}

export interface ParseFieldsResult {
  fields: ParsedField[];
  errors: string[];
  warnings: string[];
  skipped: number;
  source: string;
  total: number;
  systemCount: number;
  newCount: number;
}

/** 解析粘贴的字段对照表（纯预览，不落库） */
export function parseFields(id: number | string, text: string): Promise<ParseFieldsResult> {
  return api.post<ParseFieldsResult>(`/projects/${id}/fields/parse`, { text });
}

export interface ImportFieldsResult {
  fieldDefs: FieldDef[];
  added: string[];
  altered: string[];
  reconciled: number;
  purged: number;
}

/** 导入字段定义（mode=replace 覆盖 / merge 合并） */
export function importFields(
  id: number | string,
  fields: ParsedField[],
  mode: 'replace' | 'merge' = 'replace',
): Promise<ImportFieldsResult> {
  return api.post<ImportFieldsResult>(`/projects/${id}/fields/import`, { fields, mode });
}

export interface FieldUpdatePayload {
  fieldName?: string;
  fieldType?: string | null;
  remark?: string | null;
  parseMode?: string;
  parsePath?: string | null;
  enabled?: number;
  columnName?: string;
}

export function updateField(
  id: number | string,
  fieldKey: string,
  body: FieldUpdatePayload,
): Promise<FieldDef> {
  return api.put<FieldDef>(`/projects/${id}/fields/${encodeURIComponent(fieldKey)}`, body);
}

export interface ParseModeItem {
  fieldKey: string;
  parseMode: string;
  parsePath?: string | null;
}

/** 批量设置解析方式 */
export function bulkSetParseMode(id: number | string, items: ParseModeItem[]): Promise<void> {
  return api.post<void>(`/projects/${id}/fields/parse-mode`, { items });
}

export function deleteField(id: number | string, fieldKey: string): Promise<void> {
  return api.delete<void>(`/projects/${id}/fields/${encodeURIComponent(fieldKey)}`);
}

export interface SyncFieldsResult {
  added: string[];
  altered: string[];
  backfill: { updated: number; total: number; parsedTable?: string };
  resync: { filled: number };
  reconciled: number;
  purged: number;
  parsedTable: string;
}

/** 重建列结构并回填历史解析值 */
export function syncFields(id: number | string): Promise<SyncFieldsResult> {
  return api.post<SyncFieldsResult>(`/projects/${id}/fields/sync`);
}

/* ══════════════ 推送日志 ══════════════ */

export interface ProjectLogRow {
  id: number;
  op: string;
  op_label: string;
  deliver_id?: string | null;
  data_id?: string | null;
  form_name?: string | null;
  entry_id?: string | null;
  op_time?: number | null;
  signature_ok?: number | null;
  signature_msg?: string | null;
  result: string;
  message?: string | null;
  source_ip?: string | null;
  field_count?: number | null;
  change_summary?: string | null;
  payload?: string | null;
  created_at: string;
}

export interface ProjectLogsQuery {
  page?: number;
  pageSize?: number;
  op?: string;
  result?: string;
  keyword?: string;
}

export interface ProjectLogsData {
  list: ProjectLogRow[];
  total: number;
  page: number;
  pageSize: number;
  ops: { op: string; c: number }[];
}

export function fetchProjectLogs(
  id: number | string,
  query: ProjectLogsQuery = {},
): Promise<ProjectLogsData> {
  return api.get<ProjectLogsData>(`/projects/${id}/logs` + qs(query as Record<string, unknown>));
}

/** 单条日志详情（含 payload 与补算的变更描述） */
export function fetchProjectLogDetail(
  id: number | string,
  logId: number,
): Promise<ProjectLogRow> {
  return api.get<ProjectLogRow>(`/projects/${id}/logs/${logId}`);
}

export function clearProjectLogs(id: number | string): Promise<void> {
  return api.delete<void>(`/projects/${id}/logs`);
}

/* ══════════════ 数据明细 / 解析数据 ══════════════ */

/** 数据行：列名动态，值可能是标量/对象/数组 */
export type DataRow = Record<string, unknown>;

export interface DataIdField {
  fieldKey: string | null;
  column: string | null;
  label: string;
}

export interface ProjectRecordsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  op?: string;
  field?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
}

export interface ProjectRecordsData {
  list: DataRow[];
  total: number;
  page: number;
  pageSize: number;
  idField: DataIdField;
}

export function fetchProjectRecords(
  id: number | string,
  query: ProjectRecordsQuery = {},
): Promise<ProjectRecordsData> {
  return api.get<ProjectRecordsData>(`/projects/${id}/records` + qs(query as Record<string, unknown>));
}

export interface ProjectParsedData {
  list: DataRow[];
  total: number;
  page: number;
  pageSize: number;
  columns: ProjectColumnInfo[];
  table?: string;
  idField: DataIdField;
}

export function fetchParsedRecords(
  id: number | string,
  query: ProjectRecordsQuery = {},
): Promise<ProjectParsedData> {
  return api.get<ProjectParsedData>(`/projects/${id}/parsed` + qs(query as Record<string, unknown>));
}

/** 导出 CSV（后端返回 text/csv，此处拿纯文本） */
export function exportProjectCsv(id: number | string): Promise<string> {
  return api.get<string>(`/projects/${id}/export`);
}

/* ══════════════ 渲染辅助 ══════════════ */

/** 把任意列值渲染成可读文本 */
export function cellText(v: unknown, max = 120): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.length > max ? v.slice(0, max) + '…' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // 成员/关联对象优先展示名称
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const name = o.name ?? o.text ?? o.phone ?? o._id;
    if (name !== undefined && name !== null) return cellText(name, max);
  }
  let s = '';
  try {
    s = JSON.stringify(v);
  } catch {
    s = String(v);
  }
  return s.length > max ? s.slice(0, max) + '…' : s;
}
