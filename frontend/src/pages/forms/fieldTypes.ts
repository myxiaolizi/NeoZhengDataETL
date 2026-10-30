/** 表单字段元数据与工具：设计器 / 数据页 / 公开表单共用 */
import type { FormField, FormFieldTypeDef, FormMeta } from '@/api/forms';

/* ══════════════ 字段类型（与后端 src/forms.js FIELD_TYPES 对齐） ══════════════ */

/** 兜底元数据：/api/form-field-types 拉取失败时仍可用 */
export const FALLBACK_TYPES: FormFieldTypeDef[] = [
  { key: 'text', name: '单行文本', icon: '▭', group: '基础' },
  { key: 'textarea', name: '多行文本', icon: '▤', group: '基础' },
  { key: 'number', name: '数字', icon: '#', group: '基础' },
  { key: 'amount', name: '金额', icon: '¥', group: '基础' },
  { key: 'percent', name: '百分比', icon: '%', group: '基础' },
  { key: 'select', name: '下拉选择', icon: '▾', group: '选择' },
  { key: 'radio', name: '单选', icon: '◉', group: '选择' },
  { key: 'checkbox', name: '多选', icon: '☑', group: '选择' },
  { key: 'date', name: '日期', icon: '▦', group: '日期时间' },
  { key: 'datetime', name: '日期时间', icon: '◷', group: '日期时间' },
  { key: 'time', name: '时间', icon: '◔', group: '日期时间' },
  { key: 'daterange', name: '日期区间', icon: '⇹', group: '日期时间' },
  { key: 'member', name: '成员选择', icon: '◐', group: '高级' },
  { key: 'department', name: '部门选择', icon: '⛢', group: '高级' },
  { key: 'image', name: '图片上传', icon: '▣', group: '高级' },
  { key: 'file', name: '附件上传', icon: '⎘', group: '高级' },
  { key: 'address', name: '地址', icon: '⌂', group: '高级' },
  { key: 'location', name: '定位', icon: '◈', group: '高级' },
  { key: 'rating', name: '评分', icon: '★', group: '高级' },
  { key: 'slider', name: '滑块', icon: '⇔', group: '高级' },
  { key: 'formula', name: '公式计算', icon: 'ƒ', group: '高级' },
  { key: 'divider', name: '分割线', icon: '—', group: '布局' },
  { key: 'section', name: '分组标题', icon: '▬', group: '布局' },
  { key: 'table', name: '子表格', icon: '▦', group: '布局' },
];

/** 兜底表单类型 */
export const FALLBACK_FORM_TYPES = [
  { key: 'fill', name: '填写表单', icon: '▤', desc: '常规数据采集，提交即完成' },
  { key: 'flow', name: '流程表单', icon: '⇉', desc: '提交后进入多级审批流程' },
  { key: 'exam', name: '考试表单', icon: '✎', desc: '含题目与分值，提交后自动判分' },
];

/** 兜底宽度定义 */
export const FALLBACK_WIDTHS = [
  { key: '1/5' as const, name: '1/5 宽', span: 5 },
  { key: '1/4' as const, name: '1/4 宽', span: 6 },
  { key: '1/3' as const, name: '1/3 宽', span: 8 },
  { key: '1/2' as const, name: '1/2 宽', span: 12 },
  { key: '1' as const, name: '整行', span: 24 },
];

/** 分组顺序 */
export const TYPE_GROUPS = ['基础', '选择', '日期时间', '高级', '布局'];

/** 取字段类型中文名 */
export function typeName(type: string, meta?: FormMeta | null): string {
  const list = meta?.types?.length ? meta.types : FALLBACK_TYPES;
  return list.find((t) => t.key === type)?.name || type;
}

/** 取字段类型图标 */
export function typeIcon(type: string, meta?: FormMeta | null): string {
  const list = meta?.types?.length ? meta.types : FALLBACK_TYPES;
  return list.find((t) => t.key === type)?.icon || '▭';
}

/** 取宽度中文名 */
export function widthName(width: string | undefined, meta?: FormMeta | null): string {
  const list = meta?.widths?.length ? meta.widths : FALLBACK_WIDTHS;
  const w = width === 'full' ? '1' : width === 'half' ? '1/2' : width || '1';
  return list.find((x) => x.key === w)?.name || '整行';
}

/** 宽度 → 24 栅格 span */
export function widthToSpan(width: string | undefined): number {
  switch (width) {
    case '1/5': return 5;
    case '1/4': return 6;
    case '1/3': return 8;
    case '1/2':
    case 'half': return 12;
    default: return 24;
  }
}

