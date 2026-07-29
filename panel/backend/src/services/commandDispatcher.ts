// ============================================================================
// commandDispatcher — 命令模板渲染 / 队列 / 重试 / 调度下发
// 接口契约：@public/interface_stub/command-dispatcher.d.ts
// 数据契约：public/schema/command-queue-schema.json
// 表结构：  command_queue（见 db/migrations/20260703000004_create_command_queue.ts）
// 来源：scheme-final-merged.md §4.3.5 / §5.1 / §5.5 防注入校验 / §7.1 P1
// ============================================================================

import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import type { CommandDispatcher } from '@public/interface_stub/command-dispatcher';
import type { DaemonClient } from '@public/interface_stub/daemon-client';
import type { CommandPriority } from '@public/interface_stub/shared-types';
import { CommandRenderError, CommandQueueFullError } from './errors.js';

// ----- 常量 -----

/** 最大重试次数（与 command_queue.max_attempts 默认值对齐） */
const MAX_ATTEMPTS = 3;
/** 单 server 队列上限（pending + sending） */
const QUEUE_MAX_SIZE = 1000;
/** processQueue 单次处理上限（P0 简化） */
const QUEUE_BATCH_SIZE = 50;
/** nodeId 查询失败时的 P0 兜底节点 */
const LOCAL_NODE_FALLBACK = 'node-local';

/**
 * 变量值校验正则（防 Lua/SQL 注入）。
 * renderCommand 仅允许下列变量名，且每个变量的值必须严格匹配对应正则。
 * 未知变量名或校验失败的值均抛 CommandRenderError，命令不入队、不下发。
 */
export const VARIABLE_PATTERNS: Readonly<Record<string, RegExp>> = {
  player: /^[A-Za-z0-9_-]{1,32}$/,
  // v4.12.0 步骤4.2: 允许空格——TShock give 命令支持英文物品名拼写(如 "Copper Broadsword")
  // 安全性:命令通过 RCON/stdin 下发,不经 shell 解释;sanitizeTemplateVar 仍移除 shell 元字符
  item: /^[A-Za-z0-9_. -]{1,64}$/,
  count: /^[1-9][0-9]{0,5}$/, // 1-999999
  message: /^[^\n\r]{1,256}$/, // 单行，最长 256
  quality: /^(normal|uncommon|rare|epic|legendary)$/,
  reason: /^[^\n\r]{1,128}$/,
  json: /^[A-Za-z0-9_+-]{1,128}$/, // 白名单字符（简化 JSON 校验）
};

/** 模板占位符正则：{{varName}}，允许变量名两侧空白 */
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * v4.12.0 步骤6: 不带 g flag 的占位符检测正则,用于渲染后扫描残留占位符。
 *
 * 单独定义避免与 PLACEHOLDER_RE 共享 lastIndex 状态(exec 会修改 lastIndex,
 * 而 String.replace 不会重置),防止多次调用 renderCommandPure 时出现状态污染。
 */
const RESIDUAL_PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/;

/**
 * D10: 命令注入防护——模板变量值转义工具函数。
 * 移除 shell 特殊字符：$ ` | & ; > < ( ) \n \r
 * 用于在变量值渲染前做一层防御性清洗，配合 VARIABLE_PATTERNS 白名单形成双重防护。
 * @param value 待转义的变量值
 * @returns 移除 shell 特殊字符后的值
 */
