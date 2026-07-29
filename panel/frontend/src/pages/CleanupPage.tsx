// ============================================================================
// v3.4.0: CleanupPage — 实例清理面板（仅 server_admin 可见）
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type { CleanupInstanceSummary } from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../api/auth';
import { getEffectiveRole, isAdminRole } from '../utils/role';
import type { CleanupInstancePreviewResponse } from '../api/modules/servers';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { MobileCardList, useDestructiveAction, useToast } from '../components/ui';

export default function CleanupPage() {
  const { api, user } = useAuth();

  if (!isAdminRole(getEffectiveRole(user))) return <Navigate to="/forbidden" replace />;
  const toast = useToast();
  useDocumentTitle('实例清理');

  const [instances, setInstances] = useState<CleanupInstanceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);

  // B2: 破坏性操作统一 hook —— 实例删除（含 dry-run 预览）
  const deleteAction = useDestructiveAction<CleanupInstancePreviewResponse, string>({
    preview: async (id) => api.previewCleanupInstance(id),
    execute: async (id) => {
      await api.confirmCleanupDelete(id);
    },
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listCleanupInstances();
      setInstances(res.instances);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载清理列表失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** 删除实例 —— 走 useDestructiveAction preview → confirm → execute 流程 */
  const handleDelete = async (id: string) => {
    setActioning(id);
    try {
      const ok = await deleteAction.run(id, {
        title: `删除实例：${id}`,
        message: '此操作将永久删除实例目录、DB 记录与关联 chat_logs，不可恢复。',
        confirmText: '确认删除',
        requireText: true,
        requireTextMatch: id,
        formatPreview: (preview) => {
          const p = preview as CleanupInstancePreviewResponse;
          const lines: string[] = [];
          lines.push(`实例根目录：${p.instance_root}`);
          if (p.size_bytes !== null) {
            lines.push(`目录大小：${(p.size_bytes / 1024 / 1024).toFixed(2)} MB`);
          }
          if (p.file_count !== null) {
            lines.push(`文件数：${p.file_count}`);
          }
          if (!p.preview_success) {
            lines.push(`⚠️ 预览失败：${p.preview_error ?? '未知错误'}`);
            lines.push('（仍可继续删除，但磁盘清理可能不会执行）');
          }
          return lines.join('\n');
        },
      });
      if (ok) {
        toast.success('实例已删除');
        void refresh();
      }
    } finally {
      setActioning(null);
    }
  };

  const handleIgnore = async (id: string) => {
    setActioning(id);
    try {
      await api.ignoreCleanup(id);
      toast.success('已忽略');
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setActioning(null);
    }
  };

  const markedForDeletion = instances.filter((i) => i.marked_for_deletion);
  const allInstances = instances;

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">实例清理</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* 待删除实例 */}
      <div className="info-card" style={{ marginBottom: 16 }}>
        <h3 className="card-title">
          待清理实例
          {markedForDeletion.length > 0 && (
            <span className="badge badge-error" style={{ marginLeft: 8 }}>
              {markedForDeletion.length}
            </span>
          )}
        </h3>
        {loading ? (
          <div className="empty-state">加载中…</div>
        ) : markedForDeletion.length === 0 ? (
          <div className="empty-state">暂无待清理实例</div>
        ) : (
          <>
          <div className="desktop-only">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>实例名</th>
                  <th>Pack</th>
                  <th>游戏</th>
                  <th>当前版本</th>
                  <th>归属者</th>
                  <th>闲置天数</th>
                  <th>更新版本数</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {markedForDeletion.map((inst) => (
                  <tr key={inst.id}>
                    <td>{inst.name}</td>
                    <td>{inst.pack_id}</td>
                    <td>{inst.game_type}</td>
                    <td className="mono">{inst.current_version ?? '未知'}</td>
                    <td>{inst.owner_username}</td>
                    <td>{inst.idle_days} 天</td>
                    <td>{inst.newer_versions_count}</td>
                    <td>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => void handleDelete(inst.id)}
                        disabled={actioning === inst.id || inst.status !== 'stopped'}
                      >
                        确认删除
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => void handleIgnore(inst.id)}
                        disabled={actioning === inst.id}
                        style={{ marginLeft: 4 }}
                      >
                        忽略
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>

          {/* 移动端卡片列表（B1.3：复用 MobileCardList 共享组件） */}
          <MobileCardList
            items={markedForDeletion}
            keyExtractor={(inst) => inst.id}
            emptyText="暂无待清理实例"
            renderHeader={(inst) => (
              <span className="mc-item-title">{inst.name}</span>
            )}
            renderBody={(inst) => (
              <>
                <div className="mc-row">
                  <span className="mc-label">Pack / 游戏</span>
                  <span className="mc-value">
                    {inst.pack_id} / {inst.game_type}
                  </span>
                </div>
                <div className="mc-row">
                  <span className="mc-label">归属者</span>
                  <span className="mc-value">{inst.owner_username}</span>
                </div>
                <div className="mc-row">
                  <span className="mc-label">闲置天数</span>
                  <span className="mc-value">{inst.idle_days} 天</span>
                </div>
              </>
            )}
            renderActions={(inst) => (
              <>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => void handleDelete(inst.id)}
                  disabled={actioning === inst.id || inst.status !== 'stopped'}
                >
                  确认删除
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => void handleIgnore(inst.id)}
                  disabled={actioning === inst.id}
                  style={{ marginLeft: 4 }}
                >
                  忽略
                </button>
              </>
            )}
          />
          </>
        )}
      </div>

      {/* 全部实例概览 */}
      <div className="info-card">
        <h3 className="card-title">全部实例概览</h3>
        {loading ? (
          <div className="empty-state">加载中…</div>
        ) : allInstances.length === 0 ? (
          <div className="empty-state">暂无实例</div>
        ) : (
          <>
          <div className="desktop-only">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>实例名</th>
                  <th>状态</th>
                  <th>归属者</th>
                  <th>闲置天数</th>
                  <th>更新版本数</th>
                  <th>标记</th>
                </tr>
              </thead>
              <tbody>
                {allInstances.map((inst) => (
                  <tr key={inst.id}>
                    <td>{inst.name}</td>
                    <td>
                      <span className={`badge badge-${inst.status}`}>{inst.status}</span>
                    </td>
                    <td>{inst.owner_username}</td>
                    <td>{inst.idle_days} 天</td>
                    <td>{inst.newer_versions_count}</td>
                    <td>
                      {inst.marked_for_deletion ? (
                        <span className="badge badge-error">待清理</span>
                      ) : (
                        <span className="badge badge-stopped">正常</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>

          {/* 移动端卡片列表（B1.3：复用 MobileCardList 共享组件） */}
          <MobileCardList
            items={allInstances}
            keyExtractor={(inst) => inst.id}
            emptyText="暂无实例"
            renderHeader={(inst) => (
              <>
                <span className="mc-item-title">{inst.name}</span>
                <span className="mc-item-badge">
                  <span className={`badge badge-${inst.status}`}>{inst.status}</span>
                </span>
              </>
            )}
            renderBody={(inst) => (
              <>
                <div className="mc-row">
                  <span className="mc-label">归属者</span>
                  <span className="mc-value">{inst.owner_username}</span>
                </div>
                <div className="mc-row">
                  <span className="mc-label">闲置天数</span>
                  <span className="mc-value">{inst.idle_days} 天</span>
                </div>
                <div className="mc-row">
                  <span className="mc-label">标记</span>
                  <span className="mc-value">
                    {inst.marked_for_deletion ? (
                      <span className="badge badge-error">待清理</span>
                    ) : (
                      <span className="badge badge-stopped">正常</span>
                    )}
                  </span>
                </div>
              </>
            )}
          />
          </>
        )}
      </div>
    </div>
  );
}
