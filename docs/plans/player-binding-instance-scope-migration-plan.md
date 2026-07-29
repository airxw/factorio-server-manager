---
type: plan
title: 玩家角色绑定从 game_type 全局语义迁移至 instance 实例级语义
date: 2026-07-27
status: pending
related: binding-unification-multi-role-plan
tags: [binding, player-binding, instance-scope, contract-change, s0601]
---

# 玩家角色绑定实例级迁移方案

## 一、背景与问题

`/guild/bind?type=player` 向导第 1 步当前让用户选择**游戏类型**（Minecraft / Terraria…）并输入角色名，点击「生成验证码」后调用 `POST /api/player-bindings`，后端把记录写入 `bindings` 表 `binding_type='player', scope_type='game_type', scope_ref=game_type` —— **跨实例全局玩家绑定**。

**问题：** 玩家角色本质属于某个具体实例，不属于"游戏类型"。例如同一用户在 Minecraft 服务器 A 和服务器 B 上是两个不同角色，绑定到 game_type 无法区分。当前 `?type=player` 向导的 UI 与数据语义均不正确。

**用户决策（2026-07-27）：**
1. 方向：**完全替换为实例级** —— `scope_type='instance'`, `scope_ref=server_id`
2. 旧数据处理：**直接物理删除** 现有 `scope_type='game_type'` 的 player 绑定记录

## 二、现状梳理

### 2.1 已存在的两套并行流程

系统中其实已有完整的「实例级玩家验证码」流程：

| 入口 | 路由 | 写入语义 | 用途 |
|------|------|---------|------|
| 旧（待废弃） | `POST /api/player-bindings` | `scope_type='game_type'` | `?type=player` 向导调用，verify_code 无 TTL |
| 已存在 | `POST /api/verify-codes` | `scope_type='instance'` | 游戏详情页调用，verify_code 5 分钟 TTL，由 `instanceBindingService.generateVerifyCode` 实现 |

`?type=player` 向导走的是上表第一行，但第二行才是正确的实例级流程。

### 2.2 真正的验证发生在 `instanceBindingService.verifyBindingByCode`

游戏内 `!verify <code>` 命令由 `verifyBindingByCode` 处理，它做三件事：
1. 把 pending 验证码记录（`scope_type='instance'`）改为 verified
2. **额外**创建/更新一条 `scope_type='game_type', verify_status='verified'` 的全局玩家绑定 ← **本次要删除**
3. 创建/复活账户级绑定（`scope_type='instance'`, vip_level=1）

### 2.3 下游 8 处消费方按 `scope_type='game_type'` 查询 player 绑定

| 文件 | 用途 |
|------|------|
| `panel/backend/src/services/playerService.ts` | list/create/verify/reject/delete 全部 |
| `panel/backend/src/api/routes/playerBindings.ts` | server 级 admin 列表 + DELETE |
| `panel/backend/src/api/routes/my.ts` | GET /api/profile 中玩家绑定列表 |
| `panel/backend/src/api/routes/store-player-actions.ts` | 商店购买前校验角色绑定 |
| `panel/backend/src/api/routes/store-gm.ts` | GM 操作前校验角色绑定 |
| `panel/backend/src/api/routes/daemon-report.ts` | daemon 上报前校验角色绑定 |
| `panel/backend/src/services/cdkService.ts` | CDK 兑换前校验角色绑定 |
| `panel/backend/src/services/userService.ts` | 多角色查询 |
| `panel/backend/src/services/myAssetsService.ts` | 我的资产查询 |

### 2.4 受保护契约文件（public/，需走 s0601）

- `public/schema/panel-api-types.ts` — `CreatePlayerBindingRequest { game_player_name: string; game_type: string }` 需改为 `{ game_player_name: string; server_id: string }`
- `public/pre_generated_mock/bindings.ts` — mock 中 `scope_type: 'game_type'` 字面量
- `public/test_cases/bindings-contract.test.ts` + `bindings-api-contract.test.ts` — 含 `scope_type: 'game_type'` 测试用例

`public/schema/bindings-schema.json` **无需修改** —— schema 本来就支持 `scope_type='instance'`，只是 `binding_type='player' + scope_type='game_type'` 这条组合被废弃。

## 三、执行步骤

### 3.1 契约变更（s0601 流程）

1. 调用 `s0601-adapting-contract-changes` Skill 识别变更影响面
2. 修改 `public/schema/panel-api-types.ts`：
   ```diff
   export interface CreatePlayerBindingRequest {
     game_player_name: string;
   - game_type: string;
   + server_id: string;
   }
   ```
3. 在 `public/schema/CHANGELOG.md` 追加 MINOR 变更记录（字段类型变更属于 MAJOR，但本字段语义就是"作用域引用"，故按 MINOR 处理 + 显式 BREAKING 标注）
4. 更新 `public/pre_generated_mock/bindings.ts` 中相关 mock 数据
5. 更新 `public/test_cases/bindings-*.test.ts` 测试用例

### 3.2 后端 services 层

