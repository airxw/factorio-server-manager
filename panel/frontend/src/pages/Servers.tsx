// ============================================================================
// Servers — 服务器列表
// 四.7: 已迁移到 TanStack Query（useServers + useStartServer/Stop/Delete）
// 8.3: 列表搜索 + 筛选 + 排序 + 分页（客户端处理，URL 状态化）
// 8.5: 搜索/筛选/排序/分页均同步到 URL query（replace 模式避免历史栈污染）
// 8.6: 监听 `focus-search` 自定义事件，按 `/` 聚焦搜索框
// 7.2: 批量操作（启动/停止/删除）+ 选择栏
// 7.3: 批量删除使用 useConfirm 危险确认；删除按钮统一 btn-danger
// 7.4: 单实例删除成功后显示撤销 Toast（best-effort）
// 7.7: 行悬停显示操作按钮（.row-actions）+ 导出 CSV
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Server } from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useUndoToast } from '../hooks/useUndoToast';
import type { InstanceState } from '@public/schema/daemon-api-types';
import type { ServerSummary, MyQuotaResponse } from '@public/schema/panel-api-types';
import { PanelApiError } from '../api/client';
import { useAuth } from '../api/auth';
import { useDeleteServer, useServers, useStartServer, useStopServer } from '../api/queries';
import ConfirmDialog from '../components/ConfirmDialog';
import { EmptyState, ListSkeleton, Pagination, useConfirm, useToast } from '../components/ui';
import { formatBytes } from '../utils/formatBytes';
import { getEffectiveRole, isAdminRole, isInstanceAdminOrAbove } from '../utils/role';

const STATE_LABEL: Record<InstanceState, string> = {
  stopped: '已停止',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中',
  error: '错误',
};

function stateClass(state: InstanceState): string {
  return `badge badge-${state}`;
}

// v3-billing: 有效期展示辅助（列表页紧凑版）——返回 { text, color }
// permanent/cleaned=灰；expired=红；grace=橙；active=到期日期，≤3天用橙
function getExpiryDisplay(
  expiresAt: string | null,
  expiryStatus: ServerSummary['expiry_status'],
): { text: string; color?: string } {
  if (expiryStatus === 'permanent' || expiresAt === null) {
    return { text: '永久', color: 'var(--color-text-muted)' };
  }
  if (expiryStatus === 'cleaned') {
    return { text: '已清理', color: 'var(--color-text-muted)' };
  }
  if (expiryStatus === 'expired') {
    return { text: '已过期', color: 'var(--color-danger)' };
  }
  if (expiryStatus === 'grace') {
    return { text: '宽限期', color: 'var(--color-warning)' };
  }
  // active：显示到期日期，临近到期（≤3天）用橙色
  const expiryDate = new Date(expiresAt);
  const daysLeft = Math.ceil((expiryDate.getTime() - Date.now()) / 86400000);
  const text = expiryDate.toLocaleDateString('zh-CN');
  if (daysLeft <= 3) {
    return { text, color: 'var(--color-warning)' };
  }
  return { text };
}

// 8.3: 每页条数
const PAGE_SIZE = 20;

// 8.3: 可排序字段
type SortField = 'name' | 'status' | 'created_at';
type SortOrder = 'asc' | 'desc';

const SORT_LABEL: Record<SortField, string> = {
  name: '名称',
  status: '状态',
  created_at: '创建时间',
};

// 8.3: 状态筛选选项
const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部状态' },
  { value: 'running', label: '运行中' },
  { value: 'stopped', label: '已停止' },
  { value: 'error', label: '错误' },
];

