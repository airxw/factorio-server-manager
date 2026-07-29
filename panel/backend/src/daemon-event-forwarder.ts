// ============================================================================
// Daemon 事件 → Panel→Frontend 事件 转发
// 从 index.ts 拆分而来，行为等价。
// P0 简化：instance_id === server_id
// state.change / instance.started / instance.stopped → 转为 instance.state 事件
// console.output → 直接转发（字段名替换 instance_id → server_id）
// ============================================================================

import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { DaemonToPanelEvent, PanelToFrontendEvent } from '@public/schema/ws-events';
import type { InstanceState } from '@public/schema/daemon-api-types';
import { PanelWsServer } from './websocket/server.js';

export async function forwardDaemonEvent(
  db: Knex,
  wsServer: PanelWsServer,
  event: DaemonToPanelEvent,
  log: Logger,
): Promise<void> {
  switch (event.type) {
    case 'connected': {
      // 仅日志，不转发到前端
      log.info(
        { daemon_id: event.daemon_id, daemon_version: event.daemon_version },
        'Daemon connected 事件',
      );
      return;
    }
    case 'instance.started':
    case 'instance.stopped':
    case 'state.change': {
      const serverId = event.instance_id;
      const newState = resolveStateFromEvent(event);
      if (newState !== null) {
        // 同步 DB 状态
        try {
          await db('servers').where({ id: serverId }).update({
            status: newState,
            updated_at: new Date().toISOString(),
          });
        } catch (err) {
          log.warn(
            { err: err instanceof Error ? err.message : String(err), serverId },
            '同步 Daemon 状态到 DB 失败',
          );
        }
        const panelEvent: PanelToFrontendEvent = {
          type: 'instance.state',
          timestamp: event.timestamp,
          server_id: serverId,
          state: newState,
        };
        wsServer.broadcastToServer(serverId, panelEvent);
      }
      return;
    }
    case 'console.output': {
      const panelEvent: PanelToFrontendEvent = {
        type: 'console.output',
        timestamp: event.timestamp,
        server_id: event.instance_id,
        line: event.line,
        stream: event.stream,
      };
      wsServer.broadcastToServer(event.instance_id, panelEvent);
      return;
    }
    default: {
      // 穷尽性检查
      const _exhaustive: never = event;
      log.warn({ event: _exhaustive }, '未知 Daemon 事件类型');
      return;
    }
  }
}

/**
 * 从 Daemon 状态事件解析新的 InstanceState
 */
export function resolveStateFromEvent(event: DaemonToPanelEvent): InstanceState | null {
  switch (event.type) {
    case 'instance.started':
      return 'running';
    case 'instance.stopped':
      return 'stopped';
    case 'state.change':
      return event.to;
    default:
      return null;
  }
}
