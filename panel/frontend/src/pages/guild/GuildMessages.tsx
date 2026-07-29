// ============================================================================
// GuildMessages — /guild/notifications（v4.16.1 玩家门户消息中心）
//
// 设计：Apple 浅色系（gp-* 类），移动端优先
// 功能：消息列表、按类型筛选、搜索、标记已读/全部已读、点击跳转关联实体
// API：listNotifications / markNotificationRead / markAllNotificationsRead
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  ChevronRight,
  Gift,
  Package,
  RefreshCw,
  Search,
  Shield,
  Zap,
} from 'lucide-react';
import type { NotificationSummary } from '../../stores/notificationStore';
import { useAuth } from '../../api/auth';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast, EmptyState, Skeleton } from '../../components/ui';

const TYPE_LABEL: Record<string, string> = {
  order_delivered: '订单已到账',
  order_expired: '订单已过期',
  cdk_gift: 'CDK礼包',
  vip_changed: 'VIP变更',
  system_announcement: '系统通知',
};

function typeIcon(type: string) {
  switch (type) {
    case 'order_delivered': return { Icon: Package, color: 'var(--gp-green)' };
    case 'order_expired':   return { Icon: Package, color: 'var(--gp-text-tert)' };
    case 'cdk_gift':        return { Icon: Gift, color: 'var(--gp-orange)' };
    case 'vip_changed':     return { Icon: Zap, color: 'var(--gp-purple)' };
    case 'system_announcement': return { Icon: Shield, color: 'var(--gp-blue)' };
    default:                return { Icon: Bell, color: 'var(--gp-text-tert)' };
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}天前`;
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

const TYPE_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部' },
  ...Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })),
];

export default function GuildMessages() {
  const { api } = useAuth();
  const toast = useToast();
  useDocumentTitle('消息');

  const [notifs, setNotifs] = useState<NotificationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeType, setActiveType] = useState('');
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listNotifications();
      if (!cancelledRef.current) setNotifs(res.notifications);
    } catch {
      /* ignore */
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    cancelledRef.current = false;
    void refresh();
    return () => { cancelledRef.current = true; };
  }, [refresh]);

  const filtered = useMemo(() => {
    let result = notifs;
    const q = search.trim().toLowerCase();
    if (q) result = result.filter((n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
    if (activeType) result = result.filter((n) => n.type === activeType);
    return result;
  }, [notifs, search, activeType]);

  const unreadCount = useMemo(() => notifs.filter((n) => !n.is_read).length, [notifs]);

  const markRead = async (id: number) => {
    try {
      await api.markNotificationRead(id);
      setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const markAll = async () => {
    if (unreadCount === 0) return;
    try {
      await api.markAllNotificationsRead();
      setNotifs((prev) => prev.map((n) => ({ ...n, is_read: true })));
      toast.success('已全部标记为已读');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleClick = (n: NotificationSummary) => {
    if (!n.is_read) void markRead(n.id);
  };

  const renderLink = (n: NotificationSummary) => {
    if (n.related_server_id) {
      const serverPath = `/guild/servers/${n.related_server_id}`;
      if (n.related_order_id) {
        return (
          <>
            {' · '}
            <Link to={`${serverPath}/orders`} onClick={(e) => e.stopPropagation()} className="gp-link">
              查看订单
            </Link>
          </>
        );
      }
      return (
        <>
          {' · '}
          <Link to={serverPath} onClick={(e) => e.stopPropagation()} className="gp-link">
            前往服务器
          </Link>
        </>
      );
    }
    return null;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 页面标题 + 操作 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
            消息
          </h1>
          <p style={{ margin: '4px 0 0', color: 'var(--gp-text-sec)', fontSize: 14 }}>
            {unreadCount > 0 ? `${unreadCount} 条未读消息` : '暂无未读消息'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="gp-icon-btn"
            onClick={() => void refresh()}
            aria-label="刷新"
            title="刷新"
          >
            <RefreshCw size={18} />
          </button>
          <button
            type="button"
            className="gp-btn-ghost"
            onClick={() => void markAll()}
            disabled={unreadCount === 0}
            style={{ gap: 6, fontSize: 13 }}
          >
            <CheckCheck size={16} />
            全部已读
          </button>
        </div>
      </div>

      {/* 搜索框 */}
      <div className="gp-search-bar">
        <Search size={18} className="gp-search-icon" />
        <input
          type="search"
          className="gp-search-input"
          placeholder="搜索消息…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* 类型筛选 Chips */}
      <div className="gp-chips">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value || 'all'}
            type="button"
            className={`gp-chip${activeType === f.value ? ' active' : ''}`}
            onClick={() => setActiveType(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 消息列表 */}
      {loading ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="gp-card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <Skeleton style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0 }} />
                <div style={{ flex: 1, display: 'grid', gap: 8 }}>
                  <Skeleton style={{ height: 16, width: '40%', borderRadius: 4 }} />
                  <Skeleton style={{ height: 14, width: '80%', borderRadius: 4 }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        notifs.length === 0 ? (
          <div className="gp-empty-icon-wrap" style={{ marginTop: 60 }}>
            <Bell size={28} />
          </div>
        ) : (
          <EmptyState title="没有匹配的消息" description="尝试调整搜索或筛选条件" />
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((n) => {
            const { Icon, color } = typeIcon(n.type);
            return (
              <div
                key={n.id}
                className="gp-card"
                style={{
                  padding: '14px 16px',
                  cursor: n.is_read ? 'default' : 'pointer',
                  opacity: n.is_read ? 0.7 : 1,
                  borderLeft: n.is_read ? undefined : '3px solid var(--gp-blue)',
                  transition: 'opacity 0.2s',
                }}
                onClick={() => handleClick(n)}
              >
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {/* 类型图标 */}
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      background: n.is_read ? 'var(--gp-bg-2)' : `${color}18`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: n.is_read ? 'var(--gp-text-tert)' : color,
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={20} />
                  </div>

                  {/* 内容区 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span
                        style={{
                          fontSize: 15,
                          fontWeight: n.is_read ? 500 : 600,
                          color: 'var(--gp-text)',
                        }}
                      >
                        {n.title}
                      </span>
                      {!n.is_read && (
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: 'var(--gp-blue)',
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--gp-text-tert)', flexShrink: 0 }}>
                        {formatTime(n.created_at)}
                      </span>
                    </div>
                    {n.content && (
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--gp-text-sec)', lineHeight: 1.5 }}>
                        {n.content}
                      </p>
                    )}
                    {(n.related_server_id || n.type) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 12 }}>
                        <span
                          className="gp-badge"
                          style={{ background: 'var(--gp-bg-2)', color: 'var(--gp-text-sec)' }}
                        >
                          {TYPE_LABEL[n.type] ?? n.type}
                        </span>
                        {renderLink(n)}
                      </div>
                    )}
                  </div>

                  {/* 箭头 */}
                  {n.related_server_id && (
                    <ChevronRight size={16} style={{ color: 'var(--gp-text-tert)', flexShrink: 0, marginTop: 12 }} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
