// ============================================================================
// manager.test.ts — InstanceManager 核心行为单元测试
//
// 可测性说明：
//   manager.ts 高度耦合（依赖 bootstrapInstance / ProcessDriver / InstanceLogWriter /
//   ProtocolFactory / fs.accessSync），无法直接对纯函数测试。本测试通过 vi.mock
//   在模块层隔离外部依赖，仅测试 InstanceManager 自身的行为逻辑：
//     1. 三段式退出判定（exit + stdout close + stderr close）
//     2. 崩溃熔断（5min 窗口内崩溃超阈值 → 放弃自动重启）
//     3. 稳定窗口（running 30s 后清零重启计数与崩溃历史）
//     4. SIGINT_STOP_GAMES（valheim/enshrouded/dyson 跳过 stdin 走 SIGINT）
//   集成测试（真实 spawn / 文件系统 / RCON）留给后续批次。
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Logger } from 'pino';
import type { InstanceEventCallbacks } from './manager.js';
import type { Instance } from './types.js';
import { calculateDelay, DEFAULT_RESTART_POLICY } from './restartPolicy.js';
import { createMockChild, type MockChildHandle } from '../test/mock-child-process.js';
import {
  minecraftInstance,
  minecraftPack,
  valheimInstance,
  valheimPack,
  crashingInstance,
  MINECRAFT_READY_LINE,
} from '../test/fixtures.js';

// ----------------------------------------------------------------------------
// vi.hoisted：在 vi.mock 工厂之前初始化的共享 mock 状态
// ----------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  // ProcessDriver.start 返回的当前 mock child（每次重启前由测试设置）
  const state = {
    currentChild: null as unknown,
    startCalls: 0,
  };
  // ProcessDriver.stop mock：模拟进程退出（设置 exitCode=0），供 doStop 的 procExited 判定
  // 签名对齐真实 ProcessDriver.stop(process, timeout, stopCommand, firstSignal)
  const stop = vi.fn(async (
    process: unknown,
    _timeout: unknown,
    _stopCommand: unknown,
    _firstSignal: unknown,
  ): Promise<void> => {
    (process as { exitCode: number | null }).exitCode = 0;
  });
  // ProtocolFactory.create 返回的 mock 协议客户端
  const protocol = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue('ok'),
  };
  // pino Logger mock
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  return { state, stop, protocol, logger };
});

// ----------------------------------------------------------------------------
// vi.mock：隔离 manager.ts 的外部依赖
// ----------------------------------------------------------------------------

// bootstrapInstance → no-op（跳过 workdir 创建 / 二进制下载 / 配置文件写入）
vi.mock('./bootstrap.js', () => ({
  bootstrapInstance: vi.fn().mockResolvedValue(undefined),
  BootstrapError: class BootstrapError extends Error {},
}));

// ProcessDriver → 可控返回 mock child + 记录 stop 调用参数
vi.mock('./processDriver.js', () => ({
  ProcessDriver: class MockProcessDriver {
    start(): { process: unknown; pid: number } {
      mocks.state.startCalls++;
      return { process: mocks.state.currentChild, pid: 12345 };
    }
    stop(
      process: unknown,
      timeout: unknown,
      stopCommand: unknown,
      firstSignal: unknown,
    ): Promise<void> {
      return mocks.stop(process, timeout, stopCommand, firstSignal);
    }
    getChildProcessPids(): Promise<number[]> {
      return Promise.resolve([]);
    }
  },
}));

// InstanceLogWriter → no-op（跳过文件系统日志持久化）
vi.mock('./logWriter.js', () => ({
  InstanceLogWriter: class MockLogWriter {
    init() { return Promise.resolve(); }
    write() {}
    close() {}
    readHistory() { return Promise.resolve([]); }
    listLogFiles() { return []; }
    readLogFile() { return []; }
    deleteLogFile() {}
  },
}));

// ProtocolFactory.create → 返回 mock 协议客户端
vi.mock('../protocol/factory.js', () => ({
  ProtocolFactory: {
    create: () => mocks.protocol,
  },
}));

// fs.accessSync → no-op（让 checkBinaryEnvironment 的二进制存在性检查通过）
// manager.ts 使用 `import fs from 'node:fs'`（默认导入），需同时提供 default 导出
vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  const accessSync = vi.fn();
  const mocked = { ...actual, accessSync };
  return { ...mocked, default: mocked };
});

// ----------------------------------------------------------------------------
// 在 mock 注册后导入被测模块
// ----------------------------------------------------------------------------
import { InstanceManager } from './manager.js';

const mockLogger = mocks.logger as unknown as Logger;

/** 构造一组事件回调 spy。 */
function makeCallbacks(): InstanceEventCallbacks {
  return {
    onConsole: vi.fn(),
    onStateChange: vi.fn(),
    onStarted: vi.fn(),
    onStopped: vi.fn(),
  };
}

