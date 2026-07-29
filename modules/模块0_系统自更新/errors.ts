// ============================================================================
// errors.ts — 模块0_系统自更新：运行时错误类
//
// 契约对齐：
//   - @public/interface_stub/shared-types.d.ts 中的错误类声明（仅类型，无运行时实现）
//   - @public/schema/error-codes-schema.json predefined_codes:
//       SYSTEM_UPDATE_001 (http_status=502, retryable=true)
//       SYSTEM_UPDATE_002 (http_status=500, retryable=false)
//       SYSTEM_UPDATE_003 (http_status=500, retryable=false)
//       SYSTEM_JOB_NOT_FOUND (http_status=404, retryable=false)
//
// 约束:
//   - AGENTS.md 禁止 import panel/backend/src/services/errors.ts 内部实现
//   - 故 AppError + 4 个子类在本模块内提供运行时实现
//   - 与 panel/backend/src/services/errors.ts 的 AppError 结构一致：
//     instanceof AppError, 含 code/message/httpStatus/category/retryable 字段
// ============================================================================

/**
 * 应用错误基类（对应 shared-types.d.ts AppError）。
 * 与 panel/backend/src/services/errors.ts 的 AppError 结构一致，但本模块独立定义，
 * 避免违反“禁止 import panel/backend/src/services/ 内部代码”约束。
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
  readonly category?: string;
  readonly httpStatus?: number;
  readonly retryable?: boolean;

  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * 系统更新下载失败错误。
 * code = SYSTEM_UPDATE_001 (error-codes-schema.json: http_status=502, retryable=true)
 * 触发场景：manifest 拉取失败、tar 下载失败、网络不可达。
 */
export class SystemUpdateDownloadFailedError extends AppError {
  readonly code = 'SYSTEM_UPDATE_001';
  readonly category = 'system';
  readonly httpStatus = 502;
  readonly retryable = true;

  constructor(message = '系统更新下载失败') {
    super(message);
  }
}

/**
 * 系统更新 sha256 校验失败错误。
 * code = SYSTEM_UPDATE_002 (error-codes-schema.json: http_status=500, retryable=false)
 * 触发场景：下载包损坏或被篡改。不重试，需检查 manifest。
 */
export class SystemUpdateVerifyFailedError extends AppError {
  readonly code = 'SYSTEM_UPDATE_002';
  readonly category = 'system';
  readonly httpStatus = 500;
  readonly retryable = false;

  constructor(message = '系统更新 sha256 校验失败') {
    super(message);
  }
}

/**
 * 系统更新 knex 迁移失败错误。
 * code = SYSTEM_UPDATE_003 (error-codes-schema.json: http_status=500, retryable=false)
 * 触发场景：migrate.latest 抛错。回滚 symlink，保留 previous。
 */
export class SystemUpdateMigrationFailedError extends AppError {
  readonly code = 'SYSTEM_UPDATE_003';
  readonly category = 'system';
  readonly httpStatus = 500;
  readonly retryable = false;

  constructor(message = '系统更新 knex 迁移失败') {
    super(message);
  }
}

/**
 * 更新任务不存在错误。
 * code = SYSTEM_JOB_NOT_FOUND (error-codes-schema.json: http_status=404, retryable=false)
 * 触发场景：getUpdateStatus(jobId) 查询未命中 system_update_jobs 表。
 */
export class UpdateJobNotFoundError extends AppError {
  readonly code = 'SYSTEM_JOB_NOT_FOUND';
  readonly category = 'system';
  readonly httpStatus = 404;
  readonly retryable = false;

  constructor(message = '更新任务不存在') {
    super(message);
  }
}