/** 分组后的字段类型（设计器左侧面板用） */
export function groupTypes(
  types: FormFieldTypeDef[]
): { group: string; items: FormFieldTypeDef[] }[] {
  const groups: { group: string; items: FormFieldTypeDef[] }[] = [];
  for (const g of TYPE_GROUPS) {
    const items = types.filter((t) => t.group === g);
    if (items.length) groups.push({ group: g, items });
  }
  // 未知分组兜底
  const known = new Set(TYPE_GROUPS);
  const rest = types.filter((t) => !known.has(t.group));
  if (rest.length) groups.push({ group: '其他', items: rest });
  return groups;
}

/** 生成字段 key：type_随机串（与历史数据风格一致） */
export function makeFieldKey(type: string, used: string[] = []): string {
  const base = String(type || 'field').replace(/[^a-zA-Z0-9_]/g, '_');
  for (let i = 0; i < 200; i += 1) {
    const rand = Math.random().toString(36).slice(2, 9);
    const key = `${base}_${rand}`;
    if (!used.includes(key)) return key;
  }
  return `${base}_${Date.now().toString(36)}`;
}

/** 按类型生成新字段默认配置 */
export function createField(
  type: string,
  meta?: FormMeta | null,
  used: string[] = []
): FormField {
  const name = typeName(type, meta);
  const field: FormField = {
    key: makeFieldKey(type, used),
    type,
    label: name,
    placeholder: '',
    required: false,
    defaultValue: '',
    options: [],
    optionLayout: type === 'select' ? 'dropdown' : 'horizontal',
    min: null,
    max: null,
    precision: null,
    formula: '',
    hint: '',
    width: '1',
    score: 0,
    answer: '',
    columns: [],
  };
  if (type === 'select' || type === 'radio' || type === 'checkbox') {
    field.options = ['选项一', '选项二'];
  }
  if (type === 'rating') {
    field.max = 5;
  }
  if (type === 'slider') {
    field.min = 0;
    field.max = 100;
  }
  if (type === 'number' || type === 'amount' || type === 'percent') {
    field.precision = type === 'percent' ? 2 : null;
  }
  if (type === 'section') {
    field.defaultValue = '';
  }
  return field;
}

/** 规范化拿到的字段数组（补齐可选属性，屏蔽历史脏数据） */
export function normalizeFieldList(fields: unknown): FormField[] {
  if (!Array.isArray(fields)) return [];
  return fields.map((raw, i) => {
    const f = (raw || {}) as Partial<FormField>;
    return {
      key: String(f.key || `field_${i + 1}`),
      type: String(f.type || 'text'),
      label: String(f.label || typeName(String(f.type || 'text'))),
      placeholder: String(f.placeholder || ''),
      required: !!f.required,
      defaultValue: f.defaultValue === undefined ? '' : f.defaultValue,
      options: Array.isArray(f.options) ? f.options.map((o) => String(o)) : [],
      optionLayout: (f.optionLayout || (f.type === 'select' ? 'dropdown' : 'horizontal')) as FormField['optionLayout'],
      minSelect: f.minSelect ?? null,
      maxSelect: f.maxSelect ?? null,
      min: f.min ?? null,
      max: f.max ?? null,
      precision: f.precision ?? null,
      formula: String(f.formula || ''),
      hint: String(f.hint || ''),
      width: f.width || '1',
      score: Number(f.score || 0),
      answer: f.answer === undefined || f.answer === null ? '' : f.answer,
      columns: Array.isArray(f.columns) ? f.columns : [],
      linkage: f.linkage || null,
    };
  });
}

/** 字段值 → 展示文本（表格 / 详情 / 导出） */
export function formatFieldValue(field: FormField | undefined, value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[对象]';
    }
  }
  const text = String(value);
  if (field?.type === 'checkbox') {
    return text.split(',').filter(Boolean).join('、') || '-';
  }
  return text || '-';
}

/** 判断是否布局类字段（不产生数据） */
export function isLayoutType(type: string): boolean {
  return type === 'divider' || type === 'section';
}

/** 判断是否需要选项配置 */
export function hasOptions(type: string): boolean {
  return type === 'select' || type === 'radio' || type === 'checkbox';
}

/** 判断是否数值类 */
export function isNumericType(type: string): boolean {
  return type === 'number' || type === 'amount' || type === 'percent' || type === 'slider';
}
