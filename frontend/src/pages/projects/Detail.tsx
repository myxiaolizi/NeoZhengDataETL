/** 项目详情：概览 / 字段配置 / 推送日志 / 数据明细（Tabs）
 *
 * 数据来源：
 *   GET /api/projects/:id                项目详情（project/columns/parsedColumns/stats/fieldDefs/subTables）
 *   GET /api/projects/:id/fields         字段定义（由 FieldsPanel 负责）
 *   GET /api/projects/:id/logs           推送日志（分页 + op/result/keyword 过滤）
 *   GET /api/projects/:id/parsed         解析后数据（分页 + 关键字）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, App, Button, Card, Col, Descriptions, Drawer, Empty, Grid, Input, Row, Select,
  Space, Statistic, Table, Tabs, Tag, Tooltip, Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CopyOutlined, DatabaseOutlined, KeyOutlined, ReloadOutlined, TableOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import Page from '@/components/Page';
import { useAppStore, usePermission } from '@/stores/app';
import {
  cellText, clearProjectLogs, fetchParsedRecords, fetchProject, fetchProjectLogs,
  pushUrlOf, regenerateToken,
} from '@/api/projects';
import type {
  DataRow, ProjectColumnInfo, ProjectDetailData, ProjectLogRow, ProjectParsedData,
} from '@/api/projects';
import { copyText, fmtAgo, fmtNum, fmtTime } from '@/utils';
import { FieldsPanel } from './Fields';

const { useBreakpoint } = Grid;
const { Text, Paragraph } = Typography;

/** 数据表内部列：不展示给用户 */
const INTERNAL_COLS = new Set([
  'id', 'raw_json', 'jdy_op', 'jdy_op_time', 'received_at', 'updated_at',
]);

/* ══════════════ 概览 Tab ══════════════ */

