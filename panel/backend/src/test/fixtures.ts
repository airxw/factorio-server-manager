// ============================================================================
// fixtures — 测试数据夹具
// 提供 users / servers / packs 的基础数据构造器，供测试按需覆盖字段。
// ============================================================================

import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// users 表夹具（覆盖全部 NOT NULL 列 + 常用 nullable 列）
// ---------------------------------------------------------------------------

export interface UserFixture {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  role: string;
  status: string;
  display_name: string | null;
  vip_level: number;
  vip_expires_at: string | null;
  is_verified: number;
  last_login_at: string | null;
  last_login_ip: string | null;
  created_at: string;
  updated_at: string;
  token_version: number;
  password_changed_at: string | null;
  email_verified: number;
  is_built_in: number;
}

/** 构造合法 active 用户行（可覆盖任意字段） */
export function createUserFixture(
  overrides: Partial<UserFixture> = {},
): UserFixture {
  const id = overrides.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  return {
    id,
    email: overrides.email ?? `user-${id}@test.local`,
    username: overrides.username ?? 'testuser',
    password_hash: overrides.password_hash ?? '$2a$10$' + 'a'.repeat(53),
    role: overrides.role ?? 'user',
    status: overrides.status ?? 'active',
    display_name: overrides.display_name ?? null,
    vip_level: overrides.vip_level ?? 0,
    vip_expires_at: overrides.vip_expires_at ?? null,
    is_verified: overrides.is_verified ?? 1,
    last_login_at: overrides.last_login_at ?? null,
    last_login_ip: overrides.last_login_ip ?? null,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
    token_version: overrides.token_version ?? 0,
    password_changed_at: overrides.password_changed_at ?? null,
    email_verified: overrides.email_verified ?? 1,
    is_built_in: overrides.is_built_in ?? 0,
  };
}

// ---------------------------------------------------------------------------
// servers 表夹具（核心列）
// ---------------------------------------------------------------------------

export interface ServerFixture {
  id: string;
  name: string;
  pack_id: string;
  game_type: string;
  node_id: string;
  owner_user_id: string;
  status: string;
  port: number;
  rcon_port: number;
  rcon_password_enc: string | null;
  resource_limits_json: string | null;
  shop_enabled: number;
  chat_enabled: number;
  mods_enabled: number;
  created_at: string;
  updated_at: string;
}

/** 构造合法 server 行（ownerUserId 必填以关联用户） */
export function createServerFixture(
  ownerUserId: string,
  overrides: Partial<ServerFixture> = {},
): ServerFixture {
  const id = overrides.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  return {
    id,
    name: overrides.name ?? 'test-server',
    pack_id: overrides.pack_id ?? 'pack-minecraft-vanilla',
    game_type: overrides.game_type ?? 'minecraft',
    node_id: overrides.node_id ?? 'node-local',
    owner_user_id: overrides.owner_user_id ?? ownerUserId,
    status: overrides.status ?? 'stopped',
    port: overrides.port ?? 25565,
    rcon_port: overrides.rcon_port ?? 25575,
    rcon_password_enc: overrides.rcon_password_enc ?? null,
    resource_limits_json: overrides.resource_limits_json ?? null,
    shop_enabled: overrides.shop_enabled ?? 1,
    chat_enabled: overrides.chat_enabled ?? 1,
    mods_enabled: overrides.mods_enabled ?? 1,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  };
}

// ---------------------------------------------------------------------------
// packs 表夹具（核心列）
// ---------------------------------------------------------------------------

export interface PackFixture {
  id: string;
  game: string;
  variant: string;
  display_name: string;
  version: string;
  enabled: number;
  loaded_at: string;
}

/** 构造合法 pack 行 */
export function createPackFixture(overrides: Partial<PackFixture> = {}): PackFixture {
  const id = overrides.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  return {
    id,
    game: overrides.game ?? 'minecraft',
    variant: overrides.variant ?? 'vanilla',
    display_name: overrides.display_name ?? 'Minecraft Vanilla',
    version: overrides.version ?? '1.20.1',
    enabled: overrides.enabled ?? 1,
    loaded_at: overrides.loaded_at ?? now,
  };
}
