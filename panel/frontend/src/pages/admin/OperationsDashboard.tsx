import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Database,
  PlayCircle,
  RefreshCw,
  Server,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import type {
  InstanceAdminOverviewResponse,
  OperationsInstancesCompareResponse,
  OperationsPlayersResponse,
  OperationsRevenueResponse,
} from '@public/schema/panel-api-types';
import type { InstanceState } from '@public/schema/daemon-api-types';
import { useAuth } from '../../api/auth';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../components/ui';
import {
  WorkbenchChip,
  WorkbenchEmpty,
  WorkbenchFilterBar,
  WorkbenchHeader,
  WorkbenchMetricCard,
  WorkbenchPrimaryButton,
  WorkbenchSecondaryButton,
  WorkbenchSection,
  WorkbenchShell,
  WorkbenchSegmented,
  WorkbenchStatusBadge,
  WorkbenchTableWrap,
  type WorkbenchStatusTone,
} from '../store/components/WorkbenchUI';
import { formatMoney, getInstanceStatusMeta, REPORT_DAY_OPTIONS } from '../store/utils/format';

interface ChartPoint {
  date: string;
  value: number;
}

function AlertSeverityBadge({ severity }: { severity: string }) {
  const tone: WorkbenchStatusTone =
    severity === 'error' || severity === 'critical'
      ? 'rose'
      : severity === 'warning'
        ? 'amber'
        : 'blue';
  const label =
    severity === 'critical'
      ? '严重'
      : severity === 'error'
        ? '错误'
        : severity === 'warning'
          ? '警告'
          : '信息';
  return <WorkbenchStatusBadge label={label} tone={tone} />;
}

function BackupStatusBadge({ status }: { status: string }) {
  const tone: WorkbenchStatusTone = status === 'healthy' ? 'emerald' : status === 'stale' ? 'amber' : 'rose';
  const label = status === 'healthy' ? '健康' : status === 'stale' ? '过期' : '从未';
  return <WorkbenchStatusBadge label={label} tone={tone} />;
}

function InstanceStateBadge({ state }: { state: InstanceState }) {
  const meta = getInstanceStatusMeta(state);
  return <WorkbenchStatusBadge label={meta.label} tone={meta.tone} pulse={meta.pulse} />;
}

