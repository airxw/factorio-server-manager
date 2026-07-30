// ============================================================================
// instanceBindingService — VIP-实例绑定关系管理（v4.17.0 改造为统一 bindings 表）
//
// v4.17.0 改造说明：
// - 旧表 user_instance_bindings / player_verify_codes / player_bindings 已物理删除
// - 全部数据统一到 bindings 表（binding_type + scope_type + scope_ref 多态引用）
// - 对外 API 签名（bindInstance / unbindInstance / getUserVipLevel / ...）保持兼容
// - 内部字段映射：
//   * 旧表 user_instance_bindings.status='active'  ↔ bindings.verify_status='verified'
//   * 旧表 user_instance_bindings.status='unbound' ↔ bindings.verify_status='revoked'
//   * 旧表 user_instance_bindings.server_id        ↔ bindings.scope_ref (binding_type='account', scope_type='instance')
//   * 旧表 user_instance_bindings.vip_expires_at   ↔ bindings.metadata.vip_expires_at (JSON 字段)
//   * 旧表 user_instance_bindings.bound_at          ↔ bindings.verified_at
//   * 旧表 user_instance_bindings.unbound_at        ↔ bindings.metadata.unbound_at (JSON 字段)
//   * 旧表 player_verify_codes                      ↔ bindings WHERE binding_type='player', scope_type='instance', verify_status='pending'
//   * 旧表 player_bindings                          ↔ bindings WHERE binding_type='player', scope_type='game_type'
// - 旧表 player_bindings 与 player_verify_codes 在新表中通过 scope_type 区分：
//   * scope_type='game_type' → 跨实例全局玩家绑定（原 player_bindings 语义，v4.27.0 已废弃）
//   * scope_type='instance'  → 实例级玩家绑定 / 玩家验证码（原 player_verify_codes 语义）
//
// v4.27.0 改造：
// - 玩家角色绑定从 scope_type='game_type'（跨实例全局）改为 scope_type='instance', scope_ref=server_id（实例级）
// - verifyBindingByCode 事务中删除 step 2「创建/更新 player 全局绑定 scope_type='game_type'」整段
//   （step 1 的 pending → verified 已足够让下游查询到 verified 实例级玩家绑定）
// - getVipLevelByGamePlayerName 改为直接按 server_id + player_name 查 scope_type='instance', verify_status='verified'，不再 JOIN servers 表
// - 旧 scope_type='game_type' 的 player 绑定记录由迁移脚本 20260727100000 物理删除
// ============================================================================

import { getDatabase } from '../db/connection.js';
import { Role, normalizeRole } from '../core/auth/roles.js';
import {
  BindingAlreadyExistsError,
  BindingNotFoundError,
  VerifyCodeNotFoundError,
  VerifyCodeExpiredError,
  PlayerBindingMismatchError,
} from './errors.js';
import type { VerifyCodeSummary } from '@public/schema/panel-api-types';
// v4.38.0: verifyBindingByCode 事务提交后 emit Panel 内部事件 + RCON 广播 VIP 欢迎语
import { eventBus, PLAYER_BINDING_VERIFIED } from './eventBus.js';

// ----- 类型 -----

/**
 * 兼容旧调用方的绑定记录视图（路由层直接消费此类型）。
 * v4.17.0 内部从 bindings 表查询后转换为此结构。
 */
export interface BindingRecord {
  id: number;
  user_id: string;
  server_id: string;
  vip_level: number;
  vip_expires_at: string | null;
  status: string; // 'active' | 'unbound'（派生自 verify_status）
  bound_at: string; // ISO 8601
  unbound_at: string | null; // ISO 8601
}

/** listInstanceBindings 返回行：绑定记录 + 用户名（JOIN users） */
export type InstanceBindingWithUsername = BindingRecord & { username: string };

/** servers 表所需字段视图 */
interface ServerRow {
  id: string;
  owner_user_id: string;
  game_type: string;
}

/** users 表所需字段视图（getVipLevelByGamePlayerName 反查角色用） */
interface UserRow {
  id: string;
  role: string;
}

/** instance_admin / server_admin / owner 在实例上的固定 VIP 等级 */
const OWNER_VIP_LEVEL = 5;
/**
 * 游戏角色验证通过后赋予的默认 VIP 等级（仅 verifyBindingByCode 使用）。
 * v4.38.0 spec 决策 1：bindInstance 创建的账户级绑定 vip_level=0（无 VIP），
 * VIP 仅在 verifyBindingByCode 游戏角色验证通过后赋予。
 */
const DEFAULT_BOUND_VIP_LEVEL = 1;

