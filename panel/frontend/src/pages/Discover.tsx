// ============================================================================
// Discover — 发现服务器（v4.8.0-K2）
// 公开页面（未登录可访问），展示推荐 / 热门 / 新开服服务器
// 数据：GET /api/discover/hot | new | recommended（并发 Promise.all）
// server_admin 可在卡片上切换 is_public / is_recommended
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Flame, Sparkles, Star } from 'lucide-react';
import type { DiscoverServer } from '@public/schema/panel-api-types';
import { useAuth } from '../api/auth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { EmptyState, ErrorState, Skeleton, useToast } from '../components/ui';
import { getEffectiveRole, isAdminRole } from '../utils/role';

const FETCH_LIMIT = 10;

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    running: '运行中',
    starting: '启动中',
    stopping: '停止中',
    stopped: '已停止',
    error: '错误',
  };
  return map[status] ?? status;
}

function statusClass(status: string): string {
  return `badge badge-${status}`;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('zh-CN');
  } catch {
    return iso;
  }
}

interface DiscoverData {
  recommended: DiscoverServer[];
  hot: DiscoverServer[];
  newServers: DiscoverServer[];
}

export default function Discover() {
  const { api, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  useDocumentTitle('发现服务器');

  const [data, setData] = useState<DiscoverData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 单卡片操作中（记录 serverId，禁用按钮）
  const [actioningId, setActioningId] = useState<string | null>(null);

  const isServerAdmin = isAdminRole(getEffectiveRole(user));

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [recommendedRes, hotRes, newRes] = await Promise.all([
        api.discoverRecommended(FETCH_LIMIT),
        api.discoverHot(FETCH_LIMIT),
        api.discoverNew(FETCH_LIMIT),
      ]);
      setData({
        recommended: recommendedRes.servers,
        hot: hotRes.servers,
        newServers: newRes.servers,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载发现页失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 本地更新单张卡片的 is_public / is_recommended 标记，避免全量刷新
  const patchCard = useCallback((serverId: string, patch: Partial<DiscoverServer>) => {
    setData((prev) => {
      if (!prev) return prev;
      const map = (arr: DiscoverServer[]) =>
        arr.map((s) => (s.id === serverId ? { ...s, ...patch } : s));
      return {
        recommended: map(prev.recommended),
        hot: map(prev.hot),
        newServers: map(prev.newServers),
      };
    });
  }, []);

  const handleJoin = (server: DiscoverServer) => {
    if (user) {
      navigate(`/instances/${server.id}`);
    } else {
      navigate('/login', { state: { from: '/discover' }, replace: true });
    }
  };

  const handleToggleVisibility = async (server: DiscoverServer) => {
    setActioningId(server.id);
    try {
      await api.setServerVisibility(server.id, !server.is_public);
      patchCard(server.id, { is_public: !server.is_public });
      toast.success(`已${server.is_public ? '隐藏' : '公开'}服务器「${server.name}」`);
    } catch (err) {
      toast.error('更新可见性失败', err instanceof Error ? err.message : String(err));
    } finally {
      setActioningId(null);
    }
  };

  const handleToggleRecommend = async (server: DiscoverServer) => {
    setActioningId(server.id);
    try {
      await api.setServerRecommend(server.id, !server.is_recommended);
      patchCard(server.id, { is_recommended: !server.is_recommended });
      toast.success(`已${server.is_recommended ? '取消推荐' : '推荐'}服务器「${server.name}」`);
    } catch (err) {
      toast.error('更新推荐位失败', err instanceof Error ? err.message : String(err));
    } finally {
      setActioningId(null);
    }
  };

  const renderCard = (server: DiscoverServer) => {
    const busy = actioningId === server.id;
    return (
      <div key={server.id} className="discover-card">
        <div className="discover-card-header">
          <button
            type="button"
            className="discover-card-name"
            onClick={() => handleJoin(server)}
            aria-label={`查看服务器 ${server.name}`}
          >
            {server.name}
          </button>
          <span className={statusClass(server.status)}>{statusLabel(server.status)}</span>
        </div>
        <div className="discover-card-meta">
          <span>在线：{server.online_players}</span>
          {server.owner_username && <span>服主：{server.owner_username}</span>}
          <span>开服：{formatTime(server.created_at)}</span>
        </div>
        {server.is_recommended && (
          <span className="badge badge-running discover-card-flag">
            <Star size={11} /> 推荐
          </span>
        )}
        <div className="discover-card-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => handleJoin(server)}
            disabled={busy}
          >
            {user ? '加入' : '登录后加入'}
          </button>
          {isServerAdmin && (
            <>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void handleToggleVisibility(server)}
                disabled={busy}
                title={server.is_public ? '设为隐藏' : '设为公开'}
              >
                {server.is_public ? '公开中' : '已隐藏'}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void handleToggleRecommend(server)}
                disabled={busy}
                title={server.is_recommended ? '取消推荐' : '设为推荐'}
              >
                {server.is_recommended ? '取消推荐' : '推荐'}
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const hasAny = useMemo(() => {
    if (!data) return false;
    return (
      data.recommended.length > 0 || data.hot.length > 0 || data.newServers.length > 0
    );
  }, [data]);

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">发现服务器</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {error && <ErrorState error={error} onRetry={() => void refresh()} retrying={loading} />}

      {loading && !data ? (
        <div className="info-card">
          <Skeleton lines={6} lineHeight={20} />
        </div>
      ) : !hasAny ? (
        <EmptyState
          icon={<Sparkles size={48} />}
          title="暂无公开服务器"
          description="还没有服务器被公开到发现页，请稍后再来。"
        />
      ) : (
        data && (
          <>
            {/* 推荐 Banner 区 */}
            {data.recommended.length > 0 && (
              <section className="discover-section">
                <h3 className="discover-section-title">
                  <Star size={16} /> 推荐服务器
                </h3>
                <div className="discover-banner">
                  {data.recommended.map(renderCard)}
                </div>
              </section>
            )}

            {/* 热门服务器 */}
            {data.hot.length > 0 && (
              <section className="discover-section">
                <h3 className="discover-section-title">
                  <Flame size={16} /> 热门服务器
                </h3>
                <div className="discover-grid">{data.hot.map(renderCard)}</div>
              </section>
            )}

            {/* 新开服 */}
            {data.newServers.length > 0 && (
              <section className="discover-section">
                <h3 className="discover-section-title">
                  <Sparkles size={16} /> 新开服
                </h3>
                <div className="discover-grid">{data.newServers.map(renderCard)}</div>
              </section>
            )}
          </>
        )
      )}
    </div>
  );
}
