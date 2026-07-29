// ============================================================================
// v4.32.2 B2.8: 数据量监控告警——阈值等级判定单测
// 仅测试 classifyDataVolumeLevel 纯函数，不涉及 DB / HTTP
// ============================================================================

import { describe, it, expect } from 'vitest';
import { classifyDataVolumeLevel } from './maintenance.js';

describe('classifyDataVolumeLevel', () => {
  it('threshold ≤ 0 时一律 normal（防御零除）', () => {
    expect(classifyDataVolumeLevel(0, 0)).toBe('normal');
    expect(classifyDataVolumeLevel(1000, 0)).toBe('normal');
    expect(classifyDataVolumeLevel(1000, -1)).toBe('normal');
  });

  it('rowCount = 0 时 normal', () => {
    expect(classifyDataVolumeLevel(0, 100)).toBe('normal');
  });

  it('< 80% 阈值 → normal', () => {
    expect(classifyDataVolumeLevel(79, 100)).toBe('normal');
    expect(classifyDataVolumeLevel(79_999, 100_000)).toBe('normal');
  });

  it('恰好 80% 阈值 → warning（边界含左端点）', () => {
    expect(classifyDataVolumeLevel(80, 100)).toBe('warning');
    expect(classifyDataVolumeLevel(80_000, 100_000)).toBe('warning');
  });

  it('80% ~ 95% 阈值之间 → warning', () => {
    expect(classifyDataVolumeLevel(85, 100)).toBe('warning');
    expect(classifyDataVolumeLevel(94, 100)).toBe('warning');
    expect(classifyDataVolumeLevel(94_999, 100_000)).toBe('warning');
  });

  it('恰好 95% 阈值 → critical（边界含左端点）', () => {
    expect(classifyDataVolumeLevel(95, 100)).toBe('critical');
    expect(classifyDataVolumeLevel(95_000, 100_000)).toBe('critical');
  });

  it('≥ 95% 阈值 → critical', () => {
    expect(classifyDataVolumeLevel(100, 100)).toBe('critical');
    expect(classifyDataVolumeLevel(150, 100)).toBe('critical');
    expect(classifyDataVolumeLevel(200_000, 100_000)).toBe('critical');
  });

  it('不同阈值尺度下判定一致（player_bindings 阈值 50000 / webhooks 阈值 200）', () => {
    // player_bindings 默认阈值 50000
    expect(classifyDataVolumeLevel(39_999, 50_000)).toBe('normal'); // 79.998%
    expect(classifyDataVolumeLevel(40_000, 50_000)).toBe('warning'); // 80%
    expect(classifyDataVolumeLevel(47_500, 50_000)).toBe('critical'); // 95%

    // webhooks 默认阈值 200
    expect(classifyDataVolumeLevel(159, 200)).toBe('normal'); // 79.5%
    expect(classifyDataVolumeLevel(160, 200)).toBe('warning'); // 80%
    expect(classifyDataVolumeLevel(190, 200)).toBe('critical'); // 95%
  });
});
