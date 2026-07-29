// ============================================================================
// GameServer Panel — 浅色高端首页（公开路由 /home）
// Apple/Linear 级别视觉体验：毛玻璃 + 渐变 + 3D 悬浮 + 滚动动画 + 打字机
// BUILD: 见 buildInfo.ts（BUILD_ID 单一来源）
// ============================================================================

import { lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  Crown,
  Gift,
  GitBranch,
  Layers,
  Menu,
  MessageSquare,
  Package,
  Puzzle,
  Rocket,
  Server,
  Shield,
  ShoppingCart,
  TicketPercent,
  Users,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useAppVersion } from '../context/AppVersionContext';
import { useGameTheme, type GameThemeId } from '../context/GameThemeContext';
import ParticleTransition from '../components/GameTransition';
import DemoShowcase from '../components/DemoShowcase';
import { GAME_CATALOG } from '../data/game-catalog';
import { GAME_LANDING_DATA } from '../data/game-landing-data';
import '../landing-light.css';
import { getBuildFooterText } from '../utils/buildFooterText';

// 路由级懒加载：游戏主题落地页
const MinecraftLanding = lazy(() => import('./game-themes/MinecraftLanding'));
const FactorioLanding = lazy(() => import('./game-themes/FactorioLanding'));
const GameLandingTemplate = lazy(() => import('./game-themes/GameLandingTemplate'));

// ============================================================================
// 站点配置
// ============================================================================

const SITE_CONFIG = {
  repoUrl: 'https://github.com/airxw/gameserver-panel',
  productName: 'GameServer Panel',
};

const NAV_SECTIONS = [
  { id: 'features', label: '能力' },
  { id: 'comparison', label: '对比' },
  { id: 'games', label: '游戏' },
] as const;

const DEPLOY_COMMAND = `git clone ${SITE_CONFIG.repoUrl} && cd gameserver-panel && ./serve.sh`;

// ============================================================================
// 数据
// ============================================================================

interface Capability {
  key: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  color: string;
  bullets: string[];
}

const CAPABILITIES: Capability[] = [
  {
    key: 'vip',
    icon: Crown,
    title: '原生 VIP',
    desc: '绑定即生效，解绑即释放，跨游戏通用，零 Mod 依赖',
    color: '#FFD60A',
    bullets: ['面板原生，不装插件', '跨游戏 Pack 通用', '自动匹配等级'],
  },
  {
    key: 'shop',
    icon: Package,
    title: '玩家商城',
    desc: '玩家下单 → 命令自动下发 → 物品快速到账',
    color: '#64D2FF',
    bullets: ['购买自动履约', '订单全程可追溯', '管理后台 + 用户商城'],
  },
  {
    key: 'cdk',
    icon: Gift,
    title: 'CDK 兑换',
    desc: '批量生成兑换码，兑换后自动发放奖励',
    color: '#0A84FF',
    bullets: ['批量生成兑换码', '有效期 + 次数限制', '防重复兑换'],
  },
  {
    key: 'gift',
    icon: Package,
    title: '欢迎礼包',
    desc: '新玩家进服自动领取，一份配置跨游戏复用',
    color: '#30D158',
    bullets: ['进服自动触发', '跨 Pack 通用', '零配置接入新游戏'],
  },
  {
    key: 'vote',
    icon: MessageSquare,
    title: '社区投票',
    desc: '玩家投票阈值触发自动执行游戏命令',
    color: '#5AC8FA',
    bullets: ['阈值自动执行', '社区自治治理', '从被管理到参与管理'],
  },
];

const PAIN_COMPARISON = [
  {
    pain: 'VIP 靠装 LuckPerms 插件，跨游戏重配，Mod 冲突就失效',
    solution: '面板原生 VIP，绑定即生效，零 Mod 依赖',
    icon: Crown,
    color: '#FFD60A',
  },
  {
    pain: '商城靠论坛 + 经济插件 + 兑换插件拼凑，履约靠人工',
    solution: '内置商城，下单自动触发命令模板，快速到账',
    icon: ShoppingCart,
    color: '#64D2FF',
  },
  {
    pain: 'CDK / 礼包 / 投票全靠第三方平台，数据割裂两套系统',
    solution: 'CDK / 礼包 / 投票全部原生集成，一个面板搞定',
    icon: Puzzle,
    color: '#0A84FF',
  },
];

// ============================================================================
// Hooks
// ============================================================================

