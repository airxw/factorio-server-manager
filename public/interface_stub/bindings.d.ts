// ============================================================================
// bindings.d.ts — v4.17.0 统一绑定服务接口存根
//
// 用途：合并旧三套表（user_instance_bindings / player_bindings /
//       player_verify_codes）后的单一绑定服务接口契约。
//
// 实现方：panel/backend/src/services/bindingService.ts（待创建）
// 调用方：panel/backend/src/api/routes/bindings.ts + playerBindings.ts（待重写）
//
// 契约约束：
//   - 零实现逻辑，仅声明签名（rules-3 §二）
//   - 异常类型与 panel-api-types.ts PanelErrorResponse 一致
//   - 签名匹配校验由 bindings-api-contract.test.ts 自动执行
//
// 来源：docs/plans/binding-unification-multi-role-plan.md §2.1 + §6
// ============================================================================

import type {
  Binding,
  BindingType,
  BindingScopeType,
  BindingVerifyStatus,
  CreateBindingRequest,
  UpdateBindingRequest,
  ListBindingsQuery,
  ListBindingsResponse,
  VerifyBindingRequest,
  VerifyBindingResponse,
  RevokeBindingResponse,
  DeleteBindingResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * 统一绑定服务接口（v4.17.0）
 *
 * 设计原则：
 *   1. 单一真相源：所有绑定操作（账户级 + 游戏角色级）走此服务
 *   2. 多态作用域：通过 binding_type + scope_type + scope_ref 表达不同绑定语义
 *   3. 验证生命周期：pending → verified | expired | revoked
 *   4. 所有权隔离：forUserId 强制过滤玩家视角数据，admin 视角传 undefined
 */
export interface IBindingService {
  /**
   * 创建绑定（生成验证码，状态=pending）
   *
   * @param request 创建请求（含 binding_type / scope_type / scope_ref / player_name）
   * @param forUserId 调用者用户 ID（用于所有权校验，玩家只能为自己创建）
   * @returns 创建的绑定记录（pending 态，含 verify_code）
   * @throws {PanelErrorResponse} PANEL_VALIDATION_ERROR | PANEL_FORBIDDEN | BINDING_DUPLICATE
   */
  createBinding(request: CreateBindingRequest, forUserId: string): Promise<Binding>;

  /**
   * 查询绑定列表（按 scope + user 过滤）
   *
   * @param query 查询条件（scope_type / scope_ref / user_id / binding_type / verify_status）
   * @param forUserId 调用者用户 ID；玩家视角强制过滤 user_id=forUserId；admin 传 undefined 看全量
   * @returns 绑定列表（按 created_at 降序）
   */
  listBindings(query: ListBindingsQuery, forUserId?: string): Promise<ListBindingsResponse>;

  /**
   * 获取单个绑定详情
   *
   * @param bindingId 绑定 ID
   * @param forUserId 调用者用户 ID；玩家视角校验 binding.user_id === forUserId
   * @returns 绑定详情
   * @throws {PanelErrorResponse} PANEL_NOT_FOUND | PANEL_FORBIDDEN
   */
  getBinding(bindingId: number, forUserId?: string): Promise<Binding>;

  /**
   * 更新绑定（仅 vip_level / wallet_id / metadata 可更新；binding_type / scope 不可变）
   *
   * @param bindingId 绑定 ID
   * @param request 更新请求
   * @param forUserId 调用者用户 ID；玩家视角禁止此操作（仅 admin 可改 vip_level）
   * @returns 更新后的绑定
   * @throws {PanelErrorResponse} PANEL_NOT_FOUND | PANEL_FORBIDDEN | PANEL_VALIDATION_ERROR
   */
  updateBinding(bindingId: number, request: UpdateBindingRequest, forUserId?: string): Promise<Binding>;

  /**
   * 验证绑定（消费 verify_code，状态 pending → verified）
   *
   * 验证码消费场景：
   *   1. 玩家自助：在游戏内输入验证码后，通过 Webhook 回调触发
   *   2. 玩家手动：在 /guild/bind 页面输入验证码（兜底方案）
   *
   * @param bindingId 绑定 ID
   * @param request 验证请求（含 verify_code）
   * @param forUserId 调用者用户 ID；校验 binding.user_id === forUserId
   * @returns 验证后的绑定（verified 态，verify_code=NULL）
   * @throws {PanelErrorResponse} PANEL_NOT_FOUND | PANEL_FORBIDDEN | VERIFY_CODE_INVALID | VERIFY_CODE_EXPIRED | BINDING_ALREADY_VERIFIED
   */
  verifyBinding(bindingId: number, request: VerifyBindingRequest, forUserId?: string): Promise<VerifyBindingResponse>;

  /**
   * 撤销绑定（状态 → revoked；软删除，保留审计记录）
   *
   * @param bindingId 绑定 ID
   * @param forUserId 调用者用户 ID；玩家可撤销自己的绑定；instance_admin 可撤销其实例的玩家绑定
   * @returns 撤销响应
   * @throws {PanelErrorResponse} PANEL_NOT_FOUND | PANEL_FORBIDDEN
   */
  revokeBinding(bindingId: number, forUserId?: string): Promise<RevokeBindingResponse>;

  /**
   * 物理删除绑定（硬删除，仅 server_admin）
   *
   * @param bindingId 绑定 ID
   * @returns 删除响应
   * @throws {PanelErrorResponse} PANEL_NOT_FOUND | PANEL_FORBIDDEN
   */
  deleteBinding(bindingId: number): Promise<DeleteBindingResponse>;

  /**
   * 清理过期验证码（定时任务调用，状态 pending → expired）
   *
   * @returns 清理的绑定数量
   */
  cleanupExpiredVerifyCodes(): Promise<{ cleaned_count: number }>;

  /**
   * 反查用户（游戏事件 → 用户 ID）
   *
   * 用途：Daemon 上报玩家 join/leave/chat 事件时，通过 (scope_type, scope_ref, player_name) 反查 user_id
   *
   * @param scopeType 作用域类型（instance / game_type）
   * @param scopeRef 作用域引用
   * @param playerName 游戏内玩家名
   * @returns 绑定记录（含 user_id）；未找到返回 null
   */
  findBindingByPlayerName(
    scopeType: BindingScopeType,
    scopeRef: string,
    playerName: string,
  ): Promise<Binding | null>;
}

/**
 * 绑定服务异常码（与 PanelErrorResponse.code 对齐）
 */
export type BindingServiceErrorCode =
  | 'PANEL_VALIDATION_ERROR' // 请求参数不合法
  | 'PANEL_NOT_FOUND' // 绑定不存在
  | 'PANEL_FORBIDDEN' // 无权操作（所有权校验失败）
  | 'BINDING_DUPLICATE' // 已存在同 scope 的 verified 绑定
  | 'BINDING_ALREADY_VERIFIED' // 绑定已验证，不可重复验证
  | 'VERIFY_CODE_INVALID' // 验证码错误
  | 'VERIFY_CODE_EXPIRED' // 验证码已过期
  | 'VERIFY_CODE_MAX_ATTEMPTS' // 验证码尝试次数超限，已锁定
  | 'BINDING_LOCKED' // 绑定已锁定（尝试次数超限），需等待 lockout 时长
  | 'PANEL_INTERNAL_ERROR'; // 内部错误
