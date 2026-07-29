// ============================================================================
// AdminDashboard — Platform Dashboard 系统管理员大盘（v4.12.0 重写）
// 路径：/admin（index）
//
// v4.12.0 步骤 19：替换原写死数字卡片为真实平台大盘。
//
// 展示：
//   1. KPI 卡片（总用户/24h活跃/实例数/节点数/今日收入/30天收入/资产模板数/告警数）
//   2. 实例状态分布（running/stopped/error 横条图）
//   3. 节点健康度（healthy/total）
//   4. 磁盘用量进度条
//   5. 快捷入口（用户管理/节点/配额/资产模板/审计日志/SSL/隧道/API Keys/Pack/平台总览）
// 数据来源：
//   - GET /api/platform/overview（核心 KPI + 实例分布 + 磁盘 + 告警）
//   - GET /api/admin/assets（资产模板数）
// ============================================================================

import { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Gauge,
  Globe,
  HardDrive,
  KeyRound,
  Network,
  Package,
  RefreshCw,
  ScrollText,
  Server,
  ShieldCheck,
  ShoppingBag,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../api/auth';
import { usePlatformOverview, useGlobalAssets } from '../../api/queries/admin';
import { queryKeys } from '../../api/queries/keys';
import { getEffectiveRole, isAdminRole } from '../../utils/role';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { ListSkeleton, EmptyState, useToast } from '../../components/ui';

interface QuickEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  desc: string;
}

const QUICK_ENTRIES: QuickEntry[] = [
  { to: '/admin/users', label: '用户管理', icon: Users, desc: '用户与角色' },
  { to: '/admin/nodes', label: '部署节点', icon: Server, desc: '节点资源扫描' },
  { to: '/admin/quotas', label: '配额管理', icon: Gauge, desc: '角色配额' },
  { to: '/store/commercial', label: '资产模板', icon: ShoppingBag, desc: 'Global Assets' },
  { to: '/admin/audit-logs', label: '审计日志', icon: ScrollText, desc: '操作记录' },
  { to: '/admin/platform', label: '全平台总览', icon: Globe, desc: '详细数据' },
  { to: '/admin/ssl', label: 'SSL 证书', icon: ShieldCheck, desc: '证书管理' },
  { to: '/admin/tunnel', label: '隧道管理', icon: Network, desc: '内网穿透' },
  { to: '/admin/api-keys', label: 'API Keys', icon: KeyRound, desc: '接入凭证' },
  { to: '/admin/packs', label: 'Pack 管理', icon: Package, desc: '游戏包' },
];

interface KpiCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  accent: 'blue' | 'emerald' | 'amber' | 'rose' | 'violet' | 'cyan';
  /** v4.25.1: 可选跳转目标；提供则卡片整体可点击 + 键盘可达 */
  to?: string;
}

const ACCENT_CLASS: Record<KpiCardProps['accent'], string> = {
  blue: 'bg-blue-50 text-blue-600 ring-blue-100',
  emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  amber: 'bg-amber-50 text-amber-600 ring-amber-100',
  rose: 'bg-rose-50 text-rose-600 ring-rose-100',
  violet: 'bg-violet-50 text-violet-600 ring-violet-100',
  cyan: 'bg-cyan-50 text-cyan-600 ring-cyan-100',
};

