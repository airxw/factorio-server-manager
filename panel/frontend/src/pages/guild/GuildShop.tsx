// ============================================================================
// GuildShop — /guild/shop 玩家商城入口页
//
// 功能：
//   展示用户可访问的所有服务器，支持搜索、游戏类型筛选
//   点击服务器卡片进入 /guild/servers/:id（沉浸式店铺页）
//
// 设计：Apple 浅色 gp-theme 风格，移动端优先
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  Gamepad2,
  RefreshCw,
  Search,
  ShoppingBag,
} from 'lucide-react';
import { useAuth } from '../../api/auth';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../components/ui';
import type { ServerSummary } from '@public/schema/panel-api-types';

const GAME_TYPE_LABEL: Record<string, string> = {
  minecraft: 'Minecraft',
  terraria: 'Terraria',
  factorio: 'Factorio',
  palworld: 'Palworld',
  rust: 'Rust',
  ark: 'ARK',
  valheim: 'Valheim',
  dst: "Don't Starve",
  enshrouded: 'Enshrouded',
  zomboid: 'Project Zomboid',
  satisfactory: 'Satisfactory',
};

function gameLabel(gt: string): string {
  return GAME_TYPE_LABEL[gt] ?? gt;
}

function ServerShopCard({ server }: { server: ServerSummary }) {
  const navigate = useNavigate();
  const isOnline = server.status === 'running';
  return (
    <button
      type="button"
      onClick={() => navigate(`/guild/servers/${server.id}`)}
      className="gp-card gp-card-hover"
      style={{
        width: '100%',
        padding: 0,
        textAlign: 'left',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: 'none',
      }}
    >
      <div
        style={{
          height: 90,
          background: 'linear-gradient(135deg, var(--gp-blue), var(--gp-cyan))',
          position: 'relative',
          display: 'flex',
          alignItems: 'flex-end',
          padding: 12,
        }}
      >
        <span
          className="gp-badge"
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            background: isOnline ? 'rgba(52,199,89,0.9)' : 'rgba(0,0,0,0.3)',
            color: '#fff',
            backdropFilter: 'blur(8px)',
          }}
        >
          {isOnline ? '在线' : '离线'}
        </span>
        <div style={{ color: '#fff' }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 700, textShadow: '0 1px 4px rgba(0,0,0,0.2)' }}>
            {server.name}
          </p>
        </div>
      </div>
      <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: 'var(--gp-blue-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--gp-blue)',
            flexShrink: 0,
          }}
        >
          <Gamepad2 size={16} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p className="gp-text-faint" style={{ margin: 0, fontSize: 12 }}>
            {gameLabel(server.game_type)}
            {server.owner_username ? ` · 服主 ${server.owner_username}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--gp-blue)', fontSize: 13, fontWeight: 600 }}>
          进入店铺
          <ChevronRight size={14} />
        </div>
      </div>
    </button>
  );
}

export default function GuildShop() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  useDocumentTitle('游戏商城');

  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeType, setActiveType] = useState<string>('all');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listServers().catch(() => ({ servers: [] as ServerSummary[] }));
      setServers(res.servers ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载服务器失败');
    } finally {
      setLoading(false);
    }
  }, [api, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const gameTypes = useMemo(() => {
    const types = new Set<string>();
    for (const s of servers) types.add(s.game_type);
    return Array.from(types).sort();
  }, [servers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return servers.filter((s) => {
      if (activeType !== 'all' && s.game_type !== activeType) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        gameLabel(s.game_type).toLowerCase().includes(q) ||
        (s.owner_username ?? '').toLowerCase().includes(q)
      );
    });
  }, [servers, search, activeType]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ padding: '16px 0 4px' }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShoppingBag size={22} style={{ color: 'var(--gp-blue)' }} />
          游戏商城
        </h1>
        <p className="gp-text-faint" style={{ margin: '4px 0 0', fontSize: 13 }}>
          选择服务器进入对应店铺购买道具、VIP和礼包
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div className="gp-card" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 14 }}>
          <Search size={16} style={{ color: 'var(--gp-text-tert)', flexShrink: 0 }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索服务器名称、游戏类型..."
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 14,
              color: 'var(--gp-text)',
              fontFamily: 'inherit',
            }}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              style={{ background: 'none', border: 'none', color: 'var(--gp-text-tert)', cursor: 'pointer', padding: 4 }}
              aria-label="清除搜索"
            >
              ×
            </button>
          )}
        </div>
        <button
          type="button"
          className="gp-btn gp-btn-ghost"
          style={{ padding: '10px 12px' }}
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="刷新"
        >
          <RefreshCw size={16} className={loading ? 'gp-spin' : ''} />
        </button>
      </div>

      {gameTypes.length > 0 && (
        <div className="gp-chips">
          <button
            type="button"
            className={`gp-chip${activeType === 'all' ? ' active' : ''}`}
            onClick={() => setActiveType('all')}
          >
            全部
          </button>
          {gameTypes.map((gt) => (
            <button
              key={gt}
              type="button"
              className={`gp-chip${activeType === gt ? ' active' : ''}`}
              onClick={() => setActiveType(gt)}
            >
              {gameLabel(gt)}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="gp-skeleton" style={{ height: 150, borderRadius: 20 }} />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {filtered.map((s) => (
            <ServerShopCard key={s.id} server={s} />
          ))}
        </div>
      ) : servers.length === 0 ? (
        <div className="gp-card" style={{ padding: '40px 20px', textAlign: 'center' }}>
          <div
            style={{
              margin: '0 auto 12px',
              width: 56,
              height: 56,
              borderRadius: 999,
              background: 'var(--gp-blue-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--gp-blue)',
            }}
          >
            <ShoppingBag size={24} />
          </div>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>还没有可访问的游戏服务器</p>
          <p className="gp-text-faint" style={{ margin: '6px 0 16px', fontSize: 13 }}>
            绑定游戏角色后，对应服务器会出现在这里
          </p>
          <button
            type="button"
            className="gp-btn gp-btn-primary"
            onClick={() => navigate('/guild/bind')}
          >
            去绑定角色
          </button>
        </div>
      ) : (
        <div className="gp-card" style={{ padding: '40px 20px', textAlign: 'center' }}>
          <Search size={28} style={{ color: 'var(--gp-text-tert)', margin: '0 auto 8px' }} />
          <p style={{ margin: 0, fontSize: 14, color: 'var(--gp-text-sec)' }}>没有找到匹配的服务器</p>
          <button
            type="button"
            className="gp-btn gp-btn-ghost"
            style={{ marginTop: 12, fontSize: 13 }}
            onClick={() => { setSearch(''); setActiveType('all'); }}
          >
            清除筛选
          </button>
        </div>
      )}
    </div>
  );
}
