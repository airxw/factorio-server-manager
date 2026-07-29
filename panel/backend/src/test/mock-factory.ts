// ============================================================================
// mock-factory — 通用 mock 工厂
// 提供 logger / daemonClient / eventBus 的 mock，以及 daemon exec 响应构造器。
// ============================================================================

import { vi, type Mock } from 'vitest';
import type { DaemonClient } from '@public/interface_stub/daemon-client';
import type { ExecCommandResponse } from '@public/schema/daemon-api-types';

/** 将接口的每个方法映射为 vitest Mock（非函数属性原样保留） */
type MockedClient<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? Mock<(...args: A) => R>
    : T[K];
};

/** 静默 pino logger mock（所有方法为 vi.fn()，不输出） */
export function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

/** daemonClient mock（所有方法为对应签名的 vi.fn()） */
export function mockDaemonClient(): MockedClient<DaemonClient> {
  return {
    startInstance: vi.fn(),
    stopInstance: vi.fn(),
    getInstanceState: vi.fn(),
    sendCommand: vi.fn(),
    subscribeEvents: vi.fn(),
    execCommand: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    listFiles: vi.fn(),
    toggleModFile: vi.fn(),
    scanJavas: vi.fn(),
    scanMods: vi.fn(),
    getHealth: vi.fn(),
    invalidateClient: vi.fn(),
  };
}

/** eventBus mock */
export function mockEventBus() {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    removeAllListeners: vi.fn(),
  };
}

/** 构造 daemon exec 命令响应（默认成功，可覆盖任意字段） */
export function execResponse(
  overrides: Partial<ExecCommandResponse> = {},
): ExecCommandResponse {
  return {
    exit_code: 0,
    stdout: '',
    stderr: '',
    duration_ms: 0,
    timed_out: false,
    ...overrides,
  };
}
