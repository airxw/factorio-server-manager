// ============================================================================
// auditLogService — 审计日志管理（P5）
// 数据契约：public/schema/panel-api-types.ts（AuditLogSummary 等）
// 表结构：
//   audit_logs (id, server_id, user_id, action, target_type, target_id,
//               details_json, ip_address, created_at)
//               INDEX (created_at)
// 来源：P5 任务清单 §审计日志
//
// 说明：本服务按 P5 任务清单要求实现，依赖通过 req.app.locals.auditLogService 注入。
//       audit_logs 表无 UNIQUE 约束，不需要专门错误类。
// ============================================================================

import type { Knex } from 'knex';
import type {
  AuditLogSummary,
  ListAuditLogsQuery,
} from '@public/schema/panel-api-types';

// ----- 常量 -----

/** 审计日志列表默认条数 */
const DEFAULT_LIMIT = 100;
/** 审计日志列表最大条数 */
const MAX_LIMIT = 1000;

/** 当前时间 ISO 字符串 */
const nowIso = (): string => new Date().toISOString();

// ----- DB 行类型 -----

interface AuditLogRow {
  id: number;
  server_id: string | null;
  user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details_json: string | null;
  ip_address: string | null;
  created_at: string;
  retention_days: number;
}

// ----- 服务实现 -----

export class AuditLogServiceImpl {
  constructor(private readonly db: Knex) {}

  /**
   * 按条件查询 audit_logs
   * - 支持 server_id/user_id/action/target_type/from/to/limit 过滤
   * - limit 默认 100、最大 1000
   * - 按 created_at DESC 排序
   */
  async list(
    query: ListAuditLogsQuery,
  ): Promise<{ logs: AuditLogSummary[] }> {
    let limit = query.limit ?? DEFAULT_LIMIT;
    if (!Number.isFinite(limit) || limit <= 0) {
      limit = DEFAULT_LIMIT;
    }
    if (limit > MAX_LIMIT) {
      limit = MAX_LIMIT;
    }

    let qb = this.db<AuditLogRow>('audit_logs');
    if (query.server_id) {
      qb = qb.where('server_id', query.server_id);
    }
    if (query.user_id) {
      qb = qb.where('user_id', query.user_id);
    }
    if (query.action) {
      qb = qb.where('action', query.action);
    }
    if (query.target_type) {
      qb = qb.where('target_type', query.target_type);
    }
    if (query.from) {
      qb = qb.where('created_at', '>=', query.from);
    }
    if (query.to) {
      qb = qb.where('created_at', '<=', query.to);
    }
    const rows = await qb.orderBy('created_at', 'desc').limit(limit);
    return { logs: rows.map(toAuditLogSummary) };
  }

  /**
   * 创建审计日志
   * - created_at 默认 now() ISO
   * - details 用 JSON.stringify 存储（如果提供）
   */
  async create(
    req: {
      server_id?: string | null;
      user_id?: string | null;
      action: string;
      target_type?: string | null;
      target_id?: string | null;
      details?: Record<string, unknown> | null;
      ip_address?: string | null;
    },
  ): Promise<{ log: AuditLogSummary }> {
    const createdAt = nowIso();
    const detailsJson = req.details ? JSON.stringify(req.details) : null;
    const inserted = await this.db<AuditLogRow>('audit_logs')
      .insert({
        server_id: req.server_id ?? null,
        user_id: req.user_id ?? null,
        action: req.action,
        target_type: req.target_type ?? null,
        target_id: req.target_id ?? null,
        details_json: detailsJson,
        ip_address: req.ip_address ?? null,
        created_at: createdAt,
      })
      .returning('*');
    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return { log: toAuditLogSummary(row) };
  }

