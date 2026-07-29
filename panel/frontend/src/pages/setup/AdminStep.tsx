// ============================================================================
// AdminStep — v4.22.0 Setup Wizard v3 Step 5: 管理员账号配置
//
// v4.22.0 改造点（相对 v4.20.0）：
//   1. 移除 admin@local.dev/admin123 默认账号依赖——users 表已由 migration 清空，
//      本步骤提交后由后端 userService.createUser 创建首个管理员账号
//   2. email / username / display_name 全部必填（前端校验 + 后端二次校验）
//   3. 新增 display_name 字段（对应 users.display_name，登录后展示用）
//   4. 登录扩展为邮箱或用户名（后端 login 路由改造，与本组件无关）
//
// 受控组件：所有字段由父组件 SetupWizard 持有，本组件仅负责渲染 + 校验展示。
// ============================================================================

import { Check, XCircle } from 'lucide-react';
import type { PasswordPolicyResponse } from '@public/schema/panel-api-types';

export interface AdminStepProps {
  email: string;
  username: string;
  /** v4.22.0 新增：昵称（对应 users.display_name） */
  displayName: string;
  password: string;
  passwordConfirm: string;
  passwordPolicy: PasswordPolicyResponse | null;
  /** 提交错误（WEAK_PASSWORD details.failures 等） */
  submitError: string[] | null;
  onEmailChange: (v: string) => void;
  onUsernameChange: (v: string) => void;
  onDisplayNameChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onPasswordConfirmChange: (v: string) => void;
}

/**
 * 实时校验：返回各字段是否合法。
 * 供父组件判断 step5Valid（决定"下一步"按钮是否禁用）。
 */
export function validateAdminStep(args: {
  email: string;
  username: string;
  displayName: string;
  password: string;
  passwordConfirm: string;
  passwordPolicy: PasswordPolicyResponse | null;
}): {
  emailValid: boolean;
  usernameValid: boolean;
  displayNameValid: boolean;
  passwordLengthValid: boolean;
  passwordHasLetter: boolean;
  passwordHasDigit: boolean;
  passwordNotForbidden: boolean;
  passwordMatch: boolean;
  allValid: boolean;
} {
  const { email, username, displayName, password, passwordConfirm, passwordPolicy } = args;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const usernameValid = username.trim().length >= 2 && username.trim().length <= 32;
  const displayNameValid = displayName.trim().length >= 1 && displayName.trim().length <= 32;
  const passwordLengthValid =
    password.length >= (passwordPolicy?.min_length ?? 8) &&
    password.length <= (passwordPolicy?.max_length ?? 128);
  const passwordHasLetter = /[a-zA-Z]/.test(password);
  const passwordHasDigit = /[0-9]/.test(password);
  const passwordNotForbidden =
    !passwordPolicy?.forbidden_passwords.some((p) => p.toLowerCase() === password.toLowerCase());
  const passwordMatch = password === passwordConfirm;
  const allValid =
    emailValid &&
    usernameValid &&
    displayNameValid &&
    passwordLengthValid &&
    passwordHasLetter &&
    passwordHasDigit &&
    passwordNotForbidden &&
    passwordMatch &&
    password.length > 0;
  return {
    emailValid,
    usernameValid,
    displayNameValid,
    passwordLengthValid,
    passwordHasLetter,
    passwordHasDigit,
    passwordNotForbidden,
    passwordMatch,
    allValid,
  };
}

export default function AdminStep({
  email,
  username,
  displayName,
  password,
  passwordConfirm,
  passwordPolicy,
  submitError,
  onEmailChange,
  onUsernameChange,
  onDisplayNameChange,
  onPasswordChange,
  onPasswordConfirmChange,
}: AdminStepProps) {
  const v = validateAdminStep({
    email,
    username,
    displayName,
    password,
    passwordConfirm,
    passwordPolicy,
  });

  return (
    <div className="setup-form">
      <div className="setup-admin-hint">
        <p>
          配置首个管理员账号。v4.22.0 起移除 <code>admin@local.dev/admin123</code> 默认账号，
          请填写完整信息创建首个管理员。
        </p>
        <p className="form-field-hint">
          登录时可用<strong>邮箱</strong>或<strong>用户名</strong>任一组合密码。昵称将展示在控制台顶栏。
        </p>
      </div>

      {submitError && submitError.length > 0 && (
        <div className="setup-submit-errors">
          <div className="setup-submit-errors-title">
            <XCircle size={16} />
            密码校验失败：
          </div>
          <ul>
            {submitError.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="form-row">
        <label className="form-field">
          <span className="form-label">用户名 *</span>
          <input
            type="text"
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
            minLength={2}
            maxLength={32}
            required
            placeholder="2-32 字符，登录用"
            autoComplete="username"
            spellCheck={false}
            autoFocus
          />
          {username && !v.usernameValid && (
            <span className="form-field-error">用户名长度须为 2-32 字符</span>
          )}
        </label>

        <label className="form-field">
          <span className="form-label">邮箱 *</span>
          <input
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            maxLength={128}
            required
            placeholder="admin@example.com"
            autoComplete="email"
            spellCheck={false}
          />
          {email && !v.emailValid && <span className="form-field-error">邮箱格式无效</span>}
        </label>
      </div>

      <label className="form-field">
        <span className="form-label">昵称 *</span>
        <input
          type="text"
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          maxLength={32}
          required
          placeholder="控制台顶栏展示用，如：服务器管理员"
          spellCheck={false}
        />
        {displayName && !v.displayNameValid && (
          <span className="form-field-error">昵称长度须为 1-32 字符</span>
        )}
      </label>

      <label className="form-field">
        <span className="form-label">新密码 *</span>
        <input
          type="password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          minLength={passwordPolicy?.min_length ?? 8}
          maxLength={passwordPolicy?.max_length ?? 128}
          required
          autoComplete="new-password"
          placeholder="至少 8 位，含字母和数字"
        />
      </label>

      {password.length > 0 && passwordPolicy && (
        <div className="pwd-rules">
          <div className={`pwd-rule ${v.passwordLengthValid ? 'pwd-rule-ok' : 'pwd-rule-fail'}`}>
            {v.passwordLengthValid ? <Check size={14} /> : <XCircle size={14} />}
            长度 {passwordPolicy.min_length}-{passwordPolicy.max_length} 位
          </div>
          <div className={`pwd-rule ${v.passwordHasLetter ? 'pwd-rule-ok' : 'pwd-rule-fail'}`}>
            {v.passwordHasLetter ? <Check size={14} /> : <XCircle size={14} />}
            包含字母
          </div>
          <div className={`pwd-rule ${v.passwordHasDigit ? 'pwd-rule-ok' : 'pwd-rule-fail'}`}>
            {v.passwordHasDigit ? <Check size={14} /> : <XCircle size={14} />}
            包含数字
          </div>
          <div className={`pwd-rule ${v.passwordNotForbidden ? 'pwd-rule-ok' : 'pwd-rule-fail'}`}>
            {v.passwordNotForbidden ? <Check size={14} /> : <XCircle size={14} />}
            非常见弱密码（如 admin123、12345678）
          </div>
        </div>
      )}

      <label className="form-field">
        <span className="form-label">确认密码 *</span>
        <input
          type="password"
          value={passwordConfirm}
          onChange={(e) => onPasswordConfirmChange(e.target.value)}
          minLength={8}
          maxLength={128}
          required
          autoComplete="new-password"
          placeholder="再次输入新密码"
        />
        {passwordConfirm.length > 0 && password !== passwordConfirm && (
          <span className="form-field-error">两次输入的密码不一致</span>
        )}
      </label>
    </div>
  );
}
