// ============================================================================
// playerManagementService — 玩家管理操作（D1-D3: MSLX 借鉴）
// 职责：通过 commandDispatcher 渲染 pack 命令模板并下发到游戏服务器
// 支持：kick / ban / pardon / op / deop / whitelist add / whitelist remove
// 数据契约：public/schema/panel-api-types.ts（PlayerActionRequest/Response, OnlinePlayer）
// 来源：MSLX 玩家管理面板借鉴 — 实时操作在线玩家 + 列表管理
// ============================================================================

import type { Knex } from 'knex';
import type { PackRegistry } from '../core/packs/registry.js';
import type { CommandDispatcher } from '@public/interface_stub/command-dispatcher';
import type { CommandPriority } from '@public/interface_stub/shared-types';
import type { OnlinePlayer } from '@public/schema/panel-api-types';
import { InstanceNotFoundError } from './errors.js';

// ----- DB 行类型 -----

interface ServerRow {
  id: string;
  pack_id: string;
}

interface PlayerHistoryRow {
  id: number;
  server_id: string;
  game_player_name: string;
  joined_at: string;
  left_at: string | null;
}

// ----- 默认命令模板（pack 未定义时兜底） -----

const DEFAULT_TEMPLATES: Record<string, string> = {
  kick_player: 'kick {{player}} {{reason}}',
  ban_player: 'ban {{player}} {{reason}}',
  pardon_player: 'pardon {{player}}',
  op_player: 'op {{player}}',
  deop_player: 'deop {{player}}',
  whitelist_add: 'whitelist add {{player}}',
  whitelist_remove: 'whitelist remove {{player}}',
  // v4.13.0 步骤16: GM Workbench 发放补偿（give 命令）
  give_item: 'give {{player}} {{item}} {{count}}',
};

// ----- 服务实现 -----

export class PlayerManagementServiceImpl {
  constructor(
    private readonly db: Knex,
    private readonly registry: PackRegistry,
    private readonly commandDispatcher: Pick<CommandDispatcher, 'renderCommand' | 'enqueue'>,
  ) {}

  /**
   * 踢出玩家。
   * 命令模板来源（优先级递减）：
   *   1. pack.commands.kick_player
   *   2. pack.business.players.kick_command
   *   3. DEFAULT_TEMPLATES.kick_player
   */
  async kickPlayer(
    serverId: string,
    playerName: string,
    reason?: string,
  ): Promise<{ success: boolean; command: string; error?: string }> {
    return this.executePlayerCommand(serverId, 'kick_player', {
      player: playerName,
      reason: reason ?? 'Kicked by admin',
    }, 'high', [
      'business.players.kick_command',
    ]);
  }

  /**
   * 封禁玩家。
   * 命令模板来源：
   *   1. pack.commands.ban_player
   *   2. pack.business.players.ban_command
   *   3. DEFAULT_TEMPLATES.ban_player
   */
  async banPlayer(
    serverId: string,
    playerName: string,
    reason?: string,
  ): Promise<{ success: boolean; command: string; error?: string }> {
    return this.executePlayerCommand(serverId, 'ban_player', {
      player: playerName,
      reason: reason ?? 'Banned by admin',
    }, 'high', [
      'business.players.ban_command',
    ]);
  }

  /**
   * 解除封禁。
   * 命令模板来源：
   *   1. pack.commands.pardon_player
   *   2. DEFAULT_TEMPLATES.pardon_player
   */
  async pardonPlayer(
    serverId: string,
    playerName: string,
  ): Promise<{ success: boolean; command: string; error?: string }> {
    return this.executePlayerCommand(serverId, 'pardon_player', {
      player: playerName,
    }, 'normal');
  }

  /**
   * v4.13.0 步骤16: 发放补偿（give 物品）。
   * 命令模板来源：
   *   1. pack.commands.give_item
   *   2. pack.business.players.give_command
   *   3. DEFAULT_TEMPLATES.give_item
   */
  async giveItem(
    serverId: string,
    playerName: string,
    item: string,
    count: number,
  ): Promise<{ success: boolean; command: string; error?: string }> {
    return this.executePlayerCommand(serverId, 'give_item', {
      player: playerName,
      item,
      count: String(count),
    }, 'normal', [
      'business.players.give_command',
    ]);
  }

  /**
   * 授予 OP 权限。
   * 命令模板来源：
   *   1. pack.commands.op_player
   *   2. DEFAULT_TEMPLATES.op_player
   */
  async opPlayer(
    serverId: string,
    playerName: string,
  ): Promise<{ success: boolean; command: string; error?: string }> {
    return this.executePlayerCommand(serverId, 'op_player', {
      player: playerName,
    }, 'normal');
  }

