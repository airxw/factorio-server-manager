// ============================================================================
// AuditLogs — 审计日志管理（仅 admin/system_admin 可见）
// 路径：/admin/audit-logs
// 顶部：过滤条件表单（server_id 下拉、user_id 输入、action 输入、target_type 输入、
//       from/to datetime-local、limit、keyword 关键词搜索）+ 查询按钮 + 导出 CSV
// 表格：created_at / server_id / user_id / action / target_type / target_id /
//       ip_address / details（点击行打开详情弹窗，展示完整 JSON + before/after 对比）
// 第十一章 11.3：新增 CSV 导出、详情弹窗（before/after 对比）、关键词搜索、URL 同步
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Download, Eye } from 'lucide-react';
import type {
  AuditLogSummary,
  ListAuditLogsResponse,
  ListAuditLogsQuery,
  ServerSummary,
} from '@public/schema/panel-api-types';
import { useAuth } from '../../api/auth';
import VirtualTable, { type VirtualColumn } from '../../components/VirtualTable';
import { Modal, useToast } from '../../components/ui';
import { getEffectiveRole, isAdminRole } from '../../utils/role';

function formatDetails(details: Record<string, unknown> | null): string {
  if (!details) return '—';
  try {
    const s = JSON.stringify(details);
    return s.length > 60 ? `${s.slice(0, 57)}...` : s;
  } catch {
    return '—';
  }
}

