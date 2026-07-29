// ============================================================================
// PackStep — v4.22.0 Setup Wizard v3 Step 6: 启用游戏 Pack
//
// v4.22.0 改造：从"全选/反选本地 packs"改为 Tab 切换四种来源：
//   - GitHub 同步：从 GitHub 仓库（默认 airxw/GSP-Panel）拉取 packs/ 目录
//   - 自定义 URL：用户输入 git URL 或 tarball URL，后端同步
//   - 上传 zip：用户上传 pack.zip，后端解压到 packs/ 目录
//   - 跳过：不启用任何 pack，部署后通过 Pack 管理页面配置
//
// 受控组件：source/githubRepo/githubRef/customUrl/uploadId/packs 由父组件持有。
// 同步动作通过 onSync 回调触发（父组件调 API），本组件仅负责 UI。
// ============================================================================

import { useRef, type ChangeEvent } from 'react';
import { Check, Loader2, Package, Upload, XCircle } from 'lucide-react';
import type {
  PackSourceType,
  PackSummary,
  SyncPacksResponse,
} from '@public/schema/panel-api-types';

export interface PackStepProps {
  /** 当前选中的来源类型 */
  source: PackSourceType;
  /** GitHub 仓库地址（owner/repo） */
  githubRepo: string;
  /** GitHub 分支/Tag */
  githubRef: string;
  /** 自定义 URL */
  customUrl: string;
  /** 上传后的文件标识 */
  uploadId: string;
  /** 已同步/已上传的 pack 列表 */
  packs: PackSummary[];
  /** 是否正在同步 */
  syncing: boolean;
  /** 同步结果 */
  syncResult: SyncPacksResponse | null;
  /** 同步错误 */
  syncError: string | null;
  /** 切换来源类型 */
  onSourceChange: (s: PackSourceType) => void;
  onGithubRepoChange: (v: string) => void;
  onGithubRefChange: (v: string) => void;
  onCustomUrlChange: (v: string) => void;
  /** 选择文件后立即上传（父组件调 API 获取 upload_id） */
  onFileSelected: (file: File) => void;
  /** 触发同步（GitHub / 自定义 URL） */
  onSync: () => void;
}

const TABS: Array<{ key: PackSourceType; label: string; desc: string }> = [
  { key: 'github', label: 'GitHub 同步', desc: '从 GitHub 仓库拉取 packs/ 目录（推荐）' },
  { key: 'custom-url', label: '自定义 URL', desc: '从 git URL 或 tarball URL 同步' },
  { key: 'upload', label: '上传 zip', desc: '手动上传 pack.zip 文件' },
  { key: 'skip', label: '跳过', desc: '不启用任何 pack，部署后配置' },
];

export default function PackStep({
  source,
  githubRepo,
  githubRef,
  customUrl,
  uploadId,
  packs,
  syncing,
  syncResult,
  syncError,
  onSourceChange,
  onGithubRepoChange,
  onGithubRefChange,
  onCustomUrlChange,
  onFileSelected,
  onSync,
}: PackStepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelected(file);
    // 清空 input 允许重复选择同一文件
    e.target.value = '';
  };

  return (
    <div className="setup-form">
      <div className="setup-admin-hint">
        <p>
          <Package size={16} style={{ verticalAlign: '-3px', marginRight: 4 }} />
          选择 Pack 来源。v4.22.0 起支持四种来源，按你的场景选择。
        </p>
      </div>

      {/* Tab 切换 */}
      <div className="setup-pack-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={source === t.key}
            className={`setup-pack-tab ${source === t.key ? 'setup-pack-tab-active' : ''}`}
            onClick={() => onSourceChange(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 描述 */}
      <p className="form-field-hint" style={{ marginTop: 4 }}>
        {TABS.find((t) => t.key === source)?.desc}
      </p>

      {/* GitHub 同步 */}
      {source === 'github' && (
        <div className="setup-pack-source-body">
          <label className="form-field">
            <span className="form-label">GitHub 仓库 *</span>
            <input
              type="text"
              value={githubRepo}
              onChange={(e) => onGithubRepoChange(e.target.value)}
              placeholder="airxw/GSP-Panel"
              spellCheck={false}
              autoComplete="off"
            />
            <span className="form-field-hint">
              格式 <code>owner/repo</code>，后端从 <code>https://github.com/&lt;owner&gt;/&lt;repo&gt;/tree/&lt;ref&gt;/packs</code> 拉取。
            </span>
          </label>
          <label className="form-field">
            <span className="form-label">分支 / Tag</span>
            <input
              type="text"
              value={githubRef}
              onChange={(e) => onGithubRefChange(e.target.value)}
              placeholder="main"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <div className="setup-db-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSync}
              disabled={syncing || !githubRepo.trim()}
            >
              {syncing ? <Loader2 size={14} className="spin" /> : <Package size={14} />}
              同步 Pack
            </button>
          </div>
        </div>
      )}

      {/* 自定义 URL */}
      {source === 'custom-url' && (
        <div className="setup-pack-source-body">
          <label className="form-field">
            <span className="form-label">自定义 URL *</span>
            <input
              type="text"
              value={customUrl}
              onChange={(e) => onCustomUrlChange(e.target.value)}
              placeholder="https://example.com/packs.git 或 https://example.com/packs.tar.gz"
              spellCheck={false}
              autoComplete="off"
            />
            <span className="form-field-hint">
              支持 <code>git URL</code>（<code>https://...git</code>）或 <code>tarball URL</code>（<code>.tar.gz</code> / <code>.tgz</code>）。
            </span>
          </label>
          <div className="setup-db-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSync}
              disabled={syncing || !customUrl.trim()}
            >
              {syncing ? <Loader2 size={14} className="spin" /> : <Package size={14} />}
              同步 Pack
            </button>
          </div>
        </div>
      )}

      {/* 上传 zip */}
      {source === 'upload' && (
        <div className="setup-pack-source-body">
          <label className="form-field">
            <span className="form-label">Pack zip 文件 *</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            <div className="setup-pack-upload-area" onClick={() => fileInputRef.current?.click()}>
              <Upload size={28} />
              <p>
                {uploadId ? `已上传：${uploadId}` : '点击选择 pack.zip 文件'}
              </p>
              <span className="form-field-hint">
                zip 内应包含 pack.yaml 与版本目录结构
              </span>
            </div>
          </label>
        </div>
      )}

      {/* 跳过 */}
      {source === 'skip' && (
        <div className="setup-empty">
          <p>已选择跳过 Pack 配置。</p>
          <p className="form-field-hint">
            部署后可通过「Pack 管理」页面上传或同步。
          </p>
        </div>
      )}

      {/* 同步结果 */}
      {syncError && (
        <div className="setup-submit-errors">
          <div className="setup-submit-errors-title">
            <XCircle size={16} />
            同步失败：
          </div>
          <ul>
            <li>{syncError}</li>
          </ul>
        </div>
      )}
      {syncResult?.ok && syncResult.synced_count !== undefined && (
        <div className="setup-pack-synced">
          <Check size={16} />
          已同步 {syncResult.synced_count} 个 Pack
        </div>
      )}

      {/* 已同步/已上传的 pack 列表 */}
      {packs.length > 0 && (
        <div className="setup-pack-list">
          {packs.map((p) => (
            <div key={p.id} className="setup-pack-item">
              <div className="setup-pack-info">
                <span className="setup-pack-name">{p.display_name}</span>
                <span className="setup-pack-meta">
                  {p.game} · {p.variant} · v{p.version}
                </span>
              </div>
              <Check size={14} className="preflight-icon-ok" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
