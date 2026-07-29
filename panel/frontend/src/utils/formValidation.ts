// ============================================================================
// 表单字段校验工具
// 提供字段级校验函数与错误信息格式化，供 Login/Register/CreateServer 等表单复用
// ============================================================================

/** 邮箱正则：本地段@域名.顶级域 */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 字段错误映射：字段名 -> 错误信息（null 表示无错误） */
export type FieldErrors<T extends string> = Partial<Record<T, string | null>>;

/** 清除指定字段的错误（返回新对象，便于不可变更新） */
export function clearFieldError<T extends string>(
  errors: FieldErrors<T>,
  field: T,
): FieldErrors<T> {
  if (errors[field] === undefined) return errors;
  const next = { ...errors };
  delete next[field];
  return next;
}

// ---------- 单字段校验函数 ----------

/** 校验邮箱：非空 + 格式 */
export function validateEmail(value: string): string | null {
  const v = value.trim();
  if (!v) return '请输入邮箱';
  if (!EMAIL_REGEX.test(v)) return '邮箱格式不正确';
  return null;
}

/**
 * 校验登录标识符：v4.22.6 新增，支持邮箱或用户名登录。
 * 后端 /api/auth/login 已支持 email 或 username 字段（OR 查询），前端不再强制邮箱格式。
 *
 * 校验规则：
 *   - 非空
 *   - 若包含 @：按邮箱格式校验（兼容老用户习惯）
 *   - 若不含 @：按用户名校验（长度 2-32）
 */
export function validateLoginIdentifier(value: string): string | null {
  const v = value.trim();
  if (!v) return '请输入邮箱或用户名';
  if (v.includes('@')) {
    if (!EMAIL_REGEX.test(v)) return '邮箱格式不正确';
    return null;
  }
  if (v.length < 2 || v.length > 32) return '用户名需为 2-32 字符';
  return null;
}

/** 校验用户名：长度 2-32 */
export function validateUsername(value: string): string | null {
  const v = value.trim();
  if (!v) return '请输入用户名';
  if (v.length < 2 || v.length > 32) return '用户名需为 2-32 字符';
  return null;
}

/** 校验密码：v3.9.0-S3 增强为 8 位 + 字母数字组合 */
export function validatePassword(value: string): string | null {
  if (!value) return '请输入密码';
  if (value.length < 8) return '密码至少 8 位';
  if (!/[a-zA-Z]/.test(value)) return '密码必须包含字母';
  if (!/\d/.test(value)) return '密码必须包含数字';
  if (passwordStrength(value) < 1) return '密码强度不足，建议加入大小写字母与符号';
  return null;
}

/**
 * 密码强度档位：0 弱、1 中、2 强
 * v3.9.0-S3: 与后端 checkPasswordStrength 规则对齐——长度+字母+数字+评分综合判定
 */
export function passwordStrength(value: string): 0 | 1 | 2 {
  if (value.length < 8) return 0;
  // 综合判定：长度 ≥12 + 大小写 + 数字 + 符号 → 2；长度 ≥8 + 字母 + 数字 → 1；其余 → 0
  const hasLetter = /[a-zA-Z]/.test(value);
  const hasDigit = /\d/.test(value);
  if (!hasLetter || !hasDigit) return 0;
  const hasUpper = /[A-Z]/.test(value);
  const hasLower = /[a-z]/.test(value);
  const hasSymbol = /[^a-zA-Z0-9]/.test(value);
  if (value.length >= 12 && hasUpper && hasLower && hasSymbol) return 2;
  return 1;
}

/** 校验确认密码：与原密码一致 */
export function validateConfirmPassword(value: string, password: string): string | null {
  if (!value) return '请再次输入密码';
  if (value !== password) return '两次输入的密码不一致';
  return null;
}

/** 校验实例名称：非空 + 长度 1-64 */
export function validateInstanceName(value: string): string | null {
  const v = value.trim();
  if (!v) return '请填写实例名称';
  if (v.length > 64) return '实例名称最长 64 字符';
  return null;
}
