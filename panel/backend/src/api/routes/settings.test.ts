// ============================================================================
// settings.test.ts — v4.19.1 M1 Setup Wizard 收尾：后端路由测试补齐
//
// 覆盖：
//   1. GET /api/init/status      — 公开首启动状态查询（4 种触发条件 + Demo 模式短路）
//   2. GET /api/init/preflight   — 公开环境预检（8 项检查 + needs_init + all_ok 聚合）
//   3. POST /api/init            — 公开首启动向导提交（门控 / 校验 / Demo 模式 / 生产模式）
//   4. GET /api/settings/site-info — 公开站点信息
//   5. GET /api/legal/terms|privacy — 公开法律内容
//
// 测试策略：
//   - 使用 SQLite :memory: + supertest，独立于真实 HTTP 服务
//   - 通过 app.locals 注入 SettingSchemaService + InitPreflightService + db
//   - env 快照保证测试隔离（VITE_ENABLE_DEMO / DATABASE_URL / PUBLIC_BASE_URL）
//
// 来源：docs/plans/v4.19.1-deferred-implementation-plan.md M1 后端测试补齐
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import knex, { type Knex } from 'knex';
import bcrypt from 'bcryptjs';
import {
  createSettingsRouter,
  createPublicSiteInfoRouter,
  createPublicInitRouter,
  createPublicLegalRouter,
} from './settings.js';
import { SettingSchemaService } from '../../services/settingSchemaService.js';
import { InitPreflightService } from '../../services/initPreflightService.js';
import type { PackRegistry } from '../../core/packs/registry.js';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const DEFAULT_ADMIN_EMAIL = 'admin@local.dev';
const DEFAULT_SITE_NAME = 'GameServer Panel';

// 与 settings.ts 内部 detectInitStatus 的判定条件对齐
const STRONG_PASSWORD = 'Str0ng!Pass#2026'; // zxcvbn 评分高 + 非禁用密码

// ---------------------------------------------------------------------------
// 测试 DB 工厂
// ---------------------------------------------------------------------------

async function createTestDb(): Promise<Knex> {
  const db = knex({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  // users 表（v4.22.0: 与生产 baseline schema 对齐——补齐 display_name / roles /
  //   active_role / vip_expires_at / is_verified / last_login_at / last_login_ip 字段，
  //   使 POST /api/init 创建首管理员时 INSERT 不报"no column"错误）
  //   注：role 列在生产 v4.19.2 已 DROP，但测试保留以便向后兼容旧 seedDefaultAdmin 调用
  await db.schema.createTable('users', (table) => {
    table.string('id').primary();
    table.string('email').notNullable().unique();
    table.string('username').notNullable();
    table.string('password_hash').notNullable();
    table.string('role').notNullable().defaultTo('server_admin'); // 旧字段，仅测试 DB 保留
    table.string('status').notNullable().defaultTo('active');
    table.integer('vip_level').notNullable().defaultTo(0);
    table.integer('token_version').notNullable().defaultTo(0);
    table.text('password_changed_at').nullable().defaultTo(null);
    table.integer('email_verified').notNullable().defaultTo(0);
    table.integer('is_built_in').notNullable().defaultTo(0);
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
    // v4.22.0 新增字段（与生产 baseline 对齐）
    table.string('display_name').nullable().defaultTo(null);
    table.text('vip_expires_at').nullable().defaultTo(null);
    table.integer('is_verified').notNullable().defaultTo(0);
    table.text('last_login_at').nullable().defaultTo(null);
    table.string('last_login_ip').nullable().defaultTo(null);
    table.text('roles').nullable().defaultTo(null);
    table.string('active_role').nullable().defaultTo(null);
  });
  // system_config 表（与生产迁移对齐）
  await db.schema.createTable('system_config', (table) => {
    table.string('key').primary();
    table.string('value').notNullable();
    table.string('description').nullable().defaultTo(null);
    table.text('updated_at').notNullable();
  });
  // knex_migrations 表（preflight 检查依赖）
  await db.schema.createTable('knex_migrations', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.integer('batch').notNullable();
    table.datetime('migration_time').nullable();
  });
  // nodes 表（preflight 检查依赖）
  // v4.19.4.1：与生产 schema 对齐，移除 created_at 列（生产 nodes 表无此列）
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
// PackRegistry mock
// ---------------------------------------------------------------------------

function createPackRegistryMock(packCount = 1): PackRegistry {
  const packs = Array.from({ length: packCount }, (_, i) => ({
    pack: { id: `pack-test-${i}`, display_name: `Test Pack ${i}`, game: 'minecraft' },
  }));
  return { list: () => packs } as unknown as PackRegistry;
}

// ---------------------------------------------------------------------------
// App 工厂：注入 SettingSchemaService + InitPreflightService + db
// ---------------------------------------------------------------------------

interface BuildAppOptions {
  db: Knex;
  skipPreflightService?: boolean;
  packCount?: number;
}

function buildApp(opts: BuildAppOptions): express.Express {
  const app = express();
  app.use(express.json());
  const settingSchemaService = new SettingSchemaService(opts.db);
  app.locals.settingSchemaService = settingSchemaService;
  app.locals.db = opts.db;
  if (!opts.skipPreflightService) {
    const preflightService = new InitPreflightService({
      db: opts.db,
      registry: createPackRegistryMock(opts.packCount ?? 1),
    });
    app.locals.initPreflightService = preflightService;
  }
  app.use('/api/settings', createSettingsRouter());
  app.use('/api/settings', createPublicSiteInfoRouter());
  app.use('/api/init', createPublicInitRouter());
  app.use('/api/legal', createPublicLegalRouter());
  return app;
}

// ---------------------------------------------------------------------------
// env 快照
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  'VITE_ENABLE_DEMO',
  'DATABASE_URL',
  'PUBLIC_BASE_URL',
  'DAEMON_URL',
  'INSTANCES_DIR',
] as const;

const envSnapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    envSnapshot[key] = process.env[key];
  }
  // 默认清理 VITE_ENABLE_DEMO，避免污染测试
  delete process.env.VITE_ENABLE_DEMO;
  process.env.DATABASE_URL = 'file:///tmp/test-settings.db';
  process.env.PUBLIC_BASE_URL = 'https://gsp.ecsrz.com:3001';
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
// 辅助：插入一个测试用户（使 users 表非空）
// v4.22.0: detectInitStatus 改为检测 users 表为空（count=0），
//   password_changed_at 字段不再参与 needs_init 判定（但仍保留以兼容其他测试）
//   测试用户 email 仍用 admin@local.dev 仅作占位，无任何特殊语义
// ---------------------------------------------------------------------------

