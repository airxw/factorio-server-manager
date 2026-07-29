// ============================================================================
// updateService — 游戏更新服务（Task 8 新建）
//
// 职责：
//   - checkUpdate(serverId) — 请求 Pack update.source_url 获取 latest_version，
//                              通过 current_version_command 获取当前版本，比对返回
//   - applyUpdate(serverId) — 执行 install_command 应用更新
//
// 依赖：
//   - PackRegistry（读 Pack.update 配置）
//   - DaemonClient（通过 execCommand 执行版本查询/安装命令）
//
// 数据契约：public/schema/pack-schema.ts PackUpdate
// ============================================================================

import path from 'node:path';
import type { Knex } from 'knex';
import type { DaemonClient } from '@public/interface_stub/daemon-client';
import type { PackRegistry } from '../core/packs/registry.js';
import type { GamePack, PackUpdate } from '@public/schema/pack-schema';
import type { ExecCommandResponse } from '@public/schema/daemon-api-types';
import type { UpdatePhase } from '@public/schema/panel-api-types';
import {
  InstanceNotFoundError,
  PackNotFoundError,
  PackCapabilityNotDeclaredError,
  UpdateCheckError,
  UpdateApplyError,
} from './errors.js';
// D10: 引入命令注入防护工具函数
import { sanitizeTemplateVar } from './commandDispatcher.js';
import {
  resolveStaticSource,
  STATIC_SOURCE_PREFIX,
} from '../core/packs/staticVersions.js';
// v4.12.0: VersionProvider 工厂(步骤 1 版本源真实化重构)
import { getProvider } from '../core/packs/versionProviders/index.js';
// v4.12.0: 版本号规范化解析与比对(步骤 2)
import { compareVersions } from '../core/packs/versionCompare.js';

// ----- Server 行类型 -----

interface ServerRow {
  id: string;
  pack_id: string;
  node_id: string;
}

// ----- 更新检查结果 -----

export interface UpdateCheckResult {
  current_version: string | null;
  latest_version: string | null;
  update_available: boolean;
}

// ----- 更新进度状态 -----

export interface UpdateProgressState {
  server_id: string;
  phase: UpdatePhase;
  progress_percent: number;
  message: string;
  error?: string;
  download_path?: string;
  latest_version?: string;
  started_at?: string;
  finished_at?: string;
}

const progressStore = new Map<string, UpdateProgressState>();

// ----- 服务实现 -----

export class UpdateServiceImpl {
  constructor(
    private readonly db: Knex,
    private readonly registry: PackRegistry,
    private readonly daemonClient: DaemonClient,
  ) {}

  /** 获取某实例的更新进度 */
  getProgress(serverId: string): UpdateProgressState {
    const existing = progressStore.get(serverId);
    if (existing) return existing;
    return {
      server_id: serverId,
      phase: 'idle',
      progress_percent: 0,
      message: '未开始',
    };
  }

  /** 设置进度状态（内部辅助） */
  private setProgress(
    serverId: string,
    phase: UpdatePhase,
    message: string,
    extras: Partial<UpdateProgressState> = {},
  ): void {
    const current = progressStore.get(serverId);
    const now = new Date().toISOString();
    progressStore.set(serverId, {
      server_id: serverId,
      phase,
      progress_percent: extras.progress_percent ?? current?.progress_percent ?? 0,
      message,
      error: extras.error,
      download_path: extras.download_path ?? current?.download_path,
      latest_version: extras.latest_version ?? current?.latest_version,
      started_at: phase === 'checking' ? now : current?.started_at,
      finished_at: (phase === 'completed' || phase === 'failed') ? now : current?.finished_at,
      ...extras,
    });
  }

  /**
   * 启动异步下载并安装更新（立即返回，后台执行）
   * @param serverId 实例 ID
   */
  startDownloadUpdate(serverId: string): void {
    const current = progressStore.get(serverId);
    if (current && (current.phase === 'checking' || current.phase === 'downloading' || current.phase === 'installing')) {
      return;
    }
    void this.downloadUpdateAsync(serverId);
  }

