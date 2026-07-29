// ============================================================================
// Panel Backend 入口（纯启动入口）
// 职责：加载配置 → 初始化 DB → seed admin → 初始化 PackRegistry →
//       initServices → createApp → initWebSocket → registerRoutes →
//       initScheduler → server.listen → graceful shutdown
// 端口：3002（v4.0.1 起仅监听本机，由 nginx 3001 反向代理）
// ============================================================================

import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import pino from 'pino';

import { initDatabase, closeDatabase, runMigrations } from './db/connection.js';
import { seedDemoAccountsIfMissing, seedProvisionalAdminIfEmpty, seedLocalNodeIfEmpty } from './db/seed.js';
import { seedDemoInstancesIfMissing, seedDemoUserBindingsIfMissing } from './db/seedDemoData.js';
import { PackRegistry } from './core/packs/registry.js';
import { createApp } from './app.js';
import { initServices } from './services-init.js';
import { registerRoutes } from './routes-registry.js';
import { initScheduler } from './scheduler-init.js';
import { initWebSocket } from './websocket-init.js';
import { scheduler } from './services/scheduler.js';

// ----- 日志 -----
const logLevel = process.env.LOG_LEVEL ?? 'info';
const logger = pino({
  level: logLevel,
  transport: process.env.NODE_ENV === 'production' ? undefined : {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss' },
  },
});

// ----- 配置 -----
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const PANEL_HOST = process.env.PANEL_HOST ?? '127.0.0.1';
const JWT_SECRET = process.env.JWT_SECRET ?? '';
const DATABASE_URL = process.env.DATABASE_URL ?? './data/panel.db';
const DAEMON_URL = process.env.DAEMON_URL ?? 'http://127.0.0.1:8080';
const DAEMON_TOKEN = process.env.DAEMON_TOKEN ?? '';

// D8: JWT secret 最小长度强制——生产环境 <16 字符拒绝启动；非生产环境降级 warn
if (JWT_SECRET.length < 16) {
  if (process.env.NODE_ENV === 'production') {
    console.error('JWT_SECRET 长度不足 16 字符，生产环境拒绝启动');
    process.exit(1);
  }
  logger.warn('JWT_SECRET 过短，生产环境请使用至少 32 字符的强随机值');
}
if (!DAEMON_TOKEN) {
  logger.warn('DAEMON_TOKEN 未配置，Panel→Daemon 调用将无鉴权');
}

// A6: 全局未捕获异常兜底——记录日志但不 crash 进程
process.on('uncaughtException', (err) => {
  logger.error({ err }, '未捕获的异常（uncaughtException），已记录但不退出进程');
});
process.on('unhandledRejection', (reason) => {
  logger.error(
    { reason: reason instanceof Error ? reason.message : String(reason) },
    '未处理的 Promise 拒绝（unhandledRejection），已记录但不退出进程',
  );
});

