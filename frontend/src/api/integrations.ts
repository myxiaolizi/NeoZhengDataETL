/** 鏁版嵁闆嗘垚 API 灏佽锛堝榻?src/integrations.js锛?*/
import { api, qs } from '@/api/client';

export type IntegrationDirection = 'pull' | 'push';
export type IntegrationTrigger = 'manual' | 'schedule' | 'webhook';

/** 鍏紑琛岀粨鏋勶細publicRow() 杈撳嚭锛宧eaders/params/authConfig/fieldMap 涓哄璞?*/
export type Integration = {
  id: number;
  name: string;
  code: string;
  direction: IntegrationDirection;
  projectId: number | null;
  protocol: 'http' | 'https';
  method: string;
  url: string;
  headers: Record<string, string>;
  params: Record<string, string>;
  body: string;
  authType: 'none' | 'bearer' | 'basic' | 'apikey' | string;
  authConfig: Record<string, string>;
  dataPath: string;
  fieldMap: Record<string, string>;
  schedule: string;
  triggerType: IntegrationTrigger | string;
  lastRunAt?: string | null;
  lastRunOk?: boolean | null;
  lastRunMsg?: string;
  runCount: number;
  successCount: number;
  status: number;
  createdAt?: string;
  updatedAt?: string;
  /** 鍒楄〃鎺ュ彛闄勫姞 */
  projectName?: string;
}

export interface IntegrationStats {
  total: number;
  pullCount: number;
  pushCount: number;
  active: number;
  runTotal: number;
  runOk: number;
  rowsTotal: number;
}

export interface IntegrationListResult {
  list: Integration[];
  stats: IntegrationStats;
}

/** 闆嗘垚杩愯鏃ュ織锛坖dywh_integration_logs 鍘熷琛岋級 */
export type IntegrationLogRow = {
  id: number;
  integration_id: number;
  direction: string;
  trigger_source: string;
  success: number;
  rows_affected: number;
  http_status: number | null;
  message: string;
  request_snapshot: string | null;
  response_snapshot: string | null;
  duration_ms: number;
  created_at: string;
}

export interface LogPage {
  list: IntegrationLogRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** run() 杩斿洖鐨勬棩蹇楀璞★紙鍐呭瓨缁撴瀯锛岄潪 DB 琛岋級 */
export interface IntegrationRunLog {
  integrationId: number;
  direction: string;
  triggerSource: string;
  success: boolean;
  rowsAffected: number;
  httpStatus: number | null;
  message: string;
  requestSnapshot: string | null;
  responseSnapshot: string | null;
  durationMs: number;
}

export interface RawActionResult<T> {
  ok: boolean;
  data?: T;
  message?: string;
}

export interface IntegrationPayload {
  name: string;
  code?: string;
  direction?: IntegrationDirection;
  projectId?: number | null;
  protocol?: 'http' | 'https';
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  body?: string;
  authType?: string;
  authConfig?: Record<string, string>;
  dataPath?: string;
  fieldMap?: Record<string, string>;
  schedule?: string;
  triggerType?: string;
  status?: number;
}

export async function listIntegrations(params?: {
  direction?: string;
  keyword?: string;
}): Promise<IntegrationListResult> {
  return api.get<IntegrationListResult>(
    '/integrations' + qs({ direction: params?.direction, keyword: params?.keyword })
  );
}

export async function getIntegration(id: number): Promise<Integration> {
  return api.get<Integration>(`/integrations/${id}`);
}

export async function createIntegration(payload: IntegrationPayload): Promise<Integration> {
  return api.post<Integration>('/integrations', payload);
}

export async function updateIntegration(
  id: number,
  payload: Partial<IntegrationPayload>
): Promise<Integration> {
  return api.put<Integration>(`/integrations/${id}`, payload);
}

export async function deleteIntegration(id: number): Promise<void> {
  await api.delete(`/integrations/${id}`);
}

/** 鎵嬪姩鎵ц浠诲姟锛涙墽琛屽け璐ヤ篃杩斿洖缁撴灉锛堜笉鎶涢敊锛夛紝鐢遍〉闈㈠睍绀?message */
export async function runIntegration(
  id: number,
  opts?: { limit?: number; dataId?: string; useParsed?: boolean; single?: boolean }
): Promise<RawActionResult<IntegrationRunLog>> {
  return api.post<RawActionResult<IntegrationRunLog>>(`/integrations/${id}/run`, opts || {}, {
    silent: true,
    raw: true,
  });
}

/** 鍗曚釜浠诲姟鐨勮繍琛屾棩蹇楋紙鏈嶅姟绔垎椤碉級 */
export async function listIntegrationLogs(
  id: number,
  page = 1,
  pageSize = 20
): Promise<LogPage> {
  return api.get<LogPage>(`/integrations/${id}/logs` + qs({ page, pageSize }));
}

/** 鍏ㄩ儴浠诲姟鐨勮繍琛屾棩蹇楋紙鏈嶅姟绔垎椤碉級 */
export async function listAllIntegrationLogs(page = 1, pageSize = 20): Promise<LogPage> {
  return api.get<LogPage>('/integration-logs' + qs({ page, pageSize }));
}

