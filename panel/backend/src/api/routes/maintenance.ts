// ============================================================================
// v3.6.2: 运维清理聚合页 API（仅 server_admin 可见）
// 挂载前缀：/api/admin/maintenance（index.ts 套 authenticateToken + requireAdmin）
//
// 端点：
//   GET  /overview           — 四张表行数/retention/上次清理/scheduler 状态
//   POST /cleanup            — 手动触发清理（单表或全部），返回 deleted_rows
//   POST /cleanup-all/preview — 一键清理预览（返回将影响的表+行数+总大小，不实际清理）
//   PUT  /retention          — 修改 retention_days（1-365），仅 server_admin
//
// 支持的四张表：
//   - audit_logs（retention_days 字段，默认 90）
//   - user_notifications（retention_days 字段，默认 30）
//   - item_sync_log（retention_days 字段，默认 30）
//   - chat_logs（retention 来自 Pack.chat_log 配置，不支持 PUT 修改）
// ============================================================================

import { Router } from 'express';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type {
  MaintenanceTableName,
  MaintenanceTableSummary,
  MaintenanceOverviewResponse,
  CleanupRequest,
  CleanupResponse,
  CleanupResultEntry,
  RetentionUpdateRequest,
  RetentionUpdateResponse,
  DataVolumeTableName,
  DataVolumeTableStatus,
  DataVolumeLevel,
  DataVolumeResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/** v3.6.2: maintenance 路由依赖的服务最小接口（避免直接依赖具体实现类） */
interface RetentionAwareService {
  cleanupOldLogs(): Promise<number>;
  updateRetentionDays(retentionDays: number): Promise<void>;
  getRetentionStats(): Promise<{ retention_days: number; row_count: number }>;
}

interface ChatLogCleanupService {
  cleanupOldLogs(serverId: string): Promise<number>;
}

/** 支持 PUT /retention 的表（chat_logs 除外，其 retention 来自 Pack 配置） */
const RETENTION_EDITABLE_TABLES: MaintenanceTableName[] = [
  'audit_logs',
  'user_notifications',
  'item_sync_log',
];

const ALL_TABLES: MaintenanceTableName[] = [
  'audit_logs',
  'user_notifications',
  'item_sync_log',
  'chat_logs',
];

// ----- v4.32.2 B2.8: 数据量监控告警 -----
/**
 * 监控的 7 张表默认阈值（行数）。
 * 阈值可通过 system_config KV 覆盖：
 *   key = `monitor.data_volume_threshold.<table_name>`
 *   value = 数字字符串
 *
 * 阈值设定依据：
 *   - audit_logs / user_notifications / item_sync_log / chat_logs：日志表，retention 已兜底，阈值偏高
 *   - player_bindings：按服务器维度增长，单服务器通常 <1000，全平台阈值 50000
 *   - webhooks：通常 <10/实例，阈值 200
 *   - api_keys：通常 <50/用户，阈值 500
 *
 * 超过阈值 80% → warning；超过 95% → critical。
 */
const DATA_VOLUME_DEFAULT_THRESHOLDS: Record<DataVolumeTableName, number> = {
  audit_logs: 100_000,
  user_notifications: 50_000,
  item_sync_log: 50_000,
  chat_logs: 100_000,
  player_bindings: 50_000,
  webhooks: 200,
  api_keys: 500,
};

const DATA_VOLUME_TABLES: DataVolumeTableName[] = [
  'audit_logs',
  'user_notifications',
  'item_sync_log',
  'chat_logs',
  'player_bindings',
  'webhooks',
  'api_keys',
];

/** 按 row_count / threshold 比例判定告警等级（导出供单测引用） */
export function classifyDataVolumeLevel(rowCount: number, threshold: number): DataVolumeLevel {
  if (threshold <= 0) return 'normal';
  const pct = (rowCount / threshold) * 100;
  if (pct >= 95) return 'critical';
  if (pct >= 80) return 'warning';
  return 'normal';
}

interface MaintenanceRouteDeps {
  db: Knex;
  auditLogService: RetentionAwareService;
  notificationService: RetentionAwareService;
  itemSyncService: RetentionAwareService;
  chatLogService: ChatLogCleanupService;
  logger: Logger;
}

export function createMaintenanceRouter(deps: MaintenanceRouteDeps): Router {
  const router = Router();
  const { db, auditLogService, notificationService, itemSyncService, chatLogService, logger } = deps;

  // GET /api/admin/maintenance/overview
  router.get('/overview', async (_req, res) => {
    try {
      const tables: MaintenanceTableSummary[] = [];

      // audit_logs
      const auditStats = await auditLogService.getRetentionStats();
      tables.push({
        table_name: 'audit_logs',
        row_count: auditStats.row_count,
        retention_days: auditStats.retention_days,
        last_cleanup_at: await getLastCleanupAt(db, 'audit_logs'),
      });

      // user_notifications
      const notifStats = await notificationService.getRetentionStats();
      tables.push({
        table_name: 'user_notifications',
        row_count: notifStats.row_count,
        retention_days: notifStats.retention_days,
        last_cleanup_at: await getLastCleanupAt(db, 'user_notifications'),
      });

      // item_sync_log
      const itemSyncStats = await itemSyncService.getRetentionStats();
      tables.push({
        table_name: 'item_sync_log',
        row_count: itemSyncStats.row_count,
        retention_days: itemSyncStats.retention_days,
        last_cleanup_at: await getLastCleanupAt(db, 'item_sync_log'),
      });

      // chat_logs（retention 来自 Pack.chat_log 配置，这里用默认 7 作展示代表）
      const chatLogsCount = await db('chat_logs').count('* as cnt').first();
      tables.push({
        table_name: 'chat_logs',
        row_count: Number(chatLogsCount?.cnt ?? 0),
        retention_days: 7, // 实际 retention 来自 Pack 配置，此处仅作展示占位
        last_cleanup_at: await getLastCleanupAt(db, 'chat_logs'),
      });

      const response: MaintenanceOverviewResponse = {
        tables,
        scheduler_enabled: true, // scheduler 已注册即可视为 enabled
      };
      res.json(response);
    } catch (err) {
      logger.error({ err }, 'maintenance/overview 失败');
      const body: PanelErrorResponse = {
        error: { code: 'PANEL_INTERNAL_ERROR', message: '获取运维清理概览失败' },
      };
      res.status(500).json(body);
    }
  });

  // POST /api/admin/maintenance/cleanup
  router.post('/cleanup', async (req, res) => {
    try {
      const reqBody = (req.body ?? {}) as CleanupRequest;
      const targetTables: MaintenanceTableName[] = reqBody.table_name
        ? [reqBody.table_name]
        : ALL_TABLES;

      // 校验 table_name 合法性
      for (const t of targetTables) {
        if (!ALL_TABLES.includes(t)) {
          const body: PanelErrorResponse = {
            error: { code: 'MAINTENANCE_TABLE_NOT_FOUND', message: `未知的表名: ${t}` },
          };
          res.status(400).json(body);
          return;
        }
      }

      const results: CleanupResultEntry[] = [];
      for (const tableName of targetTables) {
        let deletedRows = 0;
        try {
          if (tableName === 'audit_logs') {
            deletedRows = await auditLogService.cleanupOldLogs();
          } else if (tableName === 'user_notifications') {
            deletedRows = await notificationService.cleanupOldLogs();
          } else if (tableName === 'item_sync_log') {
            deletedRows = await itemSyncService.cleanupOldLogs();
          } else if (tableName === 'chat_logs') {
            // chat_logs 需遍历所有实例调用 chatLogService.cleanupOldLogs
            const serverRows = await db('servers').select('id');
            for (const row of serverRows) {
              try {
                deletedRows += await chatLogService.cleanupOldLogs(row.id);
              } catch (err) {
                logger.warn(
                  { err: err instanceof Error ? err.message : String(err), serverId: row.id },
                  'chat_logs 清理失败（单实例）',
                );
              }
            }
          }
          // 记录清理时间到 system_config（best-effort）
          await recordCleanupTime(db, tableName);
        } catch (err) {
          logger.error(
            { err, tableName },
            'maintenance/cleanup 单表清理失败',
          );
        }
        results.push({ table_name: tableName, deleted_rows: deletedRows });
      }

      const response: CleanupResponse = { results };
      res.json(response);
    } catch (err) {
      logger.error({ err }, 'maintenance/cleanup 失败');
      const body: PanelErrorResponse = {
        error: { code: 'PANEL_INTERNAL_ERROR', message: '触发清理失败' },
      };
      res.status(500).json(body);
    }
  });

  // POST /api/admin/maintenance/cleanup-all/preview
  //   一键清理预览：返回将影响的表 + 行数 + 总大小（不实际清理）
  //   size_bytes：SQLite 不易暴露 per-table 大小，返回 null；total_size_bytes 取 DB 文件大小
  router.post('/cleanup-all/preview', async (_req, res) => {
    try {
      const tables: Array<{
        name: MaintenanceTableName;
        rows: number;
        size_bytes: number | null;
      }> = [];
      let totalRows = 0;

      for (const tableName of ALL_TABLES) {
        let rows = 0;
        try {
          const countRow = await db(tableName).count('* as cnt').first();
          rows = Number(countRow?.cnt ?? 0);
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), tableName },
            'cleanup-all/preview: 查询表行数失败',
          );
        }
        totalRows += rows;
        tables.push({ name: tableName, rows, size_bytes: null });
      }

      // SQLite 总 DB 大小（page_count * page_size）；失败返回 null
      let totalSizeBytes: number | null = null;
      try {
        const sizeResult = await db.raw(
          'SELECT page_count * page_size AS total_size FROM pragma_page_count(), pragma_page_size()',
        );
        // knex sqlite3 返回形式兼容：数组取首行 / 对象取 rows
        const row = Array.isArray(sizeResult)
          ? sizeResult[0]
          : (sizeResult as { rows?: Array<{ total_size?: number }> }).rows?.[0];
        const sz = row?.total_size;
        if (typeof sz === 'number' && Number.isFinite(sz)) {
          totalSizeBytes = sz;
        }
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'cleanup-all/preview: 查询 DB 总大小失败',
        );
      }

      res.json({
        tables,
        total_rows: totalRows,
        total_size_bytes: totalSizeBytes,
      });
    } catch (err) {
      logger.error({ err }, 'maintenance/cleanup-all/preview 失败');
      const body: PanelErrorResponse = {
        error: { code: 'PANEL_INTERNAL_ERROR', message: '获取清理预览失败' },
      };
      res.status(500).json(body);
    }
  });

  // PUT /api/admin/maintenance/retention
  router.put('/retention', async (req, res) => {
    try {
      const reqBody = (req.body ?? {}) as RetentionUpdateRequest;
      const { table_name, retention_days } = reqBody;

      // 校验 table_name 可编辑
      if (!RETENTION_EDITABLE_TABLES.includes(table_name)) {
        const body: PanelErrorResponse = {
          error: {
            code: 'MAINTENANCE_TABLE_NOT_FOUND',
            message: `表 ${table_name} 不支持修改 retention（chat_logs 来自 Pack 配置）`,
          },
        };
        res.status(400).json(body);
        return;
      }

      // 校验 retention_days 范围
      if (
        !Number.isInteger(retention_days) ||
        retention_days < 1 ||
        retention_days > 365
      ) {
        const body: PanelErrorResponse = {
          error: {
            code: 'MAINTENANCE_INVALID_RETENTION',
            message: 'retention_days 必须为 1-365 之间的整数',
          },
        };
        res.status(400).json(body);
        return;
      }

      // 更新全表 retention_days
      if (table_name === 'audit_logs') {
        await auditLogService.updateRetentionDays(retention_days);
      } else if (table_name === 'user_notifications') {
        await notificationService.updateRetentionDays(retention_days);
      } else if (table_name === 'item_sync_log') {
        await itemSyncService.updateRetentionDays(retention_days);
      }

      const response: RetentionUpdateResponse = {
        table_name,
        retention_days,
      };
      res.json(response);
    } catch (err) {
      logger.error({ err }, 'maintenance/retention 失败');
      const body: PanelErrorResponse = {
        error: { code: 'PANEL_INTERNAL_ERROR', message: '修改 retention 失败' },
      };
      res.status(500).json(body);
    }
  });

  // GET /api/admin/maintenance/data-volume
  //   v4.32.2 B2.8: 数据量监控告警——返回 7 张关键表的行数 + 阈值 + 告警等级
  //   阈值优先从 system_config 读取（key: monitor.data_volume_threshold.<table>），缺失则用默认值
  //   任一表查询失败不阻断其他表（与 overview 行为一致）
  router.get('/data-volume', async (_req, res) => {
    try {
      const tables: DataVolumeTableStatus[] = [];
      let warningCount = 0;
      let criticalCount = 0;

      for (const tableName of DATA_VOLUME_TABLES) {
        // 默认阈值
        const defaultThreshold = DATA_VOLUME_DEFAULT_THRESHOLDS[tableName];
        // 尝试从 system_config 读取自定义阈值
        let threshold = defaultThreshold;
        try {
          const row = await db('system_config')
            .where({ key: `monitor.data_volume_threshold.${tableName}` })
            .select('value')
            .first();
          if (row?.value) {
            const parsed = parseInt(row.value, 10);
            if (Number.isInteger(parsed) && parsed > 0) {
              threshold = parsed;
            }
          }
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), tableName },
            'data-volume: 读取自定义阈值失败，使用默认值',
          );
        }

        // 查询行数（表可能不存在，失败时记 0 + normal）
        let rowCount = 0;
        try {
          const countRow = await db(tableName).count('* as cnt').first();
          rowCount = Number(countRow?.cnt ?? 0);
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), tableName },
            'data-volume: 查询表行数失败',
          );
        }

        const level = classifyDataVolumeLevel(rowCount, threshold);
        const percent = threshold > 0 ? (rowCount / threshold) * 100 : 0;
        if (level === 'warning') warningCount += 1;
        if (level === 'critical') criticalCount += 1;

        tables.push({
          table_name: tableName,
          row_count: rowCount,
          threshold,
          level,
          percent: Math.round(percent * 100) / 100,
        });
      }

      // 按 table_name 升序，便于前端稳定渲染
      tables.sort((a, b) => a.table_name.localeCompare(b.table_name));

      const response: DataVolumeResponse = {
        tables,
        has_alert: warningCount > 0 || criticalCount > 0,
        warning_count: warningCount,
        critical_count: criticalCount,
        checked_at: new Date().toISOString(),
      };
      res.json(response);
    } catch (err) {
      logger.error({ err }, 'maintenance/data-volume 失败');
      const body: PanelErrorResponse = {
        error: { code: 'PANEL_INTERNAL_ERROR', message: '获取数据量监控数据失败' },
      };
      res.status(500).json(body);
    }
  });

  // ----- 辅助函数 -----

  /** 从 system_config 表读取上次清理时间（key: maintenance.last_cleanup.<table>） */
  async function getLastCleanupAt(_db: Knex, tableName: string): Promise<string | null> {
    try {
      const row = await _db('system_config')
        .where({ key: `maintenance.last_cleanup.${tableName}` })
        .select('value')
        .first();
      return row?.value ?? null;
    } catch {
      return null;
    }
  }

  /** 记录清理时间到 system_config（best-effort，失败不阻断） */
  async function recordCleanupTime(_db: Knex, tableName: string): Promise<void> {
    try {
      const key = `maintenance.last_cleanup.${tableName}`;
      const now = new Date().toISOString();
      const existing = await _db('system_config').where({ key }).select('key').first();
      if (existing) {
        await _db('system_config').where({ key }).update({ value: now, updated_at: now });
      } else {
        await _db('system_config').insert({ key, value: now, updated_at: now });
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), tableName },
        '记录清理时间失败（best-effort，忽略）',
      );
    }
  }

  return router;
}
