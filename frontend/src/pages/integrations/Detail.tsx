/** 集成详情：配置概览 + 运行日志（服务端分页） + 手动执行 + 请求/响应快照 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button, Space, Typography, App, Tag, Descriptions, Tabs, Alert, Card, Statistic,
  Drawer, Empty, Spin, Divider, Badge,
} from 'antd';
import {
  ArrowLeftOutlined, PlayCircleOutlined, ReloadOutlined, ImportOutlined, ExportOutlined,
  CheckCircleFilled, CloseCircleFilled, ThunderboltOutlined, LinkOutlined,
} from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useNavigate, useParams } from 'react-router-dom';
import Page from '@/components/Page';
import { useAppStore, usePermission } from '@/stores/app';
import { fmtTime, fmtNum } from '@/utils';
import { getIntegration, listIntegrationLogs, runIntegration } from '@/api/integrations';
import type { Integration, IntegrationLogRow, IntegrationRunLog } from '@/api/integrations';

const { Text, Paragraph } = Typography;

const TRIGGER_LABEL: Record<string, string> = {
  manual: '手动触发',
  schedule: '定时调度',
  webhook: 'Webhook 触发',
  cron: '定时调度',
};

const AUTH_LABEL: Record<string, string> = {
  none: '无鉴权',
  bearer: 'Bearer Token',
  basic: 'Basic 认证',
  apikey: 'API Key',
};

export default function IntegrationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const can = usePermission();
  const canWrite = can('integration:write');

  const taskId = Number(id);
  const [task, setTask] = useState<Integration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<IntegrationRunLog | null>(null);
  const [snapshot, setSnapshot] = useState<IntegrationLogRow | null>(null);
  const [tab, setTab] = useState('overview');

  const logRef = useRef<ActionType>(null);

  const load = useCallback(async () => {
    if (!taskId) { setError('无效的任务 ID'); setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const t = await getIntegration(taskId);
      setTask(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取任务失败');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const handleRun = async () => {
    if (!task) return;
    setRunning(true);
    try {
      const r = await runIntegration(task.id, { limit: 100 });
      const log = r.data;
      if (r.ok && log?.success) message.success(`执行成功：${log.message}`);
      else message.error(`执行失败：${log?.message || r.message || '未知错误'}`);
      if (log) setLastRun(log);
      logRef.current?.reload();
      load();
    } finally {
      setRunning(false);
    }
  };

  /** 日志表格列 */
  const logColumns: ProColumns<IntegrationLogRow>[] = [
    {
      title: '执行时间',
      dataIndex: 'created_at',
      width: 170,
      render: (_, row) => <Text style={{ fontSize: 12.5 }}>{fmtTime(row.created_at)}</Text>,
    },
    {
      title: '结果',
      dataIndex: 'success',
      width: 100,
      render: (_, row) =>
        Number(row.success) === 1 ? (
          <Tag icon={<CheckCircleFilled />} color="#A2D73C">成功</Tag>
        ) : (
          <Tag icon={<CloseCircleFilled />} color="#E86161">失败</Tag>
        ),
    },
    {
      title: '触发来源',
      dataIndex: 'trigger_source',
      width: 120,
      render: (_, row) => (
        <Tag color="#73DBFF">{TRIGGER_LABEL[row.trigger_source] || row.trigger_source}</Tag>
      ),
    },
    {
      title: '方向',
      dataIndex: 'direction',
      width: 90,
      render: (_, row) => (
        <Tag color={row.direction === 'push' ? '#EC673C' : '#3687FF'}>
          {row.direction === 'push' ? '推送' : '采集'}
        </Tag>
      ),
    },
    {
      title: '处理行数',
      dataIndex: 'rows_affected',
      width: 110,
      render: (_, row) => <Text>{fmtNum(row.rows_affected)}</Text>,
    },
    {
      title: 'HTTP',
      dataIndex: 'http_status',
      width: 90,
      render: (_, row) =>
        row.http_status === null || row.http_status === undefined ? (
          <Text type="secondary">-</Text>
        ) : (
          <Tag color={row.http_status >= 200 && row.http_status < 300 ? '#A2D73C' : '#E86161'}>
            {row.http_status}
          </Tag>
        ),
    },
    {
      title: '耗时',
      dataIndex: 'duration_ms',
      width: 100,
      render: (_, row) => <Text type="secondary">{fmtNum(row.duration_ms)} ms</Text>,
    },
    {
      title: '信息',
      dataIndex: 'message',
      ellipsis: true,
      render: (_, row) => (
        <Text style={{ fontSize: 12.5 }}>{row.message || <Text type="secondary">-</Text>}</Text>
      ),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 100,
      render: (_, row) => (
        <a onClick={() => setSnapshot(row)}>
          <ThunderboltOutlined /> 快照
        </a>
      ),
    },
  ];

  if (loading) {
    return (
      <Page title="集成详情">
        <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" tip="加载中…" /></div>
      </Page>
    );
  }

  if (error || !task) {
    return (
      <Page
        title="集成详情"
        extra={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/integrations')}>返回列表</Button>}
      >
        <Alert type="error" showIcon title="读取失败" description={error || '任务不存在'} />
      </Page>
    );
  }

  const successRate = task.runCount > 0 ? (task.successCount / task.runCount) * 100 : 0;

  return (
    <Page
      title={
        <Space size={8} wrap>
          {task.direction === 'push'
            ? <ExportOutlined style={{ color: '#EC673C' }} />
            : <ImportOutlined style={{ color: '#3687FF' }} />}
          <span>{task.name}</span>
          <Tag color={task.direction === 'push' ? '#EC673C' : '#3687FF'}>
            {task.direction === 'push' ? '推送' : '采集'}
          </Tag>
          {task.status ? <Tag color="#A2D73C">启用</Tag> : <Tag color="#B5B5B6">停用</Tag>}
        </Space>
      }
      subTitle={`任务编码：${task.code}${task.projectName ? ` · 关联项目：${task.projectName}` : ''}`}
      extra={
        <>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/integrations')}>
            返回列表
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => { load(); logRef.current?.reload(); }}>
            刷新
          </Button>
          {canWrite && (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={running}
              onClick={handleRun}
            >
              立即执行
            </Button>
          )}
        </>
      }
    >
      {/* 统计条 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Card size="small" styles={{ body: { padding: '10px 14px' } }}>
          <Statistic title="累计执行" value={task.runCount} valueStyle={{ fontSize: 20, color: '#3687FF' }} />
        </Card>
        <Card size="small" styles={{ body: { padding: '10px 14px' } }}>
          <Statistic title="成功次数" value={task.successCount} valueStyle={{ fontSize: 20, color: '#A2D73C' }} />
        </Card>
        <Card size="small" styles={{ body: { padding: '10px 14px' } }}>
          <Statistic
            title="成功率"
            value={successRate}
            precision={1}
            suffix="%"
            valueStyle={{ fontSize: 20, color: successRate >= 80 ? '#A2D73C' : '#FFC000' }}
          />
        </Card>
        <Card size="small" styles={{ body: { padding: '10px 14px' } }}>
          <Statistic
            title="最近执行"
            value={task.lastRunAt ? fmtTime(task.lastRunAt, 'MM-DD HH:mm') : '未执行'}
            valueStyle={{ fontSize: 16, color: '#2D6FE4' }}
          />
        </Card>
      </div>

      {/* 最近一次执行结果 */}
      {lastRun && (
        <Alert
          style={{ marginBottom: 16 }}
          type={lastRun.success ? 'success' : 'error'}
          showIcon
          title={lastRun.success ? '本次执行成功' : '本次执行失败'}
          description={`${lastRun.message}（处理 ${fmtNum(lastRun.rowsAffected)} 行，耗时 ${lastRun.durationMs}ms${
            lastRun.httpStatus ? `，HTTP ${lastRun.httpStatus}` : ''
          }）`}
          closable
          onClose={() => setLastRun(null)}
        />
      )}

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'overview',
            label: '配置概览',
            children: (
              <Space size={16} direction="vertical" style={{ width: '100%' }}>
                <Descriptions
                  title="基本信息"
                  bordered
                  size="small"
                  column={{ xs: 1, sm: 1, md: 2 }}
                  items={[
                    { key: 'name', label: '任务名称', children: task.name },
                    { key: 'code', label: '任务编码', children: <Text code>{task.code}</Text> },
                    {
                      key: 'dir',
                      label: '集成方向',
                      children: task.direction === 'push' ? '推送（项目 → 接口）' : '采集（接口 → 项目）',
                    },
                    {
                      key: 'project',
                      label: '关联项目',
                      children: task.projectName || (task.projectId ? `#${task.projectId}` : '未关联'),
                    },
                    {
                      key: 'trigger',
                      label: '触发方式',
                      children: TRIGGER_LABEL[task.triggerType] || task.triggerType,
                    },
                    {
                      key: 'schedule',
                      label: '调度表达式',
                      children: task.schedule || <Text type="secondary">未设置</Text>,
                    },
                    {
                      key: 'status',
                      label: '启用状态',
                      children: task.status
                        ? <Badge status="processing" text="启用" />
                        : <Badge status="default" text="停用" />,
                    },
                    { key: 'created', label: '创建时间', children: fmtTime(task.createdAt) },
                  ]}
                />

                <Descriptions
                  title="接口配置"
                  bordered
                  size="small"
                  column={{ xs: 1, sm: 1, md: 2 }}
                  items={[
                    { key: 'proto', label: '协议', children: task.protocol },
                    { key: 'method', label: '请求方法', children: <Tag color="#45B4FF">{task.method}</Tag> },
                    {
                      key: 'url',
                      label: '接口地址',
                      span: 2,
                      children: (
                        <Space size={6} wrap>
                          <Text code style={{ fontSize: 12.5 }}>
                            {task.url || <Text type="secondary">未配置</Text>}
                          </Text>
                          {task.url ? (
                            <a href={task.url} target="_blank" rel="noreferrer">
                              <LinkOutlined /> 打开
                            </a>
                          ) : null}
                        </Space>
                      ),
                    },
                    {
                      key: 'auth',
                      label: '鉴权方式',
                      children: AUTH_LABEL[task.authType] || task.authType || '无鉴权',
                    },
                    {
                      key: 'dataPath',
                      label: '数据路径',
                      children: task.dataPath ? <Text code>{task.dataPath}</Text> : <Text type="secondary">根节点</Text>,
                    },
                    {
                      key: 'lastRun',
                      label: '最近执行结果',
                      span: 2,
                      children: task.lastRunAt ? (
                        <Space size={6} wrap>
                          {task.lastRunOk ? (
                            <Tag icon={<CheckCircleFilled />} color="#A2D73C">成功</Tag>
                          ) : (
                            <Tag icon={<CloseCircleFilled />} color="#E86161">失败</Tag>
                          )}
                          <Text type="secondary" style={{ fontSize: 12.5 }}>{fmtTime(task.lastRunAt)}</Text>
                          <Text style={{ fontSize: 12.5 }}>{task.lastRunMsg}</Text>
                        </Space>
                      ) : (
                        <Text type="secondary">尚未执行</Text>
                      ),
                    },
                  ]}
                />

                <Card size="small" title="请求头 / 查询参数 / 字段映射">
                  <Space size={20} direction="vertical" style={{ width: '100%' }}>
                    <SnapshotBlock label="请求头" value={task.headers} />
                    <SnapshotBlock label="查询参数" value={task.params} />
                    <SnapshotBlock label="字段映射" value={task.fieldMap} />
                  </Space>
                </Card>

                {task.body && (
                  <Card size="small" title="请求体模板">
                    <Paragraph style={{ marginBottom: 0 }}>
                      <pre
                        style={{
                          margin: 0, background: 'rgba(54,135,255,.06)', borderRadius: 8,
                          padding: 12, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                          maxHeight: 280, overflow: 'auto',
                        }}
                      >
                        {task.body}
                      </pre>
                    </Paragraph>
                  </Card>
                )}
              </Space>
            ),
          },
          {
            key: 'logs',
            label: '运行日志',
            children: (
              <ProTable<IntegrationLogRow, Record<string, unknown>>
                rowKey="id"
                actionRef={logRef}
                columns={logColumns}
                search={false}
                scroll={{ x: 1200 }}
                options={{ density: false, fullScreen: true, reload: true, setting: false }}
                pagination={{
                  defaultPageSize: 20,
                  showSizeChanger: true,
                  showTotal: (t) => `共 ${t} 条记录`,
                }}
                headerTitle="执行日志"
                request={async (params) => {
                  const page = Number(params.current) || 1;
                  const pageSize = Number(params.pageSize) || 20;
                  const r = await listIntegrationLogs(task.id, page, pageSize);
                  return { data: r.list || [], total: r.total || 0, success: true };
                }}
              />
            ),
          },
        ]}
      />

      {/* ---------- 请求/响应快照 ---------- */}
      <Drawer
        title="执行快照"
        open={!!snapshot}
        onClose={() => setSnapshot(null)}
        size={760}
        destroyOnHidden
      >
        {snapshot && (
          <>
            <Descriptions
              bordered
              size="small"
              column={1}
              style={{ marginBottom: 16 }}
              items={[
                {
                  key: 'result',
                  label: '执行结果',
                  children: Number(snapshot.success) === 1
                    ? <Tag icon={<CheckCircleFilled />} color="#A2D73C">成功</Tag>
                    : <Tag icon={<CloseCircleFilled />} color="#E86161">失败</Tag>,
                },
                { key: 'time', label: '执行时间', children: fmtTime(snapshot.created_at) },
                { key: 'msg', label: '结果信息', children: snapshot.message || '-' },
                { key: 'dur', label: '耗时', children: `${snapshot.duration_ms} ms` },
                { key: 'http', label: 'HTTP 状态', children: snapshot.http_status ?? '-' },
              ]}
            />
            <Divider titlePlacement="start" style={{ margin: '8px 0 12px' }}>
              <Text style={{ fontSize: 13 }}>请求快照</Text>
            </Divider>
            <CodeBlock text={snapshot.request_snapshot} tone="blue" />
            <Divider titlePlacement="start" style={{ margin: '16px 0 12px' }}>
              <Text style={{ fontSize: 13 }}>响应快照</Text>
            </Divider>
            <CodeBlock text={snapshot.response_snapshot} tone="green" />
          </>
        )}
      </Drawer>
    </Page>
  );
}

/* ---------------- 小组件 ---------------- */

function SnapshotBlock({ label, value }: { label: string; value: Record<string, unknown> }) {
  const keys = Object.keys(value || {});
  return (
    <div>
      <Text strong style={{ fontSize: 13 }}>{label}</Text>
      {keys.length === 0 ? (
        <div style={{ marginTop: 6 }}>
          <Text type="secondary" style={{ fontSize: 12.5 }}>未配置</Text>
        </div>
      ) : (
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {keys.map((k) => (
            <Tag key={k} color="#45B4FF" style={{ marginInlineEnd: 0, fontSize: 12 }}>
              {k}: {String(value[k])}
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
}

function CodeBlock({ text, tone }: { text: string | null; tone: 'blue' | 'green' }) {
  if (!text) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无内容" style={{ margin: '12px 0' }} />;
  }
  const bg = tone === 'blue' ? 'rgba(54,135,255,.06)' : 'rgba(162,215,60,.10)';
  return (
    <Paragraph style={{ marginBottom: 0 }}>
      <pre
        style={{
          margin: 0, background: bg, borderRadius: 8, padding: 12, fontSize: 12,
          whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflow: 'auto',
        }}
      >
        {text}
      </pre>
    </Paragraph>
  );
}
