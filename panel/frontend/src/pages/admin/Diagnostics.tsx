// ============================================================================
// Diagnostics — 一键诊断与修复（全量检查项展示）
// "一键诊断"按钮调用 api.runDiagnostics()，展示所有检查项（通过/警告/错误）
// 按分类分组展示，顶部显示汇总统计
// 可自动修复的问题展示"一键修复"按钮 → api.applyFix(fixId)
// 诊断报告可复制到剪贴板
// 支持"仅显示问题"切换
// 优雅降级：端点 404/错误时展示"诊断接口暂未开放"
// ============================================================================

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Filter,
  RefreshCw,
  Stethoscope,
  Wrench,
  XCircle,
} from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import type { DiagnosticCheck } from '../../api/modules/system';
import { useToast } from '../../components/ui';
import { getEffectiveRole, isAdminRole } from '../../utils/role';

/** 判断错误是否为端点不存在（404）或网络错误 */
function isEndpointUnavailable(err: unknown): boolean {
  if (err instanceof PanelApiError) {
    return err.status === 404 || err.code === 'HTTP_404' || err.code === 'NETWORK_ERROR';
  }
  return true;
}

/** 状态对应的图标与颜色 */
function statusMeta(status: DiagnosticCheck['status']): {
  icon: typeof CheckCircle2;
  color: string;
  label: string;
  bgColor: string;
} {
  switch (status) {
    case 'pass':
      return { icon: CheckCircle2, color: '#16a34a', label: '通过', bgColor: 'rgba(22, 163, 74, 0.1)' };
    case 'warning':
      return { icon: AlertTriangle, color: '#d97706', label: '警告', bgColor: 'rgba(217, 119, 6, 0.1)' };
    case 'error':
      return { icon: XCircle, color: '#dc2626', label: '错误', bgColor: 'rgba(220, 38, 38, 0.1)' };
    default:
      return { icon: AlertTriangle, color: '#6b7280', label: '未知', bgColor: 'rgba(107, 114, 128, 0.1)' };
  }
}

/** 将诊断报告格式化为可复制的纯文本 */
function formatReport(checks: DiagnosticCheck[]): string {
  const lines: string[] = [
    '=== 系统诊断报告 ===',
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
    '',
  ];

  const byCategory = groupByCategory(checks);
  const passCount = checks.filter((c) => c.status === 'pass').length;
  const warnCount = checks.filter((c) => c.status === 'warning').length;
  const errorCount = checks.filter((c) => c.status === 'error').length;

  lines.push(`总计：${checks.length} 项检查 | 通过：${passCount} | 警告：${warnCount} | 错误：${errorCount}`);
  lines.push('');

  for (const [category, items] of Object.entries(byCategory)) {
    lines.push(`【${category}】`);
    items.forEach((c, i) => {
      const meta = statusMeta(c.status);
      lines.push(`  [${i + 1}] ${c.title} [${meta.label}]`);
      lines.push(`      ${c.message}`);
      if (c.status !== 'pass' && c.fixable && c.fixId) {
        lines.push(`      可自动修复：是 (fixId=${c.fixId})`);
      }
    });
    lines.push('');
  }

  return lines.join('\n');
}

/** 按分类分组检查项 */
function groupByCategory(checks: DiagnosticCheck[]): Record<string, DiagnosticCheck[]> {
  const groups: Record<string, DiagnosticCheck[]> = {};
  for (const c of checks) {
    const cat = c.category || '其他';
    if (!groups[cat]) {
      groups[cat] = [];
    }
    groups[cat].push(c);
  }
  return groups;
}

