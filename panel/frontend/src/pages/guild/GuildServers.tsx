// ============================================================================
// GuildServers — /guild/servers（v4.38.0 服务器市场改造）
//
// 改造前：仅显示自己已绑定的实例 + 推荐服务器（v4.15.0）
// 改造后：平台级"服务器市场"，所有 is_public=1 实例 + 自己 owner 的实例（合并去重）
//         卡片按 6 种状态展示：
//           1) is_owner=true                      → 进入管理（跳转 /admin/servers/:id）
//           2) is_bound=true                      → 已绑定/进入（跳转 /guild/servers/:id）
//           3) can_direct_bind=true（公开/owner） → 立即绑定（调 bindInstance）
//           4) can_request_bind=true（私有+开放） → 申请绑定（弹窗填留言 → createBindingApplication）
//           5) has_pending_request=true           → 审核中（禁用）
//           6) 私有 + !binding_requests_enabled   → 未开放申请（禁用）
//
// 数据源：GET /api/servers/bindable（带 is_bound/has_pending_request/can_direct_bind/can_request_bind 标记）
// 设计：消费 guild-portal.css 的 gp-* 类（Layout 根容器已挂 .gp-theme）
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  ChevronRight,
  Clock3,
  Compass,
  Crown,
  Gamepad2,
  Globe,
  Lock,
  RefreshCw,
  Search,
  ServerCog,
  Send,
  ShieldX,
  UserPlus,
  X,
} from 'lucide-react';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../components/ui';
import type {
  BindableServer,
  ListBindableServersQuery,
} from '@public/schema/panel-api-types';

// ---------------------------------------------------------------------------
// 常量与工具
// ---------------------------------------------------------------------------

const GAME_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部游戏' },
  { value: 'minecraft', label: 'Minecraft' },
  { value: 'terraria', label: 'Terraria' },
  { value: 'factorio', label: 'Factorio' },
  { value: 'palworld', label: 'Palworld' },
  { value: 'rust', label: 'Rust' },
  { value: 'ark', label: 'ARK' },
  { value: 'valheim', label: 'Valheim' },
  { value: 'dst', label: "Don't Starve Together" },
  { value: 'enshrouded', label: 'Enshrouded' },
  { value: 'zomboid', label: 'Project Zomboid' },
  { value: 'satisfactory', label: 'Satisfactory' },
];

const GAME_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  GAME_TYPE_OPTIONS.filter((o) => o.value).map((o) => [o.value, o.label]),
);

function gameLabel(gameType: string): string {
  return GAME_TYPE_LABEL[gameType] ?? gameType;
}

/** 卡片视觉/行为状态（按优先级判定） */
type CardState =
  | { kind: 'owner' }
  | { kind: 'bound' }
  | { kind: 'can_direct_bind' }
  | { kind: 'can_request_bind' }
  | { kind: 'pending' }
  | { kind: 'closed' };

function deriveCardState(s: BindableServer): CardState {
  if (s.is_owner) return { kind: 'owner' };
  if (s.is_bound) return { kind: 'bound' };
  if (s.can_direct_bind) return { kind: 'can_direct_bind' };
  if (s.has_pending_request) return { kind: 'pending' };
  if (s.can_request_bind) return { kind: 'can_request_bind' };
  return { kind: 'closed' };
}

// ---------------------------------------------------------------------------
// 市场卡片
// ---------------------------------------------------------------------------

interface MarketCardProps {
  server: BindableServer;
  busy: boolean;
  onDirectBind: (server: BindableServer) => void;
  onRequestBind: (server: BindableServer) => void;
}

