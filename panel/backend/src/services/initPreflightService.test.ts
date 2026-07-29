// ============================================================================
// initPreflightService.test.ts — v4.18.0 首启动环境预检服务单元测试
// 覆盖 8 项 preflight 检查：database / migrations / daemon / packs / db_config
//                        / mode / disk / public_url
// 每项检查覆盖 success / warn / error 三种状态
//
// 来源：v4.19.1 M1 Setup Wizard 收尾——后端测试补齐
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { InitPreflightService } from './initPreflightService.js';
import type { PackRegistry } from '../core/packs/registry.js';

// ---------------------------------------------------------------------------
// 测试用 DB 工厂：仅建 knex_migrations + nodes 表（preflight 检查依赖）
// ---------------------------------------------------------------------------

async function createTestDb(): Promise<Knex> {
  const db = knex({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await db.schema.createTable('knex_migrations', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.integer('batch').notNullable();
    table.datetime('migration_time').nullable();
  });
  // v4.19.4.1：与生产 schema 对齐，移除 created_at 列
  //   生产 nodes 表定义见 20260808000000_baseline_v4_post_demo.ts:77-91，无 created_at
  //   原测试 schema 加了 created_at 导致 preflight bug 被测试掩盖（假阳性）
  await db.schema.createTable('nodes', (table) => {
    table.string('id').primary();
    table.string('name').notNullable();
    table.string('status').notNullable();
  });
  return db;
}

async function destroyTestDb(db: Knex): Promise<void> {
  await db.destroy();
}

// ---------------------------------------------------------------------------
// PackRegistry mock 工厂
// ---------------------------------------------------------------------------

function createPackRegistryMock(packCount: number): PackRegistry {
  const packs = Array.from({ length: packCount }, (_, i) => ({
    pack: { id: `pack-test-${i}`, display_name: `Test Pack ${i}`, game: 'minecraft' },
  }));
  return {
    list: () => packs,
  } as unknown as PackRegistry;
}

// ---------------------------------------------------------------------------
// DaemonClientLike mock 工厂
// ---------------------------------------------------------------------------

function createDaemonClientMock(mode: 'ok' | 'fail'): { getHealth: (id: string) => Promise<unknown> } {
  return {
    getHealth: async () => {
      if (mode === 'fail') {
        throw new Error('daemon unreachable');
      }
      return { status: 'ok' };
    },
  };
}

// ---------------------------------------------------------------------------
// env 快照与还原
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  'DAEMON_URL',
  'DATABASE_URL',
  'VITE_ENABLE_DEMO',
  'INSTANCES_DIR',
  'PUBLIC_BASE_URL',
  'PACKS_DIR',
] as const;

const envSnapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    envSnapshot[key] = process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (envSnapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = envSnapshot[key];
    }
  }
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. checkDatabase
// ---------------------------------------------------------------------------

describe('InitPreflightService - checkDatabase', () => {
  it('DB 连通时返回 ok', async () => {
    const db = await createTestDb();
    const service = new InitPreflightService({
      db,
      registry: createPackRegistryMock(1),
    });
    const checks = await service.runChecks();
    const dbCheck = checks.find((c) => c.key === 'database')!;
    expect(dbCheck.status).toBe('ok');
    expect(dbCheck.detail).toContain('数据库响应正常');
    await destroyTestDb(db);
  });

  it('DB 连接失败时返回 error', async () => {
    const db = await createTestDb();
    await destroyTestDb(db); // 销毁后再用，触发 raw('SELECT 1') 失败
    const service = new InitPreflightService({
      db,
      registry: createPackRegistryMock(1),
    });
    const checks = await service.runChecks();
    const dbCheck = checks.find((c) => c.key === 'database')!;
    expect(dbCheck.status).toBe('error');
    expect(dbCheck.detail).toContain('数据库连接失败');
  });
});

// ---------------------------------------------------------------------------
// 2. checkMigrations
// ---------------------------------------------------------------------------

