// ============================================================================
// errors.ts — 模块2_系统诊断：运行时错误类
//
// 契约对齐：
//   - @public/interface_stub/shared-types.d.ts 中的错误类声明（仅类型，无运行时实现）
//   - @public/schema/error-codes-schema.json predefined_codes:
//       SYSTEM_FIX_001 (http_status=404, retryable=false)
//
// 约束:
//   - AGENTS.md 禁止 import panel/backend/src/services/errors.ts 内部实现
//   - 故 AppError + SystemFixInvalidError 在本模块内提供运行时实现
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
 * 修复 ID 无效错误。
 * code = SYSTEM_FIX_001 (error-codes-schema.json: http_status=404, retryable=false)
 * 触发场景：fixId 不在 diagnostic-fixes.json 白名单中，或脚本路径越界 scripts/ 目录。
 */
export class SystemFixInvalidError extends AppError {
  readonly code = 'SYSTEM_FIX_001';
  readonly category = 'system';
  readonly httpStatus = 404;
  readonly retryable = false;

  constructor(message = '修复 ID 无效或不在白名单') {
    super(message);
  }
}
