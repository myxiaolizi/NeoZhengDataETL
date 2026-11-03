/**
 * 报表中心（V16 改版）
 *
 * 需求（V16 L23-36）：
 *  3.1 中康智能体客户看板 / 客户签约看板 由「系统内置看板」改为 **AI 报表**
 *      —— 删除硬编码 BUILTIN_BOARDS，改由 GET /api/ai-reports?source=builtin 取。
 *  3.2 「我的报表」改为 **BI 报表**（chart / table / dashboard 仍按原方式展示与运行）。
 *  3.3 点击报表「分享」→ **弹窗**（不再跳分享中心），确认后创建分享链接。
 *  3.4 AI 报表「查看代码」→ 弹窗显示该报表 dsl JSON（与后端逐字一致）。
 *  3.5 AI 报表「修改代码」→ 可编辑 JSON → 保存；非法 JSON 中文报错且不崩溃。
 *  3.6 操作按钮可见性矩阵（契约 §4.5）。
 *  3.7 分享弹窗确认后再到分享中心（/shares）可见。
 *
 * 安全红线（P0-2）：DSL 只作为数据展示/编辑，绝不 eval / new Function 执行。
 *
 * 弹窗渲染在 body portal，取不到看板 .board-root 的 CSS 变量 →
 * 本文件所有弹窗内容使用 @/theme 的字面色值（NEUTRAL / PALETTE），不用 var(--x)。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
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
  Tabs,
  Tag,
  Tooltip,
} from 'antd';
import {
  AppstoreOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FileTextOutlined,
  FundOutlined,
  LinkOutlined,
  LockOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  ShareAltOutlined,
  StopOutlined,
  TableOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { useNavigate } from 'react-router-dom';
import Page from '@/components/Page';
import type { StatCardItem } from '@/components/StatCards';
import { NEUTRAL, PALETTE, SIDER } from '@/theme';
import { useAppStore } from '@/stores/app';
import { copyText, fmtAgo, fmtNum, fmtTime } from '@/utils';
import {
  copyReport,
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
import {
  AI_DRAFT_TIMEOUT,
  copyAiReport,
  deleteAiReport,
  generateAiReportDraft,
  getAiReport,
  listAiReports,
  updateAiReport,
  type AiReportItem,
} from '@/api/ai-reports';

const { useBreakpoint } = Grid;

const TYPE_META: Record<string, { label: string; color: string }> = {
  chart: { label: '图表', color: PALETTE.primary },
  table: { label: '表格', color: PALETTE.cyan },
  dashboard: { label: '看板', color: PALETTE.green },
  ai: { label: 'AI', color: PALETTE.violet },
};

function typeMeta(t: string) {
  return TYPE_META[t] || { label: t || '图表', color: PALETTE.gray };
}

/** 内置看板 boardKey → 分享占位 ID（后端 accessShare：1 = zk / 2 = crm） */
const BOARD_SHARE_ID: Record<string, number> = { zk: 1, crm: 2 };

/** 从 dsl 文本中取看板路由（用于「查看」跳转，缺失时返回 null） */
function dslRouteOf(dsl?: string): string | null {
  if (!dsl) return null;
  try {
    const obj = JSON.parse(dsl);
    return obj && typeof obj.route === 'string' ? obj.route : null;
  } catch {
    return null;
  }
}

/** 分享目标（分享弹窗用） */
interface ShareTarget {
  kind: 'report' | 'board';
  id: number;
  name: string;
  hint?: string;
}

/** 已创建分享的展示结果（密码只来自本次输入，不回显服务端密文） */
interface ShareResult {
  url: string;
  title: string;
  password: string;
  expiresLabel: string;
}

/** 有效期选项（0 = 永久） */
const SHARE_EXPIRES: { label: string; value: number }[] = [
  { label: '7 天', value: 7 },
  { label: '30 天', value: 30 },
  { label: '永久', value: 0 },
];

/** 随机密码字符集（去掉易混淆的 I / O / 0 / 1） */
const PWD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 生成 6 位随机访问密码 */
function genPassword(len = 6): string {
  let out = '';
  for (let i = 0; i < len; i += 1) out += PWD_CHARS[Math.floor(Math.random() * PWD_CHARS.length)];
  return out;
}

