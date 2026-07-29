// ============================================================================
// FactorioLanding — Factorio 游戏专题着陆页
// 工业橙主题 + 工厂管道装饰 + Factorio 专属功能介绍
// 5 个 section：Hero / 核心功能 / 自动化脚本 / 多人联机 / CTA
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Cog,
  Cpu,
  Menu,
  Rocket,
  Save,
  Settings,
  Terminal,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useGameTheme } from '../../context/GameThemeContext';
import { getVersion } from '../../api/client';

// ============================================================================
// 数据
// ============================================================================

const FAC_NAV_SECTIONS = [
  { id: 'fac-features', label: '核心功能' },
  { id: 'fac-automation', label: '自动化' },
  { id: 'fac-multiplayer', label: '多人联机' },
] as const;

const FAC_FEATURES = [
  {
    icon: Terminal,
    title: '脚本注入',
    desc: '面板原生 RCON 脚本注入，支持 /c 命令直接执行 Lua 脚本，实时调试工厂逻辑。',
    bullets: ['实时 Lua 脚本执行', '脚本模板库', '批量执行', '执行结果回显'],
    color: '#f97316',
  },
  {
    icon: Save,
    title: '存档管理',
    desc: '存档列表可视化管理，一键备份、恢复、下载、上传，自动定时备份策略。',
    bullets: ['自动定时备份', '存档回滚一键恢复', '存档上传/下载', '多版本共存管理'],
    color: '#ea580c',
  },
  {
    icon: Settings,
    title: '蓝图系统',
    desc: '蓝图字符串管理，分类存储、一键分享，工厂设计资产化。',
    bullets: ['蓝图字符串库', '分类标签管理', '一键导入导出', '团队共享蓝图'],
    color: '#c2410c',
  },
  {
    icon: Cpu,
    title: '控制台命令',
    desc: 'Web 控制台实时输出游戏日志，命令输入自动补全，历史记录回溯。',
    bullets: ['实时日志流', '命令自动补全', '历史记录回溯', '关键词过滤'],
    color: '#9a3412',
  },
] as const;

const FAC_AUTOMATION = [
  {
    title: 'Lua 脚本模板',
    desc: '预设常用脚本模板：资源统计、电力监控、生产分析、玩家管理，一键执行。',
    examples: [
      '/c game.print(serpent.block(game.forces.player.item_production_statistics))',
      '/c game.forces.player.research_all_technologies()',
      '/c game.speed = 2',
    ],
  },
  {
    title: '定时任务',
    desc: 'Cron 表达式定时执行脚本：每日备份、周目重置、资源刷新、公告推送。',
    examples: [
      '每天 04:00 自动存档备份',
      '每周一 00:00 重置资源点',
      '每小时推送服务器状态',
    ],
  },
  {
    title: '事件触发器',
    desc: '监听游戏事件触发自定义脚本：玩家加入、研究完成、建筑被破坏。',
    examples: [
      '新玩家加入 → 发放起始物资',
      '科研完成 → 全服公告',
      '建筑被毁 → 记录日志 + 通知',
    ],
  },
] as const;

const FAC_MULTIPLAYER = [
  {
    title: '玩家管理',
    icon: Users,
    items: ['在线玩家实时列表', '玩家游戏时长统计', '踢出/封禁管理', '白名单系统'],
  },
  {
    title: '服务器配置',
    icon: Settings,
    items: ['服务器设置可视化编辑', '地图生成参数配置', '模组列表管理', '难度预设切换'],
  },
  {
    title: '性能监控',
    icon: Cog,
    items: ['UPS 实时监控', '内存/CPU 占用', '游戏速度调节', '卡顿自动告警'],
  },
] as const;

