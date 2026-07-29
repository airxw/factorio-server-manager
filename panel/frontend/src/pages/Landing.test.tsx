import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Landing from './Landing';

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('../api/auth', () => ({
  useAuth: () => ({
    login: vi.fn(),
  }),
}));

vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

describe('Landing', () => {
  it('优先展示玩家视角的产品价值', () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );

    expect(screen.getByText('新手礼包、VIP、商城、投票踢人')).toBeInTheDocument();
    expect(screen.getByText('一眼就知道这个服有得玩')).toBeInTheDocument();
    expect(screen.getByText('先让玩家看到爽点，才有后面的所有转化')).toBeInTheDocument();
    expect(screen.getByText('新手礼包先把开局抬起来')).toBeInTheDocument();
    expect(screen.getByText('福利 CDKEY 让活动变成传播点')).toBeInTheDocument();
    expect(screen.getByText('支持这些游戏，接服和开服都不是空话')).toBeInTheDocument();
  });

  it('提供三个免密体验入口，并保留玩家优先顺序', () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: '以玩家身份进入' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '以服主身份进入' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '以管理员身份进入' })).toBeInTheDocument();
    expect(screen.getByText('第一入口')).toBeInTheDocument();
    expect(screen.getAllByText('自己有服务器就免费接入').length).toBeGreaterThan(0);
    expect(screen.getAllByText('没服务器也能租服开整').length).toBeGreaterThan(0);
  });
});
