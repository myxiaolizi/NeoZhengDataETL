/** 流程设计器：节点列表编辑 + SVG 连线可视化 + 试运行 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert, App, Button, Card, Col, Divider, Empty, Grid, Input, InputNumber,
  Modal, Row, Segmented, Select, Space, Spin, Switch, Table, Tag,
} from 'antd';
import {
  ArrowLeftOutlined, DeleteOutlined, DisconnectOutlined, LinkOutlined,
  PlayCircleOutlined, PlusOutlined, SaveOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import Page from '@/components/Page';
import { flowsApi, fetchDatasourceOptions, fetchFormOptions, fetchProjectOptions } from '@/api/flows';
import type {
  FlowDetail, FlowEdge, FlowNode, FlowNodeFieldDef, FlowNodeMeta, FlowNodeTypeDef,
  FlowPreviewResult, OptionItem,
} from '@/api/flows';

const { useBreakpoint } = Grid;

/** 调色板（契约唯一允许的 13 色） */
const C = {
  primary: '#3687FF',
  blue: '#2D6FE4',
  deep: '#003378',
  cyan: '#45B4FF',
  light: '#73DBFF',
  green: '#A2D73C',
  orange: '#EC673C',
  red: '#E86161',
  yellow: '#FFC000',
  gray: '#B5B5B6',
  line: '#DCDDDD',
};

/** 节点分类配色 */
const CATEGORY_COLOR: Record<string, string> = {
  source: C.primary,
  clean: C.cyan,
  sink: C.green,
};

const NODE_W = 172;
const NODE_H = 58;

/** 载入配置选项（项目/数据源/表单） */
interface OptionBundle {
  project: OptionItem[];
  datasource: OptionItem[];
  form: OptionItem[];
}

