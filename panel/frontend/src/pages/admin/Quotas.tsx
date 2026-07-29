// ============================================================================
// Quotas — 配额管理（v4.6.0-E3）
// 路径：/admin/quotas（仅 server_admin 可见）
//
// 功能：
//   1. 角色配额区域：3 个卡片（server_admin / instance_admin / user）
//   2. 用户配额区域：搜索框 + 用户列表，点击用户查看/编辑个性化配额
//   3. 编辑 Modal：3 个数字输入框（max_instances / max_disk_mb / max_players_total）
//
// 数据来源：
//   - GET /api/quotas/role/:role（角色配额）
//   - PUT /api/quotas/role/:role（更新角色配额）
//   - GET /api/users（用户列表，前端过滤搜索）
//   - GET /api/quotas/user/:userId（用户配额）
//   - PUT /api/quotas/user/:userId（更新用户配额）
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, AlertCircle, Edit3, Search } from 'lucide-react';
import type {
  ResourceQuota,
  AdminUserSummary,
} from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { getEffectiveRole, isAdminRole } from '../../utils/role';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../context/ToastContext';
import { EmptyState, ListSkeleton, Modal, Pagination } from '../../components/ui';

const ROLES = [
  { key: 'server_admin', label: '服务器管理员' },
  { key: 'instance_admin', label: '实例管理员' },
  { key: 'user', label: '普通用户' },
] as const;

const USER_PAGE_SIZE = 20;

function formatQuotaValue(value: number | null, suffix: string): string {
  if (value === null) return '不限';
  return `${value}${suffix}`;
}

