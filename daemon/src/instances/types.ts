// ============================================================================
// 模块4_Daemon实例管理 — 类型定义与错误类
// 依据：daemon/src/instances/AGENTS.md §模块专属约束 2
// ============================================================================

import type { ChildProcess } from 'node:child_process';
import type { InstanceState } from '@public/schema/daemon-api-types';
import type { CommandProtocol } from '@public/interface_stub/command-protocol';
import type { ReadyMatcher } from './readiness.js';

/**
 * 实例对象：Daemon 内存中维护的实例运行态。
 * - process/protocol/readyMatcher 仅在实例启动后赋值，停止后清理
 * - started_at 为 ISO 时间字符串，未启动时为 null
 */
export interface Instance {
  id: string;
  name: string;
  pack_id: string;
  status: InstanceState;
  port: number;
  rcon_port: number;
  rcon_password: string;
  workdir: string;
  pid: number | null;
  started_at: string | null;
  process?: ChildProcess;
  protocol?: CommandProtocol;
  readyMatcher?: ReadyMatcher;
}

/**
 * 进程启动配置：由 InstanceManager 根据 Pack.startup 渲染模板后传入 ProcessDriver。
 */
export interface StartConfig {
  binary: string;
  args: string[];
  workingDir: string;
  env?: NodeJS.ProcessEnv;
}

// ---------------------------------------------------------------------------
// 错误类：InstanceManager 抛出，由 server.ts 映射为 HTTP 状态码与错误码
// ---------------------------------------------------------------------------

/** 实例不存在（→ 404 INSTANCE_NOT_FOUND） */
export class InstanceNotFoundError extends Error {
  readonly instanceId: string;
  constructor(instanceId: string) {
    super(`Instance not found: ${instanceId}`);
    this.name = 'InstanceNotFoundError';
    this.instanceId = instanceId;
  }
}

/** 实例已在运行（→ 409 INSTANCE_ALREADY_RUNNING） */
export class InstanceAlreadyRunningError extends Error {
  readonly instanceId: string;
  constructor(instanceId: string) {
    super(`Instance already running: ${instanceId}`);
    this.name = 'InstanceAlreadyRunningError';
    this.instanceId = instanceId;
  }
}

/** 实例未运行（→ 409 INSTANCE_NOT_RUNNING） */
export class InstanceNotRunningError extends Error {
  readonly instanceId: string;
  constructor(instanceId: string) {
    super(`Instance not running: ${instanceId}`);
    this.name = 'InstanceNotRunningError';
    this.instanceId = instanceId;
  }
}

/** 非法状态转换（→ 409 INVALID_STATE_TRANSITION） */
export class InvalidStateTransitionError extends Error {
  readonly from: InstanceState;
  readonly to: InstanceState;
  constructor(from: InstanceState, to: InstanceState) {
    super(`Invalid state transition: ${from} → ${to}`);
    this.name = 'InvalidStateTransitionError';
    this.from = from;
    this.to = to;
  }
}

/** 命令执行失败（→ 500 COMMAND_FAILED） */
export class CommandFailedError extends Error {
  constructor(message: string, cause?: unknown) {
    // 复用原生 Error.cause（ES2022 ErrorOptions）保留底层错误链
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'CommandFailedError';
  }
}
