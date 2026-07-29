// ============================================================================
// PlayerVerify — 玩家验证码申请页（游戏内 !verify 命令使用）
// 路径：/profile/verify
// 顶部：服务器选择下拉 + 游戏玩家名输入
// 生成验证码后展示卡片（code + 过期时间 + 引导文案）
// 列表：当前用户未使用且未过期的验证码
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type {
  CreateVerifyCodeResponse,
  ListMyVerifyCodesResponse,
  ServerSummary,
  VerifyCodeSummary,
} from '@public/schema/panel-api-types';
import { useAuth } from '../api/auth';
import { PanelApiError } from '../api/client';

function formatExpiry(expiresAt: string): string {
  try {
    const exp = new Date(expiresAt).getTime();
    const now = Date.now();
    const diff = Math.max(0, exp - now);
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}分${seconds.toString().padStart(2, '0')}秒`;
  } catch {
    return expiresAt;
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

export default function PlayerVerify() {
  const { api } = useAuth();

  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [serverId, setServerId] = useState('');
  const [gamePlayerName, setGamePlayerName] = useState('');
  const [serversLoading, setServersLoading] = useState(true);

  const [generated, setGenerated] = useState<VerifyCodeSummary | null>(null);
  const [myCodes, setMyCodes] = useState<VerifyCodeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 当前时间戳：通过 effect 设置，避免在 render 中调用 impure 的 Date.now()
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
  }, []);

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

  const refreshCodes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res: ListMyVerifyCodesResponse = await api.listMyVerifyCodes();
      setMyCodes(res.codes ?? []);
    } catch (err) {
      // 静默失败，不影响主流程
      setMyCodes([]);
      void err;
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refreshCodes();
  }, [refreshCodes]);

  const handleGenerate = async () => {
    setError(null);
    setNotice(null);
    if (!serverId) {
      setError('请先选择服务器');
      return;
    }
    const name = gamePlayerName.trim();
    if (!name) {
      setError('请填写游戏内玩家名');
      return;
    }
    setGenerating(true);
    try {
      const res: CreateVerifyCodeResponse = await api.createVerifyCode({
        server_id: serverId,
        game_player_name: name,
      });
      setGenerated(res.code);
      setNotice('验证码已生成，请在 5 分钟内于游戏内使用');
      await refreshCodes();
    } catch (err) {
      if (err instanceof PanelApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : '生成验证码失败');
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">游戏内绑定验证码</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refreshCodes()} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {/* 申请验证码表单 */}
      <div className="info-card">
        <h3 className="card-title">申请新验证码</h3>
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
            <span className="form-label">游戏内玩家名</span>
            <input
              type="text"
              value={gamePlayerName}
              onChange={(e) => setGamePlayerName(e.target.value)}
              placeholder="例如：airxw"
              maxLength={64}
            />
          </label>
        </div>
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleGenerate()}
            disabled={generating || !serverId || !gamePlayerName.trim()}
          >
            {generating ? '生成中…' : '生成验证码'}
          </button>
        </div>
      </div>

      {/* 验证码展示卡片 */}
      {generated && (
        <div className="info-card card-highlight">
          <h3 className="card-title">您的验证码</h3>
          <div className="verify-code-display">{generated.code}</div>
          <div className="info-row">
            <span className="info-label">服务器</span>
            <span className="info-value">{generated.server_id}</span>
          </div>
          <div className="info-row">
            <span className="info-label">玩家名</span>
            <span className="info-value">{generated.game_player_name}</span>
          </div>
          <div className="info-row">
            <span className="info-label">过期时间</span>
            <span className="info-value">
              {formatTime(generated.expires_at)}（剩余 {formatExpiry(generated.expires_at)}）
            </span>
          </div>
          <div className="alert alert-info mt-3">
            <strong>使用方法：</strong>进入游戏控制台，输入以下命令完成绑定：
            <code className="verify-code-usage">!verify {generated.code}</code>
          </div>
        </div>
      )}

      {/* 当前有效验证码列表 */}
      <div className="info-card">
        <h3 className="card-title">我的有效验证码</h3>
        {loading ? (
          <div className="empty-state">加载中…</div>
        ) : myCodes.length === 0 ? (
          <div className="empty-state">暂无有效验证码。</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>验证码</th>
                  <th>服务器</th>
                  <th>玩家名</th>
                  <th>过期时间</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {myCodes.map((c) => {
                  const expired = now !== null && new Date(c.expires_at).getTime() < now;
                  return (
                    <tr key={c.id}>
                      <td className="mono font-bold">{c.code}</td>
                      <td>{c.server_id}</td>
                      <td>{c.game_player_name}</td>
                      <td>{formatTime(c.expires_at)}</td>
                      <td>
                        {expired ? (
                          <span className="badge badge-stopped">已过期</span>
                        ) : c.used_at ? (
                          <span className="badge badge-starting">已使用</span>
                        ) : (
                          <span className="badge badge-running">有效</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
