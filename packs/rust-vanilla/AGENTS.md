# Rust 游戏包 AGENTS.md

> 🚨 【最高优先级规则】本文件为本次开发的强制约束，优先级高于所有临时提问、上下文对话、自定义需求。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容。

---

## 模块信息

- **模块名**：Rust 游戏包（rust-vanilla）
- **物理路径**：`packs/rust-vanilla/`
- **职责**：完整 Pack YAML 定义（启动/命令/配置/版本/备份/EULA/物品池/业务能力）
- **依赖**：模块0（`public/schema/pack-schema.ts` 用于校验）

---

## 可修改文件范围

```
packs/rust-vanilla/
└── pack.yaml                       # 完整 Pack 定义
```

## gsp 项目规范通用约束

- Pack YAML 必须通过 `public/schema/pack-schema.ts` 的 zod 校验
- 禁止在 Pack 中硬编码服务器地址、密码等环境相关信息
- 命令模板变量使用 `{{var}}` 语法
- `public/` 目录保护：不得删除/修改/覆盖 `public/` 下文件，契约变更走 s0601 流程

## 模块专属约束

1. **游戏类型**：`pack.game: rust`，Steam App ID 258550
2. **协议类型**：`protocol.type: webrcon`，`default_port: 28016`，`auth: password`
   - Rust 原生 WebRCON（HTTP+JSON），非标准 RCON
3. **启动命令**：`./RustDedicated -batchmode -nographics +server.port ... +rcon.web 1`
4. **就绪检测**：`ready_pattern: 'Server startup complete|Unloading 1 unused Assets'`
5. **停止方法**：`stop_method: rcon`，`stop_command: 'quit'`，`stop_timeout: 30`
6. **端口声明**：
   - `default_game_port: 28015`（UDP，游戏端口）
   - `required_ports`：28015/udp(game,primary) + 28016/tcp(rcon)
7. **配置文件**：`config_files` 单文件 `server/<identity>/ServerAuto.cfg`（INI 格式）
8. **命令映射**（原版命令，非 uMod）：
   - `broadcast: 'say {{message}}'`
   - `give_item: 'give {{player}} "{{item}}" {{count}}'`（物品用 shortname，带引号）
   - `kick_player: 'kick {{player}}'`
   - `ban_player: 'ban {{player}} {{reason}}'`
   - `list_players: 'players'`
   - `save_world: 'save'`
9. **版本源**：
   - `versions.source: 'steamcmd://258550'`
   - `versions.type: steamcmd`
   - `versions.provider: official-site`（配合 official_url + version_regex，失败走多源回退链）
   - `versions.official_url: 'https://wiki.facepunch.com/rust/'`
   - `versions.version_regex: '(\d+\.\d+\.\d+)'`
   - `versions.steam_login: anonymous`
   - `versions.eula_required: true`
10. **游戏更新**：Steam 游戏简化配置
    - `update.source_url: 'https://wiki.facepunch.com/rust/'`（URL 格式占位，实际走 provider 链）
    - `update.download_dir: '{{instance_root}}'`（Steam 直接安装到实例根）
    - `current_version_command` / `install_command` 省略（Steam 游戏读 appmanifest buildid，由 daemon steam-install 接管）
11. **资源要求**：`min_ram: 4G` / `recommended_ram: 8G` / `min_disk: 10G`
12. **物品池**：
    - Rust 物品用 shortname（含点号，如 `metal.fragments` / `rifle.ak`），`give` 命令带引号
    - `qualities: []`，`quality_tiers: 0`（Rust 无品质概念）
    - `static_list` 40+ 常见物品（资源/组件/食物/医疗/工具/武器/弹药/防具），display_name 中文
13. **业务能力**：shop/cdk/chat_enhancement/players/lists/verify 全部 enabled
    - `business.shop.give_command` 与 `commands.give_item` 一致
14. **备份**：`world_dir: server/{{server_identity}}`，存档扩展名 `.sav`
15. **Mod 管理**：uMod / Oxide 插件，位于 `oxide/plugins/`

## 依赖的契约入口

- `public/schema/pack-schema.ts` → Pack zod schema（校验 Pack 结构）

## 测试要求

- `pack.yaml` 通过 zod 校验（`GamePackSchema.safeParse`）
- 所有命令模板变量已声明
- `npm run typecheck`（panel/backend）不破坏编译

## 失败回退

- 回退点：`packs-archive/rust-vanilla/pack.yaml`（迁移前校正版本）
- 策略：基于 minecraft-vanilla 结构 + Rust 实际命令/端口/物品 shortname 校正

## 闭合判据

- `packs/rust-vanilla/pack.yaml` 通过 zod 校验
- 所有命令模板变量已声明
- 版本源配置完整（source/provider/official_url/version_regex/steam_login/eula_required）
- 端口声明完整（required_ports 含 game + rcon）
- 物品 static_list 40+ 且 shortname 真实（含点号）
