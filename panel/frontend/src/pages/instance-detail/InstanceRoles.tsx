// ============================================================================
// InstanceRoles — 实例级角色管理（v4.7.0-H2）
// 列出实例的角色分配（instance_admin / user），支持授予 / 撤销
// 契约：GET /api/servers/:serverId/roles
// 风格参考 Admins.tsx
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type { InstanceRole, GrantInstanceRoleRequest } from '@public/schema/panel-api-types';
import { useAuth } from '../../api/auth';
import { useToast } from '../../context/ToastContext';

export interface InstanceRolesPageProps {
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

const ROLE_LABEL: Record<string, string> = {
  instance_admin: '实例管理员',
  user: '普通用户',
};

function roleBadgeClass(role: string): string {
  return role === 'instance_admin' ? 'badge badge-running' : 'badge';
}

export default function InstanceRoles({ serverId }: InstanceRolesPageProps) {
  const { api } = useAuth();
  const toast = useToast();

  const [roles, setRoles] = useState<InstanceRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 授予角色表单
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<GrantInstanceRoleRequest['role']>('instance_admin');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listInstanceRoles(serverId);
      setRoles(res.roles);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载实例角色列表失败');
    } finally {
      setLoading(false);
    }
  }, [api, serverId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleGrant = async () => {
    const id = userId.trim();
    if (!id) {
      setError('请填写用户 ID');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const req: GrantInstanceRoleRequest = {
        user_id: id,
        role,
      };
      if (expiresAt) {
        // datetime-local → ISO 8601
        req.expires_at = new Date(expiresAt).toISOString();
      }
      await api.grantInstanceRole(serverId, req);
      toast.success(`已授予角色：${ROLE_LABEL[role] ?? role}`);
      setUserId('');
      setExpiresAt('');
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '授予角色失败';
      setError(msg);
      toast.error('授予角色失败', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (r: InstanceRole) => {
    const displayName = r.username || r.user_id;
    if (!window.confirm(`确认撤销「${displayName}」的实例角色？此操作不可撤销。`)) {
      return;
    }
    setError(null);
    setRevokingId(r.id);
    try {
      await api.revokeInstanceRole(serverId, r.user_id);
      setRoles((prev) => prev.filter((item) => item.user_id !== r.user_id));
      toast.success(`已撤销角色：${displayName}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '撤销角色失败';
      setError(msg);
      toast.error('撤销角色失败', msg);
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">角色管理</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* 授予角色表单 */}
      <div className="info-card">
        <h3 className="card-title">授予实例角色</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleGrant();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <div className="form-group">
            <label htmlFor="role-user-id">用户 ID *</label>
            <input
              id="role-user-id"
              className="form-control"
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="请输入要授予角色的用户 ID"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="role-select">角色 *</label>
            <select
              id="role-select"
              className="form-control"
              value={role}
              onChange={(e) => setRole(e.target.value as GrantInstanceRoleRequest['role'])}
            >
              <option value="instance_admin">实例管理员</option>
              <option value="user">普通用户</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="role-expires-at">过期时间（可选）</label>
            <input
              id="role-expires-at"
              className="form-control"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          <div className="page-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? '提交中…' : '授予角色'}
            </button>
          </div>
        </form>
      </div>

      {/* 角色列表 */}
      <div className="info-card">
        <h3 className="card-title">角色分配列表</h3>
        {loading ? (
          <div className="empty-state">加载中…</div>
        ) : roles.length === 0 ? (
          <div className="empty-state">暂无角色分配。</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>用户名</th>
                <th>角色</th>
                <th>授予者</th>
                <th>授予时间</th>
                <th>过期时间</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id}>
                  <td>{r.username || r.user_id}</td>
                  <td>
                    <span className={roleBadgeClass(r.role)}>
                      {ROLE_LABEL[r.role] ?? r.role}
                    </span>
                  </td>
                  <td>{r.granted_username || r.granted_by}</td>
                  <td>{formatTime(r.granted_at)}</td>
                  <td>{formatTime(r.expires_at)}</td>
                  <td className="col-actions">
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => void handleRevoke(r)}
                      disabled={revokingId === r.id}
                    >
                      {revokingId === r.id ? '撤销中…' : '撤销'}
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
