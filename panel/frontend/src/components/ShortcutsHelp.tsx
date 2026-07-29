// ============================================================================
// ShortcutsHelp — 快捷键帮助模态（8.6）
// 由 `?` 全局快捷键触发；Esc / 点击遮罩 / 关闭按钮关闭
// 使用现有 Modal 组件壳，内部渲染分组快捷键列表
// ============================================================================

import { Modal } from './ui';

interface ShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string;
  description: string;
}

interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: '通用',
    items: [
      { keys: 'Ctrl K / ⌘ K', description: '打开命令面板' },
      { keys: '?', description: '打开快捷键帮助' },
      { keys: 'Esc', description: '关闭当前弹窗' },
      { keys: '/', description: '聚焦列表页搜索框' },
    ],
  },
  {
    title: '页面跳转（g 前缀）',
    items: [
      { keys: 'g d', description: '跳转到控制台' },
      { keys: 'g s', description: '跳转到实例列表' },
      { keys: 'g p', description: '跳转到个人设置' },
      { keys: 'g n', description: '跳转到站内消息' },
    ],
  },
  {
    title: '命令面板内',
    items: [
      { keys: '↑ ↓', description: '上下选择命令' },
      { keys: 'Enter', description: '执行选中命令' },
      { keys: 'Esc', description: '关闭命令面板' },
    ],
  },
];

export default function ShortcutsHelp({ open, onClose }: ShortcutsHelpProps) {
  return (
    <Modal open={open} onClose={onClose} title="键盘快捷键">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title}>
            <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>
              {group.title}
            </h4>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {group.items.map((item) => (
                <li
                  key={item.keys}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
                >
                  <span style={{ color: 'var(--color-text-muted, #6b7280)' }}>
                    {item.description}
                  </span>
                  <kbd
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 12,
                      background: '#f1f3f6',
                      border: '1px solid var(--color-border, #e2e5ea)',
                      borderRadius: 4,
                      padding: '2px 6px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.keys}
                  </kbd>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="form-actions" style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          知道了
        </button>
      </div>
    </Modal>
  );
}
