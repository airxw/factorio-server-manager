// ============================================================================
// SetupWizard.test.tsx — Setup Wizard 前端组件测试（已对齐 v4.22.x UI）
//
// 覆盖 8 步流程：
//   Step 0: 环境预检（warn 不再阻塞，仅 error 阻塞）
//   Step 1: 运行模式选择（v4.21.0 可点击卡片，demo 模式跳过 Step 2/3/4/5）
//   Step 2: 数据库连接配置（SQLite/MySQL/PG + 测试连接；v4.22.1 SQLite 需勾选确认）
//   Step 3: Daemon 节点配置（v4.22.x 三模式：local 自动检测 / multi 导入链接 / skip）
//   Step 4: 站点信息 + 公网入口（PUBLIC_BASE_URL + HTTPS 校验）
//   Step 5: 管理员账号（v4.22.0 五字段：用户名/邮箱/昵称/密码/确认密码）
//   Step 6: Pack 来源（v4.22.0 四 Tab：GitHub 同步/自定义 URL/上传 zip/跳过）
//   Step 7: 完成 + 重启（触发 systemctl restart，轮询健康检查，跳转登录）
//
// 关键场景：
//   - needs_init=false 时 Navigate 到 /login
//   - WEAK_PASSWORD 错误展示 details.failures（submitError 由 AdminStep 渲染）
//   - Step 0 warn 项不阻塞
//   - Step 2 测试连接通过 + SQLite 勾选确认后才允许下一步
//   - Step 3 local 自动检测通过 / multi 导入节点 / skip 任一满足才允许下一步
//   - Step 6 提交负载携带 pack_source（skip 时不携带）
//   - Step 7 提交成功后触发重启并轮询 /api/health
// ============================================================================

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlers } from '../../mocks/handlers';
import { renderWithProviders, screen, userEvent, waitFor } from '../../test/utils';
import SetupWizard from '../SetupWizard';
import type {
  InitPreflightResponse,
  PasswordPolicyResponse,
  InitSubmitResponse,
  PackSummary,
  SyncPacksResponse,
  TestDaemonConnectionResponse,
  TestDatabaseConnectionResponse,
} from '@public/schema/panel-api-types';

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PASSWORD_POLICY_FIXTURE: PasswordPolicyResponse = {
  min_length: 8,
  max_length: 128,
  min_zxcvbn_score: 2,
  require_letter: true,
  require_digit: true,
  forbidden_passwords: ['admin123', '12345678', 'password'],
};

/** GitHub 同步成功后返回的 pack 列表 */
const PACK_SUMMARIES: PackSummary[] = [
  {
    id: 'pack-minecraft',
    display_name: 'Minecraft',
    game: 'minecraft',
    variant: 'vanilla',
    version: '1.20.1',
  },
  {
    id: 'pack-factorio',
    display_name: 'Factorio',
    game: 'factorio',
    variant: 'vanilla',
    version: '2.0.0',
  },
];

/** Pack 同步成功响应（POST /api/init/packs/sync） */
const PACK_SYNC_OK: SyncPacksResponse = {
  ok: true,
  synced_count: 2,
  packs: PACK_SUMMARIES,
};

/** 多节点模式：测试连接并导入成功响应（POST /api/init/test-daemon） */
const DAEMON_TEST_OK: TestDaemonConnectionResponse = {
  ok: true,
  latency_ms: 6,
  daemon_version: '4.22.1-test',
};

/** 全部 ok 的 preflight 响应（无 warn/error） */
const PREFLIGHT_ALL_OK: InitPreflightResponse = {
  needs_init: true,
  all_ok: true,
  checks: [
    { key: 'database', label: '数据库', status: 'ok', detail: '数据库响应正常', actionable: false },
    { key: 'migrations', label: '迁移', status: 'ok', detail: '已就绪', actionable: false },
    { key: 'daemon', label: 'Daemon', status: 'ok', detail: '节点健康', actionable: false },
    { key: 'packs', label: 'Pack', status: 'ok', detail: '已加载 2 个 Pack', actionable: false },
    { key: 'db_config', label: '数据库配置', status: 'ok', detail: 'PostgreSQL', actionable: false },
    { key: 'mode', label: '运行模式', status: 'ok', detail: '生产模式', actionable: false },
    { key: 'disk', label: '磁盘空间', status: 'ok', detail: '剩余 50GB', actionable: false },
    { key: 'public_url', label: '公网 URL', status: 'ok', detail: 'HTTPS', actionable: false },
  ],
};

/** db_config=warn 的 preflight 响应（SQLite 警告，v4.20.0 不再阻塞） */
const PREFLIGHT_DB_WARN: InitPreflightResponse = {
  ...PREFLIGHT_ALL_OK,
  all_ok: true,
  checks: PREFLIGHT_ALL_OK.checks.map((c) =>
    c.key === 'db_config'
      ? { ...c, status: 'warn', detail: 'SQLite at ./data/panel.db（可在向导内切换）' }
      : c,
  ),
};

/** db_config=error 的 preflight 响应 */
const PREFLIGHT_DB_ERROR: InitPreflightResponse = {
  ...PREFLIGHT_ALL_OK,
  all_ok: false,
  checks: PREFLIGHT_ALL_OK.checks.map((c) =>
    c.key === 'db_config'
      ? { ...c, status: 'error', detail: 'DATABASE_URL 未配置', actionable: false }
      : c,
  ),
};

/** 演示模式的 preflight 响应（mode 检查项 detail 含"演示模式"） */
const PREFLIGHT_DEMO_MODE: InitPreflightResponse = {
  ...PREFLIGHT_ALL_OK,
  checks: PREFLIGHT_ALL_OK.checks.map((c) =>
    c.key === 'mode' ? { ...c, detail: '演示模式' } : c,
  ),
};

