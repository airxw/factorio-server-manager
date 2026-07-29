// ============================================================================
// PanelApi 客户端单测 — 覆盖 fetch 封装的核心行为
// 1. 成功响应的 JSON 解析
// 2. 401 触发 onUnauthorized + 抛 PANEL_UNAUTHORIZED
// 3. 非 2xx 且返回 JSON 错误体 → 抛带 code/message 的 PanelApiError
// 4. 非 2xx 且返回非 JSON → 抛 HTTP_<status> + statusText
// 5. fetch reject → 抛 NETWORK_ERROR
// 6. 204 → 返回 undefined
// 7. token 自动附加 Authorization: Bearer
// 不修改 client.ts 实现，仅测试其现有行为
// ============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, PanelApiError } from './client';

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('PanelApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('login 成功时返回解析后的 JSON（token + user）', async () => {
    const mockResponse = {
      token: 'jwt-abc',
      user: {
        id: 'u1',
        email: 'admin@local.dev',
        username: 'admin',
        role: 'server_admin',
        status: 'active',
        created_at: '2025-01-01T00:00:00.000Z',
      },
    };
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(mockResponse));
    vi.stubGlobal('fetch', fetchSpy);

    const api = createApiClient();
    const res = await api.login({ email: 'admin@local.dev', password: 'admin123' });

    expect(res).toEqual(mockResponse);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('401 时调用 onUnauthorized 并抛出 PanelApiError(PANEL_UNAUTHORIZED)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchSpy);
    const onUnauthorized = vi.fn();
    const api = createApiClient({ onUnauthorized });

    await expect(api.me()).rejects.toMatchObject({
      name: 'PanelApiError',
      code: 'PANEL_UNAUTHORIZED',
      status: 401,
    });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('401 时未传 onUnauthorized 也不报错（仅抛异常）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const api = createApiClient();

    await expect(api.me()).rejects.toMatchObject({ code: 'PANEL_UNAUTHORIZED' });
  });

  it('非 2xx 返回 JSON 错误体时，抛出携带后端 code/message 的 PanelApiError', async () => {
    const errorBody = { error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(errorBody, { status: 400 })));
    const api = createApiClient();

    await expect(api.me()).rejects.toMatchObject({
      name: 'PanelApiError',
      code: 'INVALID_CREDENTIALS',
      message: '邮箱或密码错误',
      status: 400,
    });
  });

  it('非 2xx 返回非 JSON 时，抛出 HTTP_<status> + statusText', async () => {
    // text body → res.json() 抛错被吞，保留默认 code/message
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Internal Server Error', { status: 500 })),
    );
    const api = createApiClient();

    try {
      await api.me();
      throw new Error('应抛出 PanelApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(PanelApiError);
      const e = err as PanelApiError;
      expect(e.code).toBe('HTTP_500');
      expect(e.status).toBe(500);
      expect(e.message).toBeTruthy();
    }
  });

  it('fetch reject 时抛出 NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')));
    const api = createApiClient();

    await expect(api.me()).rejects.toMatchObject({
      name: 'PanelApiError',
      code: 'NETWORK_ERROR',
      status: 0,
    });
  });

  it('NETWORK_ERROR 的 message 取自底层 Error.message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('连接被重置')));
    const api = createApiClient();

    await expect(api.me()).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: '连接被重置' });
  });

  it('204 No Content 返回 undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const api = createApiClient();

    await expect(api.deleteServer('srv-1')).resolves.toBeUndefined();
  });

  it('配置 token 时自动附加 Authorization: Bearer 头', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ servers: [] }));
    vi.stubGlobal('fetch', fetchSpy);
    const api = createApiClient({ token: 'jwt-xyz' });

    await api.listServers();

    const [, init] = fetchSpy.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer jwt-xyz');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('未配置 token 时不附加 Authorization 头', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ servers: [] }));
    vi.stubGlobal('fetch', fetchSpy);
    const api = createApiClient();

    await api.listServers();

    const [, init] = fetchSpy.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('PanelApiError 是 Error 子类，name/code/status 正确', () => {
    const err = new PanelApiError('SOME_CODE', '错误说明', 422);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PanelApiError');
    expect(err.code).toBe('SOME_CODE');
    expect(err.status).toBe(422);
    expect(err.message).toBe('错误说明');
  });

  // ----- v4.15.0 玩家门户聚合 API -----

  it('listMyOrders 无 status 时请求 /api/my/orders（无查询串）', async () => {
    const body = { orders: [] };
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(body));
    vi.stubGlobal('fetch', fetchSpy);
    const api = createApiClient({ token: 'jwt-xyz' });

    const res = await api.listMyOrders();

    expect(res).toEqual(body);
    // GET 请求 client 不显式设置 method（fetch 默认 GET），仅断言 URL 与鉴权头
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/my/orders');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer jwt-xyz');
  });

  it('listMyOrders 携带 status 时拼接 ?status= 查询串并做 URL 编码', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ orders: [] }));
    vi.stubGlobal('fetch', fetchSpy);
    const api = createApiClient({ token: 'jwt-xyz' });

    await api.listMyOrders('pending');

    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe('/api/my/orders?status=pending');
  });

  it('getMyOverview 请求 /api/my/overview 并返回聚合概览', async () => {
    const body = {
      overview: {
        bindings_total: 3,
        bindings_verified: 2,
        unread_notifications: 2,
        pending_orders: 2,
        wallet_balance: 400,
        daily_claimable: 2,
      },
    };
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(body));
    vi.stubGlobal('fetch', fetchSpy);
    const api = createApiClient({ token: 'jwt-xyz' });

    const res = await api.getMyOverview();

    expect(res).toEqual(body);
    expect(res.overview.wallet_balance).toBe(400);
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe('/api/my/overview');
  });
});
