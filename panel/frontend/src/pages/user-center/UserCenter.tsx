// ============================================================================
// UserCenter — 个人中心经济系统主页（/user-center）
//
// 功能：余额总览 + 快捷操作（CDK充值/生成CDKey/提现）+ 跨实例汇总 + 最近交易 + 提现记录
// API：getBalanceSummary / getTransactions / getWithdrawHistory
// 设计：Apple 浅色主题，KPI 卡片 + 操作入口 + 数据表格
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Coins,
  CreditCard,
  Gift,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../components/ui';
import {
  getBalanceSummary,
  getTransactions,
  getWithdrawHistory,
  formatMoney,
  formatTime,
  TX_TYPE_LABEL,
  TX_TYPE_BADGE,
  WITHDRAW_STATUS_LABEL,
  WITHDRAW_STATUS_BADGE,
  type BalanceInfo,
  type BalanceSummaryInstance,
  type WalletTransaction,
  type WithdrawCode,
} from './api';
import CdkRechargeModal from './components/CdkRechargeModal';
import CdkGenerateModal from './components/CdkGenerateModal';
import WithdrawModal from './components/WithdrawModal';

// ============================================================================
// 组件
// ============================================================================

export default function UserCenter() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  useDocumentTitle('个人中心');

  // 数据状态
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [instances, setInstances] = useState<BalanceSummaryInstance[]>([]);
  const [recentTx, setRecentTx] = useState<WalletTransaction[]>([]);
  const [withdraws, setWithdraws] = useState<WithdrawCode[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal 状态
  const [showCdkRecharge, setShowCdkRecharge] = useState(false);
  const [showCdkGenerate, setShowCdkGenerate] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [summary, txPage, wdPage] = await Promise.all([
        getBalanceSummary(token),
        getTransactions(token, { page: 1, page_size: 5 }),
        getWithdrawHistory(token, 1, 5),
      ]);
      setBalance(summary.balance);
      setInstances(summary.instances);
      setRecentTx(txPage.items);
      setWithdraws(wdPage.items);
    } catch (err) {
      toast.error(err instanceof PanelApiError ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [token, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 实例名称查找（最近交易列表用）
  const serverNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const inst of instances) {
      if (inst.server_name) map.set(inst.server_id, inst.server_name);
    }
    return map;
  }, [instances]);

  // 待核销提现数量
  const pendingWithdrawCount = useMemo(
    () => withdraws.filter((w) => w.status === 'pending').length,
    [withdraws],
  );

  // 可用余额（用于提现/CDKey生成）
  const availableBalance = balance?.available_balance ?? 0;

  return (
    <div className="page">
      {/* 页头 */}
      <div className="page-header">
        <h2 className="page-title">个人中心</h2>
        <div className="page-actions">
          <button
            className="btn btn-ghost"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
      </div>

      {/* KPI 卡片 */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <div className="stats-chip stats-chip-total">
          <span className="stats-chip-label">总余额</span>
          <span className="stats-chip-value">
            {loading ? '…' : formatMoney(balance?.balance ?? 0)}
          </span>
        </div>
        <div className="stats-chip stats-chip-active">
          <span className="stats-chip-label">可用余额</span>
          <span className="stats-chip-value">
            {loading ? '…' : formatMoney(availableBalance)}
          </span>
        </div>
        <div className="stats-chip stats-chip-disabled">
          <span className="stats-chip-label">冻结余额</span>
          <span className="stats-chip-value">
            {loading ? '…' : formatMoney(balance?.frozen_balance ?? 0)}
          </span>
        </div>
        <div className="stats-chip">
          <span className="stats-chip-label">累计收入</span>
          <span className="stats-chip-value">
            {loading ? '…' : formatMoney(balance?.total_earned ?? 0)}
          </span>
        </div>
        <div className="stats-chip">
          <span className="stats-chip-label">累计支出</span>
          <span className="stats-chip-value">
            {loading ? '…' : formatMoney(balance?.total_spent ?? 0)}
          </span>
        </div>
        <div className="stats-chip">
          <span className="stats-chip-label">累计提现</span>
          <span className="stats-chip-value">
            {loading ? '…' : formatMoney(balance?.total_withdrawn ?? 0)}
          </span>
        </div>
      </div>

      {/* 快捷操作 */}
      <div className="info-card">
        <h3 className="card-title">快捷操作</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            onClick={() => setShowCdkRecharge(true)}
          >
            <KeyRound size={14} />
            CDK 充值
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowCdkGenerate(true)}
            disabled={availableBalance <= 0}
          >
            <Gift size={14} />
            生成 CDKey
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowWithdraw(true)}
            disabled={availableBalance <= 0}
          >
            <Wallet size={14} />
            申请提现
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => navigate('transactions')}
          >
            <CreditCard size={14} />
            交易记录
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => navigate('stats')}
          >
            <Coins size={14} />
            消费统计
          </button>
          {/* v4.31.0: 安全中心入口（登录历史 + 我的活动 + 上次登录信息） */}
          <button
            className="btn btn-ghost"
            onClick={() => navigate('security')}
          >
            <ShieldCheck size={14} />
            安全中心
          </button>
        </div>
        {pendingWithdrawCount > 0 && (
          <div className="alert alert-info" style={{ marginTop: 12 }}>
            您有 {pendingWithdrawCount} 笔提现申请待核销，请将提现码提供给服务器管理员
          </div>
        )}
      </div>

      {/* 跨实例汇总 */}
      {instances.length > 0 && (
        <div className="info-card">
          <h3 className="card-title">跨实例汇总</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>实例</th>
                  <th>点券余额</th>
                  <th>点券累计获得</th>
                  <th>点券累计消费</th>
                  <th>VIP 状态</th>
                </tr>
              </thead>
              <tbody>
                {instances.map((inst) => (
                  <tr key={inst.server_id}>
                    <td className="cell-name">{inst.server_name || inst.server_id}</td>
                    <td className="mono">{formatMoney(inst.points.balance)}</td>
                    <td className="mono">{formatMoney(inst.points.total_earned)}</td>
                    <td className="mono">{formatMoney(inst.points.total_spent)}</td>
                    <td>
                      {inst.vip_status.is_active && inst.vip_status.vip_type ? (
                        <span className="badge badge-running">
                          {inst.vip_status.vip_type === 'lifetime' ? '买断 VIP' : '订阅 VIP'}
                          {inst.vip_status.vip_level > 0 ? ` Lv.${inst.vip_status.vip_level}` : ''}
                        </span>
                      ) : (
                        <span className="badge badge-stopped">无 VIP</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 最近交易 */}
      <div className="info-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 className="card-title" style={{ margin: 0 }}>最近交易</h3>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => navigate('transactions')}
          >
            查看全部
          </button>
        </div>
        {loading ? (
          <div className="empty-state" style={{ padding: '24px' }}>
            <p>加载中…</p>
          </div>
        ) : recentTx.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px' }}>
            <p>暂无交易记录</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {recentTx.map((tx) => (
              <div
                key={tx.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: tx.amount >= 0 ? 'rgba(52,199,89,0.1)' : 'rgba(255,59,48,0.1)',
                    color: tx.amount >= 0 ? '#34C759' : '#FF3B30',
                    flexShrink: 0,
                  }}
                >
                  {tx.amount >= 0 ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className={`badge ${TX_TYPE_BADGE[tx.type] ?? 'badge-stopped'}`}>
                      {TX_TYPE_LABEL[tx.type] ?? tx.type}
                    </span>
                    {tx.server_id && (
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {serverNameMap.get(tx.server_id) ?? tx.server_id}
                      </span>
                    )}
                  </div>
                  {tx.description && (
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tx.description}
                    </p>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div
                    className="mono"
                    style={{
                      fontWeight: 600,
                      color: tx.amount >= 0 ? '#34C759' : '#FF3B30',
                    }}
                  >
                    {tx.amount >= 0 ? '+' : ''}{formatMoney(tx.amount)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {formatTime(tx.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 提现记录 */}
      {withdraws.length > 0 && (
        <div className="info-card">
          <h3 className="card-title">提现记录</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>提现码</th>
                  <th>申请金额</th>
                  <th>实际到账</th>
                  <th>状态</th>
                  <th>申请时间</th>
                </tr>
              </thead>
              <tbody>
                {withdraws.map((w) => (
                  <tr key={w.id}>
                    <td className="mono">{w.code}</td>
                    <td className="mono">{formatMoney(w.amount)}</td>
                    <td className="mono">{formatMoney(w.actual_amount)}</td>
                    <td>
                      <span className={`badge ${WITHDRAW_STATUS_BADGE[w.status] ?? 'badge-stopped'}`}>
                        {WITHDRAW_STATUS_LABEL[w.status] ?? w.status}
                      </span>
                    </td>
                    <td>{formatTime(w.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      <CdkRechargeModal
        open={showCdkRecharge}
        onClose={() => setShowCdkRecharge(false)}
        onSuccess={() => void refresh()}
      />
      <CdkGenerateModal
        open={showCdkGenerate}
        onClose={() => setShowCdkGenerate(false)}
        onSuccess={() => void refresh()}
        instances={instances}
        availableBalance={availableBalance}
      />
      <WithdrawModal
        open={showWithdraw}
        onClose={() => setShowWithdraw(false)}
        onSuccess={() => void refresh()}
        availableBalance={availableBalance}
        lastIncomeAt={balance?.last_income_at ?? null}
      />
    </div>
  );
}
