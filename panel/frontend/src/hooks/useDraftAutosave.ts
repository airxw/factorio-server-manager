// ============================================================================
// useDraftAutosave — 表单草稿自动保存钩子（7.5 表单草稿自动保存）
// 将表单状态以 debounce 方式自动保存到 localStorage，刷新或意外关闭后可恢复。
// 用法：
//   const { hasDraft, restoreDraft, clearDraft } = useDraftAutosave(
//     'create-server-draft',
//     { name, port, rconPort, packId, nodeId },
//     1000,
//   );
// ============================================================================

import { useEffect, useRef, useState } from 'react';

/** 默认 debounce 时长（毫秒） */
const DEFAULT_DEBOUNCE_MS = 1000;

/**
 * 表单草稿自动保存。
 *
 * @param key        localStorage 键名
 * @param value      需要保存的表单状态（任意可序列化值）
 * @param debounceMs debounce 时长，默认 1000ms
 * @param enabled    是否启用自动保存（默认 true）。
 *                   草稿恢复提示未决时可传 false 暂停，避免空表单覆盖草稿。
 */
export function useDraftAutosave<T>(
  key: string,
  value: T,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
  enabled: boolean = true,
): {
  /** localStorage 中是否已存在草稿（首挂载时检测一次） */
  hasDraft: boolean;
  /** 读取并返回草稿内容；不存在时返回 null。返回挂载时捕获的快照，免受后续自动保存覆盖影响 */
  restoreDraft: () => T | null;
  /** 清除草稿 */
  clearDraft: () => void;
} {
  // 首挂载时同步捕获草稿快照——免受后续自动保存覆盖影响
  const [initialDraft] = useState<T | null>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  });

  const [hasDraft, setHasDraft] = useState<boolean>(initialDraft !== null);

  // 用 ref 持有最新 value，避免每次 value 变化重建 debounce 定时器回调
  const valueRef = useRef(value);
  valueRef.current = value;

  // debounce 自动保存——仅在 enabled 时运行
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(valueRef.current));
        setHasDraft(true);
      } catch {
        // localStorage 不可用（隐私模式 / 配额超限）时静默失败
      }
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [key, value, debounceMs, enabled]);

  const restoreDraft = (): T | null => initialDraft;

  const clearDraft = () => {
    try {
      localStorage.removeItem(key);
    } catch {
      // 忽略移除失败
    }
    setHasDraft(false);
  };

  return { hasDraft, restoreDraft, clearDraft };
}
