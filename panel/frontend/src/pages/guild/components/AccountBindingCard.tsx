// ============================================================================
// AccountBindingCard — v4.15.0 换肤：深色电竞风游戏账号绑定卡片
// 位置：/guild/servers/:id 顶部
// 功能：展示当前玩家在该实例游戏类型下的绑定状态，支持绑定/验证/解绑
//
// 数据流：
//   api.getServer(serverId) → game_type
//   api.listPlayerBindings() → 过滤 game_type 匹配的绑定
//   api.createPlayerBinding / verifyPlayerBinding / deletePlayerBinding
//
// 视觉：gp-card 容器 + gp-badge 状态徽章 + gp-btn-theme 主题色 CTA
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { Gamepad2 } from 'lucide-react';
import { useAuth } from '../../../api/auth';
import { PanelApiError } from '../../../api/client';
import type {
  Binding,
  ServerDetailResponse,
  ListPlayerBindingsResponse,
} from '@public/schema/panel-api-types';

interface AccountBindingCardProps {
  serverId: string;
  onBindingChange?: (binding: Binding | null) => void;
}

/** 游戏类型中文映射（常见类型） */
const GAME_TYPE_LABEL: Record<string, string> = {
  minecraft: 'Minecraft',
  terraria: 'Terraria',
  factorio: 'Factorio',
  palworld: 'Palworld',
  rust: 'Rust',
  ark: 'ARK',
  valheim: 'Valheim',
  dst: "Don't Starve Together",
  enshrouded: 'Enshrouded',
  zomboid: 'Project Zomboid',
  satisfactory: 'Satisfactory',
};

function getGameLabel(gameType: string): string {
  return GAME_TYPE_LABEL[gameType] ?? gameType;
}

