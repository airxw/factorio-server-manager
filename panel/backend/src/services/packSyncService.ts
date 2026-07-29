// ============================================================================
// packSyncService — v4.22.0 Pack 三种来源同步服务
//
// 设计目标：
//   Setup Wizard v2 「Pack 配置」步骤中，用户从三种来源同步 Pack：
//     1. GitHub 同步（默认 airxw/GSP-Panel 仓库的 packs/ 目录）
//     2. 自定义 URL 同步（git URL 或 tarball URL）
//     3. 手动上传 zip
//
// 核心能力：
//   - syncFromGithub(repo, ref): 从 GitHub 下载 tarball 并同步 packs/ 子目录
//   - syncFromUrl(url): 从 git URL 或 tarball URL 同步 packs/
//   - uploadZip(fileBuffer, filename): 解压 zip 并验证 pack.yaml 后入库
//
// 同步策略（重要）：
//   - 仅覆盖同名 pack，不删除用户自定义 pack（保留既有部署的定制 pack）
//   - 同步完成后调用 packRegistry.loadFromDir(packsDir) 重新加载注册表
//
// 来源：v4.22.0 Setup Wizard Pack 三种来源同步模块
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import AdmZip from 'adm-zip';
import yaml from 'js-yaml';
import type { PackRegistry } from '../core/packs/registry.js';
import type {
  PackSummary,
  PackSyncConfig,
  SyncPacksResponse,
  UploadPackResponse,
} from '@public/schema/panel-api-types';

/** 同步结果（内部使用，对外通过 SyncPacksResponse 返回） */
export interface PackSyncResult {
  ok: boolean;
  synced_count?: number;
  packs?: PackSummary[];
  error?: string;
}

/** 上传结果 */
export interface PackUploadResult {
  ok: boolean;
  upload_id?: string;
  pack_id?: string;
  error?: string;
}

export interface PackSyncServiceDeps {
  /**
   * 是否跳过 shell 命令执行（测试时注入；生产留空用真实 execSync）
   * - undefined / false：用真实 execSync 执行 curl/tar/git
   * - function：测试时注入 mock 执行函数
   */
  execFn?: typeof execSync;
}

/** GitHub tarball 下载超时（秒）——避免网络问题导致向导长时间挂起 */
const GITHUB_CURL_TIMEOUT_SEC = 60;

export class PackSyncService {
  private readonly execFn: typeof execSync;

  constructor(
    private readonly packsDir: string,
    private readonly packRegistry: PackRegistry,
    deps: PackSyncServiceDeps = {},
  ) {
    this.execFn = deps.execFn ?? execSync;
  }