export default function FlowDesignPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { message, modal } = App.useApp();

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const [preview, setPreview] = useState<FlowPreviewResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [paletteTab, setPaletteTab] = useState<'source' | 'clean' | 'sink'>('source');

  const dragRef = useRef<{ id: string; startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  /* ---------- 加载 ---------- */
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
        setNodes((d.nodes || []).map((n) => ({ ...n })));
        setEdges((d.edges || []).map((e) => ({ ...e })));
        if (m?.nodes?.length) setPaletteTab(m.nodes[0].category as 'source');
        setDirty(false);
      } catch {
        /* client 已提示 */
      } finally {
        if (alive) setLoading(false);
      }

      // 选项（失败不阻塞）
      const [project, datasource, form] = await Promise.all([
        fetchProjectOptions().catch(() => [] as OptionItem[]),
        fetchDatasourceOptions().catch(() => [] as OptionItem[]),
        fetchFormOptions().catch(() => [] as OptionItem[]),
      ]);
      if (alive) setOptions({ project, datasource, form });
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const markDirty = useCallback(() => setDirty(true), []);

  const nodeMetaMap = useMemo(() => {
    const map: Record<string, FlowNodeTypeDef> = {};
    (meta?.nodes || []).forEach((n) => {
      map[n.key] = n;
    });
    return map;
  }, [meta]);

  const selected = useMemo(
    () => nodes.find((n) => n.id === selectedId) || null,
    [nodes, selectedId]
  );

  /* ---------- 节点操作 ---------- */
  const nextPostion = () => {
    if (!nodes.length) return { x: 40, y: 60 };
    const maxX = Math.max(...nodes.map((n) => n.x));
    const maxY = Math.max(...nodes.map((n) => n.y));
    return { x: maxX, y: maxY + NODE_H + 46 };
  };

  const addNode = (type: FlowNodeTypeDef) => {
    const pos = nextPostion();
    const node: FlowNode = {
      id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      type: type.key,
      label: type.name,
      x: pos.x,
      y: pos.y,
      config: {},
    };
    // 默认值
    type.fields?.forEach((f) => {
      if (f.default !== undefined) node.config[f.key] = f.default;
    });
    setNodes((prev) => [...prev, node]);
    setSelectedId(node.id);
    markDirty();
  };

  const patchNode = (nodeId: string, patch: Partial<FlowNode>) => {
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)));
    markDirty();
  };

  const patchConfig = (nodeId: string, key: string, value: unknown) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, config: { ...n.config, [key]: value } } : n))
    );
    markDirty();
  };

  const removeNode = (nodeId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setEdges((prev) => prev.filter((e) => e.from !== nodeId && e.to !== nodeId));
    if (selectedId === nodeId) setSelectedId(null);
    if (connectFrom === nodeId) setConnectFrom(null);
    markDirty();
  };

  /* ---------- 连线 ---------- */
  const startConnect = (nodeId: string) => {
    if (!connectFrom) {
      setConnectFrom(nodeId);
      message.info('已选择起点，请点击目标节点完成连线');
      return;
    }
    if (connectFrom === nodeId) {
      setConnectFrom(null);
      return;
    }
    const exists = edges.some((e) => e.from === connectFrom && e.to === nodeId);
    if (exists) {
      message.warning('这两个节点之间已存在连线');
      setConnectFrom(null);
      return;
    }
    setEdges((prev) => [...prev, { from: connectFrom, to: nodeId }]);
    setConnectFrom(null);
    markDirty();
  };

  const removeEdge = (from: string, to: string) => {
    setEdges((prev) => prev.filter((e) => !(e.from === from && e.to === to)));
    markDirty();
  };

  /* ---------- 拖动定位 ---------- */
  const onNodeMouseDown = (e: React.MouseEvent, node: FlowNode) => {
    e.stopPropagation();
    setSelectedId(node.id);
    dragRef.current = {
      id: node.id,
      startX: e.clientX,
      startY: e.clientY,
      nodeX: node.x,
      nodeY: node.y,
    };
  };

  const onSvgMouseMove = (e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setNodes((prev) =>
      prev.map((n) =>
        n.id === drag.id
          ? { ...n, x: Math.max(0, Math.round(drag.nodeX + dx)), y: Math.max(0, Math.round(drag.nodeY + dy)) }
          : n
      )
    );
    setDirty(true);
  };

  const onSvgMouseUp = () => {
    dragRef.current = null;
  };

  /* ---------- 保存 / 试运行 / 执行 ---------- */
  const save = async () => {
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
        nodes,
        edges,
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
    } catch {
      /* client 已提示 */
    } finally {
      setRunning(false);
    }
  };

  const doRun = () => {
    if (!id) return;
    modal.confirm({
      title: `执行流程「${name}」`,
      content: '将按节点顺序真实执行，可能写入目标表。确定继续？',
      okText: '执行',
      onOk: async () => {
        setRunning(true);
        try {
          const res = await flowsApi.run(id);
          if (res.ok) {
            message.success(res.message || '执行成功');
          } else {
            modal.warning({ title: '执行未通过', content: res.message || '请查看流程日志' });
          }
        } catch {
          /* client 已提示 */
        } finally {
          setRunning(false);
        }
      },
    });
  };

  /* ---------- 配置控件 ---------- */
  const renderConfigControl = (node: FlowNode, f: FlowNodeFieldDef) => {
    const value = node.config?.[f.key];
    switch (f.type) {
      case 'project':
        return (
          <Select
            style={{ width: '100%' }}
            showSearch
            optionFilterProp="label"
            allowClear
            placeholder="选择项目"
            value={value === undefined || value === null || value === 0 ? undefined : (value as number)}
            options={options.project}
            onChange={(v) => patchConfig(node.id, f.key, v ?? null)}
          />
        );
      case 'datasource':
        return (
          <Select
            style={{ width: '100%' }}
            allowClear
            placeholder="选择数据源（0 = 本机）"
            value={value === undefined || value === null ? undefined : (value as number)}
            options={options.datasource}
            onChange={(v) => patchConfig(node.id, f.key, v ?? 0)}
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
            value={value === undefined || value === null || value === 0 ? undefined : (value as number)}
            options={options.form}
            onChange={(v) => patchConfig(node.id, f.key, v ?? null)}
          />
        );
      case 'select':
        return (
          <Select
            style={{ width: '100%' }}
            value={value as string | undefined}
            options={(f.options || []).map((o) => ({ label: o.label, value: o.value }))}
            onChange={(v) => patchConfig(node.id, f.key, v)}
          />
        );
      case 'number':
        return (
          <InputNumber
            style={{ width: '100%' }}
            value={value === undefined || value === null ? undefined : Number(value)}
            onChange={(v) => patchConfig(node.id, f.key, v ?? null)}
          />
        );
      case 'switch':
        return (
          <Switch
            checked={!!value}
            onChange={(v) => patchConfig(node.id, f.key, v)}
          />
        );
      case 'sql':
        return (
          <Input.TextArea
            rows={4}
            value={String(value || '')}
            placeholder="SELECT * FROM table WHERE ..."
            onChange={(e) => patchConfig(node.id, f.key, e.target.value)}
            style={{ fontFamily: 'Consolas, Menlo, monospace', fontSize: 12.5 }}
          />
        );
      case 'json':
        return (
          <Input.TextArea
            rows={5}
            value={String(value || '')}
            placeholder='[{"name":"张三","amount":100}]'
            onChange={(e) => patchConfig(node.id, f.key, e.target.value)}
            style={{ fontFamily: 'Consolas, Menlo, monospace', fontSize: 12.5 }}
          />
        );
      case 'kv':
        return (
          <Input.TextArea
            rows={4}
            value={String(value || '')}
            placeholder={f.hint || '每行一条：键=值'}
            onChange={(e) => patchConfig(node.id, f.key, e.target.value)}
            style={{ fontFamily: 'Consolas, Menlo, monospace', fontSize: 12.5 }}
          />
        );
      default:
        return (
          <Input
            value={String(value ?? '')}
            placeholder={f.placeholder || f.hint || `请输入${f.label}`}
            onChange={(e) => patchConfig(node.id, f.key, e.target.value)}
          />
        );
    }
  };

  /* ---------- 画布 ---------- */
  const canvasSize = useMemo(() => {
    const maxX = nodes.length ? Math.max(...nodes.map((n) => n.x + NODE_W)) : 0;
    const maxY = nodes.length ? Math.max(...nodes.map((n) => n.y + NODE_H)) : 0;
    return { width: Math.max(maxX + 60, isMobile ? 560 : 760), height: Math.max(maxY + 80, isMobile ? 420 : 520) };
  }, [nodes, isMobile]);

  const nodeCenter = (n: FlowNode) => ({ cx: n.x + NODE_W / 2, cy: n.y + NODE_H / 2 });

  const canvas = (
    <div
      style={{
        border: `1px solid ${C.line}`,
        borderRadius: 12,
        background:
          'radial-gradient(circle, rgba(54,135,255,.10) 1px, transparent 1px) 0 0 / 18px 18px, #FFFFFF',
        overflow: 'auto',
        maxHeight: isMobile ? 460 : 620,
      }}
    >
      {nodes.length === 0 ? (
        <Empty
          description={<span style={{ fontSize: 13, color: C.gray }}>从右侧节点面板添加节点开始编排</span>}
          style={{ padding: '60px 0' }}
        />
      ) : (
        <svg
          ref={svgRef}
          width={canvasSize.width}
          height={canvasSize.height}
          onMouseMove={onSvgMouseMove}
          onMouseUp={onSvgMouseUp}
          onMouseLeave={onSvgMouseUp}
          onClick={() => {
            setSelectedId(null);
            setConnectFrom(null);
          }}
          style={{ display: 'block' }}
        >
          <defs>
            <marker id="fd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={C.primary} />
            </marker>
          </defs>

          {/* 连线 */}
          {edges.map((e) => {
            const from = nodes.find((n) => n.id === e.from);
            const to = nodes.find((n) => n.id === e.to);
            if (!from || !to) return null;
            const a = nodeCenter(from);
            const b = nodeCenter(to);
            // 优先从底边出、顶边入；横向偏移时用侧边
            const vertical = Math.abs(b.cy - a.cy) >= Math.abs(b.cx - a.cx);
            const x1 = vertical ? a.cx : (b.cx > a.cx ? from.x + NODE_W : from.x);
            const y1 = vertical ? (b.cy > a.cy ? from.y + NODE_H : from.y) : a.cy;
            const x2 = vertical ? b.cx : (b.cx > a.cx ? to.x : to.x + NODE_W);
            const y2 = vertical ? (b.cy > a.cy ? to.y : to.y + NODE_H) : b.cy;
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            const path = vertical
              ? `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`
              : `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
            return (
              <g key={`${e.from}-${e.to}`}>
                <path d={path} fill="none" stroke={C.primary} strokeWidth={1.8} markerEnd="url(#fd-arrow)" opacity={0.85} />
                <circle
                  cx={mx}
                  cy={my}
                  r={8}
                  fill="#FFFFFF"
                  stroke={C.line}
                  style={{ cursor: 'pointer' }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    removeEdge(e.from, e.to);
                  }}
                />
                <text
                  x={mx}
                  y={my + 3.5}
                  textAnchor="middle"
                  fontSize={9}
                  fill={C.gray}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  ×
                </text>
              </g>
            );
          })}

          {/* 连线进行中的提示 */}
          {connectFrom && nodes.find((n) => n.id === connectFrom) && (
            <circle
              {...(() => {
                const n = nodes.find((x) => x.id === connectFrom)!;
                return { cx: n.x + NODE_W / 2, cy: n.y + NODE_H / 2, r: NODE_W / 2 + 10 };
              })()}
              fill="none"
              stroke={C.orange}
              strokeDasharray="6 4"
              strokeWidth={2}
            />
          )}

          {/* 节点 */}
          {nodes.map((n) => {
            const def = nodeMetaMap[n.type];
            const category = def?.category || 'clean';
            const color = CATEGORY_COLOR[category] || C.primary;
            const active = selectedId === n.id;
            return (
              <g
                key={n.id}
                data-role="flow-node"
                data-node-id={n.id}
                data-node-type={n.type}
                transform={`translate(${n.x},${n.y})`}
                onMouseDown={(e) => onNodeMouseDown(e, n)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (connectFrom) {
                    startConnect(n.id);
                  } else {
                    setSelectedId(n.id);
                  }
                }}
                style={{ cursor: 'grab' }}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={11}
                  fill="#FFFFFF"
                  stroke={active ? C.primary : color}
                  strokeWidth={active ? 2.2 : 1.5}
                  style={{ filter: active ? 'drop-shadow(0 3px 8px rgba(54,135,255,.25))' : 'none' }}
                />
                <rect width={5} height={NODE_H} rx={2.5} fill={color} />
                <text x={16} y={24} fontSize={13} fontWeight={600} fill={C.deep} style={{ userSelect: 'none' }}>
                  {n.label.length > 16 ? `${n.label.slice(0, 16)}…` : n.label}
                </text>
                <text x={16} y={44} fontSize={11} fill={C.gray} style={{ userSelect: 'none' }}>
                  {def?.name || n.type}
                </text>
                <text
                  x={NODE_W - 12}
                  y={NODE_H / 2 + 4}
                  fontSize={14}
                  fill={color}
                  textAnchor="middle"
                  style={{ userSelect: 'none' }}
                >
                  {def?.icon || '◇'}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );

  /* ---------- 右侧节点面板 ---------- */
  const categories = meta?.categories?.length
    ? meta.categories
    : [
        { key: 'source', name: '数据源', desc: '流程的输入' },
        { key: 'clean', name: '数据清洗与加工', desc: '过滤、转换、计算' },
        { key: 'sink', name: '数据输出', desc: '流程的结果去向' },
      ];

  const paletteNodes = (meta?.nodes || []).filter((n) => n.category === paletteTab);

  const palette = (
    <div>
      <Segmented
        block
        size="small"
        value={paletteTab}
        onChange={(v) => setPaletteTab(v as typeof paletteTab)}
        options={categories.map((c) => ({ value: c.key, label: c.name }))}
        style={{ marginBottom: 10 }}
      />
      <div style={{ maxHeight: isMobile ? 180 : 'calc(100vh - 330px)', overflow: 'auto' }}>
        {paletteNodes.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无可用节点" />
        ) : (
          paletteNodes.map((t) => (
            <div
              key={t.key}
              data-role="node-palette"
              data-node-type={t.key}
              onClick={() => addNode(t)}
              style={{
                border: `1px solid ${C.line}`,
                borderRadius: 9,
                padding: '8px 10px',
                marginBottom: 6,
                cursor: 'pointer',
                background: '#FFFFFF',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = C.primary;
                e.currentTarget.style.background = 'rgba(54,135,255,.04)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = C.line;
                e.currentTarget.style.background = '#FFFFFF';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: CATEGORY_COLOR[t.category] || C.primary, width: 14, textAlign: 'center' }}>
                  {t.icon}
                </span>
                <span style={{ fontSize: 13, color: C.deep, fontWeight: 500 }}>{t.name}</span>
                <PlusOutlined style={{ marginLeft: 'auto', fontSize: 11, color: C.gray }} />
              </div>
              <div style={{ fontSize: 11.5, color: C.gray, marginTop: 3, lineHeight: 1.45 }}>{t.desc}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  /* ---------- 属性面板 ---------- */
  const propertyPanel = selected ? (
    (() => {
      const def = nodeMetaMap[selected.type];
      return (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>节点类型</div>
            <Tag
              style={{
                color: CATEGORY_COLOR[def?.category || 'clean'] || C.primary,
                background: '#FFFFFF',
                borderColor: CATEGORY_COLOR[def?.category || 'clean'] || C.primary,
              }}
            >
              {def?.icon} {def?.name || selected.type}
            </Tag>
          </div>
          <div>
            <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>节点名称</div>
            <Input
              value={selected.label}
              maxLength={60}
              onChange={(e) => patchNode(selected.id, { label: e.target.value })}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>节点 ID</div>
            <Input value={selected.id} disabled />
          </div>
          <Divider style={{ margin: '2px 0' }} />
          {(def?.fields || []).length === 0 ? (
            <div style={{ fontSize: 12.5, color: C.gray }}>该节点无需配置参数</div>
          ) : (
            (def?.fields || []).map((f) => (
              <div key={f.key}>
                <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>
                  {f.label}
                  {f.required && <span style={{ color: C.red, marginLeft: 3 }}>*</span>}
                </div>
                {renderConfigControl(selected, f)}
                {f.hint && <div style={{ fontSize: 11, color: C.gray, marginTop: 3 }}>{f.hint}</div>}
              </div>
            ))
          )}
          <Divider style={{ margin: '2px 0' }} />
          <Space size={8} style={{ width: '100%' }}>
            <Button
              block
              icon={<LinkOutlined />}
              type={connectFrom === selected.id ? 'primary' : 'default'}
              onClick={() => startConnect(selected.id)}
            >
              {connectFrom === selected.id ? '选择目标…' : '连出'}
            </Button>
            <Button
              block
              type="primary"
              ghost
              icon={<PlusOutlined />}
              onClick={() => addNode(nodeMetaMap[selected.type] || {
                key: 'filter', name: '条件过滤', category: 'clean', icon: '⧩', desc: '', fields: [],
              })}
            >
              同类
            </Button>
          </Space>
          <Button block danger icon={<DeleteOutlined />} onClick={() => removeNode(selected.id)}>
            删除节点
          </Button>
        </Space>
      );
    })()
  ) : (
    <div>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={<span style={{ fontSize: 12.5, color: C.gray }}>点击画布节点编辑配置</span>}
      />
      <Divider style={{ margin: '8px 0' }}>连线列表</Divider>
      {edges.length === 0 ? (
        <div style={{ fontSize: 12.5, color: C.gray }}>还没有连线。选中节点后点「连出」，再点目标节点。</div>
      ) : (
        <Space orientation="vertical" size={6} style={{ width: '100%' }}>
          {edges.map((e) => {
            const from = nodes.find((n) => n.id === e.from);
            const to = nodes.find((n) => n.id === e.to);
            return (
              <div
                key={`${e.from}-${e.to}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5,
                  border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 8px',
                }}
              >
                <span style={{ color: C.deep, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {from?.label || e.from} → {to?.label || e.to}
                </span>
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DisconnectOutlined />}
                  onClick={() => removeEdge(e.from, e.to)}
                />
              </div>
            );
          })}
        </Space>
      )}
    </div>
  );

  const previewColumns = (preview?.columns || []).map((c) => ({
    title: c.name,
    dataIndex: c.name,
    key: c.name,
    ellipsis: true,
    width: 140,
    render: (v: unknown) =>
      v === null || v === undefined
        ? '-'
        : typeof v === 'object'
          ? JSON.stringify(v)
          : String(v),
  }));

  if (loading) {
    return (
      <Page title="流程设计">
        <div style={{ padding: 80, textAlign: 'center' }}>
          <Spin size="large" description="加载流程…" />
        </div>
      </Page>
    );
  }

  if (!detail) {
    return (
      <Page
        title="流程设计"
        extra={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/flows')}>返回</Button>}
      >
        <Empty description="流程不存在或无权限访问" />
      </Page>
    );
  }

  return (
    <Page
      title={`流程设计 · ${name || detail.name}`}
      subTitle={`${detail.code} · ${nodes.length} 节点 / ${edges.length} 连线${dirty ? ' · 有未保存修改' : ''}`}
      extra={
        <Space wrap size={8}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/flows')}>
            返回
          </Button>
          <Button icon={<ThunderboltOutlined />} loading={running} onClick={doPreview}>
            试运行
          </Button>
          <Button icon={<PlayCircleOutlined />} loading={running} onClick={doRun}>
            执行
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
            保存
          </Button>
        </Space>
      }
    >
      {connectFrom && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 10 }}
          title="连线模式：请点击目标节点完成连线"
          action={
            <Button size="small" onClick={() => setConnectFrom(null)}>
              取消
            </Button>
          }
        />
      )}

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={17}>
          <Card size="small" title="流程画布" styles={{ body: { padding: 10 } }}>
            {canvas}
            <div style={{ marginTop: 8, fontSize: 11.5, color: C.gray }}>
              提示：拖动节点调整位置；选中节点后点「连出」再点目标节点即可连线；点击连线上的 × 删除连线。
            </div>
          </Card>

          <Card size="small" title="基本信息" style={{ marginTop: 12 }}>
            <Row gutter={12}>
              <Col xs={24} md={10}>
                <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>流程名称</div>
                <Input
                  value={name}
                  maxLength={60}
                  onChange={(e) => {
                    setName(e.target.value);
                    markDirty();
                  }}
                />
              </Col>
              <Col xs={24} md={14}>
                <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>流程说明</div>
                <Input
                  value={description}
                  maxLength={200}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    markDirty();
                  }}
                />
              </Col>
            </Row>
          </Card>
        </Col>

        <Col xs={24} lg={7}>
          <Card size="small" title="节点面板" styles={{ body: { padding: 10 } }}>
            {palette}
          </Card>
          <Card size="small" title="节点属性" style={{ marginTop: 12 }} styles={{ body: { padding: 12 } }}>
            {propertyPanel}
          </Card>
        </Col>
      </Row>

      <Modal
        title="试运行结果（未写入目标）"
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={<Button onClick={() => setPreviewOpen(false)}>关闭</Button>}
        width={isMobile ? '96%' : 900}
      >
        {preview && (
          <div>
            <Space wrap size={12} style={{ marginBottom: 10 }}>
              <Tag style={{ color: C.primary, background: '#FFFFFF', borderColor: C.primary }}>
                输出 {preview.rowCount} 行
              </Tag>
              <span style={{ fontSize: 12.5, color: C.gray }}>
                预览前 {preview.rows.length} 行
              </span>
            </Space>
            <div style={{ marginBottom: 10 }}>
              {preview.logs.map((l, i) => (
                <div
                  key={`${l.nodeId}-${i}`}
                  style={{
                    display: 'flex', gap: 8, fontSize: 12.5, padding: '4px 0',
                    borderBottom: `1px solid ${C.line}`,
                  }}
                >
                  <span style={{ color: C.deep, width: 150, flexShrink: 0 }}>{l.name}</span>
                  <span style={{ color: C.gray, flex: 1 }}>
                    {l.skipped
                      ? '（输出节点，试运行跳过）'
                      : `输入 ${l.inputRows ?? 0} 行 → 输出 ${l.outputRows ?? 0} 行 · ${l.ms ?? 0}ms`}
                  </span>
                </div>
              ))}
            </div>
            <Table
              size="small"
              rowKey={(_, index) => String(index)}
              columns={previewColumns}
              dataSource={preview.rows as Record<string, unknown>[]}
              scroll={{ x: Math.max(500, previewColumns.length * 140), y: 320 }}
              pagination={false}
              locale={{ emptyText: '没有输出数据' }}
            />
          </div>
        )}
      </Modal>
    </Page>
  );
}
