/** 系统设置 API：分组元数据由后端 settings.GROUPS 下发，前端按字段类型动态渲染 */
import { api } from '@/api/client';

/** 后端支持的字段类型（settings.GROUPS[].fields[].type） */
export type SettingFieldType =
  | 'text'
  | 'password'
  | 'number'
  | 'switch'
  | 'select'
  | 'color'
  | 'textarea'
  | 'datasource'
  | 'aiprovider'
  | 'aimodel';

export interface SettingOption {
  value: string;
  label: string;
}

export interface SettingField {
  key: string;
  label: string;
  type: SettingFieldType;
  placeholder?: string;
  hint?: string;
  min?: number;
  max?: number;
  options?: SettingOption[];
}

export interface SettingGroup {
  key: string;
  title: string;
  desc?: string;
  icon?: string;
  fields: SettingField[];
}

/** GET /api/settings → { values, groups, mailReady } */
export interface SettingsPayload {
  values: Record<string, string>;
  groups: SettingGroup[];
  mailReady: boolean;
}

/** AI 供应商预设（GET /api/ai/providers） */
export interface AiModelOption {
  key: string;
  name: string;
  default?: boolean;
}

export interface AiProvider {
  key: string;
  name: string;
  baseUrl: string;
  models: AiModelOption[];
  keyUrl?: string | null;
  note?: string;
  custom?: boolean;
  noKey?: boolean;
}

/** 可选项：数据源（settings 中 datasource 类型字段） */
export interface DatasourceOption {
  id: number;
  name: string;
  type: string;
}

export function getSettings() {
  return api.get<SettingsPayload>('/settings');
}

/** 只提交需要修改的键；敏感字段留空表示不修改（后端已处理） */
export function saveSettings(values: Record<string, string>) {
  return api.put<null>('/settings', { values });
}

export function testMail(to: string) {
  return api.post<null>('/settings/test-mail', { to });
}

/** 测试大模型连接（需 ai:config 权限） */
export function testAi() {
  return api.post<{ ok: boolean; message?: string }>('/ai/test', undefined, { silent: true });
}

export function listAiProviders() {
  return api.get<AiProvider[]>('/ai/providers', { silent: true });
}

/** 数据源下拉选项（settings 中 datasource 类型字段） */
export async function listDatasourceOptions(): Promise<DatasourceOption[]> {
  try {
    const data = await api.get<{ list: DatasourceOption[] }>('/datasources', { silent: true });
    return (data.list || []).map((d) => ({ id: d.id, name: d.name, type: d.type }));
  } catch {
    return [];
  }
}

/** 设置值 → 是否开启（后端统一用 '1'/'0' 字符串存储） */
export function isOn(value: unknown): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase());
}
