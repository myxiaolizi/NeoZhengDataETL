/** 画布节点卡片：图标 + 名称 + 类型标签 + 输入/输出行数 + 左右端口 */
import React from 'react';
import type { FlowNode, FlowNodeTypeDef } from '@/api/flows';
import {
  C, NODE_H, NODE_W, categoryColor, ellipsize, fmtNum, withAlpha,
} from './constants';
import type { NodeRunStat } from './types';

export interface FlowNodeCardProps {
  node: FlowNode;
  def?: FlowNodeTypeDef;
  selected: boolean;
  hovered: boolean;
  /** 正在以该节点为起点连线 */
  connecting: boolean;
  /** 连线拖拽悬停到该节点（可作为终点） */
  dropTarget: boolean;
  stat?: NodeRunStat;
  onPointerDown: (e: React.PointerEvent<SVGGElement>, node: FlowNode) => void;
  onPointerEnter: (id: string) => void;
  onPointerLeave: (id: string) => void;
  onOutputPointerDown: (e: React.PointerEvent<SVGCircleElement>, node: FlowNode) => void;
  onDoubleClick: (node: FlowNode) => void;
}

export default function FlowNodeCard({
  node, def, selected, hovered, connecting, dropTarget, stat,
  onPointerDown, onPointerEnter, onPointerLeave, onOutputPointerDown, onDoubleClick,
}: FlowNodeCardProps) {
  const color = categoryColor(def?.category);
  const tint = withAlpha(color, 0.13);
  const typeName = def?.name || node.type;
  const label = ellipsize(node.label || typeName, NODE_W - 58 - 30, 13.5);
  const tagText = ellipsize(typeName, NODE_W - 58 - 26, 10.5);
  const tagW = Math.max(34, Math.min(NODE_W - 58 - 20, tagText.length * 10.6 + 18));

  const skipped = !!stat?.skipped;
  const failed = !!stat?.error || stat?.ok === false;
  const statIn = fmtNum(stat?.inputRows);
  const statOut = fmtNum(stat?.outputRows);

  const ringColor = dropTarget ? C.orange : connecting ? C.orange : C.primary;

  return (
    <g
      data-role="flow-node"
      data-node-id={node.id}
      data-node-type={node.type}
      data-node-x={node.x}
      data-node-y={node.y}
      transform={`translate(${node.x},${node.y})`}
      onPointerDown={(e) => onPointerDown(e, node)}
      onPointerEnter={() => onPointerEnter(node.id)}
      onPointerLeave={() => onPointerLeave(node.id)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick(node);
      }}
      style={{ cursor: 'grab' }}
    >
      <title>{`${node.label || typeName} · ${typeName}\n双击打开配置`}</title>

      {/* 选中 / 悬停 / 连线目标 外圈 */}
      {(selected || dropTarget) && (
        <rect
          x={-5}
          y={-5}
          width={NODE_W + 10}
          height={NODE_H + 10}
          rx={17}
          fill="none"
          stroke={ringColor}
          strokeWidth={dropTarget ? 2 : 1.2}
          strokeDasharray={dropTarget ? '7 4' : '6 4'}
          opacity={0.9}
        />
      )}

      {/* 卡片主体 */}
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={13}
        fill={C.bg}
        stroke={selected ? C.primary : hovered ? color : withAlpha(color, 0.62)}
        strokeWidth={selected ? 2.2 : 1.4}
        style={{
          filter: selected
            ? `drop-shadow(0 6px 16px ${withAlpha(C.primary, 0.28)})`
            : hovered
              ? `drop-shadow(0 6px 14px ${withAlpha(C.deep, 0.16)})`
              : `drop-shadow(0 2px 6px ${withAlpha(C.deep, 0.08)})`,
          transition: 'filter .15s ease',
        }}
      />

      {/* 左侧色条 */}
      <rect width={5} height={NODE_H} rx={2.5} fill={color} />

      {/* 图标 */}
      <rect x={14} y={16} width={34} height={34} rx={10} fill={tint} />
      <text
        x={31}
        y={39}
        textAnchor="middle"
        fontSize={16}
        fontWeight={600}
        fill={color}
        style={{ userSelect: 'none' }}
      >
        {def?.icon || '◇'}
      </text>

      {/* 名称 */}
      <text
        x={58}
        y={32}
        fontSize={13.5}
        fontWeight={600}
        fill={C.deep}
        style={{ userSelect: 'none' }}
      >
        {label || typeName}
      </text>

      {/* 类型标签 */}
      <g transform="translate(58, 40)">
        <rect
          width={tagW}
          height={18}
          rx={9}
          fill={tint}
          stroke={withAlpha(color, 0.45)}
          strokeWidth={0.8}
        />
        <text
          x={tagW / 2}
          y={12.8}
          textAnchor="middle"
          fontSize={10.5}
          fill={color}
          style={{ userSelect: 'none' }}
        >
          {tagText}
        </text>
      </g>

      {/* 运行状态点 */}
      {stat && (
        <circle
          cx={NODE_W - 16}
          cy={16}
          r={4}
          fill={skipped ? C.yellow : failed ? C.red : C.green}
          stroke={C.bg}
          strokeWidth={1.5}
        />
      )}

      {/* 分隔线 */}
      <line
        x1={14}
        y1={66}
        x2={NODE_W - 14}
        y2={66}
        stroke={C.line}
        strokeWidth={1}
      />

      {/* 输入 / 输出行数 */}
      {skipped ? (
        <text x={NODE_W / 2} y={81} textAnchor="middle" fontSize={10.5} fill={C.gray}>
          试运行跳过（输出节点）
        </text>
      ) : (
        <>
          <text x={14} y={81} fontSize={10.5} fill={C.gray} style={{ userSelect: 'none' }}>
            输入
            <tspan fill={stat ? C.text : C.gray} fontWeight={stat ? 600 : 400}>
              {stat ? ` ${statIn} ` : ' — '}
            </tspan>
            行
          </text>
          <text
            x={NODE_W - 14}
            y={81}
            textAnchor="end"
            fontSize={10.5}
            fill={C.gray}
            style={{ userSelect: 'none' }}
          >
            输出
            <tspan fill={stat ? C.text : C.gray} fontWeight={stat ? 600 : 400}>
              {stat ? ` ${statOut} ` : ' — '}
            </tspan>
            行
          </text>
        </>
      )}

      {/* 输入端口 */}
      <circle
        cx={0}
        cy={NODE_H / 2}
        r={4.5}
        fill={C.bg}
        stroke={color}
        strokeWidth={2}
      />

      {/* 输出端口：拖拽连线 */}
      <g data-role="flow-node-output">
        <circle
          cx={NODE_W}
          cy={NODE_H / 2}
          r={hovered || selected ? 10 : 8}
          fill={withAlpha(color, 0.16)}
          style={{ pointerEvents: 'none' }}
        />
        <circle
          cx={NODE_W}
          cy={NODE_H / 2}
          r={5.6}
          fill={color}
          stroke={C.bg}
          strokeWidth={2}
          style={{ pointerEvents: 'none' }}
        />
        <circle
          cx={NODE_W}
          cy={NODE_H / 2}
          r={13}
          fill="transparent"
          style={{ cursor: 'crosshair', pointerEvents: 'all' }}
          onPointerDown={(e) => onOutputPointerDown(e, node)}
        >
          <title>按住拖到目标节点连线，或单击后再点目标节点</title>
        </circle>
      </g>
    </g>
  );
}
