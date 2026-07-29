---
name: "s0702-game-pack-adaptation-review"
description: "Reviews new game pack adaptation: pack.yaml fields, install_command ordering/paths, version source priority, bootstrap wiring, special-game checklist. Invoke when adding/modifying game packs or pack.yaml."
---

# s0702 游戏 Pack 适配审查

> 本 Skill 由 v4.1.0（7 个新游戏 pack）+ v4.11.0（pack 系统重构）的实际适配教训沉淀而来，把高频出错点产品化为可执行审查清单。

## 一、何时调用

- **强制触发**：新增 game pack（在 `packs/<game>-vanilla/` 下新建 pack.yaml）
- **强制触发**：修改现有 pack.yaml 的 install_command / download_pattern / bootstrap 字段
- **强制触发**：daemon `bootstrap.ts` 新增 switch case 或 STEAM_APP_IDS 映射
- **建议触发**：版本源（staticVersions.ts）新增条目

## 二、审查清单（8 项硬性闸门）

### 闸门 1：pack.yaml 字段合规

**检查项**：
- [ ] pack.yaml 通过 `public/schema/pack-schema.ts` 的 zod schema 校验
- [ ] 必填字段齐全：`game_type` / `display_name` / `install_command` / `binary` / `args` / `stop_signal`
- [ ] `game_type` 与 daemon `bootstrap.ts` switch case 一一对应
- [ ] `ui.tabs` 扩展为对象数组（含 `group` / `order` / `require_state` 字段，v4.0.4+）

**执行命令**：
```bash
cd /home/airxw/Documents/gsp/gameserver-panel
npx tsx -e "import { PackSchema } from './public/schema/pack-schema'; PackSchema.parse(require('./packs/<game>-vanilla/pack.yaml'))"
```

### 闸门 2：install_command 路径绝对化

**经验源**：SteamCMD 脚本内部会 `cd /opt/steamcmd`，使得 install_command 中的相对路径解析到错误目录；`./instances/<id>` 造成双重嵌套 `instances/<id>/instances/<id>`。

**检查项**：
- [ ] install_command 使用 `{{instance_root_abs}}` 变量（绝对路径），**不是** `./instances/<id>` 或 `{{instance_root}}`
- [ ] `updateService.ts` 通过 daemon exec `pwd` 调用解析 `instance_root_abs` 为绝对路径
- [ ] install_command 含 `mkdir -p {{instance_root_abs}}` 预创建实例根目录（防止首次安装时"文件创建失败"）

**正确范式**：
```yaml
install_command: |
  mkdir -p {{instance_root_abs}}
  /usr/local/bin/steamcmd \
    +force_install_dir {{instance_root_abs}} \
    +login anonymous \
    +app_update <APP_ID> validate \
    +quit
```

### 闸门 3：SteamCMD 命令顺序

**经验源**：`+force_install_dir` 必须在 `+login` 之前，否则 SteamCMD 会输出路径警告，且实例文件可能落到默认目录。

**检查项**：
- [ ] `+force_install_dir {{instance_root_abs}}` 在 `+login` 之前
- [ ] `+app_update <APP_ID>` 在 `+login` 之后
- [ ] Rust / Palworld / ARK 的 install_command 含 `validate` 参数（确保文件完整性）

### 闸门 4：版本下载路径绝对化

**经验源**：Game version download paths 若存为相对路径，安装时工作目录不匹配会导致文件找不到。

**检查项**：
- [ ] `staticVersions.ts` 中版本下载路径通过 `path.resolve()` 转绝对路径
- [ ] `updateService.ts` 中 `instance_root` 通过 `path.resolve()` 转绝对路径（避免双重嵌套）

### 闸门 5：download_pattern 变量解析

**经验源**：Minecraft pack 的 `download_pattern` 中 `{{server_url}}` 变量需通过 Mojang API 解析为真实下载 URL，否则下载失败。

**检查项**：
- [ ] `download_pattern` 中的所有 `{{var}}` 变量都有对应的解析器
- [ ] `{{server_url}}` 通过 Mojang version_manifest API 解析
- [ ] `{{github_release}}` 通过 GitHub Releases API 解析
- [ ] 无未解析的 `{{var}}` 残留到下载阶段

### 闸门 6：版本源优先级

**经验源**：v4.11.0 pack 系统重构方案确定的版本源优先级——official-site > github-release > steamcmd-buildid > static。

**检查项**：
- [ ] 版本源按优先级排序：official-site > github-release > steamcmd-buildid > static
- [ ] 多源时优先尝试高优先级源，失败降级到次优先级
- [ ] 降级时记录日志，不静默失败

### 闸门 7：daemon bootstrap 接入

