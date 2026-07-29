// ============================================================================
// 模块4_Daemon实例管理 — 状态机
// 依据：daemon/src/instances/AGENTS.md §模块专属约束 2
// 状态：stopped → starting → running → stopping → stopped，任意状态可转 error
// ============================================================================

import type { InstanceState } from '@public/schema/daemon-api-types';
import { InvalidStateTransitionError } from './types.js';

/**
 * 合法状态转换映射。
 * - stopped  → starting（启动）
 * - starting → running（就绪）/ error（启动失败/崩溃）
 * - running  → stopping（停止）/ error（崩溃）
 * - stopping → stopped（正常停止）/ error（停止失败）
 * - error    → stopped（人工恢复，重置为 stopped 后可重新启动）
 */
const TRANSITIONS: Readonly<Record<InstanceState, readonly InstanceState[]>> = {
  stopped: ['starting'],
  starting: ['running', 'error'],
  running: ['stopping', 'error'],
  stopping: ['stopped', 'error'],
  error: ['stopped'],
};

/**
 * 判断 from → to 是否为合法转换。
 */
export function canTransition(from: InstanceState, to: InstanceState): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * 断言 from → to 合法，非法则抛出 InvalidStateTransitionError。
 */
export function assertTransition(from: InstanceState, to: InstanceState): void {
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}
