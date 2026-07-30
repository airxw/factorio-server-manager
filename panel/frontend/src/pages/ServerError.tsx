// ============================================================================
// ServerError — 500 服务器错误页面 (v3.9.0-S9)
// 当后端 API 返回 500 + PANEL_INTERNAL_ERROR 时，前端可显式跳转到本页面
// 当前实现：作为公开路由，用户可通过 /500 直接访问
// v4.36.1: 返回入口改为 / （/dashboard 已废弃，会重定向到 /admin 导致非管理员 403）
// ============================================================================

import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function ServerError() {
  useDocumentTitle('服务器错误');
  return (
    <div className="page" style={{ textAlign: 'center', paddingTop: 64 }}>
      <h1 className="page-title" style={{ fontSize: 48, marginBottom: 8 }}>
        500
      </h1>
      <p className="form-hint" style={{ fontSize: 16, marginBottom: 24 }}>
        服务器内部错误，请稍后重试或联系管理员
      </p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => window.location.reload()}
        >
          刷新页面
        </button>
        <Link to="/" className="btn btn-primary">
          返回首页
        </Link>
      </div>
    </div>
  );
}
