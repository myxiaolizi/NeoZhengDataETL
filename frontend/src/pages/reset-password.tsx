/**
 * 重置密码（/reset-password?token=xxx）
 *
 * 后端契约（src/routes/pages.js）：
 *   POST /reset-password   application/x-www-form-urlencoded
 *   字段：token / newPassword / confirmPassword
 *   成功 → 服务端渲染登录页并带 `.lg-alert.ok`（「密码已重置，请使用新密码登录」）
 *   失败 → 重新渲染本页并带 `.alert-error`（令牌无效/过期、两次密码不一致、长度不足）
 *
 * 注意：令牌有效性由后端在 GET /reset-password 时校验；SPA 无法读取该 HTML，
 * 因此这里在提交失败时把「链接无效或已过期」作为一等状态展示，并引导重新申请。
 */
import React, { useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Grid, Input, Result, Space, Typography } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';

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
export default function ResetPasswordPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const token = useMemo(() => (params.get('token') || '').trim(), [params]);

  const onFinish = async (values: any) => {
    setLoading(true);
    setError('');
    const r = await submitAuth('/reset-password', {
      token,
      newPassword: String(values.newPassword || ''),
      confirmPassword: String(values.confirmPassword || ''),
    });
    setLoading(false);
    if (r.ok) {
      setInfo(r.info || '密码已重置，请使用新密码登录');
      return;
    }
    const msg = r.error || '重置失败，请稍后重试';
    setError(msg);
    if (msg.includes('无效') || msg.includes('过期')) setTokenInvalid(true);
  };

  const shell = (children: React.ReactNode) => (
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
        {children}
      </Card>
    </div>
  );

  /* 1. 重置成功 */
  if (info) {
    return shell(
      <Result
        status="success"
        title="密码已重置"
        subTitle={info}
        extra={[
          <Button key="login" type="primary" onClick={() => navigate('/login')}>
            前往登录
          </Button>,
          <Button key="home" onClick={() => navigate('/intro')}>
            了解平台
          </Button>,
        ]}
      />
    );
  }

  /* 2. 缺少令牌 / 令牌无效 */
  if (!token || tokenInvalid) {
    return shell(
      <Result
        status="warning"
        title={token ? '重置链接无效或已过期' : '缺少重置令牌'}
        subTitle="重置链接 30 分钟内有效且只能使用一次，请重新申请一封重置邮件。"
        extra={[
          <Button key="forgot" type="primary" onClick={() => navigate('/forgot-password')}>
            重新申请重置链接
          </Button>,
          <Button key="login" onClick={() => navigate('/login')}>
            返回登录
          </Button>,
        ]}
      />
    );
  }

  /* 3. 设置新密码 */
  return shell(
    <>
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#003378' }}>重置密码</div>
        <div style={{ fontSize: 12.5, color: 'rgba(0,51,120,.55)', marginTop: 4 }}>
          设置新密码后，其他设备的登录状态会被退出
        </div>
      </div>

      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

      <Form form={form} layout="vertical" onFinish={onFinish} size="large" requiredMark={false}>
        <Form.Item
          name="newPassword"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, message: '密码长度至少 6 位' },
          ]}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: '#B5B5B6' }} />}
            placeholder="新密码（至少 6 位）"
            autoComplete="new-password"
          />
        </Form.Item>

        <Form.Item
          name="confirmPassword"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                return Promise.reject(new Error('两次输入的密码不一致'));
              },
            }),
          ]}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: '#B5B5B6' }} />}
            placeholder="确认新密码"
            autoComplete="new-password"
          />
        </Form.Item>

        <Form.Item style={{ marginBottom: 12 }}>
          <Button type="primary" htmlType="submit" block loading={loading} style={{ height: 44, fontWeight: 600 }}>
            确认重置
          </Button>
        </Form.Item>
      </Form>

      <div style={{ textAlign: 'center', marginTop: 6, fontSize: 12.5 }}>
        <Space split={<span style={{ color: '#DCDDDD' }}>|</span>} wrap>
          <a onClick={() => navigate('/login')}>返回登录</a>
          <a onClick={() => navigate('/forgot-password')}>重新申请重置链接</a>
        </Space>
      </div>
    </>
  );
}
