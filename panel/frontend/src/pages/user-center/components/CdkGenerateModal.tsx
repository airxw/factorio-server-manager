// ============================================================================
// CdkGenerateModal — 用户自生成转赠 CDKey 弹窗（用户中心经济系统）
// POST /api/cdk/generate：points（点券面值，按兑换比折算冻结）/ vip（按实例定价冻结）
// 冻结余额，7 天有效期；成本公式与后端 cdkService.generateUserCdk 一致：
//   points → ceil(amount / points_exchange_ratio)；vip → vip_*_price
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Copy, Ticket } from 'lucide-react';
import { Modal, useToast } from '../../../components/ui';
import { useAuth } from '../../../api/auth';
import { PanelApiError } from '../../../api/client';
import {
  formatMoney,
  formatTime,
  generateUserCdk,
  getServerPricing,
  type BalanceSummaryInstance,
  type GenerateUserCdkResult,
  type InstancePricing,
} from '../api';

interface CdkGenerateModalProps {
  open: boolean;
  onClose: () => void;
  /** 生成成功后回调（父组件刷新余额/流水） */
  onSuccess?: () => void;
  /** 已绑定实例列表（server_id + server_name） */
  instances: BalanceSummaryInstance[];
  /** 当前可用余额（用于成本预估提示） */
  availableBalance: number;
}

