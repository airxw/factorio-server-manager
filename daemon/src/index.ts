// ============================================================================
// 模块2_Daemon后端骨架 — 入口
// 依据：daemon/AGENTS.md §模块专属约束 7
// 日志格式：pino 结构化日志（name=daemon，level 由 LOG_LEVEL 控制）
// ============================================================================

import 'dotenv/config';
import pino from 'pino';
import { createDaemonServer } from './server.js';
import { setCommsKeyProvider } from './auth.js';
import {
  parseSlaveModeConfigFromEnv,
  SlaveModeClient,
  type SlaveState,
} from './slaveMode.js';
// v4.15.0: 版本号改为从 package.json 读取，消除硬编码常量（避免版本同步漏改导致 daemon 上报幽灵版本）
import pkg from '../package.json';

// 版本号来源：daemon/package.json 的 version 字段（单一真相源）
const DAEMON_VERSION = pkg.version;
const DEFAULT_PORT = 8080;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_LOG_LEVEL = 'info';
const DEFAULT_DAEMON_ID = 'daemon-local';

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
    const host = process.env.DAEMON_HOST ?? DEFAULT_HOST;
  const daemonId = process.env.DAEMON_ID ?? DEFAULT_DAEMON_ID;
  const logLevel = process.env.LOG_LEVEL ?? DEFAULT_LOG_LEVEL;

  // L2-2: slave 模式下 DAEMON_TOKEN 可选（用 commsKey 替代）
  // master 模式仍要求 DAEMON_TOKEN 必填
  const isSlaveMode = process.env.SLAVE_MODE === 'true';
  if (!isSlaveMode && !process.env.DAEMON_TOKEN) {
    console.error('[ERROR] [daemon] DAEMON_TOKEN environment variable is required');
    process.exit(1);
  }

  const logger = pino({ name: 'daemon', level: logLevel });

  // L2-2: 解析 slave 模式配置（若未启用返回 null）
  let slaveConfig: ReturnType<typeof parseSlaveModeConfigFromEnv> = null;
  if (isSlaveMode) {
    try {
      slaveConfig = parseSlaveModeConfigFromEnv({
        daemonVersion: DAEMON_VERSION,
        defaultPort: DEFAULT_PORT,
      });
    } catch (err) {
      console.error(
        `[ERROR] [daemon] slave mode 配置错误: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  }

  const { server: httpServer, shutdown } = createDaemonServer(
    { daemonId, daemonVersion: DAEMON_VERSION },
    logger,
  );

  // A3: HTTP Server 错误处理 — 端口冲突、权限不足等场景优雅降级，不导致进程崩溃
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error({ err: err.message, port }, '端口被占用，请检查是否有其他进程正在使用该端口');
    } else if (err.code === 'EACCES') {
      logger.error({ err: err.message, port }, '权限不足，无法绑定端口');
    } else {
      logger.error({ err: err.message }, 'http server error');
    }
  });

    httpServer.listen(port, host, () => {
      logger.info({ host, port }, 'daemon listening');
  });

  // L2-2: slave 模式启动 — 向 master 注册 + 持久化 commsKey + 启动 heartbeat
  let slaveClient: SlaveModeClient | null = null;
  if (slaveConfig) {
    slaveClient = new SlaveModeClient(slaveConfig, logger);
    try {
      const state: SlaveState = await slaveClient.start();
      // 注入 commsKeyProvider，让 auth 中间件接受 master 的 commsKey 调用
      setCommsKeyProvider(() => slaveClient?.getCommsKey() ?? null);
      logger.info(
        { nodeId: state.node_id, masterUrl: state.master_url },
        `slave mode 启动成功，daemon ${port} 端口已就绪`,
      );
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'slave mode 启动失败（无法连接 master），进程退出',
      );
      process.exit(1);
    }
  }

  // A7: 信号处理 — 先清理所有子进程（游戏服务器），再关连接，最后退出
  let shuttingDown = false;
  const handleShutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    // 1. 先清理所有子进程（游戏服务器），避免孤儿进程
    shutdown()
      .catch((err) => {
        logger.error({ err: String(err) }, 'shutdown: 清理子进程失败');
      })
      .finally(() => {
        // L2-2: slave 模式清理 heartbeat 定时器
        if (slaveClient) {
          slaveClient.shutdown().catch((err) => {
            logger.warn({ err: String(err) }, 'shutdown: slave mode 清理失败');
          });
        }
        // 2. 关闭 HTTP/WS 连接
        httpServer.close(() => {
          logger.info('server closed');
          process.exit(0);
        });
      });
  };
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[FATAL] [daemon]', err);
  process.exit(1);
});
