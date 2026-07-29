import { registerGameType, type GameTypeAdapter } from '../game-type-registry.js';

const adapter: GameTypeAdapter = {
  gameType: 'custom',
  displayName: 'Custom Game',
  coreExtensions: [],
  signalStop: 'stdin',
  // 无特定 bootstrap 逻辑，使用通用 workdir 创建（bootstrap.ts 默认行为）
};

registerGameType(adapter);
