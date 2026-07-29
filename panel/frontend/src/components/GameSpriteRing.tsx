// ============================================================================
// GameSpriteRing — 游戏卡片 3D 旋转圆环环绕动效
// 鼠标悬停时触发 8 张游戏 sprite 以圆环形式绕卡片旋转
// 纯 CSS 3D transform，走 GPU compositor，不影响主线程
// ============================================================================

import { useEffect, useState } from 'react';

interface GameSpriteRingProps {
  /** 游戏 sprite 图片路径数组（支持 1~8 张，不足时循环复用） */
  sprites: string[];
  /** 主题色，用于辉光 */
  color: string;
  /** 是否激活旋转 */
  active: boolean;
}

const RING_RADIUS = 130; // 圆环半径 (px)
const SPRITE_SIZE = 48; // 每个 sprite 尺寸 (px)
const RING_SIZE = (RING_RADIUS + SPRITE_SIZE / 2) * 2; // 圆环容器尺寸

export default function GameSpriteRing({ sprites, color, active }: GameSpriteRingProps) {
  const [reduced, setReduced] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    setMounted(true);
  }, []);

  // 不足 8 张时循环复用，刚好 8 张时直接使用
  const slots = Array.from({ length: 8 }, (_, i) => {
    if (sprites.length === 0) return null;
    return sprites[i % sprites.length];
  });

  if (!mounted) return null;

  return (
    <div
      className={`game-sprite-ring${active ? ' game-sprite-ring-active' : ''}${reduced ? ' game-sprite-ring-reduced' : ''}`}
      style={{
        position: 'absolute',
        inset: -(RING_SIZE - 200) / 2, // 居中覆盖卡片区域
        perspective: '600px',
        pointerEvents: 'none',
        zIndex: 1,
      }}
      aria-hidden="true"
    >
      {/* 3D 场景层 */}
      <div
        className="game-sprite-ring-scene"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: RING_SIZE,
          height: RING_SIZE,
          marginTop: -RING_SIZE / 2,
          marginLeft: -RING_SIZE / 2,
          transformStyle: 'preserve-3d',
        }}
      >
        {/* 辉光环 */}
        <div
          className="game-sprite-ring-glow"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: RING_RADIUS * 2,
            height: RING_RADIUS * 2,
            marginTop: -RING_RADIUS,
            marginLeft: -RING_RADIUS,
            borderRadius: '50%',
            border: `1px solid ${color}22`,
            boxShadow: active
              ? `0 0 30px ${color}33, 0 0 60px ${color}15, inset 0 0 30px ${color}10`
              : 'none',
            transform: 'rotateX(75deg)',
            transition: 'box-shadow 0.4s ease',
          }}
        />

        {/* 8 个 sprite 位置 */}
        {slots.map((sprite, i) => {
          if (!sprite) return null;
          const angle = (i / slots.length) * 360;
          const delay = i * 0.05;

          return (
            <div
              key={i}
              className="game-sprite-ring-item"
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: SPRITE_SIZE,
                height: SPRITE_SIZE,
                marginTop: -SPRITE_SIZE / 2,
                marginLeft: -SPRITE_SIZE / 2,
                transform: `rotateY(${angle}deg) translateZ(${RING_RADIUS}px)`,
                // 每个 sprite 还绕自身中心微旋转以面向观察者
                borderRadius: '8px',
                overflow: 'hidden',
                background: `${color}15`,
                border: `1px solid ${color}30`,
                transition: `border-color 0.3s, background 0.3s ${delay}s`,
                animation: active
                  ? `sprite-float 2s ease-in-out ${delay}s infinite`
                  : 'none',
              }}
            >
              <img
                src={sprite}
                alt=""
                loading="lazy"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  imageRendering: sprites[0]?.includes('minecraft') || sprites[0]?.includes('terraria') ? 'pixelated' : 'auto',
                }}
                draggable={false}
              />
            </div>
          );
        })}
      </div>

      {/* CSS 注入 */}
      <style>{`
        .game-sprite-ring-scene {
          animation: ${active ? 'ring-spin 8s linear infinite' : 'none'};
        }
        .game-sprite-ring-reduced .game-sprite-ring-scene {
          animation: none !important;
        }
        .game-sprite-ring-reduced .game-sprite-ring-item {
          animation: none !important;
        }
        @keyframes ring-spin {
          from { transform: rotateY(0deg); }
          to { transform: rotateY(360deg); }
        }
        @keyframes sprite-float {
          0%, 100% { transform: rotateY(var(--a, 0deg)) translateZ(${RING_RADIUS}px) translateY(0px); }
          50% { transform: rotateY(var(--a, 0deg)) translateZ(${RING_RADIUS}px) translateY(-6px); }
        }
      `}</style>
    </div>
  );
}
