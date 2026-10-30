/**
 * 流程设计器（V6.1 重构）
 *
 * 布局：左侧节点面板 · 中间固定尺寸画布 · 右侧节点配置抽屉
 * 画布：固定 2000×1200，缩放 50%~150%，节点拖动不改变画布尺寸
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert, App, Button, Drawer, Empty, Grid, Input, Space, Spin, Tag, Tooltip,
} from 'antd';
import {
  AimOutlined, DeleteOutlined, MinusOutlined, PlayCircleOutlined,
  PlusOutlined, SaveOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import Page from '@/components/Page';
import { NEUTRAL } from '@/theme';
import { flowsApi, fetchDatasourceOptions, fetchFormOptions, fetchProjectOptions } from '@/api/flows';
import type {
  FlowDetail, FlowEdge, FlowNode, FlowNodeMeta, FlowNodeTypeDef,
  FlowPreviewResult, FlowRunResult,
} from '@/api/flows';
import FlowCanvas from './design/FlowCanvas';
import NodePalette from './design/NodePalette';
import NodeInspector from './design/NodeInspector';
import PreviewModal from './design/PreviewModal';
import { C, NODE_H, NODE_MIN, clamp, withAlpha } from './design/constants';
import { clampNodePos, wouldCreateCycle } from './design/geometry';
import type {
  CanvasHandle, NodeRunStat, OptionBundle, Point,
} from './design/types';

const { useBreakpoint } = Grid;

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

export default function FlowDesignPage() {
  const { id } = useParams<{ id: string }>();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { message, modal } = App.useApp();

  const canvasRef = useRef<CanvasHandle | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [detail, setDetail] = useState<FlowDetail | null>(null);
  const [meta, setMeta] = useState<FlowNodeMeta | null>(null);
  const [options, setOptions] = useState<OptionBundle>({ project: [], datasource: [], form: [] });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [dirty, setDirty] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedEdge, setSelectedEdge] = useState<FlowEdge | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [zoom, setZoom] = useState(1);

  const [stats, setStats] = useState<Record<string, NodeRunStat>>({});
  const [preview, setPreview] = useState<FlowPreviewResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const nodesRef = useRef<FlowNode[]>([]);
  const edgesRef = useRef<FlowEdge[]>([]);
  const selectedRef = useRef<string[]>([]);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  selectedRef.current = selectedIds;

  const markDirty = useCallback(() => setDirty(true), []);

  /* ---------------- 加载 ---------------- */
  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [d, m] = await Promise.all([
          flowsApi.detail(id),
          flowsApi.nodeMeta().catch(() => null as FlowNodeMeta | null),
        ]);
        if (!alive) return;
        setDetail(d);
        setMeta(m);
        setName(d.name || '');
        setDescription(d.description || '');
        const loadedNodes = (d.nodes || []).map((n) => {
          // 后端会把 x=0 归一到 40，这里提前夹紧，避免保存后位置跳动
          const p = clampNodePos(Number(n.x) || NODE_MIN, Number(n.y) || NODE_MIN);
          return { ...n, x: p.x, y: p.y };
        });
        setNodes(loadedNodes);
        setEdges((d.edges || []).map((e) => ({ ...e })));
        setDirty(false);

        if (loadedNodes.length) {
          setTimeout(() => canvasRef.current?.centerContent(), 80);
        }
      } catch {
        /* client 已提示 */
      } finally {
        if (alive) setLoading(false);
      }

      const [project, datasource, form] = await Promise.all([
        fetchProjectOptions().catch(() => []),
        fetchDatasourceOptions().catch(() => []),
        fetchFormOptions().catch(() => []),
      ]);
      if (alive) setOptions({ project, datasource, form });
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  /* 未保存离开提醒 */
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const nodeMetaMap = useMemo(() => {
    const map: Record<string, FlowNodeTypeDef> = {};
    (meta?.nodes || []).forEach((n) => {
      map[n.key] = n;
    });
    return map;
  }, [meta]);

  const selectedNode = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    return nodes.find((n) => n.id === selectedIds[0]) || null;
  }, [nodes, selectedIds]);

  const categories = meta?.categories?.length ? meta.categories : [];

  /* ---------------- 节点操作 ---------------- */
  const select = useCallback((ids: string[]) => {
    setSelectedIds(ids);
    setSelectedEdge(null);
    setInspectorOpen(ids.length === 1);
  }, []);

  const activate = useCallback((nodeId: string | null) => {
    if (!nodeId) {
      setInspectorOpen(false);
      return;
    }
    setSelectedIds([nodeId]);
    setSelectedEdge(null);
    setInspectorOpen(true);
  }, []);

  const moveNodes = useCallback((updates: { id: string; x: number; y: number }[]) => {
    if (!updates.length) return;
    const map: Record<string, Point> = {};
    updates.forEach((u) => {
      map[u.id] = { x: u.x, y: u.y };
    });
    setNodes((prev) => prev.map((n) => (map[n.id] ? { ...n, x: map[n.id].x, y: map[n.id].y } : n)));
    setDirty(true);
  }, []);

  const patchNode = useCallback((nodeId: string, patch: Partial<FlowNode>) => {
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)));
    setDirty(true);
  }, []);

  const patchConfig = useCallback((nodeId: string, key: string, value: unknown) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, config: { ...n.config, [key]: value } } : n))
    );
    setDirty(true);
  }, []);

  const removeNodes = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setNodes((prev) => prev.filter((n) => !ids.includes(n.id)));
    setEdges((prev) => prev.filter((e) => !ids.includes(e.from) && !ids.includes(e.to)));
    setSelectedIds((prev) => prev.filter((sid) => !ids.includes(sid)));
    setConnectFrom((cf) => (cf && ids.includes(cf) ? null : cf));
    setSelectedEdge(null);
    setInspectorOpen(false);
    setDirty(true);
  }, []);

  const addNode = useCallback((type: FlowNodeTypeDef) => {
    const pos = canvasRef.current?.getInsertPosition() || { x: 80, y: 80 };
    const node: FlowNode = {
      id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      type: type.key,
      label: type.name,
      x: pos.x,
      y: pos.y,
      config: {},
    };
    (type.fields || []).forEach((f) => {
      if (f.default !== undefined) node.config[f.key] = f.default;
    });
    setNodes((prev) => [...prev, node]);
    setSelectedIds([node.id]);
    setSelectedEdge(null);
    setInspectorOpen(true);
    setPaletteOpen(false);
    setDirty(true);
    requestAnimationFrame(() => canvasRef.current?.centerOnNode(node.id));
  }, []);

  const duplicateNode = useCallback((source: FlowNode) => {
    const pos = clampNodePos(source.x + 28, source.y + NODE_H + 22);
    const node: FlowNode = {
      ...source,
      id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      x: pos.x,
      y: pos.y,
      config: { ...source.config },
    };
    setNodes((prev) => [...prev, node]);
    setSelectedIds([node.id]);
    setInspectorOpen(true);
    setDirty(true);
    requestAnimationFrame(() => canvasRef.current?.centerOnNode(node.id));
  }, []);

  /* ---------------- 连线 ---------------- */
  const connect = useCallback((from: string, to: string) => {
    if (from === to) return;
    const current = edgesRef.current;
    if (current.some((e) => e.from === from && e.to === to)) {
      message.warning('这两个节点之间已存在连线');
      setConnectFrom(null);
      return;
    }
    if (wouldCreateCycle(current, from, to)) {
      message.warning('该连线会造成循环依赖，已阻止');
      setConnectFrom(null);
      return;
    }
    setEdges((prev) => [...prev, { from, to }]);
    setConnectFrom(null);
    setDirty(true);
  }, [message]);

  const startConnect = useCallback((from: string) => {
    setConnectFrom(from);
    setSelectedIds([from]);
    setSelectedEdge(null);
    message.info('已选择起点，点击目标节点完成连线');
  }, [message]);

  const cancelConnect = useCallback(() => setConnectFrom(null), []);

  const removeEdge = useCallback((edge: FlowEdge) => {
    setEdges((prev) => prev.filter((e) => !(e.from === edge.from && e.to === edge.to)));
    setSelectedEdge((cur) =>
      cur && cur.from === edge.from && cur.to === edge.to ? null : cur
    );
    setDirty(true);
  }, []);

  /* ---------------- 保存 / 试运行 / 执行 ---------------- */
  const save = useCallback(async (): Promise<boolean> => {
    if (!id) return false;
    if (!name.trim()) {
      message.warning('请填写流程名称');
      return false;
    }
    setSaving(true);
    try {
      const updated = await flowsApi.update(id, {
        name: name.trim(),
        description,
        nodes: nodesRef.current,
        edges: edgesRef.current,
      } as Partial<FlowDetail>);
      setDetail(updated);
      setNodes((updated.nodes || []).map((n) => ({ ...n })));
      setEdges((updated.edges || []).map((e) => ({ ...e })));
      setDirty(false);
      message.success('流程已保存');
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }, [id, name, description, message]);

  const statsFromLogs = (
    logs: { nodeId: string; skipped?: boolean; inputRows?: number; outputRows?: number; ms?: number; ok?: boolean; error?: string }[]
  ): Record<string, NodeRunStat> => {
    const map: Record<string, NodeRunStat> = {};
    logs.forEach((l) => {
      map[l.nodeId] = {
        inputRows: l.inputRows,
        outputRows: l.outputRows,
        ms: l.ms,
        skipped: l.skipped,
        ok: l.ok,
        error: l.error,
      };
    });
    return map;
  };

  const doPreview = async () => {
    if (!id) return;
    const ok = dirty ? await save() : true;
    if (!ok) return;
    setRunning(true);
    try {
      const res = await flowsApi.preview(id, 50);
      setPreview(res);
      setPreviewOpen(true);
      setStats(statsFromLogs(res.logs || []));
    } catch {
      /* client 已提示 */
    } finally {
      setRunning(false);
    }
  };

  const doRun = () => {
    if (!id) return;
    modal.confirm({
      title: `执行流程「${name || detail?.name || ''}」`,
      content: '将按节点顺序真实执行，可能写入目标表。确定继续？',
      okText: '执行',
      onOk: async () => {
        setRunning(true);
        try {
          const res: FlowRunResult = await flowsApi.run(id);
          if (res.ok) {
            message.success(res.message || '执行成功');
            setStats(statsFromLogs(res.nodeLogs || []));
          } else {
            modal.warning({ title: '执行未通过', content: res.message || '请查看流程日志' });
            setStats(statsFromLogs(res.nodeLogs || []));
          }
        } catch (err) {
          modal.warning({
            title: '执行失败',
            content: err instanceof Error ? err.message : '请查看流程日志',
          });
        } finally {
          setRunning(false);
        }
      },
    });
  };

  /* ---------------- 快捷键 ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const editable = isEditableTarget(e.target);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
        return;
      }
      if (editable) return;
      if (e.key === 'Escape') {
        if (connectFrom) setConnectFrom(null);
        else if (selectedEdge) setSelectedEdge(null);
        else if (inspectorOpen) setInspectorOpen(false);
        else if (selectedRef.current.length) select([]);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedRef.current.length) {
          e.preventDefault();
          removeNodes(selectedRef.current);
        } else if (selectedEdge) {
          e.preventDefault();
          removeEdge(selectedEdge);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, connectFrom, selectedEdge, inspectorOpen, select, removeNodes, removeEdge]);

  /* ---------------- 渲染 ---------------- */
  const nodeCount = nodes.length;
  const edgeCount = edges.length;

  const toolbar = (
    <Space wrap size={8}>
      {isMobile && (
        <Button onClick={() => setPaletteOpen(true)}>节点</Button>
      )}
      {!isMobile && (
        <Space.Compact>
          <Tooltip title="缩小（Ctrl+滚轮）">
            <Button
              icon={<MinusOutlined />}
              aria-label="工具栏缩小"
              onClick={() => canvasRef.current?.zoomOut()}
            />
          </Tooltip>
          <Tooltip title="点击恢复 100%">
            <Button
              onClick={() => canvasRef.current?.resetZoom()}
              style={{ minWidth: 58, fontSize: 12.5, fontWeight: 600 }}
              aria-label="重置缩放"
            >
              {Math.round(zoom * 100)}%
            </Button>
          </Tooltip>
          <Tooltip title="放大（Ctrl+滚轮）">
            <Button
              icon={<PlusOutlined />}
              aria-label="工具栏放大"
              onClick={() => canvasRef.current?.zoomIn()}
            />
          </Tooltip>
          <Tooltip title="适应窗口">
            <Button
              icon={<AimOutlined />}
              aria-label="工具栏适应窗口"
              onClick={() => canvasRef.current?.fitToView()}
            />
          </Tooltip>
        </Space.Compact>
      )}
      {selectedIds.length > 1 && (
        <Button danger icon={<DeleteOutlined />} onClick={() => removeNodes(selectedIds)}>
          删除 {selectedIds.length}
        </Button>
      )}
      <Tooltip title="试运行：按顺序执行到输出节点前，预览数据">
        <Button icon={<ThunderboltOutlined />} loading={running} onClick={doPreview}>
          试运行
        </Button>
      </Tooltip>
      <Tooltip title="真实执行：会写入目标表 / 推送接口">
        <Button icon={<PlayCircleOutlined />} loading={running} onClick={doRun}>
          执行
        </Button>
      </Tooltip>
      <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>
        保存
      </Button>
    </Space>
  );

  if (loading) {
    return (
      <Page back="/flows" backText="返回处理流程" title="流程设计">
        <div style={{ padding: 80, textAlign: 'center' }}>
          <Spin size="large" description="加载流程…" />
        </div>
      </Page>
    );
  }

  if (!detail) {
    return (
      <Page back="/flows" backText="返回处理流程" title="流程设计" extra={toolbar}>
        <Empty description="流程不存在或无权限访问" />
      </Page>
    );
  }

  const inspector = selectedNode ? (
    <NodeInspector
      node={selectedNode}
      def={nodeMetaMap[selectedNode.type]}
      nodes={nodes}
      edges={edges}
      options={options}
      stat={stats[selectedNode.id]}
      connectFrom={connectFrom}
      onPatch={(patch) => patchNode(selectedNode.id, patch)}
      onConfigChange={(key, value) => patchConfig(selectedNode.id, key, value)}
      onDelete={() => removeNodes([selectedNode.id])}
      onDuplicate={() => duplicateNode(selectedNode)}
      onStartConnect={() => startConnect(selectedNode.id)}
      onCancelConnect={cancelConnect}
      onRemoveEdge={removeEdge}
      onFocusNode={(nodeId) => {
        activate(nodeId);
        canvasRef.current?.centerOnNode(nodeId);
      }}
    />
  ) : null;

  const mainHeight = isMobile ? 'calc(100vh - 250px)' : 'calc(100vh - 292px)';

  return (
    <Page
      back="/flows"
      backText="返回处理流程"
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          流程设计
          <span style={{ fontSize: 13.5, fontWeight: 600, color: NEUTRAL.textSecondary }}>
            {name || detail.name}
          </span>
          {dirty && (
            <Tag color="orange" style={{ marginInlineStart: 2 }}>未保存</Tag>
          )}
        </span>
      }
      extra={toolbar}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* 基本信息条 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: isMobile ? 'wrap' : 'nowrap',
            padding: '8px 10px',
            border: `1px solid ${NEUTRAL.border}`,
            borderRadius: 10,
            background: NEUTRAL.surface,
          }}
        >
          <span style={{ fontSize: 12, color: C.gray, flexShrink: 0 }}>流程名称</span>
          <Input
            value={name}
            maxLength={60}
            variant="filled"
            onChange={(e) => {
              setName(e.target.value);
              markDirty();
            }}
            style={{ width: isMobile ? '100%' : 230 }}
          />
          <span style={{ fontSize: 12, color: C.gray, flexShrink: 0 }}>说明</span>
          <Input
            value={description}
            maxLength={200}
            variant="filled"
            placeholder="选填：这个流程做什么"
            onChange={(e) => {
              setDescription(e.target.value);
              markDirty();
            }}
            style={{ flex: 1, minWidth: 160 }}
          />
          <span style={{ fontSize: 11.5, color: C.gray, flexShrink: 0 }}>
            {nodeCount} 节点 · {edgeCount} 连线
          </span>
        </div>

        {connectFrom && (
          <Alert
            type="warning"
            showIcon
            style={{ padding: '4px 10px' }}
            title="连线模式：点击目标节点完成连线（Esc 取消）"
            action={
              <Button size="small" onClick={cancelConnect}>
                取消
              </Button>
            }
          />
        )}

        {/* 主区：节点面板 + 画布 */}
        <div style={{ display: 'flex', gap: 10, height: mainHeight, minHeight: 420 }}>
          {!isMobile && <NodePalette meta={meta} onAdd={addNode} />}

          <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <FlowCanvas
              ref={canvasRef}
              nodes={nodes}
              edges={edges}
              nodeMetaMap={nodeMetaMap}
              selectedIds={selectedIds}
              selectedEdge={selectedEdge}
              connectFrom={connectFrom}
              stats={stats}
              zoom={zoom}
              onZoomChange={setZoom}
              onSelect={select}
              onActivate={activate}
              onSelectEdge={(edge) => {
                setSelectedEdge(edge);
                if (edge) {
                  setSelectedIds([]);
                  setInspectorOpen(false);
                }
              }}
              onMoveNodes={moveNodes}
              onConnect={connect}
              onStartConnect={startConnect}
              onCancelConnect={cancelConnect}
              onDeleteEdge={removeEdge}
            />
          </div>
        </div>

        {/* 操作提示 */}
        {!isMobile && (
          <div style={{ fontSize: 11.5, color: C.gray, lineHeight: 1.6 }}>
            拖动节点移动位置 · 拖动节点右侧圆点到目标节点连线 · 框选多个节点后可批量删除 ·
            Delete 删除选中 · Ctrl+S 保存 · 空格 + 拖动平移 · Ctrl + 滚轮缩放
            {categories.length > 0 && ` · 共 ${meta?.nodes?.length || 0} 种节点类型`}
          </div>
        )}
      </div>

      {/* 右侧配置抽屉 */}
      <Drawer
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            节点配置
            {selectedNode && (
              <span style={{ fontSize: 12, color: C.gray, fontWeight: 400 }}>
                {nodeMetaMap[selectedNode.type]?.name || selectedNode.type}
              </span>
            )}
          </span>
        }
        placement="right"
        width={isMobile ? '92%' : 400}
        open={inspectorOpen && !!selectedNode}
        onClose={() => setInspectorOpen(false)}
        styles={{ body: { padding: '14px 16px 24px' } }}
      >
        {inspector || <Empty description="未选择节点" />}
      </Drawer>

      {/* 移动端节点面板 */}
      <Drawer
        title="节点面板"
        placement="left"
        width="86%"
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        styles={{ body: { padding: 0 } }}
      >
        <NodePalette meta={meta} onAdd={addNode} bare />
      </Drawer>

      <PreviewModal
        open={previewOpen}
        preview={preview}
        isMobile={isMobile}
        onClose={() => setPreviewOpen(false)}
      />
    </Page>
  );
}
