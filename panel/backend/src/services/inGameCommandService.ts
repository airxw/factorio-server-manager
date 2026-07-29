// ============================================================================
// inGameCommandService — 游戏内聊天命令统一分发
// 职责：解析游戏内聊天行（! 开头命令），分发到对应业务服务，并通过 broadcast 命令下发回复
// 支持命令：
//   !verify <code>     → instanceBindingService.verifyBindingByCode
//   !claim <code>      → cdkService.redeem
//   !vk ...            → voteService.handleGameChatVoteCommand
//   !help              → 返回可用命令清单
//   !status            → 返回服务器状态（查 servers 表）
//   !players           → 返回在线玩家列表（查 player_histories 表 left_at IS NULL）
//   !uptime            → 返回服务器运行时长（查 servers.created_at，TODO: 待 Daemon 支持真实 uptime）
//
// 来源：模块10 Task 5 / 参考 factorio 项目 chatMonitor.ts handleAutoReply
// ============================================================================

import type { Knex } from 'knex';
import type { PackRegistry } from '../core/packs/registry.js';
import type { CommandDispatcher } from '@public/interface_stub/command-dispatcher';
import type { CommandPriority } from '@public/interface_stub/shared-types';
import type { CdkServiceImpl } from './cdkService.js';
import type { VoteServiceImpl, GameChatVoteResult } from './voteService.js';
import { CommandRenderError } from './errors.js';

// ----- 依赖接口（结构化类型，便于测试 mock） -----

/**
 * inGameCommandService 的外部依赖集合。
 *
 * 设计说明：
 * - commandDispatcher / cdkService / voteService 用 Pick 收窄到仅需要的方法，便于单测 mock
 * - verifyBindingByCode 是 instanceBindingService.ts 的模块级导出函数（非类方法），此处按函数签名注入
 * - db / registry 作为独立构造参数（与 cdkService / voteService 等现有服务风格一致）
 */
export interface InGameCommandServiceDeps {
  readonly commandDispatcher: Pick<CommandDispatcher, 'renderCommand' | 'enqueue'>;
  readonly cdkService: Pick<CdkServiceImpl, 'redeem'>;
  readonly voteService: Pick<VoteServiceImpl, 'handleGameChatVoteCommand'>;
  readonly verifyBindingByCode: (
    gamePlayerName: string,
    code: string,
    serverId: string,
  ) => Promise<{ success: boolean; message: string }>;
  /** !register 命令：游戏内注册面板账号 */
  readonly registerUser: (
    email: string,
    username: string,
    password: string,
    gamePlayerName: string,
    serverId: string,
  ) => Promise<{ success: boolean; message: string }>;
}

// ----- DB 行类型（仅本服务关心的列） -----

/** servers 表行视图（status / created_at / pack_id） */
interface ServerRow {
  id: string;
  pack_id: string;
  status: string;
  created_at: string;
}

/** player_histories 表行视图（在线玩家查询） */
interface PlayerHistoryRow {
  id: number;
  server_id: string;
  game_player_name: string;
  joined_at: string;
  left_at: string | null;
}

// ----- 常量 -----

/** broadcast 模板渲染时 message 变量的最大长度（受 VARIABLE_PATTERNS.message 约束：/^[^\n\r]{1,256}$/） */
const MESSAGE_MAX_LEN = 256;
/** reason 变量的最大长度（受 VARIABLE_PATTERNS.reason 约束：/^[^\n\r]{1,128}$/） */
const REASON_MAX_LEN = 128;
/** player 变量的最大长度（受 VARIABLE_PATTERNS.player 约束：/^[A-Za-z0-9_-]{1,32}$/） */
const PLAYER_MAX_LEN = 32;

// ----- 实现 -----

