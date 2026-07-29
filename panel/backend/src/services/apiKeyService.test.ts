// ============================================================================
// apiKeyService.test.ts — API Key 旁路认证服务单元测试
// 覆盖：工具函数（generate/hash/extract/isValid）+ ApiKeyService（create/verify/revoke）
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import {
  ApiKeyService,
  generateApiKey,
  hashApiKey,
  extractKeyPrefix,
  isValidApiKeyFormat,
  API_KEY_PREFIX,
  KEY_PREFIX_LEN,
  SHA256_HEX_LEN,
} from './apiKeyService.js';
import { ValidationError } from './errors.js';
import { Role } from '../core/auth/roles.js';
import { createTestDb, destroyTestDb } from '../test/db-helper.js';
import { createUserFixture } from '../test/fixtures.js';

// ---------------------------------------------------------------------------
// 工具函数（纯函数，无需 DB）
// ---------------------------------------------------------------------------

describe('apiKeyService 工具函数', () => {
  it('generateApiKey 返回 gsp_ + 32 hex（总长 36）', () => {
    const key = generateApiKey();
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key.length).toBe(API_KEY_PREFIX.length + 32);
    expect(isValidApiKeyFormat(key)).toBe(true);
  });

  it('generateApiKey 每次生成不同 key', () => {
    expect(generateApiKey()).not.toBe(generateApiKey());
  });

  it('hashApiKey 返回 64 字符 hex（SHA-256）', () => {
    const key = 'gsp_' + 'a'.repeat(32);
    const hash = hashApiKey(key);
    expect(hash.length).toBe(SHA256_HEX_LEN);
    expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
  });

  it('hashApiKey 相同输入产生相同输出（确定性）', () => {
    const key = 'gsp_' + 'b'.repeat(32);
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  it('extractKeyPrefix 返回前 12 字符', () => {
    const key = 'gsp_' + '0123456789abcdef'.repeat(2); // gsp_ + 32 hex
    const prefix = extractKeyPrefix(key);
    expect(prefix).toBe(key.slice(0, KEY_PREFIX_LEN));
    expect(prefix.length).toBe(KEY_PREFIX_LEN);
  });

  it('isValidApiKeyFormat 接受合法 key', () => {
    expect(isValidApiKeyFormat('gsp_' + 'a'.repeat(32))).toBe(true);
    expect(isValidApiKeyFormat('gsp_' + 'F'.repeat(32))).toBe(true); // 大写 hex
  });

  it('isValidApiKeyFormat 拒绝错误前缀', () => {
    expect(isValidApiKeyFormat('xxx_' + 'a'.repeat(32))).toBe(false);
  });

  it('isValidApiKeyFormat 拒绝错误长度', () => {
    expect(isValidApiKeyFormat('gsp_' + 'a'.repeat(31))).toBe(false);
    expect(isValidApiKeyFormat('gsp_' + 'a'.repeat(33))).toBe(false);
  });

  it('isValidApiKeyFormat 拒绝非 hex 字符', () => {
    expect(isValidApiKeyFormat('gsp_' + 'z'.repeat(32))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ApiKeyService（需 DB）
// ---------------------------------------------------------------------------

describe('ApiKeyService', () => {
  let db: Knex;
  let service: ApiKeyService;
  let userId: string;

  beforeEach(async () => {
    db = await createTestDb();
    service = new ApiKeyService(db);
    const user = createUserFixture({
      role: Role.SERVER_ADMIN,
      status: 'active',
      email: 'admin@test.local',
      username: 'admin',
    });
    await db('users').insert(user);
    userId = user.id;
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  describe('createApiKey', () => {
    it('为 active 用户成功创建 key', async () => {
      const { plaintext, info } = await service.createApiKey(
        userId,
        Role.SERVER_ADMIN,
        'CI Key',
      );
      expect(plaintext).toMatch(/^gsp_[a-fA-F0-9]{32}$/);
      expect(info.name).toBe('CI Key');
      expect(info.user_id).toBe(userId);
      expect(info.role).toBe(Role.SERVER_ADMIN);
      expect(info.revoked_at).toBeNull();
      expect(info.expires_at).toBeNull();

      // DB 行存在，hash/prefix 与明文一致
      const rows = await db('api_keys').where({ id: info.id });
      expect(rows).toHaveLength(1);
      expect(rows[0].key_hash).toBe(hashApiKey(plaintext));
      expect(rows[0].key_prefix).toBe(extractKeyPrefix(plaintext));
      expect(rows[0].revoked_at).toBeNull();
    });

    it('拒绝空 name', async () => {
      await expect(service.createApiKey(userId, Role.USER, '')).rejects.toThrow(
        ValidationError,
      );
      await expect(
        service.createApiKey(userId, Role.USER, '   '),
      ).rejects.toThrow(ValidationError);
    });

    it('拒绝超过 100 字符的 name', async () => {
      await expect(
        service.createApiKey(userId, Role.USER, 'a'.repeat(101)),
      ).rejects.toThrow(ValidationError);
    });

    it('拒绝无效 expiresAt', async () => {
      await expect(
        service.createApiKey(userId, Role.USER, 'k', 'not-a-date'),
      ).rejects.toThrow(ValidationError);
    });

    it('拒绝过去时间 expiresAt', async () => {
      const past = new Date(Date.now() - 1000).toISOString();
      await expect(
        service.createApiKey(userId, Role.USER, 'k', past),
      ).rejects.toThrow(ValidationError);
    });

    it('接受未来 expiresAt', async () => {
      const future = new Date(Date.now() + 86_400_000).toISOString();
      const { info } = await service.createApiKey(userId, Role.USER, 'k', future);
      expect(info.expires_at).toBe(future);
    });

    it('拒绝不存在的用户', async () => {
      await expect(
        service.createApiKey('nonexistent-uuid', Role.USER, 'k'),
      ).rejects.toThrow(ValidationError);
    });

    it('拒绝非 active 用户', async () => {
      const disabled = createUserFixture({
        role: Role.USER,
        status: 'disabled',
        email: 'disabled@test.local',
        username: 'disabled',
      });
      await db('users').insert(disabled);
      await expect(
        service.createApiKey(disabled.id, Role.USER, 'k'),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('verifyApiKey', () => {
    it('合法 key 返回 JwtPayload', async () => {
      const { plaintext } = await service.createApiKey(
        userId,
        Role.INSTANCE_ADMIN,
        'k',
      );
      const payload = await service.verifyApiKey(plaintext, '127.0.0.1');
      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe(userId);
      expect(payload!.email).toBe('admin@test.local');
      expect(payload!.role).toBe(Role.INSTANCE_ADMIN);
    });

    it('非法格式返回 null', async () => {
      expect(await service.verifyApiKey('invalid')).toBeNull();
    });

    it('不存在的 key 返回 null', async () => {
      const fake = 'gsp_' + '0'.repeat(32);
      expect(await service.verifyApiKey(fake)).toBeNull();
    });

    it('已撤销的 key 返回 null', async () => {
      const { plaintext, info } = await service.createApiKey(userId, Role.USER, 'k');
      await service.revokeApiKey(info.id);
      expect(await service.verifyApiKey(plaintext)).toBeNull();
    });

    it('已过期的 key 返回 null', async () => {
      const future = new Date(Date.now() + 86_400_000).toISOString();
      const { plaintext, info } = await service.createApiKey(
        userId,
        Role.USER,
        'k',
        future,
      );
      // 手动将过期时间改为过去
      await db('api_keys').where({ id: info.id }).update({
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });
      expect(await service.verifyApiKey(plaintext)).toBeNull();
    });

    it('用户非 active 时返回 null', async () => {
      const { plaintext } = await service.createApiKey(userId, Role.USER, 'k');
      await db('users').where({ id: userId }).update({ status: 'disabled' });
      expect(await service.verifyApiKey(plaintext)).toBeNull();
    });

    it('成功认证后更新 last_used_at / last_used_ip', async () => {
      const { plaintext, info } = await service.createApiKey(userId, Role.USER, 'k');
      await service.verifyApiKey(plaintext, '10.0.0.1');
      const row = await db('api_keys').where({ id: info.id }).first();
      expect(row.last_used_at).not.toBeNull();
      expect(row.last_used_ip).toBe('10.0.0.1');
    });

    it('角色冻结：使用创建时的 key role 而非当前 user role', async () => {
      const { plaintext } = await service.createApiKey(userId, Role.USER, 'k');
      // 用户角色后续变更为 server_admin
      await db('users').where({ id: userId }).update({ role: Role.SERVER_ADMIN });
      const payload = await service.verifyApiKey(plaintext);
      expect(payload!.role).toBe(Role.USER); // 冻结在创建时
    });
  });

  describe('revokeApiKey', () => {
    it('撤销 active key', async () => {
      const { info } = await service.createApiKey(userId, Role.USER, 'k');
      const revoked = await service.revokeApiKey(info.id);
      expect(revoked.revoked_at).not.toBeNull();
      // DB 中 revoked_at 已写入
      const row = await db('api_keys').where({ id: info.id }).first();
      expect(row.revoked_at).not.toBeNull();
    });

    it('幂等：已撤销再次撤销不报错', async () => {
      const { info } = await service.createApiKey(userId, Role.USER, 'k');
      const first = await service.revokeApiKey(info.id);
      const second = await service.revokeApiKey(info.id);
      expect(second.revoked_at).toBe(first.revoked_at);
    });

    it('不存在的 id 抛错', async () => {
      await expect(service.revokeApiKey('nope')).rejects.toThrow();
    });
  });
});
