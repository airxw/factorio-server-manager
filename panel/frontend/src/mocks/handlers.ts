// ============================================================================
// MSW handlers — 覆盖关键 Panel API
// 七.2: 扩展至 notifications / packs / nodes / users / system-configs / shop 等接口
// v4.13.0: 扩展至 store/servers/:id/shop-config / player-bindings / store/players / store/reports / store-player-actions
// Mock 数据基于 public/schema/panel-api-types.ts 的类型定义生成
// 由单元测试通过 setupServer 启动，隔离真实后端依赖
// ============================================================================

import { http, HttpResponse } from 'msw';
import type {
  ListServersResponse,
  LoginRequest,
  LoginResponse,
  MeResponse,
  UserInfo,
} from '@public/schema/panel-api-types';

// ----- Mock fixtures（符合 panel-api-types 契约）-----

// 3 级演示账号（对应后端 seedDemoAccountsIfMissing，v3.3.3）
// v4.28.0: 全员服主——补 roles/active_role（user↔instance_admin 免密互切 mock 路径）
const DEMO_USERS: Record<string, UserInfo> = {
  'admin@local.dev': {
    id: 'user-admin-001',
    email: 'admin@local.dev',
    username: 'admin',
    role: 'server_admin',
    roles: ['server_admin', 'instance_admin', 'user'],
    active_role: 'server_admin',
    status: 'active',
    created_at: '2025-01-01T00:00:00.000Z',
  },
  'manager@local.dev': {
    id: 'user-manager-001',
    email: 'manager@local.dev',
    username: 'manager',
    role: 'instance_admin',
    roles: ['instance_admin', 'user'],
    active_role: 'instance_admin',
    status: 'active',
    created_at: '2025-01-01T00:00:00.000Z',
  },
  'user@local.dev': {
    id: 'user-user-001',
    email: 'user@local.dev',
    username: 'user',
    role: 'user',
    roles: ['user', 'instance_admin'],
    active_role: 'user',
    status: 'active',
    created_at: '2025-01-01T00:00:00.000Z',
  },
};

export const mockAdminUser: UserInfo = DEMO_USERS['admin@local.dev']!;

export const mockToken = 'mock-jwt-token-admin';

export const mockLoginResponse: LoginResponse = {
  token: mockToken,
  user: mockAdminUser,
};

export const mockMeResponse: MeResponse = {
  user: mockAdminUser,
};

// v4.13.1: 每个 demo 账号对应独立 token，便于 /api/auth/me 按 token 区分当前用户
// admin token 保持 mockToken 不变以维持向后兼容（其他测试可能直接引用 mockToken）
export const TOKENS_BY_EMAIL: Record<string, string> = {
  'admin@local.dev': 'mock-jwt-token-admin',
  'manager@local.dev': 'mock-jwt-token-manager',
  'user@local.dev': 'mock-jwt-token-user',
};

// token → user 反查表
const TOKEN_TO_USER: Record<string, UserInfo> = Object.fromEntries(
  Object.entries(TOKENS_BY_EMAIL).map(([email, token]) => [token, DEMO_USERS[email]!]),
);

export const mockServersResponse: ListServersResponse = {
  servers: [
    {
      id: 'srv-001',
      name: '主服务器',
      pack_id: 'pack-factorio-2.0',
      game_type: 'factorio',
      node_id: 'node-1',
      owner_user_id: 'user-admin-001',
      owner_username: 'admin',
      current_version: null,
      last_activity_at: '2025-06-01T00:00:00.000Z',
      status: 'stopped',
      port: 34197,
      rcon_port: 34198,
      // v3.6.1: 磁盘占用缓存字段
      disk_usage_bytes: null,
      disk_usage_updated_at: null,
      // v1.1.0: 启动前置引导完成时间（null=未完成引导）
      startup_config_set_at: null,
      // v3-billing: 永久实例（expires_at=null，expiry_status='permanent'）
      expires_at: null,
      expiry_status: 'permanent',
      node_name: '主节点',
      // v4.38.0: 平台级公开标记 + 绑定申请通道开关
      // v4.38.1: 自动审批开关
      is_public: true,
      binding_requests_enabled: false,
      auto_approve_binding_requests: false,
      created_at: '2025-06-01T00:00:00.000Z',
      updated_at: '2025-06-01T00:00:00.000Z',
    },
  ],
};

