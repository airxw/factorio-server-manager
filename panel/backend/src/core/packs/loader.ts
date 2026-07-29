// ============================================================================
// Pack YAML 加载器
// 读取 packs/*.yaml 文件，用 js-yaml 解析，用 public/schema/pack-schema.ts 的 zod schema 校验
// 支持完整 Pack schema（含 items / event_parsers / business / commands 扩展字段）
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  GamePackSchema,
  type GamePack,
  type GamePackRaw,
  type PackBusiness,
  type PackEventParsers,
  type UITabEntry,
  type UITabObject,
} from '@public/schema/pack-schema';
import type { PackRegistry } from './registry.js';
// B4: 读取 Panel 版本号用于 Pack 版本兼容性检查
import panelPkg from '../../../package.json' with { type: 'json' };

/**
 * v3.7.0: 将 ui.tabs 规范化为对象数组格式
 * - string 形式 → { tab: <string>, group: 'runtime' }
 * - object 形式 → 原样保留（补充默认 group=runtime / order=100）
 *
 * 这样下游（前端 / API）始终拿到统一的对象数组，无需处理两种格式
 */
function normalizeUITabs(pack: GamePackRaw): GamePack {
  const tabs = pack.ui?.tabs;
  if (!tabs || tabs.length === 0) {
    // 空数组场景：仍按 GamePack 类型要求返回空 UITabObject[]
    return { ...pack, ui: { tabs: [] } } as GamePack;
  }

  const normalized: UITabObject[] = tabs.map((entry: UITabEntry) => {
    if (typeof entry === 'string') {
      // 字符串形式：默认归到 runtime 组
      return { tab: entry, group: inferTabGroup(entry), order: 100 };
    }
    // 对象形式：补充默认 group / order
    return {
      tab: entry.tab,
      group: entry.group ?? inferTabGroup(entry.tab),
      order: entry.order ?? 100,
      require_state: entry.require_state,
    };
  });

  return {
    ...pack,
    ui: { tabs: normalized },
  } as GamePack;
}

/**
 * v3.7.0: 根据 tab 名推断默认分组（用于字符串形式或对象未指定 group 时）
 */
function inferTabGroup(tab: string): 'runtime' | 'config' | 'ops' | 'business' {
  switch (tab) {
    case 'console':
    case 'log-files':
    case 'logs':
    case 'players':
    case 'player-histories':
    case 'monitor':
    case 'game-command-help':
      return 'runtime';
    case 'config':
    case 'config-files':
    case 'world-gen':
      return 'config';
    case 'saves':
    case 'mods':
    case 'update':
    case 'backups':
      return 'ops';
    case 'shop-admin':
    case 'cdk-admin':
    case 'chat-logs':
    case 'chat-triggers':
    case 'player-join-settings':
    case 'vote-settings':
      return 'business';
    default:
      return 'runtime';
  }
}

/**
 * 加载单个 YAML 文件并校验
 *
 * B3: Schema 严格校验——必填字段缺失 → 拒绝加载 + 明确错误日志（含文件路径和 zod 错误详情）
 * B4: 版本兼容性检查——Pack 声明 min_panel_version 时，比对当前 Panel 版本，不兼容则拒绝加载
 * v3.7.0: 加载后规范化 ui.tabs 为对象数组格式
 *
 * @param filePath YAML 文件绝对路径
 * @returns 校验通过返回 GamePack，否则抛出异常
 */
