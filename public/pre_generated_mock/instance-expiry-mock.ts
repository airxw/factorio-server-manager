/**
 * instance-expiry-mock.ts — InstanceExpiryService 预生成默认稳定 Mock
 *
 * @description 预生成的默认稳定 Mock，用于支持下游并行开发。
 * 提供预设数据和固定行为，保证多次调用返回一致。
 *
 * 契约来源：public/interface_stub/instance-expiry-service.d.ts
 * 数据契约：public/schema/server-schema.json（expires_at / expiry_status / billing_type）
 *          public/schema/instance-renewals-schema.json
 *
 * 用途：模块 D/F/H 在 instanceExpiryService 真实实现就绪前，
 *      通过 tsconfig paths alias 切换导入本 Mock，零等待联调。
 *
 * Mock 规则（s0202）：
 *   - 返回符合数据契约的模拟值
 *   - 固定行为，多次调用返回一致
 *   - 不依赖 DB / daemon / 外部服务
 *   - renewInstance 的 v3-billing 路由分流：billing_type='vps_prepaid' 时委托
 *     mockInstanceBillingService.chargeInstanceRenewal；billing_type=null 走 V6 简化流程
 */

import type { InstanceExpiryService } from '../interface_stub/instance-expiry-service';
import type {
  InstanceExpiryStatus,
  InstanceRenewal,
  ExpiryScanResult,
  ExpiryConfig,
  WalletSource,
  NodeSource,
  InstanceRenewalType,
} from '../interface_stub/shared-types';
import {
  InstanceNotFoundError,
  InstanceNotRenewableError,
  InsufficientBalanceError,
} from '../interface_stub/shared-types';
import { mockInstanceBillingService } from './instance-billing-mock';

/** 默认到期处置配置（与 system_config.instance.expiry.* 默认值对齐） */
const DEFAULT_EXPIRY_CONFIG: ExpiryConfig = {
  reminder_days_before: [7, 3, 1],
  grace_days: 7,
  retention_days: 30,
  stop_on_expire: true,
  cleanup_disk_after_retention: true,
  scan_interval_hours: 1,
};

/** 实例有效期内存状态 */
interface InstanceExpiryState {
  serverId: string;
  expires_at: string | null;
  expiry_status: InstanceExpiryStatus;
  expiry_grace_until: string | null;
  billing_type: 'vps_prepaid' | null;
}

/**
 * MockInstanceExpiryService — InstanceExpiryService 默认 Mock 实现
 *
 * 行为约定：
 *   - 实例状态：内存 Map<serverId, InstanceExpiryState>
 *   - 续费记录：复用 mockInstanceBillingService 的续费存储（billing_type='vps_prepaid'）
 *     或本 Mock 内部存储（billing_type=null）
 *   - 调度扫描：返回固定统计值，不真正停止实例
 *   - renewInstance 路由分流：按 billing_type 委托或走 V6 简化流程
 */
export class MockInstanceExpiryService implements InstanceExpiryService {
  private states: Map<string, InstanceExpiryState> = new Map();
  private v6Renewals: Map<string, InstanceRenewal[]> = new Map();
  private v6RenewalIdSeq = 1;

  // ===== 有效期管理 =====

  async setInstanceExpiry(serverId: string, durationDays: number | null): Promise<void> {
    if (!serverId) {
      throw new InstanceNotFoundError('server id is required');
    }
    const now = Date.now();
    const state = this.states.get(serverId) ?? {
      serverId,
      expires_at: null,
      expiry_status: 'permanent' as InstanceExpiryStatus,
      expiry_grace_until: null,
      billing_type: null,
    };
    if (durationDays === null) {
      state.expires_at = null;
      state.expiry_status = 'permanent';
      state.expiry_grace_until = null;
    } else {
      state.expires_at = new Date(now + durationDays * 86400000).toISOString();
      state.expiry_status = 'active';
      state.expiry_grace_until = null;
    }
    this.states.set(serverId, state);
  }

