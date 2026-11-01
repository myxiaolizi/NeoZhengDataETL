/** 看板操作区 — V10
 *
 * 4 个 32×32 图标按钮（靠右，从左到右）：
 *   有效数据 / 刷新 / 深色·浅色切换 / 手机版二维码
 *
 * V10 改动：
 *   T3 移除调色板（PRIMARY_OPTIONS），改为单个「深色/浅色」切换按钮
 *   T7 去掉包裹操作按钮的外框（改为无容器的幽灵按钮行）
 */
import React, { useMemo, useState } from 'react';
import { Divider, Modal, Space, Tooltip, Typography, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface Props {
  validOnly: boolean;
  onToggleValid: () => void;
  onRefresh: () => void;
  dark: boolean;
  onToggleDark: () => void;
  /**
   * V10 T3：调色板已移除，但 Board.tsx 仍会传 primary / onPrimaryChange。
   * 这两个 prop 保留在接口里（避免改 Board.tsx），组件内不再使用。
   */
  primary: string;
  onPrimaryChange: (c: string) => void;
  isMobile: boolean;
}

/** 32×32 幽灵图标按钮：无底色、无边框，比筛选 chip 更轻，突出「操作」属性 */
const BTN: React.CSSProperties = {
  width: 32,
  height: 32,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--text2)',
  cursor: 'pointer',
  transition: 'background .16s ease, color .16s ease, border-color .16s ease',
  flexShrink: 0,
};

/** 幽灵按钮 hover：浅品牌底 + 品牌字 */
const HOVER_ON = (el: HTMLElement) => {
  el.style.background = 'var(--brandSoft)';
  el.style.color = 'var(--brand)';
  el.style.borderColor = 'color-mix(in srgb, var(--brand) 20%, transparent)';
};

const HOVER_OFF = (el: HTMLElement) => {
  el.style.background = 'transparent';
  el.style.color = 'var(--text2)';
  el.style.borderColor = 'transparent';
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
  /** 手机 */
  mobile: <Svg><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" /></Svg>,
};

export default function ActionBar({
  validOnly, onToggleValid, onRefresh, dark, onToggleDark, isMobile,
}: Props) {
  /**
   * V10 T3：调色板 UI 已移除。
   * Props 接口仍保留 primary / onPrimaryChange（Board.tsx 会传，避免改 Lead 的文件），
   * 这里不解构它们即可，不会产生「未使用变量」告警。
   */
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

  /** 带 hover 反馈的幽灵图标按钮 */
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
          HOVER_ON(e.currentTarget);
        }}
        onMouseLeave={(e) => {
          if (active) return;
          HOVER_OFF(e.currentTarget);
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
        gap: 2,
        flexShrink: 0,
        // V10 T7：去掉外框（原 --panel2 底 + --line 边 + 圆角），改为无容器按钮行
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
          onMouseEnter={(e) => HOVER_ON(e.currentTarget)}
          onMouseLeave={(e) => HOVER_OFF(e.currentTarget)}
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

      {/* 3. 深色 / 浅色切换（V10 T3：替换原调色板）
          当前为浅色 → 显示月亮（点击进入深色）
          当前为深色 → 显示太阳（点击回到浅色） */}
      <IconBtn
        icon={dark ? ICON.sun : ICON.moon}
        tip={dark ? '当前深色模式，点击切换到浅色' : '当前浅色模式，点击切换到深色'}
        onClick={onToggleDark}
      />

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
              style={{ ...BTN, width: 'auto', padding: '0 14px', height: 32, fontSize: 'var(--fs-sm)', fontWeight: 500 }}
            >
              <CopyOutlined style={{ marginRight: 6 }} />复制链接
            </button>
          </Space>
        </div>
      </Modal>
    </div>
  );
}