export function AccountBindingCard({ serverId, onBindingChange }: AccountBindingCardProps) {
  const { api } = useAuth();
  const [gameType, setGameType] = useState<string | null>(null);
  const [binding, setBinding] = useState<Binding | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const updateBinding = useCallback((newBinding: Binding | null) => {
    setBinding(newBinding);
    onBindingChange?.(newBinding);
  }, [onBindingChange]);

  const loadData = useCallback(async () => {
    if (!serverId) return;
    setLoading(true);
    setError(null);
    try {
      const [serverResp, bindingsResp] = await Promise.all([
        api.getServer(serverId) as Promise<ServerDetailResponse>,
        api.listPlayerBindings() as Promise<ListPlayerBindingsResponse>,
      ]);

      const gt = serverResp.server.game_type;
      setGameType(gt);

      // v4.27.0: scope_ref 现为 server_id（实例级），不再匹配 game_type
      const matched = (bindingsResp.bindings ?? [])
        .filter((b) => b.scope_ref === serverId)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
      updateBinding(matched);
    } catch (err) {
      if (err instanceof PanelApiError && err.code === 'PANEL_FORBIDDEN') {
        setError('您无权访问该实例');
      } else {
        const msg = err instanceof PanelApiError ? err.message : '加载绑定状态失败';
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [api, serverId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (loading) {
    return <div className="gp-skeleton" style={{ height: 96 }} />;
  }

  return (
    <section
      className="gp-card"
      style={{ padding: 16, borderLeft: '3px solid var(--shop-theme-color, var(--gp-violet))' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Gamepad2 size={17} style={{ color: 'var(--shop-theme-color, var(--gp-violet))' }} />
        <h2 className="gp-section-title" style={{ margin: 0, fontSize: 14 }}>
          游戏账号绑定
        </h2>
        {gameType && <span className="gp-badge gp-badge-cyan">{getGameLabel(gameType)}</span>}
      </div>

      {error && <p style={{ margin: 0, fontSize: 12, color: 'var(--gp-rose)' }}>{error}</p>}

      {!error && !binding && gameType && (
        <UnboundForm
          serverId={serverId}
          gameLabel={getGameLabel(gameType)}
          onBound={loadData}
          api={api}
        />
      )}

      {!error && binding && binding.verify_status === 'pending' && (
        <PendingBinding
          binding={binding}
          gameLabel={getGameLabel(gameType ?? '')}
          onResolved={loadData}
          api={api}
        />
      )}

      {!error && binding && binding.verify_status === 'verified' && (
        <VerifiedBinding
          binding={binding}
          onUnbound={loadData}
          api={api}
        />
      )}

      {!error && binding && binding.verify_status === 'revoked' && (
        <div>
          <p className="gp-text-dim" style={{ margin: '0 0 10px', fontSize: 12 }}>
            绑定已被拒绝，可重新绑定。
          </p>
          <UnboundForm
            serverId={serverId}
            gameLabel={getGameLabel(gameType ?? '')}
            onBound={loadData}
            api={api}
          />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 子组件：未绑定状态 — 输入游戏玩家名创建绑定
// ---------------------------------------------------------------------------

interface UnboundFormProps {
  serverId: string;
  gameLabel: string;
  onBound: () => void;
  api: ReturnType<typeof useAuth>['api'];
}

function UnboundForm({ serverId, gameLabel, onBound, api }: UnboundFormProps) {
  const [playerName, setPlayerName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleBind = async () => {
    const name = playerName.trim();
    if (!name) {
      setErr('请输入游戏内玩家名');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await api.createPlayerBinding({ game_player_name: name, server_id: serverId });
      onBound();
    } catch (e) {
      setErr(e instanceof PanelApiError ? e.message : '绑定请求失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <p className="gp-text-dim" style={{ margin: 0, fontSize: 12 }}>
        绑定你的 {gameLabel} 游戏账号，享受店铺特权与福利
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !submitting) void handleBind();
          }}
          placeholder="游戏内玩家名"
          className="gp-input"
          style={{ flex: 1, minWidth: 160, padding: '8px 12px', fontSize: 13 }}
          disabled={submitting}
        />
        <button
          type="button"
          className="gp-btn gp-btn-theme"
          style={{ padding: '8px 18px', fontSize: 13, flexShrink: 0 }}
          onClick={() => void handleBind()}
          disabled={submitting || !playerName.trim()}
        >
          {submitting ? '绑定中...' : '绑定账号'}
        </button>
      </div>
      {err && <p style={{ margin: 0, fontSize: 11, color: 'var(--gp-rose)' }}>{err}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 子组件：待验证状态 — 展示验证码 + 验证/取消
// ---------------------------------------------------------------------------

interface PendingBindingProps {
  binding: Binding;
  gameLabel: string;
  onResolved: () => void;
  api: ReturnType<typeof useAuth>['api'];
}

function PendingBinding({ binding, gameLabel, onResolved, api }: PendingBindingProps) {
  const [verifyCode, setVerifyCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleVerify = async () => {
    const code = verifyCode.trim();
    if (!code) {
      setErr('请输入验证码');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await api.verifyPlayerBinding(binding.id, { verify_code: code });
      onResolved();
    } catch (e) {
      setErr(e instanceof PanelApiError ? e.message : '验证失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      await api.deletePlayerBinding(binding.id);
      onResolved();
    } catch (e) {
      setErr(e instanceof PanelApiError ? e.message : '取消失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="gp-badge gp-badge-amber">待验证</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gp-text)' }}>
          {binding.player_name ?? ''}
        </span>
      </div>
      <div
        className="gp-text-dim"
        style={{
          fontSize: 11,
          lineHeight: 1.7,
          background: 'var(--gp-bg-card)',
          border: '1px solid var(--gp-border)',
          borderRadius: 10,
          padding: '8px 12px',
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, color: 'var(--gp-text)' }}>验证步骤：</p>
        <p style={{ margin: 0 }}>1. 进入 {gameLabel} 游戏</p>
        <p style={{ margin: 0 }}>2. 在游戏内聊天框输入验证命令（含验证码）</p>
        <p style={{ margin: 0 }}>3. 系统自动检测后，在下方输入验证码确认</p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={verifyCode}
          onChange={(e) => setVerifyCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !submitting) void handleVerify();
          }}
          placeholder="验证码"
          className="gp-input"
          style={{ flex: 1, minWidth: 120, padding: '8px 12px', fontSize: 13 }}
          disabled={submitting}
        />
        <button
          type="button"
          className="gp-btn gp-btn-primary"
          style={{ padding: '8px 16px', fontSize: 13, flexShrink: 0 }}
          onClick={() => void handleVerify()}
          disabled={submitting || !verifyCode.trim()}
        >
          {submitting ? '验证中...' : '确认验证'}
        </button>
        <button
          type="button"
          className="gp-btn gp-btn-ghost"
          style={{ padding: '8px 14px', fontSize: 13, flexShrink: 0 }}
          onClick={() => void handleCancel()}
          disabled={submitting}
        >
          取消绑定
        </button>
      </div>
      {err && <p style={{ margin: 0, fontSize: 11, color: 'var(--gp-rose)' }}>{err}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 子组件：已验证状态 — 展示游戏玩家名 + 解绑
// ---------------------------------------------------------------------------

interface VerifiedBindingProps {
  binding: Binding;
  onUnbound: () => void;
  api: ReturnType<typeof useAuth>['api'];
}

function VerifiedBinding({ binding, onUnbound, api }: VerifiedBindingProps) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleUnbind = async () => {
    if (!confirm('确定要解绑此游戏账号吗？解绑后相关特权可能受影响。')) return;
    setSubmitting(true);
    setErr(null);
    try {
      await api.deletePlayerBinding(binding.id);
      onUnbound();
    } catch (e) {
      setErr(e instanceof PanelApiError ? e.message : '解绑失败');
    } finally {
      setSubmitting(false);
    }
  };

  const verifiedAt = binding.verified_at
    ? new Date(binding.verified_at).toLocaleDateString('zh-CN')
    : null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span className="gp-badge gp-badge-emerald" style={{ flexShrink: 0 }}>
            <svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
            </svg>
            已绑定
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gp-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {binding.player_name ?? ''}
          </span>
          {verifiedAt && (
            <span className="gp-text-faint" style={{ fontSize: 11, flexShrink: 0 }}>
              自 {verifiedAt}
            </span>
          )}
        </div>
        <button
          type="button"
          className="gp-btn gp-btn-ghost"
          style={{ padding: '4px 12px', fontSize: 11, flexShrink: 0 }}
          onClick={() => void handleUnbind()}
          disabled={submitting}
        >
          {submitting ? '解绑中...' : '解绑'}
        </button>
      </div>
      {err && <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--gp-rose)' }}>{err}</p>}
    </div>
  );
}