  async getInstanceExpiry(
    serverId: string,
  ): Promise<{
    expires_at: string | null;
    expiry_status: InstanceExpiryStatus;
    expiry_grace_until: string | null;
    days_remaining: number | null;
  }> {
    const state = this.states.get(serverId);
    if (!state) {
      throw new InstanceNotFoundError(`instance ${serverId} not found`);
    }
    let daysRemaining: number | null = null;
    if (state.expires_at) {
      const diffMs = new Date(state.expires_at).getTime() - Date.now();
      daysRemaining = Math.floor(diffMs / 86400000);
    }
    return {
      expires_at: state.expires_at,
      expiry_status: state.expiry_status,
      expiry_grace_until: state.expiry_grace_until,
      days_remaining: daysRemaining,
    };
  }

  // ===== 调度扫描（Mock 返回固定统计） =====

  async scanExpiringInstances(): Promise<ExpiryScanResult> {
    let scanned = 0;
    let notified = 0;
    for (const state of this.states.values()) {
      if (state.expiry_status !== 'active' || !state.expires_at) continue;
      scanned++;
      const diffDays = Math.floor(
        (new Date(state.expires_at).getTime() - Date.now()) / 86400000,
      );
      if (diffDays <= 7) {
        notified++;
      }
    }
    return { scanned, processed: 0, notified, errors: 0 };
  }

  async processExpiredInstances(): Promise<ExpiryScanResult> {
    let scanned = 0;
    let processed = 0;
    for (const state of this.states.values()) {
      if (state.expiry_status !== 'active' || !state.expires_at) continue;
      scanned++;
      if (new Date(state.expires_at).getTime() <= Date.now()) {
        state.expiry_status = 'grace';
        state.expiry_grace_until = new Date(
          Date.now() + DEFAULT_EXPIRY_CONFIG.grace_days * 86400000,
        ).toISOString();
        processed++;
      }
    }
    return { scanned, processed, notified: processed, errors: 0 };
  }

  async processGraceExpiredInstances(): Promise<ExpiryScanResult> {
    let scanned = 0;
    let processed = 0;
    for (const state of this.states.values()) {
      if (state.expiry_status !== 'grace' || !state.expiry_grace_until) continue;
      scanned++;
      if (new Date(state.expiry_grace_until).getTime() <= Date.now()) {
        state.expiry_status = 'expired';
        processed++;
      }
    }
    return { scanned, processed, notified: processed, errors: 0 };
  }

  async cleanupExpiredInstances(): Promise<ExpiryScanResult & { freed_bytes: number }> {
    let scanned = 0;
    let processed = 0;
    for (const state of this.states.values()) {
      if (state.expiry_status !== 'expired') continue;
      scanned++;
      state.expiry_status = 'cleaned';
      processed++;
    }
    return {
      scanned,
      processed,
      notified: 0,
      errors: 0,
      freed_bytes: processed * 1024 * 1024 * 100,
    };
  }

  async sendExpiryReminders(): Promise<{ reminders_sent: number }> {
    let sent = 0;
    for (const state of this.states.values()) {
      if (state.expiry_status !== 'active' || !state.expires_at) continue;
      const diffDays = Math.floor(
        (new Date(state.expires_at).getTime() - Date.now()) / 86400000,
      );
      if (DEFAULT_EXPIRY_CONFIG.reminder_days_before.includes(diffDays)) {
        sent++;
      }
    }
    return { reminders_sent: sent };
  }

  // ===== 续费（含 v3-billing 路由分流） =====

