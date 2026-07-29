// ============================================================================
// GameLandingTemplate — 通用游戏专题着陆页模板
// 接受 GameLandingData 作为 props，渲染 7 个区块：
// Navbar / Hero(含 Terminal) / Features / Commands / Mods / CTA / Footer
// 通过 CSS 变量（var(--theme-primary) 等）适配各游戏主题色
// 主题变量定义在 landing.css 的 [data-game-theme='xxx'] .landing-page 选择器中
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Menu, Rocket, X, Zap } from 'lucide-react';
import { useGameTheme } from '../../context/GameThemeContext';
import { getVersion } from '../../api/client';
import type { GameLandingData, TerminalLine } from './game-landing-data';

interface GameLandingTemplateProps {
  data: GameLandingData;
}

// ============================================================================
// Hooks
// ============================================================================

function useNavScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return scrolled;
}

function useActiveSection(sectionIds: string[]) {
  const [active, setActive] = useState<string>('');
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      },
      { threshold: 0.3, rootMargin: '-80px 0px -50% 0px' },
    );
    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [sectionIds.join(',')]);
  return active;
}

function useScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.landing-game-page [data-reveal]');
    if (!els.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -60px 0px' },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);
}

function useTerminalTyping(script: TerminalLine[]) {
  const [visibleCount, setVisibleCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const run = () => {
      let acc = 0;
      script.forEach((line, idx) => {
        acc += line.delay;
        const t = setTimeout(() => {
          if (!cancelled) setVisibleCount(idx + 1);
        }, acc);
        timers.push(t);
      });
      const reset = setTimeout(() => {
        if (!cancelled) {
          setVisibleCount(0);
          run();
        }
      }, acc + 3500);
      timers.push(reset);
    };
    run();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [script]);
  return script.slice(0, visibleCount);
}

// ============================================================================
// 子组件
// ============================================================================

