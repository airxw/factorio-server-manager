// ============================================================================
// EmailVerify — v3.9.0-S5 邮箱验证（通过 token 完成验证）
//
// 路由：/verify-email?token=xxx  （公开，从邮件链接进入）
// 调用 POST /api/auth/email-verify/confirm
// 成功后提示并引导用户登录/继续
// ============================================================================

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createApiClient, PanelApiError } from '../api/client';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { LoadingButton, useToast } from '../components/ui';
import { isServerErrorCode } from '../utils/mapServerErrors';

type VerifyState = 'verifying' | 'success' | 'error';

export default function EmailVerify() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  useDocumentTitle('邮箱验证');
  const toast = useToast();

  const [state, setState] = useState<VerifyState>('verifying');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (!token) {
      setState('error');
      setErrorMsg('缺少验证 token，请从邮件中点击完整的链接进入本页。');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const anonApi = createApiClient({ token: null });
        await anonApi.confirmEmailVerify(token);
        if (cancelled) return;
        setState('success');
        toast.success('邮箱验证成功');
      } catch (err) {
        if (cancelled) return;
        let msg: string;
        if (isServerErrorCode(err, 'EMAIL_VERIFY_TOKEN_INVALID')) {
          msg = '验证链接无效或已被使用，请重新发送验证邮件。';
        } else if (isServerErrorCode(err, 'EMAIL_VERIFY_TOKEN_EXPIRED')) {
          msg = '验证链接已过期，请重新发送验证邮件。';
        } else if (err instanceof PanelApiError) {
          msg = err.message;
        } else {
          msg = err instanceof Error ? err.message : '验证失败';
        }
        setErrorMsg(msg);
        setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (state === 'verifying') {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1 className="login-title">邮箱验证</h1>
          <p className="login-subtitle">正在验证…</p>
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <div className="loading-spinner" style={{ margin: '0 auto' }} />
          </div>
        </div>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1 className="login-title">验证成功</h1>
          <p className="login-subtitle">你的邮箱已完成验证</p>
          <div className="form-hint" style={{ marginTop: 16, lineHeight: 1.6 }}>
            邮箱验证已完成，你现在可以使用完整功能。
          </div>
          <LoadingButton
            type="button"
            variant="primary"
            size="block"
            loading={false}
            onClick={() => navigate('/dashboard', { replace: true })}
            style={{ marginTop: 16 }}
          >
            进入控制台
          </LoadingButton>
        </div>
      </div>
    );
  }

  // error
  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">验证失败</h1>
        <p className="login-subtitle">无法完成邮箱验证</p>
        <div className="form-error" style={{ marginTop: 16 }}>
          {errorMsg}
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
