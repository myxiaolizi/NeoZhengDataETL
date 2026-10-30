/** 数据源管理：15 大类 / 80+ 类型目录 + V4.1 标准结构 + 动态连接参数 + 连接测试 + 表结构浏览 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Space, Tag, Modal, Collapse, Empty, Alert, Typography, Divider, Badge,
  Table, Tooltip, App, Input, Select, Spin, Grid,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, ApiOutlined, DatabaseOutlined, ThunderboltOutlined,
  TableOutlined, CheckCircleFilled, CloseCircleFilled, ExclamationCircleOutlined,
  AppstoreOutlined, SearchOutlined,
} from '@ant-design/icons';
import {
  ProTable, ModalForm, ProFormText, ProFormDigit, ProFormSelect, ProFormSwitch,
  ProFormTextArea,
} from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import Page from '@/components/Page';
import type { StatCardItem } from '@/components/StatCards';
import { NEUTRAL, PALETTE, statColor } from '@/theme';
import { usePermission } from '@/stores/app';
import { fmtAgo, fmtTime } from '@/utils';
import {
  listDatasources, listDatasourceTypes, getDatasourceType, createDatasource, updateDatasource,
  deleteDatasource, testDatasource, testDatasourceRaw, listDatasourceTables,
  listDatasourceColumns,
} from '@/api/datasources';
import type {
  Datasource, DsColumnInfo, DsStats, DsTableInfo, DsType, DsTypeCategory,
  DatasourcePayload,
} from '@/api/datasources';

const { Text, Paragraph } = Typography;
const { useBreakpoint } = Grid;

/** 连接参数字段的中文标签 */
const FIELD_LABELS: Record<string, string> = {
  host: '主机地址', port: '端口', user: '用户名', password: '密码', database: '数据库名',
  baseUrl: '接口地址', endpoint: 'Endpoint', authType: '鉴权方式', token: 'Token',
  headers: '请求头', index: '索引名', apiKey: 'API Key', namespace: '命名空间',
  username: '用户名', org: '组织', bucket: 'Bucket', brokers: 'Broker 列表',
  topic: 'Topic', groupId: '消费组', saslUser: 'SASL 用户', saslPassword: 'SASL 密码',
  namesrv: 'NameServer', queue: '队列名', serviceUrl: '服务地址', space: '图空间',
  collection: '集合名', path: '路径', wsdl: 'WSDL 地址', query: '查询语句',
  webhook: 'Webhook 地址', secret: '密钥', shopId: '门店 ID', instanceUrl: '实例地址',
  clientId: 'ClientId', clientSecret: 'ClientSecret', mchId: '商户号', apiV3Key: 'APIv3 密钥',
  certPath: '证书路径', sysnr: '系统编号', client: '客户端编号', ashost: '应用服务器',
  warehouse: '仓库', account: '账户', accountId: '账套 ID', tenantId: '租户 ID',
  orgCode: '机构编码', baseId: 'BaseId', sheetId: 'SheetId', appToken: 'AppToken',
  tableId: 'TableId', appId: 'AppId', appKey: 'AppKey', appSecret: 'AppSecret',
  agentId: 'AgentId', corpId: '企业 ID', corpSecret: 'CorpSecret', project: '项目名',
  accessKeyId: 'AccessKeyId', accessKeySecret: 'AccessKeySecret', secretId: 'SecretId',
  secretKey: 'SecretKey', region: '地域', privateKey: '私钥', alipayPublicKey: '支付宝公钥',
  sessionKey: 'SessionKey',
};

/** 需要密码框的字段 */
const SECRET_FIELDS = new Set([
  'password', 'appSecret', 'corpSecret', 'clientSecret', 'accessKeySecret', 'secretKey',
  'token', 'apiKey', 'apiV3Key', 'saslPassword', 'privateKey', 'secret', 'alipayPublicKey',
  'sessionKey',
]);

/** 可落到数据源顶层列的字段，其余进 options */
const TOP_LEVEL_FIELDS = new Set(['host', 'port', 'user', 'password', 'database']);
const DEFAULT_SQL_FIELDS = ['host', 'port', 'user', 'password', 'database'];

