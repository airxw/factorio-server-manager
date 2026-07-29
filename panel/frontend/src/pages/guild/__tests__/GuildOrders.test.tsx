// ============================================================================
// GuildOrders 页面单测 — /guild/orders（v4.15.0 我的订单页）
// 覆盖：订单渲染（跨实例聚合 MSW）、状态 tab 过滤、领取码复制、空态
// ============================================================================

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlers, mockMyOrders } from '../../../mocks/handlers';
import { renderWithProviders, screen, userEvent, waitFor } from '../../../test/utils';
import GuildOrders from '../GuildOrders';

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  // 登录态：user 角色 token → MSW /api/auth/me 返回普通用户
  window.localStorage.setItem('panel_token', 'mock-jwt-token-user');
});

describe('GuildOrders', () => {
  it('渲染跨实例订单列表：实例名/状态徽章/金额/领取码', async () => {
    renderWithProviders(<GuildOrders />, { initialEntries: ['/guild/orders'] });

    // 待领取置顶：claiming 订单排最前（mockMyOrders 中 pending+claiming 各 1 条）
    await waitFor(() => {
      expect(screen.getAllByText('主服务器').length).toBeGreaterThan(0);
    });

    // 状态徽章（tab 与徽章文案重复，用 getAllByText 断言至少各出现一次）
    expect(screen.getAllByText('待领取').length).toBeGreaterThan(0);
    expect(screen.getByText('领取中')).toBeInTheDocument();
    expect(screen.getAllByText('已领取').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已过期').length).toBeGreaterThan(0);

    // 领取码（pending/claiming 订单展示）
    expect(screen.getByText('MOCK-AAAA-1111')).toBeInTheDocument();
    expect(screen.getByText('MOCK-BBBB-2222')).toBeInTheDocument();

    // 物品明细
    expect(screen.getByText('diamond_sword')).toBeInTheDocument();
  });

  it('点击「已领取」tab 后仅显示已领取订单（API 带 status 过滤）', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuildOrders />, { initialEntries: ['/guild/orders'] });

    await waitFor(() => {
      expect(screen.getByText('MOCK-AAAA-1111')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: '已领取' }));

    await waitFor(() => {
      // 已领取订单的领取码不出现在卡片（claimed 不展示领取码），用物品名断言
      expect(screen.getByText('rocket')).toBeInTheDocument();
    });
    expect(screen.queryByText('diamond_sword')).not.toBeInTheDocument();
    expect(screen.queryByText('iron-plate')).not.toBeInTheDocument();
  });

  it('复制领取码按钮调用 clipboard 并提示成功', async () => {
    // userEvent.setup() 会安装自己的 clipboard stub，须在其后覆盖为我们的 spy
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderWithProviders(<GuildOrders />, { initialEntries: ['/guild/orders'] });

    await waitFor(() => {
      expect(screen.getByText('MOCK-AAAA-1111')).toBeInTheDocument();
    });

    const copyBtn = screen.getByLabelText('复制领取码 MOCK-AAAA-1111');
    await user.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith('MOCK-AAAA-1111');
    await waitFor(() => {
      expect(screen.getByText('领取码已复制')).toBeInTheDocument();
    });
  });

  it('无订单时展示空态与「去逛逛」入口', async () => {
    server.use(http.get('/api/my/orders', () => HttpResponse.json({ orders: [] })));

    renderWithProviders(<GuildOrders />, { initialEntries: ['/guild/orders'] });

    await waitFor(() => {
      expect(screen.getByText('暂无订单')).toBeInTheDocument();
    });
    expect(screen.getByText('去逛逛')).toBeInTheDocument();
  });

  it('mockMyOrders fixture 覆盖全部四种状态（Mock 回归契约）', () => {
    const statuses = mockMyOrders.map((o) => o.status);
    expect(statuses).toContain('pending');
    expect(statuses).toContain('claiming');
    expect(statuses).toContain('claimed');
    expect(statuses).toContain('expired');
  });
});
