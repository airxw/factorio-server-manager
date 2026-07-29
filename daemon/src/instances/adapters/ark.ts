import { registerGameType, type GameTypeAdapter, type BootstrapContext } from '../game-type-registry.js';

const adapter: GameTypeAdapter = {
  gameType: 'ark',
  displayName: 'ARK: Survival Evolved',
  coreExtensions: [],
  signalStop: 'stdin',
  bootstrap: async (ctx: BootstrapContext) => {
    const { bootstrapSteamGame } = await import('../bootstrap.js');
    await bootstrapSteamGame(ctx, 'ark', ['ShooterGame', 'Saved']);
  },
};

registerGameType(adapter);