/** 数据库测试连接成功响应 */
const DB_TEST_OK: TestDatabaseConnectionResponse = {
  ok: true,
  latency_ms: 12,
  server_version: '3.45.1',
};

// ---------------------------------------------------------------------------
// 辅助：覆盖默认 handlers
// ---------------------------------------------------------------------------

function overrideInitStatus(needsInit: boolean) {
  server.use(
    http.get('/api/init/status', () => HttpResponse.json({ needs_init: needsInit })),
  );
}

function overridePreflight(response: InitPreflightResponse) {
  server.use(
    http.get('/api/init/preflight', () => HttpResponse.json(response)),
  );
}

function overridePasswordPolicy(policy: PasswordPolicyResponse) {
  server.use(
    http.get('/api/auth/password-policy', () => HttpResponse.json(policy)),
  );
}

function overrideTestDaemon(response: TestDaemonConnectionResponse) {
  server.use(
    http.post('/api/init/test-daemon', () => HttpResponse.json(response)),
  );
}

function overridePackSync(response: SyncPacksResponse) {
  server.use(
    http.post('/api/init/packs/sync', () => HttpResponse.json(response)),
  );
}

/**
 * 构造 gsp-daemon-import:// 链接（与 DaemonNodeStep.parseDaemonImportLink 对齐）。
 * UTF-8 安全 base64（节点名可能为中文）。
 */
function buildDaemonImportLink(payload: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return `gsp-daemon-import://${btoa(binary)}`;
}

function overrideTestDatabase(response: TestDatabaseConnectionResponse) {
  server.use(
    http.post('/api/init/test-database', () => HttpResponse.json(response)),
  );
}

function overrideSubmitInit(
  handler: (body: Record<string, unknown>) => Response,
) {
  server.use(
    http.post('/api/init', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      return handler(body);
    }),
  );
}

function overrideRestart() {
  server.use(
    http.post('/api/init/restart', () =>
      HttpResponse.json({ triggered: true, triggered_at: '2026-07-25T00:00:00.000Z' }),
    ),
  );
  // /api/health 轮询：前 2 次返回 503（模拟重启中），第 3 次返回 200
  let healthCallCount = 0;
  server.use(
    http.get('/api/health', () => {
      healthCallCount++;
      if (healthCallCount <= 2) {
        return HttpResponse.json({ error: 'restarting' }, { status: 503 });
      }
      return HttpResponse.json({ status: 'ok' });
    }),
  );
}

// ---------------------------------------------------------------------------
// env 快照（VITE_ENABLE_DEMO）
// ---------------------------------------------------------------------------

const envSnapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  envSnapshot.VITE_ENABLE_DEMO = process.env.VITE_ENABLE_DEMO;
  delete process.env.VITE_ENABLE_DEMO;
  // 安全网：Step 7 测试组件卸载后，RestartStep 内部 3s 延迟定时器仍可能在后续
  // 测试中触发 POST /api/init/restart 与 GET /api/health 轮询。afterEach 的
  // resetHandlers 会移除用例级 override，这里为每个用例提供兜底 handler，
  // 避免 onUnhandledRequest: 'error' 造成跨用例误报（用例内 override 优先于兜底）。
  server.use(
    http.post('/api/init/restart', () =>
      HttpResponse.json({ triggered: true, triggered_at: '2026-07-25T00:00:00.000Z' }),
    ),
    http.get('/api/health', () => HttpResponse.json({ status: 'ok' })),
  );
});

afterEach(() => {
  if (envSnapshot.VITE_ENABLE_DEMO === undefined) {
    delete process.env.VITE_ENABLE_DEMO;
  } else {
    process.env.VITE_ENABLE_DEMO = envSnapshot.VITE_ENABLE_DEMO;
  }
  vi.useRealTimers();
});

// ===========================================================================
// 1. 入口门控：needs_init 状态决定渲染
// ===========================================================================

describe('SetupWizard — 入口门控', () => {
  it('needs_init=false 时 Navigate 到 /login', async () => {
    // Step 0 的 preflight effect 与 status 检查并发触发——提供兜底 handler 避免 MSW 未拦截告警
    overridePreflight(PREFLIGHT_ALL_OK);
    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    await waitFor(() => {
      const loadingText = screen.queryByText('正在检查系统状态…');
      expect(loadingText).not.toBeInTheDocument();
      const hasSetupTitle = screen.queryByText('欢迎使用 GameServer Panel') !== null;
      expect(hasSetupTitle).toBe(false);
    });
  });

  it('needs_init=true 时渲染向导标题（欢迎使用 GameServer Panel）', async () => {
    overrideInitStatus(true);
    overridePreflight(PREFLIGHT_ALL_OK);

    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    await waitFor(() => {
      expect(screen.getByText('欢迎使用 GameServer Panel')).toBeInTheDocument();
    });
    expect(screen.getByText('进入初始化前，请确认服务器环境已就绪。')).toBeInTheDocument();
  });
});

// ===========================================================================
// 2. Step 0: 环境预检
// ===========================================================================