/** 启动实例并触发就绪（starting → running）。返回 mock child 句柄。 */
async function startAndReady(
  manager: InstanceManager,
  instance: Instance,
  callbacks: InstanceEventCallbacks,
): Promise<MockChildHandle> {
  const handle = createMockChild();
  mocks.state.currentChild = handle.child;
  await manager.startInstance(instance, minecraftPack, callbacks);
  expect(manager.getState(instance.id)).toBe('starting');
  handle.emitStdout(MINECRAFT_READY_LINE);
  expect(manager.getState(instance.id)).toBe('running');
  return handle;
}

/**
 * 模拟一次崩溃 + 重启恢复 + 就绪的完整循环。
 * @param handle 当前 mock child（将被触发 exit/close）
 * @param attempt 本次崩溃对应的重启序号（用于计算指数退避延迟）
 * @returns 重启后的新 mock child 句柄（已就绪）
 */
async function crashRecoverReady(
  handle: MockChildHandle,
  attempt: number,
): Promise<MockChildHandle> {
  // 触发崩溃：exit(code=1) + stdout close + stderr close → 三段全 true → finalizeExit + scheduleRestart
  handle.emitExit(1, null);
  handle.emitStdoutClose();
  handle.emitStderrClose();
  // 准备下次重启使用的 mock child
  const next = createMockChild();
  mocks.state.currentChild = next.child;
  // 推进时间触发重启定时器（指数退避延迟）
  const delay = calculateDelay(attempt - 1, DEFAULT_RESTART_POLICY);
  await vi.advanceTimersByTimeAsync(delay);
  // 重启后状态为 starting，触发就绪
  expect(mocks.state.startCalls).toBeGreaterThanOrEqual(1);
  next.emitStdout(MINECRAFT_READY_LINE);
  return next;
}

