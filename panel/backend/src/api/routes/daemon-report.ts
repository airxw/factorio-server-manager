// ============================================================================
// v4.13.0: Daemon 上报玩家会话端点（步骤18b 防假闭合写入链路）
// 依据：docs/plans/v4.13.0-instances-split-plan.md 步骤18b
//
// 端点：
//   POST /api/daemon/player-sessions/join  — 玩家加入实例
//   POST /api/daemon/player-sessions/leave — 玩家离开实例
//
// 鉴权：header x-report-key 校验（环境变量 DAEMON_REPORT_KEY）
//   - 未配置 DAEMON_REPORT_KEY 时端点返回 403（功能未启用）
//   - 密钥不匹配时返回 401
//
// 数据源：daemon 的 PlayerSessionReporter 触发上报（fire-and-forget HTTP POST）
// 写入目标：player_sessions 表（migration 20260806000002_create_player_sessions）
// 契约：public/schema/panel-api-types.ts
// ============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Logger } from 'pino';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import type { PanelErrorResponse } from '@public/schema/panel-api-types';

interface ServerRow {
  id: string;
  game_type: string;
}

interface PlayerBindingRow {
  user_id: string;
  game_player_name: string;
  game_type: string;
  status: string;
}

interface JoinBody {
  instance_id: string;
  game_player_name: string;
  join_at?: string;
}

interface LeaveBody {
  instance_id: string;
  game_player_name: string;
  leave_at?: string;
}

/**
 * 创建 daemon 上报路由
 * @param db Knex 实例
 * @param logger 日志器
 */
export function createDaemonReportRouter(db: Knex, logger: Logger): Router {
  const router = Router();

  // 鉴权中间件：校验 x-report-key
  router.use((req: Request, res: Response, next: NextFunction) => {
    const expectedKey = process.env.DAEMON_REPORT_KEY;
    if (!expectedKey) {
      res.status(403).json({
        error: { code: 'PANEL_FORBIDDEN', message: '未配置 DAEMON_REPORT_KEY，上报功能未启用' },
      } as PanelErrorResponse);
      return;
    }
    const provided = req.headers['x-report-key'];
    if (provided !== expectedKey) {
      res.status(401).json({
        error: { code: 'PANEL_UNAUTHORIZED', message: '上报密钥无效' },
      } as PanelErrorResponse);
      return;
    }
    next();
  });

  // ========================================================================
  // POST /api/daemon/player-sessions/join — 玩家加入实例
  // Body: { instance_id, game_player_name, join_at? }
  // ========================================================================
  router.post(
    '/daemon/player-sessions/join',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = req.body as JoinBody;
        if (!body?.instance_id || !body?.game_player_name) {
          res.status(400).json({
            error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 instance_id 或 game_player_name' },
          } as PanelErrorResponse);
          return;
        }

        // 检查 player_sessions 表是否存在（防止 migration 未执行）
        const hasTable = await db.schema.hasTable('player_sessions');
        if (!hasTable) {
          res.status(503).json({
            error: { code: 'PANEL_SERVICE_UNAVAILABLE', message: 'player_sessions 表不存在，请先执行 migration' },
          } as PanelErrorResponse);
          return;
        }

        // 1. 校验实例存在（v4.27.0: 不再查 game_type，仅校验存在性）
        const server = await db<ServerRow>('servers')
          .select('id')
          .where({ id: body.instance_id })
          .first();

        if (!server) {
          res.status(404).json({
            error: { code: 'SERVER_NOT_FOUND', message: '实例不存在' },
          } as PanelErrorResponse);
          return;
        }

        // 2. 查 bindings 表找 user_id（v4.17.0: 旧表 player_bindings 已合并到统一 bindings 表，
        //    v4.27.0: binding_type='player', scope_type='instance' 表示实例级玩家绑定）
        const binding = await db<PlayerBindingRow>('bindings')
          .select('user_id')
          .where('binding_type', '=', 'player')
          .where('scope_type', '=', 'instance')
          .where('scope_ref', '=', body.instance_id)
          .where('player_name', '=', body.game_player_name)
          .where('verify_status', '=', 'verified')
          .first();

        // 未绑定 Panel 账号的玩家：跳过记录（GM Workbench 只关心已绑定玩家）
        if (!binding) {
          res.json({ recorded: false, reason: 'no_binding', session_id: null });
          return;
        }

        // 3. INSERT player_sessions
        const now = new Date().toISOString();
        const joinAt = body.join_at ?? now;
        const sessionId = randomUUID();

        await db('player_sessions').insert({
          session_id: sessionId,
          player_user_id: binding.user_id,
          instance_id: body.instance_id,
          game_player_name: body.game_player_name,
          join_at: joinAt,
          leave_at: null,
          duration_seconds: null,
          created_at: now,
        });

        logger.info(
          { instance_id: body.instance_id, player: body.game_player_name, user_id: binding.user_id, session_id: sessionId },
          'player_sessions: join recorded',
        );

        res.json({ recorded: true, session_id: sessionId });
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'daemon-report join error');
        next(err);
      }
    },
  );

  // ========================================================================
  // POST /api/daemon/player-sessions/leave — 玩家离开实例
  // Body: { instance_id, game_player_name, leave_at? }
  // 逻辑：UPDATE 最近的未关闭会话（leave_at IS NULL）
  // ========================================================================
  router.post(
    '/daemon/player-sessions/leave',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = req.body as LeaveBody;
        if (!body?.instance_id || !body?.game_player_name) {
          res.status(400).json({
            error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 instance_id 或 game_player_name' },
          } as PanelErrorResponse);
          return;
        }

        const hasTable = await db.schema.hasTable('player_sessions');
        if (!hasTable) {
          res.status(503).json({
            error: { code: 'PANEL_SERVICE_UNAVAILABLE', message: 'player_sessions 表不存在' },
          } as PanelErrorResponse);
          return;
        }

        // 查找最近的未关闭会话
        const session = await db('player_sessions')
          .select('session_id', 'join_at')
          .where({
            instance_id: body.instance_id,
            game_player_name: body.game_player_name,
          })
          .whereNull('leave_at')
          .orderBy('join_at', 'desc')
          .first();

        if (!session) {
          // 没有未关闭的会话，跳过（可能是未绑定玩家或重复 leave 事件）
          res.json({ recorded: false, reason: 'no_open_session' });
          return;
        }

        // 计算 duration_seconds
        const now = new Date().toISOString();
        const leaveAt = body.leave_at ?? now;
        const joinTime = new Date(session.join_at).getTime();
        const leaveTime = new Date(leaveAt).getTime();
        const durationSeconds = Math.max(0, Math.floor((leaveTime - joinTime) / 1000));

        await db('player_sessions')
          .where({ session_id: session.session_id })
          .update({
            leave_at: leaveAt,
            duration_seconds: durationSeconds,
          });

        logger.info(
          { instance_id: body.instance_id, player: body.game_player_name, session_id: session.session_id, duration: durationSeconds },
          'player_sessions: leave recorded',
        );

        res.json({ recorded: true, session_id: session.session_id, duration_seconds: durationSeconds });
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'daemon-report leave error');
        next(err);
      }
    },
  );

  return router;
}
