# 游戏专用服务器调研报告（Valheim + Project Zomboid）

> 调研日期：2026-07-20
> 用途：为 `pack.yaml` 配置文件补充 Valheim 与 Project Zomboid 两个游戏的专用服务器技术信息
> 说明：所有信息均来源于官方网站、官方 wiki、Steam 社区、GitHub 项目 README 等权威渠道，每条关键信息后均附 URL 来源
> 注：本报告对任务描述中的若干假定（如 Valheim `-rcon` 原生参数、PZ `-useradmin` 参数、PZ `broadcast` 命令）做了核实，与官方资料不一致处已在文中显式标注。

---

## 目录

- [游戏1：Valheim（英灵神殿）](#游戏1valheim英灵神殿)
  - [Steam App ID](#steam-app-id)
  - [SteamCMD 下载](#steamcmd-下载)
  - [启动命令](#启动命令)
  - [启动参数列表](#启动参数列表)
  - [就绪日志特征](#就绪日志特征)
  - [停止命令](#停止命令)
  - [配置文件](#配置文件)
  - [存档目录](#存档目录)
  - [玩家 / 物品 / 聊天命令](#玩家--物品--聊天命令)
  - [默认端口](#默认端口)
  - [RCON 端口与配置](#rcon-端口与配置)
  - [必需变量（pack.yaml 中 `{{var}}` 占位符）](#必需变量packyaml-中-var-占位符)
  - [EULA / Token 要求](#eula--token-要求)
  - [资料来源 URL](#资料来源-url)
- [游戏2：Project Zomboid（僵尸毁灭工程）](#游戏2project-zomboid僵尸毁灭工程)
  - [Steam App ID](#steam-app-id-1)
  - [SteamCMD 下载](#steamcmd-下载-1)
  - [启动命令](#启动命令-1)
  - [启动参数列表](#启动参数列表-1)
  - [就绪日志特征](#就绪日志特征-1)
  - [停止命令](#停止命令-1)
  - [配置文件](#配置文件-1)
  - [存档目录](#存档目录-1)
  - [玩家 / 物品 / 聊天命令](#玩家--物品--聊天命令-1)
  - [默认端口](#默认端口-1)
  - [RCON 配置方式](#rcon-配置方式)
  - [必需变量（pack.yaml 中 `{{var}}` 占位符）](#必需变量packyaml-中-var-占位符-1)
  - [EULA / Token 要求](#eula--token-要求-1)
  - [资料来源 URL](#资料来源-url-1)
- [关键差异对比表](#关键差异对比表)
- [pack.yaml 实施建议](#packyaml-实施建议)

---

## 游戏1：Valheim（英灵神殿）

### Steam App ID

| 项目 | 值 |
|------|-----|
| 游戏本体 App ID | **892970** |
| 专用服务器 App ID | **896660** |

> ⚠️ 两者不同：SteamCMD 必须使用 `896660` 下载服务端，而非游戏本体的 `892970`。

来源：[Valheim Fandom Wiki - Dedicated servers](https://valheim.fandom.com/wiki/Dedicated_servers)、[Steam 商店页 - Valheim Dedicated Server](https://store.steampowered.com/app/896660/Valheim_Dedicated_Server/)

### SteamCMD 下载

**支持 anonymous 匿名下载**（无需 Steam 账户登录）。

```bash
steamcmd +force_install_dir /home/valheim/server \
         +login anonymous \
         +app_update 896660 validate \
         +quit
```

服务端文件约 1.5 GB，首次安装耗时 2–4 分钟。

来源：[Space-Node 博客 - Valheim Dedicated Server Setup 2026](https://space-node.net/blog/valheim-dedicated-server-2026)、[BlastVPS Guide](https://blastvps.com/blog/valheim-dedicated-server-setup-guide)

### 启动命令

Linux 启动脚本示例（`start_server.sh`）：

```bash
#!/bin/bash
export templdpath=$LD_LIBRARY_PATH
export LD_LIBRARY_PATH=./linux64:$LD_LIBRARY_PATH
export SteamAppId=892970

./valheim_server.x86_64 \
  -nographics -batchmode \
  -name "My Valheim Server" \
  -port 2456 \
  -world "Dedicated" \
  -password "YourPassword123" \
  -savedir /home/valheim/saves \
  -public 1 \
  -crossplay

export LD_LIBRARY_PATH=$templdpath
```

| 项目 | 值 |
|------|-----|
| Linux 服务端二进制文件名 | **`valheim_server.x86_64`** |
| Linux 启动脚本 | **`start_server.sh`** |
| Windows 启动脚本 | `start_headless_server.bat` |
| 必须设置的环境变量 | `SteamAppId=892970`、`LD_LIBRARY_PATH=./linux64:$LD_LIBRARY_PATH` |

> ℹ️ Steam 启动脚本 `start_server.sh` 本身设置 `SteamAppId=892970`（游戏本体 ID，不是服务端 ID），这是 Iron Gate 官方脚本默认行为，用于 Steamworks API 初始化。

来源：[Valheim Fandom Wiki - Dedicated servers](https://valheim.fandom.com/wiki/Dedicated_servers)、[Supercraft Wiki - Launch Parameters](https://b-prod-ak38sf.supercraft.host/wiki/valheim/server_settings/)

### 启动参数列表

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `-name "<string>"` | 字符串 | "My server" | 服务器在服务器浏览器中显示的名称 |
| `-port <number>` | 数字 | **2456** | 服务器游戏端口（同时占用 port+1=2457 与 port+2=2458 UDP） |
| `-world "<string>"` | 字符串 | "Dedicated" | 世界名称，决定存档文件名（`<world>.db` / `<world>.fwl`）。改变此参数会创建新世界 |
| `-password "<string>"` | 字符串 | （无） | **必填**。服务器加入密码，长度至少 5 字符，且不能包含在 `-name` 中 |
| `-public <0\|1>` | 0/1 | 1 | 1=显示在社区服务器列表；0=仅可通过 IP 直连 |
| `-savedir <path>` | 路径 | Linux: `~/.config/unity3d/IronGate/Valheim/`<br>Win: `%USERPROFILE%/AppData/LocalLow/IronGate/Valheim/` | 自定义存档根目录（覆盖默认路径，存放 worlds 与权限文件） |
| `-crossplay` | 开关 | 关 | 启用 Crossplay 后端（Microsoft Azure PlayFab），允许 Xbox / PC Game Pass 玩家加入 |
| `-logFile <path>` | 路径 | （stdout） | 日志输出文件路径 |
| `-saveinterval <seconds>` | 秒 | 1800（30 分钟） | 世界自动保存间隔 |
| `-backups <count>` | 数字 | 4 | 自动备份保留数量 |
| `-backupshort <seconds>` | 秒 | 7200（2 小时） | 第一个自动备份的间隔 |
| `-backuplong <seconds>` | 秒 | 43200（12 小时） | 后续自动备份的间隔 |
| `-nographics` | 开关 | — | Unity 引擎参数，不初始化图形设备 |
| `-batchmode` | 开关 | — | Unity 引擎参数，以 headless 模式运行 |

> ⚠️ **关于任务描述中提到的 `-rcon` / `-rconpassword` 参数：**
> 经核实，**Valheim 原生 vanilla 服务端不支持 RCON，也没有 `-rcon`、`-rconpassword`、`-rconport` 等启动参数**。部分第三方托管面板文档（如 ServerFlex）列出了这些参数名，但在原生二进制中并不生效。RCON 功能必须通过 BepInEx mod 实现（详见 [RCON 端口与配置](#rcon-端口与配置) 章节）。

来源：
- [Valheim 官方说明书 PDF（bojarcz.uk 镜像）](https://www.bojarcz.uk/Syf/Valheim%20Dedicated%20Server%20Manual.pdf)
- [Supercraft Wiki - Launch Parameters](https://b-prod-ak38sf.supercraft.host/wiki/valheim/server_settings/)
- [Fatality Servers - Valheim Server Setup Guide](https://fatalityservers.com/kb/valheim-server-setup-guide/)

### 就绪日志特征

**就绪 stdout 日志特征字符串：`Game server connected`**

启动序列典型输出顺序：
```
Zonesystem Start <pid>
Added <num> locations, <num> vegetations, ...
DungeonDB Start <pid>
Load world: <world name>
Loading <count> zdos, my id <num> data version:<num>
...
Game server connected
Server '<ServerName>' has been registered with the community hub
```

- **Pelican / Pterodactyl egg 官方 YAML** 中将 `done: 'Game server connected'` 作为 ready_pattern 判定字符串
- 也可使用更宽松的 `DungeonDB Start` 作为早期就绪信号（出现此行且无 `Game server connected failed` 后续即视为可用）
- 失败信号：`Game server connected failed`（无法连接到 Steam Master Servers）

建议 `ready_pattern` 正则：
```regex
Game server connected
```

来源：
- [Pelican Eggs - Valheim BepInEx YAML（GitHub Raw）](http://raw.githubusercontent.com/pelican-eggs/games-steamcmd/refs/heads/main/valheim/valheim_bepinex/egg-valheim-bep-i-nex.yaml) — 关键行：`done: 'Game server connected'`
- [Valheim Fandom Wiki - Dedicated servers#Game server (Steam A2S)](https://valheim.fandom.com/wiki/Dedicated_servers#Game_server_(Steam_A2S))
- [Valheim Server Help - Troubleshooting LAN](https://valheim-server-help.github.io/serverTroubleshootingLAN/)
- [Selfhosting.sh - Valheim Server](https://selfhosting.sh/apps/valheim-server/) — 原文："The server is ready when you see `Game server connected`."

### 停止命令

| 方式 | 命令 | 说明 |
|------|------|------|
| **优雅停止（推荐）** | `Ctrl+C`（SIGINT） | 官方推荐方式，触发世界保存后退出 |
| 进程信号 | `kill -INT <pid>` | 等同 Ctrl+C |
| 强制终止（不推荐） | `kill -9 <pid>` | **可能造成存档损坏**，仅在服务器卡死时使用 |

> ⚠️ **重要：Valheim 原生 vanilla 服务端没有 `save`、`quit`、`stop` 等控制台命令用于停止服务端。** 任何通过 stdin 向服务端进程发送文本命令的尝试都不会触发停止。必须使用 SIGINT 信号。
>
> ⚠️ **关于任务描述中的 `save; quit` 复合 RCON 命令：**
> - vanilla 服务端**不支持 RCON**，因此无法通过 RCON 发送复合命令
> - 即便安装了 Rcon_Commands mod，mod 实现是逐条命令处理，**不接受分号分隔的多命令拼接**
> - 如需通过 RCON 实现保存+退出，应分两次发送：先 `save`，等待响应后再 `quit`（且需 mod 暴露这两个命令）

来源：
- [Valheim 官方说明书 PDF](https://www.bojarcz.uk/Syf/Valheim%20Dedicated%20Server%20Manual.pdf) — 原文："When you wish to stop running the server, it is important that you close it by pressing CTRL+C in the Command-window."
- [Pelican Eggs YAML](http://raw.githubusercontent.com/pelican-eggs/games-steamcmd/refs/heads/main/valheim/valheim_bepinex/egg-valheim-bep-i-nex.yaml) — 关键行：`stop: ^C`

### 配置文件

Valheim 服务端**无主配置文件**，所有配置通过启动参数控制。运行时权限管理通过三个纯文本文件实现，位于 `-savedir` 指定目录（默认 `~/.config/unity3d/IronGate/Valheim/`）：

| 文件名 | 用途 | 格式 |
|--------|------|------|
| `adminlist.txt` | 管理员名单（每行一个 SteamID64 或 Xbox User ID） | 纯文本，每行一个 ID |
| `bannedlist.txt` | 黑名单（被 ban 玩家的 SteamID64 / Xbox User ID） | 纯文本，每行一个 ID |
| `permittedlist.txt` | 白名单。**只要文件中有一个 ID，即进入白名单模式**，非白名单玩家无法加入 | 纯文本，每行一个 ID |

**关键规则：**
- 必须使用 **SteamID64**（17 位数字），不能使用用户名。可在 [steamid.io](https://steamid.io/) 查询
- Xbox 玩家使用 Xbox User ID
- 修改这三个文件后**需要重启服务器**才能生效（vanilla 不支持热重载）
- 在 `permittedlist.txt` 中添加一个 ID 会导致服务器进入白名单模式，所有未列入的玩家被拒绝

文件路径示例：
```
~/.config/unity3d/IronGate/Valheim/
├── adminlist.txt
├── bannedlist.txt
├── permittedlist.txt
└── worlds_local/
    └── <world_name>.db / <world_name>.fwl
```

来源：
- [Supercraft Wiki - Whitelist](http://gsb.supercraft.host/wiki/valheim/whitelist/)
- [Supercraft Wiki - Launch Parameters - Admin Settings](https://b-prod-ak38sf.supercraft.host/wiki/valheim/server_settings/)
- [Valheim 官方说明书 PDF](https://www.bojarcz.uk/Syf/Valheim%20Dedicated%20Server%20Manual.pdf)
- [Fatality Servers - Valheim Server Setup Guide](https://fatalityservers.com/kb/valheim-server-setup-guide/)

### 存档目录

| 路径 | 说明 |
|------|------|
| `<savedir>/worlds_local/` 或默认 `~/.config/unity3d/IronGate/Valheim/worlds_local/` | 世界存档根目录 |
| `<world_name>.db` | 世界状态数据库（建筑、物品、生物等） |
| `<world_name>.db.old` | 自动备份（每次保存时生成） |
| `<world_name>.fwl` | 世界元数据文件（包含种子、世界版本等） |

> ℹ️ 通过 `-savedir` 参数可改变存档根目录，便于备份管理。`-world` 参数决定存档文件名前缀。

来源：
- [Valheim Fandom Wiki - Dedicated servers#Additional configuration](https://valheim.fandom.com/wiki/Dedicated_servers#Additional_configuration)
- [Fatality Servers - File Layout](https://fatalityservers.com/kb/valheim-server-setup-guide/#file-layout)

### 玩家 / 物品 / 聊天命令

Valheim 服务端命令分为两类：
1. **管理命令**（admin-only）：可在游戏内 F5 控制台执行，**无需 devcommands**
2. **作弊命令**（cheat）：在专用服务端默认禁用，需安装 `Server_devcommands` mod

#### 服务器管理命令（vanilla，admin-only）

| 命令 | 用法 | 说明 |
|------|------|------|
| `kick <name\|ip\|userID>` | `kick Viking123` | 踢出指定玩家 |
| `ban <name\|ip\|userID>` | `ban 76561198012345678` | 封禁玩家（写入 bannedlist） |
| `unban <ip\|userID>` | `unban 76561198012345678` | 解除封禁 |
| `banned` | `banned` | 列出所有被封禁玩家 |
| `save` | `save` | 强制世界保存 |
| `info` | `info` | 显示系统信息 |
| `ping` | `ping` | 显示连接延迟 |
| `lodbias <1-7>` | `lodbias 3` | 设置 LOD 偏移（影响绘制距离） |
| `help [page] [pages]` | `help` | 显示可用命令 |

#### 物品给予 / 生成命令（需 devcommands，vanilla 服务端默认禁用）

| 命令 | 用法 | 说明 |
|------|------|------|
| `spawn <prefab> <amount> <level>` | `spawn Deer 1 2` | 生成物品或生物（level 仅对生物有效） |
| `location <id> [SAVE]` | `location Vendor_BlackForest` | 生成指定地点实例 |
| `removedrops` | `removedrops` | 清除所有掉落物 |

> ⚠️ **重要：vanilla Valheim 专用服务端默认禁用 devcommands**，因此 `spawn` 命令在服务端控制台不可用。需安装 `Server_devcommands` mod 才能在专用服务端使用。同时，1.0 版本起使用 spawn 会标记角色/世界为作弊状态，禁止解锁成就。

#### 聊天广播命令

| 命令 | 用法 | 说明 |
|------|------|------|
| `say <message>` | `say Hello everyone!` | 以 shout 形式发送消息（**仅 RCON mod 提供**，vanilla 控制台无此命令） |

> ℹ️ vanilla 服务端控制台**没有** `say`、`broadcast` 等广播命令。要实现聊天广播，必须安装 Rcon_Commands mod（详见 [RCON 端口与配置](#rcon-端口与配置)）。

#### RCON 扩展命令（需安装 Rcon_Commands mod）

| 命令 | 说明 |
|------|------|
| `addAdmin <SteamID>` | 添加管理员 |
| `removeAdmin <SteamID>` | 移除管理员 |
| `addPermitted <SteamID>` | 添加白名单 |
| `removePermitted <SteamID>` | 移除白名单 |
| `ban <SteamID/PlayerName>` | 封禁玩家 |
| `unban <SteamID/PlayerName>` | 解封玩家 |
| `kick <SteamID/PlayerName>` | 踢出玩家 |
| `give <SteamID> <item_name> <quality> <amount>` | 给予玩家物品 |
| `spawn <prefabName> <x> <y> <z>` | 在指定坐标生成对象 |
| `say <message>` | 发送 shout 消息 |
| `showMessage <message>` | 屏幕中央显示消息 |
| `save` | 保存世界 |
| `players` | 显示所有在线玩家及位置 |
| `serverStats` | 显示服务器统计（玩家数、FPS、内存） |
| `time` | 显示当前服务器时间与日期 |
| `list` | 列出所有可用命令 |

来源：
- [Valheim Cheats - Server Admin Commands](https://valheimcheats.com/blog/server-admin-commands)
- [Wabbanode - All Valheim Admin Commands](https://wabbanode.com/help/valheim/all-valheim-admin-commands)
- [BisectHosting - How to Use RCON Commands on a Valheim Server](https://help.bisecthosting.com/hc/en-us/articles/46953849931675-How-to-Use-RCON-Commands-on-a-Valheim-Server)
- [WinterNode - How to Enable Cheats on Your Valheim Server](https://winternode.com/help/games/valheim/administration/enable-valheim-cheats)
- [Valheim 1.0 FAQ](https://valheim.com/support/valheim-1-0-faq/)

### 默认端口

| 端口 | 协议 | 用途 |
|------|------|------|
| **2456** | UDP | 游戏主端口（`-port` 参数指定） |
| **2457** | UDP | Steam Query Port / A2S（`-port + 1`，自动占用） |
| **2458** | UDP | Crossplay 后端端口（仅在 `-crossplay` 启用时使用，`-port + 2`） |

> ⚠️ **必须同时开放三个连续 UDP 端口**：若 `-port 2456`，则需开放 `2456-2458/udp`。Crossplay 模式下三个端口都必须开放。

来源：
- [Valheim Fandom Wiki - Dedicated servers#Ingress](https://valheim.fandom.com/wiki/Dedicated_servers#Ingress)
- [BlastVPS Guide](https://blastvps.com/blog/valheim-dedicated-server-setup-guide)

### RCON 端口与配置

**Valheim 原生 vanilla 服务端不支持 RCON 协议。**

| 项目 | 说明 |
|------|------|
| 原生 RCON 支持 | ❌ **不支持** |
| `-rcon` / `-rconport` / `-rconpassword` 启动参数 | ❌ 在 vanilla 二进制中不生效（部分第三方文档列出的参数实际无效） |
| 实现 RCON 的方式 | ✅ 通过 BepInEx mod：[JereKuusela/valheim-rcon_commands](https://github.com/JereKuusela/valheim-rcon_commands)（Thunderstore 包名 `JereKuusela-Rcon_Commands`） |
| Mod 默认 RCON 端口 | 25575（TCP） |
| Mod 工作方式 | 通过 BepInEx 注入，监听 TCP 25575，接受标准 RCON 协议命令 |

**Mod 依赖：**
- BepInEx for Valheim（mod loader）
- Rcon_Commands mod 本体

**启用步骤：**
1. 安装 BepInEx（参考 [BepInEx Valheim 安装指南](https://help.bisecthosting.com/hc/en-us/articles/41778451525531)）
2. 下载 `JereKuusela-Rcon_Commands` 包并放入 `BepInEx/plugins/`
3. 在 `BepInEx/config/` 中配置 RCON 端口和密码
4. 重启服务端

> ⚠️ 由于 RCON 依赖 mod，**pack.yaml 中如果需要 RCON 功能，必须将 BepInEx 安装作为前置步骤**。如果项目策略不允许 mod，则不能依赖 RCON 进行进程管理，只能使用 SIGINT 信号停止服务端。

来源：
- [GitHub - JereKuusela/valheim-rcon_commands](https://github.com/JereKuusela/valheim-rcon_commands)
- [Thunderstore - Rcon Commands](https://thunderstore.io/c/valheim/p/JereKuusela/Rcon_Commands/)
- [BisectHosting - RCON on Valheim](https://help.bisecthosting.com/hc/en-us/articles/46953849931675-How-to-Use-RCON-Commands-on-a-Valheim-Server)
- [WinterNode - Enable Cheats](https://winternode.com/help/games/valheim/administration/enable-valheim-cheats) — 原文："Vanilla devcommands does not work on a Valheim dedicated server."

### 必需变量（pack.yaml 中 `{{var}}` 占位符）

| 变量名 | 含义 | 是否必填 | 默认值 / 示例 |
|--------|------|---------|---------------|
| `{{server_name}}` | 服务器在浏览器中显示的名称（`-name` 参数） | ✅ 必填 | `My Valheim Server` |
| `{{world_name}}` | 世界名称，决定存档文件名（`-world` 参数）。**改变此值会创建新世界** | ✅ 必填 | `Dedicated` |
| `{{server_password}}` | 服务器加入密码（`-password` 参数） | ✅ 必填 | 长度≥5，且不能包含在 `server_name` 中 |
| `{{server_port}}` | 游戏主端口（`-port` 参数） | ✅ 必填 | `2456` |
| `{{public_server}}` | 是否公开服务器（`-public` 参数） | ⚪ 可选 | `1` |
| `{{enable_crossplay}}` | 是否启用 Crossplay（`-crossplay` 参数） | ⚪ 可选 | `false` |
| `{{save_dir}}` | 自定义存档目录（`-savedir` 参数） | ⚪ 可选 | `~/.config/unity3d/IronGate/Valheim/` |

**关于 `world_name` 与 `server_password` 的含义：**

| 变量 | 含义 | 必填性 | 注意事项 |
|------|------|--------|---------|
| `world_name` | 世界名称。决定 `worlds_local/<world_name>.db` 与 `<world_name>.fwl` 文件名。改变此参数会**创建全新世界**（旧世界不会自动迁移） | ✅ 必填 | 服务器首次启动时若指定 world 不存在，会自动生成新世界 |
| `server_password` | 玩家加入服务器时必须输入的密码 | ✅ 必填 | 长度 ≥ 5 字符；不能是 `server_name` 的子串；不能为空（即便 `-public 0` 也必须设置） |

来源：
- [Supercraft Wiki - Launch Parameters](https://b-prod-ak38sf.supercraft.host/wiki/valheim/server_settings/)
- [Valheim 官方说明书 PDF](https://www.bojarcz.uk/Syf/Valheim%20Dedicated%20Server%20Manual.pdf)

### EULA / Token 要求

| 项目 | 状态 |
|------|------|
| EULA 接受 | ❌ **不需要**。Valheim 服务端启动时无 EULA 提示，无需任何 `eula.txt` 或类似文件 |
| Steam Game Server Login Token (GSLT) | ❌ **不需要**。Valheim 使用 Steam 后端或 PlayFab Crossplay 后端，不要求 GSLT |
| 账户登录 | ❌ **不需要**。SteamCMD 通过 `anonymous` 即可下载，无需 Steam 账户 |

来源：[Valheim Fandom Wiki - Dedicated servers](https://valheim.fandom.com/wiki/Dedicated_servers)

### 资料来源 URL

1. https://valheim.fandom.com/wiki/Dedicated_servers — Valheim 官方 Wiki 服务器页面
2. https://store.steampowered.com/app/896660/Valheim_Dedicated_Server/ — Steam 商店页
3. https://www.bojarcz.uk/Syf/Valheim%20Dedicated%20Server%20Manual.pdf — Iron Gate 官方说明书
4. https://b-prod-ak38sf.supercraft.host/wiki/valheim/server_settings/ — 启动参数文档
5. https://b-prod-ak38sf.supercraft.host/wiki/valheim/whitelist/ — 白名单配置
6. http://gsb.supercraft.host/wiki/valheim/whitelist/ — adminlist/bannedlist/permittedlist 文件格式
7. https://fatalityservers.com/kb/valheim-server-setup-guide/ — 完整安装与配置指南
8. https://space-node.net/blog/valheim-dedicated-server-2026 — 2026 年安装指南
9. https://blastvps.com/blog/valheim-dedicated-server-setup-guide — VPS 部署指南
10. https://selfhosting.sh/apps/valheim-server/ — Docker 部署与就绪日志说明
11. https://valheim-server-help.github.io/serverTroubleshootingLAN/ — 故障排查与启动日志序列
12. http://raw.githubusercontent.com/pelican-eggs/games-steamcmd/refs/heads/main/valheim/valheim_bepinex/egg-valheim-bep-i-nex.yaml — Pelican Egg YAML（ready_pattern 来源）
13. https://help.bisecthosting.com/hc/en-us/articles/46953849931675-How-to-Use-RCON-Commands-on-a-Valheim-Server — RCON mod 命令列表
14. https://github.com/JereKuusela/valheim-rcon_commands — RCON mod 源码
15. https://thunderstore.io/c/valheim/p/JereKuusela/Rcon_Commands/ — RCON mod Thunderstore 页
16. https://winternode.com/help/games/valheim/administration/enable-valheim-cheats — devcommands 在专用服务端的限制
17. https://valheimcheats.com/blog/server-admin-commands — 服务器管理命令清单
18. https://wabbanode.com/help/valheim/all-valheim-admin-commands — 完整 admin 命令参考
19. https://valheim.com/support/valheim-1-0-faq/ — 1.0 版本作弊标记机制

---

## 游戏2：Project Zomboid（僵尸毁灭工程）

### Steam App ID

| 项目 | 值 |
|------|-----|
| 游戏本体 App ID | **108600** |
| 专用服务器 App ID | **380870** |

> ⚠️ 两者不同：SteamCMD 必须使用 `380870` 下载服务端。游戏本体 `108600` 不用于服务端。
> ℹ️ 服务端安装目录下 `steam_appid.txt` 内容应为 `108600`（这是 Iron Stone 的设置，用于 Steamworks 集成），但 SteamCMD 命令使用 `380870`。

来源：
- [PZwiki - Dedicated Server](https://pzwiki.net/wiki/Dedicated_Server)
- [Steam 商店页 - Project Zomboid Dedicated Server](https://store.steampowered.com/app/380870/Project_Zomboid_Dedicated_Server/)

### SteamCMD 下载

**支持 anonymous 匿名下载**（无需 Steam 账户登录）。

```bash
# 创建专用用户（不要用 root 运行）
sudo adduser pzuser
sudo mkdir /opt/pzserver
sudo chown pzuser:pzuser /opt/pzserver
sudo -u pzuser -i

# 下载服务端
steamcmd +force_install_dir /opt/pzserver \
         +login anonymous \
         +app_update 380870 validate \
         +quit
```

> ℹ️ 若要下载 Build 42 unstable 分支：`app_update 380870 -beta unstable validate`
> ℹ️ 服务端文件约 3–4 GB，包含自带 JRE（Java Runtime Environment），无需额外安装 Java。

来源：[PZwiki - Dedicated Server#Through SteamCMD](https://pzwiki.net/wiki/Dedicated_Server#Through_SteamCMD)

### 启动命令

Linux 启动脚本：

```bash
cd /opt/pzserver
./start-server.sh -servername servertest -adminpassword YourAdminPassword
```

| 项目 | 值 |
|------|-----|
| Linux 启动脚本 | **`start-server.sh`** |
| Windows 启动脚本 | `StartServer64.bat`（64 位 Steam 版）<br>`StartServer32.bat`（32 位 Steam 版）<br>`StartServer64_nosteam.bat`（64 位 non-Steam 版） |
| 后台 Java 进程 | `zombie.network.GameServer` |

> ⚠️ **首次启动必须交互式运行**：服务端会在控制台提示设置 admin 密码。可使用 `-adminpassword` 参数跳过提示，自动设置默认 admin 密码。

> ⚠️ **内存配置**：`StartServer64.bat` / `start-server.sh` 默认指定 16 GB 内存（`-Xms16g -Xmx16g`）。**必须根据实际硬件修改 `-Xms` 和 `-Xmx`**，否则可能因内存不足启动失败。例如 6 GB 内存配置：
> ```
> -Xms6g -Xmx6g
> ```

来源：
- [PZwiki - Dedicated Server#Linux](https://pzwiki.net/wiki/Dedicated_Server#Linux)
- [PZwiki - Startup parameters](https://pzwiki.net/wiki/Startup_parameters)

### 启动参数列表

> ⚠️ **关于任务描述中提到的 `-useradmin` 参数：经核实不存在此参数。** PZ 启动参数官方列表中没有 `-useradmin`。可能任务描述混淆了 `-adminusername`（设置管理员用户名）或游戏内 `/adduser` 命令。

#### 服务端专用参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `-servername <name>` | 字符串 | **核心参数**。设置内部服务器名称。**影响存档目录路径**（`Saves/Multiplayer/<servername>/`）与 INI 文件名（`<servername>.ini`） |
| `-adminpassword <password>` | 字符串 | 自动设置默认 admin 用户密码，跳过首次启动交互提示 |
| `-adminusername <name>` | 字符串 | 自定义默认 admin 用户名（默认 admin） |
| `-port <port>` | 数字 | 覆盖 INI 中的 `DefaultPort` 配置（默认 16261） |
| `-udpport <port>` | 数字 | 覆盖 INI 中的 `UDPPort` 配置 |
| `-ip <ip>` | IP | 强制服务器绑定到指定 IP 地址 |
| `-nosteam` | 开关 | 禁用 Steam 集成，适用于 GoG 玩家联机 |
| `-steamvac <true\|false>` | 布尔 | 启用/禁用 Valve Anti-Cheat |
| `-statistic <period>` | 秒 | 启用多人统计监控（period 为采样周期） |
| `-coop` | 开关 | 以 coop 模式运行（非 dedicated） |
| `-debug` | 开关 | 调试模式启动 |
| `-cachedir <path>` | 路径 | 设置缓存目录（等同于 `-Ddeployment.user.cachedir` JVM 参数） |
| `-console_dot_txt_size_kb=<size>` | 数字 | 设置 `console.txt` 日志文件最大大小（KB） |
| `-disablelog=<types>` | 类型列表 | 禁用指定日志类型 |
| `-debuglog=<types>` | 类型列表 | 启用指定日志类型 |

#### JVM 参数（在 `--` 之前）

| 参数 | 说明 |
|------|------|
| `-Xms<size>` | JVM 最小堆内存（如 `-Xms4g`） |
| `-Xmx<size>` | JVM 最大堆内存（如 `-Xmx8g`） |
| `-Dzomboid.steam=1` | 启用 Steam 集成 |
| `-Dzomboid.ConsoleDotTxtSizeKB=<size>` | console.txt 大小限制 |
| `-Ddeployment.user.cachedir=<path>` | Linux 专用，设置缓存目录 |
| `-XX:+UseZGC` | 使用 ZGC 垃圾回收器（推荐 Java 17+） |
| `-XX:-CreateCoredumpOnCrash` | 崩溃时不生成 core dump |
| `-XX:-OmitStackTraceInFastThrow` | 保留完整堆栈跟踪 |
| `-Djava.awt.headless=true` | 无头模式 |
| `-Djava.library.path=natives/;natives/win64/;.` | 原生库路径 |

**完整启动示例（来自 PZwiki）：**
```bash
".\jre64\bin\java.exe" -Djava.awt.headless=true -Dzomboid.steam=1 \
  -Dzomboid.znetlog=1 -XX:+UseZGC -XX:-CreateCoredumpOnCrash \
  -XX:-OmitStackTraceInFastThrow -Xms6g -Xmx6g \
  -Djava.library.path=natives/;natives/win64/;. \
  -cp %PZ_CLASSPATH% zombie.network.GameServer \
  -servername pizza -statistic 0
```

来源：[PZwiki - Startup parameters](https://pzwiki.net/wiki/Startup_parameters)

### 就绪日志特征

**就绪 stdout 日志特征字符串：`Server started`**

启动序列典型输出：
```
21:14:35 [INFO]  General     : 1688138075438ms
...
load map: Muldraugh, KY
21:14:42 [INFO]  MapLoading  : Loaded map Muldraugh, KY (...)
...
21:14:58 [INFO]  Multiplayer  : Server is listening on port 16261.
...
Server started
```

- **PZwiki 明确指出**："After the server finishes setting up with default game settings, a message will output indicating success or failure" —— 标志性字符串为 **`Server started`**
- Docker Compose 部署指南（CSDN）显示日志中出现 `LuaCalls: SERVER STARTED` 也可作为就绪信号

建议 `ready_pattern` 正则：
```regex
Server started
```
或更宽松的：
```regex
(SERVER STARTED|Server started)
```

来源：
- [PZwiki - Dedicated Server#Running the server](https://pzwiki.net/wiki/Dedicated_Server#Running_the_server) — 截图标题："A message indicating the server started successfully"
- [Supercraft - Project Zomboid Dedicated Server Setup Guide](https://supercraft.host/wiki/project-zomboid/dedicated_server_setup/) — 原文："It will say 'Server started' when ready."
- [CSDN - PZ 服务器搭建](https://blog.csdn.net/shitidesu/article/details/161652979) — 原文："日志中出现 `LuaCalls: SERVER STARTED` 表示服务器成功启动"

### 停止命令

PZ 服务端**支持通过 stdin 命令或 RCON 发送停止命令**，无需依赖 SIGINT 信号。

| 命令 | 说明 |
|------|------|
| `quit` | **保存世界并退出服务器**（推荐优雅停止方式） |
| `save` | 仅保存当前世界，不退出 |
| `exit` | 等同于 `quit`（部分版本支持） |

**三种执行方式：**

1. **直接控制台输入**（前台 tmux/screen 会话）：在服务端控制台直接键入 `quit`
2. **通过命名管道**（systemd 部署推荐）：
   ```bash
   echo "save" > /opt/pzserver/zomboid.control
   sleep 15
   echo "quit" > /opt/pzserver/zomboid.control
   ```
3. **通过 RCON**（详见 [RCON 配置方式](#rcon-配置方式)）：
   ```
   rcon-cli --port 16262 --password <password> "quit"
   ```

> ✅ **关于任务描述中的 `save; quit` 复合命令：**
> - PZ 控制台**不接受分号分隔的多命令拼接**（每条命令独占一行）
> - 如需先保存再退出，应分两次发送：先 `save`，等待响应后再 `quit`
> - PZwiki 推荐的 systemd `ExecStop` 模式就是分两步：
>   ```bash
>   ExecStop=/bin/sh -c "echo save > /opt/pzserver/zomboid.control; sleep 15; echo quit > /opt/pzserver/zomboid.control"
>   ```

来源：
- [PZwiki - Dedicated Server#Systemd](https://pzwiki.net/wiki/Dedicated_Server#Systemd) — systemd 配置中的 ExecStop 实现
- [PZwiki - Admin commands#quit](https://pzwiki.net/wiki/Admin_commands) — `quit` 命令说明：Save and quit the server
- [Supercraft - RCON Setup](https://supercraft.host/wiki/project-zomboid/rcon/)

### 配置文件

PZ 服务端**通过 INI 配置文件控制**，所有配置在首次启动后自动生成。

#### 配置文件位置

Linux 默认路径（`pzuser` 用户家目录下）：
```
~/Zomboid/Server/
├── <servername>.ini                    # 主配置文件（如 servertest.ini）
├── <servername>_SandboxVars.lua        # 沙盒配置（僵尸密度、难度等）
├── <servername>_spawnpoints.lua        # 自定义出生点
└── <servername>_spawnregions.lua       # 出生区域（Muldraugh, Rosewood 等）
```

Windows 默认路径：`C:\Users\<username>\Zomboid\Server\`

可通过 `-cachedir` 参数或 `-Ddeployment.user.cachedir` JVM 参数改变根目录。

#### 主 INI 关键字段（`<servername>.ini`）

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `Public` | true | 是否在公共服务器列表显示 |
| `PublicName` | servertest | 公共列表显示的服务器名称 |
| `PublicDescription` | （空） | 服务器描述 |
| `MaxPlayers` | 16 | 最大玩家数 |
| `Password` | （空） | 服务器加入密码（空=无密码） |
| `DefaultPort` | 16261 | 主游戏端口 |
| `UDPPort` | 16261 | UDP 端口 |
| `PauseEmpty` | true | 无人时自动暂停游戏时间 |
| `GlobalChat` | true | 启用全局聊天 |
| `PVP` | true | 启用 PVP |
| `AdminPassword` | （空） | Admin 密码（**与 `-adminpassword` 启动参数等效**） |
| `RCONEnabled` | false | **是否启用 RCON** |
| `RCONPort` | 27015 | RCON 端口（INI 默认值，社区习惯设为 16262） |
| `RCONPassword` | （空） | **RCON 密码（必须设置，否则 RCON 不启用）** |
| `AutoCreateUserInWhiteList` | false | 自动将新玩家加入白名单 |
| `DisplayUserName` | true | 显示玩家用户名 |
| `Mods` | （空） | 已启用的 Mod ID 列表（分号分隔，如 `MoreBuilds;BetterSortingB41`） |
| `WorkshopItems` | （空） | Steam Workshop Item ID 列表（分号分隔） |
| `Map` | Muldraugh, KY | 地图名 |
| `DoLuaChecksum` | true | 启用 Lua 校验（防作弊） |
| `Open` | true | 是否允许新玩家加入（false=仅白名单） |
| `ServerWelcomeMessage` | （长文本） | 玩家登录欢迎消息（支持 `<LINE>`、`<RGB:r,g,b>`） |
| `UPnP` | true | 启用 UPnP 自动端口转发 |

#### 沙盒配置（`<servername>_SandboxVars.lua`）

控制游戏难度与机制：
- `ZombieCount`（1-6）：僵尸密度
- `Speed` / `Strength` / `Sight` / `Hearing`：僵尸属性
- `XPMultiplier`：经验倍率
- `HoursForLootRespawn`：战利品重生时间
- `DropInventoryOnDeath`：死亡掉落

> ℹ️ **INI 修改生效方式**：可在服务端运行时修改 INI，然后通过 admin 命令 `/reloadoptions` 热加载，无需重启。

来源：
- [PZwiki - Dedicated Server#Server data save locations](https://pzwiki.net/wiki/Dedicated_Server#Server_data_save_locations)
- [Gamekee - PZ 服务器配置详解](https://www.gamekee.com/pz/601890.html)（含 INI 字段中文注释）
- [Unwiki - ProjectZomboid:ServerINI](https://www.unwiki.net/ProjectZomboid:ServerINI/)（RCON 默认端口说明）
- [Galaxy Cloud Solutions - PZ VPS 部署](https://galaxycloudsolutions.com/blog/how-to-host-project-zomboid-server-on-vps/)
- [CSDN - PZ 服务器搭建（INI 字段中文翻译）](https://blog.csdn.net/shitidesu/article/details/161652979)

### 存档目录

| 路径 | 说明 |
|------|------|
| `~/Zomboid/Saves/Multiplayer/<servername>/` | 世界存档目录（如 `~/Zomboid/Saves/Multiplayer/servertest/`） |
| `~/Zomboid/Saves/Multiplayer/<servername>/map_*.bin` | 地图区块数据 |
| `~/Zomboid/Saves/Multiplayer/<servername>/players/*.txt` | 玩家数据（每个玩家一个文件） |
| `~/Zomboid/Saves/Multiplayer/<servername>/vehicles.txt` | 车辆数据 |
| `~/Zomboid/db/<servername>.db` | SQLite 数据库（白名单、banlist 等） |

> ⚠️ **`-servername` 参数直接决定存档目录路径**。改变 servername 会创建全新存档目录，旧世界不会自动迁移。

> ℹ️ 客户端缓存的地图数据存储在 `C:\Users\<user>\Zomboid\Saves\<server_ip>_<server_port>_<hash>\` 中。如果服务器端口变更，客户端缓存的地图可能错位，玩家需要清除该目录。

来源：
- [PZwiki - Dedicated Server#Server data save locations](https://pzwiki.net/wiki/Dedicated_Server#Server_data_save_locations)
- [PZwiki - Dedicated Server#Customizing server name](https://pzwiki.net/wiki/Dedicated_Server#Customizing_server_name)

### 玩家 / 物品 / 聊天命令

PZ 服务端通过控制台或 RCON 执行 admin 命令。游戏内聊天中以 `/` 前缀触发。

#### 玩家管理命令

| 命令 | 用法 | 说明 |
|------|------|------|
| `players` | `/players` | 列出所有在线玩家 |
| `kickuser` | `/kickuser "<username>" -r "reason"` | 踢出玩家（可指定原因） |
| `banuser` | `/banuser "<username>" -ip -r "reason"` | 封禁玩家（`-ip` 同时封禁 IP，`-r` 指定原因） |
| `unbanuser` | `/unbanuser "<username>"` | 解除玩家封禁 |
| `banid` | `/banid <SteamID>` | 按 SteamID 封禁 |
| `unbanid` | `/unbanid <SteamID>` | 按 SteamID 解封 |
| `banip` | `/banip <IP>` | 按 IP 封禁 |
| `unbanip` | `/unbanip <IP>` | 按 IP 解封 |
| `setaccesslevel` | `/setaccesslevel "<username>" "<level>"` | 设置访问级别（none/Observer/GM/Overseer/Moderator/Admin） |
| `setpassword` | `/setpassword "<username>" "<newpassword>"` | 设置玩家密码 |
| `voiceban` | `/voiceban "<username>" -true` | 禁言玩家 |
| `teleport` | `/teleport "<player1>" "<player2>"` | 传送 player1 到 player2 |
| `teleportto` | `/teleportto x,y,z` | 传送到坐标 |
| `adduser` | `/adduser "<username>" "<password>"` | 添加白名单用户 |
| `removeuserfromwhitelist` | `/removeuserfromwhitelist "<username>"` | 从白名单移除 |
| `addsteamid` | `/addsteamid "<steamid>"` | 添加 SteamID 到允许列表 |
| `removesteamid` | `/removesteamid "<steamid>"` | 从允许列表移除 SteamID |

> ℹ️ **关于任务描述中的 `kick` / `ban` / `unban` 命令名**：PZ 官方命令实际为 `kickuser` / `banuser` / `unbanuser`（非 `kick` / `ban` / `unban`）。PZwiki admin commands 表格中虽然 command 列写 `kick`，但 usage 字段明确为 `/kickuser "username" -r "reason"`。

#### 物品给予命令

| 命令 | 用法 | 说明 |
|------|------|------|
| `additem` | `/additem "<username>" "<module.item>" <count>` | 给予玩家物品。例：`/additem "rj" Base.Axe 5` |
| `addkey` | `/addkey "<username>" "<keyId>" "<name>"` | 给予玩家钥匙。例：`/addkey "rj" "7295" "Gift Key"` |
| `addxp` | `/addxp "<playername>" <perkname>=<xp>` | 给予玩家经验。例：`/addxp "rj" Woodwork=2` |
| `addvehicle` | `/addvehicle "<script>" "<user or x,y,z>"` | 生成车辆。例：`/addvehicle "Base.VanAmbulance" "rj"` |
| `removeitem` | `/removeitem "<module.item>" <count>` | 移除自己物品（count=0 移除全部） |

#### 聊天广播命令

| 命令 | 用法 | 说明 |
|------|------|------|
| `servermsg` | `/servermsg "<message>"` | **向所有在线玩家广播消息**（任务描述中的 `broadcast` 应为此命令） |

> ⚠️ **关于任务描述中的 `broadcast` 命令**：PZ 官方 admin 命令清单中没有 `broadcast`，广播命令的实际名称是 `servermsg`。例：`/servermsg "Server restarting in 5 minutes"`

#### 服务器控制命令

| 命令 | 用法 | 说明 |
|------|------|------|
| `save` | `/save` | 强制保存当前世界 |
| `quit` | `/quit` | 保存并退出服务器 |
| `help` | `/help ["command"]` | 列出所有命令或显示特定命令帮助 |
| `showoptions` | `/showoptions` | 显示当前服务器选项 |
| `changeoption` | `/changeoption <optionName> "<newValue>"` | 修改服务器选项 |
| `reloadoptions` | `/reloadoptions` | 热重载 ServerOptions.ini |
| `reloadlua` | `/reloadlua "<filename>"` | 重载指定 Lua 脚本 |
| `reloadalllua` | `/reloadalllua` | 重载所有 Lua 脚本 |
| `stats` | `/stats <none\|file\|console\|all> <period>` | 设置统计输出 |
| `log` | `/log "<Type>" "<Level>"` | 设置日志级别 |

#### 其他实用命令

| 命令 | 说明 |
|------|------|
| `addtosafehouse` | 添加玩家到安全屋 |
| `releasesafehouse` | 释放自己拥有的安全屋 |
| `alarm` | 在 admin 位置触发建筑警报 |
| `chopper` | 触发直升机事件 |
| `gunshot` | 触发枪声事件 |
| `createhorde` | `/createhorde <count> "<username>"` — 在玩家附近生成尸群 |
| `lightning` | 触发闪电 |
| `thunder` | 触发雷声 |
| `startrain` | `/startrain <1-100>` — 开始下雨 |
| `stoprain` | 停止下雨 |
| `startstorm` | `/startstorm <hours>` — 开始风暴 |
| `stopweather` | 停止天气效果 |
| `godmode` | `/godmode "<username>" -true` — 无敌模式 |
| `noclip` | `/noclip "<username>" -true` — 穿墙模式 |
| `invisible` | `/invisible "<username>" -true` — 对僵尸隐身 |
| `checkModsNeedUpdate` | 检查 mod 是否有更新 |

来源：
- [PZwiki - Admin commands](https://pzwiki.net/wiki/Admin_commands) — 官方完整命令列表
- [PrismaTechWork - PZ Server Setup](https://prismatechwork.com/tutorials/project-zomboid.html)
- [Supercraft - RCON Setup](https://supercraft.host/wiki/project-zomboid/rcon/)

### 默认端口

| 端口 | 协议 | 用途 |
|------|------|------|
| **16261** | UDP | 游戏主端口（`DefaultPort` / `-port` 参数） |
| **16262** | UDP | 直连端口（Direct Connection Port，Build 41+） |
| **8766** | UDP | Steam Query 端口（**仅 Build 41.77 之前使用**） |
| **27015** | TCP | RCON 端口（INI 默认值，社区常改用 16262） |

> ⚠️ **必须开放的 UDP 端口**：`16261/udp`、`16262/udp`
> ℹ️ **多实例部署**：每个 PZ 实例需要 2 个独立 UDP 端口。第二实例可使用 16274/16275 等。
> ℹ️ Build 41.77+ 后 8766/8767 已不再使用，仅 16261 和 16262 为必需。

来源：
- [PZwiki - Dedicated Server#Forwarding required ports](https://pzwiki.net/wiki/Dedicated_Server#Forwarding_required_ports)
- [PZwiki - Dedicated Server#Ports used before version 41.77](https://pzwiki.net/wiki/Dedicated_Server#Ports_used_before_version_41.77)

### RCON 配置方式

**PZ 服务端原生支持 RCON（无需任何 mod）**，通过 `<servername>.ini` 文件配置。

#### 必填 INI 字段

```ini
# 启用 RCON
RCONEnabled=true

# RCON 端口（INI 默认 27015，社区常用 16262 即 Game Port + 1）
RCONPort=16262

# RCON 密码（必须设置，否则 RCON 不启用）
RCONPassword=YourStrongRconPassword
```

> ⚠️ **必须设置 `RCONPassword`**，否则 RCON 处于禁用状态（即使 `RCONEnabled=true`）。Supercraft 官方文档明确说明："You MUST set an `RCONPassword` in your server ini file. Without it, RCON is disabled for security."

#### RCON 连接方式

| 工具 | 说明 |
|------|------|
| [mcrcon](https://github.com/Tiiffi86/mcrcon) | 通用 RCON 客户端 |
| [rcon-cli](https://github.com/gorcon/rcon-cli) | Go 实现的 RCON CLI（Cybrancee 推荐） |
| [ZomboidRCON](https://github.com/kwmx/ZomboidRCON) | PZ 专用 RCON GUI 工具 |
| BattleMetrics | 在线 RCON 管理平台 |

#### RCON 连接示例

```bash
# 使用 rcon-cli
rcon-cli --host <server_ip> --port 16262 --password <password>

# 使用 mcrcon
mcrcon -H <server_ip> -P 16262 -p <password>
```

#### 通过 RCON 执行的常用命令

```
servermsg "Hello World"   # 广播消息
save                       # 强制保存
quit                       # 保存并退出
players                    # 列出在线玩家
kickuser "username" -r "Reason"
banuser "username" -ip -r "reason"
showoptions
reloadoptions
```

> ℹ️ **RCON 协议说明**：PZ 的 RCON 实现**每次只接受一条命令**，不支持分号分隔的复合命令。如需先保存再退出，必须分两次发送。

来源：
- [Supercraft - Project Zomboid RCON Setup](https://supercraft.host/wiki/project-zomboid/rcon/)
- [Cybrancee - How To Setup RCON for PZ Server](https://cybrancee.com/learn/knowledge-base/how-to-setup-rcon-for-your-project-zomboid-server/)
- [Gamekee - PZ 服务器配置详解](https://www.gamekee.com/pz/601890.html) — RCONPort 默认值来源
- [Unwiki - ProjectZomboid:ServerINI](https://www.unwiki.net/ProjectZomboid:ServerINI/)

### 必需变量（pack.yaml 中 `{{var}}` 占位符）

| 变量名 | 含义 | 是否必填 | 默认值 / 示例 |
|--------|------|---------|---------------|
| `{{server_name}}` | 内部服务器名称（`-servername` 参数）。**决定 INI 文件名与存档目录路径** | ✅ 必填 | `servertest`（默认） |
| `{{admin_password}}` | 默认 admin 用户密码（`-adminpassword` 参数 或 INI 的 `AdminPassword`） | ✅ 必填 | 首次启动时交互式设置 |
| `{{server_port}}` | 游戏主端口（`-port` 参数 或 INI 的 `DefaultPort`） | ✅ 必填 | `16261` |
| `{{max_players}}` | 最大玩家数（INI 的 `MaxPlayers`） | ⚪ 可选 | `16` |
| `{{server_password}}` | 服务器加入密码（INI 的 `Password`，空=无密码） | ⚪ 可选 | （空） |
| `{{public_server}}` | 是否公开服务器（INI 的 `Public`） | ⚪ 可选 | `true` |
| `{{rcon_enabled}}` | 是否启用 RCON（INI 的 `RCONEnabled`） | ⚪ 可选 | `false` |
| `{{rcon_port}}` | RCON 端口（INI 的 `RCONPort`） | ⚪ 可选 | `16262`（建议 Game Port + 1） |
| `{{rcon_password}}` | RCON 密码（INI 的 `RCONPassword`） | ⚪ 可选（启用 RCON 时必填） | 强密码 |
| `{{server_memory}}` | JVM 最大堆内存（`-Xmx` 参数） | ✅ 必填 | `4g` / `8g` |
| `{{map_name}}` | 地图名（INI 的 `Map`） | ⚪ 可选 | `Muldraugh, KY` |
| `{{mods}}` | 启用的 Mod ID 列表（INI 的 `Mods`） | ⚪ 可选 | `MoreBuilds;BetterSortingB41` |
| `{{workshop_items}}` | Workshop Item ID 列表（INI 的 `WorkshopItems`） | ⚪ 可选 | `2392709732;2699172477` |

**关于 `server_name` 的含义及对存档路径的影响：**

| 项目 | 说明 |
|------|------|
| 含义 | 内部服务器标识名，**不是显示给玩家的公共名称**（公共名称由 INI 中的 `PublicName` 控制） |
| 影响范围 1 | INI 文件名：`~/Zomboid/Server/<server_name>.ini` |
| 影响范围 2 | 沙盒配置文件名：`~/Zomboid/Server/<server_name>_SandboxVars.lua` |
| 影响范围 3 | **存档目录路径**：`~/Zomboid/Saves/Multiplayer/<server_name>/` |
| 影响范围 4 | SQLite 数据库：`~/Zomboid/db/<server_name>.db` |
| 注意事项 | **改变 `server_name` 会创建全新的存档目录**，旧世界不会自动迁移。若要切换世界但保留设置，应复制旧 INI 文件并以新名重命名 |

来源：
- [PZwiki - Startup parameters - -servername](https://pzwiki.net/wiki/Startup_parameters)
- [PZwiki - Dedicated Server#Customizing server name](https://pzwiki.net/wiki/Dedicated_Server#Customizing_server_name)
- [PZwiki - Dedicated Server#Server data save locations](https://pzwiki.net/wiki/Dedicated_Server#Server_data_save_locations)

### EULA / Token 要求

| 项目 | 状态 |
|------|------|
| EULA 接受 | ❌ **不需要**。PZ 服务端启动时无 EULA 提示，无需任何 `eula.txt` |
| Steam Game Server Login Token (GSLT) | ❌ **不需要** |
| 账户登录 | ❌ **不需要**。SteamCMD 通过 `anonymous` 即可下载 |

> ℹ️ 首次启动需**交互式设置 admin 密码**，但这是密码初始化而非 EULA。可通过 `-adminpassword` 参数跳过。

来源：[PZwiki - Dedicated Server](https://pzwiki.net/wiki/Dedicated_Server)

### 资料来源 URL

1. https://pzwiki.net/wiki/Dedicated_Server — PZwiki 官方服务器页面
2. https://pzwiki.net/wiki/Startup_parameters — PZwiki 启动参数官方文档
3. https://pzwiki.net/wiki/Admin_commands — PZwiki admin 命令官方列表
4. https://store.steampowered.com/app/380870/Project_Zomboid_Dedicated_Server/ — Steam 商店页
5. https://supercraft.host/wiki/project-zomboid/dedicated_server_setup/ — Supercraft 安装指南
6. https://supercraft.host/wiki/project-zomboid/rcon/ — Supercraft RCON 配置
7. https://cybrancee.com/learn/knowledge-base/how-to-setup-rcon-for-your-project-zomboid-server/ — Cybrancee RCON 详细教程
8. https://www.unwiki.net/ProjectZomboid:ServerINI/ — INI 字段韩文参考（RCONPort 默认值来源）
9. https://www.gamekee.com/pz/601890.html — Gamekee 中文 INI 字段翻译
10. https://blog.csdn.net/shitidesu/article/details/161652979 — CSDN 中文 Docker 部署指南（含 INI 字段）
11. https://galaxycloudsolutions.com/blog/how-to-host-project-zomboid-server-on-vps/ — Galaxy Cloud VPS 部署
12. https://prismatechwork.com/tutorials/project-zomboid.html — PrismaTechWork 安装教程
13. https://hostinger.com/ca/tutorials/how-to-host-a-project-zomboid-server — Hostinger 教程
14. https://zomboidpal.com/guides — ZomboidPal 设置指南
15. https://dedicatedserver.healthinquire.com/2026/05/project-zomboid-dedicated-server.html — DedicatedServer Healthinquire 综合指南

---

## 关键差异对比表

| 维度 | Valheim | Project Zomboid |
|------|---------|-----------------|
| **专用服务器 App ID** | 896660 | 380870 |
| **SteamCMD 匿名下载** | ✅ 支持 | ✅ 支持 |
| **Linux 启动脚本** | `start_server.sh`（调用 `valheim_server.x86_64`） | `start-server.sh`（调用 Java `zombie.network.GameServer`） |
| **服务端类型** | 原生 Linux ELF 二进制 | Java 应用（依赖 JRE，自带） |
| **配置方式** | **纯启动参数 + 文本权限文件**（无主 INI） | **INI 主配置 + Lua 沙盒配置** |
| **就绪日志特征** | `Game server connected` | `Server started` |
| **停止命令** | Ctrl+C（SIGINT 信号），**无控制台命令** | `quit` / `save`（控制台或 RCON 命令） |
| **RCON 原生支持** | ❌ 不支持，需 BepInEx mod | ✅ 原生支持，INI 配置 `RCONEnabled=true` |
| **RCON 默认端口** | N/A（mod 默认 25575） | 27015（INI 默认），社区常用 16262 |
| **默认游戏端口** | 2456 UDP（占用 2456-2458 三个连续端口） | 16261 UDP + 16262 UDP（直连） |
| **管理命令名** | `kick` / `ban` / `unban` / `banned` | `kickuser` / `banuser` / `unbanuser` / `players` |
| **物品给予命令** | `spawn <prefab> <amount> <level>`（vanilla 服务端禁用） | `additem "<user>" "<module.item>" <count>`（服务端控制台可用） |
| **广播命令** | `say <message>`（仅 RCON mod） | `servermsg "<message>"`（原生支持） |
| **复合命令支持** | ❌ 不支持 | ❌ 不支持（分号分隔无效） |
| **必需变量数量** | 4（server_name / world_name / server_password / server_port） | 3+（server_name / admin_password / server_port / server_memory） |
| **servername 是否影响存档路径** | ❌ 不影响（world_name 决定存档名） | ✅ **直接影响**（`Saves/Multiplayer/<servername>/`） |
| **EULA 接受** | ❌ 不需要 | ❌ 不需要 |
| **GSLT Token** | ❌ 不需要 | ❌ 不需要 |
| **首次启动交互** | 无 | ✅ 需设置 admin 密码（可用 `-adminpassword` 跳过） |
| **内存默认配置** | 较低（2-4 GB） | 较高（脚本默认 16 GB，**必须手动调整**） |
| **Crossplay 支持** | ✅ `-crossplay` 参数启用（PlayFab 中继） | ❌ 无 Crossplay |
| **配置热重载** | ❌ 修改权限文件需重启 | ✅ `/reloadoptions` 命令热加载 INI |
| **服务端进程模型** | 单一 Unity 进程 + 子进程（Zonesystem / DungeonDB / Game server） | 单一 Java 进程 + 多线程 |

---

## pack.yaml 实施建议

### Valheim pack.yaml 关键配置

```yaml
# Valheim 推荐配置要点
app_id: 896660
steamcmd_anonymous: true
binary: valheim_server.x86_64
launch_script: start_server.sh
ready_pattern: "Game server connected"
stop_method: signal  # SIGINT，不能依赖 RCON
stop_command: null   # 无 RCON 命令，使用 Ctrl+C / kill -INT
stop_signal: SIGINT

# 关键启动参数模板
launch_args:
  - "-nographics"
  - "-batchmode"
  - "-name \"{{server_name}}\""
  - "-port {{server_port}}"
  - "-world {{world_name}}"
  - "-password {{server_password}}"
  - "-public {{public_server}}"
  - "-savedir {{save_dir}}"

# 端口映射（必须三个连续 UDP）
ports:
  - "{{server_port}}/udp"        # 2456
  - "{{server_port|int + 1}}/udp" # 2457
  - "{{server_port|int + 2}}/udp" # 2458（crossplay 用）

# 必需变量
required_vars:
  - server_name
  - world_name
  - server_password  # 长度≥5，不含 server_name
  - server_port

# 注意事项
notes:
  - "vanilla 服务端无 RCON 支持，停止必须使用 SIGINT"
  - "若需 RCON，必须安装 BepInEx + Rcon_Commands mod"
  - "spawn / devcommands 在 vanilla 服务端禁用"
  - "改变 world_name 会创建新世界，旧世界不迁移"
```

### Project Zomboid pack.yaml 关键配置

```yaml
# PZ 推荐配置要点
app_id: 380870
steamcmd_anonymous: true
binary: start-server.sh  # 实际调用 Java
ready_pattern: "Server started"
stop_method: rcon_or_pipe  # 优先 RCON，备选命名管道
stop_command: "quit"        # RCON 或 stdin 单条命令
# 复合停止序列（保存+退出）需分两步：
# 1. 发送 "save"
# 2. 等待 15 秒
# 3. 发送 "quit"

# 关键启动参数模板
launch_args:
  - "-servername {{server_name}}"
  - "-adminpassword {{admin_password}}"
  - "-port {{server_port}}"

# JVM 内存参数（必须配置）
jvm_args:
  - "-Xms{{server_memory}}"
  - "-Xmx{{server_memory}}"
  - "-XX:+UseZGC"
  - "-XX:-CreateCoredumpOnCrash"
  - "-XX:-OmitStackTraceInFastThrow"
  - "-Djava.awt.headless=true"
  - "-Dzomboid.steam=1"

# 端口映射
ports:
  - "{{server_port}}/udp"        # 16261
  - "{{server_port|int + 1}}/udp" # 16262（直连）
  - "{{rcon_port}}/tcp"           # 16262 或 27015（RCON，仅启用时）

# INI 配置（首次启动后自动生成在 ~/Zomboid/Server/<server_name>.ini）
ini_config:
  MaxPlayers: "{{max_players}}"
  Password: "{{server_password}}"
  Public: "{{public_server}}"
  PublicName: "{{public_name}}"
  AdminPassword: "{{admin_password}}"
  RCONEnabled: "{{rcon_enabled}}"
  RCONPort: "{{rcon_port}}"
  RCONPassword: "{{rcon_password}}"

# 必需变量
required_vars:
  - server_name       # 直接决定存档路径
  - admin_password
  - server_port
  - server_memory     # 必须手动配置，默认 16g 可能 OOM

# 注意事项
notes:
  - "vanilla 原生支持 RCON，无需 mod"
  - "首次启动需交互式设置 admin 密码（或用 -adminpassword 跳过）"
  - "改变 server_name 会创建全新存档目录"
  - "默认脚本内存配置 16g，必须根据实际硬件调整 -Xms/-Xmx"
  - "INI 修改后可用 /reloadoptions 热加载，无需重启"
  - "RCON 不支持分号复合命令，保存+退出需分两步发送"
```

### 通用实施建议

1. **停止策略差异**：
   - Valheim 必须 SIGINT，**不能假设有 RCON**
   - PZ 优先 RCON，备选 stdin 命名管道；**复合操作需拆分多步**

2. **配置文件管理**：
   - Valheim 用启动参数生成 adminlist/bannedlist/permittedlist
   - PZ 首次启动自动生成 INI，后续通过文本编辑 + `/reloadoptions` 热加载

3. **存档路径管理**：
   - Valheim：`-savedir` 控制根目录，`-world` 控制文件名
   - PZ：`-servername` 同时控制 INI 文件名、存档目录、SQLite DB 文件名

4. **端口管理**：
   - Valheim：必须开放 `port`、`port+1`、`port+2` 三个 UDP
   - PZ：开放 `16261/udp`、`16262/udp`，可选 `rcon_port/tcp`

5. **RCON 策略**：
   - 若 pack.yaml 模板统一要求 RCON 支持，**Valheim 必须将 BepInEx 安装作为前置步骤**，否则应将 Valheim 的 RCON 标记为 `unsupported`
   - PZ 的 RCON 是原生功能，可直接在 INI 配置

6. **任务描述中需修正的假定**：
   - ❌ Valheim `-rcon` / `-rconpassword` 原生参数 → 实际不存在，需 mod
   - ❌ Valheim `save; quit` 复合 RCON 命令 → vanilla 无 RCON，且 mod 不支持分号拼接
   - ❌ PZ `-useradmin` 启动参数 → 实际为 `-adminusername`（设置管理员用户名）
   - ❌ PZ `broadcast` 命令 → 实际为 `servermsg`
   - ❌ PZ `kick` / `ban` / `unban` 命令名 → 实际为 `kickuser` / `banuser` / `unbanuser`
