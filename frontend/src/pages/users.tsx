/** 用户管理：用户列表 / 角色权限 / 组织架构 / 角色权限说明 / 权限点说明（5 个 Tabs 卡片） */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Avatar, Button, Card, Col, Empty, Form, Grid, Input, InputNumber, Modal,
  Popconfirm, Row, Select, Space, Statistic, Switch, Table, Tabs, Tag, Tree, Typography, message,
} from 'antd';
import type { TreeDataNode } from 'antd';
import {
  ApartmentOutlined, DeleteOutlined, EditOutlined, KeyOutlined, LockOutlined,
  PlusOutlined, ReloadOutlined, SafetyCertificateOutlined, TeamOutlined, UserOutlined,
} from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import Page from '@/components/Page';
import { useAppStore, usePermission } from '@/stores/app';
import { C, RoleManager, softStyle } from '@/pages/roles';
import {
  createDepartment, createUser, deleteDepartment, deleteUser, getPermissions, initDepartments,
  listDepartmentUsers, listDepartments, listUsers, resetUserPassword, updateDepartment, updateUser,
} from '@/api/users';
import type {
  DeptMember, DeptRow, PermissionGroup, PermissionMeta, RoleRow, UserRow, UserStats,
} from '@/api/users';
import { fmtTime } from '@/utils';

const { Text } = Typography;
const { useBreakpoint } = Grid;

interface UserFilters {
  keyword?: string;
  role?: string;
  status?: string;
}

/* ══════════════ 用户列表 ══════════════ */

interface UserTabProps {
  depts: DeptRow[];
  onData: (stats: UserStats, roles: RoleRow[]) => void;
}

