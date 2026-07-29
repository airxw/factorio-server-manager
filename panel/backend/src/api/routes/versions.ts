// ============================================================================
// v3.5.0: Pack 版本池 API — 版本发现/下载/列表/删除
// 挂载前缀：/api/packs（index.ts 仅套 authenticateToken）
//
// 端点：
//   GET    /:packId/versions/available           — 从远程源获取可用版本列表（含已下载标记）
//   GET    /:packId/versions                     — 列出该 Pack 所有已下载版本（已认证用户）
//   POST   /:packId/versions/download            — 触发版本下载（已认证用户，支持指定版本）
//   GET    /:packId/versions/download/progress    — 查询下载进度
//   DELETE /:packId/versions/:versionId           — 删除指定版本（仅 server_admin）
// ============================================================================

import { Router, type Response } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import type { Knex } from 'knex';
import type { PackRegistry } from '../../core/packs/registry.js';
import type { DaemonClient } from '@public/interface_stub/daemon-client';
import { normalizeRole, Role } from '../../core/auth/roles.js';
import type { GamePack } from '@public/schema/pack-schema';
import { sanitizeTemplateVar } from '../../services/commandDispatcher.js';
import type { SafeRemoveService } from '../../services/safeRemoveService.js';
import {
  resolveStaticSource,
  STATIC_SOURCE_PREFIX,
  STATIC_VERSION_SOURCES,
} from '../../core/packs/staticVersions.js';
// v4.12.0: VersionProvider 工厂(步骤 1 版本源真实化重构)
import { getProvider } from '../../core/packs/versionProviders/index.js';
// v4.12.0: 版本号规范化解析与比对(步骤 2)
import { compareVersions, parseVersionFlex } from '../../core/packs/versionCompare.js';
import type {
  AvailableVersionsResponse,
  AvailableVersionEntry,
  DeleteGameVersionResponse,
  DownloadVersionResponse,
  GameVersionSummary,
  ListGameVersionsResponse,
  PanelErrorResponse,
  VersionDownloadProgressResponse,
} from '@public/schema/panel-api-types';

interface GameVersionRow {
  id: string;
  pack_id: string;
  version: string;
  node_id: string;
  download_path: string;
  file_size_bytes: number | null;
  downloaded_by: string;
  downloaded_at: string;
  version_major: number;
  version_minor: number;
  version_patch: number;
  // v4.12.0: Steam depot buildid(可空,非 Steam 游戏为 null)
  version_buildid: string | null;
  created_at: string;
}

interface GameVersionRowWithUser extends GameVersionRow {
  username: string;
}

interface DownloadProgress {
  task_id: string;
  phase: 'queued' | 'checking' | 'downloading' | 'completed' | 'failed';
  progress_percent: number;
  message: string;
  error?: string;
}

const downloadProgressStore = new Map<string, DownloadProgress>();

