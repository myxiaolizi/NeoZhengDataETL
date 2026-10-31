/** 全局状态：用户、站点信息、主题、权限 */
import { create } from 'zustand';
import { useEffect, useMemo } from 'react';
import type { User } from '@/types';
import { api } from '@/api/client';
import { getPublicSettings, type PublicSiteSettings } from '@/api/settings';
import { PALETTE } from '@/theme';

/* ══════════ 站点信息默认值 ══════════ */

/** 站点名称兜底：系统设置里没填 / 接口不可达时使用 */
export const DEFAULT_SITE_NAME = 'Neo Zheng DataETL';
/** 站点副标题兜底（不带版本号，版本号统一由 APP_VERSION 提供） */
export const DEFAULT_SITE_SUBTITLE = '企业数据集成平台';
/** 侧栏 Logo 方块文字兜底 */
export const DEFAULT_SITE_LOGO_TEXT = 'N';
/** 站点描述兜底（空串 = 不展示） */
export const DEFAULT_SITE_DESCRIPTION = '';
/** 页脚文案兜底（空串 = 不展示） */
export const DEFAULT_SITE_FOOTER = '';
/** 品牌区版本号（唯一出处，不要在组件里写死版本串） */
export const APP_VERSION = 'V8.0';

/* ══════════ 站点信息：结构 / 缓存 ══════════ */

/** 站点信息快照：侧栏品牌区、登录页、浏览器标题共用同一份 */
export interface SiteInfo {
  /** 站点名称（设置项 site_name） */
  siteName: string;
  /** 站点简称（设置项 site_short） */
  siteShort: string;
  /** 站点副标题（设置项 site_subtitle） */
  siteSubtitle: string;
  /** 站点描述（设置项 site_description） */
  siteDescription: string;
  /** 页脚文案（设置项 site_footer） */
  siteFooter: string;
  /** Logo 方块文字（设置项 site_logo_text） */
  siteLogoText: string;
}

/**
 * 站点信息 localStorage 缓存。
 *
 * 目的只有一个：**首屏防闪烁** —— 刷新页面时先用上次的名称渲染，
 * 不必先闪一下兜底名再跳成真实名。
 * 缓存寿命刻意压到 60s 以内（后端该接口虽然带 Cache-Control: public, max-age=60，
 * 但 getPublicSettings() 已强制 no-store），超过 60s 一律视为「不可信」直接丢弃，
 * 以接口返回值为准，避免「设置里改了名、前端却拿旧缓存显示」。
 */
const SITE_CACHE_KEY = 'v61.site';
const SITE_CACHE_TTL = 60_000;

interface SiteCachePayload {
  /** 写入时间戳（ms） */
  ts: number;
  site: SiteInfo;
}

function readSiteCache(): SiteInfo | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(SITE_CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as SiteCachePayload | null;
    if (!obj || typeof obj.ts !== 'number' || !obj.site) return null;
    if (Date.now() - obj.ts > SITE_CACHE_TTL) return null; // 过期：宁可闪一下也不显示旧站名
    const s = obj.site;
    return {
      siteName: String(s.siteName || '').trim() || DEFAULT_SITE_NAME,
      siteShort: String(s.siteShort || '').trim(),
      siteSubtitle: String(s.siteSubtitle || '').trim(),
      siteDescription: String(s.siteDescription || '').trim(),
      siteFooter: String(s.siteFooter || '').trim(),
      siteLogoText: String(s.siteLogoText || '').trim() || DEFAULT_SITE_LOGO_TEXT,
    };
  } catch {
    return null;
  }
}

function writeSiteCache(site: SiteInfo): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SITE_CACHE_KEY, JSON.stringify({ ts: Date.now(), site }));
  } catch {
    /* 隐私模式 / 配额满：缓存失败不影响功能 */
  }
}

/** 公开接口返回值 → 站点信息（逐字段 trim，空值回退默认） */
export function normalizeSiteSettings(s: PublicSiteSettings | null | undefined): SiteInfo {
  const str = (v: unknown) => String(v ?? '').trim();
  return {
    siteName: str(s?.site_name) || DEFAULT_SITE_NAME,
    siteShort: str(s?.site_short),
    siteSubtitle: str(s?.site_subtitle),
    siteDescription: str(s?.site_description),
    siteFooter: str(s?.site_footer),
    siteLogoText: str(s?.site_logo_text) || DEFAULT_SITE_LOGO_TEXT,
  };
}

/** 后端开关值（'1'/'0' 字符串）→ 布尔；缺省时返回 null 表示「未知」 */
export function parseOnOff(value: unknown): boolean | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}


/** 浏览器标签页标题 = 站点名称（index.html 里的 title 只是占位） */
export function applySiteTitle(name: string): void {
  if (typeof document === 'undefined') return;
  const title = String(name || '').trim() || DEFAULT_SITE_NAME;
  if (document.title !== title) document.title = title;
}

const cachedSite = readSiteCache();