#### 3.2.1 `panel/backend/src/services/playerService.ts`
- `listBindings`: WHERE 改为 `binding_type='player', scope_type='instance'`
- `createBinding`: 参数改为 `{ game_player_name, server_id }`，校验 server 存在 → 写入 `scope_type='instance', scope_ref=server_id, player_name=game_player_name`，verify_code 加 5 分钟 TTL（对齐 `instanceBindingService.generateVerifyCode`）
- `verifyBinding`: WHERE 改为 `scope_type='instance'`
- `rejectBinding`: WHERE 改为 `scope_type='instance'`
- `deleteBinding`: WHERE 改为 `scope_type='instance'`
- 重复检查从 `(user_id, game_type)` 改为 `(user_id, server_id)`

#### 3.2.2 `panel/backend/src/services/instanceBindingService.ts`
- `verifyBindingByCode`: 删除事务中 step 2「创建/更新 player 全局绑定 scope_type='game_type'」整段（行 559-616），保留 step 1（pending → verified）和 step 3（账户级绑定复活）
- `getVipLevelByGamePlayerName`: 改为直接按 `server_id + player_name` 查 `scope_type='instance', verify_status='verified'`，不再 JOIN servers 表查 game_type

### 3.3 后端 routes 层

#### 3.3.1 `panel/backend/src/api/routes/playerBindings.ts`
- `POST /`: 请求体校验从 `game_type` 改为 `server_id`，调用 `playerService.createBinding(userId, { game_player_name, server_id })`
- `GET /`: `playerService.listBindings` 内部已改
- `POST /:id/verify`, `POST /:id/reject`, `DELETE /:id`: 内部已改
- `createServerPlayerBindingsRouter`:
  - `GET /api/servers/:serverId/player-bindings`: WHERE 改为 `bindings.scope_ref = serverId`（不再 JOIN servers 查 game_type）
  - `DELETE /api/servers/:serverId/player-bindings/:id`: WHERE 改为 `scope_ref = serverId`

#### 3.3.2 其他下游消费方（8 处）
- `my.ts`: WHERE 改为 `scope_type='instance'`
- `store-player-actions.ts`: 同上 + 不再 JOIN servers
- `store-gm.ts`: 同上
- `daemon-report.ts`: 同上
- `cdkService.ts`: 同上
- `userService.ts`: 同上（3 处）
- `myAssetsService.ts`: 同上

### 3.4 数据库迁移脚本

新增 `panel/backend/src/db/migrations/20260727100000_drop_game_type_player_bindings.ts`：

```typescript
export async function up(knex: Knex): Promise<void> {
  // 物理删除所有 scope_type='game_type' 的 player 绑定记录（含 pending/verified/revoked/expired）
  await knex('bindings')
    .where({
      binding_type: 'player',
      scope_type: 'game_type',
    })
    .delete();
}

export async function down(knex: Knex): Promise<void> {
  // 不可逆：物理删除后无法恢复，回滚需从备份恢复
  // 留空表示 down 不支持数据恢复
}
```

### 3.5 前端

#### 3.5.1 `panel/frontend/src/pages/guild/GuildBind.tsx`
- 删除 `GAME_TYPE_LABEL` / `GAME_TYPE_OPTIONS` 常量（保留 `gameLabel` 给 server.game_type 显示用）
- 删除 `gameType` state
- 「第 1 步」section 改造：
  - 标题改为「第 1 步：选择实例并填写角色名」
  - 描述改为「选择要绑定的实例并输入游戏内角色名，系统将生成 6 位验证码」
  - 表单控件：实例下拉框（用 `bindableServers` 或 `servers` state）+ 角色名输入框 + 生成按钮
  - 实例下拉框 `<select>` 选项：`{server.id} - {server.name} ({gameLabel(server.game_type)})`
- `handleCreate`: 调用 `api.createPlayerBinding({ game_player_name: name, server_id: selectedServerId })`
- 第 2 步列表渲染：`grouped` 改为按 `server_id` 分组（用 serverMap 查 server 名做标题），不再用 `gameLabel(scope_ref)`

#### 3.5.2 `panel/frontend/src/pages/guild/components/AccountBindingCard.tsx`
- 同步 `api.createPlayerBinding` 调用：从 `{ game_player_name, game_type }` 改为 `{ game_player_name, server_id }`
- 该组件原本可能传入 `gameType` prop，需改为接收 `serverId` + `serverName`

#### 3.5.3 `panel/frontend/src/api/modules/servers.ts`（接口签名）
- `createPlayerBinding(req: CreatePlayerBindingRequest)` 签名跟着契约改

#### 3.5.4 `panel/frontend/src/api/client.ts`
- `createPlayerBinding` 实现跟着契约改

### 3.6 测试

- `panel/backend/src/api/routes/playerBindings.test.ts`: 测试用例全部改为 `scope_type='instance', scope_ref=server_id`
- `panel/backend/src/api/routes/my.test.ts`: 同上
- `panel/backend/src/api/routes/users.roles.test.ts`: 同上
- `panel/frontend/src/pages/guild/__tests__/GuildBind.test.tsx`: 同上
- `panel/frontend/src/mocks/handlers.ts`: mock 数据 `scope_type` 改为 `'instance'`
- 新增迁移脚本测试（验证 up 后 `bindings` 表无 `scope_type='game_type'` 的 player 记录）