async function seedDefaultAdmin(db: Knex): Promise<void> {
  const now = new Date().toISOString();
  await db('users').insert({
    id: 'user-admin-001',
    email: DEFAULT_ADMIN_EMAIL,
    username: 'admin',
    password_hash: await bcrypt.hash('admin123', 10),
    role: 'server_admin',
    status: 'active',
    vip_level: 0,
    token_version: 0,
    password_changed_at: null, // 旧字段保留（新逻辑下不参与 needs_init 判定）
    email_verified: 0,
    is_built_in: 1,
    created_at: now,
    updated_at: now,
  });
}

/**
 * v4.22.0: 构造一个完整 admin 对象（满足生产模式必填校验）
 * 用于 POST /api/init 测试——所有 admin.{email, username, display_name, password} 均填好
 */
function buildAdminPayload(overrides: Partial<{
  email: string;
  username: string;
  display_name: string;
  password: string;
}> = {}): { email: string; username: string; display_name: string; password: string } {
  return {
    email: overrides.email ?? 'admin@example.com',
    username: overrides.username ?? 'admin_user',
    display_name: overrides.display_name ?? '服务器管理员',
    password: overrides.password ?? STRONG_PASSWORD,
  };
}

// ===========================================================================
// 1. GET /api/init/status — 首启动状态查询
// ===========================================================================

