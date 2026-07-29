// ============================================================================
// 模块4_Daemon实例管理 — ProcessDriver（child_process.spawn 封装）
// 依据：daemon/src/instances/AGENTS.md §模块专属约束 1/4/5
// P0 无 Docker，直接 spawn 游戏进程；停止走 stdin → SIGTERM → SIGKILL 升级链
// ============================================================================

import { spawn, type ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { StartConfig } from './types.js';

const execFileAsync = promisify(execFile);

/** ProcessDriver.start 返回值：持有子进程句柄与 pid。 */
export interface StartedProcess {
  process: ChildProcess;
  pid: number;
}

/** SIGTERM 后等待退出的宽限时间（毫秒）。 */
const SIGTERM_GRACE_MS = 5000;
/** SIGKILL 后等待退出的兜底时间（毫秒）。 */
const SIGKILL_WAIT_MS = 5000;

/**
 * A8: 向进程组发送信号（detached spawn 的子进程自成进程组，负 pid 表示进程组）。
 * 使用全局 process.kill，避免与 stop 方法的 ChildProcess 参数名冲突。
 */
function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // 进程组可能已退出，忽略
  }
}

/**
 * 等待子进程退出，在 ms 毫秒内退出则 resolve(true)，超时 resolve(false)。
 * 已退出的进程立即 resolve(true)。
 */
function waitForExit(process: ChildProcess, ms: number): Promise<boolean> {
  if (process.exitCode !== null || process.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      process.removeListener('exit', onExit);
      resolve(false);
    }, ms);
    const onExit = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(true);
    };
    process.once('exit', onExit);
  });
}

/**
 * ProcessDriver — 游戏进程生命周期驱动。
 *
 * start(config)：
 *   spawn binary + args，cwd=workingDir，开启 stdio pipe（stdin/stdout/stderr）。
 *
 * stop(process, timeout, stopCommand)：
 *   1. 若 stopCommand 非空且 stdin 可写：写入 stopCommand\n（graceful stop）
 *   2. 等待退出，超时 timeout 秒后 SIGTERM
 *   3. SIGTERM 后再等 SIGTERM_GRACE_MS，仍未退出则 SIGKILL
 *   4. SIGKILL 后等 SIGKILL_WAIT_MS 兜底
 *
 * 僵尸进程防护：三级升级链确保子进程最终退出。
 */
export class ProcessDriver {
  /**
   * 启动子进程。
   * @param config 启动配置（binary/args/workingDir/env）
   * @param onError A1: spawn 错误回调（如 ENOENT 二进制不存在）。
   *                spawn 后立即注册 child.on('error')，将错误传递给调用方而非让 Node.js 进程崩溃。
   * @returns 持有子进程句柄与 pid
   */
  start(config: StartConfig, onError?: (err: Error) => void): StartedProcess {
    const child = spawn(config.binary, config.args, {
      cwd: config.workingDir,
      env: config.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // A8: 子进程归属独立进程组，daemon 退出时 process.kill(-pid) 清理整个进程组，避免孤儿进程
      detached: true,
    });

    // A1: spawn 后立即注册 error 事件，防止 ENOENT 等错误导致 Node.js 进程崩溃
    child.on('error', (err: Error) => {
      if (onError) {
        onError(err);
      }
    });

    const pid = child.pid ?? 0;
    return { process: child, pid };
  }

  /**
   * 停止子进程。
   * @param timeout graceful stop 等待秒数（stopCommand 写入后等待退出的时长）
   * @param stopCommand 写入 stdin 的停止命令；传 null 跳过 stdin（用于 RCON 已发停止命令的场景，或无 stdin 命令的游戏）
   * @param firstSignal v4.1.0 新增：优先信号；指定后跳过 stdin，直接发该信号（'SIGINT' 用于 Valheim/Enshrouded/Dyson）
   *                    默认 null = 走 stdin → SIGTERM → SIGKILL 三级升级链
   */
  async stop(
    process: ChildProcess,
    timeout: number = 30,
    stopCommand: string | null = 'stop',
    firstSignal: NodeJS.Signals | null = null,
  ): Promise<void> {
    // v4.1.0: 若指定 firstSignal（如 SIGINT），直接发信号跳过 stdin
    // 适用于 vanilla 不支持 stdin 停止命令的游戏（Valheim/Enshrouded/Dyson）
    if (firstSignal) {
      const pid = process.pid;
      if (pid) {
        killProcessGroup(pid, firstSignal);
      } else {
        try {
          process.kill(firstSignal);
        } catch {
          // 进程已退出，忽略
        }
      }
    } else if (stopCommand !== null) {
      // 1. graceful stop via stdin
      const stdin = process.stdin;
      if (stdin && stdin.writable) {
        try {
          stdin.write(stopCommand + '\n');
        } catch {
          // stdin 写入失败（进程已关闭），忽略并走信号升级链
        }
      }
    }

    // 2. 等待退出，超时则 SIGTERM
    let exited = await waitForExit(process, timeout * 1000);
    if (exited) return;

    // A8: SIGTERM 发送至整个进程组（detached spawn 的子进程自成进程组）
    const pid = process.pid;
    if (pid) {
      killProcessGroup(pid, 'SIGTERM');
    } else {
      try {
        process.kill('SIGTERM');
      } catch {
        // kill 失败（进程可能已退出），忽略
      }
    }
    exited = await waitForExit(process, SIGTERM_GRACE_MS);
    if (exited) return;

    // 3. SIGKILL 兜底（同样杀整个进程组）
    if (pid) {
      killProcessGroup(pid, 'SIGKILL');
    } else {
      try {
        process.kill('SIGKILL');
      } catch {
        // 忽略
      }
    }
    await waitForExit(process, SIGKILL_WAIT_MS);
  }

  /**
   * A3: 穿透子进程监控 — 递归获取 pid 的所有后代进程 PID。
   * MSLX 借鉴：Linux pgrep -P 递归，穿透 bash/cmd wrapper 找到真正的 java 游戏进程。
   *
   * 场景：游戏通过 wrapper 脚本启动时（如 bash -c "java -jar ..."），
   * spawn 的直接子进程是 bash，真正消耗 CPU/内存的 java 是孙进程。
   * 监控采集需穿透查找整个进程树才能获取真实资源占用。
   *
   * @param pid 根进程 PID
   * @returns 所有后代 PID（不含根 pid 本身）；无后代时返回空数组
   */
  async getChildProcessPids(pid: number): Promise<number[]> {
    const result: number[] = [];
    const visited = new Set<number>();
    await this.collectChildPids(pid, result, visited);
    return result;
  }

  /** 递归收集子进程 PID，visited 防止 PID 循环。 */
  private async collectChildPids(
    pid: number,
    result: number[],
    visited: Set<number>,
  ): Promise<void> {
    if (visited.has(pid)) return;
    visited.add(pid);
    try {
      const { stdout } = await execFileAsync('pgrep', ['-P', String(pid)]);
      const childPids = stdout
        .trim()
        .split('\n')
        .filter((s) => s.length > 0)
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      for (const childPid of childPids) {
        result.push(childPid);
        await this.collectChildPids(childPid, result, visited);
      }
    } catch {
      // pgrep 返回非零退出码表示无子进程，正常情况
    }
  }
}
