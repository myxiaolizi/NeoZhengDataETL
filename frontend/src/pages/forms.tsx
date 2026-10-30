/** 表单中心：列表 / 新建 / 编辑 / 发布 / 复制公开链接（含移动端适配） */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  Button, Card, Col, Dropdown, Empty, Form, Grid, Input, Modal, Popconfirm,
  Row, Select, Space, Statistic, Switch, Tag, message,
} from 'antd';
import {
  CopyOutlined, DeleteOutlined, EditOutlined, FormOutlined, LinkOutlined,
  MoreOutlined, PlusOutlined, ReloadOutlined, TableOutlined,
} from '@ant-design/icons';
import Page from '@/components/Page';
import { api } from '@/api/client';
import { formsApi, publicFormUrl } from '@/api/forms';
import type { FormItem } from '@/api/forms';
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
  gray: '#B5B5B6',
  line: '#DCDDDD',
};

const FORM_TYPE_NAME: Record<string, string> = {
  fill: '填写表单',
  flow: '流程表单',
  exam: '考试表单',
};
const FORM_TYPE_COLOR: Record<string, string> = {
  fill: C.primary,
  flow: C.orange,
  exam: C.green,
};

interface FormValues {
  name: string;
  description?: string;
  formType: string;
  projectId?: number;
  allowPublic?: boolean;
  shareDesc?: string;
}

interface Stats {
  forms: number;
  active: number;
  records: number;
  today: number;
}

