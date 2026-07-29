import { registerGameType, type GameTypeAdapter, type BootstrapContext } from '../game-type-registry.js';

const adapter: GameTypeAdapter = {
  gameType: 'rust',
  displayName: 'Rust',
  coreExtensions: [],
  signalStop: 'stdin',
  bootstrap: async (ctx: BootstrapContext) => {
    const { bootstrapSteamGame } = await import('../bootstrap.js');
    await bootstrapSteamGame(ctx, 'rust', ['server', 'cfg']);
  },
};

registerGameType(adapter);
