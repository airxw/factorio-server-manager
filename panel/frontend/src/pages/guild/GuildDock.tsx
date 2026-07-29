// ============================================================================
// GuildDock — /guild 首页（v4.17.0 信息架构重做）
//
// v4.17.0 变更（按 docs/plans/binding-unification-multi-role-plan.md §7.1）：
//   1. 删除 QUICK_ACTIONS 中重复的"绑定角色"入口（与空状态卡片重复）
//   2. 按 binding_type 分区：账户级（bindings: account/instance）+ 游戏角色级（bindings: player/game_type）
//   3. pending 验证码在首页卡片内直接展示（不再需要跳转 Profile 页面）
//   4. 多角色账号显示"切换角色"入口
//   5. 移动端视口守卫：min-height: 100dvh + overflow-y: auto
//
// 数据源：
//   GET /api/my/overview              → 资产概览数字带
//   GET /api/profile/bindings         → 账户级绑定（user↔instance，含 VIP）
//   GET /api/player-bindings          → 游戏角色级绑定（含 pending 验证码）
//   GET /api/servers                  → 实例元信息（用于账户级卡片展示）
//   GET /api/notifications            → 通知公告
//   GET /api/servers/:id/wallet + POST .../claim-daily → 每日福利真实领取
// 渲染安全：无无限动画/Canvas，pop-in 为一次性动效（IdentitySelector 黑屏教训）
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BadgeCheck,
  Bell,
  ChevronRight,
  Coins,
  Copy,
  Crown,
  Gamepad2,
  Gift,
  KeyRound,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  UserPlus,
  UsersRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../components/ui';
import { notificationStore } from '../../stores/notificationStore';
import RoleSwitcherModal from '../../components/RoleSwitcherModal';
import type { MyBinding } from '../../api/modules/auth';
import type {
  MyOverview,
  Binding,
  ServerSummary,
  UserRole,
  WalletInfo,
} from '@public/schema/panel-api-types';

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(dateStr).toLocaleDateString('zh-CN');
}

// ---------------------------------------------------------------------------
// 角色元数据（与 RoleSwitcherModal 对齐）
// ---------------------------------------------------------------------------

const ROLE_LABEL: Record<UserRole, string> = {
  user: '玩家',
  instance_admin: '服主',
  server_admin: '管理员',
};

// ---------------------------------------------------------------------------
// 子组件
// ---------------------------------------------------------------------------

interface QuickAction {
  to: string;
  label: string;
  desc: string;
  icon: LucideIcon;
}

// v4.17.0: 移除"绑定角色"重复入口（与空状态卡片重复）
const QUICK_ACTIONS: QuickAction[] = [
  { to: '/guild/shop', label: '游戏商城', desc: '点券与道具', icon: ShoppingBag },
  { to: '/guild/cdk', label: 'CDK兑换', desc: '卡密领礼包', icon: KeyRound },
  { to: '/guild/orders', label: '我的订单', desc: '购买记录', icon: Coins },
  { to: '/guild/me', label: '我的资产', desc: '钱包与绑定', icon: Wallet },
];

