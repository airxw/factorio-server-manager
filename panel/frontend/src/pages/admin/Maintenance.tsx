// ============================================================================
// v3.6.2: Maintenance — 运维清理聚合页（仅 server_admin 可见）
// 路径：/admin/maintenance
//
// 展示四张表（audit_logs / user_notifications / item_sync_log / chat_logs）的：
//   - 行数
//   - retention_days（仅前 3 张可编辑，chat_logs 来自 Pack 配置）
//   - 上次清理时间
//   - 操作按钮：手动清理（单表）/ 修改 retention
//
// 顶部：scheduler 状态徽章 + 一键清理全部按钮
// 表格：表名 / 行数 / retention / 上次清理 / 操作
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { Trash2, RefreshCw, Edit3, AlertCircle, CheckCircle2 } from 'lucide-react';
import type {
  MaintenanceOverviewResponse,
  MaintenanceTableSummary,
  MaintenanceTableName,
  CleanupResponse,
} from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { getEffectiveRole, isAdminRole } from '../../utils/role';
import type { CleanupAllPreviewResponse } from '../../api/modules/admin';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { ListSkeleton, MobileCardList, useDestructiveAction } from '../../components/ui';

/** 表名 → 中文展示名 */
const TABLE_LABELS: Record<MaintenanceTableName, string> = {
  audit_logs: '审计日志',
  user_notifications: '用户通知',
  item_sync_log: '物品同步日志',
  chat_logs: '聊天日志',
};

/** 表名 → 是否可编辑 retention */
const RETENTION_EDITABLE: Record<MaintenanceTableName, boolean> = {
  audit_logs: true,
  user_notifications: true,
  item_sync_log: true,
  chat_logs: false,
};