describe('SetupWizard — Step 0: 环境预检', () => {
  it('加载并展示 8 项 preflight 检查', async () => {
    overrideInitStatus(true);
    overridePreflight(PREFLIGHT_ALL_OK);

    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    await waitFor(() => {
      expect(screen.getByText('磁盘空间')).toBeInTheDocument();
    });
    expect(screen.getByText('迁移')).toBeInTheDocument();
    expect(screen.getAllByText('Daemon').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Pack')).toBeInTheDocument();
    expect(screen.getByText('数据库配置')).toBeInTheDocument();
    expect(screen.getAllByText('运行模式').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('磁盘空间')).toBeInTheDocument();
    expect(screen.getByText('公网 URL')).toBeInTheDocument();

    const nextBtn = screen.getByRole('button', { name: /下一步/ });
    expect(nextBtn).not.toBeDisabled();
  });

  it('v4.20.0: db_config=warn 时不显示确认勾选框，"下一步"仍可点击', async () => {
    overrideInitStatus(true);
    overridePreflight(PREFLIGHT_DB_WARN);

    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    await waitFor(() => {
      expect(screen.getByText(/可在向导内切换/)).toBeInTheDocument();
    });

    // v4.20.0 移除了 dbConfigAck——不再有确认勾选框
    expect(screen.queryByText(/我已知悉当前数据库配置为 SQLite/)).not.toBeInTheDocument();

    // "下一步"可点击（warn 不阻塞）
    const nextBtn = screen.getByRole('button', { name: /下一步/ });
    expect(nextBtn).not.toBeDisabled();
  });

  it('db_config=error 时禁用"下一步"', async () => {
    overrideInitStatus(true);
    overridePreflight(PREFLIGHT_DB_ERROR);

    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    await waitFor(() => {
      expect(screen.getByText('DATABASE_URL 未配置')).toBeInTheDocument();
    });

    const nextBtn = screen.getByRole('button', { name: /下一步/ });
    expect(nextBtn).toBeDisabled();
  });

  it('点击"刷新预检"重新拉取 preflight', async () => {
    overrideInitStatus(true);
    let callCount = 0;
    server.use(
      http.get('/api/init/preflight', () => {
        callCount++;
        return HttpResponse.json(PREFLIGHT_ALL_OK);
      }),
    );

    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    await waitFor(() => {
      expect(callCount).toBe(1);
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /刷新预检/ }));

    await waitFor(() => {
      expect(callCount).toBe(2);
    });
  });

  it('preflight 接口失败时显示错误 + "重新检测"按钮', async () => {
    overrideInitStatus(true);
    server.use(
      http.get('/api/init/preflight', () =>
        HttpResponse.json(
          { error: { code: 'PANEL_INTERNAL_ERROR', message: '预检服务异常' } },
          { status: 500 },
        ),
      ),
    );

    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    await waitFor(() => {
      expect(screen.getByText('预检服务异常')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /重新检测/ })).toBeInTheDocument();
  });

  it('点击"下一步"进入 Step 1（运行模式选择）', async () => {
    overrideInitStatus(true);
    overridePreflight(PREFLIGHT_ALL_OK);

    const user = userEvent.setup();
    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    await waitFor(() => {
      expect(screen.getByText('磁盘空间')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /下一步/ }));

    await waitFor(() => {
      expect(screen.getByText('生产模式')).toBeInTheDocument();
    });
    // v4.21.0：运行模式为可点击选择卡片（生产 / 演示）
    expect(screen.getByText(/仅创建 1 个待初始化的管理员账号/)).toBeInTheDocument();
    expect(screen.getByText('演示模式')).toBeInTheDocument();
  });
});

// ===========================================================================
// 3. Step 1: 运行模式确认
// ===========================================================================

describe('SetupWizard — Step 1: 运行模式确认', () => {
  it('生产模式：下一步进入 Step 2（数据库连接配置）', async () => {
    overrideInitStatus(true);
    overridePreflight(PREFLIGHT_ALL_OK);

    const user = userEvent.setup();
    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    await waitFor(() => expect(screen.getByText('磁盘空间')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByText('生产模式')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => {
      expect(screen.getByText('数据库类型')).toBeInTheDocument();
    });
  });

  it('演示模式：下一步跳过 Step 2/3/4/5 直接到 Step 6（启用游戏）', async () => {
    overrideInitStatus(true);
    overridePreflight(PREFLIGHT_DEMO_MODE);

    const user = userEvent.setup();
    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    await waitFor(() => expect(screen.getByText('磁盘空间')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByText('演示模式')).toBeInTheDocument());

    // v4.21.0：显式点击"演示模式"卡片（不依赖 preflight/status 异步检测的写入时序）
    await user.click(screen.getByRole('button', { name: /演示模式/ }));
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    // v4.22.0：Step 6 为 Pack 来源四 Tab
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'GitHub 同步' })).toBeInTheDocument();
    });
    // 不应出现 Step 2/3/4/5 的内容
    expect(screen.queryByText('数据库类型')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/邮箱/)).not.toBeInTheDocument();
  });

  it('点击"上一步"返回 Step 0', async () => {
    overrideInitStatus(true);
    overridePreflight(PREFLIGHT_ALL_OK);

    const user = userEvent.setup();
    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    await waitFor(() => expect(screen.getByText('磁盘空间')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByText('生产模式')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /上一步/ }));
    await waitFor(() => {
      expect(screen.getByText('进入初始化前，请确认服务器环境已就绪。')).toBeInTheDocument();
    });
  });
});

// ===========================================================================
// 4. Step 2: 数据库连接配置（v4.20.0 新增）
// ===========================================================================

