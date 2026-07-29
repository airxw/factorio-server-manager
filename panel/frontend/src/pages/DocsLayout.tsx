import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getBuildFooterText } from '../utils/buildFooterText';

interface DocsLayoutLink {
  to: string;
  title: string;
  description: string;
  cta?: string;
  icon?: string;
}

interface DocsLayoutProps {
  tag: string;
  title: string;
  description: string;
  children: ReactNode;
  links?: DocsLayoutLink[];
}

export default function DocsLayout({
  tag,
  title,
  description,
  children,
  links = [],
}: DocsLayoutProps) {
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
          <Link to="/login" className="docs-nav-cta">
            登录 →
          </Link>
        </div>
      </nav>

      <div className="docs-hero">
        <div className="docs-hero-inner">
          <div className="docs-hero-tag">{tag}</div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>

      <div className="docs-content">
        {links.length > 0 && (
          <div className="docs-grid">
            {links.map((link) => (
              <div className="docs-card" key={link.to}>
                {link.icon ? <div className="docs-card-icon">{link.icon}</div> : null}
                <h3>{link.title}</h3>
                <p>{link.description}</p>
                <Link to={link.to} className="docs-link">
                  {link.cta ?? '继续阅读 →'}
                </Link>
              </div>
            ))}
          </div>
        )}

        {children}
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