describe('InitPreflightService - checkMigrations', () => {
  it('knex_migrations 表存在且有记录时返回 ok + 最新 migration 名', async () => {
    const db = await createTestDb();
    await db('knex_migrations').insert([
      { name: '20260808000000_baseline_v4_post_demo.ts', batch: 1, migration_time: new Date().toISOString() },
      { name: '20260808000001_system_mode_and_preflight.ts', batch: 1, migration_time: new Date().toISOString() },
    ]);
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(1) });
    const checks = await service.runChecks();
    const migCheck = checks.find((c) => c.key === 'migrations')!;
    expect(migCheck.status).toBe('ok');
    expect(migCheck.detail).toContain('20260808000001_system_mode_and_preflight.ts');
    await destroyTestDb(db);
  });

  it('knex_migrations 表不存在时返回 error', async () => {
    const db = knex({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    // 不创建 knex_migrations 表
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(1) });
    const checks = await service.runChecks();
    const migCheck = checks.find((c) => c.key === 'migrations')!;
    expect(migCheck.status).toBe('error');
    expect(migCheck.detail).toContain('knex_migrations 表不存在');
    await destroyTestDb(db);
  });
});

// ---------------------------------------------------------------------------
// 3. checkDaemon
// ---------------------------------------------------------------------------

describe('InitPreflightService - checkDaemon', () => {
  it('DAEMON_URL 未配置时返回 warn（单机模式可忽略）', async () => {
    delete process.env.DAEMON_URL;
    const db = await createTestDb();
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(1) });
    const checks = await service.runChecks();
    const dCheck = checks.find((c) => c.key === 'daemon')!;
    expect(dCheck.status).toBe('warn');
    expect(dCheck.detail).toContain('DAEMON_URL 未配置');
    await destroyTestDb(db);
  });

  it('DAEMON_URL 配置 + daemonClientService 健康 + 有节点 → ok', async () => {
    process.env.DAEMON_URL = 'http://127.0.0.1:8080';
    const db = await createTestDb();
    await db('nodes').insert({ id: 'node-1', name: '默认节点', status: 'online' });
    const service = new InitPreflightService({
      db,
      registry: createPackRegistryMock(1),
      daemonClientService: createDaemonClientMock('ok'),
    });
    const checks = await service.runChecks();
    const dCheck = checks.find((c) => c.key === 'daemon')!;
    expect(dCheck.status).toBe('ok');
    expect(dCheck.detail).toContain('节点 默认节点');
    await destroyTestDb(db);
  });

  it('DAEMON_URL 配置 + nodes 表为空 → warn', async () => {
    process.env.DAEMON_URL = 'http://127.0.0.1:8080';
    const db = await createTestDb();
    const service = new InitPreflightService({
      db,
      registry: createPackRegistryMock(1),
      daemonClientService: createDaemonClientMock('ok'),
    });
    const checks = await service.runChecks();
    const dCheck = checks.find((c) => c.key === 'daemon')!;
    expect(dCheck.status).toBe('warn');
    expect(dCheck.detail).toContain('nodes 表为空');
    await destroyTestDb(db);
  });

  it('DAEMON_URL 配置 + daemon 健康检查失败 → error', async () => {
    process.env.DAEMON_URL = 'http://127.0.0.1:8080';
    const db = await createTestDb();
    await db('nodes').insert({ id: 'node-1', name: '默认节点', status: 'online' });
    const service = new InitPreflightService({
      db,
      registry: createPackRegistryMock(1),
      daemonClientService: createDaemonClientMock('fail'),
    });
    const checks = await service.runChecks();
    const dCheck = checks.find((c) => c.key === 'daemon')!;
    expect(dCheck.status).toBe('error');
    expect(dCheck.detail).toContain('节点健康检查失败');
    await destroyTestDb(db);
  });

  it('DAEMON_URL 配置但未注入 daemonClientService → warn', async () => {
    process.env.DAEMON_URL = 'http://127.0.0.1:8080';
    const db = await createTestDb();
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(1) });
    const checks = await service.runChecks();
    const dCheck = checks.find((c) => c.key === 'daemon')!;
    expect(dCheck.status).toBe('warn');
    expect(dCheck.detail).toContain('daemonClientService 未注入');
    await destroyTestDb(db);
  });
});

