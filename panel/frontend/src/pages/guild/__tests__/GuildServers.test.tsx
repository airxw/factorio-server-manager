// ============================================================================
// GuildServers 页面单测 — /guild/servers（v4.38.0 服务器市场改造）
//
// v4.38.0 改造后：页面从"我的绑定 + 推荐服务器"变为平台级"服务器市场"
//   数据源：GET /api/servers/bindable（带 is_bound/has_pending_request/can_direct_bind/can_request_bind）
//   卡片状态：owner / bound / can_direct_bind / can_request_bind / pending / closed
//
// 覆盖：
//   1. 渲染市场卡片（公开实例 → "立即绑定"）
//   2. 无市场实例时展示空态
//   3. 点击 owner 卡片跳转至 /admin/servers/:id（管理入口）
//   4. mockDiscoverRecommended fixture 契约校验（Mock 回归，保留）
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
  it('渲染市场卡片：公开实例显示「立即绑定」', async () => {
    // Override /api/servers/bindable 返回 1 个公开实例
    server.use(
      http.get('/api/servers/bindable', () =>
        HttpResponse.json({
          servers: [
            {
              id: 'srv-001',
              name: '主服务器',
              game_type: 'factorio',
              pack_id: 'pack-factorio-2.0',
              status: 'running',
              is_public: true,
              owner_username: 'admin',
              is_owner: false,
              is_bound: false,
              has_pending_request: false,
              can_direct_bind: true,
              can_request_bind: false,
              binding_requests_enabled: false,
              created_at: '2025-06-01T00:00:00.000Z',
            },
          ],
          total: 1,
        }),
      ),
    );

    renderWithProviders(<GuildServers />, { initialEntries: ['/guild/servers'] });

    // 页头
    await waitFor(() => {
      expect(screen.getByText('服务器市场')).toBeInTheDocument();
    });

    // 市场卡片
    expect(screen.getByText('主服务器')).toBeInTheDocument();
    // 公开实例 → "立即绑定" 按钮
    expect(screen.getByText('立即绑定')).toBeInTheDocument();
  });

  it('无市场实例时展示空态', async () => {
    server.use(http.get('/api/servers/bindable', () => HttpResponse.json({ servers: [], total: 0 })));

    renderWithProviders(<GuildServers />, { initialEntries: ['/guild/servers'] });

    await waitFor(() => {
      // 空态主文案（与"平台暂无公开实例..."副文案区分，用精确匹配避免多元素冲突）
      expect(screen.getByText('暂无可浏览的实例')).toBeInTheDocument();
    });
  });

  it('点击 owner 卡片跳转至 /admin/servers/:id（管理入口）', async () => {
    server.use(
      http.get('/api/servers/bindable', () =>
        HttpResponse.json({
          servers: [
            {
              id: 'srv-001',
              name: '主服务器',
              game_type: 'factorio',
              pack_id: 'pack-factorio-2.0',
              status: 'running',
              is_public: false,
              owner_username: 'user',
              is_owner: true,
              is_bound: false,
              has_pending_request: false,
              can_direct_bind: true,
              can_request_bind: false,
              binding_requests_enabled: false,
              created_at: '2025-06-01T00:00:00.000Z',
            },
          ],
          total: 1,
        }),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/guild/servers" element={<GuildServers />} />
        <Route path="/admin/servers/:id" element={<div>ADMIN_SERVER_PAGE</div>} />
      </Routes>,
      { initialEntries: ['/guild/servers'] },
    );

    await waitFor(() => {
      expect(screen.getByText('主服务器')).toBeInTheDocument();
    });

    // owner 卡片通过"进入管理"按钮触发跳转（卡片本身无 onClick，按钮是显式操作入口）
    await user.click(screen.getByRole('button', { name: /进入管理/ }));

    await waitFor(() => {
      expect(screen.getByText('ADMIN_SERVER_PAGE')).toBeInTheDocument();
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
