// ============================================================================
// Monitor — 监控快照管理（仅 admin/system_admin 可见）
// 路径：/admin/monitor
// 顶部：服务器选择下拉
// 最新快照卡片：单独调用 getLatest
// 实时折线图：CPU/内存/tick 趋势（自定义 SVG LineChart 组件）
// 表单：时间范围（from/to，datetime-local）+ limit + 查询按钮
// 表格：timestamp / cpu_percent / memory_mb / tick_rate / player_count / json_extra
// 自动刷新：5 秒轮询开关（同时刷新快照列表与最新值）
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  MonitorSnapshotSummary,
  ListMonitorSnapshotsResponse,
  GetLatestSnapshotResponse,
  ServerSummary,
} from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import LineChart from '../../components/LineChart';
import { getEffectiveRole, isAdminRole } from '../../utils/role';

function formatExtra(extra: Record<string, unknown> | null): string {
  if (!extra) return '—';
  try {
    const s = JSON.stringify(extra);
    return s.length > 60 ? `${s.slice(0, 57)}...` : s;
  } catch {
    return '—';
  }
}

interface MonitorQuery {
  from?: string;
  to?: string;
  limit?: number;
}

export default function Monitor() {
  const { api, user } = useAuth();

  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [serverId, setServerId] = useState('');
  const [serversLoading, setServersLoading] = useState(true);

  const [snapshots, setSnapshots] = useState<MonitorSnapshotSummary[]>([]);
  const [latest, setLatest] = useState<MonitorSnapshotSummary | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState('100');
  const [autoRefresh, setAutoRefresh] = useState(false);

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

  const loadSnapshots = useCallback(
    async (id: string, query: MonitorQuery) => {
      setDataLoading(true);
      setError(null);
      try {
        const res: ListMonitorSnapshotsResponse = await api.listMonitorSnapshots(id, query);
        setSnapshots(res.snapshots);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载监控快照失败');
        setSnapshots([]);
      } finally {
        setDataLoading(false);
      }
    },
    [api],
  );

  const loadLatest = useCallback(
    async (id: string) => {
      try {
        const res: GetLatestSnapshotResponse = await api.getLatestMonitorSnapshot(id);
        setLatest(res.snapshot);
      } catch {
        // 静默失败，不打断主列表
        setLatest(null);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!serverId) {
      setSnapshots([]);
      setLatest(null);
      return;
    }
    void loadSnapshots(serverId, {});
    void loadLatest(serverId);
  }, [serverId, loadSnapshots, loadLatest]);

  // 图表数据：按时间升序，提取各指标序列（null 交给 LineChart 跳过）
  const chartData = useMemo(() => {
    const sorted = [...snapshots].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    return {
      cpu: sorted.map((s) => s.cpu_percent),
      memory: sorted.map((s) => s.memory_mb),
      tick: sorted.map((s) => s.tick_rate),
    };
  }, [snapshots]);

  const buildQuery = (): MonitorQuery => {
    const query: MonitorQuery = {};
    if (from) query.from = new Date(from).toISOString();
    if (to) query.to = new Date(to).toISOString();
    const limitNum = Number(limit);
    if (Number.isFinite(limitNum) && limitNum > 0) query.limit = limitNum;
    return query;
  };

  const handleQuery = () => {
    if (!serverId) return;
    void loadSnapshots(serverId, buildQuery());
  };

  const handleRefresh = () => {
    if (!serverId) return;
    void loadSnapshots(serverId, buildQuery());
    void loadLatest(serverId);
  };

  // 自动刷新：5 秒轮询（同时刷新快照列表与最新值）
  useEffect(() => {
    if (!autoRefresh || !serverId) return;
    const interval = setInterval(() => {
      void loadSnapshots(serverId, buildQuery());
      void loadLatest(serverId);
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, serverId, from, to, limit, loadSnapshots, loadLatest]);

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">监控快照</h2>
        <div className="page-actions">
          <label className="auto-refresh-toggle" title="每 5 秒自动刷新监控数据">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              disabled={!serverId}
            />
            <span>自动刷新（5s）</span>
          </label>
          <button
            className="btn btn-ghost"
            onClick={handleRefresh}
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

      {/* 最新快照卡片 */}
      {serverId && (
        <div className="form-card">
          <h3 className="card-title">最新快照</h3>
          {latest ? (
            <div className="form-row">
              <div>
                <strong>时间：</strong>
                {new Date(latest.timestamp).toLocaleString('zh-CN')}
              </div>
              <div>
                <strong>CPU：</strong>
                {latest.cpu_percent ?? '—'}%
              </div>
              <div>
                <strong>内存：</strong>
                {latest.memory_mb ?? '—'} MB
              </div>
              <div>
                <strong>Tick：</strong>
                {latest.tick_rate ?? '—'}
              </div>
              <div>
                <strong>玩家：</strong>
                {latest.player_count ?? '—'}
              </div>
            </div>
          ) : (
            <div className="empty-state">暂无快照</div>
          )}
        </div>
      )}

      {/* 实时趋势折线图 */}
      {serverId && (
        <div className="chart-grid">
          <LineChart
            data={chartData.cpu}
            label="CPU 使用率"
            color="#0ea5e9"
            unit="%"
            maxValue={100}
            warningThreshold={90}
          />
          <LineChart data={chartData.memory} label="内存使用" color="#22c55e" unit="MB" />
          <LineChart
            data={chartData.tick}
            label="Tick 速率"
            color="#f59e0b"
            warningThreshold={60}
          />
        </div>
      )}

      {/* 查询表单 */}
      <form
        className="form-card"
        onSubmit={(e) => {
          e.preventDefault();
          handleQuery();
        }}
      >
        <h3 className="card-title">查询条件</h3>
        <div className="form-row">
          <label className="form-field">
            <span className="form-label">起始时间</span>
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="form-field">
            <span className="form-label">结束时间</span>
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="form-field">
            <span className="form-label">条数</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={dataLoading || !serverId}>
            {dataLoading ? '查询中…' : '查询'}
          </button>
        </div>
      </form>

      {/* 快照表格 */}
      {!serverId ? (
        <div className="empty-state">请先选择服务器。</div>
      ) : dataLoading ? (
        <div className="empty-state">加载中…</div>
      ) : snapshots.length === 0 ? (
        <div className="empty-state">暂无监控快照。</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>时间</th>
                <th>CPU(%)</th>
                <th>内存(MB)</th>
                <th>Tick</th>
                <th>玩家数</th>
                <th>扩展</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td>{new Date(s.timestamp).toLocaleString('zh-CN')}</td>
                  <td>{s.cpu_percent ?? '—'}</td>
                  <td>{s.memory_mb ?? '—'}</td>
                  <td>{s.tick_rate ?? '—'}</td>
                  <td>{s.player_count ?? '—'}</td>
                  <td className="mono">{formatExtra(s.json_extra)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
