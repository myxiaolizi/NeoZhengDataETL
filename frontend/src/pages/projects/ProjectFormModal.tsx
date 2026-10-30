/** 项目新建 / 编辑弹窗（数据集列表与项目详情共用） */
import React, { useEffect, useMemo, useState } from 'react';
import { App, Col, Form, Input, Modal, Row, Select, Switch } from 'antd';
import { createProject, updateProject } from '@/api/projects';
import type { ProjectGroupNode, ProjectPayload, ProjectRow } from '@/api/projects';

export interface ProjectFormModalProps {
  open: boolean;
  /** 传入则为编辑，不传为新建 */
  project?: ProjectRow | null;
  groups: ProjectGroupNode[];
  defaultGroupId?: number | null;
  onClose: () => void;
  onSaved: (project: ProjectRow) => void;
}

interface FormValues {
  name: string;
  code?: string;
  groupId?: number | null;
  category?: string;
  tags?: string;
  description?: string;
  jdySecret?: string;
  parseEnabled: boolean;
  remark?: string;
}

/** 分组扁平化（带层级缩进），用于下拉选择 */
export function groupOptions(tree: ProjectGroupNode[]): { label: string; value: number }[] {
  const out: { label: string; value: number }[] = [];
  const walk = (nodes: ProjectGroupNode[], depth: number) => {
    nodes.forEach((n) => {
      out.push({ label: `${'　'.repeat(depth)}${depth ? '└ ' : ''}${n.name}`, value: n.id });
      if (n.children?.length) walk(n.children, depth + 1);
    });
  };
  walk(tree || [], 0);
  return out;
}

export default function ProjectFormModal({
  open, project, groups, defaultGroupId, onClose, onSaved,
}: ProjectFormModalProps) {
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();
  const isEdit = Boolean(project);

  const options = useMemo(() => groupOptions(groups), [groups]);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      name: project?.name || '',
      code: project?.code || '',
      groupId: project ? (project.group_id ?? undefined) : (defaultGroupId ?? undefined),
      category: project?.category || '',
      tags: project?.tags || '',
      description: project?.description || '',
      jdySecret: (project?.jdy_secret as string) || '',
      parseEnabled: project ? Number(project.parse_enabled ?? 1) === 1 : true,
      remark: project?.remark || '',
    });
  }, [open, project, defaultGroupId, form]);

  const submit = async () => {
    const values = await form.validateFields();
    const payload: ProjectPayload = {
      name: values.name.trim(),
      groupId: values.groupId ?? 0,
      category: values.category || '',
      tags: values.tags || '',
      description: values.description || '',
      jdySecret: values.jdySecret || '',
      parseEnabled: values.parseEnabled ? 1 : 0,
      remark: values.remark || '',
    };
    if (!isEdit) payload.code = values.code || '';

    setSaving(true);
    try {
      const saved = project
        ? await updateProject(project.id, payload)
        : await createProject(payload);
      message.success(isEdit ? '项目已保存' : '项目创建成功，数据表已自动创建');
      onSaved(saved);
      onClose();
    } catch {
      // 错误已由 api client 统一 toast
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={isEdit ? `编辑项目 · ${project?.name || ''}` : '新建数据项目'}
      onCancel={onClose}
      onOk={() => void submit()}
      confirmLoading={saving}
      okText={isEdit ? '保存' : '创建'}
      cancelText="取消"
      destroyOnHidden
      width={640}
    >
      <Form form={form} layout="vertical" requiredMark="optional" style={{ marginTop: 8 }}>
        <Row gutter={12}>
          <Col xs={24} sm={14}>
            <Form.Item
              name="name"
              label="项目名称"
              rules={[{ required: true, message: '请输入项目名称' }, { max: 64, message: '最多 64 个字符' }]}
            >
              <Input placeholder="如：CRM 表单推送" maxLength={64} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={10}>
            <Form.Item name="code" label="项目编码" tooltip="用于生成数据表名，创建后不可修改；留空则按名称自动生成">
              <Input placeholder="自动生成" disabled={isEdit} maxLength={48} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="groupId" label="所属分组">
              <Select
                allowClear
                placeholder="未分组"
                options={options}
                showSearch
                optionFilterProp="label"
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="category" label="业务分类">
              <Input placeholder="如：客户管理" maxLength={32} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="tags" label="标签" tooltip="多个标签用英文逗号分隔">
          <Input placeholder="crm,签单,门店" maxLength={128} />
        </Form.Item>

        <Form.Item name="description" label="项目描述">
          <Input.TextArea rows={2} placeholder="这个项目接收哪类数据" maxLength={255} />
        </Form.Item>

        <Row gutter={12}>
          <Col xs={24} sm={16}>
            <Form.Item
              name="jdySecret"
              label="简道云校验 Secret"
              tooltip="开启校验后推送报文需带签名；留空表示不校验"
            >
              <Input.Password placeholder="可留空" autoComplete="new-password" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="parseEnabled" label="启用字段解析" valuePropName="checked">
              <Switch checkedChildren="开" unCheckedChildren="关" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="remark" label="备注">
          <Input.TextArea rows={2} maxLength={255} placeholder="可选" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