/** 打字机效果 */
function useTypewriter(text: string, speed: number = 80, delay: number = 500) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed('');
    setDone(false);
    let i = 0;
    const timeout = setTimeout(() => {
      const interval = setInterval(() => {
        if (i < text.length) {
          setDisplayed(text.slice(0, i + 1));
          i++;
        } else {
          clearInterval(interval);
          setDone(true);
        }
      }, speed);
      return () => clearInterval(interval);
    }, delay);
    return () => clearTimeout(timeout);
  }, [text, speed, delay]);

  return { displayed, done };
}

/** 滚动入场动画 */
function useScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.landing-page-light [data-reveal]');
    if (!els.length) return;

    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    );

    els.forEach((el) => {
      if (!el.classList.contains('visible')) {
        obs.observe(el);
      }
    });
    return () => obs.disconnect();
  }, []);
}

/** 导航栏滚动检测 */
function useNavScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 100);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return scrolled;
}

/** 活跃 section 检测 */
function useActiveSection() {
  const [active, setActive] = useState<string>('');
  useEffect(() => {
    const ids = NAV_SECTIONS.map((s) => s.id);
    let raf = 0;
    let scheduled = false;
    const compute = () => {
      scheduled = false;
      const pivot = window.innerHeight * 0.3;
      let best: { id: string; dist: number } | null = null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
        const center = rect.top + rect.height / 2;
        const dist = Math.abs(center - pivot);
        if (!best || dist < best.dist) best = { id, dist };
      }
      if (best) setActive(best.id);
    };
    const onScroll = () => {
      if (scheduled) return;
      scheduled = true;
      raf = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return active;
}

/** 数字计数动画 */
function useCountUp(target: number, opts?: { duration?: number; start?: boolean }) {
  const { duration = 1800, start = true } = opts ?? {};
  const [value, setValue] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!start || startedRef.current) return;
    startedRef.current = true;
    const startTs = performance.now();
    let raf = 0;
    const step = (ts: number) => {
      const progress = Math.min((ts - startTs) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, start]);

  return value;
}

/** 3D 倾斜效果 */
function useTilt(maxDeg: number = 8) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState({ transform: '', transition: 'transform 0.4s ease' });

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      setStyle({
        transform: `perspective(800px) rotateX(${-y * maxDeg}deg) rotateY(${x * maxDeg}deg) scale3d(1.02, 1.02, 1.02)`,
        transition: 'transform 0.1s ease',
      });
    },
    [maxDeg],
  );

  const handleMouseLeave = useCallback(() => {
    setStyle({ transform: 'perspective(800px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)', transition: 'transform 0.4s ease' });
  }, []);

  return { ref, style, handleMouseMove, handleMouseLeave };
}

// ============================================================================
// Navbar
// ============================================================================

function Navbar() {
  const scrolled = useNavScrolled();
  const active = useActiveSection();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const goLogin = () => navigate('/login', { state: { from: '/store' } });
  const goPlayer = () => navigate('/player');
  const goHome = () => {
    navigate('/home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setMobileOpen(false);
    }
  };

  return (
    <nav className={`landing-nav-light${scrolled ? ' scrolled' : ''}`}>
      <div className="landing-nav-inner-light">
        <button type="button" className="landing-nav-brand-light" onClick={goHome}>
          <span className="landing-nav-logo-light">🎮</span>
          <span className="landing-nav-title-light">GameServer Panel</span>
        </button>

        <div className={`landing-nav-links-light${mobileOpen ? ' mobile-open' : ''}`}>
          {NAV_SECTIONS.map((s) => (
            <button
              type="button"
              key={s.id}
              className={`landing-nav-link-light${active === s.id ? ' active' : ''}`}
              onClick={() => scrollTo(s.id)}
            >
              {s.label}
            </button>
          ))}
          <button type="button" className="landing-nav-link-light" onClick={goPlayer}>
            我是玩家
          </button>
          <button className="landing-nav-btn-light landing-nav-btn-primary-light" onClick={goLogin}>
            进入控制台
            <ArrowRight size={14} />
          </button>
        </div>

        <button
          className="landing-nav-link-light landing-nav-mobile-toggle-light"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="切换菜单"
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>
    </nav>
  );
}

// ============================================================================
// Hero — 打字机 + 渐变光晕 + 终端动画
// ============================================================================

type TerminalToken = { text: string; className?: string };

