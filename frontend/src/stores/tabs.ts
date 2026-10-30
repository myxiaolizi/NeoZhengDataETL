/**
 * 多标签页状态：支持快速切换已打开的菜单
 *
 * V6.1 变更：
 *  1. **持久化**：tabs + activeKey 写入 localStorage，刷新后原样恢复；
 *     退出登录时 `reset()` 会连带清掉当前用户的持久化数据。
 *  2. **按用户隔离**：持久化键带用户后缀（`v61.tabs.<username>`），
 *     由 BasicLayout 在登录态就绪后调用 `bindUser()` 绑定。
 *     这样「被 401 踢出 / 换账号登录」不会继承上一个账号的标签列表；
 *     未绑定时不读也不写 localStorage（避免把上一个账号的标签当成本次初始数据）。
 *  3. 抽出 `matchRoute()`：标题与图标共用同一套「精确 → 动态 → 前缀」路由匹配，
 *     避免两处各写一份匹配逻辑后逐渐漂移。
 */
import { create } from 'zustand';
import { ROUTES, type RouteConf } from '@/routes';

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

/** localStorage 持久化键前缀（真实键 = `前缀 + 用户名`） */
const STORAGE_KEY = 'v61.tabs';

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
  /**
   * 绑定当前登录用户（BasicLayout 在 user 就绪后调用）。
   * 切换用户时载入该用户自己的标签列表；传空值则解绑并不读不写 localStorage。
   */
  bindUser: (username?: string | null) => void;
  /** 重置到初始状态并清除当前用户的持久化（退出登录时用） */
  reset: () => void;
}


/**
 * 路由匹配：精确 → 动态（/projects/:id）→ 最长前缀。
 * 找不到返回 undefined（未知路径）。
 */
export function matchRoute(path: string): RouteConf | undefined {
  const clean = path.split('?')[0];

  const exact = ROUTES.find((r) => r.path === clean);
  if (exact) return exact;

  const dynamic = ROUTES
    .filter((r) => r.path.includes(':'))
    .find((r) => new RegExp('^' + r.path.replace(/:[^/]+/g, '[^/]+') + '$').test(clean));
  if (dynamic) return dynamic;

  return ROUTES
    .filter((r) => !r.path.includes(':') && clean.startsWith(r.path + '/'))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

/** 从路由表解析标签名：支持 /projects/123 这类动态路径回退到父级名称 */
export function resolveTabTitle(path: string): string {
  return matchRoute(path)?.name || '页面';
}

/* ══════════ 持久化 ══════════ */

function isTabItem(v: unknown): v is TabItem {
  if (!v || typeof v !== 'object') return false;
  const t = v as Partial<TabItem>;
  return typeof t.key === 'string' && t.key.length > 0 && typeof t.title === 'string';
}

/**
 * 读取并修复持久化数据。
 * 任何异常 / 结构不合法都退回默认（只留固定标签），绝不让脏数据把标签栏搞崩。
 */
function loadPersisted(storageKey: string | null): { tabs: TabItem[]; activeKey: string } {
  const fallback = { tabs: [PINNED], activeKey: PINNED.key };
  try {
    if (!storageKey || typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const obj = JSON.parse(raw) as { tabs?: unknown; activeKey?: unknown } | null;
    const list = Array.isArray(obj?.tabs) ? obj.tabs.filter(isTabItem) : [];
    if (!list.length) return fallback;

    // 去重 + 固定标签永远置顶且不可关闭
    const seen = new Set<string>();
    const tabs: TabItem[] = [PINNED];
    seen.add(PINNED.key);
    list.forEach((t) => {
      const key = t.key.split('?')[0];
      if (seen.has(key)) return;
      seen.add(key);
      tabs.push({
        key,
        title: String(t.title || '').trim() || resolveTabTitle(key),
        // 只有固定首页不可关闭，其余一律可关（旧数据里的 closable 不可信）
        closable: key !== PINNED.key,
      });
    });

    const active = String(obj?.activeKey || '');
    return { tabs, activeKey: tabs.some((t) => t.key === active) ? active : PINNED.key };
  } catch {
    return fallback;
  }
}

function persist(storageKey: string | null, tabs: TabItem[], activeKey: string): void {
  try {
    if (!storageKey || typeof localStorage === 'undefined') return;
    localStorage.setItem(storageKey, JSON.stringify({ tabs, activeKey }));
  } catch {
    /* 隐私模式 / 配额满：持久化失败不影响本次使用 */
  }
}

function clearPersisted(storageKey: string | null): void {
  try {
    if (!storageKey || typeof localStorage === 'undefined') return;
    localStorage.removeItem(storageKey);
  } catch {
    /* 忽略 */
  }
}

export const useTabsStore = create<TabsState>((set, get) => {
  /**
   * 当前持久化键。null = 尚未绑定用户（不读不写 localStorage）。
   *
   * 用模块级变量而非 state：它只在 bindUser / commit 内部使用，
   * 放进 state 会多触发一次无意义的重渲染。
   */
  let storageKey: string | null = null;

  /** 统一的「改状态 + 落盘」入口 */
  const commit = (next: Partial<Pick<TabsState, 'tabs' | 'activeKey'>>) => {
    set(next);
    const s = get();
    persist(storageKey, s.tabs, s.activeKey);
  };

  return {
    // 初始不读 localStorage：等 bindUser(用户名) 后再载入，
    // 避免「被踢出登录 / 换账号」时把上一个账号的标签当成初始数据。
    tabs: [PINNED],
    activeKey: PINNED.key,

    openTab: (path) => {
      const clean = path.split('?')[0];
      const { tabs, activeKey } = get();

      // 已存在 → 仅切换
      const exists = tabs.find((t) => t.key === clean);
      if (exists) {
        if (activeKey !== clean) commit({ activeKey: clean });
        return;
      }

      const title = resolveTabTitle(clean);
      commit({
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
        commit({ tabs: next, activeKey: fallback.key });
        return fallback.key;
      }

      commit({ tabs: next });
      return null;
    },

    closeOthers: (key) => {
      const { tabs } = get();
      const next = tabs.filter((t) => t.key === key || !t.closable);
      commit({ tabs: next, activeKey: key });
    },

    closeAll: () => {
      commit({ tabs: [PINNED], activeKey: PINNED.key });
    },

    closeRight: (key) => {
      const { tabs, activeKey } = get();
      const idx = tabs.findIndex((t) => t.key === key);
      if (idx < 0) return;
      const next = tabs.filter((t, i) => i <= idx || !t.closable);
      const stillActive = next.some((t) => t.key === activeKey);
      commit({ tabs: next, activeKey: stillActive ? activeKey : key });
    },

    setActive: (key) => {
      if (get().activeKey !== key) commit({ activeKey: key });
    },

    bindUser: (username) => {
      const name = String(username || '').trim();
      const nextKey = name ? `${STORAGE_KEY}.${name}` : null;
      if (nextKey === storageKey) return;
      storageKey = nextKey;
      if (!nextKey) {
        // 解绑（未登录 / 正在登出）：回到初始态，不碰任何 localStorage
        set({ tabs: [PINNED], activeKey: PINNED.key });
        return;
      }
      const loaded = loadPersisted(nextKey);
      set({ tabs: loaded.tabs, activeKey: loaded.activeKey });
    },

    reset: () => {
      clearPersisted(storageKey);
      set({ tabs: [PINNED], activeKey: PINNED.key });
    },
  };
});
