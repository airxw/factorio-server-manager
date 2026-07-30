// ============================================================================
// Mods — Mod 管理页（实例详情子页）
// 功能：列出 Mod、添加 Mod、切换 enabled、删除 Mod
// 契约：public/schema/panel-api-types.ts -> ModRecordSummary / CreateModRequest
// L4: 新增 jar 元数据扫描，识别客户端 mod（OptiFine 等），防止误装到服务端
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreateModRequest, ModRecordSummary, ModFileInfo } from '@public/schema/panel-api-types';
import { useAuth } from '../../api/auth';
import { ListSkeleton } from '../../components/ui';
import type { ModMetadata } from '../../api/client';

export interface ModsPageProps {
  serverId: string;
  gameType?: string;
}

export default function Mods({ serverId, gameType }: ModsPageProps) {
  const { api } = useAuth();
  const modConfig = getModUIConfig(gameType);

  const [mods, setMods] = useState<ModRecordSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // 创建表单字段
  const [modName, setModName] = useState('');
  const [version, setVersion] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [sourceUrl, setSourceUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // v4.3.0-H2: 文件系统级 Mod 管理
  const [modFiles, setModFiles] = useState<ModFileInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [togglingFile, setTogglingFile] = useState<string | null>(null);

  // L4: jar 元数据扫描（识别客户端 mod）
  // 以文件名为键建立元数据索引，便于在 mod 文件表中按行匹配展示
  const [modMetadataMap, setModMetadataMap] = useState<Map<string, ModMetadata>>(new Map());
  const [metadataScanning, setMetadataScanning] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [metadataScanned, setMetadataScanned] = useState(false);

  // Mod 文件上传
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listMods(serverId);
      setMods(res.mods);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 Mod 列表失败');
    } finally {
      setLoading(false);
    }
  }, [api, serverId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetForm = () => {
    setModName('');
    setVersion('');
    setEnabled(true);
    setSourceUrl('');
  };

  const handleCreate = async () => {
    const name = modName.trim();
    const ver = version.trim();
    if (!name || !ver) {
      setError('Mod 名称与版本为必填项');
      return;
    }
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const req: CreateModRequest = {
        mod_name: name,
        version: ver,
        enabled,
        source_url: sourceUrl.trim() || null,
      };
      await api.createMod(serverId, req);
      setSuccess(`已添加 Mod：${name}`);
      resetForm();
      setShowForm(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加 Mod 失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleEnabled = async (mod: ModRecordSummary) => {
    setError(null);
    setSuccess(null);
    try {
      const res = await api.updateMod(serverId, mod.id, { enabled: !mod.enabled });
      setMods((prev) => prev.map((m) => (m.id === mod.id ? res.mod : m)));
      setSuccess(`已${!mod.enabled ? '启用' : '禁用'} Mod：${mod.mod_name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新 Mod 状态失败');
    }
  };

  const handleDelete = async (mod: ModRecordSummary) => {
    if (!window.confirm(`确认删除 Mod「${mod.mod_name}」？此操作不可撤销。`)) {
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      await api.deleteMod(serverId, mod.id);
      setMods((prev) => prev.filter((m) => m.id !== mod.id));
      setSuccess(`已删除 Mod：${mod.mod_name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除 Mod 失败');
    }
  };

  // v4.3.0-H2: 文件系统级 Mod 管理
  const refreshModFiles = useCallback(async () => {
    setFilesLoading(true);
    setFilesError(null);
    try {
      const res = await api.listModFiles(serverId);
      setModFiles(res.mods);
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : '加载 Mod 文件列表失败');
    } finally {
      setFilesLoading(false);
    }
  }, [api, serverId]);

  const handleToggleModFile = async (modFile: ModFileInfo) => {
    setTogglingFile(modFile.name);
    setFilesError(null);
    try {
      const result = await api.toggleModFile(serverId, modFile.name);
      setModFiles((prev) =>
        prev.map((m) =>
          m.name === modFile.name
            ? { ...m, state: result.new_state }
            : m,
        ),
      );
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : '切换 Mod 文件状态失败');
    } finally {
      setTogglingFile(null);
    }
  };

  // L4: 扫描 mods/ 目录下所有 .jar 文件的元数据，识别客户端 mod
  // 返回结果按 sourceFile（文件名）建立 Map，供表格行匹配
  const handleScanMetadata = async () => {
    setMetadataScanning(true);
    setMetadataError(null);
    try {
      const res = await api.scanMods(serverId);
      const map = new Map<string, ModMetadata>();
      for (const m of res.mods) {
        // sourceFile 可能是绝对路径或纯文件名，统一取 basename 作为键
        const basename = m.sourceFile.split('/').pop()?.split('\\').pop() ?? m.sourceFile;
        map.set(basename, m);
      }
      setModMetadataMap(map);
      setMetadataScanned(true);
    } catch (err) {
      setMetadataError(err instanceof Error ? err.message : '扫描 Mod 元数据失败');
    } finally {
      setMetadataScanning(false);
    }
  };

  // 上传 Mod 文件到 mods/ 目录
  const handleUploadMod = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 重置 input value 允许重复选择同一文件
    e.target.value = '';
    setError(null);
    setSuccess(null);
    setUploading(true);
    setUploadProgress('上传中…');
    try {
      const modsDir = modConfig.modsDirLabel.replace(/\/$/, '');
      const targetPath = `${modsDir}/${file.name}`;
      await api.uploadFile(serverId, file, targetPath, (current, total) => {
        setUploadProgress(`上传中… ${current}/${total} 片`);
      });
      setSuccess(`已上传 Mod 文件：${file.name}`);
      await refreshModFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传 Mod 文件失败');
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Mod 管理</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
          <button className="btn btn-success" onClick={() => setShowForm((v) => !v)}>
            {showForm ? '收起表单' : '添加 Mod'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}
        >
          <div className="form-group">
            <label htmlFor="mod-name">Mod 名称 *</label>
            <input
              id="mod-name"
              className="form-control"
              type="text"
              value={modName}
              onChange={(e) => setModName(e.target.value)}
              placeholder="例如：Krastorio2"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="mod-version">版本 *</label>
            <input
              id="mod-version"
              className="form-control"
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="例如：2.0.1"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="mod-enabled">
              <input
                id="mod-enabled"
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />{' '}
              启用此 Mod
            </label>
          </div>
          <div className="form-group">
            <label htmlFor="mod-source-url">来源 URL（可选）</label>
            <input
              id="mod-source-url"
              className="form-control"
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://mods.factorio.com/..."
            />
          </div>
          <div className="page-actions">
            <button type="submit" className="btn btn-success" disabled={submitting}>
              {submitting ? '提交中…' : '确认添加'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              disabled={submitting}
            >
              取消
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <ListSkeleton rows={5} columns={4} />
      ) : mods.length === 0 ? (
        <div className="empty-state">暂无 Mod 记录。点击「添加 Mod」创建。</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Mod 名称</th>
              <th>版本</th>
              <th>启用</th>
              <th>来源 URL</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {mods.map((mod) => (
              <tr key={mod.id}>
                <td>{mod.mod_name}</td>
                <td>{mod.version}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={mod.enabled}
                    onChange={() => void handleToggleEnabled(mod)}
                  />
                </td>
                <td>
                  {mod.source_url ? (
                    <a href={mod.source_url} target="_blank" rel="noreferrer">
                      {mod.source_url}
                    </a>
                  ) : (
                    <span>—</span>
                  )}
                </td>
                <td>
                  <button className="btn btn-sm btn-danger" onClick={() => void handleDelete(mod)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* v4.3.0-H2: 文件系统级 Mod 管理 / v4.33.0 多游戏自适应 */}
      <div className="page-header" style={{ marginTop: 32 }}>
        <h3 className="page-title">Mod 文件管理（文件系统）</h3>
        <div className="page-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.jar,.cs,.dll"
            onChange={(e) => void handleUploadMod(e)}
            style={{ display: 'none' }}
          />
          <button
            className="btn btn-success"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? uploadProgress || '上传中…' : '上传 Mod'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => void refreshModFiles()}
            disabled={filesLoading}
          >
            {filesLoading ? '加载中…' : `扫描 ${modConfig.modsDirLabel || 'mod'} 目录`}
          </button>
          <button
            className="btn btn-info"
            onClick={() => void handleScanMetadata()}
            disabled={metadataScanning || modFiles.length === 0}
            title={modFiles.length === 0 ? '请先扫描 mod 目录' : modConfig.metadataTooltip}
          >
            {metadataScanning ? '扫描元数据中…' : '扫描元数据'}
          </button>
        </div>
      </div>

      <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
        {modConfig.description}
      </p>

      {filesError && <div className="alert alert-error">{filesError}</div>}
      {metadataError && <div className="alert alert-error">{metadataError}</div>}
      {metadataScanned && modMetadataMap.size > 0 && (
        <div className="alert alert-warning">
          ⚠ 扫描完成：共 {modMetadataMap.size} 个 mod 被识别，
          其中 {Array.from(modMetadataMap.values()).filter((m) => m.isClientSide).length} 个为客户端 mod（黄色高亮行），
          建议禁用或移除以避免服务端启动失败。
        </div>
      )}
      {metadataScanned && modMetadataMap.size === 0 && (
        <div className="alert alert-info">
          扫描完成：未识别到任何 mod 元数据（可能 mods/ 目录为空，或 .jar 文件不含标准元数据）。
        </div>
      )}

      {filesLoading ? (
        <ListSkeleton rows={3} columns={4} />
      ) : modFiles.length === 0 ? (
        <div className="empty-state">
          暂无 Mod 文件。点击「扫描 mods/ 目录」加载，或确认实例 mods/ 目录下有 .jar 文件。
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>文件名</th>
              <th>状态</th>
              <th>加载器</th>
              <th>环境</th>
              <th>大小</th>
              <th>修改时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {modFiles.map((modFile) => {
              const meta = modMetadataMap.get(modFile.name);
              const isClientMod = meta?.isClientSide === true;
              return (
                <tr
                  key={modFile.name}
                  style={isClientMod ? { backgroundColor: '#fff3cd' } : undefined}
                >
                  <td>
                    {modFile.name}
                    {meta && meta.name && meta.name !== modFile.name && (
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        {meta.name} {meta.version && `v${meta.version}`}
                      </div>
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${modFile.state === 'enabled' ? 'badge-success' : 'badge-secondary'}`}
                    >
                      {modFile.state === 'enabled' ? '启用' : '禁用'}
                    </span>
                  </td>
                  <td>
                    {meta ? (
                      <span className={`badge ${loaderBadgeClass(meta.loader)}`}>
                        {loaderLabel(meta.loader)}
                      </span>
                    ) : metadataScanned ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className="text-muted">未扫描</span>
                    )}
                  </td>
                  <td>
                    {meta ? (
                      isClientMod ? (
                        <span style={{ color: '#856404', fontWeight: 600 }}>
                          ⚠ 客户端
                        </span>
                      ) : (
                        <span>{environmentLabel(meta.environment)}</span>
                      )
                    ) : metadataScanned ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className="text-muted">未扫描</span>
                    )}
                  </td>
                  <td>{formatBytes(modFile.size)}</td>
                  <td>{modFile.modified_at}</td>
                  <td>
                    {isClientMod && (
                      <div
                        className="text-muted"
                        style={{ fontSize: 11, color: '#856404', marginBottom: 4 }}
                      >
                        客户端 mod，安装到服务端可能导致启动失败
                      </div>
                    )}
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => void handleToggleModFile(modFile)}
                      disabled={togglingFile === modFile.name}
                    >
                      {togglingFile === modFile.name
                        ? '切换中…'
                        : modFile.state === 'enabled'
                          ? '禁用'
                          : '启用'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// L4 辅助：加载器 badge 样式
function loaderBadgeClass(loader: ModMetadata['loader']): string {
  switch (loader) {
    case 'fabric':
      return 'badge-info';
    case 'forge':
      return 'badge-warning';
    case 'neoforge':
      return 'badge-success';
    default:
      return 'badge-secondary';
  }
}

// L4 辅助：加载器中文标签
function loaderLabel(loader: ModMetadata['loader']): string {
  switch (loader) {
    case 'fabric':
      return 'Fabric';
    case 'forge':
      return 'Forge';
    case 'neoforge':
      return 'NeoForge';
    default:
      return '未知';
  }
}

// L4 辅助：运行环境中文标签
function environmentLabel(env: ModMetadata['environment']): string {
  switch (env) {
    case 'client':
      return '客户端';
    case 'server':
      return '服务端';
    case 'both':
      return '通用';
    default:
      return '未知';
  }
}

// 辅助：格式化字节数
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// v4.33.0: 各游戏 mod 机制 UI 配置
interface ModUIConfig {
  showMetadataColumns: boolean;
  showClientModWarning: boolean;
  modsDirLabel: string;
  metadataTooltip: string;
  description: string;
}

function getModUIConfig(gameType?: string): ModUIConfig {
  switch (gameType) {
    case 'minecraft':
      return {
        showMetadataColumns: true,
        showClientModWarning: true,
        modsDirLabel: 'mods/',
        metadataTooltip: '解析 .jar 内的 fabric.mod.json / mods.toml / mcmod.info',
        description: '直接操作 mods/ 目录下的 .jar / .jar.disabled 文件。切换状态会重命名文件（.jar ↔ .jar.disabled），无需重启服务即可生效。\n扫描元数据：解析 .jar 内的 mod 元数据，自动识别客户端 mod（如 OptiFine、光影 mod），避免误装到服务端导致启动失败。',
      };
    case 'factorio':
      return {
        showMetadataColumns: false,
        showClientModWarning: false,
        modsDirLabel: 'mods/',
        metadataTooltip: '解析 .zip 内的 info.json',
        description: 'Factorio 通过 mod-list.json 控制 mod 启停，文件系统管理仅用于查看 mods/ 目录下的 .zip 文件。请在上方 Mod 记录管理中切换启停状态。',
      };
    case 'rust':
      return {
        showMetadataColumns: false,
        showClientModWarning: false,
        modsDirLabel: 'oxide/plugins/',
        metadataTooltip: '扫描 .cs 插件文件',
        description: '直接操作 oxide/plugins/ 目录下的 .cs 插件文件。切换状态会重命名文件（加/去 .disabled 后缀）。',
      };
    case 'valheim':
      return {
        showMetadataColumns: false,
        showClientModWarning: false,
        modsDirLabel: 'BepInEx/plugins/',
        metadataTooltip: '扫描 .dll 插件文件',
        description: '直接操作 BepInEx/plugins/ 目录下的 .dll 插件文件。切换状态会重命名文件（加/去 .disabled 后缀）。',
      };
    case 'palworld':
      return {
        showMetadataColumns: false,
        showClientModWarning: false,
        modsDirLabel: 'Pal/Content/Paks/~mods/',
        metadataTooltip: '扫描 .pak mod 文件',
        description: '直接操作 ~mods/ 目录下的 .pak mod 文件。切换状态会重命名文件（加/去 .disabled 后缀）。',
      };
    case 'terraria':
    case 'terraria-tshock':
      return {
        showMetadataColumns: false,
        showClientModWarning: false,
        modsDirLabel: 'Mods/',
        metadataTooltip: '扫描 .tmod mod 文件',
        description: 'Terraria 通过 enabled.json 控制 mod 启停，文件系统管理仅用于查看 Mods/ 目录下的 .tmod 文件。请在上方 Mod 记录管理中切换启停状态。',
      };
    case 'ark':
    case 'zomboid':
      return {
        showMetadataColumns: false,
        showClientModWarning: false,
        modsDirLabel: '',
        metadataTooltip: 'Steam Workshop mod',
        description: '此游戏通过 Steam Workshop ID 管理 mod，不支持文件系统级 mod 管理。请在上方 Mod 记录管理中添加 Workshop ID。',
      };
    default:
      return {
        showMetadataColumns: true,
        showClientModWarning: true,
        modsDirLabel: 'mods/',
        metadataTooltip: '解析 mod 元数据',
        description: '直接操作 mods/ 目录下的 mod 文件。切换状态会重命名文件（加/去 .disabled 后缀），无需重启服务即可生效。',
      };
  }
}