export default function FormsPage() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [rows, setRows] = useState<FormItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FormItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [projectOptions, setProjectOptions] = useState<{ label: string; value: number }[]>([]);
  const [form] = Form.useForm<FormValues>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await formsApi.list(keyword);
      setRows(res.list || []);
      setStats(res.stats || null);
    } catch {
      /* 错误已由 client 统一提示 */
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
    form.setFieldsValue({ formType: 'fill', allowPublic: true, projectId: undefined });
    setModalOpen(true);
  };

  const openEdit = (record: FormItem) => {
    setEditing(record);
    form.resetFields();
    form.setFieldsValue({
      name: record.name,
      description: record.description,
      formType: record.formType || 'fill',
      projectId: record.projectId ?? undefined,
      allowPublic: !!record.allowPublic,
      shareDesc: record.shareDesc || '',
    });
    setModalOpen(true);
  };

  const submit = async () => {
    let values: FormValues;
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
        formType: values.formType,
        projectId: values.projectId ?? undefined,
        allowPublic: !!values.allowPublic,
        settings: { shareDesc: values.shareDesc || '' },
      };
      if (editing) {
        await formsApi.update(editing.id, body);
        message.success('表单已保存');
        setModalOpen(false);
        load();
      } else {
        const created = await formsApi.create(body);
        message.success('表单创建成功，正在进入设计器');
        setModalOpen(false);
        navigate(`/forms/${created.id}/design`);
      }
    } catch {
      /* client 已提示 */
    } finally {
      setSaving(false);
    }
  };

  /* ---------- 行操作 ---------- */
  const togglePublish = async (record: FormItem, checked: boolean) => {
    try {
      await formsApi.update(record.id, { status: checked ? 1 : 0 });
      message.success(checked ? '表单已发布' : '表单已停用');
      load();
    } catch {
      /* ignore */
    }
  };

  const copyLink = async (record: FormItem) => {
    if (!record.publicToken) {
      message.warning('该表单缺少公开令牌，请使用「重置公开链接」生成');
      return;
    }
    if (!record.allowPublic || !record.status) {
      Modal.confirm({
        title: '需要先开启公开填写',
        content: '该表单尚未开放公开填写（或已停用），复制链接前需要先开启。是否立即开启并复制？',
        okText: '开启并复制',
        cancelText: '取消',
        onOk: async () => {
          await formsApi.update(record.id, { allowPublic: true, status: 1 });
          const ok = await copyText(publicFormUrl(record.publicToken));
          message[ok ? 'success' : 'error'](ok ? '公开填写链接已复制' : '复制失败，请手动复制');
          load();
        },
      });
      return;
    }
    const ok = await copyText(publicFormUrl(record.publicToken));
    message[ok ? 'success' : 'error'](ok ? '公开填写链接已复制' : '复制失败，请手动复制');
  };

  const regenerate = (record: FormItem) => {
    Modal.confirm({
      title: '重置公开链接',
      content: '重置后旧链接立即失效，已分享出去的填写地址将无法访问。确定继续？',
      okText: '重置并复制',
      okButtonProps: { danger: true },
      onOk: async () => {
        const updated = await formsApi.regenerateToken(record.id);
        const ok = await copyText(publicFormUrl(updated.publicToken));
        message[ok ? 'success' : 'warning'](ok ? '新链接已复制' : '已重置，请手动复制链接');
        load();
      },
    });
  };

  const remove = async (record: FormItem) => {
    try {
      await formsApi.remove(record.id);
      message.success('表单已删除');
      load();
    } catch {
      /* ignore */
    }
  };

  /* ---------- 表格列 ---------- */
  const columns: ProColumns<FormItem>[] = useMemo(
    () => [
      {
        title: '表单名称',
        dataIndex: 'name',
        width: 240,
        fixed: 'left',
        render: (_, record) => (
          <div style={{ minWidth: 0 }}>
            <a
              onClick={() => navigate(`/forms/${record.id}/design`)}
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
        title: '表单类型',
        dataIndex: 'formType',
        width: 110,
        render: (_, record) => {
          const t = record.formType || 'fill';
          return (
            <Tag
              style={{
                color: FORM_TYPE_COLOR[t] || C.primary,
                background: '#FFFFFF',
                borderColor: FORM_TYPE_COLOR[t] || C.primary,
              }}
            >
              {FORM_TYPE_NAME[t] || record.formTypeName || t}
            </Tag>
          );
        },
      },
      {
        title: '关联项目',
        dataIndex: 'projectName',
        width: 160,
        ellipsis: true,
        render: (_, record) => record.projectName || <span style={{ color: C.gray }}>—</span>,
      },
      { title: '字段数', dataIndex: 'fieldCount', width: 80, align: 'right' },
      { title: '提交数', dataIndex: 'submitCount', width: 90, align: 'right' },
      {
        title: '公开填写',
        dataIndex: 'allowPublic',
        width: 100,
        render: (_, record) =>
          record.allowPublic ? (
            <Tag style={{ color: C.green, background: '#FFFFFF', borderColor: C.green }}>已开启</Tag>
          ) : (
            <Tag style={{ color: C.gray, background: '#FFFFFF', borderColor: C.line }}>未开启</Tag>
          ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 140,
        render: (_, record) => (
          <Space size={6}>
            <Switch
              size="small"
              checked={record.status === 1}
              checkedChildren="发布"
              unCheckedChildren="停用"
              onChange={(checked) => togglePublish(record, checked)}
            />
            <span style={{ fontSize: 12, color: record.status === 1 ? C.green : C.gray }}>
              {record.status === 1 ? '已发布' : '已停用'}
            </span>
          </Space>
        ),
      },
      {
        title: '更新时间',
        dataIndex: 'updatedAt',
        width: 165,
        render: (_, record) => (
          <span style={{ fontSize: 12.5, color: C.gray }}>
            {fmtTime(record.updatedAt || record.createdAt)}
          </span>
        ),
      },
      {
        title: '操作',
        valueType: 'option',
        width: 220,
        fixed: 'right',
        render: (_, record) => [
          <a key="design" onClick={() => navigate(`/forms/${record.id}/design`)}>
            <EditOutlined /> 设计
          </a>,
          <a key="data" onClick={() => navigate(`/forms/${record.id}/data`)}>
            <TableOutlined /> 数据
          </a>,
          <a key="copy" onClick={() => copyLink(record)}>
            <LinkOutlined /> 链接
          </a>,
          <Dropdown
            key="more"
            trigger={['click']}
            menu={{
              items: [
                { key: 'edit', icon: <EditOutlined />, label: '编辑信息' },
                { key: 'regen', icon: <CopyOutlined />, label: '重置公开链接' },
                { type: 'divider' as const },
                { key: 'delete', icon: <DeleteOutlined />, label: '删除表单', danger: true },
              ],
              onClick: ({ key, domEvent }) => {
                domEvent.stopPropagation();
                if (key === 'edit') openEdit(record);
                if (key === 'regen') regenerate(record);
                if (key === 'delete') {
                  Modal.confirm({
                    title: `删除表单「${record.name}」`,
                    content: '删除后表单定义与其全部提交记录都会被清除，且不可恢复。',
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
    [navigate]
  );

  const statCards = [
    { title: '表单总数', value: stats?.forms ?? 0, color: C.primary, icon: <FormOutlined /> },
    { title: '已发布', value: stats?.active ?? 0, color: C.green, icon: <LinkOutlined /> },
    { title: '提交记录', value: stats?.records ?? 0, color: C.cyan, icon: <TableOutlined /> },
    { title: '今日提交', value: stats?.today ?? 0, color: C.orange, icon: <ReloadOutlined /> },
  ];

  /* ---------- 移动端卡片列表 ---------- */
  const mobileList = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.length === 0 ? (
        <Empty description="还没有表单，点击右上角新建" />
      ) : (
        rows.map((record) => (
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
                  flexShrink: 0,
                  marginInlineEnd: 0,
                }}
              >
                {record.status === 1 ? '已发布' : '已停用'}
              </Tag>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              <Tag
                style={{
                  color: FORM_TYPE_COLOR[record.formType || 'fill'] || C.primary,
                  background: '#FFFFFF',
                  borderColor: C.line,
                }}
              >
                {FORM_TYPE_NAME[record.formType || 'fill'] || record.formTypeName}
              </Tag>
              <Tag style={{ color: C.gray, background: '#FFFFFF', borderColor: C.line }}>
                {record.fieldCount ?? 0} 字段
              </Tag>
              <Tag style={{ color: C.gray, background: '#FFFFFF', borderColor: C.line }}>
                {record.submitCount ?? 0} 提交
              </Tag>
              <Tag
                style={{
                  color: record.allowPublic ? C.green : C.gray,
                  background: '#FFFFFF',
                  borderColor: record.allowPublic ? C.green : C.line,
                }}
              >
                {record.allowPublic ? '公开填写' : '仅内部'}
              </Tag>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button size="large" block onClick={() => navigate(`/forms/${record.id}/design`)}>
                设计
              </Button>
              <Button size="large" block onClick={() => navigate(`/forms/${record.id}/data`)}>
                数据
              </Button>
              <Button size="large" block type="primary" onClick={() => copyLink(record)}>
                链接
              </Button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Button size="large" block onClick={() => openEdit(record)}>
                编辑
              </Button>
              <Popconfirm
                title="删除表单"
                description="提交记录会一并删除"
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => remove(record)}
              >
                <Button size="large" block danger>
                  删除
                </Button>
              </Popconfirm>
            </div>
          </Card>
        ))
      )}
    </div>
  );

  return (
    <Page
      title="表单中心"
      subTitle="拖拽设计表单、收集数据、公开填写与分享"
      extra={
        <Space wrap size={8}>
          <Input.Search
            allowClear
            placeholder="搜索表单名称 / 编码"
            onSearch={(v) => setKeyword(v.trim())}
            style={{ width: isMobile ? 160 : 240 }}
          />
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建表单
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
                prefix={<span style={{ color: s.color, marginRight: 6 }}>{s.icon}</span>}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {isMobile ? (
        mobileList
      ) : (
        <ProTable<FormItem>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          search={false}
          options={false}
          cardBordered
          headerTitle="表单列表"
          toolBarRender={false}
          scroll={{ x: 1280 }}
          pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `共 ${t} 个表单` }}
          locale={{ emptyText: <Empty description="还没有表单，点击右上角「新建表单」" /> }}
        />
      )}

      <Modal
        title={editing ? `编辑表单 · ${editing.name}` : '新建表单'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        okText={editing ? '保存' : '创建并设计'}
        cancelText="取消"
        width={isMobile ? '94%' : 560}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false} style={{ marginTop: 8 }}>
          <Form.Item name="name" label="表单名称" rules={[{ required: true, message: '请输入表单名称' }]}>
            <Input placeholder="例如：客户满意度调查" maxLength={60} />
          </Form.Item>
          <Form.Item name="description" label="表单说明">
            <Input.TextArea rows={2} maxLength={200} placeholder="填写说明会展示在表单顶部" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="formType" label="表单类型" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: 'fill', label: '填写表单' },
                    { value: 'flow', label: '流程表单' },
                    { value: 'exam', label: '考试表单' },
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
                  placeholder="提交数据同步写入项目表"
                  options={projectOptions}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="allowPublic"
            label="公开填写"
            valuePropName="checked"
            extra="开启后可通过公开链接（无需登录）提交数据"
          >
            <Switch />
          </Form.Item>
          <Form.Item name="shareDesc" label="分享描述">
            <Input.TextArea rows={2} maxLength={200} placeholder="分享链接时展示的说明" />
          </Form.Item>
        </Form>
      </Modal>
    </Page>
  );
}
