// ============================================================================
// v3.6.0-A3: safeRemoveService — 公共安全删除服务
// 职责：路径白名单校验（防穿越攻击）+ daemon exec du/rm 逻辑
// 复用方：versions DELETE（A1）、cleanup confirm-delete（B1）、子目录清理（v3.6.2-B2）
// ============================================================================

import path from 'node:path';
import type { DaemonClient } from '@public/interface_stub/daemon-client';

/**
 * 路径白名单命名空间：
 * - 'versions':  instances/_versions/<pack_id>/<version>/  目录
 * - 'instances': instances/<server_id>/                    目录
 * - 'subdir':    instances/<server_id>/<subdir>/           子目录（v3.6.2 用）
 */
export type SafeRemoveNamespace = 'versions' | 'instances' | 'subdir';

export interface SafeRemoveOptions {
  /** 命名空间，决定白名单基准路径 */
  namespace: SafeRemoveNamespace;
  /**
   * 目标路径：
   * - namespace='versions' 时为 _versions 下的相对路径（如 <pack_id>/<version>）或绝对路径
   * - namespace='instances' 时忽略此字段，使用 serverId
   * - namespace='subdir' 时忽略此字段，使用 serverId + subdir
   */
  targetPath?: string;
  /** 节点 ID（daemon 调用目标） */
  nodeId: string;
  /** 实例 ID（namespace=instances|subdir 时必填） */
  serverId?: string;
  /** 子目录名（namespace=subdir 时必填，允许：backups/saves/mods/logs/cache） */
  subdir?: string;
}

export interface SafeRemoveResult {
  /** 是否成功 */
  success: boolean;
  /** 释放的字节数（du -sb 解析；du 失败时为 null） */
  freed_bytes: number | null;
  /** 错误信息（失败时） */
  error?: string;
}

/** previewRemove 返回结果（dry-run 预览，不执行删除） */
export interface SafeRemovePreviewResult {
  /** 路径校验是否通过 */
  success: boolean;
  /** 解析后的绝对目标路径（校验失败时为空串） */
  target_path: string;
  /** 目录大小（du -sb 解析；失败时为 null） */
  size_bytes: number | null;
  /** 文件数（find -type f 计数；失败时为 null） */
  file_count: number | null;
  /** 错误信息（失败时） */
  error?: string;
}

const INSTANCES_DIR = process.env.INSTANCES_DIR ?? './instances';

/** 允许清理的子目录白名单（v3.6.2 子目录清理用） */
export const ALLOWED_SUBDIRS = new Set(['backups', 'saves', 'mods', 'logs', 'cache']);