  async renewInstance(
    serverId: string,
    userId: string,
    durationDays: number,
    useWallet: boolean,
  ): Promise<InstanceRenewal> {
    if (!serverId) {
      throw new InstanceNotFoundError('server id is required');
    }
    const state = this.states.get(serverId);
    if (!state) {
      throw new InstanceNotFoundError(`instance ${serverId} not found`);
    }
    if (state.expiry_status === 'cleaned') {
      throw new InstanceNotRenewableError(`instance ${serverId} is cleaned, not renewable`);
    }

    // v3-billing 路由分流
    if (state.billing_type === 'vps_prepaid') {
      // 委托 instanceBillingService（沿用 Mock）
      // durationDays → billing_cycle_months 换算（30 天/月）
      const cycleMonths = durationDaysToCycleMonths(durationDays);
      const result = await mockInstanceBillingService.chargeInstanceRenewal(
        serverId,
        userId,
        cycleMonths,
      );
      // 更新有效期状态
      state.expires_at = result.new_expires_at;
      state.expiry_status = 'active';
      state.expiry_grace_until = null;
      return result.renewal;
    }

    // billing_type=null：走 V6 简化定价流程（Mock：amount=0，不扣款）
    if (useWallet) {
      // Mock 永远余额充足，不真实扣款
    }
    const oldExpiresAt = state.expires_at;
    const baseDate = oldExpiresAt
      ? Math.max(new Date(oldExpiresAt).getTime(), Date.now())
      : Date.now();
    const newExpiresAt =
      durationDays >= 36500
        ? null
        : new Date(baseDate + durationDays * 86400000).toISOString();

    state.expires_at = newExpiresAt;
    state.expiry_status = newExpiresAt ? 'active' : 'permanent';
    state.expiry_grace_until = null;

    const renewal: InstanceRenewal = {
      id: this.v6RenewalIdSeq++,
      instance_id: serverId,
      user_id: userId,
      duration_days: durationDays,
      amount_paid: 0,
      base_amount: 0,
      tier_discount_applied: 1.0,
      vip_discount_applied: 1.0,
      vip_level_at_renewal: 0,
      renewal_type: 'manual' as InstanceRenewalType,
      use_wallet: useWallet,
      old_expires_at: oldExpiresAt,
      new_expires_at: newExpiresAt,
      renewed_at: new Date().toISOString(),
      wallet_source: 'user_wallets' as WalletSource,
      admin_tier_discount_applied: null,
      node_source_at_renewal: null as NodeSource | null,
      billing_cycle_months: null,
      instance_type_snapshot: null,
    };
    const list = this.v6Renewals.get(serverId) ?? [];
    list.push(renewal);
    this.v6Renewals.set(serverId, list);
    return renewal;
  }

  async listRenewals(serverId: string): Promise<InstanceRenewal[]> {
    const state = this.states.get(serverId);
    if (!state) {
      throw new InstanceNotFoundError(`instance ${serverId} not found`);
    }
    if (state.billing_type === 'vps_prepaid') {
      return mockInstanceBillingService.listRenewalsFor(serverId);
    }
    return [...(this.v6Renewals.get(serverId) ?? [])];
  }

  async getExpiryConfig(): Promise<ExpiryConfig> {
    return { ...DEFAULT_EXPIRY_CONFIG };
  }

  // ===== Mock 专用辅助方法（非契约方法，仅供测试驱动） =====

  /** 注册实例到 Mock 状态（含 billing_type） */
  registerInstance(
    serverId: string,
    opts: {
      expires_at?: string | null;
      expiry_status?: InstanceExpiryStatus;
      billing_type?: 'vps_prepaid' | null;
    } = {},
  ): void {
    this.states.set(serverId, {
      serverId,
      expires_at: opts.expires_at ?? null,
      expiry_status: opts.expiry_status ?? 'permanent',
      expiry_grace_until: null,
      billing_type: opts.billing_type ?? null,
    });
  }

  /** 触发余额不足（仅 V6 路径，billing_type=null 时） */
  triggerInsufficientBalance(_serverId: string): void {
    throw new InsufficientBalanceError(`mock: insufficient balance for ${_serverId}`);
  }
}

/** duration_days → billing_cycle_months 换算（30 天/月） */
function durationDaysToCycleMonths(durationDays: number): 1 | 3 | 6 | 12 {
  if (durationDays >= 360) return 12;
  if (durationDays >= 180) return 6;
  if (durationDays >= 90) return 3;
  return 1;
}

/** 默认导出单例，便于直接 import 使用 */
export const mockInstanceExpiryService = new MockInstanceExpiryService();
