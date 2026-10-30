/**
 * 注册页（/register）
 *
 * 后端契约（src/routes/pages.js）：
 *   POST /register   application/x-www-form-urlencoded
 *   字段：username / email / displayName / password / confirmPassword
 *   成功 → 服务端渲染登录页并带 `.lg-alert.ok`（注册成功 + 验证邮件提示）
 *   失败 → 重新渲染注册页并带 `.alert-error`；未开放注册时是 `.error-page`
 *
 * 视觉与 login.tsx 完全一致：白底居中 Card + 渐变方形品牌标识。
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Grid, Input, Result, Space, Typography } from 'antd';
import { LockOutlined, MailOutlined, SmileOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

const BRAND = {
  name: 'Neo Zheng DataETL',
  subtitle: '企业数据集成平台 · V4.0',
  logo: 'N',
};

/* ---------------- 认证表单提交（与服务端渲染表单等价） ---------------- */
interface AuthResult {
  ok: boolean;
  error?: string;
  info?: string;
}

/** 从服务端渲染的 HTML 中挑出提示文案 */
function pickText(doc: Document, selectors: string[]): string {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    const raw = (el?.textContent || '').trim();
    if (raw) return raw.replace(/^[^0-9A-Za-z\u4e00-\u9fa5]+/, '').trim();
  }
  return '';
}

function parseAuthHtml(html: string, status: number): AuthResult {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const error = pickText(doc, ['.lg-alert.err', '.alert-error', '.alert-danger']);
    const info = pickText(doc, ['.lg-alert.ok', '.alert-success', '.alert-info']);
    if (error) return { ok: false, error };
    if (info) return { ok: true, info };
    if (status >= 400) {
      const pageMsg = pickText(doc, ['.error-page p', '.error-page h1']);
      return { ok: false, error: pageMsg || `提交失败（HTTP ${status}）` };
    }
    return { ok: true };
  } catch {
    if (status >= 400) return { ok: false, error: `提交失败（HTTP ${status}）` };
    return { ok: true };
  }
}

async function submitAuth(path: string, fields: Record<string, string>): Promise<AuthResult> {
  const body = new URLSearchParams();
  Object.entries(fields).forEach(([k, v]) => body.append(k, v));

  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/json',
      },
      body: body.toString(),
      credentials: 'same-origin',
    });
  } catch {
    return { ok: false, error: '网络请求失败，请检查网络后重试' };
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const json = await res.json().catch(() => null);
    if (json && json.ok) return { ok: true, info: json.message };
    return { ok: false, error: (json && json.message) || `提交失败（HTTP ${res.status}）` };
  }

  const html = await res.text();
  return parseAuthHtml(html, res.status);
}

