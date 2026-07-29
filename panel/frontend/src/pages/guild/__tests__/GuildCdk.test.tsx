// ============================================================================
// GuildCdk 页面单测 — /guild/cdk（v4.15.0 CDK 兑换页）
// 覆盖：三步表单渲染、有效卡密兑换成功流、无效卡密错误提示
// ============================================================================

import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlers } from '../../../mocks/handlers';
import { renderWithProviders, screen, userEvent, waitFor } from '../../../test/utils';
import GuildCdk from '../GuildCdk';

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  window.localStorage.setItem('panel_token', 'mock-jwt-token-user');
});

describe('GuildCdk', () => {
  it('渲染三步兑换表单（选实例/选角色/输卡密）', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuildCdk />, { initialEntries: ['/guild/cdk'] });

    // 页头
    await waitFor(() => {
      expect(screen.getByText('CDK 兑换')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('卡密')).toBeInTheDocument();

    await user.type(screen.getByLabelText('卡密'), 'MOCK-VALID');

    await waitFor(() => {
      expect(screen.getByLabelText('游戏角色名')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /立即兑换/ })).toBeInTheDocument();
  });

  it('有效卡密 MOCK-VALID 兑换成功：展示奖励内容', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuildCdk />, { initialEntries: ['/guild/cdk'] });

    await user.type(screen.getByLabelText('卡密'), 'MOCK-VALID');

    await waitFor(() => {
      expect(screen.getByLabelText('游戏角色名')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('游戏角色名'), 'Steve');
    await user.click(screen.getByRole('button', { name: /立即兑换/ }));

    // 成功卡片：标题 + 礼包名 + 物品明细
    await waitFor(() => {
      expect(screen.getByText('兑换成功')).toBeInTheDocument();
    });
    expect(screen.getByText('新手礼包')).toBeInTheDocument();
    expect(screen.getByText('diamond_sword')).toBeInTheDocument();
    expect(screen.getByText('继续兑换')).toBeInTheDocument();
  });

  it('无效卡密兑换失败：展示错误提示', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuildCdk />, { initialEntries: ['/guild/cdk'] });

    await user.type(screen.getByLabelText('卡密'), 'WRONG-CODE');

    await waitFor(() => {
      expect(screen.queryByLabelText('游戏角色名')).not.toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /立即兑换/ })).toBeDisabled();
  });

  it('卡密或角色名为空时兑换按钮禁用', async () => {
    renderWithProviders(<GuildCdk />, { initialEntries: ['/guild/cdk'] });

    await waitFor(() => {
      expect(screen.getByLabelText('卡密')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /立即兑换/ })).toBeDisabled();
  });
});
