/** 邮箱推送 API 封装（对接 src/mail-accounts.js / src/mail-inbox.js / src/mail-push.js） */
import { api, qs } from '@/api/client';

/** 账户行：snake_case；password 已在服务端剔除，仅留 hasPassword */
export type MailAccount = {
  id: number;
  name: string;
  email: string;
  imap_host: string;
  imap_port: number;
  imap_secure: number;
  mailbox: string;
  enabled: number;
  auto_import: number;
  initial_days: number;
  max_per_run: number;
  last_uid: number;
  last_check_at?: string | null;
  last_status?: 'ok' | 'fail' | null;
  last_error?: string | null;
  created_at?: string;
  updated_at?: string;
  hasPassword?: boolean;
}

export interface MailAccountPayload {
  name?: string;
  email?: string;
  imap_host?: string;
  imap_port?: number;
  imap_secure?: number;
  mailbox?: string;
  enabled?: number;
  auto_import?: number;
  initial_days?: number;
  max_per_run?: number;
  /** 编辑时留空表示不修改 */
  password?: string;
}

export interface MailPreset {
  key: string;
  label: string;
  host: string;
  port: number;
  secure: number;
}

export type MailMessageSummary = {
  uid: number;
  seq: number;
  subject: string;
  from: string;
  to: string;
  date: string | null;
  seen: boolean;
  flagged: boolean;
  hasAttachment: boolean;
  hasExcel: boolean;
  size: number;
  messageId?: string | null;
}

export interface MailMessagesResult {
  total: number;
  mailbox: string;
  messages: MailMessageSummary[];
}

export interface MailAttachmentInfo {
  filename: string;
  size: number;
  contentType: string;
  isExcel: boolean;
}

export interface MailMessageDetail {
  uid: number;
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string | null;
  text: string;
  html: string;
  attachments: MailAttachmentInfo[];
}

export interface MailRunSummary {
  ok: boolean;
  accounts?: number;
  mails?: number;
  attachments?: number;
  imported?: number;
  skipped?: number;
  failed?: number;
  message?: string;
  details?: Array<{ account?: string; accountId?: number; result?: string; message?: string }>;
}

export interface MailPushStatus {
  enabled: boolean;
  accountCount: number;
  enabledCount: number;
  interval: number;
  running: boolean;
  scheduled: boolean;
  lastRunAt?: string | null;
  lastResult?: MailRunSummary | null;
  lastError?: string | null;
  perAccount?: Record<string, MailRunSummary>;
}

/** 导入日志行（jdywh_mail_push_logs） */
export type MailLogRow = {
  id: number;
  project_id?: number | null;
  project_name?: string;
  uid?: string;
  message_id?: string;
  subject?: string;
  from_addr?: string;
  filename?: string;
  wjmc?: string;
  rows_total?: number;
  rows_inserted?: number;
  rows_updated?: number;
  columns_total?: number;
  result: 'success' | 'skipped' | 'failed' | string;
  message?: string;
  created_at: string;
}

export interface MailPushOverview {
  projects: { total: number; rows: number };
  logs: { total: number; success: number; skipped: number; failed: number; today: number };
  accounts?: { total: number; enabled: number };
  recentImports: Array<{
    id: number;
    project_id?: number;
    project_name?: string;
    filename?: string;
    rows_total?: number;
    columns_total?: number;
    result?: string;
    created_at?: string;
  }>;
  trend?: Array<{ date: string; count: number }>;
}

export interface MailPushSettings {
  enabled: boolean;
  interval: number;
  initial_days: number;
  max_per_run: number;
}

export interface RawActionResult<T> {
  ok: boolean;
  data?: T;
  message?: string;
}

/* ---------------- 账户 ---------------- */

export async function listMailAccounts(): Promise<MailAccount[]> {
  return api.get<MailAccount[]>('/mail-push/accounts');
}

export async function getMailAccount(id: number): Promise<MailAccount> {
  return api.get<MailAccount>(`/mail-push/accounts/${id}`);
}

export async function listMailPresets(): Promise<MailPreset[]> {
  return api.get<MailPreset[]>('/mail-push/account-presets');
}

export async function createMailAccount(payload: MailAccountPayload): Promise<MailAccount> {
  return api.post<MailAccount>('/mail-push/accounts', payload);
}

export async function updateMailAccount(
  id: number,
  payload: MailAccountPayload
): Promise<MailAccount> {
  return api.put<MailAccount>(`/mail-push/accounts/${id}`, payload);
}

export async function deleteMailAccount(id: number): Promise<void> {
  await api.delete(`/mail-push/accounts/${id}`);
}

export async function toggleMailAccount(id: number, enabled: boolean): Promise<MailAccount> {
  return api.post<MailAccount>(`/mail-push/accounts/${id}/toggle`, { enabled: enabled ? 1 : 0 });
}

/** 测试 IMAP 连接（支持未保存参数；失败返回 ok:false 而不是抛错） */
export async function testMailAccount(
  payload: Partial<MailAccountPayload> & { id?: number }
): Promise<RawActionResult<{ ok: boolean; message: string; total?: number }>> {
  return api.post('/mail-push/test', payload, { silent: true, raw: true }) as Promise<
    RawActionResult<{ ok: boolean; message: string; total?: number }>
  >;
}

/* ---------------- 邮件浏览 ---------------- */

