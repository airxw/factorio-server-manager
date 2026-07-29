---
type: plan
title: 实例启停交互与启动前置引导方案
date: 2026-07-29
status: draft
related: instance, startup_guide, action_bar, pack_schema, port_allocation
tags: [plan, instance, startup-guide, action-bar, pack-extension]
---

# gsp 实例启停交互与启动前置引导方案

> 本方案针对当前实例详情页底部固定操作栏布局不合理、启停缺乏前置引导、端口可被用户修改、不同游戏启动规则未声明等问题，提出统一的交互重构与 Pack 规则扩展方案。
>
> 遵循「方案编制不计人力工期与开发投入、不区分优先级，仅输出执行步骤、开发事项与建议」原则。

---

## 0. 问题陈述与用户裁决

### 0.1 用户核心诉求

> 启停按钮这么布局并不合适；实例的启停需要引导用户完成基本设定（地图、配置等基础信息）；端口用实例信息传递，不允许修改；针对不同的游戏需要设定好规则。

### 0.2 问题拆解

| 编号 | 问题 | 现状证据 |
|------|------|----------|
| P1 | 启停按钮布局不合理 | `bottom-action-bar` 全宽 `position:fixed` 底栏，遮挡内容（需 `page-with-bottom-bar` 留 64px padding），启动/停止/刷新/重置状态混排，主次不分 |
| P2 | 启停无前置引导 | `handleStart` 直接调 `api.startServer`，后端 `/start` 仅校验 `status==='stopped'`，不校验地图/配置是否就绪 |
| P3 | 端口可被用户修改 | 创建表单 `CreateServer.tsx` 暴露 `port`/`rconPort` 输入框；后端 `body.port ?? allocatePort(...)` 允许用户指定 |
| P4 | 不同游戏启动规则未声明 | Pack YAML 中地图/世界概念分散：Minecraft 用 `config.schema` 的 `level-name`、ARK 把地图 `TheIsland` 写死在 `startup.args[0]`、Terraria 用 `config_files` 的 `worldname+seed`；无统一的"启动前置项声明"机制 |

---

## 1. 现状分析

### 1.1 底部操作栏现状

- **位置**：`panel/frontend/src/pages/ServerDetail.tsx#L1084-L1114`
- **样式**：`panel/frontend/src/styles.css#L4754` — `position: fixed; bottom: 0; left:0; right:0`，居中按钮，`z-index: 100`
- **按钮**：启动（success）、停止（warning）、刷新（ghost）、重置状态（仅 error+admin）
- **启用条件**：`canStart = displayState==='stopped'`；`canStop = running/starting/error`
- **问题**：
  - 全宽固定底栏视觉过重，与"苹果清新设计语言"相悖
  - 启动是主操作却与刷新（次要操作）同级排布
  - 底栏遮挡导致页面需额外 `padding-bottom: 64px`，移动端浪费空间

### 1.2 启停流程现状

- **前端**：`handleStart`/`handleStop`（`ServerDetail.tsx#L472-L504`）直接调用 API，无任何前置校验或引导
- **后端启动**：`POST /api/servers/:id/start`（`servers.ts#L531-L634`）
  - 仅校验 `row.status !== 'stopped'` → 409
  - 透传 `instance.{name, port, rcon_port, rcon_password, workdir}` 给 daemon
  - **不传地图、世界名、种子、玩家数等启动参数**
- **后端创建**：`POST /api/servers`（`servers.ts#L187-L423`）
  - 写入 `name/pack_id/node_id/port/rcon_port/rcon_password/version`
  - **不写任何启动配置**（地图/世界/基础设定）

### 1.3 端口分配现状

- 创建时分配：`port = body.port ?? allocatePort(db, 'port', gamePortBase, portRange)`（`servers.ts#L321`）
- 创建表单暴露 `port`/`rconPort` 输入框（`CreateServer.tsx#L63-L64`）
- 启动时从 `servers` 表读取透传给 daemon

### 1.4 不同游戏的地图/世界概念（关键差异）

| 游戏 | 地图/世界概念 | 配置位置 | 当前可配置性 |
|------|--------------|----------|-------------|
| Minecraft | `level-name`（世界/存档目录名）+ 种子（`level-seed`，Pack 未声明） | `config.schema` | 字段存在，但启动前未引导 |
| ARK | 地图名（`TheIsland`/`ScorchedEarth`/`Aberration` 等） | **写死在 `startup.args[0]`** | 用户无法选择地图 |
| Terraria | `worldname` + `seed` + `difficulty` | `config_files.serverconfig.txt` | 字段存在，但启动前未引导 |
| Valheim | 世界名 + 种子 | 启动参数 | 待确认 |
| Palworld | 世界设置 | 配置文件 | 待确认 |
| Factorio | 地图生成（`world_generation`） | `world_generation.settings_files` | 已有 schema，但启动前未引导 |