// ---------------------------------------------------------------------------
// 4. checkPacks
// ---------------------------------------------------------------------------

describe('InitPreflightService - checkPacks', () => {
  it('已加载 Pack 时返回 ok + 数量', async () => {
    const db = await createTestDb();
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(3) });
    const checks = await service.runChecks();
    const pCheck = checks.find((c) => c.key === 'packs')!;
    expect(pCheck.status).toBe('ok');
    expect(pCheck.detail).toContain('已加载 3 个 Pack');
    await destroyTestDb(db);
  });

  it('未加载任何 Pack 时返回 warn', async () => {
    const db = await createTestDb();
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(0) });
    const checks = await service.runChecks();
    const pCheck = checks.find((c) => c.key === 'packs')!;
    expect(pCheck.status).toBe('warn');
    expect(pCheck.detail).toContain('未加载任何 Pack');
    await destroyTestDb(db);
  });

  it('registry.list() 抛异常时返回 error', async () => {
    const db = await createTestDb();
    const badRegistry = { list: () => { throw new Error('packs dir missing'); } } as unknown as PackRegistry;
    const service = new InitPreflightService({ db, registry: badRegistry });
    const checks = await service.runChecks();
    const pCheck = checks.find((c) => c.key === 'packs')!;
    expect(pCheck.status).toBe('error');
    expect(pCheck.detail).toContain('查询 Pack 列表失败');
    await destroyTestDb(db);
  });
});

// ---------------------------------------------------------------------------
// 5. checkDatabaseConfig
// ---------------------------------------------------------------------------

describe('InitPreflightService - checkDatabaseConfig', () => {
  it('DATABASE_URL 未配置时返回 error', async () => {
    delete process.env.DATABASE_URL;
    const db = await createTestDb();
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(1) });
    const checks = await service.runChecks();
    const cCheck = checks.find((c) => c.key === 'db_config')!;
    expect(cCheck.status).toBe('error');
    expect(cCheck.detail).toContain('DATABASE_URL 未配置');
    await destroyTestDb(db);
  });

  it('SQLite 路径返回 warn（v4.20.0 措辞调整：提示可在向导内切换）', async () => {
    process.env.DATABASE_URL = 'file:///opt/gameserver-panel/panel/backend/data/panel.db';
    const db = await createTestDb();
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(1) });
    const checks = await service.runChecks();
    const cCheck = checks.find((c) => c.key === 'db_config')!;
    expect(cCheck.status).toBe('warn');
    expect(cCheck.detail).toContain('SQLite');
    // v4.20.0：措辞从「建议 PostgreSQL」改为「可在向导内切换」，且 actionable=true
    expect(cCheck.detail).toContain('可在向导');
    expect(cCheck.actionable).toBe(true);
    await destroyTestDb(db);
  });

  it('PostgreSQL URL 返回 ok', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@db.example.com:5432/gameserver';
    const db = await createTestDb();
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(1) });
    const checks = await service.runChecks();
    const cCheck = checks.find((c) => c.key === 'db_config')!;
    expect(cCheck.status).toBe('ok');
    expect(cCheck.detail).toContain('PostgreSQL');
    expect(cCheck.detail).toContain('db.example.com:5432');
    await destroyTestDb(db);
  });

  it('MySQL URL 返回 ok', async () => {
    process.env.DATABASE_URL = 'mysql://user:pass@db.example.com:3306/gameserver';
    const db = await createTestDb();
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(1) });
    const checks = await service.runChecks();
    const cCheck = checks.find((c) => c.key === 'db_config')!;
    expect(cCheck.status).toBe('ok');
    expect(cCheck.detail).toContain('MySQL');
    await destroyTestDb(db);
  });

  it('无法识别的 URL 格式返回 warn', async () => {
    process.env.DATABASE_URL = 'redis://localhost:6379';
    const db = await createTestDb();
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(1) });
    const checks = await service.runChecks();
    const cCheck = checks.find((c) => c.key === 'db_config')!;
    expect(cCheck.status).toBe('warn');
    expect(cCheck.detail).toContain('未识别的 DATABASE_URL');
    await destroyTestDb(db);
  });
});