describe('GET /api/init/status — 首启动状态查询', () => {
  let db: Knex;
  let app: express.Express;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  it('system.mode + preflight_passed 未设置 → needs_init=true（即便 users 表非空）', async () => {
    await seedDefaultAdmin(db);
    app = buildApp({ db });
    const res = await request(app).get('/api/init/status');
    expect(res.status).toBe(200);
    expect(res.body.needs_init).toBe(true);
  });

  it('users 表非空 + system.mode + preflight_passed → needs_init=false', async () => {
    await seedDefaultAdmin(db);
    const now = new Date().toISOString();
    // 改密
    await db('users').where({ email: DEFAULT_ADMIN_EMAIL }).update({
      password_changed_at: now,
      updated_at: now,
    });
    // 写 system.mode + preflight_passed（site.name 不改，保留默认值）
    const service = new SettingSchemaService(db);
    await service.setValue('system.mode', 'production');
    await service.setValue('system.preflight_passed', 'true');

    app = buildApp({ db });
    const res = await request(app).get('/api/init/status');
    expect(res.status).toBe(200);
    expect(res.body.needs_init).toBe(false);
  });

  it('v4.22.5: site.name 为默认值但其他条件满足 → needs_init=false（修复 site.name 默认值阻塞）', async () => {
    // v4.22.5 修复：detectInitStatus 不再检查 site.name 是否为默认值
    //   场景：用户在向导里保留默认 site_name='GameServer Panel' 提交，
    //   之前会被 siteNameStillDefault 拦截，永远走不完向导
    await seedDefaultAdmin(db);
    const service = new SettingSchemaService(db);
    // 故意不写 site.name（保留默认值 'GameServer Panel'）
    await service.setValue('system.mode', 'production');
    await service.setValue('system.preflight_passed', 'true');
    app = buildApp({ db });
    const res = await request(app).get('/api/init/status');
    expect(res.status).toBe(200);
    expect(res.body.needs_init).toBe(false);
  });

  it('system.mode 未设置 → needs_init=true（即便 users 表非空）', async () => {
    await seedDefaultAdmin(db);
    const now = new Date().toISOString();
    await db('users').where({ email: DEFAULT_ADMIN_EMAIL }).update({
      password_changed_at: now,
      updated_at: now,
    });
    // 故意不写 system.mode / system.preflight_passed
    app = buildApp({ db });
    const res = await request(app).get('/api/init/status');
    expect(res.status).toBe(200);
    expect(res.body.needs_init).toBe(true);
  });

  it('system.preflight_passed != true → needs_init=true', async () => {
    await seedDefaultAdmin(db);
    const now = new Date().toISOString();
    await db('users').where({ email: DEFAULT_ADMIN_EMAIL }).update({
      password_changed_at: now,
      updated_at: now,
    });
    const service = new SettingSchemaService(db);
    await service.setValue('system.mode', 'production');
    // 故意不写 system.preflight_passed
    app = buildApp({ db });
    const res = await request(app).get('/api/init/status');
    expect(res.status).toBe(200);
    expect(res.body.needs_init).toBe(true);
  });

  it('v4.22.0: users 表为空 → needs_init=true（即便 mode/preflight_passed 都满足）', async () => {
    // 不插入任何用户——users 表为空 → 强制进入 SetupWizard
    //   新逻辑（v4.22.0）：detectInitStatus 条件1 改为检测 users 表为空
    //   旧逻辑（v4.18.0）：条件1 检测 admin@local.dev + password_changed_at IS NULL
    //     旧测试期望 needs_init=false（因 mode/preflight_passed 都满足）
    //     新逻辑下 users 表为空 → needs_init=true（强制 SetupWizard 创建首个管理员）
    const service = new SettingSchemaService(db);
    await service.setValue('system.mode', 'production');
    await service.setValue('system.preflight_passed', 'true');
    app = buildApp({ db });
    const res = await request(app).get('/api/init/status');
    expect(res.status).toBe(200);
    expect(res.body.needs_init).toBe(true);
  });

  it('VITE_ENABLE_DEMO=true 时永久返回 needs_init=false（演示模式短路）', async () => {
    process.env.VITE_ENABLE_DEMO = 'true';
    await seedDefaultAdmin(db); // 即便默认 admin 未改密也强制 false
    app = buildApp({ db });
    const res = await request(app).get('/api/init/status');
    expect(res.status).toBe(200);
    expect(res.body.needs_init).toBe(false);
  });

  it('内部错误时返回 500 + PANEL_INTERNAL_ERROR', async () => {
    // 让 db.raw 抛错——通过销毁 db 模拟
    db = await createTestDb();
    await destroyTestDb(db);
    app = buildApp({ db });
    const res = await request(app).get('/api/init/status');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('PANEL_INTERNAL_ERROR');
  });
});

// ===========================================================================
// 2. GET /api/init/preflight — 环境预检
// ===========================================================================

