// ============================================================================
// 模块4_Daemon实例管理 — InstanceManager
// 依据：daemon/src/instances/AGENTS.md §模块专属约束 1~7
// 职责：内存实例表 + spawn 生命周期 + stdout/stderr 转发 + 就绪检测 + 命令派发
// ============================================================================

import type { Logger } from 'pino';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { GamePack } from '@public/schema/pack-schema';
import type { InstanceState, InstanceSummary } from '@public/schema/daemon-api-types';
import { ProcessDriver } from './processDriver.js';
import { ReadyMatcher } from './readiness.js';
import { assertTransition } from './stateMachine.js';
import { InstanceLogWriter, type LogFileInfo } from './logWriter.js';
import { PlayerTracker, type OnlinePlayer } from './playerTracker.js';
// v4.13.0 步骤18b: 玩家会话上报器（写入 player_sessions 表，防假闭合）
import { PlayerSessionReporter } from '../playerSessionReporter.js';
import {
  type Instance,
  type StartConfig,
  InstanceNotFoundError,
  InstanceAlreadyRunningError,
  InstanceNotRunningError,
  CommandFailedError,
} from './types.js';
import { ProtocolFactory } from '../protocol/factory.js';
import type { InstanceContext } from '../protocol/types.js';
import { bootstrapInstance, BootstrapError } from './bootstrap.js';
import { getSignalStopStrategy } from './game-type-registry.js';
import { DEFAULT_RESTART_POLICY, calculateDelay } from './restartPolicy.js';
import type { MonitorService } from '../monitoring/service.js';
// v4.11.0: RCON 防注入沙箱引擎（孤岛代码接入主路径）
import { ExecutionEngine } from '../modules/execution_engine/ExecutionEngine.js';
// 触发所有 adapter 注册（side-effect import）
// 确保 manager 在测试（bootstrap.ts 被 mock）中也能查询到 signalStop 策略
import './adapters/index.js';

/** A12: 重启成功后稳定窗口时长（毫秒），窗口内不清零重启计数。 */
const RESTART_STABLE_WINDOW_MS = 30000;
/** A2: 崩溃熔断窗口时长（毫秒）— 5 分钟内崩溃超阈值则放弃自动重启。 */
const CRASH_CIRCUIT_WINDOW_MS = 5 * 60 * 1000;
/** A2: 崩溃熔断阈值 — 窗口内崩溃次数达到此值则放弃自动重启。 */
const CRASH_CIRCUIT_THRESHOLD = 5;

/** B8: 在公共契约基础上扩展运行时字段（不修改 public/ 契约）。 */
type InstanceSummaryWithUptime = InstanceSummary & { uptime: number };

/**
 * 实例事件回调：由 server.ts 注入，将事件转推给已订阅的 WS 客户端。
 * - onConsole：stdout/stderr 每一行 → console.output 事件
 * - onStateChange：状态机转换 → state.change 事件
 * - onStarted：就绪检测命中 → instance.started 事件
 * - onStopped：进程退出 → instance.stopped 事件
 */
export interface InstanceEventCallbacks {
  onConsole: (line: string, stream: 'stdout' | 'stderr') => void;
  onStateChange: (from: InstanceState, to: InstanceState) => void;
  onStarted: (pid: number) => void;
  onStopped: (exitCode: number | null) => void;
}

/** 内部受管实例记录：实例对象 + 关联 Pack + 事件回调。 */
interface ManagedInstance {
  instance: Instance;
  pack: GamePack;
  callbacks: InstanceEventCallbacks;
}

/**
 * A1: 三段式进程退出判定标志。
 * MSLX 借鉴：IsProcessExited + IsStdoutClosed + IsStderrClosed 三标志全 true 才触发退出处理。
 * 避免 Java 子进程"半死"状态（exit 已触发但 stdout/stderr 未关闭）导致的过早 finalizeExit
 * 与重复重启。hasTriggeredExit 防止 exit / stdout close / stderr close 并发到达时的重复触发。
 */
interface ExitFlags {
  isProcessExited: boolean;
  isStdoutClosed: boolean;
  isStderrClosed: boolean;
  hasTriggeredExit: boolean;
  exitCode: number | null;
  isManualStop: boolean;
}

/** P0 单机模式，RCON 连接固定走本地回环。 */
const RCON_HOST = '127.0.0.1';

/**
 * v4.11.0: 沙箱占位符检测正则 — 匹配 {Var} 单花括号占位符，排除 {{var}} 双花括号。
 *
 * 双花括号 {{var}} 是 panel/daemon startup 模板格式（由 renderTemplate 渲染），
 * 单花括号 {Var} 是 ExecutionEngine 的自定义指令占位符格式。
 * 通过 lookbehind/lookahead 排除双花括号，避免误伤 startup 模板命令。
 * 仅当命令含 {Var} 单花括号占位符时，才走 ExecutionEngine 沙箱校验路径。
 */
const SANDBOX_PLACEHOLDER_RE = /(?<!\{)\{[A-Za-z_][A-Za-z0-9_]*\}(?!\})/;

/**
 * 将模板字符串中的 {{var}} 替换为 vars 中的值。
 * 未在 vars 中声明的变量保持原样（便于排查）。
 */
function renderTemplate(str: string, vars: Readonly<Record<string, string>>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}

/**
 * InstanceManager — 实例生命周期编排器。
 *
 * 线程模型：所有方法同步操作内存表；进程事件（stdout/exit）通过 Node 事件循环异步触发回调。
 * 一个实例在同一时刻只允许一个活跃进程；停止后实例记录保留以便查询状态与重启。
 */
