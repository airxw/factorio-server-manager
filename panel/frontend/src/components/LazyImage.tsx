// ============================================================================
// LazyImage — 通用懒加载图片组件（三.3）
// 使用浏览器原生 loading="lazy"，进入视口附近才加载，减少首屏无关图片请求。
// 提供 fallback 占位与加载失败回退，避免破损图标。
// ============================================================================

import { useState } from 'react';

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  /** 宽度（CSS 值），默认自适应容器 */
  width?: string | number;
  /** 高度（CSS 值），默认自适应容器 */
  height?: string | number;
  /** 加载失败时显示的备用 src */
  fallbackSrc?: string;
  /** 是否强制忽略懒加载（首屏图片应立即加载），默认 false */
  eager?: boolean;
}

export default function LazyImage({
  src,
  alt,
  className,
  width,
  height,
  fallbackSrc,
  eager = false,
}: LazyImageProps) {
  const [errored, setErrored] = useState(false);

  const currentSrc = errored && fallbackSrc ? fallbackSrc : src;

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      width={width}
      height={height}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => {
        if (!errored && fallbackSrc) {
          setErrored(true);
        }
      }}
    />
  );
}
