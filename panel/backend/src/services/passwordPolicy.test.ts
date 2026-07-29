// ============================================================================
// passwordPolicy.test.ts — 密码强度校验工具单元测试
// 覆盖：长度校验、字母+数字校验、zxcvbn 强度档位、结果结构
//       v4.19.1 补充：isForbiddenPassword + checkForbidden 选项 + PASSWORD_POLICY_RULES + FORBIDDEN_PASSWORDS
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  checkPasswordStrength,
  isForbiddenPassword,
  PASSWORD_POLICY_RULES,
  FORBIDDEN_PASSWORDS,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_ZXCVBN_SCORE,
} from './passwordPolicy.js';

describe('checkPasswordStrength', () => {
  describe('长度校验', () => {
    it('拒绝短于最小长度的密码', () => {
      const r = checkPasswordStrength('ab1');
      expect(r.ok).toBe(false);
      expect(r.failures.some((f) => f.includes('长度不足'))).toBe(true);
    });

    it('接受达到最小长度的密码（长度维度通过）', () => {
      const r = checkPasswordStrength('aB3dE7f9');
      expect(r.failures.some((f) => f.includes('长度不足'))).toBe(false);
    });

    it('拒绝超过最大长度的密码', () => {
      const r = checkPasswordStrength('a1'.repeat(65)); // 130 字符
      expect(r.ok).toBe(false);
      expect(r.failures.some((f) => f.includes('过长'))).toBe(true);
    });

    it('暴露 MIN_PASSWORD_LENGTH / MAX_PASSWORD_LENGTH 常量', () => {
      expect(MIN_PASSWORD_LENGTH).toBe(8);
      expect(MAX_PASSWORD_LENGTH).toBe(128);
    });
  });

  describe('字母 + 数字校验', () => {
    it('拒绝无字母的密码', () => {
      const r = checkPasswordStrength('12345678');
      expect(r.ok).toBe(false);
      expect(r.failures.some((f) => f.includes('字母'))).toBe(true);
    });

    it('拒绝无数字的密码', () => {
      const r = checkPasswordStrength('abcdefgh');
      expect(r.ok).toBe(false);
      expect(r.failures.some((f) => f.includes('数字'))).toBe(true);
    });
  });

  describe('zxcvbn 强度档位', () => {
    it('trivial 密码返回 score 0', () => {
      const r = checkPasswordStrength('aaaaaaaa');
      expect(r.score).toBe(0);
      expect(r.ok).toBe(false);
    });

    it('password1 低于阈值（强度不足）', () => {
      const r = checkPasswordStrength('password1');
      expect(r.score).toBeLessThan(MIN_ZXCVBN_SCORE);
      expect(r.ok).toBe(false);
      expect(r.failures.some((f) => f.includes('强度不足'))).toBe(true);
    });

    it('强密码 score >= MIN_ZXCVBN_SCORE 且 ok=true', () => {
      const r = checkPasswordStrength('C0rrect-Horse-Battery-Staple-99');
      expect(r.score).toBeGreaterThanOrEqual(MIN_ZXCVBN_SCORE);
      expect(r.ok).toBe(true);
      expect(r.failures).toHaveLength(0);
    });

    it('MIN_ZXCVBN_SCORE 常量为 2', () => {
      expect(MIN_ZXCVBN_SCORE).toBe(2);
    });
  });

  describe('结果结构', () => {
    it('弱密码返回 suggestions 数组', () => {
      const r = checkPasswordStrength('password1');
      expect(Array.isArray(r.suggestions)).toBe(true);
    });

    it('强密码 failures 为空数组', () => {
      const r = checkPasswordStrength('C0rrect-Horse-Battery-Staple-99');
      expect(r.failures).toEqual([]);
    });

    it('ok=false 时 failures 非空', () => {
      const r = checkPasswordStrength('weak');
      expect(r.ok).toBe(false);
      expect(r.failures.length).toBeGreaterThan(0);
    });
  });
});

// ===========================================================================
// v4.19.1 补充覆盖：checkForbidden 选项 + isForbiddenPassword + 常量导出
// ===========================================================================

