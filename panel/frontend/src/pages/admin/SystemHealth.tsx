// ============================================================================
// SystemHealth — 系统健康状态仪表盘（11.4）
// 展示：CPU/内存/磁盘使用率（进度条 + 颜色指示）、服务健康状态、在线实例数
// 数据源：api.getSystemMetrics() + api.getSystemHealth() + api.listServers()
// 优雅降级：端点 404/错误时展示"系统监控接口暂未开放"占位
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Server,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import type { NodeDiskUsage } from '@public/schema/panel-api-types';
import type { DataVolumeTableStatus } from '@public/schema/panel-api-types';
import type { PanelSystemMonitorEvent } from '@public/schema/ws-events';
import {
  queryKeys,
  useDataVolume,
  useNodes,
  useNodesDiskUsage,
  useServers,
  useSystemHealth,
  useSystemMetrics,
} from '../../api/queries';
import { getEffectiveRole, isAdminRole } from '../../utils/role';
import { formatBytes as formatBytesShared } from '../../utils/formatBytes';
// v3.7.0-D1: 合并 Diagnostics 为 Tab，删除 /admin/diagnostics 独立路由
import Diagnostics from './Diagnostics';
// v4.4.0-K2: 系统监控 WebSocket Store
import { systemMonitorStore } from '../../stores/systemMonitorStore';

/** 判断错误是否为端点不存在（404）或网络错误 */
function isEndpointUnavailable(err: unknown): boolean {
  if (err instanceof PanelApiError) {
    return err.status === 404 || err.code === 'HTTP_404' || err.code === 'NETWORK_ERROR';
  }
  return true;
}

/** 根据使用率返回状态等级：green(<70) / yellow(<90) / red(>=90) */
function usageLevel(usage: number | undefined): 'green' | 'yellow' | 'red' | 'unknown' {
  if (usage === undefined) return 'unknown';
  if (usage >= 90) return 'red';
  if (usage >= 70) return 'yellow';
  return 'green';
}

const LEVEL_COLOR: Record<'green' | 'yellow' | 'red' | 'unknown', string> = {
  green: '#16a34a',
  yellow: '#d97706',
  red: '#dc2626',
  unknown: '#9ca3af',
};

interface MetricCardProps {
  icon: typeof Cpu;
  label: string;
  usage: number | undefined;
  detail?: string;
  unavailable: boolean;
}

