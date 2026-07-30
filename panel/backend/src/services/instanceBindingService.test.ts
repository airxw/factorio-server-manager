// ============================================================================
// instanceBindingService.test.ts — bindInstance VIP 语义单测
// 覆盖：
//   - bindInstance 创建的账户级绑定 vip_level === 0（v4.38.0 spec 决策 1：账户绑定无 VIP）
//   - bindInstance 复活已 revoked 记录后 vip_level === 0
//   - bindInstance 已 verified 记录 → BindingAlreadyExistsError
//   - bindInstance 实例不存在 → BindingNotFoundError
//
// 说明：instanceBindingService 走 getDatabase() 单例，以 vi.mock 隔离 connection 模块，
//       使 getDatabase() 返回测试内存 DB。
//
// Schema 注意：createTestDb 中 bindings 表 id 为 string primary key（无自增），
//   与生产（integer PRIMARY KEY AUTOINCREMENT）不一致。bindInstance 的 INSERT 未显式
//   提供 id，依赖自增。本测试在 beforeEach 中 drop + 重建 bindings 表为生产 schema，
//   并补建 partial UNIQUE INDEX（idx_bindings_verified_unique），使并发重复 INSERT
//   检测路径与生产行为一致。修改仅限本测试文件，不触碰 db-helper.ts。
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Knex } from 'knex';

// vi.hoisted 保证 holder 在 vi.mock 工厂执行前已就绪（工厂闭包捕获绑定而非值）
const dbHolder = vi.hoisted(() => ({ db: null as Knex | null }));

vi.mock('../db/connection.js', () => ({
  getDatabase: () => {
    if (!dbHolder.db) {
      throw new Error('test db not initialized');
    }
    return dbHolder.db;
  },
}));

import { createTestDb, destroyTestDb } from '../test/db-helper.js';
import { bindInstance, verifyBindingByCode, setInstanceBindingServiceDeps } from './instanceBindingService.js';
import { eventBus, PLAYER_BINDING_VERIFIED } from './eventBus.js';
import { BindingAlreadyExistsError, BindingNotFoundError } from './errors.js';

const USER = 'user-1';
const SERVER = 'srv-1';

describe('bindInstance VIP 语义（v4.38.0 spec 决策 1：账户绑定无 VIP）', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await createTestDb();
    await rebuildBindingsTableForProduction(db);
    await seedServer(db, SERVER);
    dbHolder.db = db;
  });

  afterEach(async () => {
    dbHolder.db = null;
    await destroyTestDb(db);
  });

  it('无记录 → INSERT 创建账户级绑定，vip_level === 0（v4.38.0 spec 决策 1：账户绑定无 VIP）', async () => {
    await bindInstance(USER, SERVER);

    const row = await db('bindings')
      .where({
        user_id: USER,
        binding_type: 'account',
        scope_type: 'instance',
        scope_ref: SERVER,
      })
      .first();

    expect(row).toBeDefined();
    expect(row.verify_status).toBe('verified');
    // v4.38.0 spec 决策 1：账户级绑定不赋予 VIP，vip_level=0
    expect(row.vip_level).toBe(0);
    // metadata.source 标记来源为 bindInstance
    const meta = JSON.parse(row.metadata);
    expect(meta.source).toBe('bindInstance');
  });

  it('已有 revoked 记录 → 复活为 verified，vip_level === 0', async () => {
    // 预置一条 revoked 记录，且旧 vip_level=0（模拟被解绑的记录）
    const now = new Date().toISOString();
    await db('bindings').insert({
      user_id: USER,
      binding_type: 'account',
      scope_type: 'instance',
      scope_ref: SERVER,
      player_name: null,
      vip_level: 0, // 旧记录被解绑时 vip_level=0
      wallet_id: null,
      verify_status: 'revoked',
      verify_code: null,
      verify_expires_at: null,
      verified_at: now,
      metadata: JSON.stringify({ source: 'legacy', unbound_at: now, vip_expires_at: null }),
      created_at: now,
      updated_at: now,
    });

    await bindInstance(USER, SERVER);

    const row = await db('bindings')
      .where({
        user_id: USER,
        binding_type: 'account',
        scope_type: 'instance',
        scope_ref: SERVER,
      })
      .first();

    expect(row).toBeDefined();
    expect(row.verify_status).toBe('verified');
    expect(row.vip_level).toBe(0); // 复活后仍无 VIP（v4.38.0 spec 决策 1：账户绑定无 VIP）
    const meta = JSON.parse(row.metadata);
    expect(meta.source).toBe('bindInstance_rebind');
    expect(meta.unbound_at).toBeNull();
  });

  it('已有 verified 记录 → 抛 BindingAlreadyExistsError，不重复写入', async () => {
    await bindInstance(USER, SERVER); // 首次绑定成功

    await expect(bindInstance(USER, SERVER)).rejects.toBeInstanceOf(
      BindingAlreadyExistsError,
    );

    const rows = await db('bindings').where({
      user_id: USER,
      binding_type: 'account',
      scope_type: 'instance',
      scope_ref: SERVER,
    });
    expect(rows).toHaveLength(1); // 未产生重复记录
  });

  it('实例不存在 → 抛 BindingNotFoundError', async () => {
    await expect(bindInstance(USER, 'srv-not-exist')).rejects.toBeInstanceOf(
      BindingNotFoundError,
    );
  });
});

