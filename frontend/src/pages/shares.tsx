/**
 * 分享中心（V13 B3 改名，原「分享管理」）
 *
 * 用户原话：「报表中心和 AI 问数的分享都统一放到分享中心」
 *
 * 根因：分享能力此前被实现了两遍、且互不可见 ——
 *   · 报表中心 reports.tsx 内含完整 ShareModal + 3 处分享按钮，数据走 /api/shares；
 *   · AI 问数 ai.tsx 内含独立的创建弹窗 + 「分享管理」抽屉，数据走 /api/ai/shares；
 *   · 而本页（原「分享管理」）只展示报表分享，看不到 AI 问数分享。
 *   → 用户在三处看到三套不同的分享界面，AI 问数的分享在这里完全不可见。
 *
 * 现在本页升级为**双标签页**：
 *   · 报表分享：原有实现原样搬进 Tab
 *   · AI 问数分享：新增，数据来自 listAiShares()
 * 两个来源在同一处管理；报表中心与 AI 问数页的操作都改为跳到这里（?tab=report|ai）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  DatePicker,
  Drawer,
  Empty,
  Form,
  Grid,
  Input,
  Modal,
  Radio,
  Result,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  BarChartOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  LinkOutlined,
  LockOutlined,
  PlusOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import Page from '@/components/Page';
import PageTabs, { PageTabTag, pageTabLabel } from '@/components/PageTabs';
import type { StatCardItem } from '@/components/StatCards';
import { NEUTRAL, PALETTE } from '@/theme';
import { useAppStore } from '@/stores/app';
import { copyText, fmtAgo, fmtNum, fmtTime } from '@/utils';
import {
  createShare,
  deleteShare,
  getShareStats,
  listReports,
  listShares,
  shareUrlOf,
  toggleShare,
  updateShare,
  type ReportItem,
  type ShareItem,
  type ShareSourceStats,
  type ShareStatsResult,
  type ShareVisitRow,
} from '@/api/reports';
import {
  aiShareUrl,
  getAiShareStats,
  listAiShares,
  removeAiShare,
  setAiShareStatus,
  updateAiShare,
  type AiShareItem,
} from '@/api/ai';

const { useBreakpoint } = Grid;
const { Text, Paragraph } = Typography;

const EXPIRE_OPTIONS = [
  { value: 1, label: '1 天' },
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
  { value: 90, label: '90 天' },
  { value: 365, label: '1 年' },
];

function isExpired(s: ShareItem): boolean {
  return !!s.expiresAt && new Date(s.expiresAt).getTime() < Date.now();
}

/** AI 问数分享的有效性判定（字段与 ShareItem 不同：状态同为 1/0，到期字段同名） */
function isAiExpired(s: AiShareItem): boolean {
  return !!s.expiresAt && new Date(s.expiresAt).getTime() < Date.now();
}

/* ══════════════ V16：分享访问统计（需求 2.5 / 2.6） ══════════════ */

/**
 * 需求 2.5 的 10 项指标，逐字命名、顺序固定。
 * 后端 `provinceStatus==='pending'` 时省份列必须显示「暂无数据（待接入省份库）」，不得伪造。
 */
const STAT_SOURCE_LABEL: Record<string, string> = {
  beacon: '应用埋点',
  nginx: 'nginx 日志',
};

function countText(list?: { name: string; count: number }[]): string {
  if (!list || !list.length) return '—';
  return list
    .slice(0, 3)
    .map((x) => `${x.name} ${fmtNum(x.count)}`)
    .join('、');
}

/** 字节数友好格式（流量指标用；无真实数据源时调用方显示「暂无」） */
function fmtBytes(n: number): string {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 单来源（beacon / nginx）的 10 项指标。**两套数字分开给，绝不合并** */
function StatSourceBlock({
  title,
  data,
  provinceStatus,
  provinceNote,
}: {
  title: string;
  data?: ShareSourceStats;
  provinceStatus?: 'ok' | 'pending';
  provinceNote?: string;
}) {
  const d = data || ({} as ShareSourceStats);

  /* 省份：无省份库（pending）或后端明确返回空数组时，一律如实说「暂无」，
     绝不把「未接入」渲染成「未知」这样的真实分类。 */
  const provincePending = provinceStatus === 'pending' || !d.provinces || d.provinces.length === 0;
  const provinceText = provincePending
    ? provinceNote || '暂无（待接入省份库）'
    : countText(d.provinces);

  /* 流量：beacon 源不记响应体字节数（hasTraffic=false），此时显示「暂无」而非假 0 */
  const trafficKnown = d.hasTraffic === true;
  const trafficText = trafficKnown ? fmtBytes(d.traffic || 0) : '暂无';
  const trafficTip = trafficKnown
    ? d.trafficSource || '响应体字节数合计'
    : '应用埋点不记录响应体字节数，接入 nginx 日志回填后可见';

  const items: { label: string; value: React.ReactNode }[] = [
    {
      label: '流量',
      value: (
        <Tooltip title={trafficTip}>
          <span data-traffic-text={trafficText}>{trafficText}</span>
        </Tooltip>
      ),
    },
    { label: '请求数', value: fmtNum(d.requests || 0) },
    { label: 'IP', value: fmtNum(d.ips || 0) },
    { label: 'UV', value: fmtNum(d.uv || 0) },
    { label: 'PV', value: fmtNum(d.pv || 0) },
    { label: '浏览器类型', value: countText(d.browsers) },
    { label: '操作系统类型', value: countText(d.oses) },
    { label: '访客IP', value: countText(d.visitorIps) },
    { label: '省份', value: provinceText },
    { label: '设备类型', value: countText(d.devices) },
  ];
  return (
    <Card
      size="small"
      title={<span style={{ fontSize: 13 }}>{title}</span>}
      style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 10, marginBottom: 12 }}
      styles={{ body: { padding: 12 } }}
    >
      <Row gutter={[10, 10]}>
        {items.map((it) => (
          <Col xs={12} sm={8} md={6} lg={4} key={it.label}>
            <div
              data-stat-item={it.label}
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                background: NEUTRAL.surfaceSunken,
                minHeight: 58,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary }}>{it.label}</div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: NEUTRAL.text,
                  marginTop: 4,
                  wordBreak: 'break-all',
                }}
              >
                {it.value}
              </div>
            </div>
          </Col>
        ))}
      </Row>
    </Card>
  );
}