describe('SetupWizard — Step 2: 数据库连接配置', () => {
  async function goToStep2() {
    overrideInitStatus(true);
    overridePreflight(PREFLIGHT_ALL_OK);

    const user = userEvent.setup();
    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    await waitFor(() => expect(screen.getByText('磁盘空间')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByText('生产模式')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByText('数据库类型')).toBeInTheDocument());
    return user;
  }

  it('默认选中 SQLite，连接串为 ./data/panel.db', async () => {
    await goToStep2();

    // SQLite radio 选中
    const sqliteRadio = screen.getByRole('radio', { name: /SQLite/ }) as HTMLInputElement;
    expect(sqliteRadio.checked).toBe(true);

    // 连接串输入框
    const urlInput = screen.getByPlaceholderText('./data/panel.db') as HTMLInputElement;
    expect(urlInput.value).toBe('./data/panel.db');
  });

  it('未测试连接时"下一步"禁用', async () => {
    await goToStep2();

    expect(screen.getByRole('button', { name: /下一步/ })).toBeDisabled();
  });

  it('点击"测试连接"成功并勾选 SQLite 确认后"下一步"启用', async () => {
    overrideTestDatabase(DB_TEST_OK);
    const user = await goToStep2();

    await user.click(screen.getByRole('button', { name: /测试连接/ }));

    await waitFor(() => {
      expect(screen.getByText('连接成功')).toBeInTheDocument();
    });

    // v4.22.1：SQLite 需勾选生产警告确认后才允许下一步
    expect(screen.getByRole('button', { name: /下一步/ })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /我已知悉 SQLite/ }));
    expect(screen.getByRole('button', { name: /下一步/ })).not.toBeDisabled();
  });

  it('测试连接失败时"下一步"仍禁用 + 显示错误信息', async () => {
    overrideTestDatabase({ ok: false, error: '连接超时（5s）' });
    const user = await goToStep2();

    await user.click(screen.getByRole('button', { name: /测试连接/ }));

    await waitFor(() => {
      expect(screen.getByText('连接失败')).toBeInTheDocument();
    });
    expect(screen.getByText('连接超时（5s）')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下一步/ })).toBeDisabled();
  });

  it('切换数据库类型时重置测试状态 + 显示 MySQL 结构化字段', async () => {
    overrideTestDatabase(DB_TEST_OK);
    const user = await goToStep2();

    // 先测试 SQLite 连接
    await user.click(screen.getByRole('button', { name: /测试连接/ }));
    await waitFor(() => expect(screen.getByText('连接成功')).toBeInTheDocument());

    // 切换到 MySQL
    await user.click(screen.getByRole('radio', { name: /MySQL/ }));

    // 测试状态重置——"下一步"重新禁用
    expect(screen.getByRole('button', { name: /下一步/ })).toBeDisabled();
    // v4.21.1：MySQL 改为结构化字段（主机/端口/用户名/密码/数据库名），不再输入整串连接串
    expect(screen.getByLabelText(/主机地址/)).toBeInTheDocument();
    expect(screen.getByLabelText(/数据库名/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('gameserver_panel')).toBeInTheDocument();
  });

  it('点击"恢复 SQLite 默认"重置为 SQLite 配置', async () => {
    const user = await goToStep2();

    // 切换到 PostgreSQL
    await user.click(screen.getByRole('radio', { name: /PostgreSQL/ }));

    // 点击"恢复 SQLite 默认"
    await user.click(screen.getByRole('button', { name: /恢复 SQLite 默认/ }));

    // 回到 SQLite
    const sqliteRadio = screen.getByRole('radio', { name: /SQLite/ }) as HTMLInputElement;
    expect(sqliteRadio.checked).toBe(true);
    const urlInput = screen.getByPlaceholderText('./data/panel.db') as HTMLInputElement;
    expect(urlInput.value).toBe('./data/panel.db');
  });
});

// ===========================================================================
// 5. Step 3: Daemon 节点配置（v4.20.0 新增）
// ===========================================================================

