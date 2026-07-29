// ============================================================================
// CommandPalette — 全局命令面板（8.2 / 8.4 / 8.5）
// - Ctrl+K / Cmd+K 全局呼出（自身管理 open 状态）
// - 模糊搜索页面与命令（创建实例、查看消息、admin 子页等）
// - ↑↓ 选择、Enter 执行、Esc 关闭
// - 「最近访问」与「最近使用命令」置顶（无 query 时）
// - 角色过滤：admin 命令仅 server_admin 可见；VIP 管理 instance_admin+ 可见
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Clock, Search } from 'lucide-react';
import { useAuth } from '../api/auth';
import { readRecentPages, type RecentPage } from '../hooks/useRecentPages';
import { getEffectiveRole, isAdminRole, isInstanceAdminOrAbove } from '../utils/role';

const RECENT_COMMANDS_KEY = 'recentCommands';
const MAX_RECENT_COMMANDS = 5;

// 命令定义
interface Command {
  id: string;
  label: string;
  hint?: string;
  keywords?: string[];
  requiresServerAdmin?: boolean;
  requiresInstanceAdmin?: boolean;
  run: () => void;
}

// 路径 → 中文标签（用于「最近访问」展示）
const PATH_LABEL_MAP: Record<string, string> = {
  '/dashboard': '控制台',
  '/instances': '实例',
  '/instances/new': '创建实例',
  '/shop': '商城',
  '/profile': '个人设置',
  '/admin/notifications': '站内消息',
  '/admin/users': '用户管理',
  '/admin/system-config': '底座配置',
  '/admin/system-health': '系统健康',
  '/admin/diagnostics': '系统诊断',
  '/admin/packs': 'Pack 管理',
  '/admin/audit-logs': '审计日志',
  '/admin/webhooks': 'Webhooks',
  '/admin/player-bindings': '玩家绑定',
  '/store/instance-vip': 'VIP管理',
  // I1-I4: 优化升级方案第四项管理页面
  '/admin/ssl': 'SSL 证书',
  '/admin/tunnel': '隧道管理',
  '/admin/api-keys': 'API Keys',
  '/admin/nodes': '部署节点',
};

function pathToLabel(path: string): string {
  if (PATH_LABEL_MAP[path]) return PATH_LABEL_MAP[path];
  // 实例详情 /instances/:id
  if (path.startsWith('/instances/') && path !== '/instances/new') {
    return '实例详情';
  }
  return path;
}

function loadRecentCommands(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_COMMANDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === 'string')
      .slice(0, MAX_RECENT_COMMANDS);
  } catch {
    return [];
  }
}

