// ============================================================================
// ConfigFiles — 配置文件列表页（实例详情子页）
// 左侧：配置文件列表（可点击选中）
// 右侧：选中配置的 ConfigFileEditor
// 无配置文件时显示 empty-state
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type { ConfigFileMeta } from '@public/schema/panel-api-types';
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

export default function ConfigFiles({ serverId }: ConfigFilesPageProps) {
  const { api } = useAuth();

  const [files, setFiles] = useState<ConfigFileMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ConfigFileMeta | null>(null);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listConfigFiles(serverId);
      setFiles(res.config_files);
      setSelected((prev) => {
        // 保持已选中项；若不存在则默认取第一项
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

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">配置文件</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void loadFiles()} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="empty-state">加载中…</div>
      ) : files.length === 0 ? (
        <div className="empty-state">暂无配置文件。</div>
      ) : (
        <div className="detail-grid">
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
                      onClick={() => setSelected(f)}
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

          <div>
            {selected ? (
              <ConfigFileEditor
                serverId={serverId}
                configName={selected.name}
                format={selected.format}
                readOnly={selected.read_only}
              />
            ) : (
              <div className="empty-state">请选择左侧的配置文件。</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
