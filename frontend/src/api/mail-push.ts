/** 閭鎺ㄩ€?API 灏佽锛堝榻?src/mail-accounts.js / src/mail-inbox.js / src/mail-push.js锛?*/
import { api, qs } from '@/api/client';

/** 璐︽埛琛岋細snake_case锛宲assword 宸插湪鏈嶅姟绔墧闄わ紝浠呯暀 hasPassword */
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
  /** 缂栬緫鏃剁暀绌鸿〃绀轰笉淇敼 */
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

/** 瀵煎叆鏃ュ織琛岋紙jdywh_mail_push_logs锛?*/
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

/* ---------------- 璐︽埛 ---------------- */

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

/** 娴嬭瘯 IMAP 杩炴帴锛堟敮鎸佹湭淇濆瓨鍙傛暟锛涘け璐ヨ繑鍥?ok:false 鑰屼笉鏄姏閿欙級 */
export async function testMailAccount(
  payload: Partial<MailAccountPayload> & { id?: number }
): Promise<RawActionResult<{ ok: boolean; message: string; total?: number }>> {
  return api.post('/mail-push/test', payload, { silent: true, raw: true }) as Promise<
    RawActionResult<{ ok: boolean; message: string; total?: number }>
  >;
}

/* ---------------- 閭欢娴忚 ---------------- */

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

/* ---------------- 鎷夊彇涓庣姸鎬?---------------- */

/** 鎵嬪姩瑙﹀彂涓€娆℃媺鍙栵紙鍙寚瀹氳处鎴凤級锛涘け璐ヤ篃杩斿洖缁撴灉 */
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

