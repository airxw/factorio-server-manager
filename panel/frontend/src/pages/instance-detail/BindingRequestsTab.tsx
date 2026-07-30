// ============================================================================
// BindingRequestsTab — 实例详情"绑定申请"Tab（v4.38.0 / v4.38.1）
//
// 用途：服主（owner / instance_admin / server_admin）在实例详情页管理绑定申请
//   1. 申请通道开关（私有实例才显示；公开实例直接绑定无需审批）
//   2. 自动审批开关（v4.38.1 新增，开启后用户申请即自动通过）
//   3. 申请列表（pending / approved / rejected / cancelled 筛选）
//   4. 审批操作（通过 / 拒绝，可填备注）
//      - 通过：自动创建 binding（vip_level=1），申请人无需再确认
//      - 拒绝：仅记录备注，不创建 binding
//
// 数据源：
//   GET    /api/servers/:serverId/binding-requests
//   POST   /api/binding-requests/:id/approve
//   POST   /api/binding-requests/:id/reject
//   PUT    /api/admin/servers/:serverId/binding-requests-settings
//
// 后端路由：panel/backend/src/api/routes/bindingRequests.ts
//          panel/backend/src/api/routes/discover.ts（binding-requests-settings）
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Clock3,
  Inbox,
  Lock,
  Mail,
  MailCheck,
  MailX,
  RefreshCw,
  RotateCcw,
  Unlock,
  X,
  Zap,
} from 'lucide-react';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import { useToast } from '../../components/ui';
import type {
  BindingApplicationStatus,
  BindingApplicationWithNames,
} from '@public/schema/panel-api-types';

type TabKey = 'all' | BindingApplicationStatus;

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审批' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已拒绝' },
  { key: 'cancelled', label: '已撤销' },
];

const STATUS_META: Record<
  BindingApplicationStatus,
  { label: string; badge: string; Icon: typeof Clock3 }
> = {
  pending: { label: '待审批', badge: 'gp-badge-amber', Icon: Clock3 },
  approved: { label: '已通过', badge: 'gp-badge-emerald', Icon: CheckCircle2 },
  rejected: { label: '已拒绝', badge: 'gp-badge-rose', Icon: MailX },
  cancelled: { label: '已撤销', badge: '', Icon: RotateCcw },
};

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface BindingRequestsTabProps {
  serverId: string;
  /** 父组件传入：当前实例是否公开（公开实例不显示申请通道开关，且 tab 通常被过滤掉） */
  isPublic: boolean;
  /** 父组件传入：当前申请通道开关初始值（从 ServerSummary 读取） */
  initialRequestsEnabled: boolean;
  /** v4.38.1: 父组件传入：当前自动审批开关初始值（从 ServerSummary 读取） */
  initialAutoApprove: boolean;
}

