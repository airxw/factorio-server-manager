// ============================================================================
// quotaService — 资源配额服务（v4.6.0）
//
// 用途：支持 role 级 / user 级的资源配额管理（实例数 / 磁盘 / 玩家总数）。
//       创建实例时由 servers.ts 调用 checkInstanceQuota 强制校验；
//       上传文件时由 files.ts 调用 checkDiskQuota 校验。
//
// 优先级：user 配额 > role 配额 > 默认（不限）。
//   - getEffectiveQuota(userId)：先查 user 配额，无则查 role 配额（需先查 users.role）
//   - normalizeRole 处理旧角色值（system_admin/admin/operator/viewer）
//
// 所有 DB 查询用 try-catch 保护，表不存在时返回安全默认值：
//   - quota = null 表示不限
//   - usage = 0
//
// [v4.29.13 DISABLED] max_instances / max_players_total 校验已于 2026-07-29 禁用
//   - 禁用原因：
//     1. role 级配额因角色免密切换失效（见 docs/plans/universal-role-switching-plan.md §1.2，
//        注册即得 ['user','instance_admin']，同级免密切换可绕过 role 级配额）
//     2. max_instances 因 VPS 预付费上线作用下降（见 docs/plans/instance-billing-rules-plan.md §0.2，
//        付费成为创建实例的经济门槛）
//     3. max_players_total 当前 getUsage 简化返回 0，实际未强制
//   - 保留项：max_disk_mb（磁盘配额）仍正常生效——磁盘是真实物理资源，付费不管磁盘，必须保留硬上限
//   - 恢复条件：未来若需按用户硬限实例数/玩家数（如防滥用占调度槽位），取消 checkInstanceQuota 注释即可
//   - 裁决来源：docs/plans/quota-simplification-plan.md §0.1
//   - 契约层不动：public/schema/panel-api-types.ts 等字段定义保留，方便未来恢复
// ============================================================================

import crypto from 'node:crypto';
import type { Knex } from 'knex';
import type { ResourceQuota, QuotaUsage } from '@public/schema/panel-api-types';
import { normalizeRole, Role } from '../core/auth/roles.js';

// ---------------------------------------------------------------------------
// DB 行类型
// ---------------------------------------------------------------------------

interface ResourceQuotaDbRow {
  id: string;
  scope_type: string;
  scope_id: string;
  max_instances: number | null;
  max_disk_mb: number | null;
  max_players_total: number | null;
  created_at: string;
  updated_at: string;
}

interface UserRow {
  role: string;
}

interface ServerDiskRow {
  disk_usage_bytes: number | null;
}

// ---------------------------------------------------------------------------
// 服务类
// ---------------------------------------------------------------------------

/**
 * 资源配额服务
 *
 * 方法：
 * - getQuota：直接查询指定 scope 的配额
 * - setQuota：upsert 配额（不存在则 insert，存在则 update）
 * - getEffectiveQuota：获取用户生效配额（user > role > 默认不限）
 * - getUsage：获取用户当前用量（实例数 + 磁盘 + 在线玩家数）
 * - checkInstanceQuota：校验是否可创建新实例
 * - checkDiskQuota：校验是否可上传指定大小的文件
 */
export class QuotaService {
  constructor(private readonly db: Knex) {}

  /**
   * 查询指定 scope 的配额
   * @param scopeType 'role' | 'user'
   * @param scopeId role 名或 user_id
   * @returns 配额记录；不存在或表异常返回 null（即不限）
   */
  async getQuota(
    scopeType: 'role' | 'user',
    scopeId: string,
  ): Promise<ResourceQuota | null> {
    try {
      const row = await this.db<ResourceQuotaDbRow>('resource_quotas')
        .where({ scope_type: scopeType, scope_id: scopeId })
        .first();
      if (!row) return null;
      return toResourceQuota(row);
    } catch {
      // 表不存在时返回 null（不限）
      return null;
    }
  }