  /**
   * v3.6.2-A1: 清理超过 retention_days 的审计日志
   * retention_days 取 audit_logs 表中任意一行的值（全表统一），无行时使用默认 90 天
   * 返回删除的行数
   */
  async cleanupOldLogs(): Promise<number> {
    // 取全表 retention_days（全表统一配置，取任意一行即可）
    const sample = await this.db<AuditLogRow>('audit_logs').select('retention_days').first();
    const retentionDays = sample?.retention_days ?? 90;
    if (retentionDays <= 0) return 0;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffIso = cutoff.toISOString();

    const deleted = await this.db<AuditLogRow>('audit_logs')
      .where('created_at', '<', cutoffIso)
      .delete();

    return deleted;
  }

  /**
   * v3.6.2-A6: 更新 audit_logs 表的 retention_days（全表统一）
   */
  async updateRetentionDays(retentionDays: number): Promise<void> {
    await this.db<AuditLogRow>('audit_logs').update({ retention_days: retentionDays });
  }

  /**
   * v4.31.0: 查询本人审计日志（分页，created_at DESC）
   * - 强制按 user_id 过滤（路由层覆盖任何客户端传入的 user_id）
   * - 支持 action/target_type/from/to 过滤
   * - 返回 { logs, total, page, page_size }，前端可分页展示
   */
  async listByUser(
    userId: string,
    opts: {
      action?: string;
      target_type?: string;
      from?: string;
      to?: string;
      page?: number;
      page_size?: number;
    } = {},
  ): Promise<{
    logs: AuditLogSummary[];
    total: number;
    page: number;
    page_size: number;
  }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.page_size ?? 20));
    const offset = (page - 1) * pageSize;

    let qb = this.db<AuditLogRow>('audit_logs').where('user_id', userId);
    if (opts.action) {
      qb = qb.where('action', opts.action);
    }
    if (opts.target_type) {
      qb = qb.where('target_type', opts.target_type);
    }
    if (opts.from) {
      qb = qb.where('created_at', '>=', opts.from);
    }
    if (opts.to) {
      qb = qb.where('created_at', '<=', opts.to);
    }

    const countQb = this.db<AuditLogRow>('audit_logs').where('user_id', userId);
    if (opts.action) {
      countQb.where('action', opts.action);
    }
    if (opts.target_type) {
      countQb.where('target_type', opts.target_type);
    }
    if (opts.from) {
      countQb.where('created_at', '>=', opts.from);
    }
    if (opts.to) {
      countQb.where('created_at', '<=', opts.to);
    }
    const countRow = await countQb.count<{ cnt: number | string }>('* as cnt').first();
    const total = Number(countRow?.cnt ?? 0);

    const rows = await qb.orderBy('created_at', 'desc').limit(pageSize).offset(offset);

    return {
      logs: rows.map(toAuditLogSummary),
      total,
      page,
      page_size: pageSize,
    };
  }

  /**
   * v3.6.2-A4: 获取 audit_logs 表的 retention_days 与行数
   */
  async getRetentionStats(): Promise<{ retention_days: number; row_count: number }> {
    const sample = await this.db<AuditLogRow>('audit_logs').select('retention_days').first();
    const countResult = await this.db<AuditLogRow>('audit_logs').count<{ cnt: number | string }>('* as cnt').first();
    return {
      retention_days: sample?.retention_days ?? 90,
      row_count: Number(countResult?.cnt ?? 0),
    };
  }
}

// ----- 纯函数 / 转换函数 -----

function toAuditLogSummary(row: AuditLogRow): AuditLogSummary {
  let details: Record<string, unknown> | null = null;
  if (row.details_json) {
    try {
      details = JSON.parse(row.details_json) as Record<string, unknown>;
    } catch {
      details = null;
    }
  }
  return {
    id: row.id,
    server_id: row.server_id,
    user_id: row.user_id,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    details,
    ip_address: row.ip_address,
    created_at: row.created_at,
  };
}

// ----- 工厂 -----

export function createAuditLogService(db: Knex): AuditLogServiceImpl {
  return new AuditLogServiceImpl(db);
}
