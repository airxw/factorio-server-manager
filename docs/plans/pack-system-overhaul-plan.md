---
type: plan
title: Pack 系统真实化重构方案 — 版本源/pack 数据/SteamCMD 流程全链路校正
date: 2026-07-24
status: deployed
deployed_in: v4.13.0
related: panel/backend/src/core/packs/staticVersions.ts, panel/backend/src/services/updateService.ts, panel/backend/src/api/routes/versions.ts, packs/, packs-archive/
tags: [pack, version-source, steamcmd, data-integrity, overhaul]
---

# Pack 系统真实化重构方案 — 版本源/pack 数据/SteamCMD 流程全链路校正

## 一、背景与诊断

### 1.1 现状

当前 `packs/` 启用 4 个 Pack(minecraft / terraria / palworld / factorio),`packs-archive/` 归档 8 个(rust / ark / valheim / dst / enshrouded / zomboid / dyson / satisfactory)。版本管理依赖 `panel/backend/src/core/packs/staticVersions.ts` 的人工静态版本表 + `updateService.ts` 的下载/安装流程。

### 1.2 诊断结论(5 类"虚假")

| # | 问题类别 | 证据 | 影响 |
|---|---------|------|------|
| A | **版本源数据过时/编造** | staticVersions.ts: factorio `1.1.109`+snapshot`2.0.0`(2.0 已正式发布);palworld `v0.3.3.54124`(过时,App ID 注释 2394010 错,实际 2374020);terraria `v5.2.0`(格式错,实际 1.4.4.x);8 个 archive pack 引用 `static://xxx-vanilla` 但无对应条目 | 版本接口返回假数据或直接 500;用户看到的"最新版"与实际不符 |
| B | **版本号解析与格式不匹配** | `parseVersion` 不支持 `v` 前缀 → Palworld/Terraria 排序错乱;`current_version_command` 解析丢 build 号 → 永远误报有更新;Steam 游戏版本是 depot buildid,与人工 label 无关 | 版本比对永远不相等,频繁误报更新 |
| C | **SteamCMD 游戏版本检查根本失效** | `./PalServer.sh -version` 等命令输出不固定/需图形依赖/未下载时不存在;`updateService.resolveDownloadUrl` 对 steamcmd 抛错"不支持一键下载",但版本池路由却 `curl steam://run/xxx` | Steam 游戏无法检查版本、无法一键下载;版本池下载 steamcmd 类型必失败 |
| D | **pack 数据本身虚假** | 物品 ID 编造(palworld `pal-sphere` 实际 `Item_PalSphere_01`;minecraft `diamond-pickaxe` 实际 `diamond_pickaxe`);命令未验证(palworld `/AdminCommand give_item` 不存在);Minecraft 与 Palworld RCON 端口都 25575 | 商店发放物品失败;CDK 兑换失败;多 Pack 实例端口冲突 |
| E | **架构割裂** | SteamCMD 安装分散在 updateService.install_command 与 daemon/steamcmd/installer.ts;版本池下载对 steamcmd 无专门处理 | 安装流程不可靠,无法统一维护 |

### 1.3 根因

- 早期为快速搭骨架,pack.yaml 字段大量参照 Wiki 凭记忆填写,未对照官方文档逐条核实;
- Steam 平台无稳定公开版本清单 JSON API,用人工静态表替代,但未建立持续更新机制;
- 版本号解析逻辑只考虑语义版本(x.y.z),未适配 Steam buildid 与 v 前缀格式;
- 版本池下载流程从 binary 类型复制而来,未对 steamcmd 类型做分支处理。

---

## 二、目标

- **版本源真实**:每个 Pack 的版本清单来自官方/可信 API,而非人工静态表;
- **版本比对准确**:支持 Steam buildid、v 前缀、多段版本号,不再永远误报更新;
- **SteamCMD 全链路可用**:检查/下载/安装/更新 steamcmd 类型 Pack 全部走通;
- **pack 数据逐条核实**:命令模板、物品 ID、配置字段、端口、就绪日志均对照官方文档验证;
- **8 个 archive Pack 恢复启用**:数据校正后迁回 `packs/`;
- **不破坏现有契约**:`pack-schema.ts` 字段不删,只增可选字段;向后兼容。

---

## 三、执行步骤(不区分优先级,仅开发事项与建议)

### 步骤 1:版本源真实化重构 — 引入 VersionProvider 抽象(官网优先,SteamCMD 兜底)

**目标**:用可插拔的 VersionProvider 替代 `staticVersions.ts` 的人工表,每个 Pack 绑定真实版本源。

**关键约束(调研确认)**:
- Steam Web API 的 `GetAppBuilds` / `GetAppDepotVersions` **需要发行商 API 密钥**(即该 App ID 拥有者),我们不是发行商,无法使用;
- Steam 游戏的"官网版本号"(如 Palworld "1.0")与 Steam depot buildid(数字)是两套体系,无法自动映射;
- 因此 Steam 游戏的"版本管理"实际转为"更新管理":版本展示用官网可读版本号,更新判断由 SteamCMD `app_update` 自身决定,buildid 仅作兜底记录。

**开发事项**:

1. 新建 `panel/backend/src/core/packs/versionProviders/` 目录,定义 `VersionProvider` 接口:
   ```ts
   interface VersionEntry {
     version: string;          // 人类可读版本号(如 "1.0" / "2.0.77")
     type: 'release' | 'experimental' | 'snapshot';
     buildid?: string;         // Steam depot buildid(仅 Steam 游戏,可空)
     release_date?: string;
   }
   interface VersionProvider {
     listVersions(packId: string): Promise<VersionEntry[]>;
     getLatest(packId: string): Promise<{ release: string; snapshot?: string; buildid?: string }>;
   }
   ```