// 七.2: 扩展 fixtures
export const mockPacksResponse = {
  packs: [
    {
      id: 'pack-factorio-2.0',
      display_name: 'Factorio 2.0',
      game: 'factorio',
      variant: 'vanilla',
      version: '2.0.0',
      ui_tabs: [
        { tab: 'console',      group: 'runtime',  order: 10, require_state: ['stopped', 'starting', 'running', 'stopping', 'error'] },
        { tab: 'shop-admin',   group: 'business', order: 10, require_state: ['stopped', 'starting', 'running', 'stopping', 'error'] },
        { tab: 'mods',         group: 'ops',      order: 20, require_state: ['stopped', 'error'] },
        { tab: 'saves',        group: 'ops',      order: 10, require_state: ['stopped', 'error'] },
        { tab: 'config-files', group: 'config',   order: 10, require_state: ['stopped', 'starting', 'running', 'error'] },
      ],
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-01-01T00:00:00.000Z',
    },
  ],
};

export const mockNodesResponse = {
  nodes: [
    {
      id: 'node-1',
      name: '默认节点',
      status: 'online',
      host: '127.0.0.1',
      port: 8080,
      created_at: '2025-01-01T00:00:00.000Z',
    },
  ],
};

export const mockUsersResponse = {
  users: [mockAdminUser],
};

export const mockNotificationsResponse = {
  notifications: [],
  unread_count: 0,
};

export const mockSystemConfigsResponse = {
  configs: [
    { key: 'panel_name', value: 'GameServer Panel', description: '面板名称' },
  ],
};

export const mockShopItemsResponse = {
  items: [
    {
      id: 'item-001',
      name: '测试商品',
      price: 100,
      description: '用于测试的商品',
    },
  ],
};

// v4.28.0: switch-role 签发的新 token 运行时注册表（mock 免密切换后 /auth/me 可反查）
const RUNTIME_TOKEN_TO_USER: Record<string, UserInfo> = {};

// ----- 辅助：鉴权校验 -----
// v4.13.1: 接受所有 demo 账号 token（不再仅限 admin token），支持三角色测试
function requireAuth(request: Request) {
  const auth = request.headers.get('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !(token in TOKEN_TO_USER || token in RUNTIME_TOKEN_TO_USER)) {
    return HttpResponse.json(
      { error: { code: 'PANEL_UNAUTHORIZED', message: '未授权或登录已过期' } },
      { status: 401 },
    );
  }
  return null;
}