function saveRecentCommand(id: string): void {
  try {
    const prev = loadRecentCommands().filter((x) => x !== id);
    const next = [id, ...prev].slice(0, MAX_RECENT_COMMANDS);
    localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

/** 模糊匹配：query 的每个字符按顺序出现在 text 中 */
function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

// 列表项联合类型（最近访问页面 / 命令）
type PaletteItem =
  | { kind: 'page'; path: string; label: string; hint: string }
  | { kind: 'command'; command: Command; label: string; hint: string };

export default function CommandPalette() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [recentCommands, setRecentCommands] = useState<string[]>(() => loadRecentCommands());
  const [recentPages, setRecentPages] = useState<RecentPage[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 角色判断（以 active_role 会话身份为准；防御性支持 system_admin/admin 别名）
  const effectiveRole = getEffectiveRole(user);
  const isServerAdmin = isAdminRole(effectiveRole);
  const isInstanceAdminOrHigher = isInstanceAdminOrAbove(effectiveRole);

  // 全局 Ctrl+K / Cmd+K 监听
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // 打开时：重置状态 + 聚焦输入框 + 读取最新最近访问/最近命令
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIdx(0);
    setRecentCommands(loadRecentCommands());
    // 排除当前路径，避免「最近访问」首项就是当前页
    const current = window.location.pathname;
    setRecentPages(readRecentPages().filter((p) => p.path !== current));
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // 命令列表（依赖角色过滤）
  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = [
      {
        id: 'nav-dashboard',
        label: '控制台',
        hint: '/dashboard',
        keywords: ['dashboard', '首页', 'home'],
        run: () => navigate('/dashboard'),
      },
      {
        id: 'nav-instances',
        label: '实例',
        hint: '/instances',
        keywords: ['instances', '服务器', 'server', '列表'],
        run: () => navigate('/instances'),
      },
      {
        id: 'action-create-instance',
        label: '创建实例',
        hint: '/instances/new',
        keywords: ['create', '新建', 'new', '创建', '建服'],
        run: () => navigate('/instances/new'),
      },
      {
        id: 'nav-shop',
        label: '商城',
        hint: '/shop',
        keywords: ['shop', '商城', 'vip', '点券'],
        run: () => navigate('/shop'),
      },
      {
        id: 'nav-profile',
        label: '个人设置',
        hint: '/profile',
        keywords: ['profile', '个人', '设置', '资料'],
        run: () => navigate('/profile'),
      },
      {
        id: 'nav-notifications',
        label: '站内消息',
        hint: '/admin/notifications',
        keywords: ['notifications', '消息', '通知', 'notification'],
        run: () => navigate('/admin/notifications'),
      },
    ];
    const instanceVip: Command[] = isInstanceAdminOrHigher
      ? [
          {
            id: 'admin-instance-vip',
            label: 'VIP管理',
            hint: '/store/instance-vip',
            keywords: ['vip', 'instance-vip', '会员'],
            run: () => navigate('/store/instance-vip'),
          },
        ]
      : [];
    const admin: Command[] = isServerAdmin
      ? [
          {
            id: 'admin-users',
            label: '用户管理',
            hint: '/admin/users',
            keywords: ['users', '用户', '权限', 'role'],
            run: () => navigate('/admin/users'),
          },
          {
            id: 'admin-system-config',
            label: '底座配置',
            hint: '/admin/system-config',
            keywords: ['system', 'config', '配置', '底座'],
            run: () => navigate('/admin/system-config'),
          },
          {
            id: 'admin-system-health',
            label: '系统健康',
            hint: '/admin/system-health',
            keywords: ['system', 'health', '健康', '监控', 'metrics', 'cpu', '内存'],
            run: () => navigate('/admin/system-health'),
          },
          {
            id: 'admin-diagnostics',
            label: '系统诊断',
            hint: '/admin/diagnostics',
            keywords: ['diagnostics', '诊断', '修复', 'fix', '检查'],
            run: () => navigate('/admin/diagnostics'),
          },
          {
            id: 'admin-packs',
            label: 'Pack 管理',
            hint: '/admin/packs',
            keywords: ['packs', 'pack', '整合包'],
            run: () => navigate('/admin/packs'),
          },
          {
            id: 'admin-audit-logs',
            label: '审计日志',
            hint: '/admin/audit-logs',
            keywords: ['audit', 'logs', '日志', '审计'],
            run: () => navigate('/admin/audit-logs'),
          },
          {
            id: 'admin-webhooks',
            label: 'Webhooks',
            hint: '/admin/webhooks',
            keywords: ['webhooks', '钩子', '回调'],
            run: () => navigate('/admin/webhooks'),
          },
          {
            id: 'admin-player-bindings',
            label: '玩家绑定',
            hint: '/admin/player-bindings',
            keywords: ['player', 'binding', '绑定', '玩家'],
            run: () => navigate('/admin/player-bindings'),
          },
          // I1-I4: 优化升级方案第四项管理页面
          {
            id: 'admin-ssl',
            label: 'SSL 证书',
            hint: '/admin/ssl',
            keywords: ['ssl', 'certificate', '证书', 'tls', 'nginx'],
            run: () => navigate('/admin/ssl'),
          },
          {
            id: 'admin-tunnel',
            label: '隧道管理',
            hint: '/admin/tunnel',
            keywords: ['tunnel', 'frp', '隧道', '内网穿透'],
            run: () => navigate('/admin/tunnel'),
          },
          {
            id: 'admin-api-keys',
            label: 'API Keys',
            hint: '/admin/api-keys',
            keywords: ['api', 'key', 'token', '密钥'],
            run: () => navigate('/admin/api-keys'),
          },
          {
            id: 'admin-nodes',
            label: '部署节点',
            hint: '/admin/nodes',
            keywords: ['nodes', 'node', '节点', 'java', 'jdk'],
            run: () => navigate('/admin/nodes'),
          },
        ]
      : [];
    return [...nav, ...instanceVip, ...admin];
  }, [navigate, isServerAdmin, isInstanceAdminOrHigher]);

  const commandMap = useMemo(() => {
    const m = new Map<string, Command>();
    for (const c of commands) m.set(c.id, c);
    return m;
  }, [commands]);

  // 按查询过滤后的命令
  const filteredCommands = useMemo<Command[]>(() => {
    if (!query.trim()) return commands;
    return commands.filter((c) => {
      const haystack = [c.label, c.hint ?? '', ...(c.keywords ?? [])].join(' ');
      return fuzzyMatch(query, haystack);
    });
  }, [commands, query]);

  // 最近使用的命令（按 ID 解析回 Command 对象；query 非空时不展示）
  const recentCommandList = useMemo<Command[]>(() => {
    if (query.trim()) return [];
    return recentCommands
      .map((id) => commandMap.get(id))
      .filter((c): c is Command => c !== undefined);
  }, [recentCommands, commandMap, query]);

  // 扁平化展示项（用于键盘上下选择与索引定位）
  const allItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];
    if (!query.trim()) {
      for (const p of recentPages) {
        items.push({
          kind: 'page',
          path: p.path,
          label: pathToLabel(p.path),
          hint: p.path,
        });
      }
      for (const c of recentCommandList) {
        if (!items.some((i) => i.kind === 'command' && i.command.id === c.id)) {
          items.push({ kind: 'command', command: c, label: c.label, hint: c.hint ?? '' });
        }
      }
    }
    for (const c of filteredCommands) {
      if (!items.some((i) => i.kind === 'command' && i.command.id === c.id)) {
        items.push({ kind: 'command', command: c, label: c.label, hint: c.hint ?? '' });
      }
    }
    return items;
  }, [recentPages, recentCommandList, filteredCommands, query]);

  // 选中索引越界保护
  useEffect(() => {
    if (selectedIdx >= allItems.length) setSelectedIdx(0);
  }, [allItems.length, selectedIdx]);

  // 选中项滚动到可视区
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-idx="${selectedIdx}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx, open]);

  const executeItem = useCallback(
    (item: PaletteItem) => {
      if (item.kind === 'page') {
        setOpen(false);
        navigate(item.path);
      } else {
        saveRecentCommand(item.command.id);
        setOpen(false);
        item.command.run();
      }
    },
    [navigate],
  );

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => (i + 1) % Math.max(allItems.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => (i - 1 + allItems.length) % Math.max(allItems.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = allItems[selectedIdx];
      if (item) executeItem(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        style={{ maxWidth: 560, padding: 0 }}
      >
        {/* 搜索输入区 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 16px',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <Search size={16} color="#6b7280" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIdx(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="搜索页面或命令…"
            aria-label="搜索命令"
            aria-controls="command-palette-list"
            aria-activedescendant={
              allItems[selectedIdx] ? `cmd-item-${selectedIdx}` : undefined
            }
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 14,
              padding: 0,
              color: 'inherit',
            }}
          />
          <kbd
            style={{
              fontFamily: 'monospace',
              fontSize: 11,
              color: '#6b7280',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              padding: '1px 5px',
            }}
          >
            ESC
          </kbd>
        </div>

        {/* 结果列表 */}
        <div
          ref={listRef}
          id="command-palette-list"
          role="listbox"
          style={{ maxHeight: 360, overflowY: 'auto', padding: '4px 0' }}
        >
          {allItems.length === 0 ? (
            <div
              style={{
                padding: '24px 16px',
                textAlign: 'center',
                color: '#6b7280',
                fontSize: 13,
              }}
            >
              没有匹配的命令
            </div>
          ) : (
            allItems.map((item, idx) => {
              const isSelected = idx === selectedIdx;
              const isPage = item.kind === 'page';
              const showRecentHeader = idx === 0 && isPage;
              const showCommandsHeader =
                !query.trim() &&
                idx > 0 &&
                item.kind === 'command' &&
                !allItems[idx - 1]!.kind.startsWith('command');
              return (
                <div key={`${item.kind}-${idx}`}>
                  {showRecentHeader && (
                    <SectionLabel>最近访问</SectionLabel>
                  )}
                  {showCommandsHeader && <SectionLabel>命令</SectionLabel>}
                  <button
                    id={`cmd-item-${idx}`}
                    data-idx={idx}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => executeItem(item)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      padding: '8px 16px',
                      background: isSelected
                        ? 'var(--color-primary, #2563eb)'
                        : 'transparent',
                      color: isSelected ? '#fff' : 'var(--color-text, #1f2933)',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: 14,
                    }}
                  >
                    {isPage ? (
                      <Clock size={14} aria-hidden="true" />
                    ) : (
                      <ChevronRight size={14} aria-hidden="true" />
                    )}
                    <span style={{ flex: 1 }}>{item.label}</span>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>{item.hint}</span>
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* 底部说明栏 */}
        <div
          style={{
            padding: '6px 16px',
            borderTop: '1px solid var(--color-border)',
            fontSize: 12,
            color: '#6b7280',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>↑↓ 选择 · Enter 执行</span>
          <span>Ctrl+K 切换</span>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '6px 16px 2px',
        fontSize: 11,
        fontWeight: 600,
        color: '#9ca3af',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {children}
    </div>
  );
}
