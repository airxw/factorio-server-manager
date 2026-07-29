// ============================================================================
// Login — 登录页（v4.16.x 身份体系重构）
// 纯认证入口：邮箱或用户名 + 密码，不做身份选择
// v4.22.6: 支持邮箱或用户名登录（后端 /api/auth/login 已支持 email 或 username OR 查询）
// 登录成功后根据用户身份数量决定跳转：
// - 系统管理员 → 直接进入 /admin
// - 无身份 → /select-identity（身份选择页）
// - 单身份 → 直接跳转到对应工作台（腐竹→/store，玩家→/guild）
// - 多身份 → /select-identity（让用户选择本次进入哪个身份）
// 演示账号可折叠，默认收起；系统管理员不在演示账号中展示
// BUILD: 20260725-013
// ============================================================================

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { useAuth } from '../api/auth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { createApiClient, PanelApiError } from '../api/client';
import { LoadingButton, useToast } from '../components/ui';
import {
  clearFieldError,
  validateLoginIdentifier,
  validatePassword,
  type FieldErrors,
} from '../utils/formValidation';
import { isServerErrorCode } from '../utils/mapServerErrors';
import { getEffectiveRole } from '../utils/role';
import type { UserInfo } from '@public/schema/panel-api-types';
// v4.31.0: 登录成功后弹窗（上次登录信息）
import LoginLastLoginModal from '../components/LoginLastLoginModal';
import { getLastLogin } from '../api/modules/security';
import type { LastLoginInfo } from '@public/schema/panel-api-types';
import { getBuildFooterText } from '../utils/buildFooterText';

interface LocationState {
  from?: string;
}

