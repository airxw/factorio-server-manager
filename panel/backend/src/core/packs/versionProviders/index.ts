// ============================================================================
// versionProviders/index.ts — VersionProvider 工厂与调度入口
//
// 步骤 1:版本源真实化重构 — 引入 VersionProvider 抽象
//
// 职责:
//   1. 按 pack.versions.provider 字段分派具体 Provider(mojang / official-site /
//      github-release / factorio-official / steamcmd-buildid / static)
//   2. Steam 游戏多源回退:official-site → github-release → steamcmd-buildid → static
//   3. 5 分钟 LRU 缓存(避免每次请求都打远程 API)
//   4. 未声明 provider 时回退到 legacy source_url HTTP fetch(降级兼容,旧 Pack 不需改)
//
// 接入点:
//   - updateService.fetchLatestVersion(source_url) 改为 getProvider(pack).getLatest()
//   - versions.ts 路由的 /available 端点改为 getProvider(pack).listVersions()
// ============================================================================

import type { GamePack } from '@public/schema/pack-schema';
import type { VersionEntry, VersionProvider, LatestVersion, VersionProviderContext } from './types.js';
import { VersionProviderError } from './types.js';
import { MojangVersionProvider } from './mojangProvider.js';
import { OfficialSiteVersionProvider, type OfficialSiteConfig } from './officialSiteProvider.js';
import { GitHubReleaseVersionProvider } from './githubReleaseProvider.js';
import { FactorioVersionProvider } from './factorioProvider.js';
import { SteamCmdBuildIdProvider, type SteamCmdBuildIdConfig } from './steamCmdBuildIdProvider.js';
import {
  StaticVersionProvider,
  FallbackProvider,
  createStaticProviderFromUrl,
} from './staticProvider.js';
import {
  resolveStaticSource,
  STATIC_SOURCE_PREFIX,
  STATIC_VERSION_SOURCES,
  type StaticVersionSource,
} from '../staticVersions.js';

// ---------------------------------------------------------------------------
// Provider 类型枚举(与 pack-schema.ts PackVersionsSchema.provider 对齐)
// ---------------------------------------------------------------------------

export type ProviderType =
  | 'mojang'
  | 'official-site'
  | 'github-release'
  | 'factorio-official'
  | 'steamcmd-buildid'
  | 'static';

// ---------------------------------------------------------------------------
// LRU 缓存(5 分钟 TTL)
// ---------------------------------------------------------------------------

interface CacheEntry {
  value: VersionEntry[] | LatestVersion;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟
const listVersionsCache = new Map<string, CacheEntry>();
const getLatestCache = new Map<string, CacheEntry>();

function cacheKey(packId: string, method: 'list' | 'latest'): string {
  return `${method}:${packId}`;
}

function getCached(map: Map<string, CacheEntry>, key: string): CacheEntry | null {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    map.delete(key);
    return null;
  }
  return entry;
}

function setCached(map: Map<string, CacheEntry>, key: string, value: VersionEntry[] | LatestVersion): void {
  // 简易 LRU:超过 64 条目时删除最旧(MAP 迭代顺序 = 插入顺序)
  if (map.size >= 64) {
    const oldestKey = map.keys().next().value;
    if (oldestKey) map.delete(oldestKey);
  }
  map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** 清空所有缓存(测试/手动刷新用) */
export function clearVersionProviderCache(): void {
  listVersionsCache.clear();
  getLatestCache.clear();
}

// ---------------------------------------------------------------------------
// 缓存装饰器:包装 Provider,自动缓存结果
// ---------------------------------------------------------------------------

class CachedProvider implements VersionProvider {
  constructor(private inner: VersionProvider, private packId: string) {}

  async listVersions(): Promise<VersionEntry[]> {
    const key = cacheKey(this.packId, 'list');
    const cached = getCached(listVersionsCache, key);
    if (cached) return cached.value as VersionEntry[];
    const value = await this.inner.listVersions();
    setCached(listVersionsCache, key, value);
    return value;
  }

  async getLatest(): Promise<LatestVersion> {
    const key = cacheKey(this.packId, 'latest');
    const cached = getCached(getLatestCache, key);
    if (cached) return cached.value as LatestVersion;
    const value = await this.inner.getLatest();
    setCached(getLatestCache, key, value);
    return value;
  }
}

// ---------------------------------------------------------------------------
// 多源回退 Provider(Steam 游戏用)
// ---------------------------------------------------------------------------

/**
 * 多源回退 Provider:按顺序尝试每个 Provider,第一个成功即返回。
 *
 * Steam 游戏优先级:official-site → github-release → steamcmd-buildid → static
 * 任一 Provider 抛 VersionProviderError 时记录并尝试下一个;
 * 全部失败时抛最后一个错误(或 FallbackProvider)。
 */
class FallbackChainProvider implements VersionProvider {
  constructor(
    private packId: string,
    private providers: Array<{ type: string; provider: VersionProvider }>,
  ) {
    if (providers.length === 0) {
      throw new Error('FallbackChainProvider 至少需要一个 Provider');
    }
  }

  async listVersions(): Promise<VersionEntry[]> {
    const errors: string[] = [];
    for (const { type, provider } of this.providers) {
      try {
        return await provider.listVersions();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`[${type}] ${msg}`);
      }
    }
    throw new VersionProviderError(
      `所有 Provider 均失败 (pack=${this.packId}):\n${errors.join('\n')}`,
      'ALL_PROVIDERS_FAILED',
    );
  }

  async getLatest(): Promise<LatestVersion> {
    const errors: string[] = [];
    for (const { type, provider } of this.providers) {
      try {
        return await provider.getLatest();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`[${type}] ${msg}`);
      }
    }
    throw new VersionProviderError(
      `所有 Provider 均失败 (pack=${this.packId}):\n${errors.join('\n')}`,
      'ALL_PROVIDERS_FAILED',
    );
  }
}