// v4.13.1: 从请求中提取当前用户（用于 /api/auth/me 等需要返回当前用户的接口）
function getUserFromRequest(request: Request): UserInfo | null {
  const auth = request.headers.get('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  return token ? (RUNTIME_TOKEN_TO_USER[token] ?? TOKEN_TO_USER[token] ?? null) : null;
}

// ----- handlers -----

export const handlers = [
  // POST /api/auth/login — 校验邮箱+密码，返回 token + user
  // v3.3.3: 支持 3 级演示账号（server_admin/instance_admin/user）
  // v4.13.1: 每个 demo 账号返回独立 token，使 /api/auth/me 能按 token 区分当前用户
  http.post('/api/auth/login', async ({ request }) => {
    const body = (await request.json()) as LoginRequest;
    const user = DEMO_USERS[body.email];
    if (user && body.password === 'admin123') {
      const token = TOKENS_BY_EMAIL[body.email] ?? mockToken;
      return HttpResponse.json({ token, user });
    }
    return HttpResponse.json(
      { error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' } },
      { status: 401 },
    );
  }),

  // GET /api/auth/me — 返回当前登录用户（需 Bearer token）
  // v4.13.1: 按 token 动态返回对应角色用户（替代固定返回 admin）
  http.get('/api/auth/me', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const user = getUserFromRequest(request);
    return HttpResponse.json({ user: user ?? mockAdminUser });
  }),

  // POST /api/auth/switch-role — v4.28.0 全员服主免密切换（JWT-only，等级闸门 ≤2）
  http.post('/api/auth/switch-role', async ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const user = getUserFromRequest(request);
    if (!user) {
      return HttpResponse.json(
        { error: { code: 'PANEL_UNAUTHORIZED', message: '未授权或登录已过期' } },
        { status: 401 },
      );
    }
    const body = (await request.json()) as { active_role?: string };
    const target = body.active_role;
    const userRoles = user.roles ?? [user.role];
    // 等级闸门：server_admin 目标必须走 select-role 密码通道
    if (target === 'server_admin') {
      return HttpResponse.json(
        {
          error: {
            code: 'ROLE_SWITCH_REQUIRES_PASSWORD',
            message: '切换平台管理员需密码二次校验，请走 /api/auth/select-role',
          },
        },
        { status: 400 },
      );
    }
    if (!target || !userRoles.includes(target as UserInfo['role'])) {
      return HttpResponse.json(
        { error: { code: 'ROLE_NOT_GRANTED', message: '目标角色不在当前账号角色集合内' } },
        { status: 400 },
      );
    }
    const targetRole = target as UserInfo['role'];
    const switched: UserInfo = { ...user, role: targetRole, active_role: targetRole };
    const newToken = `mock-jwt-token-switched-${target}`;
    RUNTIME_TOKEN_TO_USER[newToken] = switched;
    return HttpResponse.json({ token: newToken, user: switched });
  }),

  // GET /api/servers — 返回服务器列表
  http.get('/api/servers', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    return HttpResponse.json(mockServersResponse);
  }),

  // v4.38.0: GET /api/servers/bindable — 服务器市场列表（公开实例 + 自己 owner 的实例）
  // Mock 默认返回 1 个公开可绑定实例（基于 mockServersResponse.srv-001 派生）
  http.get('/api/servers/bindable', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const user = getUserFromRequest(request);
    const userId = user?.id ?? 'user-user-001';
    const servers = mockServersResponse.servers.map((s) => ({
      id: s.id,
      name: s.name,
      game_type: s.game_type,
      pack_id: s.pack_id,
      status: s.status,
      is_public: s.is_public,
      owner_username: s.owner_username,
      is_owner: s.owner_user_id === userId,
      is_bound: false,
      has_pending_request: false,
      can_direct_bind: s.is_public || s.owner_user_id === userId,
      can_request_bind: !s.is_public && s.owner_user_id !== userId && s.binding_requests_enabled,
      binding_requests_enabled: s.binding_requests_enabled,
      created_at: s.created_at,
    }));
    return HttpResponse.json({ servers, total: servers.length });
  }),

  // 七.2: GET /api/servers/:id — 返回单个服务器详情
  http.get('/api/servers/:id', ({ request, params }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const server = mockServersResponse.servers.find((s) => s.id === params.id);
    if (!server) {
      return HttpResponse.json(
        { error: { code: 'SERVER_NOT_FOUND', message: '服务器不存在' } },
        { status: 404 },
      );
    }
    return HttpResponse.json({ server });
  }),

  // 七.2: POST /api/servers — 创建服务器
  http.post('/api/servers', async ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const body = (await request.json()) as { name: string; pack_id: string; node_id: string };
    const newServer = {
      id: 'srv-new-' + Date.now(),
      name: body.name,
      pack_id: body.pack_id,
      game_type: 'factorio',
      node_id: body.node_id,
      owner_user_id: mockAdminUser.id,
      status: 'stopped' as const,
      port: 34197,
      rcon_port: 34198,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return HttpResponse.json({ server: newServer }, { status: 201 });
  }),

  // 七.2: DELETE /api/servers/:id — 删除服务器
  http.delete('/api/servers/:id', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    return new HttpResponse(null, { status: 204 });
  }),

  // 七.2: POST /api/servers/:id/start — 启动服务器
  http.post('/api/servers/:id/start', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    return HttpResponse.json({ status: 'starting' });
  }),

  // 七.2: POST /api/servers/:id/stop — 停止服务器
  http.post('/api/servers/:id/stop', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    return HttpResponse.json({ status: 'stopping' });
  }),

  // 七.2: GET /api/packs — 返回 Pack 列表
  http.get('/api/packs', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    return HttpResponse.json(mockPacksResponse);
  }),

  // 七.2: GET /api/nodes — 返回节点列表
  http.get('/api/nodes', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    return HttpResponse.json(mockNodesResponse);
  }),

  // 七.2: GET /api/users — 返回用户列表（管理员）
  http.get('/api/users', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    return HttpResponse.json(mockUsersResponse);
  }),

  // 七.2: GET /api/notifications — 返回通知列表
  http.get('/api/notifications', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    return HttpResponse.json(mockNotificationsResponse);
  }),

  // 七.2: GET /api/system-configs — 返回系统配置
  http.get('/api/system-configs', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    return HttpResponse.json(mockSystemConfigsResponse);
  }),

  // 七.2: GET /api/shop-items — 返回商城商品列表
  http.get('/api/shop-items', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    return HttpResponse.json(mockShopItemsResponse);
  }),

  // 七.2: GET /api/version — 返回版本号
  http.get('/api/version', () => {
    return HttpResponse.json({ version: '3.3.0-test' });
  }),

  // v3.8.0-S13: GET /api/init/status — 首启动检测（公开接口，未登录可用）
  // 测试环境默认 needs_init=false，避免 Login 页卡在 "加载中…"
  http.get('/api/init/status', () => {
    return HttpResponse.json({ needs_init: false });
  }),

  // v4.22.1: POST /api/init/auto-detect-local-daemon — 自动检测本机 Daemon
  // 测试环境默认返回成功（daemon_token 已填充），避免 SetupWizard 进入 Step 3 时报未处理请求
  http.post('/api/init/auto-detect-local-daemon', () => {
    return HttpResponse.json({
      ok: true,
      daemon_token: 'mock-daemon-token-for-test',
      port: 8080,
      daemon_version: '4.22.1-test',
      latency_ms: 8,
    });
  }),

  // v3.9.0-S7: GET /api/settings/site-info — 站点信息（公开接口）
  http.get('/api/settings/site-info', () => {
    return HttpResponse.json({
      name: 'GameServer Panel',
      announcement: '',
      logoUrl: '',
    });
  }),

  // GET /api/quotas — 返回用户配额
  http.get('/api/quotas', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    return HttpResponse.json({
      quota: { max_instances: 5, max_disk_mb: 50000 },
      usage: { instances_used: 1, disk_used_mb: 10000 },
      can_create_instance: true
    });
  }),

  // ========================================================================
  // v4.13.0: 实例店铺外观配置（ShopConfigApi）
  // ========================================================================

  // GET /api/store/servers/:serverId/shop-config
  http.get('/api/store/servers/:serverId/shop-config', ({ request, params }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    return HttpResponse.json({
      config: {
        server_id: String(params.serverId),
        banner_url: null,
        banner_link: null,
        shop_description: 'Mock 店铺描述 — v4.13.0 E2E 测试',
        shop_theme_color: '#f59e0b',
        updated_at: '2026-07-24T00:00:00.000Z',
      },
    });
  }),

  // PUT /api/store/servers/:serverId/shop-config
  http.put('/api/store/servers/:serverId/shop-config', async ({ request, params }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      config: {
        server_id: String(params.serverId),
        banner_url: (body.banner_url as string | null) ?? null,
        banner_link: (body.banner_link as string | null) ?? null,
        shop_description: (body.shop_description as string | null) ?? null,
        shop_theme_color: (body.shop_theme_color as string | null) ?? '#f59e0b',
        updated_at: new Date().toISOString(),
      },
    });
  }),

  // ========================================================================
  // v4.13.0: 实例级商店商品 + 订单（替代根级 /api/shop-items 占位）
  // ========================================================================

  // GET /api/servers/:serverId/shop-items
  http.get('/api/servers/:serverId/shop-items', ({ request, params }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    return HttpResponse.json({
      items: [
        {
          id: 1,
          server_id: String(params.serverId),
          item_name: 'diamond',
          quality: 'rare' as const,
          vip_level_required: 0,
          price: 100,
          daily_limit: null,
          enabled: true,
          created_at: '2026-07-24T00:00:00.000Z',
          updated_at: '2026-07-24T00:00:00.000Z',
        },
        {
          id: 2,
          server_id: String(params.serverId),
          item_name: 'netherite-ingot',
          quality: 'epic' as const,
          vip_level_required: 3,
          price: 500,
          daily_limit: 5,
          enabled: true,
          created_at: '2026-07-24T00:00:00.000Z',
          updated_at: '2026-07-24T00:00:00.000Z',
        },
      ],
    });
  }),

  // POST /api/servers/:serverId/shop-orders
  http.post('/api/servers/:serverId/shop-orders', async ({ request, params }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    return HttpResponse.json({
      order: {
        id: Math.floor(Math.random() * 100000),
        server_id: String(params.serverId),
        user_id: 'user-user-001',
        status: 'pending' as const,
        claim_code: 'MOCK-' + Date.now(),
        items_count: 1,
        total_price: 100,
        claimed_at: null,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        claimed_player: null,
        created_at: new Date().toISOString(),
      },
      items: [],
    });
  }),

  // ========================================================================
  // v4.13.0: 玩家绑定（PlayerBindingsApi）
  // ========================================================================

  // GET /api/player-bindings[?server_id=]
  http.get('/api/player-bindings', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    return HttpResponse.json({ bindings: [] });
  }),

  // POST /api/player-bindings
  // v4.19.3: 响应体改用统一 Binding 契约（替代旧 PlayerBindingSummary 字段）
  // v4.27.0: 请求体 game_type → server_id（BREAKING）；scope_type='instance', scope_ref=server_id
  http.post('/api/player-bindings', async ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const body = (await request.json()) as { game_player_name: string; server_id: string };
    return HttpResponse.json({
      binding: {
        id: Math.floor(Math.random() * 100000),
        user_id: 'user-user-001',
        binding_type: 'player' as const,
        scope_type: 'instance' as const,
        scope_ref: body.server_id,
        player_name: body.game_player_name,
        vip_level: 0,
        wallet_id: null,
        verify_status: 'pending' as const,
        verify_code: 'MOCK-' + Math.floor(Math.random() * 99999),
        verify_expires_at: null,
        verified_at: null,
        metadata: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
  }),

  // POST /api/player-bindings/:id/verify
  // v4.19.3: 响应体改用统一 Binding 契约
  // v4.27.0: scope_type='instance', scope_ref=server_id（与 POST 创建响应语义对齐）
  // v4.x.0: 验证通过后 vip_level=1（强制绑定才有 VIP，与 instanceBindingService.verifyBindingByCode 对齐）
  http.post('/api/player-bindings/:id/verify', async ({ request, params }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const body = (await request.json()) as { verify_code: string };
    return HttpResponse.json({
      binding: {
        id: Number(params.id),
        user_id: 'user-user-001',
        binding_type: 'player' as const,
        scope_type: 'instance' as const,
        scope_ref: 'srv-001',
        player_name: 'MockPlayer',
        vip_level: 1,
        wallet_id: null,
        verify_status: 'verified' as const,
        verify_code: body.verify_code,
        verify_expires_at: null,
        verified_at: new Date().toISOString(),
        metadata: '',
        created_at: '2026-07-24T00:00:00.000Z',
        updated_at: new Date().toISOString(),
      },
    });
  }),

  // DELETE /api/player-bindings/:id
  http.delete('/api/player-bindings/:id', ({ request, params }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    return HttpResponse.json({ id: Number(params.id), deleted: true });
  }),

  // ========================================================================
  // v4.13.0: GM Workbench 后端 API（StoreGmApi）
  // ========================================================================

  // GET /api/store/players?instance_id=&page=&limit=&search=
  http.get('/api/store/players', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') || '1');
    const limit = Number(url.searchParams.get('limit') || '20');
    return HttpResponse.json({
      players: [
        {
          user_id: 'user-user-001',
          username: 'user',
          email: 'user@local.dev',
          game_player_name: 'MockPlayer',
          game_type: 'minecraft',
          status: 'verified',
          vip_level: 0,
          vip_expires_at: null,
          total_spent: 100,
          order_count: 1,
          total_playtime_seconds: 3600,
          session_count: 1,
          bound_at: '2026-07-24T00:00:00.000Z',
        },
      ],
      pagination: {
        page,
        limit,
        total: 1,
        total_pages: 1,
      },
    });
  }),

  // GET /api/store/reports/revenue?instance_id=&days=
  http.get('/api/store/reports/revenue', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const url = new URL(request.url);
    const days = Number(url.searchParams.get('days') || '30');
    const daily = Array.from({ length: Math.min(days, 7) }, (_, i) => ({
      date: `2026-07-${String(24 - i).padStart(2, '0')}`,
      order_count: 1,
      revenue: 100,
      cdk_redeemed: 0,
    }));
    return HttpResponse.json({
      daily,
      summary: {
        total_revenue: daily.reduce((s, d) => s + d.revenue, 0),
        total_orders: daily.reduce((s, d) => s + d.order_count, 0),
        total_cdk_redeemed: 0,
        days,
      },
    });
  }),

  // GET /api/store/reports/playtime?instance_id=&days=
  http.get('/api/store/reports/playtime', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const url = new URL(request.url);
    const days = Number(url.searchParams.get('days') || '30');
    const daily = Array.from({ length: Math.min(days, 7) }, (_, i) => ({
      date: `2026-07-${String(24 - i).padStart(2, '0')}`,
      session_count: 1,
      total_seconds: 3600,
      active_players: 1,
      avg_seconds: 3600,
    }));
    return HttpResponse.json({
      daily,
      summary: {
        total_playtime_seconds: daily.reduce((s, d) => s + d.total_seconds, 0),
        total_sessions: daily.reduce((s, d) => s + d.session_count, 0),
        active_players: 1,
        days,
      },
      note: 'Mock 数据 — daemon 写入链路未启用',
    });
  }),

  // GET /api/store/servers[?all=true]
  http.get('/api/store/servers', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    return HttpResponse.json({
      servers: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          name: '🏚️ 腐蚀 · 演示服',
          pack_id: 'rust-vanilla',
          game_type: 'rust',
          owner_user_id: 'user-manager-001',
          status: 'stopped',
          port: 28015,
          rcon_port: 28016,
          online_players: 0,
          today_revenue: 0,
          today_orders: 0,
          created_at: '2026-07-24T00:00:00.000Z',
        },
      ],
    });
  }),

  // ========================================================================
  // v4.13.0 步骤16: GM Workbench 玩家操作 API（StorePlayerActionsApi）
  // ========================================================================

  // POST /api/store/players/:userId/compensate
  http.post('/api/store/players/:userId/compensate', async ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const body = (await request.json()) as { instance_id: string; item: string; count: number };
    return HttpResponse.json({
      success: true,
      command: `give MockPlayer ${body.item} ${body.count}`,
    });
  }),

  // POST /api/store/players/:userId/ban
  http.post('/api/store/players/:userId/ban', async ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    return HttpResponse.json({
      success: true,
      command: 'ban MockPlayer',
    });
  }),

  // POST /api/store/players/:userId/adjust-playtime
  http.post('/api/store/players/:userId/adjust-playtime', async ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const body = (await request.json()) as { delta_seconds: number };
    const now = new Date();
    now.setSeconds(now.getSeconds() + body.delta_seconds);
    return HttpResponse.json({
      success: true,
      previous_expires_at: null,
      current_expires_at: now.toISOString(),
      delta_seconds: body.delta_seconds,
    });
  }),

  // ========================================================================
  // v4.15.0: 玩家门户聚合 API（/api/my/*）+ 发现页推荐 + CDK 兑换
  // ========================================================================

  // GET /api/my/orders[?status=pending|claimed|expired] — 跨实例"我的订单"
  // status=pending 时同时包含 claiming（与后端 my.ts 行为对齐）
  http.get('/api/my/orders', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    let orders = mockMyOrders;
    if (status === 'pending') {
      orders = orders.filter((o) => o.status === 'pending' || o.status === 'claiming');
    } else if (status === 'claimed' || status === 'expired') {
      orders = orders.filter((o) => o.status === status);
    }
    return HttpResponse.json({ orders });
  }),

  // GET /api/my/overview — 玩家门户首页聚合概览
  http.get('/api/my/overview', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    return HttpResponse.json({ overview: mockMyOverview });
  }),

  // GET /api/discover/recommended[?limit=] — 推荐服务器（公开数据，仍需登录态）
  http.get('/api/discover/recommended', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') || '8');
    return HttpResponse.json({ servers: mockDiscoverRecommended.slice(0, limit) });
  }),

  http.get('/api/cdk/lookup', ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const url = new URL(request.url);
    const code = (url.searchParams.get('code') || '').toUpperCase();
    if (!code || code !== 'MOCK-VALID') {
      return HttpResponse.json(
        { error: { code: 'CDK_NOT_FOUND', message: '卡密不存在' } },
        { status: 404 },
      );
    }
    return HttpResponse.json({
      code: {
        gift_name: '新手礼包',
        gift_description: 'Mock 新手礼包',
        item_name: 'diamond_sword',
        count: 1,
        quality: 'epic',
        items: [
          { item_name: 'diamond_sword', count: 1, quality: 'epic' },
          { item_name: 'bread', count: 5, quality: 'normal' },
        ],
        expires_at: '2026-12-31T23:59:59.000Z',
        status: 'active',
        server_id: 'srv-001',
      },
    });
  }),

  http.post('/api/cdk/redeem', async ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const body = (await request.json()) as { code: string; player_name: string };
    if ((body.code || '').toUpperCase() !== 'MOCK-VALID') {
      return HttpResponse.json(
        { error: { code: 'CDK_INVALID', message: '卡密无效或已被使用' } },
        { status: 400 },
      );
    }
    return HttpResponse.json({
      delivered: true,
      followed: true,
      code: {
        id: 9001,
        server_id: 'srv-001',
        code: body.code,
        gift_name: '新手礼包',
        gift_description: 'Mock 新手礼包',
        item_name: 'diamond_sword',
        count: 1,
        quality: 'epic' as const,
        items: [
          { item_name: 'diamond_sword', count: 1, quality: 'epic' as const },
          { item_name: 'bread', count: 5, quality: 'normal' as const },
        ],
        status: 'claimed' as const,
        claimed_player: body.player_name,
        claimed_at: new Date().toISOString(),
        expires_at: '2026-12-31T23:59:59.000Z',
        created_by: 'user-admin-001',
        created_at: '2026-07-01T00:00:00.000Z',
      },
    });
  }),

  // POST /api/servers/:id/cdk/redeem — CDK 兑换（有效卡密 MOCK-VALID 发放奖励）
  http.post('/api/servers/:id/cdk/redeem', async ({ request, params }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const body = (await request.json()) as { code: string; player_name: string };
    if (body.code !== 'MOCK-VALID') {
      return HttpResponse.json(
        { error: { code: 'CDK_INVALID', message: '卡密无效或已被使用' } },
        { status: 400 },
      );
    }
    return HttpResponse.json({
      delivered: true,
      code: {
        id: 9001,
        server_id: String(params.id),
        code: body.code,
        gift_name: '新手礼包',
        gift_description: 'Mock 新手礼包',
        item_name: 'diamond_sword',
        count: 1,
        quality: 'epic' as const,
        items: [
          { item_name: 'diamond_sword', count: 1, quality: 'epic' as const },
          { item_name: 'bread', count: 5, quality: 'normal' as const },
        ],
        status: 'claimed' as const,
        claimed_player: body.player_name,
        claimed_at: new Date().toISOString(),
        expires_at: '2026-12-31T23:59:59.000Z',
        created_by: 'user-admin-001',
        created_at: '2026-07-01T00:00:00.000Z',
      },
    });
  }),
];

