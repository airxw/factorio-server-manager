// ============================================================================
// passwordPolicy — v3.9.0-S3 密码强度校验工具
//
// 设计要点：
//   - 共享校验逻辑，避免 register / init / passwordReset 三处重复实现
//   - 规则：长度 ≥ 8 + 必含字母与数字 + zxcvbn score ≥ 2
//   - 返回结构化结果，调用方可拿到具体不满足项 + zxcvbn 改进建议
//
// 与 passwordService.updatePassword 的关系：
//   - passwordService 内部已含 zxcvbn 校验（Layer 1），但针对改密场景（含历史校验）
//   - 本工具针对 register / init / passwordReset 场景，仅做基础校验
//   - 两者可并存：register 用本工具，改密用 passwordService
// ============================================================================

import zxcvbn from 'zxcvbn';

export interface PasswordCheckResult {
  /** 是否通过校验 */
  ok: boolean;
  /** zxcvbn 评分 0-4 */
  score: number;
  /** 不满足的具体原因列表（ok=true 时为空） */
  failures: string[];
  /** zxcvbn 给出的改进建议（ok=true 时为空） */
  suggestions: string[];
}

/** 最小密码长度 */
export const MIN_PASSWORD_LENGTH = 8;
/** 最大密码长度（防 DoS） */
export const MAX_PASSWORD_LENGTH = 128;
/** 最低 zxcvbn 评分 */
export const MIN_ZXCVBN_SCORE = 2;

/**
 * 禁用密码列表——常见弱密码，即使在 zxcvbn 评分达标时也拒绝。
 * v4.18.0: 用于初始化向导 / 注册 / 改密场景的硬拦截。
 */
export const FORBIDDEN_PASSWORDS: readonly string[] = [
  'admin123',
  '12345678',
  '123456789',
  '1234567890',
  'password',
  'password1',
  'password123',
  'qwerty123',
  'abc12345',
  'iloveyou1',
] as const;

/**
 * v4.18.0: 密码策略规则——供前端实时校验使用。
 * 与 `checkPasswordStrength` 内部规则 1:1 对齐，前端拉取后可在用户输入时
 * 即时反馈具体不满足项 + zxcvbn 评分条，无需重复实现规则。
 *
 * 暴露方式：`GET /api/auth/password-policy`（公开接口）。
 *
 * 注意：不使用 `as const` —— `forbidden_passwords` 需为 `string[]`（可变数组）
 * 以匹配 `PasswordPolicyResponse` 契约定义。
 */
export const PASSWORD_POLICY_RULES: {
  min_length: number;
  max_length: number;
  min_zxcvbn_score: number;
  require_letter: boolean;
  require_digit: boolean;
  forbidden_passwords: string[];
} = {
  /** 最小密码长度 */
  min_length: MIN_PASSWORD_LENGTH,
  /** 最大密码长度 */
  max_length: MAX_PASSWORD_LENGTH,
  /** 最低 zxcvbn 评分（0-4） */
  min_zxcvbn_score: MIN_ZXCVBN_SCORE,
  /** 是否必须包含字母 */
  require_letter: true,
  /** 是否必须包含数字 */
  require_digit: true,
  /** 禁用密码列表（与 FORBIDDEN_PASSWORDS 同源；复制为新数组避免外部修改） */
  forbidden_passwords: [...FORBIDDEN_PASSWORDS],
};

/**
 * 校验密码是否为禁用密码（即便 zxcvbn 评分达标也拒绝）。
 * 大小写不敏感比较。
 */
export function isForbiddenPassword(password: string): boolean {
  const lower = password.toLowerCase();
  return FORBIDDEN_PASSWORDS.some((p) => p.toLowerCase() === lower);
}

/**
 * 校验密码强度。
 * 规则：
 *   1. 长度 8-128
 *   2. 必含字母与数字（大小写不敏感）
 *   3. zxcvbn score ≥ 2
 *
 * v4.18.0: 新增 `checkForbidden` 选项——为 true 时同时校验禁用密码列表。
 *   - 默认 false：保持向后兼容（register / passwordReset 等已有调用方不变）
 *   - true：初始化向导 / 改密场景应显式传入，前端硬拦截 admin123 等弱密码
 */
export interface CheckPasswordStrengthOptions {
  /** 是否同时校验禁用密码列表（默认 false） */
  checkForbidden?: boolean;
}

export function checkPasswordStrength(
  password: string,
  options: CheckPasswordStrengthOptions = {},
): PasswordCheckResult {
  const failures: string[] = [];

  // 规则 1: 长度
  if (password.length < MIN_PASSWORD_LENGTH) {
    failures.push(`密码长度不足，至少 ${MIN_PASSWORD_LENGTH} 位`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    failures.push(`密码长度过长，至多 ${MAX_PASSWORD_LENGTH} 位`);
  }

  // 规则 2: 字母 + 数字
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  if (!hasLetter) {
    failures.push('密码必须包含至少一个字母');
  }
  if (!hasDigit) {
    failures.push('密码必须包含至少一个数字');
  }

  // 规则 3: zxcvbn 评分
  const result = zxcvbn(password);
  const suggestions = result.feedback.suggestions ?? [];
  if (result.score < MIN_ZXCVBN_SCORE) {
    failures.push(
      `密码强度不足（zxcvbn score ${result.score}/${MIN_ZXCVBN_SCORE}）`,
    );
  }

  // 规则 4（可选）: 禁用密码列表
  if (options.checkForbidden && isForbiddenPassword(password)) {
    failures.push('该密码为常见弱密码或默认密码，必须修改');
  }

  return {
    ok: failures.length === 0,
    score: result.score,
    failures,
    suggestions,
  };
}
