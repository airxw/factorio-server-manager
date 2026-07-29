// ============================================================================
// Register — 注册页
// 邮箱 + 用户名 + 密码 + 确认密码表单，调用 useAuth.register，
// 成功后自动登录（保存 token + user state）并跳转到 /instances
// 五.7: 字段级实时校验（onBlur 触发，onChange 清错）+ 密码强度提示
// ============================================================================

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../api/auth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { PanelApiError } from '../api/client';
import { LoadingButton } from '../components/ui';
import {
  clearFieldError,
  passwordStrength,
  validateConfirmPassword,
  validateEmail,
  validatePassword,
  validateUsername,
  type FieldErrors,
} from '../utils/formValidation';

type RegisterField = 'email' | 'username' | 'password' | 'confirmPassword';

const STRENGTH_LABELS: Record<number, string> = { 0: '弱', 1: '中', 2: '强' };

export default function Register() {
  const { register, user } = useAuth();
  const navigate = useNavigate();
  useDocumentTitle('注册');

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<RegisterField>>({});
  // 3.15: 注册频率限制——失败后冷却，防止暴力注册
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const failedAttemptsRef = useRef(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 3.15: 冷却倒计时
  useEffect(() => {
    if (cooldownRemaining <= 0) {
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
      return;
    }
    if (!cooldownTimerRef.current) {
      cooldownTimerRef.current = setInterval(() => {
        setCooldownRemaining((prev) => Math.max(0, prev - 1));
      }, 1000);
    }
    return () => {
      if (cooldownTimerRef.current && cooldownRemaining <= 0) {
        clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
    };
  }, [cooldownRemaining]);

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, []);

  // 已登录用户访问 /register 直接跳走
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  const validateField = (field: RegisterField, value: string): string | null => {
    if (field === 'email') return validateEmail(value);
    if (field === 'username') return validateUsername(value);
    if (field === 'password') return validatePassword(value);
    if (field === 'confirmPassword') return validateConfirmPassword(value, password);
    return null;
  };

  const handleBlur = (field: RegisterField, value: string) => {
    // 确认密码校验依赖 password 当前值，需重新计算
    const msg = validateField(field, value);
    setFieldErrors((prev) => ({ ...prev, [field]: msg }));
  };

  const handleChange = (field: RegisterField, value: string) => {
    if (field === 'email') setEmail(value);
    if (field === 'username') setUsername(value);
    if (field === 'password') {
      setPassword(value);
      // 密码变化时，若确认密码已填，联动重校验
      if (confirmPassword) {
        const cpErr = validateConfirmPassword(confirmPassword, value);
        setFieldErrors((prev) => ({ ...prev, password: undefined, confirmPassword: cpErr }));
        return;
      }
    }
    if (field === 'confirmPassword') setConfirmPassword(value);
    // onChange 仅清错，不重新触发校验
    if (fieldErrors[field]) {
      setFieldErrors((prev) => clearFieldError(prev, field));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || cooldownRemaining > 0) return;

    // 提交前全量校验
    const errors: FieldErrors<RegisterField> = {
      email: validateEmail(email),
      username: validateUsername(username),
      password: validatePassword(password),
      confirmPassword: validateConfirmPassword(confirmPassword, password),
    };
    setFieldErrors(errors);
    if (errors.email || errors.username || errors.password || errors.confirmPassword) return;

    setError(null);
    setSubmitting(true);
    try {
      await register(email.trim(), username.trim(), password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      // 3.15: 失败后递增冷却——第1次5s，第2次15s，第3次+30s
      failedAttemptsRef.current += 1;
      const cooldown = Math.min(5 * failedAttemptsRef.current * failedAttemptsRef.current, 60);
      setCooldownRemaining(cooldown);
      if (err instanceof PanelApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : '注册失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const strength = passwordStrength(password);

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1 className="login-title">注册账号</h1>
        <p className="login-subtitle">创建你的 GameServer Panel 账号</p>

        <label className="form-field">
          <span className="form-label">邮箱 *</span>
          <input
            type="email"
            value={email}
            onChange={(e) => handleChange('email', e.target.value)}
            onBlur={(e) => handleBlur('email', e.target.value)}
            required
            autoComplete="email"
            placeholder="your@email.com"
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? 'register-email-error' : undefined}
          />
          {fieldErrors.email && (
            <span id="register-email-error" className="form-field-error">
              {fieldErrors.email}
            </span>
          )}
        </label>

        <label className="form-field">
          <span className="form-label">用户名 *</span>
          <input
            type="text"
            value={username}
            onChange={(e) => handleChange('username', e.target.value)}
            onBlur={(e) => handleBlur('username', e.target.value)}
            required
            autoComplete="username"
            placeholder="2-32 字符"
            aria-invalid={!!fieldErrors.username}
            aria-describedby={fieldErrors.username ? 'register-username-error' : undefined}
          />
          {fieldErrors.username && (
            <span id="register-username-error" className="form-field-error">
              {fieldErrors.username}
            </span>
          )}
        </label>

        <label className="form-field">
          <span className="form-label">密码 *</span>
          <input
            type="password"
            value={password}
            onChange={(e) => handleChange('password', e.target.value)}
            onBlur={(e) => handleBlur('password', e.target.value)}
            required
            autoComplete="new-password"
            placeholder="至少 8 位，需含字母与数字"
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password ? 'register-password-error' : undefined}
          />
          {password && (
            <span className={`form-hint password-strength strength-${strength}`}>
              密码强度：{STRENGTH_LABELS[strength]}
            </span>
          )}
          {fieldErrors.password && (
            <span id="register-password-error" className="form-field-error">
              {fieldErrors.password}
            </span>
          )}
        </label>

        <label className="form-field">
          <span className="form-label">确认密码 *</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => handleChange('confirmPassword', e.target.value)}
            onBlur={(e) => handleBlur('confirmPassword', e.target.value)}
            required
            autoComplete="new-password"
            placeholder="再次输入密码"
            aria-invalid={!!fieldErrors.confirmPassword}
            aria-describedby={
              fieldErrors.confirmPassword ? 'register-confirmPassword-error' : undefined
            }
          />
          {fieldErrors.confirmPassword && (
            <span id="register-confirmPassword-error" className="form-field-error">
              {fieldErrors.confirmPassword}
            </span>
          )}
        </label>

        {error && <div className="form-error">{error}</div>}

        {/* 3.15: 冷却提示 */}
        {cooldownRemaining > 0 && (
          <div className="form-hint" style={{ color: 'var(--color-warning)' }}>
            请等待 {cooldownRemaining} 秒后重试
          </div>
        )}

        <LoadingButton
          type="submit"
          variant="primary"
          size="block"
          loading={submitting}
          disabled={cooldownRemaining > 0}
          loadingText={cooldownRemaining > 0 ? `请等待 ${cooldownRemaining}s` : '注册中…'}
        >
          {cooldownRemaining > 0 ? `等待 ${cooldownRemaining}s` : '注册'}
        </LoadingButton>

        <div className="login-hint" style={{ textAlign: 'center', marginTop: 12 }}>
          <span>已有账号？</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/login')}>
            立即登录
          </button>
        </div>

        {/* v3.9.0-S7: 法律内容入口 */}
        <div className="login-hint" style={{ textAlign: 'center', marginTop: 8, fontSize: 12 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/terms')}>
            用户协议
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/privacy')}>
            隐私政策
          </button>
        </div>
      </form>
    </div>
  );
}
