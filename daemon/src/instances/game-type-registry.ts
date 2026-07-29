// ============================================================================
// 游戏类型注册表 — 消除 daemon 中的 switch(gameType) 与硬编码 Set
//
// 设计：
//   - 每个游戏类型通过 adapter 声明自己的元数据（displayName / coreExtensions /
//     signalStop / bootstrap 钩子）
//   - adapter 文件在 import 时自动调用 registerGameType 完成注册
//   - 消费方（bootstrap.ts / manager.ts）通过 getGameType / getSignalStopStrategy
//     查询，无需硬编码游戏列表
//   - 新增游戏类型时只需：①创建 adapter 文件 ②在 adapters/index.ts 注册
//     无需修改 bootstrap.ts / manager.ts
// ============================================================================

import type { Logger } from 'pino';
import type { GamePack } from '@public/schema/pack-schema';
import type { Instance } from './types.js';

/**
 * Bootstrap 上下文：传给 adapter.bootstrap 钩子的输入。
 * 与 bootstrap.ts 的 BootstrapInput 结构一致，保证 helper 函数可直接复用。
 */
export interface BootstrapContext {
  /** 实例对象（含 id / name / workdir / port / rcon_port / rcon_password 等） */
  instance: Instance;
  /** 已加载并通过 schema 校验的 Pack 配置 */
  pack: GamePack;
  /** 游戏类型字符串（等同 pack.pack.game，提取为顶层字段便于使用） */
  gameType: string;
  /** 日志器 */
  logger: Logger;
}

/**
 * 游戏类型适配器接口。
 * 每个游戏类型通过实现此接口声明自己的行为元数据。
 */
export interface GameTypeAdapter {
  /** 游戏类型标识（与 pack-schema.ts GameTypeSchema 中的 enum 值一致） */
  gameType: string;
  /** 人类可读的游戏名称 */
  displayName: string;
  /** 核心文件扩展名（如 ['.jar']），供未来文件管理 / mod 扫描使用 */
  coreExtensions: string[];
  /**
   * 停止策略：
   * - 'stdin'：通过 stop_command（stdin / RCON）发送停止命令
   * - 'sigint'：直接发 SIGINT 信号（适用于无 stdin/RCON 停止通道的 vanilla 游戏）
   * 未设置时默认 'stdin'
   */
  signalStop?: 'stdin' | 'sigint';
  /**
   * Bootstrap 初始化钩子：实例启动前创建 workdir / 下载二进制 / 写配置文件。
   * 不设置时使用通用 bootstrap 逻辑（仅创建 workdir）。
   */
  bootstrap?: (ctx: BootstrapContext) => Promise<void>;
}

// ---------------------------------------------------------------------------
// 注册表核心
// ---------------------------------------------------------------------------

/** 游戏类型注册表：gameType → adapter */
const REGISTRY = new Map<string, GameTypeAdapter>();

/**
 * 注册一个游戏类型 adapter。
 * 同一 gameType 重复注册时后注册的覆盖前者（便于测试覆盖）。
 */
export function registerGameType(adapter: GameTypeAdapter): void {
  REGISTRY.set(adapter.gameType, adapter);
}

/**
 * 获取指定游戏类型的 adapter。
 * @returns adapter 或 undefined（未注册）
 */
export function getGameType(gameType: string): GameTypeAdapter | undefined {
  return REGISTRY.get(gameType);
}

/**
 * 列出所有已注册的游戏类型标识。
 * @returns 游戏类型字符串数组
 */
export function listGameTypes(): string[] {
  return Array.from(REGISTRY.keys());
}

/**
 * 查询指定游戏类型的停止策略。
 * 未注册的游戏类型默认返回 'stdin'（向后兼容）。
 * @returns 'stdin' 或 'sigint'
 */
export function getSignalStopStrategy(gameType: string): 'stdin' | 'sigint' {
  const adapter = REGISTRY.get(gameType);
  return adapter?.signalStop ?? 'stdin';
}

// ---------------------------------------------------------------------------
// 新增游戏类型的流程说明
// ---------------------------------------------------------------------------
//
// 新增游戏类型时，无需修改 bootstrap.ts / manager.ts / pack-schema.ts，
// 只需以下步骤：
//
// 1. 创建 daemon/src/instances/adapters/<new-game>.ts：
//    ```typescript
//    import { registerGameType, type GameTypeAdapter } from '../game-type-registry.js';
//    const adapter: GameTypeAdapter = {
//      gameType: '<new-game>',
//      displayName: 'New Game',
//      coreExtensions: [],
//      signalStop: 'stdin',  // 或 'sigint'
//    };
//    registerGameType(adapter);
//    ```
//
// 2. 在 daemon/src/instances/adapters/index.ts 中添加：
//    ```typescript
//    import './<new-game>.js';
//    ```
//
// 3. 创建 packs/<new-game>/pack.yaml（Pack 配置文件）
//
// 4. 如需在 GameTypeSchema enum 中添加新值（契约变更），
//    需走 public/ 契约变更流程（s0601），不得直接编辑 public/schema/pack-schema.ts