function MetricCard({ icon: Icon, label, usage, detail, unavailable }: MetricCardProps) {
  const level = usageLevel(usage);
  const color = LEVEL_COLOR[level];
  return (
    <div className="info-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Icon size={18} />
        <h4 className="card-title" style={{ margin: 0 }}>
          {label}
        </h4>
      </div>
      {unavailable ? (
        <p className="form-hint">接口暂未开放</p>
      ) : usage === undefined ? (
        <p className="form-hint">暂无数据</p>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span className="mono" style={{ fontSize: 18, fontWeight: 600, color }}>
              {usage.toFixed(1)}%
            </span>
            {detail && <span className="form-hint">{detail}</span>}
          </div>
          <div
            style={{
              height: 10,
              background: '#e5e7eb',
              borderRadius: 5,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(100, Math.max(0, usage))}%`,
                height: '100%',
                background: color,
                transition: 'width 0.4s',
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function ServiceStatusBadge({ status }: { status: 'healthy' | 'degraded' | 'unhealthy' }) {
  if (status === 'healthy') {
    return (
      <span className="badge badge-running" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <CheckCircle2 size={12} />
        正常
      </span>
    );
  }
  if (status === 'degraded') {
    return (
      <span className="badge badge-starting" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <AlertTriangle size={12} />
        降级
      </span>
    );
  }
  return (
    <span className="badge badge-error" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <XCircle size={12} />
      异常
    </span>
  );
}

/** 字节数格式化为可读字符串 */
function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

/** 把 used/total（任意相同单位）换算为 0-100 的使用率；任一缺失或 total<=0 返回 undefined */
function percentOf(used: number | undefined, total: number | undefined): number | undefined {
  if (used === undefined || total === undefined) return undefined;
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return undefined;
  return (used / total) * 100;
}

export default function SystemHealth() {
  const { user } = useAuth();
  const qc = useQueryClient();
  // v4.4.0-K2: 4-Tab 结构 + v4.32.2 B2.8 新增 data-volume Tab
  // metrics（实时指标）/ realtime（实时监控曲线）/ diagnostics（一键诊断）/ disk（磁盘概览）/ data-volume（数据量监控）
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'metrics' | 'realtime' | 'diagnostics' | 'disk' | 'data-volume'>(() => {
    const fromUrl = searchParams.get('tab');
    return fromUrl === 'diagnostics' || fromUrl === 'disk' || fromUrl === 'realtime' || fromUrl === 'data-volume'
      ? fromUrl
      : 'metrics';
  });

  const switchTab = useCallback(
    (tab: 'metrics' | 'realtime' | 'diagnostics' | 'disk' | 'data-volume') => {
      setActiveTab(tab);
      setSearchParams({ tab }, { replace: true });
    },
    [setSearchParams],
  );

  // 浏览器前进/后退同步 Tab
  useEffect(() => {
    const fromUrl = searchParams.get('tab');
    if (fromUrl === 'diagnostics' || fromUrl === 'disk' || fromUrl === 'realtime' || fromUrl === 'data-volume') {
      if (fromUrl !== activeTab) setActiveTab(fromUrl);
    } else if (activeTab !== 'metrics') {
      setActiveTab('metrics');
    }
  }, [searchParams, activeTab]);

  // B2.6: 数据层迁移至 TanStack Query——各查询独立降级，保留 isEndpointUnavailable 语义
  const metricsQuery = useSystemMetrics();
  const healthQuery = useSystemHealth();
  const serversQuery = useServers();
  const nodesQuery = useNodes();
  const nodeIds = nodesQuery.data?.nodes.map((n) => n.id) ?? [];
  const diskQueries = useNodesDiskUsage(nodeIds);
  // v4.32.2 B2.8: 数据量监控告警
  const dataVolumeQuery = useDataVolume();

  // 与原变量名对齐，避免改动下方 JSX
  const metrics = metricsQuery.data ?? null;
  const health = healthQuery.data ?? null;
  const servers = serversQuery.data?.servers ?? [];
  const nodeDiskUsages: NodeDiskUsage[] = diskQueries
    .map((q) => q.data?.usage)
    .filter((u): u is NodeDiskUsage => !!u);

  // 端点 404/NETWORK_ERROR → 「接口暂未开放」占位（保留原降级语义）
  const metricsUnavailable = metricsQuery.error ? isEndpointUnavailable(metricsQuery.error) : false;
  const healthUnavailable = healthQuery.error ? isEndpointUnavailable(healthQuery.error) : false;
  const nodeDiskUnavailable = nodesQuery.error ? isEndpointUnavailable(nodesQuery.error) : false;

  // 实例列表非端点缺失类错误时才展示错误条（与原逻辑一致）
  const serversErr = serversQuery.error;
  const error =
    serversErr && !isEndpointUnavailable(serversErr)
      ? serversErr instanceof Error
        ? serversErr.message
        : '加载实例列表失败'
      : null;

  // 任意相关查询在拉取中即视为 loading（覆盖初始加载与刷新）
  const loading =
    metricsQuery.isFetching ||
    healthQuery.isFetching ||
    serversQuery.isFetching ||
    nodesQuery.isFetching ||
    diskQueries.some((q) => q.isFetching) ||
    dataVolumeQuery.isFetching;

  const refresh = useCallback(() => {
    // 失效本页相关缓存，触发各 query 自动重拉
    void qc.invalidateQueries({ queryKey: queryKeys.systemHealth.all });
    void qc.invalidateQueries({ queryKey: queryKeys.servers.list() });
    void qc.invalidateQueries({ queryKey: queryKeys.nodes.list() });
  }, [qc]);

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  const runningCount = servers.filter((s) => s.status === 'running').length;
  const totalServers = servers.length;
  const allUnavailable = metricsUnavailable && healthUnavailable;

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">系统监控</h2>
        <div className="page-actions">
          {(activeTab === 'metrics' || activeTab === 'disk' || activeTab === 'data-volume') && (
            <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw size={14} />
              {loading ? '刷新中…' : '刷新'}
            </button>
          )}
        </div>
      </div>

      {/* v4.4.0-K2: 4-Tab 导航 + v4.32.2 B2.8 新增 data-volume Tab */}
      <div className="business-sub-tabs" role="tablist" aria-label="系统监控子标签页">
        <button
          role="tab"
          aria-selected={activeTab === 'metrics'}
          className={`tab-btn${activeTab === 'metrics' ? ' active' : ''}`}
          onClick={() => switchTab('metrics')}
        >
          实时指标
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'realtime'}
          className={`tab-btn${activeTab === 'realtime' ? ' active' : ''}`}
          onClick={() => switchTab('realtime')}
        >
          实时监控曲线
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'diagnostics'}
          className={`tab-btn${activeTab === 'diagnostics' ? ' active' : ''}`}
          onClick={() => switchTab('diagnostics')}
        >
          一键诊断
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'disk'}
          className={`tab-btn${activeTab === 'disk' ? ' active' : ''}`}
          onClick={() => switchTab('disk')}
        >
          磁盘概览
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'data-volume'}
          className={`tab-btn${activeTab === 'data-volume' ? ' active' : ''}`}
          onClick={() => switchTab('data-volume')}
        >
          数据量监控
          {dataVolumeQuery.data?.has_alert && (
            <span
              className="badge badge-error"
              style={{ marginLeft: 6, fontSize: 11, padding: '2px 6px' }}
              aria-label="存在告警"
            >
              {dataVolumeQuery.data.critical_count + dataVolumeQuery.data.warning_count}
            </span>
          )}
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        {/* Tab 1: 实时指标——系统资源 + 服务状态 + 实例概览 */}
        {activeTab === 'metrics' && (
          <>
            {error && <div className="alert alert-error">{error}</div>}

            {allUnavailable && !loading ? (
              <div className="empty-state">系统监控接口暂未开放。</div>
            ) : (
              <>
                {/* 系统资源指标区 */}
                <h3 className="card-title" style={{ margin: '12px 0 8px' }}>
                  <Activity size={16} /> 系统资源
                </h3>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: 12,
                    marginBottom: 24,
                  }}
                >
                  <MetricCard
                    icon={Cpu}
                    label="CPU 使用率"
                    usage={metrics?.cpuPercent}
                    detail={
                      metrics?.loadAvg && metrics.loadAvg.length > 0
                        ? `负载 ${metrics.loadAvg[0].toFixed(2)} / ${metrics.loadAvg[1].toFixed(2)} / ${metrics.loadAvg[2].toFixed(2)}`
                        : undefined
                    }
                    unavailable={metricsUnavailable}
                  />
                  <MetricCard
                    icon={MemoryStick}
                    label="内存使用率"
                    usage={percentOf(metrics?.memUsedMb, metrics?.memTotalMb)}
                    detail={
                      metrics?.memTotalMb
                        ? `总量 ${formatBytes(metrics.memTotalMb * 1024 * 1024)}`
                        : undefined
                    }
                    unavailable={metricsUnavailable}
                  />
                  <MetricCard
                    icon={HardDrive}
                    label="磁盘使用率"
                    usage={percentOf(metrics?.diskUsedGb, metrics?.diskTotalGb)}
                    detail={
                      metrics?.diskTotalGb
                        ? `总量 ${formatBytes(metrics.diskTotalGb * 1024 * 1024 * 1024)}`
                        : undefined
                    }
                    unavailable={metricsUnavailable}
                  />
                </div>

                {/* 服务健康状态区 */}
                <h3 className="card-title" style={{ margin: '12px 0 8px' }}>
                  <Activity size={16} /> 服务状态
                </h3>
                {healthUnavailable ? (
                  <div className="info-card">
                    <p className="form-hint">健康检查接口暂未开放</p>
                  </div>
                ) : health?.services && health.services.length > 0 ? (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>服务</th>
                          <th>状态</th>
                          <th>延迟</th>
                          <th>备注</th>
                        </tr>
                      </thead>
                      <tbody>
                        {health.services.map((svc) => (
                          <tr key={svc.name}>
                            <td className="mono">{svc.name}</td>
                            <td>
                              <ServiceStatusBadge status={svc.status} />
                            </td>
                            <td>
                              {svc.latencyMs !== undefined ? `${svc.latencyMs} ms` : '—'}
                            </td>
                            <td>{svc.message ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="info-card">
                    <p className="form-hint">{loading ? '加载中…' : '暂无服务状态数据'}</p>
                  </div>
                )}

                {/* 在线实例数区 */}
                <h3 className="card-title" style={{ margin: '12px 0 8px' }}>
                  <Server size={16} /> 实例概览
                </h3>
                <div className="info-card">
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    <div>
                      <div className="form-label">在线实例</div>
                      <div className="mono" style={{ fontSize: 24, fontWeight: 600, color: '#16a34a' }}>
                        {runningCount}
                      </div>
                    </div>
                    <div>
                      <div className="form-label">总实例数</div>
                      <div className="mono" style={{ fontSize: 24, fontWeight: 600 }}>
                        {totalServers}
                      </div>
                    </div>
                    <div>
                      <div className="form-label">系统运行时长</div>
                      <div className="mono" style={{ fontSize: 16, paddingTop: 4 }}>
                        {metrics?.uptimeSeconds !== undefined ? formatUptime(metrics.uptimeSeconds) : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* Tab 2: 实时监控曲线——WebSocket 实时 CPU/内存/磁盘曲线图（v4.4.0-K2） */}
        {activeTab === 'realtime' && <RealtimeMonitorPanel />}

        {/* Tab 3: 一键诊断——嵌入 Diagnostics 组件 */}
        {activeTab === 'diagnostics' && <Diagnostics embedded />}

        {/* Tab 4: 磁盘概览——节点磁盘总览 */}
        {activeTab === 'disk' && (
          <>
            {error && <div className="alert alert-error">{error}</div>}

            <h3 className="card-title" style={{ margin: '12px 0 8px' }}>
              <HardDrive size={16} /> 节点磁盘总览
            </h3>
            {nodeDiskUnavailable ? (
              <div className="info-card">
                <p className="form-hint">节点磁盘接口暂未开放</p>
              </div>
            ) : nodeDiskUsages.length === 0 ? (
              <div className="info-card">
                <p className="form-hint">{loading ? '加载中…' : '暂无节点磁盘数据'}</p>
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: 12,
                }}
              >
                {nodeDiskUsages.map((nd) => {
                  const percent = nd.used_percent;
                  const isOver80 = percent >= 80;
                  const color = percent >= 90 ? '#dc2626' : percent >= 80 ? '#dc2626' : percent >= 70 ? '#d97706' : '#16a34a';
                  return (
                    <div key={nd.node_id} className="info-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span className="mono" style={{ fontWeight: 600 }}>{nd.node_id}</span>
                        <span
                          className="mono"
                          style={{ fontWeight: isOver80 ? 'bold' : 'normal', color: isOver80 ? '#dc2626' : undefined }}
                        >
                          {percent.toFixed(1)}%
                        </span>
                      </div>
                      <div
                        style={{
                          height: 10,
                          background: '#e5e7eb',
                          borderRadius: 5,
                          overflow: 'hidden',
                          marginBottom: 8,
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.min(100, Math.max(0, percent))}%`,
                            height: '100%',
                            background: color,
                            transition: 'width 0.4s',
                          }}
                        />
                      </div>
                      <div className="form-hint" style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>已用 {formatBytesShared(nd.used_bytes)}</span>
                        <span>总量 {formatBytesShared(nd.total_bytes)}</span>
                      </div>
                      <div className="form-hint" style={{ marginTop: 4, opacity: 0.7 }}>
                        挂载点: {nd.mount} · 文件系统: {nd.filesystem}
                      </div>
                      {isOver80 && (
                        <div
                          className="alert alert-error"
                          style={{ marginTop: 8, padding: '4px 8px', fontSize: 12 }}
                        >
                          ⚠️ 磁盘使用率超过 80%，请及时清理
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Tab 5: 数据量监控（v4.32.2 B2.8）——监控 7 张关键表行数增长 */}
        {activeTab === 'data-volume' && (
          <DataVolumePanel
            data={dataVolumeQuery.data ?? null}
            loading={dataVolumeQuery.isFetching}
            error={dataVolumeQuery.error}
            unavailable={dataVolumeQuery.error ? isEndpointUnavailable(dataVolumeQuery.error) : false}
            onRefresh={() => void refresh()}
          />
        )}
      </div>
    </div>
  );
}

/** 将秒数格式化为可读运行时长 */
function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}天 ${h}小时`;
  if (h > 0) return `${h}小时 ${m}分钟`;
  return `${m}分钟`;
}

// ============================================================================
// v4.4.0-K2: RealtimeMonitorPanel — 实时监控曲线组件
//
// 功能：
//   - 订阅 systemMonitorStore，实时显示 CPU / 内存 / 磁盘使用率曲线
//   - 显示进程 RSS / 进程 CPU / WS 连接数等运行时指标
//   - 历史数据保留 1 小时（由 store 维护），组件卸载时自动退订
//   - 连接断开时显示状态提示
// ============================================================================

interface MetricPoint {
  timestamp: number;
  value: number;
}

interface SeriesColor {
  stroke: string;
  fill: string;
}

const SERIES_COLORS: Record<'cpu' | 'memory' | 'disk', SeriesColor> = {
  cpu: { stroke: '#3b82f6', fill: 'rgba(59, 130, 246, 0.15)' },
  memory: { stroke: '#10b981', fill: 'rgba(16, 185, 129, 0.15)' },
  disk: { stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.15)' },
};

/** Sparkline——轻量 SVG 折线图（无第三方依赖） */
function Sparkline({
  points,
  color,
  height = 80,
  max = 100,
  label,
  current,
  detail,
}: {
  points: MetricPoint[];
  color: SeriesColor;
  height?: number;
  max?: number;
  label: string;
  current: number | undefined;
  detail?: string;
}) {
  const width = 600;
  const padding = { top: 8, right: 8, bottom: 16, left: 32 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  // 至少需要 2 个点才能绘制折线
  if (points.length < 2) {
    return (
      <div className="info-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span className="form-label">{label}</span>
          <span className="form-hint">等待数据...</span>
        </div>
        <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="form-hint">暂无足够数据点（至少需要 2 次采样）</span>
        </div>
      </div>
    );
  }

  // 计算 SVG 路径
  const xMin = points[0]!.timestamp;
  const xMax = points[points.length - 1]!.timestamp;
  const xRange = Math.max(1, xMax - xMin);

  const toX = (t: number) => padding.left + ((t - xMin) / xRange) * innerW;
  const toY = (v: number) => padding.top + innerH - (Math.min(max, Math.max(0, v)) / max) * innerH;

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.timestamp).toFixed(1)} ${toY(p.value).toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${toX(xMax).toFixed(1)} ${padding.top + innerH} L ${toX(xMin).toFixed(1)} ${padding.top + innerH} Z`;

  // Y 轴刻度（0/50/100）
  const yTicks = [0, 25, 50, 75, 100];

  return (
    <div className="info-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="form-label">{label}</span>
        <span className="mono" style={{ fontWeight: 600, color: color.stroke }}>
          {current !== undefined ? `${current.toFixed(2)}%` : '—'}
        </span>
      </div>
      {detail && <div className="form-hint" style={{ marginBottom: 4 }}>{detail}</div>}
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        {/* 网格线 */}
        {yTicks.map((tick) => {
          const y = padding.top + innerH - (tick / 100) * innerH;
          return (
            <g key={tick}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="#e5e7eb"
                strokeWidth={1}
                strokeDasharray={tick === 0 ? '0' : '2 2'}
              />
              <text
                x={padding.left - 4}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill="#9ca3af"
              >
                {tick}
              </text>
            </g>
          );
        })}
        {/* 填充区域 */}
        <path d={areaPath} fill={color.fill} />
        {/* 折线 */}
        <path d={linePath} fill="none" stroke={color.stroke} strokeWidth={1.5} />
      </svg>
    </div>
  );
}

