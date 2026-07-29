// ============================================================================
// formValidation 工具单测 — 覆盖各字段校验函数
// 五.7: 实时表单校验工具的核心逻辑验证
// ============================================================================

import { describe, expect, it } from 'vitest';
import {
  clearFieldError,
  type FieldErrors,
  EMAIL_REGEX,
  passwordStrength,
  validateConfirmPassword,
  validateEmail,
  validateInstanceName,
  validatePassword,
  validateUsername,
} from './formValidation';

describe('EMAIL_REGEX', () => {
  it('接受标准邮箱格式', () => {
    expect(EMAIL_REGEX.test('user@example.com')).toBe(true);
    expect(EMAIL_REGEX.test('a.b@c.d.com')).toBe(true);
    expect(EMAIL_REGEX.test('user+tag@domain.org')).toBe(true);
  });

  it('拒绝非法邮箱格式', () => {
    expect(EMAIL_REGEX.test('plainaddress')).toBe(false);
    expect(EMAIL_REGEX.test('@no-local.com')).toBe(false);
    expect(EMAIL_REGEX.test('no-domain@')).toBe(false);
    expect(EMAIL_REGEX.test('space in@address.com')).toBe(false);
    expect(EMAIL_REGEX.test('no-tld@domain')).toBe(false);
  });
});

describe('validateEmail', () => {
  it('空值返回错误', () => {
    expect(validateEmail('')).toBe('请输入邮箱');
    expect(validateEmail('   ')).toBe('请输入邮箱');
  });

  it('格式不正确返回错误', () => {
    expect(validateEmail('abc')).toBe('邮箱格式不正确');
    expect(validateEmail('abc@')).toBe('邮箱格式不正确');
  });

  it('合法邮箱返回 null', () => {
    expect(validateEmail('admin@local.dev')).toBeNull();
  });

  it('trim 后校验', () => {
    expect(validateEmail('  admin@local.dev  ')).toBeNull();
  });
});

describe('validateUsername', () => {
  it('空值返回错误', () => {
    expect(validateUsername('')).toBe('请输入用户名');
  });

  it('过短返回错误', () => {
    expect(validateUsername('a')).toBe('用户名需为 2-32 字符');
  });

  it('过长返回错误', () => {
    expect(validateUsername('a'.repeat(33))).toBe('用户名需为 2-32 字符');
  });

  it('合法长度返回 null', () => {
    expect(validateUsername('admin')).toBeNull();
    expect(validateUsername('ab')).toBeNull();
    expect(validateUsername('a'.repeat(32))).toBeNull();
  });
});

describe('validatePassword', () => {
  it('空值返回错误', () => {
    expect(validatePassword('')).toBe('请输入密码');
  });

  it('不足 8 位返回错误', () => {
    expect(validatePassword('12345')).toBe('密码至少 8 位');
    expect(validatePassword('1234567')).toBe('密码至少 8 位');
  });

  it('8 位及以上含字母+数字返回 null', () => {
    expect(validatePassword('abcd1234')).toBeNull();
    expect(validatePassword('aVeryLongPassword123!')).toBeNull();
  });

  it('8 位以上但缺字母返回错误', () => {
    expect(validatePassword('12345678')).toBe('密码必须包含字母');
  });

  it('8 位以上但缺数字返回错误', () => {
    expect(validatePassword('abcdefgh')).toBe('密码必须包含数字');
  });
});

describe('passwordStrength', () => {
  it('不足 8 位为弱（0）', () => {
    expect(passwordStrength('12345')).toBe(0);
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('1234567')).toBe(0);
  });

  it('8 位以上但缺字母或数字为弱（0）', () => {
    expect(passwordStrength('12345678')).toBe(0); // 无字母
    expect(passwordStrength('abcdefgh')).toBe(0); // 无数字
  });

  it('8-11 位含字母+数字为中（1）', () => {
    expect(passwordStrength('abcd1234')).toBe(1);
    expect(passwordStrength('Abcd1234')).toBe(1);
  });

  it('12 位以上含大小写+符号+数字为强（2）', () => {
    expect(passwordStrength('Abcdefghijk1!')).toBe(2);
    expect(passwordStrength('StrongPass123X!')).toBe(2);
  });

  it('12 位以上但缺符号为中（1）', () => {
    expect(passwordStrength('Abcdefghijk1')).toBe(1); // 无符号
    expect(passwordStrength('abcdefghijkl1')).toBe(1); // 无大写、无符号
  });
});

describe('validateConfirmPassword', () => {
  it('空值返回错误', () => {
    expect(validateConfirmPassword('', 'password')).toBe('请再次输入密码');
  });

  it('不一致返回错误', () => {
    expect(validateConfirmPassword('different', 'password')).toBe('两次输入的密码不一致');
  });

  it('一致返回 null', () => {
    expect(validateConfirmPassword('password', 'password')).toBeNull();
  });
});

describe('validateInstanceName', () => {
  it('空值返回错误', () => {
    expect(validateInstanceName('')).toBe('请填写实例名称');
    expect(validateInstanceName('   ')).toBe('请填写实例名称');
  });

  it('超过 64 字符返回错误', () => {
    expect(validateInstanceName('a'.repeat(65))).toBe('实例名称最长 64 字符');
  });

  it('合法名称返回 null', () => {
    expect(validateInstanceName('我的生存服')).toBeNull();
    expect(validateInstanceName('a')).toBeNull();
    expect(validateInstanceName('a'.repeat(64))).toBeNull();
  });
});

describe('clearFieldError', () => {
  it('字段无错误时返回原对象引用', () => {
    const errors: FieldErrors<'email' | 'username'> = { email: '错误' };
    expect(clearFieldError(errors, 'username')).toBe(errors);
  });

  it('字段有错误时返回新对象（删除该字段）', () => {
    const errors = { email: '错误', password: '密码错误' };
    const result = clearFieldError(errors, 'email');
    expect(result).not.toBe(errors);
    expect(result).toEqual({ password: '密码错误' });
  });

  it('字段值为 null 时也删除', () => {
    const errors = { email: null, password: '错误' };
    const result = clearFieldError(errors, 'email');
    expect(result).toEqual({ password: '错误' });
  });
});
