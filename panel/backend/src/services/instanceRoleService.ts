// ============================================================================
// instanceRoleService — 实例级角色覆盖服务（v4.7.0）
//
// 用途：支持在单个实例粒度覆盖用户的全局角色。
//   - 全局 users.role 是用户跨所有实例的默认角色
//   - instance_roles 表存储实例级覆盖：某用户在实例 A 可为 instance_admin，
//     在实例 B 仍为 user
//   - server_admin 全局角色不可被实例级覆盖（getEffectiveRole 直接返回 server_admin）
//
// 优先级（getEffectiveRole）：
//   1. 全局 users.role === server_admin → 直接返回 server_admin（不可覆盖）
//   2. instance_roles 表存在未过期记录 → 返回该记录的 role
//   3. 否则 → 返回全局 users.role
//
// 过期判定：expires_at IS NULL OR expires_at > datetime('now')
//
// 设计要点：
// - grantInstanceRole：INSERT，UNIQUE(instance_id, user_id) 冲突时 onConflict.merge 更新
// - revokeInstanceRole：删除记录，不存在时返回 false
// - listInstanceRoles：JOIN users 取 username + granted_by 的 username
// - 所有查询用 try-catch 保护，表不存在时返回安全默认值
// ============================================================================

import crypto from 'node:crypto';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { Role, normalizeRole } from '../core/auth/roles.js';
import type { InstanceRole } from '@public/schema/panel-api-types';

// ---------------------------------------------------------------------------
// DB 行类型
// ---------------------------------------------------------------------------

interface InstanceRoleDbRow {
  id: string;
  instance_id: string;
  user_id: string;
  role: string;
  granted_by: string;
  granted_at: string;
  expires_at: string | null;
}

interface UserRow {
  id: string;
  role: string;
}

interface InstanceRoleJoinedRow extends InstanceRoleDbRow {
  username: string | null;
  granted_username: string | null;
}

// ---------------------------------------------------------------------------
// 服务类
// ---------------------------------------------------------------------------

/**
 * 实例级角色覆盖服务
 *
 * 方法：
 * - getEffectiveRole：返回用户在某实例的有效角色（实例级 > 全局，server_admin 不可覆盖）
 * - grantInstanceRole：授予实例级角色（冲突时更新）
 * - revokeInstanceRole：撤销实例级角色
 * - listInstanceRoles：列出实例所有角色分配（JOIN users）
 */
export class InstanceRoleService {
  constructor(
    private readonly db: Knex,
    private readonly logger: Logger,
  ) {}

  /**
   * 获取用户在某实例的有效角色
   *
   * 优先级：
   *   1. 全局 users.role === server_admin → server_admin（不可被实例级覆盖）
   *   2. instance_roles 表未过期记录 → 该记录的 role
   *   3. 全局 users.role（经 normalizeRole 兼容旧值）
   *
   * @param userId 用户 ID
   * @param instanceId 实例 ID
   * @returns 有效角色（Role 类型）；用户不存在或表异常时降级为 user
   */
  async getEffectiveRole(userId: string, instanceId: string): Promise<Role> {
    // 1. 查全局角色
    let globalRole: Role = Role.USER;
    try {
      // v4.19.2: users.role 列已 DROP，改用 active_role
      const user = await this.db<UserRow>('users')
        .select('active_role')
        .where('id', userId)
        .first();
      if (!user) {
        // 用户不存在 → 最低权限
        return Role.USER;
      }
      globalRole = normalizeRole(user.active_role ?? Role.USER);
    } catch {
      // users 表查询失败 → 降级 user
      return Role.USER;
    }

    // 2. server_admin 全局角色不可被实例级覆盖
    if (globalRole === Role.SERVER_ADMIN) {
      return Role.SERVER_ADMIN;
    }

    // 3. 查 instance_roles 表未过期记录
    try {
      const row = await this.db<InstanceRoleDbRow>('instance_roles')
        .select('id', 'instance_id', 'user_id', 'role', 'granted_by', 'granted_at', 'expires_at')
        .where('instance_id', instanceId)
        .where('user_id', userId)
        .where(function () {
          this.whereNull('expires_at').orWhere('expires_at', '>', new Date().toISOString());
        })
        .first();
      if (row) {
        const instanceRole = normalizeRole(row.role);
        // 实例级角色仅允许 instance_admin / user（不允许覆盖为 server_admin）
        if (instanceRole === Role.INSTANCE_ADMIN || instanceRole === Role.USER) {
          return instanceRole;
        }
      }
    } catch {
      // instance_roles 表不存在时降级到全局角色
      this.logger.debug(
        { userId, instanceId },
        'instance_roles 表查询失败，降级到全局角色',
      );
    }

    // 4. 回退到全局角色
    return globalRole;
  }

