// ============================================================================
// 模块4_Daemon实例管理 — 崩溃重启策略
// 职责：定义指数退避重启策略配置与延迟计算
// ============================================================================

/**
 * 重启策略配置。
 * - maxRestarts：最大重启次数，达到后放弃重启
 * - baseDelayMs：首次重启的基础延迟（毫秒）
 * - maxDelayMs：单次重启延迟上限（毫秒），防止退避膨胀过大
 * - backoffMultiplier：指数退避倍数，每次重启延迟 = baseDelayMs * multiplier^(attempt-1)
 */
export interface RestartPolicy {
  maxRestarts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/** 默认重启策略：最多5次，1s 起步，上限 30s，倍数2。 */
export const DEFAULT_RESTART_POLICY: RestartPolicy = {
  maxRestarts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * 计算第 n 次重启的延迟（指数退避，有上限）。
 * 调用方传入 attempt-1 作为参数，使首次重启（attempt=1）延迟为 baseDelayMs。
 * @param attempt 指数部分（调用方传 attempt-1）
 * @param policy 重启策略
 * @returns 延迟毫秒数，不超过 policy.maxDelayMs
 */
export function calculateDelay(attempt: number, policy: RestartPolicy): number {
  const delay = policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt);
  return Math.min(delay, policy.maxDelayMs);
}
