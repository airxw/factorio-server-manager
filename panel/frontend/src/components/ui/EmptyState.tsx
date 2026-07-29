// ============================================================================
// EmptyState — 空状态占位组件
// 替代各页面重复的 <div className="empty-state">…</div>
// ============================================================================

import type { ReactNode } from 'react';

interface EmptyStateProps {
  /** 主文案 */
  title?: string;
  /** 辅助说明 */
  description?: ReactNode;
  /** 操作区（如「创建」按钮） */
  action?: ReactNode;
  /** 图标（可选，传入 lucide-react 图标元素） */
  icon?: ReactNode;
}

export default function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="empty-state" role="status">
      {icon && <div style={{ marginBottom: 8, opacity: 0.4 }}>{icon}</div>}
      {title && <p>{title}</p>}
      {description && <div className="form-hint">{description}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}
