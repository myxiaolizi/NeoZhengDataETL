/**
 * 报表中心（V7.1 统一规范）
 * - Page 标准结构：title="报表中心" + search + actions(新建报表) + subTabs(类型子标签) + stats(5个数据卡片) + 列表/卡片
 * - 系统内置看板（客户签约看板等预置报表，直接查看、不参与增删改）
 * - 卡片视图 / 表格视图（ProTable）切换
 * - V7.1 需求 L：分享按钮迁入报表中心 + 分享弹窗（标题 / 密码 / 有效期 / 链接复制 / 已有分享管理）
 *   · 弹窗渲染在 portal 里，取不到看板 `.board-root` 的 CSS 变量
 *     → 本文件所有弹窗内容使用 @/theme 的字面色值（NEUTRAL / PALETTE），禁止 var(--x)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Badge,
  Button,
  Card,
  Col,
  Divider,
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
  Switch,
  Tabs,
  Tag,
  Tooltip,
} from 'antd';
import {
  BarChartOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FundOutlined,
  LinkOutlined,
  LockOutlined,
  PlusOutlined,
  ReloadOutlined,
  ShareAltOutlined,
  StopOutlined,
  TableOutlined,
  AppstoreOutlined,
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
  createReport,
  createShare,
  deleteReport,
  deleteShare,
  listDatasets,
  listReports,
  listShares,
  shareUrlOf,
  toggleShare,
  updateReport,
  type DatasetItem,
  type ReportItem,
  type ShareItem,
} from '@/api/reports';

const { useBreakpoint } = Grid;

const TYPE_META: Record<string, { label: string; color: string }> = {
  chart: { label: '图表', color: PALETTE.primary },
  table: { label: '表格', color: PALETTE.cyan },
  dashboard: { label: '看板', color: PALETTE.green },
};

function typeMeta(t: string) {
  return TYPE_META[t] || { label: t || '图表', color: PALETTE.gray };
}

/** 系统内置看板条目 */
interface BuiltinBoard {
  key: string;
  name: string;
  desc: string;
  path: string;
  color: string;
  tags: string[];
  /**
   * 分享用的 board 占位 ID（这些看板不在 jdywh_reports 表里）
   * 后端约定：1 = 中康智能体客户看板（boardKey 'zk'），2 = 客户签约看板（boardKey 'crm'）
   * 见 src/reports.js accessShare()：`Number(row.target_id) === 1 ? 'zk' : 'crm'`
   */
  shareTargetId: number;
}

/**
 * 系统内置看板：由后端实时聚合、无需配置的预置报表。
 * 它们不属于「我的报表」，因此在报表中心单独成区块，点击直接进入看板页。
 */
const BUILTIN_BOARDS: BuiltinBoard[] = [
  {
    key: 'crm',
    name: '客户签约看板',
    desc: '从客户签约项目实时聚合：签约总数、门店覆盖、区域 / 类型分布、销售排行与签约明细。',
    path: '/dashboard/crm',
    color: PALETTE.primary,
    tags: ['看板', 'CRM'],
    shareTargetId: 2,
  },
  {
    key: 'zk',
    name: '中康智能体客户看板',
    desc: '签约概览、流程状态分布、类型汇总与排行、签约趋势、客户运行情况与客户明细，共 9 个板块实时聚合。',
    path: '/dashboard/board',
    color: PALETTE.green,
    tags: ['看板', 'CRM', '流程'],
    shareTargetId: 1,
  },
];

/* ══════════════════════════════════════════════════════════════
 * V7.1 需求 L：分享弹窗
 *
 * 支持两类分享目标：
 *   - report：普通报表（targetType: 'report', targetId: 报表 id）
 *   - board ：系统内置看板（targetType: 'board',  targetId: 1=zk / 2=crm）
 *
 * 注意：Modal 渲染在 document.body 的 portal 里，**不继承看板的 .board-root CSS 变量**，
 * 因此这里所有颜色都取 @/theme 的字面色值（NEUTRAL / PALETTE），不用 var(--x)，
 * 避免出现「白底白字」。
 * ══════════════════════════════════════════════════════════════ */

