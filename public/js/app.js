/* 简道云推送接收平台 - 前端公共脚本 */

async function api(url, options) {
  const opts = Object.assign({ headers: {} }, options || {});
  if (opts.body && typeof opts.body === 'object') {
    opts.headers['Content-Type'] = 'application/json; charset=utf-8';
    opts.body = JSON.stringify(opts.body);
  }
  try {
    const resp = await fetch(url, opts);
    if (resp.status === 401) {
      const isLoginPage = location.pathname === '/login';
      if (!isLoginPage) {
        location.href = '/login?redirect=' + encodeURIComponent(location.pathname + location.search);
      }
      return { ok: false, message: '登录已过期，请重新登录' };
    }
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      return await resp.json();
    }
    return { ok: resp.ok, message: await resp.text() };
  } catch (err) {
    return { ok: false, message: '网络错误：' + err.message };
  }
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let toastTimer = null;
function toast(msg, type) {
  const el = document.getElementById('toast');
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2800);
}

function fmtTime(v) {
  if (v === null || v === undefined || v === '') return '-';
  let d;
  if (typeof v === 'number') d = new Date(v);
  else if (/^\d+$/.test(String(v))) d = new Date(Number(v));
  else d = new Date(String(v).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('show');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('show');
}

document.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('modal-mask')) {
    e.target.classList.remove('show');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-mask.show').forEach((m) => m.classList.remove('show'));
  }
});

function copyText(text) {
  const done = () => toast('已复制到剪贴板', 'success');
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (err) { toast('复制失败，请手动选择复制', 'error'); }
    document.body.removeChild(ta);
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(fallback);
  } else {
    fallback();
  }
}

function debounce(fn, wait) {
  let t = null;
  return function () {
    const args = arguments;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

function renderPager(containerId, total, page, pageSize, onGo) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const parts = [];
  parts.push(`<span class="pinfo">共 ${total} 条，第 ${page} / ${pages} 页</span>`);
  parts.push(`<button ${page <= 1 ? 'disabled' : ''} data-p="${page - 1}">上一页</button>`);

  const start = Math.max(1, page - 2);
  const end = Math.min(pages, start + 4);
  if (start > 1) parts.push(`<button data-p="1">1</button>`);
  if (start > 2) parts.push('<span class="pinfo">…</span>');
  for (let i = start; i <= end; i += 1) {
    parts.push(`<button class="${i === page ? 'active' : ''}" data-p="${i}">${i}</button>`);
  }
  if (end < pages - 1) parts.push('<span class="pinfo">…</span>');
  if (end < pages) parts.push(`<button data-p="${pages}">${pages}</button>`);
  parts.push(`<button ${page >= pages ? 'disabled' : ''} data-p="${page + 1}">下一页</button>`);

  el.innerHTML = parts.join('');
  el.querySelectorAll('button[data-p]').forEach((b) => {
    b.addEventListener('click', () => {
      const p = parseInt(b.dataset.p, 10);
      if (p >= 1 && p <= pages && p !== page) onGo(p);
    });
  });
}

/** 从表格文本中解析 Markdown / Tab 分隔表格（前端预览用，最终以后端解析为准） */
function parseTableText(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    let cells;
    if (line.startsWith('|')) {
      cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    } else if (line.includes('\t')) {
      cells = line.split('\t').map((c) => c.trim());
    } else {
      continue;
    }
    if (cells.every((c) => c === '' || /^:?-{2,}:?$/.test(c))) continue;
    const joined = cells.join(' ');
    if (/字段名称/.test(joined) && /(字段ID|字段别名|字段类型)/.test(joined)) continue;
    if (!cells[0] || !cells[1]) continue;
    rows.push({ name: cells[0], key: cells[1], type: cells[2] || '', remark: cells[3] || '' });
  }
  return rows;
}

/** 文件下载 */
function download(url) {
  const a = document.createElement('a');
  a.href = url;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 100);
}