/** 数据集成（V6.1 页面规范）：API 采集(pull) / API 推送(push) 任务管理 + 手动执行 + 运行统计
 *
 * 结构：本页名称 + 搜索区 + 新建 → 数据卡片 → 任务列表
 * V6.1：新建/编辑用 ModalForm；执行结果用 Modal。
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Button, Space, Tag, Typography, App, Tooltip, Alert, Divider, Descriptions,
  Badge, Result, Modal, Input, Select,
} from 'antd';
import {
  PlusOutlined, PlayCircleOutlined, DeleteOutlined, EditOutlined,
  ImportOutlined, ExportOutlined, ExclamationCircleOutlined,
  CheckCircleFilled, CloseCircleFilled, EyeOutlined,
} from '@ant-design/icons';
import {
  ProTable, ModalForm, ProFormText, ProFormSelect, ProFormSwitch, ProFormTextArea,
  ProFormRadio,
} from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useNavigate } from 'react-router-dom';
import Page from '@/components/Page';
import type { StatCardItem } from '@/components/StatCards';
import { usePermission } from '@/stores/app';
import { NEUTRAL, PALETTE } from '@/theme';
import { fmtTime, fmtNum, truncate } from '@/utils';
import {
  listIntegrations, createIntegration, updateIntegration, deleteIntegration, runIntegration,
} from '@/api/integrations';
import type {
  Integration, IntegrationPayload, IntegrationStats, IntegrationRunLog,
} from '@/api/integrations';
import { listProjectOptions } from '@/api/datasets';
import type { ProjectOption } from '@/api/datasets';

const { Text, Paragraph } = Typography;

const AUTH_TYPES = [
  { label: '无鉴权', value: 'none' },
  { label: 'Bearer Token', value: 'bearer' },
  { label: 'Basic 认证', value: 'basic' },
  { label: 'API Key', value: 'apikey' },
];

const TRIGGER_TYPES = [
  { label: '手动触发', value: 'manual' },
  { label: '定时调度', value: 'schedule' },
  { label: 'Webhook 触发', value: 'webhook' },
];

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ label: m, value: m }));

type IntegrationFormValues = {
  name?: string;
  direction?: 'pull' | 'push';
  projectId?: number | null;
  protocol?: 'http' | 'https';
  method?: string;
  url?: string;
  headersText?: string;
  paramsText?: string;
  body?: string;
  authType?: string;
  authToken?: string;
  authUsername?: string;
  authPassword?: string;
  authKeyHeader?: string;
  authKeyValue?: string;
  dataPath?: string;
  fieldMapText?: string;
  schedule?: string;
  triggerType?: string;
  status?: number | boolean;
};

/** 安全 JSON 解析 */
function parseJsonObject(s: string | undefined, label: string): Record<string, string> {
  if (!s || !s.trim()) return {};
  const v = JSON.parse(s);
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`${label} 必须是 JSON 对象，如 {"key":"value"}`);
  }
  return v as Record<string, string>;
}

