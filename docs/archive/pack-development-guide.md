# Pack 开发指南 — 添加新游戏

> 本文档指导如何为 GameServer Panel 3.0 添加新游戏支持。通过编写 Pack YAML 配置文件，无需修改代码即可接入新游戏。

---

## 一、快速入门

添加新游戏只需3步：

1. 复制模板：`cp public/config_template/pack-template.yaml packs/<game-id>/pack.yaml`
2. 按目标游戏填充实际值
3. 重载 Pack：`POST /api/packs/reload`（需管理员权限）

Pack YAML 必须通过 `public/schema/pack-schema.ts`（zod）校验，不符合 Schema 的 Pack 会被拒绝加载。

---

## 二、Pack YAML 字段详解

### 2.1 Pack 元数据（必填）

```yaml
pack:
  id: terraria-vanilla          # kebab-case，全局唯一，建议格式：游戏名-变体
  game: terraria                 # 游戏类型标识（小写）
  variant: vanilla               # 变体标识（vanilla / modded / tshock ...）
  display_name: 泰拉瑞亚 (原版)   # 用户可见的中文名
  version: '1.0'                 # Pack 版本号（语义版本）
```

| 字段 | 说明 | 示例 |
|------|------|------|
| `id` | Pack 唯一标识，kebab-case | `terraria-vanilla` |
| `game` | 游戏类型，用于分发逻辑 | `terraria` |
| `variant` | 变体，区分原版/Mod版 | `vanilla`, `tshock` |
| `display_name` | 用户可见名，建议中文 | `泰拉瑞亚 (原版)` |
| `version` | Pack 版本号 | `1.0` |

### 2.2 启动配置（必填）

```yaml
startup:
  binary: './TerrariaServer.exe'     # 或 Linux 下的 './TerrariaServer.bin.x86_64'
  args:                               # 启动参数，支持 {{变量}} 模板
    - '-server'
    - '-port'
    - '{{game_port}}'
    - '-password'
    - '{{rcon_password}}'
  working_dir: '{{instance_root}}'    # 工作目录
  ready_pattern: 'Server started'     # 就绪检测正则
  stop_command: 'exit'                # 停止命令
  stop_timeout: 30                    # 停止超时（秒）
  default_game_port: 7777             # 默认游戏端口
```

#### 可用模板变量

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `{{instance_root}}` | 实例工作目录 | `/data/instances/abc123` |
| `{{game_port}}` | 游戏端口 | `7777` |
| `{{rcon_port}}` | RCON 端口 | `27015` |
| `{{rcon_password}}` | RCON 密码 | `random123` |
| `{{server_name}}` | 服务器名称 | `我的生存服` |
| `{{save_path}}` | 存档文件路径 | `/data/.../saves/world` |
| `{{config_dir}}` | 配置文件目录 | `/data/.../config` |
| `{{max_players}}` | 最大玩家数 | `20` |
| `{{jvm_xmx}}` | JVM 最大堆（Minecraft用） | `2G` |

#### ready_pattern 编写指南

`ready_pattern` 是正则表达式，匹配服务器启动完成时输出的日志行：

| 游戏 | 就绪日志示例 | ready_pattern |
|------|-------------|---------------|
| Minecraft | `[Server thread/INFO]: Done (...)! For help, type "help"` | `Done \(.*\)! For help` |
| Factorio | `Changing state from(CreatingGame) to(InGame)` | `changing state from\([^)]+\) to\(InGame\)` |
| Palworld | `[API] API Listening on port` | `API Listening on port` |
| ARK | `Setting breakpad minidump AppVersion` | `Setting breakpad minidump` |

**技巧**：观察游戏服务器启动日志，找到标志"就绪"的唯一行，转义正则特殊字符。

### 2.3 通信协议（必填）

```yaml
protocol:
  type: rcon              # stdin | rcon | webrcon
  default_port: 27015      # rcon/webrcon 必填
  auth: password          # stdin=none, rcon/webrcon=password
  encrypt: none           # none | tls
```

#### 协议选择指南

| 协议 | 适用场景 | 特点 |
|------|---------|------|
| `stdin` | 无RCON的游戏 | 通过进程标准输入发送命令，无独立端口 |
| `rcon` | Minecraft/Factorio等 | 独立TCP端口，密码认证 |
| `webrcon` | Rust等支持HTTP RCON的游戏 | HTTP协议，更安全 |

### 2.4 配置文件（必填）

```yaml
config:
  format: json            # properties | json | ini | yaml
  main_file: server-settings.json
  schema:                  # 可编辑配置项（前端表单依据）
    - key: max_players
      type: int
      label: 最大玩家数
      default: 20
      min: 1
      max: 100
      description: 同时在线玩家上限
    - key: server_name
      type: string
      label: 服务器名称
      default: ''
      description: 显示在服务器列表的名称
```

#### 字段类型

