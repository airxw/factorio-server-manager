// ============================================================================
// systemDiagnosticRoute.ts — 模块2_系统诊断：诊断/修复路由工厂
//
// 挂载前缀：/api/system（由 index.ts 装配时挂载，与 模块1 systemMetricsRouter
//           共用 /api/system 前缀；metrics/health 普通用户，diagnostics 仅 admin）
//   POST /api/system/diagnostics            → runDiagnostics（admin）
//   POST /api/system/diagnostics/fix/:fixId → applyFix（admin）
//
// 鉴权：authenticateToken 在 index.ts 挂载时统一套用
//      requireAdmin 放在路由内部（与 metrics/health 的普通用户权限分流）
//      与 模块0 systemUpdateRoute.ts 既有模式一致——
//      router 工厂无参，不内置鉴权中间件（secret 由 index.ts 持有）。
//
// 服务注入：req.app.locals.systemDiagnosticService（由 index.ts 装配时挂载）
// 错误处理：AppError → 按错误码映射 HTTP 状态码；其余 → 500 PANEL_INTERNAL_ERROR
// ============================================================================

import { Router, type Request, type Response } from 'express';
import { requireAdmin } from '../../panel/backend/src/middleware/auth.js';
import {
  AppError,
  SystemDiagnosticServiceImpl,
  type DiagnosticCheck,
} from './systemDiagnosticService.js';
import type { PanelErrorResponse } from '@public/schema/panel-api-types';

/**
 * 创建 SystemDiagnostic 路由。
 *
 * 鉴权策略：authenticateToken 在 index.ts 挂载时套用（普通用户登录态），
 *          requireAdmin 在路由内部对 diagnostics/fix 子路径生效。
 *          这是因为 /api/system 同时承载 metrics（普通用户）和 diagnostics（仅 admin）。
 *
 * 依赖通过 req.app.locals.systemDiagnosticService 注入。
 */
export function createSystemDiagnosticRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // POST /diagnostics — 运行一键诊断（problems / summary / timestamp / duration）
  // 鉴权：仅 server_admin（与 metrics/health 同一前缀，需在路由层单独加 requireAdmin）
  // ----------------------------------------------------------------
  router.post('/diagnostics', requireAdmin, async (req, res) => {
    try {
      const service = getService(req);
      const result = await service.runDiagnostics();
      res.json(result);
    } catch (err) {
      handleDiagnosticError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /diagnostics/stream — 流式一键诊断（SSE，逐条即时返回）
  // 每条规则完成后立即推送，前端无需等待全部完成即可看到反馈。
  // SSE 格式：data: <JSON>\n\n
  //   - type: "check" — 单条检查结果
  //   - type: "done" — 诊断完成（含 total/pass/warning/error 汇总）
  // 鉴权：仅 server_admin
  // ----------------------------------------------------------------
  router.post('/diagnostics/stream', requireAdmin, async (req, res) => {
    const service = getService(req);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // 禁用 nginx 缓冲
    });

    const checks: { check: DiagnosticCheck; status: string }[] = [];
    let env: 'production' | 'development' | null = null;

    const send = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await service.runDiagnosticsStream((check, meta) => {
        if (meta) {
          env = meta.environment;
        }
        checks.push({ check: check as DiagnosticCheck, status: check.status });
        send({
          type: 'check',
          check,
          ruleIndex: meta?.ruleIndex ?? 0,
          totalRules: meta?.totalRules ?? 1,
          environment: meta?.environment ?? env,
        });
      });

      // 汇总统计
      const total = checks.length;
      const pass = checks.filter((c) => c.status === 'pass').length;
      const warning = checks.filter((c) => c.status === 'warning').length;
      const error = checks.filter((c) => c.status === 'error').length;
      const problems = checks
        .filter((c) => c.status !== 'pass')
        .map((c) => ({
          id: c.check.id,
          severity: c.check.severity,
          message: c.check.message,
          fixId: c.check.fixId,
        }));

      send({
        type: 'done',
        problems,
        checks: checks.map((c) => c.check),
        summary: total === 0 ? '无诊断规则' : `诊断完成：发现 ${warning + error} 个问题（警告=${warning}, 错误=${error}，共 ${total} 项）`,
        total,
        pass,
        warning,
        error,
        timestamp: new Date().toISOString(),
        environment: result.environment,
      });
    } catch (err) {
      send({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      res.end();
    }
  });

  // ----------------------------------------------------------------
  // POST /diagnostics/fix/:fixId — 应用白名单修复脚本
  // 鉴权：仅 server_admin
  // ----------------------------------------------------------------
  router.post('/diagnostics/fix/:fixId', requireAdmin, async (req, res) => {
    try {
      const service = getService(req);
      const fixId = req.params.fixId;
      if (!fixId) {
        const body: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: '缺少 fixId 路径参数',
          },
        };
        res.status(400).json(body);
        return;
      }
      const result = await service.applyFix(fixId);
      res.json(result);
    } catch (err) {
      handleDiagnosticError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

/**
 * 从 req.app.locals.systemDiagnosticService 取服务实例。
 * 服务未初始化时抛错（由外层 catch 转为 500）。
 */
function getService(req: Request): SystemDiagnosticServiceImpl {
  const service = req.app.locals.systemDiagnosticService as
    | SystemDiagnosticServiceImpl
    | undefined;
  if (!service) {
    throw new Error('systemDiagnosticService 未初始化');
  }
  return service;
}

/** 错误码 → HTTP 状态码映射（与 error-codes-schema.json 对齐） */
const ERROR_CODE_TO_STATUS: Record<string, number> = {
  SYSTEM_FIX_001: 404,
};

/**
 * 错误处理：AppError 按错误码映射状态码；其余视为内部错误 500。
 * 与模块0 systemUpdateRoute.ts 的 handleSystemUpdateError 模式一致。
 */
function handleDiagnosticError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    const status = ERROR_CODE_TO_STATUS[err.code] ?? err.httpStatus ?? 500;
    const body: PanelErrorResponse = {
      error: {
        code: err.code as PanelErrorResponse['error']['code'],
        message: err.message,
      },
    };
    res.status(status).json(body);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
