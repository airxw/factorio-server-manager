// ============================================================================
// mojangProvider.ts — Minecraft Mojang version_manifest 版本源
//
// 数据源:https://piston-meta.mojang.com/mc/game/version_manifest.json
// 返回完整版本列表(含历史版本)+ latest.release / latest.snapshot
// ============================================================================

import type { VersionEntry, VersionProvider, LatestVersion } from './types.js';
import { VersionProviderError } from './types.js';

interface MojangManifest {
  latest: { release: string; snapshot: string };
  versions: Array<{ id: string; type: string; releaseTime: string }>;
}

export class MojangVersionProvider implements VersionProvider {
  constructor(
    private manifestUrl: string = 'https://piston-meta.mojang.com/mc/game/version_manifest.json',
  ) {}

  async listVersions(): Promise<VersionEntry[]> {
    const manifest = await this.fetchManifest();
    return manifest.versions.map((v) => ({
      version: v.id,
      type: (v.type === 'snapshot' ? 'snapshot' : 'release') as 'release' | 'snapshot',
      release_date: v.releaseTime,
    }));
  }

  async getLatest(): Promise<LatestVersion> {
    const manifest = await this.fetchManifest();
    return {
      release: manifest.latest.release,
      snapshot: manifest.latest.snapshot,
    };
  }

  private async fetchManifest(): Promise<MojangManifest> {
    const resp = await fetch(this.manifestUrl, { signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) {
      throw new VersionProviderError(
        `Mojang manifest HTTP ${resp.status}: ${this.manifestUrl}`,
        'MOJANG_HTTP_ERROR',
      );
    }
    return (await resp.json()) as MojangManifest;
  }
}
