// ============================================================================
// steamCmdBuildIdProvider.ts — SteamCMD buildid 兜底版本源
//
// 步骤 3:完整实现 — 通过 daemon 读取 appmanifest_<appid>.acf 解析已安装 buildid
//
// 两种获取方式:
//   1. appmanifest.acf(推荐,轻量)— daemon readFile 读取实例 workdir 下的
//      appmanifest_<appid>.acf,解析 "buildid" 字段
//   2. steamcmd app_info_print(兜底,重)— daemon execCommand 执行
//      steamcmd +app_info_print <appid> +quit,解析输出
//
// 仅能拿"当前已安装 buildid",无历史列表;用于官网源不可达时的兜底。
// Steam 游戏 Provider 优先级:official-site > github-release > steamcmd-buildid > static
// ============================================================================

import type { VersionEntry, VersionProvider, LatestVersion } from './types.js';
import { VersionProviderError } from './types.js';

// daemonClient 的最小接口约束(避免直接依赖具体类型)
interface DaemonFileClient {
  readFile(nodeId: string, serverId: string, relPath: string): Promise<{ content: string }>;
}

export interface SteamCmdBuildIdConfig {
  /** Steam App ID(如 Palworld 2374020) */
  appId: string;
  /** daemon client(用于 readFile 读 appmanifest.acf) */
  daemonClient?: DaemonFileClient;
  /** 节点 ID */
  nodeId?: string;
  /** 实例 ID(serverId,用于 daemon readFile) */
  serverId?: string;
}

export class SteamCmdBuildIdProvider implements VersionProvider {
  constructor(private config: SteamCmdBuildIdConfig) {}

  async listVersions(): Promise<VersionEntry[]> {
    const latest = await this.getLatest();
    return [
      {
        version: latest.release,
        type: 'release',
        buildid: latest.buildid,
      },
    ];
  }

  async getLatest(): Promise<LatestVersion> {
    const { daemonClient, nodeId, serverId, appId } = this.config;

    // 方式1:读取 appmanifest_<appid>.acf(推荐)
    if (daemonClient && nodeId && serverId) {
      try {
        const buildid = await this.readBuildidFromManifest(daemonClient, nodeId, serverId, appId);
        if (buildid) {
          // buildid 作为版本号展示(无人类可读版本号时)
          return {
            release: buildid,
            buildid,
          };
        }
      } catch (err) {
        // appmanifest 读取失败,降级到 steamcmd app_info_print
        const msg = err instanceof Error ? err.message : String(err);
        throw new VersionProviderError(
          `读取 appmanifest_${appId}.acf 失败: ${msg}`,
          'STEAMCMD_MANIFEST_READ_FAILED',
        );
      }
    }

    // 方式2:steamcmd app_info_print(兜底,需要 daemon execCommand)
    // 注:当前未实现 execCommand 路径,因 appmanifest 已足够覆盖已安装实例场景
    // 若需查询"最新可下载 buildid"(而非已安装),应通过 SteamCMD app_update dry-run
    throw new VersionProviderError(
      `SteamCmdBuildIdProvider 无法获取 buildid: daemonClient/nodeId/serverId 未提供,或 appmanifest_${appId}.acf 不存在 (appId=${appId})`,
      'STEAMCMD_NO_BUILDID',
    );
  }

  /**
   * 读取 appmanifest_<appid>.acf 文件并解析 buildid。
   *
   * appmanifest.acf 格式(VDF):
   *   "AppState"
   *   {
   *     "appid"      "2374020"
   *     "buildid"    "1234567"
   *     ...
   *   }
   */
  private async readBuildidFromManifest(
    daemonClient: DaemonFileClient,
    nodeId: string,
    serverId: string,
    appId: string,
  ): Promise<string | null> {
    const manifestPath = `appmanifest_${appId}.acf`;
    let content: string;
    try {
      const resp = await daemonClient.readFile(nodeId, serverId, manifestPath);
      content = resp.content;
    } catch {
      // 文件不存在(实例未安装 Steam 游戏)→ 返回 null
      return null;
    }

    // VDF 解析:提取 "buildid" "1234567" 行
    const match = content.match(/"buildid"\s+"(\d+)"/);
    if (!match || !match[1]) {
      return null;
    }
    return match[1];
  }
}
