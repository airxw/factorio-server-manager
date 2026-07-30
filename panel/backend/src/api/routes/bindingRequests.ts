// ============================================================================
// bindingRequests.ts — 绑定申请审批路由（v4.38.0）
//
// 数据流：
//   用户对私有实例发绑定申请 → 服主审批通过 → 自动创建账户级 binding（vip_level=0）
//   公开实例不走此流程（直接调 POST /api/instances/:id/bindings 即可）
//   v4.38.0 强制游戏角色绑定：VIP 由后续 !verify 验证路径赋予（vip_level=1）
//
// 端点（挂载 /api，套 authenticateToken）：
//   POST   /servers/:serverId/binding-requests       用户申请绑定私有实例
//   GET    /servers/:serverId/binding-requests       服主查看该实例的申请列表
//   POST   /binding-requests/:id/approve             服主审批通过（自动创建 binding）
//   POST   /binding-requests/:id/reject              服主审批拒绝
//   DELETE /binding-requests/:id                     申请人撤销自己的 pending 申请
//   GET    /my/binding-requests                      用户查看自己提交的全部申请
//
// 权限：
//   - 用户申请 / 查自己 / 撤销：JWT 即可（任意登录用户）
//   - 服主查列表 / 审批：requireInstanceAdmin（owner 或 instance_admin 或 server_admin）
//
// 依据：docs/plans/guild-servers-market-rework-plan.md §3.4
// ============================================================================

import { Router, type Response, type RequestHandler } from 'express';
import crypto from 'node:crypto';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { requireInstanceAdmin } from '../../middleware/auth.js';
import { bindInstance } from '../../services/instanceBindingService.js';
import { BindingAlreadyExistsError, BindingNotFoundError } from '../../services/errors.js';
import type {
  ApproveBindingApplicationRequest,
  ApproveBindingApplicationResponse,
  BindingApplication,
  BindingApplicationStatus,
  BindingApplicationWithNames,
  CreateBindingApplicationRequest,
  CreateBindingApplicationResponse,
  ListBindingApplicationsResponse,
  ListMyBindingApplicationsResponse,
  PanelErrorResponse,
  RejectBindingApplicationRequest,
  RejectBindingApplicationResponse,
} from '@public/schema/panel-api-types';

// ---------------------------------------------------------------------------
// DB 行类型
// ---------------------------------------------------------------------------

