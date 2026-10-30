/** 数据集管理：SQL / 数据表 / 项目 三种来源 + V4.1 标准结构 + 动态列预览（Modal）+ 结构化 SQL 报错与自动加引号提示 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Space, Tag, Modal, Empty, Alert, Typography, App, Table, Tooltip,
  Segmented, Spin, Statistic, Card, Input, Select, Grid,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, PlayCircleOutlined, DeleteOutlined, EditOutlined,
  TableOutlined, CodeOutlined, ProjectOutlined, DatabaseOutlined, ColumnWidthOutlined,
  ExclamationCircleOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import {
  ProTable, ModalForm, ProFormText, ProFormTextArea, ProFormSelect, ProFormDigit,
  ProFormRadio, ProFormSwitch,
} from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import Page from '@/components/Page';
import type { StatCardItem } from '@/components/StatCards';
import { NEUTRAL, PALETTE } from '@/theme';
import { usePermission } from '@/stores/app';
import { fmtTime, fmtNum, truncate } from '@/utils';
import {
  listDatasets, createDataset, updateDataset, deleteDataset, previewDataset, testDatasetSql,
  listProjectOptions, parseStructuredSqlError,
} from '@/api/datasets';
import type {
  Dataset, DatasetPayload, DatasetPreview, DatasetSourceType, ProjectOption, PreviewColumn,
  StructuredSqlError,
} from '@/api/datasets';
import { listDatasources, listDatasourceTables } from '@/api/datasources';
import type { Datasource, DsTableInfo } from '@/api/datasources';

const { Text, Paragraph } = Typography;
const { useBreakpoint } = Grid;

const SOURCE_TYPE_META: Record<DatasetSourceType, { label: string; color: string; icon: React.ReactNode; desc: string }> = {
  sql: { label: 'SQL 查询', color: PALETTE.primary, icon: <CodeOutlined />, desc: '手写只读 SELECT / WITH 查询，支持连表与聚合；包含连字符等特殊字符的表名将自动添加引号' },
  table: { label: '数据表', color: PALETTE.cyan, icon: <TableOutlined />, desc: '直接读取数据源中的整张表' },
  project: { label: '项目数据', color: PALETTE.green, icon: <ProjectOutlined />, desc: '读取推送项目的原始表或解析表' },
};

type DsFormValues = {
  name?: string;
  description?: string;
  datasourceId?: number;
  sourceType?: DatasetSourceType;
  sourceSql?: string;
  sourceTable?: string;
  projectId?: number | null;
  cacheTtl?: number;
  status?: number | boolean;
};

/** 结构化 SQL 错误展示组件：完整展示错误码、原始 SQL、数据库报错与修复建议 */
function SqlErrorAlert({ error, title = 'SQL 执行失败' }: { error: StructuredSqlError; title?: string }) {
  return (
    <Alert
      type="error"
      showIcon
      style={{ marginBottom: 14 }}
      title={
        <Space size={8} wrap>
          <span style={{ fontWeight: 600 }}>{title}</span>
          {error.code && <Tag color={PALETTE.red} style={{ marginInlineEnd: 0 }}>错误码：{error.code}</Tag>}
        </Space>
      }
      description={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, fontSize: 12.5 }}>
          <div style={{ color: NEUTRAL.text }}>
            <strong>错误说明：</strong>{error.message}
          </div>
          {error.sqlMessage && error.sqlMessage !== error.message && (
            <div style={{ color: NEUTRAL.textSecondary }}>
              <strong>数据库返回（sqlMessage）：</strong>
              <Text code style={{ fontSize: 12 }}>{error.sqlMessage}</Text>
            </div>
          )}
          {(error.originalSql || error.sql) && (
            <div style={{ color: NEUTRAL.textSecondary }}>
              <strong>原始 SQL：</strong>
              <pre
                style={{
                  margin: '4px 0 0',
                  padding: '6px 10px',
                  background: NEUTRAL.surfaceAlt,
                  border: `1px solid ${NEUTRAL.border}`,
                  borderRadius: 6,
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  color: NEUTRAL.text,
                }}
              >
                {error.originalSql || error.sql}
              </pre>
            </div>
          )}
          {error.rewrittenSql && error.rewrittenSql !== (error.originalSql || error.sql) && (
            <div style={{ color: NEUTRAL.textSecondary }}>
              <strong>自动重写 SQL：</strong>
              <Text code style={{ fontSize: 12 }}>{error.rewrittenSql}</Text>
            </div>
          )}
          {error.suggestion && (
            <div
              style={{
                marginTop: 2,
                padding: '6px 10px',
                background: NEUTRAL.surface,
                border: `1px solid ${NEUTRAL.border}`,
                borderLeft: `3px solid ${PALETTE.orange}`,
                borderRadius: 6,
                color: NEUTRAL.text,
              }}
            >
              <strong style={{ color: PALETTE.orange }}>修复建议：</strong>{error.suggestion}
            </div>
          )}
        </div>
      }
    />
  );
}

