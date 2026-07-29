// ============================================================================
// GameTransition — 全屏 Canvas 游戏主题转场组件（v2 视觉强化版）
// 6 种模式，每款游戏匹配专属风格：
//   'wipe'      : 斜线光带扫过 + 多色粒子流（default/rust/satisfactory）
//   'creeper'   : Minecraft 苦力怕走进屏幕中间爆炸（minecraft）
//   'bugs'      : Factorio 虫群从右侧奔袭而过（factorio）
//   'portal'    : 中心漩涡传送门 + 粒子向心聚合后爆发（palworld/dyson）
//   'stampede'  : 黑影群横向奔袭 + 尘土轨迹（ark/valheim/zomboid）
//   'embers'    : 飘动火星 + 主题色辉光（dst/enshrouded/terraria）
// 转场中途 50% 触发主题切换（commitTheme）
// ============================================================================

import { useEffect, useRef } from 'react';
import { useGameTheme, type GameThemeId } from '../context/GameThemeContext';

type TransitionMode = 'wipe' | 'creeper' | 'bugs' | 'portal' | 'stampede' | 'embers';

// ============================================================================
// 粒子接口
// ============================================================================
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  alpha: number;
  rotation: number;
  rotationSpeed: number;
  color: string;
  shape: 'square' | 'circle' | 'shard' | 'spark' | 'star';
  trail?: { x: number; y: number; alpha: number }[];
}

// ============================================================================
// 苦力怕（Creeper）绘制参数
// ============================================================================
interface Creeper {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  walkProgress: number;
  scale: number;
  exploded: boolean;
  flashIntensity: number;
}

// ============================================================================
// 虫子（Bug）绘制参数
// ============================================================================
interface Bug {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  legPhase: number;
  color: string;
  type: 'big' | 'medium' | 'small';
}

// ============================================================================
// 黑影（Stampede）绘制参数
// ============================================================================
interface Silhouette {
  x: number;
  y: number;
  vx: number;
  size: number;
  phase: number;
  type: 'dino' | 'viking' | 'zombie' | 'firebeast';
  color: string;
}

