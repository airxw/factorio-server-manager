// ============================================================================
// 流水报表（GM Workbench 真实数据页面）
// v4.x: 迁入 Workbench DS 壳层，统一 /store 视觉语言
// 接入 GET /api/store/reports/revenue 后端 API
// 店铺流水统计与趋势分析——按日聚合订单收入与CDK兑换
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Wallet, RefreshCw, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import { useToast, ErrorState } from '../../components/ui';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import type { StoreServerItem, RevenueDailyItem } from '../../api/modules/store-gm';
import {
  WorkbenchShell,
  WorkbenchHeader,
  WorkbenchMetricCard,
  WorkbenchSection,
  WorkbenchEmpty,
  WorkbenchFilterBar,
  WorkbenchSelect,
  WorkbenchSegmented,
  WorkbenchPrimaryButton,
  WorkbenchChartFrame,
  WorkbenchTableWrap,
} from './components/WorkbenchUI';
import { formatCurrency, REPORT_DAY_OPTIONS } from './utils/format';

export default function ReportsRevenue() {
  const { api } = useAuth();
  const toast = useToast();
  useDocumentTitle('流水报表');

  const [servers, setServers] = useState<StoreServerItem[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('');
  const [daily, setDaily] = useState<RevenueDailyItem[]>([]);
  const [summary, setSummary] = useState({
    total_revenue: 0,
    total_orders: 0,
    total_cdk_redeemed: 0,
    days: 30,
  });
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [loadingServers, setLoadingServers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const reqIdRef = useRef(0);

  // 1. 加载实例列表
  useEffect(() => {
    let cancelled = false;
    setLoadingServers(true);
    (async () => {
      try {
        const res = await api.listStoreServers();
        if (cancelled) return;
        setServers(res.servers);
        if (res.servers.length > 0) {
          setSelectedInstanceId(res.servers[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof PanelApiError ? err.message : '加载实例列表失败');
        }
      } finally {
        if (!cancelled) setLoadingServers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, toast]);

  // 2. 加载流水报表
  const refresh = useCallback(async () => {
    if (!selectedInstanceId) {
      setDaily([]);
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const res = await api.getStoreRevenueReport(selectedInstanceId, days);
      if (reqId !== reqIdRef.current) return;
      setDaily(res.daily);
      setSummary(res.summary);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      setError(err instanceof PanelApiError ? err.message : '加载流水报表失败');
    } finally {
      if (reqId === reqIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [api, selectedInstanceId, days]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const maxRevenue = Math.max(...daily.map((d) => d.revenue), 1);
  const recentDaily = daily.slice(-days);
  const avgRevenue = recentDaily.length > 0
    ? recentDaily.reduce((s, d) => s + d.revenue, 0) / recentDaily.length
    : 0;

  return (
    <WorkbenchShell>
      <WorkbenchHeader
        eyebrow="GM Workbench · Reports"
        title="流水报表"
        description="按日聚合订单收入与 CDK 兑换，定位收入异动与增长区间。切换实例与时间窗在同一屏完成。"
        actions={
          <WorkbenchPrimaryButton
            onClick={() => void refresh()}
            disabled={refreshing || !selectedInstanceId}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            刷新
          </WorkbenchPrimaryButton>
        }
      />

      <WorkbenchFilterBar>
        <WorkbenchSelect
          aria-label="选择实例"
          value={selectedInstanceId}
          onChange={(e) => setSelectedInstanceId(e.target.value)}
          disabled={loadingServers || servers.length === 0}
        >
          {loadingServers && <option value="">加载实例中…</option>}
          {!loadingServers && servers.length === 0 && <option value="">暂无实例</option>}
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.game_type})
            </option>
          ))}
        </WorkbenchSelect>
        <WorkbenchSegmented
          value={days}
          ariaLabel="时间范围"
          options={REPORT_DAY_OPTIONS.map((d) => ({ value: d, label: `${d}天` }))}
          onChange={(v) => setDays(v)}
        />
      </WorkbenchFilterBar>

      {!selectedInstanceId && !loadingServers ? (
        <WorkbenchEmpty
          title="还没有实例"
          description="先创建实例，报表才会开始聚合订单与 CDK 兑换数据。"
          icon={Wallet}
          tone="blue"
        />
      ) : error ? (
        <WorkbenchSection title="报表加载失败" icon={AlertTriangle}>
          <ErrorState error={error} onRetry={refresh} retrying={refreshing} />
        </WorkbenchSection>
      ) : loading ? (
        <WorkbenchSection title="收入趋势" icon={Wallet}>
          <div className="h-40 animate-pulse rounded-2xl bg-slate-100/70" />
        </WorkbenchSection>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <WorkbenchMetricCard
              label={`总收入（${summary.days}天）`}
              value={formatCurrency(summary.total_revenue)}
              hint={`日均 ${formatCurrency(avgRevenue)}`}
              icon={Wallet}
              tone="emerald"
            />
            <WorkbenchMetricCard
              label="总订单数"
              value={summary.total_orders}
              hint={`日均 ${(summary.total_orders / Math.max(summary.days, 1)).toFixed(1)} 笔`}
              icon={RefreshCw}
              tone="blue"
            />
            <WorkbenchMetricCard
              label="CDK 兑换数"
              value={summary.total_cdk_redeemed}
              hint={`兑换 / 订单 = ${summary.total_orders > 0 ? ((summary.total_cdk_redeemed / summary.total_orders) * 100).toFixed(0) : 0}%`}
              icon={Wallet}
              tone="amber"
            />
            <WorkbenchMetricCard
              label="峰值日收入"
              value={formatCurrency(Math.max(...recentDaily.map((d) => d.revenue), 0))}
              hint={recentDaily.find((d) => d.revenue === Math.max(...recentDaily.map((x) => x.revenue), 0))?.date ?? '-'}
              icon={Wallet}
              tone="slate"
            />
          </div>

          <WorkbenchSection
            title="收入趋势"
            description="每日收入柱状图，鼠标悬停查看订单与 CDK 明细。"
            icon={Wallet}
          >
            <WorkbenchChartFrame
              title="每日收入"
              legend={
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                  收入（¥）
                </span>
              }
            >
              {recentDaily.length === 0 ? (
                <WorkbenchEmpty
                  title="所选时间范围内暂无数据"
                  description="这段时间没有订单或 CDK 兑换记录。"
                  icon={Wallet}
                  tone="slate"
                />
              ) : (
                <>
                  <div
                    className="flex items-end gap-1 h-44 overflow-x-auto rounded-2xl bg-slate-50/60 p-3"
                    role="img"
                    aria-label="每日收入趋势柱状图"
                  >
                    {recentDaily.map((d) => (
                      <div
                        key={d.date}
                        className="flex-1 min-w-[8px] group relative"
                        title={`${d.date} | 收入: ${formatCurrency(d.revenue)} | 订单: ${d.order_count} | CDK: ${d.cdk_redeemed}`}
                      >
                        <div
                          className="bg-emerald-500/80 hover:bg-emerald-600 transition-colors rounded-t w-full"
                          style={{ height: `${Math.max((d.revenue / maxRevenue) * 100, 2)}%` }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex justify-between text-xs text-slate-400">
                    <span>{recentDaily[0]?.date}</span>
                    <span>{recentDaily[recentDaily.length - 1]?.date}</span>
                  </div>
                </>
              )}
            </WorkbenchChartFrame>
          </WorkbenchSection>

          <WorkbenchSection
            title="每日明细"
            description="最近一个时间窗的逐日数据，金额右对齐便于比对。"
            icon={Wallet}
          >
            <WorkbenchTableWrap>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>订单数</th>
                    <th>收入</th>
                    <th>CDK 兑换</th>
                  </tr>
                </thead>
                <tbody>
                  {recentDaily.slice().reverse().map((d) => (
                    <tr key={d.date}>
                      <td>{d.date}</td>
                      <td className="tabular-nums">{d.order_count}</td>
                      <td className="text-right font-semibold tabular-nums text-emerald-700">
                        {formatCurrency(d.revenue)}
                      </td>
                      <td className="tabular-nums">{d.cdk_redeemed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </WorkbenchTableWrap>
          </WorkbenchSection>
        </>
      )}
    </WorkbenchShell>
  );
}
