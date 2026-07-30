// ============================================================================
// StartOptionsModal — 启动前选项弹窗
// 功能：启动实例前选择存档（可选），让用户指定本次启动加载哪个存档文件。
// 用于支持 Factorio 等游戏在启动时选择存档的场景。
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type { SaveRecordSummary } from '@public/schema/panel-api-types';
import { useAuth } from '../../api/auth';

export interface StartOptionsModalProps {
  open: boolean;
  serverId: string;
  /** 确认启动，传入选中的存档路径（未选时为 undefined，使用默认存档） */
  onConfirm: (savePath?: string) => void;
  onCancel: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function StartOptionsModal({
  open,
  serverId,
  onConfirm,
  onCancel,
}: StartOptionsModalProps) {
  const { api } = useAuth();
  const [saves, setSaves] = useState<SaveRecordSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSavePath, setSelectedSavePath] = useState<string | undefined>(undefined);
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(async () => {
    if (!serverId) return;
    setLoading(true);
    try {
      const res = await api.listSaves(serverId);
      setSaves(res.saves);
      // 默认选中活跃存档
      const active = res.saves.find((s) => s.is_active);
      setSelectedSavePath(active?.file_path);
    } catch {
      // 加载存档失败不阻断启动（用户可直接点"直接启动"）
      setSaves([]);
    } finally {
      setLoading(false);
    }
  }, [api, serverId]);

  useEffect(() => {
    if (open) {
      void refresh();
    }
  }, [open, refresh]);

  const handleConfirm = () => {
    setStarting(true);
    onConfirm(selectedSavePath);
  };

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-options-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !starting) onCancel();
      }}
    >
      <div className="modal-content" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h3 id="start-options-title" className="modal-title">
            启动实例
          </h3>
          <button
            type="button"
            className="btn btn-ghost btn-icon-only"
            onClick={onCancel}
            disabled={starting}
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="form-hint" style={{ marginBottom: 12 }}>
            选择本次启动加载的存档（可选）。不选则使用默认存档。
          </p>

          {loading ? (
            <div className="empty-state">加载存档列表中…</div>
          ) : saves.length === 0 ? (
            <div className="empty-state">
              暂无存档记录。可直接启动，游戏将生成新世界或使用默认存档。
            </div>
          ) : (
            <div style={{ maxHeight: 320, overflowY: 'auto', borderRadius: 8 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--color-border, #e2e8f0)',
                }}
              >
                <input
                  type="radio"
                  name="save-select"
                  checked={selectedSavePath === undefined}
                  onChange={() => setSelectedSavePath(undefined)}
                />
                <span>
                  <strong>默认存档</strong>
                  <span className="info-hint" style={{ marginLeft: 8 }}>
                    使用游戏默认行为
                  </span>
                </span>
              </label>
              {saves.map((save) => (
                <label
                  key={save.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--color-border, #e2e8f0)',
                  }}
                >
                  <input
                    type="radio"
                    name="save-select"
                    checked={selectedSavePath === save.file_path}
                    onChange={() => setSelectedSavePath(save.file_path)}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="mono">{save.save_name}</span>
                    {save.is_active && (
                      <span className="badge badge-running" style={{ marginLeft: 8 }}>
                        活跃
                      </span>
                    )}
                    <span className="info-hint" style={{ marginLeft: 8 }}>
                      {formatBytes(save.size_bytes)} · {formatTime(save.modified_at)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={starting}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-success"
            onClick={handleConfirm}
            disabled={starting || loading}
          >
            {starting ? '启动中…' : '启动'}
          </button>
        </div>
      </div>
    </div>
  );
}
