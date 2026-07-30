// ============================================================================
// 模块2_Daemon后端骨架 — Express + ws 服务端
// 依据：daemon/AGENTS.md §模块专属约束 1/5/6/7
// 单端口双协议：HTTP + WebSocket 共用端口 8080，WS 路径 /ws
// 实例路由对接 InstanceManager（模块4）与协议层（模块5）
// ============================================================================

import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { GamePackSchema, type GamePack } from '@public/schema/pack-schema';
import type {
  HealthResponse,
  ListInstancesResponse,
  InstanceStateResponse,
  StartInstanceResponse,
  StopInstanceResponse,
  CommandResponse,
  DaemonErrorResponse,
  DaemonErrorCodeType,
  ExecCommandRequest,
  ExecCommandResponse,
  FileReadResponse,
  FileWriteRequest,
  FileWriteResponse,
} from '@public/schema/daemon-api-types';
import type {
  ConnectedEvent,
  PanelToDaemonCommand,
  ConsoleOutputEvent,
  StateChangeEvent,
  InstanceStartedEvent,
  InstanceStoppedEvent,
} from '@public/schema/ws-events';
import { authMiddleware, handleWsAuth } from './auth.js';
import { InstanceManager, type InstanceEventCallbacks } from './instances/manager.js';
import { MonitorService } from './monitoring/service.js';
// v4.11.0: RCON 防注入沙箱引擎（孤岛代码接入主路径）
import { ExecutionEngine, type IInstanceCommandSender } from './modules/execution_engine/ExecutionEngine.js';
import {
  type Instance,
  InstanceNotFoundError,
  InstanceAlreadyRunningError,
  InstanceNotRunningError,
  InvalidStateTransitionError,
  CommandFailedError,
} from './instances/types.js';
// Task 3.5 新增：文件操作与命令执行
// v4.3.0 新增：listDir / toggleModFile
import {
  readFile as fileManagerReadFile,
  writeFile as fileManagerWriteFile,
  listDir as fileManagerListDir,
  toggleModFile as fileManagerToggleMod,
  FilePathInvalidError,
  FileNotFoundError,
} from './files/fileManager.js';
import {
  execCommand as runnerExecCommand,
  ExecCommandFailedError,
  ExecTimeoutError,
  CwdInvalidError,
} from './instances/commandRunner.js';
// v4.4.0-M1 新增：Java 环境扫描
import { scanJavas, type ScanJavasResult } from './env/javaScanner.js';
// L4 新增：jar 元数据扫描（识别客户端 mod）
import { scanModsDir, type ModMetadata } from './files/modScanner.js';

export interface DaemonServerConfig {
  daemonId: string;
  daemonVersion: string;
}

/** A7: Daemon 服务端返回值，包含 HTTP 服务和优雅关闭方法。 */
export interface DaemonServer {
  /** HTTP + WS 服务端实例（调用方 listen/close） */
  server: import('node:http').Server;
  /** A7: 优雅关闭 — 先清理所有子进程，再由调用方关闭连接 */
  shutdown: () => Promise<void>;
}

/** POST /api/instances/:id/start 请求体：Panel 内联携带完整 Pack + 实例参数。 */
interface StartRequestBody {
  pack: unknown;
  instance: {
    name: string;
    port: number;
    rcon_port: number;
    rcon_password: string;
    workdir: string;
  };
}

/** POST /api/instances/:id/command 请求体。 */
interface CommandRequestBody {
  command: string;
}

/** POST /api/instances/:id/restart-with-save 请求体。 */
interface RestartWithSaveRequestBody {
  save_path: string;
}

/**
 * POST /api/instances/:id/execute-logic 请求体（v4.11.0 卡密/商城发货沙箱入口）。
 *
 * 与 /command 的区别：/command 接收已渲染好的命令字符串（Panel 侧 commandDispatcher
 * 已完成 {{var}} 替换）；/execute-logic 接收原始 logicString（含 {Var} 单花括号占位符）
 * 与 variables 映射，由 daemon 侧 ExecutionEngine 沙箱完成变量替换 + 正则白名单校验后
 * 投递。适用于 UGC 自定义资产发货场景——实例管理员配置的 logicString 不经过 Panel
 * 侧渲染，直接交由 daemon 沙箱校验，避免 Panel 侧被绕过。
 */
interface ExecuteLogicRequestBody {
  /** 含 {Var} 单花括号占位符的原始指令模板 */
  logic_string: string;
  /** 变量名 → 变量值映射，沙箱内替换占位符 */
  variables: Record<string, string>;
}