function RealtimeMonitorPanel() {
  const [events, setEvents] = useState<PanelSystemMonitorEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // 订阅监控数据
    const unsubscribe = systemMonitorStore.subscribe((event) => {
      // 仅保留最近 1800 条（1 小时），避免内存无界增长
      setEvents((prev) => {
        const next = [...prev, event];
        if (next.length > 1800) {
          return next.slice(-1800);
        }
        return next;
      });
    });

    // 订阅连接状态
    const unsubscribeConn = systemMonitorStore.subscribeConnection((c) => {
      setConnected(c);
    });

    // 首次挂载时拉取一次历史数据
    const history = systemMonitorStore.getHistory(1800);
    if (history.length > 0) {
      // history 是最新在前，反转为旧→新
      setEvents([...history].reverse());
    }

    return () => {
      unsubscribe();
      unsubscribeConn();
    };
  }, []);

  const latest = events.length > 0 ? events[events.length - 1] : null;

  // 转换为 Sparkline 需要的格式
  const toPoints = (key: keyof Pick<PanelSystemMonitorEvent, 'cpu_percent' | 'memory_percent' | 'disk_percent'>): MetricPoint[] => {
    return events.map((e) => ({
      timestamp: new Date(e.timestamp).getTime(),
      value: e[key],
    }));
  };

  const cpuPoints = toPoints('cpu_percent');
  const memoryPoints = toPoints('memory_percent');
  const diskPoints = toPoints('disk_percent');

  return (
    <>
      {/* 连接状态提示 */}
      <div className="info-card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span className="form-label">WebSocket 连接状态：</span>
            {connected ? (
              <span className="badge badge-running" style={{ marginLeft: 8 }}>
                <CheckCircle2 size={12} style={{ marginRight: 4 }} />
                已连接
              </span>
            ) : (
              <span className="badge badge-error" style={{ marginLeft: 8 }}>
                <XCircle size={12} style={{ marginRight: 4 }} />
                断开
              </span>
            )}
          </div>
          <div className="form-hint">
            采样间隔 2 秒 · 历史保留 1 小时（{events.length}/1800 条）
          </div>
        </div>
      </div>

      {/* 三条曲线 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <Sparkline
          points={cpuPoints}
          color={SERIES_COLORS.cpu}
          label="CPU 使用率"
          current={latest?.cpu_percent}
          detail={latest ? `进程 CPU ${latest.process_cpu_percent.toFixed(2)}%` : undefined}
        />
        <Sparkline
          points={memoryPoints}
          color={SERIES_COLORS.memory}
          label="内存使用率"
          current={latest?.memory_percent}
          detail={
            latest
              ? `已用 ${formatBytesShared(latest.memory_used_bytes)} / 总量 ${formatBytesShared(latest.memory_total_bytes)}`
              : undefined
          }
        />
        <Sparkline
          points={diskPoints}
          color={SERIES_COLORS.disk}
          label="磁盘使用率"
          current={latest?.disk_percent}
          detail={
            latest
              ? `已用 ${formatBytesShared(latest.disk_used_bytes)} / 总量 ${formatBytesShared(latest.disk_total_bytes)}`
              : undefined
          }
        />
      </div>

      {/* 进程运行时指标 */}
      <h3 className="card-title" style={{ margin: '12px 0 8px' }}>
        <Activity size={16} /> Panel 进程指标
      </h3>
      <div className="info-card">
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div className="form-label">进程 RSS</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
              {latest ? formatBytesShared(latest.process_rss_bytes) : '—'}
            </div>
          </div>
          <div>
            <div className="form-label">进程 CPU</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
              {latest ? `${latest.process_cpu_percent.toFixed(2)}%` : '—'}
            </div>
          </div>
          <div>
            <div className="form-label">WS 连接数</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
              {latest?.ws_connections ?? '—'}
            </div>
          </div>
          <div>
            <div className="form-label">最后更新</div>
            <div className="mono" style={{ fontSize: 14, paddingTop: 4 }}>
              {latest ? new Date(latest.timestamp).toLocaleTimeString() : '—'}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// v4.32.2 B2.8: DataVolumePanel — 数据量监控告警面板
//
// 功能：
//   - 展示 7 张关键表的行数 + 阈值 + 告警等级
//   - 告警等级：normal(<80%) / warning(80-95%) / critical(>95%)
//   - 概览：总告警数 + critical 数 + warning 数 + 上次采集时间
//   - 单表失败不阻断其他表（后端已处理）
//   - 阈值可通过 system_config KV 覆盖：key = monitor.data_volume_threshold.<table>
// ============================================================================

/** 表名 → 中文展示名 */
const DATA_VOLUME_TABLE_LABELS: Record<string, string> = {
  audit_logs: '审计日志',
  user_notifications: '用户通知',
  item_sync_log: '物品同步日志',
  chat_logs: '聊天日志',
  player_bindings: '玩家绑定',
  webhooks: 'Webhook 配置',
  api_keys: 'API Keys',
};

const DATA_VOLUME_LEVEL_COLOR: Record<'normal' | 'warning' | 'critical', string> = {
  normal: '#16a34a',
  warning: '#d97706',
  critical: '#dc2626',
};

const DATA_VOLUME_LEVEL_LABEL: Record<'normal' | 'warning' | 'critical', string> = {
  normal: '正常',
  warning: '警告',
  critical: '严重',
};

const DATA_VOLUME_LEVEL_BADGE: Record<'normal' | 'warning' | 'critical', string> = {
  normal: 'badge-running',
  warning: 'badge-starting',
  critical: 'badge-error',
};

interface DataVolumePanelProps {
  data: import('@public/schema/panel-api-types').DataVolumeResponse | null;
  loading: boolean;
  error: unknown;
  unavailable: boolean;
  onRefresh: () => void;
}

function DataVolumePanel({ data, loading, error, unavailable, onRefresh }: DataVolumePanelProps) {
  // 端点 404/不可用
  if (unavailable) {
    return (
      <div className="info-card">
        <p className="form-hint">数据量监控接口暂未开放</p>
      </div>
    );
  }

  // 其他错误
  if (error && !data) {
    const msg = error instanceof Error ? error.message : '加载数据量监控数据失败';
    return (
      <div className="info-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <AlertTriangle size={16} />
          <span>{msg}</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}>
          <RefreshCw size={12} /> 重试
        </button>
      </div>
    );
  }

  // 加载中（首次）
  if (loading && !data) {
    return (
      <div className="info-card">
        <p className="form-hint">加载中…</p>
      </div>
    );
  }

  if (!data) return null;

  const tables = data.tables;
  const checkedAt = new Date(data.checked_at).toLocaleString('zh-CN');

  return (
    <>
      {/* 概览卡片：告警计数 + 采集时间 */}
      <div
        className="info-card"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}
      >
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div className="form-label">总告警数</div>
            <div
              className="mono"
              style={{
                fontSize: 24,
                fontWeight: 600,
                color: data.has_alert ? '#dc2626' : '#16a34a',
              }}
            >
              {data.critical_count + data.warning_count}
            </div>
          </div>
          <div>
            <div className="form-label">严重（critical）</div>
            <div
              className="mono"
              style={{ fontSize: 24, fontWeight: 600, color: data.critical_count > 0 ? '#dc2626' : undefined }}
            >
              {data.critical_count}
            </div>
          </div>
          <div>
            <div className="form-label">警告（warning）</div>
            <div
              className="mono"
              style={{ fontSize: 24, fontWeight: 600, color: data.warning_count > 0 ? '#d97706' : undefined }}
            >
              {data.warning_count}
            </div>
          </div>
          <div>
            <div className="form-label">监控表数</div>
            <div className="mono" style={{ fontSize: 24, fontWeight: 600 }}>
              {tables.length}
            </div>
          </div>
          <div>
            <div className="form-label">采集时间</div>
            <div className="mono" style={{ fontSize: 14, paddingTop: 4 }}>{checkedAt}</div>
          </div>
        </div>
        {loading && <span className="form-hint">刷新中…</span>}
      </div>

      {/* 顶部告警横幅：有 critical 时显著提示 */}
      {data.critical_count > 0 && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          <AlertTriangle size={16} style={{ marginRight: 8, verticalAlign: 'middle' }} />
          <strong>检测到 {data.critical_count} 张表已超过阈值 95%</strong>
          <span style={{ marginLeft: 8 }}>
            ——建议立即清理（audit_logs/user_notifications 可走运维清理页；player_bindings/webhooks/api_keys 需评估是否改造分页）
          </span>
        </div>
      )}

      {/* 单表监控卡片网格 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 12,
        }}
      >
        {tables.map((t) => (
          <DataVolumeTableCard key={t.table_name} table={t} />
        ))}
      </div>

      {/* 说明区 */}
      <div className="info-card" style={{ marginTop: 16 }}>
        <h4 className="card-title">阈值说明</h4>
        <ul className="form-hint" style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.8 }}>
          <li>
            <strong>normal</strong>：行数 &lt; 阈值 × 80%——数据量正常
          </li>
          <li>
            <strong>warning</strong>：阈值 × 80% ≤ 行数 &lt; 阈值 × 95%——关注增长趋势
          </li>
          <li>
            <strong>critical</strong>：行数 ≥ 阈值 × 95%——触发分页改造评估
          </li>
          <li>
            阈值可通过 <code className="mono">system_config</code> KV 覆盖：
            <br />
            <code className="mono" style={{ fontSize: 12 }}>
              key = monitor.data_volume_threshold.&lt;table_name&gt;
            </code>
            ，<code className="mono" style={{ fontSize: 12 }}>value = 数字字符串</code>
          </li>
          <li>告警持续 1 周以上由人工决定是否单独改造该页面分页（不强制推广到全部表）</li>
        </ul>
      </div>
    </>
  );
}

