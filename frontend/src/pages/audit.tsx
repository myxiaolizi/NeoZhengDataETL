/** 审计日志：ProTable + 关键词/操作/日期筛选 + 按保留策略清理 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Grid, Input, Popconfirm, Row, Select, Space,
  Statistic, Tag, Tooltip, Typography, message,
} from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import {
  ClearOutlined, FileSearchOutlined, ReloadOutlined, TeamOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import Page from '@/components/Page';
import { useAppStore, usePermission } from '@/stores/app';
import { cleanupAuditLogs, listAuditLogs } from '@/api/users';
import type { AuditRow, AuditStats } from '@/api/users';
import { fmtTime, truncate } from '@/utils';

const { Text } = Typography;
const { RangePicker } = DatePicker;
const { useBreakpoint } = Grid;

const C = {
  primary: '#3687FF',
  blue: '#2D6FE4',
  navy: '#003378',
  cyan: '#45B4FF',
  green: '#A2D73C',
  yellow: '#FFC000',
  orange: '#EC673C',
  red: '#E86161',
  gray: '#B5B5B6',
  line: '#DCDDDD',
};

function softStyle(color: string): React.CSSProperties {
  return { background: `${color}1A`, color, border: 'none', borderRadius: 6, margin: 0, fontSize: 12 };
}

interface AuditFilters {
  keyword?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
}

/** 详情列：JSON 美化 + 截断，悬浮显示全文 */
function detailText(detail: string | null): string {
  if (!detail) return '-';
  try {
    const obj = JSON.parse(detail);
    return JSON.stringify(obj);
  } catch {
    return detail;
  }
}

