// ============================================================================
// PlatformDashboard — 全平台总览（v4.7.0-G2）
// 路径：/admin/platform（仅 server_admin 可见）
//
// 展示：
//   1. KPI 卡片（总用户 / 24h活跃 / 实例数 / 节点数 / 今日收入 / 30天收入）
//   2. 用户分析卡片（v4.25.0 从 /admin/users 迁移）：按状态/角色/时间窗口细分
//   3. 实例状态分布（running/stopped/error 横条图）
//   4. 用户活跃度曲线（可切换 24h/30d）
//   5. 收入曲线（30天）
//   6. 磁盘用量 TopN 表格
//   7. 告警数显示（alerts_24h）
// 数据来源：GET /api/platform/{overview,users,revenue,disk-usage-top} + GET /api/users/stats
// ============================================================================

import { useState } from 'react';
import { RefreshCw, AlertCircle, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { PlatformOverview } from '@public/schema/panel-api-types';
import { useAuth } from '../../api/auth';
import {
  useDiskUsageTop,
  usePlatformOverview,
  usePlatformRevenueTrend,
  usePlatformUsersTrend,
  useUserStats,
} from '../../api/queries/admin';
import { queryKeys } from '../../api/queries/keys';
import { getEffectiveRole, isAdminRole } from '../../utils/role';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { EmptyState, ListSkeleton } from '../../components/ui';

/**
 * v4.22.8: KPI 卡片组件——支持点击穿透跳转到详情页
 *   - to: 跳转目标路由（如 '/admin/users'），未提供则卡片不可点击
 *   - label: KPI 名称（如 "总用户数"）
 *   - value: 主数值
 *   - tone: 数值颜色（success/primary/默认）
 *   - hint: 可选的副文本（如 "运行/总"）
 */
interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  to?: string;
  tone?: 'success' | 'primary' | 'default';
  hint?: string;
}

function KpiCard({ label, value, to, tone = 'default', hint }: KpiCardProps) {
  const navigate = useNavigate();
  const clickable = !!to;
  const toneColor =
    tone === 'success'
      ? 'var(--color-success, #16a34a)'
      : tone === 'primary'
        ? 'var(--color-primary, #007AFF)'
        : 'inherit';

  const handleClick = () => {
    if (clickable && to) navigate(to);
  };

  return (
    <div
      className={`info-card kpi-card ${clickable ? 'kpi-card-clickable' : ''}`}
      style={{ margin: 0, cursor: clickable ? 'pointer' : 'default' }}
      onClick={clickable ? handleClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClick();
              }
            }
          : undefined
      }
      aria-label={clickable ? `查看${label}详情` : undefined}
    >
      <div className="form-hint" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{label}</span>
        {clickable && (
          <ArrowUpRight
            size={14}
            style={{ color: 'var(--color-text-tertiary, #9ca3af)', opacity: 0.6 }}
            aria-hidden="true"
          />
        )}
      </div>
      <div className="mono" style={{ fontSize: 24, fontWeight: 'bold', color: toneColor }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary, #9ca3af)', marginTop: 2 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

const USER_RANGES: Array<{ value: '24h' | '30d'; label: string }> = [
  { value: '24h', label: '24 小时' },
  { value: '30d', label: '30 天' },
];

interface ChartPoint {
  date: string;
  value: number;
}

/** 简易 SVG 折线图组件——自适应宽度（viewBox）+ 最大值归一化 */
function LineChart({ data, color, label }: { data: ChartPoint[]; color: string; label: string }) {
  if (data.length === 0) {
    return <EmptyState title={`暂无${label}数据`} />;
  }
  const width = 600;
  const height = 160;
  const padding = 24;
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const stepX = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = padding + i * stepX;
    const y = height - padding - (d.value / maxVal) * (height - padding * 2);
    return { x, y, ...d };
  });
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaD = `${pathD} L${points[points.length - 1].x},${height - padding} L${points[0].x},${height - padding} Z`;
  const showLabels = data.length <= 30;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height: 160, display: 'block' }}>
      <defs>
        <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="var(--color-border, #e5e7eb)" strokeWidth={1} />
      <path d={areaD} fill={`url(#grad-${label})`} />
      <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {showLabels &&
        points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={2.5} fill={color} />
            {i % Math.ceil(data.length / 6 || 1) === 0 && (
              <text x={p.x} y={height - 6} textAnchor="middle" fontSize={9} fill="var(--color-text-secondary, #6b7280)">
                {p.date.slice(5)}
              </text>
            )}
          </g>
        ))}
    </svg>
  );
}

