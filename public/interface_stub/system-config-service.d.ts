/**
 * system-config-service.d.ts — systemConfigService 接口存根
 *
 * 职责：系统配置 KV 表读写
 * 数据契约：public/schema/system-config-schema.json
 * 来源：scheme-final-merged.md §4.2.2 P1 / §7.1 P1
 */

import type { SystemConfig } from './shared-types';

export interface SystemConfigService {
  /**
   * 读取配置值。不存在返回 null。
   */
  get(key: string): Promise<string | null>;

  /**
   * 写入配置值（upsert）。可选 description。
   */
  set(key: string, value: string, description?: string): Promise<void>;

  /**
   * 读取配置值，不存在返回 defaultValue。
   */
  getWithDefault(key: string, defaultValue: string): Promise<string>;

  /**
   * 列出全部配置项。
   */
  list(): Promise<SystemConfig[]>;

  /**
   * 删除配置项。不存在视为幂等成功。
   */
  delete(key: string): Promise<void>;
}
