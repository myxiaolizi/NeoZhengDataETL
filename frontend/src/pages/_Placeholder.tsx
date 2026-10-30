/** 临时占位页生成器：为尚未实现的页面提供可构建的骨架。
 *  实装时由各负责人替换为真正的实现。
 */
import React from 'react';
import { Empty, Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import Page from '@/components/Page';

export default function Placeholder({ name }: { name: string }) {
  const navigate = useNavigate();
  return (
    <Page title={name} subTitle="页面开发中">
      <Empty description={<span>{name} 正在开发中</span>}>
        <Button type="primary" onClick={() => navigate('/dashboard')}>返回概览</Button>
      </Empty>
    </Page>
  );
}