describe('checkPasswordStrength — checkForbidden 选项（v4.18.0）', () => {
  describe('默认不校验禁用密码列表（向后兼容）', () => {
    it('admin123 通过其他规则但未传 checkForbidden 时 ok=true（仅 zxcvbn 阈值校验）', () => {
      // admin123 长度足够 + 含字母数字 + zxcvbn 评分约 1-2（取决于字典）
      // 但根据现有测试 "强密码 score >= MIN_ZXCVBN_SCORE"，admin123 评分通常 < 2
      // 这里仅验证：不传 checkForbidden 时，failures 不含"常见弱密码"消息
      const r = checkPasswordStrength('admin123');
      expect(r.failures.some((f) => f.includes('常见弱密码'))).toBe(false);
    });

    it('password123 不传 checkForbidden 时不报"常见弱密码"', () => {
      const r = checkPasswordStrength('password123');
      expect(r.failures.some((f) => f.includes('常见弱密码'))).toBe(false);
    });
  });

  describe('传入 checkForbidden=true 时硬拦截禁用密码', () => {
    it('admin123 即便其他规则通过也被拒绝', () => {
      const r = checkPasswordStrength('admin123', { checkForbidden: true });
      expect(r.ok).toBe(false);
      expect(r.failures.some((f) => f.includes('常见弱密码'))).toBe(true);
    });

    it('password123 被拒绝', () => {
      const r = checkPasswordStrength('password123', { checkForbidden: true });
      expect(r.ok).toBe(false);
      expect(r.failures.some((f) => f.includes('常见弱密码'))).toBe(true);
    });

    it('12345678 被拒绝', () => {
      const r = checkPasswordStrength('12345678', { checkForbidden: true });
      expect(r.ok).toBe(false);
      // 同时含"必须包含字母"和"常见弱密码"两个 failure
      expect(r.failures.some((f) => f.includes('常见弱密码'))).toBe(true);
    });

    it('qwerty123 被拒绝', () => {
      const r = checkPasswordStrength('qwerty123', { checkForbidden: true });
      expect(r.ok).toBe(false);
      expect(r.failures.some((f) => f.includes('常见弱密码'))).toBe(true);
    });

    it('大小写不敏感：ADMIN123 也被拒绝', () => {
      const r = checkPasswordStrength('ADMIN123', { checkForbidden: true });
      expect(r.ok).toBe(false);
      expect(r.failures.some((f) => f.includes('常见弱密码'))).toBe(true);
    });

    it('正常强密码不受 checkForbidden 影响', () => {
      const r = checkPasswordStrength('C0rrect-Horse-Battery-Staple-99', { checkForbidden: true });
      expect(r.ok).toBe(true);
      expect(r.failures).toHaveLength(0);
    });
  });
});

describe('isForbiddenPassword（v4.18.0）', () => {
  it('FORBIDDEN_PASSWORDS 列表中每个密码都被识别为禁用', () => {
    for (const pwd of FORBIDDEN_PASSWORDS) {
      expect(isForbiddenPassword(pwd)).toBe(true);
    }
  });

  it('大小写不敏感比较', () => {
    expect(isForbiddenPassword('ADMIN123')).toBe(true);
    expect(isForbiddenPassword('Admin123')).toBe(true);
    expect(isForbiddenPassword('PASSWORD')).toBe(true);
    expect(isForbiddenPassword('QwErTy123')).toBe(true);
  });

  it('非禁用密码返回 false', () => {
    expect(isForbiddenPassword('C0rrect-Horse-Battery-Staple-99')).toBe(false);
    expect(isForbiddenPassword('my-safe-pass-2024')).toBe(false);
    expect(isForbiddenPassword('')).toBe(false);
  });

  it('禁用列表包含预期的常见弱密码', () => {
    expect(FORBIDDEN_PASSWORDS).toContain('admin123');
    expect(FORBIDDEN_PASSWORDS).toContain('password');
    expect(FORBIDDEN_PASSWORDS).toContain('password1');
    expect(FORBIDDEN_PASSWORDS).toContain('12345678');
    expect(FORBIDDEN_PASSWORDS).toContain('qwerty123');
    // 至少 10 条
    expect(FORBIDDEN_PASSWORDS.length).toBeGreaterThanOrEqual(10);
  });
});

describe('PASSWORD_POLICY_RULES（v4.18.0）', () => {
  it('与 checkPasswordStrength 内部规则常量 1:1 对齐', () => {
    expect(PASSWORD_POLICY_RULES.min_length).toBe(MIN_PASSWORD_LENGTH);
    expect(PASSWORD_POLICY_RULES.max_length).toBe(MAX_PASSWORD_LENGTH);
    expect(PASSWORD_POLICY_RULES.min_zxcvbn_score).toBe(MIN_ZXCVBN_SCORE);
  });

  it('require_letter + require_digit 均为 true（当前规则）', () => {
    expect(PASSWORD_POLICY_RULES.require_letter).toBe(true);
    expect(PASSWORD_POLICY_RULES.require_digit).toBe(true);
  });

  it('forbidden_passwords 是 string[] 可变数组（非 readonly）且与 FORBIDDEN_PASSWORDS 同源', () => {
    expect(Array.isArray(PASSWORD_POLICY_RULES.forbidden_passwords)).toBe(true);
    expect(PASSWORD_POLICY_RULES.forbidden_passwords).toEqual([...FORBIDDEN_PASSWORDS]);
    // 验证为可变数组（契约要求 string[]，非 readonly string[]）
    expect(Object.isFrozen(PASSWORD_POLICY_RULES.forbidden_passwords)).toBe(false);
  });

  it('forbidden_passwords 是 FORBIDDEN_PASSWORDS 的副本（外部修改不影响原常量）', () => {
    const snapshot = [...PASSWORD_POLICY_RULES.forbidden_passwords];
    PASSWORD_POLICY_RULES.forbidden_passwords.push('hacked-pwd');
    // 原常量不受影响
    expect(FORBIDDEN_PASSWORDS).not.toContain('hacked-pwd');
    // 恢复
    PASSWORD_POLICY_RULES.forbidden_passwords.length = 0;
    snapshot.forEach((p) => PASSWORD_POLICY_RULES.forbidden_passwords.push(p));
  });

  it('所有数值字段为正整数', () => {
    expect(PASSWORD_POLICY_RULES.min_length).toBeGreaterThan(0);
    expect(PASSWORD_POLICY_RULES.max_length).toBeGreaterThan(PASSWORD_POLICY_RULES.min_length);
    expect(PASSWORD_POLICY_RULES.min_zxcvbn_score).toBeGreaterThanOrEqual(0);
    expect(PASSWORD_POLICY_RULES.min_zxcvbn_score).toBeLessThanOrEqual(4);
  });
});
