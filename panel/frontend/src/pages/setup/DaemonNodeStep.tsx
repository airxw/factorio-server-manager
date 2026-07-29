// ============================================================================
// DaemonNodeStep — v4.22.0 Setup Wizard v3 Step 3: Daemon 节点配置
//
// v4.22.1 重构要点：
//   1. 本机单节点模式自动调用 POST /api/init/auto-detect-local-daemon
//      后端读取 daemon/.env 的 DAEMON_TOKEN 并探测 /health，
//      用户无需手动查找/粘贴 token；自动测试通过后即可进入下一步。
//   2. 自动检测失败时显示错误信息 + "重新检测"按钮（用户可修复后重试）
//   3. 多节点模式保留：通过 deploy-daemon.sh 部署独立 Daemon 后导入链接
//   4. 保留"暂不配置"作为兜底（DAEMON_URL 留空，实例管理功能不可用）
//
// 三种模式：
//   - local : 本机单节点模式（默认推荐）— Panel 与 Daemon 同机，自动检测 token
//   - multi : 多节点模式 — 通过 deploy-daemon.sh 部署独立 Daemon 后导入链接
//   - skip  : 暂不配置 — 跳过 Daemon 配置，DAEMON_URL 留空
//
// 受控组件：所有状态由父组件 SetupWizard 持有，本组件仅渲染 + 回调。
// ============================================================================

import { type FormEvent } from 'react';
import {
  CheckCircle2,
  Copy,
  HardDrive,
  Plus,
  RefreshCw,
  Server,
  ServerCog,
  Trash2,
  XCircle,
} from 'lucide-react';
import type {
  DaemonNodeImportPayload,
  DaemonNodeInput,
  TestDaemonConnectionResponse,
} from '@public/schema/panel-api-types';
import { LoadingButton } from '../../components/ui';

/** 节点草稿（带前端临时 id 供 React key 使用） */
export interface DaemonNodeDraft extends DaemonNodeInput {
  /** 前端临时 ID（非后端 id） */
  draftId: string;
}

/** Daemon 配置模式 */
export type DaemonMode = 'local' | 'multi' | 'skip';

/** 本机单节点模式的默认值（与 deploy.sh 默认端口一致） */
export const LOCAL_DEFAULTS = {
  name: '本机节点',
  fqdn: '127.0.0.1',
  port: 8080,
} as const;

/** 独立 Daemon 部署脚本一键命令 */
export const DEPLOY_DAEMON_COMMAND =
  'curl -fsSL https://raw.githubusercontent.com/airxw/GSP-Panel/main/scripts/deploy-daemon.sh | bash';

/** gsp-daemon-import:// 链接前缀 */
const IMPORT_LINK_PREFIX = 'gsp-daemon-import://';

export interface DaemonNodeStepProps {
  /** 当前模式 */
  mode: DaemonMode;
  /** 本机单节点模式：测试结果 */
  localTestResult: TestDaemonConnectionResponse | null;
  /** 本机单节点模式：是否正在测试 */
  localTesting: boolean;
  /** 本机单节点模式：是否测试通过 */
  localTested: boolean;
  /** v4.22.1: 自动检测错误信息（auto-detect 失败时展示） */
  autoDetectError: string | null;
  /** v4.22.1: 自动检测到的 daemon .env 路径（用于错误提示） */
  autoDetectEnvPath: string | null;
  /** 多节点模式：已添加的节点列表 */
  nodes: DaemonNodeDraft[];
  /** 多节点模式：用户粘贴的导入链接 */
  importLink: string;
  /** 多节点模式：导入链接解析/测试错误 */
  importError: string | null;
  /** 多节点模式：是否正在测试并导入 */
  importing: boolean;
  /** 多节点模式：最近一次测试结果（用于展示） */
  importTestResult: TestDaemonConnectionResponse | null;
  /** 切换模式 */
  onModeChange: (mode: DaemonMode) => void;
  /** 触发本机自动检测（v4.22.1: 由父组件 useEffect 自动触发或用户点击"重新检测"按钮调用） */
  onTestLocal: () => void;
  /** 修改导入链接 */
  onImportLinkChange: (link: string) => void;
  /** 测试连接并导入节点 */
  onTestAndImport: () => void;
  /** 移除已添加的节点 */
  onRemoveNode: (draftId: string) => void;
}

/**
 * 解析 gsp-daemon-import://<base64-json> 链接
 *
 * 成功返回 DaemonNodeImportPayload；失败返回 { error }。
 * 兼容标准 base64 与 URL-safe base64（-/_ 替换）；自动补齐 padding。
 */
