// ============================================================================
// WithdrawApprovals — 管理端提现审批页（用户中心经济系统，仅 server_admin+）
// 路由：/admin/withdraws
// 数据源：GET /api/admin/withdraw/pending?page=&page_size=
// 操作：POST /api/admin/withdraw/:code/approve（核销）/ reject（拒绝，解冻退回）
// B2.1：已改用 api 客户端（client.ts listPendingWithdraws/approveWithdraw/rejectWithdraw）
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { useAuth } from '../../api/auth';
import { getEffectiveRole, isAdminRole } from '../../utils/role';
import { MobileCardList, useConfirm, useToast } from '../../components/ui';
import type {
  PendingWithdrawItem,
  ListPendingWithdrawsResponse,
} from '../../api/client';

const PAGE_SIZE = 20;

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

export default function WithdrawApprovals() {
  const { api, user } = useAuth();
  const { confirm } = useConfirm();
  const toast = useToast();

  const [data, setData] = useState<ListPendingWithdrawsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  // 行级操作进行中（按 code 标记，防止重复点击）
  const [actingCode, setActingCode] = useState<string | null>(null);

  const isAdmin = isAdminRole(getEffectiveRole(user));

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.listPendingWithdraws(targetPage, PAGE_SIZE);
        setData(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载待审批提现列表失败');
      } finally {
        setLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!isAdmin) return;
    void load(page);
  }, [isAdmin, load, page]);

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 1500);
    } catch {
      toast.error('复制失败', '浏览器不支持剪贴板或非 HTTPS 环境');
    }
  };

  const handleApprove = async (item: PendingWithdrawItem) => {
    const ok = await confirm({
      title: '核销提现码',
      message: `确认已线下打款 ¥${item.actual_amount} 给用户「${item.user_username ?? item.user_id}」？核销后提现码 ${item.code} 将标记为已完成。`,
      confirmText: '确认核销',
    });
    if (!ok) return;
    setActingCode(item.code);
    setError(null);
    try {
      await api.approveWithdraw(item.code);
      toast.success(`已核销提现码 ${item.code}`);
      await load(page);
    } catch (err) {
      toast.error('核销失败', err instanceof Error ? err.message : '未知错误');
    } finally {
      setActingCode(null);
    }
  };

  const handleReject = async (item: PendingWithdrawItem) => {
    const ok = await confirm({
      title: '拒绝提现',
      message: `确认拒绝提现码 ${item.code}（申请金额 ¥${item.amount}）？冻结金额将退回用户余额。`,
      confirmText: '确认拒绝',
      danger: true,
    });
    if (!ok) return;
    setActingCode(item.code);
    setError(null);
    try {
      await api.rejectWithdraw(item.code);
      toast.success(`已拒绝提现码 ${item.code}，冻结金额已退回`);
      await load(page);
    } catch (err) {
      toast.error('拒绝失败', err instanceof Error ? err.message : '未知错误');
    } finally {
      setActingCode(null);
    }
  };

  if (!isAdmin) return <Navigate to="/forbidden" replace />;

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);
  const hasPrev = page > 1;
  const hasNext = page * PAGE_SIZE < total;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-title">提现审批</h2>
          <p className="page-description">
            待审批提现码列表——核销表示已线下打款，拒绝将解冻并退回用户余额
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void load(page)} disabled={loading}>
            <RotateCcw size={14} />
            刷新
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="info-card">
        {loading && !data ? (
          <div className="empty-state">加载中…</div>
        ) : items.length === 0 ? (
          <div className="empty-state">暂无待审批的提现申请</div>
        ) : (
          <>
            <div className="desktop-only">
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>提现码</th>
                    <th>用户</th>
                    <th>申请金额</th>
                    <th>实际到账</th>
                    <th>比例</th>
                    <th>申请时间</th>
                    <th>有效期</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <code className="cdk-code">{item.code}</code>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => void handleCopy(item.code)}
                          style={{ marginLeft: 6 }}
                        >
                          {copiedCode === item.code ? '已复制' : '复制'}
                        </button>
                      </td>
                      <td>
                        <div>{item.user_username ?? '—'}</div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)' }}>
                          {item.user_email ?? item.user_id}
                        </div>
                      </td>
                      <td>¥{item.amount}</td>
                      <td>¥{item.actual_amount}</td>
                      <td>{Math.round(item.ratio * 100)}%</td>
                      <td>{formatTime(item.created_at)}</td>
                      <td>{formatTime(item.expires_at)}</td>
                      <td>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => void handleApprove(item)}
                          disabled={actingCode === item.code}
                        >
                          {actingCode === item.code ? '处理中…' : '核销'}
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => void handleReject(item)}
                          disabled={actingCode === item.code}
                          style={{ marginLeft: 8 }}
                        >
                          拒绝
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>

            {/* 移动端卡片降级（B2.2） */}
            <MobileCardList
              items={items}
              keyExtractor={(item) => item.id}
              emptyText="暂无待审批的提现申请"
              renderHeader={(item) => (
                <>
                  <span className="mc-item-title mono">{item.code}</span>
                  <span className="mc-item-badge">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => void handleCopy(item.code)}
                    >
                      {copiedCode === item.code ? '已复制' : '复制'}
                    </button>
                  </span>
                </>
              )}
              renderBody={(item) => (
                <>
                  <div className="mc-row">
                    <span className="mc-label">用户</span>
                    <span className="mc-value">
                      <div>{item.user_username ?? '—'}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)' }}>
                        {item.user_email ?? item.user_id}
                      </div>
                    </span>
                  </div>
                  <div className="mc-row">
                    <span className="mc-label">申请金额</span>
                    <span className="mc-value">¥{item.amount}</span>
                  </div>
                  <div className="mc-row">
                    <span className="mc-label">实际到账</span>
                    <span className="mc-value">¥{item.actual_amount}</span>
                  </div>
                  <div className="mc-row">
                    <span className="mc-label">比例</span>
                    <span className="mc-value">{Math.round(item.ratio * 100)}%</span>
                  </div>
                  <div className="mc-row">
                    <span className="mc-label">申请时间</span>
                    <span className="mc-value">{formatTime(item.created_at)}</span>
                  </div>
                  <div className="mc-row">
                    <span className="mc-label">有效期</span>
                    <span className="mc-value">{formatTime(item.expires_at)}</span>
                  </div>
                </>
              )}
              renderActions={(item) => (
                <>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => void handleApprove(item)}
                    disabled={actingCode === item.code}
                  >
                    {actingCode === item.code ? '处理中…' : '核销'}
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => void handleReject(item)}
                    disabled={actingCode === item.code}
                    style={{ marginLeft: 8 }}
                  >
                    拒绝
                  </button>
                </>
              )}
            />

            <div className="page-actions" style={{ justifyContent: 'space-between', marginTop: 12 }}>
              <span>
                共 {total} 条，第 {rangeStart} - {rangeEnd} 条
              </span>
              <div>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={!hasPrev || loading}
                >
                  上一页
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasNext || loading}
                  style={{ marginLeft: 8 }}
                >
                  下一页
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