// ============================================================================
// Task 3: verifyBindingByCode RCON 广播单测
// 覆盖：
//   - verify 成功 → emit player.binding_verified + getVipWelcomeMessage + sendCommand 调用链
//   - existingAccountBinding 已 verified → 不广播（重复 verify）
//   - getVipWelcomeMessage 返回空 → 不调用 sendCommand
//   - sendCommand 失败 → 不抛错
// ============================================================================

describe('verifyBindingByCode RCON 广播（Task 3）', () => {
  let db: Knex;
  let emitSpy: ReturnType<typeof vi.spyOn>;
  let getVipWelcomeMessageMock: ReturnType<typeof vi.fn>;
  let sendCommandMock: ReturnType<typeof vi.fn>;

  const PLAYER = 'Steve';
  const CODE = 'ABC234';
  const NODE_ID = 'node-1';

  beforeEach(async () => {
    db = await createTestDb();
    await rebuildBindingsTableForProduction(db);
    await seedServer(db, SERVER);
    dbHolder.db = db;

    // mock eventBus.emit（避免污染其他订阅者 / 测试输出）
    emitSpy = vi.spyOn(eventBus, 'emit').mockImplementation(() => undefined);

    // mock playerService.getVipWelcomeMessage + daemonClient.sendCommand
    getVipWelcomeMessageMock = vi.fn();
    sendCommandMock = vi.fn();
    setInstanceBindingServiceDeps({
      playerService: { getVipWelcomeMessage: getVipWelcomeMessageMock },
      daemonClientService: { sendCommand: sendCommandMock },
    });
  });

  afterEach(async () => {
    emitSpy.mockRestore();
    setInstanceBindingServiceDeps(null);
    dbHolder.db = null;
    await destroyTestDb(db);
  });

  /** 预置一条 pending 玩家验证码记录（verifyBindingByCode 的输入） */
  async function seedPendingVerifyCode(
    overrides: Partial<{
      user_id: string;
      server_id: string;
      player_name: string;
      verify_code: string;
    }> = {},
  ): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
    await db('bindings').insert({
      user_id: overrides.user_id ?? USER,
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: overrides.server_id ?? SERVER,
      player_name: overrides.player_name ?? PLAYER,
      vip_level: 0,
      wallet_id: null,
      verify_status: 'pending',
      verify_code: overrides.verify_code ?? CODE,
      verify_expires_at: expiresAt,
      verified_at: null,
      metadata: JSON.stringify({ source: 'generateVerifyCode' }),
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
  }

  it('首次绑定 → emit 事件 + getVipWelcomeMessage + sendCommand 完整调用链', async () => {
    // 默认 getVipWelcomeMessage 返回模板
    getVipWelcomeMessageMock.mockResolvedValue('欢迎 {player_name}（VIP{vip_level}）加入服务器！');
    sendCommandMock.mockResolvedValue({ success: true });

    await seedPendingVerifyCode();
    const result = await verifyBindingByCode(PLAYER, CODE, SERVER);

    expect(result.success).toBe(true);
    // 1. emit player.binding_verified 事件
    expect(emitSpy).toHaveBeenCalledWith(PLAYER_BINDING_VERIFIED, expect.objectContaining({
      type: 'player.binding_verified',
      server_id: SERVER,
      user_id: USER,
      player_name: PLAYER,
      vip_level: 1,
    }));
    // 2. getVipWelcomeMessage 被调用（serverId, vipLevel=1）
    expect(getVipWelcomeMessageMock).toHaveBeenCalledWith(SERVER, 1);
    // 3. sendCommand 被调用，含模板替换后的 say 命令 + 4 参数签名
    expect(sendCommandMock).toHaveBeenCalledTimes(1);
    const [nodeId, serverId, command, requestId] = sendCommandMock.mock.calls[0];
    expect(nodeId).toBe(NODE_ID);
    expect(serverId).toBe(SERVER);
    expect(command).toBe('say 欢迎 Steve（VIP1）加入服务器！');
    expect(requestId).toMatch(new RegExp(`^${SERVER}-verify-\\d+-[a-z0-9]+$`));
  });

  it('existingAccountBinding 已 verified → 不广播（重复 verify）', async () => {
    getVipWelcomeMessageMock.mockResolvedValue('欢迎 {player_name}');
    sendCommandMock.mockResolvedValue({ success: true });

    // 预置：已 verified 的账户级绑定（模拟重复 verify 场景）
    const now = new Date().toISOString();
    await db('bindings').insert({
      user_id: USER,
      binding_type: 'account',
      scope_type: 'instance',
      scope_ref: SERVER,
      player_name: null,
      vip_level: 1,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: now,
      metadata: JSON.stringify({ source: 'legacy' }),
      created_at: now,
      updated_at: now,
    });
    await seedPendingVerifyCode();

    await verifyBindingByCode(PLAYER, CODE, SERVER);

    // 不广播：emit 可能仍被调用（审计事件），但 sendCommand 不应被调用
    // 注：player.binding_verified 事件在 shouldBroadcast=true 时才 emit；
    //     已 verified 场景 shouldBroadcast=false，emit 不应被调用
    const bindingVerifiedCalls = emitSpy.mock.calls.filter(
      ([evt]) => evt === PLAYER_BINDING_VERIFIED,
    );
    expect(bindingVerifiedCalls).toHaveLength(0);
    expect(getVipWelcomeMessageMock).not.toHaveBeenCalled();
    expect(sendCommandMock).not.toHaveBeenCalled();
  });

  it('getVipWelcomeMessage 返回空 → 不调用 sendCommand', async () => {
    getVipWelcomeMessageMock.mockResolvedValue(null); // vip_welcome_messages 未配置

    await seedPendingVerifyCode();
    await verifyBindingByCode(PLAYER, CODE, SERVER);

    // emit 事件仍触发（审计），但 sendCommand 不调用
    expect(emitSpy).toHaveBeenCalledWith(PLAYER_BINDING_VERIFIED, expect.any(Object));
    expect(getVipWelcomeMessageMock).toHaveBeenCalledWith(SERVER, 1);
    expect(sendCommandMock).not.toHaveBeenCalled();
  });

  it('sendCommand 失败 → 不抛错（verify 仍成功）', async () => {
    getVipWelcomeMessageMock.mockResolvedValue('欢迎 {player_name}');
    sendCommandMock.mockRejectedValue(new Error('RCON connection refused'));

    await seedPendingVerifyCode();
    // 不应抛错
    const result = await verifyBindingByCode(PLAYER, CODE, SERVER);

    expect(result.success).toBe(true);
    expect(result.message).toBe('绑定验证成功');
    expect(sendCommandMock).toHaveBeenCalledTimes(1);
  });

  it('复活已 revoked 绑定 → 广播（与首次绑定一致）', async () => {
    getVipWelcomeMessageMock.mockResolvedValue('欢迎回来 {player_name}');
    sendCommandMock.mockResolvedValue({ success: true });

    // 预置 revoked 账户级绑定（复活场景）
    const now = new Date().toISOString();
    await db('bindings').insert({
      user_id: USER,
      binding_type: 'account',
      scope_type: 'instance',
      scope_ref: SERVER,
      player_name: null,
      vip_level: 0,
      wallet_id: null,
      verify_status: 'revoked',
      verify_code: null,
      verify_expires_at: null,
      verified_at: now,
      metadata: JSON.stringify({ source: 'legacy', unbound_at: now }),
      created_at: now,
      updated_at: now,
    });
    await seedPendingVerifyCode();

    await verifyBindingByCode(PLAYER, CODE, SERVER);

    // 复活场景 shouldBroadcast=true → 广播
    expect(emitSpy).toHaveBeenCalledWith(PLAYER_BINDING_VERIFIED, expect.objectContaining({
      player_name: PLAYER,
      vip_level: 1,
    }));
    expect(getVipWelcomeMessageMock).toHaveBeenCalledWith(SERVER, 1);
    expect(sendCommandMock).toHaveBeenCalledTimes(1);
  });
});

// ----- 辅助函数 -----

/**
 * 重建 bindings 表为生产 schema（id integer AUTOINCREMENT + partial UNIQUE INDEX）。
 * createTestDb 创建的 bindings 表 id 为 string PK 无自增，bindInstance INSERT 未显式
 * 提供 id，需自增主键。同时补建生产 partial UNIQUE INDEX 以还原并发重复检测路径。
 */
async function rebuildBindingsTableForProduction(db: Knex): Promise<void> {
  await db.schema.dropTableIfExists('bindings');
  await db.schema.createTable('bindings', (table) => {
    table.increments('id').primary();
    table.string('user_id').notNullable();
    table.string('binding_type').notNullable();
    table.string('scope_type').notNullable();
    table.string('scope_ref').nullable();
    table.string('player_name').nullable();
    table.integer('vip_level').notNullable().defaultTo(0);
    table.integer('wallet_id').nullable();
    table.string('verify_status').notNullable().defaultTo('pending');
    table.string('verify_code').nullable();
    table.text('verify_expires_at').nullable();
    table.text('verified_at').nullable();
    table.text('metadata').notNullable().defaultTo('{}');
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });
  // 与生产 baseline 20260808000000 一致的 partial UNIQUE INDEX
  await db.raw(
    "CREATE UNIQUE INDEX IF NOT EXISTS `idx_bindings_verified_unique` ON `bindings`(`user_id`, `binding_type`, `scope_type`, COALESCE(`scope_ref`, ''), COALESCE(`player_name`, '')) WHERE `verify_status`='verified'",
  );
}

/** 预置 servers 表行（bindInstance 校验实例存在） */
async function seedServer(db: Knex, serverId: string): Promise<void> {
  const now = new Date().toISOString();
  await db('servers').insert({
    id: serverId,
    name: `server-${serverId}`,
    pack_id: 'pack-1',
    game_type: 'minecraft',
    node_id: 'node-1',
    owner_user_id: 'owner-1',
    status: 'stopped',
    port: 25565,
    rcon_port: 25575,
    rcon_password_enc: null,
    resource_limits_json: null,
    current_version: null,
    version_id: null,
    last_activity_at: null,
    marked_for_deletion: 0,
    disk_usage_bytes: null,
    disk_usage_updated_at: null,
    created_at: now,
    updated_at: now,
  });
}
