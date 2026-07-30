// ============================================================================
// ShopOrders — 用户订单列表
// 路径：/instances/:id/shop-orders
// 显示该用户在该服务器的订单（admin 可看全部）
// 操作：查看详情（展开 items）、领取（输入 player_name 后调 claimShopOrder）
// ============================================================================

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ShopOrderItemSummary, ShopOrderSummary } from '@public/schema/panel-api-types';
import { useAuth } from '../api/auth';
import { EmptyState, ErrorState, Skeleton, useToast } from '../components/ui';
import { getEffectiveRole, isAdminRole } from '../utils/role';

const STATUS_LABEL: Record<ShopOrderSummary['status'], string> = {
  pending: '待领取',
  claiming: '领取中',
  claimed: '已领取',
  expired: '已过期',
};

function statusClass(status: ShopOrderSummary['status']): string {
  switch (status) {
    case 'claimed':
      return 'badge badge-running';
    case 'expired':
      return 'badge badge-error';
    case 'claiming':
      return 'badge badge-starting';
    default:
      return 'badge';
  }
}

interface ClaimState {
  order: ShopOrderSummary;
  player_name: string;
}

// v3.7.0-B4/C1: 支持 embedded 模式（在 /instances/:id/business 子 Tab 中嵌入）
// - embedded=true：隐藏返回按钮（Business.tsx 已提供顶层返回）
// - embedded=false（独立路由 /instances/:id/shop-orders）：返回按钮跳转到 /instances/:id?tab=business
export default function ShopOrders({ embedded = false }: { embedded?: boolean } = {}) {
  const { id } = useParams<{ id: string }>();
  const { api, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  // v4.36.1: 按角色分流——admin 视角为「销售记录」（管理玩家订单），玩家视角为「我的订单」
  const admin = isAdminRole(getEffectiveRole(user));

  const [orders, setOrders] = useState<ShopOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 展开详情：orderId -> items
  const [detailMap, setDetailMap] = useState<Record<number, ShopOrderItemSummary[]>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [claiming, setClaiming] = useState<ClaimState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const idParam = id ?? '';

  const refresh = useCallback(async () => {
    if (!idParam) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listShopOrders(idParam);
      setOrders(res.orders);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载订单列表失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [api, idParam, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleDetail = async (orderId: number) => {
    if (expanded === orderId) {
      setExpanded(null);
      return;
    }
    setExpanded(orderId);
    if (detailMap[orderId]) {
      return;
    }
    setLoadingDetail(true);
    setError(null);
    try {
      const res = await api.getShopOrder(idParam, orderId);
      setDetailMap((m) => ({ ...m, [orderId]: res.items }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载订单详情失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoadingDetail(false);
    }
  };

  const openClaim = (order: ShopOrderSummary) => {
    setClaiming({ order, player_name: '' });
    setSuccessMsg(null);
  };

  const closeClaim = () => {
    setClaiming(null);
    setSubmitting(false);
  };

  const handleClaim = async () => {
    if (!claiming || !idParam) return;
    const playerName = claiming.player_name.trim();
    if (!playerName) {
      setError('请填写游戏内玩家名');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await api.claimShopOrder(idParam, {
        claim_code: claiming.order.claim_code,
        player_name: playerName,
      });
      const msg = `领取成功！订单 ${res.order.claim_code} 的物品已发放给玩家 ${playerName}。`;
      setSuccessMsg(msg);
      toast.success('领取成功');
      setClaiming(null);
      // 刷新订单状态
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '领取失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!idParam) {
    return (
      <div className="page">
        <EmptyState title="缺少实例 ID 参数" />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          {!embedded && (
            <button
              className="btn btn-ghost btn-sm back-btn"
              onClick={() => navigate(`/instances/${idParam}?tab=business`)}
            >
              ← 返回详情
            </button>
          )}
          <h2 className="page-title">{admin ? '销售记录' : '我的订单'}</h2>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
          {!admin && (
            <button className="btn btn-ghost" onClick={() => navigate(`/instances/${idParam}/shop`)}>
              去商店
            </button>
          )}
        </div>
      </div>

      {successMsg && <div className="alert alert-info">{successMsg}</div>}
      <ErrorState error={error} onRetry={() => void refresh()} retrying={loading} />

      {loading ? (
        <div className="info-card">
          <Skeleton lines={6} lineHeight={20} />
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          title={admin ? '暂无销售记录' : '暂无订单记录'}
          description={
            admin
              ? '玩家在商城购买物品后，销售记录将显示在此处。'
              : '去商店购买物品后，订单将显示在此处。'
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>领取码</th>
                {admin && <th>买家</th>}
                <th>物品数</th>
                {admin && <th>总价</th>}
                <th>状态</th>
                {admin && <th>领取玩家</th>}
                <th>过期时间</th>
                <th>下单时间</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <Fragment key={o.id}>
                  <tr>
                    <td className="mono">{o.claim_code}</td>
                    {admin && (
                      <td
                        className="mono"
                        title={o.buyer_username ? `${o.buyer_username} (${o.user_id})` : o.user_id}
                      >
                        {o.buyer_username ?? `${o.user_id.slice(0, 8)}…`}
                      </td>
                    )}
                    <td>{o.items_count}</td>
                    {admin && <td>{o.total_price}</td>}
                    <td>
                      <span className={statusClass(o.status)}>{STATUS_LABEL[o.status]}</span>
                    </td>
                    {admin && <td>{o.claimed_player ?? '—'}</td>}
                    <td>{new Date(o.expires_at).toLocaleString('zh-CN')}</td>
                    <td>{new Date(o.created_at).toLocaleString('zh-CN')}</td>
                    <td className="col-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => void toggleDetail(o.id)}
                      >
                        {expanded === o.id ? '收起' : '详情'}
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => openClaim(o)}
                        disabled={o.status !== 'pending'}
                      >
                        领取
                      </button>
                    </td>
                  </tr>
                  {expanded === o.id && (
                    <tr className="detail-row">
                      <td colSpan={admin ? 9 : 6}>
                        {loadingDetail ? (
                          <div className="form-hint">加载中…</div>
                        ) : detailMap[o.id] ? (
                          detailMap[o.id]!.length === 0 ? (
                            <div className="form-hint">无明细</div>
                          ) : (
                            <div className="inline-items">
                              {detailMap[o.id]!.map((it) => (
                                <span key={it.id} className="badge">
                                  {it.item_name} ×{it.count}（{it.quality}）
                                </span>
                              ))}
                            </div>
                          )
                        ) : (
                          <div className="form-hint">无数据</div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {claiming && (
        <form
          className="form-card"
          onSubmit={(e) => {
            e.preventDefault();
            void handleClaim();
          }}
        >
          <h3 className="card-title">领取订单 {claiming.order.claim_code}</h3>
          <div className="form-hint">
            物品总数：{claiming.order.items_count}；请填写实际接收物品的游戏内玩家名。
          </div>
          <label className="form-field">
            <span className="form-label">游戏内玩家名 *</span>
            <input
              type="text"
              value={claiming.player_name}
              onChange={(e) => setClaiming((c) => (c ? { ...c, player_name: e.target.value } : c))}
              required
              autoFocus
              placeholder="例如：Steve"
            />
            <span className="form-hint">仅允许字母、数字、下划线、短横线，最长 32 字符</span>
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={closeClaim}
              disabled={submitting}
            >
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? '领取中…' : '确认领取'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