// ----- 启动 -----
async function main(): Promise<void> {
  const startTime = Date.now();
  logger.info('Panel Backend 启动中...');

  // 1. 初始化数据库
  const db = initDatabase(DATABASE_URL);
  await runMigrations();
  logger.info('数据库 migrations 已就绪');

  // 2. Seed demo 账号 / 本地节点
  // v4.22.0 起生产模式不再预置任何默认管理员，必须走 Setup Wizard 创建首个管理员。
  // 演示模式才会 seed 3 个 *@local.dev 内置账号（admin/manager/user，is_built_in=1）。
  if (process.env.VITE_ENABLE_DEMO === 'true') {
    await seedDemoAccountsIfMissing(db);
    logger.info('演示模式：seed 3 个 *@local.dev 演示账号完成');
  } else {
    await seedProvisionalAdminIfEmpty(db);
    logger.info('生产模式：不预置默认管理员，等待 Setup Wizard 创建首个管理员');
  }
  await seedLocalNodeIfEmpty(db);
  logger.info('本地节点 seed 完成');

  // 3. 初始化 PackRegistry
  const registry = new PackRegistry();
  const packsDir = process.env.PACKS_DIR ?? path.resolve(process.cwd(), '../../packs');
  if (fs.existsSync(packsDir)) {
    const loaded = registry.loadFromDir(packsDir);
    logger.info({ count: loaded.length, dir: packsDir }, 'Pack 加载完成');
    for (const pack of loaded) {
      const now = new Date().toISOString();
      await db('packs')
        .insert({
          id: pack.pack.id,
          game: pack.pack.game,
          variant: pack.pack.variant,
          display_name: pack.pack.display_name,
          version: pack.pack.version,
          enabled: true,
          loaded_at: now,
        })
        .onConflict('id')
        .merge();
    }
  } else {
    logger.warn({ dir: packsDir }, 'Pack 目录不存在，跳过加载');
  }

  // v4.0.2: 演示模式——若 VITE_ENABLE_DEMO=true 则 seed 5 个示例实例
  if (process.env.VITE_ENABLE_DEMO === 'true') {
    try {
      const demoResult = await seedDemoInstancesIfMissing(db, registry);
      logger.info(
        { created: demoResult.created.length, skipped: demoResult.skipped.length },
        'v4.0.2 演示实例 seed 完成',
      );
      // v4.15.x: 演示玩家实例绑定 seed（user 角色访问店铺视图需 active 绑定，修复 403）
      const bindResult = await seedDemoUserBindingsIfMissing(db);
      logger.info(
        { created: bindResult.created, skipped: bindResult.skipped },
        'v4.15.x 演示玩家实例绑定 seed 完成',
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'v4.0.2 演示实例 seed 失败（非致命）',
      );
    }
  }

  // 4. 初始化所有 Service
  const services = await initServices(db, registry, {
    JWT_SECRET,
    DAEMON_URL,
    DAEMON_TOKEN,
    logger,
  });

  // 5. 创建 Express 应用（中间件注册）
  const app = createApp({
    logger,
    settingSchemaService: services.settingSchemaService,
    JWT_SECRET,
    db,
    corsOrigin: process.env.CORS_ORIGIN,
  });

  // 6. 创建 HTTP server
  const server = http.createServer(app);

  // 7. 初始化 WebSocket + DaemonEventStream（在路由注册之前，供路由回调引用）
  const { wsServer, daemonEventStream } = initWebSocket(server, {
    db,
    registry,
    services,
    logger,
    JWT_SECRET,
    DAEMON_URL,
    DAEMON_TOKEN,
  });

  // I5: 将 wsServer 注入 notificationService，启用 WebSocket 通知实时推送
  // （notificationService 在 initServices 中先于 wsServer 创建，此处通过方法注入绑定）
  services.notificationService.setWsServer(wsServer);

  // L2: 将 wsServer 注入 nodeService，启用节点状态变更广播（slave 上线/离线）
  services.nodeService.setWsServer(wsServer);

  // 8. 注册路由（含 app.locals 注入 + 内联路由 + 59 个业务路由 + 静态文件 + 错误处理）
  const { systemMonitorService } = registerRoutes({
    app,
    db,
    registry,
    services,
    JWT_SECRET,
    logger,
    wsServer,
    daemonEventStream,
  });

  // 9. 注册 Scheduler 执行器 + 定时任务 + 事件订阅
  initScheduler({
    db,
    registry,
    services,
    logger,
    DAEMON_URL,
    DAEMON_TOKEN,
  });

  // 10. 启动监听
    server.listen(PORT, PANEL_HOST, () => {
    const elapsed = Date.now() - startTime;
      logger.info({ host: PANEL_HOST, port: PORT, elapsedMs: elapsed }, 'Panel Backend 已启动');
    // HTTP 服务启动后再连 Daemon WS，避免事件到达时 WS 服务未就绪
    daemonEventStream.connect();
  });

  // 11. 优雅退出
  const shutdown = async (): Promise<void> => {
    logger.info('正在关闭...');
    systemMonitorService.stop();
    scheduler.destroy();
    daemonEventStream.close();
    wsServer.close();
    server.close();
    await closeDatabase();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'Panel Backend 启动失败');
  process.exit(1);
});
