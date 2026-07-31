// ============================================================================
// 静态版本源（panel 内置）
// ============================================================================
// @deprecated v4.12.0(Pack 系统重构):本模块仅作为离线降级兜底,不再作为主数据源。
//   主数据源改为 VersionProvider(见 ./versionProviders/),每个 Pack 在 pack.yaml
//   声明 versions.provider(mojang/official-site/github-release/factorio-official/
//   steamcmd-buildid/static)。当所有 Provider 不可达时,才回退到本模块的静态数据。
//
// 迁移计划:步骤 4 校正各 Pack 数据并配置真实 provider 后,本模块的过时人造版本数据
//   (factorio 1.1.109 / palworld v0.3.3.54124 / terraria v5.2.0)将被移除。
//   当前保留仅为迁移期间的兼容兜底,新 Pack 不应再依赖本模块。
//
// 背景：Steam 官方未提供稳定的版本清单 JSON API。pack.yaml 中的
// `update.source_url` 如设为 `https://example.com/...` 占位 URL，
// versions.ts 的 fetch 会拿到 example.com 的 HTML 首页，
// 触发 `Unexpected token '<' ... is not valid JSON` 500 错误。
//
// 本模块提供 `static://<pack-id>` 协议：pack.yaml 将 source_url 设为
// `static://factorio-vanilla` 之类的内部协议，由 versions.ts 拦截并
// 从下方 STATIC_VERSION_SOURCES 读取版本列表，使版本管理页可用。
//
// 数据来源：人工整理的近期公开版本号（label 性质；SteamCMD +app_update
// 会按 depot 实际版本下载，label 仅用于展示与已下载状态比对）。
// ============================================================================

export interface StaticVersionEntry {
  id: string;
  type: 'release' | 'experimental' | 'snapshot';
}

export interface StaticVersionSource {
  latest: { release: string; snapshot?: string };
  versions: StaticVersionEntry[];
}

/** 内置静态版本源（key = pack.yaml 的 pack.id） */
export const STATIC_VERSION_SOURCES: Record<string, StaticVersionSource> = {
  // 异星工厂 (App ID 422080)
  'factorio-vanilla': {
    latest: { release: '1.1.109', snapshot: '2.0.0' },
    versions: [
      { id: '2.0.0', type: 'experimental' },
      { id: '1.1.109', type: 'release' },
      { id: '1.1.107', type: 'release' },
      { id: '1.1.104', type: 'release' },
      { id: '1.0.0', type: 'release' },
    ],
  },

  // 幻兽帕鲁 (App ID 2394010;v4.39.3 修正:原 2374020 不存在,官方实锤 2394010)
  'palworld-vanilla': {
    latest: { release: 'v0.3.3.54124' },
    versions: [
      { id: 'v0.3.3.54124', type: 'release' },
      { id: 'v0.3.2', type: 'release' },
      { id: 'v0.2.4', type: 'release' },
      { id: 'v0.1.5', type: 'release' },
    ],
  },

  // 泰拉瑞亚 (TShock - 独立于 SteamCMD)
  'terraria-vanilla': {
    latest: { release: 'v5.2.0' },
    versions: [
      { id: 'v5.2.0', type: 'release' },
      { id: 'v5.1.3', type: 'release' },
      { id: 'v4.5.0', type: 'release' },
    ],
  },
};

/** 静态协议前缀 */
export const STATIC_SOURCE_PREFIX = 'static://';

/**
 * 解析静态协议 URL，返回对应的版本源；若不是 static:// 协议或 pack 未配置，
 * 返回 null（调用方应回退到 HTTP fetch）。
 */
export function resolveStaticSource(sourceUrl: string): StaticVersionSource | null {
  if (!sourceUrl.startsWith(STATIC_SOURCE_PREFIX)) return null;
  const packKey = sourceUrl.slice(STATIC_SOURCE_PREFIX.length).replace(/\/+$/, '');
  if (!packKey) return null;
  return STATIC_VERSION_SOURCES[packKey] ?? null;
}
