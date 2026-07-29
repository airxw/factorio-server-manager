// ============================================================================
// IdentitySelector — 身份选择器（根页面 /）
// 三入口：服主 / 玩家 / 体验Demo
// 逻辑：已登录直接跳转；未登录跳/login带from参数；Demo → /demo 公开动态演示页
// BUILD: 20260725-013
// ============================================================================

import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Crown,
  Gamepad2,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useAuth } from '../api/auth';
import '../styles/identity-selector.css';
import { getBuildFooterText } from '../utils/buildFooterText';

interface IdentityOption {
  id: 'owner' | 'player' | 'demo';
  icon: typeof Crown;
  title: string;
  subtitle: string;
  desc: string;
  features: string[];
  accent: string;
  emoji: string;
  target: string;
  loginFrom: string;
}

const OPTIONS: IdentityOption[] = [
  {
    id: 'owner',
    icon: Crown,
    title: '我是服主',
    subtitle: 'Server Owner',
    desc: '一个面板，让游戏服商业化运营更简单',
    features: ['原生 VIP / 商城 / CDK', '5 分钟部署，零 Mod 依赖', '跨游戏统一管理'],
    accent: '#5AC8FA',
    emoji: '👑',
    target: '/store',
    loginFrom: '/store',
  },
  {
    id: 'player',
    icon: Gamepad2,
    title: '我是玩家',
    subtitle: 'Player',
    desc: '你玩的服务器，福利全在这里',
    features: ['进服即领新手礼包', '商城购物快速到账', '社区投票你说了算'],
    accent: '#0A84FF',
    emoji: '🎮',
    target: '/guild',
    loginFrom: '/guild',
  },
  {
    id: 'demo',
    icon: Sparkles,
    title: '先看看',
    subtitle: 'Live Demo',
    desc: '30 秒体验完整功能流程',
    features: ['自动循环实时演示', '三角色一键进入', '预置真实演示数据'],
    accent: '#30D158',
    emoji: '✨',
    target: '/demo',
    loginFrom: '/demo',
  },
];

function IdentityCard({
  option,
  onSelect,
}: {
  option: IdentityOption;
  onSelect: (id: string) => void;
}) {
  const Icon = option.icon;

  return (
    <div
      className="id-card"
      onClick={() => onSelect(option.id)}
    >
      <div className="id-card-content">
        <div className="id-card-emoji">{option.emoji}</div>
        <div className="id-card-icon-wrap">
          <Icon size={28} className="id-card-icon" />
        </div>
        <h2 className="id-card-title">{option.title}</h2>
        <p className="id-card-subtitle">{option.subtitle}</p>
        <p className="id-card-desc">{option.desc}</p>

        <ul className="id-card-features">
          {option.features.map((f) => (
            <li key={f}>
              <Zap size={12} style={{ color: option.accent }} />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <button
          className="id-card-btn"
          style={{ background: option.accent }}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(option.id);
          }}
        >
          {option.id === 'demo' ? '一键体验' : option.id === 'owner' ? '进入控制台' : '进入玩家中心'}
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

export default function IdentitySelector() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleSelect = (id: string) => {
    const option = OPTIONS.find((o) => o.id === id);
    if (!option) return;

    if (id === 'demo') {
      // v4.16.0: 直接跳转公开动态演示页，无需登录
      navigate(option.target, { replace: true });
      return;
    }

    if (user) {
      navigate(option.target, { replace: true });
    } else {
      navigate('/login', { state: { from: option.loginFrom } });
    }
  };

  return (
    <div className="id-page">
      {/* 返回公开首页按钮 */}
      <button
        type="button"
        onClick={() => navigate('/home')}
        className="id-back-btn"
      >
        <ArrowLeft size={16} />
        <span>返回首页</span>
      </button>

      {/* 顶部品牌 */}
      <div className="id-header">
        <div className="id-header-logo">🎮</div>
        <div className="id-header-text">
          <h1 className="id-header-title">GameServer Panel</h1>
          <p className="id-header-sub">游戏服务器运营一体化平台</p>
        </div>
      </div>

      {/* 标题 */}
      <div className="id-title-wrap">
        <h2 className="id-main-title">
          选择你的<span className="id-accent-text">身份</span>
        </h2>
        <p className="id-main-desc">不同身份，不同体验。选择最适合你的入口。</p>
      </div>

      {/* 三张卡片 */}
      <div className="id-grid">
        {OPTIONS.map((opt) => (
          <IdentityCard
            key={opt.id}
            option={opt}
            onSelect={handleSelect}
          />
        ))}
      </div>

      {/* 底部 */}
      <div className="id-footer">
        <span>开源免费 · 统一管理</span>
        <span className="id-footer-dot">·</span>
        <span>支持 11+ 款游戏</span>
        <span className="id-footer-dot">·</span>
        <span>零 Mod 依赖</span>
      </div>
      {/* BUILD ID — 底部规范化 footer span（部署核对用） */}
      <footer className="app-footer-build">
          {getBuildFooterText()}
      </footer>
    </div>
  );
}
