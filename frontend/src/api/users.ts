/** 系统管理域 API：用户 / 角色 / 权限点 / 组织架构 / 个人资料 / 登录设备 / 审计 / 治理 */
import { api, qs } from '@/api/client';
import type { AuditLog, Role, User } from '@/types';

/* ══════════════ 类型（对齐后端真实返回） ══════════════ */

export interface PermissionItem {
  key: string;
  name: string;
  desc: string;
}

export interface PermissionGroup {
  key: string;
  name: string;
  items: PermissionItem[];
}

export interface PermissionMeta {
  groups: PermissionGroup[];
  all: string[];
  names: Record<string, string>;
}

/** 角色行（后端 publicRole 的完整字段） */
export interface RoleRow extends Role {
  key: string;
  permissionNames: string[];
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface RoleListResult {
  list: RoleRow[];
  groups: PermissionGroup[];
  all: string[];
}

/** 用户行（users.list 附加字段） */
export interface UserRow extends User {
  emailVerified: boolean;
  phone: string;
  position: string;
  departmentId: number | null;
  department: string;
  projectCount: number;
  lastLoginIp?: string;
  updatedAt?: string;
}

export interface UserStats {
  total: number;
  active: number;
  admins: number;
}

export interface UsersResult {
  list: UserRow[];
  stats: UserStats;
  roles: Record<string, RoleRow>;
}

export interface CreateUserInput {
  username: string;
  password: string;
  displayName?: string;
  email?: string;
  role?: string;
  status?: number;
  departmentId?: number | null;
  position?: string;
  phone?: string;
  sendVerify?: boolean;
  sendMail?: boolean;
}

export interface UpdateUserInput {
  displayName?: string;
  email?: string;
  role?: string;
  status?: number;
  password?: string;
  departmentId?: number | null;
  position?: string;
  phone?: string;
}

/** 部门（departments.list 的 publicDept 字段） */
export interface DeptRow {
  id: number;
  name: string;
  parentId: number;
  code: string;
  leader: string;
  sortOrder: number;
  remark: string;
  userCount: number;
  createdAt?: string;
}

export interface DeptNode extends DeptRow {
  children: DeptNode[];
}

export interface DeptStats {
  depts: number;
  assigned: number;
  total: number;
}

export interface DeptResult {
  list: DeptRow[];
  tree: DeptNode[];
  stats: DeptStats;
}

export interface DeptMember {
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  role: string;
  status: number;
  department_id: number | null;
  position: string | null;
}

/** 登录设备（me/sessions） */
export interface MeSession {
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
}

/** 兼容旧命名 */
export type SessionRow = MeSession;

/** 当前登录用户（/api/me 额外返回的档案字段；公共 User 类型不含这些键） */
export interface MeUser extends User {
  phone?: string;
  position?: string;
  emailVerified?: boolean;
  department?: string;
  lastLoginIp?: string;
  updatedAt?: string;
}

export interface ProfileInput {
  displayName?: string;
  email?: string;
  phone?: string;
  position?: string;
}

export interface AvatarInput {
  avatar?: string;
  avatarColor?: string | null;
}

/** 审计日志行（后端直接返回表字段，snake_case） */
export interface AuditRow {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  actionName: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
  ip: string | null;
  created_at: string;
}

export interface AuditStats {
  total: number;
  today: number;
  users: number;
}

export interface AuditQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  action?: string;
  username?: string;
  startDate?: string;
  endDate?: string;
}

export interface AuditResult {
  list: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  stats: AuditStats;
  actions: Record<string, string>;
}

/** 治理总览行 */
export interface GovernanceRow {
  id: number;
  name: string;
  code: string;
  datasourceId: number;
  datasourceName: string;
  dataTable: string;
  parsedTable: string;
  logTable: string;
  dataCount: number;
  parsedCount: number;
  rawCols: number;
  parsedCols: number;
  commentedCols: number;
  fieldTotal: number;
  fieldParsed: number;
  fieldNoRemark: number;
  lastPushAt: string | null;
}

export interface SchemaColumn {
  name: string;
  columnType: string;
  dataType?: string;
  comment?: string;
}

export interface FieldDefRow {
  id: number;
  project_id: number;
  field_name: string;
  field_key: string;
  field_type: string;
  remark: string | null;
  column_name: string;
  parse_mode: string;
  parse_path: string | null;
  source_key: string | null;
  sub_table: string | null;
  is_system: number;
  sort_order: number;
  enabled: number;
}

export interface ProjectSchema {
  project: {
    id: number;
    name: string;
    code: string;
    dataTable: string;
    parsedTable: string;
    logTable: string;
    datasourceId: number;
  };
  rawColumns: SchemaColumn[];
  parsedColumns: SchemaColumn[];
  fieldDefs: FieldDefRow[];
}

