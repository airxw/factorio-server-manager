// ============================================================================
// 我的实例（GM Workbench 真实数据页面）
// v4.x: 迁入 Workbench DS 壳层，卡片视觉对齐 StoreHome InstanceRow
// 接入 GET /api/store/servers 后端 API
// 列出当前服主拥有的实例（instance_admin）或所有实例（server_admin ?all=true）
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Server as ServerIcon, RefreshCw, Users, Coins, AlertTriangle, Plus } from 'lucide-react';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import { useToast, ErrorState } from '../../components/ui';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { getEffectiveRole } from '../../utils/role';
import type { StoreServerItem } from '../../api/modules/store-gm';
import {
  WorkbenchShell,
  WorkbenchHeader,
  WorkbenchSection,
  WorkbenchEmpty,
  WorkbenchPrimaryButton,
  WorkbenchSecondaryButton,
  WorkbenchStatusBadge,
  WorkbenchPageSkeleton,
} from './components/WorkbenchUI';
import { formatMoney, getInstanceStatusMeta } from './utils/format';

export default function Servers() {
  const { api, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  useDocumentTitle('我的实例');
  const [searchParams, setSearchParams] = useSearchParams();

  const [servers, setServers] = useState<StoreServerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const isAdmin = (getEffectiveRole(user) ?? '').toLowerCase() === 'server_admin';
  const showAll = isAdmin && searchParams.get('all') === 'true';

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await api.listStoreServers(showAll);
      setServers(res.servers);
    } catch (err) {
      const msg = err instanceof PanelApiError ? err.message : '加载实例列表失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, showAll, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleShowAll = () => {
    if (showAll) {
      searchParams.delete('all');
    } else {
      searchParams.set('all', 'true');
    }
    setSearchParams(searchParams, { replace: true });
  };

  if (loading) {
    return <WorkbenchPageSkeleton />;
  }

  return (
    <WorkbenchShell>
      <WorkbenchHeader
        eyebrow="GM Workbench · Instances"
        title="我的实例"
        description={showAll ? '当前展示所有服主的实例（管理员视图）。' : '管理你名下的游戏服实例，进入详情可控制台、配置与监控。'}
        actions={
          <>
            {isAdmin && (
              <WorkbenchSecondaryButton onClick={toggleShowAll}>
                {showAll ? '仅看我的' : '查看全部'}
              </WorkbenchSecondaryButton>
            )}
            <WorkbenchSecondaryButton
              onClick={() => void refresh()}
              disabled={refreshing}
              title="刷新"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              刷新
            </WorkbenchSecondaryButton>
            <WorkbenchPrimaryButton
              icon={Plus}
              onClick={() => navigate('/store/servers/new')}
            >
              创建实例
            </WorkbenchPrimaryButton>
          </>
        }
      />

      {error && (
        <WorkbenchSection title="实例列表加载失败" icon={AlertTriangle}>
          <ErrorState error={error} onRetry={refresh} retrying={refreshing} />
        </WorkbenchSection>
      )}

      {servers.length === 0 && !error ? (
        <WorkbenchEmpty
          title={showAll ? '系统还没有任何实例' : '你还没有实例'}
          description={showAll ? '所有服主均未创建实例。' : '先创建第一个实例，才能进入控制台、配置商品和查看报表。'}
          icon={ServerIcon}
          tone="blue"
          action={
            <WorkbenchPrimaryButton
              icon={Plus}
              onClick={() => navigate('/store/servers/new')}
            >
              创建第一个实例
            </WorkbenchPrimaryButton>
          }
        />
      ) : !error ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {servers.map((s) => {
            const meta = getInstanceStatusMeta(s.status);
            return (
              <Link
                key={s.id}
                to={`/store/servers/${s.id}`}
                className="group rounded-[22px] border border-slate-200/80 bg-white/92 p-5 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.35)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-[0_22px_50px_-32px_rgba(15,23,42,0.42)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                      <ServerIcon size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{s.name}</p>
                      <p className="text-xs text-slate-500">{s.game_type}</p>
                    </div>
                  </div>
                  <WorkbenchStatusBadge label={meta.label} tone={meta.tone} pulse={meta.pulse} />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl bg-slate-50/80 px-3 py-2">
                    <p className="text-slate-400">游戏端口</p>
                    <p className="mt-0.5 font-medium tabular-nums text-slate-700">{s.port}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50/80 px-3 py-2">
                    <p className="text-slate-400">RCON 端口</p>
                    <p className="mt-0.5 font-medium tabular-nums text-slate-700">{s.rcon_port}</p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <Users size={14} className="text-slate-400" />
                    <span className="font-semibold tabular-nums text-slate-900">{s.online_players}</span>
                    <span className="text-xs text-slate-500">在线</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <Coins size={14} className="text-emerald-500" />
                    <span className="font-semibold tabular-nums text-emerald-700">
                      {formatMoney(s.today_revenue ?? 0)}
                    </span>
                    <span className="text-xs text-slate-500">今日</span>
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : null}
    </WorkbenchShell>
  );
}