// ---------------------------------------------------------------------------
// 主工厂:getProvider(pack, context?)
// ---------------------------------------------------------------------------

/**
 * 按 pack.versions.provider 字段分派 VersionProvider。
 *
 * 调度逻辑:
 *   1. pack.versions.provider 声明 → 按声明的类型构造 Provider;
 *      - Steam 游戏(provider=official-site / github-release / steamcmd-buildid)
 *        自动构建多源回退链(official-site → github-release → steamcmd-buildid → static)
 *   2. 未声明 provider 但 versions.source 以 static:// 开头 → StaticVersionProvider
 *   3. 未声明 provider 但 versions.manifest_url 是 Mojang 官方 → MojangVersionProvider(向后兼容)
 *   4. 完全未声明 → 返回 null(调用方应回退到 legacy HTTP fetch)
 *
 * 所有返回的 Provider 都自动包装 5 分钟缓存。
 *
 * @param pack GamePack
 * @param context 可选上下文(SteamCmdBuildIdProvider 需要 daemonClient/nodeId)
 * @returns VersionProvider 或 null(未声明 provider 且无法推断)
 */
export function getProvider(
  pack: GamePack,
  context?: VersionProviderContext,
): VersionProvider | null {
  const packId = pack.pack.id;
  const versions = pack.versions;
  const declaredProvider = (versions as { provider?: string }).provider;

  // 1. 声明了 provider → 按类型构造
  if (declaredProvider) {
    const provider = buildProviderByType(declaredProvider as ProviderType, pack, context);
    if (provider) {
      // Steam 游戏且声明的不是 static/mojang/factorio 时,构建回退链
      if (
        versions.type === 'steamcmd' &&
        declaredProvider !== 'static' &&
        declaredProvider !== 'mojang' &&
        declaredProvider !== 'factorio-official'
      ) {
        const chain = buildSteamFallbackChain(pack, context, declaredProvider as ProviderType);
        return new CachedProvider(chain, packId);
      }
      return new CachedProvider(provider, packId);
    }
  }

  // 2. 未声明 provider,但 source 是 static:// 协议 → StaticVersionProvider
  if (versions.source.startsWith(STATIC_SOURCE_PREFIX)) {
    const staticProvider = createStaticProviderFromUrl(versions.source, resolveStaticSource);
    if (staticProvider) {
      return new CachedProvider(staticProvider, packId);
    }
  }

  // 3. 未声明 provider,但 manifest_url 是 Mojang 官方 → MojangVersionProvider(向后兼容)
  const manifestUrl = versions.manifest_url;
  if (manifestUrl && isMojangManifest(manifestUrl)) {
    return new CachedProvider(new MojangVersionProvider(manifestUrl), packId);
  }

  // 4. 完全未声明 → null(调用方走 legacy HTTP fetch)
  return null;
}

// ---------------------------------------------------------------------------
// 辅助:按类型构造单个 Provider
// ---------------------------------------------------------------------------

