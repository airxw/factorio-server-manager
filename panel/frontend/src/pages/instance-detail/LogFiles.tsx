// ============================================================================
// LogFiles — 实例日志文件管理（实例详情子页）
// 功能：
//   - 列出实例所有日志文件（含 server.log 与 server.log.1 ~ server.log.5）
//   - 点击文件名查看最后 N 行（默认 200）
//   - 删除备份文件（server.log.N，不允许删除当前 server.log）
// 契约：public/schema/panel-api-types.ts -> LogFileInfo / ReadLogFileResponse
// API：
//   api.listLogFiles(serverId) -> { files: LogFileInfo[] }
//   api.readLogFile(serverId, filename, count?) -> { filename, lines }
//   api.deleteLogFile(serverId, filename) -> void
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type { LogFileInfo } from '@public/schema/panel-api-types';
import { useAuth } from '../../api/auth';
import { ListSkeleton } from '../../components/ui';

export interface LogFilesPageProps {
  serverId: string;
}

const DEFAULT_READ_COUNT = 200;

/** 将字节大小格式化为可读字符串 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** 将 ISO 时间字符串格式化为本地可读时间 */
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** 当前日志文件名（不允许删除） */
const CURRENT_LOG = 'server.log';

export default function LogFiles({ serverId }: LogFilesPageProps) {
  const { api } = useAuth();

  const [files, setFiles] = useState<LogFileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 当前查看的文件
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [readCount, setReadCount] = useState<number>(DEFAULT_READ_COUNT);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listLogFiles(serverId);
      setFiles(res.files);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载日志文件列表失败');
    } finally {
      setLoading(false);
    }
  }, [api, serverId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 读取指定日志文件
  const handleRead = useCallback(
    async (filename: string, count: number) => {
      setSelectedFile(filename);
      setReading(true);
      setReadError(null);
      try {
        const res = await api.readLogFile(serverId, filename, count);
        setLines(res.lines);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '读取日志文件失败';
        setReadError(msg);
        setLines([]);
      } finally {
        setReading(false);
      }
    },
    [api, serverId],
  );

  // 删除日志备份文件
  const handleDelete = async (filename: string) => {
    if (filename === CURRENT_LOG) {
      setError('当前写入的日志文件不允许删除');
      return;
    }
    if (!window.confirm(`确认删除日志备份文件 ${filename}？此操作不可撤销。`)) {
      return;
    }
    setError(null);
    try {
      await api.deleteLogFile(serverId, filename);
      // 删除成功后刷新列表；若被删除的是当前查看的文件，清空查看区
      if (selectedFile === filename) {
        setSelectedFile(null);
        setLines([]);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除日志文件失败');
    }
  };

  // 重新读取（用户修改行数后点击）
  const handleReread = () => {
    if (selectedFile) {
      void handleRead(selectedFile, readCount);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">日志文件管理</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <ListSkeleton rows={4} columns={3} />
      ) : files.length === 0 ? (
        <div className="empty-state">暂无日志文件。</div>
      ) : (
        <div>
          {/* 文件列表 */}
          <table className="data-table" style={{ marginBottom: 16 }}>
            <thead>
              <tr>
                <th>文件名</th>
                <th>大小</th>
                <th>修改时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => {
                const isCurrent = f.filename === CURRENT_LOG;
                const isSelected = selectedFile === f.filename;
                return (
                  <tr key={f.filename}>
                    <td>
                      <button
                        type="button"
                        className="btn btn-link"
                        style={{
                          padding: 0,
                          border: 'none',
                          background: 'transparent',
                          color: isSelected ? '#1976d2' : 'inherit',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                        onClick={() => void handleRead(f.filename, readCount)}
                        disabled={reading}
                      >
                        {f.filename}
                        {isCurrent && ' (当前)'}
                      </button>
                    </td>
                    <td>{formatSize(f.size)}</td>
                    <td>{formatTime(f.mtime)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => void handleDelete(f.filename)}
                        disabled={isCurrent}
                        title={isCurrent ? '当前写入的日志文件不允许删除' : '删除此备份文件'}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* 文件内容查看器 */}
          <div>
            {!selectedFile ? (
              <div className="empty-state">点击上方文件名查看内容。</div>
            ) : (
              <div className="console-card" style={{ padding: 12 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                    marginBottom: 8,
                  }}
                >
                  <strong>查看：{selectedFile}</strong>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 13,
                    }}
                  >
                    读取最后
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={readCount}
                      onChange={(e) => setReadCount(Number(e.target.value) || DEFAULT_READ_COUNT)}
                      style={{ width: 80 }}
                    />
                    行
                  </label>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={handleReread}
                    disabled={reading}
                  >
                    重新读取
                  </button>
                </div>

                {readError && <div className="alert alert-error">{readError}</div>}

                {reading ? (
                  <div className="empty-state">读取中…</div>
                ) : lines.length === 0 ? (
                  <div className="empty-state">文件为空。</div>
                ) : (
                  <pre
                    style={{
                      maxHeight: '60vh',
                      overflow: 'auto',
                      background: '#1e1e1e',
                      color: '#e0e0e0',
                      padding: 12,
                      borderRadius: 4,
                      fontSize: 12,
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      margin: 0,
                    }}
                  >
                    {lines.join('\n')}
                  </pre>
                )}

                <div
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: '#666',
                  }}
                >
                  共 {lines.length} 行
                  {lines.length > 0 && selectedFile !== CURRENT_LOG && (
                    <span>（已显示最后 {lines.length} 行）</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
