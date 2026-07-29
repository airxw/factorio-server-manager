// ============================================================================
// ChatSettings — 聊天设置管理（仅 admin/system_admin 可见）
// 路径：/admin/chat-settings
// 顶部：服务器选择下拉
// 表单：enabled checkbox + settings JSON 编辑器（textarea + JSON.parse 校验）
// 保存：upsertChatSettings
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type {
  ChatSettingsSummary,
  ServerSummary,
  UpsertChatSettingsRequest,
} from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { getEffectiveRole, isAdminRole } from '../../utils/role';

function stringifySettings(settings: Record<string, unknown>): string {
  try {
    return JSON.stringify(settings, null, 2);
  } catch {
    return '{}';
  }
}

export default function ChatSettings() {
  const { api, user } = useAuth();

  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [serverId, setServerId] = useState('');
  const [serversLoading, setServersLoading] = useState(true);

  const [settings, setSettings] = useState<ChatSettingsSummary | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [settingsText, setSettingsText] = useState('{}');
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
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

  const loadSettings = useCallback(
    async (id: string) => {
      setDataLoading(true);
      setError(null);
      setSuccessMsg(null);
      try {
        const res = await api.getChatSettings(id);
        setSettings(res.settings);
        setEnabled(res.settings.enabled);
        setSettingsText(stringifySettings(res.settings.settings));
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载聊天设置失败');
        setSettings(null);
      } finally {
        setDataLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!serverId) {
      setSettings(null);
      return;
    }
    void loadSettings(serverId);
  }, [serverId, loadSettings]);

  const handleSave = async () => {
    if (!serverId) return;
    setError(null);
    setSuccessMsg(null);

    let parsed: Record<string, unknown> = {};
    const trimmed = settingsText.trim();
    if (trimmed !== '') {
      try {
        const obj: unknown = JSON.parse(trimmed);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          parsed = obj as Record<string, unknown>;
        } else {
          setError('settings 需为 JSON 对象（不能是数组或基础类型）');
          return;
        }
      } catch (e) {
        setError(`settings JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }

    setSaving(true);
    try {
      const req: UpsertChatSettingsRequest = {
        enabled,
        settings: parsed,
      };
      const res = await api.upsertChatSettings(serverId, req);
      setSettings(res.settings);
      setEnabled(res.settings.enabled);
      setSettingsText(stringifySettings(res.settings.settings));
      setSuccessMsg('保存成功');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">聊天设置</h2>
        <div className="page-actions">
          <button
            className="btn btn-ghost"
            onClick={() => serverId && void loadSettings(serverId)}
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
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      {!serverId ? (
        <div className="empty-state">请先选择服务器。</div>
      ) : dataLoading ? (
        <div className="empty-state">加载中…</div>
      ) : (
        <form
          className="form-card"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
        >
          <h3 className="card-title">
            {settings ? `编辑设置 (${settings.server_id})` : '新建设置'}
          </h3>

          <label className="form-field">
            <span className="form-label">启用聊天功能</span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </label>

          <label className="form-field">
            <span className="form-label">设置内容（JSON 对象）</span>
            <textarea
              value={settingsText}
              onChange={(e) => setSettingsText(e.target.value)}
              rows={10}
              placeholder='{\n  "key": "value"\n}'
              style={{ width: '100%', fontFamily: 'monospace' }}
            />
            <span className="form-hint">输入合法 JSON 对象，留空等同 {`{}`}</span>
          </label>

          {settings && <div className="form-hint">最后更新：{settings.updated_at}</div>}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
