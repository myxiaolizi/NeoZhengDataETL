/** 看板操作区（V6.0 紧凑版 · 适配单行 sticky 顶栏）
 *
 * 5 个 32×32 图标按钮（靠右，从左到右）：
 *   有效数据 / 刷新 / 明暗切换 / 主题色 / 手机版二维码
 *
 * 视觉参考 zk2.zhengl.vip/pc4.html：描边幽灵按钮 + 内联 SVG 图标 + hover 高亮。
 */
import React, { useMemo, useState } from 'react';
import { Divider, Modal, Popover, Space, Tooltip, Typography, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';

const { Text } = Typography;

/** 主题色候选（V6：对齐参考站品牌色系） */
const PRIMARY_OPTIONS: { color: string; name: string }[] = [
  { color: '#2563eb', name: '科技蓝' },
  { color: '#3b82f6', name: '天蓝' },
  { color: '#0ea5e9', name: '湖蓝' },
  { color: '#10b981', name: '翡翠绿' },
  { color: '#8b5cf6', name: '紫罗兰' },
  { color: '#f59e0b', name: '琥珀橙' },
];

interface Props {
  validOnly: boolean;
  onToggleValid: () => void;
  onRefresh: () => void;
  dark: boolean;
  onToggleDark: () => void;
  primary: string;
  onPrimaryChange: (c: string) => void;
  isMobile: boolean;
}

/** 32×32 图标按钮基础样式 */
const BTN: React.CSSProperties = {
  width: 32,
  height: 32,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 9,
  border: '1px solid var(--line)',
  background: 'var(--panel2)',
  color: 'var(--text2)',
  cursor: 'pointer',
  transition: 'all .15s',
  flexShrink: 0,
};

/** 内联 SVG（16px，stroke 风格，与参考站一致） */
const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg
    width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
  >
    {children}
  </svg>
);

const ICON = {
  /** 有效数据：对勾圆 */
  valid: <Svg><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></Svg>,
  /** 刷新：环形箭头 */
  refresh: <Svg><path d="M21 12a9 9 0 11-3.5-7.1M21 3v6h-6" /></Svg>,
  /** 月亮 */
  moon: <Svg><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" /></Svg>,
  /** 太阳 */
  sun: <Svg><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>,
  /** 主题色：调色板 */
  theme: <Svg><path d="M12 21a9 9 0 110-18c4.97 0 9 3.58 9 8 0 2.5-2 4-4 4h-2a2 2 0 00-1.5 3.3A2 2 0 0112 21z" /><circle cx="7.5" cy="10.5" r="1" fill="currentColor" /><circle cx="12" cy="7.5" r="1" fill="currentColor" /><circle cx="16.5" cy="10.5" r="1" fill="currentColor" /></Svg>,
  /** 手机 */
  mobile: <Svg><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" /></Svg>,
};

