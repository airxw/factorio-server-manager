// ============================================================================
// bindings.ts — v4.17.0 统一绑定服务 Mock（预生成稳定 Mock）
//
// 用途：契约冻结后，下游模块（路由层、前端联调、单元测试）可在真实
//       bindingService 实现就位前，通过 tsconfig paths alias 切换到本 Mock
//       进行并行开发。本 Mock 返回符合 bindings-schema.json 的稳定模拟数据。
//
// 覆盖场景（rules-3 §四 零等待）：
//   1. verified 态（已验证绑定，verify_code=NULL）
//   2. pending 态（待验证，verify_code 有值，verify_expires_at 未来时间）
//   3. expired 态（验证码过期）
//   4. revoked 态（已撤销）
//   5. account 与 player 两种 binding_type
//   6. instance / game_type / global 三种 scope_type
//
// 切换路径（rules-3 §四 可覆盖）：通过 tsconfig paths alias 切换，
//   调用方零改动。开发者可在 global_mock/ 下覆盖本 Mock 适配特殊测试场景。
//
// 来源：docs/plans/binding-unification-multi-role-plan.md §2.6 + §6
// ============================================================================

import type { IBindingService } from '../interface_stub/bindings';
import type {
  Binding,
  BindingScopeType,
  CreateBindingRequest,
  UpdateBindingRequest,
  ListBindingsQuery,
  ListBindingsResponse,
  VerifyBindingRequest,
  VerifyBindingResponse,
  RevokeBindingResponse,
  DeleteBindingResponse,
} from '../schema/panel-api-types';

/**
 * Mock 错误类，模拟 PanelErrorResponse 抛出
 */
export class MockBindingError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'MockBindingError';
  }
}

// v4.27.0: 改为基于 Date.now() 动态计算，避免 mock 数据随时间过期导致测试失败
const NOW_MS = Date.now();
const NOW_ISO = new Date(NOW_MS).toISOString();
const FUTURE_ISO = new Date(NOW_MS + 5 * 60 * 1000).toISOString(); // 5 分钟后过期
const PAST_ISO = new Date(NOW_MS - 5 * 60 * 1000).toISOString(); // 5 分钟前过期

/**
 * 内置 Mock 数据：覆盖 verified / pending / expired / revoked 四态
 */