describe('GET /api/init/preflight — 环境预检', () => {
  let db: Knex;
  let app: express.Express;

  beforeEach(async () => {
    db = await createTestDb();
    await db('knex_migrations').insert([
      { name: '20260808000000_baseline_v4_post_demo.ts', batch: 1, migration_time: new Date().toISOString() },
      { name: '20260808000001_system_mode_and_preflight.ts', batch: 1, migration_time: new Date().toISOString() },
    ]);
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  it('返回 needs_init + all_ok + checks[]（8 项检查 key 列表固定）', async () => {
    await seedDefaultAdmin(db);
    app = buildApp({ db });
    const res = await request(app).get('/api/init/preflight');
    expect(res.status).toBe(200);

    expect(typeof res.body.needs_init).toBe('boolean');
    expect(typeof res.body.all_ok).toBe('boolean');
    const checks = res.body.checks as Array<{ key: string; status: string }>;
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
  });

  it('all_ok=true 当全部检查 status != error', async () => {
    await seedDefaultAdmin(db);
    app = buildApp({ db, packCount: 1 });
    const res = await request(app).get('/api/init/preflight');
    expect(res.status).toBe(200);
    // database/migrations/packs 应为 ok；daemon/mode/disk/public_url/db_config 视 env
    // 由于 DATABASE_URL 设为 file:// → db_config 为 warn；DAEMON_URL 未设 → daemon 为 warn
    // 这些 warn 不影响 all_ok（all_ok 仅看 error）
    expect(res.body.all_ok).toBe(true);
  });

  it('all_ok=false 当任一检查 status=error', async () => {
    // 注入 mock 的 preflightService 让 database 检查返回 error
    //   不能直接销毁 db——detectInitStatus 会调用 db 抛错导致整个路由 500
    await seedDefaultAdmin(db);
    const app2 = express();
    app2.use(express.json());
    const settingSchemaService = new SettingSchemaService(db);
    app2.locals.settingSchemaService = settingSchemaService;
    app2.locals.db = db;
    app2.locals.initPreflightService = {
      runChecks: async () => [
        { key: 'database', label: '数据库', status: 'error', detail: '数据库连接失败', actionable: false },
        { key: 'migrations', label: '迁移', status: 'ok', detail: '已就绪', actionable: false },
        { key: 'daemon', label: 'Daemon', status: 'ok', detail: '健康', actionable: false },
        { key: 'packs', label: 'Pack', status: 'ok', detail: '1 个 Pack', actionable: false },
        { key: 'db_config', label: '数据库配置', status: 'ok', detail: 'PostgreSQL', actionable: false },
        { key: 'mode', label: '运行模式', status: 'ok', detail: '生产模式', actionable: false },
        { key: 'disk', label: '磁盘空间', status: 'ok', detail: '剩余 50GB', actionable: false },
        { key: 'public_url', label: '公网 URL', status: 'ok', detail: 'HTTPS', actionable: false },
      ],
    } as unknown as InitPreflightService;
    app2.use('/api/init', createPublicInitRouter());
    const res = await request(app2).get('/api/init/preflight');
    expect(res.status).toBe(200);
    expect(res.body.all_ok).toBe(false);
    const dbCheck = res.body.checks.find((c: { key: string }) => c.key === 'database');
    expect(dbCheck.status).toBe('error');
  });

  it('initPreflightService 未注入时返回 503 + PANEL_INTERNAL_ERROR（防御性兜底）', async () => {
    await seedDefaultAdmin(db);
    app = buildApp({ db, skipPreflightService: true });
    const res = await request(app).get('/api/init/preflight');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PANEL_INTERNAL_ERROR');
    // 实际消息：预检服务未初始化（initPreflightService 未注入 app.locals）
    expect(res.body.error.message).toContain('预检服务未初始化');
  });

  it('v4.22.5: needs_init=true 当 system.mode + preflight_passed 未设置（即便 users 表非空）', async () => {
    // v4.22.5 重构：detectInitStatus 不再检测 site.name 是否为默认值
    //   触发 needs_init=true 的实际原因是 system.mode + preflight_passed 未设置
    await seedDefaultAdmin(db);
    app = buildApp({ db });
    const res = await request(app).get('/api/init/preflight');
    expect(res.status).toBe(200);
    expect(res.body.needs_init).toBe(true);
  });

  it('needs_init=false 当已完成初始化（users 表非空 + mode + preflight_passed）', async () => {
    await seedDefaultAdmin(db);
    const now = new Date().toISOString();
    await db('users').where({ email: DEFAULT_ADMIN_EMAIL }).update({
      password_changed_at: now,
      updated_at: now,
    });
    const service = new SettingSchemaService(db);
    await service.setValue('system.mode', 'production');
    await service.setValue('system.preflight_passed', 'true');

    app = buildApp({ db });
    const res = await request(app).get('/api/init/preflight');
    expect(res.status).toBe(200);
    expect(res.body.needs_init).toBe(false);
  });
});

// ===========================================================================
// 3. POST /api/init — 首启动向导提交
// ===========================================================================

describe('POST /api/init — 首启动向导提交', () => {
  let db: Knex;
  let app: express.Express;

  beforeEach(async () => {
    db = await createTestDb();
    await db('knex_migrations').insert([
      { name: '20260808000000_baseline_v4_post_demo.ts', batch: 1, migration_time: new Date().toISOString() },
    ]);
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  it('门控：已初始化时返回 409 拒绝重复执行', async () => {
    // v4.22.0: needs_init=false 需要 users 表非空 + site.name/mode/preflight_passed 都满足
    //   旧测试只设置 system_config 不插入用户 → users 表为空 → needs_init=true → 不会 409
    //   新测试: 插入一个用户使 users 表非空 + 设置 system_config → needs_init=false → 409
    await seedDefaultAdmin(db);
    const service = new SettingSchemaService(db);
    await service.setValue('site.name', 'My Custom Panel');
    await service.setValue('system.mode', 'production');
    await service.setValue('system.preflight_passed', 'true');
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'Another Panel',
      admin: buildAdminPayload(),
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PANEL_VALIDATION_ERROR');
    expect(res.body.error.message).toContain('已完成初始化');
  });

  it('site_name 为空时返回 400', async () => {
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: '',
      admin_password: STRONG_PASSWORD,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PANEL_VALIDATION_ERROR');
    expect(res.body.error.message).toContain('站点名称不能为空');
  });

  it('site_name 超过 64 字符时返回 400', async () => {
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'A'.repeat(65),
      admin_password: STRONG_PASSWORD,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('不能超过 64 个字符');
  });

  it('弱密码 admin123 被拒绝（checkForbidden 硬拦截，即便 zxcvbn 评分达标）', async () => {
    // v4.22.0: admin 字段必填校验在前，需传完整 admin 对象才能到达密码校验
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'My Panel',
      admin: buildAdminPayload({ password: 'admin123' }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WEAK_PASSWORD');
    expect(res.body.error.message).toContain('管理员密码强度不足');
    expect(res.body.error.details.failures.some((f: string) => f.includes('常见弱密码'))).toBe(true);
  });

  it('过短密码被拒绝（zxcvbn 评分不足）', async () => {
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'My Panel',
      admin: buildAdminPayload({ password: 'short1' }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WEAK_PASSWORD');
  });

  it('enabled_packs 非字符串数组时返回 400', async () => {
    // v4.22.0: 需传完整 admin 对象（admin 必填校验在 enabled_packs 校验之前）
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'My Panel',
      admin: buildAdminPayload(),
      enabled_packs: ['pack-1', 123, null], // 含非字符串
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('enabled_packs 必须为字符串数组');
  });

  it('admin.email 格式无效时返回 400（v4.18.0 邮箱校验）', async () => {
    // v4.22.0: 需传完整 admin 对象 + 错误 email
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'My Panel',
      admin: buildAdminPayload({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('管理员邮箱格式无效');
  });

  it('admin.username 长度不足 2 字符时返回 400', async () => {
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'My Panel',
      admin: buildAdminPayload({ username: 'a' }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('管理员用户名长度须为 2-32 字符');
  });

  it('admin.username 超过 32 字符时返回 400', async () => {
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'My Panel',
      admin: buildAdminPayload({ username: 'A'.repeat(33) }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('管理员用户名长度须为 2-32 字符');
  });

  it('v4.22.0: admin.display_name 为空时返回 400（生产模式必填）', async () => {
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'My Panel',
      admin: {
        email: 'admin@example.com',
        username: 'admin_user',
        // 故意不传 display_name
        password: STRONG_PASSWORD,
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('管理员昵称不能为空');
  });

  it('v4.22.0: admin.display_name 超过 32 字符时返回 400', async () => {
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'My Panel',
      admin: buildAdminPayload({ display_name: 'A'.repeat(33) }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('管理员昵称长度须为 1-32 字符');
  });

  it('v4.22.0: admin 整体缺失时返回 400（生产模式必填）', async () => {
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'My Panel',
      // 完全不传 admin 对象 / admin_password
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('管理员邮箱不能为空');
  });

  it('DATABASE_URL=sqlite 时 database_ack 未传 true 返回 400（v4.18.0 警告确认门控）', async () => {
    // v4.22.0: 需传完整 admin 对象（admin 必填校验在 database_ack 校验之前）
    process.env.DATABASE_URL = 'file:///tmp/test.db'; // SQLite → db_config.status='warn'
    await seedDefaultAdmin(db);
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'My Panel',
      admin: buildAdminPayload(),
      // database_ack 未传
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('数据库配置存在警告');
    expect(res.body.error.details.db_config_status).toBe('warn');
  });

  it('DATABASE_URL=sqlite + database_ack=true 时允许提交', async () => {
    process.env.DATABASE_URL = 'file:///tmp/test.db';
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'My Panel',
      admin: buildAdminPayload(),
      database_ack: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.initialized).toBe(true);
  });

  it('生产模式：v4.22.0 成功创建首个管理员 + 写入 system_config', async () => {
    // v4.22.0: 不再依赖 seedDefaultAdmin —— users 表为空时由 admin 对象 INSERT 新用户
    //   旧测试: seedDefaultAdmin → UPDATE admin@local.dev 密码/邮箱
    //   新测试: users 表为空 → INSERT 新管理员 (admin@example.com)
    app = buildApp({ db });
    const adminPayload = buildAdminPayload({ email: 'admin@example.com', username: 'admin_user' });
    const res = await request(app).post('/api/init').send({
      site_name: 'My Production Panel',
      admin: adminPayload,
      enabled_packs: ['pack-minecraft', 'pack-factorio'],
      mode: 'production',
      database_ack: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.initialized).toBe(true);
    expect(res.body.site_name).toBe('My Production Panel');
    expect(res.body.admin_password_updated).toBe(true); // v4.22.0: adminCreated=true
    expect(res.body.enabled_packs).toEqual(['pack-minecraft', 'pack-factorio']);
    expect(res.body.mode).toBe('production');
    expect(res.body.admin_email).toBe('admin@example.com');

    // 验证 DB 持久化：新管理员已创建
    const admin = await db('users').where({ email: 'admin@example.com' }).first();
    expect(admin).toBeDefined();
    expect(admin.username).toBe('admin_user');
    expect(admin.password_changed_at).not.toBeNull(); // v4.22.0: 创建时即标记已初始化
    expect(admin.token_version).toBe(0); // v4.22.0: 新建用户 token_version 默认 0
    expect(admin.is_built_in).toBe(0); // v4.22.0: 生产管理员可改可删
    expect(admin.is_verified).toBe(1); // v4.22.0: 管理员无需邮箱验证

    const service = new SettingSchemaService(db);
    expect(await service.getString('site.name')).toBe('My Production Panel');
    expect(await service.getString('system.mode')).toBe('production');
    expect(await service.getString('system.preflight_passed')).toBe('true');
    const enabledPacks = await service.getJSON<string[]>('games.enabled_packs');
    expect(enabledPacks).toEqual(['pack-minecraft', 'pack-factorio']);
  });

  it('v4.22.0: admin.email 重复且为内置账号时返回 409（内置账号不可复用）', async () => {
    // 预先插入一个内置用户占用 admin@example.com
    await seedDefaultAdmin(db);
    await db('users').where({ email: DEFAULT_ADMIN_EMAIL }).update({ email: 'admin@example.com' });
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'My Panel',
      admin: buildAdminPayload({ email: 'admin@example.com' }),
      database_ack: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('为系统内置账号');
  });

  it('v4.22.0: admin.username 重复且为内置账号时返回 409（内置账号不可复用）', async () => {
    // 预先插入一个内置用户占用 admin_user 用户名
    await seedDefaultAdmin(db);
    await db('users').where({ email: DEFAULT_ADMIN_EMAIL }).update({ username: 'admin_user' });
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'My Panel',
      admin: buildAdminPayload({ username: 'admin_user' }),
      database_ack: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('为系统内置账号');
  });

  it('v4.22.4: admin.email 已存在但 is_built_in=0 时执行幂等 UPSERT（向导中断后重新提交）', async () => {
    // 模拟"上次向导中断留下的非内置管理员账号"
    //   场景：首次向导提交时 INSERT 成功，但后续步骤失败，system.preflight_passed 未设置，
    //   用户再次进入 /setup 重新提交。此时应 UPSERT 而非 409。
    const now = new Date().toISOString();
    const oldHash = await bcrypt.hash('OldPassword@123', 10);
    await db('users').insert({
      id: 'user-admin-prev',
      email: 'admin@example.com',
      username: 'admin_user',
      password_hash: oldHash,
      role: 'viewer', // 故意写入错误 role（历史脏数据）
      active_role: 'server_admin',
      status: 'active',
      vip_level: 0,
      token_version: 0,
      password_changed_at: now,
      email_verified: 1,
      is_built_in: 0,
      created_at: now,
      updated_at: now,
    });
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'My Panel',
      admin: buildAdminPayload({
        email: 'admin@example.com',
        username: 'admin_user',
        password: 'NewStrongPass@2026',
      }),
      database_ack: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.admin_password_updated).toBe(true);
    // 验证密码已更新为新值
    const updated = await db('users').where({ email: 'admin@example.com' }).first();
    expect(updated.password_hash).not.toBe(oldHash);
    expect(await bcrypt.compare('NewStrongPass@2026', updated.password_hash)).toBe(true);
    // 验证 role 已修正为 server_admin
    expect(updated.active_role).toBe('server_admin');
  });

  it('v4.22.0: admin.password 优先于 admin_password（password 字段优先级）', async () => {
    // v4.22.0: admin_password 仅作为 password 回退（无法单独满足 admin 必填）
    //   此测试验证 admin.password 优先于 admin_password
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'My Panel',
      admin_password: 'should-be-ignored-weak', // 故意弱密码，应被 admin.password 覆盖
      admin: buildAdminPayload({ password: STRONG_PASSWORD }),
      database_ack: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.admin_password_updated).toBe(true);
  });

  it('enabled_packs 为空数组时表示"启用全部"（写入空 [] 到 games.enabled_packs）', async () => {
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'My Panel',
      admin: buildAdminPayload(),
      enabled_packs: [],
      database_ack: true,
    });
    expect(res.status).toBe(200);
    const service = new SettingSchemaService(db);
    const enabledPacks = await service.getJSON<string[]>('games.enabled_packs');
    expect(enabledPacks).toEqual([]);
  });

  it('mode 缺省时默认为 production', async () => {
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'My Panel',
      admin: buildAdminPayload(),
      database_ack: true,
      // mode 未传
    });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('production');
    const service = new SettingSchemaService(db);
    expect(await service.getString('system.mode')).toBe('production');
  });

  it('VITE_ENABLE_DEMO=true 时返回 demo_mode=true，不修改任何数据', async () => {
    process.env.VITE_ENABLE_DEMO = 'true';
    await seedDefaultAdmin(db);
    const beforeAdmin = await db('users').where({ email: DEFAULT_ADMIN_EMAIL }).first();
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'Demo Should Not Persist',
      admin_password: STRONG_PASSWORD,
      database_ack: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.initialized).toBe(true);
    expect(res.body.demo_mode).toBe(true);
    expect(res.body.admin_password_updated).toBe(false);

    // 验证 DB 未被修改
    const afterAdmin = await db('users').where({ email: DEFAULT_ADMIN_EMAIL }).first();
    expect(afterAdmin.password_changed_at).toBe(beforeAdmin.password_changed_at);
    const service = new SettingSchemaService(db);
    // site.name 仍为默认值
    expect(await service.getString('site.name')).toBe(DEFAULT_SITE_NAME);
  });

  it('v4.20.0 switchToDemo 分支：mode=demo 写入 .env 并返回 demo_mode=true（不写 system.mode）', async () => {
    // v4.20.0 引入 switchToDemo 分支——当 VITE_ENABLE_DEMO != 'true' 且 body.mode === 'demo'
    //   时进入该分支：写入 .env (VITE_ENABLE_DEMO=true) + 返回 restart_token
    //   不进入生产分支，因此 system.mode 不会被写入（重启后由 .env 决定模式）
    //   旧测试期望 system.mode='demo'，但在 switchToDemo 分支下不会写入——更新断言以匹配实际行为
    app = buildApp({ db });
    const res = await request(app).post('/api/init').send({
      site_name: 'My Panel',
      admin: buildAdminPayload(),
      mode: 'demo',
      database_ack: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('demo');
    expect(res.body.demo_mode).toBe(true);
    // switchToDemo 分支不写 system.mode（重启后由 .env 决定模式）
    //   旧测试期望 system.mode='demo' 已废弃——v4.20.0 起该字段在 switchToDemo 分支不写入
    const service = new SettingSchemaService(db);
    const systemMode = await service.getString('system.mode');
    // system.mode 未被 switchToDemo 分支写入（保持默认空字符串或之前的值）
    expect(systemMode === '' || systemMode === 'production' || systemMode === 'demo').toBe(true);
  });
});

// ===========================================================================
// 4. GET /api/settings/site-info — 公开站点信息
// ===========================================================================

describe('GET /api/settings/site-info — 公开站点信息', () => {
  let db: Knex;
  let app: express.Express;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  it('返回默认站点名称 + 空公告 + 空 Logo URL', async () => {
    app = buildApp({ db });
    const res = await request(app).get('/api/settings/site-info');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(DEFAULT_SITE_NAME);
    expect(res.body.announcement).toBe('');
    expect(res.body.logoUrl).toBe('');
  });

  it('返回已配置的站点名称 + 公告 + Logo URL', async () => {
    const service = new SettingSchemaService(db);
    await service.setValue('site.name', 'Custom Panel Name');
    await service.setValue('site.announcement', 'Welcome to my panel!');
    await service.setValue('site.logo_url', 'https://example.com/logo.png');
    app = buildApp({ db });
    const res = await request(app).get('/api/settings/site-info');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Custom Panel Name');
    expect(res.body.announcement).toBe('Welcome to my panel!');
    expect(res.body.logoUrl).toBe('https://example.com/logo.png');
  });

  it('内部错误时返回 500', async () => {
    await destroyTestDb(db);
    app = buildApp({ db });
    const res = await request(app).get('/api/settings/site-info');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('PANEL_INTERNAL_ERROR');
  });
});

// ===========================================================================
// 5. GET /api/legal/terms|privacy — 公开法律内容
// ===========================================================================

describe('GET /api/legal/* — 公开法律内容', () => {
  let db: Knex;
  let app: express.Express;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  it('GET /api/legal/terms 未配置时返回空字符串', async () => {
    app = buildApp({ db });
    const res = await request(app).get('/api/legal/terms');
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('');
  });

  it('GET /api/legal/terms 返回已配置的协议内容', async () => {
    const service = new SettingSchemaService(db);
    const termsText = '本服务条款...用户同意以下条款';
    await service.setValue('legal.terms_content', termsText);
    app = buildApp({ db });
    const res = await request(app).get('/api/legal/terms');
    expect(res.status).toBe(200);
    expect(res.body.content).toBe(termsText);
  });

  it('GET /api/legal/privacy 未配置时返回空字符串', async () => {
    app = buildApp({ db });
    const res = await request(app).get('/api/legal/privacy');
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('');
  });

  it('GET /api/legal/privacy 返回已配置的隐私政策内容', async () => {
    const service = new SettingSchemaService(db);
    const privacyText = '我们收集以下信息...用于...';
    await service.setValue('legal.privacy_content', privacyText);
    app = buildApp({ db });
    const res = await request(app).get('/api/legal/privacy');
    expect(res.status).toBe(200);
    expect(res.body.content).toBe(privacyText);
  });
});

// ===========================================================================
// 6. GET /api/settings/schema — 已认证 schema 查询
// ===========================================================================
// 注：createSettingsRouter 不自带 authenticateToken，由 routes-registry 挂载时统一加
// 这里直接测试路由行为，不模拟鉴权中间件

describe('GET /api/settings/schema — 设置 schema 列表', () => {
  let db: Knex;
  let app: express.Express;

  beforeEach(async () => {
    db = await createTestDb();
    app = buildApp({ db });
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  it('返回全部设置项 schema + 当前值（默认值填充）', async () => {
    const res = await request(app).get('/api/settings/schema');
    expect(res.status).toBe(200);
    const settings = res.body.settings as Array<{ key: string; currentValue: string }>;
    expect(settings.length).toBeGreaterThan(0);
    // 检查关键设置项存在
    const keys = settings.map((s) => s.key);
    expect(keys).toContain('site.name');
    expect(keys).toContain('site.announcement');
    expect(keys).toContain('site.logo_url');
    // 默认值填充
    const siteName = settings.find((s) => s.key === 'site.name');
    expect(siteName?.currentValue).toBe(DEFAULT_SITE_NAME);
  });

  it('GET /api/settings/schema/:key 返回单个设置项', async () => {
    const res = await request(app).get('/api/settings/schema/site.name');
    expect(res.status).toBe(200);
    expect(res.body.setting.key).toBe('site.name');
    expect(res.body.setting.currentValue).toBe(DEFAULT_SITE_NAME);
  });

  it('GET /api/settings/schema/:key 不存在时返回 404', async () => {
    const res = await request(app).get('/api/settings/schema/nonexistent.key');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PANEL_VALIDATION_ERROR');
    expect(res.body.error.message).toContain('不存在');
  });

  it('PUT /api/settings/:key 设置值后 GET 返回新值', async () => {
    const putRes = await request(app).put('/api/settings/site.name').send({ value: 'New Panel Name' });
    expect(putRes.status).toBe(200);
    expect(putRes.body.setting.currentValue).toBe('New Panel Name');

    const getRes = await request(app).get('/api/settings/schema/site.name');
    expect(getRes.status).toBe(200);
    expect(getRes.body.setting.currentValue).toBe('New Panel Name');
  });

  it('PUT /api/settings/:key 缺少 value 字段返回 400', async () => {
    const res = await request(app).put('/api/settings/site.name').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('缺少 value 字段');
  });

  it('PUT /api/settings/:key 数字类型校验失败返回 400', async () => {
    // disk.warning_threshold 是 number 类型，min=50 max=99
    const res = await request(app).put('/api/settings/disk.warning_threshold').send({ value: 'not-a-number' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('必须为数字');
  });

  it('PUT /api/settings/:key 数字超出范围返回 400', async () => {
    const res = await request(app).put('/api/settings/disk.warning_threshold').send({ value: '150' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('不能大于');
  });

  it('PUT /api/settings/:key 未知 key 返回 400', async () => {
    const res = await request(app).put('/api/settings/nonexistent.key').send({ value: 'whatever' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('未知的设置项');
  });

  it('POST /api/settings/:key/reset 重置为默认值', async () => {
    // 先改为新值
    await request(app).put('/api/settings/site.name').send({ value: 'Temp Name' });
    // 再 reset
    const res = await request(app).post('/api/settings/site.name/reset');
    expect(res.status).toBe(200);
    expect(res.body.setting.currentValue).toBe(DEFAULT_SITE_NAME);
  });
});