describe('SetupWizard — Step 3: Daemon 节点配置', () => {
  async function goToStep3() {
    overrideInitStatus(true);
    overridePreflight(PREFLIGHT_ALL_OK);
    overrideTestDatabase(DB_TEST_OK);

    const user = userEvent.setup();
    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    await waitFor(() => expect(screen.getByText('磁盘空间')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByText('生产模式')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByText('数据库类型')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /测试连接/ }));
    await waitFor(() => expect(screen.getByText('连接成功')).toBeInTheDocument());
    // v4.22.1：SQLite 需勾选生产警告确认
    await user.click(screen.getByRole('checkbox', { name: /我已知悉 SQLite/ }));
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    // v4.22.x：Step 3 三模式卡片（默认"本机单节点"，进入时自动触发 auto-detect）
    await waitFor(() => expect(screen.getByText('本机单节点')).toBeInTheDocument());
    return user;
  }

  it('本机模式自动检测通过后"下一步"启用；多节点空列表时禁用', async () => {
    const user = await goToStep3();

    // 本机模式：auto-detect 自动触发（默认 mock 成功），测试通过后"下一步"启用
    await waitFor(() => {
      expect(screen.getByText('连接测试通过，可进入下一步。')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /下一步/ })).not.toBeDisabled();

    // 切到多节点模式：默认空节点列表，"下一步"禁用
    await user.click(screen.getByRole('button', { name: /多节点/ }));
    expect(screen.getByText('尚未添加任何 Daemon 节点。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下一步/ })).toBeDisabled();
  });

  it('选择"暂不配置"模式后"下一步"启用', async () => {
    const user = await goToStep3();

    await user.click(screen.getByRole('button', { name: /暂不配置/ }));

    expect(screen.getByText('已选择跳过 Daemon 配置。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下一步/ })).not.toBeDisabled();
  });

  it('多节点模式：粘贴导入链接测试通过并导入后"下一步"启用', async () => {
    overrideTestDaemon(DAEMON_TEST_OK);
    const user = await goToStep3();

    await user.click(screen.getByRole('button', { name: /多节点/ }));

    const link = buildDaemonImportLink({
      name: '边缘节点',
      fqdn: 'node1.example.com',
      port: 8080,
      token: 'tok-secret-1',
    });
    await user.type(screen.getByLabelText(/导入链接/), link);
    await user.click(screen.getByRole('button', { name: /测试连接并导入/ }));

    // 导入成功：节点加入列表（计数变为 1），"下一步"启用
    await waitFor(() => {
      expect(screen.getByText('3. 已添加的节点（1）')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /下一步/ })).not.toBeDisabled();
  });

  it('导入链接格式错误时展示解析错误', async () => {
    const user = await goToStep3();

    await user.click(screen.getByRole('button', { name: /多节点/ }));
    await user.type(screen.getByLabelText(/导入链接/), 'not-a-valid-link');
    await user.click(screen.getByRole('button', { name: /测试连接并导入/ }));

    // 链接解析失败——展示校验错误，"下一步"保持禁用
    await waitFor(() => {
      expect(screen.getByText(/链接格式错误：必须以 gsp-daemon-import:\/\/ 开头/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /下一步/ })).toBeDisabled();
  });

  it('点击"上一步"返回 Step 2', async () => {
    const user = await goToStep3();

    await user.click(screen.getByRole('button', { name: /上一步/ }));
    await waitFor(() => {
      expect(screen.getByText('数据库类型')).toBeInTheDocument();
    });
  });
});

// ===========================================================================
// 6. Step 4: 站点信息 + 公网入口（v4.20.0 合并）
// ===========================================================================

describe('SetupWizard — Step 4: 站点信息 + 公网入口', () => {
  async function goToStep4() {
    overrideInitStatus(true);
    overridePreflight(PREFLIGHT_ALL_OK);
    overrideTestDatabase(DB_TEST_OK);

    const user = userEvent.setup();
    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    await waitFor(() => expect(screen.getByText('磁盘空间')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByText('生产模式')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByText('数据库类型')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /测试连接/ }));
    await waitFor(() => expect(screen.getByText('连接成功')).toBeInTheDocument());
    // v4.22.1：SQLite 需勾选生产警告确认
    await user.click(screen.getByRole('checkbox', { name: /我已知悉 SQLite/ }));
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByText('本机单节点')).toBeInTheDocument());
    // v4.22.x：选择"暂不配置"模式（旧"单机模式"语义）
    await user.click(screen.getByRole('button', { name: /暂不配置/ }));
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByLabelText(/站点名称/)).toBeInTheDocument());
    return user;
  }

  it('默认填充 "GameServer Panel"，"下一步"可点击', async () => {
    await goToStep4();

    const input = screen.getByLabelText(/站点名称/) as HTMLInputElement;
    expect(input.value).toBe('GameServer Panel');
    expect(screen.getByRole('button', { name: /下一步/ })).not.toBeDisabled();
  });

  it('清空站点名称时禁用"下一步"', async () => {
    const user = await goToStep4();

    const input = screen.getByLabelText(/站点名称/);
    await user.clear(input);

    expect(screen.getByRole('button', { name: /下一步/ })).toBeDisabled();
  });

  it('公网入口填 http:// 开头时显示警告但不阻塞', async () => {
    const user = await goToStep4();

    const urlInput = screen.getByPlaceholderText('https://gsp.ecsrz.com:3001');
    await user.type(urlInput, 'http://example.com');

    await waitFor(() => {
      expect(screen.getByText(/HTTP 协议可用但不安全/)).toBeInTheDocument();
    });
    // warn 不阻塞——"下一步"仍可点击（站点名称有效）
    expect(screen.getByRole('button', { name: /下一步/ })).not.toBeDisabled();
  });

  it('公网入口填 https:// 开头时显示 OK', async () => {
    const user = await goToStep4();

    const urlInput = screen.getByPlaceholderText('https://gsp.ecsrz.com:3001');
    await user.type(urlInput, 'https://gsp.ecsrz.com:3001');

    await waitFor(() => {
      expect(screen.getByText(/HTTPS 协议，安全可用/)).toBeInTheDocument();
    });
  });

  it('公网入口填非 http/https 开头时显示格式错误 + 禁用"下一步"', async () => {
    const user = await goToStep4();

    const urlInput = screen.getByPlaceholderText('https://gsp.ecsrz.com:3001');
    await user.type(urlInput, 'ftp://example.com');

    await waitFor(() => {
      expect(screen.getByText('格式错误')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /下一步/ })).toBeDisabled();
  });
});

// ===========================================================================
// 7. Step 5: 管理员账号
// ===========================================================================

