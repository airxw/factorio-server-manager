// ============================================================================
// NotificationsPage — 站内消息列表
// 3.8: 添加返回入口
// 3.9: 通知关联实体可点击跳转
// 8.3: 列表搜索 + 筛选（按标题搜索、按类型筛选）
// 8.5: 搜索/筛选状态同步到 URL query（replace 模式避免历史栈污染）
// 8.6: 监听 `focus-search` 自定义事件，按 `/` 聚焦搜索框
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../api/auth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useGoBack } from '../hooks/useGoBack';
import { useToast, EmptyState, Skeleton } from '../components/ui';

// v4.14.2: 根据当前基座确定返回路径（避免跨基座跳转）
function useBaseFallback(): string {
  const { pathname } = useLocation();
  if (pathname.startsWith('/admin')) return '/admin';
  if (pathname.startsWith('/store')) return '/store';
  return '/guild';
}

interface Notif {
  id: number;
  type: string;
  title: string;
  content: string;
  related_server_id: string | null;
  related_order_id: number | null;
  is_read: boolean;
  created_at: string;
}

const TYPE_LABEL: Record<string, string> = {
  order_delivered: '订单已领取',
  order_expired: '订单已过期',
  cdk_gift: 'CDK礼包',
  vip_changed: 'VIP变更',
  system_announcement: '系统通知',
};

// 8.3: 类型筛选选项（基于 TYPE_LABEL 的键生成，保证两者同步）
const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部类型' },
  ...Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })),
];

export default function NotificationsPage() {
  const { api } = useAuth();
  const toast = useToast();
  // v4.14.2: 返回路径根据当前基座动态确定
  const fallbackPath = useBaseFallback();
  const goBack = useGoBack(fallbackPath);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  useDocumentTitle('站内消息');

  // 8.5: URL 状态化——搜索/筛选状态同步到 URL query
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const typeFilter = searchParams.get('type') ?? '';

  // 8.6: 搜索框 ref，监听 `focus-search` 事件聚焦
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // 3.3.5: cancelled 标志防止组件卸载后 setState 触发 React 警告
  // 关键：不使用 AbortController——浏览器网络层 abort 日志无法被 JS 抑制
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listNotifications();
      if (!cancelledRef.current) {
        setNotifs(res.notifications);
      }
    } catch {
      /* ignore */
    } finally {
      if (!cancelledRef.current) {
        setLoading(false);
      }
    }
  }, [api]);

  useEffect(() => {
    cancelledRef.current = false;
    void refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [refresh]);

  // 8.6: 监听 `/` 快捷键派发的 focus-search 事件
  useEffect(() => {
    const handler = () => searchInputRef.current?.focus();
    window.addEventListener('focus-search', handler);
    return () => window.removeEventListener('focus-search', handler);
  }, []);

  // 8.5: URL 状态更新工具——replace 模式避免历史栈污染
  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  };

  const handleSearchChange = (value: string) => {
    updateParams({ q: value || null });
  };

  const handleTypeChange = (value: string) => {
    updateParams({ type: value || null });
  };

  // 8.3: 客户端过滤（按标题搜索 + 按类型筛选）
  const filteredNotifs = useMemo(() => {
    let result = notifs;
    if (q.trim()) {
      const query = q.trim().toLowerCase();
      result = result.filter((n) => n.title.toLowerCase().includes(query));
    }
    if (typeFilter) {
      result = result.filter((n) => n.type === typeFilter);
    }
    return result;
  }, [notifs, q, typeFilter]);

  const markRead = async (id: number) => {
    try {
      await api.markNotificationRead(id);
      setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '标记已读失败');
    }
  };

  const markAll = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifs((prev) => prev.map((n) => ({ ...n, is_read: true })));
      toast.success('已全部标记为已读');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <button className="btn btn-ghost btn-sm back-btn" onClick={goBack}>
            ← 返回
          </button>
          <h2 className="page-title">站内消息</h2>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refresh()}>
            刷新
          </button>
          <button className="btn btn-ghost" onClick={() => void markAll()}>
            全部已读
          </button>
        </div>
      </div>

      {/* 8.3: 搜索 + 筛选工具栏 */}
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <input
          ref={searchInputRef}
          type="search"
          className="toolbar-search"
          placeholder="搜索标题…"
          value={q}
          onChange={(e) => handleSearchChange(e.target.value)}
          aria-label="搜索消息"
        />
        <select
          value={typeFilter}
          onChange={(e) => handleTypeChange(e.target.value)}
          aria-label="按类型筛选"
          style={{ width: 'auto', minWidth: 120 }}
        >
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="form-hint" style={{ marginLeft: 'auto' }}>
          共 {filteredNotifs.length} 条
        </span>
      </div>

      {loading ? (
        <div className="info-card">
          <Skeleton lines={4} lineHeight={20} />
        </div>
      ) : filteredNotifs.length === 0 ? (
        <EmptyState
          title={notifs.length === 0 ? '暂无消息' : '没有匹配筛选条件的消息'}
          description={notifs.length === 0 ? '新的通知会显示在这里' : '尝试调整搜索或筛选条件'}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredNotifs.map((n) => (
            <div
              key={n.id}
              className="info-card"
              style={{
                opacity: n.is_read ? 0.6 : 1,
                borderLeft: n.is_read ? undefined : '3px solid var(--primary)',
                cursor: n.is_read ? undefined : 'pointer',
              }}
              onClick={() => !n.is_read && void markRead(n.id)}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <strong>{TYPE_LABEL[n.type] ?? n.type}</strong>
                <span className="form-hint">{new Date(n.created_at).toLocaleString('zh-CN')}</span>
              </div>
              <p style={{ margin: '4px 0 0' }}>
                {n.title}
                {/* 3.9: 关联实体可点击跳转 */}
                {n.related_server_id && (
                  <>
                    {' — '}
                    <Link
                      to={`/instances/${n.related_server_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="cell-name"
                    >
                      查看实例
                    </Link>
                    {n.related_order_id && (
                      <>
                        {' · '}
                        <Link
                          to={`/instances/${n.related_server_id}/shop-orders`}
                          onClick={(e) => e.stopPropagation()}
                          className="cell-name"
                        >
                          查看订单
                        </Link>
                      </>
                    )}
                  </>
                )}
              </p>
              {n.content && (
                <p className="form-hint" style={{ margin: '2px 0 0' }}>
                  {n.content}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