export class InstanceManager {
  private readonly managed = new Map<string, ManagedInstance>();
  private readonly processDriver = new ProcessDriver();
  private readonly logger: Logger;
  /** 实例ID → 当前重启次数（重启成功后清零） */
  private readonly restartAttempts = new Map<string, number>();
  /** 实例ID → 重启定时器（用于在延迟期间取消重启） */
  private readonly restartTimers = new Map<string, NodeJS.Timeout>();
  /** 主动停止中的实例ID集合（exit 处理时据此跳过自动重启） */
  private readonly stoppingManually = new Set<string>();
  /** 实例ID → 日志写入器（持久化 stdout/stderr 到文件，支持轮转） */
  private readonly logWriters = new Map<string, InstanceLogWriter>();
  /** 监控服务（可选注入）：就绪后开启主动采集，进程退出后停止 */
  private monitorService?: MonitorService;
  /** v4.11.0: RCON 防注入沙箱引擎（可选注入）：含 {Var} 占位符的自定义指令走沙箱校验 */
  private executionEngine: ExecutionEngine | null = null;
  /** A11: 实例ID → 当前生命周期操作 Promise（互斥锁，防止并发 start/stop/restart） */
  private readonly lifecycleLocks = new Map<string, Promise<unknown>>();
  /** B7: 实例ID → 自动重启开关（未设置时默认开启） */
  private readonly autoRestartEnabled = new Map<string, boolean>();
  /** A12: 实例ID → 重启稳定窗口定时器（30s 后清零 restartAttempts） */
  private readonly restartStableTimers = new Map<string, NodeJS.Timeout>();
  /** A1: 实例ID → 三段退出判定标志（exit + stdout close + stderr close 三者全 true 才 finalizeExit） */
  private readonly exitFlags = new Map<string, ExitFlags>();
  /** A2: 实例ID → 近期崩溃时间戳数组（用于崩溃熔断判定，5min 窗口内 ≥5 次则放弃重启） */
  private readonly crashHistory = new Map<string, number[]>();
  /** 在线玩家追踪器：实例ID → 在线玩家列表（join/leave 事件驱动） */
  private readonly playerTracker = new PlayerTracker();
  /** v4.13.0 步骤18b: 玩家会话上报器（fire-and-forget 上报到 Panel，未配置环境变量时降级为 no-op） */
  private readonly playerSessionReporter: PlayerSessionReporter;
  /** 实例ID → join 正则（来自 Pack event_parsers.join.pattern），缓存避免每次解析 */
  private readonly joinMatchers = new Map<string, RegExp>();
  /** 实例ID → leave 正则（来自 Pack event_parsers.leave.pattern），缓存避免每次解析 */
  private readonly leaveMatchers = new Map<string, RegExp>();

  constructor(logger: Logger) {
    this.logger = logger;
    // v4.13.0 步骤18b: 初始化玩家会话上报器（未配置 PANEL_API_URL/DAEMON_REPORT_KEY 时降级为 no-op）
    this.playerSessionReporter = new PlayerSessionReporter(logger);
  }

  /** 注入监控服务（setter 注入，避免改动既有构造签名）。 */
  setMonitorService(service: MonitorService): void {
    this.monitorService = service;
  }

  /**
   * v4.11.0: 注入 RCON 防注入沙箱引擎（setter 注入，避免改动既有构造签名）。
   *
   * 注入后，sendCommand 收到含 {Var} 单花括号占位符的自定义指令时，
   * 会委托给 ExecutionEngine.executeLogic 做变量替换 + 正则白名单校验，
   * 校验通过才投递到游戏进程；不含占位符的普通指令走原路径不变。
   */
  setExecutionEngine(engine: ExecutionEngine): void {
    this.executionEngine = engine;
  }

  /**
   * A3: 穿透子进程监控 — 代理 processDriver.getChildProcessPids。
   * 供 MonitorService 在采集时获取进程树全量 PID，穿透 bash/cmd wrapper 找到真正的游戏进程。
   */
  getChildProcessPids(pid: number): Promise<number[]> {
    return this.processDriver.getChildProcessPids(pid);
  }

  /** 列出所有已注册实例的摘要（含 B8 uptime 字段）。 */
  listSummaries(): InstanceSummaryWithUptime[] {
    const summaries: InstanceSummaryWithUptime[] = [];
    for (const { instance } of this.managed.values()) {
      summaries.push({
        id: instance.id,
        name: instance.name,
        pack_id: instance.pack_id,
        status: instance.status,
        port: instance.port,
        rcon_port: instance.rcon_port,
        // B8: 运行时长（秒），running/starting/stopping 状态下计算
        uptime: this.computeUptime(instance),
      });
    }
    return summaries;
  }

  /** B8: 计算实例运行时长（秒）。未启动或非运行态返回 0。 */
  private computeUptime(instance: Instance): number {
    if (!instance.started_at) return 0;
    if (instance.status !== 'running' && instance.status !== 'starting' && instance.status !== 'stopping') {
      return 0;
    }
    const startedMs = new Date(instance.started_at).getTime();
    return Math.floor((Date.now() - startedMs) / 1000);
  }

  /** 获取实例对象（不存在返回 undefined）。 */
  getInstance(id: string): Instance | undefined {
    return this.managed.get(id)?.instance;
  }

  /** 获取实例状态，不存在抛 InstanceNotFoundError。 */
  getState(id: string): InstanceState {
    const record = this.managed.get(id);
    if (!record) {
      throw new InstanceNotFoundError(id);
    }
    return record.instance.status;
  }

  /**
   * 启动实例：spawn 进程 → 监听输出 → 就绪检测 → 连接协议。
   * A11: 生命周期互斥锁保护，防止并发 start/stop/restart。
   * @param options.savePath 可选，覆盖默认存档路径（用于带存档重启）
   * @returns spawn 后的 pid
   */
  async startInstance(
    instance: Instance,
    pack: GamePack,
    callbacks: InstanceEventCallbacks,
    options?: { savePath?: string },
  ): Promise<number> {
    return this.withLifecycleLock(instance.id, () =>
      this.doStart(instance, pack, callbacks, options),
    );
  }

