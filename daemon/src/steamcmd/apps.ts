// ============================================================================
// steamcmd — Steam App ID 映射表
// 用途：bootstrapSteamGame 通过 game type 查询 appId，调用 steamcmd 下载专用服务端
// ============================================================================

// Steam App ID 映射表
// anonymous 标注：所有 SteamCMD 专用服务端默认支持 anonymous 匿名下载，
// 仅 dyson 不在此表中（需已购买游戏本体的 Steam 账号 + Wine 运行）。
// v4.13.1（2026-07-29）：dst/enshrouded/satisfactory 因无法"点击就用"已移除，
//   - dst：需用户手动生成 Klei cluster token
//   - enshrouded：需 Wine 运行环境
//   - satisfactory：需游戏内 Claim 流程
export const STEAM_APP_IDS: Record<string, number> = {
  factorio: 427520,   // Factorio Dedicated Server (anonymous)
  ark: 376030,        // ARK: Survival Evolved Dedicated Server (anonymous)
  rust: 258550,       // Rust Dedicated Server (anonymous)
  palworld: 2374020,  // Palworld Dedicated Server (anonymous)
  terraria: 105600,    // Terraria（与游戏本体共用 App ID，anonymous）
  valheim: 896660,     // Valheim Dedicated Server (anonymous)
  zomboid: 380870,     // Project Zomboid Dedicated Server (anonymous)
  // dyson 不加入：不支持 anonymous + 必须购买游戏本体 + 必须 Wine 运行 + 需 Nebula Mod
};
