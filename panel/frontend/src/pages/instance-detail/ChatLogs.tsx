// ============================================================================
// ChatLogs — 聊天日志页（实例详情子页）
// 功能：列出聊天日志、按玩家名/消息关键字搜索、上一页/下一页分页
// 契约：public/schema/panel-api-types.ts -> ChatLogSummary / ListChatLogsQuery
// API：api.listChatLogs(serverId, query) -> { logs: ChatLogSummary[], total: number }
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type { ChatLogSummary, ListChatLogsQuery } from '@public/schema/panel-api-types';
import { useAuth } from '../../api/auth';
import { ListSkeleton } from '../../components/ui';

export interface ChatLogsPageProps {
  serverId: string;
}

const PAGE_SIZE = 100;

/** 将 ISO 时间字符串格式化为本地可读时间 */
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function ChatLogs({ serverId }: ChatLogsPageProps) {
  const { api } = useAuth();

  const [logs, setLogs] = useState<ChatLogSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 已应用的搜索条件（实际发送给后端）
  const [appliedPlayer, setAppliedPlayer] = useState<string | undefined>(undefined);
  const [appliedMessage, setAppliedMessage] = useState<string | undefined>(undefined);
  const [offset, setOffset] = useState(0);

  // 搜索输入框（未应用，点击搜索后才同步到 applied*）
  const [inputPlayer, setInputPlayer] = useState('');
  const [inputMessage, setInputMessage] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query: ListChatLogsQuery = {
        limit: PAGE_SIZE,
        offset,
      };
      if (appliedPlayer) query.player_name = appliedPlayer;
      if (appliedMessage) query.message_contains = appliedMessage;
      const res = await api.listChatLogs(serverId, query);
      setLogs(res.logs);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载聊天日志失败');
    } finally {
      setLoading(false);
    }
  }, [api, serverId, offset, appliedPlayer, appliedMessage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSearch = () => {
    setAppliedPlayer(inputPlayer.trim() || undefined);
    setAppliedMessage(inputMessage.trim() || undefined);
    setOffset(0);
  };

  const handleReset = () => {
    setInputPlayer('');
    setInputMessage('');
    setAppliedPlayer(undefined);
    setAppliedMessage(undefined);
    setOffset(0);
  };

  const handlePrev = () => {
    setOffset((prev) => Math.max(0, prev - PAGE_SIZE));
  };

  const handleNext = () => {
    setOffset((prev) => prev + PAGE_SIZE);
  };

  const hasPrev = offset > 0;
  const hasNext = offset + logs.length < total;
  const rangeStart = total > 0 ? offset + 1 : 0;
  const rangeEnd = offset + logs.length;

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">聊天日志</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          marginBottom: 16,
        }}
      >
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label htmlFor="chat-player">玩家名</label>
          <input
            id="chat-player"
            className="form-control"
            type="text"
            value={inputPlayer}
            onChange={(e) => setInputPlayer(e.target.value)}
            placeholder="按玩家名过滤"
          />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label htmlFor="chat-message">消息包含</label>
          <input
            id="chat-message"
            className="form-control"
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="消息关键字"
          />
        </div>
        <button className="btn btn-success" onClick={handleSearch} disabled={loading}>
          搜索
        </button>
        <button className="btn btn-ghost" onClick={handleReset} disabled={loading}>
          重置
        </button>
      </div>

      {loading ? (
        <ListSkeleton rows={6} columns={4} />
      ) : logs.length === 0 ? (
        <div className="empty-state">暂无聊天日志记录。</div>
      ) : (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>发送时间</th>
                <th>玩家名</th>
                <th>消息</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatTime(log.sent_at)}</td>
                  <td>{log.player_name ?? '—'}</td>
                  <td>{log.message}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="page-actions" style={{ justifyContent: 'space-between', marginTop: 12 }}>
            <span>
              共 {total} 条，第 {rangeStart} - {rangeEnd} 条
            </span>
            <div>
              <button
                className="btn btn-sm btn-ghost"
                onClick={handlePrev}
                disabled={!hasPrev || loading}
              >
                上一页
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={handleNext}
                disabled={!hasNext || loading}
                style={{ marginLeft: 8 }}
              >
                下一页
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