export default function SharesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { message, modal } = AntApp.useApp();
  const { can } = useAppStore();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const canWrite = can(['share:write', 'share:read']);

  /**
   * V13 B3：当前标签页。支持 URL `?tab=report|ai` 指定初始 Tab，
   * 以便报表中心 / AI 问数页跳过来时直接落到正确来源（用户从哪来就看哪一份）。
   */
  const [tab, setTab] = useState<string>(() => {
    const t = searchParams.get('tab');
    return t === 'ai' ? 'ai' : 'report';
  });

  const [list, setList] = useState<ShareItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled' | 'expired'>('all');

  /* V13 B3：AI 问数分享（数据源 /api/ai/shares） */
  const [aiList, setAiList] = useState<AiShareItem[]>([]);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiError, setAiError] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<ShareItem | null>(null);
  const [form] = Form.useForm();

  /* ══════════ V16：编辑分享（需求 2.0~2.4 / 2.7，两个 Tab 共用一套弹窗） ══════════ */
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editTarget, setEditTarget] = useState<
    { kind: 'report'; row: ShareItem } | { kind: 'ai'; row: AiShareItem } | null
  >(null);
  const [editForm] = Form.useForm();
  /* 有效期模式：permanent / days / custom（自定义具体时间） */
  const [expireMode, setExpireMode] = useState<'permanent' | 'days' | 'custom'>('permanent');
  const [pwdOn, setPwdOn] = useState(false);
  /* 打开编辑弹窗时该分享「原本是否已有密码」：决定密码框留空时是「不修改」还是「必须填写」 */
  const [editHadPassword, setEditHadPassword] = useState(false);

  /* ══════════ V16：访问统计抽屉（需求 2.5 / 2.6） ══════════ */
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState('');
  const [stats, setStats] = useState<ShareStatsResult | null>(null);
  const [statsDays, setStatsDays] = useState(30);
  const [statsTarget, setStatsTarget] = useState<
    { kind: 'report' | 'ai'; id: number; title: string } | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [shares, reps] = await Promise.all([
        listShares(),
        listReports().catch(() => [] as ReportItem[]),
      ]);
      setList(shares || []);
      setReports(reps || []);
    } catch (e) {
      setList([]);
      setLoadError(e instanceof Error ? e.message : '加载分享列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAi = useCallback(async () => {
    setAiLoading(true);
    setAiError('');
    try {
      const shares = await listAiShares();
      setAiList(shares || []);
    } catch (e) {
      setAiList([]);
      setAiError(e instanceof Error ? e.message : '加载 AI 问数分享失败');
    } finally {
      setAiLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadAi();
  }, [load, loadAi]);

  /** 切换 Tab 时同步 URL（conservative：用 replace 避免污染浏览历史） */
  const onTabChange = (k: string) => {
    setTab(k);
    setKeyword('');
    setStatusFilter('all');
    try {
      /* 不用 navigate 是为了避免与 react-router 的 effect 竞争；直接改 history 即可 */
      const url = new URL(window.location.href);
      url.searchParams.set('tab', k);
      window.history.replaceState(null, '', url.toString());
    } catch {
      /* ignore */
    }
  };

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return list.filter((s) => {
      if (statusFilter === 'active' && (Number(s.status) !== 1 || isExpired(s))) return false;
      if (statusFilter === 'disabled' && Number(s.status) === 1) return false;
      if (statusFilter === 'expired' && !isExpired(s)) return false;
      if (!kw) return true;
      return [s.title, s.reportName, s.token, s.targetId]
        .filter((v) => v !== undefined && v !== null)
        .some((v) => String(v).toLowerCase().includes(kw));
    });
  }, [list, keyword, statusFilter]);

  /** V6.1 数据卡片（4 个：分享数 / 有效 / 已过期 / 总访问）—— V13 B3：按当前 Tab 分别统计 */
  const statItems = useMemo<StatCardItem[]>(() => {
    if (tab === 'ai') {
      const totalAi = aiList.length;
      const validAi = aiList.filter((s) => Number(s.status) === 1 && !isAiExpired(s)).length;
      const expiredAi = aiList.filter((s) => isAiExpired(s)).length;
      const viewsAi = aiList.reduce((sum, s) => sum + (s.viewCount || 0), 0);
      return [
        { key: 'total', label: 'AI 分享数', value: fmtNum(totalAi), suffix: '个', color: PALETTE.primary },
        { key: 'valid', label: '有效', value: fmtNum(validAi), suffix: '个', color: PALETTE.green },
        { key: 'expired', label: '已过期', value: fmtNum(expiredAi), suffix: '个', color: expiredAi > 0 ? PALETTE.red : PALETTE.yellow },
        { key: 'views', label: '总访问', value: fmtNum(viewsAi), suffix: '次', color: PALETTE.cyan },
      ];
    }
    const total = list.length;
    const valid = list.filter((s) => Number(s.status) === 1 && !isExpired(s)).length;
    const expired = list.filter((s) => isExpired(s)).length;
    const totalViews = list.reduce((sum, s) => sum + (s.viewCount || 0), 0);

    return [
      {
        key: 'total',
        label: '分享数',
        value: fmtNum(total),
        suffix: '个',
        color: PALETTE.primary,
        onClick: () => setStatusFilter('all'),
      },
      {
        key: 'valid',
        label: '有效',
        value: fmtNum(valid),
        suffix: '个',
        color: PALETTE.green,
        onClick: () => setStatusFilter('active'),
      },
      {
        key: 'expired',
        label: '已过期',
        value: fmtNum(expired),
        suffix: '个',
        color: expired > 0 ? PALETTE.red : PALETTE.yellow,
        onClick: () => setStatusFilter('expired'),
      },
      {
        key: 'views',
        label: '总访问',
        value: fmtNum(totalViews),
        suffix: '次',
        color: PALETTE.cyan,
      },
    ];
  }, [list, aiList, tab]);

  const openCreate = (reportId?: number) => {
    form.resetFields();
    form.setFieldsValue({ targetType: 'report', expiresDays: 7, targetId: reportId });
    setCreated(null);
    setCreateOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setCreating(true);
      const share = await createShare({
        targetType: 'report',
        targetId: values.targetId,
        title: values.title || undefined,
        /* V16.1 需求 3：描述 / 缩略图（留空则不传，后端落 NULL） */
        description: String(values.description || '').trim() || undefined,
        thumb: String(values.thumb || '').trim() || undefined,
        expiresDays: values.expiresDays || undefined,
        password: values.password || undefined,
        allowExport: !!values.allowExport,
      });
      setCreated(share);
      setList((prev) => [share, ...prev]);
      message.success('分享链接已创建');
    } catch (e) {
      if ((e as { errorFields?: unknown }).errorFields) return;
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async (s: ShareItem) => {
    const ok = await copyText(shareUrlOf(s));
    if (ok) message.success('链接已复制到剪贴板');
    else message.warning('复制失败，请手动选择链接复制');
  };

  const handleToggle = async (s: ShareItem, checked: boolean) => {
    try {
      const next = await toggleShare(s.id, checked ? 1 : 0);
      setList((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: next.status } : x)));
      message.success(checked ? '分享已启用' : '分享已停用');
    } catch {
      /* client 已提示 */
    }
  };

  const handleDelete = (s: ShareItem) => {
    modal.confirm({
      title: '删除该分享链接？',
      content: '删除后原链接立即失效，且不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await deleteShare(s.id);
        message.success('分享已删除');
        setList((prev) => prev.filter((x) => x.id !== s.id));
      },
    });
  };

  /* ══════════════════════════════════════════════════════════════
   * V16 需求 2.0~2.4 / 2.7：编辑分享（报表分享 + AI 问数分享共用）
   *   · 报表分享 → PUT    /api/shares/:id
   *   · AI 分享   → PATCH  /api/ai/shares/:id
   * 两者字段语义完全一致：title / expiresAt|expiresDays / password / passwordOn / status
   * ══════════════════════════════════════════════════════════════ */

  /** 打开编辑弹窗：按类型回填当前值（需求 2.0「复开回填正确」） */
  const openEdit = (target: { kind: 'report'; row: ShareItem } | { kind: 'ai'; row: AiShareItem }) => {
    const row = target.row;
    setEditTarget(target);
    editForm.resetFields();
    const hasPwd =
      target.kind === 'report'
        ? !!(target.row as ShareItem).hasPassword
        : !!(target.row as AiShareItem).hasPassword;
    setPwdOn(hasPwd);
    setEditHadPassword(hasPwd);
    const exp = row.expiresAt ? new Date(row.expiresAt) : null;
    /* antd6 的 DatePicker 只接受 dayjs 对象：传原生 Date 或 null 都会抛
       `getUDayjs(...).isValid is not a function`，进而让整个弹窗渲染崩掉。 */
    const validExp = exp && !Number.isNaN(exp.getTime()) ? dayjs(exp) : null;
    setExpireMode(validExp ? 'custom' : 'permanent');
    editForm.setFieldsValue({
      title: row.title || '',
      description: (row as { description?: string }).description || '',
      thumb: (row as { thumb?: string }).thumb || '',
      expiresDays: undefined,
      /* antd6 的 DatePicker 收到 null 会抛 `getUDayjs(...).isValid is not a function`，
         因此「无到期时间」时只靠 resetFields 清空，绝不把 null 塞给该字段。 */
      ...(validExp ? { expiresAt: validExp } : {}),
      passwordOn: hasPwd,
      password: '',
    });
    setEditOpen(true);
  };

  /** 保存编辑：把表单收集成后端 PUT/PATCH 的 payload */
  const submitEdit = async () => {
    if (!editTarget) return;
    /* 提前快照：后面会先 setEditTarget(null)，闭包里的 state 不能再读 */
    const target = editTarget;
    let values: Record<string, unknown>;
    try {
      values = (await editForm.validateFields()) as Record<string, unknown>;
    } catch {
      return; /* 校验失败，Form 已自行提示 */
    }

    const payload: {
      title?: string;
      description?: string;
      thumb?: string;
      expiresAt?: string | null;
      expiresDays?: number;
      password?: string | null;
      passwordOn?: boolean;
    } = {};

    /* 需求 2.0 / 2.1：分享标题（空串 = 清除，后端会落空串） */
    payload.title = String(values.title ?? '');

    /* V16.1 需求 3：分享描述 / 缩略图（空串 = 清除 → 后端落 NULL，回退默认） */
    payload.description = String(values.description ?? '');
    const thumbRaw = String(values.thumb ?? '').trim();
    if (thumbRaw && !/^(https?:\/\/|\/)/i.test(thumbRaw)) {
      message.error('缩略图需填 http(s) 图片地址，或以 / 开头的站内路径');
      return;
    }
    payload.thumb = thumbRaw;

    /* 需求 2.2：有效期 —— 永久(null) / N 天 / 自定义具体时间 */
    if (expireMode === 'permanent') {
      payload.expiresAt = null;
    } else if (expireMode === 'days') {
      const d = Number(values.expiresDays);
      const days = Number.isFinite(d) && d > 0 ? d : 0;
      /* 后端 reports.updateShare 的判定顺序是「先看 expiresAt 是否 null，再看 expiresDays」，
         同发 { expiresAt: null, expiresDays: 7 } 会被 null 抢先判成「永久」。
         因此按天数模式**只发 expiresDays**，绝不并发 expiresAt。
         days=0 时后端也会落 null（永久），无需再补 expiresAt:null。 */
      payload.expiresDays = days;
    } else {
      const dt = values.expiresAt as { toDate?: () => Date } | null | undefined;
      const d = dt && typeof dt.toDate === 'function' ? dt.toDate() : null;
      payload.expiresAt = d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
    }

    /* 需求 2.3 / 2.4：访问密码 —— 关 = password:''（后端置 NULL）；开 = 必须给新密码 */
    if (!pwdOn) {
      payload.password = '';
    } else {
      const pwd = String(values.password ?? '');
      if (!pwd) {
        /* 密码框留空 = 不修改密码。
           原本就有密码（用户只改标题/有效期）⇒ 完全不提交密码字段，后端保持原密码；
           原本没有密码却打开了开关 ⇒ 必须填写，否则后端 400。 */
        if (!editHadPassword) {
          message.error('开启访问密码时必须填写密码');
          return;
        }
      } else {
        if (pwd.length > 64) {
          message.error('访问密码不能超过 64 个字符');
          return;
        }
        payload.password = pwd;
        payload.passwordOn = true;
      }
    }

    setEditSaving(true);
    try {
      if (target.kind === 'report') {
        const next = await updateShare(target.row.id, payload);
        setList((prev) =>
          prev.map((x) =>
            x.id === target.row.id
              ? {
                  ...x,
                  ...next,
                  /* 后端 publicShare 可能不回 reportName，保留原值避免列表标题闪没 */
                  reportName: next.reportName || x.reportName,
                }
              : x,
          ),
        );
      } else {
        const next = await updateAiShare(target.row.id, payload);
        setAiList((prev) => prev.map((x) => (x.id === target.row.id ? { ...x, ...next } : x)));
      }
      message.success('分享设置已更新');
      setEditOpen(false);
      setEditTarget(null);
      /* 兜底再拉一次列表，确保与后端落库一致 */
      if (target.kind === 'report') load();
      else loadAi();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setEditSaving(false);
    }
  };

  /* ══════════════════════════════════════════════════════════════
   * V16 需求 2.5 / 2.6：访问统计（10 项汇总 + 明细）
   * ══════════════════════════════════════════════════════════════ */

  const loadStats = useCallback(
    async (kind: 'report' | 'ai', id: number, days: number) => {
      setStatsLoading(true);
      setStatsError('');
      try {
        const res =
          kind === 'report' ? await getShareStats('report', id, { days, limit: 200 }) : await getAiShareStats(id, { days, limit: 200 });
        setStats(res);
      } catch (e) {
        setStats(null);
        setStatsError(e instanceof Error ? e.message : '加载访问统计失败');
      } finally {
        setStatsLoading(false);
      }
    },
    [],
  );

  const openStats = (kind: 'report' | 'ai', id: number, title: string) => {
    setStatsTarget({ kind, id, title });
    setStats(null);
    setStatsOpen(true);
    loadStats(kind, id, statsDays);
  };

  const statusTag = (s: ShareItem) => {
    if (Number(s.status) !== 1) return <Tag color={PALETTE.gray}>已停用</Tag>;
    if (isExpired(s)) return <Tag color={PALETTE.red}>已过期</Tag>;
    return <Tag color={PALETTE.green}>生效中</Tag>;
  };

  const columns: ProColumns<ShareItem>[] = [
    {
      title: '分享对象',
      dataIndex: 'title',
      sorter: (a, b) => String(a.title || a.reportName || '').localeCompare(String(b.title || b.reportName || '')),
      render: (_, s) => (
        <div style={{ minWidth: 0 }}>
          <a onClick={() => navigate(`/reports/${s.targetId}/view`)} style={{ fontWeight: 600, fontSize: 13.5 }}>
            {s.title || s.reportName || `报表 #${s.targetId}`}
          </a>
          <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary }}>
            {s.targetType === 'report' ? '报表' : s.targetType} #{s.targetId}
          </div>
        </div>
      ),
    },
    {
      title: '分享链接',
      dataIndex: 'token',
      width: 240,
      render: (_, s) => (
        <Space size={6}>
          <Text code style={{ fontSize: 11.5 }}>
            /s/{s.token.slice(0, 10)}…
          </Text>
          <Tooltip title="复制完整链接">
            <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => copyLink(s)} />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      sorter: (a, b) => Number(a.status || 0) - Number(b.status || 0),
      render: (_, s) => statusTag(s),
    },
    {
      title: '保护',
      dataIndex: 'hasPassword',
      width: 80,
      align: 'center',
      render: (_, s) =>
        s.hasPassword ? (
          <Tooltip title="需要访问密码">
            <LockOutlined style={{ color: PALETTE.yellow }} />
          </Tooltip>
        ) : (
          <span style={{ color: NEUTRAL.textQuaternary }}>—</span>
        ),
    },
    {
      title: '有效期至',
      dataIndex: 'expiresAt',
      width: 150,
      sorter: (a, b) => new Date(a.expiresAt || 0).getTime() - new Date(b.expiresAt || 0).getTime(),
      render: (_, s) => (
        <span style={{ fontSize: 12, color: isExpired(s) ? PALETTE.red : NEUTRAL.textSecondary }}>
          {s.expiresAt ? fmtTime(s.expiresAt, 'YYYY-MM-DD HH:mm') : '永久有效'}
        </span>
      ),
    },
    {
      title: '访问',
      dataIndex: 'viewCount',
      width: 85,
      align: 'right',
      sorter: (a, b) => Number(a.viewCount || 0) - Number(b.viewCount || 0),
      render: (_, s) => fmtNum(s.viewCount || 0),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 130,
      sorter: (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
      render: (_, s) => (
        <Tooltip title={fmtTime(s.createdAt)}>
          <span style={{ fontSize: 12, color: NEUTRAL.textSecondary }}>{fmtAgo(s.createdAt)}</span>
        </Tooltip>
      ),
    },
    {
      title: '启用',
      dataIndex: 'enable',
      width: 75,
      align: 'center',
      render: (_, s) => (
        <Switch size="small" checked={Number(s.status) === 1} disabled={!canWrite} onChange={(v) => handleToggle(s, v)} />
      ),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 210,
      fixed: 'right',
      render: (_, s) => [
        <a key="open" onClick={() => window.open(shareUrlOf(s), '_blank')}>
          打开
        </a>,
        <a key="copy" onClick={() => copyLink(s)}>
          复制
        </a>,
        canWrite ? (
          <a key="edit" data-act="edit" onClick={() => openEdit({ kind: 'report', row: s })}>
            编辑
          </a>
        ) : null,
        <a key="stats" data-act="stats" onClick={() => openStats('report', s.id, s.title || s.reportName || `报表 #${s.targetId}`)}>
          统计
        </a>,
        canWrite ? (
          <a key="del" style={{ color: PALETTE.red }} onClick={() => handleDelete(s)}>
            删除
          </a>
        ) : null,
      ],
    },
  ];

  /* ══════════ V13 B3：AI 问数分享（第二种分享来源） ══════════ */

  const aiFiltered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return aiList.filter((s) => {
      if (statusFilter === 'active' && (Number(s.status) !== 1 || isAiExpired(s))) return false;
      if (statusFilter === 'disabled' && Number(s.status) === 1) return false;
      if (statusFilter === 'expired' && !isAiExpired(s)) return false;
      if (!kw) return true;
      return [s.title, s.token]
        .filter((v) => v !== undefined && v !== null)
        .some((v) => String(v).toLowerCase().includes(kw));
    });
  }, [aiList, keyword, statusFilter]);

  const aiStatusTag = (s: AiShareItem) => {
    if (Number(s.status) !== 1) return <Tag color={PALETTE.gray}>已停用</Tag>;
    if (isAiExpired(s)) return <Tag color={PALETTE.red}>已过期</Tag>;
    return <Tag color={PALETTE.green}>生效中</Tag>;
  };

  const copyAiLink = async (s: AiShareItem) => {
    const url = s.url || aiShareUrl(s.token);
    const ok = await copyText(url);
    if (ok) message.success('链接已复制到剪贴板');
    else message.warning('复制失败，请手动选择链接复制');
  };

  const handleAiToggle = async (s: AiShareItem, checked: boolean) => {
    try {
      const next = await setAiShareStatus(s.id, checked ? 1 : 0);
      setAiList((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: next ? next.status : (checked ? 1 : 0) } : x)));
      message.success(checked ? '分享已启用' : '分享已停用');
    } catch {
      /* client 已提示 */
    }
  };

  const handleAiDelete = (s: AiShareItem) => {
    modal.confirm({
      title: '删除该 AI 问数分享？',
      content: '删除后原链接立即失效，且不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await removeAiShare(s.id);
        message.success('分享已删除');
        setAiList((prev) => prev.filter((x) => x.id !== s.id));
      },
    });
  };

  const aiColumns: ProColumns<AiShareItem>[] = [
    {
      title: '分享标题',
      dataIndex: 'title',
      sorter: (a, b) => String(a.title || '').localeCompare(String(b.title || '')),
      render: (_, s) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5, color: NEUTRAL.text, wordBreak: 'break-all' }}>
            {s.title || `AI 分享 #${s.id}`}
          </div>
          <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary }}>
            数据范围 {Array.isArray(s.scope) ? s.scope.length : 0} 项
          </div>
        </div>
      ),
    },
    {
      title: '分享链接',
      dataIndex: 'token',
      width: 240,
      render: (_, s) => (
        <Space size={6}>
          <Text code style={{ fontSize: 11.5 }}>
            /a/{s.token.slice(0, 10)}…
          </Text>
          <Tooltip title="复制完整链接">
            <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => copyAiLink(s)} />
          </Tooltip>
        </Space>
      ),
    },
    { title: '状态', dataIndex: 'status', width: 90, render: (_, s) => aiStatusTag(s) },
    {
      title: '保护',
      dataIndex: 'hasPassword',
      width: 80,
      align: 'center',
      render: (_, s) => (s.hasPassword ? (
        <Tooltip title="需要访问密码">
          <LockOutlined style={{ color: PALETTE.yellow }} />
        </Tooltip>
      ) : (
        <span style={{ color: NEUTRAL.textQuaternary }}>—</span>
      )),
    },
    {
      title: '有效期至',
      dataIndex: 'expiresAt',
      width: 150,
      render: (_, s) => (
        <span style={{ fontSize: 12, color: isAiExpired(s) ? PALETTE.red : NEUTRAL.textSecondary }}>
          {s.expiresAt ? fmtTime(s.expiresAt, 'YYYY-MM-DD HH:mm') : '永久有效'}
        </span>
      ),
    },
    { title: '访问', dataIndex: 'viewCount', width: 80, align: 'right', render: (_, s) => fmtNum(s.viewCount || 0) },
    { title: '问数', dataIndex: 'askCount', width: 80, align: 'right', render: (_, s) => fmtNum(s.askCount || 0) },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 130,
      render: (_, s) => (
        <Tooltip title={s.createdAt ? fmtTime(s.createdAt) : '-'}>
          <span style={{ fontSize: 12, color: NEUTRAL.textSecondary }}>{s.createdAt ? fmtAgo(s.createdAt) : '-'}</span>
        </Tooltip>
      ),
    },
    {
      title: '启用',
      dataIndex: 'enable',
      width: 75,
      align: 'center',
      render: (_, s) => (
        <Switch size="small" checked={Number(s.status) === 1} disabled={!canWrite} onChange={(v) => handleAiToggle(s, v)} />
      ),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 210,
      fixed: 'right',
      render: (_, s) => [
        <a key="open" onClick={() => window.open(s.url || aiShareUrl(s.token), '_blank')}>
          打开
        </a>,
        <a key="copy" onClick={() => copyAiLink(s)}>
          复制
        </a>,
        canWrite ? (
          <a key="edit" data-act="edit" onClick={() => openEdit({ kind: 'ai', row: s })}>
            编辑
          </a>
        ) : null,
        <a key="stats" data-act="stats" onClick={() => openStats('ai', s.id, s.title || `AI 分享 #${s.id}`)}>
          统计
        </a>,
        canWrite ? (
          <a key="del" style={{ color: PALETTE.red }} onClick={() => handleAiDelete(s)}>
            删除
          </a>
        ) : null,
      ],
    },
  ];

  const renderAiCard = (s: AiShareItem) => (
    <Card
      key={s.id}
      style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12 }}
      styles={{ body: { padding: 14 } }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: NEUTRAL.text, wordBreak: 'break-all' }}>
            {s.title || `AI 分享 #${s.id}`}
          </div>
          <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary, marginTop: 2 }}>
            {s.createdAt ? `${fmtTime(s.createdAt, 'YYYY-MM-DD HH:mm')} 创建` : '—'}
          </div>
        </div>
        {aiStatusTag(s)}
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: NEUTRAL.textSecondary }}>
        <span><EyeOutlined /> {fmtNum(s.viewCount || 0)} 次访问</span>
        <span>问数 {fmtNum(s.askCount || 0)} 次</span>
        <span>{s.expiresAt ? `至 ${fmtTime(s.expiresAt, 'YYYY-MM-DD')}` : '永久有效'}</span>
        {s.hasPassword && <span style={{ color: PALETTE.yellow }}><LockOutlined /> 有密码</span>}
      </div>
      <div style={{ marginTop: 10, padding: '6px 8px', background: NEUTRAL.surfaceSunken, borderRadius: 6, fontSize: 11.5, color: NEUTRAL.textSecondary, wordBreak: 'break-all' }}>
        {s.url || aiShareUrl(s.token)}
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button size="middle" icon={<CopyOutlined />} onClick={() => copyAiLink(s)} style={{ minHeight: 44 }}>复制</Button>
        <Button size="middle" icon={<LinkOutlined />} onClick={() => window.open(s.url || aiShareUrl(s.token), '_blank')} style={{ minHeight: 44 }}>打开</Button>
        <Button
          size="middle"
          data-act="edit"
          icon={<EditOutlined />}
          onClick={() => openEdit({ kind: 'ai', row: s })}
          style={{ minHeight: 44 }}
        >
          编辑
        </Button>
        <Button
          size="middle"
          data-act="stats"
          icon={<BarChartOutlined />}
          onClick={() => openStats('ai', s.id, s.title || `AI 分享 #${s.id}`)}
          style={{ minHeight: 44 }}
        >
          统计
        </Button>
        {canWrite && (
          <>
            <Button size="middle" onClick={() => handleAiToggle(s, Number(s.status) !== 1)} style={{ minHeight: 44 }}>
              {Number(s.status) === 1 ? '停用' : '启用'}
            </Button>
            <Button danger size="middle" icon={<DeleteOutlined />} onClick={() => handleAiDelete(s)} style={{ minHeight: 44 }}>删除</Button>
          </>
        )}
      </div>
    </Card>
  );

  /** 当前 Tab 的运行态（空态文案 / 加载 / 错误都跟着 Tab 走） */
  const isAiTab = tab === 'ai';
  const currentLoading = isAiTab ? aiLoading : loading;
  const currentError = isAiTab ? aiError : loadError;

  const renderCard = (s: ShareItem) => (
    <Card
      key={s.id}
      style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12 }}
      styles={{ body: { padding: 14 } }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: NEUTRAL.text, wordBreak: 'break-all' }}>
            {s.title || s.reportName || `报表 #${s.targetId}`}
          </div>
          <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary, marginTop: 2 }}>{fmtTime(s.createdAt, 'YYYY-MM-DD HH:mm')} 创建</div>
        </div>
        {statusTag(s)}
      </div>

      <div
        style={{
          marginTop: 10,
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
          fontSize: 12,
          color: NEUTRAL.textSecondary,
        }}
      >
        <span>
          <EyeOutlined /> {fmtNum(s.viewCount || 0)} 次访问
        </span>
        <span>{s.expiresAt ? `至 ${fmtTime(s.expiresAt, 'YYYY-MM-DD')}` : '永久有效'}</span>
        {s.hasPassword && (
          <span style={{ color: PALETTE.yellow }}>
            <LockOutlined /> 有密码
          </span>
        )}
      </div>

      <div
        style={{
          marginTop: 10,
          padding: '6px 8px',
          background: NEUTRAL.surfaceSunken,
          borderRadius: 6,
          fontSize: 11.5,
          color: NEUTRAL.textSecondary,
          wordBreak: 'break-all',
        }}
      >
        /s/{s.token}
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button size="middle" icon={<CopyOutlined />} onClick={() => copyLink(s)} style={{ minHeight: 44 }}>
          复制
        </Button>
        <Button size="middle" icon={<LinkOutlined />} onClick={() => window.open(shareUrlOf(s), '_blank')} style={{ minHeight: 44 }}>
          打开
        </Button>
        <Button
          size="middle"
          data-act="edit"
          icon={<EditOutlined />}
          onClick={() => openEdit({ kind: 'report', row: s })}
          style={{ minHeight: 44 }}
        >
          编辑
        </Button>
        <Button
          size="middle"
          data-act="stats"
          icon={<BarChartOutlined />}
          onClick={() => openStats('report', s.id, s.title || s.reportName || `报表 #${s.targetId}`)}
          style={{ minHeight: 44 }}
        >
          统计
        </Button>
        {canWrite && (
          <>
            <Button
              size="middle"
              onClick={() => handleToggle(s, Number(s.status) !== 1)}
              style={{ minHeight: 44 }}
            >
              {Number(s.status) === 1 ? '停用' : '启用'}
            </Button>
            <Button danger size="middle" icon={<DeleteOutlined />} onClick={() => handleDelete(s)} style={{ minHeight: 44 }}>
              删除
            </Button>
          </>
        )}
      </div>
    </Card>
  );

  return (
    <Page
      title="分享中心"
      search={
        <>
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: isMobile ? 120 : 140 }}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'active', label: '生效中' },
              { value: 'disabled', label: '已停用' },
              { value: 'expired', label: '已过期' },
            ]}
          />
          <Input.Search
            allowClear
            placeholder="搜索标题 / 名称 / token"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={(v) => setKeyword(v)}
            style={{ width: isMobile ? 190 : 250 }}
          />
        </>
      }
      actions={
        /* 只有「报表分享」支持在本页创建（AI 问数分享需选数据范围，在 AI 问数页发起更合理）。
           切到「AI 问数分享」时给出去 AI 问数页的入口，而不是留一个点了没反应的按钮。 */
        isAiTab ? (
          <Button icon={<ShareAltOutlined />} onClick={() => navigate('/ai')}>
            去 AI 问数创建
          </Button>
        ) : canWrite ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>
            创建分享
          </Button>
        ) : undefined
      }
      stats={statItems}
      subTabs={
        <PageTabs
          activeKey={tab}
          onChange={onTabChange}
          items={[
            { key: 'report', label: pageTabLabel(<ShareAltOutlined />, '报表分享', list.length ? <PageTabTag color={PALETTE.primary}>{list.length}</PageTabTag> : undefined) },
            { key: 'ai', label: pageTabLabel(<ShareAltOutlined />, 'AI 问数分享', aiList.length ? <PageTabTag color={PALETTE.primary}>{aiList.length}</PageTabTag> : undefined) },
          ]}
        />
      }
    >
      {currentError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          title={isAiTab ? '加载 AI 问数分享失败' : '加载分享列表失败'}
          description={currentError}
          action={
            <Button size="small" onClick={isAiTab ? loadAi : load}>
              重试
            </Button>
          }
        />
      )}

      {isAiTab ? (
        currentLoading ? (
          <div style={{ padding: 60, textAlign: 'center' }}>
            <Spin size="large" />
          </div>
        ) : aiFiltered.length === 0 ? (
          <Card style={{ border: `1px dashed ${NEUTRAL.border}`, borderRadius: 12 }}>
            <Empty description={keyword || statusFilter !== 'all' ? '没有符合条件的 AI 问数分享' : '还没有 AI 问数分享，请到「AI 问数」页选择数据范围后创建'}>
              <Button type="primary" icon={<ShareAltOutlined />} onClick={() => navigate('/ai')}>去 AI 问数</Button>
            </Empty>
          </Card>
        ) : isMobile ? (
          <Row gutter={[10, 10]}>
            {aiFiltered.map((s) => (
              <Col xs={24} key={s.id}>
                {renderAiCard(s)}
              </Col>
            ))}
          </Row>
        ) : (
          <Card styles={{ body: { padding: 0 } }} style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <ProTable<AiShareItem>
              rowKey="id"
              columns={aiColumns}
              dataSource={aiFiltered}
              search={false}
              options={{ reload: false, density: false, setting: false }}
              toolBarRender={false}
              scroll={{ x: 'max-content' }}
              pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 个 AI 问数分享` }}
            />
          </Card>
        )
      ) : (
      <>
      {loading ? (
        <div style={{ padding: 60, textAlign: 'center' }}>
          <Spin size="large" />
        </div>
      ) : filtered.length === 0 ? (
        <Card style={{ border: `1px dashed ${NEUTRAL.border}`, borderRadius: 12 }}>
          <Empty description={keyword || statusFilter !== 'all' ? '没有符合条件的分享' : '还没有创建分享链接'}>
            {canWrite && <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>创建第一个分享</Button>}
          </Empty>
        </Card>
      ) : isMobile ? (
        <Row gutter={[10, 10]}>
          {filtered.map((s) => (
            <Col xs={24} key={s.id}>
              {renderCard(s)}
            </Col>
          ))}
        </Row>
      ) : (
        <Card styles={{ body: { padding: 0 } }} style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <ProTable<ShareItem>
            rowKey="id"
            columns={columns}
            dataSource={filtered}
            search={false}
            options={{ reload: false, density: false, setting: false }}
            toolBarRender={false}
            scroll={{ x: 'max-content' }}
            pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 个分享` }}
          />
        </Card>
      )}
      </>
      )}


      {/* ══════════ V16 编辑分享（需求 2.0~2.4 / 2.7：两个 Tab 共用） ══════════ */}
      <Modal
        title="编辑分享"
        open={editOpen}
        onCancel={() => {
          setEditOpen(false);
          setEditTarget(null);
        }}
        onOk={submitEdit}
        okText="保存"
        confirmLoading={editSaving}
        cancelText="取消"
        width={isMobile ? '94vw' : 520}
        destroyOnHidden
        forceRender
      >
        <Form form={editForm} layout="vertical" requiredMark={false} style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: NEUTRAL.textTertiary, marginBottom: 10 }}>
            {editTarget?.kind === 'ai' ? 'AI 问数分享' : '报表分享'} ·{' '}
            <Text code style={{ fontSize: 11.5 }}>
              {(editTarget?.kind === 'ai'
                ? (editTarget?.row as AiShareItem | undefined)?.token
                : (editTarget?.row as ShareItem | undefined)?.token)?.slice(0, 10)}
              …
            </Text>
          </div>

          {/* 需求 2.0 / 2.1：分享标题 */}
          <Form.Item name="title" label="分享标题" extra="对外展示的页面标题，留空则回落到默认名称；会显示为浏览器标签栏标题" data-field="titleWrap">
            <Input size="large" maxLength={60} placeholder="对外展示的标题" data-field="title" />
          </Form.Item>

          {/* V16.1 需求 3：分享描述 + 分享缩略图（链接预览 / 浏览器标题栏配套） */}
          <Form.Item
            name="description"
            label="分享描述"
            extra="分享出去时显示的简介（og:description），留空则不展示"
            data-field="descriptionWrap"
          >
            <Input.TextArea
              rows={2}
              maxLength={200}
              showCount
              placeholder="一句话说明这个分享的内容"
              data-field="description"
            />
          </Form.Item>
          <Form.Item
            name="thumb"
            label="分享缩略图"
            extra="图片地址：http(s):// 开头的外链，或以 / 开头的站内路径。留空则不展示缩略图"
            data-field="thumbWrap"
          >
            <Input size="large" maxLength={500} placeholder="https://…/cover.png 或 /public/cover.png" data-field="thumb" />
          </Form.Item>

          {/* 需求 2.2：有效期 */}
          <Form.Item label="有效期" style={{ marginBottom: 8 }}>
            <Radio.Group
              value={expireMode}
              onChange={(e) => setExpireMode(e.target.value)}
              optionType="button"
              buttonStyle="solid"
              data-field="expireMode"
              options={[
                { label: '永久有效', value: 'permanent' },
                { label: '按天数', value: 'days' },
                { label: '自定义时间', value: 'custom' },
              ]}
            />
          </Form.Item>
          {expireMode === 'days' && (
            <Form.Item name="expiresDays" label="有效天数" extra="从保存时刻起算，0 = 永久有效">
              <Select
                size="large"
                allowClear
                placeholder="选择天数"
                data-field="expiresDays"
                options={EXPIRE_OPTIONS}
              />
            </Form.Item>
          )}
          {expireMode === 'custom' && (
            <Form.Item name="expiresAt" label="到期时间">
              <DatePicker
                size="large"
                showTime
                style={{ width: '100%' }}
                format="YYYY-MM-DD HH:mm"
                data-field="expiresAt"
              />
            </Form.Item>
          )}

          {/* 需求 2.3 / 2.4：访问密码开关 + 修改密码 */}
          <Form.Item label="访问密码" style={{ marginBottom: 8 }}>
            <Space size={10} align="center">
              <Switch
                checked={pwdOn}
                onChange={(v) => {
                  setPwdOn(v);
                  if (!v) editForm.setFieldsValue({ password: '' });
                }}
                data-field="passwordOn"
              />
              <span style={{ fontSize: 12.5, color: NEUTRAL.textSecondary }}>
                {pwdOn ? '已开启：访问者需输入密码' : '已关闭：任何人凭链接即可访问'}
              </span>
            </Space>
          </Form.Item>
          {pwdOn && (
            <Form.Item
              name="password"
              label="新访问密码"
              extra="留空表示保留原有密码；填写则立即替换（最多 64 个字符）"
              rules={[{ max: 64, message: '访问密码不能超过 64 个字符' }]}
            >
              <Input.Password
                size="large"
                maxLength={64}
                placeholder="输入新密码，留空则保持不变"
                autoComplete="new-password"
                data-field="password"
              />
            </Form.Item>
          )}

          <div style={{ fontSize: 12, color: NEUTRAL.textTertiary }}>
            保存后立即生效；已分发出去的链接会沿用新设置。
          </div>
        </Form>
      </Modal>

      {/* ══════════ V16 访问统计（需求 2.5 十项汇总 + 2.6 明细） ══════════ */}
      <Drawer
        title="访问统计"
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        width={isMobile ? '100vw' : 880}
        destroyOnHidden
        styles={{ body: { padding: 14 } }}
      >
        <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: NEUTRAL.text, wordBreak: 'break-all' }}>
            {statsTarget?.title || '—'}
          </span>
          <Tag bordered={false} color={PALETTE.primary} style={{ color: NEUTRAL.textInverse }}>
            {statsTarget?.kind === 'ai' ? 'AI 问数分享' : '报表分享'}
          </Tag>
          <Select
            size="small"
            value={statsDays}
            style={{ width: 110 }}
            data-field="statsDays"
            onChange={(v) => {
              setStatsDays(v);
              if (statsTarget) loadStats(statsTarget.kind, statsTarget.id, v);
            }}
            options={[
              { value: 7, label: '近 7 天' },
              { value: 30, label: '近 30 天' },
              { value: 90, label: '近 90 天' },
            ]}
          />
        </div>

        {statsError && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            title="加载访问统计失败"
            description={statsError}
            action={
              statsTarget ? (
                <Button size="small" onClick={() => loadStats(statsTarget.kind, statsTarget.id, statsDays)}>
                  重试
                </Button>
              ) : null
            }
          />
        )}

        {statsLoading ? (
          <div style={{ padding: 60, textAlign: 'center' }}>
            <Spin size="large" />
          </div>
        ) : stats ? (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              title="统计口径：埋点与日志分开统计，不相加"
              description={
                <span style={{ fontSize: 12 }}>
                  {stats.summary.statsSince || '应用埋点上线起统计；历史回填见 nginx 日志口径。'}
                </span>
              }
            />

            {/* 2.5：两套来源各自 10 项指标，分开显示 */}
            <StatSourceBlock
              title={stats.bySource.beacon?.label || '应用埋点（V16 上线起）'}
              data={stats.bySource.beacon}
              provinceStatus={stats.summary.provinceStatus}
              provinceNote={stats.summary.provinceNote}
            />
            <StatSourceBlock
              title={stats.bySource.nginx?.label || 'nginx 日志回填'}
              data={stats.bySource.nginx}
              provinceStatus={stats.summary.provinceStatus}
              provinceNote={stats.summary.provinceNote}
            />

            {/* 2.6：明细 */}
            <Card
              size="small"
              title={<span style={{ fontSize: 13 }}>访问明细（共 {fmtNum(stats.rowCount)} 条）</span>}
              style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 10 }}
              styles={{ body: { padding: 0 } }}
            >
              <Table<ShareVisitRow>
                size="small"
                rowKey="id"
                dataSource={stats.rows}
                scroll={{ x: 'max-content' }}
                pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (t) => `共 ${t} 条` }}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该时间段内暂无访问记录" /> }}
                columns={[
                  {
                    title: '时间',
                    dataIndex: 'createdAt',
                    width: 150,
                    render: (v: string) => (
                      <span style={{ fontSize: 12 }}>{v ? fmtTime(v, 'YYYY-MM-DD HH:mm') : '—'}</span>
                    ),
                  },
                  { title: '访客IP', dataIndex: 'ip', width: 130, render: (v: string) => <Text code style={{ fontSize: 11.5 }}>{v || '—'}</Text> },
                  { title: '浏览器类型', dataIndex: 'browser', width: 110, render: (v: string) => v || '—' },
                  { title: '操作系统类型', dataIndex: 'os', width: 110, render: (v: string) => v || '—' },
                  { title: '设备类型', dataIndex: 'device', width: 100, render: (v: string) => v || '—' },
                  {
                    title: '省份',
                    dataIndex: 'province',
                    width: 170,
                    render: (v: string | null) =>
                      stats.summary.provinceStatus === 'pending'
                        ? <span style={{ fontSize: 12, color: NEUTRAL.textTertiary }}>暂无数据（待接入省份库）</span>
                        : (v || '—'),
                  },
                  {
                    title: '来源',
                    dataIndex: 'source',
                    width: 110,
                    render: (v: string) => (
                      <Tag bordered={false} color={v === 'nginx' ? PALETTE.yellow : PALETTE.primary} style={v === 'nginx' ? undefined : { color: NEUTRAL.textInverse }}>
                        {STAT_SOURCE_LABEL[v] || v || '—'}
                      </Tag>
                    ),
                  },
                  {
                    title: '访问路径',
                    dataIndex: 'path',
                    width: 200,
                    render: (v: string) => (
                      <span style={{ fontSize: 11.5, color: NEUTRAL.textSecondary, wordBreak: 'break-all' }}>{v || '—'}</span>
                    ),
                  },
                ]}
              />
            </Card>
          </>
        ) : null}
      </Drawer>

      {/* 创建分享 */}
      <Modal
        title={created ? '分享链接已创建' : '创建分享'}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        footer={
          created ? (
            <Space>
              <Button onClick={() => setCreateOpen(false)}>关闭</Button>
              <Button type="primary" icon={<CopyOutlined />} onClick={() => copyLink(created)}>
                复制链接
              </Button>
            </Space>
          ) : (
            <Space>
              <Button onClick={() => setCreateOpen(false)}>取消</Button>
              <Button type="primary" loading={creating} onClick={submit} icon={<ShareAltOutlined />}>
                创建分享
              </Button>
            </Space>
          )
        }
        width={isMobile ? '92vw' : 540}
        destroyOnHidden
      >
        {created ? (
          <Result
            status="success"
            title="创建成功"
            subTitle={
              <div style={{ marginTop: 8 }}>
                <Paragraph copyable={{ text: shareUrlOf(created) }} style={{ marginBottom: 6, wordBreak: 'break-all', fontSize: 12.5 }}>
                  {shareUrlOf(created)}
                </Paragraph>
                <Space size={6} wrap>
                  <Tag bordered={false} color={PALETTE.primary} style={{ color: NEUTRAL.textInverse }}>
                    {created.expiresAt ? `有效期至 ${fmtTime(created.expiresAt, 'YYYY-MM-DD')}` : '永久有效'}
                  </Tag>
                  {created.hasPassword && <Tag color={PALETTE.yellow}>需要访问密码</Tag>}
                  {created.allowExport && <Tag color={PALETTE.green}>允许导出</Tag>}
                </Space>
              </div>
            }
            extra={[
              <Button key="open" icon={<LinkOutlined />} onClick={() => window.open(shareUrlOf(created), '_blank')}>
                打开预览
              </Button>,
              <Button key="copy" type="primary" icon={<CopyOutlined />} onClick={() => copyLink(created)}>
                复制链接
              </Button>,
            ]}
          />
        ) : (
          <Form form={form} layout="vertical" requiredMark={false} style={{ marginTop: 12 }}>
            <Form.Item name="targetId" label="分享对象（报表）" rules={[{ required: true, message: '请选择要分享的报表' }]}>
              <Select
                size="large"
                showSearch
                optionFilterProp="label"
                placeholder="选择报表"
                options={reports.map((r) => ({ value: r.id, label: `${r.name}${r.category ? `（${r.category}）` : ''}` }))}
                notFoundContent={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无报表" />}
              />
            </Form.Item>
            <Form.Item name="title" label="分享标题" extra="留空则使用报表名称">
              <Input size="large" maxLength={60} placeholder="对外展示的标题" />
            </Form.Item>
            {/* V16.1 需求 3：创建时也可直接设置描述与缩略图 */}
            <Form.Item name="description" label="分享描述" extra="留空则不展示（可稍后在「编辑分享」里补）">
              <Input.TextArea rows={2} maxLength={200} showCount placeholder="一句话说明这个分享的内容" />
            </Form.Item>
            <Form.Item name="thumb" label="分享缩略图" extra="http(s):// 图片地址，或以 / 开头的站内路径；留空则不展示">
              <Input size="large" maxLength={500} placeholder="https://…/cover.png" />
            </Form.Item>
            <Form.Item name="expiresDays" label="有效期">
              <Select
                size="large"
                allowClear
                placeholder="永久有效"
                options={EXPIRE_OPTIONS}
              />
            </Form.Item>
            <Form.Item name="password" label="访问密码" extra="设置后访问者需先输入密码（可选）">
              <Input.Password size="large" maxLength={32} placeholder="留空表示无密码" autoComplete="new-password" />
            </Form.Item>
            <Form.Item name="allowExport" label="允许导出" valuePropName="checked">
              <Switch />
            </Form.Item>
            <div style={{ fontSize: 12, color: NEUTRAL.textTertiary }}>
              提示：分享链接格式为 <Text code>/s/&lt;token&gt;</Text>，可在分享管理中随时停用或删除。
            </div>
          </Form>
        )}
      </Modal>
    </Page>
  );
}
