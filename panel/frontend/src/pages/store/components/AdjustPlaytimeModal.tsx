// ============================================================================
// AdjustPlaytimeModal — v4.19.2 GM Workbench VIP 时长调整弹窗
// 调用 POST /api/store/players/:userId/adjust-playtime（修改 bindings.metadata.vip_expires_at）
// 表单字段：delta_seconds（正数延长 / 负数缩短）+ 原因（可选）
// ============================================================================

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Clock } from 'lucide-react';
import { PanelApiError } from '../../../api/client';
import { useAuth } from '../../../api/auth';
import { LoadingButton, Modal, useToast } from '../../../components/ui';
import type { StorePlayer } from '../../../api/modules/store-gm';

interface AdjustPlaytimeModalProps {
  open: boolean;
  player: StorePlayer | null;
  instanceId: string;
  onClose: () => void;
  onSuccess: () => void;
}

/** 快捷选项：[天数, label] */
const QUICK_OPTIONS: Array<{ days: number; label: string }> = [
  { days: 7, label: '+7 天' },
  { days: 30, label: '+30 天' },
  { days: 90, label: '+90 天' },
  { days: -7, label: '-7 天' },
  { days: -30, label: '-30 天' },
];

function formatExpiresAt(expiresAt: string | null, deltaSeconds: number): string {
  if (!expiresAt && deltaSeconds <= 0) return '无 VIP（不可缩短）';
  const base = expiresAt ? new Date(expiresAt).getTime() : Date.now();
  const baseDate = expiresAt ? new Date(expiresAt) : new Date();
  if (base < Date.now() && deltaSeconds > 0) {
    // 已过期 + 延长 → 从当前时间起算
    const newDate = new Date(Date.now() + deltaSeconds * 1000);
    return newDate.toLocaleString();
  }
  const newDate = new Date(baseDate.getTime() + deltaSeconds * 1000);
  return newDate.toLocaleString();
}

export default function AdjustPlaytimeModal({
  open,
  player,
  instanceId,
  onClose,
  onSuccess,
}: AdjustPlaytimeModalProps) {
  const { api } = useAuth();
  const toast = useToast();

  const [daysInput, setDaysInput] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDaysInput('');
      setReason('');
      setError(null);
    }
  }, [open]);

  // 解析天数 → 秒数（1 天 = 86400 秒）
  const daysNum = Number(daysInput);
  const daysValid =
    daysInput !== '' && Number.isInteger(daysNum) && daysNum >= -365 && daysNum <= 365;
  const deltaSeconds = useMemo(() => daysNum * 86400, [daysNum]);
  const formValid = daysValid && (!player?.vip_expires_at || deltaSeconds > 0 || daysNum > 0);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!player || submitting || !formValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.adjustPlayerPlaytime(player.user_id, {
        instance_id: instanceId,
        delta_seconds: deltaSeconds,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      if (res.success) {
        const sign = deltaSeconds >= 0 ? '+' : '';
        toast.success(
          `${player.username} VIP 时长已调整 ${sign}${daysNum} 天（新到期：${res.current_expires_at ?? '无'}）`,
        );
        onSuccess();
        onClose();
      } else {
        setError('调整失败，请稍后重试');
      }
    } catch (err) {
      setError(err instanceof PanelApiError ? err.message : '调整失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={
        <span className="flex items-center gap-2">
          <Clock size={18} />
          调整 VIP 时长
        </span>
      }
      onClose={onClose}
      disableClose={submitting}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <LoadingButton
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={!formValid}
            form="adjust-playtime-modal-form"
          >
            确认调整
          </LoadingButton>
        </>
      }
    >
      <form id="adjust-playtime-modal-form" onSubmit={handleSubmit} className="space-y-3">
        {player && (
          <div className="alert alert-info alert-sm">
            <span>
              目标玩家：<strong>{player.username}</strong>
              {player.game_player_name && (
                <span className="ml-2 text-base-content/60">（{player.game_player_name}）</span>
              )}
            </span>
            <span className="text-xs text-base-content/60">
              当前 VIP：Lv.{player.vip_level}
              {player.vip_expires_at
                ? ` · 到期 ${new Date(player.vip_expires_at).toLocaleDateString()}`
                : ' · 未开通'}
            </span>
          </div>
        )}

        <div className="form-field">
          <label className="form-field-label">
            调整天数 <span className="text-error">*</span>
          </label>
          <input
            type="number"
            className="input input-bordered w-full"
            min={-365}
            max={365}
            step={1}
            placeholder="正数延长，负数缩短"
            value={daysInput}
            onChange={(e) => setDaysInput(e.target.value)}
            disabled={submitting}
            autoFocus
          />
          {!daysValid && daysInput !== '' && (
            <p className="form-field-error">天数需为 -365 到 365 之间的整数</p>
          )}
          {/* 快捷选项 */}
          <div className="flex flex-wrap gap-2 mt-2">
            {QUICK_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                type="button"
                className="btn btn-ghost btn-xs"
                disabled={submitting}
                onClick={() => setDaysInput(String(opt.days))}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 预览：调整后的到期时间 */}
        {player && daysValid && (
          <div className="alert alert-info alert-sm">
            <span className="text-xs">
              预计新到期：<strong>{formatExpiresAt(player.vip_expires_at, deltaSeconds)}</strong>
            </span>
          </div>
        )}

        <div className="form-field">
          <label className="form-field-label">原因（可选）</label>
          <textarea
            className="textarea textarea-bordered w-full"
            rows={2}
            placeholder="如：补偿掉线时长 / 活动奖励"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            disabled={submitting}
          />
        </div>

        {error && (
          <div className="alert alert-error alert-sm">
            <span>{error}</span>
          </div>
        )}
      </form>
    </Modal>
  );
}