/** 需要多行文本的字段 */
const TEXTAREA_FIELDS = new Set(['headers', 'query', 'body']);

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] || key;
}

/** 表单值：顶层列 + options 聚合 */
type DsFormValues = {
  name?: string;
  type?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  remark?: string;
  status?: number | boolean;
  options?: Record<string, unknown>;
};

type TypeMetaMap = Record<string, { name: string; conn: string; available: boolean }>;

export default function DatasourcesPage() {
  const { message, modal } = App.useApp();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const can = usePermission();
  const canWrite = can('datasource:write');

  const actionRef = useRef<ActionType>(null);
  const [allList, setAllList] = useState<Datasource[]>([]);
  const [catalog, setCatalog] = useState<DsTypeCategory[]>([]);
  const [stats, setStats] = useState<DsStats | null>(null);
  const [typeMap, setTypeMap] = useState<TypeMetaMap>({});
  const [loadError, setLoadError] = useState<string>('');

  /* ---------- 搜索筛选 ---------- */
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');

  /* ---------- 详情 / 表结构 Modal ---------- */
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [tablesOpen, setTablesOpen] = useState(false);
  const [tablesRow, setTablesRow] = useState<Datasource | null>(null);

  /* ---------- 新建 / 编辑 ---------- */
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Datasource | null>(null);
  const [typeDetail, setTypeDetail] = useState<DsType | null>(null);
  const [typeLoading, setTypeLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const formRef = useRef<any>(null);

  const applyCatalog = useCallback((list: DsTypeCategory[]) => {
    setCatalog(list);
    const map: TypeMetaMap = {};
    list.forEach((c) => {
      (c.types || []).forEach((t) => {
        map[t.key] = { name: t.name, conn: t.conn, available: t.available };
      });
    });
    setTypeMap(map);
  }, []);

  /** 拉取类型目录（同时得到统计信息） */
  const loadCatalog = useCallback(async () => {
    try {
      const r = await listDatasourceTypes();
      applyCatalog(r.catalog || []);
      setStats(r.stats || null);
    } catch {
      /* 错误已由 client 统一提示 */
    }
  }, [applyCatalog]);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  /** 类型切换：拉取该类型的连接字段定义 */
  const loadTypeDetail = useCallback(async (key: string) => {
    if (!key) return;
    setTypeLoading(true);
    try {
      const d = await getDatasourceType(key);
      setTypeDetail(d);
    } catch {
      setTypeDetail(null);
    } finally {
      setTypeLoading(false);
    }
  }, []);

  const openCreate = () => {
    setEditing(null);
    setTestResult(null);
    setTypeDetail(null);
    setFormOpen(true);
    loadTypeDetail('mysql');
  };

  const openEdit = (row: Datasource) => {
    setEditing(row);
    setTestResult(null);
    setFormOpen(true);
    loadTypeDetail(row.type);
  };

  /** 类型下拉：按类别分组 */
  const typeOptions = useMemo(
    () =>
      catalog.map((c) => ({
        label: `${c.icon} ${c.name}`,
        options: (c.types || []).map((t) => ({
          label: `${t.name}${t.available ? '' : '（驱动未安装）'}`,
          value: t.key,
        })),
      })),
    [catalog]
  );

  /** 当前类型需要渲染的字段 */
  const formFields = useMemo(() => {
    if (!typeDetail) return DEFAULT_SQL_FIELDS;
    return typeDetail.fields && typeDetail.fields.length ? typeDetail.fields : [];
  }, [typeDetail]);

  /** 编辑态初始值：顶层列 + options 展开 */
  const initialValues = useMemo<DsFormValues>(() => {
    if (!editing) return { type: 'mysql', port: 3306, status: 1 };
    const opts = (editing.options || {}) as Record<string, unknown>;
    const options: Record<string, unknown> = {};
    Object.keys(opts).forEach((k) => {
      if (TOP_LEVEL_FIELDS.has(k)) return;
      const v = opts[k];
      options[k] = v && typeof v === 'object' ? JSON.stringify(v, null, 2) : v;
    });
    return {
      name: editing.name,
      type: editing.type,
      host: editing.host,
      port: editing.port,
      user: editing.user,
      database: editing.database,
      remark: editing.remark,
      status: editing.status,
      options,
    };
  }, [editing]);

  /** 提交：拆分顶层列与 options */
  const handleSubmit = async (values: DsFormValues): Promise<boolean> => {
    const type = values.type || 'mysql';
    const payload: Record<string, unknown> = {
      name: values.name,
      type,
      remark: values.remark,
      status: values.status === 0 || values.status === false ? 0 : 1,
    };

    const optionsIn = values.options || {};
    const optionsOut: Record<string, unknown> = {};
    Object.keys(optionsIn).forEach((k) => {
      let v: unknown = optionsIn[k];
      if (v === undefined || v === null || v === '') return;
      if (typeof v === 'string' && /^[[{]/.test(v.trim())) {
        try { v = JSON.parse(v); } catch { /* 保留原文 */ }
      }
      optionsOut[k] = v;
    });

    (['host', 'port', 'user', 'password', 'database'] as const).forEach((k) => {
      const v = values[k];
      if (v !== undefined) payload[k] = v;
    });

    const conn = typeMap[type]?.conn;
    if (conn === 'api') {
      if (!payload.host) {
        payload.host = String(
          (optionsOut.baseUrl as string) || (optionsOut.endpoint as string) ||
          (optionsOut.instanceUrl as string) || (optionsOut.host as string) ||
          (optionsOut.ashost as string) || ''
        );
      }
      if (!payload.database) {
        payload.database = String(
          (optionsOut.database as string) || (optionsOut.project as string) ||
          (optionsOut.bucket as string) || (optionsOut.index as string) ||
          (optionsOut.appId as string) || (optionsOut.corpId as string) ||
          (optionsOut.appKey as string) || (optionsOut.mchId as string) ||
          (optionsOut.namespace as string) || ''
        );
      }
    }

    payload.options = Object.keys(optionsOut).length ? optionsOut : null;
    if (!payload.port && typeDetail?.defaultPort) payload.port = typeDetail.defaultPort;

    try {
      if (editing) {
        if (!values.password) delete payload.password;
        await updateDatasource(editing.id, payload as Partial<DatasourcePayload>);
        message.success('数据源已更新');
      } else {
        await createDatasource(payload as unknown as DatasourcePayload);
        message.success('数据源已创建');
      }
      actionRef.current?.reload();
      setFormOpen(false);
      return true;
    } catch {
      return false;
    }
  };

  /** 表单内测试连接 */
  const handleTestInForm = async () => {
    if (!formRef.current) return;
    let values: DsFormValues;
    try {
      values = await formRef.current.validateFields();
    } catch {
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const r = editing
        ? await testDatasource(editing.id)
        : await testDatasourceRaw({
            type: values.type || 'mysql',
            host: values.host,
            port: values.port,
            user: values.user,
            password: values.password,
            database: values.database,
          });
      const d = r.data;
      const ok = !!(r.ok && d?.ok);
      setTestResult({
        ok,
        text: ok
          ? `连接成功（${d?.elapsed ?? 0}ms）${d?.version ? ' · ' + d.version : ''}`
          : (d?.message || r.message || '连接失败'),
      });
    } finally {
      setTesting(false);
    }
  };

  /** 列表行测试连接 */
  const handleTestRow = async (row: Datasource) => {
    const hide = message.loading(`正在测试「${row.name}」…`, 0);
    try {
      const r = await testDatasource(row.id);
      const d = r.data;
      if (r.ok && d?.ok) {
        message.success(`「${row.name}」连接成功（${d.elapsed ?? 0}ms）${d.version ? ' · ' + d.version : ''}`);
      } else {
        message.error(`「${row.name}」连接失败：${d?.message || r.message || '未知错误'}`);
      }
      actionRef.current?.reload();
    } finally {
      hide();
    }
  };

  const handleDelete = (row: Datasource) => {
    modal.confirm({
      title: `删除数据源「${row.name}」`,
      icon: <ExclamationCircleOutlined style={{ color: PALETTE.red }} />,
      content: '删除后不可恢复；若已被项目或数据集引用将无法删除。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteDatasource(row.id);
          message.success('数据源已删除');
          actionRef.current?.reload();
        } catch { /* client 已提示 */ }
      },
    });
  };

  /** V4.1 数据卡片（5 个：数据源总数 / MySQL 数 / 非 MySQL 数 / 连接失败数 / 最近更新） */
  const statItems = useMemo<StatCardItem[]>(() => {
    const total = allList.length;
    const mysqlCount = allList.filter((d) => String(d.type || '').toLowerCase().includes('mysql')).length;
    const nonMysqlCount = total - mysqlCount;
    const failedCount = allList.filter((d) => d.lastTestOk === false).length;
    const latestTime = allList.reduce<string>((acc, d) => {
      const t = d.updatedAt || d.lastTestAt || d.createdAt || '';
      return t && (!acc || new Date(t).getTime() > new Date(acc).getTime()) ? t : acc;
    }, '');

    return [
      {
        key: 'total',
        label: '数据源总数',
        value: total,
        suffix: '个',
        color: PALETTE.primary,
        hint: stats ? `支持 ${stats.types} 种类型` : undefined,
        onClick: () => setTypeFilter(''),
      },
      {
        key: 'mysql',
        label: 'MySQL 数',
        value: mysqlCount,
        suffix: '个',
        color: PALETTE.cyan,
        onClick: () => setTypeFilter('mysql'),
      },
      {
        key: 'nonMysql',
        label: '非 MySQL 数',
        value: nonMysqlCount,
        suffix: '个',
        color: PALETTE.green,
        hint: stats ? `含 API ${stats.apiTypes} 种` : undefined,
      },
      {
        key: 'failed',
        label: '连接失败数',
        value: failedCount,
        suffix: '个',
        color: failedCount > 0 ? PALETTE.red : PALETTE.teal,
        hint: failedCount > 0 ? '请检查连接参数' : '全部正常或待测试',
      },
      {
        key: 'latest',
        label: '最近更新',
        value: latestTime ? fmtAgo(latestTime) : '暂无',
        color: PALETTE.violet,
        hint: latestTime ? fmtTime(latestTime, 'YYYY-MM-DD HH:mm') : undefined,
      },
    ];
  }, [allList, stats]);

  /* ---------- 列定义 ---------- */
  const columns: ProColumns<Datasource>[] = [
    {
      title: '数据源名称',
      dataIndex: 'name',
      width: 220,
      sorter: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
      render: (_, row) => (
        <Space size={6} wrap>
          <DatabaseOutlined style={{ color: row.isDefault ? PALETTE.primaryDeep : PALETTE.primary }} />
          <Text strong style={{ color: NEUTRAL.text }}>{row.name}</Text>
          {row.isDefault ? <Tag color={PALETTE.primary}>默认</Tag> : null}
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 190,
      sorter: (a, b) => String(a.type || '').localeCompare(String(b.type || '')),
      render: (_, row) => {
        const meta = typeMap[row.type];
        return (
          <Space size={4} wrap>
            <Tag color={meta?.conn === 'api' ? PALETTE.cyan : PALETTE.primary} style={{ marginInlineEnd: 0 }}>
              {meta?.name || row.type}
            </Tag>
            <Tag color={meta?.conn === 'api' ? PALETTE.gray : PALETTE.green} style={{ marginInlineEnd: 0 }}>
              {meta?.conn === 'api' ? 'API' : 'SQL'}
            </Tag>
          </Space>
        );
      },
    },
    {
      title: '连接地址',
      dataIndex: 'host',
      width: 250,
      ellipsis: true,
      render: (_, row) => (
        <Space size={2} direction="vertical" style={{ fontSize: 12.5 }}>
          <Text code style={{ fontSize: 12.5 }}>
            {row.host || '-'}{row.port ? `:${row.port}` : ''}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.database || '（无库名）'}{row.user ? ` · ${row.user}` : ''}
          </Text>
        </Space>
      ),
    },
    {
      title: '连接状态',
      dataIndex: 'lastTestOk',
      width: 150,
      sorter: (a, b) => Number(a.lastTestOk ?? -1) - Number(b.lastTestOk ?? -1),
      render: (_, row) => {
        if (row.lastTestOk === null || row.lastTestOk === undefined) {
          return <Tag color={PALETTE.gray}>未测试</Tag>;
        }
        return row.lastTestOk ? (
          <Tooltip title={row.lastTestMsg || '连接正常'}>
            <Tag icon={<CheckCircleFilled />} color={PALETTE.green}>正常</Tag>
          </Tooltip>
        ) : (
          <Tooltip title={row.lastTestMsg || '连接失败'}>
            <Tag icon={<CloseCircleFilled />} color={PALETTE.red}>失败</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '启用',
      dataIndex: 'status',
      width: 90,
      sorter: (a, b) => Number(a.status || 0) - Number(b.status || 0),
      render: (_, row) =>
        row.status ? <Badge status="processing" text="启用" /> : <Badge status="default" text="停用" />,
    },
    {
      title: '最近测试',
      dataIndex: 'lastTestAt',
      width: 165,
      sorter: (a, b) => new Date(a.lastTestAt || 0).getTime() - new Date(b.lastTestAt || 0).getTime(),
      render: (_, row) => <Text type="secondary" style={{ fontSize: 12.5 }}>{fmtTime(row.lastTestAt)}</Text>,
    },
    {
      title: '备注',
      dataIndex: 'remark',
      ellipsis: true,
      render: (_, row) => row.remark || <Text type="secondary">-</Text>,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 210,
      fixed: 'right',
      render: (_, row) => {
        const items: React.ReactNode[] = [
          <a key="test" onClick={() => handleTestRow(row)}>
            <ThunderboltOutlined /> 测试
          </a>,
          <a key="tables" onClick={() => { setTablesRow(row); setTablesOpen(true); }}>
            <TableOutlined /> 表结构
          </a>,
        ];
        if (canWrite) {
          items.push(<a key="edit" onClick={() => openEdit(row)}>编辑</a>);
          if (!row.isDefault) {
            items.push(
              <a key="del" style={{ color: PALETTE.red }} onClick={() => handleDelete(row)}>删除</a>
            );
          }
        }
        return <Space size={12} wrap>{items}</Space>;
      },
    },
  ];

  return (
    <Page
      title="数据源"
      search={
        <>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="类型筛选"
            value={typeFilter || undefined}
            onChange={(v) => setTypeFilter(v || '')}
            options={typeOptions}
            style={{ width: isMobile ? 150 : 200 }}
          />
          <Input.Search
            allowClear
            placeholder="搜索名称 / 主机 / 库名 / 备注"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={(v) => setKeyword(v)}
            style={{ width: isMobile ? 190 : 260 }}
          />
        </>
      }
      actions={
        canWrite ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建数据源
          </Button>
        ) : undefined
      }
      extra={
        <>
          <Button icon={<AppstoreOutlined />} onClick={() => setTypeModalOpen(true)}>
            类型目录{stats ? `（${stats.types}）` : ''}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => { loadCatalog(); actionRef.current?.reload(); }}>
            刷新
          </Button>
        </>
      }
      stats={statItems}
    >
      {loadError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          title="加载数据源列表失败"
          description={loadError}
          action={
            <Button size="small" onClick={() => actionRef.current?.reload()}>
              重试
            </Button>
          }
        />
      )}

      <ProTable<Datasource, { keyword?: string; typeKey?: string }>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        params={{ keyword, typeKey: typeFilter }}
        scroll={{ x: 'max-content' }}
        search={false}
        options={{ density: false, fullScreen: true, setting: true, reload: false }}
        pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
        headerTitle="数据源列表"
        locale={{ emptyText: <Empty description={keyword || typeFilter ? '没有符合条件的数据源' : '暂无数据源'} /> }}
        request={async (params) => {
          setLoadError('');
          try {
            const r = await listDatasources();
            let list = r.list || [];
            setAllList(list);
            if (r.catalog) applyCatalog(r.catalog);
            if (r.stats) setStats(r.stats);
            const kw = (params.keyword || '').trim().toLowerCase();
            if (kw) {
              list = list.filter((d) =>
                [d.name, d.host, d.database, d.user, d.remark, d.type]
                  .filter(Boolean)
                  .some((v) => String(v).toLowerCase().includes(kw))
              );
            }
            if (params.typeKey) list = list.filter((d) => d.type === params.typeKey);
            return { data: list, total: list.length, success: true };
          } catch (e) {
            setLoadError(e instanceof Error ? e.message : '请求失败');
            return { data: [], total: 0, success: false };
          }
        }}
      />

      {/* ---------- 类型目录弹窗（Modal） ---------- */}
      <Modal
        title="数据源类型目录"
        open={typeModalOpen}
        onCancel={() => setTypeModalOpen(false)}
        footer={
          <Button onClick={() => setTypeModalOpen(false)}>关闭</Button>
        }
        width={isMobile ? '94vw' : 780}
        destroyOnHidden
      >
        <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
          共 {stats?.categories ?? 0} 个类别、{stats?.types ?? 0} 种类型。标记「需驱动」的类型需先在服务端安装对应 npm 驱动包后才能连通。
        </Paragraph>
        <div style={{ maxHeight: '65vh', overflowY: 'auto', paddingRight: 4 }}>
          <Collapse
            defaultActiveKey={catalog.slice(0, 2).map((c) => c.key)}
            items={catalog.map((c, ci) => ({
              key: c.key,
              label: (
                <Space>
                  <span style={{ fontSize: 15 }}>{c.icon}</span>
                  <Text strong style={{ color: NEUTRAL.text }}>{c.name}</Text>
                  <Tag color={statColor(ci)} style={{ color: NEUTRAL.textInverse }}>
                    {c.types?.length || 0} 种
                  </Tag>
                </Space>
              ),
              children: (
                <>
                  <Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 10 }}>
                    {c.desc}
                  </Paragraph>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                    {(c.types || []).map((t) => (
                      <div
                        key={t.key}
                        style={{
                          border: `1px solid ${NEUTRAL.border}`,
                          borderRadius: 8,
                          padding: '8px 10px',
                          background: t.available ? NEUTRAL.surface : NEUTRAL.surfaceAlt,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                          <Text strong style={{ fontSize: 13, color: NEUTRAL.text }}>{t.name}</Text>
                          {t.available ? (
                            <Tag color={PALETTE.green} style={{ marginInlineEnd: 0, fontSize: 11 }}>可用</Tag>
                          ) : (
                            <Tag color={PALETTE.yellow} style={{ marginInlineEnd: 0, fontSize: 11 }}>需驱动</Tag>
                          )}
                        </div>
                        <div style={{ fontSize: 11.5, color: NEUTRAL.textSecondary, marginTop: 4 }}>
                          {t.conn === 'api' ? <ApiOutlined /> : <DatabaseOutlined />} {t.conn.toUpperCase()}
                          {t.defaultPort ? ` · ${t.defaultPort}` : ''}
                        </div>
                        {t.driverPkg && (
                          <div style={{ fontSize: 11, color: NEUTRAL.textTertiary, marginTop: 2 }}>{t.driverPkg}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ),
            }))}
          />
        </div>
      </Modal>

      {/* ---------- 表结构浏览弹窗（Modal） ---------- */}
      <TablesModal open={tablesOpen} row={tablesRow} onClose={() => setTablesOpen(false)} />

      {/* ---------- 新建 / 编辑（ModalForm） ---------- */}
      <ModalForm<DsFormValues>
        title={editing ? `编辑数据源 · ${editing.name}` : '新建数据源'}
        open={formOpen}
        onOpenChange={(o) => { setFormOpen(o); if (!o) setTestResult(null); }}
        formRef={formRef}
        width={isMobile ? '94vw' : 640}
        initialValues={initialValues}
        onFinish={handleSubmit}
        submitter={{
          searchConfig: { submitText: editing ? '保存' : '创建', resetText: '取消' },
          render: (_props, dom) => [
            ...dom,
            <Button key="test" icon={<ThunderboltOutlined />} loading={testing} onClick={handleTestInForm}>
              测试连接
            </Button>,
          ],
        }}
        onValuesChange={(changed: Partial<DsFormValues>) => {
          if (changed.type !== undefined) {
            setTestResult(null);
            loadTypeDetail(changed.type);
          }
        }}
        modalProps={{ destroyOnHidden: true }}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="连接参数按所选类型动态生成"
          description="SQL 类填写主机/端口/账号/库名；API 类填写接口地址与鉴权参数。编辑时留空密码表示不修改。"
        />

        <ProFormText
          name="name"
          label="数据源名称"
          placeholder="如：生产库 MySQL / 阿里云 OSS"
          rules={[{ required: true, message: '请输入数据源名称' }]}
        />

        <ProFormSelect
          name="type"
          label="数据源类型"
          options={typeOptions}
          rules={[{ required: true, message: '请选择类型' }]}
          fieldProps={{ showSearch: true, optionFilterProp: 'label' }}
          placeholder="请选择类型"
        />

        <Divider style={{ margin: '4px 0 16px' }}>连接参数</Divider>

        {typeLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
        ) : formFields.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="该类型无需额外连接参数（如 Webhook 接收）"
            style={{ margin: '12px 0 20px' }}
          />
        ) : (
          formFields.map((key) => {
            const label = fieldLabel(key);
            const required = key === 'host' || key === 'baseUrl' || key === 'endpoint';
            if (key === 'port') {
              return (
                <ProFormDigit
                  key={key}
                  name="port"
                  label={label}
                  min={0}
                  max={65535}
                  fieldProps={{ precision: 0, style: { width: '100%' } }}
                  placeholder={typeDetail?.defaultPort ? String(typeDetail.defaultPort) : '默认端口'}
                />
              );
            }
            if (SECRET_FIELDS.has(key)) {
              return (
                <ProFormText.Password
                  key={key}
                  name={TOP_LEVEL_FIELDS.has(key) ? key : ['options', key]}
                  label={label}
                  placeholder={editing ? '留空表示不修改' : `请输入${label}`}
                />
              );
            }
            if (TEXTAREA_FIELDS.has(key)) {
              return (
                <ProFormTextArea
                  key={key}
                  name={['options', key]}
                  label={key === 'headers' ? `${label}（JSON）` : label}
                  placeholder={key === 'headers' ? '{"X-Token":"xxx"}' : `请输入${label}`}
                  fieldProps={{ autoSize: { minRows: 2, maxRows: 6 } }}
                />
              );
            }
            return (
              <ProFormText
                key={key}
                name={TOP_LEVEL_FIELDS.has(key) ? key : ['options', key]}
                label={label}
                rules={required ? [{ required: true, message: `请输入${label}` }] : undefined}
                placeholder={`请输入${label}`}
              />
            );
          })
        )}

        <Divider style={{ margin: '4px 0 16px' }}>其他</Divider>

        <ProFormTextArea
          name="remark"
          label="备注"
          placeholder="用途说明，便于团队协作"
          fieldProps={{ autoSize: { minRows: 2, maxRows: 4 } }}
        />
        <ProFormSwitch name="status" label="启用该数据源" />

        {testResult && (
          <Alert
            type={testResult.ok ? 'success' : 'error'}
            showIcon
            style={{ marginTop: 8 }}
            title={testResult.text}
          />
        )}
      </ModalForm>
    </Page>
  );
}

/* ══════════════════════════════════════════════════════════
 *  表结构浏览弹窗：数据表列表 + 字段（Modal）
 * ══════════════════════════════════════════════════════════ */

function TablesModal({
  open,
  row,
  onClose,
}: {
  open: boolean;
  row: Datasource | null;
  onClose: () => void;
}) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [tables, setTables] = useState<DsTableInfo[]>([]);
  const [active, setActive] = useState<string>('');
  const [columns, setColumns] = useState<DsColumnInfo[]>([]);
  const [colLoading, setColLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const loadTables = useCallback(async (kw: string) => {
    if (!row) return;
    setLoading(true);
    setError('');
    try {
      const list = await listDatasourceTables(row.id, kw || undefined);
      setTables(list || []);
      if (list && list.length) setActive(list[0].name);
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取数据表失败');
      setTables([]);
    } finally {
      setLoading(false);
    }
  }, [row]);

  useEffect(() => {
    if (!open || !row) return;
    setKeyword('');
    setActive('');
    setColumns([]);
    loadTables('');
  }, [open, row, loadTables]);

  useEffect(() => {
    if (!open || !row || !active) { setColumns([]); return; }
    let cancelled = false;
    setColLoading(true);
    listDatasourceColumns(row.id, active)
      .then((cols) => { if (!cancelled) setColumns(cols || []); })
      .catch(() => { if (!cancelled) setColumns([]); })
      .finally(() => { if (!cancelled) setColLoading(false); });
    return () => { cancelled = true; };
  }, [open, row, active]);

  return (
    <Modal
      title={`表结构 · ${row?.name || ''}`}
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
      width={isMobile ? '94vw' : 900}
      destroyOnHidden
    >
      <Space style={{ marginBottom: 12 }} wrap>
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: NEUTRAL.textTertiary }} />}
          placeholder="搜索表名"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={() => loadTables(keyword)}
          style={{ width: isMobile ? 200 : 260 }}
        />
        <Button onClick={() => loadTables(keyword)} loading={loading}>搜索</Button>
        <Text type="secondary" style={{ fontSize: 12.5 }}>共 {tables.length} 张表</Text>
      </Space>

      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} />}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '260px 1fr', gap: 12 }}>
        <div style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 10, maxHeight: isMobile ? 220 : 460, overflow: 'auto' }}>
          {tables.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可读取的数据表" style={{ margin: '40px 0' }} />
          ) : (
            tables.map((t) => {
              const on = t.name === active;
              return (
                <div
                  key={t.name}
                  onClick={() => setActive(t.name)}
                  style={{
                    padding: '9px 12px',
                    cursor: 'pointer',
                    borderBottom: `1px solid ${NEUTRAL.borderSubtle}`,
                    background: on ? NEUTRAL.surfaceSunken : 'transparent',
                    color: on ? PALETTE.primary : NEUTRAL.text,
                    fontWeight: on ? 600 : 400,
                    fontSize: 13,
                  }}
                >
                  <TableOutlined style={{ marginRight: 6, color: on ? PALETTE.primary : NEUTRAL.textTertiary }} />
                  {t.name}
                  {t.comment ? (
                    <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary, marginTop: 2 }}>{t.comment}</div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <div style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 10, padding: 12, minHeight: 200 }}>
          {!active ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择数据表" style={{ margin: '40px 0' }} />
          ) : (
            <>
              <Text strong style={{ color: NEUTRAL.text }}>{active}</Text>
              <Text type="secondary" style={{ fontSize: 12.5, marginLeft: 8 }}>{columns.length} 个字段</Text>
              <Table<DsColumnInfo>
                size="small"
                rowKey="name"
                style={{ marginTop: 10 }}
                loading={colLoading}
                pagination={false}
                scroll={{ x: 'max-content', y: 360 }}
                dataSource={columns}
                columns={[
                  {
                    title: '字段名',
                    dataIndex: 'name',
                    width: 220,
                    render: (v: string) => <Text code style={{ fontSize: 12.5 }}>{v}</Text>,
                  },
                  { title: '类型', dataIndex: 'type', width: 150, render: (v?: string) => v || '-' },
                  {
                    title: '注释',
                    dataIndex: 'comment',
                    render: (v?: string) => v || <Text type="secondary">-</Text>,
                  },
                ]}
              />
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