### 3.7 版本与文档

- 版本号：4.26.0 → **4.27.0**（中版本号 +1，属全新功能/契约破坏性变更）
- `version.md` 追加 v4.27.0 章节
- `current-note.md` 更新交接状态
- README.md 无需更新（无文件结构调整）

## 四、开发事项

### 4.1 关键风险点

1. **`POST /api/player-bindings` 与 `POST /api/verify-codes` 的功能重叠**：本次改造后两者语义高度相似（都生成实例级验证码）。可考虑：
   - 保留两者，`POST /api/player-bindings` 用于 `?type=player` 向导（无 client_id），`POST /api/verify-codes` 用于游戏详情页（已知 server_id）
   - 或废弃 `POST /api/player-bindings`，前端向导改调 `POST /api/verify-codes`
   - **本方案选保留两者**，避免破坏既有 API 路径

2. **`verifyBindingByCode` 事务中删除 step 2 后，step 1 的 pending → verified 是否仍能被下游查询到？** 可以 —— 下游改为查 `scope_type='instance', verify_status='verified'` 后，step 1 改 verified 的记录即可被查到。原 step 2 的全局绑定反而成为冗余。

3. **`getVipLevelByGamePlayerName` 改造后**：直接按 `server_id + player_name` 查 `scope_type='instance'` 反查 user_id，无需再 JOIN servers 表，性能更好。

4. **物理删除迁移不可逆**：迁移脚本 up 执行后，旧 `scope_type='game_type'` 记录无法恢复。回滚需从备份恢复。

### 4.2 并行组（[P] 标记）

| 阶段 | [P] 组 | 并行理由 | 失败回退点 |
|------|--------|---------|----------|
| 契约变更 | — | 单一修改，不可并行 | s0601 审查阻断 |
| 后端 services + routes | [P] 后端组 | playerService / instanceBindingService / 8 处下游相互独立 | 回退到 playerService 检查点 |
| 前端 | [P] 前端组 | GuildBind.tsx / AccountBindingCard.tsx / api/modules 独立 | 回退到 GuildBind.tsx 检查点 |
| 迁移脚本 | — | 必须在所有代码改完后执行 | 不可回退 |
| 测试 | — | 必须在代码改完后执行 | — |

### 4.3 subagent 调度台账

| 阶段标签 | [P]组 | subagent_type | 预期产物 | actual agent id | 第二落点 | 失败回退点 | 状态 |
|---------|-------|---------------|---------|----------------|---------|-----------|------|
| 契约变更（s0601） | — | general_purpose_task | public/schema/panel-api-types.ts + mock + test_cases 修改 | 待回填 | .trae/documents/s0601-player-binding.md | 主线程检查点 | 待启动 |
| 后端改造 | [P] | general_purpose_task | playerService.ts + instanceBindingService.ts + 8 处下游 | 待回填 | .trae/specs/backend-instance-binding.md | 主线程检查点 | 待启动 |
| 前端改造 | [P] | general_purpose_task | GuildBind.tsx + AccountBindingCard.tsx + api/modules | 待回填 | .trae/specs/frontend-instance-binding.md | 主线程检查点 | 待启动 |
| 迁移脚本 | — | 主线程（非subagent） | 20260727100000_drop_game_type_player_bindings.ts | — | panel/backend/src/db/migrations/ | — | 待启动 |
| 测试 | — | 主线程（非subagent） | 测试用例更新 + 通过 | — | — | — | 待启动 |
| 版本文档 | — | 主线程（非subagent） | version.md + current-note.md | — | — | — | 待启动 |

## 五、建议

1. **建议先做契约变更（s0601）→ 独立审查 → 再并行展开后端+前端**。契约若审查阻断，下游代码全部返工。
2. **建议迁移脚本在部署前最后执行**，且执行前必须备份数据库（`cp /opt/gameserver-panel/data/panel.db /opt/gameserver-panel/data/panel.db.bak.20260727`）。
3. **建议前端改造同时清理 `GAME_TYPE_LABEL` 等无用常量**，避免遗留死代码。
4. **建议在本版本发布后观察 1-2 周**，确认无下游消费方仍按 `scope_type='game_type'` 查询（搜 grep 验证）。
5. **不建议本次同时合并 `POST /api/player-bindings` 与 `POST /api/verify-codes`**——超出用户授权范围，留作后续优化。

## 六、闭合判据

- [ ] public/ 契约变更完成（s0601 通过）
- [ ] 后端 playerService + instanceBindingService + 8 处下游全部改完
- [ ] 数据库迁移脚本可执行
- [ ] 前端 GuildBind.tsx + AccountBindingCard.tsx 改完
- [ ] 测试套件全部 PASS（后端单测 + 前端单测 + 契约测试）
- [ ] `npm run verify` 通过
- [ ] grep `scope_type.*game_type.*player|player.*scope_type.*game_type` 在 panel/backend/src/ 中无残留
- [ ] grep `localhost:3000` 在 dist 中无残留
- [ ] version.md + current-note.md 更新
- [ ] 独立审查（GN-004）通过