/** 单张表的数据量监控卡片 */
function DataVolumeTableCard({ table }: { table: DataVolumeTableStatus }) {
  const color = DATA_VOLUME_LEVEL_COLOR[table.level];
  const label = DATA_VOLUME_TABLE_LABELS[table.table_name] ?? table.table_name;
  const percent = Math.min(100, table.percent);

  return (
    <div className="info-card">
      {/* 表头：中文名 + 表名 mono + 告警徽章 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div>
          <span style={{ fontWeight: 600 }}>{label}</span>
          <div className="form-hint mono" style={{ fontSize: 11 }}>
            {table.table_name}
          </div>
        </div>
        <span
          className={`badge ${DATA_VOLUME_LEVEL_BADGE[table.level]}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          {DATA_VOLUME_LEVEL_LABEL[table.level]}
        </span>
      </div>

      {/* 行数 + 阈值 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="mono" style={{ fontSize: 18, fontWeight: 600, color }}>
          {table.row_count.toLocaleString('zh-CN')}
        </span>
        <span className="form-hint">阈值 {table.threshold.toLocaleString('zh-CN')}</span>
      </div>

      {/* 进度条（按百分比渲染，超 100% 时填充满） */}
      <div
        style={{
          height: 10,
          background: '#e5e7eb',
          borderRadius: 5,
          overflow: 'hidden',
          marginBottom: 8,
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: '100%',
            background: color,
            transition: 'width 0.4s',
          }}
        />
      </div>

      {/* 百分比文字 */}
      <div className="form-hint" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>占用阈值</span>
        <span className="mono" style={{ color }}>
          {table.percent.toFixed(1)}%
        </span>
      </div>

      {/* critical 时显示行动建议 */}
      {table.level === 'critical' && (
        <div
          className="alert alert-error"
          style={{ marginTop: 8, padding: '4px 8px', fontSize: 12 }}
        >
          ⚠️ 已超过阈值 95%，建议立即清理或评估分页改造
        </div>
      )}
      {table.level === 'warning' && (
        <div
          className="alert"
          style={{
            marginTop: 8,
            padding: '4px 8px',
            fontSize: 12,
            background: '#fffbeb',
            color: '#92400e',
            border: '1px solid #fde68a',
          }}
        >
          ⚠️ 接近阈值，请关注增长趋势
        </div>
      )}
    </div>
  );
}
