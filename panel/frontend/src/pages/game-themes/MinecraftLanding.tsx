// ============================================================================
// MinecraftLanding — Minecraft 游戏专题着陆页
// 绿宝石主题 + 像素风装饰 + MC 专属功能介绍
// 5 个 section：Hero / 核心功能 / 命令引擎 / 模组管理 / CTA
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Crown,
  Gift,
  Menu,
  Puzzle,
  Rocket,
  Shield,
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

const MC_NAV_SECTIONS = [
  { id: 'mc-features', label: '核心功能' },
  { id: 'mc-commands', label: '命令系统' },
  { id: 'mc-mods', label: '模组管理' },
] as const;

const MC_FEATURES = [
  {
    icon: Shield,
    title: '白名单管理',
    desc: '面板原生白名单，绑定即入、解绑即出，零插件依赖。支持批量导入、自动审核。',
    bullets: ['玩家绑定自动加入白名单', '解绑自动移除，无需手动清理', '批量导入玩家名单', '申请 + 审核工作流'],
    color: '#22c55e',
  },
  {
    icon: Crown,
    title: '权限组 VIP',
    desc: '面板原生 VIP 体系，不依赖 LuckPerms。绑定实例自动获得，解绑自动释放。',
    bullets: ['VIP 等级与面板用户绑定', '跨实例通用，切换服无需重配', '特权命令模板化', 'VIP 到期自动降级'],
    color: '#16a34a',
  },
  {
    icon: Gift,
    title: '经济 & 礼包',
    desc: '面板内置点券经济 + 欢迎礼包，进服自动发放，零插件配置。',
    bullets: ['点券充值 + 消费流水', '欢迎礼包自动触发', '每日登录奖励', '活动礼包一键发放'],
    color: '#15803d',
  },
  {
    icon: Users,
    title: '领地 & 保护',
    desc: '与主流领地插件深度集成，面板可视化管理领地、成员、权限。',
    bullets: ['领地列表可视化管理', '成员权限一键配置', '领地大小与数量限制', '购买/续费领地'],
    color: '#166534',
  },
] as const;

const MC_COMMANDS = [
  { cmd: '/give <player> <item> [count]', desc: '给予玩家物品', panel: '物品库 → 选择物品 → 发放' },
  { cmd: '/tp <target> <destination>', desc: '传送玩家', panel: '玩家管理 → 选中 → 传送' },
  { cmd: '/whitelist add <player>', desc: '添加白名单', panel: '用户绑定 → 自动加入' },
  { cmd: '/gamemode <mode> <player>', desc: '切换游戏模式', panel: '玩家管理 → 快捷操作' },
  { cmd: '/ban <player> [reason]', desc: '封禁玩家', panel: '封禁系统 → 一键封禁/解封' },
  { cmd: '/say <message>', desc: '全服公告', panel: '定时消息 + 即时公告' },
] as const;

const MC_MOD_LOADERS = [
  { name: 'Forge', desc: '模组生态最丰富', status: '已支持' },
  { name: 'Fabric', desc: '轻量高性能', status: '已支持' },
  { name: 'Paper', desc: '插件端优化', status: '已支持' },
  { name: 'Spigot', desc: '经典插件端', status: '已支持' },
  { name: 'Vanilla', desc: '原版纯净', status: '已支持' },
  { name: 'NeoForge', desc: '新一代 Forge', status: '规划中' },
] as const;