export default function IntegrationsPage() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const can = usePermission();
  const canWrite = can('integration:write');

  const actionRef = useRef<ActionType>(null);
  const [stats, setStats] = useState<IntegrationStats | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [direction, setDirection] = useState<string | undefined>(undefined);

  /* 新建 / 编辑 */
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Integration | null>(null);
  const [curDirection, setCurDirection] = useState<'pull' | 'push'>('pull');
  const formRef = useRef<any>(null);

  /* 运行结果 */
  const [runResult, setRunResult] = useState<{ row: Integration; log: IntegrationRunLog } | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);

  /** 项目下拉（集成任务必须关联项目） */
  const loadProjects = useCallback(async () => {
    try {
      const p = await listProjectOptions();
      setProjects(p);
    } catch { /* client 已提示 */ }
  }, []);

  React.useEffect(() => { loadProjects(); }, [loadProjects]);

  const projectOptions = useMemo(
    () => projects.map((p) => ({ label: p.name, value: p.id })),
    [projects]
  );

  const openCreate = () => {
    setEditing(null);
    setCurDirection('pull');
    setFormOpen(true);
  };

  const openEdit = (row: Integration) => {
    setEditing(row);
    setCurDirection(row.direction);
    setFormOpen(true);
  };

  /** 编辑态初始值：对象字段序列化为 JSON 文本 */
  const initialValues = useMemo<IntegrationFormValues>(() => {
    if (!editing) {
      return {
        direction: 'pull',
        protocol: 'https',
        method: 'GET',
        authType: 'none',
        triggerType: 'manual',
        status: 1,
        projectId: null,
      };
    }
    const ac = editing.authConfig || {};
    return {
      name: editing.name,
      direction: editing.direction,
      projectId: editing.projectId ?? null,
      protocol: editing.protocol,
      method: editing.method,
      url: editing.url,
      headersText: Object.keys(editing.headers || {}).length
        ? JSON.stringify(editing.headers, null, 2) : '',
      paramsText: Object.keys(editing.params || {}).length
        ? JSON.stringify(editing.params, null, 2) : '',
      body: editing.body,
      authType: editing.authType || 'none',
      authToken: ac.token,
      authUsername: ac.username,
      authPassword: ac.password,
      authKeyHeader: ac.header,
      authKeyValue: ac.value || ac.key,
      dataPath: editing.dataPath,
      fieldMapText: Object.keys(editing.fieldMap || {}).length
        ? JSON.stringify(editing.fieldMap, null, 2) : '',
      schedule: editing.schedule,
      triggerType: editing.triggerType,
      status: editing.status,
    };
  }, [editing]);

  const handleSubmit = async (values: IntegrationFormValues): Promise<boolean> => {
    let headers: Record<string, string>;
    let params: Record<string, string>;
    let fieldMap: Record<string, string>;
    try {
      headers = parseJsonObject(values.headersText, '请求头');
      params = parseJsonObject(values.paramsText, '查询参数');
      fieldMap = parseJsonObject(values.fieldMapText, '字段映射');
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'JSON 格式不正确');
      return false;
    }

    const authType = values.authType || 'none';
    const authConfig: Record<string, string> = {};
    if (authType === 'bearer' && values.authToken) authConfig.token = values.authToken;
    if (authType === 'basic') {
      if (values.authUsername) authConfig.username = values.authUsername;
      if (values.authPassword) authConfig.password = values.authPassword;
    }
    if (authType === 'apikey') {
      authConfig.header = values.authKeyHeader || 'X-API-Key';
      if (values.authKeyValue) authConfig.value = values.authKeyValue;
    }

    const payload: IntegrationPayload = {
      name: values.name || '',
      direction: values.direction || 'pull',
      projectId: values.projectId ?? null,
      protocol: values.protocol || 'https',
      method: values.method || 'GET',
      url: values.url,
      headers,
      params,
      body: values.body || '',
      authType,
      authConfig,
      dataPath: values.dataPath || '',
      fieldMap,
      schedule: values.schedule || '',
      triggerType: values.triggerType || 'manual',
      status: values.status === 0 || values.status === false ? 0 : 1,
    };

    try {
      if (editing) {
        await updateIntegration(editing.id, payload);
        message.success('集成任务已保存');
      } else {
        await createIntegration(payload);
        message.success('集成任务已创建');
      }
      actionRef.current?.reload();
      setFormOpen(false);
      return true;
    } catch {
      return false;
    }
  };

  const handleRun = async (row: Integration) => {
    setRunningId(row.id);
    try {
      const r = await runIntegration(row.id, { limit: 100 });
      const log = r.data;
      if (r.ok && log?.success) {
        message.success(`「${row.name}」执行成功：${log.message}`);
      } else {
        message.error(`「${row.name}」执行失败：${log?.message || r.message || '未知错误'}`);
      }
      if (log) setRunResult({ row, log });
      actionRef.current?.reload();
    } finally {
      setRunningId(null);
    }
  };

  const handleDelete = (row: Integration) => {
    modal.confirm({
      title: `删除集成任务「${row.name}」`,
      icon: <ExclamationCircleOutlined style={{ color: PALETTE.red }} />,
      content: '任务与全部运行日志将一并删除，不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteIntegration(row.id);
          message.success('集成任务已删除');
          actionRef.current?.reload();
        } catch { /* client 已提示 */ }
      },
    });
  };

  /* ---------- 数据卡片（就地统计，不新增接口） ---------- */
  const statItems = useMemo<StatCardItem[]>(() => {
    const failed = stats ? Math.max(0, (stats.runTotal || 0) - (stats.runOk || 0)) : 0;
    return [
      { key: 'total', label: '集成任务', value: fmtNum(stats?.total ?? 0), suffix: '个', color: PALETTE.primary, hint: `采集 ${fmtNum(stats?.pullCount ?? 0)} · 推送 ${fmtNum(stats?.pushCount ?? 0)}` },
      { key: 'active', label: '启用中', value: fmtNum(stats?.active ?? 0), suffix: '个', color: PALETTE.green },
      { key: 'run', label: '累计执行', value: fmtNum(stats?.runTotal ?? 0), suffix: '次', color: PALETTE.cyan, hint: `成功 ${fmtNum(stats?.runOk ?? 0)} 次` },
      { key: 'failed', label: '累计失败', value: fmtNum(failed), suffix: '次', color: failed > 0 ? PALETTE.red : PALETTE.teal },
      { key: 'rows', label: '累计处理行', value: fmtNum(stats?.rowsTotal ?? 0), suffix: '行', color: PALETTE.violet },
    ];
  }, [stats]);

  const columns: ProColumns<Integration>[] = [
    {
      title: '任务名称',
      dataIndex: 'name',
      width: 240,
      sorter: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
      render: (_, row) => (
        <Space size={6} orientation="vertical">
          <Space size={6} wrap>
            {row.direction === 'push'
              ? <ExportOutlined style={{ color: PALETTE.orange }} />
              : <ImportOutlined style={{ color: PALETTE.primary }} />}
            <Text strong style={{ color: NEUTRAL.text }}>{row.name}</Text>
            <Tag color={row.direction === 'push' ? PALETTE.orange : PALETTE.primary} style={{ marginInlineEnd: 0 }}>
              {row.direction === 'push' ? '推送' : '采集'}
            </Tag>
          </Space>
          <Text style={{ fontSize: 12, color: NEUTRAL.textTertiary }}>{row.code}</Text>
        </Space>
      ),
    },
    {
      title: '目标接口',
      dataIndex: 'url',
      width: 300,
      ellipsis: true,
      render: (_, row) => (
        <Space size={4} orientation="vertical" style={{ fontSize: 12.5 }}>
          <Space size={4}>
            <Tag color={PALETTE.cyan} style={{ marginInlineEnd: 0 }}>{row.method}</Tag>
            <Tag color={PALETTE.gray} style={{ marginInlineEnd: 0 }}>{row.protocol}</Tag>
          </Space>
          <Tooltip title={row.url}>
            <Text code style={{ fontSize: 12 }}>{truncate(row.url || '-', 44)}</Text>
          </Tooltip>
        </Space>
      ),
    },
    {
      title: '关联项目',
      dataIndex: 'projectName',
      width: 180,
      render: (_, row) =>
        row.projectName
          ? <Text>{row.projectName}</Text>
          : <Text type="secondary">{row.projectId ? `#${row.projectId}` : '未关联'}</Text>,
    },
    {
      title: '触发方式',
      dataIndex: 'triggerType',
      width: 130,
      render: (_, row) => (
        <Space size={2} orientation="vertical" style={{ fontSize: 12.5 }}>
          <Tag color={PALETTE.cyan} style={{ marginInlineEnd: 0 }}>
            {TRIGGER_TYPES.find((t) => t.value === row.triggerType)?.label || row.triggerType}
          </Tag>
          {row.triggerType === 'schedule' && row.schedule && (
            <Text type="secondary" style={{ fontSize: 11.5 }}>{row.schedule}</Text>
          )}
        </Space>
      ),
    },
    {
      title: '最近执行',
      dataIndex: 'lastRunOk',
      width: 200,
      sorter: (a, b) => String(a.lastRunAt || '').localeCompare(String(b.lastRunAt || '')),
      render: (_, row) => {
        if (row.lastRunAt === null || row.lastRunAt === undefined) {
          return <Tag color={PALETTE.gray} style={{ margin: 0 }}>未执行</Tag>;
        }
        return (
          <Space size={2} orientation="vertical" style={{ fontSize: 12 }}>
            <Space size={4}>
              {row.lastRunOk ? (
                <Tag icon={<CheckCircleFilled />} color={PALETTE.green} style={{ marginInlineEnd: 0 }}>成功</Tag>
              ) : (
                <Tag icon={<CloseCircleFilled />} color={PALETTE.red} style={{ marginInlineEnd: 0 }}>失败</Tag>
              )}
              <Text type="secondary" style={{ fontSize: 11.5 }}>{fmtTime(row.lastRunAt)}</Text>
            </Space>
            {row.lastRunMsg && (
              <Tooltip title={row.lastRunMsg}>
                <Text type="secondary" style={{ fontSize: 11.5 }}>{truncate(row.lastRunMsg, 26)}</Text>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: '执行统计',
      dataIndex: 'runCount',
      width: 140,
      sorter: (a, b) => (a.runCount ?? 0) - (b.runCount ?? 0),
      render: (_, row) => (
        <Space size={2} orientation="vertical" style={{ fontSize: 12 }}>
          <Text>执行 {fmtNum(row.runCount)} 次</Text>
          <Text type="secondary" style={{ fontSize: 11.5 }}>成功 {fmtNum(row.successCount)} 次</Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (_, row) =>
        row.status ? <Badge status="processing" text="启用" /> : <Badge status="default" text="停用" />,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 250,
      fixed: 'right',
      render: (_, row) => (
        <Space size={11} wrap>
          {canWrite && (
            <a
              onClick={() => handleRun(row)}
              style={{ opacity: runningId === row.id ? 0.5 : 1, pointerEvents: runningId === row.id ? 'none' : 'auto' }}
            >
              <PlayCircleOutlined /> 执行
            </a>
          )}
          <a onClick={() => navigate(`/integrations/${row.id}`)}>
            <EyeOutlined /> 详情
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

  return (
    <Page
      title="数据集成"
      search={
        <>
          <Input.Search
            allowClear
            placeholder="名称 / 编码 / 接口地址"
            style={{ width: 220 }}
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onSearch={(v) => { setKeyword(v.trim()); actionRef.current?.reload(); }}
          />
          <Select
            allowClear
            placeholder="全部方向"
            style={{ width: 130 }}
            value={direction}
            onChange={(v) => { setDirection(v); actionRef.current?.reload(); }}
            options={[
              { label: '采集（pull）', value: 'pull' },
              { label: '推送（push）', value: 'push' },
            ]}
          />
        </>
      }
      actions={
        canWrite ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建集成任务
          </Button>
        ) : null
      }
      stats={statItems}
    >
      <ProTable<Integration, Record<string, unknown>>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        scroll={{ x: 1400 }}
        search={false}
        options={{ density: false, fullScreen: true, setting: true, reload: false }}
        pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
        headerTitle="集成任务列表"
        params={{ keyword, direction }}
        request={async () => {
          const r = await listIntegrations({ direction, keyword });
          if (r.stats) setStats(r.stats);
          const list = r.list || [];
          return { data: list, total: list.length, success: true };
        }}
      />

      {/* ---------- 新建 / 编辑：ModalForm（V6.1 禁止 Drawer） ---------- */}
      <ModalForm<IntegrationFormValues>
        title={editing ? `编辑集成任务 · ${editing.name}` : '新建集成任务'}
        open={formOpen}
        onOpenChange={setFormOpen}
        formRef={formRef}
        width={760}
        initialValues={initialValues}
        onFinish={handleSubmit}
        onValuesChange={(changed: Partial<IntegrationFormValues>) => {
          if (changed.direction !== undefined) setCurDirection(changed.direction);
        }}
        submitter={{ searchConfig: { submitText: editing ? '保存' : '创建', resetText: '取消' } }}
        modalProps={{
          destroyOnHidden: true,
          styles: { body: { maxHeight: '64vh', overflowY: 'auto', paddingRight: 6 } },
        }}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={curDirection === 'push'
            ? '推送方向：读取项目数据 → 调用目标接口发送'
            : '采集方向：调用第三方接口 → 解析响应 → 写入项目数据表'}
        />

        <ProFormText
          name="name"
          label="任务名称"
          placeholder="如：每日订单采集 / 客户数据推送"
          rules={[{ required: true, message: '请输入任务名称' }]}
        />

        <ProFormRadio.Group
          name="direction"
          label="集成方向"
          radioType="button"
          options={[
            { label: '采集（pull）', value: 'pull' },
            { label: '推送（push）', value: 'push' },
          ]}
          rules={[{ required: true }]}
          fieldProps={{ onChange: (e: any) => setCurDirection(e.target.value) }}
        />

        <ProFormSelect
          name="projectId"
          label="关联项目"
          placeholder="请选择项目"
          options={projectOptions}
          rules={[{ required: true, message: '请选择关联项目' }]}
          fieldProps={{ showSearch: true, optionFilterProp: 'label' }}
          tooltip={curDirection === 'push' ? '从这个项目读取数据' : '采集到的数据写入这个项目'}
        />

        <Divider style={{ margin: '4px 0 16px' }}>接口配置</Divider>

        <Space.Compact style={{ width: '100%', display: 'flex', gap: 8 }}>
          <div style={{ width: 130, flexShrink: 0 }}>
            <ProFormSelect name="protocol" label="协议" options={[
              { label: 'https', value: 'https' },
              { label: 'http', value: 'http' },
            ]} />
          </div>
          <div style={{ width: 130, flexShrink: 0 }}>
            <ProFormSelect name="method" label="方法" options={METHODS} />
          </div>
        </Space.Compact>

        <ProFormText
          name="url"
          label="接口地址"
          placeholder="https://api.example.com/v1/orders"
          rules={[{ required: true, message: '请输入接口地址' }]}
        />

        <ProFormTextArea
          name="headersText"
          label="请求头（JSON）"
          placeholder={'{\n  "X-Request-Id": "abc"\n}'}
          fieldProps={{ autoSize: { minRows: 2, maxRows: 6 }, style: { fontFamily: 'monospace', fontSize: 12.5 } }}
        />
        <ProFormTextArea
          name="paramsText"
          label="查询参数（JSON）"
          placeholder={'{\n  "page": "1",\n  "size": "100"\n}'}
          fieldProps={{ autoSize: { minRows: 2, maxRows: 6 }, style: { fontFamily: 'monospace', fontSize: 12.5 } }}
        />
        <ProFormTextArea
          name="body"
          label="请求体模板"
          placeholder={'采集方向可为空；推送方向支持 {{rows}} 占位符，如 {"data": {{rows}}}'}
          fieldProps={{ autoSize: { minRows: 2, maxRows: 6 }, style: { fontFamily: 'monospace', fontSize: 12.5 } }}
        />

        <Divider style={{ margin: '4px 0 16px' }}>鉴权</Divider>

        <ProFormSelect
          name="authType"
          label="鉴权方式"
          options={AUTH_TYPES}
        />

        <ProFormText.Password
          name="authToken"
          label="Bearer Token"
          placeholder="Authorization: Bearer <token>"
          dependencies={['authType']}
        />
        <ProFormText
          name="authUsername"
          label="Basic 用户名"
          placeholder="username"
        />
        <ProFormText.Password
          name="authPassword"
          label="Basic 密码"
          placeholder="password"
        />
        <ProFormText
          name="authKeyHeader"
          label="API Key 请求头名"
          placeholder="X-API-Key"
        />
        <ProFormText.Password
          name="authKeyValue"
          label="API Key 值"
          placeholder="填写 API Key"
        />

        <Divider style={{ margin: '4px 0 16px' }}>数据处理</Divider>

        <ProFormText
          name="dataPath"
          label="数据路径"
          placeholder="data.list（采集方向：从响应中提取数组的 JSON 路径）"
          tooltip="支持 a.b.c 与 a[0].b 写法；留空表示根节点"
        />
        <ProFormTextArea
          name="fieldMapText"
          label="字段映射（JSON）"
          placeholder={'{\n  "目标字段": "源字段路径"\n}'}
          tooltip="采集：源字段 → 项目字段；推送：接口字段 → 项目列名。留空表示同名映射"
          fieldProps={{ autoSize: { minRows: 2, maxRows: 8 }, style: { fontFamily: 'monospace', fontSize: 12.5 } }}
        />

        <Divider style={{ margin: '4px 0 16px' }}>调度</Divider>

        <ProFormSelect
          name="triggerType"
          label="触发方式"
          options={TRIGGER_TYPES}
        />
        <ProFormText
          name="schedule"
          label="调度表达式"
          placeholder="0 */5 * * *（Cron 表达式，定时触发时填写）"
        />
        <ProFormSwitch name="status" label="启用该任务" />
      </ModalForm>

      {/* ---------- 单次执行结果：Modal（V6.1 禁止 Drawer） ---------- */}
      <Modal
        title={`执行结果 · ${runResult?.row.name || ''}`}
        open={!!runResult}
        onCancel={() => setRunResult(null)}
        footer={<Button onClick={() => setRunResult(null)}>关闭</Button>}
        width={720}
        destroyOnHidden
        styles={{ body: { maxHeight: '68vh', overflowY: 'auto', paddingRight: 4 } }}
      >
        {runResult && (
          <>
            {runResult.log.success ? (
              <Result
                status="success"
                title="执行成功"
                subTitle={`${runResult.log.message}（耗时 ${runResult.log.durationMs}ms）`}
                style={{ padding: '12px 0 20px' }}
              />
            ) : (
              <Result
                status="error"
                title="执行失败"
                subTitle={runResult.log.message}
                style={{ padding: '12px 0 20px' }}
              />
            )}
            <Descriptions
              bordered
              size="small"
              column={1}
              items={[
                { key: 'dir', label: '方向', children: runResult.log.direction === 'push' ? '推送' : '采集' },
                { key: 'rows', label: '处理行数', children: fmtNum(runResult.log.rowsAffected) },
                { key: 'http', label: 'HTTP 状态', children: runResult.log.httpStatus ?? '-' },
                { key: 'dur', label: '耗时', children: `${runResult.log.durationMs} ms` },
              ]}
            />
            {runResult.log.requestSnapshot && (
              <>
                <Divider titlePlacement="start" style={{ margin: '16px 0 10px' }}>
                  <Text style={{ fontSize: 13 }}>请求快照</Text>
                </Divider>
                <Paragraph
                  style={{
                    background: NEUTRAL.surfaceSunken, borderRadius: 8, padding: 12,
                    fontSize: 12, maxHeight: 220, overflow: 'auto', marginBottom: 0,
                  }}
                >
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {runResult.log.requestSnapshot}
                  </pre>
                </Paragraph>
              </>
            )}
            {runResult.log.responseSnapshot && (
              <>
                <Divider titlePlacement="start" style={{ margin: '16px 0 10px' }}>
                  <Text style={{ fontSize: 13 }}>响应快照</Text>
                </Divider>
                <Paragraph
                  style={{
                    background: NEUTRAL.surfaceAlt, borderRadius: 8, padding: 12,
                    fontSize: 12, maxHeight: 260, overflow: 'auto', marginBottom: 0,
                  }}
                >
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {runResult.log.responseSnapshot}
                  </pre>
                </Paragraph>
              </>
            )}
          </>
        )}
      </Modal>
    </Page>
  );
}