/** 构造 ISO 时间戳。 */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 解析实例 workdir 用于文件读写操作。
 *
 * 优先使用 InstanceManager 中已注册实例的 workdir（实例启动过）；
 * 若实例未注册（从未启动），则从 INSTANCES_DIR 环境变量推断 workdir
 * 并自动创建目录（含 config 子目录），让未启动实例也能读写配置文件。
 *
 * 这是修复 ConfigFileEditor 在未启动实例上报 'Instance not found' 的兜底逻辑。
 * 不影响 startInstance 流程 — startInstance 仍走 InstanceManager.startInstance 正常注册。
 */
function resolveInstanceWorkdir(
  manager: InstanceManager,
  id: string,
): string {
  const registered = manager.getInstance(id);
  if (registered) {
    return registered.workdir;
  }
  // 未注册实例：从 INSTANCES_DIR 推断 workdir
  const instancesDir = process.env.INSTANCES_DIR ?? './instances';
  const workdir = path.resolve(instancesDir, id);
  if (!fs.existsSync(workdir)) {
    fs.mkdirSync(workdir, { recursive: true });
  }
  // 同步创建 config 子目录（多数 Pack 配置文件位于 config/）
  const configDir = path.join(workdir, 'config');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  return workdir;
}

/**
 * 创建 Daemon HTTP + WS 服务端（不监听端口，由调用方 listen）
 *
 * 路由：
 *   GET  /health                       无需鉴权 → { status: "ok" }
 *   GET  /api/instances                Bearer  → 实例摘要列表
 *   GET  /api/instances/:id/state      Bearer  → 实例状态
 *   GET  /api/instances/:id/logs       Bearer  → 历史日志行数组
 *   POST /api/instances/:id/start      Bearer  → 启动实例（body 内联 Pack）
 *   POST /api/instances/:id/stop       Bearer  → 停止实例
 *   POST /api/instances/:id/restart-with-save Bearer → 带存档重启
 *   POST /api/instances/:id/command    Bearer  → 发送命令
 *
 * WS：ws://host:8080/ws?token=<token>
 *   鉴权通过 → 发送 connected 事件
 *   接收 subscribe 命令 → 注册订阅，实例事件按 instance_id 推送
 */