const terminalLines: TerminalToken[][] = [
  [{ text: '$ ', className: 'term-prompt' }, { text: 'git clone https://github.com/airxw/gameserver-panel', className: 'term-command' }],
  [{ text: "Cloning into 'gameserver-panel'...", className: 'term-info' }],
  [{ text: 'remote: Enumerating objects: ', className: 'term-info' }, { text: '1234', className: 'term-number' }, { text: ', done.', className: 'term-info' }],
  [{ text: 'remote: Counting objects: ', className: 'term-info' }, { text: '100%', className: 'term-number' }, { text: ' (1234/1234), done.', className: 'term-info' }],
  [{ text: 'Receiving objects: ', className: 'term-info' }, { text: '100%', className: 'term-number' }, { text: ' (1234/1234), 2.5 MiB | 12.3 MiB/s, done.', className: 'term-info' }],
  [],
  [{ text: '$ ', className: 'term-prompt' }, { text: 'cd gameserver-panel && ./serve.sh', className: 'term-command' }],
  [{ text: '🚀 Starting GameServer Panel...', className: 'term-highlight' }],
  [{ text: '✓ Database initialized', className: 'term-success' }],
  [{ text: '✓ Backend running on port ', className: 'term-success' }, { text: '3000', className: 'term-number' }],
  [{ text: '✓ Frontend deployed', className: 'term-success' }],
  [{ text: '✓ Panel ready at ', className: 'term-success' }, { text: 'https://gsp.ecsrz.com:3001', className: 'term-url' }],
];

function TerminalAnimation() {
  const [lines, setLines] = useState<TerminalToken[][]>([]);
  const [currentLine, setCurrentLine] = useState(0);

  useEffect(() => {
    if (currentLine >= terminalLines.length) return;

    const timer = setTimeout(() => {
      setLines((prev) => [...prev, terminalLines[currentLine]]);
      setCurrentLine((prev) => prev + 1);
    }, currentLine === 0 ? 500 : 300);

    return () => clearTimeout(timer);
  }, [currentLine]);

  return (
    <div className="landing-terminal-light">
      <div className="landing-terminal-header-light">
        <div className="landing-terminal-dots-light">
          <span className="landing-terminal-dot-light red" />
          <span className="landing-terminal-dot-light yellow" />
          <span className="landing-terminal-dot-light green" />
        </div>
        <span className="landing-terminal-title-light">Terminal</span>
      </div>
      <div className="landing-terminal-body-light">
        {lines.map((tokens, i) => (
          <div key={i} className="landing-terminal-line-light">
            {tokens.map((token, j) => (
              <span key={j} className={token.className}>{token.text}</span>
            ))}
          </div>
        ))}
        {currentLine < terminalLines.length && (
          <div className="landing-terminal-cursor-light">█</div>
        )}
      </div>
    </div>
  );
}

