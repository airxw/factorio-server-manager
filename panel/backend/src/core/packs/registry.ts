// ============================================================================
// Pack 注册表 — 运行时 Pack 元信息管理
// 从 packs/ 目录加载 YAML，缓存到内存，供 API 查询
// 支持完整 Pack schema（含 items / event_parsers / business / commands 扩展字段）
// ============================================================================

import type {
  GamePack,
  GameType,
  PackBusiness,
  PackCommands,
  PackEventParsers,
} from '@public/schema/pack-schema';
import { loadPacksFromDir } from './loader.js';

export class PackRegistry {
  private packs: Map<string, GamePack> = new Map();

  /**
   * 从目录加载所有 Pack YAML，替换当前缓存
   * @param dir 包含 Pack 子目录的根目录
   */
  loadFromDir(dir: string): GamePack[] {
    const loaded = loadPacksFromDir(dir);
    this.packs.clear();
    for (const pack of loaded) {
      const id = pack.pack.id;
      this.packs.set(id, pack);
    }
    return loaded;
  }

  /**
   * 按 ID 获取 Pack
   */
  get(packId: string): GamePack | undefined {
    return this.packs.get(packId);
  }

  /**
   * 按游戏类型过滤 Pack
   */
  listByGame(game: GameType): GamePack[] {
    return Array.from(this.packs.values()).filter((p) => p.pack.game === game);
  }

  /**
   * 列出所有 Pack
   */
  listAll(): GamePack[] {
    return Array.from(this.packs.values());
  }

  /**
   * 已加载的 Pack 数量
   */
  size(): number {
    return this.packs.size;
  }

  // ---- 扩展方法（C-3 完整 Pack schema） ----

  /**
   * 按 packId 加载完整 GamePack（含扩展字段）。不存在返回 null
   */
  load(packId: string): GamePack | null {
    return this.packs.get(packId) ?? null;
  }

  /**
   * 注册单个 Pack 到缓存（覆盖同 id）。用于 PackLoader.register
   */
  register(pack: GamePack): void {
    this.packs.set(pack.pack.id, pack);
  }

  /**
   * 列出全部已注册 Pack（listAll 别名，匹配 pack-loader.d.ts 命名）
   */
  list(): GamePack[] {
    return this.listAll();
  }

  /**
   * 获取 Pack 的业务能力声明（GamePack.business）。
   * 业务模块加载器据此实例化对应服务。不存在或未配置返回 null
   */
  getBusinessConfig(packId: string): PackBusiness | null {
    const pack = this.packs.get(packId);
    return pack?.business ?? null;
  }

  /**
   * 获取 Pack 的事件解析规则（GamePack.event_parsers）。
   * chatMonitor / joinHandler 据此解析 stdout。不存在或未配置返回 null
   */
  getEventParsers(packId: string): PackEventParsers | null {
    const pack = this.packs.get(packId);
    return pack?.event_parsers ?? null;
  }

  /**
   * 获取 Pack 的通用运维命令模板（GamePack.commands）。
   * commandDispatcher 据此渲染命令。不存在返回 null
   */
  getCommands(packId: string): PackCommands | null {
    const pack = this.packs.get(packId);
    return pack?.commands ?? null;
  }
}
