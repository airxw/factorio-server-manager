// ============================================================================
// mock-child-process — 模拟 node:child_process.spawn 返回的 ChildProcess
// 用途：在单元测试中可控地触发 stdout/stderr/close/exit/error 事件序列，
//       驱动 InstanceManager 的三段式退出判定与崩溃熔断逻辑
// ============================================================================

import { EventEmitter } from 'node:events';

/**
 * 模拟流：具备 setEncoding（manager 调用）+ EventEmitter 能力（data/close 事件）。
 */
export class MockStream extends EventEmitter {
  setEncoding(_enc: string): void {
    // no-op：manager 会调用 child.stdout.setEncoding('utf8')，此处仅吞掉调用
  }
}

/**
 * 模拟 ChildProcess：
 * - 继承 EventEmitter，支持 'exit'/'error' 事件
 * - stdout/stderr 为 MockStream，支持 'data'/'close' 事件
 * - exitCode/signalCode 可被测试设置（doStop 依赖 exitCode !== null 判定进程已退出）
 */
export interface MockChildProcess extends EventEmitter {
  pid: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stdin: { write: (...args: unknown[]) => boolean; end: (...args: unknown[]) => void; writable: boolean };
  stdout: MockStream;
  stderr: MockStream;
  kill: (signal?: NodeJS.Signals) => boolean;
}

/**
 * MockChild 句柄：持有 child 与一组 emit 辅助函数。
 * 测试通过 emit* 函数精确控制事件触发顺序，验证三段式退出判定时序。
 */
export interface MockChildHandle {
  child: MockChildProcess;
  /** 向 stdout 发送 data 事件（manager 按 \n 拆行处理） */
  emitStdout: (chunk: string) => void;
  /** 向 stderr 发送 data 事件 */
  emitStderr: (chunk: string) => void;
  /** 触发 stdout 的 close 事件（三段式第二段） */
  emitStdoutClose: () => void;
  /** 触发 stderr 的 close 事件（三段式第三段） */
  emitStderrClose: () => void;
  /** 触发进程 exit 事件（三段式第一段），同时更新 exitCode/signalCode */
  emitExit: (code: number | null, signal?: NodeJS.Signals | null) => void;
  /** 触发进程 error 事件（spawn 失败/管道错误） */
  emitError: (err: Error) => void;
}

/**
 * 创建一个 mock child 句柄。
 * @param pid 模拟进程 PID（默认 12345）
 */
export function createMockChild(pid: number = 12345): MockChildHandle {
  const child = new EventEmitter() as MockChildProcess;
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.stdin = {
    write: () => true,
    end: () => {},
    writable: true,
  };
  child.stdout = new MockStream();
  child.stderr = new MockStream();
  child.kill = () => true;

  return {
    child,
    emitStdout: (chunk: string) => child.stdout.emit('data', chunk),
    emitStderr: (chunk: string) => child.stderr.emit('data', chunk),
    emitStdoutClose: () => child.stdout.emit('close'),
    emitStderrClose: () => child.stderr.emit('close'),
    emitExit: (code: number | null, signal: NodeJS.Signals | null = null) => {
      child.exitCode = code;
      child.signalCode = signal;
      child.emit('exit', code, signal);
    },
    emitError: (err: Error) => child.emit('error', err),
  };
}