  /**
   * upsert 配额（不存在则 insert，存在则 update）
   * @param scopeType 'role' | 'user'
   * @param scopeId role 名或 user_id
   * @param limits 可选限制字段（未提供的字段保持原值或 NULL）
   * @returns 更新后的配额记录
   */
  async setQuota(
    scopeType: 'role' | 'user',
    scopeId: string,
    limits: {
      max_instances?: number | null;
      max_disk_mb?: number | null;
      max_players_total?: number | null;
    },
  ): Promise<ResourceQuota> {
    const now = new Date().toISOString();
    try {
      const existing = await this.db<ResourceQuotaDbRow>('resource_quotas')
        .where({ scope_type: scopeType, scope_id: scopeId })
        .first();

      if (existing) {
        // update：仅更新提供的字段
        const updateFields: Record<string, unknown> = { updated_at: now };
        if (limits.max_instances !== undefined) {
          updateFields.max_instances = limits.max_instances;
        }
        if (limits.max_disk_mb !== undefined) {
          updateFields.max_disk_mb = limits.max_disk_mb;
        }
        if (limits.max_players_total !== undefined) {
          updateFields.max_players_total = limits.max_players_total;
        }
        await this.db('resource_quotas')
          .where({ id: existing.id })
          .update(updateFields);
        const updated = await this.db<ResourceQuotaDbRow>('resource_quotas')
          .where({ id: existing.id })
          .first();
        return toResourceQuota(updated ?? existing);
      }

      // insert
      const id = crypto.randomUUID();
      await this.db('resource_quotas').insert({
        id,
        scope_type: scopeType,
        scope_id: scopeId,
        max_instances: limits.max_instances ?? null,
        max_disk_mb: limits.max_disk_mb ?? null,
        max_players_total: limits.max_players_total ?? null,
        created_at: now,
        updated_at: now,
      });
      return {
        id,
        scope_type: scopeType,
        scope_id: scopeId,
        max_instances: limits.max_instances ?? null,
        max_disk_mb: limits.max_disk_mb ?? null,
        max_players_total: limits.max_players_total ?? null,
        created_at: now,
        updated_at: now,
      };
    } catch {
      // 写入失败时返回一个内存态配额对象（best-effort，不阻塞调用方）
      // 实际生产中应抛出 QUOTA_UPDATE_FAILED，由路由层捕获
      throw new Error('QUOTA_UPDATE_FAILED');
    }
  }

  /**
   * 获取用户生效配额：优先 user 配额，fallback 到 role 配额
   * @param userId 用户 ID
   * @returns 生效配额；无任何配额记录返回 null（即不限）
   */
  async getEffectiveQuota(userId: string): Promise<ResourceQuota | null> {
    // 1. 优先查 user 配额
    const userQuota = await this.getQuota('user', userId);
    if (userQuota) return userQuota;

    // 2. fallback 到 role 配额（v4.19.2: users.role 列已 DROP，改用 active_role）
    try {
      const userRow = await this.db<UserRow>('users')
        .select('active_role')
        .where('id', userId)
        .first();
      if (!userRow) return null;
      const role = normalizeRole(userRow.active_role ?? Role.USER);
      return await this.getQuota('role', role);
    } catch {
      // users 表不存在或查询失败时返回 null（不限）
      return null;
    }
  }

  /**
   * 获取用户当前用量
   * - instances_used: owner 实例数 + instance_admins 共管实例数（去重）
   * - disk_used_mb: owner + 共管实例的 disk_usage_bytes 求和 / 1024 / 1024
   * - players_online: 实时查询需调 daemon，本任务简化返回 0
   *
   * [v4.29.13 DISABLED] max_players_total 配额已禁用，players_online 永远返回 0，不查询 daemon。
   *   玩家总数限制改由服务器配置 max-players=N 实现（见 instance-billing-rules-plan.md §0.5）。
   *   恢复条件：未来若重新启用玩家总数配额，需接入 daemon 实时查询。
   *
   * 注：instances_used 与 disk_used_mb 仍正常计算——磁盘配额校验依赖 disk_used_mb。
   * @param userId 用户 ID
   */
  async getUsage(userId: string): Promise<QuotaUsage> {
    // 获取用户管辖的实例 ID 集合（owner + instance_admins 共管）
    const instanceIds = await this.getUserInstanceIds(userId);

    let instancesUsed = 0;
    let diskUsedMb = 0;

    if (instanceIds.length > 0) {
      // 实例数 = 用户管辖的实例数
      instancesUsed = instanceIds.length;

      // 磁盘用量 = 所有管辖实例的 disk_usage_bytes 求和 / 1024 / 1024
      try {
        const rows = await this.db<ServerDiskRow>('servers')
          .select('disk_usage_bytes')
          .whereIn('id', instanceIds);
        const totalBytes = rows.reduce(
          (sum, r) => sum + (r.disk_usage_bytes ?? 0),
          0,
        );
        diskUsedMb = Math.floor(totalBytes / (1024 * 1024));
      } catch {
        // servers 表查询失败时保持 0
      }
    }

    return {
      user_id: userId,
      instances_used: instancesUsed,
      disk_used_mb: diskUsedMb,
      players_online: 0, // 简化：实时查询需调 daemon
    };
  }

