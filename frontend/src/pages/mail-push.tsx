/**
 * 邮箱推送
 *   6 个页签：概览 / 数据项目 / 邮箱账户 / 邮件浏览 / 导入日志 / 运行设置
 *   真实接口：/api/mail-push/*（见 src/routes/api.js 与 src/mail-inbox.js）
 *
 *   「数据项目」= 邮件 Excel 附件入库后的数据管理（V3.6 已有能力，V4 重构时丢失，
 *   2026-10-30 补回）：项目卡片 → 抽屉内查看/搜索/排序/分页/导出 CSV/改名/清空/删除。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NEUTRAL, PALETTE, SHADOW } from '@/theme';
import type { StatCardItem } from '@/components/StatCards';
import {
  Button, Space, Tag, App, Typography, Tabs, Card, Statistic, Alert, Descriptions,
  Empty, Spin, Badge, Tooltip, Progress, Switch, Input, Table, Segmented, Divider,
  Form, InputNumber, Select, Modal,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  PlusOutlined, ReloadOutlined, PlayCircleOutlined, MailOutlined, EditOutlined, DeleteOutlined,
  ThunderboltOutlined, EyeOutlined, PaperClipOutlined, CheckCircleFilled, CloseCircleFilled,
  InboxOutlined, SearchOutlined, ClockCircleOutlined, SyncOutlined, DownloadOutlined,
} from '@ant-design/icons';
import {
  ProTable, ModalForm, ProFormText, ProFormDigit, ProFormSwitch,
} from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import Page from '@/components/Page';
import { useAppStore, usePermission } from '@/stores/app';
import { fmtTime, fmtAgo, fmtNum, fmtSize, truncate } from '@/utils';
import {
  listMailAccounts, createMailAccount, updateMailAccount, deleteMailAccount, toggleMailAccount,
  listMailPresets, testMailAccount, listMailMessages, getMailMessage, runMailPush,
  getMailPushStatus, getMailPushOverview, listMailLogs, getMailPushSettings, saveMailPushSettings,
  listMailProjects,
  mailProjectExportUrl,
} from '@/api/mail-push';
import type {
  MailAccount, MailAccountPayload, MailLogRow, MailMessageDetail, MailMessageSummary,
  MailPreset, MailProject, MailPushOverview, MailPushStatus,
} from '@/api/mail-push';

const { Text, Paragraph } = Typography;

/** 账户表单值 */
type AccountFormValues = {
  name?: string;
  email?: string;
  password?: string;
  imap_host?: string;
  imap_port?: number;
  imap_secure?: number | boolean;
  mailbox?: string;
  enabled?: number | boolean;
  auto_import?: number | boolean;
  initial_days?: number;
  max_per_run?: number;
};

type SettingsFormValues = {
  enabled?: number | boolean;
  interval?: number;
  initial_days?: number;
  max_per_run?: number;
};

const RESULT_META: Record<string, { label: string; color: string }> = {
  success: { label: '成功', color: PALETTE.green },
  skipped: { label: '跳过', color: PALETTE.yellow },
  failed: { label: '失败', color: PALETTE.red },
};

