// ============================================================================
// modDependencyParser — Mod info 文件解析（多游戏格式）
// 支持：
//   - Factorio: info.json (name, version, dependencies)
//   - Minecraft Fabric: fabric.mod.json (id, version, depends)
//   - tModLoader: modinfo.json (modName, version, modReferences)
//   - Minecraft Forge: mods.toml 为 TOML 格式，本项目不引入 TOML 依赖，暂不支持
// 纯解析模块（无 IO 依赖），便于单测与复用
// ============================================================================

/** 单个 Mod 依赖项 */
export interface ModDependency {
  name: string;
  /** 版本要求（如 ">=1.0.0"、"*"），可选 */
  version?: string;
  /** 是否可选依赖（缺失不视为冲突） */
  optional?: boolean;
}

/** 解析后的 Mod 元信息 */
export interface ModInfo {
  name: string;
  version: string;
  dependencies: ModDependency[];
}

/** 支持的解析格式 */
export type ModInfoFormat = 'factorio' | 'fabric' | 'forge' | 'tmodloader';

/**
 * 解析 mod info 文件内容
 * @param content 文件文本内容
 * @param format 目标游戏格式
 * @returns 解析成功返回 ModInfo，解析失败或格式不支持返回 null
 */
export function parseModInfo(
  content: string,
  format: ModInfoFormat,
): ModInfo | null {
  try {
    switch (format) {
      case 'factorio':
        return parseFactorioInfo(JSON.parse(content) as FactorioInfoJson);
      case 'fabric':
        return parseFabricInfo(JSON.parse(content) as FabricInfoJson);
      case 'tmodloader':
        return parseTModLoaderInfo(JSON.parse(content) as TModLoaderInfoJson);
      case 'forge':
        // Forge 的 mods.toml 为 TOML 格式，本项目不引入 TOML 依赖，暂不支持
        return null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ----- 各格式解析实现 -----

// Factorio info.json: { name, version, dependencies: ["base", "? some-mod >= 1.0.0"] }
//   依赖字符串格式：
//     "base"                 — 游戏本体（过滤）
//     "? optional-mod"       — 可选依赖
//     "! incompatible-mod"   — 不兼容声明（非依赖，过滤）
//     "mod >= 1.0.0"         — 带版本要求
interface FactorioInfoJson {
  name?: string;
  version?: string;
  dependencies?: string[];
}
function parseFactorioInfo(json: FactorioInfoJson): ModInfo {
  const deps: ModDependency[] = (json.dependencies ?? [])
    .map((d): ModDependency | null => {
      // 不兼容声明（!）不是依赖，跳过
      if (d.startsWith('!')) return null;
      const optional = d.startsWith('?');
      const cleaned = d.replace(/^[?!]\s*/, '');
      // 按版本比较符拆分：>= <= > < =
      const parts = cleaned.split(/\s*>=?\s*|\s*<=?\s*|\s*=\s*/);
      return {
        name: parts[0]?.trim() ?? '',
        version: parts[1]?.trim(),
        optional,
      };
    })
    .filter((d): d is ModDependency => d !== null && d.name !== 'base' && d.name !== '');
  return {
    name: json.name ?? '',
    version: json.version ?? '',
    dependencies: deps,
  };
}

// Fabric mod.json: { id, version, depends: { "fabric-api": "*" } }
//   depends 为对象时 key=依赖名、value=版本范围（字符串或字符串数组）
interface FabricInfoJson {
  id?: string;
  version?: string;
  depends?: Record<string, unknown>;
}
function parseFabricInfo(json: FabricInfoJson): ModInfo {
  const deps: ModDependency[] = Object.entries(json.depends ?? {}).map(([name, version]) => ({
    name,
    version: typeof version === 'string' ? version : undefined,
  }));
  return {
    name: json.id ?? '',
    version: json.version ?? '',
    dependencies: deps,
  };
}

// tModLoader modinfo.json: { modName, version, modReferences: ["modA"] }
interface TModLoaderInfoJson {
  modName?: string;
  version?: string;
  modReferences?: string[];
}
function parseTModLoaderInfo(json: TModLoaderInfoJson): ModInfo {
  const deps: ModDependency[] = (json.modReferences ?? []).map((name) => ({ name }));
  return {
    name: json.modName ?? '',
    version: json.version ?? '',
    dependencies: deps,
  };
}
