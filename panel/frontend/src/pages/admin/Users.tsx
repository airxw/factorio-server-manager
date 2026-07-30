// ============================================================================
// Users — 用户管理（仅 server_admin 可见）
// 表格展示用户列表 + 搜索过滤 + 行内编辑（role/status/vip_level/display_name）
// + 新建用户（POST /api/users） + 软删除（DELETE /api/users/:id）
// + 批量操作（POST /api/users/batch）：启用/禁用/删除/改角色
// @version 3.1.0: UserRole 升 3 级（server_admin/instance_admin/user）；
//                 角色下拉选项 / 创建表单 / 删除按钮均按 3 级实现
// @version 4.24.0: 批量选择 + 批量操作工具栏 + 结果反馈 modal
// @version 4.25.0: 用户分析卡片迁移至平台总览页（/admin/platform），
//                  本页聚焦于用户管理 CRUD 本身
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AdminUserSummary,
  BatchUserAction,
  BatchUserOperationResponse,
  CreateUserRequest,
  UpdateUserRequest,
  UserRole,
} from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import { getEffectiveRole, isAdminRole } from '../../utils/role';
import { ListSkeleton, MobileCardList, Pagination } from '../../components/ui';
import VirtualTable, { type VirtualColumn } from '../../components/VirtualTable';

/** 批量操作单次上限（与后端硬约束对齐） */
const BATCH_LIMIT = 100;

// v3.1.0：UserRole 已升 3 级
const ROLE_OPTIONS: UserRole[] = ['server_admin', 'instance_admin', 'user'];

// 状态候选：UI 不允许直接切到 'deleted'（删除走专用按钮，软删除后由后端置位）
const STATUS_OPTIONS: Array<'active' | 'disabled'> = ['active', 'disabled'];

// 角色中文标签
const ROLE_LABEL: Record<UserRole, string> = {
  server_admin: '系统管理员',
  instance_admin: '实例管理员',
  user: '普通用户',
};

/** 初始新建用户表单 */
const EMPTY_CREATE_FORM: CreateUserRequest = {
  email: '',
  username: '',
  password: '',
  role: 'user',
};

