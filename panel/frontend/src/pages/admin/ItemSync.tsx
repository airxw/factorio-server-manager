// ============================================================================
// ItemSync — 物品同步管理（仅 admin/system_admin 可见）
// 选择 Pack → Tab 切换（物品列表 / 同步日志）+ 立即同步按钮
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type { ItemSyncLogItem, PackItemSummary, PackSummary } from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { getEffectiveRole, isAdminRole } from '../../utils/role';

type TabKey = 'items' | 'logs';

export default function ItemSync() {
  const { api, user } = useAuth();

  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [packId, setPackId] = useState('');
  const [packsLoading, setPacksLoading] = useState(true);

  const [tab, setTab] = useState<TabKey>('items');
  const [items, setItems] = useState<PackItemSummary[]>([]);
  const [logs, setLogs] = useState<ItemSyncLogItem[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // 加载 Pack 列表
  useEffect(() => {
    let cancelled = false;
    setPacksLoading(true);
    api
      .listPacks()
      .then((res) => {
        if (cancelled) return;
        setPacks(res.packs);
        if (res.packs.length > 0) {
          setPackId(res.packs[0].id);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载 Pack 列表失败');
        }
      })
      .finally(() => {
        if (!cancelled) setPacksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const loadItems = useCallback(
    async (id: string) => {
      setDataLoading(true);
      setError(null);
      try {
        const res = await api.listPackItems(id);
        setItems(res.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载物品列表失败');
        setItems([]);
      } finally {
        setDataLoading(false);
      }
    },
    [api],
  );

  const loadLogs = useCallback(
    async (id: string) => {
      setDataLoading(true);
      setError(null);
      try {
        const res = await api.listItemSyncLogs(id);
        setLogs(res.logs);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载同步日志失败');
        setLogs([]);
      } finally {
        setDataLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!packId) {
      setItems([]);
      setLogs([]);
      return;
    }
    if (tab === 'items') {
      void loadItems(packId);
    } else {
      void loadLogs(packId);
    }
  }, [packId, tab, loadItems, loadLogs]);

  const handleSync = async () => {
    if (!packId) return;
    setSyncing(true);
    setSyncMsg(null);
    setError(null);
    try {
      const res = await api.triggerItemSync(packId);
      if (res.success) {
        setSyncMsg(`同步成功，共 ${res.items_count} 个物品。`);
      } else {
        setSyncMsg(`同步失败${res.error ? `：${res.error}` : '。'}`);
      }
      // 刷新当前 Tab 数据
      if (tab === 'items') {
        await loadItems(packId);
      } else {
        await loadLogs(packId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '触发同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const switchTab = (next: TabKey) => {
    if (next === tab) return;
    setTab(next);
  };

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">物品同步</h2>
        <div className="page-actions">
          <button
            className="btn btn-primary"
            onClick={() => void handleSync()}
            disabled={syncing || !packId}
          >
            {syncing ? '同步中…' : '立即同步'}
          </button>
        </div>
      </div>

      <div className="form-row">
        <label className="form-field">
          <span className="form-label">选择 Pack</span>
          {packsLoading ? (
            <div className="form-hint">加载 Pack 列表中…</div>
          ) : packs.length === 0 ? (
            <div className="form-hint">没有可用的 Pack。</div>
          ) : (
            <select value={packId} onChange={(e) => setPackId(e.target.value)}>
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name} — {p.game}/{p.variant} (v{p.version})
                </option>
              ))}
            </select>
          )}
        </label>
      </div>

      {syncMsg && <div className="alert alert-info">{syncMsg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="tabs">
        <button
          className={`tab-btn${tab === 'items' ? ' active' : ''}`}
          onClick={() => switchTab('items')}
          disabled={!packId}
        >
          物品列表
        </button>
        <button
          className={`tab-btn${tab === 'logs' ? ' active' : ''}`}
          onClick={() => switchTab('logs')}
          disabled={!packId}
        >
          同步日志
        </button>
      </div>

      {!packId ? (
        <div className="empty-state">请先选择一个 Pack。</div>
      ) : tab === 'items' ? (
        dataLoading ? (
          <div className="empty-state">加载中…</div>
        ) : items.length === 0 ? (
          <div className="empty-state">该 Pack 暂无物品数据，可点击「立即同步」拉取。</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>显示名</th>
                  <th>分类</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.name}>
                    <td className="mono">{it.name}</td>
                    <td>{it.display_name ?? '—'}</td>
                    <td>{it.category ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : dataLoading ? (
        <div className="empty-state">加载中…</div>
      ) : logs.length === 0 ? (
        <div className="empty-state">暂无同步日志。</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>同步时间</th>
                <th>状态</th>
                <th>物品数</th>
                <th>来源</th>
                <th>错误信息</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{new Date(log.synced_at).toLocaleString('zh-CN')}</td>
                  <td>
                    <span
                      className={
                        log.status === 'success' ? 'badge badge-running' : 'badge badge-error'
                      }
                    >
                      {log.status}
                    </span>
                  </td>
                  <td>{log.items_count ?? '—'}</td>
                  <td className="mono">{log.source_url}</td>
                  <td>{log.error_message ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