/** 游戏内 !verify 验证码 TTL：5 分钟 */
const VERIFY_CODE_TTL_MS = 5 * 60 * 1000;
/** 验证码字符集（去除易混淆字符 I/L/O/0/1） */
const VERIFY_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** 验证码长度 */
const VERIFY_CODE_LEN = 6;

/**
 * v4.17.0 统一 bindings 表行类型。
 */
interface BindingRow {
  id: number;
  user_id: string;
  binding_type: string; // 'account' | 'player'
  scope_type: string; // 'instance' | 'game_type' | 'global'
  scope_ref: string | null;
  player_name: string | null;
  vip_level: number;
  wallet_id: string | null;
  verify_status: string; // 'pending' | 'verified' | 'expired' | 'revoked'
  verify_code: string | null;
  verify_expires_at: string | null;
  verified_at: string | null;
  metadata: string; // JSON 字符串
  created_at: string;
  updated_at: string;
}

/** metadata JSON 中的扩展字段（v4.17.0 自定义字段） */
interface BindingMetadata {
  source?: string;
  legacy_status?: string;
  legacy_used_at?: string | null;
  vip_expires_at?: string | null;
  unbound_at?: string | null;
  [key: string]: unknown;
}

// ----- v4.38.0: verifyBindingByCode RCON 广播依赖（模块级 setter 注入） -----
//
// 依赖注入方式说明（tasks.md Task 3 步骤 2）：
//   verifyBindingByCode 是模块级导出函数（非类方法，无构造器 DI）。
//   playerService / daemonClientService 在 services-init.ts 中通过工厂函数实例化，
//   非 module-level singleton，无法直接 import。采用模块级 setter 模式
//   （services-init 注入的一种形式，tasks.md 明确允许并要求说明）：
//   - services-init.ts 创建完 playerService / daemonClientService 后调用 setInstanceBindingServiceDeps
//   - 测试通过 setInstanceBindingServiceDeps 注入 mock
//   - 未注入时 _deps=null，verifyBindingByCode 静默跳过广播（不阻塞主流程）

/** verifyBindingByCode 广播所需的下游服务（仅声明用到的子集方法，解耦具体类） */
interface InstanceBindingServiceDeps {
  playerService: {
    getVipWelcomeMessage(serverId: string, vipLevel: number): Promise<string | null>;
  };
  daemonClientService: {
    sendCommand(
      nodeId: string,
      serverId: string,
      command: string,
      requestId: string,
    ): Promise<{ success: boolean; error?: string }>;
  };
}

let _deps: InstanceBindingServiceDeps | null = null;

/**
 * 注入 verifyBindingByCode 广播所需的下游服务。
 * 由 services-init.ts 在创建 playerService / daemonClientService 后调用。
 * 传 null 重置（仅供测试隔离）。
 */
export function setInstanceBindingServiceDeps(deps: InstanceBindingServiceDeps | null): void {
  _deps = deps;
}

// ----- 业务函数 -----

/**
 * 绑定实例（user 调用），创建账户级绑定（无 VIP）。
 *
 * v4.38.0 强制游戏角色绑定才能获得 VIP（spec 决策 1）：
 *   - bindInstance 创建的账户级绑定 vip_level=0（不赋予 VIP）
 *   - VIP 仅由 verifyBindingByCode 游戏角色验证路径赋予（vip_level=1）
 *   - 直接绑定（公开实例）与审批通过（私有实例）均调用此函数，vip_level 行为统一为 0
 *
 * v4.17.0 实现：在 bindings 表中创建/复活 binding_type='account', scope_type='instance' 的记录。
 *
 * 逻辑：
 *   - 无记录 → INSERT (verify_status='verified', vip_level=0, verified_at=now)
 *   - 已有记录且 verify_status='revoked' → UPDATE 复活为 verified + vip_level=0
 *   - 已有记录且 verify_status='verified' → 抛出 BindingAlreadyExistsError（路由层映射 409）
 *
 * 使用事务包裹 SELECT+INSERT/UPDATE，避免并发下的 TOCTOU 竞态。
 *
 * 注：partial UNIQUE INDEX 保证 (user_id, binding_type='account', scope_type='instance', scope_ref)
 *     在 verify_status='verified' 时唯一，并发场景下重复 INSERT 会被数据库拒绝（应用层捕获并映射 409）。
 */