export default function Maintenance() {
  const { api, user } = useAuth();

  if (!isAdminRole(getEffectiveRole(user))) return <Navigate to="/forbidden" replace />;
  const { confirm } = useConfirm();
  const toast = useToast();
  useDocumentTitle('运维清理');

  const [overview, setOverview] = useState<MaintenanceOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cleaningTable, setCleaningTable] = useState<MaintenanceTableName | 'all' | null>(null);
  const [cleaningAll, setCleaningAll] = useState(false);

  // B2: 破坏性操作统一 hook —— 一键清理全部日志表（含 dry-run 预览）
  const cleanupAllAction = useDestructiveAction<CleanupAllPreviewResponse, void>({
    preview: async () => api.previewCleanupAll(),
    execute: async () => {
      await api.triggerCleanup({});
    },
  });
  // 编辑 retention 的表名 + 输入值
  const [editingTable, setEditingTable] = useState<MaintenanceTableName | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [savingRetention, setSavingRetention] = useState(false);
  // 上次清理结果（用于 Toast 展示）
  const [lastCleanupResult, setLastCleanupResult] = useState<CleanupResponse | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMaintenanceOverview();
      setOverview(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载运维清理概览失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** 手动清理单表 */
  const handleCleanupTable = async (tableName: MaintenanceTableName) => {
    const label = TABLE_LABELS[tableName];
    const ok = await confirm({
      title: `清理 ${label}`,
      message: `将立即删除 ${label} 表中超过 retention_days 的记录。此操作不可撤销，是否继续？`,
      confirmText: '清理',
      danger: true,
    });
    if (!ok) return;

    setCleaningTable(tableName);
    try {
      const res = await api.triggerCleanup({ table_name: tableName });
      const entry = res.results.find((r) => r.table_name === tableName);
      const deleted = entry?.deleted_rows ?? 0;
      toast.success(`${label}清理完成，删除 ${deleted} 行`);
      setLastCleanupResult(res);
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `清理 ${label} 失败`);
    } finally {
      setCleaningTable(null);
    }
  };

  /** 一键清理全部表 —— 走 useDestructiveAction preview → confirm → execute 流程 */
  const handleCleanupAll = async () => {
    setCleaningAll(true);
    try {
      const ok = await cleanupAllAction.run(undefined, {
        title: '一键清理全部日志表',
        message:
          '将立即清理 audit_logs / user_notifications / item_sync_log / chat_logs 四张表中超过 retention_days 的记录。此操作不可撤销。',
        confirmText: '清理全部',
        formatPreview: (preview) => {
          const p = preview as CleanupAllPreviewResponse;
          const lines: string[] = ['将清理以下表（仅超 retention 记录）：'];
          for (const t of p.tables) {
            lines.push(`  - ${TABLE_LABELS[t.name] ?? t.name}：${t.rows} 行`);
          }
          lines.push(`合计行数：${p.total_rows}`);
          if (p.total_size_bytes !== null) {
            lines.push(`DB 文件总大小：${(p.total_size_bytes / 1024 / 1024).toFixed(2)} MB`);
          }
          return lines.join('\n');
        },
      });
      if (ok) {
        // 触发后再次拉取真实清理结果（triggerCleanup 在 execute 内部已执行）
        try {
          // execute 不返回 results，需要单独再拉一次以展示明细——为简化体验，仅刷新 overview
          void refresh();
          toast.success('一键清理已执行');
        } catch (err) {
          toast.error(err instanceof Error ? err.message : '刷新失败');
        }
      }
    } finally {
      setCleaningAll(false);
    }
  };

  /** 进入 retention 编辑模式 */
  const startEditRetention = (table: MaintenanceTableSummary) => {
    setEditingTable(table.table_name);
    setEditingValue(String(table.retention_days));
  };

  /** 保存 retention 修改 */
  const handleSaveRetention = async () => {
    if (!editingTable) return;
    const tableName = editingTable;
    const days = parseInt(editingValue, 10);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      toast.error('retention_days 必须为 1-365 之间的整数');
      return;
    }

    setSavingRetention(true);
    try {
      await api.updateRetention({ table_name: tableName, retention_days: days });
      toast.success(`${TABLE_LABELS[tableName]} retention 已更新为 ${days} 天`);
      setEditingTable(null);
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `修改 ${TABLE_LABELS[tableName]} retention 失败`);
    } finally {
      setSavingRetention(false);
    }
  };

  /** 取消 retention 编辑 */
  const cancelEditRetention = () => {
    setEditingTable(null);
    setEditingValue('');
  };

  /** 格式化上次清理时间 */
  const formatLastCleanup = (lastCleanupAt: string | null): string => {
    if (!lastCleanupAt) return '从未清理';
    try {
      return new Date(lastCleanupAt).toLocaleString('zh-CN');
    } catch {
      return lastCleanupAt;
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <h1 className="page-title">运维清理</h1>
        <ListSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <h1 className="page-title">运维清理</h1>
        <div className="error-banner">
          <AlertCircle size={18} />
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refresh()}>
            <RefreshCw size={14} /> 重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 className="page-title">运维清理</h1>
          <p className="page-subtitle" style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginTop: 4 }}>
            管理审计日志、用户通知、物品同步日志、聊天日志的 retention 与手动清理
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw size={16} /> 刷新
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void handleCleanupAll()}
            disabled={cleaningAll || cleaningTable !== null}
          >
            <Trash2 size={16} />
            {cleaningAll ? '清理中…' : '一键清理全部'}
          </button>
        </div>
      </div>

      {/* scheduler 状态徽章 */}
      {overview && (
        <div className="scheduler-status" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
          {overview.scheduler_enabled ? (
            <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <CheckCircle2 size={14} /> 定时清理已启用（每 24h 自动执行）
            </span>
          ) : (
            <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <AlertCircle size={14} /> 定时清理未启用
            </span>
          )}
        </div>
      )}

      {/* 四张表概览 */}
      {overview && (
        <>
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>表名</th>
              <th>行数</th>
              <th>retention（天）</th>
              <th>上次清理时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {overview.tables.map((table) => {
              const isCleaning = cleaningTable === table.table_name;
              const isEditing = editingTable === table.table_name;
              const isEditable = RETENTION_EDITABLE[table.table_name];
              return (
                <tr key={table.table_name}>
                  <td>
                    <strong>{TABLE_LABELS[table.table_name]}</strong>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                      {table.table_name}
                    </div>
                  </td>
                  <td className="mono" style={{ fontWeight: table.row_count > 10000 ? 'bold' : undefined }}>
                    {table.row_count.toLocaleString('zh-CN')}
                  </td>
                  <td>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input
                          type="number"
                          min={1}
                          max={365}
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          style={{ width: 80 }}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => void handleSaveRetention()}
                          disabled={savingRetention}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={cancelEditRetention}
                          disabled={savingRetention}
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span className="mono">{table.retention_days}</span>
                        {isEditable && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => startEditRetention(table)}
                            aria-label="修改 retention"
                            title="修改 retention"
                          >
                            <Edit3 size={12} />
                          </button>
                        )}
                        {!isEditable && (
                          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                            （来自 Pack 配置）
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {formatLastCleanup(table.last_cleanup_at)}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void handleCleanupTable(table.table_name)}
                      disabled={isCleaning || cleaningAll}
                    >
                      <Trash2 size={14} />
                      {isCleaning ? '清理中…' : '清理'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* 移动端卡片降级（B1.2 批次） */}
        <MobileCardList
          items={overview.tables}
          keyExtractor={(t) => t.table_name}
          emptyText="暂无运维清理表"
          renderHeader={(t) => (
            <>
              <span className="mc-item-title">{TABLE_LABELS[t.table_name]}</span>
              <span className="mc-item-badge">
                <span className="badge mono">{t.table_name}</span>
              </span>
            </>
          )}
          renderBody={(t) => {
            const isEditing = editingTable === t.table_name;
            const isEditable = RETENTION_EDITABLE[t.table_name];
            return (
              <>
                <div className="mc-row">
                  <span className="mc-label">行数</span>
                  <span
                    className="mc-value mono"
                    style={t.row_count > 10000 ? { fontWeight: 'bold', color: 'var(--color-danger)' } : undefined}
                  >
                    {t.row_count.toLocaleString('zh-CN')}
                  </span>
                </div>
                <div className="mc-row">
                  <span className="mc-label">retention（天）</span>
                  <span className="mc-value">
                    {isEditing ? (
                      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <input
                          type="number"
                          min={1}
                          max={365}
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          style={{ width: 72 }}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => void handleSaveRetention()}
                          disabled={savingRetention}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={cancelEditRetention}
                          disabled={savingRetention}
                        >
                          取消
                        </button>
                      </span>
                    ) : (
                      <span className="mono">
                        {t.retention_days}
                        {!isEditable && (
                          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginLeft: 6 }}>
                            （来自 Pack 配置）
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                </div>
                <div className="mc-row">
                  <span className="mc-label">上次清理</span>
                  <span className="mc-value">{formatLastCleanup(t.last_cleanup_at)}</span>
                </div>
              </>
            );
          }}
          renderActions={(t) => {
            const isCleaning = cleaningTable === t.table_name;
            const isEditing = editingTable === t.table_name;
            const isEditable = RETENTION_EDITABLE[t.table_name];
            return (
              <>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => void handleCleanupTable(t.table_name)}
                  disabled={isCleaning || cleaningAll}
                >
                  <Trash2 size={14} />
                  {isCleaning ? '清理中…' : '清理'}
                </button>
                {isEditable && !isEditing && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => startEditRetention(t)}
                  >
                    <Edit3 size={12} />
                    修改 retention
                  </button>
                )}
              </>
            );
          }}
        />
        </>
      )}

      {/* 上次清理结果详情 */}
      {lastCleanupResult && (
        <div className="cleanup-result" style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>最近一次清理结果</h3>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>表名</th>
                <th>删除行数</th>
              </tr>
            </thead>
            <tbody>
              {lastCleanupResult.results.map((r) => (
                <tr key={r.table_name}>
                  <td>{TABLE_LABELS[r.table_name]}</td>
                  <td className="mono">{r.deleted_rows.toLocaleString('zh-CN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 说明区 */}
      <div className="info-block" style={{ marginTop: 24, padding: 12, background: 'var(--color-bg-secondary)', borderRadius: 6, fontSize: 13 }}>
        <h4 style={{ marginBottom: 8 }}>说明</h4>
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
          <li>
            <strong>retention_days</strong>：超过该天数的记录会被自动清理。仅 audit_logs /
            user_notifications / item_sync_log 支持在线修改（范围 1-365）。
          </li>
          <li>
            <strong>chat_logs</strong> 的 retention 来自各 Pack 的 chat_log 配置，此处展示占位值 7
            天，需在 Pack 配置中调整。
          </li>
          <li>
            <strong>定时清理</strong>：后端 scheduler 每 24 小时自动执行一次清理（启动后 20s/25s/30s
            首次运行），无需人工干预。
          </li>
          <li>
            <strong>手动清理</strong>：立即触发一次清理，不影响定时任务调度。
          </li>
        </ul>
      </div>
    </div>
  );
}
