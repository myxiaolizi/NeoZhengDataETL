/**
 * 流程画布：固定 2000×1200 的 SVG 画布
 *
 * 关键设计：画布宽高是常量（CANVAS_W / CANVAS_H），节点拖动只改节点坐标，
 * 永远不会触发画布尺寸变化。缩放用 CSS transform 作用于 SVG，视觉缩放但
 * width/height 属性始终为 2000×1200，因此不会出现"画图框自动变大变小"。
 */
import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState,
} from 'react';
import { Button, Tooltip } from 'antd';
import { AimOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons';
import type { FlowEdge, FlowNode, FlowNodeTypeDef } from '@/api/flows';
import { SHADOW } from '@/theme';
import {
  C, CANVAS_H, CANVAS_PAD, CANVAS_W, GRID_SIZE, NODE_H, NODE_W,
  ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, clamp, withAlpha,
} from './constants';
import { clampNodePos, nodeInRect, normalizeRect, outPort } from './geometry';
import type { CanvasHandle, NodeRunStat, Point } from './types';
import FlowNodeCard from './FlowNodeCard';
import EdgeLayer from './EdgeLayer';

export interface FlowCanvasProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  nodeMetaMap: Record<string, FlowNodeTypeDef>;
  selectedIds: string[];
  selectedEdge: FlowEdge | null;
  connectFrom: string | null;
  stats: Record<string, NodeRunStat>;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onSelect: (ids: string[]) => void;
  onActivate: (id: string | null) => void;
  onSelectEdge: (edge: FlowEdge | null) => void;
  onMoveNodes: (updates: { id: string; x: number; y: number }[]) => void;
  onConnect: (from: string, to: string) => void;
  onStartConnect: (from: string) => void;
  onCancelConnect: () => void;
  onDeleteEdge: (edge: FlowEdge) => void;
}

type Gesture =
  | {
      kind: 'drag';
      nodeId: string;
      ids: string[];
      startClient: Point;
      start: Record<string, Point>;
      moved: boolean;
    }
  | { kind: 'marquee'; startWorld: Point; additive: boolean; base: string[]; moved: boolean }
  | { kind: 'pan'; startClient: Point; startScroll: Point; moved: boolean }
  | { kind: 'connect'; from: string; startClient: Point; last: Point; moved: boolean };

function nodeIdAtPoint(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const hit = (el as Element).closest('[data-node-id]');
  return hit ? hit.getAttribute('data-node-id') : null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.tagName === 'BUTTON' ||
    el.tagName === 'A' ||
    el.isContentEditable
  );
}

