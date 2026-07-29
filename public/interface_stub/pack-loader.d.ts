/**
 * pack-loader.d.ts — packLoader 接口存根
 *
 * 职责：Pack 加载 / 校验 / 注册 / 按 business 实例化业务模块
 * 数据契约：public/schema/pack-schema-extension.json
 * 来源：scheme-final-merged.md §3 Pack Schema 完整扩展 / §7.1 P1
 */

import type { GamePack, PackBusiness, PackEventParsers } from './shared-types';
import { PackLoadError, PackValidationError, PackNotFoundError } from './shared-types';

export interface PackLoader {
  /**
   * 加载 Pack。按 packId 从 packs 表与磁盘 Pack YAML 装配完整 GamePack 对象
   * （含 items / event_parsers / business / commands 扩展字段，向后兼容 minecraft-vanilla）。
   * @throws {PackNotFoundError} packId 不存在
   * @throws {PackLoadError} Pack YAML 解析失败或 schema 校验失败
   */
  load(packId: string): Promise<GamePack>;

  /**
   * 校验 Pack YAML 文本是否符合 schema（不写入 DB）。
   * @returns {valid, errors?} valid=true 表示可注册；errors 为错误清单
   */
  validate(packYaml: string): Promise<{ valid: boolean; errors?: string[] }>;

  /**
   * 获取 Pack 的业务能力声明（GamePack.business）。
   * 业务模块加载器据此实例化对应服务。
   * @throws {PackNotFoundError} packId 不存在
   */
  getBusinessConfig(packId: string): Promise<PackBusiness>;

  /**
   * 获取 Pack 的事件解析规则（GamePack.event_parsers）。
   * chatMonitor / joinHandler 据此解析 stdout。
   * @throws {PackNotFoundError} packId 不存在
   */
  getEventParsers(packId: string): Promise<PackEventParsers>;

  /**
   * 注册新 Pack。校验 YAML 后写入 packs 表与磁盘。
   * @throws {PackValidationError} schema 校验失败
   * @throws {PackLoadError} 写入失败
   */
  register(packPath: string): Promise<{ packId: string; version: string }>;

  /**
   * 列出全部已注册 Pack（仅元数据，不含扩展字段）。
   */
  list(): Promise<{ packId: string; game: string; version: string }[]>;
}

export { PackLoadError, PackValidationError, PackNotFoundError } from './shared-types';
