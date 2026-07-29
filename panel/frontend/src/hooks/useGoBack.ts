// ============================================================================
// useGoBack — 统一返回按钮策略（3.10）
// 子页使用 navigate(-1) 但携带兜底：若历史栈为空（如直接通过 URL 进入）则跳转 fallbackPath
// 详情页应直接硬编码上级路径，确保入口稳定，不使用此 hook
// ============================================================================

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * 返回上一页，若无历史记录则跳转到 fallbackPath
 * @param fallbackPath 兜底路径（如 '/instances'）
 */
export function useGoBack(fallbackPath: string): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    // window.history.length <= 1 表示当前标签页无历史记录（直接打开/新标签页）
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(fallbackPath, { replace: true });
    }
  }, [navigate, fallbackPath]);
}
