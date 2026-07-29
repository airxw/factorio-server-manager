// ============================================================================
// Players — 玩家管理页（实例详情子页，v4.2.0-D2）
// 功能：
//   1. 在线玩家实时列表 + 操作按钮（kick/ban/op/deop）
//   2. 白名单管理（add/remove，同步 DB list_entries + 游戏控制台命令）
//   3. 黑名单管理（ban/pardon，同步 DB list_entries + 游戏控制台命令）
//   4. 玩家历史记录（沿用 PlayerHistories 表格）
//
// 契约：public/schema/panel-api-types.ts
//   - OnlinePlayer / PlayerHistorySummary / ListEntrySummary
//   - PlayerActionRequest / PlayerActionResponse（D1-D3 新增）
//
// API：
//   api.listOnlinePlayers(serverId)         — 转发 Daemon
//   api.kickPlayer/banPlayer/pardonPlayer/  — D1-D3 新增，通过 commandDispatcher
//   opPlayer/deopPlayer/whitelistAdd/whitelistRemove
//   api.listListEntries/createListEntry/deleteListEntry — DB 持久化
//   api.listPlayerHistories                  — 历史
//
// 复用 PlayerHistories.tsx 的 UI 风格（page-header / info-card / data-table / alert-*）
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type {
  OnlinePlayer,
  PlayerHistorySummary,
  ListEntrySummary,
  PlayerActionResponse,
} from '@public/schema/panel-api-types';
import { useAuth } from '../../api/auth';
import { ListSkeleton } from '../../components/ui';

export interface PlayersPageProps {
  serverId: string;
}

