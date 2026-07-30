// ============================================================================
// PlayerBindings — server 级玩家绑定管理（仅 admin/system_admin 可见）
// 路径：/admin/player-bindings
// 顶部：服务器选择下拉
// 表格：游戏玩家名 / 用户名 / 游戏类型 / 状态 / 绑定时间 / 操作（解绑）
// 解绑按钮 → DELETE /api/servers/:serverId/player-bindings/:id（软删除 + 同步解绑）
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type {
  ListServerPlayerBindingsResponse,
  BindingVerifyStatus,
  ServerSummary,
} from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { getEffectiveRole, isAdminRole } from '../../utils/role';
import { MobileCardList, useConfirm } from '../../components/ui';
import VirtualTable, { type VirtualColumn } from '../../components/VirtualTable';

type ServerBindingItem = ListServerPlayerBindingsResponse['bindings'][number];

function statusClass(verifyStatus: BindingVerifyStatus): string {
  switch (verifyStatus) {
    case 'verified':
      return 'badge badge-running';
    case 'pending':
      return 'badge badge-starting';
    case 'revoked':
      return 'badge badge-error';
    default:
      // 'expired' 或其他状态归到默认
      return 'badge';
  }
}

const STATUS_LABEL: Record<BindingVerifyStatus, string> = {
  pending: '待审核',
  verified: '已验证',
  expired: '已过期',
  revoked: '已拒绝',
};

export default function PlayerBindings() {
  const { api, user } = useAuth();
  const { confirm } = useConfirm();

  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [serverId, setServerId] = useState('');
  const [serversLoading, setServersLoading] = useState(true);

  const [bindings, setBindings] = useState<ServerBindingItem[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unbindingId, setUnbindingId] = useState<number | null>(null);

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

  const loadBindings = useCallback(
    async (id: string) => {
      setDataLoading(true);
      setError(null);
      try {
        const res = await api.listServerPlayerBindings(id);
        setBindings(res.bindings);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载玩家绑定列表失败');
        setBindings([]);
      } finally {
        setDataLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!serverId) {
      setBindings([]);
      return;
    }
    void loadBindings(serverId);
  }, [serverId, loadBindings]);

  const handleUnbind = async (id: number) => {
    if (!serverId) return;
    const ok = await confirm({
      title: '解绑确认',
      message: `确认解绑 #${id}？该玩家绑定记录将被软删除，同步解除其游戏内绑定状态。`,
      danger: true,
      confirmText: '解绑',
    });
    if (!ok) return;
    setError(null);
    setUnbindingId(id);
    try {
      await api.deleteServerPlayerBinding(serverId, id);
      setBindings((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '解绑失败');
    } finally {
      setUnbindingId(null);
    }
  };

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">玩家绑定管理</h2>
        <div className="page-actions">
          <button
            className="btn btn-ghost"
            onClick={() => serverId && void loadBindings(serverId)}
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
        <div className="empty-state">
          暂无玩家绑定记录。请先在上方下拉框选择实例，查看该服务器的玩家绑定记录；
          也可在实例详情页的「玩家」Tab 中查看单个服务器的绑定情况。
        </div>
      ) : dataLoading ? (
        <div className="empty-state">加载中…</div>
      ) : bindings.length === 0 ? (
        <div className="empty-state">
          该服务器暂无玩家绑定记录。
          <br />
          玩家需在游戏内使用绑定命令完成验证后，绑定记录才会显示在此处。
          你也可以进入实例详情页的「玩家」Tab 查看该服务器的玩家绑定记录。
        </div>
      ) : (
        <>
        <div className="desktop-only">
        {(() => {
          // v4.36.0-B5: 桌面表格迁移 VirtualTable（与 AuditLogs/Users 对齐）
          const columns: VirtualColumn<ServerBindingItem>[] = [
            { key: 'id', header: 'ID', width: '64px', render: (b) => b.id },
            {
              key: 'player_name',
              header: '游戏玩家名',
              width: '1.3fr',
              render: (b) => b.player_name ?? '',
            },
            { key: 'username', header: '用户名', width: '1.2fr', render: (b) => b.username },
            {
              key: 'scope_ref',
              header: '游戏类型',
              width: '1fr',
              render: (b) => b.scope_ref ?? '',
            },
            {
              key: 'verify_status',
              header: '状态',
              width: '0.8fr',
              render: (b) => (
                <span className={statusClass(b.verify_status)}>
                  {STATUS_LABEL[b.verify_status]}
                </span>
              ),
            },
            {
              key: 'verified_at',
              header: '绑定时间',
              width: '1.6fr',
              className: 'mono',
              render: (b) => b.verified_at ?? b.created_at,
            },
            {
              key: 'actions',
              header: '操作',
              width: '0.8fr',
              render: (b) => (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => void handleUnbind(b.id)}
                  disabled={unbindingId === b.id}
                >
                  {unbindingId === b.id ? '解绑中…' : '解绑'}
                </button>
              ),
            },
          ];
          return (
            <VirtualTable<ServerBindingItem>
              columns={columns}
              rows={bindings}
              rowKey={(b) => b.id}
              estimateRowHeight={44}
              maxHeight={640}
            />
          );
        })()}
        </div>

        {/* 移动端卡片降级（B1.4 批次） */}
        <MobileCardList
          items={bindings}
          keyExtractor={(b) => b.id}
          emptyText="暂无玩家绑定记录"
          renderHeader={(b) => (
            <>
              <span className="mc-item-title">{b.player_name ?? '(未命名玩家)'}</span>
              <span className="mc-item-badge">
                <span className={statusClass(b.verify_status)}>
                  {STATUS_LABEL[b.verify_status]}
                </span>
              </span>
            </>
          )}
          renderBody={(b) => (
            <>
              <div className="mc-row">
                <span className="mc-label">用户名</span>
                <span className="mc-value">{b.username}</span>
              </div>
              <div className="mc-row">
                <span className="mc-label">游戏类型</span>
                <span className="mc-value">{b.scope_ref ?? '—'}</span>
              </div>
              <div className="mc-row">
                <span className="mc-label">状态</span>
                <span className="mc-value">
                  <span className={statusClass(b.verify_status)}>
                    {STATUS_LABEL[b.verify_status]}
                  </span>
                </span>
              </div>
              <div className="mc-row">
                <span className="mc-label">绑定时间</span>
                <span className="mc-value mono">
                  {new Date(b.verified_at ?? b.created_at).toLocaleString('zh-CN')}
                </span>
              </div>
            </>
          )}
          renderActions={(b) => (
            <button
              className="btn btn-danger btn-sm"
              onClick={() => void handleUnbind(b.id)}
              disabled={unbindingId === b.id}
            >
              {unbindingId === b.id ? '解绑中…' : '解绑'}
            </button>
          )}
        />
        </>
      )}
    </div>
  );
}