export default function ActionBar({
  validOnly, onToggleValid, onRefresh, dark, onToggleDark,
  primary, onPrimaryChange, isMobile,
}: Props) {
  const [qrOpen, setQrOpen] = useState(false);
  const [spin, setSpin] = useState(false);

  /* ── V7：分享（链接 + 密码） ── */
  const [shareOpen, setShareOpen] = useState(false);
  const [sharePwd, setSharePwd] = useState('');
  const [shareDays, setShareDays] = useState(7);
  const [shareTitle, setShareTitle] = useState('中康智能体客户看板');
  const [shareUrl, setShareUrl] = useState('');
  const [shareSaving, setShareSaving] = useState(false);

  /** 生成 6 位随机密码 */
  const genPwd = () => {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < 6; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  };

  /** 手机版地址 */
  const mobileUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/dashboard/board`;
  }, []);

  const qrSrc = useMemo(
    () => `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(mobileUrl)}`,
    [mobileUrl],
  );
  const [qrFailed, setQrFailed] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(mobileUrl);
      message.success('链接已复制');
    } catch {
      message.warning('复制失败，请手动选择链接复制');
    }
  };

  /** 打开分享弹窗：带默认随机密码 */
  const openShare = () => {
    setSharePwd(genPwd());
    setShareDays(7);
    setShareUrl('');
    setShareOpen(true);
  };

  /** 创建分享链接（target_type='board'，target_id=1 表示中康客户看板） */
  const createShare = async () => {
    setShareSaving(true);
    try {
      const res = await fetch('/api/shares', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: 'board',
          targetId: 1,
          title: shareTitle || '中康智能体客户看板',
          password: sharePwd || undefined,
          expiresDays: shareDays > 0 ? shareDays : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        throw new Error(json.message || `创建失败（HTTP ${res.status}）`);
      }
      const token = json.data?.token || json.token;
      if (!token) throw new Error('未返回分享令牌');
      setShareUrl(`${window.location.origin}/s/${token}`);
      message.success('分享链接已生成');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '创建分享失败');
    } finally {
      setShareSaving(false);
    }
  };

  /** 复制分享链接 */
  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      message.success('分享链接已复制');
    } catch {
      message.warning('复制失败，请手动选择');
    }
  };

  /** 刷新：转一圈再回调 */
  const doRefresh = () => {
    setSpin(true);
    onRefresh();
    window.setTimeout(() => setSpin(false), 900);
  };

  /** 带 hover 反馈的图标按钮 */
  const IconBtn = ({
    icon, tip, onClick, active, activeStyle,
  }: {
    icon: React.ReactNode;
    tip: string;
    onClick: () => void;
    active?: boolean;
    activeStyle?: React.CSSProperties;
  }) => (
    <Tooltip title={tip}>
      <button
        type="button"
        onClick={onClick}
        aria-label={tip}
        style={{ ...BTN, ...(active ? activeStyle : null) }}
        onMouseEnter={(e) => {
          if (active) return;
          e.currentTarget.style.borderColor = 'var(--brand3)';
          e.currentTarget.style.color = 'var(--brand)';
          e.currentTarget.style.background = 'var(--brandSoft)';
        }}
        onMouseLeave={(e) => {
          if (active) return;
          e.currentTarget.style.borderColor = 'var(--line)';
          e.currentTarget.style.color = 'var(--text2)';
          e.currentTarget.style.background = 'var(--panel2)';
        }}
      >
        {icon}
      </button>
    </Tooltip>
  );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 6,
        flexShrink: 0,
      }}
    >
      {/* 1. 有效数据 */}
      <IconBtn
        icon={ICON.valid}
        tip={validOnly ? '当前仅显示有效数据，点击取消' : '仅显示有效数据（排除连锁类型 50-）'}
        onClick={onToggleValid}
        active={validOnly}
        activeStyle={{
          background: 'linear-gradient(135deg, var(--green), var(--green2))',
          borderColor: 'transparent',
          color: '#fff',
          boxShadow: '0 3px 9px color-mix(in srgb, var(--green) 30%, transparent)',
        }}
      />

      {/* 2. 刷新 */}
      <Tooltip title="获取最新数据（不刷新页面）">
        <button
          type="button"
          onClick={doRefresh}
          aria-label="刷新"
          style={BTN}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--brand3)';
            e.currentTarget.style.color = 'var(--brand)';
            e.currentTarget.style.background = 'var(--brandSoft)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--line)';
            e.currentTarget.style.color = 'var(--text2)';
            e.currentTarget.style.background = 'var(--panel2)';
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              animation: spin ? 'boardSpin .9s linear' : 'none',
            }}
          >
            {ICON.refresh}
          </span>
        </button>
      </Tooltip>

      {/* 3. 明暗切换（暗色显示太阳，亮色显示月亮） */}
      <IconBtn
        icon={dark ? ICON.sun : ICON.moon}
        tip={dark ? '切换到浅色模式' : '切换到深色模式'}
        onClick={onToggleDark}
      />

      {/* 4. 主题色 */}
      <Popover
        trigger="click"
        placement="bottomRight"
        content={
          <div style={{ padding: 4 }}>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>选择主题色</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {PRIMARY_OPTIONS.map((o) => {
                const on = primary.toLowerCase() === o.color.toLowerCase();
                return (
                  <button
                    key={o.color}
                    type="button"
                    onClick={() => onPrimaryChange(o.color)}
                    title={o.name}
                    style={{
                      width: 46, height: 46, borderRadius: 10, cursor: 'pointer',
                      background: o.color,
                      border: on ? '2px solid var(--text)' : '2px solid transparent',
                      boxShadow: on ? '0 0 0 3px color-mix(in srgb, var(--brand) 30%, transparent)' : 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'transform .15s ease',
                    }}
                  >
                    {on && (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        }
      >
        <Tooltip title="切换与设置颜色主题">
          <button
            type="button"
            aria-label="主题色"
            style={BTN}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--brand3)';
              e.currentTarget.style.color = 'var(--brand)';
              e.currentTarget.style.background = 'var(--brandSoft)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--line)';
              e.currentTarget.style.color = 'var(--text2)';
              e.currentTarget.style.background = 'var(--panel2)';
            }}
          >
            {ICON.theme}
          </button>
        </Tooltip>
      </Popover>

      {/* 5. 手机版二维码 */}
      <IconBtn
        icon={ICON.mobile}
        tip="手机扫码进入手机版"
        onClick={() => setQrOpen(true)}
      />


      <Modal
        title={<Space size={6}><span style={{ display: 'inline-flex' }}>{ICON.mobile}</span><span>手机版</span></Space>}
        open={qrOpen}
        onCancel={() => setQrOpen(false)}
        footer={<button type="button" onClick={() => setQrOpen(false)} style={{ ...BTN, width: 'auto', padding: '0 16px', height: 34 }}>关闭</button>}
        width={360}
        centered
      >
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <div
            style={{
              display: 'inline-block',
              padding: 12,
              background: '#FFFFFF',
              border: '1px solid var(--line)',
              borderRadius: 14,
              boxShadow: '0 4px 16px rgba(20,52,102,.10)',
            }}
          >
            {qrFailed ? (
              <div
                style={{
                  width: 240, height: 240, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 10,
                  color: '#16253d', fontSize: 12, padding: 12,
                }}
              >
                <div>二维码图片加载失败（当前环境可能无法访问外网）</div>
                <Text copyable={{ text: mobileUrl }} style={{ fontSize: 11, wordBreak: 'break-all' }}>
                  {mobileUrl}
                </Text>
              </div>
            ) : (
              <img
                src={qrSrc}
                alt="手机版二维码"
                width={240}
                height={240}
                onError={() => setQrFailed(true)}
                style={{ display: 'block' }}
              />
            )}
          </div>
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>
            手机扫码进入手机版
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text2)', wordBreak: 'break-all' }}>
            {mobileUrl}
          </div>
          <Divider style={{ margin: '12px 0' }} />
          <Space>
            <button
              type="button"
              onClick={copyLink}
              style={{ ...BTN, width: 'auto', padding: '0 14px', height: 32, fontSize: 12.5, fontWeight: 550 }}
            >
              <CopyOutlined style={{ marginRight: 6 }} />复制链接
            </button>
          </Space>
        </div>
      </Modal>
    </div>
  );
}
