// ============================================================================
// commandRunner — Daemon 命令执行（Task 3.5 新增）
//
// 职责：在实例 workdir 下执行任意二进制命令，返回 stdout/stderr/exit_code
// 端点：POST /api/instances/:id/exec
//
// 安全设计：
//   1. cwd 必须在 instance.workdir 内（防穿越）
//   2. binary 范围校验由 Panel 侧做（Pack 声明），Daemon 只保证在 workdir 内执行
//   3. 强制 timeout（默认 60s），超时强杀子进程
//   4. stdout/stderr 各有大小上限（防止 OOM）
//   5. 不允许 shell=true（防命令注入），直接 spawn binary
// ============================================================================

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

/** 默认超时（60 秒） */
const DEFAULT_TIMEOUT_MS = 60_000;
/** stdout/stderr 各自最大字节数（1MB，超出截断） */
const MAX_OUTPUT_BYTES = 1 * 1024 * 1024;

/** 命令执行结果 */
export interface ExecResult {
  exit_code: number | null;
  stdout: string;
  stderr: string;
  duration_ms: number;
  timed_out: boolean;
}

/** 命令执行错误（spawn 失败、binary 不存在等） */
export class ExecCommandFailedError extends Error {
  readonly code = 'EXEC_COMMAND_FAILED' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ExecCommandFailedError';
  }
}

/** 命令执行超时错误 */
export class ExecTimeoutError extends Error {
  readonly code = 'EXEC_TIMEOUT' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ExecTimeoutError';
  }
}

/** 路径非法错误（cwd 不在 workdir 内） */
export class CwdInvalidError extends Error {
  readonly code = 'FILE_PATH_INVALID' as const;
  constructor(message: string) {
    super(message);
    this.name = 'CwdInvalidError';
  }
}

/**
 * 安全校验：cwd 必须在 workdir 内。
 * - 不填 cwd 时返回 workdir 本身
 * - 填了 cwd 时，resolve(workdir, cwd) 必须在 workdir 内
 */
function safeResolveCwd(workdir: string, cwd?: string): string {
  if (!cwd) {
    return path.resolve(workdir);
  }
  if (cwd.includes('\0')) {
    throw new CwdInvalidError('cwd 含非法字符（null byte）');
  }
  const resolvedWorkdir = path.resolve(workdir);
  const resolvedCwd = path.resolve(resolvedWorkdir, cwd);
  const rel = path.relative(resolvedWorkdir, resolvedCwd);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new CwdInvalidError(`cwd 解析后逃逸出 workdir: ${cwd}`);
  }
  return resolvedCwd;
}

/**
 * 在实例 workdir 下执行任意二进制命令。
 *
 * @param workdir 实例工作目录（绝对路径）
 * @param binary 可执行二进制路径（绝对路径或相对 cwd 的路径）
 * @param args 命令行参数
 * @param env 环境变量（合并到 process.env）
 * @param timeoutMs 超时毫秒（默认 60000）
 * @throws {CwdInvalidError} cwd 非法
 * @throws {ExecCommandFailedError} spawn 失败
 */
export function execCommand(
  workdir: string,
  binary: string,
  args: string[],
  env?: Record<string, string>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve, reject) => {
    const resolvedCwd = safeResolveCwd(workdir, env?.cwd);
    const mergedEnv = { ...process.env, ...env };

    const startTime = Date.now();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;

    let child: ChildProcess;
    try {
      // 不使用 shell=true，防止命令注入
      child = spawn(binary, args, {
        cwd: resolvedCwd,
        env: mergedEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (err) {
      reject(
        new ExecCommandFailedError(
          `spawn 失败: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return;
    }

    // CRITICAL: 立即注册 'error' 事件，防止 ENOENT 等异步 spawn 错误
    // 在无监听器情况下冒泡为 unhandled exception 导致 daemon 崩溃。
    // 必须在 spawn() 之后、任何可能 return 的分支之前同步注册。
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // 忽略 kill 失败
      }
    }, timeoutMs);

    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new ExecCommandFailedError(
          `子进程错误: ${err.message}`,
        ),
      );
    });

    // child.pid 为空时（典型：binary 不存在 ENOENT），'error' 事件已由上方监听器处理。
    // 此处不再提前 return，否则会跳过 error 监听器注册（已修复历史崩溃 bug）。
    if (!child.pid) {
      // pid 缺失通常意味着 spawn 即将触发 'error' 事件；
      // 不在此处 reject，让 'error' 监听器统一处理，避免双重 settle。
      // 但若 timeoutMs 内既无 'error' 也无 'close'，需兜底 reject 防止 Promise 悬挂。
      setTimeout(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new ExecCommandFailedError('spawn 失败：未获得 pid 且子进程无事件'));
      }, Math.min(timeoutMs, 5_000));
      // 注意：不 return，继续注册 stdout/stderr/close 监听器
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (!stdoutTruncated) {
        const totalLen = stdoutChunks.reduce((sum, c) => sum + c.length, 0);
        if (totalLen + chunk.length > MAX_OUTPUT_BYTES) {
          stdoutTruncated = true;
          stdoutChunks.push(chunk.subarray(0, MAX_OUTPUT_BYTES - totalLen));
        } else {
          stdoutChunks.push(chunk);
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (!stderrTruncated) {
        const totalLen = stderrChunks.reduce((sum, c) => sum + c.length, 0);
        if (totalLen + chunk.length > MAX_OUTPUT_BYTES) {
          stderrTruncated = true;
          stderrChunks.push(chunk.subarray(0, MAX_OUTPUT_BYTES - totalLen));
        } else {
          stderrChunks.push(chunk);
        }
      }
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const duration_ms = Date.now() - startTime;
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8') +
        (stdoutTruncated ? '\n[stdout truncated by daemon]' : '');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8') +
        (stderrTruncated ? '\n[stderr truncated by daemon]' : '');

      if (timedOut) {
        // 超时：返回结果（exit_code=null，timed_out=true），不抛错
        // 调用方根据 timed_out 判断
        resolve({
          exit_code: null,
          stdout,
          stderr,
          duration_ms,
          timed_out: true,
        });
        return;
      }

      resolve({
        // code 为 null 时（被信号杀死），exit_code 也为 null
        exit_code: code,
        stdout,
        stderr,
        duration_ms,
        timed_out: false,
      });
    });
  });
}
