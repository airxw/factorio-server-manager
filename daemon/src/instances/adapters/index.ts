// ============================================================================
// 游戏类型 adapter 注册入口
//
// 此文件导入所有 adapter 模块以触发 registerGameType 调用。
// 消费方（bootstrap.ts / manager.ts）只需 import './adapters/index.js'
// 即可确保所有游戏类型已注册。
//
// 新增游戏类型时：
// 1. 创建 adapters/<new-game>.ts
// 2. 在下方添加 import './<new-game>.js'
// ============================================================================

import './minecraft.js';
import './factorio.js';
import './rust.js';
import './ark.js';
import './palworld.js';
import './custom.js';
import './dyson.js';
import './terraria.js';
import './valheim.js';
import './zomboid.js';
