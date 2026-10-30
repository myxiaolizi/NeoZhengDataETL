/** 流程日志（V6.1 页面规范）：运行记录列表 + 节点执行明细（可展开）
 *
 * 结构：[返回] 本页名称 + 操作 → 数据卡片 → 运行记录列表 → 流程配置
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  Alert, Button, Card, Descriptions, Empty, Grid, Pagination, Tag, Tooltip,
} from 'antd';
import {
  EditOutlined, PlayCircleOutlined, ReloadOutlined,
} from '@ant-design/icons';
import Page from '@/components/Page';
import type { StatCardItem } from '@/components/StatCards';
import { NEUTRAL, PALETTE, SHADOW } from '@/theme';
import { flowsApi } from '@/api/flows';
import type { FlowDetail, FlowLog, FlowNodeLog } from '@/api/flows';
import { fmtNum, fmtTime } from '@/utils';

const { useBreakpoint } = Grid;

const PAGE_SIZE = 20;

const TRIGGER_TEXT: Record<string, string> = {
  manual: '手动',
  cron: '定时',
  trigger: '触发',
  push: '数据推送',
};

/** 节点日志展开区 */
function NodeLogs({ logs }: { logs: FlowNodeLog[] }) {
  if (!logs.length) {
    return <div style={{ fontSize: 12.5, color: NEUTRAL.textTertiary, padding: '6px 0' }}>没有节点执行明细</div>;
  }
  return (
    <div style={{ padding: '4px 0' }}>
      {logs.map((l, i) => (
        <div
          key={`${l.nodeId}-${i}`}
          style={{
            display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5,
            padding: '6px 0', borderBottom: i === logs.length - 1 ? 'none' : `1px solid ${NEUTRAL.borderSubtle}`,
          }}
        >
          <span
            style={{
              width: 20, height: 20, borderRadius: 10, flexShrink: 0, fontSize: 11,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: NEUTRAL.textInverse,
              background: l.ok === false ? PALETTE.red : PALETTE.green,
            }}
          >
            {l.ok === false ? '✗' : '✓'}
          </span>
          <span style={{ color: NEUTRAL.text, width: 150, flexShrink: 0 }}>{l.name}</span>
          <span style={{ flex: 1, color: NEUTRAL.textTertiary, wordBreak: 'break-all' }}>
            {l.ok === false
              ? l.error || '执行失败'
              : `输入 ${l.inputRows ?? l.rows ?? 0} 行 → 输出 ${l.outputRows ?? l.rows ?? 0} 行`}
            {l.ms !== undefined ? ` · ${l.ms}ms` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function FlowLogsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [flow, setFlow] = useState<FlowDetail | null>(null);
  const [rows, setRows] = useState<FlowLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!id) return;
    flowsApi
      .detail(id)
      .then((d) => setFlow(d))
      .catch(() => setFlow(null));
  }, [id]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const res = await flowsApi.logs(id, { page, pageSize: PAGE_SIZE });
      setRows(res.list || []);
      setTotal(res.total || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : '运行日志加载失败');
    } finally {
      setLoading(false);
    }
  }, [id, page]);

  useEffect(() => {
    load();
  }, [load]);

  const successCount = useMemo(() => rows.filter((r) => r.success === 1).length, [rows]);

  const runNow = async () => {
    if (!id) return;
    setRunning(true);
    try {
      await flowsApi.run(id);
      setPage(1);
      await load();
    } catch {
      /* client 已提示 */
    } finally {
      setRunning(false);
    }
  };

  /* ---------- 数据卡片（就地统计，不新增接口） ---------- */
  const statItems = useMemo<StatCardItem[]>(() => [
    { key: 'total', label: '日志条数', value: fmtNum(total), suffix: '条', color: PALETTE.primary },
    { key: 'pageOk', label: '本页成功', value: fmtNum(successCount), suffix: '条', color: PALETTE.green },
    { key: 'ok', label: '累计成功', value: fmtNum(flow?.successCount ?? 0), suffix: '次', color: PALETTE.cyan, hint: `累计运行 ${fmtNum(flow?.runCount ?? 0)} 次` },
    {
      key: 'last',
      label: '最近执行',
      value: flow?.lastRunAt ? fmtTime(flow.lastRunAt, 'MM-DD HH:mm') : '未执行',
      color: flow?.lastRunOk === false ? PALETTE.red : PALETTE.violet,
      hint: flow?.lastRunAt ? (flow.lastRunOk ? '结果：成功' : '结果：失败') : undefined,
    },
  ], [total, successCount, flow]);

  const columns: ProColumns<FlowLog>[] = useMemo(
    () => [
      {
        title: '执行时间',
        dataIndex: 'created_at',
        width: 170,
        sorter: (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')),
        render: (_, record) => <span style={{ fontSize: 12.5 }}>{fmtTime(record.created_at)}</span>,
      },
      {
        title: '触发方式',
        dataIndex: 'trigger_source',
        width: 110,
        render: (_, record) => (
          <Tag style={{ color: PALETTE.primary, background: NEUTRAL.surface, borderColor: PALETTE.primary, margin: 0 }}>
            {TRIGGER_TEXT[record.trigger_source] || record.trigger_source}
          </Tag>
        ),
      },
      {
        title: '结果',
        dataIndex: 'success',
        width: 100,
        render: (_, record) => (
          <Tag
            style={{
              color: record.success === 1 ? PALETTE.green : PALETTE.red,
              background: NEUTRAL.surface,
              borderColor: record.success === 1 ? PALETTE.green : PALETTE.red,
              margin: 0,
            }}
          >
            {record.success === 1 ? '成功' : '失败'}
          </Tag>
        ),
      },
      { title: '输入行', dataIndex: 'input_rows', width: 90, align: 'right', sorter: (a, b) => (a.input_rows ?? 0) - (b.input_rows ?? 0) },
      { title: '输出行', dataIndex: 'output_rows', width: 90, align: 'right', sorter: (a, b) => (a.output_rows ?? 0) - (b.output_rows ?? 0) },
      {
        title: '耗时',
        dataIndex: 'duration_ms',
        width: 90,
        align: 'right',
        sorter: (a, b) => (a.duration_ms ?? 0) - (b.duration_ms ?? 0),
        render: (_, record) => (record.duration_ms === null ? '-' : `${record.duration_ms}ms`),
      },
      {
        title: '说明',
        dataIndex: 'message',
        ellipsis: true,
        render: (_, record) => (
          <Tooltip title={record.message || ''}>
            <span style={{ fontSize: 12.5, color: record.success === 1 ? NEUTRAL.textSecondary : PALETTE.red }}>
              {record.message || '-'}
            </span>
          </Tooltip>
        ),
      },
      {
        title: '节点明细',
        valueType: 'option',
        width: 100,
        render: (_, record) => (
          <span style={{ fontSize: 12.5, color: NEUTRAL.textTertiary }}>{record.nodeLogs?.length || 0} 个节点</span>
        ),
      },
    ],
    []
  );

  return (
    <Page
      back="/flows"
      backText="返回处理流程"
      title={flow ? `流程日志 · ${flow.name}` : '流程日志'}
      actions={
        <Button type="primary" icon={<PlayCircleOutlined />} loading={running} onClick={runNow}>
          立即执行
        </Button>
      }
      extra={
        <Button icon={<EditOutlined />} onClick={() => navigate(`/flows/${id}/design`)}>
          {isMobile ? '' : '流程设计'}
        </Button>
      }
      stats={statItems}
    >
      {error ? (
        <Alert
          type="error"
          showIcon
          title="加载失败"
          description={error}
          action={<Button size="small" icon={<ReloadOutlined />} onClick={load}>重试</Button>}
          style={{ marginBottom: 12 }}
        />
      ) : null}

      {flow?.lastRunMsg && flow.lastRunOk === false && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          title="最近一次执行失败"
          description={flow.lastRunMsg}
        />
      )}

      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.length === 0 ? (
            <Empty description={loading ? '加载中…' : '还没有运行记录'} />
          ) : (
            rows.map((record) => (
              <Card key={record.id} size="small" styles={{ body: { padding: 14 } }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12.5, color: NEUTRAL.textTertiary }}>{fmtTime(record.created_at)}</span>
                  <Tag
                    style={{
                      color: record.success === 1 ? PALETTE.green : PALETTE.red,
                      background: NEUTRAL.surface,
                      borderColor: record.success === 1 ? PALETTE.green : PALETTE.red,
                      marginInlineEnd: 0,
                    }}
                  >
                    {record.success === 1 ? '成功' : '失败'}
                  </Tag>
                </div>
                <div style={{ marginTop: 8, fontSize: 13, color: NEUTRAL.text }}>
                  {TRIGGER_TEXT[record.trigger_source] || record.trigger_source} · 输入 {record.input_rows} 行 → 输出{' '}
                  {record.output_rows} 行 · {record.duration_ms ?? 0}ms
                </div>
                {record.message && (
                  <div
                    style={{
                      marginTop: 6, fontSize: 12.5,
                      color: record.success === 1 ? NEUTRAL.textTertiary : PALETTE.red,
                    }}
                  >
                    {record.message}
                  </div>
                )}
                <div style={{ marginTop: 8 }}>
                  <NodeLogs logs={record.nodeLogs || []} />
                </div>
              </Card>
            ))
          )}
          <div style={{ textAlign: 'center', paddingTop: 4 }}>
            <Pagination simple current={page} pageSize={PAGE_SIZE} total={total} onChange={(p) => setPage(p)} />
          </div>
        </div>
      ) : (
        <>
          <ProTable<FlowLog>
            rowKey="id"
            columns={columns}
            dataSource={rows}
            loading={loading}
            search={false}
            options={false}
            cardBordered
            headerTitle="运行记录"
            toolBarRender={false}
            pagination={false}
            scroll={{ x: 1100 }}
            expandable={{
              expandedRowRender: (record) => <NodeLogs logs={record.nodeLogs || []} />,
              rowExpandable: (record) => (record.nodeLogs || []).length > 0,
            }}
            locale={{ emptyText: <Empty description="还没有运行记录，点击「立即执行」试一次" /> }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <Pagination
              current={page}
              pageSize={PAGE_SIZE}
              total={total}
              showSizeChanger={false}
              showTotal={(t) => `共 ${t} 条`}
              onChange={(p) => setPage(p)}
            />
          </div>
        </>
      )}

      {flow && (
        <Card
          size="small"
          title="流程配置"
          style={{ marginTop: 12, borderColor: NEUTRAL.border, borderRadius: 10, boxShadow: SHADOW.card }}
        >
          <Descriptions
            size="small"
            column={isMobile ? 1 : 3}
            items={[
              { key: 'name', label: '流程名称', children: flow.name },
              { key: 'code', label: '流程编码', children: flow.code },
              { key: 'source', label: '数据来源', children: flow.sourceType || 'project' },
              { key: 'mode', label: '执行方式', children: TRIGGER_TEXT[flow.runMode || 'manual'] || flow.runMode },
              { key: 'nodes', label: '节点数', children: (flow.nodes || []).length },
              { key: 'edges', label: '连线数', children: (flow.edges || []).length },
              { key: 'project', label: '关联项目', children: flow.projectName || '—' },
              { key: 'target', label: '输出表', children: flow.targetTable || '—' },
              { key: 'updated', label: '更新时间', children: fmtTime(flow.updatedAt) },
            ]}
          />
        </Card>
      )}

      {!flow && !loading && !error ? (
        <Empty description="流程不存在或无权限访问" style={{ padding: '40px 0' }} />
      ) : null}
    </Page>
  );
}
