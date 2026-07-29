// ============================================================================
// Backups — 备份记录管理（仅 admin/system_admin 可见）
// 路径：/admin/backups
// 顶部：服务器选择下拉
// 表格：file_path / size_bytes / created_at / created_by / status / 操作
// 新建按钮 → 模态表单；PATCH status 按钮；删除
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type {
  BackupRecordSummary,
  BackupStatus,
  CreateBackupRequest,
  ServerSummary,
  UpdateBackupRequest,
} from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { getEffectiveRole, isAdminRole } from '../../utils/role';

const STATUS_OPTIONS: BackupStatus[] = ['in_progress', 'completed', 'failed', 'deleted'];

function statusBadgeClass(status: BackupStatus): string {
  switch (status) {
    case 'completed':
      return 'badge badge-running';
    case 'in_progress':
      return 'badge';
    case 'failed':
      return 'badge badge-error';
    case 'deleted':
      return 'badge badge-stopped';
  }
}

interface FormState {
  file_path: string;
  size_bytes: string;
}

const EMPTY_FORM: FormState = {
  file_path: '',
  size_bytes: '0',
};

export default function Backups() {
  const { api, user } = useAuth();

  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [serverId, setServerId] = useState('');
  const [serversLoading, setServersLoading] = useState(true);

  const [backups, setBackups] = useState<BackupRecordSummary[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  // D12: 删除二次确认——需输入 DELETE 确认文字
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [confirmText, setConfirmText] = useState('');

  // 加载服务器列表
  useEffect(() => {
    let cancelled = false;
    setServersLoading(true);
    api
      .listServers()
      .then((res) => {
        if (cancelled) return;
        setServers(res.servers);
        if (res.servers.length > 0) {
          setServerId(res.servers[0].id);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载服务器列表失败');
        }
      })
      .finally(() => {
        if (!cancelled) setServersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const loadBackups = useCallback(
    async (id: string) => {
      setDataLoading(true);
      setError(null);
      try {
        const res = await api.listBackups(id);
        setBackups(res.backups);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载备份列表失败');
        setBackups([]);
      } finally {
        setDataLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!serverId) {
      setBackups([]);
      return;
    }
    void loadBackups(serverId);
  }, [serverId, loadBackups]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    resetForm();
  };

  const handleSubmit = async () => {
    if (!serverId) return;
    setError(null);
    const filePath = form.file_path.trim();
    if (!filePath) {
      setError('请填写文件路径');
      return;
    }
    const sizeNum = Number(form.size_bytes);
    if (!Number.isInteger(sizeNum) || sizeNum < 0) {
      setError('文件大小需为非负整数');
      return;
    }

    setSaving(true);
    try {
      const req: CreateBackupRequest = {
        file_path: filePath,
        size_bytes: sizeNum,
      };
      const res = await api.createBackup(serverId, req);
      setBackups((prev) =>
        [res.backup, ...prev].sort((a, b) => b.created_at.localeCompare(a.created_at)),
      );
      closeForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (b: BackupRecordSummary, newStatus: BackupStatus) => {
    if (!serverId) return;
    if (newStatus === b.status) return;
    setError(null);
    setUpdatingId(b.id);
    // 乐观更新
    setBackups((prev) => prev.map((x) => (x.id === b.id ? { ...x, status: newStatus } : x)));
    try {
      const req: UpdateBackupRequest = { status: newStatus };
      const res = await api.updateBackup(serverId, b.id, req);
      setBackups((prev) => prev.map((x) => (x.id === b.id ? res.backup : x)));
    } catch (err) {
      // 回滚
      setBackups((prev) => prev.map((x) => (x.id === b.id ? { ...x, status: b.status } : x)));
      setError(err instanceof Error ? err.message : '更新状态失败');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = (id: number) => {
    if (!serverId) return;
    // D12: 打开二次确认弹窗，需输入 DELETE 确认
    setConfirmDeleteId(id);
    setConfirmText('');
    setError(null);
  };

  const executeDelete = async () => {
    if (confirmDeleteId === null) return;
    if (!serverId) return;
    if (confirmText.trim() !== 'DELETE') {
      setError('请输入 DELETE 以确认删除');
      return;
    }
    setError(null);
    try {
      await api.deleteBackup(serverId, confirmDeleteId);
      setBackups((prev) => prev.filter((b) => b.id !== confirmDeleteId));
      setConfirmDeleteId(null);
      setConfirmText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  const cancelDelete = () => {
    setConfirmDeleteId(null);
    setConfirmText('');
  };

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">备份管理</h2>
        <div className="page-actions">
          <button
            className="btn btn-ghost"
            onClick={() => serverId && void loadBackups(serverId)}
            disabled={dataLoading || !serverId}
          >
            刷新
          </button>
          <button
            className="btn btn-primary"
            onClick={openCreate}
            disabled={dataLoading || !serverId || showForm}
          >
            + 新建
          </button>
        </div>
      </div>

      <div className="form-row">
        <label className="form-field">
          <span className="form-label">服务器</span>
          <select
            value={serverId}
            onChange={(e) => setServerId(e.target.value)}
            disabled={serversLoading}
          >
            {servers.length === 0 && <option value="">暂无服务器</option>}
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.id})
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {showForm && (
        <form
          className="form-card"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <h3 className="card-title">新建备份记录</h3>
          <div className="form-row">
            <label className="form-field">
              <span className="form-label">文件路径 *</span>
              <input
                type="text"
                value={form.file_path}
                onChange={(e) => setForm((f) => ({ ...f, file_path: e.target.value }))}
                placeholder="例如：/backups/server-20260702.zip"
                required
              />
            </label>
            <label className="form-field">
              <span className="form-label">文件大小（字节）</span>
              <input
                type="number"
                min={0}
                value={form.size_bytes}
                onChange={(e) => setForm((f) => ({ ...f, size_bytes: e.target.value }))}
              />
            </label>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={closeForm} disabled={saving}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      )}

      {!serverId ? (
        <div className="empty-state">请先选择服务器。</div>
      ) : dataLoading ? (
        <div className="empty-state">加载中…</div>
      ) : backups.length === 0 ? (
        <div className="empty-state">暂无备份记录。</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>文件路径</th>
                <th>大小(字节)</th>
                <th>创建时间</th>
                <th>创建者</th>
                <th>状态</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id}>
                  <td>{b.id}</td>
                  <td className="mono">{b.file_path}</td>
                  <td>{b.size_bytes}</td>
                  <td>{new Date(b.created_at).toLocaleString('zh-CN')}</td>
                  <td className="mono">{b.created_by}</td>
                  <td>
                    <select
                      value={b.status}
                      onChange={(e) => void handleStatusChange(b, e.target.value as BackupStatus)}
                      disabled={showForm || updatingId === b.id}
                      className="inline-select"
                    >
                      {STATUS_OPTIONS.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                    <span className={statusBadgeClass(b.status)} style={{ marginLeft: 8 }}>
                      {b.status}
                    </span>
                  </td>
                  <td className="col-actions">
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => void handleDelete(b.id)}
                      disabled={showForm || updatingId === b.id}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmDeleteId !== null && (
        <form
          className="form-card"
          onSubmit={(e) => {
            e.preventDefault();
            void executeDelete();
          }}
        >
          <h3 className="card-title">确认删除备份 #{confirmDeleteId}</h3>
          <div className="alert alert-error">
            此操作不可撤销。请输入 <strong>DELETE</strong> 以确认删除备份 #{confirmDeleteId}。
          </div>
          <div className="form-row">
            <label className="form-field">
              <span className="form-label">确认文字</span>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                autoFocus
              />
            </label>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={cancelDelete}>
              取消
            </button>
            <button
              type="submit"
              className="btn btn-danger"
              disabled={confirmText.trim() !== 'DELETE'}
            >
              确认删除
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