function buildMockBindings(): Binding[] {
  return [
    // 1. account + instance + verified（迁移自 user_instance_bindings，status=active）
    {
      id: 1,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'account',
      scope_type: 'instance',
      scope_ref: 'server-uuid-001',
      player_name: null,
      vip_level: 2,
      wallet_id: 100,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: '2026-07-20T10:00:00.000Z',
      metadata: '{"source":"migration_from_user_instance_bindings","legacy_status":"active"}',
      created_at: '2026-07-20T10:00:00.000Z',
      updated_at: '2026-07-20T10:00:00.000Z',
    },
    // 2. player + instance + verified（v4.27.0: 由 game_type 改为 instance 语义）
    {
      id: 2,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-uuid-001',
      player_name: 'Steve_Builder',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: '2026-07-21T14:30:00.000Z',
      metadata: '{"source":"migration_from_player_bindings","legacy_status":"verified"}',
      created_at: '2026-07-21T14:25:00.000Z',
      updated_at: '2026-07-21T14:30:00.000Z',
    },
    // 3. player + instance + pending（迁移自 player_verify_codes，未消费验证码）
    {
      id: 3,
      user_id: '22222222-2222-2222-2222-222222222222',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-uuid-002',
      player_name: 'Alex_Miner',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'pending',
      verify_code: '654321',
      verify_expires_at: FUTURE_ISO,
      verified_at: null,
      metadata: '{"source":"migration_from_player_verify_codes","legacy_used_at":null}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    // 4. player + instance + expired（迁移自 player_verify_codes，过期未消费）
    {
      id: 4,
      user_id: '33333333-3333-3333-3333-333333333333',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-uuid-003',
      player_name: 'Bob_Crafter',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'expired',
      verify_code: '111222',
      verify_expires_at: PAST_ISO,
      verified_at: null,
      metadata: '{"source":"migration_from_player_verify_codes","legacy_used_at":null}',
      created_at: PAST_ISO,
      updated_at: PAST_ISO,
    },
    // 5. account + instance + revoked（迁移自 user_instance_bindings，status=unbound）
    {
      id: 5,
      user_id: '44444444-4444-4444-4444-444444444444',
      binding_type: 'account',
      scope_type: 'instance',
      scope_ref: 'server-uuid-004',
      player_name: null,
      vip_level: 0,
      wallet_id: null,
      verify_status: 'revoked',
      verify_code: null,
      verify_expires_at: null,
      verified_at: null,
      metadata: '{"source":"migration_from_user_instance_bindings","legacy_status":"unbound"}',
      created_at: '2026-07-15T08:00:00.000Z',
      updated_at: '2026-07-22T16:00:00.000Z',
    },
    // 6. player + instance + revoked（v4.27.0: 由 game_type 改为 instance 语义，原 status=rejected）
    {
      id: 6,
      user_id: '55555555-5555-5555-5555-555555555555',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-uuid-005',
      player_name: 'Bad_Actor',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'revoked',
      verify_code: null,
      verify_expires_at: null,
      verified_at: null,
      metadata: '{"source":"migration_from_player_bindings","legacy_status":"rejected"}',
      created_at: '2026-07-10T09:00:00.000Z',
      updated_at: '2026-07-12T11:00:00.000Z',
    },
  ];
}

/**
 * Mock 绑定服务（实现 IBindingService 接口）
 *
 * 设计说明：
 *   - 内存数据存储，重置通过 resetMockBindings()
 *   - 行为可预测：相同输入产生相同输出（稳定 Mock）
 *   - 错误场景通过抛出 MockBindingError 模拟
 *   - 验证码消费后 verify_code 置 NULL，verify_status → verified
 */
export class MockBindingService implements IBindingService {
  private bindings: Binding[] = buildMockBindings();
  private nextId = 1000;

  /**
   * 重置 Mock 数据（测试用例 setup 时调用）
   */
  resetMockBindings(): void {
    this.bindings = buildMockBindings();
    this.nextId = 1000;
  }

  async createBinding(request: CreateBindingRequest, forUserId: string): Promise<Binding> {
    // 校验：player 类型必须提供 player_name
    if (request.binding_type === 'player' && !request.player_name) {
      throw new MockBindingError('PANEL_VALIDATION_ERROR', 'player_name is required for player binding');
    }

    // 校验：account 类型必须 scope_type=instance
    if (request.binding_type === 'account' && request.scope_type !== 'instance') {
      throw new MockBindingError('PANEL_VALIDATION_ERROR', 'account binding must have scope_type=instance');
    }

    // 校验：scope_type=global 时 scope_ref 必须为 null
    if (request.scope_type === 'global' && request.scope_ref !== null) {
      throw new MockBindingError('PANEL_VALIDATION_ERROR', 'global scope must have null scope_ref');
    }

    // 校验：scope_type ∈ (instance, game_type) 时 scope_ref 必须有值
    if ((request.scope_type === 'instance' || request.scope_type === 'game_type') && !request.scope_ref) {
      throw new MockBindingError('PANEL_VALIDATION_ERROR', `${request.scope_type} scope requires non-null scope_ref`);
    }

    // 模拟唯一性约束：同 user + scope 已存在 verified 绑定则拒绝
    const duplicateVerified = this.bindings.find(
      (b) =>
        b.user_id === forUserId &&
        b.binding_type === request.binding_type &&
        b.scope_type === request.scope_type &&
        b.scope_ref === request.scope_ref &&
        b.player_name === (request.player_name ?? null) &&
        b.verify_status === 'verified',
    );
    if (duplicateVerified) {
      throw new MockBindingError('BINDING_DUPLICATE', 'verified binding already exists for this scope');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // +5min

    const newBinding: Binding = {
      id: this.nextId++,
      user_id: forUserId,
      binding_type: request.binding_type,
      scope_type: request.scope_type,
      scope_ref: request.scope_ref,
      player_name: request.player_name ?? null,
      vip_level: request.vip_level ?? 0,
      wallet_id: null,
      verify_status: 'pending',
      verify_code: String(Math.floor(100000 + Math.random() * 900000)),
      verify_expires_at: expiresAt.toISOString(),
      verified_at: null,
      metadata: '{}',
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    this.bindings.push(newBinding);
    return newBinding;
  }

  async listBindings(query: ListBindingsQuery, forUserId?: string): Promise<ListBindingsResponse> {
    let results = [...this.bindings];

    // 玩家视角强制过滤自己的数据
    const effectiveUserId = forUserId ?? query.for_user_id;
    if (effectiveUserId) {
      results = results.filter((b) => b.user_id === effectiveUserId);
    }

    if (query.binding_type) {
      results = results.filter((b) => b.binding_type === query.binding_type);
    }
    if (query.scope_type) {
      results = results.filter((b) => b.scope_type === query.scope_type);
    }
    if (query.scope_ref) {
      results = results.filter((b) => b.scope_ref === query.scope_ref);
    }
    if (query.user_id) {
      results = results.filter((b) => b.user_id === query.user_id);
    }
    if (query.verify_status) {
      results = results.filter((b) => b.verify_status === query.verify_status);
    }

    // 按 created_at 降序
    results.sort((a, b) => b.created_at.localeCompare(a.created_at));

    return { bindings: results };
  }

  async getBinding(bindingId: number, forUserId?: string): Promise<Binding> {
    const binding = this.bindings.find((b) => b.id === bindingId);
    if (!binding) {
      throw new MockBindingError('PANEL_NOT_FOUND', `binding ${bindingId} not found`);
    }
    // 玩家视角：只能看自己的
    if (forUserId && binding.user_id !== forUserId) {
      throw new MockBindingError('PANEL_FORBIDDEN', 'cannot view binding of other user');
    }
    return binding;
  }

  async updateBinding(bindingId: number, request: UpdateBindingRequest, forUserId?: string): Promise<Binding> {
    const binding = this.bindings.find((b) => b.id === bindingId);
    if (!binding) {
      throw new MockBindingError('PANEL_NOT_FOUND', `binding ${bindingId} not found`);
    }
    // 玩家视角禁止修改 vip_level（仅 admin 可改）
    if (forUserId && forUserId === binding.user_id && request.vip_level !== undefined) {
      throw new MockBindingError('PANEL_FORBIDDEN', 'player cannot modify vip_level');
    }

    if (request.vip_level !== undefined) {
      if (request.vip_level < 0 || request.vip_level > 5) {
        throw new MockBindingError('PANEL_VALIDATION_ERROR', 'vip_level must be 0-5');
      }
      binding.vip_level = request.vip_level;
    }
    if (request.wallet_id !== undefined) {
      binding.wallet_id = request.wallet_id;
    }
    if (request.metadata !== undefined) {
      binding.metadata = request.metadata;
    }
    binding.updated_at = new Date().toISOString();
    return binding;
  }

  async verifyBinding(
    bindingId: number,
    request: VerifyBindingRequest,
    forUserId?: string,
  ): Promise<VerifyBindingResponse> {
    const binding = this.bindings.find((b) => b.id === bindingId);
    if (!binding) {
      throw new MockBindingError('PANEL_NOT_FOUND', `binding ${bindingId} not found`);
    }
    if (forUserId && binding.user_id !== forUserId) {
      throw new MockBindingError('PANEL_FORBIDDEN', 'cannot verify binding of other user');
    }
    if (binding.verify_status === 'verified') {
      throw new MockBindingError('BINDING_ALREADY_VERIFIED', 'binding already verified');
    }
    if (binding.verify_status !== 'pending') {
      throw new MockBindingError('PANEL_VALIDATION_ERROR', `cannot verify binding in ${binding.verify_status} state`);
    }

    // 校验验证码
    if (binding.verify_code !== request.verify_code) {
      throw new MockBindingError('VERIFY_CODE_INVALID', 'verify_code does not match');
    }

    // 校验过期
    if (binding.verify_expires_at && new Date(binding.verify_expires_at) < new Date()) {
      binding.verify_status = 'expired';
      binding.updated_at = new Date().toISOString();
      throw new MockBindingError('VERIFY_CODE_EXPIRED', 'verify_code has expired');
    }

    // 消费验证码：pending → verified
    const now = new Date().toISOString();
    binding.verify_status = 'verified';
    binding.verify_code = null;
    binding.verify_expires_at = null;
    binding.verified_at = now;
    binding.updated_at = now;

    return { binding };
  }

  async revokeBinding(bindingId: number, forUserId?: string): Promise<RevokeBindingResponse> {
    const binding = this.bindings.find((b) => b.id === bindingId);
    if (!binding) {
      throw new MockBindingError('PANEL_NOT_FOUND', `binding ${bindingId} not found`);
    }
    // 玩家可撤销自己的绑定
    if (forUserId && binding.user_id !== forUserId) {
      // instance_admin 可撤销其实例的玩家绑定（Mock 不区分 admin 角色，仅校验所有权）
      // 真实实现需查 admin 拥有的实例集合
      throw new MockBindingError('PANEL_FORBIDDEN', 'cannot revoke binding of other user');
    }

    const now = new Date().toISOString();
    binding.verify_status = 'revoked';
    binding.verify_code = null;
    binding.verify_expires_at = null;
    binding.updated_at = now;
    return { binding };
  }

  async deleteBinding(bindingId: number): Promise<DeleteBindingResponse> {
    const idx = this.bindings.findIndex((b) => b.id === bindingId);
    if (idx === -1) {
      throw new MockBindingError('PANEL_NOT_FOUND', `binding ${bindingId} not found`);
    }
    // Mock：物理删除（真实实现需校验 server_admin）
    this.bindings.splice(idx, 1);
    return { id: bindingId, deleted: true };
  }

  async cleanupExpiredVerifyCodes(): Promise<{ cleaned_count: number }> {
    const now = new Date();
    let cleaned = 0;
    for (const binding of this.bindings) {
      if (
        binding.verify_status === 'pending' &&
        binding.verify_expires_at &&
        new Date(binding.verify_expires_at) < now
      ) {
        binding.verify_status = 'expired';
        binding.updated_at = now.toISOString();
        cleaned++;
      }
    }
    return { cleaned_count: cleaned };
  }

  async findBindingByPlayerName(
    scopeType: BindingScopeType,
    scopeRef: string,
    playerName: string,
  ): Promise<Binding | null> {
    return (
      this.bindings.find(
        (b) =>
          b.binding_type === 'player' &&
          b.scope_type === scopeType &&
          b.scope_ref === scopeRef &&
          b.player_name === playerName &&
          b.verify_status === 'verified',
      ) ?? null
    );
  }

  /**
   * 测试辅助方法：手动设置指定 binding 的 verify_expires_at
   * 仅用于单元测试模拟过期场景，生产实现无此方法
   */
  setVerifyExpiresAtForTest(bindingId: number, expiresAtIso: string): void {
    const binding = this.bindings.find((b) => b.id === bindingId);
    if (binding) {
      binding.verify_expires_at = expiresAtIso;
    }
  }
}

/**
 * 默认导出单例（开发联调用）
 * 单元测试请通过 resetMockBindings() 重置状态
 */
export const mockBindingService = new MockBindingService();
