// ============================================================================
// permission-service.ts — v4.17.0 权限服务 Mock（预生成稳定 Mock）
//
// 用途：契约冻结后，下游模块（中间件、路由层、单元测试）可在真实
//       PermissionService 实现就位前，通过 tsconfig paths alias 切换到本 Mock
//       进行并行开发。本 Mock 返回符合 permission-points-schema.json +
//       role-permission-templates-schema.json 的稳定模拟数据。
//
// 覆盖场景：
//   1. user 角色权限点集合（消费类权限）
//   2. instance_admin 角色权限点集合（实例管理类权限）
//   3. server_admin 角色权限点集合（全部权限，superadmin bypass）
//   4. 缓存命中/未命中场景
//   5. fail-closed 模式（DB 不可用时拒绝）
//
// 切换路径（rules-3 §四 可覆盖）：通过 tsconfig paths alias 切换，
//   调用方零改动。开发者可在 global_mock/ 下覆盖本 Mock 适配特殊测试场景。
//
// 来源：docs/plans/binding-unification-multi-role-plan.md §3.3 + §8
// ============================================================================

import type {
  UserRole,
  PermissionPoint,
  PermissionCategory,
  RolePermissionTemplate,
  ListPermissionPointsResponse,
  ListRolePermissionTemplatesResponse,
  UpdateRolePermissionTemplateRequest,
  UpdateRolePermissionTemplateResponse,
} from '../schema/panel-api-types';

/**
 * Mock 错误类，模拟 PanelErrorResponse 抛出
 */
export class MockPermissionError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'MockPermissionError';
  }
}

const NOW_ISO = '2026-07-25T12:00:00.000Z';

/**
 * 内置 Mock 权限点字典（覆盖五大类，~30 个核心权限点）
 *
 * 来源：docs/plans/binding-unification-multi-role-plan.md §3.3 预置清单
 *       + 现有代码库 grep 出的 requireRole/requireAdmin 调用反推
 */
function buildMockPermissionPoints(): PermissionPoint[] {
  const points: Array<{ code: string; description: string; category: PermissionCategory }> = [
    // 实例与绑定类
    { code: 'instance.create', description: '创建实例', category: 'instance' },
    { code: 'instance.delete', description: '删除实例', category: 'instance' },
    { code: 'instance.view', description: '查看实例', category: 'instance' },
    { code: 'instance.update', description: '修改实例配置', category: 'instance' },
    { code: 'instance.start', description: '启动/停止/重启实例', category: 'instance' },
    { code: 'instance.console', description: '控制台访问', category: 'instance' },
    { code: 'binding.create', description: '创建绑定', category: 'binding' },
    { code: 'binding.verify', description: '验证绑定', category: 'binding' },
    { code: 'binding.revoke', description: '撤销绑定', category: 'binding' },
    { code: 'binding.view', description: '查看绑定', category: 'binding' },
    // 钱包与 VIP 类
    { code: 'wallet.view', description: '查看钱包', category: 'wallet' },
    { code: 'wallet.debit', description: '扣款', category: 'wallet' },
    { code: 'wallet.credit', description: '充值', category: 'wallet' },
    { code: 'wallet.claim_daily', description: '领取每日点券', category: 'wallet' },
    { code: 'vip.view', description: '查看 VIP 等级', category: 'vip' },
    { code: 'vip.set_level', description: '设置 VIP 等级', category: 'vip' },
    // 用户与系统类
    { code: 'user.manage', description: '用户管理（增删改）', category: 'user' },
    { code: 'user.view', description: '查看用户列表', category: 'user' },
    { code: 'user.role.manage', description: '调整用户角色集合', category: 'user' },
    { code: 'system.config', description: '系统配置', category: 'system' },
    { code: 'audit.read', description: '审计日志查看', category: 'audit' },
    // 商业化类
    { code: 'shop.manage', description: '商城商品管理', category: 'shop' },
    { code: 'shop.purchase', description: '商城购买', category: 'shop' },
    { code: 'cdk.manage', description: 'CDK 管理', category: 'cdk' },
    { code: 'cdk.redeem', description: 'CDK 兑换', category: 'cdk' },
    { code: 'vote.manage', description: '投票管理', category: 'vote' },
    { code: 'vote.participate', description: '参与投票', category: 'vote' },
    // 节点与基础设施类
    { code: 'node.read', description: '节点查看', category: 'node' },
    { code: 'node.manage', description: '节点管理', category: 'node' },
    { code: 'pack.read', description: '游戏 Pack 查看', category: 'pack' },
    { code: 'pack.manage', description: '游戏 Pack 管理', category: 'pack' },
    // 运维类
    { code: 'backup.manage', description: '备份管理', category: 'backup' },
    { code: 'save.manage', description: '存档管理', category: 'save' },
    { code: 'mod.manage', description: 'Mod 管理', category: 'mod' },
    { code: 'file.manage', description: '文件管理', category: 'file' },
    { code: 'monitor.read', description: '监控查看', category: 'monitor' },
    // Webhook 与告警
    { code: 'webhook.manage', description: 'Webhook 管理', category: 'webhook' },
    { code: 'webhook.receive', description: '接收 Webhook 事件', category: 'webhook' },
    { code: 'quota.manage', description: '资源配额管理', category: 'quota' },
    { code: 'apikey.manage', description: 'API Key 管理', category: 'apikey' },
  ];

  return points.map((p) => ({ ...p, created_at: NOW_ISO }));
}

