// ============================================================================
// apiKeys.ts — API Key 管理路由（v4.4.0-J1）
//
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken + requireAdmin）
// 对应服务：req.app.locals.db（Knex）→ ApiKeyService 实例化
//
// 挂载前缀：/api/api-keys
//   GET    /                     — 列出所有 API Key（不含明文与 hash）
//   POST   /                     — 创建 API Key（返回明文仅一次）
//   GET    /:id                  — 查询单个 API Key 详情
//   DELETE /:id                  — 撤销 API Key（软删除）
//
// v4.30.1 简化：移除「关联角色」可选项——所有 API Key 一律冻结为 instance_admin
//   - 用户洞察：当你需要 API Key 时，你一定是想当服主的（CI/CD 自动化场景）
//   - 与 v4.28.0 全员服主语义对齐（每个账号天然拥有 user + instance_admin 双角色）
//   - 防提权机制仍保留：硬编码 INSTANCE_ADMIN，永不可能是 server_admin
//   - body.role 字段被服务端忽略（向后兼容旧客户端）
// ============================================================================

import { Router, type Response } from 'express';
import type { Knex } from 'knex';
import { ApiKeyService, type ApiKeyInfo as ApiKeyInfoSvc } from '../../services/apiKeyService.js';
import { AppError, ValidationError } from '../../services/errors.js';
import { Role, normalizeRole, toContractUserRole } from '../../core/auth/roles.js';
import type { UserRole } from '@public/schema/panel-api-types';
import type {
  ApiKeyInfo,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  GetApiKeyResponse,
  ListApiKeysResponse,
  PanelErrorResponse,
  RevokeApiKeyResponse,
} from '@public/schema/panel-api-types';

// ---------------------------------------------------------------------------
// 服务层 ApiKeyInfo → 契约 ApiKeyInfo 转换
// ---------------------------------------------------------------------------

function toContractApiKeyInfo(svc: ApiKeyInfoSvc): ApiKeyInfo {
  return {
    id: svc.id,
    name: svc.name,
    key_prefix: svc.key_prefix,
    user_id: svc.user_id,
    // role 在服务层为 string（DB 层），这里映射为契约 UserRole
    role: toContractUserRole(normalizeRole(svc.role)) as UserRole,
    created_at: svc.created_at,
    expires_at: svc.expires_at,
    last_used_at: svc.last_used_at,
    last_used_ip: svc.last_used_ip,
    revoked_at: svc.revoked_at,
  };
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

export function createApiKeysRouter(): Router {
  const router = Router();

  // ===== GET / — 列出所有 API Key =====
  router.get('/', async (req, res) => {
    try {
      const db = req.app.locals.db as Knex | undefined;
      if (!db) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_INTERNAL_ERROR', message: '数据库未初始化' },
        };
        res.status(500).json(body);
        return;
      }
      const apiKeyService = new ApiKeyService(db);
      const keys = await apiKeyService.listApiKeys();
      const response: ListApiKeysResponse = {
        api_keys: keys.map(toContractApiKeyInfo),
      };
      res.json(response);
    } catch (err) {
      handleError(res, err);
    }
  });

  // ===== POST / — 创建 API Key =====
  router.post('/', async (req, res) => {
    try {
      const db = req.app.locals.db as Knex | undefined;
      if (!db) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_INTERNAL_ERROR', message: '数据库未初始化' },
        };
        res.status(500).json(body);
        return;
      }

      // 当前登录用户（已通过 authenticateToken 附加到 req.user）
      const currentUser = req.user;
      if (!currentUser) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const body = req.body as Partial<CreateApiKeyRequest>;
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        throw new ValidationError('name 必填');
      }
      if (body.name.length > 100) {
        throw new ValidationError('name 长度不能超过 100');
      }

      // v4.30.1：硬编码 role = INSTANCE_ADMIN，body.role 被忽略（向后兼容旧客户端）
      // - 用户洞察：API Key 用于 CI/CD 自动化管理实例，天然是 instance_admin 诉求
      // - 与 v4.28.0 全员服主语义对齐（每个账号天然拥有 user + instance_admin 双角色）
      // - 防提权：硬编码值永不可能是 server_admin，原 server_admin 创建带 role Key 的
      //   硬阻断（APIKEY_ROLE_FORBIDDEN）与 body.role === SERVER_ADMIN 校验已无意义，移除
      const role: Role = Role.INSTANCE_ADMIN;

      // 解析 user_id：默认当前登录用户；server_admin 可指定其他 active 用户
      // 非 server_admin 强制使用当前用户 ID（防止跨用户创建）
      let targetUserId = currentUser.userId;
      if (body.user_id !== undefined && body.user_id !== currentUser.userId) {
        if (normalizeRole(currentUser.role) !== Role.SERVER_ADMIN) {
          throw new ValidationError('仅 server_admin 可为其他用户创建 API Key');
        }
        targetUserId = body.user_id;
      }

      // 解析 expires_at：可选
      let expiresAt: string | null | undefined = undefined;
      if (body.expires_at !== undefined) {
        if (body.expires_at === null) {
          expiresAt = null;
        } else {
          const expDate = new Date(body.expires_at);
          if (isNaN(expDate.getTime())) {
            throw new ValidationError('expires_at 必须为有效的 ISO 8601 时间');
          }
          if (expDate.getTime() <= Date.now()) {
            throw new ValidationError('expires_at 必须为未来时间');
          }
          expiresAt = body.expires_at;
        }
      }

      const apiKeyService = new ApiKeyService(db);
      const result = await apiKeyService.createApiKey(
        targetUserId,
        role,
        body.name.trim(),
        expiresAt ?? null,
      );

      const response: CreateApiKeyResponse = {
        api_key: result.plaintext,
        info: toContractApiKeyInfo(result.info),
      };
      // 201 Created —— 明文 key 仅此一次返回
      res.status(201).json(response);
    } catch (err) {
      handleError(res, err);
    }
  });

  // ===== GET /:id — 查询单个 API Key 详情 =====
  router.get('/:id', async (req, res) => {
    try {
      const db = req.app.locals.db as Knex | undefined;
      if (!db) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_INTERNAL_ERROR', message: '数据库未初始化' },
        };
        res.status(500).json(body);
        return;
      }
      const apiKeyService = new ApiKeyService(db);
      const info = await apiKeyService.getApiKey(req.params.id);
      const response: GetApiKeyResponse = {
        api_key: toContractApiKeyInfo(info),
      };
      res.json(response);
    } catch (err) {
      handleError(res, err);
    }
  });

  // ===== DELETE /:id — 撤销 API Key =====
  router.delete('/:id', async (req, res) => {
    try {
      const db = req.app.locals.db as Knex | undefined;
      if (!db) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_INTERNAL_ERROR', message: '数据库未初始化' },
        };
        res.status(500).json(body);
        return;
      }
      const apiKeyService = new ApiKeyService(db);
      const info = await apiKeyService.revokeApiKey(req.params.id);
      const response: RevokeApiKeyResponse = {
        id: info.id,
        revoked: info.revoked_at !== null,
        revoked_at: info.revoked_at ?? new Date().toISOString(),
      };
      res.json(response);
    } catch (err) {
      handleError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  PANEL_VALIDATION_ERROR: 400,
  API_KEY_NOT_FOUND: 404,
  API_KEY_REVOKED: 409,
  PANEL_UNAUTHORIZED: 401,
};

function handleError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    const status = err.httpStatus ?? ERROR_CODE_TO_STATUS[err.code] ?? 400;
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
