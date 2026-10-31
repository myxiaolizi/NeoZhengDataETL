/** V8.1 需求 E3：省份排行榜「更多」——中国地图
 *
 * 为什么单独成文件：
 *   echarts 6 不含内置中国 GeoJSON，必须手动 registerMap。
 *   这里内联 echarts4 的 china.json（34 省，61KB），不依赖任何外部 CDN。
 *
 * 省名对齐：GeoJSON 用简称（河北 / 内蒙古 / 广西），API 返回「河北省」等全称，
 *          用 normProvince() 统一成简称再做匹配。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Empty, Modal } from 'antd';
import * as echartsLib from 'echarts';
import type { EChartsOption } from 'echarts';
import EChart from '@/pages/dashboard/EChart';
import CHINA_GEO from '@/assets/china-geo.json';
import { REGION_COLORS, type RankItem } from '@/api/crm-board';

/** 只注册一次 */
let CHINA_MAP_REGISTERED = false;
function ensureChinaMap(): string | null {
  if (CHINA_MAP_REGISTERED) return null;
  try {
    const reg = (echartsLib as unknown as { registerMap?: (n: string, g: unknown) => void }).registerMap;
    if (typeof reg !== 'function') return 'echarts.registerMap 不可用';
    reg('china', CHINA_GEO);
    CHINA_MAP_REGISTERED = true;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'registerMap 失败';
  }
}

/** 全称 → GeoJSON 简称 */
export function normProvince(s: string): string {
  const v = String(s || '').trim();
  if (!v) return v;
  const special: Record<string, string> = {
    内蒙古自治区: '内蒙古',
    广西壮族自治区: '广西',
    宁夏回族自治区: '宁夏',
    新疆维吾尔自治区: '新疆',
    西藏自治区: '西藏',
    香港特别行政区: '香港',
    澳门特别行政区: '澳门',
  };
  if (special[v]) return special[v];
  return v.replace(/(省|市|自治区|特别行政区)$/, '');
}

interface Props {
  items: RankItem[];
  open: boolean;
  onClose: () => void;
  dark: boolean;
  isMobile: boolean;
}

export default function ProvinceMapModal({ items, open, onClose, dark, isMobile }: Props) {
  const [mapErr, setMapErr] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    const err = ensureChinaMap();
    setMapErr(err || '');
  }, [open]);

  const data = useMemo(
    () => items.map((r) => ({
      name: normProvince(String(r.name ?? '')),
      value: Number(r.clients) || 0,
      raw: r,
    })),
    [items],
  );

  const maxV = useMemo(() => Math.max(...data.map((d) => d.value), 1), [data]);

  const option = useMemo<EChartsOption>(() => {
    const isDark = dark;
    /* V9.2：配色对齐新令牌 —— 无数据省份 / 边界 / 文字，全部用令牌色值（字面量，因 portal 拿不到变量） */
    const areaColor = isDark ? '#1d2a47' : '#eef2f9';   /* --line2 / --bg 派生 */
    const borderColor = isDark ? '#243356' : '#ffffff'; /* --line / --panel */
    const textColor = isDark ? '#e8eef8' : '#0f172a';   /* --text */
    const subColor = isDark ? '#6d81a3' : '#8494ab';    /* --text3 */
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: isDark ? '#141e33' : '#ffffff',  /* --panel */
        borderColor: isDark ? '#243356' : '#e3e9f2',      /* --line */
        borderWidth: 1,
        textStyle: { color: textColor, fontSize: 12 },
        extraCssText: 'box-shadow:0 4px 16px rgba(15,23,42,.09);border-radius:10px;',
        formatter: (params: unknown) => {
          const pp = params as { name: string; value?: number; data?: { raw?: RankItem } };
          const raw = pp.data?.raw;
          if (!raw) return `${pp.name}<br/>暂无客户数据`;
          const lines = [
            `<b>${raw.name}</b>`,
            `客户数：<b>${Number(raw.clients) || 0}</b> 家`,
            `门店数：${Number(raw.stores) || 0}`,
          ];
          if (raw.salesName) lines.push(`主销售：${raw.salesName}`);
          return lines.join('<br/>');
        },
      },
      visualMap: {
        min: 0,
        max: maxV,
        left: 10,
        bottom: 10,
        orient: 'vertical',
        itemWidth: 10,
        itemHeight: 90,
        text: [`${maxV} 家`, '0 家'],
        calculable: false,
        /* 只在 brand 一个色相内由浅到深，与页面热力格一致 */
        inRange: {
          color: isDark
            ? ['#1e3a8a', '#2563eb', '#60a5fa', '#93c5fd']
            : ['#dbeafe', '#93c5fd', '#3b82f6', '#1d4ed8'],
        },
        textStyle: { color: subColor, fontSize: 11 },
      },
      series: [
        {
          type: 'map',
          map: 'china',
          roam: true,
          zoom: 1.15,
          center: [104, 36],
          label: {
            show: true,
            fontSize: isMobile ? 10 : 11,
            fontWeight: 'bold',
            color: textColor,
            textBorderColor: isDark ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.95)',
            textBorderWidth: 2,
            formatter: (p: unknown) => {
              const q = p as { name: string; value?: number };
              /* 值为 0 / 无值时留空，不再显示「0」 */
              if (!q.value) return '';
              return `${q.name}\n${q.value}`;
            },
          },
          itemStyle: { areaColor, borderColor, borderWidth: 0.8 },
          emphasis: {
            label: { show: true, color: isDark ? '#0b1120' : '#ffffff', fontWeight: 700, fontSize: 11 },
            itemStyle: { areaColor: isDark ? '#93c5fd' : '#1d4ed8', borderColor: '#ffffff', borderWidth: 1.2 },
          },
          select: { disabled: true },
          data,
        },
      ],
    };
  }, [data, maxV, dark, isMobile]);

  /** 汇总（用于弹窗头部） */
  const sum = useMemo(() => ({
    prov: data.length,
    clients: data.reduce((s, x) => s + x.value, 0),
  }), [data]);

  return (
    <Modal
      title={`省份排行榜 · 中国地图（${sum.prov} 个省 / ${sum.clients} 家客户）`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={isMobile ? '96vw' : 920}
      styles={{ body: { padding: 12, maxHeight: '78vh', overflowY: 'auto' } }}
      destroyOnHidden
    >
      {mapErr ? (
        <div style={{ padding: 32 }}>
          <Empty description={`地图加载失败：${mapErr}`} />
          <div style={{ marginTop: 16 }}>
            {/* 回退：热力网格 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(90px,1fr))', gap: 6 }}>
              {data.map((d) => (
                <div
                  key={d.name}
                  style={{
                    padding: '6px 8px', borderRadius: 8, textAlign: 'center',
                    background: `color-mix(in srgb, ${REGION_COLORS['南区']} ${Math.round(10 + 40 * (d.value / maxV))}%, var(--panel))`,
                    border: '1px solid var(--line)', color: 'var(--text)',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700 }}>{d.name}</div>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>{d.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          <EChart option={option} height={isMobile ? 320 : 520} />
          <div style={{ fontSize: 11, color: '#8494ab', marginTop: 10, textAlign: 'center', fontWeight: 600 }}>
            颜色越深客户数越多 · 悬停查看客户/门店/销售 · 可滚轮缩放、拖动
          </div>
        </>
      )}
    </Modal>
  );
}