/**
 * 内置 Mock 角色权限模板
 *
 * 设计原则：
 *   - user：消费类权限（购买/兑换/投票/查看自己）+ 绑定类权限
 *   - instance_admin：user 全部 + 实例管理类（创建/启动/控制台/商城管理）
 *   - server_admin：全部权限（superadmin bypass，不在模板中显式列出以避免冗余）
 *
 * 注：server_admin 在 Mock 中通过 superadmin_bypass 直接放行，
 *     真实实现可在 role_permission_templates 中显式插入全部权限点。
 */
function buildMockRolePermissionTemplates(): RolePermissionTemplate[] {
  const templates: Array<{ role: UserRole; permission_codes: string[] }> = [
    {
      role: 'user',
      permission_codes: [
        'instance.view',
        'binding.create',
        'binding.verify',
        'binding.revoke',
        'binding.view',
        'wallet.view',
        'wallet.debit',
        'wallet.claim_daily',
        'vip.view',
        'shop.purchase',
        'cdk.redeem',
        'vote.participate',
      ],
    },
    {
      role: 'instance_admin',
      permission_codes: [
        // 继承 user 全部
        'instance.view',
        'binding.create',
        'binding.verify',
        'binding.revoke',
        'binding.view',
        'wallet.view',
        'wallet.debit',
        'wallet.claim_daily',
        'vip.view',
        'shop.purchase',
        'cdk.redeem',
        'vote.participate',
        // 实例管理类
        'instance.create',
        'instance.update',
        'instance.start',
        'instance.console',
        'shop.manage',
        'cdk.manage',
        'vote.manage',
        'backup.manage',
        'save.manage',
        'mod.manage',
        'file.manage',
        'monitor.read',
        'vip.set_level',
        'wallet.credit',
      ],
    },
    {
      role: 'server_admin',
      permission_codes: [
        // 显式列出全部权限点（生产实现可改为 superadmin_bypass 模式）
        'instance.create',
        'instance.delete',
        'instance.view',
        'instance.update',
        'instance.start',
        'instance.console',
        'binding.create',
        'binding.verify',
        'binding.revoke',
        'binding.view',
        'wallet.view',
        'wallet.debit',
        'wallet.credit',
        'wallet.claim_daily',
        'vip.view',
        'vip.set_level',
        'user.manage',
        'user.view',
        'user.role.manage',
        'system.config',
        'audit.read',
        'shop.manage',
        'shop.purchase',
        'cdk.manage',
        'cdk.redeem',
        'vote.manage',
        'vote.participate',
        'node.read',
        'node.manage',
        'pack.read',
        'pack.manage',
        'backup.manage',
        'save.manage',
        'mod.manage',
        'file.manage',
        'monitor.read',
        'webhook.manage',
        'webhook.receive',
        'quota.manage',
        'apikey.manage',
      ],
    },
  ];

  const result: RolePermissionTemplate[] = [];
  for (const t of templates) {
    for (const code of t.permission_codes) {
      result.push({ role: t.role, permission_code: code, created_at: NOW_ISO });
    }
  }
  return result;
}

/**
 * 权限检查上下文
 */
export interface PermissionCheckContext {
  userId: string;
  activeRole: UserRole;
  /** 可选：目标实例的 owner_user_id（用于 instance_admin 自有实例校验） */
  instanceOwnerId?: string;
}

/**
 * Mock 权限服务
 *
 * 设计说明：
 *   - 内存缓存（Map<userId+activeRole, Set<permissionCode>>），LRU 模拟
 *   - superadmin_bypass=true：server_admin 直接放行（不查模板）
 *   - fail_closed=true：DB 不可用时拒绝（Mock 通过 setDbAvailable(false) 模拟）
 *   - 缓存失效通过 invalidateCache(userId?) 触发
 */
