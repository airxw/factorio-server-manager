// ============================================================================
// ExecutionEngine.integration.test.ts — 沙箱引擎接入主路径的集成测试
//
// 验证 v4.11.0 孤岛代码接入：ExecutionEngine 被正确 wiring 进 daemon 的 RCON
// 命令投递主路径，使所有带 {Var} 单花括号占位符的自定义指令在投递到游戏进程前
// 经过沙箱校验（变量替换 + 正则白名单过滤）。
//
// 测试分两层：
//   Part A — ExecutionEngine 沙箱行为：用 mock 命令发送器捕获实际投递字符串，
//            验证合法 {player_id} 占位符指令被正确替换并投递、恶意注入被拦截。
//   Part B — InstanceManager 接入路径：mock 依赖构造 running 实例，注入
//            ExecutionEngine（sender 适配器调用 manager.sendRawCommand），
//            验证 sendCommand 路由（含 {Var} 走沙箱 / 不含走原路径）与
//            executeLogic 发货入口的端到端行为，并确认不递归。
// ============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Logger } from 'pino';
import { ExecutionEngine, type IInstanceCommandSender } from '../ExecutionEngine.js';
import { CommandFailedError } from '../../../instances/types.js';
import type { InstanceEventCallbacks } from '../../../instances/manager.js';
import type { Instance } from '../../../instances/types.js';
import { createMockChild } from '../../../test/mock-child-process.js';
import {
  minecraftInstance,
  minecraftPack,
  MINECRAFT_READY_LINE,
} from '../../../test/fixtures.js';

// ----------------------------------------------------------------------------
// vi.hoisted：Part B 共享 mock 状态（与 manager.test.ts 同构，隔离 InstanceManager 依赖）
// ----------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  const state = {
    currentChild: null as unknown,
    startCalls: 0,
  };
  const stop = vi.fn(async (process: unknown): Promise<void> => {
    (process as { exitCode: number | null }).exitCode = 0;
  });
  // mock 协议客户端：send 是投递到游戏进程的最终出口，用 vi.fn 捕获投递字符串
  const protocol = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue('ok'),
  };
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

