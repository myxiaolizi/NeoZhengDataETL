/** 项目详情：概览 / 字段配置 / 推送日志 / 数据明细（V4.1 页面规范）
 *
 * 结构：本页名称 + 操作 → 子标签页 → 数据卡片 → 本页内容
 * 数据来源：
 *   GET /api/projects/:id                项目详情（project/columns/parsedColumns/stats/fieldDefs/subTables）
 *   GET /api/projects/:id/fields         字段定义（由 FieldsPanel 负责）
 *   GET /api/projects/:id/logs           推送日志（分页 + op/result/keyword 过滤）
 *   GET /api/projects/:id/parsed         解析后数据（分页 + 关键字）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, App, Button, Card, Col, Descriptions, Empty, Grid, Input, Modal, Row, Select,
  Space, Table, Tabs, Tag, Tooltip, Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ArrowLeftOutlined, CopyOutlined, DatabaseOutlined, DownloadOutlined, KeyOutlined,
  ReloadOutlined, TableOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import Page from '@/components/Page';
import DataTable, {
  filtersToQuery, type DataColumn, type FilterItem, type SortState,
} from '@/components/DataTable';
import type { StatCardItem } from '@/components/StatCards';
import { usePermission } from '@/stores/app';
import { NEUTRAL, PALETTE, SHADOW } from '@/theme';
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

/** 统一的卡片外框（V4.1：白底 + 可见边框 + 卡片阴影） */
const cardStyle: React.CSSProperties = {
  background: NEUTRAL.surface,
  borderColor: NEUTRAL.border,
  borderRadius: 10,
  boxShadow: SHADOW.card,
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: NEUTRAL.text,
};

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
        <Col xs={24} lg={14}>
          <Card
            variant="outlined"
            style={{ ...cardStyle, height: '100%' }}
            styles={{ body: { padding: isMobile ? 12 : 16 } }}
            title={<span style={cardTitleStyle}>项目信息</span>}
          >
            <Descriptions
              column={isMobile ? 1 : 2}
              size="small"
              styles={{
                label: { color: NEUTRAL.textTertiary, fontSize: 12.5 },
                content: { color: NEUTRAL.text, fontSize: 12.5 },
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
                    ? <Tag color={PALETTE.green}>启用</Tag>
                    : <Tag color={PALETTE.gray}>停用</Tag>,
                },
                { key: 'parse', label: '字段解析', children: Number(project.parse_enabled ?? 1) === 1 ? '已开启' : '已关闭' },
                { key: 'creator', label: '创建人', children: project.creator_display || project.creator_name || '-' },
                { key: 'created', label: '创建时间', children: fmtTime(project.created_at) },
                {
                  key: 'last',
                  label: '最后接收',
                  children: detail.stats.lastReceived
                    ? `${fmtTime(detail.stats.lastReceived)}（${fmtAgo(detail.stats.lastReceived)}）`
                    : '从未接收',
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
            style={{ ...cardStyle, height: '100%' }}
            styles={{ body: { padding: isMobile ? 12 : 16 } }}
            title={<span style={cardTitleStyle}>推送接入</span>}
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
              title="把下面的地址填到简道云「数据推送 → 自定义推送地址」"
            />
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: NEUTRAL.textTertiary, marginBottom: 3 }}>推送地址</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Input value={pushUrl} readOnly size="small" style={{ fontFamily: 'SF Mono, Consolas, monospace', fontSize: 11.5 }} />
                <Tooltip title="复制">
                  <Button size="small" icon={<CopyOutlined />} onClick={() => void copy(pushUrl, '推送地址')} />
                </Tooltip>
              </div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: NEUTRAL.textTertiary, marginBottom: 3 }}>推送令牌</div>
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
                title="已配置校验 Secret"
                description="推送报文需带 signature 签名，未签名请求会被拒绝。"
              />
            ) : (
              <Alert type="warning" showIcon title="未配置校验 Secret（不校验签名）" />
            )}
            <div style={{ marginTop: 10, fontSize: 11.5, color: NEUTRAL.textQuaternary }}>
              数据列 {detail.columns.length} 个 · 解析列 {detail.parsedColumns.length} 个 · 字段映射{' '}
              {Object.keys(detail.fieldMap || {}).length} 条
            </div>
          </Card>
        </Col>
      </Row>

      {detail.subTables.length > 0 && (
        <Card
          variant="outlined"
          style={{ ...cardStyle, marginTop: 12 }}
          styles={{ body: { padding: isMobile ? 12 : 16 } }}
          title={<span style={cardTitleStyle}>展开子表（{detail.subTables.length}）</span>}
        >
          <Space size={[8, 8]} wrap>
            {detail.subTables.map((s) => (
              <Tag
                key={s.name}
                style={{
                  fontSize: 12, padding: '2px 8px', margin: 0,
                  background: NEUTRAL.surfaceSunken,
                  border: `1px solid ${NEUTRAL.border}`,
                  color: NEUTRAL.textSecondary,
                }}
              >
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
  const [error, setError] = useState('');
  const [ops, setOps] = useState<{ op: string; c: number }[]>([]);
  const [op, setOp] = useState('');
  const [result, setResult] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [detailRow, setDetailRow] = useState<ProjectLogRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await fetchProjectLogs(projectId, { page, pageSize, op, result, keyword });
      setRows(d.list || []);
      setTotal(d.total || 0);
      setOps(d.ops || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '推送日志加载失败');
    } finally {
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
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 160,
      sorter: (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')),
      render: (v) => fmtTime(String(v)),
    },
    {
      title: '操作',
      dataIndex: 'op_label',
      key: 'op',
      width: 130,
      render: (_v, row) => (
        <Tag
          style={{
            margin: 0, background: NEUTRAL.surfaceSunken,
            border: `1px solid ${NEUTRAL.border}`, color: PALETTE.primaryDeep,
          }}
        >
          {row.op_label || row.op}
        </Tag>
      ),
    },
    {
      title: '结果',
      dataIndex: 'result',
      key: 'result',
      width: 90,
      render: (v) => (v === 'success'
        ? <Tag color={PALETTE.green} style={{ margin: 0 }}>成功</Tag>
        : <Tag color={PALETTE.red} style={{ margin: 0 }}>{String(v) || '异常'}</Tag>),
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
      sorter: (a, b) => Number(a.field_count || 0) - Number(b.field_count || 0),
      render: (v) => fmtNum(Number(v || 0)),
    },
    {
      title: '来源 IP',
      dataIndex: 'source_ip',
      key: 'source_ip',
      width: 130,
      render: (v) => String(v || '-'),
    },
    {
      title: '说明',
      dataIndex: 'message',
      key: 'message',
      ellipsis: true,
      render: (v) => <span style={{ fontSize: 12, color: NEUTRAL.textSecondary }}>{cellText(v, 60) || '-'}</span>,
    },
  ], []);

  return (
    <Card variant="outlined" style={cardStyle} styles={{ body: { padding: isMobile ? 12 : 14 } }}>
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
        {can('log:clear') && (
          <Button size={isMobile ? 'large' : 'middle'} danger onClick={doClear}>清空日志</Button>
        )}
      </Space>

      {error ? (
        <Alert
          type="error"
          showIcon
          title="日志加载失败"
          description={error}
          action={<Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>重试</Button>}
        />
      ) : (
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
      )}

      {/* 日志详情：内容少 → Modal（V4.1 禁止右侧抽屉承载业务内容） */}
      <Modal
        open={Boolean(detailRow)}
        onCancel={() => setDetailRow(null)}
        footer={<Button onClick={() => setDetailRow(null)}>关闭</Button>}
        width={isMobile ? '94%' : 640}
        title="日志详情"
        destroyOnHidden
      >
        {detailRow && (
          <Descriptions
            column={1}
            size="small"
            bordered
            styles={{ label: { width: 110, fontSize: 12.5 }, content: { fontSize: 12.5 } }}
            items={[
              { key: 't', label: '时间', children: fmtTime(detailRow.created_at) },
              { key: 'op', label: '操作', children: detailRow.op_label || detailRow.op },
              {
                key: 'r',
                label: '结果',
                children: detailRow.result === 'success'
                  ? <Tag color={PALETTE.green} style={{ margin: 0 }}>成功</Tag>
                  : <Tag color={PALETTE.red} style={{ margin: 0 }}>{detailRow.result}</Tag>,
              },
              { key: 'd', label: '数据 ID', children: detailRow.data_id || '-' },
              { key: 'f', label: '表单', children: detailRow.form_name || '-' },
              { key: 'p', label: '推送 ID', children: detailRow.deliver_id || '-' },
              {
                key: 's',
                label: '签名',
                children: Number(detailRow.signature_ok) === 1 ? '通过' : (detailRow.signature_msg || '-'),
              },
              { key: 'ip', label: '来源 IP', children: detailRow.source_ip || '-' },
              { key: 'fc', label: '字段数', children: fmtNum(Number(detailRow.field_count || 0)) },
              { key: 'm', label: '说明', children: detailRow.message || '-' },
              {
                key: 'c',
                label: '变更摘要',
                children: (
                  <Paragraph style={{ margin: 0, fontSize: 12.5, whiteSpace: 'pre-wrap' }}>
                    {detailRow.change_summary || '（无）'}
                  </Paragraph>
                ),
              },
            ]}
          />
        )}
      </Modal>
    </Card>
  );
}

/* ══════════════ 数据 Tab ══════════════ */

/**
 * 数据明细（V6.1 统一实现）
 *
 * 改造要点（对应用户要求 7/8/9/10）：
 *  - 搜索框从「单独占一行」改为进入表格标题栏，位于列设置按钮左侧；
 *  - 新增列显示/隐藏 + 列排序（入口在标题栏最右端），按 storageKey 持久化；
 *  - 新增筛选（多条件 AND，走服务端 `filters` 参数）；
 *  - 表头排序走服务端 `sort`/`dir`；
 *  - 去掉刷新按钮，改由搜索/筛选/排序/分页变化自动取数。
 * 与「邮箱推送 · 数据项目」共用 @/components/DataTable，保证格式与功能完全一致。
 */
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
  const [error, setError] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);
  const [filters, setFilters] = useState<FilterItem[]>([]);

  /**
   * 取数：依赖只有稳定的标量（projectId/page/pageSize/keyword/sort/filters）
   * + 稳定的 setter，**不含 data/columns 这类每次渲染都换引用的值**，
   * 否则会像历史问题那样形成无限请求循环。
   */
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await fetchParsedRecords(projectId, {
        page,
        pageSize,
        keyword,
        ...(sort ? { sort: sort.column, dir: sort.order } : {}),
        ...(filters.length ? { filters: filtersToQuery(filters) } : {}),
      });
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : '解析数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [projectId, page, pageSize, keyword, sort, filters]);

  useEffect(() => { void load(); }, [load]);

  /** 列定义：优先后端返回的解析表列；无数据时用项目详情里的解析列 */
  const effectiveColumns = useMemo(() => {
    const cols = data?.columns?.length ? data.columns : parsedColumns;
    return cols
      .filter((c) => !INTERNAL_COLS.has(c.name))
      .slice(0, 40);
  }, [data?.columns, parsedColumns]);

  /** 数据 ID 列（固定最前，不参与隐藏/排序，用 renderCell 兜底） */
  const idLabel = data?.idField?.label || '数据 ID';

  /** DataTable 的列定义：首列「数据 ID」+ 解析列 */
  const dtColumns: DataColumn[] = useMemo(() => {
    /*
     * display_id 是后端**拼出来的合成列**（display_id = idField 列的值），
     * 不是物理列。服务端的排序/筛选白名单只认真实物理列，所以这里必须
     * 标记 sortable/filterable = false，否则用户点排序、加筛选都会被
     * 静默丢弃，表现为「点了没反应」。
     * 需要按 ID 过滤时，用「搜索」框（后端 keyword 覆盖 jdy_data_id）。
     */
    const idCol: DataColumn = {
      name: 'display_id',
      label: idLabel,
      comment: 'jdy_data_id / 业务主键（合成列，不支持排序与筛选）',
      sortable: false,
      filterable: false,
    };
    const rest: DataColumn[] = effectiveColumns.map((c) => ({
      name: c.name,
      label: c.comment || c.name,
      comment: c.comment || c.name,
      type: c.type,
    }));
    return [idCol, ...rest];
  }, [effectiveColumns, idLabel]);

  /** 单元格渲染：数据 ID 用 code 样式，其余走默认（由 DataTable 内部处理） */
  const renderCell = useCallback((row: DataRow, col: DataColumn) => {
    if (col.name === 'display_id') {
      return (
        <Text code style={{ fontSize: 11.5 }}>
          {String(row.display_id || row.jdy_data_id || row.id || '-')}
        </Text>
      );
    }
    return undefined;
  }, []);

  const applySearch = useCallback(() => {
    setKeyword(keywordInput.trim());
    setPage(1);
  }, [keywordInput]);

  return (
    <div style={{ ...cardStyle, background: NEUTRAL.surface, border: `1px solid ${NEUTRAL.border}`, borderRadius: 12, padding: isMobile ? 12 : 14 }}>
      <DataTable<DataRow>
        title="数据明细"
        total={Number(data?.total || 0)}
        rows={data?.list || []}
        columns={dtColumns}
        loading={loading}
        error={error}
        onRetry={() => void load()}
        rowKey={(row, i) => String(row.id ?? i)}
        searchPlaceholder="搜索数据ID / 表单名 / 任意字段值"
        keywordInput={keywordInput}
        onKeywordInputChange={setKeywordInput}
        onSearch={applySearch}
        onResetSearch={() => { setKeywordInput(''); setKeyword(''); setPage(1); }}
        sort={sort}
        onSortChange={(s) => { setSort(s); setPage(1); }}
        filters={filters}
        onFiltersChange={(f) => { setFilters(f); setPage(1); }}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, s) => { setPage(p); setPageSize(s); }}
        extra={(
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={() => { window.open(`/api/projects/${projectId}/export`, '_blank', 'noopener'); }}
          >
            {isMobile ? '' : '导出'}
          </Button>
        )}
        storageKey="projects.detail.parsed"
        renderCell={renderCell}
        emptyText={(
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无解析数据（可先到「字段配置」执行同步结构回填）"
          />
        )}
      />
    </div>
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

  /** 数据卡片：全部来自 detail.stats / fieldDefs / columns / subTables，不新增接口 */
  const statItems = useMemo<StatCardItem[]>(() => {
    const s = detail?.stats;
    return [
      {
        key: 'data',
        label: '数据记录',
        value: fmtNum(s?.dataTotal ?? 0),
        suffix: '行',
        color: PALETTE.primary,
        hint: `今日 +${fmtNum(s?.dataToday ?? 0)}`,
      },
      {
        key: 'log',
        label: '接收日志',
        value: fmtNum(s?.logTotal ?? 0),
        suffix: '条',
        color: PALETTE.cyan,
        hint: `失败 ${fmtNum(s?.logFailed ?? 0)}`,
      },
      {
        key: 'field',
        label: '字段定义',
        value: fmtNum(detail?.fieldDefs.length ?? 0),
        suffix: '个',
        color: PALETTE.green,
        hint: `数据列 ${detail?.columns.length ?? 0}`,
      },
      {
        key: 'parsed',
        label: '解析列',
        value: fmtNum(detail?.parsedColumns.length ?? 0),
        suffix: '个',
        color: PALETTE.violet,
        hint: `字段映射 ${Object.keys(detail?.fieldMap || {}).length} 条`,
      },
      {
        key: 'sub',
        label: '展开子表',
        value: fmtNum(detail?.subTables.length ?? 0),
        suffix: '张',
        color: PALETTE.orange,
        hint: detail?.subTables.length ? '数组字段已展开' : '无数组字段',
      },
    ];
  }, [detail]);

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
      <Page
        title="项目详情"
        actions={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects')}>返回列表</Button>}
      >
        <Alert
          type="error"
          showIcon
          title="加载失败"
          description={error}
          action={<Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>重试</Button>}
        />
      </Page>
    );
  }

  const project = detail?.project;

  /** 子标签页：只放 Tab 条，内容由 Page.children 渲染（保证数据卡片位于子标签页下方） */
  const tabItems = [
    { key: 'overview', label: '概览', icon: <DatabaseOutlined /> },
    {
      key: 'fields',
      label: '字段配置',
      icon: <TableOutlined />,
      disabled: !can('field:write'),
    },
    { key: 'logs', label: '推送日志', icon: <ReloadOutlined />, disabled: !can('log:read') },
    { key: 'data', label: '数据明细', icon: <TableOutlined />, disabled: !can('data:read') },
  ];

  const tabContent = !detail ? (
    <Card loading variant="borderless" style={cardStyle} />
  ) : tab === 'fields' ? (
    <FieldsPanel projectId={projectId} onChanged={() => void load()} />
  ) : tab === 'logs' ? (
    <LogsTab projectId={projectId} isMobile={isMobile} />
  ) : tab === 'data' ? (
    <DataTab projectId={projectId} parsedColumns={detail.parsedColumns} isMobile={isMobile} />
  ) : (
    <OverviewTab detail={detail} isMobile={isMobile} onRefresh={() => void load()} />
  );

  return (
    <Page
      back="/projects"
      backText="返回数据项目"
      title={project ? project.name : '项目详情'}
      /* V6.1：返回按钮移到标题最左侧（Page.back），页面不再提供刷新按钮 */
      subTabs={
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={tabItems}
          size={isMobile ? 'small' : 'middle'}
        />
      }
      stats={statItems}
    >
      {tabContent}
    </Page>
  );
}
