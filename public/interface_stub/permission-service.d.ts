// ============================================================================
// permission-service.d.ts — v4.17.0 权限服务接口存根
//
// 用途：基于 permission_points 字典 + role_permission_templates 模板的
//       细粒度权限查询服务。替代旧 hasRoleLevel/requireRole 粗粒度判断。
//
// 实现方：panel/backend/src/core/auth/permissionService.ts（待创建）
// 调用方：panel/backend/src/middleware/auth.ts + 各路由的 requirePermission
//
// 契约约束：
//   - 零实现逻辑，仅声明签名（rules-3 §二）
//   - 异常类型与 panel-api-types.ts PanelErrorResponse 一致
//
// 来源：docs/plans/binding-unification-multi-role-plan.md §3.3 + §8.4
// ============================================================================

import type {
  PermissionPoint,
  RolePermissionTemplate,
  UserRole,
  PermissionCategory,
  ListPermissionPointsResponse,
  ListRolePermissionTemplatesResponse,
  UpdateRolePermissionTemplateRequest,
  UpdateRolePermissionTemplateResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * 权限服务接口（v4.17.0）
 *
 * 设计原则：
 *   1. 权限点解耦：role 不再硬绑权限，role → template → permission_points 多对多
 *   2. 会话级权限：基于 active_role 查询权限，不依赖 users.roles 全集
 *   3. LRU 缓存：按 (user_id + active_role) 缓存权限点集合，TTL 可配置
 *   4. fail-closed：DB 不可用时拒绝所有请求（permission.config.json.fail_closed）
 */
export interface IPermissionService {
  /**
   * 检查用户是否拥有指定权限点
   *
   * @param userId 用户 ID
   * @param activeRole 当前活动角色（来自 JWT active_role claim）
   * @param permissionCode 权限点代码（如 'instance.create'）
   * @returns true=拥有权限；false=无权限
   */
  hasPermission(userId: string, activeRole: UserRole, permissionCode: string): Promise<boolean>;

  /**
   * 批量检查权限（用于一次请求中检查多个权限点，减少 DB 查询）
   *
   * @param userId 用户 ID
   * @param activeRole 当前活动角色
   * @param permissionCodes 权限点代码列表
   * @returns Map<permissionCode, boolean>
   */
  hasPermissions(
    userId: string,
    activeRole: UserRole,
    permissionCodes: string[],
  ): Promise<Map<string, boolean>>;

  /**
   * 获取用户当前 active_role 的全部权限点
   *
   * @param userId 用户 ID
   * @param activeRole 当前活动角色
   * @returns 权限点代码集合
   */
  getUserPermissions(userId: string, activeRole: UserRole): Promise<Set<string>>;

  /**
   * 列出所有权限点（仅 server_admin）
   *
   * @param category 可选：按分类过滤
   * @returns 权限点列表
   */
  listPermissionPoints(category?: PermissionCategory): Promise<ListPermissionPointsResponse>;

  /**
   * 列出角色权限模板（仅 server_admin）
   *
   * @param role 可选：按角色过滤
   * @returns 模板列表
   */
  listRolePermissionTemplates(role?: UserRole): Promise<ListRolePermissionTemplatesResponse>;

  /**
   * 更新角色权限模板（仅 server_admin + role_template_editable=true）
   *
   * ⚠️ 触发缓存失效（全量 invalidateCache）
   *
   * @param request 更新请求
   * @returns 更新后的模板
   * @throws {PanelErrorResponse} PANEL_FORBIDDEN | PANEL_VALIDATION_ERROR
   */
  updateRolePermissionTemplate(
    request: UpdateRolePermissionTemplateRequest,
  ): Promise<UpdateRolePermissionTemplateResponse>;

  /**
   * 主动失效缓存（权限变更后调用）
   *
   * @param userId 可选：仅失效指定用户的缓存；不传则全量失效
   */
  invalidateCache(userId?: string): Promise<void>;

  /**
   * 预热缓存（启动时调用，加载所有 active 用户的权限）
   */
  prewarmCache(): Promise<void>;

  /**
   * 获取缓存统计（调试用）
   */
  getCacheStats(): Promise<{
    size: number;
    max_entries: number;
    hit_rate: number;
    miss_rate: number;
  }>;
}

/**
 * 权限服务异常码
 */
export type PermissionServiceErrorCode =
  | 'PANEL_FORBIDDEN' // 无权操作（如非 server_admin 调用管理接口）
  | 'PANEL_VALIDATION_ERROR' // 权限点代码格式不合法
  | 'PERMISSION_POINT_NOT_FOUND' // 权限点不存在
  | 'ROLE_NOT_FOUND' // 角色不存在
  | 'PERMISSION_DB_UNAVAILABLE' // DB 不可用（fail_closed=true 时拒绝所有请求）
  | 'PERMISSION_CACHE_CORRUPTED' // 缓存数据损坏，需重建
  | 'PANEL_INTERNAL_ERROR';