// ----- v4.15.0 玩家门户 Mock fixtures -----

/** 跨实例"我的订单" fixture（含 pending/claiming/claimed/expired 全状态） */
export const mockMyOrders = [
  {
    id: '101',
    instance_id: 'srv-001',
    instance_name: '主服务器',
    items: [
      { item_name: 'diamond_sword', count: 1, price: 100, quality: 'epic' },
      { item_name: 'bread', count: 5, price: 10, quality: 'normal' },
    ],
    total_price: 150,
    status: 'pending' as const,
    claim_code: 'MOCK-AAAA-1111',
    claimed_at: null,
    expires_at: '2026-12-31T23:59:59.000Z',
    created_at: '2026-07-20T10:00:00.000Z',
  },
  {
    id: '102',
    instance_id: 'srv-001',
    instance_name: '主服务器',
    items: [{ item_name: 'iron-plate', count: 20, price: 4, quality: 'normal' }],
    total_price: 80,
    status: 'claiming' as const,
    claim_code: 'MOCK-BBBB-2222',
    claimed_at: null,
    expires_at: '2026-12-31T23:59:59.000Z',
    created_at: '2026-07-21T10:00:00.000Z',
  },
  {
    id: '103',
    instance_id: 'srv-002',
    instance_name: '创造服',
    items: [{ item_name: 'rocket', count: 1, price: 300, quality: 'legendary' }],
    total_price: 300,
    status: 'claimed' as const,
    claim_code: 'MOCK-CCCC-3333',
    claimed_at: '2026-07-19T08:00:00.000Z',
    expires_at: '2026-12-31T23:59:59.000Z',
    created_at: '2026-07-18T10:00:00.000Z',
  },
  {
    id: '104',
    instance_id: 'srv-002',
    instance_name: '创造服',
    items: [{ item_name: 'wood', count: 64, price: 1, quality: 'normal' }],
    total_price: 64,
    status: 'expired' as const,
    claim_code: 'MOCK-DDDD-4444',
    claimed_at: null,
    expires_at: '2026-07-01T00:00:00.000Z',
    created_at: '2026-06-28T10:00:00.000Z',
  },
];

