// ============================================================================
// Help — v4.1 帮助中心页面（公开路由）
//
// 浅色主题帮助中心：
// - 顶部导航栏（Logo + 返回首页 / 登录）
// - Hero 区（大标题 + 副标题 + 搜索框）
// - 主体：左侧固定侧边目录 + 右侧内容区（5 个 section）
//   - 快速上手 / 常见问题 / 快捷键 / 版本日志 / 反馈建议
// - 版本日志区调用 GET /api/version/changelog 获取最近 10 条
// - 底部：版权信息 + 返回首页
//
// 样式：使用 styles.css 现有类（.page, .card, .btn 等）+ 页面专用 help-* 前缀样式
// （通过 <style> 标签注入，避免新建独立 CSS 文件）
// ============================================================================

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  ExternalLink,
  Keyboard,
  MessageSquare,
  Rocket,
  Search,
  Server,
  Settings,
  Users,
} from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import {
  FAQ_ITEMS,
  PROJECT_INTRO_SECTIONS,
  QUICK_START_SECTIONS,
  SHORTCUTS,
} from '../content/help-content';

// ============================================================================
// 类型定义
// ============================================================================

interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  body: string;
}

interface NavItem {
  id: string;
  label: string;
  icon: typeof BookOpen;
}

// ============================================================================
// 侧边目录配置
// ============================================================================

const NAV_ITEMS: NavItem[] = [
  { id: 'project-intro', label: '项目介绍', icon: BookOpen },
  { id: 'quick-start', label: '快速上手', icon: Rocket },
  { id: 'faq', label: '常见问题', icon: MessageSquare },
  { id: 'shortcuts', label: '快捷键', icon: Keyboard },
  { id: 'changelog', label: '版本日志', icon: BookOpen },
  { id: 'feedback', label: '反馈建议', icon: ExternalLink },
];

// ============================================================================
// 快速上手 section 图标配置（与 QUICK_START_SECTIONS 一一对应）
// ============================================================================

const QUICK_START_ICONS = [Rocket, Server, Server, Users, Settings];

// ============================================================================
// 组件
// ============================================================================

