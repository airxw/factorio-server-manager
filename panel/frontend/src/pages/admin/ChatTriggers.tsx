// ============================================================================
// ChatTriggers — 聊天触发响应管理（仅 admin/system_admin 可见）
// 路径：/admin/chat-triggers
// 顶部：服务器选择下拉
// 表格：trigger / response / priority / enabled / 操作
// 新建按钮 → 模态表单；行内编辑 enabled/priority（PATCH）
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type {
  ChatTriggerMode,
  ChatTriggerResponseSummary,
  CreateChatTriggerRequest,
  UpdateChatTriggerRequest,
} from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { getEffectiveRole, isAdminRole } from '../../utils/role';
import { useConfirm } from '../../context/ConfirmContext';

const MODE_OPTIONS: ChatTriggerMode[] = ['prefix', 'exact', 'contains'];

const MODE_LABEL: Record<ChatTriggerMode, string> = {
  prefix: '前缀匹配',
  exact: '完全匹配',
  contains: '包含匹配',
};

interface FormState {
  trigger: string;
  response: string;
  priority: string;
  enabled: boolean;
  mode: ChatTriggerMode;
  cooldown_seconds: string;
}

const EMPTY_FORM: FormState = {
  trigger: '',
  response: '',
  priority: '50',
  enabled: true,
  mode: 'prefix',
  cooldown_seconds: '0',
};

