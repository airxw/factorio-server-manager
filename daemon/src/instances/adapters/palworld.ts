import { registerGameType, type GameTypeAdapter, type BootstrapContext } from '../game-type-registry.js';

const adapter: GameTypeAdapter = {
  gameType: 'palworld',
  displayName: 'Palworld',
  coreExtensions: [],
  signalStop: 'stdin',
  bootstrap: async (ctx: BootstrapContext) => {
    const { bootstrapSteamGame } = await import('../bootstrap.js');
    await bootstrapSteamGame(ctx, 'palworld', ['Pal', 'Saved']);
  },
};

registerGameType(adapter);