**结论**：地图/世界/种子等启动关键参数在不同游戏中位置不一（启动参数 / 配置文件 / 世界生成），需要 Pack 显式声明"哪些项是启动前置必填"。

---

## 2. 方案概述

### 2.1 核心思路

四件事一起做：

1. **启停按钮上移**：移除全宽固定底栏，启停按钮移到实例详情头部状态区（与状态指示同行），刷新降级为状态区图标按钮，重置状态移入错误提示条
2. **启动前置引导**：Pack 新增 `startup_guide` 声明，实例新增 `startup_config_json` 字段存储基础设定；首次启动前弹出分步向导，未完成引导则禁用启动
3. **端口锁定**：创建时自动分配，前端移除端口输入框；详情页端口只读展示；启动时从实例信息透传，全程不可修改
4. **游戏规则声明**：Pack 通过 `startup_guide.steps` 声明该游戏的启动前置项（地图选择/世界名/种子/必填配置等），前端按声明动态渲染引导表单

### 2.2 设计原则

- **契约优先**：所有游戏的启动规则由 Pack YAML 声明，前端/后端按契约渲染与校验，不硬编码游戏特例
- **端口不可变**：端口是实例的不可变属性，创建时分配，生命周期内锁定
- **引导非阻断式**：引导未完成时不禁用"启动"按钮的可见性，而是点击后弹出向导（避免用户找不到入口）
- **向后兼容**：现有 Pack 无 `startup_guide` 时降级为"无前置引导，可直接启动"

---

## 3. 详细设计

### 3.1 启停按钮布局重构（P1）

#### 3.1.1 新布局结构

将底部固定栏拆除，操作按钮按"主操作 / 次操作 / 应急操作"三级重新分布到头部状态区：

```
┌─ 实例详情头部 ─────────────────────────────────┐
│ 实例名称  [状态徽章: running]  [刷新] [启动/停止] │  ← 主操作 + 状态 + 次操作
│ 端口 25565 · RCON 25575 · 版本 1.20.4 · 节点 ...  │  ← 只读元信息
└────────────────────────────────────────────────┘
┌─ 错误态提示条（仅 error 时显示）─────────────────┐
│ ⚠ 实例异常  [重置状态]                           │  ← 应急操作
└────────────────────────────────────────────────┘
```

#### 3.1.2 交互规则

- **主操作按钮**：根据 `displayState` 动态切换
  - `stopped` → 显示"启动"（success 主按钮，最醒目）
  - `running`/`starting`/`stopping` → 显示"停止"（warning）
  - `error` → 显示"停止"（warning，允许从 error 停止）
- **刷新**：降级为状态区旁边的图标按钮（`lucide-react` 的 `RefreshCw`），次要操作
- **重置状态**：仅在 `error + admin` 时，显示在错误提示条内（不再混在主操作栏）
- **移除**：`bottom-action-bar` CSS 类、`page-with-bottom-bar` 的 64px padding、全宽固定底栏
- **移动端**：头部状态区在 `max-width: 640px` 下改为两行（状态徽章+元信息一行，按钮一行），按钮 `flex:1` 自适应

#### 3.1.3 视觉对齐

- 主操作按钮采用苹果式清新风格：圆角、柔和的 success/warning 配色、不使用电竞风高饱和色
- 状态徽章与按钮在同一水平线，视觉重心明确
- 不再使用底部阴影 `box-shadow: 0 -2px 8px rgba(0,0,0,0.05)`（底栏移除后无需）

### 3.2 启动前置引导机制（P2）

#### 3.2.1 引导触发条件

- 实例 `startup_config_json` 为空（或未完成 Pack 声明的必填项）→ 首次启动
- 点击"启动"按钮时：
  - 若引导未完成 → 弹出启动向导 Modal，完成后再执行启动
  - 若引导已完成 → 直接启动（后续启动不再弹向导，除非用户主动编辑启动配置）

#### 3.2.2 启动向导交互

采用分步向导（Stepper），步骤由 Pack `startup_guide.steps` 声明：

```
┌─ 启动实例「xxx」- 启动配置 ────────────────────┐
│ ① 地图选择  → ② 世界设置  → ③ 基础配置  → ④ 确认 │
│                                                │
│ [当前步骤的表单内容，按 Pack 声明动态渲染]        │
│                                                │
│              [上一步]  [下一步]  [取消]         │
└────────────────────────────────────────────────┘
```

