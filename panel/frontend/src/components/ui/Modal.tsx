// ============================================================================
// Modal — 通用模态弹窗（基础壳）
// 提供 overlay + 焦点锁定 + ESC 关闭，内容由 children 自定义
// ConfirmDialog 等业务弹窗可基于本组件封装
// ============================================================================

import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  /** 标题（渲染到 card-title） */
  title?: ReactNode;
  /** 自定义底部操作区 */
  footer?: ReactNode;
  /** 关闭回调（ESC / 遮罩点击触发） */
  onClose: () => void;
  /** 是否允许点击遮罩关闭，默认 true */
  closeOnOverlay?: boolean;
  /** 是否禁用关闭（提交中场景） */
  disableClose?: boolean;
  /**
   * v4.28.0: 弹窗尺寸
   *   - md（默认）：标准宽度（520px），适用常规表单/确认
   *   - lg：加宽（720px），适用长代码/多步骤部署引导等需要更大展示空间的场景
   */
  size?: 'md' | 'lg';
  children: ReactNode;
}

export default function Modal({
  open,
  title,
  footer,
  onClose,
  closeOnOverlay = true,
  disableClose = false,
  size = 'md',
  children,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  // ESC 关闭 + 简单焦点锁定
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !disableClose) {
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const dialog = cardRef.current;
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
  }, [open, disableClose, onClose]);

  if (!open) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (closeOnOverlay && e.target === e.currentTarget && !disableClose) {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className={`modal-card modal-card-${size}`} ref={cardRef} role="dialog" aria-modal="true">
        {title && <h3 className="card-title">{title}</h3>}
        <div style={{ marginBottom: footer ? 16 : 0 }}>{children}</div>
        {footer && <div className="form-actions">{footer}</div>}
      </div>
    </div>
  );
}