// ---------------------------------------------------------------------------
// 6. checkMode
// ---------------------------------------------------------------------------

describe('InitPreflightService - checkMode', () => {
  it('VITE_ENABLE_DEMO=true 时返回 ok + 演示模式', async () => {
    process.env.VITE_ENABLE_DEMO = 'true';
    const db = await createTestDb();
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(1) });
    const checks = await service.runChecks();
    const mCheck = checks.find((c) => c.key === 'mode')!;
    expect(mCheck.status).toBe('ok');
    expect(mCheck.detail).toContain('演示模式');
    await destroyTestDb(db);
  });

  it('VITE_ENABLE_DEMO 未设置时返回 ok + 生产模式', async () => {
    delete process.env.VITE_ENABLE_DEMO;
    const db = await createTestDb();
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(1) });
    const checks = await service.runChecks();
    const mCheck = checks.find((c) => c.key === 'mode')!;
    expect(mCheck.status).toBe('ok');
    expect(mCheck.detail).toContain('生产模式');
    await destroyTestDb(db);
  });
});

// ---------------------------------------------------------------------------
// 7. checkDiskSpace
// ---------------------------------------------------------------------------

describe('InitPreflightService - checkDiskSpace', () => {
  it('INSTANCES_DIR 存在且剩余空间充足时返回 ok', async () => {
    // 使用 os.tmpdir() 作为已知存在的目录
    const os = await import('node:os');
    process.env.INSTANCES_DIR = os.tmpdir();
    const db = await createTestDb();
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(1) });
    const checks = await service.runChecks();
    const dCheck = checks.find((c) => c.key === 'disk')!;
    // tmpdir 通常有充足空间，应为 ok；若极小磁盘可能为 warn，这里只验证不报 error
    expect(['ok', 'warn']).toContain(dCheck.status);
    expect(dCheck.detail).toContain('剩余');
    await destroyTestDb(db);
  });

  it('INSTANCES_DIR 不存在时使用父目录统计，仍返回 ok 或 warn', async () => {
    process.env.INSTANCES_DIR = '/nonexistent/path/that/does/not/exist/instances';
    const db = await createTestDb();
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(1) });
    const checks = await service.runChecks();
    const dCheck = checks.find((c) => c.key === 'disk')!;
    // 父目录 /nonexistent/path/that/does/not/exist 也不存在 → statfs 抛错 → warn
    // 或父目录 /  存在 → 返回 ok 或 warn
    expect(['ok', 'warn']).toContain(dCheck.status);
    await destroyTestDb(db);
  });

  it('statfs 抛异常时返回 warn', async () => {
    process.env.INSTANCES_DIR = '/nonexistent/path/that/does/not/exist/instances';
    const db = await createTestDb();
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(1) });
    // mock fs.promises.statfs 抛错
    const fs = await import('node:fs');
    const origStatfs = fs.promises.statfs;
    vi.spyOn(fs.promises, 'statfs').mockRejectedValue(new Error('statfs failed'));
    const checks = await service.runChecks();
    const dCheck = checks.find((c) => c.key === 'disk')!;
    expect(dCheck.status).toBe('warn');
    expect(dCheck.detail).toContain('磁盘空间查询失败');
    // 还原
    vi.mocked(fs.promises.statfs).mockRestore();
    fs.promises.statfs = origStatfs;
    await destroyTestDb(db);
  });
});

// ---------------------------------------------------------------------------
// 8. checkPublicBaseURL
// ---------------------------------------------------------------------------

