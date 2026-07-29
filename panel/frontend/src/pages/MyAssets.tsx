// ============================================================================
// MyAssets — 我的资产聚合页（v4.5.0）
// 聚合展示：账户概览 / 我管理的实例 / 最近订单 / 最近 CDK 兑换
// 数据来源：GET /api/me/assets
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MyAssetsResponse } from '@public/schema/panel-api-types';
import { useAuth } from '../api/auth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { EmptyState, ErrorState, Skeleton } from '../components/ui';
import { getEffectiveRole } from '../utils/role';

function instanceStatusLabel(status: string | undefined): string {
  if (!status) return '未知';
  const map: Record<string, string> = {
    running: '运行中',
    starting: '启动中',
    stopping: '停止中',
    stopped: '已停止',
    error: '错误',
    crashed: '已崩溃',
  };
  return map[status] ?? status;
}

function instanceStatusBadgeClass(status: string | undefined): string {
  if (status === 'running') return 'badge badge-running';
  if (status === 'starting' || status === 'stopping') return 'badge badge-starting';
  return 'badge badge-stopped';
}

const ROLE_LABEL: Record<string, string> = {
  server_admin: '服务器管理员',
  system_admin: '服务器管理员',
  instance_admin: '实例管理员',
  admin: '实例管理员',
  user: '用户',
  operator: '用户',
  viewer: '用户',
};

function roleLabel(role: string | null | undefined): string {
  if (!role) return '用户';
  return ROLE_LABEL[role] ?? '用户';
}

function roleBadgeClass(role: string | null | undefined): string {
  if (role === 'server_admin' || role === 'system_admin') return 'badge badge-running';
  if (role === 'instance_admin' || role === 'admin') return 'badge badge-starting';
  return 'badge badge-stopped';
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

export default function MyAssets() {
  const { api, user } = useAuth();
  const effectiveRole = getEffectiveRole(user);
  const navigate = useNavigate();
  useDocumentTitle('我的资产');

  const [data, setData] = useState<MyAssetsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMyAssets();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载我的资产失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading && !data) {
    return (
      <div className="page">
        <div className="page-header">
          <h2 className="page-title">我的资产</h2>
        </div>
        <div className="info-card">
          <Skeleton lines={6} lineHeight={20} />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="page">
        <div className="page-header">
          <h2 className="page-title">我的资产</h2>
          <div className="page-actions">
            <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
              刷新
            </button>
          </div>
        </div>
        <ErrorState error={error} onRetry={() => void refresh()} retrying={loading} />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="page page-with-mobile-bar">
      <div className="page-header">
        <h2 className="page-title">我的资产</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {error && <ErrorState error={error} onRetry={() => void refresh()} retrying={loading} />}

      {/* 账户概览 */}
      <div className="info-card">
        <h3 className="card-title">账户概览</h3>
        <div className="info-row">
          <span className="info-label">用户名</span>
          <span className="info-value">{data.user.username ?? user?.username ?? '-'}</span>
        </div>
        <div className="info-row">
          <span className="info-label">邮箱</span>
          <span className="info-value">{data.user.email ?? user?.email ?? '-'}</span>
        </div>
        <div className="info-row">
          <span className="info-label">角色</span>
          <span className="info-value">
            <span className={roleBadgeClass(data.user.role ?? effectiveRole)}>
              {roleLabel(data.user.role ?? effectiveRole)}
            </span>
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">VIP 等级</span>
          <span className="info-value">
            <span className="badge badge-running">VIP{data.vip.level}</span>
          </span>
        </div>
        <div className="info-row wallet-balance-row">
          <span className="info-label">钱包余额</span>
          <span className="info-value mono wallet-balance-value">{data.wallet.balance}</span>
        </div>
        <div className="info-row">
          <span className="info-label">未读通知</span>
          <span className="info-value">{data.unread_notifications}</span>
        </div>
      </div>

      {/* 我管理的实例 */}
      <div className="info-card">
        <h3 className="card-title">我管理的实例</h3>
        {data.instances.length === 0 ? (
          <EmptyState title="暂无管理的实例" />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>实例名</th>
                  <th>状态</th>
                  <th>在线人数</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.instances.map((inst) => (
                  <tr key={inst.id}>
                    <td className="cell-name">{inst.name}</td>
                    <td>
                      <span className={instanceStatusBadgeClass(inst.status)}>
                        {instanceStatusLabel(inst.status)}
                      </span>
                    </td>
                    <td className="mono">{inst.online_players}</td>
                    <td className="col-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => navigate(`/instances/${inst.id}`)}
                      >
                        查看详情
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 最近订单 */}
      <div className="info-card">
        <h3 className="card-title">最近订单</h3>
        {data.recent_orders.length === 0 ? (
          <EmptyState title="暂无订单记录" />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>实例</th>
                  <th>物品</th>
                  <th>价格</th>
                  <th>状态</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_orders.slice(0, 10).map((o) => (
                  <tr key={o.id}>
                    <td>{o.instance_name}</td>
                    <td>{o.item_name}</td>
                    <td className="mono">{o.price}</td>
                    <td>
                      <span className="badge badge-stopped">{o.status}</span>
                    </td>
                    <td>{formatTime(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 最近 CDK 兑换 */}
      <div className="info-card">
        <h3 className="card-title">最近 CDK 兑换</h3>
        {data.recent_cdk_redeems.length === 0 ? (
          <EmptyState title="暂无 CDK 兑换记录" />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>实例</th>
                  <th>CDK 码</th>
                  <th>奖励</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_cdk_redeems.slice(0, 10).map((c) => (
                  <tr key={c.id}>
                    <td>{c.instance_name}</td>
                    <td className="mono">{c.cdk_code}</td>
                    <td>{c.reward}</td>
                    <td>{formatTime(c.redeemed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* v4.8.0-P3 (J1): 移动端底部快捷操作栏——仅移动端显示 */}
      <div className="mobile-quick-actions">
        <button
          className="btn btn-ghost"
          onClick={() => void refresh()}
          disabled={loading}
        >
          刷新
        </button>
        <button
          className="btn btn-primary"
          onClick={() => navigate('/instances')}
        >
          我的实例
        </button>
      </div>
    </div>
  );
}