- **地图选择步**：若 Pack 声明了地图选项（如 ARK 的 `TheIsland`/`ScorchedEarth`），渲染单选卡片
- **世界设置步**：世界名、种子、难度等（按 Pack 声明字段）
- **基础配置步**：最大玩家数、服务器描述、密码等（引用 `config_files.schema` 中标记 `startup_required: true` 的字段）
- **确认步**：展示所有已填项摘要，确认后写入 `startup_config_json` 并调用 `/start`
- **草稿自动保存**：向导未完成时，已填项自动保存到实例草稿（复用 `useDraftAutosave` 模式）

#### 3.2.3 引导状态判定

- 后端 `/start` 前置校验：
  - 读取实例 `pack_id` 对应 Pack 的 `startup_guide`
  - 若 Pack 无 `startup_guide` → 跳过校验（向后兼容）
  - 若 Pack 有 `startup_guide` → 校验 `startup_config_json` 是否覆盖所有 `required: true` 的步骤项
  - 未覆盖 → 返回 `409 STARTUP_CONFIG_INCOMPLETE`，附带缺失项清单

### 3.3 端口锁定与透传（P3）

#### 3.3.1 端口生命周期

```
创建实例 → 自动分配 port/rcon_port（写入 servers 表）→ 锁定 → 启动时透传给 daemon
```

- **创建时**：`allocatePort()` 自动分配，**不接受 `body.port`/`body.rcon_port`**
- **运行期**：端口只读，前端详情页展示但不提供编辑入口
- **启动时**：从 `servers` 表读取，透传 `instance.{port, rcon_port}` 给 daemon（现状已是此行为，保持）

#### 3.3.2 前端变更

- `CreateServer.tsx` 移除 `port`/`rconPort` 输入框及相关校验（`validatePort`/`validatePortConflict`）
- 实例详情页端口展示为只读元信息行（"端口 25565 · RCON 25575"）
- `CreateServerRequest` 类型移除 `port`/`rcon_port` 字段（或保留但后端忽略，向后兼容）

#### 3.3.3 后端变更

- `POST /api/servers` 忽略 `body.port`/`body.rcon_port`，强制走 `allocatePort()`
- `POST /api/servers/:id/start` 透传逻辑不变（已是从 DB 读取）

### 3.4 不同游戏的启动规则声明（P4）

#### 3.4.1 Pack Schema 扩展：`startup_guide`

在 `public/schema/pack-schema.ts` 的 `GamePackSchema` 中新增可选字段 `startup_guide`：

```typescript
// 启动前置引导项类型
export const StartupGuideFieldTypeSchema = z.enum([
  'map',           // 地图选择（单选）
  'world_name',    // 世界/存档名
  'seed',          // 世界种子
  'difficulty',    // 难度
  'max_players',   // 最大玩家数
  'server_name',   // 服务器显示名
  'password',      // 服务器密码
  'config_ref',    // 引用 config_files.schema 中的字段
  'custom',        // 自定义字段（Pack 自行声明 schema）
]);

// 地图选项（用于 map 类型字段）
export const StartupMapOptionSchema = z.object({
  value: z.string().min(1),           // 地图标识（如 'TheIsland'）
  display_name: z.string().min(1),    // 显示名（如 '孤岛'）
  description: z.string().optional(), // 描述
  icon: z.string().optional(),        // 图标（可选，前端展示用）
});

// 引导步骤中的字段
export const StartupGuideFieldSchema = z.object({
  key: z.string().min(1),             // 字段标识
  type: StartupGuideFieldTypeSchema,
  label: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  // type='map' 时：可选地图清单
  options: z.array(StartupMapOptionSchema).optional(),
  // type='config_ref' 时：引用 config_files 中某文件的某字段
  config_ref: z.object({
    file: z.string().min(1),          // config_files[].name
    key: z.string().min(1),           // schema 中的字段 key
  }).optional(),
  // type='custom' 时：内联 schema（复用 ConfigFieldSchema 结构）
  schema: ConfigFieldSchema.optional(),
  // 取值范围（通用）
  min: z.number().optional(),
  max: z.number().optional(),
  enum_values: z.array(z.string()).optional(),
});

// 引导步骤
export const StartupGuideStepSchema = z.object({
  key: z.string().min(1),             // 步骤标识
  title: z.string().min(1),           // 步骤标题（如"地图选择"）
  description: z.string().optional(),
  fields: z.array(StartupGuideFieldSchema).min(1),
  // 该步骤是否可选（整步可跳过）
  optional: z.boolean().default(false),
});

// 启动前置引导声明
export const StartupGuideSchema = z.object({
  // 是否启用启动前置引导（默认 true）
  enabled: z.boolean().default(true),
  // 引导步骤（按顺序展示）
  steps: z.array(StartupGuideStepSchema).min(1),
  // 启动参数模板变量映射：把用户填写的字段值注入到 startup.args 的 {{var}}
  // 例如 ARK: { map: '{{map}}', server_name: '{{server_name}}' }
  args_mapping: z.record(z.string(), z.string()).optional(),
  // 配置文件写入映射：把字段值写入指定 config_files
  // 例如 Minecraft: [{ field_key: 'level_name', file: 'server-properties', config_key: 'level-name' }]
  config_writes: z.array(z.object({
    field_key: z.string().min(1),
    file: z.string().min(1),
    config_key: z.string().min(1),
  })).optional(),
});

// 在 GamePackSchema 中新增
export const GamePackSchema = z.object({
  // ...现有字段...
  startup_guide: StartupGuideSchema.optional(),
});
```

