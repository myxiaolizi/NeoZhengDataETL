/** 数据项目列表：左侧分组树 + 右侧 ProTable（搜索 / 分页 / 增删改 / 令牌管理） */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App, Badge, Button, Card, Col, Dropdown, Empty, Grid, Input, Popconfirm, Row, Select,
  Space, Switch, Tag, Tooltip, Tree, Typography,
} from 'antd';
import type { DataNode } from 'antd/es/tree';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  DeleteOutlined, EditOutlined, EllipsisOutlined, FolderOpenOutlined, KeyOutlined,
  PlusOutlined, ReloadOutlined, SettingOutlined, TableOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import Page from '@/components/Page';
import { useAppStore, usePermission } from '@/stores/app';
import {
  deleteProject, deleteProjectGroup, fetchProjectGroups, fetchProjects, regenerateToken,
  updateProject,
} from '@/api/projects';
import type { ProjectGroupData, ProjectGroupNode, ProjectRow } from '@/api/projects';
import { fmtAgo, fmtNum, fmtTime } from '@/utils';
import ProjectFormModal from './projects/ProjectFormModal';
import GroupFormModal from './projects/GroupFormModal';

const { useBreakpoint } = Grid;
const { Text } = Typography;

type GroupKey = 'all' | string;

const ALL_KEY: GroupKey = 'all';
const UNGROUPED_KEY: GroupKey = '0';

