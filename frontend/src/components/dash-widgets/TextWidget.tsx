/**
 * 富文本（text）：说明 / 备注卡片
 * 支持极简 Markdown：`## 标题`、`- 列表`、`**加粗**`、空行分段。
 * 内容来源：widget.chart.content（设计器可编辑）；为空时显示引导文案。
 */
import React from 'react';
import { chartNum, chartStr } from './shared';
import type { WidgetProps } from './shared';

/** 行内 **加粗** 解析 */
function inline(text: string, key: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== '');
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <strong key={`${key}_b${i}`} style={{ fontWeight: 750, color: 'var(--text, #16253d)' }}>
            {p.slice(2, -2)}
          </strong>
        ) : (
          <React.Fragment key={`${key}_t${i}`}>{p}</React.Fragment>
        )
      )}
    </>
  );
}

export default function TextWidget({ widget, isMobile }: WidgetProps) {
  const content = chartStr(widget, 'content', '');
  const align = chartStr(widget, 'align', 'left') as 'left' | 'center' | 'right';
  const fontSize = chartNum(widget, 'fontSize', 13);

  const lines = content.split(/\r?\n/);

  if (!content.trim()) {
    return (
      <div
        style={{
          padding: isMobile ? '18px 12px' : '26px 16px',
          textAlign: 'center',
          fontSize: 12.5,
          color: 'var(--text3, #93a7c2)',
          border: '1px dashed var(--line, #dde8f6)',
          borderRadius: 11,
          background: 'var(--panel2, #f7faff)',
          lineHeight: 1.7,
        }}
      >
        富文本内容为空
        <br />
        在右侧属性面板「图表细节 → 文本内容」里填写说明文字
      </div>
    );
  }

  return (
    <div
      style={{
        textAlign: align,
        fontSize,
        lineHeight: 1.75,
        color: 'var(--text2, #5a7191)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minWidth: 0,
        wordBreak: 'break-word',
      }}
    >
      {lines.map((line, i) => {
        const key = `ln${i}`;
        if (!line.trim()) return <div key={key} style={{ height: 6 }} />;
        if (line.startsWith('## ')) {
          return (
            <div key={key} style={{ fontSize: fontSize + 2, fontWeight: 750, color: 'var(--text, #16253d)', marginTop: 2 }}>
              {inline(line.slice(3), key)}
            </div>
          );
        }
        if (line.startsWith('# ')) {
          return (
            <div key={key} style={{ fontSize: fontSize + 5, fontWeight: 750, color: 'var(--text, #16253d)', marginTop: 2 }}>
              {inline(line.slice(2), key)}
            </div>
          );
        }
        if (/^[-*]\s+/.test(line)) {
          return (
            <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', textAlign: 'left' }}>
              <span style={{ color: 'var(--brand, #2563eb)', lineHeight: 'inherit' }}>•</span>
              <span style={{ minWidth: 0 }}>{inline(line.replace(/^[-*]\s+/, ''), key)}</span>
            </div>
          );
        }
        return (
          <div key={key} style={{ textAlign: align }}>
            {inline(line, key)}
          </div>
        );
      })}
    </div>
  );
}