#### 3.4.2 各游戏 startup_guide 声明示例

**Minecraft**（地图=世界名，启动参数不依赖地图，写入 server.properties）：

```yaml
startup_guide:
  enabled: true
  steps:
    - key: world-setup
      title: 世界设置
      fields:
        - key: level_name
          type: world_name
          label: 世界名称
          required: true
          default: 'world'
          description: 存档目录名，重启后保留同一世界
        - key: level_seed
          type: seed
          label: 世界种子
          required: false
          description: 留空则随机生成
    - key: basic-config
      title: 基础配置
      fields:
        - key: max_players
          type: config_ref
          label: 最大玩家数
          config_ref: { file: server-properties, key: max-players }
          required: true
          default: 20
        - key: difficulty
          type: config_ref
          label: 难度
          config_ref: { file: server-properties, key: difficulty }
          required: true
          default: easy
          enum_values: [peaceful, easy, normal, hard]
        - key: motd
          type: config_ref
          label: 服务器描述
          config_ref: { file: server-properties, key: motd }
          required: false
  config_writes:
    - { field_key: level_name, file: server-properties, config_key: level-name }
    - { field_key: max_players, file: server-properties, config_key: max-players }
    - { field_key: difficulty, file: server-properties, config_key: difficulty }
    - { field_key: motd, file: server-properties, config_key: motd }
```

**ARK**（地图是启动参数第一项，必须选择）：

```yaml
startup_guide:
  enabled: true
  steps:
    - key: map-selection
      title: 地图选择
      fields:
        - key: map
          type: map
          label: 游戏地图
          required: true
          default: TheIsland
          options:
            - { value: TheIsland, display_name: 孤岛, description: 原版起始地图 }
            - { value: ScorchedEarth_P, display_name: 焦土, description: 沙漠地图 }
            - { value: Aberration_P, display_name: 畸变, description: 地下洞穴地图 }
    - key: server-settings
      title: 服务器设置
      fields:
        - key: server_name
          type: server_name
          label: 服务器名称
          required: true
          default: 'ARK Server'
        - key: max_players
          type: config_ref
          label: 最大玩家数
          config_ref: { file: game-user-settings, key: MaxPlayers }
          required: true
          default: 70
  args_mapping:
    map: '{{map}}'           # 替换 startup.args[0] 的 TheIsland
    server_name: '{{server_name}}'
  config_writes:
    - { field_key: max_players, file: game-user-settings, config_key: MaxPlayers }
    - { field_key: server_name, file: game-user-settings, config_key: SessionName }
```

**Terraria**（世界名+种子+难度，写入 serverconfig.txt）：

```yaml
startup_guide:
  enabled: true
  steps:
    - key: world-setup
      title: 世界设置
      fields:
        - key: world_name
          type: world_name
          label: 世界名称
          required: true
          default: 'world'
        - key: seed
          type: seed
          label: 世界种子
          required: false
        - key: difficulty
          type: difficulty
          label: 难度
          required: true
          default: normal
          enum_values: [classic, expert, master, journey]
    - key: server-settings
      title: 服务器设置
      fields:
        - key: max_players
          type: config_ref
          label: 最大玩家数
          config_ref: { file: server-config, key: maxplayers }
          required: true
          default: 16
        - key: password
          type: password
          label: 服务器密码
          required: false
  config_writes:
    - { field_key: world_name, file: server-config, config_key: worldname }
    - { field_key: seed, file: server-config, config_key: seed }
    - { field_key: difficulty, file: server-config, config_key: difficulty }
    - { field_key: max_players, file: server-config, key: maxplayers }
```

#### 3.4.3 启动参数注入规则

后端 `/start` 在调用 `daemonClient.startInstance` 前，按 `args_mapping` 渲染 `startup.args` 中的模板变量：

- ARK 的 `startup.args[0]` 当前是写死的 `'TheIsland'`，改为 `'{{map}}'`，由 `args_mapping: { map: '{{map}}' }` 注入用户选择
- Minecraft 的 `startup.args` 不含地图参数（地图通过 `level-name` 配置项生效），故无需 `args_mapping`，靠 `config_writes` 写入 `server.properties`
- 渲染后的 `args` 随 `daemonClient.startInstance` 一起传给 daemon

