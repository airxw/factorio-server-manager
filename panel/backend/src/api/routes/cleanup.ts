// ============================================================================
// v3.4.0: 实例清理面板 API（仅 server_admin 可见）
// 挂载前缀：/api/admin（routes-registry.ts 套 authenticateToken）
//
// 端点：
//   GET  /cleanup-instances               — 列出待清理实例
//   POST /cleanup-instances/:id/confirm-delete — 确认删除
//   POST /cleanup-instances/:id/ignore     — 忽略（取消标记）
//
// v3.6.0-B1: confirm-delete 补磁盘清理（清 instance_root 目录，复用 safeRemoveService）
// v3.6.0-B2: confirm-delete 成功后同步清 chat_logs（避免孤儿记录）
// v4.29.10: requireAdmin 从挂载层移入各路由内部（与 v4.29.9 同类修复对齐）。
//           原挂载 `app.use('/api/admin', authenticateToken, requireAdmin, createCleanupRouter)`
//           的 requireAdmin 是挂载层中间件，会拦截所有 /api/admin/* 子路径——包括
//           /api/admin/instances/:id/assets 等本应由 requireInstanceAdmin 门控的端点，
//           导致 instance_admin 角色被错误拒绝（403 权限不足）。
// ============================================================================

import { Router, type Response } from 'express';
import type { Knex } from 'knex';
import { requireAdmin } from '../../middleware/auth.js';
import type { SafeRemoveService } from '../../services/safeRemoveService.js';
import type {
  CleanupInstanceSummary,
  ConfirmCleanupDeleteResponse,
  IgnoreCleanupResponse,
  ListCleanupInstancesResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

interface CleanupRow {
  id: string;
  name: string;
  pack_id: string;
  game_type: string;
  current_version: string | null;
  owner_username: string;
  last_activity_at: string | null;
  marked_for_deletion: number;
  status: string;
}

interface ServerRowForDelete {
  id: string;
  status: string;
  node_id: string;
}

export function createCleanupRouter(
  db: Knex,
  safeRemoveService: SafeRemoveService,
): Router {
  const router = Router();

  // GET /api/admin/cleanup-instances — 列出待清理实例
  router.get('/cleanup-instances', requireAdmin, async (_req, res) => {
    try {
      const rows = await db<CleanupRow>('servers')
        .select(
          'servers.id',
          'servers.name',
          'servers.pack_id',
          'servers.game_type',
          'servers.current_version',
          'servers.last_activity_at',
          'servers.marked_for_deletion',
          'servers.status',
          'users.username as owner_username',
        )
        .leftJoin('users', 'servers.owner_user_id', 'users.id')
        .orderBy('servers.last_activity_at', 'asc');

      const now = Date.now();

      // 对每个实例计算 idle_days 和 newer_versions_count
      const instances: CleanupInstanceSummary[] = [];
      for (const row of rows) {
        const idleDays = row.last_activity_at
          ? Math.floor((now - new Date(row.last_activity_at).getTime()) / (24 * 60 * 60 * 1000))
          : 0;

        // 查询比当前版本更新的版本数
        let newerVersionsCount = 0;
        if (row.current_version) {
          const parts: number[] = row.current_version.split('.').map((s: string) => parseInt(s, 10));
          // 注意：Number.isNaN(undefined) === false，必须用 isFinite 同时拦截 NaN 和 undefined，
          // 否则两段版本号（如 "358.22"）的 patch 会变成 undefined → Knex 编译 WHERE 报错
          const curMajor = Number.isFinite(parts[0]) ? parts[0] : 0;
          const curMinor = Number.isFinite(parts[1]) ? parts[1] : 0;
          const curPatch = Number.isFinite(parts[2]) ? parts[2] : 0;

          const newerCount = await db('game_versions')
            .where({ pack_id: row.pack_id })
            .andWhere(function () {
              void this
                .where('version_major', '>', curMajor)
                .orWhere(function () {
                  void this
                    .where('version_major', '=', curMajor)
                    .where('version_minor', '>', curMinor);
                })
                .orWhere(function () {
                  void this
                    .where('version_major', '=', curMajor)
                    .where('version_minor', '=', curMinor)
                    .where('version_patch', '>', curPatch);
                });
            })
            .count('* as cnt')
            .first();
          newerVersionsCount = newerCount ? (newerCount as unknown as { cnt: number }).cnt : 0;
        }

        // 满足自动标记条件：stopped + 闲置>90天 + 有>=2个更新版本，且未被标记
        if (
          row.status === 'stopped' &&
          idleDays > 90 &&
          newerVersionsCount >= 2 &&
          row.marked_for_deletion === 0
        ) {
          await db('servers').where({ id: row.id }).update({ marked_for_deletion: true });
          row.marked_for_deletion = 1;
        }

        instances.push({
          id: row.id,
          name: row.name,
          pack_id: row.pack_id,
          game_type: row.game_type,
          current_version: row.current_version,
          owner_username: row.owner_username ?? '未知',
          last_activity_at: row.last_activity_at,
          idle_days: idleDays,
          newer_versions_count: newerVersionsCount,
          marked_for_deletion: row.marked_for_deletion === 1,
          status: row.status,
        });
      }

      const response: ListCleanupInstancesResponse = { instances };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // POST /api/admin/cleanup-instances/:id/confirm-delete — 确认删除
  // v3.6.0-B1: 先删磁盘 instance_root 目录，再删 DB；daemon rm 失败时 DB 不动
  // v3.6.0-B2: 删除 DB 前同步清 chat_logs（避免孤儿记录）
  // dry_run=true: 预览将删除的文件路径 + 大小 + DB 记录，不实际删除
  router.post('/cleanup-instances/:id/confirm-delete', requireAdmin, async (req, res) => {
    try {
      const instanceId = req.params.id;
      const row = await db<ServerRowForDelete>('servers')
        .where({ id: instanceId })
        .select('id', 'status', 'node_id')
        .first();
      if (!row) {
        res.status(404).json({ error: { code: 'SERVER_NOT_FOUND', message: '实例不存在' } });
        return;
      }

      // dry_run=true: 返回预览信息，不执行删除（不校验 status，允许任意状态预览）
      if (req.query.dry_run === 'true') {
        const preview = await safeRemoveService.previewRemove({
          namespace: 'instances',
          serverId: instanceId,
          nodeId: row.node_id,
        });
        const dbRecord = await db('servers').where({ id: instanceId }).first();
        res.json({
          instance_id: instanceId,
          instance_root: preview.target_path,
          size_bytes: preview.size_bytes,
          file_count: preview.file_count,
          db_record: dbRecord,
          preview_success: preview.success,
          preview_error: preview.error ?? null,
        });
        return;
      }

      if (row.status !== 'stopped') {
        res.status(409).json({
          error: { code: 'INVALID_SERVER_STATE', message: '仅 stopped 状态可删除' },
        });
        return;
      }

      // v3.6.0-B1: 先删磁盘 instance_root 目录（instances/<server_id>/）
      const removeResult = await safeRemoveService.safeRemove({
        namespace: 'instances',
        serverId: instanceId,
        nodeId: row.node_id,
      });

      if (!removeResult.success) {
        res.status(500).json({
          error: {
            code: 'PANEL_DISK_CLEANUP_FAILED',
            message: `磁盘清理失败: ${removeResult.error ?? '未知错误'}`,
          },
        });
        return;
      }

      // v3.6.0-B2: 同步清 chat_logs（避免孤儿记录）
      try {
        await db('chat_logs').where({ server_id: instanceId }).delete();
      } catch {
        // chat_logs 清理失败不阻断实例删除（实例已不可用）
      }

      // 磁盘清理成功后删 DB
      await db('servers').where({ id: instanceId }).delete();
      const response: ConfirmCleanupDeleteResponse = {
        id: instanceId,
        deleted: true,
        freed_bytes: removeResult.freed_bytes,
      };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // POST /api/admin/cleanup-instances/:id/ignore — 忽略
  router.post('/cleanup-instances/:id/ignore', requireAdmin, async (req, res) => {
    try {
      const instanceId = req.params.id;
      await db('servers').where({ id: instanceId }).update({ marked_for_deletion: false });
      const response: IgnoreCleanupResponse = { id: instanceId, ignored: true };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  return router;
}

function handleInternal(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
