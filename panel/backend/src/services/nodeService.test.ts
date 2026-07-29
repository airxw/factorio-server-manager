import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Knex } from 'knex';
import pino from 'pino';
import {
  NodeService,
  NodeHeartbeatPayload,
  NodeNotFoundError,
  NodeLinkKeyInvalidError,
  NodeLinkKeyExpiredError,
  NodeNotOwnedError,
} from './nodeService.js';
import { Role } from '../core/auth/roles.js';
import { createTestDb, destroyTestDb } from '../test/db-helper.js';

/** 测试用：server_admin 创建者（platform_managed 节点归属 NULL） */
const SERVER_ADMIN_USER_ID = 'test-server-admin-id';
/** 测试用：instance_admin 创建者（self_hosted 节点归属该用户） */
const INSTANCE_ADMIN_USER_ID = 'test-instance-admin-id';

describe('NodeService - Heartbeat', () => {
  let db: Knex;
  let nodeService: NodeService;
  // 静默 logger
  const logger = pino({ level: 'silent' });

  beforeEach(async () => {
    db = await createTestDb();
    nodeService = new NodeService(db, logger);
  });

  afterEach(async () => {
    await destroyTestDb(db);
    vi.restoreAllMocks();
  });

  it('成功更新存在的 slave 节点状态为 online 并刷新 last_seen_at', async () => {
    // 准备测试数据
    const nodeId = 'node-test-1';
    await db('nodes').insert({
      id: nodeId,
      name: 'Test Slave Node',
      fqdn: 'test.node.local',
      daemon_token_hash: 'dummy-hash',
      node_type: 'slave',
      status: 'offline',
      last_seen_at: null,
    });

    const payload: NodeHeartbeatPayload = {
      cpu_percent: 15.5,
      memory_percent: 25.0,
      disk_percent: 20.0,
      daemon_version: '4.10.1',
    };

    // 记录心跳前时间
    const beforeTime = new Date().toISOString();

    // 执行心跳
    await nodeService.heartbeat(nodeId, payload);

    // 验证数据库状态更新
    const node = await db('nodes').where({ id: nodeId }).first();
    expect(node).toBeDefined();
    expect(node.status).toBe('online');
    expect(node.last_seen_at).not.toBeNull();
    
    // 确保 last_seen_at 在 beforeTime 之后
    expect(new Date(node.last_seen_at).getTime()).toBeGreaterThanOrEqual(new Date(beforeTime).getTime());
  });

  it('当节点不存在时抛出 NodeNotFoundError', async () => {
    const payload: NodeHeartbeatPayload = {
      cpu_percent: 10,
      memory_percent: 25.0,
      disk_percent: 20.0,
      daemon_version: '4.10.1',
    };

    // 确保抛出特定错误
    await expect(nodeService.heartbeat('non-existent-node', payload))
      .rejects.toThrow(NodeNotFoundError);
    
    await expect(nodeService.heartbeat('non-existent-node', payload))
      .rejects.toThrow('slave 节点不存在: non-existent-node');
  });

  it('当节点为 master 时抛出 NodeNotFoundError (master不应发心跳)', async () => {
    const masterNodeId = 'node-master-1';
    await db('nodes').insert({
      id: masterNodeId,
      name: 'Master Node',
      fqdn: 'master.node.local',
      daemon_token_hash: 'dummy-hash',
      node_type: 'master', // master 类型
      status: 'offline',
      last_seen_at: null,
    });

    const payload: NodeHeartbeatPayload = {
      cpu_percent: 10,
      memory_percent: 25.0,
      disk_percent: 20.0,
      daemon_version: '4.10.1',
    };

    // 即使 id 存在，但因为 node_type = master，也会报错
    await expect(nodeService.heartbeat(masterNodeId, payload))
      .rejects.toThrow(NodeNotFoundError);
  });
});