export default function ProjectsPage() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const can = usePermission();
  const { message, modal } = App.useApp();

  const [groups, setGroups] = useState<ProjectGroupData | null>(null);
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [groupKey, setGroupKey] = useState<GroupKey>(ALL_KEY);
  const [includeSub, setIncludeSub] = useState(true);
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [formOpen, setFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectRow | null>(null);
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ProjectGroupNode | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const canWrite = can('project:write');

  /** 加载分组 + 项目（并行） */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = {
        keyword,
        groupId: groupKey === ALL_KEY ? '' : groupKey,
        includeSubGroups: includeSub && groupKey !== ALL_KEY && groupKey !== UNGROUPED_KEY,
      };
      const [g, list] = await Promise.all([
        fetchProjectGroups(),
        fetchProjects(query),
      ]);
      setGroups(g);
      setRows(list);
    } catch {
      // 错误已由 api client 统一 toast
    } finally {
      setLoading(false);
    }
    // groupKey/includeSub/keyword 变化时重新请求
  }, [groupKey, includeSub, keyword]);

  useEffect(() => { void load(); }, [load]);

  const flatGroups = groups?.list || [];

  /** 当前选中的分组对象 */
  const currentGroup = useMemo(() => {
    if (groupKey === ALL_KEY || groupKey === UNGROUPED_KEY) return null;
    return flatGroups.find((g) => String(g.id) === String(groupKey)) || null;
  }, [groupKey, flatGroups]);

  /** 分组树节点 */
  const treeData = useMemo<DataNode[]>(() => {
    const stats = groups?.stats;
    const build = (nodes: ProjectGroupNode[]): DataNode[] =>
      nodes.map((n) => ({
        key: String(n.id),
        title: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <span style={{ color: n.color || '#3687FF' }}>{n.icon || '▦'}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
            <Tag
              color="#B5B5B6"
              style={{ marginInlineStart: 4, fontSize: 11, lineHeight: '16px', paddingInline: 5 }}
            >
              {n.totalProjectCount ?? n.projectCount ?? 0}
            </Tag>
          </span>
        ),
        children: n.children?.length ? build(n.children) : undefined,
      }));

    const root: DataNode[] = [
      {
        key: ALL_KEY,
        title: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FolderOpenOutlined style={{ color: '#2D6FE4' }} />
            <span>全部项目</span>
            <Tag color="#3687FF" style={{ fontSize: 11, lineHeight: '16px', paddingInline: 5 }}>
              {stats?.projects ?? rows.length}
            </Tag>
          </span>
        ),
      },
      {
        key: UNGROUPED_KEY,
        title: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FolderOpenOutlined style={{ color: '#B5B5B6' }} />
            <span>未分组</span>
            <Tag color="#B5B5B6" style={{ fontSize: 11, lineHeight: '16px', paddingInline: 5 }}>
              {stats?.ungrouped ?? 0}
            </Tag>
          </span>
        ),
      },
    ];
    return [...root, ...build(groups?.tree || [])];
  }, [groups, rows.length]);

  const reloadKeepPage = async () => {
    await load();
  };

  /** 打开新建 / 编辑项目 */
  const openCreate = () => {
    setEditingProject(null);
    setFormOpen(true);
  };
  const openEdit = (p: ProjectRow) => {
    setEditingProject(p);
    setFormOpen(true);
  };

  /** 删除项目 */
  const onDeleteProject = (p: ProjectRow) => {
    modal.confirm({
      title: `删除项目「${p.name}」？`,
      content: '将同时删除该项目的原始数据表、解析表、日志表、子表与字段定义，操作不可恢复。',
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteProject(p.id);
          message.success('项目已删除');
          await reloadKeepPage();
        } catch { /* 已 toast */ }
      },
    });
  };

  /** 重新生成推送令牌 */
  const onRegenerateToken = (p: ProjectRow) => {
    modal.confirm({
      title: `重新生成「${p.name}」的推送令牌？`,
      content: '旧令牌立即失效，必须同步更新简道云里的推送地址，否则推送会失败。',
      okText: '确认生成',
      cancelText: '取消',
      onOk: async () => {
        try {
          await regenerateToken(p.id);
          message.success('推送令牌已重新生成，请到项目详情复制新的推送地址');
          await reloadKeepPage();
        } catch { /* 已 toast */ }
      },
    });
  };

  /** 启用 / 停用 */
  const onToggleStatus = async (p: ProjectRow, checked: boolean) => {
    setTogglingId(p.id);
    try {
      await updateProject(p.id, { status: checked ? 1 : 0 });
      setRows((prev) => prev.map((r) => (r.id === p.id ? { ...r, status: checked ? 1 : 0 } : r)));
      message.success(checked ? '项目已启用' : '项目已停用');
    } catch {
      // 失败保持原状态
    } finally {
      setTogglingId(null);
    }
  };

  /** 删除分组 */
  const onDeleteGroup = (g: ProjectGroupNode) => {
    modal.confirm({
      title: `删除分组「${g.name}」？`,
      content: '分组下的项目会自动上移到上级分组（无上级则变为未分组），项目数据不会被删除。若存在子分组，请先处理子分组。',
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          const r = await deleteProjectGroup(g.id);
          message.success(r.movedProjects ? `分组已删除，${r.movedProjects} 个项目已移动` : '分组已删除');
          setGroupKey(ALL_KEY);
          await reloadKeepPage();
        } catch { /* 已 toast */ }
      },
    });
  };

  const columns = useMemo<ProColumns<ProjectRow>[]>(() => {
    const cols: ProColumns<ProjectRow>[] = [
      {
        title: '项目',
        dataIndex: 'name',
        key: 'name',
        width: 280,
        fixed: isMobile ? undefined : 'left',
        render: (_dom, row) => (
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <a
                onClick={() => navigate(`/projects/${row.id}`)}
                style={{ fontWeight: 600, color: '#003378', fontSize: 13.5 }}
              >
                {row.name}
              </a>
              {row.code && <Tag color="#73DBFF" style={{ fontSize: 11 }}>{row.code}</Tag>}
              {Number(row.parse_enabled ?? 1) === 0 && <Tag color="#B5B5B6" style={{ fontSize: 11 }}>未解析</Tag>}
            </div>
            {row.description && (
              <Tooltip title={row.description}>
                <div
                  style={{
                    fontSize: 12, color: 'rgba(0,51,120,.5)', marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240,
                  }}
                >
                  {row.description}
                </div>
              </Tooltip>
            )}
          </div>
        ),
      },
      {
        title: '分组',
        dataIndex: 'group_name',
        key: 'group_name',
        width: 130,
        hideInTable: isMobile,
        render: (_d, row) => (row.group_name
          ? <Tag color="#45B4FF">{row.group_name}</Tag>
          : <Text type="secondary" style={{ fontSize: 12 }}>未分组</Text>),
      },
      {
        title: '数据量',
        dataIndex: 'dataCount',
        key: 'dataCount',
        width: 100,
        align: 'right',
        sorter: (a, b) => Number(a.dataCount || 0) - Number(b.dataCount || 0),
        render: (_d, row) => <span style={{ fontWeight: 600, color: '#2D6FE4' }}>{fmtNum(row.dataCount || 0)}</span>,
      },
      {
        title: '字段',
        dataIndex: 'fieldCount',
        key: 'fieldCount',
        width: 84,
        align: 'right',
        hideInTable: isMobile,
        render: (_d, row) => <span style={{ color: 'rgba(0,51,120,.72)' }}>{fmtNum(row.fieldCount || row.field_count || 0)}</span>,
      },
      {
        title: '失败日志',
        dataIndex: 'failedLogs',
        key: 'failedLogs',
        width: 96,
        align: 'right',
        hideInTable: isMobile,
        render: (_d, row) => {
          const n = Number(row.failedLogs || 0);
          return n > 0
            ? <Badge count={n} color="#E86161" overflowCount={999} />
            : <span style={{ color: '#A2D73C' }}>0</span>;
        },
      },
      {
        title: '最后推送',
        dataIndex: 'last_push_at',
        key: 'last_push_at',
        width: 130,
        hideInTable: isMobile,
        render: (_d, row) => (
          <Tooltip title={row.last_push_at ? fmtTime(row.last_push_at) : '从未推送'}>
            <span style={{ fontSize: 12, color: row.last_push_at ? 'rgba(0,51,120,.72)' : '#B5B5B6' }}>
              {row.last_push_at ? fmtAgo(row.last_push_at) : '未接收'}
            </span>
          </Tooltip>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 84,
        render: (_d, row) => (
          <Switch
            size="small"
            checked={Number(row.status) === 1}
            loading={togglingId === row.id}
            disabled={!canWrite}
            checkedChildren="启用"
            unCheckedChildren="停用"
            onChange={(v) => void onToggleStatus(row, v)}
          />
        ),
      },
      {
        title: '操作',
        key: 'action',
        width: isMobile ? 120 : 190,
        fixed: isMobile ? undefined : 'right',
        render: (_d, row) => {
          const moreItems = [
            {
              key: 'fields',
              icon: <SettingOutlined />,
              label: '字段配置',
              disabled: !can('field:write'),
              onClick: () => navigate(`/projects/${row.id}/fields`),
            },
            {
              key: 'token',
              icon: <KeyOutlined />,
              label: '重新生成令牌',
              disabled: !canWrite,
              onClick: () => onRegenerateToken(row),
            },
            { type: 'divider' as const },
            {
              key: 'delete',
              icon: <DeleteOutlined />,
              label: '删除项目',
              danger: true,
              disabled: !canWrite,
              onClick: () => onDeleteProject(row),
            },
          ];
          return (
            <Space size={2} wrap>
              <Button type="link" size="small" icon={<TableOutlined />} onClick={() => navigate(`/projects/${row.id}`)}>
                详情
              </Button>
              {canWrite && (
                <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
                  编辑
                </Button>
              )}
              <Dropdown menu={{ items: moreItems }} trigger={['click']}>
                <Button type="text" size="small" icon={<EllipsisOutlined />} />
              </Dropdown>
            </Space>
          );
        },
      },
    ];
    return cols;
  }, [isMobile, canWrite, togglingId, navigate]);

  const groupSelectOptions = useMemo(() => {
    const out: { label: string; value: string }[] = [
      { label: `全部项目（${groups?.stats?.projects ?? rows.length}）`, value: ALL_KEY },
      { label: `未分组（${groups?.stats?.ungrouped ?? 0}）`, value: UNGROUPED_KEY },
    ];
    const walk = (nodes: ProjectGroupNode[], depth: number) => {
      nodes.forEach((n) => {
        out.push({
          label: `${'　'.repeat(depth)}${depth ? '└ ' : ''}${n.name}（${n.totalProjectCount ?? n.projectCount ?? 0}）`,
          value: String(n.id),
        });
        if (n.children?.length) walk(n.children, depth + 1);
      });
    };
    walk(groups?.tree || [], 0);
    return out;
  }, [groups, rows.length]);

  return (
    <Page
      title="数据项目"
      subTitle="每个项目对应一张数据表与一套推送令牌，按分组归类管理"
      extra={
        <Space size={8} wrap>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void reloadKeepPage()}>
            刷新
          </Button>
          {canWrite && (
            <Button icon={<FolderOpenOutlined />} onClick={() => { setEditingGroup(null); setGroupFormOpen(true); }}>
              新建分组
            </Button>
          )}
          {canWrite && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={openCreate}
            >
              新建项目
            </Button>
          )}
        </Space>
      }
    >
      <Row gutter={[12, 12]}>
        {/* ── 左侧：分组树（移动端改为下拉） ── */}
        {!isMobile && (
          <Col flex="236px">
            <Card
              variant="outlined"
              style={{ borderColor: '#DCDDDD', borderRadius: 12 }}
              styles={{ body: { padding: 12 } }}
              title={<span style={{ fontSize: 13.5, fontWeight: 600, color: '#003378' }}>项目分组</span>}
              extra={
                canWrite && currentGroup ? (
                  <Space size={0}>
                    <Tooltip title="编辑分组">
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => { setEditingGroup(currentGroup); setGroupFormOpen(true); }}
                      />
                    </Tooltip>
                    <Popconfirm
                      title="删除该分组？"
                      description="分组内项目会上移到上级分组"
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => onDeleteGroup(currentGroup)}
                    >
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                ) : null
              }
            >
              {groups ? (
                <Tree
                  blockNode
                  defaultExpandAll
                  selectedKeys={[groupKey]}
                  treeData={treeData}
                  onSelect={(keys) => {
                    const k = keys.length ? String(keys[0]) : ALL_KEY;
                    setGroupKey(k);
                    setPage(1);
                  }}
                  style={{ fontSize: 13 }}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="加载中" />
              )}
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #DCDDDD', fontSize: 11.5, color: '#B5B5B6' }}>
                共 {groups?.stats?.groups ?? 0} 个分组 · 最多 {groups?.maxDepth ?? 5} 级
              </div>
            </Card>
          </Col>
        )}

        {/* ── 右侧：列表 ── */}
        <Col flex="auto" style={{ minWidth: 0 }}>
          <Card
            variant="outlined"
            style={{ borderColor: '#DCDDDD', borderRadius: 12 }}
            styles={{ body: { padding: isMobile ? 12 : 14 } }}
          >
            <Space size={8} wrap style={{ marginBottom: 10, width: '100%' }}>
              {isMobile && (
                <Select
                  style={{ width: '100%' }}
                  size="large"
                  value={groupKey}
                  options={groupSelectOptions}
                  onChange={(v: string) => { setGroupKey(v); setPage(1); }}
                />
              )}
              <Input.Search
                allowClear
                placeholder="搜索项目名称 / 编码 / 描述"
                style={{ width: isMobile ? '100%' : 300 }}
                size={isMobile ? 'large' : 'middle'}
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onSearch={(v) => { setKeyword(v.trim()); setPage(1); }}
                enterButton
              />
              {groupKey !== ALL_KEY && groupKey !== UNGROUPED_KEY && (
                <Space size={6}>
                  <Text style={{ fontSize: 12, color: 'rgba(0,51,120,.6)' }}>含子分组</Text>
                  <Switch size="small" checked={includeSub} onChange={setIncludeSub} />
                </Space>
              )}
              <Text type="secondary" style={{ fontSize: 12 }}>
                共 {rows.length} 个项目
              </Text>
            </Space>

            {isMobile ? (
              /* 移动端：卡片列表（触控友好，避免横向滚动） */
              <div>
                {rows.length ? rows.map((row) => (
                  <Card
                    key={row.id}
                    size="small"
                    variant="outlined"
                    style={{ borderColor: '#DCDDDD', borderRadius: 10, marginBottom: 8 }}
                    styles={{ body: { padding: 12 } }}
                    onClick={() => navigate(`/projects/${row.id}`)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#003378' }}>{row.name}</div>
                        <div style={{ fontSize: 12, color: 'rgba(0,51,120,.55)', marginTop: 2 }}>
                          {row.group_name || '未分组'} · 数据 {fmtNum(row.dataCount || 0)} · 字段 {fmtNum(row.fieldCount || 0)}
                        </div>
                      </div>
                      <Tag color={Number(row.status) === 1 ? '#A2D73C' : '#B5B5B6'}>
                        {Number(row.status) === 1 ? '启用' : '停用'}
                      </Tag>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12, color: '#B5B5B6' }}>
                      最后推送：{row.last_push_at ? fmtAgo(row.last_push_at) : '未接收'}
                      {Number(row.failedLogs || 0) > 0 && (
                        <Tag color="#E86161" style={{ marginInlineStart: 8 }}>失败 {fmtNum(row.failedLogs || 0)}</Tag>
                      )}
                    </div>
                  </Card>
                )) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? '加载中' : '暂无项目'} />
                )}
              </div>
            ) : (
              <ProTable<ProjectRow>
                rowKey="id"
                size="middle"
                loading={loading}
                search={false}
                options={false}
                cardProps={false}
                ghost
                columns={columns}
                dataSource={rows}
                scroll={{ x: 960 }}
                pagination={{
                  current: page,
                  pageSize,
                  total: rows.length,
                  showSizeChanger: true,
                  pageSizeOptions: [10, 20, 50, 100],
                  showTotal: (t) => `共 ${t} 条`,
                  onChange: (p, ps) => { setPage(p); setPageSize(ps); },
                }}
              />
            )}
          </Card>
        </Col>
      </Row>

      <ProjectFormModal
        open={formOpen}
        project={editingProject}
        groups={groups?.tree || []}
        defaultGroupId={groupKey !== ALL_KEY && groupKey !== UNGROUPED_KEY ? Number(groupKey) : null}
        onClose={() => setFormOpen(false)}
        onSaved={() => { void load(); }}
      />

      <GroupFormModal
        open={groupFormOpen}
        group={editingGroup}
        flat={flatGroups}
        defaultParentId={groupKey !== ALL_KEY && groupKey !== UNGROUPED_KEY ? Number(groupKey) : null}
        onClose={() => setGroupFormOpen(false)}
        onSaved={() => { void load(); }}
      />
    </Page>
  );
}