const MC_TERMINAL_SCRIPT = [
  { text: '$ gsp start minecraft', type: 'cmd', delay: 400 },
  { text: '→ Loading pack minecraft-vanilla v1.21...', type: 'muted', delay: 300 },
  { text: '→ Allocating port 25565 / 25575', type: 'muted', delay: 280 },
  { text: '→ Whitelist synced: 128 players', type: 'muted', delay: 320 },
  { text: '→ VIP groups loaded: 5 tiers', type: 'muted', delay: 300 },
  { text: '✓ Server started in 3.8s', type: 'success', delay: 360 },
  { text: '', type: 'muted', delay: 150 },
  { text: '$ gsp whitelist add Steve', type: 'cmd', delay: 500 },
  { text: '→ RCON: /whitelist add Steve', type: 'muted', delay: 300 },
  { text: '✓ Steve added to whitelist', type: 'success', delay: 800 },
  { text: '', type: 'muted', delay: 150 },
  { text: '$ gsp vip grant Steve gold', type: 'cmd', delay: 450 },
  { text: '→ RCON: /lp user Steve parent set gold', type: 'muted', delay: 350 },
  { text: '✓ VIP Gold granted, no mod required', type: 'success', delay: 1200 },
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
    const ids = MC_NAV_SECTIONS.map((s) => s.id);
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

function McNavbar() {
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
    <nav className={`landing-nav landing-nav-minecraft${scrolled ? ' landing-nav-scrolled' : ''}`}>
      <div className="landing-nav-inner">
        <button type="button" className="landing-nav-back" onClick={goDefault}>
          <ArrowLeft size={16} />
          返回总览
        </button>

        <div className="landing-nav-links">
          {MC_NAV_SECTIONS.map((s) => (
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
            className="landing-nav-btn landing-nav-btn-primary landing-nav-btn-green"
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
            background: 'rgba(6, 20, 10, 0.96)',
            borderBottom: '1px solid rgba(34, 197, 94, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <button
            type="button"
            className="landing-nav-link"
            style={{ padding: '8px 0', fontSize: '15px', color: '#4ade80' }}
            onClick={() => {
              goDefault();
              setMobileOpen(false);
            }}
          >
            ← 返回总览
          </button>
          {MC_NAV_SECTIONS.map((s) => (
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
            className="landing-nav-btn landing-nav-btn-primary landing-nav-btn-green"
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

function McHeroTerminal() {
  const lines = useTerminalTyping(MC_TERMINAL_SCRIPT);
  return (
    <div className="landing-hero-terminal landing-hero-terminal-mc" data-reveal>
      <div className="landing-hero-terminal-titlebar">
        <div className="landing-hero-terminal-dots">
          <span />
          <span />
          <span />
        </div>
        <span className="landing-hero-terminal-title">gsp — minecraft-server</span>
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

function McHero() {
  const navigate = useNavigate();
  const [version, setVersion] = useState<string>('');
  useEffect(() => {
    getVersion()
      .then((res) => setVersion(res.version))
      .catch(() => setVersion(''));
  }, []);

  return (
    <section className="landing-hero landing-hero-mc">
      <div className="landing-hero-glow landing-hero-glow-mc-1" />
      <div className="landing-hero-glow landing-hero-glow-mc-2" />
      <div className="landing-mc-particles" />
      <div className="landing-mc-grid" />
      <div className="landing-mc-bg-art" aria-hidden="true">
        {/* 远处方块山 */}
        <svg className="landing-mc-mountains" viewBox="0 0 1200 400" preserveAspectRatio="none">
          {/* 远山 */}
          <g opacity="0.15">
            <rect x="50" y="200" width="80" height="200" fill="#166534" />
            <rect x="130" y="180" width="80" height="220" fill="#15803d" />
            <rect x="210" y="160" width="60" height="240" fill="#166534" />
            <rect x="270" y="220" width="100" height="180" fill="#15803d" />
            <rect x="370" y="140" width="70" height="260" fill="#166534" />
            <rect x="440" y="170" width="90" height="230" fill="#14532d" />
            <rect x="530" y="190" width="80" height="210" fill="#166534" />
            <rect x="610" y="150" width="100" height="250" fill="#15803d" />
            <rect x="710" y="180" width="70" height="220" fill="#166534" />
            <rect x="780" y="210" width="90" height="190" fill="#14532d" />
            <rect x="870" y="160" width="80" height="240" fill="#166534" />
            <rect x="950" y="190" width="100" height="210" fill="#15803d" />
            <rect x="1050" y="200" width="80" height="200" fill="#166534" />
            {/* 雪顶 */}
            <rect x="60" y="200" width="60" height="15" fill="#bbf7d0" opacity="0.5" />
            <rect x="140" y="180" width="60" height="15" fill="#bbf7d0" opacity="0.5" />
            <rect x="380" y="140" width="50" height="12" fill="#bbf7d0" opacity="0.5" />
            <rect x="620" y="150" width="80" height="12" fill="#bbf7d0" opacity="0.5" />
            <rect x="880" y="160" width="60" height="12" fill="#bbf7d0" opacity="0.5" />
          </g>
          {/* 近山 */}
          <g opacity="0.25">
            <rect x="0" y="280" width="120" height="120" fill="#166534" />
            <rect x="120" y="260" width="100" height="140" fill="#15803d" />
            <rect x="220" y="300" width="80" height="100" fill="#166534" />
            <rect x="300" y="250" width="120" height="150" fill="#14532d" />
            <rect x="420" y="280" width="90" height="120" fill="#166534" />
            <rect x="510" y="260" width="110" height="140" fill="#15803d" />
            <rect x="620" y="290" width="100" height="110" fill="#166534" />
            <rect x="720" y="250" width="130" height="150" fill="#14532d" />
            <rect x="850" y="270" width="90" height="130" fill="#166534" />
            <rect x="940" y="260" width="110" height="140" fill="#15803d" />
            <rect x="1050" y="290" width="80" height="110" fill="#166534" />
            <rect x="1130" y="270" width="70" height="130" fill="#14532d" />
          </g>
        </svg>

        {/* 像素树 */}
        <svg className="landing-mc-trees" viewBox="0 0 1200 300" preserveAspectRatio="none">
          <g opacity="0.3">
            {/* 树1 */}
            <rect x="100" y="180" width="10" height="40" fill="#78350f" />
            <rect x="85" y="140" width="40" height="45" fill="#166534" />
            <rect x="80" y="155" width="50" height="30" fill="#15803d" />
            {/* 树2 */}
            <rect x="250" y="200" width="12" height="50" fill="#78350f" />
            <rect x="230" y="150" width="50" height="55" fill="#166534" />
            <rect x="225" y="170" width="60" height="35" fill="#15803d" />
            {/* 树3 */}
            <rect x="450" y="190" width="10" height="45" fill="#78350f" />
            <rect x="435" y="145" width="40" height="50" fill="#166534" />
            <rect x="430" y="160" width="50" height="35" fill="#15803d" />
            {/* 树4 */}
            <rect x="700" y="185" width="10" height="45" fill="#78350f" />
            <rect x="685" y="140" width="40" height="50" fill="#166534" />
            <rect x="680" y="155" width="50" height="35" fill="#15803d" />
            {/* 树5 */}
            <rect x="900" y="195" width="12" height="50" fill="#78350f" />
            <rect x="880" y="148" width="50" height="52" fill="#166534" />
            <rect x="875" y="165" width="60" height="35" fill="#15803d" />
            {/* 树6 */}
            <rect x="1050" y="190" width="10" height="45" fill="#78350f" />
            <rect x="1035" y="145" width="40" height="50" fill="#166534" />
            <rect x="1030" y="160" width="50" height="35" fill="#15803d" />
          </g>
        </svg>

        {/* 漂浮的大方块群 */}
        <svg className="landing-mc-floating-blocks" viewBox="0 0 1200 500">
          <g opacity="0.15">
            {/* 苦力怕脸方块 */}
            <g transform="translate(100, 80)">
              <rect x="0" y="0" width="60" height="60" fill="#22c55e" />
              <rect x="0" y="0" width="60" height="5" fill="#4ade80" />
              <rect x="0" y="55" width="60" height="5" fill="#15803d" />
              <rect x="0" y="0" width="5" height="60" fill="#4ade80" />
              <rect x="55" y="0" width="5" height="60" fill="#15803d" />
              {/* 眼睛 */}
              <rect x="12" y="18" width="10" height="10" fill="#000" />
              <rect x="38" y="18" width="10" height="10" fill="#000" />
              {/* 嘴 */}
              <rect x="24" y="32" width="12" height="15" fill="#000" />
              <rect x="12" y="38" width="10" height="10" fill="#000" />
              <rect x="38" y="38" width="10" height="10" fill="#000" />
            </g>
            {/* 钻石方块 */}
            <g transform="translate(950, 60)">
              <rect x="0" y="0" width="50" height="50" fill="#06b6d4" />
              <rect x="0" y="0" width="50" height="4" fill="#67e8f9" />
              <rect x="0" y="46" width="50" height="4" fill="#0891b2" />
              <rect x="0" y="0" width="4" height="50" fill="#67e8f9" />
              <rect x="46" y="0" width="4" height="50" fill="#0891b2" />
              <polygon points="25,8 42,25 25,42 8,25" fill="#22d3ee" opacity="0.6" />
            </g>
            {/* 草地方块 */}
            <g transform="translate(1050, 200)">
              <rect x="0" y="0" width="45" height="45" fill="#22c55e" />
              <rect x="0" y="8" width="45" height="37" fill="#854d0e" />
              <rect x="0" y="0" width="45" height="10" fill="#22c55e" />
              <rect x="0" y="0" width="45" height="3" fill="#4ade80" />
            </g>
            {/* TNT 方块 */}
            <g transform="translate(80, 250)">
              <rect x="0" y="0" width="40" height="40" fill="#dc2626" />
              <rect x="0" y="15" width="40" height="10" fill="#fef3c7" />
              <text x="20" y="23" textAnchor="middle" fill="#000" fontSize="8" fontWeight="bold" fontFamily="monospace">TNT</text>
            </g>
            {/* 金块 */}
            <g transform="translate(1100, 320)">
              <rect x="0" y="0" width="35" height="35" fill="#eab308" />
              <rect x="0" y="0" width="35" height="3" fill="#fde047" />
              <rect x="0" y="32" width="35" height="3" fill="#ca8a04" />
              <rect x="0" y="0" width="3" height="35" fill="#fde047" />
              <rect x="32" y="0" width="3" height="35" fill="#ca8a04" />
            </g>
          </g>
        </svg>
      </div>
      <div className="landing-mc-silhouette" />

      <div className="landing-hero-content" data-reveal>
        <span className="landing-hero-badge landing-hero-badge-green">
          <Zap size={13} /> {version ? `v${version}` : ''} · Minecraft 专属运营方案
        </span>

        <h1 className="landing-hero-title">
          你的 Minecraft 服务器，<br />
          <span className="landing-gradient-text landing-gradient-text-green">开箱即可运营</span>
        </h1>

        <p className="landing-hero-desc">
          白名单、VIP、商城、礼包、经济——不靠插件拼凑，面板原生一体化。
          从玩家进服到社区治理，每一步都被经营，零 Mod 依赖。
        </p>

        <div className="landing-hero-actions">
          <button
            className="landing-btn landing-btn-lg landing-btn-primary landing-btn-green landing-btn-glow"
            onClick={() => navigate('/login')}
          >
            <Rocket size={18} />
            立即开服
          </button>
          <button
            className="landing-btn landing-btn-lg landing-btn-secondary"
            onClick={() => {
              const el = document.getElementById('mc-features');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <Zap size={18} />
            查看功能
          </button>
        </div>

        <div className="landing-hero-trust">
          <span className="landing-trust-item">
            <Check size={14} /> 白名单原生集成
          </span>
          <span className="landing-trust-divider" />
          <span className="landing-trust-item">
            <Check size={14} /> 5 级 VIP 体系
          </span>
          <span className="landing-trust-divider" />
          <span className="landing-trust-item">
            <Check size={14} /> 点券经济系统
          </span>
        </div>
      </div>

      <McHeroTerminal />
    </section>
  );
}

function McFeatures() {
  return (
    <section className="landing-section" id="mc-features">
      <div className="landing-container">
        <div className="landing-section-header" data-reveal>
          <span className="landing-section-tag landing-section-tag-green">
            <Zap size={12} /> 核心功能
          </span>
          <h2 className="landing-section-title">
            专为 Minecraft <span className="landing-gradient-text landing-gradient-text-green">深度定制</span>
          </h2>
          <p className="landing-section-desc">
            从白名单到 VIP，从经济到领地——面板原生提供，不依赖任何游戏内插件。
          </p>
        </div>

        <div className="landing-game-feature-grid" data-reveal>
          {MC_FEATURES.map((f) => {
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

function McCommands() {
  return (
    <section className="landing-section landing-section-alt" id="mc-commands">
      <div className="landing-container">
        <div className="landing-section-header" data-reveal>
          <span className="landing-section-tag landing-section-tag-green">
            <Terminal size={12} /> 命令引擎
          </span>
          <h2 className="landing-section-title">
            游戏命令，<span className="landing-gradient-text landing-gradient-text-green">面板可视化操作</span>
          </h2>
          <p className="landing-section-desc">
            常用命令不再需要记指令，面板点几下就搞定。复杂命令也可通过 Web Console 直接输入。
          </p>
        </div>

        <div className="landing-game-command-wrap" data-reveal>
          <div className="landing-game-command-list">
            {MC_COMMANDS.map((c, i) => (
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

function McMods() {
  return (
    <section className="landing-section" id="mc-mods">
      <div className="landing-container">
        <div className="landing-section-header" data-reveal>
          <span className="landing-section-tag landing-section-tag-green">
            <Puzzle size={12} /> 模组管理
          </span>
          <h2 className="landing-section-title">
            全端支持，<span className="landing-gradient-text landing-gradient-text-green">一键安装</span>
          </h2>
          <p className="landing-section-desc">
            Forge、Fabric、Paper、Spigot 全覆盖，模组上传、配置、热重载面板一站式管理。
          </p>
        </div>

        <div className="landing-game-mod-grid" data-reveal>
          {MC_MOD_LOADERS.map((m) => (
            <div key={m.name} className="landing-game-mod-card">
              <div className="landing-game-mod-name">{m.name}</div>
              <div className="landing-game-mod-desc">{m.desc}</div>
              <span
                className={`landing-game-mod-status ${m.status === '已支持' ? 'active' : 'pending'}`}
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

function McCTA() {
  const navigate = useNavigate();
  const { goDefault } = useGameTheme();

  return (
    <section className="landing-cta landing-cta-mc">
      <div className="landing-cta-glow landing-cta-glow-mc" />
      <div className="landing-cta-content" data-reveal>
        <h2 className="landing-cta-title">
          准备好让你的 Minecraft 服务器
          <span className="landing-gradient-text landing-gradient-text-green">开箱即运营</span> 了吗？
        </h2>
        <p className="landing-cta-desc">
          5 分钟部署完成，白名单、VIP、商城、礼包、经济全部就绪——
          零游戏内 Mod，零插件配置。
        </p>

        <div className="landing-cta-actions">
          <button
            className="landing-btn landing-btn-lg landing-btn-primary landing-btn-green landing-btn-glow"
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

function McFooter() {
  const navigate = useNavigate();
  const { goDefault } = useGameTheme();
  const [version, setVersion] = useState<string>('');
  useEffect(() => {
    getVersion()
      .then((res) => setVersion(res.version))
      .catch(() => setVersion(''));
  }, []);

  return (
    <footer className="landing-footer landing-footer-mc">
      <div className="landing-footer-inner">
        <div className="landing-footer-brand">
          <span className="landing-footer-logo">🟩</span>
          <div>
            <div className="landing-footer-title">Minecraft · GameServer Panel</div>
            <div className="landing-footer-desc">
              Minecraft 服务器运营一体化方案 · 白名单 / VIP / 经济 / 领地
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
        © {new Date().getFullYear()} GameServer Panel{version ? ` v${version}` : ''} · Minecraft 专属方案
      </div>
    </footer>
  );
}

// ============================================================================
// 主组件
// ============================================================================

export default function MinecraftLanding() {
  useScrollReveal();
  const topRef = useRef<HTMLDivElement>(null);

  // 进入时滚动到顶部
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <div className="landing-page landing-game-page landing-game-minecraft" ref={topRef}>
      <McNavbar />
      <McHero />
      <McFeatures />
      <McCommands />
      <McMods />
      <McCTA />
      <McFooter />
    </div>
  );
}
