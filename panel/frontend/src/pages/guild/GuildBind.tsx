// ============================================================================
// GuildBind — /guild/bind（v4.17.0 向导式重做）
//
// v4.17.0 变更（按 docs/plans/binding-unification-multi-role-plan.md §7.3-§7.4）：
//   1. 顶部 SegmentedControl 切换"游戏角色绑定 / 账户级绑定"两支向导
//   2. 通过 URL query ?type=account|player 控制初始选中分支
//   3. 账户级向导：展示已绑定实例 + 可绑定实例列表 + 一键绑定/解绑
//   4. 游戏角色级向导：保留原创建/验证/解绑流程，多步骤引导
//   5. 不再使用子路由 /guild/bind/account 与 /guild/bind/player（query 参数更轻量，
//      避免破坏现有 <Route path="bind"> 单一注册）
//
// 数据源：
//   GET  /api/player-bindings         → 游戏角色级绑定列表
//   POST /api/player-bindings         → 创建游戏角色级绑定（生成验证码）
//   POST /api/player-bindings/:id/verify → 验证（消费验证码）
//   DELETE /api/player-bindings/:id   → 解绑
//   GET  /api/profile/bindings        → 账户级绑定列表（user↔instance）
//   GET  /api/servers                 → 实例列表（用于账户级"可绑定实例"）
//   POST /api/instances/:id/bindings  → 账户级绑定（一键绑定实例）
//   DELETE /api/instances/:id/bindings → 账户级解绑
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BadgeCheck,
  ChevronRight,
  Clock3,
  Copy,
  Crown,
  Gamepad2,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldX,
  Trash2,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../components/ui';
import type { MyBinding } from '../../api/modules/auth';
import type {
  Binding,
  ServerSummary,
} from '@public/schema/panel-api-types';

// ---------------------------------------------------------------------------
// 常量与工具
// ---------------------------------------------------------------------------

// v4.27.0: 玩家角色绑定从 game_type 全局语义迁移至 instance 实例级语义
// GAME_TYPE_OPTIONS（下拉选项源）已删除——第 1 步改为选择实例
// 保留 GAME_TYPE_LABEL + gameLabel()：用于 server.game_type 的中文展示
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

function gameLabel(gameType: string): string {
  return GAME_TYPE_LABEL[gameType] ?? gameType;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

type BindType = 'player' | 'account';

// ---------------------------------------------------------------------------
// 状态徽章
// ---------------------------------------------------------------------------

function StatusBadge({ verifyStatus }: { verifyStatus: Binding['verify_status'] }) {
  if (verifyStatus === 'verified') {
    return (
      <span className="gp-badge gp-badge-emerald">
        <BadgeCheck size={11} /> 已验证
      </span>
    );
  }
  if (verifyStatus === 'pending') {
    return (
      <span className="gp-badge gp-badge-amber">
        <Clock3 size={11} /> 待验证
      </span>
    );
  }
  return (
    <span className="gp-badge gp-badge-rose">
      <ShieldX size={11} /> 已拒绝
    </span>
  );
}

// ---------------------------------------------------------------------------
// 游戏角色级绑定卡片
// ---------------------------------------------------------------------------

function PlayerBindingRow({
  binding,
  onVerify,
  onDelete,
  busy,
}: {
  binding: Binding;
  onVerify: (b: Binding) => void;
  onDelete: (b: Binding) => void;
  busy: boolean;
}) {
  const toast = useToast();
  const isVerified = binding.verify_status === 'verified';

  const copyCode = () => {
    void navigator.clipboard
      .writeText(binding.verify_code ?? '')
      .then(() => toast.success('验证码已复制'))
      .catch(() => toast.error('复制失败'));
  };

  return (
    <div className="gp-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: isVerified ? 'var(--gp-grad-primary)' : 'var(--gp-bg-card-strong)',
            border: isVerified ? 'none' : '1px solid var(--gp-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: isVerified ? '#fff' : 'var(--gp-text-faint)',
            flexShrink: 0,
          }}
        >
          <Gamepad2 size={17} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{binding.player_name ?? ''}</p>
            <StatusBadge verifyStatus={binding.verify_status} />
          </div>
          <p className="gp-text-faint" style={{ margin: '3px 0 0', fontSize: 12 }}>
            绑定于 {formatTime(binding.created_at)}
          </p>
        </div>
        <button
          type="button"
          className="gp-btn gp-btn-ghost"
          style={{ padding: 8, flexShrink: 0 }}
          onClick={() => onDelete(binding)}
          disabled={busy}
          title="解绑"
          aria-label={`解绑 ${binding.player_name ?? ''}`}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* 待验证：展示验证码 + 验证入口 */}
      {binding.verify_status === 'pending' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            padding: '10px 12px',
            borderRadius: 10,
            background: 'rgba(251, 191, 36, 0.08)',
            border: '1px solid rgba(251, 191, 36, 0.25)',
          }}
        >
          <KeyRound size={14} style={{ color: 'var(--gp-amber)', flexShrink: 0 }} />
          <span className="gp-text-dim" style={{ fontSize: 12 }}>
            游戏内输入验证码：
          </span>
          <code className="gp-mono-num" style={{ fontSize: 14, fontWeight: 700, color: 'var(--gp-amber)', letterSpacing: '0.08em' }}>
            {binding.verify_code}
          </code>
          <button
            type="button"
            className="gp-btn gp-btn-ghost"
            style={{ padding: '4px 10px', fontSize: 12 }}
            onClick={copyCode}
          >
            <Copy size={12} /> 复制
          </button>
          <button
            type="button"
            className="gp-btn gp-btn-primary"
            style={{ padding: '4px 12px', fontSize: 12, marginLeft: 'auto' }}
            onClick={() => onVerify(binding)}
            disabled={busy}
          >
            我已在游戏内输入
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 账户级绑定卡片（user↔instance）
// ---------------------------------------------------------------------------

