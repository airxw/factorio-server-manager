// ============================================================================
// ConfirmDialog — 通用确认弹窗（ConfirmContext 内部呈现组件，亦支持直接受控使用）
// - 支持普通确认模式与「输入文本确认」模式（高破坏性操作）
// - 支持 ESC 取消、Enter 确认、点击遮罩关闭（可配置）
// - 焦点锁定在弹窗内
// - role="dialog" aria-modal="true"
// 向后兼容旧 API：description / confirmLabel / cancelLabel / confirmVariant / requireInput
// ============================================================================

import { useEffect, useRef, useState, type MouseEvent } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** 提示文本（向后兼容 description） */
  message?: string;
  /** 向后兼容：等价于 message */
  description?: string;
  /** 确认按钮文字（向后兼容 confirmLabel） */
  confirmText?: string;
  /** 向后兼容：等价于 confirmText */
  confirmLabel?: string;
  /** 取消按钮文字（向后兼容 cancelLabel） */
  cancelText?: string;
  /** 向后兼容：等价于 cancelText */
  cancelLabel?: string;
  /** 危险操作：确认按钮红色 */
  danger?: boolean;
  /** 向后兼容：'danger' | 'primary'，等价于 danger */
  confirmVariant?: 'danger' | 'primary';
  /** 输入确认模式：要求用户输入文本 */
  requireText?: boolean;
  /** 输入确认模式下需匹配的文本 */
  requireTextMatch?: string;
  /** 向后兼容：输入确认模式的匹配值（等价于 requireTextMatch） */
  requireInput?: string;
  /** 点击遮罩关闭，默认 true */
  closeOnOverlayClick?: boolean;
  /** 提交中状态（禁用按钮） */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  description,
  confirmText,
  confirmLabel,
  cancelText,
  cancelLabel,
  danger,
  confirmVariant,
  requireText,
  requireTextMatch,
  requireInput,
  closeOnOverlayClick = true,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [inputValue, setInputValue] = useState('');
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // 解析向后兼容别名
  const desc = message ?? description;
  const confirmLabelFinal = confirmText ?? confirmLabel ?? '确认';
  const cancelLabelFinal = cancelText ?? cancelLabel ?? '取消';
  const isDanger = danger ?? confirmVariant === 'danger';
  const requireTextMode = requireText === true || requireInput !== undefined;
  const matchValue = requireText === true ? (requireTextMatch ?? '') : (requireInput ?? '');
  const inputValid = !requireTextMode || inputValue === matchValue;

  // 打开时重置输入；非输入模式聚焦确认按钮
  useEffect(() => {
    if (!open) return;
    setInputValue('');
    if (requireTextMode) return; // 输入模式靠 autoFocus 聚焦输入框
    const timer = setTimeout(() => confirmBtnRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open, requireTextMode]);

  // ESC 取消 + Enter 确认 + Tab 焦点锁定
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!loading) onCancel();
        return;
      }
      if (e.key === 'Enter') {
        // 焦点在按钮上时让按钮原生 click 处理，避免双触发
        const active = document.activeElement;
        if (active instanceof HTMLButtonElement) return;
        if (!inputValid || loading) return;
        e.preventDefault();
        onConfirm();
        return;
      }
      if (e.key === 'Tab') {
        // 焦点锁定：在弹窗内循环
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, loading, onCancel, onConfirm, inputValid]);

  if (!open) return null;

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget && !loading && closeOnOverlayClick) {
      onCancel();
    }
  };

  const handleConfirm = () => {
    if (!inputValid || loading) return;
    onConfirm();
  };

  return (
    <div className="confirm-overlay" onClick={handleOverlayClick}>
      <div
        className={`confirm-dialog${isDanger ? ' danger' : ''}`}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <h3 id="confirm-dialog-title" className="confirm-title">
          {title}
        </h3>
        {desc && <p className="confirm-message">{desc}</p>}
        {requireTextMode && (
          <label className="form-field" style={{ marginBottom: 16 }}>
            <span className="form-label">
              请输入 <code>{matchValue}</code> 以确认
            </span>
            <input
              className="confirm-input"
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              autoComplete="off"
              autoFocus
            />
          </label>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabelFinal}
          </button>
          <button
            type="button"
            ref={confirmBtnRef}
            className="btn btn-confirm"
            onClick={handleConfirm}
            disabled={!inputValid || loading}
          >
            {loading ? '处理中…' : confirmLabelFinal}
          </button>
        </div>
      </div>
    </div>
  );
}