export function loadPackFile(filePath: string): GamePack {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = yaml.load(raw) as unknown;
  const result = GamePackSchema.safeParse(parsed);
  if (!result.success) {
    // B3: 明确错误日志——必填字段缺失或类型不匹配时，输出详细错误信息
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Pack YAML 校验失败 [${filePath}]:\n${issues}`);
  }

  // B4: 版本兼容性检查
  // zod schema 会 strip 未知字段（如 min_panel_version），因此从原始 parsed 对象读取
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const rawObj = parsed as Record<string, unknown>;
    const minPanelVersion = rawObj['min_panel_version'];
    if (typeof minPanelVersion === 'string' && minPanelVersion.length > 0) {
      const currentVersion = panelPkg.version;
      if (!isVersionCompatible(currentVersion, minPanelVersion)) {
        throw new Error(
          `Pack 版本不兼容 [${filePath}]: 要求 Panel >= ${minPanelVersion}，当前 ${currentVersion}`,
        );
      }
    }
  }

  // v3.7.0: 规范化 ui.tabs 为对象数组
  return normalizeUITabs(result.data);
}

/**
 * 从目录加载所有 Pack YAML 文件
 *
 * B3: 校验失败的文件使用 console.error 记录明确错误（含文件路径和错误详情），不再仅 warn
 *
 * @param dir 包含 *.yaml 文件的目录
 * @returns 校验通过的 GamePack 数组（校验失败的文件会被跳过并记录错误日志）
 */
export function loadPacksFromDir(dir: string): GamePack[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const packs: GamePack[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subDir = path.join(dir, entry.name);
      const packFile = path.join(subDir, 'pack.yaml');
      if (fs.existsSync(packFile)) {
        try {
          packs.push(loadPackFile(packFile));
        } catch (e) {
          // B3: 明确错误日志（必填字段缺失/版本不兼容等）
          console.error(`[packs] 跳过无效 Pack（加载失败）: ${packFile}\n  原因: ${(e as Error).message}`);
        }
      }
    } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
      const filePath = path.join(dir, entry.name);
      try {
        packs.push(loadPackFile(filePath));
      } catch (e) {
        // B3: 明确错误日志
        console.error(`[packs] 跳过无效 Pack（加载失败）: ${filePath}\n  原因: ${(e as Error).message}`);
      }
    }
  }

  return packs;
}

/**
 * 校验 Pack YAML 文本是否符合 schema（不写入磁盘/缓存）。
 * @param packYaml YAML 文本
 * @returns valid=true 表示可注册；errors 为错误清单
 */
export function validatePackYaml(packYaml: string): { valid: boolean; errors?: string[] } {
  let parsed: unknown;
  try {
    parsed = yaml.load(packYaml);
  } catch (e) {
    return { valid: false, errors: [`YAML 解析失败: ${(e as Error).message}`] };
  }
  const result = GamePackSchema.safeParse(parsed);
  if (result.success) {
    return { valid: true };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  };
}

/**
 * PackLoader — 实现 pack-loader.d.ts 接口契约（同步版本）。
 * 包装 PackRegistry，提供 load / validate / getBusinessConfig / getEventParsers /
 * register / list 方法。load/getBusinessConfig/getEventParsers 在 pack 不存在时返回 null。
 */
export class PackLoader {
  constructor(private readonly registry: PackRegistry) {}

  /** 按 packId 加载完整 GamePack（含扩展字段）。不存在返回 null */
  load(packId: string): GamePack | null {
    return this.registry.get(packId) ?? null;
  }

  /** 校验 Pack YAML 文本是否符合 schema */
  validate(packYaml: string): { valid: boolean; errors?: string[] } {
    return validatePackYaml(packYaml);
  }

  /** 获取 Pack 的业务能力声明。不存在或未配置返回 null */
  getBusinessConfig(packId: string): PackBusiness | null {
    return this.registry.getBusinessConfig(packId);
  }

  /** 获取 Pack 的事件解析规则。不存在或未配置返回 null */
  getEventParsers(packId: string): PackEventParsers | null {
    return this.registry.getEventParsers(packId);
  }

  /**
   * 注册新 Pack。从 packPath 加载 YAML 并校验后写入 registry 缓存。
   * B3: 加载失败时使用 console.error 记录明确错误，不抛出致命错误。
   */
  register(packPath: string): void {
    try {
      const pack = loadPackFile(packPath);
      this.registry.register(pack);
    } catch (e) {
      console.error(`[packs] 注册失败，跳过: ${packPath}\n  原因: ${(e as Error).message}`);
    }
  }

  /** 列出全部已注册 Pack */
  list(): GamePack[] {
    return this.registry.listAll();
  }
}

// ----- B4 辅助函数 -----

/**
 * 简单语义版本比较（支持 x.y / x.y.z 格式）。
 *
 * @param current 当前版本（如 "3.1.0"）
 * @param required 最低要求版本（如 "3.0.0"）
 * @returns true 表示 current >= required
 */
function isVersionCompatible(current: string, required: string): boolean {
  const currentParts = parseVersionParts(current);
  const requiredParts = parseVersionParts(required);
  const maxLen = Math.max(currentParts.length, requiredParts.length);
  for (let i = 0; i < maxLen; i++) {
    const c = currentParts[i] ?? 0;
    const r = requiredParts[i] ?? 0;
    if (c > r) return true;
    if (c < r) return false;
  }
  return true; // 完全相等
}

/** 将版本字符串解析为数字数组（如 "3.1.0" → [3, 1, 0]） */
function parseVersionParts(version: string): number[] {
  return version
    .split('.')
    .map((part) => {
      const n = parseInt(part, 10);
      return isNaN(n) ? 0 : n;
    });
}
