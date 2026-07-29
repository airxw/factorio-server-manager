// ============================================================================
// diskMonitorService — 磁盘空间监控服务 (v3.9.0-D2)
//
// 职责：
//   - 周期性检查服务器磁盘使用率
//   - 超过 disk.warning_threshold 时向所有管理员发送 user_notifications
//   - 超过 disk.critical_threshold 时升级为 critical 通知
//   - 同一告警状态 6 小时内不重复发送（避免通知爆炸）
//
// 设计要点：
//   - 使用 child_process 执行 df 命令获取磁盘使用率（Linux only）
//   - 检查的是 panel.db 所在分区 + instances 备份目录所在分区
//   - 告警冷却通过 system_config 表的 disk_monitor.last_alert_* 字段记录
//   - 失败时仅记录日志不抛出（避免影响 scheduler 其他任务）
// ============================================================================
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { SettingSchemaService } from './settingSchemaService.js';
import type { NotificationServiceImpl } from './notificationService.js';
import type { AlertService } from './alertService.js';

const execAsync = promisify(exec);

/** 告警冷却时长（6 小时） */
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export interface DiskUsageInfo {
  filesystem: string;
  mount: string;
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
  used_percent: number;
}

export interface DiskMonitorResult {
  checked: boolean;
  usage: DiskUsageInfo | null;
  alerted: boolean;
  alert_level: 'none' | 'warning' | 'critical';
  error?: string;
}

export interface DiskMonitorService {
  /** 执行一次磁盘检查 + 告警（定时任务入口） */
  checkAndNotify(): Promise<DiskMonitorResult>;
  /** 仅获取磁盘使用情况（前端展示用） */
  getUsage(): Promise<DiskUsageInfo | null>;
}

interface AdminUserRow {
  id: string;
  role: string;
}