const FlowCanvas = forwardRef<CanvasHandle, FlowCanvasProps>(function FlowCanvas(props, ref) {
  const {
    nodes, edges, nodeMetaMap, selectedIds, selectedEdge, connectFrom, stats, zoom,
    onZoomChange, onSelect, onActivate, onSelectEdge, onMoveNodes, onConnect,
    onStartConnect, onCancelConnect, onDeleteEdge,
  } = props;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const spaceRef = useRef(false);
  const zoomRef = useRef(zoom);
  const propsRef = useRef(props);
  const pendingAnchorRef = useRef<{ anchor: Point; world: Point } | null>(null);

  propsRef.current = props;
  zoomRef.current = zoom;

  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [draft, setDraft] = useState<{ from: string; x: number; y: number } | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [panning, setPanning] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);

  /* ---------------- 坐标换算 ---------------- */
  const clientToWorld = useCallback((clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    const z = zoomRef.current || 1;
    return { x: (clientX - r.left) / z, y: (clientY - r.top) / z };
  }, []);

  /* ---------------- 缩放 ---------------- */
  const applyZoom = useCallback((next: number, anchor?: Point) => {
    const z = clamp(Math.round(next * 100) / 100, ZOOM_MIN, ZOOM_MAX);
    const vp = viewportRef.current;
    const svg = svgRef.current;
    if (!vp || !svg) {
      onZoomChange(z);
      return;
    }
    if (Math.abs(z - zoomRef.current) < 0.001) return;
    const rect = vp.getBoundingClientRect();
    const ax = anchor ? anchor.x : rect.left + vp.clientWidth / 2;
    const ay = anchor ? anchor.y : rect.top + vp.clientHeight / 2;
    const sr = svg.getBoundingClientRect();
    const world = { x: (ax - sr.left) / zoomRef.current, y: (ay - sr.top) / zoomRef.current };
    pendingAnchorRef.current = { anchor: { x: ax, y: ay }, world };
    zoomRef.current = z;
    onZoomChange(z);
  }, [onZoomChange]);

  const zoomIn = useCallback(() => applyZoom(zoomRef.current + ZOOM_STEP), [applyZoom]);
  const zoomOut = useCallback(() => applyZoom(zoomRef.current - ZOOM_STEP), [applyZoom]);
  const resetZoom = useCallback(() => applyZoom(1), [applyZoom]);

  const fitToView = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const list = propsRef.current.nodes;
    // 有节点时框住节点包围盒，否则框住整张画布
    let box = { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
    if (list.length) {
      const minX = Math.min(...list.map((n) => n.x));
      const minY = Math.min(...list.map((n) => n.y));
      const maxX = Math.max(...list.map((n) => n.x + NODE_W));
      const maxY = Math.max(...list.map((n) => n.y + NODE_H));
      box = { x: minX - 40, y: minY - 40, w: maxX - minX + 80, h: maxY - minY + 80 };
    }
    const availW = Math.max(120, vp.clientWidth - 24);
    const availH = Math.max(120, vp.clientHeight - 24);
    const z = clamp(Math.min(availW / box.w, availH / box.h), ZOOM_MIN, ZOOM_MAX);
    const rounded = Math.round(z * 100) / 100;
    pendingAnchorRef.current = null;
    zoomRef.current = rounded;
    propsRef.current.onZoomChange(rounded);
    requestAnimationFrame(() => {
      const el = viewportRef.current;
      if (!el) return;
      el.scrollLeft = Math.max(
        0,
        CANVAS_PAD + (box.x + box.w / 2) * rounded - el.clientWidth / 2
      );
      el.scrollTop = Math.max(
        0,
        CANVAS_PAD + (box.y + box.h / 2) * rounded - el.clientHeight / 2
      );
    });
  }, []);

  /** 保持当前缩放，把已有节点的包围盒滚动到视口中心 */
  const centerContent = useCallback(() => {
    const vp = viewportRef.current;
    const list = propsRef.current.nodes;
    if (!vp || !list.length) return;
    const minX = Math.min(...list.map((n) => n.x));
    const minY = Math.min(...list.map((n) => n.y));
    const maxX = Math.max(...list.map((n) => n.x + NODE_W));
    const maxY = Math.max(...list.map((n) => n.y + NODE_H));
    const z = zoomRef.current || 1;
    vp.scrollLeft = Math.max(0, CANVAS_PAD + ((minX + maxX) / 2) * z - vp.clientWidth / 2);
    vp.scrollTop = Math.max(0, CANVAS_PAD + ((minY + maxY) / 2) * z - vp.clientHeight / 2);
  }, []);

  const getInsertPosition = useCallback((): Point => {
    const vp = viewportRef.current;
    if (!vp) return { x: 80, y: 80 };
    const base = clampNodePos(
      (vp.scrollLeft + vp.clientWidth / 2 - CANVAS_PAD) / (zoomRef.current || 1) - NODE_W / 2,
      (vp.scrollTop + vp.clientHeight / 2 - CANVAS_PAD) / (zoomRef.current || 1) - NODE_H / 2
    );
    const list = propsRef.current.nodes;
    const stepX = NODE_W + 44;
    const stepY = NODE_H + 26;
    const cols = Math.max(1, Math.floor((CANVAS_W - base.x - 80) / stepX) + 1);
    for (let i = 0; i < 120; i += 1) {
      const rawX = base.x + (i % cols) * stepX;
      const rawY = base.y + Math.floor(i / cols) * stepY;
      if (rawY > CANVAS_H - NODE_H - 8) {
        const alt = clampNodePos(base.x + ((i % cols) + 1) * stepX, 40);
        if (alt.x !== base.x) return alt;
        break;
      }
      const p = clampNodePos(rawX, rawY);
      const busy = list.some(
        (n) => Math.abs(n.x - p.x) < NODE_W * 0.72 && Math.abs(n.y - p.y) < NODE_H * 0.72
      );
      if (!busy) return p;
    }
    return base;
  }, []);

  const centerOnNode = useCallback((nodeId: string) => {
    const vp = viewportRef.current;
    const node = propsRef.current.nodes.find((n) => n.id === nodeId);
    if (!vp || !node) return;
    vp.scrollLeft = CANVAS_PAD + (node.x + NODE_W / 2) * zoomRef.current - vp.clientWidth / 2;
    vp.scrollTop = CANVAS_PAD + (node.y + NODE_H / 2) * zoomRef.current - vp.clientHeight / 2;
  }, []);

  useImperativeHandle(ref, () => ({
    zoomIn, zoomOut, resetZoom, fitToView, getInsertPosition, centerOnNode, centerContent,
  }), [zoomIn, zoomOut, resetZoom, fitToView, getInsertPosition, centerOnNode, centerContent]);

  /* 缩放后保持锚点位置（渲染完成再调滚动） */
  useLayoutEffect(() => {
    const pending = pendingAnchorRef.current;
    if (!pending) return;
    pendingAnchorRef.current = null;
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const offsetX = pending.anchor.x - rect.left;
    const offsetY = pending.anchor.y - rect.top;
    vp.scrollLeft = CANVAS_PAD + pending.world.x * zoom - offsetX;
    vp.scrollTop = CANVAS_PAD + pending.world.y * zoom - offsetY;
  }, [zoom]);

  /* ---------------- 手势 ---------------- */
  const beginPan = useCallback((e: { clientX: number; clientY: number; preventDefault: () => void }) => {
    const vp = viewportRef.current;
    if (!vp) return;
    e.preventDefault();
    gestureRef.current = {
      kind: 'pan',
      startClient: { x: e.clientX, y: e.clientY },
      startScroll: { x: vp.scrollLeft, y: vp.scrollTop },
      moved: false,
    };
    setPanning(true);
  }, []);

  const handleBackgroundPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (spaceRef.current || e.button === 1) {
      beginPan(e);
      return;
    }
    if (e.button !== 0) return;
    if (connectFrom) {
      onCancelConnect();
      return;
    }
    const p = clientToWorld(e.clientX, e.clientY);
    gestureRef.current = {
      kind: 'marquee',
      startWorld: p,
      additive: e.shiftKey || e.ctrlKey || e.metaKey,
      base: e.shiftKey || e.ctrlKey || e.metaKey ? selectedIds : [],
      moved: false,
    };
    setMarquee({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    onSelectEdge(null);
  };

  const handleNodePointerDown = (e: React.PointerEvent<SVGGElement>, node: FlowNode) => {
    if (spaceRef.current || e.button === 1) {
      beginPan(e);
      return;
    }
    if (e.button !== 0) return;
    e.stopPropagation();

    if (connectFrom) {
      if (connectFrom === node.id) onCancelConnect();
      else onConnect(connectFrom, node.id);
      return;
    }

    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (additive) {
      const next = selectedIds.includes(node.id)
        ? selectedIds.filter((id) => id !== node.id)
        : [...selectedIds, node.id];
      onSelect(next);
      return;
    }

    const already = selectedIds.includes(node.id);
    if (!already) onSelect([node.id]);
    const dragIds = already ? selectedIds : [node.id];
    const start: Record<string, Point> = {};
    nodes.forEach((n) => {
      if (dragIds.includes(n.id)) start[n.id] = { x: n.x, y: n.y };
    });
    gestureRef.current = {
      kind: 'drag',
      nodeId: node.id,
      ids: dragIds,
      startClient: { x: e.clientX, y: e.clientY },
      start,
      moved: false,
    };
    setDragging(true);
  };

  const handleOutputPointerDown = (
    e: React.PointerEvent<SVGCircleElement>,
    node: FlowNode
  ) => {
    if (spaceRef.current || e.button === 1) {
      beginPan(e);
      return;
    }
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = clientToWorld(e.clientX, e.clientY);
    gestureRef.current = {
      kind: 'connect',
      from: node.id,
      startClient: { x: e.clientX, y: e.clientY },
      last: p,
      moved: false,
    };
    setDraft({ from: node.id, x: p.x, y: p.y });
    onSelect([node.id]);
    onActivate(null);
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;

      if (g.kind === 'pan') {
        const vp = viewportRef.current;
        if (!vp) return;
        if (Math.abs(e.clientX - g.startClient.x) + Math.abs(e.clientY - g.startClient.y) > 3) {
          g.moved = true;
        }
        vp.scrollLeft = g.startScroll.x - (e.clientX - g.startClient.x);
        vp.scrollTop = g.startScroll.y - (e.clientY - g.startClient.y);
        return;
      }

      if (g.kind === 'drag') {
        const dx = e.clientX - g.startClient.x;
        const dy = e.clientY - g.startClient.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
        if (!g.moved) return;
        const z = zoomRef.current || 1;
        const updates = g.ids
          .filter((idValue) => g.start[idValue])
          .map((idValue) => {
            const s = g.start[idValue];
            const p = clampNodePos(s.x + dx / z, s.y + dy / z);
            return { id: idValue, x: p.x, y: p.y };
          });
        propsRef.current.onMoveNodes(updates);
        return;
      }

      if (g.kind === 'marquee') {
        const p = clientToWorld(e.clientX, e.clientY);
        if (Math.abs(p.x - g.startWorld.x) + Math.abs(p.y - g.startWorld.y) > 3) g.moved = true;
        setMarquee({ x1: g.startWorld.x, y1: g.startWorld.y, x2: p.x, y2: p.y });
        return;
      }

      const p = clientToWorld(e.clientX, e.clientY);
      if (Math.abs(e.clientX - g.startClient.x) + Math.abs(e.clientY - g.startClient.y) > 3) {
        g.moved = true;
      }
      g.last = p;
      setDraft({ from: g.from, x: p.x, y: p.y });
    };

    const onUp = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      gestureRef.current = null;
      setDragging(false);
      setPanning(false);
      setMarquee(null);
      setDraft(null);

      if (g.kind === 'drag') {
        if (!g.moved) propsRef.current.onActivate(g.nodeId);
        return;
      }

      if (g.kind === 'marquee') {
        if (!g.moved) {
          propsRef.current.onSelect([]);
          propsRef.current.onActivate(null);
          return;
        }
        const p = clientToWorld(e.clientX, e.clientY);
        const rect = {
          x1: g.startWorld.x, y1: g.startWorld.y, x2: p.x, y2: p.y,
        };
        const hits = propsRef.current.nodes.filter((n) => nodeInRect(n, rect)).map((n) => n.id);
        const merged = g.additive ? Array.from(new Set([...g.base, ...hits])) : hits;
        propsRef.current.onSelect(merged);
        propsRef.current.onActivate(null);
        return;
      }

      if (g.kind === 'connect') {
        const target = nodeIdAtPoint(e.clientX, e.clientY);
        if (target && target !== g.from) {
          propsRef.current.onConnect(g.from, target);
        } else if (!g.moved) {
          propsRef.current.onStartConnect(g.from);
        }
      }
    };

    const onCancel = () => {
      if (!gestureRef.current) return;
      gestureRef.current = null;
      setDragging(false);
      setPanning(false);
      setMarquee(null);
      setDraft(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
    };
  }, [clientToWorld]);

  /* Ctrl / Cmd + 滚轮缩放 */
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (gestureRef.current) return;
      const dir = e.deltaY > 0 ? -1 : 1;
      applyZoom(zoomRef.current + dir * ZOOM_STEP, { x: e.clientX, y: e.clientY });
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [applyZoom]);

  /* 空格键切换平移模式 */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isEditableTarget(e.target)) return;
      e.preventDefault();
      if (!spaceRef.current) {
        spaceRef.current = true;
        setSpaceDown(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      spaceRef.current = false;
      setSpaceDown(false);
    };
    const onBlur = () => {
      spaceRef.current = false;
      setSpaceDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const cursor = panning ? 'grabbing' : spaceDown ? 'grab' : dragging ? 'grabbing' : 'default';
  const marqueeRect = marquee ? normalizeRect(marquee) : null;
  const connectSourceNode = connectFrom ? nodes.find((n) => n.id === connectFrom) : null;

  return (
    <div
      style={{
        position: 'relative',
        height: '100%',
        minHeight: 0,
        background: C.bg,
        borderRadius: 12,
        border: `1px solid ${withAlpha(C.primary, 0.26)}`,
        overflow: 'hidden',
      }}
    >
      <div
        ref={viewportRef}
        data-role="flow-canvas-viewport"
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'auto',
          overscrollBehavior: 'contain',
          cursor,
        }}
      >
        <div
          style={{
            width: CANVAS_W * zoom + CANVAS_PAD * 2,
            height: CANVAS_H * zoom + CANVAS_PAD * 2,
            padding: CANVAS_PAD,
            boxSizing: 'border-box',
          }}
        >
          <svg
            ref={svgRef}
            data-role="flow-canvas"
            data-canvas-width={CANVAS_W}
            data-canvas-height={CANVAS_H}
            data-zoom={zoom}
            width={CANVAS_W}
            height={CANVAS_H}
            viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
            onPointerDown={handleBackgroundPointerDown}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              display: 'block',
              background: C.bg,
              borderRadius: 8,
              boxShadow: SHADOW.raised,
              transform: `scale(${zoom})`,
              transformOrigin: '0 0',
              touchAction: 'none',
            }}
          >
            <defs>
              <pattern id="fc-dots" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
                <circle cx={1} cy={1} r={1.15} fill={C.primary} opacity={0.18} />
              </pattern>
              <pattern id="fc-dots-major" width={GRID_SIZE * 5} height={GRID_SIZE * 5} patternUnits="userSpaceOnUse">
                <circle cx={1} cy={1} r={1.6} fill={C.primary} opacity={0.12} />
              </pattern>
            </defs>

            <rect width={CANVAS_W} height={CANVAS_H} fill={C.bg} />
            <rect width={CANVAS_W} height={CANVAS_H} fill="url(#fc-dots)" />
            <rect width={CANVAS_W} height={CANVAS_H} fill="url(#fc-dots-major)" />

            <EdgeLayer
              nodes={nodes}
              edges={edges}
              selectedEdge={selectedEdge}
              hoveredEdge={hoveredEdge}
              draft={draft}
              onSelectEdge={onSelectEdge}
              onDeleteEdge={onDeleteEdge}
              onHoverEdge={setHoveredEdge}
            />

            {/* 连线起点提示 */}
            {connectSourceNode && (
              <circle
                cx={outPort(connectSourceNode).x}
                cy={outPort(connectSourceNode).y}
                r={18}
                fill="none"
                stroke={C.orange}
                strokeWidth={2}
                strokeDasharray="5 4"
                opacity={0.9}
              />
            )}

            {/* 框选 */}
            {marqueeRect && (
              <rect
                x={marqueeRect.x}
                y={marqueeRect.y}
                width={marqueeRect.width}
                height={marqueeRect.height}
                fill={withAlpha(C.primary, 0.08)}
                stroke={C.primary}
                strokeWidth={1.2}
                strokeDasharray="6 4"
                style={{ pointerEvents: 'none' }}
              />
            )}

            {nodes.map((node) => (
              <FlowNodeCard
                key={node.id}
                node={node}
                def={nodeMetaMap[node.type]}
                selected={selectedIds.includes(node.id)}
                hovered={hoveredNode === node.id}
                connecting={connectFrom === node.id}
                dropTarget={!!draft && hoveredNode === node.id && draft.from !== node.id}
                stat={stats[node.id]}
                onPointerDown={handleNodePointerDown}
                onPointerEnter={setHoveredNode}
                onPointerLeave={(idValue) => setHoveredNode((cur) => (cur === idValue ? null : cur))}
                onOutputPointerDown={handleOutputPointerDown}
                onDoubleClick={(n) => {
                  onSelect([n.id]);
                  onActivate(n.id);
                }}
              />
            ))}
          </svg>
        </div>
      </div>

      {/* 空画布提示 */}
      {nodes.length === 0 && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '46%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            pointerEvents: 'none',
            color: C.gray,
          }}
        >
          <div style={{ fontSize: 34, color: withAlpha(C.primary, 0.35), lineHeight: 1 }}>⌗</div>
          <div style={{ marginTop: 10, fontSize: 13.5, color: C.text }}>画布还是空的</div>
          <div style={{ marginTop: 4, fontSize: 12, color: C.gray }}>
            从左侧「节点面板」点击节点即可添加到画布
          </div>
        </div>
      )}

      {/* 连线模式提示 */}
      {connectFrom && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 12px',
            borderRadius: 999,
            background: C.bg,
            border: `1px solid ${C.orange}`,
            boxShadow: `0 6px 18px ${withAlpha(C.orange, 0.18)}`,
            fontSize: 12.5,
            color: C.deep,
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.orange }} />
          连线中：点击目标节点完成
          <a style={{ color: C.orange }} onClick={onCancelConnect}>取消</a>
        </div>
      )}

      {/* 选中数量 */}
      {selectedIds.length > 1 && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            padding: '5px 10px',
            borderRadius: 8,
            background: C.bg,
            border: `1px solid ${withAlpha(C.primary, 0.36)}`,
            fontSize: 12,
            color: C.deep,
            boxShadow: SHADOW.card,
          }}
        >
          已选 {selectedIds.length} 个节点 · 按 Delete 批量删除
        </div>
      )}

      {/* 左下：图例与操作提示 */}
      <div
        style={{
          position: 'absolute',
          left: 12,
          bottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '5px 10px',
          borderRadius: 8,
          background: withAlpha(C.bg, 0.92),
          border: `1px solid ${withAlpha(C.primary, 0.16)}`,
          fontSize: 11.5,
          color: C.gray,
          pointerEvents: 'none',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <i style={{ width: 8, height: 8, borderRadius: 2, background: C.primary }} />数据源
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <i style={{ width: 8, height: 8, borderRadius: 2, background: C.green }} />清洗
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <i style={{ width: 8, height: 8, borderRadius: 2, background: C.orange }} />输出
        </span>
        <span style={{ opacity: 0.9 }}>空格+拖动平移 · Ctrl+滚轮缩放</span>
      </div>

      {/* 右下：缩放比例与缩放按钮 */}
      <div
        style={{
          position: 'absolute',
          right: 12,
          bottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '3px 5px',
          borderRadius: 9,
          background: C.bg,
          border: `1px solid ${withAlpha(C.primary, 0.24)}`,
          boxShadow: SHADOW.card,
        }}
      >
        <Tooltip title="缩小（Ctrl+滚轮）">
          <Button size="small" type="text" icon={<MinusOutlined />} onClick={zoomOut} aria-label="缩小" />
        </Tooltip>
        <span
          data-role="flow-zoom-label"
          style={{ minWidth: 46, textAlign: 'center', fontSize: 12, fontWeight: 600, color: C.deep, userSelect: 'none' }}
        >
          {Math.round(zoom * 100)}%
        </span>
        <Tooltip title="放大（Ctrl+滚轮）">
          <Button size="small" type="text" icon={<PlusOutlined />} onClick={zoomIn} aria-label="放大" />
        </Tooltip>
        <Tooltip title="适应窗口">
          <Button size="small" type="text" icon={<AimOutlined />} onClick={fitToView} aria-label="适应窗口" />
        </Tooltip>
      </div>
    </div>
  );
});

export default React.memo(FlowCanvas);
