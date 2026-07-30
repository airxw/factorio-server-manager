// ============================================================================
// ConfigFiles — 配置文件列表页（实例详情子页）
// v4.x 两层 drill-down 结构：
//   列表视图：配置文件表格 + 新增按钮
//   编辑视图：点击进入全宽 ConfigFileEditor，顶部「← 返回」按钮
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type { ConfigFileMeta, CreateConfigFileRequest } from '@public/schema/panel-api-types';
import { useAuth } from '../../api/auth';
import ConfigFileEditor from '../../components/ConfigFileEditor';

export interface ConfigFilesPageProps {
  serverId: string;
}

// 常见配置文件名中文映射（降级方案：API 不返回 description 时使用）
const CONFIG_FILE_NAME_ZH: Record<string, string> = {
  'palworld-settings': '帕鲁世界设置',
  'server-auto-cfg': '服务器自动配置',
  'game-user-settings': '游戏用户设置',
  'server-settings': '服务器设置',
  'server-properties': '服务器属性',
};

/** 获取配置文件的中文名称，未命中映射时返回原始 name */
function getConfigDisplayName(name: string): string {
  return CONFIG_FILE_NAME_ZH[name] ?? name;
}

type View = 'list' | 'editor';

export default function ConfigFiles({ serverId }: ConfigFilesPageProps) {
  const { api } = useAuth();

  // ---- 列表数据 ----
  const [files, setFiles] = useState<ConfigFileMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- 视图状态 ----
  const [view, setView] = useState<View>('list');
  const [selected, setSelected] = useState<ConfigFileMeta | null>(null);

  // ---- 新增对话框 ----
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newFormat, setNewFormat] = useState<'json' | 'yaml' | 'properties' | 'ini'>('json');
  const [newContent, setNewContent] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listConfigFiles(serverId);
      // 合并 Pack 声明 + 用户自定义（后端返回同一列表）
      setFiles(res.config_files);
      setSelected((prev) => {
        if (prev && res.config_files.some((f) => f.name === prev.name)) {
          return prev;
        }
        return res.config_files[0] ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载配置文件列表失败');
      setFiles([]);
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }, [api, serverId]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  // ---- 进入编辑器 ----
  const handleSelect = (f: ConfigFileMeta) => {
    setSelected(f);
    setView('editor');
  };

  // ---- 返回列表 ----
  const handleBack = () => {
    setView('list');
  };

  // ---- 新增 ----
  const handleCreate = async () => {
    setCreateError(null);
    if (!newName.trim()) {
      setCreateError('请输入文件名');
      return;
    }
    setCreating(true);
    try {
      const req: CreateConfigFileRequest = {
        name: newName.trim(),
        format: newFormat,
      };
      if (newContent.trim()) {
        req.content = newContent.trim();
      }
      await api.createConfigFile(serverId, req);
      // 关闭对话框并刷新列表
      setShowCreate(false);
      setNewName('');
      setNewContent('');
      setNewFormat('json');
      await loadFiles();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const openCreate = () => {
    setNewName('');
    setNewContent('');
    setNewFormat('json');
    setCreateError(null);
    setShowCreate(true);
  };

  // ======================== 渲染 ========================

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">配置文件</h2>
        <div className="page-actions">
          {view === 'editor' ? (
            <button className="btn btn-ghost" onClick={handleBack}>
              ← 返回文件列表
            </button>
          ) : (
            <>
              <button className="btn btn-primary" onClick={openCreate}>
                新增配置文件
              </button>
              <button className="btn btn-ghost" onClick={() => void loadFiles()} disabled={loading}>
                刷新
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="empty-state">加载中…</div>
      ) : files.length === 0 ? (
        <div className="empty-state">
          <p>暂无配置文件。</p>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={openCreate}>
            新增配置文件
          </button>
        </div>
      ) : view === 'editor' && selected ? (
        /* ---- 编辑器视图 ---- */
        <ConfigFileEditor
          serverId={serverId}
          configName={selected.name}
          format={selected.format}
          readOnly={selected.read_only}
        />
      ) : (
        /* ---- 列表视图 ---- */
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>文件名</th>
                <th>说明</th>
                <th>格式</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => {
                const active = selected?.name === f.name;
                return (
                  <tr
                    key={f.name}
                    onClick={() => handleSelect(f)}
                    style={{
                      cursor: 'pointer',
                      background: active ? '#eff6ff' : undefined,
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    <td className="mono">
                      {f.name}
                      {f.read_only && (
                        <span className="badge badge-starting" style={{ marginLeft: 6 }}>
                          只读
                        </span>
                      )}
                    </td>
                    <td>{getConfigDisplayName(f.name)}</td>
                    <td>{f.format}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- 新增对话框 ---- */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>新增配置文件</h3>
              <button
                className="btn btn-ghost"
                onClick={() => setShowCreate(false)}
                style={{ padding: '4px 8px' }}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              {createError && <div className="alert alert-error">{createError}</div>}

              <div className="form-field">
                <label className="form-label">文件名（不含扩展名）</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例如 my-config"
                  autoFocus
                />
              </div>

              <div className="form-field">
                <label className="form-label">格式</label>
                <select value={newFormat} onChange={(e) => setNewFormat(e.target.value as typeof newFormat)}>
                  <option value="json">JSON</option>
                  <option value="yaml">YAML</option>
                  <option value="properties">Properties</option>
                  <option value="ini">INI</option>
                </select>
              </div>

              <div className="form-field">
                <label className="form-label">初始内容（可选）</label>
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder={newFormat === 'json' || newFormat === 'yaml' ? '{}' : ''}
                  rows={6}
                  style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13 }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={() => void handleCreate()} disabled={creating}>
                {creating ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