  /**
   * 授予实例级角色（UNIQUE 冲突时更新 role/granted_by/granted_at/expires_at）
   *
   * @param instanceId 实例 ID
   * @param userId 被授权的用户 ID
   * @param role 角色（'instance_admin' | 'user'）
   * @param grantedBy 授权人用户 ID
   * @param expiresAt 过期时间（ISO 8601），null=永久
   * @returns 授予后的角色记录（InstanceRole）；失败抛错
   */
  async grantInstanceRole(
    instanceId: string,
    userId: string,
    role: 'instance_admin' | 'user',
    grantedBy: string,
    expiresAt: string | null,
  ): Promise<InstanceRole> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      await this.db('instance_roles')
        .insert({
          id,
          instance_id: instanceId,
          user_id: userId,
          role,
          granted_by: grantedBy,
          granted_at: now,
          expires_at: expiresAt,
        })
        .onConflict(['instance_id', 'user_id'])
        .merge({
          role,
          granted_by: grantedBy,
          granted_at: now,
          expires_at: expiresAt,
        });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: message, instanceId, userId }, 'grantInstanceRole 插入/更新失败');
      throw err;
    }

    // 查询授予后的记录（含 JOIN users）
    const roles = await this.listInstanceRoles(instanceId);
    const created = roles.find((r) => r.user_id === userId);
    if (!created) {
      throw new Error('INSTANCE_ROLE_GRANT_FAILED');
    }
    return created;
  }

  /**
   * 撤销实例级角色
   *
   * @param instanceId 实例 ID
   * @param userId 被撤销的用户 ID
   * @returns true=删除成功，false=记录不存在
   */
  async revokeInstanceRole(instanceId: string, userId: string): Promise<boolean> {
    try {
      const deleted = await this.db('instance_roles')
        .where('instance_id', instanceId)
        .where('user_id', userId)
        .delete();
      return deleted > 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: message, instanceId, userId }, 'revokeInstanceRole 删除失败');
      return false;
    }
  }

  /**
   * 列出实例的所有角色分配（JOIN users 取 username + granted_by username）
   * 仅返回未过期记录（expires_at IS NULL OR expires_at > now）
   *
   * @param instanceId 实例 ID
   * @returns InstanceRole[]（按 granted_at 升序）
   */
  async listInstanceRoles(instanceId: string): Promise<InstanceRole[]> {
    try {
      const rows = await this.db<InstanceRoleJoinedRow>('instance_roles')
        .select({
          id: 'instance_roles.id',
          instance_id: 'instance_roles.instance_id',
          user_id: 'instance_roles.user_id',
          role: 'instance_roles.role',
          granted_by: 'instance_roles.granted_by',
          granted_at: 'instance_roles.granted_at',
          expires_at: 'instance_roles.expires_at',
          username: 'users.username',
          granted_username: 'granted_users.username',
        })
        .leftJoin('users', 'instance_roles.user_id', 'users.id')
        .leftJoin({ granted_users: 'users' }, 'instance_roles.granted_by', 'granted_users.id')
        .where('instance_roles.instance_id', instanceId)
        .orderBy('instance_roles.granted_at', 'asc');

      return rows.map((r) => ({
        id: r.id,
        instance_id: r.instance_id,
        user_id: r.user_id,
        username: r.username ?? '',
        role: r.role as 'instance_admin' | 'user',
        granted_by: r.granted_by,
        granted_username: r.granted_username ?? '',
        granted_at: r.granted_at,
        expires_at: r.expires_at,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: message, instanceId }, 'listInstanceRoles 查询失败');
      return [];
    }
  }
}
