// ============================================================================
// UpdateCheck — v3.5.0: 游戏更新（实例侧版本选择器）
//
// 设计：「下载」归版本管理（/store/versions），「应用」归实例（此处）。
//   实例侧不再跑 curl、不再让用户手填路径——从 Pack 池中选版本 → 一键应用/回滚。
//
// 功能：
//   1. 检查更新：调用 api.checkUpdate(serverId) 比对当前版本与最新版本
//   2. 版本池展示：调用 api.listVersions(packId) 展示已下载版本列表
//   3. 应用/回滚：调用 api.applyUpdate({ version_id }) 应用选中的池版本
//   4. 进度条展示：复用 UpdateProgressResponse 机制
//
// 契约：public/schema/panel-api-types.ts
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CheckUpdateResponse,
  GameVersionSummary,
  UpdateProgressResponse,
  UpdatePhase,
} from '@public/schema/panel-api-types';
import { useAuth } from '../../api/auth';

export interface UpdateCheckPageProps {
  serverId: string;
}

const PHASE_LABELS: Record<UpdatePhase, string> = {
  idle: '未开始',
  checking: '检查更新',
  downloading: '下载中',
  installing: '安装中',
  completed: '已完成',
  failed: '失败',
};

const PROGRESS_POLL_INTERVAL = 2000;

// ----- 版本语义比较工具 -----
function parseVersion(v: string): { major: number; minor: number; patch: number } {
  const parts = v.split('.').map((s) => parseInt(s, 10));
  return {
    major: Number.isFinite(parts[0]) ? parts[0] : 0,
    minor: Number.isFinite(parts[1]) ? parts[1] : 0,
    patch: Number.isFinite(parts[2]) ? parts[2] : 0,
  };
}

function compareVersion(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  return pa.patch - pb.patch;
}

