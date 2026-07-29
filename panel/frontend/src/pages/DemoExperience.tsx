// ============================================================================
// DemoExperience — 公开动态演示页（/demo）
// 定位：第三个入口「先看看」的目的地——无需登录即可观看自动循环演示，
//       并通过三个演示角色一键进入真实产品（平台/服主/玩家 = B2B2C 三级权限）
// 设计约束：浅色 Apple 族（2026-07-28 波次2 批次E 改版，方案 homepage-entry-funnel §5.3）；
//           与 LandingV6 / Login / SelectIdentity 同源 token；
//           DemoShowcase 共享组件保留深色作「产品预览框」局部（方案 §4.5 功能理由）；
//           无 Canvas、无 blur 滤镜、无无限 GPU 动画（防黑屏前车之鉴）
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Crown,
  Gamepad2,
  Play,
  Radio,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useAuth } from '../api/auth';
import { useToast } from '../components/ui';
import DemoShowcase from '../components/DemoShowcase';
import '../styles/demo-experience.css';
import { getBuildFooterText } from '../utils/buildFooterText';

// ============================================================================
// 演示角色定义（与 Login 页 DEMO_ACCOUNTS 对齐）
// ============================================================================

interface DemoRole {
  id: 'platform' | 'owner' | 'player';
  icon: typeof Crown;
  title: string;
  subtitle: string;
  desc: string;
  features: string[];
  accent: string;
  email: string;
  password: string;
  target: string;
}

const DEMO_ROLES: DemoRole[] = [
  {
    id: 'platform',
    icon: ShieldCheck,
    title: '平台管理员',
    subtitle: 'Platform Admin',
    desc: '多租户编排与节点全局视角',
    features: ['部署节点管理', '全平台实例大盘', '用户与权限治理'],
    accent: '#30D158',
    email: 'admin@local.dev',
    password: 'admin123',
    target: '/admin',
  },
  {
    id: 'owner',
    icon: Crown,
    title: '服主 · GM 工作台',
    subtitle: 'Server Owner',
    desc: '把服务器当成生意来运营',
    features: ['商城 / VIP / CDK 配置', '玩家 CRM 与流水报表', '5 分钟部署新实例'],
    accent: '#FF9500',
    email: 'manager@local.dev',
    password: 'admin123',
    target: '/store',
  },
  {
    id: 'player',
    icon: Gamepad2,
    title: '玩家门户',
    subtitle: 'Player Portal',
    desc: '玩家看到的一切在这里发生',
    features: ['商城购物与订单', 'CDK 兑换与礼包', '绑定角色与社区投票'],
    accent: '#0A84FF',
    email: 'user@local.dev',
    password: 'admin123',
    target: '/guild',
  },
];

// ============================================================================
// 实时动态条（模拟运营活动流，纯 React 状态轮换，无 GPU 开销）
// ============================================================================

const TICKER_ITEMS = [
  '玩家 Steve 购买了「VIP 黄金会员 · 30天」',
  'Alex 兑换 CDK「GSP-2024-GOLD」成功',
  '投票「踢出 Hacker123」以 5/5 通过',
  '新玩家 Lucy 领取了新手礼包',
  'Minecraft-1 当前 12 名玩家在线',
  '服主配置了新的周期广播',
];

function ActivityTicker() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIdx((prev) => (prev + 1) % TICKER_ITEMS.length);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="dx-ticker" aria-live="polite">
      <span className="dx-ticker-dot" />
      <span className="dx-ticker-label">实时动态</span>
      <span key={idx} className="dx-ticker-text">
        {TICKER_ITEMS[idx]}
      </span>
    </div>
  );
}

// ============================================================================
// 角色卡片
// ============================================================================

