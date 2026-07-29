// ============================================================================
// githubReleaseProvider.ts — GitHub Releases 版本源
//
// 适配 TShock、DST 等有官方 GitHub 仓库的游戏。
// 数据源:https://api.github.com/repos/{owner}/{repo}/releases
//
// 版本号从 tag_name 提取,去除 v 前缀(如 "v5.2.0" → "5.2.0")。
// prerelease 标记为 experimental,其余为 release。
// ============================================================================

import type { VersionEntry, VersionProvider, LatestVersion } from './types.js';
import { VersionProviderError } from './types.js';

interface GitHubRelease {
  tag_name: string;
  published_at: string;
  prerelease: boolean;
}

export class GitHubReleaseVersionProvider implements VersionProvider {
  /** @param repo GitHub 仓库,格式 "owner/repo"(如 "Pryaxis/TShock") */
  constructor(private repo: string) {}

  async listVersions(): Promise<VersionEntry[]> {
    const releases = await this.fetchReleases();
    return releases.map((r) => ({
      version: stripVPrefix(r.tag_name),
      type: (r.prerelease ? 'experimental' : 'release') as 'release' | 'experimental',
      release_date: r.published_at,
    }));
  }

  async getLatest(): Promise<LatestVersion> {
    const releases = await this.fetchReleases();
    if (releases.length === 0) {
      throw new VersionProviderError(
        `GitHub Releases 为空: ${this.repo}`,
        'GITHUB_NO_RELEASES',
      );
    }
    // GitHub API 默认按 created_at 降序返回,第一个即最新
    const latest = releases[0];
    return {
      release: stripVPrefix(latest.tag_name),
    };
  }

  private async fetchReleases(): Promise<GitHubRelease[]> {
    const url = `https://api.github.com/repos/${this.repo}/releases?per_page=30`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!resp.ok) {
      throw new VersionProviderError(
        `GitHub Releases HTTP ${resp.status}: ${this.repo}`,
        'GITHUB_HTTP_ERROR',
      );
    }
    return (await resp.json()) as GitHubRelease[];
  }
}

/** 去除版本号的 v 前缀(如 "v5.2.0" → "5.2.0") */
function stripVPrefix(tag: string): string {
  return tag.replace(/^v/i, '');
}