interface BindingRequestDbRow {
  id: string;
  server_id: string;
  requester_user_id: string;
  status: string;
  message: string | null;
  reviewer_user_id: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** JOIN users + servers 后的扩展行（列表展示用） */
interface BindingRequestDbRowWithNames extends BindingRequestDbRow {
  requester_username: string;
  reviewer_username: string | null;
  server_name: string;
  server_game_type: string;
}

interface ServerSettingsRow {
  id: string;
  owner_user_id: string;
  is_public: number;
  binding_requests_enabled: number;
  auto_approve_binding_requests: number;
  status: string;
  name: string;
  game_type: string;
}

// ---------------------------------------------------------------------------
// 路由工厂
// ---------------------------------------------------------------------------

export function createBindingRequestsRouter(db: Knex, logger: Logger): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // POST /servers/:serverId/binding-requests — 用户申请绑定私有实例
  // ----------------------------------------------------------------
  router.post('/servers/:serverId/binding-requests', (async (req, res) => {
    try {
      const requesterId = req.user?.userId;
      if (!requesterId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const serverId = req.params.serverId;
      const body = (req.body ?? {}) as Partial<CreateBindingApplicationRequest>;
      const message = typeof body.message === 'string' ? body.message.trim().slice(0, 500) : null;

      // 1) 校验实例存在 + 获取可见性/申请通道设置
      const server = await db<ServerSettingsRow>('servers')
        .select(
          'id',
          'owner_user_id',
          'is_public',
          'binding_requests_enabled',
          'auto_approve_binding_requests',
          'status',
          'name',
          'game_type',
        )
        .where({ id: serverId })
        .first();

      if (!server) {
        const body404: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${serverId}` },
        };
        res.status(404).json(body404);
        return;
      }

      // 2) owner 无需申请
      if (server.owner_user_id === requesterId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'BINDING_REQUEST_OWNER_NOT_NEEDED', message: '实例 owner 无需申请绑定' },
        };
        res.status(400).json(errBody);
        return;
      }

      // 3) 公开实例应直接绑定，不走申请
      if (server.is_public === 1) {
        const errBody: PanelErrorResponse = {
          error: { code: 'BINDING_REQUEST_PUBLIC_INSTANCE', message: '公开实例可直接绑定，无需申请' },
        };
        res.status(400).json(errBody);
        return;
      }

      // 4) 服主已关闭申请通道
      if (server.binding_requests_enabled !== 1) {
        const errBody: PanelErrorResponse = {
          error: { code: 'BINDING_REQUEST_DISABLED', message: '该实例未开放绑定申请通道' },
        };
        res.status(403).json(errBody);
        return;
      }

      // 5) 已绑定则无需再申请
      const existingBinding = await db<{ id: number }>('bindings')
        .select('id')
        .where('user_id', requesterId)
        .where('binding_type', 'account')
        .where('scope_type', 'instance')
        .where('scope_ref', serverId)
        .where('verify_status', 'verified')
        .first();
      if (existingBinding) {
        const errBody: PanelErrorResponse = {
          error: { code: 'BINDING_REQUEST_ALREADY_BOUND', message: '已绑定该实例，无需重复申请' },
        };
        res.status(409).json(errBody);
        return;
      }

      // 6) 创建申请（部分唯一索引兜底：同一用户对同一实例只能有一个 pending）
      //    v4.38.1: 若 auto_approve_binding_requests=1，直接以 approved 状态创建 + 自动绑定
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const autoApprove = server.auto_approve_binding_requests === 1;
      try {
        await db('binding_requests').insert({
          id,
          server_id: serverId,
          requester_user_id: requesterId,
          status: autoApprove ? 'approved' : 'pending',
          message,
          reviewer_user_id: autoApprove ? requesterId : null,
          review_note: autoApprove ? 'auto-approved by system' : null,
          reviewed_at: autoApprove ? now : null,
          created_at: now,
          updated_at: now,
        });
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          const errBody: PanelErrorResponse = {
            error: { code: 'BINDING_REQUEST_ALREADY_PENDING', message: '已存在待审批的申请，请等待服主审批或撤销后重试' },
          };
          res.status(409).json(errBody);
          return;
        }
        throw err;
      }

      // 7) 自动审批：创建绑定（复用 bindInstance 复活逻辑）
      //    失败时回滚申请记录，返回错误
      if (autoApprove) {
        try {
          // bindInstance 内部自带事务 + 复活 revoked 记录逻辑
          // v4.38.0 强制游戏角色绑定：审批通过仅创建账户级绑定（vip_level=0），
          // VIP 由后续 !verify 游戏角色验证路径赋予（verifyBindingByCode → vip_level=1）
          await bindInstance(requesterId, serverId);
        } catch (err) {
          // 自动审批失败：回滚申请记录（避免半成品数据阻塞用户重新申请）
          await db('binding_requests').where({ id }).del();
          if (err instanceof BindingAlreadyExistsError) {
            const errBody: PanelErrorResponse = {
              error: { code: 'BINDING_REQUEST_ALREADY_BOUND', message: '申请人已绑定该实例' },
            };
            res.status(409).json(errBody);
            return;
          }
          if (err instanceof BindingNotFoundError) {
            const errBody: PanelErrorResponse = {
              error: { code: 'SERVER_NOT_FOUND', message: '实例不存在' },
            };
            res.status(404).json(errBody);
            return;
          }
          throw err;
        }
      }

      const application = await getBindingApplicationById(db, id);
      const response: CreateBindingApplicationResponse = { application: application! };
      res.status(201).json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  }) as RequestHandler);

  // ----------------------------------------------------------------
  // GET /servers/:serverId/binding-requests — 服主查看该实例的申请列表
  // ----------------------------------------------------------------
  router.get('/servers/:serverId/binding-requests', requireInstanceAdmin('serverId'), (async (req, res) => {
    try {
      const serverId = req.params.serverId;
      const statusFilter = parseStatusFilter(req.query.status);

      let query = db<BindingRequestDbRowWithNames>('binding_requests as br')
        .select(
          'br.id',
          'br.server_id',
          'br.requester_user_id',
          'br.status',
          'br.message',
          'br.reviewer_user_id',
          'br.review_note',
          'br.reviewed_at',
          'br.created_at',
          'br.updated_at',
          'u.username as requester_username',
          'ru.username as reviewer_username',
          's.name as server_name',
          's.game_type as server_game_type',
        )
        .leftJoin('users as u', 'br.requester_user_id', 'u.id')
        .leftJoin('users as ru', 'br.reviewer_user_id', 'ru.id')
        .leftJoin('servers as s', 'br.server_id', 's.id')
        .where('br.server_id', serverId)
        .orderBy('br.created_at', 'desc');

      if (statusFilter) {
        query = query.where('br.status', statusFilter);
      }

      const rows = await query;
      const applications = rows.map(toApplicationWithNames);
      const response: ListBindingApplicationsResponse = { applications };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  }) as RequestHandler);

  // ----------------------------------------------------------------
  // POST /binding-requests/:id/approve — 服主审批通过
  // ----------------------------------------------------------------
  router.post('/binding-requests/:id/approve', (async (req, res) => {
    try {
      const reviewerId = req.user?.userId;
      if (!reviewerId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const requestId = req.params.id;
      const body = (req.body ?? {}) as Partial<ApproveBindingApplicationRequest>;
      const reviewNote = typeof body.review_note === 'string' ? body.review_note.trim().slice(0, 500) : null;

      // 1) 查申请
      const application = await db<BindingRequestDbRow>('binding_requests')
        .where({ id: requestId })
        .first();
      if (!application) {
        const errBody: PanelErrorResponse = {
          error: { code: 'BINDING_REQUEST_NOT_FOUND', message: `申请不存在: ${requestId}` },
        };
        res.status(404).json(errBody);
        return;
      }

      // 2) 校验状态
      if (application.status !== 'pending') {
        const errBody: PanelErrorResponse = {
          error: { code: 'BINDING_REQUEST_NOT_PENDING', message: `申请状态为 ${application.status}，无法审批` },
        };
        res.status(400).json(errBody);
        return;
      }

      // 3) 校验审批人权限（owner 或 instance_admin 或 server_admin）
      const isManager = await isInstanceManager(db, application.server_id, reviewerId);
      if (!isManager) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_FORBIDDEN', message: '无权审批该实例的绑定申请' },
        };
        res.status(403).json(errBody);
        return;
      }

      // 4) 事务：更新申请状态 + 创建 binding（复用 bindInstance 的复活逻辑）
      const now = new Date().toISOString();
      try {
        await db.transaction(async (trx) => {
          await trx<BindingRequestDbRow>('binding_requests').where({ id: requestId }).update({
            status: 'approved',
            reviewer_user_id: reviewerId,
            review_note: reviewNote,
            reviewed_at: now,
            updated_at: now,
          });
        });
        // bindInstance 内部自带事务 + 复活 revoked 记录逻辑
        // v4.38.0 强制游戏角色绑定：审批通过仅创建账户级绑定（vip_level=0），
        // VIP 由后续 !verify 游戏角色验证路径赋予（verifyBindingByCode → vip_level=1）
        await bindInstance(application.requester_user_id, application.server_id);
      } catch (err) {
        // bindInstance 可能抛 BindingAlreadyExistsError（并发场景下用户已通过其他渠道绑定）
        if (err instanceof BindingAlreadyExistsError) {
          const errBody: PanelErrorResponse = {
            error: { code: 'BINDING_REQUEST_ALREADY_BOUND', message: '申请人已绑定该实例' },
          };
          res.status(409).json(errBody);
          return;
        }
        // BindingNotFoundError（实例被删除）
        if (err instanceof BindingNotFoundError) {
          const errBody: PanelErrorResponse = {
            error: { code: 'SERVER_NOT_FOUND', message: '实例不存在' },
          };
          res.status(404).json(errBody);
          return;
        }
        throw err;
      }

      const updated = await getBindingApplicationById(db, requestId);
      const response: ApproveBindingApplicationResponse = { application: updated! };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  }) as RequestHandler);

  // ----------------------------------------------------------------
  // POST /binding-requests/:id/reject — 服主审批拒绝
  // ----------------------------------------------------------------
  router.post('/binding-requests/:id/reject', (async (req, res) => {
    try {
      const reviewerId = req.user?.userId;
      if (!reviewerId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const requestId = req.params.id;
      const body = (req.body ?? {}) as Partial<RejectBindingApplicationRequest>;
      const reviewNote = typeof body.review_note === 'string' ? body.review_note.trim().slice(0, 500) : null;

      // 1) 查申请
      const application = await db<BindingRequestDbRow>('binding_requests')
        .where({ id: requestId })
        .first();
      if (!application) {
        const errBody: PanelErrorResponse = {
          error: { code: 'BINDING_REQUEST_NOT_FOUND', message: `申请不存在: ${requestId}` },
        };
        res.status(404).json(errBody);
        return;
      }

      // 2) 校验状态
      if (application.status !== 'pending') {
        const errBody: PanelErrorResponse = {
          error: { code: 'BINDING_REQUEST_NOT_PENDING', message: `申请状态为 ${application.status}，无法审批` },
        };
        res.status(400).json(errBody);
        return;
      }

      // 3) 校验审批人权限
      const isManager = await isInstanceManager(db, application.server_id, reviewerId);
      if (!isManager) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_FORBIDDEN', message: '无权审批该实例的绑定申请' },
        };
        res.status(403).json(errBody);
        return;
      }

      // 4) 更新申请状态（拒绝不创建 binding）
      const now = new Date().toISOString();
      await db<BindingRequestDbRow>('binding_requests').where({ id: requestId }).update({
        status: 'rejected',
        reviewer_user_id: reviewerId,
        review_note: reviewNote,
        reviewed_at: now,
        updated_at: now,
      });

      const updated = await getBindingApplicationById(db, requestId);
      const response: RejectBindingApplicationResponse = { application: updated! };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  }) as RequestHandler);

  // ----------------------------------------------------------------
  // DELETE /binding-requests/:id — 申请人撤销自己的 pending 申请
  // ----------------------------------------------------------------
  router.delete('/binding-requests/:id', (async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const requestId = req.params.id;
      const application = await db<BindingRequestDbRow>('binding_requests')
        .where({ id: requestId })
        .first();
      if (!application) {
        const errBody: PanelErrorResponse = {
          error: { code: 'BINDING_REQUEST_NOT_FOUND', message: `申请不存在: ${requestId}` },
        };
        res.status(404).json(errBody);
        return;
      }

      // 仅申请人本人可撤销
      if (application.requester_user_id !== userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_FORBIDDEN', message: '只能撤销自己的申请' },
        };
        res.status(403).json(errBody);
        return;
      }

      // 仅 pending 状态可撤销
      if (application.status !== 'pending') {
        const errBody: PanelErrorResponse = {
          error: { code: 'BINDING_REQUEST_NOT_PENDING', message: `申请状态为 ${application.status}，无法撤销` },
        };
        res.status(400).json(errBody);
        return;
      }

      const now = new Date().toISOString();
      await db<BindingRequestDbRow>('binding_requests').where({ id: requestId }).update({
        status: 'cancelled',
        updated_at: now,
      });

      res.status(204).send();
    } catch (err) {
      handleError(res, err, logger);
    }
  }) as RequestHandler);

  // ----------------------------------------------------------------
  // GET /my/binding-requests — 用户查看自己提交的全部申请
  // ----------------------------------------------------------------
  router.get('/my/binding-requests', (async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const statusFilter = parseStatusFilter(req.query.status);
      let query = db<BindingRequestDbRowWithNames>('binding_requests as br')
        .select(
          'br.id',
          'br.server_id',
          'br.requester_user_id',
          'br.status',
          'br.message',
          'br.reviewer_user_id',
          'br.review_note',
          'br.reviewed_at',
          'br.created_at',
          'br.updated_at',
          'u.username as requester_username',
          'ru.username as reviewer_username',
          's.name as server_name',
          's.game_type as server_game_type',
        )
        .leftJoin('users as u', 'br.requester_user_id', 'u.id')
        .leftJoin('users as ru', 'br.reviewer_user_id', 'ru.id')
        .leftJoin('servers as s', 'br.server_id', 's.id')
        .where('br.requester_user_id', userId)
        .orderBy('br.created_at', 'desc');

      if (statusFilter) {
        query = query.where('br.status', statusFilter);
      }

      const rows = await query;
      const applications = rows.map(toApplicationWithNames);
      const response: ListMyBindingApplicationsResponse = { applications };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  }) as RequestHandler);

  return router;
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 判断用户是否为实例的管理者（owner 或 instance_admin 或 server_admin） */
async function isInstanceManager(db: Knex, serverId: string, userId: string): Promise<boolean> {
  // 1) server_admin / instance_admin 角色由路由层 requireInstanceAdmin 把关，
  //    此处仅做 DB 层校验：owner 匹配 或 instance_admins 关联 或 instance_roles 表
  // 注：为简化逻辑且与 requireInstanceAdmin 行为对齐，这里只查 owner + instance_admins。
  //    server_admin 由调用方在路由层（requireInstanceAdmin 中间件）放行；
  //    本函数用于审批端点内的二次校验（防止 requireInstanceAdmin 中间件未覆盖的边界）。

  // owner 校验
  const server = await db<{ owner_user_id: string }>('servers')
    .select('owner_user_id')
    .where('id', serverId)
    .first();
  if (!server) {
    return false;
  }
  if (server.owner_user_id === userId) {
    return true;
  }

  // instance_admins 共管关联
  const adminRecord = await db<{ user_id: string }>('instance_admins')
    .select('user_id')
    .where('instance_id', serverId)
    .where('user_id', userId)
    .first();
  if (adminRecord) {
    return true;
  }

  // instance_roles 表（v4.7.0+）
  const now = new Date().toISOString();
  const roleRecord = await db<{ role: string }>('instance_roles')
    .select('role')
    .where('instance_id', serverId)
    .where('user_id', userId)
    .where(function () {
      this.whereNull('expires_at').orWhere('expires_at', '>', now);
    })
    .first();
  if (roleRecord && roleRecord.role === 'instance_admin') {
    return true;
  }

  return false;
}

/** 按 ID 查询单条申请（不含 names，用于创建/审批后回填响应） */
async function getBindingApplicationById(db: Knex, id: string): Promise<BindingApplication | null> {
  const row = await db<BindingRequestDbRow>('binding_requests').where({ id }).first();
  if (!row) {
    return null;
  }
  return toApplication(row);
}

/** 解析状态过滤参数 */
function parseStatusFilter(raw: unknown): BindingApplicationStatus | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const valid: BindingApplicationStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];
  return valid.includes(raw as BindingApplicationStatus) ? (raw as BindingApplicationStatus) : null;
}

/** DB 行 → BindingApplication 响应 */
function toApplication(row: BindingRequestDbRow): BindingApplication {
  return {
    id: row.id,
    server_id: row.server_id,
    requester_user_id: row.requester_user_id,
    status: row.status as BindingApplicationStatus,
    message: row.message,
    reviewer_user_id: row.reviewer_user_id,
    review_note: row.review_note,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** DB 行（含 names） → BindingApplicationWithNames 响应 */
function toApplicationWithNames(row: BindingRequestDbRowWithNames): BindingApplicationWithNames {
  return {
    ...toApplication(row),
    requester_username: row.requester_username,
    reviewer_username: row.reviewer_username,
    server_name: row.server_name,
    server_game_type: row.server_game_type,
  };
}

/** 判断是否为唯一约束冲突错误（SQLite / 通用） */
function isUniqueConstraintError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  // SQLite: SQLITE_CONSTRAINT_UNIQUE
  // Knex 包装: "unique" / "UNIQUE constraint failed"
  return /unique/i.test(msg) || /constraint/i.test(msg);
}

function handleError(res: Response, err: unknown, logger: Logger): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'bindingRequests router internal error');
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
