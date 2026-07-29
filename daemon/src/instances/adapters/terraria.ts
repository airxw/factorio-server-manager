import { registerGameType, type GameTypeAdapter, type BootstrapContext } from '../game-type-registry.js';

const adapter: GameTypeAdapter = {
  gameType: 'terraria',
  displayName: 'Terraria',
  coreExtensions: [],
  signalStop: 'stdin',
  bootstrap: async (ctx: BootstrapContext) => {
    const { bootstrapSteamGame, writeTerrariaConfig } = await import('../bootstrap.js');
    // v4.13.1（2026-07-29）：变体感知
    // - variant='vanilla'：走 SteamCMD 下载 Terraria 专用服务端 + 写 serverconfig.txt
    // - variant='tshock'：跳过 SteamCMD（TShock 来自 GitHub Releases，binary='./TShockServer'），
    //   仅创建 Worlds/ 子目录 + 写 serverconfig.txt；用户需通过 downloadUpdate 流程下载 TShockServer
    const variant = ctx.pack.pack.variant;
    if (variant === 'tshock') {
      // TShock 变体：仅创建必要子目录 + 写配置，二进制由 downloadUpdate 从 GitHub Releases 下载
      const fs = await import('node:fs');
      const path = await import('node:path');
      await fs.promises.mkdir(path.join(ctx.instance.workdir, 'Worlds'), { recursive: true });
      await writeTerrariaConfig(ctx);
      ctx.logger.warn(
        { workdir: ctx.instance.workdir, variant },
        'bootstrap: tshock 变体，跳过 SteamCMD；请通过 downloadUpdate 从 GitHub Releases 下载 TShockServer',
      );
    } else {
      // vanilla 变体：保持原逻辑（SteamCMD + 配置）
      await bootstrapSteamGame(ctx, 'terraria', ['Worlds']);
      await writeTerrariaConfig(ctx);
    }
  },
};

registerGameType(adapter);