  /**
   * 校验是否可创建新实例
   * @param userId 用户 ID
   * @returns allowed=true 可创建；allowed=false 不可创建并附 reason
   *
   * [v4.29.13 DISABLED] 实例数配额校验已于 2026-07-29 禁用，直接放行。
   *   禁用原因：
   *     1. role 级 max_instances 因角色免密切换失效（切换 active_role 即可挑选更宽松档位）
   *     2. VPS 预付费上线后，付费成为创建实例的经济门槛，max_instances 作用下降
   *   兜底防线：games.max_instances_per_user 系统配置（系统设置层独立防线，仍生效）
   *   恢复条件：未来若需按用户硬限实例数（如防有钱人开 100 个实例占调度槽位），
   *            取消下方注释恢复校验逻辑即可，契约与 DB 字段均未破坏。
   *   裁决来源：docs/plans/quota-simplification-plan.md §0.1
   */
  async checkInstanceQuota(
    userId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    // [v4.29.13 DISABLED] userId 参数保留供未来恢复校验时使用，当前未读取
    void userId;
    // [v4.29.13 DISABLED] 原校验逻辑保留如下，未来恢复时取消注释即可：
    // const quota = await this.getEffectiveQuota(userId);
    // if (!quota || quota.max_instances === null) {
    //   return { allowed: true };
    // }
    // const usage = await this.getUsage(userId);
    // if (usage.instances_used >= quota.max_instances) {
    //   return {
    //     allowed: false,
    //     reason: `实例配额已满（已用 ${usage.instances_used}/${quota.max_instances}）`,
    //   };
    // }
    return { allowed: true };
  }

  /**
   * 校验是否可上传指定大小的文件
   * @param userId 用户 ID
   * @param additionalMb 额外需要的磁盘 MB
   * @returns allowed=true 可上传；allowed=false 不可上传并附 reason
   */
  async checkDiskQuota(
    userId: string,
    additionalMb: number,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const quota = await this.getEffectiveQuota(userId);
    if (!quota || quota.max_disk_mb === null) {
      return { allowed: true };
    }
    const usage = await this.getUsage(userId);
    if (usage.disk_used_mb + additionalMb > quota.max_disk_mb) {
      return {
        allowed: false,
        reason: `磁盘配额不足（已用 ${usage.disk_used_mb}MB + 新增 ${additionalMb}MB > 上限 ${quota.max_disk_mb}MB）`,
      };
    }
    return { allowed: true };
  }

  // -------------------------------------------------------------------------
  // 私有方法
  // -------------------------------------------------------------------------

  /**
   * 获取用户管辖的实例 ID 集合（owner + instance_admins 共管，去重）
   * 表不存在时返回空数组
   */
  private async getUserInstanceIds(userId: string): Promise<string[]> {
    const ids = new Set<string>();

    // 1. owner 的实例
    try {
      const ownedRows = await this.db<{ id: string }>('servers')
        .select('id')
        .where('owner_user_id', userId);
      for (const r of ownedRows) ids.add(r.id);
    } catch {
      // servers 表不存在时返回空
    }

    // 2. instance_admins 共管的实例
    try {
      const adminRows = await this.db<{ instance_id: string }>('instance_admins')
        .select('instance_id')
        .where('user_id', userId);
      for (const r of adminRows) ids.add(r.instance_id);
    } catch {
      // instance_admins 表不存在时忽略
    }

    return Array.from(ids);
  }
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function toResourceQuota(row: ResourceQuotaDbRow): ResourceQuota {
  return {
    id: row.id,
    scope_type: row.scope_type as 'role' | 'user',
    scope_id: row.scope_id,
    max_instances: row.max_instances,
    max_disk_mb: row.max_disk_mb,
    max_players_total: row.max_players_total,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
