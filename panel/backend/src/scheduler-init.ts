// ============================================================================
// Scheduler 执行器注册 + 事件订阅 + 定时任务调度
// 从 index.ts 拆分而来，行为等价。
// 职责：
//   1. scheduler.setExecutor 的 if-else 链（14 种 task type）
//   2. scheduler.schedule() 定时任务注册（14 个任务）
//   3. eventBus 事件订阅（PLAYER_JOIN/PLAYER_LEAVE/CHAT_EVENT/VOTE_THRESHOLD_MET/webhook 自动触发）
// ============================================================================

import path from 'node:path';
import type { Logger } from 'pino';
import type { Knex } from 'knex';
import type { PackRegistry } from './core/packs/registry.js';
import {
  scheduler,
  OPTIMISTIC_LOCK_TIMEOUT_SCAN,
  COMMAND_QUEUE_PROCESS,
  PERIODIC_MESSAGE,
  STATE_TIMEOUT_SCAN,
  CHAT_LOG_CLEANUP,
  DISK_USAGE_REFRESH,
  AUDIT_LOG_CLEANUP,
  NOTIFICATION_CLEANUP,
  ITEM_SYNC_LOG_CLEANUP,
  AUTO_BACKUP,
  DB_BACKUP,
  DISK_SPACE_MONITOR,
  ALERT_SSL_EXPIRY_CHECK,
  ALERT_BACKUP_HEALTH_CHECK,
  NODE_OFFLINE_SCAN,
  CDK_REFUND_SCAN,
  WITHDRAW_EXPIRE_SCAN,
  INTEGRAL_DAILY_DECAY,
  VIP_SUBSCRIPTION_SCAN,
  WALLET_ANOMALY_SCAN,
  INSTANCE_AUTO_RENEWAL,
  INSTANCE_BILLING_ALERT,
  type SchedulerTaskType,
} from './services/scheduler.js';
import {
  eventBus,
  ORDER_CLAIMED,
  CDK_REDEEMED,
  VOTE_THRESHOLD_MET,
  PLAYER_JOIN,
  PLAYER_LEAVE,
  CHAT_EVENT,
} from './services/eventBus.js';
import { DaemonHttpClient } from './daemonClient/client.js';
import { getVipLevelByGamePlayerName } from './services/instanceBindingService.js';
import type { ServiceContainer } from './services-init.js';

export interface SchedulerDeps {
  db: Knex;
  registry: PackRegistry;
  services: ServiceContainer;
  logger: Logger;
  DAEMON_URL: string;
  DAEMON_TOKEN: string;
}

