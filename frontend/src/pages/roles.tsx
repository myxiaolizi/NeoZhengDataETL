/** 角色权限：角色增删改 + 权限点按分组勾选（权限点来自后端 PERMISSION_GROUPS） */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Col, Empty, Form, Grid, Input, Modal,
  Popconfirm, Row, Skeleton, Space, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  DeleteOutlined, InfoCircleOutlined, KeyOutlined, PlusOutlined, SaveOutlined, TeamOutlined,
} from '@ant-design/icons';
import Page from '@/components/Page';
import type { StatCardItem } from '@/components/StatCards';
import { useAppStore, usePermission } from '@/stores/app';
import { createRole, deleteRole, listRoles, updateRole } from '@/api/users';
import type { PermissionGroup, RoleRow } from '@/api/users';
import { PALETTE, NEUTRAL } from '@/theme';

const { Text } = Typography;
const { useBreakpoint } = Grid;

/** 语义色别名（基于 @/theme 令牌，供同域页面复用，保持命名兼容） */
export const C = {
  primary: PALETTE.primary,
  blue: PALETTE.primary,
  navy: NEUTRAL.text,
  cyan: PALETTE.cyan,
  light: PALETTE.cyan,
  green: PALETTE.green,
  yellow: PALETTE.yellow,
  orange: PALETTE.orange,
  red: PALETTE.red,
  gray: NEUTRAL.textTertiary,
  line: NEUTRAL.border,
} as const;

/** 淡色标签样式：背景取主色 10% 透明度，不引入新色相 */
export function softStyle(color: string): React.CSSProperties {
  return { background: `${color}1A`, color, border: 'none', borderRadius: 6, margin: 0, fontSize: 12 };
}

/* ══════════════ 权限点编辑器（users / roles 两页复用） ══════════════ */

