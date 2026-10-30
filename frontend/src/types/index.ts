/** 全局类型定义：对齐后端 API 契约 */

export interface User {
  id: number;
  username: string;
  displayName?: string;
  email?: string;
  role: string;
  roleName?: string;
  permissions: string[];
  avatar?: string;
  avatarColor?: string;
  status?: number;
  lastLoginAt?: string;
  createdAt?: string;
}

export interface LoginPayload {
  username: string;
  password: string;
  remember?: boolean;
}

export interface ProjectGroup {
  id: number;
  name: string;
  parentId: number | null;
  code?: string;
  icon?: string;
  color?: string;
  sortOrder: number;
  remark?: string;
  projectCount?: number;
  totalProjectCount?: number;
  children?: ProjectGroup[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Project {
  id: number;
  name: string;
  code?: string;
  description?: string;
  token?: string;
  groupId?: number | null;
  groupName?: string;
  status: number;
  tableName?: string;
  logTable?: string;
  recordCount?: number;
  fieldCount?: number;
  parseMode?: string;
  tags?: string;
  createdAt?: string;
  updatedAt?: string;
  lastPushAt?: string;
}

export interface OverviewStats {
  projects: number;
  activeProjects: number;
  dataTotal: number;
  logTotal: number;
  datasources: number;
  datasets: number;
  reports: number;
  integrations: number;
  shares: number;
  aiChats: number;
  users?: number;
}

export interface OverviewData {
  stats: OverviewStats;
  recentLogs: any[];
}

export interface FieldDef {
  id?: number;
  fieldKey: string;
  label: string;
  type: string;
  widget?: string;
  parseMode?: string;
  parsePath?: string;
  sourceKey?: string;
  required?: boolean;
  sortOrder?: number;
  remark?: string;
}

export interface ProjectLog {
  id: number;
  op: string;
  opLabel?: string;
  dataId?: string;
  formName?: string;
  result: string;
  message?: string;
  projectId?: number;
  projectName?: string;
  createdAt: string;
}

export interface Datasource {
  id: number;
  name: string;
  type: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  status?: number;
  remark?: string;
  createdAt?: string;
}

export interface Dataset {
  id: number;
  name: string;
  code?: string;
  datasourceId?: number;
  datasourceName?: string;
  tableName?: string;
  rowCount?: number;
  status?: number;
  config?: any;
  createdAt?: string;
}

export interface Report {
  id: number;
  name: string;
  code?: string;
  description?: string;
  category?: string;
  reportType: string;
  datasetId?: number;
  datasetName?: string;
  config?: any;
  layout?: any;
  status: number;
  viewCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface FormItem {
  id: number;
  name: string;
  code?: string;
  description?: string;
  projectId?: number;
  status: number;
  fieldCount?: number;
  submitCount?: number;
  createdAt?: string;
}

export interface FlowItem {
  id: number;
  name: string;
  code?: string;
  description?: string;
  status: number;
  nodeCount?: number;
  runCount?: number;
  lastRunAt?: string;
  createdAt?: string;
}

export interface Integration {
  id: number;
  name: string;
  type: string;
  sourceId?: number;
  targetId?: number;
  status: number;
  lastSyncAt?: string;
  createdAt?: string;
}

export interface ShareItem {
  id: number;
  token: string;
  targetType: string;
  targetId: number;
  targetName?: string;
  status: number;
  expiresAt?: string;
  viewCount?: number;
  createdAt?: string;
}

export interface AuditLog {
  id: number;
  username?: string;
  action: string;
  actionName?: string;
  targetType?: string;
  targetId?: string;
  detail?: string;
  ip?: string;
  createdAt: string;
}

export interface MailAccount {
  id: number;
  name: string;
  email: string;
  host: string;
  port: number;
  mailbox: string;
  status: number;
  lastSyncAt?: string;
}

export interface MailMessage {
  id: number;
  uid: number;
  subject: string;
  from: string;
  to?: string;
  date: string;
  attachments?: any[];
  body?: string;
}

export interface PaginatedResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Role {
  id: number;
  key: string;
  name: string;
  description?: string;
  permissions: string[];
  isSystem?: boolean;
  userCount?: number;
}

export interface Department {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder?: number;
  children?: Department[];
}
