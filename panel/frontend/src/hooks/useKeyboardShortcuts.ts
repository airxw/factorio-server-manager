// ============================================================================
// useKeyboardShortcuts — 全局键盘快捷键（8.6）
// - `?` 打开快捷键帮助模态（不与表单输入冲突）
// - `g` 然后 `s`/`d`/`p`/`n` 跳转实例/控制台/个人设置/站内消息
// - `/` 派发 `focus-search` 自定义事件，列表页监听后聚焦搜索框
// - Ctrl+K/Cmd+K 与 Esc 关闭模态由 CommandPalette / ShortcutsHelp 自行处理
// 表单字段（input/textarea/select/contenteditable）内不触发任何快捷键
// ============================================================================

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export interface KeyboardShortcutsOptions {
  /** 打开快捷键帮助模态 */
  onOpenShortcutsHelp: () => void;
}

// `g` 前缀等待第二个按键的窗口期（ms）
const G_PREFIX_TIMEOUT = 800;

// g+key → 路由
const GOTO_MAP: Record<string, string> = {
  s: '/instances',
  d: '/dashboard',
  p: '/profile',
  n: '/admin/notifications',
};

function isFormField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return target.isContentEditable;
}

export function useKeyboardShortcuts(options: KeyboardShortcutsOptions): void {
  const navigate = useNavigate();
  const { onOpenShortcutsHelp } = options;

  useEffect(() => {
    let gPressed = false;
    let gTimer: ReturnType<typeof setTimeout> | null = null;

    const clearG = () => {
      gPressed = false;
      if (gTimer) {
        clearTimeout(gTimer);
        gTimer = null;
      }
    };

    const handler = (e: KeyboardEvent) => {
      // 忽略任何带 Ctrl/Meta/Alt 的组合键（避免与浏览器/编辑器快捷键冲突）
      const hasModifier = e.ctrlKey || e.metaKey || e.altKey;

      // `?` 帮助：Shift+/ → '?'，要求 Shift 但不要求 Ctrl/Meta/Alt
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isFormField(e.target)) return;
        e.preventDefault();
        clearG();
        onOpenShortcutsHelp();
        return;
      }

      // `/` 聚焦搜索框：派发自定义事件供列表页监听
      if (e.key === '/' && !hasModifier) {
        if (isFormField(e.target)) return;
        e.preventDefault();
        clearG();
        window.dispatchEvent(new CustomEvent('focus-search'));
        return;
      }

      // `g` 前缀：进入待消费状态，等待下一个按键
      if (e.key === 'g' && !hasModifier) {
        if (isFormField(e.target)) return;
        e.preventDefault();
        clearG();
        gPressed = true;
        gTimer = setTimeout(() => {
          gPressed = false;
          gTimer = null;
        }, G_PREFIX_TIMEOUT);
        return;
      }

      // 在 g 前缀待消费期内，识别下一个按键
      if (gPressed && !hasModifier) {
        const target = GOTO_MAP[e.key];
        if (target) {
          if (isFormField(e.target)) {
            clearG();
            return;
          }
          e.preventDefault();
          clearG();
          navigate(target);
        } else {
          // 非法组合键：退出 g 前缀状态，让事件正常传播
          clearG();
        }
      }
    };

    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      if (gTimer) clearTimeout(gTimer);
    };
  }, [navigate, onOpenShortcutsHelp]);
}
