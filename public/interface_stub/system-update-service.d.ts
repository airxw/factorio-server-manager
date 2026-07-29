/**
 * system-update-service.d.ts — systemUpdateService 接口存根
 *
 * 职责：系统版本检查 / 更新执行 / 蓝绿切换 / 回滚
 * 数据契约：public/schema/system_update_jobs-schema.json
 * 来源：s0103 融合定稿 v3.4.0 §互斥点① B 蓝绿为主 + A git 可选
 *
 * @version 1.0.0
 */

import type {
  BuildInfo,
  SystemUpdateInfo,
  PerformUpdateResponse,
  UpdateStatus,
} from './shared-types';
import {
  SystemUpdateDownloadFailedError,
  SystemUpdateVerifyFailedError,
  SystemUpdateMigrationFailedError,
  UpdateJobNotFoundError,
} from './shared-types';

export interface SystemUpdateService {
  /**
   * 读取当前构建信息（编译期注入的版本/commit/构建时间）。
   * 不触发外部网络请求，纯本地读取。
   */
  getBuildInfo(): Promise<BuildInfo>;

  /**
   * 检查系统更新。从 UPDATE_MANIFEST_URL（默认 GitHub Releases API）拉取最新版本元数据，
   * 与本地 BuildInfo.version 比对，返回是否有更新及下载信息。
   *
   * 实现说明：
   * - UPDATE_SOURCE_TYPE=git 时简化为 git fetch + git log 比对
   * - UPDATE_SOURCE_TYPE=tar 时拉取 manifest JSON 并校验 sha256
   *
   * @throws {SystemUpdateDownloadFailedError} manifest 拉取失败（可重试）
   */
  checkSystemUpdate(): Promise<SystemUpdateInfo>;

  /**
   * 触发一次系统更新任务（异步执行）。返回 jobId 供轮询状态。
   *
   * 并发约束：同一 user_id 仅允许 1 个 running 状态任务（部分索引 idx_update_jobs_user_status 强制）。
   *
   * 执行步骤（B 蓝绿路径）：
   * 1. pending → 2. downloading → 3. verifying (sha256) → 4. migrating (knex migrate.latest on next 目录)
   *    → 5. switching (symlink current → next, 旧 current → previous) → 6. smoke_testing (HTTP /api/health on SMOKE_TEST_PORT)
   *    → 7. succeeded / failed
   *
   * A git_pull 路径：直接 git fetch + git reset --hard + knex migrate.latest + 重启进程（无蓝绿切换）
   *
   * @throws {SystemUpdateDownloadFailedError} 下载失败
   * @throws {SystemUpdateVerifyFailedError} sha256 校验失败
   * @throws {SystemUpdateMigrationFailedError} knex 迁移失败（回滚 symlink，保留 previous）
   */
  performUpdate(): Promise<PerformUpdateResponse>;

  /**
   * 查询指定 jobId 的更新任务状态。供前端轮询（建议间隔 1-2s）。
   * @throws {UpdateJobNotFoundError} jobId 不存在（错误码 SYSTEM_JOB_NOT_FOUND，404）
   */
  getUpdateStatus(jobId: string): Promise<UpdateStatus>;

  /**
   * 回滚到上一个版本（previous 目录）。若无 previous 目录，返回错误。
   * 若指定 jobId，则回滚到该 jobId 对应的版本；否则回滚到最近一次 succeeded 任务的版本。
   *
   * @throws {SystemUpdateVerifyFailedError} 无可回滚目标（previous 目录不存在）
   */
  rollbackUpdate(jobId?: string): Promise<PerformUpdateResponse>;
}
