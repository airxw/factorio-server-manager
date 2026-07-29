// ============================================================================
// formatBytes.ts 工具单测 — 字节数格式化函数
// ============================================================================

import { describe, expect, it } from 'vitest';
import { formatBytes } from './formatBytes';

describe('formatBytes', () => {
  it('null 返回占位符', () => {
    expect(formatBytes(null)).toBe('-');
  });

  it('undefined 返回占位符', () => {
    expect(formatBytes(undefined)).toBe('-');
  });

  it('0 返回占位符', () => {
    expect(formatBytes(0)).toBe('-');
  });

  it('负数返回占位符', () => {
    expect(formatBytes(-100)).toBe('-');
  });

  it('NaN 返回占位符', () => {
    expect(formatBytes(NaN)).toBe('-');
  });

  it('Infinity 返回占位符', () => {
    expect(formatBytes(Infinity)).toBe('-');
  });

  it('小于 1024 字节直接显示 B 不带小数', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  it('1 字节显示为 1 B', () => {
    expect(formatBytes(1)).toBe('1 B');
  });

  it('1024 字节显示为 1.00 KB', () => {
    expect(formatBytes(1024)).toBe('1.00 KB');
  });

  it('1536 字节显示为 1.50 KB', () => {
    expect(formatBytes(1536)).toBe('1.50 KB');
  });

  it('1048576 字节显示为 1.00 MB', () => {
    expect(formatBytes(1048576)).toBe('1.00 MB');
  });

  it('1234567 字节显示为 1.18 MB', () => {
    expect(formatBytes(1234567)).toBe('1.18 MB');
  });

  it('1073741824 字节显示为 1.00 GB', () => {
    expect(formatBytes(1073741824)).toBe('1.00 GB');
  });

  it('1099511627776 字节显示为 1.00 TB', () => {
    expect(formatBytes(1099511627776)).toBe('1.00 TB');
  });

  it('1125899906842624 字节显示为 1.00 PB', () => {
    expect(formatBytes(1125899906842624)).toBe('1.00 PB');
  });

  it('超过 PB 仍按 PB 显示（不越界）', () => {
    const huge = 1125899906842624 * 1024 * 10; // 10 EB
    const result = formatBytes(huge);
    // 不抛错，且单位为 PB
    expect(result.endsWith('PB')).toBe(true);
  });
});
