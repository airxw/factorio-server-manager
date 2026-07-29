// ============================================================================
// steamcmd — SteamCMD 调用封装
// 职责：调用 steamcmd.sh 下载指定 app，解析输出，超时控制，错误抛出
// 命令：steamcmd.sh +force_install_dir <dir> +login anonymous +app_update <appId> validate +quit
// v4.13.1（2026-07-29）：修正命令顺序，+force_install_dir 必须在 +login 之前
//   （与 panel/backend/src/services/updateService.ts:690-695 保持一致）
//   依据：s0702 闸门3 + SteamCMD 官方文档
// ============================================================================

import { execFile } from 'node:child_process';
import type { Logger } from 'pino';
import { ensureInstalled } from './installer.js';

/** 默认超时：5 分钟（游戏服务端体积较大） */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
/** stdout/stderr 缓冲上限：20MB（steamcmd 进度日志可能较大） */
const MAX_BUFFER = 20 * 1024 * 1024;

/** downloadApp 可选配置 */
export interface DownloadAppOptions {
  /** 超时毫秒数，默认 5 分钟 */
  timeoutMs?: number;
}

/** SteamCMD 调用错误：附带原始 stdout/stderr 便于排查 */
export class SteamcmdError extends Error {
  readonly stdout: string;
  readonly stderr: string;
  constructor(message: string, stdout: string, stderr: string) {
    super(message);
    this.name = 'SteamcmdError';
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

/**
 * 调用 SteamCMD 下载指定 app 到 installDir。
 * - 内部先 ensureInstalled 获取 steamcmd.sh 路径
 * - 使用 child_process.execFile 执行 steamcmd 命令
 * - 解析输出检测下载是否成功（"Success! App '<appId>'" 标志）
 * - 超时（默认 5 分钟，可通过 options.timeoutMs 配置）后终止进程并抛错
 * - 失败时抛出 SteamcmdError，包含完整 steamcmd 输出
 */
export async function downloadApp(
  appId: number,
  installDir: string,
  logger: Logger,
  options?: DownloadAppOptions,
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const steamcmdPath = await ensureInstalled(logger);
  logger.info({ appId, installDir, timeoutMs, steamcmdPath }, 'steamcmd: 开始下载 app');

  const args = [
    '+force_install_dir', installDir,
    '+login', 'anonymous',
    '+app_update', String(appId),
    'validate',
    '+quit',
  ];

  let stdout = '';
  let stderr = '';
  try {
    const result = await runSteamcmd(steamcmdPath, args, timeoutMs);
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err) {
    const e = err as { message?: string; killed?: boolean; stdout?: string; stderr?: string };
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? '';
    const msg = e.killed
      ? `steamcmd 执行超时（${timeoutMs}ms，appId=${appId}）`
      : `steamcmd 执行失败 (appId=${appId}): ${e.message ?? String(err)}`;
    throw new SteamcmdError(msg, stdout, stderr);
  }

  if (!isDownloadSuccess(stdout, appId)) {
    throw new SteamcmdError(
      `steamcmd 下载未成功完成 (appId=${appId})，请检查输出日志`,
      stdout,
      stderr,
    );
  }
  logger.info({ appId, installDir }, 'steamcmd: 下载完成');
}

/** 执行 steamcmd 并返回 stdout/stderr */
function runSteamcmd(
  binary: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { maxBuffer: MAX_BUFFER, timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) {
          // execFile 失败时 stdout/stderr 仍会填入已收集的输出
          const e = err as Error & { stdout?: string; stderr?: string; killed?: boolean };
          e.stdout = stdout ?? '';
          e.stderr = stderr ?? '';
          reject(e);
        } else {
          resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
        }
      },
    );
  });
}

/** 检测 steamcmd 输出是否表示下载成功（"Success! App '<appId>'"） */
function isDownloadSuccess(stdout: string, appId: number): boolean {
  const pattern = new RegExp(`Success! App\\s*'${appId}'`);
  return pattern.test(stdout);
}