export function createDaemonServer(
  config: DaemonServerConfig,
  logger: Logger,
) {
  const app = express();
  app.use(express.json());

  const manager = new InstanceManager(logger);
  // 监控服务：实例就绪后主动采集 CPU/内存，进程退出后停止
  // 采集间隔由环境变量 MONITOR_INTERVAL_MS 配置（默认 10s）
  // A3: 穿透子进程监控 — 传入 getChildProcessPids，采集时穿透 bash/cmd wrapper 聚合进程树
  const monitorService = new MonitorService(logger, {
    getChildPids: (pid: number) => manager.getChildProcessPids(pid),
  });
  manager.setMonitorService(monitorService);

  // v4.11.0: RCON 防注入沙箱引擎接入 — 实例化 ExecutionEngine 并注入 InstanceManager。
  //
  // IInstanceCommandSender 适配器调用 manager.sendRawCommand（底层投递，不经过沙箱），
  // 避免 ExecutionEngine.executeLogic → sender.sendCommand → manager.sendCommand 的递归。
  // 注入后，manager.sendCommand 收到含 {Var} 单花括号占位符的自定义指令时走沙箱校验；
  // manager.executeLogic(id, logicString, variables) 作为发货链路沙箱入口。
  // 普通硬编码指令（不含 {Var}）走 sendRawCommand 原路径，行为不变。
  const rconCommandSender: IInstanceCommandSender = {
    sendCommand: (id: string, command: string) => manager.sendRawCommand(id, command),
  };
  const executionEngine = new ExecutionEngine(rconCommandSender);
  manager.setExecutionEngine(executionEngine);

  // --- WS 订阅表：instance_id → 订阅客户端集合；ws → 已订阅 instance_id 集合 ---
  const subscribersByInstance = new Map<string, Set<WebSocket>>();
  const subscriptionsByWs = new Map<WebSocket, Set<string>>();

  function subscribe(instanceId: string, ws: WebSocket): void {
    let set = subscribersByInstance.get(instanceId);
    if (!set) {
      set = new Set();
      subscribersByInstance.set(instanceId, set);
    }
    set.add(ws);
    let subscribed = subscriptionsByWs.get(ws);
    if (!subscribed) {
      subscribed = new Set();
      subscriptionsByWs.set(ws, subscribed);
    }
    subscribed.add(instanceId);
  }

  function removeAllSubscriptions(ws: WebSocket): void {
    const subscribed = subscriptionsByWs.get(ws);
    if (!subscribed) return;
    for (const instanceId of subscribed) {
      const set = subscribersByInstance.get(instanceId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          subscribersByInstance.delete(instanceId);
        }
      }
    }
    subscriptionsByWs.delete(ws);
  }

  /**
   * v4.4.0-N1: 取消单个实例的订阅（不关闭 WS 连接）。
   * 用于前端最后一个订阅者退出时释放 Daemon 端订阅资源。
   */
  function unsubscribe(instanceId: string, ws: WebSocket): void {
    const set = subscribersByInstance.get(instanceId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        subscribersByInstance.delete(instanceId);
      }
    }
    const subscribed = subscriptionsByWs.get(ws);
    if (subscribed) {
      subscribed.delete(instanceId);
    }
  }

  /** 向某实例的所有订阅者广播 WS 事件。 */
  function broadcast<T>(instanceId: string, event: T): void {
    const set = subscribersByInstance.get(instanceId);
    if (!set || set.size === 0) return;
    const payload = JSON.stringify(event);
    for (const ws of set) {
      if (ws.readyState === ws.OPEN) {
        ws.send(payload);
      }
    }
  }

  /** 为实例构造事件回调：将 manager 内部事件转推给 WS 订阅者。 */
  function makeCallbacks(instanceId: string): InstanceEventCallbacks {
    return {
      onConsole: (line, stream) => {
        const event: ConsoleOutputEvent = {
          type: 'console.output',
          timestamp: nowIso(),
          instance_id: instanceId,
          line,
          stream,
        };
        broadcast(instanceId, event);
      },
      onStateChange: (from, to) => {
        const event: StateChangeEvent = {
          type: 'state.change',
          timestamp: nowIso(),
          instance_id: instanceId,
          from,
          to,
        };
        broadcast(instanceId, event);
      },
      onStarted: (pid) => {
        const event: InstanceStartedEvent = {
          type: 'instance.started',
          timestamp: nowIso(),
          instance_id: instanceId,
          pid,
        };
        broadcast(instanceId, event);
      },
      onStopped: (exitCode) => {
        const event: InstanceStoppedEvent = {
          type: 'instance.stopped',
          timestamp: nowIso(),
          instance_id: instanceId,
          exit_code: exitCode,
        };
        broadcast(instanceId, event);
      },
    };
  }

  /** 统一错误响应：构造 DaemonErrorResponse 并写入指定状态码。 */
  function sendError(res: Response, status: number, code: DaemonErrorCodeType, message: string): void {
    const body: DaemonErrorResponse = { error: { code, message } };
    res.status(status).json(body);
  }

  /** 将 InstanceManager 抛出的错误映射为 HTTP 响应；返回 true 表示已处理。 */
  function handleManagerError(res: Response, err: unknown): boolean {
    if (err instanceof InstanceNotFoundError) {
      sendError(res, 404, 'INSTANCE_NOT_FOUND', err.message);
      return true;
    }
    if (err instanceof InstanceAlreadyRunningError) {
      sendError(res, 409, 'INSTANCE_ALREADY_RUNNING', err.message);
      return true;
    }
    if (err instanceof InstanceNotRunningError) {
      sendError(res, 409, 'INSTANCE_NOT_RUNNING', err.message);
      return true;
    }
    if (err instanceof InvalidStateTransitionError) {
      sendError(res, 409, 'INVALID_STATE_TRANSITION', err.message);
      return true;
    }
    if (err instanceof CommandFailedError) {
      sendError(res, 500, 'COMMAND_FAILED', err.message);
      return true;
    }
    return false;
  }

  // GET /health — 健康检查（无需鉴权）
  app.get('/health', (_req: Request, res: Response) => {
    const body: HealthResponse = {
      status: 'ok',
      uptime: process.uptime(),
      version: config.daemonVersion,
    };
    res.json(body);
  });

  // GET /api/instances — 列出所有实例摘要
  app.get('/api/instances', authMiddleware, (_req: Request, res: Response) => {
    const body: ListInstancesResponse = { instances: manager.listSummaries() };
    res.json(body);
  });

  // GET /api/instances/:id/state — 查询实例状态
  app.get('/api/instances/:id/state', authMiddleware, (req: Request, res: Response) => {
    const id = req.params.id;
    const instance = manager.getInstance(id);
    if (!instance) {
      sendError(res, 404, 'INSTANCE_NOT_FOUND', `Instance not found: ${id}`);
      return;
    }
    const body: InstanceStateResponse = {
      id,
      status: instance.status,
      started_at: instance.started_at,
      pid: instance.pid,
    };
    res.json(body);
  });

  // GET /api/instances/:id/logs?limit=100&offset=0&filter=<substr> — 读取实例历史日志行
  // 返回 JSON 字符串数组；实例未启动过或无日志时返回空数组
  // B10: filter 参数支持不区分大小写的子串过滤
  app.get('/api/instances/:id/logs', authMiddleware, async (req: Request, res: Response) => {
    const id = req.params.id;
    const limitRaw = req.query.limit;
    const offsetRaw = req.query.offset;
    const filterRaw = req.query.filter;
    const limit = typeof limitRaw === 'string' ? parseInt(limitRaw, 10) : 100;
    const offset = typeof offsetRaw === 'string' ? parseInt(offsetRaw, 10) : 0;
    // 解析失败或非法值回退默认值
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 100;
    const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
    const filter = typeof filterRaw === 'string' && filterRaw.length > 0 ? filterRaw : undefined;
    try {
      const lines = await manager.getInstanceLogs(id, safeLimit, safeOffset, filter);
      res.json(lines);
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'read instance logs failed');
      sendError(res, 500, 'DAEMON_INTERNAL_ERROR', 'read instance logs failed');
    }
  });

  // GET /api/instances/:id/log-files — 列出实例的所有日志文件（按修改时间倒序）
  app.get('/api/instances/:id/log-files', authMiddleware, (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      const files = manager.listLogFiles(id);
      res.json({ files });
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'list log files failed');
      sendError(res, 500, 'DAEMON_INTERNAL_ERROR', 'list log files failed');
    }
  });

  // GET /api/instances/:id/log-files/:filename?count=N — 读取指定日志文件的最后 N 行
  app.get('/api/instances/:id/log-files/:filename', authMiddleware, (req: Request, res: Response) => {
    const id = req.params.id;
    const filename = req.params.filename;
    const countRaw = req.query.count;
    const count = typeof countRaw === 'string' ? parseInt(countRaw, 10) : undefined;
    const safeCount = Number.isFinite(count) && count! > 0 ? count : undefined;
    try {
      const lines = manager.readLogFile(id, filename, safeCount);
      res.json({ filename, lines });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('Invalid log file name')) {
        sendError(res, 400, 'FILE_PATH_INVALID', msg);
        return;
      }
      if (msg.includes('not found')) {
        sendError(res, 404, 'FILE_NOT_FOUND', msg);
        return;
      }
      logger.error({ err: msg }, 'read log file failed');
      sendError(res, 500, 'DAEMON_INTERNAL_ERROR', 'read log file failed');
    }
  });

  // DELETE /api/instances/:id/log-files/:filename — 删除指定的日志备份文件（仅 server.log.N）
  app.delete('/api/instances/:id/log-files/:filename', authMiddleware, (req: Request, res: Response) => {
    const id = req.params.id;
    const filename = req.params.filename;
    try {
      manager.deleteLogFile(id, filename);
      res.status(204).end();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('Invalid log file name')) {
        sendError(res, 400, 'FILE_PATH_INVALID', msg);
        return;
      }
      if (msg.includes('not found')) {
        sendError(res, 404, 'FILE_NOT_FOUND', msg);
        return;
      }
      logger.error({ err: msg }, 'delete log file failed');
      sendError(res, 500, 'DAEMON_INTERNAL_ERROR', 'delete log file failed');
    }
  });

  // GET /api/instances/:id/players — 获取实例的在线玩家列表（由 PlayerTracker 维护）
  // 返回 { players: [{ username, joinedAt }] }；实例未启动过或无玩家时返回空数组
  app.get('/api/instances/:id/players', authMiddleware, (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      const players = manager.getOnlinePlayers(id);
      res.json({ players });
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'get online players failed');
      sendError(res, 500, 'DAEMON_INTERNAL_ERROR', 'get online players failed');
    }
  });

  // POST /api/instances/:id/start — 启动实例（body 内联完整 Pack + 实例参数）
  app.post('/api/instances/:id/start', authMiddleware, async (req: Request, res: Response) => {
    const id = req.params.id;
    const body = req.body as StartRequestBody;

    // 校验请求体
    if (!body || typeof body !== 'object' || !body.instance || !body.pack) {
      sendError(res, 400, 'DAEMON_INTERNAL_ERROR', 'request body must contain { pack, instance }');
      return;
    }
    const inst = body.instance;
    if (
      typeof inst.name !== 'string' ||
      typeof inst.port !== 'number' ||
      typeof inst.rcon_port !== 'number' ||
      typeof inst.rcon_password !== 'string' ||
      typeof inst.workdir !== 'string'
    ) {
      sendError(res, 400, 'DAEMON_INTERNAL_ERROR', 'instance fields invalid (name/port/rcon_port/rcon_password/workdir required)');
      return;
    }

    // 校验 Pack（zod）
    // v3.8.0: zod 解析返回 GamePackRaw（ui.tabs 允许 string|object），
    //         但 Panel 后端在发送前已用 normalizeUITabs 规范化为对象格式，
    //         且 daemon 内部不消费 ui.tabs 字段，故安全断言为 GamePack。
    let pack: GamePack;
    try {
      pack = GamePackSchema.parse(body.pack) as unknown as GamePack;
    } catch (err) {
      sendError(res, 400, 'DAEMON_INTERNAL_ERROR', `invalid pack: ${(err as Error).message}`);
      return;
    }

    const instance: Instance = {
      id,
      name: inst.name,
      pack_id: pack.pack.id,
      status: 'stopped',
      port: inst.port,
      rcon_port: inst.rcon_port,
      rcon_password: inst.rcon_password,
      workdir: inst.workdir,
      pid: null,
      started_at: null,
    };

    try {
      const pid = await manager.startInstance(instance, pack, makeCallbacks(id));
      const response: StartInstanceResponse = { id, status: 'starting', pid };
      res.json(response);
    } catch (err) {
      if (!handleManagerError(res, err)) {
        logger.error({ err: (err as Error).message }, 'start instance failed');
        sendError(res, 500, 'DAEMON_INTERNAL_ERROR', 'start instance failed');
      }
    }
  });

  // POST /api/instances/:id/stop — 停止实例
  app.post('/api/instances/:id/stop', authMiddleware, async (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      await manager.stopInstance(id);
      const response: StopInstanceResponse = { id, status: 'stopping' };
      res.json(response);
    } catch (err) {
      if (!handleManagerError(res, err)) {
        logger.error({ err: (err as Error).message }, 'stop instance failed');
        sendError(res, 500, 'DAEMON_INTERNAL_ERROR', 'stop instance failed');
      }
    }
  });

  // POST /api/instances/:id/restart-with-save — 带存档重启
  // 停止当前实例 → 以指定 save_path 重新启动，用于实际切换服务器使用的存档
  app.post('/api/instances/:id/restart-with-save', authMiddleware, async (req: Request, res: Response) => {
    const id = req.params.id;
    const body = req.body as Partial<RestartWithSaveRequestBody>;

    if (!body || typeof body.save_path !== 'string' || body.save_path.length === 0) {
      sendError(res, 400, 'DAEMON_INTERNAL_ERROR', 'request body must contain { save_path: string }');
      return;
    }

    try {
      const pid = await manager.restartWithSave(id, body.save_path);
      const response: StartInstanceResponse = { id, status: 'starting', pid };
      res.json(response);
    } catch (err) {
      if (!handleManagerError(res, err)) {
        logger.error({ err: (err as Error).message }, 'restart with save failed');
        sendError(res, 500, 'DAEMON_INTERNAL_ERROR', 'restart with save failed');
      }
    }
  });

  // POST /api/instances/:id/command — 发送命令
  app.post('/api/instances/:id/command', authMiddleware, async (req: Request, res: Response) => {
    const id = req.params.id;
    const body = req.body as CommandRequestBody;
    if (!body || typeof body.command !== 'string') {
      sendError(res, 400, 'DAEMON_INTERNAL_ERROR', 'request body must contain { command: string }');
      return;
    }
    try {
      const output = await manager.sendCommand(id, body.command);
      const response: CommandResponse = { id, output, success: true };
      res.json(response);
    } catch (err) {
      if (!handleManagerError(res, err)) {
        logger.error({ err: (err as Error).message }, 'send command failed');
        sendError(res, 500, 'DAEMON_INTERNAL_ERROR', 'send command failed');
      }
    }
  });

  // POST /api/instances/:id/execute-logic — v4.11.0 卡密/商城发货沙箱入口
  //
  // 接收原始 logicString（含 {Var} 单花括号占位符）与 variables 映射，委托给
  // InstanceManager.executeLogic → ExecutionEngine.executeLogic 在沙箱内完成：
  //   1. 变量替换（{Var} → variables[Var]）
  //   2. 正则白名单校验（防 RCON 注入：拦截分号、管道符等 shell 元字符）
  //   3. 通过 IInstanceCommandSender 适配器调用 sendRawCommand 投递到游戏进程
  //
  // 与 /command 的区别：/command 接收 Panel 侧已渲染的命令字符串；
  // /execute-logic 接收原始模板 + 变量，由 daemon 沙箱完成替换与校验。
  //
  // 错误映射：
  //   - InstanceNotFoundError → 404 INSTANCE_NOT_FOUND
  //   - InstanceNotRunningError → 409 INSTANCE_NOT_RUNNING
  //   - CommandFailedError（含 ERR_RCON_INJECTION）→ 400 RCON_INJECTION_BLOCKED
  //   - 其他 → 500 DAEMON_INTERNAL_ERROR
  app.post('/api/instances/:id/execute-logic', authMiddleware, async (req: Request, res: Response) => {
    const id = req.params.id;
    const body = req.body as Partial<ExecuteLogicRequestBody>;
    if (
      !body ||
      typeof body.logic_string !== 'string' ||
      body.logic_string.length === 0 ||
      typeof body.variables !== 'object' ||
      body.variables === null ||
      Array.isArray(body.variables)
    ) {
      sendError(
        res,
        400,
        'DAEMON_INTERNAL_ERROR',
        'request body must contain { logic_string: string, variables: Record<string, string> }',
      );
      return;
    }
    // variables 值类型校验：所有值必须为 string
    const variables = body.variables as Record<string, unknown>;
    for (const [key, value] of Object.entries(variables)) {
      if (typeof value !== 'string') {
        sendError(
          res,
          400,
          'DAEMON_INTERNAL_ERROR',
          `variables.${key} must be string, got ${typeof value}`,
        );
        return;
      }
    }
    try {
      const success = await manager.executeLogic(
        id,
        body.logic_string,
        body.variables as Record<string, string>,
      );
      res.json({ id, success });
    } catch (err) {
      if (err instanceof CommandFailedError) {
        const msg = err.message;
        // 沙箱注入拦截 → 400（客户端参数问题，非服务端故障）
        if (msg.includes('RCON injection') || msg.includes('ERR_RCON_INJECTION')) {
          sendError(res, 400, 'COMMAND_FAILED', `RCON injection blocked: ${msg}`);
          return;
        }
        // 沙箱未初始化或投递失败 → 500
        logger.error({ err: msg, instance_id: id, logic_string: body.logic_string }, 'execute logic failed (sandbox)');
        sendError(res, 500, 'COMMAND_FAILED', msg);
        return;
      }
      if (!handleManagerError(res, err)) {
        logger.error({ err: (err as Error).message, instance_id: id }, 'execute logic failed');
        sendError(res, 500, 'DAEMON_INTERNAL_ERROR', 'execute logic failed');
      }
    }
  });

  // ----- Task 3.5 新增：文件操作与命令执行路由 -----

  // POST /api/instances/:id/exec — 在实例 workdir 下执行任意二进制命令
  // 兼容未启动实例：通过 resolveInstanceWorkdir 兜底创建 workdir（curl 下载、版本查询等
  // 命令不依赖实例运行状态，只需要 workdir 作为 cwd）
  app.post('/api/instances/:id/exec', authMiddleware, async (req: Request, res: Response) => {
    const id = req.params.id;
    const workdir = resolveInstanceWorkdir(manager, id);

    const body = req.body as Partial<ExecCommandRequest>;
    if (!body || typeof body.binary !== 'string' || !Array.isArray(body.args)) {
      sendError(res, 400, 'DAEMON_INTERNAL_ERROR', 'request body must contain { binary: string, args: string[] }');
      return;
    }
    // args 元素类型校验
    if (!body.args.every((a) => typeof a === 'string')) {
      sendError(res, 400, 'DAEMON_INTERNAL_ERROR', 'args must be array of strings');
      return;
    }

    try {
      const result = await runnerExecCommand(
        workdir,
        body.binary,
        body.args,
        body.env,
        body.timeout,
      );
      const response: ExecCommandResponse = {
        exit_code: result.exit_code,
        stdout: result.stdout,
        stderr: result.stderr,
        duration_ms: result.duration_ms,
        timed_out: result.timed_out,
      };
      res.json(response);
    } catch (err) {
      if (err instanceof CwdInvalidError) {
        sendError(res, 400, 'FILE_PATH_INVALID', err.message);
        return;
      }
      if (err instanceof ExecTimeoutError) {
        sendError(res, 504, 'EXEC_TIMEOUT', err.message);
        return;
      }
      if (err instanceof ExecCommandFailedError) {
        sendError(res, 500, 'EXEC_COMMAND_FAILED', err.message);
        return;
      }
      logger.error({ err: (err as Error).message }, 'exec command failed');
      sendError(res, 500, 'DAEMON_INTERNAL_ERROR', 'exec command failed');
    }
  });

  // GET /api/instances/:id/files?path=<relPath> — 读取实例 workdir 下的文件
  // 兼容未启动实例：通过 resolveInstanceWorkdir 兜底创建 workdir
  app.get('/api/instances/:id/files', authMiddleware, async (req: Request, res: Response) => {
    const id = req.params.id;
    const workdir = resolveInstanceWorkdir(manager, id);

    const relPath = req.query.path;
    if (typeof relPath !== 'string' || relPath.length === 0) {
      sendError(res, 400, 'FILE_PATH_INVALID', 'query parameter "path" is required');
      return;
    }

    try {
      const result = await fileManagerReadFile(workdir, relPath);
      const response: FileReadResponse = {
        path: result.path,
        content: result.content,
        size: result.size,
        modified_at: result.modified_at,
      };
      res.json(response);
    } catch (err) {
      if (err instanceof FilePathInvalidError) {
        sendError(res, 400, 'FILE_PATH_INVALID', err.message);
        return;
      }
      if (err instanceof FileNotFoundError) {
        sendError(res, 404, 'FILE_NOT_FOUND', err.message);
        return;
      }
      logger.error({ err: (err as Error).message }, 'read file failed');
      sendError(res, 500, 'DAEMON_INTERNAL_ERROR', 'read file failed');
    }
  });

  // PUT /api/instances/:id/files?path=<relPath> — 写入实例 workdir 下的文件
  // 兼容未启动实例：通过 resolveInstanceWorkdir 兜底创建 workdir
  app.put('/api/instances/:id/files', authMiddleware, async (req: Request, res: Response) => {
    const id = req.params.id;
    const workdir = resolveInstanceWorkdir(manager, id);

    const relPath = req.query.path;
    if (typeof relPath !== 'string' || relPath.length === 0) {
      sendError(res, 400, 'FILE_PATH_INVALID', 'query parameter "path" is required');
      return;
    }

    const body = req.body as Partial<FileWriteRequest>;
    if (!body || typeof body.content !== 'string') {
      sendError(res, 400, 'DAEMON_INTERNAL_ERROR', 'request body must contain { content: string }');
      return;
    }
    const encoding = body.encoding === 'base64' ? 'base64' : 'utf-8';

    try {
      const result = await fileManagerWriteFile(workdir, relPath, body.content, encoding);
      const response: FileWriteResponse = {
        path: result.path,
        size: result.size,
        modified_at: result.modified_at,
      };
      res.json(response);
    } catch (err) {
      if (err instanceof FilePathInvalidError) {
        sendError(res, 400, 'FILE_PATH_INVALID', err.message);
        return;
      }
      logger.error({ err: (err as Error).message }, 'write file failed');
      sendError(res, 500, 'DAEMON_INTERNAL_ERROR', 'write file failed');
    }
  });

  // ==========================================================================
  // v4.3.0 新增：文件管理扩展端点
  // ==========================================================================

  // GET /api/instances/:id/files/list?path=<relPath>&recursive=1 — 列出目录内容
  app.get('/api/instances/:id/files/list', authMiddleware, async (req: Request, res: Response) => {
    const id = req.params.id;
    const workdir = resolveInstanceWorkdir(manager, id);

    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    const recursive = req.query.recursive === '1' || req.query.recursive === 'true';

    try {
      const result = await fileManagerListDir(workdir, relPath, recursive);
      res.json(result);
    } catch (err) {
      if (err instanceof FilePathInvalidError) {
        sendError(res, 400, 'FILE_PATH_INVALID', err.message);
        return;
      }
      if (err instanceof FileNotFoundError) {
        sendError(res, 404, 'FILE_NOT_FOUND', err.message);
        return;
      }
      logger.error({ err: (err as Error).message }, 'list dir failed');
      sendError(res, 500, 'DAEMON_INTERNAL_ERROR', 'list dir failed');
    }
  });

  // POST /api/instances/:id/mods/files/:name/toggle — 切换 mod 启用状态
  // v4.33.0: 支持 ?dir=<modsDir> 指定 mod 目录（默认 mods）
  app.post('/api/instances/:id/mods/files/:name/toggle', authMiddleware, async (req: Request, res: Response) => {
    const id = req.params.id;
    const workdir = resolveInstanceWorkdir(manager, id);
    const modName = req.params.name;
    const modsDir = (req.query.dir as string) || 'mods';

    try {
      const result = await fileManagerToggleMod(workdir, modName, { modsDir });
      res.json(result);
    } catch (err) {
      if (err instanceof FilePathInvalidError) {
        sendError(res, 400, 'FILE_PATH_INVALID', err.message);
        return;
      }
      if (err instanceof FileNotFoundError) {
        sendError(res, 404, 'FILE_NOT_FOUND', err.message);
        return;
      }
      // mod 文件名不符合规则 → 400
      if (err instanceof Error && err.message.includes('mod 文件名必须')) {
        sendError(res, 400, 'MOD_FILE_STATE_INVALID', err.message);
        return;
      }
      logger.error({ err: (err as Error).message }, 'toggle mod failed');
      sendError(res, 500, 'DAEMON_INTERNAL_ERROR', 'toggle mod failed');
    }
  });

  // L4 GET /api/instances/:id/mods/scan — 扫描实例 mods 目录所有 mod 的元数据
  // v4.33.0: 支持 ?dir=<modsDir>&ext=<.jar,.zip>&game=<gameType> 多游戏参数
  // 鉴权：authMiddleware（仅 Panel 可调用）
  app.get('/api/instances/:id/mods/scan', authMiddleware, async (req: Request, res: Response) => {
    const id = req.params.id;
    const workdir = resolveInstanceWorkdir(manager, id);
    const dir = (req.query.dir as string) || 'mods';
    const gameType = (req.query.game as string) || undefined;
    let fileExtensions: string[] | undefined;
    if (typeof req.query.ext === 'string') {
      fileExtensions = req.query.ext.split(',').map((e) => e.trim()).filter(Boolean);
    }
    const modsDir = path.join(workdir, dir);

    try {
      const mods: ModMetadata[] = await scanModsDir(modsDir, { fileExtensions, gameType });
      res.json({ mods });
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'scan mods failed');
      sendError(res, 500, 'DAEMON_INTERNAL_ERROR', 'scan mods failed');
    }
  });

  // v4.4.0-M1 GET /api/env/javas — 扫描系统中可用的 Java 安装
  // 鉴权：authMiddleware（仅 Panel 可调用）
  // 用途：Panel 在创建 Minecraft 实例前查询可用 Java 版本，匹配实例兼容性
  app.get('/api/env/javas', authMiddleware, async (_req: Request, res: Response) => {
    try {
      const result: ScanJavasResult = await scanJavas();
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'java scan failed');
      sendError(res, 500, 'DAEMON_INTERNAL_ERROR', `java scan failed: ${message}`);
    }
  });

  // 统一错误处理（JSON 响应，避免 Express 默认 HTML 错误页）
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: err.message }, 'unhandled request error');
    sendError(res, 500, 'DAEMON_INTERNAL_ERROR', 'internal server error');
  });

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // A4: WebSocket Server 错误处理 — 连接级异常降级不传播为未捕获异常
  wss.on('error', (err: Error) => {
    logger.error({ err: err.message }, 'websocket server error');
  });

  wss.on('connection', (ws: WebSocket, req) => {
    // WS 鉴权：open 事件已触发，必须等 close 事件确认鉴权拒绝
    if (!handleWsAuth(ws, req, logger)) {
      return;
    }

    // 鉴权通过：发送 connected 事件
    const connectedEvent: ConnectedEvent = {
      type: 'connected',
      timestamp: new Date().toISOString(),
      daemon_id: config.daemonId,
      daemon_version: config.daemonVersion,
    };
    ws.send(JSON.stringify(connectedEvent));

    ws.on('message', (data: RawData) => {
      let msg: PanelToDaemonCommand;
      try {
        msg = JSON.parse(data.toString()) as PanelToDaemonCommand;
      } catch (err) {
        logger.warn({ err: String(err) }, 'ws message parse error');
        return;
      }

      if (msg.type === 'subscribe') {
        subscribe(msg.instance_id, ws);
        logger.info({ instance_id: msg.instance_id }, 'ws client subscribed');
      } else if (msg.type === 'unsubscribe') {
        // v4.4.0-N1: 取消单个实例订阅（不关闭 WS 连接）
        unsubscribe(msg.instance_id, ws);
        logger.info({ instance_id: msg.instance_id }, 'ws client unsubscribed');
      } else {
        // v4.4.0-N1: PanelToDaemonCommand 现在为 'subscribe' | 'unsubscribe' 联合类型，
        // else 分支仅由 JSON.parse 后类型断言失败的非法消息触发；cast 为 string 用于日志
        logger.warn({ type: String((msg as { type?: unknown }).type) }, 'unknown ws command type');
      }
    });

    ws.on('close', () => {
      removeAllSubscriptions(ws);
      logger.info('ws client disconnected');
    });
  });

  // A7: 返回服务端实例 + 优雅关闭方法（先清理子进程，再由调用方关闭连接）
  return {
    server: httpServer,
    shutdown: async () => {
      await manager.shutdownAll();
    },
  };
}
