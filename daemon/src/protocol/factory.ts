// ============================================================================
// 模块5_Daemon协议层 — ProtocolFactory
// 依据：daemon/src/protocol/AGENTS.md §模块专属约束 3
// 职责：按 pack.protocol.type 创建对应的 CommandProtocol 客户端实例
// ============================================================================

import type { Protocol } from '@public/schema/pack-schema';
import type { CommandProtocol } from '@public/interface_stub/command-protocol';
import { RconClient } from './rconClient.js';
import { StdinClient } from './stdinClient.js';
import type { InstanceContext } from './types.js';

/**
 * ProtocolFactory — 协议客户端工厂。
 *
 * 分发规则：
 *   - protocol.type === 'stdin'  → StdinClient（要求 ctx.kind === 'stdin'）
 *   - protocol.type === 'rcon'   → RconClient（要求 ctx.kind === 'rcon'）
 *   - protocol.type === 'webrcon' → RconClient（P0 与 rcon 复用实现）
 *
 * 协议类型与上下文 kind 不匹配时抛出 Error，防止误用。
 */
export class ProtocolFactory {
  static create(protocol: Protocol, ctx: InstanceContext): CommandProtocol {
    if (protocol.type === 'stdin') {
      if (ctx.kind !== 'stdin') {
        throw new Error(
          `Protocol 'stdin' requires stdin context, got '${ctx.kind}'`,
        );
      }
      return new StdinClient({ childProcess: ctx.childProcess });
    }

    // protocol.type === 'rcon' | 'webrcon'（discriminated union 已收窄）
    if (ctx.kind !== 'rcon') {
      throw new Error(
        `Protocol '${protocol.type}' requires rcon context, got '${ctx.kind}'`,
      );
    }
    return new RconClient({
      host: ctx.host,
      port: ctx.rconPort,
      password: ctx.rconPassword,
    });
  }
}