function AccountBindingRow({
  binding,
  serverName,
  gameType,
  busy,
  onUnbind,
}: {
  binding: MyBinding;
  serverName: string;
  gameType: string;
  busy: boolean;
  onUnbind: (serverId: string) => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="gp-card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          background: 'var(--gp-grad-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          flexShrink: 0,
        }}
      >
        <Crown size={18} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {serverName}
        </p>
        <p className="gp-text-faint" style={{ margin: '3px 0 0', fontSize: 12 }}>
          {gameType} · VIP{binding.vipLevel} · 绑定于 {formatTime(binding.boundAt)}
        </p>
      </div>
      <button
        type="button"
        className="gp-btn gp-btn-ghost"
        style={{ padding: '6px 10px', fontSize: 12 }}
        onClick={() => navigate(`/guild/servers/${binding.serverId}`)}
      >
        进入 <ChevronRight size={12} />
      </button>
      <button
        type="button"
        className="gp-btn gp-btn-ghost"
        style={{ padding: 8, flexShrink: 0, color: 'var(--gp-rose)' }}
        onClick={() => onUnbind(binding.serverId)}
        disabled={busy}
        title="解绑"
        aria-label={`解绑 ${serverName}`}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 可绑定实例卡片
// ---------------------------------------------------------------------------

