// ============================================================================
// Business — 业务运营二级页面（仅 admin/system_admin 可见）
// 路径：/instances/:id/business
// v3.7.0-B4: 将原 ServerDetail 中的业务 tab（shop-admin/chat-triggers/
// player-join-settings/vote-settings）抽出至此，统一用子 Tab 组织。
// 子 Tab：shop / orders / cdk / triggers / join / vote
// 返回：/instances/:id?tab=business（保留 ServerDetail 的 __business__ pseudo-tab 选中态）
// ============================================================================

import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ServerSummary } from '@public/schema/panel-api-types';
import { useAuth } from '../../api/auth';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { getEffectiveRole, isAdminRole } from '../../utils/role';
import { ErrorState, Skeleton } from '../../components/ui';
import ShopItems from '../admin/ShopItems';
import ShopOrders from '../ShopOrders';
import CdkRedeem from '../CdkRedeem';
import ChatTriggers from '../admin/ChatTriggers';
import PlayerJoinSettings from '../admin/PlayerJoinSettings';
import VoteSettings from '../admin/VoteSettings';

const SUB_TABS = [
  { key: 'shop', label: '商品配置' },
  { key: 'orders', label: '订单管理' },
  { key: 'cdk', label: 'CDK 兑换' },
  { key: 'triggers', label: '聊天触发' },
  { key: 'join', label: '加入设置' },
  { key: 'vote', label: '投票踢人' },
] as const;

type SubTabKey = (typeof SUB_TABS)[number]['key'];

function isSubTabKey(key: string): key is SubTabKey {
  return SUB_TABS.some((t) => t.key === key);
}

export default function Business() {
  const { id } = useParams<{ id: string }>();
  const { api, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [server, setServer] = useState<ServerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 子 Tab 状态持久化到 URL ?subtab=
  const [activeSubTab, setActiveSubTab] = useState<SubTabKey>(() => {
    const fromUrl = searchParams.get('subtab');
    return fromUrl && isSubTabKey(fromUrl) ? fromUrl : 'shop';
  });

  useDocumentTitle(server ? `业务运营 - ${server.name}` : '业务运营');

  const serverId = id ?? '';

  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getServer(serverId)
      .then((res) => {
        if (cancelled) return;
        setServer(res.server);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载实例失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, serverId]);

  // 浏览器前进/后退恢复子 Tab
  useEffect(() => {
    const fromUrl = searchParams.get('subtab');
    if (fromUrl && isSubTabKey(fromUrl) && fromUrl !== activeSubTab) {
      setActiveSubTab(fromUrl);
    }
  }, [searchParams, activeSubTab]);

  const switchSubTab = (key: SubTabKey) => {
    setActiveSubTab(key);
    setSearchParams({ subtab: key }, { replace: true });
  };

  // 鉴权提前判定（hooks 已全部执行完，可安全 early return）
  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  if (loading) {
    return (
      <div className="page">
        <Skeleton lines={1} lineHeight={28} style={{ marginBottom: 16 }} />
        <Skeleton lines={5} lineHeight={20} />
      </div>
    );
  }

  if (!server) {
    return (
      <div className="page">
        <ErrorState
          error={error ?? '实例不存在或加载失败'}
          onRetry={() => navigate(`/instances/${serverId}`)}
          retrying={false}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <button
            className="btn btn-ghost btn-sm back-btn"
            onClick={() => navigate(`/instances/${serverId}?tab=business`)}
          >
            ← 返回详情
          </button>
          <h2 className="page-title">业务运营 - {server.name}</h2>
        </div>
      </div>

      {/* 子 Tab 导航 */}
      <div className="business-sub-tabs" role="tablist" aria-label="业务运营子标签页">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            id={`business-tab-${t.key}`}
            role="tab"
            aria-selected={activeSubTab === t.key}
            tabIndex={activeSubTab === t.key ? 0 : -1}
            className={`tab-btn${activeSubTab === t.key ? ' active' : ''}`}
            onClick={() => switchSubTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 子 Tab 内容区——每个子组件自带 .page-header（标题+操作），此处不重复包裹 */}
      <div className="business-content" style={{ marginTop: 16 }}>
        {activeSubTab === 'shop' && <ShopItems serverId={server.id} packId={server.pack_id} />}
        {activeSubTab === 'orders' && <ShopOrders embedded />}
        {activeSubTab === 'cdk' && <CdkRedeem embedded />}
        {activeSubTab === 'triggers' && <ChatTriggers serverId={server.id} />}
        {activeSubTab === 'join' && <PlayerJoinSettings serverId={server.id} />}
        {activeSubTab === 'vote' && <VoteSettings serverId={server.id} />}
      </div>
    </div>
  );
}
