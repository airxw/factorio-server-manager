// ============================================================================
// 模块7_Panel业务API — 投票路由（P3）
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken）
// 对应服务：app.locals.voteService（VoteServiceImpl）
//
// 挂载前缀：/api/servers
//   管理类（requireAdmin 由 index.ts 套，本文件内部对 settings 端点追加 inline admin 校验兜底）：
//   GET    /:serverId/vote-settings            → getSettings   (admin)
//   PUT    /:serverId/vote-settings            → upsertSettings(admin)
//   业务类（authenticateToken 即可）：
//   GET    /:serverId/votes                    → listVotes     (任意登录用户)
//   POST   /:serverId/votes                    → createVote    (任意登录用户)
//   GET    /:serverId/votes/:id                → getVote       (任意登录用户)
//   POST   /:serverId/votes/:id/cast           → castVote      (任意登录用户)
//   POST   /:serverId/votes/:id/cancel         → cancelVote    (任意登录用户)
// ============================================================================

import { Router, type Response } from 'express';
import type { VoteServiceImpl } from '../../services/voteService.js';
import { AppError } from '../../services/errors.js';
import type {
  CancelVoteResponse,
  CastVoteRequest,
  CastVoteResponse,
  CreateVoteRequest,
  CreateVoteResponse,
  GetVoteResponse,
  GetVoteSettingsResponse,
  ListVotesResponse,
  PanelErrorResponse,
  UpsertVoteSettingsRequest,
  UpsertVoteSettingsResponse,
  VoteChoice,
} from '@public/schema/panel-api-types';

const VALID_CHOICES: VoteChoice[] = ['yes', 'no'];

function isAdminRole(role: string | undefined): boolean {
  // 新 3 级角色体系下，server_admin 为最高权限；保留 system_admin/admin 兼容旧 JWT
  return role === 'server_admin' || role === 'system_admin' || role === 'admin';
}

/**
 * 创建 Vote 路由
 * 依赖通过 req.app.locals 注入：voteService
 */
