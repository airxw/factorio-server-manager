// ============================================================================
// ApiReference — API 参考页面（公开路由）
// REST 接口与 WebSocket 事件文档
// ============================================================================

import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import '../docs-pages.css';
import { getBuildFooterText } from '../utils/buildFooterText';

export default function ApiReference() {
  useDocumentTitle('API 参考 - GSP');

  return (
    <div className="docs-page">
      <nav className="docs-nav">
        <div className="docs-nav-inner">
          <Link to="/" className="docs-logo">
            <span className="docs-logo-ic">🎮</span>
            <span>GSP</span>
          </Link>
          <div className="docs-nav-links">
            <Link to="/docs">文档</Link>
            <Link to="/api-reference">API</Link>
            <Link to="/pack-dev">Pack 开发</Link>
            <Link to="/community">社区</Link>
          </div>
          <Link to="/login" className="docs-nav-cta">登录 →</Link>
        </div>
      </nav>

      <div className="docs-hero">
        <div className="docs-hero-inner">
          <div className="docs-hero-tag">🔌 API 参考</div>
          <h1>REST API</h1>
          <p>完整的 API 接口文档，支持自动化集成与二次开发</p>
        </div>
      </div>

      <div className="docs-content">
        <div className="api-section">
          <h2>认证方式</h2>
          <p>所有 API 请求需要在 Header 中携带 JWT Token：</p>
          <pre><code>Authorization: Bearer &lt;your_token&gt;</code></pre>
          <p>通过 <code>POST /api/auth/login</code> 获取 Token。</p>
        </div>

        <div className="api-section">
          <h2>实例管理</h2>
          <div className="api-endpoint">
            <div className="api-method get">GET</div>
            <div className="api-path">/api/instances</div>
            <div className="api-desc">获取所有实例列表</div>
          </div>
          <div className="api-endpoint">
            <div className="api-method post">POST</div>
            <div className="api-path">/api/instances</div>
            <div className="api-desc">创建新实例</div>
          </div>
          <div className="api-endpoint">
            <div className="api-method get">GET</div>
            <div className="api-path">/api/instances/:id</div>
            <div className="api-desc">获取实例详情</div>
          </div>
          <div className="api-endpoint">
            <div className="api-method put">PUT</div>
            <div className="api-path">/api/instances/:id</div>
            <div className="api-desc">更新实例配置</div>
          </div>
          <div className="api-endpoint">
            <div className="api-method delete">DELETE</div>
            <div className="api-path">/api/instances/:id</div>
            <div className="api-desc">删除实例</div>
          </div>
        </div>

        <div className="api-section">
          <h2>WebSocket 事件</h2>
          <p>连接地址：<code>wss://your-domain/ws</code></p>
          <div className="api-event">
            <div className="api-event-name">instance:status</div>
            <div className="api-event-desc">实例状态变更（启动/停止/重启）</div>
          </div>
          <div className="api-event">
            <div className="api-event-name">instance:console</div>
            <div className="api-event-desc">实例控制台输出流</div>
          </div>
          <div className="api-event">
            <div className="api-event-name">player:join</div>
            <div className="api-event-desc">玩家加入服务器事件</div>
          </div>
          <div className="api-event">
            <div className="api-event-name">player:leave</div>
            <div className="api-event-desc">玩家离开服务器事件</div>
          </div>
        </div>

        <div className="api-section">
          <h2>响应格式</h2>
          <pre><code>{`{
  "success": true,
  "data": { ... },
  "message": "操作成功"
}`}</code></pre>
        </div>
      </div>

      <footer className="docs-footer">
        <div className="docs-footer-inner">
            <span>{getBuildFooterText()}</span>
          <span>AGPL-3.0 开源</span>
        </div>
      </footer>
    </div>
  );
}