// 隔离 InstanceManager 的外部依赖（与 manager.test.ts 同构）
vi.mock('../../../instances/bootstrap.js', () => ({
  bootstrapInstance: vi.fn().mockResolvedValue(undefined),
  BootstrapError: class BootstrapError extends Error {},
}));
vi.mock('../../../instances/processDriver.js', () => ({
  ProcessDriver: class MockProcessDriver {
    start(): { process: unknown; pid: number } {
      mocks.state.startCalls++;
      return { process: mocks.state.currentChild, pid: 12345 };
    }
    stop(process: unknown): Promise<void> {
      return mocks.stop(process);
    }
    getChildProcessPids(): Promise<number[]> {
      return Promise.resolve([]);
    }
  },
}));
vi.mock('../../../instances/logWriter.js', () => ({
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
vi.mock('../../../protocol/factory.js', () => ({
  ProtocolFactory: {
    create: () => mocks.protocol,
  },
}));
vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  const accessSync = vi.fn();
  const mocked = { ...actual, accessSync };
  return { ...mocked, default: mocked };
});

// 在 mock 注册后导入被测模块
import { InstanceManager } from '../../../instances/manager.js';

const mockLogger = mocks.logger as unknown as Logger;

/** 启动实例并触发就绪（starting → running），使 sendCommand 可用。 */
async function startAndReady(
  manager: InstanceManager,
  instance: Instance,
  callbacks: InstanceEventCallbacks,
): Promise<void> {
  const handle = createMockChild();
  mocks.state.currentChild = handle.child;
  // 浅拷贝并重置 status，避免共享 fixtures 对象的跨测试状态污染（与 manager.test.ts 同构）
  await manager.startInstance({ ...instance, status: 'stopped' }, minecraftPack, callbacks);
  handle.emitStdout(MINECRAFT_READY_LINE);
  expect(manager.getState(instance.id)).toBe('running');
}

function makeCallbacks(): InstanceEventCallbacks {
  return {
    onConsole: vi.fn(),
    onStateChange: vi.fn(),
    onStarted: vi.fn(),
    onStopped: vi.fn(),
  };
}

// ============================================================================
// Part A — ExecutionEngine 沙箱行为（mock 命令发送器捕获投递字符串）
// ============================================================================

describe('ExecutionEngine 沙箱接入集成测试', () => {
  describe('Part A: 沙箱引擎投递行为（mock sender 捕获投递字符串）', () => {
    it('合法 {player_id} 占位符指令经沙箱替换后正确投递', async () => {
      const sendCommand = vi.fn().mockResolvedValue('ok');
      const sender: IInstanceCommandSender = { sendCommand };
      const engine = new ExecutionEngine(sender);

      // 模拟发货场景：玩家购买后触发 give 指令，{player_id} 替换为实际玩家名
      const result = await engine.executeLogic(
        'inst-mc-1',
        'give {player_id} 64',
        { player_id: 'Steve_123' },
      );

      expect(result).toBe(true);
      // 核心断言：mock sender 捕获到的是替换后的实际投递字符串
      expect(sendCommand).toHaveBeenCalledTimes(1);
      expect(sendCommand).toHaveBeenCalledWith('inst-mc-1', 'give Steve_123 64');
    });

    it('恶意分号注入被拦截（ERR_RCON_INJECTION），sender 未被调用', async () => {
      const sendCommand = vi.fn();
      const sender: IInstanceCommandSender = { sendCommand };
      const engine = new ExecutionEngine(sender);

      // 玩家名注入分号试图追加 stop 命令
      await expect(
        engine.executeLogic('inst-mc-1', 'give {player_id} 64', {
          player_id: 'Steve; stop',
        }),
      ).rejects.toThrow('ERR_RCON_INJECTION');

      expect(sendCommand).not.toHaveBeenCalled();
    });

    it('恶意管道符注入被拦截（ERR_RCON_INJECTION），sender 未被调用', async () => {
      const sendCommand = vi.fn();
      const sender: IInstanceCommandSender = { sendCommand };
      const engine = new ExecutionEngine(sender);

      // 玩家名注入管道符试图执行任意命令
      await expect(
        engine.executeLogic('inst-mc-1', 'give {player_id} 64', {
          player_id: 'Steve | rm -rf /',
        }),
      ).rejects.toThrow('ERR_RCON_INJECTION');

      expect(sendCommand).not.toHaveBeenCalled();
    });

    it('多重占位符指令经沙箱替换后正确投递', async () => {
      const sendCommand = vi.fn().mockResolvedValue('ok');
      const sender: IInstanceCommandSender = { sendCommand };
      const engine = new ExecutionEngine(sender);

      // 多变量发货场景：{player_id} 与 {item_id} 同时替换
      const result = await engine.executeLogic(
        'inst-mc-1',
        'give {player_id} {item_id}',
        { player_id: 'Alex_99', item_id: 'diamond' },
      );

      expect(result).toBe(true);
      expect(sendCommand).toHaveBeenCalledWith('inst-mc-1', 'give Alex_99 diamond');
    });
  });

  // ============================================================================
  // Part B — InstanceManager 接入路径（验证 sendCommand 路由 + executeLogic 发货入口）
  // ============================================================================

  describe('Part B: InstanceManager 接入路径（sendCommand 路由 + executeLogic 发货入口）', () => {
    let manager: InstanceManager;

    beforeEach(() => {
      vi.useFakeTimers();
      mocks.state.currentChild = null;
      mocks.state.startCalls = 0;
      mocks.stop.mockClear();
      mocks.protocol.connect.mockClear();
      mocks.protocol.disconnect.mockClear();
      mocks.protocol.send.mockClear();
      mocks.protocol.send.mockResolvedValue('ok');

      manager = new InstanceManager(mockLogger);
      // 接入 ExecutionEngine：sender 适配器调用 manager.sendRawCommand（底层投递，不经过沙箱）
      // 这正是 server.ts createDaemonServer 中的 wiring 方式
      const sender: IInstanceCommandSender = {
        sendCommand: (id: string, command: string) => manager.sendRawCommand(id, command),
      };
      manager.setExecutionEngine(new ExecutionEngine(sender));
    });

    it('普通硬编码指令（不含 {Var}）走原路径，行为不变', async () => {
      await startAndReady(manager, minecraftInstance, makeCallbacks());

      // 普通指令直通 sendRawCommand → protocol.send
      const output = await manager.sendCommand(minecraftInstance.id, 'list');

      expect(output).toBe('ok');
      expect(mocks.protocol.send).toHaveBeenCalledTimes(1);
      expect(mocks.protocol.send).toHaveBeenCalledWith('list');
    });

    it('含 {Var} 占位符的合法指令走沙箱校验后投递（variables 为空，占位符保留）', async () => {
      await startAndReady(manager, minecraftInstance, makeCallbacks());

      // sendCommand 含 {Var} 走沙箱：variables 为空，占位符保留，
      // 默认白名单 ^[a-zA-Z0-9_\{\} ]+$ 允许花括号，校验通过后投递
      const output = await manager.sendCommand(
        minecraftInstance.id,
        'give {player_id} 64',
      );

      // 沙箱路径不返回 RCON 响应字符串（返回 null）
      expect(output).toBeNull();
      expect(mocks.protocol.send).toHaveBeenCalledTimes(1);
      expect(mocks.protocol.send).toHaveBeenCalledWith('give {player_id} 64');
    });

    it('含 {Var} 占位符的恶意指令（分号注入）走沙箱被拦截，抛 CommandFailedError', async () => {
      await startAndReady(manager, minecraftInstance, makeCallbacks());

      // 恶意指令：含 {Var} + 分号 → 走沙箱，白名单校验失败
      await expect(
        manager.sendCommand(minecraftInstance.id, 'give {player_id}; stop'),
      ).rejects.toThrow(CommandFailedError);

      // 核心断言：沙箱拦截后 protocol.send 未被调用，命令未投递到游戏进程
      expect(mocks.protocol.send).not.toHaveBeenCalled();
    });

    it('executeLogic 发货入口：带 variables 的合法指令经沙箱替换后投递', async () => {
      await startAndReady(manager, minecraftInstance, makeCallbacks());

      // executeLogic 是发货链路入口：接收 logicString + variables，沙箱内替换+校验+投递
      const ok = await manager.executeLogic(
        minecraftInstance.id,
        'give {player_id} 64',
        { player_id: 'Steve_123' },
      );

      expect(ok).toBe(true);
      // 核心断言：protocol 收到的是替换后的实际命令
      expect(mocks.protocol.send).toHaveBeenCalledTimes(1);
      expect(mocks.protocol.send).toHaveBeenCalledWith('give Steve_123 64');
    });

    it('executeLogic 发货入口：恶意 variables 被沙箱拦截，不投递', async () => {
      await startAndReady(manager, minecraftInstance, makeCallbacks());

      await expect(
        manager.executeLogic(
          minecraftInstance.id,
          'give {player_id} 64',
          { player_id: 'Steve | wget evil' },
        ),
      ).rejects.toThrow(CommandFailedError);

      expect(mocks.protocol.send).not.toHaveBeenCalled();
    });

    it('沙箱路径不递归：executeLogic → sender.sendCommand → sendRawCommand（单次投递）', async () => {
      await startAndReady(manager, minecraftInstance, makeCallbacks());

      await manager.executeLogic(
        minecraftInstance.id,
        'give {player_id} 64',
        { player_id: 'Steve_123' },
      );

      // 若 sender 适配器错误调用 manager.sendCommand（而非 sendRawCommand），
      // 会因 {Var} 占位符已替换为 Steve_123（不含 {Var}）而走原路径——不会无限递归；
      // 但若 logicString 本身投递后仍含 {Var}，递归会发生。
      // 此处验证：protocol.send 恰好被调用 1 次（无递归）
      expect(mocks.protocol.send).toHaveBeenCalledTimes(1);
    });
  });
});
