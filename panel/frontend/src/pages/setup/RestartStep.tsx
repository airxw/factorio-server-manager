// ============================================================================
// RestartStep — v4.20.0 Setup Wizard v2 Step 7: 应用配置并重启
// v4.22.2 改造：区分三种路径，避免 restart_token 为空时仍调用 triggerRestart
//   导致后端返回 400 "缺少 restart_token 字段"
//
// 三种路径：
//   A. 自动重启：restartToken 非空 → 调 POST /api/init/restart → 轮询 /api/health
//   B. 手动重启：restartToken 为空且 restartRequired=true → 展示"配置已保存，
//      需手动重启"成功态 + SSH 排查指引（可折叠）
//   C. 无需重启：restartToken 为空且 restartRequired=false → 直接展示"配置已保存"
//      成功态，提供"前往登录"按钮
//
// 注意：路径 A 挂载即自动触发重启流程（无需用户点击）。
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Terminal } from 'lucide-react';
import { PanelApiError, type PanelApiClient } from '../../api/client';

/** 轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 2000;
/** 轮询超时（毫秒） */
const POLL_TIMEOUT_MS = 60000;
/** 健康检查端点（相对路径，同源访问） */
const HEALTH_URL = '/api/health';

type RestartPhase = 'restarting' | 'waiting' | 'done' | 'failed' | 'manual';

export interface RestartStepProps {
  /**
   * 由 POST /api/init 返回的一次性 restart_token。
   * v4.22.2: 改为可选——为空时走"手动重启"或"无需重启"路径。
   */
  restartToken?: string;
  /** v4.22.2: 是否需要重启（由 initResp.restart_required 传入） */
  restartRequired?: boolean;
  /** API 客户端（用于调用 triggerRestart） */
  api: PanelApiClient;
  /** 重启成功后回调（父组件导航到 /login） */
  onRestarted: () => void;
}

