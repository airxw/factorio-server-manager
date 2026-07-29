// ============================================================================
// useDocumentTitle — 统一管理浏览器标签页标题
// 3.18: 每个页面通过此 hook 设置标题，离开时恢复默认
// 用法：useDocumentTitle('实例详情 - xxx');
// ============================================================================

import { useEffect } from 'react';

const DEFAULT_TITLE = 'GameServer Panel';

export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    const fullTitle = title ? `${title} - ${DEFAULT_TITLE}` : DEFAULT_TITLE;
    document.title = fullTitle;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
