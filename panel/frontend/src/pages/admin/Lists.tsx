// ============================================================================
// Lists — 白名单/黑名单管理（仅 admin/system_admin 可见）
// 路径：/admin/lists
// 顶部：服务器选择下拉 + listType 切换（whitelist / banlist）
// 表单：player_name + reason → 添加按钮
// 表格：player_name / added_at / added_by / reason / 删除按钮
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type {
  ListEntrySummary,
  ListType,
  CreateListEntryRequest,
  ListListEntriesResponse,
  CreateListEntryResponse,
  DeleteListEntryResponse,
  ServerSummary,
} from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { getEffectiveRole, isAdminRole } from '../../utils/role';
import { useConfirm } from '../../context/ConfirmContext';

const LIST_TYPES: ListType[] = ['whitelist', 'banlist'];

function listTypeLabel(t: ListType): string {
  return t === 'whitelist' ? '白名单' : '黑名单';
}

interface FormState {
  player_name: string;
  reason: string;
}

const EMPTY_FORM: FormState = {
  player_name: '',
  reason: '',
};

export default function Lists() {
  const { api, user } = useAuth();
  const { confirm } = useConfirm();

  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [serverId, setServerId] = useState('');
  const [serversLoading, setServersLoading] = useState(true);

  const [listType, setListType] = useState<ListType>('whitelist');
  const [entries, setEntries] = useState<ListEntrySummary[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);

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

  const loadEntries = useCallback(
    async (id: string, type: ListType) => {
      setDataLoading(true);
      setError(null);
      try {
        const res: ListListEntriesResponse = await api.listListEntries(id, type);
        setEntries(res.entries);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载列表失败');
        setEntries([]);
      } finally {
        setDataLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!serverId) {
      setEntries([]);
      return;
    }
    void loadEntries(serverId, listType);
  }, [serverId, listType, loadEntries]);

  const handleSubmit = async () => {
    if (!serverId) return;
    setError(null);
    const playerName = form.player_name.trim();
    if (!playerName) {
      setError('请填写玩家名');
      return;
    }
    setSaving(true);
    try {
      const req: CreateListEntryRequest = {
        player_name: playerName,
        reason: form.reason.trim() || null,
      };
      const res: CreateListEntryResponse = await api.createListEntry(serverId, listType, req);
      setEntries((prev) =>
        [res.entry, ...prev].sort((a, b) => b.added_at.localeCompare(a.added_at)),
      );
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (playerName: string) => {
    if (!serverId) return;
    const ok = await confirm({
      title: '删除玩家',
      message: `确认删除玩家 ${playerName}？此操作不可撤销。`,
      confirmText: '确认删除',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    setDeletingName(playerName);
    try {
      const res: DeleteListEntryResponse = await api.deleteListEntry(
        serverId,
        listType,
        playerName,
      );
      if (res.deleted) {
        setEntries((prev) => prev.filter((e) => e.player_name !== playerName));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeletingName(null);
    }
  };

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">白名单 / 黑名单</h2>
        <div className="page-actions">
          <button
            className="btn btn-ghost"
            onClick={() => serverId && void loadEntries(serverId, listType)}
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
        <label className="form-field">
          <span className="form-label">列表类型</span>
          <select value={listType} onChange={(e) => setListType(e.target.value as ListType)}>
            {LIST_TYPES.map((t) => (
              <option key={t} value={t}>
                {listTypeLabel(t)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* 添加表单 */}
      <form
        className="form-card"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        <h3 className="card-title">添加条目</h3>
        <div className="form-row">
          <label className="form-field">
            <span className="form-label">玩家名 *</span>
            <input
              type="text"
              value={form.player_name}
              onChange={(e) => setForm((f) => ({ ...f, player_name: e.target.value }))}
              placeholder="例如：Player1"
              required
            />
          </label>
          <label className="form-field">
            <span className="form-label">原因</span>
            <input
              type="text"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="可选"
            />
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving || !serverId}>
            {saving ? '添加中…' : '添加'}
          </button>
        </div>
      </form>

      {/* 条目表格 */}
      {!serverId ? (
        <div className="empty-state">请先选择服务器。</div>
      ) : dataLoading ? (
        <div className="empty-state">加载中…</div>
      ) : entries.length === 0 ? (
        <div className="empty-state">暂无条目。</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>玩家名</th>
                <th>添加时间</th>
                <th>添加者</th>
                <th>原因</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.id}</td>
                  <td className="mono">{e.player_name}</td>
                  <td>{new Date(e.added_at).toLocaleString('zh-CN')}</td>
                  <td className="mono">{e.added_by}</td>
                  <td>{e.reason ?? '—'}</td>
                  <td className="col-actions">
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => void handleDelete(e.player_name)}
                      disabled={deletingName === e.player_name}
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