const FAC_TERMINAL_SCRIPT = [
  { text: '$ gsp start factorio', type: 'cmd', delay: 400 },
  { text: '→ Loading pack factorio v1.1.100...', type: 'muted', delay: 300 },
  { text: '→ Allocating port 34197 / 27015', type: 'muted', delay: 280 },
  { text: '→ Loading save: my_factory.zip', type: 'muted', delay: 320 },
  { text: '→ Mods loaded: 24', type: 'muted', delay: 280 },
  { text: '✓ Server started in 5.2s', type: 'success', delay: 360 },
  { text: '', type: 'muted', delay: 150 },
  { text: '$ gsp rcon "/c game.print(\'hello\')"', type: 'cmd', delay: 500 },
  { text: '→ RCON: command executed', type: 'muted', delay: 300 },
  { text: '✓ hello (broadcast to 8 players)', type: 'success', delay: 700 },
  { text: '', type: 'muted', delay: 150 },
  { text: '$ gsp save backup', type: 'cmd', delay: 450 },
  { text: '→ Creating save snapshot...', type: 'muted', delay: 400 },
  { text: '✓ backup_20260719.zip saved (128MB)', type: 'success', delay: 1200 },
] as const;

interface TerminalLine {
  text: string;
  type: string;
  delay: number;
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

function useActiveSection() {
  const [active, setActive] = useState<string>('');
  useEffect(() => {
    const ids = FAC_NAV_SECTIONS.map((s) => s.id);
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      },
      { threshold: 0.3, rootMargin: '-80px 0px -50% 0px' },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);
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

function useTerminalTyping(script: readonly TerminalLine[]) {
  const [visibleCount, setVisibleCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const run = () => {
      let acc = 0;
      (script as TerminalLine[]).forEach((line, idx) => {
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
  return (script as TerminalLine[]).slice(0, visibleCount);
}

// ============================================================================
// 组件
// ============================================================================

function FacNavbar() {
  const scrolled = useNavScrolled();
  const active = useActiveSection();
  const navigate = useNavigate();
  const { goDefault } = useGameTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setMobileOpen(false);
    }
  };

  return (
    <nav className={`landing-nav landing-nav-factorio${scrolled ? ' landing-nav-scrolled' : ''}`}>
      <div className="landing-nav-inner">
        <button type="button" className="landing-nav-back" onClick={goDefault}>
          <ArrowLeft size={16} />
          返回总览
        </button>

        <div className="landing-nav-links">
          {FAC_NAV_SECTIONS.map((s) => (
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
            className="landing-nav-btn landing-nav-btn-primary landing-nav-btn-orange"
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
            background: 'rgba(28, 12, 4, 0.96)',
            borderBottom: '1px solid rgba(249, 115, 22, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <button
            type="button"
            className="landing-nav-link"
            style={{ padding: '8px 0', fontSize: '15px', color: '#fb923c' }}
            onClick={() => {
              goDefault();
              setMobileOpen(false);
            }}
          >
            ← 返回总览
          </button>
          {FAC_NAV_SECTIONS.map((s) => (
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
            className="landing-nav-btn landing-nav-btn-primary landing-nav-btn-orange"
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

function FacHeroTerminal() {
  const lines = useTerminalTyping(FAC_TERMINAL_SCRIPT);
  return (
    <div className="landing-hero-terminal landing-hero-terminal-fac" data-reveal>
      <div className="landing-hero-terminal-titlebar">
        <div className="landing-hero-terminal-dots">
          <span />
          <span />
          <span />
        </div>
        <span className="landing-hero-terminal-title">gsp — factorio-server</span>
      </div>
      <div className="landing-hero-terminal-body">
        {lines.map((line, i) => (
          <span
            key={i}
            className={`landing-hero-terminal-line ${line.type}`}
          >
            {line.text || '\u00A0'}
          </span>
        ))}
        <span className="landing-hero-terminal-cursor" aria-hidden="true" />
      </div>
    </div>
  );
}

function FacHero() {
  const navigate = useNavigate();
  const [version, setVersion] = useState<string>('');
  useEffect(() => {
    getVersion()
      .then((res) => setVersion(res.version))
      .catch(() => setVersion(''));
  }, []);

  return (
    <section className="landing-hero landing-hero-fac">
      <div className="landing-hero-glow landing-hero-glow-fac-1" />
      <div className="landing-hero-glow landing-hero-glow-fac-2" />
      <div className="landing-fac-particles" />
      <div className="landing-fac-grid" />
      <div className="landing-fac-bg-art" aria-hidden="true">
        {/* 远处工厂剪影 */}
        <svg className="landing-fac-factory" viewBox="0 0 1200 350" preserveAspectRatio="none">
          <g opacity="0.2">
            {/* 组装机群 */}
            <rect x="80" y="150" width="100" height="150" fill="#78350f" />
            <rect x="80" y="150" width="100" height="15" fill="#92400e" />
            <rect x="100" y="120" width="20" height="40" fill="#78350f" />
            <rect x="140" y="130" width="15" height="30" fill="#78350f" />
            <circle cx="130" cy="190" r="25" fill="#ea580c" opacity="0.4" />
            <rect x="190" y="160" width="80" height="140" fill="#78350f" />
            <rect x="190" y="160" width="80" height="12" fill="#92400e" />
            <circle cx="230" cy="200" r="20" fill="#ea580c" opacity="0.3" />

            {/* 储液罐 */}
            <ellipse cx="350" cy="220" rx="35" ry="80" fill="#78350f" />
            <ellipse cx="350" cy="160" rx="35" ry="15" fill="#92400e" />
            <rect x="345" y="160" width="10" height="120" fill="#ea580c" opacity="0.5" />

            {/* 大工厂建筑 */}
            <rect x="420" y="100" width="160" height="200" fill="#78350f" />
            <rect x="420" y="100" width="160" height="20" fill="#92400e" />
            <rect x="460" y="70" width="25" height="40" fill="#78350f" />
            <rect x="520" y="80" width="20" height="30" fill="#78350f" />
            {/* 窗户 */}
            <g fill="#fbbf24" opacity="0.4">
              <rect x="435" y="130" width="15" height="20" />
              <rect x="460" y="130" width="15" height="20" />
              <rect x="485" y="130" width="15" height="20" />
              <rect x="510" y="130" width="15" height="20" />
              <rect x="535" y="130" width="15" height="20" />
              <rect x="435" y="170" width="15" height="20" />
              <rect x="460" y="170" width="15" height="20" />
              <rect x="485" y="170" width="15" height="20" />
              <rect x="510" y="170" width="15" height="20" />
              <rect x="535" y="170" width="15" height="20" />
            </g>

            {/* 烟囱 */}
            <rect x="620" y="60" width="30" height="240" fill="#78350f" />
            <rect x="615" y="50" width="40" height="15" fill="#92400e" />
            {/* 烟雾 */}
            <ellipse cx="635" cy="40" rx="20" ry="12" fill="#f97316" opacity="0.15" />
            <ellipse cx="640" cy="25" rx="25" ry="15" fill="#fb923c" opacity="0.1" />
            <ellipse cx="630" cy="10" rx="30" ry="18" fill="#fdba74" opacity="0.08" />

            {/* 机械臂 */}
            <g transform="translate(700, 180)">
              <rect x="-5" y="0" width="10" height="60" fill="#78350f" />
              <rect x="-25" y="-5" width="50" height="10" fill="#92400e" />
              <circle cx="0" cy="-5" r="8" fill="#ea580c" />
              <rect x="20" y="-5" width="40" height="8" fill="#78350f" transform="rotate(30, 20, 0)" />
            </g>

            {/* 传送带支架 */}
            <rect x="800" y="220" width="180" height="10" fill="#78350f" />
            <rect x="810" y="230" width="8" height="70" fill="#78350f" />
            <rect x="960" y="230" width="8" height="70" fill="#78350f" />
            <rect x="880" y="230" width="8" height="70" fill="#78350f" />
            {/* 传送带滚轮 */}
            <circle cx="810" cy="225" r="8" fill="#ea580c" opacity="0.6" />
            <circle cx="970" cy="225" r="8" fill="#ea580c" opacity="0.6" />

            {/* 右侧储料箱 */}
            <rect x="1020" y="140" width="120" height="160" fill="#78350f" />
            <rect x="1020" y="140" width="120" height="15" fill="#92400e" />
            <rect x="1040" y="160" width="80" height="40" fill="#ea580c" opacity="0.3" />
            <rect x="1040" y="210" width="80" height="40" fill="#ea580c" opacity="0.3" />
            <rect x="1040" y="260" width="80" height="30" fill="#ea580c" opacity="0.3" />

            {/* 管道连接 */}
            <line x1="180" y1="200" x2="315" y2="200" stroke="#ea580c" strokeWidth="4" opacity="0.3" />
            <line x1="580" y1="180" x2="700" y2="180" stroke="#ea580c" strokeWidth="4" opacity="0.3" />
            <line x1="980" y1="225" x2="1020" y2="200" stroke="#ea580c" strokeWidth="4" opacity="0.3" />
          </g>
        </svg>

        {/* 漂浮的齿轮和电路板 */}
        <svg className="landing-fac-gears" viewBox="0 0 1200 500">
          <g opacity="0.12">
            {/* 大齿轮 */}
            <g transform="translate(100, 100)">
              <circle cx="0" cy="0" r="45" fill="#ea580c" />
              <circle cx="0" cy="0" r="28" fill="#1c1008" />
              <circle cx="0" cy="0" r="12" fill="#ea580c" />
              {/* 齿 */}
              {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg, i) => (
                <rect key={i} x="-6" y="-55" width="12" height="15" fill="#ea580c" transform={`rotate(${deg})`} />
              ))}
            </g>

            {/* 中齿轮 */}
            <g transform="translate(1000, 80)">
              <circle cx="0" cy="0" r="35" fill="#f97316" />
              <circle cx="0" cy="0" r="20" fill="#1c1008" />
              <circle cx="0" cy="0" r="8" fill="#f97316" />
              {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => (
                <rect key={i} x="-5" y="-42" width="10" height="12" fill="#f97316" transform={`rotate(${deg})`} />
              ))}
            </g>

            {/* 小齿轮 */}
            <g transform="translate(900, 280)">
              <circle cx="0" cy="0" r="25" fill="#fb923c" />
              <circle cx="0" cy="0" r="14" fill="#1c1008" />
              <circle cx="0" cy="0" r="5" fill="#fb923c" />
              {[0, 60, 120, 180, 240, 300].map((deg, i) => (
                <rect key={i} x="-4" y="-30" width="8" height="8" fill="#fb923c" transform={`rotate(${deg})`} />
              ))}
            </g>

            {/* 电路板芯片 */}
            <g transform="translate(70, 280)">
              <rect x="-25" y="-18" width="50" height="36" fill="#7c2d12" rx="2" />
              <rect x="-18" y="-12" width="36" height="24" fill="#065f46" rx="1" />
              {/* 引脚 */}
              <rect x="-30" y="-12" width="5" height="3" fill="#d97706" />
              <rect x="-30" y="-4" width="5" height="3" fill="#d97706" />
              <rect x="-30" y="4" width="5" height="3" fill="#d97706" />
              <rect x="-30" y="12" width="5" height="3" fill="#d97706" />
              <rect x="25" y="-12" width="5" height="3" fill="#d97706" />
              <rect x="25" y="-4" width="5" height="3" fill="#d97706" />
              <rect x="25" y="4" width="5" height="3" fill="#d97706" />
              <rect x="25" y="12" width="5" height="3" fill="#d97706" />
              {/* 电路线 */}
              <rect x="-10" y="-8" width="20" height="1" fill="#10b981" />
              <rect x="-5" y="-4" width="15" height="1" fill="#10b981" />
              <rect x="-8" y="0" width="16" height="1" fill="#10b981" />
              <rect x="-3" y="4" width="12" height="1" fill="#10b981" />
            </g>

            {/* 传送带 */}
            <g transform="translate(1050, 350)">
              <rect x="-60" y="-8" width="120" height="16" fill="#78350f" rx="3" />
              <rect x="-55" y="-5" width="110" height="10" fill="#44403c" />
              {/* 传送带上的物品 */}
              <rect x="-40" y="-4" width="8" height="8" fill="#fbbf24" />
              <rect x="-20" y="-4" width="8" height="8" fill="#22c55e" />
              <rect x="0" y="-4" width="8" height="8" fill="#3b82f6" />
              <rect x="20" y="-4" width="8" height="8" fill="#f97316" />
              <rect x="40" y="-4" width="8" height="8" fill="#a855f7" />
            </g>
          </g>
        </svg>
      </div>
      <div className="landing-fac-pipes" />

      <div className="landing-hero-content" data-reveal>
        <span className="landing-hero-badge landing-hero-badge-orange">
          <Zap size={13} /> {version ? `v${version}` : ''} · Factorio 专属运营方案
        </span>

        <h1 className="landing-hero-title">
          你的 Factorio 工厂，<br />
          <span className="landing-gradient-text landing-gradient-text-orange">自动化运营</span>
        </h1>

        <p className="landing-hero-desc">
          脚本注入、存档管理、蓝图系统、多人联机——工业帝国的每一个齿轮，
          都在面板里精准运转。零插件，开箱即用。
        </p>

        <div className="landing-hero-actions">
          <button
            className="landing-btn landing-btn-lg landing-btn-primary landing-btn-orange landing-btn-glow"
            onClick={() => navigate('/login')}
          >
            <Rocket size={18} />
            启动工厂
          </button>
          <button
            className="landing-btn landing-btn-lg landing-btn-secondary"
            onClick={() => {
              const el = document.getElementById('fac-features');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <Zap size={18} />
            查看功能
          </button>
        </div>

        <div className="landing-hero-trust">
          <span className="landing-trust-item">
            <Check size={14} /> Lua 脚本注入
          </span>
          <span className="landing-trust-divider" />
          <span className="landing-trust-item">
            <Check size={14} /> 定时自动备份
          </span>
          <span className="landing-trust-divider" />
          <span className="landing-trust-item">
            <Check size={14} /> UPS 实时监控
          </span>
        </div>
      </div>

      <FacHeroTerminal />
    </section>
  );
}

function FacFeatures() {
  return (
    <section className="landing-section" id="fac-features">
      <div className="landing-container">
        <div className="landing-section-header" data-reveal>
          <span className="landing-section-tag landing-section-tag-orange">
            <Zap size={12} /> 核心功能
          </span>
          <h2 className="landing-section-title">
            专为 Factorio <span className="landing-gradient-text landing-gradient-text-orange">深度定制</span>
          </h2>
          <p className="landing-section-desc">
            从脚本注入到存档管理，从蓝图系统到性能监控——面板原生提供，工厂管理一体化。
          </p>
        </div>

        <div className="landing-game-feature-grid" data-reveal>
          {FAC_FEATURES.map((f) => {
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

function FacAutomation() {
  return (
    <section className="landing-section landing-section-alt" id="fac-automation">
      <div className="landing-container">
        <div className="landing-section-header" data-reveal>
          <span className="landing-section-tag landing-section-tag-orange">
            <Cog size={12} /> 自动化引擎
          </span>
          <h2 className="landing-section-title">
            像管理产线一样，
            <span className="landing-gradient-text landing-gradient-text-orange">管理你的服务器</span>
          </h2>
          <p className="landing-section-desc">
            脚本模板、定时任务、事件触发器——让服务器运维像搭工厂一样自动化运转。
          </p>
        </div>

        <div className="landing-fac-auto-grid" data-reveal>
          {FAC_AUTOMATION.map((block, i) => (
            <div key={block.title} className="landing-fac-auto-card">
              <div className="landing-fac-auto-num">0{i + 1}</div>
              <h3 className="landing-fac-auto-title">{block.title}</h3>
              <p className="landing-fac-auto-desc">{block.desc}</p>
              <div className="landing-fac-auto-examples">
                {block.examples.map((ex, j) => (
                  <code key={j} className="landing-fac-auto-example">
                    {ex}
                  </code>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FacMultiplayer() {
  return (
    <section className="landing-section" id="fac-multiplayer">
      <div className="landing-container">
        <div className="landing-section-header" data-reveal>
          <span className="landing-section-tag landing-section-tag-orange">
            <Users size={12} /> 多人联机
          </span>
          <h2 className="landing-section-title">
            多人协作，
            <span className="landing-gradient-text landing-gradient-text-orange">高效管理</span>
          </h2>
          <p className="landing-section-desc">
            从玩家管理到服务器配置，从性能监控到封禁系统——多人联机的每一环都精准可控。
          </p>
        </div>

        <div className="landing-game-multi-grid" data-reveal>
          {FAC_MULTIPLAYER.map((m) => {
            const Icon = m.icon;
            return (
              <div key={m.title} className="landing-game-multi-card">
                <div className="landing-game-multi-icon">
                  <Icon size={22} />
                </div>
                <h3 className="landing-game-multi-title">{m.title}</h3>
                <ul className="landing-game-multi-list">
                  {m.items.map((item) => (
                    <li key={item}>
                      <Check size={13} />
                      <span>{item}</span>
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

function FacCTA() {
  const navigate = useNavigate();
  const { goDefault } = useGameTheme();

  return (
    <section className="landing-cta landing-cta-fac">
      <div className="landing-cta-glow landing-cta-glow-fac" />
      <div className="landing-cta-content" data-reveal>
        <h2 className="landing-cta-title">
          准备好让你的 Factorio 工厂
          <span className="landing-gradient-text landing-gradient-text-orange">自动化运营</span> 了吗？
        </h2>
        <p className="landing-cta-desc">
          5 分钟部署完成，脚本注入、存档管理、蓝图系统、多人联机全部就绪——
          零插件配置，开箱即用。
        </p>

        <div className="landing-cta-actions">
          <button
            className="landing-btn landing-btn-lg landing-btn-primary landing-btn-orange landing-btn-glow"
            onClick={() => navigate('/login')}
          >
            <Rocket size={18} />
            启动工厂
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

function FacFooter() {
  const navigate = useNavigate();
  const { goDefault } = useGameTheme();
  const [version, setVersion] = useState<string>('');
  useEffect(() => {
    getVersion()
      .then((res) => setVersion(res.version))
      .catch(() => setVersion(''));
  }, []);

  return (
    <footer className="landing-footer landing-footer-fac">
      <div className="landing-footer-inner">
        <div className="landing-footer-brand">
          <span className="landing-footer-logo">⚙️</span>
          <div>
            <div className="landing-footer-title">Factorio · GameServer Panel</div>
            <div className="landing-footer-desc">
              Factorio 服务器运营一体化方案 · 脚本 / 存档 / 蓝图 / 监控
            </div>
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
        © {new Date().getFullYear()} GameServer Panel{version ? ` v${version}` : ''} · Factorio 专属方案
      </div>
    </footer>
  );
}

// ============================================================================
// 主组件
// ============================================================================

export default function FactorioLanding() {
  useScrollReveal();
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <div className="landing-page landing-game-page landing-game-factorio" ref={topRef}>
      <FacNavbar />
      <FacHero />
      <FacFeatures />
      <FacAutomation />
      <FacMultiplayer />
      <FacCTA />
      <FacFooter />
    </div>
  );
}
