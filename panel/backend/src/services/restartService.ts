// ============================================================================
// restartService — v4.20.0 Panel 后端一次性 token 重启服务
//
// 设计目标：
//   Setup Wizard v2 提交后，向导调用 POST /api/init 拿到 restart_token，
//   再调 POST /api/init/restart 触发本服务执行 `systemctl restart gameserver-panel`。
//
// 核心能力：
//   - issueToken(): 生成一次性 token（crypto.randomUUID），60s 有效，存内存 Map
//   - triggerRestart(restart_token): 验证 token + 异步触发 systemctl 重启
//   - 重启命令通过 `bash -c "sleep 1 && sudo systemctl restart gameserver-panel"` 延迟 1s
//     执行，确保 HTTP 响应能先返回给前端
//   - detached + stdio:'ignore' + unref()，确保父进程退出后命令仍执行
//
// 安全：
//   - token 一次性使用（used 标记 + 删除）
//   - 60s 过期
//   - 仅 sudoers 配置允许的 `systemctl restart gameserver-panel` 命令，无其他特权
//
// 来源：docs/plans/setup-wizard-v2-configuration-plan.md §4.6
// ============================================================================

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

/** token 默认有效期（毫秒） */
const DEFAULT_TOKEN_TTL_MS = 60_000;

/** 重启命令延迟（毫秒）——确保 HTTP 响应能先发出 */
const RESTART_DELAY_MS = 1_000;

/** 重启命令（deploy.sh sudoers 需配置 gameserver 用户可免密执行） */
const RESTART_COMMAND = 'systemctl restart gameserver-panel';
const RESTART_SUDO_PATH = '/bin/systemctl';

export interface RestartServiceDeps {
  /** token 有效期覆盖（测试时注入；默认 60s） */
  tokenTtlMs?: number;
  /** 重启命令覆盖（测试时注入；默认 'systemctl restart gameserver-panel'） */
  restartCommand?: string;
  /** spawn 函数覆盖（测试时注入 mock） */
  spawnFn?: typeof spawn;
  /** 当前时间函数覆盖（测试时注入；默认 Date.now） */
  nowFn?: () => number;
}

interface TokenEntry {
  /** 过期时间戳（毫秒） */
  expiresAt: number;
  /** 是否已使用（一次性消费） */
  used: boolean;
}

export class RestartService {
  private readonly tokenTtlMs: number;
  private readonly restartCommand: string;
  private readonly spawnFn: typeof spawn;
  private readonly nowFn: () => number;
  /** token 存储（内存 Map，进程重启后自然清空） */
  private readonly tokens = new Map<string, TokenEntry>();

  constructor(deps: RestartServiceDeps = {}) {
    this.tokenTtlMs = deps.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS;
    this.restartCommand = deps.restartCommand ?? RESTART_COMMAND;
    this.spawnFn = deps.spawnFn ?? spawn;
    this.nowFn = deps.nowFn ?? Date.now;
  }

  /**
   * 生成一次性 restart_token。
   *
   * 调用时机：POST /api/init 成功写入所有配置后，返回给客户端。
   * 客户端拿到 token 后调 POST /api/init/restart 触发实际重启。
   */
  issueToken(): string {
    const token = crypto.randomUUID();
    this.tokens.set(token, {
      expiresAt: this.nowFn() + this.tokenTtlMs,
      used: false,
    });
    // 顺便清理已过期的 token（避免内存泄漏）
    this.cleanupExpiredTokens();
    return token;
  }

  /**
   * 触发 Panel 后端重启。
   *
   * 流程：
   *   1. 验证 token 存在、未使用、未过期
   *   2. 标记 token 为已使用（一次性）
   *   3. 异步 spawn `bash -c "sleep 1 && sudo <restartCommand>"`
   *      - detached: true（脱离父进程）
   *      - stdio: 'ignore'（不继承 stdio）
   *      - unref()（父进程退出时不等待子进程）
   *   4. 立即返回 { triggered: true, triggered_at } 给客户端
   *   5. 1s 后 sudo 命令执行，systemd 杀掉当前 Panel 进程并重启
   *
   * @throws {Error} token 无效/已使用/已过期
   */
  triggerRestart(restartToken: string): { triggered: boolean; triggered_at: string } {
    // 1. 验证 token
    const entry = this.tokens.get(restartToken);
    if (!entry) {
      throw new Error('restart_token 无效');
    }
    if (entry.used) {
      throw new Error('restart_token 已使用（一次性 token，请重新提交向导）');
    }
    if (this.nowFn() > entry.expiresAt) {
      // 删除已过期 token
      this.tokens.delete(restartToken);
      throw new Error(`restart_token 已过期（有效期 ${this.tokenTtlMs / 1000}s）`);
    }

    // 2. 标记已使用
    entry.used = true;

    // 3. 异步触发重启（延迟 1s 确保 HTTP 响应先发出）
    const fullCommand = `sleep ${RESTART_DELAY_MS / 1000} && sudo ${this.restartCommand}`;
    try {
      const child = this.spawnFn('bash', ['-c', fullCommand], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, PATH: `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` },
      });
      // 脱离父进程——父进程退出后子进程继续执行
      child.unref();
    } catch (err) {
      // spawn 同步失败（如 bash 不存在），删除 token 让客户端可重试
      const msg = err instanceof Error ? err.message : String(err);
      this.tokens.delete(restartToken);
      throw new Error(`触发重启命令失败: ${msg}`);
    }

    return {
      triggered: true,
      triggered_at: new Date(this.nowFn()).toISOString(),
    };
  }

  /**
   * 验证 token 是否有效（不消费）。
   * 用于客户端在调用 triggerRestart 前预检。
   */
  isTokenValid(restartToken: string): boolean {
    const entry = this.tokens.get(restartToken);
    if (!entry) return false;
    if (entry.used) return false;
    if (this.nowFn() > entry.expiresAt) return false;
    return true;
  }

  /**
   * 清理已过期的 token（内部调用）。
   * 在 issueToken 时顺带清理，避免内存泄漏。
   */
  private cleanupExpiredTokens(): void {
    const now = this.nowFn();
    for (const [token, entry] of this.tokens) {
      if (now > entry.expiresAt) {
        this.tokens.delete(token);
      }
    }
  }
}

/**
 * 工厂函数——供 routes-registry / app.ts 注入时调用
 */
export function createRestartService(deps: RestartServiceDeps = {}): RestartService {
  return new RestartService(deps);
}

/**
 * 导出常量供外部测试/调试使用
 */
export const RESTART_SERVICE_CONSTANTS = {
  DEFAULT_TOKEN_TTL_MS,
  RESTART_DELAY_MS,
  RESTART_COMMAND,
  RESTART_SUDO_PATH,
};
