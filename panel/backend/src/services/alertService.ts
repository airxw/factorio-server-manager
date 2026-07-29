// ============================================================================
// alertService — 告警主动通知服务（v4.6.0-F）
//
// 用途：记录告警事件 + 多通道分发（in_app / email / webhook）。
//   - 预置 5 类规则：instance_crash / instance_abnormal_exit / disk_high / ssl_expiring / backup_failing
//   - 用户可通过 alert_settings 配置订阅与通道开关
//   - 告警事件持久化到 alert_events 表，供运营仪表盘 / 告警历史页查询
//
// 设计要点：
//   - 所有 DB 查询用 try-catch 保护，表不存在时返回安全默认值
//   - 分发失败仅记日志不抛错（避免影响业务主流程）
//   - 邮件/webhook 分发在本服务内直接实现（不修改 notificationService，避免循环依赖）
//   - getSubscribers 按 serverId 范围过滤：实例相关告警→owner+instance_admins；全局告警→所有 server_admin
// ============================================================================

import crypto from 'node:crypto';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type {
  AlertRule,
  AlertRuleType,
  AlertSeverity,
  AlertChannel,
  AlertEvent,
  AlertSettings,
} from '@public/schema/panel-api-types';
import type { NotificationServiceImpl } from './notificationService.js';
import type { MailService } from './mailService.js';

// ---------------------------------------------------------------------------
// 预置告警规则
// ---------------------------------------------------------------------------

export const PRESET_ALERT_RULES: AlertRule[] = [
  {
    type: 'instance_crash',
    name: '实例崩溃',
    description: '实例崩溃熔断触发（状态被修正为 error）',
    severity: 'critical',
    default_channels: ['in_app', 'email'],
  },
  {
    type: 'instance_abnormal_exit',
    name: '实例异常退出',
    description: '实例非主动停止而退出',
    severity: 'warning',
    default_channels: ['in_app'],
  },
  {
    type: 'disk_high',
    name: '磁盘使用率过高',
    description: '磁盘使用率超过 90%',
    severity: 'critical',
    default_channels: ['in_app', 'email'],
  },
  {
    type: 'ssl_expiring',
    name: 'SSL 证书即将到期',
    description: 'SSL 证书 30 天内到期',
    severity: 'warning',
    default_channels: ['in_app', 'email'],
  },
  {
    type: 'backup_failing',
    name: '备份连续失败',
    description: '备份连续 3 天失败',
    severity: 'warning',
    default_channels: ['in_app'],
  },
];

/** 所有预置规则类型（用于默认订阅） */
const ALL_RULE_TYPES: AlertRuleType[] = PRESET_ALERT_RULES.map((r) => r.type);

/** 规则类型 → 规则元数据映射 */
const RULE_MAP: Map<AlertRuleType, AlertRule> = new Map(
  PRESET_ALERT_RULES.map((r) => [r.type, r]),
);

// ---------------------------------------------------------------------------
// DB 行类型
// ---------------------------------------------------------------------------

interface AlertEventDbRow {
  id: string;
  rule_type: string;
  severity: string;
  title: string;
  content: string;
  related_server_id: string | null;
  triggered_at: string;
  dispatched_channels: string;
  created_at: string;
}

interface AlertSettingsDbRow {
  user_id: string;
  email_enabled: number;
  webhook_url: string;
  webhook_enabled: number;
  subscribed_rules: string;
  updated_at: string;
}

interface UserEmailRow {
  id: string;
  email: string;
  email_verified: number;
}

interface ServerOwnerRow {
  owner_user_id: string;
}

interface InstanceAdminRow {
  user_id: string;
}

interface AdminUserRow {
  id: string;
  role: string;
}

interface CountRow {
  cnt: number;
}

// ---------------------------------------------------------------------------
// 服务类
// ---------------------------------------------------------------------------

/**
 * 告警主动通知服务
 *
 * 方法：
 * - recordAlert：持久化告警事件 + 分发到各通道
 * - dispatchToChannels：实际分发（in_app/email/webhook）
 * - listRecentAlerts / listRecentAlertsForServers：查询近 N 小时告警
 * - listAlertEvents：全量分页查询
 * - getSettings / updateSettings：用户告警配置管理
 * - getSubscribers：查询订阅了某规则的用户 ID 列表
 * - testWebhook：测试 webhook 连通性
 * - trigger*：5 类预置规则的触发辅助方法
 */
