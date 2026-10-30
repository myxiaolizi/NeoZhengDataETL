/** 字段配置页 / 字段面板（V4.1 页面规范 + 配色令牌化）
 *
 * 支持：粘贴简道云「字段对照表」批量解析导入、单字段编辑、批量设置解析方式、
 *       结构同步（重建列 + 回填解析值）、字段删除。
 * 路由页：/projects/:id/fields
 * 内嵌：项目详情 Tabs 的「字段配置」
 *
 * V4.1 变更：导入面板由右侧 Drawer 改为大尺寸 Modal（禁止抽屉承载业务内容）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, App, Button, Card, Col, Divider, Empty, Form, Grid, Input, Modal,
  Popconfirm, Radio, Result, Row, Select, Space, Switch, Table, Tag, Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ArrowLeftOutlined, CloudSyncOutlined, DeleteOutlined, EditOutlined, ImportOutlined,
  ReloadOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import Page from '@/components/Page';
import StatCards from '@/components/StatCards';
import type { StatCardItem } from '@/components/StatCards';
import { usePermission } from '@/stores/app';
import { NEUTRAL, PALETTE, SHADOW } from '@/theme';
import {
  bulkSetParseMode, deleteField, fetchFieldModes, fetchProjectFields, importFields,
  parseFields, syncFields, updateField,
} from '@/api/projects';
import type {
  FieldDef, FieldModesData, FieldUpdatePayload, ParseFieldsResult, ParseModeDef, ParsedField,
  ProjectColumnInfo,
} from '@/api/projects';
import { fmtNum } from '@/utils';

const { useBreakpoint } = Grid;
const { Text } = Typography;

/** 「展开为子表」不在字典接口里，但对数组字段是合法取值，这里补上 */
const EXTRA_MODES: ParseModeDef[] = [
  { key: 'expand', name: '展开为子表', desc: '数组每个元素写入独立的子表', types: ['array'] },
];

const FIELD_TYPES = ['string', 'number', 'bool', 'json', 'array', 'object', 'date'];

/** 统一卡片外框 */
const cardStyle: React.CSSProperties = {
  background: NEUTRAL.surface,
  borderColor: NEUTRAL.border,
  borderRadius: 10,
  boxShadow: SHADOW.card,
};

interface FieldsPanelProps {
  projectId: number;
  /** 数据变更后通知外层（如详情页统计刷新） */
  onChanged?: () => void;
}

/** 按字段类型过滤可用解析方式 */
function modesFor(type: string | null | undefined, modes: ParseModeDef[]): ParseModeDef[] {
  const t = String(type || 'string').toLowerCase();
  return modes.filter((m) => m.types.includes('*') || m.types.includes(t));
}

function modeName(key: string, modes: ParseModeDef[]): string {
  return modes.find((m) => m.key === key)?.name || key || '不解析';
}

/* ══════════════ 字段编辑弹窗 ══════════════ */

interface FieldEditModalProps {
  open: boolean;
  projectId: number;
  field: FieldDef | null;
  modes: ParseModeDef[];
  columns: ProjectColumnInfo[];
  onClose: () => void;
  onSaved: () => void;
}

interface FieldEditValues {
  fieldName: string;
  fieldType?: string;
  parseMode: string;
  parsePath?: string;
  remark?: string;
  columnName: string;
  enabled: boolean;
}