#### 3.4.4 配置文件写入规则

后端在启动前（或引导完成时）按 `config_writes` 把用户填写的字段值写入对应 `config_files`：

- 引导完成时：写入实例工作目录的配置文件（`{instances_dir}/{server_id}/{config_file_path}`）
- 写入由后端 `configService` 统一执行（复用现有配置文件读写能力），前端不直接写文件
- 写入时机：引导完成立即写入（而非启动时才写），便于用户在"配置文件"tab 复核

---

## 4. 数据模型变更

### 4.1 `servers` 表新增字段

```sql
-- v4.x.x: 启动前置引导配置（JSON）
-- 存储用户在启动向导中填写的基础设定（地图/世界名/种子/必填配置等）
-- 为空表示尚未完成启动引导；非空表示已完成（JSON 覆盖 Pack startup_guide.steps 的 required 项）
ALTER TABLE servers ADD COLUMN startup_config_json TEXT NULL;
-- 存储格式：{ "map": "TheIsland", "world_name": "world", "max_players": 20, ... }
-- 字段 key 对应 Pack startup_guide.steps[].fields[].key

-- 引导完成时间戳（用于判断是否首次启动）
ALTER TABLE servers ADD COLUMN startup_config_set_at TEXT NULL;
```

### 4.2 迁移脚本

新增 migration：`panel/backend/src/db/migrations/{timestamp}_add_startup_config.ts`

```typescript
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('servers', (t) => {
    t.text('startup_config_json').nullable();
    t.text('startup_config_set_at').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('servers', (t) => {
    t.dropColumn('startup_config_json');
    t.dropColumn('startup_config_set_at');
  });
}
```

### 4.3 `ServerRow` 类型扩展

`panel/backend/src/db/types.ts`（或对应类型定义文件）的 `ServerRow` 接口新增：

```typescript
startup_config_json: string | null;
startup_config_set_at: string | null;
```

---

## 5. API 变更

### 5.1 `POST /api/servers`（创建实例）

- **移除**：`body.port`/`body.rcon_port` 的接受（强制自动分配）
- **不变**：其余字段（name/pack_id/node_id/version_id）保持

### 5.2 `POST /api/servers/:id/start`（启动实例）

新增前置校验与参数注入：

```typescript
// 1. 读取 Pack
const pack = registry.get(row.pack_id);

// 2. 启动前置校验
if (pack?.startup_guide?.enabled) {
  const startupConfig = row.startup_config_json
    ? JSON.parse(row.startup_config_json)
    : {};
  const missingFields = validateStartupGuide(pack.startup_guide, startupConfig);
  if (missingFields.length > 0) {
    return res.status(409).json({
      error: {
        code: 'STARTUP_CONFIG_INCOMPLETE',
        message: '请先完成启动配置',
        details: { missing_fields: missingFields },
      },
    });
  }
}

// 3. 渲染启动参数（按 args_mapping 注入用户填写值）
const renderedArgs = pack.startup_guide?.args_mapping
  ? renderArgs(pack.startup.args, startupConfig, pack.startup_guide.args_mapping)
  : pack.startup.args;

// 4. 调用 daemon（透传 port + 渲染后的 args）
await daemonClient.startInstance(row.id, {
  pack: { ...pack, startup: { ...pack.startup, args: renderedArgs } },
  instance: {
    name: row.name,
    port: row.port,            // 从实例信息透传，不可修改
    rcon_port: row.rcon_port,  // 同上
    rcon_password: rconPassword,
    workdir,
  },
});
```

### 5.3 新增 `PUT /api/servers/:id/startup-config`（保存启动配置）

```typescript
// 保存用户在启动向导中填写的基础设定
router.put('/:id/startup-config', async (req, res) => {
  // 1. 校验 ownership
  // 2. 读取 Pack startup_guide
  // 3. 校验 req.body 覆盖所有 required 字段（未覆盖返回 400 + 缺失项清单）
  // 4. 按 config_writes 写入实例配置文件
  // 5. 更新 servers.startup_config_json + startup_config_set_at
  // 6. 返回 { ok: true }
});
```

### 5.4 新增 `GET /api/servers/:id/startup-guide`（获取引导声明）

```typescript
// 返回该实例对应 Pack 的 startup_guide + 当前已填写的 startup_config
// 前端启动向导据此渲染
router.get('/:id/startup-guide', async (req, res) => {
  const pack = registry.get(row.pack_id);
  return res.json({
    guide: pack?.startup_guide ?? null,
    current_config: row.startup_config_json ? JSON.parse(row.startup_config_json) : {},
  });
});
```

### 5.5 错误码新增