export async function listMailMessages(
  accountId: number,
  opts?: { mailbox?: string; limit?: number; offset?: number; onlyAttachments?: boolean }
): Promise<MailMessagesResult> {
  return api.get<MailMessagesResult>(
    `/mail-push/accounts/${accountId}/messages` +
      qs({
        mailbox: opts?.mailbox,
        limit: opts?.limit,
        offset: opts?.offset,
        onlyAttachments: opts?.onlyAttachments ? '1' : '',
      })
  );
}

export async function getMailMessage(
  accountId: number,
  uid: number,
  mailbox?: string
): Promise<MailMessageDetail> {
  return api.get<MailMessageDetail>(
    `/mail-push/accounts/${accountId}/messages/${uid}` + qs({ mailbox })
  );
}

/* ---------------- 拉取与状态 ---------------- */

/** 手动触发一次拉取（可指定账户）；失败也返回结果 */
export async function runMailPush(opts?: {
  force?: boolean;
  accountId?: number | null;
}): Promise<RawActionResult<MailRunSummary>> {
  return api.post<RawActionResult<MailRunSummary>>('/mail-push/run', opts || {}, {
    silent: true,
    raw: true,
  });
}

export async function getMailPushStatus(): Promise<MailPushStatus> {
  return api.get<MailPushStatus>('/mail-push/status');
}

export async function getMailPushOverview(): Promise<MailPushOverview> {
  return api.get<MailPushOverview>('/mail-push/overview');
}

export async function listMailLogs(opts?: {
  limit?: number;
  result?: string;
  projectId?: number;
  keyword?: string;
}): Promise<MailLogRow[]> {
  return api.get<MailLogRow[]>(
    '/mail-push/logs' +
      qs({
        limit: opts?.limit,
        result: opts?.result,
        projectId: opts?.projectId,
        keyword: opts?.keyword,
      })
  );
}

export async function getMailPushSettings(): Promise<MailPushSettings> {
  return api.get<MailPushSettings>('/mail-push/settings');
}

export async function saveMailPushSettings(payload: Partial<MailPushSettings>): Promise<void> {
  await api.put('/mail-push/settings', payload);
}

/* ---------------- 数据项目（邮件附件导入后的数据管理） ---------------- */

/**
 * 邮件推送数据项目（jdywh_mail_push_projects）
 * 每个项目对应一张物理数据表 data_table（jdywh_mail_<id>）
 */
export type MailProject = {
  id: number;
  name: string;
  code?: string;
  data_table: string;
  source_mail?: string | null;
  row_count?: number;
  last_file?: string | null;
  last_import_at?: string | null;
  status?: number;
  created_at?: string;
  updated_at?: string;
};

/** 数据表物理列（information_schema.COLUMNS，comment 为中文列名） */
export type MailProjectColumn = {
  name: string;
  type: string;
  comment?: string | null;
  pos?: number;
  extra?: string | null;
  ckey?: string | null;
};

/** 数据行：列名 → 值（值均来自 MySQL，基本为字符串/数字/null） */
export type MailRow = Record<string, string | number | boolean | null>;

export interface MailProjectRowsResult {
  rows: MailRow[];
  total: number;
  page: number;
  size: number;
  columns: MailProjectColumn[];
}

export interface MailProjectDetail {
  project: MailProject;
  columns: MailProjectColumn[];
  preview: MailRow[];
}

export async function listMailProjects(): Promise<MailProject[]> {
  return api.get<MailProject[]>('/mail-push/projects');
}

export async function getMailProject(id: number, limit = 20): Promise<MailProjectDetail> {
  return api.get<MailProjectDetail>(`/mail-push/projects/${id}` + qs({ limit }));
}

/** 分页读取项目数据（keyword 在文本列内模糊搜索，sort 仅允许物理列名） */
export async function listMailProjectRows(
  id: number,
  opts?: {
    page?: number;
    size?: number;
    keyword?: string;
    sort?: string;
    order?: 'asc' | 'desc';
  }
): Promise<MailProjectRowsResult> {
  return api.get<MailProjectRowsResult>(
    `/mail-push/projects/${id}/rows` +
      qs({
        page: opts?.page,
        size: opts?.size,
        keyword: opts?.keyword,
        sort: opts?.sort,
        order: opts?.order,
      })
  );
}

export async function listMailProjectColumns(id: number): Promise<MailProjectColumn[]> {
  const d = await api.get<{ columns: MailProjectColumn[] }>(`/mail-push/projects/${id}/columns`);
  return d?.columns || [];
}

/** 导出 CSV 的直链（后端返回 Content-Disposition: attachment，浏览器直接下载） */
export function mailProjectExportUrl(id: number): string {
  return `/api/mail-push/projects/${id}/export`;
}

export async function updateMailProject(
  id: number,
  payload: { name?: string; status?: number }
): Promise<MailProject> {
  return api.put<MailProject>(`/mail-push/projects/${id}`, payload);
}

/** 清空项目数据（保留表结构）；返回后端原始消息 */
export async function clearMailProject(id: number): Promise<RawActionResult<{ deleted: number }>> {
  return api.post(`/mail-push/projects/${id}/clear`, {}, { silent: true, raw: true }) as Promise<
    RawActionResult<{ deleted: number }>
  >;
}

/** 删除项目；dropTable=true 时连同数据表一起删除 */
export async function deleteMailProject(
  id: number,
  dropTable = true
): Promise<RawActionResult<void>> {
  return api.delete(`/mail-push/projects/${id}` + qs({ dropTable: dropTable ? 1 : '' }), {
    silent: true,
    raw: true,
  }) as Promise<RawActionResult<void>>;
}

