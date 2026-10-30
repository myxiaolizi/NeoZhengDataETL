/**
 * 分享管理
 * - 列表（ProTable / 移动端卡片）：链接、对象、有效期、访问次数、密码保护、启停
 * - 创建分享：选择报表 + 有效期 + 访问密码 + 是否允许导出 → 生成链接并一键复制
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Grid,
  Input,
  InputNumber,
  Modal,
  Result,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  EyeOutlined,
  LinkOutlined,
  LockOutlined,
  PlusOutlined,
  ReloadOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { useNavigate } from 'react-router-dom';
import Page from '@/components/Page';
import { useAppStore } from '@/stores/app';
import { copyText, fmtAgo, fmtNum, fmtTime } from '@/utils';
import {
  createShare,
  deleteShare,
  listReports,
  listShares,
  shareUrlOf,
  toggleShare,
  type ReportItem,
  type ShareItem,
} from '@/api/reports';

const { useBreakpoint } = Grid;
const { Text, Paragraph } = Typography;

const EXPIRE_OPTIONS = [
  { value: 1, label: '1 天' },
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
  { value: 90, label: '90 天' },
  { value: 365, label: '1 年' },
];

function isExpired(s: ShareItem): boolean {
  return !!s.expiresAt && new Date(s.expiresAt).getTime() < Date.now();
}

export default function SharesPage() {
  const navigate = useNavigate();
  const { message, modal } = AntApp.useApp();
  const { can } = useAppStore();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const canWrite = can(['share:write', 'share:read']);

  const [list, setList] = useState<ShareItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled' | 'expired'>('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<ShareItem | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [shares, reps] = await Promise.all([
        listShares(),
        listReports().catch(() => [] as ReportItem[]),
      ]);
      setList(shares || []);
      setReports(reps || []);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return list.filter((s) => {
      if (statusFilter === 'active' && (Number(s.status) !== 1 || isExpired(s))) return false;
      if (statusFilter === 'disabled' && Number(s.status) === 1) return false;
      if (statusFilter === 'expired' && !isExpired(s)) return false;
      if (!kw) return true;
      return [s.title, s.reportName, s.token, s.targetId]
        .filter((v) => v !== undefined && v !== null)
        .some((v) => String(v).toLowerCase().includes(kw));
    });
  }, [list, keyword, statusFilter]);

  const openCreate = (reportId?: number) => {
    form.resetFields();
    form.setFieldsValue({ targetType: 'report', expiresDays: 7, targetId: reportId });
    setCreated(null);
    setCreateOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setCreating(true);
      const share = await createShare({
        targetType: 'report',
        targetId: values.targetId,
        title: values.title || undefined,
        expiresDays: values.expiresDays || undefined,
        password: values.password || undefined,
        allowExport: !!values.allowExport,
      });
      setCreated(share);
      setList((prev) => [share, ...prev]);
      message.success('分享链接已创建');
    } catch (e) {
      if ((e as { errorFields?: unknown }).errorFields) return;
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async (s: ShareItem) => {
    const ok = await copyText(shareUrlOf(s));
    if (ok) message.success('链接已复制到剪贴板');
    else message.warning('复制失败，请手动选择链接复制');
  };

  const handleToggle = async (s: ShareItem, checked: boolean) => {
    try {
      const next = await toggleShare(s.id, checked ? 1 : 0);
      setList((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: next.status } : x)));
      message.success(checked ? '分享已启用' : '分享已停用');
    } catch {
      /* client 已提示 */
    }
  };

  const handleDelete = (s: ShareItem) => {
    modal.confirm({
      title: '删除该分享链接？',
      content: '删除后原链接立即失效，且不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await deleteShare(s.id);
        message.success('分享已删除');
        setList((prev) => prev.filter((x) => x.id !== s.id));
      },
    });
  };

  const statusTag = (s: ShareItem) => {
    if (Number(s.status) !== 1) return <Tag color="#B5B5B6">已停用</Tag>;
    if (isExpired(s)) return <Tag color="#E86161">已过期</Tag>;
    return <Tag color="#A2D73C">生效中</Tag>;
  };

  const columns: ProColumns<ShareItem>[] = [
    {
      title: '分享对象',
      dataIndex: 'title',
      render: (_, s) => (
        <div style={{ minWidth: 0 }}>
          <a onClick={() => navigate(`/reports/${s.targetId}/view`)} style={{ fontWeight: 600, fontSize: 13.5 }}>
            {s.title || s.reportName || `报表 #${s.targetId}`}
          </a>
          <div style={{ fontSize: 11.5, color: '#B5B5B6' }}>
            {s.targetType === 'report' ? '报表' : s.targetType} #{s.targetId}
          </div>
        </div>
      ),
    },
    {
      title: '分享链接',
      dataIndex: 'token',
      width: 240,
      render: (_, s) => (
        <Space size={6}>
          <Text code style={{ fontSize: 11.5 }}>
            /s/{s.token.slice(0, 10)}…
          </Text>
          <Tooltip title="复制完整链接">
            <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => copyLink(s)} />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (_, s) => statusTag(s),
    },
    {
      title: '保护',
      dataIndex: 'hasPassword',
      width: 80,
      align: 'center',
      render: (_, s) =>
        s.hasPassword ? (
          <Tooltip title="需要访问密码">
            <LockOutlined style={{ color: '#FFC000' }} />
          </Tooltip>
        ) : (
          <span style={{ color: '#DCDDDD' }}>—</span>
        ),
    },
    {
      title: '有效期至',
      dataIndex: 'expiresAt',
      width: 150,
      render: (_, s) => (
        <span style={{ fontSize: 12, color: isExpired(s) ? '#E86161' : 'rgba(0,51,120,.65)' }}>
          {s.expiresAt ? fmtTime(s.expiresAt, 'YYYY-MM-DD HH:mm') : '永久有效'}
        </span>
      ),
    },
    {
      title: '访问',
      dataIndex: 'viewCount',
      width: 80,
      align: 'right',
      render: (_, s) => fmtNum(s.viewCount || 0),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 130,
      render: (_, s) => (
        <Tooltip title={fmtTime(s.createdAt)}>
          <span style={{ fontSize: 12, color: 'rgba(0,51,120,.55)' }}>{fmtAgo(s.createdAt)}</span>
        </Tooltip>
      ),
    },
    {
      title: '启用',
      dataIndex: 'enable',
      width: 70,
      align: 'center',
      render: (_, s) => (
        <Switch size="small" checked={Number(s.status) === 1} disabled={!canWrite} onChange={(v) => handleToggle(s, v)} />
      ),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 150,
      fixed: 'right',
      render: (_, s) => [
        <a key="open" onClick={() => window.open(shareUrlOf(s), '_blank')}>
          打开
        </a>,
        <a key="copy" onClick={() => copyLink(s)}>
          复制
        </a>,
        canWrite ? (
          <a key="del" style={{ color: '#E86161' }} onClick={() => handleDelete(s)}>
            删除
          </a>
        ) : null,
      ],
    },
  ];

  const renderCard = (s: ShareItem) => (
    <Card
      key={s.id}
      style={{ border: '1px solid #DCDDDD', borderRadius: 12 }}
      styles={{ body: { padding: 14 } }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: '#003378', wordBreak: 'break-all' }}>
            {s.title || s.reportName || `报表 #${s.targetId}`}
          </div>
          <div style={{ fontSize: 11.5, color: '#B5B5B6', marginTop: 2 }}>{fmtTime(s.createdAt, 'YYYY-MM-DD HH:mm')} 创建</div>
        </div>
        {statusTag(s)}
      </div>

      <div
        style={{
          marginTop: 10,
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
          fontSize: 12,
          color: 'rgba(0,51,120,.6)',
        }}
      >
        <span>
          <EyeOutlined /> {fmtNum(s.viewCount || 0)} 次访问
        </span>
        <span>{s.expiresAt ? `至 ${fmtTime(s.expiresAt, 'YYYY-MM-DD')}` : '永久有效'}</span>
        {s.hasPassword && (
          <span style={{ color: '#FFC000' }}>
            <LockOutlined /> 有密码
          </span>
        )}
      </div>

      <div
        style={{
          marginTop: 10,
          padding: '6px 8px',
          background: 'rgba(54,135,255,.06)',
          borderRadius: 6,
          fontSize: 11.5,
          color: 'rgba(0,51,120,.7)',
          wordBreak: 'break-all',
        }}
      >
        /s/{s.token}
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button size="middle" icon={<CopyOutlined />} onClick={() => copyLink(s)} style={{ minHeight: 44 }}>
          复制
        </Button>
        <Button size="middle" icon={<LinkOutlined />} onClick={() => window.open(shareUrlOf(s), '_blank')} style={{ minHeight: 44 }}>
          打开
        </Button>
        {canWrite && (
          <>
            <Button
              size="middle"
              onClick={() => handleToggle(s, Number(s.status) !== 1)}
              style={{ minHeight: 44 }}
            >
              {Number(s.status) === 1 ? '停用' : '启用'}
            </Button>
            <Button danger size="middle" icon={<DeleteOutlined />} onClick={() => handleDelete(s)} style={{ minHeight: 44 }}>
              删除
            </Button>
          </>
        )}
      </div>
    </Card>
  );

  return (
    <Page
      title="分享管理"
      subTitle="将报表以链接形式对外公开，可设置有效期与访问密码"
      extra={
        <Space wrap size={8}>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            刷新
          </Button>
          {canWrite && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>
              创建分享
            </Button>
          )}
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="公开分享需要在「系统设置 → 安全」中开启「允许公开分享」；分享链接无需登录即可访问。"
      />

      <Card styles={{ body: { padding: 12 } }} style={{ border: '1px solid #DCDDDD', borderRadius: 10, marginBottom: 14 }}>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 10 }}>
          <Input.Search
            allowClear
            placeholder="搜索标题 / 报表名 / token"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            size={isMobile ? 'large' : 'middle'}
            style={{ flex: 1 }}
          />
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: isMobile ? '100%' : 150 }}
            size={isMobile ? 'large' : 'middle'}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'active', label: '生效中' },
              { value: 'disabled', label: '已停用' },
              { value: 'expired', label: '已过期' },
            ]}
          />
        </div>
      </Card>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center' }}>
          <Spin size="large" />
        </div>
      ) : filtered.length === 0 ? (
        <Card style={{ border: '1px dashed #DCDDDD', borderRadius: 12 }}>
          <Empty description={keyword || statusFilter !== 'all' ? '没有符合条件的分享' : '还没有创建分享链接'}>
            {canWrite && <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>创建第一个分享</Button>}
          </Empty>
        </Card>
      ) : isMobile ? (
        <Row gutter={[10, 10]}>
          {filtered.map((s) => (
            <Col xs={24} key={s.id}>
              {renderCard(s)}
            </Col>
          ))}
        </Row>
      ) : (
        <Card styles={{ body: { padding: 0 } }} style={{ border: '1px solid #DCDDDD', borderRadius: 12, overflow: 'hidden' }}>
          <ProTable<ShareItem>
            rowKey="id"
            columns={columns}
            dataSource={filtered}
            search={false}
            options={{ reload: false, density: false, setting: false }}
            toolBarRender={false}
            scroll={{ x: 'max-content' }}
            pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 个分享` }}
          />
        </Card>
      )}

      {/* 创建分享 */}
      <Modal
        title={created ? '分享链接已创建' : '创建分享'}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        footer={
          created ? (
            <Space>
              <Button onClick={() => setCreateOpen(false)}>关闭</Button>
              <Button type="primary" icon={<CopyOutlined />} onClick={() => copyLink(created)}>
                复制链接
              </Button>
            </Space>
          ) : (
            <Space>
              <Button onClick={() => setCreateOpen(false)}>取消</Button>
              <Button type="primary" loading={creating} onClick={submit} icon={<ShareAltOutlined />}>
                创建分享
              </Button>
            </Space>
          )
        }
        width={isMobile ? '92vw' : 540}
        destroyOnHidden
      >
        {created ? (
          <Result
            status="success"
            title="创建成功"
            subTitle={
              <div style={{ marginTop: 8 }}>
                <Paragraph copyable={{ text: shareUrlOf(created) }} style={{ marginBottom: 6, wordBreak: 'break-all', fontSize: 12.5 }}>
                  {shareUrlOf(created)}
                </Paragraph>
                <Space size={6} wrap>
                  <Tag bordered={false} color="#3687FF" style={{ color: '#FFFFFF' }}>
                    {created.expiresAt ? `有效期至 ${fmtTime(created.expiresAt, 'YYYY-MM-DD')}` : '永久有效'}
                  </Tag>
                  {created.hasPassword && <Tag color="#FFC000">需要访问密码</Tag>}
                  {created.allowExport && <Tag color="#A2D73C">允许导出</Tag>}
                </Space>
              </div>
            }
            extra={[
              <Button key="open" icon={<LinkOutlined />} onClick={() => window.open(shareUrlOf(created), '_blank')}>
                打开预览
              </Button>,
              <Button key="copy" type="primary" icon={<CopyOutlined />} onClick={() => copyLink(created)}>
                复制链接
              </Button>,
            ]}
          />
        ) : (
          <Form form={form} layout="vertical" requiredMark={false} style={{ marginTop: 12 }}>
            <Form.Item name="targetId" label="分享对象（报表）" rules={[{ required: true, message: '请选择要分享的报表' }]}>
              <Select
                size="large"
                showSearch
                optionFilterProp="label"
                placeholder="选择报表"
                options={reports.map((r) => ({ value: r.id, label: `${r.name}${r.category ? `（${r.category}）` : ''}` }))}
                notFoundContent={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无报表" />}
              />
            </Form.Item>
            <Form.Item name="title" label="分享标题" extra="留空则使用报表名称">
              <Input size="large" maxLength={60} placeholder="对外展示的标题" />
            </Form.Item>
            <Form.Item name="expiresDays" label="有效期">
              <Select
                size="large"
                allowClear
                placeholder="永久有效"
                options={EXPIRE_OPTIONS}
              />
            </Form.Item>
            <Form.Item name="password" label="访问密码" extra="设置后访问者需先输入密码（可选）">
              <Input.Password size="large" maxLength={32} placeholder="留空表示无密码" autoComplete="new-password" />
            </Form.Item>
            <Form.Item name="allowExport" label="允许导出" valuePropName="checked">
              <Switch />
            </Form.Item>
            <div style={{ fontSize: 12, color: 'rgba(0,51,120,.5)' }}>
              提示：分享链接格式为 <Text code>/s/&lt;token&gt;</Text>，可在分享管理中随时停用或删除。
            </div>
          </Form>
        )}
      </Modal>

      {/* 快捷入口 */}
      {!isMobile && reports.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'rgba(0,51,120,.5)' }}>
          也可以从报表中心的「分享」按钮直接生成 7 天有效链接。{' '}
          <Button type="link" size="small" onClick={() => navigate('/reports')}>
            去报表中心
          </Button>
        </div>
      )}
    </Page>
  );
}
