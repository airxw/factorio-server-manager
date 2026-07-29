import { registerGameType, type GameTypeAdapter, type BootstrapContext } from '../game-type-registry.js';

const adapter: GameTypeAdapter = {
  gameType: 'zomboid',
  displayName: 'Project Zomboid',
  coreExtensions: ['.sh'],
  signalStop: 'stdin',
  bootstrap: async (ctx: BootstrapContext) => {
    const { bootstrapSteamGame } = await import('../bootstrap.js');
    await bootstrapSteamGame(ctx, 'zomboid', ['Zomboid/Saves', 'Zomboid/Server']);
  },
};

registerGameType(adapter);