export default function RestartStep({
  restartToken,
  restartRequired = false,
  api,
  onRestarted,
}: RestartStepProps) {
  // 路径判定：A=自动重启（有 token），B=手动重启（无 token 但需重启），C=无需重启
  const hasToken = Boolean(restartToken);
  const isManualRestart = !hasToken && restartRequired;

  const [phase, setPhase] = useState<RestartPhase>(
    hasToken ? 'restarting' : isManualRestart ? 'manual' : 'done',
  );
  const [message, setMessage] = useState<string>(
    hasToken
      ? '正在应用配置并重启服务…'
      : isManualRestart
        ? '配置已保存，需手动重启 Panel 使其生效。'
        : '配置已保存，无需重启。',
  );
  const [elapsed, setElapsed] = useState(0);
  const [showSshHint, setShowSshHint] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    // 仅路径 A（自动重启）需要执行 effect
    if (!hasToken) return;
    if (startedRef.current) return;
    startedRef.current = true;

    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const startTime = Date.now();

    const pollHealth = async (): Promise<boolean> => {
      try {
        const res = await fetch(HEALTH_URL, { method: 'GET' });
        return res.ok;
      } catch {
        // ECONNREFUSED 是预期的（进程正在重启），继续轮询
        return false;
      }
    };

    const startPolling = () => {
      setPhase('waiting');
      setMessage('等待服务重新上线…');

      const tick = async () => {
        const elapsedNow = Date.now() - startTime;
        setElapsed(elapsedNow);

        if (elapsedNow > POLL_TIMEOUT_MS) {
          setPhase('failed');
          setMessage(
            '重启超时（60s 内服务未恢复）。请通过 SSH 检查：journalctl -u gameserver-panel -n 50',
          );
          return;
        }

        const ok = await pollHealth();
        if (ok) {
          setPhase('done');
          setMessage('服务已恢复，即将跳转登录页…');
          // 短暂延迟后跳转，让用户看到成功状态
          setTimeout(() => onRestarted(), 1500);
          return;
        }
        pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
      };

      pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    const run = async () => {
      try {
        // 等待 3s 让 Panel 后端完成 .env 写入与响应返回
        await new Promise((r) => setTimeout(r, 3000));
        await api.triggerRestart(restartToken as string);
        // 触发成功后开始轮询健康检查
        startPolling();
      } catch (err) {
        const errMsg = err instanceof PanelApiError ? err.message : String(err);
        setPhase('failed');
        setMessage(
          `触发重启失败：${errMsg}。请通过 SSH 手动执行：sudo systemctl restart gameserver-panel`,
        );
      }
    };

    void run();

    return () => {
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [restartToken, hasToken, api, onRestarted]);

  return (
    <div className="setup-form">
      <div className="setup-success" style={{ textAlign: 'center' }}>
        {phase === 'restarting' && (
          <>
            <div className="setup-success-icon" style={{ color: 'var(--color-primary)' }}>
              <RefreshCw size={48} className="spin" />
            </div>
            <h2>正在应用配置并重启服务…</h2>
            <p className="form-field-hint">
              正在触发 systemctl restart gameserver-panel，请稍候…
            </p>
            <p className="form-field-hint">
              请勿关闭此页面。重启期间面板会短暂不可用（约 5-15 秒）。
            </p>
          </>
        )}

        {phase === 'waiting' && (
          <>
            <div className="setup-success-icon" style={{ color: 'var(--color-primary)' }}>
              <Loader2 size={48} className="spin" />
            </div>
            <h2>等待服务重新上线…</h2>
            <p className="form-field-hint">正在轮询 /api/health，已等待 {Math.floor(elapsed / 1000)}s</p>
          </>
        )}

        {phase === 'done' && (
          <>
            <div className="setup-success-icon">
              <CheckCircle2 size={48} />
            </div>
            <h2>{isManualRestart ? '配置已保存' : '重启成功'}</h2>
            <p>{message}</p>
            {isManualRestart && (
              <p className="form-field-hint" style={{ marginTop: 8 }}>
                如修改了数据库连接、公共域名或 Daemon 节点，需重启 Panel 后端进程使新配置生效。
              </p>
            )}
            <div className="setup-db-actions" style={{ justifyContent: 'center', marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onRestarted()}
              >
                前往登录页
              </button>
            </div>
          </>
        )}

        {phase === 'manual' && (
          <>
            <div className="setup-success-icon" style={{ color: 'var(--color-primary)' }}>
              <CheckCircle2 size={48} />
            </div>
            <h2>配置已保存</h2>
            <p>{message}</p>
            <p className="form-field-hint" style={{ marginTop: 8 }}>
              如修改了数据库连接、公共域名或 Daemon 节点，需重启 Panel 后端进程使新配置生效。
            </p>
            <div className="setup-db-actions" style={{ justifyContent: 'center', marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onRestarted()}
              >
                前往登录页
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowSshHint((v) => !v)}
              >
                {showSshHint ? '收起 SSH 指引' : '查看 SSH 重启命令'}
              </button>
            </div>
            {showSshHint && (
              <div className="setup-admin-hint" style={{ marginTop: 12, textAlign: 'left' }}>
                <p>
                  <Terminal size={16} style={{ verticalAlign: '-3px', marginRight: 4 }} />
                  SSH 排查命令：
                </p>
                <pre
                  style={{
                    background: 'var(--color-bg-secondary)',
                    padding: 12,
                    borderRadius: 8,
                    overflowX: 'auto',
                    fontSize: 13,
                  }}
                >
                  {`# 查看服务状态\nsystemctl status gameserver-panel\n\n# 查看最近日志\njournalctl -u gameserver-panel -n 50\n\n# 手动重启\nsudo systemctl restart gameserver-panel\n\n# 检查 .env 是否已更新\ncat /opt/gameserver-panel/panel/backend/.env | grep -E 'DATABASE_URL|PUBLIC_BASE_URL|DAEMON_URL'`}
                </pre>
              </div>
            )}
          </>
        )}

        {phase === 'failed' && (
          <>
            <div className="setup-success-icon" style={{ color: 'var(--color-error)' }}>
              <AlertTriangle size={48} />
            </div>
            <h2>重启失败</h2>
            <p className="form-field-error">{message}</p>
            <div className="setup-admin-hint" style={{ marginTop: 12, textAlign: 'left' }}>
              <p>
                <Terminal size={16} style={{ verticalAlign: '-3px', marginRight: 4 }} />
                SSH 排查命令：
              </p>
              <pre
                style={{
                  background: 'var(--color-bg-secondary)',
                  padding: 12,
                  borderRadius: 8,
                  overflowX: 'auto',
                  fontSize: 13,
                }}
              >
                {`# 查看服务状态\nsystemctl status gameserver-panel\n\n# 查看最近日志\njournalctl -u gameserver-panel -n 50\n\n# 手动重启\nsudo systemctl restart gameserver-panel\n\n# 检查 .env 是否已更新\ncat /opt/gameserver-panel/panel/backend/.env | grep -E 'DATABASE_URL|PUBLIC_BASE_URL|DAEMON_URL'`}
              </pre>
            </div>
            <div className="setup-db-actions" style={{ justifyContent: 'center', marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onRestarted()}
              >
                前往登录页
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
