// ============================================================================
// Webhooks — Webhook 管理（仅 admin/system_admin 可见）
// 路径：/admin/webhooks
// 顶部：服务器选择下拉
// 表单：url + event_types（逗号分隔）+ secret + enabled checkbox → 创建按钮
// 表格：id / url / event_types 标签 / enabled 状态 / 操作（测试、删除）
// 测试：弹出 event_type + payload(JSON) 输入，显示 delivered/status_code/error
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type {
  WebhookSummary,
  CreateWebhookRequest,
  UpdateWebhookRequest,
  TriggerWebhookTestRequest,
  TriggerWebhookTestResponse,
  ServerSummary,
} from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { getEffectiveRole, isAdminRole } from '../../utils/role';
import { MobileCardList, SensitiveInput, useConfirm } from '../../components/ui';

interface FormState {
  url: string;
  event_types: string;
  secret: string;
  enabled: boolean;
}

const EMPTY_FORM: FormState = {
  url: '',
  event_types: '',
  secret: '',
  enabled: true,
};

interface TestState {
  webhookId: number;
  event_type: string;
  payload: string;
}

export default function Webhooks() {
  const { api, user } = useAuth();
  const { confirm } = useConfirm();

  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [serverId, setServerId] = useState('');
  const [serversLoading, setServersLoading] = useState(true);

  const [webhooks, setWebhooks] = useState<WebhookSummary[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [testState, setTestState] = useState<TestState | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TriggerWebhookTestResponse | null>(null);

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

  const loadWebhooks = useCallback(
    async (id: string) => {
      setDataLoading(true);
      setError(null);
      try {
        const res = await api.listWebhooks(id);
        setWebhooks(res.webhooks);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载 Webhook 列表失败');
        setWebhooks([]);
      } finally {
        setDataLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!serverId) {
      setWebhooks([]);
      return;
    }
    void loadWebhooks(serverId);
  }, [serverId, loadWebhooks]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async () => {
    if (!serverId) return;
    setError(null);
    const url = form.url.trim();
    if (!url) {
      setError('请填写 URL');
      return;
    }
    const eventTypes = form.event_types
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const secret = form.secret.trim();

    setSaving(true);
    try {
      const req: CreateWebhookRequest = {
        url,
        event_types: eventTypes,
        secret: secret.length > 0 ? secret : null,
        enabled: form.enabled,
      };
      const res = await api.createWebhook(serverId, req);
      setWebhooks((prev) =>
        [res.webhook, ...prev].sort((a, b) => b.created_at.localeCompare(a.created_at)),
      );
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (w: WebhookSummary) => {
    if (!serverId) return;
    const newEnabled = !w.enabled;
    setError(null);
    setTogglingId(w.id);
    // 乐观更新
    setWebhooks((prev) => prev.map((x) => (x.id === w.id ? { ...x, enabled: newEnabled } : x)));
    try {
      const req: UpdateWebhookRequest = { enabled: newEnabled };
      const res = await api.updateWebhook(serverId, w.id, req);
      setWebhooks((prev) => prev.map((x) => (x.id === w.id ? res.webhook : x)));
    } catch (err) {
      // 回滚
      setWebhooks((prev) => prev.map((x) => (x.id === w.id ? { ...x, enabled: w.enabled } : x)));
      setError(err instanceof Error ? err.message : '更新状态失败');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!serverId) return;
    const ok = await confirm({
      title: '删除确认',
      message: `确认删除 Webhook #${id}？此操作不可撤销。`,
      danger: true,
      confirmText: '删除',
    });
    if (!ok) return;
    setError(null);
    setDeletingId(id);
    try {
      await api.deleteWebhook(serverId, id);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  const openTest = (w: WebhookSummary) => {
    setTestState({ webhookId: w.id, event_type: '', payload: '{}' });
    setTestResult(null);
    setError(null);
  };

  const closeTest = () => {
    setTestState(null);
    setTestResult(null);
    setTesting(false);
  };

  const handleTestSubmit = async () => {
    if (!serverId || !testState) return;
    setError(null);
    const eventType = testState.event_type.trim();
    if (!eventType) {
      setError('请填写 event_type');
      return;
    }
    let payload: Record<string, unknown> | undefined = undefined;
    const payloadStr = testState.payload.trim();
    if (payloadStr.length > 0) {
      try {
        const parsed = JSON.parse(payloadStr);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          setError('payload 必须为 JSON 对象');
          return;
        }
        payload = parsed as Record<string, unknown>;
      } catch {
        setError('payload 不是合法的 JSON');
        return;
      }
    }
    setTesting(true);
    setTestResult(null);
    try {
      const req: TriggerWebhookTestRequest = {
        event_type: eventType,
        payload,
      };
      const res = await api.triggerWebhookTest(serverId, testState.webhookId, req);
      setTestResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : '测试失败');
    } finally {
      setTesting(false);
    }
  };

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Webhook 管理</h2>
        <div className="page-actions">
          <button
            className="btn btn-ghost"
            onClick={() => serverId && void loadWebhooks(serverId)}
            disabled={dataLoading || !serverId}
          >
            刷新
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

      {/* 创建表单 */}
      <form
        className="form-card"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        <h3 className="card-title">新建 Webhook</h3>
        <div className="form-row">
          <label className="form-field">
            <span className="form-label">URL *</span>
            <input
              type="text"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="例如：https://example.com/webhook"
              required
            />
          </label>
          <label className="form-field">
            <span className="form-label">事件类型（逗号分隔）</span>
            <input
              type="text"
              value={form.event_types}
              onChange={(e) => setForm((f) => ({ ...f, event_types: e.target.value }))}
              placeholder="例如：player.join,player.leave"
            />
          </label>
        </div>
        <div className="form-row">
          <label className="form-field">
            <span className="form-label">Secret（可选）</span>
            <SensitiveInput
              value={form.secret}
              onChange={(v) => setForm((f) => ({ ...f, secret: v }))}
              placeholder="留空则不发送 X-Webhook-Secret"
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
          <button type="button" className="btn btn-ghost" onClick={resetForm} disabled={saving}>
            清空
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || !serverId}>
            {saving ? '保存中…' : '创建'}
          </button>
        </div>
      </form>

      {/* 测试弹层 */}
      {testState && (
        <form
          className="form-card"
          onSubmit={(e) => {
            e.preventDefault();
            void handleTestSubmit();
          }}
        >
          <h3 className="card-title">测试 Webhook #{testState.webhookId}</h3>
          <div className="form-row">
            <label className="form-field">
              <span className="form-label">event_type *</span>
              <input
                type="text"
                value={testState.event_type}
                onChange={(e) =>
                  setTestState((s) => (s ? { ...s, event_type: e.target.value } : s))
                }
                placeholder="例如：player.join"
                required
              />
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span className="form-label">payload（JSON 对象，可选）</span>
              <textarea
                value={testState.payload}
                onChange={(e) => setTestState((s) => (s ? { ...s, payload: e.target.value } : s))}
                rows={5}
                placeholder='例如：{"player":"Player1"}'
                className="mono"
              />
            </label>
          </div>
          {testResult && (
            <div className="alert alert-info">
              <div>投递结果：</div>
              <div>
                delivered: <strong>{testResult.delivered ? '成功' : '失败'}</strong>
              </div>
              <div>status_code: {testResult.status_code ?? '—'}</div>
              <div>error: {testResult.error ?? '—'}</div>
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={closeTest} disabled={testing}>
              关闭
            </button>
            <button type="submit" className="btn btn-primary" disabled={testing}>
              {testing ? '发送中…' : '发送测试'}
            </button>
          </div>
        </form>
      )}

      {/* Webhook 表格 */}
      {!serverId ? (
        <div className="empty-state">请先选择服务器。</div>
      ) : dataLoading ? (
        <div className="empty-state">加载中…</div>
      ) : webhooks.length === 0 ? (
        <div className="empty-state">暂无 Webhook。</div>
      ) : (
        <>
        <div className="desktop-only">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>URL</th>
                <th>事件类型</th>
                <th>启用</th>
                <th>创建时间</th>
                <th>更新时间</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {webhooks.map((w) => (
                <tr key={w.id}>
                  <td>{w.id}</td>
                  <td className="mono">{w.url}</td>
                  <td>
                    {w.event_types.length === 0 ? (
                      <span className="badge">全部</span>
                    ) : (
                      w.event_types.map((et) => (
                        <span key={et} className="badge" style={{ marginRight: 4 }}>
                          {et}
                        </span>
                      ))
                    )}
                  </td>
                  <td>
                    <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={w.enabled}
                        onChange={() => void handleToggleEnabled(w)}
                        disabled={togglingId === w.id}
                      />
                      <span className={w.enabled ? 'badge badge-running' : 'badge badge-stopped'}>
                        {w.enabled ? '启用' : '停用'}
                      </span>
                    </label>
                  </td>
                  <td>{new Date(w.created_at).toLocaleString('zh-CN')}</td>
                  <td>{new Date(w.updated_at).toLocaleString('zh-CN')}</td>
                  <td className="col-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => openTest(w)}
                      disabled={testState !== null || deletingId === w.id}
                    >
                      测试
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => void handleDelete(w.id)}
                      disabled={deletingId === w.id}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>

        {/* 移动端卡片列表（B1.5：复用 MobileCardList 共享组件） */}
        <MobileCardList
          items={webhooks}
          keyExtractor={(w) => w.id}
          renderHeader={(w) => (
            <span className="mc-item-title mono" title={w.url}>
              {w.url}
            </span>
          )}
          renderBody={(w) => (
            <>
              <div className="mc-row">
                <span className="mc-label">事件类型</span>
                <span className="mc-value">
                  {w.event_types.length === 0 ? (
                    <span className="badge">全部</span>
                  ) : (
                    w.event_types.map((et) => (
                      <span key={et} className="badge" style={{ marginRight: 4 }}>
                        {et}
                      </span>
                    ))
                  )}
                </span>
              </div>
              <div className="mc-row">
                <span className="mc-label">状态</span>
                <span className="mc-value">
                  <span className={w.enabled ? 'badge badge-running' : 'badge badge-stopped'}>
                    {w.enabled ? '启用' : '停用'}
                  </span>
                </span>
              </div>
              <div className="mc-row">
                <span className="mc-label">创建时间</span>
                <span className="mc-value mono">
                  {new Date(w.created_at).toLocaleString('zh-CN')}
                </span>
              </div>
            </>
          )}
          renderActions={(w) => (
            <>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={w.enabled}
                  onChange={() => void handleToggleEnabled(w)}
                  disabled={togglingId === w.id}
                />
                <span>启用</span>
              </label>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => openTest(w)}
                disabled={testState !== null || deletingId === w.id}
              >
                测试
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => void handleDelete(w.id)}
                disabled={deletingId === w.id}
              >
                删除
              </button>
            </>
          )}
        />
        </>
      )}
    </div>
  );
}