export default function UpdateCheck({ serverId }: UpdateCheckPageProps) {
  const { api } = useAuth();

  // 检查更新
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckUpdateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 版本池
  const [versions, setVersions] = useState<GameVersionSummary[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [instanceStatus, setInstanceStatus] = useState<string>('stopped');

  // 应用进度
  const [progress, setProgress] = useState<UpdateProgressResponse | null>(null);
  const [confirming, setConfirming] = useState<GameVersionSummary | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isUpdating = progress
    ? progress.phase === 'checking' || progress.phase === 'downloading' || progress.phase === 'installing'
    : false;
  const busy = checking || isUpdating;
  const isRunning = instanceStatus === 'running';

  // ----- 生命周期 -----

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await api.getUpdateProgress(serverId);
        setProgress(res);
        if (res.phase === 'completed' || res.phase === 'failed') {
          stopPolling();
          if (res.phase === 'completed') {
            setSuccess(`版本 ${res.latest_version ?? ''} 应用成功`);
            // 刷新检查结果和版本状态
            void handleCheck();
            void loadServerInfo();
          } else {
            setError(res.error ?? '应用失败');
          }
        }
      } catch {
        // 轮询失败静默
      }
    }, PROGRESS_POLL_INTERVAL);
  }, [api, serverId, stopPolling]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  useEffect(() => {
    void handleCheck();
    void loadServerInfo();
  }, []);

  // ----- 检查更新 -----
  const handleCheck = async () => {
    setSuccess(null);
    setChecking(true);
    try {
      const res = await api.checkUpdate(serverId);
      setCheckResult(res);
      if (!res.update_available) {
        setSuccess(`已是最新版本（${res.current_version ?? '未知'}）`);
      }
    } catch {
      setCheckResult(null);
    } finally {
      setChecking(false);
    }
  };

  // ----- 加载实例信息和版本池 -----
  const loadServerInfo = async () => {
    try {
      const detail = await api.getServer(serverId);
      const srv = detail.server;
      setCurrentVersion(srv.current_version ?? null);
      setInstanceStatus(srv.status);
      if (srv.pack_id) {
        void loadVersions(srv.pack_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载实例信息失败');
    }
  };

  const loadVersions = async (pid: string) => {
    setLoadingVersions(true);
    try {
      const res = await api.listVersions(pid);
      setVersions(res.versions);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载版本列表失败');
    } finally {
      setLoadingVersions(false);
    }
  };

  // ----- 应用版本 -----
  const handleApply = async (v: GameVersionSummary) => {
    setError(null);
    setSuccess(null);
    setConfirming(null);
    setProgress(null);
    try {
      setProgress({ server_id: serverId, phase: 'installing', progress_percent: 0, message: `正在安装 ${v.version}...` });
      await api.applyUpdate(serverId, { version_id: v.id });
      startPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动应用失败');
    }
  };

  // ----- 渲染辅助 -----
  const getProgressBarClass = (): string => {
    if (!progress) return '';
    if (progress.phase === 'completed') return 'success';
    if (progress.phase === 'failed') return 'error';
    return 'indeterminate';
  };

  const getProgressPercent = (): number => {
    if (!progress) return 0;
    if (progress.phase === 'completed') return 100;
    return progress.progress_percent;
  };

  const isCurrentVersion = (v: GameVersionSummary): boolean =>
    currentVersion !== null && v.version === currentVersion;

  const getButtonLabel = (v: GameVersionSummary): string => {
    if (isCurrentVersion(v)) return '当前';
    if (currentVersion === null) return '应用此版本';
    return compareVersion(v.version, currentVersion) > 0 ? '应用此版本' : '回滚到此版本';
  };

  const getButtonClass = (v: GameVersionSummary): string => {
    if (isCurrentVersion(v)) return 'btn btn-ghost';
    if (currentVersion === null) return 'btn btn-primary';
    return compareVersion(v.version, currentVersion) > 0 ? 'btn btn-primary' : 'btn btn-warning';
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">选择服务端版本</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void handleCheck()} disabled={busy}>
            {checking ? '检查中…' : '检查更新'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* 状态卡 */}
      <div className="info-card" style={{ marginBottom: 16 }}>
        {checkResult ? (
          <>
            <div className="info-row">
              <span className="info-label">当前版本</span>
              <span className="info-value mono">{checkResult.current_version ?? '未知'}</span>
            </div>
            <div className="info-row">
              <span className="info-label">最新版本</span>
              <span className="info-value mono">{checkResult.latest_version ?? '未知'}</span>
            </div>
            <div className="info-row">
              <span className="info-label">更新可用</span>
              <span className="info-value">
                {checkResult.update_available ? (
                  <span className="badge badge-running">有更新</span>
                ) : (
                  <span className="badge badge-stopped">已是最新</span>
                )}
              </span>
            </div>
          </>
        ) : (
          <div className="empty-state">尚未检查更新。点击「检查更新」按钮以查询最新版本。</div>
        )}
      </div>

      {/* 应用进度条 */}
      {progress && (progress.phase === 'installing' || progress.phase === 'downloading') && (
        <div className="progress-container" style={{ marginBottom: 16 }}>
          <div className="progress-label">
            <span className="progress-text">{progress.message}</span>
            <span>{Math.round(progress.progress_percent)}%</span>
          </div>
          <div className="progress-bar">
            <div
              className={`progress-bar-fill ${getProgressBarClass()}`}
              style={{ width: `${getProgressPercent()}%` }}
            />
          </div>
          <div className="progress-phase-info">
            <span className={`phase-badge ${progress.phase}`}>
              {PHASE_LABELS[progress.phase]}
            </span>
          </div>
        </div>
      )}

      {/* 已下载版本列表 */}
      <div className="form-card">
        <h3 className="card-title">可用版本（已下载到节点）</h3>

        {loadingVersions && <div className="empty-state">加载中…</div>}

        {!loadingVersions && versions.length === 0 && !error && (
          <div className="version-pick-empty">
            <p>此 Pack 当前没有已下载的版本。</p>
            <a href="/store/versions" className="btn btn-ghost" style={{ marginTop: 8 }}>
              前往版本管理页面下载
            </a>
          </div>
        )}

        {versions.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>版本</th>
                  <th>节点</th>
                  <th>下载者</th>
                  <th>下载时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => {
                  const isCurrent = isCurrentVersion(v);
                  return (
                    <tr key={v.id} className={isCurrent ? 'version-pick-row is-current' : 'version-pick-row'}>
                      <td className="mono">
                        {v.version}
                        {isCurrent && (
                          <span className="badge badge-stopped" style={{ marginLeft: 8 }}>
                            当前
                          </span>
                        )}
                      </td>
                      <td>{v.node_id}</td>
                      <td>{v.downloaded_by_username}</td>
                      <td className="mono">{v.downloaded_at}</td>
                      <td>
                        {isCurrent ? (
                          <button className="btn btn-ghost btn-sm" disabled>
                            当前
                          </button>
                        ) : confirming?.id === v.id ? (
                          <div className="version-pick-confirm">
                            <span className="version-pick-confirm-text">
                              {compareVersion(v.version, currentVersion ?? '0.0.0') < 0
                                ? `回滚到 ${v.version}？`
                                : `应用到 ${v.version}？`}
                            </span>
                            <button
                              className="btn btn-success btn-sm"
                              onClick={() => void handleApply(v)}
                              disabled={busy || isRunning}
                            >
                              确认
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setConfirming(null)}
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <button
                            className={`${getButtonClass(v)} btn-sm`}
                            onClick={() => setConfirming(v)}
                            disabled={busy || isRunning}
                            title={isRunning ? '实例运行中，请先停止实例再切换版本' : (currentVersion && compareVersion(v.version, currentVersion) < 0 ? '回滚到此版本' : '应用此版本')}
                          >
                            {getButtonLabel(v)}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