function buildProviderByType(
  type: ProviderType,
  pack: GamePack,
  context?: VersionProviderContext,
): VersionProvider | null {
  const versions = pack.versions as {
    source: string;
    official_url?: string;
    version_regex?: string;
    fallback_buildid?: string;
    manifest_url?: string;
    download_pattern?: string;
    steam_login?: string;
  };

  switch (type) {
    case 'mojang': {
      const url = versions.manifest_url ?? 'https://piston-meta.mojang.com/mc/game/version_manifest.json';
      return new MojangVersionProvider(url);
    }

    case 'official-site': {
      const url = versions.official_url;
      if (!url) {
        throw new VersionProviderError(
          `Pack ${pack.pack.id} 声明 provider=official-site 但未配置 versions.official_url`,
          'OFFICIAL_SITE_NO_URL',
        );
      }
      const config: OfficialSiteConfig = {
        url,
        regex: versions.version_regex,
        fallbackBuildid: versions.fallback_buildid,
      };
      return new OfficialSiteVersionProvider(config);
    }

    case 'github-release': {
      // versions.source 格式: github://owner/repo
      const repo = parseGitHubRepo(versions.official_url ?? versions.source);
      if (!repo) {
        throw new VersionProviderError(
          `Pack ${pack.pack.id} 声明 provider=github-release 但未配置有效的 repo (official_url 或 source 应为 github://owner/repo 或 https://github.com/owner/repo)`,
          'GITHUB_NO_REPO',
        );
      }
      return new GitHubReleaseVersionProvider(repo);
    }

    case 'factorio-official': {
      const url = versions.manifest_url ?? 'https://factorio.com/api/latest-releases';
      return new FactorioVersionProvider(url);
    }

    case 'steamcmd-buildid': {
      // appId 从 versions.source 提取(格式: steamcmd://<appid>)
      const appId = parseSteamAppId(versions.source);
      if (!appId) {
        throw new VersionProviderError(
          `Pack ${pack.pack.id} 声明 provider=steamcmd-buildid 但未配置有效 appId (source 应为 steamcmd://<appid>)`,
          'STEAMCMD_NO_APPID',
        );
      }
      const config: SteamCmdBuildIdConfig = {
        appId,
        daemonClient: context?.daemonClient as SteamCmdBuildIdConfig['daemonClient'],
        nodeId: context?.nodeId,
        serverId: context?.serverId,
      };
      return new SteamCmdBuildIdProvider(config);
    }

    case 'static': {
      // static 协议:versions.source = static://<pack-id>
      const sourceUrl = versions.source.startsWith(STATIC_SOURCE_PREFIX)
        ? versions.source
        : `${STATIC_SOURCE_PREFIX}${pack.pack.id}`;
      const staticSource: StaticVersionSource | null =
        STATIC_VERSION_SOURCES[pack.pack.id] ?? resolveStaticSource(sourceUrl);
      if (!staticSource) {
        return new FallbackProvider(pack.pack.id);
      }
      return new StaticVersionProvider(staticSource);
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 辅助:构建 Steam 游戏多源回退链
// ---------------------------------------------------------------------------

/**
 * 构建 Steam 游戏的多源回退链:official-site → github-release → steamcmd-buildid → static。
 *
 * 已声明的 provider 放在链首,其余按优先级补齐(若 Pack 配置了对应字段)。
 * 静态源始终作为最后兜底(若有)。
 */
function buildSteamFallbackChain(
  pack: GamePack,
  context: VersionProviderContext | undefined,
  declaredType: ProviderType,
): FallbackChainProvider {
  const packId = pack.pack.id;
  const chain: Array<{ type: string; provider: VersionProvider }> = [];

  // 优先级顺序
  const orderedTypes: ProviderType[] = ['official-site', 'github-release', 'steamcmd-buildid', 'static'];
  // 声明的类型放首位
  const finalOrder = [declaredType, ...orderedTypes.filter((t) => t !== declaredType)];

  for (const type of finalOrder) {
    try {
      const provider = buildProviderByType(type, pack, context);
      if (provider) {
        // static 的 FallbackProvider 会抛错,加入链尾意义不大,但保留作为最后兜底
        chain.push({ type, provider });
      }
    } catch {
      // 构造失败(如缺配置)则跳过该源
    }
  }

  if (chain.length === 0) {
    // 全部构造失败,返回仅含 FallbackProvider 的链(必失败但保持接口一致)
    chain.push({ type: 'fallback', provider: new FallbackProvider(packId) });
  }

  return new FallbackChainProvider(packId, chain);
}

// ---------------------------------------------------------------------------
// 辅助:URL/Source 解析
// ---------------------------------------------------------------------------

function isMojangManifest(url: string): boolean {
  return /piston-meta\.mojang\.com|launchermeta\.mojang\.com/i.test(url);
}

/**
 * 解析 GitHub repo。支持:
 *   - github://owner/repo
 *   - https://github.com/owner/repo
 *   - https://api.github.com/repos/owner/repo
 */
function parseGitHubRepo(url: string): string | null {
  if (!url) return null;
  // github://owner/repo
  let m = url.match(/^github:\/\/([^/]+\/[^/]+)$/);
  if (m) return m[1];
  // https://github.com/owner/repo
  m = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)/);
  if (m) return m[1];
  // https://api.github.com/repos/owner/repo
  m = url.match(/^https?:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)/);
  if (m) return m[1];
  return null;
}

/**
 * 解析 Steam App ID。支持:
 *   - steamcmd://<appid>
 *   - 纯数字
 */
function parseSteamAppId(source: string): string | null {
  if (!source) return null;
  const m = source.match(/^steamcmd:\/\/(\d+)$/);
  if (m) return m[1];
  if (/^\d+$/.test(source)) return source;
  return null;
}