export default function MailPushPage() {
  const { message, modal } = App.useApp();
  const can = usePermission();
  const canSettings = can('settings:write');
  const canRun = can('project:write');
  /** 读取数据表行 / 导出 CSV 需要 data:read；改名/清空/删除项目需要 project:write */
  const canData = can('data:read');
  const canProjectWrite = can('project:write');
  const canLogRead = can('log:read');

  const [tab, setTab] = useState('overview');

  /* 全局数据 */
  const [overview, setOverview] = useState<MailPushOverview | null>(null);
  const [status, setStatus] = useState<MailPushStatus | null>(null);
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [presets, setPresets] = useState<MailPreset[]>([]);
  const [loadingTop, setLoadingTop] = useState(true);
  const [running, setRunning] = useState(false);

  /* 账户编辑 */
  const [accountOpen, setAccountOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<MailAccount | null>(null);
  const [testingAccount, setTestingAccount] = useState(false);
  const [accountTestMsg, setAccountTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const accountFormRef = useRef<any>(null);

  /* 邮件浏览 */
  const [browseAccountId, setBrowseAccountId] = useState<number | null>(null);
  const [messages, setMessages] = useState<MailMessageSummary[]>([]);
  const [msgTotal, setMsgTotal] = useState(0);
  const [msgLoading, setMsgLoading] = useState(false);
  const [onlyAtt, setOnlyAtt] = useState(false);
  const [msgPage, setMsgPage] = useState(1);
  const [msgError, setMsgError] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<MailMessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailUid, setDetailUid] = useState<number | null>(null);

  /* 日志 */
  const [logs, setLogs] = useState<MailLogRow[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logKeyword, setLogKeyword] = useState('');
  const [logResult, setLogResult] = useState<string>('');
  const [logProjectId, setLogProjectId] = useState<number | undefined>(undefined);

  /* 数据项目（邮件附件导入后的数据管理） */
  const [projects, setProjects] = useState<MailProject[]>([]);
  const [projLoading, setProjLoading] = useState(false);
  const [projKeyword, setProjKeyword] = useState('');

  /** 抽屉：当前项目 */
  const navigate = useNavigate();

  /* 设置 */
  const settingsFormRef = useRef<any>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsValues, setSettingsValues] = useState<SettingsFormValues>({
    enabled: false, interval: 5, initial_days: 7, max_per_run: 50,
  });

  const accountActionRef = useRef<ActionType>(null);
  const logActionRef = useRef<ActionType>(null);

  /** 顶部概览 + 状态 + 账户 + 预置 + 数据项目 */
  const loadTop = useCallback(async () => {
    setLoadingTop(true);
    try {
      const [ov, st, acc, pre, prj] = await Promise.all([
        getMailPushOverview().catch(() => null),
        getMailPushStatus().catch(() => null),
        listMailAccounts().catch(() => [] as MailAccount[]),
        listMailPresets().catch(() => [] as MailPreset[]),
        listMailProjects().catch(() => [] as MailProject[]),
      ]);
      if (ov) setOverview(ov);
      if (st) setStatus(st);
      setAccounts(acc || []);
      setPresets(pre || []);
      setProjects(prj || []);
      if (!browseAccountId && acc && acc.length) setBrowseAccountId(acc[0].id);
    } finally {
      setLoadingTop(false);
    }
  }, [browseAccountId]);

  useEffect(() => { loadTop(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /** 设置读取 */
  const loadSettings = useCallback(async () => {
    try {
      const s = await getMailPushSettings();
      setSettingsValues({
        enabled: s.enabled,
        interval: s.interval,
        initial_days: s.initial_days,
        max_per_run: s.max_per_run,
      });
      settingsFormRef.current?.setFieldsValue({
        enabled: s.enabled,
        interval: s.interval,
        initial_days: s.initial_days,
        max_per_run: s.max_per_run,
      });
    } catch { /* client 已提示 */ }
  }, [settingsFormRef]);

  useEffect(() => {
    if (tab === 'settings') loadSettings();
  }, [tab, loadSettings]);

  /** 手动拉取 */
  const handleRun = async (accountId?: number) => {
    setRunning(true);
    try {
      const r = await runMailPush({ force: true, accountId: accountId ?? null });
      const d = r.data;
      if (r.ok && d?.ok !== false) {
        message.success(
          d?.message ||
          `拉取完成：导入 ${d?.imported ?? 0} 个附件（跳过 ${d?.skipped ?? 0}，失败 ${d?.failed ?? 0}）`
        );
      } else {
        message.warning(d?.message || r.message || '拉取未执行成功');
      }
      loadTop();
      if (tab === 'logs') logActionRef.current?.reload();
    } finally {
      setRunning(false);
    }
  };

  /* ---------- 账户增删改 ---------- */
  const openCreateAccount = () => {
    setEditingAccount(null);
    setAccountTestMsg(null);
    setAccountOpen(true);
  };

  const openEditAccount = (row: MailAccount) => {
    setEditingAccount(row);
    setAccountTestMsg(null);
    setAccountOpen(true);
  };

  const accountInitial = useMemo<AccountFormValues>(() => {
    if (!editingAccount) {
      return {
        imap_host: 'imap.qiye.aliyun.com',
        imap_port: 993,
        imap_secure: 1,
        mailbox: 'INBOX',
        enabled: 1,
        auto_import: 1,
        initial_days: 7,
        max_per_run: 50,
      };
    }
    return {
      name: editingAccount.name,
      email: editingAccount.email,
      imap_host: editingAccount.imap_host,
      imap_port: editingAccount.imap_port,
      imap_secure: editingAccount.imap_secure,
      mailbox: editingAccount.mailbox,
      enabled: editingAccount.enabled,
      auto_import: editingAccount.auto_import,
      initial_days: editingAccount.initial_days,
      max_per_run: editingAccount.max_per_run,
    };
  }, [editingAccount]);

  const handleAccountSubmit = async (values: AccountFormValues): Promise<boolean> => {
    const payload: MailAccountPayload = {
      name: values.name || values.email,
      email: values.email,
      imap_host: values.imap_host,
      imap_port: values.imap_port,
      imap_secure: Number(values.imap_secure) ? 1 : 0,
      mailbox: values.mailbox,
      enabled: Number(values.enabled) ? 1 : 0,
      auto_import: Number(values.auto_import) ? 1 : 0,
      initial_days: values.initial_days,
      max_per_run: values.max_per_run,
    };
    if (values.password) payload.password = values.password;
    try {
      if (editingAccount) {
        await updateMailAccount(editingAccount.id, payload);
        message.success('邮箱账户已保存');
      } else {
        if (!values.password) {
          message.error('新建账户必须填写密码 / 授权码');
          return false;
        }
        await createMailAccount(payload);
        message.success('邮箱账户已添加');
      }
      setAccountOpen(false);
      loadTop();
      accountActionRef.current?.reload();
      return true;
    } catch {
      return false;
    }
  };

  /** 账户表单内测试连接 */
  const handleAccountTest = async () => {
    if (!accountFormRef.current) return;
    let values: AccountFormValues;
    try {
      values = await accountFormRef.current.validateFields();
    } catch {
      return;
    }
    setTestingAccount(true);
    setAccountTestMsg(null);
    try {
      const r = await testMailAccount({
        id: editingAccount?.id,
        email: values.email,
        password: values.password,
        imap_host: values.imap_host,
        imap_port: values.imap_port,
        imap_secure: Number(values.imap_secure) ? 1 : 0,
        mailbox: values.mailbox,
      });
      const d = r.data;
      const ok = !!(r.ok && d?.ok);
      setAccountTestMsg({
        ok,
        text: d?.message ? `${d.message}${d.total !== undefined ? `（共 ${d.total} 封）` : ''}` : (r.message || '测试完成'),
      });
    } finally {
      setTestingAccount(false);
    }
  };

  const handleToggleAccount = async (row: MailAccount, on: boolean) => {
    try {
      await toggleMailAccount(row.id, on);
      message.success(on ? `「${row.email}」已启用` : `「${row.email}」已停用`);
      loadTop();
      accountActionRef.current?.reload();
    } catch { /* client 已提示 */ }
  };

  const handleDeleteAccount = (row: MailAccount) => {
    modal.confirm({
      title: `删除邮箱账户「${row.email}」`,
      icon: <CloseCircleFilled style={{ color: 'PALETTE.red' }} />,
      content: '删除后该账户不再自动拉取邮件，已导入的项目数据不受影响。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteMailAccount(row.id);
          message.success('邮箱账户已删除');
          loadTop();
          accountActionRef.current?.reload();
        } catch { /* client 已提示 */ }
      },
    });
  };

  /* ---------- 邮件浏览 ---------- */
  const loadMessages = useCallback(async (accountId: number, page: number, only: boolean) => {
    setMsgLoading(true);
    setMsgError('');
    try {
      const limit = 30;
      const r = await listMailMessages(accountId, {
        limit,
        offset: (page - 1) * limit,
        onlyAttachments: only,
      });
      setMessages(r.messages || []);
      setMsgTotal(r.total || 0);
    } catch (e) {
      setMsgError(e instanceof Error ? e.message : '读取邮件失败');
      setMessages([]);
      setMsgTotal(0);
    } finally {
      setMsgLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'messages' || !browseAccountId) return;
    loadMessages(browseAccountId, msgPage, onlyAtt);
  }, [tab, browseAccountId, msgPage, onlyAtt, loadMessages]);

  const openMessage = async (row: MailMessageSummary) => {
    if (!browseAccountId) return;
    setDetailOpen(true);
    setDetail(null);
    setDetailUid(row.uid);
    setDetailLoading(true);
    try {
      const d = await getMailMessage(browseAccountId, row.uid);
      setDetail(d);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  /* ---------- 日志 ---------- */
  const loadLogs = useCallback(async (keyword: string, result: string, projectId?: number) => {
    setLogLoading(true);
    try {
      const rows = await listMailLogs({
        limit: 200,
        keyword: keyword || undefined,
        result: result || undefined,
        projectId: projectId || undefined,
      });
      setLogs(rows || []);
    } finally {
      setLogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'logs') loadLogs('', '', undefined);
  }, [tab, loadLogs]);

  /* ---------- 数据项目：列表 / 抽屉数据 ---------- */
  const loadProjects = useCallback(async () => {
    setProjLoading(true);
    try {
      const list = await listMailProjects();
      setProjects(list || []);
    } catch {
      setProjects([]);
    } finally {
      setProjLoading(false);
    }
  }, []);

  const visibleProjects = useMemo(() => {
    const kw = projKeyword.trim().toLowerCase();
    if (!kw) return projects;
    return projects.filter((p) =>
      `${p.name} ${p.code || ''} ${p.data_table} ${p.source_mail || ''}`.toLowerCase().includes(kw)
    );
  }, [projects, projKeyword]);

  /** 按项目名反查 id（导入日志 / 最近导入里只有名称时用） */
  const projectIdByName = useCallback(
    (name?: string, id?: number | null): number | null => {
      if (id) return Number(id);
      if (!name) return null;
      const hit = projects.find((p) => p.name === name);
      return hit ? hit.id : null;
    },
    [projects]
  );

  const openProject = useCallback((id: number) => navigate(`/mail-push/projects/${id}`), [navigate]);

  const exportProject = useCallback((id: number) => {
    const a = document.createElement('a');
    a.href = mailProjectExportUrl(id);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    message.info('已发起 CSV 导出，请留意浏览器下载');
  }, [message]);

  /* ---------- 设置保存 ---------- */
  const handleSaveSettings = async () => {
    if (!settingsFormRef.current) return;
    let values: SettingsFormValues;
    try {
      values = await settingsFormRef.current.validateFields();
    } catch {
      return;
    }
    setSettingsSaving(true);
    try {
      await saveMailPushSettings({
        enabled: !!values.enabled,
        interval: values.interval,
        initial_days: values.initial_days,
        max_per_run: values.max_per_run,
      });
      message.success('设置已保存，轮询已按新周期重启');
      loadSettings();
      loadTop();
    } catch { /* client 已提示 */ } finally {
      setSettingsSaving(false);
    }
  };

  /* ---------- 账户列 ---------- */
  const accountColumns: ProColumns<MailAccount>[] = [
    {
      title: '邮箱账户',
      dataIndex: 'email',
      width: 260,
      render: (_, row) => (
        <Space size={6} direction="vertical">
          <Space size={6} wrap>
            <MailOutlined style={{ color: PALETTE.primary }} />
            <Text strong style={{ color: NEUTRAL.text }}>{row.email}</Text>
            {Number(row.enabled) === 1
              ? <Tag color="PALETTE.green">启用</Tag>
              : <Tag color={NEUTRAL.textTertiary}>停用</Tag>}
            {row.hasPassword === false && <Tag color="PALETTE.red">未设密码</Tag>}
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.name}</Text>
        </Space>
      ),
    },
    {
      title: 'IMAP 服务器',
      dataIndex: 'imap_host',
      width: 250,
      render: (_, row) => (
        <Space size={2} direction="vertical" style={{ fontSize: 12.5 }}>
          <Text code style={{ fontSize: 12 }}>{row.imap_host}:{row.imap_port}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {Number(row.imap_secure) ? 'SSL' : '明文'} · 文件夹 {row.mailbox}
          </Text>
        </Space>
      ),
    },
    {
      title: '拉取进度',
      dataIndex: 'last_uid',
      width: 190,
      render: (_, row) => (
        <Space size={2} direction="vertical" style={{ fontSize: 12.5 }}>
          <Text>last UID {fmtNum(row.last_uid)}</Text>
          <Text type="secondary" style={{ fontSize: 11.5 }}>
            单次 {row.max_per_run} 封 · 回溯 {row.initial_days} 天
          </Text>
        </Space>
      ),
    },
    {
      title: '最近检查',
      dataIndex: 'last_check_at',
      width: 190,
      render: (_, row) => {
        if (!row.last_check_at) return <Tag color={NEUTRAL.textTertiary}>未检查</Tag>;
        return (
          <Space size={2} direction="vertical" style={{ fontSize: 12.5 }}>
            <Space size={4}>
              {row.last_status === 'ok' ? (
                <Tag icon={<CheckCircleFilled />} color="PALETTE.green" style={{ marginInlineEnd: 0 }}>正常</Tag>
              ) : row.last_status === 'fail' ? (
                <Tag icon={<CloseCircleFilled />} color="PALETTE.red" style={{ marginInlineEnd: 0 }}>失败</Tag>
              ) : (
                <Tag color={NEUTRAL.textTertiary} style={{ marginInlineEnd: 0 }}>-</Tag>
              )}
              <Text type="secondary" style={{ fontSize: 11.5 }}>{fmtAgo(row.last_check_at)}</Text>
            </Space>
            {row.last_error && (
              <Tooltip title={row.last_error}>
                <Text type="danger" style={{ fontSize: 11.5 }}>{truncate(row.last_error, 24)}</Text>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: '自动导入',
      dataIndex: 'auto_import',
      width: 110,
      render: (_, row) =>
        Number(row.auto_import) ? <Tag color="PALETTE.cyan">已开启</Tag> : <Text type="secondary">关闭</Text>,
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 90,
      render: (_, row) => (
        <Switch
          size="small"
          checked={Number(row.enabled) === 1}
          disabled={!canSettings}
          onChange={(v) => handleToggleAccount(row, v)}
        />
      ),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 220,
      fixed: 'right',
      render: (_, row) => (
        <Space size={11} wrap>
          <a
            onClick={() => {
              setBrowseAccountId(row.id);
              setMsgPage(1);
              setTab('messages');
            }}
          >
            <InboxOutlined /> 邮件
          </a>
          {canRun && <a onClick={() => handleRun(row.id)}><SyncOutlined /> 拉取</a>}
          {canSettings && <a onClick={() => openEditAccount(row)}><EditOutlined /> 编辑</a>}
          {canSettings && (
            <a style={{ color: 'PALETTE.red' }} onClick={() => handleDeleteAccount(row)}>
              <DeleteOutlined /> 删除
            </a>
          )}
        </Space>
      ),
    },
  ];

  /* ---------- 邮件列 ---------- */
  const messageColumns: ProColumns<MailMessageSummary>[] = [
    {
      title: '主题',
      dataIndex: 'subject',
      ellipsis: true,
      render: (_, row) => (
        <Space size={6} wrap>
          {!row.seen && <Badge status="processing" />}
          <Text strong={!row.seen} style={{ color: 'NEUTRAL.text', fontSize: 13 }}>
            {row.subject || '(无主题)'}
          </Text>
          {row.hasExcel && <Tag color="PALETTE.green" style={{ marginInlineEnd: 0 }}><PaperClipOutlined /> Excel</Tag>}
          {!row.hasExcel && row.hasAttachment && <Tag color="PALETTE.yellow" style={{ marginInlineEnd: 0 }}><PaperClipOutlined /> 附件</Tag>}
        </Space>
      ),
    },
    {
      title: '发件人',
      dataIndex: 'from',
      width: 250,
      ellipsis: true,
      render: (_, row) => <Text style={{ fontSize: 12.5 }}>{truncate(row.from || '-', 34)}</Text>,
    },
    {
      title: '时间',
      dataIndex: 'date',
      width: 175,
      render: (_, row) => (
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          {row.date ? fmtTime(row.date, 'MM-DD HH:mm') : '-'}
        </Text>
      ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 100,
      render: (_, row) => <Text type="secondary" style={{ fontSize: 12.5 }}>{fmtSize(row.size)}</Text>,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 100,
      render: (_, row) => (
        <a onClick={() => openMessage(row)}>
          <EyeOutlined /> 查看
        </a>
      ),
    },
  ];

  /* ---------- 日志列 ---------- */
  const logColumns: ProColumns<MailLogRow>[] = [
    {
      title: '导入时间',
      dataIndex: 'created_at',
      width: 170,
      render: (_, row) => <Text style={{ fontSize: 12.5 }}>{fmtTime(row.created_at)}</Text>,
    },
    {
      title: '结果',
      dataIndex: 'result',
      width: 90,
      render: (_, row) => {
        const m = RESULT_META[row.result] || { label: row.result, color: NEUTRAL.textTertiary };
        return <Tag color={m.color}>{m.label}</Tag>;
      },
    },
    {
      title: '项目',
      dataIndex: 'project_name',
      width: 230,
      ellipsis: true,
      render: (_, row) => {
        const id = projectIdByName(row.project_name, row.project_id);
        const label = row.project_name || (row.project_id ? `#${row.project_id}` : '-');
        if (!id) return <Text style={{ fontSize: 12.5 }}>{label}</Text>;
        return (
          <Tooltip title="查看该数据项目">
            <a style={{ fontSize: 12.5 }} onClick={() => openProject(id)}>{label}</a>
          </Tooltip>
        );
      },
    },
    {
      title: '附件文件',
      dataIndex: 'filename',
      ellipsis: true,
      render: (_, row) => (
        <Tooltip title={row.filename}>
          <Text code style={{ fontSize: 12 }}>{truncate(row.filename || '-', 40)}</Text>
        </Tooltip>
      ),
    },
    {
      title: '行数',
      dataIndex: 'rows_total',
      width: 150,
      render: (_, row) => (
        <Space size={2} direction="vertical" style={{ fontSize: 12.5 }}>
          <Text>共 {fmtNum(row.rows_total || 0)} 行</Text>
          <Text type="secondary" style={{ fontSize: 11.5 }}>
            新增 {fmtNum(row.rows_inserted || 0)} / 更新 {fmtNum(row.rows_updated || 0)}
          </Text>
        </Space>
      ),
    },
    {
      title: '列数',
      dataIndex: 'columns_total',
      width: 80,
      render: (_, row) => <Text>{fmtNum(row.columns_total || 0)}</Text>,
    },
    {
      title: '邮件主题',
      dataIndex: 'subject',
      width: 220,
      ellipsis: true,
      render: (_, row) => (
        <Tooltip title={row.subject}>
          <Text style={{ fontSize: 12.5 }}>{truncate(row.subject || '-', 28)}</Text>
        </Tooltip>
      ),
    },
    {
      title: '说明',
      dataIndex: 'message',
      ellipsis: true,
      render: (_, row) => <Text style={{ fontSize: 12.5 }}>{row.message || '-'}</Text>,
    },
  ];

  const trendMax = useMemo(() => {
    const t = overview?.trend || [];
    return t.reduce((m, x) => Math.max(m, Number(x.count) || 0), 0) || 1;
  }, [overview]);

  const browseAccount = useMemo(
    () => accounts.find((a) => a.id === browseAccountId) || null,
    [accounts, browseAccountId]
  );

  /* ================= 渲染 ================= */

  const overviewTab = (
    <>
      {loadingTop ? (
        <div style={{ padding: 60, textAlign: 'center' }}><Spin size="large" tip="加载中…" /></div>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            {[
              { title: '导入项目', value: overview?.projects.total ?? 0, color: PALETTE.primary, unit: '个' },
              { title: '累计数据行', value: overview?.projects.rows ?? 0, color: 'PALETTE.primaryDeep', unit: '行' },
              { title: '导入日志', value: overview?.logs.total ?? 0, color: 'PALETTE.cyan', unit: '次' },
              { title: '成功导入', value: overview?.logs.success ?? 0, color: 'PALETTE.green', unit: '次' },
              { title: '跳过', value: overview?.logs.skipped ?? 0, color: 'PALETTE.yellow', unit: '次' },
              { title: '失败', value: overview?.logs.failed ?? 0, color: 'PALETTE.red', unit: '次' },
              { title: '今日导入', value: overview?.logs.today ?? 0, color: 'PALETTE.orange', unit: '次' },
            ].map((s) => (
              <Card key={s.title} size="small" styles={{ body: { padding: '12px 14px' } }}>
                <Statistic
                  title={s.title}
                  value={s.value}
                  suffix={s.unit}
                  valueStyle={{ fontSize: 20, color: s.color }}
                />
              </Card>
            ))}
          </div>

          <Space size={16} direction="vertical" style={{ width: '100%' }}>
            <Card
              size="small"
              title="运行状态"
              extra={
                <Button size="small" icon={<ReloadOutlined />} onClick={loadTop}>刷新</Button>
              }
            >
              <Descriptions
                size="small"
                column={{ xs: 1, sm: 1, md: 2 }}
                items={[
                  {
                    key: 'enabled',
                    label: '自动拉取',
                    children: status?.enabled ? <Tag color="PALETTE.green">已启用</Tag> : <Tag color={NEUTRAL.textTertiary}>未启用</Tag>,
                  },
                  {
                    key: 'scheduled',
                    label: '轮询调度',
                    children: status?.scheduled
                      ? <Tag icon={<ClockCircleOutlined />} color="PALETTE.cyan">运行中（每 {status.interval} 分钟）</Tag>
                      : <Tag color={NEUTRAL.textTertiary}>未调度</Tag>,
                  },
                  {
                    key: 'running',
                    label: '当前任务',
                    children: status?.running
                      ? <Tag icon={<SyncOutlined spin />} color="PALETTE.yellow">拉取中</Tag>
                      : <Text type="secondary">空闲</Text>,
                  },
                  {
                    key: 'accounts',
                    label: '邮箱账户',
                    children: `${status?.enabledCount ?? 0} / ${status?.accountCount ?? 0} 已启用`,
                  },
                  {
                    key: 'lastRun',
                    label: '最近拉取',
                    children: status?.lastRunAt ? `${fmtTime(status.lastRunAt)}（${fmtAgo(status.lastRunAt)}）` : <Text type="secondary">尚未拉取</Text>,
                  },
                  {
                    key: 'lastError',
                    label: '最近错误',
                    children: status?.lastError
                      ? <Text type="danger" style={{ fontSize: 12.5 }}>{status.lastError}</Text>
                      : <Text type="secondary">无</Text>,
                  },
                ]}
              />
              {status?.lastResult && (
                <Alert
                  style={{ marginTop: 12 }}
                  type={status.lastResult.ok ? 'success' : 'warning'}
                  showIcon
                  title={`上次拉取：${status.lastResult.message || '完成'}`}
                  description={`账户 ${status.lastResult.accounts ?? 0} 个 · 邮件 ${status.lastResult.mails ?? 0} 封 · 附件 ${status.lastResult.attachments ?? 0} 个 · 导入 ${status.lastResult.imported ?? 0} · 跳过 ${status.lastResult.skipped ?? 0} · 失败 ${status.lastResult.failed ?? 0}`}
                />
              )}
            </Card>

            <Card size="small" title="近 7 天导入趋势">
              {(overview?.trend || []).length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无导入记录" />
              ) : (
                <Space size={10} direction="vertical" style={{ width: '100%' }}>
                  {(overview?.trend || []).map((t) => (
                    <Space key={t.date} size={10} style={{ width: '100%' }}>
                      <Text style={{ fontSize: 12.5, width: 90, flexShrink: 0 }}>
                        {fmtTime(t.date, 'MM-DD')}
                      </Text>
                      <Progress
                        percent={Math.round((Number(t.count) / trendMax) * 100)}
                        showInfo={false}
                        strokeColor="PALETTE.primary"
                        trailColor={NEUTRAL.surfaceSunken}
                        style={{ maxWidth: 420 }}
                      />
                      <Text type="secondary" style={{ fontSize: 12.5 }}>{t.count} 次</Text>
                    </Space>
                  ))}
                </Space>
              )}
            </Card>

            <Card
              size="small"
              title="最近导入"
              extra={
                <Button size="small" type="link" onClick={() => setTab('projects')}>
                  数据项目管理
                </Button>
              }
            >
              {(overview?.recentImports || []).length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无导入记录" />
              ) : (
                <Table<NonNullable<MailPushOverview['recentImports']>[number]>
                  size="small"
                  rowKey="id"
                  pagination={false}
                  /* 列宽合计约 650px，移动端（390px）必须允许横向滚动，否则整页被撑宽 */
                  scroll={{ x: 'max-content' }}
                  dataSource={overview?.recentImports || []}
                  columns={[
                    {
                      title: '时间',
                      dataIndex: 'created_at',
                      width: 170,
                      render: (v?: string) => <Text style={{ fontSize: 12.5 }}>{fmtTime(v)}</Text>,
                    },
                    {
                      title: '项目',
                      dataIndex: 'project_name',
                      width: 220,
                      ellipsis: true,
                      render: (v?: string, row?: NonNullable<MailPushOverview['recentImports']>[number]) => {
                        const id = projectIdByName(v, row?.project_id);
                        if (!id) return v || '-';
                        return <a onClick={() => openProject(id)}>{v}</a>;
                      },
                    },
                    {
                      title: '文件',
                      dataIndex: 'filename',
                      ellipsis: true,
                      render: (v?: string) => <Text code style={{ fontSize: 12 }}>{truncate(v || '-', 44)}</Text>,
                    },
                    {
                      title: '行数',
                      dataIndex: 'rows_total',
                      width: 90,
                      render: (v?: number) => fmtNum(v || 0),
                    },
                    {
                      title: '列数',
                      dataIndex: 'columns_total',
                      width: 80,
                      render: (v?: number) => fmtNum(v || 0),
                    },
                    {
                      title: '结果',
                      dataIndex: 'result',
                      width: 90,
                      render: (v?: string) => {
                        const m = RESULT_META[v || ''] || { label: v || '-', color: NEUTRAL.textTertiary };
                        return <Tag color={m.color}>{m.label}</Tag>;
                      },
                    },
                  ]}
                />
              )}
            </Card>
          </Space>
        </>
      )}
    </>
  );

  const accountsTab = (
    <ProTable<MailAccount, Record<string, unknown>>
      rowKey="id"
      actionRef={accountActionRef}
      columns={accountColumns}
      search={false}
      scroll={{ x: 1300 }}
      options={{ density: false, fullScreen: true, reload: true, setting: false }}
      pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 个账户` }}
      headerTitle={
        <Space>
          <span>邮箱账户</span>
          <Text type="secondary" style={{ fontSize: 12.5, fontWeight: 400 }}>
            支持多账户，账户故障互不影响
          </Text>
        </Space>
      }
      toolBarRender={() => [
        <Button key="reload" icon={<ReloadOutlined />} onClick={() => { loadTop(); accountActionRef.current?.reload(); }}>
          刷新
        </Button>,
        canRun ? (
          <Button key="run" icon={<SyncOutlined />} loading={running} onClick={() => handleRun()}>
            全部拉取
          </Button>
        ) : null,
        canSettings ? (
          <Button key="add" type="primary" icon={<PlusOutlined />} onClick={openCreateAccount}>
            添加账户
          </Button>
        ) : null,
      ]}
      request={async () => {
        const list = await listMailAccounts();
        setAccounts(list || []);
        return { data: list || [], total: (list || []).length, success: true };
      }}
    />
  );

  const messagesTab = (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Text style={{ fontSize: 13 }}>邮箱账户</Text>
        <Segmented
          value={browseAccountId ?? ''}
          onChange={(v) => { setBrowseAccountId(Number(v)); setMsgPage(1); }}
          options={accounts.map((a) => ({ label: a.email, value: a.id }))}
        />
        <Space size={6}>
          <Text type="secondary" style={{ fontSize: 12.5 }}>仅看有附件</Text>
          <Switch size="small" checked={onlyAtt} onChange={(v) => { setOnlyAtt(v); setMsgPage(1); }} />
        </Space>
        <Button icon={<ReloadOutlined />} onClick={() => browseAccountId && loadMessages(browseAccountId, msgPage, onlyAtt)}>
          刷新
        </Button>
        {canRun && (
          <Button icon={<SyncOutlined />} loading={running} onClick={() => handleRun(browseAccountId ?? undefined)}>
            拉取该账户
          </Button>
        )}
      </Space>

      {!accounts.length ? (
        <Empty description="还没有邮箱账户，请先到「邮箱账户」页签添加" style={{ margin: '50px 0' }} />
      ) : msgError ? (
        <Alert type="error" showIcon title="读取邮件失败" description={msgError} style={{ marginBottom: 12 }} />
      ) : (
        <ProTable<MailMessageSummary, Record<string, unknown>>
          rowKey="uid"
          columns={messageColumns}
          dataSource={messages}
          loading={msgLoading}
          search={false}
          options={false}
          scroll={{ x: 900 }}
          headerTitle={
            <Space>
              <span>{browseAccount?.email || ''}</span>
              <Text type="secondary" style={{ fontSize: 12.5, fontWeight: 400 }}>
                共 {fmtNum(msgTotal)} 封{browseAccount ? ` · 文件夹 ${browseAccount.mailbox}` : ''}
              </Text>
            </Space>
          }
          pagination={{
            current: msgPage,
            pageSize: 30,
            total: msgTotal,
            showSizeChanger: false,
            onChange: (p) => setMsgPage(p),
            showTotal: (t) => `共 ${fmtNum(t)} 封`,
          }}
        />
      )}
    </>
  );

  const projectsTab = (
    <>
      {projLoading && !projects.length ? <div style={{ padding: 48, textAlign: 'center' }}><Spin tip="加载中…" /></div> : !visibleProjects.length ? <Empty description={projects.length ? `没有匹配「${projKeyword}」的数据项目` : '还没有数据项目'} /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 12 }}>
          {visibleProjects.map((p) => <Card key={p.id} size="small" hoverable onClick={() => openProject(p.id)} styles={{ body: { padding: 14 } }} style={{ borderColor: NEUTRAL.border, boxShadow: SHADOW.card }}>
            <Space wrap style={{ marginBottom: 8 }}><Text strong style={{ color: NEUTRAL.text }}>{p.name}</Text><Tag color={Number(p.status) === 1 ? PALETTE.green : NEUTRAL.textTertiary}>{Number(p.status) === 1 ? '启用' : '停用'}</Tag>{p.code && <Tag color={PALETTE.cyan}>{p.code}</Tag>}</Space>
            <Space direction="vertical" size={3} style={{ width: '100%' }}><Text type="secondary">数据表：<Text code>{p.data_table}</Text></Text><Text type="secondary">累计行数：{fmtNum(p.row_count || 0)}</Text><Text type="secondary">最近导入：{p.last_import_at ? fmtAgo(p.last_import_at) : '-'}</Text>{p.source_mail && <Text type="secondary">来源邮箱：{truncate(p.source_mail, 28)}</Text>}</Space>
            <Divider style={{ margin: '10px 0 8px' }} />
            <Space wrap onClick={(e) => e.stopPropagation()}><Button type="link" icon={<EyeOutlined />} onClick={() => openProject(p.id)}>查看数据</Button>{canData && <Button type="link" icon={<DownloadOutlined />} onClick={() => exportProject(p.id)}>导出 CSV</Button>}</Space>
          </Card>)}
        </div>
      )}
    </>
  );

  const logsTab = (
    <ProTable<MailLogRow, Record<string, unknown>>
      rowKey="id"
      actionRef={logActionRef}
      columns={logColumns}
      dataSource={logs}
      loading={logLoading}
      search={false}
      scroll={{ x: 1450 }}
      options={{ density: false, fullScreen: true, reload: false, setting: false }}
      pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条记录` }}
      headerTitle="导入日志"
      toolBarRender={() => [
        <Select
          key="proj"
          allowClear
          placeholder="全部数据项目"
          value={logProjectId}
          onChange={(v) => {
            const next = v === undefined || v === null ? undefined : Number(v);
            setLogProjectId(next);
            loadLogs(logKeyword, logResult, next);
          }}
          options={projects.map((p) => ({ label: p.name, value: p.id }))}
          style={{ width: 200 }}
        />,
        <Input
          key="kw"
          allowClear
          prefix={<SearchOutlined style={{ color: NEUTRAL.textTertiary }} />}
          placeholder="文件名 / 主题 / 项目 / 说明"
          value={logKeyword}
          onChange={(e) => setLogKeyword(e.target.value)}
          onPressEnter={() => loadLogs(logKeyword, logResult, logProjectId)}
          style={{ width: 260 }}
        />,
        <Segmented
          key="result"
          value={logResult}
          onChange={(v) => { setLogResult(String(v)); loadLogs(logKeyword, String(v), logProjectId); }}
          options={[
            { label: '全部', value: '' },
            { label: '成功', value: 'success' },
            { label: '跳过', value: 'skipped' },
            { label: '失败', value: 'failed' },
          ]}
        />,
        <Button key="q" icon={<SearchOutlined />} onClick={() => loadLogs(logKeyword, logResult, logProjectId)}>
          查询
        </Button>,
        <Button
          key="r"
          icon={<ReloadOutlined />}
          onClick={() => {
            setLogKeyword('');
            setLogResult('');
            setLogProjectId(undefined);
            loadLogs('', '', undefined);
          }}
        >
          重置
        </Button>,
      ]}
    />
  );

  const settingsTab = (
    <Card size="small" title="运行设置" style={{ maxWidth: 720 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="修改后会自动重启邮件轮询调度"
        description="开启后系统按「轮询周期」自动检查所有已启用账户，并把 Excel 附件按文件名规则导入对应项目。"
      />
      <Form<SettingsFormValues>
        ref={settingsFormRef}
        layout="vertical"
        initialValues={settingsValues}
        key={`${settingsValues.interval}-${settingsValues.initial_days}-${settingsValues.max_per_run}-${String(settingsValues.enabled)}`}
      >
        <Form.Item name="enabled" label="启用自动拉取" valuePropName="checked" tooltip="关闭后只能手动点击「立即拉取」">
          <Switch />
        </Form.Item>
        <Form.Item
          name="interval"
          label="轮询周期（分钟）"
          rules={[{ required: true, message: '请输入轮询周期' }]}
        >
          <InputNumber min={1} max={1440} precision={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="initial_days"
          label="首次回溯天数"
          tooltip="新账户首次拉取时向前回溯的天数"
          rules={[{ required: true, message: '请输入回溯天数' }]}
        >
          <InputNumber min={1} max={365} precision={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="max_per_run"
          label="单次最多邮件数"
          tooltip="每轮每个账户最多处理的邮件数量"
          rules={[{ required: true, message: '请输入单次邮件数' }]}
        >
          <InputNumber min={1} max={500} precision={0} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
      <Space style={{ marginTop: 8 }}>
        {canSettings ? (
          <Button type="primary" loading={settingsSaving} onClick={handleSaveSettings}>
            保存设置
          </Button>
        ) : (
          <Text type="secondary">无权限修改系统设置（需要 settings:write）</Text>
        )}
        <Button onClick={loadSettings}>重新读取</Button>
      </Space>
    </Card>
  );

  return (
    <Page
      title="邮箱推送"
      search={tab === 'projects' ? <Input allowClear prefix={<SearchOutlined />} placeholder="搜索项目名称 / 编码 / 数据表 / 邮箱" value={projKeyword} onChange={(e) => setProjKeyword(e.target.value)} style={{ width: 300, maxWidth: '100%' }} /> : <Input allowClear prefix={<SearchOutlined />} placeholder="按关键字筛选导入日志" value={logKeyword} onChange={(e) => setLogKeyword(e.target.value)} style={{ width: 260, maxWidth: '100%' }} />}
      actions={
        <>
          {tab === 'projects' && canProjectWrite ? <Button type="primary" icon={<PlusOutlined />} onClick={() => message.info('数据项目由邮件附件自动创建')}>新建项目</Button> : null}
          {tab === 'accounts' && canSettings ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreateAccount}>添加账户</Button> : null}
          <Button icon={<ReloadOutlined />} onClick={loadTop}>刷新</Button>
          {canRun && <Button type="primary" icon={<PlayCircleOutlined />} loading={running} onClick={() => handleRun()}>立即拉取</Button>}
        </>
      }
      subTabs={<Tabs activeKey={tab} onChange={(k) => { setTab(k); if (k === 'overview' || k === 'accounts') loadTop(); if (k === 'projects') loadProjects(); if (k === 'logs') loadLogs(logKeyword, logResult, logProjectId); }} items={[
        { key: 'overview', label: '概览' }, { key: 'projects', label: <>数据项目 <Tag color={PALETTE.primary}>{projects.length}</Tag></> }, { key: 'accounts', label: <>邮箱账户 <Tag color={PALETTE.cyan}>{accounts.length}</Tag></> }, { key: 'messages', label: '邮件浏览' }, { key: 'logs', label: '导入日志' }, { key: 'settings', label: '运行设置' },
      ]} />}
      stats={[
        { label: '数据项目数', value: overview?.projects.total ?? projects.length, suffix: '个', color: PALETTE.primary },
        { label: '邮箱账户数', value: overview?.accounts?.total ?? accounts.length, suffix: '个', color: PALETTE.cyan },
        { label: '今日导入', value: overview?.logs.today ?? 0, suffix: '次', color: PALETTE.green },
        { label: '累计记录数', value: overview?.projects.rows ?? 0, suffix: '行', color: PALETTE.violet },
        { label: '导入失败数', value: overview?.logs.failed ?? 0, suffix: '次', color: PALETTE.red },
      ] as StatCardItem[]}
      extra={tab === 'projects' ? <Text type="secondary">共 {fmtNum(visibleProjects.length)} 个项目</Text> : undefined}
    >
      {tab === 'overview' ? overviewTab : tab === 'projects' ? projectsTab : tab === 'accounts' ? accountsTab : tab === 'messages' ? messagesTab : tab === 'logs' ? logsTab : settingsTab}

      {/* ---------- 账户新建 / 编辑 ---------- */}
      <ModalForm<AccountFormValues>
        title={editingAccount ? `编辑邮箱账户 · ${editingAccount.email}` : '添加邮箱账户'}
        open={accountOpen}
        onOpenChange={(o) => { setAccountOpen(o); if (!o) setAccountTestMsg(null); }}
        formRef={accountFormRef}
        modalProps={{ width: 560, destroyOnHidden: true }}
        initialValues={accountInitial}
        onFinish={handleAccountSubmit}
        submitter={{
          searchConfig: { submitText: editingAccount ? '保存' : '添加', resetText: '取消' },
          render: (props, dom) => [
            ...dom,
            <Button
              key="test"
              icon={<ThunderboltOutlined />}
              loading={testingAccount}
              onClick={handleAccountTest}
            >
              测试连接
            </Button>,
          ],
        }}
        onValuesChange={(changed: Partial<AccountFormValues>) => {
          // 选择服务商预设时自动填充 IMAP 参数
          if (changed.imap_host !== undefined) {
            const hit = presets.find((p) => p.host === changed.imap_host);
            if (hit && accountFormRef.current) {
              accountFormRef.current.setFieldsValue({
                imap_port: hit.port,
                imap_secure: hit.secure,
              });
            }
          }
        }}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="使用 IMAP 收取邮件"
          description="密码请填写邮箱的「授权码」而非登录密码（QQ/163/阿里云企业邮箱均需单独开启 IMAP 并生成授权码）。"
        />

        <ProFormText
          name="email"
          label="邮箱地址"
          placeholder="name@example.com"
          rules={[
            { required: true, message: '请输入邮箱地址' },
            { type: 'email', message: '邮箱格式不正确' },
          ]}
        />
        <ProFormText
          name="name"
          label="账户名称"
          placeholder="便于识别的名称，留空则使用邮箱地址"
        />
        <ProFormText.Password
          name="password"
          label="密码 / 授权码"
          placeholder={editingAccount ? '留空表示不修改' : '请输入邮箱授权码'}
          rules={editingAccount ? undefined : [{ required: true, message: '请输入邮箱授权码' }]}
        />

        <Divider style={{ margin: '4px 0 16px' }}>IMAP 服务器</Divider>

        <div style={{ marginBottom: 14 }}>
          <Text type="secondary" style={{ fontSize: 12.5, marginRight: 8 }}>服务商预设</Text>
          <Space size={6} wrap>
            {presets.filter((p) => p.host).map((p) => (
              <Tag
                key={p.key}
                color="PALETTE.cyan"
                style={{ cursor: 'pointer', marginInlineEnd: 0 }}
                onClick={() => {
                  accountFormRef.current?.setFieldsValue({
                    imap_host: p.host,
                    imap_port: p.port,
                    imap_secure: p.secure,
                  });
                }}
              >
                {p.label}
              </Tag>
            ))}
          </Space>
        </div>

        <ProFormText
          name="imap_host"
          label="服务器地址"
          placeholder="imap.example.com"
          rules={[{ required: true, message: '请输入 IMAP 服务器地址' }]}
        />
        <ProFormDigit
          name="imap_port"
          label="端口"
          min={1}
          max={65535}
          fieldProps={{ precision: 0, style: { width: '100%' } }}
          rules={[{ required: true, message: '请输入端口' }]}
        />
        <ProFormSwitch name="imap_secure" label="使用 SSL / TLS" />
        <ProFormText
          name="mailbox"
          label="收件文件夹"
          placeholder="INBOX"
          tooltip="一般保持 INBOX；如需从子文件夹拉取，请填写完整路径"
        />

        <Divider style={{ margin: '4px 0 16px' }}>拉取策略</Divider>

        <ProFormSwitch name="enabled" label="启用自动拉取" />
        <ProFormSwitch name="auto_import" label="自动导入 Excel 附件到项目" />
        <ProFormDigit
          name="initial_days"
          label="首次回溯天数"
          min={1}
          max={365}
          fieldProps={{ precision: 0, style: { width: '100%' } }}
        />
        <ProFormDigit
          name="max_per_run"
          label="单次最多邮件数"
          min={1}
          max={500}
          fieldProps={{ precision: 0, style: { width: '100%' } }}
        />

        {accountTestMsg && (
          <Alert
            style={{ marginTop: 8 }}
            type={accountTestMsg.ok ? 'success' : 'error'}
            showIcon
            title={accountTestMsg.text}
          />
        )}
      </ModalForm>

      {/* ---------- 邮件详情 ---------- */}
      <Modal
        title={detail?.subject || (detailLoading ? '加载中…' : '邮件详情')}
        open={detailOpen}
        onCancel={() => { setDetailOpen(false); setDetail(null); }}
        width={780}
        destroyOnHidden
        footer={null}
      >
        {detailLoading ? (
          <div style={{ padding: 60, textAlign: 'center' }}><Spin size="large" tip="读取邮件…" /></div>
        ) : !detail ? (
          <Empty description="邮件内容读取失败" style={{ margin: '50px 0' }} />
        ) : (
          <>
            <Descriptions
              bordered
              size="small"
              column={1}
              style={{ marginBottom: 14 }}
              items={[
                { key: 'subject', label: '主题', children: detail.subject || '(无主题)' },
                { key: 'from', label: '发件人', children: detail.from || '-' },
                { key: 'to', label: '收件人', children: detail.to || '-' },
                ...(detail.cc ? [{ key: 'cc', label: '抄送', children: detail.cc }] : []),
                { key: 'date', label: '时间', children: detail.date ? fmtTime(detail.date) : '-' },
                {
                  key: 'att',
                  label: '附件',
                  children: (detail.attachments || []).length === 0 ? (
                    <Text type="secondary">无附件</Text>
                  ) : (
                    <Space size={6} wrap>
                      {(detail.attachments || []).map((a, i) => (
                        <Tag
                          key={`${a.filename}-${i}`}
                          color={a.isExcel ? 'PALETTE.green' : 'NEUTRAL.textTertiary'}
                          style={{ marginInlineEnd: 0 }}
                        >
                          <PaperClipOutlined /> {a.filename || '未命名'}（{fmtSize(a.size)}）
                          {a.isExcel ? ' · Excel' : ''}
                        </Tag>
                      ))}
                    </Space>
                  ),
                },
              ]}
            />

            <Divider titlePlacement="start" style={{ margin: '8px 0 12px' }}>
              <Text style={{ fontSize: 13 }}>正文</Text>
            </Divider>

            {detail.html ? (
              <div
                style={{
                  border: `1px solid ${NEUTRAL.border}`, borderRadius: 8, padding: 14,
                  maxHeight: 460, overflow: 'auto', background: NEUTRAL.surface,
                }}
                // 邮件正文来自用户自己的邮箱，按邮件客户端常规方式渲染
                dangerouslySetInnerHTML={{ __html: detail.html }}
              />
            ) : detail.text ? (
              <Paragraph
                style={{
                  background: NEUTRAL.surfaceAlt, borderRadius: 8, padding: 12,
                  maxHeight: 460, overflow: 'auto', marginBottom: 0,
                }}
              >
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12.5 }}>
                  {detail.text}
                </pre>
              </Paragraph>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="邮件没有可显示的正文" />
            )}
          </>
        )}
      </Modal>
    </Page>
  );
}
