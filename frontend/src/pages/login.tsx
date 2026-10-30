/** 登录页：Ant Design 6 + 品牌视觉 */
import React, { useState } from 'react';
import { Card, Form, Input, Button, Checkbox, Typography, Alert, Space, Grid } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/api/client';
import { useAppStore } from '@/stores/app';
import { PALETTE, NEUTRAL } from '@/theme';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

export default function Login() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { fetchUser } = useAppStore();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const onFinish = async (values: any) => {
    setLoading(true);
    setError('');
    try {
      const body = new URLSearchParams();
      body.append('username', values.username);
      body.append('password', values.password);
      if (values.remember) body.append('remember', '1');
      const redirect = params.get('redirect') || '/dashboard';
      body.append('redirect', redirect);

      const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        credentials: 'same-origin',
        redirect: 'manual',
      });

      // 表单登录成功会 302 跳转
      if (res.type === 'opaqueredirect' || res.status === 0 || res.status === 302) {
        await fetchUser();
        navigate(redirect, { replace: true });
        return;
      }
      if (res.ok) {
        const html = await res.text();
        // 服务端渲染了登录页说明失败
        const m = html.match(/lg-alert[^>]*>[\s\S]*?<span>([^<]+)<\/span>/);
        setError(m ? m[1] : '用户名或密码错误');
      } else {
        setError('用户名或密码错误');
      }
    } catch (e: any) {
      setError(e?.message || '登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
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
        style={{ width: '100%', maxWidth: 400, border: `1px solid ${NEUTRAL.border}`, borderRadius: 14 }}
        styles={{ body: { padding: isMobile ? 22 : 32 } }}
      >
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <div
            style={{
              width: 50, height: 50, borderRadius: 13, margin: '0 auto 14px',
              background: `linear-gradient(135deg, ${PALETTE.primary}, ${PALETTE.primaryLight})`,
              color: NEUTRAL.textInverse, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, fontWeight: 700,
            }}
          >
            N
          </div>
          <Title level={4} style={{ margin: 0, color: NEUTRAL.text }}>Neo Zheng DataETL</Title>
          <Text type="secondary" style={{ fontSize: 12.5 }}>企业数据集成平台 · V4.0</Text>
        </div>

        {error && (
          <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />
        )}

        <Form form={form} layout="vertical" onFinish={onFinish} size="large" requiredMark={false}>
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined style={{ color: NEUTRAL.textTertiary }} />} placeholder="用户名" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined style={{ color: NEUTRAL.textTertiary }} />} placeholder="密码" autoComplete="current-password" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Form.Item name="remember" valuePropName="checked" noStyle>
                <Checkbox>记住我</Checkbox>
              </Form.Item>
              <a onClick={() => navigate('/forgot-password')} style={{ fontSize: 13 }}>忘记密码？</a>
            </div>
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading} style={{ height: 44, fontWeight: 600 }}>
            登 录
          </Button>
        </Form>

        <div style={{ textAlign: 'center', marginTop: 18, fontSize: 12.5 }}>
          <Space split={<span style={{ color: NEUTRAL.borderSubtle }}>|</span>}>
            <a onClick={() => navigate('/intro')}>项目介绍</a>
            <a onClick={() => navigate('/help')}>使用说明</a>
          </Space>
        </div>
      </Card>
    </div>
  );
}
