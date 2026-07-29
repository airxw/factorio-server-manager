// ============================================================================
// HelpModal — 帮助中心模态（v4.1 改造）
// 提供使用文档 / 常见问题 / 快捷键 / 反馈建议 四个入口
// v4.1: 不再使用假外链，改为跳转到内置 /help 页面对应锚点
// 快捷键入口复用 ShortcutsHelp，由父组件通过 onOpenShortcuts 回调触发
// ============================================================================

import { ArrowRight, BookOpen, ExternalLink, Keyboard, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Modal } from './ui';

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
  /** 打开快捷键帮助（复用已有 ShortcutsHelp 组件） */
  onOpenShortcuts: () => void;
}

interface HelpItem {
  icon: typeof BookOpen;
  title: string;
  description: string;
  /** 点击行为：跳转到 /help 页面的锚点，或回调标识 */
  hash?: string;
  onClick?: () => void;
}

export default function HelpModal({ open, onClose, onOpenShortcuts }: HelpModalProps) {
  const navigate = useNavigate();

  const items: HelpItem[] = [
    {
      icon: BookOpen,
      title: '使用文档',
      description: '查看完整功能说明与上手指南',
      hash: 'quick-start',
    },
    {
      icon: MessageSquare,
      title: '常见问题',
      description: '常见问题解答与排障指引',
      hash: 'faq',
    },
    {
      icon: Keyboard,
      title: '快捷键',
      description: '查看所有键盘快捷键',
      onClick: onOpenShortcuts,
    },
    {
      icon: ExternalLink,
      title: '反馈建议',
      description: '提交问题或功能建议',
      hash: 'feedback',
    },
  ];

  const handleClick = (item: HelpItem) => {
    if (item.onClick) {
      onClose();
      item.onClick();
    } else if (item.hash) {
      onClose();
      navigate(`/help#${item.hash}`);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="帮助中心">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.title}
              type="button"
              className="help-item"
              onClick={() => handleClick(item)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 14px',
                background: 'var(--color-surface, #fff)',
                border: '1px solid var(--color-border, #e2e5ea)',
                borderRadius: 'var(--radius, 8px)',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
                transition: 'background 0.15s, border-color 0.15s',
              }}
            >
              <Icon size={20} style={{ color: 'var(--color-primary, #2563eb)', flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>
                  {item.title}
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: 12,
                    color: 'var(--color-text-muted, #6b7280)',
                    marginTop: 2,
                  }}
                >
                  {item.description}
                </span>
              </span>
              <ArrowRight
                size={14}
                style={{ color: 'var(--color-text-muted, #6b7280)', flexShrink: 0 }}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
      <div className="form-actions" style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            onClose();
            navigate('/help');
          }}
        >
          查看完整文档
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          关闭
        </button>
      </div>
    </Modal>
  );
}
