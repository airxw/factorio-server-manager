// ============================================================================
// loginHistoryService — 登录历史管理（v4.31.0）
// 数据契约：public/schema/panel-api-types.ts（LoginHistoryEntry / LastLoginInfo 等）
// 表结构：
//   login_history (id, user_id, login_type, login_input, ip_address, user_agent,
//                  device_summary, session_id, failure_reason, retention_days, created_at)
//                  INDEX (user_id, created_at) / (created_at) / (ip_address, created_at)
// 来源：docs/plans/login-history-and-personal-activity-log-plan.md §2.1 / §3.3
//
// 说明：
//   - 记录每次登录尝试（成功 + 失败），补齐登录环节审计断链
//   - 与 audit_logs 解耦：登录日志独立表，含设备/失败维度
//   - 失败但用户存在时落 user_id（便于本人查看异常尝试）；用户不存在时 user_id=NULL
//   - login_input 仅在 fail_not_found 时记录（脱敏），其余不记（隐私）
//   - 依赖通过 req.app.locals.loginHistoryService 注入
// ============================================================================

import { UAParser } from 'ua-parser-js';
import type { Knex } from 'knex';
import type {
  LoginHistoryEntry,
  LoginType,
  LastLoginInfo,
} from '@public/schema/panel-api-types';

// ----- 常量 -----

/** 登录类型 → 可读标签（前端直接展示） */
const LOGIN_TYPE_LABEL: Record<string, string> = {
  success: '成功',
  fail_password: '密码错误',
  fail_disabled: '账号禁用',
  fail_unverified: '邮箱未验证',
  fail_not_found: '用户不存在',
};

/** UA 字符串截断长度 */
const MAX_UA_LENGTH = 512;

/** 默认保留天数 */
const DEFAULT_RETENTION_DAYS = 90;

/** UA 解析器单例（setUA 复用，避免重复实例化） */
const uaParser = new UAParser();

// ----- DB 行类型 -----

interface LoginHistoryRow {
  id: number;
  user_id: string | null;
  login_type: string;
  login_input: string | null;
  ip_address: string | null;
  user_agent: string | null;
  device_summary: string | null;
  session_id: string | null;
  failure_reason: string | null;
  retention_days: number;
  created_at: string;
}

// ----- 输入类型 -----

export interface LoginAttemptInput {
  /** 目标用户 ID。成功=本人；失败但用户存在=目标用户；用户不存在=NULL */
  user_id?: string | null;
  /** 登录结果类型 */
  login_type: LoginType;
  /** 登录输入（仅在 fail_not_found 时记录，需调用方脱敏） */
  login_input?: string | null;
  /** 客户端 IP */
  ip_address?: string | null;
  /** 原始 User-Agent */
  user_agent?: string | null;
  /** JWT jti（若签发） */
  session_id?: string | null;
  /** 失败详情 */
  failure_reason?: string | null;
}

// ----- 服务实现 -----

export class LoginHistoryServiceImpl {
  constructor(private readonly db: Knex) {}

  /**
   * 记录一次登录尝试（成功/失败）
   * - device_summary 由 ua-parser-js 自动解析
   * - user_agent 截断 512 字符
   * - created_at 默认 now() ISO
   */
  async create(req: LoginAttemptInput): Promise<{ id: number }> {
    const deviceSummary = parseDevice(req.user_agent);
    const createdAt = new Date().toISOString();
    const inserted = await this.db<LoginHistoryRow>('login_history')
      .insert({
        user_id: req.user_id ?? null,
        login_type: req.login_type,
        login_input: req.login_input ?? null,
        ip_address: req.ip_address ?? null,
        user_agent: req.user_agent ? req.user_agent.slice(0, MAX_UA_LENGTH) : null,
        device_summary: deviceSummary,
        session_id: req.session_id ?? null,
        failure_reason: req.failure_reason ?? null,
        retention_days: DEFAULT_RETENTION_DAYS,
        created_at: createdAt,
      })
      .returning('id');
    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return { id: row.id };
  }

  /**
   * 查询本人登录历史（分页，created_at DESC）
   * - 返回用户侧视图（不含 login_input 等敏感字段）
   * - 成功+失败均可见，便于用户发现异常尝试
   */
  async listByUser(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{
    items: LoginHistoryEntry[];
    total: number;
    page: number;
    page_size: number;
  }> {
    const offset = (page - 1) * pageSize;
    const base = () => this.db<LoginHistoryRow>('login_history').where('user_id', userId);
    const countRow = await base().count<{ cnt: number | string }>('* as cnt').first();
    const total = Number(countRow?.cnt ?? 0);
    const rows = await base().orderBy('created_at', 'desc').limit(pageSize).offset(offset);
    return {
      items: rows.map(toLoginHistoryEntry),
      total,
      page,
      page_size: pageSize,
    };
  }

  /**
   * 查询本人上次成功登录信息（供 /api/me/last-login 与登录后弹窗用）
   * - 取最近 2 条 success，返回第 2 条（即"上一次"登录）
   * - 不足 2 条（首次登录）返回 null
   */
  async getLastLoginInfo(userId: string): Promise<LastLoginInfo | null> {
    const rows = await this.db<LoginHistoryRow>('login_history')
      .where('user_id', userId)
      .where('login_type', 'success')
      .orderBy('created_at', 'desc')
      .limit(2);
    if (rows.length < 2) return null;
    const prev = rows[1];
    return {
      last_login_at: prev.created_at,
      ip_address: prev.ip_address,
      device_summary: prev.device_summary,
    };
  }

  /**
   * v4.31.0: 清理超过 retention_days 的登录历史
   * retention_days 取 login_history 表中任意一行的值（全表统一），无行时使用默认 90 天
   * 返回删除的行数
   */
  async cleanupOldLogs(): Promise<number> {
    const sample = await this.db<LoginHistoryRow>('login_history')
      .select('retention_days')
      .first();
    const retentionDays = sample?.retention_days ?? DEFAULT_RETENTION_DAYS;
    if (retentionDays <= 0) return 0;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffIso = cutoff.toISOString();

    const deleted = await this.db<LoginHistoryRow>('login_history')
      .where('created_at', '<', cutoffIso)
      .delete();

    return deleted;
  }
}

// ----- 纯函数 / 转换函数 -----

function toLoginHistoryEntry(row: LoginHistoryRow): LoginHistoryEntry {
  return {
    id: row.id,
    user_id: row.user_id,
    login_type: row.login_type as LoginType,
    login_type_label: LOGIN_TYPE_LABEL[row.login_type] ?? row.login_type,
    ip_address: row.ip_address,
    device_summary: row.device_summary,
    created_at: row.created_at,
  };
}

/**
 * 解析 User-Agent 为可读设备摘要
 * 输出格式："{browser} {version} / {os} {osVersion}"
 * 解析失败回退 "Unknown"
 */
function parseDevice(ua: string | null | undefined): string | null {
  if (!ua) return null;
  try {
    uaParser.setUA(ua);
    const browser = uaParser.getBrowser();
    const os = uaParser.getOS();
    const parts: string[] = [];
    if (browser.name) {
      parts.push(browser.name + (browser.version ? ` ${browser.version}` : ''));
    }
    if (os.name) {
      parts.push(os.name + (os.version ? ` ${os.version}` : ''));
    }
    return parts.length > 0 ? parts.join(' / ') : 'Unknown';
  } catch {
    return 'Unknown';
  }
}

// ----- 工厂 -----

export function createLoginHistoryService(db: Knex): LoginHistoryServiceImpl {
  return new LoginHistoryServiceImpl(db);
}
