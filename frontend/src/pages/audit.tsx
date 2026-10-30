/** 审计日志：ProTable + 关键词/操作/日期筛选 + 按保留策略清理 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FilterPanel from '@/components/FilterPanel';
import {
  Alert, Button, Card, Col, DatePicker, Grid, Input, Popconfirm, Row, Select, Space,
  Tag, Tooltip, Typography, message,
} from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import {
  ClearOutlined, FileSearchOutlined, ReloadOutlined, TeamOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import Page from '@/components/Page';
import type { StatCardItem } from '@/components/StatCards';
import { useAppStore, usePermission } from '@/stores/app';
import { cleanupAuditLogs, listAuditLogs } from '@/api/users';
import type { AuditRow, AuditStats } from '@/api/users';
import { PALETTE, NEUTRAL } from '@/theme';
import { fmtTime, truncate } from '@/utils';

const { Text } = Typography;
const { RangePicker } = DatePicker;
const { useBreakpoint } = Grid;

const C = {
  primary: PALETTE.primary,
  blue: PALETTE.primary,
  navy: NEUTRAL.text,
  cyan: PALETTE.cyan,
  green: PALETTE.green,
  yellow: PALETTE.yellow,
  orange: PALETTE.orange,
  red: PALETTE.red,
  gray: NEUTRAL.textTertiary,
  line: NEUTRAL.border,
} as const;

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
  const [loading, setLoading] = useState(false);

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

  const statCards = useMemo<StatCardItem[]>(() => [
    { key: 'total', label: '日志总数', value: stats.total, suffix: '条', color: PALETTE.primary },
    { key: 'today', label: '今日操作', value: stats.today, suffix: '条', color: PALETTE.orange },
    { key: 'users', label: '涉及用户', value: stats.users, suffix: '人', color: PALETTE.green },
  ], [stats]);

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
      stats={statCards}
      search={
        <Space size={8} wrap>
          <Input.Search
            allowClear
            placeholder="搜索用户 / 操作 / 详情 / IP"
            style={{ width: isMobile ? '100%' : 220 }}
            onSearch={(v) => setKeyword(v)}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="全部操作类型"
            style={{ width: isMobile ? '100%' : 180 }}
            options={actionOptions}
            value={action}
            onChange={(v) => setAction(v)}
          />
        </Space>
      }
      extra={
        canClean ? (
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
        ) : null
      }
    >
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        {error ? <Alert type="error" showIcon title="审计日志加载失败" description={error} /> : null}

        <FilterPanel
          advanced={
            <RangePicker
              style={{ width: isMobile ? '100%' : 260 }}
              value={range}
              placeholder={['开始日期', '结束日期']}
              onChange={(v) => setRange(v && v[0] && v[1] ? [v[0], v[1]] : null)}
              disabledDate={(d) => d && d.isAfter(dayjs().endOf('day'))}
            />
          }
          activeCount={range ? 1 : 0}
          extra={
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
          }
        >
          <Space size={8} wrap>
            <span style={{ fontSize: 12.5, color: NEUTRAL.textSecondary }}>按时间范围筛选</span>
          </Space>
        </FilterPanel>

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
            setLoading(true);
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
            } finally {
              setLoading(false);
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