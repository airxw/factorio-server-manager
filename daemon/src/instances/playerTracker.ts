// ============================================================================
// 模块4_Daemon实例管理 — PlayerTracker
// 职责：内存追踪各实例的在线玩家列表（join/leave 事件驱动）
// 参考实现：factorio/backend/src/services/playerTracker.ts
// ============================================================================

/** 在线玩家信息。 */
export interface OnlinePlayer {
  username: string;
  /** 加入时间（Unix 毫秒） */
  joinedAt: number;
}

/**
 * PlayerTracker — 在线玩家内存追踪器。
 *
 * 数据结构：Map<instanceId, Map<playerName, OnlinePlayer>>
 * - 每个实例维护独立的在线玩家列表
 * - 通过 recordJoin/recordLeave 方法由日志解析层或协议层驱动
 * - 实例停止时调用 clearInstance 清理，避免内存泄漏
 */
export class PlayerTracker {
  /** 实例ID → (玩家名 → OnlinePlayer) */
  private readonly instancePlayers = new Map<string, Map<string, OnlinePlayer>>();

  /** 获取或创建实例的玩家 Map。 */
  private getOrCreateMap(instanceId: string): Map<string, OnlinePlayer> {
    let m = this.instancePlayers.get(instanceId);
    if (!m) {
      m = new Map();
      this.instancePlayers.set(instanceId, m);
    }
    return m;
  }

  /**
   * 记录玩家加入实例。
   * 若玩家已在列表中（重复 join 事件），更新 joinedAt 时间戳。
   * @param instanceId 实例 ID
   * @param playerName 玩家名
   */
  recordJoin(instanceId: string, playerName: string): void {
    const players = this.getOrCreateMap(instanceId);
    players.set(playerName, {
      username: playerName,
      joinedAt: Date.now(),
    });
  }

  /**
   * 记录玩家离开实例。
   * 若玩家不在列表中（重复 leave 事件），静默忽略。
   * @param instanceId 实例 ID
   * @param playerName 玩家名
   */
  recordLeave(instanceId: string, playerName: string): void {
    const players = this.instancePlayers.get(instanceId);
    if (players) {
      players.delete(playerName);
    }
  }

  /**
   * 获取指定实例的在线玩家列表（按加入时间升序）。
   * @param instanceId 实例 ID
   * @returns 在线玩家数组；实例不存在时返回空数组
   */
  getOnlinePlayers(instanceId: string): OnlinePlayer[] {
    const players = this.instancePlayers.get(instanceId);
    if (!players) return [];
    return Array.from(players.values()).sort((a, b) => a.joinedAt - b.joinedAt);
  }

  /**
   * 获取指定实例的在线玩家数量。
   * @param instanceId 实例 ID
   * @returns 在线人数；实例不存在时返回 0
   */
  getOnlineCount(instanceId: string): number {
    const players = this.instancePlayers.get(instanceId);
    return players ? players.size : 0;
  }

  /**
   * 清理指定实例的在线玩家列表。
   * 实例停止时调用，避免内存泄漏。
   * @param instanceId 实例 ID
   */
  clearInstance(instanceId: string): void {
    this.instancePlayers.delete(instanceId);
  }
}