| 错误码 | HTTP | 含义 |
|--------|------|------|
| `STARTUP_CONFIG_INCOMPLETE` | 409 | 启动配置未完成，附带 `missing_fields` |
| `STARTUP_CONFIG_INVALID` | 400 | 启动配置值非法（类型/范围不符） |

---

## 6. 前端变更

### 6.1 移除底部操作栏

- `ServerDetail.tsx`：删除 `<div className="bottom-action-bar">...</div>`（L1084-L1114）
- `styles.css`：删除 `.bottom-action-bar` 及 `.page-with-bottom-bar` 相关样式（L4754-L4786）
- 移除 `page-with-bottom-bar` className 的使用

### 6.2 头部状态区重构

新增 `<InstanceActionBar>` 组件（或在 ServerDetail 内联），结构：

```tsx
<div className="instance-header">
  <h1>{server.name}</h1>
  <StatusBadge state={displayState} />
  <div className="instance-meta">
    端口 {server.port} · RCON {server.rcon_port} · 版本 {server.current_version}
  </div>
  <div className="instance-actions">
    <IconButton icon={RefreshCw} onClick={refresh} disabled={loading} aria-label="刷新" />
    <PrimaryButton
      variant={canStart ? 'success' : 'warning'}
      onClick={handleStartOrStop}
      disabled={actioning}
    >
      {canStart ? '启动' : '停止'}
    </PrimaryButton>
  </div>
</div>

{canResetState && (
  <ErrorBanner>
    实例处于异常状态 <Button onClick={handleResetState}>重置状态</Button>
  </ErrorBanner>
)}
```

### 6.3 启动前置引导向导

新增 `<StartupGuideWizard>` 组件：

- 打开条件：用户点击"启动"，且 `GET /servers/:id/startup-guide` 返回的 `current_config` 未覆盖所有 `required` 字段
- 步骤渲染：按 `guide.steps` 顺序渲染，每步的 `fields` 按 `type` 渲染对应控件
  - `map` → 单选卡片组（带图标）
  - `world_name`/`server_name`/`seed`/`password` → 文本输入
  - `difficulty`/`max_players` → 枚举/数字输入
  - `config_ref` → 从 `config_files.schema` 读取字段元数据渲染
- 提交：`PUT /servers/:id/startup-config` 保存，成功后继续调用 `/start`
- 草稿：向导内已填项自动保存到 localStorage（按实例 id 隔离）

### 6.4 创建表单精简

`CreateServer.tsx`：

- 移除 `port`/`rconPort` state、输入框、校验（`validatePort`/`validatePortConflict`）
- 移除 `CreateServerField` 中的 `'port' | 'rconPort'`
- 提交的 `CreateServerRequest` 不再带 `port`/`rcon_port`
- 表单只保留：名称、Pack 选择、节点选择、版本选择

### 6.5 端口只读展示

实例详情头部元信息行展示端口（只读），不再提供任何编辑入口。

---

## 7. Pack YAML 适配清单

需为现有 12 个 Pack 补充 `startup_guide` 字段（按游戏特性声明）：

| Pack | 地图/世界概念 | startup_guide 关键步骤 |
|------|-------------|----------------------|
| minecraft-vanilla | level-name + seed | world-setup（世界名+种子）+ basic-config（max-players/difficulty/motd） |
| minecraft-tshock（如有） | 同上 | 同上 |
| terraria-vanilla | worldname + seed + difficulty | world-setup（世界名+种子+难度）+ server-settings（maxplayers+password） |
| terraria-tshock | 同上 | 同上 |
| ark-vanilla | 地图（启动参数）+ SessionName | map-selection（地图单选）+ server-settings（server_name+max_players） |
| rust-vanilla | 世界种子（启动参数）+ maxplayers | world-setup（seed）+ server-settings（server_name+maxplayers+description） |
| valheim-vanilla | 世界名 + 种子 | world-setup（世界名+种子）+ server-settings（密码+最大玩家） |
| palworld-vanilla | 世界设置 | world-setup + server-settings |
| dst-vanilla | 世界生成（cluster） | world-setup（世界配置）+ server-settings |
| satisfactory-vanilla | 世界设置 | world-setup + server-settings |
| zomboid-vanilla | 世界设置 | world-setup + server-settings |
| enshrouded-vanilla | 世界设置 | world-setup + server-settings |
| factorio-vanilla | map gen（已有 world_generation） | world-setup（复用 world_generation.settings_files）+ server-settings |

每个 Pack 的 `args_mapping`/`config_writes` 按实际启动参数与配置文件路径声明。

---

## 8. 执行步骤

> 按依赖顺序执行，每步测通再走下一步。