function OverviewTab({
  detail, isMobile, onRefresh,
}: {
  detail: ProjectDetailData;
  isMobile: boolean;
  onRefresh: () => void;
}) {
  const { message } = App.useApp();
  const can = usePermission();
  const [regenerating, setRegenerating] = useState(false);
  const project = detail.project;
  const stats = detail.stats;
  const pushUrl = pushUrlOf(project);

  const copy = async (text: string, label: string) => {
    const ok = await copyText(text);
    if (ok) message.success(`${label}已复制`);
    else message.error('复制失败，请手动选择复制');
  };

  const onRegenerate = async () => {
    setRegenerating(true);
    try {
      await regenerateToken(project.id);
      message.success('令牌已重新生成，请复制新的推送地址并更新到简道云');
      onRefresh();
    } catch { /* 已 toast */ } finally {
      setRegenerating(false);
    }
  };

  return (
    <div>
      <Row gutter={[12, 12]}>
        {[
          { title: '数据记录', value: stats.dataTotal, color: '#2D6FE4', hint: `今日 +${fmtNum(stats.dataToday)}` },
          { title: '接收日志', value: stats.logTotal, color: '#45B4FF', hint: `失败 ${fmtNum(stats.logFailed)}` },
          { title: '字段定义', value: detail.fieldDefs.length, color: '#A2D73C', hint: `数据列 ${detail.columns.length}` },
          { title: '子表', value: detail.subTables.length, color: '#EC673C', hint: `解析列 ${detail.parsedColumns.length}` },
        ].map((k) => (
          <Col key={k.title} xs={12} md={6}>
            <Card variant="outlined" style={{ borderColor: '#DCDDDD', borderRadius: 12 }} styles={{ body: { padding: isMobile ? 12 : 16 } }}>
              <Statistic
                title={<span style={{ fontSize: 12.5, color: 'rgba(0,51,120,.55)' }}>{k.title}</span>}
                value={k.value}
                styles={{ content: { color: k.color, fontSize: isMobile ? 20 : 24, fontWeight: 700 } }}
              />
              <div style={{ fontSize: 11.5, color: '#B5B5B6', marginTop: 2 }}>{k.hint}</div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} lg={14}>
          <Card
            variant="outlined"
            style={{ borderColor: '#DCDDDD', borderRadius: 12, height: '100%' }}
            styles={{ body: { padding: isMobile ? 12 : 16 } }}
            title={<span style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>项目信息</span>}
          >
            <Descriptions
              column={isMobile ? 1 : 2}
              size="small"
              styles={{
                label: { color: 'rgba(0,51,120,.55)', fontSize: 12.5 },
                content: { color: '#003378', fontSize: 12.5 },
              }}
              items={[
                { key: 'name', label: '项目名称', children: project.name },
                { key: 'code', label: '项目编码', children: <Text code>{project.code || '-'}</Text> },
                { key: 'group', label: '所属分组', children: project.group_name || '未分组' },
                { key: 'category', label: '业务分类', children: project.category || '-' },
                { key: 'ds', label: '数据源', children: project.datasource_name || '本机数据库' },
                {
                  key: 'table',
                  label: '数据表',
                  children: <Text code style={{ fontSize: 11.5 }}>{project.data_table || '-'}</Text>,
                },
                {
                  key: 'parsed',
                  label: '解析表',
                  children: <Text code style={{ fontSize: 11.5 }}>{detail.parsedTable || '-'}</Text>,
                },
                {
                  key: 'status',
                  label: '状态',
                  children: Number(project.status) === 1
                    ? <Tag color="#A2D73C">启用</Tag>
                    : <Tag color="#B5B5B6">停用</Tag>,
                },
                { key: 'parse', label: '字段解析', children: Number(project.parse_enabled ?? 1) === 1 ? '已开启' : '已关闭' },
                { key: 'creator', label: '创建人', children: project.creator_display || project.creator_name || '-' },
                { key: 'created', label: '创建时间', children: fmtTime(project.created_at) },
                {
                  key: 'last',
                  label: '最后接收',
                  children: stats.lastReceived ? `${fmtTime(stats.lastReceived)}（${fmtAgo(stats.lastReceived)}）` : '从未接收',
                },
                { key: 'tags', label: '标签', children: project.tags || '-' },
                {
                  key: 'desc',
                  label: '项目描述',
                  span: isMobile ? 1 : 2,
                  children: project.description || '-',
                },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            variant="outlined"
            style={{ borderColor: '#DCDDDD', borderRadius: 12, height: '100%' }}
            styles={{ body: { padding: isMobile ? 12 : 16 } }}
            title={<span style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>推送接入</span>}
            extra={
              can('project:write') && (
                <Button size="small" icon={<KeyOutlined />} loading={regenerating} onClick={() => void onRegenerate()}>
                  重新生成令牌
                </Button>
              )
            }
          >
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="把下面的地址填到简道云「数据推送 → 自定义推送地址」"
            />
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: 'rgba(0,51,120,.55)', marginBottom: 3 }}>推送地址</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Input value={pushUrl} readOnly size="small" style={{ fontFamily: 'SF Mono, Consolas, monospace', fontSize: 11.5 }} />
                <Tooltip title="复制">
                  <Button size="small" icon={<CopyOutlined />} onClick={() => void copy(pushUrl, '推送地址')} />
                </Tooltip>
              </div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: 'rgba(0,51,120,.55)', marginBottom: 3 }}>推送令牌</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Input.Password
                  value={project.push_token || ''}
                  readOnly
                  size="small"
                  style={{ fontFamily: 'SF Mono, Consolas, monospace', fontSize: 11.5 }}
                />
                <Tooltip title="复制">
                  <Button size="small" icon={<CopyOutlined />} onClick={() => void copy(project.push_token || '', '推送令牌')} />
                </Tooltip>
              </div>
            </div>
            {project.jdy_secret ? (
              <Alert
                type="success"
                showIcon
                message="已配置校验 Secret"
                description="推送报文需带 signature 签名，未签名请求会被拒绝。"
              />
            ) : (
              <Alert type="warning" showIcon message="未配置校验 Secret（不校验签名）" />
            )}
            <div style={{ marginTop: 10, fontSize: 11.5, color: '#B5B5B6' }}>
              数据列 {detail.columns.length} 个 · 解析列 {detail.parsedColumns.length} 个 · 字段映射{' '}
              {Object.keys(detail.fieldMap || {}).length} 条
            </div>
          </Card>
        </Col>
      </Row>

      {detail.subTables.length > 0 && (
        <Card
          variant="outlined"
          style={{ borderColor: '#DCDDDD', borderRadius: 12, marginTop: 12 }}
          styles={{ body: { padding: isMobile ? 12 : 16 } }}
          title={<span style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>展开子表（{detail.subTables.length}）</span>}
        >
          <Space size={[8, 8]} wrap>
            {detail.subTables.map((s) => (
              <Tag key={s.name} color="#73DBFF" style={{ fontSize: 12, padding: '2px 8px' }}>
                {s.comment || s.name}
              </Tag>
            ))}
          </Space>
        </Card>
      )}
    </div>
  );
}

