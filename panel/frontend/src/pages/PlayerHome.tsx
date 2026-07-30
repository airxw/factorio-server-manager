// ============================================================================
// PlayerHome — 玩家首页（面向玩家，不是腐竹）
// 路由：/player
// 风格：明亮游戏风，感性利益导向
// ============================================================================

import { useEffect, useState } from 'react';
import { lazyWithRetry as lazy } from '../utils/lazyWithRetry';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  Crown,
  Gift,
  Gamepad2,
  Heart,
  Menu,
  MessageSquare,
  Rocket,
  ShoppingBag,
  Sparkles,
  Star,
  Ticket,
  Trophy,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useGameTheme, type GameThemeId } from '../context/GameThemeContext';
import ParticleTransition from '../components/GameTransition';
import DemoShowcase from '../components/DemoShowcase';
import { GAME_CATALOG } from '../data/game-catalog';
import { GAME_LANDING_DATA } from '../data/game-landing-data';
import '../styles/player-home.css';
import { getBuildFooterText } from '../utils/buildFooterText';

// 路由级懒加载
const MinecraftLanding = lazy(() => import('./game-themes/MinecraftLanding'));
const FactorioLanding = lazy(() => import('./game-themes/FactorioLanding'));
const GameLandingTemplate = lazy(() => import('./game-themes/GameLandingTemplate'));

// ============================================================================
// 数据：玩家福利卡片
// ============================================================================

interface PlayerBenefit {
  key: string;
  icon: typeof Crown;
  title: string;
  desc: string;
  color: string;
  emoji: string;
  bullets: string[];
}

const PLAYER_BENEFITS: PlayerBenefit[] = [
  {
    key: 'gift',
    icon: Gift,
    title: '新手礼包',
    desc: '进服就领，免费领取起步装备',
    color: '#FF9500',
    emoji: '🎁',
    bullets: ['钻石剑 ×1', '金苹果 ×5', '经验瓶 ×10'],
  },
  {
    key: 'vip',
    icon: Crown,
    title: 'VIP 特权',
    desc: '专属称号、飞行权限、优先排队',
    color: '#007AFF',
    emoji: '👑',
    bullets: ['专属前缀 & 称号', '飞行 & 传送权限', '专属聊天频道'],
  },
  {
    key: 'shop',
    icon: ShoppingBag,
    title: '玩家商城',
    desc: '装备道具一键购买，快速到账',
    color: '#5AC8FA',
    emoji: '🛒',
    bullets: ['浏览器直接下单', '游戏内快速到账', '订单全程可查'],
  },
  {
    key: 'cdk',
    icon: Ticket,
    title: 'CDK 兑换',
    desc: '活动码、朋友送的码，这里兑',
    color: '#34C759',
    emoji: '🎟️',
    bullets: ['输入兑换码快速领取', '金币、钻石、道具', '防重复兑换'],
  },
  {
    key: 'daily',
    icon: Sparkles,
    title: '每日福利',
    desc: '每天登录都有惊喜',
    color: '#30D158',
    emoji: '✨',
    bullets: ['每日签到奖励', '连续登录加成', '随机掉落稀有道具'],
  },
  {
    key: 'vote',
    icon: MessageSquare,
    title: '社区投票',
    desc: '处理作弊玩家、选活动，你说了算',
    color: '#5AC8FA',
    emoji: '🗳️',
    bullets: ['投票踢出作弊者', '发起社区活动', '参与服务器治理'],
  },
];

// ============================================================================
// 数据：玩家旅程
// ============================================================================

const PLAYER_JOURNEY = [
  { step: 1, title: '加入服务器', desc: '找到你喜欢的服务器，输入地址加入', emoji: '🎮' },
  { step: 2, title: '领取新手礼包', desc: '进服自动弹出，一键领取起步装备', emoji: '🎁' },
  { step: 3, title: '浏览商城', desc: '打开面板商城，看看有什么好物', emoji: '🛒' },
  { step: 4, title: '下单购买', desc: '浏览器下单，游戏内快速到账', emoji: '💳' },
  { step: 5, title: '享受特权', desc: 'VIP 权限自动激活，体验更流畅', emoji: '👑' },
  { step: 6, title: '参与社区', desc: '投票、活动、交友，成为服务器的一员', emoji: '🤝' },
];

