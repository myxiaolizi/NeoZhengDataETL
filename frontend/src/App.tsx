/** App 根组件：路由守卫 + 懒加载 */
import React, { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAppStore } from '@/stores/app';
import { setUnauthorizedHandler } from '@/api/client';
import BasicLayout from '@/layouts/BasicLayout';
import { PUBLIC_ROUTES, PUBLIC_PREFIXES } from '@/routes';

/** 统一懒加载包装 */
const lazyPage = (loader: () => Promise<any>, name?: string) =>
  lazy(() => loader().then((m) => ({ default: name ? m[name] : m.default })));

// 公开页
const Login = lazyPage(() => import('@/pages/login'));
const Register = lazyPage(() => import('@/pages/register'));
const ForgotPassword = lazyPage(() => import('@/pages/forgot-password'));
const ResetPassword = lazyPage(() => import('@/pages/reset-password'));
const ShareView = lazyPage(() => import('@/pages/share-view'));
const PublicForm = lazyPage(() => import('@/pages/public-form'));
/** V8：AI 问数公开分享页（手机扫码 / 微信打开，独立布局） */
const AiShare = lazyPage(() => import('@/pages/ai-share'));

// 业务页
const Dashboard = lazyPage(() => import('@/pages/dashboard'));
const Board = lazyPage(() => import('@/pages/dashboard/Board'));
const CrmDashboard = lazyPage(() => import('@/pages/dashboard/CrmDashboard'));
const Projects = lazyPage(() => import('@/pages/projects'));
const ProjectDetail = lazyPage(() => import('@/pages/projects/Detail'));
const ProjectFields = lazyPage(() => import('@/pages/projects/Fields'));
const Forms = lazyPage(() => import('@/pages/forms'));
const FormDesign = lazyPage(() => import('@/pages/forms/Design'));
const FormData = lazyPage(() => import('@/pages/forms/Data'));
const Integrations = lazyPage(() => import('@/pages/integrations'));
const IntegrationDetail = lazyPage(() => import('@/pages/integrations/Detail'));
const MailPush = lazyPage(() => import('@/pages/mail-push'));
/** V4.1：「邮件推送 · 数据项目」由右侧抽屉改为独立页面 */
const MailPushProject = lazyPage(() => import('@/pages/mail-push/Project'));
const Flows = lazyPage(() => import('@/pages/flows'));
const FlowDesign = lazyPage(() => import('@/pages/flows/Design'));
const FlowLogs = lazyPage(() => import('@/pages/flows/Logs'));
const Datasources = lazyPage(() => import('@/pages/datasources'));
const Datasets = lazyPage(() => import('@/pages/datasets'));
const Reports = lazyPage(() => import('@/pages/reports'));
const ReportDesign = lazyPage(() => import('@/pages/reports/Design'));
const ReportView = lazyPage(() => import('@/pages/reports/View'));
const Shares = lazyPage(() => import('@/pages/shares'));
const AI = lazyPage(() => import('@/pages/ai'));
const Governance = lazyPage(() => import('@/pages/governance'));
const Audit = lazyPage(() => import('@/pages/audit'));
const Users = lazyPage(() => import('@/pages/users'));
const Roles = lazyPage(() => import('@/pages/roles'));
const Settings = lazyPage(() => import('@/pages/settings'));
const Intro = lazyPage(() => import('@/pages/intro'));
const Help = lazyPage(() => import('@/pages/help'));
const Profile = lazyPage(() => import('@/pages/profile'));

const Loading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 320 }}>
    <Spin size="large" description="加载中..." />
  </div>
);

/** 登录守卫 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAppStore();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }
  return <>{children}</>;
}

/**
 * 公开页外壳：不需要登录，但登录后进入时应能看到顶部导航方便返回平台。
 * 未登录时只渲染内容本身（宣传页自带页脚与 CTA）。
 */
function PublicShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAppStore();
  if (loading) return <Loading />;
  if (!user) return <>{children}</>;
  return <BasicLayout>{children}</BasicLayout>;
}

export default function App() {
  const { fetchUser, loading, setUser } = useAppStore();
  const location = useLocation();

  useEffect(() => {
    // 这些路由完全不需要用户态，避免多余 401 请求
    if (PUBLIC_ROUTES.some((p) => location.pathname.startsWith(p))) return;
    /*
     * V8：/s/ 、/f/ 、/a/ 前缀一律**不探测登录态**。
     * /a/ 是 AI 问数公开分享页 —— 未登录访客（手机扫码/微信打开）若触发 fetchUser()
     * 会打 401，虽然 store 会吞掉，但会白耗一次请求并可能触发全局未授权处理，
     * 因此在路由层就短路，保证「打开网址即可问数」。
     */
    if (PUBLIC_PREFIXES.some((p) => location.pathname.startsWith(p))) return;

    /*
     * /intro 与 /help 允许未登录访问，但仍需探测登录态：
     * 已登录 → 套上后台布局（带侧边栏，方便返回平台）
     * 未登录 → 仅渲染内容本身
     * 探测失败（401）时 store 内部会把 user 置空，页面照常展示。
     */
    fetchUser();
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
  }, [setUser]);

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        {/* 公开路由 */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/s/:token" element={<ShareView />} />
        <Route path="/f/:token" element={<PublicForm />} />
        {/* V8：AI 问数公开分享 —— 独立布局（不套 BasicLayout / RequireAuth），手机优先 */}
        <Route path="/a/:token" element={<AiShare />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* 公开访问的业务页：宣传页与帮助文档需允许未登录浏览，
            否则无法把链接直接发给客户了解产品 */}
        <Route
          path="/intro"
          element={
            <PublicShell>
              <Intro />
            </PublicShell>
          }
        />
        <Route
          path="/help"
          element={
            <PublicShell>
              <Help />
            </PublicShell>
          }
        />

        {/* 业务路由 */}
        <Route
          path="*"
          element={
            <RequireAuth>
              <BasicLayout>
                <Routes>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/dashboard/board" element={<Board />} />
                  <Route path="/dashboard/crm" element={<CrmDashboard />} />
                  <Route path="/projects" element={<Projects />} />
                  <Route path="/projects/:id" element={<ProjectDetail />} />
                  <Route path="/projects/:id/fields" element={<ProjectFields />} />
                  <Route path="/forms" element={<Forms />} />
                  <Route path="/forms/:id/design" element={<FormDesign />} />
                  <Route path="/forms/:id/data" element={<FormData />} />
                  <Route path="/integrations" element={<Integrations />} />
                  <Route path="/integrations/:id" element={<IntegrationDetail />} />
                  <Route path="/mail-push" element={<MailPush />} />
                  <Route path="/mail-push/projects/:id" element={<MailPushProject />} />
                  <Route path="/flows" element={<Flows />} />
                  <Route path="/flows/:id/design" element={<FlowDesign />} />
                  <Route path="/flows/:id/logs" element={<FlowLogs />} />
                  <Route path="/datasources" element={<Datasources />} />
                  <Route path="/datasets" element={<Datasets />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/reports/:id/design" element={<ReportDesign />} />
                  <Route path="/reports/:id/view" element={<ReportView />} />
                  <Route path="/shares" element={<Shares />} />
                  <Route path="/ai" element={<AI />} />
                  <Route path="/governance" element={<Governance />} />
                  <Route path="/audit" element={<Audit />} />
                  <Route path="/users" element={<Users />} />
                  <Route path="/roles" element={<Roles />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/intro" element={<Intro />} />
                  <Route path="/help" element={<Help />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
              </BasicLayout>
            </RequireAuth>
          }
        />
      </Routes>
    </Suspense>
  );
}
