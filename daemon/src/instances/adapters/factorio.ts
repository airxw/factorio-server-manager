import fs from 'fs';
import path from 'path';
import { registerGameType, type GameTypeAdapter, type BootstrapContext } from '../game-type-registry.js';

const adapter: GameTypeAdapter = {
  gameType: 'factorio',
  displayName: 'Factorio',
  coreExtensions: [],
  signalStop: 'stdin',
  bootstrap: async (ctx: BootstrapContext) => {
    const {
      bootstrapSteamGame,
      writeFactorioServerSettings,
      writeFactorioMapSettings,
      createFactorioInitialSave,
    } = await import('../bootstrap.js');

    // v4.35.1: binary 已存在时跳过 SteamCMD（bootstrapInstance 在每次 start 时调用，
    //          旧逻辑无条件跑 SteamCMD 导致 300s 超时 + 实例 stuck 在 starting）
    const binaryRel = ctx.pack.startup.binary;
    const binaryAbs = path.resolve(ctx.instance.workdir, binaryRel);
    if (!fs.existsSync(binaryAbs)) {
      await bootstrapSteamGame(ctx, 'factorio', ['config', 'saves']);
    } else {
      // binary 已存在，仅确保子目录存在
      for (const dir of ['config', 'saves']) {
        await fs.promises.mkdir(path.join(ctx.instance.workdir, dir), { recursive: true });
      }
      ctx.logger.info(
        { workdir: ctx.instance.workdir, binaryAbs },
        'bootstrap: Factorio binary 已存在，跳过 SteamCMD',
      );
    }

    // v4.13.1（2026-07-29）：补充生成默认 server-settings.json（首次启动必需）
    // v4.33.0（2026-07-30）：修复路径错位 + 字段对齐 2.0 + 新增 map-gen/map-settings 生成 + 首次启动自动建图
    await writeFactorioServerSettings(ctx);
    await writeFactorioMapSettings(ctx);
    await createFactorioInitialSave(ctx);
  },
};

registerGameType(adapter);
