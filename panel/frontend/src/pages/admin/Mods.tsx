// ============================================================================
// Mods — Mod 记录管理（仅 admin/system_admin 可见）
// 路径：/admin/mods
// 顶部：服务器选择下拉
// 表格：mod_name / version / enabled / source_url / installed_at / 操作
// 新建按钮 → 模态表单；行内切换 enabled（PATCH）；编辑 source_url；删除
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type {
  CreateModRequest,
  ModRecordSummary,
  ServerSummary,
  UpdateModRequest,
} from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { getEffectiveRole, isAdminRole } from '../../utils/role';
import { useConfirm } from '../../context/ConfirmContext';

interface FormState {
  mod_name: string;
  version: string;
  enabled: boolean;
  source_url: string;
}

const EMPTY_FORM: FormState = {
  mod_name: '',
  version: '',
  enabled: true,
  source_url: '',
};

export default function Mods() {
  const { api, user } = useAuth();
  const { confirm } = useConfirm();

  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [serverId, setServerId] = useState('');
  const [serversLoading, setServersLoading] = useState(true);

  const [mods, setMods] = useState<ModRecordSummary[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
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

  const loadMods = useCallback(
    async (id: string) => {
      setDataLoading(true);
      setError(null);
      try {
        const res = await api.listMods(id);
        setMods(res.mods);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载 Mod 列表失败');
        setMods([]);
      } finally {
        setDataLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!serverId) {
      setMods([]);
      return;
    }
    void loadMods(serverId);
  }, [serverId, loadMods]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (m: ModRecordSummary) => {
    setEditingId(m.id);
    setForm({
      mod_name: m.mod_name,
      version: m.version,
      enabled: m.enabled,
      source_url: m.source_url ?? '',
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    resetForm();
  };

  const handleSubmit = async () => {
    if (!serverId) return;
    setError(null);
    const modName = form.mod_name.trim();
    if (!modName) {
      setError('请填写 mod 名称');
      return;
    }
    const version = form.version.trim();
    if (!version) {
      setError('请填写版本号');
      return;
    }

    setSaving(true);
    try {
      if (editingId === null) {
        const req: CreateModRequest = {
          mod_name: modName,
          version,
          enabled: form.enabled,
          source_url: form.source_url.trim() || null,
        };
        const res = await api.createMod(serverId, req);
        setMods((prev) =>
          [res.mod, ...prev].sort((a, b) => b.created_at.localeCompare(a.created_at)),
        );
      } else {
        const req: UpdateModRequest = {
          enabled: form.enabled,
          source_url: form.source_url.trim() || null,
        };
        const res = await api.updateMod(serverId, editingId, req);
        setMods((prev) => prev.map((m) => (m.id === editingId ? res.mod : m)));
      }
      closeForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!serverId) return;
    const ok = await confirm({
      title: '删除 Mod',
      message: `确认删除 Mod #${id}？此操作不可撤销。`,
      confirmText: '确认删除',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api.deleteMod(serverId, id);
      setMods((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  // 行内切换 enabled
  const toggleEnabled = async (m: ModRecordSummary) => {
    if (!serverId) return;
    setError(null);
    const newVal = !m.enabled;
    // 乐观更新
    setMods((prev) => prev.map((x) => (x.id === m.id ? { ...x, enabled: newVal } : x)));
    try {
      await api.updateMod(serverId, m.id, { enabled: newVal });
    } catch (err) {
      // 回滚
      setMods((prev) => prev.map((x) => (x.id === m.id ? { ...x, enabled: m.enabled } : x)));
      setError(err instanceof Error ? err.message : '更新失败');
    }
  };

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Mod 管理</h2>
        <div className="page-actions">
          <button
            className="btn btn-ghost"
            onClick={() => serverId && void loadMods(serverId)}
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
          <h3 className="card-title">
            {editingId === null ? '新建 Mod 记录' : `编辑 Mod #${editingId}`}
          </h3>
          <div className="form-row">
            <label className="form-field">
              <span className="form-label">Mod 名称 *</span>
              <input
                type="text"
                value={form.mod_name}
                onChange={(e) => setForm((f) => ({ ...f, mod_name: e.target.value }))}
                disabled={editingId !== null}
                placeholder="例如：krastorio2"
                required
              />
            </label>
            <label className="form-field">
              <span className="form-label">版本 *</span>
              <input
                type="text"
                value={form.version}
                onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
                disabled={editingId !== null}
                placeholder="例如：1.3.18"
                required
              />
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span className="form-label">来源 URL</span>
              <input
                type="text"
                value={form.source_url}
                onChange={(e) => setForm((f) => ({ ...f, source_url: e.target.value }))}
                placeholder="留空表示无"
              />
            </label>
            <label className="form-checkbox-label">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              />
              <span className="checkbox-label-text">启用</span>
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
      ) : mods.length === 0 ? (
        <div className="empty-state">暂无 Mod 记录。</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Mod 名称</th>
                <th>版本</th>
                <th>启用</th>
                <th>来源 URL</th>
                <th>安装时间</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {mods.map((m) => (
                <tr key={m.id}>
                  <td>{m.id}</td>
                  <td className="mono">{m.mod_name}</td>
                  <td>{m.version}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={m.enabled}
                      onChange={() => void toggleEnabled(m)}
                      disabled={showForm}
                    />
                  </td>
                  <td className="mono">{m.source_url ?? '—'}</td>
                  <td>{m.installed_at ? new Date(m.installed_at).toLocaleString('zh-CN') : '—'}</td>
                  <td className="col-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => openEdit(m)}
                      disabled={showForm}
                    >
                      编辑
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => void handleDelete(m.id)}
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
