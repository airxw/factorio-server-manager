// ============================================================================
// Terms — v3.9.0-S7 用户协议页（公开路由）
//
// 调用 GET /api/legal/terms 获取管理员配置的协议文本
// 未配置时展示默认占位提示
// ============================================================================

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createApiClient, PanelApiError } from '../api/client';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function Terms() {
  useDocumentTitle('用户协议');
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const anonApi = createApiClient({ token: null });
        const res = await anonApi.getLegalTerms();
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
        <h1 className="login-title">用户协议</h1>
        <p className="login-subtitle">请阅读以下服务条款</p>

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
                本站尚未配置用户协议。管理员可在「设置 → 法律」中配置协议内容。
                继续使用本服务即表示你同意接受本站的服务条款与隐私政策。
              </p>
            )}
          </div>
        )}

        <div className="login-hint" style={{ textAlign: 'center', marginTop: 24 }}>
          <Link to="/login" className="btn btn-ghost btn-sm">
            返回登录
          </Link>
          <Link to="/privacy" className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }}>
            查看隐私政策
          </Link>
        </div>
      </div>
    </div>
  );
}
