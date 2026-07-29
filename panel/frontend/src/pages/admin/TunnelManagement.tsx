// ============================================================================
// TunnelManagement — FRP 隧道管理（I2，v4.4.0-O1）
// 后端：/api/system/tunnel 6 个端点
//   GET  /api/system/tunnel/status — 查询 frpc 进程状态
//   GET  /api/system/tunnel/config — 获取当前配置
//   PUT  /api/system/tunnel/config — 更新配置（不自动重启）
//   POST /api/system/tunnel/start  — 启动 frpc 隧道
//   POST /api/system/tunnel/stop   — 停止 frpc 隧道
//   GET  /api/system/tunnel/logs   — 获取最近日志
//
// 三大区块：
//   1. 状态卡（运行中/已停止 + PID + 启动/停止按钮）
//   2. 配置编辑区（server_addr / server_port / token / enabled / tunnels 数组）
//   3. 日志查看区（最近 200 条日志，可手动刷新）
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Network,
  Play,
  Plus,
  RefreshCw,
  Save,
  ScrollText,
  Square,
  Trash2,
} from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import type {
  TunnelConfig,
  TunnelLogEntry,
  TunnelMapping,
  TunnelStatus,
  TunnelType,
} from '../../api/modules/system';
import { SensitiveInput, useToast } from '../../components/ui';
import { getEffectiveRole, isAdminRole } from '../../utils/role';

const TUNNEL_TYPES: TunnelType[] = ['tcp', 'udp', 'http', 'https'];

const sectionStyle: React.CSSProperties = {
  border: '1px solid var(--color-border, #e5e7eb)',
  borderRadius: 8,
  padding: 16,
  background: 'var(--color-bg-primary, #fff)',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 12px 0',
  fontSize: 15,
  fontWeight: 600,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  border: '1px solid var(--color-border, #d1d5db)',
  borderRadius: 4,
  fontSize: 13,
  boxSizing: 'border-box',
};

const EMPTY_TUNNEL: TunnelMapping = {
  name: '',
  type: 'tcp',
  local_ip: '127.0.0.1',
  local_port: 25565,
  remote_port: undefined,
  custom_domains: [],
};