function RoleCard({
  role,
  loading,
  onEnter,
}: {
  role: DemoRole;
  loading: boolean;
  onEnter: (role: DemoRole) => void;
}) {
  const Icon = role.icon;

  return (
    <div className={`dx-role-card${loading ? ' dx-role-card-loading' : ''}`}>
      <div className="dx-role-icon" style={{ background: role.accent }}>
        <Icon size={26} />
      </div>
      <h3 className="dx-role-title">{role.title}</h3>
      <p className="dx-role-subtitle">{role.subtitle}</p>
      <p className="dx-role-desc">{role.desc}</p>
      <ul className="dx-role-features">
        {role.features.map((f) => (
          <li key={f}>
            <Zap size={12} style={{ color: role.accent }} />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="dx-role-btn"
        style={{ background: role.accent }}
        disabled={loading}
        onClick={() => onEnter(role)}
      >
        {loading ? '进入中…' : '一键进入'}
        <ArrowRight size={16} />
      </button>
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

export default function DemoExperience() {
  const navigate = useNavigate();
  const { user, login } = useAuth();
  const toast = useToast();
  const [loadingRole, setLoadingRole] = useState<string | null>(null);
  const showcaseRef = useRef<HTMLDivElement>(null);
  const rolesRef = useRef<HTMLDivElement>(null);

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleEnter = async (role: DemoRole) => {
    if (loadingRole) return;

    // 已登录：直接跳转目标基座
    if (user) {
      navigate(role.target);
      return;
    }

    setLoadingRole(role.id);
    try {
      await login(role.email, role.password);
      navigate(role.target, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '演示登录失败，请稍后再试';
      toast.error(msg);
    } finally {
      setLoadingRole(null);
    }
  };

  return (
    <div className="dx-page">
      {/* 顶部导航 */}
      <header className="dx-topbar">
        <button type="button" className="dx-back-btn" onClick={() => navigate('/')}>
          <ArrowLeft size={16} />
          <span>返回身份选择</span>
        </button>
        <div className="dx-brand">
          <span className="dx-brand-logo">🎮</span>
          <span className="dx-brand-name">GameServer Panel</span>
        </div>
        <span className="dx-live-badge">
          <Radio size={13} />
          LIVE DEMO
        </span>
      </header>

      {/* Hero */}
      <section className="dx-hero">
        <p className="dx-hero-eyebrow">
          <Sparkles size={14} />
          实时演示 · 无需注册
        </p>
        <h1 className="dx-hero-title">
          把开游戏服务器，
          <br />
          从<span className="dx-hero-accent-line">技术活</span>变成
          <span className="dx-hero-accent">运营活</span>
        </h1>
        <p className="dx-hero-sub">
          GSP 是游戏服务器的通用运营中台：获客 → 内容 → 秩序 → 赞助，
          一条玩家运营链路，做成可插拔的标准件。
        </p>
        <div className="dx-hero-actions">
          <button type="button" className="dx-btn-primary" onClick={() => scrollTo(showcaseRef)}>
            <Play size={16} />
            观看实时演示
          </button>
          <button type="button" className="dx-btn-ghost" onClick={() => scrollTo(rolesRef)}>
            直接进入体验
            <ArrowRight size={16} />
          </button>
        </div>
        <ActivityTicker />
      </section>

      {/* 自动循环演示 */}
      <div ref={showcaseRef} className="dx-showcase-wrap">
        <DemoShowcase />
      </div>

      {/* 三个演示角色 */}
      <section ref={rolesRef} className="dx-roles">
        <h2 className="dx-section-title">
          亲自上手：<span className="dx-hero-accent">三个角色</span>，三种视角
        </h2>
        <p className="dx-section-sub">
          平台 / 服主 / 玩家 —— 三级权限对应真实商业结构，一键登录体验完整产品。
        </p>
        <div className="dx-roles-grid">
          {DEMO_ROLES.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              loading={loadingRole === role.id}
              onEnter={handleEnter}
            />
          ))}
        </div>
      </section>

      {/* 底部说明 */}
      <footer className="dx-footer">
        <span>演示账号数据为预置示例，可随时重置</span>
        <span className="dx-footer-dot">·</span>
        <span>开源 AGPL-3.0</span>
        <span className="dx-footer-dot">·</span>
        <span>支持 11+ 款游戏</span>
      </footer>
      {/* BUILD ID — 底部规范化 footer span（部署核对用） */}
      <footer className="app-footer-build">
          {getBuildFooterText()}
      </footer>
    </div>
  );
}
