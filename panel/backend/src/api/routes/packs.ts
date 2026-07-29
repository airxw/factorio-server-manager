// ============================================================================
// 模块7_Panel业务API — /api/packs 路由
// GET /        : 列出所有已加载 Pack
// GET /:id     : 查询单个 Pack 完整 YAML 内容
// POST /       : 在线创建 Pack（写入 pack.yaml）
// PUT /:id     : 在线更新 Pack（覆盖 pack.yaml）
// DELETE /:id  : 删除 Pack 目录
// POST /reload : 重新扫描 packs/ 目录
// ============================================================================

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { Knex } from 'knex';
import type { PackRegistry } from '../../core/packs/registry.js';
import { validatePackYaml } from '../../core/packs/loader.js';
import { requireRole } from '../../middleware/auth.js';
import { Role } from '../../core/auth/roles.js';
import type {
  ListPacksResponse,
  PackSummary,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

interface ReloadResult {
  loaded: string[];
  failed: Array<{ pack: string; error: string }>;
  total: number;
}

/** 扫描 packs/ 目录下的所有 Pack YAML 文件路径 */
function collectPackFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const packFile = path.join(dir, entry.name, 'pack.yaml');
      if (fs.existsSync(packFile)) {
        files.push(packFile);
      }
    } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

function reloadPacksFromDir(registry: PackRegistry, dir: string): ReloadResult {
  const loaded: string[] = [];
  const failed: Array<{ pack: string; error: string }> = [];

  registry.loadFromDir(dir);

  for (const pack of registry.listAll()) {
    loaded.push(pack.pack.id);
  }

  const packFiles = collectPackFiles(dir);
  for (const filePath of packFiles) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const v = validatePackYaml(raw);
      if (!v.valid) {
        failed.push({ pack: filePath, error: (v.errors ?? ['未知校验错误']).join('; ') });
      }
    } catch (e) {
      failed.push({
        pack: filePath,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { loaded, failed, total: loaded.length };
}

/** 获取 packs 根目录 */
function getPacksDir(): string {
  return process.env.PACKS_DIR ?? path.resolve(process.cwd(), '../../packs');
}

/** 安全校验：pack_id 仅允许字母数字、连字符、下划线 */
function isValidPackId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id) && id.length > 0 && id.length <= 64;
}

