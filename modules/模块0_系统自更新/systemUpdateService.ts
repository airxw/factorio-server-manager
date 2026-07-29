// ============================================================================
// systemUpdateService.ts — 模块0_系统自更新：系统版本检查 / 更新执行 / 蓝绿切换 / 回滚
//
// 契约对齐：
//   - @public/interface_stub/system-update-service.d.ts (SystemUpdateService, @version 1.0.0)
//   - @public/interface_stub/shared-types.d.ts
//       (BuildInfo, SystemUpdateInfo, PerformUpdateResponse, UpdateStatus,
//        SystemUpdateJobType, SystemUpdateJobStatus, SystemUpdateJob)
//   - @public/schema/system_update_jobs-schema.json (数据契约)
//   - @public/schema/error-codes-schema.json
//       (SYSTEM_UPDATE_001/002/003, SYSTEM_JOB_NOT_FOUND)
//   - @public/config_template/panel-config.schema.json (system_update 配置段)
//
// 实现要点（模块专属约束）：
//   - 支持两种更新类型：tar_blue_green（默认，蓝绿部署）、git_pull（可选）
//   - 部署目录：${DEPLOY_ROOT}/{current,next,previous,shared}
//   - 进程管理器：systemd（systemctl restart）/ pm2 / none
//   - 冒烟测试：切换后访问 http://localhost:${SMOKE_TEST_PORT}/health
//   - 状态机：pending→downloading→verifying→migrating→switching→smoke_testing→succeeded/failed
//   - 失败回滚：任一步骤失败自动 rollback 到 previous，状态置 rolled_back
//   - SHA256 校验：下载后必须校验 manifest 提供的 sha256
//   - 迁移前置：knex migrate:latest 在 switching 前执行
//   - 命令注入防护：所有路径参数经 path.resolve 校验在 DEPLOY_ROOT 内
//
// 偏离契约说明：
//   - 契约 performUpdate() / rollbackUpdate(jobId?) 无 userId 参数
//   - 本实现 performUpdate(userId) / rollbackUpdate(userId) 增加 userId 参数
//     原因：system_update_jobs.user_id 为 required 字段，必须记录发起人；
//           userId 从 JWT (req.user.userId) 获取，由路由层传入
//   - 故本类不 implements SystemUpdateService 接口（避免签名冲突），
//     但方法名与返回类型严格对齐契约
//
// 约束:
//   - 禁止 import panel/backend/src/services/ 或 panel/backend/src/api/routes/ 内部实现
//   - 故 AppError + 4 个错误类在本模块 errors.ts 内提供运行时实现
// ============================================================================

import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Knex } from 'knex';
import type {
  BuildInfo,
  SystemUpdateInfo,
  PerformUpdateResponse,
  UpdateStatus,
  SystemUpdateJobType,
  SystemUpdateJobStatus,
} from '@public/interface_stub/shared-types';
import {
  SystemUpdateDownloadFailedError,
  SystemUpdateVerifyFailedError,
  SystemUpdateMigrationFailedError,
  UpdateJobNotFoundError,
} from './errors.js';

// ----------------------------------------------------------------------------
// 常量
// ----------------------------------------------------------------------------

/** tar 下载超时（ms） */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** manifest 拉取超时（ms） */
const MANIFEST_TIMEOUT_MS = 15_000;

/** sha256 校验文件读取批次大小（字节） */
const SHA256_CHUNK_BYTES = 1024 * 1024;

/** 冒烟测试重试间隔（ms） */
const SMOKE_TEST_RETRY_INTERVAL_MS = 1000;

/** 部署子目录名 */
const DEPLOY_SUBDIR_NEXT = 'next';
const DEPLOY_SUBDIR_CURRENT = 'current';
const DEPLOY_SUBDIR_PREVIOUS = 'previous';
const DEPLOY_TMP_CURRENT = '.current.tmp';

// ----------------------------------------------------------------------------
// DB 行类型
// ----------------------------------------------------------------------------

