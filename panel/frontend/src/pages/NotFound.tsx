// ============================================================================
// NotFound — 404 页面
// v4.36.1: 返回入口改为 / （/dashboard 已废弃，会重定向到 /admin 导致非管理员 403）
// ============================================================================

import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function NotFound() {
  useDocumentTitle('页面未找到');
  return (
    <div className="page not-found-page">
      <h1 className="page-title not-found-title">404</h1>
      <p className="form-hint not-found-hint">抱歉，您访问的页面不存在</p>
      <Link to="/" className="btn btn-primary">
        返回首页
      </Link>
    </div>
  );
}
