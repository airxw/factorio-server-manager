// ============================================================================
// MobileCardList 组件单测 — B1.0 共享组件
// 覆盖：空列表 / 单项 / 多项 / keyExtractor / 自定义渲染 / 仅 header 无 body/actions
// ============================================================================

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import MobileCardList from './MobileCardList';

interface Item {
  id: string;
  name: string;
  status: string;
}

const SAMPLE: Item[] = [
  { id: 'a', name: 'Alice', status: 'active' },
  { id: 'b', name: 'Bob', status: 'deleted' },
];

describe('MobileCardList', () => {
  it('空列表渲染 EmptyState 默认文案「暂无数据」', () => {
    const EMPTY: Item[] = [];
    render(
      <MobileCardList
        items={EMPTY}
        keyExtractor={(i) => i.id}
        renderHeader={() => null}
      />,
    );
    expect(screen.getByText('暂无数据')).toBeInTheDocument();
  });

  it('空列表支持自定义 emptyText 与 emptyDescription', () => {
    const EMPTY: Item[] = [];
    render(
      <MobileCardList
        items={EMPTY}
        keyExtractor={(i) => i.id}
        renderHeader={() => null}
        emptyText="暂无用户"
        emptyDescription="点击右上角「新建」创建第一个用户"
      />,
    );
    expect(screen.getByText('暂无用户')).toBeInTheDocument();
    expect(screen.getByText('点击右上角「新建」创建第一个用户')).toBeInTheDocument();
  });

  it('单项渲染 header / body / actions 三个区块', () => {
    render(
      <MobileCardList
        items={[SAMPLE[0]]}
        keyExtractor={(i) => i.id}
        renderHeader={(i) => <span className="mc-item-title">{i.name}</span>}
        renderBody={(i) => (
          <>
            <div className="mc-row">
              <span className="mc-label">状态</span>
              <span className="mc-value">{i.status}</span>
            </div>
          </>
        )}
        renderActions={() => <button>编辑</button>}
      />,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('状态')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();
  });

  it('多项渲染所有 item，且使用 keyExtractor 作为 key', () => {
    render(
      <MobileCardList
        items={SAMPLE}
        keyExtractor={(i) => i.id}
        renderHeader={(i) => <span>{i.name}</span>}
      />,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('仅传 renderHeader 时不渲染 body/actions 区块', () => {
    const { container } = render(
      <MobileCardList
        items={[SAMPLE[0]]}
        keyExtractor={(i) => i.id}
        renderHeader={() => <span>仅头部</span>}
      />,
    );
    expect(container.querySelector('.mc-item-header')).toBeInTheDocument();
    expect(container.querySelector('.mc-actions')).not.toBeInTheDocument();
    // body 未传时不渲染额外内容
    expect(container.querySelectorAll('.mc-row')).toHaveLength(0);
  });

  it('外层容器带 mobile-card-list 与 mobile-only 类名', () => {
    const { container } = render(
      <MobileCardList
        items={SAMPLE}
        keyExtractor={(i) => i.id}
        renderHeader={() => null}
      />,
    );
    const list = container.querySelector('.mobile-card-list');
    expect(list).toBeInTheDocument();
    expect(list).toHaveClass('mobile-only');
    expect(list?.querySelectorAll('.mc-item')).toHaveLength(2);
  });

  it('keyExtractor 支持数字类型', () => {
    const nums = [{ n: 1 }, { n: 2 }];
    const { container } = render(
      <MobileCardList
        items={nums}
        keyExtractor={(i) => i.n}
        renderHeader={(i) => <span>项 {i.n}</span>}
      />,
    );
    expect(container.querySelectorAll('.mc-item')).toHaveLength(2);
  });
});