export async function bindInstance(userId: string, serverId: string): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();

  // 校验实例存在（不要求 running，只要实例记录存在即可绑定）
  const server = await db<ServerRow>('servers').select('id').where({ id: serverId }).first();
  if (!server) {
    throw new BindingNotFoundError(`实例不存在: ${serverId}`);
  }

  await db.transaction(async (trx) => {
    const existing = await trx<BindingRow>('bindings')
      .where({
        user_id: userId,
        binding_type: 'account',
        scope_type: 'instance',
        scope_ref: serverId,
      })
      .first();

    if (!existing) {
      try {
        await trx('bindings').insert({
          user_id: userId,
          binding_type: 'account',
          scope_type: 'instance',
          scope_ref: serverId,
          player_name: null,
          // v4.38.0 spec 决策 1：账户级绑定不赋予 VIP（vip_level=0），VIP 仅由 verifyBindingByCode 赋予
          vip_level: 0,
          wallet_id: null,
          verify_status: 'verified',
          verify_code: null,
          verify_expires_at: null,
          verified_at: now,
          metadata: JSON.stringify({
            source: 'bindInstance',
            vip_expires_at: null,
            unbound_at: null,
          }),
          created_at: now,
          updated_at: now,
        });
      } catch (err) {
        // 并发场景：partial UNIQUE INDEX 拒绝重复 verified 记录
        if (isUniqueConstraintError(err)) {
          throw new BindingAlreadyExistsError(
            `用户 ${userId} 已绑定实例 ${serverId}（active），请先解绑`,
          );
        }
        throw err;
      }
      return;
    }

    if (existing.verify_status === 'verified') {
      throw new BindingAlreadyExistsError(
        `用户 ${userId} 已绑定实例 ${serverId}（active），请先解绑`,
      );
    }

    // verify_status === 'revoked' 或 'expired' → 复活记录
    const oldMeta = parseMetadata(existing.metadata);
    await trx<BindingRow>('bindings')
      .where({ id: existing.id })
      .update({
        verify_status: 'verified',
        // v4.38.0 spec 决策 1：账户级绑定不赋予 VIP（vip_level=0），VIP 仅由 verifyBindingByCode 赋予
        vip_level: 0,
        verified_at: now,
        verify_code: null,
        verify_expires_at: null,
        metadata: JSON.stringify({
          ...oldMeta,
          source: 'bindInstance_rebind',
          vip_expires_at: null,
          unbound_at: null,
        }),
        updated_at: now,
      });
  });
}

/**
 * 解绑实例（软删除）。
 * v4.17.0 实现：将 bindings.verify_status 从 'verified' 改为 'revoked'，并在 metadata.unbound_at 记录时间。
 * 无 verified 记录时为幂等（不抛错，避免重复解绑报错）。
 */
export async function unbindInstance(userId: string, serverId: string): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();

  const records = await db<BindingRow>('bindings')
    .where({
      user_id: userId,
      binding_type: 'account',
      scope_type: 'instance',
      scope_ref: serverId,
      verify_status: 'verified',
    })
    .select('*');

  for (const r of records) {
    const oldMeta = parseMetadata(r.metadata);
    await db<BindingRow>('bindings')
      .where({ id: r.id })
      .update({
        verify_status: 'revoked',
        metadata: JSON.stringify({
          ...oldMeta,
          unbound_at: now,
        }),
        updated_at: now,
      });
  }
}

/**
 * 获取用户在某实例的 VIP 等级。
 *
 * v4.17.0 实现：从 bindings 表查询 binding_type='account', scope_type='instance', verify_status='verified' 的记录。
 *
 * 规则：
 *   1. normalizeRole(userRole) 兼容旧角色值
 *   2. server_admin → 5（最高权限，无需 owner 校验）
 *   3. instance_admin + servers.owner_user_id === userId → 5
 *   4. 否则查 bindings WHERE verify_status='verified'，返回 vip_level
 *   5. 无 verified 绑定记录 → 0
 *
 * 注：instance_admin 非 owner 时走绑定查询路径（与普通 user 一致）。
 */
export async function getUserVipLevel(
  userId: string,
  serverId: string,
  userRole: string,
): Promise<number> {
  const db = getDatabase();
  const role = normalizeRole(userRole);

  // server_admin 直接返回最高等级
  if (role === Role.SERVER_ADMIN) {
    return OWNER_VIP_LEVEL;
  }

  // instance_admin 需匹配 owner
  if (role === Role.INSTANCE_ADMIN) {
    const server = await db<ServerRow>('servers')
      .select('owner_user_id')
      .where({ id: serverId })
      .first();
    if (server && server.owner_user_id === userId) {
      return OWNER_VIP_LEVEL;
    }
  }

  // 普通路径：查 verified 账户级绑定记录
  const binding = await db<BindingRow>('bindings')
    .where({
      user_id: userId,
      binding_type: 'account',
      scope_type: 'instance',
      scope_ref: serverId,
      verify_status: 'verified',
    })
    .first();

  return binding?.vip_level ?? 0;
}

