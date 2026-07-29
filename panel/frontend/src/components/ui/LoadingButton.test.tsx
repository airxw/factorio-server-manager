// ============================================================================
// LoadingButton 组件单测 — 五.11 按钮 loading 状态
// 覆盖：默认渲染 / loading 态 spinner + 文字 / disabled 联动 / variant 类名
// ============================================================================

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoadingButton from './LoadingButton';

describe('LoadingButton', () => {
  it('默认渲染 children 文字', () => {
    render(<LoadingButton>保存</LoadingButton>);
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
    expect(screen.queryByText('保存中…')).not.toBeInTheDocument();
  });

  it('loading=true 时显示 spinner 和 loadingText', () => {
    render(<LoadingButton loading loadingText="保存中…">保存</LoadingButton>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('保存中…')).toBeInTheDocument();
    expect(screen.queryByText('保存')).not.toBeInTheDocument();
    // spinner 存在
    expect(btn.querySelector('.btn-spinner')).toBeInTheDocument();
  });

  it('loading=true 且未传 loadingText 时沿用 children', () => {
    render(<LoadingButton loading>提交</LoadingButton>);
    expect(screen.getByText('提交')).toBeInTheDocument();
  });

  it('disabled 属性独立于 loading 也能禁用', () => {
    render(<LoadingButton disabled>删除</LoadingButton>);
    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled();
  });

  it('variant 与 size 正确映射到类名', () => {
    const { rerender } = render(<LoadingButton variant="danger" size="sm">删除</LoadingButton>);
    expect(screen.getByRole('button')).toHaveClass('btn', 'btn-danger', 'btn-sm');

    rerender(<LoadingButton variant="ghost" size="block">取消</LoadingButton>);
    expect(screen.getByRole('button')).toHaveClass('btn', 'btn-ghost', 'btn-block');
  });

  it('type 属性可透传（默认 button，可设为 submit）', () => {
    render(<LoadingButton type="submit">登录</LoadingButton>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('onClick 可正常透传', async () => {
    const onClick = vi.fn();
    render(<LoadingButton onClick={onClick}>点击</LoadingButton>);
    const btn = screen.getByRole('button', { name: '点击' });
    btn.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('loading 态点击不触发 onClick（按钮已 disabled）', () => {
    const onClick = vi.fn();
    render(
      <LoadingButton loading onClick={onClick}>
        提交
      </LoadingButton>,
    );
    const btn = screen.getByRole('button');
    btn.click();
    expect(onClick).not.toHaveBeenCalled();
  });
});
