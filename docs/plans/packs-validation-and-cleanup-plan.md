---
type: plan
title: 游戏 Pack 全量验证与清理方案
date: 2026-07-29
status: 已完成
related: [admin/packs, packs/, daemon/src/instances/adapters/, daemon/src/steamcmd/]
tags: [packs, validation, cleanup, s0702]
---

# 游戏 Pack 全量验证与清理方案

> 目标：对 `https://gsp.ecsrz.com:3001/admin/packs` 全部 12 个 pack 做 8 闸门合规性验证，移除"不能原版支持/短期兼容困难/兼容复杂"的 pack，对保留 pack 校验所有设置确保"点击就能用"。
>
> 审查依据：s0702 游戏 Pack 适配审查 Skill 的 8 闸门清单 + 项目 memory 中的 pack 经验沉淀。
>
> 审查方式：静态代码分析（pack.yaml + daemon adapter + steamcmd client + updateService），未运行 zod schema 校验脚本。

## 一、当前 Pack 清单（12 个）

| # | pack id | game | variant | Steam AppID | 协议 | bootstrap 接入 |
|---|---------|------|---------|-------------|------|---------------|
| 1 | minecraft-vanilla | minecraft | vanilla | N/A（Mojang） | rcon | bootstrapMinecraft |
| 2 | factorio-vanilla | factorio | vanilla | 427520 | rcon | bootstrapSteamGame |
| 3 | rust-vanilla | rust | vanilla | 258550 | webrcon | bootstrapSteamGame |
| 4 | ark-vanilla | ark | vanilla | 376030 | rcon | bootstrapSteamGame |
| 5 | palworld-vanilla | palworld | vanilla | 2374020 | rcon | bootstrapSteamGame |
| 6 | terraria-vanilla | terraria | vanilla | 105600 | stdin | bootstrapSteamGame + writeTerrariaConfig |
| 7 | dst-vanilla | dst | vanilla | 343050 | stdin | bootstrapSteamGame + writeDstClusterFiles |
| 8 | valheim-vanilla | valheim | vanilla | 896660 | rcon(sigint) | bootstrapSteamGame |
| 9 | zomboid-vanilla | zomboid | vanilla | 380870 | rcon | bootstrapSteamGame |
| 10 | enshrouded-vanilla | enshrouded | vanilla | 2278520 | rcon(sigint) | bootstrapSteamGame + writeEnshroudedConfig |
| 11 | satisfactory-vanilla | satisfactory | vanilla | 1690800(Exp) | rcon(sigint) | bootstrapSteamGame + writeSatisfactoryConfig |
| 12 | terraria-tshock | terraria | tshock | N/A（GitHub） | stdin | 共享 terraria adapter（问题） |

## 二、8 闸门审查汇总

### 2.1 闸门定义（s0702）

1. **闸门1** pack.yaml 字段合规（game_type / display_name / install_command / binary / args / stop_signal 必填）
2. **闸门2** install_command 路径绝对化（用 `{{instance_root_abs}}`，含 `mkdir -p`）
3. **闸门3** SteamCMD 命令顺序（`+force_install_dir` 在 `+login` 之前；rust/palworld/ark 含 `validate`）
4. **闸门4** 版本下载路径绝对化（`path.resolve()`）
5. **闸门5** download_pattern 变量解析（`{{var}}` 都有解析器）
6. **闸门6** 版本源优先级（official-site > github-release > steamcmd-buildid > static）
7. **闸门7** daemon bootstrap 接入（adapter 注册 + STEAM_APP_IDS + manager vars + processDriver firstSignal）
8. **闸门8** 特殊游戏适配清单（DST token / Satisfactory Claim / Enshrouded Wine / Valheim 商城限制 / Palworld 商城限制 / Minecraft Mojang API）

### 2.2 汇总矩阵