export default function BindingRequestsTab({
  serverId,
  isPublic,
  initialRequestsEnabled,
  initialAutoApprove,
}: BindingRequestsTabProps) {
  const { api } = useAuth();
  const toast = useToast();

  const [applications, setApplications] = useState<BindingApplicationWithNames[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [busy, setBusy] = useState(false);

  // 申请通道开关状态（受 PUT /admin/servers/:id/binding-requests-settings 控制）
  const [requestsEnabled, setRequestsEnabled] = useState(initialRequestsEnabled);
  const [toggling, setToggling] = useState(false);

  // v4.38.1: 自动审批开关状态（同上端点控制）
  const [autoApprove, setAutoApprove] = useState(initialAutoApprove);
  const [togglingAuto, setTogglingAuto] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listServerBindingApplications(serverId);
      setApplications(res.applications ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载绑定申请列表失败');
    } finally {
      setLoading(false);
    }
  }, [api, serverId, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 父组件传入的开关初值变化时同步（实例切换或外部更新）
  useEffect(() => {
    setRequestsEnabled(initialRequestsEnabled);
  }, [initialRequestsEnabled]);

  // v4.38.1: 自动审批开关初值同步
  useEffect(() => {
    setAutoApprove(initialAutoApprove);
  }, [initialAutoApprove]);

  const filteredApplications = useMemo(() => {
    if (activeTab === 'all') return applications;
    return applications.filter((a) => a.status === activeTab);
  }, [applications, activeTab]);

  const pendingCount = useMemo(
    () => applications.filter((a) => a.status === 'pending').length,
    [applications],
  );

  // ----------------------------------------------------------------
  // 切换申请通道开关
  // ----------------------------------------------------------------
  const handleToggleRequestsEnabled = async (next: boolean) => {
    if (toggling) return;
    setToggling(true);
    try {
      const res = await api.setBindingRequestsSettings(serverId, { binding_requests_enabled: next });
      setRequestsEnabled(res.binding_requests_enabled);
      // 关闭申请通道时联动关闭自动审批（后端不强制，但前端语义同步）
      if (!res.binding_requests_enabled && autoApprove) {
        setAutoApprove(false);
      }
      toast.success(res.binding_requests_enabled ? '已开启绑定申请通道' : '已关闭绑定申请通道');
    } catch (err) {
      const code = err instanceof PanelApiError ? err.code : '';
      if (code === 'PANEL_FORBIDDEN') {
        toast.error('无权修改该实例的申请通道设置（需 owner / instance_admin / server_admin）');
      } else {
        toast.error(err instanceof Error ? err.message : '修改申请通道设置失败');
      }
    } finally {
      setToggling(false);
    }
  };

  // ----------------------------------------------------------------
  // v4.38.1: 切换自动审批开关
  //   语义：仅在申请通道开启时有意义；开启后用户申请即自动通过（无需服主审批）
  //   联动：若申请通道未开启，开启自动审批会先开启申请通道
  // ----------------------------------------------------------------
  const handleToggleAutoApprove = async (next: boolean) => {
    if (togglingAuto) return;
    setTogglingAuto(true);
    try {
      // 开启自动审批时若申请通道未开启，联动开启申请通道
      if (next && !requestsEnabled) {
        const res = await api.setBindingRequestsSettings(serverId, {
          binding_requests_enabled: true,
          auto_approve_binding_requests: true,
        });
        setRequestsEnabled(res.binding_requests_enabled);
        setAutoApprove(res.auto_approve_binding_requests);
        toast.success('已开启申请通道 + 自动审批');
      } else {
        const res = await api.setBindingRequestsSettings(serverId, {
          auto_approve_binding_requests: next,
        });
        setAutoApprove(res.auto_approve_binding_requests);
        toast.success(next ? '已开启自动审批（用户申请即通过）' : '已关闭自动审批');
      }
    } catch (err) {
      const code = err instanceof PanelApiError ? err.code : '';
      if (code === 'PANEL_FORBIDDEN') {
        toast.error('无权修改该实例的自动审批设置（需 owner / instance_admin / server_admin）');
      } else {
        toast.error(err instanceof Error ? err.message : '修改自动审批设置失败');
      }
    } finally {
      setTogglingAuto(false);
    }
  };

  // ----------------------------------------------------------------
  // 审批通过
  // ----------------------------------------------------------------
  const handleApprove = async (application: BindingApplicationWithNames) => {
    const note = window.prompt(`通过「${application.requester_username}」的绑定申请？\n可选填写审批备注：`) ?? '';
    if (note === null) return;
    setBusy(true);
    try {
      await api.approveBindingApplication(application.id, note.trim() ? { review_note: note.trim() } : undefined);
      toast.success('已通过申请，已自动为申请人创建绑定（vip_level=1）');
      await refresh();
    } catch (err) {
      const code = err instanceof PanelApiError ? err.code : '';
      if (code === 'BINDING_REQUEST_NOT_FOUND') {
        toast.info('申请不存在或已被处理');
        await refresh();
      } else if (code === 'BINDING_REQUEST_NOT_PENDING') {
        toast.info('申请已被处理');
        await refresh();
      } else if (code === 'BINDING_REQUEST_ALREADY_BOUND') {
        toast.info('申请人已绑定该实例');
        await refresh();
      } else if (code === 'PANEL_FORBIDDEN') {
        toast.error('无权审批该实例的绑定申请');
      } else {
        toast.error(err instanceof Error ? err.message : '审批失败');
      }
    } finally {
      setBusy(false);
    }
  };

  // ----------------------------------------------------------------
  // 审批拒绝
  // ----------------------------------------------------------------
  const handleReject = async (application: BindingApplicationWithNames) => {
    const note = window.prompt(`拒绝「${application.requester_username}」的绑定申请？\n可选填写拒绝原因：`) ?? '';
    if (note === null) return;
    setBusy(true);
    try {
      await api.rejectBindingApplication(application.id, note.trim() ? { review_note: note.trim() } : undefined);
      toast.success('已拒绝申请');
      await refresh();
    } catch (err) {
      const code = err instanceof PanelApiError ? err.code : '';
      if (code === 'BINDING_REQUEST_NOT_FOUND') {
        toast.info('申请不存在或已被处理');
        await refresh();
      } else if (code === 'BINDING_REQUEST_NOT_PENDING') {
        toast.info('申请已被处理');
        await refresh();
      } else if (code === 'PANEL_FORBIDDEN') {
        toast.error('无权审批该实例的绑定申请');
      } else {
        toast.error(err instanceof Error ? err.message : '拒绝失败');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="binding-requests-tab" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ----------------------------------------------------------------
          申请通道开关 + 自动审批开关（仅私有实例显示）
          公开实例直接绑定，无需申请通道；服主在公开实例下不会看到此 tab
          （ServerDetailCore.allTabs 已过滤），但此处再加一道防御
          v4.38.1: 左侧新增"自动审批"开关，开启后用户申请即自动通过
      ---------------------------------------------------------------- */}
      {!isPublic && (
        <div
          className="info-card"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            padding: '14px 16px',
          }}
        >
          {/* 左侧：自动审批开关（v4.38.1 新增） */}
          <button
            type="button"
            className={`btn ${autoApprove ? 'btn-success' : 'btn-ghost'}`}
            onClick={() => void handleToggleAutoApprove(!autoApprove)}
            disabled={togglingAuto}
            title={autoApprove ? '关闭自动审批（恢复手动审批）' : '开启自动审批（用户申请即通过）'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Zap size={14} />
            {togglingAuto ? '处理中…' : autoApprove ? '自动审批：开' : '自动审批：关'}
          </button>

          {/* 中间：说明文字 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            {requestsEnabled ? (
              <Unlock size={18} style={{ color: 'var(--gp-emerald, #34c759)' }} aria-hidden />
            ) : (
              <Lock size={18} style={{ color: 'var(--gp-text-faint)' }} aria-hidden />
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                绑定申请通道：{requestsEnabled ? '已开启' : '已关闭'}
                {requestsEnabled && (
                  <span style={{ marginLeft: 8, fontSize: 12, color: autoApprove ? 'var(--gp-emerald, #34c759)' : 'var(--color-text-muted)' }}>
                    · {autoApprove ? '自动审批中' : '手动审批'}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {requestsEnabled
                  ? autoApprove
                    ? '开启自动审批后，用户申请即自动通过并创建绑定（vip_level=1），无需手动审批'
                    : '其他用户可在服务器市场提交绑定申请，由你审批后创建绑定（vip_level=1）'
                  : '关闭后其他用户无法对该实例提交绑定申请，仅 owner/admin 可直接绑定'}
              </div>
            </div>
          </div>

          {/* 右侧：申请通道开关按钮 */}
          <button
            type="button"
            className={`btn ${requestsEnabled ? 'btn-ghost' : 'btn-primary'}`}
            onClick={() => void handleToggleRequestsEnabled(!requestsEnabled)}
            disabled={toggling}
            title={requestsEnabled ? '关闭申请通道' : '开启申请通道'}
          >
            {toggling ? '处理中…' : requestsEnabled ? '关闭通道' : '开启通道'}
          </button>
        </div>
      )}

      {/* ----------------------------------------------------------------
          页头 + 状态筛选 tab
      ---------------------------------------------------------------- */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
          绑定申请记录
          {pendingCount > 0 && (
            <span
              className="gp-mono-num"
              style={{
                marginLeft: 8,
                fontSize: 12,
                padding: '2px 8px',
                borderRadius: 999,
                background: 'rgba(251, 191, 36, 0.15)',
                color: 'var(--gp-amber, #f59e0b)',
              }}
            >
              {pendingCount} 待审批
            </span>
          )}
        </h3>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> 刷新
        </button>
      </div>

      <div
        role="tablist"
        aria-label="申请状态筛选"
        style={{
          display: 'flex',
          gap: 6,
          padding: 4,
          background: 'var(--gp-bg-card-strong, var(--color-bg-elevated))',
          borderRadius: 12,
          border: '1px solid var(--gp-border, var(--color-border))',
          overflowX: 'auto',
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          const count = tab.key === 'all'
            ? applications.length
            : applications.filter((a) => a.status === tab.key).length;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '8px 14px',
                border: 'none',
                background: isActive ? 'var(--color-bg)' : 'transparent',
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                borderRadius: 9,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
                transition: 'background 0.15s ease, color 0.15s ease',
              }}
            >
              {tab.label}
              {count > 0 && (
                <span
                  className="gp-mono-num"
                  style={{
                    fontSize: 11,
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: isActive ? 'rgba(10, 132, 255, 0.15)' : 'var(--color-bg)',
                    color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ----------------------------------------------------------------
          申请列表
      ---------------------------------------------------------------- */}
      {loading && applications.length === 0 ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="gp-skeleton" style={{ height: 120 }} />
          ))}
        </div>
      ) : filteredApplications.length > 0 ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {filteredApplications.map((a) => {
            const meta = STATUS_META[a.status] ?? STATUS_META.pending;
            const Icon = meta.Icon;
            const isPending = a.status === 'pending';
            return (
              <div
                key={a.id}
                className="info-card"
                style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}
              >
                {/* 头部：申请人 + 状态 + 时间 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    <Mail size={13} style={{ color: 'var(--color-primary)' }} aria-hidden />
                    {a.requester_username || '未知用户'}
                  </span>
                  <span className={`gp-badge ${meta.badge}`}>
                    <Icon size={11} /> {meta.label}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                    提交于 {formatTime(a.created_at)}
                  </span>
                </div>

                {/* 申请留言 */}
                {a.message && (
                  <div
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: 'var(--color-bg-elevated)',
                      border: '1px solid var(--color-border)',
                      fontSize: 12,
                      color: 'var(--color-text-secondary)',
                      lineHeight: 1.5,
                    }}
                  >
                    <span style={{ color: 'var(--color-text-muted)', marginRight: 6 }}>留言：</span>
                    {a.message}
                  </div>
                )}

                {/* 审批备注 + 审批人 */}
                {(a.review_note || a.reviewer_username) && (
                  <div
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      background:
                        a.status === 'rejected'
                          ? 'rgba(255, 59, 48, 0.06)'
                          : a.status === 'approved'
                            ? 'rgba(52, 199, 89, 0.06)'
                            : 'var(--color-bg-elevated)',
                      border: `1px solid ${
                        a.status === 'rejected'
                          ? 'rgba(255, 59, 48, 0.2)'
                          : a.status === 'approved'
                            ? 'rgba(52, 199, 89, 0.2)'
                            : 'var(--color-border)'
                      }`,
                      fontSize: 12,
                      color: 'var(--color-text-secondary)',
                      lineHeight: 1.5,
                    }}
                  >
                    {a.reviewer_username && (
                      <div style={{ marginBottom: 4 }}>
                        <span style={{ color: 'var(--color-text-muted)', marginRight: 6 }}>审批人：</span>
                        {a.reviewer_username}
                        {a.reviewed_at && <span style={{ marginLeft: 8, color: 'var(--color-text-muted)' }}>{formatTime(a.reviewed_at)}</span>}
                      </div>
                    )}
                    {a.review_note && (
                      <div>
                        <span style={{ color: 'var(--color-text-muted)', marginRight: 6 }}>备注：</span>
                        {a.review_note}
                      </div>
                    )}
                  </div>
                )}

                {/* 操作（仅 pending 显示通过/拒绝） */}
                {isPending && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void handleReject(a)}
                      disabled={busy}
                      style={{ color: 'var(--color-danger)' }}
                    >
                      <X size={13} /> 拒绝
                    </button>
                    <button
                      type="button"
                      className="btn btn-success btn-sm"
                      onClick={() => void handleApprove(a)}
                      disabled={busy}
                    >
                      <Check size={13} /> 通过
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state" style={{ padding: '36px 20px', textAlign: 'center' }}>
          <div
            style={{
              margin: '0 auto',
              width: 52,
              height: 52,
              borderRadius: 999,
              background: 'var(--color-primary-gradient, var(--color-primary))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
            }}
          >
            <Inbox size={22} />
          </div>
          <p style={{ margin: '12px 0 4px', fontWeight: 600, fontSize: 14 }}>
            {activeTab === 'all' ? '暂无绑定申请' : `暂无「${TABS.find((t) => t.key === activeTab)?.label ?? ''}」状态的申请`}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>
            {isPublic
              ? '公开实例无需审批，用户可直接绑定'
              : requestsEnabled
                ? '其他用户可在服务器市场对该实例提交绑定申请'
                : '当前已关闭申请通道，开启后用户可提交申请'}
          </p>
          {/* 公开实例的提示徽章（防御性，正常情况不会到此） */}
          {isPublic && (
            <div style={{ marginTop: 12 }}>
              <span className="gp-badge gp-badge-cyan">
                <MailCheck size={11} /> 公开实例
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
