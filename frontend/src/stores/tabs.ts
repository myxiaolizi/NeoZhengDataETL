/** 多标签页状态：支持快速切换已打开的菜单 */
import { create } from 'zustand';
import { ROUTES } from '@/routes';

export interface TabItem {
  /** 路由路径，同时也作为唯一 key */
  key: string;
  /** 标签显示名 */
  title: string;
  /** 是否可关闭（首页固定不可关） */
  closable: boolean;
}

/** 固定标签：始终存在且不可关闭 */
const PINNED: TabItem = { key: '/dashboard', title: '数据概览', closable: false };

interface TabsState {
  tabs: TabItem[];
  activeKey: string;
  /** 添加或激活标签 */
  openTab: (path: string) => void;
  /** 关闭标签，返回应当跳转的路径（无则 null） */
  closeTab: (key: string) => string | null;
  /** 关闭其它标签 */
  closeOthers: (key: string) => void;
  /** 关闭全部（保留固定标签） */
  closeAll: () => void;
  /** 关闭右侧标签 */
  closeRight: (key: string) => void;
  /** 设置激活项（不新增） */
  setActive: (key: string) => void;
  /** 重置到初始状态（退出登录时用） */
  reset: () => void;
}

/** 从路由表解析标签名：支持 /projects/123 这类动态路径回退到父级名称 */
export function resolveTabTitle(path: string): string {
  const clean = path.split('?')[0];

  // 精确匹配
  const exact = ROUTES.find((r) => r.path === clean);
  if (exact) return exact.name;

  // 动态路径：/projects/123/fields → 用「字段配置」；/projects/123 → 用「数据项目」
  const dynamic = ROUTES
    .filter((r) => r.path.includes(':'))
    .map((r) => {
      const re = new RegExp('^' + r.path.replace(/:[^/]+/g, '[^/]+') + '$');
      return { route: r, ok: re.test(clean) };
    })
    .find((x) => x.ok);
  if (dynamic) return dynamic.route.name;

  // 前缀回退：/projects/123 → /projects
  const prefix = ROUTES
    .filter((r) => !r.path.includes(':') && clean.startsWith(r.path + '/'))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (prefix) return prefix.name;

  return '页面';
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [PINNED],
  activeKey: PINNED.key,

  openTab: (path) => {
    const clean = path.split('?')[0];
    const { tabs, activeKey } = get();

    // 已存在 → 仅切换
    const exists = tabs.find((t) => t.key === clean);
    if (exists) {
      if (activeKey !== clean) set({ activeKey: clean });
      return;
    }

    const title = resolveTabTitle(clean);
    set({
      tabs: [...tabs, { key: clean, title, closable: clean !== PINNED.key }],
      activeKey: clean,
    });
  },

  closeTab: (key) => {
    const { tabs, activeKey } = get();
    const idx = tabs.findIndex((t) => t.key === key);
    if (idx < 0) return null;
    if (!tabs[idx].closable) return null;

    const next = tabs.filter((t) => t.key !== key);

    // 关闭的是当前标签 → 激活右侧邻居，没有则左侧
    if (activeKey === key) {
      const fallback = next[idx] || next[idx - 1] || PINNED;
      set({ tabs: next, activeKey: fallback.key });
      return fallback.key;
    }

    set({ tabs: next });
    return null;
  },

  closeOthers: (key) => {
    const { tabs } = get();
    const next = tabs.filter((t) => t.key === key || !t.closable);
    set({ tabs: next, activeKey: key });
  },

  closeAll: () => {
    set({ tabs: [PINNED], activeKey: PINNED.key });
  },

  closeRight: (key) => {
    const { tabs, activeKey } = get();
    const idx = tabs.findIndex((t) => t.key === key);
    if (idx < 0) return;
    const next = tabs.filter((t, i) => i <= idx || !t.closable);
    const stillActive = next.some((t) => t.key === activeKey);
    set({ tabs: next, activeKey: stillActive ? activeKey : key });
  },

  setActive: (key) => set({ activeKey: key }),

  reset: () => set({ tabs: [PINNED], activeKey: PINNED.key }),
}));