/** 实例状态分布横条图 */
function StatusBar({ dist }: { dist: PlatformOverview['instance_status_distribution'] }) {
  const total = dist.running + dist.stopped + dist.error;
  if (total === 0) {
    return <EmptyState title="暂无实例" />;
  }
  const segments = [
    { label: '运行中', value: dist.running, color: 'var(--color-success, #16a34a)' },
    { label: '已停止', value: dist.stopped, color: 'var(--color-text-secondary, #6b7280)' },
    { label: '错误', value: dist.error, color: 'var(--color-error, #ef4444)' },
  ];
  return (
    <div>
      <div style={{ display: 'flex', height: 24, borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
        {segments.map((s) =>
          s.value > 0 ? (
            <div
              key={s.label}
              style={{
                width: `${(s.value / total) * 100}%`,
                background: s.color,
                transition: 'width 0.3s',
              }}
              title={`${s.label}: ${s.value}`}
            />
          ) : null,
        )}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
        {segments.map((s) => (
          <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: s.color }} />
            {s.label}: <strong className="mono">{s.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function PlatformDashboard() {
  const { user } = useAuth();

  if (!isAdminRole(getEffectiveRole(user))) return <Navigate to="/forbidden" replace />;
  useDocumentTitle('全平台总览');

  const queryClient = useQueryClient();
  const [userRange, setUserRange] = useState<'24h' | '30d'>('30d');

  // 5 个并行查询，各自独立降级（每区块单独「加载失败」+ 重试）
  const overviewQuery = usePlatformOverview();
  const usersTrendQuery = usePlatformUsersTrend(userRange);
  const revenueQuery = usePlatformRevenueTrend(30);
  const diskTopQuery = useDiskUsageTop(10);
  const userStatsQuery = useUserStats();

  const overview = overviewQuery.data ?? null;
  const usersTrend = usersTrendQuery.data ?? null;
  const revenue = revenueQuery.data ?? null;
  const diskTop = diskTopQuery.data ?? null;
  // v4.25.0: 用户分析统计（从 /admin/users 迁移而来）
  const userStats = userStatsQuery.data ?? null;

  const overviewError = !!overviewQuery.error;
  const usersTrendError = !!usersTrendQuery.error;
  const revenueError = !!revenueQuery.error;
  const diskTopError = !!diskTopQuery.error;
  const userStatsError = !!userStatsQuery.error;

  // 任意查询在 fetching 中即视为刷新中（对齐全局 loading 语义）
  const loading =
    overviewQuery.isFetching ||
    usersTrendQuery.isFetching ||
    revenueQuery.isFetching ||
    diskTopQuery.isFetching ||
    userStatsQuery.isFetching;

  // 主数据（overview）失败时的错误消息，用于全页错误横幅
  const error = overviewQuery.error
    ? overviewQuery.error instanceof Error
      ? overviewQuery.error.message
      : '加载全平台总览数据失败'
    : null;

  // 全局刷新：失效所有 platform 查询（触发并行重取）
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.platform.all });
  };

  const handleRangeChange = (range: '24h' | '30d') => {
    if (range === userRange) return;
    setUserRange(range);
  };

  if (overviewQuery.isLoading && !overview) {
    return (
      <div className="page-container">
        <h1 className="page-title">全平台总览</h1>
        <ListSkeleton />
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="page-container">
        <h1 className="page-title">全平台总览</h1>
        <div className="error-banner" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, background: 'var(--color-bg-error, #fef2f2)', borderRadius: 6 }}>
          <AlertCircle size={18} />
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => refresh()}>
            <RefreshCw size={14} /> 重试
          </button>
        </div>
      </div>
    );
  }

  const userPoints: ChartPoint[] = (usersTrend?.points ?? []).map((p) => ({
    date: p.date,
    value: p.active_users,
  }));
  const revenuePoints: ChartPoint[] = (revenue?.points ?? []).map((p) => ({
    date: p.date,
    value: p.revenue,
  }));

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 className="page-title">全平台总览</h1>
          <p className="page-subtitle" style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginTop: 4 }}>
            平台级统计：用户 / 实例 / 节点 / 收入 / 磁盘 / 告警
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => refresh()} disabled={loading}>
          <RefreshCw size={16} /> 刷新
        </button>
      </div>

      {error && (
        <div className="error-banner" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, background: 'var(--color-bg-error, #fef2f2)', borderRadius: 6, marginBottom: 16 }}>
          <AlertCircle size={18} />
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => refresh()}>
            <RefreshCw size={14} /> 重试
          </button>
        </div>
      )}

      {/* KPI 卡片 */}
      {overviewError ? (
        <div
          className="info-card"
          style={{
            margin: 0,
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: 12,
          }}
        >
          <AlertCircle size={18} />
          <span>KPI 数据加载失败</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void overviewQuery.refetch()}>
            <RefreshCw size={14} /> 重试
          </button>
        </div>
      ) : overview ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
          <KpiCard
            label="总用户数"
            value={overview.total_users}
            to="/admin/users"
            hint="点击查看用户列表"
          />
          <KpiCard
            label="24h 活跃用户"
            value={overview.active_users_24h}
            tone="success"
            to="/admin/users"
            hint="点击查看用户列表"
          />
          <KpiCard
            label="实例数"
            value={`${overview.running_instances} / ${overview.total_instances}`}
            to="/instances"
            hint="运行 / 总（点击查看实例列表）"
          />
          <KpiCard
            label="节点数"
            value={`${overview.healthy_nodes} / ${overview.total_nodes}`}
            to="/admin/nodes"
            hint="健康 / 总（点击查看节点详情）"
          />
          <KpiCard
            label="今日收入"
            value={overview.revenue_today}
            tone="primary"
          />
          <KpiCard
            label="30 天收入"
            value={overview.revenue_30d}
            tone="primary"
          />
        </div>
      ) : null}

      {/* v4.25.0: 用户分析卡片（从 /admin/users 迁移）——
          KPI 给出"总用户/24h活跃"快览，这里给出按状态/角色/时间窗口的细分拆解 */}
      <div className="info-card" style={{ margin: 0, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 className="card-title">用户分析</h3>
          {userStatsError && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void userStatsQuery.refetch()}>
              <RefreshCw size={12} /> 重试
            </button>
          )}
        </div>
        {userStatsError ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', fontSize: 13, color: 'var(--color-text-secondary)' }}>
            <AlertCircle size={14} />
            <span>用户分析加载失败</span>
          </div>
        ) : userStats ? (
          <>
            <div className="stats-grid">
              <span className="stats-chip stats-chip-total">
                <span className="stats-chip-label">总用户</span>
                <span className="stats-chip-value">{userStats.total}</span>
              </span>
              <span className="stats-chip stats-chip-active">
                <span className="stats-chip-label">活跃</span>
                <span className="stats-chip-value">{userStats.by_status.active}</span>
              </span>
              <span className="stats-chip stats-chip-disabled">
                <span className="stats-chip-label">禁用</span>
                <span className="stats-chip-value">{userStats.by_status.disabled}</span>
              </span>
              <span className="stats-chip stats-chip-deleted">
                <span className="stats-chip-label">已删除</span>
                <span className="stats-chip-value">{userStats.by_status.deleted}</span>
              </span>
            </div>
            <div className="stats-grid" style={{ marginTop: 8 }}>
              <span className="stats-chip stats-chip-role-admin">
                <span className="stats-chip-label">系统管理员</span>
                <span className="stats-chip-value">{userStats.by_role.server_admin}</span>
              </span>
              <span className="stats-chip stats-chip-role-instance">
                <span className="stats-chip-label">实例管理员</span>
                <span className="stats-chip-value">{userStats.by_role.instance_admin}</span>
              </span>
              <span className="stats-chip stats-chip-role-user">
                <span className="stats-chip-label">普通用户</span>
                <span className="stats-chip-value">{userStats.by_role.user}</span>
              </span>
            </div>
            <div className="stats-grid" style={{ marginTop: 8 }}>
              <span className="stats-chip stats-chip-trend">
                <span className="stats-chip-label">近 7 天注册</span>
                <span className="stats-chip-value">{userStats.registered_last_7d}</span>
              </span>
              <span className="stats-chip stats-chip-trend">
                <span className="stats-chip-label">近 30 天注册</span>
                <span className="stats-chip-value">{userStats.registered_last_30d}</span>
              </span>
              <span className="stats-chip stats-chip-trend">
                <span className="stats-chip-label">近 7 天活跃</span>
                <span className="stats-chip-value">{userStats.active_last_7d}</span>
              </span>
              <span className="stats-chip stats-chip-trend">
                <span className="stats-chip-label">近 30 天活跃</span>
                <span className="stats-chip-value">{userStats.active_last_30d}</span>
              </span>
              <span className="stats-chip stats-chip-built-in">
                <span className="stats-chip-label">系统内置</span>
                <span className="stats-chip-value">{userStats.built_in_count}</span>
              </span>
            </div>
          </>
        ) : (
          <div className="stats-grid">
            <span className="stats-chip stats-chip-muted">加载中…</span>
          </div>
        )}
      </div>

      {/* 告警条 + 实例状态分布 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 24 }}>
        {overview && overview.alerts_24h > 0 && (
          <div className="info-card" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={20} style={{ color: 'var(--color-warning, #d97706)' }} />
            <span>近 24h 告警：<strong className="mono">{overview.alerts_24h}</strong> 条</span>
          </div>
        )}
        <div className="info-card" style={{ margin: 0 }}>
          <h3 className="card-title">实例状态分布</h3>
          {overview && <StatusBar dist={overview.instance_status_distribution} />}
        </div>
      </div>

      {/* 用户活跃度曲线（可切换 24h/30d） */}
      <div className="info-card" style={{ margin: 0, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 className="card-title">用户活跃度</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            {USER_RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                className={`btn btn-sm ${userRange === r.value ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => handleRangeChange(r.value)}
                disabled={loading}
              >
                {r.label}
              </button>
            ))}
            {loading && <span className="form-hint">加载中…</span>}
          </div>
        </div>
        <LineChart data={userPoints} color="#16a34a" label="用户" />
        {usersTrendError && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', fontSize: 13, color: 'var(--color-text-secondary)' }}>
            <AlertCircle size={14} />
            <span>用户活跃度加载失败</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void usersTrendQuery.refetch()}>
              <RefreshCw size={12} /> 重试
            </button>
          </div>
        )}
      </div>

      {/* 收入曲线（30天） */}
      <div className="info-card" style={{ margin: 0, marginBottom: 24 }}>
        <h3 className="card-title">收入趋势（30 天）</h3>
        {revenueError ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', fontSize: 13, color: 'var(--color-text-secondary)' }}>
            <AlertCircle size={14} />
            <span>加载失败</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void revenueQuery.refetch()}>
              <RefreshCw size={12} /> 重试
            </button>
          </div>
        ) : (
          <LineChart data={revenuePoints} color="#2563eb" label="收入" />
        )}
      </div>

      {/* 磁盘用量 TopN 表格 */}
      <div className="info-card" style={{ margin: 0 }}>
        <h3 className="card-title">磁盘用量 Top 10</h3>
        {diskTopError ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', fontSize: 13, color: 'var(--color-text-secondary)' }}>
            <AlertCircle size={14} />
            <span>加载失败</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void diskTopQuery.refetch()}>
              <RefreshCw size={12} /> 重试
            </button>
          </div>
        ) : diskTop && diskTop.items.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>实例 ID</th>
                  <th>名称</th>
                  <th>归属者</th>
                  <th>用量 (MB)</th>
                </tr>
              </thead>
              <tbody>
                {diskTop.items.map((item) => (
                  <tr key={item.instance_id}>
                    <td className="mono" style={{ fontSize: 12 }}>{item.instance_id}</td>
                    <td className="cell-name">{item.name}</td>
                    <td>{item.owner}</td>
                    <td className="mono">{item.used_mb}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="暂无磁盘用量数据" />
        )}
      </div>
    </div>
  );
}
