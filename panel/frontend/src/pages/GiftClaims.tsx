// ============================================================================
// GiftClaims — 礼包领取记录（任意登录用户可访问）
// 路径：/gift-claims
// 顶部：服务器选择下拉
// 表格：user_id / game_player_name / claim_type / claimed_at
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type {
  GiftClaimSummary,
  GiftClaimType,
  ServerSummary,
} from '@public/schema/panel-api-types';
import { useAuth } from '../api/auth';

const CLAIM_TYPE_LABEL: Record<GiftClaimType, string> = {
  welcome_gift: '入服礼包',
  relogin_gift: '回归礼包',
  shop_order: '商店订单',
  cdk_redeem: 'CDK 兑换',
  manual: '手动发放',
};

export default function GiftClaims() {
  const { api } = useAuth();

  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [serverId, setServerId] = useState('');
  const [serversLoading, setServersLoading] = useState(true);

  const [claims, setClaims] = useState<GiftClaimSummary[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const loadClaims = useCallback(
    async (id: string) => {
      setDataLoading(true);
      setError(null);
      try {
        const res = await api.listGiftClaims(id);
        setClaims(res.claims);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载礼包领取记录失败');
        setClaims([]);
      } finally {
        setDataLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!serverId) {
      setClaims([]);
      return;
    }
    void loadClaims(serverId);
  }, [serverId, loadClaims]);

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">礼包领取记录</h2>
        <div className="page-actions">
          <button
            className="btn btn-ghost"
            onClick={() => serverId && void loadClaims(serverId)}
            disabled={dataLoading || !serverId}
          >
            刷新
          </button>
        </div>
      </div>

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
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {!serverId ? (
        <div className="empty-state">请先选择服务器。</div>
      ) : dataLoading ? (
        <div className="empty-state">加载中…</div>
      ) : claims.length === 0 ? (
        <div className="empty-state">暂无礼包领取记录。</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>用户 ID</th>
                <th>游戏玩家名</th>
                <th>领取类型</th>
                <th>领取时间</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id}>
                  <td>{c.user_id}</td>
                  <td>{c.game_player_name}</td>
                  <td>
                    <span className="badge">{CLAIM_TYPE_LABEL[c.claim_type] ?? c.claim_type}</span>
                  </td>
                  <td>{new Date(c.claimed_at).toLocaleString('zh-CN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
