// ============================================================================
// formatDate.ts 工具单测 — 日期格式化函数
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDate, formatDateOnly, formatRelative } from './formatDate';

describe('formatDate', () => {
  beforeEach(() => {
    // 固定时间避免时区差异影响断言
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T10:30:45.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('null 返回占位符', () => {
    expect(formatDate(null)).toBe('—');
  });

  it('undefined 返回占位符', () => {
    expect(formatDate(undefined)).toBe('—');
  });

  it('无效日期字符串返回占位符', () => {
    expect(formatDate('invalid-date')).toBe('—');
  });

  it('ISO 字符串使用默认格式 YYYY-MM-DD HH:mm:ss', () => {
    // 使用本地时间构造，避免 UTC 偏移
    const result = formatDate(new Date('2025-06-15T10:30:45'));
    // 格式应为 YYYY-MM-DD HH:mm:ss（具体值取决于时区，但格式结构固定）
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('自定义 pattern YYYY-MM-DD', () => {
    const result = formatDate(new Date('2025-06-15T10:30:45'), 'YYYY-MM-DD');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('Date 对象作为输入', () => {
    const d = new Date('2025-06-15T10:30:45');
    const result = formatDate(d);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('时间戳（毫秒）作为输入', () => {
    const ts = new Date('2025-06-15T10:30:45').getTime();
    const result = formatDate(ts);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('pad 单数月日时分秒为两位', () => {
    const result = formatDate(new Date('2025-01-05T03:07:09'));
    // 各字段应被 padStart(2, '0')
    expect(result).toMatch(/-01-05 03:07:09$/);
  });
});

describe('formatDateOnly', () => {
  it('返回 YYYY-MM-DD 格式', () => {
    const result = formatDateOnly(new Date('2025-06-15T10:30:45'));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('null 返回占位符', () => {
    expect(formatDateOnly(null)).toBe('—');
  });
});

describe('formatRelative', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('null 返回占位符', () => {
    expect(formatRelative(null)).toBe('—');
  });

  it('undefined 返回占位符', () => {
    expect(formatRelative(undefined)).toBe('—');
  });

  it('无效日期返回占位符', () => {
    expect(formatRelative('invalid')).toBe('—');
  });

  it('30 秒前返回"刚刚"', () => {
    const past = new Date('2025-06-15T11:59:30');
    expect(formatRelative(past)).toBe('刚刚');
  });

  it('5 分钟前返回"N 分钟前"', () => {
    const past = new Date('2025-06-15T11:55:00');
    expect(formatRelative(past)).toBe('5 分钟前');
  });

  it('3 小时前返回"N 小时前"', () => {
    const past = new Date('2025-06-15T09:00:00');
    expect(formatRelative(past)).toBe('3 小时前');
  });

  it('5 天前返回"N 天前"', () => {
    const past = new Date('2025-06-10T12:00:00');
    expect(formatRelative(past)).toBe('5 天前');
  });

  it('超过 30 天返回日期格式', () => {
    const past = new Date('2025-05-01T12:00:00');
    const result = formatRelative(past);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('Date 对象作为输入', () => {
    const past = new Date('2025-06-15T11:55:00');
    expect(formatRelative(past)).toBe('5 分钟前');
  });

  it('时间戳作为输入', () => {
    const ts = new Date('2025-06-15T11:55:00').getTime();
    expect(formatRelative(ts)).toBe('5 分钟前');
  });
});
