// ============================================================================
// PlayerProfile — 玩家档案页（v4.8.0-L2）
// 公开页面（带 token 返回更多），路由 /players/:userId
// 展示：用户名 / VIP / 注册时间 / 绑定实例 / 共同实例 / 好友状态 / 最近活动
// 已登录且非自己：显示添加好友 / 接受 / 拒绝按钮
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Crown } from 'lucide-react';
import type {
  PlayerProfile,
  PlayerProfileInstance,
  FriendStatusType,
} from '@public/schema/panel-api-types';
import { useAuth } from '../api/auth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { EmptyState, ErrorState, Skeleton, useToast } from '../components/ui';

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    running: '运行中',
    starting: '启动中',
    stopping: '停止中',
    stopped: '已停止',
    error: '错误',
  };
  return map[status] ?? status;
}

function statusClass(status: string): string {
  return `badge badge-${status}`;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

const FRIEND_STATUS_LABEL: Record<FriendStatusType, string> = {
  none: '非好友',
  pending: '请求待处理',
  accepted: '已为好友',
  blocked: '已屏蔽',
};

function friendBadgeClass(status: FriendStatusType): string {
  if (status === 'accepted') return 'badge badge-running';
  if (status === 'pending') return 'badge badge-starting';
  if (status === 'blocked') return 'badge badge-error';
  return 'badge';
}

function InstanceList({ instances }: { instances: PlayerProfileInstance[] }) {
  if (instances.length === 0) {
    return <EmptyState title="暂无实例" />;
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>实例名</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {instances.map((inst) => (
            <tr key={inst.id}>
              <td className="cell-name">{inst.name}</td>
              <td>
                <span className={statusClass(inst.status)}>{statusLabel(inst.status)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PlayerProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const { api, user } = useAuth();
  const toast = useToast();
  useDocumentTitle('玩家档案');

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioning, setActioning] = useState(false);

  const targetUserId = userId ?? '';

  const refresh = useCallback(async () => {
    if (!targetUserId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPlayerProfile(targetUserId);
      setProfile(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载玩家档案失败');
    } finally {
      setLoading(false);
    }
  }, [api, targetUserId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isSelf = !!user && user.id === targetUserId;
  const friendStatus: FriendStatusType | undefined = profile?.friend_status;

  const handleSendRequest = async () => {
    setActioning(true);
    try {
      await api.sendFriendRequest(targetUserId);
      toast.success('已发送好友请求');
      await refresh();
    } catch (err) {
      toast.error('发送好友请求失败', err instanceof Error ? err.message : String(err));
    } finally {
      setActioning(false);
    }
  };

  const handleAccept = async () => {
    setActioning(true);
    try {
      await api.acceptFriendRequest(targetUserId);
      toast.success('已接受好友请求');
      await refresh();
    } catch (err) {
      toast.error('接受好友请求失败', err instanceof Error ? err.message : String(err));
    } finally {
      setActioning(false);
    }
  };

  const handleReject = async () => {
    setActioning(true);
    try {
      await api.rejectFriendRequest(targetUserId);
      toast.success('已拒绝好友请求');
      await refresh();
    } catch (err) {
      toast.error('拒绝好友请求失败', err instanceof Error ? err.message : String(err));
    } finally {
      setActioning(false);
    }
  };

  if (loading && !profile) {
    return (
      <div className="page">
        <div className="page-header">
          <h2 className="page-title">玩家档案</h2>
        </div>
        <div className="info-card">
          <Skeleton lines={5} lineHeight={20} />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="page">
        <div className="page-header">
          <h2 className="page-title">玩家档案</h2>
          <div className="page-actions">
            <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
              刷新
            </button>
          </div>
        </div>
        <ErrorState error={error ?? '玩家档案不存在或加载失败'} onRetry={() => void refresh()} retrying={loading} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">玩家档案</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {error && <ErrorState error={error} onRetry={() => void refresh()} retrying={loading} />}

      {/* 顶部用户信息 */}
      <div className="info-card">
        <h3 className="card-title">基本信息</h3>
        <div className="info-row">
          <span className="info-label">用户名</span>
          <span className="info-value">{profile.user.username}</span>
        </div>
        <div className="info-row">
          <span className="info-label">VIP 等级</span>
          <span className="info-value">
            <span className="badge badge-running">
              <Crown size={11} /> VIP{profile.user.vip_level}
            </span>
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">注册时间</span>
          <span className="info-value">{formatTime(profile.user.created_at)}</span>
        </div>
        {isSelf ? (
          <div className="info-row">
            <span className="info-label">提示</span>
            <span className="info-value">这是你自己</span>
          </div>
        ) : (
          user && (
            <div className="info-row">
              <span className="info-label">好友状态</span>
              <span className="info-value">
                {friendStatus ? (
                  <span className={friendBadgeClass(friendStatus)}>
                    {FRIEND_STATUS_LABEL[friendStatus]}
                  </span>
                ) : (
                  <span className="badge">未知</span>
                )}
                <span style={{ marginLeft: 12, display: 'inline-flex', gap: 8 }}>
                  {friendStatus === 'none' && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void handleSendRequest()}
                      disabled={actioning}
                    >
                      {actioning ? '处理中…' : '添加好友'}
                    </button>
                  )}
                  {friendStatus === 'pending' && (
                    <>
                      <button
                        className="btn btn-success btn-sm"
                        onClick={() => void handleAccept()}
                        disabled={actioning}
                      >
                        接受
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => void handleReject()}
                        disabled={actioning}
                      >
                        拒绝
                      </button>
                    </>
                  )}
                  {friendStatus === 'accepted' && (
                    <span className="form-hint">你们已是好友</span>
                  )}
                </span>
              </span>
            </div>
          )
        )}
      </div>

      {/* 绑定的实例 */}
      <div className="info-card">
        <h3 className="card-title">绑定的实例</h3>
        <InstanceList instances={profile.bound_instances} />
      </div>

      {/* 共同实例（仅登录且非自己） */}
      {!isSelf && user && profile.mutual_instances && (
        <div className="info-card">
          <h3 className="card-title">共同实例</h3>
          <InstanceList instances={profile.mutual_instances} />
        </div>
      )}

      {/* 最近活动 */}
      <div className="info-card">
        <h3 className="card-title">最近活动</h3>
        {!profile.recent_activity || profile.recent_activity.length === 0 ? (
          <EmptyState title="暂无最近活动" />
        ) : (
          <ul className="activity-list">
            {profile.recent_activity.map((item, idx) => (
              <li key={idx} className="activity-item">
                {typeof item === 'string' ? item : JSON.stringify(item)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