| type | 渲染为 | 适用 |
|------|--------|------|
| `string` | 文本输入框 | 字符串 |
| `int` | 数字输入框 | 整数 |
| `float` | 数字输入框 | 浮点数 |
| `bool` | 开关 | 布尔值 |
| `enum` | 下拉选择 | 枚举值（需配 `enum_values`） |

### 2.5 通用命令模板

```yaml
commands:
  broadcast: 'say {{message}}'              # 全服广播
  list_players: 'list'                       # 列出玩家
  save_world: 'save-all'                     # 保存世界
  say_private: 'tell {{player}} {{message}}' # 私聊
```

#### 可用命令变量

| 变量 | 说明 |
|------|------|
| `{{message}}` | 消息内容 |
| `{{player}}` | 玩家名 |
| `{{item}}` | 物品ID |
| `{{count}}` | 数量 |
| `{{reason}}` | 原因（踢人/封禁） |

### 2.6 版本管理

```yaml
versions:
  source: steamcmd        # 版本来源：steamcmd | mojang | github | custom
  type: steamcmd          # server-jar | binary | steamcmd
  # download_pattern 仅用于 binary 类型
  # steamcmd 类型由 daemon/src/steamcmd/ 自动处理
```

### 2.7 资源建议

```yaml
resources:
  min_ram: '1G'           # 最小内存
  recommended_ram: '2G'    # 推荐内存
  min_disk: '500M'         # 最小磁盘
```

---

## 三、扩展字段（可选）

以下字段全部 optional，不写即视为禁用对应业务。

### 3.1 物品池（商城/CDK 使用）

```yaml
items:
  source:
    type: static          # static | github_sync | local_file
  # static 模式：直接内联物品清单
  static_list:
    - name: iron-plate
      display_name: 铁板
      category: item
    - name: copper-plate
      display_name: 铜板
      category: item
  quality_tiers: 0       # 0=不支持品质，5=5级品质
  categories: [item, ammo, armor]
```

### 3.2 事件解析器

```yaml
event_parsers:
  chat:
    pattern: '^\[([0-9:]+)\] \[(.*?)\] (.+?): (.+)$'
    groups: [timestamp, level, player, message]
  join:
    pattern: '^(\S+) joined the game$'
    player_group: 1
  leave:
    pattern: '^(\S+) left the game$'
    player_group: 1
```

#### 正则 group 说明

| 事件 | 必需 group | 说明 |
|------|-----------|------|
| `chat` | `timestamp`, `player`, `message` | 聊天解析 |
| `join` | `player_group` 指向玩家名的 group 索引 | 加入事件 |
| `leave` | `player_group` 指向玩家名的 group 索引 | 离开事件 |

### 3.3 业务能力声明

```yaml
business:
  shop:
    enabled: true
    give_command: "give {{player}} {{item}} {{count}}"
    support_quality: false    # 是否支持品质选择
  
  cdk:
    enabled: true
    redeem_command: 'same as shop.give_command'  # 引用shop命令
  
  chat_enhancement:
    welcome:
      enabled: true
      first_gift_command: 'same as shop.give_command'
    periodic_messages:
      enabled: true
      broadcast_command: 'say {{message}}'
    response_rules:
      enabled: true       # 关键词触发响应
  
  players:
    kick_command: 'kick {{player}} {{reason}}'
    ban_command: 'ban {{player}} {{reason}}'
  
  verify:
    enabled: true          # 玩家绑定验证
```

**重要**：不支持的能力必须 `enabled: false` 或删除整个字段，不可留空 `enabled`。

---

## 四、完整示例：添加泰拉瑞亚

以下是一个完整的 Terraria Pack 示例：

```yaml
# packs/terraria-vanilla/pack.yaml

pack:
  id: terraria-vanilla
  game: terraria
  variant: vanilla
  display_name: 泰拉瑞亚 (原版)
  version: '1.0'

startup:
  binary: './TerrariaServer.bin.x86_64'    # Linux 专用服务器
  args:
    - '-server'
    - '-port'
    - '{{game_port}}'
    - '-players'
    - '8'
    - '-world'
    - '{{save_path}}'
  working_dir: '{{instance_root}}'
  ready_pattern: 'Server started'
  stop_command: 'exit'
  stop_timeout: 15
  default_game_port: 7777

protocol:
  type: stdin              # Terraria 原版无 RCON，用 stdin
  default_port: 0
  auth: none
  encrypt: none

config:
  format: txt
  main_file: serverconfig.txt
  schema:
    - key: max_players
      type: int
      label: 最大玩家数
      default: 8
      min: 1
      max: 255
      description: 同时在线玩家上限
    - key: server_name
      type: string
      label: 服务器名称
      default: 'Terraria Server'
      description: 显示在服务器列表的名称
    - key: password
      type: string
      label: 服务器密码
      default: ''
      description: 留空表示无密码
    - key: difficulty
      type: enum
      label: 难度
      default: normal
      enum_values: [normal, expert, master, journey]
      description: 游戏难度等级

commands:
  broadcast: 'say {{message}}'
  list_players: 'playing'
  save_world: 'save'
  say_private: 'say {{message}}'

versions:
  source: steamcmd
  type: steamcmd
  # Terraria Dedicated Server AppID: 105600
  # SteamCMD 自动处理下载

resources:
  min_ram: '512M'
  recommended_ram: '1G'
  min_disk: '200M'

# ---- 扩展字段 ----

items:
  source:
    type: static
  static_list:
    - name: copper-ore
      display_name: 铜矿石
      category: item
    - name: iron-ore
      display_name: 铁矿石
      category: item
    - name: gold-ore
      display_name: 金矿石
      category: item
    - name: wood
      display_name: 木材
      category: item
    - name: stone
      display_name: 石头
      category: item
  quality_tiers: 0
  categories: [item, weapon, accessory]

event_parsers:
  chat:
    pattern: '^\[.*?\] (.*?): (.+)$'
    groups: [player, message]
  join:
    pattern: '^(\S+) has joined.'
    player_group: 1
  leave:
    pattern: '^(\S+) has left.'
    player_group: 1

business:
  shop:
    enabled: true
    give_command: 'give {{player}} {{item}} {{count}}'
    support_quality: false
  
  cdk:
    enabled: true
    redeem_command: 'same as shop.give_command'
  
  chat_enhancement:
    welcome:
      enabled: true
      first_gift_command: 'same as shop.give_command'
    periodic_messages:
      enabled: false
    response_rules:
      enabled: true
  
  players:
    kick_command: 'kick {{player}}'
    ban_command: 'ban {{player}}'
  
  verify:
    enabled: true
```

