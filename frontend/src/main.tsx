/** 应用入口 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import './styles/global.css';

dayjs.locale('zh-cn');

/** V4.0 品牌主题：沿用调色板，与 Ant Design 6 token 对齐 */
export const THEME = {
  token: {
    colorPrimary: '#3687FF',
    colorInfo: '#3687FF',
    colorSuccess: '#A2D73C',
    colorWarning: '#FFC000',
    colorError: '#E86161',
    colorLink: '#3687FF',
    colorTextBase: '#003378',
    borderRadius: 8,
    fontSize: 14,
    wireframe: false,
  },
  components: {
    Layout: {
      headerBg: '#FFFFFF',
      siderBg: '#FFFFFF',
      bodyBg: '#FFFFFF',
      headerHeight: 56,
    },
    Menu: {
      itemSelectedBg: 'rgba(115,219,255,.22)',
      itemSelectedColor: '#2D6FE4',
      itemHoverBg: 'rgba(115,219,255,.12)',
      itemBorderRadius: 8,
    },
    Card: { borderRadiusLG: 12 },
    Table: { headerBg: 'rgba(54,135,255,.08)', headerColor: '#003378' },
  },
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={THEME as any}>
      <AntApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
