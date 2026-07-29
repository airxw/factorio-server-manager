// ============================================================================
// systemConfigService — 系统配置 KV 表读写实现
// 接口契约：@public/interface_stub/system-config-service.d.ts
// 数据契约：public/schema/system-config-schema.json
// 来源：scheme-final-merged.md §4.2.2 P1 / §7.1 P1
// ============================================================================

import type { Knex } from 'knex';
import type { SystemConfigService } from '@public/interface_stub/system-config-service';
import type { SystemConfig } from '@public/interface_stub/shared-types';

// ----- DB 行类型 -----
interface SystemConfigRow {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

/**
 * 系统配置服务实现
 *
 * 设计要点：
 * - 简单 KV 表读写，无业务逻辑
 * - get 不存在返回 null（与契约一致）
 * - delete 幂等（不存在视为成功）
 * - set 为 upsert（冲突时 merge）
 */
export class SystemConfigServiceImpl implements SystemConfigService {
  constructor(private db: Knex) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db<SystemConfigRow>('system_config').where({ key }).first();
    return row?.value ?? null;
  }

  async set(key: string, value: string, description?: string): Promise<void> {
    const now = new Date().toISOString();
    // upsert：冲突时 merge value/description/updated_at
    const update: Partial<SystemConfigRow> = { value, updated_at: now };
    if (description !== undefined) {
      update.description = description;
    }
    await this.db<SystemConfigRow>('system_config')
      .insert({
        key,
        value,
        description: description ?? null,
        updated_at: now,
      })
      .onConflict('key')
      .merge(update);
  }

  async getWithDefault(key: string, defaultValue: string): Promise<string> {
    const value = await this.get(key);
    return value ?? defaultValue;
  }

  async list(): Promise<SystemConfig[]> {
    const rows = await this.db<SystemConfigRow>('system_config').orderBy('key', 'asc');
    return rows.map(toSystemConfig);
  }

  async delete(key: string): Promise<void> {
    // 幂等：不存在不报错
    await this.db<SystemConfigRow>('system_config').where({ key }).delete();
  }
}

function toSystemConfig(row: SystemConfigRow): SystemConfig {
  return {
    key: row.key,
    value: row.value,
    description: row.description,
    updated_at: row.updated_at,
  };
}

/**
 * 创建 systemConfigService 的工厂函数
 */
export function createSystemConfigService(db: Knex): SystemConfigService {
  return new SystemConfigServiceImpl(db);
}
