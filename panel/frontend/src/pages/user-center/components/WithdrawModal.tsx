// ============================================================================
// WithdrawModal — 申请提现弹窗（用户中心经济系统）
// POST /api/me/withdraw {amount} → 返回提现码（withdraw_code）+ 实际到账 + 过期时间
// 规则（与后端 withdrawService.createWithdraw 对齐）：
//   - 金额为正整数，不超过可用余额（冻结部分不可提现）
//   - 账期：最后一笔收入需满 7 天（前端预检 + 后端强制）
//   - 实际到账 = 申请金额 × 平台提现比例（申请时快照，以响应为准）
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Copy, Wallet } from 'lucide-react';
import { Modal, useToast } from '../../../components/ui';
import { useAuth } from '../../../api/auth';
import { PanelApiError } from '../../../api/client';
import {
  createWithdraw,
  formatMoney,
  formatTime,
  type CreateWithdrawResponse,
} from '../api';

/** 提现账期天数（与后端 WITHDRAW_PERIOD_DAYS 一致） */
const WITHDRAW_PERIOD_DAYS = 7;

interface WithdrawModalProps {
  open: boolean;
  onClose: () => void;
  /** 申请成功后回调（父组件刷新余额/提现记录） */
  onSuccess?: () => void;
  /** 当前可用余额 */
  availableBalance: number;
  /** 最后一笔收入时间（用于账期预检；null 视为满足账期） */
  lastIncomeAt: string | null;
}

export default function WithdrawModal({
  open,
  onClose,
  onSuccess,
  availableBalance,
  lastIncomeAt,
}: WithdrawModalProps) {
  const { token } = useAuth();
  const toast = useToast();

  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateWithdrawResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // 弹窗每次打开时重置表单
  useEffect(() => {
    if (!open) return;
    setAmount('');
    setResult(null);
    setCopied(false);
  }, [open]);

  /** 账期预检：最后一笔收入满 7 天才可提现（后端仍强制校验） */
  const periodState = useMemo((): { met: boolean; eligibleAt: Date | null } => {
    if (!lastIncomeAt) return { met: true, eligibleAt: null };
    const eligibleAt = new Date(
      new Date(lastIncomeAt).getTime() + WITHDRAW_PERIOD_DAYS * 24 * 60 * 60 * 1000,
    );
    return { met: eligibleAt.getTime() <= Date.now(), eligibleAt };
  }, [lastIncomeAt]);

  const parsedAmount = Number.parseInt(amount, 10);
  const amountValid = Number.isInteger(parsedAmount) && parsedAmount > 0;
  const exceedBalance = amountValid && parsedAmount > availableBalance;

  const canSubmit =
    !submitting && periodState.met && amountValid && !exceedBalance;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await createWithdraw(token, parsedAmount);
      setResult(res);
      toast.success('提现申请已提交，请将提现码提供给服务器管理员核销');
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof PanelApiError ? err.message : '提现申请失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.withdraw_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('复制失败', '浏览器不支持剪贴板或非 HTTPS 环境');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="申请提现"
      disableClose={submitting}
      footer={
        result ? (
          <button className="btn btn-primary" onClick={onClose}>
            完成
          </button>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
            >
              <Wallet size={14} />
              {submitting ? '提交中…' : '提交申请'}
            </button>
          </>
        )
      }
    >
      {result ? (
        /* ---------- 申请成功视图 ---------- */
        <div style={{ textAlign: 'center' }}>
          <p className="form-hint" style={{ marginTop: 0 }}>
            请将以下提现码提供给服务器管理员，核销后到账
          </p>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              margin: '12px 0',
            }}
          >
            <code
              style={{
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: '0.12em',
                padding: '10px 16px',
                borderRadius: 10,
                background: 'rgba(0,122,255,0.08)',
                color: '#007AFF',
              }}
            >
              {result.withdraw_code}
            </code>
            <button className="btn btn-ghost btn-sm" onClick={() => void handleCopy()}>
              <Copy size={13} />
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <p className="form-hint">
            实际到账 {formatMoney(result.actual_amount)} ・ 有效期至 {formatTime(result.expires_at)}
          </p>
        </div>
      ) : (
        /* ---------- 表单视图 ---------- */
        <div style={{ display: 'grid', gap: 12 }}>
          {!periodState.met && periodState.eligibleAt && (
            <div className="alert alert-error">
              账期未满：最后一笔收入需满 {WITHDRAW_PERIOD_DAYS} 天后方可提现（
              {periodState.eligibleAt.toLocaleString('zh-CN', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
              {' '}后可申请）
            </div>
          )}

          <div>
            <label className="form-hint" style={{ display: 'block', marginBottom: 6 }}>
              提现金额（正整数）
            </label>
            <input
              type="number"
              min={1}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`当前可用 ${formatMoney(availableBalance)}`}
              disabled={submitting || !periodState.met}
              aria-label="提现金额"
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
            <p className="form-hint" style={{ margin: '6px 0 0' }}>
              可用余额 {formatMoney(availableBalance)}
              {exceedBalance && (
                <span style={{ color: '#FF3B30' }}>（超出可用余额）</span>
              )}
            </p>
          </div>

          <div
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              background: 'rgba(0,122,255,0.06)',
              fontSize: 13,
            }}
          >
            <span className="form-hint">
              提交后金额将从可用余额中冻结，实际到账 = 申请金额 × 平台提现比例（以审核结果为准）。
              管理员拒绝或提现码过期将自动解冻退回。
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
}