export function parseDaemonImportLink(
  link: string,
): DaemonNodeImportPayload | { error: string } {
  const trimmed = link.trim();
  if (!trimmed) {
    return { error: '请粘贴导入链接' };
  }
  if (!trimmed.startsWith(IMPORT_LINK_PREFIX)) {
    return {
      error: '链接格式错误：必须以 gsp-daemon-import:// 开头',
    };
  }
  const b64 = trimmed.slice(IMPORT_LINK_PREFIX.length);
  if (!b64) {
    return { error: '链接内容为空' };
  }
  let jsonStr: string;
  try {
    // URL-safe base64 → 标准 base64
    const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
    // 补齐 padding
    const padded =
      normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    // UTF-8 安全解码
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    jsonStr = new TextDecoder('utf-8').decode(bytes);
  } catch {
    return { error: '链接解析失败：base64 解码错误' };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(jsonStr);
  } catch {
    return { error: '链接解析失败：JSON 解析错误' };
  }
  if (typeof payload !== 'object' || payload === null) {
    return { error: '链接 payload 不是有效对象' };
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.name !== 'string' || !p.name) {
    return { error: '链接缺少 name 字段' };
  }
  if (typeof p.fqdn !== 'string' || !p.fqdn) {
    return { error: '链接缺少 fqdn 字段' };
  }
  if (
    typeof p.port !== 'number' ||
    !Number.isFinite(p.port) ||
    p.port < 1 ||
    p.port > 65535
  ) {
    return { error: '链接 port 字段无效（应为 1-65535 的数字）' };
  }
  if (typeof p.token !== 'string' || !p.token) {
    return { error: '链接缺少 token 字段' };
  }
  return {
    name: p.name,
    fqdn: p.fqdn,
    port: p.port,
    token: p.token,
    ...(typeof p.public_ip === 'string' && p.public_ip
      ? { public_ip: p.public_ip }
      : {}),
    ...(p.node_type === 'master' || p.node_type === 'worker'
      ? { node_type: p.node_type }
      : {}),
  };
}

