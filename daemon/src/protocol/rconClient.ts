// ============================================================================
// 模块5_Daemon协议层 — RconClient（基于 rcon-client 库）
// 依据：daemon/src/protocol/AGENTS.md §模块专属约束 1/5/6
// PoC 验证：poc/rcon-client/ 8 命令全成功
// 协议规范：Source RCON over TCP（rcon-client@^4.2.4 已封装）
// ============================================================================

import { Rcon } from 'rcon-client';
import type { CommandProtocol } from '@public/interface_stub/command-protocol';

/**
 * RconClient 构造选项。
 * - timeout: 连接超时（毫秒），默认 5000ms
 */
export interface RconClientOptions {
  readonly host: string;
  readonly port: number;
  readonly password: string;
  readonly timeout?: number;
}

/**
 * RconClient — 实现 CommandProtocol 接口的双向命令客户端。
 *
 * 生命周期：
 *   1. connect() → Rcon.connect({host,port,password,timeout})，密码错误时抛出
 *   2. send(command) → rcon.send(command) 返回响应字符串
 *   3. disconnect() → rcon.end() 释放 TCP 连接
 *
 * 连接失败（密码错误、端口不可达、超时）由 rcon-client 抛出 Error，
 * 调用方需在 try/catch 中处理。
 */
export class RconClient implements CommandProtocol {
  private rcon: Rcon | null = null;
  private readonly options: RconClientOptions;

  constructor(options: RconClientOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    // Rcon.connect 已完成 TCP 建连 + 认证；认证失败会 reject
    this.rcon = await Rcon.connect({
      host: this.options.host,
      port: this.options.port,
      password: this.options.password,
      timeout: this.options.timeout ?? 5000,
    });
  }

  async send(command: string): Promise<string> {
    if (!this.rcon) {
      throw new Error('RconClient.send called before connect()');
    }
    return this.rcon.send(command);
  }

  async disconnect(): Promise<void> {
    if (this.rcon) {
      const rcon = this.rcon;
      this.rcon = null;
      await rcon.end();
    }
  }
}
