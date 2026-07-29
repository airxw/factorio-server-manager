import { registerGameType, type GameTypeAdapter, type BootstrapContext } from '../game-type-registry.js';

const adapter: GameTypeAdapter = {
  gameType: 'dyson',
  displayName: 'Dyson Sphere Program',
  coreExtensions: ['.exe'],
  signalStop: 'sigint',
  bootstrap: async (ctx: BootstrapContext) => {
    // 不支持 SteamCMD anonymous 下载，保留 stub 模式
    // 用户需手动放置游戏目录 + BepInEx + Nebula Mod
    const { bootstrapStub } = await import('../bootstrap.js');
    await bootstrapStub(ctx, 'DSPGame.exe', ['BepInEx', 'BepInEx/plugins', 'Saves']);
  },
};

registerGameType(adapter);