export default function Help() {
  useDocumentTitle('帮助中心');
  const navigate = useNavigate();

  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<string>('project-intro');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());

  // 滚动监听当前激活的 section（IntersectionObserver）
  useEffect(() => {
    const ids = NAV_ITEMS.map((item) => item.id);
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { threshold: 0.2, rootMargin: '-80px 0px -60% 0px' },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  // 获取版本日志（移除截断，显示全部）
  useEffect(() => {
    let cancelled = false;
    fetch('/api/version/changelog')
      .then((res) => res.json())
      .then((data: ChangelogEntry[]) => {
        if (!cancelled) {
          setChangelog(Array.isArray(data) ? data : []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 切换版本日志条目的展开/折叠
  const toggleVersionExpand = (version: string) => {
    setExpandedVersions((prev) => {
      const next = new Set(prev);
      if (next.has(version)) {
        next.delete(version);
      } else {
        next.add(version);
      }
      return next;
    });
  };

  // 平滑滚动到指定 section
  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const goHome = () => navigate('/home');
  const goLogin = () => navigate('/login');

  // 过滤 FAQ（基于搜索词，纯 UI 演示）
  const filteredFaqs = searchQuery.trim()
    ? FAQ_ITEMS.filter(
        (item) =>
          item.q.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.a.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : FAQ_ITEMS;

  return (
    <div className="help-page">
      <style>{HELP_PAGE_STYLES}</style>

      {/* ===================== 顶部导航栏 ===================== */}
      <header className="help-header">
        <div className="help-header-inner">
          <button
            type="button"
            className="help-header-brand"
            onClick={goHome}
            aria-label="返回首页"
          >
            <span className="help-header-logo">🎮</span>
            <span className="help-header-title">GameServer Panel 帮助中心</span>
          </button>

          <div className="help-header-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={goHome}
            >
              <ArrowLeft size={14} />
              返回首页
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={goLogin}
            >
              登录
            </button>
          </div>
        </div>
      </header>

      {/* ===================== Hero 区 ===================== */}
      <section className="help-hero">
        <div className="help-hero-inner">
          <h1 className="help-hero-title">帮助中心</h1>
          <p className="help-hero-subtitle">
            查阅使用文档、常见问题与快捷键，快速上手 GameServer Panel 的全部能力。
          </p>
          <div className="help-hero-search">
            <Search size={16} className="help-hero-search-icon" />
            <input
              type="search"
              className="help-hero-search-input"
              placeholder="搜索问题、关键词…（如：忘记密码、CDK、VIP）"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="搜索帮助文档"
            />
          </div>
        </div>
      </section>

      {/* ===================== 主体：侧边目录 + 内容 ===================== */}
      <div className="help-body">
        {/* 侧边目录 */}
        <aside className="help-sidebar" aria-label="帮助目录">
          <nav className="help-sidebar-nav">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  type="button"
                  key={item.id}
                  className={`help-sidebar-item${isActive ? ' help-sidebar-item-active' : ''}`}
                  onClick={() => scrollToSection(item.id)}
                >
                  <Icon size={15} className="help-sidebar-item-icon" />
                  <span className="help-sidebar-item-label">{item.label}</span>
                  {isActive && <ChevronRight size={13} className="help-sidebar-item-arrow" />}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* 内容区 */}
        <main className="help-content">
          <section id="project-intro" className="help-section">
            <div className="help-section-header">
              <BookOpen size={20} className="help-section-icon" />
              <h2 className="help-section-title">项目介绍</h2>
            </div>
            <p className="help-section-desc">
              了解 GameServer Panel (GSP) 的核心理念、架构与商业化能力。
            </p>
            <div className="help-step-list">
              {PROJECT_INTRO_SECTIONS.map((section) => {
                return (
                  <div key={section.title} className="help-step-card">
                    <div className="help-step-card-header">
                      <div className="help-step-card-icon-wrap">
                        <BookOpen size={16} />
                      </div>
                      <h3 className="help-step-card-title">{section.title}</h3>
                    </div>
                    <ul className="help-step-card-list">
                      {section.content.map((line, i) => (
                        <li key={i} className="help-step-card-item">
                          <span className="help-step-card-bullet">•</span>
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---------- 快速上手 ---------- */}
          <section id="quick-start" className="help-section">
            <div className="help-section-header">
              <Rocket size={20} className="help-section-icon" />
              <h2 className="help-section-title">快速上手</h2>
            </div>
            <p className="help-section-desc">
              五步从零搭建并运营你的第一个游戏服务器实例。
            </p>
            <div className="help-step-list">
              {QUICK_START_SECTIONS.map((section, idx) => {
                const Icon = QUICK_START_ICONS[idx] ?? Rocket;
                return (
                  <div key={section.title} className="help-step-card">
                    <div className="help-step-card-header">
                      <div className="help-step-card-icon-wrap">
                        <Icon size={16} />
                      </div>
                      <h3 className="help-step-card-title">{section.title}</h3>
                    </div>
                    <ul className="help-step-card-list">
                      {section.content.map((line, i) => (
                        <li key={i} className="help-step-card-item">
                          <span className="help-step-card-bullet">•</span>
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---------- 常见问题 ---------- */}
          <section id="faq" className="help-section">
            <div className="help-section-header">
              <MessageSquare size={20} className="help-section-icon" />
              <h2 className="help-section-title">常见问题</h2>
            </div>
            <p className="help-section-desc">
              涵盖登录、实例、运营、性能与备份等高频问题。
              {searchQuery.trim() && (
                <span className="help-section-search-hint">
                  {' '}
                  · 当前筛选出 {filteredFaqs.length} 条
                </span>
              )}
            </p>
            <div className="help-faq-list">
              {filteredFaqs.length === 0 ? (
                <div className="help-faq-empty">
                  没有匹配「{searchQuery}」的问题，试试其他关键词。
                </div>
              ) : (
                filteredFaqs.map((item, idx) => (
                  <details key={idx} className="help-faq-item">
                    <summary className="help-faq-q">
                      <span className="help-faq-q-text">{item.q}</span>
                      <ChevronRight size={14} className="help-faq-q-chevron" />
                    </summary>
                    <div className="help-faq-a">{item.a}</div>
                  </details>
                ))
              )}
            </div>
          </section>

          {/* ---------- 快捷键 ---------- */}
          <section id="shortcuts" className="help-section">
            <div className="help-section-header">
              <Keyboard size={20} className="help-section-icon" />
              <h2 className="help-section-title">快捷键</h2>
            </div>
            <p className="help-section-desc">
              熟练使用快捷键，大幅提升操作效率。
            </p>
            <div className="help-shortcut-list">
              {SHORTCUTS.map((sc) => (
                <div key={sc.keys} className="help-shortcut-item">
                  <span className="help-shortcut-desc">{sc.description}</span>
                  <kbd className="help-shortcut-keys">{sc.keys}</kbd>
                </div>
              ))}
            </div>
          </section>

          {/* ---------- 版本日志 ---------- */}
          <section id="changelog" className="help-section">
            <div className="help-section-header">
              <BookOpen size={20} className="help-section-icon" />
              <h2 className="help-section-title">版本日志</h2>
            </div>
            <p className="help-section-desc">
              全部版本更新记录，持续迭代，不断进化。点击条目查看详情。
            </p>

            {loading ? (
              <div className="help-changelog-loading">加载版本日志…</div>
            ) : changelog.length === 0 ? (
              <div className="help-changelog-loading">暂无版本日志</div>
            ) : (
              <div className="help-changelog-scroll-container">
                <div className="help-changelog-timeline">
                  {changelog.map((entry, i) => {
                    const isExpanded = expandedVersions.has(entry.version);
                    return (
                      <div
                        key={entry.version}
                        className={`help-changelog-item${i === 0 ? ' help-changelog-item-latest' : ''}${isExpanded ? ' help-changelog-item-expanded' : ''}`}
                      >
                        <div className="help-changelog-dot" />
                        <div className="help-changelog-content">
                          <button
                            type="button"
                            className="help-changelog-header-btn"
                            onClick={() => toggleVersionExpand(entry.version)}
                            aria-expanded={isExpanded}
                          >
                            <div className="help-changelog-header">
                              <span className="help-changelog-version">
                                v{entry.version}
                              </span>
                              <span className="help-changelog-date">{entry.date}</span>
                              {i === 0 && (
                                <span className="help-changelog-latest-badge">最新</span>
                              )}
                              <span className={`help-changelog-chevron${isExpanded ? ' open' : ''}`}>▾</span>
                            </div>
                            <h3 className="help-changelog-title">{entry.title}</h3>
                          </button>
                          {isExpanded && (
                            <div className="help-changelog-body-expanded">
                              <p className="help-changelog-body">{entry.body}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* ---------- 反馈建议 ---------- */}
          <section id="feedback" className="help-section">
            <div className="help-section-header">
              <ExternalLink size={20} className="help-section-icon" />
              <h2 className="help-section-title">反馈建议</h2>
            </div>
            <p className="help-section-desc">
              没找到答案？通过以下渠道与我们联系，我们会尽快回复。
            </p>
            <div className="help-feedback-grid">
              <a
                className="help-feedback-card"
                href="https://github.com/airxw/gameserver-panel/issues/new"
                target="_blank"
                rel="noopener noreferrer"
              >
                <div className="help-feedback-card-icon">
                  <MessageSquare size={22} />
                </div>
                <div className="help-feedback-card-body">
                  <div className="help-feedback-card-title">GitHub Issues</div>
                  <div className="help-feedback-card-desc">
                    提交 Bug 报告或功能建议，支持富文本与截图。
                  </div>
                  <div className="help-feedback-card-link">
                    github.com/airxw/gameserver-panel/issues/new
                    <ExternalLink size={12} />
                  </div>
                </div>
              </a>

              <a
                className="help-feedback-card"
                href="mailto:support@gameserver-panel.local"
              >
                <div className="help-feedback-card-icon">
                  <ExternalLink size={22} />
                </div>
                <div className="help-feedback-card-body">
                  <div className="help-feedback-card-title">邮件支持</div>
                  <div className="help-feedback-card-desc">
                    商务合作 / 紧急问题 / 私密反馈，欢迎邮件联系。
                  </div>
                  <div className="help-feedback-card-link">
                    support@gameserver-panel.local
                    <ExternalLink size={12} />
                  </div>
                </div>
              </a>
            </div>
          </section>
        </main>
      </div>

      {/* ===================== 底部 ===================== */}
      <footer className="help-footer">
        <div className="help-footer-inner">
          <div className="help-footer-left">
            © {new Date().getFullYear()} GameServer Panel · 游戏服务器运营一体化平台
          </div>
          <button
            type="button"
            className="help-footer-link"
            onClick={goHome}
          >
            返回首页
          </button>
        </div>
      </footer>
    </div>
  );
}

// ============================================================================
// 页面专用样式（help-page 前缀，通过 <style> 注入，避免新建 CSS 文件）
// ============================================================================

const HELP_PAGE_STYLES = `
.help-page {
  min-height: 100vh;
  background: #f5f6f8;
  color: #1f2933;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

/* ---------- 顶部导航 ---------- */
.help-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: #ffffff;
  border-bottom: 1px solid #e2e5ea;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.help-header-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.help-header-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  transition: background 0.15s;
  font-family: inherit;
}
.help-header-brand:hover {
  background: #f1f3f6;
}
.help-header-logo {
  font-size: 22px;
  line-height: 1;
}
.help-header-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f2933;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.help-header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* ---------- Hero 区 ---------- */
.help-hero {
  background: linear-gradient(180deg, #ffffff 0%, #f5f6f8 100%);
  border-bottom: 1px solid #e2e5ea;
}
.help-hero-inner {
  max-width: 800px;
  margin: 0 auto;
  padding: 48px 24px 36px;
  text-align: center;
}
.help-hero-title {
  margin: 0 0 8px;
  font-size: 32px;
  font-weight: 700;
  color: #1f2933;
  letter-spacing: -0.5px;
}
.help-hero-subtitle {
  margin: 0 0 24px;
  font-size: 15px;
  color: #6b7280;
  line-height: 1.6;
}
.help-hero-search {
  position: relative;
  max-width: 520px;
  margin: 0 auto;
}
.help-hero-search-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: #9ca3af;
  pointer-events: none;
}
.help-hero-search-input {
  width: 100%;
  padding: 12px 16px 12px 42px;
  font-size: 14px;
  border: 1px solid #e2e5ea;
  border-radius: 12px;
  background: #ffffff;
  color: #1f2933;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  font-family: inherit;
}
.help-hero-search-input:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}

/* ---------- 主体：侧边目录 + 内容 ---------- */
.help-body {
  max-width: 1200px;
  margin: 0 auto;
  padding: 32px 24px 64px;
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 32px;
  align-items: start;
}

/* ---------- 侧边目录 ---------- */
.help-sidebar {
  position: sticky;
  top: 80px;
}
.help-sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: #ffffff;
  border: 1px solid #e2e5ea;
  border-radius: 12px;
  padding: 8px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
}
.help-sidebar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  color: #4b5563;
  text-align: left;
  width: 100%;
  transition: background 0.15s, color 0.15s;
  font-family: inherit;
}
.help-sidebar-item:hover {
  background: #f1f3f6;
  color: #1f2933;
}
.help-sidebar-item-active {
  background: rgba(37, 99, 235, 0.08);
  color: #2563eb;
  font-weight: 600;
}
.help-sidebar-item-active:hover {
  background: rgba(37, 99, 235, 0.12);
  color: #1d4ed8;
}
.help-sidebar-item-icon {
  flex-shrink: 0;
}
.help-sidebar-item-label {
  flex: 1;
}
.help-sidebar-item-arrow {
  flex-shrink: 0;
  opacity: 0.6;
}

/* ---------- 内容区 ---------- */
.help-content {
  max-width: 800px;
  min-width: 0;
}
.help-section {
  margin-bottom: 48px;
  scroll-margin-top: 80px;
}
.help-section:last-child {
  margin-bottom: 0;
}
.help-section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.help-section-icon {
  color: #2563eb;
  flex-shrink: 0;
}
.help-section-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: #1f2933;
}
.help-section-desc {
  margin: 0 0 20px;
  font-size: 14px;
  color: #6b7280;
  line-height: 1.6;
}
.help-section-search-hint {
  color: #2563eb;
  font-weight: 500;
}

/* ---------- 快速上手 ---------- */
.help-step-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.help-step-card {
  background: #ffffff;
  border: 1px solid #e2e5ea;
  border-radius: 12px;
  padding: 18px 20px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
  transition: box-shadow 0.15s, border-color 0.15s;
}
.help-step-card:hover {
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
  border-color: #cbd5e1;
}
.help-step-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.help-step-card-icon-wrap {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: rgba(37, 99, 235, 0.1);
  color: #2563eb;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.help-step-card-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1f2933;
}
.help-step-card-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.help-step-card-item {
  display: flex;
  gap: 8px;
  font-size: 13.5px;
  line-height: 1.65;
  color: #4b5563;
}
.help-step-card-bullet {
  color: #2563eb;
  font-weight: 700;
  flex-shrink: 0;
}

/* ---------- 常见问题 ---------- */
.help-faq-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.help-faq-item {
  background: #ffffff;
  border: 1px solid #e2e5ea;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
  overflow: hidden;
  transition: border-color 0.15s;
}
.help-faq-item[open] {
  border-color: #2563eb;
}
.help-faq-q {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  cursor: pointer;
  font-size: 14.5px;
  font-weight: 600;
  color: #1f2933;
  list-style: none;
  user-select: none;
}
.help-faq-q::-webkit-details-marker {
  display: none;
}
.help-faq-q-text {
  flex: 1;
}
.help-faq-q-chevron {
  color: #9ca3af;
  flex-shrink: 0;
  transition: transform 0.2s;
}
.help-faq-item[open] .help-faq-q-chevron {
  transform: rotate(90deg);
  color: #2563eb;
}
.help-faq-a {
  padding: 0 18px 16px;
  font-size: 13.5px;
  line-height: 1.7;
  color: #4b5563;
}
.help-faq-empty {
  background: #ffffff;
  border: 1px dashed #e2e5ea;
  border-radius: 12px;
  padding: 32px 20px;
  text-align: center;
  color: #6b7280;
  font-size: 14px;
}

/* ---------- 快捷键 ---------- */
.help-shortcut-list {
  background: #ffffff;
  border: 1px solid #e2e5ea;
  border-radius: 12px;
  padding: 8px 18px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
}
.help-shortcut-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid #f1f3f6;
}
.help-shortcut-item:last-child {
  border-bottom: none;
}
.help-shortcut-desc {
  font-size: 14px;
  color: #1f2933;
}
.help-shortcut-keys {
  font-family: 'SFMono-Regular', 'Menlo', 'Consolas', monospace;
  font-size: 12.5px;
  background: #f1f3f6;
  border: 1px solid #e2e5ea;
  border-radius: 6px;
  padding: 4px 10px;
  color: #1f2933;
  white-space: nowrap;
  flex-shrink: 0;
}

/* ---------- 版本日志 ---------- */
.help-changelog-loading {
  background: #ffffff;
  border: 1px solid #e2e5ea;
  border-radius: 12px;
  padding: 32px 20px;
  text-align: center;
  color: #6b7280;
  font-size: 14px;
}
.help-changelog-scroll-container {
  max-height: 600px;
  overflow-y: auto;
  padding-right: 8px;
  border: 1px solid #e2e5ea;
  border-radius: 12px;
  background: #ffffff;
  scrollbar-width: thin;
}
.help-changelog-scroll-container::-webkit-scrollbar {
  width: 6px;
}
.help-changelog-scroll-container::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 4px;
}
.help-changelog-timeline {
  position: relative;
  padding: 16px 16px 16px 36px;
}
.help-changelog-timeline::before {
  content: '';
  position: absolute;
  left: 21px;
  top: 22px;
  bottom: 22px;
  width: 2px;
  background: #e2e5ea;
}
.help-changelog-item {
  position: relative;
  padding: 0 0 16px 16px;
}
.help-changelog-item:last-child {
  padding-bottom: 0;
}
.help-changelog-dot {
  position: absolute;
  left: -3px;
  top: 6px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #ffffff;
  border: 2px solid #cbd5e1;
}
.help-changelog-item-latest .help-changelog-dot {
  border-color: #2563eb;
  background: #2563eb;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
}
.help-changelog-content {
  background: #ffffff;
  border: 1px solid #e2e5ea;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
  overflow: hidden;
  transition: border-color 0.15s;
}
.help-changelog-item-latest .help-changelog-content {
  border-color: rgba(37, 99, 235, 0.3);
}
.help-changelog-item-expanded .help-changelog-content {
  border-color: #2563eb;
}
.help-changelog-header-btn {
  display: block;
  width: 100%;
  padding: 14px 18px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: background 0.15s;
}
.help-changelog-header-btn:hover {
  background: #f8f9fb;
}
.help-changelog-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.help-changelog-version {
  font-family: 'SFMono-Regular', 'Menlo', 'Consolas', monospace;
  font-size: 13px;
  font-weight: 700;
  color: #2563eb;
  background: rgba(37, 99, 235, 0.08);
  padding: 2px 8px;
  border-radius: 6px;
}
.help-changelog-date {
  font-size: 12.5px;
  color: #6b7280;
}
.help-changelog-latest-badge {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 8px;
  border-radius: 10px;
  background: #2563eb;
  color: #ffffff;
}
.help-changelog-chevron {
  margin-left: auto;
  font-size: 14px;
  color: #9ca3af;
  transition: transform 0.2s;
  flex-shrink: 0;
}
.help-changelog-chevron.open {
  transform: rotate(180deg);
  color: #2563eb;
}
.help-changelog-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #1f2933;
}
.help-changelog-body-expanded {
  padding: 0 18px 16px;
  border-top: 1px solid #f1f3f6;
  margin-top: 0;
}
.help-changelog-body {
  margin: 0;
  padding-top: 12px;
  font-size: 13px;
  line-height: 1.7;
  color: #4b5563;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ---------- 反馈建议 ---------- */
.help-feedback-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.help-feedback-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 18px 20px;
  background: #ffffff;
  border: 1px solid #e2e5ea;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
  text-decoration: none;
  color: inherit;
  transition: box-shadow 0.15s, border-color 0.15s, transform 0.15s;
}
.help-feedback-card:hover {
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
  border-color: #2563eb;
  transform: translateY(-1px);
}
.help-feedback-card-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(37, 99, 235, 0.1);
  color: #2563eb;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.help-feedback-card-body {
  flex: 1;
  min-width: 0;
}
.help-feedback-card-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f2933;
  margin-bottom: 4px;
}
.help-feedback-card-desc {
  font-size: 13px;
  color: #6b7280;
  line-height: 1.55;
  margin-bottom: 8px;
}
.help-feedback-card-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12.5px;
  color: #2563eb;
  font-family: 'SFMono-Regular', 'Menlo', 'Consolas', monospace;
  word-break: break-all;
}

/* ---------- 底部 ---------- */
.help-footer {
  border-top: 1px solid #e2e5ea;
  background: #ffffff;
}
.help-footer-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 18px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.help-footer-left {
  font-size: 13px;
  color: #6b7280;
}
.help-footer-link {
  background: transparent;
  border: none;
  color: #2563eb;
  cursor: pointer;
  font-size: 13px;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background 0.15s;
  font-family: inherit;
}
.help-footer-link:hover {
  background: rgba(37, 99, 235, 0.08);
  text-decoration: underline;
}

/* ---------- 响应式：移动端（<768px） ---------- */
@media (max-width: 768px) {
  .help-header-inner {
    padding: 10px 16px;
  }
  .help-header-title {
    font-size: 14px;
  }
  .help-hero-inner {
    padding: 32px 16px 24px;
  }
  .help-hero-title {
    font-size: 26px;
  }
  .help-hero-subtitle {
    font-size: 14px;
  }

  /* 主体布局：侧边栏变为顶部水平滚动 tabs */
  .help-body {
    grid-template-columns: 1fr;
    gap: 16px;
    padding: 20px 16px 48px;
  }
  .help-sidebar {
    position: static;
  }
  .help-sidebar-nav {
    flex-direction: row;
    overflow-x: auto;
    scrollbar-width: thin;
    padding: 6px;
    gap: 4px;
  }
  .help-sidebar-nav::-webkit-scrollbar {
    height: 4px;
  }
  .help-sidebar-nav::-webkit-scrollbar-thumb {
    background: #cbd5e1;
    border-radius: 4px;
  }
  .help-sidebar-item {
    flex-shrink: 0;
    white-space: nowrap;
    padding: 8px 12px;
  }
  .help-sidebar-item-arrow {
    display: none;
  }

  .help-section-title {
    font-size: 19px;
  }
  .help-feedback-grid {
    grid-template-columns: 1fr;
  }
  .help-footer-inner {
    padding: 14px 16px;
    justify-content: center;
    text-align: center;
  }
}

@media (max-width: 480px) {
  .help-header-title {
    display: none;
  }
  .help-hero-title {
    font-size: 22px;
  }
  .help-step-card,
  .help-faq-q,
  .help-faq-a,
  .help-changelog-content,
  .help-feedback-card {
    padding: 14px 16px;
  }
}
`;
