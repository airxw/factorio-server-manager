// ============================================================================
// instanceAdminService — 实例共管服务（v4.5.0）
//
// 用途：支持一个实例由多个 instance_admin 共管（owner 是天然管理员）。
//       owner 可通过 instance_admins 表授权其他 instance_admin 用户共管自己的实例。
//
// 设计要点：
// - assignAdmin：插入记录，UNIQUE(instance_id, user_id) 冲突时返回 false（幂等）
// - removeAdmin：删除记录，不存在时返回 false
// - listAdmins：JOIN users 取 username，返回 InstanceAdminRow[]
// - listInstancesByAdmin：返回 instance_id 数组（owner_user_id = userId OR instance_admins.user_id = userId）
// - isAdminOfInstance：检查是否是实例的管理员（owner OR instance_admins 记录）
// ============================================================================

import crypto from 'node:crypto';
import type { Knex } from 'knex';

// ---------------------------------------------------------------------------
// DB 行类型
// ---------------------------------------------------------------------------

interface InstanceAdminDbRow {
  id: string;
  instance_id: string;
  user_id: string;
  assigned_by: string;
  assigned_at: string;
}

// ---------------------------------------------------------------------------
// 公共类型（与 panel-api-types.ts 中的 InstanceAdmin 对齐）
// ---------------------------------------------------------------------------

export interface InstanceAdminRow {
  id: string;
  instance_id: string;
  user_id: string;
  username: string;
  assigned_by: string;
  assigned_at: string;
}

// ---------------------------------------------------------------------------
// 服务类
// ---------------------------------------------------------------------------

/**
 * 实例共管服务
 *
 * 方法：
 * - assignAdmin：授权管理员（重复时返回 false）
 * - removeAdmin：移除管理员（不存在时返回 false）
 * - listAdmins：列出实例的所有共管管理员（JOIN users 取 username）
 * - listInstancesByAdmin：列出用户共管/拥有的实例 ID 数组
 * - isAdminOfInstance：检查用户是否是实例的管理员（owner OR instance_admins 记录）
 */
export class InstanceAdminService {
  constructor(private readonly db: Knex) {}

  /**
   * 授权管理员
   * @param instanceId 实例 ID
   * @param userId 被授权的用户 ID
   * @param assignedBy 授权人用户 ID
   * @returns true=插入成功，false=已存在（幂等，不报错）
   */
  async assignAdmin(
    instanceId: string,
    userId: string,
    assignedBy: string,
  ): Promise<boolean> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await this.db('instance_admins').insert({
        id,
        instance_id: instanceId,
        user_id: userId,
        assigned_by: assignedBy,
        assigned_at: now,
      });
      return true;
    } catch {
      // UNIQUE(instance_id, user_id) 冲突 → 已存在，返回 false
      return false;
    }
  }

  /**
   * 移除管理员
   * @param instanceId 实例 ID
   * @param userId 被移除的用户 ID
   * @returns true=删除成功，false=记录不存在
   */
  async removeAdmin(instanceId: string, userId: string): Promise<boolean> {
    const deleted = await this.db('instance_admins')
      .where({ instance_id: instanceId, user_id: userId })
      .delete();
    return deleted > 0;
  }

  /**
   * 列出实例的所有共管管理员（不含 owner，owner 由 servers.owner_user_id 查）
   * JOIN users 取 username
   */
  async listAdmins(instanceId: string): Promise<InstanceAdminRow[]> {
    const rows = await this.db<InstanceAdminDbRow & { username: string }>(
      'instance_admins',
    )
      .select(
        'instance_admins.id',
        'instance_admins.instance_id',
        'instance_admins.user_id',
        'instance_admins.assigned_by',
        'instance_admins.assigned_at',
        'users.username',
      )
      .leftJoin('users', 'instance_admins.user_id', 'users.id')
      .where('instance_admins.instance_id', instanceId)
      .orderBy('instance_admins.assigned_at', 'asc');

    return rows.map((r) => ({
      id: r.id,
      instance_id: r.instance_id,
      user_id: r.user_id,
      username: r.username,
      assigned_by: r.assigned_by,
      assigned_at: r.assigned_at,
    }));
  }

  /**
   * 列出用户共管或拥有的实例 ID 数组
   * 查询条件：servers.owner_user_id = userId OR instance_admins.user_id = userId
   */
  async listInstancesByAdmin(userId: string): Promise<string[]> {
    // owner 的实例
    const ownedRows = await this.db<{ id: string }>('servers')
      .select('id')
      .where('owner_user_id', userId);
    const ownedIds = ownedRows.map((r) => r.id);

    // 共管的实例
    let adminIds: string[] = [];
    try {
      const adminRows = await this.db<{ instance_id: string }>('instance_admins')
        .select('instance_id')
        .where('user_id', userId);
      adminIds = adminRows.map((r) => r.instance_id);
    } catch {
      // 表不存在时 fallback 到空数组
    }

    // 合并去重
    const set = new Set<string>([...ownedIds, ...adminIds]);
    return Array.from(set);
  }

  /**
   * 检查用户是否是实例的管理员（owner OR instance_admins 记录）
   * @param userId 用户 ID
   * @param instanceId 实例 ID
   * @returns true=是管理员
   */
  async isAdminOfInstance(userId: string, instanceId: string): Promise<boolean> {
    // 1. 检查是否是 owner
    const server = await this.db<{ owner_user_id: string }>('servers')
      .select('owner_user_id')
      .where('id', instanceId)
      .first();
    if (server && server.owner_user_id === userId) {
      return true;
    }

    // 2. 检查 instance_admins 表
    try {
      const adminRecord = await this.db('instance_admins')
        .where({ instance_id: instanceId, user_id: userId })
        .first();
      if (adminRecord) {
        return true;
      }
    } catch {
      // 表不存在时 fallback 到 false
    }

    return false;
  }
}