export default function GameTransition() {
  const { isTransitioning, config, theme, pendingTheme } = useGameTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const startTimeRef = useRef<number>(0);
  const committedRef = useRef(false);
  const transitionKeyRef = useRef(0);
  const flashRef = useRef(0); // 主题切换瞬间的闪光强度

  // 转场对象引用
  const creeperRef = useRef<Creeper | null>(null);
  const bugsRef = useRef<Bug[]>([]);
  const silhouettesRef = useRef<Silhouette[]>([]);
  const modeRef = useRef<TransitionMode>('wipe');
  const configRef = useRef(config);
  configRef.current = config;

  const TOTAL_DURATION = 1500; // 略加长，给视觉更充裕的展现
  const COMMIT_AT = 750; // 50% 处切换主题

  // 根据目标主题选择转场模式
  const getModeForTheme = (target: GameThemeId): TransitionMode => {
    switch (target) {
      case 'minecraft':
        return 'creeper';
      case 'factorio':
        return 'bugs';
      case 'palworld':
        return 'portal';
      case 'ark':
      case 'valheim':
      case 'zomboid':
        return 'stampede';
      case 'terraria':
        return 'embers';
      default:
        return 'wipe';
    }
  };

  // ==========================================================================
  // 工具函数
  // ==========================================================================
  const easeInOutCubic = (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

  const shadeColor = (hex: string, percent: number): string => {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, Math.min(255, (num >> 16) + amt));
    const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amt));
    const B = Math.max(0, Math.min(255, (num & 0x0000ff) + amt));
    return `#${((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1)}`;
  };

  const hexToRgba = (hex: string, alpha: number): string => {
    const num = parseInt(hex.replace('#', ''), 16);
    const R = (num >> 16) & 0xff;
    const G = (num >> 8) & 0xff;
    const B = num & 0xff;
    return `rgba(${R}, ${G}, ${B}, ${alpha})`;
  };

  // ==========================================================================
  // 绘制苦力怕（像素风格）— 保持原有实现
  // ==========================================================================
  const drawCreeper = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    flash: number,
  ) => {
    const s = scale;
    const px = s;

    const bodyColor = flash > 0 ? `rgba(255, 255, 255, ${0.3 + flash * 0.7})` : '#2d5a27';
    const bodyDark = flash > 0 ? 'rgba(200, 255, 200, 0.8)' : '#1a3a17';
    const bodyLight = flash > 0 ? 'rgba(220, 255, 220, 0.9)' : '#3d7a35';

    ctx.save();
    ctx.translate(x, y);

    const headSize = 8 * px;
    const headY = -12 * px;

    ctx.fillStyle = bodyColor;
    ctx.fillRect(-headSize / 2, headY, headSize, headSize);

    ctx.fillStyle = bodyDark;
    ctx.fillRect(-headSize / 2, headY + headSize - px, headSize, px);
    ctx.fillRect(headSize / 2 - px, headY, px, headSize);

    ctx.fillStyle = bodyLight;
    ctx.fillRect(-headSize / 2, headY, headSize, px);
    ctx.fillRect(-headSize / 2, headY, px, headSize);

    ctx.fillStyle = flash > 0 ? '#ff0000' : '#000000';
    ctx.fillRect(-3 * px, headY + 2 * px, 2 * px, 2 * px);
    ctx.fillRect(1 * px, headY + 2 * px, 2 * px, 2 * px);

    ctx.fillStyle = flash > 0 ? '#ff3333' : '#0a1a08';
    ctx.fillRect(-px, headY + 4 * px, 2 * px, 3 * px);
    ctx.fillRect(-3 * px, headY + 5 * px, 2 * px, 2 * px);
    ctx.fillRect(1 * px, headY + 5 * px, 2 * px, 2 * px);

    const bodyY = headY + headSize;
    const bodyW = 8 * px;
    const bodyH = 12 * px;

    ctx.fillStyle = bodyColor;
    ctx.fillRect(-bodyW / 2, bodyY, bodyW, bodyH);

    ctx.fillStyle = bodyDark;
    ctx.fillRect(-bodyW / 2, bodyY + bodyH - px, bodyW, px);
    ctx.fillRect(bodyW / 2 - px, bodyY, px, bodyH);

    ctx.fillStyle = bodyLight;
    ctx.fillRect(-bodyW / 2, bodyY, bodyW, px);
    ctx.fillRect(-bodyW / 2, bodyY, px, bodyH);

    const legY = bodyY + bodyH;
    const legW = 3 * px;
    const legH = 4 * px;

    ctx.fillStyle = bodyColor;
    ctx.fillRect(-bodyW / 2, legY, legW, legH);
    ctx.fillRect(bodyW / 2 - legW, legY, legW, legH);
    ctx.fillRect(-bodyW / 2 + px * 0.5, legY, legW - px, legH - px);
    ctx.fillRect(bodyW / 2 - legW - px * 0.5, legY, legW - px, legH - px);

    ctx.fillStyle = bodyDark;
    ctx.fillRect(-bodyW / 2, legY + legH - px, legW, px);
    ctx.fillRect(bodyW / 2 - legW, legY + legH - px, legW, px);

    ctx.restore();
  };

  // ==========================================================================
  // 绘制虫子（Factorio 风格）— 保持原有实现
  // ==========================================================================
  const drawBug = (ctx: CanvasRenderingContext2D, bug: Bug, phase: number) => {
    const { x, y, size, color, type } = bug;
    const legAngle = Math.sin(phase + bug.legPhase) * 0.4;

    ctx.save();
    ctx.translate(x, y);

    const segments = type === 'big' ? 5 : type === 'medium' ? 4 : 3;
    for (let i = 0; i < segments; i++) {
      const segSize = size * (1 - i * 0.12);
      const segX = -i * segSize * 0.6;
      const segY = Math.sin(phase * 1.5 + i * 0.8) * size * 0.1;

      ctx.fillStyle = i === 0 ? color : shadeColor(color, -10 - i * 5);
      ctx.beginPath();
      ctx.ellipse(segX, segY, segSize, segSize * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(255, 200, 150, 0.15)`;
      ctx.beginPath();
      ctx.ellipse(segX - segSize * 0.2, segY - segSize * 0.25, segSize * 0.4, segSize * 0.25, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const headSize = size * 0.85;
    ctx.fillStyle = '#ff4444';
    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur = size * 0.5;
    ctx.beginPath();
    ctx.arc(headSize * 0.3, -size * 0.2, size * 0.15, 0, Math.PI * 2);
    ctx.arc(headSize * 0.3, size * 0.2, size * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#ffddaa';
    ctx.beginPath();
    ctx.moveTo(headSize * 0.6, -size * 0.15);
    ctx.lineTo(headSize * 0.95, -size * 0.05);
    ctx.lineTo(headSize * 0.6, size * 0.05);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(headSize * 0.6, size * 0.15);
    ctx.lineTo(headSize * 0.95, size * 0.05);
    ctx.lineTo(headSize * 0.6, -size * 0.05);
    ctx.fill();

    ctx.strokeStyle = shadeColor(color, -20);
    ctx.lineWidth = Math.max(1, size * 0.1);
    ctx.lineCap = 'round';

    for (let i = 0; i < 3; i++) {
      const legBaseX = -i * size * 0.5;
      const legBaseY = (i % 2 === 0 ? -1 : 1) * size * 0.4;
      const legLen = size * (1.2 + i * 0.2);

      ctx.beginPath();
      ctx.moveTo(legBaseX, legBaseY);
      ctx.lineTo(
        legBaseX - Math.cos(legAngle + i * 0.5) * legLen * 0.5,
        legBaseY + (legBaseY > 0 ? 1 : -1) * Math.sin(legAngle + i * 0.5) * legLen * 0.6,
      );
      ctx.stroke();

      const midX = legBaseX - Math.cos(legAngle + i * 0.5) * legLen * 0.5;
      const midY = legBaseY + (legBaseY > 0 ? 1 : -1) * Math.sin(legAngle + i * 0.5) * legLen * 0.6;
      ctx.beginPath();
      ctx.moveTo(midX, midY);
      ctx.lineTo(
        midX - Math.cos(legAngle * 0.7 + i * 0.3) * legLen * 0.5,
        midY + (legBaseY > 0 ? 1 : -1) * Math.sin(legAngle * 0.7 + i * 0.3) * legLen * 0.4,
      );
      ctx.stroke();

      const legBaseY2 = -legBaseY;
      ctx.beginPath();
      ctx.moveTo(legBaseX, legBaseY2);
      ctx.lineTo(
        legBaseX - Math.cos(-legAngle + i * 0.5) * legLen * 0.5,
        legBaseY2 + (legBaseY2 > 0 ? 1 : -1) * Math.sin(-legAngle + i * 0.5) * legLen * 0.6,
      );
      ctx.stroke();

      const midX2 = legBaseX - Math.cos(-legAngle + i * 0.5) * legLen * 0.5;
      const midY2 = legBaseY2 + (legBaseY2 > 0 ? 1 : -1) * Math.sin(-legAngle + i * 0.5) * legLen * 0.6;
      ctx.beginPath();
      ctx.moveTo(midX2, midY2);
      ctx.lineTo(
        midX2 - Math.cos(-legAngle * 0.7 + i * 0.3) * legLen * 0.5,
        midY2 + (legBaseY2 > 0 ? 1 : -1) * Math.sin(-legAngle * 0.7 + i * 0.3) * legLen * 0.4,
      );
      ctx.stroke();
    }

    ctx.restore();
  };

  // ==========================================================================
  // 绘制黑影（恐龙/维京人/僵尸/火兽）— 新增
  // ==========================================================================
  const drawSilhouette = (ctx: CanvasRenderingContext2D, sil: Silhouette, phase: number) => {
    const { x, y, size, type, color } = sil;
    const step = Math.sin(phase + sil.phase) * 0.5; // 跑步上下起伏

    ctx.save();
    ctx.translate(x, y + step * size * 0.05);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = size * 0.3;

    if (type === 'dino') {
      // 暴龙剪影：大头 + 短前肢 + 长后肢 + 长尾
      ctx.beginPath();
      ctx.moveTo(-size * 1.4, 0); // 尾尖
      ctx.lineTo(-size * 0.8, -size * 0.3);
      ctx.lineTo(-size * 0.4, -size * 0.5); // 臀部
      ctx.lineTo(-size * 0.2, -size * 1.2); // 后背
      ctx.lineTo(size * 0.3, -size * 1.4); // 颈部
      ctx.lineTo(size * 0.9, -size * 1.5); // 头部
      ctx.lineTo(size * 1.1, -size * 1.3);
      ctx.lineTo(size * 0.9, -size * 1.1); // 下颚
      ctx.lineTo(size * 0.4, -size * 1.0);
      ctx.lineTo(size * 0.2, -size * 0.5); // 前肢连接
      ctx.lineTo(size * 0.3, -size * 0.2);
      ctx.lineTo(size * 0.5, 0); // 腹部
      ctx.lineTo(size * 0.3, size * 0.1);
      ctx.lineTo(-size * 0.4, size * 0.1);
      ctx.closePath();
      ctx.fill();

      // 腿（跑步动作）
      const leg1X = -size * 0.2;
      const leg1Angle = Math.sin(phase + sil.phase) * 0.4;
      ctx.beginPath();
      ctx.moveTo(leg1X, size * 0.1);
      ctx.lineTo(leg1X + Math.sin(leg1Angle) * size * 0.3, size * 0.6);
      ctx.lineTo(leg1X + Math.sin(leg1Angle) * size * 0.3 - size * 0.1, size * 0.7);
      ctx.lineTo(leg1X - size * 0.05, size * 0.1);
      ctx.closePath();
      ctx.fill();

      const leg2X = size * 0.15;
      const leg2Angle = Math.sin(phase + sil.phase + Math.PI) * 0.4;
      ctx.beginPath();
      ctx.moveTo(leg2X, size * 0.1);
      ctx.lineTo(leg2X + Math.sin(leg2Angle) * size * 0.3, size * 0.6);
      ctx.lineTo(leg2X + Math.sin(leg2Angle) * size * 0.3 - size * 0.1, size * 0.7);
      ctx.lineTo(leg2X - size * 0.05, size * 0.1);
      ctx.closePath();
      ctx.fill();
    } else if (type === 'viking') {
      // 维京长船剪影：船身 + 帆 + 桅杆
      // 船身
      ctx.beginPath();
      ctx.moveTo(-size * 1.5, 0);
      ctx.quadraticCurveTo(-size * 1.7, size * 0.3, -size * 1.2, size * 0.4);
      ctx.lineTo(size * 1.2, size * 0.4);
      ctx.quadraticCurveTo(size * 1.7, size * 0.3, size * 1.5, 0);
      ctx.lineTo(size * 1.2, -size * 0.1);
      ctx.lineTo(-size * 1.2, -size * 0.1);
      ctx.closePath();
      ctx.fill();

      // 桅杆
      ctx.fillRect(-size * 0.05, -size * 1.4, size * 0.1, size * 1.3);

      // 帆（方形维京帆）
      ctx.fillRect(-size * 0.6, -size * 1.3, size * 1.2, size * 0.9);

      // 盾牌装饰（船舷）
      ctx.fillStyle = shadeColor(color, -30);
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.arc(i * size * 0.4, size * 0.15, size * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (type === 'zombie') {
      // 僵尸剪影：歪头 + 双臂前伸 + 拖腿
      const armSway = Math.sin(phase + sil.phase) * 0.15;

      // 头
      ctx.beginPath();
      ctx.arc(0, -size * 1.4, size * 0.3, 0, Math.PI * 2);
      ctx.fill();

      // 身体
      ctx.fillRect(-size * 0.2, -size * 1.1, size * 0.4, size * 0.9);

      // 双臂前伸（左右歪斜）
      ctx.save();
      ctx.translate(-size * 0.15, -size * 0.9);
      ctx.rotate(-Math.PI / 2 + armSway);
      ctx.fillRect(-size * 0.07, 0, size * 0.14, size * 0.7);
      ctx.restore();

      ctx.save();
      ctx.translate(size * 0.15, -size * 0.9);
      ctx.rotate(-Math.PI / 2 - armSway);
      ctx.fillRect(-size * 0.07, 0, size * 0.14, size * 0.7);
      ctx.restore();

      // 腿（拖步）
      const leg1Angle = Math.sin(phase + sil.phase) * 0.2;
      const leg2Angle = Math.sin(phase + sil.phase + Math.PI) * 0.2;
      ctx.save();
      ctx.translate(-size * 0.15, -size * 0.2);
      ctx.rotate(leg1Angle);
      ctx.fillRect(-size * 0.08, 0, size * 0.16, size * 0.5);
      ctx.restore();
      ctx.save();
      ctx.translate(size * 0.15, -size * 0.2);
      ctx.rotate(leg2Angle);
      ctx.fillRect(-size * 0.08, 0, size * 0.16, size * 0.5);
      ctx.restore();
    } else {
      // firebeast：通用野兽剪影（用于 dst）
      ctx.beginPath();
      ctx.moveTo(-size, 0);
      ctx.lineTo(-size * 0.6, -size * 0.4);
      ctx.lineTo(-size * 0.2, -size * 0.5);
      ctx.lineTo(0, -size * 0.9);
      ctx.lineTo(size * 0.3, -size * 0.5);
      ctx.lineTo(size * 0.6, -size * 0.4);
      ctx.lineTo(size * 0.8, 0);
      ctx.lineTo(size * 0.6, size * 0.1);
      ctx.lineTo(-size * 0.8, size * 0.1);
      ctx.closePath();
      ctx.fill();

      // 火焰眼睛
      ctx.fillStyle = '#ffeb3b';
      ctx.shadowColor = '#ff5722';
      ctx.shadowBlur = size * 0.5;
      ctx.beginPath();
      ctx.arc(-size * 0.15, -size * 0.6, size * 0.05, 0, Math.PI * 2);
      ctx.arc(size * 0.15, -size * 0.6, size * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  };

  // ==========================================================================
  // 生成爆炸粒子（苦力怕用）
  // ==========================================================================
  const spawnExplosionParticles = (cx: number, cy: number, color: string, count: number) => {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
      const speed = 6 + Math.random() * 14;
      particlesRef.current.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 4 + Math.random() * 10,
        life: 600 + Math.random() * 400,
        maxLife: 900,
        alpha: 1,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.3,
        color,
        shape: Math.random() > 0.5 ? 'square' : 'shard',
      });
    }
  };

  // ==========================================================================
  // 初始化虫子群（Factorio 用）
  // ==========================================================================
  const initBugs = (w: number, h: number) => {
    const bugs: Bug[] = [];
    const bugColors = ['#8B4513', '#654321', '#A0522D', '#8B6914', '#556B2F'];

    for (let i = 0; i < 20; i++) {
      const type: 'big' | 'medium' | 'small' =
        Math.random() > 0.7 ? 'big' : Math.random() > 0.4 ? 'medium' : 'small';
      const size =
        type === 'big'
          ? 28 + Math.random() * 12
          : type === 'medium'
            ? 18 + Math.random() * 8
            : 10 + Math.random() * 6;

      bugs.push({
        x: w + Math.random() * w * 0.8,
        y: h * 0.3 + Math.random() * h * 0.5,
        vx: -(6 + Math.random() * 8 + (type === 'big' ? -2 : type === 'small' ? 3 : 0)),
        vy: (Math.random() - 0.5) * 2,
        size,
        legPhase: Math.random() * Math.PI * 2,
        color: bugColors[Math.floor(Math.random() * bugColors.length)],
        type,
      });
    }
    bugsRef.current = bugs;
  };

  // ==========================================================================
  // 初始化黑影群（ark/valheim/zomboid 用）
  // ==========================================================================
  const initSilhouettes = (w: number, h: number, target: GameThemeId) => {
    const silhouettes: Silhouette[] = [];
    let type: Silhouette['type'] = 'dino';
    let color = '#a855f7';
    let count = 6;

    if (target === 'ark') {
      type = 'dino';
      color = '#c084fc';
      count = 5;
    } else if (target === 'valheim') {
      type = 'viking';
      color = '#94a3b8';
      count = 3;
    } else if (target === 'zomboid') {
      type = 'zombie';
      color = '#a3e635';
      count = 10;
    } else {
      type = 'firebeast';
      color = configRef.current.particleColor;
      count = 6;
    }

    for (let i = 0; i < count; i++) {
      const size =
        type === 'viking'
          ? 60 + Math.random() * 40
          : type === 'dino'
            ? 50 + Math.random() * 30
            : 35 + Math.random() * 20;
      silhouettes.push({
        x: w + size * 2 + i * (size * 1.5) + Math.random() * 80,
        y:
          type === 'viking'
            ? h * 0.55 + Math.random() * 20
            : h * 0.6 + Math.random() * 30,
        vx: -(5 + Math.random() * 4 + (type === 'viking' ? 2 : 0)),
        size,
        phase: Math.random() * Math.PI * 2,
        type,
        color,
      });
    }
    silhouettesRef.current = silhouettes;
  };

  // ==========================================================================
  // 主动画循环
  // ==========================================================================
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ==========================================================================
    // 模式: wipe（斜线扫过 + 多色粒子流）— 全面强化
    // ==========================================================================
    const renderWipe = (
      progress: number,
      eased: number,
      w: number,
      h: number,
    ) => {
      const cfg = configRef.current;
      // 调色板：使用主题所有色彩
      const palette = [cfg.primary, cfg.secondary, cfg.accent, cfg.particleColor];
      const diag = Math.sqrt(w * w + h * h);
      const bandWidth = diag * 0.32; // 加宽带宽

      // 1. 背景层：主题色全屏 wash（前 30% 渐入，后 30% 渐出）
      const washAlpha = progress < 0.3 ? progress / 0.3 : progress > 0.7 ? (1 - progress) / 0.3 : 1;
      ctx.fillStyle = hexToRgba(cfg.primary, washAlpha * 0.08);
      ctx.fillRect(0, 0, w, h);

      // 2. 斜线方向
      const angle = Math.PI / 4;
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(angle);

      const startDist = diag * 0.8;
      const endDist = -diag * 0.8;
      const currentDist = startDist + (endDist - startDist) * eased;
      const halfBand = bandWidth / 2;

      // 3. 主光带（多层渐变叠加）
      const bandGradient = ctx.createLinearGradient(0, currentDist - halfBand, 0, currentDist + halfBand);
      bandGradient.addColorStop(0, 'transparent');
      bandGradient.addColorStop(0.2, hexToRgba(cfg.primary, 0.18));
      bandGradient.addColorStop(0.4, hexToRgba(cfg.accent, 0.55));
      bandGradient.addColorStop(0.5, hexToRgba(cfg.accent, 0.85));
      bandGradient.addColorStop(0.6, hexToRgba(cfg.accent, 0.55));
      bandGradient.addColorStop(0.8, hexToRgba(cfg.primary, 0.18));
      bandGradient.addColorStop(1, 'transparent');
      ctx.fillStyle = bandGradient;
      ctx.fillRect(-diag, currentDist - halfBand, diag * 2, bandWidth);

      // 4. 亮线（光带前缘，超亮）
      ctx.strokeStyle = cfg.accent;
      ctx.lineWidth = 3;
      ctx.shadowColor = cfg.accent;
      ctx.shadowBlur = 28;
      ctx.beginPath();
      ctx.moveTo(-diag, currentDist - halfBand * 0.6);
      ctx.lineTo(diag, currentDist - halfBand * 0.6);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 5. 次亮线（光带后缘）
      ctx.strokeStyle = hexToRgba(cfg.primary, 0.6);
      ctx.lineWidth = 1.5;
      ctx.shadowColor = cfg.primary;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(-diag, currentDist + halfBand * 0.4);
      ctx.lineTo(diag, currentDist + halfBand * 0.4);
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.restore();

      // 6. 粒子流（沿斜线后缘持续生成多色粒子，带尾迹）
      if (progress < 0.85) {
        const spawnCount = Math.floor(3 + Math.random() * 4);
        for (let i = 0; i < spawnCount; i++) {
          const t = Math.random();
          const lineX = w + (0 - w) * t;
          const lineY = h + (0 - h) * t;
          const offset = (Math.random() - 0.5) * bandWidth * 0.8;
          const px = lineX + Math.cos(angle + Math.PI / 2) * offset;
          const py = lineY + Math.sin(angle + Math.PI / 2) * offset;

          // 沿斜线方向的速度（朝前缘方向）
          const speedAlong = 2 + Math.random() * 5;
          const speedPerp = (Math.random() - 0.5) * 2;

          particlesRef.current.push({
            x: px,
            y: py,
            vx: Math.cos(angle) * speedAlong + Math.cos(angle + Math.PI / 2) * speedPerp,
            vy: Math.sin(angle) * speedAlong + Math.sin(angle + Math.PI / 2) * speedPerp,
            size: 2 + Math.random() * 5,
            life: 400 + Math.random() * 500,
            maxLife: 800,
            alpha: 0.7 + Math.random() * 0.3,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.2,
            color: palette[Math.floor(Math.random() * palette.length)],
            shape: cfg.particleShape === 'square' ? 'square' : 'circle',
            trail: [],
          });
        }
      }

      // 7. 主题切换瞬间的全屏闪光
      const flashIntensity = flashRef.current;
      if (flashIntensity > 0.01) {
        const flashGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, diag * 0.7);
        flashGrad.addColorStop(0, hexToRgba(cfg.accent, flashIntensity * 0.5));
        flashGrad.addColorStop(0.3, hexToRgba(cfg.primary, flashIntensity * 0.25));
        flashGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = flashGrad;
        ctx.fillRect(0, 0, w, h);
      }
    };

    // ==========================================================================
    // 模式: portal（中心漩涡传送门）— palworld/dyson 用
    // ==========================================================================
    const renderPortal = (
      progress: number,
      w: number,
      h: number,
    ) => {
      const cfg = configRef.current;
      const palette = [cfg.primary, cfg.secondary, cfg.accent, cfg.particleColor];
      const cx = w / 2;
      const cy = h / 2;
      const minDim = Math.min(w, h);

      // 1. 中心径向辉光（持续脉动）
      const pulseRadius = minDim * (0.2 + progress * 0.4);
      const pulseGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseRadius);
      const pulseIntensity = 0.4 + Math.sin(progress * Math.PI * 6) * 0.15;
      pulseGrad.addColorStop(0, hexToRgba(cfg.accent, pulseIntensity * 0.6));
      pulseGrad.addColorStop(0.3, hexToRgba(cfg.primary, pulseIntensity * 0.3));
      pulseGrad.addColorStop(0.7, hexToRgba(cfg.secondary, pulseIntensity * 0.1));
      pulseGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = pulseGrad;
      ctx.fillRect(0, 0, w, h);

      // 2. 旋转环（3 圈，不同方向旋转）
      const ringRotation1 = progress * Math.PI * 4;
      const ringRotation2 = -progress * Math.PI * 3;
      const ringRotation3 = progress * Math.PI * 2;

      const drawRing = (radius: number, rotation: number, color: string, alpha: number, segments: number) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rotation);
        ctx.strokeStyle = hexToRgba(color, alpha);
        ctx.lineWidth = 2;
        ctx.shadowColor = color;
        ctx.shadowBlur = 15;
        for (let i = 0; i < segments; i++) {
          const a1 = (i / segments) * Math.PI * 2;
          const a2 = ((i + 0.6) / segments) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(0, 0, radius, a1, a2);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
        ctx.restore();
      };

      const ringRadiusBase = minDim * 0.15;
      drawRing(ringRadiusBase * 1.0, ringRotation1, cfg.accent, 0.7, 12);
      drawRing(ringRadiusBase * 1.5, ringRotation2, cfg.primary, 0.5, 16);
      drawRing(ringRadiusBase * 2.0, ringRotation3, cfg.secondary, 0.3, 20);

      // 3. 中心核心圆（commit 瞬间最大）
      const coreSize = (minDim * 0.08) * (1 + flashRef.current * 2);
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreSize);
      coreGrad.addColorStop(0, hexToRgba(cfg.accent, 0.9));
      coreGrad.addColorStop(0.5, hexToRgba(cfg.primary, 0.6));
      coreGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = coreGrad;
      ctx.fillRect(0, 0, w, h);

      // 4. 粒子轨迹
      // 阶段 1（0-50%）：粒子从屏幕边缘向中心螺旋汇聚
      // 阶段 2（50-100%）：粒子从中心向外爆发
      const isInward = progress < 0.5;
      if (progress < 0.85) {
        const spawnCount = Math.floor(3 + Math.random() * 3);
        for (let i = 0; i < spawnCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = isInward ? minDim * (0.4 + Math.random() * 0.3) : 0;
          const px = cx + Math.cos(angle) * dist;
          const py = cy + Math.sin(angle) * dist;

          // 切向速度（旋转效果）
          const tangentialSpeed = (isInward ? 1 : -1) * (1 + Math.random() * 2);
          // 径向速度
          const radialSpeed = isInward ? -(3 + Math.random() * 4) : (4 + Math.random() * 6);

          const vx = Math.cos(angle + Math.PI / 2) * tangentialSpeed + Math.cos(angle) * radialSpeed;
          const vy = Math.sin(angle + Math.PI / 2) * tangentialSpeed + Math.sin(angle) * radialSpeed;

          particlesRef.current.push({
            x: px,
            y: py,
            vx,
            vy,
            size: 2 + Math.random() * 4,
            life: 500 + Math.random() * 400,
            maxLife: 800,
            alpha: 0.6 + Math.random() * 0.4,
            rotation: angle,
            rotationSpeed: (Math.random() - 0.5) * 0.15,
            color: palette[Math.floor(Math.random() * palette.length)],
            shape: 'circle',
            trail: [],
          });
        }
      }

      // 5. 闪光（commit 瞬间）
      if (flashRef.current > 0.01) {
        const flashGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, minDim);
        flashGrad.addColorStop(0, hexToRgba(cfg.accent, flashRef.current * 0.7));
        flashGrad.addColorStop(0.3, hexToRgba(cfg.primary, flashRef.current * 0.3));
        flashGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = flashGrad;
        ctx.fillRect(0, 0, w, h);
      }
    };

    // ==========================================================================
    // 模式: stampede（黑影群横向奔袭）— ark/valheim/zomboid 用
    // ==========================================================================
    const renderStampede = (
      progress: number,
      w: number,
      h: number,
    ) => {
      const cfg = configRef.current;

      // 1. 背景渐变 wash
      const washAlpha = progress < 0.3 ? progress / 0.3 : progress > 0.7 ? (1 - progress) / 0.3 : 1;
      const washGrad = ctx.createLinearGradient(0, 0, w, 0);
      washGrad.addColorStop(0, hexToRgba(cfg.primary, washAlpha * 0.05));
      washGrad.addColorStop(0.5, hexToRgba(cfg.accent, washAlpha * 0.1));
      washGrad.addColorStop(1, hexToRgba(cfg.primary, washAlpha * 0.05));
      ctx.fillStyle = washGrad;
      ctx.fillRect(0, 0, w, h);

      // 2. 屏幕震动（commit 前后）
      const shakeIntensity = Math.max(0, 1 - Math.abs(progress - 0.5) * 4) * 4;
      const shakeX = (Math.random() - 0.5) * shakeIntensity;
      const shakeY = (Math.random() - 0.5) * shakeIntensity;

      ctx.save();
      ctx.translate(shakeX, shakeY);

      // 3. 更新和绘制黑影
      const phase = progress * 10;
      const silhouettes = silhouettesRef.current;
      for (const sil of silhouettes) {
        sil.x += sil.vx;
        sil.phase += 0.15;

        // 进入/离开屏幕的渐入渐出
        let alpha = 1;
        if (sil.x > w - sil.size * 2) {
          alpha = (w + sil.size * 2 - sil.x) / (sil.size * 2);
        }
        if (sil.x < sil.size * 2) {
          alpha = (sil.x + sil.size * 0.5) / (sil.size * 2);
        }
        alpha = Math.max(0, Math.min(1, alpha)) * 0.85;

        ctx.globalAlpha = alpha;
        drawSilhouette(ctx, sil, phase);
        ctx.globalAlpha = 1;

        // 4. 尘土轨迹（黑影后方）
        if (sil.x > 0 && sil.x < w && Math.random() > 0.4) {
          particlesRef.current.push({
            x: sil.x + sil.size * 0.8,
            y: sil.y + sil.size * 0.6,
            vx: -1 + (Math.random() - 0.5) * 2,
            vy: -1 - Math.random() * 2,
            size: 2 + Math.random() * 4,
            life: 300 + Math.random() * 300,
            maxLife: 600,
            alpha: 0.4 + Math.random() * 0.3,
            rotation: 0,
            rotationSpeed: 0,
            color: hexToRgba(cfg.particleColor, 0.6),
            shape: 'circle',
          });
        }
      }

      ctx.restore();

      // 5. 主题切换闪光
      if (flashRef.current > 0.01) {
        const flashGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h));
        flashGrad.addColorStop(0, hexToRgba(cfg.accent, flashRef.current * 0.4));
        flashGrad.addColorStop(0.5, hexToRgba(cfg.primary, flashRef.current * 0.15));
        flashGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = flashGrad;
        ctx.fillRect(0, 0, w, h);
      }
    };

    // ==========================================================================
    // 模式: embers（飘动火星 + 主题色辉光）— dst/enshrouded/terraria 用
    // ==========================================================================
    const renderEmbers = (
      progress: number,
      w: number,
      h: number,
    ) => {
      const cfg = configRef.current;
      const palette = [cfg.primary, cfg.secondary, cfg.accent, cfg.particleColor];

      // 1. 全屏暗色雾化（让火星更突出）
      const darkAlpha = progress < 0.3 ? progress / 0.3 : progress > 0.7 ? (1 - progress) / 0.3 : 1;
      ctx.fillStyle = `rgba(0, 0, 0, ${darkAlpha * 0.25})`;
      ctx.fillRect(0, 0, w, h);

      // 2. 主题色全屏径向辉光（脉动）
      const pulse = 0.5 + Math.sin(progress * Math.PI * 4) * 0.2;
      const glowGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6);
      glowGrad.addColorStop(0, hexToRgba(cfg.accent, darkAlpha * pulse * 0.25));
      glowGrad.addColorStop(0.4, hexToRgba(cfg.primary, darkAlpha * pulse * 0.12));
      glowGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, w, h);

      // 3. 持续生成火星（向上飘动，带尾迹）
      if (progress < 0.9) {
        const spawnCount = Math.floor(2 + Math.random() * 3);
        for (let i = 0; i < spawnCount; i++) {
          const px = Math.random() * w;
          const py = h + 10;

          particlesRef.current.push({
            x: px,
            y: py,
            vx: (Math.random() - 0.5) * 1.5,
            vy: -(2 + Math.random() * 4),
            size: 1.5 + Math.random() * 3.5,
            life: 1000 + Math.random() * 800,
            maxLife: 1500,
            alpha: 0.7 + Math.random() * 0.3,
            rotation: 0,
            rotationSpeed: (Math.random() - 0.5) * 0.1,
            color: palette[Math.floor(Math.random() * palette.length)],
            shape: 'spark',
            trail: [],
          });
        }
      }

      // 4. 中心装饰圆（commit 瞬间放大）
      if (progress > 0.3) {
        const centerProgress = (progress - 0.3) / 0.7;
        const radius = Math.max(0.1, 30 + centerProgress * 200 + flashRef.current * 100);
        const ringGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, radius);
        ringGrad.addColorStop(0, hexToRgba(cfg.accent, 0.4 * (1 - centerProgress * 0.5)));
        ringGrad.addColorStop(0.6, hexToRgba(cfg.primary, 0.2 * (1 - centerProgress * 0.5)));
        ringGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = ringGrad;
        ctx.fillRect(0, 0, w, h);
      }

      // 5. 闪光
      if (flashRef.current > 0.01) {
        const flashGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h));
        flashGrad.addColorStop(0, hexToRgba(cfg.accent, flashRef.current * 0.6));
        flashGrad.addColorStop(0.4, hexToRgba(cfg.primary, flashRef.current * 0.25));
        flashGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = flashGrad;
        ctx.fillRect(0, 0, w, h);
      }
    };

    // ==========================================================================
    // 模式: creeper（保持原有实现）
    // ==========================================================================
    const renderCreeper = (progress: number, w: number, h: number) => {
      const creeper = creeperRef.current;
      if (!creeper) return;

      // 阶段 1 (0~40%): 苦力怕从右下角走入屏幕中央
      if (progress < 0.4) {
        const walkP = progress / 0.4;
        creeper.walkProgress = walkP;
        const startX = w + 80;
        const startY = h + 60;
        const endX = w / 2;
        const endY = h / 2;
        const t = easeOutQuart(walkP);
        creeper.x = startX + (endX - startX) * t;
        creeper.y = startY + (endY - startY) * t;
        creeper.scale = 6 + walkP * 4;
        const bob = Math.sin(walkP * Math.PI * 8) * 3;
        creeper.y += bob;
        drawCreeper(ctx, creeper.x, creeper.y, creeper.scale, 0);
      }
      // 阶段 2 (40%~50%): 闪白蓄力
      else if (progress < 0.5) {
        const flashP = (progress - 0.4) / 0.1;
        const flashIntensity = Math.sin(flashP * Math.PI * 6) * 0.5 + 0.5;
        creeper.flashIntensity = flashIntensity;
        const pulse = 1 + flashP * 0.15;
        drawCreeper(ctx, creeper.x, creeper.y, creeper.scale * pulse, flashIntensity);
      }
      // 阶段 3 (50%~100%): 爆炸 + 粒子扩散
      else {
        if (!creeper.exploded) {
          creeper.exploded = true;
          spawnExplosionParticles(creeper.x, creeper.y, '#22c55e', 80);
          spawnExplosionParticles(creeper.x, creeper.y, '#4ade80', 40);
          spawnExplosionParticles(creeper.x, creeper.y, '#ffffff', 20);
        }
        const explodeP = (progress - 0.5) / 0.5;
        if (explodeP < 0.3) {
          const flashAlpha = 1 - explodeP / 0.3;
          const flashR = Math.max(0.1, 50 + explodeP * 400);
          const grad = ctx.createRadialGradient(creeper.x, creeper.y, 0, creeper.x, creeper.y, flashR);
          grad.addColorStop(0, `rgba(255, 255, 200, ${flashAlpha})`);
          grad.addColorStop(0.3, `rgba(34, 197, 94, ${flashAlpha * 0.8})`);
          grad.addColorStop(0.6, `rgba(34, 197, 94, ${flashAlpha * 0.3})`);
          grad.addColorStop(1, 'transparent');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, w, h);
        }
        if (explodeP < 0.5) {
          const ringR = Math.max(0.1, 20 + explodeP * Math.max(w, h));
          const ringAlpha = 1 - explodeP / 0.5;
          ctx.strokeStyle = `rgba(74, 222, 128, ${ringAlpha * 0.6})`;
          ctx.lineWidth = 4 + (1 - explodeP / 0.5) * 8;
          ctx.beginPath();
          ctx.arc(creeper.x, creeper.y, ringR, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    };

    // ==========================================================================
    // 模式: bugs（保持原有实现）
    // ==========================================================================
    const renderBugs = (progress: number, w: number, h: number) => {
      const bugs = bugsRef.current;
      const phase = progress * 8;
      for (const bug of bugs) {
        bug.x += bug.vx;
        bug.y += bug.vy + Math.sin(phase + bug.legPhase) * 0.5;
        bug.legPhase += 0.3;
      }
      const sortedBugs = [...bugs].sort((a, b) => a.size - b.size);
      for (const bug of sortedBugs) {
        if (bug.x < -bug.size * 3 || bug.x > w + bug.size * 3) continue;
        let alpha = 1;
        if (bug.x > w - bug.size * 2) {
          alpha = (w - bug.x) / (bug.size * 2);
        }
        if (bug.x < bug.size * 2) {
          alpha = bug.x / (bug.size * 2);
        }
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        drawBug(ctx, bug, phase);
        ctx.globalAlpha = 1;
      }
      if (progress > 0.3 && progress < 0.7) {
        const glowP = progress < 0.5 ? (progress - 0.3) / 0.2 : 1 - (progress - 0.5) / 0.2;
        ctx.fillStyle = `rgba(249, 115, 22, ${glowP * 0.12})`;
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 15; i++) {
          const dustX = Math.random() * w;
          const dustY = h * 0.6 + Math.random() * h * 0.35;
          const dustSize = 2 + Math.random() * 4;
          ctx.fillStyle = `rgba(210, 180, 140, ${glowP * 0.6 * Math.random()})`;
          ctx.beginPath();
          ctx.arc(dustX, dustY, dustSize, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    // ==========================================================================
    // 粒子更新 + 绘制（统一处理所有模式的粒子，含尾迹）
    // ==========================================================================
    const updateAndDrawParticles = (progress: number, w: number, h: number) => {
      const fadeStart = 0.55;
      const cfg = configRef.current;

      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.vy += 0.04; // 轻微重力
        p.vx *= 0.995;
        p.vy *= 0.995;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 16;
        p.rotation += p.rotationSpeed;

        // 尾迹更新
        if (p.trail) {
          p.trail.unshift({ x: p.x, y: p.y, alpha: p.alpha });
          if (p.trail.length > 6) p.trail.pop();
        }

        let alpha = p.alpha;
        if (progress > fadeStart) {
          alpha *= 1 - (progress - fadeStart) / (1 - fadeStart);
        }
        alpha *= Math.max(0, p.life / p.maxLife);

        if (p.life <= 0 || alpha <= 0.01 || p.x < -100 || p.x > w + 100 || p.y > h + 100) {
          particlesRef.current.splice(i, 1);
          continue;
        }

        // 绘制尾迹
        if (p.trail && p.trail.length > 1) {
          ctx.save();
          ctx.strokeStyle = p.color;
          ctx.lineCap = 'round';
          ctx.lineWidth = Math.max(0.5, p.size * 0.5);
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          for (let j = 0; j < p.trail.length; j++) {
            const t = p.trail[j];
            ctx.lineTo(t.x, t.y);
          }
          ctx.globalAlpha = alpha * 0.4;
          ctx.stroke();
          ctx.restore();
        }

        // 绘制粒子本体
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12;

        if (p.shape === 'square') {
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        } else if (p.shape === 'shard') {
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.beginPath();
          ctx.moveTo(0, -p.size / 2);
          ctx.lineTo(p.size / 2, p.size / 2);
          ctx.lineTo(-p.size / 2, p.size / 2);
          ctx.closePath();
          ctx.fill();
        } else if (p.shape === 'spark') {
          // 火星：拉长的椭圆 + 强发光
          ctx.translate(p.x, p.y);
          const angle = Math.atan2(p.vy, p.vx);
          ctx.rotate(angle);
          ctx.shadowBlur = 18;
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size * 2, p.size * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.shape === 'star') {
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.beginPath();
          for (let j = 0; j < 5; j++) {
            const a = (j / 5) * Math.PI * 2 - Math.PI / 2;
            const x = Math.cos(a) * p.size;
            const y = Math.sin(a) * p.size;
            if (j === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            const innerA = a + Math.PI / 5;
            ctx.lineTo(Math.cos(innerA) * p.size * 0.4, Math.sin(innerA) * p.size * 0.4);
          }
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // 粒子连线（对相近的粒子绘制连接线，营造星图感）
      const particles = particlesRef.current;
      if (particles.length < 30) return; // 粒子太少不画连线
      const maxDist = 80;
      const maxLines = 40;
      let linesDrawn = 0;
      ctx.save();
      ctx.lineWidth = 0.5;
      for (let i = 0; i < particles.length && linesDrawn < maxLines; i++) {
        for (let j = i + 1; j < particles.length && linesDrawn < maxLines; j++) {
          const p1 = particles[i];
          const p2 = particles[j];
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < maxDist) {
            const lineAlpha = (1 - dist / maxDist) * 0.3 * (p1.alpha + p2.alpha) * 0.5;
            ctx.strokeStyle = hexToRgba(cfg.accent, lineAlpha);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
            linesDrawn++;
          }
        }
      }
      ctx.restore();
    };

    // ==========================================================================
    // 主帧函数
    // ==========================================================================
    const animate = (ts: number) => {
      if (!startTimeRef.current) startTimeRef.current = ts;
      const elapsed = ts - startTimeRef.current;
      const progress = Math.min(elapsed / TOTAL_DURATION, 1);
      const eased = easeInOutCubic(progress);

      // 50% 时刻提交主题切换 + 触发闪光
      if (!committedRef.current && elapsed >= COMMIT_AT) {
        committedRef.current = true;
        flashRef.current = 1.0; // 触发闪光
        const commit = (window as unknown as { __gspThemeCommit?: () => void }).__gspThemeCommit;
        if (commit) commit();
      }

      // 闪光衰减
      if (flashRef.current > 0) {
        flashRef.current = Math.max(0, flashRef.current - 0.04);
      }

      const w = window.innerWidth;
      const h = window.innerHeight;

      // 拖尾效果：用半透明黑色覆盖代替完全清空（产生运动模糊感）
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
      ctx.fillRect(0, 0, w, h);

      const mode = modeRef.current;

      // 渲染对应模式
      if (mode === 'wipe') renderWipe(progress, eased, w, h);
      else if (mode === 'creeper') renderCreeper(progress, w, h);
      else if (mode === 'bugs') renderBugs(progress, w, h);
      else if (mode === 'portal') renderPortal(progress, w, h);
      else if (mode === 'stampede') renderStampede(progress, w, h);
      else if (mode === 'embers') renderEmbers(progress, w, h);

      // 统一渲染粒子（所有模式共用）
      updateAndDrawParticles(progress, w, h);

      // 结束
      if (progress >= 1 && particlesRef.current.length === 0) {
        cancelAnimationFrame(rafRef.current);
        ctx.clearRect(0, 0, w, h);
        startTimeRef.current = 0; // 重置，允许下一次转场正常初始化
        const finish = (window as unknown as { __gspThemeFinish?: () => void }).__gspThemeFinish;
        if (finish) finish();
        return;
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    if (isTransitioning) {
      // 防御：若动画已在运行中（startTimeRef 已被 animate 设为时间戳 > 0），
      // 说明本次 effect 执行是因为依赖变化的 re-run，cleanup 已取消 rAF，
      // 这里仅续接 rAF，不重置 particles/creeper/startTime，避免重复爆炸。
      if (startTimeRef.current > 0) {
        rafRef.current = requestAnimationFrame(animate);
        return;
      }

      transitionKeyRef.current++;
      const currentKey = transitionKeyRef.current;
      particlesRef.current = [];
      startTimeRef.current = 0;
      committedRef.current = false;
      flashRef.current = 0;

      const target = pendingTheme || theme;
      const mode = getModeForTheme(target);
      modeRef.current = mode;

      const w = window.innerWidth;
      const h = window.innerHeight;

      if (mode === 'creeper') {
        creeperRef.current = {
          x: w + 80,
          y: h + 60,
          targetX: w / 2,
          targetY: h / 2,
          walkProgress: 0,
          scale: 6,
          exploded: false,
          flashIntensity: 0,
        };
        bugsRef.current = [];
        silhouettesRef.current = [];
      } else if (mode === 'bugs') {
        creeperRef.current = null;
        initBugs(w, h);
        silhouettesRef.current = [];
      } else if (mode === 'stampede') {
        creeperRef.current = null;
        bugsRef.current = [];
        initSilhouettes(w, h, target);
      } else {
        creeperRef.current = null;
        bugsRef.current = [];
        silhouettesRef.current = [];
      }

      // 初始填充黑色（避免第一帧出现透明覆盖问题）
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      ctx.fillRect(0, 0, w, h);
      // 然后立刻清空（保留拖尾效果从第二帧开始）
      ctx.clearRect(0, 0, w, h);

      if (reducedMotion) {
        const commit = (window as unknown as { __gspThemeCommit?: () => void }).__gspThemeCommit;
        if (commit) commit();
        setTimeout(() => {
          if (currentKey !== transitionKeyRef.current) return;
          const finish = (window as unknown as { __gspThemeFinish?: () => void }).__gspThemeFinish;
          if (finish) finish();
        }, 150);
      } else {
        rafRef.current = requestAnimationFrame(animate);
      }
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
    // 注意：不在依赖数组中包含 theme/config——转场动画只能由 isTransitioning/pendingTheme 触发。
    // theme 在 finishTransition 中与 setIsTransitioning(false) 一起变更时，configRef.current
    // 已同步更新（configRef.current = config 在组件体顶部每帧执行），不需要重跑 effect。
  }, [isTransitioning, pendingTheme]);

  if (!isTransitioning) return null;

  return (
    <canvas
      ref={canvasRef}
      className="landing-particle-transition"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    />
  );
}