/** 分享目标 */
export interface ShareTarget {
  kind: 'report' | 'board';
  id: number;
  name: string;
  /** 展示用副标题（如报表编码 / 内置看板路径） */
  hint?: string;
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

/** 已创建分享的展示结果（密码只来自本次输入，不回显服务端密文） */
interface ShareResult {
  url: string;
  title: string;
  password: string;
  expiresLabel: string;
}

interface ShareModalProps {
  open: boolean;
  target: ShareTarget | null;
  isMobile: boolean;
  /** 是否有 share:write 权限（只有 share:read 时展示链接设置但不能创建） */
  canCreate: boolean;
  onClose: () => void;
  /** 新建成功后通知父级刷新分享数 */
  onCreated?: (target: ShareTarget) => void;
}

function ShareModal({ open, target, isMobile, canCreate, onClose, onCreated }: ShareModalProps) {
  const { message } = AntApp.useApp();

  const [title, setTitle] = useState('');
  const [password, setPassword] = useState('');
  const [expiresDays, setExpiresDays] = useState<number>(7);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ShareResult | null>(null);

  const [shares, setShares] = useState<ShareItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  const kindLabel = target?.kind === 'board' ? '内置看板' : '报表';

  /** 拉取该目标已有的分享（GET /shares 返回全量，按 targetType + targetId 过滤） */
  const loadShares = useCallback(
    async (silent = false) => {
      if (!target) return;
      if (!silent) setListLoading(true);
      setListError('');
      try {
        const all = await listShares();
        const mine = (Array.isArray(all) ? all : []).filter(
          (s) => s.targetType === target.kind && Number(s.targetId) === Number(target.id)
        );
        setShares(mine);
      } catch (e) {
        // 列表权限是 share:write，只有 share:read 的账号会 403 → 静默降级，不影响新建分享
        setShares([]);
        setListError(e instanceof Error ? e.message : '已有分享加载失败');
      } finally {
        if (!silent) setListLoading(false);
      }
    },
    [target]
  );

  /* 每次打开（或切换目标）重置表单并加载已有分享 */
  useEffect(() => {
    if (!open || !target) return;
    setTitle(target.name);
    setPassword('');
    setExpiresDays(7);
    setResult(null);
    setShares([]);
    loadShares();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.kind, target?.id]);

  const expiresLabelOf = (d: number) => (d === 0 ? '永久有效' : `${d} 天有效`);

  const submit = async () => {
    if (!target) return;
    const t = title.trim() || target.name;
    setSubmitting(true);
    try {
      const share = await createShare({
        targetType: target.kind,
        targetId: target.id,
        title: t,
        password: password.trim() || undefined,
        expiresDays: expiresDays > 0 ? expiresDays : undefined,
      });
      const url = shareUrlOf(share);
      setResult({ url, title: t, password: password.trim(), expiresLabel: expiresLabelOf(expiresDays) });
      message.success('分享链接已创建');
      onCreated?.(target);
      loadShares(true);
    } catch {
      /* client 已提示（如「系统已关闭公开分享功能」） */
    } finally {
      setSubmitting(false);
    }
  };

  const copyOnly = async () => {
    if (!result) return;
    const ok = await copyText(result.url);
    message[ok ? 'success' : 'warning'](ok ? '分享链接已复制' : '复制失败，请手动选择链接复制');
  };

  /** 链接 + 密码一起复制（访问页支持 ?pwd= 直达） */
  const copyWithPwd = async () => {
    if (!result) return;
    const link = result.password
      ? `${result.url}${result.url.includes('?') ? '&' : '?'}pwd=${encodeURIComponent(result.password)}`
      : result.url;
    const text = result.password ? `链接：${link}\n密码：${result.password}` : `链接：${link}`;
    const ok = await copyText(text);
    message[ok ? 'success' : 'warning'](ok ? (result.password ? '链接与密码已复制' : '分享链接已复制') : '复制失败，请手动选择复制');
  };

  const handleToggle = async (s: ShareItem, enabled: boolean) => {
    try {
      await toggleShare(s.id, enabled ? 1 : 0);
      message.success(enabled ? '分享已启用' : '分享已停用');
      loadShares(true);
    } catch {
      /* client 已提示 */
    }
  };

  const handleDelete = async (s: ShareItem) => {
    try {
      await deleteShare(s.id);
      message.success('分享已删除');
      loadShares(true);
    } catch {
      /* client 已提示 */
    }
  };

  return (
    <Modal
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: NEUTRAL.text, fontSize: 16, fontWeight: 700 }}>
          <ShareAltOutlined style={{ color: PALETTE.primary }} />
          分享{kindLabel}
        </span>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={isMobile ? '94vw' : 560}
      destroyOnHidden
      styles={{
        body: { paddingTop: 6, color: NEUTRAL.text },
        header: { borderBottom: `1px solid ${NEUTRAL.borderSubtle}`, paddingBottom: 12 },
      }}
    >
      {!target ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, color: NEUTRAL.text }}>
          {/* 目标对象 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 10,
              background: NEUTRAL.surfaceAlt,
              border: `1px solid ${NEUTRAL.border}`,
              minWidth: 0,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                flex: '0 0 32px',
                borderRadius: 9,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: NEUTRAL.textInverse,
                background: `linear-gradient(135deg, ${target.kind === 'board' ? PALETTE.green : PALETTE.primary}, ${SIDER.bgTo})`,
                fontSize: 15,
              }}
            >
              {target.kind === 'board' ? <FundOutlined /> : <BarChartOutlined />}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 13.5,
                  color: NEUTRAL.text,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {target.name}
              </div>
              <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {target.hint || (target.kind === 'board' ? `系统内置看板 · board#${target.id}` : `报表 · #${target.id}`)}
              </div>
            </div>
            <Tag bordered={false} style={{ marginInlineEnd: 0, background: NEUTRAL.surfaceSunken, color: PALETTE.primary }}>
              {kindLabel}
            </Tag>
          </div>

          {/* 分享标题 */}
          <div>
            <FieldLabel>分享标题</FieldLabel>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={target.name}
              maxLength={60}
              size={isMobile ? 'large' : 'middle'}
            />
          </div>

          {/* 访问密码 */}
          <div>
            <FieldLabel extra="留空表示无密码，任何人拿到链接即可查看">访问密码</FieldLabel>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Input.Password
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="留空则不设密码"
                  maxLength={32}
                  size={isMobile ? 'large' : 'middle'}
                  prefix={<LockOutlined style={{ color: NEUTRAL.textQuaternary }} />}
                />
              </div>
              <Button
                size={isMobile ? 'large' : 'middle'}
                icon={<ReloadOutlined />}
                onClick={() => setPassword(genPassword(6))}
                style={{ flexShrink: 0 }}
              >
                随机生成
              </Button>
            </div>
          </div>

          {/* 有效期 */}
          <div>
            <FieldLabel>有效期</FieldLabel>
            <Segmented
              block
              value={expiresDays}
              onChange={(v) => setExpiresDays(Number(v))}
              options={SHARE_EXPIRES.map((o) => ({ label: o.label, value: o.value }))}
            />
          </div>

          <Button
            type="primary"
            block
            icon={<LinkOutlined />}
            loading={submitting}
            disabled={!canCreate}
            onClick={submit}
            size={isMobile ? 'large' : 'middle'}
          >
            生成分享链接
          </Button>
          {!canCreate && (
            <div style={{ fontSize: 11.5, color: PALETTE.orange, marginTop: -6 }}>
              当前账号只有「查看分享」权限，无法创建新分享（需要 share:write）。
            </div>
          )}

          {/* 生成结果 */}
          {result && (
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                border: `1px solid ${PALETTE.primarySoft}`,
                background: '#F6FAFF',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <CheckCircleOutlined style={{ color: PALETTE.green }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: NEUTRAL.text }}>分享链接已生成</span>
                <Tag bordered={false} style={{ marginInlineEnd: 0, background: PALETTE.primarySoft, color: PALETTE.primaryDeep }}>
                  {result.expiresLabel}
                </Tag>
                {result.password ? (
                  <Tag bordered={false} color="orange" style={{ marginInlineEnd: 0 }}>
                    已加密
                  </Tag>
                ) : (
                  <Tag bordered={false} style={{ marginInlineEnd: 0, background: NEUTRAL.surfaceSunken, color: NEUTRAL.textSecondary }}>
                    无密码
                  </Tag>
                )}
              </div>

              <div
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: NEUTRAL.text,
                  background: NEUTRAL.surface,
                  border: `1px solid ${NEUTRAL.border}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  wordBreak: 'break-all',
                  maxHeight: 96,
                  overflowY: 'auto',
                }}
              >
                {result.url}
              </div>

              {result.password && (
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
                  <span style={{ color: NEUTRAL.textSecondary }}>访问密码：</span>
                  <span
                    style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                      fontWeight: 700,
                      letterSpacing: 1.5,
                      color: PALETTE.primaryDeep,
                      background: NEUTRAL.surfaceSunken,
                      border: `1px solid ${NEUTRAL.border}`,
                      borderRadius: 6,
                      padding: '2px 8px',
                    }}
                  >
                    {result.password}
                  </span>
                  <span style={{ fontSize: 11.5, color: NEUTRAL.textTertiary }}>仅本次显示，请立即复制</span>
                </div>
              )}

              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button type="primary" icon={<CopyOutlined />} onClick={copyWithPwd} size={isMobile ? 'middle' : 'small'}>
                  {result.password ? '复制链接+密码' : '复制链接'}
                </Button>
                <Button icon={<CopyOutlined />} onClick={copyOnly} size={isMobile ? 'middle' : 'small'}>
                  仅复制链接
                </Button>
                <Button
                  type="link"
                  onClick={() => window.open(result.url, '_blank', 'noopener')}
                  size={isMobile ? 'middle' : 'small'}
                >
                  打开链接
                </Button>
              </div>
            </div>
          )}

          {/* 已有分享 */}
          <div>
            <Divider style={{ margin: '2px 0 10px' }} />
            <FieldLabel
              extra={
                <Button
                  type="link"
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => loadShares()}
                  style={{ padding: 0, height: 'auto', fontSize: 11.5 }}
                >
                  刷新
                </Button>
              }
            >
              已有分享{shares.length ? `（${shares.length}）` : ''}
            </FieldLabel>

            {listLoading ? (
              <div style={{ padding: 16, textAlign: 'center' }}>
                <Spin size="small" />
              </div>
            ) : listError ? (
              <div
                style={{
                  fontSize: 12,
                  color: NEUTRAL.textTertiary,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: NEUTRAL.surfaceAlt,
                  border: `1px dashed ${NEUTRAL.border}`,
                }}
              >
                无法读取已有分享（{listError}）。仍可正常生成新链接。
              </div>
            ) : shares.length === 0 ? (
              <div
                style={{
                  fontSize: 12,
                  color: NEUTRAL.textTertiary,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: NEUTRAL.surfaceAlt,
                  border: `1px dashed ${NEUTRAL.border}`,
                }}
              >
                暂无分享记录，点击上方「生成分享链接」创建第一条。
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                {shares.map((s) => {
                  const active = Number(s.status) === 1;
                  return (
                    <div
                      key={s.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 10px',
                        borderRadius: 9,
                        border: `1px solid ${NEUTRAL.border}`,
                        background: active ? NEUTRAL.surface : NEUTRAL.surfaceAlt,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: NEUTRAL.text,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {s.title || target.name}
                        </div>
                        <div style={{ fontSize: 11, color: NEUTRAL.textTertiary, marginTop: 2 }}>
                          {s.hasPassword ? '有密码' : '无密码'} ·{' '}
                          {s.expiresAt ? `${fmtTime(s.expiresAt, 'MM-DD HH:mm')} 到期` : '永久有效'} · 浏览 {fmtNum(s.viewCount || 0)}
                        </div>
                      </div>
                      <Space size={4} wrap>
                        <Tag bordered={false} color={active ? 'green' : undefined} style={{ marginInlineEnd: 0 }}>
                          {active ? '启用中' : '已停用'}
                        </Tag>
                        <Tooltip title={active ? '停用该分享' : '重新启用'}>
                          <Button
                            size="small"
                            icon={active ? <StopOutlined /> : <CheckCircleOutlined />}
                            onClick={() => handleToggle(s, !active)}
                          />
                        </Tooltip>
                        <Tooltip title="删除该分享（链接立即失效）">
                          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(s)} />
                        </Tooltip>
                      </Space>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary, lineHeight: 1.6 }}>
            分享链接为公开访问地址（无需登录）。设置密码后，访问者需输入密码才能查看；「复制链接+密码」生成的是可直接打开的带密码链接。
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const { message, modal } = AntApp.useApp();
  const { can } = useAppStore();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [reports, setReports] = useState<ReportItem[]>([]);
  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  const canWrite = can('report:write');
  const canShare = can(['share:write', 'share:read']);
  /** 创建分享需要 share:write（share:read 只读账号不显示「生成」） */
  const canShareWrite = can('share:write');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [list, ds] = await Promise.all([
        listReports(),
        canWrite ? listDatasets().catch(() => [] as DatasetItem[]) : Promise.resolve([] as DatasetItem[]),
      ]);
      setReports(list || []);
      setDatasets(ds || []);
    } catch (e) {
      setReports([]);
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
    reports.forEach((r) => {
      if (r.category) set.add(r.category);
    });
    return Array.from(set);
  }, [reports]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return reports.filter((r) => {
      if (typeFilter === 'builtin') return false;
      if (typeFilter !== 'all' && r.reportType !== typeFilter) return false;
      if (categoryFilter !== 'all' && (r.category || '') !== categoryFilter) return false;
      if (!kw) return true;
      return [r.name, r.code, r.description, r.category, r.datasetName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(kw));
    });
  }, [reports, keyword, typeFilter, categoryFilter]);

  /** 内置看板同样响应筛选：类型选「全部 / 看板 / 内置看板」、或关键词命中时才显示 */
  const builtinBoards = useMemo(() => {
    if (typeFilter !== 'all' && typeFilter !== 'dashboard' && typeFilter !== 'builtin') return [];
    if (categoryFilter !== 'all') return [];
    const kw = keyword.trim().toLowerCase();
    if (!kw) return BUILTIN_BOARDS.slice();
    return BUILTIN_BOARDS.filter((b) =>
      [b.name, b.desc, ...b.tags].filter(Boolean).some((v) => String(v).toLowerCase().includes(kw))
    );
  }, [keyword, typeFilter, categoryFilter]);

  /** V6.1 数据卡片（5 个：报表数 / 已发布 / 本月访问 / 分享数 / 看板数） */
  const statItems = useMemo<StatCardItem[]>(() => {
    const total = reports.length;
    const published = reports.filter((r) => Number(r.status) === 1).length;
    const views = reports.reduce((s, r) => s + (r.viewCount || 0), 0);
    const shares = reports.reduce((s, r) => s + (r.shareCount || 0), 0);
    const boards = BUILTIN_BOARDS.length + reports.filter((r) => r.reportType === 'dashboard').length;

    return [
      {
        key: 'total',
        label: '报表数',
        value: fmtNum(total),
        suffix: '个',
        color: PALETTE.primary,
        onClick: () => setTypeFilter('all'),
      },
      {
        key: 'published',
        label: '已发布',
        value: fmtNum(published),
        suffix: '个',
        color: PALETTE.green,
        hint: total > 0 ? `启用率 ${Math.round((published / total) * 100)}%` : undefined,
      },
      {
        key: 'views',
        label: '本月访问',
        value: fmtNum(views),
        suffix: '次',
        color: PALETTE.cyan,
      },
      {
        key: 'shares',
        label: '分享数',
        value: fmtNum(shares),
        suffix: '个',
        color: PALETTE.yellow,
      },
      {
        key: 'boards',
        label: '看板数',
        value: fmtNum(boards),
        suffix: '个',
        color: PALETTE.violet,
        hint: `含预置看板 ${BUILTIN_BOARDS.length} 个`,
        onClick: () => setTypeFilter('dashboard'),
      },
    ];
  }, [reports]);

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

  const handleToggleStatus = async (item: ReportItem, checked: boolean) => {
    try {
      await updateReport(item.id, { status: checked ? 1 : 0 });
      setReports((prev) => prev.map((r) => (r.id === item.id ? { ...r, status: checked ? 1 : 0 } : r)));
      message.success(checked ? '报表已启用' : '报表已停用');
    } catch {
      /* client 已提示 */
    }
  };

  const handleDelete = (item: ReportItem) => {
    modal.confirm({
      title: `删除报表「${item.name}」？`,
      content: '删除后该报表的分享链接会一并失效，且不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await deleteReport(item.id);
        message.success('报表已删除');
        setReports((prev) => prev.filter((r) => r.id !== item.id));
      },
    });
  };

  /* ── V7.1 需求 L：分享弹窗状态 ── */
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);

  /** 打开分享弹窗（报表 / 内置看板共用一个弹窗） */
  const openShare = useCallback((target: ShareTarget) => {
    setShareTarget(target);
    setShareOpen(true);
  }, []);

  /** 新建分享后同步卡片上的「分享数」（内置看板不在报表列表里，跳过） */
  const handleShareCreated = useCallback((target: ShareTarget) => {
    if (target.kind !== 'report') return;
    setReports((prev) => prev.map((r) => (r.id === target.id ? { ...r, shareCount: (r.shareCount || 0) + 1 } : r)));
  }, []);

  /** 打开某个报表的分享弹窗 */
  const openReportShare = useCallback(
    (r: ReportItem) => openShare({ kind: 'report', id: r.id, name: r.name, hint: r.code ? `报表 · ${r.code}` : `报表 · #${r.id}` }),
    [openShare]
  );

  const columns: ProColumns<ReportItem>[] = [
    {
      title: '报表',
      dataIndex: 'name',
      sorter: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
      render: (_, r) => (
        <div style={{ minWidth: 0 }}>
          <a onClick={() => navigate(`/reports/${r.id}/view`)} style={{ fontWeight: 600, fontSize: 13.5 }}>
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
      sorter: (a, b) => Number(a.shareCount || 0) - Number(b.shareCount || 0),
      render: (_, r) => (
        <Badge count={r.shareCount || 0} showZero={false} color={PALETTE.primary} />
      ),
    },
    {
      title: '启用',
      dataIndex: 'status',
      width: 75,
      align: 'center',
      sorter: (a, b) => Number(a.status || 0) - Number(b.status || 0),
      render: (_, r) => (
        <Switch
          size="small"
          checked={Number(r.status) === 1}
          disabled={!canWrite}
          onChange={(v) => handleToggleStatus(r, v)}
        />
      ),
    },
    {
      title: '最近更新',
      dataIndex: 'updatedAt',
      width: 140,
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
      width: 190,
      fixed: 'right',
      render: (_, r) => [
        <a key="view" onClick={() => navigate(`/reports/${r.id}/view`)}>
          查看
        </a>,
        canWrite ? (
          <a key="design" onClick={() => navigate(`/reports/${r.id}/design`)}>
            设计
          </a>
        ) : null,
        canShare ? (
          <a key="share" onClick={() => openReportShare(r)}>
            分享
          </a>
        ) : null,
        canWrite ? (
          <a key="del" style={{ color: PALETTE.red }} onClick={() => handleDelete(r)}>
            删除
          </a>
        ) : null,
      ],
    },
  ];

  /** 内置看板卡片：整体可点击，与「我的报表」卡片同一视觉体系 */
  const renderBuiltin = (b: BuiltinBoard) => (
    <Card
      key={b.key}
      hoverable
      style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12, height: '100%', overflow: 'hidden' }}
      styles={{ body: { padding: 16 } }}
      onClick={() => navigate(b.path)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div
          style={{
            width: 38,
            height: 38,
            flex: '0 0 38px',
            borderRadius: 10,
            background: `linear-gradient(135deg, ${b.color}, ${SIDER.bgTo})`,
            color: NEUTRAL.textInverse,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 17,
          }}
        >
          <FundOutlined />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: NEUTRAL.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {b.name}
          </div>
          <div style={{ fontSize: 11.5, color: NEUTRAL.textTertiary, marginTop: 2 }}>系统预置 · 数据实时聚合</div>
        </div>
        <Tag color={PALETTE.cyan} bordered={false} style={{ color: NEUTRAL.textInverse, marginInlineEnd: 0 }}>
          看板
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
        {b.desc}
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {b.tags.map((t) => (
          <Tag key={t} bordered={false} style={{ marginInlineEnd: 0, background: NEUTRAL.surfaceSunken, color: PALETTE.primary }}>
            {t}
          </Tag>
        ))}
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
        <Button
          type="primary"
          size={isMobile ? 'middle' : 'small'}
          icon={<FundOutlined />}
          onClick={() => navigate(b.path)}
          style={{ minHeight: 32 }}
        >
          打开看板
        </Button>
        {canShare && (
          <Button
            size={isMobile ? 'middle' : 'small'}
            icon={<ShareAltOutlined />}
            onClick={() =>
              openShare({
                kind: 'board',
                id: b.shareTargetId,
                name: b.name,
                hint: `系统内置看板 · ${b.path}`,
              })
            }
            style={{ minHeight: 32 }}
          >
            分享
          </Button>
        )}
      </div>
    </Card>
  );

  const renderCard = (r: ReportItem) => {
    const m = typeMeta(r.reportType);
    return (
      <Card
        key={r.id}
        hoverable
        style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12, height: '100%', overflow: 'hidden' }}
        styles={{ body: { padding: 16 } }}
        onClick={() => navigate(`/reports/${r.id}/view`)}
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

        <div
          style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}
          onClick={(e) => e.stopPropagation()}
        >
          <Button size={isMobile ? 'middle' : 'small'} onClick={() => navigate(`/reports/${r.id}/view`)} style={{ minHeight: 32 }}>
            查看
          </Button>
          {canWrite && (
            <Button
              size={isMobile ? 'middle' : 'small'}
              icon={<EditOutlined />}
              onClick={() => navigate(`/reports/${r.id}/design`)}
              style={{ minHeight: 32 }}
            >
              设计
            </Button>
          )}
          {canShare && (
            <Button
              size={isMobile ? 'middle' : 'small'}
              icon={<ShareAltOutlined />}
              onClick={() => openReportShare(r)}
              style={{ minHeight: 32 }}
            >
              分享
            </Button>
          )}
          {canWrite && (
            <Button
              size={isMobile ? 'middle' : 'small'}
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(r)}
              style={{ minHeight: 32 }}
            >
              删除
            </Button>
          )}
        </div>
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
            { key: 'chart', label: '图表报表' },
            { key: 'table', label: '表格报表' },
            { key: 'dashboard', label: '数据看板' },
            { key: 'builtin', label: `系统内置看板（${BUILTIN_BOARDS.length}）` },
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

      {/* 系统内置看板：预置报表，点击直接进入看板页 */}
      {builtinBoards.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: isMobile ? 13.5 : 14.5, fontWeight: 700, color: NEUTRAL.text }}>系统内置看板</span>
            <span style={{ fontSize: 12, color: NEUTRAL.textTertiary }}>预置报表，直接查看，无需配置</span>
          </div>
          <Row gutter={[12, 12]}>
            {builtinBoards.map((b) => (
              <Col xs={24} sm={12} lg={8} xxl={6} key={b.key}>
                {renderBuiltin(b)}
              </Col>
            ))}
          </Row>
        </div>
      )}

      {/* 我的报表 */}
      {typeFilter !== 'builtin' && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: isMobile ? 13.5 : 14.5, fontWeight: 700, color: NEUTRAL.text }}>我的报表</span>
            <span style={{ fontSize: 12, color: NEUTRAL.textTertiary }}>共 {fmtNum(filtered.length)} 个</span>
          </div>

          {loading ? (
            <div style={{ padding: 60, textAlign: 'center' }}>
              <Spin size="large" />
            </div>
          ) : filtered.length === 0 ? (
            <Card style={{ border: `1px dashed ${NEUTRAL.border}`, borderRadius: 12 }}>
              <Empty
                description={
                  keyword || typeFilter !== 'all' || categoryFilter !== 'all'
                    ? '没有符合条件的自建报表'
                    : builtinBoards.length > 0
                      ? '还没有自建报表，可先从上方的内置看板开始'
                      : '还没有报表'
                }
              >
                {canWrite && (
                  <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                    {reports.length ? '新建报表' : '新建第一个报表'}
                  </Button>
                )}
              </Empty>
            </Card>
          ) : viewMode === 'card' || isMobile ? (
            <Row gutter={[12, 12]}>
              {filtered.map((r) => (
                <Col xs={24} sm={12} lg={8} xxl={6} key={r.id}>
                  {renderCard(r)}
                </Col>
              ))}
            </Row>
          ) : (
            <Card styles={{ body: { padding: 0 } }} style={{ border: `1px solid ${NEUTRAL.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <ProTable<ReportItem>
                rowKey="id"
                columns={columns}
                dataSource={filtered}
                search={false}
                options={{ reload: false, density: false, setting: false }}
                toolBarRender={false}
                scroll={{ x: 'max-content' }}
                pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 个报表` }}
              />
            </Card>
          )}
        </>
      )}

      {/* V7.1 需求 L：分享弹窗（报表 / 内置看板共用） */}
      <ShareModal
        open={shareOpen}
        target={shareTarget}
        isMobile={isMobile}
        canCreate={canShareWrite}
        onClose={() => setShareOpen(false)}
        onCreated={handleShareCreated}
      />

      {/* 新建报表 */}
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
    </Page>
  );
}
