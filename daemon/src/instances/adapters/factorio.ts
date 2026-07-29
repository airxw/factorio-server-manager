import { registerGameType, type GameTypeAdapter, type BootstrapContext } from '../game-type-registry.js';

const adapter: GameTypeAdapter = {
  gameType: 'factorio',
  displayName: 'Factorio',
  coreExtensions: [],
  signalStop: 'stdin',
  bootstrap: async (ctx: BootstrapContext) => {
    const { bootstrapSteamGame, writeFactorioServerSettings } = await import('../bootstrap.js');
    await bootstrapSteamGame(ctx, 'factorio', ['config', 'saves']);
    // v4.13.1（2026-07-29）：补充生成默认 server-settings.json（首次启动必需）
    await writeFactorioServerSettings(ctx);
  },
};

registerGameType(adapter);
