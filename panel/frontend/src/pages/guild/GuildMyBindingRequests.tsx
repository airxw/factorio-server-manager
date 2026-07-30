// ============================================================================
// GuildMyBindingRequests — /guild/my-binding-requests（v4.38.0 我的绑定申请）
//
// 数据源：GET /api/my/binding-requests（用户查看自己提交的全部申请）
// 功能：
//   1. 状态筛选 tab（全部/待审批/已通过/已拒绝/已撤销）
//   2. 申请卡片展示（实例名/游戏类型/留言/审批备注/时间戳）
//   3. pending 状态可撤销（DELETE /api/binding-requests/:id）
//   4. approved 状态可一键进入实例详情
//
// 后端：panel/backend/src/api/routes/bindingRequests.ts（GET /api/my/binding-requests）
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  ChevronRight,
  Clock3,
  Inbox,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
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
  rejected: { label: '已拒绝', badge: 'gp-badge-rose', Icon: XCircle },
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

interface ApplicationCardProps {
  application: BindingApplicationWithNames;
  busy: boolean;
  onCancel: (application: BindingApplicationWithNames) => void;
}

function ApplicationCard({ application, busy, onCancel }: ApplicationCardProps) {
  const navigate = useNavigate();
  const meta = STATUS_META[application.status] ?? STATUS_META.pending;
  const Icon = meta.Icon;
  const isPending = application.status === 'pending';
  const isApproved = application.status === 'approved';

  return (
    <div className="gp-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 头部：实例名 + 状态徽章 + 时间 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="gp-badge gp-badge-violet">{application.server_name || '未知实例'}</span>
        <span className={`gp-badge ${meta.badge}`}>
          <Icon size={11} /> {meta.label}
        </span>
        <span className="gp-text-faint" style={{ fontSize: 12, marginLeft: 'auto' }}>
          提交于 {formatTime(application.created_at)}
        </span>
      </div>

      {/* 游戏类型 + 申请人/审批人元信息 */}
      <div className="gp-text-faint" style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, flexWrap: 'wrap' }}>
        <span>游戏类型：{application.server_game_type || '未知'}</span>
        {application.reviewer_username && (
          <span>审批人：{application.reviewer_username}</span>
        )}
        {application.reviewed_at && (
          <span>审批于 {formatTime(application.reviewed_at)}</span>
        )}
      </div>

      {/* 申请留言 */}
      {application.message && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            background: 'var(--gp-bg-card-strong)',
            border: '1px solid var(--gp-border)',
            fontSize: 12,
            color: 'var(--gp-text-sec)',
            lineHeight: 1.5,
          }}
        >
          <span className="gp-text-faint" style={{ marginRight: 6 }}>
            留言：
          </span>
          {application.message}
        </div>
      )}

      {/* 审批备注（rejected/approved 时服主可能填写） */}
      {application.review_note && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            background:
              application.status === 'rejected'
                ? 'rgba(255, 59, 48, 0.06)'
                : 'rgba(52, 199, 89, 0.06)',
            border: `1px solid ${
              application.status === 'rejected'
                ? 'rgba(255, 59, 48, 0.2)'
                : 'rgba(52, 199, 89, 0.2)'
            }`,
            fontSize: 12,
            color: 'var(--gp-text-sec)',
            lineHeight: 1.5,
          }}
        >
          <span className="gp-text-faint" style={{ marginRight: 6 }}>
            服主回复：
          </span>
          {application.review_note}
        </div>
      )}

      {/* 操作 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        {isApproved && (
          <button
            type="button"
            className="gp-btn gp-btn-primary"
            style={{ padding: '6px 14px', fontSize: 12 }}
            onClick={() => navigate(`/guild/servers/${application.server_id}`)}
          >
            进入实例 <ChevronRight size={12} />
          </button>
        )}
        {isPending && (
          <button
            type="button"
            className="gp-btn gp-btn-ghost"
            style={{ padding: '6px 12px', fontSize: 12, color: 'var(--gp-rose)' }}
            onClick={() => onCancel(application)}
            disabled={busy}
            title="撤销申请"
          >
            <Trash2 size={12} /> 撤销申请
          </button>
        )}
      </div>
    </div>
  );
}

export default function GuildMyBindingRequests() {
  const { api } = useAuth();
  const toast = useToast();
  useDocumentTitle('我的绑定申请');

  const [applications, setApplications] = useState<BindingApplicationWithNames[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('all');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listMyBindingApplications();
      setApplications(res.applications ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载绑定申请列表失败');
    } finally {
      setLoading(false);
    }
  }, [api, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredApplications = useMemo(() => {
    if (activeTab === 'all') return applications;
    return applications.filter((a) => a.status === activeTab);
  }, [applications, activeTab]);

  const handleCancel = async (application: BindingApplicationWithNames) => {
    if (!window.confirm(`确定撤销对「${application.server_name}」的绑定申请吗？`)) return;
    setBusy(true);
    try {
      await api.cancelBindingApplication(application.id);
      toast.success('已撤销申请');
      setApplications((prev) => prev.filter((a) => a.id !== application.id));
    } catch (err) {
      const code = err instanceof PanelApiError ? err.code : '';
      if (code === 'BINDING_REQUEST_NOT_FOUND') {
        toast.info('申请不存在或已被处理');
        await refresh();
      } else if (code === 'BINDING_REQUEST_NOT_PENDING') {
        toast.info('申请已被处理，无法撤销');
        await refresh();
      } else {
        toast.error(err instanceof PanelApiError ? err.message : '撤销失败');
      }
    } finally {
      setBusy(false);
    }
  };

  // 统计各状态数量
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: applications.length };
    for (const a of applications) {
      counts[a.status] = (counts[a.status] ?? 0) + 1;
    }
    return counts;
  }, [applications]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 页头 */}
      <div className="gp-hero" style={{ padding: '20px 20px' }}>
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>我的绑定申请</h1>
            <p className="gp-text-dim" style={{ margin: '6px 0 0', fontSize: 13 }}>
              查看你对私有实例提交的绑定申请进度，pending 状态可撤销
            </p>
          </div>
          <button
            type="button"
            className="gp-btn gp-btn-ghost"
            style={{ padding: '8px 14px', fontSize: 13 }}
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
      </div>

      {/* 状态筛选 tab */}
      <div
        role="tablist"
        aria-label="申请状态筛选"
        style={{
          display: 'flex',
          gap: 6,
          padding: 4,
          background: 'var(--gp-bg-card-strong)',
          borderRadius: 12,
          border: '1px solid var(--gp-border)',
          overflowX: 'auto',
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          const count = statusCounts[tab.key] ?? 0;
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
                background: isActive ? 'var(--gp-bg-card)' : 'transparent',
                color: isActive ? 'var(--gp-blue)' : 'var(--gp-text-sec)',
                borderRadius: 9,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
                transition: 'background 0.15s ease, color 0.15s ease',
                boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.04)' : 'none',
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
                    background: isActive ? 'rgba(10, 132, 255, 0.15)' : 'var(--gp-bg-card)',
                    color: isActive ? 'var(--gp-blue)' : 'var(--gp-text-faint)',
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 申请列表 */}
      {loading && applications.length === 0 ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="gp-skeleton" style={{ height: 120 }} />
          ))}
        </div>
      ) : filteredApplications.length > 0 ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {filteredApplications.map((a) => (
            <ApplicationCard
              key={a.id}
              application={a}
              busy={busy}
              onCancel={handleCancel}
            />
          ))}
        </div>
      ) : (
        <div className="gp-empty" style={{ padding: '36px 20px' }}>
          <div
            style={{
              margin: '0 auto',
              width: 52,
              height: 52,
              borderRadius: 999,
              background: 'var(--gp-grad-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
            }}
          >
            <Inbox size={22} />
          </div>
          <p style={{ margin: '12px 0 4px', fontWeight: 600, fontSize: 14 }}>
            {activeTab === 'all' ? '还没有提交过绑定申请' : `没有「${TABS.find((t) => t.key === activeTab)?.label ?? ''}」状态的申请`}
          </p>
          <p className="gp-text-faint" style={{ margin: 0, fontSize: 12 }}>
            前往服务器市场浏览可申请的私有实例
          </p>
        </div>
      )}

      {/* 去市场入口（无 pending 时显示） */}
      {!loading && applications.filter((a) => a.status === 'pending').length === 0 && (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            className="gp-btn gp-btn-ghost"
            style={{ padding: '8px 16px', fontSize: 13 }}
            onClick={() => {
              window.location.href = '/guild/servers';
            }}
          >
            <Send size={13} /> 前往服务器市场
          </button>
        </div>
      )}
    </div>
  );
}
