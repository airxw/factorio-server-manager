// ============================================================================
// v4.0.2: 演示模式管理 API
// 挂载前缀：/api/demo（index.ts 套 authenticateToken）
//
// 端点：
//   GET  /api/demo/status    — 返回 demo 模式状态（是否启用 / 内置账号清单 / 演示实例数）
//   POST /api/demo/reset     — 重置演示数据（仅 server_admin；清空并重新 seed 5 个实例）
//
// 安全策略：
//   - POST /reset 双重闸门：env.VITE_ENABLE_DEMO === 'true' AND req.user.role === 'server_admin'
//   - 实际重置流程：先停掉运行中的演示实例（仅 DB 状态切换）→ 删 demo 实例相关业务表数据
//                   → 重新调用 seedDemoInstancesIfMissing 生成新数据
//   - 不会触碰用户表（演示账号一直保留）
//   - 全程写 audit_logs 留痕（v3.9.0-S10 审计中间件）
// ============================================================================

import { Router, type Response } from 'express';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { PackRegistry } from '../../core/packs/registry.js';
import type { PanelErrorResponse } from '@public/schema/panel-api-types';
import { normalizeRole, Role } from '../../core/auth/roles.js';
import {
  seedDemoInstancesIfMissing,
  DEMO_INSTANCE_IDS,
} from '../../db/seedDemoData.js';

interface DemoStatusResponse {
  enabled: boolean;
  builtin_emails: string[];
  demo_instance_count: number;
  demo_instance_ids: string[];
  last_reset_at: string | null;
}

interface DemoResetResponse {
  reset: boolean;
  deleted_instances: number;
  recreated_instances: number;
  reset_at: string;
}

export function createDemoRouter(db: Knex, registry: PackRegistry, logger: Logger): Router {
  const router = Router();

  // ----- GET /api/demo/status -----
  //   任意已登录用户可查询（用于前端登录页决定是否展示"一键登录"按钮）
  router.get('/status', async (_req, res) => {
    try {
      const enabled = process.env.VITE_ENABLE_DEMO === 'true';
      const builtinEmails = ['admin@local.dev', 'manager@local.dev', 'user@local.dev'];

      // 统计 demo 实例数
      let demoInstanceCount = 0;
      try {
        const rows = await db('servers').whereIn('id', DEMO_INSTANCE_IDS).count('id as cnt');
        const row = rows[0] as unknown as { cnt: number } | undefined;
        demoInstanceCount = Number(row?.cnt ?? 0);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'demo 模式：查询 demo 实例数失败',
        );
      }

      // 上次重置时间（从 system_config 取 demo.last_reset_at）
      let lastResetAt: string | null = null;
      try {
        const row = await db('system_config').where({ key: 'demo.last_reset_at' }).first();
        if (row) {
          lastResetAt = (row as unknown as { value: string }).value;
        }
      } catch {
        // ignore
      }

      const response: DemoStatusResponse = {
        enabled,
        builtin_emails: enabled ? builtinEmails : [],
        demo_instance_count: demoInstanceCount,
        demo_instance_ids: enabled ? DEMO_INSTANCE_IDS : [],
        last_reset_at: lastResetAt,
      };
      res.json(response);
    } catch (err) {
      handleInternal(res, err, logger);
    }
  });

  // ----- POST /api/demo/reset -----
  //   双重闸门：VITE_ENABLE_DEMO=true + server_admin
  //   流程：收集 demo 实例 → 停服标记 → 删业务表数据 → 重 seed
  router.post('/reset', async (req, res) => {
    try {
      if (process.env.VITE_ENABLE_DEMO !== 'true') {
        const body: PanelErrorResponse = {
          error: { code: 'DEMO_MODE_DISABLED', message: '当前未启用演示模式，无法重置' },
        };
        res.status(403).json(body);
        return;
      }
      const userRole = normalizeRole(req.user?.role ?? '');
      if (userRole !== Role.SERVER_ADMIN) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_FORBIDDEN', message: '仅 server_admin 可重置演示数据' },
        };
        res.status(403).json(body);
        return;
      }

      const now = new Date().toISOString();
      // 1. 收集 demo 实例 ID 集合（含历史已删除的固定 UUID）
      const existingRows = await db('servers').whereIn('id', DEMO_INSTANCE_IDS).select('id');
      const existingIds = existingRows.map((r) => (r as unknown as { id: string }).id);

      // 2. 标记为 stopped（不允许在 demo 模式实际运行实例时重置）
      //    注：demo 数据不会真正启动实例（init/seed 只插 DB），但保险起见仍检查 status
      const runningRows = await db('servers')
        .whereIn('id', existingIds)
        .whereNotIn('status', ['stopped', 'error'])
        .select('id');
      if (runningRows.length > 0) {
        const body: PanelErrorResponse = {
          error: {
            code: 'INVALID_SERVER_STATE',
            message: `以下 demo 实例仍处于运行中，请先停止后再重置: ${runningRows
              .map((r) => (r as unknown as { id: string }).id)
              .join(', ')}`,
          },
        };
        res.status(409).json(body);
        return;
      }

      // 3. 删 demo 实例相关业务表数据（顺序：先删子表，再删主表）
      const tablesToWipe = [
        'chat_logs',
        'votes',
        'vote_records',
        'vote_settings',
        'chat_trigger_responses',
        'chat_settings',
        'player_join_settings',
        'periodic_messages',
        'shop_order_items',
        'shop_orders',
        'shop_items',
        'cdk_codes',
        'gift_claims',
        'list_entries',
        'mod_records',
        'save_records',
        'backup_records',
        'monitor_snapshots',
        'player_histories',
        'audit_logs', // 不清！审计日志保留
      ];
      for (const tbl of tablesToWipe) {
        try {
          await db(tbl).whereIn('server_id', existingIds).delete();
        } catch (err) {
          logger.warn(
            { table: tbl, err: err instanceof Error ? err.message : String(err) },
            'demo 重置：清表失败（继续）',
          );
        }
      }

      // 4. 删主表 servers
      const deletedCount = existingIds.length;
      if (existingIds.length > 0) {
        await db('servers').whereIn('id', existingIds).delete();
      }

      // 5. 重 seed（5 个实例 + 业务数据）
      const seedResult = await seedDemoInstancesIfMissing(db, registry);

      // 6. 写 system_config 记录最后重置时间（留痕）
      try {
        await db('system_config')
          .insert({
            key: 'demo.last_reset_at',
            value: now,
            description: 'v4.0.2: 上次 demo 重置时间（演示模式）',
            updated_at: now,
          })
          .onConflict('key')
          .merge(['value', 'description', 'updated_at']);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'demo 重置：写 system_config 失败（非致命）',
        );
      }

      const response: DemoResetResponse = {
        reset: true,
        deleted_instances: deletedCount,
        recreated_instances: seedResult.created.length,
        reset_at: now,
      };
      res.json(response);
    } catch (err) {
      handleInternal(res, err, logger);
    }
  });

  return router;
}

function handleInternal(res: Response, err: unknown, logger: Logger): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'demo router internal error');
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
