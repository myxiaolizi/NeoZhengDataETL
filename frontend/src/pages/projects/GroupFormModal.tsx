/** 项目分组新建 / 编辑弹窗 */
import React, { useEffect, useMemo, useState } from 'react';
import { App, Col, Form, Input, Modal, Row, Select } from 'antd';
import { createProjectGroup, updateProjectGroup } from '@/api/projects';
import type { ProjectGroupNode } from '@/api/projects';

/** 可用分组色（仅契约调色板） */
const GROUP_COLORS = [
  '#3687FF', '#45B4FF', '#003378', '#2D6FE4',
  '#EC673C', '#E86161', '#FFC000', '#A2D73C',
  '#73DBFF', '#B5B5B6',
];

export interface GroupFormModalProps {
  open: boolean;
  /** 传入则为编辑 */
  group?: ProjectGroupNode | null;
  /** 扁平分组列表（用于选择上级） */
  flat: ProjectGroupNode[];
  defaultParentId?: number | null;
  onClose: () => void;
  onSaved: () => void;
}

interface FormValues {
  name: string;
  parentId?: number | null;
  icon?: string;
  color?: string;
  sortOrder?: number;
  remark?: string;
}

/** 求某分组的所有后代 id（编辑时禁止选自己或后代做上级，避免成环） */
function descendantIds(id: number, flat: ProjectGroupNode[]): number[] {
  const out: number[] = [];
  const walk = (pid: number) => {
    flat.filter((g) => Number(g.parentId || 0) === pid).forEach((g) => {
      out.push(g.id);
      walk(g.id);
    });
  };
  walk(id);
  return out;
}

export default function GroupFormModal({
  open, group, flat, defaultParentId, onClose, onSaved,
}: GroupFormModalProps) {
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();
  const isEdit = Boolean(group);

  const parentOptions = useMemo(() => {
    const banned = group ? new Set([group.id, ...descendantIds(group.id, flat)]) : new Set<number>();
    const out: { label: string; value: number; disabled?: boolean }[] = [];
    const walk = (nodes: ProjectGroupNode[], depth: number) => {
      nodes.forEach((n) => {
        out.push({
          label: `${'　'.repeat(depth)}${depth ? '└ ' : ''}${n.name}`,
          value: n.id,
          disabled: banned.has(n.id),
        });
        if (n.children?.length) walk(n.children, depth + 1);
      });
    };
    // flat 是扁平列表，这里按父子关系重建成树
    const byParent = new Map<number, ProjectGroupNode[]>();
    flat.forEach((g) => {
      const pid = Number(g.parentId || 0);
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid)!.push(g);
    });
    const build = (pid: number): ProjectGroupNode[] =>
      (byParent.get(pid) || []).map((g) => ({ ...g, children: build(g.id) }));
    walk(build(0), 0);
    return out;
  }, [flat, group]);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      name: group?.name || '',
      parentId: group ? (group.parentId || undefined) : (defaultParentId ?? undefined),
      icon: group?.icon || '',
      color: group?.color || GROUP_COLORS[0],
      sortOrder: group?.sortOrder ?? undefined,
      remark: group?.remark || '',
    });
  }, [open, group, defaultParentId, form]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const body = {
        name: values.name.trim(),
        parentId: values.parentId ?? 0,
        icon: values.icon || '',
        color: values.color || '',
        sortOrder: values.sortOrder,
        remark: values.remark || '',
      };
      if (group) {
        await updateProjectGroup(group.id, body);
        message.success('分组已更新');
      } else {
        await createProjectGroup(body);
        message.success('分组创建成功');
      }
      onSaved();
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
      title={isEdit ? `编辑分组 · ${group?.name || ''}` : '新建项目分组'}
      onCancel={onClose}
      onOk={() => void submit()}
      confirmLoading={saving}
      okText={isEdit ? '保存' : '创建'}
      cancelText="取消"
      destroyOnHidden
      width={520}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 8 }} requiredMark="optional">
        <Form.Item
          name="name"
          label="分组名称"
          rules={[{ required: true, message: '请输入分组名称' }, { max: 64, message: '最多 64 个字符' }]}
        >
          <Input placeholder="如：CRM 业务" maxLength={64} />
        </Form.Item>

        <Row gutter={12}>
          <Col xs={24} sm={14}>
            <Form.Item name="parentId" label="上级分组" tooltip="留空为顶级分组">
              <Select allowClear placeholder="顶级分组" options={parentOptions} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={10}>
            <Form.Item name="sortOrder" label="排序号" tooltip="同级内升序排列，留空自动排到末尾">
              <Input type="number" placeholder="自动" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="icon" label="图标" tooltip="可填一个 emoji 或符号，如 ▦ 📦">
              <Input placeholder="▦" maxLength={4} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="color" label="标识色">
              <Select
                options={GROUP_COLORS.map((c) => ({
                  value: c,
                  label: (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 12, height: 12, borderRadius: 3, background: c, display: 'inline-block' }} />
                      <span style={{ fontSize: 12, color: '#003378' }}>{c}</span>
                    </span>
                  ),
                }))}
              />
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