/** 表单小标题 */
function FieldLabel({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 6,
        fontSize: 12.5,
        fontWeight: 600,
        color: NEUTRAL.textSecondary,
      }}
    >
      <span>{children}</span>
      {extra ? <span style={{ fontSize: 11.5, fontWeight: 400, color: NEUTRAL.textTertiary }}>{extra}</span> : null}
    </div>
  );
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const { message, modal } = AntApp.useApp();
  const { can } = useAppStore();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const btnSize = isMobile ? 'middle' : 'small';
  const mh: React.CSSProperties = { minHeight: 32 };

  /** BI 报表（chart / table / dashboard） */
  const [biReports, setBiReports] = useState<ReportItem[]>([]);
  /** AI 报表（含内置 source='builtin' 与用户自建） */
  const [aiReports, setAiReports] = useState<AiReportItem[]>([]);
  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  /* 新建报表（BI） */
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  /* 分享弹窗 */
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareForm] = Form.useForm();
  const [sharing, setSharing] = useState(false);
  const [shareResult, setShareResult] = useState<ShareResult | null>(null);

  /* 编辑弹窗（名称/图标/标题/描述/标签/分组） */
  const [editTarget, setEditTarget] = useState<{ kind: 'bi' | 'ai'; item: ReportItem | AiReportItem } | null>(null);
  const [editForm] = Form.useForm();
  const [savingEdit, setSavingEdit] = useState(false);

  /* 查看代码（只读） */
  const [codeTarget, setCodeTarget] = useState<AiReportItem | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeText, setCodeText] = useState('');
  const [codeLoading, setCodeLoading] = useState(false);

  /* 修改代码 / 手动调整（可编辑） */
  const [codeEditOpen, setCodeEditOpen] = useState(false);
  const [codeEditText, setCodeEditText] = useState('');
  const [savingCode, setSavingCode] = useState(false);

  /* AI 调整 */
  const [aiTarget, setAiTarget] = useState<AiReportItem | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const canWrite = can('report:write');
  const canShare = can(['share:write', 'share:read']);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [list, ai, ds] = await Promise.all([
        listReports(),
        listAiReports().catch(() => [] as AiReportItem[]),
        canWrite ? listDatasets().catch(() => [] as DatasetItem[]) : Promise.resolve([] as DatasetItem[]),
      ]);
      setBiReports((list || []).filter((r) => ['chart', 'table', 'dashboard'].includes(r.reportType)));
      setAiReports(ai || []);
      setDatasets(ds || []);
    } catch (e) {
      setBiReports([]);
      setAiReports([]);
      setLoadError(e instanceof Error ? e.message : '加载报表列表失败');
    } finally {
      setLoading(false);
    }
  }, [canWrite]);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    biReports.forEach((r) => {
      if (r.category) set.add(r.category);
    });
    return Array.from(set);
  }, [biReports]);

  const builtinAi = useMemo(() => aiReports.filter((r) => r.source === 'builtin'), [aiReports]);

  const showAI = typeFilter === 'all' || typeFilter === 'ai';
  const showBI = typeFilter === 'all' || ['chart', 'table', 'dashboard'].includes(typeFilter);

  const kw = keyword.trim().toLowerCase();

  const filteredBi = useMemo(() => {
    if (!showBI) return [];
    return biReports.filter((r) => {
      if (typeFilter !== 'all' && typeFilter !== 'ai' && r.reportType !== typeFilter) return false;
      if (categoryFilter !== 'all' && (r.category || '') !== categoryFilter) return false;
      if (!kw) return true;
      return [r.name, r.code, r.description, r.category, r.datasetName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(kw));
    });
  }, [biReports, typeFilter, categoryFilter, kw, showBI]);

  const filteredAi = useMemo(() => {
    if (!showAI) return [];
    return aiReports.filter((r) => {
      if (!kw) return true;
      return [r.name, r.code, r.description, r.group, r.tags]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(kw));
    });
  }, [aiReports, kw, showAI]);

  /** 数据卡片（5 个：报表数 / 已发布 / 访问 / 分享数 / 看板数） */
  const statItems = useMemo<StatCardItem[]>(() => {
    const total = biReports.length + aiReports.length;
    const published = biReports.filter((r) => Number(r.status) === 1).length + aiReports.filter((r) => Number(r.status) === 1).length;
    const views = biReports.reduce((s, r) => s + (r.viewCount || 0), 0) + aiReports.reduce((s, r) => s + (r.viewCount || 0), 0);
    const shares = biReports.reduce((s, r) => s + (r.shareCount || 0), 0);
    const boards = builtinAi.length + biReports.filter((r) => r.reportType === 'dashboard').length;

    return [
      { key: 'total', label: '报表数', value: fmtNum(total), suffix: '个', color: PALETTE.primary, onClick: () => setTypeFilter('all') },
      {
        key: 'published',
        label: '已发布',
        value: fmtNum(published),
        suffix: '个',
        color: PALETTE.green,
        hint: total > 0 ? `启用率 ${Math.round((published / total) * 100)}%` : undefined,
      },
      { key: 'views', label: '访问', value: fmtNum(views), suffix: '次', color: PALETTE.cyan },
      { key: 'shares', label: '分享数', value: fmtNum(shares), suffix: '个', color: PALETTE.yellow },
      {
        key: 'boards',
        label: '看板数',
        value: fmtNum(boards),
        suffix: '个',
        color: PALETTE.violet,
        hint: `含 AI 内置看板 ${builtinAi.length} 个`,
        onClick: () => setTypeFilter('ai'),
      },
    ];
  }, [biReports, aiReports, builtinAi]);

  /* ══════════ 新建（BI） ══════════ */
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

  /* ══════════ 通用操作 ══════════ */
  const toggleStatus = async (kind: 'bi' | 'ai', item: ReportItem | AiReportItem) => {
    const active = Number(item.status) === 1;
    const next = active ? 0 : 1;
    try {
      if (kind === 'bi') {
        await updateReport(item.id, { status: next });
        setBiReports((prev) => prev.map((r) => (r.id === item.id ? { ...r, status: next } : r)));
      } else {
        await updateAiReport(item.id, { status: next });
        setAiReports((prev) => prev.map((r) => (r.id === item.id ? { ...r, status: next } : r)));
      }
      message.success(next ? '已启用' : '已停用');
    } catch {
      /* client 已提示 */
    }
  };

  const handleDelete = (kind: 'bi' | 'ai', item: ReportItem | AiReportItem) => {
    modal.confirm({
      title: `删除${kind === 'ai' ? 'AI 报表' : '报表'}「${item.name}」？`,
      content: '删除后该报表的分享链接会一并失效，且不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        if (kind === 'bi') {
          await deleteReport(item.id);
          setBiReports((prev) => prev.filter((r) => r.id !== item.id));
        } else {
          await deleteAiReport(item.id);
          setAiReports((prev) => prev.filter((r) => r.id !== item.id));
        }
        message.success('已删除');
      },
    });
  };

  const handleCopy = async (kind: 'bi' | 'ai', item: ReportItem | AiReportItem) => {
    try {
      if (kind === 'bi') await copyReport(item.id);
      else await copyAiReport(item.id);
      message.success('已复制（名称含「副本」）');
      await load();
    } catch {
      /* client 已提示 */
    }
  };

  /** 查看：BI 进报表查看页；AI 按 dsl.route 打开真实看板 */
  const viewItem = (kind: 'bi' | 'ai', item: ReportItem | AiReportItem) => {
    if (kind === 'bi') {
      navigate(`/reports/${item.id}/view`);
      return;
    }
    const route = dslRouteOf((item as AiReportItem).dsl);
    if (route) navigate(route);
    else message.info('该 AI 报表未关联看板路由，可通过「查看代码」查看配置');
  };

  /* ══════════ 分享弹窗 ══════════ */
  const openShare = (target: ShareTarget) => {
    setShareTarget(target);
    setShareResult(null);
    shareForm.resetFields();
    shareForm.setFieldsValue({ title: target.name, expiresDays: 30 });
    setShareOpen(true);
  };

  const closeShare = () => {
    setShareOpen(false);
    setShareTarget(null);
    setShareResult(null);
  };

  const submitShare = async () => {
    if (!shareTarget) return;
    try {
      const values = await shareForm.validateFields();
      setSharing(true);
      const share = await createShare({
        targetType: shareTarget.kind,
        targetId: shareTarget.id,
        title: values.title || shareTarget.name,
        expiresDays: values.expiresDays,
        password: values.password ? String(values.password) : undefined,
      });
      const url = shareUrlOf(share);
      setShareResult({
        url,
        title: values.title || shareTarget.name,
        password: values.password ? String(values.password) : '',
        expiresLabel: SHARE_EXPIRES.find((e) => e.value === values.expiresDays)?.label || '永久',
      });
      message.success('分享链接已创建');
      load();
    } catch (e) {
      if ((e as { errorFields?: unknown }).errorFields) return;
    } finally {
      setSharing(false);
    }
  };

  /* ══════════ 编辑弹窗 ══════════ */
  const openEdit = (kind: 'bi' | 'ai', item: ReportItem | AiReportItem) => {
    setEditTarget({ kind, item });
    editForm.resetFields();
    editForm.setFieldsValue({
      name: item.name,
      title: (item as { title?: string }).title || '',
      description: item.description || '',
      icon: (item as { icon?: string }).icon || '',
      tags: (item as { tags?: string }).tags || '',
      group: (item as { group?: string }).group || '',
    });
  };

  const submitEdit = async () => {
    if (!editTarget) return;
    const { kind, item } = editTarget;
    try {
      const values = await editForm.validateFields();
      setSavingEdit(true);
      const payload = {
        name: values.name,
        title: values.title || '',
        description: values.description || '',
        icon: values.icon || '',
        tags: values.tags || '',
        group: values.group || '',
      };
      if (kind === 'bi') {
        const updated = await updateReport(item.id, payload as unknown as Partial<ReportItem>);
        setBiReports((prev) => prev.map((r) => (r.id === item.id ? { ...r, ...updated } : r)));
      } else {
        const updated = await updateAiReport(item.id, payload);
        setAiReports((prev) => prev.map((r) => (r.id === item.id ? { ...r, ...updated } : r)));
      }
      message.success('已保存');
      setEditTarget(null);
    } catch (e) {
      if ((e as { errorFields?: unknown }).errorFields) return;
    } finally {
      setSavingEdit(false);
    }
  };

  /* ══════════ 查看代码（只读，与后端逐字一致） ══════════ */
  const openCode = async (item: AiReportItem) => {
    setCodeTarget(item);
    setCodeOpen(true);
    setCodeLoading(true);
    setCodeText('');
    try {
      const fresh = await getAiReport(item.id);
      setCodeText(fresh.dsl || '');
    } catch {
      setCodeText(item.dsl || '');
    } finally {
      setCodeLoading(false);
    }
  };

  /* ══════════ 修改代码 / 手动调整 ══════════ */
  const openCodeEdit = (item: AiReportItem) => {
    setCodeTarget(item);
    let text = item.dsl || '';
    try {
      text = JSON.stringify(JSON.parse(text || '{}'), null, 2);
    } catch {
      /* 保留原文 */
    }
    setCodeEditText(text);
    setCodeEditOpen(true);
  };

  const saveCode = async () => {
    if (!codeTarget) return;
    let obj: unknown;
    try {
      obj = JSON.parse(codeEditText);
    } catch {
      message.error('JSON 格式错误，请检查后再保存');
      return;
    }
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      message.error('DSL 必须是 JSON 对象');
      return;
    }
    try {
      setSavingCode(true);
      const updated = await updateAiReport(codeTarget.id, { dsl: JSON.stringify(obj) });
      setAiReports((prev) => prev.map((r) => (r.id === codeTarget.id ? { ...r, ...updated } : r)));
      setCodeEditOpen(false);
      message.success('代码已保存');
    } catch {
      /* client 已提示后端中文错误 */
    } finally {
      setSavingCode(false);
    }
  };

  /* ══════════ AI 调整（30 秒超时兜底） ══════════ */
  const openAiAdjust = (item: AiReportItem) => {
    setAiTarget(item);
    setAiPrompt('');
    setAiOpen(true);
  };

  const runAiAdjust = async () => {
    if (!aiTarget) return;
    const p = aiPrompt.trim();
    if (!p) {
      message.warning('请先描述你想要的 AI 报表');
      return;
    }
    setAiLoading(true);
    try {
      const draft = await generateAiReportDraft(p, 30000);
      setAiOpen(false);
      /* 生成成功后打开代码编辑器预填草稿，供用户确认保存 */
      setCodeTarget(aiTarget);
      let text = draft.dsl || '';
      try {
        text = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* 保留原文 */
      }
      setCodeEditText(text);
      setCodeEditOpen(true);
      message.success('AI 已生成草稿，请确认后保存');
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err?.code === AI_DRAFT_TIMEOUT || (err?.message || '').includes('超时')) {
        message.error('AI 服务不可用，请用手动调整');
      } else {
        message.error(err?.message || 'AI 生成失败，请用手动调整');
      }
    } finally {
      setAiLoading(false);
    }
  };

  /* ══════════ AI 分享目标（内置 → board 占位 ID） ══════════ */
  const aiShareTarget = (r: AiReportItem): ShareTarget => {
    if (r.source === 'builtin') {
      const id = BOARD_SHARE_ID[r.boardKey || ''] ?? 1;
      return { kind: 'board', id, name: r.name, hint: `内置看板 · ${r.boardKey || ''}` };
    }
    return { kind: 'report', id: r.id, name: r.name, hint: r.code };
  };

  /* ══════════ BI 表格列 ══════════ */
  const columns: ProColumns<ReportItem>[] = [
    {
      title: '报表',
      dataIndex: 'name',
      sorter: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
      render: (_, r) => (
        <div style={{ minWidth: 0 }}>
          <a onClick={() => viewItem('bi', r)} style={{ fontWeight: 600, fontSize: 13.5 }}>
            {r.name}
          </a>
          <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary }}>
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
      sorter: (a, b) => String(a.reportType || '').localeCompare(String(b.reportType || '')),
      render: (_, r) => {
        const m = typeMeta(r.reportType);
        return (
          <Tag color={m.color} bordered={false} style={{ color: NEUTRAL.textInverse, marginInlineEnd: 0 }}>
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
      width: 85,
      align: 'right',
      sorter: (a, b) => Number(a.viewCount || 0) - Number(b.viewCount || 0),
      render: (_, r) => fmtNum(r.viewCount || 0),
    },
    {
      title: '分享',
      dataIndex: 'shareCount',
      width: 85,
      align: 'center',
      render: (_, r) => <Badge count={r.shareCount || 0} showZero={false} color={PALETTE.primary} />,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 78,
      align: 'center',
      render: (_, r) =>
        Number(r.status) === 1 ? (
          <Tag color={PALETTE.green} bordered={false} style={{ color: NEUTRAL.textInverse }}>
            已启用
          </Tag>
        ) : (
          <Tag color={PALETTE.gray} bordered={false} style={{ color: NEUTRAL.textInverse }}>
            已停用
          </Tag>
        ),
    },
    {
      title: '最近更新',
      dataIndex: 'updatedAt',
      width: 130,
      sorter: (a, b) => new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime(),
      render: (_, r) => (
        <Tooltip title={fmtTime(r.updatedAt)}>
          <span style={{ fontSize: 12, color: NEUTRAL.textSecondary }}>{fmtAgo(r.updatedAt)}</span>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 240,
      fixed: 'right',
      render: (_, r) => {
        const active = Number(r.status) === 1;
        return [
          <a key="view" onClick={() => viewItem('bi', r)}>
            查看
          </a>,
          active && canWrite ? (
            <a key="edit" onClick={() => openEdit('bi', r)}>
              编辑
            </a>
          ) : null,
          active && canWrite ? (
            <a key="design" onClick={() => navigate(`/reports/${r.id}/design`)}>
              设计
            </a>
          ) : null,
          canWrite ? (
            <a key="copy" onClick={() => handleCopy('bi', r)}>
              复制
            </a>
          ) : null,
          canShare ? (
            <a key="share" onClick={() => openShare({ kind: 'report', id: r.id, name: r.name, hint: r.code })}>
              分享
            </a>
          ) : null,
          canWrite ? (
            <a key="toggle" onClick={() => toggleStatus('bi', r)}>
              {active ? '停用' : '启用'}
            </a>
          ) : null,
          canWrite && !active ? (
            <a key="del" style={{ color: PALETTE.red }} onClick={() => handleDelete('bi', r)}>
              删除
            </a>
          ) : null,
        ];
      },
    },
  ];

  /* ══════════ BI 卡片操作 ══════════ */
  const renderBiActions = (r: ReportItem) => {
    const active = Number(r.status) === 1;
    return (
      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
        <Button size={btnSize} icon={<EyeOutlined />} onClick={() => viewItem('bi', r)} style={mh}>
          查看
        </Button>
        {active && canWrite && (
          <Button size={btnSize} icon={<EditOutlined />} onClick={() => openEdit('bi', r)} style={mh}>
            编辑
          </Button>
        )}
        {active && canWrite && (
          <Button size={btnSize} icon={<FundOutlined />} onClick={() => navigate(`/reports/${r.id}/design`)} style={mh}>
            设计
          </Button>
        )}
        {canWrite && (
          <Button size={btnSize} icon={<CopyOutlined />} onClick={() => handleCopy('bi', r)} style={mh}>
            复制
          </Button>
        )}
        {canShare && (
          <Button
            size={btnSize}
            icon={<ShareAltOutlined />}
            onClick={() => openShare({ kind: 'report', id: r.id, name: r.name, hint: r.code })}
            style={mh}
          >
            分享
          </Button>
        )}
        {canWrite && (
          <Button size={btnSize} icon={active ? <StopOutlined /> : <PlayCircleOutlined />} onClick={() => toggleStatus('bi', r)} style={mh}>
            {active ? '停用' : '启用'}
          </Button>
        )}
        {canWrite && !active && (
          <Button size={btnSize} danger icon={<DeleteOutlined />} onClick={() => handleDelete('bi', r)} style={mh}>
            删除
          </Button>
        )}
      </div>
    );
  };

  /* ══════════ AI 卡片操作 ══════════ */
  const renderAiActions = (r: AiReportItem) => {
    const active = Number(r.status) === 1;
    const builtin = r.source === 'builtin';
    return (
      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
        <Button size={btnSize} icon={<EyeOutlined />} onClick={() => viewItem('ai', r)} style={mh}>
          查看
        </Button>
        {active && canWrite && (
          <Button size={btnSize} icon={<EditOutlined />} onClick={() => openEdit('ai', r)} style={mh}>
            编辑
          </Button>
        )}
        {active && canWrite && (
          <Button size={btnSize} icon={<RobotOutlined />} onClick={() => openAiAdjust(r)} style={mh}>
            AI 调整
          </Button>
        )}
        {active && canWrite && (
          <Button size={btnSize} icon={<CodeOutlined />} onClick={() => openCodeEdit(r)} style={mh}>
            手动调整
          </Button>
        )}
        {canWrite && (
          <Button size={btnSize} icon={<CopyOutlined />} onClick={() => handleCopy('ai', r)} style={mh}>
            复制
          </Button>
        )}
        {canShare && (
          <Button size={btnSize} icon={<ShareAltOutlined />} onClick={() => openShare(aiShareTarget(r))} style={mh}>
            分享
          </Button>
        )}
        {canWrite && (
          <Button size={btnSize} icon={active ? <StopOutlined /> : <PlayCircleOutlined />} onClick={() => toggleStatus('ai', r)} style={mh}>
            {active ? '停用' : '启用'}
          </Button>
        )}
        {canWrite && !active && !builtin && (
          <Button size={btnSize} danger icon={<DeleteOutlined />} onClick={() => handleDelete('ai', r)} style={mh}>
            删除
          </Button>
        )}
        <Button size={btnSize} icon={<FileTextOutlined />} onClick={() => openCode(r)} style={mh}>
          查看代码
        </Button>
      </div>
    );
  };

  /* ══════════ 卡片渲染 ══════════ */
  const renderBiCard = (r: ReportItem) => {
    const m = typeMeta(r.reportType);
    return (
      <Card
        key={r.id}
        hoverable
        data-report-id={r.id}
        style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12, height: '100%', overflow: 'hidden' }}
        styles={{ body: { padding: 16 } }}
        onClick={() => viewItem('bi', r)}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div
            style={{
              width: 38,
              height: 38,
              flex: '0 0 38px',
              borderRadius: 10,
              background: `linear-gradient(135deg, ${m.color}, ${SIDER.bgTo})`,
              color: NEUTRAL.textInverse,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 17,
            }}
          >
            {r.reportType === 'table' ? <TableOutlined /> : <BarChartOutlined />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: NEUTRAL.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.name}
            </div>
            <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary, marginTop: 2 }}>
              {r.code}
              {r.category ? ` · ${r.category}` : ''}
            </div>
          </div>
          <Tag color={m.color} bordered={false} style={{ color: NEUTRAL.textInverse, marginInlineEnd: 0 }}>
            {m.label}
          </Tag>
        </div>

        <div
          style={{
            marginTop: 10,
            fontSize: 12.5,
            color: NEUTRAL.textSecondary,
            minHeight: 36,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {r.description || '暂无描述'}
        </div>

        <div style={{ marginTop: 10, display: 'flex', gap: 14, fontSize: 12, color: NEUTRAL.textSecondary, flexWrap: 'wrap' }}>
          <span>
            <EyeOutlined /> {fmtNum(r.viewCount || 0)}
          </span>
          <span>
            <ShareAltOutlined /> {fmtNum(r.shareCount || 0)}
          </span>
          <span>
            <ClockCircleOutlined /> {fmtAgo(r.updatedAt)}
          </span>
          {Number(r.status) !== 1 && <Tag color={PALETTE.gray}>已停用</Tag>}
        </div>

        {renderBiActions(r)}
      </Card>
    );
  };

  const renderAiCard = (r: AiReportItem) => {
    const builtin = r.source === 'builtin';
    return (
      <Card
        key={r.id}
        hoverable
        data-ai-report-id={r.id}
        style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12, height: '100%', overflow: 'hidden' }}
        styles={{ body: { padding: 16 } }}
        onClick={() => viewItem('ai', r)}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div
            style={{
              width: 38,
              height: 38,
              flex: '0 0 38px',
              borderRadius: 10,
              background: `linear-gradient(135deg, ${PALETTE.violet}, ${SIDER.bgTo})`,
              color: NEUTRAL.textInverse,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 17,
            }}
          >
            <RobotOutlined />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: NEUTRAL.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.icon ? `${r.icon} ` : ''}
              {r.name}
            </div>
            <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary, marginTop: 2 }}>
              {r.code}
              {r.group ? ` · ${r.group}` : ''}
            </div>
          </div>
          <Tag color={builtin ? PALETTE.green : PALETTE.violet} bordered={false} style={{ color: NEUTRAL.textInverse, marginInlineEnd: 0 }}>
            {builtin ? '内置' : 'AI'}
          </Tag>
        </div>

        <div
          style={{
            marginTop: 10,
            fontSize: 12.5,
            color: NEUTRAL.textSecondary,
            minHeight: 36,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {r.description || '暂无描述'}
        </div>

        <div style={{ marginTop: 10, display: 'flex', gap: 14, fontSize: 12, color: NEUTRAL.textSecondary, flexWrap: 'wrap' }}>
          <span>
            <EyeOutlined /> {fmtNum(r.viewCount || 0)}
          </span>
          {r.tags ? <span>{r.tags}</span> : null}
          <span>
            <ClockCircleOutlined /> {fmtAgo(r.updatedAt)}
          </span>
          {Number(r.status) !== 1 && <Tag color={PALETTE.gray}>已停用</Tag>}
        </div>

        {renderAiActions(r)}
      </Card>
    );
  };

  return (
    <Page
      title="报表中心"
      search={
        <>
          <Select
            value={categoryFilter}
            onChange={setCategoryFilter}
            style={{ width: isMobile ? 120 : 140 }}
            options={[{ value: 'all', label: '全部分类' }, ...categories.map((c) => ({ value: c, label: c }))]}
          />
          <Input.Search
            allowClear
            placeholder="搜索报表名称 / 编码 / 分类"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={(v) => setKeyword(v)}
            style={{ width: isMobile ? 190 : 250 }}
          />
        </>
      }
      actions={
        canWrite ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建报表
          </Button>
        ) : undefined
      }
      extra={
        <Segmented
          value={viewMode}
          onChange={(v) => setViewMode(v as 'card' | 'table')}
          options={[
            { value: 'card', icon: <AppstoreOutlined />, label: isMobile ? '' : '卡片' },
            { value: 'table', icon: <UnorderedListOutlined />, label: isMobile ? '' : '表格' },
          ]}
        />
      }
      subTabs={
        <Tabs
          activeKey={typeFilter}
          onChange={setTypeFilter}
          items={[
            { key: 'all', label: '全部报表' },
            { key: 'ai', label: `AI 报表（${aiReports.length}）` },
            { key: 'chart', label: '图表报表' },
            { key: 'table', label: '表格报表' },
            { key: 'dashboard', label: '数据看板' },
          ]}
        />
      }
      stats={statItems}
    >
      {loadError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          title="加载报表列表失败"
          description={loadError}
          action={
            <Button size="small" onClick={load}>
              重试
            </Button>
          }
        />
      )}

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center' }}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          {/* AI 报表分组：内置（系统预置）+ 用户自建，均来自 GET /api/ai-reports */}
          {showAI && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: isMobile ? 13.5 : 14.5, fontWeight: 700, color: NEUTRAL.text }}>AI 报表</span>
                <span style={{ fontSize: 12, color: NEUTRAL.textTertiary }}>
                  共 {fmtNum(filteredAi.length)} 个 · 含内置看板 {builtinAi.length} 个（DSL 配置驱动）
                </span>
              </div>
              {filteredAi.length === 0 ? (
                <Card style={{ border: `1px dashed ${NEUTRAL.border}`, borderRadius: 12 }}>
                  <Empty description="暂无 AI 报表" />
                </Card>
              ) : (
                <Row gutter={[12, 12]}>
                  {filteredAi.map((r) => (
                    <Col xs={24} sm={12} lg={8} xxl={6} key={r.id}>
                      {renderAiCard(r)}
                    </Col>
                  ))}
                </Row>
              )}
            </div>
          )}

          {/* BI 报表分组（chart / table / dashboard，原方式展示与运行） */}
          {showBI && (
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: isMobile ? 13.5 : 14.5, fontWeight: 700, color: NEUTRAL.text }}>BI 报表</span>
                <span style={{ fontSize: 12, color: NEUTRAL.textTertiary }}>共 {fmtNum(filteredBi.length)} 个</span>
              </div>

              {filteredBi.length === 0 ? (
                <Card style={{ border: `1px dashed ${NEUTRAL.border}`, borderRadius: 12 }}>
                  <Empty
                    description={
                      keyword || typeFilter !== 'all' || categoryFilter !== 'all' ? '没有符合条件的 BI 报表' : '还没有 BI 报表'
                    }
                  >
                    {canWrite && (
                      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                        {biReports.length ? '新建报表' : '新建第一个报表'}
                      </Button>
                    )}
                  </Empty>
                </Card>
              ) : viewMode === 'card' || isMobile ? (
                <Row gutter={[12, 12]}>
                  {filteredBi.map((r) => (
                    <Col xs={24} sm={12} lg={8} xxl={6} key={r.id}>
                      {renderBiCard(r)}
                    </Col>
                  ))}
                </Row>
              ) : (
                <Card styles={{ body: { padding: 0 } }} style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12, overflow: 'hidden' }}>
                  <ProTable<ReportItem>
                    rowKey="id"
                    columns={columns}
                    dataSource={filteredBi}
                    search={false}
                    options={{ reload: false, density: false, setting: false }}
                    toolBarRender={false}
                    scroll={{ x: 'max-content' }}
                    pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 个报表` }}
                  />
                </Card>
              )}
            </div>
          )}
        </>
      )}

      {/* ══════════ 新建报表（BI） ══════════ */}
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

      {/* ══════════ 分享弹窗（不跳转） ══════════ */}
      <Modal
        title="分享报表"
        open={shareOpen}
        onCancel={closeShare}
        width={isMobile ? '92vw' : 480}
        destroyOnHidden
        footer={
          shareResult
            ? [
                <Button key="again" onClick={() => setShareResult(null)}>
                  再建一个
                </Button>,
                <Button
                  key="copy"
                  type="primary"
                  icon={<CopyOutlined />}
                  onClick={async () => {
                    const ok = await copyText(shareResult.url);
                    if (ok) message.success('链接已复制');
                    else message.warning('复制失败，请手动复制');
                  }}
                >
                  复制链接
                </Button>,
                <Button key="close" onClick={closeShare}>
                  关闭
                </Button>,
              ]
            : [
                <Button key="cancel" onClick={closeShare}>
                  取消
                </Button>,
                <Button key="ok" type="primary" loading={sharing} onClick={submitShare}>
                  生成分享链接
                </Button>,
              ]
        }
      >
        {shareTarget && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: NEUTRAL.surfaceSunken, borderRadius: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: NEUTRAL.text }}>{shareTarget.name}</div>
            <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary, marginTop: 2 }}>
              {shareTarget.kind === 'board' ? '分享内置看板' : '分享报表'}
              {shareTarget.hint ? ` · ${shareTarget.hint}` : ''}
            </div>
          </div>
        )}

        {shareResult ? (
          <div>
            <FieldLabel>分享链接</FieldLabel>
            <Input
              value={shareResult.url}
              readOnly
              size="large"
              prefix={<LinkOutlined style={{ color: NEUTRAL.textTertiary }} />}
            />
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, color: NEUTRAL.textSecondary }}>
              <div>
                <CheckCircleOutlined style={{ color: PALETTE.green }} /> 已创建：{shareResult.title}
              </div>
              <div>
                <ClockCircleOutlined /> 有效期：{shareResult.expiresLabel}
              </div>
              {shareResult.password ? (
                <div>
                  <LockOutlined /> 访问密码：<strong>{shareResult.password}</strong>（请一并告知接收人）
                </div>
              ) : (
                <div>
                  <LockOutlined /> 未设置访问密码
                </div>
              )}
              <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary }}>可到「分享中心」管理该链接（修改标题 / 有效期 / 密码 / 停用）。</div>
            </div>
          </div>
        ) : (
          <Form form={shareForm} layout="vertical" requiredMark={false} style={{ marginTop: 4 }}>
            <Form.Item name="title" label="分享标题" rules={[{ required: true, message: '请输入分享标题' }]}>
              <Input size="large" maxLength={60} placeholder="接收人打开链接时看到的标题" />
            </Form.Item>
            <Form.Item name="expiresDays" label="有效期">
              <Select size="large" options={SHARE_EXPIRES.map((e) => ({ value: e.value, label: e.label }))} />
            </Form.Item>
            <Form.Item
              name="password"
              label={
                <FieldLabel extra="留空则无需密码">
                  访问密码（可选）
                </FieldLabel>
              }
            >
              <Input
                size="large"
                maxLength={32}
                placeholder="留空则免密码访问"
                addonAfter={
                  <a onClick={() => shareForm.setFieldValue('password', genPassword())} style={{ fontSize: 12 }}>
                    随机生成
                  </a>
                }
              />
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* ══════════ 编辑弹窗（名称/图标/标题/描述/标签/分组） ══════════ */}
      <Modal
        title={editTarget?.kind === 'ai' ? '编辑 AI 报表' : '编辑报表'}
        open={!!editTarget}
        onCancel={() => setEditTarget(null)}
        onOk={submitEdit}
        confirmLoading={savingEdit}
        okText="保存"
        cancelText="取消"
        width={isMobile ? '92vw' : 520}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" requiredMark={false} style={{ marginTop: 12 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input size="large" maxLength={60} placeholder="报表名称" />
          </Form.Item>
          <Form.Item name="title" label="标题">
            <Input size="large" maxLength={64} placeholder="展示用标题（可选）" />
          </Form.Item>
          <Form.Item name="group" label="分组">
            <Input size="large" maxLength={64} placeholder="如：中康智能体（可选）" />
          </Form.Item>
          <Form.Item name="icon" label="图标">
            <Input size="large" maxLength={64} placeholder="emoji 或图标名（可选）" />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Input size="large" maxLength={255} placeholder="逗号分隔（可选）" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} maxLength={200} showCount placeholder="用于解释报表口径（可选）" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ══════════ 查看代码（只读，与后端逐字一致） ══════════ */}
      <Modal
        title="查看代码（DSL 配置）"
        open={codeOpen}
        onCancel={() => setCodeOpen(false)}
        width={isMobile ? '94vw' : 720}
        footer={[
          <Button key="copy" icon={<CopyOutlined />} onClick={async () => {
            const ok = await copyText(codeText);
            if (ok) message.success('已复制');
          }}>
            复制
          </Button>,
          <Button key="close" type="primary" onClick={() => setCodeOpen(false)}>
            关闭
          </Button>,
        ]}
      >
        <div style={{ fontSize: 12, color: NEUTRAL.textTertiary, marginBottom: 6 }}>
          {codeTarget?.name} · 共 {codeText.length} 个字符（只读，与后端逐字一致）
        </div>
        <Input.TextArea
          value={codeText}
          readOnly
          rows={18}
          spellCheck={false}
          style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 12.5 }}
        />
      </Modal>

      {/* ══════════ 修改代码 / 手动调整（可编辑） ══════════ */}
      <Modal
        title="修改代码（DSL 配置）"
        open={codeEditOpen}
        onCancel={() => setCodeEditOpen(false)}
        onOk={saveCode}
        confirmLoading={savingCode}
        okText="保存"
        cancelText="取消"
        width={isMobile ? '94vw' : 720}
        destroyOnHidden
      >
        <div style={{ fontSize: 12, color: NEUTRAL.textTertiary, marginBottom: 6 }}>
          {codeTarget?.name || 'AI 报表'} · JSON 配置，保存时由服务端白名单校验
        </div>
        <Input.TextArea
          value={codeEditText}
          onChange={(e) => setCodeEditText(e.target.value)}
          rows={18}
          spellCheck={false}
          style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 12.5 }}
        />
      </Modal>

      {/* ══════════ AI 调整（prompt → ai-draft，30 秒超时兜底） ══════════ */}
      <Modal
        title="AI 调整"
        open={aiOpen}
        onCancel={() => setAiOpen(false)}
        onOk={runAiAdjust}
        confirmLoading={aiLoading}
        okText={aiLoading ? '生成中…' : '生成草稿'}
        cancelText="取消"
        width={isMobile ? '92vw' : 520}
        destroyOnHidden
      >
        <div style={{ fontSize: 12.5, color: NEUTRAL.textSecondary, marginBottom: 8 }}>
          用一句话描述你想要的 AI 报表（如：用折线图展示签约趋势，并加 KPI 卡）。AI 只产出 DSL 配置草稿，不会执行任何代码。
        </div>
        <Input.TextArea
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          rows={4}
          maxLength={300}
          showCount
          placeholder="例如：签 KPI 卡 + 签约趋势折线图 + 签约明细表"
          disabled={aiLoading}
        />
        {aiLoading && (
          <div style={{ marginTop: 10, fontSize: 12, color: NEUTRAL.textTertiary }}>
            <Spin size="small" /> 正在生成草稿…（超过 30 秒将提示改用手动调整）
          </div>
        )}
        <div style={{ marginTop: 10, fontSize: 11.5, color: NEUTRAL.textTertiary }}>
          <ThunderboltOutlined /> 若本地无模型凭据，AI 服务可能不可用，届时可点「手动调整」直接编辑 DSL。
        </div>
      </Modal>

      {/* 隐藏的 reload 图标引用（保持工具栏一致，不额外占位） */}
      <span style={{ display: 'none' }}>
        <ReloadOutlined />
        <Space />
      </span>
    </Page>
  );
}