export function sanitizeTemplateVar(value: string): string {
  if (typeof value !== 'string') {
    return '';
  }
  // 移除 shell 特殊字符：$ ` | & ; > < ( ) 以及换行/回车
  // 注意：不移除引号和空格，因为部分命令模板需要这些字符（如 Rust 的 +server.hostname "xxx"）
  return value.replace(/[$`|&;><()\n\r]/g, '');
}

// ----- DB 行类型 -----

/** command_queue 表行（列名以迁移脚本为准：command_text / max_attempts / last_error / sent_at） */
interface CommandQueueRow {
  id: number;
  server_id: string;
  command_text: string;
  priority: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

/** servers 表所需字段视图（仅 commandDispatcher 关心的列） */
interface ServerRow {
  id: string;
  node_id: string;
}

// ----- 纯函数 -----

/**
 * 命令模板渲染纯函数（scheme §5.5 防注入校验）。
 *
 * 不访问 DB、不使用 this、无副作用：
 *   1. 匹配 {{varName}} 占位
 *   2. varName 必须在 VARIABLE_PATTERNS 中，否则 CommandRenderError（未知变量）
 *   3. vars 必须提供该变量值，否则 CommandRenderError
 *   4. 值必须严格全串匹配对应正则，否则 CommandRenderError（含变量名和值）
 *   5. v4.12.0 步骤6: 渲染后扫描残留占位符,若仍有 {{xxx}} 残留则报错
 *      (防止 hide 降级未走 stripHiddenPlaceholders 直接下发空变量命令)
 *
 * 采用「全串匹配」校验（m[0] === value）以规避 JS 正则 `$` 在末尾换行符前的边界行为，
 * 防止形如 "12\n" 的值被 `^[1-9][0-9]{0,5}$` 误判通过。
 */
function renderCommandPure(template: string, vars: Record<string, string>): string {
  const rendered = template.replace(PLACEHOLDER_RE, (_match: string, varName: string): string => {
    const pattern = VARIABLE_PATTERNS[varName];
    if (!pattern) {
      throw new CommandRenderError(`未知变量: ${varName}`);
    }
    if (!(varName in vars)) {
      throw new CommandRenderError(`变量未提供值: ${varName}`);
    }
    const value = vars[varName];
    const m = pattern.exec(value);
    if (m === null || m[0] !== value) {
      throw new CommandRenderError(`变量 ${varName} 值非法: ${value}`);
    }
    return value;
  });

  // v4.12.0 步骤6: 渲染后扫描残留占位符。
  // 残留通常意味着模板里出现了未在 VARIABLE_PATTERNS 中声明的变量名,
  // 或者 stripHiddenPlaceholders 漏处理某个 hide 占位符。
  // 此处兜底报错,防止下发含空变量名的命令(如 "give  Steve  1")。
  // 使用不带 g flag 的 RESIDUAL_PLACEHOLDER_RE 避免 lastIndex 状态污染。
  const residual = RESIDUAL_PLACEHOLDER_RE.exec(rendered);
  if (residual !== null) {
    throw new CommandRenderError(
      `命令模板渲染后残留未替换的占位符: ${residual[0]}(模板含未知变量或未走 stripHiddenPlaceholders)`,
    );
  }

  return rendered;
}

// ----- 实现 -----

/**
 * CommandDispatcher 实现
 *
 * 设计要点：
 * - renderCommand 为同步纯函数（委托给模块级 renderCommandPure，不访问 this / DB）
 * - enqueue 在 pending+sending 计数达 QUEUE_MAX_SIZE 时拒绝入队
 * - sendViaDaemon 从 servers.node_id 解析目标节点，失败兜底 'node-local'（P0 简化）
 * - DaemonUnreachableError / InstanceNotRunningError 由 daemonClient 透传，不在此吞错
 * - retry / processQueue 的 attempts 达 max_attempts 即标记 failed
 */
export class CommandDispatcherImpl implements CommandDispatcher {
  constructor(
    private readonly db: Knex,
    private readonly daemonClient: DaemonClient,
  ) {}

  /** 渲染命令模板（同步纯函数，防注入校验） */
  renderCommand(template: string, vars: Record<string, string>): string {
    return renderCommandPure(template, vars);
  }

  /**
   * 命令入队。返回队列 ID（command_queue.id）。
   * 队列上限 QUEUE_MAX_SIZE，超限抛 CommandQueueFullError。
   */
  async enqueue(
    serverId: string,
    command: string,
    priority: CommandPriority = 'normal',
  ): Promise<number> {
    // 1. 检查队列上限（pending + sending）
    const countRow = await this.db('command_queue')
      .where({ server_id: serverId })
      .whereIn('status', ['pending', 'sending'])
      .count('id as cnt')
      .first();
    const current = Number(countRow?.cnt ?? 0);
    if (current >= QUEUE_MAX_SIZE) {
      throw new CommandQueueFullError(
        `命令队列已满 (server=${serverId}, current=${current}, limit=${QUEUE_MAX_SIZE})`,
      );
    }

    // 2. 插入队列记录（列名以迁移脚本为准：command_text）
    const now = new Date().toISOString();
    const insertResult: unknown = await this.db('command_queue').insert({
      server_id: serverId,
      command_text: command,
      priority,
      status: 'pending',
      attempts: 0,
      max_attempts: MAX_ATTEMPTS,
      last_error: null,
      created_at: now,
      sent_at: null,
    });
    // knex + SQLite: insert() 返回插入的 rowid（可能为 number 或 number[]）
    return Array.isArray(insertResult) ? Number(insertResult[0]) : Number(insertResult);
  }

  /**
   * 通过 daemonClient 直接下发命令（绕过队列）。
   * DaemonUnreachableError / InstanceNotRunningError 由 daemonClient 透传。
   */
  async sendViaDaemon(
    serverId: string,
    command: string,
    requestId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const nodeId = await this.resolveNodeId(serverId);
    return this.daemonClient.sendCommand(nodeId, serverId, command, requestId);
  }

  /**
   * 重试队列中失败的命令。attempts +1，达 max_attempts 则 status=failed，否则 status=pending。
   * 不存在的 queueId 抛 Error。
   */
  async retry(queueId: number): Promise<void> {
    const row = await this.db<CommandQueueRow>('command_queue')
      .where({ id: queueId })
      .first();
    if (!row) {
      throw new Error(`Command queue record not found: ${queueId}`);
    }
    const nextAttempts = row.attempts + 1;
    const maxAttempts = row.max_attempts || MAX_ATTEMPTS;
    if (nextAttempts >= maxAttempts) {
      await this.db<CommandQueueRow>('command_queue').where({ id: queueId }).update({
        attempts: nextAttempts,
        status: 'failed',
      });
    } else {
      await this.db<CommandQueueRow>('command_queue').where({ id: queueId }).update({
        attempts: nextAttempts,
        status: 'pending',
      });
    }
  }

  /**
   * 定时处理待发送命令。按 priority DESC, created_at ASC 排序，单次最多 QUEUE_BATCH_SIZE 条。
   * 成功 → status=sent；失败 → attempts+1，达 max_attempts 则 failed，否则保持 pending。
   */
  async processQueue(): Promise<void> {
    // priority 为字符串枚举（low/normal/high），字面量排序会得到错误顺序，使用 CASE 映射为数值
    const rows = await this.db<CommandQueueRow>('command_queue')
      .where({ status: 'pending' })
      .orderByRaw(
        "CASE priority WHEN 'high' THEN 3 WHEN 'normal' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC, created_at ASC",
      )
      .limit(QUEUE_BATCH_SIZE);

    for (const row of rows) {
      const requestId = randomUUID();
      let success = false;
      let errorMessage: string | undefined;
      try {
        const result = await this.sendViaDaemon(row.server_id, row.command_text, requestId);
        success = result.success;
        errorMessage = result.error;
      } catch (err) {
        // DaemonUnreachableError / InstanceNotRunningError 等：记为失败，不中断整批
        success = false;
        errorMessage = err instanceof Error ? err.message : String(err);
      }

      const now = new Date().toISOString();
      if (success) {
        await this.db<CommandQueueRow>('command_queue').where({ id: row.id }).update({
          status: 'sent',
          sent_at: now,
        });
      } else {
        const nextAttempts = row.attempts + 1;
        const maxAttempts = row.max_attempts || MAX_ATTEMPTS;
        if (nextAttempts >= maxAttempts) {
          await this.db<CommandQueueRow>('command_queue').where({ id: row.id }).update({
            attempts: nextAttempts,
            status: 'failed',
            last_error: errorMessage ?? null,
          });
        } else {
          // 保持 pending，仅累计 attempts 与 last_error
          await this.db<CommandQueueRow>('command_queue').where({ id: row.id }).update({
            attempts: nextAttempts,
            last_error: errorMessage ?? null,
          });
        }
      }
    }
  }

  // ----- 内部辅助 -----

  /**
   * 解析 serverId 对应的 nodeId。P0 简化：servers 表无记录或 node_id 缺失时兜底 'node-local'。
   */
  private async resolveNodeId(serverId: string): Promise<string> {
    const row = await this.db<ServerRow>('servers').where({ id: serverId }).first();
    if (!row || !row.node_id) {
      return LOCAL_NODE_FALLBACK;
    }
    return row.node_id;
  }
}

// ----- 工厂 -----

/**
 * 创建 commandDispatcher 实例
 */
export function createCommandDispatcher(db: Knex, daemonClient: DaemonClient): CommandDispatcher {
  return new CommandDispatcherImpl(db, daemonClient);
}
