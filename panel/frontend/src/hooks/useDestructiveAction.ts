// ============================================================================
// useDestructiveAction — 破坏性操作统一 hook（B2 批次）
// 提供 preview → confirm → execute → 失败 rollback 的标准流程
// 用于：SSL deploy / Maintenance 一键清理 / Cleanup 实例删除 / Pack 删除
//
// 用法：
//   const action = useDestructiveAction({
//     preview: async (args) => { const r = await api.preview(args); return r; },
//     execute: async (args) => { await api.execute(args); },
//     rollback: async (args) => { await api.rollback(args); },
//   });
//   const ok = await action.run(args, { title: '确认删除', requireText: true, requireTextMatch: 'CONFIRM' });
// ============================================================================

import { useCallback, useState } from 'react';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';

export interface DestructiveAction<TPreview, TArgs> {
  /** 预览：返回将受影响的资源清单 */
  preview?: (args: TArgs) => Promise<TPreview>;
  /** 执行破坏性操作 */
  execute: (args: TArgs) => Promise<void>;
  /** 失败回滚（可选） */
  rollback?: (args: TArgs) => Promise<void>;
}

export interface DestructiveRunOptions {
  /** 对话框标题 */
  title: string;
  /** 提示文本 */
  message?: string;
  /** 确认按钮文字 */
  confirmText?: string;
  /** 是否要求输入文本确认 */
  requireText?: boolean;
  /** 输入确认需匹配的文本 */
  requireTextMatch?: string;
  /** 自定义预览文本格式化 */
  formatPreview?: (preview: unknown) => string;
  /** 是否启用自动回滚（默认 true） */
  autoRollback?: boolean;
}

export interface UseDestructiveActionReturn<TArgs> {
  /** 触发破坏性操作流程：preview → confirm → execute → 失败 rollback */
  run: (args: TArgs, options: DestructiveRunOptions) => Promise<boolean>;
  /** 是否正在执行（preview / execute / rollback） */
  loading: boolean;
}

/**
 * 破坏性操作统一 hook
 * @example
 * const action = useDestructiveAction({
 *   preview: (id) => api.deletePackPreview(id),
 *   execute: (id) => api.deletePack(id),
 * });
 * const ok = await action.run(packId, {
 *   title: '删除 Pack',
 *   message: '此操作不可恢复',
 *   requireText: true,
 *   requireTextMatch: 'CONFIRM',
 * });
 */
export function useDestructiveAction<TPreview, TArgs>(
  action: DestructiveAction<TPreview, TArgs>,
): UseDestructiveActionReturn<TArgs> {
  const { confirm } = useConfirm();
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  const run = useCallback(
    async (args: TArgs, options: DestructiveRunOptions): Promise<boolean> => {
      const {
        title,
        message,
        confirmText = '确认执行',
        requireText = false,
        requireTextMatch,
        formatPreview,
        autoRollback = true,
      } = options;

      // 1. 预览阶段（可选）
      let previewText = message ?? '';
      if (action.preview) {
        setLoading(true);
        try {
          const previewResult = await action.preview(args);
          if (formatPreview) {
            previewText = formatPreview(previewResult);
          } else if (typeof previewResult === 'string') {
            previewText = previewResult;
          } else if (previewResult && typeof previewResult === 'object') {
            previewText = JSON.stringify(previewResult, null, 2);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : '预览失败';
          toast.error(`预览失败：${msg}`);
          return false;
        } finally {
          setLoading(false);
        }
      }

      // 2. 二次确认
      const confirmed = await confirm({
        title,
        message: previewText || undefined,
        confirmText,
        danger: true,
        requireText,
        requireTextMatch,
        closeOnOverlayClick: false,
      });
      if (!confirmed) return false;

      // 3. 执行
      setLoading(true);
      try {
        await action.execute(args);
        toast.success('操作成功');
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : '执行失败';
        toast.error(`操作失败：${msg}`);

        // 4. 自动回滚
        if (autoRollback && action.rollback) {
          try {
            await action.rollback(args);
            toast.info('已自动回滚');
          } catch (rollbackErr) {
            const rollbackMsg = rollbackErr instanceof Error ? rollbackErr.message : '未知错误';
            toast.error(`自动回滚失败：${rollbackMsg}，请手动处理`);
          }
        }
        return false;
      } finally {
        setLoading(false);
      }
    },
    [action, confirm, toast],
  );

  return { run, loading };
}