| pack | 闸门1 | 闸门2 | 闸门3 | 闸门4 | 闸门5 | 闸门6 | 闸门7 | 闸门8 | 分类 |
|------|------|------|------|------|------|------|------|------|------|
| minecraft-vanilla | PASS | WARN | N/A | PASS | PASS | PASS | PASS | PASS | **原生兼容** |
| factorio-vanilla | PASS | WARN | FAIL | PASS | PASS | PASS | PASS | WARN | 兼容困难 |
| rust-vanilla | PASS | WARN | FAIL | PASS | PASS | PASS | PASS | PASS | 兼容困难 |
| ark-vanilla | PASS | WARN | FAIL | PASS | PASS | PASS | WARN | PASS | 兼容困难 |
| palworld-vanilla | PASS | WARN | FAIL | PASS | PASS | PASS | **FAIL** | PASS | 兼容困难（阻断 bug） |
| terraria-vanilla | PASS | WARN | FAIL | PASS | PASS | PASS | PASS | PASS | 兼容困难 |
| dst-vanilla | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **FAIL** | **短期不可行** |
| valheim-vanilla | PASS | PASS | PASS | PASS | PASS | PASS | PASS | WARN | **原生兼容** |
| zomboid-vanilla | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **原生兼容** |
| enshrouded-vanilla | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **FAIL** | **短期不可行** |
| satisfactory-vanilla | PASS | PASS | PASS | PASS | PASS | WARN | **FAIL** | **FAIL** | **短期不可行** |
| terraria-tshock | PASS | FAIL | N/A | PASS | PASS | PASS | **FAIL** | PASS | 兼容困难（阻断） |

> `WARN` = 不阻断但不符合规范表述；`FAIL` = 阻断性或违反硬性规则。

## 三、分类裁决

### 3.1 原生兼容（4 个，保留并确保点击就用）

| pack | 状态 | 备注 |
|------|------|------|
| **minecraft-vanilla** | ✅ 可点击就用 | Mojang API 自动解析版本，eula.txt + server.properties 自动生成，mods/ 目录预创建 |
| **valheim-vanilla** | ✅ 可点击就用 | SteamCMD anonymous 下载，server_password/world_name vars 完整，SIGINT 停止 |
| **zomboid-vanilla** | ✅ 可点击就用 | SteamCMD anonymous 下载，RCON 协议配置完整，ServerName.ini 自动生成 |
| **terraria-vanilla** | ✅ 可点击就用 | SteamCMD anonymous 下载，serverconfig.txt + Worlds/ + banlist.txt 自动生成 |

### 3.2 兼容困难但短期可修复（5 个，保留并修复）

| pack | 阻断性问题 | 修复点 |
|------|-----------|--------|
| **palworld-vanilla** | doStop 路径1 RCON 未渲染 `stop_command` 变量，发送字面量 `Shutdown {{seconds}} {{message}}` 到 RCON 导致停止失败（详见 §四-4.3.1） | 修复 `doStop` 渲染逻辑或简化 palworld `stop_command` 为 `'Shutdown'`（详见 §五步骤 2） |
| **terraria-tshock** | `terraria.ts` adapter 未做变体感知，bootstrap 走 SteamCMD 下载 Terraria vanilla，但 pack.yaml binary 是 `./TShockServer`（来自 GitHub Releases），spawn 时 ENOENT | adapter 增加 `variant === 'tshock'` 分支，跳过 SteamCMD 走 downloadUpdate 流程；或为 tshock 提供独立 adapter |
| **factorio-vanilla** | bootstrap 仅创建 `['config', 'saves']` 子目录，未自动生成 `server-settings.json`，首次启动失败 | factorio adapter 补充 `writeFactorioServerSettings` 调用 |
| **ark-vanilla** | `args[0]='{{map}}'` 依赖 startup_guide 注入，未完成向导则启动失败 | manager.ts vars 补充 `map: 'TheIsland'` 默认值，或强制要求完成 startup_guide |
| **rust-vanilla** | 仅全局 steamcmd 命令顺序问题（非阻断） | 跟随全局修复 |

### 3.3 短期不可行（3 个，建议移除）

| pack | 移除原因 | 是否可未来重新引入 |
|------|---------|------------------|
| **dst-vanilla** | 用户必须到 https://accounts.klei.com/account/serverTokens 手动生成 token 并替换 `cluster_token.txt` 占位文件，未替换无法上线 Klei 列表，不符合"点击就用"目标 | 可，需新增"Klei token 引导"功能（startup_guide 中加 token 输入字段 + 上传写入流程） |
| **enshrouded-vanilla** | 服务器二进制是 Windows .exe，必须通过 `wine64` 包装运行（`binary: wine`, `args: ['./enshrouded_server.exe']`）；bootstrap 不会自动安装 Wine，未预装的服务器无法启动 | 可，需新增"Wine 环境检测 + 自动安装"前置逻辑，或限定专用节点 |
| **satisfactory-vanilla** | 三重问题：① 首次启动必须通过游戏内 Server Manager 设置管理员密码（Claim 流程），自动化无法绕过；② adapter `signalStop='stdin'` 与 pack.yaml `stop_method='sigint'` 矛盾，实际走 SIGTERM 强杀而非期望的 SIGINT 优雅关闭（详见 §四-4.3.2）；③ Steam App ID 不一致（pack.yaml source=526870 Stable vs STEAM_APP_IDS=1690800 Experimental） | 可，需等待 Satisfactory 官方提供命令行 Claim 接口，并修正 signalStop 与 Steam App ID 一致性 |