export default function DaemonNodeStep({
  mode,
  localTestResult,
  localTesting,
  localTested,
  autoDetectError,
  autoDetectEnvPath,
  nodes,
  importLink,
  importError,
  importing,
  importTestResult,
  onModeChange,
  onTestLocal,
  onImportLinkChange,
  onTestAndImport,
  onRemoveNode,
}: DaemonNodeStepProps) {
  // ----- 本机模式表单提交（触发测试连接） -----
  const handleLocalSubmit = (e: FormEvent) => {
    e.preventDefault();
    onTestLocal();
  };

  // ----- 多节点模式导入链接表单提交 -----
  const handleImportSubmit = (e: FormEvent) => {
    e.preventDefault();
    onTestAndImport();
  };

  // ----- 复制部署命令到剪贴板 -----
  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(DEPLOY_DAEMON_COMMAND);
    } catch {
      // 静默失败——用户可手动选择文本复制
    }
  };

  return (
    <div className="setup-form">
      <div className="setup-admin-hint">
        <p>
          <HardDrive size={16} style={{ verticalAlign: '-3px', marginRight: 4 }} />
          配置管理游戏服务器实例的 Daemon 节点。
        </p>
        <p className="form-field-hint">
          推荐使用「本机单节点模式」——Panel 与 Daemon 同机部署，零网络配置；
          多节点场景请使用「多节点模式」通过部署脚本导入。
        </p>
      </div>

      {/* 模式选择卡片 */}
      <div className="setup-daemon-mode-group">
        <button
          type="button"
          className={`setup-daemon-mode-card ${mode === 'local' ? 'setup-daemon-mode-card-active' : ''}`}
          onClick={() => onModeChange('local')}
          aria-pressed={mode === 'local'}
        >
          <div className="setup-daemon-mode-icon">
            <Server size={24} />
          </div>
          <div className="setup-daemon-mode-body">
            <div className="setup-daemon-mode-title">
              本机单节点
              {mode === 'local' && <span className="setup-daemon-mode-badge">推荐</span>}
            </div>
            <div className="setup-daemon-mode-desc">
              Panel 与 Daemon 同机部署，连接 127.0.0.1:8080，仅需填入 Daemon 通信 Token。
            </div>
          </div>
        </button>

        <button
          type="button"
          className={`setup-daemon-mode-card ${mode === 'multi' ? 'setup-daemon-mode-card-active' : ''}`}
          onClick={() => onModeChange('multi')}
          aria-pressed={mode === 'multi'}
        >
          <div className="setup-daemon-mode-icon">
            <ServerCog size={24} />
          </div>
          <div className="setup-daemon-mode-body">
            <div className="setup-daemon-mode-title">
              多节点
              {mode === 'multi' && <span className="setup-daemon-mode-badge">已选</span>}
            </div>
            <div className="setup-daemon-mode-desc">
              在远程机器执行部署脚本，复制返回的导入链接粘贴到下方，先测试连接再导入。
            </div>
          </div>
        </button>

        <button
          type="button"
          className={`setup-daemon-mode-card ${mode === 'skip' ? 'setup-daemon-mode-card-active' : ''}`}
          onClick={() => onModeChange('skip')}
          aria-pressed={mode === 'skip'}
        >
          <div className="setup-daemon-mode-icon">
            <XCircle size={24} />
          </div>
          <div className="setup-daemon-mode-body">
            <div className="setup-daemon-mode-title">
              暂不配置
              {mode === 'skip' && <span className="setup-daemon-mode-badge">已选</span>}
            </div>
            <div className="setup-daemon-mode-desc">
              跳过 Daemon 配置，DAEMON_URL 留空，实例管理功能将不可用。
            </div>
          </div>
        </button>
      </div>

      {/* ===== 模式：本机单节点 ===== */}
      {mode === 'local' && (
        <form className="setup-form setup-daemon-local" onSubmit={handleLocalSubmit}>
          <div className="setup-admin-hint setup-daemon-local-hint">
            <p>
              Panel 与 Daemon 同机部署，自动读取 <code>daemon/.env</code> 中的
              <code> DAEMON_TOKEN</code> 并探测 <code>http://127.0.0.1:8080/health</code>。
            </p>
            <p className="form-field-hint">
              无需手动查找 token——点击下方"自动检测并连接"按钮即可。
            </p>
          </div>

          <label className="form-field">
            <span className="form-label">节点名称</span>
            <input
              type="text"
              value={LOCAL_DEFAULTS.name}
              disabled
              readOnly
            />
            <span className="form-field-hint">本机模式固定为「{LOCAL_DEFAULTS.name}」</span>
          </label>

          <div className="form-row">
            <label className="form-field">
              <span className="form-label">Daemon 地址</span>
              <input
                type="text"
                value={LOCAL_DEFAULTS.fqdn}
                disabled
                readOnly
              />
            </label>
            <label className="form-field">
              <span className="form-label">Daemon 端口</span>
              <input
                type="text"
                value={String(LOCAL_DEFAULTS.port)}
                disabled
                readOnly
              />
            </label>
          </div>

          {/* 自动检测结果展示 */}
          {localTesting && (
            <div className="setup-daemon-auto-detecting">
              <RefreshCw size={16} className="spin" />
              <span>正在读取 <code>daemon/.env</code> 并探测 Daemon 健康…</span>
            </div>
          )}

          {autoDetectError && !localTesting && (
            <div className="setup-daemon-test-fail">
              <XCircle size={16} />
              <div>
                <div>{autoDetectError}</div>
                {autoDetectEnvPath && (
                  <div className="form-field-hint" style={{ marginTop: 4 }}>
                    配置文件路径：<code>{autoDetectEnvPath}</code>
                    <br />
                    修复建议：执行 <code>sudo systemctl status gameserver-daemon</code> 检查服务状态，
                    或运行 <code>sudo bash /opt/gameserver-panel/deploy.sh install</code> 完成部署。
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 测试结果展示 */}
          {localTestResult && localTested && (
            <DaemonTestResultBanner result={localTestResult} />
          )}

          <div className="setup-db-actions">
            <LoadingButton
              type="submit"
              variant="primary"
              loading={localTesting}
              loadingText="自动检测中…"
              disabled={localTesting}
            >
              <RefreshCw size={14} />
              {localTested ? '重新检测' : '自动检测并连接'}
            </LoadingButton>
          </div>
          {localTested && (
            <div className="setup-daemon-tested-hint">
              <CheckCircle2 size={14} />
              连接测试通过，可进入下一步。
            </div>
          )}
        </form>
      )}

      {/* ===== 模式：多节点 ===== */}
      {mode === 'multi' && (
        <div className="setup-daemon-multi">
          {/* 部署脚本命令展示 */}
          <div className="setup-daemon-deploy-section">
            <div className="setup-daemon-section-title">
              <Server size={16} />
              <span>1. 在远程机器执行部署脚本</span>
            </div>
            <p className="form-field-hint">
              通过 SSH 登录目标机器后执行以下命令（需要 root 权限）。脚本会自动安装 Node.js、克隆仓库、
              生成 DAEMON_TOKEN 并启动 systemd 服务，最后输出形如 <code>gsp-daemon-import://...</code> 的导入链接。
            </p>
            <div className="setup-daemon-code-block">
              <code>{DEPLOY_DAEMON_COMMAND}</code>
              <button
                type="button"
                className="btn btn-ghost btn-sm setup-daemon-copy-btn"
                onClick={() => void handleCopyCommand()}
                aria-label="复制命令"
              >
                <Copy size={14} />
                复制
              </button>
            </div>
          </div>

          {/* 导入链接粘贴 */}
          <form className="setup-form setup-daemon-import-form" onSubmit={handleImportSubmit}>
            <div className="setup-daemon-section-title">
              <Plus size={16} />
              <span>2. 粘贴导入链接，测试连接并导入</span>
            </div>
            <p className="form-field-hint">
              部署脚本完成后会输出 <code>gsp-daemon-import://&lt;base64&gt;</code> 链接（包含通信 Token），
              复制完整链接粘贴到下方。点击「测试连接并导入」会先调用 GSP 后端验证可达性，通过后自动加入节点列表。
            </p>
            <label className="form-field">
              <span className="form-label">导入链接 *</span>
              <textarea
                value={importLink}
                onChange={(e) => onImportLinkChange(e.target.value)}
                placeholder="gsp-daemon-import://eyJuYW1lIjoi..."
                rows={3}
                spellCheck={false}
                autoComplete="off"
                disabled={importing}
              />
            </label>

            {/* 错误展示 */}
            {importError && (
              <div className="setup-submit-errors">
                <div className="setup-submit-errors-title">
                  <XCircle size={16} />
                  {importError}
                </div>
              </div>
            )}

            {/* 测试结果展示 */}
            {importTestResult && !importError && (
              <DaemonTestResultBanner result={importTestResult} />
            )}

            <div className="setup-db-actions">
              <LoadingButton
                type="submit"
                variant="primary"
                loading={importing}
                loadingText="测试并导入中…"
                disabled={!importLink.trim()}
              >
                <PlugIcon />
                测试连接并导入
              </LoadingButton>
            </div>
          </form>

          {/* 已添加节点列表 */}
          <div className="setup-daemon-nodes-section">
            <div className="setup-daemon-section-title">
              <ServerCog size={16} />
              <span>3. 已添加的节点（{nodes.length}）</span>
            </div>
            {nodes.length > 0 ? (
              <div className="setup-pack-list">
                {nodes.map((n) => (
                  <div key={n.draftId} className="setup-pack-item">
                    <div className="setup-pack-info">
                      <span className="setup-pack-name">
                        {n.name}
                        <span className="setup-pack-meta" style={{ marginLeft: 8 }}>
                          · {n.node_type ?? 'master'}
                        </span>
                      </span>
                      <span className="setup-pack-meta">
                        {n.fqdn}
                        {n.public_ip ? ` · IP: ${n.public_ip}` : ''}
                      </span>
                      <span className="setup-pack-meta">Token: ******（已加密暂存）</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => onRemoveNode(n.draftId)}
                      aria-label="移除节点"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="setup-empty">
                <p>尚未添加任何 Daemon 节点。</p>
                <p className="form-field-hint">
                  执行部署脚本并粘贴导入链接后，点击「测试连接并导入」按钮添加首节点。
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== 模式：暂不配置 ===== */}
      {mode === 'skip' && (
        <div className="setup-empty">
          <p>
            <XCircle size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />
            已选择跳过 Daemon 配置。
          </p>
          <p className="form-field-hint">
            提交后 <code>.env DAEMON_URL</code> 将留空，实例管理功能将不可用。
            可在系统设置中后续配置。
          </p>
        </div>
      )}
    </div>
  );
}

// ----- 测试结果展示组件（本机/多节点模式共用） -----

function DaemonTestResultBanner({
  result,
}: {
  result: TestDaemonConnectionResponse;
}) {
  if (result.ok) {
    return (
      <div className="setup-daemon-test-ok">
        <CheckCircle2 size={16} />
        <span>
          连接成功（耗时 {result.latency_ms ?? '-'} ms
          {result.daemon_version ? ` · Daemon 版本 ${result.daemon_version}` : ''}）
        </span>
      </div>
    );
  }
  return (
    <div className="setup-daemon-test-fail">
      <XCircle size={16} />
      <span>连接失败：{result.error ?? '未知错误'}</span>
    </div>
  );
}

// ----- 插头图标（避免引入新 lucide 图标名冲突，用 inline SVG） -----

function PlugIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  );
}
