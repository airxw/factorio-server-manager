// ============================================================================
// CdkRechargeModal — CDK 充值弹窗（用户中心经济系统）
// 兑换 POST /api/cdk/redeem（复用 client.ts 的 api.redeemCdkGlobal）
// 支持物品/余额/点券/VIP 全部 CDK 类型；含充值超限（余额≥阈值）禁用态
// ============================================================================

import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Modal, useToast } from '../../../components/ui';
import { useAuth } from '../../../api/auth';
import { PanelApiError } from '../../../api/client';

interface CdkRechargeModalProps {
  open: boolean;
  onClose: () => void;
  /** 兑换成功后回调（父组件刷新余额等数据） */
  onSuccess?: () => void;
  /** 充值入口禁用（余额已达平台阈值） */
  disabled?: boolean;
  /** 禁用原因说明（如「余额已达上限（¥1000），请消费后再充值」） */
  disabledReason?: string;
}

export default function CdkRechargeModal({
  open,
  onClose,
  onSuccess,
  disabled = false,
  disabledReason,
}: CdkRechargeModalProps) {
  const { api } = useAuth();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 弹窗每次打开时重置输入
  useEffect(() => {
    if (open) setCode('');
  }, [open]);

  const handleSubmit = async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      toast.error('请输入 CDK 兑换码');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.redeemCdkGlobal({ code: trimmed });
      if (res.delivered) {
        const itemLabel = res.code.gift_name ?? res.code.item_name;
        toast.success(`兑换成功：${itemLabel}`);
        if (res.followed) {
          toast.info('已自动关注对应服务器');
        }
        onSuccess?.();
        onClose();
      } else {
        toast.error('兑换失败：卡密无效或已被使用');
      }
    } catch (err) {
      toast.error(err instanceof PanelApiError ? err.message : '兑换失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="CDK 充值 / 兑换"
      disableClose={submitting}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void handleSubmit()}
            disabled={submitting || disabled || !code.trim()}
          >
            <KeyRound size={14} />
            {submitting ? '兑换中…' : '立即兑换'}
          </button>
        </>
      }
    >
      {disabled ? (
        <div className="alert alert-error" style={{ marginBottom: 12 }}>
          {disabledReason ?? '余额已达充值上限，请消费后再充值'}
        </div>
      ) : (
        <p className="form-hint" style={{ marginTop: 0 }}>
          支持余额 / 点券 / VIP / 物品礼包 CDK，兑换成功自动入账并关注对应服务器
        </p>
      )}
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="输入 CDK 兑换码"
        maxLength={64}
        disabled={disabled || submitting}
        aria-label="CDK 兑换码"
        style={{
          width: '100%',
          letterSpacing: '0.1em',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          textAlign: 'center',
          boxSizing: 'border-box',
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !disabled && code.trim()) void handleSubmit();
        }}
      />
    </Modal>
  );
}