function MarketCard({ server, busy, onDirectBind, onRequestBind }: MarketCardProps) {
  const navigate = useNavigate();
  const state = deriveCardState(server);
  const isOnline = server.status === 'running';

  // 图标 + 主题色按 is_public 区分
  const Icon = server.is_public ? Globe : Lock;
  const iconBg = server.is_public ? 'var(--gp-grad-primary)' : 'var(--gp-bg-card-strong)';
  const iconBorder = server.is_public ? 'none' : '1px solid var(--gp-border)';
  const iconColor = server.is_public ? '#fff' : 'var(--gp-text-faint)';

  // 主操作按钮 + 状态徽章
  let primaryAction: React.ReactNode = null;
  let statusBadge: React.ReactNode = null;

  if (state.kind === 'owner') {
    statusBadge = (
      <span className="gp-badge gp-badge-violet">
        <Crown size={11} /> 我的实例
      </span>
    );
    primaryAction = (
      <button
        type="button"
        className="gp-btn gp-btn-primary"
        style={{ padding: '6px 12px', fontSize: 12, flexShrink: 0 }}
        onClick={() => navigate(`/admin/servers/${server.id}`)}
      >
        <ServerCog size={12} /> 进入管理
      </button>
    );
  } else if (state.kind === 'bound') {
    statusBadge = (
      <span className="gp-badge gp-badge-emerald">
        <CheckCircle2 size={11} /> 已绑定
      </span>
    );
    primaryAction = (
      <button
        type="button"
        className="gp-btn gp-btn-ghost"
        style={{ padding: '6px 12px', fontSize: 12, flexShrink: 0 }}
        onClick={() => navigate(`/guild/servers/${server.id}`)}
      >
        进入 <ChevronRight size={12} />
      </button>
    );
  } else if (state.kind === 'can_direct_bind') {
    statusBadge = server.is_public ? (
      <span className="gp-badge gp-badge-blue">
        <Globe size={11} /> 公开
      </span>
    ) : null;
    primaryAction = (
      <button
        type="button"
        className="gp-btn gp-btn-primary"
        style={{ padding: '6px 14px', fontSize: 12, flexShrink: 0 }}
        onClick={() => onDirectBind(server)}
        disabled={busy}
      >
        <UserPlus size={12} /> 立即绑定
      </button>
    );
  } else if (state.kind === 'can_request_bind') {
    statusBadge = (
      <span className="gp-badge gp-badge-amber">
        <Lock size={11} /> 私有
      </span>
    );
    primaryAction = (
      <button
        type="button"
        className="gp-btn gp-btn-primary"
        style={{ padding: '6px 14px', fontSize: 12, flexShrink: 0 }}
        onClick={() => onRequestBind(server)}
        disabled={busy}
      >
        <Send size={12} /> 申请绑定
      </button>
    );
  } else if (state.kind === 'pending') {
    statusBadge = (
      <span className="gp-badge gp-badge-amber">
        <Clock3 size={11} /> 审核中
      </span>
    );
    primaryAction = (
      <button
        type="button"
        className="gp-btn gp-btn-ghost"
        style={{ padding: '6px 12px', fontSize: 12, flexShrink: 0 }}
        disabled
      >
        <Clock3 size={12} /> 等待审批
      </button>
    );
  } else {
    // closed
    statusBadge = (
      <span className="gp-badge gp-badge-rose">
        <ShieldX size={11} /> 未开放申请
      </span>
    );
    primaryAction = (
      <button
        type="button"
        className="gp-btn gp-btn-ghost"
        style={{ padding: '6px 12px', fontSize: 12, flexShrink: 0 }}
        disabled
      >
        <Lock size={12} /> 未开放
      </button>
    );
  }

  return (
    <div
      className="gp-card"
      style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 220 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: iconBg,
            border: iconBorder,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: iconColor,
            flexShrink: 0,
          }}
        >
          <Icon size={16} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {statusBadge}
          <span className={`gp-badge ${isOnline ? 'gp-badge-emerald' : ''}`}>
            {isOnline ? '在线' : '离线'}
          </span>
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontWeight: 700,
            fontSize: 14,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {server.name}
        </p>
        <p className="gp-text-faint" style={{ margin: '4px 0 0', fontSize: 12 }}>
          {gameLabel(server.game_type)} · 服主 {server.owner_username || '未知'}
        </p>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto' }}>
        {primaryAction}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 申请绑定弹窗
// ---------------------------------------------------------------------------

interface ApplyModalProps {
  server: BindableServer | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (message: string) => void;
}