function HeroPreview() {
  return (
    <div className="landing-preview-light" data-reveal>
      <div className="landing-preview-window-light">
        <div className="landing-preview-titlebar-light">
          <div className="landing-preview-dots-light">
            <span className="landing-preview-dot-light red" />
            <span className="landing-preview-dot-light yellow" />
            <span className="landing-preview-dot-light green" />
          </div>
          <div className="landing-preview-url-light">
            <Shield size={12} />
            gsp.ecsrz.com:3001
          </div>
        </div>
        <div className="landing-preview-body-light">
          <div className="landing-preview-sidebar-light">
            <div className="landing-preview-sidebar-title-light">实例</div>
            <div className="landing-preview-nav-item-light active">
              <span className="landing-preview-status-dot-light" />
              Minecraft 生存服
            </div>
            <div className="landing-preview-nav-item-light">
              <span className="landing-preview-status-dot-light" />
              Factorio 工厂服
            </div>
            <div className="landing-preview-nav-item-light">
              <span className="landing-preview-status-dot-light offline" />
              Palworld 帕鲁服
            </div>
            <div className="landing-preview-sidebar-title-light" style={{ marginTop: 12 }}>运营</div>
            <div className="landing-preview-nav-item-light">
              <ShoppingCart size={12} />
              商城订单
            </div>
            <div className="landing-preview-nav-item-light">
              <TicketPercent size={12} />
              CDK 兑换
            </div>
            <div className="landing-preview-nav-item-light">
              <Users size={12} />
              VIP 会员
            </div>
          </div>
          <div className="landing-preview-main-light">
            <div className="landing-preview-card-light">
              <div className="landing-preview-card-title-light">在线玩家</div>
              <div className="landing-preview-card-value-light cyan">42</div>
            </div>
            <div className="landing-preview-card-light">
              <div className="landing-preview-card-title-light">今日订单</div>
              <div className="landing-preview-card-value-light purple">¥ 328</div>
            </div>
            <div className="landing-preview-card-light">
              <div className="landing-preview-card-title-light">服务器状态</div>
              <div className="landing-preview-card-value-light green">运行中</div>
            </div>
            <div className="landing-preview-card-light">
              <div className="landing-preview-card-title-light">运行时长</div>
              <div className="landing-preview-card-value-light orange">72h 14m</div>
            </div>
            <div className="landing-preview-game-row-light">
              <span className="landing-preview-game-chip-light cyan">Minecraft</span>
              <span className="landing-preview-game-chip-light purple">Factorio</span>
              <span className="landing-preview-game-chip-light green">Palworld</span>
              <span className="landing-preview-game-chip-light orange">Rust</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  const navigate = useNavigate();
  const { version, fallback, loading, failed } = useAppVersion();
  const displayVersion = version ?? (loading ? '…' : failed ? `v${fallback}` : '');
  const { displayed, done } = useTypewriter('让游戏服可持续运营', 100, 800);

  return (
    <section className="landing-hero-light">
      {/* 动态渐变光晕 */}
      <div className="landing-hero-glow-light landing-hero-glow-1" />
      <div className="landing-hero-glow-light landing-hero-glow-2" />
      <div className="landing-hero-glow-light landing-hero-glow-3" />

      <div className="landing-hero-content-light" data-reveal>
        <span className="landing-hero-badge-light">
          <Zap size={13} /> {displayVersion ? `${displayVersion}` : ''} · 游戏服务器运营一体化平台
        </span>

        <h1 className="landing-hero-title-light">
          一个面板，<br />
          <span className="landing-gradient-text-light">
            {displayed}
            {!done && <span className="landing-typewriter">&nbsp;</span>}
          </span>
        </h1>

        <p className="landing-hero-desc-light">
          VIP、商城、CDK、礼包、投票——不再靠 Mod 拼凑。
          <br />
          {GAME_CATALOG.length} 款游戏开箱即用，开服即可开始运营。
        </p>

        <div className="landing-hero-actions-light">
          <button
            className="landing-btn-light landing-btn-primary-light"
            onClick={() => navigate('/login', { state: { from: '/store' } })}
          >
            <Rocket size={18} />
            免费部署
          </button>
          <button
            className="landing-btn-light landing-btn-secondary-light"
            onClick={() => {
              const el = document.getElementById('comparison');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <Layers size={18} />
            为什么选我们
          </button>
        </div>

        <div className="landing-hero-trust-light">
          <span className="landing-trust-item-light">
            <Check size={14} /> 0 Mod 依赖
          </span>
          <span className="landing-trust-divider-light" />
          <span className="landing-trust-item-light">
            <Check size={14} /> 5 分钟部署
          </span>
          <span className="landing-trust-divider-light" />
          <span className="landing-trust-item-light">
            <Check size={14} /> 开源免费
          </span>
        </div>
      </div>

      {/* 产品预览 + 终端动画 */}
      <div className="landing-hero-showcase-light">
        <HeroPreview />
        <div className="landing-hero-terminal-light" data-reveal>
          <TerminalAnimation />
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Comparison — 痛点对比（左右布局）
// ============================================================================

function ComparisonStat({ value, suffix, label }: { value: number; suffix: string; label: string }) {
  const [start, setStart] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setStart(true);
          obs.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const animated = useCountUp(value, { start });

  return (
    <div className="landing-comp-stat-light" ref={ref}>
      <div className="landing-comp-stat-value-light">
        {animated}{suffix}
      </div>
      <div className="landing-comp-stat-label-light">{label}</div>
    </div>
  );
}

function Comparison() {
  return (
    <section className="landing-section-light" id="comparison">
      <div className="landing-container-light">
        <div className="landing-section-header-light" data-reveal>
          <span className="landing-section-tag-light">
            <X size={12} /> 你还在这样？
          </span>
          <h2 className="landing-section-title-light">
            还在用插件拼凑<span className="landing-gradient-text-light">运营能力</span>？
          </h2>
          <p className="landing-section-desc-light">
            市面方案 = 管理面板 + 一堆游戏内插件 + 第三方平台。
            <br />
            数据不通、履约靠人工、跨游戏要重配。
          </p>
        </div>

        <div className="landing-comparison-grid-light" data-reveal>
          {PAIN_COMPARISON.map((item, i) => {
            const Icon = item.icon;
            return (
              <div key={i} className="landing-comparison-row-light">
                <div className="landing-comparison-pain-light">
                  <span className="landing-comparison-icon-wrap-light bad">
                    <Icon size={18} style={{ color: item.color }} />
                  </span>
                  <span>{item.pain}</span>
                </div>
                <div className="landing-comparison-arrow-light">
                  <ArrowRight size={20} />
                </div>
                <div className="landing-comparison-solution-light">
                  <span className="landing-comparison-icon-wrap-light good">
                    <Check size={18} style={{ color: item.color }} />
                  </span>
                  <span>{item.solution}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="landing-comparison-stats-light" data-reveal>
          <ComparisonStat value={GAME_CATALOG.length} suffix="款" label="游戏开箱即用" />
          <ComparisonStat value={5} suffix="项" label="原生运营能力" />
          <ComparisonStat value={0} suffix="" label="Mod 依赖" />
          <ComparisonStat value={1} suffix="" label="订单自动履约" />
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Features — 3D 悬浮卡片
// ============================================================================

function TiltCard({ cap }: { cap: Capability }) {
  const tilt = useTilt(8);
  const Icon = cap.icon;
  const [expanded, setExpanded] = useState(false);
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    const touch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    setIsTouch(touch);
  }, []);

  return (
    <div
      ref={tilt.ref}
      className={`landing-cap-card-light${expanded ? ' expanded' : ''}`}
      style={{
        ...tilt.style,
        ['--cap-color' as string]: cap.color,
      }}
      onMouseMove={tilt.handleMouseMove}
      onMouseLeave={tilt.handleMouseLeave}
      onMouseEnter={() => !isTouch && setExpanded(true)}
      onClick={() => isTouch && setExpanded((v) => !v)}
    >
      <div className="landing-cap-icon-wrap-light">
        <div className="landing-cap-icon-light" style={{ background: `${cap.color}12`, borderColor: `${cap.color}30` }}>
          <Icon size={28} style={{ color: cap.color }} />
        </div>
      </div>
      <h3 className="landing-cap-title-light">{cap.title}</h3>
      <p className="landing-cap-desc-light">{cap.desc}</p>
      <ul className="landing-cap-bullets-light">
        {cap.bullets.map((b) => (
          <li key={b}>
            <Check size={14} style={{ color: cap.color }} />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      {isTouch && (
        <div className="landing-cap-expand-hint-light" style={{ color: cap.color }}>
          {expanded ? '点击收起' : '点击展开'}
        </div>
      )}
    </div>
  );
}

function Features() {
  return (
    <section className="landing-section-light" id="features" style={{ background: 'rgba(99, 102, 241, 0.02)' }}>
      <div className="landing-container-light">
        <div className="landing-section-header-light" data-reveal>
          <span className="landing-section-tag-light">
            <Zap size={12} /> 核心能力
          </span>
          <h2 className="landing-section-title-light">
            五大原生能力，<span className="landing-gradient-text-light">开箱即用</span>
          </h2>
          <p className="landing-section-desc-light">
            不依赖任何游戏内 Mod，绑定即生效、解绑即释放，跨游戏 Pack 通用。
          </p>
        </div>

        <div className="landing-cap-grid-light" data-reveal>
          {CAPABILITIES.map((cap) => (
            <TiltCard key={cap.key} cap={cap} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// GameGrid — 游戏矩阵
// ============================================================================

const FEATURED_GAME_IDS = ['minecraft', 'factorio', 'palworld', 'rust', 'ark', 'valheim'];

function GameGrid() {
  const { switchGame, theme } = useGameTheme();

  const sortedGames = [...GAME_CATALOG].sort((a, b) => {
    const aFeatured = FEATURED_GAME_IDS.indexOf(a.id);
    const bFeatured = FEATURED_GAME_IDS.indexOf(b.id);
    if (aFeatured === -1 && bFeatured === -1) return a.name.localeCompare(b.name, 'zh-CN');
    if (aFeatured === -1) return 1;
    if (bFeatured === -1) return -1;
    return aFeatured - bFeatured;
  });

  return (
    <section className="landing-section-light" id="games">
      <div className="landing-container-light">
        <div className="landing-section-header-light" data-reveal>
          <span className="landing-section-tag-light">
            <Server size={12} /> 支持游戏
          </span>
          <h2 className="landing-section-title-light">
            {GAME_CATALOG.length} 款游戏，<span className="landing-gradient-text-light">统一管理</span>
          </h2>
          <p className="landing-section-desc-light">
            从模组沙盒到生存竞技，一个面板管所有。点击切换主题色。
          </p>
        </div>

        <div className="landing-game-grid-light" data-reveal>
          {sortedGames.map((pack) => {
            const isCurrent = theme === pack.id;
            const sprite = pack.sprites[0] || '';

            return (
              <button
                key={pack.id}
                className={`landing-game-card-light${isCurrent ? ' active' : ''}`}
                style={{
                  ['--game-color' as string]: pack.color,
                  borderColor: isCurrent ? pack.color : undefined,
                  boxShadow: isCurrent ? `0 4px 16px ${pack.color}30` : undefined,
                }}
                onClick={() => switchGame(pack.id as GameThemeId)}
              >
                <div className="landing-game-card-icon-light">
                  {sprite && (
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
                  )}
                </div>
                <span className="landing-game-card-name-light">{pack.name}</span>
                <span className="landing-game-card-tag-light">{pack.tagline}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// DeployCTA — 底部转化
// ============================================================================

function DeployCTA() {
  const navigate = useNavigate();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copyCommand = () => {
    const cmd = DEPLOY_COMMAND;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(cmd)
        .then(() => {
          setCopyState('copied');
          setTimeout(() => setCopyState('idle'), 1800);
        })
        .catch(() => {
          setCopyState('failed');
          setTimeout(() => setCopyState('idle'), 2200);
        });
    }
  };

  return (
    <section className="landing-cta-light">
      <div className="landing-cta-glow-light" />
      <div className="landing-cta-content-light" data-reveal>
        <h2 className="landing-cta-title-light">
          <span style={{ textDecoration: 'underline', textDecorationThickness: '3px', textUnderlineOffset: '8px' }}>5 分钟</span>，拥有你的一体化面板
        </h2>
        <p className="landing-cta-desc-light">
          一条命令启动，开源免费。
          <br />
          原生 VIP / 商城 / CDK / 礼包 / 投票——零 Mod 依赖。
        </p>

        <div
          className="landing-cta-code-light"
          onClick={copyCommand}
          title="点击复制"
        >
          <span style={{ opacity: 0.6 }}>$</span> {DEPLOY_COMMAND}
          {copyState === 'copied' && (
            <span style={{ marginLeft: 12, color: '#4ade80', fontSize: 12 }}>✓ 已复制</span>
          )}
          {copyState === 'failed' && (
            <span style={{ marginLeft: 12, color: '#fca5a5', fontSize: 12 }}>
              ✕ 复制失败 · 请手动选中命令复制
            </span>
          )}
        </div>

        <div className="landing-cta-actions-light">
          <button
            className="landing-btn-light landing-btn-white-light"
            onClick={() => navigate('/login', { state: { from: '/store' } })}
          >
            <Rocket size={18} />
            进入控制台
          </button>
          <a
            className="landing-btn-light landing-btn-outline-light"
            href={SITE_CONFIG.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <GitBranch size={18} />
            GitHub 源码
          </a>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Footer
// ============================================================================

function Footer() {
  const navigate = useNavigate();
  const { version, fallback } = useAppVersion();
  const displayVersion = version ?? fallback;

  return (
    <footer className="landing-footer-light">
      <div className="landing-footer-inner-light">
        <div className="landing-footer-brand-light">
          <span className="landing-footer-logo-light">🎮</span>
          <div>
            <div className="landing-footer-title-light">GameServer Panel</div>
            <div className="landing-footer-desc-light">
              游戏服务器运营一体化平台
            </div>
          </div>
        </div>

        <div className="landing-footer-links-light">
          <button type="button" className="landing-footer-link-light" onClick={() => navigate('/login', { state: { from: '/store' } })}>
            控制台
          </button>
          <button type="button" className="landing-footer-link-light" onClick={() => navigate('/help')}>
            帮助文档
          </button>
          <a
            className="landing-footer-link-light"
            href={SITE_CONFIG.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </div>
      </div>

        <div className="landing-footer-bottom-light">
          {getBuildFooterText({ variant: 'marketing', version: displayVersion })}
        </div>
    </footer>
  );
}

// ============================================================================
// 主组件
// ============================================================================

export default function Home() {
  const { theme } = useGameTheme();
  useScrollReveal();

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
    <div className="landing-page-light">
      <Navbar />
      <Hero />
      <DemoShowcase />
      <Comparison />
      <Features />
      <GameGrid />
      <DeployCTA />
      <Footer />
      <ParticleTransition />
    </div>
  );
}
