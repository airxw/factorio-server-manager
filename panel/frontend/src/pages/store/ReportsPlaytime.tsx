// ============================================================================
// 时长统计（GM Workbench 真实数据页面）
// v4.x: 迁入 Workbench DS 壳层，统一 /store 视觉语言
// 接入 GET /api/store/reports/playtime 后端 API
// 玩家游戏时长统计——按日聚合会话数、总时长、活跃玩家数
// 数据源：player_sessions 表（依赖步骤18a migration + 步骤18b daemon 写入链路）
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, RefreshCw, AlertTriangle, Info } from 'lucide-react';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import { useToast, ErrorState } from '../../components/ui';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import type { StoreServerItem, PlaytimeDailyItem } from '../../api/modules/store-gm';
import {
  WorkbenchShell,
  WorkbenchHeader,
  WorkbenchMetricCard,
  WorkbenchSection,
  WorkbenchEmpty,
  WorkbenchNote,
  WorkbenchFilterBar,
  WorkbenchSelect,
  WorkbenchSegmented,
  WorkbenchPrimaryButton,
  WorkbenchChartFrame,
  WorkbenchTableWrap,
} from './components/WorkbenchUI';
import { formatDuration, REPORT_DAY_OPTIONS } from './utils/format';

export default function ReportsPlaytime() {
  const { api } = useAuth();
  const toast = useToast();
  useDocumentTitle('时长统计');

  const [servers, setServers] = useState<StoreServerItem[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('');
  const [daily, setDaily] = useState<PlaytimeDailyItem[]>([]);
  const [summary, setSummary] = useState({
    total_playtime_seconds: 0,
    total_sessions: 0,
    active_players: 0,
    days: 30,
  });
  const [note, setNote] = useState<string | null>(null);
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

  // 2. 加载时长统计
  const refresh = useCallback(async () => {
    if (!selectedInstanceId) {
      setDaily([]);
      setNote(null);
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const res = await api.getStorePlaytimeReport(selectedInstanceId, days);
      if (reqId !== reqIdRef.current) return;
      setDaily(res.daily);
      setSummary(res.summary);
      setNote(res.note ?? null);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      setError(err instanceof PanelApiError ? err.message : '加载时长统计失败');
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

  const maxSeconds = Math.max(...daily.map((d) => d.total_seconds), 1);
  const recentDaily = daily.slice(-days);
  const avgSeconds = recentDaily.length > 0
    ? recentDaily.reduce((s, d) => s + d.total_seconds, 0) / recentDaily.length
    : 0;

  return (
    <WorkbenchShell>
      <WorkbenchHeader
        eyebrow="GM Workbench · Reports"
        title="时长统计"
        description="按日聚合玩家会话与游戏时长，定位活跃度波动与流失信号。会话数据来自 player_sessions 表。"
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
          description="先创建实例，时长统计才会开始聚合会话数据。"
          icon={Clock}
          tone="blue"
        />
      ) : error ? (
        <WorkbenchSection title="报表加载失败" icon={AlertTriangle}>
          <ErrorState error={error} onRetry={refresh} retrying={refreshing} />
        </WorkbenchSection>
      ) : loading ? (
        <WorkbenchSection title="时长趋势" icon={Clock}>
          <div className="h-40 animate-pulse rounded-2xl bg-slate-100/70" />
        </WorkbenchSection>
      ) : (
        <>
          {note && (
            <WorkbenchNote tone="amber" icon={Info}>
              {note}
            </WorkbenchNote>
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <WorkbenchMetricCard
              label={`总时长（${summary.days}天）`}
              value={formatDuration(summary.total_playtime_seconds)}
              hint={`日均 ${formatDuration(avgSeconds)}`}
              icon={Clock}
              tone="blue"
            />
            <WorkbenchMetricCard
              label="总会话数"
              value={summary.total_sessions}
              hint={`日均 ${(summary.total_sessions / Math.max(summary.days, 1)).toFixed(1)} 次`}
              icon={RefreshCw}
              tone="emerald"
            />
            <WorkbenchMetricCard
              label="峰值活跃玩家"
              value={summary.active_players}
              hint="统计周期内单日峰值"
              icon={Clock}
              tone="amber"
            />
            <WorkbenchMetricCard
              label="平均会话时长"
              value={formatDuration(summary.total_sessions > 0 ? summary.total_playtime_seconds / summary.total_sessions : 0)}
              hint="总时长 / 总会话数"
              icon={Clock}
              tone="slate"
            />
          </div>

          <WorkbenchSection
            title="时长趋势"
            description="每日总时长柱状图，鼠标悬停查看会话数与活跃玩家明细。"
            icon={Clock}
          >
            <WorkbenchChartFrame
              title="每日总时长"
              legend={
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
                  总时长（秒）
                </span>
              }
            >
              {recentDaily.length === 0 ? (
                <WorkbenchEmpty
                  title="所选时间范围内暂无数据"
                  description="这段时间没有玩家会话记录。"
                  icon={Clock}
                  tone="slate"
                />
              ) : (
                <>
                  <div
                    className="flex items-end gap-1 h-44 overflow-x-auto rounded-2xl bg-slate-50/60 p-3"
                    role="img"
                    aria-label="每日总时长趋势柱状图"
                  >
                    {recentDaily.map((d) => (
                      <div
                        key={d.date}
                        className="flex-1 min-w-[8px] group relative"
                        title={`${d.date} | 总时长: ${formatDuration(d.total_seconds)} | 会话: ${d.session_count} | 活跃: ${d.active_players} | 均值: ${formatDuration(d.avg_seconds)}`}
                      >
                        <div
                          className="bg-blue-500/80 hover:bg-blue-600 transition-colors rounded-t w-full"
                          style={{ height: `${Math.max((d.total_seconds / maxSeconds) * 100, 2)}%` }}
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
            description="最近一个时间窗的逐日数据，时长右对齐便于比对。"
            icon={Clock}
          >
            <WorkbenchTableWrap>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>会话数</th>
                    <th>总时长</th>
                    <th>活跃玩家</th>
                    <th>平均时长</th>
                  </tr>
                </thead>
                <tbody>
                  {recentDaily.slice().reverse().map((d) => (
                    <tr key={d.date}>
                      <td>{d.date}</td>
                      <td className="tabular-nums">{d.session_count}</td>
                      <td className="text-right font-semibold tabular-nums text-blue-700">
                        {formatDuration(d.total_seconds)}
                      </td>
                      <td className="tabular-nums">{d.active_players}</td>
                      <td className="tabular-nums">{formatDuration(d.avg_seconds)}</td>
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
