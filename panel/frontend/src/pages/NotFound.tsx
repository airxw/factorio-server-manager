// ============================================================================
// NotFound — 404 页面
// ============================================================================

import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function NotFound() {
  useDocumentTitle('页面未找到');
  return (
    <div className="page not-found-page">
      <h1 className="page-title not-found-title">404</h1>
      <p className="form-hint not-found-hint">抱歉，您访问的页面不存在</p>
      <Link to="/dashboard" className="btn btn-primary">
        返回控制台
      </Link>
    </div>
  );
}
