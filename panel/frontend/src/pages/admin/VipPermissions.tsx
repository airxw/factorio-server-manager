// ============================================================================
// VipPermissions — VIP 权限管理（仅 admin/system_admin 可见）
// 表格展示 VIP 等级权限 + 新建 + 弹窗编辑 + 删除确认
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type {
  CreateVipPermissionRequest,
  UpdateVipPermissionRequest,
  VipPermissionItem,
} from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { getEffectiveRole, isAdminRole } from '../../utils/role';
import { useConfirm } from '../../context/ConfirmContext';

type MaxQuality = VipPermissionItem['max_quality'];
const QUALITY_OPTIONS: MaxQuality[] = ['normal', 'uncommon', 'rare', 'epic', 'legendary'];

function parsePermissions(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export default function VipPermissions() {
  const { api, user } = useAuth();
  const { confirm } = useConfirm();

  const [perms, setPerms] = useState<VipPermissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingLevel, setEditingLevel] = useState<number | null>(null);
  const [form, setForm] = useState<{
    vip_level: string;
    display_name: string;
    permissions: string;
    max_quality: MaxQuality;
    daily_limit: string;
    daily_reward_amount: string;
  }>({
    vip_level: '',
    display_name: '',
    permissions: '',
    max_quality: 'normal',
    daily_limit: '',
    daily_reward_amount: '0',
  });
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listVipPermissions();
      setPerms(res.permissions);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 VIP 权限失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetForm = () => {
    setForm({
      vip_level: '',
      display_name: '',
      permissions: '',
      max_quality: 'normal',
      daily_limit: '',
      daily_reward_amount: '0',
    });
    setEditingLevel(null);
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (p: VipPermissionItem) => {
    setEditingLevel(p.vip_level);
    setForm({
      vip_level: String(p.vip_level),
      display_name: p.display_name,
      permissions: p.permissions.join(', '),
      max_quality: p.max_quality,
      daily_limit: p.daily_limit === null ? '' : String(p.daily_limit),
      daily_reward_amount: String(p.daily_reward_amount ?? 0),
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    resetForm();
  };

  const handleSubmit = async () => {
    setError(null);
    const displayName = form.display_name.trim();
    if (!displayName) {
      setError('请填写显示名');
      return;
    }
    const permissions = parsePermissions(form.permissions);
    const dailyLimitNum = form.daily_limit.trim() === '' ? null : Number(form.daily_limit);
    if (dailyLimitNum !== null && (!Number.isInteger(dailyLimitNum) || dailyLimitNum < 0)) {
      setError('每日上限需为非负整数或留空（表示不限）');
      return;
    }

    setSaving(true);
    try {
      if (editingLevel === null) {
        const levelNum = Number(form.vip_level);
        if (!Number.isInteger(levelNum) || levelNum < 0) {
          setError('VIP 等级需为非负整数');
          setSaving(false);
          return;
        }
        const req: CreateVipPermissionRequest = {
          vip_level: levelNum,
          display_name: displayName,
          permissions,
          max_quality: form.max_quality,
          daily_limit: dailyLimitNum,
          daily_reward_amount: Number(form.daily_reward_amount) || 0,
        };
        const res = await api.createVipPermission(req);
        setPerms((prev) => {
          const filtered = prev.filter((p) => p.vip_level !== res.permission.vip_level);
          return [...filtered, res.permission].sort((a, b) => a.vip_level - b.vip_level);
        });
      } else {
        const req: UpdateVipPermissionRequest = {
          display_name: displayName,
          permissions,
          max_quality: form.max_quality,
          daily_limit: dailyLimitNum,
          daily_reward_amount: Number(form.daily_reward_amount) || 0,
        };
        const res = await api.updateVipPermission(editingLevel, req);
        setPerms((prev) => prev.map((p) => (p.vip_level === editingLevel ? res.permission : p)));
      }
      closeForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (level: number) => {
    const ok = await confirm({
      title: '删除 VIP 等级',
      message: `确认删除 VIP 等级 ${level}？此操作不可撤销。`,
      confirmText: '确认删除',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api.deleteVipPermission(level);
      setPerms((prev) => prev.filter((p) => p.vip_level !== level));
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
        <h2 className="page-title">VIP 权限</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
          <button className="btn btn-primary" onClick={openCreate} disabled={loading || showForm}>
            + 新建等级
          </button>
        </div>
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
            {editingLevel === null ? '新建 VIP 等级' : `编辑 VIP 等级 ${editingLevel}`}
          </h3>
          <div className="form-row">
            <label className="form-field">
              <span className="form-label">VIP 等级 *</span>
              <input
                type="number"
                min={0}
                value={form.vip_level}
                onChange={(e) => setForm((f) => ({ ...f, vip_level: e.target.value }))}
                disabled={editingLevel !== null}
                required={editingLevel === null}
              />
            </label>
            <label className="form-field">
              <span className="form-label">显示名 *</span>
              <input
                type="text"
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                required
              />
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span className="form-label">最大品质</span>
              <select
                value={form.max_quality}
                onChange={(e) =>
                  setForm((f) => ({ ...f, max_quality: e.target.value as MaxQuality }))
                }
              >
                {QUALITY_OPTIONS.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span className="form-label">每日上限（留空=不限）</span>
              <input
                type="number"
                min={0}
                value={form.daily_limit}
                onChange={(e) => setForm((f) => ({ ...f, daily_limit: e.target.value }))}
                placeholder="留空表示不限"
              />
            </label>
            <label className="form-field">
              <span className="form-label">每日点券</span>
              <input
                type="number"
                min={0}
                value={form.daily_reward_amount}
                onChange={(e) => setForm((f) => ({ ...f, daily_reward_amount: e.target.value }))}
              />
            </label>
          </div>
          <label className="form-field">
            <span className="form-label">权限标识（逗号分隔）</span>
            <input
              type="text"
              value={form.permissions}
              onChange={(e) => setForm((f) => ({ ...f, permissions: e.target.value }))}
              placeholder="例如：spawn_items, teleport, god_mode"
            />
            <span className="form-hint">多个权限用英文逗号分隔</span>
          </label>
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

      {loading ? (
        <div className="empty-state">加载中…</div>
      ) : perms.length === 0 ? (
        <div className="empty-state">暂无 VIP 权限配置。</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>VIP 等级</th>
                <th>显示名</th>
                <th>权限</th>
                <th>最大品质</th>
                <th>每日上限</th>
                <th>每日点券</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {perms.map((p) => (
                <tr key={p.id}>
                  <td>{p.vip_level}</td>
                  <td>{p.display_name}</td>
                  <td>
                    {p.permissions.length === 0 ? (
                      <span className="form-hint">无</span>
                    ) : (
                      <div className="perm-tags">
                        {p.permissions.map((perm) => (
                          <span key={perm} className="badge">
                            {perm}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>{p.max_quality}</td>
                  <td>{p.daily_limit === null ? '不限' : p.daily_limit}</td>
                  <td>{p.daily_reward_amount ?? 0}</td>
                  <td className="col-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => openEdit(p)}
                      disabled={showForm}
                    >
                      编辑
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => void handleDelete(p.vip_level)}
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