export function createPacksRouter(registry: PackRegistry, db: Knex): Router {
  const router = Router();

  // GET / — 列出所有 Pack 摘要
  router.get('/', (_req, res) => {
    try {
      const packs = registry.listAll();
      const summaries: PackSummary[] = packs.map((p) => ({
        id: p.pack.id,
        game: p.pack.game,
        variant: p.pack.variant,
        display_name: p.pack.display_name,
        version: p.pack.version,
        ui_tabs: p.ui?.tabs,
      }));
      const body: ListPacksResponse = { packs: summaries };
      res.json(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorBody: PanelErrorResponse = {
        error: {
          code: 'PANEL_INTERNAL_ERROR',
          message: `列出 Pack 失败: ${message}`,
        },
      };
      res.status(500).json(errorBody);
    }
  });

  // GET /:id — 查询单个 Pack 的完整 YAML 内容
  router.get('/:id', (req, res) => {
    try {
      const packsDir = getPacksDir();
      const yamlPath = path.join(packsDir, req.params.id, 'pack.yaml');
      if (!fs.existsSync(yamlPath)) {
        res.status(404).json({ error: { code: 'PACK_NOT_FOUND', message: `Pack ${req.params.id} 不存在` } });
        return;
      }
      const content = fs.readFileSync(yamlPath, 'utf8');
      res.json({
        id: req.params.id,
        yaml_path: yamlPath,
        content,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: { code: 'PANEL_INTERNAL_ERROR', message: `读取 Pack 失败: ${message}` } });
    }
  });

  // 3.4.5: GET /:id/items-config — 列出 Pack 物品池配置（仅元信息，不含 static_list）
  // 前端 Shop/ShopItems 据此判断是否渲染品质列 / 动态生成品质下拉
  // 返回契约不写在 public/（避免触碰契约），由本路由内联声明
  router.get('/:id/items-config', (req, res) => {
    try {
      const pack = registry.load(req.params.id);
      if (!pack) {
        res.status(404).json({ error: { code: 'PACK_NOT_FOUND', message: `Pack ${req.params.id} 不存在` } });
        return;
      }
      const items = pack.items;
      // 兼容 Pack 未声明 items 的情况（理论上 schema 必填，但运行时容错）
      const response = {
        pack_id: pack.pack.id,
        qualities: items?.qualities ?? [],
        quality_tiers: items?.quality_tiers ?? 0,
        categories: items?.categories ?? [],
        support_quality: pack.business?.shop?.support_quality ?? false,
        quality_tiers_shop: pack.business?.shop?.quality_tiers ?? items?.quality_tiers ?? 0,
      };
      res.json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: { code: 'PANEL_INTERNAL_ERROR', message: `读取 Pack 物品配置失败: ${message}` } });
    }
  });

  // POST / — 创建新 Pack（需 SERVER_ADMIN）
  router.post('/', requireRole(Role.SERVER_ADMIN), (req, res) => {
    try {
      const { pack_id, content } = req.body as { pack_id?: string; content?: string };
      if (!pack_id || !isValidPackId(pack_id)) {
        res.status(400).json({ error: { code: 'INVALID_PACK_ID', message: 'pack_id 仅允许字母、数字、连字符、下划线，长度 1-64' } });
        return;
      }
      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        res.status(400).json({ error: { code: 'EMPTY_CONTENT', message: 'content 不能为空' } });
        return;
      }

      const packsDir = getPacksDir();
      const packDir = path.join(packsDir, pack_id);
      const yamlPath = path.join(packDir, 'pack.yaml');

      if (fs.existsSync(yamlPath)) {
        res.status(409).json({ error: { code: 'PACK_EXISTS', message: `Pack ${pack_id} 已存在` } });
        return;
      }

      // 校验 YAML 合法性
      const v = validatePackYaml(content);
      if (!v.valid) {
        res.status(422).json({
          error: {
            code: 'INVALID_YAML',
            message: `YAML 校验失败: ${(v.errors ?? ['未知校验错误']).join('; ')}`,
          },
        });
        return;
      }

      fs.mkdirSync(packDir, { recursive: true });
      fs.writeFileSync(yamlPath, content, 'utf8');
      res.status(201).json({ success: true, pack_id, yaml_path: yamlPath });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: { code: 'PANEL_INTERNAL_ERROR', message: `创建 Pack 失败: ${message}` } });
    }
  });

  // PUT /:id — 更新 Pack（覆盖 pack.yaml，需 SERVER_ADMIN）
  router.put('/:id', requireRole(Role.SERVER_ADMIN), (req, res) => {
    try {
      const packId = req.params.id;
      if (!isValidPackId(packId)) {
        res.status(400).json({ error: { code: 'INVALID_PACK_ID', message: 'pack_id 格式非法' } });
        return;
      }

      const { content } = req.body as { content?: string };
      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        res.status(400).json({ error: { code: 'EMPTY_CONTENT', message: 'content 不能为空' } });
        return;
      }

      const packsDir = getPacksDir();
      const yamlPath = path.join(packsDir, packId, 'pack.yaml');
      if (!fs.existsSync(yamlPath)) {
        res.status(404).json({ error: { code: 'PACK_NOT_FOUND', message: `Pack ${packId} 不存在` } });
        return;
      }

      // 校验 YAML 合法性
      const v = validatePackYaml(content);
      if (!v.valid) {
        res.status(422).json({
          error: {
            code: 'INVALID_YAML',
            message: `YAML 校验失败: ${(v.errors ?? ['未知校验错误']).join('; ')}`,
          },
        });
        return;
      }

      fs.writeFileSync(yamlPath, content, 'utf8');
      res.json({ success: true, pack_id: packId, yaml_path: yamlPath });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: { code: 'PANEL_INTERNAL_ERROR', message: `更新 Pack 失败: ${message}` } });
    }
  });

  // DELETE /:id — 删除 Pack 目录（需 SERVER_ADMIN）
  // dry_run=true: 返回将被删除的目录 + 依赖该 Pack 的实例列表，不实际删除
  router.delete('/:id', requireRole(Role.SERVER_ADMIN), async (req, res) => {
    try {
      const packId = req.params.id;
      if (!isValidPackId(packId)) {
        res.status(400).json({ error: { code: 'INVALID_PACK_ID', message: 'pack_id 格式非法' } });
        return;
      }

      const packsDir = getPacksDir();
      const packDir = path.join(packsDir, packId);
      if (!fs.existsSync(packDir)) {
        res.status(404).json({ error: { code: 'PACK_NOT_FOUND', message: `Pack ${packId} 不存在` } });
        return;
      }

      // dry_run=true: 返回预览信息，不执行删除
      const dryRunRaw = req.query.dry_run;
      const dryRunFlag =
        dryRunRaw === 'true' ||
        (Array.isArray(dryRunRaw) && dryRunRaw.includes('true'));
      console.log('[packs/delete] dry_run query:', JSON.stringify(req.query), 'parsed:', dryRunFlag);
      if (dryRunFlag) {
        const dependentInstances = await db('servers')
          .where({ pack_id: packId })
          .select('id', 'name', 'status');
        res.json({
          pack_id: packId,
          pack_dir: packDir,
          dependent_instances: dependentInstances,
          can_delete: dependentInstances.length === 0,
        });
        return;
      }

      fs.rmSync(packDir, { recursive: true, force: true });
      res.json({ success: true, pack_id: packId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: { code: 'PANEL_INTERNAL_ERROR', message: `删除 Pack 失败: ${message}` } });
    }
  });

  // POST /reload — 重新扫描 packs/ 目录
  router.post('/reload', requireRole(Role.SERVER_ADMIN), (_req, res) => {
    try {
      const packsDir = getPacksDir();
      const result = reloadPacksFromDir(registry, packsDir);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorBody: PanelErrorResponse = {
        error: {
          code: 'PANEL_INTERNAL_ERROR',
          message: `重载 Pack 失败: ${message}`,
        },
      };
      res.status(500).json(errorBody);
    }
  });

  return router;
}
