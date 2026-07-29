// ============================================================================
// Admins — 实例共管管理员管理（v4.5.0）
// 列出实例的共管管理员，支持添加/移除
// 契约：GET /api/servers/:serverId/admins
// 风格参考 Saves.tsx
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type { InstanceAdmin } from '@public/schema/panel-api-types';
import { useAuth } from '../../api/auth';

export interface AdminsPageProps {
  serverId: string;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function Admins({ serverId }: AdminsPageProps) {
  const { api } = useAuth();

  const [admins, setAdmins] = useState<InstanceAdmin[]>([]);
  const [owner, setOwner] = useState<{ user_id: string; username: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 添加管理员表单
  const [userId, setUserId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listInstanceAdmins(serverId);
      setAdmins(res.admins);
      setOwner(res.owner);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载共管管理员列表失败');
    } finally {
      setLoading(false);
    }
  }, [api, serverId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAssign = async () => {
    const id = userId.trim();
    if (!id) {
      setError('请填写用户 ID');
      return;
    }
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await api.assignInstanceAdmin(serverId, { user_id: id });
      setSuccess(`已添加管理员：${id}`);
      setUserId('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加管理员失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (admin: InstanceAdmin) => {
    const displayName = admin.username || admin.user_id;
    if (!window.confirm(`确认移除共管管理员「${displayName}」？此操作不可撤销。`)) {
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      await api.removeInstanceAdmin(serverId, admin.user_id);
      setAdmins((prev) => prev.filter((a) => a.user_id !== admin.user_id));
      setSuccess(`已移除管理员：${displayName}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '移除管理员失败');
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">共管管理</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Owner 信息 */}
      {owner && (
        <div className="info-card">
          <h3 className="card-title">实例所有者</h3>
          <div className="info-row">
            <span className="info-label">Owner</span>
            <span className="info-value">
              <span className="badge badge-running">Owner: {owner.username}</span>
            </span>
          </div>
        </div>
      )}

      {/* 添加管理员表单 */}
      <div className="info-card">
        <h3 className="card-title">添加共管管理员</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleAssign();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <div className="form-group">
            <label htmlFor="admin-user-id">用户 ID *</label>
            <input
              id="admin-user-id"
              className="form-control"
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="请输入要添加的用户 ID"
              required
            />
          </div>
          <div className="page-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? '提交中…' : '添加管理员'}
            </button>
          </div>
        </form>
      </div>

      {/* 管理员列表 */}
      <div className="info-card">
        <h3 className="card-title">共管管理员列表</h3>
        {loading ? (
          <div className="empty-state">加载中…</div>
        ) : admins.length === 0 ? (
          <div className="empty-state">暂无共管管理员。</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>用户名</th>
                <th>分配时间</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => (
                <tr key={admin.id}>
                  <td>{admin.username || admin.user_id}</td>
                  <td>{formatTime(admin.assigned_at)}</td>
                  <td className="col-actions">
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => void handleRemove(admin)}
                    >
                      移除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
