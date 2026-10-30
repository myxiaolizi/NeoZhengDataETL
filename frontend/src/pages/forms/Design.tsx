/** 表单设计器：三栏布局（左侧字段组件面板 / 中间画布 / 右侧属性面板） */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button, Card, Checkbox, Divider, Drawer, Empty, Grid, Input, InputNumber,
  Radio, Rate, Segmented, Select, Slider, Space, Spin, Switch, Tag, Tooltip, message,
} from 'antd';
import {
  ArrowDownOutlined, ArrowUpOutlined, CopyOutlined, DeleteOutlined, EyeOutlined,
  LeftOutlined, LinkOutlined, PlusOutlined, SaveOutlined,
} from '@ant-design/icons';
import Page from '@/components/Page';
import { copyText } from '@/utils';
import { formsApi, publicFormUrl } from '@/api/forms';
import type { FormDetail, FormField, FormMeta, FormSettings } from '@/api/forms';
import {
  FALLBACK_TYPES, FALLBACK_WIDTHS, createField, groupTypes,
  hasOptions, isLayoutType, isNumericType, normalizeFieldList, typeIcon, typeName, widthToSpan,
} from './fieldTypes';

const { useBreakpoint } = Grid;

/** 调色板（契约唯一允许的 13 色） */
const C = {
  primary: '#3687FF',
  blue: '#2D6FE4',
  deep: '#003378',
  cyan: '#45B4FF',
  light: '#73DBFF',
  green: '#A2D73C',
  orange: '#EC673C',
  red: '#E86161',
  yellow: '#FFC000',
  gray: '#B5B5B6',
  line: '#DCDDDD',
};

/** 拖拽载荷 */
type DragPayload = { kind: 'new'; type: string } | { kind: 'move'; index: number } | null;

const FORM_TYPE_NAME: Record<string, string> = {
  fill: '填写表单',
  flow: '流程表单',
  exam: '考试表单',
};

/** 字段预览控件（禁用态，仅用于画布/预览展示） */
function FieldControl({ field, interactive = false }: { field: FormField; interactive?: boolean }) {
  const placeholder = field.placeholder || `请输入${field.label}`;
  const layout = field.optionLayout || 'horizontal';
  const options = (field.options || []).map((o) => ({ label: o, value: o }));

  switch (field.type) {
    case 'textarea':
      return <Input.TextArea rows={3} placeholder={placeholder} disabled={!interactive} />;
    case 'number':
    case 'amount':
    case 'percent':
      return (
        <InputNumber
          style={{ width: '100%' }}
          placeholder={placeholder}
          disabled={!interactive}
          min={field.min ?? undefined}
          max={field.max ?? undefined}
          precision={field.precision ?? undefined}
          suffix={field.type === 'amount' ? '元' : field.type === 'percent' ? '%' : undefined}
        />
      );
    case 'select':
      return (
        <Select
          style={{ width: '100%' }}
          placeholder={placeholder}
          options={options}
          disabled={!interactive}
          allowClear
        />
      );
    case 'radio':
      return (
        <Radio.Group
          options={options}
          disabled={!interactive}
          style={{ display: 'flex', flexDirection: layout === 'vertical' ? 'column' : 'row', gap: 8, flexWrap: 'wrap' }}
        />
      );
    case 'checkbox':
      return (
        <Checkbox.Group
          options={options}
          disabled={!interactive}
          style={{ display: 'flex', flexDirection: layout === 'vertical' ? 'column' : 'row', gap: 8, flexWrap: 'wrap' }}
        />
      );
    case 'date':
      return <Input placeholder={placeholder || '请选择日期'} disabled={!interactive} suffix={<span style={{ color: C.gray }}>▦</span>} />;
    case 'datetime':
      return <Input placeholder={placeholder || '请选择日期时间'} disabled={!interactive} suffix={<span style={{ color: C.gray }}>◷</span>} />;
    case 'time':
      return <Input placeholder={placeholder || '请选择时间'} disabled={!interactive} suffix={<span style={{ color: C.gray }}>◔</span>} />;
    case 'daterange':
      return <Input placeholder={placeholder || '请选择日期区间'} disabled={!interactive} suffix={<span style={{ color: C.gray }}>⇹</span>} />;
    case 'rating':
      return <Rate disabled={!interactive} count={Number(field.max) > 0 ? Number(field.max) : 5} />;
    case 'slider':
      return (
        <Slider
          disabled={!interactive}
          min={field.min ?? 0}
          max={field.max ?? 100}
          defaultValue={field.min ?? 0}
        />
      );
    case 'image':
    case 'file':
      return (
        <div
          style={{
            border: `1px dashed ${C.line}`, borderRadius: 8, padding: '18px 12px',
            textAlign: 'center', color: C.gray, fontSize: 12.5, background: '#FFFFFF',
          }}
        >
          {field.type === 'image' ? '点击上传图片' : '点击上传附件'}
        </div>
      );
    case 'member':
      return <Input placeholder={placeholder || '请选择成员'} disabled={!interactive} suffix={<span style={{ color: C.gray }}>◐</span>} />;
    case 'department':
      return <Input placeholder={placeholder || '请选择部门'} disabled={!interactive} suffix={<span style={{ color: C.gray }}>⛢</span>} />;
    case 'address':
      return <Input placeholder={placeholder || '请输入地址'} disabled={!interactive} suffix={<span style={{ color: C.gray }}>⌂</span>} />;
    case 'location':
      return <Input placeholder={placeholder || '请选择定位'} disabled={!interactive} suffix={<span style={{ color: C.gray }}>◈</span>} />;
    case 'formula':
      return <Input value={field.formula ? `ƒ ${field.formula}` : '自动计算（只读）'} disabled />;
    case 'table':
      return (
        <div
          style={{
            border: `1px dashed ${C.line}`, borderRadius: 8, padding: '18px 12px',
            textAlign: 'center', color: C.gray, fontSize: 12.5,
          }}
        >
          子表格（公开填写暂不支持，可在内部表单使用）
        </div>
      );
    default:
      return <Input placeholder={placeholder} disabled={!interactive} />;
  }
}