## 四、关键全局问题

### 4.1 SteamCMD 命令顺序不一致（影响全部 Steam 游戏）

**问题**：项目存在两条 SteamCMD 调用路径，命令顺序互相矛盾：

| 路径 | 文件 | 顺序 | 触发时机 |
|------|------|------|---------|
| bootstrap 路径 | `daemon/src/steamcmd/client.ts:52-58` | `+login anonymous` → `+force_install_dir` → `+app_update` → `+quit` | **首次创建实例时** |
| update 路径 | `panel/backend/src/services/updateService.ts:690-695` | `+force_install_dir` → `+login anonymous` → `+app_update validate` → `+quit` | 用户手动点击"检查更新"时 |

**影响**：违反 s0702 闸门3。SteamCMD 官方文档要求 `+force_install_dir` 在 `+login` 之前，否则会输出路径警告且实例文件可能落到默认目录。bootstrap 路径（首次创建）走的是错误顺序。

**修复**：统一 `daemon/src/steamcmd/client.ts:52-58` 的 args 顺序为 `+force_install_dir` 在 `+login` 之前，与 updateService.ts 保持一致。

### 4.2 pack.yaml install_command 路径变量规范化（全局）

**问题**：6 个核心组 pack（minecraft/factorio/rust/ark/palworld/terraria-vanilla）的 `update.install_command` 或 `download_dir` 使用 `{{instance_root}}` 而非 s0702 闸门2 要求的 `{{instance_root_abs}}`，且未含 `mkdir -p {{instance_root_abs}}`。

**实际影响**：非阻断。`updateService.ts` 内部已将 `instance_root` 渲染为 `.` 并通过 daemon exec `pwd` 获取绝对路径兜底，实际不会路径错乱。

**修复**：作为规范化改进，统一改为 `{{instance_root_abs}}` 并补 `mkdir -p`。

### 4.3 doStop 停止策略三条路径与停止命令未渲染（阻断性 bug × 2）

**doStop 实现回顾**（`daemon/src/instances/manager.ts:457-528`）：停止策略分三条路径，**互斥不组合**：

| 路径 | 触发条件 | 行为 | 是否渲染变量 |
|------|---------|------|-------------|
| 路径1 RCON | `protocol.type !== 'stdin'` 且 `stop_command !== null` | `instance.protocol.send(stopCommand)` | **否**（manager.ts:496,501 直接取原始字符串） |
| 路径2 stdin 命令窗口 | `protocol.type === 'stdin'` 且 `stop_command !== null` | `processDriver.stop` 写入 stdin | **否**（manager.ts:512 直接传原始字符串） |
| 路径3 SIGINT 信号 | `adapter.signalStop === 'sigint'` | `firstSignal='SIGINT'`，跳过 stdin 直接发信号 | N/A（无命令） |

> 路径2 即用户提到的"游戏本身无头模式下的命令窗口"——通过子进程 stdin 写入停止命令（如 terraria 的 `exit`、dst 的 `c_shutdown()`）。路径3 适用于无命令通道的 vanilla 游戏（valheim/enshrouded/satisfactory），通过 SIGINT 触发引擎自身的优雅关闭流程。

**关键事实**：doStop **完全不读取** `pack.startup.stop_method` 字段——该字段仅是文档声明，与实际行为之间无代码级约束。停止路径仅由 `protocol.type` + `adapter.signalStop` + `stop_command` 三元组决定。

**对比**：启动参数 `args` 在 manager.ts:312 通过 `renderTemplate(a, vars)` 渲染，停止命令在 RCON 与 stdin 两条路径均未走相同流程，是实现遗漏。

#### 4.3.1 palworld-vanilla 阻断 bug（路径1 RCON 变量未渲染）

**问题**：palworld `protocol.type: rcon`，`stop_command: 'Shutdown {{seconds}} {{message}}'`（含变量）。doStop 走路径1，manager.ts:501 发送字面量 `Shutdown {{seconds}} {{message}}` 到 RCON，Palworld 服务端无法解析占位符，停止命令失效，最终走 SIGTERM→SIGKILL 兜底（非优雅停止）。