/**
 * InGameCommandService 实现
 *
 * 设计要点：
 * - tryHandle 返回 true 表示命中内置命令（已处理），false 表示非内置命令（应走 chat_trigger 路径）
 * - reply 通过 pack.commands.broadcast 模板下发，渲染失败或无模板时降级为 say 命令
 * - 多行消息（如 !help）按行拆分逐条下发，每行截断到 MESSAGE_MAX_LEN
 * - 单个命令分支异常不影响其他命令（try/catch 隔离）
 * - !verify / !claim 不走冷却（关键操作），与 factorio chatMonitor.handleAutoReply 一致
 */
export class InGameCommandServiceImpl {
  constructor(
    private readonly db: Knex,
    private readonly registry: PackRegistry,
    private readonly deps: InGameCommandServiceDeps,
  ) {}

  /**
   * 尝试处理游戏内聊天命令。
   * @returns true 表示命中内置命令（已处理），false 表示非内置命令（应走 chat_trigger 路径）
   */
  async tryHandle(serverId: string, player: string, message: string): Promise<boolean> {
    const trimmed = message.trim();
    if (!trimmed.startsWith('!')) {
      return false;
    }

    // 统一用小写匹配命令名（命令本身不区分大小写）
    const lowerCmd = trimmed.toLowerCase();

    try {
      // !verify <code>
      if (lowerCmd === '!verify' || lowerCmd.startsWith('!verify ')) {
        return await this.handleVerify(serverId, player, trimmed);
      }

      // !claim <code>
      if (lowerCmd === '!claim' || lowerCmd.startsWith('!claim ')) {
        return await this.handleClaim(serverId, player, trimmed);
      }

      // !register <email> <password> 或 !register <email> <username> <password>
      if (lowerCmd === '!register' || lowerCmd.startsWith('!register ')) {
        return await this.handleRegister(serverId, player, trimmed);
      }

      // !vk 委托 voteService
      if (lowerCmd === '!vk' || lowerCmd.startsWith('!vk ')) {
        return await this.handleVote(serverId, player, trimmed);
      }

      // !help
      if (lowerCmd === '!help') {
        return await this.handleHelp(serverId);
      }

      // !status
      if (lowerCmd === '!status') {
        return await this.handleStatus(serverId);
      }

      // !players
      if (lowerCmd === '!players') {
        return await this.handlePlayers(serverId);
      }

      // !uptime
      if (lowerCmd === '!uptime') {
        return await this.handleUptime(serverId);
      }

      // 未知 ! 命令 → 走 chat_trigger 路径
      return false;
    } catch (err) {
      console.error(
        '[inGameCommandService] tryHandle 异常:',
        err instanceof Error ? err.message : String(err),
        { serverId, player, message },
      );
      return false;
    }
  }

  // ----- 命令分支 -----

