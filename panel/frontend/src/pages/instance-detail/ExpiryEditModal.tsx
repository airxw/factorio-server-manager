// ============================================================================
// ExpiryEditModal — 管理员修改实例有效期弹窗（v4.36.0 从 ServerDetail 抽离）
// 职责：设为永久 / 快捷延长 N 天 / 自定义到期日期 三种提交路径
// 状态：customDate 为组件内局部状态——弹窗关闭即卸载，状态自动重置
// ============================================================================

import { useState } from 'react';
import { useToast } from '../../components/ui';

export interface ExpiryEditModalProps {
  /** 当前有效期展示文本（如 "2026-08-01 到期" / "永久有效"） */
  currentExpiryText: string;
  /** 提交中（mutation isPending），禁用所有按钮 */
  isPending: boolean;
  /** 提交有效期：durationDays = null 表示永久 */
  onSubmit: (durationDays: number | null) => void;
  /** 取消/关闭 */
  onClose: () => void;
}

export default function ExpiryEditModal({
  currentExpiryText,
  isPending,
  onSubmit,
  onClose,
}: ExpiryEditModalProps) {
  const toast = useToast();
  const [customDate, setCustomDate] = useState('');

  // 自定义日期 → 计算天数后委托 onSubmit
  const submitCustom = () => {
    if (!customDate) {
      toast.error('请选择到期日期');
      return;
    }
    const targetDate = new Date(customDate);
    const days = Math.ceil((targetDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (days <= 0) {
      toast.error('到期日期必须晚于当前时间');
      return;
    }
    onSubmit(days);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.32)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: 24,
          width: 'min(420px, 92vw)',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.25)',
        }}
      >
        <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 600 }}>修改有效期</h3>
        <p
          style={{
            margin: '0 0 16px',
            fontSize: 13,
            color: 'var(--color-text-muted, #86868b)',
          }}
        >
          当前：{currentExpiryText}
        </p>

        {/* 设为永久 */}
        <button
          type="button"
          style={{
            width: '100%',
            padding: '10px 14px',
            borderRadius: 12,
            border: '1px solid var(--color-border, #d2d2d7)',
            background: '#f5f5f7',
            fontSize: 14,
            cursor: 'pointer',
            marginBottom: 8,
          }}
          onClick={() => onSubmit(null)}
          disabled={isPending}
        >
          设为永久
        </button>

        {/* 快捷预设：延长 N 天 */}
        <div style={{ marginBottom: 16 }}>
          <p
            style={{
              margin: '0 0 8px',
              fontSize: 12,
              color: 'var(--color-text-muted, #86868b)',
            }}
          >
            延长有效期
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[7, 30, 90, 365].map((d) => (
              <button
                key={d}
                type="button"
                style={{
                  padding: '6px 14px',
                  borderRadius: 999,
                  border: '1px solid var(--color-border, #d2d2d7)',
                  background: '#fff',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
                onClick={() => onSubmit(d)}
                disabled={isPending}
              >
                +{d} 天
              </button>
            ))}
          </div>
        </div>

        {/* 自定义到期日期 */}
        <div style={{ marginBottom: 20 }}>
          <p
            style={{
              margin: '0 0 8px',
              fontSize: 12,
              color: 'var(--color-text-muted, #86868b)',
            }}
          >
            自定义到期日期
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid var(--color-border, #d2d2d7)',
                fontSize: 14,
              }}
            />
            <button
              type="button"
              style={{
                padding: '8px 16px',
                borderRadius: 10,
                border: 'none',
                background: '#0071e3',
                color: '#fff',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
              onClick={submitCustom}
              disabled={isPending || !customDate}
            >
              提交
            </button>
          </div>
        </div>

        {/* 取消 */}
        <button
          type="button"
          style={{
            width: '100%',
            padding: '10px 14px',
            borderRadius: 12,
            border: 'none',
            background: 'transparent',
            color: 'var(--color-text-muted, #86868b)',
            fontSize: 14,
            cursor: 'pointer',
          }}
          onClick={onClose}
          disabled={isPending}
        >
          取消
        </button>
      </div>
    </div>
  );
}