/** serverId 合法性校验：UUID 或类似安全字符，禁止路径穿越 */
const SERVER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class SafeRemoveService {
  constructor(private readonly daemonClient: DaemonClient) {}

  /**
   * 安全删除文件系统路径：
   * 1. 路径白名单校验（防穿越攻击）
   * 2. du -sb 统计大小（用于返回 freed_bytes；失败不阻断）
   * 3. daemon exec rm -rf 删除磁盘
   * 4. 失败时不抛异常，返回 success=false + error
   */
  async safeRemove(opts: SafeRemoveOptions): Promise<SafeRemoveResult> {
    const instancesDir = path.resolve(INSTANCES_DIR);
    let resolvedTarget: string;

    // 1. 路径白名单校验
    try {
      resolvedTarget = this.resolveAndValidate(opts, instancesDir);
    } catch (err) {
      return {
        success: false,
        freed_bytes: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // 2. du -sb 统计大小（失败不阻断删除流程）
    let freedBytes: number | null = null;
    try {
      const duResp = await this.daemonClient.execCommand(opts.nodeId, 'system', {
        binary: 'du',
        args: ['-sb', resolvedTarget],
        timeout: 10_000,
      });
      if (duResp.exit_code === 0 && duResp.stdout) {
        const match = duResp.stdout.match(/^(\d+)/);
        if (match) {
          freedBytes = parseInt(match[1], 10);
        }
      }
    } catch {
      // du 失败不阻断删除流程，仅 freed_bytes=null
    }

    // 3. rm -rf 删除
    try {
      const rmResp = await this.daemonClient.execCommand(opts.nodeId, 'system', {
        binary: 'rm',
        args: ['-rf', resolvedTarget],
        timeout: 30_000,
      });
      if (rmResp.exit_code !== 0) {
        return {
          success: false,
          freed_bytes: null,
          error: `rm 失败 exit=${rmResp.exit_code}: ${rmResp.stderr || rmResp.stdout}`.trim(),
        };
      }
    } catch (err) {
      return {
        success: false,
        freed_bytes: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    return { success: true, freed_bytes: freedBytes };
  }

  /**
   * 预览删除（dry-run）：仅做路径白名单校验 + du/find 统计，不执行 rm。
   *
   * 流程：
   *   1. 路径白名单校验（防穿越攻击，复用 resolveAndValidate）
   *   2. du -sb 统计大小（best-effort，失败返回 null）
   *   3. find -type f 统计文件数（best-effort，失败返回 null）
   *   4. 不执行任何删除操作
   */
  async previewRemove(opts: SafeRemoveOptions): Promise<SafeRemovePreviewResult> {
    const instancesDir = path.resolve(INSTANCES_DIR);
    let resolvedTarget: string;

    // 1. 路径白名单校验
    try {
      resolvedTarget = this.resolveAndValidate(opts, instancesDir);
    } catch (err) {
      return {
        success: false,
        target_path: '',
        size_bytes: null,
        file_count: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // 2. du -sb 统计大小（best-effort）
    let sizeBytes: number | null = null;
    try {
      const duResp = await this.daemonClient.execCommand(opts.nodeId, 'system', {
        binary: 'du',
        args: ['-sb', resolvedTarget],
        timeout: 10_000,
      });
      if (duResp.exit_code === 0 && duResp.stdout) {
        const match = duResp.stdout.match(/^(\d+)/);
        if (match) {
          sizeBytes = parseInt(match[1], 10);
        }
      }
    } catch {
      // best-effort
    }

    // 3. find -type f 统计文件数（best-effort）
    let fileCount: number | null = null;
    try {
      const findResp = await this.daemonClient.execCommand(opts.nodeId, 'system', {
        binary: 'find',
        args: [resolvedTarget, '-type', 'f'],
        timeout: 15_000,
      });
      if (findResp.exit_code === 0 && findResp.stdout) {
        fileCount = findResp.stdout.split('\n').filter(Boolean).length;
      }
    } catch {
      // best-effort
    }

    return {
      success: true,
      target_path: resolvedTarget,
      size_bytes: sizeBytes,
      file_count: fileCount,
    };
  }

  /**
   * 路径规范化与白名单校验
   * @returns 解析后的绝对目标路径
   * @throws 路径越界或参数缺失时抛错
   */
  private resolveAndValidate(
    opts: SafeRemoveOptions,
    instancesDir: string,
  ): string {
    const { namespace, targetPath, serverId, subdir } = opts;

    switch (namespace) {
      case 'versions': {
        // instances/_versions/<pack_id>/<version>/
        if (!targetPath) {
          throw new Error('namespace=versions 时 targetPath 必填');
        }
        const basePath = path.resolve(instancesDir, '_versions');
        const resolvedTarget = path.resolve(basePath, targetPath);
        // 校验：targetPath 必须在 _versions 下
        const rel = path.relative(basePath, resolvedTarget);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          throw new Error(`路径越界：${targetPath} 解析到 ${resolvedTarget} 不在 ${basePath} 下`);
        }
        // 路径深度必须 >= 2（<pack_id>/<version>）
        const depth = rel.split(path.sep).filter(Boolean).length;
        if (depth < 2) {
          throw new Error(`路径深度不足：${rel}，至少需要 _versions/<pack_id>/<version>`);
        }
        return resolvedTarget;
      }

      case 'instances': {
        // instances/<server_id>/
        if (!serverId) {
          throw new Error('namespace=instances 时 serverId 必填');
        }
        if (!SERVER_ID_PATTERN.test(serverId)) {
          throw new Error(`非法 serverId：${serverId}`);
        }
        const basePath = path.resolve(instancesDir);
        const resolvedTarget = path.resolve(basePath, serverId);
        // 校验：resolvedTarget 必须在 instances/<server_id> 下
        const expected = path.resolve(basePath, serverId);
        if (resolvedTarget !== expected) {
          throw new Error(`路径越界：${serverId} 解析到 ${resolvedTarget} 不等于预期 ${expected}`);
        }
        return resolvedTarget;
      }

      case 'subdir': {
        // instances/<server_id>/<subdir>/
        if (!serverId || !subdir) {
          throw new Error('namespace=subdir 时 serverId 和 subdir 必填');
        }
        if (!SERVER_ID_PATTERN.test(serverId)) {
          throw new Error(`非法 serverId：${serverId}`);
        }
        if (!ALLOWED_SUBDIRS.has(subdir)) {
          throw new Error(
            `非法 subdir：${subdir}，允许：${Array.from(ALLOWED_SUBDIRS).join('/')}`,
          );
        }
        const basePath = path.resolve(instancesDir);
        const resolvedTarget = path.resolve(basePath, serverId, subdir);
        // 校验：resolvedTarget 必须等于 instances/<server_id>/<subdir>
        const expected = path.resolve(basePath, serverId, subdir);
        if (resolvedTarget !== expected) {
          throw new Error(`路径越界：${subdir} 解析到 ${resolvedTarget} 不等于预期 ${expected}`);
        }
        return resolvedTarget;
      }

      default:
        throw new Error(`未知的 namespace：${namespace satisfies never}`);
    }
  }
}

/** 工厂函数 */
export function createSafeRemoveService(daemonClient: DaemonClient): SafeRemoveService {
  return new SafeRemoveService(daemonClient);
}
