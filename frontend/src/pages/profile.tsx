/** 个人中心：头像（上传/配色）、资料编辑、修改密码、登录设备管理（含移动端适配） */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Avatar, Button, Card, Col, ColorPicker, Empty, Form, Grid, Input,
  Modal, Popconfirm, Row, Space, Spin, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  CheckOutlined, DesktopOutlined, LockOutlined, LoginOutlined, MailOutlined,
  MobileOutlined, SafetyCertificateOutlined, UserOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import Page from '@/components/Page';
import type { StatCardItem } from '@/components/StatCards';
import { useAppStore } from '@/stores/app';
import {
  changePassword, listSessions, revokeOtherSessions, updateAvatar, updateProfile,
} from '@/api/users';
import type { MeSession, MeUser } from '@/api/users';
import { PALETTE, NEUTRAL } from '@/theme';
import { fmtTime } from '@/utils';

const { Text } = Typography;
const { useBreakpoint } = Grid;

const C = {
  primary: PALETTE.primary,
  blue: PALETTE.primary,
  navy: NEUTRAL.text,
  cyan: PALETTE.cyan,
  light: PALETTE.cyan,
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

/** 头像可选底色（仅调色板） */
const AVATAR_COLORS = [
  PALETTE.primary, PALETTE.cyan, PALETTE.green, PALETTE.yellow,
  PALETTE.orange, PALETTE.violet, PALETTE.red, NEUTRAL.text, NEUTRAL.textTertiary,
];

/** 由 User-Agent 粗略识别设备类型与浏览器 */
function describeAgent(ua: string | null): { label: string; mobile: boolean } {
  const s = (ua || '').toLowerCase();
  const mobile = /mobile|android|iphone|ipad|ipod/.test(s);
  let browser = '未知浏览器';
  if (s.includes('edg/')) browser = 'Edge';
  else if (s.includes('chrome/') && !s.includes('edg/')) browser = 'Chrome';
  else if (s.includes('safari/') && !s.includes('chrome/')) browser = 'Safari';
  else if (s.includes('firefox/')) browser = 'Firefox';
  else if (s.includes('curl/')) browser = 'curl';
  return { label: browser, mobile };
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const { user: rawUser, setUser, fetchUser, logout } = useAppStore();
  /** /api/me 返回的档案字段（phone/position/emailVerified 等） */
  const user = rawUser as MeUser | null;

  const [profileForm] = Form.useForm();
  const [pwdForm] = Form.useForm();

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [pendingAvatar, setPendingAvatar] = useState<string | null>(null);
  const [pendingColor, setPendingColor] = useState<string>(PALETTE.primary);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [sessions, setSessions] = useState<MeSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);

  /** 资料表单初始值 */
  useEffect(() => {
    if (!user) return;
    profileForm.setFieldsValue({
      displayName: user.displayName || '',
      email: user.email || '',
      phone: user.phone || '',
      position: user.position || '',
    });
  }, [user, profileForm]);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const list = await listSessions();
      setSessions(list);
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const stats = useMemo<StatCardItem[]>(() => {
    const others = sessions.filter((s) => !s.current).length;
    return [
      { key: 'role', label: '当前角色', value: user?.roleName || user?.role || '-', color: PALETTE.primary },
      { key: 'email', label: '邮箱验证', value: user?.emailVerified ? '已验证' : user?.email ? '未验证' : '未设置', color: user?.emailVerified ? PALETTE.green : NEUTRAL.textTertiary },
      { key: 'sessions', label: '其他登录设备', value: others, suffix: '台', color: PALETTE.cyan },
    ];
  }, [sessions, user]);

  /* ---------- 资料 ---------- */
  const saveProfile = async () => {
    let v: { displayName: string; email?: string; phone?: string; position?: string };
    try {
      v = await profileForm.validateFields();
    } catch {
      return;
    }
    setSavingProfile(true);
    try {
      await updateProfile({
        displayName: v.displayName.trim(),
        email: (v.email || '').trim(),
        phone: (v.phone || '').trim(),
        position: (v.position || '').trim(),
      });
      message.success('个人资料已更新');
      await fetchUser();
    } catch {
      /* client 已提示 */
    } finally {
      setSavingProfile(false);
    }
  };

  /* ---------- 密码 ---------- */
  const savePassword = async () => {
    let v: { oldPassword: string; newPassword: string; confirmPassword: string };
    try {
      v = await pwdForm.validateFields();
    } catch {
      return;
    }
    setSavingPwd(true);
    try {
      await changePassword(v);
      message.success('密码修改成功，请使用新密码重新登录');
      pwdForm.resetFields();
      await logout();
      navigate('/login', { replace: true });
    } catch {
      /* client 已提示 */
    } finally {
      setSavingPwd(false);
    }
  };

  /* ---------- 头像 ---------- */
  const openAvatar = () => {
    setPendingAvatar(null);
    setPendingColor(user?.avatarColor || PALETTE.primary);
    setAvatarOpen(true);
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      message.error('请选择图片文件');
      e.target.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      message.error('图片大小不能超过 2MB');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPendingAvatar(String(reader.result || ''));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const saveAvatar = async () => {
    setAvatarSaving(true);
    try {
      if (pendingAvatar) {
        const updated = await updateAvatar({ avatar: pendingAvatar });
        if (updated) setUser(updated);
      } else {
        const updated = await updateAvatar({ avatar: '', avatarColor: pendingColor });
        if (updated) setUser(updated);
      }
      message.success('头像已更新');
      setAvatarOpen(false);
      await fetchUser();
    } catch {
      /* client 已提示 */
    } finally {
      setAvatarSaving(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarSaving(true);
    try {
      const updated = await updateAvatar({ avatar: '', avatarColor: null });
      if (updated) setUser(updated);
      message.success('已恢复默认头像');
      setAvatarOpen(false);
      await fetchUser();
    } catch {
      /* client 已提示 */
    } finally {
      setAvatarSaving(false);
    }
  };

  /* ---------- 设备 ---------- */
  const doRevoke = async () => {
    setRevoking(true);
    try {
      await revokeOtherSessions();
      message.success('已退出其他所有设备');
      await loadSessions();
    } catch {
      /* client 已提示 */
    } finally {
      setRevoking(false);
    }
  };

  const displayName = user?.displayName || user?.username || '未登录';
  const avatarFallback = displayName.slice(0, 1).toUpperCase();
  const others = sessions.filter((s) => !s.current).length;

  /* ---------- 左侧：身份卡 ---------- */
  const identityCard = (
    <Card size="small" style={{ borderColor: C.line }} styles={{ body: { padding: isMobile ? 16 : 20 } }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <Avatar
            size={isMobile ? 76 : 88}
            src={user?.avatar || undefined}
            style={{
              background: user?.avatarColor || PALETTE.primary,
              fontSize: isMobile ? 30 : 34,
              fontWeight: 700,
            }}
          >
            {avatarFallback}
          </Avatar>
          <Tooltip title="更换头像">
            <Button
              shape="circle"
              size="small"
              icon={<UserOutlined />}
              onClick={openAvatar}
              style={{
                position: 'absolute',
                right: -2,
                bottom: -2,
                border: `2px solid ${NEUTRAL.surface}`,
                background: C.primary,
                color: NEUTRAL.textInverse,
                minWidth: 28,
                height: 28,
              }}
            />
          </Tooltip>
        </div>

        <div style={{ fontSize: 17, fontWeight: 700, color: C.navy, marginTop: 10, lineHeight: 1.35 }}>
          {displayName}
        </div>
        <div style={{ marginTop: 6 }}>
          <Tag style={softStyle(user?.role === 'admin' ? PALETTE.red : PALETTE.primary)}>
            <Space size={4}>
              <SafetyCertificateOutlined />
              <span>{user?.roleName || user?.role || '-'}</span>
            </Space>
          </Tag>
        </div>

        <div
          style={{
            marginTop: 16,
            paddingTop: 14,
            borderTop: `1px solid ${C.line}`,
            textAlign: 'left',
          }}
        >
          <Space orientation="vertical" size={10} style={{ width: '100%' }}>
            {[
              { icon: <UserOutlined />, label: '登录账号', value: user?.username || '-' },
              { icon: <MailOutlined />, label: '邮箱', value: user?.email || '未设置' },
              { icon: <SafetyCertificateOutlined />, label: '邮箱验证', value: user?.emailVerified ? '已验证' : user?.email ? '未验证' : '-' },
              { icon: <UserOutlined />, label: '部门', value: user?.department || '未分配' },
              { icon: <UserOutlined />, label: '职位', value: user?.position || '-' },
              { icon: <LoginOutlined />, label: '最后登录', value: fmtTime(user?.lastLoginAt, 'YYYY-MM-DD HH:mm') },
              { icon: <DesktopOutlined />, label: '登录 IP', value: user?.lastLoginIp || '-' },
              { icon: <CheckOutlined />, label: '注册时间', value: fmtTime(user?.createdAt, 'YYYY-MM-DD') },
            ].map((item) => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ color: C.gray, fontSize: 12, marginTop: 2, flexShrink: 0 }}>{item.icon}</span>
                <span style={{ fontSize: 12, color: C.gray, width: 68, flexShrink: 0 }}>{item.label}</span>
                <span
                  style={{
                    fontSize: 12.5,
                    color: C.navy,
                    flex: 1,
                    minWidth: 0,
                    wordBreak: 'break-all',
                    textAlign: 'right',
                  }}
                >
                  {item.value}
                </span>
              </div>
            ))}
          </Space>
        </div>

        <Button block type="primary" style={{ marginTop: 16, height: isMobile ? 44 : 36 }} onClick={openAvatar}>
          更换头像 / 头像配色
        </Button>
      </div>
    </Card>
  );

  /* ---------- 资料编辑 ---------- */
  const profileCard = (
    <Card
      size="small"
      style={{ borderColor: C.line }}
      title={
        <Space size={6}>
          <UserOutlined style={{ color: C.primary }} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: C.navy }}>个人资料</span>
        </Space>
      }
    >
      <Form form={profileForm} layout="vertical" requiredMark={false} size={isMobile ? 'large' : 'middle'}>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item
              name="displayName"
              label="显示名称"
              rules={[{ required: true, message: '请填写显示名称' }]}
            >
              <Input placeholder="用于界面展示的昵称" maxLength={64} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="email"
              label="邮箱"
              rules={[{ type: 'email', message: '邮箱格式不正确' }]}
              extra="用于找回密码与接收系统通知"
            >
              <Input placeholder="name@example.com" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="phone" label="手机号">
              <Input placeholder="可选" maxLength={32} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="position" label="职位">
              <Input placeholder="例如：数据分析师" maxLength={64} />
            </Form.Item>
          </Col>
        </Row>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={() => profileForm.resetFields()} disabled={savingProfile}>
            重置
          </Button>
          <Button type="primary" loading={savingProfile} onClick={saveProfile} style={isMobile ? { minHeight: 44 } : undefined}>
            保存资料
          </Button>
        </div>
      </Form>
    </Card>
  );

  /* ---------- 修改密码 ---------- */
  const passwordCard = (
    <Card
      size="small"
      style={{ borderColor: C.line }}
      title={
        <Space size={6}>
          <LockOutlined style={{ color: C.orange }} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: C.navy }}>修改密码</span>
        </Space>
      }
    >
      <Form form={pwdForm} layout="vertical" requiredMark={false} size={isMobile ? 'large' : 'middle'}>
        <Row gutter={12}>
          <Col xs={24} md={8}>
            <Form.Item
              name="oldPassword"
              label="当前密码"
              rules={[{ required: true, message: '请输入当前密码' }]}
            >
              <Input.Password placeholder="当前密码" autoComplete="current-password" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="newPassword"
              label="新密码"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 6, message: '密码至少 6 位' },
              ]}
            >
              <Input.Password placeholder="至少 6 位" autoComplete="new-password" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="confirmPassword"
              label="确认新密码"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                    return Promise.reject(new Error('两次输入的新密码不一致'));
                  },
                }),
              ]}
            >
              <Input.Password placeholder="再次输入新密码" autoComplete="new-password" />
            </Form.Item>
          </Col>
        </Row>
        <Alert
          type="warning"
          showIcon
          title="修改密码后所有设备的登录状态都会失效，需要使用新密码重新登录。"
          style={{ marginBottom: 14 }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            type="primary"
            loading={savingPwd}
            onClick={savePassword}
            style={isMobile ? { width: '100%', minHeight: 44 } : undefined}
          >
            修改密码
          </Button>
        </div>
      </Form>
    </Card>
  );

  /* ---------- 登录设备 ---------- */
  const sessionCard = (
    <Card
      size="small"
      style={{ borderColor: C.line }}
      title={
        <Space size={6}>
          <DesktopOutlined style={{ color: C.primary }} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: C.navy }}>登录设备</span>
          <Tag style={softStyle(C.blue)}>{sessions.length}</Tag>
        </Space>
      }
      extra={
        others > 0 ? (
          <Popconfirm
            title="退出其他设备"
            description={`将退出除当前设备外的 ${others} 个登录会话，确定继续？`}
            okText="退出"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={doRevoke}
          >
            <Button size="small" danger loading={revoking} icon={<LoginOutlined />}>
              退出其他设备
            </Button>
          </Popconfirm>
        ) : (
          <Text style={{ fontSize: 11.5, color: C.gray }}>仅当前设备在线</Text>
        )
      }
      styles={{ body: { padding: sessionsLoading ? 24 : 0 } }}
    >
      {sessionsLoading ? (
        <div style={{ textAlign: 'center' }}>
          <Spin description="加载中…" />
        </div>
      ) : sessions.length === 0 ? (
        <div style={{ padding: 16 }}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无登录记录" />
        </div>
      ) : (
        <div>
          {sessions.map((s, idx) => {
            const agent = describeAgent(s.userAgent);
            return (
              <div
                key={`${idx}-${s.ip || 'ip'}-${s.createdAt}`}
                style={{
                  padding: isMobile ? '10px 12px' : '10px 14px',
                  borderTop: idx === 0 ? undefined : `1px solid ${NEUTRAL.borderSubtle}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', minWidth: 0 }}>
                  <span style={{ color: s.current ? C.primary : C.gray, fontSize: 16, marginTop: 2, flexShrink: 0 }}>
                    {agent.mobile ? <MobileOutlined /> : <DesktopOutlined />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Space size={6} wrap>
                      <Tag style={softStyle(s.current ? C.green : C.gray)}>{s.current ? '当前设备' : '其他设备'}</Tag>
                      <Text style={{ fontSize: 12.5, color: C.navy }}>{agent.label}</Text>
                      <Text code style={{ fontSize: 11.5 }}>{s.ip || '-'}</Text>
                    </Space>
                    <div style={{ fontSize: 11.5, color: C.gray, marginTop: 4, lineHeight: 1.6, wordBreak: 'break-all' }}>
                      <div>登录：{fmtTime(s.createdAt, 'YYYY-MM-DD HH:mm')}</div>
                      <div>过期：{fmtTime(s.expiresAt, 'YYYY-MM-DD HH:mm')}</div>
                      {!isMobile && s.userAgent ? <div>UA：{s.userAgent}</div> : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );

  return (
    <Page title="个人中心" stats={stats}>
      {isMobile ? (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          {identityCard}
          {profileCard}
          {passwordCard}
          {sessionCard}
        </Space>
      ) : (
        <Row gutter={[12, 12]}>
          <Col xs={24} lg={8} xl={7}>
            {identityCard}
          </Col>
          <Col xs={24} lg={16} xl={17}>
            <Space orientation="vertical" size={12} style={{ width: '100%' }}>
              {profileCard}
              {passwordCard}
              {sessionCard}
            </Space>
          </Col>
        </Row>
      )}

      {/* 头像设置 */}
      <Modal
        title="头像设置"
        open={avatarOpen}
        onCancel={() => setAvatarOpen(false)}
        onOk={saveAvatar}
        okText="保存"
        cancelText="取消"
        confirmLoading={avatarSaving}
        width={isMobile ? '100%' : 460}
        style={isMobile ? { top: 12, maxWidth: 'calc(100vw - 24px)' } : undefined}
        destroyOnHidden
      >
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Avatar
              size={92}
              src={pendingAvatar || (pendingAvatar === null ? user?.avatar || undefined : undefined)}
              style={{
                background: pendingAvatar ? C.gray : pendingColor,
                fontSize: 36,
                fontWeight: 700,
              }}
            >
              {avatarFallback}
            </Avatar>
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: C.navy, marginBottom: 8 }}>上传图片</div>
            <Space size={8} wrap>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickFile} />
              <Button onClick={() => fileRef.current?.click()}>选择图片</Button>
              {pendingAvatar ? (
                <Button
                  onClick={() => {
                    setPendingAvatar(null);
                    if (fileRef.current) fileRef.current.value = '';
                  }}
                >
                  取消上传
                </Button>
              ) : null}
            </Space>
            <div style={{ fontSize: 11.5, color: C.gray, marginTop: 6 }}>
              支持 JPG / PNG / GIF，建议 200×200，不超过 2MB
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: C.navy, marginBottom: 8 }}>
              或选择头像底色（不使用图片时生效）
            </div>
            <Space size={8} wrap>
              {AVATAR_COLORS.map((color) => {
                const on = pendingColor === color && !pendingAvatar;
                return (
                  <div
                    key={color}
                    onClick={() => {
                      setPendingColor(color);
                      setPendingAvatar(null);
                    }}
                    title={color}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: color,
                      cursor: 'pointer',
                      border: on ? `2px solid ${NEUTRAL.text}` : `1px solid ${NEUTRAL.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: NEUTRAL.textInverse,
                      fontSize: 14,
                    }}
                  >
                    {on ? <CheckOutlined /> : null}
                  </div>
                );
              })}
              <ColorPicker
                size="large"
                format="hex"
                disabledAlpha
                value={pendingColor}
                onChange={(_, hex) => {
                  setPendingColor(hex);
                  setPendingAvatar(null);
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    border: `1px dashed ${NEUTRAL.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    fontSize: 11,
                    color: C.gray,
                  }}
                >
                  自定义
                </div>
              </ColorPicker>
            </Space>
          </div>

          <Button block onClick={removeAvatar} disabled={avatarSaving}>
            恢复默认头像
          </Button>
        </Space>
      </Modal>
    </Page>
  );
}