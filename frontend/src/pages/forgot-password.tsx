/**
 * 忘记密码（/forgot-password）
 *
 * 后端契约（src/routes/pages.js）：
 *   POST /forgot-password   application/x-www-form-urlencoded
 *   字段：email
 *   成功 → 重新渲染本页并带 `.alert-success`（不会暴露邮箱是否注册）
 *   失败 → `.alert-error`（邮箱格式错误 / 未配置邮件服务 / 发信失败）
 *
 * 视觉与 login.tsx 一致：白底居中 Card + 渐变方形品牌标识。
 *
 * V6.1：品牌区（名称 / 副标题 / Logo 方块）改为读站点信息（useSiteBrand），
 * 不再硬编码；document.title 同步跟随站点名称。
 */
import React, { useState } from 'react';
import { Alert, Button, Card, Form, Grid, Input, Result, Space, Typography } from 'antd';
import { MailOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useSiteBrand } from '@/stores/app';
import { PALETTE, NEUTRAL } from '@/theme';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

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
export default function ForgotPasswordPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const navigate = useNavigate();
  const { brandName, brandSubtitle, brandLogoText } = useSiteBrand();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const onFinish = async (values: any) => {
    setLoading(true);
    setError('');
    const r = await submitAuth('/forgot-password', { email: String(values.email || '').trim() });
    setLoading(false);
    if (r.ok) {
      setInfo(r.info || '如果该邮箱已注册，我们已发送重置邮件，请查收');
      return;
    }
    setError(r.error || '发送失败，请稍后重试');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: NEUTRAL.pageBg,
        padding: isMobile ? 16 : 24,
      }}
    >
      <Card
        style={{ width: '100%', maxWidth: 430, border: `1px solid ${NEUTRAL.border}`, borderRadius: 14 }}
        styles={{ body: { padding: isMobile ? 22 : 32 } }}
      >
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div
            style={{
              width: 50,
              height: 50,
              borderRadius: 13,
              margin: '0 auto 14px',
              background: `linear-gradient(135deg, ${PALETTE.primary}, ${PALETTE.primaryLight})`,
              color: NEUTRAL.textInverse,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            {brandLogoText}
          </div>
          <Title level={4} style={{ margin: 0, color: NEUTRAL.text }}>
            {brandName}
          </Title>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            {brandSubtitle}
          </Text>
        </div>

        {info ? (
          <Result
            status="success"
            title="邮件已发送"
            subTitle={info}
            extra={[
              <Button key="login" type="primary" onClick={() => navigate('/login')}>
                返回登录
              </Button>,
              <Button key="again" onClick={() => setInfo('')}>
                重新发送
              </Button>,
            ]}
          />
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: 18 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: NEUTRAL.text }}>找回密码</div>
              <div style={{ fontSize: 12.5, color: NEUTRAL.textSecondary, marginTop: 4 }}>
                输入注册邮箱，我们将发送重置链接（30 分钟内有效）
              </div>
            </div>

            {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

            <Form form={form} layout="vertical" onFinish={onFinish} size="large" requiredMark={false}>
              <Form.Item
                name="email"
                rules={[
                  { required: true, message: '请输入注册邮箱' },
                  { type: 'email', message: '请输入正确的邮箱地址' },
                ]}
              >
                <Input
                  prefix={<MailOutlined style={{ color: NEUTRAL.textTertiary }} />}
                  placeholder="注册邮箱"
                  autoComplete="email"
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
                  发送重置邮件
                </Button>
              </Form.Item>
            </Form>

            <div style={{ textAlign: 'center', marginTop: 6, fontSize: 12.5 }}>
              <Space split={<span style={{ color: NEUTRAL.borderSubtle }}>|</span>} wrap>
                <a onClick={() => navigate('/login')}>返回登录</a>
                <a onClick={() => navigate('/register')}>注册新账号</a>
                <a onClick={() => navigate('/help')}>使用说明</a>
              </Space>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
