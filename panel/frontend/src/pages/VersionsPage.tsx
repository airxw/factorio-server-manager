// ============================================================================
// v3.5.0: VersionsPage — 版本池管理页面
// 支持：查看远程可用版本列表、选择指定版本下载、下载最新版本
// v3.6.0: 已下载版本表格新增"大小"+"引用数"+"操作"列 + 删除确认对话框
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Package, RefreshCw, Trash2 } from 'lucide-react';
import type { AvailableVersionEntry, GameVersionSummary, PackSummary } from '@public/schema/panel-api-types';
import { useAuth } from '../api/auth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useConfirm } from '../context/ConfirmContext';
import { ListSkeleton } from '../components/ui';
import { formatBytes } from '../utils/formatBytes';
import {
  WorkbenchShell,
  WorkbenchHeader,
  WorkbenchSection,
  WorkbenchFilterBar,
  WorkbenchSelect,
  WorkbenchPrimaryButton,
  WorkbenchSecondaryButton,
  WorkbenchIconButton,
  WorkbenchNote,
  WorkbenchStatusBadge,
  WorkbenchTableWrap,
  WorkbenchEmpty,
} from './store/components/WorkbenchUI';

export default function VersionsPage() {
  const { api } = useAuth();
  const { confirm } = useConfirm();
  useDocumentTitle('版本管理');

  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [selectedPackId, setSelectedPackId] = useState('');
  const [versions, setVersions] = useState<GameVersionSummary[]>([]);
  const [availableVersions, setAvailableVersions] = useState<AvailableVersionEntry[]>([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [loadingPacks, setLoadingPacks] = useState(true);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadPhase, setDownloadPhase] = useState('');
  // v3.6.0: 删除版本状态
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  const refreshPacks = useCallback(async () => {
    setLoadingPacks(true);
    try {
      const res = await api.listPacks();
      setPacks(res.packs);
      if (res.packs.length > 0 && !selectedPackId) {
        setSelectedPackId(res.packs[0].id);
      }
    } catch {
      setError('加载 Pack 列表失败');
    } finally {
      setLoadingPacks(false);
    }
  }, [api]);

  const refreshVersions = useCallback(async () => {
    if (!selectedPackId) return;
    setLoadingVersions(true);
    setError(null);
    try {
      const res = await api.listVersions(selectedPackId);
      setVersions(res.versions);
    } catch {
      setError('加载版本列表失败');
    } finally {
      setLoadingVersions(false);
    }
  }, [api, selectedPackId]);

  const refreshAvailable = useCallback(async () => {
    if (!selectedPackId) return;
    setLoadingAvailable(true);
    setError(null);
    try {
      const res = await api.fetchAvailableVersions(selectedPackId);
      setAvailableVersions(res.versions);
      // 自动选中最新未下载版本
      if (!selectedVersion || !res.versions.find((v: AvailableVersionEntry) => v.version === selectedVersion)) {
        const firstUndownloaded = res.versions.find((v: AvailableVersionEntry) => !v.downloaded);
        setSelectedVersion(firstUndownloaded?.version ?? res.versions[0]?.version ?? '');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取可用版本列表失败');
    } finally {
      setLoadingAvailable(false);
    }
  }, [api, selectedPackId]);

  useEffect(() => {
    void refreshPacks();
  }, [refreshPacks]);

  useEffect(() => {
    void refreshVersions();
    void refreshAvailable();
  }, [refreshVersions, refreshAvailable]);

  // 切换 Pack 时清除已选版本
  useEffect(() => {
    setSelectedVersion('');
  }, [selectedPackId]);

  const handleDownload = async (packId: string, version?: string) => {
    setDownloading(true);
    setDownloadMsg('正在启动下载...');
    setDownloadProgress(0);
    setDownloadPhase('queued');
    setError(null);
    try {
      const res = await api.downloadVersion(packId, version);
      setDownloadMsg(res.message);
      // 轮询进度
      const poll = setInterval(async () => {
        try {
          const prog = await api.getVersionDownloadProgress(packId, res.task_id);
          setDownloadMsg(prog.message);
          setDownloadProgress(prog.progress_percent);
          setDownloadPhase(prog.phase);
          if (prog.phase === 'completed') {
            clearInterval(poll);
            setDownloadMsg(version ? `版本 ${version} 下载完成！` : '下载完成！');
            setDownloadProgress(100);
            setDownloading(false);
            void refreshVersions();
            void refreshAvailable();
          } else if (prog.phase === 'failed') {
            clearInterval(poll);
            setError(prog.error ?? '下载失败');
            setDownloading(false);
          }
        } catch {
          // 轮询失败不中断
        }
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '下载失败');
      setDownloading(false);
    }
  };

  // v3.6.0-D2: 删除版本（带确认对话框 + 引用检查）
  const handleDelete = async (packId: string, version: GameVersionSummary) => {
    // 被实例引用时禁止删除
    if (version.reference_count > 0) {
      setError(`版本 ${version.version} 仍被 ${version.reference_count} 个实例引用，无法删除`);
      return;
    }

    // 二次确认
    const sizeText = version.file_size_bytes ? `（占用 ${formatBytes(version.file_size_bytes)}）` : '';
    const ok = await confirm({
      title: '删除版本',
      message: `确定删除版本 ${version.version}？${sizeText}\n此操作会同时删除磁盘上的版本文件，不可恢复。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;

    setDeletingId(version.id);
    setError(null);
    setDeleteMsg(null);
    try {
      const res = await api.deleteVersion(packId, version.id);
      if (res.deleted) {
        const freedText = res.freed_bytes != null ? `，释放 ${formatBytes(res.freed_bytes)}` : '';
        setDeleteMsg(`版本 ${version.version} 已删除${freedText}`);
        void refreshVersions();
        void refreshAvailable();
      } else {
        setError('删除失败：版本不存在或已被删除');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <WorkbenchShell>
      <WorkbenchHeader
        eyebrow="GM Workbench · Versions"
        title="版本管理"
        description="查看远程可用版本、下载新版本，并维护本地已下载版本池。被实例引用的版本不可删除。"
        actions={
          <WorkbenchSecondaryButton
            icon={RefreshCw}
            onClick={() => {
              void refreshVersions();
              void refreshAvailable();
            }}
            disabled={loadingVersions || loadingAvailable}
          >
            刷新
          </WorkbenchSecondaryButton>
        }
      />

      {error && (
        <WorkbenchNote tone="rose" icon={AlertTriangle}>
          {error}
        </WorkbenchNote>
      )}

      {/* 下载进度条 */}
      {downloading && (
        <div className="rounded-[22px] border border-slate-200/80 bg-white/92 px-5 py-4 shadow-[0_18px_46px_-36px_rgba(15,23,42,0.34)]">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-700">{downloadMsg}</span>
            <span className="tabular-nums text-slate-500">{Math.round(downloadProgress)}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all ${
                downloadPhase === 'failed'
                  ? 'bg-rose-500'
                  : downloadPhase === 'completed'
                    ? 'bg-emerald-500'
                    : 'bg-[#007AFF]'
              }`}
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 ring-1 ${
                downloadPhase === 'failed'
                  ? 'bg-rose-50 text-rose-700 ring-rose-100'
                  : downloadPhase === 'completed'
                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
                    : 'bg-blue-50 text-blue-700 ring-blue-100'
              }`}
            >
              {downloadPhase === 'queued'
                ? '排队中'
                : downloadPhase === 'checking'
                  ? '检查中'
                  : downloadPhase === 'downloading'
                    ? '下载中'
                    : downloadPhase === 'completed'
                      ? '已完成'
                      : downloadPhase === 'failed'
                        ? '失败'
                        : downloadPhase}
            </span>
          </div>
        </div>
      )}

      {/* 下载完成/提示消息（非下载中时显示） */}
      {downloadMsg && !downloading && !error && (
        <WorkbenchNote tone="emerald" icon={CheckCircle2}>
          {downloadMsg}
        </WorkbenchNote>
      )}

      {/* v3.6.0: 删除版本结果提示 */}
      {deleteMsg && !error && (
        <WorkbenchNote tone="emerald" icon={CheckCircle2}>
          {deleteMsg}
        </WorkbenchNote>
      )}

      {/* Pack 选择 */}
      <WorkbenchFilterBar>
        <span className="text-xs font-medium text-slate-500">选择 Pack</span>
        {loadingPacks ? (
          <span className="text-xs text-slate-400">加载中…</span>
        ) : (
          <WorkbenchSelect
            aria-label="选择 Pack"
            value={selectedPackId}
            onChange={(e) => setSelectedPackId(e.target.value)}
          >
            {packs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name} ({p.id})
              </option>
            ))}
          </WorkbenchSelect>
        )}
      </WorkbenchFilterBar>

      {/* 远程可用版本列表 + 下载操作 */}
      <WorkbenchSection
        title="远程可用版本"
        description="从 Pack 配置的版本源拉取，点击单选选择目标版本后下载。"
        icon={Download}
      >
        {loadingAvailable ? (
          <WorkbenchEmpty
            title="正在加载"
            description="正在从远程源获取版本列表…"
            icon={Package}
            tone="blue"
          />
        ) : availableVersions.length === 0 ? (
          <WorkbenchEmpty
            title="暂无远程版本"
            description="无法获取远程版本列表，请检查 Pack 版本源配置"
            icon={Package}
            tone="slate"
          />
        ) : (
          <>
            <WorkbenchTableWrap>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}></th>
                    <th>版本号</th>
                    <th>类型</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {availableVersions.map((v) => (
                    <tr
                      key={v.version}
                      className={selectedVersion === v.version ? 'row-selected' : undefined}
                      style={{ cursor: 'pointer', opacity: v.downloaded ? 0.6 : 1 }}
                      onClick={() => setSelectedVersion(v.version)}
                    >
                      <td>
                        <input
                          type="radio"
                          name="available-version"
                          checked={selectedVersion === v.version}
                          onChange={() => setSelectedVersion(v.version)}
                        />
                      </td>
                      <td className="mono">{v.version}</td>
                      <td>{v.type ?? '-'}</td>
                      <td>
                        {v.downloaded ? (
                          <WorkbenchStatusBadge label="已下载" tone="emerald" />
                        ) : (
                          <WorkbenchStatusBadge label="未下载" tone="slate" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </WorkbenchTableWrap>
            <div className="mt-4 flex flex-wrap gap-2">
              <WorkbenchPrimaryButton
                icon={Download}
                onClick={() => void handleDownload(selectedPackId, selectedVersion || undefined)}
                disabled={!selectedPackId || !selectedVersion || downloading}
              >
                {downloading && selectedVersion
                  ? '下载中…'
                  : `下载选中版本${selectedVersion ? ` (${selectedVersion})` : ''}`}
              </WorkbenchPrimaryButton>
              <WorkbenchSecondaryButton
                onClick={() => void handleDownload(selectedPackId)}
                disabled={!selectedPackId || downloading}
              >
                {downloading && !selectedVersion ? '下载中…' : '下载最新版本'}
              </WorkbenchSecondaryButton>
            </div>
          </>
        )}
      </WorkbenchSection>

      {/* 已下载版本列表 */}
      <WorkbenchSection
        title="已下载版本"
        description="本地版本池中已下载的版本。被实例引用的版本禁止删除，需先解除引用。"
        icon={Package}
        action={
          versions.length > 0 && (() => {
            const totalBytes = versions.reduce((sum, v) => sum + (v.file_size_bytes ?? 0), 0);
            return (
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
                {versions.length} 个版本 · 合计 {formatBytes(totalBytes)}
              </span>
            );
          })()
        }
      >
        {loadingVersions ? (
          <ListSkeleton rows={5} columns={6} />
        ) : versions.length === 0 ? (
          <WorkbenchEmpty
            title="暂无已下载版本"
            description="该 Pack 还没有本地版本，请先从远程下载。"
            icon={Package}
            tone="slate"
          />
        ) : (
          <WorkbenchTableWrap>
            <table className="data-table">
              <thead>
                <tr>
                  <th>版本</th>
                  <th>大小</th>
                  <th>引用数</th>
                  <th>下载者</th>
                  <th>下载时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => {
                  const referenced = v.reference_count > 0;
                  const isDeleting = deletingId === v.id;
                  return (
                    <tr key={v.id}>
                      <td className="mono">{v.version}</td>
                      <td>{formatBytes(v.file_size_bytes)}</td>
                      <td>
                        {referenced ? (
                          <WorkbenchStatusBadge label={`${v.reference_count}`} tone="amber" />
                        ) : (
                          <WorkbenchStatusBadge label="0" tone="slate" />
                        )}
                      </td>
                      <td>{v.downloaded_by_username}</td>
                      <td className="mono">{new Date(v.downloaded_at).toLocaleString('zh-CN')}</td>
                      <td>
                        <WorkbenchIconButton
                          icon={Trash2}
                          label={
                            referenced
                              ? `被 ${v.reference_count} 个实例引用，无法删除`
                              : isDeleting
                                ? '删除中…'
                                : `删除版本 ${v.version}`
                          }
                          tone="rose"
                          onClick={() => void handleDelete(selectedPackId, v)}
                          disabled={referenced || isDeleting || downloading}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </WorkbenchTableWrap>
        )}
      </WorkbenchSection>
    </WorkbenchShell>
  );
}
