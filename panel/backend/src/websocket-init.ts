// ============================================================================
// WebSocket + DaemonEventStream 初始化
// 从 index.ts 拆分而来，行为等价。
// 职责：
//   1. 创建 PanelWsServer（v4.4.0-N1 引用计数模式）
//   2. 创建 DaemonEventStream（含 onEvent/onConnect 回调 + dispatchPackConsoleEvents 闭包）
// 注意：wsServer 先于 daemonEventStream 创建，通过 ref holder 延迟绑定订阅回调。
// ============================================================================

import type { Logger } from 'pino';
import type { Knex } from 'knex';
import type http from 'node:http';
import type { PackRegistry } from './core/packs/registry.js';
import type { DaemonToPanelEvent } from '@public/schema/ws-events';
import { PanelWsServer } from './websocket/server.js';
import { DaemonEventStream } from './daemonClient/eventStream.js';
import { DaemonHttpClient } from './daemonClient/client.js';
import { forwardDaemonEvent } from './daemon-event-forwarder.js';
import { eventBus, PLAYER_JOIN, PLAYER_LEAVE, CHAT_EVENT } from './services/eventBus.js';
import type { ServiceContainer } from './services-init.js';

export interface WebSocketDeps {
  db: Knex;
  registry: PackRegistry;
  services: ServiceContainer;
  logger: Logger;
  JWT_SECRET: string;
  DAEMON_URL: string;
  DAEMON_TOKEN: string;
}

export interface WebSocketResult {
  wsServer: PanelWsServer;
  daemonEventStream: DaemonEventStream;
}

