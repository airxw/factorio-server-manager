// ============================================================================
// GuildServers — /guild/servers（v4.15.0 我的服务器 + 推荐服务器）
//
// 数据源：
//   我的服务器  → GET /api/servers（user 角色后端按 bindings: account/instance/verified 过滤）
//   推荐服务器  → GET /api/discover/recommended（公开数据）
// 设计：深色电竞风，消费 guild-portal.css 的 gp-* 类（Layout 根容器已挂 .gp-theme）
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Compass, Gamepad2, RefreshCw, Server, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../api/auth';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../components/ui';
import type { DiscoverServer, ServerSummary } from '@public/schema/panel-api-types';

/** 我的服务器卡片（绑定实例） */
function MyServerCard({ server }: { server: ServerSummary }) {
  const navigate = useNavigate();
  const isOnline = server.status === 'running';
  return (
    <button
      type="button"
      onClick={() => navigate(`/guild/servers/${server.id}`)}
      className="gp-card gp-card-hover"
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16, width: '100%', textAlign: 'left', cursor: 'pointer' }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: 'var(--gp-grad-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          flexShrink: 0,
        }}
      >
        <Gamepad2 size={20} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {server.name}
          </p>
          <span className={`gp-dot ${isOnline ? 'gp-dot-online' : 'gp-dot-offline'}`} title={isOnline ? '在线' : '离线'} />
        </div>
        <p className="gp-text-faint" style={{ margin: '4px 0 0', fontSize: 12 }}>
          {server.game_type} · 服主 {server.owner_username || '未知'}
        </p>
      </div>
      <span className={`gp-badge ${isOnline ? 'gp-badge-emerald' : ''}`}>
        {isOnline ? '在线' : '离线'}
      </span>
      <ChevronRight size={16} className="gp-text-faint" style={{ flexShrink: 0 }} />
    </button>
  );
}

/** 推荐服务器卡片（发现页公开数据） */
function RecommendCard({ server }: { server: DiscoverServer }) {
  const navigate = useNavigate();
  const isOnline = server.status === 'running';
  return (
    <button
      type="button"
      onClick={() => navigate(`/guild/servers/${server.id}`)}
      className="gp-card gp-card-hover"
      style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, textAlign: 'left', cursor: 'pointer', minWidth: 200 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: 'var(--gp-grad-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
          }}
        >
          <Server size={16} />
        </div>
        <span className={`gp-badge ${isOnline ? 'gp-badge-emerald' : ''}`}>
          {isOnline ? '在线' : '离线'}
        </span>
      </div>
      <div>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {server.name}
        </p>
        <p className="gp-text-faint" style={{ margin: '4px 0 0', fontSize: 12 }}>
          {server.pack_id}
          {server.owner_username ? ` · ${server.owner_username}` : ''}
        </p>
      </div>
      <div className="gp-text-dim" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
        <Users size={12} />
        <span className="gp-mono-num">{server.online_players}</span> 人在线
      </div>
    </button>
  );
}

export default function GuildServers() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  useDocumentTitle('我的服务器');

  const [myServers, setMyServers] = useState<ServerSummary[]>([]);
  const [recommended, setRecommended] = useState<DiscoverServer[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [mineRes, recRes] = await Promise.all([
        api.listServers().catch(() => ({ servers: [] as ServerSummary[] })),
        api.discoverRecommended(8).catch(() => ({ servers: [] as DiscoverServer[] })),
      ]);
      setMyServers(mineRes.servers ?? []);
      setRecommended(recRes.servers ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载服务器失败');
    } finally {
      setLoading(false);
    }
  }, [api, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 页头 */}
      <div className="gp-hero" style={{ padding: '20px 20px' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>我的服务器</h1>
            <p className="gp-text-dim" style={{ margin: '6px 0 0', fontSize: 13 }}>
              你绑定角色所在的游戏实例，一键进入店铺
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

      {/* 我的服务器 */}
      <section>
        <h2 className="gp-section-title" style={{ margin: '0 0 12px' }}>
          <Gamepad2 size={16} />
          绑定实例
          <span className="gp-badge gp-badge-violet gp-mono-num">{myServers.length}</span>
        </h2>
        {loading && myServers.length === 0 ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="gp-skeleton" style={{ height: 76 }} />
            ))}
          </div>
        ) : myServers.length > 0 ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {myServers.map((s) => (
              <MyServerCard key={s.id} server={s} />
            ))}
          </div>
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
            <p style={{ margin: '12px 0 4px', fontWeight: 600, fontSize: 14 }}>还没有绑定任何服务器角色</p>
            <p className="gp-text-faint" style={{ margin: 0, fontSize: 12 }}>
              绑定游戏角色后，对应服务器会出现在这里
            </p>
            <button
              type="button"
              className="gp-btn gp-btn-primary"
              style={{ marginTop: 16, padding: '10px 22px', fontSize: 13 }}
              onClick={() => navigate('/guild/bind')}
            >
              立即绑定
            </button>
          </div>
        )}
      </section>

      {/* 推荐服务器 */}
      <section>
        <h2 className="gp-section-title" style={{ margin: '0 0 12px' }}>
          <Compass size={16} />
          推荐服务器
          <button
            type="button"
            className="gp-text-faint"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 2 }}
            onClick={() => navigate('/guild/discover')}
          >
            更多 <ChevronRight size={12} />
          </button>
        </h2>
        {loading && recommended.length === 0 ? (
          <div className="gp-hscroll">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="gp-skeleton" style={{ height: 140, minWidth: 200 }} />
            ))}
          </div>
        ) : recommended.length > 0 ? (
          <div className="gp-hscroll">
            {recommended.map((s) => (
              <RecommendCard key={s.id} server={s} />
            ))}
          </div>
        ) : (
          <div className="gp-empty" style={{ padding: '24px 20px', fontSize: 13 }}>
            暂无推荐服务器
          </div>
        )}
      </section>
    </div>
  );
}
