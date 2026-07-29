// ============================================================================
// VersionInfoModal — v3.5.0: 版本信息弹窗（含更新日志）
// 展示：当前版本 + 从 /api/version/changelog 拉取的版本更新日志列表
// 保留「检查更新」按钮作为兜底（系统层面的自动更新入口）
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Zap } from 'lucide-react';
import { useAuth } from '../api/auth';
import { getVersion } from '../api/client';
import { Modal } from './ui';

interface VersionInfoModalProps {
  open: boolean;
  onClose: () => void;
}

interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  body: string;
}

export default function VersionInfoModal({ open, onClose }: VersionInfoModalProps) {
  const { api } = useAuth();

  const [version, setVersion] = useState<string>('...');
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);
  const [activeEntry, setActiveEntry] = useState<string | null>(null);

  const fetchVersion = useCallback(async () => {
    try {
      const res = await getVersion();
      setVersion(res.version);
    } catch {
      setVersion('unknown');
    }
  }, []);

  const fetchChangelog = useCallback(async () => {
    setLoadingLog(true);
    try {
      const res = await fetch('/api/version/changelog');
      if (res.ok) {
        const data = (await res.json()) as ChangelogEntry[];
        setChangelog(data);
      }
    } catch {
      // 静默失败
    } finally {
      setLoadingLog(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchVersion();
      void fetchChangelog();
    }
  }, [open, fetchVersion, fetchChangelog]);

  const toggleEntry = (v: string) => {
    setActiveEntry((prev) => (prev === v ? null : v));
  };

  // 渲染 markdown 正文为简化的 HTML（仅处理 **bold** / 列表 / 换行）
  const renderBody = (body: string): string => {
    let text = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/`(.+?)`/g, '<code>$1</code>');
    text = text.replace(/^- (.+)$/gm, '• $1');
    text = text.replace(/\n\n/g, '</p><p>');
    text = text.replace(/\n/g, '<br>');
    return `<p>${text}</p>`;
  };

  // 获取版本号的色相（基于 major.minor）
  const getVersionHue = (v: string): number => {
    const parts = v.split('.').map(Number);
    return ((parts[1] ?? 0) * 137 + (parts[2] ?? 0) * 53) % 360;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={null}
    >
      <div className="vmodal">
        {/* 头部：当前版本 */}
        <div className="vmodal-hero">
          <div className="vmodal-hero-badge">
            <Zap size={20} />
            <span>当前版本</span>
          </div>
          <div className="vmodal-hero-version">v{version}</div>
          <p className="vmodal-hero-desc">GameServer Panel 管理系统</p>
        </div>

        {/* 更新日志标题 */}
        <div className="vmodal-section-header">
          <h3>更新日志</h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              void (async () => {
                try {
                  await api.checkSystemUpdate();
                } catch {
                  // endpoint may not exist
                }
              })();
            }}
          >
            <RefreshCw size={14} />
            检查系统更新
          </button>
        </div>

        {/* 更新日志列表 */}
        <div className="vmodal-changelog">
          {loadingLog ? (
            <div className="vmodal-empty">加载更新日志中…</div>
          ) : changelog.length === 0 ? (
            <div className="vmodal-empty">暂无更新日志</div>
          ) : (
            changelog.map((entry) => {
              const hue = getVersionHue(entry.version);
              const isActive = activeEntry === entry.version;
              const isLatest = changelog[0]?.version === entry.version;

              return (
                <div
                  key={entry.version}
                  className={`vmodal-entry${isActive ? ' is-open' : ''}${isLatest ? ' is-latest' : ''}`}
                >
                  <button
                    type="button"
                    className="vmodal-entry-header"
                    onClick={() => toggleEntry(entry.version)}
                    aria-expanded={isActive}
                  >
                    <span
                      className="vmodal-entry-dot"
                      style={{
                        background: `hsl(${hue}, 65%, 55%)`,
                        boxShadow: isLatest ? `0 0 0 3px hsla(${hue}, 65%, 55%, 0.3)` : undefined,
                      }}
                    />
                    <span className="vmodal-entry-version">v{entry.version}</span>
                    {isLatest && <span className="vmodal-entry-tag">最新</span>}
                    <span className="vmodal-entry-title">{entry.title}</span>
                    <span className="vmodal-entry-date">{entry.date}</span>
                    <span className={`vmodal-entry-chevron${isActive ? ' open' : ''}`}>▾</span>
                  </button>
                  {isActive && (
                    <div
                      className="vmodal-entry-body"
                      dangerouslySetInnerHTML={{ __html: renderBody(entry.body) }}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
}