export default function DatasetsPage() {
  const { message, modal } = App.useApp();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const can = usePermission();
  const canWrite = can('dataset:write');

  const actionRef = useRef<ActionType>(null);
  const [allDatasets, setAllDatasets] = useState<Dataset[]>([]);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [tables, setTables] = useState<DsTableInfo[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>('');

  /* ---------- 搜索筛选 ---------- */
  const [keyword, setKeyword] = useState('');
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string>('');

  /* ---------- 最近自动加引号提示横幅 ---------- */
  const [autoQuoteBanner, setAutoQuoteBanner] = useState<string>('');

  /* ---------- 新建 / 编辑 ---------- */
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Dataset | null>(null);
  const [curSource, setCurSource] = useState<DatasetSourceType>('sql');
  const [sqlTesting, setSqlTesting] = useState(false);
  const [sqlSuccess, setSqlSuccess] = useState<{ text: string; autoQuoteNotice?: string; sql?: string } | null>(null);
  const [sqlError, setSqlError] = useState<StructuredSqlError | null>(null);
  const formRef = useRef<any>(null);

  /* ---------- 预览（Modal） ---------- */
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRow, setPreviewRow] = useState<Dataset | null>(null);
  const [preview, setPreview] = useState<DatasetPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<StructuredSqlError | null>(null);
  const [previewLimit, setPreviewLimit] = useState(20);
  const [visibleCols, setVisibleCols] = useState<number>(20);

  /** 基础下拉数据 */
  const loadRefs = useCallback(async () => {
    try {
      const r = await listDatasources();
      const list = r.list || [];
      setDatasources(list);
    } catch { /* client 已提示 */ }
    try {
      const p = await listProjectOptions();
      setProjects(p);
    } catch { /* client 已提示 */ }
  }, []);

  useEffect(() => { loadRefs(); }, [loadRefs]);

  const dsOptions = useMemo(
    () => datasources.map((d) => ({
      label: `${d.name}${d.isDefault ? '（本机）' : ''}`,
      value: d.id,
    })),
    [datasources]
  );

  const projectOptions = useMemo(
    () => projects.map((p) => ({ label: p.name, value: p.id })),
    [projects]
  );

  /** 按数据源加载可选表 */
  const loadTables = useCallback(async (datasourceId?: number) => {
    if (!datasourceId && datasourceId !== 0) { setTables([]); return; }
    setTablesLoading(true);
    try {
      const list = await listDatasourceTables(datasourceId, undefined);
      setTables(list || []);
    } catch {
      setTables([]);
    } finally {
      setTablesLoading(false);
    }
  }, []);

  const openCreate = () => {
    setEditing(null);
    setCurSource('sql');
    setSqlSuccess(null);
    setSqlError(null);
    setTables([]);
    setFormOpen(true);
  };

  const openEdit = (row: Dataset) => {
    setEditing(row);
    setCurSource(row.sourceType);
    setSqlSuccess(null);
    setSqlError(null);
    setFormOpen(true);
    if (row.sourceType === 'table') loadTables(row.datasourceId);
  };

  const initialValues = useMemo<DsFormValues>(() => {
    if (!editing) {
      return { datasourceId: 0, sourceType: 'sql', cacheTtl: 0, status: 1, projectId: null };
    }
    return {
      name: editing.name,
      description: editing.description,
      datasourceId: editing.datasourceId,
      sourceType: editing.sourceType,
      sourceSql: editing.sourceSql,
      sourceTable: editing.sourceTable,
      projectId: editing.projectId ?? null,
      cacheTtl: editing.cacheTtl,
      status: editing.status,
    };
  }, [editing]);

  const handleSubmit = async (values: DsFormValues): Promise<boolean> => {
    const payload: DatasetPayload = {
      name: values.name || '',
      description: values.description,
      datasourceId: values.datasourceId ?? 0,
      sourceType: values.sourceType || 'sql',
      sourceSql: values.sourceType === 'sql' ? values.sourceSql : '',
      sourceTable: values.sourceType === 'table' ? values.sourceTable : (editing?.sourceTable || ''),
      projectId: values.sourceType === 'project' ? (values.projectId ?? null) : null,
      cacheTtl: values.cacheTtl ?? 0,
      status: values.status === 0 || values.status === false ? 0 : 1,
    };
    setSqlError(null);
    try {
      let saved: Dataset;
      if (editing) {
        saved = await updateDataset(editing.id, payload);
        message.success('数据集已更新');
      } else {
        saved = await createDataset(payload);
        message.success('数据集已创建');
      }
      if (saved?.autoQuoteNotice) {
        setAutoQuoteBanner(saved.autoQuoteNotice);
        message.info(saved.autoQuoteNotice, 5);
      }
      actionRef.current?.reload();
      setFormOpen(false);
      return true;
    } catch (e) {
      const structured = parseStructuredSqlError(e as Error, values.sourceSql);
      setSqlError(structured);
      return false;
    }
  };

  /** 表单内试跑 SQL */
  const handleTestSql = async () => {
    if (!formRef.current) return;
    const rawSql = formRef.current.getFieldValue('sourceSql');
    const dsId = formRef.current.getFieldValue('datasourceId') ?? 0;
    if (!rawSql || !String(rawSql).trim()) {
      message.warning('请先填写 SQL 查询语句');
      return;
    }
    setSqlTesting(true);
    setSqlSuccess(null);
    setSqlError(null);
    try {
      const r = await testDatasetSql({
        datasourceId: dsId,
        sql: String(rawSql),
        limit: 10,
      });
      setSqlSuccess({
        text: `试跑成功：返回 ${r.rowCount} 行 / ${r.columns.length} 列，耗时 ${r.elapsed}ms`,
        autoQuoteNotice: r.autoQuoteNotice,
        sql: r.rewrittenSql || r.sql,
      });
    } catch (e) {
      setSqlError(parseStructuredSqlError(e as Error, String(rawSql)));
    } finally {
      setSqlTesting(false);
    }
  };

  /* ---------- 预览（Modal） ---------- */
  const openPreview = async (row: Dataset) => {
    setPreviewRow(row);
    setPreviewOpen(true);
    setPreview(null);
    setPreviewError(null);
    setVisibleCols(20);
    setPreviewLoading(true);
    try {
      const r = await previewDataset(row.id, previewLimit);
      setPreview(r);
    } catch (e) {
      setPreviewError(parseStructuredSqlError(e as Error, row.sourceSql));
    } finally {
      setPreviewLoading(false);
    }
  };

  const reloadPreview = async (limit: number) => {
    if (!previewRow) return;
    setPreviewLimit(limit);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const r = await previewDataset(previewRow.id, limit);
      setPreview(r);
    } catch (e) {
      setPreviewError(parseStructuredSqlError(e as Error, previewRow.sourceSql));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDelete = (row: Dataset) => {
    modal.confirm({
      title: `删除数据集「${row.name}」`,
      icon: <ExclamationCircleOutlined style={{ color: PALETTE.red }} />,
      content: '删除后不可恢复；若已被报表引用将无法删除。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteDataset(row.id);
          message.success('数据集已删除');
          actionRef.current?.reload();
        } catch { /* client 已提示 */ }
      },
    });
  };

  /** V4.1 数据卡片（5 个：数据集总数 / 表型 / 项目型 / SQL 型 / 停用数） */
  const statItems = useMemo<StatCardItem[]>(() => {
    const total = allDatasets.length;
    const tableCount = allDatasets.filter((d) => d.sourceType === 'table').length;
    const projectCount = allDatasets.filter((d) => d.sourceType === 'project').length;
    const sqlCount = allDatasets.filter((d) => d.sourceType === 'sql').length;
    const disabledCount = allDatasets.filter((d) => !d.status).length;

    return [
      {
        key: 'total',
        label: '数据集总数',
        value: total,
        suffix: '个',
        color: PALETTE.primary,
        onClick: () => setSourceTypeFilter(''),
      },
      {
        key: 'table',
        label: '表型数据集',
        value: tableCount,
        suffix: '个',
        color: PALETTE.cyan,
        onClick: () => setSourceTypeFilter('table'),
      },
      {
        key: 'project',
        label: '项目型数据集',
        value: projectCount,
        suffix: '个',
        color: PALETTE.green,
        onClick: () => setSourceTypeFilter('project'),
      },
      {
        key: 'sql',
        label: 'SQL 型数据集',
        value: sqlCount,
        suffix: '个',
        color: PALETTE.violet,
        onClick: () => setSourceTypeFilter('sql'),
      },
      {
        key: 'disabled',
        label: '停用数',
        value: disabledCount,
        suffix: '个',
        color: disabledCount > 0 ? PALETTE.yellow : PALETTE.teal,
      },
    ];
  }, [allDatasets]);

  const columns: ProColumns<Dataset>[] = [
    {
      title: '数据集名称',
      dataIndex: 'name',
      width: 240,
      sorter: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
      render: (_, row) => (
        <Space size={4} direction="vertical">
          <Space size={6} wrap>
            <TableOutlined style={{ color: PALETTE.primary }} />
            <Text strong style={{ color: NEUTRAL.text }}>{row.name}</Text>
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.code}</Text>
        </Space>
      ),
    },
    {
      title: '来源',
      dataIndex: 'sourceType',
      width: 230,
      sorter: (a, b) => String(a.sourceType || '').localeCompare(String(b.sourceType || '')),
      render: (_, row) => {
        const meta = SOURCE_TYPE_META[row.sourceType] || SOURCE_TYPE_META.sql;
        return (
          <Space size={4} direction="vertical">
            <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
              {meta.icon} {meta.label}
            </Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {row.sourceType === 'project'
                ? `项目 #${row.projectId ?? '-'} · ${row.sourceTable === 'parsed' ? '解析表' : '原始表'}`
                : row.sourceType === 'table'
                  ? row.sourceTable || '未指定表'
                  : truncate(row.sourceSql || '', 34)}
            </Text>
          </Space>
        );
      },
    },
    {
      title: '数据源',
      dataIndex: 'datasourceName',
      width: 180,
      render: (_, row) => (
        <Space size={4}>
          <DatabaseOutlined style={{ color: NEUTRAL.textTertiary }} />
          <Text style={{ fontSize: 13, color: NEUTRAL.textSecondary }}>
            {row.datasourceName || (row.datasourceId === 0 ? '本机数据库' : `#${row.datasourceId}`)}
          </Text>
        </Space>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      ellipsis: true,
      render: (_, row) => row.description || <Text type="secondary">-</Text>,
    },
    {
      title: '缓存',
      dataIndex: 'cacheTtl',
      width: 100,
      sorter: (a, b) => Number(a.cacheTtl || 0) - Number(b.cacheTtl || 0),
      render: (_, row) =>
        row.cacheTtl ? <Tag color={PALETTE.yellow}>{row.cacheTtl}s</Tag> : <Text type="secondary">关闭</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      sorter: (a, b) => Number(a.status || 0) - Number(b.status || 0),
      render: (_, row) => (row.status ? <Tag color={PALETTE.green}>启用</Tag> : <Tag color={PALETTE.gray}>停用</Tag>),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 165,
      sorter: (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
      render: (_, row) => <Text type="secondary" style={{ fontSize: 12.5 }}>{fmtTime(row.createdAt)}</Text>,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 190,
      fixed: 'right',
      render: (_, row) => (
        <Space size={12} wrap>
          <a onClick={() => openPreview(row)}>
            <PlayCircleOutlined /> 预览
          </a>
          {canWrite && <a onClick={() => openEdit(row)}><EditOutlined /> 编辑</a>}
          {canWrite && (
            <a style={{ color: PALETTE.red }} onClick={() => handleDelete(row)}>
              <DeleteOutlined /> 删除
            </a>
          )}
        </Space>
      ),
    },
  ];

  /** 预览表格列：按返回的 columns 动态生成 */
  const previewColumns = useMemo(() => {
    if (!preview) return [];
    return preview.columns.slice(0, visibleCols).map((c: PreviewColumn) => ({
      title: (
        <Space size={4} direction="vertical" style={{ lineHeight: 1.25 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: NEUTRAL.text }}>{c.name}</span>
          <span style={{ fontSize: 10.5, color: NEUTRAL.textTertiary, fontWeight: 400 }}>{c.type}</span>
        </Space>
      ),
      dataIndex: c.name,
      key: c.name,
      width: c.name === 'raw_json' ? 260 : undefined,
      ellipsis: true,
      render: (v: unknown) => {
        if (v === null || v === undefined) return <Text type="secondary">NULL</Text>;
        if (typeof v === 'object') {
          const s = JSON.stringify(v);
          return (
            <Tooltip title={<pre style={{ margin: 0, maxHeight: 260, overflow: 'auto' }}>{JSON.stringify(v, null, 2)}</pre>}>
              <Text code style={{ fontSize: 12 }}>{truncate(s, 40)}</Text>
            </Tooltip>
          );
        }
        const s = String(v);
        return s.length > 40 ? <Tooltip title={s}><span>{truncate(s, 40)}</span></Tooltip> : s;
      },
    }));
  }, [preview, visibleCols]);

  return (
    <Page
      title="数据集"
      search={
        <>
          <Select
            allowClear
            placeholder="来源类型筛选"
            value={sourceTypeFilter || undefined}
            onChange={(v) => setSourceTypeFilter(v || '')}
            options={(Object.keys(SOURCE_TYPE_META) as DatasetSourceType[]).map((k) => ({
              label: SOURCE_TYPE_META[k].label,
              value: k,
            }))}
            style={{ width: isMobile ? 140 : 170 }}
          />
          <Input.Search
            allowClear
            placeholder="搜索名称 / 编码 / 描述"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={(v) => setKeyword(v)}
            style={{ width: isMobile ? 190 : 250 }}
          />
        </>
      }
      actions={
        canWrite ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建数据集
          </Button>
        ) : undefined
      }
      extra={
        <Button icon={<ReloadOutlined />} onClick={() => { loadRefs(); actionRef.current?.reload(); }}>
          刷新
        </Button>
      }
      stats={statItems}
    >
      {autoQuoteBanner && (
        <Alert
          type="info"
          showIcon
          closable
          onClose={() => setAutoQuoteBanner('')}
          style={{ marginBottom: 12 }}
          title="SQL 标识符已自动加引号"
          description={autoQuoteBanner}
        />
      )}

      {loadError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          title="加载数据集列表失败"
          description={loadError}
          action={
            <Button size="small" onClick={() => actionRef.current?.reload()}>
              重试
            </Button>
          }
        />
      )}

      <ProTable<Dataset, { keyword?: string; sourceTypeFilter?: string }>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        params={{ keyword, sourceTypeFilter }}
        scroll={{ x: 'max-content' }}
        search={false}
        options={{ density: false, fullScreen: true, setting: true, reload: false }}
        pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
        headerTitle="数据集列表"
        locale={{ emptyText: <Empty description={keyword || sourceTypeFilter ? '没有符合条件的数据集' : '暂无数据集'} /> }}
        request={async (params) => {
          setLoadError('');
          try {
            const fullList = await listDatasets(params.keyword);
            if (!params.keyword) setAllDatasets(fullList || []);
            let list = fullList || [];
            if (params.sourceTypeFilter) {
              list = list.filter((d) => d.sourceType === params.sourceTypeFilter);
            }
            return { data: list, total: list.length, success: true };
          } catch (e) {
            setLoadError(e instanceof Error ? e.message : '请求失败');
            return { data: [], total: 0, success: false };
          }
        }}
      />

      {/* ---------- 新建 / 编辑（ModalForm） ---------- */}
      <ModalForm<DsFormValues>
        title={editing ? `编辑数据集 · ${editing.name}` : '新建数据集'}
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o);
          if (!o) {
            setSqlSuccess(null);
            setSqlError(null);
          }
        }}
        formRef={formRef}
        width={isMobile ? '94vw' : 700}
        initialValues={initialValues}
        onFinish={handleSubmit}
        modalProps={{ destroyOnHidden: true }}
        onValuesChange={(changed: Partial<DsFormValues>) => {
          if (changed.sourceType !== undefined) {
            setCurSource(changed.sourceType);
            setSqlSuccess(null);
            setSqlError(null);
            if (changed.sourceType === 'table') {
              const dsId = formRef.current?.getFieldValue('datasourceId');
              loadTables(dsId);
            }
          }
          if (changed.datasourceId !== undefined) {
            setTables([]);
            if (formRef.current?.getFieldValue('sourceType') === 'table') {
              loadTables(changed.datasourceId);
            }
          }
        }}
        submitter={{
          searchConfig: { submitText: editing ? '保存' : '创建', resetText: '取消' },
        }}
      >
        <ProFormText
          name="name"
          label="数据集名称"
          placeholder="如：门店销售日报 / CRM 签约明细"
          rules={[{ required: true, message: '请输入数据集名称' }]}
        />
        <ProFormTextArea
          name="description"
          label="描述"
          placeholder="说明数据口径与用途"
          fieldProps={{ autoSize: { minRows: 2, maxRows: 4 } }}
        />

        <ProFormRadio.Group
          name="sourceType"
          label="来源类型"
          radioType="button"
          options={(Object.keys(SOURCE_TYPE_META) as DatasetSourceType[]).map((k) => ({
            label: SOURCE_TYPE_META[k].label,
            value: k,
          }))}
          rules={[{ required: true }]}
          fieldProps={{
            onChange: (e: any) => setCurSource(e.target.value),
          }}
        />
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={SOURCE_TYPE_META[curSource]?.desc}
        />

        <ProFormSelect
          name="datasourceId"
          label="数据源"
          options={dsOptions}
          rules={[{ required: true, message: '请选择数据源' }]}
          placeholder="选择数据源（0 = 本机数据库）"
          fieldProps={{ showSearch: true, optionFilterProp: 'label' }}
        />

        {curSource === 'sql' && (
          <>
            <ProFormTextArea
              name="sourceSql"
              label="SQL 查询"
              placeholder="SELECT * FROM `zkcrm-ry` WHERE ..."
              tooltip="仅允许单条只读 SELECT / WITH 查询；特殊表名（含连字符 - 等）系统将自动加引号"
              fieldProps={{ autoSize: { minRows: 5, maxRows: 14 }, style: { fontFamily: 'monospace', fontSize: 12.5 } }}
              rules={[{ required: true, message: '请输入 SQL 查询语句' }]}
            />
            <Space style={{ marginBottom: 10 }} wrap>
              <Button icon={<ThunderboltOutlined />} loading={sqlTesting} onClick={handleTestSql}>
                测试 SQL（前 10 行）
              </Button>
            </Space>
            {sqlSuccess && (
              <Alert
                type="success"
                showIcon
                style={{ marginBottom: 16 }}
                title={sqlSuccess.text}
                description={
                  (sqlSuccess.autoQuoteNotice || sqlSuccess.sql) ? (
                    <div style={{ fontSize: 12, marginTop: 4 }}>
                      {sqlSuccess.autoQuoteNotice && (
                        <div style={{ color: PALETTE.primaryDeep, fontWeight: 500, marginBottom: 2 }}>
                          {sqlSuccess.autoQuoteNotice}
                        </div>
                      )}
                      {sqlSuccess.sql && (
                        <div>
                          执行语句：<Text code style={{ fontSize: 12 }}>{sqlSuccess.sql}</Text>
                        </div>
                      )}
                    </div>
                  ) : undefined
                }
              />
            )}
            {sqlError && <SqlErrorAlert error={sqlError} title="SQL 校验 / 执行失败" />}
          </>
        )}

        {curSource === 'table' && (
          <ProFormSelect
            name="sourceTable"
            label="数据表"
            placeholder={tablesLoading ? '加载中…' : '请选择数据表'}
            options={tables.map((t) => ({ label: t.comment ? `${t.name}（${t.comment}）` : t.name, value: t.name }))}
            rules={[{ required: true, message: '请选择数据表' }]}
            fieldProps={{ showSearch: true, optionFilterProp: 'label', loading: tablesLoading }}
          />
        )}

        {curSource === 'project' && (
          <>
            <ProFormSelect
              name="projectId"
              label="关联项目"
              placeholder="请选择项目"
              options={projectOptions}
              rules={[{ required: true, message: '请选择项目' }]}
              fieldProps={{ showSearch: true, optionFilterProp: 'label' }}
            />
            <ProFormSelect
              name="sourceTable"
              label="数据表"
              options={[
                { label: '解析表（字段已展开，推荐）', value: 'parsed' },
                { label: '原始表（原始 JSON 与系统列）', value: 'raw' },
              ]}
              initialValue="parsed"
            />
          </>
        )}

        <ProFormDigit
          name="cacheTtl"
          label="缓存时长（秒）"
          min={0}
          max={86400}
          fieldProps={{ precision: 0, style: { width: '100%' } }}
          placeholder="0 表示不缓存"
        />
        <ProFormSwitch name="status" label="启用该数据集" />
      </ModalForm>

      {/* ---------- 数据预览弹窗（Modal） ---------- */}
      <Modal
        title={`数据预览 · ${previewRow?.name || ''}`}
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={<Button onClick={() => setPreviewOpen(false)}>关闭</Button>}
        width={isMobile ? '95vw' : 1040}
        destroyOnHidden
      >
        {previewLoading ? (
          <div style={{ padding: 60, textAlign: 'center' }}><Spin size="large" /></div>
        ) : previewError ? (
          <SqlErrorAlert error={previewError} title="数据集预览失败" />
        ) : !preview ? (
          <Empty description="暂无数据" />
        ) : (
          <>
            {preview.autoQuoteNotice && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                title="已自动为特殊标识符加引号"
                description={preview.autoQuoteNotice}
              />
            )}

            <Space wrap style={{ marginBottom: 14 }}>
              <Card size="small" styles={{ body: { padding: '8px 14px' } }} style={{ borderColor: NEUTRAL.border }}>
                <Statistic title="返回行数" value={preview.rowCount} valueStyle={{ fontSize: 18, color: PALETTE.primary }} />
              </Card>
              <Card size="small" styles={{ body: { padding: '8px 14px' } }} style={{ borderColor: NEUTRAL.border }}>
                <Statistic title="列数" value={preview.columns.length} valueStyle={{ fontSize: 18, color: PALETTE.cyan }} />
              </Card>
              <Card size="small" styles={{ body: { padding: '8px 14px' } }} style={{ borderColor: NEUTRAL.border }}>
                <Statistic title="耗时" value={preview.elapsed} suffix="ms" valueStyle={{ fontSize: 18, color: PALETTE.green }} />
              </Card>
              <Card size="small" styles={{ body: { padding: '8px 14px' } }} style={{ borderColor: NEUTRAL.border }}>
                <Statistic title="数据源" value={preview.datasourceName} valueStyle={{ fontSize: 15, color: NEUTRAL.text }} />
              </Card>
            </Space>

            <Space wrap style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 12.5 }}>预览行数</Text>
              <Segmented
                value={previewLimit}
                onChange={(v) => reloadPreview(Number(v))}
                options={[
                  { label: '20 行', value: 20 },
                  { label: '50 行', value: 50 },
                  { label: '100 行', value: 100 },
                ]}
              />
              <Text type="secondary" style={{ fontSize: 12.5, marginLeft: 8 }}>
                <ColumnWidthOutlined /> 显示列
              </Text>
              <Segmented
                value={visibleCols}
                onChange={(v) => setVisibleCols(Number(v))}
                options={[
                  { label: '前 20 列', value: 20 },
                  { label: '前 50 列', value: 50 },
                  { label: '全部', value: Math.max(preview.columns.length, 1) },
                ]}
              />
              <Button size="small" icon={<ReloadOutlined />} onClick={() => reloadPreview(previewLimit)}>
                刷新
              </Button>
            </Space>

            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 10 }}
              title={`实际执行 SQL：${preview.sql}`}
            />

            {preview.rows.length === 0 ? (
              <Empty description="查询没有返回任何数据" />
            ) : (
              <Table
                size="small"
                rowKey={(_, i) => String(i)}
                dataSource={preview.rows}
                columns={previewColumns}
                scroll={{ x: 'max-content', y: 400 }}
                pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (t) => `共 ${fmtNum(t)} 行` }}
              />
            )}

            {preview.columns.length > visibleCols && (
              <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 10, marginBottom: 0 }}>
                当前仅展示前 {visibleCols} 列，共 {preview.columns.length} 列。可切换「全部」查看所有字段。
              </Paragraph>
            )}
          </>
        )}
      </Modal>
    </Page>
  );
}
