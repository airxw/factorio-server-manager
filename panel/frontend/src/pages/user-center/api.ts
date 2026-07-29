// ============================================================================
// user-center/api.ts — 用户中心经济系统 API 封装与共享类型
//
// 后端路由（响应结构以其源码为准）：
//   panel/backend/src/api/routes/userCenter.ts — /api/me/*、/api/servers/:id/pricing
//   panel/backend/src/api/routes/cdk.ts        — POST /api/cdk/generate
//
// 说明：PanelApiClient（api/client.ts）暂未收录 /me/* 经济端点，且本任务不修改
//       现有文件，故本模块自带最小 request 封装，错误语义与 client.ts 一致
//       （Bearer 头 + {error:{code,message}} 解析 + PanelApiError 抛出）。
// ============================================================================

import { REST_BASE } from '../../config/env';
import { PanelApiError } from '../../api/client';

// ============================================================================
// 本地 request 封装（语义对齐 client.ts 内部 request）
// ============================================================================

async function request<T>(
  token: string | null,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${REST_BASE}${path}`, { ...init, headers });
  } catch (err) {
    throw new PanelApiError(
      'NETWORK_ERROR',
      err instanceof Error ? err.message : '网络请求失败',
      0,
    );
  }

  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    let message = res.statusText || `请求失败 (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body?.error?.code) code = body.error.code;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // 非 JSON 错误体，保留默认 message
    }
    throw new PanelApiError(code, message, res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

// ============================================================================
// 类型定义（与后端响应严格对齐）
// ============================================================================

// ----- GET /me/balance → { balance: BalanceInfo } -----

/** 全局余额信息（balanceService.BalanceInfo） */
export interface BalanceInfo {
  user_id: string;
  balance: number;
  total_earned: number;
  total_spent: number;
  frozen_balance: number;
  total_withdrawn: number;
  /** 最后一笔收入时间（提现账期依据：+7 天后可提现） */
  last_income_at: string | null;
  created_at: string;
  updated_at: string;
  /** 可用余额 = balance - frozen_balance */
  available_balance: number;
}

// ----- GET /me/balance/summary → { balance, instances } -----

/** VIP 状态视图（vipService.VipStatus） */
export interface VipStatus {
  user_id: string;
  server_id: string;
  vip_type: 'lifetime' | 'monthly' | null;
  vip_expires_at: string | null;
  purchased_at: string | null;
  /** 权益资格是否有效（lifetime 恒有效；monthly 需未过期） */
  is_active: boolean;
  total_integral: number;
  current_integral: number;
  /** 由 current_integral 所在区间计算的 VIP 等级 */
  vip_level: number;
}

/** 跨实例汇总条目（userCenter.ts BalanceSummaryInstance） */
export interface BalanceSummaryInstance {
  server_id: string;
  server_name: string;
  points: {
    balance: number;
    total_earned: number;
    total_spent: number;
  };
  vip_status: VipStatus;
}

/** GET /me/balance/summary 响应 */
export interface BalanceSummaryResponse {
  balance: BalanceInfo;
  instances: BalanceSummaryInstance[];
}

// ----- GET /me/transactions → TransactionPage -----

/** 流水币种（wallet_transactions.currency_type） */
export type WalletCurrencyType = 'balance' | 'points' | 'integral';

/** 流水类型（wallet_transactions.type，与表 CHECK 约束一致） */
export type WalletTxType =
  | 'daily_reward'
  | 'shop_purchase'
  | 'shop_refund'
  | 'cdk_recharge'
  | 'admin_credit'
  | 'admin_debit'
  | 'vip_purchase'
  | 'points_exchange'
  | 'cdk_generate'
  | 'cdk_redeem'
  | 'cdk_refund'
  | 'withdraw'
  | 'integral_earn'
  | 'integral_decay'
  | 'integral_adjust'
  | 'gift'
  | 'system';

/** 钱包流水行（wallet_transactions 表） */
export interface WalletTransaction {
  id: number;
  user_id: string;
  server_id: string | null;
  currency_type: WalletCurrencyType;
  type: WalletTxType;
  /** 带符号金额：收入为正，支出/冻结为负 */
  amount: number;
  /** 操作后对应余额 */
  balance_after: number;
  linked_tx_id: number | null;
  order_id: string | null;
  cdk_id: number | null;
  withdraw_code_id: number | null;
  description: string | null;
  operator_user_id: string | null;
  trace_id: string;
  created_at: string;
}

/** 流水分页响应（userCenter.ts TransactionPage） */
export interface TransactionPage {
  items: WalletTransaction[];
  total: number;
  page: number;
  page_size: number;
}

/** 流水查询参数（对应 GET /me/transactions 的 query） */
export interface ListTransactionsParams {
  currency_type?: WalletCurrencyType;
  type?: WalletTxType;
  server_id?: string;
  page?: number;
  page_size?: number;
}

// ----- GET /me/stats → UserStats -----

/** 按币种+类型汇总条目 */
export interface StatsByTypeItem {
  currency_type: string;
  type: string;
  total_amount: number;
  tx_count: number;
}

/** 月度收支趋势条目（month 为 'YYYY-MM'） */
export interface MonthlyTrendItem {
  month: string;
  income: number;
  expense: number;
}

/** Top 消费实例条目 */
export interface TopServerItem {
  server_id: string;
  server_name: string;
  total_spent: number;
}

/** 消费统计响应（GET /me/stats） */
export interface UserStats {
  by_type: StatsByTypeItem[];
  monthly_trend: MonthlyTrendItem[];
  top_servers: TopServerItem[];
}

// ----- POST /me/withdraw、GET /me/withdraw/history -----

/** 提现码状态（withdrawService.WithdrawStatus） */
export type WithdrawStatus = 'pending' | 'approved' | 'rejected' | 'expired';

/** 提现码行（withdraw_codes 表，withdrawService.WithdrawCodeRow） */
export interface WithdrawCode {
  id: number;
  /** 提现核销码（交由 server_admin 核销） */
  code: string;
  user_id: string;
  /** 申请金额（冻结） */
  amount: number;
  /** 实际到账金额 = amount × ratio（快照） */
  actual_amount: number;
  /** 提现比例快照 */
  ratio: number;
  status: WithdrawStatus;
  operator_user_id: string | null;
  approved_at: string | null;
  expires_at: string;
  created_at: string;
}

/** 提现记录分页响应（withdrawService.WithdrawHistoryPage） */
export interface WithdrawHistoryPage {
  items: WithdrawCode[];
  total: number;
  page: number;
  page_size: number;
}

/** 申请提现响应（POST /me/withdraw） */
export interface CreateWithdrawResponse {
  withdraw_code: string;
  actual_amount: number;
  expires_at: string;
}

// ----- POST /cdk/generate -----

/** 用户自生成 CDK 请求 */
export interface GenerateUserCdkRequest {
  type: 'points' | 'vip';
  server_id: string;
  /** 点券面值（type=points 时必填，正整数） */
  amount?: number;
  /** VIP 时长（type=vip 时必填） */
  vip_duration?: 'monthly' | 'lifetime';
}

/** 用户自生成 CDK 响应 */
export interface GenerateUserCdkResult {
  code: string;
  /** 冻结的余额成本 */
  frozen_amount: number;
  expires_at: string;
}

// ----- GET /servers/:serverId/pricing → { pricing } -----

/** 实例定价（pricingService.InstancePricingRow） */
export interface InstancePricing {
  server_id: string;
  /** null = 该实例未开放订阅制 VIP */
  vip_monthly_price: number | null;
  /** null = 该实例未开放买断制 VIP */
  vip_lifetime_price: number | null;
  /** 1 余额兑换的点券数量 */
  points_exchange_ratio: number;
  /** 消费 1 余额赠送的积分 */
  integral_ratio: number;
  /** 单日消费上限（null = 用平台默认值） */
  daily_consumption_limit: number | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// API 封装函数
// ============================================================================

/** 查询当前用户全局余额（GET /me/balance） */
export async function getBalance(token: string | null): Promise<BalanceInfo> {
  const res = await request<{ balance: BalanceInfo }>(token, '/me/balance');
  return res.balance;
}

/** 全局余额 + 跨实例点券/VIP 汇总（GET /me/balance/summary） */
export async function getBalanceSummary(
  token: string | null,
): Promise<BalanceSummaryResponse> {
  return request<BalanceSummaryResponse>(token, '/me/balance/summary');
}

/** 本人流水查询（GET /me/transactions，created_at 倒序分页） */
export async function getTransactions(
  token: string | null,
  params: ListTransactionsParams = {},
): Promise<TransactionPage> {
  const query = new URLSearchParams();
  if (params.currency_type) query.set('currency_type', params.currency_type);
  if (params.type) query.set('type', params.type);
  if (params.server_id) query.set('server_id', params.server_id);
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.page_size !== undefined) query.set('page_size', String(params.page_size));
  const qs = query.toString();
  return request<TransactionPage>(token, `/me/transactions${qs ? `?${qs}` : ''}`);
}

/** 消费统计（GET /me/stats：分类汇总 + 近 12 月趋势 + Top5 实例） */
export async function getUserStats(token: string | null): Promise<UserStats> {
  return request<UserStats>(token, '/me/stats');
}

/** 申请提现（POST /me/withdraw {amount} → 提现码） */
export async function createWithdraw(
  token: string | null,
  amount: number,
): Promise<CreateWithdrawResponse> {
  return request<CreateWithdrawResponse>(token, '/me/withdraw', {
    method: 'POST',
    body: JSON.stringify({ amount }),
  });
}

/** 提现记录分页（GET /me/withdraw/history） */
export async function getWithdrawHistory(
  token: string | null,
  page = 1,
  pageSize = 20,
): Promise<WithdrawHistoryPage> {
  return request<WithdrawHistoryPage>(
    token,
    `/me/withdraw/history?page=${page}&page_size=${pageSize}`,
  );
}

/** 用户自生成 points/vip CDK（POST /cdk/generate，冻结余额，7 天有效） */
export async function generateUserCdk(
  token: string | null,
  body: GenerateUserCdkRequest,
): Promise<GenerateUserCdkResult> {
  return request<GenerateUserCdkResult>(token, '/cdk/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** 查询实例定价（GET /servers/:serverId/pricing，用于成本预估） */
export async function getServerPricing(
  token: string | null,
  serverId: string,
): Promise<InstancePricing> {
  const res = await request<{ pricing: InstancePricing }>(
    token,
    `/servers/${encodeURIComponent(serverId)}/pricing`,
  );
  return res.pricing;
}

// ============================================================================
// 展示辅助（格式化 + 文案映射，供用户中心各页面/组件共享）
// ============================================================================

/** 金额格式化（千分位） */
export function formatMoney(n: number): string {
  return n.toLocaleString('zh-CN');
}

/** 带符号金额（收入 +N / 支出 -N） */
export function formatSignedMoney(n: number): string {
  return `${n > 0 ? '+' : ''}${formatMoney(n)}`;
}

/** 时间格式化（M月D日 HH:mm） */
export function formatTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** 完整时间格式化（YYYY/M/D HH:mm:ss，交易记录页用） */
export function formatFullTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

/** 流水类型中文文案 */
export const TX_TYPE_LABEL: Record<string, string> = {
  daily_reward: '每日奖励',
  shop_purchase: '商城消费',
  shop_refund: '商城退款',
  cdk_recharge: 'CDK 充值',
  admin_credit: '管理员充值',
  admin_debit: '管理员扣减',
  vip_purchase: 'VIP 购买',
  points_exchange: '余额兑换',
  cdk_generate: '生成 CDKey',
  cdk_redeem: 'CDK 兑换',
  cdk_refund: 'CDK 退款',
  withdraw: '提现',
  integral_earn: '积分获得',
  integral_decay: '积分衰减',
  integral_adjust: '积分调整',
  gift: '礼物',
  system: '系统',
};

/** 流水类型徽章样式（复用全局 badge-* 状态色） */
export const TX_TYPE_BADGE: Record<string, string> = {
  daily_reward: 'badge-running',
  shop_purchase: 'badge-stopping',
  shop_refund: 'badge-starting',
  cdk_recharge: 'badge-running',
  admin_credit: 'badge-running',
  admin_debit: 'badge-error',
  vip_purchase: 'badge-stopping',
  points_exchange: 'badge-starting',
  cdk_generate: 'badge-stopping',
  cdk_redeem: 'badge-running',
  cdk_refund: 'badge-starting',
  withdraw: 'badge-error',
  integral_earn: 'badge-running',
  integral_decay: 'badge-stopping',
  integral_adjust: 'badge-starting',
  gift: 'badge-running',
  system: 'badge-stopped',
};

/** 币种中文文案 */
export const CURRENCY_TYPE_LABEL: Record<string, string> = {
  balance: '余额',
  points: '点券',
  integral: '积分',
};

/** 提现状态中文文案 */
export const WITHDRAW_STATUS_LABEL: Record<WithdrawStatus, string> = {
  pending: '待核销',
  approved: '已核销',
  rejected: '已拒绝',
  expired: '已过期',
};

/** 提现状态徽章样式 */
export const WITHDRAW_STATUS_BADGE: Record<WithdrawStatus, string> = {
  pending: 'badge-starting',
  approved: 'badge-running',
  rejected: 'badge-error',
  expired: 'badge-stopped',
};