export default function CdkGenerateModal({
  open,
  onClose,
  onSuccess,
  instances,
  availableBalance,
}: CdkGenerateModalProps) {
  const { token } = useAuth();
  const toast = useToast();

  const [cdkType, setCdkType] = useState<'points' | 'vip'>('points');
  const [serverId, setServerId] = useState('');
  const [amount, setAmount] = useState('');
  const [vipDuration, setVipDuration] = useState<'monthly' | 'lifetime'>('monthly');
  const [pricing, setPricing] = useState<InstancePricing | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<GenerateUserCdkResult | null>(null);
  const [copied, setCopied] = useState(false);

  // 弹窗打开时重置表单并默认选中第一个实例
  useEffect(() => {
    if (!open) return;
    setCdkType('points');
    setAmount('');
    setVipDuration('monthly');
    setResult(null);
    setCopied(false);
    setServerId((prev) =>
      prev && instances.some((i) => i.server_id === prev)
        ? prev
        : (instances[0]?.server_id ?? ''),
    );
  }, [open, instances]);

  // 实例切换时拉取定价（成本预估）
  useEffect(() => {
    if (!open || !serverId) {
      setPricing(null);
      return;
    }
    let cancelled = false;
    setPricingLoading(true);
    getServerPricing(token, serverId)
      .then((p) => {
        if (!cancelled) setPricing(p);
      })
      .catch(() => {
        if (!cancelled) setPricing(null);
      })
      .finally(() => {
        if (!cancelled) setPricingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, serverId, token]);

  /** 冻结成本预估（与后端公式一致） */
  const estimatedCost = useMemo((): number | null => {
    if (!pricing) return null;
    if (cdkType === 'points') {
      const n = Number.parseInt(amount, 10);
      if (!Number.isInteger(n) || n <= 0) return null;
      return Math.ceil(n / pricing.points_exchange_ratio);
    }
    return vipDuration === 'monthly' ? pricing.vip_monthly_price : pricing.vip_lifetime_price;
  }, [pricing, cdkType, amount, vipDuration]);

  const insufficient = estimatedCost !== null && estimatedCost > availableBalance;

  const canSubmit =
    !submitting &&
    !pricingLoading &&
    !!serverId &&
    estimatedCost !== null &&
    !insufficient &&
    (cdkType === 'points'
      ? Number.isInteger(Number.parseInt(amount, 10)) && Number.parseInt(amount, 10) > 0
      : true);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await generateUserCdk(token, {
        type: cdkType,
        server_id: serverId,
        ...(cdkType === 'points'
          ? { amount: Number.parseInt(amount, 10) }
          : { vip_duration: vipDuration }),
      });
      setResult(res);
      toast.success(`CDKey 已生成，冻结余额 ${formatMoney(res.frozen_amount)}`);
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof PanelApiError ? err.message : '生成失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.code);
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
      title="生成转赠 CDKey"
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
              <Ticket size={14} />
              {submitting
                ? '生成中…'
                : estimatedCost !== null
                  ? `冻结 ${formatMoney(estimatedCost)} 并生成`
                  : '生成 CDKey'}
            </button>
          </>
        )
      }
    >
      {result ? (
        /* ---------- 生成成功视图 ---------- */
        <div style={{ textAlign: 'center' }}>
          <p className="form-hint" style={{ marginTop: 0 }}>
            CDKey 已生成（7 天有效，过期未兑换自动解冻退回）
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
              {result.code}
            </code>
            <button className="btn btn-ghost btn-sm" onClick={() => void handleCopy()}>
              <Copy size={13} />
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <p className="form-hint">
            冻结余额 {formatMoney(result.frozen_amount)} ・ 有效期至 {formatTime(result.expires_at)}
          </p>
        </div>
      ) : (
        /* ---------- 表单视图 ---------- */
        <div style={{ display: 'grid', gap: 12 }}>
          {instances.length === 0 ? (
            <div className="alert alert-error">暂无已绑定实例，无法生成 CDKey</div>
          ) : (
            <>
              {/* 类型选择 */}
              <div>
                <label className="form-hint" style={{ display: 'block', marginBottom: 6 }}>
                  CDKey 类型
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['points', 'vip'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`btn btn-sm ${cdkType === t ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setCdkType(t)}
                      disabled={submitting}
                    >
                      {t === 'points' ? '点券' : 'VIP'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 实例选择 */}
              <div>
                <label className="form-hint" style={{ display: 'block', marginBottom: 6 }}>
                  所属实例
                </label>
                <select
                  value={serverId}
                  onChange={(e) => setServerId(e.target.value)}
                  disabled={submitting}
                  aria-label="选择实例"
                  style={{ width: '100%' }}
                >
                  {instances.map((inst) => (
                    <option key={inst.server_id} value={inst.server_id}>
                      {inst.server_name || inst.server_id}
                    </option>
                  ))}
                </select>
              </div>

              {/* 面值 / VIP 时长 */}
              {cdkType === 'points' ? (
                <div>
                  <label className="form-hint" style={{ display: 'block', marginBottom: 6 }}>
                    点券面值（正整数）
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="如 100"
                    disabled={submitting}
                    aria-label="点券面值"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                  {pricing && (
                    <p className="form-hint" style={{ margin: '6px 0 0' }}>
                      当前兑换比例 1 余额 = {pricing.points_exchange_ratio} 点券
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <label className="form-hint" style={{ display: 'block', marginBottom: 6 }}>
                    VIP 时长
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['monthly', 'lifetime'] as const).map((d) => {
                      const price =
                        pricing === null
                          ? null
                          : d === 'monthly'
                            ? pricing.vip_monthly_price
                            : pricing.vip_lifetime_price;
                      return (
                        <button
                          key={d}
                          type="button"
                          className={`btn btn-sm ${vipDuration === d ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={() => setVipDuration(d)}
                          disabled={submitting || price === null}
                          title={price === null ? '该实例未开放此类型 VIP' : undefined}
                        >
                          {d === 'monthly' ? '订阅制（月）' : '买断制（永久）'}
                          {price !== null ? ` ${formatMoney(price)}` : '（未开放）'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 成本预估 */}
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: insufficient ? 'rgba(255,59,48,0.08)' : 'rgba(0,122,255,0.06)',
                  fontSize: 13,
                }}
              >
                {pricingLoading ? (
                  <span className="form-hint">读取实例定价中…</span>
                ) : estimatedCost !== null ? (
                  <>
                    预计冻结余额 <strong>{formatMoney(estimatedCost)}</strong>
                    <span className="form-hint">
                      {' '}
                      （当前可用 {formatMoney(availableBalance)}）
                    </span>
                    {insufficient && (
                      <div style={{ color: '#FF3B30', marginTop: 4 }}>可用余额不足</div>
                    )}
                  </>
                ) : (
                  <span className="form-hint">填写面值后显示冻结成本预估</span>
                )}
              </div>

              <p className="form-hint" style={{ margin: 0 }}>
                生成后冻结对应余额；好友凭此 CDKey 在「CDK 充值」中兑换到账。7 天未兑换自动解冻退回。
              </p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