/**
 * 列出用户所有 active 绑定（按 bound_at 升序）。
 * v4.17.0 实现：从 bindings 表查询 verify_status='verified' 的账户级绑定，转换为 BindingRecord。
 */
export async function listUserBindings(userId: string): Promise<BindingRecord[]> {
  const db = getDatabase();
  const rows = await db<BindingRow>('bindings')
    .where({
      user_id: userId,
      binding_type: 'account',
      scope_type: 'instance',
      verify_status: 'verified',
    })
    .orderBy('verified_at', 'asc');
  return rows.map(toBindingRecord);
}

/**
 * 列出某实例所有 active 绑定（含用户名，供 instance_admin 查看）。
 * v4.17.0 实现：JOIN users 表，从 bindings 查询 verify_status='verified' 的账户级绑定。
 *
 * 注：显式 select 带别名，避免 join 时两表 id 列冲突。
 */
export async function listInstanceBindings(
  serverId: string,
): Promise<InstanceBindingWithUsername[]> {
  const db = getDatabase();
  const rows = await db('bindings')
    .join('users', 'bindings.user_id', 'users.id')
    .where({
      'bindings.binding_type': 'account',
      'bindings.scope_type': 'instance',
      'bindings.scope_ref': serverId,
      'bindings.verify_status': 'verified',
    })
    .select(
      'bindings.id as id',
      'bindings.user_id as user_id',
      'bindings.scope_ref as server_id',
      'bindings.vip_level as vip_level',
      'bindings.metadata as metadata',
      'bindings.verify_status as verify_status',
      'bindings.verified_at as bound_at',
      'bindings.created_at as created_at',
      'bindings.updated_at as updated_at',
      'users.username as username',
    )
    .orderBy([
      { column: 'bindings.vip_level', order: 'desc' },
      { column: 'bindings.verified_at', order: 'asc' },
    ]);

  return (rows as any[]).map((r) => {
    const meta = parseMetadata(r.metadata);
    return {
      id: r.id,
      user_id: r.user_id,
      server_id: r.server_id,
      vip_level: r.vip_level,
      vip_expires_at: meta.vip_expires_at ?? null,
      status: 'active',
      bound_at: r.bound_at ?? r.created_at,
      unbound_at: meta.unbound_at ?? null,
      username: r.username,
    } as InstanceBindingWithUsername;
  });
}

/**
 * 调整某用户在某实例的 VIP 等级（instance_admin/server_admin 调用）。
 * v4.17.0 实现：仅更新 bindings 表中 verify_status='verified' 的账户级绑定记录的 vip_level。
 * 无 verified 记录时抛 BindingNotFoundError。
 *
 * @param newLevel 新 VIP 等级，取值范围 0-5（由调用方校验）
 */
export async function updateBindingVip(
  userId: string,
  serverId: string,
  newLevel: number,
): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();

  const updated = await db<BindingRow>('bindings')
    .where({
      user_id: userId,
      binding_type: 'account',
      scope_type: 'instance',
      scope_ref: serverId,
      verify_status: 'verified',
    })
    .update({
      vip_level: newLevel,
      updated_at: now,
    });

  if (updated === 0) {
    throw new BindingNotFoundError(
      `无 active 绑定记录可调整：user=${userId}, server=${serverId}`,
    );
  }
}

/**
 * 检查用户是否已绑定某实例（active）。
 * v4.17.0 实现：查询 bindings 表 verify_status='verified' 的账户级绑定。
 */
export async function isBound(userId: string, serverId: string): Promise<boolean> {
  const db = getDatabase();
  const binding = await db<BindingRow>('bindings')
    .where({
      user_id: userId,
      binding_type: 'account',
      scope_type: 'instance',
      scope_ref: serverId,
      verify_status: 'verified',
    })
    .first();
  return binding !== undefined;
}

// ----- 游戏内 !verify 验证码（v4.17.0: bindings 表中 binding_type='player', scope_type='instance', verify_status='pending'） -----

/**
 * 生成游戏内 !verify 命令使用的验证码。
 *
 * v4.17.0 实现：
 *   - 在 bindings 表创建 binding_type='player', scope_type='instance', verify_status='pending' 的记录
 *   - verify_code 和 verify_expires_at 字段存储验证码与过期时间
 *   - 同时清理该 user_id + server_id 的过期 pending 记录（标记为 expired）
 *
 * @returns 创建的验证码记录（VerifyCodeSummary）
 */