export function createVersionsRouter(
  db: Knex,
  registry: PackRegistry,
  daemonClient: DaemonClient,
  safeRemoveService: SafeRemoveService,
): Router {
  const router = Router();

  // GET /api/packs/:packId/versions/available — 从远程源获取可用版本列表
  router.get('/:packId/versions/available', async (req, res) => {
    try {
      const packId = req.params.packId;
      const pack = registry.load(packId);
      if (!pack) {
        res.status(404).json({ error: { code: 'PACK_NOT_FOUND', message: `Pack 不存在: ${packId}` } });
        return;
      }

      // 获取远程版本数据
      let remoteVersions: { version: string; type?: string }[] = [];
      let latest = '';

      // v4.12.0: 优先使用 VersionProvider(步骤 1 版本源真实化重构)
      // Provider 存在且成功 → 直接使用其返回的版本列表;
      // Provider 不存在(null)或失败 → 回退到 legacy source_url HTTP fetch。
      const provider = getProvider(pack, { pack });
      let providerHandled = false;
      if (provider) {
        try {
          const entries = await provider.listVersions();
          if (entries.length > 0) {
            remoteVersions = entries.map((e) => ({
              version: e.version,
              type: e.type,
            }));
            const latestInfo = await provider.getLatest();
            latest = latestInfo.release || entries[0].version;
            providerHandled = true;
          }
        } catch (err) {
          // Provider 失败,记录后回退到 legacy
          console.warn(
            `[versions] Pack ${packId} VersionProvider 失败,回退到 legacy source_url: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // legacy 路径:Provider 未处理时走原有 source_url HTTP fetch
      if (!providerHandled) {
        const sourceUrl = pack.update?.source_url ?? pack.versions.manifest_url;
        if (!sourceUrl) {
          throw new Error('Pack 未配置版本源');
        }

        let data: Record<string, unknown>;

        // 1) static:// 协议：直接走内置静态版本源（pack.yaml 占位 URL 的替代）
        if (sourceUrl.startsWith(STATIC_SOURCE_PREFIX)) {
          const staticSource = resolveStaticSource(sourceUrl);
          if (!staticSource) {
            throw new Error(
              `静态版本源未配置: ${sourceUrl}（已知 pack: ${Object.keys(STATIC_VERSION_SOURCES).join(', ') || '（无）'}）`,
            );
          }
          // 转换为与 HTTP 路径兼容的 Mojang manifest 形状
          data = {
            latest: { ...staticSource.latest },
            versions: staticSource.versions.map((v) => ({ id: v.id, type: v.type })),
          };
        } else {
          // 2) HTTP 路径：拉取远程版本清单
          const resp = await fetch(sourceUrl, { signal: AbortSignal.timeout(30_000) });
          if (!resp.ok) {
            throw new Error(`远程版本源返回 HTTP ${resp.status} ${resp.statusText}`);
          }
          const contentType = resp.headers.get('content-type') ?? '';
          if (!/json/i.test(contentType)) {
            // 远程源不是 JSON（典型：占位 URL example.com 返回 HTML 首页）
            const preview = (await resp.text()).slice(0, 80).replace(/\s+/g, ' ');
            throw new Error(
              `远程版本源 ${sourceUrl} 返回了非 JSON 内容 (Content-Type: ${contentType || '未声明'})，预览: ${preview}`,
            );
          }
          data = await resp.json() as Record<string, unknown>;
        }

        // 解析版本列表（适配多种 API 格式）
        // 格式1: Mojang manifest — { latest: { release, snapshot }, versions: [{id, type, url}] }
        if (Array.isArray(data.versions)) {
          const arr = data.versions as Array<Record<string, unknown> | string>;
          remoteVersions = arr.map((v) => {
            if (typeof v === 'string') return { version: v };
            return {
              version: String(v.id ?? v.version ?? ''),
              type: String(v.type ?? ''),
            };
          });
          const latestObj = data.latest as Record<string, string> | undefined;
          latest = latestObj?.release ?? latestObj?.snapshot ?? '';
        }
        else {
          const seen = new Set<string>();
          for (const channel of ['stable', 'experimental', 'latest', 'release']) {
            const obj = data[channel];
            if (typeof obj === 'object' && obj !== null) {
              for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
                if (typeof v === 'string' && v.length > 0 && !seen.has(v)) {
                  seen.add(v);
                  remoteVersions.push({ version: v, type: `${channel}/${k}` });
                }
              }
            }
          }
          // fallback: 检查顶层 version/latest_version 字段
          if (remoteVersions.length === 0) {
            try {
              const versionStr = extractVersion(data);
              remoteVersions = [{ version: versionStr }];
            } catch { /* 解析失败，保持空列表 */ }
          }
          latest = remoteVersions[0]?.version ?? '';
        }
      }

      if (remoteVersions.length === 0) {
        throw new Error('无法从远程源解析版本列表');
      }

      // 查询已下载版本，标记 downloaded 状态
      const downloaded = await db<GameVersionRow>('game_versions')
        .where({ pack_id: packId })
        .select('version');

      const downloadedSet = new Set(downloaded.map((r) => r.version));

      // 版本号排序（降序）— v4.12.0: 改用 compareVersions 支持 v 前缀/build 号
      const sorted = remoteVersions
        .filter((v) => v.version.length > 0)
        .map((v) => ({
          version: v.version,
          type: v.type,
          downloaded: downloadedSet.has(v.version),
        }))
        .sort((a, b) => compareVersions(b.version, a.version));

      const versions: AvailableVersionEntry[] = sorted.map((v) => ({
        version: v.version,
        type: v.type || undefined,
        downloaded: v.downloaded,
      }));

      const response: AvailableVersionsResponse = { latest, versions };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // GET /api/packs/:packId/versions — 列出已下载版本
  router.get('/:packId/versions', async (req, res) => {
    try {
      const packId = req.params.packId;
      const rows = await db<GameVersionRowWithUser & { reference_count: number }>('game_versions')
        .select('game_versions.*', 'users.username')
        .select(
          db.raw(
            '(SELECT COUNT(*) FROM servers s WHERE s.version_id = game_versions.id) AS reference_count',
          ),
        )
        .leftJoin('users', 'game_versions.downloaded_by', 'users.id')
        .where({ pack_id: packId })
        .orderBy('version_major', 'desc')
        .orderBy('version_minor', 'desc')
        .orderBy('version_patch', 'desc');

      const versions: GameVersionSummary[] = rows.map((r) => ({
        id: r.id,
        pack_id: r.pack_id,
        version: r.version,
        node_id: r.node_id,
        download_path: r.download_path,
        file_size_bytes: r.file_size_bytes,
        downloaded_by: r.downloaded_by,
        downloaded_by_username: r.username ?? '未知',
        downloaded_at: r.downloaded_at,
        created_at: r.created_at,
        reference_count: Number(r.reference_count) || 0,
      }));

      const response: ListGameVersionsResponse = { versions };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // POST /api/packs/:packId/versions/download — 触发版本下载
  router.post('/:packId/versions/download', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' } });
        return;
      }

      const packId = req.params.packId;
      const pack = registry.load(packId);
      if (!pack) {
        res.status(404).json({ error: { code: 'PACK_NOT_FOUND', message: `Pack 不存在: ${packId}` } });
        return;
      }

      const targetVersion = typeof req.body?.version === 'string' && req.body.version.length > 0
        ? req.body.version
        : undefined;

      const taskId = crypto.randomUUID();
      downloadProgressStore.set(taskId, {
        task_id: taskId,
        phase: 'queued',
        progress_percent: 0,
        message: targetVersion ? `已加入下载队列 (${targetVersion})` : '已加入下载队列',
      });

      // 异步执行下载
      void executeVersionDownload(taskId, pack, userId, db, daemonClient, targetVersion).catch(() => {});

      const response: DownloadVersionResponse = {
        task_id: taskId,
        message: targetVersion ? `正在下载 ${targetVersion}...` : '下载已启动',
      };
      res.status(202).json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // GET /api/packs/:packId/versions/download/progress — 查询下载进度
  router.get('/:packId/versions/download/progress', (req, res) => {
    const taskId = req.query.task_id as string;
    if (!taskId) {
      res.status(400).json({ error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 task_id' } });
      return;
    }
    const progress = downloadProgressStore.get(taskId);
    if (!progress) {
      res.status(404).json({ error: { code: 'PANEL_INTERNAL_ERROR', message: '任务不存在' } });
      return;
    }
    const response: VersionDownloadProgressResponse = {
      task_id: progress.task_id,
      phase: progress.phase,
      progress_percent: progress.progress_percent,
      message: progress.message,
      error: progress.error,
    };
    res.json(response);
  });

  // DELETE /api/packs/:packId/versions/:versionId — 删除版本（仅 server_admin）
  // v3.6.0-A1: 先删磁盘文件再删 DB，daemon rm 失败时 DB 不动
  router.delete('/:packId/versions/:versionId', async (req, res) => {
    try {
      const role = normalizeRole(req.user?.role ?? '');
      if (role !== Role.SERVER_ADMIN) {
        res.status(403).json({ error: { code: 'PANEL_FORBIDDEN', message: '仅系统管理员可删除版本' } });
        return;
      }

      const versionId = req.params.versionId;
      const versionRow = await db<GameVersionRow>('game_versions').where({ id: versionId }).first();
      if (!versionRow) {
        res.status(404).json({ error: { code: 'PANEL_NOT_FOUND', message: '版本不存在' } });
        return;
      }

      // 检查是否有实例引用该版本
      const refCount = await db('servers').where({ version_id: versionId }).count('* as cnt').first();
      if (refCount && (refCount as unknown as { cnt: number }).cnt > 0) {
        res.status(409).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: '该版本仍被实例引用，无法删除' },
        });
        return;
      }

      // v3.6.0-A1: 先删磁盘文件（整个版本目录 instances/_versions/<pack_id>/<version>/）
      // download_path 是文件级路径，取 dirname 得到版本目录
      const versionDir = path.dirname(versionRow.download_path);
      const removeResult = await safeRemoveService.safeRemove({
        namespace: 'versions',
        targetPath: versionDir,
        nodeId: versionRow.node_id,
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

      // 磁盘清理成功后再删 DB
      const deleted = await db('game_versions').where({ id: versionId }).delete();
      const response: DeleteGameVersionResponse = {
        id: versionId,
        deleted: deleted > 0,
        freed_bytes: removeResult.freed_bytes,
      };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 版本下载执行
// ===========================================================================

async function executeVersionDownload(
  taskId: string,
  pack: GamePack,
  userId: string,
  db: Knex,
  daemonClient: DaemonClient,
  targetVersion?: string,
): Promise<void> {
  try {
    // 1. 确定目标版本号
    downloadProgressStore.set(taskId, {
      task_id: taskId,
      phase: 'checking',
      progress_percent: 10,
      message: targetVersion ? `准备下载指定版本 ${targetVersion}...` : '正在检查最新版本...',
    });

    let downloadVersion: string;
    if (targetVersion) {
      // 用户指定了版本，直接使用
      downloadVersion = targetVersion;
    } else {
      // 自动获取最新版本号
      const sourceUrl = pack.update?.source_url ?? pack.versions.manifest_url;
      if (!sourceUrl) {
        throw new Error('Pack 未配置版本源');
      }

      if (sourceUrl.startsWith(STATIC_SOURCE_PREFIX)) {
        const staticSource = resolveStaticSource(sourceUrl);
        if (!staticSource) {
          throw new Error(`静态版本源未配置: ${sourceUrl}`);
        }
        downloadVersion = staticSource.latest.release;
      } else {
        const resp = await fetch(sourceUrl, {
          signal: AbortSignal.timeout(30_000),
        });
        if (!resp.ok) {
          throw new Error(`远程版本源返回 HTTP ${resp.status} ${resp.statusText}`);
        }
        const contentType = resp.headers.get('content-type') ?? '';
        if (!/json/i.test(contentType)) {
          const preview = (await resp.text()).slice(0, 80).replace(/\s+/g, ' ');
          throw new Error(
            `远程版本源 ${sourceUrl} 返回了非 JSON 内容 (Content-Type: ${contentType || '未声明'})，预览: ${preview}`,
          );
        }
        const data = await resp.json() as { latest?: { release?: string } };
        downloadVersion = data.latest?.release ?? '';
      }

      if (!downloadVersion) {
        throw new Error('无法获取最新版本号');
      }
    }

    // 2. 检查是否已下载
    const existing = await db('game_versions')
      .where({ pack_id: pack.pack.id, version: downloadVersion })
      .first();
    if (existing) {
      downloadProgressStore.set(taskId, {
        task_id: taskId,
        phase: 'completed',
        progress_percent: 100,
        message: `版本 ${downloadVersion} 已存在，无需重复下载`,
      });
      return;
    }

    // 3. 渲染下载 URL
    downloadProgressStore.set(taskId, {
      task_id: taskId,
      phase: 'downloading',
      progress_percent: 30,
      message: `正在下载 ${downloadVersion}...`,
    });

    // 获取一个可用节点
    const node = await db('nodes').where({ status: 'online' }).first();
    if (!node) {
      throw new Error('无可用节点');
    }

    const instancesDir = path.resolve(process.env.INSTANCES_DIR ?? './instances');
    const versionsDir = path.resolve(`${instancesDir}/_versions/${pack.pack.id}/${downloadVersion}`);
    const downloadUrl = await resolveDownloadUrlForPool(pack, downloadVersion);
    const fileName = resolveFileName(downloadUrl, pack, downloadVersion);
    const downloadPath = path.resolve(`${versionsDir}/${fileName}`);

    // 创建目录
    await daemonClient.execCommand(node.id, 'system', {
      binary: 'mkdir',
      args: ['-p', versionsDir],
      timeout: 10_000,
    });

    // curl 下载
    await daemonClient.execCommand(node.id, 'system', {
      binary: 'curl',
      args: ['-L', '--fail', '-o', downloadPath, downloadUrl],
      timeout: 600_000,
    });

    // 4. 记录到 game_versions
    downloadProgressStore.set(taskId, {
      task_id: taskId,
      phase: 'downloading',
      progress_percent: 90,
      message: '正在记录版本信息...',
    });

    // v3.6.0-A2: 下载完成后获取文件大小（字节），回填 file_size_bytes
    let fileSizeBytes: number | null = null;
    try {
      const statResp = await daemonClient.execCommand(node.id, 'system', {
        binary: 'stat',
        args: ['-c', '%s', downloadPath],
        timeout: 10_000,
      });
      if (statResp.exit_code === 0 && statResp.stdout) {
        const parsed = parseInt(statResp.stdout.trim(), 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
          fileSizeBytes = parsed;
        }
      }
    } catch {
      // stat 失败不阻断记录写入，file_size_bytes 保持 null
    }

    // v4.12.0: 用 parseVersionFlex 解析,支持 v 前缀/build 号
    const parsed = parseVersionFlex(downloadVersion);
    const now = new Date().toISOString();
    const versionId = crypto.randomUUID();

    await db('game_versions').insert({
      id: versionId,
      pack_id: pack.pack.id,
      version: downloadVersion,
      node_id: node.id,
      download_path: downloadPath,
      file_size_bytes: fileSizeBytes,
      downloaded_by: userId,
      downloaded_at: now,
      version_major: parsed.segments[0] ?? 0,
      version_minor: parsed.segments[1] ?? 0,
      version_patch: parsed.segments[2] ?? 0,
      // v4.12.0: 存储 buildid(如 Steam depot buildid),非 Steam 游戏为 null
      version_buildid: parsed.buildId ?? null,
      created_at: now,
    });

    downloadProgressStore.set(taskId, {
      task_id: taskId,
      phase: 'completed',
      progress_percent: 100,
      message: `版本 ${downloadVersion} 下载完成`,
    });
  } catch (err) {
    downloadProgressStore.set(taskId, {
      task_id: taskId,
      phase: 'failed',
      progress_percent: 0,
      message: '下载失败',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ----- 辅助 -----

function extractVersion(data: unknown): string {
  if (typeof data === 'object' && data !== null) {
    const d = data as Record<string, unknown>;
    const candidates = ['latest_version', 'version', 'tag_name', 'latest_stable', 'stable'];
    for (const key of candidates) {
      if (typeof d[key] === 'string' && d[key].length > 0) return d[key] as string;
    }
    // 嵌套：stable.headless / experimental.headless
    for (const outer of ['stable', 'experimental', 'latest']) {
      const obj = d[outer];
      if (typeof obj === 'object' && obj !== null) {
        const o = obj as Record<string, unknown>;
        for (const inner of ['headless', 'alpha', 'release']) {
          if (typeof o[inner] === 'string' && o[inner].length > 0) return o[inner] as string;
        }
      }
    }
  }
  throw new Error('无法解析版本号');
}

function renderDownloadUrl(pack: GamePack, version: string): string {
  const pattern = pack.versions.download_pattern;
  if (!pattern) {
    throw new Error(`Pack ${pack.pack.id} 未声明 download_pattern`);
  }
  return pattern.replace(/\{\{version\}\}/g, sanitizeTemplateVar(version));
}

/**
 * 为版本池下载解析真实下载 URL。
 * 
 * 支持 types:
 *   - binary/steamcmd 等: 直接渲染 download_pattern 模板（{{version}}）
 *   - server-jar (Minecraft): 通过 Mojang version manifest API 解析真实 server.jar 下载 URL
 *
 * 注意：当前只有 renderDownloadUrl 做 {{version}} 替换，
 * 对于 download_pattern = '{{server_url}}' 的 Pack（如 minecraft-vanilla），
 * 必须走 Mojang API 解析才能获取真实 URL。
 */
async function resolveDownloadUrlForPool(pack: GamePack, version: string): Promise<string> {
  const versionType = pack.versions.type ?? 'binary';

  if (versionType === 'server-jar') {
    const manifestUrl = pack.versions.manifest_url
      ?? 'https://piston-meta.mojang.com/mc/game/version_manifest.json';
    return await resolveMinecraftDownloadUrl(manifestUrl, version);
  }

  // 其他类型：直接用 download_pattern 模板渲染
  return renderDownloadUrl(pack, version);
}

/**
 * 通过 Mojang version manifest API 解析指定版本的 server.jar 下载 URL。
 */
async function resolveMinecraftDownloadUrl(manifestUrl: string, targetVersion: string): Promise<string> {
  const resp = await fetch(manifestUrl, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) {
    throw new Error(`获取 Mojang 版本清单失败: HTTP ${resp.status}`);
  }
  const manifest = (await resp.json()) as {
    versions: Array<{ id: string; url: string }>;
  };
  const entry = manifest.versions.find((v) => v.id === targetVersion);
  if (!entry) {
    throw new Error(`版本 ${targetVersion} 未在 Mojang 清单中找到`);
  }
  const detailResp = await fetch(entry.url, { signal: AbortSignal.timeout(30_000) });
  if (!detailResp.ok) {
    throw new Error(`获取版本详情失败: HTTP ${detailResp.status}`);
  }
  const detail = (await detailResp.json()) as {
    downloads?: { server?: { url: string } };
  };
  const serverUrl = detail.downloads?.server?.url;
  if (!serverUrl) {
    throw new Error(`版本 ${targetVersion} 缺少 server.jar 下载 URL`);
  }
  return serverUrl;
}

function resolveFileName(downloadUrl: string, pack: GamePack, version: string): string {
  try {
    const urlObj = new URL(downloadUrl);
    const lastSegment = urlObj.pathname.split('/').filter(Boolean).pop();
    if (lastSegment && /\.[A-Za-z0-9]{1,8}$/.test(lastSegment) && !lastSegment.includes('?')) {
      return lastSegment;
    }
  } catch { /* ignore */ }
  const vt = pack.versions.type ?? 'binary';
  const ext = vt === 'server-jar' ? '.jar' : '.tar.gz';
  return `${pack.pack.id}-${version}${ext}`;
}

// v4.12.0: parseVersion 已迁移到 versionCompare.ts 的 parseVersionFlex(支持 v 前缀/build 号)
// 旧的 parseVersion 函数已移除,所有调用方改用 parseVersionFlex 或 compareVersions。

function handleInternal(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
