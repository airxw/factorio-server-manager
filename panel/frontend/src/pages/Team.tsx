// ============================================================================
// Team — 团队页面（公开路由）
// 幕后开发者与贡献者
// ============================================================================

import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import '../docs-pages.css';
import { getBuildFooterText } from '../utils/buildFooterText';

export default function Team() {
  useDocumentTitle('团队 - GSP');

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
          <div className="docs-hero-tag">👥 团队</div>
          <h1>幕后团队</h1>
          <p>一群热爱游戏、热爱开源的开发者</p>
        </div>
      </div>

      <div className="docs-content">
        <div className="team-grid">
          <div className="team-card">
            <div className="team-avatar">👨‍💻</div>
            <h3>核心开发</h3>
            <p>架构设计、后端开发、前端实现</p>
            <div className="team-role">全栈工程师</div>
          </div>
          <div className="team-card">
            <div className="team-avatar">🎨</div>
            <h3>UI/UX 设计</h3>
            <p>界面设计、交互优化、用户体验</p>
            <div className="team-role">设计师</div>
          </div>
          <div className="team-card">
            <div className="team-avatar">📦</div>
            <h3>Pack 维护</h3>
            <p>游戏 Pack 开发、版本适配、文档编写</p>
            <div className="team-role">Pack 开发者</div>
          </div>
          <div className="team-card">
            <div className="team-avatar">🧪</div>
            <h3>测试与质量</h3>
            <p>自动化测试、Bug 追踪、性能优化</p>
            <div className="team-role">QA 工程师</div>
          </div>
        </div>

        <div className="docs-section">
          <h2>开源贡献者</h2>
          <p>GSP 的成长离不开社区贡献者的支持。感谢每一位提交 PR、报告 Bug、参与讨论的伙伴。</p>
          <a href="https://github.com/ecsrz/gameserver-panel/graphs/contributors" target="_blank" rel="noopener noreferrer" className="docs-link">
            查看贡献者列表 →
          </a>
        </div>

        <div className="docs-section">
          <h2>加入我们</h2>
          <p>如果你对游戏服务器运营有热情，欢迎加入团队。我们欢迎以下方向的贡献：</p>
          <ul className="docs-list">
            <li>前端/后端功能开发</li>
            <li>游戏 Pack 开发与维护</li>
            <li>文档翻译与完善</li>
            <li>UI/UX 设计优化</li>
            <li>测试用例编写</li>
          </ul>
          <p>详见 <Link to="/community">贡献指南</Link>，或在 <a href="https://github.com/ecsrz/gameserver-panel/discussions" target="_blank" rel="noopener noreferrer">Discussions</a> 中联系我们。</p>
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
