// ============================================================================
// useSwipe — 移动端滑动手势 hook
// 9.6: 监听 touchstart / touchend，计算水平位移，超过阈值时触发左右滑动回调
// 用法：
//   const ref = useSwipe({ onSwipeLeft: () => ..., onSwipeRight: () => ... });
//   <div ref={ref}>...</div>
// 通过 ref 回调把监听器绑定到目标元素，optionsRef 保证回调始终读取最新值
// ============================================================================

import { useEffect, useRef, useState } from 'react';

export interface SwipeOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** 触发滑动的最小水平距离（px），默认 50 */
  threshold?: number;
}

export function useSwipe(options: SwipeOptions): (element: HTMLElement | null) => void {
  // 用 ref 保存最新的回调与阈值，避免每次渲染重新绑定监听器
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // 记录触摸起点，touchend 时计算位移
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);

  // 用 state 承载目标元素，元素挂载/卸载时触发 effect 绑定/解绑
  const [element, setElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!element) return;

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      startXRef.current = touch.clientX;
      startYRef.current = touch.clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const startX = startXRef.current;
      const startY = startYRef.current;
      if (startX === null || startY === null) return;
      startXRef.current = null;
      startYRef.current = null;

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      const { threshold = 50, onSwipeLeft, onSwipeRight } = optionsRef.current;

      // 水平滑动需超过阈值，且水平分量大于垂直分量（避免与纵向滚动冲突）
      if (Math.abs(deltaX) < threshold) return;
      if (Math.abs(deltaX) < Math.abs(deltaY)) return;

      if (deltaX < 0) {
        onSwipeLeft?.();
      } else {
        onSwipeRight?.();
      }
    };

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [element]);

  // 返回 ref 回调，供调用方附加到目标元素
  return setElement;
}