describe('InstanceManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.state.currentChild = null;
    mocks.state.startCalls = 0;
    mocks.stop.mockClear();
    mocks.protocol.connect.mockClear();
    mocks.protocol.disconnect.mockClear();
    mocks.protocol.send.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ==========================================================================
  // 1. SIGINT_STOP_GAMES：valheim 走 SIGINT，minecraft 走默认信号升级链
  // ==========================================================================
  it('SIGINT_STOP_GAMES：valheim 跳过 stdin 直接走 SIGINT，minecraft 走默认链', async () => {
    // --- Valheim：命中 SIGINT_STOP_GAMES ---
    const vMgr = new InstanceManager(mockLogger);
    const vCb = makeCallbacks();
    const vInstance: Instance = { ...valheimInstance };
    const vHandle = createMockChild();
    mocks.state.currentChild = vHandle.child;
    await vMgr.startInstance(vInstance, valheimPack, vCb);
    // 触发就绪（valheim ready_pattern: 'Game server started'）
    vHandle.emitStdout('Game server started\n');
    expect(vMgr.getState(vInstance.id)).toBe('running');

    mocks.stop.mockClear();
    await vMgr.stopInstance(vInstance.id);

    expect(mocks.stop).toHaveBeenCalledTimes(1);
    const vCall = mocks.stop.mock.calls[0];
    // stop 签名: (process, timeout, stopCommand, firstSignal)
    // valheim: stop_command=null → stdinStopCmd=null；命中 SIGINT_STOP_GAMES → firstSignal='SIGINT'
    expect(vCall[2]).toBeNull(); // stopCommand
    expect(vCall[3]).toBe('SIGINT'); // firstSignal
    expect(vMgr.getState(vInstance.id)).toBe('stopped');

    // --- Minecraft：不在 SIGINT_STOP_GAMES，走默认链 ---
    const mMgr = new InstanceManager(mockLogger);
    const mCb = makeCallbacks();
    const mInstance: Instance = { ...minecraftInstance };
    const mHandle = createMockChild();
    mocks.state.currentChild = mHandle.child;
    await mMgr.startInstance(mInstance, minecraftPack, mCb);
    mHandle.emitStdout(MINECRAFT_READY_LINE);
    expect(mMgr.getState(mInstance.id)).toBe('running');

    mocks.stop.mockClear();
    await mMgr.stopInstance(mInstance.id);

    expect(mocks.stop).toHaveBeenCalledTimes(1);
    const mCall = mocks.stop.mock.calls[0];
    // minecraft: protocol=rcon → stdinStopCmd=null；不在 SIGINT_STOP_GAMES → firstSignal=null
    expect(mCall[2]).toBeNull(); // stopCommand（rcon 协议 stdinStopCmd 为 null）
    expect(mCall[3]).toBeNull(); // firstSignal
    expect(mMgr.getState(mInstance.id)).toBe('stopped');
  });

  // ==========================================================================
  // 2. 三段式退出判定：exit 先于 stdout/stderr close 时不提前触发 finalizeExit
  // ==========================================================================
  it('三段式退出判定：exit + stdout close + stderr close 三者全到才触发 finalizeExit', async () => {
    const manager = new InstanceManager(mockLogger);
    const callbacks = makeCallbacks();
    const instance: Instance = { ...minecraftInstance };
    const handle = await startAndReady(manager, instance, callbacks);

    // 就绪后未触发 onStopped
    expect(callbacks.onStopped).not.toHaveBeenCalled();

    // 第一段：仅 exit 触发 → finalizeExit 不应触发（stdout/stderr 未关闭）
    handle.emitExit(0, null);
    expect(callbacks.onStopped).not.toHaveBeenCalled();

    // 第二段：stdout close → 仍缺 stderr close，不触发
    handle.emitStdoutClose();
    expect(callbacks.onStopped).not.toHaveBeenCalled();

    // 第三段：stderr close → 三段全 true → finalizeExit 触发
    handle.emitStderrClose();
    expect(callbacks.onStopped).toHaveBeenCalledTimes(1);

    // exitCode=0：非崩溃，不触发重启（start 仅被调用 1 次 = 初始启动）
    expect(mocks.state.startCalls).toBe(1);
    // running 态进程退出（非主动 stop）→ finalizeExit 转 error
    expect(manager.getState(instance.id)).toBe('error');
  });

  // ==========================================================================
  // 3. 崩溃熔断：5min 窗口内连续崩溃超阈值 → 放弃自动重启
  // ==========================================================================
  it('崩溃熔断：5min 窗口内连续崩溃超阈值后放弃自动重启并保持 error 态', async () => {
    const manager = new InstanceManager(mockLogger);
    const callbacks = makeCallbacks();
    const instance: Instance = { ...crashingInstance };
    let handle = await startAndReady(manager, instance, callbacks);
    expect(mocks.state.startCalls).toBe(1); // 初始启动

    // 5 次崩溃 → 5 次重启（attempt 1-5，crashHistory 累计 5，未超阈值 5）
    handle = await crashRecoverReady(handle, 1);
    handle = await crashRecoverReady(handle, 2);
    handle = await crashRecoverReady(handle, 3);
    handle = await crashRecoverReady(handle, 4);
    handle = await crashRecoverReady(handle, 5);
    expect(mocks.state.startCalls).toBe(6); // 初始 + 5 次重启
    expect(manager.getState(instance.id)).toBe('running');

    // 第 6 次崩溃 → crashHistory.length=6 > 5 → 熔断，不再调度重启
    handle.emitExit(1, null);
    handle.emitStdoutClose();
    handle.emitStderrClose();

    // 熔断后状态保持 error，start 调用次数不增加
    expect(manager.getState(instance.id)).toBe('error');
    expect(mocks.state.startCalls).toBe(6);

    // 推进时间确认无待执行的重启定时器
    await vi.advanceTimersByTimeAsync(60000);
    expect(mocks.state.startCalls).toBe(6);
    expect(manager.getState(instance.id)).toBe('error');
  });

  // ==========================================================================
  // 4. 稳定窗口：running 30s 后清零重启计数与崩溃历史
  // ==========================================================================
  it('稳定窗口：running 30s 后崩溃历史被清零，后续崩溃重新计数不触发熔断', async () => {
    const manager = new InstanceManager(mockLogger);
    const callbacks = makeCallbacks();
    const instance: Instance = { ...crashingInstance };
    let handle = await startAndReady(manager, instance, callbacks);
    expect(mocks.state.startCalls).toBe(1);

    // 3 次崩溃 → 3 次重启（crashHistory=3, attempt=3）
    handle = await crashRecoverReady(handle, 1);
    handle = await crashRecoverReady(handle, 2);
    handle = await crashRecoverReady(handle, 3);
    expect(mocks.state.startCalls).toBe(4);
    expect(manager.getState(instance.id)).toBe('running');

    // 推进 31s → 30s 稳定窗口定时器触发 → 清零 restartAttempts + crashHistory
    await vi.advanceTimersByTimeAsync(31000);
    expect(manager.getState(instance.id)).toBe('running');

    // 再 3 次崩溃 → 因历史已清零，attempt 重新从 1 计数，crashHistory=3，不触发熔断
    handle = await crashRecoverReady(handle, 1);
    handle = await crashRecoverReady(handle, 2);
    handle = await crashRecoverReady(handle, 3);
    expect(mocks.state.startCalls).toBe(7); // 初始 + 6 次重启（3 + 3）
    expect(manager.getState(instance.id)).toBe('running');
  });
});