describe('NodeService - Invite & LinkKey Expiry', () => {
  let db: Knex;
  let nodeService: NodeService;
  const logger = pino({ level: 'silent' });

  beforeEach(async () => {
    db = await createTestDb();
    nodeService = new NodeService(db, logger);
  });

  afterEach(async () => {
    await destroyTestDb(db);
    vi.restoreAllMocks();
  });

  it('createInvite 返回 expiresAt 不为空且在未来 24h 窗口内', async () => {
    const beforeCreate = Date.now();
    const result = await nodeService.createInvite('Test Slave', SERVER_ADMIN_USER_ID, Role.SERVER_ADMIN);
    const afterCreate = Date.now();

    expect(result.expiresAt).toBeTruthy();
    const expiryMs = Date.parse(result.expiresAt);
    expect(Number.isFinite(expiryMs)).toBe(true);

    // 过期时间应在 now+24h 附近（允许 ±5s 误差）
    const expectedMin = beforeCreate + 24 * 60 * 60 * 1000 - 5000;
    const expectedMax = afterCreate + 24 * 60 * 60 * 1000 + 5000;
    expect(expiryMs).toBeGreaterThanOrEqual(expectedMin);
    expect(expiryMs).toBeLessThanOrEqual(expectedMax);
  });

  it('createInvite 写入 DB 的 link_key_expires_at 与返回值一致', async () => {
    const result = await nodeService.createInvite('Test Slave', SERVER_ADMIN_USER_ID, Role.SERVER_ADMIN);

    const row = await db('nodes').where({ id: result.nodeId }).first();
    expect(row.link_key_expires_at).toBe(result.expiresAt);
  });

  it('regenerateInvite 刷新 link_key_expires_at', async () => {
    const created = await nodeService.createInvite('Test Slave', SERVER_ADMIN_USER_ID, Role.SERVER_ADMIN);
    // 等待一小段时间确保时间戳不同
    await new Promise((r) => setTimeout(r, 50));

    const regenerated = await nodeService.regenerateInvite(created.nodeId);
    expect(regenerated.expiresAt).toBeTruthy();
    expect(regenerated.expiresAt).not.toBe(created.expiresAt);

    // DB 也应同步
    const row = await db('nodes').where({ id: created.nodeId }).first();
    expect(row.link_key_expires_at).toBe(regenerated.expiresAt);
  });

  it('linkSlave 对过期 linkKey 抛 NodeLinkKeyExpiredError', async () => {
    const result = await nodeService.createInvite('Test Slave', SERVER_ADMIN_USER_ID, Role.SERVER_ADMIN);

    // 手动将过期时间改为过去
    const pastTime = new Date(Date.now() - 60 * 1000).toISOString();
    await db('nodes').where({ id: result.nodeId }).update({ link_key_expires_at: pastTime });

    await expect(
      nodeService.linkSlave('http://192.168.1.10:8080', result.linkKey),
    ).rejects.toThrow(NodeLinkKeyExpiredError);
  });

  it('linkSlave 对未过期 linkKey 正常注册并清空 link_key_expires_at', async () => {
    const result = await nodeService.createInvite('Test Slave', SERVER_ADMIN_USER_ID, Role.SERVER_ADMIN);

    const linkResult = await nodeService.linkSlave(
      'http://192.168.1.10:8080',
      result.linkKey,
    );
    expect(linkResult.commsKey).toBeTruthy();

    const row = await db('nodes').where({ id: result.nodeId }).first();
    expect(row.status).toBe('online');
    expect(row.link_key_hash).toBeNull();
    expect(row.link_key_expires_at).toBeNull();
  });

  it('linkSlave 对 link_key_expires_at 为 NULL 的节点允许注册（向后兼容）', async () => {
    const result = await nodeService.createInvite('Test Slave', SERVER_ADMIN_USER_ID, Role.SERVER_ADMIN);
    // 清空过期时间模拟历史节点
    await db('nodes').where({ id: result.nodeId }).update({ link_key_expires_at: null });

    const linkResult = await nodeService.linkSlave(
      'http://192.168.1.10:8080',
      result.linkKey,
    );
    expect(linkResult.commsKey).toBeTruthy();
  });

  it('generateBootstrapScriptForLinkKey 正常返回脚本内容', async () => {
    const result = await nodeService.createInvite('Test Slave', SERVER_ADMIN_USER_ID, Role.SERVER_ADMIN);
    const script = await nodeService.generateBootstrapScriptForLinkKey(result.linkKey);

    expect(typeof script).toBe('string');
    expect(script).toContain('#!/bin/bash');
    expect(script).toContain(result.linkKey);
    expect(script).toContain('npm install');
    expect(script).toContain('npm run build');
    // Bug #3 回归：脚本不应包含 npm install --production
    expect(script).not.toContain('npm install --production');
  });

  it('generateBootstrapScriptForLinkKey 对过期 linkKey 抛 NodeLinkKeyExpiredError', async () => {
    const result = await nodeService.createInvite('Test Slave', SERVER_ADMIN_USER_ID, Role.SERVER_ADMIN);
    const pastTime = new Date(Date.now() - 60 * 1000).toISOString();
    await db('nodes').where({ id: result.nodeId }).update({ link_key_expires_at: pastTime });

    await expect(
      nodeService.generateBootstrapScriptForLinkKey(result.linkKey),
    ).rejects.toThrow(NodeLinkKeyExpiredError);
  });

  it('generateBootstrapScriptForLinkKey 对已注册节点的旧 linkKey 抛 NodeLinkKeyInvalidError', async () => {
    // 注册成功后 link_key_hash 已被清空（一次性邀请码），所以查不到节点 → NodeLinkKeyInvalidError
    // 这是符合预期的安全行为：已使用的邀请码不能再下载脚本，也不再有效
    const result = await nodeService.createInvite('Test Slave', SERVER_ADMIN_USER_ID, Role.SERVER_ADMIN);
    await nodeService.linkSlave('http://192.168.1.10:8080', result.linkKey);

    await expect(
      nodeService.generateBootstrapScriptForLinkKey(result.linkKey),
    ).rejects.toThrow(NodeLinkKeyInvalidError);
  });

  it('generateBootstrapScriptForLinkKey 对无效 linkKey 格式抛 NodeLinkKeyInvalidError', async () => {
    await expect(
      nodeService.generateBootstrapScriptForLinkKey('invalid-key'),
    ).rejects.toThrow(NodeLinkKeyInvalidError);
  });
});

