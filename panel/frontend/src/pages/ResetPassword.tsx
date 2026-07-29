// ============================================================================
// ResetPassword — v3.9.0-S4 密码找回（第二步：通过 token 重置密码）
//
// 路由：/reset-password?token=xxx
// 调用 POST /api/auth/password-reset/confirm
// 成功后引导用户重新登录（旧 JWT 因 token_version+1 全部失效）
// ============================================================================

import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createApiClient, PanelApiError } from '../api/client';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { LoadingButton, useToast } from '../components/ui';
import {
  clearFieldError,
  passwordStrength,
  validateConfirmPassword,
  validatePassword,
  type FieldErrors,
} from '../utils/formValidation';
import { isServerErrorCode } from '../utils/mapServerErrors';

type ResetField = 'password' | 'confirmPassword';

const STRENGTH_LABELS: Record<number, string> = { 0: '弱', 1: '中', 2: '强' };

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  useDocumentTitle('重置密码');
  const toast = useToast();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<ResetField>>({});

  // token 缺失：直接展示错误提示
  if (!token) {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1 className="login-title">链接无效</h1>
          <p className="login-subtitle">缺少重置 token</p>
          <div className="form-error" style={{ marginTop: 16 }}>
            重置链接不完整，请从邮件中点击完整的链接进入本页。
          </div>
          <LoadingButton
            type="button"
            variant="primary"
            size="block"
            loading={false}
            onClick={() => navigate('/forgot-password')}
            style={{ marginTop: 16 }}
          >
            重新申请重置链接
          </LoadingButton>
        </div>
      </div>
    );
  }

  const handleBlur = (field: ResetField, value: string) => {
    if (field === 'password') {
      setFieldErrors((prev) => ({ ...prev, password: validatePassword(value) }));
    } else if (field === 'confirmPassword') {
      setFieldErrors((prev) => ({
        ...prev,
        confirmPassword: validateConfirmPassword(value, password),
      }));
    }
  };

  const handleChange = (field: ResetField, value: string) => {
    if (field === 'password') {
      setPassword(value);
      if (confirmPassword) {
        const cpErr = validateConfirmPassword(confirmPassword, value);
        setFieldErrors((prev) => ({ ...prev, password: undefined, confirmPassword: cpErr }));
        return;
      }
    }
    if (field === 'confirmPassword') setConfirmPassword(value);
    if (fieldErrors[field]) {
      setFieldErrors((prev) => clearFieldError(prev, field));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const errors: FieldErrors<ResetField> = {
      password: validatePassword(password),
      confirmPassword: validateConfirmPassword(confirmPassword, password),
    };
    setFieldErrors(errors);
    if (errors.password || errors.confirmPassword) return;

    setSubmitting(true);
    try {
      const anonApi = createApiClient({ token: null });
      await anonApi.confirmPasswordReset(token, password);
      toast.success('密码已重置，请使用新密码登录');
      navigate('/login', { replace: true });
    } catch (err) {
      let msg: string;
      if (isServerErrorCode(err, 'PASSWORD_RESET_TOKEN_INVALID')) {
        msg = '重置链接无效或已被使用，请重新申请';
      } else if (isServerErrorCode(err, 'PASSWORD_RESET_TOKEN_EXPIRED')) {
        msg = '重置链接已过期，请重新申请';
      } else if (isServerErrorCode(err, 'WEAK_PASSWORD')) {
        msg = '密码强度不足，请加入大小写字母、数字与符号';
      } else if (err instanceof PanelApiError) {
        msg = err.message;
      } else {
        msg = err instanceof Error ? err.message : '重置失败';
      }
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const strength = passwordStrength(password);

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1 className="login-title">重置密码</h1>
        <p className="login-subtitle">设置新的登录密码</p>

        <label className="form-field">
          <span className="form-label">新密码 *</span>
          <input
            type="password"
            value={password}
            onChange={(e) => handleChange('password', e.target.value)}
            onBlur={(e) => handleBlur('password', e.target.value)}
            required
            autoComplete="new-password"
            placeholder="至少 8 位，需含字母与数字"
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password ? 'reset-password-error' : undefined}
          />
          {password && (
            <span className={`form-hint password-strength strength-${strength}`}>
              密码强度：{STRENGTH_LABELS[strength]}
            </span>
          )}
          {fieldErrors.password && (
            <span id="reset-password-error" className="form-field-error">
              {fieldErrors.password}
            </span>
          )}
        </label>

        <label className="form-field">
          <span className="form-label">确认新密码 *</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => handleChange('confirmPassword', e.target.value)}
            onBlur={(e) => handleBlur('confirmPassword', e.target.value)}
            required
            autoComplete="new-password"
            placeholder="再次输入新密码"
            aria-invalid={!!fieldErrors.confirmPassword}
            aria-describedby={
              fieldErrors.confirmPassword ? 'reset-confirmPassword-error' : undefined
            }
          />
          {fieldErrors.confirmPassword && (
            <span id="reset-confirmPassword-error" className="form-field-error">
              {fieldErrors.confirmPassword}
            </span>
          )}
        </label>

        <LoadingButton
          type="submit"
          variant="primary"
          size="block"
          loading={submitting}
          loadingText="重置中…"
        >
          重置密码
        </LoadingButton>

        <div className="login-hint" style={{ textAlign: 'center', marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate('/login')}
          >
            返回登录
          </button>
        </div>
      </form>
    </div>
  );
}
