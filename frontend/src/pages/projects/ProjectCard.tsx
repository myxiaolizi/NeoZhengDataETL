/** 项目卡片：单个数据项目的展示单元（V4.1 配色统一走 @/theme 令牌） */
import React from 'react';
import { Badge, Button, Card, Dropdown, Switch, Tag, Tooltip } from 'antd';
import {
  DeleteOutlined, EditOutlined, EllipsisOutlined, KeyOutlined,
  RightOutlined, TableOutlined, FolderOutlined,
} from '@ant-design/icons';
import type { ProjectRow } from '@/api/projects';
import { NEUTRAL, PALETTE, SHADOW, STAT_COLORS } from '@/theme';
import { fmtAgo, fmtNum } from '@/utils';

/** 十六进制色 → rgba（用于分组标签的淡底） */
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** 分组标签配色：按 id 取模，保证同一分组颜色稳定 */
function groupColor(groupId?: number | null): string {
  if (!groupId) return PALETTE.gray;
  return STAT_COLORS[Math.abs(Number(groupId)) % STAT_COLORS.length];
}

export interface ProjectCardProps {
  project: ProjectRow;
  canWrite: boolean;
  toggling: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRegenerateToken: () => void;
  onToggleStatus: (checked: boolean) => void;
}

export default function ProjectCard({
  project: p,
  canWrite,
  toggling,
  onOpen,
  onEdit,
  onDelete,
  onRegenerateToken,
  onToggleStatus,
}: ProjectCardProps) {
  const enabled = Number(p.status) === 1;
  const failed = Number(p.failedLogs || 0);
  const dataCount = Number(p.dataCount || p.total_count || 0);
  const fieldCount = Number(p.fieldCount || p.field_count || 0);
  const gColor = groupColor(p.group_id);

  const moreItems = [
    {
      key: 'token',
      icon: <KeyOutlined />,
      label: '重新生成令牌',
      disabled: !canWrite,
    },
    { type: 'divider' as const },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: '删除项目',
      danger: true,
      disabled: !canWrite,
    },
  ];

  return (
    <Card
      hoverable
      onClick={onOpen}
      style={{
        height: '100%',
        background: NEUTRAL.surface,
        borderColor: enabled ? NEUTRAL.border : NEUTRAL.borderSubtle,
        borderLeft: `3px solid ${enabled ? PALETTE.primary : NEUTRAL.border}`,
        borderRadius: 10,
        boxShadow: SHADOW.card,
        transition: 'box-shadow .18s ease, border-color .18s ease',
      }}
      styles={{ body: { padding: 16, display: 'flex', flexDirection: 'column', height: '100%' } }}
    >
      {/* 标题行：名称 + 状态 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                fontSize: 14.5, fontWeight: 700, color: NEUTRAL.text,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
              title={p.name}
            >
              {p.name}
            </span>
            {failed > 0 && (
              <Tooltip title={`${failed} 条失败日志`}>
                <Badge count={failed} color={PALETTE.red} overflowCount={99} size="small" />
              </Tooltip>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            {p.code && (
              <Tag
                style={{
                  fontSize: 11, margin: 0, borderRadius: 4,
                  background: NEUTRAL.surfaceSunken,
                  border: `1px solid ${NEUTRAL.borderSubtle}`,
                  color: PALETTE.primaryDeep,
                }}
              >
                {p.code}
              </Tag>
            )}
            <Tag
              style={{
                fontSize: 11, margin: 0, borderRadius: 4,
                border: `1px solid ${withAlpha(gColor, 0.32)}`,
                background: withAlpha(gColor, 0.10),
                color: p.group_id ? NEUTRAL.textSecondary : NEUTRAL.textTertiary,
              }}
              icon={<FolderOutlined />}
            >
              {p.group_name || '未分组'}
            </Tag>
          </div>
        </div>

        {/* 状态开关：阻止冒泡避免触发卡片跳转 */}
        <div onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
          <Tooltip title={enabled ? '已启用' : '已停用'}>
            <Switch
              size="small"
              checked={enabled}
              loading={toggling}
              disabled={!canWrite}
              onChange={onToggleStatus}
            />
          </Tooltip>
        </div>
      </div>

      {/* 描述 */}
      {p.description && (
        <Tooltip title={p.description}>
          <div
            style={{
              fontSize: 12, color: NEUTRAL.textTertiary, marginBottom: 10,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {p.description}
          </div>
        </Tooltip>
      )}

      {/* 指标 */}
      <div
        style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px',
          padding: '10px 0', borderTop: `1px solid ${NEUTRAL.borderSubtle}`,
          marginTop: 'auto',
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: NEUTRAL.textTertiary }}>数据量</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: PALETTE.primary, lineHeight: 1.3 }}>
            {fmtNum(dataCount)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: NEUTRAL.textTertiary }}>字段数</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: NEUTRAL.text, lineHeight: 1.3 }}>
            {fmtNum(fieldCount)}
          </div>
        </div>
      </div>

      {/* 最后推送 */}
      <div style={{ fontSize: 11.5, color: NEUTRAL.textQuaternary, marginBottom: 10 }}>
        <TableOutlined style={{ marginRight: 4 }} />
        {p.last_push_at ? `最后推送 ${fmtAgo(p.last_push_at)}` : '从未推送'}
      </div>

      {/* 操作行 */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          borderTop: `1px solid ${NEUTRAL.borderSubtle}`, paddingTop: 10,
        }}
      >
        <Button type="link" size="small" style={{ padding: 0 }} onClick={onOpen}>
          详情 <RightOutlined style={{ fontSize: 10 }} />
        </Button>
        <div style={{ flex: 1 }} />
        {canWrite && (
          <Button type="text" size="small" icon={<EditOutlined />} onClick={onEdit} title="编辑" />
        )}
        <Dropdown
          menu={{
            items: moreItems,
            onClick: ({ key }) => {
              if (key === 'token') onRegenerateToken();
              if (key === 'delete') onDelete();
            },
          }}
          trigger={['click']}
        >
          <Button type="text" size="small" icon={<EllipsisOutlined />} />
        </Dropdown>
      </div>
    </Card>
  );
}