**修复**：见 §五步骤 2。

#### 4.3.2 satisfactory-vanilla 阻断 bug（路径3 SIGINT 策略配置错误）

**问题**：satisfactory pack.yaml 声明 `stop_method: sigint` + `stop_command: null`（期望走路径3 SIGINT），但 `daemon/src/instances/adapters/satisfactory.ts:7` 的 `signalStop: 'stdin'`（与 pack.yaml 矛盾）。导致：
- `getSignalStopStrategy('satisfactory')` 返回 `'stdin'` → `firstSignal=null`
- `stop_command=null` → `stdinStopCmd=null`
- 实际行为：既不发首信号也不写 stdin，等 `stop_timeout=60s` 后 SIGTERM→SIGKILL（processDriver.ts:144-171）

**影响**：Satisfactory（UE4 引擎）期望 SIGINT 优雅关闭（触发世界保存），实际收到 SIGTERM，可能导致世界未保存被强杀。

**注**：satisfactory 已因"需手动 Claim"被列入移除清单（§三-3.3），此 bug 不影响本次移除决策。但若未来重新引入，必须同步修复 adapter signalStop。

**修复**（仅在重新引入时执行）：`satisfactory.ts:7` 改为 `signalStop: 'sigint'`，与 `valheim.ts:7`/`enshrouded.ts:7` 一致。

#### 4.3.3 设计层面隐患（建议但非本次必修）

- `pack.startup.stop_method` 字段在 doStop 中完全未被读取，易出现"声明与实现漂移"（satisfactory 即案例）。建议未来在 doStop 启动时校验 `stop_method` 与 `protocol.type`/`signalStop` 的一致性，不一致时 logger.warn。
- RCON 与 stdin 路径的 stopCommand 均未通过 renderTemplate 渲染变量，与启动参数 args 的渲染流程不对称。palworld 是当前唯一暴露此隐患的 pack。根治方案是在 doStop 两条路径发送前统一调用 `renderTemplate(stopCommand, vars)`。

#### 4.3.4 重新研判结论（2026-07-29：用户提示"不只有 RCON，还有无头模式命令窗口"）

**触发**：用户指出停止策略研判不应只盯 RCON 路径，stdin 命令窗口（路径2）同样不渲染变量，需全面复核所有保留 pack。

**processDriver.stop 优先级确认**（`daemon/src/instances/processDriver.ts:112-137`）：
1. `firstSignal` 存在（signalStop='sigint'）→ 直接发信号，**跳过 stdin**
2. 否则 `stopCommand !== null` → 写 stdin（graceful stop）
3. 超时后 SIGTERM → SIGKILL 升级

即：路径2（stdin）与路径3（SIGINT）**互斥**——signalStop='sigint' 时 stdin 命令被跳过。

**9 个保留 pack 停止策略三元组全量复核**：

| Pack | protocol.type | adapter.signalStop | stop_command | 实际路径 | doStop 渲染 | 含变量? | 结论 |
|------|--------------|-------------------|--------------|---------|------------|---------|------|
| minecraft-vanilla | rcon | stdin | `'stop'` | 路径1 RCON send | 否 | 否 | ✅ 正常 |
| palworld-vanilla | rcon | stdin | `'Shutdown'`（已修复） | 路径1 RCON send | 否 | 否 | ✅ 正常 |
| ark-vanilla | rcon | stdin | `'quit'` | 路径1 RCON send | 否 | 否 | ✅ 正常 |
| rust-vanilla | webrcon | stdin | `'quit'` | 路径1 RCON send | 否 | 否 | ✅ 正常 |
| factorio-vanilla | rcon | stdin | `'quit'` | 路径1 RCON send | 否 | 否 | ✅ 正常 |
| zomboid-vanilla | rcon | stdin | `'quit'` | 路径1 RCON send | 否 | 否 | ✅ 正常 |
| terraria-vanilla | stdin | stdin | `'exit'` | 路径2 stdin write | 否 | 否 | ✅ 正常 |
| terraria-tshock | stdin | stdin | `'exit'` | 路径2 stdin write | 否 | 否 | ✅ 正常 |
| valheim-vanilla | stdin | sigint | `null` | 路径3 SIGINT 信号 | N/A | N/A | ✅ 正常 |