function KpiCard({ label, value, hint, icon: Icon, accent, to }: KpiCardProps) {
  const navigate = useNavigate();
  const clickable = !!to;
  const handleClick = clickable ? () => navigate(to!) : undefined;
  return (
    <div
      className={`rounded-xl border bg-white p-5 shadow-sm transition ${
        clickable
          ? 'cursor-pointer border-slate-200 hover:border-blue-300 hover:shadow-md'
          : 'border-slate-200 hover:shadow-md'
      }`}
      onClick={handleClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate(to!);
              }
            }
          : undefined
      }
      aria-label={clickable ? `查看${label}详情` : undefined}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-800">{value}</p>
          {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
        </div>
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ${ACCENT_CLASS[accent]}`}
          aria-hidden="true"
        >
          <Icon size={20} />
        </span>
      </div>
    </div>
  );
}

interface StatusDist {
  running: number;
  stopped: number;
  error: number;
  starting?: number;
  stopping?: number;
}

function StatusBar({ dist }: { dist: StatusDist }) {
  const total = (dist.running ?? 0) + (dist.stopped ?? 0) + (dist.error ?? 0) + (dist.starting ?? 0) + (dist.stopping ?? 0);
  if (total === 0) {
    return <EmptyState title="暂无实例" />;
  }
  const segments: Array<{ key: string; label: string; value: number; color: string }> = [
    { key: 'running', label: '运行中', value: dist.running ?? 0, color: 'bg-emerald-500' },
    { key: 'stopped', label: '已停止', value: dist.stopped ?? 0, color: 'bg-slate-400' },
    { key: 'starting', label: '启动中', value: dist.starting ?? 0, color: 'bg-blue-400' },
    { key: 'stopping', label: '停止中', value: dist.stopping ?? 0, color: 'bg-amber-400' },
    { key: 'error', label: '错误', value: dist.error ?? 0, color: 'bg-rose-500' },
  ];
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
        {segments.map((s) =>
          s.value > 0 ? (
            <div
              key={s.key}
              className={s.color}
              style={{ width: `${(s.value / total) * 100}%` }}
              title={`${s.label}: ${s.value}`}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-full ${s.color}`} />
              {s.label} <span className="font-medium text-slate-700">{s.value}</span>
            </span>
          ))}
        <span className="ml-auto text-slate-400">合计 {total}</span>
      </div>
    </div>
  );
}

function DiskUsageBar({ usedMb, totalMb }: { usedMb: number; totalMb: number }) {
  const total = Math.max(totalMb, 1);
  const used = Math.min(usedMb, total);
  const pct = Math.round((used / total) * 100);
  const color = pct > 85 ? 'bg-rose-500' : pct > 60 ? 'bg-amber-500' : 'bg-emerald-500';
  const fmt = (mb: number) => {
    if (mb >= 1024 * 1024) return `${(mb / 1024 / 1024).toFixed(2)} TB`;
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
    return `${mb} MB`;
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-600">磁盘用量</span>
        <span className="font-medium text-slate-800">
          {fmt(used)} / {fmt(total)}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={color} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-slate-400">已使用 {pct}%</p>
    </div>
  );
}