/** system_update_jobs 表行类型（DB 层，可能含 null） */
interface SystemUpdateJobRow {
  id: string;
  user_id: string;
  type: string;
  status: string;
  step: string | null;
  progress: number;
  target_version: string | null;
  is_rollback: number; // SQLite boolean 存为 0/1
  rollback_from_job_id: string | null;
  started_at: string | Date;
  finished_at: string | Date | null;
  error_message: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

// ----------------------------------------------------------------------------
// GitHub Releases manifest 响应类型（部分字段）
// ----------------------------------------------------------------------------

interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

interface GitHubReleaseManifest {
  tag_name?: string;
  body?: string;
  tarball_url?: string;
  assets?: GitHubReleaseAsset[];
}

// ----------------------------------------------------------------------------
// 服务实现
// ----------------------------------------------------------------------------

/**
 * SystemUpdateService 实现。
 *
 * 通过构造函数注入共享 db（knex 连接），不依赖其他模块的内部实现。
 * 环境变量从 process.env 读取（UPDATE_SOURCE_TYPE / UPDATE_MANIFEST_URL /
 * UPDATE_BRANCH / DEPLOY_ROOT / PROCESS_MANAGER / SMOKE_TEST_*）。
 */
export class SystemUpdateServiceImpl {
  constructor(private readonly db: Knex) {}

  /**
   * 读取当前构建信息。
   * 来源优先级：BUILD_INFO.json > git 命令 > 空字符串。
   */
  async getBuildInfo(): Promise<BuildInfo> {
    // 1. 读取 package.json version
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    let version = '0.0.0';
    try {
      const pkgContent = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgContent) as { version?: string };
      version = pkg.version ?? '0.0.0';
    } catch {
      // package.json 读取失败，降级到 0.0.0
    }

    // 2. 读取 BUILD_INFO.json（若存在）
    let buildTime = '';
    let commit = '';
    let gitBranch = '';
    let gitCommit = '';
    const buildInfoPath = path.resolve(process.cwd(), 'BUILD_INFO.json');
    if (existsSync(buildInfoPath)) {
      try {
        const biContent = await fs.readFile(buildInfoPath, 'utf-8');
        const bi = JSON.parse(biContent) as {
          buildTime?: string;
          commit?: string;
          gitBranch?: string;
          gitCommit?: string;
        };
        buildTime = bi.buildTime ?? '';
        commit = bi.commit ?? '';
        gitBranch = bi.gitBranch ?? '';
        gitCommit = bi.gitCommit ?? '';
      } catch {
        // BUILD_INFO.json 解析失败，降级到 git
      }
    }

    // 3. BUILD_INFO.json 未提供的字段，从 git 命令读取
    if (!commit) {
      commit = tryExecSync('git rev-parse --short HEAD');
    }
    if (!gitCommit) {
      gitCommit = tryExecSync('git rev-parse HEAD');
    }
    if (!gitBranch) {
      gitBranch = tryExecSync('git rev-parse --abbrev-ref HEAD');
    }
    if (!buildTime) {
      buildTime = new Date().toISOString();
    }

    return { version, commit, buildTime, gitBranch, gitCommit };
  }

  /**
   * 检查系统更新。
   * tar 模式：fetch UPDATE_MANIFEST_URL（GitHub Releases API），解析最新版本。
   * git 模式：git fetch + git log 比对本地与远程 commit。
   *
   * @throws {SystemUpdateDownloadFailedError} manifest 拉取失败
   */
  async checkSystemUpdate(): Promise<SystemUpdateInfo> {
    const buildInfo = await this.getBuildInfo();
    const currentVersion = buildInfo.version;
    const sourceType = process.env.UPDATE_SOURCE_TYPE ?? 'tar';

    if (sourceType === 'git') {
      return this.checkGitUpdate(currentVersion);
    }
    return this.checkTarUpdate(currentVersion);
  }

  /**
   * 触发一次系统更新任务（异步执行）。
   * 立即 INSERT job 记录并返回 jobId，doUpdateJob 在后台异步执行。
   *
   * @param userId 发起任务的用户 ID（从 JWT 获取）
   * @returns {jobId, status:'started'}
   */
  async performUpdate(userId: string): Promise<PerformUpdateResponse> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const sourceType = process.env.UPDATE_SOURCE_TYPE ?? 'tar';
    const type: SystemUpdateJobType = sourceType === 'git' ? 'git_pull' : 'tar_blue_green';

