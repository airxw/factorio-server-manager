// ============================================================================
// Contact — 联系我们页面（公开路由）
// 商务合作与技术支持
// ============================================================================

import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import '../docs-pages.css';
import { getBuildFooterText } from '../utils/buildFooterText';

export default function Contact() {
  useDocumentTitle('联系我们 - GSP');

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
          <div className="docs-hero-tag">📮 联系我们</div>
          <h1>取得联系</h1>
          <p>商务合作、技术支持、问题反馈</p>
        </div>
      </div>

      <div className="docs-content">
        <div className="contact-grid">
          <div className="contact-card">
            <div className="contact-card-icon">🐛</div>
            <h3>Bug 反馈</h3>
            <p>遇到问题？在 GitHub Issues 中提交 Bug 报告</p>
            <a href="https://github.com/ecsrz/gameserver-panel/issues" target="_blank" rel="noopener noreferrer" className="docs-link">
              提交 Issue →
            </a>
          </div>

          <div className="contact-card">
            <div className="contact-card-icon">💬</div>
            <h3>社区讨论</h3>
            <p>在 Discussions 中提问、交流经验</p>
            <a href="https://github.com/ecsrz/gameserver-panel/discussions" target="_blank" rel="noopener noreferrer" className="docs-link">
              参与讨论 →
            </a>
          </div>

          <div className="contact-card">
            <div className="contact-card-icon">📧</div>
            <h3>商务合作</h3>
            <p>定制开发、企业授权、合作推广</p>
            <span className="contact-email">contact@gsp.ecsrz.com</span>
          </div>
        </div>

        <div className="docs-section">
          <h2>常见问题</h2>
          <p>在联系我们之前，你可能在 <Link to="/docs">文档</Link> 或 <Link to="/community">社区</Link> 中找到答案。</p>
          <ul className="docs-list">
            <li>安装部署问题 → 查看 <Link to="/docs">安装文档</Link></li>
            <li>功能使用问题 → 查看 <Link to="/docs">使用指南</Link></li>
            <li>Bug 报告 → 提交 <a href="https://github.com/ecsrz/gameserver-panel/issues" target="_blank" rel="noopener noreferrer">GitHub Issue</a></li>
            <li>功能建议 → 发起 <a href="https://github.com/ecsrz/gameserver-panel/discussions" target="_blank" rel="noopener noreferrer">Discussion</a></li>
          </ul>
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
