import { registerGameType, type GameTypeAdapter, type BootstrapContext } from '../game-type-registry.js';

const adapter: GameTypeAdapter = {
  gameType: 'minecraft',
  displayName: 'Minecraft',
  coreExtensions: ['.jar'],
  signalStop: 'stdin',
  bootstrap: async (ctx: BootstrapContext) => {
    // 动态导入避免与 bootstrap.js 的循环依赖（测试中 bootstrap.js 被 mock）
    const { bootstrapMinecraft } = await import('../bootstrap.js');
    await bootstrapMinecraft(ctx);
  },
};

registerGameType(adapter);
