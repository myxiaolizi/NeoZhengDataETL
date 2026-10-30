/** 画布连线层：平滑贝塞尔 + 箭头 + 悬停/选中高亮 + 删除按钮 + 拖拽预览 */
import React from 'react';
import type { FlowEdge, FlowNode } from '@/api/flows';
import { C, withAlpha } from './constants';
import { edgeMid, edgePath, inPort, outPort } from './geometry';

export function edgeKey(e: FlowEdge): string {
  return `${e.from}->${e.to}`;
}

export interface EdgeLayerProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedEdge: FlowEdge | null;
  hoveredEdge: string | null;
  /** 正在拖拽的连线起点 */
  draft: { from: string; x: number; y: number } | null;
  onSelectEdge: (edge: FlowEdge) => void;
  onDeleteEdge: (edge: FlowEdge) => void;
  onHoverEdge: (key: string | null) => void;
}

export default function EdgeLayer({
  nodes, edges, selectedEdge, hoveredEdge, draft,
  onSelectEdge, onDeleteEdge, onHoverEdge,
}: EdgeLayerProps) {
  const nodeMap = React.useMemo(() => {
    const m: Record<string, FlowNode> = {};
    nodes.forEach((n) => { m[n.id] = n; });
    return m;
  }, [nodes]);

  const draftFrom = draft ? nodeMap[draft.from] : null;

  return (
    <g data-role="flow-edges">
      <defs>
        <marker
          id="fc-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={C.primary} opacity={0.6} />
        </marker>
        <marker
          id="fc-arrow-on"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={C.primary} />
        </marker>
      </defs>

      {edges.map((e) => {
        const from = nodeMap[e.from];
        const to = nodeMap[e.to];
        if (!from || !to) return null;
        const a = outPort(from);
        const b = inPort(to);
        const d = edgePath(a, b);
        const key = edgeKey(e);
        const active = !!selectedEdge && selectedEdge.from === e.from && selectedEdge.to === e.to;
        const hovered = hoveredEdge === key;
        const mid = edgeMid(a, b);

        return (
          <g
            key={key}
            data-role="flow-edge"
            data-edge-from={e.from}
            data-edge-to={e.to}
            onPointerEnter={() => onHoverEdge(key)}
            onPointerLeave={() => onHoverEdge(null)}
          >
            {/* 加宽的透明命中区，方便点击 */}
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={16}
              style={{ cursor: 'pointer' }}
              onPointerDown={(ev) => ev.stopPropagation()}
              onClick={(ev) => {
                ev.stopPropagation();
                onSelectEdge(e);
              }}
            />
            {active && (
              <path
                d={d}
                fill="none"
                stroke={withAlpha(C.primary, 0.18)}
                strokeWidth={9}
                strokeLinecap="round"
              />
            )}
            <path
              d={d}
              fill="none"
              stroke={C.primary}
              strokeWidth={active ? 2.8 : hovered ? 2.3 : 1.9}
              strokeOpacity={active ? 1 : hovered ? 0.85 : 0.55}
              markerEnd={active || hovered ? 'url(#fc-arrow-on)' : 'url(#fc-arrow)'}
              style={{ pointerEvents: 'none' }}
            />

            {(active || hovered) && (
              <g
                data-role="flow-edge-del"
                style={{ cursor: 'pointer' }}
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onDeleteEdge(e);
                }}
              >
                <title>删除连线</title>
                <circle
                  cx={mid.x}
                  cy={mid.y}
                  r={10}
                  fill={C.bg}
                  stroke={active ? C.red : C.line}
                  strokeWidth={1.4}
                />
                <text
                  x={mid.x}
                  y={mid.y + 4}
                  textAnchor="middle"
                  fontSize={12}
                  fill={active ? C.red : C.gray}
                  style={{ userSelect: 'none' }}
                >
                  ×
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* 拖拽中的连线预览 */}
      {draft && draftFrom && (
        <path
          d={edgePath(outPort(draftFrom), { x: draft.x, y: draft.y })}
          fill="none"
          stroke={C.orange}
          strokeWidth={2}
          strokeDasharray="6 4"
          markerEnd="url(#fc-arrow-on)"
          style={{ pointerEvents: 'none' }}
        />
      )}
    </g>
  );
}
