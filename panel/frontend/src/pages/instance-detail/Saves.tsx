// ============================================================================
// Saves — 存档管理页（实例详情子页）
// 功能：列出存档、创建存档、激活存档、删除存档
// 契约：public/schema/panel-api-types.ts -> SaveRecordSummary / CreateSaveRequest
// 注意：契约字段为 size_bytes / modified_at（非 file_size / updated_at）；
//       CreateSaveRequest 额外要求 file_path / size_bytes / modified_at 必填，
//       UI 仅暴露 save_name 与 is_active，其余字段以占位默认值提交。
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreateSaveRequest, SaveRecordSummary } from '@public/schema/panel-api-types';
import { useAuth } from '../../api/auth';

export interface SavesPageProps {
  serverId: string;
}

/** 将字节数格式化为可读字符串 */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

/** 将 ISO 时间字符串格式化为本地可读时间 */
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function Saves({ serverId }: SavesPageProps) {
  const { api } = useAuth();

  const [saves, setSaves] = useState<SaveRecordSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // 创建表单字段
  const [saveName, setSaveName] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 存档文件上传
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listSaves(serverId);
      setSaves(res.saves);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载存档列表失败');
    } finally {
      setLoading(false);
    }
  }, [api, serverId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetForm = () => {
    setSaveName('');
    setIsActive(false);
  };

  const handleCreate = async () => {
    const name = saveName.trim();
    if (!name) {
      setError('请填写存档名称');
      return;
    }
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const req: CreateSaveRequest = {
        save_name: name,
        file_path: `saves/${name}.zip`,
        size_bytes: 0,
        modified_at: new Date().toISOString(),
        is_active: isActive,
      };
      await api.createSave(serverId, req);
      setSuccess(`已创建存档：${name}`);
      resetForm();
      setShowForm(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建存档失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivate = async (save: SaveRecordSummary) => {
    setError(null);
    setSuccess(null);
    try {
      const res = await api.activateSave(serverId, save.id);
      // 激活后：返回的存档设为 active，其余存档全部置为非 active
      setSaves((prev) =>
        prev.map((s) => (s.id === res.save.id ? res.save : { ...s, is_active: false })),
      );
      setSuccess(`已激活存档：${save.save_name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '激活存档失败');
    }
  };

  const handleDelete = async (save: SaveRecordSummary) => {
    if (!window.confirm(`确认删除存档「${save.save_name}」？此操作不可撤销。`)) {
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      await api.deleteSave(serverId, save.id);
      setSaves((prev) => prev.filter((s) => s.id !== save.id));
      setSuccess(`已删除存档：${save.save_name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除存档失败');
    }
  };

  // 上传存档文件到 saves/ 目录
  const handleUploadSave = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setError(null);
    setSuccess(null);
    setUploading(true);
    setUploadProgress('上传中…');
    try {
      const targetPath = `saves/${file.name}`;
      await api.uploadFile(serverId, file, targetPath, (current, total) => {
        setUploadProgress(`上传中… ${current}/${total} 片`);
      });
      setSuccess(`已上传存档文件：${file.name}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传存档文件失败');
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">存档管理</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            onChange={(e) => void handleUploadSave(e)}
            style={{ display: 'none' }}
          />
          <button
            className="btn btn-success"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? uploadProgress || '上传中…' : '上传存档'}
          </button>
          <button className="btn btn-success" onClick={() => setShowForm((v) => !v)}>
            {showForm ? '收起表单' : '创建存档'}
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
            <label htmlFor="save-name">存档名称 *</label>
            <input
              id="save-name"
              className="form-control"
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="例如：_autosave1"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="save-active">
              <input
                id="save-active"
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />{' '}
              创建后立即激活
            </label>
          </div>
          <div className="page-actions">
            <button type="submit" className="btn btn-success" disabled={submitting}>
              {submitting ? '提交中…' : '确认创建'}
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
        <div className="empty-state">加载中…</div>
      ) : saves.length === 0 ? (
        <div className="empty-state">暂无存档记录。点击「创建存档」新增。</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>存档名称</th>
              <th>状态</th>
              <th>文件大小</th>
              <th>修改时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {saves.map((save) => (
              <tr key={save.id}>
                <td>{save.save_name}</td>
                <td>
                  {save.is_active ? (
                    <span className="badge badge-running">活跃</span>
                  ) : (
                    <span className="badge badge-stopped">闲置</span>
                  )}
                </td>
                <td>{formatBytes(save.size_bytes)}</td>
                <td>{formatTime(save.modified_at)}</td>
                <td>
                  <button
                    className="btn btn-sm btn-warning"
                    onClick={() => void handleActivate(save)}
                    disabled={save.is_active}
                  >
                    {save.is_active ? '已激活' : '激活'}
                  </button>{' '}
                  <button className="btn btn-sm btn-danger" onClick={() => void handleDelete(save)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
