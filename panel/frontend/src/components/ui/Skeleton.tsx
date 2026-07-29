// ============================================================================
// Skeleton — 骨架屏加载占位
// 在数据加载完成前展示灰条动画，替代「加载中…」纯文本
// ============================================================================

interface SkeletonProps {
  /** 行数，默认 3 */
  lines?: number;
  /** 每行高度（px），默认 16 */
  lineHeight?: number;
  /** 最后一行宽度百分比，默认 60 */
  lastLineWidth?: number;
  /** 容器自定义样式 */
  style?: React.CSSProperties;
}

export default function Skeleton({
  lines = 3,
  lineHeight = 16,
  lastLineWidth = 60,
  style,
}: SkeletonProps) {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 8, ...style }}
      role="status"
      aria-live="polite"
      aria-label="加载中"
    >
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton-bar"
          style={{
            height: lineHeight,
            width: i === lines - 1 ? `${lastLineWidth}%` : '100%',
            background:
              'linear-gradient(90deg, var(--color-border, #e5e7eb) 25%, var(--color-bg-secondary, #f3f4f6) 50%, var(--color-border, #e5e7eb) 75%)',
            backgroundSize: '200% 100%',
            animation: 'skeleton-shimmer 1.4s ease-in-out infinite',
            borderRadius: 4,
          }}
        />
      ))}
    </div>
  );
}
