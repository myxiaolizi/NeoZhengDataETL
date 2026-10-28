/* 看板渲染库 v2 —— 对齐 zk2.zhengl.vip/pc.html 的视觉与交互
 *
 * 组件：KPI 大数字卡 / KPI 分区卡 / 环形图+图例 / 半环进度 / 进度条组
 *      排行榜 / 流程分布 / 趋势柱状 / 进行中列表 / 明细表
 */
(function (global) {
  'use strict';

  const THEME = {
    brand: '#2D6FE4', brand2: '#3687FF', brand3: '#45B4FF',
    green: '#A2D73C', green2: '#73DBFF',
    cyan: '#45B4FF', warn: '#FFC000', danger: '#E86161',
    purple: '#EC673C', pink: '#E86161', orange: '#FFC000',
  };

  const PALETTE = ['#45B4FF', '#FFC000', '#3687FF', '#A2D73C', '#EC673C', '#73DBFF', '#003378', '#B5B5B6'];

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** 数字格式化：万/亿 */
  function fmt(v) {
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + '亿';
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(2) + '万';
    return n.toLocaleString('zh-CN');
  }

  /** 整数格式化（带千分位） */
  function fmtInt(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return Math.round(n).toLocaleString('zh-CN');
  }

  function el(sel) {
    return typeof sel === 'string' ? document.querySelector(sel) : sel;
  }

  /* ══════════════════════════════════════════════
   *  1. KPI 大数字卡
   *  { title, value, unit, sub, color, split: [{label, value, unit, color}] }
   * ══════════════════════════════════════════════ */
  function kpiBig(cfg) {
    const c = cfg || {};
    const color = c.color || THEME.brand;

    const split = (c.split || []).map((s) => `
      <div class="sp" style="--sp-color:${s.color || color}">
        <div class="sp-l"><span class="d"></span>${esc(s.label)}</div>
        <div class="sp-v">${esc(s.value)}<em>${esc(s.unit || '')}</em></div>
      </div>`).join('');

    return `
      <div class="card-h">
        <h3><span class="dot" style="background:${color}"></span>${esc(c.title)}</h3>
        ${c.hint ? `<span class="hint">${esc(c.hint)}</span>` : ''}
      </div>
      <div class="card-b">
        <div class="bignum">
          <b style="color:${color}">${esc(c.value)}</b>
          <span>${esc(c.sub || '')}</span>
        </div>
        ${split ? `<div class="split">${split}</div>` : ''}
      </div>`;
  }

  /* ══════════════════════════════════════════════
   *  2. 环形图 + 图例
   *  { data: [{name, value, color}], center: {value, label}, size, stroke }
   * ══════════════════════════════════════════════ */
  function donutLegend(cfg) {
    const c = cfg || {};
    const data = (c.data || []).filter((d) => Number(d.value) > 0);
    const total = data.reduce((s, d) => s + Number(d.value), 0);
    const size = c.size || 170;
    const stroke = c.stroke || 26;
    const r = size / 2 - stroke / 2;
    const cx = size / 2;
    const cy = size / 2;
    const circ = 2 * Math.PI * r;

    let segs = '';
    let offset = 0;

    if (total > 0) {
      data.forEach((d, i) => {
        const frac = Number(d.value) / total;
        const len = frac * circ;
        const color = d.color || PALETTE[i % PALETTE.length];
        segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
          stroke="${color}" stroke-width="${stroke}"
          stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
          stroke-dashoffset="${(-offset).toFixed(2)}"
          transform="rotate(-90 ${cx} ${cy})">
          <title>${esc(d.name)}: ${fmt(d.value)} (${(frac * 100).toFixed(1)}%)</title>
        </circle>`;
        offset += len;
      });
    } else {
      segs = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#DCDDDD" stroke-width="${stroke}"/>`;
    }

    const centerV = c.center && c.center.value !== undefined ? c.center.value : fmt(total);
    const centerL = c.center && c.center.label ? c.center.label : '合计';

    const legend = data.map((d, i) => {
      const pct = total ? ((Number(d.value) / total) * 100).toFixed(1) : '0.0';
      const color = d.color || PALETTE[i % PALETTE.length];
      return `<div class="lg">
        <span class="sw" style="background:${color}"></span>
        <span class="lg-t">${esc(d.name)}</span>
        <span class="lg-v">${fmt(d.value)}</span>
        <span class="lg-p">${pct}%</span>
      </div>`;
    }).join('');

    return `
      <div class="card-h">
        <h3><span class="dot" style="background:${THEME.brand}"></span>${esc(c.title || '')}</h3>
        ${c.hint ? `<span class="hint">${esc(c.hint)}</span>` : ''}
      </div>
      <div class="card-b">
        <div class="donut-wrap">
          <svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${segs}</svg>
          <div class="donut-c">
            <div class="dc-v">${esc(centerV)}</div>
            <div class="dc-l">${esc(centerL)}</div>
          </div>
        </div>
        <div class="legend">${legend || '<div class="empty-mini">暂无数据</div>'}</div>
      </div>`;
  }

  /* ══════════════════════════════════════════════
   *  3. 半环进度
   *  { value, target, title, sub }
   * ══════════════════════════════════════════════ */
  function semi(cfg) {
    const c = cfg || {};
    const v = Number(c.value) || 0;
    const t = Number(c.target) || 0;
    const pct = t > 0 ? Math.min(100, (v / t) * 100) : 0;

    const w = c.width || 260;
    const h = c.height || 140;
    const cx = w / 2;
    const cy = h - 14;
    const r = Math.min(w / 2 - 20, h - 30);
    const stroke = c.stroke || 20;

    const arc = (from, to, color, grad) => {
      const x1 = cx + r * Math.cos(Math.PI + Math.PI * from);
      const y1 = cy + r * Math.sin(Math.PI + Math.PI * from);
      const x2 = cx + r * Math.cos(Math.PI + Math.PI * to);
      const y2 = cy + r * Math.sin(Math.PI + Math.PI * to);
      const large = (to - from) > 0.5 ? 1 : 0;
      return `<path d="M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)}"
        fill="none" stroke="${grad ? `url(#${grad})` : color}" stroke-width="${stroke}"
        stroke-linecap="round"/>`;
    };

    const gid = 'sg' + Math.random().toString(36).slice(2, 8);

    return `
      <div class="card-h">
        <h3><span class="dot" style="background:${THEME.green}"></span>${esc(c.title || '任务完成进度')}</h3>
        ${t > 0 ? `<span class="hint">目标 ${fmtInt(t)} ${esc(c.unit || '')}</span>` : ''}
      </div>
      <div class="card-b">
        <div class="semi-wrap">
          <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
            <defs>
              <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stop-color="${THEME.brand2}"/>
                <stop offset="100%" stop-color="${THEME.green}"/>
              </linearGradient>
            </defs>
            ${arc(0, 1, '#DCDDDD')}
            ${pct > 0 ? arc(0, pct / 100, null, gid) : ''}
          </svg>
          <div class="semi-c">
            <div class="sc-v">${pct.toFixed(1)}<em>%</em></div>
            <div class="sc-s">${fmtInt(v)} / ${fmtInt(t)}</div>
          </div>
        </div>
        ${c.sub ? `<div class="semi-sub">${esc(c.sub)}</div>` : ''}
      </div>`;
  }

  /* ══════════════════════════════════════════════
   *  4. 进度条组
   *  { items: [{label, value, target, color}], title }
   * ══════════════════════════════════════════════ */
  function progressGroup(cfg) {
    const c = cfg || {};
    const items = c.items || [];

    const html = items.map((it) => {
      const v = Number(it.value) || 0;
      const t = Number(it.target) || 0;
      const pct = t > 0 ? Math.min(100, (v / t) * 100) : 0;
      const color = it.color || (pct >= 100 ? THEME.green : pct >= 60 ? THEME.brand2 : THEME.warn);
      return `<div class="prog">
        <div class="pg-top">
          <span class="pg-l">${esc(it.label)}</span>
          <span class="pg-v">${fmtInt(v)}${t ? ' / ' + fmtInt(t) : ''} · ${pct.toFixed(1)}%</span>
        </div>
        <div class="pg-track"><div class="pg-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
      </div>`;
    }).join('');

    return `
      ${c.title ? `<div class="card-h"><h3><span class="dot" style="background:${THEME.brand3}"></span>${esc(c.title)}</h3></div>` : ''}
      <div class="card-b">${html || '<div class="empty-mini">暂无数据</div>'}</div>`;
  }

  /* ══════════════════════════════════════════════
   *  5. 排行榜
   *  { data: [{name, value, sub}], title, valueLabel, limit }
   * ══════════════════════════════════════════════ */
  function rank(cfg) {
    const c = cfg || {};
    const list = (c.data || []).slice(0, c.limit || 10);
    if (!list.length) {
      return `<div class="card-h"><h3><span class="dot" style="background:${THEME.purple}"></span>${esc(c.title || '排行榜')}</h3></div>
        <div class="card-b"><div class="empty-mini">暂无数据</div></div>`;
    }

    const max = Math.max(...list.map((d) => Number(d.value) || 0), 1);

    const rows = list.map((d, i) => {
      const pct = ((Number(d.value) || 0) / max) * 100;
      const noCls = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
      return `<div class="rank-row">
        <span class="rk-no ${noCls}">${i + 1}</span>
        <div class="rk-body">
          <div class="rk-top">
            <span class="rk-name" title="${esc(d.name)}">${esc(d.name)}</span>
            <span class="rk-val">${esc(d.valueText || fmtInt(d.value))}</span>
          </div>
          <div class="rk-track"><div class="rk-fill" style="width:${pct.toFixed(1)}%"></div></div>
          ${d.sub ? `<div class="rk-sub">${esc(d.sub)}</div>` : ''}
        </div>
      </div>`;
    }).join('');

    return `
      <div class="card-h">
        <h3><span class="dot" style="background:${THEME.purple}"></span>${esc(c.title || '排行榜')}</h3>
        ${c.hint ? `<span class="hint">${esc(c.hint)}</span>` : ''}
      </div>
      <div class="card-b"><div class="rank">${rows}</div></div>`;
  }

  /* ══════════════════════════════════════════════
   *  6. 流程分布
   *  { data: [{name, value, color}], title }
   * ══════════════════════════════════════════════ */
  function flowmap(cfg) {
    const c = cfg || {};
    const list = c.data || [];
    if (!list.length) {
      return `<div class="card-h"><h3><span class="dot" style="background:${THEME.warn}"></span>${esc(c.title || '流程分布')}</h3></div>
        <div class="card-b"><div class="empty-mini">暂无数据</div></div>`;
    }

    const max = Math.max(...list.map((d) => Number(d.value) || 0), 1);

    const rows = list.map((d, i) => {
      const pct = ((Number(d.value) || 0) / max) * 100;
      const color = d.color || PALETTE[i % PALETTE.length];
      return `<div class="fm-item">
        <div class="fm-head">
          <span class="fm-dot" style="background:${color}"></span>
          <span class="fm-name">${esc(d.name)}</span>
          <span class="fm-val">${fmtInt(d.value)}</span>
        </div>
        <div class="fm-track"><div class="fm-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
      </div>`;
    }).join('');

    return `
      <div class="card-h">
        <h3><span class="dot" style="background:${THEME.warn}"></span>${esc(c.title || '流程分布')}</h3>
        ${c.hint ? `<span class="hint">${esc(c.hint)}</span>` : ''}
      </div>
      <div class="card-b"><div class="flowmap">${rows}</div></div>`;
  }

  /* ══════════════════════════════════════════════
   *  7. 趋势柱状图
   *  { data: [{label, value}], title, color, height }
   * ══════════════════════════════════════════════ */
  function trendBar(cfg) {
    const c = cfg || {};
    const data = c.data || [];
    const h = c.height || 240;

    if (!data.length) {
      return `<div class="card-h"><h3><span class="dot" style="background:${THEME.brand}"></span>${esc(c.title || '趋势')}</h3></div>
        <div class="card-b"><div class="empty-mini">暂无数据</div></div>`;
    }

    const w = 900;
    const pad = { top: 20, right: 20, bottom: 36, left: 56 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    let max = Math.max(...data.map((d) => Number(d.value) || 0), 1);
    const exp = Math.floor(Math.log10(max));
    const base = Math.pow(10, exp);
    max = Math.ceil(max / base) * base;

    let g = '';

    // 网格
    for (let i = 0; i <= 4; i += 1) {
      const y = pad.top + (plotH * i) / 4;
      const val = max - (max * i) / 4;
      g += `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${pad.left + plotW}" y2="${y.toFixed(1)}" stroke="#DCDDDD" stroke-width="1"/>`;
      g += `<text x="${pad.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="rgba(0,51,120,.55)">${fmt(val)}</text>`;
    }

    const n = data.length;
    const step = plotW / n;
    const bw = Math.max(6, Math.min(40, step * 0.55));
    const color = c.color || THEME.brand2;

    data.forEach((d, i) => {
      const v = Number(d.value) || 0;
      const bh = max > 0 ? (v / max) * plotH : 0;
      const x = pad.left + step * i + (step - bw) / 2;
      const y = pad.top + plotH - bh;
      g += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}"
        fill="${color}" opacity="0.85" rx="3">
        <title>${esc(d.label)}: ${fmt(v)}</title>
      </rect>`;
      g += `<text x="${(x + bw / 2).toFixed(1)}" y="${(h - pad.bottom + 18)}" text-anchor="middle" font-size="11" fill="rgba(0,51,120,.55)">${esc(d.label)}</text>`;
    });

    return `
      <div class="card-h">
        <h3><span class="dot" style="background:${color}"></span>${esc(c.title || '趋势')}</h3>
        ${c.hint ? `<span class="hint">${esc(c.hint)}</span>` : ''}
      </div>
      <div class="card-b">
        <svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="display:block">${g}</svg>
      </div>`;
  }

  /* ══════════════════════════════════════════════
   *  8. 进行中列表
   *  { data: [{name, value, sub}], title }
   * ══════════════════════════════════════════════ */
  function ingList(cfg) {
    const c = cfg || {};
    const list = c.data || [];

    const rows = list.map((d) => `
      <div class="ing-row">
        <span class="ing-dot" style="background:${d.color || THEME.warn}"></span>
        <span class="ing-name">${esc(d.name)}</span>
        <span class="ing-val">${fmtInt(d.value)}</span>
      </div>`).join('');

    return `
      <div class="card-h">
        <h3><span class="dot" style="background:${THEME.warn}"></span>${esc(c.title || '进行中')}</h3>
        ${c.hint ? `<span class="hint">${esc(c.hint)}</span>` : ''}
      </div>
      <div class="card-b"><div class="ing">${rows || '<div class="empty-mini">暂无数据</div>'}</div></div>`;
  }

  /* ══════════════════════════════════════════════
   *  9. 明细表（含搜索/分页）
   *  { columns, rows, pageSize, title }
   * ══════════════════════════════════════════════ */
  function detailTable(cfg) {
    const c = cfg || {};
    const cols = c.columns || [];
    const rows = c.rows || [];
    const size = c.pageSize || 20;

    const head = cols.map((col) =>
      `<th style="${col.width ? 'width:' + col.width : ''}">${esc(col.label || col.name)}</th>`).join('');

    const body = rows.slice(0, size).map((r) =>
      `<tr>${cols.map((col) => {
        const v = r[col.name];
        const s = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
        const display = col.render ? col.render(v, r) : esc(s.slice(0, 80));
        return `<td title="${esc(s)}"><span class="cell-inner">${display}</span></td>`;
      }).join('')}</tr>`).join('');

    return `
      <div class="card-h">
        <h3><span class="dot" style="background:${THEME.brand}"></span>${esc(c.title || '明细')}</h3>
        <span class="hint">共 ${rows.length} 条</span>
      </div>
      <div class="table-scroll">
        <table class="table table-fixed">
          <thead><tr>${head}</tr></thead>
          <tbody>${body || `<tr><td colspan="${cols.length}" class="empty">暂无数据</td></tr>`}</tbody>
        </table>
      </div>`;
  }

  /* ══════════════════════════════════════════════
   *  渲染入口：按类型分发
   * ══════════════════════════════════════════════ */
  const RENDERERS = {
    kpi: kpiBig,
    kpiSplit: kpiBig,
    donutLegend,
    semi,
    progress: progressGroup,
    rank,
    flowmap,
    trendBar,
    ingList,
    detailTable,
  };

  /**
   * 渲染单个卡片
   * @param {Element|string} container 容器
   * @param {string} type 组件类型
   * @param {object} cfg 配置
   */
  function renderCard(container, type, cfg) {
    const box = el(container);
    if (!box) return;
    const fn = RENDERERS[type];
    if (!fn) {
      box.innerHTML = `<div class="card-b"><div class="empty-mini">未知组件：${esc(type)}</div></div>`;
      return;
    }
    box.innerHTML = fn(cfg);
  }

  global.Dash = {
    THEME, PALETTE, esc, fmt, fmtInt,
    kpiBig, donutLegend, semi, progressGroup, rank, flowmap, trendBar, ingList, detailTable,
    renderCard, RENDERERS,
  };
})(window);