2. 实现以下 Provider(均通过真实数据源,不依赖人工维护):
   - `MojangVersionProvider` — Minecraft(Mojang version_manifest,已可用,迁移过来;返回完整版本列表+build 不可用,但 Mojang 提供历史版本)
   - `OfficialSiteVersionProvider`(通用,Steam 游戏主用)— 配置官网/官方公告 URL + 版本号提取正则,解析页面获取人类可读版本号(如 Palworld 1.0);每个游戏在 pack.yaml 配置 `versions.official_url` 与 `versions.version_regex`;
   - `GitHubReleaseVersionProvider` — GitHub Releases API(适配 TShock、DST 等有官方 GitHub 的游戏)
   - `FactorioVersionProvider` — Factorio 官方 `https://factorio.com/api/latest-releases` 返回 stable/experimental 的 headless 版本号
   - `SteamCmdBuildIdProvider`(兜底)— daemon 侧 SteamCMD `app_info_print <appid>` 解析当前 public 分支 buildid;仅能拿"当前最新 buildid",无历史列表;用于官网源不可达时的兜底
3. 在 `pack.yaml` 新增可选字段 `versions.provider`(枚举:`mojang` / `official-site` / `github-release` / `factorio-official` / `steamcmd-buildid` / `static`),并新增 `versions.official_url` / `versions.version_regex`(official-site 用);
4. Steam 游戏 Provider 优先级:**official-site > github-release > steamcmd-buildid > static**;pack.yaml 声明 `provider: official-site` 时,Panel 先试官网,失败回退 steamcmd-buildid;
5. `versionProviders/index.ts` 提供 `getProvider(pack): VersionProvider` 工厂,按 `versions.provider` 字段分派;未声明时回退到现有 `source_url` HTTP fetch 逻辑(降级兼容);
6. `updateService.fetchLatestVersion` 与 `versions.ts` 路由的 `available` 端点统一改为调用 `getProvider(pack).getLatest()` / `.listVersions()`;
7. `staticVersions.ts` 标记 `@deprecated`,仅作为离线降级兜底(所有源都不可达时返回最后已知版本),不再作为主数据源;删除其中过时的人造版本数据(factorio `1.1.109` / palworld `v0.3.3.54124` / terraria `v5.2.0` 全部移除,改由 Provider 提供);
8. 修复 Palworld App ID 注释错误(2394010 → 2374020);
9. **各 Steam 游戏官网源配置**(步骤 4 校正时逐个确认,初步配置如下):
   - Palworld:`https://tech.palworldgame.com/` 提取最新版本号(当前 1.0,2026-07-10 发布)
   - Rust:`https://wiki.facepunch.com/rust/` 或 Facepunch 官方公告
   - ARK:`https://ark.wiki.gg/wiki/Dedicated_Server_Setup` 或官方公告
   - Valheim:Valheim 官方公告页面
   - DST:Klei 官方论坛/公告
   - Zomboid:Project Zomboid 官方博客
   - Terraria:TShock GitHub Releases(原版走 SteamCDM,版本号用 SteamCDM buildid)
   - Enshrouded:Keen Games 官方公告
   - Satisfactory:Coffee Stain 官方公告

**建议**:
- 所有 Provider 响应缓存 5 分钟(`node-lru-cache` 或简易 Map + TTL),避免每次请求都打远程 API;
- Provider 失败时返回明确错误码,前端可区分"源不可达"与"无新版本";
- official-site 解析正则可能因官网改版失效,需在 pack.yaml 留 `versions.fallback_buildid`(上次已知最新 buildid),解析失败时用兜底值;
- Steam 游戏"版本列表"实际只有"当前最新"一个条条目(SteamCMD 不支持选指定历史版本下载),前端版本管理页对 Steam 游戏改为"更新到最新"按钮,而非版本列表选择。

---

### 步骤 2:版本号规范化与比对逻辑修复(Steam 游戏转为"更新管理")

**目标**:支持多格式版本号;Steam 游戏不再靠版本号字符串比对(官网版本号 ≠ buildid 无法映射),改为 SteamCMD 自身判断是否最新。

**开发事项**:

1. 重写 `parseVersion` 为 `parseVersionFlex(v: string): { segments: number[]; buildId?: string; raw: string }`:
   - 去除 `v` 前缀;
   - 提取主版本段(`x.y.z` 或 `x.y`);
   - 提取 build 号(如 `0.3.3.54124` → segments `[0,3,3]` + buildId `54124`);
2. 版本比对函数 `compareVersions(a, b)` 改为:先比 segments,segments 相同时比 buildId(数值),buildId 缺失视为 0;
3. **Steam 游戏(versions.type=steamcmd)的 updateAvailable 判定逻辑重构**:
   - **不再**靠 `latest_version` vs `current_version` 字符串比对(官网版本号 "1.0" 与 appmanifest buildid 无法映射);
   - 改为:`update_available` 由 daemon 侧 SteamCMD `app_update --validate` 的 dry-run 输出判断(SteamCMD 会报告 "0x61 / downloading" 表示有更新,"fully installed" 表示已是最新);
   - `latest_version` 字段:展示官网可读版本号(如 "1.0"),供用户参考;
   - `current_version` 字段:展示 appmanifest.acf 的 buildid + 官网版本号(若能从 SteamDB 反查,否则只显示 buildid);