/* ══════════════ 日志 Tab ══════════════ */

function LogsTab({ projectId, isMobile }: { projectId: number; isMobile: boolean }) {
  const { modal, message } = App.useApp();
  const can = usePermission();
  const [rows, setRows] = useState<ProjectLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [ops, setOps] = useState<{ op: string; c: number }[]>([]);
  const [op, setOp] = useState('');
  const [result, setResult] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [detailRow, setDetailRow] = useState<ProjectLogRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetchProjectLogs(projectId, { page, pageSize, op, result, keyword });
      setRows(d.list || []);
      setTotal(d.total || 0);
      setOps(d.ops || []);
    } catch { /* 已 toast */ } finally {
      setLoading(false);
    }
  }, [projectId, page, pageSize, op, result, keyword]);

  useEffect(() => { void load(); }, [load]);

  const doClear = () => {
    modal.confirm({
      title: '清空该项目的全部接收日志？',
      content: '日志表会被 TRUNCATE，历史推送记录将不可恢复。',
      okText: '确认清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await clearProjectLogs(projectId);
          message.success('接收日志已清空');
          setPage(1);
          await load();
        } catch { /* 已 toast */ }
      },
    });
  };

  const columns = useMemo<ColumnsType<ProjectLogRow>>(() => [
    { title: '时间', dataIndex: 'created_at', key: 'created_at', width: 160, render: (v) => fmtTime(String(v)) },
    {
      title: '操作',
      dataIndex: 'op_label',
      key: 'op',
      width: 130,
      render: (_v, row) => <Tag color="#45B4FF">{row.op_label || row.op}</Tag>,
    },
    {
      title: '结果',
      dataIndex: 'result',
      key: 'result',
      width: 90,
      render: (v) => (v === 'success'
        ? <Tag color="#A2D73C">成功</Tag>
        : <Tag color="#E86161">{String(v) || '异常'}</Tag>),
    },
    {
      title: '数据 ID',
      dataIndex: 'data_id',
      key: 'data_id',
      width: 180,
      ellipsis: true,
      render: (v) => <Text code style={{ fontSize: 11.5 }}>{String(v || '-')}</Text>,
    },
    {
      title: '表单',
      dataIndex: 'form_name',
      key: 'form_name',
      width: 140,
      ellipsis: true,
      render: (v) => String(v || '-'),
    },
    {
      title: '字段数',
      dataIndex: 'field_count',
      key: 'field_count',
      width: 82,
      align: 'right',
      render: (v) => fmtNum(Number(v || 0)),
    },
    {
      title: '来源 IP',
      dataIndex: 'source_ip',
      key: 'source_ip',
      width: 130,
      hideInTable: isMobile,
      render: (v) => String(v || '-'),
    },
    {
      title: '说明',
      dataIndex: 'message',
      key: 'message',
      ellipsis: true,
      render: (v) => <span style={{ fontSize: 12, color: 'rgba(0,51,120,.65)' }}>{cellText(v, 60) || '-'}</span>,
    },
  ], [isMobile]);

  return (
    <Card variant="outlined" style={{ borderColor: '#DCDDDD', borderRadius: 12 }} styles={{ body: { padding: isMobile ? 12 : 14 } }}>
      <Space size={8} wrap style={{ marginBottom: 10 }}>
        <Input.Search
          allowClear
          placeholder="搜索数据ID / 表单名 / 说明"
          style={{ width: isMobile ? '100%' : 260 }}
          size={isMobile ? 'large' : 'middle'}
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          onSearch={(v) => { setKeyword(v.trim()); setPage(1); }}
        />
        <Select
          allowClear
          placeholder="操作类型"
          style={{ width: isMobile ? 'calc(50% - 4px)' : 150 }}
          size={isMobile ? 'large' : 'middle'}
          value={op || undefined}
          onChange={(v?: string) => { setOp(v || ''); setPage(1); }}
          options={ops.map((o) => ({ label: `${o.op}（${o.c}）`, value: o.op }))}
        />
        <Select
          allowClear
          placeholder="结果"
          style={{ width: isMobile ? 'calc(50% - 4px)' : 120 }}
          size={isMobile ? 'large' : 'middle'}
          value={result || undefined}
          onChange={(v?: string) => { setResult(v || ''); setPage(1); }}
          options={[
            { label: '成功', value: 'success' },
            { label: '失败', value: 'failed' },
          ]}
        />
        <Button size={isMobile ? 'large' : 'middle'} icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
          刷新
        </Button>
        {can('log:clear') && (
          <Button size={isMobile ? 'large' : 'middle'} danger onClick={doClear}>清空日志</Button>
        )}
      </Space>

      <Table<ProjectLogRow>
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 900 }}
        onRow={(row) => ({ onClick: () => setDetailRow(row), style: { cursor: 'pointer' } })}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无推送日志" /> }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />

      <Drawer
        open={Boolean(detailRow)}
        onClose={() => setDetailRow(null)}
        size={isMobile ? '100%' : 560}
        title="日志详情"
        destroyOnHidden
      >
        {detailRow && (
          <Descriptions column={1} size="small" bordered styles={{ label: { width: 110, fontSize: 12.5 }, content: { fontSize: 12.5 } }}>
            <Descriptions.Item label="时间">{fmtTime(detailRow.created_at)}</Descriptions.Item>
            <Descriptions.Item label="操作">{detailRow.op_label || detailRow.op}</Descriptions.Item>
            <Descriptions.Item label="结果">
              {detailRow.result === 'success' ? <Tag color="#A2D73C">成功</Tag> : <Tag color="#E86161">{detailRow.result}</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="数据 ID">{detailRow.data_id || '-'}</Descriptions.Item>
            <Descriptions.Item label="表单">{detailRow.form_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="推送 ID">{detailRow.deliver_id || '-'}</Descriptions.Item>
            <Descriptions.Item label="签名">{Number(detailRow.signature_ok) === 1 ? '通过' : (detailRow.signature_msg || '-')}</Descriptions.Item>
            <Descriptions.Item label="来源 IP">{detailRow.source_ip || '-'}</Descriptions.Item>
            <Descriptions.Item label="字段数">{fmtNum(Number(detailRow.field_count || 0))}</Descriptions.Item>
            <Descriptions.Item label="说明">{detailRow.message || '-'}</Descriptions.Item>
            <Descriptions.Item label="变更摘要">
              <Paragraph style={{ margin: 0, fontSize: 12.5, whiteSpace: 'pre-wrap' }}>
                {detailRow.change_summary || '（无）'}
              </Paragraph>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </Card>
  );
}

/* ══════════════ 数据 Tab ══════════════ */

function DataTab({
  projectId, parsedColumns, isMobile,
}: {
  projectId: number;
  parsedColumns: ProjectColumnInfo[];
  isMobile: boolean;
}) {
  const [data, setData] = useState<ProjectParsedData | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetchParsedRecords(projectId, { page, pageSize, keyword });
      setData(d);
    } catch { /* 已 toast */ } finally {
      setLoading(false);
    }
  }, [projectId, page, pageSize, keyword]);

  useEffect(() => { void load(); }, [load]);

  /** 列定义：优先后端返回的解析表列；无数据时用项目详情里的解析列 */
  const effectiveColumns = useMemo(() => {
    const cols = data?.columns?.length ? data.columns : parsedColumns;
    return cols
      .filter((c) => !INTERNAL_COLS.has(c.name))
      .slice(0, 40);
  }, [data?.columns, parsedColumns]);

  const columns = useMemo<ColumnsType<DataRow>>(() => {
    const idField = data?.idField;
    const first: ColumnsType<DataRow> = [
      {
        title: idField?.label || '数据 ID',
        dataIndex: 'display_id',
        key: 'display_id',
        width: 170,
        fixed: 'left',
        ellipsis: true,
        render: (_v, row) => (
          <Text code style={{ fontSize: 11.5 }}>
            {String(row.display_id || row.jdy_data_id || row.id || '-')}
          </Text>
        ),
      },
    ];
    const rest: ColumnsType<DataRow> = effectiveColumns.map((c) => ({
      title: c.comment || c.name,
      dataIndex: c.name,
      key: c.name,
      width: 150,
      ellipsis: true,
      render: (v: unknown) => {
        const text = cellText(v, 60);
        return text ? <span style={{ fontSize: 12 }}>{text}</span> : <Text type="secondary">-</Text>;
      },
    }));
    return [...first, ...rest];
  }, [effectiveColumns, data?.idField]);

  return (
    <Card
      variant="outlined"
      style={{ borderColor: '#DCDDDD', borderRadius: 12 }}
      styles={{ body: { padding: isMobile ? 12 : 14 } }}
      title={<span style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>解析后数据</span>}
      extra={<Text type="secondary" style={{ fontSize: 12 }}>共 {fmtNum(data?.total || 0)} 行</Text>}
    >
      <Space size={8} wrap style={{ marginBottom: 10 }}>
        <Input.Search
          allowClear
          placeholder="搜索数据ID / 表单名 / 任意字段值"
          style={{ width: isMobile ? '100%' : 320 }}
          size={isMobile ? 'large' : 'middle'}
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          onSearch={(v) => { setKeyword(v.trim()); setPage(1); }}
        />
        <Button size={isMobile ? 'large' : 'middle'} icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
          刷新
        </Button>
      </Space>

      <Table<DataRow>
        rowKey={(row, i) => String(row.id ?? i)}
        size="small"
        loading={loading}
        columns={columns}
        dataSource={data?.list || []}
        scroll={{ x: 'max-content' }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无解析数据（可先到「字段配置」执行同步结构回填）"
            />
          ),
        }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (t) => `共 ${t} 行`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
    </Card>
  );
}

