// ============================================================================
// JavaInstallationsPanel — Java 安装扫描展示（I4，v4.4.0-M1）
// 数据源：api.scanNodeJavas(nodeId) → ScanJavasResult
// 展示：扫描到的所有 Java 安装表格 + 重新扫描按钮 + 扫描元信息
// 空状态：未检测到 Java 运行时，请先安装 JDK
// 契约：public/schema/daemon-api-types.ts → JavaInstallation / ScanJavasResult
// ============================================================================

import { useCallback, useState } from 'react';
import { Coffee, RefreshCw } from 'lucide-react';
import type { JavaInstallation, ScanJavasResult } from '@public/schema/daemon-api-types';
import { EmptyState, LoadingButton } from './ui';

interface JavaInstallationsPanelProps {
  /** 已加载的扫描结果（由父组件持有，避免重复拉取） */
  result: ScanJavasResult | null;
  /** 是否正在加载 */
  loading: boolean;
  /** 重新扫描回调（由父组件实现，调用 api.scanNodeJavas） */
  onRescan: () => void;
}

/** JDK / JRE 徽章 */
function JdkBadge({ isJdk }: { isJdk: boolean }) {
  if (isJdk) {
    return (
      <span
        className="badge badge-running"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}
      >
        JDK
      </span>
    );
  }
  return (
    <span
      className="badge badge-stopped"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}
    >
      JRE
    </span>
  );
}

/** 主版本号映射到 Minecraft 推荐档位（仅作辅助提示，不阻塞） */
function versionHint(version: number): string {
  if (version >= 21) return 'Minecraft 1.20.5+';
  if (version >= 17) return 'Minecraft 1.18+';
  if (version >= 11) return 'Minecraft 1.17';
  if (version >= 8) return 'Minecraft 1.16 及以下';
  return '过旧';
}

export default function JavaInstallationsPanel({
  result,
  loading,
  onRescan,
}: JavaInstallationsPanelProps) {
  const [rescanning, setRescanning] = useState(false);

  const handleRescan = useCallback(async () => {
    setRescanning(true);
    try {
      // 父组件的 onRescan 是同步触发器（其内部走 await），此处仅负责按钮态
      await Promise.resolve(onRescan());
    } finally {
      setRescanning(false);
    }
  }, [onRescan]);

  const installations: JavaInstallation[] = result?.installations ?? [];
  const isEmpty = !loading && !rescanning && installations.length === 0;

  return (
    <div style={{ marginTop: 8 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <h4 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Coffee size={15} />
          Java 运行时
          {result && (
            <span className="form-hint" style={{ marginLeft: 8 }}>
              共 {installations.length} 个 · 扫描 {result.scanned_paths} 路径 · 耗时{' '}
              {result.elapsed_ms}ms
              {result.failed_paths > 0 ? ` · 失败 ${result.failed_paths}` : ''}
            </span>
          )}
        </h4>
        <LoadingButton
          variant="ghost"
          size="sm"
          loading={rescanning || loading}
          loadingText="扫描中…"
          onClick={handleRescan}
        >
          <RefreshCw size={13} />
          重新扫描
        </LoadingButton>
      </div>

      {isEmpty ? (
        <EmptyState
          icon={<Coffee size={32} />}
          title="未检测到 Java 运行时"
          description="请先安装 JDK（推荐 JDK 17 或 21）后再次扫描"
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>路径</th>
                <th>版本</th>
                <th>供应商</th>
                <th>类型</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              {installations.map((java) => (
                <tr key={java.path}>
                  <td className="mono" style={{ wordBreak: 'break-all' }}>
                    {java.path}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{java.version_string}</div>
                    <div className="form-hint" style={{ fontSize: 11 }}>
                      {versionHint(java.version)}
                    </div>
                  </td>
                  <td>{java.vendor || <span style={{ color: '#9ca3af' }}>—</span>}</td>
                  <td>
                    <JdkBadge isJdk={java.is_jdk} />
                  </td>
                  <td className="mono" style={{ fontSize: 12, color: '#6b7280' }}>
                    {java.source || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