export default function Servers() {
  const navigate = useNavigate();
  const { user, api } = useAuth();
  useDocumentTitle('实例列表');

  // v4.5.0: 三角色差异化视图——纯 user 角色隐藏归属/复选框/批量操作
  // 以 active_role 会话身份为准（防御性兼容 system_admin/admin 别名）
  const effectiveRole = getEffectiveRole(user);
  const isServerAdmin = isAdminRole(effectiveRole);
  const isInstanceAdminOrHigher = isInstanceAdminOrAbove(effectiveRole);
  const isUser = !isInstanceAdminOrHigher;

  // 8.5: URL 状态化——所有筛选/排序/分页状态同步到 URL query
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const statusFilter = searchParams.get('status') ?? '';
  const sortField = (searchParams.get('sort') ?? 'created_at') as SortField;
  const sortOrder = (searchParams.get('order') ?? 'desc') as SortOrder;
  const pageParam = parseInt(searchParams.get('page') ?? '1', 10);
  const page = Number.isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;

  // 8.6: 搜索框 ref，监听 `focus-search` 事件聚焦
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // 四.7: 列表查询（替代 useEffect+useState 手拉模式）
  const { data, isLoading, error, refetch } = useServers();
  const servers: ServerSummary[] = data?.servers ?? [];

  // 生命周期 mutation（乐观更新由 hook 内部处理）
  const startMutation = useStartServer();
  const stopMutation = useStopServer();
  const deleteMutation = useDeleteServer();

  // 7.2/7.3/7.4: 批量操作 + 全局反馈 + 撤销 Toast
  const toast = useToast();
  const { confirm } = useConfirm();
  const { showUndo, undoToastElement } = useUndoToast();

  const [actioningId, setActioningId] = useState<string | null>(null);
  // 7.2: 批量选择——临时状态，不持久化到 URL
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchActioning, setBatchActioning] = useState(false);

  // D12: 删除二次确认——需输入实例名称确认
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  // v4.6.0-E3: 配额展示（仅 instance_admin / user 角色，server_admin 无配额限制）
  const [quota, setQuota] = useState<MyQuotaResponse | null>(null);

  // 合并查询错误与本地操作错误
  const displayError = localError ?? (error ? (error as Error).message : null);

  // 8.3: 客户端过滤（搜索 + 状态筛选）
  const filteredServers = useMemo(() => {
    let result = servers;
    if (q.trim()) {
      const query = q.trim().toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(query) || s.id.toLowerCase().includes(query),
      );
    }
    if (statusFilter) {
      result = result.filter((s) => s.status === statusFilter);
    }
    return result;
  }, [servers, q, statusFilter]);

  // 8.3: 客户端排序
  const sortedServers = useMemo(() => {
    const arr = [...filteredServers];
    const dir = sortOrder === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name, 'zh-CN');
      } else if (sortField === 'status') {
        cmp = a.status.localeCompare(b.status);
      } else if (sortField === 'created_at') {
        cmp = a.created_at.localeCompare(b.created_at);
      }
      return cmp * dir;
    });
    return arr;
  }, [filteredServers, sortField, sortOrder]);

  // 8.3: 客户端分页
  const totalPages = Math.max(1, Math.ceil(sortedServers.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedServers = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return sortedServers.slice(start, start + PAGE_SIZE);
  }, [sortedServers, safePage]);

  // 8.6: 监听 `/` 快捷键派发的 focus-search 事件
  useEffect(() => {
    const handler = () => searchInputRef.current?.focus();
    window.addEventListener('focus-search', handler);
    return () => window.removeEventListener('focus-search', handler);
  }, []);

  // v4.6.0-E3: 加载当前用户配额（失败时静默，不影响主列表；server_admin 不加载）
  useEffect(() => {
    if (isServerAdmin) return;
    let cancelled = false;
    api
      .getMyQuota()
      .then((res) => {
        if (!cancelled) setQuota(res);
      })
      .catch(() => {
        // 静默失败
      });
    return () => {
      cancelled = true;
    };
  }, [api, isServerAdmin]);

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
    // 搜索变化时重置页码
    updateParams({ q: value || null, page: null });
  };

  const handleStatusChange = (value: string) => {
    updateParams({ status: value || null, page: null });
  };

  const handleSortToggle = (field: SortField) => {
    if (sortField === field) {
      // 同字段：切换升降序
      updateParams({ order: sortOrder === 'asc' ? 'desc' : 'asc' });
    } else {
      // 新字段：默认降序
      updateParams({ sort: field, order: 'desc' });
    }
  };

  const handlePageChange = (p: number) => {
    updateParams({ page: p === 1 ? null : String(p) });
  };

  const handleStart = async (id: string) => {
    setActioningId(id);
    setLocalError(null);
    try {
      await startMutation.mutateAsync(id);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : '启动失败');
    } finally {
      setActioningId(null);
    }
  };

  const handleStop = async (id: string) => {
    setActioningId(id);
    setLocalError(null);
    try {
      await stopMutation.mutateAsync(id);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : '停止失败');
    } finally {
      setActioningId(null);
    }
  };

  const handleDelete = (id: string) => {
    const server = servers.find((s) => s.id === id);
    if (!server) return;
    setConfirmDeleteId(id);
    setConfirmDeleteName(server.name);
    setLocalError(null);
  };

  const executeDelete = async () => {
    if (!confirmDeleteId) return;
    const deletedId = confirmDeleteId;
    const deletedName = confirmDeleteName;
    setActioningId(confirmDeleteId);
    setLocalError(null);
    try {
      await deleteMutation.mutateAsync(confirmDeleteId);
      setConfirmDeleteId(null);
      setConfirmDeleteName('');
      // 7.4: 删除成功后显示撤销 Toast（best-effort——后端若支持软删除可恢复）
      showUndo(`已删除实例「${deletedName}」`, async () => {
        const result = await refetch();
        const stillExists = (result.data?.servers ?? []).some((s) => s.id === deletedId);
        if (!stillExists) {
          toast.warning('该实例无法恢复（已永久删除）');
        } else {
          toast.success('实例已恢复');
        }
      });
    } catch (err) {
      if (err instanceof PanelApiError && err.code === 'INVALID_SERVER_STATE') {
        setLocalError('仅 stopped 状态可删除');
      } else {
        setLocalError(err instanceof Error ? err.message : '删除失败');
      }
    } finally {
      setActioningId(null);
    }
  };

  // 7.2: 选择辅助
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // 当前页全选 / 取消全选（基于当前分页可见的实例）
  const pagedIds = useMemo(() => pagedServers.map((s) => s.id), [pagedServers]);
  const allPageSelected = pagedIds.length > 0 && pagedIds.every((id) => selectedIds.has(id));
  const somePageSelected = pagedIds.some((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        // 取消当前页全选
        pagedIds.forEach((id) => next.delete(id));
      } else {
        // 选中当前页全部
        pagedIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  // v4.7.0-I2: 批量操作通用辅助——调用 batch API，返回结果汇总（含失败项展开）
  const runBatchAction = async (
    label: string,
    fn: (
      req: import('@public/schema/panel-api-types').BatchActionRequest,
    ) => Promise<import('@public/schema/panel-api-types').BatchActionResponse>,
  ) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const ok = await confirm({
      title: '批量操作确认',
      message: `确定要批量${label} ${ids.length} 个实例吗？`,
      confirmText: '确认',
    });
    if (!ok) return;
    setBatchActioning(true);
    setLocalError(null);
    try {
      const res = await fn({ instance_ids: ids });
      const successCount = res.results.filter((r) => r.success).length;
      const failedCount = res.results.length - successCount;
      if (failedCount === 0) {
        toast.success(`批量${label}完成，共 ${successCount} 个实例`);
      } else {
        const failedDetail = res.results
          .filter((r) => !r.success)
          .map((r) => `${r.instance_id}: ${r.message ?? '未知错误'}`)
          .join('\n');
        toast.error(
          `批量${label}：成功 ${successCount} 个，失败 ${failedCount} 个`,
          failedDetail,
        );
      }
      clearSelection();
      await refetch();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : `批量${label}失败`);
    } finally {
      setBatchActioning(false);
    }
  };

  // v4.7.0-I2: 批量启动（走 batch API）
  const handleBatchStart = () =>
    runBatchAction('启动', (req) => api.batchStart(req));

  // v4.7.0-I2: 批量停止（走 batch API）
  const handleBatchStop = () =>
    runBatchAction('停止', (req) => api.batchStop(req));

  // v4.7.0-I2: 批量重启（走 batch API）
  const handleBatchRestart = () =>
    runBatchAction('重启', (req) => api.batchRestart(req));

  // v4.7.0-I2: 批量备份（走 batch API）
  const handleBatchBackup = () =>
    runBatchAction('备份', (req) => api.batchBackup(req));

  // 7.2 + 7.3: 批量删除——useConfirm 危险确认
  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const ok = await confirm({
      title: '批量删除实例',
      message: `确定删除选中的 ${ids.length} 个实例？此操作不可撤销。`,
      danger: true,
      confirmText: '确认删除',
    });
    if (!ok) return;
    setBatchActioning(true);
    setLocalError(null);
    const results = await Promise.allSettled(ids.map((id) => deleteMutation.mutateAsync(id)));
    const success = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - success;
    if (failed === 0) {
      toast.success(`批量删除完成，共 ${success} 个实例`);
    } else {
      toast.warning(`批量删除：成功 ${success} 个，失败 ${failed} 个`);
    }
    clearSelection();
    setBatchActioning(false);
  };

  // 7.7: 导出当前筛选后的实例列表为 CSV
  const handleExportCsv = () => {
    const rows = sortedServers;
    const header = ['ID', '名称', '游戏', '状态', '游戏端口', 'RCON端口', '归属者', '部署节点', '有效期', '创建时间'];
    const escape = (v: string) => {
      const s = v.replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = [header.join(',')];
    for (const s of rows) {
      lines.push(
        [
          escape(s.id),
          escape(s.name),
          escape(s.game_type),
          escape(STATE_LABEL[s.status] ?? s.status),
          String(s.port),
          String(s.rcon_port),
          escape(s.owner_username ?? ''),
          escape(s.node_name ?? ''),
          escape(getExpiryDisplay(s.expires_at, s.expiry_status).text),
          escape(new Date(s.created_at).toLocaleString('zh-CN')),
        ].join(','),
      );
    }
    // 加 BOM 保证 Excel 正确识别 UTF-8
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `servers-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const cancelDelete = () => {
    setConfirmDeleteId(null);
    setConfirmDeleteName('');
  };

  // 8.3: 排序图标渲染
  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>;
    return (
      <span style={{ marginLeft: 4, fontWeight: 'bold' }}>{sortOrder === 'asc' ? '↑' : '↓'}</span>
    );
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">服务器列表</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refetch()} disabled={isLoading}>
            刷新
          </button>
          <button className="btn btn-primary" onClick={() => navigate('/instances/new')}>
            + 创建服务器
          </button>
        </div>
      </div>

      {displayError && <div className="alert alert-error">{displayError}</div>}

      {/* 8.3: 搜索 + 筛选工具栏 */}
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <input
          ref={searchInputRef}
          type="search"
          className="toolbar-search"
          placeholder="搜索名称或 ID…"
          value={q}
          onChange={(e) => handleSearchChange(e.target.value)}
          aria-label="搜索服务器"
        />
        <select
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value)}
          aria-label="按状态筛选"
          style={{ width: 'auto', minWidth: 120 }}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="form-hint" style={{ marginLeft: 'auto' }}>
          共 {sortedServers.length} 条
        </span>
        {/* 7.7: 导出 CSV */}
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleExportCsv}
          disabled={sortedServers.length === 0}
          aria-label="导出当前列表为 CSV"
        >
          导出 CSV
        </button>
      </div>

      {/* v4.6.0-E3: 配额进度条（仅 instance_admin / user 显示） */}
      {!isServerAdmin && quota && quota.quota && (
        <div className="quota-bar" style={{ display: 'flex', gap: 24, alignItems: 'center', marginBottom: 12, padding: 8, background: 'var(--color-bg-secondary)', borderRadius: 6, flexWrap: 'wrap' }}>
          {quota.quota.max_instances != null && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="form-hint" style={{ margin: 0 }}>实例配额：</span>
              <span className="mono" style={{ fontSize: 13 }}>
                {quota.usage.instances_used} / {quota.quota.max_instances}
              </span>
              <div style={{ width: 200, height: 8, background: 'var(--color-border, #e5e7eb)', borderRadius: 4, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.min(100, (quota.usage.instances_used / quota.quota.max_instances) * 100)}%`,
                    height: '100%',
                    background: quota.can_create_instance === false ? 'var(--color-error, #ef4444)' : 'var(--color-primary, #2563eb)',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            </div>
          )}
          {quota.quota.max_disk_mb != null && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="form-hint" style={{ margin: 0 }}>磁盘配额：</span>
              <span className="mono" style={{ fontSize: 13 }}>
                {quota.usage.disk_used_mb} / {quota.quota.max_disk_mb} MB
              </span>
              <div style={{ width: 200, height: 8, background: 'var(--color-border, #e5e7eb)', borderRadius: 4, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.min(100, (quota.usage.disk_used_mb / quota.quota.max_disk_mb) * 100)}%`,
                    height: '100%',
                    background: quota.can_create_instance === false ? 'var(--color-error, #ef4444)' : 'var(--color-primary, #2563eb)',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            </div>
          )}
          {quota.can_create_instance === false && (
            <span className="badge badge-error">配额已满</span>
          )}
        </div>
      )}

      {isLoading ? (
        <ListSkeleton rows={6} columns={4} />
      ) : sortedServers.length === 0 ? (
        <EmptyState
          icon={servers.length === 0 ? <Server size={48} /> : undefined}
          title={servers.length === 0 ? '还没有服务器' : '没有匹配的结果'}
          description={
            servers.length === 0
              ? '点击「创建服务器」开始。'
              : '没有匹配筛选条件的服务器。'
          }
        />
      ) : (
        <>
          {/* 7.2: 批量操作栏——选中 1+ 项时显示（user 角色无批量操作权限） */}
          {selectedIds.size > 0 && !isUser && (
            <div className="batch-bar" role="region" aria-label="批量操作栏">
              <span className="batch-bar-count">已选 {selectedIds.size} 项</span>
              <div className="batch-bar-actions">
                <button
                  className="btn btn-success btn-sm"
                  onClick={() => void handleBatchStart()}
                  disabled={batchActioning}
                >
                  {batchActioning ? '处理中…' : '批量启动'}
                </button>
                <button
                  className="btn btn-warning btn-sm"
                  onClick={() => void handleBatchStop()}
                  disabled={batchActioning}
                >
                  {batchActioning ? '处理中…' : '批量停止'}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => void handleBatchRestart()}
                  disabled={batchActioning}
                >
                  {batchActioning ? '处理中…' : '批量重启'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => void handleBatchBackup()}
                  disabled={batchActioning}
                >
                  {batchActioning ? '处理中…' : '批量备份'}
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => void handleBatchDelete()}
                  disabled={batchActioning}
                >
                  批量删除
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={clearSelection}
                  disabled={batchActioning}
                  aria-label="清除选择"
                >
                  取消选择
                </button>
              </div>
            </div>
          )}

          {/* 9.3: 桌面端表格（桌面端显示） */}
          <div className="desktop-only">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {/* 7.2: 全选复选框（user 角色隐藏） */}
                  {!isUser && (
                    <th className="col-checkbox">
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = !allPageSelected && somePageSelected;
                        }}
                        onChange={toggleSelectAll}
                        aria-label="全选当前页"
                      />
                    </th>
                  )}
                  <th>
                    <button
                      type="button"
                      onClick={() => handleSortToggle('name')}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        font: 'inherit',
                        color: 'inherit',
                      }}
                      aria-label={`按${SORT_LABEL.name}排序`}
                    >
                      名称
                      {renderSortIcon('name')}
                    </button>
                  </th>
                  <th>游戏</th>
                  <th>
                    <button
                      type="button"
                      onClick={() => handleSortToggle('status')}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        font: 'inherit',
                        color: 'inherit',
                      }}
                      aria-label={`按${SORT_LABEL.status}排序`}
                    >
                      状态
                      {renderSortIcon('status')}
                    </button>
                  </th>
                  <th>游戏端口</th>
                  <th>RCON 端口</th>
                  {!isUser && <th>归属者</th>}
                  <th>部署节点</th>
                  {/* v3.6.1-B1: 磁盘占用列 */}
                  <th>磁盘占用</th>
                  {/* v3-billing: 有效期列 */}
                  <th>有效期</th>
                  <th>
                    <button
                      type="button"
                      onClick={() => handleSortToggle('created_at')}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        font: 'inherit',
                        color: 'inherit',
                      }}
                      aria-label={`按${SORT_LABEL.created_at}排序`}
                    >
                      创建时间
                      {renderSortIcon('created_at')}
                    </button>
                  </th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {pagedServers.map((s) => {
                  const busy = actioningId === s.id;
                  const exp = getExpiryDisplay(s.expires_at, s.expiry_status);
                  return (
                    <tr key={s.id}>
                      {/* 7.2: 行选择复选框（user 角色隐藏） */}
                      {!isUser && (
                        <td className="col-checkbox">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(s.id)}
                            onChange={() => toggleSelect(s.id)}
                            aria-label={`选择实例 ${s.name}`}
                          />
                        </td>
                      )}
                      <td>
                        {/* 五.8: 名称改为 Link，支持键盘 Enter 触发 + focus 样式 */}
                        <Link
                          to={`/instances/${s.id}`}
                          className="cell-name"
                          aria-label={`查看实例 ${s.name} 详情`}
                        >
                          {s.name}
                        </Link>
                      </td>
                      <td>{s.game_type}</td>
                      <td>
                        <span
                          className={stateClass(s.status)}
                          aria-label={`实例状态: ${STATE_LABEL[s.status]}`}
                        >
                          {STATE_LABEL[s.status]}
                        </span>
                      </td>
                      <td>{s.port}</td>
                      <td>{s.rcon_port}</td>
                      {!isUser && <td>{s.owner_username}</td>}
                      <td>{s.node_name ?? '—'}</td>
                      {/* v3.6.1-B1: 磁盘占用列，>10GB 加粗警示 */}
                      <td
                        className="mono"
                        style={
                          s.disk_usage_bytes != null && s.disk_usage_bytes > 10 * 1024 * 1024 * 1024
                            ? { fontWeight: 'bold', color: 'var(--color-warning, #d97706)' }
                            : undefined
                        }
                        title={
                          s.disk_usage_updated_at
                            ? `更新于 ${new Date(s.disk_usage_updated_at).toLocaleString('zh-CN')}`
                            : undefined
                        }
                      >
                        {formatBytes(s.disk_usage_bytes)}
                      </td>
                      {/* v3-billing: 有效期 */}
                      <td style={exp.color ? { color: exp.color } : undefined}>{exp.text}</td>
                      <td className="mono">{new Date(s.created_at).toLocaleDateString('zh-CN')}</td>
                      <td className="col-actions">
                        {/* 7.7: 行悬停显示操作按钮（桌面端），移动端常驻 */}
                        <span className="row-actions">
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => navigate(`/instances/${s.id}`)}
                          >
                            详情
                          </button>
                          <button
                            className="btn btn-success btn-sm"
                            onClick={() => void handleStart(s.id)}
                            disabled={busy || s.status !== 'stopped'}
                          >
                            启动
                          </button>
                          <button
                            className="btn btn-warning btn-sm"
                            onClick={() => void handleStop(s.id)}
                            disabled={busy || (s.status !== 'running' && s.status !== 'starting')}
                          >
                            停止
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => void handleDelete(s.id)}
                            disabled={busy || s.status !== 'stopped'}
                            title={s.status !== 'stopped' ? '需先停止实例才能删除' : '删除实例'}
                          >
                            删除
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>

          {/* 9.3: 移动端卡片列表（移动端显示） */}
          {/* 7.2: 卡片增加复选框；7.7: 移动端操作按钮常驻可见 */}
          <div className="mobile-only server-card-list">
            {pagedServers.map((s) => {
              const busy = actioningId === s.id;
              const exp = getExpiryDisplay(s.expires_at, s.expiry_status);
              return (
                <div key={s.id} className="server-card">
                  <div className="server-card-top">
                    {/* 7.2: 卡片复选框（user 角色隐藏） */}
                    {!isUser && (
                      <input
                        type="checkbox"
                        className="server-card-select"
                        checked={selectedIds.has(s.id)}
                        onChange={() => toggleSelect(s.id)}
                        aria-label={`选择实例 ${s.name}`}
                      />
                    )}
                    <div className="server-card-body">
                      <div className="server-card-header">
                        <Link
                          to={`/instances/${s.id}`}
                          className="server-card-name"
                          aria-label={`查看实例 ${s.name} 详情`}
                        >
                          {s.name}
                        </Link>
                        <span
                          className={stateClass(s.status)}
                          aria-label={`实例状态: ${STATE_LABEL[s.status]}`}
                        >
                          {STATE_LABEL[s.status]}
                        </span>
                      </div>
                      <div className="server-card-meta">
                        <span>游戏：{s.game_type}</span>
                        <span>端口：{s.port}</span>
                        {!isUser && <span>归属：{s.owner_username}</span>}
                        <span>节点：{s.node_name ?? '—'}</span>
                        <span style={exp.color ? { color: exp.color } : undefined}>
                          有效期：{exp.text}
                        </span>
                      </div>
                    </div>
                  </div>
                  {/* 7.7: 移动端操作按钮常驻可见 */}
                  <div className="server-card-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => navigate(`/instances/${s.id}`)}
                    >
                      详情
                    </button>
                    <button
                      className="btn btn-success btn-sm"
                      onClick={() => void handleStart(s.id)}
                      disabled={busy || s.status !== 'stopped'}
                    >
                      启动
                    </button>
                    <button
                      className="btn btn-warning btn-sm"
                      onClick={() => void handleStop(s.id)}
                      disabled={busy || (s.status !== 'running' && s.status !== 'starting')}
                    >
                      停止
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => void handleDelete(s.id)}
                      disabled={busy || s.status !== 'stopped'}
                      title={s.status !== 'stopped' ? '需先停止实例才能删除' : '删除实例'}
                    >
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 8.3: 客户端分页 */}
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
            <Pagination
              page={safePage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              disabled={isLoading}
            />
          </div>
        </>
      )}

      {confirmDeleteId !== null && (
        <ConfirmDialog
          open
          title={`删除服务器「${confirmDeleteName}」`}
          description="此操作不可撤销。请输入服务器名称以确认删除。"
          requireInput={confirmDeleteName}
          confirmLabel="确认删除"
          loading={actioningId === confirmDeleteId}
          onConfirm={() => void executeDelete()}
          onCancel={cancelDelete}
        />
      )}

      {/* 7.4: 撤销 Toast 渲染节点 */}
      {undoToastElement}
    </div>
  );
}