function ApplyModal({ server, busy, onClose, onSubmit }: ApplyModalProps) {
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (server) setMessage('');
  }, [server]);
  if (!server) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="gp-card-strong"
        style={{ width: '100%', maxWidth: 420, padding: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
            申请绑定 · {server.name}
          </h3>
          <button
            type="button"
            className="gp-btn gp-btn-ghost"
            style={{ padding: 4 }}
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={14} />
          </button>
        </div>
        <p className="gp-text-faint" style={{ margin: '0 0 12px', fontSize: 12 }}>
          该实例为私有实例，需要服主审批通过后才能绑定。可填写留言向服主说明情况（选填，最多 500 字）。
        </p>
        <textarea
          className="gp-input"
          style={{ width: '100%', minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }}
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 500))}
          placeholder="例如：我是 XXX 的朋友，想加入服务器一起玩……"
          aria-label="申请留言"
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button
            type="button"
            className="gp-btn gp-btn-ghost"
            style={{ padding: '8px 14px', fontSize: 13 }}
            onClick={onClose}
            disabled={busy}
          >
            取消
          </button>
          <button
            type="button"
            className="gp-btn gp-btn-primary"
            style={{ padding: '8px 16px', fontSize: 13 }}
            onClick={() => onSubmit(message.trim())}
            disabled={busy}
          >
            <Send size={13} /> {busy ? '提交中…' : '提交申请'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

const PAGE_SIZE = 24;

export default function GuildServers() {
  const { api } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  useDocumentTitle('服务器市场');

  const [servers, setServers] = useState<BindableServer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // 筛选条件
  const [keyword, setKeyword] = useState('');
  const [gameType, setGameType] = useState('');
  const [committedKeyword, setCommittedKeyword] = useState('');
  const [committedGameType, setCommittedGameType] = useState('');
  const [offset, setOffset] = useState(0);

  // 申请弹窗
  const [applyTarget, setApplyTarget] = useState<BindableServer | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);

  const query: ListBindableServersQuery = useMemo(
    () => ({
      limit: PAGE_SIZE,
      offset,
      game_type: committedGameType || undefined,
      keyword: committedKeyword || undefined,
    }),
    [offset, committedGameType, committedKeyword],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listBindableServers(query);
      setServers(res.servers ?? []);
      setTotal(res.total ?? 0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载服务器市场失败');
    } finally {
      setLoading(false);
    }
  }, [api, toast, query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 筛选条件变化时重置 offset
  useEffect(() => {
    setOffset(0);
  }, [committedKeyword, committedGameType]);

  const handleSearch = () => {
    setCommittedKeyword(keyword.trim());
    setCommittedGameType(gameType);
  };

  const handleResetFilters = () => {
    setKeyword('');
    setGameType('');
    setCommittedKeyword('');
    setCommittedGameType('');
  };

  const handleDirectBind = async (server: BindableServer) => {
    setBusy(true);
    try {
      await api.bindInstance(server.id);
      toast.success(`已绑定「${server.name}」`);
      await refresh();
    } catch (err) {
      if (err instanceof PanelApiError && err.code === 'ALREADY_BOUND') {
        toast.info('已绑定该实例');
        await refresh();
      } else {
        toast.error(err instanceof PanelApiError ? err.message : '绑定失败');
      }
    } finally {
      setBusy(false);
    }
  };

  const openApplyModal = (server: BindableServer) => {
    setApplyTarget(server);
  };

  const handleSubmitApply = async (message: string) => {
    if (!applyTarget) return;
    setApplyBusy(true);
    try {
      await api.createBindingApplication(applyTarget.id, message ? { message } : undefined);
      toast.success(`已提交申请，等待「${applyTarget.name}」服主审批`);
      setApplyTarget(null);
      await refresh();
    } catch (err) {
      const code = err instanceof PanelApiError ? err.code : '';
      if (code === 'BINDING_REQUEST_ALREADY_PENDING') {
        toast.info('已存在待审批的申请，请等待服主处理');
      } else if (code === 'BINDING_REQUEST_ALREADY_BOUND') {
        toast.info('已绑定该实例');
        await refresh();
      } else if (code === 'BINDING_REQUEST_DISABLED') {
        toast.error('该实例已关闭申请通道');
      } else if (code === 'BINDING_REQUEST_PUBLIC_INSTANCE') {
        toast.info('该实例为公开实例，可直接绑定');
        await refresh();
      } else {
        toast.error(err instanceof PanelApiError ? err.message : '提交申请失败');
      }
    } finally {
      setApplyBusy(false);
    }
  };

  const hasFilters = committedKeyword !== '' || committedGameType !== '';
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 页头 */}
      <div className="gp-hero" style={{ padding: '20px 20px' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>服务器市场</h1>
            <p className="gp-text-dim" style={{ margin: '6px 0 0', fontSize: 13 }}>
              浏览平台所有公开实例并申请加入，或对私有实例提交绑定申请
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* v4.38.0: 跳转"我的绑定申请"页面（查看提交的申请进度 + 撤销 pending） */}
            <button
              type="button"
              className="gp-btn gp-btn-ghost"
              style={{ padding: '8px 14px', fontSize: 13 }}
              onClick={() => navigate('/guild/my-binding-requests')}
              title="查看我提交的绑定申请进度"
            >
              <Clock3 size={14} />
              我的申请
            </button>
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
      </div>

      {/* 筛选条 */}
      <section className="gp-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 220 }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--gp-text-faint)',
                pointerEvents: 'none',
              }}
            />
            <input
              className="gp-input"
              style={{ width: '100%', paddingLeft: 30 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索实例名"
              aria-label="搜索实例名"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch();
              }}
            />
          </div>
          <select
            className="gp-input"
            style={{ flex: '0 0 auto', minWidth: 130 }}
            value={gameType}
            onChange={(e) => setGameType(e.target.value)}
            aria-label="游戏类型筛选"
          >
            {GAME_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="gp-btn gp-btn-primary"
            style={{ padding: '8px 16px', fontSize: 13 }}
            onClick={handleSearch}
          >
            <Search size={13} /> 筛选
          </button>
          {hasFilters && (
            <button
              type="button"
              className="gp-btn gp-btn-ghost"
              style={{ padding: '8px 12px', fontSize: 13 }}
              onClick={handleResetFilters}
            >
              <X size={13} /> 清空
            </button>
          )}
        </div>
        <div className="gp-text-faint" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <Compass size={12} />
          共 <span className="gp-mono-num">{total}</span> 个实例
          {hasFilters && '（已筛选）'}
        </div>
      </section>

      {/* 市场列表 */}
      <section>
        {loading && servers.length === 0 ? (
          <div
            style={{
              display: 'grid',
              gap: 10,
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            }}
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="gp-skeleton" style={{ height: 160 }} />
            ))}
          </div>
        ) : servers.length > 0 ? (
          <>
            <div
              style={{
                display: 'grid',
                gap: 10,
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              }}
            >
              {servers.map((s) => (
                <MarketCard
                  key={s.id}
                  server={s}
                  busy={busy}
                  onDirectBind={handleDirectBind}
                  onRequestBind={openApplyModal}
                />
              ))}
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 20,
                }}
              >
                <button
                  type="button"
                  className="gp-btn gp-btn-ghost"
                  style={{ padding: '6px 12px', fontSize: 12 }}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={offset === 0 || loading}
                >
                  上一页
                </button>
                <span className="gp-text-dim" style={{ fontSize: 12 }}>
                  第 <span className="gp-mono-num">{currentPage}</span> / <span className="gp-mono-num">{totalPages}</span> 页
                </span>
                <button
                  type="button"
                  className="gp-btn gp-btn-ghost"
                  style={{ padding: '6px 12px', fontSize: 12 }}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={offset + PAGE_SIZE >= total || loading}
                >
                  下一页
                </button>
              </div>
            )}
          </>
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
              <Compass size={22} />
            </div>
            <p style={{ margin: '12px 0 4px', fontWeight: 600, fontSize: 14 }}>
              {hasFilters ? '没有符合筛选条件的实例' : '暂无可浏览的实例'}
            </p>
            <p className="gp-text-faint" style={{ margin: 0, fontSize: 12 }}>
              {hasFilters
                ? '尝试更换关键词或游戏类型'
                : '平台暂无公开实例，你也还没有创建过实例'}
            </p>
            {!hasFilters && (
              <button
                type="button"
                className="gp-btn gp-btn-primary"
                style={{ marginTop: 16, padding: '10px 22px', fontSize: 13 }}
                onClick={() => navigate('/servers/new')}
              >
                <Gamepad2 size={14} /> 创建第一个实例
              </button>
            )}
          </div>
        )}
      </section>

      {/* 申请绑定弹窗 */}
      <ApplyModal
        server={applyTarget}
        busy={applyBusy}
        onClose={() => !applyBusy && setApplyTarget(null)}
        onSubmit={handleSubmitApply}
      />
    </div>
  );
}