export function createVoteRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/vote-settings — 查询投票设置（admin）
  // ----------------------------------------------------------------
  router.get('/:serverId/vote-settings', async (req, res) => {
    try {
      if (!isAdminRole(req.user?.role)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_FORBIDDEN', message: '需要管理员权限' },
        };
        res.status(403).json(errBody);
        return;
      }
      const voteService = req.app.locals.voteService as VoteServiceImpl;
      const settings = await voteService.getSettings(req.params.serverId);
      const response: GetVoteSettingsResponse = { settings };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // PUT /api/servers/:serverId/vote-settings — upsert 投票设置（admin）
  // ----------------------------------------------------------------
  router.put('/:serverId/vote-settings', async (req, res) => {
    try {
      if (!isAdminRole(req.user?.role)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_FORBIDDEN', message: '需要管理员权限' },
        };
        res.status(403).json(errBody);
        return;
      }
      const voteService = req.app.locals.voteService as VoteServiceImpl;
      const body = req.body as Partial<UpsertVoteSettingsRequest>;
      if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'enabled 需为布尔值' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (
        body.threshold !== undefined &&
        (!Number.isInteger(body.threshold) || body.threshold < 1)
      ) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'threshold 需为正整数' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (
        body.duration_seconds !== undefined &&
        (!Number.isInteger(body.duration_seconds) || body.duration_seconds < 1)
      ) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'duration_seconds 需为正整数' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (
        body.reason_prefix !== undefined &&
        typeof body.reason_prefix !== 'string'
      ) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'reason_prefix 需为字符串' },
        };
        res.status(400).json(errBody);
        return;
      }
      // Task 4 新增字段校验：trigger_keywords / cooldown_seconds / target_cooldown_seconds / admin_immune / vip_immune_min_level
      if (
        body.trigger_keywords !== undefined &&
        !Array.isArray(body.trigger_keywords)
      ) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'trigger_keywords 需为字符串数组' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (
        body.cooldown_seconds !== undefined &&
        (!Number.isInteger(body.cooldown_seconds) || body.cooldown_seconds < 0)
      ) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'cooldown_seconds 需为非负整数' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (
        body.target_cooldown_seconds !== undefined &&
        (!Number.isInteger(body.target_cooldown_seconds) || body.target_cooldown_seconds < 0)
      ) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'target_cooldown_seconds 需为非负整数' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (
        body.admin_immune !== undefined &&
        typeof body.admin_immune !== 'boolean'
      ) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'admin_immune 需为布尔值' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (
        body.vip_immune_min_level !== undefined &&
        (!Number.isInteger(body.vip_immune_min_level) || body.vip_immune_min_level < 0)
      ) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'vip_immune_min_level 需为非负整数' },
        };
        res.status(400).json(errBody);
        return;
      }
      const settings = await voteService.upsertSettings(req.params.serverId, {
        enabled: body.enabled,
        threshold: body.threshold,
        duration_seconds: body.duration_seconds,
        reason_prefix: body.reason_prefix,
        trigger_keywords: body.trigger_keywords,
        cooldown_seconds: body.cooldown_seconds,
        target_cooldown_seconds: body.target_cooldown_seconds,
        admin_immune: body.admin_immune,
        vip_immune_min_level: body.vip_immune_min_level,
      });
      const response: UpsertVoteSettingsResponse = { settings };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/votes — 列出投票（任意登录用户）
  // ----------------------------------------------------------------
  router.get('/:serverId/votes', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(errBody);
        return;
      }
      const voteService = req.app.locals.voteService as VoteServiceImpl;
      const votes = await voteService.listVotes(req.params.serverId);
      const response: ListVotesResponse = { votes };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/votes — 创建投票（任意登录用户）
  // ----------------------------------------------------------------
  router.post('/:serverId/votes', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(errBody);
        return;
      }
      const voteService = req.app.locals.voteService as VoteServiceImpl;
      const body = req.body as Partial<CreateVoteRequest>;
      if (typeof body.initiator !== 'string' || body.initiator.length === 0) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 initiator' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (typeof body.target !== 'string' || body.target.length === 0) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 target' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (typeof body.reason !== 'string' || body.reason.length === 0) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 reason' },
        };
        res.status(400).json(errBody);
        return;
      }
      const vote = await voteService.createVote(req.params.serverId, {
        initiator: body.initiator,
        target: body.target,
        reason: body.reason,
      });
      const response: CreateVoteResponse = { vote };
      res.status(201).json(response);
    } catch (err) {
      handleVoteError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/votes/:id — 投票详情（含 records）
  // ----------------------------------------------------------------
  router.get('/:serverId/votes/:id', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(errBody);
        return;
      }
      const voteService = req.app.locals.voteService as VoteServiceImpl;
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `id 必须为数字: ${req.params.id}` },
        };
        res.status(400).json(errBody);
        return;
      }
      const result = await voteService.getVote(req.params.serverId, id);
      const response: GetVoteResponse = {
        vote: result.vote,
        records: result.records,
      };
      res.json(response);
    } catch (err) {
      handleVoteError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/votes/:id/cast — 投票表态（任意登录用户）
  //   注意：放在 /:id 之后，Express 字面量 cast 段优先于 :param 匹配
  // ----------------------------------------------------------------
  router.post('/:serverId/votes/:id/cast', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(errBody);
        return;
      }
      const voteService = req.app.locals.voteService as VoteServiceImpl;
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `id 必须为数字: ${req.params.id}` },
        };
        res.status(400).json(errBody);
        return;
      }
      const body = req.body as Partial<CastVoteRequest>;
      if (typeof body.voter !== 'string' || body.voter.length === 0) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 voter' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (!isValidChoice(body.vote_choice)) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: `vote_choice 无效: ${String(body.vote_choice)}（需为 yes/no）`,
          },
        };
        res.status(400).json(errBody);
        return;
      }
      const result = await voteService.castVote(req.params.serverId, id, {
        voter: body.voter,
        vote_choice: body.vote_choice,
      });
      const response: CastVoteResponse = {
        vote: result.vote,
        record: result.record,
      };
      res.json(response);
    } catch (err) {
      handleVoteError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/votes/:id/cancel — 取消投票（任意登录用户）
  // ----------------------------------------------------------------
  router.post('/:serverId/votes/:id/cancel', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(errBody);
        return;
      }
      const voteService = req.app.locals.voteService as VoteServiceImpl;
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `id 必须为数字: ${req.params.id}` },
        };
        res.status(400).json(errBody);
        return;
      }
      const vote = await voteService.cancelVote(req.params.serverId, id);
      const response: CancelVoteResponse = { vote };
      res.json(response);
    } catch (err) {
      handleVoteError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

function isValidChoice(value: unknown): value is VoteChoice {
  return typeof value === 'string' && (VALID_CHOICES as readonly string[]).includes(value);
}

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  VOTE_NOT_FOUND: 404,
  VOTE_ALREADY_CLOSED: 409,
  VOTE_ALREADY_CAST: 409,
  PANEL_FORBIDDEN: 403,
};

function handleVoteError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    const status = ERROR_CODE_TO_STATUS[err.code] ?? 400;
    const body: PanelErrorResponse = {
      error: {
        code: err.code as PanelErrorResponse['error']['code'],
        message: err.message,
      },
    };
    res.status(status).json(body);
    return;
  }
  handleInternal(res, err);
}

function handleInternal(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
