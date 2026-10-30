/** 看板操作区
 *
 * 5 个图标按钮（靠右，从左到右）：
 *   有效数据 / 刷新 / 明暗切换 / 主题色 / 手机版二维码
 */
import React, { useMemo, useState } from 'react';
import { Button, Divider, Modal, Popover, Space, Tooltip, Typography } from 'antd';
import {
  BgColorsOutlined, CheckCircleOutlined, CheckOutlined, CopyOutlined,
  MobileOutlined, MoonOutlined, SunOutlined, SyncOutlined,
} from '@ant-design/icons';
import { message } from 'antd';

const { Text } = Typography;

/** 主题色候选（契约 13 色里的深色系） */
const PRIMARY_OPTIONS: { color: string; name: string }[] = [
  { color: '#3687FF', name: '品牌蓝' },
  { color: '#45B4FF', name: '天蓝' },
  { color: '#2D6FE4', name: '深蓝' },
  { color: '#003378', name: '墨蓝' },
  { color: '#EC673C', name: '活力橙' },
  { color: '#A2D73C', name: '生机绿' },
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

export default function ActionBar({
  validOnly, onToggleValid, onRefresh, dark, onToggleDark,
  primary, onPrimaryChange, isMobile,
}: Props) {
  const [qrOpen, setQrOpen] = useState(false);

  /** 手机版地址：当前站点 + /dashboard/board */
  const mobileUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/dashboard/board`;
  }, []);

  /** 在线二维码图片（无需额外依赖） */
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

  const iconBtnStyle: React.CSSProperties = {
    borderColor: 'var(--border)',
    color: 'var(--text-main)',
    background: 'var(--bg-card)',
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isMobile ? 'flex-start' : 'flex-end',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      {/* 1. 有效数据 */}
      <Tooltip title={validOnly ? '当前仅显示有效数据，点击取消' : '仅显示有效数据（排除连锁类型 50-）'}>
        <Button
          icon={<CheckCircleOutlined />}
          onClick={onToggleValid}
          type={validOnly ? 'primary' : 'default'}
          style={validOnly ? undefined : iconBtnStyle}
        >
          {isMobile ? null : '有效'}
        </Button>
      </Tooltip>

      {/* 2. 刷新 */}
      <Tooltip title="获取最新数据（不刷新页面）">
        <Button icon={<SyncOutlined />} onClick={onRefresh} style={iconBtnStyle}>
          {isMobile ? null : '刷新'}
        </Button>
      </Tooltip>

      {/* 3. 明暗切换：暗色显示太阳、亮色显示月亮 */}
      <Tooltip title={dark ? '切换到浅色模式' : '切换到深色模式'}>
        <Button
          icon={dark ? <SunOutlined /> : <MoonOutlined />}
          onClick={onToggleDark}
          style={iconBtnStyle}
        />
      </Tooltip>

      {/* 4. 主题色 */}
      <Popover
        trigger="click"
        placement="bottomRight"
        content={
          <div style={{ padding: 4 }}>
            <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 8 }}>选择主题色</div>
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
                      width: 52, height: 52, borderRadius: 10, cursor: 'pointer',
                      background: o.color,
                      border: on ? '2px solid var(--text-main)' : '2px solid transparent',
                      boxShadow: on ? '0 0 0 2px rgba(54,135,255,.35)' : 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'transform .15s ease',
                    }}
                  >
                    {on && <CheckOutlined style={{ color: '#fff', fontSize: 18 }} />}
                  </button>
                );
              })}
            </div>
          </div>
        }
      >
        <Tooltip title="切换与设置颜色主题">
          <Button icon={<BgColorsOutlined />} style={iconBtnStyle} />
        </Tooltip>
      </Popover>

      {/* 5. 手机版二维码 */}
      <Tooltip title="手机扫码进入手机版">
        <Button icon={<MobileOutlined />} onClick={() => setQrOpen(true)} style={iconBtnStyle} />
      </Tooltip>

      <Modal
        title={<Space size={6}><MobileOutlined /><span>手机版</span></Space>}
        open={qrOpen}
        onCancel={() => setQrOpen(false)}
        footer={<Button onClick={() => setQrOpen(false)}>关闭</Button>}
        width={360}
        centered
      >
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <div
            style={{
              display: 'inline-block',
              padding: 12,
              background: '#FFFFFF',
              border: '1px solid var(--border)',
              borderRadius: 12,
            }}
          >
            {qrFailed ? (
              <div
                style={{
                  width: 240, height: 240, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 10,
                  color: '#003378', fontSize: 12, padding: 12,
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
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-main)', fontWeight: 600 }}>
            手机扫码进入手机版
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-sub)', wordBreak: 'break-all' }}>
            {mobileUrl}
          </div>
          <Divider style={{ margin: '12px 0' }} />
          <Space>
            <Button icon={<CopyOutlined />} onClick={copyLink} size="small">复制链接</Button>
          </Space>
        </div>
      </Modal>
    </div>
  );
}