  /** startInstance 内部实现（无锁，供 restartWithSave 复用）。 */
  private async doStart(
    instance: Instance,
    pack: GamePack,
    callbacks: InstanceEventCallbacks,
    options?: { savePath?: string },
  ): Promise<number> {
    const existing = this.managed.get(instance.id);
    if (existing && (existing.instance.status === 'running' || existing.instance.status === 'starting')) {
      throw new InstanceAlreadyRunningError(instance.id);
    }

    // 注册/覆盖实例记录（初始状态 stopped，bootstrap 完成后才转 starting）
    const record: ManagedInstance = { instance, pack, callbacks };
    this.managed.set(instance.id, record);

    // 1. Bootstrap：创建 workdir + 下载二进制 + 写配置文件
    //    失败 → 状态保持 stopped，直接抛错（spawn 不可继续，下次重试无需先 stop）
    try {
      await bootstrapInstance({ instance, pack, logger: this.logger });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error({ instance_id: instance.id, err: msg }, 'bootstrap failed');
      throw new BootstrapError(`实例 ${instance.id} bootstrap 失败: ${msg}`, err);
    }

    // 2. 状态机：stopped → starting
    this.transition(instance, 'starting');

    // 3. 渲染启动参数模板（补全所有 Pack 可能引用的变量）
    // v4.1.0：新增 instance_root_abs / world_name / cluster_name / server_password 等变量，
    //       覆盖 dst / terraria / valheim / zomboid / enshrouded / satisfactory 等 pack 的需求
    const safeInstanceName = instance.name.replace(/\s+/g, '_');
    const vars: Record<string, string> = {
      instance_root: instance.workdir,
      // v4.1.0 新增：绝对路径版本（SteamCMD install_command 等需要绝对路径）
      instance_root_abs: path.resolve(instance.workdir),
      jvm_xmx: pack.resources?.recommended_ram ?? '2G',
      jvm_xms: pack.resources?.min_ram ?? '1G',
      // 端口与 RCON
      game_port: String(instance.port),
      rcon_port: String(instance.rcon_port),
      rcon_password: instance.rcon_password,
      // 服务器身份
      server_name: instance.name,
      server_hostname: instance.name,
      server_identity: instance.id,
      // 存档与配置目录（options.savePath 覆盖默认路径，用于带存档重启）
      save_path: options?.savePath ?? `${instance.workdir}/saves/world`,
      config_dir: `${instance.workdir}/config`,
      // 通用参数
      max_players: '20',
      // v4.1.0 新增变量
      server_password: instance.rcon_password,             // 服务器加入密码（Valheim/Enshrouded 必填）
      world_name: safeInstanceName,                        // 世界名（Valheim 影响存档文件名）
      cluster_name: safeInstanceName,                      // DST 集群名
      shard_name: 'Master',                                // DST shard 名（v4.1.0 仅 Master）
      game_mode: 'survival',                               // DST 游戏模式
      pvp: 'false',                                        // DST PvP 开关
      tick_rate: '60',                                     // DST 网络 tick
      klei_cluster_token: '__REPLACE_WITH_YOUR_KLEI_TOKEN__', // DST token 占位（启动前需替换）
      world_path: `${instance.workdir}/Worlds`,            // Terraria 世界路径
      motd: 'Welcome to GameServer Panel',                 // Terraria MOTD
      autocreate: '2',                                     // Terraria 自动建图尺寸（中型）
      admin_password: instance.rcon_password,              // PZ admin 密码
      server_dir: `${instance.workdir}/FactoryGame/Saved`, // Satisfactory server dir
      beacon_port: String(instance.port + 1),              // Satisfactory beacon 端口
      query_port: String(instance.port + 2),               // Satisfactory query 端口
      game_port_plus_one: String(instance.port + 1),       // Enshrouded query 端口
      game_port_plus_two: String(instance.port + 2),       // 通用 port+2
      // v4.13.1（2026-07-29）：ARK 默认地图（用户未完成 startup_guide 时兜底）
      map: 'TheIsland',
    };
    const startConfig: StartConfig = {
      binary: pack.startup.binary,
      args: pack.startup.args.map((a) => renderTemplate(a, vars)),
      workingDir: renderTemplate(pack.startup.working_dir, vars),
    };

    // A10: 启动前置环境检查（二进制是否存在/有执行权限）
    this.checkBinaryEnvironment(startConfig.binary);

    // 4. spawn 进程（A1: 传入 error 回调，spawn 失败时转为实例状态 error 而非进程崩溃）
    const { process: child, pid } = this.processDriver.start(startConfig, (err) => {
      this.logger.error({ instance_id: instance.id, err: err.message }, 'spawn failed');
      // A2: spawn 错误 → 实例状态转 error + 清理
      instance.process = undefined;
      instance.pid = null;
      try {
        this.logWriters.get(instance.id)?.close();
      } catch {
        // A5: fs 错误边界，忽略日志关闭失败
      }
      if (instance.status === 'starting' || instance.status === 'running') {
        this.transition(instance, 'error');
      }
      callbacks.onStopped(null);
    });
    instance.process = child;
    instance.pid = pid;
    instance.started_at = new Date().toISOString();
    instance.readyMatcher = new ReadyMatcher(pack.startup.ready_pattern);
    this.logger.info({ instance_id: instance.id, pid }, 'instance process spawned');

    // 5. 初始化日志写入器：复用已存在 writer（重启场景），重新打开追加流
    //    A5: fs 操作增加 try-catch 错误边界
    let logWriter = this.logWriters.get(instance.id);
    if (!logWriter) {
      logWriter = new InstanceLogWriter(instance.workdir);
      this.logWriters.set(instance.id, logWriter);
    }
    try {
      await logWriter.init();
    } catch (err) {
      this.logger.warn({ instance_id: instance.id, err: String(err) }, 'log writer init failed, continuing without file logging');
    }

    // 6. 绑定 stdio / exit 事件
    this.attachProcessHandlers(record, child);

    // 7. 解析 Pack event_parsers 编译 join/leave 正则，缓存到实例
    this.compileEventParsers(record);

    return pid;
  }

  /**
   * 编译 Pack event_parsers 中的 join/leave 正则并缓存到实例 ID。
   * 正则编译失败时仅记录警告，不影响实例启动。
   */
  private compileEventParsers(record: ManagedInstance): void {
    const { instance, pack } = record;
    const parsers = pack.event_parsers;
    if (parsers?.join?.pattern) {
      try {
        this.joinMatchers.set(instance.id, new RegExp(parsers.join.pattern));
      } catch (err) {
        this.logger.warn(
          { instance_id: instance.id, pattern: parsers.join.pattern, err: String(err) },
          'event_parsers.join.pattern 编译失败，跳过玩家加入解析',
        );
      }
    }
    if (parsers?.leave?.pattern) {
      try {
        this.leaveMatchers.set(instance.id, new RegExp(parsers.leave.pattern));
      } catch (err) {
        this.logger.warn(
          { instance_id: instance.id, pattern: parsers.leave.pattern, err: String(err) },
          'event_parsers.leave.pattern 编译失败，跳过玩家离开解析',
        );
      }
    }
  }

