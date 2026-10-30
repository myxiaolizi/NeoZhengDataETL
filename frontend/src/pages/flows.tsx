/** 处理流程列表：流程编排入口 / 新建 / 启停 / 执行 / 日志（桌面优先，窄屏可用） */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  Button, Card, Col, Dropdown, Empty, Form, Grid, Input, Modal, Row, Select,
  Space, Statistic, Switch, Tag, Tooltip, message,
} from 'antd';
import {
  CopyOutlined, DeleteOutlined, EditOutlined, FileSearchOutlined, MoreOutlined,
  NodeIndexOutlined, PlayCircleOutlined, PlusOutlined, ReloadOutlined,
} from '@ant-design/icons';
import Page from '@/components/Page';
import { api } from '@/api/client';
import { flowsApi } from '@/api/flows';
import type { FlowListItem } from '@/api/flows';
import { copyText, fmtTime } from '@/utils';

const { useBreakpoint } = Grid;

/** 调色板（契约唯一允许的 13 色） */
const C = {
  primary: '#3687FF',
  blue: '#2D6FE4',
  deep: '#003378',
  cyan: '#45B4FF',
  green: '#A2D73C',
  orange: '#EC673C',
  red: '#E86161',
  yellow: '#FFC000',
  gray: '#B5B5B6',
  line: '#DCDDDD',
};

const RUN_MODE: Record<string, { text: string; color: string }> = {
  manual: { text: '手动执行', color: C.primary },
  trigger: { text: '触发执行', color: C.cyan },
  cron: { text: '定时执行', color: C.orange },
};

const SOURCE_TYPE: Record<string, string> = {
  project: '项目数据',
  dataset: '数据集',
  table: '数据库表',
  form: '表单数据',
};

interface FlowValues {
  name: string;
  description?: string;
  projectId?: number | null;
  sourceType: string;
  runMode: string;
  cronExpr?: string;
  status: boolean;
}