/* ---------------- 页面 ---------------- */
export default function RegisterPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successInfo, setSuccessInfo] = useState('');
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  /* 自助注册开关：来自公开设置接口，避免用户填完表单才被告知「未开放注册」 */
  const [allowReg, setAllowReg] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .get<Record<string, string>>('/settings/public', { silent: true })
      .then((v) => {
        if (!alive) return;
        const raw = String((v && v.allow_registration) || '').toLowerCase();
        setAllowReg(['1', 'true', 'yes', 'on'].includes(raw));
      })
      .catch(() => {
        if (alive) setAllowReg(null); // 接口不可用时不阻塞，交给后端判定
      });
    return () => {
      alive = false;
    };
  }, []);

  const onFinish = async (values: any) => {
    setLoading(true);
    setError('');
    const r = await submitAuth('/register', {
      username: String(values.username || '').trim(),
      email: String(values.email || '').trim(),
      displayName: String(values.displayName || '').trim(),
      password: String(values.password || ''),
      confirmPassword: String(values.confirmPassword || ''),
    });
    setLoading(false);
    if (r.ok) {
      setSuccessInfo(r.info || '注册成功，请登录');
      return;
    }
    setError(r.error || '注册失败，请稍后重试');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#FFFFFF',
        padding: isMobile ? 16 : 24,
      }}
    >
      <Card
        style={{ width: '100%', maxWidth: 430, border: '1px solid #DCDDDD', borderRadius: 14 }}
        styles={{ body: { padding: isMobile ? 22 : 32 } }}
      >
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div
            style={{
              width: 50,
              height: 50,
              borderRadius: 13,
              margin: '0 auto 14px',
              background: 'linear-gradient(135deg, #2D6FE4, #3687FF)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            {BRAND.logo}
          </div>
          <Title level={4} style={{ margin: 0, color: '#003378' }}>
            {BRAND.name}
          </Title>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            {BRAND.subtitle}
          </Text>
        </div>

        {successInfo ? (
          <Result
            status="success"
            title="注册成功"
            subTitle={successInfo}
            extra={[
              <Button key="login" type="primary" onClick={() => navigate('/login')}>
                前往登录
              </Button>,
              <Button key="intro" onClick={() => navigate('/intro')}>
                了解平台
              </Button>,
            ]}
          />
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: 18 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#003378' }}>注册账号</div>
              <div style={{ fontSize: 12.5, color: 'rgba(0,51,120,.55)', marginTop: 4 }}>
                注册后默认为「只读用户」角色，需要更高权限请联系管理员
              </div>
            </div>

            {allowReg === false && (
              <Alert
                type="warning"
                showIcon
                message="系统未开启自助注册"
                description="当前平台已关闭自助注册，请联系管理员为你开通账号。"
                style={{ marginBottom: 16 }}
              />
            )}

            {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

            <Form
              form={form}
              layout="vertical"
              onFinish={onFinish}
              size="large"
              requiredMark={false}
              autoComplete="on"
            >
              <Form.Item
                name="username"
                rules={[
                  { required: true, message: '请输入账号' },
                  {
                    pattern: /^[A-Za-z0-9_.-]{3,32}$/,
                    message: '账号需为 3-32 位字母、数字、下划线、点或短横线',
                  },
                ]}
              >
                <Input
                  prefix={<UserOutlined style={{ color: '#B5B5B6' }} />}
                  placeholder="账号（3-32 位字母、数字、下划线）"
                  autoComplete="username"
                />
              </Form.Item>

              <Form.Item
                name="email"
                rules={[
                  { required: true, message: '请输入邮箱' },
                  { type: 'email', message: '请输入正确的邮箱地址' },
                ]}
              >
                <Input
                  prefix={<MailOutlined style={{ color: '#B5B5B6' }} />}
                  placeholder="邮箱（用于找回密码与接收通知）"
                  autoComplete="email"
                />
              </Form.Item>

              <Form.Item name="displayName">
                <Input
                  prefix={<SmileOutlined style={{ color: '#B5B5B6' }} />}
                  placeholder="显示名称（留空则使用账号）"
                  autoComplete="nickname"
                />
              </Form.Item>

              <Form.Item
                name="password"
                rules={[
                  { required: true, message: '请输入密码' },
                  { min: 6, message: '密码长度至少 6 位' },
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: '#B5B5B6' }} />}
                  placeholder="密码（至少 6 位）"
                  autoComplete="new-password"
                />
              </Form.Item>

              <Form.Item
                name="confirmPassword"
                dependencies={['password']}
                rules={[
                  { required: true, message: '请再次输入密码' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('password') === value) return Promise.resolve();
                      return Promise.reject(new Error('两次输入的密码不一致'));
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: '#B5B5B6' }} />}
                  placeholder="确认密码"
                  autoComplete="new-password"
                />
              </Form.Item>

              <Form.Item style={{ marginBottom: 12 }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  block
                  loading={loading}
                  style={{ height: 44, fontWeight: 600 }}
                >
                  注 册
                </Button>
              </Form.Item>
            </Form>

            <div style={{ textAlign: 'center', marginTop: 6, fontSize: 12.5 }}>
              <Space split={<span style={{ color: '#DCDDDD' }}>|</span>} wrap>
                <a onClick={() => navigate('/login')}>已有账号？返回登录</a>
                <a onClick={() => navigate('/forgot-password')}>忘记密码</a>
                <a onClick={() => navigate('/intro')}>项目介绍</a>
              </Space>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