  /**
   * 撤销 OP 权限。
   * 命令模板来源：
   *   1. pack.commands.deop_player
   *   2. DEFAULT_TEMPLATES.deop_player
   */
  async deopPlayer(
    serverId: string,
    playerName: string,
  ): Promise<{ success: boolean; command: string; error?: string }> {
    return this.executePlayerCommand(serverId, 'deop_player', {
      player: playerName,
    }, 'normal');
  }

  /**
   * 添加白名单。
   * 命令模板来源：
   *   1. pack.commands.whitelist_add
   *   2. pack.business.lists.whitelist_add
   *   3. DEFAULT_TEMPLATES.whitelist_add
   */
  async whitelistAdd(
    serverId: string,
    playerName: string,
  ): Promise<{ success: boolean; command: string; error?: string }> {
    return this.executePlayerCommand(serverId, 'whitelist_add', {
      player: playerName,
    }, 'normal', [
      'business.lists.whitelist_add',
    ]);
  }

  /**
   * 移除白名单。
   * 命令模板来源：
   *   1. pack.commands.whitelist_remove
   *   2. DEFAULT_TEMPLATES.whitelist_remove
   */
  async whitelistRemove(
    serverId: string,
    playerName: string,
  ): Promise<{ success: boolean; command: string; error?: string }> {
    return this.executePlayerCommand(serverId, 'whitelist_remove', {
      player: playerName,
    }, 'normal');
  }

  /**
   * 查询在线玩家（从 player_histories 表，left_at IS NULL）。
   */
  async listOnlinePlayers(serverId: string): Promise<OnlinePlayer[]> {
    const rows = await this.db<PlayerHistoryRow>('player_histories')
      .where({ server_id: serverId })
      .whereNull('left_at')
      .orderBy('joined_at', 'asc');
    return rows.map((r) => ({
      username: r.game_player_name,
      joined_at: new Date(r.joined_at).getTime(),
    }));
  }

  // ---- 内部辅助 ----

  /**
   * 统一的玩家命令执行逻辑：
   *   1. 查询 server.pack_id
   *   2. 从 pack.commands / business / DEFAULT_TEMPLATES 获取模板
   *   3. commandDispatcher.renderCommand 渲染
   *   4. commandDispatcher.enqueue 入队
   */
  private async executePlayerCommand(
    serverId: string,
    commandKey: string,
    vars: Record<string, string>,
    priority: CommandPriority,
    businessFallbacks?: string[],
  ): Promise<{ success: boolean; command: string; error?: string }> {
    // 1. 查询 server
    const server = await this.db<ServerRow>('servers')
      .select('id', 'pack_id')
      .where({ id: serverId })
      .first();
    if (!server) {
      throw new InstanceNotFoundError(`实例不存在: ${serverId}`);
    }

    // 2. 获取命令模板
    const template = this.resolveTemplate(server.pack_id, commandKey, businessFallbacks);

    // 3. 渲染命令
    let command: string;
    try {
      command = this.commandDispatcher.renderCommand(template, vars);
    } catch {
      // renderCommand 校验失败（如 player 名含非允许字符）
      // 降级：直接用 vars 拼接（不做模板渲染）
      const player = vars.player ?? '';
      const reason = vars.reason ?? '';
      command = `${commandKey.replace(/_/g, ' ')} ${player} ${reason}`.trim();
    }

    // 4. 入队
    try {
      await this.commandDispatcher.enqueue(serverId, command, priority);
      return { success: true, command };
    } catch (err) {
      return {
        success: false,
        command,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 解析命令模板（优先级递减）：
   *   1. pack.commands[commandKey]
   *   2. businessFallbacks 中指定的 business 路径
   *   3. DEFAULT_TEMPLATES[commandKey]
   */
  private resolveTemplate(
    packId: string,
    commandKey: string,
    businessFallbacks?: string[],
  ): string {
    // 1. pack.commands
    const commands = this.registry.getCommands(packId);
    if (commands && commands[commandKey]) {
      return commands[commandKey];
    }

    // 2. business fallbacks
    if (businessFallbacks && businessFallbacks.length > 0) {
      const pack = this.registry.get(packId);
      if (pack) {
        for (const path of businessFallbacks) {
          const template = this.getNestedProperty(pack, path);
          if (typeof template === 'string' && template.length > 0) {
            return template;
          }
        }
      }
    }

    // 3. DEFAULT_TEMPLATES
    return DEFAULT_TEMPLATES[commandKey] ?? `${commandKey.replace(/_/g, ' ')} {{player}}`;
  }

  /** 从对象中按点号路径获取嵌套属性 */
  private getNestedProperty(obj: unknown, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (typeof current !== 'object' || current === null) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}

// ----- 工厂 -----

export function createPlayerManagementService(
  db: Knex,
  registry: PackRegistry,
  commandDispatcher: CommandDispatcher,
): PlayerManagementServiceImpl {
  return new PlayerManagementServiceImpl(db, registry, commandDispatcher);
}