export function initScheduler(deps: SchedulerDeps): void {
  const { db, registry, services, logger, DAEMON_URL, DAEMON_TOKEN } = deps;
  const {
    shopService,
    cdkService,
    commandDispatcher,
    periodicMessageService,
    chatLogService,
    auditLogService,
    notificationService,
    itemSyncService,
    settingSchemaService,
    backupService,
    dbBackupService,
    diskMonitorService,
    alertService,
    playerService,
    chatService,
    inGameCommandService,
    webhookService,
    sslService,
    integralService,
    vipService,
    withdrawService,
    instanceBillingService,
  } = services;

  // S7-1: scheduler executor 注册
  // TaskExecutor 签名为 (task) => void，async 逻辑用 void + .catch 包装
  scheduler.setExecutor((task) => {
    logger.info({ taskId: task.id, type: task.type }, 'scheduler task triggered');
    eventBus.emit('scheduler.tick', task);

    // OPTIMISTIC_LOCK_TIMEOUT_SCAN：回滚超时未完成的 claiming 记录
    if (task.type === OPTIMISTIC_LOCK_TIMEOUT_SCAN) {
      const CLAIMING_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟
      void Promise.resolve()
        .then(async () => {
          const shopRolled = await shopService.rollbackStaleClaiming(CLAIMING_TIMEOUT_MS);
          const cdkRolled = await cdkService.rollbackStaleClaiming(CLAIMING_TIMEOUT_MS);
          if (shopRolled > 0 || cdkRolled > 0) {
            logger.info(
              { shopRolled, cdkRolled },
              'OPTIMISTIC_LOCK_TIMEOUT_SCAN 回滚超时 claiming 记录',
            );
          }
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'OPTIMISTIC_LOCK_TIMEOUT_SCAN 执行失败',
          );
        });
    }

    // COMMAND_QUEUE_PROCESS：调用 commandDispatcher.processQueue() 把 pending 命令下发给 daemon
    if (task.type === COMMAND_QUEUE_PROCESS) {
      void Promise.resolve()
        .then(() => commandDispatcher.processQueue())
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'COMMAND_QUEUE_PROCESS 执行失败',
          );
        });
    }

    // PERIODIC_MESSAGE：获取到期定时消息，渲染 broadcast_command 模板并入队下发
    if (task.type === PERIODIC_MESSAGE) {
      void Promise.resolve()
        .then(async () => {
          const dueMessages = await periodicMessageService.getDueAndAdvance();
          for (const msg of dueMessages) {
            try {
              const serverRow = await db('servers').where({ id: msg.server_id }).select('pack_id').first();
              if (!serverRow) continue;
              const business = registry.getBusinessConfig(serverRow.pack_id);
              if (!business?.chat_enhancement?.periodic_messages?.enabled) continue;
              const broadcastTemplate = business.chat_enhancement.periodic_messages.broadcast_command;
              if (!broadcastTemplate) continue;
              const command = commandDispatcher.renderCommand(broadcastTemplate, { message: msg.message });
              await commandDispatcher.enqueue(msg.server_id, command, 'low');
              logger.info({ server_id: msg.server_id, messageId: msg.id }, 'periodic_message 已入队');
            } catch (err) {
              logger.warn(
                { err: err instanceof Error ? err.message : String(err), messageId: msg.id },
                '下发 periodic_message 失败',
              );
            }
          }
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'PERIODIC_MESSAGE 执行失败',
          );
        });
    }

    // STATE_TIMEOUT_SCAN：每 30s 扫描 DB 中 stuck 在 starting/stopping 超过 60s 的实例
    if (task.type === STATE_TIMEOUT_SCAN) {
      void Promise.resolve()
        .then(async () => {
          const STUCK_TIMEOUT_MS = 60_000;
          const cutoff = new Date(Date.now() - STUCK_TIMEOUT_MS).toISOString();
          const stuckRows = await db('servers')
            .select('id', 'status')
            .whereIn('status', ['starting', 'stopping'])
            .where('updated_at', '<', cutoff);

          if (stuckRows.length === 0) return;

          logger.warn(
            { count: stuckRows.length, ids: stuckRows.map((r: any) => r.id) },
            'STATE_TIMEOUT_SCAN: 发现 stuck 实例，查询 Daemon 修正',
          );

          const daemonHttp = new DaemonHttpClient({ baseUrl: DAEMON_URL, token: DAEMON_TOKEN });
          let daemonInstances: Array<{ id: string; status: string }> = [];
          try {
            const resp = await daemonHttp.listInstances();
            daemonInstances = resp.instances;
          } catch (err) {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err) },
              'STATE_TIMEOUT_SCAN: 无法连接 Daemon，跳过本轮',
            );
            return;
          }

          const daemonMap = new Map(daemonInstances.map((i) => [i.id, i.status]));
          const now = new Date().toISOString();

          for (const row of stuckRows) {
            const daemonStatus = daemonMap.get(row.id);
            const newStatus = daemonStatus ?? 'error';
            const reason = daemonStatus
              ? 'Daemon 返回真实状态'
              : 'Daemon 中未找到该实例，标记为 error';
            await db('servers').where({ id: row.id }).update({
              status: newStatus,
              updated_at: now,
            });
            // v4.6.0-F3: 当实例被修正为 error 状态时，触发 instance_crash 告警
            if (newStatus === 'error') {
              try {
                const serverRow = await db<{ id: string; name: string }>('servers')
                  .where({ id: row.id })
                  .select('id', 'name')
                  .first();
                if (serverRow) {
                  await alertService.triggerInstanceCrash(
                    serverRow.id,
                    serverRow.name,
                    '状态超时扫描修正为 error',
                  );
                }
              } catch (err) {
                logger.warn(
                  { err, serverId: row.id },
                  '触发 instance_crash 告警失败',
                );
              }
            }
            logger.info(
              { instance_id: row.id, old_status: row.status, new_status: newStatus, reason },
              'STATE_TIMEOUT_SCAN: 已修正 stuck 实例状态',
            );
          }
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'STATE_TIMEOUT_SCAN 执行失败',
          );
        });
    }

    // v3.6.0-C1: CHAT_LOG_CLEANUP — 每日遍历所有实例，清理超过 retention_days 的 chat_logs
    if (task.type === CHAT_LOG_CLEANUP) {
      void Promise.resolve()
        .then(async () => {
          const serverRows = await db('servers').select('id');
          let totalDeleted = 0;
          for (const row of serverRows) {
            try {
              const deleted = await chatLogService.cleanupOldLogs(row.id);
              if (deleted > 0) {
                totalDeleted += deleted;
              }
            } catch (err) {
              logger.warn(
                { err: err instanceof Error ? err.message : String(err), serverId: row.id },
                'CHAT_LOG_CLEANUP: 清理实例 chat_logs 失败',
              );
            }
          }
          if (totalDeleted > 0) {
            logger.info({ totalDeleted, serverCount: serverRows.length }, 'CHAT_LOG_CLEANUP: 清理完成');
          }
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'CHAT_LOG_CLEANUP 执行失败',
          );
        });
    }

    // v3.6.1-A4: DISK_USAGE_REFRESH — 每日遍历所有 servers 调 du -sb 更新 disk_usage_bytes 缓存
    if (task.type === DISK_USAGE_REFRESH) {
      void Promise.resolve()
        .then(async () => {
          const serverRows = await db('servers').select('id', 'node_id');
          const instancesDir = path.resolve(process.env.INSTANCES_DIR ?? './instances');
          let refreshed = 0;
          for (const row of serverRows) {
            try {
              const instanceRoot = path.resolve(instancesDir, row.id);
              const resp = await services.daemonClientService.execCommand(row.node_id, 'system', {
                binary: 'du',
                args: ['-sb', instanceRoot],
                timeout: 15_000,
              });
              let bytes: number | null = null;
              if (resp.exit_code === 0 && resp.stdout) {
                const m = resp.stdout.match(/^(\d+)/);
                if (m) bytes = parseInt(m[1], 10);
              }
              await db('servers').where({ id: row.id }).update({
                disk_usage_bytes: bytes,
                disk_usage_updated_at: new Date().toISOString(),
              });
              refreshed++;
            } catch (err) {
              logger.warn(
                { err: err instanceof Error ? err.message : String(err), serverId: row.id },
                'DISK_USAGE_REFRESH: 刷新实例磁盘占用失败',
              );
            }
          }
          logger.info({ refreshed, serverCount: serverRows.length }, 'DISK_USAGE_REFRESH: 刷新完成');
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'DISK_USAGE_REFRESH 执行失败',
          );
        });
    }

    // v3.6.2-A1: AUDIT_LOG_CLEANUP — 每日清理 audit_logs 中超过 retention_days 的记录
    // v4.31.0: 同时清理 login_history（保留期一致 90 天，与 audit_logs 同周期）
    if (task.type === AUDIT_LOG_CLEANUP) {
      void Promise.resolve()
        .then(async () => {
          const deleted = await auditLogService.cleanupOldLogs();
          // v4.31.0: 同周期清理 login_history（登录历史独立表）
          let loginHistoryDeleted = 0;
          try {
            loginHistoryDeleted = await services.loginHistoryService.cleanupOldLogs();
          } catch (err) {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err) },
              'LOGIN_HISTORY_CLEANUP 执行失败（非阻断）',
            );
          }
          // 记录清理时间到 system_config（best-effort）
          try {
            const now = new Date().toISOString();
            const key = 'maintenance.last_cleanup.audit_logs';
            const existing = await db('system_config').where({ key }).select('key').first();
            if (existing) {
              await db('system_config').where({ key }).update({ value: now, updated_at: now });
            } else {
              await db('system_config').insert({ key, value: now, updated_at: now });
            }
          } catch {
            // best-effort，忽略
          }
          if (deleted > 0 || loginHistoryDeleted > 0) {
            logger.info(
              { auditLogsDeleted: deleted, loginHistoryDeleted },
              'AUDIT_LOG_CLEANUP: 清理完成（含 login_history）',
            );
          }
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'AUDIT_LOG_CLEANUP 执行失败',
          );
        });
    }

    // v3.6.2-A2: NOTIFICATION_CLEANUP — 每日清理 user_notifications 中超过 retention_days 的记录
    if (task.type === NOTIFICATION_CLEANUP) {
      void Promise.resolve()
        .then(async () => {
          const deleted = await notificationService.cleanupOldLogs();
          try {
            const now = new Date().toISOString();
            const key = 'maintenance.last_cleanup.user_notifications';
            const existing = await db('system_config').where({ key }).select('key').first();
            if (existing) {
              await db('system_config').where({ key }).update({ value: now, updated_at: now });
            } else {
              await db('system_config').insert({ key, value: now, updated_at: now });
            }
          } catch {
            // best-effort
          }
          if (deleted > 0) {
            logger.info({ deleted }, 'NOTIFICATION_CLEANUP: 清理完成');
          }
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'NOTIFICATION_CLEANUP 执行失败',
          );
        });
    }

    // v3.6.2-A3: ITEM_SYNC_LOG_CLEANUP — 每日清理 item_sync_log 中超过 retention_days 的记录
    if (task.type === ITEM_SYNC_LOG_CLEANUP) {
      void Promise.resolve()
        .then(async () => {
          const deleted = await itemSyncService.cleanupOldLogs();
          try {
            const now = new Date().toISOString();
            const key = 'maintenance.last_cleanup.item_sync_log';
            const existing = await db('system_config').where({ key }).select('key').first();
            if (existing) {
              await db('system_config').where({ key }).update({ value: now, updated_at: now });
            } else {
              await db('system_config').insert({ key, value: now, updated_at: now });
            }
          } catch {
            // best-effort
          }
          if (deleted > 0) {
            logger.info({ deleted }, 'ITEM_SYNC_LOG_CLEANUP: 清理完成');
          }
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'ITEM_SYNC_LOG_CLEANUP 执行失败',
          );
        });
    }

    // v3.8.0-S9/S10: AUTO_BACKUP — 每日检查 backup.auto_enabled，为所有实例创建备份并按 max_count 清理
    if (task.type === AUTO_BACKUP) {
      void Promise.resolve()
        .then(async () => {
          // 1. 读取设置——未开启自动备份时跳过
          const autoEnabled = await settingSchemaService.getBoolean('backup.auto_enabled');
          if (!autoEnabled) {
            logger.debug('AUTO_BACKUP: backup.auto_enabled=false，跳过');
            return;
          }
          const maxCount = await settingSchemaService.getNumber('backup.max_count');
          const retention = maxCount > 0 ? Math.floor(maxCount) : 7;
          // 2. 列出所有实例，逐个创建备份并清理超出 max_count 的旧备份
          const servers = await db<{ id: string; name: string }>('servers')
            .select('id', 'name')
            .whereNotIn('status', ['deleted', 'removing']);
          let success = 0;
          let failed = 0;
          for (const server of servers) {
            try {
              await backupService.createBackup(server.id, 'system');
              await backupService.cleanupOldBackups(server.id, retention);
              success++;
            } catch (err) {
              failed++;
              logger.warn(
                { serverId: server.id, serverName: server.name, err: err instanceof Error ? err.message : String(err) },
                'AUTO_BACKUP: 实例备份失败（继续下一个）',
              );
            }
          }
          // 3. 记录 last_cleanup 时间到 system_config
          try {
            const now = new Date().toISOString();
            const key = 'maintenance.last_cleanup.backup';
            const existing = await db('system_config').where({ key }).select('key').first();
            if (existing) {
              await db('system_config').where({ key }).update({ value: now, updated_at: now });
            } else {
              await db('system_config').insert({ key, value: now, updated_at: now });
            }
          } catch {
            // best-effort
          }
          logger.info({ success, failed, total: servers.length }, 'AUTO_BACKUP: 备份周期完成');
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'AUTO_BACKUP 执行失败',
          );
        });
    }

    // v3.9.0-D1: DB_BACKUP — 每日将 panel.db 复制到 backup.path/.db-backup/，按 db_retention_days 清理
    if (task.type === DB_BACKUP) {
      void Promise.resolve()
        .then(async () => {
          const result = await dbBackupService.runBackup();
          if (result.backed_up) {
            logger.info(
              { file: result.file_path, cleaned: result.cleaned_count },
              'DB_BACKUP: 数据库备份完成',
            );
          } else if (result.error) {
            logger.error({ err: result.error }, 'DB_BACKUP: 数据库备份失败');
          } else {
            logger.debug('DB_BACKUP: backup.db_enabled=false，跳过');
          }
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'DB_BACKUP 执行失败',
          );
        });
    }

    // v3.9.0-D2: DISK_SPACE_MONITOR — 每小时检查磁盘使用率，超阈值时通知所有管理员
    if (task.type === DISK_SPACE_MONITOR) {
      void Promise.resolve()
        .then(async () => {
          const enabled = await settingSchemaService.getBoolean('disk.monitor_enabled');
          if (!enabled) {
            logger.debug('DISK_SPACE_MONITOR: disk.monitor_enabled=false，跳过');
            return;
          }
          await diskMonitorService.checkAndNotify();
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'DISK_SPACE_MONITOR 执行失败',
          );
        });
    }

    // v4.6.0-F3: ALERT_SSL_EXPIRY_CHECK — 每日检查 SSL 证书到期情况
    if (task.type === ALERT_SSL_EXPIRY_CHECK) {
      void Promise.resolve()
        .then(async () => {
          if (!sslService) return;
          try {
            const info = sslService.getCertificateInfo();
            if (info.available && info.days_remaining !== null && info.days_remaining <= 30) {
              await alertService.triggerSslExpiring(info.days_remaining, info.cert_path);
            }
          } catch (err) {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err) },
              'ALERT_SSL_EXPIRY_CHECK: SSL 证书到期检查失败',
            );
          }
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'ALERT_SSL_EXPIRY_CHECK 执行失败',
          );
        });
    }

    // v4.6.0-F3: ALERT_BACKUP_HEALTH_CHECK — 每日检查备份健康度（连续失败）
    if (task.type === ALERT_BACKUP_HEALTH_CHECK) {
      void Promise.resolve()
        .then(async () => {
          // 查询所有实例的最近 3 天备份记录，统计失败次数
          const servers = await db('servers').select('id', 'name').whereNotIn('status', ['deleted', 'removing']);
          for (const server of servers) {
            try {
              const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
              const recentBackups = await db('backup_records')
                .where('server_id', server.id)
                .where('created_at', '>=', cutoff)
                .select('status', 'created_at')
                .orderBy('created_at', 'desc')
                .limit(3);
              // 连续 3 天失败：最近 3 次备份都是 failed
              if (recentBackups.length >= 3 && recentBackups.every((b: { status: string }) => b.status === 'failed')) {
                await alertService.triggerBackupFailing(server.id, server.name, 3);
              }

            } catch (err) {
              logger.warn(
                { err: err instanceof Error ? err.message : String(err), serverId: server.id },
                'ALERT_BACKUP_HEALTH_CHECK: 检查实例备份健康度失败',
              );
            }
          }
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'ALERT_BACKUP_HEALTH_CHECK 执行失败',
          );
        });
    }

    // L2: NODE_OFFLINE_SCAN — 每 15s 扫描 slave 节点，超时未上报标记 offline
    if (task.type === NODE_OFFLINE_SCAN) {
      void Promise.resolve()
        .then(() => services.nodeService.markStaleNodesOffline(15_000))
        .then((markedCount) => {
          if (markedCount > 0) {
            logger.warn({ markedCount }, 'NODE_OFFLINE_SCAN: 标记 slave 节点为 offline');
          }
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'NODE_OFFLINE_SCAN 执行失败',
          );
        });
    }

    // v5 经济系统: CDK_REFUND_SCAN — 每日扫描过期未兑换的经济 CDK，用户自生成的解冻退费
    // 注：type 未入 public/ 契约联合（public/ 不可改），比较时断言为 string 规避 ts2367
    if ((task.type as string) === CDK_REFUND_SCAN) {
      void Promise.resolve()
        .then(async () => {
          const result = await cdkService.refundExpiredCdk();
          if (result.refunded > 0) {
            logger.info({ refunded: result.refunded }, 'CDK_REFUND_SCAN: 过期退费完成');
          }
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'CDK_REFUND_SCAN 执行失败',
          );
        });
    }

    // v5 经济系统: WITHDRAW_EXPIRE_SCAN — 每日扫描过期提现码，自动取消并解冻余额
    if ((task.type as string) === WITHDRAW_EXPIRE_SCAN) {
      void Promise.resolve()
        .then(async () => {
          const result = await withdrawService.expireOldWithdrawals();
          if (result.expired > 0) {
            logger.info({ expired: result.expired }, 'WITHDRAW_EXPIRE_SCAN: 过期提现码处理完成');
          }
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'WITHDRAW_EXPIRE_SCAN 执行失败',
          );
        });
    }

    // v5 经济系统: INTEGRAL_DAILY_DECAY — 积分每日衰减（current_integral 每日 -1，保底 0）
    if ((task.type as string) === INTEGRAL_DAILY_DECAY) {
      void Promise.resolve()
        .then(async () => {
          const result = await integralService.dailyDecay();
          if (result.decayed > 0) {
            logger.info({ decayed: result.decayed }, 'INTEGRAL_DAILY_DECAY: 积分衰减完成');
          }
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'INTEGRAL_DAILY_DECAY 执行失败',
          );
        });
    }

    // v5 经济系统: VIP_SUBSCRIPTION_SCAN — 每日扫描到期订阅制 VIP，vip_type 置 null
    if ((task.type as string) === VIP_SUBSCRIPTION_SCAN) {
      void Promise.resolve()
        .then(async () => {
          const result = await vipService.checkExpiredSubscriptions();
          if (result.expired > 0) {
            logger.info({ expired: result.expired }, 'VIP_SUBSCRIPTION_SCAN: 订阅到期处理完成');
          }
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'VIP_SUBSCRIPTION_SCAN 执行失败',
          );
        });
    }

    // v5 经济系统: WALLET_ANOMALY_SCAN — 经济异常流水告警（方案 §8.3）
    //   规则1: 单日大额流入（admin_credit + cdk_recharge 合计 > 200000）→ 告警
    //   规则2: 负余额检测（global_balances / instance_points）→ 立即告警
    //   规则3: CDK 批次 1h 兑换率 > 80%（≥5 个的批次）→ 标记 suspicious 告警
    //   告警写入 alert_events；同日同规则同对象去重
    if ((task.type as string) === WALLET_ANOMALY_SCAN) {
      void Promise.resolve()
        .then(async () => {
          const nowIso = new Date().toISOString();
          const dayStart = new Date();
          dayStart.setHours(0, 0, 0, 0);
          const dayStartIso = dayStart.toISOString();

          const insertAlert = async (
            ruleType: string,
            severity: string,
            title: string,
            content: string,
            relatedServerId: string | null,
          ): Promise<boolean> => {
            // 24h 内同规则同标题去重，避免每日任务重复轰炸
            const dup = await db('alert_events')
              .where('rule_type', ruleType)
              .where('title', title)
              .where('triggered_at', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
              .first('id')
              .catch(() => null);
            if (dup) return false;
            await db('alert_events')
              .insert({
                id: crypto.randomUUID(),
                rule_type: ruleType,
                severity,
                title,
                content,
                related_server_id: relatedServerId,
                triggered_at: nowIso,
                dispatched_channels: '[]',
                created_at: nowIso,
              })
              .catch((err: unknown) => {
                logger.error(
                  { err: err instanceof Error ? err.message : String(err) },
                  'WALLET_ANOMALY_SCAN: 写入 alert_events 失败',
                );
              });
            return true;
          };

          let alertCount = 0;

          // 规则1: 单日大额流入
          const inflowRows = (await db('wallet_transactions')
            .select('user_id')
            .sum('amount as total_inflow')
            .whereIn('type', ['admin_credit', 'cdk_recharge'])
            .where('created_at', '>=', dayStartIso)
            .groupBy('user_id')
            .having(db.raw('SUM(amount)'), '>', 200000)
            .catch(() => [] as unknown[])) as Array<{ user_id: string; total_inflow: number }>;
          for (const row of inflowRows) {
            const ok = await insertAlert(
              'wallet_large_inflow',
              'warning',
              `用户单日大额流入告警: ${row.user_id}`,
              `用户 ${row.user_id} 单日 admin_credit + cdk_recharge 合计流入 ${row.total_inflow}，超过阈值 200000`,
              null,
            );
            if (ok) alertCount += 1;
          }

          // 规则2: 负余额检测
          const negGlobal = (await db('global_balances')
            .select('user_id', 'balance', 'frozen_balance')
            .where('balance', '<', 0)
            .orWhere('frozen_balance', '<', 0)
            .catch(() => [] as unknown[])) as Array<{
            user_id: string;
            balance: number;
            frozen_balance: number;
          }>;
          for (const row of negGlobal) {
            const ok = await insertAlert(
              'wallet_negative_balance',
              'critical',
              `全局余额负值告警: ${row.user_id}`,
              `用户 ${row.user_id} global_balances 出现异常负值: balance=${row.balance}, frozen_balance=${row.frozen_balance}`,
              null,
            );
            if (ok) alertCount += 1;
          }
          const negPoints = (await db('instance_points')
            .select('user_id', 'server_id', 'balance')
            .where('balance', '<', 0)
            .catch(() => [] as unknown[])) as Array<{
            user_id: string;
            server_id: string;
            balance: number;
          }>;
          for (const row of negPoints) {
            const ok = await insertAlert(
              'wallet_negative_balance',
              'critical',
              `实例点券负值告警: ${row.user_id} @ ${row.server_id}`,
              `用户 ${row.user_id} 在实例 ${row.server_id} 的 instance_points.balance=${row.balance}，出现异常负值`,
              row.server_id,
            );
            if (ok) alertCount += 1;
          }

          // 规则3: CDK 批次 1h 兑换率 > 80%（创建小时为批次，≥5 个起判）
          const suspiciousBatches = (await db('cdk_codes')
            .select('created_by')
            .select(db.raw("strftime('%Y-%m-%d %H', created_at) as batch_hour"))
            .select(db.raw('COUNT(*) as total'))
            .select(
              db.raw(
                "SUM(CASE WHEN claimed_at IS NOT NULL AND claimed_at <= datetime(created_at, '+1 hour') THEN 1 ELSE 0 END) as fast_redeemed",
              ),
            )
            .groupBy('created_by', db.raw("strftime('%Y-%m-%d %H', created_at)"))
            .having(db.raw('COUNT(*)'), '>=', 5)
            .having(
              db.raw(
                "SUM(CASE WHEN claimed_at IS NOT NULL AND claimed_at <= datetime(created_at, '+1 hour') THEN 1 ELSE 0 END) * 1.0 / COUNT(*)",
              ),
              '>',
              0.8,
            )
            .catch(() => [] as unknown[])) as Array<{
            created_by: string;
            batch_hour: string;
            total: number;
            fast_redeemed: number;
          }>;
          for (const row of suspiciousBatches) {
            const ok = await insertAlert(
              'cdk_batch_suspicious',
              'warning',
              `CDK 批次异常兑换率: ${row.created_by} @ ${row.batch_hour}`,
              `创建者 ${row.created_by} 在 ${row.batch_hour} 时段生成的批次（共 ${row.total} 个）中，${row.fast_redeemed} 个在 1 小时内被兑换（兑换率 > 80%），标记 suspicious`,
              null,
            );
            if (ok) alertCount += 1;
          }

          if (alertCount > 0) {
            logger.warn({ alertCount }, 'WALLET_ANOMALY_SCAN: 发现经济异常并写入告警');
          }
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'WALLET_ANOMALY_SCAN 执行失败',
          );
        });
    }

    // v3-billing: INSTANCE_AUTO_RENEWAL — 每日 03:00 自动续扣扫描
    // 扫描临近到期实例（expires_at <= now + lookahead_days），按上次周期自动扣款续费
    if ((task.type as string) === INSTANCE_AUTO_RENEWAL) {
      void (async () => {
        try {
          const result = await instanceBillingService.scanAndAutoRenew();
          logger.info(
            { scanned: result.scanned, renewed: result.renewed, failed: result.failed, exempt: result.exempt },
            'INSTANCE_AUTO_RENEWAL: 自动续扣扫描完成',
          );
        } catch (err) {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'INSTANCE_AUTO_RENEWAL 执行失败',
          );
        }
      })();
    }

    // v3-billing: INSTANCE_BILLING_ALERT — 每日 09:00 欠费告警扫描
    // 查询自动续扣失败的实例（expiry_status=active 且 expires_at < now），通知腐竹
    if ((task.type as string) === INSTANCE_BILLING_ALERT) {
      void (async () => {
        try {
          // 扫描已过期但 expiry_status 仍为 active 的实例（自动续扣失败的兜底）
          const expiredInstances = await db<{ id: string; name: string; owner_user_id: string; expires_at: string }>('servers')
            .select('id', 'name', 'owner_user_id', 'expires_at')
            .where('expiry_status', 'active')
            .whereNotNull('expires_at')
            .where('expires_at', '<', new Date().toISOString());

          for (const inst of expiredInstances) {
            // 发送站内信通知腐竹
            void notificationService
              .create({
                userId: inst.owner_user_id,
                title: '实例已过期',
                content: `您的实例「${inst.name}」已于 ${inst.expires_at} 过期，自动续扣失败。请及时续费或充值，否则实例将在宽限期结束后被清理。`,
                type: 'warning',
                relatedServerId: inst.id,
              })
              .catch(() => undefined);
          }
          logger.info(
            { alertCount: expiredInstances.length },
            'INSTANCE_BILLING_ALERT: 欠费告警扫描完成',
          );
        } catch (err) {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'INSTANCE_BILLING_ALERT 执行失败',
          );
        }
      })();
    }
  });

  // ===== 定时任务注册 =====
  // 命令队列处理任务（每 5s 处理一批 pending 命令，下发给 daemon）
  scheduler.schedule({
    type: COMMAND_QUEUE_PROCESS,
    interval_ms: 5_000,
    payload: {},
  });
  // 定时消息任务（每 60s 检查到期消息并下发）
  scheduler.schedule({
    type: PERIODIC_MESSAGE,
    interval_ms: 60_000,
    payload: {},
  });
  // 状态超时扫描任务（每 30s 扫描 stuck 在 starting/stopping 超 60s 的实例并修正）
  scheduler.schedule({
    type: STATE_TIMEOUT_SCAN,
    interval_ms: 30_000,
    payload: {},
  });
  // v3.6.0-C1: chat_logs 每日清理任务（每 24h 遍历所有实例清理过期日志）
  // v3.6.0-C2: next_run_at 设为 10s 后，启动时立即跑一次（清理历史累积）
  scheduler.schedule({
    type: CHAT_LOG_CLEANUP,
    next_run_at: new Date(Date.now() + 10_000).toISOString(),
    interval_ms: 24 * 60 * 60 * 1000,
    payload: {},
  });
  // v3.6.1-A4: disk_usage_bytes 每日刷新任务
  // v3.6.1-C2: next_run_at 设为 15s 后，启动时立即跑一次（避开 CHAT_LOG_CLEANUP 10s 高峰）
  scheduler.schedule({
    type: DISK_USAGE_REFRESH,
    next_run_at: new Date(Date.now() + 15_000).toISOString(),
    interval_ms: 24 * 60 * 60 * 1000,
    payload: {},
  });
  // v3.6.2-A1: audit_logs 每日清理任务
  scheduler.schedule({
    type: AUDIT_LOG_CLEANUP,
    next_run_at: new Date(Date.now() + 20_000).toISOString(),
    interval_ms: 24 * 60 * 60 * 1000,
    payload: {},
  });
  // v3.6.2-A2: user_notifications 每日清理任务
  scheduler.schedule({
    type: NOTIFICATION_CLEANUP,
    next_run_at: new Date(Date.now() + 25_000).toISOString(),
    interval_ms: 24 * 60 * 60 * 1000,
    payload: {},
  });
  // v3.6.2-A3: item_sync_log 每日清理任务
  scheduler.schedule({
    type: ITEM_SYNC_LOG_CLEANUP,
    next_run_at: new Date(Date.now() + 30_000).toISOString(),
    interval_ms: 24 * 60 * 60 * 1000,
    payload: {},
  });
  // v3.8.0-S9/S10: 自动备份任务
  scheduler.schedule({
    type: AUTO_BACKUP,
    next_run_at: new Date(Date.now() + 35_000).toISOString(),
    interval_ms: 24 * 60 * 60 * 1000,
    payload: {},
  });
  // v3.9.0-D1: DB 自动备份任务
  scheduler.schedule({
    type: DB_BACKUP,
    next_run_at: new Date(Date.now() + 45_000).toISOString(),
    interval_ms: 24 * 60 * 60 * 1000,
    payload: {},
  });
  // v3.9.0-D2: 磁盘空间监控任务（每 1h 检查磁盘使用率）
  scheduler.schedule({
    type: DISK_SPACE_MONITOR,
    next_run_at: new Date(Date.now() + 60_000).toISOString(),
    interval_ms: 60 * 60 * 1000,
    payload: {},
  });
  // v4.6.0-F3: SSL 证书到期检查任务（每 24h）
  scheduler.schedule({
    type: ALERT_SSL_EXPIRY_CHECK,
    next_run_at: new Date(Date.now() + 90_000).toISOString(),
    interval_ms: 24 * 60 * 60 * 1000,
    payload: {},
  });
  // v4.6.0-F3: 备份健康度检查任务（每 24h）
  scheduler.schedule({
    type: ALERT_BACKUP_HEALTH_CHECK,
    next_run_at: new Date(Date.now() + 120_000).toISOString(),
    interval_ms: 24 * 60 * 60 * 1000,
    payload: {},
  });
  // L2: 节点离线扫描任务（每 15s 扫描，超时阈值 15s）
  scheduler.schedule({
    type: NODE_OFFLINE_SCAN,
    interval_ms: 15_000,
    payload: {},
  });
  // v5 经济系统: CDK 过期退费扫描（每日；type 未入 public/ 契约联合，断言规避类型收窄）
  scheduler.schedule({
    type: CDK_REFUND_SCAN as SchedulerTaskType,
    next_run_at: new Date(Date.now() + 130_000).toISOString(),
    interval_ms: 24 * 60 * 60 * 1000,
    payload: {},
  });
  // v5 经济系统: 提现码过期扫描（每日）
  scheduler.schedule({
    type: WITHDRAW_EXPIRE_SCAN as SchedulerTaskType,
    next_run_at: new Date(Date.now() + 140_000).toISOString(),
    interval_ms: 24 * 60 * 60 * 1000,
    payload: {},
  });
  // v5 经济系统: 积分每日衰减（每日）
  scheduler.schedule({
    type: INTEGRAL_DAILY_DECAY as SchedulerTaskType,
    next_run_at: new Date(Date.now() + 150_000).toISOString(),
    interval_ms: 24 * 60 * 60 * 1000,
    payload: {},
  });
  // v5 经济系统: VIP 订阅过期扫描（每日）
  scheduler.schedule({
    type: VIP_SUBSCRIPTION_SCAN as SchedulerTaskType,
    next_run_at: new Date(Date.now() + 160_000).toISOString(),
    interval_ms: 24 * 60 * 60 * 1000,
    payload: {},
  });
  // v5 经济系统: 经济异常流水告警扫描（每日，方案 §8.3）
  scheduler.schedule({
    type: WALLET_ANOMALY_SCAN as SchedulerTaskType,
    next_run_at: new Date(Date.now() + 170_000).toISOString(),
    interval_ms: 24 * 60 * 60 * 1000,
    payload: {},
  });
  // v3-billing: 实例自动续扣扫描（每日，首次 180s 后启动，之后每 24h）
  // executor 调用 instanceBillingService.scanAndAutoRenew() 扫描临近到期实例
  scheduler.schedule({
    type: INSTANCE_AUTO_RENEWAL as SchedulerTaskType,
    next_run_at: new Date(Date.now() + 180_000).toISOString(),
    interval_ms: 24 * 60 * 60 * 1000,
    payload: {},
  });
  // v3-billing: 欠费告警扫描（每日，首次 190s 后启动，之后每 24h）
  // 扫描已过期但 expiry_status 仍为 active 的实例，通知腐竹续费
  scheduler.schedule({
    type: INSTANCE_BILLING_ALERT as SchedulerTaskType,
    next_run_at: new Date(Date.now() + 190_000).toISOString(),
    interval_ms: 24 * 60 * 60 * 1000,
    payload: {},
  });

  // ===== 6 大功能自动化链路：事件订阅 =====

  // 功能 1：玩家加入 → 自动下发 pack.business.chat_enhancement.welcome.first_gift_command
  eventBus.on(PLAYER_JOIN, (payload: unknown) => {
    const p = payload as { server_id: string; player_name: string };
    void handlePlayerJoinWelcome(p).catch((err: unknown) => {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'handlePlayerJoinWelcome 失败',
      );
    });
  });

  async function handlePlayerJoinWelcome(payload: { server_id: string; player_name: string }): Promise<void> {
    const { server_id, player_name } = payload;
    // 1. 查询 server 的 pack_id
    const serverRow = await db('servers').where({ id: server_id }).select('pack_id').first();
    if (!serverRow) return;
    const packId: string = serverRow.pack_id;
    // 2. 查询 pack.business.chat_enhancement.welcome
    const business = registry.getBusinessConfig(packId);
    if (!business?.chat_enhancement?.welcome?.enabled) return;
    const welcome = business.chat_enhancement.welcome;

    // 3. 欢迎语广播
    const commands = registry.getCommands(packId);
    const broadcastTemplate = commands?.broadcast;
    if (broadcastTemplate) {
      // 3.1 优先读 DB player_join_settings.welcome_message
      let welcomeMsg = `欢迎玩家 ${player_name} 加入服务器`;
      try {
        const joinSettings = await playerService.getJoinSettings(server_id);
        if (joinSettings.welcome_message) {
          welcomeMsg = joinSettings.welcome_message
            .replace(/\{player\}/g, player_name)
            .replace(/\{player_name\}/g, player_name);
        }
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), server_id },
          '读取 player_join_settings.welcome_message 失败，降级到默认欢迎语',
        );
      }
      // 3.2 通过 broadcast 模板下发
      try {
        const broadcastCmd = commandDispatcher.renderCommand(broadcastTemplate, { message: welcomeMsg });
        await commandDispatcher.enqueue(server_id, broadcastCmd, 'normal');
        logger.info({ server_id, player_name, broadcastCmd }, 'welcome_message 已入队');
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), server_id, player_name },
          '渲染/下发 welcome_message 失败（不影响礼包下发）',
        );
      }
    }

    // P4: VIP 专属欢迎语（基于玩家 VIP 等级匹配）
    try {
      const vipLevel = await getVipLevelByGamePlayerName(server_id, player_name);
      if (vipLevel > 0) {
        const vipWelcomeTpl = await playerService.getVipWelcomeMessage(server_id, vipLevel);
        if (vipWelcomeTpl) {
          const vipMsg = vipWelcomeTpl
            .replace(/\{player\}/g, player_name)
            .replace(/\{player_name\}/g, player_name)
            .replace(/\{vip_level\}/g, String(vipLevel));
          const commands = registry.getCommands(packId);
          const broadcastTpl = commands?.broadcast;
          if (broadcastTpl) {
            try {
              const vipCmd = commandDispatcher.renderCommand(broadcastTpl, { message: vipMsg });
              await commandDispatcher.enqueue(server_id, vipCmd, 'normal');
              logger.info({ server_id, player_name, vipLevel, vipCmd }, 'vip_welcome_message 已入队');
            } catch (err) {
              logger.warn(
                { err: err instanceof Error ? err.message : String(err), server_id, player_name },
                '渲染/下发 vip_welcome_message 失败',
              );
            }
          }
        }
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), server_id, player_name },
        '查询 VIP 等级或下发 VIP 欢迎语失败（不影响后续礼包）',
      );
    }

    // 4. 礼包下发（first_gift_command）—— 首次加入或今日未领取才下发
    if (welcome.first_gift_command) {
      // 5. 防重复：今日已领取则跳过
      const alreadyClaimed = await playerService.hasClaimedToday(server_id, player_name, 'welcome_gift');
      if (alreadyClaimed) {
        logger.info({ server_id, player_name }, 'welcome_gift 今日已领取，跳过');
      } else {
        // 6. 渲染命令模板（替换 {{player}}）
        let command: string;
        try {
          command = commandDispatcher.renderCommand(welcome.first_gift_command, { player: player_name });
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), server_id, player_name },
            '渲染 welcome.first_gift_command 失败',
          );
          command = '';
        }
        // 7. 入队下发（每 5s 由 COMMAND_QUEUE_PROCESS 实际下发）
        if (command) {
          await commandDispatcher.enqueue(server_id, command, 'normal');
          // 8. 记录礼包领取（防重复）
          try {
            await playerService.recordGiftClaim(server_id, player_name, 'welcome_gift');
          } catch (err) {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err), server_id, player_name },
              'recordGiftClaim 失败（不影响下发）',
            );
          }
          logger.info({ server_id, player_name, command }, 'welcome_gift 已入队');
        }
      }
    }

    // P3: 回归礼包（基于离线时长判断）
    try {
      const reloginCheck = await playerService.checkReloginGift(server_id, player_name);
      if (reloginCheck.shouldGrant && reloginCheck.items) {
        const commands = registry.getCommands(packId);
        const broadcastTpl = commands?.broadcast;
        // 对每个物品下发 give 命令（优先使用 pack.commands.give_item，否则降级 say 通知）
        const giveTpl = commands?.give_item;
        for (const item of reloginCheck.items) {
          let cmd: string;
          if (giveTpl) {
            try {
              cmd = commandDispatcher.renderCommand(giveTpl, {
                player: player_name,
                item: item.item,
                count: String(item.count),
                quality: item.quality ?? '',
              });
            } catch (err) {
              logger.warn(
                { err: err instanceof Error ? err.message : String(err), server_id, player_name, item },
                '渲染 give_item 模板失败，跳过该物品',
              );
              continue;
            }
          } else {
            // 无 give_item 模板，降级为广播通知（仅提示，不实际发放）
            cmd = broadcastTpl
              ? commandDispatcher.renderCommand(broadcastTpl, {
                  message: `[回归礼包] ${player_name} 获得 ${item.count}x ${item.item}`,
                })
              : `say [回归礼包] ${player_name} 获得 ${item.count}x ${item.item}`;
          }
          try {
            await commandDispatcher.enqueue(server_id, cmd, 'normal');
          } catch (err) {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err), server_id, player_name, cmd },
              '回归礼包命令入队失败',
            );
          }
        }
        // 记录回归礼包领取（防重复 + 限额统计）
        try {
          await playerService.recordGiftClaim(server_id, player_name, 'relogin_gift');
          logger.info({ server_id, player_name, items: reloginCheck.items.length }, 'relogin_gift 已入队并记录');
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), server_id, player_name },
            'recordGiftClaim relogin_gift 失败（不影响下发）',
          );
        }
      } else if (reloginCheck.reason && !reloginCheck.reason.includes('未启用') && !reloginCheck.reason.includes('物品为空')) {
        // 仅在启用但其他条件不满足时记录 debug 日志
        logger.debug({ server_id, player_name, reason: reloginCheck.reason }, '回归礼包条件不满足');
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), server_id, player_name },
        'checkReloginGift 失败（不影响其他功能）',
      );
    }
  }

  // 功能 1（补充）：玩家离开 → 自动广播离开消息
  eventBus.on(PLAYER_LEAVE, (payload: unknown) => {
    const p = payload as { server_id: string; player_name: string };
    void handlePlayerLeaveBroadcast(p).catch((err: unknown) => {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'handlePlayerLeaveBroadcast 失败',
      );
    });
  });

  async function handlePlayerLeaveBroadcast(payload: { server_id: string; player_name: string }): Promise<void> {
    const { server_id, player_name } = payload;
    // 1. 查询 server 的 pack_id
    const serverRow = await db('servers').where({ id: server_id }).select('pack_id').first();
    if (!serverRow) return;
    const packId: string = serverRow.pack_id;
    // 2. 查询 pack.commands.broadcast 模板
    const commands = registry.getCommands(packId);
    if (!commands?.broadcast) return;
    // 3. 渲染广播消息
    let leaveMsg = `玩家 ${player_name} 离开服务器`;
    try {
      const joinSettings = await playerService.getJoinSettings(server_id);
      if (joinSettings.leave_message) {
        leaveMsg = joinSettings.leave_message
          .replace(/\{player\}/g, player_name)
          .replace(/\{player_name\}/g, player_name);
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), server_id },
        '读取 player_join_settings.leave_message 失败，降级到默认离开文案',
      );
    }
    let command: string;
    try {
      command = commandDispatcher.renderCommand(commands.broadcast, { message: leaveMsg });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), server_id, player_name },
        '渲染 leave broadcast 失败',
      );
      return;
    }
    // 4. 入队下发（normal 优先级，由 COMMAND_QUEUE_PROCESS 实际下发）
    await commandDispatcher.enqueue(server_id, command, 'normal');
    logger.info({ server_id, player_name, command }, 'leave_message 已入队');
  }

  // 功能 5（部分）：CHAT_EVENT → 匹配 chat_trigger_responses 关键词，命中则下发响应命令
  eventBus.on(CHAT_EVENT, (payload: unknown) => {
    const p = payload as { server_id: string; player: string; message: string };
    void handleChatTrigger(p).catch((err: unknown) => {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'handleChatTrigger 失败',
      );
    });
  });

  async function handleChatTrigger(payload: { server_id: string; player: string; message: string }): Promise<void> {
    const { server_id, player, message } = payload;

    // 模块10 Task 6: 先尝试内置命令（!verify / !claim / !vk / !help / !status / !players / !uptime）
    // 命中内置命令则不再走 chat_trigger_responses 匹配
    try {
      const handled = await inGameCommandService.tryHandle(server_id, player, message);
      if (handled) {
        return;
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), server_id, player, message },
        'inGameCommandService 处理异常，降级到 chat_trigger',
      );
    }

    // 1. 查询该 server 的所有 enabled triggers（listTriggers 已按 priority DESC 排序）
    let triggers;
    try {
      triggers = await chatService.listTriggers(server_id);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), server_id },
        '查询 chat_trigger_responses 失败',
      );
      return;
    }
    const enabledTriggers = triggers.filter((t) => t.enabled);
    for (const trigger of enabledTriggers) {
      try {
        // 简化匹配：trigger 字段作为正则匹配 message（命中即响应）
        const regex = new RegExp(trigger.trigger, 'i');
        if (!regex.test(message)) continue;
        // 渲染 response 模板（支持 {{player}} {{message}} 变量）
        const command = commandDispatcher.renderCommand(trigger.response, { player, message });
        await commandDispatcher.enqueue(server_id, command, 'normal');
        logger.info({ server_id, player, trigger_id: trigger.id }, 'chat_trigger 响应已入队');
        // 命中即停（按 priority DESC 顺序，第一个命中即响应）
        break;
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), trigger_id: trigger.id },
          '渲染/下发 chat trigger 响应失败',
        );
      }
    }
  }

  // 功能 6：投票阈值满足 → 自动下发 pack.business.players.kick_command
  eventBus.on(VOTE_THRESHOLD_MET, (payload: unknown) => {
    const p = payload as { server_id: string; vote_id: number; target: string; reason: string };
    void handleVoteThreshold(p).catch((err: unknown) => {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'handleVoteThreshold 失败',
      );
    });
  });

  async function handleVoteThreshold(payload: { server_id: string; vote_id: number; target: string; reason: string }): Promise<void> {
    const { server_id, vote_id, target, reason } = payload;
    // 1. 查询 server 的 pack_id
    const serverRow = await db('servers').where({ id: server_id }).select('pack_id').first();
    if (!serverRow) return;
    const packId: string = serverRow.pack_id;
    // 2. 查询 pack.business.players.kick_command 模板
    const business = registry.getBusinessConfig(packId);
    if (!business?.players?.kick_command) {
      logger.warn({ server_id, packId }, 'Pack 未声明 business.players.kick_command，跳过 kick 下发');
      return;
    }
    const kickTemplate = business.players.kick_command;
    // 3. 渲染命令（替换 {{player}} {{reason}}）
    let command: string;
    try {
      command = commandDispatcher.renderCommand(kickTemplate, { player: target, reason: reason || 'vote_passed' });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), server_id, target },
        '渲染 kick_command 失败',
      );
      return;
    }
    // 4. 入队下发（high 优先级）
    await commandDispatcher.enqueue(server_id, command, 'high');
    logger.info({ server_id, vote_id, target, command }, 'vote kick 命令已入队');
  }

  // S7-4: webhook 自动触发链路 —— 订阅 eventBus 关键事件，自动调用 webhookService.triggerWebhook
  const subscribeWebhook = (
    eventType: string,
    extractServerId: (payload: unknown) => string | null,
  ): void => {
    eventBus.on(eventType, (payload: unknown) => {
      const serverId = extractServerId(payload);
      if (!serverId) return;
      void webhookService
        .triggerWebhook(serverId, eventType, payload)
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err), eventType },
            'webhook 自动触发失败',
          );
        });
    });
  };
  subscribeWebhook(ORDER_CLAIMED, (p) => (p as { server_id?: string })?.server_id ?? null);
  subscribeWebhook(CDK_REDEEMED, (p) => (p as { server_id?: string })?.server_id ?? null);
  subscribeWebhook(VOTE_THRESHOLD_MET, (p) => (p as { server_id?: string })?.server_id ?? null);
}
