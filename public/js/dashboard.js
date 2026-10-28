/* 看板渲染库 —— 参考 zk2.zhengl.vip/pc.html 的看板风格
 *
 * 提供：KPI 卡、环形图、半环进度、进度条、排行榜、趋势图、流程分布、明细表
 * 纯 SVG + DOM 实现，无外部依赖
 */
(function (global) {
  'use strict';

  const PALETTE = ['#45B4FF', '#FFC000', '#3687FF', '#A2D73C', '#EC673C', '#73DBFF', '#003378', '#B5B5B6', '#E86161', '#DCDDDD'];

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtNum(v, digits) {
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    if (digits !== undefined) return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(2) + ' 万';
    return n.toLocaleString('zh-CN');
  }

  function fmtMoney(v) {
    const n = Number(v) || 0;
    if (Math.abs(n) >= 1e8) return '¥' + (n / 1e8).toFixed(2) + ' 亿';
    if (Math.abs(n) >= 1e4) return '¥' + (n / 1e4).toFixed(2) + ' 万';
    return '¥' + n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }

  function el(sel) {
    return typeof sel === 'string' ? document.querySelector(sel) : sel;
  }

  /* ══════════ KPI 卡 ══════════ */

  /**
   * 渲染 KPI 卡片组
   * @param {string|Element} container
   * @param {Array} items [{label, value, sub, icon, tone, drill}]
   * @param {object} opts {columns, onClick}
   */
  function kpi(container, items, opts) {
    const box = el(container);
    if (!box) return;
    const o = opts || {};
    box.className = 'kpi-grid' + (o.columns ? ' cols-' + o.columns : '');
    box.innerHTML = (items || []).map((it, i) => {
      const tone = it.tone || 'brand';
      return '<div class="kpi-card tone-' + tone + (it.drill ? ' clickable' : '') + '" data-idx="' + i + '">' +
        '<div class="kpi-top">' +
          '<div class="kpi-label">' + esc(it.label) + '</div>' +
          (it.icon ? '<div class="kpi-ico">' + it.icon + '</div>' : '') +
        '</div>' +
        '<div class="kpi-value">' + (it.html || esc(it.value)) + '</div>' +
        (it.sub ? '<div class="kpi-foot">' + (it.subHtml || esc(it.sub)) + '</div>' : '') +
      '</div>';
    }).join('');

    if (o.onClick) {
      box.querySelectorAll('.kpi-card.clickable').forEach((c) => {
        c.addEventListener('click', () => o.onClick(items[Number(c.dataset.idx)]));
      });
    }
  }

  /* ══════════ 环形图 ══════════ */

  /**
   * 环形图（带中心汇总）
   * @param {Array} data [{name, value}]
   */
  function donut(data, opts) {
    const o = opts || {};
    const size = o.size || 200;
    const stroke = o.stroke || 26;
    const total = (data || []).reduce((s, d) => s + (Number(d.value) || 0), 0);

    if (!total) {
      return '<div class="donut-wrap"><svg width="' + size + '" height="' + size + '">' +
        '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + (size / 2 - stroke / 2) + '" fill="none" stroke="#DCDDDD" stroke-width="' + stroke + '"/>' +
        '</svg><div class="donut-c"><div class="dc-v">0</div><div class="dc-l">暂无数据</div></div></div>';
    }

    const r = size / 2 - stroke / 2;
    const cx = size / 2;
    const cy = size / 2;
    const circ = 2 * Math.PI * r;
    let offset = 0;

    const segs = (data || []).filter((d) => Number(d.value) > 0).map((d, i) => {
      const frac = Number(d.value) / total;
      const len = frac * circ;
      const seg = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" ' +
        'stroke="' + (d.color || PALETTE[i % PALETTE.length]) + '" stroke-width="' + stroke + '" ' +
        'stroke-dasharray="' + len.toFixed(2) + ' ' + (circ - len).toFixed(2) + '" ' +
        'stroke-dashoffset="' + (-offset).toFixed(2) + '" ' +
        'transform="rotate(-90 ' + cx + ' ' + cy + ')">' +
        '<title>' + esc(d.name) + ': ' + fmtNum(d.value) + ' (' + (frac * 100).toFixed(1) + '%)</title>' +
        '</circle>';
      offset += len;
      return seg;
    }).join('');

    const centerV = o.centerValue !== undefined ? o.centerValue : fmtNum(total);
    const centerL = o.centerLabel || '合计';

    return '<div class="donut-wrap">' +
      '<svg width="' + size + '" height="' + size + '">' + segs + '</svg>' +
      '<div class="donut-c"><div class="dc-v">' + esc(centerV) + '</div>' +
      '<div class="dc-l">' + esc(centerL) + '</div></div>' +
    '</div>';
  }

  /** 环形图 + 图例 */
  function donutWithLegend(data, opts) {
    const o = opts || {};
    const total = (data || []).reduce((s, d) => s + (Number(d.value) || 0), 0);
    const legend = (data || []).map((d, i) => {
      const pct = total ? ((Number(d.value) / total) * 100).toFixed(1) : '0.0';
      return '<div class="lg">' +
        '<span class="sw" style="background:' + (d.color || PALETTE[i % PALETTE.length]) + '"></span>' +
        '<span class="lg-t">' + esc(d.name) + '</span>' +
        '<span class="lg-v">' + fmtNum(d.value) + '</span>' +
        '<span class="lg-p">' + pct + '%</span>' +
      '</div>';
    }).join('');

    return '<div class="donut-row">' + donut(data, o) + '<div class="legend">' + legend + '</div></div>';
  }

  /* ══════════ 半环进度 ══════════ */

  /**
   * 半环进度（用于任务完成度）
   * @param {number} value 当前值
   * @param {number} target 目标值
   */
  function semi(value, target, opts) {
    const o = opts || {};
    const v = Number(value) || 0;
    const t = Number(target) || 0;
    const pct = t > 0 ? Math.min(100, (v / t) * 100) : 0;

    const w = o.width || 220;
    const h = o.height || 120;
    const cx = w / 2;
    const cy = h - 10;
    const r = Math.min(w / 2 - 16, h - 24);
    const stroke = o.stroke || 18;

    const arc = (from, to, color) => {
      const x1 = cx + r * Math.cos(Math.PI + Math.PI * from);
      const y1 = cy + r * Math.sin(Math.PI + Math.PI * from);
      const x2 = cx + r * Math.cos(Math.PI + Math.PI * to);
      const y2 = cy + r * Math.sin(Math.PI + Math.PI * to);
      const large = (to - from) > 0.5 ? 1 : 0;
      return '<path d="M' + x1.toFixed(1) + ',' + y1.toFixed(1) +
        ' A' + r + ',' + r + ' 0 ' + large + ' 1 ' + x2.toFixed(1) + ',' + y2.toFixed(1) + '" ' +
        'fill="none" stroke="' + color + '" stroke-width="' + stroke + '" stroke-linecap="round"/>';
    };

    const id = 'semiGrad' + Math.random().toString(36).slice(2, 8);

    return '<div class="semi-wrap">' +
      '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
        '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="0">' +
          '<stop offset="0%" stop-color="#3687FF"/><stop offset="100%" stop-color="#A2D73C"/>' +
        '</linearGradient></defs>' +
        arc(0, 1, '#DCDDDD') +
        (pct > 0 ? arc(0, pct / 100, 'url(#' + id + ')') : '') +
      '</svg>' +
      '<div class="semi-c">' +
        '<div class="sc-v">' + pct.toFixed(1) + '%</div>' +
        '<div class="sc-s">' + fmtNum(v) + ' / ' + fmtNum(t) + '</div>' +
      '</div>' +
    '</div>';
  }

  /* ══════════ 进度条 ══════════ */

  function progress(value, target, opts) {
    const o = opts || {};
    const v = Number(value) || 0;
    const t = Number(target) || 0;
    const pct = t > 0 ? Math.min(100, (v / t) * 100) : 0;
    const color = o.color || (pct >= 100 ? '#A2D73C' : pct >= 60 ? '#3687FF' : '#FFC000');

    return '<div class="prog">' +
      '<div class="pg-top">' +
        '<span class="pg-l">' + esc(o.label || '') + '</span>' +
        '<span class="pg-v">' + fmtNum(v) + ' / ' + fmtNum(t) + ' · ' + pct.toFixed(1) + '%</span>' +
      '</div>' +
      '<div class="pg-track"><div class="pg-fill" style="width:' + pct.toFixed(1) + '%;background:' + color + '"></div></div>' +
    '</div>';
  }

  /* ══════════ 排行榜 ══════════ */

  /**
   * 排行榜
   * @param {Array} data [{name, value, sub}]
   */
  function rank(data, opts) {
    const o = opts || {};
    const list = (data || []).slice(0, o.limit || 10);
    if (!list.length) return '<div class="empty-mini">暂无数据</div>';
    const max = Math.max(...list.map((d) => Number(d.value) || 0), 1);

    return '<div class="rank">' + list.map((d, i) => {
      const pct = ((Number(d.value) || 0) / max) * 100;
      const medal = i < 3 ? ' top' + (i + 1) : '';
      return '<div class="rank-item">' +
        '<span class="rk-no' + medal + '">' + (i + 1) + '</span>' +
        '<div class="rk-body">' +
          '<div class="rk-top">' +
            '<span class="rk-name" title="' + esc(d.name) + '">' + esc(d.name) + '</span>' +
            '<span class="rk-val">' + (d.valueText || fmtNum(d.value)) + '</span>' +
          '</div>' +
          '<div class="rk-track"><div class="rk-fill" style="width:' + pct.toFixed(1) + '%"></div></div>' +
          (d.sub ? '<div class="rk-sub">' + esc(d.sub) + '</div>' : '') +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  /* ══════════ 趋势图（折线/柱状组合） ══════════ */

  /**
   * 趋势图
   * @param {Array} data [{label, values: [n1, n2]}]
   * @param {Array} series [{name, color}]
   */
  function trend(data, series, opts) {
    const o = opts || {};
    const w = o.width || 800;
    const h = o.height || 260;
    const pad = { top: 24, right: 20, bottom: 34, left: 56 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    if (!data || !data.length) {
      return '<div class="empty-mini" style="height:' + h + 'px;display:flex;align-items:center;justify-content:center">暂无数据</div>';
    }

    const allVals = [];
    data.forEach((d) => (d.values || []).forEach((v) => allVals.push(Number(v) || 0)));
    let max = Math.max(...allVals, 1);
    const exp = Math.floor(Math.log10(max));
    const base = Math.pow(10, exp);
    max = Math.ceil(max / base) * base;

    let g = '';

    // 网格 + Y 轴
    for (let i = 0; i <= 4; i += 1) {
      const y = pad.top + (plotH * i) / 4;
      const val = max - (max * i) / 4;
      g += '<line x1="' + pad.left + '" y1="' + y.toFixed(1) + '" x2="' + (pad.left + plotW) + '" y2="' + y.toFixed(1) + '" stroke="#DCDDDD" stroke-width="1"/>';
      g += '<text x="' + (pad.left - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="rgba(0,51,120,.55)">' + fmtNum(val) + '</text>';
    }

    const n = data.length;
    const step = n > 1 ? plotW / (n - 1) : plotW;

    // X 轴标签
    const skip = Math.ceil(n / Math.max(2, Math.floor(plotW / 70)));
    data.forEach((d, i) => {
      if (i % skip !== 0 && i !== n - 1) return;
      const x = pad.left + step * i;
      g += '<text x="' + x.toFixed(1) + '" y="' + (h - pad.bottom + 18) + '" text-anchor="middle" font-size="11" fill="rgba(0,51,120,.55)">' + esc(d.label) + '</text>';
    });

    // 柱状（第一个系列）
    if (o.bars && series[0]) {
      const bw = Math.max(4, Math.min(28, (plotW / n) * 0.5));
      data.forEach((d, i) => {
        const v = Number((d.values || [])[0]) || 0;
        const bh = max > 0 ? (v / max) * plotH : 0;
        const x = pad.left + step * i - bw / 2;
        const y = pad.top + plotH - bh;
        g += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, bh).toFixed(1) + '" fill="' + (series[0].color || PALETTE[0]) + '" opacity="0.75" rx="3"><title>' + esc(d.label) + ': ' + fmtNum(v) + '</title></rect>';
      });
    }

    // 折线
    (series || []).forEach((s, si) => {
      if (o.bars && si === 0) return;
      const color = s.color || PALETTE[si % PALETTE.length];
      const pts = data.map((d, i) => {
        const v = Number((d.values || [])[si]) || 0;
        const x = pad.left + step * i;
        const y = pad.top + plotH - (max > 0 ? (v / max) * plotH : 0);
        return [x, y, v];
      });
      if (!pts.length) return;

      const dPath = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');

      if (o.area) {
        g += '<path d="' + dPath + ' L' + pts[pts.length - 1][0].toFixed(1) + ',' + (pad.top + plotH) +
          ' L' + pts[0][0].toFixed(1) + ',' + (pad.top + plotH) + ' Z" fill="' + color + '" opacity="0.12"/>';
      }

      g += '<path d="' + dPath + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';

      pts.forEach((p, i) => {
        g += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.5" fill="#FFFFFF" stroke="' + color + '" stroke-width="2">' +
          '<title>' + esc(data[i].label) + ' · ' + esc(s.name) + ': ' + fmtNum(p[2]) + '</title></circle>';
      });
    });

    return '<svg width="100%" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet" style="display:block">' + g + '</svg>';
  }

  /* ══════════ 流程/状态分布 ══════════ */

  function flowmap(items, opts) {
    const o = opts || {};
    const list = items || [];
    if (!list.length) return '<div class="empty-mini">暂无数据</div>';
    const max = Math.max(...list.map((d) => Number(d.value) || 0), 1);

    return '<div class="flowmap">' + list.map((d, i) => {
      const pct = ((Number(d.value) || 0) / max) * 100;
      const color = d.color || PALETTE[i % PALETTE.length];
      return '<div class="fm-item">' +
        '<div class="fm-head">' +
          '<span class="fm-dot" style="background:' + color + '"></span>' +
          '<span class="fm-name">' + esc(d.name) + '</span>' +
          '<span class="fm-val">' + fmtNum(d.value) + '</span>' +
        '</div>' +
        '<div class="fm-track"><div class="fm-fill" style="width:' + pct.toFixed(1) + '%;background:' + color + '"></div></div>' +
      '</div>';
    }).join('') + '</div>';
  }

  /* ══════════ 明细表 ══════════ */

  function table(container, columns, rows, opts) {
    const box = el(container);
    if (!box) return;
    const o = opts || {};

    const head = '<tr>' + columns.map((c) =>
      '<th style="' + (c.width ? 'width:' + c.width : '') + '">' + esc(c.label || c.name) + '</th>').join('') + '</tr>';

    const body = (rows || []).map((r) => '<tr>' + columns.map((c) => {
      const v = r[c.name];
      const s = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      const display = c.render ? c.render(v, r) : esc(s.slice(0, 100));
      return '<td title="' + esc(s) + '"><span class="cell-inner">' + display + '</span></td>';
    }).join('') + '</tr>').join('');

    box.innerHTML = '<thead>' + head + '</thead><tbody>' +
      (body || '<tr><td colspan="' + columns.length + '" class="empty">暂无数据</td></tr>') + '</tbody>';
  }

  global.Dashboard = {
    PALETTE, esc, fmtNum, fmtMoney,
    kpi, donut, donutWithLegend, semi, progress, rank, trend, flowmap, table,
  };
})(window);
