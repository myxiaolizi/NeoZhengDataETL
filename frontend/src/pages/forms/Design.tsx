/**
 * 表单设计器：三栏布局（左侧字段组件面板 / 中间画布 / 右侧属性面板）
 *
 * V4.1 布局修复要点：
 *  1. 不再使用 calc(100vh - 固定px) —— 顶部多了多标签页导航条（TabsBar）后固定值必然算错。
 *     改为运行时量取工作区真实顶部位置，把「工作区高度」精确算成视口剩余高度，
 *     因此页面本身不再产生纵向滚动条，滚动只发生在三栏内部。
 *  2. 三栏等高（alignItems: stretch），左/右栏固定宽度、中栏 flex:1 + minWidth:0，
 *     并给滚动容器加 scrollbar-gutter: stable，内容多少都不会让栏宽跳动。
 *  3. 断点：<1280px 右栏折叠为抽屉；<768px 左右栏都折叠（字段抽屉 + 属性抽屉）。
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button, Card, Checkbox, Divider, Drawer, Empty, Input, InputNumber,
  Modal, Radio, Rate, Segmented, Select, Slider, Space, Spin, Switch, Tag, Tooltip, message,
} from 'antd';
import {
  AppstoreOutlined, ArrowDownOutlined, ArrowUpOutlined, CopyOutlined, DeleteOutlined,
  EyeOutlined, LeftOutlined, LinkOutlined, PlusOutlined, SaveOutlined, SettingOutlined,
} from '@ant-design/icons';
import Page from '@/components/Page';
import { NEUTRAL, PALETTE } from '@/theme';
import { copyText } from '@/utils';
import { formsApi, publicFormUrl } from '@/api/forms';
import type { FormDetail, FormField, FormMeta, FormSettings } from '@/api/forms';
import {
  FALLBACK_TYPES, FALLBACK_WIDTHS, createField, groupTypes,
  hasOptions, isLayoutType, isNumericType, normalizeFieldList, typeIcon, typeName, widthToSpan,
} from './fieldTypes';

/** 布局断点：右栏在 <1280 折叠为抽屉，左右两侧在 <768 全部折叠 */
const NARROW_WIDTH = 1280;
const MOBILE_WIDTH = 768;

/** 左栏 / 右栏固定宽度（px），内容多少都不变 */
const LEFT_RAIL_WIDTH = 208;
const RIGHT_RAIL_WIDTH = 320;

/** 视口宽度：自带 resize 监听，首帧就能拿到真实值（避免 useBreakpoint 首帧空对象导致的布局闪跳） */
function useViewportWidth(): number {
  const [width, setWidth] = useState<number>(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth
  );
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return width;
}

/**
 * 计算「工作区」应有的高度：视口高度 - 工作区顶部真实位置 - 底部留白。
 *
 * 用运行时量取替代 calc(100vh - Npx)，所以 Header / TabsBar / 标题行高度怎么变都不会算错；
 * 量到的高度让整页高度正好等于视口，页面因此没有纵向滚动条，滚动被限制在各栏内部。
 */
function useWorkspaceHeight(
  ref: React.RefObject<HTMLDivElement>,
  bottomGap: number,
  recalcKey: string
): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    let raf = 0;
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const viewportH = window.visualViewport?.height || window.innerHeight;
      // 下限只防止极端矮视口下算出 0/负数；高度不够时让三栏内部滚动，而不是把页面撑出滚动条
      const next = Math.max(120, Math.floor(viewportH - top - bottomGap));
      setHeight((prev) => (prev === next ? prev : next));
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    // 布局阶段先同步量一次，避免首帧用占位 minHeight 造成的闪跳
    measure();
    schedule();
    // 标题行/字体/标签栏可能异步撑开，补两次测量兜底
    const t1 = window.setTimeout(measure, 120);
    const t2 = window.setTimeout(measure, 480);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    // 标签页导航条 / 标题行高度若异步变化（字体加载、标签换行），顶部位置会平移，这里跟着重量
    const parent = ref.current?.parentElement;
    const ro = parent && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (ro && parent) ro.observe(parent);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      ro?.disconnect();
    };
  }, [ref, bottomGap, recalcKey]);
  return height;
}