function UserTab({ depts, onData }: UserTabProps) {
  // 订阅 user：登录态就绪后需要重新计算权限（can 是稳定引用，单独订阅不会触发重渲染）
  const currentUser = useAppStore((s) => s.user);
  const can = usePermission();
  const canWrite = !!currentUser && can('user:write');
  /** 当前登录用户 ID：禁止删除自己（后端也会拒绝，这里提前禁用按钮） */
  const selfId = currentUser?.id;
  const actionRef = useRef<ActionType>(null);

  const [filters, setFilters] = useState<UserFilters>({ keyword: '', role: '', status: '' });
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [stats, setStats] = useState<UserStats>({ total: 0, active: 0, admins: 0 });
  const [loadError, setLoadError] = useState('');

  const [userOpen, setUserOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [userForm] = Form.useForm();

  const [pwdUser, setPwdUser] = useState<UserRow | null>(null);
  const [pwdForm] = Form.useForm();

  const roleOptions = useMemo(
    () => roles.map((r) => ({ label: r.name, value: r.key })),
    [roles]
  );

  const openCreate = () => {
    setEditing(null);
    userForm.resetFields();
    userForm.setFieldsValue({ role: roles[0]?.key || 'viewer', status: true });
    setUserOpen(true);
  };

  const openEdit = (u: UserRow) => {
    setEditing(u);
    userForm.resetFields();
    userForm.setFieldsValue({
      username: u.username,
      displayName: u.displayName || '',
      email: u.email || '',
      role: u.role,
      departmentId: u.departmentId ?? undefined,
      position: u.position || '',
      phone: u.phone || '',
      status: u.status === 1,
      password: '',
    });
    setUserOpen(true);
  };

  const submitUser = async () => {
    let v: {
      username?: string; password?: string; displayName?: string; email?: string;
      role?: string; departmentId?: number | null; position?: string; phone?: string; status?: boolean;
    };
    try {
      v = await userForm.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateUser(editing.id, {
          displayName: (v.displayName || '').trim(),
          email: (v.email || '').trim(),
          role: v.role,
          status: v.status ? 1 : 0,
          departmentId: v.departmentId ?? null,
          position: (v.position || '').trim(),
          phone: (v.phone || '').trim(),
          ...(v.password ? { password: v.password } : {}),
        });
        message.success('用户已更新');
      } else {
        await createUser({
          username: (v.username || '').trim(),
          password: v.password || '',
          displayName: (v.displayName || '').trim(),
          email: (v.email || '').trim(),
          role: v.role,
          status: v.status ? 1 : 0,
          departmentId: v.departmentId ?? null,
          position: (v.position || '').trim(),
          phone: (v.phone || '').trim(),
        });
        message.success('用户创建成功');
      }
      setUserOpen(false);
      actionRef.current?.reload();
    } catch {
      /* client 已提示错误 */
    } finally {
      setSaving(false);
    }
  };

  const submitPassword = async () => {
    if (!pwdUser) return;
    let v: { newPassword: string };
    try {
      v = await pwdForm.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      await resetUserPassword(pwdUser.id, v.newPassword);
      message.success(`已重置 ${pwdUser.username} 的密码`);
      setPwdUser(null);
      pwdForm.resetFields();
    } catch {
      /* client 已提示 */
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async (u: UserRow) => {
    try {
      await deleteUser(u.id);
      message.success('用户已删除');
      actionRef.current?.reload();
    } catch {
      /* client 已提示 */
    }
  };

  const columns: ProColumns<UserRow>[] = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 64,
      align: 'center',
    },
    {
      title: '用户',
      dataIndex: 'username',
      width: 190,
      render: (_, u) => (
        <Space size={8}>
          <Avatar
            size={30}
            src={u.avatar || undefined}
            style={{ background: u.avatarColor || C.blue, fontSize: 12, flexShrink: 0 }}
          >
            {(u.displayName || u.username).slice(0, 1)}
          </Avatar>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.navy, lineHeight: 1.3 }}>{u.username}</div>
            <div style={{ fontSize: 11.5, color: C.gray, lineHeight: 1.3 }}>
              {u.displayName || '未设置昵称'}
            </div>
          </div>
        </Space>
      ),
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      width: 210,
      render: (_, u) =>
        u.email ? (
          <Space size={4} wrap>
            <Text style={{ fontSize: 12.5 }}>{u.email}</Text>
            {u.emailVerified ? <Tag style={softStyle(C.green)}>已验证</Tag> : null}
          </Space>
        ) : (
          <Text style={{ fontSize: 12.5, color: C.gray }}>未设置</Text>
        ),
    },
    {
      title: '角色',
      dataIndex: 'roleName',
      width: 120,
      render: (_, u) => <Tag style={softStyle(u.role === 'admin' ? C.red : C.primary)}>{u.roleName || u.role}</Tag>,
    },
    {
      title: '部门 / 职位',
      dataIndex: 'department',
      width: 160,
      render: (_, u) => (
        <div style={{ lineHeight: 1.4 }}>
          <div style={{ fontSize: 12.5, color: C.navy }}>{u.department || '-'}</div>
          {u.position ? <div style={{ fontSize: 11.5, color: C.gray }}>{u.position}</div> : null}
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 84,
      align: 'center',
      render: (_, u) =>
        u.status === 1 ? (
          <Tag style={softStyle(C.green)}>启用</Tag>
        ) : (
          <Tag style={softStyle(C.gray)}>禁用</Tag>
        ),
    },
    {
      title: '项目',
      dataIndex: 'projectCount',
      width: 72,
      align: 'center',
      render: (_, u) => <Text style={{ fontSize: 12.5 }}>{u.projectCount}</Text>,
    },
    {
      title: '最后登录',
      dataIndex: 'lastLoginAt',
      width: 170,
      render: (_, u) => (
        <div style={{ lineHeight: 1.4 }}>
          <div style={{ fontSize: 12.5 }}>{fmtTime(u.lastLoginAt, 'YYYY-MM-DD HH:mm')}</div>
          {u.lastLoginIp ? <div style={{ fontSize: 11.5, color: C.gray }}>{u.lastLoginIp}</div> : null}
        </div>
      ),
    },
    {
      title: '操作',
      valueType: 'option',
      width: canWrite ? 190 : 60,
      fixed: 'right',
      render: (_, u) =>
        canWrite
          ? [
              <Button key="edit" size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(u)}>
                编辑
              </Button>,
              <Button
                key="pwd"
                size="small"
                type="link"
                icon={<LockOutlined />}
                onClick={() => {
                  pwdForm.resetFields();
                  setPwdUser(u);
                }}
              >
                重置密码
              </Button>,
              <Popconfirm
                key="del"
                title="删除用户"
                description={`确定删除用户「${u.username}」？该操作不可恢复。`}
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => doDelete(u)}
              >
                <Button
                  size="small"
                  type="link"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={u.username === 'admin' || u.id === selfId}
                >
                  删除
                </Button>
              </Popconfirm>,
            ]
          : [
              <Text key="ro" style={{ fontSize: 12, color: C.gray }}>
                只读
              </Text>,
            ],
    },
  ];

  return (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      {/* 统计 */}
      <Row gutter={[12, 12]}>
        {[
          { title: '用户总数', value: stats.total, color: C.blue, icon: <TeamOutlined /> },
          { title: '启用账号', value: stats.active, color: C.green, icon: <UserOutlined /> },
          { title: '超级管理员', value: stats.admins, color: C.red, icon: <SafetyCertificateOutlined /> },
          { title: '角色数量', value: roles.length, color: C.cyan, icon: <KeyOutlined /> },
        ].map((s) => (
          <Col key={s.title} xs={12} md={6}>
            <Card size="small" style={{ borderColor: C.line }} styles={{ body: { padding: '12px 14px' } }}>
              <Statistic
                title={
                  <Space size={6}>
                    <span style={{ color: s.color }}>{s.icon}</span>
                    <span style={{ fontSize: 12.5, color: C.gray }}>{s.title}</span>
                  </Space>
                }
                value={s.value}
                styles={{ content: { color: s.color, fontSize: 22, fontWeight: 700 } }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {loadError ? (
        <Alert type="error" showIcon title="用户列表加载失败" description={loadError} />
      ) : null}

      {/* 筛选 */}
      <Card size="small" style={{ borderColor: C.line }} styles={{ body: { padding: 12 } }}>
        <Space size={8} wrap>
          <Input.Search
            allowClear
            placeholder="搜索账号 / 昵称 / 邮箱"
            style={{ width: 240 }}
            onSearch={(v) => setFilters((f) => ({ ...f, keyword: v.trim() }))}
          />
          <Select
            allowClear
            placeholder="全部角色"
            style={{ width: 150 }}
            options={roleOptions}
            value={filters.role || undefined}
            onChange={(v) => setFilters((f) => ({ ...f, role: v || '' }))}
          />
          <Select
            allowClear
            placeholder="全部状态"
            style={{ width: 130 }}
            options={[
              { label: '启用', value: '1' },
              { label: '禁用', value: '0' },
            ]}
            value={filters.status || undefined}
            onChange={(v) => setFilters((f) => ({ ...f, status: v || '' }))}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => setFilters({ keyword: '', role: '', status: '' })}
          >
            重置
          </Button>
        </Space>
      </Card>

      <ProTable<UserRow, UserFilters>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        params={filters}
        search={false}
        options={false}
        scroll={{ x: 'max-content' }}
        request={async (params) => {
          const current = params.current || 1;
          const pageSize = params.pageSize || 10;
          try {
            const r = await listUsers(params.keyword || '');
            const roleList = Object.values(r.roles || {});
            setRoles(roleList);
            setStats(r.stats);
            onData(r.stats, roleList);
            setLoadError('');
            let list = r.list;
            if (params.role) list = list.filter((u) => u.role === params.role);
            if (params.status) list = list.filter((u) => String(u.status) === params.status);
            const start = (current - 1) * pageSize;
            return { data: list.slice(start, start + pageSize), total: list.length, success: true };
          } catch (e) {
            setLoadError(e instanceof Error ? e.message : '需要管理员权限才能查看用户列表');
            return { data: [], total: 0, success: false };
          }
        }}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 个用户`,
        }}
        headerTitle={
          <Space size={8}>
            <TeamOutlined style={{ color: C.primary }} />
            <span style={{ fontSize: 13.5, fontWeight: 600, color: C.navy }}>用户列表</span>
          </Space>
        }
        toolBarRender={() =>
          canWrite
            ? [
                <Button key="add" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                  新建用户
                </Button>,
              ]
            : []
        }
      />

      {/* 新建 / 编辑用户 */}
      <Modal
        title={editing ? `编辑用户：${editing.username}` : '新建用户'}
        open={userOpen}
        onCancel={() => setUserOpen(false)}
        onOk={submitUser}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        width={640}
        destroyOnHidden
      >
        <Form form={userForm} layout="vertical" requiredMark={false}>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item
                name="username"
                label="登录账号"
                rules={[
                  { required: true, message: '请填写登录账号' },
                  { pattern: /^[A-Za-z0-9_.-]{3,32}$/, message: '3-32 位字母、数字、下划线、点或短横线' },
                ]}
              >
                <Input placeholder="例如：zhangsan" disabled={!!editing} autoComplete="off" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="displayName" label="显示名称">
                <Input placeholder="例如：张三" maxLength={64} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="email"
                label="邮箱"
                rules={[{ type: 'email', message: '邮箱格式不正确' }]}
                extra="用于找回密码与接收系统通知"
              >
                <Input placeholder="name@example.com" autoComplete="off" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="password"
                label={editing ? '重置密码（留空不修改）' : '登录密码'}
                rules={
                  editing
                    ? [
                        {
                          validator: (_, value?: string) =>
                            !value || value.length >= 6
                              ? Promise.resolve()
                              : Promise.reject(new Error('密码至少 6 位')),
                        },
                      ]
                    : [
                        { required: true, message: '请填写登录密码' },
                        { min: 6, message: '密码至少 6 位' },
                      ]
                }
              >
                <Input.Password placeholder={editing ? '留空表示不修改' : '至少 6 位'} autoComplete="new-password" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="role" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
                <Select options={roleOptions} placeholder="选择角色" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="departmentId" label="所属部门">
                <Select
                  allowClear
                  placeholder="未分配"
                  options={depts.map((d) => ({ label: d.name, value: d.id }))}
                  showSearch
                  optionFilterProp="label"
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="position" label="职位">
                <Input placeholder="例如：数据分析师" maxLength={64} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="phone" label="手机号">
                <Input placeholder="可选" maxLength={32} />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item name="status" label="账号状态" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="禁用" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* 重置密码 */}
      <Modal
        title={pwdUser ? `重置密码：${pwdUser.username}` : '重置密码'}
        open={!!pwdUser}
        onCancel={() => setPwdUser(null)}
        onOk={submitPassword}
        okText="重置"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          title="重置后该用户所有登录会话将失效，需要使用新密码重新登录。"
          style={{ marginBottom: 14 }}
        />
        <Form form={pwdForm} layout="vertical" requiredMark={false}>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: '请填写新密码' },
              { min: 6, message: '密码至少 6 位' },
            ]}
          >
            <Input.Password placeholder="至少 6 位" autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

/* ══════════════ 组织架构 ══════════════ */

function OrganizationTab({ depts, reload }: { depts: DeptRow[]; reload: () => Promise<DeptRow[]> }) {
  const currentUser = useAppStore((s) => s.user);
  const can = usePermission();
  const canWrite = !!currentUser && can('user:write');
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [deptList, setDeptList] = useState<DeptRow[]>(depts);
  const [selectedId, setSelectedId] = useState<number | null>(depts[0]?.id ?? null);
  const [members, setMembers] = useState<DeptMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const [editing, setEditing] = useState<DeptRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);

  useEffect(() => {
    setDeptList(depts);
    if (selectedId == null && depts.length) setSelectedId(depts[0].id);
  }, [depts, selectedId]);

  useEffect(() => {
    setExpandedKeys(deptList.map((d) => d.id));
  }, [deptList]);

  const selected = useMemo(() => deptList.find((d) => d.id === selectedId) || null, [deptList, selectedId]);

  /* 树结构：由扁平列表递归构建，避免与后端 tree 字段耦合 */
  const treeData = useMemo<TreeDataNode[]>(() => {
    const nodeOf = (d: DeptRow, depth: number): TreeDataNode => {
      const children = deptList
        .filter((x) => x.parentId === d.id)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
        .map((x) => nodeOf(x, depth + 1));
      return {
        key: d.id,
        title: (
          <Space size={6}>
            <span style={{ fontSize: 13 }}>{d.name}</span>
            <Tag style={softStyle(C.gray)}>{d.userCount} 人</Tag>
          </Space>
        ),
        children: children.length ? children : undefined,
      };
    };
    const roots = deptList
      .filter((d) => !d.parentId || !deptList.some((x) => x.id === d.parentId))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    return roots.map((d) => nodeOf(d, 0));
  }, [deptList]);

  const loadMembers = useCallback(async (id: number) => {
    setMembersLoading(true);
    try {
      const list = await listDepartmentUsers(id);
      setMembers(list);
    } catch {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId != null) void loadMembers(selectedId);
    else setMembers([]);
  }, [selectedId, loadMembers]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ parentId: selected?.id ?? 0, sortOrder: 0 });
    setDeptOpen(true);
  };

  const openEdit = (d: DeptRow) => {
    setEditing(d);
    form.resetFields();
    form.setFieldsValue({
      name: d.name,
      parentId: d.parentId,
      code: d.code,
      leader: d.leader,
      sortOrder: d.sortOrder,
      remark: d.remark,
    });
    setDeptOpen(true);
  };

  const submitDept = async () => {
    let v: { name: string; parentId?: number; code?: string; leader?: string; sortOrder?: number; remark?: string };
    try {
      v = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: v.name.trim(),
        parentId: Number(v.parentId) || 0,
        code: (v.code || '').trim(),
        leader: (v.leader || '').trim(),
        sortOrder: Number(v.sortOrder) || 0,
        remark: (v.remark || '').trim(),
      };
      if (editing) {
        await updateDepartment(editing.id, body);
        message.success('部门已更新');
      } else {
        const created = await createDepartment(body);
        message.success('部门创建成功');
        setSelectedId(created.id);
      }
      setDeptOpen(false);
      const list = await reload();
      setDeptList(list);
    } catch {
      /* client 已提示 */
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async (d: DeptRow) => {
    try {
      await deleteDepartment(d.id);
      message.success('部门已删除');
      const list = await reload();
      setDeptList(list);
      setSelectedId(list[0]?.id ?? null);
    } catch {
      /* client 已提示 */
    }
  };

  const doInit = async () => {
    try {
      await initDepartments();
      message.success('已创建默认组织架构');
      const list = await reload();
      setDeptList(list);
      setSelectedId(list[0]?.id ?? null);
    } catch {
      /* client 已提示 */
    }
  };

  const treeCard = (
    <Card
      size="small"
      style={{ borderColor: C.line }}
      title={
        <Space size={6}>
          <ApartmentOutlined style={{ color: C.primary }} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: C.navy }}>部门树</span>
          <Tag style={softStyle(C.blue)}>{deptList.length}</Tag>
        </Space>
      }
      extra={
        canWrite ? (
          <Button size="small" icon={<PlusOutlined />} onClick={openCreate}>
            新建
          </Button>
        ) : null
      }
      styles={{ body: { padding: 8 } }}
    >
      {deptList.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无部门">
          {canWrite ? (
            <Button type="primary" size="small" onClick={doInit}>
              创建默认组织架构
            </Button>
          ) : null}
        </Empty>
      ) : (
        <Tree
          treeData={treeData}
          expandedKeys={expandedKeys}
          onExpand={(keys) => setExpandedKeys(keys)}
          blockNode
          selectedKeys={selectedId != null ? [selectedId] : []}
          onSelect={(keys) => setSelectedId(keys.length ? Number(keys[0]) : null)}
          style={{ background: 'transparent' }}
        />
      )}
    </Card>
  );

  const detailCard = (
    <Card
      size="small"
      style={{ borderColor: C.line }}
      title={
        <Space size={8} wrap>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: C.navy }}>
            {selected ? selected.name : '部门详情'}
          </span>
          {selected ? <Tag style={softStyle(C.primary)}>{selected.userCount} 人</Tag> : null}
        </Space>
      }
      extra={
        selected && canWrite ? (
          <Space size={6}>
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(selected)}>
              编辑
            </Button>
            <Popconfirm
              title="删除部门"
              description={`确定删除部门「${selected.name}」？需先移除子部门与成员。`}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => doDelete(selected)}
            >
              <Button size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ) : null
      }
    >
      {!selected ? (
        <Empty description="请从左侧选择一个部门" />
      ) : (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Row gutter={[12, 8]}>
            {[
              { label: '部门名称', value: selected.name },
              { label: '部门编码', value: selected.code || '未设置' },
              { label: '负责人', value: selected.leader || '未设置' },
              {
                label: '上级部门',
                value: selected.parentId
                  ? deptList.find((d) => d.id === selected.parentId)?.name || '-'
                  : '顶级部门',
              },
              { label: '成员数', value: `${selected.userCount} 人` },
              { label: '排序', value: String(selected.sortOrder) },
              ...(selected.remark ? [{ label: '备注', value: selected.remark }] : []),
            ].map((item) => (
              <Col key={item.label} xs={12} md={8}>
                <div style={{ fontSize: 11.5, color: C.gray }}>{item.label}</div>
                <div style={{ fontSize: 13, color: C.navy, fontWeight: 500 }}>{item.value}</div>
              </Col>
            ))}
          </Row>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: C.navy, marginBottom: 8 }}>部门成员</div>
            <Table<DeptMember>
              size="small"
              rowKey="id"
              loading={membersLoading}
              dataSource={members}
              pagination={false}
              scroll={{ x: 'max-content' }}
              locale={{ emptyText: '该部门暂无成员' }}
              columns={[
                { title: 'ID', dataIndex: 'id', width: 64 },
                { title: '账号', dataIndex: 'username', width: 140 },
                { title: '昵称', dataIndex: 'display_name', width: 140, render: (v) => v || '-' },
                { title: '邮箱', dataIndex: 'email', width: 200, render: (v) => v || '-' },
                { title: '角色', dataIndex: 'role', width: 110 },
                { title: '职位', dataIndex: 'position', width: 130, render: (v) => v || '-' },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 84,
                  render: (v: number) =>
                    v === 1 ? <Tag style={softStyle(C.green)}>启用</Tag> : <Tag style={softStyle(C.gray)}>禁用</Tag>,
                },
              ]}
            />
          </div>
        </Space>
      )}
    </Card>
  );

  return (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        title="组织架构用于用户归属与职责划分，支持多级部门；删除部门前需先清空子部门与成员。"
      />
      {isMobile ? (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          {treeCard}
          {detailCard}
        </Space>
      ) : (
        <Row gutter={12}>
          <Col span={8} xl={7}>
            {treeCard}
          </Col>
          <Col span={16} xl={17}>
            {detailCard}
          </Col>
        </Row>
      )}

      <Modal
        title={editing ? `编辑部门：${editing.name}` : '新建部门'}
        open={deptOpen}
        onCancel={() => setDeptOpen(false)}
        onOk={submitDept}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="name" label="部门名称" rules={[{ required: true, message: '请填写部门名称' }]}>
                <Input placeholder="例如：数据部" maxLength={64} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="parentId" label="上级部门">
                <Select
                  placeholder="顶级部门"
                  options={[
                    { label: '（顶级部门）', value: 0 },
                    ...deptList.filter((d) => d.id !== editing?.id).map((d) => ({ label: d.name, value: d.id })),
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="code" label="部门编码">
                <Input placeholder="可选" maxLength={32} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="leader" label="负责人">
                <Input placeholder="可选" maxLength={32} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="sortOrder" label="排序">
                <InputNumber min={0} max={9999} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item name="remark" label="备注">
                <Input.TextArea rows={2} placeholder="可选" maxLength={200} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </Space>
  );
}

/* ══════════════ 角色权限说明 / 权限点说明 ══════════════ */

function RoleInfoTab({ roles, groups }: { roles: RoleRow[]; groups: PermissionGroup[] }) {
  if (!roles.length) return <Empty description="暂无角色数据" />;
  return (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        title="角色决定用户能看到哪些菜单、能执行哪些操作。权限变更后立即生效，用户下次请求即按新权限校验。"
      />
      <Row gutter={[12, 12]}>
        {roles.map((r) => {
          const isAll = r.permissions.includes('*');
          const perms = isAll ? groups.flatMap((g) => g.items.map((i) => i.key)) : r.permissions;
          const stats = groups
            .map((g) => ({ name: g.name, has: g.items.filter((i) => perms.includes(i.key)).length, total: g.items.length }))
            .filter((g) => g.has > 0);
          return (
            <Col key={r.id} xs={24} xl={12}>
              <Card
                size="small"
                style={{ borderColor: C.line, height: '100%' }}
                title={
                  <Space size={8} wrap>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: C.navy }}>{r.name}</span>
                    <Tag style={softStyle(C.gray)}>{r.key}</Tag>
                    {r.isSystem ? <Tag style={softStyle(C.orange)}>内置</Tag> : null}
                  </Space>
                }
                extra={
                  <Text style={{ fontSize: 11.5, color: C.gray }}>
                    {r.userCount ?? 0} 个用户 · {isAll ? '全部权限' : `${r.permissions.length} 个权限点`}
                  </Text>
                }
              >
                <div style={{ fontSize: 12.5, color: C.gray, marginBottom: 10, lineHeight: 1.6 }}>
                  {r.description || '（无说明）'}
                </div>
                <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                  {stats.length === 0 ? (
                    <Text style={{ fontSize: 12, color: C.gray }}>无任何权限</Text>
                  ) : (
                    stats.map((g) => {
                      const pct = Math.round((g.has / g.total) * 100);
                      return (
                        <div key={g.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ width: 96, fontSize: 12, color: C.navy, flexShrink: 0 }}>{g.name}</span>
                          <div
                            style={{
                              flex: 1,
                              height: 8,
                              borderRadius: 4,
                              background: 'rgba(54,135,255,.10)',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                width: `${pct}%`,
                                height: '100%',
                                borderRadius: 4,
                                background: pct === 100 ? C.green : C.primary,
                              }}
                            />
                          </div>
                          <span style={{ width: 56, textAlign: 'right', fontSize: 11.5, color: C.gray }}>
                            {g.has}/{g.total}
                          </span>
                        </div>
                      );
                    })
                  )}
                </Space>
              </Card>
            </Col>
          );
        })}
      </Row>
    </Space>
  );
}

function PermissionInfoTab({ groups }: { groups: PermissionGroup[] }) {
  if (!groups.length) return <Empty description="暂无权限点数据" />;
  return (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        title={`共 ${groups.length} 个模块、${groups.reduce((s, g) => s + g.items.length, 0)} 个权限点，采用「模块:操作」命名。`}
      />
      <Row gutter={[12, 12]}>
        {groups.map((g) => (
          <Col key={g.key} xs={24} lg={12} xxl={8}>
            <Card
              size="small"
              style={{ borderColor: C.line, height: '100%' }}
              title={
                <Space size={6}>
                  <KeyOutlined style={{ color: C.primary, fontSize: 13 }} />
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: C.navy }}>{g.name}</span>
                  <Tag style={softStyle(C.primary)}>{g.items.length}</Tag>
                </Space>
              }
            >
              <Space orientation="vertical" size={10} style={{ width: '100%' }}>
                {g.items.map((i) => (
                  <div key={i.key}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: C.navy }}>{i.name}</span>
                      <code
                        style={{
                          fontSize: 11,
                          color: C.blue,
                          background: 'rgba(54,135,255,.08)',
                          borderRadius: 4,
                          padding: '1px 5px',
                        }}
                      >
                        {i.key}
                      </code>
                    </div>
                    <div style={{ fontSize: 11.5, color: C.gray, lineHeight: 1.6, marginTop: 2 }}>{i.desc}</div>
                  </div>
                ))}
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
    </Space>
  );
}

/* ══════════════ 页面 ══════════════ */

export default function UsersPage() {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [activeKey, setActiveKey] = useState('users');
  const [stats, setStats] = useState<UserStats>({ total: 0, active: 0, admins: 0 });
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [permMeta, setPermMeta] = useState<PermissionMeta>({ groups: [], all: [], names: {} });
  const [depts, setDepts] = useState<DeptRow[]>([]);
  const deptsRef = useRef<DeptRow[]>([]);

  /** 部门列表（供组织架构 tab 与用户表单共享） */
  const loadDepts = useCallback(async (): Promise<DeptRow[]> => {
    try {
      const r = await listDepartments();
      deptsRef.current = r.list;
      setDepts(r.list);
      return r.list;
    } catch {
      return deptsRef.current;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const meta = await getPermissions();
        setPermMeta(meta);
      } catch {
        /* 权限点接口失败时保持空态 */
      }
      await loadDepts();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabItems = [
    {
      key: 'users',
      label: (
        <Space size={6}>
          <TeamOutlined />
          <span>用户列表</span>
        </Space>
      ),
      children: (
        <UserTab
          depts={depts}
          onData={(s, r) => {
            setStats(s);
            if (r.length) setRoles(r);
          }}
        />
      ),
    },
    {
      key: 'roles',
      label: (
        <Space size={6}>
          <SafetyCertificateOutlined />
          <span>角色权限</span>
        </Space>
      ),
      children: <RoleManager embedded />,
    },
    {
      key: 'org',
      label: (
        <Space size={6}>
          <ApartmentOutlined />
          <span>组织架构</span>
        </Space>
      ),
      children: <OrganizationTab depts={depts} reload={loadDepts} />,
    },
    {
      key: 'roleinfo',
      label: (
        <Space size={6}>
          <KeyOutlined />
          <span>角色权限说明</span>
        </Space>
      ),
      children: <RoleInfoTab roles={roles} groups={permMeta.groups} />,
    },
    {
      key: 'perminfo',
      label: (
        <Space size={6}>
          <LockOutlined />
          <span>权限点说明</span>
        </Space>
      ),
      children: <PermissionInfoTab groups={permMeta.groups} />,
    },
  ];

  return (
    <Page
      title="用户管理"
      subTitle={`共 ${stats.total} 个账号 · ${stats.active} 个启用 · ${stats.admins} 个超级管理员`}
      extra={
        <Tag style={{ ...softStyle(C.primary), padding: '3px 10px', fontSize: 12.5 }}>
          <Space size={4}>
            <UserOutlined />
            <span>账号与权限中心</span>
          </Space>
        </Tag>
      }
    >
      <Tabs
        type="card"
        activeKey={activeKey}
        onChange={setActiveKey}
        items={tabItems}
        size={isMobile ? 'small' : 'middle'}
        tabBarStyle={{ marginBottom: 12 }}
      />
    </Page>
  );
}