export default function AdminDashboard() {
  const { user } = useAuth();

  if (!isAdminRole(getEffectiveRole(user))) return <Navigate to="/forbidden" replace />;
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  useDocumentTitle('平台大盘');

  const overviewQuery = usePlatformOverview();
  const assetsQuery = useGlobalAssets();
  const overview = overviewQuery.data ?? null;
  const overviewError = overviewQuery.error;
  const isLoading = overviewQuery.isLoading;
  const isFetching = overviewQuery.isFetching || assetsQuery.isFetching;
  const assets = assetsQuery.data;
  const assetsError = assetsQuery.error;
  const assetCount = assets?.assets?.length ?? null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.platform.all });
  };

  // 主数据失败时弹出 toast（与原 Promise.allSettled 行为对齐）
  useEffect(() => {
    if (overviewError) {
      const msg = overviewError instanceof Error ? overviewError.message : '加载平台大盘数据失败';
      toast.error(msg);
    }
  }, [overviewError, toast]);

  if (isLoading && !overview) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-800">平台大盘</h2>
            <p className="mt-1 text-sm text-slate-500">系统管理员视角的全局视图与资源调度</p>
          </div>
        </div>
        <ListSkeleton rows={4} />
      </div>
    );
  }

  if (overviewError && !overview) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold tracking-tight text-slate-800">平台大盘</h2>
        <EmptyState
          title="加载失败"
          description={overviewError instanceof Error ? overviewError.message : '加载平台大盘数据失败'}
          action={
            <button type="button" className="btn btn-primary" onClick={() => void refresh()}>
              重试
            </button>
          }
        />
      </div>
    );
  }

  const o = overview!;
  const instanceDist: StatusDist = {
    running: o.instance_status_distribution?.running ?? 0,
    stopped: o.instance_status_distribution?.stopped ?? 0,
    error: o.instance_status_distribution?.error ?? 0,
  };

  return (
    <div className="space-y-6">
      {/* 标题区 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-800">平台大盘</h2>
          <p className="mt-1 text-sm text-slate-500">系统管理员视角的全局视图与资源调度</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void refresh()}
          disabled={isFetching}
          aria-label="刷新"
        >
          <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} />
          <span>刷新</span>
        </button>
      </div>

      {/* 资产模板加载失败提示（非阻断） */}
      {assetsError && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <AlertCircle size={14} />
          <span>资产模板数据加载失败</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void refresh()}
          >
            <RefreshCw size={12} />
            重试
          </button>
        </div>
      )}

      {/* KPI 卡片网格 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="总用户数"
          value={o.total_users.toLocaleString('zh-CN')}
          hint={`24h 活跃 ${o.active_users_24h.toLocaleString('zh-CN')} · 30d 活跃 ${o.active_users_30d.toLocaleString('zh-CN')}`}
          icon={Users}
          accent="blue"
          to="/admin/users"
        />
        <KpiCard
          label="实例总数"
          value={o.total_instances.toLocaleString('zh-CN')}
          hint={`运行中 ${o.running_instances.toLocaleString('zh-CN')}`}
          icon={Server}
          accent="emerald"
          to="/instances"
        />
        <KpiCard
          label="节点数"
          value={o.total_nodes.toLocaleString('zh-CN')}
          hint={`健康 ${o.healthy_nodes.toLocaleString('zh-CN')} / 总计 ${o.total_nodes.toLocaleString('zh-CN')}`}
          icon={Network}
          accent="cyan"
          to="/admin/nodes"
        />
        <KpiCard
          label="资产模板数"
          value={assetCount === null ? '—' : assetCount.toLocaleString('zh-CN')}
          hint={assetsError ? '加载失败' : 'Global Assets'}
          icon={ShoppingBag}
          accent="violet"
          to="/store/commercial"
        />
        <KpiCard
          label="今日收入"
          value={`¥${o.revenue_today.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          hint="订单与 CDK 兑换"
          icon={Wallet}
          accent="amber"
        />
        <KpiCard
          label="30 天收入"
          value={`¥${o.revenue_30d.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          hint="近 30 天累计"
          icon={Activity}
          accent="emerald"
        />
        <KpiCard
          label="24h 告警数"
          value={o.alerts_24h.toLocaleString('zh-CN')}
          hint={o.alerts_24h > 0 ? '需要关注' : '正常'}
          icon={AlertTriangle}
          accent={o.alerts_24h > 0 ? 'rose' : 'emerald'}
          to="/admin/platform"
        />
        <KpiCard
          label="磁盘使用率"
          value={`${Math.round((Math.min(o.total_disk_used_mb, o.total_disk_capacity_mb || 1) / Math.max(o.total_disk_capacity_mb, 1)) * 100)}%`}
          hint={`${(o.total_disk_used_mb / 1024).toFixed(2)} / ${(o.total_disk_capacity_mb / 1024).toFixed(2)} GB`}
          icon={HardDrive}
          accent={o.total_disk_used_mb / Math.max(o.total_disk_capacity_mb, 1) > 0.85 ? 'rose' : 'blue'}
          to="/admin/platform"
        />
      </div>

      {/* 实例状态分布 + 磁盘用量 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">实例状态分布</h3>
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-slate-700"
              onClick={() => navigate('/admin/platform')}
            >
              查看详情 →
            </button>
          </div>
          <StatusBar dist={instanceDist} />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">资源用量</h3>
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-slate-700"
              onClick={() => navigate('/admin/platform')}
            >
              查看详情 →
            </button>
          </div>
          <DiskUsageBar usedMb={o.total_disk_used_mb} totalMb={o.total_disk_capacity_mb} />
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
            <span className="text-slate-600">节点健康度</span>
            <span className="font-medium text-slate-800">
              {o.healthy_nodes} / {o.total_nodes} 节点健康
            </span>
          </div>
        </section>
      </div>

      {/* 快捷入口 */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-700">系统管理快捷入口</h3>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {QUICK_ENTRIES.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.to}
                type="button"
                className="group flex flex-col items-start gap-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-left transition hover:border-slate-300 hover:bg-white hover:shadow-sm"
                onClick={() => navigate(entry.to)}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200 transition group-hover:text-slate-800 group-hover:ring-slate-300">
                  <Icon size={16} />
                </span>
                <span className="text-sm font-medium text-slate-700">{entry.label}</span>
                <span className="text-xs text-slate-400">{entry.desc}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
