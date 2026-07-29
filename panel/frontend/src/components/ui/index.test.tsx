// ============================================================================
// UI 组件库单测 — DataTable / EmptyState / Modal / Pagination / Skeleton / Toast
// 覆盖核心渲染态：loading / empty / error / data / 分页 / toast 推送与关闭
// ============================================================================

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DataTable,
  EmptyState,
  Modal,
  Pagination,
  Skeleton,
  ToastProvider,
  useToast,
  type DataTableColumn,
} from '.';
import { renderWithProviders } from '../../test/utils';

// ---------------------------------------------------------------------------
// DataTable 测试
// ---------------------------------------------------------------------------
interface Row {
  id: number;
  name: string;
}

const SAMPLE_ROWS: Row[] = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
];

const COLUMNS: DataTableColumn<Row>[] = [
  { header: 'ID', accessor: 'id' },
  { header: '名称', accessor: 'name' },
  {
    header: '操作',
    className: 'col-actions',
    render: (row) => <button>删除{row.name}</button>,
  },
];

describe('DataTable', () => {
  it('数据态：渲染表头与行', () => {
    renderWithProviders(<DataTable rows={SAMPLE_ROWS} columns={COLUMNS} rowKey={(r) => r.id} />);
    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('名称')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('删除Alice')).toBeInTheDocument();
  });

  it('空态：展示空状态文案', () => {
    renderWithProviders(
      <DataTable rows={[]} columns={COLUMNS} rowKey={(r) => r.id} emptyTitle="暂无记录" />,
    );
    expect(screen.getByText('暂无记录')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('加载态：展示骨架屏（不含真实数据）', () => {
    renderWithProviders(
      <DataTable rows={[]} columns={COLUMNS} rowKey={(r) => r.id} loading skeletonRows={2} />,
    );
    // 加载态下不展示空状态文案与真实数据
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    // 表头仍渲染
    expect(screen.getByText('ID')).toBeInTheDocument();
  });

  it('错误态：展示错误信息', () => {
    renderWithProviders(
      <DataTable rows={SAMPLE_ROWS} columns={COLUMNS} rowKey={(r) => r.id} error="加载失败" />,
    );
    expect(screen.getByText('加载失败')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('点击行触发 onRowClick', () => {
    const onRowClick = vi.fn();
    renderWithProviders(
      <DataTable
        rows={SAMPLE_ROWS}
        columns={COLUMNS}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByText('Alice'));
    expect(onRowClick).toHaveBeenCalledWith(SAMPLE_ROWS[0]);
  });
});

// ---------------------------------------------------------------------------
// EmptyState 测试
// ---------------------------------------------------------------------------
describe('EmptyState', () => {
  it('渲染标题与描述', () => {
    renderWithProviders(<EmptyState title="无数据" description="请先创建" />);
    expect(screen.getByText('无数据')).toBeInTheDocument();
    expect(screen.getByText('请先创建')).toBeInTheDocument();
  });

  it('渲染操作按钮', () => {
    renderWithProviders(<EmptyState action={<button>新建</button>} />);
    expect(screen.getByRole('button', { name: '新建' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Pagination 测试
// ---------------------------------------------------------------------------
describe('Pagination', () => {
  it('总页数 ≤ 1 时不渲染', () => {
    renderWithProviders(<Pagination page={1} totalPages={1} onPageChange={() => {}} />);
    // 验证 Pagination 自身的 .pagination 元素未渲染（不依赖 wrapper 的容器结构，
    // 避免 ToastProvider 等新增 Provider 干扰 firstChild 断言）
    expect(document.querySelector('.pagination')).toBeNull();
  });

  it('点击页码触发回调', () => {
    const onPageChange = vi.fn();
    renderWithProviders(<Pagination page={2} totalPages={5} onPageChange={onPageChange} />);
    // 点击第 3 页
    fireEvent.click(screen.getByText('3'));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('首屏时上一页/首页禁用', () => {
    renderWithProviders(<Pagination page={1} totalPages={5} onPageChange={() => {}} />);
    const firstBtn = screen.getByLabelText('«');
    const prevBtn = screen.getByLabelText('‹');
    expect(firstBtn).toBeDisabled();
    expect(prevBtn).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Skeleton 测试
// ---------------------------------------------------------------------------
describe('Skeleton', () => {
  it('渲染指定数量的骨架条', () => {
    const { container } = renderWithProviders(<Skeleton lines={4} />);
    const bars = container.querySelectorAll('.skeleton-bar, [style*="skeleton-shimmer"]');
    // 至少渲染出 lines 个 div
    expect(bars.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Modal 测试
// ---------------------------------------------------------------------------
describe('Modal', () => {
  it('open=false 时不渲染', () => {
    const { container } = renderWithProviders(
      <Modal open={false} onClose={() => {}}>
        <p>内容</p>
      </Modal>,
    );
    expect(container.querySelector('.modal-overlay')).toBeNull();
  });

  it('open=true 时渲染内容与标题', () => {
    renderWithProviders(
      <Modal open onClose={() => {}} title="测试弹窗">
        <p>内容</p>
      </Modal>,
    );
    expect(screen.getByText('测试弹窗')).toBeInTheDocument();
    expect(screen.getByText('内容')).toBeInTheDocument();
  });

  it('点击遮罩触发 onClose', async () => {
    const onClose = vi.fn();
    const { container } = renderWithProviders(
      <Modal open onClose={onClose} title="弹窗">
        <p>内容</p>
      </Modal>,
    );
    const overlay = container.querySelector('.modal-overlay')!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('disableClose 时点击遮罩不关闭', () => {
    const onClose = vi.fn();
    const { container } = renderWithProviders(
      <Modal open onClose={onClose} disableClose title="弹窗">
        <p>内容</p>
      </Modal>,
    );
    const overlay = container.querySelector('.modal-overlay')!;
    fireEvent.click(overlay);
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Toast 测试
// ---------------------------------------------------------------------------
function ToastConsumer({ message }: { message: string }) {
  const toast = useToast();
  return <button onClick={() => toast.success(message)}>触发通知</button>;
}

describe('Toast', () => {
  it('调用 toast.success 后展示通知', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ToastProvider>
        <ToastConsumer message="操作成功" />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: '触发通知' }));
    expect(screen.getByText('操作成功')).toBeInTheDocument();
  });

  it('点击 × 关闭通知', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ToastProvider>
        <ToastConsumer message="可关闭通知" />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: '触发通知' }));
    const closeBtn = screen.getByLabelText('关闭通知');
    await user.click(closeBtn);
    await waitFor(() => {
      expect(screen.queryByText('可关闭通知')).not.toBeInTheDocument();
    });
  });
});
