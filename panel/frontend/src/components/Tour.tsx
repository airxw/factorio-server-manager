// ============================================================================
// Tour — 新手引导高亮巡游组件（十.4）
// 通过 CSS 选择器定位目标元素，用大范围 box-shadow 制造聚光灯遮罩
// 上一步 / 下一步 / 跳过 三按钮控制；目标位置实时跟随滚动与缩放
// ============================================================================

import { useEffect, useLayoutEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { TourStep } from '../hooks/useTour';

interface TourProps {
  /** 是否处于激活态 */
  isActive: boolean;
  /** 引导步骤 */
  steps: TourStep[];
  /** 关闭并标记完成 */
  onClose: () => void;
}

/** 目标元素相对视口的高亮矩形 */
interface SpotRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 6;
const Z_INDEX = 3000;

export default function Tour({ isActive, steps, onClose }: TourProps) {
  const [current, setCurrent] = useState(0);
  const [rect, setRect] = useState<SpotRect | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);

  const step = steps[current];
  const isLast = current === steps.length - 1;

  // 重新计算当前步骤目标元素的高亮矩形
  const updateRect = () => {
    if (!isActive || !step) {
      setRect(null);
      return;
    }
    const el = document.querySelector(step.target) as HTMLElement | null;
    if (!el) {
      setTargetMissing(true);
      setRect(null);
      return;
    }
    setTargetMissing(false);
    const r = el.getBoundingClientRect();
    setRect({
      top: r.top - PADDING,
      left: r.left - PADDING,
      width: r.width + PADDING * 2,
      height: r.height + PADDING * 2,
    });
  };

  // 步骤切换时重置并重新测量
  useLayoutEffect(() => {
    if (!isActive) return;
    setCurrent(0);
    updateRect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  // 当前步骤变化时重新测量
  useEffect(() => {
    if (!isActive) return;
    updateRect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, isActive]);

  // 滚动 / 缩放时实时跟随
  useEffect(() => {
    if (!isActive) return;
    const handler = () => updateRect();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, current]);

  // Esc 跳过引导
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight' && !isLast) {
        setCurrent((c) => Math.min(c + 1, steps.length - 1));
      } else if (e.key === 'ArrowLeft' && current > 0) {
        setCurrent((c) => Math.max(c - 1, 0));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isActive, isLast, current, steps.length, onClose]);

  if (!isActive || !step) return null;

  const handleNext = () => {
    if (isLast) {
      onClose();
    } else {
      setCurrent((c) => Math.min(c + 1, steps.length - 1));
    }
  };

  const handlePrev = () => {
    setCurrent((c) => Math.max(c - 1, 0));
  };

  // 工具提示定位：默认置于高亮区下方，空间不足时置于上方
  // 3.3.4: 防御性处理——目标占满视口高度时（>75vh）改为视口居中，避免 tooltip 飞到屏幕外
  const tooltipStyle: React.CSSProperties = rect
    ? (() => {
        const targetTooTall = rect.height > window.innerHeight * 0.75;
        if (targetTooTall) {
          // 目标太高（如整列侧边栏），tooltip 居中显示
          return {
            top: window.innerHeight / 2,
            left: window.innerWidth / 2,
            transform: 'translate(-50%, -50%)',
          };
        }
        const belowSpace = window.innerHeight - (rect.top + rect.height);
        const placeBelow = belowSpace >= 220 || rect.top < 220;
        const top = placeBelow ? rect.top + rect.height + 12 : rect.top - 12;
        return {
          top,
          left: Math.max(12, Math.min(rect.left, window.innerWidth - 312)),
          transform: placeBelow ? 'none' : 'translateY(-100%)',
        };
      })()
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <div
      className="tour-root"
      role="dialog"
      aria-modal="true"
      aria-label="新手引导"
      style={{ zIndex: Z_INDEX }}
    >
      {/* 聚光灯遮罩：透明矩形 + 超大 box-shadow 制造暗色蒙版 */}
      {rect && (
        <div
          className="tour-spotlight"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.55)',
          }}
        />
      )}

      {/* 目标元素缺失时的全屏蒙版兜底 */}
      {!rect && <div className="tour-fullmask" />}

      {/* 工具提示卡片 */}
      <div className="tour-tooltip" style={tooltipStyle}>
        <div className="tour-tooltip-header">
          <span className="tour-step-indicator">
            {current + 1} / {steps.length}
          </span>
          <button
            type="button"
            className="tour-close"
            onClick={onClose}
            aria-label="跳过引导"
          >
            <X size={16} />
          </button>
        </div>
        <h4 className="tour-title">{step.title}</h4>
        <p className="tour-content">{step.content}</p>
        {targetMissing && (
          <p className="tour-missing">未找到目标元素，可点击下一步继续。</p>
        )}
        <div className="tour-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
          >
            跳过
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handlePrev}
              disabled={current === 0}
            >
              <ChevronLeft size={14} />
              上一步
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleNext}
            >
              {isLast ? '完成' : '下一步'}
              {!isLast && <ChevronRight size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