function BindableServerRow({
  server,
  busy,
  onBind,
}: {
  server: ServerSummary;
  busy: boolean;
  onBind: (serverId: string) => void;
}) {
  return (
    <div className="gp-card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          background: 'var(--gp-bg-card-strong)',
          border: '1px solid var(--gp-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--gp-text-faint)',
          flexShrink: 0,
        }}
      >
        <Gamepad2 size={18} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {server.name}
        </p>
        <p className="gp-text-faint" style={{ margin: '3px 0 0', fontSize: 12 }}>
          {gameLabel(server.game_type)}
        </p>
      </div>
      <button
        type="button"
        className="gp-btn gp-btn-primary"
        style={{ padding: '6px 14px', fontSize: 12, flexShrink: 0 }}
        onClick={() => onBind(server.id)}
        disabled={busy}
      >
        <UserPlus size={12} /> 绑定
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export default function GuildBind() {
  const { api } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useDocumentTitle('绑定角色');

  // v4.17.0: 向导分支（query 参数 ?type=account|player，默认 player）
  const initialType: BindType = searchParams.get('type') === 'account' ? 'account' : 'player';
  const [bindType, setBindType] = useState<BindType>(initialType);

  // 游戏角色级绑定状态
  const [playerBindings, setPlayerBindings] = useState<Binding[]>([]);
  // 账户级绑定状态
  const [accountBindings, setAccountBindings] = useState<MyBinding[]>([]);
  // 实例列表（用于账户级"可绑定实例"）
  const [servers, setServers] = useState<ServerSummary[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // 创建表单状态（游戏角色级）
  // v4.27.0: 第 1 步从「选择游戏类型」改为「选择实例」
  const [selectedServerId, setSelectedServerId] = useState<string>('');
  const [playerName, setPlayerName] = useState('');
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [playerRes, accountRes, serversRes] = await Promise.all([
        api.listPlayerBindings().catch(() => ({ bindings: [] as Binding[] })),
        api.listMyBindings().catch(() => [] as MyBinding[]),
        api.listServers().catch(() => ({ servers: [] as ServerSummary[] })),
      ]);
      setPlayerBindings(playerRes.bindings ?? []);
      setAccountBindings(accountRes);
      setServers(serversRes.servers ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载绑定列表失败');
    } finally {
      setLoading(false);
    }
  }, [api, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // v4.17.0: 切换分支时同步 URL query（便于分享/书签）
  const switchType = useCallback(
    (next: BindType) => {
      setBindType(next);
      const params = new URLSearchParams(searchParams);
      params.set('type', next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // 按实例 ID 分组（游戏角色级，v4.27.0: scope_ref 现为 server_id）
  const grouped = useMemo(() => {
    const map = new Map<string, Binding[]>();
    for (const b of playerBindings) {
      const key = b.scope_ref ?? '';
      const list = map.get(key) ?? [];
      list.push(b);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [playerBindings]);

  // 实例 ID → 元信息映射（账户级卡片展示实例名/游戏类型）
  const serverMap = useMemo(() => {
    const m = new Map<string, ServerSummary>();
    for (const s of servers) m.set(s.id, s);
    return m;
  }, [servers]);

  // 已绑定实例 ID 集合（用于过滤可绑定列表）
  const boundServerIds = useMemo(() => new Set(accountBindings.map((b) => b.serverId)), [accountBindings]);
  const bindableServers = useMemo(() => servers.filter((s) => !boundServerIds.has(s.id)), [servers, boundServerIds]);

  // ----- 游戏角色级操作 -----

  const handleCreate = async () => {
    const name = playerName.trim();
    if (!name) {
      toast.error('请输入游戏角色名');
      return;
    }
    if (!selectedServerId) {
      toast.error('请选择实例');
      return;
    }
    setCreating(true);
    try {
      const res = await api.createPlayerBinding({ game_player_name: name, server_id: selectedServerId });
      setPlayerBindings((prev) => [res.binding, ...prev]);
      setPlayerName('');
      toast.success(`绑定已创建，请在游戏内输入验证码 ${res.binding.verify_code}`);
    } catch (err) {
      const msg = err instanceof PanelApiError ? err.message : '创建绑定失败';
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleVerify = async (binding: Binding) => {
    setBusy(true);
    try {
      const res = await api.verifyPlayerBinding(binding.id, { verify_code: binding.verify_code ?? '' });
      setPlayerBindings((prev) => prev.map((b) => (b.id === binding.id ? res.binding : b)));
      if (res.binding.verify_status === 'verified') {
        toast.success('验证成功，角色已绑定');
      } else if (res.binding.verify_status === 'pending') {
        toast.error(`尚未检测到验证码输入，请确认您已在游戏内输入 ${binding.verify_code ?? ''}，稍后重试`);
      } else {
        toast.error('验证未通过，请确认验证码是否正确');
      }
    } catch (err) {
      const msg = err instanceof PanelApiError ? err.message : '核查失败，请稍后重试';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (binding: Binding) => {
    if (!window.confirm(`确定解绑角色「${binding.player_name ?? ''}」吗？`)) return;
    setBusy(true);
    try {
      await api.deletePlayerBinding(binding.id);
      setPlayerBindings((prev) => prev.filter((b) => b.id !== binding.id));
      toast.success('已解绑');
    } catch (err) {
      toast.error(err instanceof PanelApiError ? err.message : '解绑失败');
    } finally {
      setBusy(false);
    }
  };

  // ----- 账户级操作 -----

  const handleBindInstance = async (serverId: string) => {
    setBusy(true);
    try {
      await api.bindInstance(serverId);
      toast.success('已绑定该实例');
      // 刷新账户级绑定列表
      const res = await api.listMyBindings();
      setAccountBindings(res);
    } catch (err) {
      if (err instanceof PanelApiError && err.code === 'ALREADY_BOUND') {
        toast.info('已绑定该实例');
        const res = await api.listMyBindings();
        setAccountBindings(res);
      } else {
        toast.error(err instanceof PanelApiError ? err.message : '绑定失败');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUnbindInstance = async (serverId: string) => {
    const srv = serverMap.get(serverId);
    const name = srv?.name ?? serverId;
    if (!window.confirm(`确定解绑实例「${name}」吗？解绑后将失去 VIP 身份与每日点券福利。`)) return;
    setBusy(true);
    try {
      await api.unbindInstance(serverId);
      setAccountBindings((prev) => prev.filter((b) => b.serverId !== serverId));
      toast.success('已解绑');
    } catch (err) {
      toast.error(err instanceof PanelApiError ? err.message : '解绑失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minHeight: '100dvh' }}>
      {/* 页头 */}
      <div className="gp-hero" style={{ padding: '20px 20px' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>绑定管理</h1>
            <p className="gp-text-dim" style={{ margin: '6px 0 0', fontSize: 13 }}>
              选择绑定类型，按向导完成关联即可解锁对应权益
            </p>
          </div>
          <button
            type="button"
            className="gp-btn gp-btn-ghost"
            style={{ padding: '8px 14px', fontSize: 13 }}
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
      </div>

      {/* v4.17.0: 向导分支切换器（SegmentedControl 风格） */}
      <div
        role="tablist"
        aria-label="绑定类型"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 6,
          padding: 4,
          background: 'var(--gp-bg-card-strong)',
          borderRadius: 12,
          border: '1px solid var(--gp-border)',
        }}
      >
        <button
          role="tab"
          aria-selected={bindType === 'player'}
          type="button"
          onClick={() => switchType('player')}
          style={{
            padding: '10px 14px',
            border: 'none',
            background: bindType === 'player' ? 'var(--gp-bg-card)' : 'transparent',
            color: bindType === 'player' ? 'var(--gp-blue)' : 'var(--gp-text-sec)',
            borderRadius: 9,
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            transition: 'background 0.15s ease, color 0.15s ease',
            boxShadow: bindType === 'player' ? '0 1px 3px rgba(0,0,0,0.04)' : 'none',
          }}
        >
          <Gamepad2 size={14} />
          游戏角色绑定
        </button>
        <button
          role="tab"
          aria-selected={bindType === 'account'}
          type="button"
          onClick={() => switchType('account')}
          style={{
            padding: '10px 14px',
            border: 'none',
            background: bindType === 'account' ? 'var(--gp-bg-card)' : 'transparent',
            color: bindType === 'account' ? 'var(--gp-blue)' : 'var(--gp-text-sec)',
            borderRadius: 9,
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            transition: 'background 0.15s ease, color 0.15s ease',
            boxShadow: bindType === 'account' ? '0 1px 3px rgba(0,0,0,0.04)' : 'none',
          }}
        >
          <Crown size={14} />
          账户级绑定
        </button>
      </div>

      {/* ============== 游戏角色级向导分支 ============== */}
      {bindType === 'player' && (
        <>
          {/* 向导步骤 1: 选择实例并创建绑定 */}
          <section className="gp-card-strong" style={{ padding: 16 }}>
            <h2 className="gp-section-title" style={{ margin: '0 0 4px' }}>
              <Plus size={16} />
              第 1 步：选择实例并填写角色名
            </h2>
            <p className="gp-text-faint" style={{ margin: '0 0 12px', fontSize: 12 }}>
              选择要绑定的实例并输入游戏内角色名，系统将生成 6 位验证码
            </p>
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <select
                className="gp-input"
                value={selectedServerId}
                onChange={(e) => setSelectedServerId(e.target.value)}
                aria-label="选择实例"
              >
                <option value="" disabled>
                  请选择实例…
                </option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({gameLabel(s.game_type)})
                  </option>
                ))}
              </select>
              <input
                className="gp-input"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="输入游戏角色名"
                maxLength={64}
                aria-label="游戏角色名"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate();
                }}
              />
              <button
                type="button"
                className="gp-btn gp-btn-primary"
                style={{ padding: '10px 18px', fontSize: 14 }}
                onClick={() => void handleCreate()}
                disabled={creating || !playerName.trim() || !selectedServerId}
              >
                <UserPlus size={15} />
                {creating ? '创建中…' : '生成验证码'}
              </button>
            </div>
            {servers.length === 0 && (
              <p className="gp-text-faint" style={{ margin: '8px 0 0', fontSize: 12 }}>
                当前无可绑定实例，请联系服主或管理员
              </p>
            )}
          </section>

          {/* 向导步骤 2: 在游戏内输入验证码（卡片内展示） */}
          <section>
            <h2 className="gp-section-title" style={{ margin: '0 0 12px' }}>
              <KeyRound size={16} />
              第 2 步：在游戏内输入验证码并确认
            </h2>
            <p className="gp-text-faint" style={{ margin: '-4px 0 12px', fontSize: 12 }}>
              在游戏内使用聊天框输入验证码（如 <code>!verify 123456</code>），完成后点击"我已在游戏内输入"
            </p>
            {loading && playerBindings.length === 0 ? (
              <div style={{ display: 'grid', gap: 10 }}>
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="gp-skeleton" style={{ height: 84 }} />
                ))}
              </div>
            ) : grouped.length > 0 ? (
              grouped.map(([serverId, list]) => {
                const srv = serverMap.get(serverId);
                const title = srv?.name ?? serverId;
                const gameTypeLabel = srv ? gameLabel(srv.game_type) : '';
                return (
                  <div key={serverId} style={{ marginBottom: 16 }}>
                    <h3 className="gp-section-title" style={{ margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                      <Gamepad2 size={14} />
                      {title}
                      {gameTypeLabel && (
                        <span className="gp-text-faint" style={{ fontSize: 12, fontWeight: 400 }}>
                          {gameTypeLabel}
                        </span>
                      )}
                      <span className="gp-badge gp-badge-violet gp-mono-num">{list.length}</span>
                    </h3>
                    <div style={{ display: 'grid', gap: 10 }}>
                      {list.map((b) => (
                        <PlayerBindingRow key={b.id} binding={b} onVerify={handleVerify} onDelete={handleDelete} busy={busy} />
                      ))}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="gp-empty" style={{ padding: '36px 20px' }}>
                <div
                  style={{
                    margin: '0 auto',
                    width: 52,
                    height: 52,
                    borderRadius: 999,
                    background: 'var(--gp-grad-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                  }}
                >
                  <UserPlus size={22} />
                </div>
                <p style={{ margin: '12px 0 4px', fontWeight: 600, fontSize: 14 }}>还没有绑定游戏角色</p>
                <p className="gp-text-faint" style={{ margin: 0, fontSize: 12 }}>
                  使用上方表单创建第一个绑定
                </p>
              </div>
            )}
          </section>
        </>
      )}

      {/* ============== 账户级向导分支 ============== */}
      {bindType === 'account' && (
        <>
          {/* 向导步骤 1: 已绑定的实例（VIP/钱包） */}
          <section>
            <h2 className="gp-section-title" style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Crown size={16} style={{ color: 'var(--gp-amber)' }} />
              已绑定实例
              {accountBindings.length > 0 && (
                <span className="gp-badge gp-badge-blue gp-mono-num">{accountBindings.length}</span>
              )}
            </h2>
            {loading && accountBindings.length === 0 ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="gp-skeleton" style={{ height: 70 }} />
                ))}
              </div>
            ) : accountBindings.length > 0 ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {accountBindings.map((b) => {
                  const srv = serverMap.get(b.serverId);
                  return (
                    <AccountBindingRow
                      key={b.id}
                      binding={b}
                      serverName={srv?.name ?? b.serverId}
                      gameType={srv ? gameLabel(srv.game_type) : ''}
                      busy={busy}
                      onUnbind={handleUnbindInstance}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="gp-empty" style={{ padding: '28px 20px' }}>
                <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 14 }}>尚未绑定任何实例</p>
                <p className="gp-text-faint" style={{ margin: 0, fontSize: 12 }}>
                  从下方"可绑定实例"列表选择并绑定，获得 VIP 身份与每日点券福利
                </p>
              </div>
            )}
          </section>

          {/* 向导步骤 2: 可绑定实例列表 */}
          <section>
            <h2 className="gp-section-title" style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <UsersRound size={16} />
              可绑定实例
              {bindableServers.length > 0 && (
                <span className="gp-badge gp-badge-blue gp-mono-num">{bindableServers.length}</span>
              )}
            </h2>
            {loading && servers.length === 0 ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="gp-skeleton" style={{ height: 70 }} />
                ))}
              </div>
            ) : bindableServers.length > 0 ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {bindableServers.map((s) => (
                  <BindableServerRow key={s.id} server={s} busy={busy} onBind={handleBindInstance} />
                ))}
              </div>
            ) : (
              <div className="gp-empty" style={{ padding: '28px 20px' }}>
                <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 14 }}>无可绑定实例</p>
                <p className="gp-text-faint" style={{ margin: 0, fontSize: 12 }}>
                  {servers.length === 0
                    ? '平台暂无实例，请联系服主或管理员'
                    : '已绑定全部可用实例'}
                </p>
                {servers.length > 0 && (
                  <button
                    type="button"
                    className="gp-btn gp-btn-ghost"
                    style={{ marginTop: 12, padding: '8px 14px', fontSize: 12 }}
                    onClick={() => navigate('/guild/servers')}
                  >
                    浏览全部服务器
                  </button>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
