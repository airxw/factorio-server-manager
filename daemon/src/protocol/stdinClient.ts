// ============================================================================
// 模块5_Daemon协议层 — StdinClient（Factorio stdin 单向通信，P0 stub）
// 依据：daemon/src/protocol/AGENTS.md §模块专属约束 4
// 说明：stdin 协议为单向通信，send 返回 null（无响应）。
//       P0 仅做最小实现，完整 Factorio Pack 推迟 P2.1。
// ============================================================================

import type { ChildProcess } from 'node:child_process';
import type { CommandProtocol } from '@public/interface_stub/command-protocol';

/**
 * StdinClient 构造选项：持有已 spawn 的子进程句柄。
 */
export interface StdinClientOptions {
  readonly childProcess: ChildProcess;
}

/**
 * StdinClient — 通过子进程 stdin 写入命令，单向通信无响应。
 *
 * 生命周期：
 *   1. connect() → 空实现（stdin 随子进程 spawn 即可用）
 *   2. send(command) → 写入 childProcess.stdin 并追加换行，返回 null
 *   3. disconnect() → 空实现（stdin 生命周期由进程管理）
 *
 * 若 stdin 不可写（进程已退出或未开启 pipe），send 抛出 Error。
 */
export class StdinClient implements CommandProtocol {
  private readonly childProcess: ChildProcess;

  constructor(options: StdinClientOptions) {
    this.childProcess = options.childProcess;
  }

  async connect(): Promise<void> {
    // stdin 在 spawn 时已创建，无需额外建连
  }

  async send(command: string): Promise<string | null> {
    const stdin = this.childProcess.stdin;
    if (!stdin || !stdin.writable) {
      throw new Error('StdinClient.send: child process stdin is not writable');
    }
    stdin.write(command + '\n');
    return null;
  }

  async disconnect(): Promise<void> {
    // stdin 生命周期跟随子进程，不在此主动关闭
  }
}