export class AlertService {
  constructor(
    private readonly db: Knex,
    private readonly notificationService: NotificationServiceImpl,
    private readonly mailService: MailService,
    private readonly logger: Logger,
  ) {}

  /**
   * 记录告警事件 + 分发到各通道
   * 持久化失败/分发失败仅记日志，不抛错（避免影响业务主流程）
   */
  async recordAlert(params: {
    rule_type: AlertRuleType;
    severity: AlertSeverity;
    title: string;
    content: string;
    related_server_id?: string | null;
    channels: AlertChannel[];
  }): Promise<AlertEvent> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const event: AlertEvent = {
      id,
      rule_type: params.rule_type,
      severity: params.severity,
      title: params.title,
      content: params.content,
      related_server_id: params.related_server_id ?? null,
      triggered_at: now,
      dispatched_channels: params.channels,
    };

    // 1. 持久化告警事件
    try {
      await this.db('alert_events').insert({
        id,
        rule_type: params.rule_type,
        severity: params.severity,
        title: params.title,
        content: params.content,
        related_server_id: params.related_server_id ?? null,
        triggered_at: now,
        dispatched_channels: JSON.stringify(params.channels),
        created_at: now,
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[alertService] 持久化告警事件失败',
      );
    }

    // 2. 查询订阅者并分发
    try {
      const userIds = await this.getSubscribers(
        params.rule_type,
        params.related_server_id ?? null,
      );
      await this.dispatchToChannels(event, userIds, params.channels);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[alertService] 分发告警失败',
      );
    }