  /**
   * !verify <code> — 绑定游戏账号到面板。
   * 委托 instanceBindingService.verifyBindingByCode，该函数会抛出 VerifyCodeNotFoundError /
   * VerifyCodeAlreadyUsedError / VerifyCodeExpiredError / PlayerBindingMismatchError 等，
   * 此处 try/catch 捕获后回复错误消息。
   */
  private async handleVerify(serverId: string, player: string, trimmed: string): Promise<boolean> {
    const code = trimmed.slice('!verify'.length).trim();
    if (!code) {
      await this.reply(serverId, '用法: !verify <验证码>');
      return true;
    }
    try {
      const result = await this.deps.verifyBindingByCode(player, code, serverId);
      await this.reply(serverId, result.message);
    } catch (err) {
      await this.reply(
        serverId,
        `绑定失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return true;
  }

  /**
   * !claim <code> — 兑换 CDK。
   * 委托 cdkService.redeem，成功返回 { code: CdkCodeSummary, delivered: true }，
   * 失败抛出 CdkNotFoundError / CdkAlreadyClaimedError / CdkExpiredError 等。
   */
  private async handleClaim(serverId: string, player: string, trimmed: string): Promise<boolean> {
    const code = trimmed.slice('!claim'.length).trim();
    if (!code) {
      await this.reply(serverId, '用法: !claim <兑换码>');
      return true;
    }
    try {
      const result = await this.deps.cdkService.redeem(serverId, {
        code,
        player_name: player,
      });
      if (result.delivered) {
        await this.reply(
          serverId,
          `兑换成功，已发放 ${result.code.count} 个 ${result.code.item_name} 到 ${player}`,
        );
      } else {
        // 理论不可达（redeem 成功即 delivered=true），防御性处理
        await this.reply(serverId, '兑换失败');
      }
    } catch (err) {
      await this.reply(
        serverId,
        `兑换失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return true;
  }

  /**
   * !vk — 委托 voteService.handleGameChatVoteCommand。
   * 返回 { handled: false } 时表示非投票命令，回传 false 让调用方继续 chat_trigger 路径。
   * 返回 kick_target 时下发 kick 命令（优先用 pack.commands.kick_player 模板）。
   */
  private async handleVote(
    serverId: string,
    player: string,
    trimmed: string,
  ): Promise<boolean> {
    const result: GameChatVoteResult = await this.deps.voteService.handleGameChatVoteCommand(
      serverId,
      player,
      trimmed,
    );
    if (!result.handled) {
      return false;
    }
    if (result.message) {
      await this.reply(serverId, result.message);
    }
    if (result.kick_target) {
      await this.enqueueKick(serverId, result.kick_target, result.kick_reason);
    }
    return true;
  }

  /**
   * !register — 游戏内注册面板账号。
   * 命令格式：
   *   !register <邮箱> <密码>           — 用户名默认使用游戏玩家名
   *   !register <邮箱> <用户名> <密码>   — 指定用户名
   *
   * 成功后自动创建 pending 玩家绑定记录（game_player_name 使用当前玩家名）。
   * 后续玩家可在 Web 面板使用 !verify 完成绑定验证。
   */
  private async handleRegister(
    serverId: string,
    player: string,
    trimmed: string,
  ): Promise<boolean> {
    const parts = trimmed.slice('!register'.length).trim().split(/\s+/);
    if (parts.length < 2) {
      await this.reply(serverId, '用法: !register <邮箱> <密码> 或 !register <邮箱> <用户名> <密码>');
      return true;
    }

    let email: string;
    let username: string;
    let password: string;

    if (parts.length >= 3) {
      [email, username, password] = parts;
    } else {
      [email, password] = parts;
      username = player;
    }

    // 基本格式校验
    if (!email.includes('@') || email.length > 128) {
      await this.reply(serverId, '注册失败: 邮箱格式不合法');
      return true;
    }
    if (password.length < 6) {
      await this.reply(serverId, '注册失败: 密码至少 6 位');
      return true;
    }
    if (username.length < 2 || username.length > 32) {
      await this.reply(serverId, '注册失败: 用户名长度需 2-32 字符');
      return true;
    }

    try {
      const result = await this.deps.registerUser(email, username, password, player, serverId);
      await this.reply(serverId, result.message);
    } catch (err) {
      await this.reply(
        serverId,
        `注册失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return true;
  }

  /** !help — 返回可用命令清单 */
  private async handleHelp(serverId: string): Promise<boolean> {
    const helpText = [
      '=== 可用命令 ===',
      '!register <邮箱> <密码> - 注册面板账号（可加用户名）',
      '!verify <验证码> - 绑定游戏账号到面板',
      '!claim <兑换码> - 兑换 CDK 物品',
      '!vk <玩家名> - 发起投票踢人',
      '!vk yes/no - 投票赞成/反对',
      '!status - 服务器状态',
      '!players - 在线玩家',
      '!uptime - 运行时长',
    ].join('\n');
    await this.reply(serverId, helpText);
    return true;
  }

  /** !status — 查 servers 表返回服务器状态 */
  private async handleStatus(serverId: string): Promise<boolean> {
    try {
      const row = await this.db<ServerRow>('servers')
        .select('status')
        .where({ id: serverId })
        .first();
      if (!row) {
        await this.reply(serverId, '服务器不存在');
      } else {
        await this.reply(serverId, `服务器状态: ${row.status}`);
      }
    } catch (err) {
      console.error(
        '[inGameCommandService] !status 查询失败:',
        err instanceof Error ? err.message : String(err),
      );
      await this.reply(serverId, '获取状态失败');
    }
    return true;
  }

  /** !players — 查 player_histories 表 left_at IS NULL 返回在线玩家 */
  private async handlePlayers(serverId: string): Promise<boolean> {
    try {
      const rows = await this.db<PlayerHistoryRow>('player_histories')
        .where({ server_id: serverId })
        .whereNull('left_at')
        .orderBy('joined_at', 'asc');
      if (rows.length === 0) {
        await this.reply(serverId, '当前无在线玩家');
      } else {
        const names = rows.map((r) => r.game_player_name).join(', ');
        await this.reply(serverId, `在线玩家 (${rows.length}): ${names}`);
      }
    } catch (err) {
      console.error(
        '[inGameCommandService] !players 查询失败:',
        err instanceof Error ? err.message : String(err),
      );
      await this.reply(serverId, '获取玩家列表失败');
    }
    return true;
  }

  /**
   * !uptime — 查 servers.created_at 计算运行时长。
   * TODO: servers.created_at 是服务器记录创建时间，非实例实际启动时间。
   *       待 Daemon 接口扩展 uptime 字段后，应改为调用 daemonClient 获取真实运行时长。
   */
  private async handleUptime(serverId: string): Promise<boolean> {
    try {
      const row = await this.db<ServerRow>('servers')
        .select('status', 'created_at')
        .where({ id: serverId })
        .first();
      if (!row) {
        await this.reply(serverId, '服务器不存在');
        return true;
      }
      if (row.status !== 'running') {
        await this.reply(serverId, `服务器未运行（当前状态: ${row.status}）`);
        return true;
      }
      // TODO: 此处用 created_at 近似（服务器记录创建时间），非真实实例启动时间
      const createdAt = new Date(row.created_at).getTime();
      const uptimeSeconds = Math.floor((Date.now() - createdAt) / 1000);
      const hours = Math.floor(uptimeSeconds / 3600);
      const minutes = Math.floor((uptimeSeconds % 3600) / 60);
      await this.reply(serverId, `运行时长: ${hours}小时${minutes}分钟`);
    } catch (err) {
      console.error(
        '[inGameCommandService] !uptime 查询失败:',
        err instanceof Error ? err.message : String(err),
      );
      await this.reply(serverId, '获取运行时长失败');
    }
    return true;
  }

  // ----- 回复与命令下发 -----

  /**
   * 通过 broadcast 命令下发回复。
   *
   * 多行消息按行拆分逐条下发（renderCommand 的 message 变量不允许换行符）。
   * 每行截断到 MESSAGE_MAX_LEN（256 字符）以通过 renderCommand 校验。
   * 模板渲染失败（CommandRenderError）或无 broadcast 模板时降级为 `say <line>`。
   */
  private async reply(serverId: string, message: string): Promise<void> {
    const lines = message.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) {
      return;
    }

    const template = await this.getBroadcastTemplate(serverId);

    for (const line of lines) {
      const truncated = line.length > MESSAGE_MAX_LEN ? line.slice(0, MESSAGE_MAX_LEN) : line;
      let cmd: string;
      if (template) {
        try {
          cmd = this.deps.commandDispatcher.renderCommand(template, { message: truncated });
        } catch {
          // renderCommand 校验失败（如含特殊字符）→ 降级 say
          cmd = `say ${truncated}`;
        }
      } else {
        // 无 broadcast 模板 → 降级 say
        cmd = `say ${truncated}`;
      }
      try {
        await this.deps.commandDispatcher.enqueue(serverId, cmd, 'normal' as CommandPriority);
      } catch (err) {
        console.error(
          '[inGameCommandService] reply 入队失败:',
          err instanceof Error ? err.message : String(err),
          { serverId, cmd },
        );
      }
    }
  }

  /**
   * 下发 kick 命令。
   * 优先用 pack.commands.kick_player 模板（渲染 {{player}} {{reason}}），
   * 模板不存在或渲染失败时降级为 `kick <player> <reason>`。
   */
  private async enqueueKick(
    serverId: string,
    target: string,
    reason?: string,
  ): Promise<void> {
    const kickReason = (reason ?? '投票踢出').slice(0, REASON_MAX_LEN);
    const playerVal = target.slice(0, PLAYER_MAX_LEN);

    const template = await this.getKickTemplate(serverId);
    let cmd: string;
    if (template) {
      try {
        cmd = this.deps.commandDispatcher.renderCommand(template, {
          player: playerVal,
          reason: kickReason,
        });
      } catch (err) {
        if (err instanceof CommandRenderError) {
          // player 名含非允许字符 → 降级直接 kick
          cmd = `kick ${playerVal} ${kickReason}`;
        } else {
          throw err;
        }
      }
    } else {
      cmd = `kick ${playerVal} ${kickReason}`;
    }

    try {
      await this.deps.commandDispatcher.enqueue(serverId, cmd, 'high' as CommandPriority);
      await this.reply(serverId, `投票通过，${target} 已被踢出`);
    } catch (err) {
      console.error(
        '[inGameCommandService] kick 命令入队失败:',
        err instanceof Error ? err.message : String(err),
        { serverId, cmd },
      );
      await this.reply(serverId, `踢出 ${target} 失败，请管理员手动处理`);
    }
  }

  // ----- Pack 模板查询 -----

  /**
   * 获取 server 对应 pack 的 broadcast 命令模板。
   * 查 servers.pack_id → registry.getCommands(packId).broadcast
   */
  private async getBroadcastTemplate(serverId: string): Promise<string | null> {
    try {
      const server = await this.db<ServerRow>('servers')
        .select('pack_id')
        .where({ id: serverId })
        .first();
      if (!server) {
        return null;
      }
      const commands = this.registry.getCommands(server.pack_id);
      if (!commands || !commands.broadcast) {
        return null;
      }
      return commands.broadcast;
    } catch (err) {
      console.error(
        '[inGameCommandService] getBroadcastTemplate 查询失败:',
        err instanceof Error ? err.message : String(err),
        { serverId },
      );
      return null;
    }
  }

  /**
   * 获取 server 对应 pack 的 kick 命令模板。
   * 优先 commands.kick_player，其次 business.players.kick_command。
   */
  private async getKickTemplate(serverId: string): Promise<string | null> {
    try {
      const server = await this.db<ServerRow>('servers')
        .select('pack_id')
        .where({ id: serverId })
        .first();
      if (!server) {
        return null;
      }
      const commands = this.registry.getCommands(server.pack_id);
      if (commands && commands.kick_player) {
        return commands.kick_player;
      }
      // 降级：查 business.players.kick_command
      const pack = this.registry.get(server.pack_id);
      if (pack?.business?.players?.kick_command) {
        return pack.business.players.kick_command;
      }
      return null;
    } catch (err) {
      console.error(
        '[inGameCommandService] getKickTemplate 查询失败:',
        err instanceof Error ? err.message : String(err),
        { serverId },
      );
      return null;
    }
  }
}

// ----- 工厂 -----

/**
 * 创建 inGameCommandService 实例。
 *
 * @param db Knex 实例（用于查询 servers / player_histories 表）
 * @param registry Pack 注册表（用于查询 pack.commands.broadcast / kick_player 模板）
 * @param deps 外部服务依赖（commandDispatcher / cdkService / voteService / verifyBindingByCode）
 */
export function createInGameCommandService(
  db: Knex,
  registry: PackRegistry,
  deps: InGameCommandServiceDeps,
): InGameCommandServiceImpl {
  return new InGameCommandServiceImpl(db, registry, deps);
}