  /**
   * A10: 检查二进制文件是否存在且有执行权限。
   * - 绝对路径：直接检查文件是否存在 + X_OK
   * - 命令名（如 java）：在 PATH 中查找
   * 检查失败抛出明确错误，阻止 spawn 触发 ENOENT 崩溃。
   */
  private checkBinaryEnvironment(binary: string): void {
    if (path.isAbsolute(binary)) {
      try {
        fs.accessSync(binary, fs.constants.X_OK);
      } catch {
        throw new Error(`二进制文件不存在或无执行权限: ${binary}`);
      }
      return;
    }
    // 命令名：在 PATH 各目录中查找可执行文件
    const paths = process.env.PATH?.split(':') ?? [];
    const found = paths.some((p) => {
      try {
        fs.accessSync(path.join(p, binary), fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
    if (!found) {
      throw new Error(`二进制命令未找到或无执行权限: ${binary}（请确认已安装并在 PATH 中）`);
    }
  }

  /**
   * A11: 生命周期互斥锁包装器。
   * 同一实例的 start/stop/restart 操作互斥，并发调用抛出错误。
   * 内部方法（doStart/doStop/doRestartWithSave）不加锁，供 restartWithSave 复用。
   */
  private async withLifecycleLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.lifecycleLocks.get(id);
    if (existing) {
      throw new Error(`实例 ${id} 生命周期操作正在进行中，请等待完成后再试`);
    }
    const promise = fn();
    this.lifecycleLocks.set(id, promise);
    try {
      return await promise;
    } finally {
      this.lifecycleLocks.delete(id);
    }
  }

  /**
   * 停止实例。A11: 生命周期互斥锁保护。
   *
   * 状态分支处理（严格状态机，见 stateMachine.ts）：
   * - stopped  → 抛 InstanceNotRunningError
   * - stopping → 幂等返回
   * - error    → 进程已退出，直接 error→stopped（人工恢复）
   * - running  → running→stopping，走正常停止流程（RCON/stdin stop + 信号升级）
   * - starting → starting→stopping 非法；直接杀进程，exit handler 做 starting→error，
   *              随后此处补做 error→stopped 完成停止语义
   */
  async stopInstance(id: string): Promise<void> {
    return this.withLifecycleLock(id, () => this.doStop(id));
  }

  /** stopInstance 内部实现（无锁，供 restartWithSave 复用）。 */
  private async doStop(id: string): Promise<void> {
    const record = this.managed.get(id);
    if (!record) {
      throw new InstanceNotFoundError(id);
    }
    const { instance, pack } = record;
    const status = instance.status;

    if (status === 'stopped') {
      throw new InstanceNotRunningError(id);
    }

    // 取消任何待重启的定时器（无论后续走哪个分支，主动停止都不应再触发自动重启）
    this.clearRestartTimer(id);
    this.clearRestartStableTimer(id);

    if (status === 'stopping') {
      // 已在停止中，幂等返回
      return;
    }

    // error 态：进程已退出，仅做状态收尾 error→stopped，清零重启计数
    if (status === 'error') {
      this.transition(instance, 'stopped');
      this.restartAttempts.delete(id);
      return;
    }

    // running / starting 态：标记主动停止，exit 处理据此跳过自动重启
    this.stoppingManually.add(id);

    // running 态：合法转 stopping，记录已进入正常停止流程
    // starting 态：starting→stopping 非法，不转换；直接进入杀进程流程，
    //              exit handler 做 starting→error，随后补做 error→stopped
    const isNormalStop = status === 'running';
    if (isNormalStop) {
      this.transition(instance, 'stopping');
    }

    const stopCommand = pack.startup.stop_command;

    // RCON 协议：仅在 running 态（已连接协议）发送停止命令
    if (isNormalStop && pack.protocol.type !== 'stdin' && instance.protocol && stopCommand !== null) {
      try {
        await instance.protocol.send(stopCommand);
      } catch (err) {
        // RCON 连接可能随服务器关闭而断开，忽略错误，继续走进程信号升级链
        this.logger.warn({ instance_id: id, err: String(err) }, 'rcon stop command failed, falling back to signal');
      }
    }

    // 进程信号升级链
    if (instance.process) {
      // running + stdin 协议：写入 stopCommand 走 graceful stop
      // starting 态：服务器未就绪，跳过 stdin 命令，直接走信号升级（SIGTERM→SIGKILL）
      const stdinStopCmd = (isNormalStop && pack.protocol.type === 'stdin') ? stopCommand : null;
      // 通过 game-type-registry 查询停止策略：
      // - 'sigint'：部分 vanilla 游戏不支持 stdin 停止命令，必须通过 SIGINT 信号停止
      //   - Valheim：vanilla 无 RCON，必须 SIGINT（Ctrl+C）触发世界保存后退出
      //   - Enshrouded：Wine 包装，无 stdin 命令通道，必须 SIGINT
      //   - Dyson：Wine + Nebula Mod，无 stdin 命令通道，必须 SIGINT
      // - 'stdin'（默认）：通过 stop_command 走 graceful stop
      const firstSignal: NodeJS.Signals | null = getSignalStopStrategy(pack.pack.game) === 'sigint'
        ? 'SIGINT'
        : null;
      await this.processDriver.stop(
        instance.process,
        pack.startup.stop_timeout,
        stdinStopCmd,
        firstSignal,
      );
    }

    // A1: 进程退出后状态收尾（三段退出判定可能尚未完成 — stdout/stderr close 事件可能延迟触发）
    // doStop 已通过 processDriver.stop 确认进程退出，无需继续等待 stdio close，强制完成三段判定
    // - 三段判定已完成（finalizeExit 已运行）：状态为 stopped（from stopping）或 error（from starting）
    // - 三段判定未完成（stdio close 延迟）：强制完成，调用 finalizeExit
    // - 进程未退出（SIGKILL 无效）：转 error，不强制掩盖异常
    // - starting 态补做 error→stopped（finalizeExit 做 starting→error，此处补做收尾）
    const procExited = instance.process?.exitCode !== null || instance.process?.signalCode !== null;
    if (procExited) {
      // A1: 强制完成三段退出判定（doStop 已确认进程退出，跳过 stdio close 等待）
      const flags = this.exitFlags.get(instance.id);
      if (flags && !flags.hasTriggeredExit) {
        flags.hasTriggeredExit = true;
        this.exitFlags.delete(instance.id);
        this.finalizeExit(record, instance.process?.exitCode ?? null);
        // doStop 是主动停止，清理标记与重启计数（与 checkAndHandleTrueExit 的 isManualStop 分支对应）
        this.stoppingManually.delete(instance.id);
        this.restartAttempts.delete(instance.id);
        this.crashHistory.delete(instance.id);
      }
      // starting 态：finalizeExit 做 starting→error，此处补做 error→stopped
      if (instance.status === 'error') {
        this.transition(instance, 'stopped');
      }
    } else {
      // 进程无法被杀死（僵尸/D状态），转 error 暴露异常而非伪装 stopped
      this.logger.error(
        { instance_id: instance.id },
        'doStop: 进程未能退出（SIGKILL 无效），转入 error 状态',
      );
      // A1: 清理三段退出标志（进程未退出，标志无效）
      this.exitFlags.delete(instance.id);
      if (instance.status === 'stopping' || instance.status === 'starting') {
        this.transition(instance, 'error');
      }
      // 清理 stoppingManually 标记（非正常停止路径，exit handler 不会触发）
      this.stoppingManually.delete(instance.id);
    }
  }

  /**
   * 向实例发送命令，返回响应文本（stdin 协议返回 null）。
   * B9: 发送命令前以 [command] 前缀写入日志流，审计可追溯。
   *
   * v4.11.0: 接入 RCON 防注入沙箱 — 当命令含 {Var} 单花括号占位符（自定义/模板化指令）
   * 且已注入 ExecutionEngine 时，走沙箱校验路径（变量替换 + 正则白名单过滤），
   * 校验通过才投递；不含占位符的普通硬编码指令走原路径不变。
   */
  async sendCommand(id: string, command: string): Promise<string | null> {
    // v4.11.0: 含 {Var} 单花括号占位符的自定义指令走沙箱校验
    if (this.executionEngine && SANDBOX_PLACEHOLDER_RE.test(command)) {
      return this.dispatchViaSandbox(id, command, {});
    }
    return this.sendRawCommand(id, command);
  }

  /**
   * v4.11.0: 玩家购买/兑换触发发货的沙箱入口（供发货链路调用）。
   *
   * 委托给 ExecutionEngine.executeLogic：在沙箱内完成变量替换 + 正则白名单校验 + 投递。
   * 未注入 ExecutionEngine 时抛 CommandFailedError。
   *
   * @throws {CommandFailedError} 沙箱未初始化、注入拦截（ERR_RCON_INJECTION）或投递失败
   */
  async executeLogic(
    id: string,
    logicString: string,
    variables: Record<string, string>,
  ): Promise<boolean> {
    if (!this.executionEngine) {
      throw new CommandFailedError(
        `execution engine not initialized for instance ${id}`,
      );
    }
    return this.dispatchViaSandbox(id, logicString, variables).then(() => true);
  }

  /**
   * v4.11.0: 沙箱投递内部实现 — 调用 ExecutionEngine.executeLogic 并映射错误。
   *
   * ExecutionEngine 内部通过注入的 IInstanceCommandSender 调用 sendRawCommand 投递，
   * 不经过 sendCommand，避免递归。沙箱路径不返回 RCON 响应字符串（返回 null），
   * 因为发货场景只关心投递成功与否（boolean）。
   *
   * 错误映射：
   *   - ERR_RCON_INJECTION → CommandFailedError（注入拦截，含原始命令便于审计）
   *   - ERR_EXECUTION_FAILED → CommandFailedError（投递失败，保留 cause）
   */
  private async dispatchViaSandbox(
    id: string,
    logicString: string,
    variables: Record<string, string>,
  ): Promise<string | null> {
    if (!this.executionEngine) {
      throw new CommandFailedError(
        `execution engine not initialized for instance ${id}`,
      );
    }
    try {
      await this.executionEngine.executeLogic(id, logicString, variables);
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ERR_RCON_INJECTION')) {
        throw new CommandFailedError(
          `RCON injection blocked for instance ${id}: ${logicString}`,
          err,
        );
      }
      // ERR_EXECUTION_FAILED 或其他底层错误
      throw new CommandFailedError(
        `sandbox execution failed for instance ${id}: ${msg}`,
        err,
      );
    }
  }

  /**
   * 底层命令投递（不经过沙箱）— 直接走 instance.protocol.send。
   *
   * v4.11.0: 从 sendCommand 提取，作为 ExecutionEngine 注入的 IInstanceCommandSender
   * 的实现基础（通过 server.ts 的适配器闭包调用），避免沙箱路径递归调用 sendCommand。
   * 同时供 sendCommand 的普通指令路径（不含 {Var} 占位符）直接使用。
   *
   * B9: 发送命令前以 [command] 前缀写入日志流，审计可追溯。
   */
  async sendRawCommand(id: string, command: string): Promise<string | null> {
    const record = this.managed.get(id);
    if (!record) {
      throw new InstanceNotFoundError(id);
    }
    const { instance } = record;
    if (instance.status !== 'running') {
      throw new InstanceNotRunningError(id);
    }
    const protocol = instance.protocol;
    if (!protocol) {
      throw new CommandFailedError(`no command protocol available for instance ${id}`);
    }
    // B9: 记录命令日志，以 [command] 前缀写入日志流
    try {
      this.logWriters.get(id)?.write(`[command] ${command}`, 'stdout');
    } catch {
      // A5: fs 错误边界，忽略日志写入失败
    }
    try {
      return await protocol.send(command);
    } catch (err) {
      throw new CommandFailedError(`command "${command}" failed on instance ${id}`, err);
    }
  }

  /**
   * 带存档重启：停止当前实例 → 以指定 savePath 重新启动。
   * A11: 生命周期互斥锁保护，内部调用 doStop/doStart 避免死锁。
   *
   * 状态分支处理：
   * - running/starting → 先 doStop 等待进程退出，再以新 savePath 启动
   * - stopping         → 等待停止完成后启动（doStop 幂等）
   * - error            → 转 stopped 后直接启动
   * - stopped          → 直接以新 savePath 启动
   *
   * @param id 实例 ID
   * @param savePath 新的存档路径，覆盖启动参数模板中的 {{save_path}}
   * @returns 新进程的 pid
   * @throws {InstanceNotFoundError} 实例未注册
   */
  async restartWithSave(id: string, savePath: string): Promise<number> {
    return this.withLifecycleLock(id, () => this.doRestartWithSave(id, savePath));
  }

  /** restartWithSave 内部实现（无锁）。 */
  private async doRestartWithSave(id: string, savePath: string): Promise<number> {
    const record = this.managed.get(id);
    if (!record) {
      throw new InstanceNotFoundError(id);
    }

    const status = record.instance.status;

    // 1. 停止当前实例（仅在运行/启动中/停止中时执行）
    if (status === 'running' || status === 'starting' || status === 'stopping') {
      await this.doStop(id);
    } else if (status === 'error') {
      // error 态：进程已退出，直接转 stopped 以满足 doStart 的状态机要求
      this.transition(record.instance, 'stopped');
    }
    // stopped 态：无需处理，直接重启

    // 2. 重新启动，传入自定义 save_path 覆盖默认值
    return this.doStart(record.instance, record.pack, record.callbacks, { savePath });
  }

  /**
   * 读取实例历史日志行。
   * @param id 实例 ID
   * @param limit 返回的最大行数（从末尾截取，默认 100）
   * @param offset 从末尾跳过的行数（分页偏移，默认 0）
   * @param filter B10: 不区分大小写的子串过滤，传入则仅返回匹配行
   * @returns 日志行数组；实例未启动过或无日志时返回空数组
   */
  async getInstanceLogs(id: string, limit: number = 100, offset: number = 0, filter?: string): Promise<string[]> {
    const writer = this.logWriters.get(id);
    if (!writer) return [];
    let lines = await writer.readHistory(limit, offset);
    // B10: 不区分大小写的子串过滤
    if (filter) {
      const lower = filter.toLowerCase();
      lines = lines.filter((line) => line.toLowerCase().includes(lower));
    }
    return lines;
  }

  /**
   * B13: 列出实例的所有日志文件（按修改时间倒序）。
   * 实例未启动过（无 logWriter）时返回空数组。
   */
  listLogFiles(id: string): LogFileInfo[] {
    const writer = this.logWriters.get(id);
    if (!writer) return [];
    return writer.listLogFiles();
  }

  /**
   * B13: 读取指定日志文件的最后 count 行。
   * @throws Error 文件名无效或文件不存在
   */
  readLogFile(id: string, filename: string, count?: number): string[] {
    const writer = this.logWriters.get(id);
    if (!writer) return [];
    return writer.readLogFile(filename, count);
  }

  /**
   * B13: 删除指定的日志备份文件（仅允许 server.log.N 格式）。
   * @throws Error 文件名无效或文件不存在
   */
  deleteLogFile(id: string, filename: string): void {
    const writer = this.logWriters.get(id);
    if (!writer) return;
    writer.deleteLogFile(filename);
  }

  /**
   * 解析 stdout/stderr 行，匹配 join/leave 事件并更新 PlayerTracker。
   * 通过缓存的正则 + Pack event_parsers 中声明的捕获组索引提取玩家名。
   * 未声明 event_parsers 或正则未命中时静默跳过。
   */
  private parsePlayerEvents(instanceId: string, line: string): void {
    const joinRe = this.joinMatchers.get(instanceId);
    if (joinRe) {
      const m = joinRe.exec(line);
      if (m && m.length > 1) {
        // 捕获组1 为玩家名（pack-schema 中 player_group 默认为 1）
        const playerName = m[1];
        if (playerName) {
          this.playerTracker.recordJoin(instanceId, playerName);
          // v4.13.0 步骤18b: 异步上报到 Panel player_sessions 表（fire-and-forget，失败不影响主流程）
          this.playerSessionReporter.reportJoin(instanceId, playerName);
        }
        return;
      }
    }
    const leaveRe = this.leaveMatchers.get(instanceId);
    if (leaveRe) {
      const m = leaveRe.exec(line);
      if (m && m.length > 1) {
        const playerName = m[1];
        if (playerName) {
          this.playerTracker.recordLeave(instanceId, playerName);
          // v4.13.0 步骤18b: 异步上报到 Panel player_sessions 表（fire-and-forget，失败不影响主流程）
          this.playerSessionReporter.reportLeave(instanceId, playerName);
        }
      }
    }
  }

  /**
   * 获取实例的在线玩家列表（按加入时间升序）。
   * @returns 在线玩家数组；实例未启动过或无玩家时返回空数组
   */
  getOnlinePlayers(id: string): OnlinePlayer[] {
    return this.playerTracker.getOnlinePlayers(id);
  }

  /** 获取实例的在线玩家数量。 */
  getOnlinePlayerCount(id: string): number {
    return this.playerTracker.getOnlineCount(id);
  }

  // -------------------------------------------------------------------------
  // 内部方法
  // -------------------------------------------------------------------------

  /** 状态机转换 + 回调触发。 */
  private transition(instance: Instance, to: InstanceState): void {
    const record = this.managed.get(instance.id);
    const from = instance.status;
    assertTransition(from, to);
    instance.status = to;
    if (record) {
      record.callbacks.onStateChange(from, to);
    }
  }

  /** 绑定子进程 stdout/stderr/exit 事件。 */
  private attachProcessHandlers(record: ManagedInstance, child: ChildProcess): void {
    const { instance, callbacks } = record;

    // A1: 初始化三段退出判定标志（stdout/stderr 不存在时直接标记为已关闭，防御性处理）
    const flags: ExitFlags = {
      isProcessExited: false,
      isStdoutClosed: !child.stdout,
      isStderrClosed: !child.stderr,
      hasTriggeredExit: false,
      exitCode: null,
      isManualStop: false,
    };
    this.exitFlags.set(instance.id, flags);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    child.stdout?.on('data', (chunk: string) => {
      // Minecraft 按行输出，按 \n 拆分逐行转发
      const lines = chunk.split('\n');
      for (const raw of lines) {
        if (raw.length === 0) continue;
        callbacks.onConsole(raw, 'stdout');
        // 持久化到日志文件
        this.logWriters.get(instance.id)?.write(raw, 'stdout');
        // 玩家 join/leave 解析（仅当 Pack 声明了 event_parsers 时生效）
        this.parsePlayerEvents(instance.id, raw);
        // 就绪检测：仅 starting 状态下匹配，命中即转 running
        if (instance.status === 'starting' && instance.readyMatcher?.match(raw)) {
          this.onReady(record);
        }
      }
    });

    child.stderr?.on('data', (chunk: string) => {
      const lines = chunk.split('\n');
      for (const raw of lines) {
        if (raw.length === 0) continue;
        callbacks.onConsole(raw, 'stderr');
        // 持久化到日志文件
        this.logWriters.get(instance.id)?.write(raw, 'stderr');
        // stderr 也尝试解析玩家事件（部分服务器走 stderr 输出）
        this.parsePlayerEvents(instance.id, raw);
      }
    });

    // A1: stdout/stderr close 事件 — 三段退出判定的第二、三段
    // Java 子进程"半死"时 exit 触发但 stdout/stderr 管道未关闭，需等待两者关闭才可安全 finalizeExit
    child.stdout?.on('close', () => {
      flags.isStdoutClosed = true;
      this.logger.debug({ instance_id: instance.id, stream: 'stdout' }, 'stream closed');
      this.checkAndHandleTrueExit(record);
    });
    child.stderr?.on('close', () => {
      flags.isStderrClosed = true;
      this.logger.debug({ instance_id: instance.id, stream: 'stderr' }, 'stream closed');
      this.checkAndHandleTrueExit(record);
    });

    child.on('exit', (code, signal) => {
      this.logger.info(
        { instance_id: instance.id, code, signal },
        'instance process exited',
      );
      // A1: 三段退出判定 — 第一段（进程退出），仅记录标志，不直接 finalizeExit
      flags.exitCode = code;
      flags.isProcessExited = true;
      flags.isManualStop = this.stoppingManually.has(instance.id);
      this.checkAndHandleTrueExit(record);
    });

    child.on('error', (err) => {
      this.logger.error({ instance_id: instance.id, err: err.message }, 'instance process error');
      // A2: 进程错误处理（幂等 — doStart 的 error 回调可能已转换状态）
      // 仅在 starting/running 态时转 error，避免 error→error 非法转换
      if (instance.status === 'starting' || instance.status === 'running') {
        // A1: spawn 错误 / 运行时管道错误 — 标记已触发退出，跳过三段判定
        // （进程未正常退出或管道已断，等待 stdio close 无意义，直接走 error 清理路径）
        flags.hasTriggeredExit = true;
        this.exitFlags.delete(instance.id);
        instance.process = undefined;
        instance.pid = null;
        try {
          this.logWriters.get(instance.id)?.close();
        } catch {
          // A5: fs 错误边界
        }
        this.transition(instance, 'error');
        callbacks.onStopped(null);
      }
    });
  }

  /**
   * A1: 三段退出判定 — 进程退出 + stdout 关闭 + stderr 关闭三者全 true 才触发最终退出处理。
   * MSLX 借鉴 MCServerService 的 IsProcessExited + IsStdoutClosed + IsStderrClosed 机制。
   * 避免 Java 子进程"半死"状态（exit 已触发但 stdout/stderr 未关闭）导致的过早 finalizeExit
   * 与重复重启。hasTriggeredExit 防止 exit / stdout close / stderr close 并发到达时的重复触发。
   */
  private checkAndHandleTrueExit(record: ManagedInstance): void {
    const flags = this.exitFlags.get(record.instance.id);
    if (!flags || flags.hasTriggeredExit) return;
    if (!(flags.isProcessExited && flags.isStdoutClosed && flags.isStderrClosed)) return;

    flags.hasTriggeredExit = true;
    this.exitFlags.delete(record.instance.id);

    const { instance } = record;
    const code = flags.exitCode;
    const isManualStop = flags.isManualStop;

    this.finalizeExit(record, code);

    if (isManualStop) {
      // 主动停止：清除标记与重启计数，不触发自动重启
      this.stoppingManually.delete(instance.id);
      this.restartAttempts.delete(instance.id);
      this.crashHistory.delete(instance.id);
      return;
    }

    // 崩溃判定：exitCode !== 0 视为崩溃，触发指数退避重启
    if (code !== 0) {
      const attempt = (this.restartAttempts.get(instance.id) ?? 0) + 1;
      this.scheduleRestart(record, attempt);
    } else {
      // 正常退出（exitCode === 0）：清零重启计数，不重启
      this.restartAttempts.delete(instance.id);
    }
  }

  /** 就绪检测命中：starting → running，连接协议，触发 onStarted。 */
  private onReady(record: ManagedInstance): void {
    const { instance, pack, callbacks } = record;
    this.transition(instance, 'running');
    // A12: 重启成功后不立即清零 restartAttempts，等 30 秒稳定窗口后再清零
    // 防止反复崩溃的快速重试循环耗尽重启次数
    this.scheduleRestartAttemptsReset(instance.id);
    const pid = instance.pid ?? 0;
    callbacks.onStarted(pid);

    // 就绪后开启监控主动采集（pid 有效时）
    if (this.monitorService && instance.pid !== null) {
      this.monitorService.startAutoCollection(instance.id, instance.pid);
    }

    // 连接命令协议（RCON 建连；stdin 仅持有进程句柄）
    const ctx = this.buildProtocolContext(pack, instance);
    if (ctx) {
      const protocol = ProtocolFactory.create(pack.protocol, ctx);
      instance.protocol = protocol;
      // RCON 需要异步建连；stdin connect 为空操作
      protocol.connect().catch((err: unknown) => {
        // RCON 建连失败不阻断 running，命令通道降级为不可用（sendCommand 抛错）
        this.logger.warn(
          { instance_id: instance.id, err: String(err) },
          'protocol connect failed; command channel unavailable',
        );
      });
    }
  }

  /** 进程退出收尾：状态转 stopped/error，断开协议，触发 onStopped。 */
  private finalizeExit(record: ManagedInstance, exitCode: number | null): void {
    const { instance, callbacks } = record;
    // 停止监控主动采集（进程已退出，不再有可采集的 pid）
    if (this.monitorService) {
      this.monitorService.stopAutoCollection(instance.id);
    }
    // A12: 清理稳定窗口定时器（进程已退出，无需再清零重启计数）
    this.clearRestartStableTimer(instance.id);
    // 断开协议（best-effort）
    const protocol = instance.protocol;
    instance.protocol = undefined;
    instance.process = undefined;
    instance.pid = null;
    if (protocol) {
      protocol.disconnect().catch((err: unknown) => {
        this.logger.warn({ instance_id: instance.id, err: String(err) }, 'protocol disconnect failed');
      });
    }

    // 关闭日志写入流（保留历史文件，实例重启时重新打开）
    this.logWriters.get(instance.id)?.close();

    // 清理在线玩家追踪状态 + 缓存的事件解析器
    this.playerTracker.clearInstance(instance.id);
    this.joinMatchers.delete(instance.id);
    this.leaveMatchers.delete(instance.id);

    // 状态收尾：stopping → stopped（正常停止）；其他 → error（异常退出）
    if (instance.status === 'stopping') {
      this.transition(instance, 'stopped');
    } else if (instance.status !== 'stopped') {
      // starting/running 时进程退出 = 异常崩溃
      this.transition(instance, 'error');
    }
    callbacks.onStopped(exitCode);
  }

  /**
   * 计划一次崩溃重启：按指数退避延迟后调用 startInstance。
   * 状态转换链：error → stopped（重启前）→ starting → running（或 error）。
   * B7: 检查运行时自动重启开关（未设置时默认开启）。
   * A2: 崩溃熔断 — 5 分钟窗口内崩溃超 5 次则放弃自动重启，防止快速崩溃循环耗尽资源。
   * @param record 受管实例记录
   * @param attempt 本次重启序号（从1开始）
   */
  private scheduleRestart(record: ManagedInstance, attempt: number): void {
    // B7: 运行时自动重启开关检查
    const autoRestart = this.autoRestartEnabled.get(record.instance.id) ?? true;
    if (!autoRestart) {
      this.logger.info(
        { instance_id: record.instance.id },
        'restart: 自动重启已关闭，不触发重启',
      );
      if (record.instance.status !== 'error' && record.instance.status !== 'stopped') {
        this.transition(record.instance, 'error');
      }
      return;
    }

    // A2: 崩溃熔断判定 — 记录本次崩溃时间戳，清理窗口外的旧记录，窗口内超阈值则熔断
    const now = Date.now();
    const history = this.crashHistory.get(record.instance.id) ?? [];
    history.push(now);
    // 清理窗口外的崩溃记录
    const windowStart = now - CRASH_CIRCUIT_WINDOW_MS;
    const recent = history.filter((ts) => ts >= windowStart);
    this.crashHistory.set(record.instance.id, recent);

    if (recent.length > CRASH_CIRCUIT_THRESHOLD) {
      this.logger.error(
        { instance_id: record.instance.id, crashes: recent.length, windowMs: CRASH_CIRCUIT_WINDOW_MS },
        'restart: 崩溃熔断触发（5分钟内崩溃超阈值），放弃自动重启',
      );
      this.crashHistory.delete(record.instance.id);
      if (record.instance.status !== 'error' && record.instance.status !== 'stopped') {
        this.transition(record.instance, 'error');
      }
      return;
    }

    if (attempt > DEFAULT_RESTART_POLICY.maxRestarts) {
      this.logger.error(
        { instance_id: record.instance.id, attempts: attempt },
        'restart: 达到最大重启次数，放弃',
      );
      // 状态已由 finalizeExit 转为 error；若因异常路径未转换则补转
      if (record.instance.status !== 'error' && record.instance.status !== 'stopped') {
        this.transition(record.instance, 'error');
      }
      return;
    }

    const delay = calculateDelay(attempt - 1, DEFAULT_RESTART_POLICY);
    this.logger.warn(
      { instance_id: record.instance.id, attempt, delayMs: delay },
      'restart: 计划重启',
    );

    const timer = setTimeout(() => {
      this.restartAttempts.set(record.instance.id, attempt);
      this.restartTimers.delete(record.instance.id);
      // 重启前需 error → stopped，因为 startInstance 会做 stopped → starting
      if (record.instance.status === 'error') {
        this.transition(record.instance, 'stopped');
      }
      this.startInstance(record.instance, record.pack, record.callbacks)
        .catch((err) => {
          this.logger.error({ err: String(err) }, 'restart: 重启失败');
          // startInstance 失败：starting → error（spawn 阶段失败）
          // 若 bootstrap 失败则状态为 stopped，无法直接转 error，保持 stopped
          if (record.instance.status === 'starting') {
            this.transition(record.instance, 'error');
          }
        });
    }, delay);

    this.restartTimers.set(record.instance.id, timer);
  }

  /** 清除实例的重启定时器（若存在）。 */
  private clearRestartTimer(id: string): void {
    const timer = this.restartTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(id);
    }
  }

  /**
   * A12: 计划在稳定窗口（30s）后清零重启计数。
   * 防止反复崩溃的快速重试循环：仅在进程稳定运行 30s 后才认为"重启成功"。
   * A2: 同时清零崩溃熔断历史，让稳定运行后的崩溃重新计数。
   */
  private scheduleRestartAttemptsReset(id: string): void {
    this.clearRestartStableTimer(id);
    const timer = setTimeout(() => {
      this.restartStableTimers.delete(id);
      this.restartAttempts.delete(id);
      this.crashHistory.delete(id);
      this.logger.info({ instance_id: id }, 'restart: 稳定窗口已过，清零重启计数与崩溃历史');
    }, RESTART_STABLE_WINDOW_MS);
    this.restartStableTimers.set(id, timer);
  }

  /** A12: 清除实例的稳定窗口定时器（若存在）。 */
  private clearRestartStableTimer(id: string): void {
    const timer = this.restartStableTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.restartStableTimers.delete(id);
    }
  }

