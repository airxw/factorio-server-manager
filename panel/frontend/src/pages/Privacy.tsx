// ============================================================================
// Privacy — v3.9.0-S7 隐私政策页（公开路由）
//
// 调用 GET /api/legal/privacy 获取管理员配置的隐私政策文本
// 未配置时展示默认占位提示
// ============================================================================

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createApiClient, PanelApiError } from '../api/client';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function Privacy() {
  useDocumentTitle('隐私政策');
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const anonApi = createApiClient({ token: null });
        const res = await anonApi.getLegalPrivacy();
        if (!cancelled) {
          setContent(res.content ?? '');
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof PanelApiError ? err.message : '加载失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: 720, textAlign: 'left' }}>
        <h1 className="login-title">隐私政策</h1>
        <p className="login-subtitle">了解我们如何收集与使用你的数据</p>

        {loading && <p style={{ textAlign: 'center', marginTop: 16 }}>加载中…</p>}

        {error && <div className="form-error" style={{ marginTop: 16 }}>{error}</div>}

        {!loading && !error && (
          <div style={{ marginTop: 16 }}>
            {content.trim() ? (
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  lineHeight: 1.7,
                  margin: 0,
                }}
              >
                {content}
              </pre>
            ) : (
              <p className="form-hint" style={{ lineHeight: 1.7 }}>
                本站尚未配置隐私政策。管理员可在「设置 → 法律」中配置政策内容。
                本服务仅收集为提供游戏服务器管理所必需的最少数据（邮箱、用户名、登录凭据、操作日志），
                不会向第三方出售或共享你的个人信息。
              </p>
            )}
          </div>
        )}

        <div className="login-hint" style={{ textAlign: 'center', marginTop: 24 }}>
          <Link to="/login" className="btn btn-ghost btn-sm">
            返回登录
          </Link>
          <Link to="/terms" className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }}>
            查看用户协议
          </Link>
        </div>
      </div>
    </div>
  );
}
