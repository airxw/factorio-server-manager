// ============================================================================
// staticProvider.ts — 静态版本源兜底(包装 staticVersions.ts)
//
// @deprecated 作为离线降级兜底(所有源都不可达时返回最后已知版本)
// 不再作为主数据源;删除其中过时的人造版本数据(已在 staticVersions.ts 清理)。
//
// Pack 未声明 versions.provider 或所有 Provider 失败时,回退到此 Provider。
// ============================================================================

import type { VersionEntry, VersionProvider, LatestVersion } from './types.js';
import { VersionProviderError } from './types.js';
import type { StaticVersionSource } from '../staticVersions.js';

export class StaticVersionProvider implements VersionProvider {
  constructor(private staticSource: StaticVersionSource) {}

  async listVersions(): Promise<VersionEntry[]> {
    // v4.12.0: 统一去除 v 前缀,避免版本比对因前缀不一致而误报更新
    return this.staticSource.versions.map((v) => ({
      version: stripVPrefix(v.id),
      type: v.type,
    }));
  }

  async getLatest(): Promise<LatestVersion> {
    return {
      release: stripVPrefix(this.staticSource.latest.release),
      snapshot: this.staticSource.latest.snapshot
        ? stripVPrefix(this.staticSource.latest.snapshot)
        : undefined,
    };
  }
}

/** 去除版本号的 v/V 前缀(如 "v5.2.0" → "5.2.0") */
function stripVPrefix(v: string): string {
  return v.replace(/^v/i, '');
}

/**
 * 从 static:// 协议 URL 构造 StaticVersionProvider。
 *
 * @param sourceUrl static://<pack-id> 格式的 URL
 * @returns StaticVersionProvider 或 null(未配置对应 pack)
 */
export function createStaticProviderFromUrl(
  sourceUrl: string,
  resolver: (url: string) => StaticVersionSource | null,
): StaticVersionProvider | null {
  const source = resolver(sourceUrl);
  if (!source) {
    return null;
  }
  return new StaticVersionProvider(source);
}

/** 兜底:所有 Provider 失败时的最后降级,返回空列表 + 抛错 */
export class FallbackProvider implements VersionProvider {
  constructor(private packId: string) {}

  async listVersions(): Promise<VersionEntry[]> {
    throw new VersionProviderError(
      `所有 VersionProvider 均不可用,且无静态兜底数据 (pack=${this.packId})`,
      'ALL_PROVIDERS_FAILED',
    );
  }

  async getLatest(): Promise<LatestVersion> {
    throw new VersionProviderError(
      `所有 VersionProvider 均不可用,且无静态兜底数据 (pack=${this.packId})`,
      'ALL_PROVIDERS_FAILED',
    );
  }
}