export default function AuditPage() {
  const currentUser = useAppStore((s) => s.user);
  const can = usePermission();
  const canClean = !!currentUser && can('settings:write');
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const actionRef = useRef<ActionType>(null);

  const [stats, setStats] = useState<AuditStats>({ total: 0, today: 0, users: 0 });
  const [actions, setActions] = useState<Record<string, string>>({});
  const [keyword, setKeyword] = useState('');
  const [action, setAction] = useState<string | undefined>(undefined);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState('');

  const params: AuditFilters = useMemo(
    () => ({
      keyword: keyword.trim() || undefined,
      action: action || undefined,
      startDate: range ? range[0].format('YYYY-MM-DD') : undefined,
      endDate: range ? range[1].format('YYYY-MM-DD') : undefined,
    }),
    [keyword, action, range]
  );

  useEffect(() => {
    actionRef.current?.reload();
  }, [params]);

  const actionOptions = useMemo(
    () => Object.keys(actions).map((k) => ({ label: actions[k], value: k })),
    [actions]
  );

  const doCleanup = async () => {
    setCleaning(true);
    try {
      await cleanupAuditLogs();
      message.success('已按保留策略清理过期日志');
      actionRef.current?.reload();
    } catch {
      /* client 已提示 */
    } finally {
      setCleaning(false);
    }
  };

  const columns: ProColumns<AuditRow>[] = [
    { title: 'ID', dataIndex: 'id', width: 76, align: 'center' },
    {
      title: '用户',
      dataIndex: 'username',
      width: 130,
      render: (_, r) =>
        r.username ? (
          <Space size={4}>
            <TeamOutlined style={{ color: C.primary, fontSize: 12 }} />
            <Text style={{ fontSize: 12.5 }}>{r.username}</Text>
          </Space>
        ) : (
          <Text style={{ fontSize: 12.5, color: C.gray }}>-</Text>
        ),
    },
    {
      title: '操作',
      dataIndex: 'action',
      width: 160,
      render: (_, r) => (
        <Tooltip title={r.action}>
          <Tag style={softStyle(C.blue)}>{r.actionName || r.action}</Tag>
        </Tooltip>
      ),
    },
    {
      title: '操作对象',
      dataIndex: 'target_type',
      width: 150,
      render: (_, r) =>
        r.target_type ? (
          <Text style={{ fontSize: 12 }} code>
            {r.target_type}
            {r.target_id ? ` #${r.target_id}` : ''}
          </Text>
        ) : (
          <Text style={{ fontSize: 12, color: C.gray }}>-</Text>
        ),
    },
    {
      title: '详情',
      dataIndex: 'detail',
      render: (_, r) => {
        const text = detailText(r.detail);
        return (
          <Tooltip title={text.length > 60 ? <span style={{ fontSize: 12 }}>{text}</span> : ''}>
            <Text style={{ fontSize: 12, color: text === '-' ? C.gray : C.navy }}>
              {truncate(text, isMobile ? 24 : 80)}
            </Text>
          </Tooltip>
        );
      },
    },
    {
      title: 'IP',
      dataIndex: 'ip',
      width: 140,
      render: (_, r) => (
        <Text style={{ fontSize: 12 }} code>
          {r.ip || '-'}
        </Text>
      ),
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 170,
      render: (_, r) => <Text style={{ fontSize: 12.5 }}>{fmtTime(r.created_at)}</Text>,
    },
  ];

  return (
    <Page
      title="审计日志"
      subTitle={`记录用户关键操作 · 便于追溯与合规 · 共 ${stats.total} 条`}
      extra={
        <Space size={6} wrap>
          <Button icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()}>
            刷新
          </Button>
          {canClean ? (
            <Popconfirm
              title="按保留策略清理"
              description="将删除超过保留天数的审计日志与登录日志，操作不可恢复。"
              okText="清理"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={doCleanup}
            >
              <Button icon={<ClearOutlined />} loading={cleaning}>
                清理过期日志
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      }
    >
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <Row gutter={[12, 12]}>
          {[
            { title: '日志总数', value: stats.total, color: C.blue, icon: <FileSearchOutlined /> },
            { title: '今日操作', value: stats.today, color: C.orange, icon: <ThunderboltOutlined /> },
            { title: '涉及用户', value: stats.users, color: C.green, icon: <TeamOutlined /> },
          ].map((s) => (
            <Col key={s.title} xs={12} md={8}>
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

        {error ? <Alert type="error" showIcon title="审计日志加载失败" description={error} /> : null}

        <Card size="small" style={{ borderColor: C.line }} styles={{ body: { padding: 12 } }}>
          <Space size={8} wrap>
            <Input.Search
              allowClear
              placeholder="搜索用户 / 操作 / 详情 / IP"
              style={{ width: isMobile ? '100%' : 260 }}
              onSearch={(v) => setKeyword(v)}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="全部操作类型"
              style={{ width: isMobile ? '100%' : 200 }}
              options={actionOptions}
              value={action}
              onChange={(v) => setAction(v)}
            />
            <RangePicker
              style={{ width: isMobile ? '100%' : 260 }}
              value={range}
              placeholder={['开始日期', '结束日期']}
              onChange={(v) => setRange(v && v[0] && v[1] ? [v[0], v[1]] : null)}
              disabledDate={(d) => d && d.isAfter(dayjs().endOf('day'))}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                setKeyword('');
                setAction(undefined);
                setRange(null);
              }}
            >
              重置
            </Button>
          </Space>
        </Card>

        <ProTable<AuditRow, AuditFilters>
          rowKey="id"
          actionRef={actionRef}
          columns={columns}
          params={params}
          search={false}
          options={false}
          scroll={{ x: 'max-content' }}
          headerTitle={
            <Space size={8}>
              <FileSearchOutlined style={{ color: C.primary }} />
              <span style={{ fontSize: 13.5, fontWeight: 600, color: C.navy }}>操作记录</span>
            </Space>
          }
          request={async (p) => {
            const current = p.current || 1;
            const pageSize = p.pageSize || 20;
            try {
              const r = await listAuditLogs({
                page: current,
                pageSize,
                keyword: p.keyword,
                action: p.action,
                startDate: p.startDate,
                endDate: p.endDate,
              });
              setStats(r.stats);
              setActions(r.actions || {});
              setError('');
              return { data: r.list, total: r.total, success: true };
            } catch (e) {
              setError(e instanceof Error ? e.message : '需要「查看审计日志」权限');
              return { data: [], total: 0, success: false };
            }
          }}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
          }}
        />
      </Space>
    </Page>
  );
}
