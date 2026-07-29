import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDestructiveAction } from './useDestructiveAction';

const confirmMock = vi.fn();
const toastApi = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};

vi.mock('../context/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: confirmMock }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => toastApi,
}));

describe('useDestructiveAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs preview -> confirm -> execute on success', async () => {
    const preview = vi.fn().mockResolvedValue({ affected: ['a', 'b'] });
    const execute = vi.fn().mockResolvedValue(undefined);
    confirmMock.mockResolvedValue(true);

    const { result } = renderHook(() =>
      useDestructiveAction({
        preview,
        execute,
      }),
    );

    let ok = false;
    await act(async () => {
      ok = await result.current.run('pack-1', {
        title: '删除 Pack',
        formatPreview: (value) => JSON.stringify(value),
      });
    });

    expect(ok).toBe(true);
    expect(preview).toHaveBeenCalledWith('pack-1');
    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '删除 Pack',
        message: JSON.stringify({ affected: ['a', 'b'] }),
        danger: true,
      }),
    );
    expect(execute).toHaveBeenCalledWith('pack-1');
    expect(toastApi.success).toHaveBeenCalledWith('操作成功');
  });

  it('rolls back and reports when execute fails', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('boom'));
    const rollback = vi.fn().mockResolvedValue(undefined);
    confirmMock.mockResolvedValue(true);

    const { result } = renderHook(() =>
      useDestructiveAction({
        execute,
        rollback,
      }),
    );

    let ok = true;
    await act(async () => {
      ok = await result.current.run('task-1', {
        title: '危险操作',
      });
    });

    expect(ok).toBe(false);
    expect(execute).toHaveBeenCalledWith('task-1');
    expect(rollback).toHaveBeenCalledWith('task-1');
    expect(toastApi.error).toHaveBeenCalledWith('操作失败：boom');
    expect(toastApi.info).toHaveBeenCalledWith('已自动回滚');
  });
});