  /**
   * 异步执行下载并安装，过程中更新进度状态
   */
  private async downloadUpdateAsync(serverId: string): Promise<void> {
    try {
      const result = await this.downloadUpdate(serverId);
      this.setProgress(serverId, 'completed', '更新完成', {
        progress_percent: 100,
        download_path: result.download_path,
        latest_version: result.latest_version,
      });
    } catch (err) {
      this.setProgress(serverId, 'failed', '更新失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 检查游戏更新（Task 8.2）。
   *
   * 步骤：
   *   1. 请求 Pack update.source_url 获取 latest_version（HTTP GET，解析返回）
   *   2. 通过 daemonClient.execCommand 执行 current_version_command 获取当前版本
   *   3. 比对返回 { current_version, latest_version, update_available }
   *
   * P0 简化：source_url 返回 JSON，解析 latest_version 字段；不同游戏 API 格式不同，
   *           这里仅做通用解析（latest_version / version / tag_name 字段优先）。
   *
   * 容错策略：current_version_command 失败时（实例从未启动、binary 不存在、daemon
   *   报 Instance not found 等），不抛错，而是返回 current_version=null。这样用户仍能
   *   看到 latest_version 并使用"一键下载并安装"按钮下载游戏服务端。
   *
   * @throws {PackCapabilityNotDeclaredError} Pack 未声明 update
   * @throws {UpdateCheckError} source_url 请求失败或版本解析失败
   */
  async checkUpdate(serverId: string): Promise<UpdateCheckResult> {
    const { pack, nodeId } = await this.resolveServerPackWithUpdate(serverId);
    const { update, degraded } = this.resolveUpdate(pack);
    // B2: 降级模式下记录 warn（不阻断 checkUpdate，降级模式仍可获取最新版本号）
    if (degraded) {
      console.warn(
        `[updateService] Pack ${pack.pack.id} 未声明 update，已从 versions.manifest_url 降级读取（仅支持查看最新版本，不支持安装）`,
      );
    }

    // 1. 获取 latest_version
    //    v4.12.0: 优先使用 VersionProvider(步骤 1 版本源真实化重构),
    //    未声明 provider 或 Provider 不可用时回退到 legacy source_url HTTP fetch。
    //    失败则整体失败,因为没有 latest_version 无法判断更新。
    let latestVersion: string;
    try {
      latestVersion = await this.fetchLatestVersion(pack, update.source_url, nodeId, serverId);
    } catch (err) {
      throw new UpdateCheckError(
        `获取最新版本失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 2. 通过 current_version_command 获取当前版本（失败时返回 null，不阻断检查流程）
    //    典型失败场景：实例从未启动（daemon 未注册 → Instance not found）、
    //    binary 未下载（bootstrapInstance 未执行）、执行超时等。
    //    此时 current_version 未知，但用户仍可看到 latest_version 并使用一键下载。
    let currentVersion: string | null;
    try {
      currentVersion = await this.executeVersionCommand(pack, update, nodeId, serverId);
    } catch (err) {
      // 记录警告但不抛错：current_version 未知，update_available 设为 true 鼓励下载
      currentVersion = null;
    }

    // current_version 未知时，只要有 latest_version 就视为"有更新可下载"
    // v4.12.0: 版本比对改用 compareVersions(支持 v 前缀/build 号),
    //   不再用字符串 !== 比对(原逻辑因 v 前缀/buildid 格式不一致而永远误报更新)。
    //   Steam 游戏(type=steamcmd)的精确更新判断由步骤 3 的 SteamCMD dry-run 接管,
    //   此处仅做可读版本号比对作为参考(current_version 未知时仍鼓励下载)。
    const updateAvailable = currentVersion === null
      ? latestVersion !== null
      : compareVersions(currentVersion, latestVersion) !== 0;

    return {
      current_version: currentVersion,
      latest_version: latestVersion,
      update_available: updateAvailable,
    };
  }

  /**
   * 应用游戏更新（Task 8.3）。
   *
   * @deprecated v3.5.0: 推荐使用 applyVersionFromPool，从版本池选版本应用。
   *   本方法保留向后兼容，供旧客户端通过 download_path 调用。
   * @param serverId 实例 ID
   * @param downloadPath 已下载文件的绝对路径（用于渲染 {{download_path}} 变量）
   */
  async applyUpdate(serverId: string, downloadPath: string): Promise<ExecCommandResponse> {
    return this.installCommandForPath(serverId, downloadPath);
  }

  /**
   * v3.5.0: 从版本池（game_versions）选版本应用到实例。
   *
   * 流程：
   *   1. 校验 versionId 存在于 game_versions，且 pack_id / node_id 与 servers 记录一致
   *   2. 进度 instaling 0% → 调 installCommandForPath → completed 100%
   *   3. 更新 servers.current_version + servers.version_id
   *
   * @param serverId 实例 ID
   * @param versionId game_versions 表中的版本记录 ID
   * @returns installed_version
   * @throws PANEL_VALIDATION_ERROR 版本不存在/跨 Pack/跨节点
   * @throws UpdateApplyError 安装失败
   */
  async applyVersionFromPool(
    serverId: string,
    versionId: string,
  ): Promise<{ installed_version: string }> {
    // 1. 查 servers 行
    const serverRow = await this.db<ServerRow>('servers').where({ id: serverId }).first();
    if (!serverRow) {
      throw new InstanceNotFoundError(`实例不存在: ${serverId}`);
    }

    // 2. 查 game_versions 行
    const versionRow = await this.db<{
      id: string;
      pack_id: string;
      node_id: string;
      version: string;
      download_path: string;
    }>('game_versions').where({ id: versionId }).first();
    if (!versionRow) {
      throw new UpdateApplyError(`版本记录不存在: ${versionId}`);
    }

    // 3. 校验 pack_id 一致
    if (versionRow.pack_id !== serverRow.pack_id) {
      throw new UpdateApplyError(
        `版本 ${versionRow.version} 属于 Pack ${versionRow.pack_id}，但实例归属 ${serverRow.pack_id}，无法跨 Pack 应用`,
      );
    }

    // 4. 校验 node_id 一致
    if (versionRow.node_id !== serverRow.node_id) {
      throw new UpdateApplyError(
        `版本 ${versionRow.version} 下载在节点 ${versionRow.node_id}，但实例在 ${serverRow.node_id}，无法跨节点应用`,
      );
    }

    // 5. 执行安装
    this.setProgress(serverId, 'installing', `正在安装 ${versionRow.version}...`, { progress_percent: 0 });
    await this.installCommandForPath(serverId, versionRow.download_path);
    this.setProgress(serverId, 'completed', '安装完成', {
      progress_percent: 100,
      download_path: versionRow.download_path,
      latest_version: versionRow.version,
    });

    // 6. 更新 servers.current_version / version_id
    const now = new Date().toISOString();
    await this.db('servers').where({ id: serverId }).update({
      current_version: versionRow.version,
      version_id: versionId,
      last_activity_at: now,
    });

    return { installed_version: versionRow.version };
  }

  /**
   * 私有：渲染并执行 Pack install_command。
   *
   * 从 applyUpdate 提取，避免与 applyVersionFromPool 重复。
   */
  private async installCommandForPath(
    serverId: string,
    downloadPath: string,
  ): Promise<ExecCommandResponse> {
    const { pack, nodeId } = await this.resolveServerPackWithUpdate(serverId);
    const { update, degraded } = this.resolveUpdate(pack);
    if (degraded) {
      console.warn(
        `[updateService] Pack ${pack.pack.id} 降级模式：install_command 为占位命令，执行可能失败`,
      );
    }

    // 渲染 install_command
    // 注意：daemon 的 exec 端点 (POST /api/instances/:id/exec) 会将 cwd 设置为实例 workdir
    // （由 resolveInstanceWorkdir 解析为绝对路径 /opt/.../instances/<id> 并自动创建）。
    // 因此 install_command 中所有相对路径均以实例 workdir 为基准。
    // 历史 bug：曾将 instance_root 设为 './instances/<id>'，导致 cp 目标解析为
    //   <workdir>/instances/<id>/server.jar（双重嵌套），server.jar 未落到实例根目录。
    // 修复：instance_root 设为 '.'，使模板渲染出 'cp <src> ./server.jar'，
    //   mkdir 也不再创建嵌套 instances/<id>（workdir 由 daemon 兜底创建）。
    let instanceRootAbs = '.';
    try {
      const pwdResult = await this.daemonClient.execCommand(nodeId, serverId, {
        binary: 'pwd',
        args: [],
        timeout: 5_000,
      });
      if (pwdResult.exit_code === 0 && pwdResult.stdout.trim()) {
        instanceRootAbs = pwdResult.stdout.trim();
      }
    } catch {
      // 获取绝对路径失败不阻断，使用 '.' 作为 fallback
    }

    // 阶段1：构造不含 download_dir 的基础 vars（用于渲染 download_dir 本身可能含的 {{instance_root}} 等变量）
    const baseVars: Readonly<Record<string, string>> = {
      binary: pack.startup.binary,
      download_path: path.isAbsolute(downloadPath) ? downloadPath : path.resolve(downloadPath),
      instance_root: '.',
      instance_root_abs: instanceRootAbs,
    };
    // download_dir 可能含 {{instance_root}} 模板变量，先用 baseVars 渲染为相对 workdir 的路径（如 ./bin）
    const renderedDownloadDir = renderTemplate(update.download_dir, baseVars);

    // 阶段2：构造完整 vars，download_dir 使用已渲染值
    // 修复：renderTemplate 单次替换不递归，若 install_command 引用 {{download_dir}}，
    // 而 vars.download_dir 仍为原始 '{{instance_root}}/bin'，会留下字面量 {{instance_root}} 传给 tar。
    const vars: Readonly<Record<string, string>> = {
      ...baseVars,
      download_dir: renderedDownloadDir,
    };

    // 确保 download_dir 存在（instance workdir 由 daemon resolveInstanceWorkdir 兜底创建，此处无需再 mkdir）
    if (renderedDownloadDir && renderedDownloadDir !== '.') {
      try {
        await this.daemonClient.execCommand(nodeId, serverId, {
          binary: 'mkdir',
          args: ['-p', renderedDownloadDir],
          timeout: 10_000,
        });
      } catch {
        // 目录创建失败不阻断，执行 install_command 本身会给出明确错误
      }
    }

    const installCommand = update.install_command;
    if (!installCommand) {
      throw new UpdateApplyError(
        `Pack ${pack.pack.id} 未声明 update.install_command(Steam 游戏应由 steam-install 流程接管,不应走到此分支)`,
      );
    }
    const renderedCmd = renderTemplate(installCommand, vars);
    const tokens = tokenize(renderedCmd);
    if (tokens.length === 0) {
      throw new UpdateApplyError('install_command 渲染后为空');
    }
    const [binary, ...args] = tokens;

    let result: ExecCommandResponse;
    try {
      result = await this.daemonClient.execCommand(nodeId, serverId, {
        binary,
        args,
        timeout: 300_000,
      });
    } catch (err) {
      throw new UpdateApplyError(
        `执行 install_command 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (result.timed_out) {
      throw new UpdateApplyError('安装超时（300s）');
    }
    if (result.exit_code !== 0) {
      throw new UpdateApplyError(
        `安装失败 exit=${result.exit_code}: ${result.stderr.slice(0, 500)}`,
      );
    }
    return result;
  }

  /**
   * 一键自动下载并安装游戏更新（用户明确要求）。
   *
   * 流程：
   *   1. 调用 checkUpdate 获取 latest_version
   *   2. 根据 Pack.versions.type 分派下载策略：
   *      - 'binary'/'stream'/'github_release' → 渲染 download_pattern 模板
   *      - 'server-jar' → 通过 Mojang API 解析下载URL
   *      - 'steamcmd'    → 通过 steamcmd 下载
   *   3. 通过 daemon execCommand 执行 curl 下载到 download_dir
   *   4. 调用 applyUpdate(serverId, downloadPath) 执行 install_command
   *
   * @param serverId 实例 ID
   * @returns 下载并安装结果
   * @throws {UpdateCheckError} checkUpdate 失败
   * @throws {UpdateApplyError} 下载或安装失败
   */
  async downloadUpdate(serverId: string): Promise<{
    downloaded: boolean;
    applied: boolean;
    download_path: string;
    latest_version: string;
  }> {
    const { pack, nodeId } = await this.resolveServerPackWithUpdate(serverId);
    const { update, degraded } = this.resolveUpdate(pack);
    if (degraded) {
      console.warn(
        `[updateService] Pack ${pack.pack.id} 降级模式：downloadUpdate 使用占位命令，可能失败`,
      );
    }

    // 1. 检查更新获取 latest_version
    this.setProgress(serverId, 'checking', '正在检查更新...', { progress_percent: 5 });
    const checkResult = await this.checkUpdate(serverId);
    if (!checkResult.latest_version) {
      throw new UpdateCheckError(
        '无法获取最新版本号（source_url 解析失败），无法生成下载 URL',
      );
    }
    const latestVersion = checkResult.latest_version;

    const instancesDir = process.env.INSTANCES_DIR ?? './instances';
    const instanceRoot = `${instancesDir}/${serverId}`;
    const downloadDir = renderTemplate(update.download_dir, {
      instance_root: instanceRoot,
      binary: pack.startup.binary,
    });
    const normalizedDownloadDir = downloadDir.replace(/\/$/, '');

    // 2. 按 versions.type 分派下载策略获取 downloadUrl
    this.setProgress(serverId, 'checking', '正在解析下载地址...', {
      progress_percent: 10,
      latest_version: latestVersion,
    });
    const downloadUrl = await this.resolveDownloadUrl(pack, latestVersion);

    // v4.12.0(步骤 3):Steam 游戏(steamcmd:// 协议)走 SteamCMD 安装流程,
    // 不走 curl 下载 + install_command,SteamCMD 自身完成下载+安装+校验。
    if (downloadUrl.startsWith('steamcmd://')) {
      return this.executeSteamCmdInstall(pack, serverId, nodeId, latestVersion);
    }

    // v4.3.0-G1: 构建镜像源 URL 列表（主源 + Pack.update.mirror_sources）
    //   流程：主源下载 → 失败则按 mirror_sources 顺序逐个尝试
    //   每个镜像源也是 download_pattern 模板，需按相同 vars 渲染
    const mirrorUrls = this.resolveMirrorUrls(pack, update, latestVersion, downloadUrl);

    // 2.1 根据实际下载 URL 决定文件名后缀（避免硬编码 .tar.gz 导致 server.jar 下载失败）
    //     优先从 URL 路径提取文件名；提取失败时按 versions.type 选择合理后缀
    const fileName = resolveDownloadFileName(downloadUrl, pack, latestVersion);
    const downloadPath = `${normalizedDownloadDir}/${fileName}`;

    // 2.2 通过 daemon execCommand 创建下载目录（避免 exit=23: 没有那个文件或目录）
    //     使用 mkdir -p 确保父目录存在，忽略已存在错误
    try {
      await this.daemonClient.execCommand(nodeId, serverId, {
        binary: 'mkdir',
        args: ['-p', normalizedDownloadDir],
        timeout: 10_000,
      });
    } catch (err) {
      // 目录创建失败不立即抛错，继续尝试下载（curl 失败时会给出明确错误）
      console.warn(
        `[updateService] mkdir downloads 目录失败（继续尝试下载）: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 3. 通过 daemon execCommand 执行 curl 下载
    //    v4.3.0-G1: 支持多镜像源回退——主源失败后逐个尝试 mirror_sources
    this.setProgress(serverId, 'downloading', '正在下载游戏文件...', {
      progress_percent: 20,
      download_path: downloadPath,
      latest_version: latestVersion,
    });
    const downloadErrors: string[] = [];
    let downloadSucceeded = false;
    for (let i = 0; i < mirrorUrls.length; i++) {
      const url = mirrorUrls[i];
      this.setProgress(serverId, 'downloading', `正在下载游戏文件（源 ${i + 1}/${mirrorUrls.length}）...`, {
        progress_percent: 20,
        download_path: downloadPath,
        latest_version: latestVersion,
      });
      const result = await this.daemonClient.execCommand(nodeId, serverId, {
        binary: 'curl',
        args: ['-L', '--fail', '-o', downloadPath, url],
        timeout: 600_000,
      });
      if (result.timed_out) {
        downloadErrors.push(`[${i}] ${url}: 下载超时（600s）`);
        continue;
      }
      if (result.exit_code !== 0) {
        downloadErrors.push(`[${i}] ${url}: exit=${result.exit_code} ${result.stderr.slice(0, 200)}`);
        continue;
      }
      downloadSucceeded = true;
      break;
    }
    if (!downloadSucceeded) {
      throw new UpdateApplyError(
        `所有下载源失败（共 ${mirrorUrls.length} 个）:\n${downloadErrors.join('\n')}`,
      );
    }

    // 4. 调用 applyUpdate 执行 install_command
    this.setProgress(serverId, 'installing', '正在安装更新...', { progress_percent: 70 });
    await this.applyUpdate(serverId, downloadPath);

    this.setProgress(serverId, 'installing', '更新即将完成...', { progress_percent: 95 });

    return {
      downloaded: true,
      applied: true,
      download_path: downloadPath,
      latest_version: latestVersion,
    };
  }

  /**
   * v4.3.0-G1: 构建镜像源 URL 列表。
   *
   * 流程：
   *   1. 主源 URL（已由 resolveDownloadUrl 解析）放数组首位
   *   2. Pack.update.mirror_sources 中每个模板按 { version } 渲染后追加
   *   3. 去重（避免同一 URL 出现两次）
   *
   * 注意：镜像源仅适用于 versions.type='binary'（download_pattern 模板渲染）。
   *   - server-jar 通过 Mojang API 解析得到具体 URL，无 mirror_sources 概念
   *   - steamcmd 不支持一键下载
   *
   * @param pack GamePack
   * @param update PackUpdate（含 mirror_sources 可选字段）
   * @param latestVersion 已解析的最新版本号
   * @param primaryUrl 主源 URL（已渲染/解析完毕）
   * @returns 镜像源 URL 数组（含主源），按优先级排序
   */
  private resolveMirrorUrls(
    pack: GamePack,
    update: PackUpdate,
    latestVersion: string,
    primaryUrl: string,
  ): string[] {
    const urls: string[] = [primaryUrl];

    // mirror_sources 仅对 binary 类型生效（其他类型无 download_pattern 概念）
    const versionType = pack.versions.type ?? 'binary';
    if (versionType !== 'binary') {
      return urls;
    }

    const mirrorTemplates = update.mirror_sources;
    if (!mirrorTemplates || mirrorTemplates.length === 0) {
      return urls;
    }

    for (const template of mirrorTemplates) {
      try {
        const rendered = renderTemplate(template, { version: latestVersion });
        if (!urls.includes(rendered)) {
          urls.push(rendered);
        }
      } catch (err) {
        console.warn(
          `[updateService] mirror_sources 渲染失败（跳过）: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return urls;
  }

  /**
   * 根据 versions.type 分派下载策略，解析出实际下载 URL。
   *
   * v4.12.0(步骤 3):steamcmd 类型不再抛错,改为返回 steamcmd:// 协议标识,
   * 由 downloadUpdate 的 steamcmd 分支通过 daemon exec 执行 SteamCMD 安装。
   *
   * 支持的 type（见 pack-schema.ts VersionSourceTypeSchema）：
   *   - 'binary' → 直接渲染 download_pattern 模板（{{version}}）
   *   - 'server-jar' → 通过 manifest_url 查询 Mojang API 获取真实 server.jar 下载 URL
   *   - 'steamcmd' → 返回 'steamcmd://<appid>',由 downloadUpdate 分支处理
   */
  private async resolveDownloadUrl(pack: GamePack, latestVersion: string): Promise<string> {
    const versionType = pack.versions.type ?? 'binary';

    switch (versionType) {
      case 'binary': {
        const downloadPattern = pack.versions.download_pattern;
        if (!downloadPattern) {
          throw new UpdateCheckError(
            `Pack ${pack.pack.id} 未声明 versions.download_pattern，无法自动下载`,
          );
        }
        return renderTemplate(downloadPattern, { version: latestVersion });
      }

      case 'server-jar': {
        // Minecraft: 通过 Mojang version manifest API 解析真实下载 URL
        const manifestUrl = pack.versions.manifest_url
          ?? 'https://piston-meta.mojang.com/mc/game/version_manifest.json';
        return await resolveMinecraftDownloadUrl(manifestUrl, latestVersion);
      }

      case 'steamcmd': {
        // v4.12.0: 返回 steamcmd:// 协议标识,downloadUpdate 会识别此协议
        // 并通过 daemon exec 执行 SteamCMD app_update(而非 curl 下载)
        const appId = this.extractSteamAppId(pack);
        return `steamcmd://${appId}`;
      }

      default:
        throw new UpdateCheckError(
          `未知的 versions.type: ${versionType}（Pack ${pack.pack.id}）`,
        );
    }
  }

  /**
   * v4.12.0(步骤 3):执行 SteamCMD 安装/更新流程。
   *
   * SteamCMD 自身完成下载+安装+校验,不需要 curl 下载和 install_command。
   * 通过 daemon execCommand 执行:
   *   steamcmd +force_install_dir <instance_root> +login anonymous +app_update <appid> validate +quit
   *
   * SteamCMD 会:
   *   1. 自更新(首次运行耗时较长)
   *   2. 下载游戏文件到 force_install_dir 指定目录
   *   3. 校验文件完整性(validate)
   *   4. 更新 appmanifest_<appid>.acf 的 buildid
   *
   * 安装完成后,更新 servers.current_version 为新 buildid。
   */
  private async executeSteamCmdInstall(
    pack: GamePack,
    serverId: string,
    nodeId: string,
    latestVersion: string,
  ): Promise<{ downloaded: boolean; applied: boolean; download_path: string; latest_version: string }> {
    const appId = this.extractSteamAppId(pack);

    // 获取实例 workdir 的绝对路径(SteamCMD force_install_dir 需要绝对路径)
    let instanceRootAbs = '.';
    try {
      const pwdResult = await this.daemonClient.execCommand(nodeId, serverId, {
        binary: 'pwd',
        args: [],
        timeout: 5_000,
      });
      if (pwdResult.exit_code === 0 && pwdResult.stdout.trim()) {
        instanceRootAbs = pwdResult.stdout.trim();
      }
    } catch {
      // 获取绝对路径失败不阻断,使用 '.' 作为 fallback
    }

    // SteamCMD 登录模式(默认 anonymous)
    const steamLogin = (pack.versions as { steam_login?: string }).steam_login ?? 'anonymous';

    // 执行 SteamCMD(超时 900s,首次运行会自更新)
    this.setProgress(serverId, 'downloading', `正在通过 SteamCMD 安装/更新游戏 (AppID ${appId})...`, {
      progress_percent: 30,
      latest_version: latestVersion,
    });

    const steamcmdBinary = '/usr/local/bin/steamcmd';
    const steamcmdArgs = [
      '+force_install_dir', instanceRootAbs,
      '+login', steamLogin,
      '+app_update', appId, 'validate',
      '+quit',
    ];

    let result: ExecCommandResponse;
    try {
      result = await this.daemonClient.execCommand(nodeId, serverId, {
        binary: steamcmdBinary,
        args: steamcmdArgs,
        timeout: 900_000, // 15 分钟,SteamCMD 首次自更新+下载耗时较长
      });
    } catch (err) {
      throw new UpdateApplyError(
        `执行 SteamCMD 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (result.timed_out) {
      throw new UpdateApplyError('SteamCMD 安装超时（900s）');
    }
    if (result.exit_code !== 0) {
      throw new UpdateApplyError(
        `SteamCMD 安装失败 exit=${result.exit_code}: ${result.stderr.slice(0, 500)}`,
      );
    }

    // 安装完成后读取新 buildid 更新 servers.current_version
    this.setProgress(serverId, 'installing', '正在读取安装结果...', { progress_percent: 90 });
    let newBuildid: string;
    try {
      newBuildid = await this.readSteamBuildid(pack, nodeId, serverId);
    } catch {
      // 读取 buildid 失败不阻断,用 latestVersion 兜底
      newBuildid = latestVersion;
    }

    // 更新 servers.current_version
    const now = new Date().toISOString();
    await this.db('servers').where({ id: serverId }).update({
      current_version: newBuildid,
      last_activity_at: now,
    });

    return {
      downloaded: true,
      applied: true,
      download_path: instanceRootAbs,
      latest_version: newBuildid,
    };
  }

  // -------------------------------------------------------------------------
  // 内部辅助
  // -------------------------------------------------------------------------

  /** 解析 serverId → { pack, nodeId }（不强制要求 Pack 声明 update，由 resolveUpdate 负责降级） */
  private async resolveServerPackWithUpdate(
    serverId: string,
  ): Promise<{ pack: GamePack; nodeId: string }> {
    const row = await this.db<ServerRow>('servers').where({ id: serverId }).first();
    if (!row) {
      throw new InstanceNotFoundError(`实例不存在: ${serverId}`);
    }
    const pack = this.registry.load(row.pack_id);
    if (!pack) {
      throw new PackNotFoundError(`Pack 不存在: ${row.pack_id}`);
    }
    return { pack, nodeId: row.node_id };
  }

  /**
   * 获取 Pack.update 配置。
   *
   * B2 降级策略：
   *   1. pack.update 存在 → 直接返回（完整能力）
   *   2. pack.update 不存在但 versions.manifest_url 存在 → 从 versions 降级构造 PackUpdate：
   *      - source_url: versions.manifest_url（用于 checkUpdate 获取最新版本）
   *      - current_version_command / download_dir / install_command: 占位命令
   *        （降级模式仅支持查看最新版本，不支持实际安装）
   *   3. 两者都不存在 → 抛 PackCapabilityNotDeclaredError
   *
   * @returns { update, degraded } degraded=true 表示降级模式，调用方应记录 warn
   */
  private resolveUpdate(pack: GamePack): { update: PackUpdate; degraded: boolean } {
    if (pack.update) {
      return { update: pack.update, degraded: false };
    }

    // B2 降级：从 versions.manifest_url 构造降级 PackUpdate
    const manifestUrl = pack.versions.manifest_url;
    if (!manifestUrl) {
      throw new PackCapabilityNotDeclaredError(
        `Pack ${pack.pack.id} 未声明 update，且 versions.manifest_url 不存在，无法降级`,
      );
    }

    // 降级构造：仅 source_url 可用，其余为占位命令（实际执行会失败，属合理的降级行为）
    const degradedUpdate: PackUpdate = {
      source_url: manifestUrl,
      // 占位命令：降级模式下 current_version_command 会失败，checkUpdate 会降级为 current_version=null
      current_version_command: 'cat .game-version 2>/dev/null || echo unknown',
      // 占位下载目录：降级模式下 applyUpdate/downloadUpdate 会因路径/命令问题失败
      download_dir: '{{instance_root}}/downloads',
      // 占位安装命令：通用的 tar 解压（仅适用于 tar.gz 格式的服务端）
      install_command: 'mkdir -p {{download_dir}} && tar -xzf {{download_path}} -C {{instance_root}}',
    };
    return { update: degradedUpdate, degraded: true };
  }

  /**
   * 获取最新版本号。
   *
   * v4.12.0: 优先使用 VersionProvider(步骤 1 版本源真实化重构):
   *   1. 调 getProvider(pack, { daemonClient, nodeId }) 获取 Provider;
   *   2. Provider 存在 → 调 getLatest().release 返回;
   *   3. Provider 不存在(null)→ 回退到 legacy source_url HTTP fetch(向后兼容旧 Pack);
   *   4. legacy 路径仍支持 static:// 协议。
   *
   * @param pack GamePack(用于构造 Provider)
   * @param sourceUrl legacy source_url(Provider 不可用时回退)
   * @param nodeId 节点 ID(SteamCmdBuildIdProvider 需要)
   */
  private async fetchLatestVersion(
    pack: GamePack,
    sourceUrl: string,
    nodeId: string,
    serverId?: string,
  ): Promise<string> {
    // 1. 优先尝试 VersionProvider
    const provider = getProvider(pack, {
      pack,
      daemonClient: this.daemonClient,
      nodeId,
      serverId,
    });
    if (provider) {
      const latest = await provider.getLatest();
      if (latest.release && latest.release.length > 0) {
        return latest.release;
      }
      throw new Error(`VersionProvider 返回空 release (pack=${pack.pack.id})`);
    }

    // 2. 回退:legacy source_url HTTP fetch(向后兼容旧 Pack)
    // static:// 协议:直接从内置静态版本源读取 latest.release
    if (sourceUrl.startsWith(STATIC_SOURCE_PREFIX)) {
      const staticSource = resolveStaticSource(sourceUrl);
      if (!staticSource) {
        throw new Error(`静态版本源未配置: ${sourceUrl}`);
      }
      return staticSource.latest.release;
    }

    const resp = await fetch(sourceUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
    const data = await resp.json() as unknown;
    const version = extractLatestVersion(data);
    if (!version) {
      throw new Error(
        `无法从 source_url 响应解析 latest_version: ${JSON.stringify(data).slice(0, 200)}`,
      );
    }
    return version;
  }

  /**
   * 执行 current_version_command 获取当前版本。
   *
   * v4.12.0(步骤 3):Steam 游戏(type=steamcmd)不再执行二进制命令,
   * 改为读取 appmanifest_<appid>.acf 的 buildid 字段(更轻量、更可靠)。
   * 非 Steam 游戏保持原有 current_version_command 执行逻辑。
   */
  private async executeVersionCommand(
    pack: GamePack,
    update: PackUpdate,
    nodeId: string,
    serverId: string,
  ): Promise<string> {
    // v4.12.0: Steam 游戏 → 读 appmanifest.acf 的 buildid
    if (pack.versions.type === 'steamcmd') {
      return this.readSteamBuildid(pack, nodeId, serverId);
    }

    // 非 Steam 游戏:执行 current_version_command
    // 与 installCommandForPath 一致：daemon exec 端点 cwd 已为实例 workdir，
    // instance_root 渲染为 '.' 避免相对路径双重嵌套
    const currentVersionCmd = update.current_version_command;
    if (!currentVersionCmd) {
      throw new Error(
        `Pack ${pack.pack.id} 未声明 update.current_version_command,无法获取当前版本`,
      );
    }
    const vars: Readonly<Record<string, string>> = {
      binary: pack.startup.binary,
      instance_root: '.',
    };
    const renderedCmd = renderTemplate(currentVersionCmd, vars);
    const tokens = tokenize(renderedCmd);
    if (tokens.length === 0) {
      throw new Error('current_version_command 渲染后为空');
    }
    const [binary, ...args] = tokens;

    const result = await this.daemonClient.execCommand(nodeId, serverId, {
      binary,
      args,
      timeout: 30_000,
    });
    if (result.exit_code !== 0) {
      throw new Error(`current_version_command 失败 exit=${result.exit_code}: ${result.stderr.slice(0, 200)}`);
    }
    // 解析版本号：从 stdout 提取第一个 x.y.z 格式的版本号
    const versionMatch = result.stdout.match(/\d+\.\d+(?:\.\d+)?/);
    if (!versionMatch) {
      throw new Error(`无法从 current_version_command 输出解析版本号: ${result.stdout.slice(0, 200)}`);
    }
    return versionMatch[0];
  }

  /**
   * v4.12.0(步骤 3):读取 Steam 游戏的 appmanifest_<appid>.acf 获取已安装 buildid。
   *
   * 从 versions.source 提取 appId(格式 steamcmd://<appid> 或纯数字),
   * 通过 daemon readFile 读取 appmanifest 文件,解析 buildid 字段。
   *
   * @throws {Error} appmanifest 不存在或 buildid 解析失败
   */
  private async readSteamBuildid(
    pack: GamePack,
    nodeId: string,
    serverId: string,
  ): Promise<string> {
    const appId = this.extractSteamAppId(pack);
    const manifestPath = `appmanifest_${appId}.acf`;
    const resp = await this.daemonClient.readFile(nodeId, serverId, manifestPath);
    // VDF 解析:提取 "buildid" "1234567"
    const match = resp.content.match(/"buildid"\s+"(\d+)"/);
    if (!match || !match[1]) {
      throw new Error(`appmanifest_${appId}.acf 中未找到 buildid 字段`);
    }
    return match[1];
  }

  /**
   * v4.12.0(步骤 3):从 Pack 配置提取 Steam App ID。
   * versions.source 格式:steamcmd://<appid> 或纯数字。
   */
  private extractSteamAppId(pack: GamePack): string {
    const source = pack.versions.source;
    const m = source.match(/(?:steamcmd:\/\/)?(\d+)/);
    if (!m || !m[1]) {
      throw new Error(`Pack ${pack.pack.id} 未配置有效的 Steam App ID (versions.source=${source})`);
    }
    return m[1];
  }
}

// ----- 纯函数 -----

/**
 * 从 source_url 响应解析 latest_version。
 *
 * 支持三种 API 形态：
 *   1. 简单字符串字段（顶层）：{ latest_version: "1.2.3" } / { version: "1.2.3" } / { tag_name: "v1.2.3" }
 *   2. 嵌套对象（如 Factorio）：{ stable: { headless: "2.0.77", alpha: "2.0.77" }, experimental: {...} }
 *   3. 兜底递归：深度优先查找第一个 x.y.z 格式的字符串
 *
 * 嵌套结构优先级（适配游戏服务端场景）：
 *   stable.headless > stable.alpha > experimental.headless > experimental.alpha
 *   （headless 优先，因为我们下载的是 headless server；stable 优先于 experimental）
 */
function extractLatestVersion(data: unknown): string | null {
  // 1. 顶层字符串字段
  const topCandidates = ['latest_version', 'version', 'tag_name', 'latest_stable', 'stable'];
  if (isRecord(data)) {
    for (const key of topCandidates) {
      const value = data[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    // 2. 嵌套对象：stable/experimental → headless/alpha
    const nestedPaths = [
      ['stable', 'headless'],
      ['stable', 'alpha'],
      ['experimental', 'headless'],
      ['experimental', 'alpha'],
      ['latest', 'headless'],
      ['latest', 'alpha'],
    ];
    for (const [k1, k2] of nestedPaths) {
      const obj = data[k1];
      if (isRecord(obj)) {
        const v = obj[k2];
        if (typeof v === 'string' && v.length > 0) {
          return v;
        }
      }
    }
  }
  // 3. 兜底：递归查找第一个 x.y.z 格式的字符串
  return findFirstVersionString(data);
}

/** 判断是否为非 null 对象 */
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** 深度优先递归查找第一个 x.y.z 格式的版本字符串 */
function findFirstVersionString(data: unknown): string | null {
  if (typeof data === 'string') {
    const match = data.match(/^\d+\.\d+(?:\.\d+)?/);
    if (match) return match[0];
    return null;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const v = findFirstVersionString(item);
      if (v) return v;
    }
    return null;
  }
  if (isRecord(data)) {
    for (const key of Object.keys(data)) {
      const v = findFirstVersionString(data[key]);
      if (v) return v;
    }
  }
  return null;
}

/**
 * 简单模板渲染：{{var}} → vars[var]
 * D10: 命令注入防护——所有变量值在替换前经过 sanitizeTemplateVar 转义，
 * 移除 shell 特殊字符（$ ` | & ; > < ( ) 等），防止注入攻击。
 */
function renderTemplate(str: string, vars: Readonly<Record<string, string>>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) {
      return match;
    }
    // D10: 对变量值做 shell 特殊字符转义后再替换
    return sanitizeTemplateVar(vars[key]);
  });
}

/**
 * D12: 根据实际下载 URL 决定本地保存文件名。
 *
 * 优先级：
 *   1. 从 URL 路径最后一段提取文件名（如 .../server.jar → server.jar）
 *   2. 按 Pack.versions.type 选择合理后缀：
 *      - server-jar → <packId>-<version>.jar
 *      - 其他 → <packId>-<version>.tar.gz（保留原行为兼容 binary/steam 等压缩包分发）
 *
 * 这样可以避免硬编码 .tar.gz 导致 Mojang server.jar 下载后文件名不匹配的问题。
 */
function resolveDownloadFileName(downloadUrl: string, pack: GamePack, latestVersion: string): string {
  try {
    const urlObj = new URL(downloadUrl);
    const pathname = urlObj.pathname;
    const lastSegment = pathname.split('/').filter(Boolean).pop();
    // 校验最后一段是合法文件名（含扩展名，无查询参数残留）
    if (lastSegment && /\.[A-Za-z0-9]{1,8}$/.test(lastSegment) && !lastSegment.includes('?')) {
      return lastSegment;
    }
  } catch {
    // URL 解析失败，走降级逻辑
  }
  // 降级：按 versions.type 选择后缀
  const versionType = pack.versions.type ?? 'binary';
  const ext = versionType === 'server-jar' ? '.jar' : '.tar.gz';
  return `${pack.pack.id}-${latestVersion}${ext}`;
}

/**
 * D11: 通过 Mojang version manifest API 解析指定版本的 server.jar 下载 URL。
 * 流程：manifest.json → 找到指定版本条目 → 版本详情 JSON → downloads.server.url
 */
async function resolveMinecraftDownloadUrl(manifestUrl: string, targetVersion: string): Promise<string> {
  const resp = await fetch(manifestUrl);
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
  const detailResp = await fetch(entry.url);
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

/** 简单分词：按空白分，支持双引号包裹 */
function tokenize(s: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && (c === ' ' || c === '\t' || c === '\n')) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += c;
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

// ----- 工厂 -----

export function createUpdateService(
  db: Knex,
  registry: PackRegistry,
  daemonClient: DaemonClient,
): UpdateServiceImpl {
  return new UpdateServiceImpl(db, registry, daemonClient);
}
