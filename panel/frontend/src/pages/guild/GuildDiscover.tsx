// ============================================================================
// GuildDiscover — /guild/discover（v4.16.1 玩家门户发现页）
//
// 设计：Apple 浅色系（gp-* 类），移动端优先，App Store 风格
// 功能：推荐服务器横幅、热门/新开Tab、搜索筛选、服务器卡片
// API：discoverHot / discoverNew / discoverRecommended（公开接口）
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  Clock,
  Flame,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  Star,
  Users,
} from 'lucide-react';
import type { DiscoverServer } from '@public/schema/panel-api-types';
import { useAuth } from '../../api/auth';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { EmptyState, Skeleton } from '../../components/ui';

type Tab = 'recommended' | 'hot' | 'new';

interface DiscoverData {
  recommended: DiscoverServer[];
  hot: DiscoverServer[];
  newServers: DiscoverServer[];
}

const PACK_GAME_MAP: Record<string, string> = {
  minecraft: 'Minecraft',
  minecraft_java: 'Minecraft',
  terraria: 'Terraria',
  palworld: 'Palworld',
  rust: 'Rust',
  ark: 'ARK',
  factorio: 'Factorio',
  '7daystodie': '七日杀',
  projectzomboid: '僵尸毁灭工程',
  enshence: '幻兽帕鲁',
};

function gameLabel(packId: string): string {
  const lower = packId.toLowerCase();
  for (const [key, label] of Object.entries(PACK_GAME_MAP)) {
    if (lower.includes(key)) return label;
  }
  return packId.length > 12 ? `${packId.slice(0, 10)}...` : packId;
}

function gameInitial(packId: string): string {
  return gameLabel(packId).charAt(0).toUpperCase();
}