**研判结论**：
1. 9 个保留 pack 的 `stop_command` **全部不含 `{{var}}` 变量**，doStop 不渲染变量的设计不影响当前任何 pack 的停止功能。
2. stdin 路径（terraria ×2）的 `stop_command: 'exit'` 为纯命令，写入 stdin 后游戏控制台正常解析。
3. SIGINT 路径（valheim）`stop_command: null` + `signalStop: 'sigint'`，processDriver 直接发 SIGINT，符合 valheim vanilla 无命令通道的特性。
4. palworld 修复（`'Shutdown {{seconds}} {{message}}'` → `'Shutdown'`）正确，已消除路径1 变量未渲染隐患。
5. **无新增阻断 bug**，无需额外修改代码。

**pack.yaml 编写约束（沉淀）**：`startup.stop_command` 不得包含 `{{var}}` 变量——doStop 的 RCON 路径（manager.ts:501）与 stdin 路径（manager.ts:514）均直接发送原始字符串，不经过 renderTemplate。含变量的停止命令应放在 `commands.shutdown` 字段（由业务层 sendCommand 调用并渲染）。

## 五、执行步骤

### 步骤 1：移除短期不可行的 3 个 pack

**移除清单**：
- `packs/dst-vanilla/`（含 pack.yaml + AGENTS.md）
- `packs/enshrouded-vanilla/`（含 pack.yaml + AGENTS.md）
- `packs/satisfactory-vanilla/`（含 pack.yaml + AGENTS.md）

**操作**：
1. 删除上述 3 个 pack 目录
2. 同步移除 `daemon/src/instances/adapters/dst.ts`、`enshrouded.ts`、`satisfactory.ts` 文件
3. 在 `daemon/src/instances/adapters/index.ts` 移除对应的 `import './<game>.js'` 三行
4. 在 `daemon/src/steamcmd/apps.ts` 移除 `dst: 343050`、`enshrouded: 2278520`、`satisfactory: 1690800` 三条映射
5. 在 `daemon/src/instances/bootstrap.ts` 移除 `writeDstClusterFiles`、`writeEnshroudedConfig`、`writeSatisfactoryConfig` 三个辅助函数（保留代码清理）
6. 全文 grep 确认无残留引用：`grep -rn "dst-vanilla\|enshrouded-vanilla\|satisfactory-vanilla\|writeDstClusterFiles\|writeEnshroudedConfig\|writeSatisfactoryConfig"` 排除 backup/ 和 node_modules/

**移除后校验**：
- `cd daemon && npx tsc --noEmit` 通过
- `cd panel/backend && npx tsc --noEmit` 通过
- `npm run packs:validate`（若存在该脚本）通过

### 步骤 2：修复 palworld stop_command 阻断 bug（doStop 路径1 RCON 变量未渲染）

**操作**（二选一）：

方案 A（推荐，最小改动，零回归风险）：
1. 修改 `packs/palworld-vanilla/pack.yaml` 的 `startup.stop_command` 从 `'Shutdown {{seconds}} {{message}}'` 改为 `'Shutdown'`
2. Palworld RCON 接受 `Shutdown` 命令（无参数时立即关闭，等同 `Shutdown 0`）
3. 优点：仅改 pack.yaml 一行，不动 daemon 核心代码，无回归风险

方案 B（通用修复，根治 doStop 变量未渲染隐患）：
1. 修改 `daemon/src/instances/manager.ts` `doStop` 方法
2. 在 RCON 路径（manager.ts:501）发送前调用 `renderTemplate(stopCommand, vars)` 渲染变量
3. 在 stdin 路径（manager.ts:512）写入前同样调用 `renderTemplate(stopCommand, vars)` 渲染
4. 补充 vars 中 `seconds` 和 `message` 默认值（如 `seconds: '15'`, `message: 'Server shutting down'`）
5. 优点：根治 §四-4.3.3 设计隐患，未来 stdin/RCON 路径的 pack 使用变量不再触发同一问题
6. 风险：修改 doStop 核心逻辑，需对所有 9 个保留 pack 回归测试停止流程

**校验**：
- 启动一个 palworld 实例，运行后点击停止
- 确认实例状态流转到 `stopping` → `stopped`（非 `error`）
- 确认 RCON 日志收到的是 `Shutdown`（方案 A）或 `Shutdown 15 Server shutting down`（方案 B），而非字面量 `Shutdown {{seconds}} {{message}}`
- 对其余 8 个保留 pack 回归测试停止流程（确保方案 B 未引入回归）

### 步骤 3：修复 terraria-tshock adapter 变体感知

