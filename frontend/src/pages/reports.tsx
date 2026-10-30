/**
 * 报表中心
 * - 卡片视图 / 表格视图（ProTable）切换
 * - 关键词、类型、分类筛选；新建报表、查看、设计、分享、启停、删除
 * - 移动端（<768px）：卡片单列 + 触控目标 ≥44px
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
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
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  BarChartOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
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
const { Text } = Typography;

const TYPE_META: Record<string, { label: string; color: string }> = {
  chart: { label: '图表', color: '#3687FF' },
  table: { label: '表格', color: '#73DBFF' },
  dashboard: { label: '看板', color: '#A2D73C' },
};

function typeMeta(t: string) {
  return TYPE_META[t] || { label: t || '图表', color: '#B5B5B6' };
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const { message, modal } = AntApp.useApp();
  const { can } = useAppStore();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [reports, setReports] = useState<ReportItem[]>([]);
  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [loading, setLoading] = useState(true);
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
    try {
      const [list, ds] = await Promise.all([
        listReports(),
        canWrite ? listDatasets().catch(() => [] as DatasetItem[]) : Promise.resolve([] as DatasetItem[]),
      ]);
      setReports(list || []);
      setDatasets(ds || []);
    } catch {
      setReports([]);
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
      if (typeFilter !== 'all' && r.reportType !== typeFilter) return false;
      if (categoryFilter !== 'all' && (r.category || '') !== categoryFilter) return false;
      if (!kw) return true;
      return [r.name, r.code, r.description, r.category, r.datasetName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(kw));
    });
  }, [reports, keyword, typeFilter, categoryFilter]);

  const stats = useMemo(() => {
    const total = reports.length;
    const shared = reports.filter((r) => (r.shareCount || 0) > 0).length;
    const views = reports.reduce((s, r) => s + (r.viewCount || 0), 0);
    return { total, shared, views };
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
      render: (_, r) => (
        <div style={{ minWidth: 0 }}>
          <a onClick={() => navigate(`/reports/${r.id}/view`)} style={{ fontWeight: 600, fontSize: 13.5 }}>
            {r.name}
          </a>
          <div style={{ fontSize: 11.5, color: '#B5B5B6' }}>
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
      render: (_, r) => {
        const m = typeMeta(r.reportType);
        return (
          <Tag color={m.color} bordered={false} style={{ color: '#FFFFFF', marginInlineEnd: 0 }}>
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
      width: 80,
      align: 'right',
      render: (_, r) => fmtNum(r.viewCount || 0),
    },
    {
      title: '分享',
      dataIndex: 'shareCount',
      width: 80,
      align: 'center',
      render: (_, r) => (
        <Badge count={r.shareCount || 0} showZero={false} color="#3687FF" />
      ),
    },
    {
      title: '启用',
      dataIndex: 'status',
      width: 70,
      align: 'center',
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
      render: (_, r) => (
        <Tooltip title={fmtTime(r.updatedAt)}>
          <span style={{ fontSize: 12, color: 'rgba(0,51,120,.55)' }}>{fmtAgo(r.updatedAt)}</span>
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
          <a key="del" style={{ color: '#E86161' }} onClick={() => handleDelete(r)}>
            删除
          </a>
        ) : null,
      ],
    },
  ];

  const renderCard = (r: ReportItem) => {
    const m = typeMeta(r.reportType);
    return (
      <Card
        key={r.id}
        hoverable
        style={{ border: '1px solid #DCDDDD', borderRadius: 12, height: '100%', overflow: 'hidden' }}
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
              background: `linear-gradient(135deg, ${m.color}, #003378)`,
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 17,
            }}
          >
            {r.reportType === 'table' ? <TableOutlined /> : <BarChartOutlined />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: '#003378', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.name}
            </div>
            <div style={{ fontSize: 11.5, color: '#B5B5B6', marginTop: 2 }}>
              {r.code}
              {r.category ? ` · ${r.category}` : ''}
            </div>
          </div>
          <Tag color={m.color} bordered={false} style={{ color: '#FFFFFF', marginInlineEnd: 0 }}>
            {m.label}
          </Tag>
        </div>

        <div
          style={{
            marginTop: 10,
            fontSize: 12.5,
            color: 'rgba(0,51,120,.6)',
            minHeight: 36,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {r.description || '暂无描述'}
        </div>

        <div style={{ marginTop: 10, display: 'flex', gap: 14, fontSize: 12, color: 'rgba(0,51,120,.55)', flexWrap: 'wrap' }}>
          <span>
            <EyeOutlined /> {fmtNum(r.viewCount || 0)}
          </span>
          <span>
            <ShareAltOutlined /> {fmtNum(r.shareCount || 0)}
          </span>
          <span>
            <ClockCircleOutlined /> {fmtAgo(r.updatedAt)}
          </span>
          {Number(r.status) !== 1 && <Tag color="#B5B5B6">已停用</Tag>}
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
      subTitle="数据集驱动的图表与表格报表，支持分享与对外发布"
      extra={
        <Space wrap size={8}>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            刷新
          </Button>
          {canWrite && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建报表
            </Button>
          )}
        </Space>
      }
    >
      {/* 统计条 */}
      <Row gutter={[10, 10]} style={{ marginBottom: 14 }}>
        {[
          { label: '报表总数', value: stats.total, color: '#3687FF' },
          { label: '已分享', value: stats.shared, color: '#45B4FF' },
          { label: '累计浏览', value: stats.views, color: '#A2D73C' },
        ].map((s) => (
          <Col xs={8} key={s.label}>
            <Card styles={{ body: { padding: isMobile ? '10px 12px' : '14px 16px' } }} style={{ border: '1px solid #DCDDDD', borderRadius: 10 }}>
              <div style={{ fontSize: 11.5, color: 'rgba(0,51,120,.55)' }}>{s.label}</div>
              <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, color: s.color, lineHeight: 1.3 }}>
                {fmtNum(s.value)}
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* 工具栏 */}
      <Card styles={{ body: { padding: 12 } }} style={{ border: '1px solid #DCDDDD', borderRadius: 10, marginBottom: 14 }}>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 10, alignItems: isMobile ? 'stretch' : 'center' }}>
          <Input.Search
            allowClear
            placeholder="搜索报表名称 / 编码 / 分类"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ flex: 1, minWidth: 180 }}
            size={isMobile ? 'large' : 'middle'}
          />
          <Space wrap size={8}>
            <Select
              value={typeFilter}
              onChange={setTypeFilter}
              style={{ width: 120 }}
              size={isMobile ? 'large' : 'middle'}
              options={[
                { value: 'all', label: '全部类型' },
                { value: 'chart', label: '图表' },
                { value: 'table', label: '表格' },
                { value: 'dashboard', label: '看板' },
              ]}
            />
            <Select
              value={categoryFilter}
              onChange={setCategoryFilter}
              style={{ width: 130 }}
              size={isMobile ? 'large' : 'middle'}
              options={[{ value: 'all', label: '全部分类' }, ...categories.map((c) => ({ value: c, label: c }))]}
            />
            <Segmented
              value={viewMode}
              onChange={(v) => setViewMode(v as 'card' | 'table')}
              size={isMobile ? 'middle' : 'middle'}
              options={[
                { value: 'card', icon: <AppstoreOutlined />, label: isMobile ? '' : '卡片' },
                { value: 'table', icon: <UnorderedListOutlined />, label: isMobile ? '' : '表格' },
              ]}
            />
          </Space>
        </div>
      </Card>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center' }}>
          <Spin size="large" />
        </div>
      ) : filtered.length === 0 ? (
        <Card style={{ border: '1px dashed #DCDDDD', borderRadius: 12 }}>
          <Empty description={keyword || typeFilter !== 'all' || categoryFilter !== 'all' ? '没有符合条件的报表' : '还没有报表'}>
            {canWrite && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新建第一个报表
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
        <Card styles={{ body: { padding: 0 } }} style={{ border: '1px solid #DCDDDD', borderRadius: 12, overflow: 'hidden' }}>
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
