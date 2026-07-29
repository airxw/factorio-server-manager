// ============================================================================
// versionProviders/types.ts — VersionProvider 接口与类型定义
//
// 步骤 1:版本源真实化重构 — 引入 VersionProvider 抽象
// 替代 staticVersions.ts 的人工静态版本表,每个 Pack 绑定真实版本源。
//
// Provider 优先级(Steam 游戏):official-site > github-release > steamcmd-buildid > static
// ============================================================================

import type { GamePack } from '@public/schema/pack-schema';

/** 单个版本条目 */
export interface VersionEntry {
  /** 人类可读版本号(如 "1.0" / "2.0.77") */
  version: string;
  /** 版本类型 */
  type: 'release' | 'experimental' | 'snapshot';
  /** Steam depot buildid(仅 Steam 游戏,可空) */
  buildid?: string;
  /** 发布日期(ISO 8601 字符串,可空) */
  release_date?: string;
}

/** 最新版本信息 */
export interface LatestVersion {
  /** 最新稳定版 */
  release: string;
  /** 最新快照版(可空,如 Minecraft snapshot) */
  snapshot?: string;
  /** Steam depot buildid(可空,仅 Steam 游戏) */
  buildid?: string;
}

/**
 * VersionProvider 接口 — 版本源提供者
 *
 * 每个具体 Provider 实现此接口,从真实数据源获取版本信息。
 * 工厂函数 getProvider(pack) 按 pack.versions.provider 字段分派。
 */
export interface VersionProvider {
  /** 获取所有可用版本列表 */
  listVersions(): Promise<VersionEntry[]>;
  /** 获取最新版本信息 */
  getLatest(): Promise<LatestVersion>;
}

/** Provider 工厂上下文 */
export interface VersionProviderContext {
  /** Pack 配置(含 versions.provider / official_url / version_regex 等) */
  pack: GamePack;
  /** daemon client(仅 SteamCmdBuildIdProvider 需要,可空) */
  daemonClient?: unknown;
  /** 节点 ID(仅 SteamCmdBuildIdProvider 需要,可空) */
  nodeId?: string;
  /** 实例 ID(仅 SteamCmdBuildIdProvider 读 appmanifest 需要,可空) */
  serverId?: string;
}

/**
 * VersionProvider 错误
 *
 * code = PANEL_VERSION_PROVIDER_ERROR,providerCode 字段标识具体 Provider 失败原因。
 */
export class VersionProviderError extends Error {
  readonly code = 'PANEL_VERSION_PROVIDER_ERROR';
  constructor(
    message: string,
    public readonly providerCode?: string,
  ) {
    super(message);
    this.name = 'VersionProviderError';
  }
}
