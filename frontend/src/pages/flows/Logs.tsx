/** 流程日志：运行记录列表 + 节点执行明细（可展开） */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  Button, Card, Descriptions, Empty, Grid, Pagination, Space, Statistic, Tag, Tooltip,
} from 'antd';
import {
  ArrowLeftOutlined, EditOutlined, PlayCircleOutlined, ReloadOutlined,
} from '@ant-design/icons';
import Page from '@/components/Page';
import { flowsApi } from '@/api/flows';
import type { FlowDetail, FlowLog, FlowNodeLog } from '@/api/flows';
import { fmtTime } from '@/utils';

const { useBreakpoint } = Grid;

/** 调色板（契约唯一允许的 13 色） */
const C = {
  primary: '#3687FF',
  blue: '#2D6FE4',
  deep: '#003378',
  cyan: '#45B4FF',
  green: '#A2D73C',
  orange: '#EC673C',
  red: '#E86161',
  yellow: '#FFC000',
  gray: '#B5B5B6',
  line: '#DCDDDD',
};

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
    return <div style={{ fontSize: 12.5, color: C.gray, padding: '6px 0' }}>没有节点执行明细</div>;
  }
  return (
    <div style={{ padding: '4px 0' }}>
      {logs.map((l, i) => (
        <div
          key={`${l.nodeId}-${i}`}
          style={{
            display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5,
            padding: '6px 0', borderBottom: i === logs.length - 1 ? 'none' : `1px solid ${C.line}`,
          }}
        >
          <span
            style={{
              width: 20, height: 20, borderRadius: 10, flexShrink: 0, fontSize: 11,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF',
              background: l.ok === false ? C.red : C.green,
            }}
          >
            {l.ok === false ? '✗' : '✓'}
          </span>
          <span style={{ color: C.deep, width: 150, flexShrink: 0 }}>{l.name}</span>
          <span style={{ flex: 1, color: C.gray, wordBreak: 'break-all' }}>
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
    try {
      const res = await flowsApi.logs(id, { page, pageSize: PAGE_SIZE });
      setRows(res.list || []);
      setTotal(res.total || 0);
    } catch {
      /* client 已提示 */
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
      const res = await flowsApi.run(id);
      if (res.ok) {
        // 成功提示由调用方 message 负责，这里保持静默，避免重复
      }
      setPage(1);
      await load();
    } catch {
      /* client 已提示 */
    } finally {
      setRunning(false);
    }
  };

  const columns: ProColumns<FlowLog>[] = useMemo(
    () => [
      {
        title: '执行时间',
        dataIndex: 'created_at',
        width: 170,
        render: (_, record) => <span style={{ fontSize: 12.5 }}>{fmtTime(record.created_at)}</span>,
      },
      {
        title: '触发方式',
        dataIndex: 'trigger_source',
        width: 110,
        render: (_, record) => (
          <Tag style={{ color: C.primary, background: '#FFFFFF', borderColor: C.primary }}>
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
              color: record.success === 1 ? C.green : C.red,
              background: '#FFFFFF',
              borderColor: record.success === 1 ? C.green : C.red,
            }}
          >
            {record.success === 1 ? '成功' : '失败'}
          </Tag>
        ),
      },
      { title: '输入行', dataIndex: 'input_rows', width: 90, align: 'right' },
      { title: '输出行', dataIndex: 'output_rows', width: 90, align: 'right' },
      {
        title: '耗时',
        dataIndex: 'duration_ms',
        width: 90,
        align: 'right',
        render: (_, record) => (record.duration_ms === null ? '-' : `${record.duration_ms}ms`),
      },
      {
        title: '说明',
        dataIndex: 'message',
        ellipsis: true,
        render: (_, record) => (
          <Tooltip title={record.message || ''}>
            <span style={{ fontSize: 12.5, color: record.success === 1 ? C.deep : C.red }}>
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
          <span style={{ fontSize: 12.5, color: C.gray }}>{record.nodeLogs?.length || 0} 个节点</span>
        ),
      },
    ],
    []
  );

  return (
    <Page
      title={`流程日志${flow ? ` · ${flow.name}` : ''}`}
      subTitle={flow ? `${flow.code} · 累计运行 ${flow.runCount ?? 0} 次，成功 ${flow.successCount ?? 0} 次` : '加载中…'}
      extra={
        <Space wrap size={8}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/flows')}>
            返回流程
          </Button>
          <Button icon={<EditOutlined />} onClick={() => navigate(`/flows/${id}/design`)}>
            流程设计
          </Button>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>
            刷新
          </Button>
          <Button type="primary" icon={<PlayCircleOutlined />} loading={running} onClick={runNow}>
            立即执行
          </Button>
        </Space>
      }
    >
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <Card size="small" style={{ flex: 1, minWidth: 150 }} styles={{ body: { padding: 14 } }}>
          <Statistic title="日志条数" value={total} styles={{ content: { color: C.primary, fontWeight: 700 } }} />
        </Card>
        <Card size="small" style={{ flex: 1, minWidth: 150 }} styles={{ body: { padding: 14 } }}>
          <Statistic title="本页成功" value={successCount} styles={{ content: { color: C.green, fontWeight: 700 } }} />
        </Card>
        <Card size="small" style={{ flex: 1, minWidth: 150 }} styles={{ body: { padding: 14 } }}>
          <Statistic
            title="累计成功"
            value={flow?.successCount ?? 0}
            styles={{ content: { color: C.cyan, fontWeight: 700 } }}
          />
        </Card>
        <Card size="small" style={{ flex: 1, minWidth: 150 }} styles={{ body: { padding: 14 } }}>
          <Statistic
            title="最近执行"
            value={flow?.lastRunAt ? fmtTime(flow.lastRunAt, 'MM-DD HH:mm') : '未执行'}
            styles={{ content: { color: flow?.lastRunOk === false ? C.red : C.deep, fontSize: 18, fontWeight: 700 } }}
          />
        </Card>
      </div>

      {flow?.lastRunMsg && flow.lastRunOk === false && (
        <div
          style={{
            marginBottom: 12, padding: '10px 12px', borderRadius: 10,
            border: `1px solid ${C.red}`, color: C.red, fontSize: 13, background: '#FFFFFF',
          }}
        >
          最近一次执行失败：{flow.lastRunMsg}
        </div>
      )}

      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.length === 0 ? (
            <Empty description={loading ? '加载中…' : '还没有运行记录'} />
          ) : (
            rows.map((record) => (
              <Card key={record.id} size="small" styles={{ body: { padding: 14 } }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12.5, color: C.gray }}>{fmtTime(record.created_at)}</span>
                  <Tag
                    style={{
                      color: record.success === 1 ? C.green : C.red,
                      background: '#FFFFFF',
                      borderColor: record.success === 1 ? C.green : C.red,
                      marginInlineEnd: 0,
                    }}
                  >
                    {record.success === 1 ? '成功' : '失败'}
                  </Tag>
                </div>
                <div style={{ marginTop: 8, fontSize: 13, color: C.deep }}>
                  {TRIGGER_TEXT[record.trigger_source] || record.trigger_source} · 输入 {record.input_rows} 行 → 输出{' '}
                  {record.output_rows} 行 · {record.duration_ms ?? 0}ms
                </div>
                {record.message && (
                  <div style={{ marginTop: 6, fontSize: 12.5, color: record.success === 1 ? C.gray : C.red }}>
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
        <Card size="small" title="流程配置" style={{ marginTop: 12 }}>
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
    </Page>
  );
}
