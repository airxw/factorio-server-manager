// ============================================================================
// PlayerHistories — 玩家历史记录（任意登录用户可访问）
// 路径：/player-histories
// 顶部：服务器选择下拉
// 表格：game_player_name / joined_at / left_at / ip_address / session_duration
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type { PlayerHistorySummary, ServerSummary } from '@public/schema/panel-api-types';
import { useAuth } from '../api/auth';

/** 将 session_duration（秒）格式化为可读时长 */
function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}时${m}分${s}秒`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

export default function PlayerHistories() {
  const { api } = useAuth();

  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [serverId, setServerId] = useState('');
  const [serversLoading, setServersLoading] = useState(true);

  const [histories, setHistories] = useState<PlayerHistorySummary[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const loadHistories = useCallback(
    async (id: string) => {
      setDataLoading(true);
      setError(null);
      try {
        const res = await api.listPlayerHistories(id);
        setHistories(res.histories);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载玩家历史失败');
        setHistories([]);
      } finally {
        setDataLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!serverId) {
      setHistories([]);
      return;
    }
    void loadHistories(serverId);
  }, [serverId, loadHistories]);

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">玩家历史</h2>
        <div className="page-actions">
          <button
            className="btn btn-ghost"
            onClick={() => serverId && void loadHistories(serverId)}
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

      {!serverId ? (
        <div className="empty-state">请先选择服务器。</div>
      ) : dataLoading ? (
        <div className="empty-state">加载中…</div>
      ) : histories.length === 0 ? (
        <div className="empty-state">暂无玩家历史记录。</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>玩家名</th>
                <th>加入时间</th>
                <th>离开时间</th>
                <th>IP 地址</th>
                <th>会话时长</th>
              </tr>
            </thead>
            <tbody>
              {histories.map((h) => (
                <tr key={h.id}>
                  <td>{h.game_player_name}</td>
                  <td>{new Date(h.joined_at).toLocaleString('zh-CN')}</td>
                  <td>{h.left_at ? new Date(h.left_at).toLocaleString('zh-CN') : '—'}</td>
                  <td>{h.ip_address ?? '—'}</td>
                  <td>{formatDuration(h.session_duration)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