export class MockPermissionService {
  private permissionPoints: PermissionPoint[] = buildMockPermissionPoints();
  private roleTemplates: RolePermissionTemplate[] = buildMockRolePermissionTemplates();
  private cache: Map<string, Set<string>> = new Map();
  private dbAvailable = true;
  private superadminBypass = true;
  private failClosed = true;

  /**
   * 重置 Mock 状态（测试用例 setup 时调用）
   */
  resetMockPermissionService(): void {
    this.permissionPoints = buildMockPermissionPoints();
    this.roleTemplates = buildMockRolePermissionTemplates();
    this.cache.clear();
    this.dbAvailable = true;
    this.superadminBypass = true;
    this.failClosed = true;
  }

  /**
   * 模拟 DB 不可用（fail-closed 测试用）
   */
  setDbAvailable(available: boolean): void {
    this.dbAvailable = available;
  }

  /**
   * 检查用户是否拥有指定权限点
   *
   * @param ctx 权限检查上下文（含 userId + activeRole）
   * @param permissionCode 权限点代码
   * @returns true=允许，false=拒绝
   */
  async hasPermission(ctx: PermissionCheckContext, permissionCode: string): Promise<boolean> {
    // superadmin bypass
    if (this.superadminBypass && ctx.activeRole === 'server_admin') {
      return true;
    }

    // fail-closed
    if (!this.dbAvailable) {
      if (this.failClosed) {
        return false;
      }
      // fail-open（仅开发环境）
      return true;
    }

    // 缓存查找
    const cacheKey = `${ctx.userId}:${ctx.activeRole}`;
    let permSet = this.cache.get(cacheKey);
    if (!permSet) {
      permSet = await this.loadPermissionsForRole(ctx.activeRole);
      this.cache.set(cacheKey, permSet);
    }

    return permSet.has(permissionCode);
  }

  /**
   * 加载指定角色的权限点集合（模拟 DB 查询）
   */
  private async loadPermissionsForRole(role: UserRole): Promise<Set<string>> {
    const codes = this.roleTemplates
      .filter((t) => t.role === role)
      .map((t) => t.permission_code);
    return new Set(codes);
  }

  /**
   * 失效缓存（权限变更后调用）
   */
  invalidateCache(userId?: string): void {
    if (userId) {
      // 失效指定用户的缓存（按前缀匹配）
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${userId}:`)) {
          this.cache.delete(key);
        }
      }
    } else {
      // 失效全部缓存
      this.cache.clear();
    }
  }

  /**
   * 列出全部权限点
   */
  async listPermissionPoints(): Promise<ListPermissionPointsResponse> {
    if (!this.dbAvailable && this.failClosed) {
      throw new MockPermissionError('PANEL_SERVICE_UNAVAILABLE', 'permission DB unavailable (fail-closed)');
    }
    return { permission_points: [...this.permissionPoints] };
  }

  /**
   * 列出角色权限模板
   */
  async listRolePermissionTemplates(): Promise<ListRolePermissionTemplatesResponse> {
    if (!this.dbAvailable && this.failClosed) {
      throw new MockPermissionError('PANEL_SERVICE_UNAVAILABLE', 'permission DB unavailable (fail-closed)');
    }
    return { templates: [...this.roleTemplates] };
  }

  /**
   * 更新角色权限模板（全量覆盖）
   * 注：默认 role_template_editable=false，此方法抛错
   */
  async updateRolePermissionTemplate(
      _request: UpdateRolePermissionTemplateRequest,
  ): Promise<UpdateRolePermissionTemplateResponse> {
    // Mock：默认不允许修改模板
    throw new MockPermissionError('PANEL_FORBIDDEN', 'role_template_editable=false, templates are read-only');

    // 真实实现（若启用 role_template_editable=true）：
    //   1. 删除该角色的全部模板行
    //   2. 插入新的权限点集合
    //   3. invalidateCache() 失效所有缓存
    //   4. 返回更新后的模板
  }

  /**
   * 强制启用模板编辑模式（测试用）
   */
  setTemplateEditable(_editable: boolean): void {
    // Mock 简化：始终拒绝修改（与默认配置一致）
    // 真实实现应根据 permission.config.role_template_editable 动态判定
  }

  /**
   * 检查权限点是否存在
   */
  async permissionPointExists(code: string): Promise<boolean> {
    return this.permissionPoints.some((p) => p.code === code);
  }

  /**
   * 获取角色的权限点数量（调试用）
   */
  getPermissionCountForRole(role: UserRole): number {
    if (this.superadminBypass && role === 'server_admin') {
      return this.permissionPoints.length;
    }
    return this.roleTemplates.filter((t) => t.role === role).length;
  }
}

/**
 * 默认导出单例（开发联调用）
 * 单元测试请通过 resetMockPermissionService() 重置状态
 */
export const mockPermissionService = new MockPermissionService();
