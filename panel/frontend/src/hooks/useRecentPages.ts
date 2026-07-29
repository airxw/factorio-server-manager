// ============================================================================
// useRecentPages — 记录用户最近访问的 10 个页面（8.4）
// 路径变化时写入 localStorage，跨会话保留；CommandPalette 读取此列表展示「最近访问」
// 排除登录/注册/根/404 等非业务路径；动态段路径（如 /instances/:id）原样保留
// ============================================================================

import { useEffect, useState } from 'react';

const RECENT_PAGES_KEY = 'recentPages';
const MAX_RECENT = 10;

// 不计入「最近访问」的路径前缀/精确匹配
const EXCLUDED_PATHS = new Set<string>([
  '/',
  '/login',
  '/register',
  '/home',
  '/forbidden',
]);
const EXCLUDED_PREFIXES = ['/login?', '/register?', '/home?'];

export interface RecentPage {
  path: string;
  visitedAt: number;
}

function isExcluded(path: string): boolean {
  if (!path) return true;
  if (EXCLUDED_PATHS.has(path)) return true;
  for (const prefix of EXCLUDED_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

function loadRecentPages(): RecentPage[] {
  try {
    const raw = localStorage.getItem(RECENT_PAGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is RecentPage => {
        if (!item || typeof item !== 'object') return false;
        const rec = item as Record<string, unknown>;
        return typeof rec.path === 'string' && typeof rec.visitedAt === 'number';
      })
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function saveRecentPages(pages: RecentPage[]): void {
  try {
    localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(pages));
  } catch {
    // ignore
  }
}

/**
 * 记录当前路径到「最近访问」并返回当前列表。
 * 调用方：Layout 中 `useRecentPages(location.pathname)`
 * 同路径重复访问会更新 visitedAt 并置顶
 */
export function useRecentPages(currentPath: string): RecentPage[] {
  const [recentPages, setRecentPages] = useState<RecentPage[]>(() => loadRecentPages());

  useEffect(() => {
    if (isExcluded(currentPath)) return;
    setRecentPages((prev) => {
      const filtered = prev.filter((p) => p.path !== currentPath);
      const next = [{ path: currentPath, visitedAt: Date.now() }, ...filtered].slice(
        0,
        MAX_RECENT,
      );
      saveRecentPages(next);
      return next;
    });
  }, [currentPath]);

  // 跨标签同步：监听 storage 事件
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === RECENT_PAGES_KEY && e.newValue !== null) {
        setRecentPages(loadRecentPages());
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return recentPages;
}

/** 供 CommandPalette 直接读取最新列表（无需订阅路径变化） */
export function readRecentPages(): RecentPage[] {
  return loadRecentPages();
}
