/** 鏁版嵁闆?API 灏佽锛堝榻?src/reports.js 鐨?dataset 閮ㄥ垎锛?*/
import { api, qs } from '@/api/client';

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
  /** 鍒楄〃鎺ュ彛闄勫姞 */
  datasourceName?: string;
  projectName?: string;
}

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

/** 棰勮/璇曡窇缁撴灉锛坆uildQuery + runDataset 杩斿洖锛?*/
export interface DatasetPreview {
  rows: Record<string, unknown>[];
  columns: PreviewColumn[];
  rowCount: number;
  elapsed: number;
  sql: string;
  datasourceName: string;
}

export interface SqlTestResult {
  rows: Record<string, unknown>[];
  columns: PreviewColumn[];
  rowCount: number;
  elapsed: number;
}

export interface ProjectOption {
  id: number;
  name: string;
  code?: string;
}

/** 鏁版嵁闆嗗垪琛紙涓嶆敮鎸佹湇鍔＄鍒嗛〉锛岃繑鍥炲叏閲忥級 */
export async function listDatasets(keyword?: string): Promise<Dataset[]> {
  return api.get<Dataset[]>('/datasets' + qs({ keyword }));
}

export async function getDataset(id: number): Promise<Dataset> {
  return api.get<Dataset>(`/datasets/${id}`);
}

export async function createDataset(payload: DatasetPayload): Promise<Dataset> {
  return api.post<Dataset>('/datasets', payload);
}

export async function updateDataset(id: number, payload: Partial<DatasetPayload>): Promise<Dataset> {
  return api.put<Dataset>(`/datasets/${id}`, payload);
}

export async function deleteDataset(id: number): Promise<void> {
  await api.delete(`/datasets/${id}`);
}

/** 棰勮鏁版嵁闆嗘暟鎹紙鍚庣涓?POST锛?*/
export async function previewDataset(id: number, limit = 20): Promise<DatasetPreview> {
  return api.post<DatasetPreview>(`/datasets/${id}/preview`, { limit });
}

/** 璇曡窇 SQL锛堟暟鎹泦璁捐鐢紝鍙鏍￠獙鍦ㄦ湇鍔＄锛?*/
export async function testDatasetSql(payload: {
  datasourceId: number;
  sql: string;
  limit?: number;
}): Promise<SqlTestResult> {
  return api.post<SqlTestResult>('/datasets/test-sql', payload);
}

/**
 * 椤圭洰涓嬫媺閫夐」銆? * 椤圭洰鎺ュ彛鐢辨牳蹇冮〉闈㈢粍璐熻矗锛岃繖閲屽彧鍋氬彧璇绘媺鍙栵紝閬垮厤璺ㄦā鍧楄€﹀悎銆? */
export async function listProjectOptions(keyword?: string): Promise<ProjectOption[]> {
  const rows = await api.get<ProjectOption[]>('/projects' + qs({ keyword }));
  return (rows || []).map((p) => ({ id: Number(p.id), name: p.name, code: p.code }));
}

