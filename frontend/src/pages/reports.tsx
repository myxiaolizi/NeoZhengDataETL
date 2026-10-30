/**
 * 报表中心（V4.1 统一规范）
 * - Page 标准结构：title="报表中心" + search + actions(新建报表) + subTabs(类型子标签) + stats(5个数据卡片) + 列表/卡片
 * - 系统内置看板（客户签约看板等预置报表，直接查看、不参与增删改）
 * - 卡片视图 / 表格视图（ProTable）切换
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Grid,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Tooltip,
} from 'antd';
import {
  BarChartOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FundOutlined,
  PlusOutlined,
  ReloadOutlined,
  ShareAltOutlined,
  TableOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { useNavigate } from 'react-router-dom';
import Page from '@/components/Page';
import type { StatCardItem } from '@/components/StatCards';
import { NEUTRAL, PALETTE, SIDER } from '@/theme';
import { useAppStore } from '@/stores/app';
import { copyText, fmtAgo, fmtNum, fmtTime } from '@/utils';
import {
  createReport,
  createShare,
  deleteReport,
  listDatasets,
  listReports,
  shareUrlOf,
  updateReport,
  type DatasetItem,
  type ReportItem,
} from '@/api/reports';

const { useBreakpoint } = Grid;

const TYPE_META: Record<string, { label: string; color: string }> = {
  chart: { label: '图表', color: PALETTE.primary },
  table: { label: '表格', color: PALETTE.cyan },
  dashboard: { label: '看板', color: PALETTE.green },
};

function typeMeta(t: string) {
  return TYPE_META[t] || { label: t || '图表', color: PALETTE.gray };
}

/** 系统内置看板条目 */
interface BuiltinBoard {
  key: string;
  name: string;
  desc: string;
  path: string;
  color: string;
  tags: string[];
}

/**
 * 系统内置看板：由后端实时聚合、无需配置的预置报表。
 * 它们不属于「我的报表」，因此在报表中心单独成区块，点击直接进入看板页。
 */
const BUILTIN_BOARDS: BuiltinBoard[] = [
  {
    key: 'crm',
    name: '客户签约看板',
    desc: '从客户签约项目实时聚合：签约总数、门店覆盖、区域 / 类型分布、销售排行与签约明细。',
    path: '/dashboard/crm',
    color: PALETTE.primary,
    tags: ['看板', 'CRM'],
  },
];

