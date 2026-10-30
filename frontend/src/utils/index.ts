/** 通用工具函数 */
import dayjs from 'dayjs';

/** 数字千分位 */
export function fmtNum(v: number | string | null | undefined): string {
  const n = Number(v);
  if (!isFinite(n)) return '0';
  return n.toLocaleString('zh-CN');
}

/** 百分比 */
export function fmtPct(v: number, digits = 1): string {
  if (!isFinite(v)) return '0%';
  return `${v.toFixed(digits)}%`;
}

/** 时间格式化 */
export function fmtTime(v: string | Date | null | undefined, pattern = 'YYYY-MM-DD HH:mm:ss'): string {
  if (!v) return '-';
  const d = dayjs(v);
  return d.isValid() ? d.format(pattern) : '-';
}

/** 相对时间 */
export function fmtAgo(v: string | Date | null | undefined): string {
  if (!v) return '-';
  const d = dayjs(v);
  if (!d.isValid()) return '-';
  const diff = dayjs().diff(d, 'second');
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`;
  return d.format('YYYY-MM-DD');
}

/** 文件大小 */
export function fmtSize(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 截断文本 */
export function truncate(s: string, max = 60): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** 复制到剪贴板 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 下载文本为文件 */
export function downloadText(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 防抖 */
export function debounce<T extends (...args: any[]) => void>(fn: T, wait = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** 深拷贝（结构化） */
export function deepClone<T>(v: T): T {
  if (typeof structuredClone === 'function') return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}

/** 安全 JSON 解析 */
export function safeJson<T = any>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

/** 树形数据扁平化 */
export function flattenTree<T extends { children?: T[] }>(tree: T[]): T[] {
  const out: T[] = [];
  const walk = (nodes: T[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(tree);
  return out;
}
