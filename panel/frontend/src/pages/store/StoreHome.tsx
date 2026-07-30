import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Box,
  Clock,
  Crown,
  Plus,
  RefreshCw,
  Server,
  ShoppingBag,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type {
  InstanceAdminOverviewResponse,
  RevenuePoint,
} from '@public/schema/panel-api-types';
import type { StoreServerItem } from '../../api/modules/store-gm';
import { useAuth } from '../../api/auth';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../components/ui';
import {
  WorkbenchChip,
  WorkbenchEmpty,
  WorkbenchHeader,
  WorkbenchLinkAction,
  WorkbenchMetricCard,
  WorkbenchPrimaryButton,
  WorkbenchSecondaryButton,
  WorkbenchSection,
  WorkbenchShell,
  WorkbenchStatusBadge,
} from './components/WorkbenchUI';
import { formatMoney, getInstanceStatusMeta } from './utils/format';

interface QuickEntry {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
  tone: 'blue' | 'violet' | 'emerald' | 'amber' | 'rose' | 'slate';
}

const QUICK_ENTRIES: QuickEntry[] = [
  {
    to: '/store/commercial',
    label: '商城管理',
    description: '管理商品、价格与配置',
    icon: ShoppingBag,
    tone: 'violet',
  },
  {
    to: '/store/players',
    label: '玩家列表',
    description: '查看 CRM 与行为记录',
    icon: Users,
    tone: 'blue',
  },
  {
    to: '/store/instance-vip',
    label: 'VIP 管理',
    description: '处理会员时长与权益',
    icon: Crown,
    tone: 'amber',
  },
  {
    to: '/store/reports/revenue',
    label: '流水报表',
    description: '跟进收入与订单趋势',
    icon: Wallet,
    tone: 'emerald',
  },
  {
    to: '/store/reports/playtime',
    label: '时长报表',
    description: '查看会话与人均时长',
    icon: Clock,
    tone: 'blue',
  },
  {
    to: '/store/operations',
    label: '运营仪表盘',
    description: '查看跨实例总体表现',
    icon: Activity,
    tone: 'rose',
  },
  {
    to: '/store/servers',
    label: '我的实例',
    description: '进入实例详情与运维',
    icon: Server,
    tone: 'slate',
  },
];