**经验源**：v4.1.0 新增 7 个 pack 时，daemon `bootstrap.ts` switch 必须配套新增 case + 辅助函数，否则实例启动时找不到 bootstrap 逻辑。

**检查项**：
- [ ] `daemon/src/instances/bootstrap.ts` switch 含新 game_type 的 case
- [ ] 新 case 配套辅助函数（如 `bootstrapMinecraft` / `bootstrapFactorio`）
- [ ] `daemon/src/steamcmd/apps.ts` 的 `STEAM_APP_IDS` 含新游戏的 APP_ID 映射
- [ ] `daemon/src/instances/manager.ts` 的 `vars` 含新游戏所需变量
- [ ] `daemon/src/instances/processDriver.ts` 的 stop 方法支持新游戏的 `firstSignal` 参数（SIGINT 优先）

**接入校验**（与 s0703 联动）：
- [ ] bootstrap switch case 被 `manager.ts` 调用（运行时接入）
- [ ] STEAM_APP_IDS 被 `apps.ts` 导出并被 `bootstrap.ts` 引用

### 闸门 8：特殊游戏适配清单

**经验源**：v4.1.0 中 DST/Satisfactory/Enshrouded/Dyson 各有特殊适配需求，遗漏会导致用户首次启动失败。

**检查项**（按游戏类型）：
- [ ] **DST**：用户须知到 https://accounts.klei.com/account/serverTokens 生成 token 并替换 `cluster_token.txt`
- [ ] **Satisfactory**：用户须知通过游戏内 Server Manager 设置管理员密码（Claim 流程）
- [ ] **Enshrouded**：需要 Wine 运行环境（`binary: wine`, `args: ['./enshrouded_server.exe']`）
- [ ] **Dyson**：用户须手动放置游戏目录 + 安装 BepInEx + Nebula Mod（不支持 SteamCMD anonymous 下载）
- [ ] **Valheim**：商城物品发放功能有限制（spawn 命令为主，明确告知用户限制）
- [ ] **Palworld**：商城物品发放功能有限制（与 Valheim 同）
- [ ] **Minecraft**：`{{server_url}}` 通过 Mojang API 解析，eula.txt + server.properties 由 `bootstrapMinecraft` 自动生成

## 三、执行流程

```python
def run_pack_review(pack_name):
    gates = [
        ("闸门1 pack.yaml 字段合规", lambda: check_pack_schema(pack_name)),
        ("闸门2 install_command 路径绝对化", lambda: check_install_command_abs(pack_name)),
        ("闸门3 SteamCMD 命令顺序", lambda: check_steamcmd_order(pack_name)),
        ("闸门4 版本下载路径绝对化", lambda: check_version_path_abs(pack_name)),
        ("闸门5 download_pattern 变量解析", lambda: check_download_pattern_vars(pack_name)),
        ("闸门6 版本源优先级", lambda: check_version_source_priority(pack_name)),
        ("闸门7 daemon bootstrap 接入", lambda: check_bootstrap_wiring(pack_name)),
        ("闸门8 特殊游戏适配清单", lambda: check_special_game_adaptation(pack_name)),
    ]
    results = []
    for name, check in gates:
        passed, evidence = check()
        results.append((name, passed, evidence))
        if not passed:
            return results, "BLOCKED"
    return results, "PASS"
```

## 四、阻断处理

任一闸门失败：
1. 立即停止 pack 上线流程
2. 输出失败闸门 + 证据 + 修复建议
3. 通过 L3 信号（AskUserQuestion）向人类报告，等待裁决

## 五、与现有规则的关系

- 补强 `rules-3`（契约可验证性）——pack 适配高频出错点未产品化
- 与 `s0703-runtime-wiring-verification` 联动——闸门 7 验证 bootstrap 接入运行时
- 与 `rules-0 §四-10`（public/ 保护）联动——pack-schema.ts 修改需走契约变更流程

## 六、降级路径

若本 Skill 检查项无法自动执行（如 zod schema 校验脚本缺失）：
1. L1：可执行项自动跑，缺失项输出手动检查清单
2. L2：通过 L2 信号（NotifyUser）告知人类"部分检查项需手动执行"，附完整清单
3. L3：记录"pack 适配审查降级"到 `.trae/documents/`，下次审查前重试

不得伪装所有闸门已通过。

## 七、诚实沟通原则

**经验源**：v4.11.0 pack 系统重构方案中，Palworld/Valheim 的商城物品发放功能存在客观限制，必须在用户文档中明确告知，不得伪装为"完整支持"。

**检查项**：
- [ ] pack.yaml 的 `limitations` 字段（若有）如实描述功能限制
- [ ] README.md 中对应游戏的说明含限制告知
- [ ] 不得使用"完整支持""全功能"等绝对化表述
