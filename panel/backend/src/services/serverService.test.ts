import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import type { Knex } from 'knex';
import { createTestDb, destroyTestDb } from '../test/db-helper.js';
import { createServersRouter } from '../api/routes/servers.js';
import { mockLogger, mockDaemonClient } from '../test/mock-factory.js';

describe('ServerService / ServerRouter - Lifecycle Core Flow', () => {
  let db: Knex;
  let app: express.Express;
  let daemonClientMock: any;
  let daemonClientServiceMock: any;
  let registryMock: any;
  let wsServerMock: any;

  beforeEach(async () => {
    db = await createTestDb();
    
    // 初始化前置数据
    await db('users').insert({
      id: 'user-1',
      email: 'test@example.com',
      username: 'tester',
      password_hash: 'hash',
      role: 'server_admin', // 使用 server_admin 避免资源配额拦截
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await db('nodes').insert({
      id: 'node-local',
      name: 'Local Node',
      fqdn: 'localhost',
      daemon_token_hash: 'hash',
      status: 'online',
    });

    // Mock Daemon clients
    daemonClientMock = {
      startInstance: vi.fn().mockResolvedValue({ status: 'starting', pid: 1234 }),
      stopInstance: vi.fn().mockResolvedValue({ success: true }),
      sendCommand: vi.fn().mockResolvedValue({ success: true, output: 'ok' }),
    };

    daemonClientServiceMock = mockDaemonClient();

    // Mock Pack Registry
    registryMock = {
      get: vi.fn().mockReturnValue({
        pack: { id: 'minecraft-vanilla', game: 'minecraft' },
        startup: { default_game_port: 25565 },
        protocol: { default_port: 25575 },
      }),
    };

    wsServerMock = {};

    app = express();
    app.use(express.json());

    // v4.17.0: requirePermission 中间件依赖 req.app.locals.db（查 role_permission_templates 表）
    app.locals.db = db;

    // 模拟 authenticateToken 中间件（v4.17.0: 含 userRoles + activeRole）
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.user = {
        userId: 'user-1',
        email: 'test@example.com',
        username: 'tester',
        role: 'server_admin',
      };
      // v4.17.0: requirePermission 中间件依赖 req.userRoles + req.activeRole
      (req as Request & { userRoles?: string[]; activeRole?: string }).userRoles = ['server_admin'];
      (req as Request & { userRoles?: string[]; activeRole?: string }).activeRole = 'server_admin';
      next();
    });

    // 挂载路由
    app.use('/api/servers', createServersRouter(
      db,
      registryMock,
      daemonClientMock,
      wsServerMock,
      mockLogger() as any,
      vi.fn(),
      daemonClientServiceMock,
      undefined // safeRemoveService
    ));
  });

  afterEach(async () => {
    await destroyTestDb(db);
    vi.restoreAllMocks();
  });

  it('Create, Start, Stop, Delete 的生命周期', async () => {
    // 1. Create (创建实例)
    const createRes = await request(app)
      .post('/api/servers')
      .send({
        name: 'Test Server',
        pack_id: 'minecraft-vanilla',
        node_id: 'node-local',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.server).toBeDefined();
    expect(createRes.body.server.name).toBe('Test Server');
    expect(createRes.body.server.status).toBe('stopped');
    const serverId = createRes.body.server.id;

    // 验证数据库状态
    const row = await db('servers').where({ id: serverId }).first();
    expect(row).toBeDefined();
    expect(row.status).toBe('stopped');

    // 2. Start (启动实例)
    const startRes = await request(app)
      .post(`/api/servers/${serverId}/start`)
      .send();

    expect(startRes.status).toBe(200);
    expect(startRes.body.status).toBe('starting');
    expect(daemonClientMock.startInstance).toHaveBeenCalled();

    // 验证数据库状态更新为 starting
    const rowAfterStart = await db('servers').where({ id: serverId }).first();
    expect(rowAfterStart.status).toBe('starting');

    // 模拟 Daemon 发来 state.change 变成 running
    await db('servers').where({ id: serverId }).update({ status: 'running' });

    // 3. Stop (停止实例)
    const stopRes = await request(app)
      .post(`/api/servers/${serverId}/stop`)
      .send();

    expect(stopRes.status).toBe(200);
    expect(stopRes.body.status).toBe('stopping');
    expect(daemonClientMock.stopInstance).toHaveBeenCalled();

    // 验证数据库状态更新为 stopping
    const rowAfterStop = await db('servers').where({ id: serverId }).first();
    expect(rowAfterStop.status).toBe('stopping');

    // 模拟 Daemon 发来 state.change 变成 stopped
    await db('servers').where({ id: serverId }).update({ status: 'stopped' });

    // 4. Delete (删除实例)
    const deleteRes = await request(app)
      .delete(`/api/servers/${serverId}`)
      .send();

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.deleted).toBe(true);

    // 验证数据库中已删除
    const rowAfterDelete = await db('servers').where({ id: serverId }).first();
    expect(rowAfterDelete).toBeUndefined();
  });

  it('Delete (仅 stopped/error 状态可删除)', async () => {
    // 1. Create
    const createRes = await request(app)
      .post('/api/servers')
      .send({
        name: 'Running Server',
        pack_id: 'minecraft-vanilla',
        node_id: 'node-local',
      });
    const serverId = createRes.body.server.id;

    // 强制设为 running
    await db('servers').where({ id: serverId }).update({ status: 'running' });

    // 尝试删除
    const deleteRes = await request(app)
      .delete(`/api/servers/${serverId}`)
      .send();

    expect(deleteRes.status).toBe(409); // Conflict, invalid state
    expect(deleteRes.body.error.code).toBe('INVALID_SERVER_STATE');
  });

  // v4.29.8: error 状态恢复路径测试套件
  describe('v4.29.8: error 状态恢复路径', () => {
    async function createErrorInstance(name: string): Promise<string> {
      const createRes = await request(app)
        .post('/api/servers')
        .send({ name, pack_id: 'minecraft-vanilla', node_id: 'node-local' });
      const serverId = createRes.body.server.id;
      await db('servers').where({ id: serverId }).update({ status: 'error' });
      return serverId;
    }

    it('error 状态下可停止', async () => {
      const serverId = await createErrorInstance('Error Server Stop');
      const stopRes = await request(app).post(`/api/servers/${serverId}/stop`).send();

      expect(stopRes.status).toBe(200);
      expect(stopRes.body.status).toBe('stopping');
      expect(daemonClientMock.stopInstance).toHaveBeenCalledWith(serverId);

      const row = await db('servers').where({ id: serverId }).first();
      expect(row.status).toBe('stopping');
    });

    it('error 状态下 stop daemon 失败时 DB 回滚到 error', async () => {
      const serverId = await createErrorInstance('Error Server Stop Fail');
      daemonClientMock.stopInstance.mockRejectedValueOnce(new Error('daemon unreachable'));

      const stopRes = await request(app).post(`/api/servers/${serverId}/stop`).send();

      // 普通 Error 走 handleInternal 返回 500；DaemonApiError 才返回 503/502
      expect(stopRes.status).toBe(500);
      // 关键：DB 回滚到 error，不卡 stopping
      const row = await db('servers').where({ id: serverId }).first();
      expect(row.status).toBe('error');
    });

    it('error 状态下可删除（best-effort 调 daemon）', async () => {
      const serverId = await createErrorInstance('Error Server Delete');
      const deleteRes = await request(app).delete(`/api/servers/${serverId}`).send();

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.deleted).toBe(true);
      expect(daemonClientMock.stopInstance).toHaveBeenCalledWith(serverId);

      const row = await db('servers').where({ id: serverId }).first();
      expect(row).toBeUndefined();
    });

    it('error 状态下删除时 best-effort stopInstance 失败仍继续删除', async () => {
      const serverId = await createErrorInstance('Error Server Delete Fail');
      daemonClientMock.stopInstance.mockRejectedValueOnce(new Error('daemon unreachable'));

      const deleteRes = await request(app).delete(`/api/servers/${serverId}`).send();

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.deleted).toBe(true);
      const row = await db('servers').where({ id: serverId }).first();
      expect(row).toBeUndefined();
    });

    it('error 状态下可重置状态（仅 DB 操作，不调 daemon）', async () => {
      const serverId = await createErrorInstance('Error Server Reset');
      const resetRes = await request(app).post(`/api/servers/${serverId}/reset-state`).send();

      expect(resetRes.status).toBe(200);
      expect(resetRes.body.current_status).toBe('stopped');
      expect(resetRes.body.previous_status).toBe('error');
      // 关键：不调用 daemon
      expect(daemonClientMock.stopInstance).not.toHaveBeenCalled();

      const row = await db('servers').where({ id: serverId }).first();
      expect(row.status).toBe('stopped');
    });

    it('非 error 状态调用 reset-state 返回 409', async () => {
      const createRes = await request(app)
        .post('/api/servers')
        .send({ name: 'Running Reset Attempt', pack_id: 'minecraft-vanilla', node_id: 'node-local' });
      const serverId = createRes.body.server.id;
      await db('servers').where({ id: serverId }).update({ status: 'running' });

      const resetRes = await request(app).post(`/api/servers/${serverId}/reset-state`).send();

      expect(resetRes.status).toBe(409);
      expect(resetRes.body.error.code).toBe('INVALID_SERVER_STATE');
    });

    it('非 server_admin 用户调用 reset-state 返回 403', async () => {
      const serverId = await createErrorInstance('Error Server NonAdmin');

      // 临时降级当前用户角色为 instance_admin
      const originalRole = (app as any)._currentRole;
      (app as any)._currentRole = 'instance_admin';
      // 通过 middleware 拦截设置 activeRole
      const oldMiddleware = (app as any)._router;
      // 直接构造一个新 app 实例做权限测试更可靠
      const app2 = express();
      app2.use(express.json());
      app2.locals.db = db;
      app2.use((req: Request, _res: Response, next: NextFunction) => {
        req.user = {
          userId: 'user-1',
          email: 'test@example.com',
          username: 'tester',
          role: 'instance_admin',
        };
        (req as Request & { userRoles?: string[]; activeRole?: string }).userRoles = ['instance_admin'];
        (req as Request & { userRoles?: string[]; activeRole?: string }).activeRole = 'instance_admin';
        next();
      });
      app2.use('/api/servers', createServersRouter(
        db, registryMock, daemonClientMock, wsServerMock,
        mockLogger() as any, vi.fn(), daemonClientServiceMock, undefined,
      ));

      const resetRes = await request(app2).post(`/api/servers/${serverId}/reset-state`).send();

      expect(resetRes.status).toBe(403);
      expect(resetRes.body.error.code).toBe('PANEL_FORBIDDEN');

      // 原 app 的角色未变更（恢复）
      (app as any)._currentRole = originalRole;
      (app as any)._router = oldMiddleware;
    });

    it('running 状态下 stop daemon 失败不回滚（回归保护）', async () => {
      const createRes = await request(app)
        .post('/api/servers')
        .send({ name: 'Running Stop Fail', pack_id: 'minecraft-vanilla', node_id: 'node-local' });
      const serverId = createRes.body.server.id;
      await db('servers').where({ id: serverId }).update({ status: 'running' });
      daemonClientMock.stopInstance.mockRejectedValueOnce(new Error('daemon unreachable'));

      const stopRes = await request(app).post(`/api/servers/${serverId}/stop`).send();

      // 普通 Error 走 handleInternal 返回 500；DaemonApiError 才返回 503/502
      expect(stopRes.status).toBe(500);
      // 关键：running 状态不回滚，停留 stopping（依赖 scheduler 状态超时扫描）
      const row = await db('servers').where({ id: serverId }).first();
      expect(row.status).toBe('stopping');
    });
  });
});