// ============================================================================
// Hooks
// ============================================================================

function useScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.player-page [data-reveal]');
    if (!els.length) return;

    const viewportH = window.innerHeight;
    els.forEach((el) => {
      if (el.classList.contains('revealed')) return;
      const rect = el.getBoundingClientRect();
      if (rect.top < viewportH && rect.bottom > 0) {
        el.classList.add('revealed');
      }
    });

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

    els.forEach((el) => {
      if (!el.classList.contains('revealed')) {
        obs.observe(el);
      }
    });
    return () => obs.disconnect();
  }, []);
}

// ============================================================================
// Navbar
// ============================================================================

function PlayerNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setMobileOpen(false);
    }
  };

  return (
    <nav className={`player-nav${scrolled ? ' player-nav-scrolled' : ''}`}>
      <div className="player-nav-inner">
        <button
          type="button"
          className="player-nav-brand"
          onClick={() => {
            navigate('/');
            setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0);
          }}
        >
          <span className="player-nav-logo">🎮</span>
          <span className="player-nav-title">GameServer Panel</span>
        </button>

        <div className="player-nav-links">
          <button type="button" className="player-nav-link" onClick={() => scrollTo('benefits')}>
            福利
          </button>
          <button type="button" className="player-nav-link" onClick={() => scrollTo('demo')}>
            演示
          </button>
          <button type="button" className="player-nav-link" onClick={() => scrollTo('journey')}>
            玩法
          </button>
          <button type="button" className="player-nav-link" onClick={() => scrollTo('games')}>
            游戏
          </button>
          <button className="player-nav-btn player-nav-btn-primary" onClick={() => navigate('/login', { state: { from: '/guild' } })}>
            登录
            <ArrowRight size={14} />
          </button>
        </div>

        <button
          className="player-nav-mobile-toggle"
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
            background: 'rgba(251, 251, 253, 0.95)',
            backdropFilter: 'saturate(180%) blur(20px)',
            WebkitBackdropFilter: 'saturate(180%) blur(20px)',
            borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {['福利', '演示', '玩法', '游戏'].map((label, i) => (
            <button
              key={label}
              type="button"
              className="player-nav-link"
              style={{ padding: '8px 0', fontSize: '15px' }}
              onClick={() => scrollTo(['benefits', 'demo', 'journey', 'games'][i])}
            >
              {label}
            </button>
          ))}
          <button
            className="player-nav-btn player-nav-btn-primary"
            style={{ marginTop: '8px', width: '100%' }}
            onClick={() => navigate('/login', { state: { from: '/guild' } })}
          >
            登录
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </nav>
  );
}

// ============================================================================
// Section 1: Hero
// ============================================================================