export interface PermissionEditorProps {
  groups: PermissionGroup[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

export function PermissionEditor({ groups, value, onChange, disabled }: PermissionEditorProps) {
  const sel = useMemo(() => new Set(value), [value]);

  const toggle = (key: string, checked: boolean) => {
    const next = new Set(sel);
    if (checked) next.add(key);
    else next.delete(key);
    onChange(Array.from(next));
  };

  const toggleGroup = (g: PermissionGroup, checked: boolean) => {
    const next = new Set(sel);
    g.items.forEach((i) => {
      if (checked) next.add(i.key);
      else next.delete(i.key);
    });
    onChange(Array.from(next));
  };

  return (
    <Row gutter={[12, 12]}>
      {groups.map((g) => {
        const has = g.items.filter((i) => sel.has(i.key)).length;
        const allChecked = has === g.items.length && g.items.length > 0;
        return (
          <Col key={g.key} xs={24} md={12} xl={8}>
            <Card
              size="small"
              style={{ height: '100%', borderColor: has ? `${C.primary}33` : C.line }}
              styles={{ body: { padding: 12 } }}
              title={
                <Space size={6}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.navy }}>{g.name}</span>
                  <Tag style={softStyle(has ? C.primary : C.gray)}>
                    {has}/{g.items.length}
                  </Tag>
                </Space>
              }
              extra={
                <Checkbox
                  checked={allChecked}
                  indeterminate={has > 0 && !allChecked}
                  disabled={disabled}
                  onChange={(e) => toggleGroup(g, e.target.checked)}
                >
                  <span style={{ fontSize: 12 }}>全选</span>
                </Checkbox>
              }
            >
              <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                {g.items.map((i) => (
                  <Checkbox
                    key={i.key}
                    checked={sel.has(i.key)}
                    disabled={disabled}
                    onChange={(e) => toggle(i.key, e.target.checked)}
                  >
                    <span style={{ fontSize: 13, color: C.navy, fontWeight: 500 }}>{i.name}</span>
                    <Tooltip title={i.key}>
                      <span style={{ fontSize: 11.5, color: C.gray, marginLeft: 6 }}>{i.key}</span>
                    </Tooltip>
                    <div style={{ fontSize: 11.5, color: C.gray, lineHeight: 1.5 }}>{i.desc}</div>
                  </Checkbox>
                ))}
              </Space>
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}

/* ══════════════ 角色管理器（列表 + 详情编辑） ══════════════ */

export interface RoleManagerProps {
  /** 嵌入「用户管理」标签页时使用紧凑布局 */
  embedded?: boolean;
  /** 角色/权限点数据回传（供上层页面计算统计卡片） */
  onData?: (roles: RoleRow[], groups: PermissionGroup[]) => void;
}

export function RoleManager({ embedded = false, onData }: RoleManagerProps) {
  // 订阅 user：登录态就绪后需要重新计算权限（can 是稳定引用，单独订阅不会触发重渲染）
  const currentUser = useAppStore((s) => s.user);
  const can = usePermission();
  const canWrite = !!currentUser && can('role:write');
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [form] = Form.useForm();
  const [createForm] = Form.useForm();

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [all, setAll] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [perms, setPerms] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createPerms, setCreatePerms] = useState<string[]>([]);

  const activeRef = useRef<number | null>(null);
  const active = useMemo(() => roles.find((r) => r.id === activeId) || null, [roles, activeId]);
  const isWildcard = !!active?.permissions.includes('*');
  const readOnly = !canWrite || isWildcard;

  /** 选中角色并重置草稿 */
  const selectRole = useCallback(
    (role: RoleRow, allPerms: string[]) => {
      activeRef.current = role.id;
      setActiveId(role.id);
      setPerms(role.permissions.includes('*') ? allPerms : role.permissions);
      form.setFieldsValue({ name: role.name, description: role.description || '' });
    },
    [form]
  );

  const load = useCallback(
    async (preferId?: number | null) => {
      setLoading(true);
      try {
        const data = await listRoles();
        setRoles(data.list);
        setGroups(data.groups);
        setAll(data.all);
        if (onData) onData(data.list, data.groups);
        const targetId = preferId ?? activeRef.current;
        const target = data.list.find((r) => r.id === targetId) || data.list[0] || null;
        if (target) selectRole(target, data.all);
        else {
          activeRef.current = null;
          setActiveId(null);
          setPerms([]);
        }
      } catch {
        /* client 已统一提示 */
      } finally {
        setLoading(false);
      }
    },
    [selectRole, onData]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!active) return;
    let v: { name: string; description?: string };
    try {
      v = await form.validateFields();
    } catch {
      return;
    }
    const permissions = isWildcard ? ['*'] : perms;
    if (!permissions.length) {
      message.warning('请至少勾选一个权限点');
      return;
    }
    setSaving(true);
    try {
      await updateRole(active.id, {
        name: v.name.trim(),
        description: (v.description || '').trim(),
        permissions,
      });
      message.success('角色已更新');
      await load(active.id);
    } catch {
      /* client 已提示 */
    } finally {
      setSaving(false);
    }
  };

  const openCreate = () => {
    createForm.resetFields();
    setCreatePerms([]);
    setCreateOpen(true);
  };

  const doCreate = async () => {
    let v: { key: string; name: string; description?: string };
    try {
      v = await createForm.validateFields();
    } catch {
      return;
    }
    if (!createPerms.length) {
      message.warning('请至少勾选一个权限点');
      return;
    }
    setCreating(true);
    try {
      const role = await createRole({
        key: v.key.trim(),
        name: v.name.trim(),
        description: (v.description || '').trim(),
        permissions: createPerms,
        sortOrder: 99,
      });
      message.success('角色创建成功');
      setCreateOpen(false);
      createForm.resetFields();
      setCreatePerms([]);
      await load(role.id);
    } catch {
      /* client 已提示 */
    } finally {
      setCreating(false);
    }
  };

  const doDelete = async (role: RoleRow) => {
    try {
      await deleteRole(role.id);
      message.success('角色已删除');
      await load(null);
    } catch {
      /* client 已提示 */
    }
  };

  /* ---------- 左：角色列表 ---------- */
  const roleList = (
    <Card
      size="small"
      title={
        <Space size={6}>
          <TeamOutlined style={{ color: C.primary }} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: C.navy }}>角色列表</span>
          <Tag style={softStyle(C.blue)}>{roles.length}</Tag>
        </Space>
      }
      extra={
        canWrite ? (
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建角色
          </Button>
        ) : null
      }
      styles={{ body: { padding: 8 } }}
      style={{ borderColor: C.line }}
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : roles.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无角色" />
      ) : (
        <div style={{ maxHeight: isMobile ? 260 : 560, overflow: 'auto' }}>
          <Space orientation="vertical" size={6} style={{ width: '100%' }}>
            {roles.map((r) => {
              const on = r.id === activeId;
              return (
                <div
                  key={r.id}
                  onClick={() => selectRole(r, all)}
                  style={{
                    cursor: 'pointer',
                    padding: '9px 11px',
                    borderRadius: 8,
                    border: `1px solid ${on ? C.primary : C.line}`,
                    background: on ? NEUTRAL.surfaceSunken : NEUTRAL.surface,
                    transition: 'all .15s',
                  }}
                >
                  <Space size={6} wrap>
                    <span style={{ fontSize: 13, fontWeight: 600, color: on ? C.blue : C.navy }}>{r.name}</span>
                    <Tag style={softStyle(C.gray)}>{r.key}</Tag>
                    {r.isSystem ? <Tag style={softStyle(C.orange)}>内置</Tag> : null}
                  </Space>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11.5, color: C.gray }}>
                      {r.permissions.includes('*') ? '全部权限' : `${r.permissions.length} 个权限点`}
                    </span>
                    <span style={{ fontSize: 11.5, color: NEUTRAL.textQuaternary }}>·</span>
                    <span style={{ fontSize: 11.5, color: C.gray }}>{r.userCount ?? 0} 个用户</span>
                  </div>
                </div>
              );
            })}
          </Space>
        </div>
      )}
    </Card>
  );

  /* ---------- 右：角色详情 ---------- */
  const detail = (
    <Card
      size="small"
      style={{ borderColor: C.line }}
      title={
        <Space size={8} wrap>
          <KeyOutlined style={{ color: C.primary }} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: C.navy }}>
            {active ? active.name : '角色详情'}
          </span>
          {active ? <Tag style={softStyle(C.gray)}>{active.key}</Tag> : null}
          {active?.isSystem ? <Tag style={softStyle(C.orange)}>系统内置</Tag> : null}
        </Space>
      }
      extra={
        active && !active.isSystem && canWrite ? (
          <Popconfirm
            title="删除角色"
            description={`确定删除角色「${active.name}」？`}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => doDelete(active)}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        ) : null
      }
    >
      {!active ? (
        <Empty description="请从左侧选择一个角色" />
      ) : (
        <Space orientation="vertical" size={14} style={{ width: '100%' }}>
          <Form form={form} layout="vertical" size={isMobile ? 'large' : 'middle'} requiredMark={false}>
            <Row gutter={12}>
              <Col xs={24} md={10}>
                <Form.Item name="name" label="角色名称" rules={[{ required: true, message: '请填写角色名称' }]}>
                  <Input placeholder="例如：数据分析师" disabled={!canWrite} maxLength={32} />
                </Form.Item>
              </Col>
              <Col xs={24} md={14}>
                <Form.Item name="description" label="角色说明">
                  <Input placeholder="描述该角色的职责范围" disabled={!canWrite} maxLength={200} />
                </Form.Item>
              </Col>
            </Row>
          </Form>

          {isWildcard ? (
            <Alert
              type="info"
              showIcon
              icon={<InfoCircleOutlined />}
              title="超级管理员拥有全部权限，且不可缩减"
              description="为避免误操作导致无人能管理平台，内置 admin 角色始终包含全部权限点。"
            />
          ) : !canWrite ? (
            <Alert type="warning" showIcon title="当前账号没有「管理角色」权限，仅可查看" />
          ) : null}

          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginBottom: 10,
                flexWrap: 'wrap',
              }}
            >
              <Space size={8} wrap>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.navy }}>权限点</span>
                <Tag style={softStyle(C.primary)}>
                  {isWildcard ? all.length : perms.length}/{all.length}
                </Tag>
                <Text style={{ fontSize: 11.5, color: C.gray }}>按模块分组，保存后即时生效</Text>
              </Space>
              {!readOnly ? (
                <Space size={6}>
                  <Button size="small" onClick={() => setPerms(all)}>
                    全选
                  </Button>
                  <Button size="small" onClick={() => setPerms([])}>
                    清空
                  </Button>
                </Space>
              ) : null}
            </div>
            <PermissionEditor groups={groups} value={perms} onChange={setPerms} disabled={readOnly} />
          </div>

          {canWrite && !isWildcard ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={() => selectRole(active, all)} disabled={saving}>
                重置
              </Button>
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
                保存角色权限
              </Button>
            </div>
          ) : null}
        </Space>
      )}
    </Card>
  );

  return (
    <>
      {isMobile ? (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          {roleList}
          {detail}
        </Space>
      ) : (
        <Row gutter={12}>
          <Col span={embedded ? 8 : 7} xxl={embedded ? 6 : 5}>
            {roleList}
          </Col>
          <Col span={embedded ? 16 : 17} xxl={embedded ? 18 : 19}>
            {detail}
          </Col>
        </Row>
      )}

      {/* 新建角色 */}
      <Modal
        title="新建角色"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={doCreate}
        okText="创建"
        cancelText="取消"
        confirmLoading={creating}
        width={isMobile ? '100%' : 900}
        style={isMobile ? { top: 12, maxWidth: 'calc(100vw - 24px)' } : undefined}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" requiredMark={false}>
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item
                name="key"
                label="角色标识"
                tooltip="小写字母、数字与下划线，创建后不可修改"
                rules={[
                  { required: true, message: '请填写角色标识' },
                  { pattern: /^[a-z][a-z0-9_]{1,31}$/, message: '需小写字母开头，2-32 位字母/数字/下划线' },
                ]}
              >
                <Input placeholder="例如：analyst" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="name" label="角色名称" rules={[{ required: true, message: '请填写角色名称' }]}>
                <Input placeholder="例如：数据分析师" maxLength={32} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="description" label="角色说明">
                <Input placeholder="职责范围简述" maxLength={200} />
              </Form.Item>
            </Col>
          </Row>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.navy }}>选择权限点</span>
            <Space size={6}>
              <Tag style={softStyle(C.primary)}>
                {createPerms.length}/{all.length}
              </Tag>
              <Button size="small" onClick={() => setCreatePerms(all)}>
                全选
              </Button>
              <Button size="small" onClick={() => setCreatePerms([])}>
                清空
              </Button>
            </Space>
          </div>
          <PermissionEditor groups={groups} value={createPerms} onChange={setCreatePerms} />
        </Form>
      </Modal>
    </>
  );
}

/* ══════════════ 页面 ══════════════ */

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [groups, setGroups] = useState<PermissionGroup[]>([]);

  const onData = useCallback((r: RoleRow[], g: PermissionGroup[]) => {
    setRoles(r);
    setGroups(g);
  }, []);

  const stats = useMemo<StatCardItem[]>(() => {
    const permCount = groups.reduce((s, g) => s + g.items.length, 0);
    const assigned = roles.reduce((s, r) => s + (r.userCount ?? 0), 0);
    return [
      { key: 'roles', label: '角色数', value: roles.length, suffix: '个', color: PALETTE.primary },
      { key: 'perms', label: '权限项数', value: permCount, suffix: '项', color: PALETTE.violet },
      { key: 'assigned', label: '已分配用户', value: assigned, suffix: '人', color: PALETTE.green },
    ];
  }, [roles, groups]);

  return (
    <Page title="角色权限" stats={stats}>
      <RoleManager onData={onData} />
    </Page>
  );
}