export default function ReportsPage() {
  const navigate = useNavigate();
  const { message, modal } = AntApp.useApp();
  const { can } = useAppStore();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [reports, setReports] = useState<ReportItem[]>([]);
  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  const canWrite = can('report:write');
  const canShare = can(['share:write', 'share:read']);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [list, ds] = await Promise.all([
        listReports(),
        canWrite ? listDatasets().catch(() => [] as DatasetItem[]) : Promise.resolve([] as DatasetItem[]),
      ]);
      setReports(list || []);
      setDatasets(ds || []);
    } catch (e) {
      setReports([]);
      setLoadError(e instanceof Error ? e.message : '加载报表列表失败');
    } finally {
      setLoading(false);
    }
  }, [canWrite]);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    reports.forEach((r) => {
      if (r.category) set.add(r.category);
    });
    return Array.from(set);
  }, [reports]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return reports.filter((r) => {
      if (typeFilter === 'builtin') return false;
      if (typeFilter !== 'all' && r.reportType !== typeFilter) return false;
      if (categoryFilter !== 'all' && (r.category || '') !== categoryFilter) return false;
      if (!kw) return true;
      return [r.name, r.code, r.description, r.category, r.datasetName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(kw));
    });
  }, [reports, keyword, typeFilter, categoryFilter]);

  /** 内置看板同样响应筛选：类型选「全部 / 看板 / 内置看板」、或关键词命中时才显示 */
  const builtinBoards = useMemo(() => {
    if (typeFilter !== 'all' && typeFilter !== 'dashboard' && typeFilter !== 'builtin') return [];
    if (categoryFilter !== 'all') return [];
    const kw = keyword.trim().toLowerCase();
    if (!kw) return BUILTIN_BOARDS.slice();
    return BUILTIN_BOARDS.filter((b) =>
      [b.name, b.desc, ...b.tags].filter(Boolean).some((v) => String(v).toLowerCase().includes(kw))
    );
  }, [keyword, typeFilter, categoryFilter]);

  /** V4.1 数据卡片（5 个：报表数 / 已发布 / 本月访问 / 分享数 / 看板数） */
  const statItems = useMemo<StatCardItem[]>(() => {
    const total = reports.length;
    const published = reports.filter((r) => Number(r.status) === 1).length;
    const views = reports.reduce((s, r) => s + (r.viewCount || 0), 0);
    const shares = reports.reduce((s, r) => s + (r.shareCount || 0), 0);
    const boards = BUILTIN_BOARDS.length + reports.filter((r) => r.reportType === 'dashboard').length;

    return [
      {
        key: 'total',
        label: '报表数',
        value: fmtNum(total),
        suffix: '个',
        color: PALETTE.primary,
        onClick: () => setTypeFilter('all'),
      },
      {
        key: 'published',
        label: '已发布',
        value: fmtNum(published),
        suffix: '个',
        color: PALETTE.green,
        hint: total > 0 ? `启用率 ${Math.round((published / total) * 100)}%` : undefined,
      },
      {
        key: 'views',
        label: '本月访问',
        value: fmtNum(views),
        suffix: '次',
        color: PALETTE.cyan,
      },
      {
        key: 'shares',
        label: '分享数',
        value: fmtNum(shares),
        suffix: '个',
        color: PALETTE.yellow,
      },
      {
        key: 'boards',
        label: '看板数',
        value: fmtNum(boards),
        suffix: '个',
        color: PALETTE.violet,
        hint: `含预置看板 ${BUILTIN_BOARDS.length} 个`,
        onClick: () => setTypeFilter('dashboard'),
      },
    ];
  }, [reports]);

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({ reportType: 'chart' });
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreating(true);
      const report = await createReport({
        name: values.name,
        description: values.description,
        category: values.category,
        reportType: values.reportType,
        datasetId: values.datasetId || null,
        config: { chartType: values.reportType === 'table' ? 'table' : 'bar', height: 360 },
      });
      message.success('报表已创建，开始配置图表');
      setCreateOpen(false);
      navigate(`/reports/${report.id}/design`);
    } catch (e) {
      if ((e as { errorFields?: unknown }).errorFields) return;
    } finally {
      setCreating(false);
    }
  };

  const handleToggleStatus = async (item: ReportItem, checked: boolean) => {
    try {
      await updateReport(item.id, { status: checked ? 1 : 0 });
      setReports((prev) => prev.map((r) => (r.id === item.id ? { ...r, status: checked ? 1 : 0 } : r)));
      message.success(checked ? '报表已启用' : '报表已停用');
    } catch {
      /* client 已提示 */
    }
  };

  const handleDelete = (item: ReportItem) => {
    modal.confirm({
      title: `删除报表「${item.name}」？`,
      content: '删除后该报表的分享链接会一并失效，且不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await deleteReport(item.id);
        message.success('报表已删除');
        setReports((prev) => prev.filter((r) => r.id !== item.id));
      },
    });
  };

  /** 快捷分享：创建 7 天有效期链接并复制 */
  const handleShare = async (item: ReportItem) => {
    try {
      const share = await createShare({ targetType: 'report', targetId: item.id, expiresDays: 7, title: item.name });
      const ok = await copyText(shareUrlOf(share));
      message.success(ok ? '分享链接已复制（7 天有效）' : '分享已创建，可在分享管理中复制链接');
      setReports((prev) => prev.map((r) => (r.id === item.id ? { ...r, shareCount: (r.shareCount || 0) + 1 } : r)));
    } catch {
      /* client 已提示 */
    }
  };

  const columns: ProColumns<ReportItem>[] = [
    {
      title: '报表',
      dataIndex: 'name',
      sorter: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
      render: (_, r) => (
        <div style={{ minWidth: 0 }}>
          <a onClick={() => navigate(`/reports/${r.id}/view`)} style={{ fontWeight: 600, fontSize: 13.5 }}>
            {r.name}
          </a>
          <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary }}>
            {r.code}
            {r.description ? ` · ${r.description}` : ''}
          </div>
        </div>
      ),
    },
    {
      title: '类型',
      dataIndex: 'reportType',
      width: 88,
      sorter: (a, b) => String(a.reportType || '').localeCompare(String(b.reportType || '')),
      render: (_, r) => {
        const m = typeMeta(r.reportType);
        return (
          <Tag color={m.color} bordered={false} style={{ color: NEUTRAL.textInverse, marginInlineEnd: 0 }}>
            {m.label}
          </Tag>
        );
      },
    },
    { title: '分类', dataIndex: 'category', width: 110, render: (v) => (v ? <Tag bordered={false}>{String(v)}</Tag> : '-') },
    { title: '数据集', dataIndex: 'datasetName', width: 150, ellipsis: true, render: (v) => v || '-' },
    {
      title: '浏览',
      dataIndex: 'viewCount',
      width: 85,
      align: 'right',
      sorter: (a, b) => Number(a.viewCount || 0) - Number(b.viewCount || 0),
      render: (_, r) => fmtNum(r.viewCount || 0),
    },
    {
      title: '分享',
      dataIndex: 'shareCount',
      width: 85,
      align: 'center',
      sorter: (a, b) => Number(a.shareCount || 0) - Number(b.shareCount || 0),
      render: (_, r) => (
        <Badge count={r.shareCount || 0} showZero={false} color={PALETTE.primary} />
      ),
    },
    {
      title: '启用',
      dataIndex: 'status',
      width: 75,
      align: 'center',
      sorter: (a, b) => Number(a.status || 0) - Number(b.status || 0),
      render: (_, r) => (
        <Switch
          size="small"
          checked={Number(r.status) === 1}
          disabled={!canWrite}
          onChange={(v) => handleToggleStatus(r, v)}
        />
      ),
    },
    {
      title: '最近更新',
      dataIndex: 'updatedAt',
      width: 140,
      sorter: (a, b) => new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime(),
      render: (_, r) => (
        <Tooltip title={fmtTime(r.updatedAt)}>
          <span style={{ fontSize: 12, color: NEUTRAL.textSecondary }}>{fmtAgo(r.updatedAt)}</span>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 190,
      fixed: 'right',
      render: (_, r) => [
        <a key="view" onClick={() => navigate(`/reports/${r.id}/view`)}>
          查看
        </a>,
        canWrite ? (
          <a key="design" onClick={() => navigate(`/reports/${r.id}/design`)}>
            设计
          </a>
        ) : null,
        canShare ? (
          <a key="share" onClick={() => handleShare(r)}>
            分享
          </a>
        ) : null,
        canWrite ? (
          <a key="del" style={{ color: PALETTE.red }} onClick={() => handleDelete(r)}>
            删除
          </a>
        ) : null,
      ],
    },
  ];

  /** 内置看板卡片：整体可点击，与「我的报表」卡片同一视觉体系 */
  const renderBuiltin = (b: BuiltinBoard) => (
    <Card
      key={b.key}
      hoverable
      style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12, height: '100%', overflow: 'hidden' }}
      styles={{ body: { padding: 16 } }}
      onClick={() => navigate(b.path)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div
          style={{
            width: 38,
            height: 38,
            flex: '0 0 38px',
            borderRadius: 10,
            background: `linear-gradient(135deg, ${b.color}, ${SIDER.bgTo})`,
            color: NEUTRAL.textInverse,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 17,
          }}
        >
          <FundOutlined />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: NEUTRAL.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {b.name}
          </div>
          <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary, marginTop: 2 }}>系统预置 · 数据实时聚合</div>
        </div>
        <Tag color={PALETTE.cyan} bordered={false} style={{ color: NEUTRAL.textInverse, marginInlineEnd: 0 }}>
          看板
        </Tag>
      </div>

      <div
        style={{
          marginTop: 10,
          fontSize: 12.5,
          color: NEUTRAL.textSecondary,
          minHeight: 36,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {b.desc}
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {b.tags.map((t) => (
          <Tag key={t} bordered={false} style={{ marginInlineEnd: 0, background: NEUTRAL.surfaceSunken, color: PALETTE.primary }}>
            {t}
          </Tag>
        ))}
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
        <Button
          type="primary"
          size={isMobile ? 'middle' : 'small'}
          icon={<FundOutlined />}
          onClick={() => navigate(b.path)}
          style={{ minHeight: 32 }}
        >
          打开看板
        </Button>
      </div>
    </Card>
  );

  const renderCard = (r: ReportItem) => {
    const m = typeMeta(r.reportType);
    return (
      <Card
        key={r.id}
        hoverable
        style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12, height: '100%', overflow: 'hidden' }}
        styles={{ body: { padding: 16 } }}
        onClick={() => navigate(`/reports/${r.id}/view`)}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div
            style={{
              width: 38,
              height: 38,
              flex: '0 0 38px',
              borderRadius: 10,
              background: `linear-gradient(135deg, ${m.color}, ${SIDER.bgTo})`,
              color: NEUTRAL.textInverse,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 17,
            }}
          >
            {r.reportType === 'table' ? <TableOutlined /> : <BarChartOutlined />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: NEUTRAL.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.name}
            </div>
            <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary, marginTop: 2 }}>
              {r.code}
              {r.category ? ` · ${r.category}` : ''}
            </div>
          </div>
          <Tag color={m.color} bordered={false} style={{ color: NEUTRAL.textInverse, marginInlineEnd: 0 }}>
            {m.label}
          </Tag>
        </div>

        <div
          style={{
            marginTop: 10,
            fontSize: 12.5,
            color: NEUTRAL.textSecondary,
            minHeight: 36,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {r.description || '暂无描述'}
        </div>

        <div style={{ marginTop: 10, display: 'flex', gap: 14, fontSize: 12, color: NEUTRAL.textSecondary, flexWrap: 'wrap' }}>
          <span>
            <EyeOutlined /> {fmtNum(r.viewCount || 0)}
          </span>
          <span>
            <ShareAltOutlined /> {fmtNum(r.shareCount || 0)}
          </span>
          <span>
            <ClockCircleOutlined /> {fmtAgo(r.updatedAt)}
          </span>
          {Number(r.status) !== 1 && <Tag color={PALETTE.gray}>已停用</Tag>}
        </div>

        <div
          style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}
          onClick={(e) => e.stopPropagation()}
        >
          <Button size={isMobile ? 'middle' : 'small'} onClick={() => navigate(`/reports/${r.id}/view`)} style={{ minHeight: 32 }}>
            查看
          </Button>
          {canWrite && (
            <Button
              size={isMobile ? 'middle' : 'small'}
              icon={<EditOutlined />}
              onClick={() => navigate(`/reports/${r.id}/design`)}
              style={{ minHeight: 32 }}
            >
              设计
            </Button>
          )}
          {canShare && (
            <Button size={isMobile ? 'middle' : 'small'} icon={<ShareAltOutlined />} onClick={() => handleShare(r)} style={{ minHeight: 32 }}>
              分享
            </Button>
          )}
          {canWrite && (
            <Button
              size={isMobile ? 'middle' : 'small'}
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(r)}
              style={{ minHeight: 32 }}
            >
              删除
            </Button>
          )}
        </div>
      </Card>
    );
  };

  return (
    <Page
      title="报表中心"
      search={
        <>
          <Select
            value={categoryFilter}
            onChange={setCategoryFilter}
            style={{ width: isMobile ? 120 : 140 }}
            options={[{ value: 'all', label: '全部分类' }, ...categories.map((c) => ({ value: c, label: c }))]}
          />
          <Input.Search
            allowClear
            placeholder="搜索报表名称 / 编码 / 分类"
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
            新建报表
          </Button>
        ) : undefined
      }
      extra={
        <Space wrap size={8}>
          <Segmented
            value={viewMode}
            onChange={(v) => setViewMode(v as 'card' | 'table')}
            options={[
              { value: 'card', icon: <AppstoreOutlined />, label: isMobile ? '' : '卡片' },
              { value: 'table', icon: <UnorderedListOutlined />, label: isMobile ? '' : '表格' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            刷新
          </Button>
        </Space>
      }
      subTabs={
        <Tabs
          activeKey={typeFilter}
          onChange={setTypeFilter}
          items={[
            { key: 'all', label: '全部报表' },
            { key: 'chart', label: '图表报表' },
            { key: 'table', label: '表格报表' },
            { key: 'dashboard', label: '数据看板' },
            { key: 'builtin', label: `系统内置看板（${BUILTIN_BOARDS.length}）` },
          ]}
        />
      }
      stats={statItems}
    >
      {loadError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          title="加载报表列表失败"
          description={loadError}
          action={
            <Button size="small" onClick={load}>
              重试
            </Button>
          }
        />
      )}

      {/* 系统内置看板：预置报表，点击直接进入看板页 */}
      {builtinBoards.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: isMobile ? 13.5 : 14.5, fontWeight: 700, color: NEUTRAL.text }}>系统内置看板</span>
            <span style={{ fontSize: 12, color: NEUTRAL.textTertiary }}>预置报表，直接查看，无需配置</span>
          </div>
          <Row gutter={[12, 12]}>
            {builtinBoards.map((b) => (
              <Col xs={24} sm={12} lg={8} xxl={6} key={b.key}>
                {renderBuiltin(b)}
              </Col>
            ))}
          </Row>
        </div>
      )}

      {/* 我的报表 */}
      {typeFilter !== 'builtin' && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: isMobile ? 13.5 : 14.5, fontWeight: 700, color: NEUTRAL.text }}>我的报表</span>
            <span style={{ fontSize: 12, color: NEUTRAL.textTertiary }}>共 {fmtNum(filtered.length)} 个</span>
          </div>

          {loading ? (
            <div style={{ padding: 60, textAlign: 'center' }}>
              <Spin size="large" />
            </div>
          ) : filtered.length === 0 ? (
            <Card style={{ border: `1px dashed ${NEUTRAL.border}`, borderRadius: 12 }}>
              <Empty
                description={
                  keyword || typeFilter !== 'all' || categoryFilter !== 'all'
                    ? '没有符合条件的自建报表'
                    : builtinBoards.length > 0
                      ? '还没有自建报表，可先从上方的内置看板开始'
                      : '还没有报表'
                }
              >
                {canWrite && (
                  <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                    {reports.length ? '新建报表' : '新建第一个报表'}
                  </Button>
                )}
              </Empty>
            </Card>
          ) : viewMode === 'card' || isMobile ? (
            <Row gutter={[12, 12]}>
              {filtered.map((r) => (
                <Col xs={24} sm={12} lg={8} xxl={6} key={r.id}>
                  {renderCard(r)}
                </Col>
              ))}
            </Row>
          ) : (
            <Card styles={{ body: { padding: 0 } }} style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <ProTable<ReportItem>
                rowKey="id"
                columns={columns}
                dataSource={filtered}
                search={false}
                options={{ reload: false, density: false, setting: false }}
                toolBarRender={false}
                scroll={{ x: 'max-content' }}
                pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 个报表` }}
              />
            </Card>
          )}
        </>
      )}

      {/* 新建报表 */}
      <Modal
        title="新建报表"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={submitCreate}
        confirmLoading={creating}
        okText="创建并配置"
        cancelText="取消"
        width={isMobile ? '92vw' : 520}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false} style={{ marginTop: 12 }}>
          <Form.Item name="name" label="报表名称" rules={[{ required: true, message: '请输入报表名称' }]}>
            <Input placeholder="如：客户签约趋势" size="large" maxLength={60} />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Input placeholder="如：CRM / 销售（可选）" size="large" maxLength={40} />
          </Form.Item>
          <Form.Item name="reportType" label="报表类型" rules={[{ required: true }]}>
            <Select
              size="large"
              options={[
                { value: 'chart', label: '图表报表（柱状 / 折线 / 饼图 …）' },
                { value: 'table', label: '表格报表' },
              ]}
            />
          </Form.Item>
          <Form.Item name="datasetId" label="数据集" extra="创建后仍可在设计器中更换">
            <Select
              size="large"
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="选择数据集（可稍后选择）"
              options={datasets.map((d) => ({ value: d.id, label: `${d.name}（${d.sourceType || 'sql'}）` }))}
            />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} maxLength={200} showCount placeholder="用于解释报表口径（可选）" />
          </Form.Item>
        </Form>
      </Modal>
    </Page>
  );
}
