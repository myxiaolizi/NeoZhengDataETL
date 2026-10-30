/**
 * 分组管理弹窗（V6.1 · 要求 3）
 *
 * 用户投诉「数据项目分组无法管理和删除」。Lead 实测后端 100% 正常
 * （创建 / 改名 / 删除都返回 200，有子分组时正确拒绝并给中文提示），
 * 问题**纯粹在前端交互设计**：V4.1 里分组的编辑 / 删除按钮只在
 * 「筛选条上选中了某个分组」之后才出现在最右侧，用户根本发现不了入口。
 *
 * 本组件给出一个**常驻的、显式的**管理入口：
 *   筛选条右侧「分组管理」按钮 → 打开本弹窗 →
 *   树形列出全部分组（按 parentId 层级缩进 + 每组项目数 / 子分组数）
 *   每行右侧：编辑（复用 GroupFormModal）/ 在此新建子分组 / 删除
 *   顶部：新建顶层分组
 *
 * 删除策略（与 src/project-groups.js deleteGroup 完全对齐）：
 *   · 有子分组 → 后端会 400 拒绝。**前端提前禁用删除按钮**并给
 *     Tooltip「请先处理子分组」，同时保留 catch 兜底（用明确文案展示后端原因）。
 *   · 有项目 → confirm 里说清项目会移到哪（父分组名 or「未分组」），
 *     并强调「项目数据不会被删除」。
 *   · 删除成功后刷新分组列表 + 项目列表；若删的是当前选中分组 → 回到「全部」。
 *
 * 不新增任何后端接口，只用已有的
 * fetchProjectGroups / createProjectGroup / updateProjectGroup / deleteProjectGroup。
 */