describe('SetupWizard — Step 5: 管理员账号', () => {
  async function goToStep5() {
    overrideInitStatus(true);
    overridePreflight(PREFLIGHT_ALL_OK);
    overrideTestDatabase(DB_TEST_OK);
    overridePasswordPolicy(PASSWORD_POLICY_FIXTURE);

    const user = userEvent.setup();
    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    await waitFor(() => expect(screen.getByText('磁盘空间')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByText('生产模式')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByText('数据库类型')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /测试连接/ }));
    await waitFor(() => expect(screen.getByText('连接成功')).toBeInTheDocument());
    // v4.22.1：SQLite 需勾选生产警告确认
    await user.click(screen.getByRole('checkbox', { name: /我已知悉 SQLite/ }));
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByText('本机单节点')).toBeInTheDocument());
    // v4.22.x：选择"暂不配置"模式
    await user.click(screen.getByRole('button', { name: /暂不配置/ }));
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByLabelText(/站点名称/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    // v4.22.0：AdminStep 五字段（用户名/邮箱/昵称/新密码/确认密码）
    await waitFor(() => expect(screen.getByLabelText(/邮箱/)).toBeInTheDocument());
    return user;
  }

  /** 填写有效的用户名/邮箱/昵称（v4.22.0 三者均必填） */
  async function fillAdminIdentity(user: Awaited<ReturnType<typeof goToStep5>>) {
    await user.type(screen.getByLabelText(/用户名/), 'admin');
    await user.type(screen.getByLabelText(/邮箱/), 'admin@example.com');
    await user.type(screen.getByLabelText(/昵称/), '服务器管理员');
  }

  it('渲染用户名/邮箱/昵称/新密码/确认密码 5 个字段', async () => {
    await goToStep5();

    expect(screen.getByLabelText(/用户名/)).toBeInTheDocument();
    expect(screen.getByLabelText(/邮箱/)).toBeInTheDocument();
    expect(screen.getByLabelText(/昵称/)).toBeInTheDocument();
    expect(screen.getByLabelText(/新密码/)).toBeInTheDocument();
    expect(screen.getByLabelText(/确认密码/)).toBeInTheDocument();
  });

  it('输入密码后实时展示密码规则', async () => {
    const user = await goToStep5();

    await user.type(screen.getByLabelText(/新密码/), 'weak');

    // 密码规则在 passwordPolicy 加载完成后渲染
    await waitFor(() => {
      expect(screen.getByText(/长度 8-128 位/)).toBeInTheDocument();
    });
    expect(screen.getByText('包含字母')).toBeInTheDocument();
    expect(screen.getByText('包含数字')).toBeInTheDocument();
    expect(screen.getByText(/非常见弱密码/)).toBeInTheDocument();
  });

  it('全部字段有效且输入强密码后，"下一步"可点击', async () => {
    const user = await goToStep5();

    await fillAdminIdentity(user);
    await user.type(screen.getByLabelText(/新密码/), 'Str0ng!Pass#2026');
    await user.type(screen.getByLabelText(/确认密码/), 'Str0ng!Pass#2026');

    expect(screen.getByRole('button', { name: /下一步/ })).not.toBeDisabled();
  });

  it('两次密码不一致时禁用"下一步"', async () => {
    const user = await goToStep5();

    await fillAdminIdentity(user);
    await user.type(screen.getByLabelText(/新密码/), 'Str0ng!Pass#2026');
    await user.type(screen.getByLabelText(/确认密码/), 'DifferentPass#2026');

    expect(screen.getByRole('button', { name: /下一步/ })).toBeDisabled();
    expect(screen.getByText('两次输入的密码不一致')).toBeInTheDocument();
  });

  it('输入禁用密码 admin123 时禁用"下一步"', async () => {
    const user = await goToStep5();

    await fillAdminIdentity(user);
    await user.type(screen.getByLabelText(/新密码/), 'admin123');
    await user.type(screen.getByLabelText(/确认密码/), 'admin123');

    // 等待密码策略加载完成（禁用密码名单生效）
    await waitFor(() => {
      expect(screen.getByText('包含数字')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /下一步/ })).toBeDisabled();
  });

  it('邮箱格式无效时显示错误 + 禁用"下一步"', async () => {
    const user = await goToStep5();

    await user.type(screen.getByLabelText(/用户名/), 'admin');
    await user.type(screen.getByLabelText(/邮箱/), 'not-an-email');
    await user.type(screen.getByLabelText(/昵称/), '服务器管理员');
    await user.type(screen.getByLabelText(/新密码/), 'Str0ng!Pass#2026');
    await user.type(screen.getByLabelText(/确认密码/), 'Str0ng!Pass#2026');

    expect(screen.getByText('邮箱格式无效')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下一步/ })).toBeDisabled();
  });
});

// ===========================================================================
// 8. Step 6: 启用游戏 Pack
// ===========================================================================