describe('InitPreflightService - checkPublicBaseURL', () => {
  it('PUBLIC_BASE_URL 未配置时返回 warn（v4.20.0 措辞调整：提示可在向导内填写）', async () => {
    delete process.env.PUBLIC_BASE_URL;
    const db = await createTestDb();
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(1) });
    const checks = await service.runChecks();
    const uCheck = checks.find((c) => c.key === 'public_url')!;
    expect(uCheck.status).toBe('warn');
    expect(uCheck.detail).toContain('PUBLIC_BASE_URL 未配置');
    // v4.20.0：措辞增加「可在向导内填写」提示，且 actionable=true
    expect(uCheck.detail).toContain('可在向导');
    expect(uCheck.actionable).toBe(true);
    await destroyTestDb(db);
  });

  it('HTTPS URL 返回 ok', async () => {
    process.env.PUBLIC_BASE_URL = 'https://gsp.ecsrz.com:3001';
    const db = await createTestDb();
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(1) });
    const checks = await service.runChecks();
    const uCheck = checks.find((c) => c.key === 'public_url')!;
    expect(uCheck.status).toBe('ok');
    expect(uCheck.detail).toContain('https://gsp.ecsrz.com:3001');
    await destroyTestDb(db);
  });

  it('非 HTTPS URL 返回 warn', async () => {
    process.env.PUBLIC_BASE_URL = 'http://gsp.ecsrz.com:3000';
    const db = await createTestDb();
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(1) });
    const checks = await service.runChecks();
    const uCheck = checks.find((c) => c.key === 'public_url')!;
    expect(uCheck.status).toBe('warn');
    expect(uCheck.detail).toContain('非 HTTPS');
    await destroyTestDb(db);
  });

  it('URL 格式无效时返回 warn', async () => {
    process.env.PUBLIC_BASE_URL = 'not-a-valid-url';
    const db = await createTestDb();
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(1) });
    const checks = await service.runChecks();
    const uCheck = checks.find((c) => c.key === 'public_url')!;
    expect(uCheck.status).toBe('warn');
    expect(uCheck.detail).toContain('PUBLIC_BASE_URL 格式无效');
    await destroyTestDb(db);
  });
});

// ---------------------------------------------------------------------------
// runChecks 综合行为
// ---------------------------------------------------------------------------

describe('InitPreflightService - runChecks 综合行为', () => {
  it('返回 8 项检查结果，key 列表固定', async () => {
    const db = await createTestDb();
    process.env.DATABASE_URL = 'file:///tmp/test.db';
    process.env.PUBLIC_BASE_URL = 'https://example.com';
    const service = new InitPreflightService({ db, registry: createPackRegistryMock(1) });
    const checks = await service.runChecks();
    expect(checks).toHaveLength(8);
    const keys = checks.map((c) => c.key);
    expect(keys).toEqual([
      'database',
      'migrations',
      'daemon',
      'packs',
      'db_config',
      'mode',
      'disk',
      'public_url',
    ]);
    // 每项含必需字段
    for (const c of checks) {
      expect(typeof c.key).toBe('string');
      expect(typeof c.label).toBe('string');
      expect(['ok', 'warn', 'error']).toContain(c.status);
      expect(typeof c.detail).toBe('string');
      expect(typeof c.actionable).toBe('boolean');
    }
    await destroyTestDb(db);
  });

  it('Promise.allSettled 保证单检查失败不影响其他项', async () => {
    // 故意让 daemonClientService 抛错——daemon 项返回 error，但其他项仍正常返回
    const db = await createTestDb();
    process.env.DAEMON_URL = 'http://127.0.0.1:8080';
    await db('nodes').insert({ id: 'n1', name: 'n1', status: 'online' });
    const service = new InitPreflightService({
      db,
      registry: createPackRegistryMock(1),
      daemonClientService: createDaemonClientMock('fail'),
    });
    const checks = await service.runChecks();
    expect(checks).toHaveLength(8);
    const daemonCheck = checks.find((c) => c.key === 'daemon')!;
    expect(daemonCheck.status).toBe('error');
    // database / packs / mode 等仍正常返回
    const dbCheck = checks.find((c) => c.key === 'database')!;
    expect(dbCheck.status).toBe('ok');
    await destroyTestDb(db);
  });
});