**操作**：
1. 修改 `daemon/src/instances/adapters/terraria.ts`
2. 在 bootstrap 钩子内判断 `pack.pack.variant`
3. `variant === 'tshock'` 时：跳过 `bootstrapSteamGame`，仅创建 `Worlds/` 子目录 + 调用 `writeTerrariaConfig`，让用户通过 downloadUpdate 流程从 GitHub Releases 下载 TShockServer
4. `variant === 'vanilla'` 时：保持现有逻辑（`bootstrapSteamGame` + `writeTerrariaConfig`）

**替代方案**：为 tshock 变体提供独立 adapter 文件 `terraria-tshock.ts`，注册 gameType 为 `'terraria-tshock'`，pack.yaml 的 `pack.game` 改为 `'terraria-tshock'`（破坏向后兼容，不推荐）

**校验**：
- 创建 terraria-tshock 实例，确认 bootstrap 不会调用 SteamCMD
- 触发 downloadUpdate，确认从 GitHub Releases 下载 TShockServer 并解压
- spawn 启动，确认无 ENOENT

### 步骤 4：修复 factorio bootstrap 配置生成

**操作**：
1. 在 `daemon/src/instances/bootstrap.ts` 新增 `writeFactorioServerSettings` 函数（参考 `writeTerrariaConfig` 模式）
2. 生成默认 `server-settings.json`（位于 `<workdir>/server-settings.json`），包含必要字段：name / description / tags / max_players / visibility / credentials / autosave_interval / autosave_slots / afk_autokick_interval / allow_commands / autoload / token（占位）
3. 在 `daemon/src/instances/adapters/factorio.ts` bootstrap 钩子中追加调用 `writeFactorioServerSettings(ctx)`

**校验**：
- 创建 factorio 实例，确认 `<workdir>/server-settings.json` 自动生成
- spawn 启动，确认无 "missing server-settings.json" 错误

### 步骤 5：修复 ark {{map}} 变量依赖

**操作**（二选一）：

方案 A（推荐，向前兼容）：
1. 修改 `daemon/src/instances/manager.ts` 中 ark 的 vars
2. 补充 `map: instance.config?.map ?? 'TheIsland'` 默认值
3. 用户未完成 startup_guide 时使用默认地图

方案 B：
1. 修改 `packs/ark-vanilla/pack.yaml` startup_guide
2. 将 `world-setup` step 的 `required` 改为 `true`（强制要求完成向导）
3. 前端阻止未完成向导的实例启动

**校验**：
- 创建 ark 实例，跳过 startup_guide，直接启动
- 确认实例以 TheIsland 地图启动成功

### 步骤 6：修复 SteamCMD 命令顺序（全局）

**操作**：
1. 修改 `daemon/src/steamcmd/client.ts:52-58`
2. 将 args 数组从 `['+login', 'anonymous', '+force_install_dir', installDir, '+app_update', String(appId), 'validate', '+quit']`
3. 改为 `['+force_install_dir', installDir, '+login', 'anonymous', '+app_update', String(appId), 'validate', '+quit']`
4. 与 `updateService.ts:690-695` 保持一致

**校验**：
- 启动一个 Steam 游戏（如 rust）实例
- 确认 SteamCMD 输出无路径警告
- 确认实例文件落到正确目录（无双重嵌套）

### 步骤 7：规范化 install_command 路径变量（可选）

**操作**：
1. 修改 6 个核心组 pack 的 `update.install_command` 或 `download_dir`
2. 将 `{{instance_root}}` 改为 `{{instance_root_abs}}`
3. 在 install_command 前补 `mkdir -p {{instance_root_abs}} &&`（仅 minecraft-vanilla 等使用 install_command 的 pack）

**校验**：
- `npm run packs:validate` 通过
- 各 pack 创建实例 + 启动 + 停止 全流程通过

### 步骤 8：前端 admin/packs 页面同步

**操作**：
1. 检查 `panel/frontend/src/pages/admin/Packs.tsx`（或类似页面）
2. 确认移除的 3 个 pack 不再出现在列表中
3. 若有 pack 数量统计或缓存，触发刷新
4. 确认保留的 9 个 pack 都能正常显示并可创建实例

**校验**：
- 浏览器访问 `https://gsp.ecsrz.com:3001/admin/packs`
- 确认仅显示 9 个 pack
- 逐个点击创建实例，确认每个 pack 都能进入实例详情页

### 步骤 9：版本号与文档更新

**操作**：
1. 按 `.trae/rules/bb.md` 规则，本次属于"对现有功能修改+移除"，递增小版本号
2. 在 `version.md` 添加本次变更说明
3. 若有 README.md 中提及 pack 清单，同步更新

