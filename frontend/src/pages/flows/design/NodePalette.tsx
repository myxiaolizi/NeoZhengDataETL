/** 左侧节点面板：按分类分组 + 关键词过滤，点击添加到画布 */
import React, { useMemo, useState } from 'react';
import { Empty, Input } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import type { FlowNodeMeta, FlowNodeTypeDef } from '@/api/flows';
import { C, categoryColor, withAlpha } from './constants';

export interface NodePaletteProps {
  meta: FlowNodeMeta | null;
  onAdd: (type: FlowNodeTypeDef) => void;
  /** 抽屉模式（移动端）时去掉外边框 */
  bare?: boolean;
}

const FALLBACK_CATEGORIES = [
  { key: 'source', name: '数据源', desc: '流程的输入' },
  { key: 'clean', name: '数据清洗与加工', desc: '过滤、转换、计算' },
  { key: 'sink', name: '数据输出', desc: '流程的结果去向' },
];

export default function NodePalette({ meta, onAdd, bare }: NodePaletteProps) {
  const [keyword, setKeyword] = useState('');
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const categories = meta?.categories?.length ? meta.categories : FALLBACK_CATEGORIES;

  const groups = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return categories
      .map((c) => ({
        ...c,
        nodes: (meta?.nodes || []).filter((n) => {
          if (n.category !== c.key) return false;
          if (!kw) return true;
          return (
            n.name.toLowerCase().includes(kw) ||
            n.key.toLowerCase().includes(kw) ||
            (n.desc || '').toLowerCase().includes(kw)
          );
        }),
      }))
      .filter((g) => g.nodes.length > 0);
  }, [categories, meta, keyword]);

  const total = meta?.nodes?.length || 0;

  return (
    <div
      style={{
        width: bare ? '100%' : 244,
        flex: bare ? 1 : '0 0 244px',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: C.bg,
        border: bare ? 'none' : `1px solid ${withAlpha(C.primary, 0.18)}`,
        borderRight: bare ? 'none' : `1px solid ${withAlpha(C.primary, 0.18)}`,
        borderRadius: bare ? 0 : 12,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '12px 12px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.deep }}>节点面板</span>
          <span style={{ fontSize: 11, color: C.gray }}>{total} 种</span>
        </div>
        <div style={{ fontSize: 11.5, color: C.gray, marginTop: 2, lineHeight: 1.5 }}>
          点击节点添加到画布
        </div>
        <Input
          allowClear
          size="small"
          placeholder="搜索节点"
          prefix={<SearchOutlined style={{ color: C.gray, fontSize: 12 }} />}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ marginTop: 8 }}
        />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 10px 12px' }}>
        {groups.length === 0 && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span style={{ fontSize: 12, color: C.gray }}>没有匹配的节点</span>}
            style={{ marginTop: 24 }}
          />
        )}

        {groups.map((group) => {
          const color = categoryColor(group.key);
          return (
            <div key={group.key} style={{ marginTop: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 2px 6px',
                  position: 'sticky',
                  top: 0,
                  background: C.bg,
                  zIndex: 1,
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: 2, background: color }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: C.deep }}>{group.name}</span>
                <span style={{ fontSize: 10.5, color: C.gray }}>{group.nodes.length}</span>
              </div>

              {group.nodes.map((t) => {
                const hovered = hoverKey === t.key;
                return (
                  <div
                    key={t.key}
                    data-role="node-palette"
                    data-node-type={t.key}
                    onClick={() => onAdd(t)}
                    onMouseEnter={() => setHoverKey(t.key)}
                    onMouseLeave={() => setHoverKey((k) => (k === t.key ? null : k))}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '7px 8px',
                      marginBottom: 5,
                      borderRadius: 9,
                      cursor: 'pointer',
                      border: `1px solid ${hovered ? withAlpha(color, 0.55) : C.line}`,
                      background: hovered ? withAlpha(color, 0.06) : C.bg,
                      transition: 'background .12s ease, border-color .12s ease',
                    }}
                  >
                    <span
                      style={{
                        width: 26,
                        height: 26,
                        flex: '0 0 26px',
                        borderRadius: 8,
                        background: withAlpha(color, 0.13),
                        color,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 13,
                      }}
                    >
                      {t.icon || '◇'}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 12.5,
                          fontWeight: 500,
                          color: C.deep,
                          lineHeight: 1.35,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {t.name}
                      </span>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 10.5,
                          color: C.gray,
                          lineHeight: 1.35,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {t.desc || t.key}
                      </span>
                    </span>
                    <PlusOutlined
                      style={{
                        fontSize: 11,
                        color: hovered ? color : C.gray,
                        opacity: hovered ? 1 : 0.55,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