---

## 五、SteamCMD 集成

支持 SteamCMD 自动下载的游戏，在 `versions` 中配置：

```yaml
versions:
  source: steamcmd
  type: steamcmd
```

### 常见游戏 Steam AppID

| 游戏 | AppID | 说明 |
|------|-------|------|
| Factorio | 427520 | Headless Server |
| ARK: Survival Evolved | 376030 | Dedicated Server |
| Rust | 258550 | Dedicated Server |
| Palworld | 2374020 | Dedicated Server |
| Terraria | 105600 | Dedicated Server |
| Valheim | 896660 | Dedicated Server |
| Don't Starve Together | 343050 | Dedicated Server |

### 获取 AppID 的方法

1. 访问 [SteamDB](https://steamdb.info/) 搜索游戏名
2. 找到 "Dedicated Server" 条目
3. 复制 AppID

**注意**：大多数专用服务器支持匿名登录（anonymous），少数需要购买后才可下载。

---

## 六、验证清单

新增 Pack 后，按以下清单验证：

- [ ] YAML 语法正确（无缩进错误）
- [ ] `pack.id` 全局唯一
- [ ] `display_name` 为中文
- [ ] `ready_pattern` 正则能匹配实际启动日志
- [ ] `protocol.type` 与游戏实际支持的协议一致
- [ ] `config.schema` 每个字段都有 `description`（中文）
- [ ] `commands` 中的变量名正确（`{{player}}` 等）
- [ ] 不支持的业务设为 `enabled: false` 或删除
- [ ] `POST /api/packs/reload` 返回 loaded 列表包含新 Pack
- [ ] 前端创建实例页能看到新游戏的中文名

---

## 七、调试技巧

### 7.1 查看 Pack 加载错误

```bash
# 重载 Pack 并查看详细错误
curl -X POST http://localhost:3000/api/packs/reload \
  -H "Authorization: Bearer <token>"
```

返回的 `failed` 列表包含加载失败的 Pack 及错误原因。

### 7.2 测试 ready_pattern

启动游戏服务器，观察 stdout 日志，找到标志就绪的行，用正则测试：

```bash
echo "Done (3.5s)! For help, type \"help\"" | grep -P 'Done \(.*\)! For help'
```

### 7.3 验证命令模板

在控制台 Tab 手动发送命令，检查变量是否正确替换：

```
# 发送：say hello
# 预期：broadcast 命令渲染为 say hello
```

---

## 八、常见问题

### Q: 新 Pack 不显示在创建页面？

A: 检查：
1. YAML 语法是否正确
2. `POST /api/packs/reload` 是否成功
3. `GET /api/packs` 是否返回新 Pack
4. 前端是否刷新页面

### Q: 服务器启动但状态一直 starting？

A: `ready_pattern` 正则可能不匹配。检查：
1. 控制台 Tab 查看实际输出日志
2. 用 `grep -P` 测试正则是否匹配
3. 正则特殊字符是否转义（`.` `\(` `\)` 等）

### Q: 命令发送后无响应？

A: 检查：
1. `protocol.type` 是否正确
2. RCON 端口和密码是否配置
3. 游戏是否支持该命令

### Q: 如何添加 Mod 版本的游戏？

A: 创建新 Pack，`variant` 改为 `modded`：
```yaml
pack:
  id: minecraft-forge
  game: minecraft
  variant: forge
  display_name: 我的世界 Forge版
```
启动参数中添加 Forge 相关参数。

---

> 文档结束。如有疑问，参考 `public/config_template/pack-template.yaml` 模板的完整注释。