### 步骤 1：数据模型与契约准备
- 编写 migration：`servers` 表新增 `startup_config_json` + `startup_config_set_at`
- 扩展 `public/schema/pack-schema.ts`：新增 `StartupGuideSchema` 及子 schema
- 扩展 `public/schema/panel-api-types.ts`：新增 `StartupGuide`/`StartupConfig`/`StartupGuideStep` 等类型，更新 `ServerDetail`/`CreateServerRequest` 类型
- 扩展 `ServerRow` 类型

### 步骤 2：后端 API 实现
- `POST /api/servers` 移除 `body.port`/`body.rcon_port` 接受
- `POST /api/servers/:id/start` 新增启动前置校验 + 参数渲染注入
- 新增 `GET /api/servers/:id/startup-guide`
- 新增 `PUT /api/servers/:id/startup-config`（含 `config_writes` 写入逻辑）
- 新增错误码 `STARTUP_CONFIG_INCOMPLETE`/`STARTUP_CONFIG_INVALID`
- 实现 `validateStartupGuide()` / `renderArgs()` / `applyConfigWrites()` 工具函数

### 步骤 3：Pack YAML 适配
- 为 12 个 Pack 逐个补充 `startup_guide`（按 §7 清单）
- ARK 的 `startup.args[0]` 从写死的 `'TheIsland'` 改为 `'{{map}}'`
- 其他游戏按需把启动参数中的地图/世界变量改为模板占位符
- 运行 `npm run packs:validate` 确保所有 Pack 通过 zod 校验

### 步骤 4：前端操作栏重构
- `ServerDetail.tsx` 移除 `bottom-action-bar`，新增头部 `InstanceActionBar`
- `styles.css` 删除 `.bottom-action-bar`/`.page-with-bottom-bar` 样式，新增 `.instance-header`/`.instance-actions`/`.error-banner` 样式
- 主操作按钮按 `displayState` 动态切换"启动"/"停止"
- 刷新降级为图标按钮，重置状态移入错误提示条
- 移动端响应式适配

### 步骤 5：前端启动向导实现
- 新增 `<StartupGuideWizard>` 组件（分步向导 + 动态字段渲染）
- `handleStart` 改为先调 `GET /servers/:id/startup-guide`，未完成则打开向导，完成后再 `/start`
- 向导草稿自动保存（按实例 id 隔离）
- 各字段类型控件实现：map 卡片、world_name/seed/password 输入、difficulty/max_players 枚举/数字、config_ref 联动

### 步骤 6：创建表单精简
- `CreateServer.tsx` 移除端口输入框与相关校验
- `CreateServerRequest` 移除 `port`/`rcon_port`
- 表单保留：名称、Pack、节点、版本

### 步骤 7：端口只读展示
- 实例详情头部元信息行展示端口（只读）
- 移除任何端口编辑入口（含配置文件 tab 中的端口字段，标记 `read_only` 或 `hidden`）

### 步骤 8：测试与验证
- 单元测试：`validateStartupGuide`/`renderArgs`/`applyConfigWrites`
- 契约测试：Pack schema zod 校验（含 startup_guide）
- E2E：创建实例（无端口输入）→ 详情页（端口只读）→ 点击启动 → 弹出向导 → 完成向导 → 启动成功
- Mock 回归：启动向导在不同 Pack 下的渲染
- 构建产物验证：`grep -r "localhost:3000" panel/frontend/dist/` 无命中

---

## 9. 开发事项清单

### 9.1 后端
- [ ] migration：`servers` 表新增 `startup_config_json`/`startup_config_set_at`
- [ ] `ServerRow` 类型扩展
- [ ] `public/schema/pack-schema.ts` 新增 `StartupGuideSchema`
- [ ] `public/schema/panel-api-types.ts` 新增启动引导相关类型
- [ ] `POST /api/servers` 移除端口接受
- [ ] `POST /api/servers/:id/start` 前置校验 + 参数渲染
- [ ] `GET /api/servers/:id/startup-guide` 实现
- [ ] `PUT /api/servers/:id/startup-config` 实现（含 config_writes）
- [ ] `validateStartupGuide()`/`renderArgs()`/`applyConfigWrites()` 工具函数
- [ ] 错误码 `STARTUP_CONFIG_INCOMPLETE`/`STARTUP_CONFIG_INVALID` 接入

### 9.2 Pack
- [ ] 12 个 Pack 补充 `startup_guide`（按 §7 清单）
- [ ] ARK `startup.args[0]` 改为 `'{{map}}'`
- [ ] 其他游戏启动参数模板化（按需）
- [ ] `npm run packs:validate` 全部通过