function FieldEditModal({
  open, projectId, field, modes, columns, onClose, onSaved,
}: FieldEditModalProps) {
  const [form] = Form.useForm<FieldEditValues>();
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();
  const parseMode = Form.useWatch('parseMode', form);
  const fieldType = Form.useWatch('fieldType', form);

  useEffect(() => {
    if (!open || !field) return;
    form.setFieldsValue({
      fieldName: field.field_name,
      fieldType: field.field_type || 'string',
      parseMode: field.parse_mode || 'none',
      parsePath: field.parse_path || '',
      remark: field.remark || '',
      columnName: field.column_name,
      enabled: Number(field.enabled) === 1,
    });
  }, [open, field, form]);

  const submit = async () => {
    if (!field) return;
    const v = await form.validateFields();
    const body: FieldUpdatePayload = {
      fieldName: v.fieldName.trim(),
      fieldType: v.fieldType || 'string',
      parseMode: v.parseMode,
      parsePath: v.parseMode === 'path' || v.parseMode === 'suffix' ? (v.parsePath || '') : '',
      remark: v.remark || '',
      enabled: v.enabled ? 1 : 0,
    };
    // 列名仅在用户改动时提交（后端会做标识符清洗）
    if (v.columnName && v.columnName !== field.column_name) body.columnName = v.columnName.trim();

    setSaving(true);
    try {
      await updateField(projectId, field.field_key, body);
      message.success('字段已更新');
      onSaved();
      onClose();
    } catch {
      // 错误已由 api client 统一 toast
    } finally {
      setSaving(false);
    }
  };

  const available = modesFor(fieldType, modes);

  return (
    <Modal
      open={open}
      title={`编辑字段 · ${field?.field_name || ''}`}
      onCancel={onClose}
      onOk={() => void submit()}
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
      destroyOnHidden
      width={600}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 8 }} requiredMark="optional">
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="fieldName" label="字段名称" rules={[{ required: true, message: '请输入字段名称' }]}>
              <Input maxLength={64} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="fieldType" label="字段类型">
              <Select options={FIELD_TYPES.map((t) => ({ label: t, value: t }))} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="parseMode" label="解析方式">
              <Select
                options={available.map((m) => ({ label: m.name, value: m.key, title: m.desc }))}
                optionRender={(o) => {
                  const def = available.find((m) => m.key === o.value);
                  return (
                    <div>
                      <div style={{ fontSize: 13 }}>{def?.name}</div>
                      <div style={{ fontSize: 11.5, color: NEUTRAL.textQuaternary }}>{def?.desc}</div>
                    </div>
                  );
                }}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
          </Col>
        </Row>

        {(parseMode === 'path' || parseMode === 'suffix') && (
          <Form.Item
            name="parsePath"
            label={parseMode === 'path' ? '取值路径' : '固定后缀'}
            rules={[{ required: true, message: parseMode === 'path' ? '请输入取值路径' : '请输入后缀文本' }]}
            tooltip={parseMode === 'path' ? '如 user.name / data[0].name / address.city' : '如「（签约）」'}
          >
            <Input placeholder={parseMode === 'path' ? 'user.name' : '（签约）'} />
          </Form.Item>
        )}

        <Form.Item
          name="columnName"
          label="数据列名"
          tooltip="字段值实际落库的列，修改会影响后续写入；已有数据不会迁移"
          rules={[
            { pattern: /^[A-Za-z_][A-Za-z0-9_]{0,190}$/, message: '只能使用字母、数字、下划线，且不以数字开头' },
          ]}
        >
          <Input disabled={Number(field?.is_system) === 1} />
        </Form.Item>

        <Form.Item label="字段 ID">
          <Input value={field?.field_key || ''} disabled />
        </Form.Item>

        <Form.Item name="remark" label="备注">
          <Input.TextArea rows={2} maxLength={255} placeholder="可选" />
        </Form.Item>

        {columns.length > 0 && (
          <Alert
            type="info"
            showIcon
            title={`当前数据表共有 ${columns.length} 个列`}
            description="新增字段请使用「解析字段表 → 导入」或「同步结构」，后端会自动建列。"
          />
        )}
      </Form>
    </Modal>
  );
}

/* ══════════════ 字段面板 ══════════════ */