// ----- 辅助格式化函数（与 PlayerHistories 保持一致） -----

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

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatJoinedAt(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function formatOnlineDuration(joinedAtMs: number): string {
  const diffMs = Date.now() - joinedAtMs;
  if (diffMs < 0) return '—';
  return formatDuration(Math.floor(diffMs / 1000));
}

// ----- 主组件 -----

export default function Players({ serverId }: PlayersPageProps) {
  const { api } = useAuth();

  // ===== 在线玩家（实时） =====
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayer[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);

  // ===== 玩家历史 =====
  const [histories, setHistories] = useState<PlayerHistorySummary[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  const [histError, setHistError] = useState<string | null>(null);

  // ===== 白名单 / 黑名单 =====
  const [whitelist, setWhitelist] = useState<ListEntrySummary[]>([]);
  const [wlLoading, setWlLoading] = useState(false);
  const [banlist, setBanlist] = useState<ListEntrySummary[]>([]);
  const [blLoading, setBlLoading] = useState(false);

  // ===== 操作反馈 =====
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  // 操作中状态（按 player|action 唯一键，防止重复点击）
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // ===== 输入框 =====
  const [wlInput, setWlInput] = useState('');
  const [blInput, setBlInput] = useState('');
  const [blReason, setBlReason] = useState('');

  // ----- 刷新函数 -----

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

  const refreshHistories = useCallback(async () => {
    setHistLoading(true);
    setHistError(null);
    try {
      const res = await api.listPlayerHistories(serverId);
      setHistories(res.histories);
    } catch (err) {
      setHistError(err instanceof Error ? err.message : '加载玩家历史失败');
    } finally {
      setHistLoading(false);
    }
  }, [api, serverId]);

  const refreshWhitelist = useCallback(async () => {
    setWlLoading(true);
    try {
      const res = await api.listListEntries(serverId, 'whitelist');
      setWhitelist(res.entries);
    } catch {
      setWhitelist([]);
    } finally {
      setWlLoading(false);
    }
  }, [api, serverId]);

  const refreshBanlist = useCallback(async () => {
    setBlLoading(true);
    try {
      const res = await api.listListEntries(serverId, 'banlist');
      setBanlist(res.entries);
    } catch {
      setBanlist([]);
    } finally {
      setBlLoading(false);
    }
  }, [api, serverId]);

  // ----- 初始加载 + 在线玩家 10s 轮询 -----

  useEffect(() => {
    void refreshOnline();
    void refreshHistories();
    void refreshWhitelist();
    void refreshBanlist();
  }, [refreshOnline, refreshHistories, refreshWhitelist, refreshBanlist]);

  useEffect(() => {
    const timer = setInterval(() => {
      void refreshOnline();
    }, 10_000);
    return () => clearInterval(timer);
  }, [refreshOnline]);

  // ----- 通用操作执行器：调用 D1 API + 反馈 -----

  const runAction = useCallback(
    async (
      key: string,
      label: string,
      fn: () => Promise<PlayerActionResponse>,
      onSuccess?: (r: PlayerActionResponse) => Promise<void> | void,
    ) => {
      if (busyKey) return;
      setBusyKey(key);
      setActionMsg(null);
      setActionErr(null);
      try {
        const r = await fn();
        if (r.success) {
          setActionMsg(`${label}成功${r.command ? `: ${r.command}` : ''}`);
          if (onSuccess) await onSuccess(r);
        } else {
          setActionErr(`${label}失败${r.error ? `: ${r.error}` : ''}`);
        }
      } catch (err) {
        setActionErr(`${label}异常: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusyKey(null);
        // 1.5 秒后清空反馈，避免堆积
        setTimeout(() => {
          setActionMsg(null);
          setActionErr(null);
        }, 1500);
      }
    },
    [busyKey],
  );

  // ----- 在线玩家操作 -----

  const kickOnline = (p: OnlinePlayer) => {
    if (!window.confirm(`确认踢出玩家「${p.username}」？`)) return;
    void runAction(
      `kick|${p.username}`,
      `踢出 ${p.username}`,
      () => api.kickPlayer(serverId, p.username),
      () => refreshOnline(),
    );
  };

  const banOnline = (p: OnlinePlayer) => {
    const reason = window.prompt(`封禁玩家「${p.username}」的原因（可留空）：`, '');
    if (reason === null) return;
    void runAction(
      `ban|${p.username}`,
      `封禁 ${p.username}`,
      () => api.banPlayer(serverId, p.username, reason || undefined),
      async () => {
        await Promise.all([refreshOnline(), refreshBanlist()]);
      },
    );
  };

  const opOnline = (p: OnlinePlayer) => {
    if (!window.confirm(`确认授予「${p.username}」OP 权限？`)) return;
    void runAction(`op|${p.username}`, `OP ${p.username}`, () =>
      api.opPlayer(serverId, p.username),
    );
  };

  const deopOnline = (p: OnlinePlayer) => {
    if (!window.confirm(`确认撤销「${p.username}」的 OP 权限？`)) return;
    void runAction(`deop|${p.username}`, `Deop ${p.username}`, () =>
      api.deopPlayer(serverId, p.username),
    );
  };

  // ----- 白名单操作 -----

  const addWhitelist = () => {
    const name = wlInput.trim();
    if (!name) return;
    void runAction(
      `wl-add|${name}`,
      `白名单添加 ${name}`,
      () => api.whitelistAdd(serverId, name),
      async () => {
        // 同步 DB（best-effort，失败不影响 in-game 命令结果反馈）
        try {
          await api.createListEntry(serverId, 'whitelist', { player_name: name });
        } catch {
          /* DB 已存在或失败均忽略，以 in-game 命令为准 */
        }
        await refreshWhitelist();
        setWlInput('');
      },
    );
  };

  const removeWhitelist = (entry: ListEntrySummary) => {
    if (!window.confirm(`确认将「${entry.player_name}」移出白名单？`)) return;
    void runAction(
      `wl-rm|${entry.player_name}`,
      `白名单移除 ${entry.player_name}`,
      () => api.whitelistRemove(serverId, entry.player_name),
      async () => {
        try {
          await api.deleteListEntry(serverId, 'whitelist', entry.player_name);
        } catch {
          /* ignore */
        }
        await refreshWhitelist();
      },
    );
  };

  // ----- 黑名单操作 -----

  const addBanlist = () => {
    const name = blInput.trim();
    if (!name) return;
    const reason = blReason.trim();
    void runAction(
      `bl-add|${name}`,
      `封禁 ${name}`,
      () => api.banPlayer(serverId, name, reason || undefined),
      async () => {
        try {
          await api.createListEntry(serverId, 'banlist', {
            player_name: name,
            reason: reason || null,
          });
        } catch {
          /* ignore */
        }
        await Promise.all([refreshBanlist(), refreshOnline()]);
        setBlInput('');
        setBlReason('');
      },
    );
  };

  const pardonBanlist = (entry: ListEntrySummary) => {
    if (!window.confirm(`确认解除「${entry.player_name}」的封禁？`)) return;
    void runAction(
      `bl-rm|${entry.player_name}`,
      `解封 ${entry.player_name}`,
      () => api.pardonPlayer(serverId, entry.player_name),
      async () => {
        try {
          await api.deleteListEntry(serverId, 'banlist', entry.player_name);
        } catch {
          /* ignore */
        }
        await refreshBanlist();
      },
    );
  };

  // ----- 渲染 -----

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">玩家管理</h2>
        <div className="page-actions">
          <button
            className="btn btn-ghost"
            onClick={() => {
              void refreshOnline();
              void refreshHistories();
              void refreshWhitelist();
              void refreshBanlist();
            }}
            disabled={onlineLoading || histLoading || wlLoading || blLoading || !!busyKey}
          >
            刷新
          </button>
        </div>
      </div>

      {actionMsg && <div className="alert alert-success">{actionMsg}</div>}
      {actionErr && <div className="alert alert-error">{actionErr}</div>}

      {/* ============ 在线玩家实时列表 + 操作 ============ */}
      <div className="info-card" style={{ marginBottom: 16 }}>
        <h3 className="card-title" style={{ marginBottom: 8 }}>
          在线玩家（{onlinePlayers.length}）
        </h3>
        <span className="form-hint" style={{ display: 'block', marginBottom: 12 }}>
          每 10 秒自动刷新一次，操作按钮即时下发游戏命令
        </span>

        {onlineError && <div className="alert alert-error">{onlineError}</div>}

        {onlineLoading && onlinePlayers.length === 0 ? (
          <ListSkeleton rows={3} columns={4} />
        ) : onlinePlayers.length === 0 ? (
          <div className="empty-state">当前无在线玩家。</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>玩家名</th>
                <th>加入时间</th>
                <th>已在线时长</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {onlinePlayers.map((p) => {
                const kickBusy = busyKey === `kick|${p.username}`;
                const banBusy = busyKey === `ban|${p.username}`;
                const opBusy = busyKey === `op|${p.username}`;
                const deopBusy = busyKey === `deop|${p.username}`;
                return (
                  <tr key={p.username}>
                    <td>{p.username}</td>
                    <td>{formatJoinedAt(p.joined_at)}</td>
                    <td>{formatOnlineDuration(p.joined_at)}</td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => kickOnline(p)}
                        disabled={!!busyKey}
                        title="踢出该玩家"
                      >
                        {kickBusy ? '处理中…' : '踢出'}
                      </button>{' '}
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => banOnline(p)}
                        disabled={!!busyKey}
                        title="封禁该玩家"
                      >
                        {banBusy ? '处理中…' : '封禁'}
                      </button>{' '}
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => opOnline(p)}
                        disabled={!!busyKey}
                        title="授予 OP"
                      >
                        {opBusy ? '处理中…' : 'OP'}
                      </button>{' '}
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => deopOnline(p)}
                        disabled={!!busyKey}
                        title="撤销 OP"
                      >
                        {deopBusy ? '处理中…' : 'Deop'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ============ 白名单管理 ============ */}
      <div className="info-card" style={{ marginBottom: 16 }}>
        <h3 className="card-title" style={{ marginBottom: 8 }}>
          白名单（{whitelist.length}）
        </h3>
        <span className="form-hint" style={{ display: 'block', marginBottom: 12 }}>
          添加 / 移除同时下发游戏命令并同步数据库
        </span>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="玩家名"
            value={wlInput}
            onChange={(e) => setWlInput(e.target.value)}
            maxLength={32}
            style={{ flex: '1 1 200px', minWidth: 200 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addWhitelist();
            }}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={addWhitelist}
            disabled={!wlInput.trim() || !!busyKey}
          >
            添加白名单
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void refreshWhitelist()}
            disabled={wlLoading}
          >
            {wlLoading ? '加载中…' : '刷新'}
          </button>
        </div>

        {whitelist.length === 0 ? (
          <div className="empty-state">白名单为空。</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>玩家名</th>
                <th>添加时间</th>
                <th>添加人</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {whitelist.map((e) => (
                <tr key={`${e.id}`}>
                  <td>{e.player_name}</td>
                  <td>{formatTime(e.added_at)}</td>
                  <td>{e.added_by}</td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => removeWhitelist(e)}
                      disabled={!!busyKey}
                    >
                      {busyKey === `wl-rm|${e.player_name}` ? '处理中…' : '移除'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ============ 黑名单管理 ============ */}
      <div className="info-card" style={{ marginBottom: 16 }}>
        <h3 className="card-title" style={{ marginBottom: 8 }}>
          黑名单（{banlist.length}）
        </h3>
        <span className="form-hint" style={{ display: 'block', marginBottom: 12 }}>
          封禁 / 解封同时下发游戏命令并同步数据库
        </span>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="玩家名"
            value={blInput}
            onChange={(e) => setBlInput(e.target.value)}
            maxLength={32}
            style={{ flex: '1 1 200px', minWidth: 200 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addBanlist();
            }}
          />
          <input
            type="text"
            placeholder="原因（可选）"
            value={blReason}
            onChange={(e) => setBlReason(e.target.value)}
            maxLength={128}
            style={{ flex: '2 1 320px', minWidth: 240 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addBanlist();
            }}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={addBanlist}
            disabled={!blInput.trim() || !!busyKey}
          >
            封禁
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void refreshBanlist()}
            disabled={blLoading}
          >
            {blLoading ? '加载中…' : '刷新'}
          </button>
        </div>

        {banlist.length === 0 ? (
          <div className="empty-state">黑名单为空。</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>玩家名</th>
                <th>原因</th>
                <th>封禁时间</th>
                <th>操作人</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {banlist.map((e) => (
                <tr key={`${e.id}`}>
                  <td>{e.player_name}</td>
                  <td>{e.reason ?? '—'}</td>
                  <td>{formatTime(e.added_at)}</td>
                  <td>{e.added_by}</td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => pardonBanlist(e)}
                      disabled={!!busyKey}
                    >
                      {busyKey === `bl-rm|${e.player_name}` ? '处理中…' : '解封'}
                    </button>
                  </td>
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

      {histError && <div className="alert alert-error">{histError}</div>}

      {histLoading ? (
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