export async function generateVerifyCode(
  userId: string,
  serverId: string,
  gamePlayerName: string,
): Promise<VerifyCodeSummary> {
  const db = getDatabase();
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAtIso = new Date(now.getTime() + VERIFY_CODE_TTL_MS).toISOString();

  // 清理该 user_id + server_id 的过期未使用验证码（标记为 expired，避免堆积）
  await db<BindingRow>('bindings')
    .where({
      user_id: userId,
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: serverId,
      verify_status: 'pending',
    })
    .where('verify_expires_at', '<', nowIso)
    .update({
      verify_status: 'expired',
      updated_at: nowIso,
    });

  // 生成新验证码并写入 bindings 表
  const code = generateVerifyCode6();
  const inserted = await db<BindingRow>('bindings')
    .insert({
      user_id: userId,
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: serverId,
      player_name: gamePlayerName,
      vip_level: 0,
      wallet_id: null,
      verify_status: 'pending',
      verify_code: code,
      verify_expires_at: expiresAtIso,
      verified_at: null,
      metadata: JSON.stringify({
        source: 'generateVerifyCode',
      }),
      created_at: nowIso,
      updated_at: nowIso,
    })
    .returning('*');
  const row = Array.isArray(inserted) ? inserted[0] : inserted;
  return toVerifyCodeSummary(row);
}

/**
 * 游戏内 !verify <code> 命令的处理函数。
 *
 * v4.17.0 实现：
 *   1. 按 verify_code 查找 bindings 表中 verify_status='pending' 的记录
 *   2. 校验 used_at（已 verified → 已使用）、expires_at、player_name、server_id
 *   3. 事务中：
 *      a. 将 pending 记录更新为 verified（verify_status='verified', verified_at=now, verify_code=NULL）
 *      b. 在 bindings 表创建/复活 binding_type='account', scope_type='instance' 的账户级绑定（vip_level=1, verify_status='verified'）
 *
 * v4.27.0 改造：
 *   - 删除原 step 2「创建/更新 player 全局绑定 scope_type='game_type'」整段
 *   - 下游消费方已改为查 scope_type='instance', verify_status='verified'，step a 改 verified 的记录即可被查到
 *   - 不再需要查询 server.game_type（原用于全局绑定 scope_ref）
 *
 * v4.38.0 改造（强制游戏角色绑定才能获得 VIP）：
 *   - 事务提交后（非事务内），若为首次绑定或复活（existingAccountBinding.verify_status !== 'verified'），
 *     emit Panel 内部事件 player.binding_verified + 调用 RCON say 广播 VIP 欢迎语
 *   - 广播失败不阻塞 verify 主流程（仅记日志），详见 broadcastVipWelcome
 *   - player.binding_verified 是 Panel 进程内事件，不进 public/schema/ws-events.ts 跨进程契约
 *
 * @returns { success: true, message: '绑定验证成功' }
 */
