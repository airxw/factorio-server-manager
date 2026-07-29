// ============================================================================
// LineChart — 自定义 SVG 折线图组件（无第三方依赖）
// 参考 factorio/frontend/src/pages/Monitor.tsx 中的 Chart 组件简化而来
// 用于监控页展示 CPU/内存/tick 趋势
// ============================================================================

import type { ReactNode } from 'react';

interface LineChartProps {
  /** 数据点序列（按时间先后顺序，索引 0 为最早；null/undefined 会被跳过） */
  data: Array<number | null | undefined>;
  /** 图表标题 */
  label: string;
  /** 折线颜色（CSS 颜色值，如 '#0ea5e9'） */
  color: string;
  /** 数值单位（如 '%'、'MB'），显示在最新值后 */
  unit?: string;
  /** Y 轴最大值；不传则按数据最大值自动上浮 10% */
  maxValue?: number;
  /** 警告阈值（超过时绘制红色虚线，作为可视告警参考） */
  warningThreshold?: number;
}

const CHART_WIDTH = 800;
const CHART_HEIGHT = 200;
const CHART_PADDING = 40;

/**
 * 将数值格式化为紧凑显示（保留 1-2 位小数，去掉无意义尾零）。
 */
function formatValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(value < 10 ? 2 : 1);
}

/** 类型守卫：判断是否为有限数值 */
function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export default function LineChart({
  data,
  label,
  color,
  unit = '',
  maxValue,
  warningThreshold,
}: LineChartProps) {
  // 过滤掉非有限数值，保证折线连续可绘
  const valid: number[] = data.filter(isFiniteNumber);

  if (valid.length === 0) {
    return (
      <div className="chart-card">
        <h3 className="card-title">{label}</h3>
        <div className="empty-state" style={{ padding: '24px 16px' }}>
          暂无数据
        </div>
      </div>
    );
  }

  const maxVal = maxValue ?? Math.max(...valid, 1) * 1.1;
  const safeMax = maxVal <= 0 ? 1 : maxVal;

  // X 轴按数据索引等分
  const xCount = Math.max(valid.length - 1, 1);
  const plotW = CHART_WIDTH - 2 * CHART_PADDING;
  const plotH = CHART_HEIGHT - 2 * CHART_PADDING;

  const points = valid.map((v, i) => {
    const x = CHART_PADDING + (i / xCount) * plotW;
    const y = CHART_HEIGHT - CHART_PADDING - (v / safeMax) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const latestValue = valid[valid.length - 1];

  // Y 轴 6 等分刻度
  const yTicks = Array.from({ length: 6 }, (_, i) => {
    const value = (safeMax / 5) * i;
    const y = CHART_HEIGHT - CHART_PADDING - (value / safeMax) * plotH;
    return { value: formatValue(value), y };
  });

  // 警告阈值虚线（仅当阈值落在绘图区内时绘制）
  let thresholdLine: ReactNode = null;
  if (warningThreshold !== undefined && warningThreshold >= 0) {
    const y = CHART_HEIGHT - CHART_PADDING - (warningThreshold / safeMax) * plotH;
    if (y >= CHART_PADDING && y <= CHART_HEIGHT - CHART_PADDING) {
      thresholdLine = (
        <line
          x1={CHART_PADDING}
          y1={y}
          x2={CHART_WIDTH - CHART_PADDING}
          y2={y}
          stroke="#f87171"
          strokeWidth={1}
          strokeDasharray="4 2"
        />
      );
    }
  }

  return (
    <div className="chart-card">
      <h3 className="card-title chart-title-row">
        <span>{label}</span>
        <span className="chart-latest" style={{ color }}>
          {formatValue(latestValue)}
          {unit}
        </span>
      </h3>
      <svg
        width="100%"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        {/* Y 轴刻度线与标签 */}
        {yTicks.map((tick, i) => (
          <g key={i}>
            <line
              x1={CHART_PADDING}
              y1={tick.y}
              x2={CHART_WIDTH - CHART_PADDING}
              y2={tick.y}
              stroke="#e2e5ea"
              strokeWidth={1}
            />
            <text
              x={CHART_PADDING - 8}
              y={tick.y + 4}
              fill="#6b7280"
              fontSize={10}
              textAnchor="end"
            >
              {tick.value}
            </text>
          </g>
        ))}

        {/* 警告阈值虚线 */}
        {thresholdLine}

        {/* 数据折线 */}
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* X 轴起点/终点索引标签 */}
        <text x={CHART_PADDING} y={CHART_HEIGHT - 10} fill="#6b7280" fontSize={10}>
          起点
        </text>
        <text
          x={CHART_WIDTH - CHART_PADDING}
          y={CHART_HEIGHT - 10}
          fill="#6b7280"
          fontSize={10}
          textAnchor="end"
        >
          最新
        </text>
      </svg>
    </div>
  );
}