/** 第十一章 11.3: 将审计日志导出为 CSV 并触发下载 */
function exportAuditLogsCsv(logs: AuditLogSummary[]): void {
  const headers = [
    'ID',
    '时间',
    '服务器ID',
    '用户ID',
    '动作',
    '目标类型',
    '目标ID',
    'IP地址',
    '详情',
  ];
  const escapeCsv = (val: unknown): string => {
    const s = val === null || val === undefined ? '' : String(val);
    // 含逗号/引号/换行的字段用双引号包裹，内部引号转义
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const rows = logs.map((log) =>
    [
      log.id,
      log.created_at,
      log.server_id ?? '',
      log.user_id ?? '',
      log.action,
      log.target_type ?? '',
      log.target_id ?? '',
      log.ip_address ?? '',
      log.details ? JSON.stringify(log.details) : '',
    ]
      .map(escapeCsv)
      .join(','),
  );
  const csv = [headers.join(','), ...rows].join('\r\n');
  // 添加 BOM 头确保 Excel 正确识别 UTF-8 编码
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** 从 details 中提取 before/after 对比数据（若存在） */
function extractBeforeAfter(details: Record<string, unknown> | null): {
  before: unknown;
  after: unknown;
} | null {
  if (!details) return null;
  // 常见字段名：before/after、old/new、previous/current
  const beforeKeys = ['before', 'old', 'previous', 'old_value'];
  const afterKeys = ['after', 'new', 'current', 'new_value'];
  for (const bk of beforeKeys) {
    if (bk in details) {
      for (const ak of afterKeys) {
        if (ak in details) {
          return { before: details[bk], after: details[ak] };
        }
      }
      return { before: details[bk], after: undefined };
    }
  }
  return null;
}

export default function AuditLogs() {
  const { api, user } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [serversLoading, setServersLoading] = useState(true);

  const [logs, setLogs] = useState<AuditLogSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 过滤条件——11.3: 从 URL 初始化，便于分享/书签
  const [serverId, setServerId] = useState(() => searchParams.get('server_id') ?? '');
  const [userId, setUserId] = useState(() => searchParams.get('user_id') ?? '');
  const [action, setAction] = useState(() => searchParams.get('action') ?? '');
  const [targetType, setTargetType] = useState(() => searchParams.get('target_type') ?? '');
  const [from, setFrom] = useState(() => searchParams.get('from') ?? '');
  const [to, setTo] = useState(() => searchParams.get('to') ?? '');
  const [limit, setLimit] = useState(() => searchParams.get('limit') ?? '100');
  // 11.3: 关键词搜索（本地过滤 details）
  const [keyword, setKeyword] = useState(() => searchParams.get('q') ?? '');

  // 11.3: 详情弹窗
  const [detailLog, setDetailLog] = useState<AuditLogSummary | null>(null);

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // 加载服务器列表（用于 server_id 下拉过滤）
  useEffect(() => {
    let cancelled = false;
    setServersLoading(true);
    api
      .listServers()
      .then((res) => {
        if (cancelled) return;
        setServers(res.servers);
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

  const loadLogs = useCallback(
    async (query: ListAuditLogsQuery) => {
      setLoading(true);
      setError(null);
      try {
        const res: ListAuditLogsResponse = await api.listAuditLogs(query);
        setLogs(res.logs);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载审计日志失败');
        setLogs([]);
      } finally {
        setLoading(false);
      }
    },
    [api],
  );

  // 首次加载
  useEffect(() => {
    void loadLogs({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadLogs]);

  const buildQuery = useCallback((): ListAuditLogsQuery => {
    const q: ListAuditLogsQuery = {};
    if (serverId) q.server_id = serverId;
    if (userId) q.user_id = userId;
    if (action) q.action = action;
    if (targetType) q.target_type = targetType;
    if (from) q.from = new Date(from).toISOString();
    if (to) q.to = new Date(to).toISOString();
    const limitNum = Number(limit);
    if (Number.isFinite(limitNum) && limitNum > 0) q.limit = limitNum;
    return q;
  }, [serverId, userId, action, targetType, from, to, limit]);

  // 11.3: 同步过滤条件到 URL
  const syncUrl = useCallback(() => {
    const params: Record<string, string> = {};
    if (serverId) params.server_id = serverId;
    if (userId) params.user_id = userId;
    if (action) params.action = action;
    if (targetType) params.target_type = targetType;
    if (from) params.from = from;
    if (to) params.to = to;
    if (limit && limit !== '100') params.limit = limit;
    if (keyword) params.q = keyword;
    setSearchParams(params, { replace: true });
  }, [serverId, userId, action, targetType, from, to, limit, keyword, setSearchParams]);

  const handleQuery = () => {
    syncUrl();
    void loadLogs(buildQuery());
  };

  const handleRefresh = () => {
    void loadLogs(buildQuery());
  };

  // 11.3: 导出 CSV
  const handleExportCsv = () => {
    if (filteredLogs.length === 0) {
      toast.info('暂无可导出的日志');
      return;
    }
    try {
      exportAuditLogsCsv(filteredLogs);
      toast.success(`已导出 ${filteredLogs.length} 条日志`);
    } catch (err) {
      toast.error('导出 CSV 失败', err instanceof Error ? err.message : undefined);
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // 11.3: 关键词本地过滤——对 details JSON 做包含匹配
  const filteredLogs = useMemo(() => {
    if (!keyword.trim()) return logs;
    const kw = keyword.trim().toLowerCase();
    return logs.filter((log) => {
      const haystack = [
        log.action,
        log.target_type ?? '',
        log.target_id ?? '',
        log.user_id ?? '',
        log.ip_address ?? '',
        log.details ? JSON.stringify(log.details) : '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(kw);
    });
  }, [logs, keyword]);

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  // 详情弹窗的 before/after 对比
  const detailBeforeAfter = detailLog ? extractBeforeAfter(detailLog.details) : null;

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">审计日志</h2>
        <div className="page-actions">
          {/* 11.3: 导出 CSV */}
          <button
            className="btn btn-ghost"
            onClick={handleExportCsv}
            disabled={loading || filteredLogs.length === 0}
            title="导出当前结果为 CSV"
          >
            <Download size={14} />
            导出 CSV
          </button>
          <button className="btn btn-ghost" onClick={handleRefresh} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {/* 查询表单 */}
      <form
        className="form-card"
        onSubmit={(e) => {
          e.preventDefault();
          handleQuery();
        }}
      >
        <h3 className="card-title">过滤条件</h3>
        <div className="form-row">
          <label className="form-field">
            <span className="form-label">服务器</span>
            <select
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              disabled={serversLoading}
            >
              <option value="">全部</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.id})
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span className="form-label">用户 ID</span>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="按 user_id 精确匹配"
            />
          </label>
          <label className="form-field">
            <span className="form-label">动作</span>
            <input
              type="text"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="如 server.start"
            />
          </label>
        </div>
        <div className="form-row">
          <label className="form-field">
            <span className="form-label">目标类型</span>
            <input
              type="text"
              value={targetType}
              onChange={(e) => setTargetType(e.target.value)}
              placeholder="如 server / user"
            />
          </label>
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
        {/* 11.3: 关键词搜索（本地过滤 details） */}
        <div className="form-row">
          <label className="form-field">
            <span className="form-label">关键词搜索（本地过滤）</span>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="在动作/目标/详情中搜索关键词"
            />
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? '查询中…' : '查询'}
          </button>
        </div>
      </form>

      {error && <div className="alert alert-error">{error}</div>}

      {/* 三.2: 审计日志虚拟化表格（千行级数据滚动保持 60fps） */}
      {loading ? (
        <div className="empty-state">加载中…</div>
      ) : filteredLogs.length === 0 ? (
        <div className="empty-state">{keyword ? '没有匹配关键词的日志。' : '暂无审计日志。'}</div>
      ) : (
        <>
        <div className="desktop-only">
        {(() => {
          const columns: VirtualColumn<AuditLogSummary>[] = [
            { key: 'id', header: 'ID', width: '70px', render: (log) => log.id },
            {
              key: 'time',
              header: '时间',
              width: '180px',
              render: (log) => new Date(log.created_at).toLocaleString('zh-CN'),
            },
            {
              key: 'server',
              header: '服务器',
              width: '120px',
              render: (log) => log.server_id ?? '—',
            },
            {
              key: 'user',
              header: '用户',
              width: '120px',
              render: (log) => log.user_id ?? '—',
            },
            {
              key: 'action',
              header: '动作',
              width: '160px',
              className: 'mono',
              render: (log) => log.action,
            },
            {
              key: 'ttype',
              header: '目标类型',
              width: '120px',
              render: (log) => log.target_type ?? '—',
            },
            {
              key: 'tid',
              header: '目标 ID',
              width: '120px',
              render: (log) => log.target_id ?? '—',
            },
            {
              key: 'ip',
              header: 'IP',
              width: '130px',
              render: (log) => log.ip_address ?? '—',
            },
            {
              key: 'details',
              header: '详情',
              width: '2fr',
              render: (log) => {
                const expanded = expandedIds.has(log.id);
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {/* 11.3: 点击查看详情弹窗 */}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setDetailLog(log)}
                      title="查看详情"
                    >
                      <Eye size={12} />
                      详情
                    </button>
                    {log.details && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => toggleExpand(log.id)}
                      >
                        {expanded ? '收起' : '展开'}
                      </button>
                    )}
                    {expanded && log.details ? (
                      <pre className="mono" style={{ margin: 0 }}>
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    ) : (
                      <span className="mono">{formatDetails(log.details)}</span>
                    )}
                  </div>
                );
              },
            },
          ];
          return (
            <VirtualTable<AuditLogSummary>
              columns={columns}
              rows={filteredLogs}
              rowKey={(log) => log.id}
              estimateRowHeight={44}
              maxHeight={640}
            />
          );
        })()}
        </div>

        {/* 移动端卡片列表 */}
        <div className="mobile-card-list mobile-only">
          {filteredLogs.map((log) => (
            <div key={log.id} className="mc-item">
              <div className="mc-item-header">
                <span className="mc-item-title mono">{log.action}</span>
                <span className="mc-item-badge">
                  <span className="badge">{log.target_type ?? '—'}</span>
                </span>
              </div>
              <div className="mc-row">
                <span className="mc-label">时间</span>
                <span className="mc-value">{new Date(log.created_at).toLocaleString('zh-CN')}</span>
              </div>
              <div className="mc-row">
                <span className="mc-label">操作者</span>
                <span className="mc-value mono">{log.user_id ?? '—'}</span>
              </div>
              <div className="mc-row">
                <span className="mc-label">目标</span>
                <span className="mc-value mono">
                  {log.target_type ?? '—'}
                  {log.target_id ? ` #${log.target_id}` : ''}
                </span>
              </div>
              <div className="mc-row">
                <span className="mc-label">IP 地址</span>
                <span className="mc-value mono">{log.ip_address ?? '—'}</span>
              </div>
              <div className="mc-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setDetailLog(log)}
                  title="查看详情"
                >
                  <Eye size={12} />
                  详情
                </button>
              </div>
            </div>
          ))}
        </div>
        </>
      )}

      {/* 11.3: 审计日志详情弹窗——展示完整字段 + before/after 对比 */}
      <Modal
        open={detailLog !== null}
        title={`审计日志详情 #${detailLog?.id ?? ''}`}
        onClose={() => setDetailLog(null)}
        footer={
          <button type="button" className="btn btn-ghost" onClick={() => setDetailLog(null)}>
            关闭
          </button>
        }
      >
        {detailLog && (
          <div>
            <div className="form-row">
              <label className="form-field">
                <span className="form-label">时间</span>
                <div className="mono">{new Date(detailLog.created_at).toLocaleString('zh-CN')}</div>
              </label>
              <label className="form-field">
                <span className="form-label">动作</span>
                <div className="mono">{detailLog.action}</div>
              </label>
              <label className="form-field">
                <span className="form-label">服务器</span>
                <div className="mono">{detailLog.server_id ?? '—'}</div>
              </label>
            </div>
            <div className="form-row">
              <label className="form-field">
                <span className="form-label">用户 ID</span>
                <div className="mono">{detailLog.user_id ?? '—'}</div>
              </label>
              <label className="form-field">
                <span className="form-label">目标类型</span>
                <div className="mono">{detailLog.target_type ?? '—'}</div>
              </label>
              <label className="form-field">
                <span className="form-label">目标 ID</span>
                <div className="mono">{detailLog.target_id ?? '—'}</div>
              </label>
              <label className="form-field">
                <span className="form-label">IP 地址</span>
                <div className="mono">{detailLog.ip_address ?? '—'}</div>
              </label>
            </div>

            {/* before/after 数据对比（若 details 中存在） */}
            {detailBeforeAfter && (
              <div className="form-row" style={{ marginTop: 12 }}>
                <label className="form-field">
                  <span className="form-label">变更前</span>
                  <pre
                    className="mono"
                    style={{
                      background: '#fef2f2',
                      padding: 8,
                      borderRadius: 4,
                      maxHeight: 200,
                      overflow: 'auto',
                    }}
                  >
                    {JSON.stringify(detailBeforeAfter.before, null, 2)}
                  </pre>
                </label>
                <label className="form-field">
                  <span className="form-label">变更后</span>
                  <pre
                    className="mono"
                    style={{
                      background: '#f0fdf4',
                      padding: 8,
                      borderRadius: 4,
                      maxHeight: 200,
                      overflow: 'auto',
                    }}
                  >
                    {JSON.stringify(detailBeforeAfter.after, null, 2)}
                  </pre>
                </label>
              </div>
            )}

            {/* 完整 details JSON */}
            <label className="form-field" style={{ marginTop: 12 }}>
              <span className="form-label">完整详情（JSON）</span>
              <pre
                className="mono"
                style={{
                  background: '#f9fafb',
                  padding: 8,
                  borderRadius: 4,
                  maxHeight: 300,
                  overflow: 'auto',
                  fontSize: 12,
                }}
              >
                {detailLog.details ? JSON.stringify(detailLog.details, null, 2) : '无'}
              </pre>
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