function MiniRevenueChart({ points }: { points: RevenuePoint[] }) {
  const gradientId = useId();
  if (!points.length) {
    return (
      <WorkbenchEmpty
        title="近 7 天还没有收入数据"
        description="第一笔订单出现后，这里会开始显示趋势。"
        icon={Wallet}
        tone="emerald"
      />
    );
  }

  const maxRevenue = Math.max(...points.map((point) => point.revenue), 1);
  const width = 240;
  const height = 92;
  const step = width / Math.max(points.length - 1, 1);
  const path = points
    .map((point, index) => {
      const x = index * step;
      const y = height - (point.revenue / maxRevenue) * (height - 8) - 4;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const area = `${path} L${width},${height} L0,${height} Z`;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-28 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.26" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={path}
          fill="none"
          stroke="#10b981"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
        <span>{points[0]?.date.slice(5)}</span>
        <span>{points[points.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

function InstanceRow({ srv, onClick }: { srv: StoreServerItem; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
        <Server size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-slate-900">{srv.name}</p>
          {(() => {
            const meta = getInstanceStatusMeta(srv.status);
            return (
              <WorkbenchStatusBadge label={meta.label} tone={meta.tone} pulse={meta.pulse} />
            );
          })()}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span>{srv.online_players ?? 0} 在线</span>
          <span>{formatMoney(srv.today_revenue ?? 0)} 今日收入</span>
        </div>
      </div>
    </button>
  );
}

function AlertItem({ type, message }: { type: string; message: string }) {
  const className =
    type === 'error' || type === 'critical'
      ? 'bg-rose-50 text-rose-700 ring-rose-100'
      : type === 'warning' || type === 'warn'
        ? 'bg-amber-50 text-amber-700 ring-amber-100'
        : 'bg-blue-50 text-blue-700 ring-blue-100';
  return (
    <div className={`rounded-xl px-4 py-3 text-sm ring-1 ${className}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
        <span className="leading-6">{message}</span>
      </div>
    </div>
  );
}

export default function StoreHome() {
  const { api, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  useDocumentTitle('服主工作台');

  const [overview, setOverview] = useState<InstanceAdminOverviewResponse | null>(null);
  const [revenue, setRevenue] = useState<RevenuePoint[]>([]);
  const [servers, setServers] = useState<StoreServerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revenueError, setRevenueError] = useState<string | null>(null);
  const [serversError, setServersError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRevenueError(null);
    setServersError(null);
    try {
      const [overviewRes, revenueRes, serversRes] = await Promise.allSettled([
        api.getOperationsOverview(),
        api.getOperationsRevenue(7),
        api.listStoreServers(),
      ]);

      if (overviewRes.status !== 'fulfilled') {
        throw overviewRes.reason;
      }

      setOverview(overviewRes.value);

      if (revenueRes.status === 'fulfilled') {
        setRevenue(revenueRes.value.points ?? []);
      } else {
        const message =
          revenueRes.reason instanceof Error ? revenueRes.reason.message : '收入数据加载失败';
        setRevenue([]);
        setRevenueError(message);
      }

      if (serversRes.status === 'fulfilled') {
        setServers((serversRes.value.servers ?? []).slice(0, 5));
      } else {
        const message =
          serversRes.reason instanceof Error ? serversRes.reason.message : '实例列表加载失败';
        setServers([]);
        setServersError(message);
      }

      if (revenueRes.status !== 'fulfilled' || serversRes.status !== 'fulfilled') {
        toast.error('部分工作台数据加载失败，请留意区块提示');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载工作台数据失败';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [api, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 6) return '夜深了';
    if (hour < 12) return '早上好';
    if (hour < 14) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }, []);

  const today = useMemo(() => {
    const date = new Date();
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }, []);

  if (loading && !overview) {
    return (
      <WorkbenchShell>
        <div className="h-36 animate-pulse rounded-2xl border border-slate-200/80 bg-white/80" />
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-32 animate-pulse rounded-xl border border-slate-200/80 bg-white/80"
            />
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-[1.45fr_0.95fr]">
          <div className="h-72 animate-pulse rounded-2xl border border-slate-200/80 bg-white/80" />
          <div className="h-72 animate-pulse rounded-2xl border border-slate-200/80 bg-white/80" />
        </div>
      </WorkbenchShell>
    );
  }

  if (error && !overview) {
    return (
      <WorkbenchShell>
        <WorkbenchHeader
          eyebrow="GM Workbench"
          title="服主工作台"
          description="把实例、收入和异常收在同一屏，不再让首页像一堆灰卡片。"
        />
        <WorkbenchSection title="工作台暂时不可用" icon={AlertTriangle}>
          <WorkbenchEmpty
            title="首页数据加载失败"
            description={error}
            icon={AlertTriangle}
            tone="rose"
            action={
              <WorkbenchSecondaryButton
                icon={RefreshCw}
                onClick={() => void refresh()}
              >
                重试
              </WorkbenchSecondaryButton>
            }
          />
        </WorkbenchSection>
      </WorkbenchShell>
    );
  }

  const data = overview!;
  const alerts = data.alerts ?? [];
  const weeklyRevenue = revenue.reduce((sum, point) => sum + point.revenue, 0);
  const weeklyOrders = revenue.reduce((sum, point) => sum + point.orders, 0);

  return (
    <WorkbenchShell>
      <WorkbenchHeader
        eyebrow="GM Workbench"
        title={`${greeting}，${user?.username ?? '服主'}`}
        description="集中查看实例状态、收入趋势和待处理事项。"
        badges={[
          { label: '日期', value: today, tone: 'slate' },
          { label: '运行中', value: `${data.running_instances} 个实例`, tone: 'blue' },
          { label: '24h 活跃', value: `${data.total_players_24h} 人`, tone: 'emerald' },
          { label: '今日兑换', value: `${data.cdk_redeems_today} 次`, tone: 'amber' },
        ]}
        actions={
          <>
            <WorkbenchPrimaryButton
              icon={Plus}
              onClick={() => navigate('/store/servers/new')}
            >
              创建实例
            </WorkbenchPrimaryButton>
            <WorkbenchSecondaryButton
              onClick={() => void refresh()}
              title="刷新"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              刷新
            </WorkbenchSecondaryButton>
          </>
        }
      />

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <WorkbenchMetricCard
          label="我的实例"
          value={data.total_instances}
          hint={`${data.running_instances} 个运行中`}
          icon={Server}
          tone="violet"
        />
        <WorkbenchMetricCard
          label="当前在线"
          value={data.total_players_online}
          hint={`24h 活跃 ${data.total_players_24h} 人`}
          icon={Users}
          tone="blue"
        />
        <WorkbenchMetricCard
          label="今日收入"
          value={formatMoney(data.revenue_today)}
          hint={`${data.orders_today} 笔订单`}
          icon={Wallet}
          tone="emerald"
        />
        <WorkbenchMetricCard
          label="待处理"
          value={alerts.length}
          hint={alerts.length > 0 ? '需要尽快处理' : '当前没有阻塞项'}
          icon={AlertTriangle}
          tone={alerts.length > 0 ? 'rose' : 'slate'}
          extra={
            <div className="flex flex-wrap gap-2">
              <WorkbenchChip tone="slate">30 天收入 {formatMoney(data.revenue_30d)}</WorkbenchChip>
              <WorkbenchChip tone="amber">今日兑换 {data.cdk_redeems_today}</WorkbenchChip>
            </div>
          }
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.45fr_0.95fr]">
        <div className="space-y-5">
          <WorkbenchSection
            title="收入趋势"
            description="近 7 天收入走势"
            icon={Wallet}
            action={
              <WorkbenchLinkAction
                label="查看报表"
                onClick={() => navigate('/store/reports/revenue')}
              />
            }
          >
            {revenueError ? (
              <WorkbenchEmpty
                title="收入趋势加载失败"
                description={revenueError}
                icon={Wallet}
                tone="rose"
                action={
                  <WorkbenchSecondaryButton
                    icon={RefreshCw}
                    onClick={() => void refresh()}
                  >
                    重试
                  </WorkbenchSecondaryButton>
                }
              />
            ) : (
              <div className="grid gap-5 lg:grid-cols-[0.95fr_1.35fr]">
                <div className="rounded-xl bg-slate-50/85 p-5">
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-slate-400">
                    近 7 天累计
                  </p>
                  <p className="mt-2 text-[28px] font-semibold leading-none tracking-[-0.01em] text-slate-900">
                    {formatMoney(weeklyRevenue)}
                  </p>
                  <p className="mt-2 text-sm leading-5 text-slate-500">{weeklyOrders} 笔订单</p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <WorkbenchChip tone="emerald">
                      今日收入 {formatMoney(data.revenue_today)}
                    </WorkbenchChip>
                    <WorkbenchChip tone="slate">
                      30 天收入 {formatMoney(data.revenue_30d)}
                    </WorkbenchChip>
                  </div>
                </div>
                <MiniRevenueChart points={revenue} />
              </div>
            )}
          </WorkbenchSection>

          <WorkbenchSection
            title="最近实例"
            description={`${servers.length} 个最近活跃的实例`}
            icon={Server}
            action={
              <WorkbenchLinkAction label="全部实例" onClick={() => navigate('/store/servers')} />
            }
          >
            {serversError ? (
              <WorkbenchEmpty
                title="实例列表加载失败"
                description={serversError}
                icon={Server}
                tone="rose"
                action={
                  <WorkbenchSecondaryButton
                    icon={RefreshCw}
                    onClick={() => void refresh()}
                  >
                    重试
                  </WorkbenchSecondaryButton>
                }
              />
            ) : servers.length > 0 ? (
              <div className="space-y-3">
                {servers.map((server) => (
                  <InstanceRow
                    key={server.id}
                    srv={server}
                    onClick={() => navigate(`/store/servers/${server.id}`)}
                  />
                ))}
              </div>
            ) : (
              <WorkbenchEmpty
                title="还没有实例"
                description="先创建第一个实例，首页才会开始展示运行状态、收入和待处理事项。"
                icon={Server}
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
            )}
          </WorkbenchSection>
        </div>

        <div className="space-y-5">
          <WorkbenchSection
            title="待处理事项"
            description={alerts.length > 0 ? `${alerts.length} 项需要关注` : undefined}
            icon={AlertTriangle}
            action={
              alerts.length > 0 ? (
                <WorkbenchLinkAction
                  label="查看全部"
                  onClick={() => navigate('/store/operations')}
                />
              ) : undefined
            }
          >
            {alerts.length > 0 ? (
              <div className="space-y-3">
                {alerts.slice(0, 5).map((alert) => (
                  <AlertItem key={alert.id} type={alert.severity} message={alert.message} />
                ))}
              </div>
            ) : (
              <WorkbenchEmpty
                title="当前运行平稳"
                description="没有新的错误或告警。你可以继续去看商城配置、玩家问题或收入表现。"
                icon={AlertTriangle}
                tone="emerald"
              />
            )}
          </WorkbenchSection>

          <WorkbenchSection
            title="快捷入口"
            icon={Activity}
          >
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
              {QUICK_ENTRIES.map((entry) => {
                const Icon = entry.icon;
                return (
                  <button
                    key={entry.to}
                    type="button"
                    onClick={() => navigate(entry.to)}
                    className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-4 py-4 text-left transition hover:border-slate-300 hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-slate-700 shadow-sm">
                      <Icon size={16} />
                    </div>
                    <p className="mt-2.5 text-sm font-medium text-slate-900">{entry.label}</p>
                    <p className="mt-0.5 text-xs leading-5 text-slate-500">{entry.description}</p>
                  </button>
                );
              })}
            </div>
          </WorkbenchSection>
        </div>
      </div>

      {data.backup_health && data.backup_health.length > 0 && (
        <WorkbenchSection
          title="备份状态"
          icon={Box}
        >
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {data.backup_health.slice(0, 6).map((backup) => {
              const healthy = backup.status === 'healthy';
              const label =
                backup.status === 'healthy'
                  ? '正常'
                  : backup.status === 'stale'
                    ? '过期'
                    : '未备份';
              return (
                <div
                  key={`${backup.instance_id}-${backup.status}`}
                  className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        healthy ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                    />
                    <span className="truncate text-sm font-medium text-slate-800">
                      {backup.instance_name ?? backup.instance_id}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{label}</p>
                </div>
              );
            })}
          </div>
        </WorkbenchSection>
      )}
    </WorkbenchShell>
  );
}