### 9.3 前端
- [ ] `ServerDetail.tsx` 移除 `bottom-action-bar`
- [ ] `styles.css` 删除底栏样式，新增头部状态区样式
- [ ] 头部 `InstanceActionBar`（启动/停止切换 + 刷新图标 + 元信息）
- [ ] 错误提示条（重置状态入口）
- [ ] `<StartupGuideWizard>` 组件（分步向导 + 动态字段）
- [ ] `handleStart` 改为先查引导状态
- [ ] `CreateServer.tsx` 移除端口输入
- [ ] 端口只读展示
- [ ] 移动端响应式

### 9.4 测试
- [ ] 后端单测：引导校验/参数渲染/配置写入
- [ ] Pack schema 契约测试
- [ ] E2E：创建→详情→启动向导→启动
- [ ] Mock 回归：多 Pack 向导渲染
- [ ] 构建产物 localhost:3000 验证

---

## 10. 建议与风险

### 10.1 建议

1. **向导默认值**：Pack `startup_guide.steps[].fields[].default` 应给出合理默认值，用户可直接确认快速启动，降低首次使用门槛
2. **地图图标**：ARK/Rust 等游戏的地图选项建议补充 `icon` 字段（截图或插画），提升选择体验；图标资源可放 `packs/{pack_id}/icons/map-{value}.png`
3. **配置写入时机**：建议在向导"确认"步即写入配置文件（而非启动时），便于用户在"配置文件"tab 复核后再启动
4. **端口展示**：详情页头部元信息行可加"复制"按钮，方便用户把端口发给玩家
5. **引导复用**：`startup_config_json` 保存后，后续启动不再弹向导；如需修改，可在"配置"tab 提供"重新配置启动项"入口
6. **Factorio 特例**：Factorio 已有 `world_generation` 字段，`startup_guide` 的 world-setup 步骤应复用 `world_generation.settings_files`，不重复声明

### 10.2 风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| Pack `startup_guide` 缺失导致旧 Pack 启动受阻 | 中 | `enabled` 默认 true 但整个 `startup_guide` 字段可选；缺失时后端跳过校验，向后兼容 |
| ARK `args[0]` 改模板后历史实例启动失败 | 高 | 历史实例 `startup_config_json` 为空时，`renderArgs` 对 `{{map}}` 取 `default` 值（TheIsland）兜底 |
| `config_writes` 写入失败（文件不存在/权限） | 中 | 写入失败仅记录 warn 日志不阻断启动；启动前在"配置文件"tab 提示用户检查 |
| 端口移除输入后用户无法指定端口 | 低 | 端口自动分配符合 VPS 模型；管理员如需指定端口可通过 admin API/CLI 工具调整（不在前端暴露） |
| 移动端头部空间紧张 | 低 | `max-width:640px` 下状态区改两行布局，按钮 `flex:1` |
| 向导字段类型扩展（未来新游戏） | 低 | `StartupGuideFieldTypeSchema` 用 zod enum，新增类型走 schema 扩展流程（s0601） |

### 10.3 关键决策点（已裁决，2026-07-29）

- **端口前端编辑权** → **裁决：仅后端 API 可调**。前端全员（含管理员）禁止编辑端口，端口为实例不可变属性。无需"高级设置"入口，详情页端口只读展示。
- **自带节点（self_hosted）实例豁免** → **裁决：不豁免**。self_hosted 实例仅免计费，启动前置引导与计费豁免相互独立，仍需完成 `startup_guide` 声明的基础设定后方可启动。
- **ARK 地图清单是否动态化** → **裁决：先按静态处理**。当前以 Pack `startup_guide.steps[].fields[].options` 静态声明地图清单；未来随 DLC 增多需动态化时，Pack schema 新增 `options_source` 远程源字段（属未来增强，不在本方案范围）。已记入项目记忆。

---

## 11. 交付物清单

| 产物 | 路径 |
|------|------|
| 本方案文档 | `docs/plans/instance-startup-guide-and-action-bar-plan.md` |
| Pack schema 扩展 | `public/schema/pack-schema.ts` |
| API 类型扩展 | `public/schema/panel-api-types.ts` |
| Migration | `panel/backend/src/db/migrations/{timestamp}_add_startup_config.ts` |
| 后端路由 | `panel/backend/src/api/routes/servers.ts` |
| 前端详情页 | `panel/frontend/src/pages/ServerDetail.tsx` |
| 前端创建页 | `panel/frontend/src/pages/CreateServer.tsx` |
| 启动向导组件 | `panel/frontend/src/components/StartupGuideWizard.tsx`（新增） |
| 样式 | `panel/frontend/src/styles.css` |
| Pack YAML × 12 | `packs/*/pack.yaml` |

---

> 本方案完成后，实例启停交互将从"底栏直按"升级为"头部主操作 + 启动前置引导"，端口锁定为实例不可变属性，不同游戏的启动规则由 Pack 声明驱动，符合契约优先与前后分离原则。