export function FieldsPanel({ projectId, onChanged }: FieldsPanelProps) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const can = usePermission();
  const canWrite = can('field:write');
  const { message, modal } = App.useApp();

  const [modes, setModes] = useState<ParseModeDef[]>([]);
  const [systemFields, setSystemFields] = useState<FieldModesData['system']>({});
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [columns, setColumns] = useState<ProjectColumnInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [error, setError] = useState('');

  // 批量操作
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [bulkMode, setBulkMode] = useState<string>('none');

  // 导入弹窗（V4.1：Modal 取代原右侧 Drawer）
  const [importOpen, setImportOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parseResult, setParseResult] = useState<ParseFieldsResult | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');

  // 编辑弹窗
  const [editOpen, setEditOpen] = useState(false);
  const [editingField, setEditingField] = useState<FieldDef | null>(null);

  const allModes = useMemo(() => {
    const base = [...modes];
    EXTRA_MODES.forEach((m) => { if (!base.some((b) => b.key === m.key)) base.push(m); });
    return base;
  }, [modes]);

  const load = useCallback(async () => {
    if (!canWrite) return;
    setLoading(true);
    setError('');
    try {
      const [dict, data] = await Promise.all([
        fetchFieldModes(),
        fetchProjectFields(projectId),
      ]);
      setModes(dict.modes || []);
      setSystemFields(dict.system || {});
      setFields(data.fieldDefs || []);
      setColumns(data.columns || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '字段配置加载失败');
    } finally {
      setLoading(false);
    }
  }, [projectId, canWrite]);

  useEffect(() => { void load(); }, [load]);

  /** 单字段改解析方式（表格内联下拉） */
  const changeMode = async (field: FieldDef, nextMode: string) => {
    if (nextMode === 'path' || nextMode === 'suffix') {
      setEditingField({ ...field, parse_mode: nextMode });
      setEditOpen(true);
      return;
    }
    try {
      await updateField(projectId, field.field_key, { parseMode: nextMode });
      setFields((prev) => prev.map((f) => (
        f.field_key === field.field_key ? { ...f, parse_mode: nextMode } : f
      )));
      message.success(`已把「${field.field_name}」设为 ${modeName(nextMode, allModes)}`);
      onChanged?.();
    } catch { /* 已 toast */ }
  };

  /** 批量设置解析方式 */
  const applyBulk = async () => {
    const keys = selectedKeys.map(String);
    if (!keys.length) {
      message.warning('请先勾选要修改的字段');
      return;
    }
    try {
      await bulkSetParseMode(projectId, keys.map((k) => ({ fieldKey: k, parseMode: bulkMode })));
      message.success(`已更新 ${keys.length} 个字段的解析方式`);
      setSelectedKeys([]);
      await load();
      onChanged?.();
    } catch { /* 已 toast */ }
  };

  /** 同步结构 */
  const doSync = () => {
    modal.confirm({
      title: '同步表结构并回填解析值？',
      content: '将按当前字段定义重新校正列名、补建缺失列，并回填历史数据的解析值；数据量大时耗时较长。',
      okText: '开始同步',
      cancelText: '取消',
      onOk: async () => {
        setSyncLoading(true);
        try {
          await syncFields(projectId);
          message.success('结构同步完成');
          await load();
          onChanged?.();
        } catch { /* 已 toast */ } finally {
          setSyncLoading(false);
        }
      },
    });
  };

  /** 解析粘贴内容（预览） */
  const doParse = async () => {
    if (!pasteText.trim()) {
      message.warning('请粘贴字段对照表内容');
      return;
    }
    setParsing(true);
    try {
      const r = await parseFields(projectId, pasteText);
      setParseResult(r);
      if (!r.fields.length) message.warning(r.errors[0] || '未解析到有效字段');
    } catch { /* 已 toast */ } finally {
      setParsing(false);
    }
  };

  /** 确认导入 */
  const doImport = async () => {
    if (!parseResult?.fields?.length) return;
    setImporting(true);
    try {
      await importFields(projectId, parseResult.fields, importMode);
      message.success(`已导入 ${parseResult.fields.length} 个字段定义`);
      setImportOpen(false);
      setPasteText('');
      setParseResult(null);
      await load();
      onChanged?.();
    } catch { /* 已 toast */ } finally {
      setImporting(false);
    }
  };

  const onDelete = async (field: FieldDef) => {
    try {
      await deleteField(projectId, field.field_key);
      message.success('字段定义已删除（数据列保留）');
      await load();
      onChanged?.();
    } catch { /* 已 toast */ }
  };

  const columnsDef = useMemo<ColumnsType<FieldDef>>(() => [
    {
      title: '字段名称',
      dataIndex: 'field_name',
      key: 'field_name',
      width: 190,
      fixed: 'left',
      sorter: (a, b) => String(a.field_name || '').localeCompare(String(b.field_name || '')),
      render: (_v, row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
          <span style={{ color: NEUTRAL.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {row.field_name}
          </span>
          {Number(row.is_system) === 1 && (
            <Tag
              style={{
                fontSize: 11, margin: 0, background: NEUTRAL.surfaceSunken,
                border: `1px solid ${NEUTRAL.border}`, color: PALETTE.primaryDeep,
              }}
            >
              系统
            </Tag>
          )}
          {Number(row.enabled) === 0 && <Tag color={PALETTE.gray} style={{ fontSize: 11, margin: 0 }}>停用</Tag>}
        </span>
      ),
    },
    {
      title: '字段 ID',
      dataIndex: 'field_key',
      key: 'field_key',
      width: 190,
      ellipsis: true,
      render: (v) => <Text code style={{ fontSize: 11.5 }}>{String(v)}</Text>,
    },
    {
      title: '数据列',
      dataIndex: 'column_name',
      key: 'column_name',
      width: 170,
      ellipsis: true,
      render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{String(v)}</Text>,
    },
    {
      title: '类型',
      dataIndex: 'field_type',
      key: 'field_type',
      width: 88,
      render: (v) => <Tag style={{ fontSize: 11, margin: 0 }}>{String(v || '-')}</Tag>,
    },
    {
      title: '解析方式',
      dataIndex: 'parse_mode',
      key: 'parse_mode',
      width: 190,
      render: (_v, row) => (
        <Select
          size="small"
          style={{ width: '100%' }}
          value={row.parse_mode || 'none'}
          disabled={!canWrite || (Number(row.is_system) === 1 && row.field_key === '_id')}
          options={modesFor(row.field_type, allModes).map((m) => ({ label: m.name, value: m.key }))}
          onChange={(v: string) => void changeMode(row, v)}
          popupMatchSelectWidth={280}
        />
      ),
    },
    {
      title: '取值路径',
      dataIndex: 'parse_path',
      key: 'parse_path',
      width: 140,
      ellipsis: true,
      render: (v) => (v
        ? <Text code style={{ fontSize: 11.5 }}>{String(v)}</Text>
        : <Text type="secondary">-</Text>),
    },
    {
      title: '已有数据',
      dataIndex: 'rows',
      key: 'rows',
      width: 100,
      align: 'right',
      sorter: (a, b) => Number(a.rows || 0) - Number(b.rows || 0),
      render: (v) => {
        const n = Number(v || 0);
        return n > 0
          ? <span style={{ color: PALETTE.primary, fontWeight: 600 }}>{fmtNum(n)}</span>
          : <span style={{ color: NEUTRAL.textQuaternary }}>0</span>;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      fixed: 'right',
      render: (_v, row) => (
        <Space size={2}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            disabled={!canWrite}
            onClick={() => { setEditingField(row); setEditOpen(true); }}
          >
            编辑
          </Button>
          <Popconfirm
            title="删除字段定义？"
            description="仅删除字段定义，数据列与已有数据保留"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => void onDelete(row)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} disabled={!canWrite} />
          </Popconfirm>
        </Space>
      ),
    },
  ], [allModes, canWrite]);

  /** 解析预览列 */
  const previewColumns = useMemo<ColumnsType<ParsedField>>(() => [
    { title: '字段名称', dataIndex: 'fieldName', key: 'fieldName', width: 160, ellipsis: true },
    {
      title: '字段 ID',
      dataIndex: 'fieldKey',
      key: 'fieldKey',
      width: 180,
      ellipsis: true,
      render: (v) => <Text code style={{ fontSize: 11 }}>{String(v)}</Text>,
    },
    { title: '类型', dataIndex: 'fieldType', key: 'fieldType', width: 80 },
    {
      title: '数据列',
      dataIndex: 'columnName',
      key: 'columnName',
      width: 160,
      ellipsis: true,
      render: (v) => <Text type="secondary" style={{ fontSize: 11.5 }}>{String(v || '-')}</Text>,
    },
    {
      title: '状态',
      key: 'exists',
      width: 100,
      render: (_v, row) => (row.exists
        ? <Tag color={PALETTE.cyan} style={{ margin: 0 }}>已有列</Tag>
        : <Tag color={PALETTE.green} style={{ margin: 0 }}>新列</Tag>),
    },
    {
      title: '已有数据',
      dataIndex: 'rows',
      key: 'rows',
      width: 90,
      align: 'right',
      render: (v) => fmtNum(Number(v || 0)),
    },
  ], []);

  if (!canWrite) {
    return (
      <Result
        status="403"
        title="无字段配置权限"
        subTitle="当前账号缺少「字段设置」（field:write）权限，请联系管理员分配角色。"
      />
    );
  }

  if (error) {
    return (
      <Result
        status="warning"
        title="字段配置加载失败"
        subTitle={error}
        extra={<Button type="primary" icon={<ReloadOutlined />} onClick={() => void load()}>重试</Button>}
      />
    );
  }

  const parsedCount = fields.filter((f) => (f.parse_mode || 'none') !== 'none').length;
  const emptyCount = fields.filter((f) => Number(f.rows || 0) === 0).length;
  const systemCount = fields.filter((f) => Number(f.is_system) === 1).length;

  const statItems: StatCardItem[] = [
    { key: 'defs', label: '字段定义', value: fmtNum(fields.length), suffix: '个', color: PALETTE.primary, hint: `系统字段 ${systemCount} 个` },
    { key: 'parsed', label: '已配置解析', value: fmtNum(parsedCount), suffix: '个', color: PALETTE.green, hint: fields.length ? `占比 ${Math.round((parsedCount / fields.length) * 100)}%` : '暂无字段' },
    { key: 'empty', label: '无数据字段', value: fmtNum(emptyCount), suffix: '个', color: PALETTE.yellow, hint: '尚未回填任何行' },
    { key: 'cols', label: '数据表列数', value: fmtNum(columns.length), suffix: '列', color: PALETTE.orange, hint: '同步结构可补建缺失列' },
  ];

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <StatCards items={statItems} />
      </div>

      <Card
        variant="outlined"
        style={cardStyle}
        styles={{ body: { padding: isMobile ? 12 : 14 } }}
        title={<span style={{ fontSize: 14, fontWeight: 600, color: NEUTRAL.text }}>字段列表</span>}
        extra={
          <Space size={8} wrap>
            <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>解析字段表</Button>
            <Button icon={<CloudSyncOutlined />} loading={syncLoading} onClick={doSync}>同步结构</Button>
          </Space>
        }
      >
        {selectedKeys.length > 0 && (
          <>
            <Space size={8} wrap style={{ marginBottom: 10 }}>
              <Tag color={PALETTE.primary} style={{ margin: 0 }}>已选 {selectedKeys.length} 个字段</Tag>
              <Select
                size="small"
                style={{ width: 200 }}
                value={bulkMode}
                onChange={setBulkMode}
                options={allModes.map((m) => ({ label: m.name, value: m.key }))}
              />
              <Button type="primary" size="small" icon={<ThunderboltOutlined />} onClick={() => void applyBulk()}>
                批量设置解析方式
              </Button>
              <Button size="small" onClick={() => setSelectedKeys([])}>取消选择</Button>
            </Space>
            <Divider style={{ margin: '4px 0 10px' }} />
          </>
        )}

        <Table<FieldDef>
          rowKey="field_key"
          size="small"
          loading={loading}
          columns={columnsDef}
          dataSource={fields}
          scroll={{ x: 1180 }}
          rowSelection={{ selectedRowKeys: selectedKeys, onChange: (keys) => setSelectedKeys(keys) }}
          locale={{
            emptyText: (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有字段定义，先粘贴简道云字段对照表导入" />
            ),
          }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 个字段` }}
        />
      </Card>

      {/* ── 解析并导入字段表：Modal（V4.1 禁止 Drawer 承载业务内容） ── */}
      <Modal
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        title="解析并导入字段表"
        width={isMobile ? '96%' : 900}
        destroyOnHidden
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', paddingRight: 4 } }}
        footer={
          <Space>
            <Button onClick={() => setImportOpen(false)}>取消</Button>
            <Button
              type="primary"
              disabled={!parseResult?.fields?.length}
              loading={importing}
              onClick={() => void doImport()}
            >
              确认导入（{parseResult?.fields?.length || 0}）
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title="从简道云「表单设置 → 字段对照表」整表复制后粘贴到下方"
          description="支持表头为「字段名称 / 字段ID / 字段类型 / 说明」的表格（Tab 分隔、Markdown 表格或从 Excel 复制均可）。系统字段会被自动识别。"
        />

        <Input.TextArea
          rows={7}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={'字段名称\t字段ID\t字段类型\n连锁名称\t_widget_1791449342206\tstring\n门店数\t_widget_1792048325259\tnumber'}
          style={{ fontFamily: 'SF Mono, Consolas, monospace', fontSize: 12 }}
        />

        <Space size={8} wrap style={{ marginTop: 10 }}>
          <Button type="primary" icon={<ThunderboltOutlined />} loading={parsing} onClick={() => void doParse()}>
            解析预览
          </Button>
          <Radio.Group
            value={importMode}
            onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}
            optionType="button"
            buttonStyle="solid"
            size="small"
            options={[
              { label: '合并（保留未出现的字段）', value: 'merge' },
              { label: '覆盖（清空后重建）', value: 'replace' },
            ]}
          />
        </Space>

        {parseResult && (
          <div style={{ marginTop: 14 }}>
            <Space size={8} wrap style={{ marginBottom: 8 }}>
              <Tag color={PALETTE.primary} style={{ margin: 0 }}>共 {parseResult.total} 个</Tag>
              <Tag color={PALETTE.green} style={{ margin: 0 }}>新增列 {parseResult.newCount} 个</Tag>
              <Tag color={PALETTE.cyan} style={{ margin: 0 }}>系统字段 {parseResult.systemCount} 个</Tag>
              {parseResult.skipped > 0 && (
                <Tag color={PALETTE.gray} style={{ margin: 0 }}>跳过 {parseResult.skipped} 行</Tag>
              )}
            </Space>
            {parseResult.errors.map((e) => (
              <Alert key={e} type="error" showIcon title={e} style={{ marginBottom: 6 }} />
            ))}
            {parseResult.warnings.map((w) => (
              <Alert key={w} type="warning" showIcon title={w} style={{ marginBottom: 6 }} />
            ))}
            <Table<ParsedField>
              rowKey="fieldKey"
              size="small"
              columns={previewColumns}
              dataSource={parseResult.fields}
              scroll={{ x: 760 }}
              pagination={{ pageSize: 50, showSizeChanger: false, showTotal: (t) => `共 ${t} 个字段` }}
            />
          </div>
        )}

        <Divider />
        <Tooltip title={`数据表当前已有 ${columns.length} 个列`}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            导入会注册字段定义并按需自动建列，随后可用「同步结构」回填历史数据的解析值。
            当前数据表已有 {columns.length} 个列
            {Object.keys(systemFields).length > 0 ? `，系统内置字段 ${Object.keys(systemFields).length} 个。` : '。'}
          </Text>
        </Tooltip>
      </Modal>

      <FieldEditModal
        open={editOpen}
        projectId={projectId}
        field={editingField}
        modes={allModes}
        columns={columns}
        onClose={() => setEditOpen(false)}
        onSaved={() => { void load(); onChanged?.(); }}
      />
    </div>
  );
}

/* ══════════════ 路由页 ══════════════ */

export default function ProjectFieldsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const projectId = Number(id);

  if (!projectId) {
    return (
      <Page title="字段配置">
        <Result
          status="404"
          title="项目 ID 无效"
          extra={<Button onClick={() => navigate('/projects')}>返回项目列表</Button>}
        />
      </Page>
    );
  }

  return (
    <Page
      title="字段配置"
      actions={
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/projects/${projectId}`)}>
          返回项目详情
        </Button>
      }
    >
      <FieldsPanel projectId={projectId} />
    </Page>
  );
}
