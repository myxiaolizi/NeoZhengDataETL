/** 可折叠查询区：默认收起，点击展开筛选条件 */
import React, { useState } from 'react';
import { Button, Space, Grid } from 'antd';
import { DownOutlined, UpOutlined, FilterOutlined } from '@ant-design/icons';
import { NEUTRAL, SHADOW } from '@/theme';

const { useBreakpoint } = Grid;

export interface FilterPanelProps {
  children: React.ReactNode;
  /** 展开时才显示的额外筛选项（可选，用于把次要条件藏起来） */
  advanced?: React.ReactNode;
  /** 已生效的筛选条件数量，>0 时按钮显示徽标 */
  activeCount?: number;
  /** 是否默认展开（默认 false = 收起） */
  defaultOpen?: boolean;
  /** 右侧附加操作（如「刷新」「导出」），始终可见 */
  extra?: React.ReactNode;
}

/**
 * 查询区容器
 *
 * V4.1：所有页面的查询功能默认收起，避免筛选条占据首屏高度。
 * 收起时只显示一个「筛选」按钮 + 已选条件数 + 常用操作；
 * 展开后显示完整的筛选表单。
 */
export default function FilterPanel({
  children,
  advanced,
  activeCount = 0,
  defaultOpen = false,
  extra,
}: FilterPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  return (
    <div
      style={{
        border: `1px solid ${NEUTRAL.border}`,
        borderRadius: 10,
        background: NEUTRAL.surface,
        marginBottom: 12,
        overflow: 'hidden',
        boxShadow: SHADOW.card,
      }}
    >
      {/* 收起态：一行工具条 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: open ? '10px 14px' : '10px 14px',
          borderBottom: open ? `1px solid ${NEUTRAL.borderSubtle}` : 'none',
          flexWrap: 'wrap',
        }}
      >
        <Space size={8} wrap>
          <Button
            type={open ? 'default' : 'primary'}
            ghost={!open}
            size={isMobile ? 'middle' : 'small'}
            icon={<FilterOutlined />}
            onClick={() => setOpen((v) => !v)}
          >
            筛选{activeCount > 0 ? `（${activeCount}）` : ''}
            {open ? <UpOutlined style={{ fontSize: 10 }} /> : <DownOutlined style={{ fontSize: 10 }} />}
          </Button>
          {!open && activeCount > 0 && (
            <span style={{ fontSize: 12, color: 'rgba(0,51,120,.52)' }}>
              已应用 {activeCount} 个条件
            </span>
          )}
        </Space>
        {extra && <Space size={8} wrap>{extra}</Space>}
      </div>

      {/* 展开态：完整筛选 */}
      {open && (
        <div style={{ padding: '14px' }}>
          {children}
          {advanced && <div style={{ marginTop: 12 }}>{advanced}</div>}
        </div>
      )}
    </div>
  );
}
