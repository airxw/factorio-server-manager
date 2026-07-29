// ============================================================================
// Friends — 好友页（v4.8.0-L3）
// 已登录用户社交入口，路由 /friends
// - 好友列表（GET /api/friends）：用户名 + 在线状态 + 删除按钮
// - 待处理请求（GET /api/friends/pending）：发送者 + 接受/拒绝
// - 在线好友筛选（GET /api/friends/online）：切换显示在线好友
// - 添加好友入口：输入用户 ID + 发送请求
// 注：Friendship 契约不含 vip/online 字段，在线状态由 /friends/online 列表派生
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Users } from 'lucide-react';
import type { Friendship, PendingFriendRequest } from '@public/schema/panel-api-types';
import { useAuth } from '../api/auth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { EmptyState, ErrorState, Skeleton, useToast } from '../components/ui';
import { useConfirm } from '../context/ConfirmContext';

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

type ViewMode = 'all' | 'online';

export default function Friends() {
  const { api, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useConfirm();
  useDocumentTitle('好友');

  const [friends, setFriends] = useState<Friendship[]>([]);
  const [pending, setPending] = useState<PendingFriendRequest[]>([]);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('all');

  // 添加好友表单
  const [addUserId, setAddUserId] = useState('');
  const [sending, setSending] = useState(false);
  // 操作中的好友 ID（accept/reject/remove），禁用对应按钮
  const [actioningId, setActioningId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [friendsRes, pendingRes, onlineRes] = await Promise.all([
        api.listFriends(),
        api.listPendingFriendRequests(),
        api.listOnlineFriends(),
      ]);
      setFriends(friendsRes.friends);
      setPending(pendingRes.requests);
      // 在线好友按 friend_user_id 收集（listOnlineFriends 返回的 Friendship 中
      // friend_user_id 是当前用户的在线好友）
      setOnlineIds(new Set(onlineRes.friends.map((f) => f.friend_user_id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载好友列表失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 当前用户的 ID，用于在 Friendship 中识别"对方"用户名
  // Friendship 是双向记录：user_id + friend_user_id，其中一个是当前用户
  const myId = user?.id;

  const resolveFriend = useCallback(
    (f: Friendship): { id: string; name: string } => {
      // friend_user_id 是"对方"，friend_username 是对方用户名
      if (f.user_id === myId) {
        return { id: f.friend_user_id, name: f.friend_username };
      }
      // 兜底：user_id 是对方
      return { id: f.user_id, name: f.username };
    },
    [myId],
  );

  const visibleFriends = useMemo(() => {
    if (viewMode === 'online') {
      return friends.filter((f) => {
        const other = resolveFriend(f);
        return onlineIds.has(other.id);
      });
    }
    return friends;
  }, [friends, viewMode, onlineIds, resolveFriend]);

  const handleSendRequest = async () => {
    const id = addUserId.trim();
    if (!id) {
      toast.warning('请输入用户 ID');
      return;
    }
    setSending(true);
    try {
      await api.sendFriendRequest(id);
      toast.success('已发送好友请求');
      setAddUserId('');
      await refresh();
    } catch (err) {
      toast.error('发送好友请求失败', err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const handleAccept = async (req: PendingFriendRequest) => {
    setActioningId(req.id);
    try {
      await api.acceptFriendRequest(req.from_user_id);
      toast.success(`已接受「${req.from_username}」的好友请求`);
      await refresh();
    } catch (err) {
      toast.error('接受好友请求失败', err instanceof Error ? err.message : String(err));
    } finally {
      setActioningId(null);
    }
  };

  const handleReject = async (req: PendingFriendRequest) => {
    setActioningId(req.id);
    try {
      await api.rejectFriendRequest(req.from_user_id);
      toast.success(`已拒绝「${req.from_username}」的好友请求`);
      await refresh();
    } catch (err) {
      toast.error('拒绝好友请求失败', err instanceof Error ? err.message : String(err));
    } finally {
      setActioningId(null);
    }
  };

  const handleRemove = async (f: Friendship) => {
    const other = resolveFriend(f);
    const ok = await confirm({
      title: '删除好友',
      message: `确定删除好友「${other.name}」？此操作不可撤销。`,
      danger: true,
      confirmText: '删除',
    });
    if (!ok) return;
    setActioningId(f.id);
    try {
      await api.removeFriend(other.id);
      toast.success(`已删除好友「${other.name}」`);
      await refresh();
    } catch (err) {
      toast.error('删除好友失败', err instanceof Error ? err.message : String(err));
    } finally {
      setActioningId(null);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">好友</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {error && <ErrorState error={error} onRetry={() => void refresh()} retrying={loading} />}

      {/* 添加好友入口 */}
      <div className="info-card">
        <h3 className="card-title">
          <UserPlus size={16} /> 添加好友
        </h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSendRequest();
          }}
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
        >
          <input
            className="form-control"
            type="text"
            value={addUserId}
            onChange={(e) => setAddUserId(e.target.value)}
            placeholder="输入用户 ID 发送好友请求"
            autoComplete="off"
            style={{ flex: 1, minWidth: 200 }}
          />
          <button type="submit" className="btn btn-primary" disabled={sending}>
            {sending ? '发送中…' : '发送请求'}
          </button>
        </form>
      </div>

      {loading && friends.length === 0 && pending.length === 0 ? (
        <div className="info-card">
          <Skeleton lines={5} lineHeight={20} />
        </div>
      ) : (
        <>
          {/* 待处理请求 */}
          <div className="info-card">
            <h3 className="card-title">
              待处理请求（{pending.length}）
            </h3>
            {pending.length === 0 ? (
              <EmptyState title="暂无待处理请求" />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>发送者</th>
                      <th>请求时间</th>
                      <th className="col-actions">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((req) => (
                      <tr key={req.id}>
                        <td className="cell-name">
                          <button
                            type="button"
                            className="btn btn-link"
                            onClick={() => navigate(`/players/${req.from_user_id}`)}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              color: 'var(--color-primary, #2563eb)',
                              cursor: 'pointer',
                              font: 'inherit',
                            }}
                          >
                            {req.from_username}
                          </button>
                        </td>
                        <td>{formatTime(req.created_at)}</td>
                        <td className="col-actions">
                          <button
                            className="btn btn-success btn-sm"
                            onClick={() => void handleAccept(req)}
                            disabled={actioningId === req.id}
                          >
                            接受
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => void handleReject(req)}
                            disabled={actioningId === req.id}
                          >
                            拒绝
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 好友列表 */}
          <div className="info-card">
            <h3 className="card-title">
              <Users size={16} /> 好友列表（{visibleFriends.length}）
            </h3>
            <div className="toolbar" style={{ marginBottom: 12 }}>
              <div className="btn-group" role="group" aria-label="好友筛选">
                <button
                  type="button"
                  className={`btn btn-sm ${viewMode === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setViewMode('all')}
                >
                  全部
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${viewMode === 'online' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setViewMode('online')}
                >
                  在线（{onlineIds.size}）
                </button>
              </div>
            </div>
            {visibleFriends.length === 0 ? (
              <EmptyState
                title={viewMode === 'online' ? '暂无在线好友' : '暂无好友'}
                description={
                  viewMode === 'online'
                    ? '当前没有好友在线。'
                    : '通过上方「添加好友」入口添加好友。'
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>用户名</th>
                      <th>状态</th>
                      <th>成为好友时间</th>
                      <th className="col-actions">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleFriends.map((f) => {
                      const other = resolveFriend(f);
                      const isOnline = onlineIds.has(other.id);
                      return (
                        <tr key={f.id}>
                          <td className="cell-name">
                            <button
                              type="button"
                              onClick={() => navigate(`/players/${other.id}`)}
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                color: 'var(--color-primary, #2563eb)',
                                cursor: 'pointer',
                                font: 'inherit',
                              }}
                            >
                              {other.name}
                            </button>
                          </td>
                          <td>
                            <span
                              className={isOnline ? 'badge badge-running' : 'badge badge-stopped'}
                            >
                              {isOnline ? '在线' : '离线'}
                            </span>
                          </td>
                          <td>{formatTime(f.accepted_at ?? f.created_at)}</td>
                          <td className="col-actions">
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => void handleRemove(f)}
                              disabled={actioningId === f.id}
                            >
                              删除
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 推荐好友区（无后端支持，显示提示） */}
          <div className="info-card">
            <h3 className="card-title">推荐好友</h3>
            <EmptyState
              title="推荐功能暂未开放"
              description="同实例玩家推荐功能尚在开发中，可先通过用户 ID 添加好友。"
            />
          </div>
        </>
      )}
    </div>
  );
}