/* ══════════════ 页面 ══════════════ */

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const can = usePermission();

  const projectId = Number(id);
  const [detail, setDetail] = useState<ProjectDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const d = await fetchProject(projectId);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : '项目详情加载失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  if (!projectId) {
    return (
      <Page title="项目详情">
        <Empty description="项目 ID 无效">
          <Button type="primary" onClick={() => navigate('/projects')}>返回项目列表</Button>
        </Empty>
      </Page>
    );
  }

  if (error && !loading) {
    return (
      <Page title="项目详情" extra={<Button onClick={() => navigate('/projects')}>返回列表</Button>}>
        <Alert
          type="error"
          showIcon
          message="加载失败"
          description={error}
          action={<Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>重试</Button>}
        />
      </Page>
    );
  }

  const project = detail?.project;

  const items = [
    {
      key: 'overview',
      label: '概览',
      icon: <DatabaseOutlined />,
      children: detail ? (
        <OverviewTab detail={detail} isMobile={isMobile} onRefresh={() => void load()} />
      ) : (
        <Card loading variant="borderless" />
      ),
    },
    {
      key: 'fields',
      label: '字段配置',
      icon: <TableOutlined />,
      disabled: !can('field:write'),
      children: detail ? (
        <FieldsPanel projectId={projectId} onChanged={() => void load()} />
      ) : (
        <Card loading variant="borderless" />
      ),
    },
    {
      key: 'logs',
      label: '推送日志',
      icon: <ReloadOutlined />,
      disabled: !can('log:read'),
      children: detail ? <LogsTab projectId={projectId} isMobile={isMobile} /> : <Card loading variant="borderless" />,
    },
    {
      key: 'data',
      label: '数据明细',
      icon: <TableOutlined />,
      disabled: !can('data:read'),
      children: detail ? (
        <DataTab projectId={projectId} parsedColumns={detail.parsedColumns} isMobile={isMobile} />
      ) : (
        <Card loading variant="borderless" />
      ),
    },
  ];

  return (
    <Page
      title={project ? project.name : '项目详情'}
      subTitle={project
        ? `${project.code || ''} · ${project.group_name || '未分组'} · ${project.description || '暂无描述'}`
        : '加载中'}
      extra={
        <Space size={8} wrap>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>
          <Button onClick={() => navigate('/projects')}>返回列表</Button>
        </Space>
      }
    >
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={items}
        size={isMobile ? 'small' : 'middle'}
        destroyOnHidden={false}
      />
    </Page>
  );
}