export default function FormDesignPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<FormDetail | null>(null);
  const [meta, setMeta] = useState<FormMeta | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<FormField[]>([]);
  const [settings, setSettings] = useState<FormSettings>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const [panel, setPanel] = useState<'field' | 'form'>('form');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [propOpen, setPropOpen] = useState(false);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragRef = useRef<DragPayload>(null);

  /* ---------- 加载 ---------- */
  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [d, m] = await Promise.all([
          formsApi.detail(id),
          formsApi.meta().catch(() => null as FormMeta | null),
        ]);
        if (!alive) return;
        setDetail(d);
        setMeta(m);
        setName(d.name || '');
        setDescription(d.description || '');
        setFields(normalizeFieldList(d.fields));
        setSettings(d.settings || {});
        setDirty(false);
      } catch {
        /* client 已提示 */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  /* 离开页面提醒未保存 */
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const markDirty = useCallback(() => setDirty(true), []);

  /* ---------- 字段操作 ---------- */
  const addField = useCallback(
    (type: string, index?: number) => {
      const field = createField(type, meta, fields.map((x) => x.key));
      const next = [...fields];
      next.splice(index === undefined ? next.length : index, 0, field);
      setFields(next);
      setSelectedKey(field.key);
      setPanel('field');
      markDirty();
    },
    [fields, meta, markDirty]
  );

  const patchField = (key: string, patch: Partial<FormField>) => {
    setFields((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));
    markDirty();
  };

  const patchSettings = (patch: Partial<FormSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    markDirty();
  };

  const moveField = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= fields.length) return;
    const next = [...fields];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    setFields(next);
    markDirty();
  };

  const duplicateField = (index: number) => {
    const src = fields[index];
    if (!src) return;
    const copy: FormField = {
      ...src,
      key: createField(src.type, meta, fields.map((x) => x.key)).key,
      label: `${src.label} 副本`,
      options: [...(src.options || [])],
    };
    const next = [...fields];
    next.splice(index + 1, 0, copy);
    setFields(next);
    setSelectedKey(copy.key);
    setPanel('field');
    markDirty();
  };

  const removeField = (key: string) => {
    setFields((prev) => prev.filter((f) => f.key !== key));
    if (selectedKey === key) setSelectedKey(null);
    markDirty();
  };

  /* ---------- 拖拽排序 ---------- */
  const dropAt = (index: number) => {
    const payload = dragRef.current;
    dragRef.current = null;
    setOverIndex(null);
    if (!payload) return;
    if (payload.kind === 'new') {
      addField(payload.type, index);
      return;
    }
    let to = index;
    if (payload.index < index) to = index - 1;
    if (payload.index === to) return;
    const next = [...fields];
    const [item] = next.splice(payload.index, 1);
    next.splice(to, 0, item);
    setFields(next);
    markDirty();
  };

  /* ---------- 保存 ---------- */
  const save = async () => {
    if (!id) return;
    if (!name.trim()) {
      message.warning('请填写表单名称');
      setPanel('form');
      return;
    }
    setSaving(true);
    try {
      const updated = await formsApi.update(id, {
        name: name.trim(),
        description,
        fields,
        settings,
      } as Partial<FormDetail>);
      setDetail(updated);
      setFields(normalizeFieldList(updated.fields));
      setSettings(updated.settings || {});
      setDirty(false);
      message.success('表单已保存');
    } catch {
      /* client 已提示 */
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    const url = publicFormUrl(detail?.publicToken);
    if (!url) {
      message.warning('该表单还没有公开令牌，请到表单中心重置公开链接');
      return;
    }
    const ok = await copyText(url);
    message[ok ? 'success' : 'error'](ok ? '公开填写链接已复制' : '复制失败，请手动复制');
  };

  /* ---------- 衍生数据 ---------- */
  const types = meta?.types?.length ? meta.types : FALLBACK_TYPES;
  const widths = meta?.widths?.length ? meta.widths : FALLBACK_WIDTHS;
  const groups = useMemo(() => groupTypes(types), [types]);
  const selected = useMemo(
    () => fields.find((f) => f.key === selectedKey) || null,
    [fields, selectedKey]
  );
  const formType = detail?.formType || 'fill';

  /* ---------- 右侧：字段属性 ---------- */
  const renderFieldProps = (field: FormField) => (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      <div>
        <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>字段类型</div>
        <Tag style={{ color: C.primary, background: '#FFFFFF', borderColor: C.primary }}>
          {typeIcon(field.type, meta)} {typeName(field.type, meta)}
        </Tag>
      </div>

      <div>
        <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>字段标题</div>
        <Input
          value={field.label}
          maxLength={100}
          onChange={(e) => patchField(field.key, { label: e.target.value })}
        />
      </div>

      <div>
        <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>字段标识（数据列名）</div>
        <Tooltip title="字段标识创建后不可修改，避免历史数据错列">
          <Input value={field.key} disabled />
        </Tooltip>
      </div>

      {!isLayoutType(field.type) && (
        <>
          <div>
            <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>提示文字</div>
            <Input
              value={field.placeholder || ''}
              placeholder="留空则使用默认提示"
              onChange={(e) => patchField(field.key, { placeholder: e.target.value })}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>底部说明</div>
            <Input.TextArea
              rows={2}
              value={field.hint || ''}
              onChange={(e) => patchField(field.key, { hint: e.target.value })}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>必填</span>
            <Switch
              checked={!!field.required}
              onChange={(v) => patchField(field.key, { required: v })}
            />
          </div>
        </>
      )}

      <div>
        <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>宽度</div>
        <Select
          style={{ width: '100%' }}
          value={field.width === 'full' ? '1' : field.width === 'half' ? '1/2' : field.width || '1'}
          onChange={(v) => patchField(field.key, { width: v })}
          options={widths.map((w) => ({ value: w.key, label: w.name }))}
        />
      </div>

      {hasOptions(field.type) && (
        <>
          <div>
            <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>选项展示方式</div>
            <Select
              style={{ width: '100%' }}
              value={field.optionLayout || 'horizontal'}
              onChange={(v) => patchField(field.key, { optionLayout: v })}
              options={[
                { value: 'horizontal', label: '横向排列' },
                { value: 'vertical', label: '纵向排列' },
                { value: 'dropdown', label: '下拉选择' },
              ]}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>选项</div>
            <Space orientation="vertical" size={6} style={{ width: '100%' }}>
              {(field.options || []).map((opt, i) => (
                <div key={`${field.key}-opt-${i}`} style={{ display: 'flex', gap: 6 }}>
                  <Input
                    value={opt}
                    onChange={(e) => {
                      const next = [...(field.options || [])];
                      next[i] = e.target.value;
                      patchField(field.key, { options: next });
                    }}
                  />
                  <Button
                    icon={<DeleteOutlined />}
                    onClick={() =>
                      patchField(field.key, {
                        options: (field.options || []).filter((_, idx) => idx !== i),
                      })
                    }
                  />
                </div>
              ))}
              <Button
                block
                icon={<PlusOutlined />}
                onClick={() =>
                  patchField(field.key, {
                    options: [...(field.options || []), `选项${(field.options || []).length + 1}`],
                  })
                }
              >
                添加选项
              </Button>
            </Space>
          </div>
          {(field.type === 'checkbox') && (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>最少选</div>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  value={field.minSelect ?? undefined}
                  onChange={(v) => patchField(field.key, { minSelect: v ?? null })}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>最多选</div>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  value={field.maxSelect ?? undefined}
                  onChange={(v) => patchField(field.key, { maxSelect: v ?? null })}
                />
              </div>
            </div>
          )}
        </>
      )}

      {isNumericType(field.type) && (
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>
              {field.type === 'slider' || field.type === 'rating' ? '最小值' : '最小值'}
            </div>
            <InputNumber
              style={{ width: '100%' }}
              value={field.min ?? undefined}
              onChange={(v) => patchField(field.key, { min: v ?? null })}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>
              {field.type === 'rating' ? '分值上限' : '最大值'}
            </div>
            <InputNumber
              style={{ width: '100%' }}
              value={field.max ?? undefined}
              onChange={(v) => patchField(field.key, { max: v ?? null })}
            />
          </div>
          {field.type !== 'slider' && (
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>小数位</div>
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                max={6}
                value={field.precision ?? undefined}
                onChange={(v) => patchField(field.key, { precision: v ?? null })}
              />
            </div>
          )}
        </div>
      )}

      {field.type === 'formula' && (
        <div>
          <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>计算公式</div>
          <Input
            value={field.formula || ''}
            placeholder="例如：{单价} * {数量}"
            onChange={(e) => patchField(field.key, { formula: e.target.value })}
          />
        </div>
      )}

      {!isLayoutType(field.type) && (
        <div>
          <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>默认值</div>
          <Input
            value={String(field.defaultValue ?? '')}
            onChange={(e) => patchField(field.key, { defaultValue: e.target.value })}
          />
        </div>
      )}

      {formType === 'exam' && !isLayoutType(field.type) && (
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ width: 100 }}>
            <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>分值</div>
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              value={field.score ?? 0}
              onChange={(v) => patchField(field.key, { score: Number(v || 0) })}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>正确答案</div>
            <Input
              value={String(field.answer ?? '')}
              placeholder="多选用英文逗号分隔"
              onChange={(e) => patchField(field.key, { answer: e.target.value })}
            />
          </div>
        </div>
      )}

      <Divider style={{ margin: '4px 0' }} />
      <Space size={8} style={{ width: '100%' }}>
        <Button
          block
          icon={<CopyOutlined />}
          onClick={() => {
            const idx = fields.findIndex((f) => f.key === field.key);
            if (idx >= 0) duplicateField(idx);
          }}
        >
          复制
        </Button>
        <Button block danger icon={<DeleteOutlined />} onClick={() => removeField(field.key)}>
          删除
        </Button>
      </Space>
    </Space>
  );

  /* ---------- 右侧：表单设置 ---------- */
  const renderFormSettings = () => {
    const flowNodes = Array.isArray(settings.flowNodes) ? settings.flowNodes : [];
    return (
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <div>
          <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>表单名称</div>
          <Input
            value={name}
            maxLength={60}
            onChange={(e) => {
              setName(e.target.value);
              markDirty();
            }}
          />
        </div>
        <div>
          <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>表单说明</div>
          <Input.TextArea
            rows={2}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              markDirty();
            }}
          />
        </div>
        <div>
          <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>表单类型</div>
          <Tag style={{ color: C.deep, background: '#FFFFFF', borderColor: C.line }}>
            {FORM_TYPE_NAME[formType] || formType}
          </Tag>
          <span style={{ fontSize: 12, color: C.gray, marginLeft: 8 }}>可在「表单中心」修改</span>
        </div>

        <Divider style={{ margin: '4px 0' }}>提交设置</Divider>
        <div>
          <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>提交成功提示</div>
          <Input.TextArea
            rows={2}
            value={settings.successMessage || ''}
            placeholder="提交成功，感谢您的填写！"
            onChange={(e) => patchSettings({ successMessage: e.target.value })}
          />
        </div>

        <Divider style={{ margin: '4px 0' }}>分享设置</Divider>
        <div>
          <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>分享标题</div>
          <Input
            value={settings.shareTitle || ''}
            placeholder={name}
            onChange={(e) => patchSettings({ shareTitle: e.target.value })}
          />
        </div>
        <div>
          <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>分享描述</div>
          <Input.TextArea
            rows={2}
            value={settings.shareDesc || ''}
            onChange={(e) => patchSettings({ shareDesc: e.target.value })}
          />
        </div>

        {formType === 'exam' && (
          <>
            <Divider style={{ margin: '4px 0' }}>考试设置</Divider>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>限时（分钟）</div>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  value={Number(settings.examDuration || 0)}
                  onChange={(v) => patchSettings({ examDuration: Number(v || 0) })}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>及格分</div>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  value={Number(settings.examPassScore || 60)}
                  onChange={(v) => patchSettings({ examPassScore: Number(v || 0) })}
                />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13 }}>提交后显示答案</span>
              <Switch
                checked={!!settings.examShowAnswer}
                onChange={(v) => patchSettings({ examShowAnswer: v })}
              />
            </div>
          </>
        )}

        {formType === 'flow' && (
          <>
            <Divider style={{ margin: '4px 0' }}>审批节点</Divider>
            {flowNodes.length === 0 && (
              <div style={{ fontSize: 12.5, color: C.gray }}>还没有审批节点，添加后提交会进入审批流程</div>
            )}
            {flowNodes.map((node, i) => (
              <div key={`fn-${i}`} style={{ display: 'flex', gap: 6 }}>
                <Input
                  value={node.name || ''}
                  placeholder={`节点 ${i + 1} 名称`}
                  onChange={(e) => {
                    const next = flowNodes.map((n, idx) => (idx === i ? { ...n, name: e.target.value } : n));
                    patchSettings({ flowNodes: next });
                  }}
                />
                <Input
                  value={node.approver || ''}
                  placeholder="审批人"
                  style={{ width: 110 }}
                  onChange={(e) => {
                    const next = flowNodes.map((n, idx) => (idx === i ? { ...n, approver: e.target.value } : n));
                    patchSettings({ flowNodes: next });
                  }}
                />
                <Button
                  icon={<DeleteOutlined />}
                  onClick={() => patchSettings({ flowNodes: flowNodes.filter((_, idx) => idx !== i) })}
                />
              </div>
            ))}
            <Button
              block
              icon={<PlusOutlined />}
              onClick={() =>
                patchSettings({
                  flowNodes: [...flowNodes, { name: `审批节点 ${flowNodes.length + 1}`, approver: '' }],
                })
              }
            >
              添加审批节点
            </Button>
          </>
        )}
      </Space>
    );
  };

  const propPanel = (
    <div>
      <Segmented
        block
        value={panel}
        onChange={(v) => setPanel(v as 'field' | 'form')}
        options={[
          { value: 'field', label: '字段属性' },
          { value: 'form', label: '表单设置' },
        ]}
        style={{ marginBottom: 12 }}
      />
      {panel === 'field' ? (
        selected ? (
          renderFieldProps(selected)
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span style={{ fontSize: 12.5, color: C.gray }}>点击画布中的字段编辑属性</span>}
          />
        )
      ) : (
        renderFormSettings()
      )}
    </div>
  );

  /* ---------- 画布 ---------- */
  const canvas = (
    <div
      style={{
        background: '#FFFFFF', border: `1px solid ${C.line}`, borderRadius: 12,
        padding: isMobile ? 10 : 16, minHeight: 420,
      }}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(45,111,228,.06), rgba(115,219,255,.14))',
          borderRadius: 10, padding: '14px 16px', marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: C.deep }}>{name || '未命名表单'}</div>
        {description && <div style={{ fontSize: 12.5, color: 'rgba(0,51,120,.6)', marginTop: 4 }}>{description}</div>}
        <div style={{ fontSize: 12, color: C.gray, marginTop: 6 }}>
          {fields.length} 个字段 · {FORM_TYPE_NAME[formType] || formType}
        </div>
      </div>

      {fields.length === 0 ? (
        <Empty
          description={
            <span style={{ fontSize: 13, color: C.gray }}>
              从左侧点击或拖拽字段到此处，开始设计表单
            </span>
          }
          style={{ padding: '40px 0' }}
        />
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', margin: -4 }}>
        {fields.map((field, i) => (
          <div
            key={field.key}
            style={{ width: `${(widthToSpan(field.width) / 24) * 100}%`, minWidth: isMobile ? '100%' : 220, padding: 4, boxSizing: 'border-box' }}
          >
            <div
              draggable
              data-role="canvas-field"
              data-field-key={field.key}
              data-field-type={field.type}
              onDragStart={() => {
                dragRef.current = { kind: 'move', index: i };
              }}
              onDragEnd={() => {
                dragRef.current = null;
                setOverIndex(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIndex(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                dropAt(i);
              }}
              onClick={() => {
                setSelectedKey(field.key);
                setPanel('field');
                if (isMobile) setPropOpen(true);
              }}
              style={{
                border:
                  selectedKey === field.key
                    ? `1.5px solid ${C.primary}`
                    : overIndex === i
                      ? `1.5px dashed ${C.primary}`
                      : `1px dashed ${C.line}`,
                borderRadius: 10,
                padding: isLayoutType(field.type) ? '6px 10px' : '10px 12px',
                background: overIndex === i ? 'rgba(54,135,255,.04)' : '#FFFFFF',
                cursor: 'move',
                boxShadow: selectedKey === field.key ? '0 0 0 3px rgba(54,135,255,.12)' : 'none',
                position: 'relative',
                transition: 'border-color .15s, box-shadow .15s',
              }}
            >
              {!isLayoutType(field.type) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: C.deep }}>
                    {field.label}
                    {field.required && <span style={{ color: C.red, marginLeft: 3 }}>*</span>}
                  </span>
                  <span style={{ display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="上移">
                      <Button type="text" size="small" icon={<ArrowUpOutlined />} onClick={() => moveField(i, -1)} />
                    </Tooltip>
                    <Tooltip title="下移">
                      <Button type="text" size="small" icon={<ArrowDownOutlined />} onClick={() => moveField(i, 1)} />
                    </Tooltip>
                    <Tooltip title="复制">
                      <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => duplicateField(i)} />
                    </Tooltip>
                    <Tooltip title="删除">
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => removeField(field.key)} />
                    </Tooltip>
                  </span>
                </div>
              )}

              {field.type === 'divider' && <Divider style={{ margin: '4px 0' }} />}
              {field.type === 'section' && (
                <div style={{ fontWeight: 700, fontSize: 14, color: C.deep }}>{field.label}</div>
              )}
              {!isLayoutType(field.type) && <FieldControl field={field} />}
              {field.hint && !isLayoutType(field.type) && (
                <div style={{ fontSize: 11.5, color: C.gray, marginTop: 4 }}>{field.hint}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 末尾拖入区 */}
      <div
        data-role="drop-zone"
        onDragOver={(e) => {
          e.preventDefault();
          setOverIndex(fields.length);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dropAt(fields.length);
        }}
        style={{
          marginTop: 8,
          border: `1px dashed ${overIndex === fields.length ? C.primary : C.line}`,
          borderRadius: 10,
          padding: '16px 12px',
          textAlign: 'center',
          fontSize: 12.5,
          color: overIndex === fields.length ? C.primary : C.gray,
          background: overIndex === fields.length ? 'rgba(54,135,255,.04)' : 'transparent',
        }}
      >
        拖拽字段到此处添加到末尾
      </div>
    </div>
  );

  /* ---------- 左侧字段面板 ---------- */
  const palette = (
    <div style={{ maxHeight: isMobile ? 150 : 'calc(100vh - 220px)', overflow: 'auto' }}>
      {groups.map((g) => (
        <div key={g.group} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, color: C.gray, margin: '0 0 6px 2px' }}>{g.group}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {g.items.map((t) => (
              <div
                key={t.key}
                draggable
                data-role="palette-item"
                data-field-type={t.key}
                onDragStart={() => {
                  dragRef.current = { kind: 'new', type: t.key };
                }}
                onDragEnd={() => {
                  dragRef.current = null;
                }}
                onClick={() => addField(t.key)}
                title={`${t.name}｜点击添加，或拖到画布`}
                style={{
                  width: isMobile ? 'auto' : '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  border: `1px solid ${C.line}`,
                  borderRadius: 8,
                  padding: isMobile ? '6px 10px' : '7px 9px',
                  fontSize: 12.5,
                  color: C.deep,
                  cursor: 'grab',
                  background: '#FFFFFF',
                  minHeight: 34,
                }}
              >
                <span style={{ color: C.primary, width: 14, textAlign: 'center' }}>{t.icon}</span>
                <span style={{ whiteSpace: 'nowrap' }}>{t.name}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  if (loading) {
    return (
      <Page title="表单设计">
        <div style={{ padding: 80, textAlign: 'center' }}>
          <Spin size="large" description="加载表单…" />
        </div>
      </Page>
    );
  }

  if (!detail) {
    return (
      <Page title="表单设计" extra={<Button icon={<LeftOutlined />} onClick={() => navigate('/forms')}>返回</Button>}>
        <Empty description="表单不存在或无权限访问" />
      </Page>
    );
  }

  return (
    <Page
      title={`表单设计 · ${name || detail.name}`}
      subTitle={`${detail.code} · ${fields.length} 个字段${dirty ? ' · 有未保存修改' : ''}`}
      extra={
        <Space wrap size={8}>
          <Button icon={<LeftOutlined />} onClick={() => navigate('/forms')}>
            返回
          </Button>
          <Button icon={<LinkOutlined />} onClick={copyLink}>
            公开链接
          </Button>
          <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>
            预览
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
            保存
          </Button>
        </Space>
      }
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* 左：字段面板 */}
        <Card
          size="small"
          title="字段组件"
          style={{ width: isMobile ? '100%' : 208, flexShrink: 0 }}
          styles={{ body: { padding: 10 } }}
        >
          {palette}
        </Card>

        {/* 中：画布 */}
        <div style={{ flex: 1, minWidth: 0 }}>{canvas}</div>

        {/* 右：属性面板 */}
        {!isMobile && (
          <Card
            size="small"
            title="属性"
            style={{ width: 320, flexShrink: 0, maxHeight: 'calc(100vh - 180px)', overflow: 'auto' }}
            styles={{ body: { padding: 12 } }}
          >
            {propPanel}
          </Card>
        )}
      </div>

      {/* 移动端属性抽屉 */}
      {isMobile && (
        <Drawer
          title={panel === 'field' ? '字段属性' : '表单设置'}
          placement="bottom"
          size="78%"
          open={propOpen}
          onClose={() => setPropOpen(false)}
          styles={{ body: { padding: 12 } }}
        >
          {propPanel}
        </Drawer>
      )}

      {/* 预览 */}
      <Drawer
        title="表单预览"
        placement="right"
        size={isMobile ? '100%' : 460}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      >
        <div
          style={{
            maxWidth: 375, margin: '0 auto', background: '#FFFFFF', border: `1px solid ${C.line}`,
            borderRadius: 16, padding: 16,
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 700, color: C.deep }}>{name || '未命名表单'}</div>
          {description && (
            <div style={{ fontSize: 12.5, color: 'rgba(0,51,120,.6)', marginTop: 6 }}>{description}</div>
          )}
          <Divider style={{ margin: '12px 0' }} />
          {fields.length === 0 ? (
            <Empty description="还没有字段" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Space orientation="vertical" size={14} style={{ width: '100%' }}>
              {fields.map((field) => (
                <div key={`pv-${field.key}`}>
                  {field.type === 'divider' ? (
                    <Divider style={{ margin: '4px 0' }} />
                  ) : field.type === 'section' ? (
                    <div style={{ fontWeight: 700, fontSize: 14, color: C.deep }}>{field.label}</div>
                  ) : (
                    <>
                      <div style={{ fontSize: 13, color: C.deep, marginBottom: 6 }}>
                        {field.label}
                        {field.required && <span style={{ color: C.red, marginLeft: 3 }}>*</span>}
                      </div>
                      <FieldControl field={field} interactive={false} />
                      {field.hint && (
                        <div style={{ fontSize: 11.5, color: C.gray, marginTop: 4 }}>{field.hint}</div>
                      )}
                    </>
                  )}
                </div>
              ))}
              <Button type="primary" block size="large" disabled>
                提交
              </Button>
            </Space>
          )}
        </div>
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Button icon={<LinkOutlined />} onClick={copyLink}>
            复制公开填写链接
          </Button>
        </div>
      </Drawer>
    </Page>
  );
}
