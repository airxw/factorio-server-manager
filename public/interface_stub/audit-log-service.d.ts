/**
 * audit-log-service.d.ts — auditLogService 接口存根
 *
 * 职责：审计日志写入 / 查询
 * 数据契约：public/schema/audit-logs-schema.json
 * 来源：scheme-final-merged.md §4.3.7 P5 / §7.1 P5
 *
 * 关键约束：审计日志不应抛出业务异常，写入失败时静默记录（不阻断主流程）
 */

import type { AuditLog, AuditLogFilter } from './shared-types';

export interface AuditLogService {
  /**
   * 写入审计日志。INSERT audit_logs。
   * 设计约束：本方法不应抛出异常，DB 写入失败时静默记录到 stderr/日志文件，
   * 不影响调用方主流程（如用户登录不应因审计日志失败而失败）。
   * @param userId 操作者用户 ID，null=系统自动操作
   * @param action 操作标识（如 'user.login' / 'shop.order.create' / 'vote.kick'）
   * @param targetType 操作目标类型（如 'user' / 'server' / 'shop_order'），null=无明确目标
   * @param targetId 操作目标 ID（字符串形式），null=无明确目标
   * @param details 操作详情（任意可序列化对象，内部 JSON.stringify 存储）
   * @param ipAddress 操作者 IP，可空
   * @param serverId 服务器 ID，null=非服务器维度操作（如用户登录）
   */
  log(
    userId: string | null,
    action: string,
    targetType: string,
    targetId: string,
    details: any,
    ipAddress?: string,
    serverId?: string,
  ): Promise<void>;

  /**
   * 查询审计日志。按 AuditLogFilter 过滤，按 created_at 倒序。
   * @param filter 过滤条件（server_id / user_id / action / target_type / target_id / from / to / limit / offset）
   */
  listLogs(filter: AuditLogFilter): Promise<AuditLog[]>;
}