export default function Quotas() {
  const { api, user } = useAuth();

  if (!isAdminRole(getEffectiveRole(user))) return <Navigate to="/forbidden" replace />;
  const toast = useToast();
  useDocumentTitle('配额管理');

  // 角色配额状态
  const [roleQuotas, setRoleQuotas] = useState<Record<string, ResourceQuota | null>>({});
  const [loadingRoles, setLoadingRoles] = useState(true);
  const [errorRoles, setErrorRoles] = useState<string | null>(null);

  // 用户列表状态
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [errorUsers, setErrorUsers] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [userPage, setUserPage] = useState(1);

  // 编辑 Modal 状态
  const [editing, setEditing] = useState<{
    type: 'role' | 'user';
    scopeId: string;
    label: string;
    quota: ResourceQuota | null;
  } | null>(null);
  const [editMaxInstances, setEditMaxInstances] = useState('');
  const [editMaxDiskMb, setEditMaxDiskMb] = useState('');
  const [editMaxPlayersTotal, setEditMaxPlayersTotal] = useState('');
  const [saving, setSaving] = useState(false);

  const refreshRoles = useCallback(async () => {
    setLoadingRoles(true);
    setErrorRoles(null);
    try {
      const [sa, ia, u] = await Promise.all([
        api.getRoleQuota('server_admin'),
        api.getRoleQuota('instance_admin'),
        api.getRoleQuota('user'),
      ]);
      const map: Record<string, ResourceQuota | null> = {
        server_admin: sa.quota,
        instance_admin: ia.quota,
        user: u.quota,
      };
      setRoleQuotas(map);
    } catch (err) {
      setErrorRoles(err instanceof Error ? err.message : '加载角色配额失败');
    } finally {
      setLoadingRoles(false);
    }
  }, [api]);

  const refreshUsers = useCallback(async () => {
    setLoadingUsers(true);
    setErrorUsers(null);
    try {
      const res = await api.listUsers();
      setUsers(res.users);
    } catch (err) {
      setErrorUsers(err instanceof Error ? err.message : '加载用户列表失败');
    } finally {
      setLoadingUsers(false);
    }
  }, [api]);

  useEffect(() => {
    void refreshRoles();
    void refreshUsers();
  }, [refreshRoles, refreshUsers]);

  // 用户搜索过滤
  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q),
    );
  }, [users, userSearch]);

  const userTotalPages = Math.max(1, Math.ceil(filteredUsers.length / USER_PAGE_SIZE));
  const safeUserPage = Math.min(userPage, userTotalPages);
  const pagedUsers = useMemo(() => {
    const start = (safeUserPage - 1) * USER_PAGE_SIZE;
    return filteredUsers.slice(start, start + USER_PAGE_SIZE);
  }, [filteredUsers, safeUserPage]);

  const openEditRole = (roleKey: string, label: string) => {
    const q = roleQuotas[roleKey] ?? null;
    setEditing({ type: 'role', scopeId: roleKey, label, quota: q });
    setEditMaxInstances(q?.max_instances != null ? String(q.max_instances) : '');
    setEditMaxDiskMb(q?.max_disk_mb != null ? String(q.max_disk_mb) : '');
    setEditMaxPlayersTotal(q?.max_players_total != null ? String(q.max_players_total) : '');
  };

  const openEditUser = (user: AdminUserSummary) => {
    setEditing({ type: 'user', scopeId: user.id, label: `${user.username}（${user.email}）`, quota: null });
    setEditMaxInstances('');
    setEditMaxDiskMb('');
    setEditMaxPlayersTotal('');
    // 加载该用户配额
    api
      .getUserQuota(user.id)
      .then((res) => {
        setEditing((prev) =>
          prev && prev.type === 'user' && prev.scopeId === user.id ? { ...prev, quota: res.quota } : prev,
        );
        setEditMaxInstances(res.quota?.max_instances != null ? String(res.quota.max_instances) : '');
        setEditMaxDiskMb(res.quota?.max_disk_mb != null ? String(res.quota.max_disk_mb) : '');
        setEditMaxPlayersTotal(res.quota?.max_players_total != null ? String(res.quota.max_players_total) : '');
      })
      .catch(() => {
        // 静默失败，Modal 仍打开
      });
  };

  const closeEdit = () => {
    setEditing(null);
    setEditMaxInstances('');
    setEditMaxDiskMb('');
    setEditMaxPlayersTotal('');
  };

  const handleSave = async () => {
    if (!editing) return;
    const parseNum = (v: string): number | null | undefined => {
      if (v.trim() === '') return null; // 空 = 不限
      const n = parseInt(v, 10);
      if (!Number.isInteger(n) || n < 0) return undefined; // 无效
      return n;
    };
    // [v4.29.13 DISABLED] max_instances / max_players_total 已禁用，固定传 null 保持后端契约兼容。
    // 仅 max_disk_mb 取用户输入。editMaxInstances / editMaxPlayersTotal state 保留供未来恢复使用，当前不读取。
    // 恢复条件：取消注释恢复读取即可。裁决来源：docs/plans/quota-simplification-plan.md §0.1
    void editMaxInstances;
    void editMaxPlayersTotal;
    const maxDiskMb = parseNum(editMaxDiskMb);
    if (maxDiskMb === undefined) {
      toast.error('请输入有效的非负整数，或留空表示不限');
      return;
    }
    const req = { max_instances: null, max_disk_mb: maxDiskMb, max_players_total: null };

    setSaving(true);
    try {
      if (editing.type === 'role') {
        await api.updateRoleQuota(editing.scopeId, req);
        toast.success(`${editing.label} 配额已更新`);
      } else {
        await api.updateUserQuota(editing.scopeId, req);
        toast.success(`用户 ${editing.label} 配额已更新`);
      }
      closeEdit();
      void refreshRoles();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存配额失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 className="page-title">配额管理</h1>
          <p className="page-subtitle" style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginTop: 4 }}>
            管理角色默认磁盘配额与用户个性化磁盘配额（留空 = 不限）
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => { void refreshRoles(); void refreshUsers(); }} disabled={loadingRoles || loadingUsers}>
          <RefreshCw size={16} /> 刷新
        </button>
      </div>

      {/* 角色配额区域 */}
      <h3 className="card-title" style={{ marginBottom: 12 }}>角色配额</h3>
      {errorRoles && (
        <div className="error-banner" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, background: 'var(--color-bg-error, #fef2f2)', borderRadius: 6, marginBottom: 12 }}>
          <AlertCircle size={18} />
          <span>{errorRoles}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refreshRoles()}>
            <RefreshCw size={14} /> 重试
          </button>
        </div>
      )}
      {loadingRoles ? (
        <ListSkeleton rows={1} columns={3} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 24 }}>
          {ROLES.map((r) => {
            const q = roleQuotas[r.key] ?? null;
            return (
              <div key={r.key} className="info-card" style={{ margin: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <h4 className="card-title" style={{ margin: 0 }}>{r.label}</h4>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => openEditRole(r.key, r.label)}
                    aria-label={`编辑 ${r.label} 配额`}
                  >
                    <Edit3 size={14} /> 编辑
                  </button>
                </div>
                {/* [v4.29.13 DISABLED] 实例配额 / 玩家总数已禁用展示，仅保留磁盘配额。
                    禁用原因：role 级配额因角色免密切换失效；max_instances 因 VPS 预付费上线作用下降。
                    恢复条件：取消下方注释恢复展示即可。裁决来源：docs/plans/quota-simplification-plan.md §0.1 */}
                {/* <div className="info-row">
                  <span className="info-label">实例配额</span>
                  <span className="info-value mono">{formatQuotaValue(q?.max_instances ?? null, '')}</span>
                </div> */}
                <div className="info-row">
                  <span className="info-label">磁盘配额</span>
                  <span className="info-value mono">{formatQuotaValue(q?.max_disk_mb ?? null, ' MB')}</span>
                </div>
                {/* <div className="info-row">
                  <span className="info-label">玩家总数</span>
                  <span className="info-value mono">{formatQuotaValue(q?.max_players_total ?? null, '')}</span>
                </div> */}
              </div>
            );
          })}
        </div>
      )}

      {/* 用户配额区域 */}
      <h3 className="card-title" style={{ marginBottom: 12 }}>用户配额</h3>
      {errorUsers && (
        <div className="error-banner" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, background: 'var(--color-bg-error, #fef2f2)', borderRadius: 6, marginBottom: 12 }}>
          <AlertCircle size={18} />
          <span>{errorUsers}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refreshUsers()}>
            <RefreshCw size={14} /> 重试
          </button>
        </div>
      )}
      <div className="toolbar" style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Search size={16} style={{ opacity: 0.5 }} />
        <input
          type="search"
          className="toolbar-search"
          placeholder="搜索用户名 / ID / 邮箱…"
          value={userSearch}
          onChange={(e) => { setUserSearch(e.target.value); setUserPage(1); }}
          aria-label="搜索用户"
          style={{ flex: 1, maxWidth: 400 }}
        />
        <span className="form-hint">共 {filteredUsers.length} 条</span>
      </div>

      {loadingUsers ? (
        <ListSkeleton rows={6} columns={4} />
      ) : filteredUsers.length === 0 ? (
        <EmptyState title={users.length === 0 ? '暂无用户' : '没有匹配的用户'} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>用户名</th>
                  <th>邮箱</th>
                  <th>角色</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {pagedUsers.map((u) => (
                  <tr key={u.id}>
                    <td className="cell-name">{u.username}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{u.email}</td>
                    <td>
                      <span className="badge badge-stopped">{u.role}</span>
                    </td>
                    <td className="col-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => openEditUser(u)}
                      >
                        <Edit3 size={14} /> 编辑配额
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
            <Pagination
              page={safeUserPage}
              totalPages={userTotalPages}
              onPageChange={(p) => setUserPage(p)}
              disabled={loadingUsers}
            />
          </div>
        </>
      )}

      {/* 编辑 Modal */}
      <Modal
        open={editing !== null}
        title={editing ? `编辑配额 — ${editing.label}` : ''}
        onClose={closeEdit}
        disableClose={saving}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeEdit} disabled={saving}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        {editing && (
          <div>
            <p className="form-hint" style={{ marginBottom: 12 }}>
              留空表示不限（NULL）。输入 0 表示禁止。
            </p>
            {/* [v4.29.13 DISABLED] 最大实例数 / 最大玩家总数输入框已禁用展示，仅保留磁盘配额。
                禁用原因：role 级配额因角色免密切换失效；max_instances 因 VPS 预付费上线作用下降。
                恢复条件：取消下方注释恢复展示即可。裁决来源：docs/plans/quota-simplification-plan.md §0.1 */}
            {/* <label className="form-field">
              <span className="form-label">最大实例数</span>
              <input
                type="number"
                min={0}
                value={editMaxInstances}
                onChange={(e) => setEditMaxInstances(e.target.value)}
                placeholder="留空 = 不限"
                disabled={saving}
              />
            </label> */}
            <label className="form-field">
              <span className="form-label">最大磁盘 (MB)</span>
              <input
                type="number"
                min={0}
                value={editMaxDiskMb}
                onChange={(e) => setEditMaxDiskMb(e.target.value)}
                placeholder="留空 = 不限"
                disabled={saving}
              />
            </label>
            {/* <label className="form-field">
              <span className="form-label">最大玩家总数</span>
              <input
                type="number"
                min={0}
                value={editMaxPlayersTotal}
                onChange={(e) => setEditMaxPlayersTotal(e.target.value)}
                placeholder="留空 = 不限"
                disabled={saving}
              />
            </label> */}
          </div>
        )}
      </Modal>
    </div>
  );
}
