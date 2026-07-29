// ============================================================================
// useTour — 新手引导 Tour 状态管理（十.4）
// 通过 localStorage 记录引导完成状态，仅首次访问自动触发
// tourId 区分不同页面的引导，各自独立记录完成态
// ============================================================================

import { useCallback, useEffect, useState } from 'react';

export interface TourStep {
  /** 目标元素 CSS 选择器 */
  target: string;
  /** 步骤标题 */
  title: string;
  /** 步骤说明 */
  content: string;
}

function completedKey(tourId: string): string {
  return `tour_completed_${tourId}`;
}

function readCompleted(tourId: string): boolean {
  try {
    return localStorage.getItem(completedKey(tourId)) === '1';
  } catch {
    return false;
  }
}

function writeCompleted(tourId: string): void {
  try {
    localStorage.setItem(completedKey(tourId), '1');
  } catch {
    // ignore
  }
}

function clearCompleted(tourId: string): void {
  try {
    localStorage.removeItem(completedKey(tourId));
  } catch {
    // ignore
  }
}

/**
 * 引导状态 Hook
 * @param tourId 引导唯一标识
 * @param steps  引导步骤列表
 */
export function useTour(
  tourId: string,
  steps: TourStep[],
): { isActive: boolean; start: () => void; close: () => void } {
  const [isActive, setIsActive] = useState(false);

  // 首次访问（未完成过）且有步骤时自动启动引导
  useEffect(() => {
    if (steps.length === 0) return;
    if (!readCompleted(tourId)) {
      setIsActive(true);
    }
  }, [tourId, steps.length]);

  const start = useCallback(() => {
    // 手动重新观看前清除完成标记，确保下次访问仍可自动触发
    clearCompleted(tourId);
    setIsActive(true);
  }, [tourId]);

  const close = useCallback(() => {
    setIsActive(false);
    writeCompleted(tourId);
  }, [tourId]);

  return { isActive, start, close };
}
