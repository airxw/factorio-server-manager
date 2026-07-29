import { registerGameType, type GameTypeAdapter, type BootstrapContext } from '../game-type-registry.js';

const adapter: GameTypeAdapter = {
  gameType: 'valheim',
  displayName: 'Valheim',
  coreExtensions: [],
  signalStop: 'sigint',
  bootstrap: async (ctx: BootstrapContext) => {
    const { bootstrapSteamGame } = await import('../bootstrap.js');
    await bootstrapSteamGame(ctx, 'valheim', ['saves', 'saves/worlds_local']);
  },
};

registerGameType(adapter);
