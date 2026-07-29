// ============================================================================
// Blog — 博客页面（公开路由）
// 技术文章与产品动态
// ============================================================================

import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import '../docs-pages.css';
import { getBuildFooterText } from '../utils/buildFooterText';

export default function Blog() {
  useDocumentTitle('博客 - GSP');

  const posts = [
    {
      date: '2026-07-26',
      tag: '产品动态',
      title: 'GSP v4.22.0 发布：Setup Wizard v3',
      desc: '全新引导向导，支持 Daemon 链接导入、移除默认管理员、Pack 多来源同步。',
    },
    {
      date: '2026-07-20',
      tag: '技术文章',
      title: '如何 5 分钟搭建 Minecraft 服务器',
      desc: '从零开始，使用 GSP 一键部署 Minecraft 服务器，配置 VIP 商城和聊天触发器。',
    },
    {
      date: '2026-07-15',
      tag: '产品动态',
      title: 'GSP v4.21.0：Demo 模式与自动演示',
      desc: '新增 Demo 模式，支持 5 个预设实例和自动循环演示，方便新用户快速了解产品。',
    },
    {
      date: '2026-07-10',
      tag: '技术文章',
      title: 'YAML 驱动的游戏 Pack 架构设计',
      desc: '深入解析 GSP 的 Pack 系统设计思路，如何用 YAML 描述游戏安装、启动和配置。',
    },
    {
      date: '2026-07-05',
      tag: '运营指南',
      title: '服主变现指南：从 0 到月入过万',
      desc: '分享成功服主的运营经验，包括 VIP 设计、商城定价、活动策划等实战技巧。',
    },
    {
      date: '2026-06-28',
      tag: '产品动态',
      title: 'GSP v4.20.0：三层架构与角色分离',
      desc: '系统管理员、服主、玩家三层操作逻辑，各司其职，权限清晰。',
    },
  ];

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
          <div className="docs-hero-tag">✍️ 博客</div>
          <h1>技术博客</h1>
          <p>产品动态、技术分享、运营经验</p>
        </div>
      </div>

      <div className="docs-content">
        <div className="blog-list">
          {posts.map((post, i) => (
            <article key={i} className="blog-card">
              <div className="blog-meta">
                <span className="blog-date">{post.date}</span>
                <span className="blog-tag">{post.tag}</span>
              </div>
              <h3>{post.title}</h3>
              <p>{post.desc}</p>
            </article>
          ))}
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
