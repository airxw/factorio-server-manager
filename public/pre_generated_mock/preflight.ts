// ============================================================================
// preflight.ts — 首启动向导预检 Mock（预生成稳定 Mock，v4.33.0 补全）
//
// 用途：Setup Wizard 并行开发/前端联调时，在真实 initPreflightService 就位前，
//       通过 tsconfig paths alias 切换到本 Mock 获得稳定的预检响应。
//       对应后端 panel/backend/src/services/initPreflightService.ts（8 项检查）。
//
// 覆盖场景：
//   1. 全部通过（all_ok=true，needs_init=true）——默认
//   2. 含 warn 项（daemon 未连接等非阻断）
//   3. 含 error 项（all_ok=false，阻断向导下一步）
//   4. 已初始化部署（needs_init=false）
//   5. 密码策略（PasswordPolicyResponse）
//
// 切换路径（rules-3 §四 可覆盖）：通过 tsconfig paths alias 切换，
//   调用方零改动。开发者可在 global_mock/ 下覆盖本 Mock 适配特殊测试场景。
// ============================================================================

import type {
  InitPreflightCheck,
  InitPreflightResponse,
  PasswordPolicyResponse,
} from '../schema/panel-api-types';

/** 8 项检查的稳定基线（全部 ok） */
const BASE_CHECKS: InitPreflightCheck[] = [
  { key: 'database', label: '数据库连接', status: 'ok', detail: 'SQLite at /opt/gameserver-panel/panel/backend/data/panel.db', actionable: true },
  { key: 'migrations', label: '数据库迁移', status: 'ok', detail: 'All migrations applied (baseline v4)', actionable: false },
  { key: 'daemon', label: 'Daemon 节点', status: 'ok', detail: '1 node online (local)', actionable: true },
  { key: 'packs', label: '游戏 Pack', status: 'ok', detail: '9 packs loaded', actionable: false },
  { key: 'db_config', label: '数据库配置', status: 'ok', detail: 'Using built-in SQLite', actionable: true },
  { key: 'mode', label: '运行模式', status: 'ok', detail: 'production', actionable: true },
  { key: 'disk', label: '磁盘空间', status: 'ok', detail: '42% used (23G free)', actionable: false },
  { key: 'public_url', label: '公网入口', status: 'ok', detail: 'https://panel.example.com:3001', actionable: true },
];

function buildResponse(checks: InitPreflightCheck[], needsInit: boolean): InitPreflightResponse {
  return {
    needs_init: needsInit,
    all_ok: checks.every((c) => c.status !== 'error'),
    checks,
  };
}

/** 场景 1：全部通过（默认） */
export function mockPreflightAllOk(): InitPreflightResponse {
  return buildResponse(BASE_CHECKS, true);
}

/** 场景 2：含 warn 项（daemon 未连接，非阻断） */
export function mockPreflightWithWarnings(): InitPreflightResponse {
  const checks = BASE_CHECKS.map((c) =>
    c.key === 'daemon'
      ? { ...c, status: 'warn' as const, detail: 'No daemon node connected yet', actionable: true }
      : c,
  );
  return buildResponse(checks, true);
}

/** 场景 3：含 error 项（all_ok=false，阻断向导） */
export function mockPreflightWithErrors(): InitPreflightResponse {
  const checks = BASE_CHECKS.map((c) =>
    c.key === 'database'
      ? { ...c, status: 'error' as const, detail: 'Cannot open SQLite file: EACCES permission denied', actionable: false }
      : c,
  );
  return buildResponse(checks, true);
}

/** 场景 4：已初始化部署（needs_init=false） */
export function mockPreflightAlreadyInitialized(): InitPreflightResponse {
  return buildResponse(BASE_CHECKS, false);
}

/** 场景 5：密码策略（与后端 passwordPolicy.ts 默认值对齐） */
export function mockPasswordPolicy(): PasswordPolicyResponse {
  return {
    min_length: 8,
    max_length: 128,
    min_zxcvbn_score: 2,
    require_letter: true,
    require_digit: true,
    forbidden_passwords: ['admin123', '12345678', 'password', 'qwerty123'],
  };
}

/** 默认导出：与 GET /api/init/preflight 对齐的稳定响应 */
export const DEFAULT_PREFLIGHT_RESPONSE: InitPreflightResponse = mockPreflightAllOk();
