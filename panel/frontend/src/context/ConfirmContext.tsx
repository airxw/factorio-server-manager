// ============================================================================
// ConfirmContext — 全局确认对话框系统（context + provider + useConfirm hook）
// 提供 confirm(options) => Promise<boolean>，支持 await 式二次确认：
//   - 普通确认 / 危险操作（红色按钮）/ 输入文本确认模式
//   - ESC 取消、Enter 确认、点击遮罩关闭（可配置）
// 用法：
//   1. 在 App 顶层包裹 <ConfirmProvider>
//   2. const confirm = useConfirm();
//      const ok = await confirm({ title: '删除', message: '确定？', danger: true });
//      if (!ok) return;
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import ConfirmDialog from '../components/ConfirmDialog';

export interface ConfirmOptions {
  /** 对话框标题 */
  title: string;
  /** 提示文本 */
  message?: string;
  /** 确认按钮文字，默认「确认」 */
  confirmText?: string;
  /** 取消按钮文字，默认「取消」 */
  cancelText?: string;
  /** 危险操作：确认按钮红色 */
  danger?: boolean;
  /** 输入确认模式：要求用户输入文本 */
  requireText?: boolean;
  /** 输入确认模式下需匹配的文本 */
  requireTextMatch?: string;
  /** 点击遮罩关闭，默认 true */
  closeOnOverlayClick?: boolean;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

interface PendingConfirm {
  options: ConfirmOptions;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // 使用 ref 持有 Promise resolve，避免将函数塞入 state
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setPending({ options });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true);
    resolveRef.current = null;
    setPending(null);
  }, []);

  const handleCancel = useCallback(() => {
    resolveRef.current?.(false);
    resolveRef.current = null;
    setPending(null);
  }, []);

  const options = pending?.options;

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <ConfirmDialog
        open={pending !== null}
        title={options?.title ?? ''}
        message={options?.message}
        confirmText={options?.confirmText}
        cancelText={options?.cancelText}
        danger={options?.danger}
        requireText={options?.requireText}
        requireTextMatch={options?.requireTextMatch}
        closeOnOverlayClick={options?.closeOnOverlayClick}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm 必须在 ConfirmProvider 内部使用');
  }
  return ctx;
}
