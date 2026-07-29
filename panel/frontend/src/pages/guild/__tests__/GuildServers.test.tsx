// ============================================================================
// GuildServers 页面单测 — /guild/servers（v4.15.0 我的服务器 + 推荐服务器）
// 覆盖：绑定实例渲染、推荐服务器渲染、空态、点击跳转
// ============================================================================

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlers, mockDiscoverRecommended } from '../../../mocks/handlers';
import { renderWithProviders, screen, userEvent, waitFor } from '../../../test/utils';
import GuildServers from '../GuildServers';

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  window.localStorage.setItem('panel_token', 'mock-jwt-token-user');
});

describe('GuildServers', () => {
  it('渲染绑定实例与推荐服务器（含在线状态徽章）', async () => {
    renderWithProviders(<GuildServers />, { initialEntries: ['/guild/servers'] });

    // 我的服务器（/api/servers fixture：主服务器，stopped → 离线）
    await waitFor(() => {
      expect(screen.getByText('主服务器')).toBeInTheDocument();
    });
    expect(screen.getByText('绑定实例')).toBeInTheDocument();

    // 推荐服务器（/api/discover/recommended fixture）
    await waitFor(() => {
      expect(screen.getByText('推荐·生存工艺')).toBeInTheDocument();
    });
    expect(screen.getByText('推荐·异星工厂')).toBeInTheDocument();
    expect(screen.getByText('推荐服务器')).toBeInTheDocument();

    // 在线人数
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('无绑定实例时展示空态与「立即绑定」入口', async () => {
    server.use(http.get('/api/servers', () => HttpResponse.json({ servers: [] })));

    renderWithProviders(<GuildServers />, { initialEntries: ['/guild/servers'] });

    await waitFor(() => {
      expect(screen.getByText('还没有绑定任何服务器角色')).toBeInTheDocument();
    });
    expect(screen.getByText('立即绑定')).toBeInTheDocument();
  });

  it('点击绑定实例卡片跳转至实例店铺页', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/guild/servers" element={<GuildServers />} />
        <Route path="/guild/servers/:id" element={<div>SERVER_SHOP_PAGE</div>} />
      </Routes>,
      { initialEntries: ['/guild/servers'] },
    );

    await waitFor(() => {
      expect(screen.getByText('主服务器')).toBeInTheDocument();
    });

    await user.click(screen.getByText('主服务器'));

    await waitFor(() => {
      expect(screen.getByText('SERVER_SHOP_PAGE')).toBeInTheDocument();
    });
  });

  it('mockDiscoverRecommended fixture 符合 DiscoverServer 契约（Mock 回归）', () => {
    for (const s of mockDiscoverRecommended) {
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('name');
      expect(s).toHaveProperty('online_players');
      expect(typeof s.online_players).toBe('number');
    }
  });
});