interface AppState extends SiteInfo {
  user: User | null;
  loading: boolean;
  /**
   * 站点信息刻意与 user 分开存放：站点级配置与登录者无关，
   * 退出登录后也不应被清掉，改名后无需重新登录即可生效。
   */
  themeColor: string;
  /** 是否开放自助注册（公开接口的 allow_registration）；null = 未知 / 接口不可用 */
  allowRegistration: boolean | null;
  collapsed: boolean;
  mobile: boolean;
  fetchUser: () => Promise<User | null>;
  /** 拉取站点公开信息（不需要登录）并同步 document.title */
  fetchSite: () => Promise<void>;
  /**
   * 站点信息刷新别名。
   *
   * 「系统设置」保存成功后必须调用本方法（或 fetchSite），否则侧栏品牌区、
   * 登录页、浏览器标题都还停在旧值 —— 这就是用户反馈的「设置后不生效」。
   * 调用方式（pages/settings.tsx）：
   *
   *   const refreshSite = useAppStore((s) => s.refreshSite);
   *   ...
   *   await saveSettings(values);
   *   await refreshSite();   // 重新读 /api/settings/public，侧栏 / 标题 / 登录页立即同步
   */
  refreshSite: () => Promise<void>;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
  setThemeColor: (c: string) => void;
  setCollapsed: (v: boolean) => void;
  setMobile: (v: boolean) => void;
  can: (perm: string | string[]) => boolean;
}

/** 同一次页面生命周期内的并发去重：多个组件同时 fetchSite 只发一个请求 */
let siteInflight: Promise<void> | null = null;

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  loading: true,
  siteName: cachedSite?.siteName || DEFAULT_SITE_NAME,
  siteShort: cachedSite?.siteShort || '',
  siteSubtitle: cachedSite?.siteSubtitle || '',
  siteDescription: cachedSite?.siteDescription || '',
  siteFooter: cachedSite?.siteFooter || '',
  siteLogoText: cachedSite?.siteLogoText || DEFAULT_SITE_LOGO_TEXT,
  themeColor: PALETTE.primary,
  allowRegistration: null,
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

  /**
   * 拉取站点公开信息（不需要登录）。
   *
   * 调用点：BasicLayout 挂载（登录后的后台）、各公开页（登录/注册/找回/重置），
   * 「系统设置」保存成功后的 refreshSite()。
   * 成功后同时写 localStorage 缓存（60s）与 document.title，接口失败则保留兜底值。
   */
  fetchSite: async () => {
    if (siteInflight) return siteInflight;
    siteInflight = (async () => {
      try {
        const s = await getPublicSettings();
        if (!s) return;
        const next = normalizeSiteSettings(s);
        // 顺带更新「是否开放自助注册」：注册页直接读 store，不必再单独请求一次
        set({ ...next, allowRegistration: parseOnOff(s.allow_registration) });
        writeSiteCache(next);
        applySiteTitle(next.siteName);
      } catch {
        /* 公开接口不可用（离线 / 502）时保持兜底值，不影响布局渲染 */
      } finally {
        siteInflight = null;
      }
    })();
    return siteInflight;
  },

  /** 站点信息刷新别名（语义更明确，供「系统设置」保存后调用） */
  refreshSite: async () => get().fetchSite(),

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
 * 公开页（登录 / 注册 / 找回密码 / 重置密码）品牌区数据源。
 *
 * 这些页面不在 BasicLayout 里，没人给它们拉站点信息，所以在这里统一：
 *  1. 挂载时 fetchSite()（公开接口，不要求登录）；
 *  2. document.title 跟随站点名称 —— 满足「浏览器标签页标题 = 站点名称」。
 *
 * 返回的 brandName / brandSubtitle / brandLogoText 均已兜底，可直接渲染；
 * 站点副标题为空时回退到默认副标题（不带版本号，避免把版本写进页面文案）。
 */
export function useSiteBrand() {
  const siteName = useAppStore((s) => s.siteName);
  const siteSubtitle = useAppStore((s) => s.siteSubtitle);
  const siteLogoText = useAppStore((s) => s.siteLogoText);
  const siteDescription = useAppStore((s) => s.siteDescription);
  const siteFooter = useAppStore((s) => s.siteFooter);
  const fetchSite = useAppStore((s) => s.fetchSite);

  useEffect(() => {
    fetchSite();
  }, [fetchSite]);

  useEffect(() => {
    applySiteTitle(siteName);
  }, [siteName]);

  return useMemo(
    () => ({
      brandName: (siteName || '').trim() || DEFAULT_SITE_NAME,
      brandSubtitle: (siteSubtitle || '').trim() || DEFAULT_SITE_SUBTITLE,
      brandLogoText: ((siteLogoText || '').trim().slice(0, 1)) || DEFAULT_SITE_LOGO_TEXT,
      siteDescription: (siteDescription || '').trim(),
      siteFooter: (siteFooter || '').trim(),
    }),
    [siteName, siteSubtitle, siteLogoText, siteDescription, siteFooter]
  );
}

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