/* ══════════════ 用户 ══════════════ */

export function listUsers(keyword?: string) {
  return api.get<UsersResult>('/users' + qs({ keyword }));
}

export function createUser(body: CreateUserInput) {
  return api.post<UserRow>('/users', body);
}

export function updateUser(id: number, body: UpdateUserInput) {
  return api.put<UserRow>(`/users/${id}`, body);
}

export function deleteUser(id: number) {
  return api.delete<null>(`/users/${id}`);
}

/** 管理员重置密码（后端字段名为 newPassword） */
export function resetUserPassword(id: number, newPassword: string) {
  return api.post<null>(`/users/${id}/reset-password`, { newPassword });
}

/** 给用户发送重置密码邮件 */
export function sendUserResetMail(id: number) {
  return api.post<null>(`/users/${id}/send-reset`);
}

/* ══════════════ 角色与权限点 ══════════════ */

export function listRoles() {
  return api.get<RoleListResult>('/roles');
}

export function getPermissions() {
  return api.get<PermissionMeta>('/permissions');
}

export interface RoleInput {
  key?: string;
  name?: string;
  description?: string;
  permissions?: string[];
  sortOrder?: number;
}

export function createRole(body: RoleInput) {
  return api.post<RoleRow>('/roles', body);
}

export function updateRole(id: number, body: RoleInput) {
  return api.put<RoleRow>(`/roles/${id}`, body);
}

export function deleteRole(id: number) {
  return api.delete<null>(`/roles/${id}`);
}

/* ══════════════ 组织架构 ══════════════ */

export function listDepartments() {
  return api.get<DeptResult>('/departments');
}

export interface DeptInput {
  name?: string;
  parentId?: number;
  code?: string;
  leader?: string;
  sortOrder?: number;
  remark?: string;
}

export function createDepartment(body: DeptInput) {
  return api.post<DeptRow>('/departments', body);
}

export function updateDepartment(id: number, body: DeptInput) {
  return api.put<DeptRow>(`/departments/${id}`, body);
}

export function deleteDepartment(id: number) {
  return api.delete<null>(`/departments/${id}`);
}

export function listDepartmentUsers(id: number, includeChildren = false) {
  return api.get<DeptMember[]>(`/departments/${id}/users` + qs({ children: includeChildren ? '1' : '' }));
}

/** 首次使用：创建默认组织架构 */
export function initDepartments() {
  return api.post<null>('/departments/init');
}

/* ══════════════ 个人资料 / 密码 / 登录设备 ══════════════ */

export function getMe() {
  return api.get<MeUser>('/me');
}

/** 资料字段（昵称/邮箱/手机/职位） */
export function updateProfile(body: ProfileInput) {
  return api.put<null>('/me', body);
}

/** 头像与头像底色 */
export function updateAvatar(body: AvatarInput) {
  return api.put<MeUser>('/me/profile', body);
}

export interface ChangePasswordInput {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export function changePassword(body: ChangePasswordInput) {
  return api.post<{ relogin?: boolean }>('/me/password', body);
}

export function listSessions() {
  return api.get<SessionRow[]>('/me/sessions');
}

export function revokeOtherSessions() {
  return api.delete<null>('/me/sessions');
}

/* ══════════════ 审计日志 ══════════════ */

export function listAuditLogs(query: AuditQuery) {
  return api.get<AuditResult>('/audit-logs' + qs(query));
}

/** 按保留策略清理过期审计日志与登录日志 */
export function cleanupAuditLogs() {
  return api.post<null>('/audit-logs/cleanup');
}

/* ══════════════ 数据治理 ══════════════ */

export function getGovernanceOverview() {
  return api.get<GovernanceRow[]>('/governance/overview');
}

export function getProjectSchema(id: number) {
  return api.get<ProjectSchema>(`/governance/projects/${id}/schema`);
}

/** 审计日志 → 通用 AuditLog 视图（供其他页面复用） */
export function toAuditLog(row: AuditRow): AuditLog {
  return {
    id: row.id,
    username: row.username || undefined,
    action: row.action,
    actionName: row.actionName,
    targetType: row.target_type || undefined,
    targetId: row.target_id || undefined,
    detail: row.detail || undefined,
    ip: row.ip || undefined,
    createdAt: row.created_at,
  };
}

/** 部门树 → antd Tree 数据 */
export interface DeptTreeNode {
  key: number;
  title: string;
  dept: DeptRow;
  children?: DeptTreeNode[];
}

export function toDeptTree(nodes: DeptNode[]): DeptTreeNode[] {
  return nodes.map((n) => ({
    key: n.id,
    title: n.name,
    dept: n,
    children: n.children && n.children.length ? toDeptTree(n.children) : undefined,
  }));
}
