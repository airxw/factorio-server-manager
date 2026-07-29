// ============================================================================
// versionCompare.test.ts — 版本号规范化解析与比对单元测试
// 步骤 11:覆盖 semver / v 前缀 / buildid / 多段版本号 / 通配符约束场景
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  parseVersionFlex,
  compareVersions,
  parseVersionLegacy,
} from './versionCompare.js';

describe('parseVersionFlex', () => {
  describe('标准 semver', () => {
    it('解析 x.y.z 格式', () => {
      expect(parseVersionFlex('2.0.77')).toEqual({
        segments: [2, 0, 77],
        buildId: undefined,
        raw: '2.0.77',
      });
    });

    it('解析 x.y 格式', () => {
      expect(parseVersionFlex('1.0')).toEqual({
        segments: [1, 0],
        buildId: undefined,
        raw: '1.0',
      });
    });
  });

  describe('v 前缀', () => {
    it('去除小写 v 前缀', () => {
      const r = parseVersionFlex('v5.2.0');
      expect(r.segments).toEqual([5, 2, 0]);
      expect(r.raw).toBe('5.2.0');
    });

    it('去除大写 V 前缀', () => {
      const r = parseVersionFlex('V0.3.3');
      expect(r.segments).toEqual([0, 3, 3]);
    });
  });

  describe('多段版本号 + build 号', () => {
    it('解析 Palworld 格式 0.3.3.54124(最后一段为 build 号)', () => {
      const r = parseVersionFlex('0.3.3.54124');
      expect(r.segments).toEqual([0, 3, 3]);
      expect(r.buildId).toBe('54124');
    });

    it('解析 1.20.4.1(短末段视为版本段,非 build 号)', () => {
      const r = parseVersionFlex('1.20.4.1');
      expect(r.segments).toEqual([1, 20, 4, 1]);
      expect(r.buildId).toBeUndefined();
    });
  });

  describe('纯数字 buildid', () => {
    it('短数字(≤3 位)视为单段版本号', () => {
      const r = parseVersionFlex('123');
      expect(r.segments).toEqual([123]);
      expect(r.buildId).toBeUndefined();
    });

    it('长数字(>3 位)视为 buildId', () => {
      const r = parseVersionFlex('1234567');
      expect(r.segments).toEqual([0]);
      expect(r.buildId).toBe('1234567');
    });
  });

  describe('非数字段', () => {
    it('26.3-snapshot-4 视为 buildId', () => {
      const r = parseVersionFlex('26.3-snapshot-4');
      expect(r.segments).toEqual([26, 3]);
      expect(r.buildId).toBe('snapshot-4');
    });
  });
});

describe('compareVersions', () => {
  it('相等版本返回 0', () => {
    expect(compareVersions('2.0.77', '2.0.77')).toBe(0);
  });

  it('主版本号大者胜出', () => {
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
  });

  it('次版本号大者胜出', () => {
    expect(compareVersions('1.20.0', '1.19.99')).toBeGreaterThan(0);
  });

  it('补丁号大者胜出', () => {
    expect(compareVersions('1.20.4', '1.20.3')).toBeGreaterThan(0);
  });

  it('v 前缀不影响比较', () => {
    expect(compareVersions('v5.2.0', '5.2.0')).toBe(0);
    expect(compareVersions('v1.0', '1.0')).toBe(0);
  });

  it('build 号大者胜出(segments 相同时)', () => {
    expect(compareVersions('0.3.3.54124', '0.3.3.54123')).toBeGreaterThan(0);
    expect(compareVersions('0.3.3.54124', '0.3.3')).toBeGreaterThan(0);
  });

  it('不同段数时短的补 0', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0')).toBeGreaterThan(0);
  });

  it('Steam buildid 与 semver 比较(buildid 视为 [0] + buildId)', () => {
    // "1234567" → segments=[0],buildId=1234567
    // "0.0.0" → segments=[0,0,0]
    // segments 比较:[0] vs [0,0,0] → 短的补 0 → 0==0, 0==0, 0==0 → 相等
    // 然后 buildId: 1234567 vs 0 → 1234567 > 0
    expect(compareVersions('1234567', '0.0.0')).toBeGreaterThan(0);
  });
});

describe('parseVersionLegacy(向后兼容)', () => {
  it('解析 semver 为 {major,minor,patch}', () => {
    expect(parseVersionLegacy('2.0.77')).toEqual({
      major: 2,
      minor: 0,
      patch: 77,
    });
  });

  it('非 semver 版本统一返回 0(向后兼容旧行为)', () => {
    expect(parseVersionLegacy('1234567')).toEqual({
      major: 0,
      minor: 0,
      patch: 0,
    });
  });
});
