// ============================================================================
// officialSiteProvider.ts — 通用官网版本源(Steam 游戏主用)
//
// 配置官网/官方公告 URL + 版本号提取正则,解析页面获取人类可读版本号
// (如 Palworld 1.0);每个游戏在 pack.yaml 配置 versions.official_url 与
// versions.version_regex。
//
// 解析策略:
//   1. 配置了 version_regex → 用正则第一个捕获组提取版本号
//   2. 未配置 regex → 尝试 JSON 解析(适配返回 JSON 的官网 API)
//   3. JSON 解析失败 → 兜底从文本中提取第一个 x.y.z 格式版本号
//
// Steam 游戏官网通常只暴露"当前最新版本",无历史列表,
// listVersions 返回单条目(最新版本)。
// ============================================================================

import type { VersionEntry, VersionProvider, LatestVersion } from './types.js';
import { VersionProviderError } from './types.js';

export interface OfficialSiteConfig {
  /** 官网/官方公告 URL */
  url: string;
  /** 版本号提取正则(第一个捕获组 = 版本号,可空,空时走 JSON/文本兜底) */
  regex?: string;
  /** 兜底 buildid(官网不可达或解析失败时使用,可空) */
  fallbackBuildid?: string;
}

export class OfficialSiteVersionProvider implements VersionProvider {
  constructor(private config: OfficialSiteConfig) {}

  async listVersions(): Promise<VersionEntry[]> {
    const latest = await this.getLatest();
    // Steam 游戏官网通常只暴露"当前最新版本",无历史列表
    return [
      {
        version: latest.release,
        type: 'release',
        buildid: latest.buildid,
      },
    ];
  }

  async getLatest(): Promise<LatestVersion> {
    const resp = await fetch(this.config.url, {
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: 'text/html,application/json' },
    });
    if (!resp.ok) {
      throw new VersionProviderError(
        `官网版本源 HTTP ${resp.status}: ${this.config.url}`,
        'OFFICIAL_SITE_HTTP_ERROR',
      );
    }

    const text = await resp.text();

    // 1. 配置了 version_regex → 用正则第一个捕获组提取
    if (this.config.regex) {
      try {
        const regex = new RegExp(this.config.regex);
        const match = text.match(regex);
        if (match && match[1]) {
          return {
            release: match[1],
            buildid: this.config.fallbackBuildid,
          };
        }
      } catch (err) {
        throw new VersionProviderError(
          `官网版本号正则无效: ${this.config.regex} (${err instanceof Error ? err.message : String(err)})`,
          'OFFICIAL_SITE_REGEX_INVALID',
        );
      }
      throw new VersionProviderError(
        `官网版本号正则未匹配: ${this.config.url} (regex: ${this.config.regex})`,
        'OFFICIAL_SITE_REGEX_NO_MATCH',
      );
    }

    // 2. 未配置 regex → 尝试 JSON 解析
    try {
      const data = JSON.parse(text) as unknown;
      const version = extractVersionFromJson(data);
      if (version) {
        return {
          release: version,
          buildid: this.config.fallbackBuildid,
        };
      }
    } catch {
      // 非 JSON,继续到文本兜底
    }

    // 3. 兜底:从文本中提取第一个 x.y.z 格式版本号
    const versionMatch = text.match(/\d+\.\d+(?:\.\d+)?/);
    if (versionMatch) {
      return {
        release: versionMatch[0],
        buildid: this.config.fallbackBuildid,
      };
    }

    throw new VersionProviderError(
      `无法从官网提取版本号: ${this.config.url}`,
      'OFFICIAL_SITE_NO_VERSION',
    );
  }
}

/**
 * 从 JSON 数据中提取版本号(通用解析)。
 *
 * 支持的 JSON 形态:
 *   1. 顶层字符串字段: { latest_version / version / tag_name / latest_stable / stable }
 *   2. 嵌套对象: { stable/experimental/latest: { headless/alpha/release } }
 *   3. 兜底递归:深度优先查找第一个 x.y.z 格式字符串
 */
function extractVersionFromJson(data: unknown): string | null {
  if (typeof data === 'string') {
    const m = data.match(/^\d+\.\d+(?:\.\d+)?/);
    return m ? m[0] : null;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const v = extractVersionFromJson(item);
      if (v) return v;
    }
    return null;
  }
  if (typeof data === 'object' && data !== null) {
    const d = data as Record<string, unknown>;
    // 1. 顶层字符串字段
    const candidates = ['latest_version', 'version', 'tag_name', 'latest_stable', 'stable'];
    for (const key of candidates) {
      if (typeof d[key] === 'string' && (d[key] as string).length > 0) {
        return d[key] as string;
      }
    }
    // 2. 嵌套对象:stable/experimental/latest → headless/alpha/release
    for (const outer of ['stable', 'experimental', 'latest']) {
      const obj = d[outer];
      if (typeof obj === 'object' && obj !== null) {
        const o = obj as Record<string, unknown>;
        for (const inner of ['headless', 'alpha', 'release']) {
          if (typeof o[inner] === 'string' && (o[inner] as string).length > 0) {
            return o[inner] as string;
          }
        }
      }
    }
    // 3. 兜底递归
    for (const key of Object.keys(d)) {
      const v = extractVersionFromJson(d[key]);
      if (v) return v;
    }
  }
  return null;
}
