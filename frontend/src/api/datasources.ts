/** 数据源 API 封装（对齐 src/datasources.js + src/dstypes.js + routes/api.js） */
import { api, qs } from '@/api/client';

export type DsConn = 'sql' | 'api';

export interface DsTypeResource {
  key: string;
  name: string;
  api: string;
}

/** 数据源类型（/datasource-types/:key 返回完整定义，含 fields / resources） */
export interface DsType {
  key: string;
  name: string;
  desc: string;
  conn: DsConn;
  defaultPort: number;
  available: boolean;
  driverPkg: string | null;
  resourceCount: number;
  category?: string;
  driver?: string;
  fields?: string[];
  resources?: DsTypeResource[];
}

export interface DsTypeCategory {
  key: string;
  name: string;
  icon: string;
  desc: string;
  types: DsType[];
}

export interface DsStats {
  categories: number;
  types: number;
  available: number;
  unavailable: number;
  sqlTypes: number;
  apiTypes: number;
}

export type Datasource = {
  id: number;
  name: string;
  type: string;
  host?: string;
  port?: number;
  user?: string;
  database?: string;
  options?: Record<string, unknown> | null;
  remark?: string;
  isDefault?: boolean;
  status: number;
  lastTestAt?: string | null;
  lastTestOk?: boolean | null;
  lastTestMsg?: string;
  createdAt?: string;
  updatedAt?: string;
};

export interface DatasourceListResult {
  list: Datasource[];
  catalog: DsTypeCategory[];
  stats: DsStats;
}

export interface DatasourceTypeMeta {
  categories: DsTypeCategory[];
  catalog: DsTypeCategory[];
  stats: DsStats;
}

export interface DsTestResult {
  ok: boolean;
  elapsed?: number;
  message?: string;
  version?: string;
}

export interface DsTableInfo {
  name: string;
  comment?: string;
}

export interface DsColumnInfo {
  name: string;
  type?: string;
  comment?: string;
}

export interface DatasourcePayload {
  name: string;
  type: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  options?: Record<string, unknown> | null;
  remark?: string;
  status?: number;
}

/** 后端「测试连接」类接口用 HTTP 200 + {ok:false} 承载失败，这里保留原始结果 */
export interface RawActionResult<T> {
  ok: boolean;
  data?: T;
  message?: string;
}

/** 数据源列表（同时带回类型目录与统计） */
export async function listDatasources(): Promise<DatasourceListResult> {
  return api.get<DatasourceListResult>('/datasources');
}

/** 全部类型目录（无需登录权限之外的限制，用于新建表单） */
export async function listDatasourceTypes(): Promise<DatasourceTypeMeta> {
  return api.get<DatasourceTypeMeta>('/datasource-types');
}

/** 单个类型详情：含 fields（连接参数字段）与 resources（可接资源） */
export async function getDatasourceType(key: string): Promise<DsType> {
  return api.get<DsType>(`/datasource-types/${encodeURIComponent(key)}`);
}

export async function createDatasource(payload: DatasourcePayload): Promise<Datasource> {
  return api.post<Datasource>('/datasources', payload);
}

export async function updateDatasource(
  id: number,
  payload: Partial<DatasourcePayload>
): Promise<Datasource> {
  return api.put<Datasource>(`/datasources/${id}`, payload);
}

export async function deleteDatasource(id: number): Promise<void> {
  await api.delete(`/datasources/${id}`);
}

/** 测试已保存的数据源连接 */
export async function testDatasource(id: number): Promise<RawActionResult<DsTestResult>> {
  return api.post<RawActionResult<DsTestResult>>(`/datasources/${id}/test`, undefined, {
    silent: true,
    raw: true,
  });
}

/** 测试尚未保存的连接参数 */
export async function testDatasourceRaw(payload: {
  type: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}): Promise<RawActionResult<DsTestResult>> {
  return api.post<RawActionResult<DsTestResult>>('/datasources/test-raw', payload, {
    silent: true,
    raw: true,
  });
}

/** 数据源下的数据表 */
export async function listDatasourceTables(id: number, keyword?: string): Promise<DsTableInfo[]> {
  return api.get<DsTableInfo[]>(`/datasources/${id}/tables` + qs({ keyword }));
}

/** 数据表字段 */
export async function listDatasourceColumns(id: number, table: string): Promise<DsColumnInfo[]> {
  return api.get<DsColumnInfo[]>(
    `/datasources/${id}/tables/${encodeURIComponent(table)}/columns`
  );
}