type LoginField = 'email' | 'password';

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const toast = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<LoginField>>({});
  const [initChecking, setInitChecking] = useState(true);
  // v4.31.0: 登录后弹窗状态——lastLoginModalData 非 null 时展示上次登录信息
  //   pendingTarget: 弹窗关闭后要跳转的目标路径
  const [lastLoginModalData, setLastLoginModalData] = useState<LastLoginInfo | null>(null);
  const [lastLoginModalOpen, setLastLoginModalOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const [demoExpanded, setDemoExpanded] = useState(false);

  // from 参数优先级：URL searchParams > location.state > 默认 /
  const fromPath = useMemo(() => {
    const urlFrom = searchParams.get('from');
    const stateFrom = (location.state as LocationState | null)?.from;
    return urlFrom || stateFrom || '/';
  }, [searchParams, location.state]);

  useDocumentTitle('登录');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const anonApi = createApiClient({ token: null });
        const res = await anonApi.getInitStatus();
        if (cancelled) return;
        // demo 模式下 needs_init 恒为 false（后端短路），不会跳转 /setup
        if (res.needs_init) {
          navigate('/setup', { replace: true });
        }
      } catch {
      } finally {
        if (!cancelled) setInitChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // 已登录用户访问 /login 直接跳走
  if (user) {
    return <Navigate to="/" replace />;
  }

  if (initChecking) {
    return (
      <div className="login-page">
        <div className="login-card">
          <p style={{ textAlign: 'center' }}>加载中…</p>
        </div>
      </div>
    );
  }

  const validateField = (field: LoginField, value: string): string | null => {
    if (field === 'email') return validateLoginIdentifier(value);
    if (field === 'password') return validatePassword(value);
    return null;
  };

  const handleBlur = (field: LoginField, value: string) => {
    const msg = validateField(field, value);
    setFieldErrors((prev) => ({ ...prev, [field]: msg }));
  };

  const handleChange = (field: LoginField, value: string) => {
    if (field === 'email') setEmail(value);
    if (field === 'password') setPassword(value);
    if (fieldErrors[field]) {
      setFieldErrors((prev) => clearFieldError(prev, field));
    }
  };

  /**
   * 登录成功后的跳转逻辑（智能直达 + from 深链，方案 §5.3 L1/L2）：
   *   - server_admin/system_admin/admin → 直跳 /admin
   *   - 单身份 → activateIdentity 后跳 from 深链（若匹配基座）或角色默认基座
   *   - 多身份/无身份 → /select-identity 携带 from，由选择页选完后落地
   * 预检失败时降级到 /select-identity（不阻断登录）。
   */
  const getLoginRedirectPath = async (loggedInUser: UserInfo): Promise<string> => {
    const effectiveRole = getEffectiveRole(loggedInUser);
    if (effectiveRole === 'server_admin' || effectiveRole === 'system_admin' || effectiveRole === 'admin') {
      return '/admin';
    }
    try {
      const api = createApiClient({});
      const res = await api.listIdentities();
      const identities = res.identities || [];
      if (identities.length === 1) {
        const identity = identities[0];
        await api.activateIdentity(identity.id);
        const targetBase = identity.identity_type === 'instance_admin' ? '/store' : '/guild';
        if (fromPath && fromPath !== '/' && fromPath.startsWith(targetBase)) {
          return fromPath;
        }
        return targetBase;
      }
    } catch {
      // 预检失败降级到选择页
    }
    if (fromPath && fromPath !== '/') {
      return `/select-identity?from=${encodeURIComponent(fromPath)}`;
    }
    return '/select-identity';
  };

  const doLogin = async (loginEmail: string, loginPassword: string) => {
    if (submitting) return;
    const errors: FieldErrors<LoginField> = {
      email: validateLoginIdentifier(loginEmail),
      password: validatePassword(loginPassword),
    };
    setFieldErrors(errors);
    if (errors.email || errors.password) return;

    setError(null);
    setSubmitting(true);
    try {
      const result = await login(loginEmail.trim(), loginPassword);
      if (result?.passwordExpired) {
        toast.warning('您的管理员密码已超过有效期，请尽快前往「个人设置」修改密码');
      }
      const target = await getLoginRedirectPath(result.user);

      // v4.31.0: 登录成功后拉取上次登录信息，有历史则弹窗提醒
      try {
        // login() 已将 token 写入 localStorage，但本组件 token state 尚未刷新
        // 直接用刚拿到的 res.token 调用（ getLastLogin 接受 token 参数）
        const tempToken = (() => {
          try {
            return localStorage.getItem('panel_token');
          } catch {
            return null;
          }
        })();
        const lastLogin = await getLastLogin(tempToken);
        if (lastLogin) {
          setLastLoginModalData(lastLogin);
          setPendingTarget(target);
          setLastLoginModalOpen(true);
          return; // 等待用户关闭弹窗后再跳转
        }
      } catch {
        // 拉取上次登录失败不阻断登录跳转
      }

      navigate(target, { replace: true });
    } catch (err) {
      let msg: string;
      if (isServerErrorCode(err, 'INVALID_CREDENTIALS')) {
        msg = '邮箱/用户名或密码不正确';
      } else if (err instanceof PanelApiError) {
        msg = err.message;
      } else {
        msg = err instanceof Error ? err.message : '登录失败';
      }
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // v4.31.0: 弹窗关闭后跳转到 pendingTarget
  const handleLastLoginModalClose = () => {
    setLastLoginModalOpen(false);
    setLastLoginModalData(null);
    if (pendingTarget) {
      navigate(pendingTarget, { replace: true });
      setPendingTarget(null);
    }
  };

  // v4.31.0: 弹窗"立即修改密码"按钮 → 跳转个人设置页
  const handleLastLoginModalChangePassword = () => {
    setLastLoginModalOpen(false);
    setLastLoginModalData(null);
    setPendingTarget(null);
    // 根据用户身份选择跳转基座：admin → /admin/profile，其他 → /guild/profile
    navigate('/guild/profile', { replace: true });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await doLogin(email, password);
  };

  // 演示账号入口：仅开发环境显示（生产关闭，方案 §3.1 决策）
  // Demo 模式的体验入口由 /demo 页承载，不依赖 Login 页演示账号折叠区
  const showDemoEntry = import.meta.env.DEV;

  // 演示账号：移除系统管理员，仅保留腐竹和玩家
  const DEMO_ACCOUNTS = [
    {
      role: 'instance_admin',
      roleLabel: '腐竹',
      roleDesc: '管理自己的游戏服务器',
      email: 'manager@local.dev',
      password: 'admin123',
    },
    {
      role: 'user',
      roleLabel: '玩家',
      roleDesc: '加入别人的游戏服务器',
      email: 'user@local.dev',
      password: 'admin123',
    },
  ] as const;

  const useDemoLogin = (account: (typeof DEMO_ACCOUNTS)[number]) => {
    setEmail(account.email);
    setPassword(account.password);
    setFieldErrors({});
    void doLogin(account.email, account.password);
  };

  return (
    <div className="login-page">
      {/* 返回按钮 */}
      <button
        type="button"
        onClick={() => navigate('/')}
        className="login-back-btn"
      >
        <ArrowLeft size={16} />
        <span>返回</span>
      </button>

      <form className="login-card" onSubmit={handleSubmit}>
        <h1 className="login-title">登录 GameServer Panel</h1>
        <p className="login-subtitle">登录后选择您的身份，开始使用</p>

        <label className="form-field">
          <span className="form-label">邮箱或用户名</span>
          <input
            type="text"
            value={email}
            onChange={(e) => handleChange('email', e.target.value)}
            onBlur={(e) => handleBlur('email', e.target.value)}
            required
            autoComplete="username"
            placeholder="邮箱或用户名（如 admin@local.dev 或 airxw）"
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
          />
          {fieldErrors.email && (
            <span id="login-email-error" className="form-field-error">
              {fieldErrors.email}
            </span>
          )}
        </label>

        <label className="form-field">
          <span className="form-label">密码</span>
          <input
            type="password"
            value={password}
            onChange={(e) => handleChange('password', e.target.value)}
            onBlur={(e) => handleBlur('password', e.target.value)}
            required
            autoComplete="current-password"
            placeholder="••••••••"
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
          />
          {fieldErrors.password && (
            <span id="login-password-error" className="form-field-error">
              {fieldErrors.password}
            </span>
          )}
        </label>

        <div className="login-hint" style={{ textAlign: 'right', marginTop: -4, border: 'none', paddingTop: 0 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate('/forgot-password')}
          >
            忘记密码？
          </button>
        </div>

        {error && <div className="form-error">{error}</div>}

        <LoadingButton
          type="submit"
          variant="primary"
          size="block"
          loading={submitting}
          loadingText="登录中…"
        >
          登录
        </LoadingButton>

        <div className="login-hint" style={{ marginTop: 12 }}>
          <span>还没有账号？</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate('/register', { state: { from: fromPath } })}
          >
            立即注册
          </button>
        </div>

        <div className="login-hint" style={{ marginTop: 8, fontSize: 12 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate('/terms')}
          >
            用户协议
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate('/privacy')}
          >
            隐私政策
          </button>
        </div>

        {/* 演示账号 — 可折叠，默认收起；系统管理员不展示 */}
        {showDemoEntry && (
          <div className="login-demo">
            <button
              type="button"
              className="login-demo-toggle"
              onClick={() => setDemoExpanded((v) => !v)}
              aria-expanded={demoExpanded}
            >
              <span>或使用演示账号</span>
              <ChevronDown
                size={14}
                style={{
                  transition: 'transform 0.2s ease',
                  transform: demoExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
              />
            </button>
            {demoExpanded && (
                <div className="login-demo-list" role="group" aria-label="演示账号一键登录">
                  {DEMO_ACCOUNTS.map((account) => {
                    const buttonClassName = `login-demo-btn login-demo-btn-${account.role}`;
                    const buttonAriaLabel = `${account.roleLabel}一键登录`;

                    return (
                      <button
                        key={account.role}
                        type="button"
                        className={buttonClassName}
                        onClick={() => useDemoLogin(account)}
                        disabled={submitting}
                        aria-label={buttonAriaLabel}
                      >
                        <span className="login-demo-label">{account.roleLabel}</span>
                        <span className="login-demo-desc">{account.roleDesc}</span>
                        <span className="login-demo-creds">
                          {account.email} / {account.password}
                        </span>
                      </button>
                    );
                  })}
                </div>
            )}
          </div>
        )}
      </form>

      {/* BUILD ID — 底部规范化 footer span（部署核对用） */}
      <footer className="app-footer-build">
          {getBuildFooterText()}
      </footer>

      {/* v4.31.0: 登录成功后弹窗——上次登录信息提醒（仅在已有历史登录时弹出） */}
      <LoginLastLoginModal
        open={lastLoginModalOpen}
        lastLogin={lastLoginModalData}
        onClose={handleLastLoginModalClose}
        onChangePassword={handleLastLoginModalChangePassword}
      />
    </div>
  );
}