/** 调色板：全部取自 @/theme 令牌（V4.1 禁止写死旧色值） */
const C = {
  primary: PALETTE.primary,
  blue: PALETTE.primaryDeep,
  deep: NEUTRAL.text,
  cyan: PALETTE.cyan,
  light: PALETTE.cyan,
  green: PALETTE.green,
  orange: PALETTE.orange,
  red: PALETTE.red,
  yellow: PALETTE.yellow,
  gray: NEUTRAL.textTertiary,
  line: NEUTRAL.border,
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
            textAlign: 'center', color: C.gray, fontSize: 12.5, background: NEUTRAL.surface,
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
  const viewportWidth = useViewportWidth();
  const isMobile = viewportWidth < MOBILE_WIDTH;
  const isNarrow = viewportWidth < NARROW_WIDTH;

  /** 工作区（三栏容器）：高度由运行时量取，精确填满标题行以下的剩余视口 */
  const workspaceRef = useRef<HTMLDivElement>(null);

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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragRef = useRef<DragPayload>(null);

  const workspaceHeight = useWorkspaceHeight(
    workspaceRef,
    isMobile ? 12 : 20,
    // 切换断点或数据加载完成（工作区首次挂载）时都要重新量取
    `${isMobile ? 'm' : 'd'}-${isNarrow ? 'n' : 'w'}-${loading ? 'loading' : detail ? detail.id : 'empty'}`
  );

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
        <Tag style={{ color: C.primary, background: NEUTRAL.surface, borderColor: C.primary }}>
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
          <Tag style={{ color: C.deep, background: NEUTRAL.surface, borderColor: C.line }}>
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

  /* ---------- 右侧属性面板：分段器常驻，内容区独立滚动 ---------- */
  const propSegmented = (
    <Segmented
      block
      value={panel}
      onChange={(v) => setPanel(v as 'field' | 'form')}
      options={[
        { value: 'field', label: '字段属性' },
        { value: 'form', label: '表单设置' },
      ]}
      style={{ marginBottom: 12, flexShrink: 0 }}
    />
  );

  const propContent =
    panel === 'field' ? (
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
    );

  const propPanel = (
    <div
      data-role="prop-panel"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}
    >
      {propSegmented}
      <div
        data-role="prop-scroll"
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', scrollbarGutter: 'stable', paddingBottom: 4 }}
      >
        {propContent}
      </div>
    </div>
  );

  /* ---------- 画布（滚动由外层容器负责） ---------- */
  const canvas = (
    <div
      data-role="design-canvas"
      style={{
        background: NEUTRAL.surface, border: `1px solid ${C.line}`, borderRadius: 12,
        padding: isMobile ? 10 : 16, minHeight: '100%',
      }}
    >
      <div
        style={{
          background: NEUTRAL.surfaceAlt,
          border: `1px solid ${NEUTRAL.borderSubtle}`,
          borderRadius: 10, padding: '14px 16px', marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: NEUTRAL.text }}>{name || '未命名表单'}</div>
        {description && <div style={{ fontSize: 12.5, color: NEUTRAL.textSecondary, marginTop: 4 }}>{description}</div>}
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
            style={{ width: `${(widthToSpan(field.width) / 24) * 100}%`, minWidth: isMobile ? '100%' : 220, maxWidth: '100%', padding: 4, boxSizing: 'border-box' }}
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
                // 右栏折叠（平板/手机）时，选中字段直接弹出属性抽屉
                if (isNarrow) setPropOpen(true);
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
                background: overIndex === i ? NEUTRAL.surfaceSunken : NEUTRAL.surface,
                cursor: 'move',
                boxShadow: selectedKey === field.key ? `0 0 0 3px ${PALETTE.primarySoft}` : 'none',
                position: 'relative',
                transition: 'border-color .15s, box-shadow .15s',
              }}
            >
              {!isLayoutType(field.type) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: C.deep, flex: '1 1 auto', minWidth: 0, wordBreak: 'break-word' }}>
                    {field.label}
                    {field.required && <span style={{ color: C.red, marginLeft: 3 }}>*</span>}
                  </span>
                  <span style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
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
              {!isLayoutType(field.type) && (
                // 控件本身只作预览（disabled），pointerEvents:none 让点击穿透到整卡，
                // 否则 disabled 控件会吞掉 click，点字段主体选不中字段（属性面板也就出不来）
                <div style={{ pointerEvents: 'none' }} data-role="canvas-preview-control">
                  <FieldControl field={field} />
                </div>
              )}
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
          background: overIndex === fields.length ? NEUTRAL.surfaceSunken : 'transparent',
        }}
      >
        拖拽字段到此处添加到末尾
      </div>
    </div>
  );

  /* ---------- 左侧字段面板（滚动交给外层栏，自身不再写死高度） ---------- */
  const palette = (
    <div data-role="field-palette">
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
                onClick={() => {
                  addField(t.key);
                  // 手机端面板在抽屉里，点完收起，直接看到画布
                  if (isMobile) setPaletteOpen(false);
                }}
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
                  background: NEUTRAL.surface,
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
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          表单设计
          <span style={{ fontSize: 13.5, fontWeight: 600, color: NEUTRAL.textSecondary }}>
            {name || detail.name}
          </span>
          {dirty && <Tag color="orange" style={{ marginInlineStart: 2 }}>未保存</Tag>}
        </span>
      }
      actions={
        <>
          {isMobile && (
            <Button icon={<AppstoreOutlined />} onClick={() => setPaletteOpen(true)}>
              字段
            </Button>
          )}
          {isNarrow && (
            <Button
              icon={<SettingOutlined />}
              onClick={() => {
                if (!selected) setPanel('form');
                setPropOpen(true);
              }}
            >
              {panel === 'field' ? '字段属性' : '表单设置'}
            </Button>
          )}
          <Button icon={<LinkOutlined />} onClick={copyLink}>
            {isMobile ? '' : '公开链接'}
          </Button>
          <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>
            {isMobile ? '' : '预览'}
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
            保存
          </Button>
        </>
      }
      extra={
        <Button icon={<LeftOutlined />} onClick={() => navigate('/forms')}>
          {isMobile ? '' : '返回表单中心'}
        </Button>
      }
    >
      {/*
        工作区：高度 = 视口 - 顶部真实位置 - 底部留白（运行时量取）。
        三栏等高，各自内部滚动；页面本身不产生滚动条。
      */}
      <div
        ref={workspaceRef}
        data-role="design-workspace"
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'stretch',
          height: workspaceHeight ? `${workspaceHeight}px` : undefined,
          minHeight: workspaceHeight ? undefined : 360,
        }}
      >
        {/* 左：字段组件（<768 折叠为抽屉） */}
        {!isMobile && (
          <div
            data-role="design-left"
            style={{ width: LEFT_RAIL_WIDTH, flex: `0 0 ${LEFT_RAIL_WIDTH}px`, height: '100%', minWidth: 0 }}
          >
            <Card
              size="small"
              title="字段组件"
              style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
              styles={{
                body: { padding: 10, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', scrollbarGutter: 'stable' },
              }}
            >
              {palette}
            </Card>
          </div>
        )}

        {/* 中：画布（独立滚动，宽度随窗口伸缩但不会被内容撑破） */}
        <div
          data-role="design-canvas-col"
          style={{ flex: '1 1 0%', minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}
        >
          <div
            data-role="design-canvas-scroll"
            style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', scrollbarGutter: 'stable' }}
          >
            {canvas}
          </div>
        </div>

        {/* 右：属性面板（<1280 折叠为抽屉） */}
        {!isNarrow && (
          <div
            data-role="design-right"
            style={{ width: RIGHT_RAIL_WIDTH, flex: `0 0 ${RIGHT_RAIL_WIDTH}px`, height: '100%', minWidth: 0 }}
          >
            <Card
              size="small"
              title="属性"
              style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
              styles={{
                body: { padding: 12, flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
              }}
            >
              {propPanel}
            </Card>
          </div>
        )}
      </div>

      {/* 属性抽屉：<1280 用右侧抽屉，<768 用底部抽屉 */}
      {isNarrow && (
        <Drawer
          title={panel === 'field' ? '字段属性' : '表单设置'}
          placement={isMobile ? 'bottom' : 'right'}
          size={isMobile ? '82%' : 360}
          open={propOpen}
          onClose={() => setPropOpen(false)}
          styles={{
            body: { padding: 12, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' },
          }}
        >
          {propPanel}
        </Drawer>
      )}

      {/* 移动端字段组件抽屉 */}
      {isMobile && (
        <Drawer
          title="字段组件"
          placement="left"
          size={288}
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          styles={{ body: { padding: 10 } }}
        >
          {palette}
        </Drawer>
      )}

      {/* 预览：承载表单内容 → Modal（V4.1 禁止 Drawer 承载业务内容） */}
      <Modal
        title="表单预览"
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={
          <Space>
            <Button icon={<LinkOutlined />} onClick={copyLink}>
              复制公开填写链接
            </Button>
            <Button type="primary" onClick={() => setPreviewOpen(false)}>
              关闭
            </Button>
          </Space>
        }
        width={isMobile ? '94%' : 520}
        destroyOnHidden
        styles={{ body: { maxHeight: '68vh', overflowY: 'auto', paddingRight: 4 } }}
      >
        <div
          style={{
            maxWidth: 375, margin: '0 auto', background: NEUTRAL.surface, border: `1px solid ${C.line}`,
            borderRadius: 16, padding: 16,
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 700, color: C.deep }}>{name || '未命名表单'}</div>
          {description && (
            <div style={{ fontSize: 12.5, color: NEUTRAL.textSecondary, marginTop: 6 }}>{description}</div>
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
      </Modal>
    </Page>
  );
}