/** 计算 frpc 进程已运行时长（started_at 至今） */
function formatUptime(startedAt: string | null): string {
  if (!startedAt) return '—';
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 时 ${minutes % 60} 分`;
  const days = Math.floor(hours / 24);
  return `${days} 天 ${hours % 24} 时`;
}

export default function TunnelManagement() {
  const { api, user } = useAuth();
  const toast = useToast();

  const [status, setStatus] = useState<TunnelStatus | null>(null);
  const [config, setConfig] = useState<TunnelConfig | null>(null);
  const [logs, setLogs] = useState<TunnelLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatusError(null);
    setConfigError(null);
    setLogsError(null);
    const [statusR, configR, logsR] = await Promise.allSettled([
      api.getTunnelStatus(),
      api.getTunnelConfig(),
      api.getTunnelLogs(200),
    ]);
    const errMsg = (e: unknown, fallback: string) =>
      e instanceof PanelApiError ? e.message : e instanceof Error ? e.message : fallback;
    if (statusR.status === 'fulfilled') {
      setStatus(statusR.value.status);
    } else {
      setStatus(null);
      setStatusError(errMsg(statusR.reason, '加载状态失败'));
    }
    if (configR.status === 'fulfilled') {
      setConfig(configR.value.config);
    } else {
      setConfig(null);
      setConfigError(errMsg(configR.reason, '加载配置失败'));
    }
    if (logsR.status === 'fulfilled') {
      setLogs(logsR.value.logs ?? []);
    } else {
      setLogs([]);
      setLogsError(errMsg(logsR.reason, '加载日志失败'));
    }
    const errors = [statusR, configR, logsR].filter((r) => r.status === 'rejected');
    const statusVal = statusR.status === 'fulfilled' ? statusR.value.status : null;
    const configVal = configR.status === 'fulfilled' ? configR.value.config : null;
    if (errors.length > 0 && !statusVal && !configVal) {
      toast.error('部分数据加载失败');
    }
    setLoading(false);
  }, [api, toast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleStart = useCallback(async () => {
    setActionBusy(true);
    try {
      const res = await api.startTunnel();
      if (res.success) {
        toast.success(`隧道已启动：${res.message}`);
      } else {
        toast.error('启动失败', res.message);
      }
      await loadAll();
    } catch (err) {
      toast.error('启动失败', err instanceof Error ? err.message : '未知错误');
    } finally {
      setActionBusy(false);
    }
  }, [api, toast, loadAll]);

  const handleStop = useCallback(async () => {
    setActionBusy(true);
    try {
      const res = await api.stopTunnel();
      if (res.success) {
        toast.success(`隧道已停止：${res.message}`);
      } else {
        toast.error('停止失败', res.message);
      }
      await loadAll();
    } catch (err) {
      toast.error('停止失败', err instanceof Error ? err.message : '未知错误');
    } finally {
      setActionBusy(false);
    }
  }, [api, toast, loadAll]);

  const handleSaveConfig = useCallback(async () => {
    if (!config) return;
    if (!config.server_addr.trim()) {
      toast.warning('server_addr 不能为空');
      return;
    }
    if (config.server_port < 1 || config.server_port > 65535) {
      toast.warning('server_port 必须为 1-65535');
      return;
    }
    for (const t of config.tunnels) {
      if (!t.name.trim()) {
        toast.warning('tunnel name 不能为空');
        return;
      }
      if ((t.type === 'tcp' || t.type === 'udp') && (t.remote_port === undefined || t.remote_port < 1)) {
        toast.warning(`${t.name}: tcp/udp 类型必须填写 remote_port`);
        return;
      }
    }
    setSavingConfig(true);
    try {
      const res = await api.updateTunnelConfig(config);
      toast.success(res.message);
    } catch (err) {
      toast.error('保存配置失败', err instanceof Error ? err.message : '未知错误');
    } finally {
      setSavingConfig(false);
    }
  }, [api, config, toast]);

  const updateTunnel = useCallback((index: number, patch: Partial<TunnelMapping>) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const tunnels = [...prev.tunnels];
      tunnels[index] = { ...tunnels[index], ...patch };
      return { ...prev, tunnels };
    });
  }, []);

  const addTunnel = useCallback(() => {
    setConfig((prev) => {
      if (!prev) return prev;
      const newTunnel: TunnelMapping = {
        ...EMPTY_TUNNEL,
        name: `tunnel-${prev.tunnels.length + 1}`,
      };
      return { ...prev, tunnels: [...prev.tunnels, newTunnel] };
    });
  }, []);

  const removeTunnel = useCallback((index: number) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const tunnels = prev.tunnels.filter((_, i) => i !== index);
      return { ...prev, tunnels };
    });
  }, []);

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>
            <Network size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            隧道管理
          </h2>
          <p className="page-description">
            管理 FRP 隧道（frpc）——查看运行状态、编辑配置、启停进程、查看日志
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void loadAll()} disabled={loading}>
            <RefreshCw size={14} />
            {loading ? '加载中…' : '刷新全部'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* 1. 状态卡 */}
      <div style={{ ...sectionStyle, marginBottom: 16 }}>
        <h3 style={sectionTitleStyle}>
          <Activity size={16} />
          进程状态
        </h3>
        {loading && !status ? (
          <div className="empty-state">加载中…</div>
        ) : statusError ? (
          <div className="empty-state">
            加载失败：{statusError}
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: 8 }}
              onClick={() => void loadAll()}
            >
              <RefreshCw size={12} />
              重试
            </button>
          </div>
        ) : !status ? (
          <div className="empty-state">暂无状态数据</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)' }}>状态</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: status.running ? '#16a34a' : '#9ca3af' }}>
                {status.running ? '运行中' : '已停止'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)' }}>PID</div>
              <div style={{ fontSize: 16, fontFamily: 'monospace' }}>
                {status.pid ?? '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)' }}>运行时长</div>
              <div style={{ fontSize: 14 }}>{formatUptime(status.started_at)}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)' }}>配置启用</div>
              <div style={{ fontSize: 14 }}>{status.enabled ? '是' : '否'}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)' }}>服务器</div>
              <div style={{ fontSize: 14, fontFamily: 'monospace' }}>
                {status.server_addr}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)' }}>隧道数</div>
              <div style={{ fontSize: 14 }}>{status.tunnel_count}</div>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-success"
            onClick={() => void handleStart()}
            disabled={actionBusy || status?.running === true}
          >
            <Play size={14} />
            {actionBusy ? '处理中…' : '启动'}
          </button>
          <button
            className="btn btn-danger"
            onClick={() => void handleStop()}
            disabled={actionBusy || status?.running !== true}
          >
            <Square size={14} />
            {actionBusy ? '处理中…' : '停止'}
          </button>
        </div>
      </div>

      {/* 2. 配置编辑区 */}
      <div style={{ ...sectionStyle, marginBottom: 16 }}>
        <h3 style={sectionTitleStyle}>
          <Network size={16} />
          配置编辑
        </h3>
        {!config ? (
          configError ? (
            <div className="empty-state">
              加载失败：{configError}
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: 8 }}
                onClick={() => void loadAll()}
              >
                <RefreshCw size={12} />
                重试
              </button>
            </div>
          ) : (
            <div className="empty-state">暂无配置数据</div>
          )
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500 }}>frps 服务器地址</label>
                <input
                  type="text"
                  style={inputStyle}
                  value={config.server_addr}
                  onChange={(e) =>
                    setConfig((prev) => (prev ? { ...prev, server_addr: e.target.value } : prev))
                  }
                  placeholder="frps.example.com"
                />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500 }}>frps 服务器端口</label>
                <input
                  type="number"
                  style={inputStyle}
                  value={config.server_port}
                  min={1}
                  max={65535}
                  onChange={(e) =>
                    setConfig((prev) =>
                      prev
                        ? { ...prev, server_port: parseInt(e.target.value, 10) || 0 }
                        : prev,
                    )
                  }
                />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500 }}>认证 token（可选）</label>
                <SensitiveInput
                  value={config.token ?? ''}
                  onChange={(v) =>
                    setConfig((prev) => (prev ? { ...prev, token: v } : prev))
                  }
                  placeholder="frpc token"
                />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500 }}>启用隧道</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={(e) =>
                      setConfig((prev) => (prev ? { ...prev, enabled: e.target.checked } : prev))
                    }
                  />
                  <span style={{ fontSize: 13 }}>{config.enabled ? '已启用' : '已禁用'}</span>
                </label>
              </div>
            </div>

            {/* tunnels 数组编辑 */}
            <div style={{ borderTop: '1px dashed var(--color-border, #e5e7eb)', paddingTop: 12 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <h4 style={{ margin: 0, fontSize: 14 }}>隧道映射列表（{config.tunnels.length}）</h4>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={addTunnel}>
                  <Plus size={12} />
                  添加隧道
                </button>
              </div>
              {config.tunnels.length === 0 ? (
                <div className="empty-state">暂无隧道映射，点击「添加隧道」开始</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {config.tunnels.map((t, idx) => (
                    <div
                      key={idx}
                      style={{
                        border: '1px solid var(--color-border, #e5e7eb)',
                        borderRadius: 6,
                        padding: 10,
                        background: 'var(--color-bg-secondary, #f9fafb)',
                      }}
                    >
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                          gap: 8,
                        }}
                      >
                        <div>
                          <label style={{ fontSize: 12, color: '#6b7280' }}>名称</label>
                          <input
                            type="text"
                            style={inputStyle}
                            value={t.name}
                            onChange={(e) => updateTunnel(idx, { name: e.target.value })}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 12, color: '#6b7280' }}>类型</label>
                          <select
                            style={inputStyle}
                            value={t.type}
                            onChange={(e) =>
                              updateTunnel(idx, { type: e.target.value as TunnelType })
                            }
                          >
                            {TUNNEL_TYPES.map((tp) => (
                              <option key={tp} value={tp}>
                                {tp}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: 12, color: '#6b7280' }}>本地 IP</label>
                          <input
                            type="text"
                            style={inputStyle}
                            value={t.local_ip}
                            onChange={(e) => updateTunnel(idx, { local_ip: e.target.value })}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 12, color: '#6b7280' }}>本地端口</label>
                          <input
                            type="number"
                            style={inputStyle}
                            value={t.local_port}
                            min={1}
                            max={65535}
                            onChange={(e) =>
                              updateTunnel(idx, {
                                local_port: parseInt(e.target.value, 10) || 0,
                              })
                            }
                          />
                        </div>
                        {(t.type === 'tcp' || t.type === 'udp') && (
                          <div>
                            <label style={{ fontSize: 12, color: '#6b7280' }}>远程端口</label>
                            <input
                              type="number"
                              style={inputStyle}
                              value={t.remote_port ?? ''}
                              min={1}
                              max={65535}
                              onChange={(e) =>
                                updateTunnel(idx, {
                                  remote_port: parseInt(e.target.value, 10) || undefined,
                                })
                              }
                            />
                          </div>
                        )}
                        {(t.type === 'http' || t.type === 'https') && (
                          <div style={{ gridColumn: '1 / -1' }}>
                            <label style={{ fontSize: 12, color: '#6b7280' }}>
                              自定义域名（逗号分隔）
                            </label>
                            <input
                              type="text"
                              style={inputStyle}
                              value={(t.custom_domains ?? []).join(', ')}
                              onChange={(e) =>
                                updateTunnel(idx, {
                                  custom_domains: e.target.value
                                    .split(',')
                                    .map((s) => s.trim())
                                    .filter(Boolean),
                                })
                              }
                              placeholder="game.example.com, alt.example.com"
                            />
                          </div>
                        )}
                      </div>
                      <div style={{ marginTop: 8, textAlign: 'right' }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: '#dc2626' }}
                          onClick={() => removeTunnel(idx)}
                        >
                          <Trash2 size={12} />
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-primary"
                onClick={() => void handleSaveConfig()}
                disabled={savingConfig}
              >
                <Save size={14} />
                {savingConfig ? '保存中…' : '保存配置'}
              </button>
            </div>
            <p className="form-hint">
              保存配置不会自动重启 frpc 进程，需手动点击「启动」使配置生效
            </p>
          </div>
        )}
      </div>

      {/* 3. 日志查看区 */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <ScrollText size={16} />
          最近日志（{logs.length} 条）
        </h3>
        {logsError ? (
          <div className="empty-state">
            加载失败：{logsError}
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: 8 }}
              onClick={() => void loadAll()}
            >
              <RefreshCw size={12} />
              重试
            </button>
          </div>
        ) : logs.length === 0 ? (
          <div className="empty-state">暂无日志</div>
        ) : (
          <div
            style={{
              maxHeight: 400,
              overflowY: 'auto',
              border: '1px solid var(--color-border, #e5e7eb)',
              borderRadius: 4,
              background: 'var(--color-bg-secondary, #f9fafb)',
              padding: 8,
              fontFamily: 'monospace',
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {logs.map((log, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 8,
                  padding: '2px 0',
                  color: log.level === 'error' ? '#dc2626' : 'var(--color-text-primary, #374151)',
                }}
              >
                <span style={{ color: '#9ca3af', flexShrink: 0 }}>{log.timestamp}</span>
                <span style={{ flexShrink: 0, fontWeight: 600 }}>
                  [{log.level.toUpperCase()}]
                </span>
                <span style={{ wordBreak: 'break-word' }}>{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