/** 玩家门户首页聚合概览 fixture */
export const mockMyOverview = {
  bindings_total: 3,
  bindings_verified: 2,
  unread_notifications: 2,
  pending_orders: 2,
  wallet_balance: 400,
  daily_claimable: 2,
};

/** 推荐服务器 fixture（DiscoverServer 契约） */
export const mockDiscoverRecommended = [
  {
    id: 'srv-rec-1',
    name: '推荐·生存工艺',
    pack_id: 'pack-minecraft-vanilla',
    status: 'running',
    online_players: 42,
    is_public: true,
    is_recommended: true,
    created_at: '2026-07-01T00:00:00.000Z',
    owner_username: 'admin',
  },
  {
    id: 'srv-rec-2',
    name: '推荐·异星工厂',
    pack_id: 'pack-factorio-2.0',
    status: 'running',
    online_players: 17,
    is_public: true,
    is_recommended: true,
    created_at: '2026-07-02T00:00:00.000Z',
    owner_username: 'manager',
  },
  {
    id: 'srv-rec-3',
    name: '推荐·幻兽乐园',
    pack_id: 'pack-palworld',
    status: 'stopped',
    online_players: 0,
    is_public: true,
    is_recommended: true,
    created_at: '2026-07-03T00:00:00.000Z',
    owner_username: 'admin',
  },
];