function PlayerHero() {
  const navigate = useNavigate();

  return (
    <section className="player-hero">
      <div className="player-hero-bg" />

      <div className="player-hero-content" data-reveal>
        <span className="player-hero-badge">
          <Sparkles size={13} /> 你的游戏福利，一站搞定
        </span>

        <h1 className="player-hero-title">
          你玩的服务器，<br />
          <span className="player-gradient-text">福利全在这里</span>
        </h1>

        <p className="player-hero-desc">
          VIP 特权 · 商城好物 · 每日礼包 · CDK 兑换 · 社区投票
          <br />
          不用装 Mod，不用切平台，一个面板全搞定。
        </p>

        <div className="player-hero-actions">
          <button
            className="player-btn player-btn-lg player-btn-primary player-btn-glow player-btn-hover-lift"
            onClick={() => navigate('/login', { state: { from: '/guild' } })}
          >
            <Heart size={18} />
            查看我的福利
          </button>
          <button
            className="player-btn player-btn-lg player-btn-secondary player-btn-hover-lift"
            onClick={() => {
              const el = document.getElementById('benefits');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <Gift size={18} />
            看看有什么福利
          </button>
        </div>

        <div className="player-hero-trust">
          <span className="player-trust-item">
            <Star size={14} /> 进服即领礼包
          </span>
          <span className="player-trust-divider" />
          <span className="player-trust-item">
            <Zap size={14} /> 购买快速到账
          </span>
          <span className="player-trust-divider" />
          <span className="player-trust-item">
            <Users size={14} /> 社区自治
          </span>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Section 2: 福利展示
// ============================================================================

function PlayerBenefits() {
  return (
    <section className="player-section" id="benefits">
      <div className="player-container">
        <div className="player-section-header" data-reveal>
          <span className="player-section-tag">
            <Gift size={12} /> 玩家福利
          </span>
          <h2 className="player-section-title">
            你能拿到的<span className="player-gradient-text">好东西</span>
          </h2>
          <p className="player-section-desc">
            从进服第一秒开始，福利就来了。
          </p>
        </div>

        <div className="player-benefit-grid" data-reveal>
          {PLAYER_BENEFITS.map((benefit) => {
            const Icon = benefit.icon;
            return (
              <div
                key={benefit.key}
                className="player-benefit-card"
                style={{ ['--benefit-color' as string]: benefit.color }}
              >
                <div className="player-benefit-emoji">{benefit.emoji}</div>
                <div className="player-benefit-icon-wrap">
                  <div className="player-benefit-icon" style={{ background: `${benefit.color}18`, borderColor: `${benefit.color}40` }}>
                    <Icon size={28} style={{ color: benefit.color }} />
                  </div>
                  <div className="player-benefit-icon-glow" style={{ background: benefit.color }} />
                </div>
                <h3 className="player-benefit-title">{benefit.title}</h3>
                <p className="player-benefit-desc">{benefit.desc}</p>
                <ul className="player-benefit-bullets">
                  {benefit.bullets.map((b) => (
                    <li key={b}>
                      <Check size={14} style={{ color: benefit.color }} />
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

// ============================================================================
// Section 3: 动态演示
// ============================================================================

function PlayerDemo() {
  return (
    <section className="player-section player-section-alt" id="demo">
      <div className="player-container">
        <div className="player-section-header" data-reveal>
          <span className="player-section-tag">
            <Gamepad2 size={12} /> 实时演示
          </span>
          <h2 className="player-section-title">
            看看<span className="player-gradient-text">实际效果</span>
          </h2>
          <p className="player-section-desc">
            左边是游戏内对话框，右边是浏览器商城面板。自动循环演示所有核心场景。
          </p>
        </div>
        <DemoShowcase />
      </div>
    </section>
  );
}

// ============================================================================
// Section 4: 玩家旅程
// ============================================================================

function PlayerJourney() {
  return (
    <section className="player-section" id="journey">
      <div className="player-container">
        <div className="player-section-header" data-reveal>
          <span className="player-section-tag">
            <Rocket size={12} /> 新手指南
          </span>
          <h2 className="player-section-title">
            <span className="player-gradient-text">6 步</span>玩转服务器
          </h2>
          <p className="player-section-desc">
            从加入服务器到成为老玩家，就这么简单。
          </p>
        </div>

        <div className="player-journey-grid" data-reveal>
          {PLAYER_JOURNEY.map((item) => (
            <div key={item.step} className="player-journey-card">
              <div className="player-journey-step">{item.step}</div>
              <div className="player-journey-emoji">{item.emoji}</div>
              <h3 className="player-journey-title">{item.title}</h3>
              <p className="player-journey-desc">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Section 5: 游戏矩阵
// ============================================================================

function PlayerGames() {
  const { switchGame, theme } = useGameTheme();

  return (
    <section className="player-section player-section-alt" id="games">
      <div className="player-container">
        <div className="player-section-header" data-reveal>
          <span className="player-section-tag">
            <Gamepad2 size={12} /> 支持游戏
          </span>
          <h2 className="player-section-title">
            {GAME_CATALOG.length} 款游戏，<span className="player-gradient-text">都有福利</span>
          </h2>
          <p className="player-section-desc">
            不管玩什么游戏，福利体系都一样好用。
          </p>
        </div>

        <div className="player-game-grid" data-reveal>
          {GAME_CATALOG.map((pack) => {
            const isCurrent = theme === pack.id;
            const sprite = pack.sprites[0] || '';
            return (
              <button
                key={pack.id}
                className={`player-game-card${isCurrent ? ' player-game-card-active' : ''}`}
                style={{ ['--game-color' as string]: pack.color }}
                onClick={() => switchGame(pack.id as GameThemeId)}
              >
                <div className="player-game-card-icon">
                  {sprite ? (
                    <img
                      src={sprite}
                      alt=""
                      style={{
                        width: 36,
                        height: 36,
                        objectFit: 'contain',
                        imageRendering: pack.id === 'minecraft' || pack.id === 'terraria' ? 'pixelated' : 'auto',
                      }}
                      draggable={false}
                    />
                  ) : (
                    <span style={{ fontSize: '24px' }}>🎮</span>
                  )}
                </div>
                <span className="player-game-card-name">{pack.name}</span>
                <span className="player-game-card-tag">{pack.tagline}</span>
                {isCurrent && <span className="player-game-card-current">● 当前</span>}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Section 6: CTA — 腐竹入口
// ============================================================================

function PlayerCTA() {
  const navigate = useNavigate();
  return (
    <section className="player-cta">
      <div className="player-container" data-reveal>
        <h2 className="player-cta-title">
          你是<span className="player-gradient-text">服主</span>？
        </h2>
        <p className="player-cta-desc">
          5 分钟部署，让你的玩家也能享受这些福利。
          <br />
          免费开源，持续维护。
        </p>
        <div className="player-cta-actions">
          <button
            className="player-btn player-btn-lg player-btn-primary player-btn-glow player-btn-hover-lift"
            onClick={() => navigate('/')}
          >
            <Trophy size={18} />
            查看服主方案
          </button>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Footer
// ============================================================================

function PlayerFooter() {
  const navigate = useNavigate();
  return (
    <footer className="player-footer">
      <div className="player-container">
        <div className="player-footer-inner">
          <div
            className="player-footer-brand"
            onClick={() => {
              navigate('/');
              setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0);
            }}
          >
            <span className="player-footer-logo">🎮</span>
            <span className="player-footer-name">GameServer Panel</span>
          </div>
          <div className="player-footer-links">
            <a href="/" className="player-footer-link">服主方案</a>
            <a href="/help" className="player-footer-link">帮助中心</a>
            <a href="https://github.com/airxw/gameserver-panel" target="_blank" rel="noopener noreferrer" className="player-footer-link">
              GitHub
            </a>
          </div>
            <div className="player-footer-copy">{getBuildFooterText()}</div>
        </div>
      </div>
    </footer>
  );
}

// ============================================================================
// 主组件
// ============================================================================

export default function PlayerHome() {
  useScrollReveal();
  const { theme } = useGameTheme();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [theme]);

  if (theme === 'minecraft') {
    return (
      <>
        <MinecraftLanding />
        <ParticleTransition />
      </>
    );
  }
  if (theme === 'factorio') {
    return (
      <>
        <FactorioLanding />
        <ParticleTransition />
      </>
    );
  }
  if (GAME_LANDING_DATA[theme]) {
    return (
      <>
        <GameLandingTemplate data={GAME_LANDING_DATA[theme]} />
        <ParticleTransition />
      </>
    );
  }

  return (
    <div className="player-page">
      <PlayerNavbar />
      <PlayerHero />
      <PlayerBenefits />
      <PlayerDemo />
      <PlayerJourney />
      <PlayerGames />
      <PlayerCTA />
      <PlayerFooter />
      <ParticleTransition />
    </div>
  );
}
