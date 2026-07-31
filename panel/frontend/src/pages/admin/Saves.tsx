// ============================================================================
// Saves — 存档记录管理（仅 admin/system_admin 可见）
// 路径：/admin/saves
// 顶部：服务器选择下拉
// 表格：save_name / file_path / size_bytes / modified_at / is_active / 操作
// 新建按钮 → 模态表单；activate 按钮（仅非 active）；删除
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type {
  CreateSaveRequest,
  SaveRecordSummary,
  ServerSummary,
} from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { getEffectiveRole, isAdminRole } from '../../utils/role';
import { useConfirm } from '../../context/ConfirmContext';

interface FormState {
  save_name: string;
  file_path: string;
  size_bytes: string;
  modified_at: string;
  is_active: boolean;
}

function nowLocalInputValue(): string {
  // 返回 datetime-local 可用的 YYYY-MM-DDTHH:mm 格式
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EMPTY_FORM: FormState = {
  save_name: '',
  file_path: '',
  size_bytes: '0',
  modified_at: nowLocalInputValue(),
  is_active: false,
};

export default function Saves() {
  const { api, user } = useAuth();
  const { confirm } = useConfirm();

  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [serverId, setServerId] = useState('');
  const [serversLoading, setServersLoading] = useState(true);

  const [saves, setSaves] = useState<SaveRecordSummary[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

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

  const loadSaves = useCallback(
    async (id: string) => {
      setDataLoading(true);
      setError(null);
      try {
        const res = await api.listSaves(id);
        setSaves(res.saves);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载存档列表失败');
        setSaves([]);
      } finally {
        setDataLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!serverId) {
      setSaves([]);
      return;
    }
    void loadSaves(serverId);
  }, [serverId, loadSaves]);

  const resetForm = () => {
    setForm({ ...EMPTY_FORM, modified_at: nowLocalInputValue() });
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
    const saveName = form.save_name.trim();
    if (!saveName) {
      setError('请填写存档名称');
      return;
    }
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
    // datetime-local → ISO 字符串
    const modifiedIso = new Date(form.modified_at).toISOString();

    setSaving(true);
    try {
      const req: CreateSaveRequest = {
        save_name: saveName,
        file_path: filePath,
        size_bytes: sizeNum,
        modified_at: modifiedIso,
        is_active: form.is_active,
      };
      const res = await api.createSave(serverId, req);
      setSaves((prev) => {
        // 若新建为 active，需将其他记录 is_active 置 false（与后端行为一致）
        const next = form.is_active ? prev.map((s) => ({ ...s, is_active: false })) : prev;
        return [res.save, ...next].sort((a, b) => b.modified_at.localeCompare(a.modified_at));
      });
      closeForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (id: number) => {
    if (!serverId) return;
    const ok = await confirm({
      title: '激活存档',
      message: `确认激活存档 #${id}？同服务器仅一个激活存档。`,
      confirmText: '确认激活',
      danger: false,
    });
    if (!ok) return;
    setError(null);
    try {
      const res = await api.activateSave(serverId, id);
      setSaves((prev) =>
        prev
          .map((s) => ({
            ...s,
            is_active: s.id === id ? true : false,
          }))
          .map((s) => (s.id === id ? res.save : s)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '激活失败');
    }
  };

  const handleDelete = async (id: number) => {
    if (!serverId) return;
    const ok = await confirm({
      title: '删除存档',
      message: `确认删除存档 #${id}？此操作不可撤销。`,
      confirmText: '确认删除',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api.deleteSave(serverId, id);
      setSaves((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">存档管理</h2>
        <div className="page-actions">
          <button
            className="btn btn-ghost"
            onClick={() => serverId && void loadSaves(serverId)}
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
          <h3 className="card-title">新建存档记录</h3>
          <div className="form-row">
            <label className="form-field">
              <span className="form-label">存档名称 *</span>
              <input
                type="text"
                value={form.save_name}
                onChange={(e) => setForm((f) => ({ ...f, save_name: e.target.value }))}
                placeholder="例如：_autosave1"
                required
              />
            </label>
            <label className="form-field">
              <span className="form-label">文件路径 *</span>
              <input
                type="text"
                value={form.file_path}
                onChange={(e) => setForm((f) => ({ ...f, file_path: e.target.value }))}
                placeholder="例如：/saves/_autosave1.zip"
                required
              />
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span className="form-label">文件大小（字节）*</span>
              <input
                type="number"
                min={0}
                value={form.size_bytes}
                onChange={(e) => setForm((f) => ({ ...f, size_bytes: e.target.value }))}
              />
            </label>
            <label className="form-field">
              <span className="form-label">修改时间 *</span>
              <input
                type="datetime-local"
                value={form.modified_at}
                onChange={(e) => setForm((f) => ({ ...f, modified_at: e.target.value }))}
              />
            </label>
            <label className="form-checkbox-label">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              />
              <span className="checkbox-label-text">设为激活</span>
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
      ) : saves.length === 0 ? (
        <div className="empty-state">暂无存档记录。</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>存档名称</th>
                <th>文件路径</th>
                <th>大小(字节)</th>
                <th>修改时间</th>
                <th>激活</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {saves.map((s) => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td className="mono">{s.save_name}</td>
                  <td className="mono">{s.file_path}</td>
                  <td>{s.size_bytes}</td>
                  <td>{new Date(s.modified_at).toLocaleString('zh-CN')}</td>
                  <td>
                    <span className={s.is_active ? 'badge badge-running' : 'badge badge-stopped'}>
                      {s.is_active ? '激活' : '—'}
                    </span>
                  </td>
                  <td className="col-actions">
                    {!s.is_active && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => void handleActivate(s.id)}
                        disabled={showForm}
                      >
                        激活
                      </button>
                    )}
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => void handleDelete(s.id)}
                      disabled={showForm}
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
    </div>
  );
}