// ===========================================================================
// v4.28.0 节点归属字段 + 角色筛选 + assertNodeOwnedByUser
// ===========================================================================
describe('NodeService - v4.28.0 Node Ownership', () => {
  let db: Knex;
  let nodeService: NodeService;
  const logger = pino({ level: 'silent' });

  beforeEach(async () => {
    db = await createTestDb();
    nodeService = new NodeService(db, logger);
    // v4.28.0: seed master 节点（platform_managed，归属平台）——与生产 initDatabase 行为一致
    // 供 listNodes 角色筛选测试验证 master 节点对 instance_admin 可见（platform_managed）
    await db('nodes').insert({
      id: 'node-master-seed',
      name: 'master',
      fqdn: '',
      daemon_token_hash: '',
      status: 'online',
      node_type: 'master',
      node_source: 'platform_managed',
      self_hosted_owner_id: null,
      approval_status: 'approved',
      last_seen_at: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    await destroyTestDb(db);
    vi.restoreAllMocks();
  });

  // ----- createInvite 角色分支 -----

  it('createInvite(server_admin) → node_source=platform_managed, owner=NULL, approval=approved', async () => {
    const result = await nodeService.createInvite(
      'Platform Node',
      SERVER_ADMIN_USER_ID,
      Role.SERVER_ADMIN,
    );
    const row = await db('nodes').where({ id: result.nodeId }).first();
    expect(row.node_source).toBe('platform_managed');
    expect(row.self_hosted_owner_id).toBeNull();
    expect(row.approval_status).toBe('approved');
  });

  it('createInvite(instance_admin) → node_source=self_hosted, owner=创建者, approval=pending', async () => {
    const result = await nodeService.createInvite(
      'Self-hosted Node',
      INSTANCE_ADMIN_USER_ID,
      Role.INSTANCE_ADMIN,
    );
    const row = await db('nodes').where({ id: result.nodeId }).first();
    expect(row.node_source).toBe('self_hosted');
    expect(row.self_hosted_owner_id).toBe(INSTANCE_ADMIN_USER_ID);
    expect(row.approval_status).toBe('pending');
  });

  // ----- listNodes 角色筛选 -----

  it('listNodes(server_admin) 返回全部节点', async () => {
    // 准备：1 个 platform_managed + 2 个 self_hosted（不同 owner）
    await nodeService.createInvite('P1', SERVER_ADMIN_USER_ID, Role.SERVER_ADMIN);
    await nodeService.createInvite('S1', INSTANCE_ADMIN_USER_ID, Role.INSTANCE_ADMIN);
    await nodeService.createInvite('S2', 'other-admin-id', Role.INSTANCE_ADMIN);

    const nodes = await nodeService.listNodes(Role.SERVER_ADMIN, SERVER_ADMIN_USER_ID);
    // 含 master 节点（testDb 自带）+ 3 个 slave = 4
    expect(nodes.length).toBe(4);
  });

  it('listNodes(instance_admin) 仅返回自有 self_hosted + 所有 platform_managed（不含他人 self_hosted）', async () => {
    await nodeService.createInvite('P1', SERVER_ADMIN_USER_ID, Role.SERVER_ADMIN);
    await nodeService.createInvite('S1', INSTANCE_ADMIN_USER_ID, Role.INSTANCE_ADMIN);
    await nodeService.createInvite('S2', 'other-admin-id', Role.INSTANCE_ADMIN);

    const nodes = await nodeService.listNodes(Role.INSTANCE_ADMIN, INSTANCE_ADMIN_USER_ID);
    // master（platform_managed）+ P1（platform_managed）+ S1（自有 self_hosted）= 3
    // 不含 S2（他人 self_hosted）
    expect(nodes.length).toBe(3);
    const names = nodes.map((n) => n.name).sort();
    expect(names).toEqual(['P1', 'S1', 'master'].sort());
  });

  // ----- assertNodeOwnedByUser 五分支 -----

  it('assertNodeOwnedByUser: server_admin 全通过（自有 self_hosted）', async () => {
    const result = await nodeService.createInvite(
      'S1',
      INSTANCE_ADMIN_USER_ID,
      Role.INSTANCE_ADMIN,
    );
    // server_admin 操作他人 self_hosted 节点也应通过
    await expect(
      nodeService.assertNodeOwnedByUser(result.nodeId, Role.SERVER_ADMIN, SERVER_ADMIN_USER_ID),
    ).resolves.toBeUndefined();
  });

  it('assertNodeOwnedByUser: instance_admin 操作自有 self_hosted 通过', async () => {
    const result = await nodeService.createInvite(
      'S1',
      INSTANCE_ADMIN_USER_ID,
      Role.INSTANCE_ADMIN,
    );
    await expect(
      nodeService.assertNodeOwnedByUser(result.nodeId, Role.INSTANCE_ADMIN, INSTANCE_ADMIN_USER_ID),
    ).resolves.toBeUndefined();
  });

  it('assertNodeOwnedByUser: instance_admin 操作他人 self_hosted 抛 NodeNotOwnedError', async () => {
    const result = await nodeService.createInvite(
      'S1',
      'other-admin-id',
      Role.INSTANCE_ADMIN,
    );
    await expect(
      nodeService.assertNodeOwnedByUser(result.nodeId, Role.INSTANCE_ADMIN, INSTANCE_ADMIN_USER_ID),
    ).rejects.toThrow(NodeNotOwnedError);
  });

  it('assertNodeOwnedByUser: instance_admin 操作 platform_managed 抛 NodeNotOwnedError', async () => {
    const result = await nodeService.createInvite(
      'P1',
      SERVER_ADMIN_USER_ID,
      Role.SERVER_ADMIN,
    );
    await expect(
      nodeService.assertNodeOwnedByUser(result.nodeId, Role.INSTANCE_ADMIN, INSTANCE_ADMIN_USER_ID),
    ).rejects.toThrow(NodeNotOwnedError);
  });

  it('assertNodeOwnedByUser: 节点不存在抛 NodeNotFoundError', async () => {
    await expect(
      nodeService.assertNodeOwnedByUser('non-existent', Role.INSTANCE_ADMIN, INSTANCE_ADMIN_USER_ID),
    ).rejects.toThrow(NodeNotFoundError);
  });
});
