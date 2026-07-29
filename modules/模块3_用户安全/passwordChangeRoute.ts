// ============================================================================
// passwordChangeRoute.ts — 模块3_用户安全：改密路由工厂
//
// 挂载前缀：/api（由 index.ts 装配时挂载）
//   POST /api/change-password  → updatePassword
//     body: { oldPassword, newPassword }
//     从 req.user.userId 取当前用户（JWT payload，由 authenticateToken 解析附加）
//
// 鉴权：authenticateToken 在 index.ts 挂载时统一套用
//      （用户改自己密码，不需 admin，AGENTS.md 测试要求 §端点经 authenticateToken）
//
// 服务注入：req.app.locals.passwordService（由 index.ts 装配时挂载）
// 错误处理：AppError → 按错误码映射 HTTP 状态码；其余 → 500 PANEL_INTERNAL_ERROR
// ============================================================================

import { Router, type Request, type Response } from 'express';
import { PasswordServiceImpl } from './passwordService.js';
import { AppError } from './errors.js';
import type { PanelErrorResponse } from '@public/schema/panel-api-types';

/**
 * 创建改密路由。
 *
 * 依赖通过 req.app.locals.passwordService 注入。
 * 鉴权（authenticateToken）由 index.ts 挂载时套用。
 */
export function createPasswordChangeRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // POST /change-password — 修改当前用户密码
  //   body: { oldPassword: string, newPassword: string }
  //   成功：200 { tokenVersion: number }
  //   401: 旧密码错误（INVALID_CREDENTIAL）/ 未认证
  //   400: 密码强度不足（AUTH_PWD_002）/ 参数缺失
  //   409: 密码历史重用（AUTH_PWD_003）
  // ----------------------------------------------------------------
  router.post('/change-password', async (req, res) => {
    // 参数校验
    const body = req.body as { oldPassword?: unknown; newPassword?: unknown };
    if (
      typeof body.oldPassword !== 'string' ||
      typeof body.newPassword !== 'string' ||
      body.oldPassword.length === 0 ||
      body.newPassword.length === 0
    ) {
      const errorBody: PanelErrorResponse = {
        error: {
          code: 'PANEL_VALIDATION_ERROR',
          message: '缺少 oldPassword 或 newPassword',
        },
      };
      res.status(400).json(errorBody);
      return;
    }

    // 从 JWT payload 取 userId（authenticateToken 已附加 req.user）
    const userId = req.user?.userId;
    if (!userId) {
      const errorBody: PanelErrorResponse = {
        error: {
          code: 'PANEL_UNAUTHORIZED',
          message: '未认证',
        },
      };
      res.status(401).json(errorBody);
      return;
    }

    try {
      const service = getService(req);
      const result = await service.updatePassword(
        userId,
        body.oldPassword,
        body.newPassword,
      );
      res.json(result);
    } catch (err) {
      handlePasswordError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

/**
 * 从 req.app.locals.passwordService 取服务实例。
 * 服务未初始化时抛错（由外层 catch 转为 500）。
 */
function getService(req: Request): PasswordServiceImpl {
  const service = req.app.locals.passwordService as PasswordServiceImpl | undefined;
  if (!service) {
    throw new Error('passwordService 未初始化');
  }
  return service;
}

/**
 * 错误码 → HTTP 状态码映射（与 error-codes-schema.json 对齐）。
 * 模块3 所有错误类均显式声明 httpStatus，优先使用。
 */
const ERROR_CODE_TO_STATUS: Record<string, number> = {
  INVALID_CREDENTIAL: 401,
  AUTH_PWD_002: 400,
  AUTH_PWD_003: 409,
  BUILT_IN_ACCOUNT_PASSWORD_READONLY: 403, // v4.0.2
};

/**
 * 错误处理：AppError 按错误码映射状态码；其余视为内部错误 500。
 * 与模块0 systemUpdateRoute 的 handleSystemUpdateError 模式一致。
 */
function handlePasswordError(res: Response, err: unknown): void {
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