    return event;
  }

  /**
   * 实际分发告警到各通道
   * - in_app：notificationService.create（所有订阅者都发）
   * - email：仅对 email_enabled=true 且邮箱已验证的用户发
   * - webhook：仅对 webhook_enabled=true 且 webhook_url 非空的用户发
   * 单个用户/单个通道失败不影响其他分发
   */
  async dispatchToChannels(
    event: AlertEvent,
    userIds: string[],
    channels: AlertChannel[],
  ): Promise<void> {
    for (const userId of userIds) {
      // 获取用户告警配置（决定 email/webhook 通道是否启用）
      const settings = await this.getSettings(userId);

      for (const channel of channels) {
        try {
          if (channel === 'in_app') {
            await this.notificationService.create({
              userId,
              type: `alert_${event.rule_type}`,
              title: event.title,
              content: event.content,
              relatedServerId: event.related_server_id ?? undefined,
            });
          } else if (channel === 'email') {
            if (!settings.email_enabled) continue;
            const userRow = await this.getUserEmail(userId);
            if (!userRow || !userRow.email_verified) continue;
            await this.mailService.sendAlertEmail(
              userRow.email,
              event.title,
              event.content,
            );
          } else if (channel === 'webhook') {
            if (!settings.webhook_enabled || !settings.webhook_url) continue;
            await this.notifyViaWebhook(settings.webhook_url, event);
          }
        } catch (err) {
          this.logger.warn(
            {
              err: err instanceof Error ? err.message : String(err),
              userId,
              channel,
              ruleType: event.rule_type,
            },
            '[alertService] 单通道分发失败',
          );
        }
      }
    }
  }

  /**
   * 查询近 N 小时告警（用于运营仪表盘 alerts 字段）
   * @param hours 时间范围（小时）
   * @param serverId 可选，过滤指定实例
   */
  async listRecentAlerts(
    hours: number,
    serverId?: string | null,
  ): Promise<AlertEvent[]> {
    try {
      const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      let query = this.db<AlertEventDbRow>('alert_events')
        .where('triggered_at', '>=', since)
        .orderBy('triggered_at', 'desc')
        .limit(100);
      if (serverId !== undefined && serverId !== null) {
        query = query.where('related_server_id', serverId);
      }
      const rows = await query;
      return rows.map(toAlertEvent);
    } catch {
      return [];
    }
  }

  /**
   * 查询指定实例集合的近 N 小时告警（用于 instance_admin 范围过滤）
   */
  async listRecentAlertsForServers(
    hours: number,
    serverIds: string[],
  ): Promise<AlertEvent[]> {
    if (serverIds.length === 0) return [];
    try {
      const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      const rows = await this.db<AlertEventDbRow>('alert_events')
        .where('triggered_at', '>=', since)
        .whereIn('related_server_id', serverIds)
        .orderBy('triggered_at', 'desc')
        .limit(100);
      return rows.map(toAlertEvent);
    } catch {
      return [];
    }
  }

  /**
   * 全量分页查询告警历史（按 triggered_at DESC）
   */
  async listAlertEvents(
    limit?: number,
  ): Promise<{ events: AlertEvent[]; total: number }> {
    try {
      const safeLimit = Math.max(1, Math.min(limit ?? 100, 500));
      const rows = await this.db<AlertEventDbRow>('alert_events')
        .orderBy('triggered_at', 'desc')
        .limit(safeLimit);
      const totalRow = (await this.db('alert_events')
        .count('* as cnt')
        .first()) as unknown as CountRow | undefined;
      return {
        events: rows.map(toAlertEvent),
        total: Number(totalRow?.cnt ?? 0),
      };
    } catch {
      return { events: [], total: 0 };
    }
  }

  /**
   * 获取用户告警配置
   * 不存在时返回默认值：email_enabled=false, webhook_url='', webhook_enabled=false,
   *                   subscribed_rules=所有规则类型
   */
  async getSettings(userId: string): Promise<AlertSettings> {
    try {
      const row = await this.db<AlertSettingsDbRow>('alert_settings')
        .where({ user_id: userId })
        .first();
      if (row) {
        return toAlertSettings(row);
      }
    } catch {
      // 表不存在时返回默认值
    }
    return {
      user_id: userId,
      email_enabled: false,
      webhook_url: '',
      webhook_enabled: false,
      subscribed_rules: [...ALL_RULE_TYPES],
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * upsert 用户告警配置
   */
  async updateSettings(
    userId: string,
    update: Partial<{
      email_enabled: boolean;
      webhook_url: string;
      webhook_enabled: boolean;
      subscribed_rules: AlertRuleType[];
    }>,
  ): Promise<AlertSettings> {
    const now = new Date().toISOString();
    try {
      const existing = await this.db<AlertSettingsDbRow>('alert_settings')
        .where({ user_id: userId })
        .first();

      if (existing) {
        const updateFields: Record<string, unknown> = { updated_at: now };
        if (update.email_enabled !== undefined) {
          updateFields.email_enabled = update.email_enabled ? 1 : 0;
        }
        if (update.webhook_url !== undefined) {
          updateFields.webhook_url = update.webhook_url;
        }
        if (update.webhook_enabled !== undefined) {
          updateFields.webhook_enabled = update.webhook_enabled ? 1 : 0;
        }
        if (update.subscribed_rules !== undefined) {
          updateFields.subscribed_rules = JSON.stringify(update.subscribed_rules);
        }
        await this.db('alert_settings')
          .where({ user_id: userId })
          .update(updateFields);
        const updated = await this.db<AlertSettingsDbRow>('alert_settings')
          .where({ user_id: userId })
          .first();
        if (updated) return toAlertSettings(updated);
        return toAlertSettings(existing);
      }

      // insert
      const subscribedRules = update.subscribed_rules ?? [...ALL_RULE_TYPES];
      await this.db('alert_settings').insert({
        user_id: userId,
        email_enabled: update.email_enabled ? 1 : 0,
        webhook_url: update.webhook_url ?? '',
        webhook_enabled: update.webhook_enabled ? 1 : 0,
        subscribed_rules: JSON.stringify(subscribedRules),
        updated_at: now,
      });
      return {
        user_id: userId,
        email_enabled: update.email_enabled ?? false,
        webhook_url: update.webhook_url ?? '',
        webhook_enabled: update.webhook_enabled ?? false,
        subscribed_rules: subscribedRules,
        updated_at: now,
      };
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[alertService] 更新用户告警配置失败',
      );
      throw new Error('ALERT_SETTINGS_UPDATE_FAILED');
    }
  }

  /**
   * 查询订阅了某规则的用户 ID 列表
   * - serverId 不为 null：返回该实例的 owner + instance_admins（且订阅了该规则的用户）
   * - serverId 为 null：返回所有 server_admin（且订阅了该规则的用户）
   */
  async getSubscribers(
    ruleType: AlertRuleType,
    serverId: string | null,
  ): Promise<string[]> {
    // 1. 获取候选用户 ID
    const candidateIds = await this.getCandidateUsers(serverId);
    if (candidateIds.length === 0) return [];

    // 2. 按订阅过滤
    const subscribers: string[] = [];
    for (const userId of candidateIds) {
      const settings = await this.getSettings(userId);
      if (settings.subscribed_rules.includes(ruleType)) {
        subscribers.push(userId);
      }
    }
    return subscribers;
  }

  /**
   * 测试 webhook 连通性
   */
  async testWebhook(
    webhookUrl: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!webhookUrl) {
      return { success: false, message: 'webhook_url 为空' };
    }
    try {
      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'alert_test',
          message: '这是一条来自告警系统的测试消息',
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.ok) {
        return { success: true, message: `Webhook 响应正常（HTTP ${resp.status}）` };
      }
      return {
        success: false,
        message: `Webhook 返回非 2xx 状态码：HTTP ${resp.status}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Webhook 请求失败：${msg}` };
    }
  }

  // -------------------------------------------------------------------------
  // 告警触发辅助方法（5 类预置规则）
  // 失败仅记日志不抛错（避免影响业务主流程）
  // -------------------------------------------------------------------------

  /** 触发 instance_crash 告警（实例崩溃） */
  async triggerInstanceCrash(
    serverId: string,
    instanceName: string,
    reason: string,
  ): Promise<void> {
    const rule = RULE_MAP.get('instance_crash');
    if (!rule) return;
    try {
      await this.recordAlert({
        rule_type: 'instance_crash',
        severity: rule.severity,
        title: `实例崩溃：${instanceName}`,
        content: `实例 ${instanceName}（ID: ${serverId}）触发崩溃告警。\n原因：${reason}\n时间：${new Date().toISOString()}`,
        related_server_id: serverId,
        channels: rule.default_channels,
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), serverId },
        '[alertService] triggerInstanceCrash 失败',
      );
    }
  }

  /** 触发 instance_abnormal_exit 告警（实例异常退出） */
  async triggerInstanceAbnormalExit(
    serverId: string,
    instanceName: string,
    exitCode: number,
  ): Promise<void> {
    const rule = RULE_MAP.get('instance_abnormal_exit');
    if (!rule) return;
    try {
      await this.recordAlert({
        rule_type: 'instance_abnormal_exit',
        severity: rule.severity,
        title: `实例异常退出：${instanceName}`,
        content: `实例 ${instanceName}（ID: ${serverId}）异常退出（非用户主动停止）。\n退出码：${exitCode}\n时间：${new Date().toISOString()}`,
        related_server_id: serverId,
        channels: rule.default_channels,
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), serverId },
        '[alertService] triggerInstanceAbnormalExit 失败',
      );
    }
  }

  /** 触发 disk_high 告警（磁盘使用率过高，全局告警） */
  async triggerDiskHigh(mount: string, usedPercent: number): Promise<void> {
    const rule = RULE_MAP.get('disk_high');
    if (!rule) return;
    try {
      await this.recordAlert({
        rule_type: 'disk_high',
        severity: rule.severity,
        title: `磁盘使用率告警：${usedPercent}%`,
        content: `分区 ${mount} 使用率 ${usedPercent}%，已超过 90% 阈值。\n时间：${new Date().toISOString()}`,
        related_server_id: null,
        channels: rule.default_channels,
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), mount, usedPercent },
        '[alertService] triggerDiskHigh 失败',
      );
    }
  }

  /** 触发 ssl_expiring 告警（SSL 证书即将到期，全局告警） */
  async triggerSslExpiring(daysRemaining: number, certPath: string): Promise<void> {
    const rule = RULE_MAP.get('ssl_expiring');
    if (!rule) return;
    try {
      await this.recordAlert({
        rule_type: 'ssl_expiring',
        severity: rule.severity,
        title: `SSL 证书即将到期：剩余 ${daysRemaining} 天`,
        content: `SSL 证书将在 ${daysRemaining} 天内到期。\n证书路径：${certPath}\n时间：${new Date().toISOString()}`,
        related_server_id: null,
        channels: rule.default_channels,
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), daysRemaining },
        '[alertService] triggerSslExpiring 失败',
      );
    }
  }

  /** 触发 backup_failing 告警（备份连续失败） */
  async triggerBackupFailing(
    serverId: string,
    instanceName: string,
    failedDays: number,
  ): Promise<void> {
    const rule = RULE_MAP.get('backup_failing');
    if (!rule) return;
    try {
      await this.recordAlert({
        rule_type: 'backup_failing',
        severity: rule.severity,
        title: `备份连续失败：${instanceName}`,
        content: `实例 ${instanceName}（ID: ${serverId}）备份已连续 ${failedDays} 天失败。\n时间：${new Date().toISOString()}`,
        related_server_id: serverId,
        channels: rule.default_channels,
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), serverId },
        '[alertService] triggerBackupFailing 失败',
      );
    }
  }

  // -------------------------------------------------------------------------
  // 私有辅助方法
  // -------------------------------------------------------------------------

  /** 获取候选用户 ID 列表（按 serverId 范围） */
  private async getCandidateUsers(serverId: string | null): Promise<string[]> {
    const ids = new Set<string>();

    if (serverId) {
      // 实例相关告警：owner + instance_admins
      try {
        const server = await this.db<ServerOwnerRow>('servers')
          .where('id', serverId)
          .select('owner_user_id')
          .first();
        if (server?.owner_user_id) ids.add(server.owner_user_id);
      } catch {
        // servers 表不存在时忽略
      }
      try {
        const admins = await this.db<InstanceAdminRow>('instance_admins')
          .where('instance_id', serverId)
          .select('user_id');
        for (const a of admins) ids.add(a.user_id);
      } catch {
        // instance_admins 表不存在时忽略
      }
    } else {
      // 全局告警：所有 server_admin（含旧值 system_admin）
      try {
        const admins = await this.db<AdminUserRow>('users')
          .whereIn('role', ['server_admin', 'system_admin'])
          .where('status', 'active')
          .select('id');
        for (const a of admins) ids.add(a.id);
      } catch {
        // users 表不存在时忽略
      }
    }

    return Array.from(ids);
  }

  /** 获取用户邮箱及验证状态 */
  private async getUserEmail(userId: string): Promise<UserEmailRow | null> {
    try {
      const row = await this.db<UserEmailRow>('users')
        .where({ id: userId })
        .select('id', 'email', 'email_verified')
        .first();
      return row ?? null;
    } catch {
      return null;
    }
  }

  /** 通过 Webhook 通知（HTTP POST） */
  private async notifyViaWebhook(webhookUrl: string, payload: unknown): Promise<void> {
    if (!webhookUrl) return;
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), webhookUrl },
        '[alertService] webhook 通知失败',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function toAlertEvent(row: AlertEventDbRow): AlertEvent {
  return {
    id: row.id,
    rule_type: row.rule_type as AlertRuleType,
    severity: row.severity as AlertSeverity,
    title: row.title,
    content: row.content,
    related_server_id: row.related_server_id,
    triggered_at: row.triggered_at,
    dispatched_channels: parseChannels(row.dispatched_channels),
  };
}

function toAlertSettings(row: AlertSettingsDbRow): AlertSettings {
  return {
    user_id: row.user_id,
    email_enabled: row.email_enabled === 1,
    webhook_url: row.webhook_url,
    webhook_enabled: row.webhook_enabled === 1,
    subscribed_rules: parseRules(row.subscribed_rules),
    updated_at: row.updated_at,
  };
}

/** JSON 解析容错：通道数组 */
function parseChannels(json: string): AlertChannel[] {
  try {
    const arr = JSON.parse(json) as unknown[];
    return arr.filter((c): c is AlertChannel =>
      c === 'in_app' || c === 'email' || c === 'webhook',
    );
  } catch {
    return [];
  }
}

/** JSON 解析容错：规则类型数组 */
function parseRules(json: string): AlertRuleType[] {
  try {
    const arr = JSON.parse(json) as unknown[];
    const validTypes: AlertRuleType[] = [
      'instance_crash',
      'instance_abnormal_exit',
      'disk_high',
      'ssl_expiring',
      'backup_failing',
    ];
    return arr.filter((r): r is AlertRuleType =>
      typeof r === 'string' && validTypes.includes(r as AlertRuleType),
    );
  } catch {
    return [];
  }
}