export function initWebSocket(server: http.Server, deps: WebSocketDeps): WebSocketResult {
  const { db, registry, services, logger, JWT_SECRET, DAEMON_URL, DAEMON_TOKEN } = deps;
  const { alertService, playerService, chatLogService } = services;

  // daemonEventStream 引用持有者：daemonEventStream 在 wsServer 之后创建，
  // 用 ref holder 让 wsServer 的 onServerSubscribe/onServerUnsubscribe 回调
  // 延迟访问已初始化的实例
  const ref: { current: DaemonEventStream | undefined } = { current: undefined };

  // v4.4.0-N1: PanelWsServer 引用计数回调
  //   第一个前端订阅某 serverId 时 → daemonEventStream.subscribe(serverId)
  //   最后一个前端取消订阅时 → daemonEventStream.unsubscribe(serverId)
  // 这使得 Panel → Daemon 的订阅完全由前端需求驱动，无人观看的实例不再占用 Daemon 订阅资源
  const wsServer = new PanelWsServer(server, JWT_SECRET, {
    onServerSubscribe: (serverId) => ref.current?.subscribe(serverId),
    onServerUnsubscribe: (serverId) => ref.current?.unsubscribe(serverId),
  });
  logger.info('WebSocket 服务端已挂载到 /ws（v4.4.0-N1 引用计数模式）');

  // 6.1 Daemon WS 事件流：把 Daemon 事件转成 Panel→Frontend 事件并转发
  //   P0 简化：instance_id === server_id（同机单节点，Panel server.id 即 Daemon instance id）
  //   Task 10.4: console.output 事件额外触发 Pack event_parsers 解析，
  //              自动调用 playerService.recordJoin/recordLeave + chatLogService.parseAndStore
  const packEventRegexCache = new Map<string, { join?: RegExp; leave?: RegExp; chat?: RegExp }>();
  const dispatchPackConsoleEvents = async (serverId: string, line: string): Promise<void> => {
    try {
      const row = await db('servers').where({ id: serverId }).select('pack_id').first();
      if (!row) return;
      const packId: string = row.pack_id;
      const eventParsers = registry.getEventParsers(packId);
      if (!eventParsers) return;

      let cache = packEventRegexCache.get(packId);
      if (!cache) {
        cache = {
          join: eventParsers.join ? new RegExp(eventParsers.join.pattern) : undefined,
          leave: eventParsers.leave ? new RegExp(eventParsers.leave.pattern) : undefined,
          chat: eventParsers.chat ? new RegExp(eventParsers.chat.pattern) : undefined,
        };
        packEventRegexCache.set(packId, cache);
      }

      if (eventParsers.join && cache.join) {
        const m = cache.join.exec(line);
        if (m && m[eventParsers.join.player_group]) {
          const playerName = m[eventParsers.join.player_group];
          eventBus.emit(PLAYER_JOIN, { server_id: serverId, player_name: playerName });
          try {
            await playerService.recordJoin(serverId, playerName);
          } catch (err) {
            logger.warn({ err: err instanceof Error ? err.message : String(err), serverId, playerName }, 'playerService.recordJoin 失败');
          }
        }
      }

      if (eventParsers.leave && cache.leave) {
        const m = cache.leave.exec(line);
        if (m && m[eventParsers.leave.player_group]) {
          const playerName = m[eventParsers.leave.player_group];
          eventBus.emit(PLAYER_LEAVE, { server_id: serverId, player_name: playerName });
          try {
            await playerService.recordLeave(serverId, playerName);
          } catch (err) {
            logger.warn({ err: err instanceof Error ? err.message : String(err), serverId, playerName }, 'playerService.recordLeave 失败');
          }
        }
      }

      // chat 解析：用 eventParsers.chat 正则匹配，命中则 emit CHAT_EVENT（触发关键词响应订阅者）
      if (eventParsers.chat && cache.chat && eventParsers.chat.groups) {
        const cm = cache.chat.exec(line);
        if (cm) {
          const groups = eventParsers.chat.groups;
          const playerIdx = groups.indexOf('player') + 1;
          const messageIdx = groups.indexOf('message') + 1;
          if (playerIdx > 0 && messageIdx > 0 && cm[playerIdx] && cm[messageIdx]) {
            eventBus.emit(CHAT_EVENT, {
              server_id: serverId,
              player: cm[playerIdx],
              message: cm[messageIdx],
            });
          }
        }
      }

      // chat 日志持久化委托给 chatLogService（内部已缓存正则 + 处理 storage_enabled）
      try {
        await chatLogService.parseAndStore(serverId, line);
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err), serverId }, 'chatLogService.parseAndStore 失败');
      }
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), serverId }, 'dispatchPackConsoleEvents 失败');
    }
  };

  const daemonEventStream = new DaemonEventStream({
    baseUrl: DAEMON_URL,
    token: DAEMON_TOKEN,
    onEvent: (event: DaemonToPanelEvent) => {
      // v4.6.0-F3: 在转发前先做异常退出告警判定（instance.stopped 且非用户主动 stop）
      if (event.type === 'instance.stopped') {
        void (async () => {
          try {
            const server = await db<{ id: string; name: string; status: string; updated_at: string }>('servers')
              .where({ id: event.instance_id })
              .select('id', 'name', 'status', 'updated_at')
              .first();
            if (server) {
              // 简化判定：如果 5 秒前状态不是 'stopping'，则视为异常退出
              // （用户主动 stop 会先经过 stop API 端点把 DB status 改为 'stopping'）
              const updatedAt = Date.parse(server.updated_at);
              const isAbnormalExit = !Number.isFinite(updatedAt) || (Date.now() - updatedAt > 5_000 && server.status !== 'stopping');
              if (isAbnormalExit) {
                await alertService.triggerInstanceAbnormalExit(server.id, server.name, -1);
              }
            }
          } catch (err) {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err), serverId: event.instance_id },
              '触发 instance_abnormal_exit 告警失败',
            );
          }
        })();
      }
      forwardDaemonEvent(db, wsServer, event, logger);
      if (event.type === 'console.output') {
        void dispatchPackConsoleEvents(event.instance_id, event.line);
      }
    },
    onConnect: () => {
      logger.info('Daemon WS 已连接，事件流就绪');
      // v4.4.0-N1: 重连后全量状态同步：拉取 Daemon 实例列表覆盖 DB，修复断连期间丢失的状态变更
      // 订阅恢复由 DaemonEventStream.resubscribeAll() 内部处理（基于跟踪集），
      // 此处不再为所有实例盲订 — 订阅完全由前端引用计数驱动
      void (async () => {
        try {
          const daemonHttp = new DaemonHttpClient({ baseUrl: DAEMON_URL, token: DAEMON_TOKEN });
          const resp = await daemonHttp.listInstances();
          const now = new Date().toISOString();
          let synced = 0;
          for (const inst of resp.instances) {
            await db('servers').where({ id: inst.id }).update({
              status: inst.status,
              updated_at: now,
            });
            synced++;
          }
          if (synced > 0) {
            logger.info({ synced }, 'Daemon WS 重连后已全量同步实例状态到 DB');
          }
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'Daemon WS 重连后状态同步失败（Daemon 可能未就绪）',
          );
        }
      })();
    },
    logger,
  });

  // 赋值给引用持有者，供 wsServer 回调 + createServersRouter 的 onInstanceStart 回调使用
  ref.current = daemonEventStream;

  return { wsServer, daemonEventStream };
}
