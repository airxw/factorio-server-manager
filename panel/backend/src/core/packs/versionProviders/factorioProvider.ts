// ============================================================================
// factorioProvider.ts — Factorio 官方版本源
//
// 数据源:https://factorio.com/api/latest-releases
// 返回 stable/experimental 的 headless 版本号(标准 semver,如 "2.0.77")
//
// Factorio 是标准 semver,parseVersionFlex(step 2)直接支持。
// headless 优先,因为我们下载的是 headless server。
// ============================================================================

import type { VersionEntry, VersionProvider, LatestVersion } from './types.js';
import { VersionProviderError } from './types.js';

interface FactorioLatestReleases {
  stable?: { headless?: string; alpha?: string };
  experimental?: { headless?: string; alpha?: string };
}

export class FactorioVersionProvider implements VersionProvider {
  constructor(
    private apiUrl: string = 'https://factorio.com/api/latest-releases',
  ) {}

  async listVersions(): Promise<VersionEntry[]> {
    const data = await this.fetchReleases();
    const entries: VersionEntry[] = [];
    if (data.stable?.headless) {
      entries.push({ version: data.stable.headless, type: 'release' });
    }
    if (data.experimental?.headless) {
      entries.push({ version: data.experimental.headless, type: 'experimental' });
    }
    return entries;
  }

  async getLatest(): Promise<LatestVersion> {
    const data = await this.fetchReleases();
    const release = data.stable?.headless ?? data.experimental?.headless;
    if (!release) {
      throw new VersionProviderError(
        'Factorio API 未返回版本号',
        'FACTORIO_NO_VERSION',
      );
    }
    return {
      release,
      snapshot: data.experimental?.headless,
    };
  }

  private async fetchReleases(): Promise<FactorioLatestReleases> {
    const resp = await fetch(this.apiUrl, { signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) {
      throw new VersionProviderError(
        `Factorio API HTTP ${resp.status}: ${this.apiUrl}`,
        'FACTORIO_HTTP_ERROR',
      );
    }
    return (await resp.json()) as FactorioLatestReleases;
  }
}