import React, { useMemo, useState } from 'react';
import { Alert, App, Button, Empty, Modal, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import {
  DeleteOutlined, EditOutlined, FolderAddOutlined, FolderOutlined, PlusOutlined,
} from '@ant-design/icons';
import { deleteProjectGroup } from '@/api/projects';
import type { ProjectGroupData, ProjectGroupNode } from '@/api/projects';
import { NEUTRAL, PALETTE } from '@/theme';
import GroupFormModal from './GroupFormModal';
import { flattenGroupTree, type GroupTreeRow } from './groupTree';

const { Text } = Typography;

export interface GroupManageModalProps {
  open: boolean;
  /** 分组数据（list/tree/stats/maxDepth），由父页面传入，避免重复请求 */
  groups: ProjectGroupData | null;
  /** 列表是否正在加载 */
  loading?: boolean;
  canWrite: boolean;
  onClose: () => void;
  /** 任何增删改成功后调用：父页面刷新分组列表 + 项目列表 */
  onChanged: () => void | Promise<void>;
  /** 删除成功后调用，参数为被删分组 id（父页面据此判断是否回到「全部」） */
  onDeleted?: (id: number) => void;
}

export default function GroupManageModal({
  open, groups, loading, canWrite, onClose, onChanged, onDeleted,
}: GroupManageModalProps) {
  const { message, modal } = App.useApp();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectGroupNode | null>(null);
  const [defaultParentId, setDefaultParentId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const flat = groups?.list || [];
  const maxDepth = Number(groups?.maxDepth || 5);
  const rows = useMemo(() => flattenGroupTree(flat), [flat]);

  /** 新建顶层分组 */
  const openCreateRoot = () => {
    setEditing(null);
    setDefaultParentId(null);
    setFormOpen(true);
  };

  /** 在 row 下新建子分组 */
  const openCreateChild = (row: GroupTreeRow) => {
    setEditing(null);
    setDefaultParentId(Number(row.node.id));
    setFormOpen(true);
  };

  /** 编辑（改名 / 图标 / 颜色 / 备注 / 上级 / 排序，全部复用 GroupFormModal） */
  const openEdit = (row: GroupTreeRow) => {
    setEditing(row.node);
    setDefaultParentId(Number(row.node.parentId || 0) || null);
    setFormOpen(true);
  };

  /** 删除 */
  const onDelete = (row: GroupTreeRow) => {
    const g = row.node;
    const count = Number(g.projectCount || 0);
    const target = row.parentName ? `上级分组「${row.parentName}」` : '「未分组」';
    modal.confirm({
      title: `删除分组「${g.name}」？`,
      content: count > 0
        ? (
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <div>
              该分组下有 <Text strong style={{ color: PALETTE.primary }}>{count}</Text> 个项目，
              删除后它们会自动移动到{target}。
            </div>
            <div style={{ color: NEUTRAL.textTertiary, marginTop: 4 }}>
              项目本身与项目数据不会被删除，只是不再归属这个分组。
            </div>
          </div>
        )
        : (
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            该分组下没有项目，删除后不影响任何项目数据。
          </div>
        ),
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setDeletingId(Number(g.id));
        try {
          // silent：错误由下面的 modal.error 用明确文案展示，避免和全局 toast 重复
          const r = await deleteProjectGroup(Number(g.id), { silent: true });
          message.success(
            r.movedProjects
              ? `分组已删除，${r.movedProjects} 个项目已移动到「${r.movedToName || (row.parentName ?? '未分组')}」`
              : '分组已删除',
          );
          onDeleted?.(Number(g.id));
          await onChanged();
        } catch (e) {
          const msg = e instanceof Error ? e.message : '删除失败';
          // 后端拒绝（最常见：该分组下还有子分组）→ 明确文案 + 下一步指引
          modal.error({
            title: '无法删除该分组',
            content: (
              <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                <div>{msg}</div>
                <div style={{ color: NEUTRAL.textTertiary, marginTop: 6 }}>
                  请先删除或移动它的子分组，再回来删除本分组。分组下的项目不会被删除。
                </div>
              </div>
            ),
            okText: '知道了',
          });
        } finally {
          setDeletingId(null);
        }
      },
    });
  };

  /* ---------------- 渲染 ---------------- */

  const body = (
    <div>
      {/* 顶部：新建顶层分组 + 现状统计 */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          marginBottom: 10,
        }}
      >
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!canWrite}
          onClick={openCreateRoot}
        >
          新建顶层分组
        </Button>
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          共 {flat.length} 个分组 · 未分组项目 {groups?.stats?.ungrouped ?? 0} 个 · 最多 {maxDepth} 级
        </Text>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 10 }}
        title="每一行右侧都能直接改名、加子分组、删除"
        description={
          <span style={{ fontSize: 12.5 }}>
            删除分组不会删除项目：项目会自动上移到父分组（没有父分组则变为「未分组」）。
            若分组下还有子分组，需先处理子分组才能删除。
          </span>
        }
      />

      <Spin spinning={Boolean(loading)}>
        {rows.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span style={{ color: NEUTRAL.textTertiary }}>还没有分组，点上面「新建顶层分组」</span>}
            style={{ padding: '24px 0' }}
          />
        ) : (
          <div
            style={{
              maxHeight: 420, overflowY: 'auto',
              border: `1px solid ${NEUTRAL.borderSubtle}`, borderRadius: 8,
              background: NEUTRAL.surface,
            }}
          >
            {rows.map((row, i) => {
              const g = row.node;
              const count = Number(g.projectCount || 0);
              const total = Number(g.totalProjectCount ?? count);
              const hasChildren = row.childCount > 0;
              // 后端 MAX_DEPTH 限制：父分组自身已在第 maxDepth 级时不能再加子分组
              const cannotAddChild = row.depth + 1 >= maxDepth;
              const color = g.color || PALETTE.gray;
              const crumb = row.path.length ? `${row.path.join(' / ')} / ${g.name}` : g.name;
              return (
                <div
                  key={g.id}
                  data-testid={`group-row-${g.id}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 10px',
                    paddingLeft: 10 + row.depth * 20,
                    borderTop: i === 0 ? 'none' : `1px solid ${NEUTRAL.borderSubtle}`,
                    background: i % 2 === 1 ? NEUTRAL.surfaceAlt : NEUTRAL.surface,
                  }}
                >
                  {/* 层级连接符 */}
                  {row.depth > 0 && (
                    <span style={{ color: NEUTRAL.textQuaternary, fontSize: 12, flexShrink: 0 }}>└</span>
                  )}

                  {/* 标识色 + 图标 */}
                  <span
                    style={{
                      width: 9, height: 9, borderRadius: 3, flexShrink: 0,
                      background: color, display: 'inline-block',
                    }}
                  />
                  {g.icon ? (
                    <span style={{ fontSize: 13, flexShrink: 0 }}>{g.icon}</span>
                  ) : (
                    <FolderOutlined style={{ fontSize: 13, color: NEUTRAL.textQuaternary, flexShrink: 0 }} />
                  )}

                  {/* 名称 + 层级面包屑 */}
                  <Tooltip title={crumb}>
                    <span
                      style={{
                        fontSize: 13, fontWeight: row.depth === 0 ? 600 : 500,
                        color: NEUTRAL.text, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        minWidth: 0, flexShrink: 1,
                      }}
                    >
                      {g.name}
                    </span>
                  </Tooltip>

                  {/* 项目数 / 子分组数 / 空标记 */}
                  <Space size={4} style={{ flexShrink: 0 }}>
                    {count === 0 ? (
                      <Tag
                        style={{
                          margin: 0, fontSize: 11, lineHeight: '17px', padding: '0 6px',
                          background: NEUTRAL.surfaceSunken,
                          border: `1px solid ${NEUTRAL.borderSubtle}`,
                          color: NEUTRAL.textQuaternary,
                        }}
                      >
                        空
                      </Tag>
                    ) : (
                      <Tag
                        style={{
                          margin: 0, fontSize: 11, lineHeight: '17px', padding: '0 6px',
                          background: NEUTRAL.surfaceSunken,
                          border: `1px solid ${NEUTRAL.borderSubtle}`,
                          color: NEUTRAL.textSecondary,
                        }}
                      >
                        {count} 个项目
                      </Tag>
                    )}
                    {hasChildren && (
                      <Tag
                        style={{
                          margin: 0, fontSize: 11, lineHeight: '17px', padding: '0 6px',
                          background: 'transparent',
                          border: `1px solid ${NEUTRAL.border}`,
                          color: NEUTRAL.textTertiary,
                        }}
                      >
                        {row.childCount} 个子分组{total > count ? ` · 合计 ${total}` : ''}
                      </Tag>
                    )}
                  </Space>

                  <div style={{ flex: 1, minWidth: 0 }} />

                  {/* 行内操作：编辑 / 在此新建子分组 / 删除 */}
                  <Space size={0} style={{ flexShrink: 0 }}>
                    <Tooltip title="编辑（改名 / 图标 / 颜色 / 备注 / 上级）">
                      <Button
                        size="small"
                        type="text"
                        icon={<EditOutlined />}
                        disabled={!canWrite}
                        onClick={() => openEdit(row)}
                        aria-label={`编辑分组 ${g.name}`}
                      />
                    </Tooltip>
                    <Tooltip
                      title={cannotAddChild
                        ? `分组层级最多 ${maxDepth} 级，已到上限`
                        : `在「${g.name}」下新建子分组`}
                    >
                      <Button
                        size="small"
                        type="text"
                        icon={<FolderAddOutlined />}
                        disabled={!canWrite || cannotAddChild}
                        onClick={() => openCreateChild(row)}
                        aria-label={`在 ${g.name} 下新建子分组`}
                      />
                    </Tooltip>
                    <Tooltip
                      title={hasChildren
                        ? '请先处理子分组（删除或移动到别处），才能删除本分组'
                        : count > 0
                          ? `删除分组（${count} 个项目将移到${row.parentName ? `「${row.parentName}」` : '未分组'}）`
                          : '删除分组'}
                    >
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={!canWrite || hasChildren}
                        loading={deletingId === Number(g.id)}
                        onClick={() => onDelete(row)}
                        aria-label={`删除分组 ${g.name}`}
                      />
                    </Tooltip>
                  </Space>
                </div>
              );
            })}
          </div>
        )}
      </Spin>
    </div>
  );

  return (
    <>
      <Modal
        open={open}
        title="分组管理"
        onCancel={onClose}
        width={720}
        destroyOnHidden
        footer={<Button onClick={onClose}>关闭</Button>}
      >
        {body}
      </Modal>

      {/* 新建 / 编辑分组：复用现有 GroupFormModal（嵌在本弹窗之上） */}
      <GroupFormModal
        open={formOpen}
        group={editing}
        flat={flat}
        defaultParentId={defaultParentId}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); void onChanged(); }}
      />
    </>
  );
}