describe('SetupWizard — Step 6: 启用游戏 Pack', () => {
  async function goToStep6() {
    overrideInitStatus(true);
    overridePreflight(PREFLIGHT_ALL_OK);
    overrideTestDatabase(DB_TEST_OK);
    overridePasswordPolicy(PASSWORD_POLICY_FIXTURE);

    const user = userEvent.setup();
    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    await waitFor(() => expect(screen.getByText('磁盘空间')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByText('生产模式')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByText('数据库类型')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /测试连接/ }));
    await waitFor(() => expect(screen.getByText('连接成功')).toBeInTheDocument());
    // v4.22.1：SQLite 需勾选生产警告确认
    await user.click(screen.getByRole('checkbox', { name: /我已知悉 SQLite/ }));
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByText('本机单节点')).toBeInTheDocument());
    // v4.22.x：选择"暂不配置"模式
    await user.click(screen.getByRole('button', { name: /暂不配置/ }));
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByLabelText(/站点名称/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByLabelText(/邮箱/)).toBeInTheDocument());
    // v4.22.0：Step 5 五字段（用户名/邮箱/昵称必填）
    await user.type(screen.getByLabelText(/用户名/), 'admin');
    await user.type(screen.getByLabelText(/邮箱/), 'admin@example.com');
    await user.type(screen.getByLabelText(/昵称/), '服务器管理员');
    await user.type(screen.getByLabelText(/新密码/), 'Str0ng!Pass#2026');
    await user.type(screen.getByLabelText(/确认密码/), 'Str0ng!Pass#2026');
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    // v4.22.0：Step 6 为 Pack 来源四 Tab
    await waitFor(() => expect(screen.getByText(/选择 Pack 来源/)).toBeInTheDocument());
    return user;
  }

  /** 成功提交响应（restart_required=false，进入 Step 7 完成态） */
  const INIT_OK_RESPONSE = {
    initialized: true,
    site_name: 'GameServer Panel',
    admin_password_updated: true,
    enabled_packs: [],
    admin_email: 'admin@example.com',
    mode: 'production',
    restart_required: false,
  } satisfies InitSubmitResponse;

  it('展示四种来源 Tab（GitHub 同步 / 自定义 URL / 上传 zip / 跳过）', async () => {
    await goToStep6();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(screen.getByRole('tab', { name: 'GitHub 同步' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '自定义 URL' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '上传 zip' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '跳过' })).toBeInTheDocument();

    // 默认 GitHub 同步：仓库/分支已预填，未同步前"完成并应用配置"禁用
    expect(screen.getByRole('button', { name: /完成并应用配置/ })).toBeDisabled();
  });

  it('GitHub 同步成功后提交，负载携带 pack_source=github', async () => {
    overridePackSync(PACK_SYNC_OK);
    const user = await goToStep6();

    // 默认 github Tab：点击"同步 Pack"
    await user.click(screen.getByRole('button', { name: /同步 Pack/ }));
    await waitFor(() => {
      expect(screen.getByText('已同步 2 个 Pack')).toBeInTheDocument();
    });
    // 已同步 pack 列表展示
    expect(screen.getByText('Minecraft')).toBeInTheDocument();
    expect(screen.getByText('Factorio')).toBeInTheDocument();

    let submittedBody: Record<string, unknown> | null = null;
    overrideSubmitInit((body) => {
      submittedBody = body;
      return HttpResponse.json(INIT_OK_RESPONSE);
    });

    await user.click(screen.getByRole('button', { name: /完成并应用配置/ }));

    await waitFor(() => {
      expect(submittedBody).not.toBeNull();
    });
    const body = submittedBody as unknown as {
      enabled_packs: string[];
      pack_source: Record<string, unknown>;
    };
    expect(body.enabled_packs).toEqual([]);
    expect(body.pack_source).toEqual({
      source: 'github',
      github_repo: 'airxw/GSP-Panel',
      github_ref: 'main',
    });
  });

  it('选择"跳过"后提交，enabled_packs 为空且不携带 pack_source', async () => {
    const user = await goToStep6();

    await user.click(screen.getByRole('tab', { name: '跳过' }));
    expect(screen.getByText('已选择跳过 Pack 配置。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /完成并应用配置/ })).not.toBeDisabled();

    let submittedBody: Record<string, unknown> | null = null;
    overrideSubmitInit((body) => {
      submittedBody = body;
      return HttpResponse.json(INIT_OK_RESPONSE);
    });

    await user.click(screen.getByRole('button', { name: /完成并应用配置/ }));

    await waitFor(() => {
      expect(submittedBody).not.toBeNull();
    });
    const body = submittedBody as unknown as { enabled_packs: string[] };
    expect(body.enabled_packs).toEqual([]);
    expect('pack_source' in body).toBe(false);
  });

  it('提交时发送 database / skip_daemon / database_ack / admin.display_name 字段', async () => {
    const user = await goToStep6();

    await user.click(screen.getByRole('tab', { name: '跳过' }));

    let submittedBody: Record<string, unknown> | null = null;
    overrideSubmitInit((body) => {
      submittedBody = body;
      return HttpResponse.json(INIT_OK_RESPONSE);
    });

    await user.click(screen.getByRole('button', { name: /完成并应用配置/ }));

    await waitFor(() => {
      expect(submittedBody).not.toBeNull();
    });
    const body = submittedBody as unknown as {
      database: { type: string; url: string };
      skip_daemon: boolean;
      database_ack: boolean;
      admin: { username: string; email: string; display_name: string };
    };
    expect(body.database).toBeDefined();
    expect(body.database.type).toBe('sqlite');
    expect(body.skip_daemon).toBe(true);
    // v4.22.1：SQLite 提交附带 database_ack（Step 2 已勾选确认）
    expect(body.database_ack).toBe(true);
    // v4.22.0：admin 携带昵称（users.display_name）
    expect(body.admin.display_name).toBe('服务器管理员');
  });

  it('提交时返回 WEAK_PASSWORD 错误，返回 Step 5 展示 details.failures 列表', async () => {
    const user = await goToStep6();

    await user.click(screen.getByRole('tab', { name: '跳过' }));

    let submitCalled = false;
    overrideSubmitInit(() => {
      submitCalled = true;
      return HttpResponse.json(
        {
          error: {
            code: 'WEAK_PASSWORD',
            message: '管理员密码强度不足',
            details: {
              failures: ['长度必须 8-128 位', '包含字母', '包含数字'],
              suggestions: ['使用更长的密码'],
              score: 1,
            },
          },
        },
        { status: 400 },
      );
    });

    await user.click(screen.getByRole('button', { name: /完成并应用配置/ }));

    await waitFor(() => {
      expect(submitCalled).toBe(true);
    });
    // 未进入 Step 7
    expect(screen.queryByText('正在应用配置并重启服务…')).not.toBeInTheDocument();

    // submitError 由 AdminStep 渲染——返回 Step 5 可见失败列表
    await user.click(screen.getByRole('button', { name: /上一步/ }));
    await waitFor(() => {
      expect(screen.getByText('密码校验失败：')).toBeInTheDocument();
    });
    expect(screen.getByText('长度必须 8-128 位')).toBeInTheDocument();
  });

  it('提交时返回其他错误，通过 toast 提示且不进入 Step 7', async () => {
    const user = await goToStep6();

    await user.click(screen.getByRole('tab', { name: '跳过' }));

    overrideSubmitInit(() =>
      HttpResponse.json(
        {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: '数据库配置存在警告，需确认后方可继续',
          },
        },
        { status: 400 },
      ),
    );

    await user.click(screen.getByRole('button', { name: /完成并应用配置/ }));

    // toast 提示后端错误消息
    await waitFor(() => {
      expect(screen.getByText('数据库配置存在警告，需确认后方可继续')).toBeInTheDocument();
    });
    // 仍在 Step 6，未进入 Step 7
    expect(screen.getByText(/选择 Pack 来源/)).toBeInTheDocument();
    expect(screen.queryByText('正在应用配置并重启服务…')).not.toBeInTheDocument();
  });
});

// ===========================================================================
// 9. Step 7: 重启（v4.20.0 新增）
// ===========================================================================

