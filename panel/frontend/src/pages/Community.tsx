// ============================================================================
// Community — 社区页面（公开路由）
// GitHub · Discussions · Issues · 贡献指南
// ============================================================================

import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import '../docs-pages.css';
import { getBuildFooterText } from '../utils/buildFooterText';

export default function Community() {
  useDocumentTitle('社区 - GSP');

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
          <div className="docs-hero-tag">🌐 社区</div>
          <h1>开源社区</h1>
          <p>参与讨论、报告问题、贡献代码，一起让 GSP 更好</p>
        </div>
      </div>

      <div className="docs-content">
        <div className="community-grid">
          <a href="https://github.com/ecsrz/gameserver-panel" target="_blank" rel="noopener noreferrer" className="community-card">
            <div className="community-card-icon">📦</div>
            <h3>源码仓库</h3>
            <p>查看完整源码，Star 支持项目</p>
            <span className="community-link">github.com/ecsrz/gameserver-panel →</span>
          </a>

          <a href="https://github.com/ecsrz/gameserver-panel/issues" target="_blank" rel="noopener noreferrer" className="community-card">
            <div className="community-card-icon">🐛</div>
            <h3>Issues</h3>
            <p>报告 Bug、提出功能建议</p>
            <span className="community-link">提交 Issue →</span>
          </a>

          <a href="https://github.com/ecsrz/gameserver-panel/discussions" target="_blank" rel="noopener noreferrer" className="community-card">
            <div className="community-card-icon">💬</div>
            <h3>Discussions</h3>
            <p>社区讨论、经验分享、问答交流</p>
            <span className="community-link">参与讨论 →</span>
          </a>
        </div>

        <div className="docs-section">
          <h2>贡献指南</h2>
          <div className="contribute-steps">
            <div className="contribute-step">
              <div className="contribute-step-n">1</div>
              <div>
                <h4>Fork 仓库</h4>
                <p>在 GitHub 上 Fork 项目到你的账号</p>
              </div>
            </div>
            <div className="contribute-step">
              <div className="contribute-step-n">2</div>
              <div>
                <h4>创建分支</h4>
                <p>基于 <code>main</code> 创建功能分支：<code>git checkout -b feat/your-feature</code></p>
              </div>
            </div>
            <div className="contribute-step">
              <div className="contribute-step-n">3</div>
              <div>
                <h4>提交代码</h4>
                <p>遵循项目代码规范，编写清晰的 commit message</p>
              </div>
            </div>
            <div className="contribute-step">
              <div className="contribute-step-n">4</div>
              <div>
                <h4>发起 PR</h4>
                <p>向 <code>main</code> 分支发起 Pull Request，填写变更说明</p>
              </div>
            </div>
          </div>
        </div>

        <div className="docs-section">
          <h2>行为准则</h2>
          <ul className="docs-list">
            <li>尊重每一位参与者，营造友善包容的社区氛围</li>
            <li>报告 Bug 时提供复现步骤、环境信息和日志</li>
            <li>功能建议请先在 Discussions 中讨论，达成共识后再提交 Issue</li>
            <li>PR 需附带测试用例，确保不破坏现有功能</li>
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
