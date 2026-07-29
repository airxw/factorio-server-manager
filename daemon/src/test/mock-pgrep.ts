// ============================================================================
// mock-pgrep — 拦截 pgrep -P <pid> 命令，返回预设进程树
// 用途：未来 processDriver.test.ts 测试 getChildProcessPids 递归穿透逻辑时使用
//
// 设计：ProcessDriver.getChildProcessPids 通过 execFile('pgrep', ['-P', pid]) 获取
// 子进程列表。本模块提供 resolver 工厂，测试文件用 vi.mock('node:child_process')
// 拦截 execFile，在 factory 内调用 resolver 返回预设 stdout。
// ============================================================================

import type { ExecFileException } from 'node:child_process';

/**
 * 进程树：父 PID → 直接子 PID 数组。
 * 示例：{ 100: [200, 300], 200: [400] } 表示 pid 100 有子 200/300，200 有子 400。
 */
export interface PgrepTree {
  [parentPid: number]: number[];
}

/**
 * 模拟 pgrep 失败（无子进程时 pgrep 返回非零退出码）。
 */
export class PgrepNoChildrenError extends Error {
  code?: string;
  constructor() {
    super('pgrep: no matching processes');
    this.name = 'PgrepNoChildrenError';
    // execFile 失败时 err.code 通常是 1
    this.code = '1';
  }
}

/**
 * 创建 pgrep 解析器：给定 pid 返回 pgrep -P <pid> 的模拟 stdout。
 * - 有子进程：返回 "child1\nchild2\n"（pgrep 每行一个 pid）
 * - 无子进程：抛出错误（模拟 pgrep 退出码 1）
 *
 * 用法（在测试文件中）：
 * ```ts
 * const resolver = createPgrepResolver({ 100: [200, 300], 200: [400] });
 * vi.mock('node:child_process', () => ({
 *   execFile: vi.fn((cmd, args, cb) => {
 *     if (cmd === 'pgrep' && args[0] === '-P') {
 *       const pid = parseInt(args[1], 10);
 *       try {
 *         const stdout = resolver(pid);
 *         cb(null, stdout, '');
 *       } catch (e) {
 *         cb(e as ExecFileException, '', '');
 *       }
 *     }
 *   }),
 * }));
 * ```
 */
export function createPgrepResolver(tree: PgrepTree): (pid: number) => string {
  return (pid: number): string => {
    const children = tree[pid];
    if (!children || children.length === 0) {
      throw new PgrepNoChildrenError();
    }
    return children.join('\n') + '\n';
  };
}

/**
 * 根据进程树计算所有后代 PID（不含根 pid），与 ProcessDriver.getChildProcessPids
 * 的期望结果对齐，便于测试断言。
 */
export function flattenDescendants(tree: PgrepTree, rootPid: number): number[] {
  const result: number[] = [];
  const visited = new Set<number>();
  const stack = [rootPid];
  while (stack.length > 0) {
    const pid = stack.pop()!;
    if (visited.has(pid)) continue;
    visited.add(pid);
    const children = tree[pid] ?? [];
    for (const child of children) {
      result.push(child);
      stack.push(child);
    }
  }
  return result;
}

export type { ExecFileException };
