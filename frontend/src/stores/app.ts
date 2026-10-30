/** 全局状态：用户、主题、权限 */
import { create } from 'zustand';
import { useMemo } from 'react';
import type { User } from '@/types';
import { api } from '@/api/client';

interface AppState {
  user: User | null;
  loading: boolean;
  themeColor: string;
  collapsed: boolean;
  mobile: boolean;
  fetchUser: () => Promise<User | null>;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
  setThemeColor: (c: string) => void;
  setCollapsed: (v: boolean) => void;
  setMobile: (v: boolean) => void;
  can: (perm: string | string[]) => boolean;
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  loading: true,
  themeColor: '#3687FF',
  collapsed: false,
  mobile: false,

  fetchUser: async () => {
    try {
      const u = await api.get<User>('/me', { silent: true });
      set({ user: u, loading: false });
      return u;
    } catch {
      set({ user: null, loading: false });
      return null;
    }
  },

  setUser: (u) => set({ user: u }),

  logout: async () => {
    try {
      await api.post('/logout', undefined, { silent: true });
    } catch { /* 忽略 */ }
    set({ user: null });
  },

  setThemeColor: (c) => set({ themeColor: c }),
  setCollapsed: (v) => set({ collapsed: v }),
  setMobile: (v) => set({ mobile: v }),

  /** 权限判断：支持单个或数组（数组为「任一满足」） */
  can: (perm) => {
    const user = get().user;
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'super') return true;
    const perms = user.permissions || [];
    if (perms.includes('*')) return true;
    const need = Array.isArray(perm) ? perm : [perm];
    if (!need.length) return true;
    return need.some((p) => perms.includes(p));
  },
}));

/**
 * 权限 hook —— 页面里必须用这个，不要直接订阅 store.can。
 *
 * 为什么不直接写 useAppStore((s) => s.can)：
 * 那样订阅到的是 store.can 这个函数引用，它在 store 生命周期内恒定不变，
 * 用户信息异步到位后组件不会重渲染，导致「新建/编辑/删除」这类
 * 受权限控制的按钮永远不显示。
 *
 * 本 hook 同时订阅 user，user 变化时返回新的判断函数，依赖它的
 * 组件（含 useMemo/useEffect 依赖）会正确更新。
 *
 * 用法：
 *   const can = usePermission();
 *   const canWrite = can('project:write');
 */
export function usePermission() {
  const user = useAppStore((s) => s.user);
  return useMemo(() => {
    return (perm: string | string[]): boolean => {
      if (!user) return false;
      if (user.role === 'admin' || user.role === 'super') return true;
      const perms = user.permissions || [];
      if (perms.includes('*')) return true;
      const need = Array.isArray(perm) ? perm : [perm];
      if (!need.length) return true;
      return need.some((p) => perms.includes(p));
    };
  }, [user]);
}

/**
 * 批量权限 hook：一次拿到多个权限的布尔值，适合表格操作列。
 *
 *   const { canWrite, canDelete } = usePermissions({ canWrite: 'x:write', canDelete: 'x:delete' });
 */
export function usePermissions<K extends string>(
  map: Record<K, string | string[]>
): Record<K, boolean> {
  const user = useAppStore((s) => s.user);
  return useMemo(() => {
    const check = (perm: string | string[]): boolean => {
      if (!user) return false;
      if (user.role === 'admin' || user.role === 'super') return true;
      const perms = user.permissions || [];
      if (perms.includes('*')) return true;
      const need = Array.isArray(perm) ? perm : [perm];
      if (!need.length) return true;
      return need.some((p) => perms.includes(p));
    };
    const out = {} as Record<K, boolean>;
    (Object.keys(map) as K[]).forEach((k) => { out[k] = check(map[k]); });
    return out;
  }, [user, map]);
}