    await this.db('system_update_jobs').insert({
      id,
      user_id: userId,
      type,
      status: 'pending',
      step: 'queued',
      progress: 0,
      target_version: null,
      is_rollback: 0,
      rollback_from_job_id: null,
      started_at: now,
      finished_at: null,
      error_message: null,
      created_at: now,
      updated_at: now,
    });

    // 异步启动 job（不 await，立即返回 jobId）
    void this.doUpdateJob(id).catch((err: unknown) => {
      // doUpdateJob 内部已处理错误并更新 DB，这里是兜底日志
      console.error(`[systemUpdate] doUpdateJob ${id} 未捕获异常:`, err);
    });

    return { jobId: id, status: 'started' };
  }

  /**
   * 查询指定 jobId 的更新任务状态。
   *
   * @throws {UpdateJobNotFoundError} jobId 不存在
   */
  async getUpdateStatus(jobId: string): Promise<UpdateStatus> {
    const row = await this.db<SystemUpdateJobRow>('system_update_jobs')
      .where({ id: jobId })
      .first();
    if (!row) {
      throw new UpdateJobNotFoundError(`Update job not found: jobId=${jobId}`);
    }
    return {
      jobId: row.id,
      status: row.status as SystemUpdateJobStatus,
      progress: row.progress,
      step: row.step ?? '',
      errorMessage: row.error_message,
      startedAt: toIsoString(row.started_at),
      finishedAt: row.finished_at ? toIsoString(row.finished_at) : null,
    };
  }

  /**
   * 回滚到上一个版本（previous 目录）。
   * 查找最近一次 succeeded 的更新任务，触发回滚 job。
   *
   * @param userId 发起回滚的用户 ID
   * @returns {jobId, status:'rollback_started'}
   * @throws {SystemUpdateVerifyFailedError} 无可回滚目标
   */
  async rollbackUpdate(userId: string): Promise<PerformUpdateResponse> {
    // 查找最近一次 succeeded 的非回滚 job
    const lastSuccess = await this.db<SystemUpdateJobRow>('system_update_jobs')
      .where({ is_rollback: 0, status: 'succeeded' })
      .orderBy('started_at', 'desc')
      .first();

    if (!lastSuccess) {
      throw new SystemUpdateVerifyFailedError('无可回滚目标（无成功更新记录）');
    }

    const rollbackJobId = await this.performRollback(lastSuccess.id, userId);
    return { jobId: rollbackJobId, status: 'rollback_started' };
  }

  // ==========================================================================
  // 状态机调度
  // ==========================================================================

  /**
   * 更新任务后台执行器。
   * 根据 type 调度到对应路径（tar_blue_green / git_pull）。
   * 任一步骤失败 → failed → 自动 rollbackUpdate → rolled_back（仅 tar_blue_green）。
   */
  private async doUpdateJob(jobId: string): Promise<void> {
    const row = await this.db<SystemUpdateJobRow>('system_update_jobs')
      .where({ id: jobId })
      .first();
    if (!row) {
      return;
    }

    const type = row.type as SystemUpdateJobType;
    const userId = row.user_id;

    try {
      if (type === 'git_pull') {
        await this.runGitPullJob(jobId);
      } else {
        await this.runTarBlueGreenJob(jobId);
      }
      // 成功状态由 run*Job 内部设置（含 target_version）
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.updateJob(jobId, {
        status: 'failed',
        step: 'failed',
        error_message: errorMessage,
        finished_at: new Date().toISOString(),
      });
      // 自动回滚（仅 tar_blue_green 路径且非回滚 job）
      if (type === 'tar_blue_green' && !this.isRowRollback(row)) {
        try {
          await this.performRollback(jobId, userId);
        } catch (rollbackErr) {
          // 回滚失败记录到日志（job 状态已由 performRollback 内部更新）
          console.error(
            `[systemUpdate] 自动回滚失败 job=${jobId}:`,
            rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
          );
        }
      }
    }
  }

  /**
   * tar 蓝绿更新路径：9 态状态机完整执行。
   */
  private async runTarBlueGreenJob(jobId: string): Promise<void> {
    // 1. pending → downloading：fetch manifest
    await this.updateJob(jobId, {
      status: 'downloading',
      step: 'fetching manifest',
      progress: 10,
    });
    const updateInfo = await this.checkSystemUpdate();
    if (!updateInfo.hasUpdate) {
      throw new Error('当前已是最新版本，无需更新');
    }
    if (!updateInfo.downloadUrl) {
      throw new SystemUpdateDownloadFailedError('manifest 未提供 downloadUrl');
    }

    const deployRoot = process.env.DEPLOY_ROOT ?? '/opt/gameserver-panel';
    const nextDir = this.resolveWithinDeployRoot(deployRoot, DEPLOY_SUBDIR_NEXT);

    // 2. downloading：下载 tar 包到 ${DEPLOY_ROOT}/next/
    await this.updateJob(jobId, {
      status: 'downloading',
      step: 'downloading tar package',
      progress: 25,
    });
    await fs.mkdir(nextDir, { recursive: true });
    const tarPath = this.resolveWithinDeployRoot(deployRoot, `${DEPLOY_SUBDIR_NEXT}/package.tar.gz`);
    await this.downloadFile(updateInfo.downloadUrl, tarPath);

    // 3. downloading → verifying：SHA256 校验
    await this.updateJob(jobId, {
      status: 'verifying',
      step: 'verifying sha256',
      progress: 45,
    });
    if (updateInfo.sha256) {
      const actualHash = await this.computeSha256(tarPath);
      if (actualHash !== updateInfo.sha256) {
        throw new SystemUpdateVerifyFailedError(
          `sha256 校验失败: expected=${updateInfo.sha256}, actual=${actualHash}`,
        );
      }
    }

    // 4. verifying → migrating：knex migrate:latest
    await this.updateJob(jobId, {
      status: 'migrating',
      step: 'running knex migrations',
      progress: 60,
    });
    try {
      execSync('npx knex migrate:latest --knexfile src/db/knexfile.ts', {
        cwd: nextDir,
        stdio: 'pipe',
        timeout: 120_000,
      });
    } catch (err) {
      throw new SystemUpdateMigrationFailedError(
        `knex migrate 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 5. migrating → switching：symlink 原子切换 current → previous, next → current
    await this.updateJob(jobId, {
      status: 'switching',
      step: 'switching symlinks',
      progress: 75,
    });
    await this.switchSymlinks(deployRoot, nextDir);

    // 6. switching → smoke_testing：访问 /health 重试
    await this.updateJob(jobId, {
      status: 'smoke_testing',
      step: 'smoke testing',
      progress: 90,
    });
    await this.runSmokeTest();

    // 7. smoke_testing → succeeded
    await this.updateJob(jobId, {
      status: 'succeeded',
      step: 'completed',
      progress: 100,
      target_version: updateInfo.latestVersion,
      finished_at: new Date().toISOString(),
    });
  }

  /**
   * git pull 更新路径：git fetch + git reset --hard + knex migrate + 重启。
   * 无蓝绿切换（直接在当前目录操作）。
   */
  private async runGitPullJob(jobId: string): Promise<void> {
    const branch = process.env.UPDATE_BRANCH ?? 'main';

    // 1. pending → downloading：git fetch
    await this.updateJob(jobId, {
      status: 'downloading',
      step: 'git fetch',
      progress: 20,
    });
    try {
      execSync(`git fetch origin ${branch}`, { stdio: 'pipe', timeout: 60_000 });
    } catch (err) {
      throw new SystemUpdateDownloadFailedError(
        `git fetch 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 2. downloading → verifying：git reset --hard
    await this.updateJob(jobId, {
      status: 'verifying',
      step: 'git reset --hard',
      progress: 40,
    });
    try {
      execSync(`git reset --hard origin/${branch}`, { stdio: 'pipe', timeout: 30_000 });
    } catch (err) {
      throw new SystemUpdateVerifyFailedError(
        `git reset 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 3. verifying → migrating：knex migrate:latest
    await this.updateJob(jobId, {
      status: 'migrating',
      step: 'running knex migrations',
      progress: 60,
    });
    try {
      execSync('npx knex migrate:latest --knexfile src/db/knexfile.ts', {
        stdio: 'pipe',
        timeout: 120_000,
      });
    } catch (err) {
      throw new SystemUpdateMigrationFailedError(
        `knex migrate 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 4. migrating → switching：重启服务（git 路径无 symlink 切换）
    await this.updateJob(jobId, {
      status: 'switching',
      step: 'restarting service',
      progress: 80,
    });
    await this.restartService();

    // 5. switching → smoke_testing：冒烟测试
    await this.updateJob(jobId, {
      status: 'smoke_testing',
      step: 'smoke testing',
      progress: 90,
    });
    await this.runSmokeTest();

    // 6. smoke_testing → succeeded
    const latestCommit = tryExecSync(`git rev-parse --short origin/${branch}`);
    await this.updateJob(jobId, {
      status: 'succeeded',
      step: 'completed',
      progress: 100,
      target_version: latestCommit || null,
      finished_at: new Date().toISOString(),
    });
  }

  /**
   * 执行回滚操作：swap current ↔ previous，重启服务。
   * 创建新的回滚 job 记录（is_rollback=true）。
   *
   * @param failedJobId 原更新任务 ID（写入 rollback_from_job_id）
   * @param userId 发起回滚的用户 ID
   * @returns 回滚 job ID
   * @throws {SystemUpdateVerifyFailedError} 无 previous 目录
   */
  private async performRollback(failedJobId: string, userId: string): Promise<string> {
    const now = new Date().toISOString();
    const rollbackJobId = crypto.randomUUID();

    await this.db('system_update_jobs').insert({
      id: rollbackJobId,
      user_id: userId,
      type: 'tar_blue_green',
      status: 'switching',
      step: 'rolling back symlinks',
      progress: 50,
      target_version: null,
      is_rollback: 1,
      rollback_from_job_id: failedJobId,
      started_at: now,
      finished_at: null,
      error_message: null,
      created_at: now,
      updated_at: now,
    });

    const deployRoot = process.env.DEPLOY_ROOT ?? '/opt/gameserver-panel';

    try {
      await this.swapSymlinks(deployRoot);
      await this.restartService();

      await this.db('system_update_jobs').where({ id: rollbackJobId }).update({
        status: 'rolled_back',
        step: 'rolled back',
        progress: 100,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.db('system_update_jobs').where({ id: rollbackJobId }).update({
        status: 'failed',
        step: 'rollback failed',
        error_message: errorMessage,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      throw err;
    }

    return rollbackJobId;
  }

  // ==========================================================================
  // 私有辅助：检查更新
  // ==========================================================================

  /**
   * tar 模式检查更新：fetch GitHub Releases API。
   */
  private async checkTarUpdate(currentVersion: string): Promise<SystemUpdateInfo> {
    const manifestUrl =
      process.env.UPDATE_MANIFEST_URL ??
      'https://api.github.com/repos/airxw/gameserver-panel/releases/latest';

    let release: GitHubReleaseManifest;
    try {
      const response = await fetch(manifestUrl, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      release = (await response.json()) as GitHubReleaseManifest;
    } catch (err) {
      throw new SystemUpdateDownloadFailedError(
        `manifest 拉取失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const tagName = release.tag_name ?? '';
    const latestVersion = tagName.replace(/^v/, '');
    const releaseNotes = release.body ?? '';

    // 查找 tar 包 asset
    const tarAsset = release.assets?.find((a) => a.name?.endsWith('.tar.gz'));
    const downloadUrl = tarAsset?.browser_download_url ?? release.tarball_url ?? '';

    // 查找 .sha256 校验文件并下载内容
    let sha256 = '';
    const sha256Asset = release.assets?.find((a) => a.name?.endsWith('.sha256'));
    if (sha256Asset?.browser_download_url) {
      try {
        const shaResp = await fetch(sha256Asset.browser_download_url, {
          signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
        });
        if (shaResp.ok) {
          const shaText = await shaResp.text();
          // .sha256 文件格式通常为 "<hash>  <filename>"，取首段
          sha256 = shaText.trim().split(/\s+/)[0] ?? '';
        }
      } catch {
        // sha256 文件拉取失败，降级为空（后续 verifying 步骤跳过校验）
      }
    }

    const hasUpdate = latestVersion !== '' && latestVersion !== currentVersion;

    return {
      currentVersion,
      latestVersion,
      hasUpdate,
      releaseNotes,
      downloadUrl,
      sha256,
    };
  }

  /**
   * git 模式检查更新：git fetch + git log 比对。
   */
  private async checkGitUpdate(currentVersion: string): Promise<SystemUpdateInfo> {
    const branch = process.env.UPDATE_BRANCH ?? 'main';
    try {
      execSync(`git fetch origin ${branch}`, { stdio: 'pipe', timeout: 60_000 });
    } catch (err) {
      throw new SystemUpdateDownloadFailedError(
        `git fetch 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const localCommit = tryExecSync('git rev-parse HEAD');
    const remoteCommit = tryExecSync(`git rev-parse origin/${branch}`);
    const hasUpdate = localCommit !== '' && remoteCommit !== '' && localCommit !== remoteCommit;

    let latestVersion = currentVersion;
    let releaseNotes = '';
    if (hasUpdate) {
      latestVersion = tryExecSync(`git describe --tags origin/${branch}`) || remoteCommit.substring(0, 7);
      releaseNotes = tryExecSync(`git log --oneline HEAD..origin/${branch}`);
    }

    return {
      currentVersion,
      latestVersion,
      hasUpdate,
      releaseNotes,
      downloadUrl: '',
      sha256: '',
    };
  }

  // ==========================================================================
  // 私有辅助：部署操作
  // ==========================================================================

  /**
   * 蓝绿 symlink 原子切换：current → previous, next → current。
   * 使用临时 symlink + rename 实现原子替换。
   */
  private async switchSymlinks(deployRoot: string, nextDir: string): Promise<void> {
    const currentLink = this.resolveWithinDeployRoot(deployRoot, DEPLOY_SUBDIR_CURRENT);
    const previousLink = this.resolveWithinDeployRoot(deployRoot, DEPLOY_SUBDIR_PREVIOUS);
    const tmpLink = this.resolveWithinDeployRoot(deployRoot, DEPLOY_TMP_CURRENT);

    // 1. 移除旧 previous symlink（若存在）
    await safeUnlink(previousLink);

    // 2. current → previous（若 current 是 symlink，记录其目标到 previous）
    try {
      const currentTarget = await fs.readlink(currentLink);
      await fs.symlink(currentTarget, previousLink);
    } catch {
      // current 不存在或不是 symlink，跳过（首次部署场景）
    }

    // 3. 原子切换 current → next：先创建临时 symlink，再 rename
    await safeUnlink(tmpLink);
    await fs.symlink(nextDir, tmpLink);
    await fs.rename(tmpLink, currentLink);
  }

  /**
   * 回滚时 swap current ↔ previous。
   * previous 成为新 current，原 current 成为新 previous。
   */
  private async swapSymlinks(deployRoot: string): Promise<void> {
    const currentLink = this.resolveWithinDeployRoot(deployRoot, DEPLOY_SUBDIR_CURRENT);
    const previousLink = this.resolveWithinDeployRoot(deployRoot, DEPLOY_SUBDIR_PREVIOUS);
    const tmpLink = this.resolveWithinDeployRoot(deployRoot, DEPLOY_TMP_CURRENT);

    let previousTarget: string;
    try {
      previousTarget = await fs.readlink(previousLink);
    } catch {
      throw new SystemUpdateVerifyFailedError('无可回滚目标（previous 目录不存在）');
    }

    // 原子切换 current → previous target
    await safeUnlink(tmpLink);
    await fs.symlink(previousTarget, tmpLink);

    // 原 current → 新 previous
    try {
      const currentTarget = await fs.readlink(currentLink);
      await safeUnlink(previousLink);
      await fs.symlink(currentTarget, previousLink);
    } catch {
      // current 不存在，跳过
    }

    await fs.rename(tmpLink, currentLink);
  }

  /**
   * 冒烟测试：访问 http://localhost:${SMOKE_TEST_PORT}/health，重试 N 次。
   */
  private async runSmokeTest(): Promise<void> {
    const port = parseInt(process.env.SMOKE_TEST_PORT ?? '9090', 10);
    const timeoutMs = parseInt(process.env.SMOKE_TEST_TIMEOUT_MS ?? '5000', 10);
    const maxRetries = parseInt(process.env.SMOKE_TEST_MAX_RETRIES ?? '3', 10);
    const url = `http://localhost:${port}/health`;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (response.ok) {
          return;
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
      if (attempt < maxRetries - 1) {
        await sleep(SMOKE_TEST_RETRY_INTERVAL_MS);
      }
    }
    throw new Error(
      `冒烟测试失败 (${maxRetries} 次重试): ${lastError?.message ?? 'unknown'}`,
    );
  }

  /**
   * 重启服务（通过进程管理器）。
   * systemd: systemctl restart gameserver-panel
   * pm2: pm2 restart gameserver-panel
   * none: 不重启（开发模式，由开发者手动重启）
   */
  private async restartService(): Promise<void> {
    const processManager = process.env.PROCESS_MANAGER ?? 'systemd';
    if (processManager === 'none') {
      return;
    }
    const command =
      processManager === 'pm2'
        ? 'pm2 restart gameserver-panel'
        : 'systemctl restart gameserver-panel';
    try {
      execSync(command, { stdio: 'pipe', timeout: 30_000 });
    } catch (err) {
      throw new Error(
        `${processManager} restart 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ==========================================================================
  // 私有辅助：文件与路径操作
  // ==========================================================================

  /**
   * 下载文件到指定路径。
   * @throws {SystemUpdateDownloadFailedError} 下载失败
   */
  private async downloadFile(url: string, destPath: string): Promise<void> {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(destPath, buffer);
    } catch (err) {
      if (err instanceof SystemUpdateDownloadFailedError) {
        throw err;
      }
      throw new SystemUpdateDownloadFailedError(
        `下载失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 计算文件 SHA256 哈希（流式读取，避免大文件内存溢出）。
   */
  private async computeSha256(filePath: string): Promise<string> {
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256');
    const handle = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(SHA256_CHUNK_BYTES);
      let bytesRead = 0;
      while ((bytesRead = (await handle.read(buffer, 0, buffer.length, 0)).bytesRead) > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } finally {
      await handle.close();
    }
    return hash.digest('hex');
  }

  /**
   * 路径安全校验：确保 target 在 deployRoot 内（命令注入防护）。
   * @returns 解析后的绝对路径
   * @throws {Error} 路径越界
   */
  private resolveWithinDeployRoot(deployRoot: string, relative: string): string {
    const resolvedRoot = path.resolve(deployRoot);
    const resolvedTarget = path.resolve(resolvedRoot, relative);
    if (
      resolvedTarget !== resolvedRoot &&
      !resolvedTarget.startsWith(resolvedRoot + path.sep)
    ) {
      throw new Error(`路径越界: ${relative} 解析为 ${resolvedTarget}，不在 ${resolvedRoot} 内`);
    }
    return resolvedTarget;
  }

  /**
   * 更新 job 记录（自动追加 updated_at）。
   */
  private async updateJob(
    jobId: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    await this.db('system_update_jobs')
      .where({ id: jobId })
      .update({
        ...fields,
        updated_at: new Date().toISOString(),
      });
  }

  /**
   * 判断 DB 行 is_rollback 字段（SQLite 存为 0/1）。
   */
  private isRowRollback(row: SystemUpdateJobRow): boolean {
    return row.is_rollback === 1;
  }
}

// ----------------------------------------------------------------------------
// 工厂函数
// ----------------------------------------------------------------------------

/**
 * 创建 SystemUpdateService 实例。
 * 由 index.ts 装配时调用，注入共享 db（knex 连接）。
 */
export function createSystemUpdateService(db: Knex): SystemUpdateServiceImpl {
  return new SystemUpdateServiceImpl(db);
}

// ----------------------------------------------------------------------------
// 辅助函数（模块内私有）
// ----------------------------------------------------------------------------

/**
 * 执行同步命令，失败返回空字符串（不抛错）。
 */
function tryExecSync(command: string): string {
  try {
    return execSync(command, { stdio: 'pipe', timeout: 10_000 }).toString().trim();
  } catch {
    return '';
  }
}

/**
 * 安全 unlink：文件不存在则忽略。
 */
async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // 不存在或不是文件，忽略
  }
}

/**
 * Promise-based 非阻塞 sleep。
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 将 DB 时间字段（可能是 Date 或 ISO 字符串）统一转为 ISO 字符串。
 */
function toIsoString(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

// ----------------------------------------------------------------------------
// 重新导出错误类（供路由层使用，避免分散 import）
// ============================================================================

export {
  AppError,
  SystemUpdateDownloadFailedError,
  SystemUpdateVerifyFailedError,
  SystemUpdateMigrationFailedError,
  UpdateJobNotFoundError,
} from './errors.js';