export function createDiskMonitorService(
  db: Knex,
  settingSchemaService: SettingSchemaService,
  notificationService: NotificationServiceImpl,
  logger: Logger,
  alertService?: AlertService,
): DiskMonitorService {
  /** 执行 df 获取指定路径所在分区的使用情况 */
  async function getUsageForPath(targetPath: string): Promise<DiskUsageInfo | null> {
    try {
      // df -B1 输出按字节单位；--output=source,target,size,used,avail,pcent
      const { stdout } = await execAsync(
        `df -B1 --output=source,target,size,used,avail,pcent "${targetPath}" | tail -n 1`,
      );
      const parts = stdout.trim().split(/\s+/);
      if (parts.length < 6) return null;
      const filesystem = parts[0];
      const mount = parts[1];
      const totalBytes = parseInt(parts[2], 10);
      const usedBytes = parseInt(parts[3], 10);
      const availBytes = parseInt(parts[4], 10);
      const usedPercentStr = parts[5].replace('%', '');
      const usedPercent = parseInt(usedPercentStr, 10);
      if (!Number.isFinite(totalBytes) || !Number.isFinite(usedPercent)) return null;
      return {
        filesystem,
        mount,
        total_bytes: totalBytes,
        used_bytes: usedBytes,
        available_bytes: availBytes,
        used_percent: usedPercent,
      };
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), path: targetPath },
        '[diskMonitorService] df 命令执行失败',
      );
      return null;
    }
  }

  /** 读取/更新告警冷却状态 */
  async function getLastAlertState(): Promise<{
    level: string;
    timestamp: string | null;
  }> {
    try {
      const row = await db('system_config')
        .where({ key: 'disk_monitor.last_alert' })
        .select('value')
        .first();
      if (!row) return { level: 'none', timestamp: null };
      const parsed = JSON.parse(row.value) as { level?: string; timestamp?: string };
      return {
        level: parsed.level ?? 'none',
        timestamp: parsed.timestamp ?? null,
      };
    } catch {
      return { level: 'none', timestamp: null };
    }
  }

  async function setLastAlertState(level: string): Promise<void> {
    const now = new Date().toISOString();
    const value = JSON.stringify({ level, timestamp: now });
    const existing = await db('system_config').where({ key: 'disk_monitor.last_alert' }).select('key').first();
    if (existing) {
      await db('system_config').where({ key: 'disk_monitor.last_alert' }).update({ value, updated_at: now });
    } else {
      await db('system_config').insert({ key: 'disk_monitor.last_alert', value, updated_at: now });
    }
  }

  /** 判断是否在冷却期内 */
  function isCooldown(lastTimestamp: string | null): boolean {
    if (!lastTimestamp) return false;
    const ts = Date.parse(lastTimestamp);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < ALERT_COOLDOWN_MS;
  }

  /** 向所有管理员发送通知 */
  async function notifyAllAdmins(title: string, content: string, type: string): Promise<void> {
    const admins = await db<AdminUserRow>('users')
      .select('id', 'role')
      .whereIn('role', ['server_admin', 'system_admin', 'admin'])
      .andWhere('status', 'active');
    for (const admin of admins) {
      try {
        await notificationService.create({
          userId: admin.id,
          type,
          title,
          content,
        });
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), userId: admin.id },
          '[diskMonitorService] 发送管理员通知失败',
        );
      }
    }
  }

  return {
    async getUsage(): Promise<DiskUsageInfo | null> {
      // 检查 panel.db 所在分区（即 process.cwd() 所在分区）
      return getUsageForPath(process.cwd());
    },

    async checkAndNotify(): Promise<DiskMonitorResult> {
      try {
        // 1. 获取磁盘使用率
        const usage = await getUsageForPath(process.cwd());
        if (!usage) {
          return { checked: false, usage: null, alerted: false, alert_level: 'none' };
        }

        // 2. 读取阈值
        const warningThreshold = await settingSchemaService.getNumber('disk.warning_threshold');
        const criticalThreshold = await settingSchemaService.getNumber('disk.critical_threshold');
        const warn = Number.isFinite(warningThreshold) ? warningThreshold : 85;
        const crit = Number.isFinite(criticalThreshold) ? criticalThreshold : 95;

        // 3. 判定告警级别
        let level: 'none' | 'warning' | 'critical' = 'none';
        if (usage.used_percent >= crit) level = 'critical';
        else if (usage.used_percent >= warn) level = 'warning';

        if (level === 'none') {
          // 状态恢复正常时清除冷却记录
          await setLastAlertState('none');
          return { checked: true, usage, alerted: false, alert_level: 'none' };
        }

        // 4. 检查冷却期
        const lastState = await getLastAlertState();
        // 同级别告警在冷却期内不重复发送
        if (lastState.level === level && isCooldown(lastState.timestamp)) {
          return { checked: true, usage, alerted: false, alert_level: level };
        }

        // 5. 发送告警通知
        const title =
          level === 'critical'
            ? `磁盘空间严重不足 (${usage.used_percent}%)`
            : `磁盘空间告警 (${usage.used_percent}%)`;
        const content =
          `分区 ${usage.mount} (filesystem=${usage.filesystem}) 使用率 ${usage.used_percent}%\n` +
          `已用 ${(usage.used_bytes / 1024 / 1024 / 1024).toFixed(2)} GB / ` +
          `总计 ${(usage.total_bytes / 1024 / 1024 / 1024).toFixed(2)} GB\n` +
          `可用 ${(usage.available_bytes / 1024 / 1024 / 1024).toFixed(2)} GB\n` +
          `请及时清理或扩容。`;
        await notifyAllAdmins(title, content, `disk_${level}`);

        // v4.6.0-F3: critical 级别额外触发 disk_high 告警事件（记录到 alert_events 表 + 多通道分发）
        if (alertService && level === 'critical') {
          try {
            await alertService.triggerDiskHigh(usage.mount, usage.used_percent);
          } catch (err) {
            logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[diskMonitorService] 触发 disk_high 告警失败');
          }
        }

        // 6. 更新告警状态
        await setLastAlertState(level);

        logger.warn(
          { usedPercent: usage.used_percent, level, mount: usage.mount },
          '[diskMonitorService] 磁盘告警已发送',
        );
        return { checked: true, usage, alerted: true, alert_level: level };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message }, '[diskMonitorService] 磁盘检查失败');
        return {
          checked: false,
          usage: null,
          alerted: false,
          alert_level: 'none',
          error: message,
        };
      }
    },
  };
}
