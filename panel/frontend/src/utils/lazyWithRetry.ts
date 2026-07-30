// ============================================================================
// lazyWithRetry — 带 chunk 加载失败自动刷新的 lazy import
//
// 解决部署后旧缓存导致 dynamic import 失败的问题：
// 浏览器缓存了旧 index.html，引用的 chunk hash 已不存在（404），
// React lazy 抛出 "Failed to fetch dynamically imported module"。
//
// 策略：首次失败时自动 reload（加载新 HTML 获取正确 chunk hash），
// 通过 sessionStorage 标记防止无限刷新。已刷新过一次仍失败则抛出原错误。
// ============================================================================

import { lazy, type ComponentType } from 'react';

const RELOAD_KEY = 'gsp:chunk-reloaded';

/**
 * 检测是否为 chunk 加载失败（Vite 动态 import 404）。
 */
function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    // Safari/older browsers 变体
    msg.includes('error loading dynamically imported module')
  );
}

/**
 * 包装 React.lazy，在 chunk 加载失败时自动刷新页面一次。
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await factory();
    } catch (error) {
      if (!isChunkLoadError(error)) throw error;

      // 检查是否已经因 chunk 失败刷新过一次
      const alreadyReloaded = sessionStorage.getItem(RELOAD_KEY);
      if (alreadyReloaded) {
        // 已刷新过仍失败 → 清除标记，抛出原错误让 ErrorBoundary 处理
        sessionStorage.removeItem(RELOAD_KEY);
        throw error;
      }

      // 标记并刷新——新 HTML 会引用正确的 chunk hash
      sessionStorage.setItem(RELOAD_KEY, '1');
      window.location.reload();
      // reload 后页面会重新加载，这行不会真正执行
      return { default: null as unknown as T };
    }
  });
}

/**
 * 清除 chunk 刷新标记（成功加载后调用，允许下次部署再次触发刷新）。
 * 在 App 根组件 mount 时调用。
 */
export function clearChunkReloadFlag(): void {
  sessionStorage.removeItem(RELOAD_KEY);
}
