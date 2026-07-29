// ============================================================================
// BanConfirmModal — v4.19.2 GM Workbench 玩家封禁确认弹窗
// 调用 POST /api/store/players/:userId/ban（RCON ban 命令）
// 表单字段：封禁原因（可选）+ 二次确认勾选
// ============================================================================

import { useEffect, useState, type FormEvent } from 'react';
import { ShieldOff, AlertTriangle } from 'lucide-react';
import { PanelApiError } from '../../../api/client';
import { useAuth } from '../../../api/auth';
import { LoadingButton, Modal, useToast } from '../../../components/ui';
import type { StorePlayer } from '../../../api/modules/store-gm';

interface BanConfirmModalProps {
  open: boolean;
  player: StorePlayer | null;
  instanceId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function BanConfirmModal({
  open,
  player,
  instanceId,
  onClose,
  onSuccess,
}: BanConfirmModalProps) {
  const { api } = useAuth();
  const toast = useToast();

  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setAcknowledged(false);
      setError(null);
    }
  }, [open]);

  const formValid = acknowledged;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!player || submitting || !formValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.banStorePlayer(player.user_id, {
        instance_id: instanceId,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      if (res.success) {
        toast.success(`已封禁玩家 ${player.username}`);
        onSuccess();
        onClose();
      } else {
        setError(res.error ?? '封禁失败，游戏进程未确认');
      }
    } catch (err) {
      setError(err instanceof PanelApiError ? err.message : '封禁失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={
        <span className="flex items-center gap-2 text-error">
          <ShieldOff size={18} />
          封禁玩家
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
            variant="danger"
            loading={submitting}
            disabled={!formValid}
            form="ban-modal-form"
          >
            确认封禁
          </LoadingButton>
        </>
      }
    >
      <form id="ban-modal-form" onSubmit={handleSubmit} className="space-y-3">
        {player && (
          <div className="alert alert-warning alert-sm">
            <AlertTriangle size={16} />
            <span>
              即将封禁玩家 <strong>{player.username}</strong>
              {player.game_player_name && (
                <span className="ml-2 text-base-content/60">（{player.game_player_name}）</span>
              )}
              ，封禁后该玩家将无法再次加入本实例。
            </span>
          </div>
        )}

        <div className="form-field">
          <label className="form-field-label">封禁原因（可选）</label>
          <textarea
            className="textarea textarea-bordered w-full"
            rows={2}
            placeholder="如：使用外挂 / 恶意破坏他人建筑"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            disabled={submitting}
            autoFocus
          />
        </div>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            disabled={submitting}
            className="checkbox checkbox-error checkbox-sm mt-0.5"
          />
          <span className="text-sm">
            我已确认封禁操作不可撤销，且该操作会通过 RCON 下发到游戏进程立即生效。
          </span>
        </label>

        {error && (
          <div className="alert alert-error alert-sm">
            <span>{error}</span>
          </div>
        )}
      </form>
    </Modal>
  );
}
