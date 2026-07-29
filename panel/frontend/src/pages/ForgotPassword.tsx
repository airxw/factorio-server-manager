// ============================================================================
// ForgotPassword — v3.9.0-S4 密码找回（第一步：输入邮箱请求重置链接）
//
// 调用 POST /api/auth/password-reset/request
// 防枚举：后端无论邮箱是否存在均返回 200，前端始终展示"已发送"提示
// 邮件发送由后端 mailService 完成，SMTP 未配置时邮件不发但 token 仍写入 DB
// ============================================================================

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createApiClient, PanelApiError } from '../api/client';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { LoadingButton, useToast } from '../components/ui';
import {
  clearFieldError,
  validateEmail,
  type FieldErrors,
} from '../utils/formValidation';

type ForgotField = 'email';

export default function ForgotPassword() {
  const navigate = useNavigate();
  useDocumentTitle('找回密码');
  const toast = useToast();

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<ForgotField>>({});

  const handleBlur = (field: ForgotField, value: string) => {
    if (field === 'email') {
      setFieldErrors((prev) => ({ ...prev, email: validateEmail(value) }));
    }
  };

  const handleChange = (field: ForgotField, value: string) => {
    if (field === 'email') setEmail(value);
    if (fieldErrors[field]) {
      setFieldErrors((prev) => clearFieldError(prev, field));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const emailErr = validateEmail(email);
    setFieldErrors({ email: emailErr });
    if (emailErr) return;

    setSubmitting(true);
    try {
      const anonApi = createApiClient({ token: null });
      await anonApi.requestPasswordReset(email.trim());
      setSubmitted(true);
      toast.success('重置链接已发送（若邮箱存在）');
    } catch (err) {
      // 防枚举：即使出错也展示"已发送"提示，避免泄露内部状态
      setSubmitted(true);
      const msg = err instanceof PanelApiError ? err.message : '请求失败';
      // 仅在明显是前端网络错误时提示，否则保持"已发送"
      if (err instanceof PanelApiError && err.code === 'NETWORK_ERROR') {
        toast.error(msg);
        setSubmitted(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1 className="login-title">查收邮件</h1>
          <p className="login-subtitle">重置链接已发送</p>
          <div className="form-hint" style={{ marginTop: 16, lineHeight: 1.6 }}>
            如果 <strong>{email}</strong> 已注册，你将收到一封包含重置链接的邮件。
            链接有效期为 1 小时，请尽快完成重置。
          </div>
          <div className="form-hint" style={{ marginTop: 12, color: 'var(--color-text-secondary)' }}>
            没收到邮件？请检查垃圾邮件箱，或稍后重试。
          </div>
          <LoadingButton
            type="button"
            variant="primary"
            size="block"
            loading={false}
            onClick={() => navigate('/login')}
            style={{ marginTop: 16 }}
          >
            返回登录
          </LoadingButton>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1 className="login-title">找回密码</h1>
        <p className="login-subtitle">输入注册邮箱，我们将发送重置链接</p>

        <label className="form-field">
          <span className="form-label">邮箱</span>
          <input
            type="email"
            value={email}
            onChange={(e) => handleChange('email', e.target.value)}
            onBlur={(e) => handleBlur('email', e.target.value)}
            required
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? 'forgot-email-error' : undefined}
          />
          {fieldErrors.email && (
            <span id="forgot-email-error" className="form-field-error">
              {fieldErrors.email}
            </span>
          )}
        </label>

        <LoadingButton
          type="submit"
          variant="primary"
          size="block"
          loading={submitting}
          loadingText="发送中…"
        >
          发送重置链接
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
