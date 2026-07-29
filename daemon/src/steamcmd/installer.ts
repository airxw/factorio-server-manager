// ============================================================================
// steamcmd — SteamCMD 安装管理
// 职责：检测 steamcmd 是否已安装，未安装时自动下载解压
// 安装路径：优先 /opt/steamcmd/（需 root/sudo），权限不足降级到 ~/.steamcmd/
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import type { Logger } from 'pino';

/** SteamCMD 安装包下载地址 */
const STEAMCMD_DOWNLOAD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz';
/** 系统级安装目录（需 root/sudo 权限写入） */
const SYSTEM_INSTALL_DIR = '/opt/steamcmd';
/** steamcmd 启动脚本文件名 */
const STEAMCMD_BINARY = 'steamcmd.sh';

/** 用户级安装目录：~/.steamcmd/ */
function userInstallDir(): string {
  return path.join(os.homedir(), '.steamcmd');
}

/** 检测指定目录下是否已安装 steamcmd.sh */
function isInstalled(installDir: string): boolean {
  return fs.existsSync(path.join(installDir, STEAMCMD_BINARY));
}

/**
 * 下载 steamcmd 安装包并解压到 installDir。
 * 流程：fetch tar.gz → 写入临时文件 → tar -xzf 解压 → 清理临时文件
 */
async function downloadAndExtract(installDir: string, logger?: Logger): Promise<void> {
  await fs.promises.mkdir(installDir, { recursive: true });
  logger?.info({ url: STEAMCMD_DOWNLOAD_URL, installDir }, 'steamcmd: 开始下载安装包');

  const resp = await fetch(STEAMCMD_DOWNLOAD_URL);
  if (!resp.ok) {
    throw new Error(`下载 steamcmd 失败: ${resp.status} ${resp.statusText}`);
  }
  const tarball = Buffer.from(await resp.arrayBuffer());
  const tarPath = path.join(installDir, 'steamcmd_linux.tar.gz');
  await fs.promises.writeFile(tarPath, tarball);

  try {
    await extractTarball(tarPath, installDir);
  } finally {
    // 清理临时 tar 包（忽略清理失败）
    await fs.promises.unlink(tarPath).catch(() => {});
  }
  logger?.info({ installDir }, 'steamcmd: 安装包解压完成');
}

/** 调用系统 tar 命令解压 tar.gz 到指定目录 */
function extractTarball(tarPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('tar', ['-xzf', tarPath, '-C', destDir], (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`解压 steamcmd 失败: ${err.message} ${stderr}`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * 确保 steamcmd 已安装，返回 steamcmd.sh 路径。
 * 优先使用系统目录 /opt/steamcmd/，权限不足时降级到用户目录 ~/.steamcmd/。
 */
export async function ensureInstalled(logger?: Logger): Promise<string> {
  // 1. 系统目录已安装
  if (isInstalled(SYSTEM_INSTALL_DIR)) {
    logger?.debug({ path: SYSTEM_INSTALL_DIR }, 'steamcmd: 已安装 (system)');
    return path.join(SYSTEM_INSTALL_DIR, STEAMCMD_BINARY);
  }
  // 2. 用户目录已安装
  const userDir = userInstallDir();
  if (isInstalled(userDir)) {
    logger?.debug({ path: userDir }, 'steamcmd: 已安装 (user)');
    return path.join(userDir, STEAMCMD_BINARY);
  }
  // 3. 尝试安装到系统目录（可能因权限不足失败）
  try {
    await downloadAndExtract(SYSTEM_INSTALL_DIR, logger);
    if (isInstalled(SYSTEM_INSTALL_DIR)) {
      logger?.info({ path: SYSTEM_INSTALL_DIR }, 'steamcmd: 安装完成 (system)');
      return path.join(SYSTEM_INSTALL_DIR, STEAMCMD_BINARY);
    }
    logger?.warn({ path: SYSTEM_INSTALL_DIR }, 'steamcmd: system 安装后二进制不存在，降级到用户目录');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.warn({ err: msg }, 'steamcmd: system 目录安装失败（可能权限不足），降级到用户目录');
  }
  // 4. 降级安装到用户目录
  await downloadAndExtract(userDir, logger);
  if (!isInstalled(userDir)) {
    throw new Error(`steamcmd 安装失败：${path.join(userDir, STEAMCMD_BINARY)} 不存在`);
  }
  logger?.info({ path: userDir }, 'steamcmd: 安装完成 (user)');
  return path.join(userDir, STEAMCMD_BINARY);
}
