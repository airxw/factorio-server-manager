// ============================================================================
// errors.ts — 模块3_用户安全：运行时错误类
//
// 契约对齐：
//   - @public/interface_stub/shared-types.d.ts 中的错误类声明（仅类型，无运行时实现）
//   - @public/schema/error-codes-schema.json predefined_codes:
//       INVALID_CREDENTIAL (http_status=401, category=auth, retryable=false)
//       AUTH_PWD_002        (http_status=400, category=auth, retryable=false)
//       AUTH_PWD_003        (http_status=409, category=auth, retryable=false)
//
// 约束:
//   - AGENTS.md 禁止 import panel/backend/src/services/errors.ts 内部实现
//   - 故 AppError + 子类在本模块内提供运行时实现
//   - 与 panel/backend/src/services/errors.ts 的 AppError 结构一致：
//     instanceof AppError, 含 code/message/httpStatus/category/retryable 字段
//
// 说明：
//   - 旧密码错误复用 INVALID_CREDENTIAL 错误码（与 AGENTS.md §2 一致，
//     “复用既有错误码避免枚举”）。error-codes-schema.json 中 AUTH_PWD_001
//     为同义错误码，但实现层统一抛 INVALID_CREDENTIAL 以防枚举攻击。
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
 * 旧密码不匹配错误。
 * code = INVALID_CREDENTIAL (error-codes-schema.json: http_status=401, retryable=false)
 * 触发场景：updatePassword 的 oldPassword 与当前密码 hash 不匹配。
 * 复用既有错误码避免枚举攻击（AGENTS.md §2）。
 */
export class InvalidCredentialError extends AppError {
  readonly code = 'INVALID_CREDENTIAL';
  readonly category = 'auth';
  readonly httpStatus = 401;
  readonly retryable = false;

  constructor(message = '旧密码不正确') {
    super(message);
  }
}

/**
 * 密码强度不足错误。
 * code = AUTH_PWD_002 (error-codes-schema.json: http_status=400, retryable=false)
 * 触发场景：zxcvbn(newPassword).score < auth.password_policy.min_zxcvbn_score（默认 3）。
 */
export class PasswordStrengthInsufficientError extends AppError {
  readonly code = 'AUTH_PWD_002';
  readonly category = 'auth';
  readonly httpStatus = 400;
  readonly retryable = false;

  constructor(message = '密码强度不足') {
    super(message);
  }
}

/**
 * 密码历史重用错误。
 * code = AUTH_PWD_003 (error-codes-schema.json: http_status=409, retryable=false)
 * 触发场景：bcrypt.compare(newPassword, history.hash) 命中最近 max_history 条历史密码。
 */
export class PasswordReusedError extends AppError {
  readonly code = 'AUTH_PWD_003';
  readonly category = 'auth';
  readonly httpStatus = 409;
  readonly retryable = false;

  constructor(message = '新密码与最近使用的历史密码重复') {
    super(message);
  }
}

/**
 * v4.0.2: 系统内置账号密码只读错误。
 * code = BUILT_IN_ACCOUNT_PASSWORD_READONLY (error-codes-schema.json: http_status=403, retryable=false)
 * 触发场景：尝试修改 users.is_built_in=1 的账号密码（演示账号 admin/manager/user 三个 *@local.dev）。
 * 防御位置：passwordService.updatePassword Layer 0.5（在旧密码校验之后、强度校验之前）
 * 前端表现：Users 管理页内置账号行改密按钮 disabled + 🔒 系统内置徽章
 */
export class BuiltInAccountPasswordReadOnlyError extends AppError {
  readonly code = 'BUILT_IN_ACCOUNT_PASSWORD_READONLY';
  readonly category = 'auth';
  readonly httpStatus = 403;
  readonly retryable = false;

  constructor(message = '此为系统内置账号，密码不可修改') {
    super(message);
  }
}