  /**
   * 从 GitHub 仓库同步 packs/ 目录
   *
   * 实现策略：
   *   1. 下载 tarball：先尝试 refs/heads/<ref>（分支），失败再尝试 refs/tags/<ref>（tag）
   *   2. 解压到临时目录
   *   3. 找到 <repo>-<ref>/packs/ 子目录（GitHub tarball 顶层目录名为 <RepoName>-<ref>）
   *   4. 同步到本地 packsDir（仅覆盖同名 pack，不删除用户自定义）
   *   5. 调用 packRegistry.loadFromDir(packsDir) 重新加载
   *
   * @param repo 格式 `owner/repo`（如 `airxw/GSP-Panel`）
   * @param ref 分支或 Tag（如 `main`、`v4.22.0`）
   */
  async syncFromGithub(repo: string, ref: string): Promise<PackSyncResult> {
    // 参数校验
    if (!repo || typeof repo !== 'string' || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
      return { ok: false, error: `仓库地址格式非法（应为 owner/repo，实际: ${repo}）` };
    }
    if (!ref || typeof ref !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(ref)) {
      return { ok: false, error: `分支/Tag 格式非法: ${ref}` };
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsp-pack-sync-gh-'));
    try {
      // 1. 下载 tarball——先尝试分支，失败再尝试 tag
      const tarballPath = path.join(tmpDir, 'repo.tar.gz');
      const branchUrl = `https://github.com/${repo}/archive/refs/heads/${ref}.tar.gz`;
      const tagUrl = `https://github.com/${repo}/archive/refs/tags/${ref}.tar.gz`;

      let downloaded = false;
      let lastError = '';
      for (const url of [branchUrl, tagUrl]) {
        try {
          // -f: HTTP 错误返回非零退出码
          // -sS: 静默模式但显示错误
          // -L: 跟随重定向
          // --max-time: 超时秒数
          this.execFn(
            `curl -fsSL --max-time ${GITHUB_CURL_TIMEOUT_SEC} -o "${tarballPath}" "${url}"`,
            { stdio: 'pipe' },
          );
          downloaded = true;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          // 继续尝试下一个 URL
        }
      }
      if (!downloaded) {
        return {
          ok: false,
          error: `下载 GitHub tarball 失败（已尝试分支和 Tag）：${lastError}`,
        };
      }

      // 2. 解压 tarball
      this.execFn(`tar -xzf "${tarballPath}" -C "${tmpDir}"`, { stdio: 'pipe' });

      // 3. 找到 packs/ 子目录
      //    GitHub tarball 顶层目录名格式：<RepoName>-<ref>
      //    （ref 中的 / 会被替换为 -，例如 ref=feature/x → 目录名 <Repo>-feature-x）
      const refNormalized = ref.replace(/\//g, '-');
      const repoName = repo.split('/')[1];
      const expectedDir = `${repoName}-${refNormalized}`;

      // 在 tmpDir 下查找匹配的顶层目录（容错：若精确名称不匹配，取第一个目录）
      const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
      const topDir = entries.find((e) => e.isDirectory() && e.name === expectedDir)
        ?? entries.find((e) => e.isDirectory() && e.name.startsWith(`${repoName}-`));
      if (!topDir) {
        return { ok: false, error: `解压后未找到顶层目录（期望: ${expectedDir}）` };
      }

      const sourcePacksDir = path.join(tmpDir, topDir.name, 'packs');
      if (!fs.existsSync(sourcePacksDir)) {
        return {
          ok: false,
          error: `仓库 ${repo}（ref=${ref}）中未找到 packs/ 子目录`,
        };
      }

      // 4. 同步到本地 packsDir
      const synced = this.syncPacksDir(sourcePacksDir);

      // 5. 重新加载注册表
      this.packRegistry.loadFromDir(this.packsDir);

      return {
        ok: true,
        synced_count: synced,
        packs: this.listPacks(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `GitHub 同步失败: ${message}` };
    } finally {
      // 清理临时目录
      this.cleanupTmpDir(tmpDir);
    }
  }

  /**
   * 从自定义 URL 同步（git URL 或 tarball URL）
   *
   * 实现策略：
   *   - url 以 .git 结尾：git clone --depth 1 <url> <tmp>，然后复制 packs/ 子目录
   *   - 否则：当作 tarball URL 下载并解压
   *
   * @param url git URL（如 https://github.com/owner/repo.git）或 tarball URL
   */
  async syncFromUrl(url: string): Promise<PackSyncResult> {
    if (!url || typeof url !== 'string') {
      return { ok: false, error: 'URL 不能为空' };
    }
    // 安全校验：仅允许 http/https 协议（防止 file:// 等协议被滥用）
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'URL 必须以 http:// 或 https:// 开头' };
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsp-pack-sync-url-'));
    try {
      let sourcePacksDir: string | null;

      if (url.endsWith('.git')) {
        // git clone 模式
        const cloneDir = path.join(tmpDir, 'repo');
        try {
          this.execFn(
            `git clone --depth 1 "${url}" "${cloneDir}"`,
            { stdio: 'pipe', timeout: GITHUB_CURL_TIMEOUT_SEC * 1000 },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { ok: false, error: `git clone 失败: ${message}` };
        }
        sourcePacksDir = path.join(cloneDir, 'packs');
      } else {
        // tarball 模式
        const tarballPath = path.join(tmpDir, 'repo.tar.gz');
        try {
          this.execFn(
            `curl -fsSL --max-time ${GITHUB_CURL_TIMEOUT_SEC} -o "${tarballPath}" "${url}"`,
            { stdio: 'pipe' },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { ok: false, error: `下载 tarball 失败: ${message}` };
        }

        // 解压
        try {
          this.execFn(`tar -xzf "${tarballPath}" -C "${tmpDir}"`, { stdio: 'pipe' });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { ok: false, error: `解压 tarball 失败: ${message}（请确认 URL 指向合法的 .tar.gz 文件）` };
        }

        // 查找 packs/ 子目录——可能位于顶层目录下，也可能直接在 tmpDir 下
        sourcePacksDir = this.findPacksSubdir(tmpDir);
      }

      if (!sourcePacksDir || !fs.existsSync(sourcePacksDir)) {
        return {
          ok: false,
          error: `未在 URL 内容中找到 packs/ 子目录（期望根目录或顶层目录下包含 packs/）`,
        };
      }

      // 同步到本地
      const synced = this.syncPacksDir(sourcePacksDir);

      // 重新加载注册表
      this.packRegistry.loadFromDir(this.packsDir);

      return {
        ok: true,
        synced_count: synced,
        packs: this.listPacks(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `URL 同步失败: ${message}` };
    } finally {
      this.cleanupTmpDir(tmpDir);
    }
  }

  /**
   * 上传 zip 并解压到 packs/ 目录
   *
   * 实现策略：
   *   1. 用 adm-zip 解压到临时目录
   *   2. 验证 pack.yaml 存在（位于根目录或唯一子目录中）
   *   3. 读取 pack.yaml 解析 pack_id
   *   4. 复制到 packsDir/<pack-id>/
   *   5. 调用 packRegistry.loadFromDir(packsDir) 重新加载
   *
   * @param fileBuffer zip 文件内容（multer memoryStorage 提供）
   * @param filename 原始文件名（仅用于错误信息，不作为 pack_id 来源）
   */
  async uploadZip(fileBuffer: Buffer, filename: string): Promise<PackUploadResult> {
    const uploadId = crypto.randomUUID();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsp-pack-upload-'));
    try {
      // 1. 解压 zip
      let zip: AdmZip;
      try {
        zip = new AdmZip(fileBuffer);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, upload_id: uploadId, error: `zip 文件解析失败: ${message}` };
      }

      try {
        zip.extractAllTo(tmpDir, true);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, upload_id: uploadId, error: `zip 解压失败: ${message}` };
      }

      // 2. 定位 pack.yaml——支持两种结构：
      //    a) pack.yaml 位于 zip 根目录
      //    b) pack.yaml 位于 zip 内唯一子目录中
      let packYamlPath: string | null = null;
      let packBaseDir: string = tmpDir; // pack.yaml 所在目录（作为复制源）

      const rootEntries = fs.readdirSync(tmpDir, { withFileTypes: true });
      const rootYaml = rootEntries.find(
        (e) => e.isFile() && (e.name === 'pack.yaml' || e.name === 'pack.yml'),
      );
      if (rootYaml) {
        packYamlPath = path.join(tmpDir, rootYaml.name);
        packBaseDir = tmpDir;
      } else {
        // 在子目录中查找 pack.yaml
        const subDirs = rootEntries.filter((e) => e.isDirectory());
        // 优先查找包含 pack.yaml 的子目录
        for (const sub of subDirs) {
          const candidate = path.join(tmpDir, sub.name, 'pack.yaml');
          const candidateYml = path.join(tmpDir, sub.name, 'pack.yml');
          if (fs.existsSync(candidate)) {
            packYamlPath = candidate;
            packBaseDir = path.join(tmpDir, sub.name);
            break;
          } else if (fs.existsSync(candidateYml)) {
            packYamlPath = candidateYml;
            packBaseDir = path.join(tmpDir, sub.name);
            break;
          }
        }
      }

      if (!packYamlPath) {
        return {
          ok: false,
          upload_id: uploadId,
          error: `zip 中未找到 pack.yaml（已检查根目录和一级子目录）`,
        };
      }

      // 3. 解析 pack_id（从 pack.yaml 读取）
      let packId: string;
      try {
        const yamlContent = fs.readFileSync(packYamlPath, 'utf8');
        const parsed = yaml.load(yamlContent) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { ok: false, upload_id: uploadId, error: 'pack.yaml 内容无效（非对象）' };
        }
        const packField = (parsed as { pack?: { id?: unknown } }).pack;
        if (!packField || typeof packField !== 'object') {
          return { ok: false, upload_id: uploadId, error: 'pack.yaml 缺少 pack 字段' };
        }
        const id = (packField as { id?: unknown }).id;
        if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id) || id.length === 0 || id.length > 64) {
          return {
            ok: false,
            upload_id: uploadId,
            error: `pack.yaml 中 pack.id 格式非法（仅允许字母数字、连字符、下划线，长度 1-64）`,
          };
        }
        packId = id;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, upload_id: uploadId, error: `pack.yaml 解析失败: ${message}` };
      }

      // 4. 复制到 packsDir/<pack-id>/（覆盖同名 pack）
      const targetDir = path.join(this.packsDir, packId);
      // 确保父目录存在
      if (!fs.existsSync(this.packsDir)) {
        fs.mkdirSync(this.packsDir, { recursive: true });
      }
      // 覆盖前先删除旧目录
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      fs.mkdirSync(targetDir, { recursive: true });

      // 复制 packBaseDir 下所有内容到 targetDir
      this.copyDirContents(packBaseDir, targetDir);

      // 5. 重新加载注册表
      this.packRegistry.loadFromDir(this.packsDir);

      return {
        ok: true,
        upload_id: uploadId,
        pack_id: packId,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        upload_id: uploadId,
        error: `上传失败（文件: ${filename}）: ${message}`,
      };
    } finally {
      this.cleanupTmpDir(tmpDir);
    }
  }

  // ===========================================================================
  // 内部辅助方法
  // ===========================================================================

  /**
   * 同步源 packs 目录到本地 packsDir。
   * 策略：仅覆盖同名 pack（即源目录中存在的 pack），不删除本地仅有的 pack。
   *
   * @param sourcePacksDir 源 packs/ 目录（包含多个 pack 子目录或 .yaml 文件）
   * @returns 实际同步的 pack 数量
   */
  private syncPacksDir(sourcePacksDir: string): number {
    if (!fs.existsSync(this.packsDir)) {
      fs.mkdirSync(this.packsDir, { recursive: true });
    }

    let synced = 0;
    const entries = fs.readdirSync(sourcePacksDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // 子目录形式的 pack（如 packs/minecraft-vanilla/）
        const sourcePackDir = path.join(sourcePacksDir, entry.name);
        const sourceYaml = path.join(sourcePackDir, 'pack.yaml');
        if (!fs.existsSync(sourceYaml)) {
          continue; // 跳过非 pack 目录
        }
        const targetPackDir = path.join(this.packsDir, entry.name);
        // 覆盖同名 pack
        if (fs.existsSync(targetPackDir)) {
          fs.rmSync(targetPackDir, { recursive: true, force: true });
        }
        fs.mkdirSync(targetPackDir, { recursive: true });
        this.copyDirContents(sourcePackDir, targetPackDir);
        synced++;
      } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
        // 根目录散放的 .yaml pack 文件
        const sourceFile = path.join(sourcePacksDir, entry.name);
        const targetFile = path.join(this.packsDir, entry.name);
        fs.copyFileSync(sourceFile, targetFile);
        synced++;
      }
    }

    return synced;
  }

  /**
   * 在临时目录中查找 packs/ 子目录。
   * 优先级：
   *   1. tmpDir/packs/
   *   2. tmpDir/<任意顶层目录>/packs/
   */
  private findPacksSubdir(tmpDir: string): string | null {
    // 1. 直接在 tmpDir 下找 packs/
    const directPacks = path.join(tmpDir, 'packs');
    if (fs.existsSync(directPacks) && fs.statSync(directPacks).isDirectory()) {
      return directPacks;
    }

    // 2. 在一级子目录下找 packs/
    const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const candidate = path.join(tmpDir, entry.name, 'packs');
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
          return candidate;
        }
      }
    }
    return null;
  }

  /**
   * 复制源目录下所有内容到目标目录（递归）。
   * 目标目录必须已存在。
   */
  private copyDirContents(srcDir: string, destDir: string): void {
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        this.copyDirContents(srcPath, destPath);
      } else if (entry.isFile()) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * 清理临时目录（best-effort，失败不影响主流程）
   */
  private cleanupTmpDir(tmpDir: string): void {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
  }

  /**
   * 列出当前注册表中所有 Pack 摘要（与 packs.ts 路由的 listAll 逻辑对齐）
   */
  private listPacks(): PackSummary[] {
    return this.packRegistry.listAll().map((p) => ({
      id: p.pack.id,
      game: p.pack.game,
      variant: p.pack.variant,
      display_name: p.pack.display_name,
      version: p.pack.version,
      ui_tabs: p.ui?.tabs,
    }));
  }
}

/**
 * 工厂函数——供 routes-registry 注入时调用
 */
export function createPackSyncService(
  packsDir: string,
  packRegistry: PackRegistry,
  deps: PackSyncServiceDeps = {},
): PackSyncService {
  return new PackSyncService(packsDir, packRegistry, deps);
}

// ============================================================================
// 类型重导出（供路由层 import）
// ============================================================================

export type { PackSyncConfig, SyncPacksResponse, UploadPackResponse };
