/** 系统设置：按后端 GROUPS 元数据动态渲染表单（10 个分组 / 10 种字段类型） */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, ColorPicker, Empty, Form, Grid, Input, InputNumber, Modal,
  Row, Select, Skeleton, Space, Switch, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  BellOutlined, CloudServerOutlined, DatabaseOutlined, ExperimentOutlined, MailOutlined,
  ReloadOutlined, RobotOutlined, SafetyCertificateOutlined, SaveOutlined, SendOutlined,
  SettingOutlined, ShopOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import Page from '@/components/Page';
import type { StatCardItem } from '@/components/StatCards';
import { useAppStore, usePermission } from '@/stores/app';
import {
  getSettings, isOn, listAiProviders, listDatasourceOptions, saveSettings, testAi, testMail,
} from '@/api/settings';
import type { AiProvider, DatasourceOption, SettingField, SettingGroup, SettingsPayload } from '@/api/settings';
import { PALETTE, NEUTRAL, STAT_COLORS } from '@/theme';

const { Text } = Typography;
const { useBreakpoint } = Grid;

/** 语义色别名（基于 @/theme 令牌，保持命名兼容） */
const C = {
  primary: PALETTE.primary,
  blue: PALETTE.primary,
  navy: NEUTRAL.text,
  cyan: PALETTE.cyan,
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

/** 主题色预设（ColorPicker 品牌调色板，基于设计令牌） */
const PALETTE_PRESET = [PALETTE.primary, PALETTE.primaryDeep, PALETTE.primaryLight, PALETTE.cyan, PALETTE.green, PALETTE.yellow, PALETTE.orange, PALETTE.violet, NEUTRAL.text];

/** 分组图标（后端下发字符图标，映射为 antd 图标，保证视觉一致） */
const GROUP_ICONS: Record<string, React.ReactNode> = {
  site: <ShopOutlined />,
  security: <SafetyCertificateOutlined />,
  smtp: <MailOutlined />,
  storage: <DatabaseOutlined />,
  push: <CloudServerOutlined />,
  report: <ExperimentOutlined />,
  integration: <SettingOutlined />,
  ai: <RobotOutlined />,
  mailpush: <BellOutlined />,
  audit: <SafetyCertificateOutlined />,
};

/** 设置值 → 表单值 */
function toFormValues(group: SettingGroup, values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of group.fields) {
    const raw = values[f.key];
    if (f.type === 'switch') {
      out[f.key] = isOn(raw);
    } else if (f.type === 'number') {
      const n = Number(raw);
      out[f.key] = raw === '' || raw === undefined || raw === null || !Number.isFinite(n) ? undefined : n;
    } else if (f.type === 'datasource') {
      out[f.key] = raw === '' || raw === undefined || raw === null ? undefined : Number(raw);
    } else {
      out[f.key] = raw ?? '';
    }
  }
  return out;
}

/** 表单值 → 提交值（后端统一按字符串存储） */
function toSubmitValues(group: SettingGroup, v: Record<string, unknown>): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const f of group.fields) {
    const val = v[f.key];
    if (f.type === 'password') {
      // 留空表示不修改（后端对 SECRET_KEYS 空值直接跳过）
      if (val) patch[f.key] = String(val);
      continue;
    }
    if (f.type === 'switch') {
      patch[f.key] = val ? '1' : '0';
      continue;
    }
    if (f.type === 'number') {
      patch[f.key] = val === undefined || val === null || val === '' ? '' : String(val);
      continue;
    }
    if (f.type === 'datasource') {
      patch[f.key] = val === undefined || val === null ? '0' : String(val);
      continue;
    }
    patch[f.key] = val === undefined || val === null ? '' : String(val);
  }
  return patch;
}