function LineChart({
  data,
  color,
  title,
}: {
  data: ChartPoint[];
  color: string;
  title: string;
}) {
  const gradientId = useId();
  if (data.length === 0) {
    return (
      <WorkbenchEmpty
        title={`暂无${title}数据`}
        description="当实例开始产生真实活动后，这里会自动补齐趋势。"
        icon={TrendingUp}
        tone="slate"
      />
    );
  }

  const width = 640;
  const height = 200;
  const padding = 18;
  const maxValue = Math.max(...data.map((item) => item.value), 1);
  const step = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 0;
  const points = data.map((item, index) => {
    const x = padding + index * step;
    const y = height - padding - (item.value / maxValue) * (height - padding * 2);
    return { x, y, ...item };
  });
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ');
  const area = `${path} L${points[points.length - 1].x},${height - padding} L${points[0].x},${height - padding} Z`;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block h-44 w-full"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.24" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          stroke="#dbe3ee"
          strokeWidth="1"
        />
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
        <span>{data[0]?.date.slice(5)}</span>
        <span>{data[data.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

export default function OperationsDashboard() {
  const { api } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();
  useDocumentTitle('运营仪表盘');

  const [overview, setOverview] = useState<InstanceAdminOverviewResponse | null>(null);
  const [revenue, setRevenue] = useState<OperationsRevenueResponse | null>(null);
  const [players, setPlayers] = useState<OperationsPlayersResponse | null>(null);
  const [compare, setCompare] = useState<OperationsInstancesCompareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchActioning, setBatchActioning] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, rev, ply, cmp] = await Promise.all([
        api.getOperationsOverview(),
        api.getOperationsRevenue(days),
        api.getOperationsPlayers(days),
        api.getOperationsInstancesCompare(),
      ]);
      setOverview(ov);
      setRevenue(rev);
      setPlayers(ply);
      setCompare(cmp);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载运营仪表盘数据失败');
    } finally {
      setLoading(false);
    }
  }, [api, days]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const formatTime = (iso: string | null): string => {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleString('zh-CN');
    } catch {
      return iso;
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const compareIds = useMemo(
    () => (compare?.instances ?? []).map((instance) => instance.instance_id),
    [compare],
  );
  const allCompareSelected =
    compareIds.length > 0 && compareIds.every((id) => selectedIds.has(id));
  const someCompareSelected = compareIds.some((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (allCompareSelected) compareIds.forEach((id) => next.delete(id));
      else compareIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const runBatchAction = async (
    label: string,
    action: (
      request: import('@public/schema/panel-api-types').BatchActionRequest,
    ) => Promise<import('@public/schema/panel-api-types').BatchActionResponse>,
  ) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const confirmed = await confirm({
      title: `批量${label}`,
      message: `确定要批量${label} ${ids.length} 个实例吗？`,
      confirmText: label,
      danger: true,
    });
    if (!confirmed) return;

    setBatchActioning(true);
    setError(null);
    try {
      const result = await action({ instance_ids: ids });
      const successCount = result.results.filter((item) => item.success).length;
      const failedCount = result.results.length - successCount;
      if (failedCount === 0) {
        toast.success(`批量${label}完成，共 ${successCount} 个实例`);
      } else {
        const detail = result.results
          .filter((item) => !item.success)
          .map((item) => `${item.instance_id}: ${item.message ?? '未知错误'}`)
          .join('\n');
        toast.error(`批量${label}：成功 ${successCount} 个，失败 ${failedCount} 个`, detail);
      }
      clearSelection();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `批量${label}失败`);
    } finally {
      setBatchActioning(false);
    }
  };

  const handleBatchStart = () => runBatchAction('启动', (request) => api.batchStart(request));
  const handleBatchStop = () => runBatchAction('停止', (request) => api.batchStop(request));
  const handleBatchRestart = () => runBatchAction('重启', (request) => api.batchRestart(request));
  const handleBatchBackup = () => runBatchAction('备份', (request) => api.batchBackup(request));

  if (loading && !overview) {
    return (
      <WorkbenchShell>
        <div className="h-48 animate-pulse rounded-[28px] border border-slate-200/80 bg-white/80" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-40 animate-pulse rounded-[24px] border border-slate-200/80 bg-white/80"
            />
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="h-80 animate-pulse rounded-[26px] border border-slate-200/80 bg-white/80" />
          <div className="h-80 animate-pulse rounded-[26px] border border-slate-200/80 bg-white/80" />
        </div>
      </WorkbenchShell>
    );
  }

  if (error && !overview) {
    return (
      <WorkbenchShell>
        <WorkbenchHeader
          eyebrow="Operations"
          title="运营仪表盘"
          description="把跨实例的状态、收入、活跃与备份放进一套统一的工作台语言里。"
        />
        <WorkbenchSection title="运营页暂时不可用" icon={AlertCircle}>
          <WorkbenchEmpty
            title="数据加载失败"
            description={error}
            icon={AlertCircle}
            tone="rose"
            action={
              <button
                type="button"
                onClick={() => void refresh()}
                className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-500"
              >
                <RefreshCw size={14} />
                重试
              </button>
            }
          />
        </WorkbenchSection>
      </WorkbenchShell>
    );
  }

  const revenuePoints: ChartPoint[] = (revenue?.points ?? []).map((point) => ({
    date: point.date,
    value: point.revenue,
  }));
  const playerPoints: ChartPoint[] = (players?.points ?? []).map((point) => ({
    date: point.date,
    value: point.unique_players,
  }));

  return (
    <WorkbenchShell>
      <WorkbenchHeader
        eyebrow="Operations"
        title="运营仪表盘"
        description="用一屏看清跨实例的运行状态、收入走势、玩家活跃和备份健康度，避免在旧式后台表格里来回切页。"
        badges={[
          { label: '统计周期', value: `${days} 天`, tone: 'blue' },
          { label: '待处理告警', value: `${overview?.alerts.length ?? 0} 条`, tone: 'amber' },
          {
            label: '运行中',
            value: `${overview?.running_instances ?? 0} / ${overview?.total_instances ?? 0}`,
            tone: 'emerald',
          },
        ]}
        actions={
          <WorkbenchSecondaryButton
            icon={RefreshCw}
            onClick={() => void refresh()}
            disabled={loading}
          >
            刷新
          </WorkbenchSecondaryButton>
        }
      />

      {error && (
        <div className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {overview && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <WorkbenchMetricCard
            label="总实例数"
            value={overview.total_instances}
            hint="当前服主可见实例"
            icon={Server}
            tone="violet"
          />
          <WorkbenchMetricCard
            label="运行中"
            value={overview.running_instances}
            hint="正在提供服务的实例"
            icon={PlayCircle}
            tone="emerald"
          />
          <WorkbenchMetricCard
            label="在线玩家"
            value={overview.total_players_online}
            hint={`${overview.total_players_24h} 人在 24h 内活跃`}
            icon={Users}
            tone="blue"
          />
          <WorkbenchMetricCard
            label="今日收入"
            value={formatMoney(overview.revenue_today)}
            hint="首页只保留当天判断"
            icon={Wallet}
            tone="amber"
            extra={
              <div className="flex flex-wrap gap-2">
                <WorkbenchChip tone="slate">
                  30 天收入 {formatMoney(overview.revenue_30d)}
                </WorkbenchChip>
              </div>
            }
          />
        </div>
      )}

      <WorkbenchFilterBar>
        <span className="text-xs font-medium text-slate-500">统计周期</span>
        <WorkbenchSegmented
          value={days}
          ariaLabel="统计周期"
          options={REPORT_DAY_OPTIONS.map((d) => ({ value: d, label: `${d}天` }))}
          onChange={(v) => setDays(v)}
        />
      </WorkbenchFilterBar>

      <div className="grid gap-4 xl:grid-cols-2">
        <WorkbenchSection
          title={`收入趋势（${days} 天）`}
          description="保留曲线，但视觉和首页统一到同一套浅色卡片。"
          icon={Wallet}
        >
          <LineChart data={revenuePoints} color="#2563eb" title="收入" />
        </WorkbenchSection>

        <WorkbenchSection
          title={`玩家活跃度（${days} 天）`}
          description="和收入趋势同层展示，方便判断活动与营收是否同步。"
          icon={Users}
        >
          <LineChart data={playerPoints} color="#16a34a" title="玩家活跃" />
        </WorkbenchSection>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <WorkbenchSection
          title="备份健康度"
          description="把备份状态从密集表格改成更容易扫读的列表。"
          icon={Database}
        >
          {overview && overview.backup_health.length > 0 ? (
            <div className="space-y-3">
              {overview.backup_health.map((backup) => (
                <div
                  key={backup.instance_id}
                  className="rounded-[20px] border border-slate-200/80 bg-slate-50/80 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{backup.instance_name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        最近备份 {formatTime(backup.last_backup_at)}
                      </p>
                    </div>
                    <BackupStatusBadge status={backup.status} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <WorkbenchEmpty
              title="暂无备份记录"
              description="实例产生备份后，这里会开始显示健康度。"
              icon={Database}
              tone="slate"
            />
          )}
        </WorkbenchSection>

        <WorkbenchSection
          title="告警时间线"
          description="告警按轻重分色，但不再用旧后台那种红黄蓝混乱堆叠。"
          icon={AlertTriangle}
        >
          {overview && overview.alerts.length > 0 ? (
            <div className="space-y-3">
              {overview.alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="rounded-[20px] border border-slate-200/80 bg-slate-50/80 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <AlertSeverityBadge severity={alert.severity} />
                    {alert.instance_name && (
                      <span className="text-xs text-slate-500">{alert.instance_name}</span>
                    )}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-800">{alert.message}</p>
                  <p className="mt-2 text-xs text-slate-400">{formatTime(alert.created_at)}</p>
                </div>
              ))}
            </div>
          ) : (
            <WorkbenchEmpty
              title="近 24 小时没有告警"
              description="当前实例整体状态平稳，可以继续关注收入和活跃度。"
              icon={AlertTriangle}
              tone="emerald"
            />
          )}
        </WorkbenchSection>
      </div>

      <WorkbenchSection
        title="实例对比"
        description="把批量操作和表格放进同一块卡片里，减少旧页面的碎片感。"
        icon={Server}
      >
        {compare && compare.instances.length > 0 ? (
          <>
            {selectedIds.size > 0 && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-3">
                <span className="text-sm font-medium text-slate-700">已选 {selectedIds.size} 项</span>
                <div className="flex flex-wrap gap-2">
                  <WorkbenchPrimaryButton
                    onClick={() => void handleBatchStart()}
                    disabled={batchActioning}
                  >
                    {batchActioning ? '处理中…' : '批量启动'}
                  </WorkbenchPrimaryButton>
                  <WorkbenchSecondaryButton
                    onClick={() => void handleBatchStop()}
                    disabled={batchActioning}
                  >
                    {batchActioning ? '处理中…' : '批量停止'}
                  </WorkbenchSecondaryButton>
                  <WorkbenchSecondaryButton
                    onClick={() => void handleBatchRestart()}
                    disabled={batchActioning}
                  >
                    {batchActioning ? '处理中…' : '批量重启'}
                  </WorkbenchSecondaryButton>
                  <WorkbenchSecondaryButton
                    onClick={() => void handleBatchBackup()}
                    disabled={batchActioning}
                  >
                    {batchActioning ? '处理中…' : '批量备份'}
                  </WorkbenchSecondaryButton>
                  <WorkbenchSecondaryButton
                    onClick={clearSelection}
                    disabled={batchActioning}
                  >
                    取消选择
                  </WorkbenchSecondaryButton>
                </div>
              </div>
            )}

            <WorkbenchTableWrap>
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="col-checkbox">
                      <input
                        type="checkbox"
                        checked={allCompareSelected}
                        ref={(element) => {
                          if (element) {
                            element.indeterminate = !allCompareSelected && someCompareSelected;
                          }
                        }}
                        onChange={toggleSelectAll}
                        aria-label="全选实例"
                      />
                    </th>
                    <th>实例名</th>
                    <th>状态</th>
                    <th>在线玩家</th>
                    <th>30 天收入</th>
                    <th>磁盘占用 (MB)</th>
                  </tr>
                </thead>
                <tbody>
                  {compare.instances.map((instance) => (
                    <tr key={instance.instance_id}>
                      <td className="col-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(instance.instance_id)}
                          onChange={() => toggleSelect(instance.instance_id)}
                          aria-label={`选择实例 ${instance.instance_name}`}
                        />
                      </td>
                      <td className="cell-name">{instance.instance_name}</td>
                      <td>
                        <InstanceStateBadge state={instance.status} />
                      </td>
                      <td className="mono">{instance.online_players}</td>
                      <td className="mono">{formatMoney(instance.revenue_30d)}</td>
                      <td className="mono">{instance.disk_used_mb}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </WorkbenchTableWrap>
          </>
        ) : (
          <WorkbenchEmpty
            title="暂无实例数据"
            description="等实例开始运行后，再回来做跨实例对比。"
            icon={Server}
            tone="slate"
          />
        )}
      </WorkbenchSection>
    </WorkbenchShell>
  );
}
