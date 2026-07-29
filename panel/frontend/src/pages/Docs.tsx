// ============================================================================
// Docs — 文档页面（公开路由）
// 快速开始与使用指南
// ============================================================================

import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import '../docs-pages.css';
import { getBuildFooterText } from '../utils/buildFooterText';

export default function Docs() {
  useDocumentTitle('文档 - GSP');

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
          <div className="docs-hero-tag">📖 文档</div>
          <h1>快速开始</h1>
          <p>从安装到运营，5 分钟搭建你的游戏服务器面板</p>
        </div>
      </div>

      <div className="docs-content">
        <div className="docs-grid">
          <div className="docs-card">
            <div className="docs-card-icon">🚀</div>
            <h3>快速安装</h3>
            <p>一键部署脚本，支持 Ubuntu/Debian/CentOS</p>
            <pre><code>curl -fsSL https://gsp.ecsrz.com/install.sh | bash</code></pre>
          </div>

          <div className="docs-card">
            <div className="docs-card-icon">⚙️</div>
            <h3>配置指南</h3>
            <p>数据库、SSL、域名、Daemon 节点配置详解</p>
            <Link to="/docs/config" className="docs-link">阅读配置文档 →</Link>
          </div>

          <div className="docs-card">
            <div className="docs-card-icon">🎮</div>
            <h3>游戏 Pack</h3>
            <p>9 款官方 Pack 安装与使用</p>
            <Link to="/docs/packs" className="docs-link">查看 Pack 列表 →</Link>
          </div>

          <div className="docs-card">
            <div className="docs-card-icon">💎</div>
            <h3>商城配置</h3>
            <p>VIP、商品、CDK、聊天触发器设置</p>
            <Link to="/docs/shop" className="docs-link">商城配置指南 →</Link>
          </div>

          <div className="docs-card">
            <div className="docs-card-icon">👥</div>
            <h3>玩家管理</h3>
            <p>玩家绑定、档案、好友、投票系统</p>
            <Link to="/docs/players" className="docs-link">玩家管理文档 →</Link>
          </div>

          <div className="docs-card">
            <div className="docs-card-icon">📊</div>
            <h3>数据看板</h3>
            <p>流水报表、在线趋势、运营分析</p>
            <Link to="/docs/reports" className="docs-link">数据看板指南 →</Link>
          </div>

          <div className="docs-card">
            <div className="docs-card-icon">🛰️</div>
            <h3>Daemon 节点</h3>
            <p>节点邀请、部署脚本、健康检查与排错顺序</p>
            <Link to="/docs/daemon" className="docs-link">查看节点文档 →</Link>
          </div>
        </div>

        <div className="docs-section">
          <h2>常见问题</h2>
          <div className="docs-faq">
            <details>
              <summary>如何更新到最新版本？</summary>
              <p>运行 <code>gsp update</code> 命令即可自动拉取最新版本并重启服务。</p>
            </details>
            <details>
              <summary>支持哪些数据库？</summary>
              <p>支持 SQLite（默认）、MySQL 8.0+、PostgreSQL 14+。生产环境建议使用 MySQL 或 PostgreSQL。</p>
            </details>
            <details>
              <summary>如何配置 SSL 证书？</summary>
              <p>在「设置 → SSL」中上传证书文件，或使用 Let's Encrypt 自动申请。详见 <Link to="/docs/config#ssl">SSL 配置文档</Link>。</p>
            </details>
            <details>
              <summary>Daemon 节点如何部署？</summary>
              <p>在「设置 → 节点」中生成部署链接，在目标服务器执行即可。详见 <Link to="/docs/daemon">Daemon 部署指南</Link>。</p>
            </details>
          </div>
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
