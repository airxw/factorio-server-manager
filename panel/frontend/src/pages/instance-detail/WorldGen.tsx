// ============================================================================
// WorldGen — 地图生成设置页（实例详情子页）
// 顶部：重新生成地图（输入 save_name，调用 regenerateMap）
// 下方：每个 settings_file 用一个 ConfigFileEditor 渲染（format 从 schema 获取，默认 json）
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type { WorldGenSettingsFileMeta } from '@public/schema/panel-api-types';
import { useAuth } from '../../api/auth';
import ConfigFileEditor, { type ConfigFileFormat } from '../../components/ConfigFileEditor';

export interface WorldGenPageProps {
  serverId: string;
}

const VALID_FORMATS: string[] = ['json', 'yaml', 'properties', 'ini'];

/** 将 schema 返回的 string 类型 format 收窄为 ConfigFileFormat，非法值回落到 json */
function normalizeFormat(fmt: string): ConfigFileFormat {
  return VALID_FORMATS.includes(fmt) ? (fmt as ConfigFileFormat) : 'json';
}

export default function WorldGen({ serverId }: WorldGenPageProps) {
  const { api } = useAuth();

  const [settingsFiles, setSettingsFiles] = useState<WorldGenSettingsFileMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [saveName, setSaveName] = useState('');
  const [regenerating, setRegenerating] = useState(false);

  const loadSchema = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMapSettingsSchema(serverId);
      setSettingsFiles(res.settings_files);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载地图设置失败');
      setSettingsFiles([]);
    } finally {
      setLoading(false);
    }
  }, [api, serverId]);

  useEffect(() => {
    void loadSchema();
  }, [loadSchema]);

  const handleRegenerate = async () => {
    const name = saveName.trim();
    if (!name) {
      setError('请填写存档名称');
      return;
    }
    setError(null);
    setSuccess(null);
    setRegenerating(true);
    try {
      const res = await api.regenerateMap(serverId, name);
      if (res.regenerated) {
        setSuccess(`已重新生成地图：${name}`);
      } else {
        setError('后端未触发重新生成（regenerated=false）');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '重新生成地图失败');
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">地图生成设置</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void loadSchema()} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-info">{success}</div>}

      <form
        className="form-card"
        onSubmit={(e) => {
          e.preventDefault();
          void handleRegenerate();
        }}
      >
        <h3 className="card-title">重新生成地图</h3>
        <div className="form-row">
          <label className="form-field">
            <span className="form-label">存档名称 *</span>
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="例如：_autosave1"
              required
            />
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-warning" disabled={regenerating}>
            {regenerating ? '生成中…' : '重新生成地图'}
          </button>
        </div>
      </form>

      {loading ? (
        <div className="empty-state">加载中…</div>
      ) : settingsFiles.length === 0 ? (
        <div className="empty-state">暂无地图设置文件。</div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            marginTop: 16,
          }}
        >
          {settingsFiles.map((sf) => (
            <ConfigFileEditor
              key={sf.name}
              serverId={serverId}
              configName={sf.name}
              format={normalizeFormat(sf.format)}
              readOnly={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
