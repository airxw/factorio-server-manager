// ============================================================================
// PlayerSessionReporter — 玩家会话上报器（v4.13.0 步骤18b 防假闭合写入链路）
//
// 职责：
//   在 daemon 检测到玩家 join/leave 事件时，通过 HTTP POST 上报到 Panel，
//   Panel 写入 player_sessions 表，供时长统计 API 聚合查询。
//
// 设计原则：
//   - fire-and-forget：不阻塞 daemon 主流程，失败只记日志
//   - 可降级：未配置 PANEL_API_URL / DAEMON_REPORT_KEY 时自动降级为 no-op
//   - 不影响 PlayerTracker 内存追踪（两者独立运行）
//
// 环境变量：
//   PANEL_API_URL       — Panel API 地址（如 http://localhost:3002）
//   DAEMON_REPORT_KEY   — 上报密钥（与 Panel 的 DAEMON_REPORT_KEY 一致）
//
// 闭合判据：grep -rn "player_sessions" daemon/src/ 确认写入链路存在
// ============================================================================

import type { Logger } from 'pino';

interface ReporterConfig {
  panelApiUrl: string;
  reportKey: string;
}

/**
 * 玩家会话上报器。
 *
 * 在 PlayerTracker.recordJoin/recordLeave 后调用 reportJoin/reportLeave，
 * 通过 HTTP POST 将事件上报到 Panel 的 /api/daemon/player-sessions/* 端点。
 *
 * 未配置环境变量时降级为 no-op，不影响 daemon 正常运行。
 */
export class PlayerSessionReporter {
  private readonly config: ReporterConfig | null;
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
    const panelApiUrl = process.env.PANEL_API_URL;
    const reportKey = process.env.DAEMON_REPORT_KEY;
    if (panelApiUrl && reportKey) {
      this.config = { panelApiUrl: panelApiUrl.replace(/\/$/, ''), reportKey };
      logger.info({ panelApiUrl }, 'playerSessionReporter: enabled');
    } else {
      this.config = null;
      logger.info('playerSessionReporter: disabled (PANEL_API_URL or DAEMON_REPORT_KEY not set)');
    }
  }

  /** 上报玩家加入实例（写入 player_sessions 表） */
  reportJoin(instanceId: string, playerName: string): void {
    if (!this.config) return;
    void this.fireAndForget('/api/daemon/player-sessions/join', {
      instance_id: instanceId,
      game_player_name: playerName,
      join_at: new Date().toISOString(),
    });
  }

  /** 上报玩家离开实例（更新 player_sessions 表的 leave_at + duration_seconds） */
  reportLeave(instanceId: string, playerName: string): void {
    if (!this.config) return;
    void this.fireAndForget('/api/daemon/player-sessions/leave', {
      instance_id: instanceId,
      game_player_name: playerName,
      leave_at: new Date().toISOString(),
    });
  }

  /** 是否已启用（用于测试断言） */
  isEnabled(): boolean {
    return this.config !== null;
  }

  // -----------------------------------------------------------------------
  // 内部方法
  // -----------------------------------------------------------------------

  /**
   * fire-and-forget HTTP POST。
   * 不抛异常，失败只记 warn 日志（不影响 daemon 主流程）。
   */
  private async fireAndForget(path: string, body: Record<string, unknown>): Promise<void> {
    try {
      const url = `${this.config!.panelApiUrl}${path}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-report-key': this.config!.reportKey,
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        this.logger.warn(
          {
            path,
            status: resp.status,
            instance_id: body.instance_id,
            player: body.game_player_name,
          },
          'playerSessionReporter: report failed',
        );
      }
    } catch (err) {
      this.logger.warn(
        {
          path,
          err: err instanceof Error ? err.message : String(err),
          instance_id: body.instance_id,
        },
        'playerSessionReporter: report error (Panel unreachable)',
      );
    }
  }
}
