/** 节点配置表单：按后端 fields schema 动态渲染 */
import React from 'react';
import { Input, InputNumber, Select, Switch } from 'antd';
import type { FlowNode, FlowNodeFieldDef } from '@/api/flows';
import { C } from './constants';
import type { OptionBundle } from './types';
import { NEUTRAL } from '@/theme';

export interface ConfigFormProps {
  node: FlowNode;
  fields: FlowNodeFieldDef[];
  options: OptionBundle;
  onChange: (key: string, value: unknown) => void;
}

const monoStyle: React.CSSProperties = {
  fontFamily: 'Consolas, Menlo, "Courier New", monospace',
  fontSize: 12.5,
};

function Placeholder(label: string, f: FlowNodeFieldDef): string {
  return f.placeholder || f.hint || `请输入${label}`;
}

export default function ConfigForm({ node, fields, options, onChange }: ConfigFormProps) {
  const valueOf = (key: string) => node.config?.[key];

  const renderControl = (f: FlowNodeFieldDef) => {
    const value = valueOf(f.key);
    switch (f.type) {
      case 'project':
        return (
          <Select
            style={{ width: '100%' }}
            showSearch
            optionFilterProp="label"
            allowClear
            placeholder="选择项目"
            value={
              value === undefined || value === null || value === 0 || value === ''
                ? undefined
                : (value as number)
            }
            options={options.project as { label: string; value: number }[]}
            onChange={(v) => onChange(f.key, v ?? null)}
          />
        );
      case 'datasource':
        return (
          <Select
            style={{ width: '100%' }}
            allowClear
            placeholder="选择数据源（本机 = 0）"
            value={value === undefined || value === null ? undefined : (value as number)}
            options={options.datasource as { label: string; value: number }[]}
            onChange={(v) => onChange(f.key, v ?? 0)}
          />
        );
      case 'form':
        return (
          <Select
            style={{ width: '100%' }}
            showSearch
            optionFilterProp="label"
            allowClear
            placeholder="选择表单"
            value={
              value === undefined || value === null || value === 0 || value === ''
                ? undefined
                : (value as number)
            }
            options={options.form as { label: string; value: number }[]}
            onChange={(v) => onChange(f.key, v ?? null)}
          />
        );
      case 'select':
        return (
          <Select
            style={{ width: '100%' }}
            value={value === undefined || value === null ? undefined : (value as string)}
            options={(f.options || []).map((o) => ({ label: o.label, value: o.value }))}
            onChange={(v) => onChange(f.key, v)}
          />
        );
      case 'number':
        return (
          <InputNumber
            style={{ width: '100%' }}
            value={value === undefined || value === null ? undefined : Number(value)}
            placeholder={Placeholder(f.label, f)}
            onChange={(v) => onChange(f.key, v ?? null)}
          />
        );
      case 'switch':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch checked={!!value} onChange={(v) => onChange(f.key, v)} />
            <span style={{ fontSize: 12, color: C.gray }}>{value ? '已开启' : '已关闭'}</span>
          </div>
        );
      case 'sql':
        return (
          <Input.TextArea
            rows={5}
            value={String(value || '')}
            placeholder="SELECT * FROM table WHERE ..."
            onChange={(e) => onChange(f.key, e.target.value)}
            style={monoStyle}
          />
        );
      case 'json':
        return (
          <Input.TextArea
            rows={6}
            value={String(value || '')}
            placeholder='[{"name":"张三","amount":100}]'
            onChange={(e) => onChange(f.key, e.target.value)}
            style={monoStyle}
          />
        );
      case 'kv':
        return (
          <Input.TextArea
            rows={4}
            value={String(value || '')}
            placeholder={f.hint || '每行一条：键=值'}
            onChange={(e) => onChange(f.key, e.target.value)}
            style={monoStyle}
          />
        );
      case 'field':
        return (
          <Input
            value={String(value ?? '')}
            placeholder={f.placeholder || '字段名，如 name'}
            onChange={(e) => onChange(f.key, e.target.value)}
          />
        );
      default:
        return (
          <Input
            value={String(value ?? '')}
            placeholder={Placeholder(f.label, f)}
            onChange={(e) => onChange(f.key, e.target.value)}
          />
        );
    }
  };

  if (!fields.length) {
    return (
      <div
        style={{
          padding: '14px 12px',
          borderRadius: 10,
          background: NEUTRAL.surfaceAlt,
          border: `1px dashed ${C.line}`,
          fontSize: 12.5,
          color: C.gray,
        }}
      >
        该节点无需配置参数，连接上下游即可。
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      {fields.map((f) => (
        <div key={f.key}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              color: C.text,
              marginBottom: 5,
              fontWeight: 500,
            }}
          >
            <span>{f.label}</span>
            {f.required && <span style={{ color: C.red }}>*</span>}
            <span style={{ marginLeft: 'auto', fontSize: 10.5, color: C.gray, fontWeight: 400 }}>
              {f.type}
            </span>
          </div>
          {renderControl(f)}
          {f.hint && f.type !== 'kv' && (
            <div style={{ fontSize: 11, color: C.gray, marginTop: 4, lineHeight: 1.5 }}>{f.hint}</div>
          )}
        </div>
      ))}
    </div>
  );
}
