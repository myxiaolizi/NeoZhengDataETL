/**
 * 数据项目列表（V6.1 页面规范）
 *
 * 结构：左=返回区+本页名称，右=搜索区（分组筛选 / 关键字）+ 新建 → 数据卡片（5 个）→ 分组快筛条 + 项目卡片网格
 * 交互：新建/编辑/删除项目、**分组管理（Modal，可增删改）**、令牌、启停、搜索、分页；
 *       统计一律用页面已有数据就地算。页面不提供刷新按钮（增删改后自动重新拉取）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, App, Button, Col, Empty, Grid, Input, Pagination, Row, Select, Space,
  Spin, Tag, Tooltip,
} from 'antd';
import {
  AppstoreOutlined, DeleteOutlined, EditOutlined, FolderOutlined, PlusOutlined,
  ReloadOutlined, SettingOutlined, UnorderedListOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import Page from '@/components/Page';
import type { StatCardItem } from '@/components/StatCards';
import { usePermission } from '@/stores/app';
import { NEUTRAL, PALETTE } from '@/theme';
import {
  deleteProject, deleteProjectGroup, fetchProjectGroups, fetchProjects,
  regenerateToken, updateProject,
} from '@/api/projects';
import type { ProjectGroupData, ProjectGroupNode, ProjectRow } from '@/api/projects';
import { fmtNum } from '@/utils';
import ProjectCard from './projects/ProjectCard';
import ProjectFormModal from './projects/ProjectFormModal';
import GroupFormModal from './projects/GroupFormModal';
import GroupManageModal from './projects/GroupManageModal';

const { useBreakpoint } = Grid;

type GroupKey = 'all' | string;

const ALL_KEY: GroupKey = 'all';
const UNGROUPED_KEY: GroupKey = '0';

/** 是否本月创建 */
function isThisMonth(v?: string | null): boolean {
  if (!v) return false;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export default function ProjectsPage() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const can = usePermission();
  const { message, modal } = App.useApp();

  const [groups, setGroups] = useState<ProjectGroupData | null>(null);
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [groupKey, setGroupKey] = useState<GroupKey>(ALL_KEY);
  const [includeSub, setIncludeSub] = useState(true);
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const [formOpen, setFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectRow | null>(null);
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ProjectGroupNode | null>(null);
  /** 分组管理 Modal（V6.1 新增：分组编辑/删除的主入口） */
  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const canWrite = can('project:write');

  /** 加载分组 + 项目 */
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
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
    } catch (e) {
      setError(e instanceof Error ? e.message : '数据项目加载失败');
    } finally {
      setLoading(false);
    }
  }, [groupKey, includeSub, keyword]);

  useEffect(() => { void load(); }, [load]);

  // 切换分组/搜索时回到第一页
  useEffect(() => { setPage(1); }, [groupKey, keyword, pageSize]);

  const flatGroups = groups?.list || [];
  const groupStats = groups?.stats;

  /** 分组快筛条：全部 / 未分组 / 各分组 */
  const groupFilters = useMemo(() => {
    const items: { key: GroupKey; label: string; count: number; icon?: React.ReactNode }[] = [
      { key: ALL_KEY, label: '全部', count: groupStats?.projects ?? rows.length, icon: <AppstoreOutlined /> },
      { key: UNGROUPED_KEY, label: '未分组', count: groupStats?.ungrouped ?? 0, icon: <FolderOutlined /> },
    ];
    for (const g of flatGroups) {
      items.push({
        key: String(g.id),
        label: g.name,
        count: g.totalProjectCount ?? g.projectCount ?? 0,
        icon: <UnorderedListOutlined />,
      });
    }
    return items;
  }, [flatGroups, groupStats, rows.length]);

  /** 搜索区的分组下拉（与快筛条共用同一状态） */
  const groupSelectOptions = useMemo(
    () => groupFilters.map((f) => ({ label: `${f.label}（${f.count}）`, value: f.key })),
    [groupFilters],
  );

  const currentGroup = useMemo(() => {
    if (groupKey === ALL_KEY || groupKey === UNGROUPED_KEY) return null;
    return flatGroups.find((g) => String(g.id) === String(groupKey)) || null;
  }, [groupKey, flatGroups]);

  /** 数据卡片：全部用当前列表数据就地统计，不新增后端接口 */
  const statItems = useMemo<StatCardItem[]>(() => {
    const total = rows.length;
    const enabled = rows.filter((r) => Number(r.status) === 1).length;
    const disabled = total - enabled;
    const monthNew = rows.filter((r) => isThisMonth(r.created_at)).length;
    const failed = rows.reduce((s, r) => s + Number(r.failedLogs || 0), 0);
    return [
      { key: 'total', label: '数据项目', value: fmtNum(total), suffix: '个', color: PALETTE.primary, hint: `分组 ${groupStats?.groups ?? 0} 个` },
      { key: 'enabled', label: '已启用', value: fmtNum(enabled), suffix: '个', color: PALETTE.green, hint: total ? `占比 ${Math.round((enabled / total) * 100)}%` : '暂无项目' },
      { key: 'disabled', label: '已停用', value: fmtNum(disabled), suffix: '个', color: PALETTE.gray, hint: '停止接收推送' },
      { key: 'month', label: '本月新增', value: fmtNum(monthNew), suffix: '个', color: PALETTE.cyan, hint: '按创建时间统计' },
      {
        key: 'failed',
        label: '推送失败',
        value: fmtNum(failed),
        suffix: '条',
        color: failed > 0 ? PALETTE.red : PALETTE.teal,
        hint: failed > 0 ? '需排查失败日志' : '暂无失败记录',
      },
    ];
  }, [rows, groupStats]);

  /** 分页后的项目 */
  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page, pageSize]);

  const openCreate = () => { setEditingProject(null); setFormOpen(true); };
  const openEdit = (p: ProjectRow) => { setEditingProject(p); setFormOpen(true); };
  const openCreateGroup = () => { setEditingGroup(null); setGroupFormOpen(true); };

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
          await load();
        } catch { /* 已 toast */ }
      },
    });
  };

  /** 重新生成令牌 */
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
          await load();
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
          await load();
        } catch { /* 已 toast */ }
      },
    });
  };

  /* ---------------- 渲染 ---------------- */

  const searchArea = (
    <>
      <Select
        value={groupKey}
        onChange={(v: GroupKey) => setGroupKey(v)}
        options={groupSelectOptions}
        style={{ width: isMobile ? '100%' : 168 }}
        placeholder="分组筛选"
      />
      <Input.Search
        allowClear
        placeholder="项目名称 / 编码 / 描述"
        style={{ width: isMobile ? '100%' : 230 }}
        value={keywordInput}
        onChange={(e) => setKeywordInput(e.target.value)}
        onSearch={(v) => setKeyword(v.trim())}
      />
    </>
  );

  const actionsArea = canWrite ? (
    <>
      <Button icon={<SettingOutlined />} onClick={() => setGroupManageOpen(true)}>
        {isMobile ? '' : '分组管理'}
      </Button>
      <Button icon={<FolderOutlined />} onClick={openCreateGroup}>
        {isMobile ? '' : '新建分组'}
      </Button>
      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
        新建项目
      </Button>
    </>
  ) : (
    <Button icon={<SettingOutlined />} onClick={() => setGroupManageOpen(true)}>
      {isMobile ? '' : '分组管理'}
    </Button>
  );

  /*
   * V6.1：页面不再提供刷新按钮（用户要求「所有的页面都不需要刷新按钮」）。
   * 数据刷新由以下时机自动触发：搜索 / 分组筛选 / 包含子分组切换 / 分页 /
   * 新建·编辑·删除·启停成功后的回调 —— 已覆盖全部刷新场景。
   */

  return (
    <Page
      title="数据项目"
      search={searchArea}
      actions={actionsArea}
      stats={statItems}
    >
      {/* 分组快筛条（保留 V4.0 的标签筛选交互，位于数据卡片下方） */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '10px 14px', marginBottom: 14,
          border: `1px solid ${NEUTRAL.border}`, borderRadius: 10, background: NEUTRAL.surface,
        }}
      >
        <Space size={6} wrap>
          {groupFilters.map((f) => {
            const active = groupKey === f.key;
            return (
              <Tag.CheckableTag
                key={f.key}
                checked={active}
                onChange={() => setGroupKey(f.key)}
                style={{
                  fontSize: 12.5, padding: '4px 12px', borderRadius: 14,
                  border: `1px solid ${active ? PALETTE.primary : NEUTRAL.border}`,
                  background: active ? PALETTE.primary : NEUTRAL.surfaceAlt,
                  color: active ? NEUTRAL.textInverse : NEUTRAL.textSecondary,
                  fontWeight: active ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {f.icon} {f.label}
                <span style={{ marginLeft: 5, opacity: 0.78 }}>{f.count}</span>
              </Tag.CheckableTag>
            );
          })}
        </Space>

        <div style={{ flex: 1 }} />

        <Space size={8}>
          {canWrite && (
            <Tooltip title="分组管理（增删改）">
              <Button
                size="small"
                icon={<SettingOutlined />}
                onClick={() => setGroupManageOpen(true)}
              >
                管理
              </Button>
            </Tooltip>
          )}
          {currentGroup && canWrite && (
            <>
              <Tooltip title="编辑当前分组">
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => { setEditingGroup(currentGroup); setGroupFormOpen(true); }}
                />
              </Tooltip>
              <Tooltip title="删除当前分组">
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => onDeleteGroup(currentGroup)}
                />
              </Tooltip>
            </>
          )}
          {groupKey !== ALL_KEY && groupKey !== UNGROUPED_KEY && (
            <Tooltip title="包含子分组的项目">
              <Tag.CheckableTag
                checked={includeSub}
                onChange={setIncludeSub}
                style={{
                  fontSize: 12, padding: '3px 10px', borderRadius: 12,
                  border: `1px solid ${NEUTRAL.border}`,
                  background: includeSub ? NEUTRAL.surfaceSunken : NEUTRAL.surface,
                  color: NEUTRAL.textSecondary,
                }}
              >
                含子分组
              </Tag.CheckableTag>
            </Tooltip>
          )}
        </Space>
      </div>

      {/* 错误态 */}
      {error && !loading ? (
        <Alert
          type="error"
          showIcon
          title="加载失败"
          description={error}
          action={<Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>重试</Button>}
        />
      ) : null}

      {/* 项目卡片网格 */}
      <Spin spinning={loading}>
        {rows.length === 0 && !loading && !error ? (
          <Empty
            description={
              <span style={{ color: NEUTRAL.textTertiary }}>
                {keyword ? `没有匹配「${keyword}」的项目` : '暂无项目'}
              </span>
            }
            style={{ padding: '60px 0' }}
          >
            {canWrite && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新建项目
              </Button>
            )}
          </Empty>
        ) : (
          <>
            <Row gutter={[14, 14]}>
              {pagedRows.map((p) => (
                <Col key={p.id} xs={24} sm={12} lg={8} xl={6}>
                  <ProjectCard
                    project={p}
                    canWrite={canWrite}
                    toggling={togglingId === p.id}
                    onOpen={() => navigate(`/projects/${p.id}`)}
                    onEdit={() => openEdit(p)}
                    onDelete={() => onDeleteProject(p)}
                    onRegenerateToken={() => onRegenerateToken(p)}
                    onToggleStatus={(checked) => onToggleStatus(p, checked)}
                  />
                </Col>
              ))}
            </Row>

            {rows.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
                <Pagination
                  current={page}
                  pageSize={pageSize}
                  total={rows.length}
                  showSizeChanger
                  pageSizeOptions={[12, 24, 48]}
                  showTotal={(t) => `共 ${t} 个项目`}
                  onChange={(p, ps) => { setPage(p); setPageSize(ps); }}
                  simple={isMobile}
                />
              </div>
            )}
          </>
        )}
      </Spin>

      {/* 弹窗：内容少一律用 Modal */}
      <ProjectFormModal
        open={formOpen}
        project={editingProject}
        groups={flatGroups}
        onClose={() => setFormOpen(false)}
        onSaved={async () => { setFormOpen(false); await load(); }}
      />
      <GroupFormModal
        open={groupFormOpen}
        group={editingGroup}
        flat={flatGroups}
        onClose={() => setGroupFormOpen(false)}
        onSaved={async () => { setGroupFormOpen(false); await load(); }}
      />
      {/*
       * V6.1 新增：分组管理 Modal —— 分组编辑/删除的**主入口**。
       * 之前的实现只在「选中某个分组标签后」才在筛选条右侧露出编辑/删除小图标，
       * 用户反馈「分组无法管理和删除」。现在改为一个明确的、始终可见的管理面板：
       * 树形列出全部分组（含层级与项目数），每行可编辑 / 删除 / 新建子分组。
       */}
      <GroupManageModal
        open={groupManageOpen}
        groups={groups}
        loading={loading}
        canWrite={canWrite}
        onClose={() => setGroupManageOpen(false)}
        onChanged={async () => { await load(); }}
        onDeleted={(id) => {
          // 删掉的正是当前筛选的分组 → 回到「全部」，避免停在已不存在的分组上
          if (String(groupKey) === String(id)) setGroupKey(ALL_KEY);
        }}
      />
    </Page>
  );
}