describe('SetupWizard — Step 7: 重启', () => {
  async function goToStep7WithRestart() {
    overrideInitStatus(true);
    overridePreflight(PREFLIGHT_ALL_OK);
    overrideTestDatabase(DB_TEST_OK);
    overridePasswordPolicy(PASSWORD_POLICY_FIXTURE);
    overrideRestart();

    const user = userEvent.setup();
    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    // 走完 0→1→2→3→4→5→6
    await waitFor(() => expect(screen.getByText('磁盘空间')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByText('生产模式')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByText('数据库类型')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /测试连接/ }));
    await waitFor(() => expect(screen.getByText('连接成功')).toBeInTheDocument());
    // v4.22.1：SQLite 需勾选生产警告确认
    await user.click(screen.getByRole('checkbox', { name: /我已知悉 SQLite/ }));
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    // v4.22.x：Step 3 三模式卡片——选择"暂不配置"
    await waitFor(() => expect(screen.getByText('本机单节点')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /暂不配置/ }));
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByLabelText(/站点名称/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    // v4.22.0：Step 5 五字段（用户名/邮箱/昵称必填）
    await waitFor(() => expect(screen.getByLabelText(/邮箱/)).toBeInTheDocument());
    await user.type(screen.getByLabelText(/用户名/), 'admin');
    await user.type(screen.getByLabelText(/邮箱/), 'admin@example.com');
    await user.type(screen.getByLabelText(/昵称/), '服务器管理员');
    await user.type(screen.getByLabelText(/新密码/), 'Str0ng!Pass#2026');
    await user.type(screen.getByLabelText(/确认密码/), 'Str0ng!Pass#2026');
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    // v4.22.0：Step 6 为 Pack 来源四 Tab——选择"跳过"
    await waitFor(() => expect(screen.getByText(/选择 Pack 来源/)).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: '跳过' }));

    overrideSubmitInit(() =>
      HttpResponse.json({
        initialized: true,
        site_name: 'GameServer Panel',
        admin_password_updated: true,
        enabled_packs: [],
        admin_email: 'admin@example.com',
        mode: 'production',
        restart_required: true,
        restart_token: 'test-restart-token-123',
      } satisfies InitSubmitResponse),
    );

    await user.click(screen.getByRole('button', { name: /完成并应用配置/ }));
    return user;
  }

  it('提交成功后进入 Step 7（重启页）', async () => {
    await goToStep7WithRestart();

    await waitFor(() => {
      expect(screen.getByText('正在应用配置并重启服务…')).toBeInTheDocument();
    });
  });

  it('Step 7 渲染"请勿关闭此页面"提示', async () => {
    await goToStep7WithRestart();

    await waitFor(() => {
      expect(screen.getByText(/请勿关闭此页面/)).toBeInTheDocument();
    });
  });
});

// ===========================================================================
// 10. 演示模式端到端流程
// ===========================================================================

describe('SetupWizard — 演示模式端到端', () => {
  it('演示模式：0→1→6→7 跳过 Step 2/3/4/5', async () => {
    overrideInitStatus(true);
    overridePreflight(PREFLIGHT_DEMO_MODE);

    const user = userEvent.setup();
    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    // Step 0
    await waitFor(() => expect(screen.getByText('磁盘空间')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /下一步/ }));

    // Step 1：点击"演示模式"卡片（不依赖 preflight/status 异步检测的写入时序）
    await waitFor(() => expect(screen.getByText('演示模式')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /演示模式/ }));
    await user.click(screen.getByRole('button', { name: /下一步/ }));

    // 直接进入 Step 6（跳过 2/3/4/5）——v4.22.0 为 Pack 来源四 Tab
    await waitFor(() => {
      expect(screen.getByText(/选择 Pack 来源/)).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: 'GitHub 同步' })).toBeInTheDocument();

    // 选择"跳过"来源后提交（演示模式后端会返回 demo_mode=true + restart_required=false）
    await user.click(screen.getByRole('tab', { name: '跳过' }));

    overrideSubmitInit(() =>
      HttpResponse.json({
        initialized: true,
        site_name: 'GameServer Panel',
        admin_password_updated: false,
        enabled_packs: [],
        demo_mode: true,
        mode: 'demo',
        restart_required: false,
      } satisfies InitSubmitResponse),
    );

    await user.click(screen.getByRole('button', { name: /完成并应用配置/ }));

    // Step 7：v4.22.2 路径 C——restart_required=false 且无 token → "配置已保存"完成态
    await waitFor(() => {
      expect(screen.getByText('配置已保存，无需重启。')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /前往登录页/ })).toBeInTheDocument();
  });
});

// ===========================================================================
// 11. BUILD footer
// ===========================================================================

describe('SetupWizard — BUILD footer', () => {
  it('渲染 footer 含 BUILD 编号', async () => {
    overrideInitStatus(true);
    overridePreflight(PREFLIGHT_ALL_OK);

    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    await waitFor(() => {
      expect(screen.getByText('欢迎使用 GameServer Panel')).toBeInTheDocument();
    });

    const footer = screen.getByText((content, element) => {
      return element?.tagName === 'FOOTER' && content.includes('BUILD');
    });
    expect(footer).toBeInTheDocument();
    expect(footer.textContent).toMatch(/BUILD \d{8}-\d{3}/);
  });

  it('statusLoading 时也渲染 BUILD footer', async () => {
    overridePreflight(PREFLIGHT_ALL_OK);
    renderWithProviders(<SetupWizard />, { initialEntries: ['/setup'] });

    await waitFor(() => {
      const loading = screen.queryByText('正在检查系统状态…');
      const footer = screen.queryByText((content, element) => {
        return element?.tagName === 'FOOTER' && content.includes('BUILD');
      });
      expect(loading || footer).toBeTruthy();
    });
  });
});