// v3.7.0-D1: 支持 embedded 模式（在 /admin/system-health 的 diagnostics Tab 中嵌入）
// - embedded=true：隐藏外层 .page 和 .page-header（由父页面 SystemHealth 提供）
// - embedded=false（独立路由 /admin/diagnostics，已废弃）：完整渲染
export default function Diagnostics({ embedded = false }: { embedded?: boolean } = {}) {
  const { api, user } = useAuth();
  const toast = useToast();

  const [checks, setChecks] = useState<DiagnosticCheck[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number }>({ completed: 0, total: 0 });
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [fixingIds, setFixingIds] = useState<Set<string>>(new Set());
  // v3.8.0-D4: 运行环境标记（production / development），由后端 runDiagnostics 返回
  const [environment, setEnvironment] = useState<'production' | 'development' | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runDiagnostics = useCallback(async () => {
    // 取消上一次未完成的诊断
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setStreaming(true);
    setChecks([]);
    setProgress({ completed: 0, total: 0 });
    setError(null);
    setUnavailable(false);
    setHasRun(true);
    setExpandedCategories(new Set());

    try {
      await api.runDiagnosticsStream({
        signal: ac.signal,
        onCheck: (check, meta) => {
          if (ac.signal.aborted) return;
          setProgress({ completed: meta.ruleIndex + 1, total: meta.totalRules });
          setEnvironment(meta.environment);
          setChecks((prev) => {
            const next = [...prev, check];
            // 有问题时自动展开该分类
            if (check.status !== 'pass') {
              setExpandedCategories((cats) => new Set([...cats, check.category || '其他']));
            }
            return next;
          });
        },
        onDone: (summary) => {
          if (ac.signal.aborted) return;
          setEnvironment(summary.environment);
          setStreaming(false);
          setLoading(false);
          const problemCount = summary.warning + summary.error;
          if (checks.length > 0 || summary.total > 0) {
            toast.success(`诊断完成，共 ${summary.total} 项检查，发现 ${problemCount} 个问题`);
          }
        },
        onError: (msg) => {
          if (ac.signal.aborted) return;
          setError(msg);
          setStreaming(false);
          setLoading(false);
          toast.error('诊断失败', msg);
        },
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (isEndpointUnavailable(err)) {
        setUnavailable(true);
        setChecks([]);
      } else {
        const msg = err instanceof Error ? err.message : '诊断失败';
        setError(msg);
        toast.error('诊断失败', msg);
      }
      setStreaming(false);
      setLoading(false);
    }
  }, [api, toast]);

  const handleApplyFix = useCallback(
    async (check: DiagnosticCheck) => {
      if (!check.fixId) return;
      setFixingIds((prev) => new Set(prev).add(check.id));
      try {
        const res = await api.applyFix(check.fixId);
        if (res.success) {
          toast.success(`已修复：${check.title}`);
          setChecks((prev) =>
            prev.map((c) =>
              c.id === check.id
                ? { ...c, status: 'pass' as const, message: `已修复：${check.title}`, fixable: false, fixId: null }
                : c,
            ),
          );
        } else {
          toast.error(`修复失败：${res.message ?? '未知原因'}`);
        }
      } catch (err) {
        if (isEndpointUnavailable(err)) {
          toast.info('修复接口暂未开放');
        } else {
          const msg = err instanceof Error ? err.message : '修复失败';
          toast.error('修复失败', msg);
        }
      } finally {
        setFixingIds((prev) => {
          const next = new Set(prev);
          next.delete(check.id);
          return next;
        });
      }
    },
    [api, toast],
  );

  const handleCopyReport = useCallback(async () => {
    const text = formatReport(checks);
    try {
      await navigator.clipboard.writeText(text);
      toast.success('诊断报告已复制到剪贴板');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        toast.success('诊断报告已复制到剪贴板');
      } catch {
        toast.error('复制失败，请手动选择文本复制');
      } finally {
        document.body.removeChild(textarea);
      }
    }
  }, [checks, toast]);

  const toggleCategory = useCallback((category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const displayChecks = useMemo(() => {
    if (!onlyProblems) return checks;
    return checks.filter((c) => c.status !== 'pass');
  }, [checks, onlyProblems]);

  const groupedChecks = useMemo(() => groupByCategory(displayChecks), [displayChecks]);

  const stats = useMemo(() => {
    const total = checks.length;
    const pass = checks.filter((c) => c.status === 'pass').length;
    const warning = checks.filter((c) => c.status === 'warning').length;
    const error = checks.filter((c) => c.status === 'error').length;
    return { total, pass, warning, error };
  }, [checks]);

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  // v3.7.0-D1: embedded 模式下不渲染外层 .page 和 .page-header（由父页面提供）
  const pageActions = (
    <div className="page-actions">
      {checks.length > 0 && (
        <button
          className={`btn ${onlyProblems ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setOnlyProblems(!onlyProblems)}
          title="仅显示有问题的检查项"
        >
          <Filter size={14} />
          {onlyProblems ? '显示全部' : '仅显示问题'}
        </button>
      )}
      {checks.length > 0 && (
        <button className="btn btn-ghost" onClick={() => void handleCopyReport()}>
          <ClipboardCopy size={14} />
          复制报告
        </button>
      )}
      <button
        className="btn btn-primary"
        onClick={() => void runDiagnostics()}
        disabled={loading}
      >
        <Stethoscope size={14} />
        {loading ? '诊断中…' : '一键诊断'}
      </button>
    </div>
  );

  // v3.7.0-D1: 内部内容（embedded 与独立模式共用）
  const innerContent = (
    <>
      {error && <div className="alert alert-error">{error}</div>}

      {/* v3.8.0-D4: 运行环境徽章——production=绿色 / development=橙色 */}
      {hasRun && environment && (
        <div className="info-card" style={{ marginBottom: 12, padding: '8px 16px' }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary, #6b7280)' }}>
            运行环境：
          </span>
          <span
            className={`badge badge-${environment === 'production' ? 'running' : 'starting'}`}
            style={{ marginLeft: 6 }}
          >
            {environment === 'production' ? '生产环境' : '开发环境'}
          </span>
          {environment === 'development' && (
            <span style={{ marginLeft: 12, fontSize: 12, color: '#d97706' }}>
              ⚠ 开发环境检测结果可能包含 dev server 干扰，请谨慎采纳
            </span>
          )}
        </div>
      )}

      {/* 汇总统计卡片 */}
      {hasRun && checks.length > 0 && (
        <div className="info-card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 600, color: 'var(--color-text, #111827)' }}>
                {stats.total}
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #6b7280)' }}>
                总检查项
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 600, color: '#16a34a' }}>{stats.pass}</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #6b7280)' }}>
                通过
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 600, color: '#d97706' }}>
                {stats.warning}
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #6b7280)' }}>
                警告
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 600, color: '#dc2626' }}>{stats.error}</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #6b7280)' }}>
                错误
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 接口不可用占位 */}
      {unavailable && !loading ? (
        <div className="empty-state">诊断接口暂未开放。</div>
      ) : !hasRun ? (
        <div className="empty-state">
          <RefreshCw size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
          <p>点击"一键诊断"开始检查系统状态。</p>
        </div>
      ) : loading && checks.length === 0 ? (
        <div className="empty-state">诊断进行中…</div>
      ) : streaming ? (
        <div className="empty-state" style={{ gap: 12 }}>
          <RefreshCw size={24} style={{ opacity: 0.6, animation: 'spin 1s linear infinite' }} />
          <p>已检查 {progress.completed} / {progress.total} 项…</p>
          <div
            style={{
              width: Math.min(200, (progress.completed / Math.max(progress.total, 1)) * 200),
              height: 3,
              background: '#3b82f6',
              borderRadius: 2,
              transition: 'width 0.2s ease',
            }}
          />
        </div>
      ) : displayChecks.length === 0 ? (
        <div className="empty-state">
          <CheckCircle2 size={32} style={{ marginBottom: 8, color: '#16a34a' }} />
          <p>
            {onlyProblems
              ? '所有检查项均通过，无异常问题。'
              : '未发现任何问题，系统运行正常。'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Object.entries(groupedChecks).map(([category, items]) => {
            const expanded = expandedCategories.has(category);
            const catPassCount = items.filter((i) => i.status === 'pass').length;
            const catWarnCount = items.filter((i) => i.status === 'warning').length;
            const catErrCount = items.filter((i) => i.status === 'error').length;
            const hasProblems = catWarnCount > 0 || catErrCount > 0;
            return (
              <div
                key={category}
                style={{
                  border: '1px solid var(--color-border, #e5e7eb)',
                  borderRadius: 8,
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleCategory(category)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '12px 16px',
                    background: hasProblems
                      ? 'var(--color-bg-secondary, #f9fafb)'
                      : 'var(--color-bg, #ffffff)',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span>{category}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 400, opacity: 0.7 }}>
                    {items.length} 项
                    {catPassCount > 0 && (
                      <span style={{ color: '#16a34a', marginLeft: 8 }}>
                        ✓ {catPassCount}
                      </span>
                    )}
                    {catWarnCount > 0 && (
                      <span style={{ color: '#d97706', marginLeft: 8 }}>
                        ⚠ {catWarnCount}
                      </span>
                    )}
                    {catErrCount > 0 && (
                      <span style={{ color: '#dc2626', marginLeft: 8 }}>
                        ✕ {catErrCount}
                      </span>
                    )}
                  </span>
                </button>
                {expanded && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      padding: '0 16px 12px',
                      borderTop: '1px solid var(--color-border, #e5e7eb)',
                      paddingTop: 12,
                    }}
                  >
                    {items.map((c) => {
                      const meta = statusMeta(c.status);
                      const Icon = meta.icon;
                      const isFixing = fixingIds.has(c.id);
                      return (
                        <div
                          key={c.id}
                          style={{
                            border: `1px solid ${c.status === 'pass' ? 'var(--color-border, #e5e7eb)' : meta.color}40`,
                            borderRadius: 6,
                            padding: 12,
                            background: c.status === 'pass' ? 'transparent' : meta.bgColor,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              marginBottom: 4,
                            }}
                          >
                            <Icon size={16} color={meta.color} />
                            <strong style={{ fontSize: 13 }}>{c.title}</strong>
                            <span
                              className="badge"
                              style={{
                                background: meta.bgColor,
                                color: meta.color,
                                fontSize: 11,
                              }}
                            >
                              {meta.label}
                            </span>
                          </div>
                          <p
                            className="form-hint"
                            style={{ margin: '0 0 6px', fontSize: 12 }}
                          >
                            {c.message}
                          </p>
                          {c.description && c.status !== 'pass' && (
                            <p
                              className="form-hint"
                              style={{ margin: '0 0 6px', fontSize: 12, opacity: 0.8 }}
                            >
                              <strong>说明：</strong>
                              {c.description}
                            </p>
                          )}
                          {c.status !== 'pass' && c.fixable && c.fixId && (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => void handleApplyFix(c)}
                              disabled={isFixing}
                            >
                              <Wrench size={12} />
                              {isFixing ? '修复中…' : '一键修复'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  // v3.7.0-D1: embedded 模式——不渲染外层 .page 包裹（由父页面 SystemHealth 提供）
  if (embedded) {
    return (
      <div>
        <div className="page-header" style={{ paddingLeft: 0, paddingRight: 0 }}>
          <h2 className="page-title">系统诊断</h2>
          {pageActions}
        </div>
        {innerContent}
      </div>
    );
  }

  // 独立模式（/admin/diagnostics，已废弃，保留向后兼容）
  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">系统诊断</h2>
        {pageActions}
      </div>
      {innerContent}
    </div>
  );
}
