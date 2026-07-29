// ============================================================================
// ParticleTransition — 全屏 Canvas 粒子转场组件
// 从右下角喷射粒子 → 铺满屏幕 → 渐隐退去
// 中间 45% 时刻触发主题切换（commitTheme）
// ============================================================================

import { useEffect, useRef } from 'react';
import { useGameTheme } from '../context/GameThemeContext';

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
}

export default function ParticleTransition() {
  const { isTransitioning, config, theme } = useGameTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const startTimeRef = useRef<number>(0);
  const committedRef = useRef(false);
  const shapeRef = useRef<'square' | 'circle'>('circle');
  const colorRef = useRef('#22d3ee');
  const transitionKeyRef = useRef(0);

  const TOTAL_DURATION = 1100;
  const COMMIT_AT = 450;
  const PARTICLE_COUNT = 150;

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

    // 检测 prefers-reduced-motion
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const spawnParticles = (count: number) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const startX = w + 40;
      const startY = h + 40;
      const color = colorRef.current;
      const shape = shapeRef.current;

      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.3) * Math.PI * 1.2;
        const speed = 4 + Math.random() * 10;
        const maxLife = 800 + Math.random() * 600;
        particlesRef.current.push({
          x: startX - Math.random() * 80,
          y: startY - Math.random() * 80,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2,
          size: shape === 'square' ? 4 + Math.random() * 8 : 3 + Math.random() * 6,
          life: maxLife,
          maxLife,
          alpha: 0.7 + Math.random() * 0.3,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.15,
          color,
        });
      }
    };

    const animate = (ts: number) => {
      if (!startTimeRef.current) startTimeRef.current = ts;
      const elapsed = ts - startTimeRef.current;
      const progress = Math.min(elapsed / TOTAL_DURATION, 1);

      // 45% 时刻提交主题切换
      if (!committedRef.current && elapsed >= COMMIT_AT) {
        committedRef.current = true;
        const commit = (window as unknown as { __gspThemeCommit?: () => void }).__gspThemeCommit;
        if (commit) commit();
      }

      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);

      // 喷射阶段（0-35%）：持续生成粒子
      if (progress < 0.35 && particlesRef.current.length < PARTICLE_COUNT * 1.5) {
        const spawnBatch = Math.ceil((PARTICLE_COUNT * 0.35) / 20);
        spawnParticles(spawnBatch);
      }

      // 更新 + 绘制粒子
      const gravity = 0.08;
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.vy += gravity;
        p.vx *= 0.995;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 16;
        p.rotation += p.rotationSpeed;

        // 渐隐：后半段开始淡出
        const fadeStart = 0.55;
        let alpha = p.alpha;
        if (progress > fadeStart) {
          alpha *= 1 - (progress - fadeStart) / (1 - fadeStart);
        }
        // 生命自然衰减
        alpha *= Math.max(0, p.life / p.maxLife);

        if (p.life <= 0 || alpha <= 0.01) {
          particlesRef.current.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;

        if (shapeRef.current === 'square') {
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // 背景漫反射光晕：右下角扩散的光
      if (progress > 0.1 && progress < 0.9) {
        const glowProgress = progress < 0.5 ? progress / 0.5 : 1 - (progress - 0.5) / 0.5;
        const glowRadius = Math.min(w, h) * (0.3 + progress * 0.8);
        const gradient = ctx.createRadialGradient(w, h, 0, w, h, glowRadius);
        gradient.addColorStop(0, colorRef.current + Math.floor(glowProgress * 35).toString(16).padStart(2, '0'));
        gradient.addColorStop(0.4, colorRef.current + Math.floor(glowProgress * 15).toString(16).padStart(2, '0'));
        gradient.addColorStop(1, colorRef.current + '00');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
      }

      // 结束
      if (progress >= 1 && particlesRef.current.length === 0) {
        cancelAnimationFrame(rafRef.current);
        ctx.clearRect(0, 0, w, h);
        const finish = (window as unknown as { __gspThemeFinish?: () => void }).__gspThemeFinish;
        if (finish) finish();
        return;
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    if (isTransitioning) {
      transitionKeyRef.current++;
      const currentKey = transitionKeyRef.current;
      shapeRef.current = config.particleShape;
      colorRef.current = config.particleColor;
      particlesRef.current = [];
      startTimeRef.current = 0;
      committedRef.current = false;

      if (reducedMotion) {
        // 降级：直接切换，无动画
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
  }, [isTransitioning, config, theme]);

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
