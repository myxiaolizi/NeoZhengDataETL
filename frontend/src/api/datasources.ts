/** 鏁版嵁婧?API 灏佽锛堝榻?src/datasources.js + src/dstypes.js + routes/api.js锛?*/
import { api, qs } from '@/api/client';

export type DsConn = 'sql' | 'api';

export interface DsTypeResource {
  key: string;
  name: string;
  api: string;
}

/** 鏁版嵁婧愮被鍨嬶紙/datasource-types/:key 杩斿洖瀹屾暣瀹氫箟锛屽惈 fields / resources锛?*/
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
}

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

/** 鍚庣銆屾祴璇曡繛鎺ャ€嶇被鎺ュ彛鐢?HTTP 200 + {ok:false} 鎵胯浇澶辫触锛岃繖閲屼繚鐣欏師濮嬬粨鏋?*/
export interface RawActionResult<T> {
  ok: boolean;
  data?: T;
  message?: string;
}

/** 鏁版嵁婧愬垪琛紙鍚屾椂甯﹀洖绫诲瀷鐩綍涓庣粺璁★級 */
export async function listDatasources(): Promise<DatasourceListResult> {
  return api.get<DatasourceListResult>('/datasources');
}

/** 鍏ㄩ儴绫诲瀷鐩綍锛堟棤闇€鐧诲綍鏉冮檺涔嬪鐨勯檺鍒讹紝鐢ㄤ簬鏂板缓琛ㄥ崟锛?*/
export async function listDatasourceTypes(): Promise<DatasourceTypeMeta> {
  return api.get<DatasourceTypeMeta>('/datasource-types');
}

/** 鍗曚釜绫诲瀷璇︽儏锛氬惈 fields锛堣繛鎺ュ弬鏁板瓧娈碉級涓?resources锛堝彲鎺ヨ祫婧愶級 */
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

/** 娴嬭瘯宸蹭繚瀛樼殑鏁版嵁婧愯繛鎺?*/
export async function testDatasource(id: number): Promise<RawActionResult<DsTestResult>> {
  return api.post<RawActionResult<DsTestResult>>(`/datasources/${id}/test`, undefined, {
    silent: true,
    raw: true,
  });
}

/** 娴嬭瘯灏氭湭淇濆瓨鐨勮繛鎺ュ弬鏁?*/
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

/** 鏁版嵁婧愪笅鐨勬暟鎹〃 */
export async function listDatasourceTables(id: number, keyword?: string): Promise<DsTableInfo[]> {
  return api.get<DsTableInfo[]>(`/datasources/${id}/tables` + qs({ keyword }));
}

/** 鏁版嵁琛ㄥ瓧娈?*/
export async function listDatasourceColumns(id: number, table: string): Promise<DsColumnInfo[]> {
  return api.get<DsColumnInfo[]>(
    `/datasources/${id}/tables/${encodeURIComponent(table)}/columns`
  );
}

