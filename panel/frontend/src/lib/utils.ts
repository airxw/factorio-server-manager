import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * cn — shadcn/ui 标准的 className 合并工具
 * 结合 clsx（条件类名）+ tailwind-merge（解决 Tailwind 类冲突）
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
