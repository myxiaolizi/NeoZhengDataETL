/** 处理流程列表（V6.1 页面规范）：流程编排入口 / 新建 / 启停 / 执行 / 日志
 *
 * 结构：本页名称 + 搜索区 + 新建 → 数据卡片 → 流程列表（桌面表格 / 移动端卡片）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  Alert, Button, Card, Col, Dropdown, Empty, Form, Grid, Input, Modal, Row, Select,
  Space, Switch, Tag, message,
} from 'antd';
import {
  CopyOutlined, DeleteOutlined, EditOutlined, FileSearchOutlined, MoreOutlined,
  PlayCircleOutlined, PlusOutlined, ReloadOutlined,
} from '@ant-design/icons';
import Page from '@/components/Page';
import type { StatCardItem } from '@/components/StatCards';
import { usePermission } from '@/stores/app';
import { NEUTRAL, PALETTE } from '@/theme';
import { api } from '@/api/client';
import { flowsApi } from '@/api/flows';
import type { FlowListItem } from '@/api/flows';
import { copyText, fmtNum, fmtTime } from '@/utils';

const { useBreakpoint } = Grid;

const RUN_MODE: Record<string, { text: string; color: string }> = {
  manual: { text: '手动执行', color: PALETTE.primary },
  trigger: { text: '触发执行', color: PALETTE.cyan },
  cron: { text: '定时执行', color: PALETTE.orange },
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

/** 是否今天运行过 */
function isToday(v?: string | null): boolean {
  if (!v) return false;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default function FlowsPage() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const can = usePermission();
  const canWrite = can('flow:write');

  const [rows, setRows] = useState<FlowListItem[]>([]);
  const [stats, setStats] = useState<{ flows: number; active: number; runs: number; oks: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
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
    setError('');
    try {
      const res = await flowsApi.list(keyword);
      setRows(res.list || []);
      setStats(res.stats || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '流程列表加载失败');
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

  /* ---------- 数据卡片（就地统计，不新增接口） ---------- */
  const statItems = useMemo<StatCardItem[]>(() => {
    const todayRun = rows.filter((r) => isToday(r.lastRunAt)).length;
    const failed = rows.filter((r) => r.lastRunAt && r.lastRunOk === false).length;
    return [
      { key: 'flows', label: '流程总数', value: fmtNum(stats?.flows ?? rows.length), suffix: '个', color: PALETTE.primary },
      {
        key: 'active',
        label: '已启用',
        value: fmtNum(stats?.active ?? 0),
        suffix: '个',
        color: PALETTE.green,
        hint: stats?.flows ? `占比 ${Math.round(((stats.active || 0) / stats.flows) * 100)}%` : undefined,
      },
      { key: 'today', label: '今日运行', value: fmtNum(todayRun), suffix: '个', color: PALETTE.cyan, hint: '按最近执行时间统计' },
      {
        key: 'failed',
        label: '最近失败',
        value: fmtNum(failed),
        suffix: '个',
        color: failed > 0 ? PALETTE.red : PALETTE.teal,
        hint: failed > 0 ? '需查看流程日志' : `累计成功 ${fmtNum(stats?.oks ?? 0)} 次`,
      },
      { key: 'runs', label: '累计运行', value: fmtNum(stats?.runs ?? 0), suffix: '次', color: PALETTE.violet },
    ];
  }, [stats, rows]);

  /* ---------- 列 ---------- */
  const columns: ProColumns<FlowListItem>[] = useMemo(
    () => [
      {
        title: '流程名称',
        dataIndex: 'name',
        width: 230,
        fixed: 'left',
        sorter: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
        render: (_, record) => (
          <div style={{ minWidth: 0 }}>
            <a
              onClick={() => navigate(`/flows/${record.id}/design`)}
              style={{ fontWeight: 600, color: NEUTRAL.text }}
            >
              {record.name}
            </a>
            <div style={{ fontSize: 12, color: NEUTRAL.textTertiary, marginTop: 2 }}>
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
          <Tag style={{ color: PALETTE.primary, background: NEUTRAL.surface, borderColor: PALETTE.primary, margin: 0 }}>
            {SOURCE_TYPE[record.sourceType || 'project'] || record.sourceType}
          </Tag>
        ),
      },
      {
        title: '关联项目',
        dataIndex: 'projectName',
        width: 150,
        ellipsis: true,
        render: (_, record) => record.projectName || <span style={{ color: NEUTRAL.textQuaternary }}>—</span>,
      },
      {
        title: '执行方式',
        dataIndex: 'runMode',
        width: 120,
        render: (_, record) => {
          const meta = RUN_MODE[record.runMode || 'manual'] || RUN_MODE.manual;
          return (
            <div>
              <Tag style={{ color: meta.color, background: NEUTRAL.surface, borderColor: meta.color, margin: 0 }}>
                {meta.text}
              </Tag>
              {record.runMode === 'cron' && record.cronExpr && (
                <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary, marginTop: 2 }}>{record.cronExpr}</div>
              )}
            </div>
          );
        },
      },
      { title: '节点数', dataIndex: 'nodeCount', width: 80, align: 'right', sorter: (a, b) => (a.nodeCount ?? 0) - (b.nodeCount ?? 0) },
      {
        title: '运行 / 成功',
        dataIndex: 'runCount',
        width: 110,
        align: 'right',
        sorter: (a, b) => (a.runCount ?? 0) - (b.runCount ?? 0),
        render: (_, record) => (
          <span>
            {record.runCount ?? 0}
            <span style={{ color: NEUTRAL.textQuaternary }}> / </span>
            <span style={{ color: PALETTE.green }}>{record.successCount ?? 0}</span>
          </span>
        ),
      },
      {
        title: '最近执行',
        dataIndex: 'lastRunAt',
        width: 190,
        sorter: (a, b) => String(a.lastRunAt || '').localeCompare(String(b.lastRunAt || '')),
        render: (_, record) =>
          record.lastRunAt ? (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: NEUTRAL.textSecondary }}>{fmtTime(record.lastRunAt, 'MM-DD HH:mm:ss')}</div>
              <div
                style={{
                  fontSize: 11.5,
                  color: record.lastRunOk ? PALETTE.green : PALETTE.red,
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
            <span style={{ color: NEUTRAL.textQuaternary }}>未执行</span>
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
              disabled={!canWrite}
              onChange={(v) => toggleStatus(record, v)}
            />
            <span style={{ fontSize: 12, color: record.status === 1 ? PALETTE.green : NEUTRAL.textTertiary }}>
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
          canWrite ? (
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
            </a>
          ) : null,
          <Dropdown
            key="more"
            trigger={['click']}
            menu={{
              items: [
                { key: 'edit', icon: <EditOutlined />, label: '编辑信息', disabled: !canWrite },
                { key: 'copy', icon: <CopyOutlined />, label: '复制编码' },
                { type: 'divider' as const },
                { key: 'delete', icon: <DeleteOutlined />, label: '删除流程', danger: true, disabled: !canWrite },
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
    [navigate, runningId, canWrite]
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
                  <div style={{ fontWeight: 600, color: NEUTRAL.text, fontSize: 15 }}>{record.name}</div>
                  <div style={{ fontSize: 12, color: NEUTRAL.textTertiary, marginTop: 2 }}>{record.code}</div>
                </div>
                <Tag
                  style={{
                    color: record.status === 1 ? PALETTE.green : NEUTRAL.textTertiary,
                    background: NEUTRAL.surface,
                    borderColor: record.status === 1 ? PALETTE.green : NEUTRAL.border,
                    marginInlineEnd: 0,
                    flexShrink: 0,
                  }}
                >
                  {record.status === 1 ? '已启用' : '已停用'}
                </Tag>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                <Tag style={{ color: meta.color, background: NEUTRAL.surface, borderColor: meta.color, margin: 0 }}>{meta.text}</Tag>
                <Tag style={{ color: NEUTRAL.textSecondary, background: NEUTRAL.surface, borderColor: NEUTRAL.border, margin: 0 }}>
                  {record.nodeCount ?? 0} 节点
                </Tag>
                <Tag style={{ color: NEUTRAL.textSecondary, background: NEUTRAL.surface, borderColor: NEUTRAL.border, margin: 0 }}>
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
                {canWrite && (
                  <Button
                    size="large"
                    block
                    type="primary"
                    loading={runningId === record.id}
                    onClick={() => runFlow(record)}
                  >
                    执行
                  </Button>
                )}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );

  return (
    <Page
      title="处理流程"
      search={
        <Input.Search
          allowClear
          placeholder="搜索流程名称 / 编码"
          onSearch={(v) => setKeyword(v.trim())}
          style={{ width: isMobile ? '100%' : 240 }}
        />
      }
      actions={
        canWrite ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建流程
          </Button>
        ) : null
      }
      stats={statItems}
    >
      {error ? (
        <Alert
          type="error"
          showIcon
          title="加载失败"
          description={error}
          action={<Button size="small" icon={<ReloadOutlined />} onClick={load}>重试</Button>}
          style={{ marginBottom: 12 }}
        />
      ) : null}

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
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 个流程` }}
          locale={{ emptyText: <Empty description="还没有流程，点击右上角「新建流程」" /> }}
        />
      )}

      {/* 新建 / 编辑：内容少 → Modal */}
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
