// ============================================================================
// GuildBind 页面单测 — /guild/bind（v4.15.0 绑定角色管理页）
// v4.27.0: 绑定语义从 game_type 全局改为 instance 实例级
//   - BINDING_FIXTURE scope_type='game_type' → 'instance'，scope_ref=server_id
//   - 创建绑定流需先选择实例（下拉），再输入角色名，再点击「生成验证码」
// 覆盖：绑定列表渲染（按状态徽章/验证码）、创建绑定流、空态
// ============================================================================

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlers } from '../../../mocks/handlers';
import { renderWithProviders, screen, userEvent, waitFor } from '../../../test/utils';
import GuildBind from '../GuildBind';

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  window.localStorage.setItem('panel_token', 'mock-jwt-token-user');
});

// v4.19.3: BINDING_FIXTURE 改用统一 Binding 契约字段（替代旧 PlayerBindingSummary）
// v4.27.0: scope_type='instance', scope_ref=server_id（实例级绑定）
const BINDING_FIXTURE = {
  id: 501,
  user_id: 'user-user-001',
  binding_type: 'player' as const,
  scope_type: 'instance' as const,
  scope_ref: 'srv-001',
  player_name: 'Steve',
  vip_level: 0,
  wallet_id: null,
  verify_status: 'pending' as const,
  verify_code: 'MC-12345',
  verify_expires_at: null,
  verified_at: null,
  metadata: '',
  created_at: '2026-07-20T10:00:00.000Z',
  updated_at: '2026-07-20T10:00:00.000Z',
};

describe('GuildBind', () => {
  it('渲染绑定列表：角色名/状态徽章/待验证验证码', async () => {
    server.use(
      http.get('/api/player-bindings', () =>
        HttpResponse.json({
          bindings: [
            BINDING_FIXTURE,
            { ...BINDING_FIXTURE, id: 502, player_name: 'Alex', verify_status: 'verified' as const, verified_at: '2026-07-21T08:00:00.000Z' },
          ],
        }),
      ),
    );

    renderWithProviders(<GuildBind />, { initialEntries: ['/guild/bind'] });

    await waitFor(() => {
      expect(screen.getByText('Steve')).toBeInTheDocument();
    });
    expect(screen.getByText('Alex')).toBeInTheDocument();

    // 状态徽章
    expect(screen.getByText('待验证')).toBeInTheDocument();
    expect(screen.getByText('已验证')).toBeInTheDocument();

    // 待验证绑定展示验证码 + 验证入口
    expect(screen.getByText('MC-12345')).toBeInTheDocument();
    expect(screen.getByText('我已在游戏内输入')).toBeInTheDocument();
  });

  it('创建绑定：选择实例 + 输入角色名后新增绑定卡片并提示验证码', async () => {
    server.use(http.get('/api/player-bindings', () => HttpResponse.json({ bindings: [] })));

    const user = userEvent.setup();
    renderWithProviders(<GuildBind />, { initialEntries: ['/guild/bind'] });

    // 等待实例下拉加载（GET /api/servers 返回 mockServersResponse）
    await waitFor(() => {
      expect(screen.getByLabelText(/选择实例/)).toBeInTheDocument();
    });

    // v4.27.0: 先选择实例（下拉），再输入角色名
    await user.selectOptions(screen.getByLabelText(/选择实例/), 'srv-001');
    await user.type(screen.getByLabelText(/游戏角色名/), 'NewPlayer');

    // v4.19.1: GuildBind v4.17.0 向导式重做后，创建按钮文案为「生成验证码」（创建中显示「创建中…」）
    await user.click(screen.getByRole('button', { name: /生成验证码|创建中…/ }));

    // MSW POST 返回新绑定（角色名回显 + pending 状态）
    await waitFor(() => {
      expect(screen.getByText('NewPlayer')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/绑定已创建，请在游戏内输入验证码/)).toBeInTheDocument();
    });
  });

  it('无绑定时展示空态指引', async () => {
    server.use(http.get('/api/player-bindings', () => HttpResponse.json({ bindings: [] })));

    renderWithProviders(<GuildBind />, { initialEntries: ['/guild/bind'] });

    await waitFor(() => {
      expect(screen.getByText(/暂无绑定|还没有绑定/)).toBeInTheDocument();
    });
  });
});
