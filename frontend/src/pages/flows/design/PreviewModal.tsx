/** 试运行结果弹窗：节点日志 + 输出数据预览 */
import React from 'react';
import { Button, Modal, Space, Table, Tag } from 'antd';
import type { FlowPreviewResult } from '@/api/flows';
import { C, fmtNum } from './constants';
import { NEUTRAL } from '@/theme';

export interface PreviewModalProps {
  open: boolean;
  preview: FlowPreviewResult | null;
  isMobile: boolean;
  onClose: () => void;
}

export default function PreviewModal({ open, preview, isMobile, onClose }: PreviewModalProps) {
  const columns = (preview?.columns || []).map((c) => ({
    title: c.name,
    dataIndex: c.name,
    key: c.name,
    ellipsis: true,
    width: 150,
    render: (v: unknown) =>
      v === null || v === undefined
        ? '-'
        : typeof v === 'object'
          ? JSON.stringify(v)
          : String(v),
  }));

  return (
    <Modal
      title="试运行结果（未写入目标）"
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
      width={isMobile ? '96%' : 960}
      destroyOnHidden
    >
      {preview && (
        <div>
          <Space wrap size={12} style={{ marginBottom: 10 }}>
            <Tag style={{ color: C.primary, background: NEUTRAL.surface, borderColor: C.primary }}>
              输出 {fmtNum(preview.rowCount)} 行
            </Tag>
            <span style={{ fontSize: 12.5, color: C.gray }}>
              预览前 {preview.rows.length} 行 · 共 {preview.logs.length} 个节点
            </span>
          </Space>

          <div
            style={{
              marginBottom: 12,
              border: `1px solid ${C.line}`,
              borderRadius: 10,
              overflow: 'hidden',
            }}
          >
            {preview.logs.map((l, i) => (
              <div
                key={`${l.nodeId}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12.5,
                  padding: '6px 10px',
                  background: i % 2 ? NEUTRAL.surface : NEUTRAL.surfaceAlt,
                  borderBottom: i === preview.logs.length - 1 ? 'none' : `1px solid ${C.line}`,
                }}
              >
                <span
                  style={{
                    width: 6, height: 6, borderRadius: '50%', flex: '0 0 6px',
                    background: l.skipped ? C.yellow : C.green,
                  }}
                />
                <span style={{ color: C.deep, width: 170, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {l.name}
                </span>
                <span style={{ color: C.gray, flex: 1, minWidth: 0 }}>
                  {l.skipped
                    ? '（输出节点，试运行跳过）'
                    : `输入 ${fmtNum(l.inputRows)} 行 → 输出 ${fmtNum(l.outputRows)} 行 · ${fmtNum(l.ms)}ms`}
                </span>
              </div>
            ))}
          </div>

          <Table
            size="small"
            rowKey={(_, index) => String(index)}
            columns={columns}
            dataSource={preview.rows as Record<string, unknown>[]}
            scroll={{ x: Math.max(500, columns.length * 150), y: 320 }}
            pagination={false}
            locale={{ emptyText: '没有输出数据' }}
          />
        </div>
      )}
    </Modal>
  );
}
