// ============================================================================
// PeriodicMessages — 定时消息管理（仅 admin/system_admin 可见）
// 路径：/admin/periodic-messages
// 顶部：服务器选择下拉
// 表格：message / interval_minutes / enabled / next_run_at / 操作
// 新建按钮 → 模态表单；行内切换 enabled（PATCH）
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type {
  CreatePeriodicMessageRequest,
  PeriodicMessageSummary,
  ServerSummary,
  UpdatePeriodicMessageRequest,
} from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { getEffectiveRole, isAdminRole } from '../../utils/role';
import { useConfirm } from '../../context/ConfirmContext';

interface FormState {
  message: string;
  interval_minutes: string;
  enabled: boolean;
}

const EMPTY_FORM: FormState = {
  message: '',
  interval_minutes: '30',
  enabled: true,
};

export default function PeriodicMessages() {
  const { api, user } = useAuth();
  const { confirm } = useConfirm();

  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [serverId, setServerId] = useState('');
  const [serversLoading, setServersLoading] = useState(true);

  const [messages, setMessages] = useState<PeriodicMessageSummary[]>([]);
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

  const loadMessages = useCallback(
    async (id: string) => {
      setDataLoading(true);
      setError(null);
      try {
        const res = await api.listPeriodicMessages(id);
        setMessages(res.messages);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载定时消息失败');
        setMessages([]);
      } finally {
        setDataLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!serverId) {
      setMessages([]);
      return;
    }
    void loadMessages(serverId);
  }, [serverId, loadMessages]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (m: PeriodicMessageSummary) => {
    setEditingId(m.id);
    setForm({
      message: m.message,
      interval_minutes: String(m.interval_minutes),
      enabled: m.enabled,
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
    const messageText = form.message.trim();
    if (!messageText) {
      setError('请填写消息内容');
      return;
    }
    const intervalNum = Number(form.interval_minutes);
    if (!Number.isInteger(intervalNum) || intervalNum <= 0) {
      setError('间隔分钟需为正整数');
      return;
    }

    setSaving(true);
    try {
      if (editingId === null) {
        const req: CreatePeriodicMessageRequest = {
          message: messageText,
          interval_minutes: intervalNum,
          enabled: form.enabled,
        };
        const res = await api.createPeriodicMessage(serverId, req);
        setMessages((prev) =>
          [res.message, ...prev].sort((a, b) => b.created_at.localeCompare(a.created_at)),
        );
      } else {
        const req: UpdatePeriodicMessageRequest = {
          message: messageText,
          interval_minutes: intervalNum,
          enabled: form.enabled,
        };
        const res = await api.updatePeriodicMessage(serverId, editingId, req);
        setMessages((prev) => prev.map((m) => (m.id === editingId ? res.message : m)));
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
      title: '删除定时消息',
      message: `确认删除定时消息 #${id}？此操作不可撤销。`,
      confirmText: '确认删除',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api.deletePeriodicMessage(serverId, id);
      setMessages((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  // 行内切换 enabled
  const toggleEnabled = async (m: PeriodicMessageSummary) => {
    if (!serverId) return;
    setError(null);
    const newVal = !m.enabled;
    // 乐观更新
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, enabled: newVal } : x)));
    try {
      await api.updatePeriodicMessage(serverId, m.id, { enabled: newVal });
    } catch (err) {
      // 回滚
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, enabled: m.enabled } : x)));
      setError(err instanceof Error ? err.message : '更新失败');
    }
  };

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">定时消息</h2>
        <div className="page-actions">
          <button
            className="btn btn-ghost"
            onClick={() => serverId && void loadMessages(serverId)}
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
            {editingId === null ? '新建定时消息' : `编辑定时消息 #${editingId}`}
          </h3>
          <label className="form-field">
            <span className="form-label">消息内容 *</span>
            <textarea
              value={form.message}
              onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
              rows={3}
              placeholder="例如：服务器即将重启，请提前保存进度。"
              required
            />
          </label>
          <div className="form-row">
            <label className="form-field">
              <span className="form-label">间隔分钟 *</span>
              <input
                type="number"
                min={1}
                value={form.interval_minutes}
                onChange={(e) => setForm((f) => ({ ...f, interval_minutes: e.target.value }))}
              />
            </label>
            <label className="form-field">
              <span className="form-label">启用</span>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
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
      ) : messages.length === 0 ? (
        <div className="empty-state">暂无定时消息配置。</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>消息内容</th>
                <th>间隔(分钟)</th>
                <th>启用</th>
                <th>下次执行</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id}>
                  <td>{m.id}</td>
                  <td>{m.message}</td>
                  <td>{m.interval_minutes}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={m.enabled}
                      onChange={() => void toggleEnabled(m)}
                      disabled={showForm}
                    />
                  </td>
                  <td>{new Date(m.next_run_at).toLocaleString('zh-CN')}</td>
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
