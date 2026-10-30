/** 公开表单填写：移动端优先，antd-mobile 组件，提交后展示成功页 */
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Button, Checkbox, DatePicker, Divider, ErrorBlock, Form, Input, List, Picker,
  Radio, Rate, Result, Slider, TextArea, Toast,
} from 'antd-mobile';
import { formsApi } from '@/api/forms';
import type {
  ExamResult, FormField, FormFlowInfo, PublicFormSchema, PublicSubmitResult,
} from '@/api/forms';

/** 调色板（契约唯一允许的 13 色） */
const C = {
  primary: '#3687FF',
  blue: '#2D6FE4',
  deep: '#003378',
  cyan: '#45B4FF',
  green: '#A2D73C',
  orange: '#EC673C',
  red: '#E86161',
  yellow: '#FFC000',
  gray: '#B5B5B6',
  line: '#DCDDDD',
};

type Phase = 'loading' | 'ready' | 'error' | 'done';

const FORM_TYPE_NAME: Record<string, string> = {
  fill: '填写表单',
  flow: '流程表单',
  exam: '考试表单',
};

/* ══════════════ 移动端自定义控件（适配 antd-mobile Form.Item 的 value/onChange） ══════════════ */

const pad = (n: number) => String(n).padStart(2, '0');

function formatDateValue(d: Date, mode: 'date' | 'datetime' | 'time'): string {
  if (mode === 'time') return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (mode === 'date') return date;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseDateValue(v: string | null | undefined, mode: 'date' | 'datetime' | 'time'): Date | null {
  if (!v) return null;
  if (mode === 'time') {
    const m = /^(\d{1,2}):(\d{1,2})$/.exec(v);
    if (!m) return null;
    const d = new Date();
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return d;
  }
  const d = new Date(v.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

interface PickerInputProps {
  value?: string | null;
  onChange?: (v: string) => void;
  options?: string[];
  placeholder?: string;
}

/** 下拉选择（Picker 自定义触发器） */
function PickerInput({ value, onChange, options = [], placeholder }: PickerInputProps) {
  return (
    <Picker
      columns={[options.map((o) => ({ label: o, value: o }))]}
      value={value ? [value] : []}
      onConfirm={(v) => onChange?.(String(v[0] ?? ''))}
      title="请选择"
    >
      {(_items, actions) => (
        <div
          onClick={actions.open}
          style={{
            minHeight: 24,
            color: value ? C.deep : C.gray,
            fontSize: 15,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{value || placeholder || '请选择'}</span>
          <span style={{ color: C.gray, fontSize: 12 }}>▾</span>
        </div>
      )}
    </Picker>
  );
}

interface DateInputProps {
  value?: string | null;
  onChange?: (v: string) => void;
  mode?: 'date' | 'datetime' | 'time';
  placeholder?: string;
  title?: string;
}

/** 日期 / 日期时间 / 时间选择 */
function DateInput({ value, onChange, mode = 'date', placeholder, title }: DateInputProps) {
  const precision = mode === 'date' ? 'day' : 'minute';
  return (
    <DatePicker
      precision={precision}
      value={parseDateValue(value, mode)}
      onConfirm={(d) => onChange?.(formatDateValue(d, mode))}
      title={title || '请选择'}
    >
      {(_v, actions) => (
        <div
          onClick={actions.open}
          style={{
            minHeight: 24,
            color: value ? C.deep : C.gray,
            fontSize: 15,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{value || placeholder || '请选择'}</span>
          <span style={{ color: C.gray, fontSize: 12 }}>▦</span>
        </div>
      )}
    </DatePicker>
  );
}

interface DateRangeProps {
  value?: string[];
  onChange?: (v: string[]) => void;
}

/** 日期区间：两个触发器，提交为 ['起始','结束'] */
function DateRangeInput({ value, onChange }: DateRangeProps) {
  const arr = Array.isArray(value) ? value : [];
  const setPart = (idx: 0 | 1, v: string) => {
    const next: string[] = [arr[0] || '', arr[1] || ''];
    next[idx] = v;
    onChange?.(next.filter(Boolean));
  };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <div style={{ flex: 1, border: `1px solid ${C.line}`, borderRadius: 8, padding: '7px 10px' }}>
        <DateInput value={arr[0]} onChange={(v) => setPart(0, v)} placeholder="开始日期" title="开始日期" />
      </div>
      <span style={{ color: C.gray }}>~</span>
      <div style={{ flex: 1, border: `1px solid ${C.line}`, borderRadius: 8, padding: '7px 10px' }}>
        <DateInput value={arr[1]} onChange={(v) => setPart(1, v)} placeholder="结束日期" title="结束日期" />
      </div>
    </div>
  );
}

/* ══════════════ 页面 ══════════════ */

export default function PublicFormPage() {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>('loading');
  const [schema, setSchema] = useState<PublicFormSchema | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);
  const [result, setResult] = useState<PublicSubmitResult | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    if (!token) {
      setPhase('error');
      setErrorMsg('缺少表单令牌');
      return;
    }
    let alive = true;
    (async () => {
      try {
        const data = await formsApi.publicSchema(token);
        if (!alive) return;
        setSchema(data);
        setPhase('ready');
        document.title = data.name || '表单填写';
      } catch (e) {
        if (!alive) return;
        setErrorMsg(e instanceof Error ? e.message : '表单加载失败');
        setPhase('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const inputFields = useMemo(
    () => (schema?.fields || []).filter((f) => f.type !== 'divider' && f.type !== 'section'),
    [schema]
  );

  const initialValues = useMemo(() => {
    const out: Record<string, unknown> = {};
    inputFields.forEach((f) => {
      if (f.type === 'checkbox' || f.type === 'daterange') return;
      const v = f.defaultValue;
      if (v !== undefined && v !== null && v !== '') out[f.key] = v;
    });
    return out;
  }, [inputFields]);

  const onSubmit = async (values: Record<string, unknown>) => {
    if (!token) return;
    setSubmitting(true);
    setSubmitErrors([]);
    try {
      const payload: Record<string, unknown> = {};
      inputFields.forEach((f) => {
        const v = values[f.key];
        if (v === undefined || v === null || v === '') return;
        payload[f.key] = v;
      });
      const res = await formsApi.publicSubmit(token, payload);
      setResult(res);
      setPhase('done');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      const err = e as Error & { errors?: string[] };
      const list = err.errors?.length ? err.errors : [err.message || '提交失败，请稍后重试'];
      setSubmitErrors(list);
      Toast.show({ content: list[0], position: 'top' });
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- 字段控件 ---------- */
  const renderControl = (f: FormField) => {
    const placeholder = f.placeholder || `请输入${f.label}`;
    switch (f.type) {
      case 'textarea':
        return <TextArea placeholder={placeholder} rows={3} maxLength={2000} showCount />;
      case 'number':
      case 'amount':
      case 'percent':
        return (
          <Input
            type="number"
            inputMode="decimal"
            placeholder={placeholder}
            style={{ '--text-align': 'left' } as React.CSSProperties}
          />
        );
      case 'select':
        return <PickerInput options={f.options || []} placeholder={placeholder} />;
      case 'radio':
        return (
          <Radio.Group>
            <div
              style={{
                display: 'flex',
                flexDirection: f.optionLayout === 'vertical' ? 'column' : 'row',
                flexWrap: 'wrap',
                gap: f.optionLayout === 'vertical' ? 8 : 14,
                paddingTop: 4,
              }}
            >
              {(f.options || []).map((o) => (
                <Radio key={o} value={o}>
                  {o}
                </Radio>
              ))}
            </div>
          </Radio.Group>
        );
      case 'checkbox':
        return (
          <Checkbox.Group>
            <div
              style={{
                display: 'flex',
                flexDirection: f.optionLayout === 'vertical' ? 'column' : 'row',
                flexWrap: 'wrap',
                gap: f.optionLayout === 'vertical' ? 8 : 14,
                paddingTop: 4,
              }}
            >
              {(f.options || []).map((o) => (
                <Checkbox key={o} value={o}>
                  {o}
                </Checkbox>
              ))}
            </div>
          </Checkbox.Group>
        );
      case 'date':
        return <DateInput placeholder={placeholder} mode="date" />;
      case 'datetime':
        return <DateInput placeholder={placeholder} mode="datetime" />;
      case 'time':
        return <DateInput placeholder={placeholder} mode="time" />;
      case 'daterange':
        return <DateRangeInput />;
      case 'rating':
        return (
          <div style={{ paddingTop: 4 }}>
            <Rate count={Number(f.max) > 0 ? Number(f.max) : 5} />
          </div>
        );
      case 'slider':
        return (
          <div style={{ paddingTop: 4 }}>
            <Slider min={f.min ?? 0} max={f.max ?? 100} />
          </div>
        );
      case 'formula':
        return <div style={{ color: C.gray, fontSize: 14 }}>该项由系统自动计算</div>;
      case 'image':
      case 'file':
        return <Input placeholder={f.type === 'image' ? '请粘贴图片链接' : '请粘贴附件链接'} />;
      case 'table':
        return <TextArea placeholder='请填写 JSON 数组，例如 [{"名称":"A"}]' rows={3} />;
      case 'member':
        return <Input placeholder={f.placeholder || '请输入成员姓名'} />;
      case 'department':
        return <Input placeholder={f.placeholder || '请输入部门名称'} />;
      case 'address':
        return <Input placeholder={f.placeholder || '请输入详细地址'} />;
      case 'location':
        return <Input placeholder={f.placeholder || '请输入定位坐标或地址'} />;
      default:
        return <Input placeholder={placeholder} />;
    }
  };

  /* ---------- 加载 / 错误 ---------- */
  if (phase === 'loading') {
    return (
      <div style={pageStyle}>
        <div style={{ padding: 60, textAlign: 'center', color: C.gray }}>表单加载中…</div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div style={pageStyle}>
        <div style={{ padding: '40px 16px' }}>
          <ErrorBlock status="empty" title="无法打开该表单" description={errorMsg} />
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <Button color="primary" fill="outline" onClick={() => window.location.reload()}>
              重新加载
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'done' && result) {
    return (
      <div style={pageStyle}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '16px 16px 40px' }}>
          <Result
            status="success"
            title="提交成功"
            description={schema?.settings?.successMessage || result.message || '感谢您的填写！'}
          />

          <List header="提交信息" style={{ borderRadius: 12, overflow: 'hidden' }}>
            <List.Item extra={String(result.recordId)}>提交编号</List.Item>
            <List.Item extra={schema?.name || '-'}>表单名称</List.Item>
            <List.Item extra={FORM_TYPE_NAME[result.formType] || result.formType}>表单类型</List.Item>
          </List>

          {result.examResult && <ExamResultCard exam={result.examResult} />}
          {result.flowInfo && <FlowInfoCard flow={result.flowInfo} />}

          {result.writeInfo && result.writeInfo.error && (
            <div
              style={{
                marginTop: 12, padding: 12, borderRadius: 10, background: '#FFFFFF',
                border: `1px solid ${C.yellow}`, color: C.orange, fontSize: 13,
              }}
            >
              数据已记录，但写入项目数据表失败：{result.writeInfo.error}
            </div>
          )}

          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Button block color="primary" size="large" onClick={() => window.location.reload()}>
              再填一份
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- 表单 ---------- */
  const settings = schema?.settings || {};
  const examDuration = Number(settings.examDuration || 0);

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 640, margin: '0 auto', paddingBottom: 32 }}>
        {/* 头部 */}
        <div
          style={{
            background: 'linear-gradient(135deg, #003378, #2D6FE4 55%, #3687FF)',
            color: '#FFFFFF',
            padding: '26px 18px 22px',
            borderBottomLeftRadius: 18,
            borderBottomRightRadius: 18,
          }}
        >
          <div
            style={{
              width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
              marginBottom: 12,
            }}
          >
            {settings.shareIcon || '▤'}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.35 }}>
            {schema?.name || '表单填写'}
          </div>
          {(schema?.description || settings.shareDesc) && (
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 6, lineHeight: 1.5 }}>
              {schema?.description || settings.shareDesc}
            </div>
          )}
          <div style={{ fontSize: 12, marginTop: 10, opacity: 0.75 }}>
            {FORM_TYPE_NAME[schema?.settings?.formType as string] || ''}
            {schema?.fields?.length ? `${schema.fields.length} 个字段` : ''}
            {examDuration > 0 ? ` · 限时 ${examDuration} 分钟` : ''}
          </div>
        </div>

        <div style={{ padding: '14px 12px 0' }}>
          {submitErrors.length > 0 && (
            <div
              style={{
                marginBottom: 12, padding: '10px 12px', borderRadius: 10, background: '#FFFFFF',
                border: `1px solid ${C.red}`, color: C.red, fontSize: 13,
              }}
            >
              {submitErrors.map((msg, i) => (
                <div key={`err-${i}`}>· {msg}</div>
              ))}
            </div>
          )}

          <Form
            form={form}
            layout="vertical"
            mode="card"
            initialValues={initialValues}
            onFinish={onSubmit}
            footer={
              <div style={{ padding: '4px 0 0' }}>
                <Button
                  block
                  type="submit"
                  color="primary"
                  size="large"
                  loading={submitting}
                  style={{ height: 48, borderRadius: 10, fontWeight: 600 }}
                >
                  提交
                </Button>
                <div style={{ textAlign: 'center', fontSize: 12, color: C.gray, marginTop: 10 }}>
                  提交即表示同意按本表单用途使用所填信息
                </div>
              </div>
            }
          >
            {(schema?.fields || []).map((f) => {
              if (f.type === 'divider') return <Divider key={f.key} />;
              if (f.type === 'section') {
                return (
                  <div
                    key={f.key}
                    style={{
                      fontWeight: 700, fontSize: 15, color: C.deep, padding: '6px 2px 10px',
                    }}
                  >
                    {f.label}
                  </div>
                );
              }
              return (
                <Form.Item
                  key={f.key}
                  name={f.key}
                  label={f.label}
                  required={!!f.required}
                  rules={
                    f.required
                      ? [{ required: true, message: `请填写${f.label}` }]
                      : undefined
                  }
                  description={f.hint || undefined}
                >
                  {renderControl(f)}
                </Form.Item>
              );
            })}
          </Form>
        </div>
      </div>
    </div>
  );
}

/* ══════════════ 结果卡片 ══════════════ */

function ExamResultCard({ exam }: { exam: ExamResult }) {
  return (
    <div
      style={{
        marginTop: 12, background: '#FFFFFF', border: `1px solid ${C.line}`,
        borderRadius: 12, padding: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.deep }}>考试成绩</span>
        <span style={{ fontSize: 22, fontWeight: 700, color: exam.passed ? C.green : C.red }}>
          {exam.earned}
        </span>
        <span style={{ fontSize: 13, color: C.gray }}>/ {exam.totalScore} 分</span>
        <span
          style={{
            marginLeft: 'auto', fontSize: 12, padding: '2px 8px', borderRadius: 999,
            color: exam.passed ? C.green : C.red,
            border: `1px solid ${exam.passed ? C.green : C.red}`,
          }}
        >
          {exam.passed ? '已通过' : '未通过'}
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: C.gray, marginTop: 6 }}>
        答对 {exam.correctCount}/{exam.questionCount} 题 · 得分率 {exam.percent}% · 及格线 {exam.passScore}%
      </div>
      <div style={{ marginTop: 10 }}>
        {exam.details.map((d) => (
          <div
            key={d.key}
            style={{
              display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0',
              borderTop: `1px solid ${C.line}`, fontSize: 13,
            }}
          >
            <span style={{ color: C.deep, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.label}
            </span>
            <span style={{ color: d.correct ? C.green : C.red, flexShrink: 0 }}>
              {d.correct ? `✓ +${d.score}` : `✗ 0/${d.score}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowInfoCard({ flow }: { flow: FormFlowInfo }) {
  return (
    <div
      style={{
        marginTop: 12, background: '#FFFFFF', border: `1px solid ${C.line}`,
        borderRadius: 12, padding: 14,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 700, color: C.deep }}>审批流程</div>
      <div style={{ fontSize: 12.5, color: C.gray, marginTop: 4 }}>
        已提交审批，共 {flow.totalSteps} 个节点，当前第 {flow.currentStep + 1} 步
      </div>
      <div style={{ marginTop: 10 }}>
        {flow.nodes.map((n) => (
          <div
            key={`${n.step}-${n.name}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0',
              borderTop: `1px solid ${C.line}`, fontSize: 13,
            }}
          >
            <span
              style={{
                width: 20, height: 20, borderRadius: 10, flexShrink: 0, fontSize: 11,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#FFFFFF',
                background: n.status === 'pending' ? C.primary : n.status === 'approved' ? C.green : C.gray,
              }}
            >
              {n.step}
            </span>
            <span style={{ color: C.deep, flex: 1, minWidth: 0 }}>{n.name}</span>
            <span style={{ fontSize: 12, color: C.gray }}>{n.approver || '待分配'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: '#FFFFFF',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
};