export async function verifyBindingByCode(
  gamePlayerName: string,
  code: string,
  serverId: string,
): Promise<{ success: boolean; message: string }> {
  const db = getDatabase();
  const now = new Date();
  const nowIso = now.toISOString();
  // v4.38.0: 在事务内捕获是否需要广播（首次绑定 / 复活），事务外执行广播
  let shouldBroadcast = false;

  // 分步校验：先按 code 查找 pending 记录，再逐项检查以提供精确错误信息
  const verifyRow = await db<BindingRow>('bindings')
    .where({
      verify_code: code,
      verify_status: 'pending',
      binding_type: 'player',
    })
    .orderBy('created_at', 'desc')
    .first();

  if (!verifyRow) {
    throw new VerifyCodeNotFoundError(`验证码不存在: ${code}`);
  }
  // verify_status='pending' 即未使用；其他状态（verified/expired/revoked）视为已使用
  // 此处 verifyRow 已过滤 verify_status='pending'，无需再判 used_at
  if (verifyRow.verify_expires_at && new Date(verifyRow.verify_expires_at).getTime() <= now.getTime()) {
    throw new VerifyCodeExpiredError(`验证码已过期: ${code}`);
  }
  if (verifyRow.player_name !== gamePlayerName) {
    throw new PlayerBindingMismatchError(
      `游戏玩家名不匹配：期望 ${verifyRow.player_name}，实际 ${gamePlayerName}`,
    );
  }
  if (verifyRow.scope_ref !== serverId) {
    throw new PlayerBindingMismatchError(
      `服务器不匹配：验证码属于 ${verifyRow.scope_ref}，当前实例 ${serverId}`,
    );
  }

  const userId = verifyRow.user_id;

  await db.transaction(async (trx) => {
    // 1. 标记验证码已使用：pending → verified，清空 verify_code/verify_expires_at
    //    v4.27.0: 该 verified 实例级 player 绑定即下游消费方查询的目标
    //    （原 step 2 创建 scope_type='game_type' 全局绑定已删除——冗余且语义错误）
    const oldMeta = parseMetadata(verifyRow.metadata);
    await trx<BindingRow>('bindings')
      .where({ id: verifyRow.id })
      .update({
        verify_status: 'verified',
        verified_at: nowIso,
        verify_code: null,
        verify_expires_at: null,
        metadata: JSON.stringify({
          ...oldMeta,
          source: 'verifyBindingByCode',
          legacy_used_at: nowIso,
        }),
        updated_at: nowIso,
      });

    // 2. 创建/复活账户级绑定（binding_type='account', scope_type='instance'），自动获得 VIP1
    //    v4.27.0: 原 step 3 重新编号为 step 2（原 step 2 已删除）
    const existingAccountBinding = await trx<BindingRow>('bindings')
      .where({
        user_id: userId,
        binding_type: 'account',
        scope_type: 'instance',
        scope_ref: serverId,
      })
      .first();

    if (!existingAccountBinding) {
      try {
        await trx('bindings').insert({
          user_id: userId,
          binding_type: 'account',
          scope_type: 'instance',
          scope_ref: serverId,
          player_name: null,
          vip_level: DEFAULT_BOUND_VIP_LEVEL,
          wallet_id: null,
          verify_status: 'verified',
          verify_code: null,
          verify_expires_at: null,
          verified_at: nowIso,
          metadata: JSON.stringify({
            source: 'verifyBindingByCode',
            vip_expires_at: null,
            unbound_at: null,
          }),
          created_at: nowIso,
          updated_at: nowIso,
        });
        // v4.38.0: 首次绑定 → 事务提交后广播 VIP 欢迎语
        shouldBroadcast = true;
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          // 并发场景下 partial UNIQUE 拒绝重复 verified 记录，幂等保留
        } else {
          throw err;
        }
      }
    } else if (existingAccountBinding.verify_status !== 'verified') {
      // 复活已解绑的记录（revoked/expired → verified）
      const oldAccMeta = parseMetadata(existingAccountBinding.metadata);
      await trx<BindingRow>('bindings')
        .where({ id: existingAccountBinding.id })
        .update({
          verify_status: 'verified',
          vip_level: DEFAULT_BOUND_VIP_LEVEL,
          verified_at: nowIso,
          verify_code: null,
          verify_expires_at: null,
          metadata: JSON.stringify({
            ...oldAccMeta,
            source: 'verifyBindingByCode_rebind',
            vip_expires_at: null,
            unbound_at: null,
          }),
          updated_at: nowIso,
        });
      // v4.38.0: 复活绑定 → 事务提交后广播 VIP 欢迎语
      shouldBroadcast = true;
    }
    // verify_status === 'verified' → 幂等保留，不抛错（验证路径应保证访问权）
    // v4.38.0: 已 verified 不广播（避免重复广播）
  });

  // v4.38.0: 事务提交后广播 VIP 欢迎语（非事务内，避免事务回滚导致假广播）
  // 广播失败仅记日志，不阻塞 verify 主流程（verify 已成功）
  if (shouldBroadcast) {
    await broadcastVipWelcome(serverId, userId, gamePlayerName, DEFAULT_BOUND_VIP_LEVEL, nowIso);
  }

  return { success: true, message: '绑定验证成功' };
}

/**
 * v4.38.0: verifyBindingByCode 事务提交后广播 VIP 欢迎语。
 *
 * 调用链：
 *   1. emit Panel 内部事件 player.binding_verified（审计/日志用，不进 public/ 契约）
 *   2. 查询 servers.node_id（RCON 目标节点）
 *   3. 调用 playerService.getVipWelcomeMessage 获取欢迎语模板
 *   4. 模板变量替换 {player_name} / {vip_level}
 *   5. 调用 daemonClient.sendCommand(nodeId, serverId, 'say ' + 欢迎语, requestId)
 *
 * 错误处理（不抛错，verify 已成功）：
 *   - _deps 未注入 → 静默跳过
 *   - servers.node_id 查询失败 → 记录 error 日志
 *   - getVipWelcomeMessage 返回空 → 静默跳过（vip_welcome_messages 未配置）
 *   - sendCommand 失败 → 记录 warning 日志
 */