4. **非 Steam 游戏**(Minecraft server-jar / Factorio binary):保持现有 segments + buildId 比对;latest 与 current 都用相同数据源格式;
5. `extractLatestVersion` 对 static 源不再返回带 `v` 前缀的字符串,统一返回纯版本号;
6. `versions.ts` 路由的版本排序改用 `compareVersions`,修复 v 前缀导致排序错乱;
7. `game_versions` 表的 `version_major/minor/patch` 字段对非 semver 版本统一存 0,新增 `version_buildid` 字段(字符串,可空)存储 build 号,比对时优先用 buildid;
8. **Steam 游戏版本池简化**:Steam 游戏不支持"选指定历史版本下载"(SteamCMD 只能拉当前 public 分支最新),`game_versions` 表对 Steam 游戏只记录"当前已安装版本"一行,版本管理页对 Steam 游戏改为"更新到最新"单按钮,而非版本列表选择。

**建议**:
- 迁移脚本:`game_versions` 表新增 `version_buildid TEXT` 列,默认 NULL,不影响已有数据;
- 前端版本列表展示时,若 buildId 存在,显示为 `1.0 (build 54124)` 形式;
- Steam 游戏"检查更新"实际是触发 SteamCMD 校验,耗时较长,前端改为异步任务 + 进度展示。

---

### 步骤 3:SteamCMD 游戏版本检查与下载流程重构

**目标**:steamcmd 类型 Pack 的检查/下载/安装/更新全链路可用。

**开发事项**:

1. **版本检查**:Steam 游戏不再用 `current_version_command` 执行二进制,改为 daemon 侧探测 depot buildid:
   - daemon 新增 `GET /api/instances/:id/steam-buildid` 端点,执行 `steamcmd +force_install_dir <root> +app_info_print <appid> +quit` 解析输出得到已安装 buildid;
   - 或者读取 `<instance_root>/appmanifest_<appid>.acf` 文件的 `buildid` 字段(更轻量,推荐);
   - `updateService.executeVersionCommand` 对 steamcmd 类型改为调用 daemon 该端点,而非执行 `current_version_command`;
2. **latest 版本获取**:通过步骤 1 的 `OfficialSiteVersionProvider` 获取官网可读版本号(如 Palworld "1.0");官网不可达时回退 `SteamCmdBuildIdProvider`(daemon 侧 `app_info_print` 拿当前 public buildid);注意 SteamCMD 只能拿"当前最新 buildid",无历史列表;
3. **一键更新(取代"一键下载")**:`updateService.resolveDownloadUrl` 对 steamcmd 类型不再抛错;Steam 游戏不预先比对版本号,直接调 daemon 侧 SteamCMD 安装流程(SteamCMD 自身判断是否需要下载):
   - 新增 `POST /api/instances/:id/steam-install` daemon 端点,执行 `steamcmd +force_install_dir <root> +login anonymous +app_update <appid> validate +quit`;
   - `updateService.downloadUpdate` 对 steamcmd 类型:检查更新 → 调 daemon steam-install 端点 → 更新 servers.current_version 为新 buildid;
4. **版本池下载**:`versions.ts` 路由的 `executeVersionDownload` 对 steamcmd 类型分支处理:
   - 不走 `curl steam://run/xxx`(必失败);
   - 改为在指定节点创建临时目录,调 daemon steam-install 端点下载到该目录;
   - `download_path` 记录为该目录,`applyVersionFromPool` 时通过 daemon steam-install 复制/链接;
5. **SteamCMD 安装统一入口**:daemon 侧 `steamcmd/installer.ts` 的 `ensureInstalled` 已存在,updateService 与版本池下载统一通过 daemon 端点调用,不再在 pack.yaml 的 `install_command` 里硬编码 steamcmd 路径;
6. **pack.yaml 调整**:steamcmd 类型 Pack 的 `update.install_command` 改为可选(由 daemon steam-install 端点接管),`current_version_command` 改为可选(由 daemon buildid 探测接管);
7. **进度反馈**:steam-install 是长任务,daemon 端点通过 WS 推送 steamcmd 输出进度,updateService 的 `progressStore` 同步更新 phase(`checking` → `downloading` → `installing` → `completed`)。

**建议**:
- SteamCMD 输出含进度百分比行(如 `Update state (0x3) reconfiguring, progress: 15.23%`),daemon 解析后推送;
- anonymous 登录对部分游戏无效(如某些受密码保护 depot),pack.yaml 新增可选 `versions.steam_login: anonymous|user`,user 模式需在 daemon 配置 steam 账号;
- SteamCMD 首次运行会自更新,耗时较长,daemon 端点 timeout 设 900s。

---

### 步骤 4:pack 数据逐游戏校正 — 命令/物品/配置/端口/就绪日志

**目标**:每个 Pack 的字段均对照官方文档/Wiki 逐条核实,杜绝编造。

**开发事项(按游戏)**:

#### 4.1 minecraft-vanilla
1. 校正物品 ID:统一用 Mojang 官方蛇形命名(`diamond_pickaxe` 而非 `diamond-pickaxe`),`give` 命令格式 `give <player> <item>[<component>=<value>] <count>`(1.20.5+ 新格式);
2. 补全 `config_files` schema:`server.properties` 全部字段(server-port/max-players/motd/difficulty/gamemode/pvp/enable-rcon/rcon.port/level-name/view-distance/online-mode/white-list/spawn-protection/enable-command-block/level-seed/gamemode/pvp/...);
3. RCON 默认端口保持 25575(与 Palworld 冲突 → 见 4.3);
4. `ready_pattern` 验证:`Done ([\d.]+s)! For help, type "help"`(已正确);
5. `stop_command: stop`(已正确);
6. 版本源:已用 Mojang API,迁移到 `MojangVersionProvider`(步骤 1),`versions.type: server-jar` 保持。

#### 4.2 terraria-vanilla + terraria-tshock(已确认双 Pack)
1. **分发源决策(已确认新增)**:原版 Terraria 服务端通过 SteamCMD(App ID 105600),TShock 提供独立二进制(更灵活、有 RCON)。**新增 `terraria-tshock` Pack**,原 `terraria-vanilla` 保持 SteamCDM 分发;
2. **待开发需求(留坑)**:Pack 详情页需显示 `variant_type` 区分(原版/tshock),版本号显示需区分 SteamCDM buildid 与 TShock GitHub Release 版本号;前端在 Pack 选择页对同一 game 的多 variant 提供切换入口;该需求登记到 `docs/plans/pending-requirements.md`(变体展示与版本号差异化显示);
3. 校正物品 ID:Terraria 原版 `give` 命令格式为 `give <player> <item-id> <count>`,item-id 是**数字 ID**(如铜阔剑 ID=1),static_list 必须改为数字 ID + 显示名映射;TShock 版支持物品名拼写但建议统一数字 ID;
4. 校正命令:`save` → 已正确;`playing` → 已正确;`kick <player>` → 已正确;
5. `ready_pattern: 'Listening on port|Server started'` 验证(SteamCDM 版输出格式);TShock 版 `ready_pattern: 'TShock successfully initialized|Server started'`;
6. `config_files` 补全 `serverconfig.txt` 全部字段;TShock 版补全 `tshock/config.json` 字段;
7. 版本源:SteamCDM 版用 `OfficialSiteProvider`(官网,见步骤 1.9) + `SteamCmdBuildIdProvider` 兜底(App ID 105600);TShock 版用 `GitHubReleaseVersionProvider`(https://github.com/Pryaxis/TShock/releases);
8. 修正版本号格式:Terraria 服务端版本是 `1.4.4.x` 而非 `v5.2.0`;TShock 版本号格式为 `5.x.x`(独立版本号,与 Terraria 主版本解耦)。

#### 4.3 palworld-vanilla
1. **RCON 端口冲突修复**:默认 RCON 端口从 25575 改为 25575 之外的值(建议 25585),避免与 Minecraft 冲突;`config_key.port_key: RCONPort` 保持;
2. **命令模板核实**:Palworld RCON 命令实际为 `ShowPlayers` / `KickPlayer <player>` / `BanPlayer <player>` / `Broadcast <message>` / `Save` / `Shutdown <seconds> <message>`(官方文档),**无 `/AdminCommand` 前缀**;校正所有 commands 与 business 命令,移除编造的 `/AdminCommand give_item` 等;
3. **物品发放(如实告知)**:Palworld 原版 RCON **不支持发放物品**,`business.shop.enabled: false`、`business.cdk.enabled: false`;前端商店/CDK Tab 对该 Pack 隐藏,并在 Pack 详情页如实标注"该游戏原版不支持物品发放";**不做 uMod variant**(无原厂支持,避免假数据);static_list 字段移除(无意义);
4. **版本源**:`provider: official-site`,`official_url: https://tech.palworldgame.com/`,提取最新版本号;当前最新为 **1.0**(2026-07-10 正式发布,退出 Early Access);源不可达时回退 `SteamCmdBuildIdProvider`(App ID 2374020);
5. `ready_pattern: 'World Settings Loaded|StartListenServer'` 验证;
6. `config_files` 补全 PalWorldSettings.ini 全部字段(DifficultyType/ServerName/ServerDescription/PublicPort/PublicListenPort/MaxPlayers/ServerPassword/ServerAdminPassword/RCONEnabled/RCONPort/...);
7. 修正 App ID 注释(2374020)。

#### 4.4 factorio-vanilla
1. **版本源**:用 `FactorioVersionProvider`(官方 `https://factorio.com/api/latest-releases`),返回 stable/experimental 的 headless 版本号;
2. **版本号格式**:Factorio 是标准 semver(`2.0.77`),parseVersionFlex 直接支持;
3. **物品特殊属性自适应(已确认方案)**:Factorio 2.0+ 支持 5 档品质(normal/uncommon/rare/epic/legendary),`business.shop.give_command` 的 Lua 脚本中 `quality='{{quality}}'` 仅 2.0+ 有效,1.1.x 不支持 → 在 pack.yaml 的 `items` 字段新增 `special_attributes` 声明(数组,每项含 `name` / `applicable_versions` 正则或范围 / `default_value` / `description` / `fallback_behavior`),项目接受 Pack 时按此规则自适应设置参数(版本不匹配时自动降级、隐藏该属性或回退到 default_value),**无需拆分 Pack 也无需硬编码 min_version 检查**;该机制同样适用于其他游戏的特殊属性(如 Minecraft 附魔、Rust 皮肤、ARK 品质);
4. `config_files` schema 已较全,补全 `autosave_interval` 默认值;
5. `world_generation` 字段已存在,验证 map-gen-settings.json schema 与官方一致;
6. `ready_pattern: 'changing state from\([^)]+\) to\(InGame\)'` 验证;
7. 版本池下载:`download_pattern: 'https://factorio.com/get-download/{{version}}/headless/linux64'` 已正确,验证 2.0 链接是否仍有效。

#### 4.5 rust-vanilla(archive 恢复)
1. 协议:WebRCON(HTTP+JSON),`default_port: 28016`;
2. 命令核实:`say` / `give <player> "shortname" amount` / `kick` / `ban` / `save` / `players`(以原版命令为准;若 uMod 插件命令与原版有差异,直接在命令模板中校正,**不新增 uMod variant**);
3. 版本源:`OfficialSiteProvider`(官网,见步骤 1.9) + `SteamCmdBuildIdProvider` 兜底(App ID 258550);
4. `ready_pattern: 'Server startup complete|Unloading 1 unused Assets'` 验证;
5. 物品 ID:Rust 物品用 shortname(如 `rifle.ak` / `ammo.rifle`),需对照 `https://umod.org/documentation/rust/items` 全量校正;
6. `config_files` 补全 `server/<identity>/ServerAuto.cfg` 字段。

#### 4.6 ark-vanilla(archive 恢复)
1. 命令核实:`broadcast` / `GiveItem "Blueprint'/Game/...'" Quantity Quality Force` / `KickPlayer` / `BanPlayer` / `ListPlayers` / `SaveWorld`;
2. 版本源:`OfficialSiteProvider`(官网,见步骤 1.9) + `SteamCmdBuildIdProvider` 兜底(App ID 376030);
3. `ready_pattern: 'Primal Game Data loaded|Setting breakpad minidump AppType=Server'` 验证;
4. 物品 ID:ARK 用 Blueprint 路径,需对照 ARK Wiki 全量整理;
5. RCON 端口 27020,游戏端口 7777,query端口 27015(需在 startup 声明多端口);
6. `config_files` 补全 GameUserSettings.ini 与 Game.ini 字段。

#### 4.7 valheim-vanilla(archive 恢复)
1. 协议:`stdin`(原版无 RCON,部分版本支持 `+rcon` 参数 → 调研是否启用);
2. 命令:`info` / `kick` / `ban` / `unban` / `save` / `banned`;**物品发放如实告知**:Valheim 原版 stdin 控制台支持 `spawn <item> <amount>` 命令(需 admin/dev 权限),会在玩家附近生成物品而非直接入背包,且**要求玩家在线**;`business.shop.enabled: true`,`give_command: 'spawn {{item}} {{count}}'`,前端商店页标注"通过 spawn 在玩家附近生成,需玩家在线,非直接入背包";**不做 uMod variant**(无原厂支持,避免假数据);
3. 版本源:`OfficialSiteProvider`(官网,见步骤 1.9) + `SteamCmdBuildIdProvider` 兜底(App ID 896660);
4. `ready_pattern: 'Game server connected|DungeonDB Start|World saved|game server'` 验证(过宽,应收窄为 `'Game server connected'` 单一锚点);
5. 端口:2456-2458 三连续端口,需在 startup 声明;
6. `stop_command: ''` + daemon SIGINT 信号停止(已正确);
7. 物品 ID:Valheim 物品用 Prefab 名(如 `Wood` / `IronSword` / `BronzePickaxe`),需对照 Valheim Wiki 全量校正 static_list 大小写敏感。

#### 4.8 dst-vanilla(饥荒联机版,archive 恢复)
1. 协议:`stdin`(原版控制台);App ID 473480(DST) + 343050(DST Dedicated Server);
2. 命令:c_listallplayers / c_spawn / c_give / TheNet:Kick / TheNet:Ban;
3. 版本源:`OfficialSiteProvider`(官网,见步骤 1.9) + `SteamCmdBuildIdProvider` 兜底;
4. 物品 ID:prefab 名(如 `flint` / `log` / `twigs`),对照 DST Wiki;
5. `ready_pattern` 验证;
6. 配置:cluster.ini + server.ini + worldgenoverride.lua。

#### 4.9 enshrouded-vanilla(archive 恢复)
1. App ID 2278520;协议:`stdin`(原版无 RCON);
2. 版本源:`OfficialSiteProvider`(官网,见步骤 1.9) + `SteamCmdBuildIdProvider` 兜底;
3. 命令有限(原版控制台支持少);
4. 配置:server.json;
5. `ready_pattern` 验证。

#### 4.10 zomboid-vanilla(僵尸毁灭工程,archive 恢复)
1. App ID 380870;协议:RCON(zomboid 支持);
2. 版本源:`OfficialSiteProvider`(官网,见步骤 1.9) + `SteamCmdBuildIdProvider` 兜底;
3. 配置:ServerName.ini 系列;
4. `ready_pattern` 验证;
5. 物品 ID:module.item 形式(如 `Base.Axe`)。

#### 4.11 dyson-vanilla(戴森球计划,已确认彻底移除)
1. App ID 1366540(**DSP 官方未提供独立专用服务端**,经核实无 Linux dedicated server 二进制);
2. **决策(已确认彻底移除)**:从 Pack 列表彻底移除,从 `packs-archive/` 删除 dyson-vanilla 目录,不做假支持、不做逆向或非官方方案;在 `docs/guides/pack-authoring-guide.md` 中记录"DSP 因无官方服务端不支持"作为参考案例,避免后续误添加。

#### 4.12 satisfactory-vanilla(满意工厂,archive 恢复)
1. App ID 1690800(Experimental) / 526870(Stable);
2. 协议:`stdin` + REST API(可选);
3. 版本源:`OfficialSiteProvider`(官网,见步骤 1.9) + `SteamCmdBuildIdProvider` 兜底;
4. 配置:ServerSettings.json;
5. `ready_pattern` 验证。

**建议**:
- 每个游戏校正时,先运行一次真实实例抓取 stdout/命令输出,对照 pack.yaml 字段;
- 物品池过大的游戏(Minecraft/Terraria/ARK)可改为 `source.type: dynamic`,通过 Panel 脚本从游戏数据文件生成,而非硬编码 static_list;
- 校正完成的 Pack 在 pack.yaml 头部注释标注 `# verified: <date> <source>`。

---

### 步骤 5:物品池真实化与动态生成(含特殊属性自适应)

**目标**:物品 ID 与游戏内部一致,商店/CDK 发放物品实际可用;物品的特殊属性(品质/附魔/皮肤等)在 pack.yaml 声明,系统自适应处理。

**开发事项**:

1. 扩展 `pack-schema` 的 `items.source.type` 枚举:`static` / `dynamic` / `remote`;
2. `dynamic` 类型:Panel 启动时通过 daemon 执行游戏自带命令(如 Minecraft `/give` 列表、Terraria 非官方 `/itemlist`)或解析游戏数据文件(如 Minecraft 的 `reports/registries.json`、Factorio 的 `locale/` 目录)生成物品清单,缓存到 `game_items` 表;
3. `remote` 类型:从可信源拉取(如 Minecraft 从 `https://minecraft-data.com/`、Rust 从 uMod items 列表);
4. 校正所有现有 `static_list` 的物品 ID 命名规则:
   - Minecraft:蛇形 `diamond_pickaxe`(对照 `reports/registries.json`)
   - Palworld:`Item_PalSphere_01` 等真实命名
   - Terraria:数字 ID + 显示名
   - Factorio:已正确(蛇形)
   - ARK:Blueprint 路径
   - Rust:shortname
   - DST:prefab 名(`Base.Axe`)
5. `shopService` 发放物品前校验 item 名是否在 `game_items` 表,不存在返回明确错误(而非让游戏命令静默失败);
6. 物品分类(categories)统一为枚举:`material / weapon / armor / tool / consumable / ammo / cosmetic / other`,各游戏映射到该枚举;
7. **物品特殊属性自适应机制(新增,已确认方案)**:在 `items` 字段下新增 `special_attributes` 数组,声明该 Pack 物品可能具有的特殊属性及其规则:
   ```yaml
   items:
     special_attributes:
       - name: quality                          # 属性名(如 quality/enchantment/skin)
         display_name: 品质                       # 前端展示名
         applicable_versions: '>=2.0.0'          # 适用版本范围(语义版本约束)
         default_value: normal                   # 默认值(版本不匹配时回退)
         fallback_behavior: hide                 # 降级行为:hide(隐藏)/default(用默认值)/disable(禁用该物品)
         values: [normal, uncommon, rare, epic, legendary]  # 可选值枚举
         description: 'Factorio 2.0+ 支持 5 档品质,1.1.x 不支持'
         command_template_key: '{{quality}}'     # 命令模板中对应的占位符
   ```
8. 项目接受 Pack 时(即 Panel 加载 pack.yaml 时),`itemAttributeResolver` 模块按 `applicable_versions` 与当前实例版本比对,自适应决定:
   - 版本匹配 → 暴露该属性给前端商店配置页;
   - 版本不匹配 → 按 `fallback_behavior` 处理(hide/default/disable);
   - 命令模板渲染时,被隐藏的属性不渲染占位符或用 default_value 替换;
9. 该机制适用于所有游戏的特殊属性:Factorio 品质、Minecraft 附魔/物品组件、Rust 皮肤、ARK 品质系数、Terraria 前缀等;每个 Pack 在 `special_attributes` 中声明自己的特殊属性规则,系统统一处理。

**建议**:
- 物品清单更新机制:`game_items` 表记录 `pack_id` + `version_range`,游戏大版本更新物品时重新生成;
- 前端商店配置页支持搜索物品(按 display_name / internal_name);
- 前端特殊属性配置页按 `special_attributes` 声明动态渲染(版本不匹配时按 fallback_behavior 隐藏或禁用)。

---

### 步骤 6:命令模板验证与契约化

**目标**:所有 commands / business 命令模板经过真实实例验证。

**开发事项**:

1. 建立命令验证清单(每个 Pack 一份 markdown),记录每条命令的真实输出样本;
2. 对每条命令模板,用真实实例执行验证:`broadcast` / `give_item` / `kick_player` / `ban_player` / `list_players` / `save_world` / `whitelist_add` 等;
3. 修正所有未验证命令:
   - Palworld:移除 `/AdminCommand` 前缀,改为 `ShowPlayers` / `KickPlayer <player>` / `BanPlayer <player>` / `Broadcast <message>` / `Save`;
   - Terraria:`give` 命令 item 参数改为数字 ID;
   - Valheim:`give_item` 标记为不支持(vanilla);
   - Palworld:`give_item` 标记为不支持(vanilla RCON),需 uMod;
4. `commandDispatcher` 执行前校验命令模板变量是否全部渲染,未渲染变量(如 `{{quality}}` 对不支持品质的游戏)报错而非发空命令;
5. `business.shop` / `business.cdk` 的 `give_command` 必须与 `commands.give_item` 一致,或显式声明差异;
6. 不支持某能力的 Pack,对应 `business` 字段设 `enabled: false`,前端隐藏对应 Tab。

**建议**:
- 命令模板新增 `validate` 字段(可选),记录上次验证的版本号与日期;
- 集成测试:对每个 Pack 用 Mock daemon 跑一遍命令分发,断言渲染后的命令字符串符合预期格式。

---

### 步骤 7:配置 schema 补全与多配置文件规范化

**目标**:`config_files` 字段覆盖游戏全部常用配置,前端配置页可用。

**开发事项**:

1. 每个 Pack 的 `config_files` 对照官方文档补全字段:
   - Minecraft `server.properties`:补全 `enable-command-block` / `level-seed` / `generate-structures` / `max-world-size` / `network-compression-threshold` / `resource-pack` / `resource-pack-sha1` / `require-resource-pack` / `snooper-enabled` / `use-native-transport` / `view-distance` / `simulation-distance` / `rate-limit` / `max-players` 等;
   - Palworld `PalWorldSettings.ini`:补全 `DifficultyType` / `PublicPort` / `PublicListenPort` / `ServerName` / `ServerDescription` / `ServerPassword` / `ServerAdminPassword` / `RCONEnabled` / `RCONPort` / `MaxPlayers` / `DayTimeSpeedRate` / `NightTimeSpeedRate` / `ExpRate` / `PalCaptureRate` / `PalSpawnNumRate` / `PalDamageRateAttack` / `PalStomachDecreaceRate` / `PlayerStomachDecreaceRate` / `PlayerAutoHPRegeneRate` / `PalEggDefaultHatchingTime` / `bEnablePlayerToPlayerDamage` / `bEnableFriendlyFire` / `bActiveMute` / `bEnableAfkKick` 等;
   - ARK `GameUserSettings.ini` + `Game.ini`:全量字段;
   - Rust `ServerAuto.cfg` + `server.cfg`;
   - Valheim 启动参数配置;
   - DST `cluster.ini` + `server.ini` + `worldgenoverride.lua`;
2. 每个 schema 字段标注:`type` / `default` / `min` / `max` / `enum_values` / `description` / `requires_restart`;
3. `configService` 读取/写入配置时按 `config_files` 多文件处理,每个文件独立读写;
4. 配置变更后,若 `requires_restart: true`,前端提示"需重启实例生效";
5. `config_files` 的 `format` 支持:`properties` / `ini` / `json` / `lua` / `toml`,每种格式实现对应的读写器。

**建议**:
- 配置字段过多时,按功能分组(如 Palworld 的战斗/经济/生成速率/服务器),前端按组折叠展示;
- 敏感字段(密码)标注 `sensitive: true`,前端脱敏显示。

---

### 步骤 8:端口分配与冲突检测规范化

**目标**:多 Pack 实例端口不冲突,端口分配自动化。

**开发事项**:

1. `pack.yaml` 的 `startup` 新增可选字段 `required_ports`(数组),声明该游戏占用的所有端口及协议:
   ```yaml
   required_ports:
     - { port: 25565, protocol: tcp, name: game, primary: true }
     - { port: 25575, protocol: tcp, name: rcon, primary: false }
   ```
2. Minecraft 与 Palworld RCON 默认端口冲突修复(步骤 4.3);
3. Valheim 三端口(2456-2458)、ARK 多端口(7777/27015/27020)在 `required_ports` 声明;
4. `servers` 创建逻辑:`portAllocator` 按 `required_ports` 批量分配,检测连续端口占用(如 Valheim 需 2456-2458 连续);
5. `servers` 表新增 `allocated_ports` JSON 字段,记录该实例占用的所有端口;
6. 实例删除时释放 `allocated_ports` 中所有端口。

**建议**:
- 端口分配支持 `port_range` 配置(如游戏端口 25565-25664),在 `panel.env.template` 配置;
- 前端创建实例页显示该 Pack 需要的端口列表,用户可手动指定或自动分配。

---

### 步骤 9:就绪日志(ready_pattern)与停止流程校正

**目标**:实例状态判定准确,不误报就绪/不卡在 starting。

**开发事项**:

1. 每个 Pack 的 `ready_pattern` 用真实实例 stdout 样本验证,收窄过宽的正则(如 Valheim `game server` 过宽,会匹配任意含该词的日志);
2. `stop_command` 与 `stop_method` 规范化:
   - RCON 游戏:走 `stop_command`(RCON 发送);
   - stdin 游戏:走 stdin 写入;
   - 信号停止游戏(Valheim):`stop_method: sigint`(daemon 端处理,不在 pack.yaml 声明 stop_command);
   - 新增 `stop_method` 字段枚举:`rcon` / `stdin` / `sigint` / `sigterm` / `kill`;
3. `stop_timeout` 按游戏实际停止耗时调整(ARK 60s,其他 30s);
4. daemon 的 `SIGINT_STOP_GAMES` 集合改为读 `pack.yaml.stop_method`,而非硬编码游戏名列表。

**建议**:
- ready_pattern 提供 `ready_patterns`(数组)替代单值,任一匹配即视为就绪;
- 新增 `failure_pattern`(可选),匹配到即标记实例 error 状态(如 `FATAL` / `Segmentation fault`)。

---

### 步骤 10:archive Pack 恢复与迁移

**目标**:archive Pack 校正后迁回 `packs/` 启用(已确认全部恢复)。

**开发事项**:

1. 按步骤 4.5-4.12 逐个校正 archive Pack 数据(**已确认 7 个全部恢复**:rust / ark / valheim / dst / enshrouded / zomboid / satisfactory;dyson 彻底移除不恢复);
2. 校正完成后,将 `packs-archive/<pack>/` 移动到 `packs/<pack>/`;
3. 每个 Pack 配套 `AGENTS.md`(参照 minecraft-vanilla/AGENTS.md 模板);
4. `packs:validate` 脚本对全部 12 个 Pack 跑 zod 校验(4 个原启用 + 7 个恢复 + 1 个新增 terraria-tshock = 12 个);
5. `packs-archive/` 目录清空后删除(或保留空目录 + README 说明已全部迁移);
6. dyson-vanilla 目录从 `packs-archive/` 直接删除(不保留),理由记录在 pack-authoring-guide.md。

**建议**:
- 迁移分批进行,每批 2-3 个 Pack,校正一批迁移一批,降低风险;
- 每个 Pack 迁移后,用真实实例跑一遍 start → command → stop 全流程验证。

---

### 步骤 11:测试与验证体系

**目标**:pack 系统有可回归的测试套件,防止再次劣化。

**开发事项**:

1. **契约测试**:每个 Pack 的 `pack.yaml` 通过 zod 校验(已有 `packs:validate`,扩展为 CI 必跑);
2. **命令模板单测**:对每个 Pack 的 commands / business 命令模板,用固定变量渲染,断言输出字符串符合预期格式(如 `give Steve diamond_pickaxe 1`);
3. **VersionProvider 集成测试**:对每个 Provider 用 nock/MSW mock 远程 API 响应,断言 `listVersions` / `getLatest` 返回正确结构;
4. **版本比对单测**:`parseVersionFlex` 与 `compareVersions` 覆盖 semver / v 前缀 / buildid / 多段版本号场景;
5. **SteamCMD 流程 E2E**:用真实 SteamCMD(在测试节点)跑一次 Palworld/Valheim 的 install → check → update 流程;
6. **pack 数据真实性校验脚本**:定期(如每月)拉取各游戏官方版本号,与 `game_versions` 表比对,差异告警;
7. **前端 Mock 回归**:商店配置页 / 版本管理页 / 配置文件页 用 Mock 数据跑 UI 回归。

**建议**:
- 测试数据 fixture 放 `public/test_cases/packs/`,每个 Pack 一份;
- CI 中 `npm run check` 包含 `packs:validate` + 命令模板单测。

---

### 步骤 12:文档与版本记录

**开发事项**:

1. 更新 `version.md`:记录本次 pack 系统重构的所有变更(按 bb.md 版本号规则,属全新功能重构,中版本号 +1);
2. 更新 `README.md`:若 pack 目录结构或使用方式变化,更新用户向说明;
3. 每个 Pack 的 `pack.yaml` 头部注释标注数据来源与校正日期;
4. 新增 `docs/guides/pack-authoring-guide.md`:Pack 编写规范,供后续新增 Pack 参考(字段含义、数据来源、验证清单);
5. `.trae/documents/` 记录本次重构的过程留痕(按 rules-5 规范)。

---

## 四、风险与建议

### 4.1 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| Steam Web API 需 key 且有速率限制 | 版本源不可达 | 降级到 daemon 侧 SteamCMD 探测;缓存 5 分钟;无 key 时用 SteamDB 公开页面 |
| 部分游戏原版不支持发放物品(Palworld 完全不支持;Valheim 仅 spawn 在玩家附近生成,需在线) | 商店/CDK 功能受限 | Palworld 显式 `enabled: false` 并前端隐藏;Valheim 保留 enabled 但前端如实标注限制;不做 uMod variant(无原厂支持) |
| SteamCMD 安装耗时久(首次自更新) | 用户感知卡顿 | daemon WS 推送进度;前端展示进度条 |
| 物品池动态生成依赖游戏数据文件 | 首次启动慢 | 异步生成,不阻塞实例启动;生成完成前用 static_list 兜底 |
| 版本号格式多样(buildid vs semver) | 比对逻辑复杂 | parseVersionFlex 统一抽象,所有比对走同一函数 |
| archive Pack 数据校正工作量大 | 周期长 | 分批迁移,先恢复高优先级(rust/ark/valheim) |

### 4.2 建议

- 优先打通 SteamCMD 全链路(步骤 1+2+3),这是 8 个 archive Pack 的共同前置;
- 物品池(步骤 5)与命令验证(步骤 6)可并行推进,每个 Pack 独立;
- 建议引入"Pack 校正清单"概念,每个 Pack 一份,完成后归档到 `docs/reports/evaluation/`;
- 考虑新增 `pack-health` 命令,一键检查所有 Pack 的版本源连通性、命令可用性、配置完整性;
- 长期可考虑社区共建 Pack(如 Pterodactyl egg 模式),但当前先聚焦内置 Pack 真实化。

---

## 五、交接状态

- **工程过程**:完成代码检查(staticVersions.ts / loader.ts / registry.ts / updateService.ts / versions.ts route / steamcmd installer / 12 个 pack.yaml),诊断 5 类问题,输出本方案。
- **交接状态**:方案 planning,待人类 review 后进入执行。
- **最终结果**:本方案文档 `docs/plans/pack-system-overhaul-plan.md`,12 个执行步骤,覆盖版本源真实化、版本号规范化、SteamCMD 流程重构、pack 数据校正、archive 恢复、测试体系。
