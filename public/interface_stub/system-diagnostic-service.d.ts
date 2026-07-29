/**
 * system-diagnostic-service.d.ts — systemDiagnosticService 接口存根
 *
 * 职责：一键诊断系统问题 + 白名单脚本修复
 * 来源：s0103 融合定稿 v3.4.0 §互斥点② B 静态规则 + §互斥点③ B 白名单脚本
 *
 * @version 1.0.0
 */

import type {
  DiagnosticsResult,
  ApplyFixResponse,
} from './shared-types';
import { SystemFixInvalidError } from './shared-types';

export interface SystemDiagnosticService {
  /**
   * 运行一键诊断。按 DIAGNOSTIC_RULES_PATH（默认 ./config/diagnostic-rules.json）
   * 定义的静态规则逐项检查，返回问题清单 + 汇总。
   *
   * 诊断规则示例（静态 JSON 配置）：
   * {
   *   "rules": [
   *     { "id": "disk_full", "check": "disk_usage", "threshold": 90, "fixId": "clean_logs", "severity": "warning" },
   *     { "id": "db_pending_migrations", "check": "knex_pending", "fixId": "run_migrations", "severity": "critical" },
   *     { "id": "daemon_unreachable", "check": "http_health", "url": "${DAEMON_URL}/api/health", "fixId": null, "severity": "critical" }
   *   ]
   * }
   *
   * @returns DiagnosticsResult 含 problems 数组（每个问题含 fixId 或 null 表示无自动修复）
   */
  runDiagnostics(): Promise<DiagnosticsResult>;

  /**
   * 应用指定修复脚本。fixId 必须在 DIAGNOSTIC_FIXES_PATH（默认 ./config/diagnostic-fixes.json）
   * 定义的白名单中，否则抛 SystemFixInvalidError。
   *
   * 修复脚本示例（白名单 JSON）：
   * {
   *   "fixes": [
   *     { "id": "clean_logs", "script": "./scripts/clean-old-logs.sh", "timeout_ms": 30000, "description": "清理 30 天前的日志" },
   *     { "id": "run_migrations", "script": "./scripts/run-migrations.sh", "timeout_ms": 60000, "description": "执行 pending migrations" }
   *   ]
   * }
   *
   * 安全约束：
   * - 仅执行白名单内脚本，禁止任意命令执行
   * - 脚本路径必须在 ./scripts/ 目录下（path.resolve 校验，防路径穿越）
   * - 执行用户为 panel-backend 进程用户，不提权
   * - 超时强制 kill
   *
   * @throws {SystemFixInvalidError} fixId 不在白名单或脚本路径越界
   */
  applyFix(fixId: string): Promise<ApplyFixResponse>;
}
