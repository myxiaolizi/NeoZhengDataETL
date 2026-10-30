/** 通用页面容器：统一标题、操作区、移动端间距 */
import React from 'react';
import { Grid, Space } from 'antd';

const { useBreakpoint } = Grid;

export interface PageProps {
  title?: React.ReactNode;
  subTitle?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  /** 移动端是否隐藏副标题 */
  hideSubOnMobile?: boolean;
}

export default function Page({ title, subTitle, extra, children, hideSubOnMobile = true }: PageProps) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  return (
    <div>
      {(title || extra) && (
        <div
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'stretch' : 'center',
            justifyContent: 'space-between',
            gap: isMobile ? 10 : 12,
            marginBottom: isMobile ? 12 : 16,
          }}
        >
          <div style={{ minWidth: 0 }}>
            {title && (
              <div style={{ fontSize: isMobile ? 17 : 20, fontWeight: 700, color: '#003378', lineHeight: 1.35 }}>
                {title}
              </div>
            )}
            {subTitle && !(isMobile && hideSubOnMobile) && (
              <div style={{ fontSize: 12.5, color: 'rgba(0,51,120,.55)', marginTop: 4 }}>{subTitle}</div>
            )}
          </div>
          {extra && (
            <Space wrap size={8} style={{ flexShrink: 0 }}>
              {extra}
            </Space>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