export default function FlowsPage() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [rows, setRows] = useState<FlowListItem[]>([]);
  const [stats, setStats] = useState<{ flows: number; active: number; runs: number; oks: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [runningId, setRunningId] = useState<number | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FlowListItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [projectOptions, setProjectOptions] = useState<{ label: string; value: number }[]>([]);
  const [form] = Form.useForm<FlowValues>();
  const runMode = Form.useWatch('runMode', form);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await flowsApi.list(keyword);
      setRows(res.list || []);
      setStats(res.stats || null);
    } catch {
      /* client 已提示 */
    } finally {
      setLoading(false);
    }
  }, [keyword]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get<{ id: number; name: string }[]>('/projects')
      .then((list) => setProjectOptions((list || []).map((p) => ({ label: p.name, value: p.id }))))
      .catch(() => setProjectOptions([]));
  }, []);

  /* ---------- 新建 / 编辑 ---------- */
  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ sourceType: 'project', runMode: 'manual', status: true, projectId: null });
    setModalOpen(true);
  };

  const openEdit = (record: FlowListItem) => {
    setEditing(record);
    form.resetFields();
    form.setFieldsValue({
      name: record.name,
      description: record.description,
      projectId: record.projectId ?? null,
      sourceType: record.sourceType || 'project',
      runMode: record.runMode || 'manual',
      cronExpr: record.cronExpr || '',
      status: record.status === 1,
    });
    setModalOpen(true);
  };

  const submit = async () => {
    let values: FlowValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: values.name,
        description: values.description || '',
        projectId: values.projectId || null,
        sourceType: values.sourceType,
        runMode: values.runMode,
        cronExpr: values.runMode === 'cron' ? values.cronExpr || '' : '',
        status: values.status ? 1 : 0,
      };
      if (editing) {
        await flowsApi.update(editing.id, body);
        message.success('流程已保存');
        setModalOpen(false);
        load();
      } else {
        const created = await flowsApi.create(body);
        message.success('流程创建成功，正在进入设计器');
        setModalOpen(false);
        navigate(`/flows/${created.id}/design`);
      }
    } catch {
      /* client 已提示 */
    } finally {
      setSaving(false);
    }
  };

  /* ---------- 行操作 ---------- */
  const toggleStatus = async (record: FlowListItem, checked: boolean) => {
    try {
      await flowsApi.update(record.id, { status: checked ? 1 : 0 });
      message.success(checked ? '流程已启用' : '流程已停用');
      load();
    } catch {
      /* ignore */
    }
  };

  const runFlow = async (record: FlowListItem) => {
    setRunningId(record.id);
    try {
      const res = await flowsApi.run(record.id);
      if (res.ok) {
        message.success(res.message || '执行成功');
      } else {
        Modal.warning({
          title: '流程执行未通过',
          content: res.message || '执行失败，请查看流程日志',
          okText: '查看日志',
          onOk: () => navigate(`/flows/${record.id}/logs`),
        });
      }
      load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '执行失败');
    } finally {
      setRunningId(null);
    }
  };

  const remove = async (record: FlowListItem) => {
    try {
      await flowsApi.remove(record.id);
      message.success('流程已删除');
      load();
    } catch {
      /* ignore */
    }
  };

  const copyCode = async (record: FlowListItem) => {
    const ok = await copyText(record.code || '');
    message[ok ? 'success' : 'error'](ok ? '流程编码已复制' : '复制失败');
  };

  /* ---------- 列 ---------- */
  const columns: ProColumns<FlowListItem>[] = useMemo(
    () => [
      {
        title: '流程名称',
        dataIndex: 'name',
        width: 230,
        fixed: 'left',
        render: (_, record) => (
          <div style={{ minWidth: 0 }}>
            <a
              onClick={() => navigate(`/flows/${record.id}/design`)}
              style={{ fontWeight: 600, color: C.deep }}
            >
              {record.name}
            </a>
            <div style={{ fontSize: 12, color: C.gray, marginTop: 2 }}>
              {record.code}
              {record.description ? ` · ${record.description}` : ''}
            </div>
          </div>
        ),
      },
      {
        title: '数据来源',
        dataIndex: 'sourceType',
        width: 120,
        render: (_, record) => (
          <Tag style={{ color: C.primary, background: '#FFFFFF', borderColor: C.primary }}>
            {SOURCE_TYPE[record.sourceType || 'project'] || record.sourceType}
          </Tag>
        ),
      },
      {
        title: '关联项目',
        dataIndex: 'projectName',
        width: 150,
        ellipsis: true,
        render: (_, record) => record.projectName || <span style={{ color: C.gray }}>—</span>,
      },
      {
        title: '执行方式',
        dataIndex: 'runMode',
        width: 120,
        render: (_, record) => {
          const meta = RUN_MODE[record.runMode || 'manual'] || RUN_MODE.manual;
          return (
            <div>
              <Tag style={{ color: meta.color, background: '#FFFFFF', borderColor: meta.color }}>
                {meta.text}
              </Tag>
              {record.runMode === 'cron' && record.cronExpr && (
                <div style={{ fontSize: 11.5, color: C.gray, marginTop: 2 }}>{record.cronExpr}</div>
              )}
            </div>
          );
        },
      },
      { title: '节点数', dataIndex: 'nodeCount', width: 80, align: 'right' },
      {
        title: '运行 / 成功',
        dataIndex: 'runCount',
        width: 110,
        align: 'right',
        render: (_, record) => (
          <span>
            {record.runCount ?? 0}
            <span style={{ color: C.gray }}> / </span>
            <span style={{ color: C.green }}>{record.successCount ?? 0}</span>
          </span>
        ),
      },
      {
        title: '最近执行',
        dataIndex: 'lastRunAt',
        width: 190,
        render: (_, record) =>
          record.lastRunAt ? (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5 }}>{fmtTime(record.lastRunAt, 'MM-DD HH:mm:ss')}</div>
              <div
                style={{
                  fontSize: 11.5,
                  color: record.lastRunOk ? C.green : C.red,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 175,
                }}
                title={record.lastRunMsg || ''}
              >
                {record.lastRunOk ? '成功' : '失败'}
                {record.lastRunMsg ? ` · ${record.lastRunMsg}` : ''}
              </div>
            </div>
          ) : (
            <span style={{ color: C.gray }}>未执行</span>
          ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 130,
        render: (_, record) => (
          <Space size={6}>
            <Switch
              size="small"
              checked={record.status === 1}
              checkedChildren="启用"
              unCheckedChildren="停用"
              onChange={(v) => toggleStatus(record, v)}
            />
            <span style={{ fontSize: 12, color: record.status === 1 ? C.green : C.gray }}>
              {record.status === 1 ? '已启用' : '已停用'}
            </span>
          </Space>
        ),
      },
      {
        title: '操作',
        valueType: 'option',
        width: 230,
        fixed: 'right',
        render: (_, record) => [
          <a key="design" onClick={() => navigate(`/flows/${record.id}/design`)}>
            <EditOutlined /> 设计
          </a>,
          <a key="logs" onClick={() => navigate(`/flows/${record.id}/logs`)}>
            <FileSearchOutlined /> 日志
          </a>,
          <a
            key="run"
            onClick={() => {
              if (runningId === record.id) return;
              Modal.confirm({
                title: `执行流程「${record.name}」`,
                content: '将立即按节点顺序执行一次，可能写入目标表。确定继续？',
                okText: '立即执行',
                onOk: () => runFlow(record),
              });
            }}
          >
            <PlayCircleOutlined /> 执行
          </a>,
          <Dropdown
            key="more"
            trigger={['click']}
            menu={{
              items: [
                { key: 'edit', icon: <EditOutlined />, label: '编辑信息' },
                { key: 'copy', icon: <CopyOutlined />, label: '复制编码' },
                { type: 'divider' as const },
                { key: 'delete', icon: <DeleteOutlined />, label: '删除流程', danger: true },
              ],
              onClick: ({ key, domEvent }) => {
                domEvent.stopPropagation();
                if (key === 'edit') openEdit(record);
                if (key === 'copy') copyCode(record);
                if (key === 'delete') {
                  Modal.confirm({
                    title: `删除流程「${record.name}」`,
                    content: '流程定义与运行日志都会被清除，且不可恢复。',
                    okText: '确认删除',
                    okButtonProps: { danger: true },
                    onOk: () => remove(record),
                  });
                }
              },
            }}
          >
            <a>
              <MoreOutlined /> 更多
            </a>
          </Dropdown>,
        ],
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, runningId]
  );

  /* ---------- 移动端卡片 ---------- */
  const mobileList = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.length === 0 ? (
        <Empty description="还没有流程，点击右上角新建" />
      ) : (
        rows.map((record) => {
          const meta = RUN_MODE[record.runMode || 'manual'] || RUN_MODE.manual;
          return (
            <Card key={record.id} size="small" styles={{ body: { padding: 14 } }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: C.deep, fontSize: 15 }}>{record.name}</div>
                  <div style={{ fontSize: 12, color: C.gray, marginTop: 2 }}>{record.code}</div>
                </div>
                <Tag
                  style={{
                    color: record.status === 1 ? C.green : C.gray,
                    background: '#FFFFFF',
                    borderColor: record.status === 1 ? C.green : C.line,
                    marginInlineEnd: 0,
                    flexShrink: 0,
                  }}
                >
                  {record.status === 1 ? '已启用' : '已停用'}
                </Tag>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                <Tag style={{ color: meta.color, background: '#FFFFFF', borderColor: meta.color }}>{meta.text}</Tag>
                <Tag style={{ color: C.gray, background: '#FFFFFF', borderColor: C.line }}>{record.nodeCount ?? 0} 节点</Tag>
                <Tag style={{ color: C.gray, background: '#FFFFFF', borderColor: C.line }}>
                  运行 {record.runCount ?? 0}
                </Tag>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <Button size="large" block onClick={() => navigate(`/flows/${record.id}/design`)}>
                  设计
                </Button>
                <Button size="large" block onClick={() => navigate(`/flows/${record.id}/logs`)}>
                  日志
                </Button>
                <Button
                  size="large"
                  block
                  type="primary"
                  loading={runningId === record.id}
                  onClick={() => runFlow(record)}
                >
                  执行
                </Button>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );

  const statCards = [
    { title: '流程总数', value: stats?.flows ?? 0, color: C.primary },
    { title: '已启用', value: stats?.active ?? 0, color: C.green },
    { title: '累计运行', value: stats?.runs ?? 0, color: C.cyan },
    { title: '成功次数', value: stats?.oks ?? 0, color: C.orange },
  ];

  return (
    <Page
      title="处理流程"
      subTitle="编排数据源 → 清洗加工 → 输出，形成可复用的数据流水线"
      extra={
        <Space wrap size={8}>
          <Input.Search
            allowClear
            placeholder="搜索流程名称 / 编码"
            onSearch={(v) => setKeyword(v.trim())}
            style={{ width: isMobile ? 150 : 240 }}
          />
          <Tooltip title="刷新列表">
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading} />
          </Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建流程
          </Button>
        </Space>
      }
    >
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        {statCards.map((s) => (
          <Col key={s.title} xs={12} sm={12} md={6}>
            <Card size="small" styles={{ body: { padding: isMobile ? 12 : 16 } }}>
              <Statistic
                title={<span style={{ fontSize: 12.5, color: C.gray }}>{s.title}</span>}
                value={s.value}
                styles={{ content: { color: s.color, fontSize: isMobile ? 20 : 24, fontWeight: 700 } }}
                prefix={<NodeIndexOutlined style={{ color: s.color, marginRight: 6 }} />}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {isMobile ? (
        mobileList
      ) : (
        <ProTable<FlowListItem>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          search={false}
          options={false}
          cardBordered
          headerTitle="流程列表"
          toolBarRender={false}
          scroll={{ x: 1400 }}
          pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `共 ${t} 个流程` }}
          locale={{ emptyText: <Empty description="还没有流程，点击右上角「新建流程」" /> }}
        />
      )}

      <Modal
        title={editing ? `编辑流程 · ${editing.name}` : '新建流程'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        okText={editing ? '保存' : '创建并设计'}
        cancelText="取消"
        width={isMobile ? '94%' : 600}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false} style={{ marginTop: 8 }}>
          <Form.Item name="name" label="流程名称" rules={[{ required: true, message: '请输入流程名称' }]}>
            <Input placeholder="例如：客户数据清洗同步" maxLength={60} />
          </Form.Item>
          <Form.Item name="description" label="流程说明">
            <Input.TextArea rows={2} maxLength={200} placeholder="说明该流程的用途与执行时机" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="sourceType" label="数据来源" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: 'project', label: '项目数据' },
                    { value: 'dataset', label: '数据集' },
                    { value: 'table', label: '数据库表' },
                    { value: 'form', label: '表单数据' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="projectId" label="关联项目（可选）">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={projectOptions}
                  placeholder="选择数据归属项目"
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="runMode" label="执行方式" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: 'manual', label: '手动执行' },
                    { value: 'trigger', label: '数据触发' },
                    { value: 'cron', label: '定时执行' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="cronExpr"
                label="Cron 表达式"
                rules={runMode === 'cron' ? [{ required: true, message: '定时执行需要填写 Cron 表达式' }] : undefined}
              >
                <Input placeholder="例如：0 2 * * *" disabled={runMode !== 'cron'} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="status" label="启用状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>
    </Page>
  );
}