  /**
   * A7: 关闭所有实例（信号处理时调用）。
   * 先清理所有子进程（游戏服务器），再返回让调用方关闭连接。
   * A8: 使用 processDriver.stop 清理进程组，避免孤儿进程。
   */
  async shutdownAll(): Promise<void> {
    this.logger.info('shutdown: 开始清理所有实例');
    // 清除所有重启定时器
    for (const id of this.restartTimers.keys()) {
      this.clearRestartTimer(id);
    }
    // 清除所有稳定窗口定时器
    for (const id of this.restartStableTimers.keys()) {
      this.clearRestartStableTimer(id);
    }
    // 标记所有运行中实例为主动停止（跳过自动重启）
    const stopPromises: Promise<void>[] = [];
    for (const [id, record] of this.managed) {
      const status = record.instance.status;
      if (status === 'running' || status === 'starting' || status === 'stopping') {
        this.stoppingManually.add(id);
        if (record.instance.process) {
          // A8: processDriver.stop 使用进程组清理，避免孤儿进程
          stopPromises.push(
            this.processDriver.stop(record.instance.process, 5, null).catch((err) => {
              this.logger.error({ instance_id: id, err: String(err) }, 'shutdown: 停止实例失败');
            }),
          );
        }
      }
    }
    await Promise.all(stopPromises);
    this.logger.info('shutdown: 所有实例已清理');
  }

  /**
   * B7: 运行时自动重启开关。
   * @param instanceId 实例 ID
   * @param enabled true=开启自动重启（默认），false=关闭
   * 关闭时取消该实例所有待执行的重启定时器。
   */
  setAutoRestartEnabled(instanceId: string, enabled: boolean): void {
    this.autoRestartEnabled.set(instanceId, enabled);
    if (!enabled) {
      this.clearRestartTimer(instanceId);
      this.logger.info({ instance_id: instanceId }, 'auto-restart disabled, pending restart cancelled');
    }
  }

  /** 根据协议类型构建上下文；RCON 需 rcon_port/rcon_password，stdin 需 process。 */
  private buildProtocolContext(
    pack: GamePack,
    instance: Instance,
  ): InstanceContext | null {
    if (pack.protocol.type === 'stdin') {
      if (!instance.process) {
        return null;
      }
      return { kind: 'stdin', childProcess: instance.process };
    }
    // rcon / webrcon
    return {
      kind: 'rcon',
      host: RCON_HOST,
      rconPort: instance.rcon_port,
      rconPassword: instance.rcon_password,
    };
  }
}