async function broadcastVipWelcome(
  serverId: string,
  userId: string,
  playerName: string,
  vipLevel: number,
  verifiedAt: string,
): Promise<void> {
  // 1. emit Panel 内部事件（审计/日志订阅用）
  eventBus.emit(PLAYER_BINDING_VERIFIED, {
    type: 'player.binding_verified',
    server_id: serverId,
    user_id: userId,
    player_name: playerName,
    vip_level: vipLevel,
    verified_at: verifiedAt,
  });

  // _deps 未注入时静默跳过（测试环境 / services-init 未调用）
  if (!_deps) {
    return;
  }

  try {
    // 2. 查询 servers.node_id
    const db = getDatabase();
    const server = await db<{ node_id: string }>('servers')
      .select('node_id')
      .where('id', serverId)
      .first();
    if (!server) {
      console.error(
        `[instanceBindingService] broadcastVipWelcome: server not found, cannot resolve node_id (server=${serverId})`,
      );
      return;
    }
    const nodeId = server.node_id;

    // 3. 获取 VIP 欢迎语模板
    const template = await _deps.playerService.getVipWelcomeMessage(serverId, vipLevel);
    if (!template) {
      // vip_welcome_messages 未配置或无匹配等级 → 静默跳过
      return;
    }

    // 4. 模板变量替换
    const message = template
      .replaceAll('{player_name}', playerName)
      .replaceAll('{vip_level}', String(vipLevel));

    // 5. 发送 RCON say 命令（requestId 生成模式参考 backupService.ts#L576）
    const requestId = `${serverId}-verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await _deps.daemonClientService.sendCommand(
      nodeId,
      serverId,
      `say ${message}`,
      requestId,
    );
    if (!result.success) {
      console.warn(
        `[instanceBindingService] broadcastVipWelcome: sendCommand failed (server=${serverId}, error=${result.error ?? 'unknown'})`,
      );
    }
  } catch (err) {
    // node_id 查询失败或其他异常 → 记录 error 日志，不阻塞 verify 主流程
    console.error(
      `[instanceBindingService] broadcastVipWelcome: unexpected error (server=${serverId})`,
      err,
    );
  }
}

/**
 * 根据游戏玩家名查询 VIP 等级（游戏内 !verify 后的权限校验使用）。
 *
 * v4.17.0 实现：
 *   1. 通过 server_id 查询 game_type
 *   2. 通过 player_name + game_type 在 bindings 表反查 user_id（binding_type='player', scope_type='game_type', verify_status='verified'）
 *   3. 查询用户角色后委托 getUserVipLevel 完成最终 VIP 判定
 *
 * v4.27.0 改造：
 *   - 直接按 server_id + player_name 查 scope_type='instance', verify_status='verified'，不再 JOIN servers 表查 game_type
 *   - 性能更好（少一次 servers 表查询），语义更准确（玩家角色本质属于实例）
 *
 * @returns VIP 等级 0-5；无绑定/用户记录返回 0
 */
export async function getVipLevelByGamePlayerName(
  serverId: string,
  gamePlayerName: string,
): Promise<number> {
  const db = getDatabase();

  // v4.27.0: 直接按 server_id + player_name 查 scope_type='instance', verify_status='verified'
  // （原实现先查 server.game_type 再反查 bindings.scope_ref=game_type，已简化为直接查 scope_ref=server_id）
  const binding = await db<BindingRow>('bindings')
    .select('user_id')
    .where({
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: serverId,
      player_name: gamePlayerName,
      verify_status: 'verified',
    })
    .first();
  if (!binding) {
    return 0;
  }

  // 查询用户角色
  const user = await db<UserRow>('users')
    .select('role')
    .where({ id: binding.user_id })
    .first();
  if (!user) {
    return 0;
  }

  // 委托现有 VIP 逻辑（复用 server_admin/instance_admin/owner 判定）
  return getUserVipLevel(binding.user_id, serverId, user.role);
}

// ----- v4.17.0 新增：直读 bindings 表的工具函数（供 vipService 等使用） -----

/**
 * v4.17.0 新增：直接查询 bindings 表中账户级 verified 绑定记录的原始行。
 * 供 vipService.getVipLevel/setVipWithExpiry/checkAndDowngradeExpiredVip 使用，
 * 避免这些服务再走旧 user_instance_bindings 表。
 *
 * @returns 原始 BindingRow（含 metadata）或 undefined
 */
export async function getAccountBindingRaw(
  userId: string,
  serverId: string,
): Promise<BindingRow | undefined> {
  const db = getDatabase();
  return db<BindingRow>('bindings')
    .where({
      user_id: userId,
      binding_type: 'account',
      scope_type: 'instance',
      scope_ref: serverId,
      verify_status: 'verified',
    })
    .first();
}

/**
 * v4.17.0 新增：更新账户级 verified 绑定的 vip_level + vip_expires_at（存入 metadata）。
 * 供 vipService.setVipWithExpiry 使用。
 *
 * @throws {BindingNotFoundError} 无 verified 绑定记录
 */
export async function updateAccountBindingVipWithExpiry(
  userId: string,
  serverId: string,
  level: number,
  expiresAt: string | null,
): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();

  const existing = await db<BindingRow>('bindings')
    .where({
      user_id: userId,
      binding_type: 'account',
      scope_type: 'instance',
      scope_ref: serverId,
      verify_status: 'verified',
    })
    .first();

  if (!existing) {
    throw new BindingNotFoundError(
      `无 active 绑定记录可调整：user=${userId}, server=${serverId}`,
    );
  }

  const oldMeta = parseMetadata(existing.metadata);
  await db<BindingRow>('bindings').where({ id: existing.id }).update({
    vip_level: level,
    metadata: JSON.stringify({
      ...oldMeta,
      vip_expires_at: expiresAt,
    }),
    updated_at: now,
  });
}

/**
 * v4.17.0 新增：批量降级已过期的账户级 VIP 记录。
 * 供 vipService.checkAndDowngradeExpiredVip 使用。
 *
 * 实现：扫描所有 verify_status='verified' 的账户级绑定，应用层过滤 metadata.vip_expires_at < now，
 * 将 vip_level 降为 0 并清空 vip_expires_at。
 *
 * @returns { downgraded } 被降级的记录数
 */
export async function downgradeExpiredAccountBindings(): Promise<{ downgraded: number }> {
  const db = getDatabase();
  const nowIso = new Date().toISOString();

  // 拉取所有 verified 账户级绑定（业务量小，全表扫描可接受）
  const candidates = await db<BindingRow>('bindings')
    .where({
      binding_type: 'account',
      scope_type: 'instance',
      verify_status: 'verified',
    })
    .where('vip_level', '>', 0)
    .select('*');

  let downgraded = 0;
  for (const r of candidates) {
    const meta = parseMetadata(r.metadata);
    const expiresAt = meta.vip_expires_at;
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
      await db<BindingRow>('bindings').where({ id: r.id }).update({
        vip_level: 0,
        metadata: JSON.stringify({
          ...meta,
          vip_expires_at: null,
        }),
        updated_at: nowIso,
      });
      downgraded++;
    }
  }
  return { downgraded };
}

// ----- 辅助函数 -----

/**
 * 生成 6 位验证码（去除易混淆字符 I/L/O/0/1）。
 * 字符集：ABCDEFGHJKMNPQRSTUVWXYZ23456789（共 30 个字符）
 */
function generateVerifyCode6(): string {
  let code = '';
  for (let i = 0; i < VERIFY_CODE_LEN; i++) {
    code += VERIFY_CODE_CHARS[Math.floor(Math.random() * VERIFY_CODE_CHARS.length)];
  }
  return code;
}

/**
 * v4.17.0: 将 bindings 表行转换为兼容旧 BindingRecord 的结构。
 * 字段映射：
 *   - id / user_id / vip_level 直接映射
 *   - server_id ← scope_ref
 *   - vip_expires_at ← metadata.vip_expires_at
 *   - status: verify_status='verified' → 'active'; 其他 → 'unbound'
 *   - bound_at ← verified_at（fallback 到 created_at）
 *   - unbound_at ← metadata.unbound_at
 */
function toBindingRecord(row: BindingRow): BindingRecord {
  const meta = parseMetadata(row.metadata);
  return {
    id: row.id,
    user_id: row.user_id,
    server_id: row.scope_ref ?? '',
    vip_level: row.vip_level,
    vip_expires_at: meta.vip_expires_at ?? null,
    status: row.verify_status === 'verified' ? 'active' : 'unbound',
    bound_at: row.verified_at ?? row.created_at,
    unbound_at: meta.unbound_at ?? null,
  };
}

/** 安全解析 metadata JSON 字符串，失败返回空对象 */
function parseMetadata(raw: string | null | undefined): BindingMetadata {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as BindingMetadata) : {};
  } catch {
    return {};
  }
}

/** v4.17.0: 将 bindings 表中 pending 玩家验证码行转换为 VerifyCodeSummary */
function toVerifyCodeSummary(row: BindingRow): VerifyCodeSummary {
  return {
    id: row.id,
    user_id: row.user_id,
    server_id: row.scope_ref ?? '',
    game_player_name: row.player_name ?? '',
    code: row.verify_code ?? '',
    expires_at: row.verify_expires_at ?? '',
    used_at: row.verify_status === 'verified' ? row.verified_at : null,
    created_at: row.created_at,
  };
}

/** 判断是否为 UNIQUE 约束冲突错误（SQLite / PostgreSQL 兼容） */
function isUniqueConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (msg.includes('unique constraint') || msg.includes('sqlite_constraint')) {
    return true;
  }
  // PostgreSQL unique_violation 错误码
  const code = (err as { code?: string }).code;
  if (code === '23505') return true;
  return false;
}
