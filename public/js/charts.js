/* 轻量图表库 —— 纯 SVG 实现，无外部依赖
 * 支持：柱状图 / 折线图 / 面积图 / 饼图 / 环形图 / 散点图 / 雷达图 / 漏斗图 / 仪表盘 / 指标卡 / 表格
 */
(function (global) {
  'use strict';

  const DEFAULT_PALETTE = ['#45B4FF', '#FFC000', '#3687FF', '#A2D73C', '#EC673C', '#73DBFF', '#003378', '#B5B5B6'];

  function palette() {
    const p = (global.__THEME__ && global.__THEME__.palette) || '';
    const arr = String(p).split(',').map((s) => s.trim()).filter(Boolean);
    return arr.length ? arr : DEFAULT_PALETTE;
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtNum(v) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + '亿';
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(2) + '万';
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  function niceMax(max) {
    if (!Number.isFinite(max) || max <= 0) return 10;
    const exp = Math.floor(Math.log10(max));
    const base = Math.pow(10, exp);
    const n = max / base;
    let m;
    if (n <= 1) m = 1;
    else if (n <= 2) m = 2;
    else if (n <= 2.5) m = 2.5;
    else if (n <= 5) m = 5;
    else m = 10;
    return m * base;
  }

  /** 从数据中提取分类与数值 */
  function extract(rows, cfg) {
    const category = cfg.categoryField || cfg.xField;
    const values = cfg.valueFields && cfg.valueFields.length
      ? cfg.valueFields
      : (cfg.valueField ? [cfg.valueField] : []);

    const cats = [];
    const series = values.map(() => []);

    (rows || []).forEach((r) => {
      cats.push(category ? String(r[category] === null || r[category] === undefined ? '' : r[category]) : '');
      values.forEach((vf, i) => {
        const n = Number(r[vf]);
        series[i].push(Number.isFinite(n) ? n : 0);
      });
    });

    return { cats, series, valueFields: values };
  }

  /** 通用坐标轴绘制 */
  function renderAxes(w, h, pad, max, cats, opts) {
    const o = opts || {};
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    let g = '';

    // 横向网格 + Y 轴刻度
    const ticks = 5;
    for (let i = 0; i <= ticks; i += 1) {
      const y = pad.top + (plotH * i) / ticks;
      const val = max - (max * i) / ticks;
      g += `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${(pad.left + plotW).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#DCDDDD" stroke-width="1"/>`;
      g += `<text x="${pad.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#B5B5B6">${esc(fmtNum(val))}</text>`;
    }

    // X 轴标签
    const n = cats.length;
    if (n > 0) {
      const step = plotW / n;
      const maxLabels = Math.max(2, Math.floor(plotW / 60));
      const skip = Math.ceil(n / maxLabels);
      cats.forEach((c, i) => {
        if (i % skip !== 0 && i !== n - 1) return;
        const x = pad.left + step * i + step / 2;
        const label = c.length > 8 ? c.slice(0, 8) + '…' : c;
        g += `<text x="${x.toFixed(1)}" y="${(h - pad.bottom + 16).toFixed(1)}" text-anchor="middle" font-size="11" fill="rgba(0,51,120,.70)">${esc(label)}</text>`;
      });
    }

    return g;
  }

  /* ══════════ 柱状图 ══════════ */
  function barChart(rows, cfg, w, h) {
    const { cats, series, valueFields } = extract(rows, cfg);
    const pal = palette();
    const pad = { top: 20, right: 20, bottom: 40, left: 60 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const max = niceMax(Math.max(1, ...series.flat()));
    const n = Math.max(1, cats.length);
    const groupW = plotW / n;
    const barW = Math.max(2, (groupW * 0.7) / Math.max(1, series.length));

    let g = renderAxes(w, h, pad, max, cats, cfg);

    cats.forEach((c, i) => {
      series.forEach((s, si) => {
        const v = s[i] || 0;
        const bh = max > 0 ? (v / max) * plotH : 0;
        const x = pad.left + groupW * i + (groupW - barW * series.length) / 2 + barW * si;
        const y = pad.top + plotH - bh;
        g += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" fill="${pal[si % pal.length]}" rx="3"><title>${esc(c)} · ${esc(valueFields[si])}: ${esc(fmtNum(v))}</title></rect>`;
      });
    });

    return g;
  }

  /* ══════════ 折线图 / 面积图 ══════════ */
  function lineChart(rows, cfg, w, h, area) {
    const { cats, series, valueFields } = extract(rows, cfg);
    const pal = palette();
    const pad = { top: 20, right: 20, bottom: 40, left: 60 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const max = niceMax(Math.max(1, ...series.flat()));
    const n = Math.max(1, cats.length);
    const step = n > 1 ? plotW / (n - 1) : plotW;

    let g = renderAxes(w, h, pad, max, cats, cfg);

    series.forEach((s, si) => {
      const color = pal[si % pal.length];
      const pts = s.map((v, i) => {
        const x = pad.left + step * i;
        const y = pad.top + plotH - (max > 0 ? (v / max) * plotH : 0);
        return [x, y];
      });
      if (!pts.length) return;

      const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

      if (area) {
        const areaD = d + ` L${pts[pts.length - 1][0].toFixed(1)},${(pad.top + plotH).toFixed(1)}` +
                      ` L${pts[0][0].toFixed(1)},${(pad.top + plotH).toFixed(1)} Z`;
        g += `<path d="${areaD}" fill="${color}" opacity="0.16"/>`;
      }

      g += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;

      pts.forEach((p, i) => {
        g += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="#FFFFFF" stroke="${color}" stroke-width="2"><title>${esc(cats[i])} · ${esc(valueFields[si])}: ${esc(fmtNum(s[i]))}</title></circle>`;
      });
    });

    return g;
  }

  /* ══════════ 饼图 / 环形图 ══════════ */
  function pieChart(rows, cfg, w, h, donut) {
    const { cats, series } = extract(rows, cfg);
    const pal = palette();
    const data = (series[0] || []).map((v, i) => ({ label: cats[i], value: v }))
      .filter((d) => d.value > 0);
    const total = data.reduce((s, d) => s + d.value, 0);

    if (!total) return `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="13" fill="#B5B5B6">暂无数据</text>`;

    const cx = w * 0.36;
    const cy = h / 2;
    const r = Math.min(w * 0.3, h * 0.4);
    const inner = donut ? r * 0.58 : 0;

    let angle = -Math.PI / 2;
    let g = '';

    data.forEach((d, i) => {
      const slice = (d.value / total) * Math.PI * 2;
      const a1 = angle;
      const a2 = angle + slice;
      const large = slice > Math.PI ? 1 : 0;
      const x1 = cx + r * Math.cos(a1);
      const y1 = cy + r * Math.sin(a1);
      const x2 = cx + r * Math.cos(a2);
      const y2 = cy + r * Math.sin(a2);

      let dPath;
      if (donut) {
        const ix1 = cx + inner * Math.cos(a2);
        const iy1 = cy + inner * Math.sin(a2);
        const ix2 = cx + inner * Math.cos(a1);
        const iy2 = cy + inner * Math.sin(a1);
        dPath = `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} ` +
                `L${ix1.toFixed(1)},${iy1.toFixed(1)} A${inner},${inner} 0 ${large} 0 ${ix2.toFixed(1)},${iy2.toFixed(1)} Z`;
      } else {
        dPath = `M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z`;
      }

      const pct = ((d.value / total) * 100).toFixed(1);
      g += `<path d="${dPath}" fill="${pal[i % pal.length]}" stroke="#FFFFFF" stroke-width="2"><title>${esc(d.label)}: ${esc(fmtNum(d.value))} (${pct}%)</title></path>`;
      angle = a2;
    });

    // 图例
    const lx = w * 0.68;
    let ly = Math.max(16, cy - (data.length * 20) / 2);
    data.slice(0, 12).forEach((d, i) => {
      const pct = ((d.value / total) * 100).toFixed(1);
      g += `<rect x="${lx}" y="${ly - 8}" width="10" height="10" rx="2" fill="${pal[i % pal.length]}"/>`;
      const label = d.label.length > 10 ? d.label.slice(0, 10) + '…' : d.label;
      g += `<text x="${lx + 16}" y="${ly + 1}" font-size="11.5" fill="rgba(0,51,120,.80)">${esc(label)} ${pct}%</text>`;
      ly += 20;
    });

    return g;
  }

  /* ══════════ 散点图 ══════════ */
  function scatterChart(rows, cfg, w, h) {
    const pal = palette();
    const pad = { top: 20, right: 20, bottom: 40, left: 60 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const xf = cfg.xField;
    const yf = cfg.yField || (cfg.valueFields && cfg.valueFields[0]);

    const pts = (rows || []).map((r) => ({ x: Number(r[xf]), y: Number(r[yf]) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

    if (!pts.length) return `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="13" fill="#B5B5B6">暂无数据</text>`;

    const maxX = niceMax(Math.max(...pts.map((p) => p.x)));
    const maxY = niceMax(Math.max(...pts.map((p) => p.y)));

    let g = renderAxes(w, h, pad, maxY, [], cfg);

    pts.forEach((p) => {
      const x = pad.left + (maxX > 0 ? (p.x / maxX) * plotW : 0);
      const y = pad.top + plotH - (maxY > 0 ? (p.y / maxY) * plotH : 0);
      g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${pal[0]}" opacity="0.7"><title>${esc(xf)}: ${esc(fmtNum(p.x))}, ${esc(yf)}: ${esc(fmtNum(p.y))}</title></circle>`;
    });

    g += `<text x="${(pad.left + plotW / 2).toFixed(1)}" y="${(h - 6).toFixed(1)}" text-anchor="middle" font-size="11" fill="rgba(0,51,120,.70)">${esc(xf || '')}</text>`;
    g += `<text x="14" y="${(pad.top + plotH / 2).toFixed(1)}" text-anchor="middle" font-size="11" fill="rgba(0,51,120,.70)" transform="rotate(-90 14 ${(pad.top + plotH / 2).toFixed(1)})">${esc(yf || '')}</text>`;

    return g;
  }

  /* ══════════ 雷达图 ══════════ */
  function radarChart(rows, cfg, w, h) {
    const { cats, series, valueFields } = extract(rows, cfg);
    const pal = palette();
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.34;
    const n = Math.max(3, cats.length);
    const max = niceMax(Math.max(1, ...series.flat()));

    let g = '';
    // 网格
    for (let ring = 1; ring <= 4; ring += 1) {
      const rr = (r * ring) / 4;
      const pts = [];
      for (let i = 0; i < n; i += 1) {
        const a = -Math.PI / 2 + (Math.PI * 2 * i) / n;
        pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
      }
      g += `<polygon points="${pts.join(' ')}" fill="none" stroke="#DCDDDD" stroke-width="1"/>`;
    }
    // 轴线与标签
    for (let i = 0; i < n; i += 1) {
      const a = -Math.PI / 2 + (Math.PI * 2 * i) / n;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      g += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#DCDDDD"/>`;
      const lx = cx + (r + 18) * Math.cos(a);
      const ly = cy + (r + 18) * Math.sin(a);
      const label = String(cats[i] || '').slice(0, 6);
      g += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="rgba(0,51,120,.70)">${esc(label)}</text>`;
    }
    // 数据
    series.forEach((s, si) => {
      const pts = s.map((v, i) => {
        const a = -Math.PI / 2 + (Math.PI * 2 * i) / n;
        const rr = max > 0 ? (v / max) * r : 0;
        return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
      });
      g += `<polygon points="${pts.join(' ')}" fill="${pal[si % pal.length]}" fill-opacity="0.22" stroke="${pal[si % pal.length]}" stroke-width="2"/>`;
    });

    return g;
  }

  /* ══════════ 漏斗图 ══════════ */
  function funnelChart(rows, cfg, w, h) {
    const { cats, series } = extract(rows, cfg);
    const pal = palette();
    const data = (series[0] || []).map((v, i) => ({ label: cats[i], value: v })).filter((d) => d.value > 0);
    if (!data.length) return `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="13" fill="#B5B5B6">暂无数据</text>`;

    const max = Math.max(...data.map((d) => d.value));
    const pad = 24;
    const rowH = (h - pad * 2) / data.length;
    let g = '';

    data.forEach((d, i) => {
      const ratio = max > 0 ? d.value / max : 0;
      const bw = (w - pad * 2) * ratio;
      const x = (w - bw) / 2;
      const y = pad + rowH * i + 4;
      const bh = rowH - 10;
      g += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="5" fill="${pal[i % pal.length]}" opacity="0.9"><title>${esc(d.label)}: ${esc(fmtNum(d.value))}</title></rect>`;
      g += `<text x="${w / 2}" y="${(y + bh / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="12" fill="#FFFFFF" font-weight="600">${esc(d.label)} · ${esc(fmtNum(d.value))}</text>`;
    });

    return g;
  }

  /* ══════════ 仪表盘 ══════════ */
  function gaugeChart(rows, cfg, w, h) {
    const { series } = extract(rows, cfg);
    const pal = palette();
    const val = (series[0] && series[0][0]) || 0;
    const max = Number(cfg.gaugeMax) || niceMax(Math.max(val, 1));
    const ratio = Math.max(0, Math.min(1, max > 0 ? val / max : 0));

    const cx = w / 2;
    const cy = h * 0.72;
    const r = Math.min(w * 0.36, h * 0.56);
    const start = Math.PI;
    const end = Math.PI * 2;

    function arc(from, to, color, width) {
      const x1 = cx + r * Math.cos(from);
      const y1 = cy + r * Math.sin(from);
      const x2 = cx + r * Math.cos(to);
      const y2 = cy + r * Math.sin(to);
      const large = to - from > Math.PI ? 1 : 0;
      return `<path d="M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
    }

    let g = arc(start, end, '#DCDDDD', 18);
    if (ratio > 0) g += arc(start, start + (end - start) * ratio, pal[0], 18);

    g += `<text x="${cx}" y="${(cy - 8).toFixed(1)}" text-anchor="middle" font-size="30" font-weight="700" fill="#003378">${esc(fmtNum(val))}</text>`;
    g += `<text x="${cx}" y="${(cy + 18).toFixed(1)}" text-anchor="middle" font-size="12" fill="#B5B5B6">${esc(cfg.valueFields && cfg.valueFields[0] ? cfg.valueFields[0] : '')}</text>`;

    return g;
  }

  /* ══════════ 指标卡 ══════════ */
  function numberCard(rows, cfg, w, h) {
    const { series, valueFields } = extract(rows, cfg);
    const val = (series[0] && series[0][0]) || 0;
    const label = cfg.title || (valueFields[0] || '');
    return `<text x="${w / 2}" y="${h / 2 - 4}" text-anchor="middle" font-size="36" font-weight="700" fill="#003378">${esc(fmtNum(val))}</text>` +
           `<text x="${w / 2}" y="${h / 2 + 24}" text-anchor="middle" font-size="13" fill="#B5B5B6">${esc(label)}</text>`;
  }

  /* ══════════ 表格 ══════════ */
  function tableChart(rows, cfg, w, h) {
    const cols = cfg.columns && cfg.columns.length
      ? cfg.columns
      : (rows && rows.length ? Object.keys(rows[0]) : []);
    if (!cols.length) return `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="13" fill="#B5B5B6">暂无数据</text>`;

    const colW = w / cols.length;
    let g = `<rect x="0" y="0" width="${w}" height="30" fill="rgba(115,219,255,.08)"/>`;
    cols.forEach((c, i) => {
      g += `<text x="${(colW * i + 8).toFixed(1)}" y="20" font-size="12" font-weight="600" fill="rgba(0,51,120,.80)">${esc(String(c).slice(0, 14))}</text>`;
    });

    const maxRows = Math.floor((h - 30) / 26);
    (rows || []).slice(0, maxRows).forEach((r, ri) => {
      const y = 30 + ri * 26;
      g += `<rect x="0" y="${y}" width="${w}" height="26" fill="${ri % 2 ? 'rgba(115,219,255,.04)' : '#FFFFFF'}"/>`;
      cols.forEach((c, i) => {
        const v = r[c];
        const s = v === null || v === undefined ? '' : String(v);
        g += `<text x="${(colW * i + 8).toFixed(1)}" y="${y + 17}" font-size="12" fill="#003378">${esc(s.length > 16 ? s.slice(0, 16) + '…' : s)}</text>`;
      });
    });
    return g;
  }

  /* ══════════ 渲染入口 ══════════ */
  function render(container, rows, config) {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) return;

    const cfg = config || {};
    const w = el.clientWidth || 600;
    const h = cfg.height || el.clientHeight || 320;
    const type = cfg.chartType || 'bar';

    let inner = '';
    switch (type) {
      case 'bar': inner = barChart(rows, cfg, w, h); break;
      case 'line': inner = lineChart(rows, cfg, w, h, false); break;
      case 'area': inner = lineChart(rows, cfg, w, h, true); break;
      case 'pie': inner = pieChart(rows, cfg, w, h, false); break;
      case 'doughnut': inner = pieChart(rows, cfg, w, h, true); break;
      case 'scatter': inner = scatterChart(rows, cfg, w, h); break;
      case 'radar': inner = radarChart(rows, cfg, w, h); break;
      case 'funnel': inner = funnelChart(rows, cfg, w, h); break;
      case 'gauge': inner = gaugeChart(rows, cfg, w, h); break;
      case 'number': inner = numberCard(rows, cfg, w, h); break;
      case 'table': inner = tableChart(rows, cfg, w, h); break;
      default: inner = barChart(rows, cfg, w, h);
    }

    el.innerHTML = `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="display:block">${inner}</svg>`;
  }

  global.Charts = { render, palette, fmtNum, DEFAULT_PALETTE };
})(window);