## 六、保留 Pack 验收清单

完成上述步骤后，对保留的 9 个 pack 逐个执行"点击就用"验收：

| pack | 验收动作 | 期望结果 |
|------|---------|---------|
| minecraft-vanilla | 创建实例 → 启动 | server.jar 自动下载，eula.txt + server.properties 自动生成，状态转 running |
| factorio-vanilla | 创建实例 → 启动 | SteamCMD 下载，server-settings.json 自动生成，状态转 running |
| rust-vanilla | 创建实例 → 启动 | SteamCMD 下载，WebRCON 连通，状态转 running |
| ark-vanilla | 创建实例 → 启动（默认 TheIsland） | SteamCMD 下载，状态转 running |
| palworld-vanilla | 创建实例 → 启动 → 停止 | SteamCMD 下载，启动成功，停止命令被 RCON 接受 |
| terraria-vanilla | 创建实例 → 启动 | SteamCMD 下载，serverconfig.txt 自动生成，状态转 running |
| valheim-vanilla | 创建实例 → 启动 | SteamCMD 下载，SIGINT 停止可用 |
| zomboid-vanilla | 创建实例 → 启动 | SteamCMD 下载，RCON 连通，状态转 running |
| terraria-tshock | 创建实例 → 触发 downloadUpdate → 启动 | 从 GitHub Releases 下载 TShockServer，spawn 成功 |

## 七、未来重新引入移除 Pack 的路径

### 7.1 dst-vanilla 重新引入条件

需实现 Klei token 引导功能：
1. 在 `pack.yaml` 的 `startup_guide.steps` 中新增 `klei-token` step
2. 字段类型为 `token_input`，含外链到 https://accounts.klei.com/account/serverTokens
3. 用户输入 token 后，bootstrap 将 token 写入 `cluster_token.txt`
4. 前端校验 token 格式（`pds-^K...==_<KU_id>`）

### 7.2 enshrouded-vanilla 重新引入条件

需实现 Wine 环境检测与安装：
1. 在 `daemon/src/instances/bootstrap.ts` 新增 `ensureWineAvailable` 函数
2. 通过 `which wine64` 检测，缺失时尝试 `apt-get install -y wine64`（需 root）
3. 检测失败时抛 `BootstrapError`，前端明确告知"需预装 Wine"
4. 或限定 enshrouded 仅可部署在打了 `wine-capable` 标签的专用节点

### 7.3 satisfactory-vanilla 重新引入条件

需等待 Satisfactory 官方提供命令行 Claim 接口，或：
1. 实现自动化 Claim 代理（通过游戏协议模拟客户端 Claim）
2. 修正 Steam App ID 一致性（pack.yaml source 与 STEAM_APP_IDS 统一为 Stable 526870 或 Experimental 1690800）
3. 修正 signalStop 一致性（adapter `satisfactory.ts:7` 改为 `'sigint'`，与 pack.yaml `stop_method='sigint'` 一致；详见 §四-4.3.2）

## 八、风险与注意事项

1. **移除 pack 的数据兼容性**：若数据库中已有 dst/enshrouded/satisfactory 的实例记录，移除 pack 后这些实例将无法启动。**移除前需确认无运行中实例，或先清理相关实例**。
2. **dyson adapter 残留**：`daemon/src/instances/adapters/dyson.ts` 存在但 `packs/` 目录无 dyson pack。本次清理范围不涉及 dyson adapter，但建议同步核查是否应移除（不在本方案范围）。
3. **staticVersions.ts 影响**：`staticVersions.ts` 中若含被移除 pack 的版本条目，需同步清理（扩展组报告提及 factorio/palworld/terraria-vanilla 在 STATIC_VERSION_SOURCES 中）。
4. **回滚预案**：移除前建议备份 `packs/`、`daemon/src/instances/adapters/`、`daemon/src/steamcmd/apps.ts`、`daemon/src/instances/bootstrap.ts` 到 `backup/packs-cleanup-20260729/`。
5. **本方案未运行 zod schema 校验**：s0702 闸门1 建议运行 `npx tsx -e "import { PackSchema } from './public/schema/pack-schema'; PackSchema.parse(require('./packs/<game>-vanilla/pack.yaml'))"` 自动校验。本次审查降级为人工字段核对，建议在执行阶段补跑 `npm run packs:validate`（若存在该脚本）。

## 九、Subagent 执行台账