function GameNavbar({ data }: { data: GameLandingData }) {
  const scrolled = useNavScrolled();
  const navigate = useNavigate();
  const { goDefault } = useGameTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const sections = [
    { id: `${data.id}-features`, label: '核心功能' },
    { id: `${data.id}-commands`, label: '命令系统' },
    { id: `${data.id}-mods`, label: '模组管理' },
  ];
  const active = useActiveSection(sections.map((s) => s.id));

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setMobileOpen(false);
    }
  };

  return (
    <nav className={`landing-nav landing-nav-game${scrolled ? ' landing-nav-scrolled' : ''}`}>
      <div className="landing-nav-inner">
        <button type="button" className="landing-nav-back" onClick={goDefault}>
          <ArrowLeft size={16} />
          返回总览
        </button>

        <div className="landing-nav-links">
          {sections.map((s) => (
            <button
              type="button"
              key={s.id}
              className={`landing-nav-link${active === s.id ? ' landing-nav-link-active' : ''}`}
              onClick={() => scrollTo(s.id)}
            >
              {s.label}
            </button>
          ))}
          <button
            className="landing-nav-btn landing-nav-btn-primary landing-nav-btn-theme"
            onClick={() => navigate('/login')}
          >
            立即开服
            <ArrowRight size={14} />
          </button>
        </div>

        <button
          className="landing-nav-mobile-toggle"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="切换菜单"
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {mobileOpen && (
        <div
          style={{
            padding: '12px 24px 20px',
            background: 'var(--theme-bg, rgba(6, 12, 20, 0.96))',
            borderBottom: '1px solid var(--theme-glow-soft, rgba(100, 116, 139, 0.2))',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <button
            type="button"
            className="landing-nav-link"
            style={{ padding: '8px 0', fontSize: '15px', color: 'var(--theme-text-accent)' }}
            onClick={() => {
              goDefault();
              setMobileOpen(false);
            }}
          >
            ← 返回总览
          </button>
          {sections.map((s) => (
            <button
              type="button"
              key={s.id}
              className="landing-nav-link"
              style={{ padding: '8px 0', fontSize: '15px' }}
              onClick={() => scrollTo(s.id)}
            >
              {s.label}
            </button>
          ))}
          <button
            className="landing-nav-btn landing-nav-btn-primary landing-nav-btn-theme"
            style={{ marginTop: '8px', width: '100%' }}
            onClick={() => navigate('/login')}
          >
            立即开服
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </nav>
  );
}

function GameHeroTerminal({ script }: { script: TerminalLine[] }) {
  const lines = useTerminalTyping(script);
  return (
    <div className="landing-hero-terminal landing-hero-terminal-game" data-reveal>
      <div className="landing-hero-terminal-titlebar">
        <div className="landing-hero-terminal-dots">
          <span />
          <span />
          <span />
        </div>
        <span className="landing-hero-terminal-title">gsp — game-server</span>
      </div>
      <div className="landing-hero-terminal-body">
        {lines.map((line, i) => (
          <span key={i} className={`landing-hero-terminal-line ${line.type}`}>
            {line.text || '\u00A0'}
          </span>
        ))}
        <span className="landing-hero-terminal-cursor" aria-hidden="true" />
      </div>
    </div>
  );
}

function GameHero({ data }: { data: GameLandingData }) {
  const navigate = useNavigate();
  const [version, setVersion] = useState<string>('');
  useEffect(() => {
    getVersion()
      .then((res) => setVersion(res.version))
      .catch(() => setVersion(''));
  }, []);

  return (
    <section className="landing-hero landing-hero-game">
      <div className="landing-hero-glow landing-hero-glow-game-1" />
      <div className="landing-hero-glow landing-hero-glow-game-2" />
      <div className="landing-hero-bg-art" aria-hidden="true">
        <span className="landing-hero-emoji-deco landing-hero-emoji-deco-1">{data.emoji}</span>
        <span className="landing-hero-emoji-deco landing-hero-emoji-deco-2">{data.emoji}</span>
        <span className="landing-hero-emoji-deco landing-hero-emoji-deco-3">{data.emoji}</span>
      </div>

      <div className="landing-hero-content" data-reveal>
        <span className="landing-hero-badge landing-hero-badge-theme">
          <Zap size={13} /> {version ? `v${version}` : ''} · {data.name} 专属运营方案
        </span>

        <h1 className="landing-hero-title">
          {data.heroTitle}
          <br />
          <span className="landing-gradient-text landing-gradient-text-theme">
            {data.heroTitleHighlight}
          </span>
        </h1>

        <p className="landing-hero-desc">{data.heroDesc}</p>

        <div className="landing-hero-actions">
          <button
            className="landing-btn landing-btn-lg landing-btn-primary landing-btn-theme landing-btn-glow"
            onClick={() => navigate('/login')}
          >
            <Rocket size={18} />
            立即开服
          </button>
          <button
            className="landing-btn landing-btn-lg landing-btn-secondary"
            onClick={() => {
              const el = document.getElementById(`${data.id}-features`);
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <Zap size={18} />
            查看功能
          </button>
        </div>

        <div className="landing-hero-trust">
          {data.trustItems.map((item, idx) => (
            <span key={item} style={{ display: 'inline-flex', alignItems: 'center' }}>
              <span className="landing-trust-item">
                <Check size={14} /> {item}
              </span>
              {idx < data.trustItems.length - 1 && <span className="landing-trust-divider" />}
            </span>
          ))}
        </div>
      </div>

      <GameHeroTerminal script={data.terminalScript} />
    </section>
  );
}

function GameFeatures({ data }: { data: GameLandingData }) {
  return (
    <section className="landing-section" id={`${data.id}-features`}>
      <div className="landing-container">
        <div className="landing-section-header" data-reveal>
          <span className="landing-section-tag landing-section-tag-theme">
            <Zap size={12} /> 核心功能
          </span>
          <h2 className="landing-section-title">
            专为 {data.name}{' '}
            <span className="landing-gradient-text landing-gradient-text-theme">深度定制</span>
          </h2>
          <p className="landing-section-desc">
            端口 {data.port}
            {data.rconPort ? ` / RCON ${data.rconPort}` : ''} · Steam App {data.steamAppId} · 协议{' '}
            {data.protocol.toUpperCase()}——面板原生集成，零插件依赖。
          </p>
        </div>

        <div className="landing-game-feature-grid" data-reveal>
          {data.features.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className="landing-game-feature-card"
                style={{ ['--feature-color' as string]: f.color }}
              >
                <div className="landing-game-feature-icon">
                  <Icon size={24} />
                </div>
                <h3 className="landing-game-feature-title">{f.title}</h3>
                <p className="landing-game-feature-desc">{f.desc}</p>
                <ul className="landing-game-feature-list">
                  {f.bullets.map((b) => (
                    <li key={b}>
                      <Check size={14} />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function GameCommands({ data }: { data: GameLandingData }) {
  return (
    <section className="landing-section landing-section-alt" id={`${data.id}-commands`}>
      <div className="landing-container">
        <div className="landing-section-header" data-reveal>
          <span className="landing-section-tag landing-section-tag-theme">
            <Zap size={12} /> 命令引擎
          </span>
          <h2 className="landing-section-title">
            游戏命令，<span className="landing-gradient-text landing-gradient-text-theme">面板可视化操作</span>
          </h2>
          <p className="landing-section-desc">
            {data.protocol === 'rcon'
              ? `通过 RCON 协议（端口 ${data.rconPort}）原生下发命令，面板可视化操作常用指令。`
              : `通过 stdin 标准输入下发命令，面板点几下就搞定，复杂命令可走 Web Console。`}
          </p>
        </div>

        <div className="landing-game-command-wrap" data-reveal>
          <div className="landing-game-command-list">
            {data.commands.map((c, i) => (
              <div key={i} className="landing-game-command-item">
                <code className="landing-game-command-cmd">{c.cmd}</code>
                <div className="landing-game-command-desc">{c.desc}</div>
                <div className="landing-game-command-panel">
                  <span className="landing-game-command-arrow">→</span>
                  {c.panel}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function GameMods({ data }: { data: GameLandingData }) {
  return (
    <section className="landing-section" id={`${data.id}-mods`}>
      <div className="landing-container">
        <div className="landing-section-header" data-reveal>
          <span className="landing-section-tag landing-section-tag-theme">
            <Zap size={12} /> 模组 & 服务端生态
          </span>
          <h2 className="landing-section-title">
            全端支持，<span className="landing-gradient-text landing-gradient-text-theme">一键启用</span>
          </h2>
          <p className="landing-section-desc">
            原生服务端 + Mod 框架 + 社区生态三重支持，模组上传、配置、启用面板一站式管理。
          </p>
        </div>

        <div className="landing-game-mod-grid" data-reveal>
          {data.modLoaders.map((m) => (
            <div key={m.name} className="landing-game-mod-card">
              <div className="landing-game-mod-name">{m.name}</div>
              <div className="landing-game-mod-desc">{m.desc}</div>
              <span
                className={`landing-game-mod-status ${m.status === '已支持' ? 'active' : m.status === '原生' ? 'native' : 'pending'}`}
              >
                {m.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function GameCTA({ data }: { data: GameLandingData }) {
  const navigate = useNavigate();
  const { goDefault } = useGameTheme();

  return (
    <section className="landing-cta landing-cta-game">
      <div className="landing-cta-glow landing-cta-glow-game" />
      <div className="landing-cta-content" data-reveal>
        <h2 className="landing-cta-title">
          {data.ctaTitle}
          <span className="landing-gradient-text landing-gradient-text-theme">开箱即运营</span> 了吗？
        </h2>
        <p className="landing-cta-desc">{data.ctaDesc}</p>

        <div className="landing-cta-actions">
          <button
            className="landing-btn landing-btn-lg landing-btn-primary landing-btn-theme landing-btn-glow"
            onClick={() => navigate('/login')}
          >
            <Rocket size={18} />
            立即开服
          </button>
          <button className="landing-btn landing-btn-lg landing-btn-secondary" onClick={goDefault}>
            <ArrowLeft size={18} />
            返回总览
          </button>
        </div>
      </div>
    </section>
  );
}

function GameFooter({ data }: { data: GameLandingData }) {
  const navigate = useNavigate();
  const { goDefault } = useGameTheme();
  const [version, setVersion] = useState<string>('');
  useEffect(() => {
    getVersion()
      .then((res) => setVersion(res.version))
      .catch(() => setVersion(''));
  }, []);

  return (
    <footer className="landing-footer landing-footer-game">
      <div className="landing-footer-inner">
        <div className="landing-footer-brand">
          <span className="landing-footer-logo">{data.emoji}</span>
          <div>
            <div className="landing-footer-title">{data.name} · GameServer Panel</div>
            <div className="landing-footer-desc">{data.footerDesc}</div>
          </div>
        </div>

        <div className="landing-footer-links">
          <button type="button" className="landing-footer-link" onClick={goDefault}>
            ← 返回总览
          </button>
          <button type="button" className="landing-footer-link" onClick={() => navigate('/login')}>
            登录
          </button>
          <button type="button" className="landing-footer-link" onClick={() => navigate('/help')}>
            帮助文档
          </button>
        </div>
      </div>

      <div className="landing-footer-bottom">
        © {new Date().getFullYear()} GameServer Panel{version ? ` v${version}` : ''} · {data.name}{' '}
        专属方案
      </div>
    </footer>
  );
}

// ============================================================================
// 主组件
// ============================================================================

export default function GameLandingTemplate({ data }: GameLandingTemplateProps) {
  useScrollReveal();
  const topRef = useRef<HTMLDivElement>(null);

  // 进入时滚动到顶部
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <div
      className={`landing-page landing-game-page landing-game-${data.id} landing-game-template`}
      ref={topRef}
    >
      <GameNavbar data={data} />
      <GameHero data={data} />
      <GameFeatures data={data} />
      <GameCommands data={data} />
      <GameMods data={data} />
      <GameCTA data={data} />
      <GameFooter data={data} />
    </div>
  );
}
