/** 右侧抽屉内容：选中节点的属性与配置 */
import React from 'react';
import { Button, Divider, Input, Space, Tag } from 'antd';
import {
  CopyOutlined, DeleteOutlined, DisconnectOutlined, LinkOutlined,
} from '@ant-design/icons';
import type { FlowEdge, FlowNode, FlowNodeTypeDef } from '@/api/flows';
import ConfigForm from './ConfigForm';
import {
  C, NODE_MIN, categoryColor, fmtNum, nodeIcon, withAlpha,
} from './constants';
import { clampNodePos } from './geometry';
import type { NodeRunStat, OptionBundle } from './types';

export interface NodeInspectorProps {
  node: FlowNode;
  def?: FlowNodeTypeDef;
  nodes: FlowNode[];
  edges: FlowEdge[];
  options: OptionBundle;
  upstreamFields?: { label: string; value: string }[];
  stat?: NodeRunStat;
  connectFrom: string | null;
  onPatch: (patch: Partial<FlowNode>) => void;
  onConfigChange: (key: string, value: unknown) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onStartConnect: () => void;
  onCancelConnect: () => void;
  onRemoveEdge: (edge: FlowEdge) => void;
  onFocusNode: (id: string) => void;
}

export default function NodeInspector({
  node, def, nodes, edges, options, upstreamFields, stat, connectFrom,
  onPatch, onConfigChange, onDelete, onDuplicate,
  onStartConnect, onCancelConnect, onRemoveEdge, onFocusNode,
}: NodeInspectorProps) {
  const color = categoryColor(def?.category);
  const incoming = edges.filter((e) => e.to === node.id);
  const outgoing = edges.filter((e) => e.from === node.id);
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.label || id;
  const connecting = connectFrom === node.id;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 节点头 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          borderRadius: 10,
          background: withAlpha(color, 0.07),
          border: `1px solid ${withAlpha(color, 0.28)}`,
        }}
      >
        <span
          style={{
            width: 34, height: 34, flex: '0 0 34px', borderRadius: 10,
            background: withAlpha(color, 0.16), color,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
          }}
        >
          {nodeIcon(node.type, def?.icon)}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.deep, lineHeight: 1.35 }}>
            {def?.name || node.type}
          </div>
          <div style={{ fontSize: 11, color: C.gray, fontFamily: 'Consolas, Menlo, monospace' }}>
            {node.id}
          </div>
        </div>
      </div>

      {/* 运行统计 */}
      {stat && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            fontSize: 11.5,
            color: C.text,
          }}
        >
          {stat.skipped ? (
            <Tag color="gold" style={{ marginInlineEnd: 0 }}>试运行跳过（输出节点）</Tag>
          ) : (
            <>
              <Tag color="blue" style={{ marginInlineEnd: 0 }}>输入 {fmtNum(stat.inputRows)} 行</Tag>
              <Tag color="green" style={{ marginInlineEnd: 0 }}>输出 {fmtNum(stat.outputRows)} 行</Tag>
              {stat.ms !== undefined && (
                <Tag style={{ marginInlineEnd: 0 }}>{fmtNum(stat.ms)} ms</Tag>
              )}
            </>
          )}
          {stat.error && (
            <div style={{ color: C.red, fontSize: 11.5, width: '100%' }}>{stat.error}</div>
          )}
        </div>
      )}

      <div>
        <div style={{ fontSize: 12, color: C.text, marginBottom: 5, fontWeight: 500 }}>节点名称</div>
        <Input
          value={node.label}
          maxLength={60}
          placeholder="给节点起个好认的名字"
          onChange={(e) => onPatch({ label: e.target.value })}
        />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: C.text, marginBottom: 5, fontWeight: 500 }}>X 坐标</div>
          <Input
            type="number"
            value={node.x}
            onChange={(e) => {
              const p = clampNodePos(Number(e.target.value) || NODE_MIN, node.y);
              onPatch({ x: p.x });
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: C.text, marginBottom: 5, fontWeight: 500 }}>Y 坐标</div>
          <Input
            type="number"
            value={node.y}
            onChange={(e) => {
              const p = clampNodePos(node.x, Number(e.target.value) || NODE_MIN);
              onPatch({ y: p.y });
            }}
          />
        </div>
      </div>

      <Divider style={{ margin: '2px 0' }}>节点配置</Divider>

      <ConfigForm
        node={node}
        fields={def?.fields || []}
        options={options}
        upstreamFields={upstreamFields}
        onChange={onConfigChange}
      />

      <Divider style={{ margin: '2px 0' }}>连接</Divider>

      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
        <Button
          block
          icon={<LinkOutlined />}
          type={connecting ? 'primary' : 'default'}
          onClick={() => (connecting ? onCancelConnect() : onStartConnect())}
        >
          {connecting ? '选择目标节点…（点击取消）' : '从此节点连出'}
        </Button>

        {incoming.length > 0 && (
          <div style={{ width: '100%' }}>
            <div style={{ fontSize: 11.5, color: C.gray, marginBottom: 4 }}>
              上游 {incoming.length}
            </div>
            {incoming.map((e) => (
              <div
                key={`in-${e.from}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5,
                  border: `1px solid ${C.line}`, borderRadius: 8, padding: '4px 6px 4px 8px',
                  marginBottom: 4, background: C.bg,
                }}
              >
                <a
                  style={{ flex: 1, minWidth: 0, color: C.deep, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  onClick={() => onFocusNode(e.from)}
                >
                  {labelOf(e.from)}
                </a>
                <span style={{ color: C.gray, fontSize: 11 }}>→ 本节点</span>
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DisconnectOutlined />}
                  onClick={() => onRemoveEdge(e)}
                />
              </div>
            ))}
          </div>
        )}

        {outgoing.length > 0 && (
          <div style={{ width: '100%' }}>
            <div style={{ fontSize: 11.5, color: C.gray, marginBottom: 4 }}>
              下游 {outgoing.length}
            </div>
            {outgoing.map((e) => (
              <div
                key={`out-${e.to}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5,
                  border: `1px solid ${C.line}`, borderRadius: 8, padding: '4px 6px 4px 8px',
                  marginBottom: 4, background: C.bg,
                }}
              >
                <span style={{ color: C.gray, fontSize: 11 }}>本节点 →</span>
                <a
                  style={{ flex: 1, minWidth: 0, color: C.deep, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  onClick={() => onFocusNode(e.to)}
                >
                  {labelOf(e.to)}
                </a>
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DisconnectOutlined />}
                  onClick={() => onRemoveEdge(e)}
                />
              </div>
            ))}
          </div>
        )}

        {incoming.length === 0 && outgoing.length === 0 && (
          <div style={{ fontSize: 12, color: C.gray }}>
            该节点还没有连线。拖动节点右侧圆点到目标节点即可连线。
          </div>
        )}
      </Space>

      <Divider style={{ margin: '2px 0' }} />

      <Space size={8} style={{ width: '100%' }}>
        <Button icon={<CopyOutlined />} block onClick={onDuplicate}>
          复制节点
        </Button>
        <Button danger icon={<DeleteOutlined />} block onClick={onDelete}>
          删除
        </Button>
      </Space>
    </div>
  );
}