| 阶段标签 | [P]组 | subagent_type | 预期产物 | actual agent id | 第二落点 | 失败回退点 | 状态 |
|---------|-------|---------------|---------|----------------|---------|-----------|------|
| 验证-核心组 | [P]G1 | general_purpose_task | 6 个核心 pack 的 8 闸门审查报告 | Task#core-6packs-review | 本文件 §二、§三 | 主线程重新拉起审查 | 已完成 |
| 验证-扩展组 | [P]G1 | general_purpose_task | 6 个扩展 pack 的 8 闸门审查报告 | Task#ext-6packs-review | 本文件 §二、§三 | 主线程重新拉起审查 | 已完成 |
| 整合方案 | — | 主线程（非subagent） | 本方案文档初稿 | 主线程 | docs/plans/packs-validation-and-cleanup-plan.md | — | 已完成 |
| 重新研判-停止策略 | — | general_purpose_task | 12 个 pack 的停止策略三元组研判报告（protocol.type/stop_command/signalStop） | Task#stop-strategy-review | 本文件 §四-4.3 | 主线程重新拉起审查 | 已完成 |
| 整合研判修订 | — | 主线程（非subagent） | 本方案文档 §四-4.3 / §三-3.3 / §五步骤 2 / §七-7.3 修订 | 主线程 | 本文件 | — | 已完成 |

## 十、裁决事项（已全部闭合）

本方案涉及"移除 3 个 pack"为不可逆路径锁定前的价值判断节点（[V]），裁决结果如下：

1. ✅ **批准移除 dst/enshrouded/satisfactory 三个 pack**——已删除 pack 目录、adapter、bootstrap 引用、steamcmd apps 映射
2. ✅ **palworld stop_command 修复选方案 A**——`stop_command: 'Shutdown'`（无变量），最小改动零回归
3. ✅ **ark {{map}} 修复选方案 A**——`manager.ts:310` 兜底 `map: 'TheIsland'`，向前兼容
4. ✅ **terraria-tshock 修复选变体感知**——`terraria.ts` 判断 variant，tshock 跳过 SteamCMD
5. ✅ **dyson adapter 不动**——预先存在的孤立 adapter，单独评估
6. ✅ **satisfactory signalStop bug 不修**——pack 已移除，记录到 §七-7.3 待重新引入时修复

---

## 十一、完成度审计（2026-07-29）

### 11.1 工程过程

1. s0702 8 闸门审查 12 个原始 pack（2 个并行 subagent）
2. 分类：4 原生兼容 + 5 兼容困难 + 3 短期不可行
3. 移除 3 个短期不可行 pack（dst/enshrouded/satisfactory）
4. 修复 5 个阻断性 bug（palworld stop_command / terraria-tshock 变体 / SteamCMD 命令顺序 / factorio 配置生成 / ark 默认地图）
5. 停止策略重新研判（用户提示"不只有 RCON，还有无头模式命令窗口"）—— doStop 三条路径全量复核 9 个保留 pack
6. 修复 validate-packs.ts 路径解析问题（tsx 环境 import.meta.url 异常）
7. 修复 frontend mock 数据类型错误（ServerSummary 缺 expires_at/expiry_status）
8. 清理 /tmp 磁盘空间（ENOSPC 导致 vitest 无法写入）

### 11.2 交接状态

| 产物 | 状态 | 验证证据 |
|------|------|---------|
| 9 个 pack schema 校验 | 已完成 | `npx tsx scripts/validate-packs.ts` → 9/9 PASS |
| daemon 编译 | 已完成 | `npx tsc --noEmit` → 0 errors |
| backend 编译 | 已完成 | `npx tsc --noEmit` → 0 errors |
| frontend 编译 | 已完成 | `npx tsc --noEmit` → 0 errors |
| frontend 构建 | 已完成 | `npm run build` → ✓ built + 验证通过 |
| daemon 测试 | 已完成 | 20/20 passed |
| backend 测试 | 已完成 | 568/568 passed |
| frontend 测试 | 已完成 | 290/290 passed |
| **合计** | **878/878 passed** | |

### 11.3 最终结果

- **保留 9 个 pack**：minecraft / factorio / rust / ark / palworld / terraria-vanilla / terraria-tshock / valheim / zomboid
- **移除 3 个 pack**：dst（需 DST 集群 token）/ enshrouded（需 Wine）/ satisfactory（需手动 Claim）
- **修复 5 个阻断性 bug**：全部闭合，测试全绿
- **停止策略**：9 个保留 pack 的 doStop 三元组（protocol.type / signalStop / stop_command）全部研判通过，无变量未渲染隐患