export default function ChatTriggers({ serverId }: { serverId: string }) {
  const { api, user } = useAuth();
  const { confirm } = useConfirm();

  const [triggers, setTriggers] = useState<ChatTriggerResponseSummary[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadTriggers = useCallback(
    async (id: string) => {
      setDataLoading(true);
      setError(null);
      try {
        const res = await api.listChatTriggers(id);
        setTriggers(res.triggers);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载触发响应失败');
        setTriggers([]);
      } finally {
        setDataLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    void loadTriggers(serverId);
  }, [serverId, loadTriggers]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (t: ChatTriggerResponseSummary) => {
    setEditingId(t.id);
    setForm({
      trigger: t.trigger,
      response: t.response,
      priority: String(t.priority),
      enabled: t.enabled,
      mode: t.mode,
      cooldown_seconds: String(t.cooldown_seconds),
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    resetForm();
  };

  const handleSubmit = async () => {
    setError(null);
    const triggerText = form.trigger.trim();
    const responseText = form.response.trim();
    if (!triggerText) {
      setError('请填写触发词');
      return;
    }
    if (!responseText) {
      setError('请填写响应内容');
      return;
    }
    const priorityNum = Number(form.priority);
    if (!Number.isInteger(priorityNum) || priorityNum < 0) {
      setError('优先级需为非负整数');
      return;
    }
    const cooldownNum = Number(form.cooldown_seconds);
    if (!Number.isInteger(cooldownNum) || cooldownNum < 0) {
      setError('冷却时间需为非负整数');
      return;
    }

    setSaving(true);
    try {
      if (editingId === null) {
        const req: CreateChatTriggerRequest = {
          trigger: triggerText,
          response: responseText,
          priority: priorityNum,
          enabled: form.enabled,
          mode: form.mode,
          cooldown_seconds: cooldownNum,
        };
        const res = await api.createChatTrigger(serverId, req);
        setTriggers((prev) =>
          [...prev, res.trigger].sort((a, b) => b.priority - a.priority || a.id - b.id),
        );
      } else {
        const req: UpdateChatTriggerRequest = {
          trigger: triggerText,
          response: responseText,
          priority: priorityNum,
          enabled: form.enabled,
          mode: form.mode,
          cooldown_seconds: cooldownNum,
        };
        const res = await api.updateChatTrigger(serverId, editingId, req);
        setTriggers((prev) =>
          prev
            .map((t) => (t.id === editingId ? res.trigger : t))
            .sort((a, b) => b.priority - a.priority || a.id - b.id),
        );
      }
      closeForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    const ok = await confirm({
      title: '删除触发响应',
      message: `确认删除触发响应 #${id}？此操作不可撤销。`,
      confirmText: '确认删除',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api.deleteChatTrigger(serverId, id);
      setTriggers((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  // 行内切换 enabled
  const toggleEnabled = async (t: ChatTriggerResponseSummary) => {
    setError(null);
    const newVal = !t.enabled;
    // 乐观更新
    setTriggers((prev) => prev.map((x) => (x.id === t.id ? { ...x, enabled: newVal } : x)));
    try {
      await api.updateChatTrigger(serverId, t.id, { enabled: newVal });
    } catch (err) {
      // 回滚
      setTriggers((prev) => prev.map((x) => (x.id === t.id ? { ...x, enabled: t.enabled } : x)));
      setError(err instanceof Error ? err.message : '更新失败');
    }
  };

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">聊天触发响应</h2>
        <div className="page-actions">
          <button
            className="btn btn-ghost"
            onClick={() => void loadTriggers(serverId)}
            disabled={dataLoading}
          >
            刷新
          </button>
          <button
            className="btn btn-primary"
            onClick={openCreate}
            disabled={dataLoading || showForm}
          >
            + 新建
          </button>
        </div>
      </div>

      <div className="alert alert-info">
        <strong>说明：</strong>此处配置<strong>自定义</strong>
        聊天触发响应——当玩家在游戏内发送匹配关键词的消息时，系统自动回复指定文本。
        <br />
        系统内置命令（<code>!register</code> / <code>!verify</code> / <code>!claim</code> /{' '}
        <code>!vk</code> 等）由面板硬编码实现业务逻辑，<strong>不在此处配置</strong>
        ，详情请参考「命令帮助」页面。 自定义触发响应与系统命令独立，关键词不冲突。
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
            {editingId === null ? '新建触发响应' : `编辑触发响应 #${editingId}`}
          </h3>
          <label className="form-field">
            <span className="form-label">触发词 *</span>
            <input
              type="text"
              value={form.trigger}
              onChange={(e) => setForm((f) => ({ ...f, trigger: e.target.value }))}
              placeholder="例如：hello"
              required
            />
          </label>
          <label className="form-field">
            <span className="form-label">响应内容 *</span>
            <textarea
              value={form.response}
              onChange={(e) => setForm((f) => ({ ...f, response: e.target.value }))}
              rows={3}
              placeholder="例如：Welcome to the server!"
              required
            />
          </label>
          <div className="form-row">
            <label className="form-field">
              <span className="form-label">优先级（越大越优先）</span>
              <input
                type="number"
                min={0}
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
              />
            </label>
            <label className="form-field">
              <span className="form-label">匹配模式</span>
              <select
                value={form.mode}
                onChange={(e) =>
                  setForm((f) => ({ ...f, mode: e.target.value as ChatTriggerMode }))
                }
              >
                {MODE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span className="form-label">冷却时间（秒）</span>
              <input
                type="number"
                min={0}
                value={form.cooldown_seconds}
                onChange={(e) => setForm((f) => ({ ...f, cooldown_seconds: e.target.value }))}
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

      {dataLoading ? (
        <div className="empty-state">加载中…</div>
      ) : triggers.length === 0 ? (
        <div className="empty-state">暂无触发响应配置。</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>触发词</th>
                <th>响应内容</th>
                <th>模式</th>
                <th>冷却</th>
                <th>优先级</th>
                <th>启用</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {triggers.map((t) => (
                <tr key={t.id}>
                  <td>{t.id}</td>
                  <td>{t.trigger}</td>
                  <td>{t.response}</td>
                  <td>
                    <span className="badge badge-starting">{MODE_LABEL[t.mode] ?? t.mode}</span>
                  </td>
                  <td className="mono">{t.cooldown_seconds}s</td>
                  <td>{t.priority}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={t.enabled}
                      onChange={() => void toggleEnabled(t)}
                      disabled={showForm}
                    />
                  </td>
                  <td className="col-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => openEdit(t)}
                      disabled={showForm}
                    >
                      编辑
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => void handleDelete(t.id)}
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