/** 我的服务器横滑卡片 */
function ServerChip({ server }: { server: ServerSummary }) {
  const navigate = useNavigate();
  const isOnline = server.status === 'running';
  return (
    <button
      type="button"
      onClick={() => navigate(`/guild/servers/${server.id}`)}
      className="gp-card gp-card-hover"
      style={{ minWidth: 190, padding: 14, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: 'var(--gp-grad-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
          }}
        >
          <Gamepad2 size={15} />
        </div>
        <span className={`gp-dot ${isOnline ? 'gp-dot-online' : 'gp-dot-offline'}`} />
      </div>
      <p style={{ margin: 0, fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {server.name}
      </p>
      <p className="gp-text-faint" style={{ margin: 0, fontSize: 11 }}>
        {server.game_type}
      </p>
    </button>
  );
}

/** 账户级绑定卡片（user↔instance） */
function AccountBindingCard({
  binding,
  serverName,
  gameType,
}: {
  binding: MyBinding;
  serverName: string;
  gameType: string;
}) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/guild/servers/${binding.serverId}`)}
      className="gp-card gp-card-hover"
      style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', textAlign: 'left' }}
    >
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
          {gameType} · VIP{binding.vipLevel}
        </p>
      </div>
      <ChevronRight size={16} className="gp-text-faint" />
    </button>
  );
}

/** 游戏角色级绑定卡片（user↔game_player） */
function PlayerBindingCard({ binding }: { binding: Binding }) {
  const toast = useToast();
  const isVerified = binding.verify_status === 'verified';
  const isPending = binding.verify_status === 'pending';

  const copyCode = () => {
    if (!binding.verify_code) return;
    void navigator.clipboard
      .writeText(binding.verify_code)
      .then(() => toast.success('验证码已复制'))
      .catch(() => toast.error('复制失败'));
  };

  return (
    <div
      className="gp-card"
      style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: isVerified ? 'var(--gp-grad-primary)' : 'var(--gp-bg-card-strong)',
            border: isVerified ? 'none' : '1px solid var(--gp-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: isVerified ? '#fff' : 'var(--gp-text-faint)',
            flexShrink: 0,
          }}
        >
          <Gamepad2 size={18} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {binding.player_name ?? ''}
            </p>
            {isVerified ? (
              <span className="gp-badge gp-badge-emerald">
                <BadgeCheck size={11} /> 已验证
              </span>
            ) : isPending ? (
              <span className="gp-badge gp-badge-amber">
                <KeyRound size={11} /> 待验证
              </span>
            ) : (
              <span className="gp-badge gp-badge-rose">已失效</span>
            )}
          </div>
          <p className="gp-text-faint" style={{ margin: '3px 0 0', fontSize: 12 }}>
            {binding.scope_ref ?? ''}
          </p>
        </div>
      </div>

      {/* v4.17.0: pending 态在首页卡片内直接展示验证码（不再需要跳转 Profile 页面） */}
      {isPending && binding.verify_code && (
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
          <span className="gp-text-dim" style={{ fontSize: 12 }}>游戏内输入：</span>
          <code
            className="gp-mono-num"
            style={{ fontSize: 14, fontWeight: 700, color: 'var(--gp-amber)', letterSpacing: '0.08em' }}
          >
            {binding.verify_code}
          </code>
          <button
            type="button"
            className="gp-btn gp-btn-ghost"
            style={{ padding: '4px 10px', fontSize: 12 }}
            onClick={copyCode}
            aria-label="复制验证码"
          >
            <Copy size={12} /> 复制
          </button>
        </div>
      )}
    </div>
  );
}

/** 每日福利卡（真实 wallet API） */
function DailyRewardCard({
  server,
  wallet,
  claiming,
  onClaim,
}: {
  server: ServerSummary;
  wallet: WalletInfo | undefined;
  claiming: boolean;
  onClaim: (serverId: string) => void;
}) {
  const canClaim = wallet?.can_claim_daily ?? false;
  return (
    <div
      className="gp-card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px',
        ...(canClaim ? { borderColor: 'rgba(251, 191, 36, 0.4)' } : {}),
      }}
    >
      <Gift size={16} style={{ color: canClaim ? 'var(--gp-amber)' : 'var(--gp-text-faint)', flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {server.name}
        </p>
        <p className="gp-text-faint" style={{ margin: '2px 0 0', fontSize: 11 }}>
          {canClaim ? `可领 ${wallet?.daily_reward_amount ?? 0} 点券` : '今日已领取'}
        </p>
      </div>
      <button
        type="button"
        className={`gp-btn ${canClaim ? 'gp-btn-primary' : 'gp-btn-ghost'}`}
        style={{ padding: '6px 14px', fontSize: 12, flexShrink: 0 }}
        disabled={!canClaim || claiming}
        onClick={() => onClaim(server.id)}
      >
        {claiming ? '领取中…' : canClaim ? '领取' : '已领'}
      </button>
    </div>
  );
}

/** 通知条目 */
function NotificationItem({ item }: { item: { id: number; title: string; body?: string; level?: string; created_at: string; read?: boolean } }) {
  const levelColor: Record<string, string> = {
    info: 'var(--gp-cyan)',
    warning: 'var(--gp-amber)',
    error: 'var(--gp-rose)',
    success: 'var(--gp-emerald)',
  };
  const color = levelColor[item.level ?? 'info'] ?? levelColor.info;
  return (
    <div
      className="gp-card"
      style={{ padding: '10px 12px', borderLeft: `3px solid ${color}`, opacity: item.read ? 0.6 : 1 }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{item.title}</p>
        <span className="gp-text-faint" style={{ fontSize: 10, flexShrink: 0 }}>{formatTimeAgo(item.created_at)}</span>
      </div>
      {item.body && (
        <p className="gp-text-dim" style={{ margin: '4px 0 0', fontSize: 12, lineHeight: 1.5 }}>{item.body}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export default function GuildDock() {
  const { api, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  useDocumentTitle('玩家门户');

  const [overview, setOverview] = useState<MyOverview | null>(null);
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [accountBindings, setAccountBindings] = useState<MyBinding[]>([]);
  const [playerBindings, setPlayerBindings] = useState<Binding[]>([]);
  const [notifications, setNotifications] = useState<Array<{ id: number; title: string; body?: string; level?: string; created_at: string; read?: boolean }>>([]);
  const [wallets, setWallets] = useState<Record<string, WalletInfo>>({});
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [justClaimed, setJustClaimed] = useState<string | null>(null);
  // v4.17.0: 角色切换弹窗状态
  const [roleSwitcherOpen, setRoleSwitcherOpen] = useState(false);
  // v4.17.0: pending 验证码倒计时刷新 tick
  const [nowTick, setNowTick] = useState(Date.now());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewRes, serversRes, accountRes, playerRes] = await Promise.all([
        api.getMyOverview().catch(() => null),
        api.listServers().catch(() => ({ servers: [] as ServerSummary[] })),
        api.listMyBindings().catch(() => [] as MyBinding[]),
        api.listPlayerBindings().catch(() => ({ bindings: [] as Binding[] })),
      ]);
      if (overviewRes) setOverview(overviewRes.overview);
      const srvList = serversRes.servers ?? [];
      setServers(srvList);
      setAccountBindings(accountRes);
      setPlayerBindings(playerRes.bindings ?? []);
      // v4.14.2: 通知从 notificationStore 读取（单一数据源，消除重复请求）
      setNotifications(notificationStore.getRecentNotifications().slice(0, 5));

      // 拉取各实例钱包（每日福利状态），逐实例容错
      const walletEntries = await Promise.all(
        srvList.map(async (s) => {
          try {
            const res = await api.getWallet(s.id);
            return [s.id, res.wallet] as const;
          } catch {
            return [s.id, undefined] as const;
          }
        }),
      );
      const walletMap: Record<string, WalletInfo> = {};
      for (const [id, w] of walletEntries) {
        if (w) walletMap[id] = w;
      }
      setWallets(walletMap);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [api, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // v4.14.2: 订阅 notificationStore 实时更新——新通知到达时刷新首页通知列表
  useEffect(() => {
    const unsub = notificationStore.onNotificationNew(() => {
      setNotifications(notificationStore.getRecentNotifications().slice(0, 5));
    });
    return unsub;
  }, []);

  // v4.17.0: pending 验证码倒计时——每 30s 刷新一次时间戳驱动倒计时重渲染
  useEffect(() => {
    const hasPending = playerBindings.some((b) => b.verify_status === 'pending');
    if (!hasPending) return;
    const timer = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [playerBindings]);

  // 每日福利领取（真实 API）
  const handleClaim = useCallback(
    async (serverId: string) => {
      setClaimingId(serverId);
      try {
        const res = await api.claimDailyReward(serverId);
        setWallets((prev) => ({ ...prev, [serverId]: res.wallet }));
        setJustClaimed(serverId);
        toast.success(`领取成功 +${res.claimed_amount} 点券`);
        // 一次性 pop-in 动效后清除标记
        setTimeout(() => setJustClaimed(null), 400);
        // 同步 overview 计数
        setOverview((prev) =>
          prev
            ? { ...prev, daily_claimable: Math.max(0, prev.daily_claimable - 1), wallet_balance: prev.wallet_balance + res.claimed_amount }
            : prev,
        );
      } catch (err) {
        toast.error(err instanceof PanelApiError ? err.message : '领取失败');
      } finally {
        setClaimingId(null);
      }
    },
    [api, toast],
  );

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 6) return '夜深了，注意休息';
    if (h < 12) return '早上好，勇士';
    if (h < 14) return '中午好，该吃午饭啦';
    if (h < 18) return '下午好，来玩一会吧';
    return '晚上好，准备开黑吗';
  }, []);

  // v4.17.0: 多角色判定
  const userRoles = (user?.roles ?? (user ? [user.role] : [])) as UserRole[];
  const currentActiveRole = (user?.active_role ?? user?.role ?? 'user') as UserRole;
  const isMultiRole = userRoles.length > 1;

  // 实例 ID → 元信息映射（用于账户级绑定卡片展示实例名/游戏类型）
  const serverMap = useMemo(() => {
    const m = new Map<string, ServerSummary>();
    for (const s of servers) m.set(s.id, s);
    return m;
  }, [servers]);

  const claimableServers = servers.filter((s) => wallets[s.id]?.can_claim_daily);
  const stats = [
    { label: '账户绑定', value: accountBindings.length, to: '/guild/bind' },
    { label: '钱包余额', value: overview?.wallet_balance ?? 0, to: '/guild/me' },
    { label: '进行中订单', value: overview?.pending_orders ?? 0, to: '/guild/orders' },
    { label: '未读消息', value: overview?.unread_notifications ?? 0, to: '/guild/notifications' },
  ];

  // nowTick 引用，避免 TS 未使用警告
  void nowTick;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minHeight: '100dvh' }}>
      {/* 精简欢迎头区 + 角色标识 */}
      <div style={{ padding: '20px 0 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sparkles size={15} style={{ color: 'var(--gp-amber)' }} />
          <span className="gp-text-dim" style={{ fontSize: 13 }}>{greeting}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1 style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em' }}>
              {user?.username ?? '玩家'}
            </h1>
            <p className="gp-text-dim" style={{ margin: '4px 0 0', fontSize: 13 }}>
              {overview && overview.bindings_verified > 0
                ? `已验证 ${overview.bindings_verified} 个角色`
                : '绑定游戏角色即可畅享商城、礼包、社区互动'}
            </p>
          </div>
          {/* v4.17.0: 当前角色徽章 + 切换入口（仅多角色账号可见） */}
          {user && (
            <button
              type="button"
              onClick={() => (isMultiRole ? setRoleSwitcherOpen(true) : navigate('/guild/profile'))}
              className="gp-card gp-card-hover"
              style={{
                padding: '8px 12px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                border: '1px solid var(--gp-border)',
                background: 'var(--gp-bg-card)',
              }}
              aria-label={isMultiRole ? '切换角色' : '查看个人设置'}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 8,
                  background: 'var(--gp-grad-primary)',
                  color: '#fff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {ROLE_LABEL[currentActiveRole]?.[0] ?? 'U'}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{ROLE_LABEL[currentActiveRole] ?? currentActiveRole}</span>
              {isMultiRole && <RefreshCw size={12} className="gp-text-faint" />}
            </button>
          )}
        </div>
      </div>

      {/* 账户级绑定区（binding_type='account'，user↔instance VIP/钱包） */}
      <section>
        <h2 className="gp-section-title" style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Crown size={18} style={{ color: 'var(--gp-amber)' }} />
          账户级绑定
          {accountBindings.length > 0 && (
            <span className="gp-badge gp-badge-blue gp-mono-num">{accountBindings.length}</span>
          )}
          <button
            type="button"
            className="gp-text-faint"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 2, padding: '4px 8px', color: 'var(--gp-blue)' }}
            onClick={() => navigate('/guild/servers')}
          >
            全部 <ChevronRight size={14} />
          </button>
        </h2>
        {loading && accountBindings.length === 0 ? (
          <div className="gp-hscroll">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="gp-skeleton" style={{ height: 70, minWidth: 220 }} />
            ))}
          </div>
        ) : accountBindings.length > 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {accountBindings.slice(0, 5).map((b) => {
              const srv = serverMap.get(b.serverId);
              return (
                <AccountBindingCard
                  key={b.id}
                  binding={b}
                  serverName={srv?.name ?? b.serverId}
                  gameType={srv?.game_type ?? ''}
                />
              );
            })}
          </div>
        ) : (
          <div className="gp-card" style={{ padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>还没有绑定任何实例</p>
              <p className="gp-text-faint" style={{ margin: '4px 0 0', fontSize: 12 }}>
                绑定实例后即可获得 VIP 身份、每日点券福利
              </p>
            </div>
            <button
              type="button"
              className="gp-btn gp-btn-primary"
              style={{ padding: '8px 18px', fontSize: 13 }}
              onClick={() => navigate('/guild/servers')}
            >
              <UsersRound size={14} />
              浏览服务器
            </button>
          </div>
        )}
      </section>

      {/* 游戏角色级绑定区（binding_type='player'，user↔game_player 验证码） */}
      <section>
        <h2 className="gp-section-title" style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Gamepad2 size={18} />
          游戏角色绑定
          {playerBindings.length > 0 && (
            <span className="gp-badge gp-badge-blue gp-mono-num">{playerBindings.length}</span>
          )}
          <button
            type="button"
            className="gp-text-faint"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 2, padding: '4px 8px', color: 'var(--gp-blue)' }}
            onClick={() => navigate('/guild/bind')}
          >
            管理 <ChevronRight size={14} />
          </button>
        </h2>
        {loading && playerBindings.length === 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="gp-skeleton" style={{ height: 70 }} />
            ))}
          </div>
        ) : playerBindings.length > 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {playerBindings.slice(0, 5).map((b) => (
              <PlayerBindingCard key={b.id} binding={b} />
            ))}
          </div>
        ) : (
          <div className="gp-card" style={{ padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>还没有绑定游戏角色</p>
              <p className="gp-text-faint" style={{ margin: '4px 0 0', fontSize: 12 }}>
                绑定游戏内角色后即可在商城购买道具并自动到账
              </p>
            </div>
            <button
              type="button"
              className="gp-btn gp-btn-primary"
              style={{ padding: '8px 18px', fontSize: 13 }}
              onClick={() => navigate('/guild/bind')}
            >
              <UserPlus size={14} />
              立即绑定
            </button>
          </div>
        )}
      </section>

      {/* 我的服务器——快速进入实例列表（保留横滑卡片带） */}
      <section>
        <h2 className="gp-section-title" style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Gamepad2 size={18} />
          我的服务器
          {servers.length > 0 && (
            <span className="gp-badge gp-badge-blue gp-mono-num">{servers.length}</span>
          )}
          <button
            type="button"
            className="gp-text-faint"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 2, padding: '4px 8px', color: 'var(--gp-blue)' }}
            onClick={() => navigate('/guild/servers')}
          >
            全部 <ChevronRight size={14} />
          </button>
        </h2>
        {loading && servers.length === 0 ? (
          <div className="gp-hscroll">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="gp-skeleton" style={{ height: 110, minWidth: 190 }} />
            ))}
          </div>
        ) : servers.length > 0 ? (
          <div className="gp-hscroll">
            {servers.map((s) => (
              <ServerChip key={s.id} server={s} />
            ))}
          </div>
        ) : null}
      </section>

      {/* 资产概览数字带 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
        }}
      >
        {stats.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => navigate(s.to)}
            className="gp-card gp-card-hover"
            style={{ padding: '12px 10px', textAlign: 'center', cursor: 'pointer' }}
          >
            <p className="gp-stat-value gp-mono-num" style={{ margin: 0, fontSize: 18 }}>
              {loading && !overview ? '—' : s.value}
            </p>
            <p className="gp-stat-label" style={{ margin: '4px 0 0', fontSize: 11 }}>{s.label}</p>
          </button>
        ))}
      </div>

      {/* 快捷功能入口（v4.17.0: 删除"绑定角色"重复项，已移至独立分区） */}
      <section>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                type="button"
                onClick={() => navigate(action.to)}
                className="gp-card gp-card-hover"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '14px 8px', textAlign: 'center', cursor: 'pointer' }}
              >
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
                  <Icon size={18} />
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{action.label}</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 每日福利 + 通知公告 */}
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {/* 每日福利（真实 wallet API） */}
        <section className="gp-card" style={{ padding: 16 }}>
          <h2 className="gp-section-title" style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 16 }}>
            <Gift size={16} style={{ color: 'var(--gp-amber)' }} />
            每日福利
            {claimableServers.length > 0 && (
              <span className="gp-badge gp-badge-orange gp-mono-num" style={{ fontSize: 10 }}>{claimableServers.length} 可领</span>
            )}
          </h2>
          {loading && servers.length === 0 ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="gp-skeleton" style={{ height: 56 }} />
              ))}
            </div>
          ) : servers.length > 0 ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {servers.map((s) => (
                <div key={s.id} className={justClaimed === s.id ? 'gp-pop-in' : undefined}>
                  <DailyRewardCard server={s} wallet={wallets[s.id]} claiming={claimingId === s.id} onClaim={handleClaim} />
                </div>
              ))}
            </div>
          ) : (
            <p className="gp-text-faint" style={{ margin: 0, fontSize: 12 }}>
              绑定实例后每日登录可领取点券奖励
            </p>
          )}
        </section>

        {/* 通知公告 */}
        <section className="gp-card" style={{ padding: 16 }}>
          <h2 className="gp-section-title" style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 16 }}>
            <Bell size={16} />
            通知公告
            {(overview?.unread_notifications ?? 0) > 0 && (
              <span className="gp-badge gp-badge-red gp-mono-num" style={{ fontSize: 10 }}>{overview!.unread_notifications}</span>
            )}
            <button
              type="button"
              className="gp-text-faint"
              style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--gp-blue)', padding: '2px 6px' }}
              onClick={() => navigate('/guild/notifications')}
            >
              全部 <ChevronRight size={12} />
            </button>
          </h2>
          {loading && notifications.length === 0 ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="gp-skeleton" style={{ height: 52 }} />
              ))}
            </div>
          ) : notifications.length > 0 ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {notifications.map((n) => (
                <NotificationItem key={n.id} item={n} />
              ))}
            </div>
          ) : (
            <div style={{ padding: '20px 0', textAlign: 'center' }}>
              <Wallet size={18} className="gp-text-faint" />
              <p className="gp-text-faint" style={{ margin: '8px 0 0', fontSize: 12 }}>暂无通知</p>
            </div>
          )}
        </section>
      </div>

      {/* v4.17.0: 角色切换弹窗 */}
      <RoleSwitcherModal open={roleSwitcherOpen} onClose={() => setRoleSwitcherOpen(false)} />
    </div>
  );
}