export default function SettingsPage() {
  const can = usePermission();
  const setThemeColor = useAppStore((s) => s.setThemeColor);
  // 订阅 user：登录态就绪后需要重新计算权限（can 是稳定引用，单独订阅不会触发重渲染）
  const user = useAppStore((s) => s.user);
  const canWrite = !!user && can('settings:write');
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [form] = Form.useForm();
  const [mailForm] = Form.useForm();

  const [payload, setPayload] = useState<SettingsPayload | null>(null);
  const [groups, setGroups] = useState<SettingGroup[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [mailReady, setMailReady] = useState(false);
  const [activeKey, setActiveKey] = useState('site');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [datasources, setDatasources] = useState<DatasourceOption[]>([]);

  const aiProviderWatched = Form.useWatch('ai_provider', form) as string | undefined;

  const activeGroup = useMemo(() => groups.find((g) => g.key === activeKey) || null, [groups, activeKey]);
  const initialValues = useMemo(
    () => (activeGroup ? toFormValues(activeGroup, values) : {}),
    [activeGroup, values]
  );

  const currentProvider = useMemo(
    () =>
      providers.find((p) => p.key === (aiProviderWatched || values.ai_provider)) ||
      providers[0] ||
      null,
    [providers, aiProviderWatched, values.ai_provider]
  );

  const modelOptions = useMemo(
    () => (currentProvider?.models || []).map((m) => ({ label: m.name, value: m.key })),
    [currentProvider]
  );

  /* ── 状态卡片（就地由已加载的 values 计算，不新增接口） ── */
  const aiConfigured = isOn(values.ai_enabled) && values.ai_api_key__set === '1';
  const dbConfigured = !!values.default_datasource_id && String(values.default_datasource_id) !== '0' && values.default_datasource_id !== '';
  const stats = useMemo<StatCardItem[]>(() => [
    {
      key: 'site',
      label: '当前站点名',
      value: values.site_name || '未设置',
      color: STAT_COLORS[0],
    },
    {
      key: 'mail',
      label: '邮件服务',
      value: mailReady ? '已就绪' : '未配置',
      color: mailReady ? PALETTE.green : NEUTRAL.textTertiary,
    },
    {
      key: 'ai',
      label: 'AI 问数',
      value: aiConfigured ? '已配置' : '未配置',
      color: aiConfigured ? PALETTE.cyan : NEUTRAL.textTertiary,
    },
    {
      key: 'db',
      label: '默认数据源',
      value: dbConfigured ? '已连接' : '未配置',
      color: dbConfigured ? PALETTE.green : NEUTRAL.textTertiary,
    },
  ], [values.site_name, mailReady, aiConfigured, dbConfigured]);

  /** 拉取设置 + 供应商 + 数据源 */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSettings();
      setPayload(data);
      setGroups(data.groups);
      setValues(data.values);
      setMailReady(data.mailReady);
      setActiveKey((prev) => (data.groups.some((g) => g.key === prev) ? prev : data.groups[0]?.key || 'site'));
    } catch {
      /* client 已提示 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void (async () => {
      const [ps, ds] = await Promise.all([
        listAiProviders().catch(() => [] as AiProvider[]),
        listDatasourceOptions(),
      ]);
      setProviders(ps);
      setDatasources(ds);
    })();
  }, [load]);

  /** AI 供应商切换：自动填充接口地址与默认模型 */
  const onValuesChange = (changed: Record<string, unknown>) => {
    if (activeGroup?.key === 'ai' && 'ai_provider' in changed) {
      const p = providers.find((x) => x.key === changed.ai_provider);
      if (!p) return;
      const patch: Record<string, unknown> = {};
      if (p.baseUrl && !p.custom) patch.ai_base_url = p.baseUrl;
      const def = (p.models || []).find((m) => m.default) || (p.models || [])[0];
      if (def) patch.ai_model = def.key;
      if (Object.keys(patch).length) form.setFieldsValue(patch);
    }
  };

  const save = async () => {
    if (!activeGroup || !canWrite) return;
    let v: Record<string, unknown>;
    try {
      v = await form.validateFields();
    } catch {
      return;
    }
    const patch = toSubmitValues(activeGroup, v);
    if (!Object.keys(patch).length) {
      message.info('该分组没有可保存的设置项');
      return;
    }
    setSaving(true);
    try {
      await saveSettings(patch);
      message.success(`「${activeGroup.title}」已保存`);
      const data = await getSettings();
      setPayload(data);
      setGroups(data.groups);
      setValues(data.values);
      setMailReady(data.mailReady);
      const nextGroup = data.groups.find((g) => g.key === activeKey);
      if (nextGroup) form.setFieldsValue(toFormValues(nextGroup, data.values));
      if (patch.theme_color) setThemeColor(patch.theme_color);
    } catch {
      /* client 已提示 */
    } finally {
      setSaving(false);
    }
  };

  const doTestMail = async () => {
    let v: { to: string };
    try {
      v = await mailForm.validateFields();
    } catch {
      return;
    }
    setTesting(true);
    try {
      await testMail(v.to.trim());
      message.success(`测试邮件已发送至 ${v.to.trim()}`);
      setMailOpen(false);
      mailForm.resetFields();
    } catch {
      /* client 已提示 */
    } finally {
      setTesting(false);
    }
  };

  const doTestAi = async () => {
    setTesting(true);
    try {
      const r = await testAi();
      if (r && r.ok === false) {
        message.error(r.message || 'AI 连接失败');
      } else {
        message.success((r && r.message) || 'AI 连接成功');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'AI 连接失败，请检查接口地址与密钥');
    } finally {
      setTesting(false);
    }
  };

  /* ---------- 单个字段渲染 ---------- */
  const renderField = (f: SettingField) => {
    const disabled = !canWrite;
    const isSet = values[`${f.key}__set`] === '1';
    let control: React.ReactNode;

    switch (f.type) {
      case 'switch':
        control = (
          <Switch
            checkedChildren="开启"
            unCheckedChildren="关闭"
            disabled={disabled}
            style={{ minWidth: 64 }}
          />
        );
        break;
      case 'number':
        control = (
          <InputNumber
            min={f.min}
            max={f.max}
            placeholder={f.placeholder}
            disabled={disabled}
            style={{ width: '100%' }}
          />
        );
        break;
      case 'password':
        control = (
          <Input.Password
            placeholder={isSet ? '已设置（留空表示不修改）' : f.placeholder || '请输入'}
            autoComplete="new-password"
            disabled={disabled}
          />
        );
        break;
      case 'select':
        control = (
          <Select
            options={(f.options || []).map((o) => ({ label: o.label, value: o.value }))}
            disabled={disabled}
            placeholder={f.placeholder || '请选择'}
          />
        );
        break;
      case 'color':
        control = (
          <ColorPicker
            showText
            format="hex"
            disabledAlpha
            disabled={disabled}
            presets={[{ label: '品牌调色板', colors: PALETTE_PRESET }]}
          />
        );
        break;
      case 'textarea':
        control = (
          <Input.TextArea rows={3} placeholder={f.placeholder} disabled={disabled} maxLength={500} showCount />
        );
        break;
      case 'datasource':
        control = (
          <Select
            disabled={disabled}
            placeholder="选择数据源"
            options={datasources.map((d) => ({ label: `${d.name}（${d.type}）`, value: d.id }))}
            notFoundContent={<Text style={{ fontSize: 12, color: C.gray }}>暂无可用数据源</Text>}
          />
        );
        break;
      case 'aiprovider':
        control = (
          <Select
            disabled={disabled}
            placeholder="选择模型供应商"
            options={providers.map((p) => ({ label: p.name, value: p.key }))}
            optionRender={(opt) => {
              const p = providers.find((x) => x.key === opt.value);
              return (
                <div style={{ padding: '2px 0' }}>
                  <div style={{ fontSize: 13, color: C.navy }}>{opt.label}</div>
                  {p?.note ? <div style={{ fontSize: 11.5, color: C.gray }}>{p.note}</div> : null}
                </div>
              );
            }}
          />
        );
        break;
      case 'aimodel':
        control = modelOptions.length ? (
          <Select
            disabled={disabled}
            placeholder="选择模型"
            options={modelOptions}
            showSearch
            optionFilterProp="label"
          />
        ) : (
          <Input placeholder={f.placeholder || '填写模型名称，例如 deepseek-chat'} disabled={disabled} />
        );
        break;
      default:
        control = <Input placeholder={f.placeholder} disabled={disabled} maxLength={500} />;
        break;
    }

    const extra: React.ReactNode = (
      <div style={{ fontSize: 11.5, color: C.gray, lineHeight: 1.6 }}>
        {f.hint ? <div>{f.hint}</div> : null}
        {f.key === 'site_name' ? (
          <div style={{ marginTop: 2, color: NEUTRAL.textSecondary }}>
            保存后，左侧菜单顶部的品牌区会同步更新。
          </div>
        ) : null}
        {f.type === 'password' && isSet ? (
          <Tag style={{ ...softStyle(PALETTE.green), marginTop: 4 }}>已设置</Tag>
        ) : null}
        {f.type === 'aiprovider' && currentProvider?.keyUrl ? (
          <div style={{ marginTop: 2 }}>
            <a href={currentProvider.keyUrl} target="_blank" rel="noopener noreferrer">
              获取 API Key →
            </a>
          </div>
        ) : null}
        {f.type === 'aiprovider' && currentProvider?.note ? (
          <div style={{ marginTop: 2 }}>{currentProvider.note}</div>
        ) : null}
      </div>
    );

    const wide = f.type === 'textarea' || f.type === 'text';

    return (
      <Col key={f.key} xs={24} md={wide && f.type === 'textarea' ? 24 : 12}>
        <Form.Item
          name={f.key}
          label={<span style={{ fontSize: 12.5, color: C.navy, fontWeight: 500 }}>{f.label}</span>}
          tooltip={
            f.type === 'password'
              ? '敏感信息，读取时已脱敏；留空表示不修改'
              : f.type === 'color'
                ? '主题色会应用到按钮、链接与高亮色'
                : undefined
          }
          extra={extra}
          valuePropName={f.type === 'switch' ? 'checked' : 'value'}
          normalize={
            f.type === 'color'
              ? (v: unknown) =>
                  typeof v === 'string'
                    ? v
                    : v && typeof (v as { toHexString?: () => string }).toHexString === 'function'
                      ? (v as { toHexString: () => string }).toHexString()
                      : ''
              : undefined
          }
          style={{ marginBottom: 14 }}
        >
          {control}
        </Form.Item>
      </Col>
    );
  };

  /* ---------- 分组导航 ---------- */
  const groupBadge = (g: SettingGroup): React.ReactNode => {
    if (g.key === 'smtp' && mailReady) return <Tag style={softStyle(PALETTE.green)}>已配置</Tag>;
    if (g.key === 'ai' && isOn(values.ai_enabled)) return <Tag style={softStyle(PALETTE.primary)}>已启用</Tag>;
    if (g.key === 'mailpush' && isOn(values.mail_push_enabled)) return <Tag style={softStyle(PALETTE.primary)}>已启用</Tag>;
    if (g.key === 'audit' && isOn(values.audit_enabled)) return <Tag style={softStyle(C.gray)}>记录中</Tag>;
    return <Tag style={softStyle(C.gray)}>{g.fields.length}</Tag>;
  };

  const groupNav = (g: SettingGroup) => {
    const on = g.key === activeKey;
    return (
      <div
        key={g.key}
        data-group={g.key}
        onClick={() => setActiveKey(g.key)}
        style={{
          cursor: 'pointer',
          padding: '9px 11px',
          borderRadius: 8,
          border: `1px solid ${on ? C.primary : 'transparent'}`,
          background: on ? NEUTRAL.surfaceSunken : 'transparent',
          transition: 'all .15s',
          minWidth: isMobile ? 132 : undefined,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: on ? C.primary : C.gray, fontSize: 15 }}>{GROUP_ICONS[g.key] || <SettingOutlined />}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: on ? 600 : 500, color: on ? C.blue : C.navy }}>{g.title}</div>
            {!isMobile ? (
              <div
                style={{
                  fontSize: 11,
                  color: C.gray,
                  lineHeight: 1.4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {g.desc}
              </div>
            ) : null}
          </div>
          {!isMobile ? groupBadge(g) : null}
        </div>
      </div>
    );
  };

  const navCard = (
    <Card
      size="small"
      title={
        <Space size={6}>
          <SettingOutlined style={{ color: C.primary }} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: C.navy }}>设置分组</span>
          <Tag style={softStyle(C.blue)}>{groups.length}</Tag>
        </Space>
      }
      styles={{ body: { padding: 8 } }}
      style={{ borderColor: C.line }}
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <Space orientation="vertical" size={4} style={{ width: '100%' }}>
          {groups.map(groupNav)}
        </Space>
      )}
    </Card>
  );

  /* ---------- 表单面板 ---------- */
  const formPanel = (
    <Card
      size="small"
      style={{ borderColor: C.line }}
      title={
        <Space size={8} wrap>
          <span style={{ color: C.primary, fontSize: 15 }}>
            {activeGroup ? GROUP_ICONS[activeGroup.key] || <SettingOutlined /> : <SettingOutlined />}
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: C.navy }}>
            {activeGroup?.title || '系统设置'}
          </span>
          {activeGroup?.desc ? (
            <Text style={{ fontSize: 11.5, color: C.gray }}>{activeGroup.desc}</Text>
          ) : null}
        </Space>
      }
      extra={
        <Space size={6} wrap>
          {activeGroup?.key === 'smtp' ? (
            <Button size="small" icon={<SendOutlined />} onClick={() => setMailOpen(true)} disabled={!mailReady}>
              发送测试邮件
            </Button>
          ) : null}
          {activeGroup?.key === 'ai' ? (
            <Button size="small" icon={<ExperimentOutlined />} loading={testing} onClick={doTestAi}>
              测试 AI 连接
            </Button>
          ) : null}
          {activeGroup?.key === 'storage' ? (
            <Button size="small" icon={<DatabaseOutlined />} onClick={() => navigate('/datasources')}>
              管理数据源
            </Button>
          ) : null}
          <Button onClick={() => void load()} icon={<ReloadOutlined />} size="small">
            重新读取
          </Button>
          {canWrite ? (
            <Button type="primary" size="small" icon={<SaveOutlined />} loading={saving} onClick={save}>
              保存本组
            </Button>
          ) : null}
        </Space>
      }
    >
      {!canWrite ? (
        <Alert
          type="warning"
          showIcon
          title="当前账号没有「修改系统设置」权限，仅可查看配置"
          style={{ marginBottom: 14 }}
        />
      ) : null}

      {loading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : !activeGroup ? (
        <Empty description="没有可编辑的设置分组" />
      ) : (
        <>
          {activeGroup.key === 'ai' ? (
            <Alert
              type="info"
              showIcon
              title="选择供应商后会自动填充接口地址与默认模型，通常只需填入 API Key 即可使用"
              style={{ marginBottom: 14 }}
            />
          ) : null}
          {activeGroup.key === 'security' ? (
            <Alert
              type="warning"
              showIcon
              title="安全策略修改后对下一次登录/请求生效；修改密码最小长度不会影响已有密码"
              style={{ marginBottom: 14 }}
            />
          ) : null}
          <Form
            key={activeGroup.key}
            form={form}
            layout="vertical"
            initialValues={initialValues}
            onValuesChange={onValuesChange}
            requiredMark={false}
            size={isMobile ? 'large' : 'middle'}
            disabled={!canWrite}
          >
            <Row gutter={[16, 0]}>{activeGroup.fields.map(renderField)}</Row>
          </Form>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <Button
              onClick={() => form.setFieldsValue(initialValues)}
              disabled={saving || !canWrite}
            >
              重置
            </Button>
            {canWrite ? (
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
                保存「{activeGroup.title}」
              </Button>
            ) : null}
          </div>
        </>
      )}
    </Card>
  );

  return (
    <Page title="系统设置" stats={stats}>
      {isMobile ? (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Card size="small" style={{ borderColor: C.line }} styles={{ body: { padding: 8 } }}>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {groups.map((g) => {
                const on = g.key === activeKey;
                return (
                  <div
                    key={g.key}
                    data-group={g.key}
                    onClick={() => setActiveKey(g.key)}
                    style={{
                      flex: '0 0 auto',
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: `1px solid ${on ? C.primary : C.line}`,
                      background: on ? NEUTRAL.surfaceSunken : NEUTRAL.surface,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      minHeight: 44,
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ color: on ? C.primary : C.gray, fontSize: 14 }}>
                      {GROUP_ICONS[g.key] || <SettingOutlined />}
                    </span>
                    <span style={{ fontSize: 13, color: on ? C.blue : C.navy, fontWeight: on ? 600 : 500 }}>
                      {g.title}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
          {formPanel}
        </Space>
      ) : (
        <Row gutter={12}>
          <Col span={7} xl={6} xxl={5}>
            {navCard}
          </Col>
          <Col span={17} xl={18} xxl={19}>
            {formPanel}
          </Col>
        </Row>
      )}

      {/* 测试邮件 */}
      <Modal
        title="发送测试邮件"
        open={mailOpen}
        onCancel={() => setMailOpen(false)}
        onOk={doTestMail}
        okText="发送"
        cancelText="取消"
        confirmLoading={testing}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          title="将使用当前保存的 SMTP 配置发送一封测试邮件，请先保存邮件服务配置。"
          style={{ marginBottom: 14 }}
        />
        <Form form={mailForm} layout="vertical" requiredMark={false} initialValues={{ to: user?.email || '' }}>
          <Form.Item
            name="to"
            label="收件邮箱"
            rules={[
              { required: true, message: '请填写收件邮箱' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
          >
            <Input placeholder="name@example.com" />
          </Form.Item>
        </Form>
      </Modal>
    </Page>
  );
}