function formatTimeAgo(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffDay < 1) return '今日新开';
  if (diffDay < 7) return `${diffDay}天前开服`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}周前开服`;
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function ServerCard({ server }: { server: DiscoverServer }) {
  const navigate = useNavigate();
  const online = server.status === 'running';

  return (
    <div
      className="gp-card gp-card-hover"
      style={{ padding: 16, cursor: 'pointer' }}
      onClick={() => navigate(`/guild/servers/${server.id}`)}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: online ? 'var(--gp-blue-bg)' : 'var(--gp-bg-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: online ? 'var(--gp-blue)' : 'var(--gp-text-tert)',
            flexShrink: 0,
            fontSize: 20,
            fontWeight: 700,
          }}
        >
          <Server size={22} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--gp-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}
            >
              {server.name}
            </span>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: online ? 'var(--gp-green)' : 'var(--gp-text-tert)',
                flexShrink: 0,
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span
              className="gp-badge"
              style={{
                background: 'var(--gp-bg-2)',
                color: 'var(--gp-text-sec)',
                fontSize: 11,
              }}
            >
              {gameLabel(server.pack_id)}
            </span>
            <span
              className="gp-badge"
              style={{
                background: online ? 'rgba(52,199,89,0.12)' : 'var(--gp-bg-2)',
                color: online ? 'var(--gp-green)' : 'var(--gp-text-tert)',
                fontSize: 11,
              }}
            >
              <Users size={11} style={{ marginRight: 3 }} />
              {server.online_players} 人在线
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--gp-text-tert)' }}>
            {server.owner_username && (
              <>
                <span>服主：{server.owner_username}</span>
                <span>·</span>
              </>
            )}
            <Clock size={12} />
            <span>{formatTimeAgo(server.created_at)}</span>
          </div>
        </div>

        <ChevronRight size={18} style={{ color: 'var(--gp-text-tert)', flexShrink: 0, marginTop: 14 }} />
      </div>
    </div>
  );
}

function ServerCardSkeleton() {
  return (
    <div className="gp-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <Skeleton style={{ width: 52, height: 52, borderRadius: 14, flexShrink: 0 }} />
        <div style={{ flex: 1, display: 'grid', gap: 8 }}>
          <Skeleton style={{ height: 16, width: '60%', borderRadius: 4 }} />
          <Skeleton style={{ height: 12, width: '40%', borderRadius: 4 }} />
          <Skeleton style={{ height: 12, width: '50%', borderRadius: 4 }} />
        </div>
      </div>
    </div>
  );
}

export default function GuildDiscover() {
  const { api } = useAuth();
  const navigate = useNavigate();
  useDocumentTitle('发现');

  const [data, setData] = useState<DiscoverData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('recommended');
  const [search, setSearch] = useState('');
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [recRes, hotRes, newRes] = await Promise.all([
        api.discoverRecommended(8),
        api.discoverHot(10),
        api.discoverNew(10),
      ]);
      if (!cancelledRef.current) {
        setData({
          recommended: recRes.servers ?? [],
          hot: hotRes.servers ?? [],
          newServers: newRes.servers ?? [],
        });
      }
    } catch (err) {
      if (!cancelledRef.current) {
        setError(err instanceof Error ? err.message : '加载失败');
      }
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    cancelledRef.current = false;
    void refresh();
    return () => { cancelledRef.current = true; };
  }, [refresh]);

  const currentServers = useMemo(() => {
    if (!data) return [];
    switch (tab) {
      case 'recommended': return data.recommended;
      case 'hot': return data.hot;
      case 'new': return data.newServers;
    }
  }, [data, tab]);

  const filtered = useMemo(() => {
    let result = currentServers;
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((s) =>
        s.name.toLowerCase().includes(q) ||
        gameLabel(s.pack_id).toLowerCase().includes(q) ||
        (s.owner_username ?? '').toLowerCase().includes(q),
      );
    }
    return result;
  }, [currentServers, search]);

  const tabs: Array<{ key: Tab; label: string; icon: typeof Flame }> = [
    { key: 'recommended', label: '推荐', icon: Star },
    { key: 'hot', label: '热门', icon: Flame },
    { key: 'new', label: '新开', icon: Sparkles },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
            发现
          </h1>
          <p style={{ margin: '4px 0 0', color: 'var(--gp-text-sec)', fontSize: 14 }}>
            探索优质游戏服务器，发现新的精彩
          </p>
        </div>
        <button
          type="button"
          className="gp-icon-btn"
          onClick={() => void refresh()}
          aria-label="刷新"
          title="刷新"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      <div className="gp-search-bar">
        <Search size={18} className="gp-search-icon" />
        <input
          type="search"
          className="gp-search-input"
          placeholder="搜索服务器名称、游戏…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div style={{ display: 'flex', gap: 0, background: 'var(--gp-segment-bg)', borderRadius: 12, padding: 3 }}>
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '8px 12px',
              borderRadius: 10,
              border: 'none',
              fontSize: 14,
              fontWeight: tab === key ? 600 : 500,
              color: tab === key ? 'var(--gp-blue)' : 'var(--gp-text-sec)',
              background: tab === key ? 'var(--gp-bg-card)' : 'transparent',
              boxShadow: tab === key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              cursor: 'pointer',
              transition: 'all 0.2s',
              fontFamily: 'inherit',
            }}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {!loading && !error && tab === 'recommended' && filtered.length > 0 && (
        <div
          className="gp-hero"
          style={{
            padding: 20,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
          onClick={() => navigate(`/guild/servers/${filtered[0].id}`)}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: 'var(--gp-grad-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 26,
              fontWeight: 700,
              flexShrink: 0,
              boxShadow: '0 4px 16px rgba(0,122,255,0.3)',
            }}
          >
            {gameInitial(filtered[0].pack_id)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span className="gp-badge" style={{ background: 'rgba(255,255,255,0.8)', color: 'var(--gp-blue)', fontSize: 11 }}>
                <Sparkles size={11} style={{ marginRight: 3 }} />
                编辑推荐
              </span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--gp-text)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {filtered[0].name}
            </div>
            <div style={{ fontSize: 13, color: 'var(--gp-text-sec)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{gameLabel(filtered[0].pack_id)}</span>
              <span>·</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <Users size={12} />
                {filtered[0].online_players} 人在线
              </span>
            </div>
          </div>
          <ChevronRight size={20} style={{ color: 'var(--gp-blue)', flexShrink: 0 }} />
        </div>
      )}

      {loading ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="gp-hero" style={{ padding: 20 }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <Skeleton style={{ width: 64, height: 64, borderRadius: 18, flexShrink: 0 }} />
              <div style={{ flex: 1, display: 'grid', gap: 8 }}>
                <Skeleton style={{ height: 14, width: 60, borderRadius: 4 }} />
                <Skeleton style={{ height: 18, width: '50%', borderRadius: 4 }} />
                <Skeleton style={{ height: 13, width: '40%', borderRadius: 4 }} />
              </div>
            </div>
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <ServerCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <div className="gp-card" style={{ padding: 40, textAlign: 'center' }}>
          <p style={{ color: 'var(--gp-red)', margin: 0, marginBottom: 12 }}>{error}</p>
          <button type="button" className="gp-btn-primary" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      ) : filtered.length === 0 ? (
        search ? (
          <EmptyState title="没有找到匹配的服务器" description="尝试调整搜索关键词" />
        ) : (
          <EmptyState title="暂无服务器" description="该分类下暂时没有公开服务器" />
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(tab === 'recommended' ? filtered.slice(1) : filtered).map((s) => (
            <ServerCard key={s.id} server={s} />
          ))}
        </div>
      )}
    </div>
  );
}
