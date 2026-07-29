// ============================================================================
// CompensateModal — v4.19.2 GM Workbench 玩家补偿发放弹窗
// 调用 POST /api/store/players/:userId/compensate（RCON give 物品）
// 表单字段：物品名 + 数量 + 原因（可选）
// ============================================================================

import { useEffect, useState, type FormEvent } from 'react';
import { Gift } from 'lucide-react';
import { PanelApiError } from '../../../api/client';
import { useAuth } from '../../../api/auth';
import { LoadingButton, Modal, useToast } from '../../../components/ui';
import type { StorePlayer } from '../../../api/modules/store-gm';

interface CompensateModalProps {
  open: boolean;
  player: StorePlayer | null;
  instanceId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CompensateModal({
  open,
  player,
  instanceId,
  onClose,
  onSuccess,
}: CompensateModalProps) {
  const { api } = useAuth();
  const toast = useToast();

  const [item, setItem] = useState('');
  const [count, setCount] = useState('1');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 每次打开时重置表单
  useEffect(() => {
    if (open) {
      setItem('');
      setCount('1');
      setReason('');
      setError(null);
    }
  }, [open]);

  // 校验
  const countNum = Number(count);
  const countValid =
    count !== '' && Number.isInteger(countNum) && countNum >= 1 && countNum <= 9999;
  const itemValid = item.trim().length >= 1 && item.trim().length <= 64;
  const formValid = itemValid && countValid;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!player || submitting || !formValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.compensatePlayer(player.user_id, {
        instance_id: instanceId,
        item: item.trim(),
        count: countNum,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      if (res.success) {
        toast.success(`已向 ${player.username} 发放 ${countNum} × ${item.trim()}`);
        onSuccess();
        onClose();
      } else {
        setError(res.error ?? '发放失败，游戏进程未确认');
      }
    } catch (err) {
      setError(err instanceof PanelApiError ? err.message : '发放失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={
        <span className="flex items-center gap-2">
          <Gift size={18} />
          发放补偿
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
            form="compensate-modal-form"
          >
            确认发放
          </LoadingButton>
        </>
      }
    >
      <form id="compensate-modal-form" onSubmit={handleSubmit} className="space-y-3">
        {player && (
          <div className="alert alert-info alert-sm">
            <span>
              目标玩家：<strong>{player.username}</strong>
              {player.game_player_name && (
                <span className="ml-2 text-base-content/60">（{player.game_player_name}）</span>
              )}
            </span>
          </div>
        )}

        <div className="form-field">
          <label className="form-field-label">
            物品名 <span className="text-error">*</span>
          </label>
          <input
            type="text"
            className="input input-bordered w-full"
            placeholder="如：diamond / minecraft:diamond"
            value={item}
            onChange={(e) => setItem(e.target.value)}
            maxLength={64}
            disabled={submitting}
            autoFocus
          />
          {!itemValid && item.length > 0 && (
            <p className="form-field-error">物品名长度 1-64 字符</p>
          )}
        </div>

        <div className="form-field">
          <label className="form-field-label">
            数量 <span className="text-error">*</span>
          </label>
          <input
            type="number"
            className="input input-bordered w-full"
            min={1}
            max={9999}
            step={1}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            disabled={submitting}
          />
          {!countValid && count !== '' && (
            <p className="form-field-error">数量需为 1-9999 的整数</p>
          )}
        </div>

        <div className="form-field">
          <label className="form-field-label">原因（可选）</label>
          <textarea
            className="textarea textarea-bordered w-full"
            rows={2}
            placeholder="如：补偿掉线损失"
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