/** 服务端分页参数 */
const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export default function Users() {
  const { api, user } = useAuth();

  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 服务端分页状态：keyword 输入是即时本地值，搜索时才同步到 serverKeyword
  const [keywordInput, setKeywordInput] = useState('');
  const [serverKeyword, setServerKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // 行内编辑
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UpdateUserRequest>({});
  const [saving, setSaving] = useState(false);

  // 新建用户 modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserRequest>(EMPTY_CREATE_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // 软删除确认
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // v4.24.0: 批量选择
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchUserOperationResponse | null>(null);
  // 批量删除二次确认
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);
  // 批量改角色下拉
  const [batchRoleValue, setBatchRoleValue] = useState<UserRole>('user');
  const [batchRoleConfirm, setBatchRoleConfirm] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listUsers({ page, page_size: pageSize, keyword: serverKeyword });
      setUsers(res.users);
      setTotal(res.total);
      setTotalPages(res.total_pages ?? Math.max(1, Math.ceil(res.total / pageSize)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载用户列表失败');
    } finally {
      setLoading(false);
    }
  }, [api, page, pageSize, serverKeyword]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 服务端搜索：输入回车或点击搜索按钮时同步 keyword
  const submitSearch = () => {
    const kw = keywordInput.trim();
    if (kw === serverKeyword) return;
    setServerKeyword(kw);
    setPage(1);
    // selectedIds 跨页搜索后语义失效，直接清空
    setSelectedIds(new Set());
  };

  // filtered 改为直接等于 users（服务端已过滤）
  const filtered = users;

  const onPageChange = (next: number) => {
    setPage(next);
    setSelectedIds(new Set());
  };

  const onPageSizeChange = (next: number) => {
    setPageSize(next);
    setPage(1);
    setSelectedIds(new Set());
  };

  const startEdit = (u: AdminUserSummary) => {
    setEditingId(u.id);
    setDraft({
      role: u.role,
      status: u.status === 'deleted' ? 'active' : u.status,
      display_name: u.display_name,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft({});
  };

  const handleSave = async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.updateUser(id, draft);
      setUsers((prev) => prev.map((u) => (u.id === id ? res.user : u)));
      setEditingId(null);
      setDraft({});
    } catch (err) {
      if (err instanceof PanelApiError && err.code === 'PANEL_FORBIDDEN') {
        setError('无权限执行该操作');
      } else {
        setError(err instanceof Error ? err.message : '保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  // ---------- 新建用户 ----------
  const openCreate = () => {
    setCreateForm(EMPTY_CREATE_FORM);
    setCreateError(null);
    setCreateOpen(true);
  };
  const closeCreate = () => {
    if (creating) return;
    setCreateOpen(false);
  };
  const submitCreate = async () => {
    setCreateError(null);
    if (!createForm.email || !createForm.username || !createForm.password || !createForm.role) {
      setCreateError('请填写 email、username、password、role 全部必填项');
      return;
    }
    if (createForm.password.length < 6) {
      setCreateError('密码至少 6 位');
      return;
    }
    if (createForm.username.length < 2 || createForm.username.length > 32) {
      setCreateError('用户名需为 2-32 字符');
      return;
    }
    setCreating(true);
    try {
      const res = await api.createUser(createForm);
      // 新建后插入到列表头部，便于直接看到
      setUsers((prev) => [res.user, ...prev]);
      setCreateOpen(false);
    } catch (err) {
      if (err instanceof PanelApiError) {
        if (err.code === 'USER_ALREADY_EXISTS') setCreateError('邮箱已被注册');
        else if (err.code === 'PANEL_VALIDATION_ERROR') setCreateError(err.message);
        else if (err.code === 'PANEL_FORBIDDEN') setCreateError('无权限创建用户');
        else setCreateError(err.message);
      } else {
        setCreateError(err instanceof Error ? err.message : '创建用户失败');
      }
    } finally {
      setCreating(false);
    }
  };

  // ---------- 软删除 ----------
  const confirmDelete = (id: string) => setDeletingId(id);
  const cancelDelete = () => {
    if (deleteBusy) return;
    setDeletingId(null);
  };
  const submitDelete = async () => {
    if (!deletingId) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await api.deleteUser(deletingId);
      // 后端软删除：本地乐观更新为 status='deleted'
      setUsers((prev) =>
        prev.map((u) => (u.id === deletingId ? { ...u, status: 'deleted' as const } : u)),
      );
      setDeletingId(null);
    } catch (err) {
      if (err instanceof PanelApiError) {
        if (err.code === 'PANEL_VALIDATION_ERROR') setError(err.message);
        else if (err.code === 'PANEL_FORBIDDEN') setError('无权限删除用户');
        else if (err.code === 'USER_NOT_FOUND') {
          setError('用户不存在或已删除');
          // 同步从列表移除
          setUsers((prev) => prev.filter((u) => u.id !== deletingId));
          setDeletingId(null);
        } else setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : '删除用户失败');
      }
    } finally {
      setDeleteBusy(false);
    }
  };

  // ---------- v4.24.0: 批量选择辅助 ----------
  /** 当前行是否可选：已删除不可选、系统内置不可选、自己不可选 */
  const isSelectable = useCallback(
    (u: AdminUserSummary): boolean => {
      if (u.status === 'deleted') return false;
      if (u.is_built_in === 1) return false;
      if (u.id === user?.id) return false;
      return true;
    },
    [user?.id],
  );

  /** 当前过滤后的可选行 ID 列表 */
  const selectableFilteredIds = useMemo(
    () => filtered.filter(isSelectable).map((u) => u.id),
    [filtered, isSelectable],
  );

  const allFilteredSelected =
    selectableFilteredIds.length > 0 &&
    selectableFilteredIds.every((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      // 取消当前过滤结果的所有选择
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of selectableFilteredIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of selectableFilteredIds) next.add(id);
        return next;
      });
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // ---------- v4.24.0: 批量操作执行 ----------
  const runBatch = async (action: BatchUserAction, role?: UserRole) => {
    if (selectedIds.size === 0) return;
    setBatchBusy(true);
    setError(null);
    try {
      const res = await api.batchOperateUsers({
        user_ids: Array.from(selectedIds),
        action,
        role,
      });
      setBatchResult(res);
      setSelectedIds(new Set());
      setBatchDeleteConfirm(false);
      setBatchRoleConfirm(false);
      // 刷新列表（用户分析已迁移至平台总览页，由其自行刷新）
      await refresh();
    } catch (err) {
      if (err instanceof PanelApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : '批量操作失败');
      }
    } finally {
      setBatchBusy(false);
    }
  };

  const closeBatchResult = () => {
    setBatchResult(null);
  };

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  const isServerAdmin = getEffectiveRole(user) === 'server_admin';
  const selectedCount = selectedIds.size;
  const overLimit = selectedCount > BATCH_LIMIT;

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">用户管理</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
          {isServerAdmin && (
            <button className="btn btn-primary" onClick={openCreate}>
              新建用户
            </button>
          )}
        </div>
      </div>

      <div className="info-card">
        <h3 className="card-title">三级权限：权责对齐</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>角色</th>
                <th>标识</th>
                <th>权责</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>系统管理员</td>
                <td>
                  <code>server_admin</code>
                </td>
                <td>管理所有用户、所有实例、所有配置、权限分配</td>
              </tr>
              <tr>
                <td>实例管理员</td>
                <td>
                  <code>instance_admin</code>
                </td>
                <td>管理被授权的实例的玩家、商店、订单、配置</td>
              </tr>
              <tr>
                <td>普通用户</td>
                <td>
                  <code>user</code>
                </td>
                <td>进入商城下单、使用 CDK、参与投票、绑定实例</td>
              </tr>
            </tbody>
          </table>
        </div>
        <h3 className="card-title" style={{ marginTop: 16 }}>
          角色判断逻辑
        </h3>
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
          <li>
            仅 <code>server_admin</code> 可访问系统管理菜单并执行创建/删除用户
          </li>
          <li>
            <code>instance_admin</code> 可访问被授权实例的管理操作
          </li>
          <li>普通用户仅可访问个人设置与个人功能</li>
        </ul>
      </div>

      <div className="toolbar">
        <input
          type="text"
          placeholder="按 email / 用户名搜索（回车提交）"
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submitSearch();
            }
          }}
          className="toolbar-search"
        />
        <button
          className="btn btn-ghost btn-sm"
          onClick={submitSearch}
          disabled={loading}
          title="服务端关键字搜索"
        >
          搜索
        </button>
        {serverKeyword && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setKeywordInput('');
              setServerKeyword('');
              setPage(1);
              setSelectedIds(new Set());
            }}
            disabled={loading}
            title="清除搜索"
          >
            清除
          </button>
        )}
        <div className="toolbar-right">
          <span className="muted">共 {total} 条</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(parseInt(e.target.value, 10) || DEFAULT_PAGE_SIZE)}
            disabled={loading}
            title="每页条数"
            style={{ marginLeft: 8 }}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} 条/页
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ===== v4.24.0: 批量操作工具栏 ===== */}
      {selectedCount > 0 && (
        <div className="batch-toolbar">
          <span className="batch-toolbar-count">
            已选 {selectedCount} 项
            {overLimit && (
              <span className="batch-toolbar-warn">（单次上限 {BATCH_LIMIT} 项，请取消部分选择）</span>
            )}
          </span>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => void runBatch('enable')}
            disabled={batchBusy || overLimit}
            title="批量启用所选用户"
          >
            批量启用
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void runBatch('disable')}
            disabled={batchBusy || overLimit}
            title="批量禁用所选用户"
          >
            批量禁用
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setBatchRoleConfirm(true)}
            disabled={batchBusy || overLimit}
            title="批量修改所选用户角色"
          >
            批量改角色
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => setBatchDeleteConfirm(true)}
            disabled={batchBusy || overLimit}
            title="批量软删除所选用户"
          >
            批量删除
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={clearSelection}
            disabled={batchBusy}
          >
            取消选择
          </button>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <ListSkeleton rows={6} columns={6} />
      ) : filtered.length === 0 ? (
        <div className="empty-state">没有匹配的用户。</div>
      ) : (
        <>
        <div className="desktop-only">
        {(() => {
          // v4.36.0-B5: 桌面表格迁移 VirtualTable（与 AuditLogs 对齐，行高动态测量）
          const columns: VirtualColumn<AdminUserSummary>[] = [
            {
              key: 'select',
              header: (
                <input
                  type="checkbox"
                  aria-label="全选当前过滤结果"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAll}
                  disabled={selectableFilteredIds.length === 0}
                />
              ),
              width: '44px',
              render: (u) => {
                const isDeleted = u.status === 'deleted';
                const selectable = isSelectable(u);
                return (
                  <input
                    type="checkbox"
                    aria-label={`选择用户 ${u.username}`}
                    checked={selectedIds.has(u.id)}
                    onChange={() => toggleSelectOne(u.id)}
                    disabled={!selectable}
                    title={
                      u.id === user?.id
                        ? '不能选择自己'
                        : u.is_built_in === 1
                          ? '系统内置账号不可批量操作'
                          : isDeleted
                            ? '已删除用户不可选'
                            : undefined
                    }
                  />
                );
              },
            },
            {
              key: 'email',
              header: 'Email',
              width: '1.6fr',
              render: (u) => (
                <>
                  {u.email}
                  {/* v4.0.2: 演示账号（系统内置）展示 🔒 标识 */}
                  {u.is_built_in === 1 && (
                    <span
                      className="badge badge-built-in"
                      title="系统内置账号，密码不可修改（演示场景）"
                      style={{ marginLeft: 8 }}
                    >
                      🔒 系统内置
                    </span>
                  )}
                </>
              ),
            },
            { key: 'username', header: '用户名', width: '1fr', render: (u) => u.username },
            {
              key: 'role',
              header: '角色',
              width: '1.3fr',
              render: (u) => {
                const isEditing = editingId === u.id;
                return isEditing ? (
                  <select
                    value={draft.role ?? u.role}
                    onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value as UserRole }))}
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}（{r}）
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="badge" title={u.role}>
                    {ROLE_LABEL[u.role] ?? u.role}
                  </span>
                );
              },
            },
            {
              key: 'status',
              header: '状态',
              width: '0.9fr',
              render: (u) => {
                const isEditing = editingId === u.id;
                const isDeleted = u.status === 'deleted';
                return isEditing ? (
                  <select
                    value={draft.status ?? u.status}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        status: e.target.value as 'active' | 'disabled',
                      }))
                    }
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span
                    className={
                      isDeleted
                        ? 'badge badge-error'
                        : u.status === 'active'
                          ? 'badge badge-running'
                          : 'badge badge-error'
                    }
                  >
                    {u.status}
                  </span>
                );
              },
            },
            {
              key: 'display_name',
              header: '显示名',
              width: '1.1fr',
              render: (u) => {
                const isEditing = editingId === u.id;
                return isEditing ? (
                  <input
                    type="text"
                    value={draft.display_name ?? ''}
                    placeholder="留空表示无"
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, display_name: e.target.value || null }))
                    }
                  />
                ) : (
                  (u.display_name ?? '—')
                );
              },
            },
            {
              key: 'created_at',
              header: '创建时间',
              width: '1.3fr',
              render: (u) => new Date(u.created_at).toLocaleString('zh-CN'),
            },
            {
              key: 'actions',
              header: '操作',
              width: '1.4fr',
              render: (u) => {
                const isEditing = editingId === u.id;
                const isDeleted = u.status === 'deleted';
                return isEditing ? (
                  <>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void handleSave(u.id)}
                      disabled={saving}
                    >
                      保存
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={cancelEdit} disabled={saving}>
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => startEdit(u)}
                      disabled={isDeleted}
                    >
                      编辑
                    </button>
                    {isServerAdmin && !isDeleted && (
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => confirmDelete(u.id)}
                        disabled={u.id === user?.id}
                        title={u.id === user?.id ? '不能删除自己' : '软删除该用户'}
                      >
                        删除
                      </button>
                    )}
                  </>
                );
              },
            },
          ];
          return (
            <VirtualTable<AdminUserSummary>
              columns={columns}
              rows={filtered}
              rowKey={(u) => u.id}
              estimateRowHeight={48}
              maxHeight={640}
              rowClassName={(u) => (u.status === 'deleted' ? 'row-disabled' : '')}
            />
          );
        })()}
        </div>

        {/* 移动端卡片列表（B1.0：复用 MobileCardList 共享组件） */}
        <MobileCardList
          items={filtered}
          keyExtractor={(u) => u.id}
          emptyText="暂无用户"
          renderHeader={(u) => {
            const selectable = isSelectable(u);
            return (
              <>
                <input
                  type="checkbox"
                  aria-label={`选择用户 ${u.username}`}
                  checked={selectedIds.has(u.id)}
                  onChange={() => toggleSelectOne(u.id)}
                  disabled={!selectable}
                  style={{ marginRight: 8 }}
                />
                <span className="mc-item-title">
                  {u.username}
                  {u.is_built_in === 1 && (
                    <span
                      className="badge badge-built-in"
                      title="系统内置账号，密码不可修改（演示场景）"
                      style={{ marginLeft: 8 }}
                    >
                      🔒 系统内置
                    </span>
                  )}
                </span>
                <span className="mc-item-badge">
                  <span className="badge" title={u.role}>
                    {ROLE_LABEL[u.role] ?? u.role}
                  </span>
                </span>
              </>
            );
          }}
          renderBody={(u) => {
            const isDeleted = u.status === 'deleted';
            return (
              <>
                <div className="mc-row">
                  <span className="mc-label">邮箱</span>
                  <span className="mc-value">{u.email}</span>
                </div>
                <div className="mc-row">
                  <span className="mc-label">状态</span>
                  <span className="mc-value">
                    <span
                      className={
                        isDeleted
                          ? 'badge badge-error'
                          : u.status === 'active'
                            ? 'badge badge-running'
                            : 'badge badge-error'
                      }
                    >
                      {u.status}
                    </span>
                  </span>
                </div>
                <div className="mc-row">
                  <span className="mc-label">显示名</span>
                  <span className="mc-value">{u.display_name ?? '—'}</span>
                </div>
                <div className="mc-row">
                  <span className="mc-label">注册时间</span>
                  <span className="mc-value">{new Date(u.created_at).toLocaleString('zh-CN')}</span>
                </div>
                <div className="mc-row">
                  <span className="mc-label">最后登录</span>
                  <span className="mc-value">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString('zh-CN') : '—'}
                  </span>
                </div>
              </>
            );
          }}
          renderActions={(u) => {
            const isDeleted = u.status === 'deleted';
            return (
              <>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => startEdit(u)}
                  disabled={isDeleted}
                >
                  编辑
                </button>
                {isServerAdmin && !isDeleted && (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => confirmDelete(u.id)}
                    disabled={u.id === user?.id}
                    title={u.id === user?.id ? '不能删除自己' : '软删除该用户'}
                  >
                    删除
                  </button>
                )}
              </>
            );
          }}
        />

        {/* ===== 服务端分页器 ===== */}
        <div
          className="pagination-wrap"
          style={{
            marginTop: 12,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
            disabled={loading}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            第 {page}/{totalPages} 页 · 共 {total} 条
          </span>
        </div>
        </>
      )}

      {/* ===== 新建用户 modal ===== */}
      {createOpen && (
        <div className="modal-mask" onClick={closeCreate}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>新建用户</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeCreate} disabled={creating}>
                ×
              </button>
            </div>
            <div className="modal-body">
              {createError && <div className="alert alert-error">{createError}</div>}
              <div className="form-row">
                <label className="form-field">
                  <span>Email *</span>
                  <input
                    type="email"
                    value={createForm.email}
                    onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="user@example.com"
                    autoComplete="off"
                  />
                </label>
              </div>
              <div className="form-row">
                <label className="form-field">
                  <span>用户名 *</span>
                  <input
                    type="text"
                    value={createForm.username}
                    onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
                    placeholder="2-32 字符"
                  />
                </label>
                <label className="form-field">
                  <span>密码 *</span>
                  <input
                    type="password"
                    value={createForm.password}
                    onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="至少 6 位"
                    autoComplete="new-password"
                  />
                </label>
              </div>
              <div className="form-row">
                <label className="form-field">
                  <span>角色 *</span>
                  <select
                    value={createForm.role}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, role: e.target.value as UserRole }))
                    }
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}（{r}）
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>显示名（可选）</span>
                  <input
                    type="text"
                    value={createForm.display_name ?? ''}
                    onChange={(e) =>
                      setCreateForm((f) => ({
                        ...f,
                        display_name: e.target.value || undefined,
                      }))
                    }
                    placeholder="留空等于 username"
                  />
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={closeCreate} disabled={creating}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void submitCreate()}
                disabled={creating}
              >
                {creating ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 软删除确认 modal ===== */}
      {deletingId && (
        <div className="modal-mask" onClick={cancelDelete}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>确认删除</h3>
            </div>
            <div className="modal-body">
              <p>
                确定要软删除该用户吗？删除后该用户不可登录，关联数据（玩家绑定、钱包等）会保留。
              </p>
              {(() => {
                const target = users.find((u) => u.id === deletingId);
                if (!target) return null;
                return (
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.8 }}>
                    <li>Email：{target.email}</li>
                    <li>用户名：{target.username}</li>
                    <li>角色：{ROLE_LABEL[target.role] ?? target.role}</li>
                  </ul>
                );
              })()}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={cancelDelete} disabled={deleteBusy}>
                取消
              </button>
              <button
                className="btn btn-danger"
                onClick={() => void submitDelete()}
                disabled={deleteBusy}
              >
                {deleteBusy ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== v4.24.0: 批量删除确认 modal ===== */}
      {batchDeleteConfirm && (
        <div className="modal-mask" onClick={() => !batchBusy && setBatchDeleteConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>确认批量删除</h3>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setBatchDeleteConfirm(false)}
                disabled={batchBusy}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <p>
                将软删除 <strong>{selectedCount}</strong> 个用户。删除后这些用户不可登录，
                关联数据（玩家绑定、钱包等）会保留。此操作不可一键恢复。
              </p>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.8 }}>
                {Array.from(selectedIds)
                  .slice(0, 5)
                  .map((id) => {
                    const t = users.find((u) => u.id === id);
                    return (
                      <li key={id}>
                        {t ? `${t.username} (${t.email})` : id}
                      </li>
                    );
                  })}
                {selectedCount > 5 && <li>…等 {selectedCount - 5} 个用户</li>}
              </ul>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-ghost"
                onClick={() => setBatchDeleteConfirm(false)}
                disabled={batchBusy}
              >
                取消
              </button>
              <button
                className="btn btn-danger"
                onClick={() => void runBatch('delete')}
                disabled={batchBusy}
              >
                {batchBusy ? '删除中…' : '确认批量删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== v4.24.0: 批量改角色确认 modal ===== */}
      {batchRoleConfirm && (
        <div className="modal-mask" onClick={() => !batchBusy && setBatchRoleConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>批量修改角色</h3>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setBatchRoleConfirm(false)}
                disabled={batchBusy}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <p>
                将 <strong>{selectedCount}</strong> 个用户的角色覆盖为以下角色（覆盖式：
                原角色集合将被替换为 [目标角色]）：
              </p>
              <label className="form-field" style={{ marginTop: 8 }}>
                <span>目标角色 *</span>
                <select
                  value={batchRoleValue}
                  onChange={(e) => setBatchRoleValue(e.target.value as UserRole)}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}（{r}）
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-ghost"
                onClick={() => setBatchRoleConfirm(false)}
                disabled={batchBusy}
              >
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void runBatch('set_role', batchRoleValue)}
                disabled={batchBusy}
              >
                {batchBusy ? '应用中…' : '确认应用'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== v4.24.0: 批量操作结果 modal ===== */}
      {batchResult && (
        <div className="modal-mask" onClick={closeBatchResult}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>批量操作结果</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeBatchResult}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p>
                共 <strong>{batchResult.total}</strong> 项 · 成功{' '}
                <strong style={{ color: '#34C759' }}>{batchResult.succeeded}</strong> · 失败{' '}
                <strong style={{ color: batchResult.failed > 0 ? '#FF3B30' : '#8E8E93' }}>
                  {batchResult.failed}
                </strong>
              </p>
              {batchResult.failed > 0 && (
                <>
                  <p style={{ marginTop: 12, marginBottom: 4 }}>
                    失败明细：
                  </p>
                  <ul className="batch-result-list">
                    {batchResult.results
                      .filter((r) => !r.ok)
                      .map((r) => {
                        const t = users.find((u) => u.id === r.user_id);
                        return (
                          <li key={r.user_id}>
                            <span className="batch-result-user">
                              {t ? `${t.username} (${t.email})` : r.user_id}
                            </span>
                            <span className="batch-result-error">{r.error ?? '未知错误'}</span>
                          </li>
                        );
                      })}
                  </ul>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={closeBatchResult}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
