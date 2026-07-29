// ============================================================================
// PlayerHistories — 玩家历史页（实例详情子页）
// 功能：
//   - 上半区：在线玩家实时列表（P6 新增，对应 daemon PlayerTracker）
//   - 下半区：玩家加入/离开历史（含会话时长与 IP）
// 契约：public/schema/panel-api-types.ts -> PlayerHistorySummary / OnlinePlayer
// API：
//   api.listOnlinePlayers(serverId) -> { players: OnlinePlayer[] }
//   api.listPlayerHistories(serverId) -> { histories: PlayerHistorySummary[] }
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type { OnlinePlayer, PlayerHistorySummary } from '@public/schema/panel-api-types';
import { useAuth } from '../../api/auth';
import { ListSkeleton } from '../../components/ui';

export interface PlayerHistoriesPageProps {
  serverId: string;
}

/** 将秒数格式化为可读时长；null 或非法值显示 — */
function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '—';
  const totalSec = Math.floor(seconds);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}小时 ${m}分`;
  if (m > 0) return `${m}分 ${s}秒`;
  return `${s}秒`;
}

/** 将 ISO 时间字符串格式化为本地可读时间；null 显示 — */
function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** 将 Unix 毫秒格式化为本地可读时间 */
function formatJoinedAt(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

/** 计算在线时长（从 joinedAt 到现在） */
function formatOnlineDuration(joinedAtMs: number): string {
  const diffMs = Date.now() - joinedAtMs;
  if (diffMs < 0) return '—';
  return formatDuration(Math.floor(diffMs / 1000));
}

export default function PlayerHistories({ serverId }: PlayerHistoriesPageProps) {
  const { api } = useAuth();

  // ----- 在线玩家（实时） -----
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayer[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);

  // ----- 玩家历史 -----
  const [histories, setHistories] = useState<PlayerHistorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 在线玩家实时刷新（10 秒轮询）
  const refreshOnline = useCallback(async () => {
    setOnlineLoading(true);
    setOnlineError(null);
    try {
      const res = await api.listOnlinePlayers(serverId);
      setOnlinePlayers(res.players);
    } catch (err) {
      setOnlineError(err instanceof Error ? err.message : '加载在线玩家失败');
      setOnlinePlayers([]);
    } finally {
      setOnlineLoading(false);
    }
  }, [api, serverId]);

  // 历史记录刷新
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listPlayerHistories(serverId);
      setHistories(res.histories);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载玩家历史失败');
    } finally {
      setLoading(false);
    }
  }, [api, serverId]);

  useEffect(() => {
    void refreshOnline();
    void refresh();
  }, [refreshOnline, refresh]);

  // 在线玩家 10 秒自动刷新
  useEffect(() => {
    const timer = setInterval(() => {
      void refreshOnline();
    }, 10_000);
    return () => clearInterval(timer);
  }, [refreshOnline]);

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">玩家历史</h2>
        <div className="page-actions">
          <button
            className="btn btn-ghost"
            onClick={() => {
              void refreshOnline();
              void refresh();
            }}
            disabled={loading || onlineLoading}
          >
            刷新
          </button>
        </div>
      </div>

      {/* ============ 在线玩家实时列表 ============ */}
      <div className="info-card" style={{ marginBottom: 16 }}>
        <h3 className="card-title" style={{ marginBottom: 8 }}>
          在线玩家（{onlinePlayers.length}）
        </h3>
        <span className="form-hint" style={{ display: 'block', marginBottom: 12 }}>
          每 10 秒自动刷新一次
        </span>

        {onlineError && <div className="alert alert-error">{onlineError}</div>}

        {onlineLoading && onlinePlayers.length === 0 ? (
          <ListSkeleton rows={3} columns={3} />
        ) : onlinePlayers.length === 0 ? (
          <div className="empty-state">当前无在线玩家。</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>玩家名</th>
                <th>加入时间</th>
                <th>已在线时长</th>
              </tr>
            </thead>
            <tbody>
              {onlinePlayers.map((p) => (
                <tr key={p.username}>
                  <td>{p.username}</td>
                  <td>{formatJoinedAt(p.joined_at)}</td>
                  <td>{formatOnlineDuration(p.joined_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ============ 玩家加入/离开历史 ============ */}
      <h3 className="card-title" style={{ marginBottom: 8 }}>
        历史记录
      </h3>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <ListSkeleton rows={5} columns={5} />
      ) : histories.length === 0 ? (
        <div className="empty-state">暂无玩家历史记录。</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>玩家名</th>
              <th>加入时间</th>
              <th>离开时间</th>
              <th>会话时长</th>
              <th>IP 地址</th>
            </tr>
          </thead>
          <tbody>
            {histories.map((h) => (
              <tr key={h.id}>
                <td>{h.game_player_name}</td>
                <td>{formatTime(h.joined_at)}</td>
                <td>{formatTime(h.left_at)}</td>
                <td>{formatDuration(h.session_duration)}</td>
                <td>{h.ip_address ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
